# rPoly

Real-time Polymarket BTC 5-minute trading dashboard with live WebSocket data, portfolio tracking, and CLOB trading.

## Features

- **Live BTC Price** - Real-time via Polymarket RTDS WebSocket
- **Sparkline Chart** - Custom canvas chart from live ticks
- **Candlestick Chart** - TradingView Lightweight Charts (Binance data, 1s/1m/5m intervals)
- **Floating Trade Bubbles** - Live order flow from CLOB WebSocket animated on chart
- **Portfolio** - Cash balances, positions value, volume, realized/unrealized P/L
- **Profile** - Markets traded, win/loss record, win rate, best trade
- **Activity Feed** - Full onchain activity (trades, redeems, rewards)
- **5m Markets Table** - With countdown timers, end times (UTC/PL), probabilities
- **CLOB Trading** - Real trades via Polymarket CLOB API (signatureType=2 Gnosis Safe)
- **Read-only Mode** - Safe public deployment without trading

## Tech Stack

- **Backend:** Node.js + Express
- **Frontend:** Vanilla HTML/CSS/JS, JetBrains Mono, CRT scanline effect
- **Charts:** TradingView Lightweight Charts + custom HTML5 Canvas sparkline
- **Real-time:** Polymarket RTDS WebSocket (BTC price) + CLOB WebSocket (order flow)
- **APIs:** Polymarket Gamma/Data/CLOB APIs, Binance API, Polygon RPC
- **Deployment:** Vercel (serverless)

## Quick Start

```bash
# Clone and install
npm install

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Run
node server.js
# http://localhost:3001
```

## Environment Variables

See `.env.example` for all variables. Key ones:

| Variable | Description |
|----------|-------------|
| `POLY_PRIVATE_KEY` | EOA private key for signing |
| `POLY_PROXY_ADDRESS` | Polymarket Gnosis Safe address |
| `POLY_API_KEY` | CLOB L2 API key |
| `POLY_API_SECRET` | CLOB L2 API secret |
| `POLY_API_PASSPHRASE` | CLOB L2 API passphrase |
| `RPOLY_AUTH_TOKEN` | Auth token for trade endpoints |
| `RPOLY_MODE` | `live` (trading) or `readonly` (dashboard only) |

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/health` | No | Health check |
| GET | `/api/dashboard` | No | Balances, BTC price, market, signal, orderbook |
| GET | `/api/markets/5m` | No | 5-minute BTC markets with tokenIds |
| GET | `/api/chart` | No | Binance candles (?interval=1s/1m/5m/15m) |
| GET | `/api/profile` | No | Full stats (6 Data API calls) |
| POST | `/api/trade` | Yes | Execute CLOB trade |
| POST | `/api/cancel-all` | Yes | Cancel all open orders |

## Deployment

### Vercel
```bash
# Set env vars in Vercel dashboard
# RPOLY_MODE=readonly for public deploy
vercel --prod
```

### Security
- Never commit `.env` - credentials stay on server/Vercel env vars
- Use `RPOLY_MODE=readonly` for public deployments
- `RPOLY_AUTH_TOKEN` required for any trade operations

## License

MIT

---

*Clawdex / rPoly v2.1.0*
