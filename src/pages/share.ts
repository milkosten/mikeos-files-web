// Share dialog for FILES and FOLDERS: who has access (owner + grants), add by
// @osmike.com address with a role picker, change a role, revoke — and for files,
// the share LINK (mint once, copy, revoke). Owner-only; the API enforces it.
import {
  listAgents, shareAgent, getAgentPermissions, revokeAgent,
  DriveFile, Folder, Permissions,
  getPermissions, share, changeRole, revoke,
  getFolderPermissions, shareFolder, changeFolderRole, revokeFolderGrant,
  createLink, deleteLink, linkShareUrl,
} from "../lib/api";
import { el, clear, toast, modal } from "../lib/dom";

const ROLES = ["viewer", "commenter", "editor"];

interface ShareTarget {
  id: string;
  label: string;
  kind: "file" | "folder";
  load: () => Promise<Permissions>;
  add: (address: string, role: string) => Promise<unknown>;
  reRole: (grantId: string, role: string) => Promise<unknown>;
  remove: (grantId: string) => Promise<void>;
}

export function openShareDialog(file: DriveFile, onChange: () => void): void {
  openDialog({
    id: file.id, label: file.name, kind: "file",
    load: () => getPermissions(file.id),
    add: (a, r) => share(file.id, a, r),
    reRole: (g, r) => changeRole(file.id, g, r),
    remove: (g) => revoke(file.id, g),
  }, onChange);
}

export function openFolderShareDialog(folder: Folder, onChange: () => void): void {
  openDialog({
    id: folder.id, label: folder.name, kind: "folder",
    load: () => getFolderPermissions(folder.id),
    add: (a, r) => shareFolder(folder.id, a, r),
    reRole: (g, r) => changeFolderRole(folder.id, g, r),
    remove: (g) => revokeFolderGrant(folder.id, g),
  }, onChange);
}

function roleSelect(current: string): HTMLSelectElement {
  const sel = el("select", { class: "role-select", "aria-label": "Access role" });
  for (const r of ROLES) {
    const o = el("option", { value: r }, r);
    if (r === current) o.setAttribute("selected", "");
    sel.append(o);
  }
  return sel as HTMLSelectElement;
}

function openDialog(target: ShareTarget, onChange: () => void): void {
  const body = el("div", { class: "share-body" }, "Loading…");
  modal(el("div", {},
    el("h3", {}, `Share ${target.kind === "folder" ? "folder " : ""}“${target.label}”`),
    body,
  ));

  async function load(): Promise<void> {
    clear(body);
    let perms: Permissions;
    try { perms = await target.load();
      try { perms.grants.push(...await getAgentPermissions(target.kind, target.id)); } catch { toast("Agent permissions unavailable", true); } }
    catch (e) { body.append(el("p", {}, e instanceof Error ? e.message : "failed to load")); return; }

    const list = el("div", { class: "grant-list" });
    list.append(el("div", { class: "grant-row" },
      el("span", { class: "who" }, `${perms.owner.display_name || perms.owner.username || "you"}`),
      el("span", { class: "badge" }, "owner"),
      el("span", {}),
    ));
    for (const g of perms.grants) {
      const sel = roleSelect(g.role);
      sel.addEventListener("change", async () => {
        try { await (g.principal_type === "agent" ? shareAgent(target.kind, target.id, g.principal_id!, sel.value) : target.reRole(g.grant_id, sel.value)); toast("Role updated"); onChange(); }
        catch (e) { toast(e instanceof Error ? e.message : "failed", true); load(); }
      });
      const rm = el("button", { class: "iconbtn danger", title: "Revoke access" }, "✕");
      rm.addEventListener("click", async () => {
        try { await (g.principal_type === "agent" ? revokeAgent(target.kind, target.id, g.principal_id!) : target.remove(g.grant_id)); toast("Access revoked"); load(); onChange(); }
        catch (e) { toast(e instanceof Error ? e.message : "failed", true); }
      });
      list.append(el("div", { class: "grant-row" },
        el("span", { class: "who" }, g.display_name || g.username || (g.principal_type === "agent" ? `Agent · ${g.principal_id}` : g.user_id)),
        sel, rm,
      ));
    }

    const addr = el("input", { class: "share-input", type: "text", placeholder: "name@osmike.com", "aria-label": "Recipient email" });
    const agent = el("input", {class: "share-input", "aria-label": "Agent recipient", list: "agent-recipients", placeholder: "Agent ID"});
    const suggestions = el("datalist", {id: "agent-recipients"});
    const recipientType = el("select", {class: "role-select", "aria-label": "Recipient type"}, el("option", {value: "person"}, "Person"), el("option", {value: "agent"}, "Agent"));
    agent.hidden = true;
    const directoryStatus = el("p", {class: "fineprint", role: "status"});
    recipientType.onchange = () => { addr.hidden = recipientType.value === "agent"; agent.hidden = recipientType.value !== "agent"; };
    listAgents().then(agents => {
      for (const a of agents) suggestions.append(el("option", {value: a.agent_id}, a.name || a.agent_id));
      directoryStatus.textContent = "Suggestions come from your Agents folders. Enter another agent ID to share with it.";
    }).catch(() => { directoryStatus.textContent = "Agent suggestions unavailable. Enter an agent ID or email address."; });
    const sel = roleSelect("editor");
    const addBtn = el("button", { class: "btn primary" }, "Share");
    addBtn.addEventListener("click", async () => {
      const a = recipientType.value === "agent" ? agent.value : addr.value.trim();
      if (!a) return;
      addBtn.setAttribute("disabled", "");
      try {
        await (recipientType.value === "agent" ? shareAgent(target.kind, target.id, a, sel.value) : target.add(a, sel.value));
        toast(`Shared with ${a}`);
        (addr as HTMLInputElement).value = "";
        load(); onChange();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "share failed";
        toast(msg === "recipient_not_found" ? "No MikeOS account found for that address" : msg, true);
      } finally {
        addBtn.removeAttribute("disabled");
      }
    });

    body.append(list, el("div", { class: "share-add" }, recipientType, addr, agent, suggestions, sel, addBtn), directoryStatus);

    // Link section — files only. The raw token exists ONLY at mint time, so the
    // copyable URL is shown once; afterwards the choice is revoke or regenerate.
    if (target.kind === "file") {
      const linkBox = el("div", { class: "link-box" });
      const renderLinkControls = () => {
        clear(linkBox);
        if (perms.link.enabled) {
          const revokeBtn = el("button", { class: "btn" }, "Revoke link");
          revokeBtn.addEventListener("click", async () => {
            try { await deleteLink(target.id); toast("Link revoked"); load(); }
            catch (e) { toast(e instanceof Error ? e.message : "failed", true); }
          });
          const regen = el("button", { class: "btn ghost" }, "Regenerate");
          regen.addEventListener("click", mint);
          linkBox.append(
            el("span", { class: "badge" }, `link active · ${perms.link.role ?? "viewer"}`),
            revokeBtn, regen,
          );
        } else {
          const mkBtn = el("button", { class: "btn" }, "Create link");
          mkBtn.addEventListener("click", mint);
          linkBox.append(mkBtn,
            el("span", { class: "fineprint" }, "Anyone with the link can view. Revocable."));
        }
      };
      async function mint(): Promise<void> {
        try {
          const l = await createLink(target.id, "viewer");
          const url = linkShareUrl(target.id, l.token);
          await navigator.clipboard.writeText(url).catch(() => { /* show below anyway */ });
          clear(linkBox);
          const field = el("input", { class: "share-input", value: url, readonly: "" });
          (field as HTMLInputElement).onclick = () => (field as HTMLInputElement).select();
          const copy = el("button", { class: "btn" }, "Copy");
          copy.addEventListener("click", async () => {
            await navigator.clipboard.writeText(url); toast("Link copied");
          });
          linkBox.append(field, copy,
            el("p", { class: "fineprint" }, "Save it now — the link is shown only once (revoke or regenerate later)."));
          toast("Link created and copied");
        } catch (e) { toast(e instanceof Error ? e.message : "link failed", true); }
      }
      renderLinkControls();
      body.append(el("div", { class: "share-section" }, el("h4", {}, "Share link"), linkBox));
    }

    body.append(el("p", { class: "fineprint" },
      target.kind === "folder"
        ? "Sharing a folder shares everything inside it, including files added later."
        : "Editors can change the file; viewers can only read it. The file stays in your storage — deleting it removes it for everyone."));
  }

  load();
}
