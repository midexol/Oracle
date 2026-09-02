/**
 * End-to-end smoke test of the frontend-facing compatibility API.
 *
 * Boots a throwaway Postgres, migrates, seeds, starts the real server, and
 * exercises every endpoint the frontend calls over real HTTP - asserting the
 * exact field names and scales its components read. The integration tests
 * cover the service layer; this covers routing, the `{ data }` envelope, the
 * error shape and JSON serialisation, which the service tests cannot see.
 *
 *   node scripts/smoke-compat.mjs
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? '  PASS' : '  FAIL'}  ${name}${condition ? '' : `  <- ${detail}`}`);
}

function run(cmd, args, env) {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } });
    c.on('exit', (code) => resolve(code ?? 1));
  });
}

async function main() {
  // CI supplies a Postgres service container; locally we boot a throwaway one.
  const external = process.env.TEST_DATABASE_URL;
  const port = external ? 0 : await freePort();
  const apiPort = await freePort();
  const dataDir = external ? null : mkdtempSync(join(tmpdir(), 'oracle-smoke-'));
  const pg = external
    ? null
    : new EmbeddedPostgres({
        databaseDir: dataDir,
        user: 'postgres',
        password: 'postgres',
        port,
        persistent: false,
      });

  const env = {
    DATABASE_URL: external ?? `postgresql://postgres:postgres@127.0.0.1:${port}/oracle`,
    JWT_SECRET: '0123456789012345678901234567890123456789',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    ENABLE_JOBS: 'false',
    PORT: String(apiPort),
    HOST: '127.0.0.1',
  };

  let server;
  try {
    if (pg) {
      await pg.initialise();
      await pg.start();
      await pg.createDatabase('oracle');
    }

    console.log('\n== migrate + seed ==');
    if ((await run(process.execPath, ['--import', 'tsx', 'src/db/migrate.ts'], env)) !== 0) {
      throw new Error('migration failed');
    }
    if ((await run(process.execPath, ['--import', 'tsx', 'src/db/seed.ts'], env)) !== 0) {
      throw new Error('seed failed');
    }

    console.log('\n== boot server ==');
    server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      stdio: 'ignore',
      env: { ...process.env, ...env },
    });

    const base = `http://127.0.0.1:${apiPort}`;
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch(`${base}/health`);
        if (r.status === 200) break;
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    console.log('\n== GET /api/leaderboard ==');
    const lbRes = await fetch(`${base}/api/leaderboard?limit=10`);
    const lbBody = await lbRes.json();
    check('200 OK', lbRes.status === 200, String(lbRes.status));
    check('wrapped in { data }', Array.isArray(lbBody.data), JSON.stringify(lbBody).slice(0, 120));

    const top = lbBody.data?.[0];
    check('has entries', Boolean(top), 'seed produced no ranked predictors');
    if (top) {
      for (const field of [
        'rank',
        'wallet',
        'username',
        'avatar',
        'totalPredictions',
        'totalWins',
        'accuracy',
        'predictionScore',
      ]) {
        check(`entry.${field} present`, top[field] !== undefined && top[field] !== null, field);
      }
      check('rank starts at 1', top.rank === 1, String(top.rank));
      // The UI calls accuracy.toFixed(0) and appends '%'.
      check(
        'accuracy is a percentage (>1, <=100)',
        top.accuracy > 1 && top.accuracy <= 100,
        String(top.accuracy),
      );
      check('accuracy.toFixed is callable', typeof top.accuracy === 'number', typeof top.accuracy);
      check(
        'predictionScore is 0-100',
        top.predictionScore >= 0 && top.predictionScore <= 100,
        String(top.predictionScore),
      );
    }

    console.log('\n== GET /api/users/:wallet/profile ==');
    const wallet = top?.wallet;
    const pRes = await fetch(`${base}/api/users/${wallet}/profile`);
    const pBody = await pRes.json();
    const profile = pBody.data;
    check('200 OK', pRes.status === 200, String(pRes.status));
    check('wrapped in { data }', Boolean(profile));

    if (profile) {
      for (const field of [
        'wallet',
        'totalPredictions',
        'totalWins',
        'totalLosses',
        'winRate',
        'predictionScore',
        'momentumScore',
        'credibleInterval90',
        'categoryBreakdown',
        'history',
      ]) {
        check(`profile.${field} present`, profile[field] !== undefined, field);
      }
      // Math.round(profile.winRate) is rendered as the accuracy percentage.
      check(
        'winRate is a percentage',
        profile.winRate > 1 && profile.winRate <= 100,
        String(profile.winRate),
      );
      check(
        'categoryBreakdown[].label + accuracy%',
        profile.categoryBreakdown.every(
          (c) => typeof c.label === 'string' && typeof c.accuracy === 'number',
        ),
        JSON.stringify(profile.categoryBreakdown?.[0] ?? null),
      );
      const h = profile.history?.[0];
      check('history entries present', Boolean(h), 'no settled history');
      if (h) {
        // Rendered as `$${Number(h.price).toFixed(2)}`.
        check('history price is dollars (<1)', h.price > 0 && h.price < 1, String(h.price));
        check('history result is WON/LOST', ['WON', 'LOST'].includes(h.result), h.result);
        check('history dir is UP/DOWN', ['UP', 'DOWN'].includes(h.dir), h.dir);
      }
    }

    console.log('\n== case-insensitive wallet ==');
    const upper = await fetch(`${base}/api/users/${String(wallet).toUpperCase()}/profile`);
    check('uppercased address resolves', upper.status === 200, String(upper.status));

    console.log('\n== GET /api/users/:wallet/score-breakdown ==');
    const sbRes = await fetch(`${base}/api/users/${wallet}/score-breakdown`);
    const sb = (await sbRes.json()).data;
    check('200 OK', sbRes.status === 200, String(sbRes.status));
    check('has factors', Array.isArray(sb?.factors) && sb.factors.length > 0);
    check(
      'no NaN/undefined in copy',
      JSON.stringify(sb ?? {}).match(/NaN|undefined/) === null,
      JSON.stringify(sb ?? {}).slice(0, 160),
    );

    console.log('\n== POST /api/predictions ==');
    const demoWallet = '0x00000000000000000000000000000000000000ab';
    const payload = {
      wallet: demoWallet,
      marketId: 'BTC-15M-smoke',
      asset: 'BTC',
      duration: '15M',
      prediction: 'UP',
      entryPrice: 0.43,
      username: 'smoketest',
    };
    const cRes = await fetch(`${base}/api/predictions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const created = (await cRes.json()).data;
    check('201 Created', cRes.status === 201, String(cRes.status));
    check('entryPrice 0.43 -> 43 cents', created?.entryPriceCents === 43, String(created?.entryPriceCents));

    const rRes = await fetch(`${base}/api/predictions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    check('replay is idempotent (200)', rRes.status === 200, String(rRes.status));

    console.log('\n== GET /api/predictions/:id/context ==');
    const ctxRes = await fetch(`${base}/api/predictions/${created.id}/context`);
    const ctx = (await ctxRes.json()).data;
    check('200 OK', ctxRes.status === 200, String(ctxRes.status));
    check('has contextText', typeof ctx?.contextText === 'string' && ctx.contextText.length > 0);

    console.log('\n== error shape ==');
    const errRes = await fetch(`${base}/api/users/0xdoesnotexist/profile`);
    const errBody = await errRes.json();
    check('404 for unknown wallet', errRes.status === 404, String(errRes.status));
    // The client reads `error.message` off the parsed body.
    check('top-level message for the client', typeof errBody.message === 'string', JSON.stringify(errBody));

    const badRes = await fetch(`${base}/api/predictions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, marketId: 'bad', entryPrice: 5 }),
    });
    check('400 for a bad entry price', badRes.status === 400, String(badRes.status));

    console.log('\n== /api/v1 still intact ==');
    const v1 = await fetch(`${base}/api/v1/leaderboard`);
    const v1Body = await v1.json();
    check('v1 leaderboard 200', v1.status === 200, String(v1.status));
    check('v1 is NOT enveloped', v1Body.data === undefined, JSON.stringify(v1Body).slice(0, 100));
    check('v1 accuracy stays a fraction', (v1Body.items?.[0]?.accuracy ?? 0) <= 1, String(v1Body.items?.[0]?.accuracy));
  } finally {
    if (server) server.kill();
    if (pg) await pg.stop().catch(() => undefined);
    if (dataDir) {
      try {
        rmSync(dataDir, { recursive: true, force: true });
      } catch {
        /* windows may hold the dir briefly */
      }
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('FAILED:');
    for (const f of failed) console.log(`  - ${f.name}  (${f.detail})`);
  }
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
