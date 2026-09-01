import type { FastifyInstance } from 'fastify';
import { hub } from './hub.js';

/**
 * Client WebSocket at /ws.
 *
 * Protocol is intentionally tiny - the client sends subscribe/unsubscribe and
 * receives events. No auth is required: everything broadcast here is public
 * (quotes, tape, new calls, settlements). Anything user-specific is fetched
 * over HTTP with a token, so a leaked socket cannot expose one user's orders
 * to another.
 *
 *   -> { "action": "subscribe",   "channel": "market:<uuid>" }
 *   -> { "action": "unsubscribe", "channel": "market:<uuid>" }
 *   -> { "action": "ping" }
 *   <- { "channel": "feed", "type": "market.settled", ... }
 */
export async function realtimeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ws', { websocket: true }, (socket, req) => {
    const sub = hub.add(socket);
    req.log.debug({ subscribers: hub.subscriberCount }, 'Realtime client connected');

    socket.send(JSON.stringify({ channel: 'system', type: 'connected', channels: ['feed'] }));

    socket.on('message', (raw: Buffer) => {
      let msg: { action?: string; channel?: string };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        socket.send(JSON.stringify({ channel: 'system', type: 'error', message: 'Invalid JSON' }));
        return;
      }

      switch (msg.action) {
        case 'subscribe':
          if (msg.channel) {
            hub.subscribe(sub, msg.channel);
            socket.send(
              JSON.stringify({ channel: 'system', type: 'subscribed', target: msg.channel }),
            );
          }
          break;
        case 'unsubscribe':
          if (msg.channel) hub.unsubscribe(sub, msg.channel);
          break;
        case 'ping':
          socket.send(JSON.stringify({ channel: 'system', type: 'pong' }));
          break;
        default:
          socket.send(
            JSON.stringify({ channel: 'system', type: 'error', message: 'Unknown action' }),
          );
      }
    });

    socket.on('close', () => {
      hub.remove(sub);
    });

    socket.on('error', () => {
      hub.remove(sub);
    });
  });
}
