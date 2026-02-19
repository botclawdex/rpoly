/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║           rPoly Autonomous Agent — Polymarket BTC 5-Minute Trading      ║
 * ║                                                                          ║
 * ║  Runs continuously: monitors markets, executes trades, manages exits    ║
 * ║  Uses brain/strategy.js for decisions                                    ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Usage:
 *   node autonomous-agent/agent.js
 *
 * Requires:
 *   - rpoly server running on localhost:3001
 *   - RPOLY_AUTH_TOKEN set in .env (or dev mode without auth)
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env") });
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// ===== CONFIG =====
const API_BASE = process.env.API_BASE || "http://localhost:3001";
const AUTH_TOKEN = process.env.RPOLY_AUTH_TOKEN || "";
const POLL_INTERVAL_MS = 3000;  // Check every 3 seconds
// PRE_CLOSE_SEC loaded from strategy profile below
const MIN_TIME_TO_TRADE_SEC = 180;  // Never trade with less than 3 min left
const LOG_FILE = path.join(__dirname, "..", "trades", "agent-log.json");

// Telegram reporting (replaces LLM-powered cron jobs)
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || "";
const TG_CHAT_ID = process.env.TG_CHAT_ID || "";
const TG_REPORT_INTERVAL_MS = 5 * 60 * 1000; // Every 5 minutes
let lastTgReportTime = 0;

// Position management — loaded from strategy-profiles.json
const STRATEGY_FILE = path.join(__dirname, "..", "brain", "strategy-profiles.json");
let activeStrategy = {};
try {
  const sp = JSON.parse(fs.readFileSync(STRATEGY_FILE, "utf8"));
  activeStrategy = sp.profiles[sp.active] || {};
  console.log(`[agent] Loaded strategy profile: ${sp.active} (${activeStrategy.name})`);
} catch (e) {
  console.log("[agent] Failed to load strategy-profiles.json, using defaults:", e.message);
}
const TAKE_PROFIT_PCT = activeStrategy.tpTrigger || 0.20;
const STOP_LOSS_PCT = activeStrategy.stopLoss || -0.20;
const EMERGENCY_LOSS_PCT = activeStrategy.emergencyLoss || -0.40;
const MIN_HOLD_FOR_TP = activeStrategy.minHoldTP || 45;
const MIN_HOLD_FOR_SL = activeStrategy.minHoldSL || 30;
const PRE_CLOSE_SEC = activeStrategy.preCloseSec || 45;
const TP_TRAIL_PCT = activeStrategy.tpTrail || 0;
const HOLD_ZONE_MIN = activeStrategy.holdZoneMin || 0;
const HOLD_ZONE_MAX = activeStrategy.holdZoneMax || TAKE_PROFIT_PCT;
const MIN_HOLD_FOR_EMERGENCY = activeStrategy.minHoldEmergency || 5;
const CATASTROPHIC_LOSS_PCT = activeStrategy.catastrophicLoss || -0.30;
const PROFIT_PROTECT_PCT = activeStrategy.profitProtect || 0.08;
const PROFIT_PROTECT_TRAIL = activeStrategy.profitProtectTrail || 0.10;
const POSITION_LOG_INTERVAL = 5000;
let lastPositionLogTime = 0;

// Noise filter: track recent bids to avoid selling on momentary flash crashes
const bidHistories = {};          // per-market bid histories
const BID_HISTORY_WINDOW = 20000;  // 20s window
const BID_HISTORY_MIN = 3;        // need at least 3 readings to confirm trend (not just noise)
const lastSellTimes = {};          // per-market sell time tracking
const positionBuyTimes = {};      // conditionId → buy timestamp (for multi-position SL cooldown)
const positionPeaks = {};         // conditionId → { pnl, smoothed } peak tracking
const doubledDown = {};           // conditionId → true if already doubled down

// 15-min Trend Confirm state
const trendSamples = {};          // conditionId → [{ ts, price }] — BTC price samples

// Forced trade settings
const FORCED_TRADE_HOUR = 15 * 60 * 1000;  // Every 15 minutes (learning phase)
const FORCED_TRADE_MIN_VOLUME = 50;         // Minimum volume for forced trade
const FORCED_TRADE_AMOUNT = 1.00;          // $1.00 minimum on Polymarket

// ===== STATE =====
let state = {
  currentMarketId: null,
  position: null,        // { side, size, price, marketId }
  lastAction: null,
  lastActionTime: 0,
  lastTradeTime: 0,      // Only updates on actual BUY/FORCED (not SKIP)
  resolvedMarkets: new Set(),
  soldMarkets: new Set(),  // Markets where we already sold — prevent double sell
  consecutiveErrors: 0,
  todayPnl: 0,
  tradeCount: 0,
  peakPnlPct: 0,         // Trailing stop: highest P/L % seen for current position
};

// Load persisted state
function loadState() {
  try {
    if (fs.existsSync(LOG_FILE)) {
      const saved = JSON.parse(fs.readFileSync(LOG_FILE, "utf8"));
      const toSet = (v) => new Set(Array.isArray(v) ? v : Object.keys(v || {}));
      state = {
        ...state,
        ...saved,
        resolvedMarkets: toSet(saved.resolvedMarkets),
        soldMarkets: toSet(saved.soldMarkets),
      };
      console.log("[agent] Loaded state:", JSON.stringify(state, null, 2));
    }
  } catch (e) {
    console.log("[agent] No state to load, starting fresh");
  }
}

// Save state
function saveState() {
  try {
    const toSave = {
      ...state,
      resolvedMarkets: Array.from(state.resolvedMarkets),
      soldMarkets: Array.from(state.soldMarkets),
    };
    fs.writeFileSync(LOG_FILE, JSON.stringify(toSave, null, 2));
  } catch (e) {
    console.log("[agent] Failed to save state:", e.message);
  }
}

// ===== API HELPERS =====
const api = axios.create({ baseURL: API_BASE, timeout: 10000 });

if (AUTH_TOKEN) {
  api.defaults.headers.common["Authorization"] = `Bearer ${AUTH_TOKEN}`;
}

async function getDashboard() {
  try {
    const res = await api.get("/api/dashboard");
    return res.data;
  } catch (e) {
    console.log("[agent] Dashboard error:", e.message);
    return null;
  }
}

async function analyzeMarket(market, btcPrice, bankroll, timeLeftSec) {
  try {
    const res = await api.post("/api/brain/analyze", {
      market,
      btcPrice,
      bankroll,
      timeLeftSec
    });
    return res.data;
  } catch (e) {
    console.log("[agent] Brain analyze error:", e.message);
    return null;
  }
}

// ===== TREND CONFIRM (15-min markets) =====
async function fetchBtcPrice() {
  try {
    const res = await axios.get("https://api.binance.com/api/v3/ticker/price", {
      params: { symbol: "BTCUSDT" }, timeout: 3000,
    });
    return parseFloat(res.data.price) || 0;
  } catch (e) { return 0; }
}

function trendConfirmDecision(samples, priceToBeat) {
  if (!samples || samples.length < 8 || !priceToBeat) return null;

  const prices = samples.map(s => s.price);
  const latest = prices[prices.length - 1];
  const oldest = prices[0];

  // Linear regression slope
  const n = prices.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i; sumY += prices[i]; sumXY += i * prices[i]; sumX2 += i * i;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const slopePerSec = slope / (POLL_INTERVAL_MS / 1000);

  // Trend strength: how consistently is it moving in one direction?
  let ups = 0, downs = 0;
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] > prices[i - 1]) ups++;
    else if (prices[i] < prices[i - 1]) downs++;
  }
  const consistency = Math.max(ups, downs) / (ups + downs || 1);

  // Distance from priceToBeat
  const distPct = (latest - priceToBeat) / priceToBeat;
  const trendPct = (latest - oldest) / oldest;

  // Projected price at end (extrapolate remaining time)
  const remainingSamples = 30; // rough: ~90s more of observation
  const projected = latest + slope * remainingSamples;
  const projectedVsPtb = (projected - priceToBeat) / priceToBeat;

  // Decision logic
  let side = null;
  let confidence = 0;
  let reason = "";

  if (slope < 0 && distPct < 0) {
    // BTC falling AND already below PtB → strong DOWN
    side = "NO";
    confidence = 0.60 + consistency * 0.20 + Math.min(Math.abs(distPct) * 5, 0.15);
    reason = `BTC falling (${(trendPct*100).toFixed(3)}%) & below PtB by ${(distPct*100).toFixed(3)}%`;
  } else if (slope < 0 && distPct > 0 && distPct < 0.001) {
    // BTC falling, barely above PtB → likely DOWN
    side = "NO";
    confidence = 0.55 + consistency * 0.15;
    reason = `BTC falling toward PtB (gap ${(distPct*100).toFixed(3)}%, trend ${(trendPct*100).toFixed(3)}%)`;
  } else if (slope > 0 && distPct > 0) {
    // BTC rising AND above PtB → strong UP
    side = "YES";
    confidence = 0.60 + consistency * 0.20 + Math.min(distPct * 5, 0.15);
    reason = `BTC rising (${(trendPct*100).toFixed(3)}%) & above PtB by ${(distPct*100).toFixed(3)}%`;
  } else if (slope > 0 && distPct < 0 && distPct > -0.001) {
    // BTC rising, barely below PtB → likely UP
    side = "YES";
    confidence = 0.55 + consistency * 0.15;
    reason = `BTC rising toward PtB (gap ${(distPct*100).toFixed(3)}%, trend ${(trendPct*100).toFixed(3)}%)`;
  } else {
    // Mixed signals — still buy but lower confidence
    const projUp = projectedVsPtb > 0;
    side = projUp ? "YES" : "NO";
    confidence = 0.50 + consistency * 0.10;
    reason = `Mixed: slope ${slope > 0 ? '+' : ''}${(trendPct*100).toFixed(3)}%, dist ${(distPct*100).toFixed(3)}% → projected ${projUp ? 'UP' : 'DOWN'}`;
  }

  return {
    action: "BUY",
    side,
    amount: 1,
    confidence: Math.min(confidence, 0.95),
    reason,
    stats: { slope, slopePerSec, consistency, distPct, trendPct, projectedVsPtb, samples: n },
  };
}

async function executeTrade(marketId, side, size, price, asset) {
  try {
    const apiSide = side === "YES" ? "UP" : side === "NO" ? "DOWN" : side;
    const orderSize = 1;
    const body = { side: apiSide, size: orderSize.toString(), asset: asset || 'BTC' };
    console.log("[agent] Trade request:", JSON.stringify(body));
    const res = await api.post("/api/trade", body);
    const data = res.data;
    log("INFO", `[trade] Result: success=${data?.success} status=${data?.status} price=${data?.price} orderID=${data?.orderID?.slice(0,10)}...`);

    // Check if order was actually filled vs resting
    if (data?.status === "live") {
      log("WARN", `[trade] ⚠️ Order is RESTING on book (not matched). May not fill.`);
    } else if (data?.status === "matched") {
      log("INFO", `[trade] ✅ Order MATCHED immediately!`);
    }
    return data;
  } catch (e) {
    console.log("[agent] Trade error:", e.message, e.response?.data?.error || "");
    return null;
  }
}

async function sellPosition(marketId, side, size, asset) {
  const apiSide = side === "YES" ? "UP" : side === "NO" ? "DOWN" : side;
  let sellSize = parseFloat(size) || 1;
  if (sellSize < 0.01) {
    log("INFO", `[sell] Size too small (${sellSize}) — skipping`);
    return { success: true, skipped: true };
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      log("INFO", `[sell] Attempt ${attempt}: ${apiSide} x${sellSize.toFixed(4)} (${asset || 'BTC'})`);
      const res = await api.post("/api/sell", {
        side: apiSide,
        size: sellSize.toString(),
        asset: asset || 'BTC'
      });
      log("INFO", `[sell] Response: success=${res.data?.success} price=${res.data?.price} error=${res.data?.error || "none"}`);
      if (res.data?.success) return res.data;

      const err = res.data?.error || "";
      if (err.includes("not enough balance") || err.includes("allowance") || err.includes("fully filled")) {
        log("WARN", `[sell] Failed (${err}) — refreshing position size from API...`);
        await sleep(1500);
        try {
          const freshDash = await getDashboard();
          if (freshDash?.positions) {
            const sideUp = apiSide === "UP";
            const freshPos = freshDash.positions.find(p =>
              p.conditionId === marketId && parseFloat(p.size) > 0.01 &&
              (sideUp ? ["Up","Yes","UP","YES"].includes(p.side) : ["Down","No","DOWN","NO"].includes(p.side))
            );
            if (freshPos) {
              const freshSize = parseFloat(freshPos.size);
              log("INFO", `[sell] Refreshed: ${freshSize.toFixed(4)} shares (was ${sellSize.toFixed(4)})`);
              sellSize = freshSize;
            } else {
              log("INFO", `[sell] Position gone from API — already sold`);
              return { success: true };
            }
          }
        } catch (e2) {
          log("WARN", `[sell] Refresh failed: ${e2.message}`);
        }
        continue;
      }
      return res.data;
    } catch (e) {
      const serverError = e.response?.data;
      log("WARN", `[sell] FAILED attempt ${attempt}: ${e.message}`);
      if (attempt === 3) return serverError || null;
      await sleep(1000);
    }
  }
  return null;
}

function positionExtra(exitType = "resolution") {
  if (!state.position) return { exitType };
  return {
    asset: state.position.asset, timeLeftAtEntry: state.position.timeLeftAtEntry,
    spreadAtEntry: state.position.spreadAtEntry, cryptoPrice: state.position.cryptoPrice,
    priceToBeat: state.position.priceToBeat, exitType, signalStrength: state.position.signalStrength,
  };
}

async function recordResult(won, pnl, side, amount, price, confidence, strategies, regime, extra = {}) {
  try {
    const res = await api.post("/api/brain/record", {
      won,
      pnl,
      side,
      amount,
      price,
      confidence,
      strategies: strategies || [],
      regime: regime || "unknown",
      asset: extra.asset || "BTC",
      timeLeftAtEntry: extra.timeLeftAtEntry || null,
      spreadAtEntry: extra.spreadAtEntry || null,
      cryptoPrice: extra.cryptoPrice || null,
      priceToBeat: extra.priceToBeat || null,
      exitType: extra.exitType || "resolution",
      signalStrength: extra.signalStrength || null,
    });
    return res.data;
  } catch (e) {
    console.log("[agent] Record error:", e.message);
    return null;
  }
}

async function sellOrphanedPositions(allPositions, currentMarketId) {
  if (!allPositions || allPositions.length === 0) return;

  const orphans = allPositions.filter(p => {
    if (p.conditionId === currentMarketId) return false;
    const size = parseFloat(p.size) || 0;
    const curPrice = parseFloat(p.curPrice);
    if (size <= 0) return false;
    // curPrice=0 or curPrice=1 means market resolved — can't sell, only redeem
    if (curPrice <= 0 || curPrice >= 1) return false;
    return true;
  });

  if (orphans.length === 0) return;

  log("WARN", `Found ${orphans.length} orphaned position(s) from old markets — attempting to sell`);

  for (const pos of orphans) {
    const size = Math.floor(parseFloat(pos.size) || 0);
    if (size < 1) continue;

    log("INFO", `  Selling orphan: ${pos.title?.slice(0, 50)} | ${pos.side} x${size} | curPrice=$${pos.curPrice}`);

    if (!pos.asset) {
      log("WARN", `  No tokenId for orphan — skipping`);
      continue;
    }

    try {
      const res = await api.post("/api/sell-orphan", {
        tokenId: pos.asset,
        size: size.toString(),
      });

      if (res.data?.success) {
        log("TRADE", `  Orphan SOLD: ${pos.side} x${size} from ${pos.title?.slice(0, 40)}`);
        await sendTelegram(`♻️ Orphan sold: ${pos.side} x${size}\n${pos.title?.slice(0, 50)}`);
      } else {
        log("WARN", `  Orphan sell failed: ${res.data?.error || "unknown"}`);
      }
    } catch (e) {
      log("WARN", `  Orphan sell error: ${e.message}`);
    }

    await sleep(1000);
  }
}

async function postBotMessage(text) {
  try {
    await api.post("/api/bot-message", { text });
    console.log(`[agent] 📢 ${text}`);
  } catch (e) {
    console.log("[agent] Bot message error:", e.message);
  }
}

async function cancelAllOrders() {
  try {
    await api.post("/api/cancel-all");
    console.log("[agent] Cancelled all orders");
  } catch (e) {
    console.log("[agent] Cancel error:", e.message);
  }
}

// ===== TELEGRAM (direct, no LLM) =====
async function sendTelegram(text) {
  try {
    await axios.post(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      chat_id: TG_CHAT_ID,
      text,
      parse_mode: "Markdown"
    }, { timeout: 8000 });
  } catch (e) {
    // Markdown might fail — retry without parse_mode
    try {
      await axios.post(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
        chat_id: TG_CHAT_ID,
        text: text.replace(/[*_`\[\]]/g, ""),
      }, { timeout: 5000 });
    } catch (e2) { /* give up */ }
    console.log("[agent] Telegram error:", e.message);
  }
}

async function sendStatusReport(dashboard, brainStatus) {
  const now = Date.now();
  if (now - lastTgReportTime < TG_REPORT_INTERVAL_MS) return;
  lastTgReportTime = now;

  try {
    const market = dashboard?.market;
    const timeLeftSec = market?.endDate
      ? Math.max(0, Math.floor((new Date(market.endDate).getTime() - now) / 1000))
      : 0;
    const mins = Math.floor(timeLeftSec / 60);
    const secs = timeLeftSec % 60;

    // Position from dashboard (live) or local state
    const livePos = dashboard?.positions?.find(p => p.conditionId === market?.conditionId);
    const pos = livePos
      ? `${livePos.size} ${livePos.side} @ $${livePos.avgPrice || "?"}`
      : state.position
        ? `${state.position.size} ${state.position.side} @ $${state.position.price}`
        : "brak";
    const balance = dashboard?.balances?.proxy?.usdc?.toFixed(2) || "?";

    // Fetch REAL proxy wallet stats from Polymarket Data API
    let profile = null;
    try {
      const profileRes = await api.get("/api/profile");
      profile = profileRes.data;
    } catch (e) { /* ignore */ }

    const realWins = profile?.wins ?? 0;
    const realLosses = profile?.losses ?? 0;
    const realTrades = profile?.marketsTraded ?? 0;
    const realWinRate = profile?.winRate ?? 0;
    const realizedPnl = profile?.realizedPnl ?? 0;
    const totalPnl = profile?.totalPnl ?? 0;
    const posValue = profile?.positionsValue ?? 0;

    // Brain stage
    const b = brainStatus || {};
    const stage = b?.identity?.stage || "?";
    const streak = b?.memory?.currentStreak ?? 0;

    const lastAct = state.lastAction || "none";
    const upPrice = market?.upPrice || "?";
    const downPrice = market?.downPrice || "?";

    const msg = `📊 *rPoly Agent*
├ Market: ${market?.question?.slice(0, 45) || "brak"}
├ Time: ${timeLeftSec > 0 ? `${mins}m ${secs}s` : "expired"}
├ Prices: UP $${upPrice} | DOWN $${downPrice}
├ Position: ${pos}
├ Balance: $${balance} | Pos: $${Number(posValue).toFixed(2)}
├ P/L: $${Number(totalPnl).toFixed(2)} open | $${Number(realizedPnl).toFixed(2)} realized
├ Record: ${realWins}W/${realLosses}L (${realTrades} mkts, ${realWinRate}% WR)
├ Brain: ${stage} (streak ${streak})
└ Last: ${lastAct}`;

    await sendTelegram(msg);
  } catch (e) {
    console.log("[agent] Status report error:", e.message);
  }
}

// ===== LOGGING =====
function log(level, msg) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp.split("T")[1].slice(0,8)}] [${level}] ${msg}`);
}

// ===== MAIN AGENT LOOP =====
async function runAgent() {
  console.log("=".repeat(60));
  console.log(`🦞 rPoly Agent v5.0 — SIMPLE (${activeStrategy.name})`);
  console.log(`📡 API: ${API_BASE}`);
  console.log(`💡 Strategy: SL:${(STOP_LOSS_PCT*100).toFixed(0)}% | TP:+${(TAKE_PROFIT_PCT*100).toFixed(0)}% | Pre-close: ${PRE_CLOSE_SEC}s`);
  console.log(`🎯 Safety: Emergency:${(EMERGENCY_LOSS_PCT*100).toFixed(0)}% | Catastrophic:${(CATASTROPHIC_LOSS_PCT*100).toFixed(0)}%`);
  console.log(`📈 15m: Trend Confirm | $1/trade`);
  console.log(`💰 Entry: max $0.50 | Hold: winners→resolution, losers→pre-close sell`);
  console.log(`⏱️  Poll: ${POLL_INTERVAL_MS}ms | No HardTP, no InstantKill, no ProfitProtect`);
  console.log("=".repeat(60));

  loadState();

  // If never traded, set lastTradeTime to now (wait 15 min before first forced trade)
  if (!state.lastTradeTime) {
    state.lastTradeTime = Date.now();
    saveState();
    log("INFO", "First run — forced trade will fire in 15 min");
  }

  // Startup: check for orphaned positions from previous runs
  try {
    log("INFO", "Checking for orphaned positions from previous runs...");
    const startupDash = await getDashboard();
    if (startupDash?.positions?.length > 0) {
      await sellOrphanedPositions(startupDash.positions, state.currentMarketId);
    }
  } catch (e) {
    log("WARN", "Startup orphan check failed: " + e.message);
  }

  while (true) {
    try {
      const dashboard = await getDashboard();
      if (!dashboard) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      const allMarkets = dashboard.markets || [];
      if (allMarkets.length === 0 && !dashboard.market) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      // Use markets array (BTC + ETH + SOL); fallback to single market for backward compat
      const marketsToProcess = allMarkets.length > 0
        ? allMarkets
        : (dashboard.market ? [{ ...dashboard.market, orderbook: dashboard.orderbook, downOrderbook: dashboard.downOrderbook }] : []);

      const { btc, balances, positions } = dashboard;
      const bankroll = balances?.proxy?.usdc || 0;

      // Sell orphaned positions from markets not in current set
      const activeConditionIds = new Set(marketsToProcess.map(m => m.conditionId));
      if (positions && positions.length > 0) {
        const orphans = positions.filter(p => !activeConditionIds.has(p.conditionId) && parseFloat(p.size) > 0);
        if (orphans.length > 0) {
          await sellOrphanedPositions(orphans, null);
        }
      }

      // Keep only recent soldMarkets — trim oldest entries, keep last 50
      if (state.soldMarkets.size > 50) {
        const arr = Array.from(state.soldMarkets);
        const keep = arr.slice(-30);
        state.soldMarkets = new Set(keep);
      }

      for (const mktData of marketsToProcess) {
      const market = mktData;
      const orderbook = mktData.orderbook || null;
      const downOrderbook = mktData.downOrderbook || null;
      const assetName = market.asset || 'BTC';

      // Per-market bid history and sell time
      let bidHistory = bidHistories[market.conditionId] || [];
      let lastSellTime = lastSellTimes[market.conditionId] || 0;

      const timeLeftSec = market.endDate
        ? Math.max(0, Math.floor((new Date(market.endDate).getTime() - Date.now()) / 1000))
        : 0;

      // Real orderbook prices (best bid = what you get when selling)
      const upBestBid = orderbook?.bestBid ? parseFloat(orderbook.bestBid.price) : null;
      const downBestBid = downOrderbook?.bestBid ? parseFloat(downOrderbook.bestBid.price) : null;
      if (upBestBid !== null || downBestBid !== null) {
        log("INFO", `📖 [${assetName}] Orderbook: UP bid=$${upBestBid || '?'} | DN bid=$${downBestBid || '?'} | UP mid=$${market.upPrice} | DN mid=$${market.downPrice}`);
      }

      // === CHECK IF WE HAVE POSITIONS ===
      let myPositions = [];
      if (positions && positions.length > 0) {
        myPositions = positions.filter(p => p.conditionId === market.conditionId && parseFloat(p.size) > 0);
      }
      // FALLBACK: if API hasn't returned position yet but we know we bought, create synthetic entry
      if (myPositions.length === 0 && positionBuyTimes[market.conditionId] && state.position?.marketId === market.conditionId) {
        const sideLabel = state.position.side === "YES" ? "Up" : "Down";
        myPositions = [{
          side: sideLabel,
          size: state.position.size,
          avgPrice: state.position.price,
          curPrice: null,
          conditionId: market.conditionId,
          synthetic: true,
        }];
      }
      const alreadyBought = !!positionBuyTimes[market.conditionId];
      const canBuyThisMarket = !state.soldMarkets.has(market.conditionId) && !alreadyBought;
      let myPosition = myPositions.length > 0 ? myPositions[0] : null;

      // === PRE-CLOSE SELL (CRITICAL!) ===
      // Sell ALL positions for this market before close
      // Skip if we already completed pre-close for this market (Data API lags 3-5s)
      const preCloseDone = state.soldMarkets.has(market.conditionId) && !state.position;
      const positionsToSell = (!preCloseDone && myPositions.length > 0)
        ? myPositions
        : (!preCloseDone && state.position && state.position.marketId === market.conditionId)
          ? [{ side: state.position.side, size: state.position.size, avgPrice: state.position.price, curPrice: null }]
          : [];

      if (positionsToSell.length > 0 && timeLeftSec <= PRE_CLOSE_SEC) {
        for (const pos of positionsToSell) {
          const sideUp = ["Up", "Yes", "UP", "YES"].includes(pos.side);
          const outcome = sideUp ? "YES" : "NO";
          const size = parseFloat(pos.size) || 1;
          const apiAvgPrice = parseFloat(pos.avgPrice) || 0;
          const statePrice = parseFloat(state.position?.price) || 0;
          const entryPrice = apiAvgPrice > 0 ? apiAvgPrice : (statePrice > 0 ? statePrice : 0.50);
          const realBid = sideUp ? upBestBid : downBestBid;
          const midPrice = sideUp ? parseFloat(market.upPrice) : parseFloat(market.downPrice);
          const rawCurPrice = realBid || parseFloat(pos.curPrice) || midPrice || 0;
          const curPrice = rawCurPrice > 0 ? rawCurPrice : entryPrice;
          const hasRealExitPrice = rawCurPrice > 0;
          const prePnlPct = entryPrice > 0 ? (curPrice - entryPrice) / entryPrice : 0;

          // WINNING positions: hold to resolution for $1.00 payout
          if (prePnlPct > 0) {
            log("INFO", `💎 PRE-CLOSE HOLD: ${size.toFixed(2)} ${outcome} WINNING +${(prePnlPct*100).toFixed(1)}% (bid $${curPrice.toFixed(3)} > entry $${entryPrice.toFixed(3)}) — holding for $1.00 resolution`);
            continue;
          }

          log("WARN", `PRE-CLOSE SELL: ${timeLeftSec}s left | LOSING ${(prePnlPct*100).toFixed(1)}% — cutting loss`);
          log("INFO", `  Selling ${size.toFixed(4)} ${outcome} (entry $${entryPrice.toFixed(4)}, now $${curPrice.toFixed(4)}${hasRealExitPrice ? '' : ' [no live price]'})`);
          let sellResult = await sellPosition(market.conditionId, outcome, size, assetName);

          // Retry with fresh position data if sell failed
          if (!sellResult || !sellResult.success) {
            log("WARN", `  Pre-close sell failed (${sellResult?.error || 'unknown'}) — refreshing & retrying in 2s...`);
            await sleep(2000);
            try {
              const freshDash = await getDashboard();
              if (freshDash?.positions) {
                const freshPos = freshDash.positions.find(p =>
                  p.conditionId === market.conditionId &&
                  parseFloat(p.size) > 0.01 &&
                  (sideUp ? ["Up", "Yes", "UP", "YES"].includes(p.side) : ["Down", "No", "DOWN", "NO"].includes(p.side))
                );
                if (freshPos) {
                  const freshSize = parseFloat(freshPos.size);
                  log("INFO", `  Refreshed size: ${freshSize.toFixed(4)} (was ${size.toFixed(4)})`);
                  sellResult = await sellPosition(market.conditionId, outcome, freshSize, assetName);
                } else {
                  log("INFO", `  Position gone after refresh — sold successfully`);
                  sellResult = { success: true };
                }
              } else {
                sellResult = await sellPosition(market.conditionId, outcome, size, assetName);
              }
            } catch (e) {
              sellResult = await sellPosition(market.conditionId, outcome, size, assetName);
            }
          }

          if (sellResult && sellResult.success) {
            const pnlUsd = (curPrice - entryPrice) * size;
            const pnlPct = entryPrice > 0 ? ((curPrice - entryPrice) / entryPrice * 100).toFixed(1) : "?";
            const pnlIcon = pnlUsd >= 0 ? "💰" : "📉";

            log("TRADE", `PRE-CLOSE SOLD: ${size.toFixed(2)} ${outcome} | $${entryPrice.toFixed(4)} -> ~$${curPrice.toFixed(4)} | P/L: ${pnlUsd >= 0 ? '+' : ''}$${pnlUsd.toFixed(2)} (${pnlPct}%)`);
            await sendTelegram(`⏰ *PRE-CLOSE* ${outcome} x${size.toFixed(2)}\n${pnlIcon} Entry $${entryPrice.toFixed(3)} → Exit ~$${curPrice.toFixed(3)}\n📊 P/L: ${pnlUsd >= 0 ? '+' : ''}$${pnlUsd.toFixed(2)} (${pnlPct}%)\n⏱️ ${timeLeftSec}s left`);
            const won = pnlUsd > 0;
            if (!hasRealExitPrice) {
              log("INFO", "Skipping brain-memory — no real exit price");
            } else if (state.position && state.position.strategies && state.position.strategies.length > 0) {
              await recordResult(won, pnlUsd, outcome, size, entryPrice, state.position.confidence || 0.5, state.position.strategies, "unknown", {
                asset: state.position.asset, timeLeftAtEntry: state.position.timeLeftAtEntry, spreadAtEntry: state.position.spreadAtEntry,
                cryptoPrice: state.position.cryptoPrice, priceToBeat: state.position.priceToBeat, exitType: "pre-close", signalStrength: state.position.signalStrength,
              }).catch(() => {});
            } else {
              log("INFO", "Skipping brain-memory record — not our position");
            }
          } else {
            log("WARN", `PRE-CLOSE SELL FAILED for ${outcome} after retry — position may be abandoned!`);
            await sendTelegram(`🚨 *PRE-CLOSE FAILED* ${outcome} x${size.toFixed(2)} — could not sell!`);
          }
        }

        // Only clear state if we actually sold (not if we're holding winners to resolution)
        const anyWinning = positionsToSell.some(pos => {
          const ep = parseFloat(pos.avgPrice) || parseFloat(state.position?.price) || 0.50;
          const sUp = ["Up", "Yes", "UP", "YES"].includes(pos.side);
          const rb = sUp ? upBestBid : downBestBid;
          const cp = rb || parseFloat(pos.curPrice) || (sUp ? parseFloat(market.upPrice) : parseFloat(market.downPrice)) || ep;
          return ep > 0 && cp > ep;
        });
        if (!anyWinning) {
          if (state.position?.marketId === market.conditionId) state.position = null;
          delete positionPeaks[market.conditionId];
          delete positionBuyTimes[market.conditionId];
          state.soldMarkets.add(market.conditionId);
          saveState();
        }
      }

      // === POSITION MONITORING: Take-Profit & Stop-Loss ===
      // Works with Data API position OR state position — whichever is available
      // Monitor ALL positions for this market
      for (const posItem of myPositions) {
      // DOUBLE-SELL PROTECTION: skip monitoring if we already sold this market
      if (state.soldMarkets.has(market.conditionId)) {
        log("INFO", `⏭️ [${assetName}] Skipping monitoring — already sold (API lag)`);
        break;
      }
      if (posItem && timeLeftSec > PRE_CLOSE_SEC) {
        const isOurBuy = state.position && (
          (state.position.side === "YES" && ["Up", "Yes", "UP", "YES"].includes(posItem.side)) ||
          (state.position.side === "NO" && ["Down", "No", "DOWN", "NO"].includes(posItem.side))
        );
        // ALWAYS prefer Data API avgPrice (real fill price) over state.position.price (midpoint estimate)
        const apiAvgPrice = parseFloat(posItem.avgPrice) || 0;
        const statePrice = isOurBuy ? parseFloat(state.position.price) : 0;
        const entryPrice = apiAvgPrice > 0 ? apiAvgPrice : (statePrice > 0 ? statePrice : 0.50);

        // Update state.position.price if API has better data
        if (isOurBuy && apiAvgPrice > 0 && Math.abs(apiAvgPrice - statePrice) > 0.01) {
          state.position.price = apiAvgPrice;
          saveState();
        }

        const sideUp = ["Up", "Yes", "UP", "YES"].includes(posItem.side);
        const realBid = sideUp ? upBestBid : downBestBid;
        const midPrice = sideUp ? parseFloat(market.upPrice) : parseFloat(market.downPrice);
        const apiCurPrice = parseFloat(posItem.curPrice) || 0;
        const curPrice = realBid || apiCurPrice || midPrice || 0;
        const apiSize = parseFloat(posItem.size) || 1;
        const outcome = sideUp ? "YES" : "NO";

        // Skip if we just sold this position (API lag protection — Data API can lag 5-15s)
        if (lastSellTime > 0 && Date.now() - lastSellTime < 30000) {
          log("INFO", `⏭️ [${assetName}] Skip monitoring — sold ${((Date.now() - lastSellTime) / 1000).toFixed(0)}s ago (API lag)`);
          break;
        }

        // NOISE FILTER: track recent bids, use median to avoid flash-crash false triggers
        const now = Date.now();
        bidHistory.push({ price: curPrice, time: now });
        bidHistory = bidHistory.filter(b => now - b.time < BID_HISTORY_WINDOW).slice(-5);

        const sortedBids = bidHistory.map(b => b.price).sort((a, b) => a - b);
        const medianBid = sortedBids.length >= 2
          ? sortedBids[Math.floor(sortedBids.length / 2)]
          : curPrice;

        // Instant P/L (for logging) and smoothed P/L (for sell decisions)
        const pnlPct = entryPrice > 0 ? (curPrice - entryPrice) / entryPrice : 0;
        const smoothedPnl = entryPrice > 0 ? (medianBid - entryPrice) / entryPrice : 0;
        const pnlUsd = (curPrice - entryPrice) * apiSize;
        const hasEnoughReadings = bidHistory.length >= BID_HISTORY_MIN;

        const buyTime = positionBuyTimes[market.conditionId] || state.lastTradeTime || 0;
        const holdSec = buyTime > 0 ? Math.floor((Date.now() - buyTime) / 1000) : 999;
        const bigWin = smoothedPnl >= TAKE_PROFIT_PCT;
        const tpCooldown = holdSec < MIN_HOLD_FOR_TP && !bigWin;
        const slCooldown = holdSec < MIN_HOLD_FOR_SL;
        const isEmergency = smoothedPnl <= EMERGENCY_LOSS_PCT;

        if (Date.now() - lastPositionLogTime > POSITION_LOG_INTERVAL) {
          const direction = pnlPct >= 0 ? "📈" : "📉";
          const src = apiAvgPrice > 0 ? "API" : "est";
          const bidCount = bidHistory.length;
          log("INFO", `${direction} Position: ${apiSize.toFixed(2)} ${outcome} | Entry $${entryPrice.toFixed(4)} -> Bid $${curPrice.toFixed(4)} (med $${medianBid.toFixed(4)}) | P/L: ${(pnlPct * 100).toFixed(1)}% (smooth ${(smoothedPnl * 100).toFixed(1)}%) | Hold: ${holdSec}s | ${timeLeftSec}s left [${src}] [${bidCount} samples]`);
          lastPositionLogTime = Date.now();
        }

        // INSTANT KILL: DISABLED — original simple strategy holds positions
        const isLateEntry = false;

        // CATASTROPHIC/EMERGENCY: DISABLED — simple mode, only TP/SL + pre-close
        if (tpCooldown && slCooldown) {
          if (Date.now() - lastPositionLogTime > 10000) {
            log("INFO", `Holding (${holdSec}s / TP:${MIN_HOLD_FOR_TP}s SL:${MIN_HOLD_FOR_SL}s) — P/L: ${(pnlPct * 100).toFixed(1)}%`);
          }
        } else {
          // ===== SIMPLE ORIGINAL STRATEGY: only TP and SL, hold everything else to pre-close =====
          const cleanupAfterSell = () => {
            if (state.position?.marketId === market.conditionId) state.position = null;
            delete positionPeaks[market.conditionId];
            delete positionBuyTimes[market.conditionId];
            delete doubledDown[market.conditionId];
            state.soldMarkets.add(market.conditionId);
            lastSellTime = Date.now();
            bidHistory = [];
            saveState();
          };
          let exitSold = false;

          // TAKE PROFIT: smoothed P/L >= +20%, after holding at least 45s
          if (!tpCooldown && smoothedPnl >= TAKE_PROFIT_PCT && hasEnoughReadings) {
            log("TRADE", `💰 TAKE PROFIT: smooth +${(smoothedPnl * 100).toFixed(1)}% (instant +${(pnlPct * 100).toFixed(1)}%) >= +${(TAKE_PROFIT_PCT * 100).toFixed(0)}% | held ${holdSec}s`);
            const sellResult = await sellPosition(market.conditionId, outcome, apiSize, assetName);
            if (sellResult && sellResult.success) {
              const realPnl = (curPrice - entryPrice) * apiSize;
              log("TRADE", `✅ TAKE PROFIT SOLD: ${apiSize.toFixed(2)} ${outcome} | P/L: +$${realPnl.toFixed(2)} (+${(pnlPct * 100).toFixed(1)}%)`);
              await sendTelegram(`💰 *TAKE PROFIT* +${(smoothedPnl * 100).toFixed(1)}%\n${outcome} x${apiSize.toFixed(2)} | $${entryPrice.toFixed(3)} → bid $${curPrice.toFixed(3)}\n📊 P/L: +$${realPnl.toFixed(2)}`);
              if (isOurBuy && state.position?.strategies?.length > 0) {
                await recordResult(true, realPnl, outcome, apiSize, entryPrice, state.position.confidence || 0.5, state.position.strategies, "unknown", positionExtra("take-profit")).catch(() => {});
              }
              cleanupAfterSell();
              exitSold = true;
            }
          }

          // STOP-LOSS: smoothed P/L <= -20%, after holding at least 30s, with enough readings
          if (!exitSold && !slCooldown && smoothedPnl <= STOP_LOSS_PCT && hasEnoughReadings) {
            log("TRADE", `🛑 STOP LOSS: smooth ${(smoothedPnl * 100).toFixed(1)}% (instant ${(pnlPct * 100).toFixed(1)}%) | med $${medianBid.toFixed(4)} vs entry $${entryPrice.toFixed(4)} | held ${holdSec}s | ${bidHistory.length} samples`);
            const sellResult = await sellPosition(market.conditionId, outcome, apiSize, assetName);
            if (sellResult && sellResult.success) {
              const realPnl = (curPrice - entryPrice) * apiSize;
              log("TRADE", `STOP LOSS SOLD: ${apiSize.toFixed(2)} ${outcome} | P/L: $${realPnl.toFixed(2)} (${(smoothedPnl * 100).toFixed(1)}%)`);
              await sendTelegram(`🛑 *STOP LOSS* ${(smoothedPnl * 100).toFixed(1)}%\n${outcome} x${apiSize.toFixed(2)} | $${entryPrice.toFixed(3)} → bid $${curPrice.toFixed(3)}\n📊 P/L: $${realPnl.toFixed(2)}`);
              if (isOurBuy && state.position?.strategies?.length > 0) {
                await recordResult(false, realPnl, outcome, apiSize, entryPrice, state.position.confidence || 0.5, state.position.strategies, "unknown", positionExtra("stop-loss")).catch(() => {});
              }
              cleanupAfterSell();
              exitSold = true;
            }
          }

          if (exitSold) break;
        }
      }
      } // end for (posItem of myPositions)

      // === CHECK FOR RESOLUTION ===
      if (timeLeftSec <= 5 && state.position && state.position.marketId === market.conditionId && !state.resolvedMarkets.has(market.conditionId)) {
        log("INFO", `📊 Market resolving: ${market.conditionId?.slice(0, 8)}... (${timeLeftSec}s left)`);
        await sleep(8000);

        const newDash = await getDashboard();
        if (newDash && newDash.positions) {
          const stillHolding = newDash.positions.find(p => p.conditionId === market.conditionId && parseFloat(p.size) > 0.01);

          if (!stillHolding) {
            const ep = parseFloat(state.position.price) || 0.50;
            const sz = parseFloat(state.position.size) || 1;
            const side = state.position.side;

            // Check bankroll change to determine win/loss
            const oldBankroll = bankroll;
            const newBankroll = parseFloat(newDash.balance) || bankroll;
            const balanceChange = newBankroll - oldBankroll;

            // If balance increased significantly → we won ($1 per share - entry)
            // If balance stayed same or decreased → we lost (lost entry price per share)
            const won = balanceChange > 0.05;
            const pnlUsd = won ? ((1.0 - ep) * sz) : (-ep * sz);

            log("TRADE", `🏁 RESOLUTION: ${won ? "WIN" : "LOSS"} | ${side} x${sz.toFixed(2)} | entry $${ep.toFixed(3)} | P/L: ${won ? '+' : ''}$${pnlUsd.toFixed(2)} | Balance: $${oldBankroll.toFixed(2)} → $${newBankroll.toFixed(2)}`);
            await sendTelegram(`🏁 *RESOLUTION* ${won ? "WIN" : "LOSS"}\n${side} x${sz.toFixed(2)} | entry $${ep.toFixed(3)}\n📊 P/L: ${won ? '+' : ''}$${pnlUsd.toFixed(2)}\n💰 Balance: $${newBankroll.toFixed(2)}`);

            if (state.position.strategies && state.position.strategies.length > 0) {
              await recordResult(won, pnlUsd, side, sz, ep, state.position.confidence || 0.5, state.position.strategies, "unknown", positionExtra("resolution")).catch(() => {});
            }

            state.resolvedMarkets.add(market.conditionId);
            state.position = null;
            delete positionPeaks[market.conditionId];
            delete positionBuyTimes[market.conditionId];
            delete trendSamples[market.conditionId];
            saveState();
          }
        }
      }

      // === MARKET TIMING ===
      const eventStartMs = market.eventStartTime ? new Date(market.eventStartTime).getTime() : 0;
      const marketStarted = eventStartMs > 0 && Date.now() >= eventStartMs;

      // === TRADE DECISION ===
      const is15m = market.marketType === "15m";

      if (!marketStarted && timeLeftSec > 0) {
        const secsUntilStart = Math.max(0, Math.floor((eventStartMs - Date.now()) / 1000));
        if (Date.now() - state.lastActionTime > 30000) {
          log("INFO", `⏳ ${is15m ? '[15m] ' : ''}Market starts in ${secsUntilStart}s — waiting for Price to Beat...`);
          state.lastActionTime = Date.now();
        }
      }

      // ===== 15-MIN TREND CONFIRM STRATEGY =====
      // Re-check soldMarkets directly (canBuyThisMarket may be stale after a sell in this iteration)
      const canBuy15m = !state.soldMarkets.has(market.conditionId) && !positionBuyTimes[market.conditionId] && lastSellTime === 0;
      if (is15m && marketStarted && canBuy15m && myPositions.length === 0 && timeLeftSec > 30) {
        // Collect BTC price samples continuously
        if (!trendSamples[market.conditionId]) trendSamples[market.conditionId] = [];
        const btcNow = await fetchBtcPrice();
        if (btcNow > 0) {
          trendSamples[market.conditionId].push({ ts: Date.now(), price: btcNow });
        }
        const samples = trendSamples[market.conditionId];
        const observationTimeSec = samples.length > 0 ? (Date.now() - samples[0].ts) / 1000 : 0;

        // Observation phase: collect for ≥90 seconds, then decide
        const MIN_OBSERVATION_SEC = 90;
        const MIN_SAMPLES = 8;
        const BUY_WINDOW_15M = 480; // buy when ≤480s left (after ~7 min observation)

        if (observationTimeSec < MIN_OBSERVATION_SEC || samples.length < MIN_SAMPLES || timeLeftSec > BUY_WINDOW_15M) {
          if (Date.now() - state.lastActionTime > 15000) {
            log("INFO", `📡 [15m BTC] Collecting trend data: ${samples.length} samples, ${observationTimeSec.toFixed(0)}s observed, ${timeLeftSec}s left | PtB: $${market.priceToBeat || 'N/A'} | BTC: $${btcNow.toFixed(0)}`);
            state.lastActionTime = Date.now();
          }
        } else if (bankroll >= 1) {
          // Enough observation — make trend decision
          const decision = trendConfirmDecision(samples, market.priceToBeat);

          if (decision) {
            const outcome = decision.side;
            const wantUp = outcome === "YES";
            const ourBook = wantUp ? orderbook : downOrderbook;
            const bestAskPrice = ourBook?.bestAsk ? parseFloat(ourBook.bestAsk.price) : null;
            const bestBidPrice = ourBook?.bestBid ? parseFloat(ourBook.bestBid.price) : null;

            // MAX_ENTRY 0.60 for 15m (wider range accepted in test)
            const MAX_ENTRY_15M = 0.60;
            // Market odds guard: don't buy when market strongly disagrees (opposing side > 75%)
            const opposingBid = wantUp ? downBestBid : upBestBid;
            if (opposingBid && opposingBid > 0.75) {
              log("INFO", `🚫 [15m BTC] Market strongly against us: opposing bid $${opposingBid.toFixed(2)} (>${(0.75*100).toFixed(0)}%) — skipping ${wantUp ? 'UP' : 'DOWN'}`);
              state.lastAction = "SKIP";
              state.lastActionTime = Date.now();
            } else if (bestAskPrice && bestAskPrice > MAX_ENTRY_15M) {
              log("INFO", `🚫 [15m BTC] Ask $${bestAskPrice.toFixed(3)} > max $${MAX_ENTRY_15M} — skipping`);
              state.lastAction = "SKIP";
              state.lastActionTime = Date.now();
            } else {
              const entryEstimate = bestAskPrice || (wantUp ? parseFloat(market.upPrice) : parseFloat(market.downPrice));
              const size = Math.max(1, Math.round(1 / entryEstimate)) || 2; // $1 test

              log("TRADE", `🎯 [15m TREND] ${wantUp ? "BUY UP" : "BUY DOWN"} $1 | Conf: ${(decision.confidence * 100).toFixed(0)}% | ${decision.reason}`);
              log("INFO", `  📊 Stats: ${samples.length} samples over ${observationTimeSec.toFixed(0)}s | consistency ${(decision.stats.consistency * 100).toFixed(0)}% | slope ${decision.stats.slopePerSec > 0 ? '+' : ''}${decision.stats.slopePerSec.toFixed(2)}$/s`);

              const tradeResult = await executeTrade(market.conditionId, outcome, size, null, "BTC-15m");

              if (tradeResult && tradeResult.success && tradeResult.status !== "live") {
                const estimatedPrice = (parseFloat(tradeResult.price) > 0 ? parseFloat(tradeResult.price) : null) || entryEstimate;
                const spreadAtBuy = (bestAskPrice && bestBidPrice) ? (bestAskPrice - bestBidPrice) / bestAskPrice : null;
                state.position = {
                  side: outcome, size, price: estimatedPrice, marketId: market.conditionId,
                  asset: "BTC-15m", confidence: decision.confidence,
                  strategies: ["trendConfirm"], timeLeftAtEntry: timeLeftSec,
                  spreadAtEntry: spreadAtBuy, cryptoPrice: btcNow,
                  priceToBeat: market.priceToBeat || null, signalStrength: decision.confidence,
                };
                state.lastAction = "BUY";
                state.lastActionTime = Date.now();
                state.lastTradeTime = Date.now();
                state.tradeCount++;
                positionBuyTimes[market.conditionId] = Date.now();
                positionPeaks[market.conditionId] = { pnl: 0, smoothed: 0 };
                bidHistory = [];
                lastSellTime = 0;
                saveState();

                log("TRADE", `✅ [15m] FILLED: ${outcome} ${size} @ ~$${estimatedPrice.toFixed(4)}`);
                await sendTelegram(`🎯 *[15m TREND CONFIRM]* ${outcome}\n📊 ${decision.reason}\n💰 ${size} @ $${estimatedPrice.toFixed(4)} | Conf: ${(decision.confidence * 100).toFixed(0)}%\n📈 ${samples.length} samples, ${observationTimeSec.toFixed(0)}s observed`);

                // Refresh fill price
                await sleep(2500);
                try {
                  const freshDash = await getDashboard();
                  if (freshDash?.positions) {
                    const realPos = freshDash.positions.find(p => p.conditionId === market.conditionId && parseFloat(p.size) > 0);
                    if (realPos && parseFloat(realPos.avgPrice) > 0) {
                      state.position.price = parseFloat(realPos.avgPrice);
                      state.position.size = parseFloat(realPos.size);
                      saveState();
                      log("INFO", `📊 [15m] Real fill: ${state.position.size} @ $${state.position.price.toFixed(4)}`);
                    }
                  }
                } catch (e) {}
              } else if (tradeResult && tradeResult.status === "live") {
                log("WARN", `⏳ [15m] Order resting — NOT filled yet`);
                state.lastActionTime = Date.now();
              }
            }
          }
        }

        // Skip normal 5m buy logic for 15m markets
        bidHistories[market.conditionId] = bidHistory;
        lastSellTimes[market.conditionId] = lastSellTime;
        continue;
      }

      // ===== 5-MIN MARKET LOGIC (original) =====
      if (!is15m && marketStarted && myPositions.length === 0 && canBuyThisMarket && timeLeftSec > 240) {
        if (Date.now() - state.lastActionTime > 30000) {
          log("INFO", `⏳ [${assetName}] Waiting for buy window (${timeLeftSec}s left, entry at ≤240s)`);
          state.lastActionTime = Date.now();
        }
      }

      // Log when sitting out because we already sold this market
      if (marketStarted && myPositions.length === 0 && !canBuyThisMarket && timeLeftSec > 0) {
        if (Date.now() - state.lastActionTime > 30000) {
          log("INFO", `⏸️ [${assetName}] Already sold — waiting ${timeLeftSec}s...`);
          state.lastActionTime = Date.now();
        }
      }

      // BUY WINDOW: early entry (240-60s before end) — catch momentum before orderbook reprices
      const has5mPosition = state.position && state.position.asset !== "BTC-15m";
      if (!is15m && marketStarted && myPositions.length === 0 && canBuyThisMarket && !has5mPosition && timeLeftSec <= 240 && timeLeftSec > 60 && bankroll >= 1) {
        if (!state.lastAction || state.lastAction === "SKIP" || Date.now() - state.lastActionTime > 5000) {
          const _btcP = market.cryptoPrice || btc?.price || 0;
          log("INFO", `🧠 [${assetName}] Analyzing market... (PtB: $${market.priceToBeat || 'N/A'} | UP: ${market.upPrice} | DOWN: ${market.downPrice} | ${timeLeftSec}s left)`);

          const decision = await analyzeMarket(market, _btcP, bankroll, timeLeftSec);

          if (decision && decision.action === "BUY") {
            let outcome = decision.side;
            let wantUp = outcome === "YES";

            // Market odds guard: don't bet against extreme market consensus
            const ourBid = wantUp ? upBestBid : downBestBid;
            const opposingBid = wantUp ? downBestBid : upBestBid;
            if (ourBid !== null && opposingBid !== null && ourBid < 0.25 && opposingBid > 0.75) {
              log("INFO", `🔄 [${assetName}] Brain said ${wantUp ? 'UP' : 'DOWN'} but market strongly disagrees (our $${ourBid.toFixed(2)} vs opposing $${opposingBid.toFixed(2)}) — flipping to ${wantUp ? 'DOWN' : 'UP'}`);
              outcome = wantUp ? "NO" : "YES";
              wantUp = !wantUp;
            }

            const ourBook = wantUp ? orderbook : downOrderbook;

            const bestAskPrice = ourBook?.bestAsk ? parseFloat(ourBook.bestAsk.price) : null;
            const bestBidPrice = ourBook?.bestBid ? parseFloat(ourBook.bestBid.price) : null;

            const MAX_ENTRY_PRICE = 0.50;
            if (bestAskPrice && bestAskPrice > MAX_ENTRY_PRICE) {
              log("INFO", `🚫 [${assetName}] Ask $${bestAskPrice.toFixed(3)} > max $${MAX_ENTRY_PRICE} — skipping`);
              state.lastAction = "SKIP";
              state.lastActionTime = Date.now();
              continue;
            }

            if (bestAskPrice && bestBidPrice) {
              const spreadPct = (bestAskPrice - bestBidPrice) / bestAskPrice;
              if (spreadPct > 0.12) {
                log("INFO", `🚫 [${assetName}] Spread ${(spreadPct*100).toFixed(1)}% too wide — skipping`);
                state.lastAction = "SKIP";
                state.lastActionTime = Date.now();
                continue;
              }
            }

            const entryEstimate = bestAskPrice || (wantUp ? parseFloat(market.upPrice) : parseFloat(market.downPrice));
            const size = Math.max(1, Math.round(decision.amount / entryEstimate)) || 2;

            log("TRADE", `🎯 [${assetName}] ${wantUp ? "BUY UP" : "BUY DOWN"} $${decision.amount} | Conf: ${(decision.confidence * 100).toFixed(0)}% | Ask $${(bestAskPrice || 0).toFixed(3)} | ${timeLeftSec}s left`);
            await postBotMessage(`🧠 [${assetName}] ${wantUp ? "BUY UP" : "BUY DOWN"} $${decision.amount} | Conf: ${(decision.confidence * 100).toFixed(0)}% | ${decision.reason?.split('\n')[0]}`);

            const tradeResult = await executeTrade(market.conditionId, outcome, size, null, assetName);

            if (tradeResult && tradeResult.success && tradeResult.status !== "live") {
              const estimatedPrice = (parseFloat(tradeResult.price) > 0 ? parseFloat(tradeResult.price) : null) || entryEstimate;
              const spreadAtBuy = (bestAskPrice && bestBidPrice) ? (bestAskPrice - bestBidPrice) / bestAskPrice : null;
              state.position = {
                side: outcome,
                size,
                price: estimatedPrice,
                marketId: market.conditionId,
                asset: assetName,
                confidence: decision.confidence,
                strategies: decision.signals?.map(s => s.strategy) || [],
                timeLeftAtEntry: timeLeftSec,
                spreadAtEntry: spreadAtBuy,
                cryptoPrice: market.cryptoPrice || null,
                priceToBeat: market.priceToBeat || null,
                signalStrength: decision.confidence,
              };
              state.lastAction = "BUY";
              state.lastActionTime = Date.now();
              state.lastTradeTime = Date.now();
              state.tradeCount++;
              positionBuyTimes[market.conditionId] = Date.now();
              positionPeaks[market.conditionId] = { pnl: 0, smoothed: 0 };
              bidHistory = [];
              lastSellTime = 0;
              saveState();

              log("TRADE", `✅ [${assetName}] FILLED: ${outcome} ${size} @ ~$${estimatedPrice.toFixed(4)}`);

              await sleep(2500);
              try {
                const freshDash = await getDashboard();
                if (freshDash?.positions) {
                  const realPos = freshDash.positions.find(p =>
                    p.conditionId === market.conditionId && parseFloat(p.size) > 0
                  );
                  if (realPos && parseFloat(realPos.avgPrice) > 0) {
                    const realPrice = parseFloat(realPos.avgPrice);
                    const realSize = parseFloat(realPos.size);
                    log("INFO", `📊 [${assetName}] Real fill: ${realSize} @ $${realPrice.toFixed(4)} (est. $${estimatedPrice.toFixed(4)})`);
                    state.position.price = realPrice;
                    state.position.size = realSize;
                    saveState();
                  }
                }
              } catch (e) {
                log("INFO", `Could not fetch real fill price: ${e.message}`);
              }

              await sendTelegram(`🎯 *FILLED* [${assetName}] ${outcome} ${state.position.size} @ $${state.position.price.toFixed(4)}\nConf: ${(decision.confidence * 100).toFixed(0)}% | ${decision.reason?.split('\n')[0] || ""}`);
            } else if (tradeResult && tradeResult.status === "live") {
              log("WARN", `⏳ [${assetName}] Order resting — NOT filled yet`);
              state.lastActionTime = Date.now();
              state.lastTradeTime = Date.now();
            }
          } else if (decision && decision.action === "SKIP") {
            state.lastAction = "SKIP";
            log("INFO", `⏭️ [${assetName}] Skip: ${decision.reason?.split('\n')[0] || "No edge"} | Conf: ${((decision.confidence || 0) * 100).toFixed(0)}%`);
            state.lastActionTime = Date.now();
          } else if (!decision) {
            log("WARN", `[${assetName}] Brain returned null — error or timeout`);
            state.lastActionTime = Date.now();
          }
        }
      }

      // Persist per-market state
      bidHistories[market.conditionId] = bidHistory;
      lastSellTimes[market.conditionId] = lastSellTime;

      } // end for (const mktData of marketsToProcess)

      // === TELEGRAM STATUS REPORT (every 5 min, no LLM) ===
      let brainStatus = null;
      if (Date.now() - lastTgReportTime >= TG_REPORT_INTERVAL_MS) {
        try {
          const res = await api.get("/api/brain/status");
          brainStatus = res.data;
        } catch (e) { /* ignore */ }
        await sendStatusReport(dashboard, brainStatus);
      }

      // Edge analysis report every 25 trades (hold-to-resolution tracking)
      if (state.tradeCount > 0 && state.tradeCount % 25 === 0 && state._lastEdgeReport !== state.tradeCount) {
        state._lastEdgeReport = state.tradeCount;
        try {
          const edgeRes = await api.get("/api/brain/edge");
          if (edgeRes.data && edgeRes.data.summary) {
            const e = edgeRes.data;
            log("STATS", `📊 EDGE ANALYSIS (${e.summary.totalTrades} trades):`);
            log("STATS", `   WR: ${(e.summary.winRate * 100).toFixed(1)}% [95% CI: ${e.summary.winRateCI95}]`);
            log("STATS", `   EV/trade: $${e.summary.avgPnlPerTrade.toFixed(3)} | Total P/L: $${e.summary.totalPnl.toFixed(2)}`);
            log("STATS", `   Kelly: ${e.summary.kellyBetSize} | Confidence: ${e.confidence}`);
            if (e.recommendations.length > 0) {
              log("STATS", `   Recommendations:`);
              e.recommendations.forEach(r => log("STATS", `     → ${r}`));
            }
            await sendTelegram(`📊 *EDGE REPORT* (${e.summary.totalTrades} trades)\nWR: ${(e.summary.winRate * 100).toFixed(1)}% [${e.summary.winRateCI95}]\nEV: $${e.summary.avgPnlPerTrade.toFixed(3)}/trade\nP/L: $${e.summary.totalPnl.toFixed(2)}\n${e.summary.profitable ? "EDGE DETECTED" : "No edge yet"}\n\n${e.recommendations.slice(0, 3).join("\n")}`);
          }
        } catch (err) { /* edge analysis not critical */ }
      }

      state.consecutiveErrors = 0;
      await sleep(POLL_INTERVAL_MS);

    } catch (e) {
      state.consecutiveErrors++;
      log("ERROR", `Error: ${e.message}`);

      if (state.consecutiveErrors > 10) {
        log("ERROR", "Too many errors, pausing for 30s...");
        await sleep(30000);
        state.consecutiveErrors = 0;
      } else {
        await sleep(POLL_INTERVAL_MS);
      }
    }
  }
}

// ===== HELPER FUNCTIONS =====
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ===== GRACEFUL SHUTDOWN =====
process.on("SIGINT", async () => {
  console.log("\n[agent] Shutting down...");
  console.log(`[agent] Today's stats: ${state.tradeCount} trades, P/L will be in brain memory`);
  saveState();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n[agent] Received SIGTERM...");
  saveState();
  process.exit(0);
});

// ===== START =====
runAgent().catch(e => {
  console.error("[agent] Fatal error:", e);
  process.exit(1);
});
