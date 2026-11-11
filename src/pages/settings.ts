import { el, clear } from "../lib/dom";
import { appearance } from "../lib/appearance";
import { accountMenu } from "../lib/account";
import type { Me } from "../lib/api";
export function renderSettings(root: HTMLElement, user: NonNullable<Me["user"]>): void {
  clear(root);
  const select = el("select", {id: "appearance", "aria-describedby": "appearance-help"}, ...["System", "Light", "Dark"].map(label => el("option", {value: label.toLowerCase()}, label)));
  select.value = appearance.get();
  select.onchange = () => appearance.set(select.value);
  window.addEventListener("appearancechange", () => { select.value = appearance.get(); });
  root.append(el("main", {class: "settings-page"}, el("header", {class: "settings-header"}, el("a", {href: "/", class: "brand"}, "MikeFiles"), accountMenu(user)), el("h1", {}, "Settings"), el("section", {class: "appearance-card", "aria-label": "Appearance"}, el("div", {}, el("label", {for: "appearance"}, "Appearance"), el("p", {id: "appearance-help"}, "Choose how Files looks on this browser. System follows your device.")), select), el("a", {href: "/", class: "btn"}, "Done")));
}
