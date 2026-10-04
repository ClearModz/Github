# Chartroom roadmap

The sectional chart feature (`/practice/`) is done and is treated as the core. Everything below is ordered so each
phase can ship on its own.

## Assumptions in force (change them and the plan changes)
- **Audience:** student pilots preparing for the US private pilot knowledge test and checkride.
- **Purpose:** a study tool, not a flight-planning product. Every page says it is not for navigation.
- **Stack:** static pages, vanilla JS, MapLibre and deck.gl. A small Node script builds the site. No backend yet.
- **Hosting:** GitHub Pages through the included workflow. Any static host also works.

## Standing rules
1. **"Use my location" must feed every learning tab.** The switch in Sectional Practice sets the shared `LOCAL` object
   (`LOCAL.on`, `LOCAL.airports` within the radius slider, `LOCAL.pick()`, `LOCAL.setRadius()`, `LOCAL.subscribe()`).
   Every new learning tab uses nearby airports as its examples when it is on, and a fixed example airport when it is off.
2. **No tracking by default.** Analytics and error reporting stay off until a provider or endpoint is chosen, and the
   privacy page rewrites itself to match the config.
3. **Study-only wording** stays in the footer and on the disclaimer page.
4. Run `npm test` before every push. It checks links, accessibility basics, punctuation, icons and CDN references.

## Phase 0: foundation (built)
| Item | Status | Notes |
|---|---|---|
| Site shell: nav, layout, responsive, branding | Done | Floating nav with a full-screen mobile menu, dark instrument-panel design system, wordmark and favicon. The home page uses a radar graphic as its visual. |
| Routing and hosting | Done | Clean URLs as `folder/index.html`, 404 page, sitemap and robots when a site URL is set. |
| Deployment pipeline | Done, needs one switch | `.github/workflows/chartroom-pages.yml`. In the repository: Settings, Pages, Source: GitHub Actions. It publishes on pushes to `main`. |
| Analytics and error logging | Hooks done, both off | `telemetry.js` and `site.config.json`. Needs a decision: Plausible, GoatCounter, or none, and an endpoint for error reports. |
| Legal pages | Drafted | Disclaimer, privacy (with a button that clears saved location data) and data credits. |
| Self-hosted fonts and libraries | Done | No Google Fonts or CDN calls. Map data services are the only third parties. |

### Phase 0 follow-ups (small, do before launch)
- Have a lawyer read the three legal pages. They are plain-language drafts, not legal advice.
- Add a contact method to the privacy page once there is one.
- Verify FAA data terms and the AWS terrain attribution wording (see research list below).
- Replace the MapLibre demo glyph server (`demotiles.maplibre.org`), used for airspace labels, with fonts served from this
  site. The demo server is not meant for production.
- Capture real screenshots of the 3D airspace on a machine with network access. Use them for the home page, the social
  preview image (`og:image`) and the bento cards.
- Choose the final brand direction. The current mark is a simple radar glyph.

## Phase 1: core aviation data (built, live services unverified)
| Item | Status | Notes |
|---|---|---|
| Airport search and detail pages | Done | `/airports/`. 4,622 US airports with runways, frequencies, elevation and a link to the sectional. Search by code, name or city. |
| Trimmed, versioned airport data | Done | `src/data/airports.json` and `airport-details.json`, built by `npm run data:update` from OurAirports (public domain). The retrieved date is inside the file. It replaces the 12 MB download. |
| METAR and TAF | Built, **not verified live** | `weather.js` parses raw reports and sets the FAA flight category. Parsing is unit tested. The request to aviationweather.gov was not tested from a browser with real network access, so confirm its raw format and CORS first thing. If it fails the page links to the official report. |
| TFR display | Built, **not verified live** | `faa.js` reads the tfr.faa.gov list by state and falls back to a link. Same caveat as weather. |
| NOTAMs | Link only | The FAA NOTAM API needs registration. Pages link to the official source. |
| Airspace at an airport | Done | Uses the same FAA Class Airspace service as Sectional Practice. |
| `LOCAL` for default airports | Done | Airports, Plan and Practice share `local.js`. |

## Phase 2: planning tools (built)
| Tool | Status | Notes |
|---|---|---|
| Route planner | Done | Up to two stops, wind triangle, true and magnetic heading, ground speed, time and fuel per leg, route map. |
| Weight and balance | Done | Envelope chart with takeoff and landing points. Ships with an **illustrative example aircraft**, clearly labeled. Students enter their own handbook numbers, saved in the browser. |
| Performance | Done | Pressure and density altitude, runway headwind and crosswind, crosswind limit flag, rule-of-thumb takeoff roll, one-click METAR fill. |
| Fuel and time | Done | Endurance, range, 91.151 day and night reserves, margin for the route. |
| Save and export | Done | Named plans in the browser, JSON download and open, print view, copy as text. |
| Starts from nearby airports | Done | When location is on, Plan starts at the nearest airport and offers a suggested trip. |

Tests: `npm test` runs 26 unit tests (weather parsing, flight categories, aviation math), the build and the site checks.
Browser tests with mocked weather and FAA services passed for Airports, Plan and Sectional Practice, with no axe violations
and no horizontal scroll at 390 px. Real-network behavior still needs a check on a normal connection.

## Phase 3: accounts and personalization
Sign-up and login, saved routes, favorite airports, aircraft profiles, digital logbook. This is the first phase that
needs a backend. Decide the provider and update the privacy page before building it.

## Phase 4: content and learning
Study topics from the home page, each with lessons, checklists and questions built on local airports:
Weather, Regulations, Aerodynamics, Navigation, Airport Operations and Radio, Weight and Balance, ADM and Aeromedical.
Also a glossary and regulations reference, and a blog or news area.

## Phase 5: polish and launch
Performance budget and SEO, offline support (PWA), full accessibility audit with a screen reader, real-pilot beta, public
launch. The vendored map libraries are about 3 MB and should be lazy-loaded where possible.

## Phase 6: later
Community features, a mobile app, a premium tier.

## Research to finish before the matching phase
| Question | Why |
|---|---|
| FAA terms for the sectional tile and Class Airspace services used today | Both are public ArcGIS endpoints with no published uptime promise. Decide whether to mirror data from the 28-day NASR release. |
| FAA NASR data license and cycle (28 and 56 day cycles) | Phase 1 airports and a safer airspace source. |
| aviationweather.gov API terms, rate limits and CORS | Phase 1 weather. |
| NOTAM source and access terms | Phase 1 NOTAMs. The FAA NOTAM API needs registration. |
| OpenFreeMap fair-use limits, OpenMapTiles attribution wording | The base map under the airspace. |
