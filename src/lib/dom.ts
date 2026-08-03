// Tiny DOM helpers — no framework, same style as the other MikeOS web UIs.

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("data-")) n.setAttribute(k, v);
    else if (k === "html") n.innerHTML = v; // trusted, app-authored markup only
    else n.setAttribute(k, v);
  }
  n.append(...children);
  return n;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

let toastTimer: number | undefined;
export function toast(message: string, isError = false): void {
  let t = document.getElementById("toast");
  if (!t) {
    t = el("div", { id: "toast" });
    document.body.append(t);
  }
  t.textContent = message;
  t.className = isError ? "error show" : "show";
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t!.classList.remove("show"), 3500);
}

// Modal helper: renders `content` in a centered dialog; resolves when closed.
export function modal(content: HTMLElement): { close: () => void } {
  const backdrop = el("div", { class: "modal-backdrop" });
  const box = el("div", { class: "modal" }, content);
  backdrop.append(box);
  const close = () => backdrop.remove();
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  document.addEventListener("keydown", function esc(e) {
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc); }
  });
  document.body.append(backdrop);
  return { close };
}
