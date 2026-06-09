export interface Env {
  FIREHOSE_KV: KVNamespace;
  GITHUB_WEBHOOK_SECRET: string;
  DASHBOARD_PIN: string;
  CF_WEBHOOK_TOKEN: string;
  GITHUB_TOKEN: string;
  CF_API_TOKEN: string;   // for audit log polling
  CF_ACCOUNT_ID: string;
}

const EVENTS_KEY = 'events';
const MAX_EVENTS = 5000;
const AUTH_COOKIE = 'firehose_pin';

interface FirehoseEvent {
  id?: string;
  externalId?: string;
  source: string;
  type: string;
  receivedAt?: string;
  payload: Record<string, any>;
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

function pinValue(env: Env): string {
  return env.DASHBOARD_PIN || '4314';
}

function authCookieHeaders(pinned: boolean, secure: boolean): HeadersInit {
  return pinned
    ? {
        'Set-Cookie': `${AUTH_COOKIE}=1; Path=/; HttpOnly; SameSite=Lax;${secure ? ' Secure;' : ''} Max-Age=86400`,
      }
    : {
        'Set-Cookie': `${AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax;${secure ? ' Secure;' : ''} Max-Age=0`,
      };
}

function isAuthenticated(request: Request): boolean {
  const cookie = request.headers.get('cookie') || '';
  return cookie.split(';').some((part) => part.trim() === `${AUTH_COOKIE}=1`);
}

function pinGateHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Firehose</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { min-height: 100vh; display: grid; place-items: center; background: #111317; color: #f4f0e8; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    .gate { width: min(92vw, 360px); padding: 16px; background: #181b20; border: 1px solid #2a2f36; border-radius: 10px; }
    h1 { font-size: 1rem; margin-bottom: 10px; }
    p { color: #9aa3ad; font-size: 0.82rem; line-height: 1.5; margin-bottom: 12px; }
    form { display: grid; gap: 10px; }
    input { width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid #343b44; background: #0b0d10; color: #f4f0e8; font: inherit; letter-spacing: 0.2em; text-align: center; }
    button { padding: 10px 12px; border-radius: 8px; border: 0; background: #e2b84b; color: #15120a; font: inherit; font-weight: 800; cursor: pointer; }
    .error { min-height: 1.2em; color: #ff9b9b; font-size: 0.8rem; }
  </style>
</head>
<body>
  <div class="gate">
    <h1>Firehose</h1>
    <p>Enter the 4-digit pin to open the dashboard.</p>
    <form method="POST" action="/unlock">
      <input name="pin" inputmode="numeric" maxlength="4" autocomplete="one-time-code" aria-label="Pin" />
      <button type="submit">Unlock</button>
      <div class="error">${''}</div>
    </form>
  </div>
</body>
</html>`;
}

function eventTime(event: FirehoseEvent): number {
  return new Date(event.receivedAt || 0).getTime();
}

function cloudflareAuditAction(event: FirehoseEvent): string {
  return String(event.payload?.data?.audit_action || event.payload?.audit_action || '');
}

function isCloudflareDeployAuditNoise(event: FirehoseEvent): boolean {
  if (event.source !== 'cloudflare' || event.type !== 'deploy') return false;
  if (!String(event.externalId || '').startsWith('cf-audit-')) return false;
  return cloudflareAuditAction(event) !== 'script_deploy';
}

function eventDedupKeys(event: FirehoseEvent): string[] {
  const keys: string[] = [];
  if (event.externalId) keys.push(`external:${event.externalId}`);

  if (event.source === 'cloudflare' && event.type === 'deploy') {
    const data = event.payload?.data || {};
    const script = String(data.script_name || event.payload?.worker || '').trim();
    const version = String(data.version_id || event.payload?.version_id || '').trim();
    if (script && version) keys.push(`cf-version:${script}:${version}`);
  }

  if (event.id) keys.push(`id:${event.id}`);
  return keys;
}

function compactEvents(events: FirehoseEvent[]): FirehoseEvent[] {
  const seen = new Set<string>();
  const compacted: FirehoseEvent[] = [];

  for (const event of [...events].sort((a, b) => eventTime(b) - eventTime(a))) {
    if (isCloudflareDeployAuditNoise(event)) continue;

    const keys = eventDedupKeys(event);
    if (keys.some((key) => seen.has(key))) continue;

    keys.forEach((key) => seen.add(key));
    compacted.push(event);
  }

  return compacted;
}

async function readEvents(env: Env): Promise<FirehoseEvent[]> {
  return (await env.FIREHOSE_KV.get<FirehoseEvent[]>(EVENTS_KEY, 'json')) || [];
}

async function storeEvent(env: Env, event: FirehoseEvent): Promise<FirehoseEvent> {
  const enriched = {
    ...event,
    id: event.id || crypto.randomUUID(),
    receivedAt: event.receivedAt || new Date().toISOString(),
  };
  const events = compactEvents(await readEvents(env));
  const enrichedKeys = eventDedupKeys(enriched);
  const deduped = events.filter((item) => {
    const itemKeys = eventDedupKeys(item);
    return !itemKeys.some((key) => enrichedKeys.includes(key));
  });
  deduped.push(enriched);
  deduped.sort((a, b) => eventTime(b) - eventTime(a));
  await env.FIREHOSE_KV.put(EVENTS_KEY, JSON.stringify(deduped.slice(0, MAX_EVENTS)));
  return enriched;
}

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Firehose</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; background: #111317; color: #f4f0e8; min-height: 100vh; }
    .header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; background: #181b20; border-bottom: 1px solid #2a2f36; position: sticky; top: 0; z-index: 10; }
    .header h1 { font-size: 1rem; font-weight: 700; letter-spacing: 0; }
    .status { display: flex; align-items: center; gap: 8px; padding: 4px 9px; border-radius: 6px; font-size: 0.75rem; font-weight: 700; background: #12392f; color: #b7f7d3; border: 1px solid #1f6f55; }
    .status-dot { width: 6px; height: 6px; border-radius: 50%; background: #41d98b; }
    .container { max-width: 1120px; margin: 0 auto; padding: 12px; }
    .topbar { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; margin-bottom: 10px; }
    .client-config { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 10px; padding: 8px 10px; background: #181b20; border: 1px solid #2a2f36; border-radius: 6px; }
    .client-config-label { color: #9aa3ad; font-size: 0.72rem; font-weight: 800; text-transform: uppercase; }
    .filter-chip { display: inline-flex; align-items: center; gap: 5px; color: #dbe2ea; font-size: 0.74rem; padding: 4px 7px; border: 1px solid #343b44; border-radius: 5px; background: #111317; cursor: pointer; }
    .filter-chip input { accent-color: #e2b84b; }
    .stats { display: grid; grid-template-columns: repeat(3, minmax(96px, 1fr)); gap: 8px; }
    .stat-card, .config { background: #181b20; padding: 10px; border-radius: 6px; border: 1px solid #2a2f36; }
    .stat-card .label { font-size: 0.68rem; color: #9aa3ad; margin-bottom: 2px; text-transform: uppercase; }
    .stat-card .value { font-size: 1.15rem; font-weight: 800; color: #f8d66d; }
    .config h2 { font-size: 0.72rem; margin-bottom: 6px; color: #9aa3ad; text-transform: uppercase; }
    .config code { display: block; background: #0b0d10; padding: 8px; border-radius: 5px; font-size: 0.74rem; color: #c4cad2; overflow-x: auto; word-break: break-all; border: 1px solid #252a31; }
    .copy-btn, .pager button { margin-top: 7px; padding: 6px 10px; background: #e2b84b; color: #15120a; border: none; border-radius: 5px; cursor: pointer; font-size: 0.78rem; font-weight: 800; }
    .copy-btn:disabled, .pager button:disabled { opacity: 0.45; cursor: not-allowed; }
    .events { display: grid; gap: 6px; }
    .event { display: grid; grid-template-columns: 102px minmax(0, 1fr) minmax(120px, 172px); gap: 10px; align-items: center; background: #181b20; border: 1px solid #2a2f36; border-left: 3px solid #4f5b66; border-radius: 6px; padding: 8px 10px; }
    .event-header { display: flex; align-items: center; min-width: 0; }
    .event-type { display: inline-flex; align-items: center; justify-content: center; width: 92px; padding: 4px 6px; border-radius: 4px; font-size: 0.68rem; font-weight: 800; text-transform: uppercase; background: #4f5b66; color: #fff; }
    .event-type.push { background: #2b66c3; }
    .event-type.commit { background: #16835a; }
    .event-type.pull_request { background: #8b54cb; }
    .event-type.issues { background: #bb7b16; }
    .event-type.deploy { background: #e05a2b; }
    .event-type.cloudflare { background: #e05a2b; }
    .event-time { font-size: 0.72rem; color: #9aa3ad; text-align: right; overflow-wrap: anywhere; }
    .event-title { font-size: 0.88rem; font-weight: 700; color: #f4f0e8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .event-repo { font-size: 0.75rem; color: #9aa3ad; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .event-author { font-size: 0.72rem; color: #d0a84b; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .event-agent { font-size: 0.72rem; color: #8fd6ff; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .event-origin { font-size: 0.7rem; color: #7f8a96; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .empty { text-align: center; padding: 28px 16px; color: #9aa3ad; border: 1px dashed #3a414a; border-radius: 6px; }
    .pager { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 10px; color: #9aa3ad; font-size: 0.82rem; }
    @media (max-width: 760px) { .topbar { grid-template-columns: 1fr; } .event { grid-template-columns: 88px minmax(0, 1fr); } .event-time { grid-column: 1 / -1; text-align: left; white-space: normal; } .event-type { width: 78px; } }
    @media (max-width: 520px) { .header { align-items: flex-start; } .stats { grid-template-columns: repeat(3, 1fr); } .stat-card .value { font-size: 0.96rem; } .pager { flex-direction: column; align-items: stretch; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>Firehose</h1>
    <div class="status"><div class="status-dot"></div><span>KV persisted</span></div>
  </div>
  <div class="container">
    <div class="topbar">
      <div class="config">
        <h2>Webhook URL</h2>
        <code id="webhookUrl">Loading...</code>
        <button class="copy-btn" onclick="copyWebhook()">Copy</button>
      </div>
      <div class="stats">
        <div class="stat-card"><div class="label">Total</div><div class="value" id="totalEvents">0</div></div>
        <div class="stat-card"><div class="label">Page</div><div class="value" id="pageValue">1</div></div>
        <div class="stat-card"><div class="label">Visible</div><div class="value" id="visibleEvents">0</div></div>
      </div>
    </div>
    <div class="client-config">
      <span class="client-config-label">Display</span>
      <label class="filter-chip"><input type="checkbox" value="push"> Push</label>
      <label class="filter-chip"><input type="checkbox" value="pull_request"> PR</label>
      <label class="filter-chip"><input type="checkbox" value="issues"> Issues</label>
      <label class="filter-chip"><input type="checkbox" value="commit"> Commit</label>
      <label class="filter-chip"><input type="checkbox" value="deploy"> Deploy</label>
      <label class="filter-chip"><input type="checkbox" value="create"> Create</label>
      <label class="filter-chip"><input type="checkbox" value="ping"> Ping</label>
      <label class="filter-chip"><input type="checkbox" value="cloudflare"> Cloudflare</label>
    </div>
    <div class="events" id="events"></div>
    <div class="pager">
      <button id="prevBtn" onclick="loadPage(page - 1)">Previous</button>
      <span id="pageInfo">Page 1</span>
      <button id="nextBtn" onclick="loadPage(page + 1)">Next</button>
    </div>
  </div>
  <script>
    const webhookUrl = location.origin + '/github-webhook';
    document.getElementById('webhookUrl').textContent = webhookUrl;
    const eventsContainer = document.getElementById('events');
    const totalEl = document.getElementById('totalEvents');
    const pageEl = document.getElementById('pageValue');
    const visibleEl = document.getElementById('visibleEvents');
    const pageInfoEl = document.getElementById('pageInfo');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const filterInputs = Array.from(document.querySelectorAll('.filter-chip input'));
    const configKey = 'github-firehose-visible-types';
    const defaultVisibleTypes = ['push', 'pull_request', 'issues', 'commit', 'deploy', 'ping', 'create', 'delete', 'cloudflare'];
    let page = 1;
    const perPage = 25;
    let lastPageData = null;

    function readVisibleTypes() {
      try {
        const saved = JSON.parse(localStorage.getItem(configKey) || 'null');
        return Array.isArray(saved) && saved.length > 0 ? saved : defaultVisibleTypes;
      } catch {
        return defaultVisibleTypes;
      }
    }

    function writeVisibleTypes(types) {
      localStorage.setItem(configKey, JSON.stringify(types));
    }

    function syncFilterInputs() {
      const visibleTypes = new Set(readVisibleTypes());
      filterInputs.forEach((input) => {
        input.checked = visibleTypes.has(input.value);
      });
    }

    function selectedTypes() {
      return new Set(filterInputs.filter((input) => input.checked).map((input) => input.value));
    }

    function commitText(event) {
      return [
        event.payload?.head_commit?.message,
        event.payload?.commit?.message,
        ...(event.payload?.commits || []).map((commit) => commit.message),
      ].filter(Boolean).join('\\n');
    }

    function codingAgents(event) {
      const text = commitText(event);
      const agents = new Set();
      const trailerPattern = /^co-authored-by:\\s*([^<\\n]+)(?:<([^>]+)>)?/gim;
      let match;
      while ((match = trailerPattern.exec(text)) !== null) {
        const name = match[1].trim();
        const email = (match[2] || '').toLowerCase();
        if (/claude|anthropic/i.test(name) || email.includes('anthropic')) agents.add(name);
        if (/codex|openai/i.test(name) || email.includes('openai')) agents.add(name);
        if (/cursor/i.test(name) || email.includes('cursor')) agents.add(name);
        if (/opencode/i.test(name)) agents.add(name);
      }
      if (/claude\\.ai\\/code|generated with claude|anthropic/i.test(text)) agents.add('Claude');
      if (/cursoragent@cursor\\.com/i.test(text)) agents.add('Cursor');
      if (/noreply@openai\\.com/i.test(text)) agents.add('Codex');
      return Array.from(agents);
    }

    function copyWebhook() {
      navigator.clipboard.writeText(webhookUrl);
      const btn = document.querySelector('.copy-btn');
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = 'Copy', 2000);
    }

    function renderEvent(event) {
      const div = document.createElement('div');
      div.className = 'event';
      const type = event.type || 'unknown';
      const typeClass = ['push', 'commit', 'pull_request', 'issues', 'deploy', 'cloudflare'].includes(type) ? type : '';
      let title = type + ' event';
      let repo = event.payload?.repository?.full_name || event.payload?.repo || 'unknown';
      let author = event.payload?.sender?.login || '';
      let origin = event.payload?.origin || {};

      if (event.source === 'github') {
        if (type === 'push') {
          const commit = event.payload.head_commit;
          title = commit ? commit.message.split('\\n')[0] : 'Push to ' + (event.payload.ref || 'unknown');
          author = event.payload.pusher?.name || author;
        } else if (type === 'commit') {
          title = event.payload.commit?.message?.split('\\n')[0] || event.payload.message || 'Commit';
          repo = event.payload.repository?.full_name || repo;
          author = event.payload.commit?.author?.name || event.payload.author?.login || author;
        } else if (type === 'pull_request') {
          title = event.payload.pull_request?.title || 'PR event';
          author = event.payload.pull_request?.user?.login || author;
        } else if (type === 'issues') {
          title = event.payload.issue?.title || 'Issue event';
          author = event.payload.issue?.user?.login || author;
        }
      } else if (event.source === 'cloudflare') {
        const d = event.payload?.data || {};
        const ok = d.success !== false;
        title = (ok ? '✓ ' : '✗ ') + (d.script_name || event.payload?.name || 'Cloudflare deploy');
        repo = d.deploy_url
          ? '<a href="' + d.deploy_url + '" target="_blank" style="color:#1a0dab">' + d.deploy_url.replace(/^https?:\\/\\//, '') + '</a>'
          : (d.script_name || 'cloudflare');
        author = [
          d.version_id ? 'v ' + d.version_id.slice(0, 8) : '',
          d.duration_ms ? (d.duration_ms / 1000).toFixed(1) + 's' : '',
          d.actor || '',
        ].filter(Boolean).join(' · ');
      }

      const originText = [origin.device || event.payload?.delivery_source || 'GitHub remote', origin.location || 'location unknown'].join(' / ');
      const agents = codingAgents(event);
      div.innerHTML = '<div class="event-header"><span class="event-type ' + typeClass + '">' + type + '</span></div><div><div class="event-title"></div><div class="event-repo"></div>' + (author ? '<div class="event-author"></div>' : '') + (agents.length ? '<div class="event-agent"></div>' : '') + '<div class="event-origin"></div></div><span class="event-time">' + new Date(event.receivedAt).toLocaleString() + '</span>';
      div.querySelector('.event-title').textContent = title;
      const repoEl = div.querySelector('.event-repo');
      if (repo.startsWith('<a ')) { repoEl.innerHTML = repo; } else { repoEl.textContent = repo; }
      const authorEl = div.querySelector('.event-author');
      if (authorEl) authorEl.textContent = 'by ' + author;
      const agentEl = div.querySelector('.event-agent');
      if (agentEl) agentEl.textContent = 'agent: ' + agents.join(', ');
      div.querySelector('.event-origin').textContent = originText;
      return div;
    }

    function renderPageData(data) {
      eventsContainer.innerHTML = '';
      if (data.events.length === 0) {
        eventsContainer.innerHTML = '<div class="empty"><div>No events match the current filter on this page.</div></div>';
      } else {
        data.events.forEach((event) => eventsContainer.appendChild(renderEvent(event)));
      }
      totalEl.textContent = data.total;
      pageEl.textContent = data.page;
      visibleEl.textContent = data.events.length;
      pageInfoEl.textContent = 'Page ' + data.page + ' of ' + Math.max(1, Math.ceil(data.total / data.perPage));
      prevBtn.disabled = data.page <= 1;
      nextBtn.disabled = !data.hasMore;
    }

    async function loadPage(nextPage) {
      if (nextPage < 1) return;
      const types = Array.from(selectedTypes()).join(',');
      const res = await fetch('/api/events?page=' + nextPage + '&per_page=' + perPage + '&types=' + encodeURIComponent(types));
      const data = await res.json();
      page = data.page;
      lastPageData = data;
      renderPageData(data);
    }

    syncFilterInputs();
    filterInputs.forEach((input) => {
      input.addEventListener('change', () => {
        writeVisibleTypes(Array.from(selectedTypes()));
        loadPage(1);
      });
    });
    loadPage(1);
    setInterval(() => {
      if (page === 1) loadPage(1);
    }, 10000);
  </script>
</body>
</html>`;

const FIREHOSE_URL = 'https://firehose.ainorthstar.tech/github-webhook';
const CF_LAST_AUDIT_KEY = 'cf_audit_last_since';

async function syncCloudflareDeployEvents(env: Env): Promise<void> {
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) return;
  const since = (await env.FIREHOSE_KV.get(CF_LAST_AUDIT_KEY)) || new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({ since, action_type: 'workers.script.update', per_page: '100' });
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/audit_logs?${params}`, {
    headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) return;
  const data = await res.json() as { result: Array<{ id: string; when: string; action: { type: string; result: string }; target?: { id: string; name: string }; actor?: { email: string } }>, success: boolean };
  if (!data.success || !data.result?.length) return;
  for (const entry of data.result) {
    if (entry.action.type !== 'script_deploy') continue;
    await storeEvent(env, {
      source: 'cloudflare',
      type: 'deploy',
      externalId: `cf-audit-${entry.id}`,
      receivedAt: entry.when,
      payload: {
        name: `Worker deployed: ${entry.target?.name || entry.target?.id || 'unknown'}`,
        text: `${entry.action.type} → ${entry.action.result}`,
        data: {
          script_name: entry.target?.name || entry.target?.id,
          account_id: env.CF_ACCOUNT_ID,
          actor: entry.actor?.email,
          audit_action: entry.action.type,
          result: entry.action.result,
        },
      },
    });
  }
  await env.FIREHOSE_KV.put(CF_LAST_AUDIT_KEY, new Date().toISOString());
}

async function syncGithubWebhooks(env: Env): Promise<void> {
  if (!env.GITHUB_TOKEN || !env.GITHUB_WEBHOOK_SECRET) return;
  const headers = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'firehose-worker/1.0',
  };
  // Fetch all repos
  let page = 1;
  const allRepos: string[] = [];
  while (true) {
    const res = await fetch(`https://api.github.com/user/repos?per_page=100&page=${page}&type=owner`, { headers });
    if (!res.ok) break;
    const repos = await res.json() as Array<{ full_name: string }>;
    if (!repos.length) break;
    allRepos.push(...repos.map(r => r.full_name));
    if (repos.length < 100) break;
    page++;
  }
  // For each repo, ensure our webhook is registered
  for (const fullName of allRepos) {
    const hooksRes = await fetch(`https://api.github.com/repos/${fullName}/hooks`, { headers });
    if (!hooksRes.ok) continue;
    const hooks = await hooksRes.json() as Array<{ config: { url: string } }>;
    if (hooks.some(h => h.config?.url === FIREHOSE_URL)) continue;
    // Register
    await fetch(`https://api.github.com/repos/${fullName}/hooks`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: { url: FIREHOSE_URL, content_type: 'json', secret: env.GITHUB_WEBHOOK_SECRET },
        events: ['push', 'pull_request', 'issues', 'create'],
        active: true,
      }),
    });
  }
}

export default {
  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    // "*/5 * * * *" fires every 5 min — only sync CF deploys
    // "0 * * * *" fires hourly — also sync GitHub webhooks
    await syncCloudflareDeployEvents(env);
    if (event.cron === '0 * * * *') {
      await syncGithubWebhooks(env);
    }
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const authenticated = isAuthenticated(request);
    const secureCookie = url.protocol === 'https:';

    if (url.pathname === '/unlock' && request.method === 'POST') {
      const form = await request.formData();
      const pin = String(form.get('pin') || '').trim();
      if (pin === pinValue(env)) {
        return new Response(null, {
          status: 302,
          headers: {
            ...authCookieHeaders(true, secureCookie),
            Location: '/',
            'Cache-Control': 'no-store',
          },
        });
      }
      return new Response(pinGateHtml(), {
        status: 401,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          ...authCookieHeaders(false, secureCookie),
          'Cache-Control': 'no-store',
        },
      });
    }

    if (url.pathname === '/' || url.pathname === '/dashboard') {
      if (!authenticated) {
        return new Response(pinGateHtml(), {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        });
      }
      return new Response(DASHBOARD_HTML, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }

    if (url.pathname === '/github-webhook') {
      const signature = request.headers.get('x-hub-signature-256');
      const body = await request.text();

      if (!(await verifyGitHubSignature(body, signature, env.GITHUB_WEBHOOK_SECRET))) {
        return new Response('Unauthorized', { status: 401 });
      }

      const eventType = request.headers.get('x-github-event') || 'unknown';
      const payload = JSON.parse(body);
      await storeEvent(env, {
        source: 'github',
        type: eventType,
        receivedAt: payload.head_commit?.timestamp || new Date().toISOString(),
        payload: {
          ...payload,
          origin: {
            device: 'GitHub webhook',
            location: 'unknown',
          },
        },
      });

      return new Response('OK', { headers: corsHeaders() });
    }

    if (url.pathname === '/ingest' && request.method === 'POST') {
      if (request.headers.get('authorization') !== `Bearer ${env.GITHUB_WEBHOOK_SECRET}`) {
        return new Response('Unauthorized', { status: 401 });
      }
      const body = (await request.json()) as FirehoseEvent;
      await storeEvent(env, body);
      return new Response('OK', { headers: corsHeaders() });
    }

    // Manual trigger for cron sync (authenticated)
    if (url.pathname === '/sync' && request.method === 'POST' && authenticated) {
      await Promise.all([syncGithubWebhooks(env), syncCloudflareDeployEvents(env)]);
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders(), 'Content-Type': 'application/json' } });
    }

    if (url.pathname === '/deploy-notify' && request.method === 'POST') {
      const body = await request.json() as Record<string, any>;
      const pin = String(body.pin || '').trim();
      if (pin !== pinValue(env)) {
        return new Response('Unauthorized', { status: 401 });
      }
      const worker = String(body.worker || 'unknown');
      const deployUrl = String(body.url || '');
      const versionId = String(body.version_id || '');
      const success = body.success !== false;
      const durationMs = Number(body.duration_ms || 0);
      await storeEvent(env, {
        source: 'cloudflare',
        type: 'deploy',
        externalId: versionId ? `cf-deploy-${worker}-${versionId}` : undefined,
        receivedAt: new Date().toISOString(),
        payload: {
          name: `${success ? '✓' : '✗'} ${worker}`,
          data: {
            script_name: worker,
            actor: 'wrangler-cli',
            deploy_url: deployUrl,
            version_id: versionId,
            success,
            duration_ms: durationMs,
          },
        },
      });
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders(), 'Content-Type': 'application/json' } });
    }

    if (url.pathname === '/cloudflare-webhook' && request.method === 'POST') {
      const token = request.headers.get('cf-webhook-auth');
      if (!env.CF_WEBHOOK_TOKEN || token !== env.CF_WEBHOOK_TOKEN) {
        return new Response('Unauthorized', { status: 401 });
      }
      const payload = await request.json() as Record<string, any>;
      const data = payload.data || {};
      const versionId = String(data.version_id || payload.version_id || '');
      const scriptName = String(data.script_name || payload.worker || payload.name || '');
      await storeEvent(env, {
        source: 'cloudflare',
        type: 'deploy',
        externalId: versionId && scriptName ? `cf-deploy-${scriptName}-${versionId}` : String(payload.id || payload.notification_id || ''),
        receivedAt: new Date().toISOString(),
        payload,
      });
      return new Response('OK', { headers: corsHeaders() });
    }

    if (url.pathname === '/api/events') {
      if (!authenticated) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        });
      }
      const page = Math.max(1, Number(url.searchParams.get('page') || '1'));
      const perPage = Math.min(100, Math.max(1, Number(url.searchParams.get('per_page') || '25')));
      const typesParam = url.searchParams.get('types');
      const typeFilter = typesParam ? new Set(typesParam.split(',').map(t => t.trim()).filter(Boolean)) : null;
      let events = compactEvents(await readEvents(env));
      if (typeFilter && typeFilter.size > 0) {
        events = events.filter(e => typeFilter.has(e.type || 'unknown'));
      }
      const start = (page - 1) * perPage;
      return new Response(JSON.stringify({
        events: events.slice(start, start + perPage),
        page,
        perPage,
        total: events.length,
        hasMore: start + perPage < events.length,
      }), {
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404 });
  },
};
