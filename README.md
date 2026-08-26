# Ledger — personal AI stock research (NSE)

Mobile-only PWA. Static hosting, zero backend, all data on-device (IndexedDB). You bring your own AI keys.

**What it is:** a research layer. You still execute trades in INDMoney — this never touches money and cannot sync with INDMoney (no public API).

---

## Deploy (GitHub Pages)

| Step | Command / action |
|---|---|
| 1 | Create repo `ledger` under `av-vignesh` (public or private + Pages) |
| 2 | Copy this folder's contents to repo root, push to `main` |
| 3 | Repo → Settings → Pages → Source: `main` / root |
| 4 | Open `https://av-vignesh.github.io/ledger/` on your phone |
| 5 | Android Chrome → menu → **Add to Home screen** (installs as app) |

No build step. Editing any file + push = deployed. Bump `CACHE` version in `sw.js` when you ship changes, or the old shell stays cached.

## First-run setup (on the phone)

| Setting | Value |
|---|---|
| Settings → Anthropic API key | `sk-ant-...` from console.anthropic.com |
| Anthropic model | `claude-sonnet-4-6` (default) — editable if models change |
| Azure endpoint | `https://<resource>.openai.azure.com` |
| Azure deployment | e.g. `gpt-4o-mini` |
| Azure API version | `2024-08-01-preview` (default) |
| Test connection | Both buttons must show `connected ✓` |

## What each feature costs (rough, Sonnet + web search)

| Action | Web searches | Approx tokens | Ballpark |
|---|---|---|---|
| Stock analysis | up to 6 | ~10–20k | a few cents / few rupees |
| Compare 2–3 | up to 6 | ~10–20k | similar |
| Health check | up to 6 | ~10–25k | similar |
| Price refresh | 1–3 | small | cheapest |

Analyses are cached with history (last 10 per stock) — reopen a stock and the cached verdict shows instantly; re-run only when you want fresh data.

## Engine truth table

| | Anthropic | Azure OpenAI |
|---|---|---|
| Live price / news / fundamentals | ✅ web search | ❌ model knowledge only |
| Analysis quality label in UI | "Anthropic + web" | "⚠ Model-knowledge only" banner |
| Price refresh (portfolio) | always used | never used |

## Hard limitations — read once

1. **No push alerts.** Static site, no backend. "Health check" runs when you tap it, not by itself.
2. **Prices are indicative.** AI web fetches, not exchange ticks. Never use them to time an order — check INDMoney for the real quote.
3. **Scenarios ≠ predictions.** Bear/Base/Bull CAGRs are stated assumptions; the projection table is pure compounding math on them.
4. **AI can be wrong.** Numbers can be stale or hallucinated even with web search. Verify on screener.in / NSE before acting.
5. **Azure CORS:** if your Azure resource blocks browser calls, analyses via Azure will fail with a CORS error — Anthropic works regardless (uses their browser-access header).

## Security notes

- API keys live in IndexedDB **on your phone only**. They are sent only to `api.anthropic.com` / your Azure endpoint.
- Don't share exported backups — they contain your keys, holdings, and notes.
- Standard advice: use a dedicated Anthropic key with a spend limit so a lost phone can't run up a bill.

## Files

```
index.html            app shell (5 tabs + detail sheet)
css/app.css           4 themes (vault/paper/terminal/indigo), accent, font scale
js/db.js              IndexedDB layer + export/import/wipe
js/ai.js              Anthropic + Azure providers, prompts, JSON parsing
js/app.js             UI logic, portfolio math, projections
data/stocks.json      207 curated NSE stocks (editable; typed search covers everything else)
sw.js                 offline app shell (never caches API calls)
manifest.webmanifest  PWA install
icons/                app icon
```

*Research aid, not investment advice.*
