import { accountMenu } from "../lib/account";
// The Drive: sidebar (My Drive folder tree + Shared with me + Trash), toolbar
// (breadcrumb, search, upload, new folder), file table with per-role actions,
// drag-drop upload with progress, share dialogs (files, folders, links), version
// history, and trash restore. Role-driven UI: anything the caller's `my_role`
// doesn't allow simply isn't rendered (and the API enforces it anyway).
import {
  VirtualFolder, listVirtualFolders, createVirtualFolder, fileTags,
  DriveFile, Folder, Me, Version, listFiles, listFolders, createFolder,
  patchFile, deleteFile, restoreFile, listVersions, restoreVersion, versionUrl,
  upload, downloadUrl, fmtSize, fmtDate,
} from "../lib/api";
import { el, clear, toast, modal } from "../lib/dom";
import { openShareDialog, openFolderShareDialog } from "./share";
import { openImagePreview, isImage } from "./preview";

type View =
  | { kind: "virtual"; id: string; name: string }
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
  savedViews: VirtualFolder[];
  savedError: string;
  error: string;
  tag: string | null;
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
    user, folders: [], sharedFolders: [], files: [], savedViews: [], savedError: "", error: "", tag: null,
    view: { kind: "folder", folderId: null }, loading: true,
  };

  async function refresh(): Promise<void> {
    state.tag = null;
    state.loading = true;
    state.error = "";
    state.files = [];
    render();
    try {
      const v = state.view;
      if (v.kind === "virtual") {
        state.files = await listFiles({ virtual_folder_id: v.id });
      } else if (v.kind === "shared") {
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
      state.error = e instanceof Error ? e.message : "Load failed";
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
    const focused = document.activeElement instanceof HTMLButtonElement && root.contains(document.activeElement)
      ? {label: document.activeElement.getAttribute("aria-label"), text: document.activeElement.textContent} : null;
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
    const visited = new Set<string>();
    const agentsRoot = state.folders.find(f => !f.parent_id && f.name === "Agents");
    const addFolders = (parent: string | null, depth: number) => {
      for (const fo of byParent.get(parent) ?? []) {
        if (visited.has(fo.id) || (parent === null && fo.id === agentsRoot?.id)) continue;
        visited.add(fo.id);
        const active = v.kind === "folder" && v.folderId === fo.id;
        const row = el("div", { class: "tree-row" });
        const b = el("button", {
          class: "tree-item grow" + (active ? " active" : ""),
          "aria-current": active ? "page" : "false",
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
    folderTree.append(el("h2", {class: "nav-heading"}, "Agents"));
    if (agentsRoot) addFolders(agentsRoot.id, 1);
    else folderTree.append(el("p", {class: "nav-note"}, "Agent folders will appear here."));
    folderTree.append(el("h2", {class: "nav-heading"}, "Saved views"));
    for (const saved of state.savedViews) {
      const active = v.kind === "virtual" && v.id === saved.id;
      const b = el("button", {class: "tree-item" + (active ? " active" : ""), "aria-current": active ? "page" : "false", title: saved.tags.join(", ")}, saved.name);
      b.onclick = () => { state.view = {kind: "virtual", id: saved.id, name: saved.name}; state.tag = null; refresh(); };
      folderTree.append(b);
    }
    if (state.savedError) folderTree.append(el("p", {class: "nav-note", role: "status"}, state.savedError));
    else if (!state.savedViews.length) folderTree.append(el("p", {class: "nav-note"}, "No saved views yet."));
    const saveView = el("button", {class: "tree-item"}, "＋ Saved view");
    saveView.onclick = () => {
      const name = el("input", {class: "share-input", "aria-label": "View name", placeholder: "View name"});
      const query = el("input", {class: "share-input", "aria-label": "Tags to match", placeholder: "home:bergsjon, source:email"});
      const save = el("button", {class: "btn primary"}, "Save view");
      const {close} = modal(el("div", {}, el("h3", {}, "Create saved view"), el("p", {}, "Files matching all these comma-separated tags can appear in several views."), name, query, save));
      save.onclick = async () => {
        if (!name.value.trim() || !query.value.trim()) return;
        save.disabled = true;
        try { await createVirtualFolder(name.value.trim(), query.value.trim()); state.savedViews = await listVirtualFolders(); close(); render(); }
        catch (e) { toast(e instanceof Error ? e.message : "Could not save view", true); }
        finally { save.disabled = false; }
      };
    };
    folderTree.append(saveView);

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

    const sidebar = el("aside", { class: "sidebar", id: "drive-navigation", "aria-label": "Drive navigation" },
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
      v.kind === "virtual" ? v.name :
      v.folderId
        ? `My Drive / ${state.folders.find((fo) => fo.id === (v as { folderId: string }).folderId)?.name ?? "…"}`
        : "My Drive";

    // Files account menu includes app settings and MikeOS account access.
    const userBtn = accountMenu(user);

    const menu = el("button", {class: "btn navigation-toggle", "aria-controls": "drive-navigation", "aria-expanded": "false"}, "Folders & views");
    menu.onclick = () => { const open = sidebar.classList.toggle("open"); menu.setAttribute("aria-expanded", String(open)); };
    const toolbar = el("header", { class: "toolbar" },
      menu, el("span", { class: "crumbs" }, v.kind === "virtual" ? v.name : crumbs),
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

    const visibleFiles = state.tag ? state.files.filter(f => fileTags(f.tags).includes(state.tag!)) : state.files;
    const filters = el("div", {class: "tag-filters", "aria-label": "Filter by tag"});
    filters.append(el("span", {}, "Tags · match one"));
    const tags = new Set(state.files.flatMap(f => fileTags(f.tags)));
    if (state.tag) tags.add(state.tag);
    for (const tag of tags) {
      const chip = el("button", {class: "tag-chip", "aria-pressed": String(state.tag === tag)}, tag);
      chip.onclick = () => { state.tag = state.tag === tag ? null : tag; render(); };
      filters.append(chip);
    }
    if (state.tag) { const reset = el("button", {class: "tag-chip"}, "Clear filter"); reset.onclick = () => {state.tag = null; render();}; filters.append(reset); }
    const status = el("p", {class: "result-status", role: "status", "aria-live": "polite"}, state.loading ? "Loading files…" : `${visibleFiles.length} files${state.tag ? ` tagged ${state.tag}` : ""}`);
    if (state.error) {
      const retry = el("button", {class: "btn"}, "Retry"); retry.onclick = refresh;
      table.append(el("div", {class: "empty", role: "alert"}, state.error, retry));
    } else if (state.loading) {
      table.append(el("div", { class: "empty" }, "Loading…"));
    } else if (!visibleFiles.length) {
      table.append(el("div", { class: "empty" },
        v.kind === "shared" ? "Nothing shared with you yet." :
        v.kind === "trash" ? "Trash is empty." :
        state.tag || v.kind === "virtual" || v.kind === "search" ? "No files match this view." : "This folder is empty — drop files anywhere to upload."));
    }

    for (const f of visibleFiles) {
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
          const sh = el("button", { class: "iconbtn", title: "Share", "data-focus-key": `share-${f.id}` }, "👥");
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

      const name = el("span", { class: "name" });
      if (v.kind !== "trash" && isImage(f)) {
        const preview = el("button", { class: "file-open", type: "button", title: `Preview ${f.name}` }, `${iconFor(f.mime)} ${f.name}`);
        preview.addEventListener("click", () => openImagePreview(f));
        name.append(preview);
      } else {
        name.append(`${iconFor(f.mime)} ${f.name}`);
      }
      if (showOwnerCol) name.append(el("small", { class: "rolehint" }, ` (${f.my_role})`));
      if (f.created_by_agent) name.append(el("small", {class: "agent-attribution"}, `Created by ${f.created_by_agent}`));
      const chips = el("span", {class: "file-tags"});
      for (const tag of fileTags(f.tags)) {
        const chip = el("button", {class: "tag-chip", "aria-pressed": String(state.tag === tag), "aria-label": `Filter by tag ${tag}`}, tag);
        chip.onclick = () => { state.tag = state.tag === tag ? null : tag; render(); };
        chips.append(chip);
      }
      name.append(chips);
      table.append(el("div", { class: "filerow" },
        name,
        midCol,
        el("span", { class: "size" }, fmtSize(f.size)),
        el("span", { class: "date" }, fmtDate(f.updated_at)),
        actions,
      ));
    }

    const main = el("main", { class: "main" }, toolbar, filters, status, table);
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
    if (focused) Array.from(root.querySelectorAll("button")).find(b =>
      b.getAttribute("aria-label") === focused.label && b.textContent === focused.text)?.focus();
  }

  listVirtualFolders().then(views => { state.savedViews = views; render(); }).catch(() => {
    state.savedError = "Saved views unavailable. Try again later."; render();
  });
  refresh();
}
