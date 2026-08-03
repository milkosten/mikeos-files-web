// Same-origin API client. All calls ride the httpOnly session cookie; the BFF
// (server.js) attaches the Bearer and streams to files-api. No token in JS.
//
// Prefix is /drive-api (NOT /api): on files.osmike.com, Caddy routes /api/*
// straight to files-cloud as legacy compat for old API clients — it bypasses
// the BFF, so cookie auth would never be applied there.

const API = "/drive-api";

export interface DriveFile {
  id: string;
  name: string;
  mime: string | null;
  size: number | null;
  sha256: string | null;
  folder_id: string | null;
  tags: unknown;
  created_at: string | null;
  updated_at: string | null;
  my_role: "owner" | "editor" | "commenter" | "viewer";
  owner?: { user_id: string; username?: string; display_name?: string };
}

export interface Folder {
  id: string;
  name: string;
  parent_id: string | null;
  my_role?: "owner" | "editor" | "commenter" | "viewer";
}

export interface Version {
  version_no: number;
  size: number | null;
  sha256: string | null;
  mime: string | null;
  created_at: string | null;
}

export interface Grant {
  grant_id: string;
  user_id: string;
  username: string | null;
  display_name: string | null;
  role: string;
}

export interface Permissions {
  owner: { user_id: string; username?: string; display_name?: string };
  grants: Grant[];
  link: { enabled: boolean; role?: string };
}

export interface Me {
  authenticated: boolean;
  user?: { sub?: string; email?: string; name?: string };
}

class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { const b = await res.json(); detail = b.detail || b.error || detail; } catch { /* keep */ }
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

export const me = () => fetch("/auth/me").then((r) => j<Me>(r));
export const logout = () => fetch("/auth/logout", { method: "POST" }).then((r) => j<{ ok: boolean }>(r));

export const listFolders = (shared = false) =>
  fetch(`${API}/folders${shared ? "?shared_with_me=true" : ""}`)
    .then((r) => j<{ folders: Folder[] }>(r)).then((d) => d.folders);

export const createFolder = (name: string, parent_id: string | null) =>
  fetch(`${API}/folders`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, parent_id }),
  }).then((r) => j<{ folder: Folder }>(r)).then((d) => d.folder);

export const listFiles = (opts: { q?: string; folder_id?: string; shared?: boolean; trashed?: boolean } = {}) => {
  const p = new URLSearchParams();
  if (opts.q) p.set("q", opts.q);
  if (opts.folder_id) p.set("folder_id", opts.folder_id);
  if (opts.shared) p.set("shared_with_me", "true");
  if (opts.trashed) p.set("trashed", "true");
  return fetch(`${API}/files?${p}`).then((r) => j<{ files: DriveFile[] }>(r)).then((d) => d.files);
};

export const restoreFile = (id: string) =>
  fetch(`${API}/files/${id}/restore`, { method: "POST" })
    .then((r) => j<{ file: DriveFile }>(r)).then((d) => d.file);

export const listVersions = (id: string) =>
  fetch(`${API}/files/${id}/versions`)
    .then((r) => j<{ versions: Version[] }>(r)).then((d) => d.versions);

export const restoreVersion = (id: string, versionNo: number) =>
  fetch(`${API}/files/${id}/versions/${versionNo}/restore`, { method: "POST" })
    .then((r) => j<{ file: DriveFile; restored_version: number }>(r));

export const versionUrl = (id: string, versionNo: number) =>
  `${API}/files/${id}/versions/${versionNo}/content`;

export const createLink = (id: string, role: string) =>
  fetch(`${API}/files/${id}/link`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  }).then((r) => j<{ token: string; role: string }>(r));

export const deleteLink = async (id: string) => {
  const r = await fetch(`${API}/files/${id}/link`, { method: "DELETE" });
  if (!r.ok) throw new ApiError(r.status, `HTTP ${r.status}`);
};

// The copyable share URL: same-origin, works with NO session — the BFF forwards
// link_token requests through to the API unauthenticated.
export const linkShareUrl = (id: string, token: string) =>
  `${location.origin}${API}/files/${id}/content?link_token=${token}`;

// ---- folder sharing ----
export const getFolderPermissions = (id: string) =>
  fetch(`${API}/folders/${id}/permissions`).then((r) => j<Permissions>(r));

export const shareFolder = (id: string, address: string, role: string) =>
  fetch(`${API}/folders/${id}/permissions`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, role }),
  }).then((r) => j<Grant>(r));

export const changeFolderRole = (id: string, grantId: string, role: string) =>
  fetch(`${API}/folders/${id}/permissions/${grantId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  }).then((r) => j<Grant>(r));

export const revokeFolderGrant = async (id: string, grantId: string) => {
  const r = await fetch(`${API}/folders/${id}/permissions/${grantId}`, { method: "DELETE" });
  if (!r.ok) throw new ApiError(r.status, `HTTP ${r.status}`);
};

export const patchFile = (id: string, patch: { name?: string; folder_id?: string | null }) =>
  fetch(`${API}/files/${id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }).then((r) => j<{ file: DriveFile }>(r)).then((d) => d.file);

export const deleteFile = (id: string) =>
  fetch(`${API}/files/${id}`, { method: "DELETE" }).then((r) => j<{ deleted: boolean }>(r));

export const getPermissions = (id: string) =>
  fetch(`${API}/files/${id}/permissions`).then((r) => j<Permissions>(r));

export const share = (id: string, address: string, role: string) =>
  fetch(`${API}/files/${id}/permissions`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, role }),
  }).then((r) => j<Grant>(r));

export const changeRole = (id: string, grantId: string, role: string) =>
  fetch(`${API}/files/${id}/permissions/${grantId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  }).then((r) => j<Grant>(r));

export const revoke = async (id: string, grantId: string) => {
  const r = await fetch(`${API}/files/${id}/permissions/${grantId}`, { method: "DELETE" });
  if (!r.ok) throw new ApiError(r.status, `HTTP ${r.status}`);
};

// Upload with progress via XHR (fetch has no upload progress events). The body
// streams through the BFF to files-api; nothing is buffered server-side.
export function upload(
  file: File, folderId: string | null,
  onProgress: (pct: number) => void,
): Promise<DriveFile> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("name", file.name);
    if (folderId) fd.append("folder_id", folderId);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API}/files`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText).file as DriveFile); }
        catch { reject(new Error("bad upload response")); }
      } else {
        let msg = `HTTP ${xhr.status}`;
        try { msg = JSON.parse(xhr.responseText).detail || msg; } catch { /* keep */ }
        reject(new ApiError(xhr.status, msg));
      }
    };
    xhr.onerror = () => reject(new Error("upload network error"));
    xhr.send(fd);
  });
}

export const downloadUrl = (id: string) => `${API}/files/${id}/content`;

export function fmtSize(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes, i = -1;
  do { v /= 1024; i++; } while (v >= 1024 && i < units.length - 1);
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

export function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}
