// Unit tests for the plain-code modules (weather.js, calc.js). Run by npm test. No dependencies.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (file, extra = {}) => { const sb = { window: {}, console, Math, Date, Number, String, Array, Object, JSON, Set, Map, URL, ...extra }; sb.window.window = sb.window; vm.runInNewContext(readFileSync(path.join(ROOT, 'src/assets/js', file), 'utf8'), sb); return sb.window; };
let fails = 0, n = 0;
export const test = (name, fn) => { n++; try { fn(); } catch (e) { fails++; console.error(`FAIL ${name}\n     ${e.message}`); } };
export const eq = (a, b, msg = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
export const near = (a, b, tol, msg = '') => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${msg} expected ${b} +/- ${tol}, got ${a}`); };

const NOW = new Date(Date.UTC(2026, 9, 4, 20, 30));
const { WX } = load('weather.js');

test('METAR: plain VFR day', () => {
  const m = WX.parseMetar('METAR KSEA 041953Z 18008KT 10SM FEW040 SCT250 14/08 A3002 RMK AO2 SLP168 T01440078', NOW);
  eq([m.station, m.hour, m.minute, m.ageMin], ['KSEA', 19, 53, 37]);
  eq(m.wind, { dir: 180, speed: 8, gust: null }); eq(m.vis, 10); eq(m.ceiling, null);
  eq([m.temp, m.dew, m.spread, m.altim, m.category], [14, 8, 6, 30.02, 'VFR']);
  eq(m.clouds.map(c => c.cover + c.base), ['FEW4000', 'SCT25000']);
});
test('METAR: gusts, rain, mist, low ceiling is IFR', () => {
  const m = WX.parseMetar('KBFI 041853Z 24012G22KT 3SM -RA BR BKN008 OVC015 10/09 A2985', NOW);
  eq(m.wind, { dir: 240, speed: 12, gust: 22 }); eq(m.wx, ['light rain', 'mist']); eq(m.ceiling, 800); eq(m.category, 'IFR');
});
test('METAR: mixed fraction visibility, vertical visibility and negative temperatures', () => {
  const m = WX.parseMetar('KXYZ 041853Z VRB03KT 1 1/2SM FG VV002 M02/M03 A3010', NOW);
  eq(m.wind.dir, 'VRB'); eq(m.vis, 1.5); eq(m.ceiling, 200); eq([m.temp, m.dew], [-2, -3]); eq(m.category, 'LIFR'); eq(m.wx, ['fog']);
});
test('METAR: calm wind, P6SM, clear', () => {
  const m = WX.parseMetar('KPDX 041853Z 00000KT P6SM SKC 20/05 A2992', NOW);
  eq(m.wind, { dir: 0, speed: 0, gust: null }); eq(m.visText, '6+'); eq(m.category, 'VFR'); eq(m.ceiling, null);
});
test('METAR: M1/4SM is LIFR and AUTO is noticed', () => {
  const m = WX.parseMetar('KABC 041853Z AUTO 00000KT M1/4SM FG OVC001 05/05 A2999', NOW);
  eq(m.vis, 0.25); eq(m.auto, true); eq(m.category, 'LIFR'); eq(m.wx, ['fog']);
});
test('METAR: month rollover keeps the observation in the past', () => {
  const m = WX.parseMetar('KSEA 312355Z 00000KT 10SM CLR 10/05 A3000', new Date(Date.UTC(2026, 10, 1, 0, 10)));
  eq(m.time.toISOString(), '2026-10-31T23:55:00.000Z'); eq(m.ageMin, 15);
});
test('METAR: garbage is rejected', () => { eq(WX.parseMetar('hello world'), null); eq(WX.parseMetar(''), null); });
test('Flight category boundaries', () => {
  const f = WX.flightCategory;
  eq(f(3100, 10), 'VFR'); eq(f(3000, 10), 'MVFR'); eq(f(1000, 10), 'MVFR'); eq(f(999, 10), 'IFR'); eq(f(500, 10), 'IFR'); eq(f(499, 10), 'LIFR');
  eq(f(null, 6), 'VFR'); eq(f(null, 5), 'MVFR'); eq(f(null, 3), 'MVFR'); eq(f(null, 2.9), 'IFR'); eq(f(null, 1), 'IFR'); eq(f(null, 0.75), 'LIFR');
});
test('TAF: base forecast and change groups', () => {
  const t = WX.splitTaf('TAF KSEA 041720Z 0418/0524 17008KT P6SM SCT040 FM042100 20010KT P6SM BKN030 TEMPO 0504/0508 3SM -RA OVC015');
  eq(t.station, 'KSEA'); eq(t.periods.length, 3);
  eq(t.periods.map(p => p.category), ['VFR', 'MVFR', 'MVFR']);   // TEMPO: 3SM and OVC015 are both MVFR, not IFR
  eq(t.periods[1].label, 'From day 04 21:00Z'); eq(t.periods[2].label, 'Temporarily'); eq(t.periods[0].wind.speed, 8);
});
test('official links', () => { const l = WX.officialLinks('KSEA'); eq(l.metar.includes('ids=KSEA'), true); eq(l.airnav.endsWith('/KSEA'), true); });


const { CALC: C } = load('calc.js');
test('density altitude: Denver, standard pressure, 30 C', () => near(C.densityAltitude(5431, 29.92, 30), 8521.5, 1));
test('density altitude: sea level at standard conditions is zero', () => near(C.densityAltitude(0, 29.92, 15), 0, 0.01));
test('pressure altitude follows the altimeter setting', () => { near(C.pressureAltitude(1000, 29.92), 1000, 0.01); near(C.pressureAltitude(1000, 30.42), 500, 0.01); near(C.pressureAltitude(1000, 29.42), 1500, 0.01); });
test('ISA temperature falls about 2 C per 1000 ft', () => { near(C.isaTempC(0), 15, 0.001); near(C.isaTempC(10000), -4.8, 0.01); });
test('runway wind components', () => {
  const w = C.windComponents(180, 220, 20); near(w.head, 15.32, 0.01); near(w.cross, 12.86, 0.01);
  const left = C.windComponents(180, 140, 20); near(left.cross, -12.86, 0.01);
  const tail = C.windComponents(360, 180, 10); near(tail.head, -10, 0.01); near(tail.cross, 0, 0.001);
});
test('runway number is the magnetic heading', () => { eq(C.runwayHeading('16L'), 160); eq(C.runwayHeading('34R'), 340); eq(C.runwayHeading('H1'), null); eq(C.runwayHeading('36'), 360); });
test('best runway picks the most headwind', () => { const b = C.bestRunway([['16L', '34R'], ['09', '27']], 330, 15); eq(b[0].id, '34R'); });
test('variation: east is least', () => { near(C.trueToMagnetic(90, 15), 75, 1e-9); near(C.trueToMagnetic(90, -15), 105, 1e-9); near(C.magneticToTrue(75, 15), 90, 1e-9); near(C.trueToMagnetic(5, 15), 350, 1e-9); });
test('great circle: Seattle Sea-Tac to Portland PDX', () => {
  const d = C.distanceNm(47.4479, -122.3103, 45.5887, -122.5975); near(d, 112, 3);
  near(C.trueCourse(47.4479, -122.3103, 45.5887, -122.5975), 186, 2);
});
test('true course: due east on the equator is 090, due north is 360', () => { near(C.trueCourse(0, 0, 0, 1), 90, 0.01); near(C.trueCourse(0, 0, 1, 0), 0, 0.01); });
test('wind triangle: crosswind from the left', () => {
  const t = C.windTriangle(90, 100, 0, 20); near(t.wca, -11.54, 0.01); near(t.th, 78.46, 0.01); near(t.gs, 97.98, 0.01);
});
test('wind triangle: direct headwind and tailwind', () => {
  near(C.windTriangle(90, 100, 90, 20).gs, 80, 0.001); near(C.windTriangle(90, 100, 270, 20).gs, 120, 0.001); near(C.windTriangle(90, 100, 90, 20).wca, 0, 0.001);
});
test('wind triangle: course cannot be held in a gale across the track', () => eq(C.windTriangle(90, 60, 0, 70), null));
test('time and fuel', () => {
  eq(C.hm(135), '2:15'); near(C.minutes(112, 100), 67.2, 0.01);
  const f = C.fuelPlan({ eteMin: 90, burnGph: 9, reserveMin: 30, taxiGal: 1 }); near(f.trip, 13.5, 1e-9); near(f.reserve, 4.5, 1e-9); near(f.total, 19, 1e-9);
  eq(C.vfrReserveMin(false), 30); eq(C.vfrReserveMin(true), 45);
  near(C.endurance(40, 10), 240, 1e-9); near(C.rangeNm(40, 10, 100, 30), 350, 1e-9);
});
test('weight and balance and envelope', () => {
  const env = [[35, 1500], [35, 1950], [41, 2550], [47.3, 2550], [47.3, 1500]];
  const b = C.balance([{ weight: 1650, arm: 40 }, { weight: 340, arm: 37 }, { weight: 240, arm: 48 }]);
  near(b.weight, 2230, 1e-9); near(b.cg, (66000 + 12580 + 11520) / 2230, 1e-9);
  near(C.limitsAt(2300, env).fwd, 38.5, 1e-9); near(C.limitsAt(2300, env).aft, 47.3, 1e-9);
  eq(C.inEnvelope(40, 2300, env), true); eq(C.inEnvelope(38, 2300, env), false); eq(C.inEnvelope(46, 2600, env), false); eq(C.inEnvelope(36, 1800, env), true);
});
test('heading format uses 360 for north', () => { eq(C.hdg(0), '360'); eq(C.hdg(5), '005'); eq(C.hdg(359.6), '360'); eq(C.hdg(-10), '350'); });

console.log(fails ? `${fails} of ${n} unit tests FAILED` : `OK: ${n} unit tests passed.`);
process.exit(fails ? 1 : 0);
