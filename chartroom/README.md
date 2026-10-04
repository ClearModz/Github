# Chartroom

A private pilot study site. Plain static pages, built with a small Node script. The sectional chart feature
lives at `/practice/`.

```
npm install      # once
npm run dev      # build, then serve http://localhost:4173
npm test         # build and run the checks (links, accessibility basics, punctuation, icons)
```

## How it is put together
| Path | What it is |
|---|---|
| `src/pages/**/index.html` | One file per page. A JSON comment on line 1 sets title, description and nav highlight. |
| `src/partials/` | Shared head, nav and footer. |
| `src/assets/css/site.css` | Design tokens and shared components. `home.css` and `practice.css` are page styles. |
| `src/assets/js/` | `shell.js` (menu, reveals), `telemetry.js` (errors, analytics), `practice.js` (the sectional feature), `local.js` (airport data and the shared location switch), `weather.js`, `calc.js` (aviation math, unit tested), `faa.js`, `airports.js` and `plan.js`. |
| `src/site.config.json` | Site URL, base path, analytics provider and error endpoint. |
| `build/` | `build.mjs` (writes `dist/`), `check.mjs`, `serve.mjs`. |

Fonts, icons, MapLibre and deck.gl are copied from `node_modules` into `dist/assets` at build time, so the pages make no
calls to Google Fonts or a CDN.

## Analytics and error logging (both off)
Set them in `src/site.config.json`, then rebuild. The privacy page rewrites itself to match.
- `analytics.provider`: `"plausible"` (with `domain`, and `endpoint` for a self-hosted script) or `"goatcounter"` (with `endpoint`).
  Both are cookie-free and are skipped when the browser sends Do Not Track or Global Privacy Control.
- `errorLogging.endpoint`: a URL that accepts a JSON POST. Reports hold the message, script, line, page path and build id. Nothing else.
- In code, `window.CR.track("name", { flag: true })` sends a custom event. Practice already sends `quiz_started`,
  `quiz_answered` and `location_enabled`. Never pass coordinates or answers.

## Deploying
`.github/workflows/chartroom-pages.yml` publishes to GitHub Pages on pushes to `main`. One-time repository setting:
Settings, Pages, Source: GitHub Actions. For a custom domain, set `siteUrl` and `basePath: "/"` in the config.
Any static host works: run `npm test` and publish `dist/`.

## Airport data
`npm run data:update` rebuilds `src/data/airports.json` and `airport-details.json` from OurAirports (public domain). Commit the result. The files carry a retrieved date. Run `npm test` after.
