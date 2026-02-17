# trades/ — Local Data Storage

This directory stores all locally collected data. Files are **gitignored** (except this README) because they contain runtime data specific to your server instance.

---

## Files

### Market Data (daily, from Data Lab collector)

| File | Format | Updated | Content |
|------|--------|---------|---------|
| `odds-YYYY-MM-DD.json` | JSON array | Every 60s | Odds snapshots for each active 5m market |
| `global-YYYY-MM-DD.json` | JSON array | Every 60s | All trades across BTC 5m markets |
| `whales-YYYY-MM-DD.json` | JSON array | Every 60s | Top 20 holders per active market |

### Analysis (rolling, overwritten)

| File | Format | Updated | Content |
|------|--------|---------|---------|
| `patterns.json` | JSON object | Every 60s | Win/loss rates by odds bucket, total snapshots/markets |

### Bot Data (rolling, capped)

| File | Format | Updated | Content |
|------|--------|---------|---------|
| `trade-log.json` | JSON array | On each trade | Last 100 bot trades (BUY, SELL, SELL-LIMIT) |
| `bot-messages.json` | JSON array | On bot action | Last 50 ClawBot messages for ticker/feed |

---

## Data Formats

### odds-YYYY-MM-DD.json
```json
[
  {
    "ts": 1771296000000,
    "market": "btc-updown-5m-1771373700",
    "slug": "btc-updown-5m-1771373700",
    "question": "Will the price of Bitcoin be higher at 9:40 PM ET...",
    "up": 0.52,
    "down": 0.48,
    "volume": "18234.50",
    "liquidity": "3102.80"
  }
]
```

### global-YYYY-MM-DD.json
```json
[
  {
    "ts": 1771296000000,
    "market": "btc-updown-5m-1771373700",
    "side": "BUY",
    "outcome": "Yes",
    "price": "0.52",
    "size": "10",
    "maker": "0x...",
    "taker": "0x..."
  }
]
```

### whales-YYYY-MM-DD.json
```json
[
  {
    "ts": 1771296000000,
    "market": "btc-updown-5m-1771373700",
    "holders": [
      {
        "address": "0x...",
        "position": "Yes",
        "size": "500",
        "avgPrice": "0.50"
      }
    ]
  }
]
```

### patterns.json
```json
{
  "totalSnapshots": 325,
  "totalMarkets": 33,
  "uniqueDays": 1,
  "oddsBuckets": {
    "40-45": { "w": 0, "l": 0 },
    "45-50": { "w": 12, "l": 8 },
    "50-55": { "w": 15, "l": 13 },
    "55-60": { "w": 5, "l": 9 },
    "60+": { "w": 2, "l": 6 }
  },
  "lastUpdated": 1771296797780
}
```
**Agent note**: `oddsBuckets` tracks how often the market outcome matched the odds range. Use this to validate fade strategy — if "60+" has more losses than wins, it means extreme odds often revert.

### trade-log.json
```json
[
  {
    "action": "BUY",
    "side": "YES",
    "size": 5,
    "price": 0.52,
    "market": "BTC 9:35PM-9:40PM ET Feb 17",
    "result": "OK",
    "ts": 1771296000000
  },
  {
    "action": "SELL",
    "side": "YES",
    "size": 5,
    "price": 0.68,
    "market": "BTC 9:35PM-9:40PM ET Feb 17",
    "result": "OK",
    "ts": 1771296180000
  }
]
```

### bot-messages.json
```json
[
  {
    "text": "ClawBot online. Trading terminal active.",
    "type": "info",
    "ts": 1771295368756
  },
  {
    "text": "Bought 5 UP @ $0.52. PriceToBeat=$68,029. BTC=$68,045. Momentum UP.",
    "type": "trade",
    "ts": 1771296000000
  }
]
```

---

## API Endpoints for Data Access

| Endpoint | Returns |
|----------|---------|
| `GET /api/learn/odds-history` | Today's odds snapshots |
| `GET /api/learn/global-trades` | Today's global trades |
| `GET /api/learn/whales` | Today's whale positions |
| `GET /api/learn/patterns` | Aggregated patterns |
| `GET /api/learn/status` | Collector status (running, stats) |
| `GET /api/trade-log` | Bot trade history (last 100) |
| `GET /api/bot-messages` | Bot messages (last 50) |

---

## For the Autonomous Agent

When building strategies:
1. **Read `patterns.json`** first — it tells you which odds ranges are profitable
2. **Check today's `odds-*.json`** — see how odds evolved for recent markets
3. **Scan `global-*.json`** — detect unusual volume or whale entries
4. **Review `whales-*.json`** — follow smart money
5. **Review `trade-log.json`** — learn from your own past trades

Data collector runs in the background on `server.js` every 60 seconds. No action needed to start it — it runs automatically when the server starts.

---

*Last Updated: Feb 17, 2026*
