import { el } from "./dom";
import { logout, type Me } from "./api";
export function accountMenu(user: NonNullable<Me["user"]>): HTMLElement {
  const menu = el("details", {class: "account-menu"});
  const button = el("summary", {class: "btn", "aria-label": "Account"}, (user.name || user.email || "Account").slice(0, 2).toUpperCase());
  menu.append(button, el("div", {class: "account-panel"}, el("strong", {}, user.name || "Account"), el("p", {}, user.email || ""), el("a", {href: "/settings"}, "Settings"), el("a", {href: "https://apps.osmike.com"}, "MikeOS apps"), el("a", {href: "https://account.osmike.com"}, "Manage account"), el("button", {class: "btn", onclick: async () => {await logout(); location.assign("/");}}, "Sign out")));
  menu.addEventListener("keydown", e => { if (e.key === "Escape") {menu.open = false; button.focus();} });
  menu.addEventListener("focusout", () => { setTimeout(() => { if (!menu.contains(document.activeElement)) menu.open = false; }, 0); });
  return menu;
}
