/* Chartroom telemetry: anonymous error logging and optional privacy-friendly analytics.
   Both are OFF until src/site.config.json names an endpoint or provider. Nothing here ever reads
   the visitor's location, cookies or form values. Custom events carry no personal data. */
(() => {
  const cfg = window.CHARTROOM_CONFIG || {};
  const optOut = navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true;

  /* ---- error logging ---- */
  const errCfg = cfg.errorLogging || {};
  const seen = new Set();
  let sent = 0;
  window.__chartroomErrors = window.__chartroomErrors || [];
  const clean = (s, n) => String(s == null ? '' : s).replace(/\?[^\s)"']*/g, '').slice(0, n);   // drop query strings from URLs in stacks
  function report(kind, message, source, line, col, stack) {
    const key = kind + '|' + message + '|' + line;
    if (seen.has(key) || sent >= 10) return;            // dedupe and cap per page load
    seen.add(key); sent++;
    const payload = { kind, message: clean(message, 300), source: clean(source, 200), line: line | 0, col: col | 0, stack: clean(stack, 1000), page: location.pathname, build: cfg.build || '', t: new Date().toISOString() };
    window.__chartroomErrors.push(payload);
    if (!errCfg.endpoint) { console.debug('[chartroom] error not sent (no endpoint configured):', payload.message); return; }
    try { navigator.sendBeacon(errCfg.endpoint, new Blob([JSON.stringify(payload)], { type: 'application/json' })); } catch (e) { /* logging must never throw */ }
  }
  window.addEventListener('error', e => report('error', e.message, e.filename, e.lineno, e.colno, e.error && e.error.stack));
  window.addEventListener('unhandledrejection', e => { const r = e.reason; report('promise', (r && r.message) || r, '', 0, 0, r && r.stack); });

  /* ---- analytics (optional, cookie-free providers only) ---- */
  const an = cfg.analytics || {};
  const provider = optOut ? 'none' : (an.provider || 'none');
  const add = (src, attrs) => { const s = document.createElement('script'); s.defer = true; s.src = src; Object.entries(attrs || {}).forEach(([k, v]) => s.setAttribute(k, v)); document.head.appendChild(s); };
  if (provider === 'plausible' && an.domain) {
    window.plausible = window.plausible || function () { (window.plausible.q = window.plausible.q || []).push(arguments); };
    add(an.endpoint || 'https://plausible.io/js/script.js', { 'data-domain': an.domain });
  } else if (provider === 'goatcounter' && an.endpoint) {
    add('https://gc.zgo.at/count.js', { 'data-goatcounter': an.endpoint });
  }

  /* CR.track('quiz_answered', { correct: true }): props are limited to booleans, numbers and short strings */
  const safe = p => Object.fromEntries(Object.entries(p || {}).filter(([, v]) => typeof v === 'boolean' || typeof v === 'number' || (typeof v === 'string' && v.length <= 40)));
  window.CR = window.CR || {};
  window.CR.track = (name, props) => {
    if (provider === 'plausible' && window.plausible) window.plausible(name, { props: safe(props) });
    else if (provider === 'goatcounter' && window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path: 'event/' + name, title: name, event: true });
  };
})();
