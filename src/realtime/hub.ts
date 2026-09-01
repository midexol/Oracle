import type { WebSocket } from 'ws';

/**
 * In-process pub/sub for the client WebSocket.
 *
 * Oracle's feed is only compelling if it moves: prices tick, calls appear,
 * markets settle and the leaderboard reorders while you are looking at it.
 * Rather than have the frontend poll six endpoints, the backend pushes.
 *
 * Channels are strings the client subscribes to explicitly:
 *   feed                 - new predictions, settlements, leaderboard moves
 *   market:<marketId>    - quotes, tape and settlement for one contract
 *   user:<userId>        - your own order fills and settlements
 *
 * This is deliberately in-memory. One backend process serves the hackathon
 * build, and a Redis-backed fan-out is a drop-in replacement for this file if
 * that ever stops being true - nothing else in the codebase knows how
 * `publish` is implemented.
 */

export type RealtimeEvent =
  | { type: 'quote'; marketId: string; upPriceCents: number; downPriceCents: number }
  | { type: 'trade.tape'; marketId: string; side: 'UP' | 'DOWN'; priceCents: number; quantity: string }
  | { type: 'market.opened'; marketId: string; asset: string; duration: string; closesAt: string }
  | { type: 'market.settled'; marketId: string; outcome: 'UP' | 'DOWN'; won: number; lost: number }
  | { type: 'prediction.created'; predictionId: string; marketId: string; userId: string }
  | { type: 'prediction.settled'; predictionId: string; result: 'WON' | 'LOST' }
  | { type: 'order.filled'; tradeId: string; marketId: string; txHash: string }
  | { type: 'leaderboard.changed' };

interface Subscriber {
  socket: WebSocket;
  channels: Set<string>;
}

class RealtimeHub {
  private subscribers = new Set<Subscriber>();

  add(socket: WebSocket): Subscriber {
    const sub: Subscriber = { socket, channels: new Set(['feed']) };
    this.subscribers.add(sub);
    return sub;
  }

  remove(sub: Subscriber): void {
    this.subscribers.delete(sub);
  }

  subscribe(sub: Subscriber, channel: string): void {
    // A client that subscribes to unbounded channels would grow this set
    // forever; cap it rather than trust the caller.
    if (sub.channels.size >= 50) return;
    sub.channels.add(channel);
  }

  unsubscribe(sub: Subscriber, channel: string): void {
    sub.channels.delete(channel);
  }

  publish(channel: string, event: RealtimeEvent): void {
    const payload = JSON.stringify({ channel, ...event });
    for (const sub of this.subscribers) {
      if (!sub.channels.has(channel)) continue;
      // readyState 1 === OPEN. Sending to a closing socket throws, and one
      // dead client must never break the broadcast for everyone else.
      if (sub.socket.readyState !== 1) continue;
      try {
        sub.socket.send(payload);
      } catch {
        this.subscribers.delete(sub);
      }
    }
  }

  /** Convenience: publish to the global feed and a market channel at once. */
  publishMarket(marketId: string, event: RealtimeEvent): void {
    this.publish(`market:${marketId}`, event);
    this.publish('feed', event);
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }
}

export const hub = new RealtimeHub();
export type { Subscriber };
