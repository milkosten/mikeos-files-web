# mikeos-files-web

**The MikeFiles Drive web UI — `https://files.osmike.com`.** Browse, upload, search,
and share the files in your MikeOS drive from any browser. "Think Google Drive",
backed by `mikeos-files-cloud` (**`files-api.osmike.com`**).

## Architecture

- **BFF (`server.js`)** — Express, port 8075. Signs the user in with MikeOS
  (`account.osmike.com`, OAuth 2.0 Auth-Code + PKCE, public client `files-web`),
  keeps tokens in **httpOnly cookie sessions** (persisted to `/data/sessions.json`
  so redeploys don't sign anyone out), and **streams** the browser's
  `/drive-api/*` calls to files-cloud with the Bearer attached server-side.
  (The prefix is `/drive-api`, not `/api` — on the bare host, Caddy routes
  `/api/*` straight to files-cloud as legacy compat, bypassing the BFF.) The
  browser never holds a JWT; there is no CORS anywhere.
- **SPA (`src/`)** — Vite + TypeScript, no framework. Folder tree, file table,
  drag-drop uploads with progress, rename/move/delete, search, the **share
  dialog** (grant by `name@osmike.com` + role, change role, revoke) and a
  **Shared with me** view driven by each file's `my_role`.

**MEMORY house rule:** the proxy streams both directions (duplex fetch up, pipe
down) — a 512 MB blob never sits in this process's RAM.

## Develop

```bash
npm install
npm run build     # tsc + vite build -> dist/
node server.js    # serves dist/ + BFF on :8075
npm run dev       # vite dev server proxying /auth + /api to :8075
```

## Deploy (242 host)

```bash
rsync -az --exclude node_modules --exclude dist . root@91.98.177.242:/opt/mikeos-files-web/
ssh root@91.98.177.242 'bash /opt/mikeos-files-web/deploy/deploy.sh'
```

`deploy/deploy.sh` is idempotent: builds the container on the `deploy_default`
network and rewrites the bare `files.osmike.com` Caddy block to
**UI + `/api/*` legacy compat** (old API clients keep working; humans get the
Drive). Requires `/opt/mikeos-files-web/.env` with `COOKIE_SECRET`.

The OAuth client is registered in the IdP by
`mikeos-account/migrations/034_files_web_client.sql`.
