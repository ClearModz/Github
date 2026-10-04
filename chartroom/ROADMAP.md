# Chartroom roadmap / rules to keep

## "Use my location" must feed every learning tab
The **📍 Use my location** checkbox (Sectional Practice toolbar) sets the shared `LOCAL` object in `index.html`:
`LOCAL.on`, `LOCAL.airports` (public-looking fields within the radius slider, default 150 mi, max 300 mi, nearest first,
with ident, name, city, elevation, distance in NM via `nm`, direction), `LOCAL.mi(nm)`, `LOCAL.setRadius(mi)`,
`LOCAL.pick()` and `LOCAL.subscribe(fn)` (called again whenever the radius changes).

Rule from the owner: **every other learning tab must use the local airports as its examples when the box is on**
(and fall back to a fixed example airport when it is off). Planned topics and how local airports plug in:
- Weather: METAR/TAF for the nearest airports, decode and go/no-go.
- Regulations: airspace class and entry requirements at nearby fields; VFR minimums.
- Aerodynamics: density altitude and performance at the local field elevation.
- Navigation: courses, distances and headings between nearby airports; pilotage landmarks.
- Airport Ops & Radio: CTAF/tower frequencies, runways, pattern calls for nearby fields.
- Weight & Balance: density altitude and takeoff performance from a local field.
- ADM & Aeromedical: risk scenarios departing from a nearby field.

Status: only Sectional Practice uses it so far.
