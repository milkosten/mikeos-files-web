// Signed-out landing: one job — "Sign in with MikeOS". osmike.com design
// language: gradient mark, Fraunces display heading, pill CTA, dawn atmosphere
// (the .landing::before/::after blobs in styles.css).
import { el, clear } from "../lib/dom";

export function renderLanding(root: HTMLElement): void {
  clear(root);
  const h1 = el("h1", {});
  h1.append("Your files, ", el("em", { class: "grad-text" }, "everywhere"), ".");
  root.append(
    el("div", { class: "landing" },
      el("div", { class: "landing-card" },
        el("div", { class: "logo" }, el("span", { class: "mark" }), "MikeFiles"),
        h1,
        el("p", { class: "tagline" }, "Browse, upload and share the files from every MikeOS device — and nothing leaves your account unless you share it."),
        el("a", { class: "btn primary", href: "/auth/login" }, "Sign in with MikeOS"),
        el("p", { class: "fineprint" }, "files.osmike.com · part of the MikeOS suite"),
      ),
    ),
  );
}
