# rPoly - Tools & API Reference

## External APIs

### Polymarket Gamma API
Base: `https://gamma-api.polymarket.com`

| Endpoint | Usage | Returns |
|----------|-------|---------|
| `GET /markets?slug=btc-updown-5m-{ts}` | Fetch specific 5m market by slot timestamp | Market with clobTokenIds, outcomePrices, endDate, eventStartTime, volume, liquidity |
| `GET /markets?active=true&closed=false` | List all active markets | Array of markets |
| `GET /public-profile?address={addr}` | User profile | name, bio, joined date, image |

**Key fields in a 5m market response:**
```json
{
  "id": "...",
  "question": "Will the price of Bitcoin be higher at 9:40 PM ET on February 17, 2026, than at 9:35 PM ET?",
  "slug": "btc-updown-5m-1771373700",
  "clobTokenIds": ["upTokenId", "downTokenId"],
  "outcomePrices": "[\"0.52\",\"0.48\"]",
  "endDate": "2026-02-17T21:40:00Z",
  "eventStartTime": "2026-02-17T21:35:00Z",
  "volume": "18234.50",
  "liquidity": "3102.80",
  "negRisk": true,
  "active": true,
  "closed": false
}
```

**How to find the current active 5m market (findActive5mMarket logic):**
1. Get current UTC time
2. Calculate 5-min slot: `slot = Math.floor(now / 300000) * 300`
3. Build slug: `btc-updown-5m-${slot}`
4. Fetch `GET /markets?slug=${slug}`
5. If no result, try `slot - 300` (previous slot)
6. From response, extract `clobTokenIds[0]` (UP) and `clobTokenIds[1]` (DOWN)
7. If `eventStartTime` is in the past, fetch "Price to Beat" from Binance klines

### Polymarket Data API
Base: `https://data-api.polymarket.com`

| Endpoint | Usage | Returns |
|----------|-------|---------|
| `GET /positions?user={proxy}` | Open positions with P/L | `[{ market, outcome, size, avgPrice, curPrice, cashPnl, percentPnl }]` |
| `GET /closed-positions?user={proxy}` | Closed positions | `[{ market, outcome, realizedPnl, ... }]` |
| `GET /value?user={proxy}` | Total positions value | `{ value: "12.50" }` |
| `GET /traded?user={proxy}` | Markets traded count | `{ count: 6 }` |
| `GET /activity?user={proxy}` | Full onchain activity | `[{ type, side, size, price, market, timestamp }]` |
| `GET /trades?market={conditionId}` | Recent trades on market | `[{ side, price, size, timestamp }]` |
| `GET /holders?market={conditionId}` | Top 20 holders | `[{ address, size, avgPrice, ... }]` |

**Note:** Use the **proxy address** (Gnosis Safe) for `user=`, not the EOA.

### Polymarket CLOB API
Base: `https://clob.polymarket.com`

| Endpoint | Auth | Usage | Notes |
|----------|------|-------|-------|
| `GET /book?token_id={id}` | No | Orderbook for a token | Returns bids[] and asks[] |
| `GET /midpoint?token_id={id}` | No | Midpoint price | Returns `{ mid: "0.52" }` |
| `GET /spread?token_id={id}` | No | Bid-ask spread | Returns spread and best bid/ask |
| `GET /price?token_id={id}&side=BUY` | No | Current price for side | Quote for buy/sell |
| `POST /order` | L2 | Place order | See trading section below |
| `DELETE /order/{id}` | L2 | Cancel specific order | Returns cancelled order |
| `DELETE /cancel-all` | L2 | Cancel all open orders | Returns cancelled count |
| `GET /orders` | L2 | Get open orders | Returns array of orders |

**L2 Auth headers:**
```
POLY-ADDRESS: <proxy_address>
POLY-SIGNATURE: <derived_from_api_secret>
POLY-TIMESTAMP: <unix_seconds>
POLY-NONCE: <random>
```
Derived using `@polymarket/clob-client` library automatically.

**Trading via clob-client:**
```javascript
const { ClobClient } = require("@polymarket/clob-client");

const client = new ClobClient("https://clob.polymarket.com", 137, signer, {
  key: POLY_API_KEY,
  secret: POLY_API_SECRET,
  passphrase: POLY_API_PASSPHRASE,
});

// BUY order
const order = await client.createAndPostOrder({
  tokenID: "up_or_down_token_id",
  price: 0.52,          // price per share ($0.01-$0.99)
  side: "BUY",           // "BUY" or "SELL"
  size: 5,               // number of shares (min 5 for BTC 5m)
  feeRateBps: 1000,      // 10% taker fee
  nonce: 0,
  expiration: 0,         // 0 = no expiration (GTC)
});

// SELL existing position (market sell at best bid)
const sell = await client.createAndPostOrder({
  tokenID: "token_id_you_hold",
  price: bestBidPrice,   // get from orderbook
  side: "SELL",
  size: sharesYouHold,
  feeRateBps: 1000,
  nonce: 0,
  expiration: 0,
});

// Get orderbook
const book = await client.getOrderBook("token_id");
// book.bids[0].price → best bid price (for selling)
// book.asks[0].price → best ask price (for buying)

// Cancel all orders
await client.cancelAll();

// Cancel specific order
await client.cancelOrder({ id: "order_id" });

// Get open orders
const orders = await client.getOpenOrders();
```

**Key Trading Config:**
- `signatureType: 2` — Gnosis Safe user (gasless)
- `feeRateBps: 1000` — 10% taker fee on 5m markets
- Min order: 5 shares for BTC 5m
- Order types: GTC (good-til-cancelled), GTD (good-til-date), FOK (fill-or-kill)

### Polymarket RTDS WebSocket
URL: `wss://ws-live-data.polymarket.com`

```javascript
// Subscribe to crypto prices
ws.send(JSON.stringify({
  action: 'subscribe',
  subscriptions: [{ topic: 'crypto_prices', type: 'update' }],
}));

// Receive btcusdt ticks (every ~1s)
// { payload: { symbol: 'btcusdt', value: 67834.5, timestamp: 1771256903000 } }
```

### Polymarket CLOB WebSocket (Market Channel)
URL: `wss://ws-subscriptions-clob.polymarket.com/ws/market`

```javascript
// Subscribe to market's token IDs
ws.send(JSON.stringify({
  assets_ids: ['token_id_up', 'token_id_down'],
  type: 'MARKET',
}));
```

| Event | When | Data |
|-------|------|------|
| `last_trade_price` | Trade matched | side, price, size, asset_id |
| `price_change` | Order placed/cancelled | price, size, side, best_bid, best_ask |
| `book` | Trade affects book | full orderbook snapshot |
| `tick_size_change` | Price at extremes | old/new tick size |

### Polymarket CLOB WebSocket (User Channel)
URL: `wss://ws-subscriptions-clob.polymarket.com/ws/user`
Auth: Required (L2 credentials)

Pushes events when user's orders are filled, cancelled, etc. **Not yet implemented — planned for v3.0.**

### Binance API
Base: `https://api.binance.com` (no auth required)

| Endpoint | Usage |
|----------|-------|
| `GET /api/v3/klines?symbol=BTCUSDT&interval={iv}&limit={n}` | Candlestick data |
| `GET /api/v3/ticker/24hr?symbol=BTCUSDT` | 24h price + change % |

**Intervals used:** `1s` (300 candles), `1m` (120), `5m` (96), `15m` (96)

**Price to Beat fetch:**
```javascript
// Get BTC open price at eventStartTime
const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&startTime=${eventStartTimeMs}&limit=1`;
const res = await axios.get(url, { timeout: 5000 });
const priceToBeat = parseFloat(res.data[0][1]); // [0][1] = open price
```

### Polygon RPC
URL: `https://polygon-bor-rpc.publicnode.com` (public, no auth)

Used for on-chain balance queries:
- USDC contract: `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` (6 decimals)
- Calls: `balanceOf(address)` for USDC and native MATIC

---

## Internal rPoly API Endpoints

### Dashboard API (`GET /api/dashboard`)
```json
{
  "btc": { "price": 68914.31, "change24h": -0.33 },
  "signal": { "label": "NEUTRAL", "strength": 0.5 },
  "balances": {
    "proxy": { "usdc": "10.90", "matic": "0.001" },
    "eoa": { "usdc": "1.98", "matic": "0.0007" }
  },
  "market": {
    "question": "Will BTC be higher...",
    "upTokenId": "...", "downTokenId": "...",
    "upPrice": "0.52", "downPrice": "0.48",
    "endDate": "2026-02-17T21:40:00Z",
    "priceToBeat": 68029.36,
    "volume": "18234", "liquidity": "3102"
  },
  "orderbook": { "bids": [...], "asks": [...] },
  "positions": [...]
}
```

### Trade API (`POST /api/trade`)
```json
// Request:
{ "market": "conditionId", "outcome": "YES|NO", "size": "5", "price": "0.52" }
// YES = UP token, NO = DOWN token
// If price omitted → uses current midpoint

// Response:
{ "success": true, "order": {...} }
```

### Sell API (`POST /api/sell`)
```json
// Request:
{ "market": "conditionId", "outcome": "YES|NO", "size": "5" }
// Sells at best bid (market sell)

// Response:
{ "success": true, "order": {...} }
```

### Sell Limit API (`POST /api/sell-limit`)
```json
// Request:
{ "market": "conditionId", "outcome": "YES|NO", "size": "5", "price": "0.65" }
// Places limit sell at specified price

// Response:
{ "success": true, "order": {...} }
```

---

## Frontend Libraries

| Library | Version | Usage |
|---------|---------|-------|
| TradingView Lightweight Charts | 5.1.0 | Mini candlestick chart in BTC card |
| JetBrains Mono (Google Fonts) | latest | Monospace font for entire UI |

## Server Dependencies

| Package | Usage |
|---------|-------|
| `express` | HTTP server |
| `axios` | HTTP client for API calls |
| `dotenv` | Environment variable loading |
| `ethers` | Polygon RPC calls (balance queries) |
| `@polymarket/clob-client` | CLOB trading (order placement, cancellation) |

## File Structure

```
rpoly/
├── server.js              # Express backend + data collector (~1000 lines)
├── package.json           # Dependencies
├── vercel.json            # Vercel deployment config
├── .env                   # Credentials (never commit!)
├── .env.example           # Template for env vars
├── .gitignore             # Excludes .env, trades data, sensitive scripts
├── public/
│   ├── index.html         # Dashboard (live price, portfolio, markets, activity)
│   ├── trade.html         # Trading Terminal (auth/spectator dual mode)
│   ├── learn.html         # Data Lab (data collection & analytics)
│   ├── hub.html           # Public landing page
│   └── markets.html       # Legacy redirect to /
├── docs/
│   ├── ARCHITECTURE.md    # System architecture diagram & file structure
│   ├── DEVELOPMENT_PLAN.md # Version roadmap & milestones
│   ├── STATUS_REPORT.md   # Current status overview
│   ├── TOOLS.md           # This file — full API reference
│   └── TRADING_GUIDE.md   # Trading strategies & guide for autonomous agent
├── trades/                # Local data storage (gitignored except README)
│   ├── README.md          # Data format documentation
│   ├── odds-YYYY-MM-DD.json
│   ├── global-YYYY-MM-DD.json
│   ├── whales-YYYY-MM-DD.json
│   ├── patterns.json
│   ├── bot-messages.json
│   └── trade-log.json
└── scripts/               # Utility scripts (gitignored)
```

---

*Last Updated: 2026-02-17*
