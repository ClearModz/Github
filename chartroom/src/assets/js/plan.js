/* Plan page: route, weight and balance, performance, fuel and time, saved plans.
   Needs AIRPORTS and LOCAL (local.js), WX (weather.js), CALC (calc.js), PLAN (planstore.js), maplibregl and BASEMAP.
   Everything is practice math for study. It is not flight planning. */
(async () => {
  const $ = id => document.getElementById(id);
  const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const C = CALC;
  const n0 = x => Math.round(x).toLocaleString('en-US');
  const n1 = x => (Math.round(x * 10) / 10).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const fin = x => typeof x === 'number' && isFinite(x);
  const EX_FROM = 'KBFI', EX_TO = 'KPDX';

  const EXAMPLE_AC = {
    name: 'Example 4-seat trainer (illustrative numbers)', emptyW: 1650, emptyArm: 40, maxW: 2550, bagMax: 120,
    frontArm: 37, rearArm: 73, bagArm: 95, fuelArm: 48, fuelCap: 53, fuelLbGal: 6,
    env: [[35, 1500], [35, 1950], [41, 2550], [47.3, 2550], [47.3, 1500]]
  };
  const acLoad = () => { try { const v = JSON.parse(localStorage.getItem('chartroom.aircraft')); if (v && v.env && v.env.length >= 3) return { ...EXAMPLE_AC, ...v }; } catch { /* use the example */ } return { ...EXAMPLE_AC, custom: false }; };
  const acSave = a => { try { localStorage.setItem('chartroom.aircraft', JSON.stringify(a)); } catch { /* storage blocked */ } };

  try { await AIRPORTS.load(); } catch { document.querySelector('.plan .wrap').insertAdjacentHTML('afterbegin', '<p class="err-line">The airport list could not be loaded. Reload the page to try again.</p>'); return; }
  LOCAL.mountControl($('loc-mount'));
  await LOCAL.resume();

  const norm = p => ({
    ...p, from: p.from || EX_FROM, to: p.to || EX_TO, via: p.via || [],
    wb: { front: 340, rear: 0, bag: 0, fuel: 40, ...(p.wb || {}) },
    perf: { airport: '', elev: '', temp: 15, altim: 29.92, windDirTrue: 0, windSpd: 0, xl: 15, roll: '', varEast: 0, ...(p.perf || {}) }
  });
  let plan = norm(PLAN.get());
  const persist = patch => { plan = norm(PLAN.set(patch)); };
  let ac = acLoad();
  let routeCalc = null;

  /* ---------- helpers ---------- */
  const num = id => { const v = $(id).value.trim(); if (v === '') return null; const x = Number(v); return fin(x) ? x : null; };
  const setv = (id, v) => { const el = $(id); if (el && document.activeElement !== el) el.value = v == null || (typeof v === 'number' && !fin(v)) ? '' : v; };
  const resolve = text => {
    const v = String(text || '').trim().toUpperCase(); if (!v) return null;
    const direct = AIRPORTS.get(v) || AIRPORTS.rows.find(a => a.iata === v);
    return direct || AIRPORTS.search(text, 1)[0] || null;
  };
  const where = a => [a.city, a.state].filter(Boolean).join(', ');
  const vardeg = (idNum, idDir) => { const m = num(idNum); return m == null ? 0 : (($(idDir).value === 'W') ? -1 : 1) * m; };
  const setVar = (idNum, idDir, east) => { setv(idNum, Math.abs(east)); $(idDir).value = east < 0 ? 'W' : 'E'; };
  const chipFor = (kind, text, icon) => `<span class="status ${kind}"><i class="ph ${icon}" aria-hidden="true"></i>${esc(text)}</span>`;
  const OK = t => chipFor('ok', t, 'ph-check-circle'), WARN = t => chipFor('warn', t, 'ph-warning'), BAD = t => chipFor('bad', t, 'ph-x-circle');

  /* airport inputs: suggestions as you type, normalised to the code when you leave the field */
  const dl = $('dl-airports');
  function bindAirport(id, nameId, onChange) {
    const el = $(id), name = $(nameId);
    const paint = () => { const a = resolve(el.value); if (!el.value.trim()) { name.textContent = ''; name.className = 'ap-name'; el.removeAttribute('aria-invalid'); } else if (a && (a.id === el.value.trim().toUpperCase() || a.iata === el.value.trim().toUpperCase())) { name.textContent = `${a.name}, ${where(a)} · ${n0(a.elev)} ft`; name.className = 'ap-name'; el.removeAttribute('aria-invalid'); } else if (a) { name.textContent = `Press Tab to use ${a.id}: ${a.name}`; name.className = 'ap-name'; el.removeAttribute('aria-invalid'); } else { name.textContent = 'No US airport matches that. Try a city or code.'; name.className = 'ap-name err'; el.setAttribute('aria-invalid', 'true'); } };
    el.addEventListener('input', () => {
      const res = AIRPORTS.search(el.value, 8);
      dl.innerHTML = res.map(a => `<option value="${esc(a.id)}" label="${esc(a.name + ', ' + where(a))}"></option>`).join('');
      paint(); onChange(false);
    });
    el.addEventListener('change', () => { const a = resolve(el.value); if (a) el.value = a.id; paint(); onChange(true); });
    paint();
  }
  const paintAll = () => ['r-from', 'r-via1', 'r-via2', 'r-to', 'p-apt'].forEach(id => $(id).dispatchEvent(new Event('input')));

  /* ---------- ROUTE ---------- */
  const routeMapEl = $('r-map');
  const rmap = new maplibregl.Map({ container: 'r-map', center: [-122.3, 47.5], zoom: 6, attributionControl: { compact: true }, interactive: true, style: BASEMAP.style({ rt: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } }) });
  rmap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  rmap.getCanvas().setAttribute('aria-label', 'Map of the planned route');
  let rmapReady = false;
  rmap.once('style.load', () => {
    rmap.addLayer({ id: 'rt-line', type: 'line', source: 'rt', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#ffb020', 'line-width': 3, 'line-dasharray': [2, 1.5] } });
    rmap.addLayer({ id: 'rt-pt', type: 'circle', source: 'rt', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 6, 'circle-color': '#ffb020', 'circle-stroke-color': '#0a0e14', 'circle-stroke-width': 2 } });
    rmap.addLayer({ id: 'rt-lbl', type: 'symbol', source: 'rt', filter: ['==', ['geometry-type'], 'Point'], layout: { 'text-field': ['get', 'id'], 'text-font': ['Open Sans Regular'], 'text-size': 12, 'text-offset': [0, 1.2], 'text-anchor': 'top' }, paint: { 'text-color': '#e8eef7', 'text-halo-color': '#0a0e14', 'text-halo-width': 1.6 } });
    rmapReady = true; drawRouteMap();
  });
  function drawRouteMap() {
    if (!rmapReady) return;
    const pts = routeCalc ? routeCalc.points : [];
    const feats = pts.length ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts.map(a => [a.lon, a.lat]) } }, ...pts.map(a => ({ type: 'Feature', properties: { id: a.id }, geometry: { type: 'Point', coordinates: [a.lon, a.lat] } }))] : [];
    rmap.getSource('rt').setData({ type: 'FeatureCollection', features: feats });
    if (pts.length) { const b = new maplibregl.LngLatBounds(); pts.forEach(a => b.extend([a.lon, a.lat])); rmap.fitBounds(b, { padding: 50, maxZoom: 10, duration: 600 }); }
  }

  function readRoute() {
    const ids = [$('r-from').value, $('r-via1').value, $('r-via2').value, $('r-to').value].map(v => v.trim()).filter(Boolean);
    return ids.map(resolve);
  }
  function computeRoute() {
    const tas = num('r-tas'), burn = num('r-burn'), wdir = num('r-wdir') ?? 0, wspd = num('r-wspd') ?? 0, vare = vardeg('r-var', 'r-vardir');
    const pts = readRoute();
    if (pts.length < 2) return { error: 'Enter a From and a To airport.', points: [] };
    if (pts.some(p => !p)) return { error: 'One of the airports was not found. Check the codes.', points: [] };
    if (!tas || tas < 40) return { error: 'Enter a true airspeed of at least 40 knots.', points: pts };
    const legs = []; let dist = 0, mins = 0, fuel = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const d = C.distanceNm(a.lat, a.lon, b.lat, b.lon), tc = C.trueCourse(a.lat, a.lon, b.lat, b.lon);
      const wt = C.windTriangle(tc, tas, wdir, wspd);
      if (!wt) return { error: `On the leg ${a.id} to ${b.id} the wind is too strong to hold the course at ${tas} knots.`, points: pts };
      const ete = C.minutes(d, wt.gs), f = burn ? burn * ete / 60 : null;
      legs.push({ from: a, to: b, d, tc, wca: wt.wca, th: wt.th, mh: C.trueToMagnetic(wt.th, vare), gs: wt.gs, ete, fuel: f, head: wt.headwind });
      dist += d; mins += ete; if (f != null) fuel += f;
    }
    const gs = dist / (mins / 60);
    return { points: pts, legs, dist, mins, fuel: burn ? fuel : null, gs, tas, burn, vare, wdir, wspd };
  }
  const wcaText = w => Math.abs(w) < 0.5 ? '0°' : `${w < 0 ? 'L' : 'R'} ${Math.round(Math.abs(w))}°`;

  function fuelFigures(rc) {
    const night = $('r-night').checked, resMin = C.vfrReserveMin(night), taxi = plan.taxi ?? 1;
    if (!rc || rc.fuel == null) return null;
    const f = C.fuelPlan({ eteMin: rc.mins, burnGph: rc.burn, reserveMin: resMin, taxiGal: taxi });
    return { ...f, resMin, fob: plan.fuelOnBoard, margin: plan.fuelOnBoard - f.total };
  }
  function renderRoute() {
    routeCalc = computeRoute();
    const out = $('r-out'), rc = routeCalc;
    $('r-sect').href = rc.points.length ? new URL(`../practice/?lat=${(rc.points[0].lat + rc.points[rc.points.length - 1].lat) / 2}&lon=${(rc.points[0].lon + rc.points[rc.points.length - 1].lon) / 2}&z=8`, location.href).href : '../practice/';
    if (rc.error) { out.innerHTML = `<div class="res"><p class="err-line">${esc(rc.error)}</p></div>`; drawRouteMap(); renderFuel(); renderWb(); return; }
    const ff = fuelFigures(rc);
    const rows = rc.legs.map(l => `<tr><td>${esc(l.from.id)} to ${esc(l.to.id)}</td><td>${n1(l.d)}</td><td>${C.hdg(l.tc)}°</td><td>${wcaText(l.wca)}</td><td>${C.hdg(l.th)}°</td><td>${C.hdg(l.mh)}°</td><td>${n0(l.gs)}</td><td>${C.hm(l.ete)}</td><td>${l.fuel == null ? '' : n1(l.fuel)}</td></tr>`).join('');
    out.innerHTML = `<section class="res" aria-labelledby="rt-h">
      <h2 id="rt-h">${esc(rc.points[0].id)} to ${esc(rc.points[rc.points.length - 1].id)}</h2>
      <dl class="big">
        <div><dt>Distance</dt><dd>${n0(rc.dist)}<small> NM (${n0(C.smi(rc.dist))} mi)</small></dd></div>
        <div><dt>Time en route</dt><dd>${C.hm(rc.mins)}</dd></div>
        <div><dt>Average ground speed</dt><dd>${n0(rc.gs)}<small> kt</small></dd></div>
        ${ff ? `<div><dt>Trip fuel</dt><dd>${n1(ff.trip)}<small> gal</small></dd></div>` : ''}
      </dl>
      <div class="tbl-wrap" style="margin-top:18px" tabindex="0" role="region" aria-label="Route legs table"><table class="t"><thead><tr><th scope="col">Leg</th><th scope="col">NM</th><th scope="col">True course</th><th scope="col">Wind correction</th><th scope="col">True heading</th><th scope="col">Magnetic heading</th><th scope="col">Ground speed</th><th scope="col">Time</th><th scope="col">Fuel (gal)</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="muted" style="margin-top:12px">Wind ${C.hdg(rc.wdir)}° true at ${n0(rc.wspd)} kt is used for every leg. Magnetic heading uses ${Math.abs(rc.vare)}° ${rc.vare < 0 ? 'west' : 'east'} variation. Add compass deviation from your aircraft's compass card to steer.</p>
      ${ff ? `<h3 style="margin-top:20px">Fuel check</h3>
        <dl class="big"><div><dt>Reserve (${ff.resMin} min)</dt><dd>${n1(ff.reserve)}<small> gal</small></dd></div><div><dt>Taxi and run-up</dt><dd>${n1(ff.taxi)}<small> gal</small></dd></div><div><dt>Required at takeoff</dt><dd>${n1(ff.total)}<small> gal</small></dd></div><div><dt>On board</dt><dd>${n1(ff.fob)}<small> gal</small></dd></div></dl>
        <p style="margin-top:12px">${ff.margin >= 0 ? OK(`${n1(ff.margin)} gal more than required`) : BAD(`Short by ${n1(-ff.margin)} gal`)}</p>` : '<p class="muted" style="margin-top:12px">Enter a fuel burn to see fuel figures.</p>'}
    </section>`;
    drawRouteMap(); renderFuel(); renderWb();
  }

  /* suggestions that start from the airports near you */
  const suggestEl = $('suggest');
  function renderSuggest() {
    if (!LOCAL.on || !LOCAL.airports.length) { suggestEl.hidden = true; return; }
    const near = LOCAL.airports.slice(0, 3);
    suggestEl.hidden = false;
    suggestEl.innerHTML = `<span>Near you:</span>${near.map(a => `<button type="button" data-from="${esc(a.id)}">Start at ${esc(a.id)}</button>`).join('')}<button type="button" data-trip="1">Suggest a trip</button>`;
  }
  function suggestTrip(fromId) {
    const a = AIRPORTS.get(fromId) || LOCAL.airports[0]; if (!a) return;
    const cands = AIRPORTS.rows.filter(b => b.id !== a.id && (b.type !== 'S' || b.twr) && C.distanceNm(a.lat, a.lon, b.lat, b.lon) * 1.15078 >= 40 && C.distanceNm(a.lat, a.lon, b.lat, b.lon) * 1.15078 <= 130);
    if (!cands.length) return;
    const b = cands[Math.floor(Math.random() * cands.length)];
    setRouteIds(a.id, b.id);
  }
  function setRouteIds(from, to) { $('r-from').value = from; $('r-to').value = to; $('r-via1').value = ''; $('r-via2').value = ''; paintAll(); saveRouteFields(); renderRoute(); }
  suggestEl.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.from) { $('r-from').value = b.dataset.from; paintAll(); saveRouteFields(); renderRoute(); } else if (b.dataset.trip) suggestTrip($('r-from').value && resolve($('r-from').value) && LOCAL.airports.some(a => a.id === resolve($('r-from').value).id) ? resolve($('r-from').value).id : LOCAL.airports[0].id); });

  function saveRouteFields() {
    persist({ from: $('r-from').value.trim().toUpperCase(), to: $('r-to').value.trim().toUpperCase(), via: [$('r-via1').value, $('r-via2').value].map(v => v.trim().toUpperCase()).filter(Boolean), tas: num('r-tas') ?? plan.tas, burn: num('r-burn') ?? plan.burn, windDir: num('r-wdir') ?? 0, windSpd: num('r-wspd') ?? 0, varEast: vardeg('r-var', 'r-vardir'), night: $('r-night').checked });
  }
  function fillRouteFields() {
    setv('r-from', plan.from); setv('r-to', plan.to); setv('r-via1', plan.via[0] || ''); setv('r-via2', plan.via[1] || '');
    setv('r-tas', plan.tas); setv('r-burn', plan.burn); setv('r-wdir', plan.windDir); setv('r-wspd', plan.windSpd); setVar('r-var', 'r-vardir', plan.varEast); $('r-night').checked = !!plan.night;
  }

  /* ---------- WEIGHT AND BALANCE ---------- */
  function acFields() {
    $('ac-name').value = ac.name; $('ac-ew').value = ac.emptyW; $('ac-ea').value = ac.emptyArm; $('ac-max').value = ac.maxW; $('ac-bagmax').value = ac.bagMax;
    $('ac-fa').value = ac.frontArm; $('ac-ra').value = ac.rearArm; $('ac-ba').value = ac.bagArm; $('ac-fla').value = ac.fuelArm; $('ac-flcap').value = ac.fuelCap; $('ac-flw').value = ac.fuelLbGal;
    $('ac-env').value = ac.env.map(p => p.join(', ')).join('\n');
  }
  function readAc() {
    const pairs = $('ac-env').value.split('\n').map(l => l.split(/[,\s]+/).filter(Boolean).map(Number)).filter(p => p.length === 2 && p.every(fin));
    const next = { ...ac, name: $('ac-name').value.trim() || 'My aircraft', emptyW: num('ac-ew') ?? ac.emptyW, emptyArm: num('ac-ea') ?? ac.emptyArm, maxW: num('ac-max') ?? ac.maxW, bagMax: num('ac-bagmax') ?? ac.bagMax, frontArm: num('ac-fa') ?? ac.frontArm, rearArm: num('ac-ra') ?? ac.rearArm, bagArm: num('ac-ba') ?? ac.bagArm, fuelArm: num('ac-fla') ?? ac.fuelArm, fuelCap: num('ac-flcap') ?? ac.fuelCap, fuelLbGal: num('ac-flw') ?? ac.fuelLbGal, custom: true };
    if (pairs.length >= 3) { next.env = pairs; $('ac-env').removeAttribute('aria-invalid'); } else $('ac-env').setAttribute('aria-invalid', 'true');
    ac = next; acSave(ac);
  }
  function chartSvg(env, pts) {
    const W = 560, H = 380, L = 56, R = 16, T = 14, B = 44;
    const xs = env.map(p => p[0]), ys = env.map(p => p[1]);
    const xmin = Math.floor(Math.min(...xs, ...pts.map(p => p.arm)) - 1.5), xmax = Math.ceil(Math.max(...xs, ...pts.map(p => p.arm)) + 1.5);
    const ymin = Math.floor((Math.min(...ys, ...pts.map(p => p.weight)) - 100) / 100) * 100, ymax = Math.ceil((Math.max(...ys, ...pts.map(p => p.weight)) + 100) / 100) * 100;
    const X = x => L + (x - xmin) / (xmax - xmin) * (W - L - R), Y = y => H - B - (y - ymin) / (ymax - ymin) * (H - T - B);
    const xt = [], yt = []; for (let x = Math.ceil(xmin / 2) * 2; x <= xmax; x += 2) xt.push(x); const ystep = (ymax - ymin) > 1000 ? 200 : 100; for (let y = Math.ceil(ymin / ystep) * ystep; y <= ymax; y += ystep) yt.push(y);
    const poly = env.map(p => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ');
    return `<svg class="wb-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Center of gravity envelope chart with the loaded points">
      ${xt.map(x => `<line class="grid" x1="${X(x)}" y1="${T}" x2="${X(x)}" y2="${H - B}"/><text x="${X(x)}" y="${H - B + 16}" text-anchor="middle">${x}</text>`).join('')}
      ${yt.map(y => `<line class="grid" x1="${L}" y1="${Y(y)}" x2="${W - R}" y2="${Y(y)}"/><text x="${L - 8}" y="${Y(y) + 4}" text-anchor="end">${y}</text>`).join('')}
      <line class="axis" x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}"/><line class="axis" x1="${L}" y1="${T}" x2="${L}" y2="${H - B}"/>
      <polygon class="env" points="${poly}"/>
      ${pts.map(p => `<circle class="${p.kind}" cx="${X(p.arm).toFixed(1)}" cy="${Y(p.weight).toFixed(1)}" r="7"/><text x="${(X(p.arm) + 11).toFixed(1)}" y="${(Y(p.weight) + 4).toFixed(1)}" style="fill:var(--ink)">${esc(p.label)}</text>`).join('')}
      <text x="${(L + W - R) / 2}" y="${H - 6}" text-anchor="middle">Center of gravity (inches from datum)</text>
      <text transform="translate(14 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle">Weight (lb)</text>
    </svg>`;
  }
  function renderWb() {
    const w = plan.wb, a = ac;
    $('wb-note').innerHTML = a.custom ? `Using your aircraft data (<b>${esc(a.name)}</b>), saved in this browser.` : '<strong>Example aircraft.</strong> The numbers are illustrative and are not from a handbook. Open <b>Aircraft data</b> and enter your own.';
    const fuelGal = Math.min(w.fuel, 999), fuelLb = fuelGal * a.fuelLbGal;
    const base = [{ weight: a.emptyW, arm: a.emptyArm }, { weight: w.front, arm: a.frontArm }, { weight: w.rear, arm: a.rearArm }, { weight: w.bag, arm: a.bagArm }];
    const to = C.balance([...base, { weight: fuelLb, arm: a.fuelArm }]);
    const zf = C.balance(base);
    const trip = routeCalc && routeCalc.fuel != null ? routeCalc.fuel : null;
    const ldGal = trip == null ? null : Math.max(0, fuelGal - trip);
    const ld = ldGal == null ? null : C.balance([...base, { weight: ldGal * a.fuelLbGal, arm: a.fuelArm }]);
    const check = (b) => {
      if (b.weight > a.maxW + 0.001) return { ok: false, msg: `Over maximum weight by ${n0(b.weight - a.maxW)} lb` };
      const inside = C.inEnvelope(b.cg, b.weight, a.env), lim = C.limitsAt(b.weight, a.env);
      if (inside) return { ok: true, msg: 'Inside the envelope' };
      if (!lim) return { ok: false, msg: 'Outside the weight range of the envelope' };
      return { ok: false, msg: b.cg < lim.fwd ? `CG is ${n1(lim.fwd - b.cg)} in too far forward` : `CG is ${n1(b.cg - lim.aft)} in too far aft` };
    };
    const ct = check(to), cz = check(zf), cl = ld ? check(ld) : null;
    const issues = [];
    if (w.bag > a.bagMax) issues.push(`Baggage is ${n0(w.bag - a.bagMax)} lb over the ${n0(a.bagMax)} lb limit.`);
    if (fuelGal > a.fuelCap) issues.push(`Fuel is more than the ${n1(a.fuelCap)} gallons usable.`);
    const lim = C.limitsAt(Math.min(to.weight, Math.max(...a.env.map(p => p[1]))), a.env);
    const pts = [{ label: 'Takeoff', arm: to.cg, weight: to.weight, kind: ct.ok ? 'pt-to' : 'pt-bad' }];
    if (ld) pts.push({ label: 'Landing', arm: ld.cg, weight: ld.weight, kind: cl.ok ? 'pt-ld' : 'pt-bad' });
    $('wb-out').innerHTML = `<section class="res" aria-labelledby="wb-h">
      <h2 id="wb-h">${esc(a.name)}</h2>
      <p>${ct.ok && !issues.length ? OK(`Takeoff: ${ct.msg}`) : BAD(`Takeoff: ${ct.msg}`)}</p>
      <dl class="big" style="margin-top:16px">
        <div><dt>Takeoff weight</dt><dd>${n0(to.weight)}<small> of ${n0(a.maxW)} lb</small></dd></div>
        <div><dt>Takeoff CG</dt><dd>${n1(to.cg)}<small> in${lim ? `, limits ${n1(lim.fwd)} to ${n1(lim.aft)}` : ''}</small></dd></div>
        <div><dt>Zero-fuel weight</dt><dd>${n0(zf.weight)}<small> lb</small></dd></div>
        <div><dt>Zero-fuel CG</dt><dd>${n1(zf.cg)}<small> in</small></dd></div>
        ${ld ? `<div><dt>Landing weight</dt><dd>${n0(ld.weight)}<small> lb</small></dd></div><div><dt>Landing CG</dt><dd>${n1(ld.cg)}<small> in</small></dd></div>` : ''}
      </dl>
      ${issues.map(i => `<p class="err-line" style="margin-top:10px">${esc(i)}</p>`).join('')}
      ${ld ? `<p style="margin-top:12px">${cl.ok ? OK(`Landing: ${cl.msg}`) : BAD(`Landing: ${cl.msg}`)}</p><p class="muted" style="margin-top:8px">Landing uses the trip fuel from the Route tab (${n1(trip)} gal burned).</p>` : '<p class="muted" style="margin-top:12px">Set a route and a fuel burn to see the landing condition.</p>'}
      <p class="muted" style="margin-top:8px">${cz.ok ? 'Zero fuel is inside the envelope.' : `Zero fuel: ${esc(cz.msg)}.`}</p>
      ${chartSvg(a.env, pts)}
      <div class="legend-s"><span>Filled dot: takeoff</span>${ld ? '<span>Ring: landing</span>' : ''}<span>Red: outside limits</span></div>
    </section>`;
  }

  /* ---------- PERFORMANCE ---------- */
  function daEffect(da) {
    if (da < 2000) return ['ok', 'Close to standard. Normal performance.'];
    if (da < 5000) return ['warn', 'Performance is reduced. Expect a longer takeoff roll and a slower climb.'];
    if (da < 8000) return ['warn', 'Performance is clearly reduced. Check the handbook charts and plan extra runway.'];
    return ['bad', 'Performance is badly reduced. Takeoff roll and climb need careful handbook work.'];
  }
  async function renderPerf() {
    const p = plan.perf, out = $('perf-out');
    const elev = p.elev === '' ? null : Number(p.elev), temp = Number(p.temp), altim = Number(p.altim);
    if (!fin(elev) || !fin(temp) || !fin(altim)) { out.innerHTML = '<div class="res"><p class="msg">Pick an airport, or enter the field elevation, temperature and altimeter setting.</p></div>'; return; }
    const pa = C.pressureAltitude(elev, altim), isa = C.isaTempC(pa), da = C.densityAltitude(elev, altim, temp), dev = temp - isa;
    const [kind, text] = daEffect(da);
    const roll = Number(p.roll);
    const rollEst = fin(roll) && roll > 0 ? roll * (1 + 0.10 * Math.max(0, da) / 1000) : null;
    const magWind = fin(Number(p.windDirTrue)) ? C.trueToMagnetic(Number(p.windDirTrue), p.varEast || 0) : null;
    let runwayHtml = '<p class="msg">Pick an airport with runway data to see the runway winds.</p>';
    const a = p.airport ? AIRPORTS.get(p.airport) : null;
    if (a) {
      try { await AIRPORTS.loadDetails(); } catch { /* handled below */ }
      const det = AIRPORTS.details && AIRPORTS.details[a.id];
      if (det && det.r.length && magWind != null) {
        const ends = C.bestRunway(det.r, magWind, Number(p.windSpd) || 0), xl = Number(p.xl) || 0;
        const rows = ends.map((e, i) => {
          const tail = e.head < -0.5, over = xl > 0 && Math.abs(e.cross) > xl;
          const note = [tail ? 'Tailwind' : '', over ? 'Over crosswind limit' : ''].filter(Boolean).join(', ') || (i === 0 ? 'Best' : '');
          return `<tr class="${i === 0 ? 'best' : ''}"><td>Runway ${esc(e.id)}</td><td>${C.hdg(e.hdg)}°</td><td>${tail ? 'Tail ' + n0(-e.head) : 'Head ' + n0(Math.max(0, e.head))}</td><td>${Math.abs(e.cross) < 0.5 ? '0' : n0(Math.abs(e.cross)) + (e.cross > 0 ? ' from right' : ' from left')}</td><td>${esc(note)}</td></tr>`;
        }).join('');
        runwayHtml = `<div class="tbl-wrap" tabindex="0" role="region" aria-label="Runway winds table"><table class="t"><thead><tr><th scope="col">Runway</th><th scope="col">Heading</th><th scope="col">Headwind or tailwind (kt)</th><th scope="col">Crosswind (kt)</th><th scope="col">Note</th></tr></thead><tbody>${rows}</tbody></table></div><p class="muted" style="margin-top:12px">Wind used: ${C.hdg(magWind)}° magnetic at ${n0(Number(p.windSpd) || 0)} kt (${C.hdg(Number(p.windDirTrue))}° true with ${Math.abs(p.varEast || 0)}° ${p.varEast < 0 ? 'west' : 'east'} variation). Runway numbers give the approximate magnetic heading.</p>`;
      } else if (!det) runwayHtml = '<p class="msg">No runway data is listed for this airport.</p>';
    }
    out.innerHTML = `<section class="res" aria-labelledby="pf-h">
      <h2 id="pf-h">Density altitude${a ? ' at ' + esc(a.id) : ''}</h2>
      <dl class="big"><div><dt>Pressure altitude</dt><dd>${n0(pa)}<small> ft</small></dd></div><div><dt>Standard temperature</dt><dd>${n1(isa)}<small> °C</small></dd></div><div><dt>Temperature above standard</dt><dd>${dev >= 0 ? '+' : ''}${n1(dev)}<small> °C</small></dd></div><div><dt>Density altitude</dt><dd>${n0(da)}<small> ft</small></dd></div></dl>
      <p style="margin-top:14px">${kind === 'ok' ? OK(text) : kind === 'warn' ? WARN(text) : BAD(text)}</p>
      ${rollEst ? `<p style="margin-top:12px">Rule of thumb takeoff roll: about <b>${n0(rollEst)} ft</b> (the handbook figure plus 10% for each 1,000 ft of density altitude). Use your handbook for real numbers.</p>` : ''}
      <h3 style="margin-top:22px">Runway winds</h3>${runwayHtml}
    </section>`;
  }
  function perfFields() {
    const p = plan.perf;
    setv('p-apt', p.airport); setv('p-elev', p.elev); setv('p-temp', p.temp); setv('p-altim', p.altim); setv('p-xl', p.xl); setv('p-roll', p.roll);
    setv('p-wdir', p.windDirTrue); setv('p-wspd', p.windSpd); setVar('p-var', 'p-vardir', p.varEast || 0);
  }
  function readPerf() {
    const a = resolve($('p-apt').value);
    const p = { ...plan.perf, airport: a ? a.id : $('p-apt').value.trim().toUpperCase(), temp: num('p-temp') ?? plan.perf.temp, altim: num('p-altim') ?? plan.perf.altim, xl: num('p-xl') ?? plan.perf.xl, roll: num('p-roll') ?? '', windDirTrue: num('p-wdir') ?? 0, windSpd: num('p-wspd') ?? 0, varEast: vardeg('p-var', 'p-vardir') };
    const e = num('p-elev'); p.elev = e == null ? '' : e;
    persist({ perf: p });
  }

  /* ---------- FUEL AND TIME ---------- */
  function renderFuel() {
    const fob = plan.fuelOnBoard, burn = plan.burn, gs = plan.gs || (routeCalc && routeCalc.gs) || plan.tas, taxi = plan.taxi ?? 1, night = !!plan.nightFuel;
    setv('f-fob', fob); setv('f-burn', burn); setv('f-gs', Math.round(gs)); setv('f-taxi', taxi); $('f-night').checked = night;
    const out = $('fuel-out');
    if (!fin(fob) || !fin(burn) || burn <= 0 || !fin(gs) || gs <= 0) { out.innerHTML = '<div class="res"><p class="msg">Enter fuel on board, fuel burn and ground speed.</p></div>'; return; }
    const res = C.vfrReserveMin(night), usable = Math.max(0, fob - taxi);
    const endu = C.endurance(usable, burn), range = C.rangeNm(usable, burn, gs, res);
    let route = '';
    if (routeCalc && routeCalc.legs && routeCalc.fuel != null) {
      const need = C.fuelPlan({ eteMin: routeCalc.mins, burnGph: burn, reserveMin: res, taxiGal: taxi });
      const margin = fob - need.total;
      route = `<h3 style="margin-top:22px">For the route ${esc(routeCalc.points[0].id)} to ${esc(routeCalc.points[routeCalc.points.length - 1].id)}</h3>
        <dl class="big"><div><dt>Trip time</dt><dd>${C.hm(routeCalc.mins)}</dd></div><div><dt>Trip fuel</dt><dd>${n1(need.trip)}<small> gal</small></dd></div><div><dt>Required with reserve</dt><dd>${n1(need.total)}<small> gal</small></dd></div><div><dt>Margin</dt><dd>${margin >= 0 ? '+' : ''}${n1(margin)}<small> gal</small></dd></div></dl>
        <p style="margin-top:12px">${margin >= 0 ? OK('Enough fuel with the reserve') : BAD(`Short by ${n1(-margin)} gal`)}</p>`;
    }
    out.innerHTML = `<section class="res" aria-labelledby="fu-h"><h2 id="fu-h">Endurance and range</h2>
      <dl class="big"><div><dt>Endurance (no reserve)</dt><dd>${C.hm(endu)}</dd></div><div><dt>Endurance with ${res} min reserve</dt><dd>${C.hm(Math.max(0, endu - res))}</dd></div><div><dt>Range with reserve</dt><dd>${n0(range)}<small> NM</small></dd></div><div><dt>Burn per hour</dt><dd>${n1(burn)}<small> gal</small></dd></div></dl>
      <p class="muted" style="margin-top:12px">Reserve rule: 14 CFR 91.151 requires fuel for 30 minutes by day or 45 minutes at night, at normal cruise, beyond the planned trip. Taxi fuel (${n1(taxi)} gal) is taken off first.</p>${route}</section>`;
  }

  /* ---------- summary, save and share ---------- */
  function summaryText() {
    const rc = routeCalc; if (!rc || rc.error) return 'No route is set.';
    const ff = fuelFigures(rc);
    const lines = [`Chartroom practice plan: ${rc.points.map(p => p.id).join(' to ')}`, `Distance ${n0(rc.dist)} NM (${n0(C.smi(rc.dist))} mi), time ${C.hm(rc.mins)}, ground speed ${n0(rc.gs)} kt`, `Wind ${C.hdg(rc.wdir)} true at ${rc.wspd} kt, TAS ${rc.tas} kt, variation ${Math.abs(rc.vare)} ${rc.vare < 0 ? 'W' : 'E'}`, ''];
    rc.legs.forEach(l => lines.push(`${l.from.id} to ${l.to.id}: ${n1(l.d)} NM, TC ${C.hdg(l.tc)}, TH ${C.hdg(l.th)}, MH ${C.hdg(l.mh)}, GS ${n0(l.gs)}, ${C.hm(l.ete)}`));
    if (ff) lines.push('', `Fuel: trip ${n1(ff.trip)} gal, reserve ${n1(ff.reserve)} gal (${ff.resMin} min), taxi ${n1(ff.taxi)} gal, required ${n1(ff.total)} gal, on board ${n1(ff.fob)} gal`);
    lines.push('', 'For study only. Not for navigation or flight planning.');
    return lines.join('\n');
  }
  function printSummary() {
    const rc = routeCalc; const el = $('print-summary');
    if (!rc || rc.error) { $('r-saved-msg').textContent = 'Set a route first.'; return; }
    const ff = fuelFigures(rc);
    el.innerHTML = `<h1>Practice flight plan: ${esc(rc.points.map(p => p.id).join(' to '))}</h1>
      <p class="warn">For study only. Not for navigation or flight planning.</p>
      <p>${n0(rc.dist)} NM (${n0(C.smi(rc.dist))} mi) · ${C.hm(rc.mins)} · ground speed ${n0(rc.gs)} kt · TAS ${rc.tas} kt · wind ${C.hdg(rc.wdir)}° true at ${rc.wspd} kt · variation ${Math.abs(rc.vare)}° ${rc.vare < 0 ? 'W' : 'E'}</p>
      <h2>Legs</h2><table><thead><tr><th>Leg</th><th>NM</th><th>TC</th><th>WCA</th><th>TH</th><th>MH</th><th>GS</th><th>Time</th><th>Fuel</th></tr></thead><tbody>${rc.legs.map(l => `<tr><td>${esc(l.from.id)} to ${esc(l.to.id)}</td><td>${n1(l.d)}</td><td>${C.hdg(l.tc)}°</td><td>${wcaText(l.wca)}</td><td>${C.hdg(l.th)}°</td><td>${C.hdg(l.mh)}°</td><td>${n0(l.gs)}</td><td>${C.hm(l.ete)}</td><td>${l.fuel == null ? '' : n1(l.fuel)}</td></tr>`).join('')}</tbody></table>
      ${ff ? `<h2>Fuel</h2><p>Trip ${n1(ff.trip)} gal · reserve ${n1(ff.reserve)} gal (${ff.resMin} min) · taxi ${n1(ff.taxi)} gal · required ${n1(ff.total)} gal · on board ${n1(ff.fob)} gal</p>` : ''}
      <p>Printed ${new Date().toLocaleString('en-US')}</p>`;
    window.print();
  }
  const snapshot = () => ({ app: 'chartroom', version: 1, savedAt: new Date().toISOString(), plan: { ...plan }, aircraft: ac.custom ? ac : null });
  function renderSaved() {
    const list = PLAN.list(), el = $('s-list');
    if (!list.length) { el.innerHTML = '<div class="res"><h2>Saved plans</h2><p class="msg">Nothing saved yet. Name the current plan and press Save.</p></div>'; return; }
    el.innerHTML = `<section class="res" aria-labelledby="sv-h"><h2 id="sv-h">Saved plans</h2><ul class="saved">${list.map((s, i) => `<li><span><b>${esc(s.name)}</b><small>${esc([s.plan.from, ...(s.plan.via || []), s.plan.to].filter(Boolean).join(' to '))} · ${esc(new Date(s.savedAt).toLocaleDateString('en-US'))}</small></span><span class="actions"><button class="btn sm" type="button" data-load="${i}">Open</button><button class="btn sm ghost danger" type="button" data-del="${i}" aria-label="Delete ${esc(s.name)}">Delete</button></span></li>`).join('')}</ul></section>`;
  }
  function loadSnapshot(s) {
    if (!s || s.app !== 'chartroom' || !s.plan) throw new Error('That file is not a Chartroom plan.');
    PLAN.reset(); persist(s.plan); plan = norm(PLAN.get()); plan = norm(plan);
    if (s.aircraft) { ac = { ...EXAMPLE_AC, ...s.aircraft }; acSave(ac); acFields(); }
    fillRouteFields(); perfFields(); paintAll(); renderRoute(); renderPerf();
    $('wb-fuel').value = plan.wb.fuel; $('wb-front').value = plan.wb.front; $('wb-rear').value = plan.wb.rear; $('wb-bag').value = plan.wb.bag;
  }

  /* ---------- wiring ---------- */
  bindAirport('r-from', 'r-from-n', () => { saveRouteFields(); renderRoute(); });
  bindAirport('r-via1', 'r-via1-n', () => { saveRouteFields(); renderRoute(); });
  bindAirport('r-via2', 'r-via2-n', () => { saveRouteFields(); renderRoute(); });
  bindAirport('r-to', 'r-to-n', () => { saveRouteFields(); renderRoute(); });
  bindAirport('p-apt', 'p-apt-n', changed => {
    const a = resolve($('p-apt').value);
    if (changed && a) { setv('p-elev', a.elev); const p = { ...plan.perf, airport: a.id, elev: a.elev }; persist({ perf: p }); }
    readPerf(); renderPerf();
  });
  $('route-form').addEventListener('input', e => { if (e.target.list) return; saveRouteFields(); renderRoute(); });
  $('route-form').addEventListener('change', () => { saveRouteFields(); renderRoute(); });
  $('route-form').addEventListener('submit', e => e.preventDefault());
  $('r-print').addEventListener('click', printSummary);
  $('r-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(summaryText()); $('r-saved-msg').textContent = 'Copied the plan as text.'; } catch { $('r-saved-msg').textContent = 'Copy was blocked by the browser. Use Print instead.'; } });
  $('r-save').addEventListener('click', () => { document.getElementById('tab-saved').click(); $('s-name').focus(); });

  $('wb-form').addEventListener('input', e => {
    if (e.target.closest('#ac-details')) { readAc(); } else { persist({ wb: { front: num('wb-front') ?? 0, rear: num('wb-rear') ?? 0, bag: num('wb-bag') ?? 0, fuel: num('wb-fuel') ?? 0 } }); }
    renderWb();
  });
  $('wb-form').addEventListener('submit', e => e.preventDefault());
  $('ac-reset').addEventListener('click', () => { ac = { ...EXAMPLE_AC, custom: false }; try { localStorage.removeItem('chartroom.aircraft'); } catch { /* storage blocked */ } acFields(); renderWb(); });

  $('perf-form').addEventListener('input', e => { if (e.target.id === 'p-apt') return; readPerf(); plan = norm(PLAN.get()); renderPerf(); });
  $('perf-form').addEventListener('submit', e => e.preventDefault());
  $('p-metar').addEventListener('click', async () => {
    const a = resolve($('p-apt').value), msg = $('p-msg');
    if (!a) { msg.textContent = 'Pick an airport first.'; return; }
    msg.textContent = 'Loading the latest report…';
    const r = await WX.fetchMetars([a.id]);
    if (!r.ok) { msg.innerHTML = `Weather is not available right now (${esc(r.error)}). Enter the numbers by hand or open <a href="${esc(WX.officialLinks(a.id).metar)}" target="_blank" rel="noopener" style="color:var(--amber)">aviationweather.gov</a>.`; return; }
    const m = r.byId[a.id];
    if (!m) { msg.textContent = `${a.id} has no recent report. Try a nearby airport with weather reporting.`; return; }
    const p = { ...plan.perf, airport: a.id, elev: a.elev, temp: m.temp ?? plan.perf.temp, altim: m.altim ?? plan.perf.altim, windDirTrue: m.wind && m.wind.dir !== 'VRB' ? m.wind.dir : plan.perf.windDirTrue, windSpd: m.wind ? m.wind.speed : 0 };
    persist({ perf: p }); plan = norm(PLAN.get()); perfFields(); renderPerf();
    msg.textContent = `Filled from the ${m.station} report from ${m.ageMin} minutes ago. METAR winds are true, so set the variation to see magnetic runway winds.`;
  });

  $('fuel-form').addEventListener('input', () => { persist({ fuelOnBoard: num('f-fob') ?? plan.fuelOnBoard, burn: num('f-burn') ?? plan.burn, gs: num('f-gs') ?? null, taxi: num('f-taxi') ?? 0, nightFuel: $('f-night').checked }); plan = norm(PLAN.get()); setv('r-burn', plan.burn); renderRouteQuiet(); });
  $('fuel-form').addEventListener('submit', e => e.preventDefault());
  $('f-from-route').addEventListener('click', () => { if (routeCalc && routeCalc.gs) { persist({ gs: Math.round(routeCalc.gs) }); plan = norm(PLAN.get()); renderFuel(); } });
  function renderRouteQuiet() { routeCalc = computeRoute(); renderFuel(); renderWb(); const rc = routeCalc; if (!rc.error) renderRoute(); }

  $('s-save').addEventListener('click', () => { const name = $('s-name').value.trim(); if (!name) { $('s-msg').textContent = 'Give the plan a name first.'; $('s-name').focus(); return; } $('s-msg').textContent = PLAN.save(name, snapshot().plan) ? `Saved "${name}".` : 'This browser blocked saving.'; renderSaved(); });
  $('s-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(snapshot(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `chartroom-plan-${(plan.from || 'plan')}-${(plan.to || '')}.json`.replace(/-\.json$/, '.json'); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    $('s-msg').textContent = 'Downloaded the plan file.';
  });
  $('s-import').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; try { loadSnapshot(JSON.parse(await f.text())); $('s-msg').textContent = `Opened ${f.name}.`; document.getElementById('tab-route').click(); } catch (err) { $('s-msg').textContent = err.message || 'That file could not be read.'; } e.target.value = ''; });
  $('s-list').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return; const list = PLAN.list();
    if (b.dataset.load != null) { const s = list[Number(b.dataset.load)]; if (s) { PLAN.reset(); persist(s.plan); plan = norm(PLAN.get()); plan = norm(plan); fillRouteFields(); perfFields(); paintAll(); renderRoute(); renderPerf(); $('wb-front').value = plan.wb.front; $('wb-rear').value = plan.wb.rear; $('wb-bag').value = plan.wb.bag; $('wb-fuel').value = plan.wb.fuel; $('s-msg').textContent = `Opened "${s.name}".`; document.getElementById('tab-route').click(); } }
    if (b.dataset.del != null) { const s = list[Number(b.dataset.del)]; if (s) { PLAN.remove(s.name); renderSaved(); $('s-msg').textContent = `Deleted "${s.name}".`; } }
  });

  /* ---------- tabs ---------- */
  const TABS = ['route', 'wb', 'perf', 'fuel', 'saved'];
  function showTab(name, focus) {
    if (!TABS.includes(name)) name = 'route';
    TABS.forEach(t => { const on = t === name, tab = $('tab-' + t); tab.setAttribute('aria-selected', String(on)); tab.tabIndex = on ? 0 : -1; $('panel-' + t).hidden = !on; });
    if (focus) $('tab-' + name).focus();
    if (name === 'route') setTimeout(() => { rmap.resize(); drawRouteMap(); }, 30);
    if (name === 'wb') renderWb();
    if (name === 'perf') renderPerf();
    if (name === 'fuel') renderFuel();
    if (name === 'saved') renderSaved();
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
  }
  document.querySelector('.tabs').addEventListener('click', e => { const t = e.target.closest('.tab'); if (t) showTab(t.id.replace('tab-', ''), false); });
  document.querySelector('.tabs').addEventListener('keydown', e => {
    const i = TABS.findIndex(t => $('tab-' + t).getAttribute('aria-selected') === 'true');
    let n = null; if (e.key === 'ArrowRight') n = (i + 1) % TABS.length; else if (e.key === 'ArrowLeft') n = (i + TABS.length - 1) % TABS.length; else if (e.key === 'Home') n = 0; else if (e.key === 'End') n = TABS.length - 1;
    if (n != null) { e.preventDefault(); showTab(TABS[n], true); }
  });
  window.addEventListener('hashchange', () => showTab(location.hash.slice(1), false));

  /* ---------- location: start from the airports near you ---------- */
  LOCAL.subscribe((L, reason) => {
    renderSuggest();
    if (reason === 'enabled' && L.airports[0]) {
      const untouched = (!plan.from || plan.from === EX_FROM) && (!plan.to || plan.to === EX_TO);
      if (untouched) { $('r-from').value = L.airports[0].id; suggestTrip(L.airports[0].id); }
      const perfUntouched = !plan.perf.airport;
      if (perfUntouched) { $('p-apt').value = L.airports[0].id; $('p-apt').dispatchEvent(new Event('change')); }
    }
  });

  /* ---------- start ---------- */
  acFields(); fillRouteFields(); perfFields();
  $('wb-front').value = plan.wb.front; $('wb-rear').value = plan.wb.rear; $('wb-bag').value = plan.wb.bag; $('wb-fuel').value = plan.wb.fuel;
  if (plan.perf.airport && !plan.perf.elev) { const a = AIRPORTS.get(plan.perf.airport); if (a) { plan.perf.elev = a.elev; persist({ perf: plan.perf }); perfFields(); } }
  paintAll(); renderSuggest(); renderRoute(); renderSaved();
  showTab(location.hash.slice(1) || 'route', false);
})();
