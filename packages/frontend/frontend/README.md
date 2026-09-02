# Oracle - Social Prediction Trading

A social prediction network UI built on top of DreamDEX Event Contracts.
Includes a marketing landing page and a fully interactive product dashboard
(feed, market/trade view, prediction detail, profile, leaderboard, and live
battles), wired together with client-side routing.

## Getting started

```bash
npm install
npm run dev
```

Then open the printed local URL (usually http://localhost:5173).

## Build for production

```bash
npm run build
npm run preview
```

## Structure

- `src/App.jsx` - top-level router: swaps between the landing page and the dashboard.
- `src/components/OracleLanding.jsx` - marketing site (hero, how-it-works, CTA).
- `src/components/OracleDashboard.jsx` - the interactive product: live prediction feed,
  market/order book/trade panel, prediction detail, trader profile, leaderboard, and
  live battles, plus a simulated trade confirmation flow.

Click "Launch App" on the landing page to enter the dashboard, and "← Site" in the
dashboard nav to return to the landing page.
