"""Download ~3 years of daily OHLC for every US-listed common stock (Yahoo Finance via yfinance).

Ticker list: nasdaqtrader.com symbol directory (all US exchanges). Kept: common / ordinary shares,
not ETFs, test issues, warrants, units, rights, preferreds, notes or ADRs.
Writes <out>/<TICKER>.json ({dates, open, high, low, close}) and <out>/_list.json.
Usage: python scripts/fetch_stocks.py out/stocks [max_tickers]
"""
import json, pathlib, re, sys, time, urllib.request

import yfinance as yf

OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "out/stocks")
LIMIT = int(sys.argv[2]) if len(sys.argv) > 2 else None
MIN_BARS = 320  # EMA 300 warmup + a few candles to test the rule on
SYMDIR = "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqtraded.txt"
KEEP = re.compile(r"common stock|common shares|ordinary shares", re.I)
DROP = re.compile(r"warrant|\bunits?\b|\brights?\b|preferred|depositary|\bnotes?\b|debenture", re.I)
TV_EXCH = {"Q": "NASDAQ", "N": "NYSE", "A": "AMEX", "P": "AMEX", "Z": "CBOE", "V": "NYSE"}


def tickers():
    req = urllib.request.Request(SYMDIR, headers={"User-Agent": "Mozilla/5.0"})
    lines = urllib.request.urlopen(req, timeout=60).read().decode().splitlines()
    head = lines[0].split("|")
    out = []
    for ln in lines[1:]:
        r = dict(zip(head, ln.split("|")))
        sym, name = r.get("Symbol", ""), r.get("Security Name", "").strip()
        if r.get("ETF") != "N" or r.get("Test Issue") != "N" or not re.fullmatch(r"[A-Z]+(\.[A-Z])?", sym):
            continue
        if not KEEP.search(name) or DROP.search(name):
            continue
        clean = re.sub(r"\s*-\s.*$|\s+(New\s+)?(Class [A-Z]\s+)?(Common|Ordinary) (Stock|Shares).*$", "", name).strip()
        out.append({"t": sym.replace(".", "-"), "n": clean or name, "tv": f"{TV_EXCH.get(r['Listing Exchange'], 'NYSE')}:{sym}"})
    return out


def rnd(v):
    return round(float(v), 4 if v < 10 else 2)


def main():
    syms = tickers()[:LIMIT]
    print(f"{len(syms)} candidate tickers")
    OUT.mkdir(parents=True, exist_ok=True)
    by_t, kept = {s["t"]: s for s in syms}, []
    for b in range(0, len(syms), 200):
        batch = [s["t"] for s in syms[b:b + 200]]
        for attempt in range(3):
            try:
                df = yf.download(batch, period="3y", interval="1d", auto_adjust=True, group_by="ticker",
                                 progress=False, threads=True)
                break
            except Exception as e:  # network hiccup: retry the batch, then skip it
                print(f"batch {b}: {e}"); time.sleep(10); df = None
        if df is None or df.empty:
            continue
        for t in batch:
            if t not in df.columns.get_level_values(0):
                continue
            x = df[t].dropna(subset=["Open", "High", "Low", "Close"])
            x = x[(x[["Open", "High", "Low", "Close"]] > 0).all(axis=1)]
            if len(x) < MIN_BARS:
                continue
            d = {"dates": [i.strftime("%Y-%m-%d") for i in x.index],
                 **{k.lower(): [rnd(v) for v in x[k]] for k in ("Open", "High", "Low", "Close")}}
            (OUT / f"{t}.json").write_text(json.dumps(d, separators=(",", ":")))
            kept.append(by_t[t])
        print(f"{b + len(batch)}/{len(syms)} done, {len(kept)} kept", flush=True)
    (OUT / "_list.json").write_text(json.dumps(kept, separators=(",", ":")))
    # guard: a Yahoo outage must not replace the published data with an empty set
    if LIMIT is None and len(kept) < 1500:
        sys.exit(f"only {len(kept)} stocks downloaded, refusing to publish")


if __name__ == "__main__":
    main()
