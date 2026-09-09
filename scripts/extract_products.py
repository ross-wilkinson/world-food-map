"""Extract bilateral trade in the PROCESSED forms of each cereal.

FBS reports "<crop> and products" in primary equivalent; the trade matrix reports
individual items in product weight. This pulls the processed items so we can measure
how much of the FBS-vs-bilateral gap they actually account for.

FINDING (2023, run this to reproduce): they do not account for enough to be worth
showing as a "products" breakdown alongside the grain view.

    commodity   grain only   + these products
    wheat              62%                78%     47% of the US total still missing
    maize              82%                86%
    rice               64%                65%     no meaningful gain
    barley             81%               113%     OVERSHOOTS

Barley passing 100% is the disqualifying result: the trade matrix reports product
weight while FBS reports primary equivalent, so beer and malt outweigh the barley
inside them and the two cannot be summed. FAO's extraction factors are not published
in these files, so the conversion cannot be reproduced. The basket is also full of
HS catch-alls -- 30% of world "wheat products" imports is "Pastry" and 4.7% is
"Communion wafers ... and similar products".

Kept as the evidence for that decision, and as a starting point if a products view is
ever wanted as its own question (in product weight) rather than as a decomposition
of the FBS total. Not part of the build pipeline.

Rice deliberately excludes items 27/28/29/31/32: item 30, already used for the grain
view, is FAO's milled-equivalent aggregate over exactly those, so adding them would
double count.
"""
import csv, io, zipfile

ZIP = "data/raw/trade_matrix.zip"
MEMBER = "Trade_DetailedTradeMatrix_E_All_Data_(Normalized).csv"
CODES = "Trade_DetailedTradeMatrix_E_ItemCodes.csv"
OUT = "data/interim/trade_products.csv"
MIN_YEAR = 2010
ELEMENTS = {"5610": "import", "5910": "export"}

PRODUCTS = {
    "wheat":  ["16", "17", "18", "19", "20", "21", "22", "110", "113", "115"],
    "maize":  ["57", "58", "59", "446"],
    "rice":   ["35", "37", "38", "39"],
    "barley": ["45", "46", "47", "48", "49", "50", "51"],
}
WANT = {code: com for com, codes in PRODUCTS.items() for code in codes}

zf = zipfile.ZipFile(ZIP)
cpc = {}
for row in csv.reader(io.StringIO(zf.read(CODES).decode("utf-8-sig"))):
    if len(row) >= 3 and row[0] in WANT:
        cpc[row[0]] = row[1].lstrip("'")
missing = set(WANT) - set(cpc)
if missing:
    raise SystemExit(f"FATAL: no CPC code for items {sorted(missing)}")

APOS = chr(39)
PATTERNS = [(',"' + APOS + c + '",').encode() for c in cpc.values()]
print("scanning for:", ", ".join(f"{k}({cpc[k]})" for k in sorted(WANT, key=int)))

kept = scanned = 0
with zf.open(MEMBER) as raw, open(OUT, "w", newline="", encoding="utf-8") as out:
    w = csv.writer(out)
    w.writerow(["reporter_m49", "partner_m49", "commodity", "item_code", "item",
                "flow", "year", "value_t"])
    first = True
    for line in raw:
        scanned += 1
        if first:
            first = False
            continue
        if not any(p in line for p in PATTERNS):
            continue
        r = next(csv.reader(io.StringIO(line.decode("utf-8"))))
        if len(r) < 15:
            continue
        com = WANT.get(r[6])
        flow = ELEMENTS.get(r[9])
        if com is None or flow is None or r[13] != "t":
            continue
        try:
            year, val = int(r[12]), float(r[14])
        except ValueError:
            continue
        if year < MIN_YEAR or val <= 0:
            continue
        w.writerow([r[1].lstrip(APOS), r[4].lstrip(APOS), com, r[6], r[8], flow, year, val])
        kept += 1
        if kept % 200000 == 0:
            print(f"  kept {kept}", flush=True)

if kept == 0:
    raise SystemExit("FATAL: prefilter matched nothing")
print(f"DONE scanned={scanned} kept={kept}")
