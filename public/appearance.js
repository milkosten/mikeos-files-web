// Runs in the head before styles. The BFF supplies the authenticated user key.
window.FilesAppearance = (() => {
  const modes = ['system', 'light', 'dark'];
  let key = 'files-appearance:' + (document.documentElement.dataset.appearanceUser || 'signed-out');
  let mode = 'system';
  const media = matchMedia('(prefers-color-scheme: dark)');
  function read() { try { const value = localStorage.getItem(key); return modes.includes(value) ? value : 'system'; } catch { return mode; } }
  function apply() { document.documentElement.dataset.theme = mode === 'system' ? (media.matches ? 'dark' : 'light') : mode; }
  mode = read(); apply();
  media.addEventListener('change', apply);
  window.addEventListener('storage', event => { if (event.key === key || event.key === null) { mode = read(); apply(); window.dispatchEvent(new Event('appearancechange')); } });
  return { get: () => mode, identify(user) { key = 'files-appearance:' + user; mode = read(); apply(); }, set(value) { mode = modes.includes(value) ? value : 'system'; try { localStorage.setItem(key, mode); } catch {} apply(); } };
})();
