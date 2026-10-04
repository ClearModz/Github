// Build verification. Fails (exit 1) on broken links, missing a11y basics, banned punctuation or unknown icons.
//   node build/check.mjs     (run `npm run build` first, or use `npm test`)
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
if (!existsSync(DIST)) { console.error('dist/ is missing. Run npm run build first.'); process.exit(1); }
const walk = (d, o = []) => { for (const f of readdirSync(d)) { const p = path.join(d, f); statSync(p).isDirectory() ? walk(p, o) : o.push(p); } return o; };
const htmlFiles = walk(DIST).filter(f => f.endsWith('.html'));
const fails = [];
const fail = (f, msg) => fails.push(`${path.relative(ROOT, f)}: ${msg}`);

const phosphor = readFileSync(path.join(DIST, 'assets/vendor/phosphor/style.css'), 'utf8');
const known = new Set([...phosphor.matchAll(/\.ph-([a-z0-9-]+):before/g)].map(m => m[1]));
const ids = new Map();
const basePathOf = f => path.dirname(f);
const resolveLocal = (from, ref) => {
  const clean = ref.split('#')[0].split('?')[0];
  if (!clean) return from;                                          // same-page anchor
  const target = clean.startsWith('/') ? path.join(DIST, clean) : path.resolve(basePathOf(from), clean);
  if (existsSync(target) && statSync(target).isDirectory()) return path.join(target, 'index.html');
  return target;
};
const idsOf = f => { if (!ids.has(f)) ids.set(f, new Set([...readFileSync(f, 'utf8').matchAll(/\sid="([^"]+)"/g)].map(m => m[1]))); return ids.get(f); };

for (const f of htmlFiles) {
  const html = readFileSync(f, 'utf8');
  const is404 = f.endsWith('404.html');
  if (!/<html lang="en"/.test(html)) fail(f, 'missing <html lang>');
  if (!/<title>[^<]{3,}<\/title>/.test(html)) fail(f, 'missing <title>');
  if (!/<meta name="description" content="[^"]{20,}"/.test(html)) fail(f, 'missing meta description');
  if ((html.match(/<h1[\s>]/g) || []).length !== 1) fail(f, 'needs exactly one <h1>');
  if (!/<main id="main"/.test(html) || !/class="skip"/.test(html)) fail(f, 'missing <main id="main"> or skip link');
  if (/\{\{[a-z_:]+\}\}/.test(html)) fail(f, 'unreplaced template token');
  if (/[—–]/.test(html)) fail(f, 'contains an em or en dash');
  if (/>[^<]*[A-Za-z]'[a-z][^<]*</.test(html.replace(/<script[\s\S]*?<\/script>/g, ''))) fail(f, 'straight apostrophe in text, use the curly one');
  if (/[\u{1F300}-\u{1FAFF}✅❌\u{1F4CD}]/u.test(html)) fail(f, 'contains an emoji');
  for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    const ref = m[1];
    if (/^(https?:|mailto:|tel:|data:|javascript:)/.test(ref) || ref.startsWith('{{')) continue;
    if (is404 && ref.startsWith('/')) continue;                       // the 404 page uses the site base path
    const target = resolveLocal(f, ref);
    if (!existsSync(target)) { fail(f, `broken link ${ref}`); continue; }
    const hash = ref.split('#')[1];
    if (hash && target.endsWith('.html') && !idsOf(target).has(hash)) fail(f, `missing anchor #${hash} in ${path.relative(DIST, target)}`);
  }
  for (const m of html.matchAll(/class="[^"]*\bph-([a-z0-9-]+)/g)) if (!known.has(m[1])) fail(f, `unknown icon ph-${m[1]}`);
  for (const m of html.matchAll(/<img\b[^>]*>/g)) if (!/\balt=/.test(m[0]) || !/\bwidth=/.test(m[0]) || !/\bheight=/.test(m[0])) fail(f, 'img needs alt, width and height');
  for (const m of html.matchAll(/<button\b[^>]*>/g)) if (!/\btype=/.test(m[0])) fail(f, 'button without type');
}

for (const f of walk(path.join(DIST, 'assets')).filter(x => /\.(css|js)$/.test(x) && !x.includes('vendor'))) {
  const s = readFileSync(f, 'utf8');
  if (/transition:\s*all/.test(s)) fail(f, 'transition: all');
  if (/outline:\s*none/.test(s) && !/focus-visible/.test(s)) fail(f, 'outline none without focus-visible replacement');
  if (/[—–]/.test(s)) fail(f, 'contains an em or en dash');
  if (/window\.addEventListener\(['"]scroll/.test(s)) fail(f, 'scroll listener');
  if (/fonts\.googleapis|fonts\.gstatic|unpkg\.com|cdn\.jsdelivr/.test(s)) fail(f, 'external CDN reference');
}
for (const f of htmlFiles) if (/fonts\.googleapis|unpkg\.com|cdn\.jsdelivr/.test(readFileSync(f, 'utf8'))) fail(f, 'external CDN reference');

if (fails.length) { console.error(`\n${fails.length} problem(s):\n` + fails.map(x => ' - ' + x).join('\n')); process.exit(1); }
console.log(`OK: ${htmlFiles.length} pages passed link, accessibility, punctuation and icon checks.`);
