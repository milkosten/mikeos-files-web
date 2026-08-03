// Share dialog: who has access (owner + grants), add by @osmike.com address with
// a role picker, change a role, revoke. Owner-only (the Drive only shows the
// button to owners; the API enforces it regardless).
import { DriveFile, getPermissions, share, changeRole, revoke } from "../lib/api";
import { el, clear, toast, modal } from "../lib/dom";

const ROLES = ["viewer", "commenter", "editor"];

export function openShareDialog(file: DriveFile, onChange: () => void): void {
  const body = el("div", { class: "share-body" }, "Loading…");
  const { close } = modal(el("div", {},
    el("h3", {}, `Share “${file.name}”`),
    body,
  ));

  async function load(): Promise<void> {
    clear(body);
    let perms;
    try { perms = await getPermissions(file.id); }
    catch (e) { body.append(el("p", {}, e instanceof Error ? e.message : "failed to load")); return; }

    const list = el("div", { class: "grant-list" });
    list.append(el("div", { class: "grant-row" },
      el("span", { class: "who" }, `${perms.owner.display_name || perms.owner.username || "you"}`),
      el("span", { class: "badge" }, "owner"),
      el("span", {}),
    ));
    for (const g of perms.grants) {
      const roleSel = el("select", { class: "role-select" });
      for (const r of ROLES) {
        const o = el("option", { value: r }, r);
        if (r === g.role) o.setAttribute("selected", "");
        roleSel.append(o);
      }
      roleSel.addEventListener("change", async () => {
        try { await changeRole(file.id, g.grant_id, roleSel.value); toast("Role updated"); onChange(); }
        catch (e) { toast(e instanceof Error ? e.message : "failed", true); load(); }
      });
      const rm = el("button", { class: "iconbtn danger", title: "Revoke access" }, "✕");
      rm.addEventListener("click", async () => {
        try { await revoke(file.id, g.grant_id); toast("Access revoked"); load(); onChange(); }
        catch (e) { toast(e instanceof Error ? e.message : "failed", true); }
      });
      list.append(el("div", { class: "grant-row" },
        el("span", { class: "who" }, g.display_name || g.username || g.user_id),
        roleSel, rm,
      ));
    }

    const addr = el("input", { class: "share-input", type: "text", placeholder: "name@osmike.com" });
    const roleSel = el("select", { class: "role-select" });
    for (const r of ROLES) roleSel.append(el("option", { value: r }, r));
    (roleSel as HTMLSelectElement).value = "editor";
    const addBtn = el("button", { class: "btn primary" }, "Share");
    addBtn.addEventListener("click", async () => {
      const a = (addr as HTMLInputElement).value.trim();
      if (!a) return;
      addBtn.setAttribute("disabled", "");
      try {
        const g = await share(file.id, a, (roleSel as HTMLSelectElement).value);
        toast(`Shared with ${g.display_name || g.username || a}`);
        (addr as HTMLInputElement).value = "";
        load(); onChange();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "share failed";
        toast(msg === "recipient_not_found" ? "No MikeOS account found for that address" : msg, true);
      } finally {
        addBtn.removeAttribute("disabled");
      }
    });

    body.append(
      list,
      el("div", { class: "share-add" }, addr, roleSel, addBtn),
      el("p", { class: "fineprint" },
        "Editors can change the file; viewers can only read it. The file stays in your storage — deleting it removes it for everyone."),
    );
  }

  load();
  void close; // dialog closes via backdrop / Escape
}
