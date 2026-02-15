# rPoly - Polymarket Trading Architecture

## Overview

rPoly is an AI-powered trading bot for Polymarket prediction markets, integrated with the Clawdex ecosystem.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      rPoly (this app)                       │
│                    https://rpoly.vercel.app                 │
├─────────────────────────────────────────────────────────────┤
│  API Endpoints:                                            │
│  • GET  /api/markets       - List Polymarket markets      │
│  • GET  /api/markets/5m    - 5-minute BTC markets        │
│  • GET  /api/analyze       - Analyze current 5m market    │
│  • GET  /api/portfolio/real - On-chain Base balance        │
│  • GET  /api/chart         - BTC price chart (24h)         │
│  • GET  /api/scan          - Find trading opportunities    │
│  • POST /api/trade         - Execute trade (simulated)      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Polymarket CLOB API                       │
│                  https://clob.polymarket.com                 │
│                     Chain: Polygon (137)                     │
├─────────────────────────────────────────────────────────────┤
│  Authentication:                                            │
│  • L1: EIP-712 signature with private key                  │
│  • L2: API credentials (apiKey, secret, passphrase)         │
│                                                             │
│  For Trading:                                               │
│  1. Create API credentials from private key                 │
│  2. Set token allowances (USDC approval)                   │
│  3. Post orders with L2 authentication                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Blockchain Layer                          │
├─────────────────────────────────────────────────────────────┤
│  Polymarket:     Polygon (chain 137) - trading              │
│  Our Wallet:     Base (chain 8453) - funds stored           │
│                                                             │
│  Flow:                                                       │
│  1. Funds on Base → Bridge to Polygon → Trade on Polymarket│
│  2. Or: Deposit directly to Polymarket bridge address       │
└─────────────────────────────────────────────────────────────┘
```

## Wallet Configuration

**Trading Wallet (EOA):**
- Address: `0xDEB4f464d46B1A3CDB4A29c41C6E908378993914`
- Private Key: Stored in `memory/credentials.json` (farcaster.custody_private_key)
- Used for: Polymarket CLOB trading, signature signing

**Note:** This is the SAME wallet as the FarFararcaster account (FID 2774071).

## Current Balance

### On Base (Chain 8453)
- ETH: ~0.001 ETH (~$2.50) - for Base gas
- USDC: ~$4.83 - can be bridged to Polymarket

### On Polymarket (Polygon)
- USDC: $5.00 - deposited via bridge

## Requirements for Live Trading

### 1. MATIC on Polygon (for gas)
- **Amount needed:** $2-5 worth
- **Purpose:** Pay for transaction fees on Polygon
- **Note:** Gas on Polygon is very cheap (~$0.01 per tx)
- **Can get from:** Swap on DEX, or bridge from another chain

### 2. API Credentials
- Need to derive API credentials from private key
- Process: Sign EIP-712 message → Get apiKey, secret, passphrase
- Stored in: Requires configuration in environment

### 3. Token Allowances
- USDC approval for exchange contract
- One-time setup, then automated

## Bridging Funds

### Deposit Flow (Tested ✅)
```
Base Wallet → Polymarket Bridge (Base) → Polymarket (Polygon)
```

1. Get bridge address:
   ```
   POST https://bridge.polymarket.com/deposit
   { fromChain: "base", toChain: "polygon", asset: "USDC", ... }
   ```

2. Send USDC from Base wallet to bridge address

3. Wait for confirmation (usually 1-2 minutes)

4. Check status:
   ```
   GET https://bridge.polymarket.com/status/{address}
   ```

### Tested Transaction
- **Tx Hash:** `0x5ff22296682ba97fc2e117080112fd7443fbdd1a9c58562917dd9cb74cdcbf66`
- **Amount:** $5 USDC
- **Status:** ✅ COMPLETED

## Strategy: Anti-Crowd Trading

### Logic
1. Get Twitter/X sentiment for BTC
2. If sentiment is >55% bullish → Signal: SELL (fade the crowd)
3. If sentiment is >55% bearish → Signal: BUY (buy the dip)
4. Target 5m markets (BTC up/down in 5 minutes)

### Parameters
- **Max Trade Size:** $0.50 - $1.00 per trade
- **Stop Loss:** N/A (5m markets auto-resolve)
- **Take Profit:** Close position when P&L > 50%

## API Keys & Secrets

Stored in: `memory/credentials.json`

```json
{
  "farcaster": {
    "custody_private_key": "0x4b6f9d09fedaf40f05d1bc8000a9feb211be9cfe9366b584bc5538a5bfeacce4"
  }
}
```

## Running Locally

```bash
cd rpoly
npm install
npm start
# Server runs on http://localhost:3001
```

## Environment Variables (for production)

```
# For CLOB trading (not yet configured)
POLYMARKET_PRIVATE_KEY=<wallet_private_key>
POLYMARKET_API_KEY=<derived_api_key>
POLYMARKET_API_SECRET=<derived_secret>
POLYMARKET_API_PASSPHRASE=<derived_passphrase>
```

## Development Status

| Feature | Status | Notes |
|---------|--------|-------|
| Market Data | ✅ Done | Gamma API |
| 5m Markets | ✅ Done | BTC up/down |
| Portfolio (Base) | ✅ Done | On-chain RPC |
| BTC Chart | ✅ Done | CoinGecko |
| Analysis | ✅ Done | Signal generation |
| Bridge Deposit | ✅ Done | Tested with $5 |
| CLOB Trading | 🔄 WIP | Need MATIC + API creds |
| Auto-Trading | 🔄 WIP | Need CLOB integration |

## Future Improvements

1. **Auto-bridge:** Automatically bridge USDC when balance low
2. **MATIC faucet:** Get testnet MATIC for development
3. **Multi-chain:** Support Base-native prediction markets (when available)
4. **Strategy:** Backtest anti-crowd strategy
5. **Alerts:** Telegram notifications for trades

## Links

- **rPoly App:** https://rpoly.vercel.app
- **GitHub:** https://github.com/botclawdex/rpoly
- **Polymarket Docs:** https://docs.polymarket.com
- **CLOB API:** https://clob.polymarket.com
- **Bridge API:** https://bridge.polymarket.com

---

*Last Updated: 2026-02-15*
