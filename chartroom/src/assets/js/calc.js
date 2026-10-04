/* Chartroom flight calculations. Plain functions, no DOM, tested in Node (build/test-units.mjs).
   Headings are in degrees. Magnetic variation is positive for EAST ("east is least": magnetic = true - east variation).
   Wind is the direction it blows FROM. Distances in nautical miles, speeds in knots, fuel in US gallons.
   Study use only. Not for flight planning. */
(() => {
  const C = {};
  const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
  const n360 = h => ((h % 360) + 360) % 360;
  C.n360 = n360;
  /** 000 is written as 360 on charts and radios */
  C.hdg = h => { const r = Math.round(n360(h)); return String(r === 0 ? 360 : r).padStart(3, '0'); };
  C.round = (x, d = 0) => Math.round(x * 10 ** d) / 10 ** d;

  /* ----- atmosphere ----- */
  C.pressureAltitude = (elevFt, altimInHg) => elevFt + (29.92 - altimInHg) * 1000;
  C.isaTempC = paFt => 15 - 1.98 * (paFt / 1000);
  /** Density altitude by the usual rule of thumb: 120 ft for each degree C above standard. */
  C.densityAltitude = (elevFt, altimInHg, oatC) => { const pa = C.pressureAltitude(elevFt, altimInHg); return pa + 120 * (oatC - C.isaTempC(pa)); };

  /* ----- navigation ----- */
  C.distanceNm = (la1, lo1, la2, lo2) => { const a = Math.sin(rad(la2 - la1) / 2) ** 2 + Math.cos(rad(la1)) * Math.cos(rad(la2)) * Math.sin(rad(lo2 - lo1) / 2) ** 2; return 2 * 3440.065 * Math.asin(Math.sqrt(a)); };
  C.trueCourse = (la1, lo1, la2, lo2) => { const y = Math.sin(rad(lo2 - lo1)) * Math.cos(rad(la2)), x = Math.cos(rad(la1)) * Math.sin(rad(la2)) - Math.sin(rad(la1)) * Math.cos(rad(la2)) * Math.cos(rad(lo2 - lo1)); return n360(deg(Math.atan2(y, x))); };
  C.trueToMagnetic = (t, varEast) => n360(t - varEast);
  C.magneticToTrue = (m, varEast) => n360(m + varEast);
  C.smi = nm => nm * 1.15078;

  /**
   * Wind triangle. Returns null when the wind is too strong to hold the course at this airspeed.
   * wca is positive when you must point right of course (wind from the right).
   */
  C.windTriangle = (tc, tas, windDir, windSpeed) => {
    const wa = rad(windDir - tc);
    const s = windSpeed * Math.sin(wa) / tas;
    if (Math.abs(s) >= 1) return null;
    const wca = Math.asin(s);
    const gs = tas * Math.cos(wca) - windSpeed * Math.cos(wa);
    if (gs <= 0) return null;
    return { wca: deg(wca), th: n360(tc + deg(wca)), gs, headwind: windSpeed * Math.cos(wa), crosswind: windSpeed * Math.sin(wa) };
  };
  /** Headwind (positive) or tailwind (negative) and crosswind (positive from the right) on a runway. */
  C.windComponents = (rwyHdg, windDir, windSpeed) => {
    let a = n360(windDir - rwyHdg); if (a > 180) a -= 360;
    return { head: windSpeed * Math.cos(rad(a)), cross: windSpeed * Math.sin(rad(a)), angle: a };
  };
  /** Runway number times ten is the magnetic heading. */
  C.runwayHeading = ident => { const n = parseInt(String(ident), 10); return n >= 1 && n <= 36 ? n * 10 : null; };
  C.bestRunway = (runways, windDirMag, windSpeed) => {
    const ends = [];
    for (const [le, he] of runways) for (const id of [le, he]) { const h = C.runwayHeading(id); if (h != null) ends.push({ id, hdg: h, ...C.windComponents(h, windDirMag, windSpeed) }); }
    return ends.sort((a, b) => b.head - a.head);
  };

  /* ----- time and fuel ----- */
  C.minutes = (distNm, gs) => distNm / gs * 60;
  C.hm = min => { const t = Math.round(min); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
  /** 14 CFR 91.151: 30 minutes by day, 45 at night (airplanes, VFR, normal cruise). */
  C.vfrReserveMin = night => night ? 45 : 30;
  C.fuelPlan = ({ eteMin, burnGph, reserveMin, taxiGal = 0 }) => {
    const trip = burnGph * eteMin / 60, reserve = burnGph * reserveMin / 60;
    return { trip, reserve, taxi: taxiGal, total: trip + reserve + taxiGal };
  };
  C.endurance = (fuelGal, burnGph) => fuelGal / burnGph * 60;                    // minutes
  C.rangeNm = (fuelGal, burnGph, gs, reserveMin) => Math.max(0, (fuelGal / burnGph * 60 - reserveMin) / 60 * gs);

  /* ----- weight and balance ----- */
  C.AVGAS_LB_PER_GAL = 6.0;
  /** items: [{ weight, arm }]. Moment in lb-in. */
  C.balance = items => { const weight = items.reduce((s, i) => s + i.weight, 0), moment = items.reduce((s, i) => s + i.weight * i.arm, 0); return { weight, moment, cg: weight ? moment / weight : 0 }; };
  /** envelope: polygon of [arm, weight] points. Ray casting. */
  C.inEnvelope = (arm, weight, env) => {
    let inside = false;
    for (let i = 0, j = env.length - 1; i < env.length; j = i++) {
      const [xi, yi] = env[i], [xj, yj] = env[j];
      if ((yi > weight) !== (yj > weight) && arm < (xj - xi) * (weight - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  /** forward and aft CG limits at a weight, read off the envelope polygon (null outside its weight range). */
  C.limitsAt = (weight, env) => {
    const xs = [];
    for (let i = 0, j = env.length - 1; i < env.length; j = i++) {
      const [xi, yi] = env[i], [xj, yj] = env[j];
      if ((yi - weight) * (yj - weight) <= 0 && yi !== yj) xs.push(xi + (weight - yi) * (xj - xi) / (yj - yi));
    }
    return xs.length ? { fwd: Math.min(...xs), aft: Math.max(...xs) } : null;
  };
  window.CALC = C;
})();
