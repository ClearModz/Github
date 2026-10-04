/* Chartroom shell: mobile menu, scroll reveals. No dependencies. */
(() => {
  const root = document.documentElement;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* mobile menu: opens as a full-screen overlay, traps focus, closes with Escape or a link tap */
  const btn = document.querySelector('.nav-toggle');
  const menu = document.getElementById('menu');
  if (btn && menu) {
    const main = document.getElementById('main');
    const focusables = () => [btn, ...menu.querySelectorAll('a[href]')];
    const set = open => {
      btn.setAttribute('aria-expanded', String(open));
      btn.setAttribute('aria-label', open ? 'Close menu' : 'Menu');
      root.classList.toggle('menu-open', open);
      if (main) main.toggleAttribute('inert', open);
      if (open) {
        menu.hidden = false;
        requestAnimationFrame(() => { menu.dataset.open = 'true'; menu.querySelector('a')?.focus(); });
      } else {
        menu.dataset.open = 'false';
        setTimeout(() => { if (menu.dataset.open === 'false') menu.hidden = true; }, reduce ? 0 : 520);
        btn.focus();
      }
    };
    btn.addEventListener('click', () => set(btn.getAttribute('aria-expanded') !== 'true'));
    menu.addEventListener('click', e => { if (e.target.closest('a')) set(false); });
    document.addEventListener('keydown', e => {
      if (btn.getAttribute('aria-expanded') !== 'true') return;
      if (e.key === 'Escape') { set(false); return; }
      if (e.key !== 'Tab') return;
      const f = focusables(), first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    window.matchMedia('(min-width: 761px)').addEventListener('change', e => { if (e.matches && btn.getAttribute('aria-expanded') === 'true') set(false); });
  }

  /* scroll reveal: one observer for the whole site */
  const items = document.querySelectorAll('.reveal');
  if (!items.length) return;
  if (reduce || !('IntersectionObserver' in window)) { items.forEach(el => el.classList.add('in')); return; }
  const io = new IntersectionObserver(entries => entries.forEach(en => {
    if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
  }), { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  items.forEach(el => io.observe(el));
})();
