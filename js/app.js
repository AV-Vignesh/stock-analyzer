/* Ledger — app logic. */
(() => {
"use strict";

// ---------- state ----------
let cfg = {};                 // settings
let universe = [];            // bundled stocks
let cachedSymbols = new Set();// symbols with stored analyses
let compareSel = [];          // symbols selected for compare
let activeSector = null;
let currentStock = null;      // {s,n,sec} open in sheet
const $ = id => document.getElementById(id);
const INR0 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const INR2 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = v => (v === null || v === undefined || v === "" || Number.isNaN(v)) ? "—" : (typeof v === "number" ? new Intl.NumberFormat("en-IN").format(v) : esc(v));

function toast(msg, ms = 2600) {
  const t = $("toast");
  t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.add("hidden"), ms);
}

// ---------- settings ----------
const DEFAULT_CFG = {
  provider: "anthropic",
  anthropicKey: "", anthropicModel: "claude-sonnet-4-6",
  azureEndpoint: "", azureDeployment: "", azureApiVersion: "2024-08-01-preview", azureKey: "",
  theme: "vault", accent: "#f5a524", fontScale: "1"
};
const ACCENTS = ["#f5a524", "#00b8d9", "#3fbf6f", "#e5484d", "#a78bfa", "#ff7ab8"];

async function loadCfg() {
  cfg = Object.assign({}, DEFAULT_CFG, (await DB.get("settings", "cfg")) || {});
  applyAppearance();
  syncSettingsForm();
  updateProviderBadge();
}
function saveCfg() { return DB.set("settings", "cfg", cfg); }

function applyAppearance() {
  document.documentElement.dataset.theme = cfg.theme;
  document.documentElement.style.setProperty("--accent", cfg.accent);
  document.documentElement.style.setProperty("--font-scale", cfg.fontScale);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.body).backgroundColor;
}
function updateProviderBadge() {
  const b = $("providerBadge");
  const ready = cfg.provider === "azure"
    ? !!(cfg.azureEndpoint && cfg.azureDeployment && cfg.azureKey)
    : !!cfg.anthropicKey;
  b.textContent = cfg.provider === "azure" ? "Azure" : "Anthropic";
  b.classList.toggle("ok", ready);
  b.title = ready ? "Provider configured" : "Provider not configured — open Settings";
}

function syncSettingsForm() {
  $("setProvider").value = cfg.provider;
  $("setAnthropicKey").value = cfg.anthropicKey;
  $("setAnthropicModel").value = cfg.anthropicModel;
  $("setAzureEndpoint").value = cfg.azureEndpoint;
  $("setAzureDeployment").value = cfg.azureDeployment;
  $("setAzureApiVersion").value = cfg.azureApiVersion;
  $("setAzureKey").value = cfg.azureKey;
  $("setTheme").value = cfg.theme;
  $("setFontScale").value = cfg.fontScale;
  renderSwatches();
}
function renderSwatches() {
  $("accentSwatches").innerHTML = ACCENTS.map(c =>
    `<button class="swatch ${c === cfg.accent ? "active" : ""}" style="background:${c}" data-accent="${c}" aria-label="Accent ${c}"></button>`).join("");
}

function bindSettings() {
  const bind = (id, key, fn) => $(id).addEventListener("change", e => { cfg[key] = e.target.value.trim(); saveCfg(); if (fn) fn(); });
  bind("setProvider", "provider", updateProviderBadge);
  bind("setAnthropicKey", "anthropicKey", updateProviderBadge);
  bind("setAnthropicModel", "anthropicModel");
  bind("setAzureEndpoint", "azureEndpoint", updateProviderBadge);
  bind("setAzureDeployment", "azureDeployment", updateProviderBadge);
  bind("setAzureApiVersion", "azureApiVersion");
  bind("setAzureKey", "azureKey", updateProviderBadge);
  bind("setTheme", "theme", applyAppearance);
  bind("setFontScale", "fontScale", applyAppearance);

  $("accentSwatches").addEventListener("click", e => {
    const c = e.target.dataset.accent;
    if (!c) return;
    cfg.accent = c; saveCfg(); applyAppearance(); renderSwatches();
  });

  $("testAnthropic").addEventListener("click", () => runTest("testAnthropicResult", () => AI.testAnthropic(cfg)));
  $("testAzure").addEventListener("click", () => runTest("testAzureResult", () => AI.testAzure(cfg)));

  $("exportBtn").addEventListener("click", async () => {
    const dump = await DB.exportAll();
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ledger-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(a.href);
    toast("Backup exported");
  });
  $("importFile").addEventListener("change", async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      await DB.importAll(JSON.parse(await f.text()));
      toast("Backup imported — reloading");
      setTimeout(() => location.reload(), 900);
    } catch (err) { toast("Import failed: " + err.message, 4000); }
    e.target.value = "";
  });
  $("wipeBtn").addEventListener("click", async () => {
    if (!confirm("Wipe ALL local data (keys, portfolio, analyses)? This cannot be undone.")) return;
    await DB.wipe(); location.reload();
  });
}
async function runTest(resultId, fn) {
  const el = $(resultId);
  el.textContent = "testing…"; el.className = "test-result";
  try { await fn(); el.textContent = "connected ✓"; el.className = "test-result ok"; }
  catch (err) { el.textContent = err.message; el.className = "test-result fail"; }
}

// ---------- tabs ----------
document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t === tab));
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + tab.dataset.view));
  if (tab.dataset.view === "watch") renderWatchlist();
  if (tab.dataset.view === "portfolio") renderPortfolio();
}));

// ---------- stock list ----------
async function loadUniverse() {
  try {
    const res = await fetch("data/stocks.json");
    universe = (await res.json()).stocks;
  } catch { universe = []; toast("Could not load stock list", 4000); }
  const analyses = await DB.all("analyses");
  cachedSymbols = new Set(Object.keys(analyses));
  renderSectorChips();
  renderStockList();
}

function renderSectorChips() {
  const sectors = [...new Set(universe.map(s => s.sec.split(" / ")[0]))].sort();
  $("sectorChips").innerHTML = sectors.map(s =>
    `<button class="chip ${s === activeSector ? "active" : ""}" data-sec="${esc(s)}">${esc(s)}</button>`).join("");
}
$("sectorChips").addEventListener("click", e => {
  const s = e.target.dataset.sec; if (!s) return;
  activeSector = activeSector === s ? null : s;
  renderSectorChips(); renderStockList();
});

function renderStockList() {
  const q = $("stockSearch").value.trim().toLowerCase();
  let list = universe;
  if (activeSector) list = list.filter(s => s.sec.startsWith(activeSector));
  if (q) list = list.filter(s => s.s.toLowerCase().includes(q) || s.n.toLowerCase().includes(q));
  $("stockList").innerHTML = list.slice(0, 200).map(stockRowHTML).join("");
  const miss = q.length >= 2 && list.length === 0;
  $("searchMiss").classList.toggle("hidden", !miss);
  if (miss) $("typedName").textContent = $("stockSearch").value.trim();
}
function stockRowHTML(s) {
  return `<li class="stock-row" data-sym="${esc(s.s)}">
    <div><span class="sym">${esc(s.s)}${cachedSymbols.has(s.s) ? '<span class="cached-dot" title="Analysis cached"></span>' : ""}</span>
    <span class="nm">${esc(s.n)}</span></div>
    <span class="sec">${esc(s.sec)}</span></li>`;
}
$("stockSearch").addEventListener("input", renderStockList);
$("stockList").addEventListener("click", e => {
  const row = e.target.closest(".stock-row"); if (!row) return;
  const s = universe.find(x => x.s === row.dataset.sym);
  if (s) openSheet(s);
});
$("analyzeTyped").addEventListener("click", () => {
  const q = $("stockSearch").value.trim();
  openSheet({ s: q.toUpperCase().replace(/\s+/g, ""), n: q, sec: "Unlisted in bundle" }, { autoRun: true, freeQuery: q });
});

// ---------- watchlist ----------
async function renderWatchlist() {
  const wl = await DB.all("watchlist");
  const items = Object.values(wl).sort((a, b) => b.addedAt - a.addedAt);
  $("watchEmpty").classList.toggle("hidden", items.length > 0);
  $("watchList").innerHTML = items.map(stockRowHTML).join("");
}
$("watchList").addEventListener("click", async e => {
  const row = e.target.closest(".stock-row"); if (!row) return;
  const wl = await DB.all("watchlist");
  if (wl[row.dataset.sym]) openSheet(wl[row.dataset.sym]);
});

// ---------- stock detail sheet ----------
async function openSheet(stock, opts = {}) {
  currentStock = stock;
  $("sheetSymbol").textContent = stock.s;
  $("sheetName").textContent = stock.n;
  $("sheet").classList.remove("hidden");
  document.body.style.overflow = "hidden";
  await refreshWatchToggle();
  const history = (await DB.get("analyses", stock.s)) || [];
  if (opts.autoRun) runAnalysis(opts.freeQuery || `${stock.n} (${stock.s})`);
  else renderSheetHome(history);
}
function closeSheet() {
  $("sheet").classList.add("hidden");
  document.body.style.overflow = "";
  currentStock = null;
  renderStockList(); // refresh cached dots
}
$("sheetBack").addEventListener("click", closeSheet);

async function refreshWatchToggle() {
  const wl = await DB.all("watchlist");
  $("watchToggle").textContent = wl[currentStock.s] ? "Watching ✓" : "Watch";
}
$("watchToggle").addEventListener("click", async () => {
  const key = currentStock.s;
  const existing = await DB.get("watchlist", key);
  if (existing) { await DB.del("watchlist", key); toast("Removed from watchlist"); }
  else { await DB.set("watchlist", key, { ...currentStock, addedAt: Date.now() }); toast("Added to watchlist"); }
  refreshWatchToggle();
});

async function renderSheetHome(history) {
  const note = (await DB.get("notes", currentStock.s)) || "";
  const latest = history[0];
  let html = "";
  if (latest) {
    html += analysisHTML(latest);
    html += `<button class="btn btn-accent btn-block" id="rerunBtn">Re-run analysis (fresh data)</button>`;
  } else {
    html += `<div class="loading" style="padding:1.5rem 0">
      <p>No analysis yet for <strong>${esc(currentStock.s)}</strong>.</p></div>
      <button class="btn btn-accent btn-block" id="rerunBtn">Run 360° analysis</button>`;
  }
  html += providerPickerHTML();
  html += notesHTML(note);
  html += historyHTML(history);
  $("sheetBody").innerHTML = html;
  bindSheetCommon(history);
}

function providerPickerHTML() {
  return `<label class="field" style="display:block;font-size:.78rem;color:var(--tape-dim);margin:.6rem 0 1rem">Engine
    <select id="sheetProvider">
      <option value="anthropic" ${cfg.provider !== "azure" ? "selected" : ""}>Anthropic — live web research</option>
      <option value="azure" ${cfg.provider === "azure" ? "selected" : ""}>Azure OpenAI — model knowledge only</option>
    </select></label>`;
}
function notesHTML(note) {
  return `<h4>My notes</h4>
    <textarea id="noteBox" class="note-box" placeholder="Thesis, entry price, doubts…">${esc(note)}</textarea>
    <button class="btn btn-small" id="saveNote" style="margin-top:.4rem">Save note</button>`;
}
function historyHTML(history) {
  if (!history.length) return "";
  return `<h4>Analysis history (${history.length})</h4>` + history.map((a, i) =>
    `<div class="history-item"><span>${esc(a.verdict || "?")} · conviction ${esc(a.conviction ?? "?")}/10</span>
     <span><time>${new Date(a._savedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</time>
     <button class="btn btn-small" data-hist="${i}" style="margin-left:.5rem">View</button></span></div>`).join("");
}

function bindSheetCommon(history) {
  const rerun = $("rerunBtn");
  if (rerun) rerun.addEventListener("click", () => {
    const provider = $("sheetProvider") ? $("sheetProvider").value : cfg.provider;
    runAnalysis(`${currentStock.n} (${currentStock.s})`, provider);
  });
  const saveNote = $("saveNote");
  if (saveNote) saveNote.addEventListener("click", async () => {
    await DB.set("notes", currentStock.s, $("noteBox").value);
    toast("Note saved");
  });
  document.querySelectorAll("[data-hist]").forEach(btn => btn.addEventListener("click", () => {
    const a = history[+btn.dataset.hist];
    $("sheetBody").innerHTML = analysisHTML(a) +
      `<button class="btn btn-block" id="backHome">← Back</button>`;
    bindProjection(a);
    $("backHome").addEventListener("click", async () => renderSheetHome((await DB.get("analyses", currentStock.s)) || []));
  }));
  if (history[0]) bindProjection(history[0]);
}

async function runAnalysis(query, provider) {
  const p = provider || cfg.provider || "anthropic";
  $("sheetBody").innerHTML = `<div class="loading"><div class="spinner"></div>
    <p>${p === "anthropic" ? "Researching live — price, fundamentals, news, shareholding. 15–40s." : "Analyzing from model knowledge (no live data)."}</p></div>`;
  try {
    const result = await AI.analyzeStock(cfg, query, p);
    result._savedAt = Date.now();
    result._provider = p;
    const key = (result.symbol || currentStock.s).toUpperCase();
    // Reconcile sheet identity with what AI resolved (typed free-text case)
    currentStock = { s: key, n: result.name || currentStock.n, sec: currentStock.sec };
    $("sheetSymbol").textContent = key;
    $("sheetName").textContent = currentStock.n;
    const history = (await DB.get("analyses", key)) || [];
    history.unshift(result);
    await DB.set("analyses", key, history.slice(0, 10));
    cachedSymbols.add(key);
    refreshWatchToggle();
    renderSheetHome(history);
  } catch (err) {
    $("sheetBody").innerHTML = `<div class="error-box">Analysis failed: ${esc(err.message)}</div>
      ${providerPickerHTML()}
      <button class="btn btn-accent btn-block" id="rerunBtn">Retry</button>`;
    bindSheetCommon([]);
  }
}

// ---------- analysis rendering ----------
function verdictClass(v) { return v === "INVEST_WORTHY" ? "v-invest" : v === "AVOID" ? "v-avoid" : "v-watch"; }
function verdictLabel(v) { return v === "INVEST_WORTHY" ? "INVEST-WORTHY" : v === "AVOID" ? "AVOID" : "WATCH"; }

function analysisHTML(a) {
  const s = a.snapshot || {};
  const conviction = Math.max(1, Math.min(10, +a.conviction || 1));
  const segs = Array.from({ length: 10 }, (_, i) => `<i class="${i < conviction ? "on" : ""}"></i>`).join("");
  const stale = a.dataFreshness !== "live-web";
  const rows = [
    ["Price", a.price != null ? INR2.format(a.price) : "—"],
    ["Market cap", s.marketCapCr != null ? fmt(s.marketCapCr) + " Cr" : "—"],
    ["P/E", fmt(s.pe)], ["P/B", fmt(s.pb)],
    ["ROE %", fmt(s.roePct)], ["ROCE %", fmt(s.rocePct)],
    ["Debt / Equity", fmt(s.debtToEquity)],
    ["Sales growth 3y %", fmt(s.salesGrowth3yPct)],
    ["Profit growth 3y %", fmt(s.profitGrowth3yPct)],
    ["Promoter holding %", fmt(s.promoterHoldingPct)],
    ["Promoter pledge %", fmt(s.promoterPledgePct)],
    ["Dividend yield %", fmt(s.dividendYieldPct)],
    ["52w high / low", (s.high52w != null && s.low52w != null) ? `${fmt(s.high52w)} / ${fmt(s.low52w)}` : "—"]
  ];
  const li = (arr, cls) => (arr || []).map(x => `<li>${esc(x)}</li>`).join("") || "<li>None reported</li>";
  const sc = a.scenarios || {};
  const scCard = (label, o) => `<div class="scenario"><b>${label}</b>
      <span class="cagr">${o && o.cagrPct != null ? (o.cagrPct > 0 ? "+" : "") + o.cagrPct + "%" : "—"}</span>
      <p>${esc(o?.why || "")}</p></div>`;

  return `
  ${stale ? `<p class="stale-note">⚠ Model-knowledge only (as of ${esc(a.asOf || "unknown")}). Numbers may be stale — verify before acting.</p>` : ""}
  <div class="verdict-band ${verdictClass(a.verdict)}">
    <span class="v-label">${verdictLabel(a.verdict)}</span>
    <div class="conviction">${segs}</div>
    <span class="v-meta">conviction ${conviction}/10 · data as of ${esc(a.asOf || "?")} · ${a._provider === "azure" ? "Azure OpenAI" : "Anthropic + web"}</span>
    <p class="v-summary">${esc(a.summary)}</p>
  </div>

  <h4>Snapshot</h4>
  <table class="kv-table">${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}</table>

  <h4>Moat</h4><p style="font-size:.87rem;line-height:1.5">${esc(a.moat)}</p>
  <h4>Valuation view</h4><p style="font-size:.87rem;line-height:1.5">${esc(a.valuation)}</p>

  <h4>Bull case — why yes</h4><ul class="blist bull">${li(a.bullCase)}</ul>
  <h4>Bear case — why not</h4><ul class="blist bear">${li(a.bearCase)}</ul>
  <h4>Red flags</h4><ul class="blist flags">${li(a.redFlags)}</ul>
  <h4>Watch for</h4><ul class="blist">${li(a.watchFor)}</ul>

  <h4>10-year scenarios (assumptions, not predictions)</h4>
  <div class="scenario-grid">
    ${scCard("Bear", sc.bear)}${scCard("Base", sc.base)}${scCard("Bull", sc.bull)}
  </div>

  <h4>If I invest…</h4>
  <label class="field" style="font-size:.78rem;color:var(--tape-dim)">Amount (₹)
    <input type="number" id="projAmount" value="100000" min="1000" step="1000" inputmode="numeric" style="margin-top:.3rem">
  </label>
  <table class="proj-table" id="projTable"></table>
  <p class="hint">Pure compounding math on the scenario CAGRs above. Real outcomes will differ — assumptions can be wrong in both directions.</p>

  ${a.sources && a.sources.length ? `<h4>Sources</h4><p class="sources">${a.sources.map(esc).join(" · ")}</p>` : ""}
  <p class="hint disclaimer">Research aid, not investment advice. Verify numbers on screener.in / NSE before you act in INDMoney.</p>`;
}

function bindProjection(a) {
  const input = $("projAmount");
  if (!input) return;
  const sc = a.scenarios || {};
  const render = () => {
    const amt = Math.max(0, +input.value || 0);
    const fv = (c, y) => amt * Math.pow(1 + c / 100, y);
    const row = (label, o) => o && o.cagrPct != null
      ? `<tr><td>${label} (${o.cagrPct > 0 ? "+" : ""}${o.cagrPct}%)</td><td>${INR0.format(fv(o.cagrPct, 5))}</td><td>${INR0.format(fv(o.cagrPct, 10))}</td></tr>`
      : "";
    $("projTable").innerHTML = `<tr><th>Scenario</th><th>5 yrs</th><th>10 yrs</th></tr>` +
      row("Bear", sc.bear) + row("Base", sc.base) + row("Bull", sc.bull);
  };
  input.addEventListener("input", render);
  render();
}

// ---------- portfolio ----------
async function renderPortfolio() {
  const holdings = Object.entries(await DB.all("holdings")).map(([id, h]) => ({ id, ...h }));
  const priceData = (await DB.get("prices", "latest")) || null;
  const has = holdings.length > 0;
  $("pfEmpty").classList.toggle("hidden", has);
  $("pfSummary").classList.toggle("hidden", !has);
  if (!has) { $("holdingsList").innerHTML = ""; return; }

  let invested = 0, current = 0, priced = true;
  const rows = holdings.map(h => {
    const inv = h.qty * h.avgPrice;
    invested += inv;
    const px = priceData?.prices?.[h.symbol];
    let pnlHTML = `<span class="h-sub">no price yet</span>`;
    if (px != null) {
      const val = h.qty * px;
      current += val;
      const pnl = val - inv, pct = (pnl / inv) * 100;
      pnlHTML = `<span class="${pnl >= 0 ? "gain" : "loss"}">${pnl >= 0 ? "+" : ""}${INR0.format(pnl)}<br><small>${pct.toFixed(1)}%</small></span>`;
    } else priced = false;
    return `<li class="holding-row" data-sym="${esc(h.symbol)}">
      <div class="h-main"><span class="h-sym">${esc(h.symbol)}</span>
        <div class="h-sub">${h.qty} × ${INR2.format(h.avgPrice)}${h.date ? " · " + esc(h.date) : ""}</div></div>
      <div class="h-pnl">${pnlHTML}</div>
      <button class="h-del" data-del="${esc(h.id)}" aria-label="Delete holding">✕</button></li>`;
  });
  $("holdingsList").innerHTML = rows.join("");
  $("pfInvested").textContent = INR0.format(invested);
  $("pfCurrent").textContent = priced && priceData ? INR0.format(current) : "—";
  const pnlEl = $("pfPnl");
  if (priced && priceData) {
    const pnl = current - invested;
    pnlEl.textContent = `${pnl >= 0 ? "+" : ""}${INR0.format(pnl)} (${((pnl / invested) * 100).toFixed(1)}%)`;
    pnlEl.className = "pf-num " + (pnl >= 0 ? "gain" : "loss");
  } else { pnlEl.textContent = "—"; pnlEl.className = "pf-num"; }
  $("pricesAsOf").textContent = priceData ? `Prices as of ${priceData.asOf} (AI web fetch — indicative, not tick data)` : "Tap “Refresh prices” to value the portfolio.";
}

$("addHoldingBtn").addEventListener("click", () => $("holdingDialog").showModal());
$("holdingForm").addEventListener("submit", async e => {
  if (e.submitter?.value !== "ok") return;
  const f = new FormData(e.target);
  const symbol = String(f.get("symbol")).toUpperCase().trim();
  const qty = +f.get("qty"), avgPrice = +f.get("avgPrice");
  if (!symbol || qty <= 0 || avgPrice <= 0) return;
  await DB.set("holdings", `${symbol}-${Date.now()}`, { symbol, qty, avgPrice, date: f.get("date") || "" });
  e.target.reset();
  renderPortfolio();
});
$("holdingsList").addEventListener("click", async e => {
  const delId = e.target.dataset.del;
  if (delId) {
    await DB.del("holdings", delId);
    renderPortfolio();
    return;
  }
  const row = e.target.closest(".holding-row");
  if (row) {
    const sym = row.dataset.sym;
    const known = universe.find(x => x.s === sym);
    openSheet(known || { s: sym, n: sym, sec: "Holding" });
  }
});

$("refreshPricesBtn").addEventListener("click", async () => {
  const holdings = Object.values(await DB.all("holdings"));
  if (!holdings.length) return;
  const symbols = [...new Set(holdings.map(h => h.symbol))];
  const btn = $("refreshPricesBtn");
  btn.disabled = true; btn.textContent = "Fetching…";
  try {
    const data = await AI.fetchPrices(cfg, symbols);
    await DB.set("prices", "latest", data);
    renderPortfolio();
    toast("Prices updated");
  } catch (err) { toast("Price fetch failed: " + err.message, 4500); }
  btn.disabled = false; btn.textContent = "Refresh prices (AI)";
});

$("healthCheckBtn").addEventListener("click", async () => {
  const holdings = Object.values(await DB.all("holdings"))
    .map(h => ({ symbol: h.symbol, qty: h.qty, avgPrice: h.avgPrice, invested: +(h.qty * h.avgPrice).toFixed(0) }));
  if (!holdings.length) return;
  const box = $("healthReport");
  box.classList.remove("hidden");
  box.innerHTML = `<div class="loading"><div class="spinner"></div><p>Auditing your portfolio against the current market. 20–50s.</p></div>`;
  try {
    const r = await AI.healthCheck(cfg, holdings);
    box.innerHTML = `
      <div class="health-score"><span class="hs-num risk-${esc(r.overallRisk)}">${esc(r.score)}/10</span>
        <span class="risk-${esc(r.overallRisk)}">${esc(r.overallRisk)} RISK</span>
        <span class="v-meta" style="margin-left:auto;font-size:.72rem;color:var(--tape-dim)">${esc(r.asOf || "")}</span></div>
      <p style="font-size:.9rem;line-height:1.5;margin-bottom:.6rem">${esc(r.headline)}</p>
      ${(r.warnings || []).map(w => `<div class="warning-item sev-${esc(w.severity)}"><b>${esc(w.title)}</b><span>${esc(w.detail)}</span></div>`).join("")}
      <h4>Concentration</h4><p style="font-size:.85rem;line-height:1.5">${esc(r.concentration)}</p>
      <h4>Market pitfalls to watch</h4><ul class="blist flags">${(r.macroWatch || []).map(x => `<li>${esc(x)}</li>`).join("")}</ul>
      <h4>Suggested actions</h4><ul class="blist">${(r.actions || []).map(x => `<li>${esc(x)}</li>`).join("")}</ul>
      <p class="hint disclaimer">Risk audit, not advice. Decisions and execution stay yours (INDMoney).</p>`;
  } catch (err) { box.innerHTML = `<div class="error-box">Health check failed: ${esc(err.message)}</div>`; }
});

// ---------- compare ----------
function renderCompareChips() {
  $("compareChips").innerHTML = compareSel.map(s =>
    `<button class="chip active" data-rm="${esc(s)}">${esc(s)}<span class="x">✕</span></button>`).join("");
  $("runCompareBtn").disabled = compareSel.length < 2;
}
$("compareChips").addEventListener("click", e => {
  const s = e.target.closest("[data-rm]")?.dataset.rm; if (!s) return;
  compareSel = compareSel.filter(x => x !== s);
  renderCompareChips();
});
$("compareSearch").addEventListener("input", () => {
  const q = $("compareSearch").value.trim().toLowerCase();
  const box = $("compareSuggest");
  if (q.length < 1) { box.classList.add("hidden"); return; }
  const hits = universe.filter(s => (s.s.toLowerCase().includes(q) || s.n.toLowerCase().includes(q)) && !compareSel.includes(s.s)).slice(0, 6);
  box.innerHTML = hits.map(s => `<li data-add="${esc(s.s)}"><b>${esc(s.s)}</b> — ${esc(s.n)}</li>`).join("") ||
    `<li data-add="${esc(q.toUpperCase())}">Add "${esc(q.toUpperCase())}" (free text)</li>`;
  box.classList.remove("hidden");
});
$("compareSuggest").addEventListener("click", e => {
  const s = e.target.closest("[data-add]")?.dataset.add; if (!s) return;
  if (compareSel.length >= 3) { toast("Max 3 stocks"); return; }
  compareSel.push(s);
  $("compareSearch").value = ""; $("compareSuggest").classList.add("hidden");
  renderCompareChips();
});
$("runCompareBtn").addEventListener("click", async () => {
  const out = $("compareResult");
  out.innerHTML = `<div class="loading"><div class="spinner"></div><p>Comparing ${compareSel.join(" vs ")} with live research. 20–60s.</p></div>`;
  try {
    const r = await AI.compareStocks(cfg, compareSel);
    out.innerHTML = `
      <table class="cmp-table">
        <thead><tr><th></th>${r.symbols.map(s => `<th>${esc(s)}</th>`).join("")}</tr></thead>
        <tbody>${(r.rows || []).map(row => `<tr><td>${esc(row.metric)}</td>${(row.values || []).map(v => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
      ${r.pick ? `<div class="pick-band"><b>${r.pick.symbol === "NONE" ? "No pick — all unattractive" : "Pick: " + esc(r.pick.symbol)}</b><p>${esc(r.pick.why)}</p></div>` : ""}
      ${r.caveats?.length ? `<h4>Caveats</h4><ul class="blist flags">${r.caveats.map(c => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
      <p class="hint">Data as of ${esc(r.asOf || "?")}. Verify before acting.</p>`;
  } catch (err) { out.innerHTML = `<div class="error-box">Comparison failed: ${esc(err.message)}</div>`; }
});

// ---------- boot ----------
(async function init() {
  await loadCfg();
  bindSettings();
  await loadUniverse();
  if (navigator.serviceWorker) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
})();
