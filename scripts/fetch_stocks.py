"""Download full price history for every US-listed common stock plus EXTRA_ETFS (Yahoo Finance via yfinance).

Ticker list: nasdaqtrader.com symbol directory (all US exchanges). Kept: common / ordinary shares,
not ETFs, test issues, warrants, units, rights, preferreds, notes or ADRs.
Writes <out>/<TICKER>.json and <out>/_list.json. Each file: the last DAILY_BARS daily candles
({dates, open, high, low, close}) plus full-history weekly and monthly candles under "W" and "M"
(each dated by its last session, like resample() in strategy.js), so EMA 300s work on all three.
Usage: python scripts/fetch_stocks.py out/stocks [max_tickers]
"""
import json, pathlib, re, sys, time, urllib.request

import pandas as pd
import yfinance as yf

OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "out/stocks")
LIMIT = int(sys.argv[2]) if len(sys.argv) > 2 else None
MIN_BARS = 320  # EMA 300 warmup + a few candles to test the rule on
SYMDIR = "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqtraded.txt"
KEEP = re.compile(r"common stock|common shares|ordinary shares", re.I)
DROP = re.compile(r"warrant|\bunits?\b|\brights?\b|preferred|depositary|\bnotes?\b|debenture", re.I)
DAILY_BARS = 760  # ~3 years: enough for the daily EMA 300 and a 1-year heatmap lookback
# ETFs sector-terminal does not track: tech niches, plus the size / factor / country funds money rotates into outside tech
EXTRA_ETFS = {
    "Tech: Broad & Mega Cap": {"QQQ": "Invesco QQQ (Nasdaq 100)", "QTEC": "First Trust Nasdaq-100 Technology", "XNTK": "SPDR NYSE Technology",
        "MAGS": "Roundhill Magnificent Seven", "PTF": "Invesco Dragonfly Technology Momentum", "TDIV": "First Trust Nasdaq Technology Dividend", "XT": "iShares Exponential Technologies"},
    "Tech: Semiconductors": {"PSI": "Invesco Semiconductors", "FTXL": "First Trust Nasdaq Semiconductor", "SOXQ": "Invesco PHLX Semiconductor"},
    "Tech: Software & Cloud": {"CLOU": "Global X Cloud Computing", "IGPT": "Invesco AI and Next Gen Software", "DTCR": "Global X Data Center & Digital Infrastructure", "SNSR": "Global X Internet of Things"},
    "Tech: Cybersecurity": {"BUG": "Global X Cybersecurity", "IHAK": "iShares Cybersecurity and Tech", "WCBR": "WisdomTree Cybersecurity"},
    "Tech: AI & Robotics": {"ARTY": "iShares Future AI & Tech", "CHAT": "Roundhill Generative AI & Technology", "THNQ": "ROBO Global Artificial Intelligence",
        "ROBT": "First Trust Nasdaq AI and Robotics", "ARKQ": "ARK Autonomous Technology & Robotics", "QTUM": "Defiance Quantum Computing"},
    "Tech: Internet & Digital": {"PNQI": "Invesco Nasdaq Internet", "ARKW": "ARK Next Generation Internet", "SOCL": "Global X Social Media", "IBUY": "Amplify Online Retail",
        "HERO": "Global X Video Games & Esports", "METV": "Roundhill Ball Metaverse", "CQQQ": "Invesco China Technology", "EMQQ": "EMQQ Emerging Markets Internet"},
    "Tech: Disruptive, Crypto & Nuclear": {"ARKF": "ARK Fintech Innovation", "ARKG": "ARK Genomic Revolution", "ARKX": "ARK Space Exploration",
        "BITQ": "Bitwise Crypto Industry Innovators", "IBIT": "iShares Bitcoin Trust", "NLR": "VanEck Uranium and Nuclear"},
    "Rotation: Size & Factor": {"RSP": "Invesco S&P 500 Equal Weight", "MDY": "SPDR S&P MidCap 400", "IWM": "iShares Russell 2000", "IJR": "iShares Core S&P Small-Cap",
        "IWN": "iShares Russell 2000 Value", "VTV": "Vanguard Value", "VUG": "Vanguard Growth", "MTUM": "iShares MSCI USA Momentum Factor",
        "QUAL": "iShares MSCI USA Quality Factor", "USMV": "iShares MSCI USA Min Vol Factor", "SPHB": "Invesco S&P 500 High Beta",
        "SPLV": "Invesco S&P 500 Low Volatility", "SCHD": "Schwab US Dividend Equity", "NOBL": "ProShares S&P 500 Dividend Aristocrats"},
    "Rotation: International": {"EFA": "iShares MSCI EAFE", "EEM": "iShares MSCI Emerging Markets", "EWJ": "iShares MSCI Japan",
        "INDA": "iShares MSCI India", "FXI": "iShares China Large-Cap", "EWZ": "iShares MSCI Brazil"},
}
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


def extra_etfs():
    return [{"t": t, "n": n, "tv": t, "type": "etf", "cat": cat} for cat, funds in EXTRA_ETFS.items() for t, n in funds.items()]


def candles(x):
    return {"dates": [i.strftime("%Y-%m-%d") for i in x.index],
            **{k.lower(): [rnd(v) for v in x[k]] for k in ("Open", "High", "Low", "Close")}}


def bars(x, key):  # weekly (Monday-Friday) or monthly candles, dated by their last session
    g = x.assign(_d=x.index).groupby(key, sort=True)
    y = g.agg(Open=("Open", "first"), High=("High", "max"), Low=("Low", "min"), Close=("Close", "last"), _d=("_d", "last"))
    return candles(y.set_index("_d"))


def rnd(v):
    return round(float(v), 4 if v < 10 else 2)


def main():
    syms = (extra_etfs() + tickers())[:LIMIT]
    print(f"{len(syms)} candidate tickers")
    OUT.mkdir(parents=True, exist_ok=True)
    by_t, kept = {}, []
    for s in syms:
        by_t.setdefault(s["t"], s)  # an EXTRA_ETFS entry wins over the same ticker in the directory
    syms = list(by_t.values())
    for b in range(0, len(syms), 200):
        batch = [s["t"] for s in syms[b:b + 200]]
        for attempt in range(3):
            try:
                df = yf.download(batch, period="max", interval="1d", auto_adjust=True, group_by="ticker",
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
            idx = x.index
            d = {**candles(x.iloc[-DAILY_BARS:]),
                 "W": bars(x, (idx - pd.to_timedelta(idx.dayofweek, unit="D")).strftime("%Y-%m-%d")),
                 "M": bars(x, idx.strftime("%Y-%m"))}
            (OUT / f"{t}.json").write_text(json.dumps(d, separators=(",", ":")))
            kept.append(by_t[t])
        print(f"{b + len(batch)}/{len(syms)} done, {len(kept)} kept", flush=True)
    (OUT / "_list.json").write_text(json.dumps(kept, separators=(",", ":")))
    # guard: a Yahoo outage must not replace the published data with an empty set
    if LIMIT is None and len(kept) < 1500:
        sys.exit(f"only {len(kept)} stocks downloaded, refusing to publish")


if __name__ == "__main__":
    main()
