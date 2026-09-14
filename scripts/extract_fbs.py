"""Pull production / trade / domestic-supply totals per country-commodity-year from
the FAOSTAT Food Balance Sheets. These give the self-sufficiency and import-dependency
ratios; the bilateral shares come from the trade matrix instead.

Calories and population come out of here too. Kilograms cannot compare one crop
against another -- 100 kg of barley and 100 kg of wheat are not the same amount of
food -- so the dietary weight of a crop is carried as kcal/capita/day, which is the
unit the exposure view needs to say how much a country's diet actually rests on it.
"""
import csv, io, zipfile

ZIP = "data/raw/fbs.zip"
MEMBER = "FoodBalanceSheets_E_All_Data_(Normalized).csv"
OUT = "data/interim/fbs.csv"
MIN_YEAR = 2010

# 2501 is FAO's population row, not a crop; it rides along on the same pass so the
# per-country denominators come from the same file and vintage as everything else.
ITEMS = {"2511": "wheat", "2513": "barley", "2514": "maize",
         "2555": "soybeans", "2577": "palm_oil", "2807": "rice",
         "2501": "population"}
ELEMENTS = {"5511": "production", "5611": "imports", "5911": "exports",
            "5301": "domestic_supply", "5142": "food", "5521": "feed",
            "5131": "processing",
            # per-capita food use, already divided by population by FAO (kg/cap/yr)
            "645": "food_per_capita",
            # dietary energy from this crop -- the common unit across commodities
            "664": "kcal_per_capita",
            # total population, on item 2501 only (unit "1000 No")
            "511": "population"}
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
        unit = r[10].strip()
        # FBS ships tonnage elements in 1000 t and population in 1000 No; both
        # scale by the same factor, and kcal/cap/day and kg/cap/yr pass through.
        if unit in ("1000 t", "1000 tonnes", "1000 No"):
            val *= 1000.0
        w.writerow([r[1].lstrip("'"), r[2], commodity, element, year, val])
        kept += 1
print("units seen:", units)
if kept == 0:
    raise SystemExit("FATAL: prefilter matched nothing - check CSV quoting")
print(f"DONE rows={rows} kept={kept}")
