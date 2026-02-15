# rPoly - AI Polymarket Trading Bot

## Overview
rPoly to aplikacja do tradingu 5-minutowych rynków Bitcoin na Polymarket. AI analizuje kierunek BTC i sugeruje trades.

## Tech Stack
- **Frontend:** Vanilla HTML/CSS/JS, retro hacker UI (green phosphor)
- **Backend:** Node.js/Express na Vercel
- **API:** Polymarket Gamma API (rynki), Binance API (cena BTC)

## Architecture

### Frontend (index.html)
- 6 sekcji: Dashboard, Markets, Scanner, Signals, Portfolio, Settings
- UI: green-on-black, CRT scanlines, JetBrains Mono font
- API calls: `/api/markets`, `/api/analyze`, `/api/portfolio`

### Backend (server.js)

#### Endpoints
| Endpoint | Opis |
|----------|------|
| `GET /health` | Health check |
| `GET /api/markets?filter=5m\|all` | Lista rynków |
| `GET /api/analyze` | Analiza BTC 5m |
| `GET /api/portfolio` | Portfolio (mock) |
| `GET /api/portfolio/real` | On-chain portfolio (Etherscan) |

#### Funkcje pomocnicze
```javascript
getCurrent5mWindowTs() // Zwraca timestamp następnego okna 5min
getMarkets(limit, filter5m) // Pobiera rynki z Polymarket
getBTCPrice() // Pobiera cenę BTC z Binance
getOnChainBalance(address) // Pobiera balans z Basescan
```

## API Integrations

### Polymarket Gamma API
```javascript
const GAMMA_API = "https://gamma-api.polymarket.com";

// Pobierz rynek po slug
GET /markets?slug=btc-updown-5m-{timestamp}

// Pobierz wszystkie aktywne rynki
GET /markets?active=true&closed=false&limit=200
```

### Binance API (cena BTC)
```javascript
// Public endpoint - bez API key
GET https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT
// Response: { "symbol": "BTCUSDT", "price": "69034.43000000" }
```

### Basescan API (on-chain portfolio)
```javascript
const BASESCAN_API = "https://api.basescan.org/api";
const API_KEY = "HSHV72NNW6KVQA88YB5BFSZHTVPFWC2GJU";

// Balans ETH/USDC
GET /api?module=account&action=balance&address={addr}&tag=latest&apikey={KEY}

// Balans tokena (USDC)
GET /api?module=account&action=tokenbalance&address={addr}&contractaddress={USDC}&tag=latest&apikey={KEY}
```

## Wallet
- **Custody address:** `0xDEB4f464d46B1A3CDB4A29c41C6E908378993914`
- Dane w: `memory/credentials.json` → `farcaster.custody_address`

## Deployment
```bash
cd rpoly
git add -A
git commit -m "message"
git push origin main
# Vercel auto-deploy z GitHub
```

## Development Plan
`DEVELOPMENT_PLAN.md` - roadmap wersji aplikacji.
