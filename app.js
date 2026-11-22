const DATA = "https://raw.githubusercontent.com/kaloyantosev/sector-terminal/main/public/data/daily/";
// data branch, rebuilt every weekday by .github/workflows/refresh-stocks.yml: stock prices + fresh summary/screener files
const BASE = "https://raw.githubusercontent.com/kaloyantosev/ema-200-300-reclaim/data/";
const H = Object.keys(HORIZONS);
const $ = (id) => document.getElementById(id);
const pct = (v, d = 2) => v == null || isNaN(v) ? "–" : `<span class="${v > 0 ? "pos" : v < 0 ? "neg" : ""}">${v > 0 ? "+" : ""}${v.toFixed(d)}%</span>`;
let S, chart, current, tab = "chart", EV = [], byWeek = new Map(), calYear, calWeek;
let ALL = [], tf = "D", chartTf = "D", sortK = "ago", sortDir = 1, agoUnit = "D", heatP = "1D";
const MAX_ROWS = 500;  // shortcut: renders the first 500 matches only, add paging if people need to scroll past that
const rawCache = {};
const TF_NAME = { D: "daily", W: "weekly", M: "monthly" }, TF_UNIT = { D: "d", W: "w", M: "mo" };
const daysAgo = (x) => x.last ? Math.round((Date.parse(x.asOf) - Date.parse(x.last.date)) / 864e5) : null;  // calendar days to the data's last session
function cutoff(asOf, n, unit) {  // earliest signal date that counts as "within n days / weeks / months"
  const t = new Date(asOf + "T00:00:00Z");
  if (unit === "M") {  // same day n months back, clamped to the month's length (31 Mar - 1 month = 28/29 Feb)
    const day = t.getUTCDate(); t.setUTCDate(1); t.setUTCMonth(t.getUTCMonth() - n);
    t.setUTCDate(Math.min(day, new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate()));
  } else t.setUTCDate(t.getUTCDate() - n * (unit === "W" ? 7 : 1));
  return t.toISOString().slice(0, 10);
}

// ---- filter console: every index's current state on the chosen timeframe (screener.json from build.mjs)
function screenRows() {
  const pos = document.querySelector("input[name=pos]:checked").value;
  const sig = $("fSig").value, agoTxt = $("fAgo").value, ago = agoTxt === "" ? null : +agoTxt;
  const arm = $("fArm").value, cat = $("fCat").value, q = $("fq").value.trim().toLowerCase(), noFlat = $("fFlat").checked;
  const kind = document.querySelector("input[name=kind]:checked").value;
  return ALL.map((s) => ({ s, x: s.x[tf] })).filter(({ s, x }) => x && (!kind || s.type === kind) && (!pos || x.pos === pos)
    && (!sig || (x.last && x.last.dir === sig)) && (ago === null || (x.last && x.last.date >= cutoff(x.asOf, ago, agoUnit)))
    && (!arm || (arm === "L" ? x.aL : x.aS)) && (!noFlat || !x.flat) && (!cat || s.category === cat)
    && (!q || `${s.tv} ${s.name}`.toLowerCase().includes(q)));
}
const SORT = { sym: (r) => r.s.tv || r.s.file, name: (r) => r.s.name, ytd: (r) => r.s.x.chg?.YTD ?? null,
  sig: (r) => r.x.last?.dir ?? null, ago: (r) => daysAgo(r.x), arm: (r) => (r.x.aL ? "long" : "") + (r.x.aS ? "short" : "") || null };
function renderScreener() {
  const rows = screenRows(), f = SORT[sortK];
  rows.sort((a, b) => { const p = f(a), q = f(b); return p === q ? 0 : p === null ? 1 : q === null ? -1 : (p < q ? -1 : 1) * sortDir; });  // blanks last
  const missing = ALL.filter((s) => !s.x[tf]).length;
  $("fCount").textContent = `${rows.length.toLocaleString()} of ${ALL.length.toLocaleString()} symbols on ${TF_NAME[tf]} candles` +
    (rows.length > MAX_ROWS ? ` · showing the first ${MAX_ROWS}, narrow the filters to see the rest` : "") +
    (missing ? ` · ${missing.toLocaleString()} not shown: too little history for an EMA 300 on ${TF_NAME[tf]} candles` : "");
  const th = (k, t) => `<th data-k="${k}" tabindex="0" aria-sort="${sortK === k ? (sortDir > 0 ? "ascending" : "descending") : "none"}">${t}${sortK === k ? (sortDir > 0 ? " ▲" : " ▼") : ""}</th>`;
  $("scrTbl").innerHTML = `<tr><th aria-label="Watchlist"></th>${th("sym", "Symbol")}${th("name", "Name")}<th>Type</th>${th("ytd", "YTD return")}` +
    `${th("sig", "Last signal")}<th>Signal date</th>${th("ago", "Days ago")}${th("arm", "Armed")}<th>Flat</th></tr>` +
    (rows.length ? rows.slice(0, MAX_ROWS).map(({ s, x }) => `<tr data-f="${s.i}" title="Open ${TF_NAME[tf]} chart">${starBtn(s)}<td><b>${s.tv || s.file}</b></td><td>${s.name}</td><td class="muted">${s.type === "etf" ? "ETF" : "Stock"}</td><td>${pct(s.x.chg?.YTD, 1)}</td>` +
      `<td class="${x.last?.dir === "long" ? "pos" : "neg"}">${x.last ? x.last.dir : "–"}</td><td>${x.last ? x.last.date : "–"}</td><td>${x.last ? daysAgo(x) : "–"}</td>` +
      `<td>${[x.aL ? "long" : "", x.aS ? "short" : ""].filter(Boolean).join(", ") || "–"}</td><td>${x.flat ? "yes" : ""}</td></tr>`).join("")
      : `<tr><td class="muted" colspan="10">Nothing matches these filters.</td></tr>`);
}
function setChartTf(t) {
  chartTf = t;
  document.querySelectorAll("#chartTf button").forEach((b) => b.classList.toggle("on", b.dataset.ctf === t));
}

function horizonTable(rows) { // rows: [label, statsByHorizon]
  const head = `<tr><th></th>${H.map((h) => `<th colspan="1">${h}</th>`).join("")}</tr>`;
  const line = (label, f, h) => `<tr><td>${label}</td>${H.map((k) => `<td>${f(h[k])}</td>`).join("")}</tr>`;
  return rows.map(([label, h]) => head.replace("<th></th>", `<th>${label}</th>`) +
    line("Avg return", (s) => pct(s.avg), h) + line("Median", (s) => pct(s.median), h) +
    line("% positive", (s) => s.win == null ? "–" : s.win.toFixed(1) + "%", h) +
    line("% stopped by then", (s) => s.stopped == null ? "–" : s.stopped.toFixed(1) + "%", h) +
    line("Trades", (s) => s.n, h)).join("");
}

// ---- watchlist: starred symbols, kept in this browser only
const WKEY = "ema-watchlist";
let watch = new Set();
try { watch = new Set(JSON.parse(localStorage.getItem(WKEY) || "[]")); } catch { /* storage blocked: watchlist lasts this visit */ }
const starBtn = (s) => `<td><button class="star${watch.has(s.key) ? " on" : ""}" data-star="${s.key}" aria-pressed="${watch.has(s.key)}" aria-label="${watch.has(s.key) ? "Remove" : "Add"} ${s.tv || s.file} ${watch.has(s.key) ? "from" : "to"} watchlist">${watch.has(s.key) ? "★" : "☆"}</button></td>`;
function toggleWatch(key) {
  watch.has(key) ? watch.delete(key) : watch.add(key);
  try { localStorage.setItem(WKEY, JSON.stringify([...watch])); } catch { /* not saved */ }
  renderWatch(); renderScreener();
}
function renderWatch() {
  const list = ALL.filter((s) => watch.has(s.key));
  $("wlist").innerHTML = list.length ? list.map((s) => `<div class="wl"><span><b>${s.tv || s.file}</b> ${pct(s.x.chg?.["1D"], 1)}<br><small>${s.name}</small></span>` +
    `<button class="star on" data-star="${s.key}" aria-label="Remove ${s.tv || s.file} from watchlist">★</button></div>`).join("")
    : `<div class="wl muted">Star a symbol in the filter console to add it here.</div>`;
}

// ---- heatmap: every ETF / index's price change on the slider's day, dark near 0, bright at the period's cap
// heat.json (build.mjs): S&P 500 session dates + each symbol's close on them, so any day's 1D...1Y change is available
let HEAT = null, heatI = 0, heatTimer = null;
const HEAT_BACK = { "1D": 1, "1W": 5, "1M": 21, "3M": 63, "6M": 126, "1Y": 252 };
function heatVal(s) {
  const c = HEAT?.c[s.key];
  if (!c) return !HEAT || heatI === HEAT.dates.length - 1 ? s.x.chg?.[heatP] ?? null : null;
  const y = HEAT.dates[heatI].slice(0, 4);
  const j = heatP === "YTD" ? HEAT.dates.findLastIndex((t) => t.slice(0, 4) < y) : heatI - HEAT_BACK[heatP];
  return j >= 0 && c[heatI] != null && c[j] != null ? (c[heatI] / c[j] - 1) * 100 : null;
}
function setHeatDay(i) {
  heatI = Math.max(+$("heatSlider").min, Math.min(HEAT.dates.length - 1, i));
  $("heatSlider").value = heatI;
  const d = new Date(HEAT.dates[heatI] + "T00:00:00Z");
  $("heatDate").textContent = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) +
    (heatI === HEAT.dates.length - 1 ? " (latest)" : "");
  renderHeat();
}
function playHeat() {
  if (heatTimer) { clearInterval(heatTimer); heatTimer = null; $("heatPlay").textContent = "▶ Play"; return; }
  if (heatI >= HEAT.dates.length - 1) setHeatDay(+$("heatSlider").min);
  $("heatPlay").textContent = "❚❚ Pause";
  heatTimer = setInterval(() => { if (heatI >= HEAT.dates.length - 1) return playHeat(); setHeatDay(heatI + 1); }, 300);
}
const HEAT_CAP = { "1D": 3, "1W": 6, "1M": 10, "3M": 20, "6M": 30, "YTD": 40, "1Y": 50 };
const HEAT_STOPS = [[255, 43, 43], [139, 46, 53], [58, 61, 71], [36, 112, 63], [24, 224, 90]];  // bright red, dark red, grey, dark green, bright green
function heatColor(v) {
  if (v == null) return "rgb(58,61,71)";
  const t = (Math.max(-1, Math.min(1, v / HEAT_CAP[heatP])) + 1) * 2, k = Math.min(3, Math.floor(t)), f = t - k;
  return `rgb(${HEAT_STOPS[k].map((c, j) => Math.round(c + (HEAT_STOPS[k + 1][j] - c) * f)).join(",")})`;
}
function renderHeat() {
  const byCat = {};
  for (const s of ALL) if (s.type === "etf") (byCat[s.category] ??= []).push(s);
  const v = heatVal;
  $("hLo").textContent = `−${HEAT_CAP[heatP]}%`; $("hHi").textContent = `+${HEAT_CAP[heatP]}%`;
  $("heat").innerHTML = Object.keys(byCat).sort().map((c) => `<div><div class="hcat">${c}</div><div class="hgrid">` +
    byCat[c].sort((a, b) => (v(b) ?? -1e9) - (v(a) ?? -1e9)).map((s) => `<button class="tile" data-f="${s.i}" style="background:${heatColor(v(s))}" title="${s.name}: open chart">` +
      `<b>${(s.tv || s.file).split(":").pop()}</b>${v(s) == null ? "–" : (v(s) > 0 ? "+" : "") + v(s).toFixed(2) + "%"}</button>`).join("") + `</div></div>`).join("");
}

function ensureChart() {
  if (chart) return chart;
  const css = getComputedStyle(document.documentElement), v = (n) => css.getPropertyValue(n).trim();
  chart = LightweightCharts.createChart($("chart"), { autoSize: true, layout: { background: { color: v("--bg") }, textColor: v("--muted") },
    grid: { vertLines: { color: v("--line") }, horzLines: { color: v("--line") } }, rightPriceScale: { mode: 1 }, timeScale: { borderColor: v("--line") } });
  chart.price = chart.addCandlestickSeries({ upColor: v("--pos"), downColor: v("--neg"), wickUpColor: v("--pos"), wickDownColor: v("--neg"), borderVisible: false });
  chart.e200 = chart.addLineSeries({ color: v("--e200"), lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
  chart.e300 = chart.addLineSeries({ color: v("--e300"), lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
  chart.colors = { pos: v("--pos"), neg: v("--neg"), muted: v("--muted") };
  return chart;
}

function showTV(s) {
  $("tv").innerHTML = "";
  if (tab !== "tv" || !s.tv || typeof TradingView === "undefined") return;
  new TradingView.widget({ container_id: "tv", autosize: true, symbol: s.tv, interval: "D", style: "8", theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    studies: [{ id: "MAExp@tv-basicstudies", inputs: { length: 200 } }, { id: "MAExp@tv-basicstudies", inputs: { length: 300 } }] });
}

async function select(s) {
  current = s;
  $("symTitle").textContent = `${s.tv || s.file} · ${s.name}`;
  $("tvlink").href = s.tv ? `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(s.tv)}` : "#";
  $("symTbl").innerHTML = "";
  $("trades").innerHTML = "<tr><td>Loading prices…</td></tr>";
  showTV(s);
  try { rawCache[s.key] ??= await (await fetch(s.url)).json(); } catch (e) { $("trades").innerHTML = `<tr><td>Could not load ${s.file}: ${e.message}</td></tr>`; return; }
  if (current !== s) return;
  drawSymbol(s);
}

function drawSymbol(s) {
  // stock files carry full-history W / M candles
  const raw = rawCache[s.key], d = chartTf === "D" ? raw : raw[chartTf] ?? resample(raw, chartTf), daily = chartTf === "D", unit = TF_UNIT[chartTf];
  const r = runStrategy(d), c = ensureChart();
  const symStats = (ev) => { const h = {};
  for (const [k, n] of Object.entries(HORIZONS)) {
    const v = ev.filter((e) => e[k] != null), x = v.map((e) => e[k] * 100).sort((a, b) => a - b);
    h[k] = { n: v.length, avg: x.length ? x.reduce((a, b) => a + b, 0) / x.length : null, median: x.length ? (x[(x.length - 1) >> 1] + x[x.length >> 1]) / 2 : null,
      win: x.length ? x.filter((y) => y > 0).length / x.length * 100 : null, stopped: v.length ? v.filter((e) => e.stopDay !== null && e.stopDay <= n).length / v.length * 100 : null };
  }
  return [`${ev[0]?.dir === "short" ? "Shorts" : "Longs"}: ${ev.length} signals, ${(ev.filter((e) => e.stopDay !== null).length / (ev.length || 1) * 100).toFixed(1)}% ever stopped`, h]; };
  const L = r.events.filter((e) => e.dir === "long"), Sh = r.events.filter((e) => e.dir === "short");
  // return columns are in trading days, so only meaningful on daily candles
  $("symTbl").innerHTML = daily ? horizonTable([symStats(L), symStats(Sh)]).replace("Longs: undefined", "Longs").replace("Shorts: undefined", "Shorts")
    : `<tr><td class="muted">${TF_NAME[chartTf][0].toUpperCase() + TF_NAME[chartTf].slice(1)} candles: ${L.length} long and ${Sh.length} short signals. Return columns are shown on daily candles only.</td></tr>`;
  const pts = (arr) => d.dates.map((t, i) => ({ time: t, value: arr[i] }));
  c.price.setData(d.dates.map((t, i) => ({ time: t, open: r.ho[i], close: r.hc[i], // Heikin Ashi candles: what the decisions use
    high: Math.max(d.high[i], r.ho[i], r.hc[i]), low: Math.min(d.low[i], r.ho[i], r.hc[i]) })));
  c.e200.setData(pts(r.e200).slice(200));
  c.e300.setData(pts(r.e300).slice(300));
  const marks = [];
  for (const e of r.events) {
    const lg = e.dir === "long";
    marks.push({ time: e.date, position: lg ? "belowBar" : "aboveBar", color: lg ? c.colors.pos : c.colors.neg, shape: lg ? "arrowUp" : "arrowDown" });
    if (e.stopDay !== null && e.i + e.stopDay < d.dates.length) marks.push({ time: d.dates[e.i + e.stopDay], position: lg ? "belowBar" : "aboveBar", color: c.colors.muted, shape: "circle" });
  }
  const seen = new Set();
  c.price.setMarkers(marks.sort((a, b) => a.time < b.time ? -1 : a.time > b.time ? 1 : 0).filter((m) => { const k = m.time + m.shape + m.position; return !seen.has(k) && seen.add(k); }));
  c.timeScale().fitContent();
  const HC = daily ? H : [];
  $("trades").innerHTML = `<tr><th>Entry date</th><th>Side</th><th>Entry</th><th>Stop</th><th>Risk</th><th>EMA gap</th><th>Stopped after</th>${HC.map((h) => `<th>${h}</th>`).join("")}</tr>` +
    r.events.slice().reverse().map((e) => `<tr><td>${e.date}</td><td class="${e.dir === "long" ? "pos" : "neg"}">${e.dir}</td><td>${e.entry.toFixed(2)}</td><td>${e.stop.toFixed(2)}</td><td>${(e.risk * 100).toFixed(1)}%</td><td>${(e.gap * 100).toFixed(2)}%</td>` +
      `<td>${e.stopDay === null ? "open" : e.stopDay + " " + unit}</td>${HC.map((h) => `<td>${e[h] == null ? "–" : pct(e[h] * 100, 1)}</td>`).join("")}</tr>`).join("");
}

// ---- signal calendar: one button per ISO week, click shows every signal that week
const DAY = 864e5;
function isoWeek(ds) { // "YYYY-MM-DD" -> [ISO year, ISO week]
  const d = new Date(ds + "T00:00:00Z"), thu = new Date(d.getTime() + (3 - (d.getUTCDay() + 6) % 7) * DAY);
  const y = thu.getUTCFullYear();
  return [y, Math.floor((thu - Date.UTC(y, 0, 1)) / DAY / 7) + 1];
}
function weekMonday(y, w) {
  const jan4 = Date.UTC(y, 0, 4);
  return new Date(jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY + (w - 1) * 7 * DAY);
}
const md = (d) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

function renderCal() {
  const years = [...new Set(EV.map((e) => isoWeek(e[0])[0]))].sort((a, b) => b - a);
  $("calYear").innerHTML = years.map((y) => `<option${y === calYear ? " selected" : ""}>${y}</option>`).join("");
  const nW = isoWeek(`${calYear}-12-28`)[1];
  let html = "", nL = 0, nS = 0;
  for (let w = 1; w <= nW; w++) {
    const list = byWeek.get(`${calYear}-${w}`) || [], L = list.filter((e) => e[2] === 1).length, Sh = list.length - L;
    nL += L; nS += Sh;
    html += `<button class="wk${w === calWeek ? " on" : ""}${list.length ? "" : " empty"}" data-w="${w}" aria-label="Week ${w}: ${L} long, ${Sh} short">` +
      `<b>W${w}</b><span>${md(weekMonday(calYear, w))}</span><span><i class="pos">${L ? "▲" + L : ""}</i> <i class="neg">${Sh ? "▼" + Sh : ""}</i>${list.length ? "" : "–"}</span></button>`;
  }
  $("calGrid").innerHTML = html;
  $("calInfo").textContent = `${calYear}: ${nL} long, ${nS} short signals`;
  renderWeek();
}

function renderWeek() {
  const list = byWeek.get(`${calYear}-${calWeek}`) || [], mon = weekMonday(calYear, calWeek);
  $("weekTitle").textContent = `Week ${calWeek}, ${calYear} (${md(mon)} – ${md(new Date(mon.getTime() + 4 * DAY))}): ${list.length} signal${list.length === 1 ? "" : "s"}`;
  $("weekTbl").innerHTML = list.length ? `<tr><th>Date</th><th>Symbol</th><th>Name</th><th>Category</th><th>Side</th>${H.map((h) => `<th>${h}</th>`).join("")}<th>Stopped after</th></tr>` +
    list.map((e) => { const s = ALL[e[1]];
      return `<tr data-f="${s.i}" title="Open chart"><td>${e[0]}</td><td>${s.tv || s.file}</td><td>${s.name}</td><td>${s.category}</td>` +
        `<td class="${e[2] === 1 ? "pos" : "neg"}">${e[2] === 1 ? "long" : "short"}</td>${H.map((h, k) => `<td>${e[3 + k] == null ? "–" : pct(e[3 + k], 1)}</td>`).join("")}` +
        `<td>${e[3 + H.length] == null ? "not stopped" : e[3 + H.length] + " d"}</td></tr>`; }).join("")
    : `<tr><td class="muted">No signals this week.</td></tr>`;
}

(async () => {
  const load = (base) => Promise.all(["summary.json", "events.json", "screener.json"].map((f) => fetch(base + f).then((r) => { if (!r.ok) throw r.status; return r.json(); })));
  let SCR;
  let base = BASE;
  try { [S, EV, SCR] = await load(BASE); } catch { base = ""; [S, EV, SCR] = await load(""); }  // data branch not built yet: files deployed with the site
  const getHeat = (b) => fetch(b + "heat.json").then((r) => r.ok ? r.json() : null).catch(() => null);
  HEAT = await getHeat(base) ?? (base ? await getHeat("") : null);  // data branch older than heat.json: use the deployed copy
  const STK = await fetch(BASE + "stocks.json").then((r) => r.ok ? r.json() : []).catch(() => []);
  // ETFs first, so ALL[i] matches the symbol index i in events.json
  ALL = [...S.symbols.map((s, i) => ({ ...s, type: "etf", x: SCR[i], url: DATA + s.file })),
    ...STK.map((s) => ({ type: "stock", category: "US Stock", ...s, url: BASE + "stocks/" + s.file }))];
  ALL.forEach((s, i) => { s.i = i; s.key = s.type + ":" + s.file; });
  $("fCat").innerHTML += [...new Set(ALL.map((s) => s.category))].sort().map((c) => `<option>${c}</option>`).join("");
  if (HEAT) {
    $("heatSlider").min = Math.min(HEAT_BACK["1Y"], HEAT.dates.length - 1); $("heatSlider").max = HEAT.dates.length - 1;
    $("heatSlider").addEventListener("input", (e) => setHeatDay(+e.target.value));
    $("heatPrev").addEventListener("click", () => setHeatDay(heatI - 1));
    $("heatNext").addEventListener("click", () => setHeatDay(heatI + 1));
    $("heatPlay").addEventListener("click", playHeat);
    setHeatDay(HEAT.dates.length - 1);
  } else { $("heatDay").style.display = "none"; renderHeat(); }  // .calbar's display:flex beats the hidden attribute
  renderWatch();
  $("heatTabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-p]"); if (!b) return; heatP = b.dataset.p;
    document.querySelectorAll("#heatTabs button").forEach((x) => x.classList.toggle("on", x === b)); renderHeat(); });
  const openRow = (e) => { const el = e.target.closest("[data-f]"); if (!el) return; select(ALL[+el.dataset.f]); $("symTitle").scrollIntoView({ behavior: "smooth" }); };
  $("heat").addEventListener("click", openRow);
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-star]"); if (b) { e.stopPropagation(); toggleWatch(b.dataset.star); } }, true);
  renderScreener();
  document.querySelector(".console").addEventListener("input", renderScreener);
  $("agoUnit").addEventListener("click", (e) => { const b = e.target.closest("button[data-u]"); if (!b) return; agoUnit = b.dataset.u;
    document.querySelectorAll("#agoUnit button").forEach((x) => x.classList.toggle("on", x === b)); renderScreener(); });
  $("tfTabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-tf]"); if (!b) return; tf = b.dataset.tf;
    document.querySelectorAll("#tfTabs button").forEach((x) => x.classList.toggle("on", x === b)); renderScreener(); });
  const sortBy = (e) => { const t = e.target.closest("th[data-k]"); if (!t) return;
    sortDir = sortK === t.dataset.k ? -sortDir : 1; sortK = t.dataset.k; renderScreener(); };
  $("scrTbl").addEventListener("click", (e) => { if (e.target.closest("th[data-k]")) return sortBy(e);
    if (!e.target.closest("tr[data-f]")) return; setChartTf(tf); openRow(e); });
  $("scrTbl").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); sortBy(e); } });
  $("chartTf").addEventListener("click", (e) => { const b = e.target.closest("button[data-ctf]"); if (!b || !current) return;
    setChartTf(b.dataset.ctf); if (rawCache[current.key]) drawSymbol(current); });
  for (const e of EV) { const k = isoWeek(e[0]).join("-"); if (!byWeek.has(k)) byWeek.set(k, []); byWeek.get(k).push(e); }
  [calYear, calWeek] = isoWeek(EV.at(-1)[0]);
  renderCal();
  $("calYear").addEventListener("change", (e) => { calYear = +e.target.value; calWeek = 1; renderCal(); });
  const stepYear = (d) => { const ys = [...$("calYear").options].map((o) => +o.value); const i = ys.indexOf(calYear) - d;
    if (i >= 0 && i < ys.length) { calYear = ys[i]; calWeek = 1; renderCal(); } };
  $("calPrev").addEventListener("click", () => stepYear(-1));
  $("calNext").addEventListener("click", () => stepYear(1));
  $("calGrid").addEventListener("click", (e) => { const b = e.target.closest(".wk"); if (!b) return; calWeek = +b.dataset.w;
    document.querySelectorAll(".wk").forEach((x) => x.classList.toggle("on", x === b)); renderWeek(); });
  $("weekTbl").addEventListener("click", openRow);
  $("sub").textContent = `${S.symbols.length + STK.filter((s) => s.type === "etf").length} ETFs / indexes + ${STK.filter((s) => s.type !== "etf").length.toLocaleString()} US stocks · index signals: ${S.long.total_signals.toLocaleString()} long + ${S.short.total_signals.toLocaleString()} short signals · ${S.first} to ${S.last} · data as of ${S.asOf}`;
  document.querySelectorAll(".tabs button[data-t]").forEach((b) => b.addEventListener("click", () => {
    tab = b.dataset.t;
    document.querySelectorAll(".tabs button[data-t]").forEach((x) => x.classList.toggle("on", x === b));
    $("chart").hidden = tab !== "chart"; $("tv").hidden = tab !== "tv";
    if (tab === "tv") {
      if (typeof TradingView === "undefined") { const sc = document.createElement("script"); sc.src = "https://s3.tradingview.com/tv.js"; sc.onload = () => showTV(current); document.head.appendChild(sc); }
      else showTV(current);
    }
  }));
  select(ALL.find((s) => s.file === "_GSPC.json") || ALL[0]);
})();
