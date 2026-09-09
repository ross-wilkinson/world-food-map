"""Pull production / trade / domestic-supply totals per country-commodity-year from
the FAOSTAT Food Balance Sheets. These give the self-sufficiency and import-dependency
ratios; the bilateral shares come from the trade matrix instead."""
import csv, io, zipfile

ZIP = "data/raw/fbs.zip"
MEMBER = "FoodBalanceSheets_E_All_Data_(Normalized).csv"
OUT = "data/interim/fbs.csv"
MIN_YEAR = 2010

ITEMS = {"2511": "wheat", "2513": "barley", "2514": "maize",
         "2555": "soybeans", "2577": "palm_oil", "2807": "rice"}
ELEMENTS = {"5511": "production", "5611": "imports", "5911": "exports",
            "5301": "domestic_supply", "5142": "food", "5521": "feed",
            "5131": "processing",
            # per-capita food use, already divided by population by FAO (kg/cap/yr)
            "645": "food_per_capita"}
PATTERNS = [(',"%s",' % c).encode() for c in ITEMS]

units = {}
rows = kept = 0
zf = zipfile.ZipFile(ZIP)
with zf.open(MEMBER) as raw, open(OUT, "w", newline="", encoding="utf-8") as out:
    w = csv.writer(out)
    w.writerow(["m49", "area", "commodity", "element", "year", "value_t"])
    first = True
    for line in raw:
        if first:
            first = False
            continue
        rows += 1
        if not any(p in line for p in PATTERNS):
            continue
        r = next(csv.reader(io.StringIO(line.decode("utf-8"))))
        if len(r) < 12:
            continue
        commodity = ITEMS.get(r[3])
        element = ELEMENTS.get(r[6])
        if commodity is None or element is None:
            continue
        try:
            year = int(r[9]); val = float(r[11])
        except ValueError:
            continue
        if year < MIN_YEAR:
            continue
        units[r[10]] = units.get(r[10], 0) + 1
        # FBS ships these elements in 1000 t; normalise to tonnes
        if r[10].strip() in ("1000 t", "1000 tonnes"):
            val *= 1000.0
        w.writerow([r[1].lstrip("'"), r[2], commodity, element, year, val])
        kept += 1
print("units seen:", units)
if kept == 0:
    raise SystemExit("FATAL: prefilter matched nothing - check CSV quoting")
print(f"DONE rows={rows} kept={kept}")
