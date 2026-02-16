# rPoly - Tools & API Reference

## External APIs

### Polymarket Gamma API
Base: `https://gamma-api.polymarket.com`

| Endpoint | Usage |
|----------|-------|
| `GET /markets?slug=btc-updown-5m-{ts}` | Fetch specific 5m market by slot timestamp |
| `GET /markets?active=true&closed=false` | List all active markets |
| `GET /public-profile?address={addr}` | User profile (name, bio, joined date) |

### Polymarket Data API
Base: `https://data-api.polymarket.com`

| Endpoint | Usage |
|----------|-------|
| `GET /positions?user={addr}` | Open positions with P/L (cashPnl, percentPnl) |
| `GET /closed-positions?user={addr}` | Closed positions with realizedPnl |
| `GET /value?user={addr}` | Total value of all positions |
| `GET /traded?user={addr}` | Total number of markets traded |
| `GET /activity?user={addr}` | Full onchain activity (TRADE, REDEEM, SPLIT, MERGE, REWARD) |
| `GET /trades?user={addr}` | Trade history with prices and sizes |

### Polymarket CLOB API
Base: `https://clob.polymarket.com`

| Endpoint | Auth | Usage |
|----------|------|-------|
| `GET /book?token_id={id}` | No | Orderbook for a token |
| `GET /midpoint?token_id={id}` | No | Midpoint price |
| `POST /order` | L2 | Place order |
| `DELETE /order/{id}` | L2 | Cancel order |
| `DELETE /cancel-all` | L2 | Cancel all orders |
| `GET /orders` | L2 | Get open orders |

Auth: L2 requires `POLY-ADDRESS`, `POLY-SIGNATURE`, `POLY-TIMESTAMP`, `POLY-NONCE` headers derived from API key/secret/passphrase.

Trading config: `signatureType=2` (Gnosis Safe), `feeRateBps=1000`, min 5 shares on BTC 5m.

### Polymarket RTDS WebSocket
URL: `wss://ws-live-data.polymarket.com`

```javascript
// Subscribe to crypto prices
ws.send(JSON.stringify({
  action: 'subscribe',
  subscriptions: [{ topic: 'crypto_prices', type: 'update' }],
}));

// Receive btcusdt ticks
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

Pushes events when user's orders are filled, cancelled, etc. Not yet implemented - planned for v2.2.0.

### Binance API
Base: `https://api.binance.com` (no auth required)

| Endpoint | Usage |
|----------|-------|
| `GET /api/v3/klines?symbol=BTCUSDT&interval={iv}&limit={n}` | Candlestick data |
| `GET /api/v3/ticker/24hr?symbol=BTCUSDT` | 24h price + change % |

Intervals used: `1s` (300 candles), `1m` (120), `5m` (96), `15m` (96)

### Polygon RPC
URL: `https://polygon-rpc.com` (public, no auth)

Used for on-chain balance queries:
- USDC contract: `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174`
- Calls: `balanceOf(address)` for USDC (6 decimals) and native MATIC

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
├── server.js           # Express backend (all API endpoints)
├── index.html          # Full dashboard (single page app)
├── markets.html        # Redirect to / (legacy)
├── package.json        # Dependencies
├── .env                # Credentials (never commit!)
├── .env.example        # Template for env vars
├── .gitignore          # Excludes .env, credentials, sensitive scripts
├── vercel.json         # Vercel deployment config
├── ARCHITECTURE.md     # System architecture diagram
├── DEVELOPMENT_PLAN.md # Version roadmap
├── TOOLS.md            # This file - API reference
└── README.md           # Quick start guide
```

---

*Last Updated: 2026-02-16*
