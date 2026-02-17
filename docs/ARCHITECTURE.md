# rPoly - Architecture

## Overview

rPoly is a real-time Polymarket BTC 5-minute trading system with:
- **Dashboard** (`/`) — live monitoring, portfolio, market analysis
- **Trading Terminal** (`/trade`) — dual-mode: owner controls + spectator view
- **Data Lab** (`/learn`) — internal data collection & analysis
- **Hub** (`/hub`) — public landing page for future API/agent services

Built for the Clawdex ecosystem. Deployed on Vercel (readonly) + localhost (live trading).

## System Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│                        FRONTEND PAGES                             │
├───────────────────────────────────────────────────────────────────┤
│                                                                   │
│  / (index.html) — Dashboard                                      │
│    ├─ BTC/USD live price + TradingView candles (1s/1m/5m)        │
│    ├─ Portfolio (cash, positions, volume, P/L)                    │
│    ├─ Profile (identicon avatar, win rate, record, best trade)   │
│    ├─ Activity feed (TRADE, REDEEM, SPLIT events)                │
│    ├─ Market Analysis (signal gauge, sentiment, orderbook depth) │
│    ├─ BTC/USD sparkline + live CLOB trade bubbles                │
│    └─ 5m Markets table (Price to Beat, countdown, UP/DOWN bars)  │
│                                                                   │
│  /trade (trade.html) — Trading Terminal                           │
│    ├─ ClawBot message ticker (live feed from bot)                │
│    ├─ Active market + countdown bar + Price to Beat vs BTC Now   │
│    ├─ BUY/SELL panel (side, size, price) [auth-only]             │
│    ├─ Take-Profit / Stop-Loss setter [auth-only]                 │
│    ├─ Active positions + "Sell Now" buttons [auth-only]          │
│    ├─ Open orders + per-order cancel [auth-only]                 │
│    ├─ Trade log (bot actions + on-chain activity merged)         │
│    ├─ Portfolio summary (cash, positions, P/L)                   │
│    └─ ClawBot feed history                                       │
│    MODE: authenticated = full controls, visitor = spectator       │
│                                                                   │
│  /learn (learn.html) — Data Lab [internal]                       │
│    ├─ Collector status (running/stopped, stats)                  │
│    ├─ Odds history chart                                          │
│    ├─ Global trades feed                                          │
│    ├─ Whale positions tracker                                     │
│    └─ Pattern analysis                                            │
│                                                                   │
│  /hub (hub.html) — Public Landing Page                           │
│    ├─ Hero section (rPoly Intelligence Hub)                      │
│    ├─ Live data demo                                              │
│    ├─ API documentation preview                                   │
│    ├─ Strategy preview                                            │
│    └─ Agent access info                                           │
│                                                                   │
├───────────────────────────────────────────────────────────────────┤
│  Frontend WebSockets (browser):                                   │
│  • RTDS WS → wss://ws-live-data.polymarket.com                   │
│    └─ Real-time BTC price ticks → sparkline + price display      │
│  • CLOB WS → wss://ws-subscriptions-clob.polymarket.com/ws/mkt  │
│    └─ Live orders/trades → floating bubbles on chart             │
├───────────────────────────────────────────────────────────────────┤
│  Frontend Polling:                                                │
│  • /api/dashboard    (10-15s) → balances, signal, orderbook      │
│  • /api/markets/5m   (30s)    → markets table + priceToBeat      │
│  • /api/profile      (60s)    → stats, P/L, activity feed        │
│  • /api/chart        (var)    → candlestick data (Binance)       │
│  • /api/open-orders  (10s)    → live open orders                 │
│  • /api/trade-log    (10s)    → bot trade history                │
│  • /api/bot-messages (8s)     → ClawBot message feed             │
│  • Clock             (1s)     → UTC + PL time in header          │
│  • Countdowns        (1s)     → market end time countdowns       │
└───────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌───────────────────────────────────────────────────────────────────┐
│                     rPoly Server (server.js)                      │
│                      Node.js + Express                            │
├───────────────────────────────────────────────────────────────────┤
│  Public Endpoints:                                                │
│  • GET  /health               → health check + version           │
│  • GET  /api/dashboard        → balances + market + signal + OB  │
│  • GET  /api/markets/5m       → markets list + priceToBeat       │
│  • GET  /api/chart?interval=  → Binance candles (1s/1m/5m/15m)  │
│  • GET  /api/profile          → full stats from Data API         │
│  • GET  /api/open-orders      → list of open CLOB orders        │
│  • GET  /api/trade-log        → persistent bot trade history     │
│  • GET  /api/bot-messages     → ClawBot message feed             │
│  • POST /api/auth             → verify auth token                │
│                                                                   │
│  Protected Endpoints (require RPOLY_AUTH_TOKEN):                  │
│  • POST /api/trade            → BUY tokens (UP or DOWN)         │
│  • POST /api/sell             → SELL tokens (market sell)        │
│  • POST /api/sell-limit       → limit sell (take-profit/SL)     │
│  • POST /api/cancel-order/:id → cancel specific order            │
│  • POST /api/cancel-all       → cancel all open orders           │
│  • POST /api/bot-message      → post ClawBot message             │
│                                                                   │
│  Data Lab Endpoints (public, read-only):                         │
│  • GET  /api/learn/status         → collector status             │
│  • GET  /api/learn/odds-history   → odds snapshots               │
│  • GET  /api/learn/whales         → whale positions              │
│  • GET  /api/learn/global-trades  → global trade feed            │
│  • GET  /api/learn/patterns       → detected patterns            │
│  • GET  /api/learn/trades         → raw trades data              │
│                                                                   │
│  Background Services:                                             │
│  • Data Collector (every 60s) → odds, trades, whales, patterns  │
│  • Trade Logger → persists all BUY/SELL actions to JSON          │
│  • Bot Messages → stores ClawBot feed messages                   │
├───────────────────────────────────────────────────────────────────┤
│  Modes:                                                           │
│  • RPOLY_MODE=live     → full trading + auth required            │
│  • RPOLY_MODE=readonly → dashboard only, no trading              │
└───────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌───────────────────────────────────────────────────────────────────┐
│                 External APIs & Data Sources                      │
├───────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Polymarket Gamma API (https://gamma-api.polymarket.com)         │
│  ├─ GET /markets?slug=btc-updown-5m-{ts} → 5m market data       │
│  │   Returns: question, clobTokenIds, outcomePrices, endDate,    │
│  │            eventStartTime, negRisk, volume, liquidity         │
│  └─ GET /public-profile?address=         → user profile          │
│                                                                   │
│  Polymarket Data API (https://data-api.polymarket.com)           │
│  ├─ GET /positions?user=       → open positions + P/L            │
│  ├─ GET /closed-positions      → closed positions + realized P/L │
│  ├─ GET /value?user=           → total positions value           │
│  ├─ GET /traded?user=          → total markets traded count      │
│  ├─ GET /activity?user=        → full onchain activity log       │
│  ├─ GET /holders?market=       → top 20 holders of a market     │
│  └─ GET /trades?market=        → recent trades on a market      │
│                                                                   │
│  Polymarket CLOB API (https://clob.polymarket.com)               │
│  ├─ POST /order     → place order (BUY/SELL, GTC/GTD/FOK)      │
│  ├─ DELETE /order    → cancel single order                       │
│  ├─ DELETE /cancel-all → cancel all orders                       │
│  ├─ GET /orders      → get open orders                           │
│  ├─ GET /book        → orderbook for a token                     │
│  ├─ GET /midpoint    → midpoint price                            │
│  ├─ GET /spread      → bid-ask spread                            │
│  └─ GET /price       → current price for a token                 │
│                                                                   │
│  Polymarket WebSockets:                                           │
│  ├─ RTDS (wss://ws-live-data.polymarket.com)                     │
│  │   └─ crypto_prices topic → real-time BTC/USD ticks           │
│  ├─ CLOB Market (wss://ws-subscriptions-clob.../ws/market)      │
│  │   ├─ last_trade_price → matched trades                       │
│  │   └─ price_change     → new orders/cancels                   │
│  └─ CLOB User (wss://ws-subscriptions-clob.../ws/user) [TODO]  │
│      └─ Push notifications for order fills/cancels               │
│                                                                   │
│  Binance API (https://api.binance.com) [no auth]                │
│  ├─ GET /api/v3/klines        → candlestick chart data          │
│  │   Used for: chart display + priceToBeat calculation           │
│  └─ GET /api/v3/ticker/24hr   → BTC 24h price + change %       │
│                                                                   │
│  Polygon RPC (https://polygon-bor-rpc.publicnode.com)            │
│  └─ balanceOf() calls         → USDC + MATIC balances           │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

## Wallet Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  MetaMask EOA (signer)                                            │
│  Address: 0x7Ca66FFAF6A5D4DE8492C97c61753B699350AD77              │
│  Role: Signs transactions and orders                              │
│  Balance: ~$1.98 USDC + MATIC on Polygon                         │
└──────────────────────┬───────────────────────────────────────────┘
                       │ controls (1-of-1 Gnosis Safe)
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│  Polymarket Gnosis Safe (funder/maker)                            │
│  Address: 0xA95Bf3B311D596e78369a016B113D0E4e662ECb1              │
│  Role: Holds trading funds, acts as maker in orders               │
│  Type: Gnosis Safe 1-of-1 multisig (MetaMask login)              │
│  signatureType=2 → gasless CLOB trades, no approve needed        │
└──────────────────────────────────────────────────────────────────┘
```

## File Structure

```
rpoly/
├── server.js              # Express backend (~1000 lines)
├── package.json           # Dependencies
├── vercel.json            # Vercel deployment config
├── .env                   # Credentials (NEVER commit!)
├── .gitignore             # Excludes secrets + trades data
├── public/
│   ├── index.html         # Dashboard (main page)
│   ├── trade.html         # Trading Terminal (auth/spectator)
│   ├── learn.html         # Data Lab (internal)
│   ├── hub.html           # Public landing page
│   └── markets.html       # Redirect to /
├── docs/
│   ├── ARCHITECTURE.md    # This file
│   ├── DEVELOPMENT_PLAN.md
│   ├── STATUS_REPORT.md
│   ├── TOOLS.md
│   └── TRADING_GUIDE.md
├── trades/                # Local data (gitignored except README)
│   ├── README.md
│   ├── odds-YYYY-MM-DD.json
│   ├── global-YYYY-MM-DD.json
│   ├── whales-YYYY-MM-DD.json
│   ├── patterns.json
│   ├── bot-messages.json
│   └── trade-log.json
└── scripts/               # Utility scripts (gitignored)
```

## Security

- All credentials in `.env` (never committed)
- `RPOLY_AUTH_TOKEN` protects trade/sell/cancel/bot-message endpoints
- `RPOLY_MODE=readonly` disables all trading for public Vercel deploy
- Trading Terminal uses `/api/auth` to verify token before showing controls
- Token passed via URL hash (`/trade#token=...`), stored in `localStorage`
- Spectators see read-only view (positions, orders, trades) but no action buttons
- `.gitignore` excludes `.env`, `credentials.json`, `trades/*.json`, sensitive scripts

## Environment Variables

Required in `.env`:
```
POLY_PRIVATE_KEY=0x...             # EOA private key (for signing)
POLY_PROXY_ADDRESS=0x...           # Gnosis Safe address
POLY_API_KEY=...                   # CLOB L2 API key
POLY_API_SECRET=...                # CLOB L2 API secret
POLY_API_PASSPHRASE=...            # CLOB L2 passphrase
RPOLY_AUTH_TOKEN=...               # Auth token for protected endpoints
RPOLY_MODE=live                    # "live" or "readonly"
PORT=3001                          # Server port (optional)
```

## Key Concepts

### Price to Beat
Each 5-minute BTC market has an `eventStartTime`. The BTC price (from Binance klines) at that moment is the "price to beat". If BTC ends above it, UP wins ($1.00). If below, DOWN wins ($1.00). This is fetched from Binance `GET /api/v3/klines` using the `eventStartTime` as `startTime` and taking the open price (`data[0][1]`).

### Trading Flow
1. `findActive5mMarket()` → gets current market from Gamma API
2. Market has `upTokenId` and `downTokenId` (ERC1155 tokens)
3. BUY: `createAndPostOrder({ tokenID, price, side:"BUY", size })` 
4. SELL: `createAndPostOrder({ tokenID, price, side:"SELL", size })`
5. All orders use `signatureType=2` (Gnosis Safe), `feeRateBps=1000`
6. 5m markets have taker fees enabled

### Early Exit
You do NOT have to wait for market resolution. You can SELL your tokens at any time before the market closes. Sell at the best bid price for instant exit, or set a limit sell for a target price.

---

*Last Updated: 2026-02-17*
