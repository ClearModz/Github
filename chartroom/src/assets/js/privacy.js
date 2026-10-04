/* Privacy page: deletes everything Chartroom saved in this browser (keys that start with "chartroom."). */
(() => {
  const btn = document.getElementById('clear-local');
  const out = document.getElementById('clear-status');
  if (!btn || !out) return;
  btn.addEventListener('click', () => {
    let removed = 0;
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith('chartroom.')) { localStorage.removeItem(k); removed++; }
      for (const k of Object.keys(sessionStorage)) if (k.startsWith('chartroom.')) { sessionStorage.removeItem(k); removed++; }
      out.textContent = removed ? `Cleared ${removed} saved ${removed === 1 ? 'item' : 'items'}.` : 'Nothing was saved in this browser.';
    } catch (e) {
      out.textContent = 'This browser blocks site storage, so nothing was saved.';
    }
  });
})();
