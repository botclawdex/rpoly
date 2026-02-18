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
const PRE_CLOSE_SECONDS = 45;    // Sell 45 seconds before close (was 30 — increased for safety)
const MIN_TIME_TO_TRADE_SEC = 180;  // Never trade with less than 3 min left
const LOG_FILE = path.join(__dirname, "..", "trades", "agent-log.json");

// Telegram reporting (replaces LLM-powered cron jobs)
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || "";
const TG_CHAT_ID = process.env.TG_CHAT_ID || "";
const TG_REPORT_INTERVAL_MS = 5 * 60 * 1000; // Every 5 minutes
let lastTgReportTime = 0;

// Position management
const TAKE_PROFIT_PCT = 0.20;    // Sell if position is +20% or more
const STOP_LOSS_PCT = -0.20;     // Cut losses at -20% (was -25%)
const EMERGENCY_LOSS_PCT = -0.40; // Force sell even during cooldown if -40%+
const MIN_HOLD_FOR_TP = 45;      // TP needs time to develop (was 60 for both)
const MIN_HOLD_FOR_SL = 15;      // SL should react fast (was 60 for both)
const POSITION_LOG_INTERVAL = 15000; // Log position P/L every 15s
let lastPositionLogTime = 0;

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

async function executeTrade(marketId, side, size, price) {
  try {
    // Server expects: side="UP"/"DOWN", size in shares
    // IMPORTANT: Do NOT send price — let server use best ask for instant fill!
    // Sending a custom price (like midpoint) causes the order to REST on book
    // instead of matching immediately (status "live" vs "matched")
    const apiSide = side === "YES" ? "UP" : side === "NO" ? "DOWN" : side;
    const orderSize = 1; // Always $1 per trade (Student stage)
    const body = { side: apiSide, size: orderSize.toString() };
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

async function sellPosition(marketId, side, size) {
  try {
    const apiSide = side === "YES" ? "UP" : side === "NO" ? "DOWN" : side;
    const sellSize = Math.max(1, parseInt(size) || 5);
    log("INFO", `[sell] Attempting: ${apiSide} x${sellSize}`);
    const res = await api.post("/api/sell", {
      side: apiSide,
      size: sellSize.toString()
    });
    log("INFO", `[sell] Response: success=${res.data?.success} price=${res.data?.price} error=${res.data?.error || "none"}`);
    return res.data;
  } catch (e) {
    const serverError = e.response?.data;
    log("WARN", `[sell] FAILED: ${e.message} | server: ${JSON.stringify(serverError || {})}`);
    return serverError || null;
  }
}

async function recordResult(won, pnl, side, amount, price, confidence, strategies, regime) {
  try {
    const res = await api.post("/api/brain/record", {
      won,
      pnl,
      side,
      amount,
      price,
      confidence,
      strategies: strategies || [],
      regime: regime || "unknown"
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
  console.log("🦞 rPoly Autonomous Agent v1.0 — Starting");
  console.log(`📡 API: ${API_BASE}`);
  console.log(`⏱️  Poll interval: ${POLL_INTERVAL_MS}ms`);
  console.log(`🎯 Pre-close sell: ${PRE_CLOSE_SECONDS}s before end`);
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
      if (!dashboard || !dashboard.market) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      const { market, btc, balances, positions } = dashboard;
      const timeLeftSec = market.endDate
        ? Math.max(0, Math.floor((new Date(market.endDate).getTime() - Date.now()) / 1000))
        : 0;

      const bankroll = balances?.proxy?.usdc || 0;

      // === NEW MARKET DETECTION ===
      if (market.conditionId !== state.currentMarketId) {
        log("INFO", `New market detected: ${market.question?.slice(0, 50)}...`);
        log("INFO", `   Time left: ${timeLeftSec}s | UP: ${market.upPrice} | DOWN: ${market.downPrice}`);

        // CRITICAL: Before switching, sell any orphaned positions from old markets
        if (positions && positions.length > 0) {
          await sellOrphanedPositions(positions, market.conditionId);
        }

        state.currentMarketId = market.conditionId;
        state.position = null;
        // Keep only recent soldMarkets (max 10), clear old ones
        if (state.soldMarkets.size > 10) state.soldMarkets.clear();
        saveState();
      }

      // === CHECK IF WE HAVE POSITIONS ===
      // Get ALL positions for this market (can have both YES and NO)
      let myPositions = [];
      if (positions && positions.length > 0) {
        myPositions = positions.filter(p => p.conditionId === market.conditionId && parseFloat(p.size) > 0);
      }
      // soldMarkets only blocks NEW BUYS — never blocks monitoring/selling existing positions
      const canBuyThisMarket = !state.soldMarkets.has(market.conditionId);
      let myPosition = myPositions.length > 0 ? myPositions[0] : null;

      // === PRE-CLOSE SELL (CRITICAL!) ===
      // Sell ALL positions for this market before close
      const positionsToSell = myPositions.length > 0
        ? myPositions
        : (state.position && state.position.marketId === market.conditionId)
          ? [{ side: state.position.side, size: state.position.size, avgPrice: state.position.price, curPrice: null }]
          : [];

      if (positionsToSell.length > 0 && timeLeftSec <= PRE_CLOSE_SECONDS) {
        log("WARN", `PRE-CLOSE SELL: ${timeLeftSec}s left | ${positionsToSell.length} position(s) to close`);

        for (const pos of positionsToSell) {
          const sideUp = ["Up", "Yes", "UP", "YES"].includes(pos.side);
          const outcome = sideUp ? "YES" : "NO";
          const size = parseFloat(pos.size) || 5;
          const entryPrice = parseFloat(state.position?.price) || parseFloat(pos.avgPrice) || 0.50;
          const liveBid = sideUp ? parseFloat(market.upPrice) : parseFloat(market.downPrice);
          const rawCurPrice = liveBid || parseFloat(pos.curPrice) || 0;
          const curPrice = rawCurPrice > 0 ? rawCurPrice : entryPrice;
          const hasRealExitPrice = rawCurPrice > 0;

          log("INFO", `  Selling ${size} ${outcome} (entry $${entryPrice.toFixed(2)}, now $${curPrice.toFixed(2)}${hasRealExitPrice ? '' : ' [no live price]'})`);
          let sellResult = await sellPosition(market.conditionId, outcome, size);

          // Retry once after 2s if sell failed
          if (!sellResult || !sellResult.success) {
            log("WARN", `  Pre-close sell failed — retrying in 2s...`);
            await sleep(2000);
            sellResult = await sellPosition(market.conditionId, outcome, size);
          }

          if (sellResult && sellResult.success) {
            const pnlUsd = (curPrice - entryPrice) * size;
            const pnlPct = entryPrice > 0 ? ((curPrice - entryPrice) / entryPrice * 100).toFixed(0) : "?";
            const pnlIcon = pnlUsd >= 0 ? "💰" : "📉";

            log("TRADE", `PRE-CLOSE SOLD: ${size} ${outcome} | $${entryPrice.toFixed(2)} -> ~$${curPrice.toFixed(2)} | P/L: ${pnlUsd >= 0 ? '+' : ''}$${pnlUsd.toFixed(2)} (${pnlPct}%)`);
            await sendTelegram(`⏰ *PRE-CLOSE* ${outcome} x${size.toFixed(1)}\n${pnlIcon} $${entryPrice.toFixed(2)} → ~$${curPrice.toFixed(2)}\n📊 P/L: ${pnlUsd >= 0 ? '+' : ''}$${pnlUsd.toFixed(2)} (${pnlPct}%)\n⏱️ ${timeLeftSec}s left`);
            const won = pnlUsd > 0;
            if (!hasRealExitPrice) {
              log("INFO", "Skipping brain-memory — no real exit price (would be pnl=0)");
            } else if (state.position && state.position.strategies && state.position.strategies.length > 0) {
              await recordResult(won, pnlUsd, outcome, size, entryPrice, state.position.confidence || 0.5, state.position.strategies, "unknown").catch(() => {});
            } else {
              log("INFO", "Skipping brain-memory record — not our position (strategies=[])");
            }
          } else {
            log("WARN", `PRE-CLOSE SELL FAILED for ${outcome} after retry — position may be abandoned!`);
            await sendTelegram(`🚨 *PRE-CLOSE FAILED* ${outcome} x${size} — could not sell!`);
          }
        }

        state.position = null;
        state.soldMarkets.add(market.conditionId);
        saveState();
      }

      // === POSITION MONITORING: Take-Profit & Stop-Loss ===
      // Works with Data API position OR state position — whichever is available
      // Monitor ALL positions for this market
      for (const posItem of myPositions) {
      if (posItem && timeLeftSec > PRE_CLOSE_SECONDS) {
        const isOurBuy = state.position && (
          (state.position.side === "YES" && ["Up", "Yes", "UP", "YES"].includes(posItem.side)) ||
          (state.position.side === "NO" && ["Down", "No", "DOWN", "NO"].includes(posItem.side))
        );
        const entryPrice = isOurBuy ? parseFloat(state.position.price) : parseFloat(posItem.avgPrice) || 0.50;
        const sideUp = ["Up", "Yes", "UP", "YES"].includes(posItem.side);
        // Use LIVE orderbook price (updates every 3s) instead of stale Data API curPrice
        const liveBid = sideUp ? parseFloat(market.upPrice) : parseFloat(market.downPrice);
        const apiCurPrice = parseFloat(posItem.curPrice) || 0;
        const curPrice = liveBid || apiCurPrice || 0;
        const apiSize = parseFloat(posItem.size) || 5;
        const pnlPct = entryPrice > 0 ? (curPrice - entryPrice) / entryPrice : 0;
        const pnlUsd = (curPrice - entryPrice) * apiSize;
        const outcome = sideUp ? "YES" : "NO";

        // Hold time: only apply if this is our own buy (not an old/unknown position)
        const holdSec = isOurBuy
          ? Math.floor((Date.now() - (state.lastTradeTime || 0)) / 1000)
          : 999;
        const tpCooldown = isOurBuy && holdSec < MIN_HOLD_FOR_TP;
        const slCooldown = isOurBuy && holdSec < MIN_HOLD_FOR_SL;
        const isEmergency = pnlPct <= EMERGENCY_LOSS_PCT;

        // Log position status every 15 seconds
        if (Date.now() - lastPositionLogTime > POSITION_LOG_INTERVAL) {
          const direction = pnlPct >= 0 ? "📈" : "📉";
          const src = state.position ? "own" : "API";
          log("INFO", `${direction} Position: ${apiSize} ${outcome} | Entry $${entryPrice.toFixed(2)} -> Now $${curPrice.toFixed(2)} | P/L: ${pnlPct >= 0 ? '+' : ''}${(pnlPct * 100).toFixed(1)}% ($${pnlUsd.toFixed(2)}) | Hold: ${holdSec}s | ${timeLeftSec}s left [${src}]`);
          lastPositionLogTime = Date.now();
        }

        // EMERGENCY SELL: catastrophic loss even during cooldown
        if (isEmergency && !slCooldown) {
          log("TRADE", `EMERGENCY SELL: ${(pnlPct * 100).toFixed(1)}% loss | $${curPrice.toFixed(2)} vs entry $${entryPrice.toFixed(2)} | held ${holdSec}s`);
          const sellResult = await sellPosition(market.conditionId, outcome, apiSize);
          if (sellResult && sellResult.success) {
            const realPnl = (curPrice - entryPrice) * apiSize;
            log("TRADE", `EMERGENCY SOLD: ${apiSize} ${outcome} | P/L: $${realPnl.toFixed(2)} (${(pnlPct * 100).toFixed(0)}%)`);
            await sendTelegram(`🆘 *EMERGENCY SELL* ${(pnlPct * 100).toFixed(0)}%\n${outcome} x${apiSize} | $${entryPrice.toFixed(2)} -> $${curPrice.toFixed(2)}\nP/L: $${realPnl.toFixed(2)}`);
            if (isOurBuy && state.position?.strategies?.length > 0) {
              await recordResult(false, realPnl, outcome, apiSize, entryPrice, state.position.confidence || 0.5, state.position.strategies, "unknown").catch(() => {});
            }
            state.position = null;
            state.soldMarkets.add(market.conditionId);
            saveState();
          }
        } else if (tpCooldown && slCooldown) {
          if (Date.now() - lastPositionLogTime > 10000) {
            log("INFO", `Holding (${holdSec}s / TP:${MIN_HOLD_FOR_TP}s SL:${MIN_HOLD_FOR_SL}s) — P/L: ${(pnlPct * 100).toFixed(1)}%`);
          }
        } else {
          // TAKE-PROFIT: sell if we're up enough (after TP cooldown)
          if (!tpCooldown && pnlPct >= TAKE_PROFIT_PCT) {
            log("TRADE", `💰 TAKE PROFIT: +${(pnlPct * 100).toFixed(1)}% | $${curPrice.toFixed(2)} vs entry $${entryPrice.toFixed(2)} | held ${holdSec}s`);
            const sellResult = await sellPosition(market.conditionId, outcome, apiSize);

            if (sellResult && sellResult.success) {
              const realPnl = (curPrice - entryPrice) * apiSize;
              log("TRADE", `✅ TAKE PROFIT SOLD: ${apiSize} ${outcome} | P/L: +$${realPnl.toFixed(2)} (+${(pnlPct * 100).toFixed(0)}%)`);
              await sendTelegram(`💰 *TAKE PROFIT* +${(pnlPct * 100).toFixed(0)}%\n${outcome} x${apiSize} | Entry $${entryPrice.toFixed(2)} → Exit ~$${curPrice.toFixed(2)}\n📊 P/L: +$${realPnl.toFixed(2)}`);
              if (isOurBuy && state.position?.strategies?.length > 0) {
                await recordResult(true, realPnl, outcome, apiSize, entryPrice, state.position.confidence || 0.5, state.position.strategies, "unknown").catch(() => {});
              } else {
                log("INFO", "⏭️ Skipping brain-memory record — not our position");
              }
              state.position = null;
              state.soldMarkets.add(market.conditionId);
              saveState();
            }
          }

          // STOP-LOSS: cut losses (after SL cooldown, shorter than TP)
          if (!slCooldown && pnlPct <= STOP_LOSS_PCT) {
            log("TRADE", `STOP LOSS: ${(pnlPct * 100).toFixed(1)}% | $${curPrice.toFixed(2)} vs entry $${entryPrice.toFixed(2)} | held ${holdSec}s`);
            const sellResult = await sellPosition(market.conditionId, outcome, apiSize);

            if (sellResult && sellResult.success) {
              const realPnl = (curPrice - entryPrice) * apiSize;
              log("TRADE", `STOP LOSS SOLD: ${apiSize} ${outcome} | P/L: $${realPnl.toFixed(2)} (${(pnlPct * 100).toFixed(0)}%)`);
              await sendTelegram(`🛑 *STOP LOSS* ${(pnlPct * 100).toFixed(0)}%\n${outcome} x${apiSize} | Entry $${entryPrice.toFixed(2)} -> Exit ~$${curPrice.toFixed(2)}\nP/L: $${realPnl.toFixed(2)}`);
              if (isOurBuy && state.position?.strategies?.length > 0) {
                await recordResult(false, realPnl, outcome, apiSize, entryPrice, state.position.confidence || 0.5, state.position.strategies, "unknown").catch(() => {});
              } else {
                log("INFO", "Skipping brain-memory record — not our position");
              }
              state.position = null;
              state.soldMarkets.add(market.conditionId);
              saveState();
            }
          }
        }
      }
      } // end for (posItem of myPositions)

      // === CHECK FOR RESOLUTION ===
      if (timeLeftSec === 0 && state.position && !state.resolvedMarkets.has(state.currentMarketId)) {
        log("INFO", `📊 Market resolving: ${state.currentMarketId?.slice(0, 8)}...`);
        // Wait a moment for resolution
        await sleep(5000);

        const newDash = await getDashboard();
        if (newDash && newDash.positions) {
          const stillHolding = newDash.positions.find(p => p.conditionId === market.conditionId);

          if (!stillHolding) {
            // Position was sold pre-close or resolved
            const wasSoldPreClose = true; // We always sell pre-close
            if (wasSoldPreClose) {
              // We already sold, calculate approximate P/L from trade log
              // The brain will track actual P/L
              await postBotMessage(`✅ Position closed pre-close. Awaiting P/L...`);
            }
            state.resolvedMarkets.add(state.currentMarketId);
            state.position = null;
            saveState();
          }
        }
      }

      // === MARKET TIMING ===
      const eventStartMs = market.eventStartTime ? new Date(market.eventStartTime).getTime() : 0;
      const marketStarted = eventStartMs > 0 && Date.now() >= eventStartMs;

      // === CHECK FOR FORCED TRADE (every 15 min for learning) ===
      const timeSinceLastTrade = Date.now() - (state.lastTradeTime || 0);
      const volume = parseFloat(market.volume) || 0;
      const isForcedTradeTime = timeSinceLastTrade > FORCED_TRADE_HOUR;
      const canForcedTrade = isForcedTradeTime && marketStarted && !myPosition && canBuyThisMarket && timeLeftSec > 60 && bankroll >= FORCED_TRADE_AMOUNT;

      // === ANALYZE AND TRADE (if no position and time left) ===

      if (!marketStarted && timeLeftSec > 0) {
        const secsUntilStart = Math.max(0, Math.floor((eventStartMs - Date.now()) / 1000));
        if (Date.now() - state.lastActionTime > 30000) {
          log("INFO", `⏳ Market starts in ${secsUntilStart}s — waiting for Price to Beat...`);
          state.lastActionTime = Date.now();
        }
      }

      // Log when sitting out because we already sold this market
      if (marketStarted && myPositions.length === 0 && !canBuyThisMarket && timeLeftSec > 0) {
        if (Date.now() - state.lastActionTime > 30000) {
          log("INFO", `⏸️ Already sold this market — waiting ${timeLeftSec}s for next one...`);
          state.lastActionTime = Date.now();
        }
      }

      if (marketStarted && myPositions.length === 0 && canBuyThisMarket && timeLeftSec > 60 && bankroll >= 1) {
        // Need fresh analysis (but not more often than every 15s)
        if (!state.lastAction || state.lastAction === "SKIP" || Date.now() - state.lastActionTime > 15000) {
          log("INFO", `🧠 Analyzing market...`);

          const decision = await analyzeMarket(
            market,
            btc?.price || 0,
            bankroll,
            timeLeftSec
          );

          if (decision && decision.action === "BUY") {
            const outcome = decision.side === "YES" ? "YES" : "NO"; // YES=UP, NO=DOWN
            const price = decision.side === "YES" ? market.upPrice : market.downPrice;
            const size = Math.round(decision.amount / price) || 5;

            log("TRADE", `🎯 ${decision.side === "YES" ? "BUY UP" : "BUY DOWN"} $${decision.amount} (${size} shares @ $${price})`);
            await postBotMessage(`🧠 ${decision.side === "YES" ? "BUY UP" : "BUY DOWN"} $${decision.amount} | Conf: ${(decision.confidence * 100).toFixed(0)}% | ${decision.reason?.split('\n')[0]}`);

            // No price → server uses best ask → instant fill (status "matched")
            const tradeResult = await executeTrade(market.conditionId, outcome, size, null);

            if (tradeResult && tradeResult.success && tradeResult.status !== "live") {
              const fillPrice = (parseFloat(tradeResult.price) > 0 ? parseFloat(tradeResult.price) : null) || price;
              state.position = {
                side: outcome,
                size,
                price: fillPrice,
                marketId: market.conditionId,
                confidence: decision.confidence,
                strategies: decision.signals?.map(s => s.strategy) || []
              };
              state.lastAction = "BUY";
              state.lastActionTime = Date.now();
              state.lastTradeTime = Date.now();
              state.tradeCount++;
              saveState();

              log("TRADE", `✅ Trade MATCHED: ${outcome} ${size} @ $${fillPrice}`);
              await sendTelegram(`🎯 *TRADE FILLED* ${outcome} ${size} @ $${fillPrice}\nConf: ${(decision.confidence * 100).toFixed(0)}%\n${decision.reason?.split('\n')[0] || ""}`);
            } else if (tradeResult && tradeResult.status === "live") {
              log("WARN", `⏳ Order resting on book — NOT filled. Will check next loop.`);
              state.lastActionTime = Date.now();
              state.lastTradeTime = Date.now();
            }
          } else if (decision && decision.action === "SKIP") {
            state.lastAction = "SKIP";
            state.lastActionTime = Date.now();
            log("INFO", `⏭️  Skipping: ${decision.reason?.split('\n')[0] || "No clear edge"}`);
          } else if (!decision) {
            // Brain returned null (error/timeout) — wait before retrying
            state.lastActionTime = Date.now();
          }
        }
      }

      // === FORCED TRADE — DISABLED ===
      // Forced trades disabled — brain handles all entries with relaxed Student settings.

      // === IDLE MESSAGE (every ~5 min) ===
      if (Date.now() - state.lastActionTime > 300000 && state.lastAction === "SKIP") {
        const timeUntil = market.endDate
          ? `Market closes in ${Math.floor(timeLeftSec / 60)}m ${timeLeftSec % 60}s`
          : "No active market";
        log("INFO", `💤 Waiting... ${timeUntil} | Balance: $${bankroll.toFixed(2)}`);
      }

      // === TELEGRAM STATUS REPORT (every 5 min, no LLM) ===
      let brainStatus = null;
      if (Date.now() - lastTgReportTime >= TG_REPORT_INTERVAL_MS) {
        try {
          const res = await api.get("/api/brain/status");
          brainStatus = res.data;
        } catch (e) { /* ignore */ }
        await sendStatusReport(dashboard, brainStatus);
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
