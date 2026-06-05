# GitHub Firehose

A live-updating event dashboard that ingests GitHub webhooks and broadcasts them to connected clients via WebSocket. Built on Cloudflare Workers with Durable Objects for state persistence.

## Architecture

```
GitHub Webhook ──► Cloudflare Worker ──► Durable Object
                                              │
                                              ├──► WebSocket broadcast
                                              ├──► Event history storage
                                              └──► REST API
```

- **Backend**: Cloudflare Worker + Durable Object
- **Web Dashboard**: React (served directly from the Worker or via Vite)
- **Mobile Dashboard**: React Native (iOS/Android)

## Project Structure

```
github-firehose/
├── backend/              # Cloudflare Worker API
│   ├── src/
│   │   ├── index.ts      # Main worker entry
│   │   └── firehose-do.ts # Durable Object for state + WebSocket
│   ├── wrangler.toml
│   └── package.json
├── web-dashboard/        # React web app
│   ├── src/
│   │   ├── App.tsx
│   │   └── main.tsx
│   └── vite.config.ts
├── mobile-dashboard/     # React Native app
│   └── App.tsx
└── README.md
```

## Quick Start (Backend)

### 1. Install dependencies

```bash
cd backend
npm install
```

### 2. Set up your GitHub webhook secret

```bash
wrangler secret put GITHUB_WEBHOOK_SECRET
```

Enter a secure random string (e.g., `openssl rand -hex 32`).

### 3. Deploy

```bash
npm run deploy
```

This will give you a URL like `https://github-firehose.your-account.workers.dev`.

### 4. Configure GitHub webhook

1. Go to any GitHub repo → Settings → Webhooks
2. Add webhook
3. Payload URL: `https://github-firehose.your-account.workers.dev/github-webhook`
4. Content type: `application/json`
5. Secret: the same secret you set in step 2
6. Select events: `Pushes`, `Pull requests`, `Issues` (or "Let me select individual events")
7. Save

### 5. Open the dashboard

Visit `https://github-firehose.your-account.workers.dev/` — the dashboard is built into the Worker.

## Web Dashboard (React)

The Worker serves a built-in HTML dashboard, but there's also a proper React app in `web-dashboard/`.

```bash
cd web-dashboard
npm install
npm run dev       # Local dev
npm run build     # Production build
```

To deploy the React app on Cloudflare:

- **Option A**: Use Cloudflare Pages (drag & drop the `dist/` folder, or use `wrangler pages deploy`)
- **Option B**: Use Cloudflare Workers with static assets (newer Workers feature)
- **Option C**: Just use the built-in dashboard served directly from the Worker

## Mobile Dashboard (React Native)

The React Native app connects to the same WebSocket endpoint.

### Setup

```bash
cd mobile-dashboard
npm install
# Update WS_URL and API_URL in App.tsx with your Worker URL
npx expo start
```

Scan the QR code with Expo Go (iOS/Android) to run.

### Deploying React Native

React Native apps are **not** deployable to Cloudflare Workers. They compile to native iOS/Android binaries. You'd need:
- Expo EAS Build (`eas build`)
- Or Xcode/Android Studio for manual builds

## Extending the Firehose

The architecture is designed for multiple event sources. Add new ingest endpoints:

```typescript
// In backend/src/index.ts
if (url.pathname === '/gitlab-webhook') {
  // validate GitLab signature
  await firehose.fetch(new Request('http://internal/ingest', {
    method: 'POST',
    body: JSON.stringify({ source: 'gitlab', type: 'push', payload })
  }));
  return new Response('OK');
}
```

The frontend automatically handles any `source`/`type` combination.

## Features

- [x] Real-time WebSocket broadcast
- [x] Event history persistence (last 1000 events)
- [x] REST API for historical events
- [x] GitHub webhook signature verification
- [x] CORS for cross-origin dashboard hosting
- [x] Auto-reconnecting WebSocket clients
- [x] Stats (total events, events/min, connection count)
- [x] Mobile-responsive design
- [x] Extensible ingest endpoint for future sources

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GITHUB_WEBHOOK_SECRET` | Secret to verify GitHub webhook signatures |

## Tech Stack

- **Runtime**: Cloudflare Workers
- **State**: Durable Objects
- **Protocol**: WebSocket + REST
- **Web**: React + Vite + TypeScript
- **Mobile**: React Native + Expo + TypeScript
