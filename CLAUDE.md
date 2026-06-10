# github-firehose

Cloudflare Worker dashboard for GitHub and deploy webhook activity. The backend verifies GitHub webhook signatures, ingests optional custom/deploy events, stores recent events in Cloudflare KV, exposes `/api/events` and `/live`, and serves a compact dashboard. Separate React/Vite dashboard packages provide web and mobile-focused clients.

## Commands

Discovered scripts, not verified in this pass:

- `cd backend && npm run dev` - run Wrangler dev for the Worker.
- `cd backend && npm run deploy` - deploy the Worker.
- `cd backend && npm run logs` - tail Worker logs.
- `cd backend && npx tsc --noEmit` - type-check Worker source.
- `cd web-dashboard && npm run dev` - Vite web dashboard; proxies `/api`, `/live`, and `/github-webhook` to `localhost:8787`.
- `cd web-dashboard && npm run build` - `tsc && vite build`.
- `cd mobile-dashboard && npm run dev` - Vite React Native Web dashboard; same local Worker proxy targets.
- `cd mobile-dashboard && npm run build` - Vite build for mobile dashboard.

## Important Paths

- `backend/src/index.ts` - Worker routes, webhook verification, KV persistence, dashboard/API/live handling, cron work.
- `backend/wrangler.toml` - Worker routes, cron triggers, vars, KV binding, and migrations.
- `web-dashboard/src/` - React web dashboard.
- `mobile-dashboard/src/` - React Native Web dashboard.
- `web-dashboard/vite.config.ts`, `mobile-dashboard/vite.config.ts` - local proxy setup to backend dev Worker.
- `README.md` - webhook setup, API shape, secret handling, and privacy notes.

## Gotchas

- Do not make real GitHub, Cloudflare, webhook, or deploy-notify calls during tests unless D explicitly asks.
- Secrets are set with `wrangler secret put`: `GITHUB_WEBHOOK_SECRET`, `CF_WEBHOOK_TOKEN`, and `GITHUB_TOKEN`; never commit them.
- `DASHBOARD_PIN` is currently a Worker var in `backend/wrangler.toml`.
- Backend routes use `github-firehose.ainorthstar.tech` and `firehose.ainorthstar.tech` with `custom_domain = true`.
- Frontend dev servers expect the backend Worker on `localhost:8787` for REST, WebSocket, and webhook proxying.
