// MikeFiles Drive web (files.osmike.com) — the human-facing MikeOS drive UI.
// Signs the user in via account.osmike.com (OAuth Auth-Code + PKCE, BFF pattern),
// then proxies the browser's /api/* calls to files-api (mikeos-files-cloud) with
// the user's Bearer attached SERVER-side. The browser never holds a JWT
// (httpOnly session cookie only) -> no CORS, no XSS token surface. Auth flow
// copied from mikeos-photos-web; sessions persist to /data (office-web pattern)
// so a redeploy doesn't sign everyone out.
//
// MEMORY HOUSE RULE: this is a DRIVE — files up to MAX_FILE_MB (512 MB) pass
// through here. The /api/* proxy STREAMS both directions (request body via
// duplex fetch, response via pipe); it never buffers a blob in RAM.
import express from "express";
import cookieParser from "cookie-parser";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = join(__dirname, "dist");

const {
  PORT = 8075,
  ISSUER = "https://account.osmike.com",
  CLIENT_ID = "files-web",
  // Internal container address of files-cloud on the shared deploy network.
  FILES_API = "http://mikeos-files:8000",
  COOKIE_SECRET = crypto.randomBytes(24).toString("hex"),
  SESSIONS_FILE = "", // e.g. /data/sessions.json — set in prod so sessions survive redeploys
} = process.env;

const app = express();
app.set("trust proxy", true);
app.use(cookieParser(COOKIE_SECRET));

// ---- sessions (sid -> {access_token, refresh_token, expires_at, user}) ------
const sessions = new Map();
if (SESSIONS_FILE) {
  try {
    for (const [k, v] of Object.entries(JSON.parse(readFileSync(SESSIONS_FILE, "utf8"))))
      sessions.set(k, v);
    console.log(`[files-web] restored ${sessions.size} session(s)`);
  } catch { /* first boot */ }
}
let persistTimer = null;
function persistSessions() {
  if (!SESSIONS_FILE || persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      mkdirSync(dirname(SESSIONS_FILE), { recursive: true });
      writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(sessions)));
    } catch (e) { console.warn("session persist failed:", e.message); }
  }, 1000);
}

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const decodeJwt = (jwt) => { try { return JSON.parse(Buffer.from(jwt.split(".")[1], "base64").toString("utf8")); } catch { return {}; } };
const cookieOpts = { httpOnly: true, secure: true, sameSite: "lax", signed: true };
const sessionOf = (req) => sessions.get(req.signedCookies.sid);
const redirectUriFor = (req) => `https://${req.hostname}/auth/callback`;

// ---- OAuth (Auth Code + PKCE / S256) ----------------------------------------
app.get("/auth/login", (req, res) => {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  res.cookie("pkce", verifier, { ...cookieOpts, maxAge: 10 * 60_000 });
  res.cookie("ostate", state, { ...cookieOpts, maxAge: 10 * 60_000 });
  const u = new URL(`${ISSUER}/oauth/authorize`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", CLIENT_ID);
  u.searchParams.set("redirect_uri", redirectUriFor(req));
  u.searchParams.set("scope", "openid profile email");
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  res.redirect(u.toString());
});

app.get("/auth/callback", async (req, res) => {
  const { code, state } = req.query;
  const verifier = req.signedCookies.pkce;
  if (!code || !state || state !== req.signedCookies.ostate || !verifier)
    return res.status(400).send('Auth state mismatch — <a href="/">back</a>');
  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code", code, code_verifier: verifier,
      client_id: CLIENT_ID, redirect_uri: redirectUriFor(req),
    });
    const r = await fetch(`${ISSUER}/oauth/token`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
    });
    if (!r.ok) { console.warn("token exchange failed", r.status); return res.status(502).send('Sign-in failed — <a href="/">back</a>'); }
    const tok = await r.json();
    const claims = decodeJwt(tok.id_token || tok.access_token || "");
    const user = { sub: claims.sub, email: claims.email, name: claims.name || claims.preferred_username };
    if ((!user.email || !user.name) && tok.access_token) {
      try {
        const ui = await fetch(`${ISSUER}/oauth/userinfo`, { headers: { Authorization: `Bearer ${tok.access_token}` } });
        if (ui.ok) { const info = await ui.json(); user.sub ||= info.sub; user.email ||= info.email; user.name ||= info.name || info.preferred_username || info.email; }
      } catch { /* best-effort */ }
    }
    if (!user.name) user.name = user.email || "MikeOS user";
    const sid = b64url(crypto.randomBytes(24));
    sessions.set(sid, {
      access_token: tok.access_token, refresh_token: tok.refresh_token,
      expires_at: Date.now() + (tok.expires_in || 3600) * 1000, user,
    });
    persistSessions();
    res.clearCookie("pkce", cookieOpts); res.clearCookie("ostate", cookieOpts);
    res.cookie("sid", sid, { ...cookieOpts, maxAge: 30 * 24 * 60 * 60_000 });
    res.redirect("/");
  } catch (e) { console.warn("callback error", e); res.status(502).send('Sign-in error — <a href="/">back</a>'); }
});

app.post("/auth/logout", (req, res) => {
  const sid = req.signedCookies.sid;
  if (sid) { sessions.delete(sid); persistSessions(); }
  res.clearCookie("sid", cookieOpts);
  res.json({ ok: true });
});

app.get("/auth/me", (req, res) => {
  const s = sessionOf(req);
  res.json(s ? { authenticated: true, user: s.user } : { authenticated: false });
});

async function accessTokenFor(req) {
  const s = sessionOf(req); if (!s) return null;
  if (Date.now() < s.expires_at - 60_000) return s.access_token;
  if (!s.refresh_token) return s.access_token;
  try {
    const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: s.refresh_token, client_id: CLIENT_ID });
    const r = await fetch(`${ISSUER}/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    if (r.ok) {
      const t = await r.json();
      s.access_token = t.access_token || s.access_token;
      if (t.refresh_token) s.refresh_token = t.refresh_token;
      s.expires_at = Date.now() + (t.expires_in || 3600) * 1000;
      persistSessions();
    }
  } catch (e) { console.warn("refresh", e.message); }
  return s.access_token;
}

// ---- Streaming proxy: browser /drive-api/* -> files-api /api/* --------------
// The SPA's prefix is /drive-api (NOT /api): on the bare files.osmike.com host,
// Caddy routes /api/* STRAIGHT to files-cloud as legacy compat for old API
// clients — it never reaches this BFF. /drive-api falls through Caddy's default
// handle to us; we swap the prefix and attach the session's Bearer. Upload
// bodies stream up (duplex fetch), downloads stream down (pipe) — a 512 MB blob
// never sits in this process's RAM. Range / conditional headers pass through so
// media seeking and If-Match conflict detection work end-to-end.
app.all(/^\/drive-api\/.*/, async (req, res) => {
  const s = sessionOf(req);
  if (!s) return res.status(401).json({ error: "not_authenticated" });
  const tok = await accessTokenFor(req);
  const headers = { Authorization: `Bearer ${tok}` };
  for (const h of ["content-type", "content-length", "accept", "range", "if-match", "if-none-match"]) {
    if (req.headers[h]) headers[h] = req.headers[h];
  }
  const method = req.method.toUpperCase();
  const init = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    init.body = Readable.toWeb(req);
    init.duplex = "half";
  }
  try {
    const r = await fetch(FILES_API + req.originalUrl.replace(/^\/drive-api/, "/api"), init);
    res.status(r.status);
    for (const h of ["content-type", "content-length", "content-range", "accept-ranges",
                     "cache-control", "etag", "content-disposition"]) {
      const v = r.headers.get(h); if (v) res.setHeader(h, v);
    }
    if (r.body) Readable.fromWeb(r.body).pipe(res); else res.end();
  } catch (e) {
    console.warn("proxy", req.originalUrl, e.message);
    if (!res.headersSent) res.status(502).json({ error: "files_api_unreachable" });
  }
});

app.get("/healthz", (_req, res) => res.json({ ok: true, api: FILES_API }));

// Static SPA (long cache for hashed assets) + fallback for client routes.
app.use(express.static(dist, {
  setHeaders(res, path) {
    if (path.includes("/assets/")) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  },
}));
app.get(/^(?!\/drive-api\/|\/auth\/).*/, (_req, res) => res.sendFile(join(dist, "index.html")));

app.listen(PORT, () => console.log(`[mikeos-files-web] drive on :${PORT} (client ${CLIENT_ID}, api ${FILES_API})`));
