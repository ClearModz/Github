/* FAA public services used on pages other than Sectional Practice: airspace at a point, and the TFR list.
   Both are best effort. Callers must handle { error } and show a link to the official source. Study use only. */
(() => {
  const FAA = {
    AIR: 'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Class_Airspace/FeatureServer/0/query',
    TFR_LIST: 'https://tfr.faa.gov/tfrapi/getTfrList',
    PRI: { B: 4, C: 3, D: 2, E: 1 },
    CLASS_NOTE: {
      B: 'Clearance from ATC is required to enter.',
      C: 'Two-way radio contact is required before entering.',
      D: 'Two-way radio contact is required before entering.',
      E: 'No clearance is needed under VFR, but weather minimums apply.'
    },
    /** "SFC", "4,100 ft MSL", "FL180", "700 ft AGL", or "n/a" when the area has no charted limit */
    fmt(v, uom, code) {
      if (String(code).toUpperCase() === 'SFC' || v === 0) return 'SFC';
      if (v == null || v <= -9000) return 'n/a';
      if (String(uom || '').toUpperCase() === 'FL') return 'FL' + v;
      return v.toLocaleString('en-US') + ' ft ' + (String(code).toUpperCase() === 'AGL' ? 'AGL' : 'MSL');
    },
    async _json(url, ms = 10000) {
      const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
      try { const r = await fetch(url, { signal: ac.signal }); if (!r.ok) return { error: 'status ' + r.status }; return { data: await r.json() }; }
      catch (e) { return { error: e && e.name === 'AbortError' ? 'timed out' : 'unreachable' }; }
      finally { clearTimeout(t); }
    },
    /** Controlled airspace over a point, highest class first. */
    async airspaceAt(lon, lat) {
      const q = new URLSearchParams({ where: "CLASS IN ('B','C','D','E')", geometry: lon + ',' + lat, geometryType: 'esriGeometryPoint', inSR: 4326, spatialRel: 'esriSpatialRelIntersects', outFields: '*', returnGeometry: 'false', f: 'geojson' });
      const r = await this._json(this.AIR + '?' + q);
      if (r.error) return r;
      if (!r.data || !r.data.features) return { error: 'unexpected reply' };
      const areas = r.data.features.map(f => {
        const p = f.properties;
        return { cls: p.CLASS, name: p.NAME || '', floor: this.fmt(p.LOWER_VAL, p.LOWER_UOM, p.LOWER_CODE), ceil: this.fmt(p.UPPER_VAL, p.UPPER_UOM, p.UPPER_CODE) };
      });
      const seen = new Set();
      return { areas: areas.filter(a => { const k = a.cls + a.name + a.floor + a.ceil; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => (this.PRI[b.cls] || 0) - (this.PRI[a.cls] || 0)) };
    },
    /** Active TFRs from the FAA list, optionally limited to one state. The reply shape is not documented, so it is read defensively. */
    async tfrs(state) {
      const r = await this._json(this.TFR_LIST);
      if (r.error) return r;
      const rows = Array.isArray(r.data) ? r.data : Array.isArray(r.data && r.data.data) ? r.data.data : null;
      if (!rows) return { error: 'unexpected reply' };
      const list = rows.map(x => ({ id: x.notam_id || x.notamId || '', type: x.type || '', state: x.state || '', facility: x.facility || '', description: String(x.description || '').slice(0, 220), created: x.creation_date || x.creationDate || '' }));
      return { list: state ? list.filter(x => x.state === state) : list, total: list.length };
    }
  };
  window.FAA = FAA;
})();
