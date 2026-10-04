// Builds src/data/*.json from the public OurAirports CSVs (public domain). Run when you want fresh data:
//   npm run data:update
// The generated files are committed, so normal builds need no network and are repeatable.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data');
const BASE = process.env.AIRPORT_DATA_BASE || 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main';
mkdirSync(OUT, { recursive: true });

/** RFC 4180 style parser: quoted fields, doubled quotes, commas and newlines inside quotes. */
function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const head = rows.shift();
  return rows.filter(r => r.length === head.length).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
const get = async name => { const r = await fetch(`${BASE}/${name}.csv`); if (!r.ok) throw new Error(`${name}.csv: HTTP ${r.status}`); return parseCSV(await r.text()); };

const [airports, runways, freqs] = await Promise.all([get('airports'), get('runways'), get('airport-frequencies')]);

// Small fields: keep those that look public (an ICAO or IATA code, airline service, a website or a Wikipedia page).
const publicLooking = a => a.type !== 'small_airport' || !!(a.icao_code || a.iata_code || a.scheduled_service === 'yes' || a.wikipedia_link || a.home_link || /^K[A-Z0-9]{3}$/.test(a.gps_code || ''));
const keep = airports.filter(a => a.iso_country === 'US' && ['large_airport', 'medium_airport', 'small_airport'].includes(a.type) && publicLooking(a));

const displayId = a => a.icao_code || a.gps_code || a.ident;
const byOur = new Map(keep.map(a => [a.ident, a]));
const towered = new Set(freqs.filter(f => f.type === 'TWR' && byOur.has(f.airport_ident)).map(f => f.airport_ident));

const TYPE = { large_airport: 'L', medium_airport: 'M', small_airport: 'S' };
const round = (n, d) => Math.round(Number(n) * 10 ** d) / 10 ** d;
const rows = keep.map(a => [displayId(a), a.name, a.municipality, (a.iso_region || '').replace('US-', ''), TYPE[a.type], round(a.latitude_deg, 4), round(a.longitude_deg, 4), Math.round(Number(a.elevation_ft)) || 0, towered.has(a.ident) ? 1 : 0, a.iata_code || '']);
rows.sort((x, y) => x[0].localeCompare(y[0]));
const seen = new Set(); const dupes = rows.filter(r => seen.has(r[0]) || !seen.add(r[0]));
if (dupes.length) console.warn('duplicate identifiers dropped:', dupes.map(r => r[0]).join(', '));
const unique = rows.filter((r, i) => rows.findIndex(x => x[0] === r[0]) === i);

const details = {};
const idOf = our => displayId(byOur.get(our));
for (const r of runways) {
  if (!byOur.has(r.airport_ident) || r.closed === '1') continue;
  const d = (details[idOf(r.airport_ident)] ||= { r: [], f: [] });
  d.r.push([r.le_ident, r.he_ident, Number(r.length_ft) || 0, Number(r.width_ft) || 0, r.surface, r.lighted === '1' ? 1 : 0]);   // headings are derived from runway numbers in the browser: the source headings are unreliable
}
for (const f of freqs) {
  if (!byOur.has(f.airport_ident) || !f.frequency_mhz) continue;
  const d = (details[idOf(f.airport_ident)] ||= { r: [], f: [] });
  d.f.push([f.type, f.description, Number(f.frequency_mhz)]);
}

const retrieved = new Date().toISOString().slice(0, 10);
writeFileSync(path.join(OUT, 'airports.json'), JSON.stringify({ fields: ['id', 'name', 'city', 'state', 'type', 'lat', 'lon', 'elev', 'twr', 'iata'], retrieved, rows: unique }));
writeFileSync(path.join(OUT, 'airport-details.json'), JSON.stringify({ retrieved, runwayFields: ['le', 'he', 'len', 'wid', 'surface', 'lit'], freqFields: ['type', 'desc', 'mhz'], airports: details }));
console.log(`airports: ${unique.length} (towered ${unique.filter(r => r[8]).length}), with details: ${Object.keys(details).length}, retrieved ${retrieved}`);
