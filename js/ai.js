/* Ledger — AI layer. Anthropic = live web research. Azure OpenAI = model knowledge only. */
const AI = (() => {

  // ---------- low-level calls ----------
  async function callAnthropic(cfg, userPrompt, { useWebSearch = true, maxTokens = 4096 } = {}) {
    if (!cfg.anthropicKey) throw new Error("Anthropic API key not set (Settings)");
    const body = {
      model: cfg.anthropicModel || "claude-sonnet-4-6",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: userPrompt }]
    };
    if (useWebSearch) body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }];

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": cfg.anthropicKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${data?.error?.message || "request failed"}`);
    const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
    if (!text) throw new Error("Anthropic returned no text");
    return text;
  }

  async function callAzure(cfg, userPrompt, { maxTokens = 4096 } = {}) {
    if (!cfg.azureEndpoint || !cfg.azureDeployment || !cfg.azureKey) {
      throw new Error("Azure OpenAI not fully configured (Settings)");
    }
    const ver = cfg.azureApiVersion || "2024-08-01-preview";
    const url = `${cfg.azureEndpoint.replace(/\/+$/, "")}/openai/deployments/${cfg.azureDeployment}/chat/completions?api-version=${ver}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "api-key": cfg.azureKey },
      body: JSON.stringify({
        messages: [
          { role: "system", content: "You are a conservative Indian equity research analyst. You have NO live data access; state that your figures reflect training knowledge and may be stale. Always respond with ONLY valid JSON when asked for JSON — no markdown fences, no commentary." },
          { role: "user", content: userPrompt }
        ],
        max_tokens: maxTokens,
        temperature: 0.3
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Azure ${res.status}: ${data?.error?.message || "request failed"}`);
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error("Azure returned no text");
    return text;
  }

  function call(cfg, prompt, opts = {}) {
    const provider = opts.provider || cfg.provider || "anthropic";
    return provider === "azure" ? callAzure(cfg, prompt, opts) : callAnthropic(cfg, prompt, opts);
  }

  // ---------- JSON extraction ----------
  function extractJSON(text) {
    const cleaned = text.replace(/```json|```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("No JSON found in AI response");
    return JSON.parse(cleaned.slice(start, end + 1));
  }

  // ---------- connection tests ----------
  async function testAnthropic(cfg) {
    const t = await callAnthropic(cfg, "Reply with exactly: OK", { useWebSearch: false, maxTokens: 16 });
    return t.includes("OK");
  }
  async function testAzure(cfg) {
    const t = await callAzure(cfg, "Reply with exactly: OK", { maxTokens: 16 });
    return t.includes("OK");
  }

  // ---------- prompts ----------
  const ANALYSIS_SCHEMA = `{
 "symbol": "NSE symbol",
 "name": "company name",
 "exchange": "NSE|BSE",
 "asOf": "date of the data you used, YYYY-MM-DD",
 "dataFreshness": "live-web|model-knowledge",
 "price": number|null,
 "currency": "INR",
 "verdict": "INVEST_WORTHY|WATCH|AVOID",
 "conviction": integer 1-10,
 "summary": "3-4 sentence plain-language verdict rationale",
 "snapshot": {
   "marketCapCr": number|null, "pe": number|null, "pb": number|null,
   "roePct": number|null, "rocePct": number|null, "debtToEquity": number|null,
   "salesGrowth3yPct": number|null, "profitGrowth3yPct": number|null,
   "promoterHoldingPct": number|null, "promoterPledgePct": number|null,
   "dividendYieldPct": number|null, "high52w": number|null, "low52w": number|null
 },
 "moat": "1-2 sentences on durable advantage, or 'None identified'",
 "valuation": "1-2 sentences: cheap/fair/expensive vs history & peers, and why",
 "bullCase": ["3-5 specific reasons to own it"],
 "bearCase": ["3-5 specific reasons it could disappoint"],
 "redFlags": ["governance, pledging, debt, dilution, dependence risks — empty array only if genuinely none"],
 "watchFor": ["2-4 concrete triggers/events to monitor going forward"],
 "scenarios": {
   "bear": {"cagrPct": number, "why": "one line"},
   "base": {"cagrPct": number, "why": "one line"},
   "bull": {"cagrPct": number, "why": "one line"}
 },
 "sources": ["urls or source names used"]
}`;

  function analysisPrompt(query, live) {
    return `You are a conservative equity research analyst for Indian stock markets (NSE/BSE).
Analyze: "${query}".
${live
  ? "Use web search to get: current price, market cap, valuation ratios (P/E, P/B), ROE/ROCE, debt, 3y sales & profit growth, promoter holding & pledging, recent news/results, 52-week range. Prefer screener.in, NSE, moneycontrol, company filings."
  : "You have NO live data. Use your training knowledge, set dataFreshness to \"model-knowledge\", set asOf to your knowledge cutoff date, and be explicit about staleness in the summary."}
Rules:
- Be honest and conservative. If the business is low quality or the price is stretched, say AVOID. Do not flatter.
- redFlags must be real diligence items, not boilerplate.
- scenarios are 10-year annualized return scenarios (CAGR %, can be negative for bear). Base them on earnings growth + valuation re-rating logic, stated in "why". These are scenario assumptions, NOT predictions.
- All money figures in INR. marketCapCr is in ₹ crore.
- If the query does not resolve to a real listed Indian company, return {"error":"not found","suggestion":"closest match if any"}.
Respond with ONLY valid JSON matching exactly this schema (no markdown, no commentary):
${ANALYSIS_SCHEMA}`;
  }

  function comparePrompt(symbols, live) {
    return `You are a conservative equity research analyst for Indian markets.
Compare these NSE stocks head-to-head: ${symbols.join(", ")}.
${live ? "Use web search for current price, P/E, ROE/ROCE, debt/equity, 3y profit growth, promoter holding, and recent developments for each." : "Use training knowledge only; note staleness."}
Respond with ONLY valid JSON:
{
 "asOf": "YYYY-MM-DD",
 "symbols": [${symbols.map(s => `"${s}"`).join(",")}],
 "rows": [
   {"metric": "Price (₹)", "values": ["...", "..."]},
   {"metric": "Market cap (₹ Cr)", "values": []},
   {"metric": "P/E", "values": []},
   {"metric": "ROE %", "values": []},
   {"metric": "ROCE %", "values": []},
   {"metric": "Debt/Equity", "values": []},
   {"metric": "3y profit growth %", "values": []},
   {"metric": "Promoter holding %", "values": []},
   {"metric": "Moat", "values": []},
   {"metric": "Key risk", "values": []},
   {"metric": "Verdict", "values": ["INVEST_WORTHY|WATCH|AVOID"]}
 ],
 "pick": {"symbol": "the single best risk-adjusted choice, or \\"NONE\\" if all are unattractive", "why": "3-4 sentences"},
 "caveats": ["1-3 things that could invalidate this comparison"]
}
Every "values" array must have exactly ${symbols.length} entries, same order as symbols. Strings only inside values.`;
  }

  function healthPrompt(holdings, live) {
    return `You are a conservative portfolio risk analyst for Indian retail investors.
My current holdings (symbol, qty, avg buy price ₹, invested ₹):
${JSON.stringify(holdings)}
${live ? "Use web search for current prices, recent news on each holding, and the current Indian market environment (Nifty valuation, rates, FII flows, sector stress)." : "Use training knowledge; note staleness."}
Assess honestly: concentration risk, sector overlap, stock-specific red flags, macro pitfalls I should watch, and what could go wrong. Do not reassure me — warn me.
Respond with ONLY valid JSON:
{
 "asOf": "YYYY-MM-DD",
 "overallRisk": "LOW|MEDIUM|HIGH",
 "score": integer 1-10 (10 = very healthy),
 "headline": "one sentence overall assessment",
 "warnings": [{"severity": "LOW|MEDIUM|HIGH", "title": "short", "detail": "2-3 sentences, specific to MY holdings"}],
 "concentration": "1-2 sentences on position/sector concentration",
 "macroWatch": ["2-4 current market-level pitfalls to watch"],
 "actions": ["2-4 concrete, prioritized suggestions (rebalance, trim, research X). Never 'consult an advisor' filler."]
}`;
  }

  function pricesPrompt(symbols) {
    return `Get the latest NSE stock prices in INR for: ${symbols.join(", ")}.
Use web search. Respond with ONLY valid JSON: {"asOf":"YYYY-MM-DD HH:mm IST","prices":{"SYMBOL": number, ...}}.
Use null for any symbol you cannot verify. No commentary.`;
  }

  // ---------- high-level operations ----------
  async function analyzeStock(cfg, query, provider) {
    const p = provider || cfg.provider || "anthropic";
    const live = p === "anthropic";
    const text = await call(cfg, analysisPrompt(query, live), { provider: p, maxTokens: 4096, useWebSearch: live });
    const json = extractJSON(text);
    if (json.error) throw new Error(`Stock not found. ${json.suggestion ? "Did you mean: " + json.suggestion + "?" : ""}`);
    return json;
  }

  async function compareStocks(cfg, symbols, provider) {
    const p = provider || cfg.provider || "anthropic";
    const live = p === "anthropic";
    const text = await call(cfg, comparePrompt(symbols, live), { provider: p, maxTokens: 4096, useWebSearch: live });
    return extractJSON(text);
  }

  async function healthCheck(cfg, holdings, provider) {
    const p = provider || cfg.provider || "anthropic";
    const live = p === "anthropic";
    const text = await call(cfg, healthPrompt(holdings, live), { provider: p, maxTokens: 4096, useWebSearch: live });
    return extractJSON(text);
  }

  async function fetchPrices(cfg, symbols) {
    // Live prices require web search → Anthropic only, regardless of default provider.
    const text = await callAnthropic(cfg, pricesPrompt(symbols), { useWebSearch: true, maxTokens: 2048 });
    return extractJSON(text);
  }

  return { testAnthropic, testAzure, analyzeStock, compareStocks, healthCheck, fetchPrices };
})();
