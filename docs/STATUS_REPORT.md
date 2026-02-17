# rPoly — Current Status & Complete Overview

## What is rPoly? (Feb 17, 2026)

**rPoly** is a real-time Polymarket BTC 5-minute trading system. It consists of:
1. **Dashboard** — Live monitoring of BTC price, portfolio, markets, activity
2. **Trading Terminal** — Execute trades manually or watch the bot trade (spectator mode)
3. **Data Lab** — Collect and analyze market data for strategy development
4. **Hub** — Public landing page

The next milestone is **v3.0 — Autonomous Trading Agent** that will trade 5m BTC markets automatically.

---

## Version: v2.5.0 (CURRENT)

### All Pages

| Page | URL | File | Purpose |
|------|-----|------|---------|
| Dashboard | `/` | `public/index.html` | Main monitoring dashboard |
| Trading Terminal | `/trade` | `public/trade.html` | Trade execution + spectator view |
| Data Lab | `/learn` | `public/learn.html` | Internal data collection & analytics |
| Hub | `/hub` | `public/hub.html` | Public landing page |

### All API Endpoints

**Public (no auth required):**

| Method | Endpoint | Returns |
|--------|----------|---------|
| GET | `/health` | `{ status: "ok" }` |
| GET | `/api/dashboard` | `{ btc, signal, balances, market, orderbook }` |
| GET | `/api/markets/5m` | `[{ question, endDate, priceToBeat, upTokenId, ... }]` |
| GET | `/api/chart?interval=1m` | `[[time, open, high, low, close], ...]` from Binance |
| GET | `/api/profile` | `{ name, image, joined, stats, positions, activity, ... }` |
| GET | `/api/open-orders` | `[{ id, side, price, size, status, ... }]` |
| GET | `/api/trade-log` | `[{ action, side, size, price, market, ts, ... }]` |
| GET | `/api/bot-messages` | `[{ text, ts }]` |
| GET | `/api/learn/status` | Data collector status |
| GET | `/api/learn/odds-history` | Odds snapshots from today |
| GET | `/api/learn/whales` | Whale positions from today |
| GET | `/api/learn/global-trades` | Global trade feed from today |
| GET | `/api/learn/patterns` | Detected patterns from analysis |
| GET | `/api/learn/trades` | Raw trades data |

**Protected (require `Authorization: Bearer RPOLY_AUTH_TOKEN`):**

| Method | Endpoint | Body | Action |
|--------|----------|------|--------|
| POST | `/api/auth` | — | Verify token validity, returns `{ ok: true }` |
| POST | `/api/trade` | `{ market, outcome, size, price? }` | BUY tokens |
| POST | `/api/sell` | `{ market, outcome, size, price? }` | SELL tokens (market sell) |
| POST | `/api/sell-limit` | `{ market, outcome, size, price }` | Limit sell (take-profit/stop-loss) |
| POST | `/api/cancel-order/:id` | — | Cancel specific order |
| POST | `/api/cancel-all` | — | Cancel all open orders |
| POST | `/api/bot-message` | `{ text }` | Post ClawBot message |

### Dashboard Features

- **BTC/USD Card**: Live price, TradingView candles (default 1m), $BTC PRICE label (green)
- **Portfolio Card**: Cash amount (large, centered), proxy address (copyable, green, dimmed), positions value/volume, realized/unrealized P/L
- **Profile Card**: Identicon avatar (generated from username), Win Rate, Record (e.g. "3W / 2L"), Best Trade, Total P/L, markets traded count, open positions count
- **Activity Feed**: Full on-chain history (TRADE, REDEEM, SPLIT, MERGE, REWARD)
- **Market Analysis**: Signal gauge, sentiment indicator, orderbook depth visualization
- **Sparkline Chart**: Real-time BTC ticks via RTDS WebSocket + floating CLOB trade bubbles
- **5m Markets Table**: Market | Price to Beat | End Time (UTC/PL) | Countdown | UP/DOWN bars | Volume | Status

### Trading Terminal Features

- **Dual Mode**: Authenticated = full trading controls, Visitor = read-only spectator
- **Active Market**: Question, countdown, progress bar, UP/DOWN prices, volume, liquidity
- **Price to Beat vs BTC Now**: Reference price at market start vs current BTC, with difference + arrow
- **Trade Controls** (auth-only): Side selector (UP/DOWN), size input, price input, BUY/SELL buttons
- **Take-Profit Setter** (auth-only): Set limit sell at target price
- **Active Positions** (auth-only controls, visible to all): List with P/L + "Sell Now" button
- **Open Orders** (auth-only controls, visible to all): List with per-order cancel + "Cancel All"
- **Trade Log**: Merged history of bot trades + on-chain activity, with "BOT" badges
- **ClawBot Ticker**: Live scrolling messages from the bot
- **ClawBot Feed**: Full history of all bot messages
- **Portfolio Summary**: Cash, positions value, P/L today

### Data Lab Features

- **Background Collector** (runs on server.js every 60s):
  - Odds snapshots → `trades/odds-YYYY-MM-DD.json`
  - Global trades → `trades/global-YYYY-MM-DD.json`
  - Whale positions → `trades/whales-YYYY-MM-DD.json`
  - Pattern analysis → `trades/patterns.json`
- **Charts**: Odds history visualization
- **Tables**: Global trades feed, whale positions tracker

---

## Wallet Architecture

```
MetaMask EOA (signer)
  0x7Ca66FFAF6A5D4DE8492c97c61753B699350AD77
  └─ Controls 1-of-1 Gnosis Safe:
      0xA95Bf3B311D596e78369a016B113D0E4e662ECb1 (Polymarket proxy)
      └─ signatureType=2 → gasless CLOB trades, no approve, no MATIC needed
```

**How CLOB Trading Works:**
1. EOA signs order using private key
2. CLOB client creates order with `signatureType: 2` (Gnosis Safe)
3. Polymarket sponsors gas → order is placed for free
4. Proxy wallet (Gnosis Safe) holds all USDC funds and positions
5. `feeRateBps: 1000` (10% taker fee on 5m markets)
6. Minimum order: 5 shares on BTC 5m markets

---

## How 5-Minute BTC Markets Work

### Market Lifecycle
1. **Created**: Polymarket creates market e.g. "BTC 9:35PM-9:40PM ET"
2. **eventStartTime**: Start of the 5-min window (e.g. 9:35:00 PM ET)
3. **endDate**: End of the 5-min window (e.g. 9:40:00 PM ET)
4. **Resolution**: After endDate, market resolves UP or DOWN

### Price to Beat
- At `eventStartTime`, BTC has a reference price
- Fetched from Binance klines: `GET /api/v3/klines?symbol=BTCUSDT&interval=1m&startTime={eventStartTime}&limit=1`
- Take `data[0][1]` (open price of the candle at that timestamp)
- If BTC closes ABOVE this price after 5 min → **UP wins** ($1.00 per share)
- If BTC closes BELOW this price after 5 min → **DOWN wins** ($1.00 per share)

### Trading Options
1. **Buy and hold**: Buy UP or DOWN, wait for resolution. Win = $1.00/share, Lose = $0.00/share
2. **Early exit**: Sell your tokens BEFORE market closes if price moves in your favor
3. **Limit sell**: Set a take-profit price, order executes when token reaches that price
4. **Cancel**: Cancel unfilled orders at any time

### Claiming Winnings (IMPORTANT)
Winning tokens do **NOT** automatically convert to USDC. After resolution:
- Tokens are worth $1.00 but still sit as ERC1155 tokens on Polygon
- **AUTO-REDEEM IS NOT IMPLEMENTED** — tried Builder Relayer and direct Safe execTransaction, both unreliable
- **Current strategy: SELL 30 seconds before market close** (bot rule #1)
- Accept losing 1-5 cents per share to avoid on-chain complexity
- **If bot fails to sell before close**: owner manually redeems at polymarket.com
- `GET /api/redeemable` shows pending claims (read-only, always works)
- `POST /api/redeem` is a stub that returns instructions for manual redeem
- See `TRADING_GUIDE.md` for full bot rules

### Key Fields from Gamma API
```json
{
  "question": "Will the price of Bitcoin be higher...",
  "clobTokenIds": ["upTokenId", "downTokenId"],
  "outcomePrices": "[0.52, 0.48]",
  "endDate": "2026-02-17T21:40:00Z",
  "eventStartTime": "2026-02-17T21:35:00Z",
  "volume": "18234.50",
  "liquidity": "3102.80",
  "negRisk": true
}
```

---

## Data Files (trades/ directory)

| File | Content | Format | Updated |
|------|---------|--------|---------|
| `odds-YYYY-MM-DD.json` | Odds snapshots per market | `[{ts, market, up, down}]` | Every 60s |
| `global-YYYY-MM-DD.json` | All trades on BTC 5m markets | `[{ts, side, price, size, market}]` | Every 60s |
| `whales-YYYY-MM-DD.json` | Top 20 holders per market | `[{ts, market, holders:[]}]` | Every 60s |
| `patterns.json` | Detected patterns (rolling) | `[{type, confidence, ts, ...}]` | Every 60s |
| `bot-messages.json` | ClawBot message feed | `[{text, ts}]` (last 50) | On bot action |
| `trade-log.json` | Bot trade history | `[{action, side, size, price, market, ts}]` (last 100) | On trade |

**NOTE**: All `trades/*.json` files are gitignored. They are local data only.

---

## Authentication Flow

### For Trading Terminal
1. Owner opens `/trade#token=RPOLY_AUTH_TOKEN`
2. JavaScript extracts token from URL hash
3. Token stored in `localStorage` as `rpoly_auth`
4. Frontend calls `POST /api/auth` with `Authorization: Bearer <token>`
5. If verified → `document.body.classList.add('authenticated')` → trade controls visible
6. If not → spectator mode (read-only)

### For API Calls
- All protected endpoints require `Authorization: Bearer RPOLY_AUTH_TOKEN` header
- Middleware `requireAuth` checks the token
- Failed auth returns `401 Unauthorized`

---

## Deployment

### Local (live trading)
```bash
RPOLY_MODE=live node server.js
# → http://localhost:3001
# → Trading enabled, data collector running
```

### Vercel (readonly, public)
```bash
# vercel.json routes all pages + API through server.js
vercel deploy
# RPOLY_MODE=readonly → no trading, dashboard + spectator only
```

### Vercel Config
```json
{
  "builds": [
    { "src": "server.js", "use": "@vercel/node" },
    { "src": "public/index.html", "use": "@vercel/static" },
    { "src": "public/trade.html", "use": "@vercel/static" },
    { "src": "public/learn.html", "use": "@vercel/static" },
    { "src": "public/hub.html", "use": "@vercel/static" }
  ],
  "routes": [
    { "src": "/trade", "dest": "/public/trade.html" },
    { "src": "/learn", "dest": "/public/learn.html" },
    { "src": "/hub", "dest": "/public/hub.html" },
    { "src": "/api/(.*)", "dest": "/server.js" },
    { "src": "/(.*)", "dest": "/public/$1" }
  ]
}
```

---

## Next Goal: v3.0 — Autonomous Trading Agent

The autonomous agent will:
1. **Every 5 minutes**: Detect new BTC 5m market
2. **Fetch data**: Price to Beat, current BTC, odds, Data Lab patterns
3. **Analyze**: Apply strategy (fade, momentum, pattern-based)
4. **Decide**: Trade or skip (with confidence score)
5. **Execute**: Place BUY via `/api/trade`
6. **Monitor**: Watch position P/L, apply auto-exit rules
7. **Log**: Record every decision via `/api/bot-message` + trade log
8. **Learn**: Review results, adjust strategy parameters

See `TRADING_GUIDE.md` for detailed strategy documentation.

---

*Last Updated: Feb 17, 2026*
