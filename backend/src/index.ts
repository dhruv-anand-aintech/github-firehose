import { FirehoseDO } from './firehose-do';
export { FirehoseDO };

export interface Env {
  FIREHOSE: DurableObjectNamespace;
  GITHUB_WEBHOOK_SECRET: string;
}

async function verifyGitHubSignature(
  body: string,
  signature: string | null,
  secret: string
): Promise<boolean> {
  if (!signature) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  const expected = 'sha256=' + Array.from(new Uint8Array(signed))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return signature === expected;
}

function corsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GitHub Firehose</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f172a;
      color: #f8fafc;
      min-height: 100vh;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 20px;
      background: #1e293b;
      border-bottom: 1px solid #334155;
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .header h1 { font-size: 1.5rem; font-weight: 700; }
    .status {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 0.85rem;
      font-weight: 600;
      transition: background 0.3s;
    }
    .status.online { background: #22c55e; color: #fff; }
    .status.offline { background: #ef4444; color: #fff; }
    .status-dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: currentColor;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }
    .stat-card {
      background: #1e293b;
      padding: 16px;
      border-radius: 12px;
      border: 1px solid #334155;
    }
    .stat-card .label { font-size: 0.85rem; color: #94a3b8; margin-bottom: 4px; }
    .stat-card .value { font-size: 1.5rem; font-weight: 700; }
    .events {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .event {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 16px;
      transition: transform 0.2s, border-color 0.2s;
      animation: slideIn 0.3s ease-out;
    }
    .event:hover { transform: translateX(4px); border-color: #64748b; }
    @keyframes slideIn {
      from { opacity: 0; transform: translateY(-10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .event-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    .event-type {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
    }
    .event-type.push { background: #3b82f6; color: #fff; }
    .event-type.pull_request { background: #a855f7; color: #fff; }
    .event-type.issues { background: #f59e0b; color: #fff; }
    .event-type.default { background: #64748b; color: #fff; }
    .event-time { font-size: 0.8rem; color: #64748b; }
    .event-title { font-size: 1rem; font-weight: 600; margin-bottom: 4px; color: #e2e8f0; }
    .event-repo { font-size: 0.9rem; color: #94a3b8; }
    .event-author { font-size: 0.85rem; color: #64748b; margin-top: 8px; }
    .empty {
      text-align: center;
      padding: 60px 20px;
      color: #64748b;
    }
    .empty-icon { font-size: 3rem; margin-bottom: 12px; }
    .config {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 20px;
    }
    .config h2 { font-size: 1rem; margin-bottom: 12px; }
    .config code {
      display: block;
      background: #0f172a;
      padding: 12px;
      border-radius: 8px;
      font-size: 0.85rem;
      color: #94a3b8;
      overflow-x: auto;
      word-break: break-all;
    }
    .config .copy-btn {
      margin-top: 8px;
      padding: 6px 14px;
      background: #3b82f6;
      color: #fff;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.85rem;
    }
    @media (max-width: 600px) {
      .header { flex-direction: column; gap: 12px; align-items: flex-start; }
      .container { padding: 12px; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>GitHub Firehose</h1>
    <div class="status offline" id="status">
      <div class="status-dot"></div>
      <span id="statusText">Connecting...</span>
    </div>
  </div>
  <div class="container">
    <div class="config">
      <h2>Webhook URL</h2>
      <code id="webhookUrl">Loading...</code>
      <button class="copy-btn" onclick="copyWebhook()">Copy</button>
    </div>
    <div class="stats">
      <div class="stat-card">
        <div class="label">Total Events</div>
        <div class="value" id="totalEvents">0</div>
      </div>
      <div class="stat-card">
        <div class="label">Events/min</div>
        <div class="value" id="eventsPerMin">0</div>
      </div>
      <div class="stat-card">
        <div class="label">Connected</div>
        <div class="value" id="connectedCount">0</div>
      </div>
    </div>
    <div class="events" id="events">
      <div class="empty">
        <div class="empty-icon">📡</div>
        <div>Waiting for events... Set up your GitHub webhook to see commits flow in.</div>
      </div>
    </div>
  </div>
  <script>
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = protocol + '//' + location.host + '/websocket';
    const webhookUrl = location.origin + '/github-webhook';
    document.getElementById('webhookUrl').textContent = webhookUrl;

    function copyWebhook() {
      navigator.clipboard.writeText(webhookUrl);
      const btn = document.querySelector('.copy-btn');
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = 'Copy', 2000);
    }

    const eventsContainer = document.getElementById('events');
    const totalEl = document.getElementById('totalEvents');
    const epmEl = document.getElementById('eventsPerMin');
    const connectedEl = document.getElementById('connectedCount');
    const statusEl = document.getElementById('status');
    const statusTextEl = document.getElementById('statusText');
    let total = 0;
    let events = [];

    function renderEvent(event) {
      const div = document.createElement('div');
      div.className = 'event';
      const type = event.type || 'unknown';
      const typeClass = ['push', 'pull_request', 'issues'].includes(type) ? type : 'default';

      let title = 'Unknown event';
      let repo = 'unknown';
      let author = '';

      if (event.source === 'github') {
        if (type === 'push') {
          const commit = event.payload.head_commit;
          title = commit ? commit.message.split('\\n')[0] : 'Push to ' + (event.payload.ref || 'unknown');
          repo = event.payload.repository?.full_name || 'unknown';
          author = event.payload.pusher?.name || '';
        } else if (type === 'pull_request') {
          title = event.payload.pull_request?.title || 'PR event';
          repo = event.payload.repository?.full_name || 'unknown';
          author = event.payload.pull_request?.user?.login || '';
        } else if (type === 'issues') {
          title = event.payload.issue?.title || 'Issue event';
          repo = event.payload.repository?.full_name || 'unknown';
          author = event.payload.issue?.user?.login || '';
        } else {
          title = type + ': ' + (event.payload.repository?.full_name || 'unknown');
          repo = event.payload.repository?.full_name || 'unknown';
        }
      }

      div.innerHTML = \`
        <div class="event-header">
          <span class="event-type \${typeClass}">\${type}</span>
          <span class="event-time">\${new Date(event.receivedAt).toLocaleTimeString()}</span>
        </div>
        <div class="event-title">\${title}</div>
        <div class="event-repo">\${repo}</div>
        \${author ? \`<div class="event-author">by \${author}</div>\` : ''}
      \`;
      return div;
    }

    function connect() {
      const ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        statusEl.className = 'status online';
        statusTextEl.textContent = 'Live';
      };
      ws.onclose = () => {
        statusEl.className = 'status offline';
        statusTextEl.textContent = 'Reconnecting...';
        setTimeout(connect, 3000);
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'event') {
          const event = msg.data;
          total++;
          events.push({ time: Date.now() });
          events = events.filter(e => Date.now() - e.time < 60000);
          totalEl.textContent = total;
          epmEl.textContent = events.length;
          const empty = eventsContainer.querySelector('.empty');
          if (empty) empty.remove();
          eventsContainer.insertBefore(renderEvent(event), eventsContainer.firstChild);
          while (eventsContainer.children.length > 100) {
            eventsContainer.lastChild.remove();
          }
        } else if (msg.type === 'stats') {
          connectedEl.textContent = msg.connected || 0;
        }
      };
    }
    connect();
  </script>
</body>
</html>`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const id = env.FIREHOSE.idFromName('main');
    const firehose = env.FIREHOSE.get(id);

    // Built-in dashboard
    if (url.pathname === '/' || url.pathname === '/dashboard') {
      return new Response(DASHBOARD_HTML, {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // GitHub webhook
    if (url.pathname === '/github-webhook') {
      const signature = request.headers.get('x-hub-signature-256');
      const body = await request.text();

      if (!(await verifyGitHubSignature(body, signature, env.GITHUB_WEBHOOK_SECRET))) {
        return new Response('Unauthorized', { status: 401 });
      }

      const eventType = request.headers.get('x-github-event') || 'unknown';
      const payload = JSON.parse(body);

      await firehose.fetch(
        new Request('http://internal/ingest', {
          method: 'POST',
          body: JSON.stringify({
            source: 'github',
            type: eventType,
            payload,
          }),
        })
      );

      return new Response('OK', { headers: corsHeaders() });
    }

    // Generic ingest endpoint for future event sources
    if (url.pathname === '/ingest') {
      const body = await request.json();
      await firehose.fetch(
        new Request('http://internal/ingest', {
          method: 'POST',
          body: JSON.stringify(body),
        })
      );
      return new Response('OK', { headers: corsHeaders() });
    }

    // WebSocket endpoint
    if (url.pathname === '/websocket') {
      return firehose.fetch(request);
    }

    // REST API for recent events
    if (url.pathname === '/api/events') {
      const response = await firehose.fetch(
        new Request('http://internal/api/events')
      );
      return new Response(response.body, {
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404 });
  },
};
