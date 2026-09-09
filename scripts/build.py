"""Turn the filtered FAOSTAT extracts into the compact JSON the site loads.

Two sources, deliberately kept in separate panels because they are not the same
measurement:

  * bilateral shares  <- Detailed Trade Matrix, one primary item per commodity
  * production / supply ratios <- Food Balance Sheets, "<crop> and products"

FBS aggregates cover processed derivatives in primary equivalent while the trade
matrix rows are the raw commodity, so the two will not reconcile to the tonne.
Mixing them into one number would invent precision that isn't there.
"""
import csv, json, collections, datetime, os

CENTROIDS = "data/interim/centroids.json"
TRADE = "data/interim/trade_candidates.csv"
FBS = "data/interim/fbs.csv"
OUT_DIR = "web/public/data"

# One trade-matrix item per commodity. Rice uses item 30, FAO's milled-equivalent
# aggregate -- summing the individual rice items instead would double count.
COMMODITIES = [
    {"id": "wheat",    "name": "Wheat",       "trade_items": ["15"],  "fbs": "wheat",
     "primary": "grain",
     "note": "Trade shares cover wheat grain; flour and other products are excluded."},
    {"id": "maize",    "name": "Maize (corn)", "trade_items": ["56"], "fbs": "maize",
     "primary": "grain",
     "note": "Trade shares cover maize grain, which is dominated by feed use."},
    {"id": "rice",     "name": "Rice",        "trade_items": ["30"],  "fbs": "rice",
     "primary": "milled rice",
     "note": "Trade shares use FAO's rice milled-equivalent aggregate."},
    {"id": "soybeans", "name": "Soybeans",    "trade_items": ["236"], "fbs": "soybeans",
     "primary": "whole beans",
     "note": "Trade shares cover the whole bean; soybean oil and meal are excluded."},
    {"id": "barley",   "name": "Barley",      "trade_items": ["44"],  "fbs": "barley",
     "primary": "grain",
     "note": "Trade shares cover barley grain, largely for feed and malting."},
    {"id": "palm_oil", "name": "Palm oil",    "trade_items": ["257"], "fbs": "palm_oil",
     "primary": "oil",
     "note": "Trade shares cover palm oil; palm kernel oil is a separate commodity."},
]

# M49 codes that are regions/economic groupings, not countries.
AGGREGATES = {
    "001", "002", "005", "009", "011", "013", "014", "015", "017", "018", "019",
    "021", "029", "030", "034", "035", "039", "053", "054", "057", "061", "097",
    "142", "143", "145", "150", "151", "154", "155", "199", "432", "722", "901",
    "902", "159",  # 159 = FAO's China aggregate; we keep mainland/HK/Macao/Taiwan apart
}
WORLD = "001"

# Places that trade meaningfully but have no polygon in the 110m basemap.
EXTRA_COORDS = {
    "702": (103.82, 1.35), "344": (114.17, 22.32), "446": (113.55, 22.20),
    "480": (57.55, -20.28), "048": (50.56, 26.07), "470": (14.42, 35.90),
    "132": (-23.62, 15.12), "462": (73.51, 4.18), "052": (-59.55, 13.19),
    "174": (43.33, -11.70), "308": (-61.68, 12.12), "670": (-61.20, 13.25),
    "258": (-149.45, -17.65), "882": (-172.10, -13.76), "678": (6.61, 0.25),
    "690": (55.49, -4.62), "584": (171.14, 7.11), "296": (173.00, 1.45),
    "662": (-60.98, 13.91), "028": (-61.80, 17.06), "234": (-6.91, 62.01),
    "212": (-61.37, 15.41), "583": (158.19, 6.92), "776": (-175.20, -21.18),
    "659": (-62.73, 17.34), "798": (179.20, -8.52), "184": (-159.78, -21.23),
    "520": (166.93, -0.53), "772": (-171.86, -9.20), "570": (-169.87, -19.05),
    "585": (134.58, 7.51), "540": (165.62, -21.30), "638": (55.53, -21.11),
    "312": (-61.55, 16.19), "474": (-61.02, 14.64), "254": (-53.13, 3.93),
    "630": (-66.45, 18.22), "850": (-64.80, 17.75), "060": (-64.75, 32.31),
    "531": (-68.99, 12.17), "533": (-69.97, 12.52), "535": (-68.28, 12.18),
    "796": (-71.80, 21.75), "136": (-81.25, 19.31), "092": (-64.62, 18.42),
    "500": (-62.19, 16.74), "663": (-63.08, 18.07), "652": (-62.83, 17.90),
    "666": (-56.20, 46.83), "744": (16.00, 78.50), "316": (144.79, 13.44),
    "016": (-170.70, -14.28), "580": (145.75, 15.20), "275": (35.23, 31.92),
    "020": (1.52, 42.55), "492": (7.41, 43.74), "674": (12.46, 43.94),
    "438": (9.55, 47.16), "336": (12.45, 41.90), "090": (160.16, -9.43),
}

# FAOSTAT's formal names are long; these read better in a ranked list.
RENAME = {
    "United States of America": "United States", "China, mainland": "China",
    "Russian Federation": "Russia", "Iran (Islamic Republic of)": "Iran",
    "Bolivia (Plurinational State of)": "Bolivia",
    "Venezuela (Bolivarian Republic of)": "Venezuela",
    "Republic of Korea": "South Korea",
    "Democratic People's Republic of Korea": "North Korea",
    "United Republic of Tanzania": "Tanzania", "Viet Nam": "Vietnam",
    "Syrian Arab Republic": "Syria", "Republic of Moldova": "Moldova",
    "United Kingdom of Great Britain and Northern Ireland": "United Kingdom",
    "Lao People's Democratic Republic": "Laos",
    "Democratic Republic of the Congo": "DR Congo",
    "China, Hong Kong SAR": "Hong Kong", "China, Macao SAR": "Macao",
    "China, Taiwan Province of": "Taiwan",
    "Netherlands (Kingdom of the)": "Netherlands",
    "Bosnia and Herzegovina": "Bosnia & Herzegovina",
    "Saint Vincent and the Grenadines": "St Vincent & Grenadines",
    "Micronesia (Federated States of)": "Micronesia",
    "Central African Republic": "Central African Rep.",
    "United Arab Emirates": "United Arab Emirates",
    "Antigua and Barbuda": "Antigua & Barbuda",
    "Saint Kitts and Nevis": "St Kitts & Nevis",
    "Trinidad and Tobago": "Trinidad & Tobago",
    "Sao Tome and Principe": "Sao Tome & Principe",
    "Wallis and Futuna Islands": "Wallis & Futuna",
    "Turks and Caicos Islands": "Turks & Caicos",
}

MAX_PARTNERS = 40      # beyond this the tail is folded into one "Other" row
COVERAGE = 0.995       # or until this share of the flow is accounted for
OTHER = "ZZZ"


def norm(m49):
    """FAOSTAT M49 codes carry a leading apostrophe and vary in zero padding."""
    m = m49.strip().lstrip("'")
    return m.zfill(3) if m.isdigit() and len(m) < 3 else m


def main():
    centroids = json.load(open(CENTROIDS, encoding="utf-8"))
    names, coords, on_map, ne_names = {}, {}, {}, {}
    for cid, c in centroids.items():
        coords[cid] = (c["lon"], c["lat"])
        on_map[cid] = True
        # basemap labels are only a fallback; FAOSTAT names the entities we plot
        ne_names[cid] = c["name"]

    # --- Food Balance Sheets -------------------------------------------------
    # fbs[commodity][year][m49][element] = tonnes
    fbs = collections.defaultdict(lambda: collections.defaultdict(dict))
    world_fbs = collections.defaultdict(lambda: collections.defaultdict(dict))
    fbs_years = set()
    for r in csv.DictReader(open(FBS, encoding="utf-8")):
        m = norm(r["m49"])
        year, com, el = int(r["year"]), r["commodity"], r["element"]
        val = float(r["value_t"])
        if m == WORLD:
            world_fbs[com][year][el] = val
            fbs_years.add(year)
            continue
        if m in AGGREGATES:
            continue
        names.setdefault(m, RENAME.get(r["area"], r["area"]))
        fbs[com][year].setdefault(m, {})[el] = val
        fbs_years.add(year)

    # --- Detailed Trade Matrix ----------------------------------------------
    item_to_com = {i: c["id"] for c in COMMODITIES for i in c["trade_items"]}
    # direct[com][year][flow][reporter][partner] = tonnes
    direct = collections.defaultdict(
        lambda: collections.defaultdict(
            lambda: {"import": collections.defaultdict(collections.Counter),
                     "export": collections.defaultdict(collections.Counter)}))
    trade_years = set()
    raw_names = {}
    for r in csv.DictReader(open(TRADE, encoding="utf-8")):
        com = item_to_com.get(r["item_code"])
        if com is None:
            continue
        rep, par = norm(r["reporter_m49"]), norm(r["partner_m49"])
        if rep in AGGREGATES or par in AGGREGATES or rep == par:
            continue
        year = int(r["year"])
        raw_names.setdefault(rep, r["reporter"])
        raw_names.setdefault(par, r["partner"])
        direct[com][year][r["flow"]][rep][par] += float(r["value_t"])
        trade_years.add(year)

    for code, nm in raw_names.items():
        names.setdefault(code, RENAME.get(nm, nm))
    for code, nm in ne_names.items():
        names.setdefault(code, RENAME.get(nm, nm))

    for code, (lon, lat) in EXTRA_COORDS.items():
        if code not in coords:
            coords[code] = (lon, lat)
            on_map[code] = False

    years = sorted(trade_years & fbs_years)
    print(f"trade years {min(trade_years)}-{max(trade_years)}, "
          f"fbs years {min(fbs_years)}-{max(fbs_years)}, using {years[0]}-{years[-1]}")

    # --- emit ---------------------------------------------------------------
    os.makedirs(f"{OUT_DIR}/flows", exist_ok=True)
    used = set()
    for spec in COMMODITIES:
        used |= write_commodity(spec, years, direct, fbs, world_fbs, coords, names)

    countries = {}
    for code in sorted(used):
        if code == OTHER or code not in coords:
            continue
        lon, lat = coords[code]
        countries[code] = {"name": names.get(code, code), "lon": lon, "lat": lat,
                           "onMap": on_map.get(code, False)}

    meta = {
        "generated": datetime.date.today().isoformat(),
        "years": years,
        "commodities": [{"id": c["id"], "name": c["name"], "primary": c["primary"],
                         "note": c["note"]} for c in COMMODITIES],
        "countries": countries,
    }
    json.dump(meta, open(f"{OUT_DIR}/meta.json", "w", encoding="utf-8"),
              separators=(",", ":"), ensure_ascii=False)
    print(f"meta.json: {len(countries)} countries, {len(years)} years")


def write_commodity(spec, years, direct, fbs, world_fbs, coords, names):
    com = spec["id"]
    out = {"id": com, "name": spec["name"], "years": {}}
    used = set()
    mirrored = 0
    for year in years:
        d = direct[com][year]
        # exporter-reported flows, indexed by destination, for the mirror fallback
        by_dest = collections.defaultdict(collections.Counter)
        for rep, partners in d["export"].items():
            for par, v in partners.items():
                by_dest[par][rep] += v
        by_src = collections.defaultdict(collections.Counter)
        for rep, partners in d["import"].items():
            for par, v in partners.items():
                by_src[par][rep] += v

        f = fbs[com].get(year, {})
        entries = {}
        codes = set(f) | set(d["import"]) | set(d["export"]) | set(by_dest) | set(by_src)
        for code in codes:
            if code not in coords:
                continue
            rec = {}
            bal = f.get(code, {})
            for key, el in (("p", "production"), ("ds", "domestic_supply"),
                            ("im", "imports"), ("ex", "exports")):
                v = bal.get(el)
                if v:
                    rec[key] = round(v)

            # A country's own customs report is the better source for its own
            # flows; only fall back to what its partners reported if it is silent.
            imp, imp_mirrored = d["import"].get(code), False
            if not imp:
                imp, imp_mirrored = by_dest.get(code), True
            exp, exp_mirrored = d["export"].get(code), False
            if not exp:
                exp, exp_mirrored = by_src.get(code), True

            for key, flows, was_mirrored in (("i", imp, imp_mirrored), ("e", exp, exp_mirrored)):
                if not flows:
                    continue
                pruned, total = prune(flows, coords)
                if not pruned:
                    continue
                rec[key] = pruned
                rec[key + "T"] = round(total)
                if was_mirrored:
                    rec[key + "M"] = 1
                    mirrored += 1
                used.update(p for p, _ in pruned)
            if rec:
                entries[code] = rec
                used.add(code)

        w = world_fbs[com].get(year, {})
        out["years"][str(year)] = {
            "world": {"production": round(w.get("production", 0)),
                      "exports": round(w.get("exports", 0)),
                      "imports": round(w.get("imports", 0))},
            "c": entries,
        }

    path = f"{OUT_DIR}/flows/{com}.json"
    json.dump(out, open(path, "w", encoding="utf-8"), separators=(",", ":"), ensure_ascii=False)
    size = os.path.getsize(path) / 1e6
    print(f"  {com:<9} {size:5.2f} MB  {mirrored} mirrored country-years")
    return used


def prune(flows, coords):
    """Keep the meaningful partners; fold the long tail into a single Other row."""
    items = [(p, v) for p, v in flows.items() if v > 0 and p in coords]
    total = sum(v for _, v in items)
    if total <= 0:
        return [], 0.0
    items.sort(key=lambda kv: -kv[1])
    kept, run = [], 0.0
    for p, v in items:
        if len(kept) >= MAX_PARTNERS or run >= COVERAGE * total:
            break
        kept.append([p, round(v)])
        run += v
    tail = total - run
    if tail > 0.5:
        kept.append([OTHER, round(tail)])
    return kept, total


main()
