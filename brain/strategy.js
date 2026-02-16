# rPoly Trading Brain - v2.0

## Aktualizacja: 2026-02-16

---

## 🎯 Strategy Suite

Bot ma teraz 3 niezależne strategie do wyboru:

---

### STRATEGY 1: FADE (Primary)

**Zasada:** Kupuj przeciwnie do tłumu. Kiedy rynek jest overbought/oversold (>55%), tłum prawdopodobnie się myli.

```javascript
SYGNAŁ KUPUJ DOWN (fade UP):
├── UP price > 55%
├── Rynek overbought
└── → Kupuj DOWN

SYGNAŁ KUPUJ UP (fade DOWN):
├── DOWN price > 55%  
├── Rynek oversold
└── → Kupuj UP

BRAK TRADE:
├── Wszystko 45-55%
└── → CZEKAJ
```

**Parametry:**
- minOdds: 0.45
- maxOdds: 0.55
- confidence: |50 - odds|

---

### STRATEGY 2: MOMENTUM (Follow the Trend)

**Zasada:** Idź z trendem. Krótkoterminowe trendy mają momentum.

```javascript
SYGNAŁ KUPUJ UP:
├── BTC 5m candle: ZIELONY (close > open)
├── BTC 1h trend: W GÓRĘ (EMA 50 > EMA 200)
└── → Kupuj UP

SYGNAŁ KUPUJ DOWN:
├── BTC 5m candle: CZERWONY (close < open)
├── BTC 1h trend: W DÓŁ (EMA 50 < EMA 200)
└── → Kupuj DOWN
```

**Parametry:**
- minMomentum: 0.1% (5m change)
- confirmation: 1h trend align

---

### STRATEGY 3: EXTREME FEAR (Contrarian)

**Zasada:** Kupuj gdy inni się boją. Extreme Fear na TradingView = buying opportunity.

```javascript
SYGNAŁ KUPUJ UP:
├── Fear & Greed Index: < 25 (Extreme Fear)
├── Rynek oversold (UP < 40%)
└── → Kupuj UP

SYGNAŁ KUPUJ DOWN:
├── Fear & Greed Index: > 75 (Extreme Greed)
├── Rynek overbought (UP > 60%)
└── → Kupuj DOWN
```

**Parametry:**
- fearThreshold: 25
- greedThreshold: 75

---

## 🔀 Strategy Selection Logic

```javascript
function selectStrategy(marketData, btcPrice, fearIndex) {
  const { upPrice, downPrice, volume } = marketData;
  
  // High volume + extreme odds = FADE
  if (volume > 10000 && (upPrice > 0.6 || downPrice > 0.6)) {
    return 'FADE';
  }
  
  // Clear momentum = MOMENTUM
  if (btcPrice.change5m > 0.2 || btcPrice.change5m < -0.2) {
    return 'MOMENTUM';
  }
  
  // Extreme fear/greed = EXTREME_FEAR
  if (fearIndex < 25 || fearIndex > 75) {
    return 'EXTREME_FEAR';
  }
  
  // Default: FADE (most reliable)
  return 'FADE';
}
```

---

## 🛡️ Risk Management

```javascript
{
  maxTrade: 0.1,           // Max 0.1 USDC (10 cents)
  maxDailyLoss: 0.5,       // Stop trading after 0.5 USDC loss
  maxConsecutiveLoss: 3,    // Stop after 3 losses
  minVolume: 1000,         // Min market volume to trade
  waitAfterLoss: 2,        // Wait 2 windows (10 min) after loss
  waitAfterWin: 1,         // Wait 1 window (5 min) after win
  maxTradesPerDay: 10      // Max 10 trades per day
}
```

---

## 📊 Position Sizing

```javascript
function calculateSize(confidence, balance) {
  // confidence: 0-1 (how sure we are)
  // balance: available USDC
  
  const baseSize = 0.05;        // Base bet
  const multiplier = confidence; // Scale with confidence
  
  const size = baseSize + (balance * 0.1 * multiplier);
  return Math.min(size, 0.1);   // Cap at 0.1 USDC
}
```

---

## 📈 Performance Tracking

```json
{
  "totalTrades": 0,
  "wins": 0,
  "losses": 0,
  "winRate": 0,
  "avgWin": 0,
  "avgLoss": 0,
  "strategyStats": {
    "FADE": { "trades": 0, "wins": 0 },
    "MOMENTUM": { "trades": 0, "wins": 0 },
    "EXTREME_FEAR": { "trades": 0, "wins": 0 }
  },
  "daily": {
    "trades": 0,
    "pnl": 0,
    "stopped": false
  }
}
```

---

## 🔄 Decision Flow

```
GET /api/dashboard
    ↓
GET /api/markets/5m (current market)
    ↓
GET BTC price + 5m change
    ↓
GET Fear & Greed Index (optional)
    ↓
SELECT STRATEGY:
├── FADE if extreme odds + high volume
├── MOMENTUM if clear 5m direction
└── EXTREME_FEAR if fear < 25 or > 75
    ↓
CHECK CONDITIONS:
├── Volume > 1000?
├── Not after 3 losses?
├── Not max daily trades?
└── Not stopped for risk?
    ↓
EXECUTE TRADE:
├── Calculate size (confidence-based)
├── Place order via CLOB
└── Log result
    ↓
UPDATE TRACKING:
├── Record win/loss
├── Update strategy stats
└── Check stop conditions
```

---

## 🧪 Testing Notes

**Status:** v2.0 ready for live testing

**Test sequence:**
1. Start with FADE only (most tested)
2. Add MOMENTUM after 10 trades
3. Add EXTREME_FEAR after 20 trades

**Expected performance:**
- FADE: ~55-60% win rate (market overreaction)
- MOMENTUM: ~50-55% (follows trend)
- EXTREME_FEAR: ~60-65% (contrarian at extremes)

---

*Last Updated: 2026-02-16*
