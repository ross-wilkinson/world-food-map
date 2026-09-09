# World Food Map

An interactive globe showing where each country's staple crops come from and where
they go — wheat, maize, rice, barley, soybeans and palm oil, 2010–2023, in tonnes.

Pick a country and the globe turns to face it, then animated great-circle arcs flow
in from its suppliers (or out to its customers) with the share each one accounts for
labelled on the map. A flat equal-area projection shows every flow at once, since a
globe can only ever show you one hemisphere.

## What it answers

- **What share of the world's wheat comes from any one country?** The world view
  shades every country by its share of global production, exports or imports —
  who grows it, who sells it, who buys it.
- **Who actually eats it?** *Food use* counts only the part people eat, not the
  much larger flow going to animal feed — 88% of the world's maize never reaches a
  human plate. *Per person* switches to kg/person/year, which is shaded by its own
  value rather than as a share of a world total, because "3% of world eating" says
  nothing about a diet while "128 kg a year" does.
- **Where does a country's supply actually come from?** Ranked partners with
  percentages, drawn as arcs weighted by volume.
- **How exposed is a country?** Imports as a share of domestic supply, exports as a
  share of production, and self-sufficiency, per country per year.

## Data

Everything comes from FAOSTAT, and two different datasets are on screen:

| On screen | Source | Why |
|---|---|---|
| Arcs, ranked partners, percentages | [Detailed Trade Matrix](https://www.fao.org/faostat/en/#data/TM) | The only source with country-to-country flows |
| Production, domestic supply, ratios | [Food Balance Sheets](https://www.fao.org/faostat/en/#data/FBS) | Production and consumption, which the trade matrix does not carry |

They are kept in separate parts of the panel rather than blended. FBS items cover
the crop *and its products* in primary equivalent, while the trade matrix rows are
the raw commodity, so the two totals do not reconcile to the tonne and combining
them would invent precision that isn't there.

### Known caveats, all surfaced in the app

- **Importer and exporter reports disagree** about the same shipment. Each country's
  own customs report is used for its own flows; where a country reported nothing, the
  breakdown is mirrored from its partners' reports and the panel says so.
- **Re-exports look like origins.** Grain routed through the Netherlands or Singapore
  is credited to the last shipper, not the field.
- **Arcs are links, not routes.** Great circles show what connects to what, not the
  sea lane the cargo followed.
- **The two totals on screen are different baskets.** The tiles count the crop *and
  its processed products* in primary equivalent; the ranked list counts the primary
  commodity only. For US wheat that is 12 Mt vs 2.5 Mt — not a reporting gap but a
  scope difference. Where they diverge the panel shows the split explicitly, because
  FAOSTAT publishes no country-by-country detail for the products component.
  Soybeans and palm oil are single FBS items, so they reconcile at 100% and no split
  is shown. `scripts/extract_products.py` records why a grain/products breakdown of
  the aggregate cannot be built faithfully.
- **Some traders have no polygon** at 110m resolution (Singapore, Hong Kong, Malta,
  small island states). They get arc endpoints and a "not on map" flag in the list.

## Running it

```bash
npm install
npm run dev          # http://localhost:5173
```

The generated JSON in `web/public/data/` is committed, so the site runs without
touching the pipeline.

**It has to be served — opening `index.html` from disk will not work.** Browsers
treat a `file://` page as an opaque origin and block it from loading its own module
script, stylesheet and data, so the page sits on "Loading trade data…" forever. The
page detects this and says so, but the fix is either `npm run dev`, or
`npm run build && npm run preview` for the production bundle on
<http://localhost:4173>.

Served properly it loads in about 150 ms locally, ~0.8 s on typical broadband and
~2 s on a slow connection: roughly 300 KB gzipped for the basemap, the wheat data
and the bundle. Switching commodity fetches one more file (180–235 KB gzipped) and
caches it for the session.

## Rebuilding the data

Needs Python 3 (standard library only) and about 500 MB of disk for the archives.

```bash
npm run data:download   # ~475 MB of FAOSTAT archives into data/raw/
npm run data:build      # filter, reconcile, and emit web/public/data/
```

`data:build` streams the 8.5 GB trade matrix straight out of its zip, prefiltering on
CPC byte patterns so a full CSV parse is only paid for the ~0.4% of rows that matter.
It takes a few minutes and never writes the uncompressed file to disk.

To add a commodity, add an entry to `COMMODITIES` in `scripts/build.py` (with its
trade-matrix item code and FBS key) and to `ITEMS` in `scripts/extract_fbs.py` and
`CANDIDATES` in `scripts/extract_trade.py`, then re-run `data:build`.

## Checking it

```bash
npm run build
npm run preview &
npm run check:shots          # screenshots every view to ./shots
npm run check:interactions   # hover, playback, mirrored data, edge cases
```

## Deploying

GitHub Pages is sufficient — it's a static site, the whole payload is about 3.4 MB
with data, and Pages' 1 GB repo and 100 GB/month soft limits are nowhere near
binding. `.github/workflows/deploy.yml` builds and publishes on every push to `main`.

To turn it on: push the repo to GitHub, then **Settings → Pages → Source →
GitHub Actions**. The site lands at `https://<user>.github.io/<repo>/`. The Vite
`base` is `./`, so it works on a project path, a user site, or a custom domain
without changes.

Cloudflare Pages or Netlify would also work and add deploy previews, but neither is
necessary at this size.

## Layout

```
scripts/
  download.mjs        fetch the FAOSTAT archives
  extract_trade.py    stream-filter the 8.5 GB trade matrix
  extract_fbs.py      pull production/supply elements
  centroids.mjs       arc anchors, from each country's largest polygon
  build.py            reconcile both sources -> web/public/data/*.json
  review.mjs          screenshot pass
  interactions.mjs    behavioural checks
web/src/
  model.ts            types, loading, formatting, colour scales
  globe.ts            canvas renderer, projections, drag/zoom, arc animation
  panel.ts            stat tiles and the ranked partner list
  main.ts             state and control wiring
```

Colours follow a validated palette: a single-hue blue sequential ramp for the world
choropleth, and blue/orange for import vs export direction — a pair that clears
colourblind separation and contrast checks against both the light and dark surfaces.
