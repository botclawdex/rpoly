# rPoly — Autonomous Trading Agent Guide

## Purpose of This Document

This guide is written for an **autonomous AI agent** (ClawBot) that will trade Polymarket BTC 5-minute markets. It contains everything the agent needs to know: what the markets are, how to trade, available strategies, risk management, and how to use the rPoly infrastructure.

---

## 1. What Are BTC 5-Minute Markets?

Polymarket hosts prediction markets where users bet on whether Bitcoin's price will go UP or DOWN over a 5-minute window.

### Market Example
```
Question: "Will the price of Bitcoin be higher at 9:40 PM ET on Feb 17, 2026, than at 9:35 PM ET?"
- eventStartTime: 9:35 PM ET (when the 5-min window starts)
- endDate: 9:40 PM ET (when the market closes)
- UP token price: $0.52 (market thinks 52% chance BTC goes up)
- DOWN token price: $0.48 (market thinks 48% chance BTC goes down)
```

### How Resolution Works
1. At `eventStartTime`, BTC has a reference price → "**Price to Beat**"
2. At `endDate` (5 minutes later), BTC has a final price
3. If final > Price to Beat → **UP wins** → UP shares pay $1.00, DOWN shares pay $0.00
4. If final < Price to Beat → **DOWN wins** → DOWN shares pay $1.00, UP shares pay $0.00

### Key Insight
You're NOT predicting BTC's absolute price. You're predicting whether BTC will move UP or DOWN by even $1 over the next 5 minutes. This is essentially a binary bet on short-term momentum.

---

## 2. How to Trade

### 2.1 Buying Tokens

To bet BTC goes UP:
```
POST /api/trade
Authorization: Bearer RPOLY_AUTH_TOKEN
{
  "market": "<conditionId>",    // from /api/dashboard market.conditionId
  "outcome": "YES",             // YES = UP token
  "size": "5",                  // number of shares (min 5)
  "price": "0.52"               // price per share (optional, uses midpoint if omitted)
}
```

To bet BTC goes DOWN:
```
POST /api/trade
{
  "market": "<conditionId>",
  "outcome": "NO",              // NO = DOWN token
  "size": "5",
  "price": "0.48"
}
```

**Cost**: `size * price` = 5 * $0.52 = $2.60
**Potential return**: `size * $1.00` = $5.00 (if you win)
**Profit**: $5.00 - $2.60 = $2.40 (if you win)
**Loss**: -$2.60 (if you lose, shares worth $0.00)
**Fee**: 10% taker fee on 5m markets (`feeRateBps: 1000`)

### 2.2 Early Exit (Selling Before Resolution)

You do NOT have to wait for the market to close. Sell at any time:

```
POST /api/sell
Authorization: Bearer RPOLY_AUTH_TOKEN
{
  "market": "<conditionId>",
  "outcome": "YES",             // which token you hold
  "size": "5"                   // how many to sell
}
// Sells at best bid (market sell, instant)
```

**When to early exit:**
- Token price moved from $0.52 to $0.65 → sell for profit without waiting
- Token price dropped to $0.35 → cut losses early
- 30 seconds before market closes and uncertain → reduce risk

### 2.3 Limit Sell (Take-Profit / Stop-Loss)

Set a target sell price:
```
POST /api/sell-limit
Authorization: Bearer RPOLY_AUTH_TOKEN
{
  "market": "<conditionId>",
  "outcome": "YES",
  "size": "5",
  "price": "0.70"              // sell when token reaches $0.70
}
```
Order sits on the book until someone buys at that price.

### 2.4 Redeem (Claim Winnings)

After a market resolves, winning tokens are worth $1.00 but **do NOT auto-convert to USDC**. You must redeem them.

**The problem:** Polymarket CLOB API has NO `/redeem` endpoint. Redemption requires calling `redeemPositions()` on the Conditional Token Framework (CTF) smart contract on Polygon. For Safe/Gnosis wallets (our `signatureType=2`), this must go through `execTransaction`.

**Solutions (ordered by preference):**

**A) Sell before resolution (recommended for bot)**
Instead of waiting for resolution and dealing with redeem, sell your winning tokens ~10-30 seconds before market closes when price is already near $0.95-$0.99:
```
POST /api/sell
{ "market": "conditionId", "outcome": "YES", "size": "5" }
// Sells at best bid — gets ~$0.95-0.99 per share instead of $1.00
// Avoids entire redeem problem
```
You lose 1-5 cents per share but skip all the complexity.

**B) Gasless redeem via Polymarket Relayer**
Use the Polymarket relayer at `https://relayer-v2.polymarket.com/submit` to execute a gasless `redeemPositions` through the Safe wallet. No POL/MATIC gas needed.
- Reference: https://github.com/NocodeSolutions/polymarket-gasless-redeem-cli
- Reference: https://docs.polymarket.com/developers/builders/relayer-client
- Note: Builder keys are rate-limited. May need retry with backoff (429 errors).

**C) JS redemption via Polymarket proxy wallet example**
- Reference: https://github.com/Polymarket/examples/blob/main/examples/proxyWallet/redeem.ts
- TypeScript example for proxy wallet redeem

**D) Python `polymarket-apis` package**
```
pip install polymarket-apis
# PolymarketWeb3Client(signature_type=2) for Safe/Gnosis
# .redeem_positions(condition_id, index_sets=[1,2])
```

**For the autonomous agent:** Prefer strategy A (sell before resolution). Only implement B/C/D as fallback if a position somehow goes to resolution without being sold. Add `/api/redeem` endpoint to server.js when ready.

**Important:** If you see "REDEEM" events in the activity feed, those were done manually via the Polymarket UI. The bot should aim to never need manual redeem by selling before resolution.

### 2.5 Cancel Orders

Cancel a specific order:
```
POST /api/cancel-order/<order_id>
Authorization: Bearer RPOLY_AUTH_TOKEN
```

Cancel all orders:
```
POST /api/cancel-all
Authorization: Bearer RPOLY_AUTH_TOKEN
```

### 2.5 Check State

```
GET /api/dashboard         → current market, BTC price, balances, orderbook
GET /api/open-orders       → all open orders
GET /api/profile           → positions, P/L, activity
GET /api/markets/5m        → all active 5m markets with priceToBeat
```

---

## 3. Available Data for Decision Making

### 3.1 Real-Time Data (from /api/dashboard)

| Field | Description | Use |
|-------|-------------|-----|
| `btc.price` | Current BTC price (Binance) | Compare with priceToBeat |
| `market.upPrice` | UP token price ($0.01-$0.99) | Market sentiment |
| `market.downPrice` | DOWN token price | Inverse of upPrice |
| `market.priceToBeat` | BTC price at eventStartTime | The benchmark |
| `market.volume` | Total volume traded | Market liquidity indicator |
| `market.liquidity` | Available liquidity | Ease of entry/exit |
| `market.endDate` | When market closes | Time remaining |
| `orderbook.bids` | Buy orders on the book | Exit price estimation |
| `orderbook.asks` | Sell orders on the book | Entry price estimation |
| `signal.label` | Signal from analysis | BULLISH/BEARISH/NEUTRAL |
| `balances.proxy.usdc` | Available cash | Position sizing |

### 3.2 Historical Data (from Data Lab collector)

**Odds History** (`GET /api/learn/odds-history`):
```json
[
  { "ts": 1771296000000, "market": "btc-5m-...", "up": 0.52, "down": 0.48 },
  { "ts": 1771296060000, "market": "btc-5m-...", "up": 0.55, "down": 0.45 },
  ...
]
```
Shows how UP/DOWN odds change over time within a market. Useful for detecting momentum shifts.

**Global Trades** (`GET /api/learn/global-trades`):
```json
[
  { "ts": 1771296000000, "side": "BUY", "outcome": "Yes", "price": "0.52", "size": "10", "market": "..." },
  ...
]
```
What other traders are doing. Look for whale activity (large sizes).

**Whale Positions** (`GET /api/learn/whales`):
```json
[
  { "ts": 1771296000000, "market": "...", "holders": [
    { "address": "0x...", "position": "Yes", "size": "500", "avgPrice": "0.50" },
    ...
  ]}
]
```
Top 20 holders of each market. Smart money indicator.

**Patterns** (`GET /api/learn/patterns`):
```json
{
  "totalSnapshots": 325,
  "totalMarkets": 33,
  "oddsBuckets": {
    "40-45": { "w": 0, "l": 0 },
    "45-50": { "w": 12, "l": 8 },
    "50-55": { "w": 15, "l": 13 },
    "55-60": { "w": 5, "l": 9 },
    "60+": { "w": 2, "l": 6 }
  }
}
```
Win/loss rates grouped by odds ranges. Key for calibrating fade strategies.

### 3.3 Trade History

**Bot Trade Log** (`GET /api/trade-log`):
```json
[
  { "action": "BUY", "side": "YES", "size": 5, "price": 0.52, "market": "BTC 9:35PM-9:40PM", "result": "OK", "ts": 1771296000000 },
  { "action": "SELL", "side": "YES", "size": 5, "price": 0.68, "market": "BTC 9:35PM-9:40PM", "result": "OK", "ts": 1771296180000 }
]
```

**On-Chain Activity** (`GET /api/profile` → `.activity`):
```json
[
  { "type": "TRADE", "side": "BUY", "outcome": "Yes", "size": "5", "price": "0.52", "market": "...", "timestamp": "..." },
  { "type": "REDEEM", "outcome": "Yes", "size": "5", "payout": "5.00", "market": "...", "timestamp": "..." }
]
```

---

## 4. Trading Strategies

### Strategy 1: Crowd Fade
**Logic**: When the market is heavily skewed (e.g., UP > 58%), the crowd is often wrong on short timeframes. Bet against them.

```
IF upPrice > 0.58:
  → BUY DOWN (crowd is too bullish, fade them)
IF downPrice > 0.58:
  → BUY UP (crowd is too bearish, fade them)
IF both between 0.42-0.58:
  → SKIP (no clear edge)
```

**Validation**: Check `patterns.json` oddsBuckets. If "60+" bucket has more losses than wins, fade strategy is profitable at those extremes.

### Strategy 2: Price Momentum
**Logic**: Compare current BTC price with Price to Beat. If BTC is already moving in one direction, ride the momentum.

```
priceDiff = btc.price - market.priceToBeat
percentDiff = priceDiff / market.priceToBeat * 100

IF percentDiff > +0.05% AND timeLeft > 120s:
  → BUY UP (momentum is bullish)
IF percentDiff < -0.05% AND timeLeft > 120s:
  → BUY DOWN (momentum is bearish)
IF abs(percentDiff) < 0.02%:
  → SKIP (too close to call)
```

**Note**: Only trade if enough time remains. BTC can reverse quickly in the last 60 seconds.

### Strategy 3: Whale Following
**Logic**: Track what big holders (whales) are doing. They often have better information.

```
whaleData = GET /api/learn/whales
topHolder = whaleData.holders[0]

IF topHolder.position == "Yes" AND topHolder.size > 100:
  → BUY UP (whale is bullish)
IF topHolder.position == "No" AND topHolder.size > 100:
  → BUY DOWN (whale is bearish)
```

### Strategy 4: Odds Shift
**Logic**: Watch how odds change within the market's life. A rapid shift indicates new information.

```
oddsHistory = GET /api/learn/odds-history
recentShift = last 3 snapshots

IF UP price jumped from 0.50 to 0.60 in last 2 minutes:
  → market is moving fast → BUY UP (ride the wave)
IF UP price dropped from 0.55 to 0.45 in last 2 minutes:
  → market is moving fast → BUY DOWN (ride the wave)
```

### Strategy 5: Combined (Recommended)
**Logic**: Use multiple signals weighted by confidence.

```
signals = []

# Signal 1: Crowd Fade (weight: 0.3)
if upPrice > 0.58: signals.push({ side: "DOWN", confidence: 0.3 })
if downPrice > 0.58: signals.push({ side: "UP", confidence: 0.3 })

# Signal 2: Price Momentum (weight: 0.4)
diff = (btc.price - priceToBeat) / priceToBeat
if diff > 0.05%: signals.push({ side: "UP", confidence: 0.4 })
if diff < -0.05%: signals.push({ side: "DOWN", confidence: 0.4 })

# Signal 3: Whale (weight: 0.2)
if topWhale.side == "UP" and topWhale.size > 100:
  signals.push({ side: "UP", confidence: 0.2 })

# Signal 4: Odds Shift (weight: 0.1)
if oddsMovingUp: signals.push({ side: "UP", confidence: 0.1 })

# Aggregate
upScore = sum(s.confidence for s in signals where s.side == "UP")
downScore = sum(s.confidence for s in signals where s.side == "DOWN")

if upScore > 0.5: BUY UP
elif downScore > 0.5: BUY DOWN
else: SKIP
```

---

## 5. Risk Management Rules

### Current Bot Parameters (v1)
```
BANKROLL:           ~$50 USDC
MAX_PER_TRADE:      $1 USDC
TRADE_FREQUENCY:    every 5 minutes (each new market)
EXIT_STRATEGY:      SELL 30 seconds before market close
REDEEM_STRATEGY:    manual (owner redeems via polymarket.com if needed)
```

### Position Sizing
```
# Fixed $1 per trade for v1
amount = 1                           # $1 USDC per trade
shares = amount / price              # e.g. $1 / $0.85 = ~1.17 shares
potential_win = shares * (1 - price) # e.g. 1.17 * $0.15 = $0.17 profit if win

# Polymarket accepts $1 orders — no minimum share count on BTC 5m
# The API uses amount in USDC, not shares — just pass amount: "1"
```

### Stop-Loss Rules
- If token drops 30% from entry → consider early exit
- If time left < 60s and losing → let it ride (resolution is seconds away)
- Never average down on a losing position

### Pre-Close Exit (CRITICAL)
```
# 30 seconds before market endDate:
IF holding_position AND timeLeft <= 30:
  → POST /api/sell (sell at best bid)
  → Accept 1-5 cent loss per share to avoid redeem complexity
  → This is the PRIMARY exit strategy
  → If sell fails → position goes to resolution
  → Owner will manually redeem via polymarket.com
```

### Drawdown Protection
```
IF consecutive_losses >= 3:
  → pause trading for 2 market cycles (10 minutes)
  → reduce position size by 50% for next 3 trades
  
IF daily_loss > 30% of starting_balance:
  → stop trading for the day
```

### Market Quality Filter
```
IF volume < 5000: SKIP (too thin, hard to exit)
IF liquidity < 1000: SKIP (slippage risk)
IF timeLeft < 90s: SKIP (not enough time to react)
IF spread > 0.10: SKIP (too expensive to enter)
```

---

## 6. Trade Execution Loop (Pseudocode)

```
EVERY 60 seconds:
  1. GET /api/dashboard
  2. Check if there's an active 5m market
  3. If no market → wait
  4. If already have position in this market → monitor only (see step 7)
  5. If market has < 90s left → skip
  
  6. ANALYZE:
     a. Fetch Data Lab data (odds, whales, global trades)
     b. Calculate priceToBeat vs current BTC
     c. Run strategy (combined signals)
     d. Determine: BUY UP, BUY DOWN, or SKIP
  
  7. If SKIP → post bot message "Skipping market X: no clear edge"
  
  8. If BUY:
     a. Calculate position size
     b. POST /api/trade with outcome + size
     c. POST /api/bot-message with reasoning
     d. Set take-profit limit sell (optional)
  
  9. MONITOR POSITION (every 15s):
     a. GET /api/dashboard → check current token prices
     b. If unrealized P/L > +20% → consider selling early
     c. If unrealized P/L < -30% and time left > 120s → consider cutting losses
     d. If time left < 30s AND winning → SELL NOW (avoid redeem problem!)
     e. If time left < 30s AND losing → hold for resolution (nothing to lose)
  
  10. PRE-CLOSE EXIT (critical, ~15-30s before endDate):
      a. If holding winning position → POST /api/sell (sell at best bid ~$0.95-0.99)
      b. This avoids needing to call redeemPositions() on the smart contract
      c. Losing 1-5 cents per share is worth the simplicity
      d. POST /api/bot-message "Selling 5 UP @ $0.97 before close. Locking profit."

  11. After market resolves:
      a. GET /api/profile → check result
      b. POST /api/bot-message with result ("Won +$X" or "Lost -$X")
      c. If tokens were NOT sold before resolution (fallback):
         → Tokens need manual redeem via Polymarket UI or /api/redeem (TODO)
         → Post warning: "Position went to resolution. Manual redeem needed."
      d. Update internal stats
      e. Wait for next market
```

---

## 7. Bot Messages (ClawBot Feed)

The agent should post messages for spectators to see what's happening:

```
POST /api/bot-message
Authorization: Bearer RPOLY_AUTH_TOKEN
{ "text": "Analyzing BTC 9:35PM market. UP=52%, PriceToBeat=$68,029. BTC now $68,045 (+0.02%). Momentum slight UP." }
```

**Message types to post:**
- Market analysis: "Scanning market X. Signals: fade=DOWN(0.3), momentum=UP(0.4). Decision: BUY UP"
- Trade execution: "Bought 5 UP @ $0.52 ($2.60 total). Target: $0.70"
- Position update: "UP token now $0.61 (+17%). Holding for resolution."
- Exit: "Sold 5 UP @ $0.68. Profit: +$0.80"
- Skip: "Market too thin (vol $2.1K). Skipping."
- Result: "Market resolved UP. Won +$2.40!"
- Error: "Trade failed: insufficient balance. Pausing."

---

## 8. Important Technical Notes

### Token ID Mapping
- `outcome: "YES"` → UP token (`clobTokenIds[0]`)
- `outcome: "NO"` → DOWN token (`clobTokenIds[1]`)

### Timing
- Markets are created ~10 minutes before they start
- `eventStartTime` = when the 5-min window begins
- `endDate` = when the market closes (5 min after start)
- After `endDate`, market resolves (usually within seconds)
- You CAN trade before `eventStartTime` (but no Price to Beat yet)

### Fees
- Taker fee: 10% (`feeRateBps: 1000`) on 5m markets
- Example: Buy $1 worth @ $0.85 = ~1.17 shares, fee deducted from order
- Fee is deducted from your order

### Price Range
- Token prices range from $0.01 to $0.99
- $0.50 = 50/50 odds (no edge)
- $0.90+ or $0.10- = very skewed (high conviction but low reward)
- Sweet spot for trading: $0.35-$0.65

### Minimum Order
- $1 USDC minimum works fine on BTC 5m markets
- Use `getTickSize(tokenID)` to get correct tick size for pricing

### Order Types
- **GTC** (Good-Til-Cancelled): Default. Sits on book until filled or cancelled.
- **FOK** (Fill-Or-Kill): Fill immediately or cancel entirely.
- **GTD** (Good-Til-Date): Expires at specified time.

---

## 9. Common Pitfalls

1. **Don't BUY in the last 90 seconds**: Prices go extreme, spreads widen, hard to exit
2. **ALWAYS SELL 30s before close**: This is the #1 rule. Sell at best bid 30s before endDate. This avoids the redeem problem entirely.
3. **Don't ignore fees**: 10% fee means you need >10% price move to profit
4. **Don't chase**: If you missed the move, wait for next market
5. **Check balance first**: Need at least $1 USDC to place a trade
6. **Watch for no market**: Between market cycles there may be no active market
7. **Price to Beat may be null**: If market hasn't started yet, priceToBeat is null
8. **Resolution takes time**: After endDate, it may take 10-60 seconds for resolution
9. **Winning tokens do NOT auto-convert to USDC**: You MUST sell before close. If you miss the sell window, tokens go to resolution and owner must manually redeem via polymarket.com. Bot cannot auto-redeem yet.
10. **If sell before close fails**: Don't panic. Owner will manually claim via Polymarket UI. Post a warning message and continue to next market.
11. **USDC balance doesn't update after resolution**: Until manual redeem, USDC balance stays the same. Always check /api/redeemable to see pending claims.
12. **Fixed size for now**: Always trade $1 per market. With $50 bankroll that's 50 trades before running out (without wins). Scale up when profitable.

---

## 10. Quick Reference for Agent

### Before First Trade
```
1. GET /api/dashboard → check balance.proxy.usdc
2. If balance < $1.00 → cannot trade, post message and wait
3. Check market exists and has > 90s remaining
```

### Trade Flow
```
1. GET /api/dashboard → get market.conditionId, upPrice, downPrice, priceToBeat
2. Analyze (see strategies above)
3. POST /api/trade → { market: conditionId, outcome: "YES"|"NO", size: "5" }
4. POST /api/bot-message → explain the trade
5. Monitor via /api/dashboard every 15s
6. At timeLeft <= 30s → POST /api/sell (ALWAYS, win or lose!)
7. If sell fails → post warning "Manual redeem needed" and continue
8. After resolution → check /api/profile for result
```

### Available Cash Check
```
GET /api/dashboard → response.balances.proxy.usdc
```

### Current Position Check
```
GET /api/profile → response.positions (array of open positions)
GET /api/open-orders → array of pending orders
```

---

### Redeem Check (for owner)
```
GET /api/redeemable → lists positions that went to resolution without selling
If count > 0 → owner goes to polymarket.com to claim manually
Bot should post warning: "X positions need manual redeem ($Y value)"
```

---

*Written for ClawBot Autonomous Agent | rPoly v2.5.0 | Feb 17, 2026*
