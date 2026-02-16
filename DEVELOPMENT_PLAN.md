# rPoly Development Plan

## Current Version: v2.1.0
**Last Updated:** 2026-02-16

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
- [x] On-chain portfolio via Base RPC
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
- [x] **RTDS WebSocket** - real-time BTC price from Polymarket
- [x] **Custom sparkline chart** - main chart from WS ticks
- [x] **TradingView mini candlestick** - Binance candles (1s/1m/5m)
- [x] **Binance API** for chart data and BTC price fallback
- [x] **Portfolio card** - Cash, Proxy/EOA, Positions Value, Volume, Realized/Unrealized P/L
- [x] **Profile card** - Clawdex name, joined date, markets traded, W/L record, win rate, best trade
- [x] **Activity feed** - full onchain activity (TRADE, REDEEM, SPLIT, etc.) from Data API
- [x] **6 Data API endpoints** - positions, closed-positions, value, traded, activity, profile
- [x] **Header clock** - UTC + PL time with green glow effect
- [x] **CLOB WebSocket** - live order flow from active 5m market
- [x] **Floating trade bubbles** - animated BUY/SELL indicators on chart
  - Trades: bright large bubbles with glow (+ $2.62 3sh)
  - Orders: dim smaller bubbles (BID 52¢ / ASK 48¢)
- [x] **Countdown timers** - time remaining for each 5m market
- [x] **End times (UTC/PL)** - displayed in markets table
- [x] **5m Markets table** - Market | End (UTC/PL) | Time Left | Up/Down | Volume | Status

---

## v2.2.0 - Autonomous Trading (NEXT)
**Goal:** AI agent executes trades automatically

### Trading Strategy
```
1. Every 5 minutes, check new BTC market
2. Analyze signal (sentiment, price momentum, crowd fade)
3. If confident → place trade via CLOB API
4. Monitor position → auto-close if profitable
5. Track all results → learn and adapt
```

### Tasks
- [ ] CLOB User Channel WebSocket (server-side) for real-time trade fills
- [ ] Auto-refresh balance/activity on trade fill events
- [ ] Strategy engine with configurable parameters
- [ ] Trade execution loop (every 5m cycle)
- [ ] Position monitoring and auto-exit
- [ ] Trade journal with win/loss tracking
- [ ] Telegram/Discord notifications for trades

---

## v2.3.0 - Advanced Strategies
- [ ] Multiple strategy modes (safe/aggressive/degen)
- [ ] Confidence-based position sizing
- [ ] Historical backtesting
- [ ] Multi-market support (not just BTC 5m)

---

## v3.0.0 - Pro
- [ ] x402 payments for signal subscriptions
- [ ] API for external bots
- [ ] Vercel production deployment with monitoring
- [ ] Multi-chain support

---

## Data Sources

| Source | What | How | Rate |
|--------|------|-----|------|
| Polymarket RTDS WS | BTC price | WebSocket (browser) | Real-time |
| Polymarket CLOB WS | Orders/trades | WebSocket (browser) | Real-time |
| Polymarket Gamma API | Markets, profile | HTTP polling (30-60s) | ~10 req/min |
| Polymarket Data API | Positions, activity, P/L | HTTP polling (60s) | ~10 req/min |
| Polymarket CLOB API | Trading, orderbook | HTTP on-demand | As needed |
| Binance API | BTC candles, price | HTTP polling (30s-5m) | No limit |
| Polygon RPC | USDC/MATIC balances | HTTP polling (15s) | ~4 req/15s |

---

## Quick Start

```bash
cp .env.example .env
# Fill in credentials
npm install
node server.js
# http://localhost:3001
```

---

*Clawdex / rPoly*
