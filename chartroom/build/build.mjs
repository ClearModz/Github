// Chartroom static site build. No dependencies beyond the npm packages it copies from.
//   node build/build.mjs            -> writes dist/
//   BASE_PATH=/Github/ node build/build.mjs   (project pages: only the 404 page needs the base path)
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const NM = path.join(ROOT, 'node_modules');
const read = p => readFileSync(p, 'utf8');
const write = (p, s) => { mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, s); };

const config = JSON.parse(read(path.join(SRC, 'site.config.json')));
const basePath = (process.env.BASE_PATH || config.basePath || '/').replace(/\/?$/, '/');
const siteUrl = (process.env.SITE_URL || config.siteUrl || '').replace(/\/$/, '');
let build = 'dev';
try { build = execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a git checkout */ }
const today = new Date();
const updated = today.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

/* ---- static assets and vendored libraries (no CDN calls at runtime) ---- */
cpSync(path.join(SRC, 'assets'), path.join(DIST, 'assets'), { recursive: true });
cpSync(path.join(SRC, 'data'), path.join(DIST, 'assets/data'), { recursive: true });   // airports and runways, refreshed with npm run data:update
const copy = (from, to) => { mkdirSync(path.dirname(path.join(DIST, to)), { recursive: true }); cpSync(path.join(NM, from), path.join(DIST, to)); };
for (const w of ['400', '600', '800']) copy(`@fontsource/sora/files/sora-latin-${w}-normal.woff2`, `assets/fonts/sora-latin-${w}-normal.woff2`);
for (const w of ['400', '600']) copy(`@fontsource/jetbrains-mono/files/jetbrains-mono-latin-${w}-normal.woff2`, `assets/fonts/jetbrains-mono-latin-${w}-normal.woff2`);
copy('@fontsource/sora/LICENSE', 'assets/fonts/LICENSE-sora.txt');
copy('@fontsource/jetbrains-mono/LICENSE', 'assets/fonts/LICENSE-jetbrains-mono.txt');
for (const f of ['style.css', 'Phosphor.woff2', 'Phosphor.woff']) copy(`@phosphor-icons/web/src/regular/${f}`, `assets/vendor/phosphor/${f}`);
copy('maplibre-gl/dist/maplibre-gl.js', 'assets/vendor/maplibre/maplibre-gl.js');
copy('maplibre-gl/dist/maplibre-gl.css', 'assets/vendor/maplibre/maplibre-gl.css');
copy('deck.gl/dist.min.js', 'assets/vendor/deck/deck.gl.min.js');
copy('@phosphor-icons/web/LICENSE', 'assets/vendor/phosphor/LICENSE.txt');
copy('maplibre-gl/LICENSE.txt', 'assets/vendor/maplibre/LICENSE.txt');
copy('deck.gl/LICENSE', 'assets/vendor/deck/LICENSE.txt');

/* config for the browser (the only place analytics and error endpoints are set) */
write(path.join(DIST, 'assets/js/config.js'),
  `window.CHARTROOM_CONFIG=${JSON.stringify({ build, analytics: config.analytics, errorLogging: config.errorLogging })};\n`);

/* ---- pages ---- */
const partial = n => read(path.join(SRC, 'partials', `${n}.html`));
const walk = (dir, out = []) => { for (const f of readdirSync(dir)) { const p = path.join(dir, f); statSync(p).isDirectory() ? walk(p, out) : out.push(p); } return out; };

const analyticsNote = config.analytics.provider === 'none'
  ? '<p>This site does <strong>not</strong> run analytics. There are no tracking scripts, no advertising and no cookies.</p>'
  : `<p>This site uses <strong>${config.analytics.provider}</strong> for anonymous page-view counts. It sets no cookies, stores nothing on your device and does not follow you across sites. It is switched off if your browser sends Do Not Track or Global Privacy Control.</p>`;
const errorNote = config.errorLogging.endpoint
  ? '<p>If a script error happens, the page sends an anonymous report (the error message, the script file and line, the page path and the site version) so it can be fixed. It never includes your location, your answers or anything you typed.</p>'
  : '<p>Script errors are not sent anywhere. They stay in your browser console.</p>';

const pages = [];
for (const file of walk(path.join(SRC, 'pages')).filter(f => f.endsWith('.html'))) {
  const rel = path.relative(path.join(SRC, 'pages'), file).split(path.sep).join('/');
  let html = read(file);
  const m = /^\s*<!--(\{[\s\S]*?\})-->\s*/.exec(html);
  if (!m) throw new Error(`${rel}: missing JSON header comment`);
  const meta = JSON.parse(m[1]);
  html = html.slice(m[0].length);
  const outRel = rel === '404.html' ? '404.html' : rel;           // pages/x/index.html -> dist/x/index.html
  const depth = outRel === '404.html' ? 0 : outRel.split('/').length - 1;
  const root = outRel === '404.html' ? basePath : depth === 0 ? './' : '../'.repeat(depth);
  const urlPath = outRel === '404.html' ? '' : outRel.replace(/index\.html$/, '');
  const title = meta.title.includes('Chartroom') ? meta.title : `${meta.title} | Chartroom`;
  const cur = k => (meta.section === k ? ' aria-current="page"' : '');
  const fill = s => s
    .replace(/\{\{cur:(\w+)\}\}/g, (_, k) => cur(k))
    .replace(/\{\{root\}\}/g, root)
    .replace(/\{\{title\}\}/g, title)
    .replace(/\{\{description\}\}/g, meta.description)
    .replace(/\{\{canonical\}\}/g, siteUrl && urlPath !== '' || (siteUrl && rel === 'index.html') ? `<link rel="canonical" href="${siteUrl}/${urlPath}">` : '')
    .replace(/\{\{year\}\}/g, String(today.getUTCFullYear()))
    .replace(/\{\{updated\}\}/g, updated)
    .replace(/\{\{analytics_note\}\}/g, analyticsNote)
    .replace(/\{\{error_note\}\}/g, errorNote);
  const headExtra = fill(meta.head || '');
  const doc = `<!doctype html>\n<html lang="en">\n<head>\n${fill(partial('head')).replace('{{head_extra}}', headExtra)}\n</head>\n<body${meta.bodyClass ? ` class="${meta.bodyClass}"` : ''}>\n${fill(partial('nav'))}\n<main id="main" tabindex="-1">\n${fill(html)}\n</main>\n${fill(partial('footer'))}\n${fill(meta.scripts || '')}\n</body>\n</html>\n`;
  write(path.join(DIST, outRel), doc);
  pages.push({ outRel, urlPath, noindex: !!meta.noindex });
}

/* ---- sitemap, robots, pages marker ---- */
write(path.join(DIST, '.nojekyll'), '');
const indexable = pages.filter(p => !p.noindex && p.outRel !== '404.html');
if (siteUrl) write(path.join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexable.map(p => `  <url><loc>${siteUrl}/${p.urlPath}</loc></url>`).join('\n')}\n</urlset>\n`);
write(path.join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\n${siteUrl ? `Sitemap: ${siteUrl}/sitemap.xml\n` : ''}`);

console.log(`Built ${pages.length} pages into dist/ (build ${build}, base ${basePath}${siteUrl ? ', ' + siteUrl : ''})`);
