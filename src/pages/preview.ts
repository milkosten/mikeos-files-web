import { DriveFile, downloadUrl } from "../lib/api";
import { el } from "../lib/dom";

export function isImage(file: Pick<DriveFile, "mime" | "name">): boolean {
  return /^image\//i.test(file.mime || "") ||
    /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg|heic|heif|tiff?)$/i.test(file.name);
}

export function openImagePreview(file: DriveFile): void {
  const previousFocus = document.activeElement;
  const dialog = el("dialog", { class: "image-preview", "aria-label": `Image preview: ${file.name}` });
  const status = el("p", { class: "preview-status", role: "status" }, "Loading image…");
  const image = el("img", { alt: file.name, class: "preview-image", hidden: "" });
  const close = el("button", { class: "btn", type: "button" }, "Close");
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener("close", () => {
    image.removeAttribute("src");
    dialog.remove();
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
  }, { once: true });
  image.addEventListener("load", () => { status.hidden = true; image.hidden = false; });
  image.addEventListener("error", () => {
    image.hidden = true;
    status.hidden = false;
    status.textContent = "This image could not be previewed. Try downloading it, or sign in again if your session has expired.";
  });
  dialog.append(
    el("div", { class: "preview-toolbar" },
      el("h3", {}, file.name),
      el("a", { class: "btn primary", href: downloadUrl(file.id), download: file.name }, "Download"),
      close),
    el("div", { class: "preview-content" }, status, image),
  );
  document.body.append(dialog);
  dialog.showModal();
  // Use the same cookie-authenticated, streaming route as downloads. The API
  // enforces owned, direct-share and shared-folder access for every request.
  image.src = downloadUrl(file.id);
}
