// The Drive: sidebar (My Drive folder tree + Shared with me + Trash), toolbar
// (breadcrumb, search, upload, new folder), file table with per-role actions,
// drag-drop upload with progress, share dialogs (files, folders, links), version
// history, and trash restore. Role-driven UI: anything the caller's `my_role`
// doesn't allow simply isn't rendered (and the API enforces it anyway).
import {
  DriveFile, Folder, Me, Version, listFiles, listFolders, createFolder,
  patchFile, deleteFile, restoreFile, listVersions, restoreVersion, versionUrl,
  upload, downloadUrl, logout, fmtSize, fmtDate,
} from "../lib/api";
import { el, clear, toast, modal } from "../lib/dom";
import { openShareDialog, openFolderShareDialog } from "./share";

type View =
  | { kind: "folder"; folderId: string | null }
  | { kind: "sharedFolder"; folderId: string; name: string }
  | { kind: "shared" }
  | { kind: "trash" }
  | { kind: "search"; q: string };

interface State {
  user: NonNullable<Me["user"]>;
  folders: Folder[];
  sharedFolders: Folder[];
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
  const state: State = {
    user, folders: [], sharedFolders: [], files: [],
    view: { kind: "folder", folderId: null }, loading: true,
  };

  async function refresh(): Promise<void> {
    state.loading = true;
    render();
    try {
      const v = state.view;
      if (v.kind === "shared") {
        [state.files, state.sharedFolders] = await Promise.all([
          listFiles({ shared: true }), listFolders(true),
        ]);
      } else if (v.kind === "sharedFolder") {
        state.files = await listFiles({ folder_id: v.folderId });
      } else if (v.kind === "trash") {
        state.files = await listFiles({ trashed: true });
      } else if (v.kind === "search") {
        state.files = await listFiles({ q: v.q });
      } else {
        [state.folders, state.files, state.sharedFolders] = await Promise.all([
          listFolders(),
          listFiles(v.folderId ? { folder_id: v.folderId } : {}),
          listFolders(true),
        ]);
        if (!v.folderId) state.files = state.files.filter((f) => !f.folder_id);
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
    const { close } = modal(el("div", {}, el("h3", {}, `Move “${f.name}”`), list));
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

  async function doTrash(f: DriveFile): Promise<void> {
    if (!confirm(`Move “${f.name}” to trash? Collaborators lose access; it auto-deletes after 30 days.`)) return;
    try { await deleteFile(f.id); toast("Moved to trash"); refresh(); }
    catch (e) { toast(e instanceof Error ? e.message : "delete failed", true); }
  }

  async function doDeleteForever(f: DriveFile): Promise<void> {
    if (!confirm(`Permanently delete “${f.name}”? This cannot be undone.`)) return;
    try { await deleteFile(f.id); toast("Deleted forever"); refresh(); }
    catch (e) { toast(e instanceof Error ? e.message : "delete failed", true); }
  }

  async function doRestore(f: DriveFile): Promise<void> {
    try { await restoreFile(f.id); toast(`Restored “${f.name}”`); refresh(); }
    catch (e) { toast(e instanceof Error ? e.message : "restore failed", true); }
  }

  function doHistory(f: DriveFile): void {
    const body = el("div", {}, "Loading…");
    modal(el("div", {}, el("h3", {}, `History — “${f.name}”`), body));
    const canEdit = f.my_role === "owner" || f.my_role === "editor";
    (async () => {
      let versions: Version[];
      try { versions = await listVersions(f.id); }
      catch (e) { clear(body); body.append(el("p", {}, e instanceof Error ? e.message : "failed")); return; }
      clear(body);
      if (!versions.length) {
        body.append(el("p", { class: "fineprint" }, "No older versions yet — a snapshot is kept every time the file is overwritten."));
        return;
      }
      const list = el("div", { class: "grant-list" });
      for (const v of versions) {
        const dl = el("a", { class: "iconbtn", href: versionUrl(f.id, v.version_no), title: "Download this version" }, "⬇");
        const row = el("div", { class: "grant-row" },
          el("span", { class: "who" }, `v${v.version_no} · ${fmtSize(v.size)} · ${fmtDate(v.created_at)}`),
          dl,
        );
        if (canEdit) {
          const rs = el("button", { class: "btn" }, "Restore");
          rs.addEventListener("click", async () => {
            try {
              await restoreVersion(f.id, v.version_no);
              toast(`Restored v${v.version_no} (current content was snapshotted)`);
              refresh();
            } catch (e) { toast(e instanceof Error ? e.message : "restore failed", true); }
          });
          row.append(rs);
        }
        list.append(row);
      }
      body.append(list);
    })();
  }

  // ---- rendering ------------------------------------------------------------
  function render(): void {
    clear(root);
    const v = state.view;

    // Sidebar
    const folderTree = el("nav", { class: "tree" });
    const rootBtn = el("button", {
      class: "tree-item" + (v.kind === "folder" && !v.folderId ? " active" : ""),
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
        const active = v.kind === "folder" && v.folderId === fo.id;
        const row = el("div", { class: "tree-row" });
        const b = el("button", {
          class: "tree-item grow" + (active ? " active" : ""),
          style: `padding-left:${16 + depth * 14}px`,
        }, `📁 ${fo.name}`);
        b.addEventListener("click", () => { state.view = { kind: "folder", folderId: fo.id }; refresh(); });
        const sh = el("button", { class: "iconbtn tree-share", title: "Share folder" }, "👥");
        sh.addEventListener("click", (e) => { e.stopPropagation(); openFolderShareDialog(fo, refresh); });
        row.append(b, sh);
        folderTree.append(row);
        addFolders(fo.id, depth + 1);
      }
    };
    addFolders(null, 1);

    const sharedBtn = el("button", {
      class: "tree-item" + (v.kind === "shared" ? " active" : ""),
    }, "👥 Shared with me");
    sharedBtn.addEventListener("click", () => { state.view = { kind: "shared" }; refresh(); });

    const sharedTree = el("div", {});
    for (const fo of state.sharedFolders) {
      const active = v.kind === "sharedFolder" && v.folderId === fo.id;
      const b = el("button", {
        class: "tree-item" + (active ? " active" : ""),
        style: "padding-left:30px",
        title: `shared folder · you are ${fo.my_role ?? "viewer"}`,
      }, `📁 ${fo.name}`);
      b.addEventListener("click", () => { state.view = { kind: "sharedFolder", folderId: fo.id, name: fo.name }; refresh(); });
      sharedTree.append(b);
    }

    const trashBtn = el("button", {
      class: "tree-item" + (v.kind === "trash" ? " active" : ""),
    }, "🗑️ Trash");
    trashBtn.addEventListener("click", () => { state.view = { kind: "trash" }; refresh(); });

    const sidebar = el("aside", { class: "sidebar" },
      el("div", { class: "brand" }, el("span", { class: "mark" }), "MikeFiles"),
      folderTree,
      el("div", { class: "tree-sep" }),
      sharedBtn, sharedTree,
      el("div", { class: "tree-sep" }),
      trashBtn,
    );

    // Toolbar
    const search = el("input", {
      class: "search", type: "search", placeholder: "Search your drive…",
      value: v.kind === "search" ? v.q : "",
    });
    search.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const q = search.value.trim();
        state.view = q ? { kind: "search", q } : { kind: "folder", folderId: null };
        refresh();
      }
    });

    const isOwnView = v.kind === "folder" || v.kind === "search";
    const uploadInput = el("input", { type: "file", multiple: "", style: "display:none" });
    uploadInput.addEventListener("change", () => { if (uploadInput.files?.length) doUpload(uploadInput.files); });
    const uploadBtn = el("button", { class: "btn primary" }, "⬆ Upload");
    uploadBtn.addEventListener("click", () => uploadInput.click());
    const newFolderBtn = el("button", { class: "btn" }, "＋ Folder");
    newFolderBtn.addEventListener("click", doNewFolder);

    const crumbs =
      v.kind === "shared" ? "Shared with me" :
      v.kind === "sharedFolder" ? `Shared / ${v.name}` :
      v.kind === "trash" ? "Trash" :
      v.kind === "search" ? `Results for “${v.q}”` :
      v.folderId
        ? `My Drive / ${state.folders.find((fo) => fo.id === (v as { folderId: string }).folderId)?.name ?? "…"}`
        : "My Drive";

    const userBtn = el("button", { class: "btn ghost", title: state.user.email ?? "" }, `${state.user.name ?? "me"} · sign out`);
    userBtn.addEventListener("click", async () => { await logout(); location.reload(); });

    const toolbar = el("header", { class: "toolbar" },
      el("span", { class: "crumbs" }, crumbs),
      search,
      isOwnView ? uploadBtn : el("span", {}),
      isOwnView ? newFolderBtn : el("span", {}),
      uploadInput,
      userBtn,
    );

    // File table
    const table = el("div", { class: "filetable" });
    const showOwnerCol = v.kind === "shared" || v.kind === "sharedFolder";
    table.append(el("div", { class: "filerow head" },
      el("span", {}, "Name"),
      el("span", {}, showOwnerCol ? "Owner" : v.kind === "trash" ? "Trashed" : "Shared"),
      el("span", {}, "Size"),
      el("span", {}, "Modified"),
      el("span", {}, ""),
    ));

    if (state.loading) {
      table.append(el("div", { class: "empty" }, "Loading…"));
    } else if (!state.files.length) {
      table.append(el("div", { class: "empty" },
        v.kind === "shared" ? "Nothing shared with you yet." :
        v.kind === "trash" ? "Trash is empty." :
        "This folder is empty — drop files anywhere to upload."));
    }

    for (const f of state.files) {
      const canEdit = f.my_role === "owner" || f.my_role === "editor";
      const isOwner = f.my_role === "owner";
      const actions = el("span", { class: "actions" });

      if (v.kind === "trash") {
        const rs = el("button", { class: "iconbtn", title: "Restore" }, "♻️");
        rs.addEventListener("click", () => doRestore(f));
        const del = el("button", { class: "iconbtn danger", title: "Delete forever" }, "🗑");
        del.addEventListener("click", () => doDeleteForever(f));
        actions.append(rs, del);
      } else {
        const dl = el("a", { class: "iconbtn", href: downloadUrl(f.id), title: "Download", download: f.name }, "⬇");
        actions.append(dl);
        const hist = el("button", { class: "iconbtn", title: "Version history" }, "🕘");
        hist.addEventListener("click", () => doHistory(f));
        actions.append(hist);
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
          const del = el("button", { class: "iconbtn danger", title: "Move to trash" }, "🗑");
          del.addEventListener("click", () => doTrash(f));
          actions.append(mv, sh, del);
        }
      }

      const midCol = showOwnerCol
        ? el("span", { class: "badge", title: `you are ${f.my_role}` },
            f.owner?.display_name || f.owner?.username || "…")
        : v.kind === "trash"
          ? el("span", { class: "date" }, fmtDate((f as DriveFile & { trashed_at?: string }).trashed_at ?? null))
          : el("span", { class: "badge subtle" }, "");

      table.append(el("div", { class: "filerow" },
        el("span", { class: "name" }, `${iconFor(f.mime)} ${f.name}`,
          showOwnerCol ? el("small", { class: "rolehint" }, ` (${f.my_role})`) : ""),
        midCol,
        el("span", { class: "size" }, fmtSize(f.size)),
        el("span", { class: "date" }, fmtDate(f.updated_at)),
        actions,
      ));
    }

    const main = el("main", { class: "main" }, toolbar, table);
    const shell = el("div", { class: "shell" }, sidebar, main);

    if (isOwnView) {
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
