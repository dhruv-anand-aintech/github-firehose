# GitHub Firehose

A compact Cloudflare Worker dashboard for GitHub webhooks. It verifies GitHub webhook signatures, stores recent events in Cloudflare KV, and serves a paginated dashboard from the same Worker.

## Features

- GitHub webhook signature verification
- Cloudflare KV persistence
- Paginated REST API, newest first
- Compact dashboard served by the Worker
- Client-side event display configuration with `localStorage`
- Coding-agent attribution from commit trailers and known agent markers
- Mobile-friendly event list
- Optional generic `/ingest` endpoint protected by the webhook secret

## Architecture

```text
GitHub webhook -> Cloudflare Worker -> Cloudflare KV
                                      |
                                      +-> dashboard
                                      +-> /api/events
```

## Setup

### 1. Install dependencies

```bash
cd backend
npm install
```

### 2. Create KV

```bash
npx wrangler kv namespace create FIREHOSE_KV
```

Copy the returned namespace id into `backend/wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "FIREHOSE_KV"
id = "your-kv-namespace-id"
```

### 3. Configure the Worker route

For a `workers.dev` deployment, remove the `routes` block and set:

```toml
workers_dev = true
```

For a custom domain on a Cloudflare-managed zone:

```toml
[[routes]]
pattern = "firehose.example.com"
custom_domain = true
```

### 4. Add the webhook secret

Generate a secret locally:

```bash
openssl rand -hex 32
```

Save it to Cloudflare:

```bash
npx wrangler secret put GITHUB_WEBHOOK_SECRET
```

Use the same value when creating the GitHub webhook. Do not commit it.

### 5. Deploy

```bash
npm run deploy
```

Open the deployed Worker URL. The dashboard shows the exact webhook URL:

```text
https://your-worker-host/github-webhook
```

## GitHub Webhook Setup

In a GitHub repository:

1. Open `Settings`.
2. Open `Webhooks`.
3. Click `Add webhook`.
4. Set `Payload URL` to `https://your-worker-host/github-webhook`.
5. Set `Content type` to `application/json`.
6. Set `Secret` to the same value stored in `GITHUB_WEBHOOK_SECRET`.
7. Choose the events you want GitHub to send, for example:
   - `Pushes`
   - `Pull requests`
   - `Issues`
8. Save the webhook.
9. Check `Recent Deliveries`; GitHub should show a `ping` delivery with HTTP `200`.

For an organization-level feed, create the webhook in organization settings instead of repository settings.

## Client-Side Display Config

The dashboard fetches paginated events from the Worker and filters display in the browser. The selected event types are stored in `localStorage` under:

```text
github-firehose-visible-types
```

This only changes what the current browser displays. It does not change which events GitHub sends or what the Worker stores. To change ingestion, update the GitHub webhook event selections.

## Coding-Agent Attribution

The dashboard marks commits that appear to have coding-agent coauthors. Detection is client-side and based on commit text in the webhook payload:

- `Co-authored-by:` trailers
- Agent names or email domains in trailers, including Claude, Cursor, Codex, OpenAI, Anthropic, and OpenCode
- Claude session links or generated-with-Claude markers

Example commit footer:

```text
Co-authored-by: Claude Sonnet <noreply@example.com>
```

If a match is found, the event row shows an `agent:` line.

## API

### `GET /api/events`

Query parameters:

- `page`: page number, default `1`
- `per_page`: page size, default `25`, max `100`

Response:

```json
{
  "events": [],
  "page": 1,
  "perPage": 25,
  "total": 0,
  "hasMore": false
}
```

### `POST /github-webhook`

GitHub webhook endpoint. Requires a valid `x-hub-signature-256` header.

### `POST /ingest`

Generic ingest endpoint for custom sources. Requires:

```text
Authorization: Bearer <GITHUB_WEBHOOK_SECRET>
```

## Privacy And Secrets

- Webhook secrets are stored with `wrangler secret put`, not in source control.
- GitHub webhook payloads can include repository names, author names, commit messages, issue titles, and pull request titles.
- Do not make the deployed dashboard public unless that event data is acceptable to expose.
- Cloudflare KV namespace ids are not secrets, but use your own namespace for your deployment.
- This repository intentionally does not include webhook secrets or personal access tokens.

## Development

```bash
cd backend
npm run dev
```

Run checks:

```bash
npx tsc --noEmit
```
