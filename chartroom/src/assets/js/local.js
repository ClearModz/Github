/* Chartroom shared airport data and "near me".
   AIRPORTS  loads the built-in US airport list and lets you search it.
   LOCAL     the "Use my location" state shared by every page:
               LOCAL.on, LOCAL.airports (within the radius, nearest first), LOCAL.pick(), LOCAL.setRadius(mi),
               LOCAL.mountControl(el), LOCAL.subscribe(fn)  where fn(LOCAL, reason) runs on 'enabled', 'disabled', 'radius', 'ready'.
   Your coordinates stay in this browser. A position rounded to 0.1 degree (about 7 miles) is kept in sessionStorage
   for the length of the tab so other pages can use it. Everything is cleared by the button on the privacy page. */
(() => {
  const SCRIPT = document.currentScript && document.currentScript.src;
  const DATA = new URL('../data/', SCRIPT || location.href).href;
  const MI = 1.15078;                                   // statute miles per nautical mile
  const rad = d => d * Math.PI / 180;

  const geo = {
    nm(la1, lo1, la2, lo2) { const a = Math.sin(rad(la2 - la1) / 2) ** 2 + Math.cos(rad(la1)) * Math.cos(rad(la2)) * Math.sin(rad(lo2 - lo1) / 2) ** 2; return 2 * 3440.065 * Math.asin(Math.sqrt(a)); },
    bearing(la1, lo1, la2, lo2) { const y = Math.sin(rad(lo2 - lo1)) * Math.cos(rad(la2)), x = Math.cos(rad(la1)) * Math.sin(rad(la2)) - Math.sin(rad(la1)) * Math.cos(rad(la2)) * Math.cos(rad(lo2 - lo1)); return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; },
    compass(b) { return ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(b / 22.5) % 16]; }
  };

  /* ---------- airports ---------- */
  let listP = null, detailP = null;
  const TYPE_NAME = { L: 'Large airport', M: 'Medium airport', S: 'Small airport' };
  const AIRPORTS = window.AIRPORTS = {
    rows: [], byId: new Map(), TYPE_NAME,
    load() {
      listP ||= fetch(DATA + 'airports.json').then(r => { if (!r.ok) throw new Error('airport list ' + r.status); return r.json(); }).then(j => {
        this.retrieved = j.retrieved;
        this.rows = j.rows.map(r => ({ id: r[0], name: r[1], city: r[2], state: r[3], type: r[4], lat: r[5], lon: r[6], elev: r[7], twr: !!r[8], iata: r[9] }));
        this.byId = new Map(this.rows.map(a => [a.id, a]));
        return this;
      });
      return listP;
    },
    loadDetails() {
      detailP ||= fetch(DATA + 'airport-details.json').then(r => { if (!r.ok) throw new Error('airport details ' + r.status); return r.json(); }).then(j => { this.details = j.airports; return this; });
      return detailP;
    },
    get(id) { return this.byId.get(String(id || '').toUpperCase()) || null; },
    /** ident or IATA match first, then names and cities. Returns at most `limit` airports. */
    search(q, limit = 12) {
      q = String(q || '').trim().toLowerCase(); if (!q) return [];
      const w = { L: 0, M: 1, S: 2 }, scored = [];
      for (const a of this.rows) {
        const id = a.id.toLowerCase(), iata = a.iata.toLowerCase(), name = a.name.toLowerCase(), city = (a.city || '').toLowerCase();
        let s = 99;
        if (id === q || iata === q) s = 0;
        else if (id.startsWith(q) || iata.startsWith(q)) s = 1;
        else if (city === q) s = 2;
        else if (city.startsWith(q)) s = 3;
        else if (name.startsWith(q)) s = 4;
        else if (name.includes(q) || city.includes(q)) s = 5;
        if (s < 99) scored.push([s * 10 + w[a.type] + (a.twr ? -0.5 : 0), a]);
      }
      return scored.sort((x, y) => x[0] - y[0]).slice(0, limit).map(x => x[1]);
    },
    /** weather and radio use 4-letter ICAO identifiers */
    isIcao: id => /^K[A-Z0-9]{3}$/.test(id),
    runwayHeading: ident => { const n = parseInt(String(ident), 10); return n >= 1 && n <= 36 ? n * 10 : null; },   // runway number x 10 = magnetic heading
    geo
  };

  /* ---------- location ---------- */
  const store = { get: k => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* storage blocked */ } }, del: k => { try { sessionStorage.removeItem(k); } catch { /* storage blocked */ } } };
  const lstore = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } } };

  const LOCAL = window.LOCAL = {
    on: false, pos: null, pool: [], airports: [], radiusMi: Number(lstore.get('chartroom.radius')) || 150, _subs: [], _last: null, geo,
    MI, mi: nm => nm * MI,
    // kept for older callers
    nm: geo.nm, bearing: geo.bearing, compass: geo.compass,
    subscribe(fn) { this._subs.push(fn); },
    _emit(reason) { this._subs.forEach(f => { try { f(this, reason); } catch (e) { console.error(e); } }); },
    setRadius(mi) {
      this.radiusMi = mi; lstore.set('chartroom.radius', String(mi));
      this.airports = this.pool.filter(a => a.nm * MI <= mi);
    },
    /** the whole 300 mile neighbourhood, nearest first */
    async _buildPool(lat, lon) {
      await AIRPORTS.load();
      this.pool = AIRPORTS.rows.map(a => { const nm = geo.nm(lat, lon, a.lat, a.lon); return nm * MI <= 300 ? { ...a, nm, dir: geo.compass(geo.bearing(lat, lon, a.lat, a.lon)) } : null; }).filter(Boolean).sort((x, y) => x.nm - y.nm);
      this.setRadius(this.radiusMi);
    },
    pick() {
      const pool = this.airports.length > 1 ? this.airports.filter(a => a.id !== this._last) : this.airports;
      const w = pool.map(a => ({ a, w: a.type === 'L' ? 4 : a.type === 'M' ? 2.5 : 1 }));
      let t = w.reduce((s, x) => s + x.w, 0) * Math.random(), pick = w[0].a;
      for (const x of w) { t -= x.w; if (t <= 0) { pick = x.a; break; } }
      this._last = pick.id; return pick;
    },
    nearest(n = 1) { return this.airports.slice(0, n); },
    distanceTo(a) { return this.pos ? geo.nm(this.pos.lat, this.pos.lon, a.lat, a.lon) : null; },

    async setPosition(lat, lon) {
      this.pos = { lat, lon };
      await this._buildPool(lat, lon);
      this.on = true;
      store.set('chartroom.pos', JSON.stringify({ lat: Math.round(lat * 10) / 10, lon: Math.round(lon * 10) / 10 }));
    },
    turnOff() {
      this.on = false; this.airports = []; this.pool = []; this.pos = null;
      store.del('chartroom.pos'); store.set('chartroom.locOff', '1');
    },
    /** Ask the browser for a position. Rejects with a message that is safe to show. */
    request() {
      return new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error('This browser cannot share a location.'));
        navigator.geolocation.getCurrentPosition(p => resolve(p.coords), err => reject(new Error(err.code === 1
          ? 'Location permission was denied. Allow it in your browser (the lock icon by the address), then turn this on again.'
          : 'Could not get your location' + (location.protocol === 'file:' ? '. If you opened this file directly, serve the folder from localhost instead.' : '. Try again.'))),
          { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
      });
    },
    /** If this tab already had location on (rounded position kept for the tab), use it without asking again. */
    async resume() {
      const raw = store.get('chartroom.pos'); if (!raw || this.on) return false;
      try { const p = JSON.parse(raw); await this.setPosition(p.lat, p.lon); this._emit('resumed'); return true; } catch { return false; }
    },

    /** Renders the switch, radius slider and status line into `el` and keeps them in sync. */
    mountControl(el) {
      el.classList.add('loc');
      el.innerHTML = `
        <label class="sw" for="useLoc">
          <input type="checkbox" role="switch" id="useLoc" name="useLocation" autocomplete="off" aria-describedby="locHint">
          <span class="track" aria-hidden="true"></span>
          <span class="sw-t"><b><i class="ph ph-map-pin" aria-hidden="true"></i>Use my location</b><small id="locHint">Use airports near you as examples. Your position stays in this browser.</small></span>
        </label>
        <div class="rad">
          <label for="locRad">Search radius</label>
          <input class="rng" type="range" id="locRad" name="radius" min="25" max="300" step="25" value="${this.radiusMi}" disabled autocomplete="off" aria-describedby="locRadOut">
          <output id="locRadOut" for="locRad" class="mono">${this.radiusMi}&nbsp;mi</output>
        </div>
        <div class="mono loc-st" id="locStat" role="status" aria-live="polite" hidden></div>`;
      const box = el.querySelector('#useLoc'), rad = el.querySelector('#locRad'), out = el.querySelector('#locRadOut'), st = el.querySelector('#locStat');
      const say = m => { st.hidden = false; st.textContent = m; };
      const status = () => {
        if (!this.on) return say('Location is off. Using the built-in example airports.');
        const n = this.airports.length;
        if (!n) return say(`No airports found within ${this.radiusMi} mi. Increase the radius to get more examples.`);
        const f = this.airports[0];
        say(`${n} ${n === 1 ? 'airport' : 'airports'} within ${this.radiusMi} mi. Nearest: ${f.name} (${f.id}), ${Math.round(f.nm * MI).toLocaleString('en-US')} mi ${f.dir}.`);
      };
      const sync = () => { box.checked = this.on; rad.disabled = !this.on; rad.value = this.radiusMi; out.innerHTML = this.radiusMi + '&nbsp;mi'; if (this.on || !st.hidden) status(); };
      this.subscribe((_, reason) => { if (reason !== 'radius') sync(); });
      box.addEventListener('change', async () => {
        if (!box.checked) { this.turnOff(); sync(); status(); this._emit('disabled'); return; }
        say('Waiting for your browser to share your location…');
        try {
          const c = await this.request();
          say('Finding airports near you…');
          await this.setPosition(c.latitude, c.longitude);
          store.del('chartroom.locOff');
          if (!this.airports.length && !this.pool.length) throw new Error('No airports found near you. Using the built-in examples.');
          sync(); status(); this._emit('enabled');
        } catch (e) { this.on = false; this.airports = []; this.pool = []; box.checked = false; rad.disabled = true; say(e.message || 'Could not turn location on.'); this._emit('disabled'); }
      });
      rad.addEventListener('input', () => {
        const v = Number(rad.value); out.innerHTML = v + '&nbsp;mi'; rad.setAttribute('aria-valuetext', v + ' miles');
        if (this.on) { this.setRadius(v); status(); this._emit('radius'); } else { this.radiusMi = v; lstore.set('chartroom.radius', String(v)); }
      });
      rad.setAttribute('aria-valuetext', this.radiusMi + ' miles');
      if (this.on) { sync(); } else this.resume().then(ok => { if (ok) sync(); });
    }
  };
})();
