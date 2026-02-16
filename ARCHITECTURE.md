# rPoly - Architecture

## Overview

rPoly is a real-time Polymarket BTC 5-minute trading dashboard with live data streams, portfolio tracking, and CLOB trading integration. Built for the Clawdex ecosystem.

## System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                     rPoly Dashboard (index.html)                  │
│                      http://localhost:3001                         │
├──────────────────────────────────────────────────────────────────┤
│  Frontend WebSockets (browser):                                   │
│  • RTDS WS  → wss://ws-live-data.polymarket.com                  │
│    └─ Real-time BTC price ticks → sparkline chart + price display│
│  • CLOB WS  → wss://ws-subscriptions-clob.polymarket.com/ws/market│
│    └─ Live orders/trades → floating bubbles on chart              │
├──────────────────────────────────────────────────────────────────┤
│  Frontend Polling:                                                │
│  • /api/dashboard    (15s)  → balances, signal, orderbook        │
│  • /api/markets/5m   (30s)  → 5m markets table + countdowns     │
│  • /api/profile      (60s)  → stats, P/L, activity feed         │
│  • /api/chart        (var)  → candlestick data (Binance)        │
│  • Clock             (1s)   → UTC + PL time in header           │
│  • Countdowns        (1s)   → market end time countdowns        │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                     rPoly Server (server.js)                      │
│                      Node.js + Express                            │
├──────────────────────────────────────────────────────────────────┤
│  Public Endpoints:                                                │
│  • GET  /health              → health check                      │
│  • GET  /api/dashboard       → balances + market + signal + OB   │
│  • GET  /api/markets/5m      → 5m markets list + tokenIds        │
│  • GET  /api/chart?interval= → Binance candles (1s/1m/5m/15m)   │
│  • GET  /api/profile         → full stats from 6 Data API calls  │
│                                                                    │
│  Protected Endpoints (require RPOLY_AUTH_TOKEN):                  │
│  • POST /api/trade           → execute real CLOB trade           │
│  • POST /api/cancel-all      → cancel all open orders            │
│  • GET  /api/auth            → verify auth token                 │
├──────────────────────────────────────────────────────────────────┤
│  Modes:                                                           │
│  • RPOLY_MODE=live     → full trading + auth required            │
│  • RPOLY_MODE=readonly → dashboard only, no trading              │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                    External APIs & Data Sources                    │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│  Polymarket Gamma API (https://gamma-api.polymarket.com)          │
│  ├─ GET /markets?slug=btc-updown-5m-{ts}  → 5m market data      │
│  └─ GET /public-profile?address=           → user profile        │
│                                                                    │
│  Polymarket Data API (https://data-api.polymarket.com)            │
│  ├─ GET /positions?user=      → open positions + P/L             │
│  ├─ GET /closed-positions     → closed positions + realized P/L  │
│  ├─ GET /value?user=          → total positions value            │
│  ├─ GET /traded?user=         → total markets traded count       │
│  └─ GET /activity?user=       → full onchain activity log        │
│                                                                    │
│  Polymarket CLOB API (https://clob.polymarket.com)                │
│  ├─ Order placement (L2 auth, signatureType=2)                   │
│  ├─ Order cancellation                                            │
│  └─ Orderbook queries                                             │
│                                                                    │
│  Polymarket RTDS WebSocket (wss://ws-live-data.polymarket.com)    │
│  └─ crypto_prices topic → real-time BTC/USD ticks                │
│                                                                    │
│  Polymarket CLOB WebSocket (wss://ws-subscriptions-clob...market) │
│  ├─ last_trade_price → matched trades (bright bubbles)           │
│  └─ price_change     → new orders/cancels (dim bubbles)          │
│                                                                    │
│  Binance API (https://api.binance.com)                            │
│  ├─ GET /api/v3/klines       → candlestick chart data           │
│  └─ GET /api/v3/ticker/24hr  → BTC price fallback               │
│                                                                    │
│  Polygon RPC (https://polygon-rpc.com)                            │
│  └─ balanceOf() calls        → USDC + MATIC balances            │
│                                                                    │
└──────────────────────────────────────────────────────────────────┘
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

## Dashboard Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  rPoly_                 16:33:56 UTC | 17:33:56 PL      ● LIVE │
├──────────┬──────────┬──────────┬───────────────────────────────┤
│ BTC/USD  │Portfolio │ Profile  │ Activity                       │
│ $67,834  │Cash $8.29│ Clawdex  │ ▶ BUY  BTC Feb 16...  $1.00  │
│ [candles]│Proxy/EOA │ 6 mkts   │ ▶ SELL BTC Feb 16...  $4.11  │
│ 1s/1m/5m │Pos/Vol   │ 3W 1L    │ ✓ REDEEM ...          $4.92  │
│          │P/L       │ WR: 75%  │ ...                           │
├──────────┴──────────┴──────────┴───────────────────────────────┤
│ BTC/USD Live Price (sparkline)           │ Signal    NEUTRAL   │
│ [=============================]          │ Active 5m Market    │
│  floating trade bubbles ↑ ↑ ↑           │ Orderbook (Up)      │
│ $67,682 - $67,906 | -0.33%    288 ticks │                     │
├──────────────────────────────────────────┴─────────────────────┤
│ BTC 5-Minute Markets                                           │
│ Market          │ End (UTC/PL) │ Time Left │ Up/Down │Vol│Stat │
│ BTC Feb 16 ...  │ 17:15/18:15 │   ENDED   │ ██ 100  │18K│CLSD│
│ BTC Feb 16 ...  │ 17:20/18:20 │   2:19    │ ██ 42/58│3.1│OPEN│
└─────────────────────────────────────────────────────────────────┘
```

## Security

- All credentials in `.env` (never committed)
- `RPOLY_AUTH_TOKEN` protects trade/cancel endpoints
- `RPOLY_MODE=readonly` disables all trading for public deploy
- `.gitignore` excludes `.env`, `credentials.json`, sensitive scripts

## Environment Variables

See `.env.example` for full list. Required:
- `POLY_PRIVATE_KEY` - EOA private key (for signing)
- `POLY_PROXY_ADDRESS` - Gnosis Safe address
- `POLY_API_KEY/SECRET/PASSPHRASE` - CLOB L2 credentials
- `RPOLY_AUTH_TOKEN` - Dashboard auth token
- `RPOLY_MODE` - `live` or `readonly`

---

*Last Updated: 2026-02-16*
