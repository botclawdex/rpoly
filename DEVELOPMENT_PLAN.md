# rPoly Development Plan

## Status: IN PROGRESS
**Last Updated:** 2026-02-15 19:30

---

## v1.0.0 - MVP (DONE ✅)
- [x] Basic Express server with mock data
- [x] Frontend dashboard with retro hacker UI
- [x] Markets list
- [x] Basic scanner
- [x] Signals (mock)
- [x] Portfolio tracking
- [x] Settings form

---

## v1.2.0 - 5m Markets Focus (DONE ✅)
- [x] Use /markets API instead of /events ✅
- [x] Filter for 5m markets (slug pattern: btc-updown-5m-{timestamp}) ✅

---

## v1.3.0 - Real Data (DONE ✅)
- [x] Analyze section - BTC price from CoinGecko ✅
- [x] 5m Polymarket market data ✅
- [x] On-chain portfolio via Base RPC ✅
- [x] Dashboard shows ETH + USDC separately ✅
- [x] BTC Chart (24h OHLC from CoinGecko) ✅

---

## v1.4.0 - AUTONOMOUS TRADING (NEXT)
**Goal:** Execute real trades on Bitcoin 5m markets automatically

### Configuration
- **Max trade size:** 0.1 USDC (very small - wallet has ~$1)
- **Strategy:** Fade overbought/oversold 5m sentiment
- **Trigger:** When UP or DOWN > 55%

### Technical Requirements
- [ ] Polymarket CLOB integration (for placing orders)
- [ ] Private key / wallet signing
- [ ] Trade execution endpoint

### Trading Logic
```
1. Fetch current 5m market from Gamma API
2. If UP price > 55% → Signal: DOWN (fade)
3. If DOWN price > 55% → Signal: UP (fade)
4. If NEUTRAL → No trade
5. Execute trade via CLOB API (0.1 USDC max)
```

### Endpoints to Add
- `POST /api/trade/execute` - Execute a trade
- `GET /api/positions` - Get open positions from Polymarket

---

## v1.5.0 - Advanced Trading
- [ ] Multiple strategy modes (safe/aggressive/degen)
- [ ] Stop-loss / Take-profit
- [ ] Position sizing based on confidence
- [ ] Trade history persistence

---

## v2.0.0 - Pro
- [ ] x402 payments for signal subscriptions
- [ ] API for external bots
- [ ] Multi-chain support

---

## Current Wallet Balance
```
ETH: 0.00097 (~ $1.90)
USDC: 1.02 ($1.02)
Total: ~$3.00
```

**Max trade: 0.1 USDC**

---

## Notes
- Theme: Retro Hacker (green phosphor, CRT scanlines)
- Stack: Node.js + Express, Vanilla JS frontend
- Deployment: Vercel
- APIs: Polymarket Gamma, CoinGecko, Base RPC
