# rPoly Development Plan

## Current Version: v2.5.0
**Last Updated:** 2026-02-17

---

## v1.0.0 - MVP (DONE)
- [x] Basic Express server
- [x] Frontend dashboard with retro hacker UI
- [x] Markets list from Gamma API
- [x] Basic scanner and signals (mock)
- [x] Portfolio tracking (mock)

---

## v1.3.0 - Real Data (DONE)
- [x] BTC price from CoinGecko
- [x] 5m Polymarket market data
- [x] On-chain portfolio via Polygon RPC
- [x] BTC Chart (24h OHLC)

---

## v1.4.0 - CLOB Trading (DONE)
- [x] First successful trade on Polymarket CLOB
- [x] signatureType=2 (Gnosis Safe) discovery
- [x] Gasless trading (no MATIC, no approve needed)
- [x] L2 API credentials derived from EOA

---

## v2.0.0 - Dashboard Redesign (DONE)
- [x] Full-width responsive layout
- [x] Environment variables moved to `.env`
- [x] Auth token protection for trade endpoints
- [x] Read-only mode (`RPOLY_MODE=readonly`) for public deploy
- [x] Removed login screen (backend-managed trading)

---

## v2.1.0 - Live Data & Rich Dashboard (DONE)
- [x] RTDS WebSocket — real-time BTC price from Polymarket
- [x] Custom sparkline chart — main chart from WS ticks
- [x] TradingView mini candlestick — Binance candles (1s/1m/5m)
- [x] Binance API for chart data and BTC price fallback
- [x] Portfolio card — Cash, Proxy address (copyable), Positions Value, Volume, P/L
- [x] Profile card — Identicon avatar, joined date, Win Rate, Record (W/L), Best Trade, Total P/L
- [x] Activity feed — full onchain activity (TRADE, REDEEM, SPLIT, etc.)
- [x] 6 Data API endpoints — positions, closed-positions, value, traded, activity, profile
- [x] Header clock — UTC + PL time with glow effect
- [x] CLOB WebSocket — live order flow from active 5m market
- [x] Floating trade bubbles — animated BUY/SELL indicators on chart
- [x] Countdown timers — time remaining for each 5m market
- [x] End times (UTC/PL) — displayed in markets table

---

## v2.2.0 - Data Lab & Collection (DONE)
- [x] `/learn` page — Data Lab with internal analytics
- [x] Background data collector (every 60s)
  - Odds snapshots → `trades/odds-YYYY-MM-DD.json`
  - Global trades → `trades/global-YYYY-MM-DD.json`
  - Whale positions → `trades/whales-YYYY-MM-DD.json`
  - Pattern detection → `trades/patterns.json`
- [x] Data Lab API endpoints (`/api/learn/*`)
- [x] Collector status monitoring (start/stop, stats)

---

## v2.3.0 - Hub & Public Landing (DONE)
- [x] `/hub` page — public landing page
- [x] Hero section, live data demo, API docs preview
- [x] Consistent navigation across all 4 pages

---

## v2.4.0 - Trading Terminal (DONE)
- [x] `/trade` page — full Trading Terminal
- [x] **Dual mode**: authenticated (owner) = full controls, visitor = spectator
- [x] Active market display with live countdown + progress bar
- [x] "Price to Beat" vs "BTC Now" comparison
- [x] BUY/SELL panel (side selector, size input, optional price)
- [x] Take-Profit / Stop-Loss setter (limit sell orders)
- [x] Active positions with "Sell Now" button
- [x] Open orders with per-order cancel + "Cancel All"
- [x] ClawBot message ticker (live bot feed for spectators)
- [x] Trade log (bot trades + on-chain activity, merged & deduped)
- [x] Portfolio summary sidebar

---

## v2.5.0 - Dashboard Polish & Price to Beat (DONE)
- [x] "Price to Beat" column in 5m markets table
- [x] "Price to Beat" displayed in Trading Terminal market info
- [x] Binance klines integration for reference price at `eventStartTime`
- [x] Profile card: identicon avatar, W/L with `/` separator, enlarged stats
- [x] Portfolio card: copyable proxy address, enlarged cash display
- [x] Card labels removed for cleaner look
- [x] $BTC PRICE label on BTC card (green, prominent)
- [x] Default chart interval changed to 1m
- [x] Consistent navigation (Dashboard, Trade, Data Lab, Hub)
- [x] New backend endpoints: `/api/sell`, `/api/sell-limit`, `/api/open-orders`, `/api/cancel-order/:id`, `/api/bot-message`, `/api/trade-log`
- [x] Trade logging (all BUY/SELL actions persisted to `trades/trade-log.json`)

---

## v3.0.0 - Autonomous Trading Agent (NEXT)
**Goal:** AI agent trades 5-minute BTC markets autonomously

### Phase 1: Core Loop
- [ ] Strategy engine with configurable parameters
- [ ] Trade execution loop (detect new 5m market → analyze → decide → trade)
- [ ] Position monitoring (check P/L every N seconds)
- [ ] Auto-exit logic (profit target %, time-based before market close)
- [ ] Trade journal with per-trade reasoning logged

### Phase 2: Data-Driven Decisions
- [ ] Use Data Lab collected data (odds history, whale positions, global trades)
- [ ] Pattern recognition from `trades/patterns.json`
- [ ] Price to Beat analysis (buy when odds diverge from BTC momentum)
- [ ] Crowd fade strategy (buy opposite when sentiment is extreme)
- [ ] Confidence-based position sizing

### Phase 3: Risk Management
- [ ] Max drawdown limit (stop trading after N consecutive losses)
- [ ] Position size limits (never risk more than X% of bankroll)
- [ ] Market quality filter (skip low-volume/low-liquidity markets)
- [ ] Cool-down period after losses

### Phase 4: Monitoring & Alerts
- [ ] CLOB User Channel WebSocket (server-side fill events)
- [ ] Auto-refresh balance/activity on trade fill events
- [ ] ClawBot messages for each trade decision (visible to spectators)
- [ ] Telegram/Discord notifications for trades

### Phase 5: Multi-Strategy
- [ ] Multiple strategy modes (safe/aggressive/degen)
- [ ] Backtesting against historical Data Lab data
- [ ] A/B strategy testing
- [ ] Dynamic strategy selection based on market conditions

---

## v3.1.0 - Advanced Features
- [ ] Multi-market support (not just BTC 5m)
- [ ] x402 payments for signal subscriptions
- [ ] API for external bots to query signals
- [ ] Webhook integration for external alerts

---

## v4.0.0 - Pro
- [ ] Full SaaS dashboard with user accounts
- [ ] Multi-chain support
- [ ] Custom strategy builder UI
- [ ] Production monitoring & observability

---

## Data Sources

| Source | What | How | Rate |
|--------|------|-----|------|
| Polymarket RTDS WS | BTC price | WebSocket (browser) | Real-time |
| Polymarket CLOB WS | Orders/trades | WebSocket (browser) | Real-time |
| Polymarket Gamma API | Markets, profile | HTTP polling (30-60s) | ~10 req/min |
| Polymarket Data API | Positions, activity, P/L | HTTP polling (60s) | ~10 req/min |
| Polymarket CLOB API | Trading, orderbook | HTTP on-demand | As needed |
| Binance API | BTC candles, price, priceToBeat | HTTP polling (30s-5m) | No limit |
| Polygon RPC | USDC/MATIC balances | HTTP polling (15s) | ~4 req/15s |
| Data Collector | Odds, whales, global trades | Background (60s) | Internal |

---

## Quick Start

```bash
cd rpoly
cp .env.example .env
# Fill in credentials (see ARCHITECTURE.md)
npm install
node server.js
# Dashboard:   http://localhost:3001
# Trade:       http://localhost:3001/trade
# Data Lab:    http://localhost:3001/learn
# Hub:         http://localhost:3001/hub
```

---

*Clawdex / rPoly*
