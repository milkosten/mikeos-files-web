// The Drive: sidebar (My Drive folder tree + Shared with me), toolbar (breadcrumb,
// search, upload, new folder), file table with per-role actions, drag-drop upload
// with progress, and the share dialog. Role-driven UI: anything the caller's
// `my_role` doesn't allow simply isn't rendered (and the API enforces it anyway).
import {
  DriveFile, Folder, Me, listFiles, listFolders, createFolder, patchFile,
  deleteFile, upload, downloadUrl, logout, fmtSize, fmtDate,
} from "../lib/api";
import { el, clear, toast, modal } from "../lib/dom";
import { openShareDialog } from "./share";

type View = { kind: "folder"; folderId: string | null } | { kind: "shared" } | { kind: "search"; q: string };

interface State {
  user: NonNullable<Me["user"]>;
  folders: Folder[];
  files: DriveFile[];
  view: View;
  loading: boolean;
}

const ICONS: [RegExp, string][] = [
  [/^image\//, "🖼️"], [/^video\//, "🎞️"], [/^audio\//, "🎵"],
  [/pdf/, "📕"], [/zip|tar|compress/, "🗜️"], [/^text\//, "📄"],
  [/json|javascript|xml/, "🧾"], [/sheet|excel|csv/, "📊"],
  [/presentation|powerpoint/, "📽️"], [/document|word/, "📝"],
];
const iconFor = (mime: string | null) =>
  (mime && ICONS.find(([re]) => re.test(mime))?.[1]) || "📄";

export function renderDrive(root: HTMLElement, user: NonNullable<Me["user"]>): void {
  const state: State = { user, folders: [], files: [], view: { kind: "folder", folderId: null }, loading: true };

  async function refresh(): Promise<void> {
    state.loading = true;
    render();
    try {
      if (state.view.kind === "shared") {
        state.files = await listFiles({ shared: true });
      } else if (state.view.kind === "search") {
        state.files = await listFiles({ q: state.view.q });
      } else {
        [state.folders, state.files] = await Promise.all([
          listFolders(),
          listFiles(state.view.folderId ? { folder_id: state.view.folderId } : {}),
        ]);
        // Root shows files with no folder; a folder shows its own files.
        if (!state.view.folderId) state.files = state.files.filter((f) => !f.folder_id);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "load failed", true);
    }
    state.loading = false;
    render();
  }

  // ---- actions --------------------------------------------------------------
  async function doUpload(files: FileList | File[]): Promise<void> {
    const folderId = state.view.kind === "folder" ? state.view.folderId : null;
    for (const file of Array.from(files)) {
      const note = el("div", { class: "upload-note" }, `Uploading ${file.name}… 0%`);
      document.body.append(note);
      try {
        await upload(file, folderId, (pct) => { note.textContent = `Uploading ${file.name}… ${pct}%`; });
        toast(`Uploaded ${file.name}`);
      } catch (e) {
        toast(e instanceof Error ? `${file.name}: ${e.message}` : "upload failed", true);
      } finally {
        note.remove();
      }
    }
    refresh();
  }

  async function doNewFolder(): Promise<void> {
    const name = prompt("Folder name");
    if (!name) return;
    const parent = state.view.kind === "folder" ? state.view.folderId : null;
    try { await createFolder(name, parent); toast(`Created “${name}”`); refresh(); }
    catch (e) { toast(e instanceof Error ? e.message : "create failed", true); }
  }

  async function doRename(f: DriveFile): Promise<void> {
    const name = prompt("Rename to", f.name);
    if (!name || name === f.name) return;
    try { await patchFile(f.id, { name }); toast("Renamed"); refresh(); }
    catch (e) { toast(e instanceof Error ? e.message : "rename failed", true); }
  }

  function doMove(f: DriveFile): void {
    const list = el("div", { class: "move-list" });
    const { close } = modal(el("div", {},
      el("h3", {}, `Move “${f.name}”`),
      list,
    ));
    const options: { id: string | null; name: string }[] = [
      { id: null, name: "My Drive (root)" },
      ...state.folders.map((fo) => ({ id: fo.id as string | null, name: fo.name })),
    ];
    for (const opt of options) {
      const b = el("button", { class: "btn ghost block" }, `📂 ${opt.name}`);
      b.addEventListener("click", async () => {
        try { await patchFile(f.id, { folder_id: opt.id }); toast(`Moved to ${opt.name}`); close(); refresh(); }
        catch (e) { toast(e instanceof Error ? e.message : "move failed", true); }
      });
      list.append(b);
    }
  }

  async function doDelete(f: DriveFile): Promise<void> {
    if (!confirm(`Delete “${f.name}” permanently? Collaborators lose access too.`)) return;
    try { await deleteFile(f.id); toast("Deleted"); refresh(); }
    catch (e) { toast(e instanceof Error ? e.message : "delete failed", true); }
  }

  // ---- rendering ------------------------------------------------------------
  function render(): void {
    clear(root);

    // Sidebar
    const folderTree = el("nav", { class: "tree" });
    const rootBtn = el("button", {
      class: "tree-item" + (state.view.kind === "folder" && !state.view.folderId ? " active" : ""),
    }, "🗂️ My Drive");
    rootBtn.addEventListener("click", () => { state.view = { kind: "folder", folderId: null }; refresh(); });
    folderTree.append(rootBtn);

    const byParent = new Map<string | null, Folder[]>();
    for (const fo of state.folders) {
      const k = fo.parent_id ?? null;
      byParent.set(k, [...(byParent.get(k) ?? []), fo]);
    }
    const addFolders = (parent: string | null, depth: number) => {
      for (const fo of byParent.get(parent) ?? []) {
        const active = state.view.kind === "folder" && state.view.folderId === fo.id;
        const b = el("button", {
          class: "tree-item" + (active ? " active" : ""),
          style: `padding-left:${16 + depth * 16}px`,
        }, `📁 ${fo.name}`);
        b.addEventListener("click", () => { state.view = { kind: "folder", folderId: fo.id }; refresh(); });
        folderTree.append(b);
        addFolders(fo.id, depth + 1);
      }
    };
    addFolders(null, 1);

    const sharedBtn = el("button", {
      class: "tree-item" + (state.view.kind === "shared" ? " active" : ""),
    }, "👥 Shared with me");
    sharedBtn.addEventListener("click", () => { state.view = { kind: "shared" }; refresh(); });

    const sidebar = el("aside", { class: "sidebar" },
      el("div", { class: "brand" }, el("span", { class: "mark" }), "MikeFiles"),
      folderTree,
      el("div", { class: "tree-sep" }),
      sharedBtn,
    );

    // Toolbar
    const search = el("input", {
      class: "search", type: "search", placeholder: "Search your drive…",
      value: state.view.kind === "search" ? state.view.q : "",
    });
    search.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const q = search.value.trim();
        state.view = q ? { kind: "search", q } : { kind: "folder", folderId: null };
        refresh();
      }
    });

    const uploadInput = el("input", { type: "file", multiple: "", style: "display:none" });
    uploadInput.addEventListener("change", () => { if (uploadInput.files?.length) doUpload(uploadInput.files); });
    const uploadBtn = el("button", { class: "btn primary" }, "⬆ Upload");
    uploadBtn.addEventListener("click", () => uploadInput.click());
    const newFolderBtn = el("button", { class: "btn" }, "＋ Folder");
    newFolderBtn.addEventListener("click", doNewFolder);

    const crumbs =
      state.view.kind === "shared" ? "Shared with me" :
      state.view.kind === "search" ? `Results for “${state.view.q}”` :
      state.view.folderId
        ? `My Drive / ${state.folders.find((fo) => fo.id === (state.view as { folderId: string }).folderId)?.name ?? "…"}`
        : "My Drive";

    const userBtn = el("button", { class: "btn ghost", title: state.user.email ?? "" }, `${state.user.name ?? "me"} · sign out`);
    userBtn.addEventListener("click", async () => { await logout(); location.reload(); });

    const toolbar = el("header", { class: "toolbar" },
      el("span", { class: "crumbs" }, crumbs),
      search,
      state.view.kind === "shared" ? el("span", {}) : uploadBtn,
      state.view.kind === "shared" ? el("span", {}) : newFolderBtn,
      uploadInput,
      userBtn,
    );

    // File table
    const table = el("div", { class: "filetable" });
    const isShared = state.view.kind === "shared";
    table.append(el("div", { class: "filerow head" },
      el("span", {}, "Name"),
      el("span", {}, isShared ? "Owner" : "Shared"),
      el("span", {}, "Size"),
      el("span", {}, "Modified"),
      el("span", {}, ""),
    ));

    if (state.loading) {
      table.append(el("div", { class: "empty" }, "Loading…"));
    } else if (!state.files.length) {
      table.append(el("div", { class: "empty" },
        isShared ? "Nothing shared with you yet." : "This folder is empty — drop files anywhere to upload."));
    }

    for (const f of state.files) {
      const canEdit = f.my_role === "owner" || f.my_role === "editor";
      const isOwner = f.my_role === "owner";

      const actions = el("span", { class: "actions" });
      const dl = el("a", { class: "iconbtn", href: downloadUrl(f.id), title: "Download", download: f.name }, "⬇");
      actions.append(dl);
      if (canEdit) {
        const rn = el("button", { class: "iconbtn", title: "Rename" }, "✏️");
        rn.addEventListener("click", () => doRename(f));
        actions.append(rn);
      }
      if (isOwner) {
        const mv = el("button", { class: "iconbtn", title: "Move" }, "📂");
        mv.addEventListener("click", () => doMove(f));
        const sh = el("button", { class: "iconbtn", title: "Share" }, "👥");
        sh.addEventListener("click", () => openShareDialog(f, refresh));
        const del = el("button", { class: "iconbtn danger", title: "Delete" }, "🗑");
        del.addEventListener("click", () => doDelete(f));
        actions.append(mv, sh, del);
      }

      const roleBadge = isShared
        ? el("span", { class: "badge" }, f.owner?.display_name || f.owner?.username || "…")
        : el("span", { class: "badge subtle" }, "");
      if (isShared) roleBadge.title = `you are ${f.my_role}`;

      table.append(el("div", { class: "filerow" },
        el("span", { class: "name" }, `${iconFor(f.mime)} ${f.name}`,
          isShared ? el("small", { class: "rolehint" }, ` (${f.my_role})`) : ""),
        roleBadge,
        el("span", { class: "size" }, fmtSize(f.size)),
        el("span", { class: "date" }, fmtDate(f.updated_at)),
        actions,
      ));
    }

    const main = el("main", { class: "main" }, toolbar, table);
    const shell = el("div", { class: "shell" }, sidebar, main);

    // Drag & drop upload anywhere (own views only).
    if (!isShared) {
      shell.addEventListener("dragover", (e) => { e.preventDefault(); shell.classList.add("dropping"); });
      shell.addEventListener("dragleave", () => shell.classList.remove("dropping"));
      shell.addEventListener("drop", (e) => {
        e.preventDefault();
        shell.classList.remove("dropping");
        if (e.dataTransfer?.files.length) doUpload(e.dataTransfer.files);
      });
    }

    root.append(shell);
  }

  refresh();
}
