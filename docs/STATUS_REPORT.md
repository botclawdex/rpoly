# rPoly — Current Status & Complete Overview

## 🦞 What We Have (Feb 16, 2026)

**rPoly** is a real-time Polymarket BTC 5-minute trading dashboard + autonomous trading bot. 

### ✅ Version 2.1.0 (COMPLETE)

**Production-Ready Features:**
- ✅ **Real-time BTC price** via Polymarket RTDS WebSocket (wss://ws-live-data.polymarket.com)
- ✅ **Custom sparkline chart** with live ticks + 1s/1m/5m candlesticks (Binance data)
- ✅ **Full portfolio tracking** (USDC + MATIC balance, positions, P/L)
- ✅ **Live activity feed** (TRADE, REDEEM, SPLIT events from Polymarket Data API)
- ✅ **CLOB trading** with Gnosis Safe (signatureType=2 = gasless trades, no approve needed)
- ✅ **Live order flow** from CLOB WebSocket (BUY/SELL bubbles on chart)
- ✅ **5-minute markets table** with countdowns, end times (UTC + PL timezone)
- ✅ **Auth-protected trading** (RPOLY_AUTH_TOKEN for /api/trade endpoint)
- ✅ **Read-only mode** (RPOLY_MODE=readonly for public Vercel deploy)
- ✅ **Hacker UI** with retro terminal aesthetic, glow effects, real-time clocks

**Files:**
- `server.js` — Express API (localhost:3001)
- `index.html` — Dashboard frontend (retro UI, WebSockets, polling)
- `trade-proxy.js` — CLOB trade execution (Gnosis Safe via signatureType=2)
- `methods.js` — Polymarket API helpers
- `current-markets.js` — Market scanner
- `.env` — Credentials (NEVER committed)

### Wallet Architecture

```
MetaMask EOA (signer)
  0x7Ca66FFAF6A5D4DE8492C97c61753B699350AD77
  ├─ ~$1.98 USDC on Polygon
  └─ Controlled by 1-of-1 Gnosis Safe
      0xA95Bf3B311D596e78369a016B113D0E4e662ECb1
      └─ Acts as "maker" in CLOB orders
         └─ Gasless trading (signatureType=2)
```

---

## 📋 Core Files Breakdown

### `server.js` (Node.js + Express)

**Public API Endpoints:**
- `GET /health` — Health check
- `GET /api/dashboard` — Balances + current signal + orderbook
- `GET /api/markets/5m` — All active 5m markets with tokenIds
- `GET /api/chart?interval=1s|1m|5m|15m` — Binance candles
- `GET /api/profile` — Full Clawdex profile from Data API (stats, P/L, activity)

**Protected Endpoints (require `RPOLY_AUTH_TOKEN`):**
- `POST /api/trade` — Execute CLOB trade (buy/sell, size, outcome)
- `POST /api/cancel-all` — Cancel all open orders
- `GET /api/auth` — Verify auth token

**Modes:**
- `RPOLY_MODE=live` — Full trading enabled
- `RPOLY_MODE=readonly` — Dashboard only, no trading

---

### `index.html` (Frontend Dashboard)

**UI Sections:**
1. **Header** — rPoly branding + UTC/PL clock + MODE indicator
2. **Tabs** — BTC/USD | Portfolio | Profile | Activity
3. **Main Chart** — Real-time BTC sparkline (RTDS WS) + animated trade bubbles (CLOB WS)
4. **TradingView Chart** — 1s/1m/5m/15m candlesticks (Binance)
5. **Portfolio Card** — USDC cash, Proxy/EOA, position value, volume, P/L
6. **Profile Card** — Name, joined date, W/L record, win rate, best trade
7. **Activity Feed** — Full onchain activity (TRADE, REDEEM, etc.)
8. **5m Markets Table** — Live markets with countdowns

**Data Sources:**
- **RTDS WebSocket** (real-time) — BTC price ticks → main sparkline
- **CLOB WebSocket** (real-time) — Order flow → floating bubbles
- **Polling (15-60s)** — Dashboard API, markets, profile, activity
- **Binance API** (30s-5m) — Candlestick data + BTC price fallback

---

### `trade-proxy.js` (CLOB Trading)

**What it does:**
1. Takes trade params (outcome, size, price)
2. Signs order using MetaMask EOA private key
3. Submits to Polymarket CLOB API with signatureType=2
4. No gas, no approve, no MATIC needed (Gnosis Safe magic!)

**Key Discovery:**
- `signatureType=2` = Gnosis Safe user
- Sponsor (Polymarket) pays gas for your trade
- No need to send MATIC or ETH
- EOA can control Proxy without being funded

---

### `methods.js` (API Helpers)

Wrapper functions for:
- Gamma API (markets, profile)
- Data API (positions, activity, P/L)
- CLOB API (orderbook, trade history)
- Binance API (chart data)
- Polygon RPC (balance checks)

---

### `.env` (Secrets)

Required:
```bash
POLY_PRIVATE_KEY=0x...             # MetaMask EOA private key
POLY_PROXY_ADDRESS=0x...           # Gnosis Safe address
POLY_API_KEY=...                   # L2 API credentials
POLY_API_SECRET=...
POLY_API_PASSPHRASE=...
RPOLY_AUTH_TOKEN=...               # Dashboard auth
RPOLY_MODE=live|readonly           # Trading mode
```

---

## 🚀 Next Version: v2.2.0 — Autonomous Trading

**Goal:** rPoly becomes a trading bot that:
1. **Every 5 minutes** — Check new BTC 5m market
2. **Analyze** — Calculate signal (crowd, momentum, sentiment)
3. **Execute** — Auto-place trade if confident
4. **Monitor** — Auto-close when profitable
5. **Track** — Journal all results, learn

**Roadmap:**
- [ ] CLOB User Channel WS (server-side fill events)
- [ ] Auto-refresh on trade execution
- [ ] Strategy engine (configurable risk/reward)
- [ ] Trade loop (every 5m market cycle)
- [ ] Auto-exit logic
- [ ] Win/loss journal
- [ ] Telegram/Discord alerts

---

## 💰 Current Situation

**Wallet Balance:** ~$1.98 USDC (enough for 1-2 test trades)

**Recent Activity:** 
- First CLOB trade executed successfully (Feb 16)
- TX: `0xf868a188bd6afdd1cc3f107591a76931970a968f979aa77492be9384408b2adb`
- Order: BUY 5 shares "Up" @ $0.51 (total $2.55)

**Next Goal:** Scale to autonomous trading with real capital

---

## 📊 Architecture Summary

```
┌─────────────────────────────────────────────┐
│   Frontend (index.html + WebSockets)        │
│   • Real-time BTC price (RTDS WS)           │
│   • Live order flow (CLOB WS)               │
│   • Polling API (15-60s)                    │
└────────────────┬────────────────────────────┘
                 │
┌────────────────▼────────────────────────────┐
│   Backend (server.js + Express)             │
│   • /api/dashboard → balances + signal      │
│   • /api/trade → CLOB order execution       │
│   • /api/markets/5m → active markets        │
│   • /api/profile → full stats               │
└────────────────┬────────────────────────────┘
                 │
┌────────────────▼────────────────────────────┐
│   External APIs                             │
│   • Polymarket Gamma/Data/CLOB              │
│   • Binance (candlesticks)                  │
│   • Polygon RPC (balances)                  │
└─────────────────────────────────────────────┘
```

---

## 🎯 How to Use rPoly Today

### Run Locally
```bash
cd rpoly
cp .env.example .env
# Fill in POLY_PRIVATE_KEY, POLY_PROXY_ADDRESS, etc.
npm install
node server.js
```
Visit `http://localhost:3001`

### Deploy to Vercel
```bash
vercel env add RPOLY_MODE readonly  # Disable trading
vercel deploy
```
(Makes dashboard public without trading risk)

### Execute a Trade
```bash
curl -X POST http://localhost:3001/api/trade \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "market": "0x...",
    "outcome": "YES",
    "size": "5",
    "price": "0.51"
  }'
```

---

## ⚠️ Known Limitations

1. **Manual trading only** (v2.1) — Awaiting v2.2 for automation
2. **Needs capital** — ~$1.98 USDC per trade (for testing)
3. **5m markets only** — Designed for BTC 5-min cycles (can expand)
4. **Polygon-only** — Polymarket currently on Polygon (not Base)

---

## 🔗 Related Projects

- **Clawdex API** (`my-apps/`) — x402 monetization, separate API service
- **Bankr** — Portfolio tracking, automated Base trading
- **CS Skin Trading** — Different market (CS:GO items on Steam)

---

## 📝 Summary

**rPoly is production-ready for v2.1.0.**

What it does:
- ✅ Real-time Polymarket BTC trading dashboard
- ✅ Live price + order flow visualization
- ✅ Full portfolio tracking
- ✅ CLOB trading (gasless via Gnosis Safe)
- ✅ Auth-protected + read-only modes

What's next:
- 🔄 v2.2: Autonomous trading bot
- 📈 v2.3: Advanced strategies
- 🌍 v3.0: Multi-market + x402 integration

---

**Status:** OPERATIONAL | Next Focus: Autonomous Trade Bot (v2.2)

*Last Updated: Feb 16, 2026*
