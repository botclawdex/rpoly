# rPoly Development Plan

## Status: IN PROGRESS
**Last Updated:** 2026-02-15 22:23

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

## v1.4.0 - CLOB Integration (IN PROGRESS 🔄)
**Goal:** Execute real trades on Polymarket CLOB

### What's Done ✅
- [x] Trade endpoint created (POST /api/trade)
- [x] ethers.js installed
- [x] $5 USDC bridged from Base to Polymarket

### What's Needed ❌
- [ ] **MATIC on Polygon** - $2-5 for gas (~$0.01 per tx)
- [ ] API credentials derivation (sign EIP-712 → get apiKey/secret)
- [ ] Token allowances (approve USDC)
- [ ] Full CLOB client integration

### Technical Details
```
Chain: Polygon (chain ID 137)
Wallet: 0x7Ca66FFAF6A5D4DE8492C97c61753B699350AD77
Private Key: From FARCASTER_PRIVATE_KEY env var

Signature Type: 0 (EOA)
Funder: Same as wallet address
```

### Why Polygon?
- Polymarket runs on **Polygon** (chain 137), NOT Base
- Deposits FROM Base work, but trading happens on Polygon
- Need MATIC for gas (Polygon native token)
- Gas is very cheap: $0.01-0.10 per transaction

### Bridge Transaction (TESTED ✅)
- **Tx:** 0x5ff22296682ba97fc2e117080112fd7443fbdd1a9c58562917dd9cb74cdcbf66
- **Amount:** $5 USDC
- **Status:** COMPLETED

---

## v1.5.0 - AUTONOMOUS TRADING
**Goal:** Full auto-trading with anti-crowd strategy

### Trading Logic
```
1. Fetch current 5m market from Gamma API
2. Get sentiment from Twitter/X (anti-crowd)
3. If UP price > 55% → Signal: DOWN (fade)
4. If DOWN price > 55% → Signal: UP (fade)
5. If NEUTRAL → No trade
6. Execute trade via CLOB API (0.50-1.00 USDC max)
```

### Endpoints to Add
- [ ] `POST /api/trade/execute` - Execute real trade
- [ ] `GET /api/positions` - Get open positions
- [ ] `GET /api/orders` - Get open orders

---

## v1.6.0 - Advanced Trading
- [ ] Multiple strategy modes (safe/aggressive/degen)
- [ ] Stop-loss / Take-profit (manual close)
- [ ] Position sizing based on confidence
- [ ] Trade history persistence

---

## v2.0.0 - Pro
- [ ] x402 payments for signal subscriptions
- [ ] API for external bots
- [ ] Multi-chain support (when Base gets prediction markets)

---

## Current Wallet Balance

### On Base (for bridging)
```
ETH: 0.0010 ETH (~$2.43) - for Base gas
USDC: $4.83 - can bridge more if needed
Total: ~$7.26
```

### On Polymarket (ready to trade)
```
USDC: $5.00 - deposited via bridge ✅
```

### What's Missing
```
MATIC: $0-5 (for Polygon gas) ❌
```

---

## Strategy: Anti-Crowd

### Core Idea
- Buy opposite of crowd sentiment
- When markets are >55% UP → expect DOWN (fade)
- When markets are >55% DOWN → expect UP (buy dip)

### Parameters
- **Max Trade Size:** $0.50 - $1.00 per trade
- **Stop Loss:** N/A (5m markets auto-resolve in 5 min)
- **Take Profit:** Close when P&L > 50%

---

## Documentation
- See ARCHITECTURE.md for full system overview
- See TRADING_GUIDE.md for strategy explanation

---

## Notes
- Theme: Retro Hacker (green phosphor, CRT scanlines)
- Stack: Node.js + Express, Vanilla JS frontend
- Deployment: Vercel
- APIs: Polymarket Gamma, CoinGecko, Base RPC, Polymarket CLOB

---

## Quick Start for Live Trading

1. Get MATIC ($2-5) on Polygon
2. Run: `node scripts/derive-api-creds.js` (to create API key)
3. Run: `node scripts/set-allowances.js` (approve USDC)
4. Set environment variables
5. Deploy and test trade endpoint
