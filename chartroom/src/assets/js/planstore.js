/* Chartroom plan store: the flight plan being worked on, shared by the Airports and Plan pages.
   Saved in this browser only (localStorage "chartroom.plan"). Saved plans are in "chartroom.plans". */
(() => {
  const KEY = 'chartroom.plan', LIST = 'chartroom.plans';
  const read = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
  const DEFAULTS = { from: '', to: '', via: [], tas: 110, burn: 9, varEast: 0, windDir: 0, windSpd: 0, night: false, fuelOnBoard: 40, taxi: 1, perf: null };
  window.PLAN = {
    get() { return { ...DEFAULTS, ...read(KEY, {}) }; },
    set(patch) { const v = { ...this.get(), ...patch }; write(KEY, v); return v; },
    reset() { write(KEY, {}); return this.get(); },
    list() { return read(LIST, []); },
    save(name, plan) { const l = this.list().filter(p => p.name !== name); l.unshift({ name, savedAt: new Date().toISOString(), plan }); return write(LIST, l.slice(0, 50)); },
    remove(name) { return write(LIST, this.list().filter(p => p.name !== name)); }
  };
})();
