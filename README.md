# World Food Map

An interactive globe showing where each country's staple crops come from and where
they go — wheat, maize, rice, barley, soybeans and palm oil, 2010–2023, in tonnes.

Pick a country and the globe turns to face it, then animated great-circle arcs flow
in from its suppliers (or out to its customers) with the share each one accounts for
labelled on the map. A flat equal-area projection shows every flow at once, since a
globe can only ever show you one hemisphere.

## What it answers

- **What share of the world's wheat comes from any one country?** The world view
  shades every country by its share of global production or exports.
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
- **Named partners can undercount.** Where bilateral detail covers less than 95% of a
  country's reported total, the panel says what fraction is accounted for.
- **Some traders have no polygon** at 110m resolution (Singapore, Hong Kong, Malta,
  small island states). They get arc endpoints and a "not on map" flag in the list.

## Running it

```bash
npm install
npm run dev          # http://localhost:5173
```

The generated JSON in `web/public/data/` is committed, so the site runs without
touching the pipeline.

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
