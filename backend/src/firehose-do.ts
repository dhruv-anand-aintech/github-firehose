export class FirehoseDO {
  private state: DurableObjectState;
  private sessions: Map<WebSocket, any>;

  constructor(state: DurableObjectState, env: any) {
    this.state = state;
    this.sessions = new Map();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/websocket') {
      const upgradeHeader = request.headers.get('Upgrade');
      if (upgradeHeader !== 'websocket') {
        return new Response('Expected websocket', { status: 400 });
      }

      const webSocketPair = new WebSocketPair();
      const [client, server] = Object.values(webSocketPair);

      server.accept();
      this.sessions.set(server, { connected: new Date() });

      server.addEventListener('close', () => {
        this.sessions.delete(server);
        this.broadcastStats();
      });

      this.broadcastStats();

      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === '/ingest' && request.method === 'POST') {
      const event = (await request.json()) as Record<string, any>;
      const enriched = {
        ...event,
        id: crypto.randomUUID(),
        receivedAt: new Date().toISOString(),
      };

      // Persist in DO storage
      const events = (await this.state.storage.get<any[]>('events')) || [];
      events.unshift(enriched);
      if (events.length > 1000) events.pop();
      await this.state.storage.put('events', events);

      // Broadcast to connected clients
      this.broadcast({ type: 'event', data: enriched });

      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/api/events' && request.method === 'GET') {
      const events = (await this.state.storage.get<any[]>('events')) || [];
      return new Response(JSON.stringify(events.slice(0, 100)), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404 });
  }

  broadcast(msg: any) {
    const message = JSON.stringify(msg);
    for (const [ws, _] of this.sessions) {
      try {
        ws.send(message);
      } catch {
        this.sessions.delete(ws);
      }
    }
  }

  broadcastStats() {
    this.broadcast({
      type: 'stats',
      connected: this.sessions.size,
    });
  }
}
