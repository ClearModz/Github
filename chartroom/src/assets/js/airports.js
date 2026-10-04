/* Airports page: search, nearby list, weather-colored map and a detail panel.
   Needs maplibregl, BASEMAP, AIRPORTS and LOCAL (local.js), WX (weather.js), FAA (faa.js), PLAN (planstore.js). */
(async () => {
  const $ = id => document.getElementById(id);
  const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => Math.round(n).toLocaleString('en-US');
  const EXAMPLES = ['KSEA', 'KBFI', 'KDEN', 'KATL', 'KORD', 'KLAX', 'KJFK', 'KDFW'];
  const DEFAULT_ID = 'KSEA';
  const COLORS = { VFR: '#34d399', MVFR: '#60a5fa', IFR: '#f87171', LIFR: '#d946ef', none: '#8a9bb3' };
  const SURFACE = { ASPH: 'Asphalt', 'ASPH-G': 'Asphalt', CONC: 'Concrete', 'CONC-G': 'Concrete', GRVL: 'Gravel', GRAVEL: 'Gravel', TURF: 'Turf', GRASS: 'Grass', GRS: 'Grass', DIRT: 'Dirt', SAND: 'Sand', WATER: 'Water', PEM: 'Asphalt or concrete', 'ASPH-TURF': 'Asphalt and turf', 'ASPH-CONC': 'Asphalt and concrete', 'CON': 'Concrete', 'ASP': 'Asphalt' };
  const FREQ_ORDER = ['ATIS', 'D-ATIS', 'ASOS', 'AWOS', 'CTAF', 'UNIC', 'CLD', 'GND', 'TWR', 'A/D', 'APP', 'DEP', 'CNTR', 'FSS', 'RDO', 'AFIS', 'MISC'];
  const FREQ_NAME = { ATIS: 'ATIS', 'D-ATIS': 'Digital ATIS', ASOS: 'ASOS', AWOS: 'AWOS', CTAF: 'CTAF', UNIC: 'UNICOM', CLD: 'Clearance delivery', GND: 'Ground', TWR: 'Tower', 'A/D': 'Approach and departure', APP: 'Approach', DEP: 'Departure', CNTR: 'Center', FSS: 'Flight service', RDO: 'Radio', AFIS: 'AFIS', MISC: 'Other' };
  const practiceUrl = a => new URL(`../practice/?lat=${a.lat}&lon=${a.lon}&z=11`, location.href).href;

  const st = { id: null, wx: {}, wxFailed: false };
  const detailEl = $('ap-detail'), listEl = $('ap-list'), countEl = $('ap-count'), noteEl = $('ap-wx-note');

  detailEl.innerHTML = '<div class="card-sec"><div class="skel" style="width:40%"></div></div>';
  try { await AIRPORTS.load(); } catch (e) { detailEl.innerHTML = '<div class="card-sec"><p class="msg">The airport list could not be loaded. Reload the page to try again.</p></div>'; return; }

  LOCAL.mountControl($('loc-mount'));
  await LOCAL.resume();

  /* ---------- map ---------- */
  const map = new maplibregl.Map({
    container: 'ap-map', center: [-98.5, 39.5], zoom: 3.4, minZoom: 2.5, maxZoom: 15, attributionControl: { compact: true },
    style: BASEMAP.style({ ap: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } })
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.getCanvas().setAttribute('aria-label', 'Airport map. Use the list to pick an airport.');
  let mapReady = false;
  map.once('style.load', () => {
    map.addLayer({ id: 'ap-ring', type: 'circle', source: 'ap', filter: ['==', ['get', 'sel'], 1], paint: { 'circle-radius': 13, 'circle-color': 'rgba(255,176,32,0.14)', 'circle-stroke-color': '#ffb020', 'circle-stroke-width': 2 } });
    map.addLayer({ id: 'ap-dot', type: 'circle', source: 'ap', paint: { 'circle-radius': ['match', ['get', 'rank'], 0, 7, 1, 6, 4.5], 'circle-color': ['get', 'color'], 'circle-stroke-color': '#0a0e14', 'circle-stroke-width': 1.5 } });
    map.addLayer({ id: 'ap-lbl', type: 'symbol', source: 'ap', layout: { 'text-field': ['get', 'id'], 'text-font': ['Open Sans Regular'], 'text-size': 11, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-optional': true, 'symbol-sort-key': ['get', 'rank'] }, paint: { 'text-color': '#e8eef7', 'text-halo-color': '#0a0e14', 'text-halo-width': 1.5 } });
    map.on('click', 'ap-dot', e => { const id = e.features[0]?.properties.id; if (id) select(id, true); });
    map.on('mouseenter', 'ap-dot', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'ap-dot', () => { map.getCanvas().style.cursor = ''; });
    mapReady = true; drawMap();
  });

  let shown = [];                                          // airports currently listed and drawn
  const rankOf = a => (a.type === 'L' ? 0 : a.type === 'M' ? 1 : 2);
  function drawMap() {
    if (!mapReady) return;
    const set = new Map(shown.map(a => [a.id, a]));
    const sel = AIRPORTS.get(st.id); if (sel) set.set(sel.id, sel);
    map.getSource('ap').setData({ type: 'FeatureCollection', features: [...set.values()].map(a => ({ type: 'Feature', properties: { id: a.id, rank: rankOf(a), sel: a.id === st.id ? 1 : 0, color: COLORS[(st.wx[a.id] && st.wx[a.id].category) || 'none'] }, geometry: { type: 'Point', coordinates: [a.lon, a.lat] } })) });
  }
  const fitTo = list => {
    if (!mapReady || !list.length) return;
    const b = new maplibregl.LngLatBounds(); list.forEach(a => b.extend([a.lon, a.lat]));
    map.fitBounds(b, { padding: 48, maxZoom: 9, duration: 700 });
  };

  /* ---------- list ---------- */
  const typeName = a => AIRPORTS.TYPE_NAME[a.type];
  function renderList(items, heading) {
    shown = items;
    countEl.textContent = heading;
    listEl.innerHTML = items.map(a => {
      const d = LOCAL.on ? LOCAL.distanceTo(a) : null;
      const where = [a.city, a.state].filter(Boolean).join(', ');
      const wx = st.wx[a.id];
      return `<li><a href="?id=${encodeURIComponent(a.id)}" data-id="${esc(a.id)}"${a.id === st.id ? ' aria-current="true"' : ''}>
        <span><b>${esc(a.name)}</b><small>${esc(a.id)}${where ? ' · ' + esc(where) : ''}</small></span>
        <span class="dist">${d != null ? `<span>${num(LOCAL.mi(d))}&nbsp;mi ${esc(LOCAL.geo.compass(LOCAL.geo.bearing(LOCAL.pos.lat, LOCAL.pos.lon, a.lat, a.lon)))}</span>` : ''}${wx ? `<span class="cat cat-${wx.category}">${wx.category}</span>` : ''}</span>
      </a></li>`;
    }).join('');
    drawMap();
  }
  function showDefaultList() {
    if (LOCAL.on && LOCAL.airports.length) {
      const items = LOCAL.airports.slice(0, 40);
      renderList(items, `${items.length} airports nearest you, within ${LOCAL.radiusMi} mi`);
      fitTo(items.slice(0, 12));
      loadWeatherFor(items);
    } else {
      const items = EXAMPLES.map(id => AIRPORTS.get(id)).filter(Boolean);
      renderList(items, 'Example airports. Turn on location to see the ones near you.');
      loadWeatherFor(items);
    }
  }
  function runSearch(q) {
    q = q.trim();
    if (!q) return showDefaultList();
    const items = AIRPORTS.search(q, 25);
    renderList(items, items.length ? `${items.length}${items.length === 25 ? '+' : ''} ${items.length === 1 ? 'airport matches' : 'airports match'} "${q}"` : `No airport matches "${q}". Try a city or a code.`);
    if (items.length) { fitTo(items.slice(0, 10)); loadWeatherFor(items); }
  }
  $('ap-form').addEventListener('submit', e => { e.preventDefault(); const first = listEl.querySelector('a'); if (first) select(first.dataset.id, true); });
  $('ap-q').addEventListener('input', e => runSearch(e.target.value));
  listEl.addEventListener('click', e => { const a = e.target.closest('a[data-id]'); if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); select(a.dataset.id, true); detailEl.focus({ preventScroll: true }); detailEl.scrollIntoView({ behavior: 'smooth', block: 'start' }); });

  /* ---------- weather for the dots and the list ---------- */
  let wxToken = 0;
  async function loadWeatherFor(items) {
    const token = ++wxToken;
    const ids = items.filter(a => AIRPORTS.isIcao(a.id)).slice(0, 40).map(a => a.id).filter(id => !st.wx[id]);
    if (!ids.length) return;
    noteEl.hidden = false; noteEl.textContent = 'Loading weather…';
    let failed = null;
    for (let i = 0; i < ids.length; i += 20) {
      const r = await WX.fetchMetars(ids.slice(i, i + 20));
      if (token !== wxToken) return;
      if (!r.ok) { failed = r.error; break; }
      Object.assign(st.wx, r.byId);
    }
    if (failed) { st.wxFailed = true; noteEl.innerHTML = `Weather unavailable (${esc(failed)}). <a href="https://aviationweather.gov/" target="_blank" rel="noopener">Open aviationweather.gov</a>`; }
    else { st.wxFailed = false; noteEl.hidden = true; }
    const cur = shown; renderList(cur, countEl.textContent);
    if (st.id) renderWeather();
  }

  /* ---------- detail ---------- */
  const agoText = m => (m < 90 ? `${m} minutes ago` : `${Math.round(m / 60)} hours ago`);
  const windText = w => !w ? 'Not reported' : w.speed === 0 ? 'Calm' : `${w.dir === 'VRB' ? 'Variable' : String(w.dir).padStart(3, '0') + '°'} at ${w.speed} kt${w.gust ? `, gusting ${w.gust}` : ''}`;
  const skyText = m => m.clouds.length ? m.clouds.map(c => c.base == null ? WX.COVER_WORDS[c.cover] : `${WX.COVER_WORDS[c.cover]} ${num(c.base)} ft`).join(', ') : 'Not reported';

  function weatherCard(a, m, source, tafs) {
    if (!m) return '';
    const extra = m.station !== a.id ? `<p class="hint-line">${esc(a.id)} has no report. This is the nearest reporting station, <b>${esc(m.station)}</b>${source ? `, about ${num(LOCAL.mi(source.nm))}&nbsp;mi away` : ''}.</p>` : '';
    const fog = m.spread != null && m.spread <= 3 ? '<p class="hint-line">Temperature and dew point are within 3°C. Fog or low cloud can form quickly.</p>' : '';
    const taf = tafs ? `<ul class="taf" aria-label="Forecast periods">${tafs.periods.map(p => `<li><span class="cat cat-${p.category}">${p.category}</span><span><span class="mono">${esc(p.text)}</span><small>${esc(p.label)}</small></span></li>`).join('')}</ul>` : '<p class="msg" style="margin-top:14px">No forecast (TAF) is issued for this station.</p>';
    return `<section class="card-sec" aria-labelledby="wx-h">
      <div class="wx-head"><h2 id="wx-h">Weather</h2><span class="cat cat-${m.category}">${m.category}</span><span class="muted mono">${esc(m.station)} · ${agoText(m.ageMin)}</span></div>
      <dl class="dl-grid">
        <div><dt>Wind</dt><dd>${esc(windText(m.wind))}</dd></div>
        <div><dt>Visibility</dt><dd>${m.vis == null ? 'Not reported' : esc(m.visText) + ' SM'}</dd></div>
        <div><dt>Sky</dt><dd>${esc(skyText(m))}${m.ceiling ? `<small>Ceiling ${num(m.ceiling)} ft</small>` : '<small>No ceiling</small>'}</dd></div>
        <div><dt>Temp and dew point</dt><dd>${m.temp ?? '?'}°C / ${m.dew ?? '?'}°C${m.spread != null ? `<small>Spread ${m.spread}°</small>` : ''}</dd></div>
        <div><dt>Altimeter</dt><dd>${m.altim ? m.altim.toFixed(2) + ' inHg' : 'Not reported'}</dd></div>
        ${m.wx.length ? `<div><dt>Weather</dt><dd>${esc(m.wx.join(', '))}</dd></div>` : ''}
      </dl>
      ${extra}${fog}
      <p class="raw mono">${esc(m.raw)}</p>
      <h3 style="margin-top:22px;font-size:16px">Forecast</h3>${taf}
      <div class="actions"><button class="btn sm" type="button" id="use-perf">Use these conditions in Performance</button></div>
      <p class="muted" style="margin-top:12px">METAR winds are reported in degrees true. Tower and ATIS winds are magnetic.</p>
    </section>`;
  }

  async function renderWeather() {
    const a = AIRPORTS.get(st.id); const slot = $('wx-slot'); if (!slot || !a) return;
    let m = st.wx[a.id], station = a.id, src = null;
    const links = WX.officialLinks(a.id);
    if (!AIRPORTS.isIcao(a.id)) { slot.innerHTML = `<section class="card-sec"><h2>Weather</h2><p class="msg">${esc(a.id)} has no weather reporting. See the nearest reporting airport on the map, or check <a href="${esc(links.metar)}" target="_blank" rel="noopener">aviationweather.gov</a>.</p></section>`; }
    const myToken = ++wxToken;
    if (!m && AIRPORTS.isIcao(a.id)) {
      slot.innerHTML = '<section class="card-sec"><h2>Weather</h2><div class="skel" style="width:60%"></div></section>';
      const r = await WX.fetchMetars([a.id]); if (myToken !== wxToken || st.id !== a.id) return;
      if (!r.ok) { slot.innerHTML = `<section class="card-sec"><h2>Weather</h2><p class="msg">Live weather could not be loaded (${esc(r.error)}). Open it directly at <a href="${esc(links.metar)}" target="_blank" rel="noopener">aviationweather.gov</a>.</p></section>`; return; }
      m = r.byId[a.id];
      if (m) st.wx[a.id] = m;
    }
    if (!m) {                                                // no report here: look for the nearest station that has one
      const near = AIRPORTS.rows.filter(x => x.id !== a.id && AIRPORTS.isIcao(x.id)).map(x => ({ x, nm: LOCAL.geo.nm(a.lat, a.lon, x.lat, x.lon) })).filter(o => o.nm <= 60).sort((p, q) => p.nm - q.nm).slice(0, 8);
      const r = near.length ? await WX.fetchMetars(near.map(o => o.x.id)) : { ok: true, byId: {} };
      if (myToken !== wxToken || st.id !== a.id) return;
      for (const o of near) if (r.byId && r.byId[o.x.id]) { m = r.byId[o.x.id]; station = o.x.id; src = o; st.wx[station] = m; break; }
    }
    if (!m) { slot.innerHTML = `<section class="card-sec"><h2>Weather</h2><p class="msg">No recent report was found for ${esc(a.id)} or nearby. Check <a href="${esc(links.metar)}" target="_blank" rel="noopener">aviationweather.gov</a>.</p></section>`; drawMap(); return; }
    const tr = await WX.fetchTafs([station]); if (myToken !== wxToken || st.id !== a.id) return;
    slot.innerHTML = weatherCard(a, m, src, tr.ok ? tr.byId[station] : null);
    renderList(shown, countEl.textContent);
    $('use-perf')?.addEventListener('click', () => {
      const w = m.wind;
      PLAN.set({ perf: { airport: a.id, elev: a.elev, temp: m.temp, altim: m.altim, windDirTrue: w && w.dir !== 'VRB' ? w.dir : null, windSpd: w ? w.speed : 0, source: station, time: m.time.toISOString() }, from: a.id });
      location.href = new URL('../plan/#perf', location.href).href;
    });
  }

  function renderRunways(a, d) {
    if (!d || !d.r.length) return '<section class="card-sec"><h2>Runways</h2><p class="msg">No runway data is listed for this airport.</p></section>';
    const rows = d.r.map(r => {
      const h = [AIRPORTS.runwayHeading(r[0]), AIRPORTS.runwayHeading(r[1])];
      return `<tr><td>${esc(r[0])}${r[1] ? ' / ' + esc(r[1]) : ''}</td><td class="num">${r[2] ? num(r[2]) : '?'} × ${r[3] ? num(r[3]) : '?'} ft</td><td>${esc(SURFACE[r[4]] || r[4] || 'Unknown')}</td><td>${r[5] ? 'Lighted' : 'Not lighted'}</td><td class="num">${h[0] ? String(h[0]).padStart(3, '0') + '°' : ''}${h[1] ? ' / ' + String(h[1]).padStart(3, '0') + '°' : ''}</td></tr>`;
    }).join('');
    return `<section class="card-sec" aria-labelledby="rw-h"><h2 id="rw-h">Runways</h2><div class="tbl-wrap" tabindex="0" role="region" aria-label="Runways table"><table class="t"><thead><tr><th scope="col">Runway</th><th scope="col" class="num">Size</th><th scope="col">Surface</th><th scope="col">Lights</th><th scope="col" class="num">Approx. magnetic heading</th></tr></thead><tbody>${rows}</tbody></table></div><p class="muted" style="margin-top:12px">Runway numbers are the magnetic heading divided by ten, so 16 points near 160°. Check the Chart Supplement for current runway data.</p></section>`;
  }
  function renderFreqs(a, d) {
    if (!d || !d.f.length) return '<section class="card-sec"><h2>Radio frequencies</h2><p class="msg">No frequencies are listed for this airport.</p></section>';
    const rows = [...d.f].sort((p, q) => { const i = FREQ_ORDER.indexOf(p[0]), j = FREQ_ORDER.indexOf(q[0]); return (i < 0 ? 99 : i) - (j < 0 ? 99 : j) || p[2] - q[2]; })
      .map(f => `<tr><td>${esc(FREQ_NAME[f[0]] || f[0])}</td><td>${esc(f[1])}</td><td class="num">${f[2].toFixed(3).replace(/0$/, '')}</td></tr>`).join('');
    return `<section class="card-sec" aria-labelledby="fq-h"><h2 id="fq-h">Radio frequencies</h2><div class="tbl-wrap" tabindex="0" role="region" aria-label="Frequencies table"><table class="t"><thead><tr><th scope="col">Use</th><th scope="col">Name</th><th scope="col" class="num">MHz</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  }
  async function renderAirspace(a) {
    const slot = $('as-slot'); if (!slot) return;
    slot.innerHTML = '<section class="card-sec"><h2>Airspace here</h2><div class="skel" style="width:50%"></div></section>';
    const r = await FAA.airspaceAt(a.lon, a.lat); if (st.id !== a.id) return;
    if (r.error) { slot.innerHTML = `<section class="card-sec"><h2>Airspace here</h2><p class="msg">The FAA airspace service could not be reached (${esc(r.error)}). See it on the <a href="${esc(practiceUrl(a))}">sectional</a>.</p></section>`; return; }
    if (!r.areas.length) { slot.innerHTML = `<section class="card-sec" aria-labelledby="as-h"><h2 id="as-h">Airspace here</h2><p class="msg">No Class B, C, D or E surface area covers this point. It is probably Class G at the surface, with Class E starting higher. Open the <a href="${esc(practiceUrl(a))}">sectional</a> to check.</p></section>`; return; }
    slot.innerHTML = `<section class="card-sec" aria-labelledby="as-h"><h2 id="as-h">Airspace here</h2><div class="tbl-wrap" tabindex="0" role="region" aria-label="Airspace table"><table class="t"><thead><tr><th scope="col">Class</th><th scope="col">Name</th><th scope="col">Floor</th><th scope="col">Ceiling</th></tr></thead><tbody>${r.areas.map(x => `<tr><td>Class ${esc(x.cls)}</td><td>${esc(x.name)}</td><td>${esc(x.floor)}</td><td>${esc(x.ceil)}</td></tr>`).join('')}</tbody></table></div><p class="muted" style="margin-top:12px">${esc(FAA.CLASS_NOTE[r.areas[0].cls] || '')}</p></section>`;
  }
  async function renderTfrs(a) {
    const slot = $('tfr-slot'); if (!slot) return;
    const links = WX.officialLinks(a.id);
    slot.innerHTML = `<section class="card-sec"><h2>TFRs and NOTAMs</h2><div class="skel" style="width:45%"></div></section>`;
    const r = await FAA.tfrs(a.state); if (st.id !== a.id) return;
    const body = r.error
      ? `<p class="msg">The FAA TFR list could not be loaded (${esc(r.error)}).</p>`
      : r.list.length
        ? `<ul class="taf">${r.list.slice(0, 6).map(t => `<li><span class="cat cat-IFR">TFR</span><span><b>${esc(t.type || 'Restriction')}</b> ${esc(t.id ? '· ' + t.id : '')}<small>${esc(t.description)}</small></span></li>`).join('')}</ul><p class="muted" style="margin-top:12px">${r.list.length} listed for ${esc(a.state)}. A TFR can reach across state lines and its size matters: open the official map before you rely on this.</p>`
        : `<p class="msg">No TFRs are listed for ${esc(a.state)} right now. A TFR can reach across state lines, so check the official map.</p>`;
    slot.innerHTML = `<section class="card-sec" aria-labelledby="tfr-h"><h2 id="tfr-h">TFRs and NOTAMs</h2>${body}<ul class="links"><li><a href="${esc(links.tfrs)}" target="_blank" rel="noopener">FAA TFR map</a></li><li><a href="${esc(links.notams)}" target="_blank" rel="noopener">FAA NOTAM Search (enter ${esc(a.id)})</a></li></ul></section>`;
  }

  async function select(id, push) {
    const a = AIRPORTS.get(id);
    if (!a) { detailEl.innerHTML = `<section class="card-sec"><h2>Airport not found</h2><p class="msg">No airport with the code "${esc(id)}" is in the US list. Try the search box.</p></section>`; return; }
    st.id = a.id;
    if (push) history.pushState({}, '', `?id=${encodeURIComponent(a.id)}`);
    document.title = `${a.id} ${a.name} | Chartroom`;
    const d = LOCAL.on ? LOCAL.distanceTo(a) : null;
    const links = WX.officialLinks(a.id);
    detailEl.innerHTML = `
      <section class="card-sec ap-title">
        <div class="chips"><span class="chip-s">${esc(typeName(a))}</span><span class="chip-s"><i class="ph ${a.twr ? 'ph-radio' : 'ph-radio-button'}" aria-hidden="true"></i>${a.twr ? 'Towered' : 'Non-towered'}</span></div>
        <h2>${esc(a.name)}</h2>
        <div class="ap-meta"><span><b>${esc(a.id)}</b>${a.iata ? ' · ' + esc(a.iata) : ''}</span><span>${esc([a.city, a.state].filter(Boolean).join(', '))}</span><span>Elevation <b>${num(a.elev)} ft</b></span><span class="mono">${a.lat.toFixed(4)}, ${a.lon.toFixed(4)}</span>${d != null ? `<span><b>${num(LOCAL.mi(d))} mi</b> from you</span>` : ''}</div>
        <div class="actions">
          <a class="btn sm" href="${esc(practiceUrl(a))}">View on the sectional</a>
          <button class="btn sm ghost" type="button" id="plan-from">Plan a flight from here</button>
        </div>
        <ul class="links"><li><a href="${esc(links.airnav)}" target="_blank" rel="noopener">AirNav page</a></li><li><a href="${esc(links.metar)}" target="_blank" rel="noopener">Weather at aviationweather.gov</a></li></ul>
      </section>
      <div id="wx-slot"></div>
      <div id="rw-slot"><section class="card-sec"><h2>Runways</h2><div class="skel" style="width:55%"></div></section></div>
      <div id="fq-slot"></div>
      <div id="as-slot"></div>
      <div id="tfr-slot"></div>`;
    $('plan-from').addEventListener('click', () => { PLAN.set({ from: a.id }); location.href = new URL('../plan/#route', location.href).href; });
    listEl.querySelectorAll('a[aria-current]').forEach(x => x.removeAttribute('aria-current'));
    const cur = listEl.querySelector(`a[data-id="${CSS.escape(a.id)}"]`); if (cur) cur.setAttribute('aria-current', 'true');
    drawMap();
    if (mapReady) map.easeTo({ center: [a.lon, a.lat], zoom: Math.max(map.getZoom(), 9), duration: 700 });
    renderWeather(); renderAirspace(a); renderTfrs(a);
    try { await AIRPORTS.loadDetails(); } catch { $('rw-slot').innerHTML = '<section class="card-sec"><h2>Runways</h2><p class="msg">Runway and frequency data could not be loaded.</p></section>'; return; }
    if (st.id !== a.id) return;
    const det = AIRPORTS.details[a.id];
    $('rw-slot').innerHTML = renderRunways(a, det); $('fq-slot').innerHTML = renderFreqs(a, det);
  }

  /* ---------- start ---------- */
  const startId = (new URLSearchParams(location.search).get('id') || '').toUpperCase();
  const first = startId || (LOCAL.on && LOCAL.airports[0] ? LOCAL.airports[0].id : DEFAULT_ID);
  showDefaultList();
  await select(first, false);
  window.addEventListener('popstate', () => { const id = (new URLSearchParams(location.search).get('id') || '').toUpperCase(); if (id) select(id, false); });
  LOCAL.subscribe((L, reason) => {
    if (reason === 'radius' || reason === 'enabled' || reason === 'disabled' || reason === 'resumed') {
      if (!$('ap-q').value.trim()) showDefaultList();
      if (reason === 'enabled' && L.airports[0] && !new URLSearchParams(location.search).get('id')) select(L.airports[0].id, false);
    }
  });
})();
