"""Pull the FAO Food Security indicators the exposure view needs.

The other two sources describe the crop: how much is grown, where it moves. They
cannot answer the question that decides whether a shortfall becomes a crisis --
can the country afford to buy its way out? Qatar and Yemen both import essentially
all their cereals; Qatar's food import bill is 3% of its merchandise exports and
Yemen's is 508%. Nothing in the Food Balance Sheets or the trade matrix
distinguishes them.

FAO publishes these already, so they are taken rather than derived. Two of them
overlap measures the app computes itself (cereal import dependency, food supply
variability) and are kept deliberately as a cross-check on our own pipeline.

Undernourishment is extracted but is NOT an input to any score or placement. It is
the outcome variable, held out so the exposure view can be checked against real
hunger instead of asserting it tracks it.
"""
import csv, io, zipfile

ZIP = "data/raw/food_security.zip"
MEMBER = "Food_Security_Data_E_All_Data_(Normalized).csv"
OUT = "data/interim/security.csv"
MIN_YEAR = 2010

# FAOSTAT item code -> the short key used downstream.
INDICATORS = {
    # --- capacity to absorb a price shock ---------------------------------
    # Value of food imports over total merchandise exports. The headline measure
    # of whether a food bill is affordable. Its denominator is merchandise only,
    # so tourism and remittance economies look far worse than they are -- which
    # is why GDP is carried alongside rather than trusting this on its own.
    "21033": "bill",
    "22013": "gdp",           # GDP per capita, PPP, constant 2021 international $
    # Within-country inequality of access. National earnings cannot see it: Gabon
    # runs a 7% food import bill on $18,700 GDP per head and still has 20%
    # undernourishment, because oil revenue does not reach the plate. This is the
    # only indicator here that describes distribution rather than the national total.
    "21058": "accessgap",     # CV of habitual caloric consumption distribution
    # --- exposure, FAO's own version --------------------------------------
    "21035": "cerealdep",     # cereal import dependency ratio, %
    # --- variability and buffers ------------------------------------------
    "21031": "kcalvar",       # per capita food supply variability, kcal/cap/day
    "21034": "irrigation",    # % of arable land equipped for irrigation
    "21012": "cerealshare",   # % of dietary energy from cereals, roots and tubers
    "21010": "adequacy",      # average dietary energy supply adequacy, %
    # --- outcome, held out -------------------------------------------------
    "210041": "undernourished",
}

PATTERNS = [(',"%s",' % c).encode() for c in INDICATORS]


def end_year(label):
    """Three-year averages are labelled '2021-2023'; key them by their last year.

    Using the midpoint would put a value on a year FAO did not publish, and using
    the first would date a 2023 figure to 2021. The last year is the one the
    average is current to.
    """
    label = label.strip()
    if "-" in label:
        label = label.split("-")[-1]
    return int(label)


def main():
    zf = zipfile.ZipFile(ZIP)
    units, kept, rows = {}, 0, 0
    with zf.open(MEMBER) as raw, open(OUT, "w", newline="", encoding="utf-8") as out:
        w = csv.writer(out)
        w.writerow(["m49", "area", "indicator", "year", "value"])
        first = True
        for line in raw:
            if first:
                first = False
                continue
            rows += 1
            if not any(p in line for p in PATTERNS):
                continue
            try:
                r = next(csv.reader(io.StringIO(line.decode("utf-8", errors="replace"))))
            except StopIteration:
                continue
            # 0 areacode 1 M49 2 area 3 item 4 itemname 5 elemcode 6 elem
            # 7 yearcode 8 year 9 unit 10 value 11 flag 12 note
            if len(r) < 11:
                continue
            key = INDICATORS.get(r[3])
            if key is None:
                continue
            try:
                year = end_year(r[8])
                val = float(r[10])
            except ValueError:
                continue
            if year < MIN_YEAR:
                continue
            units[(key, r[9].strip())] = units.get((key, r[9].strip()), 0) + 1
            w.writerow([r[1].lstrip("'"), r[2], key, year, val])
            kept += 1
    print("units seen:", sorted(units))
    if kept == 0:
        raise SystemExit("FATAL: prefilter matched nothing - check CSV quoting")
    print(f"DONE rows={rows} kept={kept}")


main()
