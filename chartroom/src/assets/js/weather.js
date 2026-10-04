/* Chartroom weather: METAR and TAF parsing, flight category, and fetching from aviationweather.gov.
   window.WX.parseMetar(raw), WX.flightCategory(ceilingFt, visSM), WX.splitTaf(raw), WX.fetchMetars(ids), WX.fetchTafs(ids).
   The parser is plain code with no DOM use so it can be tested in Node (build/test-units.mjs).
   Study use only. Not for flight planning. */
(() => {
  const WX = {};
  const API = 'https://aviationweather.gov/api/data/';

  const WX_WORDS = { RA: 'rain', SN: 'snow', DZ: 'drizzle', BR: 'mist', FG: 'fog', TS: 'thunderstorm', SH: 'showers', FZ: 'freezing', HZ: 'haze', FU: 'smoke', GR: 'hail', GS: 'small hail', PL: 'ice pellets', SG: 'snow grains', IC: 'ice crystals', UP: 'unknown precipitation', SQ: 'squalls', FC: 'funnel cloud', DS: 'dust storm', SS: 'sandstorm', VA: 'volcanic ash', DU: 'dust', SA: 'sand', PY: 'spray', PO: 'dust whirls', MI: 'shallow', PR: 'partial', BC: 'patches', DR: 'low drifting', BL: 'blowing' };
  const COVER = { FEW: 'few', SCT: 'scattered', BKN: 'broken', OVC: 'overcast', VV: 'sky obscured, vertical visibility', SKC: 'clear', CLR: 'clear', NSC: 'no significant cloud', NCD: 'no cloud detected' };
  WX.COVER_WORDS = COVER;

  /** FAA categories. Ceiling in feet AGL (null when none), visibility in statute miles (null when unknown). */
  WX.flightCategory = (ceilingFt, visSM) => {
    const c = ceilingFt == null ? Infinity : ceilingFt, v = visSM == null ? Infinity : visSM;
    if (c < 500 || v < 1) return 'LIFR';
    if (c < 1000 || v < 3) return 'IFR';
    if (c <= 3000 || v <= 5) return 'MVFR';
    return 'VFR';
  };

  const WX_TOKEN = /^(\+|-)?(VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)?((DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)+)$/;
  const describeWx = t => {
    const m = WX_TOKEN.exec(t); if (!m) return null;
    const intensity = m[1] === '+' ? 'heavy ' : m[1] === '-' ? 'light ' : '';
    const vc = m[2] ? ' in the vicinity' : '';
    const desc = m[3] ? WX_WORDS[m[3]] + ' ' : '';
    const kinds = m[4].match(/.{2}/g).map(k => WX_WORDS[k]).join(' and ');
    return intensity + desc + kinds + vc;
  };
  const visFrom = (tokens, i) => {                        // returns [miles, tokensUsed] or null
    const t = tokens[i];
    let m = /^(P|M)?(\d+)SM$/.exec(t);
    if (m) return [m[1] === 'P' ? Number(m[2]) + 0.1 : Number(m[2]), 1, m[1]];
    m = /^(P|M)?(\d+)\/(\d+)SM$/.exec(t);
    if (m) return [Number(m[2]) / Number(m[3]), 1, m[1]];
    if (/^\d+$/.test(t) && t.length <= 2) {               // "1 1/2SM"
      const f = /^(\d+)\/(\d+)SM$/.exec(tokens[i + 1] || '');
      if (f) return [Number(t) + Number(f[1]) / Number(f[2]), 2, null];
    }
    return null;
  };

  /** Pulls wind, visibility, weather and sky out of a token list. Shared by METAR and each TAF period. */
  function conditions(tokens) {
    const out = { wind: null, vis: null, visText: null, wx: [], clouds: [], ceiling: null };
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      let m = /^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT$/.exec(t);
      if (m) { out.wind = { dir: m[1] === 'VRB' ? 'VRB' : Number(m[1]), speed: Number(m[2]), gust: m[3] ? Number(m[3]) : null }; continue; }
      const v = visFrom(tokens, i);
      if (v && out.vis == null) { out.vis = v[0]; out.visText = v[2] === 'P' ? `${Math.floor(v[0])}+` : v[2] === 'M' ? `less than ${v[0]}` : String(Math.round(v[0] * 100) / 100); i += v[1] - 1; continue; }
      m = /^(FEW|SCT|BKN|OVC)(\d{3})(CB|TCU)?$/.exec(t);
      if (m) { out.clouds.push({ cover: m[1], base: Number(m[2]) * 100, type: m[3] || null }); continue; }
      m = /^VV(\d{3})$/.exec(t);
      if (m) { out.clouds.push({ cover: 'VV', base: Number(m[1]) * 100, type: null }); continue; }
      if (/^(SKC|CLR|NSC|NCD)$/.test(t)) { out.clouds.push({ cover: t, base: null, type: null }); continue; }
      const w = describeWx(t); if (w) out.wx.push(w);
    }
    const layers = out.clouds.filter(c => ['BKN', 'OVC', 'VV'].includes(c.cover));
    out.ceiling = layers.length ? Math.min(...layers.map(c => c.base)) : null;
    out.category = WX.flightCategory(out.ceiling, out.vis);
    return out;
  }
  WX.conditions = conditions;

  /** Decodes one METAR or SPECI line. Returns null if it does not look like one. */
  WX.parseMetar = (raw, now = new Date()) => {
    const text = String(raw || '').replace(/\s+/g, ' ').trim();
    const rmk = text.indexOf(' RMK ');
    const body = rmk === -1 ? text : text.slice(0, rmk);
    const tokens = body.split(' ');
    let i = 0;
    const kind = /^(METAR|SPECI)$/.test(tokens[0]) ? tokens[i++] : 'METAR';
    const station = tokens[i++];
    if (!/^[A-Z][A-Z0-9]{3}$/.test(station || '')) return null;
    const tm = /^(\d{2})(\d{2})(\d{2})Z$/.exec(tokens[i] || '');
    if (!tm) return null;
    i++;
    const r = { raw: text, kind, station, day: Number(tm[1]), hour: Number(tm[2]), minute: Number(tm[3]), auto: false, corrected: false };
    // observation time: the latest moment at or before "now" with that day, hour and minute (UTC)
    let t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), r.day, r.hour, r.minute));
    if (t > now) t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, r.day, r.hour, r.minute));
    r.time = t; r.ageMin = Math.max(0, Math.round((now - t) / 60000));
    r.auto = tokens.includes('AUTO'); r.corrected = tokens.includes('COR');
    Object.assign(r, conditions(tokens.slice(i)));
    for (const tok of tokens.slice(i)) {
      let m = /^(M?\d{2})\/(M?\d{2})?$/.exec(tok);
      if (m) { const n = s => s ? Number(s.replace('M', '-')) : null; r.temp = n(m[1]); r.dew = n(m[2]); r.spread = r.temp != null && r.dew != null ? r.temp - r.dew : null; }
      m = /^A(\d{4})$/.exec(tok); if (m) r.altim = Number(m[1]) / 100;
    }
    return r;
  };

  /** Splits a raw TAF into its base forecast and the FM, TEMPO, BECMG and PROB periods, each with a flight category. */
  WX.splitTaf = raw => {
    const text = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!text) return null;
    const rmk = text.indexOf(' RMK ');
    const body = rmk === -1 ? text : text.slice(0, rmk);
    const parts = body.split(/ (?=(?:FM\d{6}|TEMPO|BECMG|PROB[34]0)\b)/);
    const head = /^(?:TAF )?(?:AMD |COR )?([A-Z][A-Z0-9]{3}) (\d{6}Z)(?: (\d{4}\/\d{4}))?/.exec(parts[0]);
    const periods = parts.map((p, k) => {
      let label = 'Forecast';
      if (k === 0 && head) label = head[3] ? `Valid ${head[3]}` : 'Forecast';
      else if (/^FM/.test(p)) { const m = /^FM(\d{2})(\d{2})(\d{2})/.exec(p); label = `From day ${m[1]} ${m[2]}:${m[3]}Z`; }
      else if (/^TEMPO/.test(p)) label = 'Temporarily';
      else if (/^BECMG/.test(p)) label = 'Becoming';
      else if (/^PROB/.test(p)) label = p.slice(0, 6) + ' chance';
      const tokens = p.split(' ');
      return { label, text: p, ...conditions(tokens) };
    });
    return { station: head && head[1], issued: head && head[2], raw: text, periods };
  };

  /* ---------- fetching ---------- */
  const cache = new Map();
  const get = async (path, ttlMs = 300000) => {
    const hit = cache.get(path); if (hit && Date.now() - hit.t < ttlMs) return hit.v;
    const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 10000);
    try {
      const res = await fetch(API + path, { signal: ac.signal });
      if (!res.ok) return { error: 'status ' + res.status };
      const v = { text: await res.text() };
      cache.set(path, { t: Date.now(), v }); return v;
    } catch (e) { return { error: e && e.name === 'AbortError' ? 'timed out' : 'unreachable' }; }
    finally { clearTimeout(timer); }
  };
  /** Latest METAR per station for up to ~20 ids. Resolves to { ok, byId, error }. */
  WX.fetchMetars = async ids => {
    ids = [...new Set(ids)].filter(x => AIRPORTS_ICAO(x));
    if (!ids.length) return { ok: true, byId: {} };
    const r = await get(`metar?ids=${ids.join(',')}&format=raw&hours=3`);
    if (r.error) return { ok: false, error: r.error, byId: {} };
    const byId = {};
    for (const line of r.text.split('\n')) { const p = WX.parseMetar(line); if (p && !byId[p.station]) byId[p.station] = p; }   // newest line first
    return { ok: true, byId };
  };
  /** Latest TAF text per station. */
  WX.fetchTafs = async ids => {
    ids = [...new Set(ids)].filter(x => AIRPORTS_ICAO(x));
    if (!ids.length) return { ok: true, byId: {} };
    const r = await get(`taf?ids=${ids.join(',')}&format=raw`);
    if (r.error) return { ok: false, error: r.error, byId: {} };
    const byId = {};
    const blocks = r.text.replace(/\r/g, '').split(/\n(?=TAF\b|[A-Z]{4} \d{6}Z)/);
    for (const b of blocks) { const t = WX.splitTaf(b); if (t && t.station && !byId[t.station]) byId[t.station] = t; }
    return { ok: true, byId };
  };
  const AIRPORTS_ICAO = id => /^K[A-Z0-9]{3}$/.test(id) || /^P[A-Z]{3}$/.test(id);

  /** Links to the official sources for an airport. */
  WX.officialLinks = id => ({
    metar: `https://aviationweather.gov/data/metar/?ids=${encodeURIComponent(id)}&taf=1`,
    airnav: `https://www.airnav.com/airport/${encodeURIComponent(id)}`,
    notams: 'https://notams.aim.faa.gov/notamSearch/',
    tfrs: 'https://tfr.faa.gov/'
  });

  window.WX = WX;
})();
