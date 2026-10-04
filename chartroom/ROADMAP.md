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

## Phase 1: core aviation data
- Airport search and detail pages: runways, frequencies, elevation, a chart link. Replace the 12 MB OurAirports download
  with a trimmed, versioned US extract built into the site.
- Live weather: METAR and TAF on airport pages and on the map. Test CORS from the browser first.
- NOTAM and TFR display.
- Use `LOCAL` for the default airports on every page.

## Phase 2: planning tools
Route planner (distance, heading, time), weight and balance, performance and density altitude, fuel and time, save and
export plans. Each tool starts from a nearby airport when location is on.

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
