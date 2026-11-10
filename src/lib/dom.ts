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
  const previous = document.activeElement as HTMLElement | null;
  const focusKey = previous?.getAttribute("data-focus-key");
  const backdrop = el("div", { class: "modal-backdrop" });
  const box = el("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": content.querySelector("h3")?.textContent || "Dialog", tabindex: "-1" });
  const dismiss = el("button", {class: "btn ghost modal-close", "aria-label": "Close dialog"}, "Close");
  box.append(dismiss, content);
  backdrop.append(box);
  const close = () => { document.removeEventListener("keydown", keydown); backdrop.remove(); if (previous?.isConnected) previous.focus(); else if (focusKey) Array.from(document.querySelectorAll<HTMLElement>("[data-focus-key]")).find(n => n.getAttribute("data-focus-key") === focusKey)?.focus(); };
  const keydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    if (e.key !== "Tab") return;
    const items = Array.from(box.querySelectorAll<HTMLElement>('button, input, select, a[href], [tabindex="0"]')).filter(n => !n.closest("[hidden]") && !n.hasAttribute("disabled"));
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === box)) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  };
  dismiss.onclick = close;
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  document.addEventListener("keydown", keydown);
  document.body.append(backdrop);
  dismiss.focus();
  return { close };
}
