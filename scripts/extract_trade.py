"""Stream-filter the 8.5GB FAOSTAT detailed trade matrix down to candidate items.

The full CSV never hits disk uncompressed; we read it straight out of the zip and
prefilter on the CPC code byte-pattern (unique per item, apostrophe-prefixed, so
it cannot collide with M49 area codes) before paying for a full CSV parse.
"""
import csv, io, sys, zipfile

ZIP = "data/raw/trade_matrix.zip"
MEMBER = "Trade_DetailedTradeMatrix_E_All_Data_(Normalized).csv"
OUT = "data/interim/trade_candidates.csv"
MIN_YEAR = 2010
ELEMENTS = {"5610": "import", "5910": "export"}

# item code -> CPC, for every candidate we might want to fold into a commodity
CANDIDATES = {
    "15": "0111", "16": "23110",                                    # wheat
    "56": "0112",                                                   # maize
    "236": "0141", "237": "2161",                                   # soy
    "27": "0113", "28": "23162", "29": "23161.01",                  # rice
    "30": "F0030", "31": "23161.02", "32": "23161.03",
    "44": "0115",                                                   # barley
    "256": "01491.02", "257": "2165",                               # palm
    "656": "01610",                                                 # coffee
    "162": "2351f",                                                 # sugar
}
APOS = chr(39)  # CPC codes are apostrophe-prefixed inside their quoted field
PATTERNS = [(',"' + APOS + cpc + '",').encode() for cpc in CANDIDATES.values()]

def main():
    zf = zipfile.ZipFile(ZIP)
    kept = scanned = 0
    with zf.open(MEMBER) as raw, open(OUT, "w", newline="", encoding="utf-8") as out:
        w = csv.writer(out)
        w.writerow(["reporter_m49", "reporter", "partner_m49", "partner",
                    "item_code", "item", "flow", "year", "value_t"])
        header_skipped = False
        pending = []
        for line in raw:                       # bytes, no decode yet
            scanned += 1
            if not header_skipped:
                header_skipped = True
                continue
            if not any(p in line for p in PATTERNS):
                continue
            pending.append(line.decode("utf-8"))
            if len(pending) >= 20000:
                kept += flush(w, pending); pending = []
            if scanned % 10_000_000 == 0:
                print(f"  scanned {scanned/1e6:.0f}M rows, kept {kept}", flush=True)
        kept += flush(w, pending)
    if kept == 0:
        raise SystemExit("FATAL: prefilter matched nothing - check CSV quoting")
    print(f"DONE scanned={scanned} kept={kept}")

def flush(w, lines):
    n = 0
    for r in csv.reader(io.StringIO("".join(lines))):
        # 0 rcode 1 rM49 2 reporter 3 pcode 4 pM49 5 partner 6 item 7 cpc 8 item
        # 9 elemcode 10 elem 11 yearcode 12 year 13 unit 14 value 15 flag
        if len(r) < 15 or r[6] not in CANDIDATES:
            continue
        flow = ELEMENTS.get(r[9])
        if flow is None or r[13] != "t":
            continue
        try:
            year = int(r[12]); val = float(r[14])
        except ValueError:
            continue
        if year < MIN_YEAR or val <= 0:
            continue
        w.writerow([r[1].lstrip("'"), r[2], r[4].lstrip("'"), r[5],
                    r[6], r[8], flow, year, val])
        n += 1
    return n

main()
