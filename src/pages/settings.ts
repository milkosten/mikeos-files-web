import { el, clear } from "../lib/dom";
import { appearance } from "../lib/appearance";
import { accountMenu } from "../lib/account";
import type { Me } from "../lib/api";
export function renderSettings(root: HTMLElement, user: NonNullable<Me["user"]>): void {
  clear(root);
  const radios = ["System", "Light", "Dark"].map(label => {
    const input = el("input", {type: "radio", name: "appearance", value: label.toLowerCase()});
    input.checked = input.value === appearance.get();
    input.onchange = () => { if (input.checked) appearance.set(input.value); };
    return el("label", {class: "appearance-choice"}, input, label);
  });
  const group = el("fieldset", {class: "appearance-options", "aria-describedby": "appearance-help"}, el("legend", {}, "Appearance"), ...radios);
  window.addEventListener("appearancechange", () => {
    for (const label of radios) {
      const input = label.querySelector("input")!;
      input.checked = input.value === appearance.get();
    }
  });
  root.append(el("main", {class: "settings-page"}, el("header", {class: "settings-header"}, el("a", {href: "/", class: "brand"}, "MikeFiles"), accountMenu(user)), el("h1", {}, "Settings"), el("section", {class: "appearance-card", "aria-label": "Appearance"}, el("div", {}, el("p", {id: "appearance-help"}, "Choose how Files looks on this browser. System follows your device.")), group), el("a", {href: "/", class: "btn"}, "Done")));
}
