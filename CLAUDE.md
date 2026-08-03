# mikeos-files-web — CLAUDE.md

The **MikeFiles Drive web UI** on the bare host `https://files.osmike.com`
(DNS rule: bare host = human UI; the API lives at `files-api.osmike.com`,
served by `mikeos-files-cloud`). See `README.md` for architecture; this file is
the working contract.

- **Stack:** Express BFF (`server.js`, port 8075, httpOnly cookie sessions,
  PKCE vs account.osmike.com, client_id `files-web`) + Vite/TS SPA (`src/`),
  no framework. Modeled on `mikeos-mail-web` (structure) + `mikeos-photos-web`
  (cookie-session auth).
- **Proxy prefix is `/drive-api/*`, NOT `/api/*`:** on the bare host, Caddy sends
  `/api/*` straight to files-cloud (legacy compat) — it never reaches this BFF.
  The SPA must only ever call `/drive-api/*` (see `src/lib/api.ts`).
- **MEMORY (existential here):** the `/drive-api/*` proxy must STREAM both directions —
  `Readable.toWeb(req)` with `duplex:"half"` up, `Readable.fromWeb(...).pipe(res)`
  down. Never buffer request/response bodies; blobs reach 512 MB.
- **Roles:** every file object from the API carries `my_role`
  (`owner|editor|commenter|viewer`). Gate UI actions on it (`drive.ts`), but the
  API is the enforcer — never rely on hiding a button.
- **Sharing endpoints:** `POST/GET /api/files/{id}/permissions`,
  `PATCH/DELETE .../permissions/{grant_id}`, `GET /api/files?shared_with_me=true`.
  `recipient_not_found` is deliberately ambiguous (anti-enumeration) — surface it
  as "no MikeOS account found", nothing more specific.
- **Deploy:** `deploy/deploy.sh` on the 242 box (`91.98.177.242`, ssh key
  `~/.ssh/mikeos_media`), container `mikeos-files-web` on `deploy_default`,
  fronted by shared Caddy (`/opt/mikephotos/deploy/Caddyfile`). The bare-host
  block keeps a `/api/*` compat handle to `mikeos-files:8000` until all legacy
  clients are on files-api.
- **Ecosystem source of truth:** `/home/mikeos/projects/mikeos-architecture/`
  (`ecosystem/README.md` hub; `docs/services/files.md` for this vertical).
