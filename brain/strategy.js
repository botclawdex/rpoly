/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║                    C L A W B O T   B R A I N   v1.0                    ║
 * ║──────────────────────────────────────────────────────────────────────────║
 * ║  Autonomous Trading Intelligence for Polymarket BTC 5-Minute Markets   ║
 * ║                                                                        ║
 * ║  Inspired by:                                                          ║
 * ║  • Jim Simons — statistical patterns, continuous adaptation            ║
 * ║  • Ed Thorp — Kelly criterion, mathematical edge                       ║
 * ║  • Ray Dalio — principles-based, learn from every mistake              ║
 * ║  • Paul Tudor Jones — risk first, never average losers                 ║
 * ║  • Jesse Livermore — patience, wait for the perfect setup              ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Architecture:
 *
 *   ┌─────────┐    ┌─────────┐    ┌─────────┐
 *   │ SENSES  │───▶│ CORTEX  │───▶│ MUSCLES │
 *   │ (data)  │    │ (think) │    │ (trade) │
 *   └─────────┘    └────┬────┘    └─────────┘
 *                       │
 *              ┌────────┼────────┐
 *              ▼        ▼        ▼
 *         ┌────────┐┌──────┐┌────────┐
 *         │ MEMORY ││ SOUL ││IDENTITY│
 *         │(learn) ││(core)││(evolve)│
 *         └────────┘└──────┘└────────┘
 */

const fs = require("fs");
const path = require("path");

// ═══════════════════════════════════════════════════════════════
//  SOUL — Core principles that NEVER change (Ray Dalio style)
// ═══════════════════════════════════════════════════════════════

const SOUL = {
  name: "ClawBot",
  version: "1.0.0",
  mission: "Grow $50 into $1,000,000 through disciplined, intelligent trading",

  // Immutable principles — the bot's DNA
  principles: [
    "Capital preservation is more important than profit",
    "Never risk what you cannot afford to lose",
    "Every loss is a lesson, every win is data",
    "Patience beats impulse — skip bad setups",
    "The market owes you nothing",
    "Adapt or die — strategies decay over time",
    "Small consistent gains compound into fortunes",
    "Never chase — the next market is 5 minutes away",
    "Sell 30s before close — ALWAYS",
    "When uncertain, do nothing",
  ],

  // Emotional guardrails (anti-tilt)
  mentalState: {
    tiltLevel: 0,          // 0-10, increases on consecutive losses
    confidenceFloor: 0.10, // Hold-to-resolution: slightly relaxed for more trades
    maxTiltBeforePause: 15, // pause at this tilt level (10+ consecutive losses)
  },
};

// ═══════════════════════════════════════════════════════════════
//  IDENTITY — Evolution stages (who are we right now?)
// ═══════════════════════════════════════════════════════════════

const IDENTITY = {
  stages: {
    STUDENT: {
      name: "Student",
      description: "Learning phase — observe, small bets, gather data",
      minTrades: 0,
      maxTrades: 100,
      maxBetUsd: 1.0,
      kellyFraction: 0.1, // 10% Kelly — ultra conservative
      requiredWinRate: 0,  // no requirement, we're learning
    },
    APPRENTICE: {
      name: "Apprentice",
      description: "Showing edge — increase position slightly",
      minTrades: 100,
      maxTrades: 500,
      maxBetUsd: 2.0,
      kellyFraction: 0.15,
      requiredWinRate: 0.52,
    },
    JOURNEYMAN: {
      name: "Journeyman",
      description: "Proven edge — trade with confidence",
      minTrades: 500,
      maxTrades: 2000,
      maxBetUsd: 5.0,
      kellyFraction: 0.25, // quarter Kelly
      requiredWinRate: 0.54,
    },
    MASTER: {
      name: "Master",
      description: "Consistent profit — scale up",
      minTrades: 2000,
      maxTrades: 10000,
      maxBetUsd: 20.0,
      kellyFraction: 0.35,
      requiredWinRate: 0.55,
    },
    GRANDMASTER: {
      name: "Grandmaster",
      description: "Elite performance — full power",
      minTrades: 10000,
      maxTrades: Infinity,
      maxBetUsd: 100.0,
      kellyFraction: 0.5, // half Kelly — never full Kelly (Ed Thorp)
      requiredWinRate: 0.56,
    },
  },

  getCurrentStage(memory) {
    const totalTrades = memory.stats.totalTrades;
    const winRate = memory.stats.winRate;
    const stages = Object.values(this.stages);

    // Find highest stage we qualify for
    let current = this.stages.STUDENT;
    for (const stage of stages) {
      if (totalTrades >= stage.minTrades && winRate >= stage.requiredWinRate) {
        current = stage;
      }
    }
    return current;
  },
};

// ═══════════════════════════════════════════════════════════════
//  MEMORY — Learning system (Jim Simons: "patterns decay")
// ═══════════════════════════════════════════════════════════════

const MEMORY_FILE = path.join(__dirname, "..", "trades", "brain-memory.json");

function createFreshMemory() {
  return {
    version: 1,
    createdAt: Date.now(),
    lastUpdated: Date.now(),

    stats: {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      skips: 0,
      winRate: 0,
      totalPnl: 0,            // cumulative P/L in USDC
      bestTrade: 0,
      worstTrade: 0,
      currentStreak: 0,        // positive = win streak, negative = loss streak
      longestWinStreak: 0,
      longestLossStreak: 0,
      consecutiveLosses: 0,
      todayPnl: 0,
      todayTrades: 0,
      todayDate: null,
    },

    // Strategy performance tracking (Jim Simons: adapt and rotate)
    strategyScores: {
      crowdFade:     { wins: 0, losses: 0, pnl: 0, lastUsed: 0 },
      momentum:      { wins: 0, losses: 0, pnl: 0, lastUsed: 0 },
      whaleFollow:   { wins: 0, losses: 0, pnl: 0, lastUsed: 0 },
      oddsShift:     { wins: 0, losses: 0, pnl: 0, lastUsed: 0 },
      meanReversion: { wins: 0, losses: 0, pnl: 0, lastUsed: 0 },
      volumeSpike:   { wins: 0, losses: 0, pnl: 0, lastUsed: 0 },
    },

    // Bayesian priors for market conditions
    regimeStats: {
      trending:  { wins: 0, losses: 0 }, // BTC clearly moving one direction
      ranging:   { wins: 0, losses: 0 }, // BTC chopping sideways
      volatile:  { wins: 0, losses: 0 }, // big swings both ways
    },

    // Time-of-day performance (markets behave differently at different hours)
    hourlyPerformance: {},  // "14": { wins: 3, losses: 1 }, "15": { wins: 1, losses: 5 } etc.

    // Recent trade context (sliding window for short-term adaptation)
    recentTrades: [], // last 20 trades with full context

    // Confidence calibration: did our confidence levels predict correctly?
    confidenceBuckets: {
      "50-55": { correct: 0, total: 0 },
      "55-60": { correct: 0, total: 0 },
      "60-65": { correct: 0, total: 0 },
      "65-70": { correct: 0, total: 0 },
      "70-80": { correct: 0, total: 0 },
      "80-90": { correct: 0, total: 0 },
      "90+":   { correct: 0, total: 0 },
    },
  };
}

function loadMemory() {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8"));
      // Reset daily stats if new day
      const today = new Date().toISOString().slice(0, 10);
      if (data.stats.todayDate !== today) {
        data.stats.todayPnl = 0;
        data.stats.todayTrades = 0;
        data.stats.todayDate = today;
      }
      return data;
    }
  } catch (e) {
    console.log("[brain] Memory corrupt, creating fresh:", e.message);
  }
  return createFreshMemory();
}

function saveMemory(memory) {
  memory.lastUpdated = Date.now();
  try {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
  } catch (e) {
    console.log("[brain] Failed to save memory:", e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
//  SENSES — Signal detection (Renaissance: "find patterns in data")
// ═══════════════════════════════════════════════════════════════

const Senses = {
  /**
   * Signal 1: CROWD FADE
   * When the crowd is too confident, fade them.
   * Markets on Polymarket 5m are dominated by retail — they overshoot.
   */
  crowdFade(market) {
    const { upPrice, downPrice } = market;
    if (!upPrice || !downPrice) return null;

    const skew = Math.abs(upPrice - 0.5);
    if (skew < 0.12) return null; // only fade really extreme crowds (was 0.08)

    const side = upPrice > 0.62 ? "NO" : downPrice > 0.62 ? "YES" : null;
    if (!side) return null;

    const strength = Math.min(skew / 0.25, 1.0);
    return {
      strategy: "crowdFade",
      side,
      confidence: 0.12 + strength * 0.23, // 0.12 to 0.35
      reason: `Crowd extreme ${upPrice > 0.62 ? "bullish" : "bearish"} (${Math.round(Math.max(upPrice, downPrice) * 100)}%). Fading.`,
    };
  },

  /**
   * Signal 2: PRICE MOMENTUM
   * BTC is already moving in one direction relative to Price to Beat.
   * Short-term momentum dominates in crypto (academic research confirms).
   */
  momentum(market, btcPrice, timeLeftSec) {
    const { priceToBeat, upPrice, downPrice } = market;
    if (!priceToBeat || !btcPrice) return null;

    const diff = btcPrice - priceToBeat;
    const pctDiff = (diff / priceToBeat) * 100;

    if (Math.abs(pctDiff) < 0.01) return null; // 0.01% — catch smaller BTC moves

    const side = pctDiff > 0 ? "YES" : "NO";
    const absPct = Math.abs(pctDiff);

    const strength = Math.min(absPct / 0.15, 1.0);
    let confidence = 0.25 + strength * 0.30; // 0.25 to 0.55

    // Time-weight: later in the window = more predictive, but don't crush early signals
    const totalMarketTime = 300;
    const elapsed = Math.max(0, totalMarketTime - (timeLeftSec || totalMarketTime));
    const timeWeight = 0.7 + 0.3 * (elapsed / totalMarketTime); // 0.70 to 1.0
    confidence *= timeWeight;

    // Odds confirmation: only penalize if market STRONGLY disagrees
    const ourOdds = side === "YES" ? (upPrice || 0.5) : (downPrice || 0.5);
    if (ourOdds < 0.38) {
      confidence *= 0.6;
    } else if (ourOdds < 0.44) {
      confidence *= 0.8;
    }

    if (confidence < 0.10) return null;

    return {
      strategy: "momentum",
      side,
      confidence,
      reason: `BTC ${pctDiff > 0 ? "above" : "below"} PtB by ${absPct.toFixed(3)}%. Time-weight: ${(timeWeight * 100).toFixed(0)}%. Odds: ${(ourOdds * 100).toFixed(0)}%.`,
    };
  },

  /**
   * Signal 3: WHALE FOLLOWING
   * Big holders on Polymarket often have better information flow.
   */
  whaleFollow(whaleData) {
    if (!whaleData || !whaleData.length) return null;

    // Look at most recent whale snapshot
    const latest = whaleData[whaleData.length - 1];
    if (!latest || !latest.holders || !latest.holders.length) return null;

    // Calculate whale-weighted sentiment
    // Collector saves: { amount, outcome: "UP"/"DOWN", addr, name }
    let yesWeight = 0, noWeight = 0;
    for (const h of latest.holders.slice(0, 10)) {
      const size = parseFloat(h.amount) || parseFloat(h.size) || 0;
      const isUp = h.outcome === "UP" || h.outcome === "Yes" || h.position === "Yes";
      if (isUp) yesWeight += size;
      else noWeight += size;
    }

    const total = yesWeight + noWeight;
    if (total < 50) return null; // not enough whale activity

    const dominance = Math.max(yesWeight, noWeight) / total;
    if (dominance < 0.6) return null; // no clear consensus

    const side = yesWeight > noWeight ? "YES" : "NO";
    const strength = (dominance - 0.6) / 0.3; // 0 to 1 for 60%-90% dominance
    return {
      strategy: "whaleFollow",
      side,
      confidence: 0.10 + Math.min(strength, 1.0) * 0.25, // 0.10 to 0.35
      reason: `Whales ${Math.round(dominance * 100)}% ${side === "YES" ? "bullish" : "bearish"} ($${Math.round(Math.max(yesWeight, noWeight))} vs $${Math.round(Math.min(yesWeight, noWeight))}).`,
    };
  },

  /**
   * Signal 4: ODDS SHIFT
   * Rapid odds movement = new information entering market.
   * "Ride the wave" — but only early in the wave.
   */
  oddsShift(oddsHistory, market) {
    if (!oddsHistory || oddsHistory.length < 3) return null;

    // Get recent snapshots for this market
    const marketOdds = oddsHistory
      .filter(o => o.market === market.slug || o.market === market.conditionId)
      .slice(-10);

    if (marketOdds.length < 3) return null;

    const oldest = marketOdds[0];
    const newest = marketOdds[marketOdds.length - 1];
    const shift = (newest.upPrice || newest.up || 0.5) - (oldest.upPrice || oldest.up || 0.5);

    if (Math.abs(shift) < 0.02) return null; // 2pts minimum shift

    const side = shift > 0 ? "YES" : "NO";
    const strength = Math.min(Math.abs(shift) / 0.10, 1.0);
    return {
      strategy: "oddsShift",
      side,
      confidence: 0.10 + strength * 0.20, // 0.10 to 0.30
      reason: `Odds shifted ${shift > 0 ? "UP" : "DOWN"} by ${Math.round(Math.abs(shift) * 100)}pts. Momentum in odds.`,
    };
  },

  /**
   * Signal 5b: ODDS BIAS (fallback when BTC data unavailable)
   * Uses raw market odds deviation from 50/50 as a directional indicator.
   * The market IS the signal — if the crowd puts odds > 55% on one side, follow it.
   * Weaker than momentum but fires reliably.
   */
  oddsBias(market, timeLeftSec) {
    const { upPrice, downPrice } = market;
    if (!upPrice || !downPrice) return null;

    const deviation = upPrice - 0.5;
    const absDev = Math.abs(deviation);

    if (absDev < 0.01) return null; // 1% odds deviation — fires at UP>0.51

    const side = deviation > 0 ? "YES" : "NO";
    const strength = Math.min(absDev / 0.15, 1.0);
    let confidence = 0.12 + strength * 0.20; // 0.12 to 0.32

    const totalMarketTime = 300;
    const elapsed = Math.max(0, totalMarketTime - (timeLeftSec || totalMarketTime));
    const timeWeight = 0.4 + 0.6 * (elapsed / totalMarketTime);
    confidence *= timeWeight;

    if (confidence < 0.10) return null;

    return {
      strategy: "oddsBias",
      side,
      confidence,
      reason: `Market odds skewed ${(deviation > 0 ? "UP" : "DOWN")} ${Math.round(absDev * 100)}pts (${Math.round(Math.max(upPrice, downPrice) * 100)}%). Following market.`,
    };
  },

  /**
   * Signal 5: MEAN REVERSION
   * After a strong move, markets often revert. Contrarian signal.
   * Only active when momentum has been extreme and shows exhaustion.
   */
  meanReversion(market, btcPrice, oddsHistory) {
    const { priceToBeat, upPrice } = market;
    if (!priceToBeat || !btcPrice || !upPrice) return null;

    const pctDiff = ((btcPrice - priceToBeat) / priceToBeat) * 100;

    // Only trigger on extreme moves (>0.1%) where odds have already priced it in
    if (Math.abs(pctDiff) < 0.10) return null;

    const oddsExtreme = upPrice > 0.75 || upPrice < 0.25;
    if (!oddsExtreme) return null;

    // Check if momentum is slowing (odds not changing much anymore)
    if (oddsHistory && oddsHistory.length >= 3) {
      const recent = oddsHistory.slice(-3);
      const recentShift = Math.abs((recent[recent.length - 1].upPrice || recent[recent.length - 1].up || 0.5) - (recent[0].upPrice || recent[0].up || 0.5));
      if (recentShift > 0.05) return null; // still moving, don't fade
    }

    // Fade the move
    const side = pctDiff > 0 ? "NO" : "YES";
    return {
      strategy: "meanReversion",
      side,
      confidence: 0.12 + Math.min((Math.abs(pctDiff) - 0.10) / 0.1, 1.0) * 0.18, // 0.12 to 0.30
      reason: `Extreme move ${pctDiff.toFixed(3)}% with odds at ${Math.round(upPrice * 100)}%. Possible reversion.`,
    };
  },

  /**
   * Signal 6: VOLUME SPIKE DETECTION
   * Unusual volume = smart money entering. Follow the flow.
   */
  volumeSpike(globalTrades, market) {
    if (!globalTrades || !globalTrades.length) return null;

    // Get recent trades for this market
    // Collector saves: { t (timestamp), market (slug), side, size, price, outcome, timestamp (trade ts) }
    const now = Date.now();
    const recentTrades = globalTrades.filter(tr =>
      (tr.market === market.slug || tr.market === market.conditionId) &&
      (now - (tr.t || tr.ts || 0)) < 120000
    );

    if (recentTrades.length < 5) return null;

    // Calculate buy/sell pressure
    let buyVol = 0, sellVol = 0;
    let yesBuys = 0, noBuys = 0;
    for (const tr of recentTrades) {
      const size = parseFloat(tr.size) || 0;
      if (tr.side === "BUY") {
        buyVol += size;
        const isYes = tr.outcome === "Yes" || tr.outcome === "UP" || tr.outcome === "Up";
        if (isYes) yesBuys += size;
        else noBuys += size;
      } else {
        sellVol += size;
      }
    }

    const totalVol = buyVol + sellVol;
    if (totalVol < 20) return null; // not enough action

    // Buy dominance
    const buyDominance = buyVol / totalVol;
    if (buyDominance < 0.65) return null; // no clear buying pressure

    const side = yesBuys > noBuys ? "YES" : "NO";
    const strength = (buyDominance - 0.65) / 0.25;
    return {
      strategy: "volumeSpike",
      side,
      confidence: 0.10 + Math.min(strength, 1.0) * 0.20, // 0.10 to 0.30
      reason: `Volume spike: ${Math.round(buyDominance * 100)}% buying pressure, flow toward ${side === "YES" ? "UP" : "DOWN"}.`,
    };
  },
};

// ═══════════════════════════════════════════════════════════════
//  CORTEX — Decision engine (the thinking layer)
// ═══════════════════════════════════════════════════════════════

const Cortex = {
  /**
   * Detect market regime: trending, ranging, or volatile.
   * Different regimes require different strategies.
   */
  detectRegime(btcPrice, priceToBeat, oddsHistory) {
    if (!priceToBeat || !btcPrice) return "unknown";

    const pctMove = Math.abs((btcPrice - priceToBeat) / priceToBeat) * 100;

    // Check odds volatility
    let oddsVol = 0;
    if (oddsHistory && oddsHistory.length >= 5) {
      const recent = oddsHistory.slice(-5);
      for (let i = 1; i < recent.length; i++) {
        oddsVol += Math.abs((recent[i].upPrice || recent[i].up || 0.5) - (recent[i - 1].upPrice || recent[i - 1].up || 0.5));
      }
      oddsVol /= recent.length - 1;
    }

    if (pctMove > 0.08 && oddsVol < 0.03) return "trending";
    if (pctMove < 0.03 && oddsVol > 0.04) return "volatile";
    return "ranging";
  },

  /**
   * Kelly Criterion position sizing (Ed Thorp's gift to humanity).
   *
   * f* = (b*p - q) / b
   *   p = estimated probability of winning
   *   q = 1 - p
   *   b = net odds (payout ratio)
   *
   * We use FRACTIONAL Kelly because full Kelly is too aggressive.
   * Fraction depends on our evolution stage.
   */
  kellySize(confidence, tokenPrice, bankroll, stage) {
    // Convert our confidence to a win probability estimate
    const p = confidence;
    const q = 1 - p;

    // Net odds: if we buy at $0.50, we get $1.00 back = 1:1 odds (b=1)
    // If we buy at $0.80, we get $1.00 back = 0.25:1 odds (b=0.25)
    const b = (1 - tokenPrice) / tokenPrice;

    // Kelly fraction
    const fullKelly = (b * p - q) / b;

    if (fullKelly <= 0) return 0; // no edge, don't bet

    // Apply fractional Kelly based on evolution stage
    const fractionalKelly = fullKelly * stage.kellyFraction;

    // Calculate bet size
    let betSize = bankroll * fractionalKelly;

    // Clamp to stage max
    betSize = Math.min(betSize, stage.maxBetUsd);

    // Floor at $1 (minimum viable trade)
    betSize = Math.max(betSize, 1);

    // Never bet more than 10% of bankroll regardless of Kelly (Paul Tudor Jones safety)
    betSize = Math.min(betSize, bankroll * 0.10);

    return Math.round(betSize * 100) / 100; // round to cents
  },

  /**
   * Apply memory-based weight adjustments.
   * Strategies that have been winning get a boost.
   * Strategies that have been losing get dampened.
   * This is how Simons keeps the Medallion fund winning — constant rotation.
   */
  applyMemoryWeights(signals, memory) {
    return signals.map(signal => {
      const strat = memory.strategyScores[signal.strategy];
      if (!strat || (strat.wins + strat.losses) < 5) {
        // Not enough data, use as-is
        return signal;
      }

      const stratWinRate = strat.wins / (strat.wins + strat.losses);
      const pnlPerTrade = strat.pnl / (strat.wins + strat.losses);

      // Boost winning strategies, dampen losing ones
      // Range: 0.5x to 1.5x based on performance
      let multiplier = 1.0;
      if (stratWinRate > 0.55) multiplier = 1.0 + (stratWinRate - 0.55) * 2; // up to 1.5x
      if (stratWinRate < 0.45) multiplier = 1.0 - (0.45 - stratWinRate) * 2; // down to 0.5x
      multiplier = Math.max(0.5, Math.min(1.5, multiplier));

      return {
        ...signal,
        confidence: signal.confidence * multiplier,
        memoryMultiplier: multiplier,
      };
    });
  },

  /**
   * Apply time-of-day adjustments.
   * Some hours are historically better/worse for us.
   */
  applyTimeAdjustment(confidence, memory) {
    const hour = new Date().getHours().toString();
    const hourStats = memory.hourlyPerformance[hour];

    if (!hourStats || (hourStats.wins + hourStats.losses) < 10) {
      return confidence; // not enough data
    }

    const hourWinRate = hourStats.wins / (hourStats.wins + hourStats.losses);
    // Slightly boost or dampen based on historical hour performance
    if (hourWinRate > 0.55) return confidence * 1.05;
    if (hourWinRate < 0.45) return confidence * 0.90;
    return confidence;
  },

  /**
   * Confidence calibration check.
   * If we've been overconfident (saying 70% but only winning 50%),
   * dial back. If underconfident, don't touch — better safe than sorry.
   */
  calibrateConfidence(rawConfidence, memory) {
    // Find the matching bucket
    const pct = rawConfidence * 100;
    let bucket = null;
    if (pct >= 90) bucket = "90+";
    else if (pct >= 80) bucket = "80-90";
    else if (pct >= 70) bucket = "70-80";
    else if (pct >= 65) bucket = "65-70";
    else if (pct >= 60) bucket = "60-65";
    else if (pct >= 55) bucket = "55-60";
    else bucket = "50-55";

    const stats = memory.confidenceBuckets[bucket];
    if (!stats || stats.total < 10) return rawConfidence; // not enough data

    const actualRate = stats.correct / stats.total;
    const expectedRate = rawConfidence;

    // If we're significantly overconfident, reduce
    if (actualRate < expectedRate - 0.05) {
      const correction = (expectedRate - actualRate) * 0.5;
      return rawConfidence - correction;
    }

    return rawConfidence;
  },

  /**
   * Tilt detection — emotional guardrail.
   * After consecutive losses, our judgment degrades (proven by behavioral finance).
   * We mechanically reduce risk rather than trying to "win it back."
   */
  checkTilt(memory) {
    const tilt = Math.min(10, Math.max(0, memory.stats.consecutiveLosses * 1.5));

    if (tilt >= SOUL.mentalState.maxTiltBeforePause) {
      return {
        canTrade: false,
        tiltLevel: tilt,
        reason: `On tilt (${memory.stats.consecutiveLosses} consecutive losses). Pausing to cool down.`,
      };
    }

    // Reduce confidence proportionally to tilt
    const confidenceReduction = tilt * 0.02; // max 0.20 at tilt=10
    return {
      canTrade: true,
      tiltLevel: tilt,
      confidenceReduction,
      reason: tilt > 3 ? `Elevated tilt (${tilt.toFixed(1)}). Reducing confidence by ${(confidenceReduction * 100).toFixed(0)}%.` : null,
    };
  },

  /**
   * Market quality gate — refuse to trade in bad conditions.
   * Jesse Livermore: "There is nothing new in Wall Street... no time to trade is itself a position."
   */
  checkMarketQuality(market, timeLeftSec) {
    const issues = [];

    if (timeLeftSec < 60) issues.push(`Only ${timeLeftSec}s left — too late to enter`);
    if (timeLeftSec > 290) issues.push(`${timeLeftSec}s left — too early`);
    if (!market.priceToBeat) issues.push("No Price to Beat yet — market hasn't started");

    const volume = parseFloat(market.volume) || 0;
    if (volume < 50) issues.push(`Low volume ($${volume.toFixed(0)}) — no market activity`);

    const liquidity = parseFloat(market.liquidity) || 0;
    if (liquidity < 50) issues.push(`Low liquidity ($${liquidity.toFixed(0)}) — cannot trade`);

    // Real bid-ask spread from orderbook (passed via market.bookSpread)
    const bookSpread = parseFloat(market.bookSpread) || 0;
    if (bookSpread > 0.10) issues.push(`Wide spread (${(bookSpread * 100).toFixed(1)}%) — slippage will eat profits`);

    // Book depth — need enough levels to enter and exit
    const askDepth = parseInt(market.askDepth) || 0;
    const bidDepth = parseInt(market.bidDepth) || 0;
    if (askDepth < 3) issues.push(`Ask book too thin (${askDepth} levels) — heavy slippage on entry`);
    if (bidDepth < 3) issues.push(`Bid book too thin (${bidDepth} levels) — can't exit cleanly`);

    return {
      pass: issues.length === 0,
      issues,
    };
  },

  /**
   * Daily drawdown check — stop trading if we've lost too much today.
   * Paul Tudor Jones: "The most important rule of trading is to play great defense."
   */
  checkDailyDrawdown(memory, bankroll) {
    const maxDailyLoss = bankroll * 0.95; // Effectively disabled — testing mode
    if (memory.stats.todayPnl < -maxDailyLoss) {
      return {
        canTrade: false,
        reason: `Daily loss $${Math.abs(memory.stats.todayPnl).toFixed(2)} exceeds 20% of bankroll. Done for today.`,
      };
    }
    return { canTrade: true };
  },
};

// ═══════════════════════════════════════════════════════════════
//  THE DECISION — Main brain function
// ═══════════════════════════════════════════════════════════════

/**
 * analyze() — The main brain function.
 *
 * Takes all available data and returns a trading decision.
 *
 * @param {Object} params
 * @param {Object} params.market — current market from /api/dashboard
 * @param {number} params.btcPrice — current BTC price
 * @param {number} params.bankroll — available USDC
 * @param {number} params.timeLeftSec — seconds until market closes
 * @param {Array}  params.oddsHistory — from /api/learn/odds-history
 * @param {Array}  params.whaleData — from /api/learn/whales
 * @param {Array}  params.globalTrades — from /api/learn/global-trades
 * @param {Object} params.patterns — from /api/learn/patterns
 *
 * @returns {Object} decision
 * @returns {string} decision.action — "BUY", "SKIP", "HOLD"
 * @returns {string} decision.side — "YES" or "NO"
 * @returns {number} decision.amount — USDC to spend
 * @returns {number} decision.confidence — 0.0 to 1.0
 * @returns {string} decision.reason — human-readable explanation
 * @returns {Object} decision.signals — all individual signals
 * @returns {Object} decision.meta — debug info
 */
function analyze(params) {
  const {
    market,
    btcPrice,
    bankroll,
    timeLeftSec,
    oddsHistory = [],
    whaleData = [],
    globalTrades = [],
    patterns = null,
  } = params;

  console.log(`[brain] analyze: btcPrice=${btcPrice} priceToBeat=${market?.priceToBeat} upPrice=${market?.upPrice} downPrice=${market?.downPrice} timeLeft=${timeLeftSec}s odds=${oddsHistory?.length} whales=${whaleData?.length} trades=${globalTrades?.length}`);

  const memory = loadMemory();
  const stage = IDENTITY.getCurrentStage(memory);
  const decision = {
    action: "SKIP",
    side: null,
    amount: 0,
    confidence: 0,
    reason: "",
    signals: [],
    meta: {
      stage: stage.name,
      tiltLevel: 0,
      regime: "unknown",
      kellyFraction: stage.kellyFraction,
      totalTrades: memory.stats.totalTrades,
      winRate: memory.stats.winRate,
      todayPnl: memory.stats.todayPnl,
    },
  };

  // ── Gate 1: Market quality ──
  const quality = Cortex.checkMarketQuality(market, timeLeftSec);
  if (!quality.pass) {
    decision.reason = `Market quality fail: ${quality.issues.join("; ")}`;
    return decision;
  }

  // ── Gate 2: Bankroll check ──
  if (bankroll < 1.0) {
    decision.reason = "Insufficient balance ($" + bankroll.toFixed(2) + "). Need at least $1.";
    return decision;
  }

  // ── Gate 3: Daily drawdown ──
  const drawdown = Cortex.checkDailyDrawdown(memory, bankroll);
  if (!drawdown.canTrade) {
    decision.reason = drawdown.reason;
    return decision;
  }

  // ── Gate 4: Tilt check ──
  const tilt = Cortex.checkTilt(memory);
  decision.meta.tiltLevel = tilt.tiltLevel;
  if (!tilt.canTrade) {
    decision.reason = tilt.reason;
    return decision;
  }

  // ── Detect market regime ──
  const regime = Cortex.detectRegime(btcPrice, market.priceToBeat, oddsHistory);
  decision.meta.regime = regime;

  // ── Collect all signals from senses ──
  const _cf = Senses.crowdFade(market);
  const _mo = Senses.momentum(market, btcPrice, timeLeftSec);
  const _wh = Senses.whaleFollow(whaleData);
  const _os = Senses.oddsShift(oddsHistory, market);
  const _ob = Senses.oddsBias(market, timeLeftSec);
  const _mr = Senses.meanReversion(market, btcPrice, oddsHistory);
  const _vs = Senses.volumeSpike(globalTrades, market);
  console.log(`[brain] signals → crowdFade=${JSON.stringify(_cf)} momentum=${JSON.stringify(_mo)} oddsBias=${JSON.stringify(_ob)} whaleFollow=${JSON.stringify(_wh)} oddsShift=${JSON.stringify(_os)} meanReversion=${JSON.stringify(_mr)} volumeSpike=${JSON.stringify(_vs)}`);

  const rawSignals = [_cf, _mo, _wh, _os, _ob, _mr, _vs]
    .filter(s => s && typeof s.confidence === "number" && !isNaN(s.confidence) && s.confidence > 0);

  if (rawSignals.length === 0) {
    decision.reason = "No signals detected. Market is ambiguous — sitting out.";
    return decision;
  }

  // ── Apply memory-based strategy weights ──
  const weightedSignals = Cortex.applyMemoryWeights(rawSignals, memory)
    .filter(s => s && typeof s.confidence === "number" && !isNaN(s.confidence));
  decision.signals = weightedSignals;

  // ── Aggregate signals: weighted vote ──
  let yesScore = 0, noScore = 0;
  let yesReasons = [], noReasons = [];

  for (const signal of weightedSignals) {
    const conf = parseFloat(signal.confidence) || 0;
    if (signal.side === "YES") {
      yesScore += conf;
      yesReasons.push(signal.reason);
    } else {
      noScore += conf;
      noReasons.push(signal.reason);
    }
  }

  // Require meaningful edge — don't trade on noise
  const dominant = yesScore > noScore ? "YES" : "NO";
  const rawConfidence = Math.max(yesScore, noScore);
  const minorityConfidence = Math.min(yesScore, noScore);

  // Agreement ratio: how aligned are the signals?
  // If it's 0.6 YES vs 0.55 NO, signals disagree — weak setup
  const agreement = rawConfidence > 0 ? 1 - (minorityConfidence / rawConfidence) : 0;

  if (agreement < 0.20) {
    decision.reason = `Signals disagree (YES=${yesScore.toFixed(2)} vs NO=${noScore.toFixed(2)}). No clear edge.`;
    decision.confidence = rawConfidence;
    return decision;
  }

  // ── Apply calibration and tilt adjustments ──
  let finalConfidence = rawConfidence;
  finalConfidence = Cortex.calibrateConfidence(finalConfidence, memory);
  finalConfidence = Cortex.applyTimeAdjustment(finalConfidence, memory);
  finalConfidence -= tilt.confidenceReduction || 0;

  // Clamp
  finalConfidence = Math.max(0, Math.min(1, finalConfidence));

  // ── Confidence threshold (Soul's floor) ──
  if (finalConfidence < SOUL.mentalState.confidenceFloor) {
    decision.reason = `Confidence ${(finalConfidence * 100).toFixed(1)}% below floor ${(SOUL.mentalState.confidenceFloor * 100).toFixed(0)}%. Skipping.`;
    decision.confidence = finalConfidence;
    return decision;
  }

  // ── Regime-based confidence boost/dampen ──
  if (regime === "volatile" && stage.name === "Student") {
    finalConfidence *= 0.8;
    if (finalConfidence < SOUL.mentalState.confidenceFloor) {
      decision.reason = "Volatile market + Student stage = too risky. Skipping.";
      decision.confidence = finalConfidence;
      return decision;
    }
  }

  // ── Pattern validation from historical data ──
  if (patterns && patterns.oddsBuckets) {
    const relevantPrice = dominant === "YES" ? market.upPrice : market.downPrice;
    const pricePct = Math.round(relevantPrice * 100);
    let bucket = null;
    if (pricePct >= 60) bucket = "60+";
    else if (pricePct >= 55) bucket = "55-60";
    else if (pricePct >= 50) bucket = "50-55";
    else if (pricePct >= 45) bucket = "45-50";
    else bucket = "40-45";

    const bucketStats = patterns.oddsBuckets[bucket];
    if (bucketStats && (bucketStats.w + bucketStats.l) >= 10) {
      const bucketWinRate = bucketStats.w / (bucketStats.w + bucketStats.l);
      if (bucketWinRate < 0.40) {
        finalConfidence *= 0.75; // Historical data says this odds range loses often
      }
    }
  }

  // ── Calculate position size (Kelly) ──
  const tokenPrice = dominant === "YES" ? market.upPrice : market.downPrice;
  let amount = Cortex.kellySize(finalConfidence, tokenPrice || 0.5, bankroll, stage);

  // Always bet at least $1 (Polymarket minimum). Evolution controls MAX bet, not min.
  if (amount < 1) {
    amount = 1.0;
  }

  // ── Final decision: GO ──
  decision.action = "BUY";
  decision.side = dominant;
  decision.amount = amount;
  decision.confidence = finalConfidence;
  decision.reason = [
    `[${stage.name}] ${dominant === "YES" ? "BUY UP" : "BUY DOWN"} $${amount.toFixed(2)}`,
    `Confidence: ${(finalConfidence * 100).toFixed(1)}% | Regime: ${regime}`,
    `Signals (${weightedSignals.length}):`,
    ...(dominant === "YES" ? yesReasons : noReasons).map(r => "  • " + r),
    tilt.reason ? `⚠ ${tilt.reason}` : null,
  ].filter(Boolean).join("\n");

  return decision;
}

// ═══════════════════════════════════════════════════════════════
//  LEARNING — Post-trade memory update
// ═══════════════════════════════════════════════════════════════

/**
 * recordTrade() — Record a trade outcome and update all memory systems.
 *
 * @param {Object} trade
 * @param {string} trade.action — "BUY" | "SELL"
 * @param {string} trade.side — "YES" | "NO"
 * @param {number} trade.amount — USDC spent
 * @param {number} trade.price — price per share
 * @param {boolean} trade.won — did we win?
 * @param {number} trade.pnl — profit/loss in USDC
 * @param {number} trade.confidence — our confidence at entry
 * @param {Array}  trade.strategies — which strategies contributed (array of strategy names)
 * @param {string} trade.regime — market regime at time of trade
 */
function recordTrade(trade) {
  const memory = loadMemory();
  const today = new Date().toISOString().slice(0, 10);
  const hour = new Date().getHours().toString();

  // Reset daily if needed
  if (memory.stats.todayDate !== today) {
    memory.stats.todayPnl = 0;
    memory.stats.todayTrades = 0;
    memory.stats.todayDate = today;
  }

  // ── Update core stats ──
  memory.stats.totalTrades++;
  memory.stats.todayTrades++;
  memory.stats.totalPnl += trade.pnl;
  memory.stats.todayPnl += trade.pnl;

  if (trade.won) {
    memory.stats.wins++;
    memory.stats.consecutiveLosses = 0;
    memory.stats.currentStreak = Math.max(0, memory.stats.currentStreak) + 1;
    memory.stats.longestWinStreak = Math.max(memory.stats.longestWinStreak, memory.stats.currentStreak);
  } else {
    memory.stats.losses++;
    memory.stats.consecutiveLosses++;
    memory.stats.currentStreak = Math.min(0, memory.stats.currentStreak) - 1;
    memory.stats.longestLossStreak = Math.max(memory.stats.longestLossStreak, Math.abs(memory.stats.currentStreak));
  }

  memory.stats.winRate = memory.stats.wins / memory.stats.totalTrades;
  memory.stats.bestTrade = Math.max(memory.stats.bestTrade, trade.pnl);
  memory.stats.worstTrade = Math.min(memory.stats.worstTrade, trade.pnl);

  // ── Update strategy scores ──
  if (trade.strategies && trade.strategies.length) {
    for (const stratName of trade.strategies) {
      if (memory.strategyScores[stratName]) {
        const s = memory.strategyScores[stratName];
        if (trade.won) s.wins++;
        else s.losses++;
        s.pnl += trade.pnl;
        s.lastUsed = Date.now();
      }
    }
  }

  // ── Update regime stats ──
  if (trade.regime && memory.regimeStats[trade.regime]) {
    if (trade.won) memory.regimeStats[trade.regime].wins++;
    else memory.regimeStats[trade.regime].losses++;
  }

  // ── Update hourly performance ──
  if (!memory.hourlyPerformance[hour]) {
    memory.hourlyPerformance[hour] = { wins: 0, losses: 0 };
  }
  if (trade.won) memory.hourlyPerformance[hour].wins++;
  else memory.hourlyPerformance[hour].losses++;

  // ── Update confidence calibration ──
  const confPct = (trade.confidence || 0.5) * 100;
  let bucket;
  if (confPct >= 90) bucket = "90+";
  else if (confPct >= 80) bucket = "80-90";
  else if (confPct >= 70) bucket = "70-80";
  else if (confPct >= 65) bucket = "65-70";
  else if (confPct >= 60) bucket = "60-65";
  else if (confPct >= 55) bucket = "55-60";
  else bucket = "50-55";

  if (memory.confidenceBuckets[bucket]) {
    memory.confidenceBuckets[bucket].total++;
    if (trade.won) memory.confidenceBuckets[bucket].correct++;
  }

  // ── Sliding window of recent trades ──
  const tradeRecord = {
    ts: Date.now(),
    side: trade.side,
    amount: trade.amount,
    price: trade.price,
    won: trade.won,
    pnl: trade.pnl,
    confidence: trade.confidence,
    strategies: trade.strategies,
    regime: trade.regime,
    asset: trade.asset || "BTC",
    timeLeftAtEntry: trade.timeLeftAtEntry || null,
    spreadAtEntry: trade.spreadAtEntry || null,
    cryptoPrice: trade.cryptoPrice || null,
    priceToBeat: trade.priceToBeat || null,
    entryPrice: trade.price || null,
    exitType: trade.exitType || "resolution",
    signalStrength: trade.signalStrength || null,
    hour: new Date().getHours(),
    dayOfWeek: new Date().getDay(),
  };

  memory.recentTrades.push(tradeRecord);
  if (memory.recentTrades.length > 20) {
    memory.recentTrades = memory.recentTrades.slice(-20);
  }

  // ── FULL HISTORY — never truncated, used for statistical analysis ──
  appendTradeHistory(tradeRecord);

  saveMemory(memory);

  // Return stage info for the caller
  const stage = IDENTITY.getCurrentStage(memory);
  return {
    stage: stage.name,
    totalTrades: memory.stats.totalTrades,
    winRate: memory.stats.winRate,
    totalPnl: memory.stats.totalPnl,
    todayPnl: memory.stats.todayPnl,
    streak: memory.stats.currentStreak,
    nextStageIn: stage.maxTrades - memory.stats.totalTrades,
  };
}

/**
 * recordSkip() — Record a skipped market for pattern analysis.
 */
function recordSkip(reason) {
  const memory = loadMemory();
  memory.stats.skips++;
  saveMemory(memory);
}

// ═══════════════════════════════════════════════════════════════
//  STATUS — Introspection
// ═══════════════════════════════════════════════════════════════

/**
 * getStatus() — Full brain status report.
 */
function getStatus() {
  const memory = loadMemory();
  const stage = IDENTITY.getCurrentStage(memory);

  // Find best and worst strategies
  const stratEntries = Object.entries(memory.strategyScores)
    .filter(([_, s]) => (s.wins + s.losses) >= 3)
    .map(([name, s]) => ({
      name,
      winRate: s.wins / (s.wins + s.losses),
      pnl: s.pnl,
      trades: s.wins + s.losses,
    }))
    .sort((a, b) => b.pnl - a.pnl);

  // Confidence calibration report
  const calibration = Object.entries(memory.confidenceBuckets)
    .filter(([_, s]) => s.total >= 5)
    .map(([bucket, s]) => ({
      bucket,
      predicted: parseInt(bucket) / 100,
      actual: s.correct / s.total,
      total: s.total,
      calibrated: Math.abs(s.correct / s.total - parseInt(bucket) / 100) < 0.10,
    }));

  return {
    soul: {
      name: SOUL.name,
      mission: SOUL.mission,
      principles: SOUL.principles,
    },
    identity: {
      stage: stage.name,
      description: stage.description,
      maxBetUsd: stage.maxBetUsd,
      kellyFraction: stage.kellyFraction,
      nextStageAt: stage.maxTrades + " trades",
      requiredWinRate: stage.requiredWinRate,
    },
    memory: {
      totalTrades: memory.stats.totalTrades,
      wins: memory.stats.wins,
      losses: memory.stats.losses,
      skips: memory.stats.skips,
      winRate: (memory.stats.winRate * 100).toFixed(1) + "%",
      totalPnl: "$" + memory.stats.totalPnl.toFixed(2),
      todayPnl: "$" + memory.stats.todayPnl.toFixed(2),
      todayTrades: memory.stats.todayTrades,
      bestTrade: "$" + memory.stats.bestTrade.toFixed(2),
      worstTrade: "$" + memory.stats.worstTrade.toFixed(2),
      currentStreak: memory.stats.currentStreak,
      longestWinStreak: memory.stats.longestWinStreak,
      longestLossStreak: memory.stats.longestLossStreak,
    },
    strategies: stratEntries,
    calibration,
    tilt: Cortex.checkTilt(memory),
    regime: memory.regimeStats,
    hourlyPerformance: memory.hourlyPerformance,
    createdAt: new Date(memory.createdAt).toISOString(),
    lastUpdated: new Date(memory.lastUpdated).toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════
//  FULL TRADE HISTORY — permanent log for statistical analysis
// ═══════════════════════════════════════════════════════════════

const HISTORY_FILE = path.join(__dirname, "..", "trades", "full-history.json");

function loadTradeHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
    }
  } catch (e) { /* corrupt file, start fresh */ }
  return [];
}

function appendTradeHistory(record) {
  try {
    const history = loadTradeHistory();
    history.push(record);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  } catch (e) {
    console.error("[brain] Failed to append trade history:", e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
//  EDGE ANALYZER — statistical analysis after N trades
// ═══════════════════════════════════════════════════════════════

function analyzeEdge() {
  const trades = loadTradeHistory();
  if (trades.length < 10) {
    return { error: "Need at least 10 trades for analysis", tradeCount: trades.length };
  }

  const n = trades.length;
  const wins = trades.filter(t => t.won).length;
  const losses = n - wins;
  const wr = wins / n;

  // ── Wilson Score Interval (95% CI for true win rate) ──
  const z = 1.96;
  const phat = wr;
  const denom = 1 + z * z / n;
  const center = (phat + z * z / (2 * n)) / denom;
  const margin = (z / denom) * Math.sqrt((phat * (1 - phat) + z * z / (4 * n)) / n);
  const ciLow = Math.max(0, center - margin);
  const ciHigh = Math.min(1, center + margin);

  // ── Expected Value per $1 bet ──
  const avgWinPnl = trades.filter(t => t.won).reduce((s, t) => s + t.pnl, 0) / (wins || 1);
  const avgLossPnl = trades.filter(t => !t.won).reduce((s, t) => s + t.pnl, 0) / (losses || 1);
  const ev = wr * avgWinPnl + (1 - wr) * avgLossPnl;

  // ── Kelly Criterion (optimal bet fraction) ──
  const avgWinRatio = wins > 0 ? avgWinPnl / (trades.filter(t => t.won).reduce((s, t) => s + (t.price || 0.50), 0) / wins) : 0;
  const avgLossRatio = losses > 0 ? Math.abs(avgLossPnl) / (trades.filter(t => !t.won).reduce((s, t) => s + (t.price || 0.50), 0) / losses) : 1;
  const b = avgLossRatio > 0 ? avgWinRatio / avgLossRatio : 0;
  const kellyFraction = b > 0 ? Math.max(0, (b * wr - (1 - wr)) / b) : 0;

  // ── Win Rate by Asset ──
  const byAsset = {};
  trades.forEach(t => {
    const a = t.asset || "BTC";
    if (!byAsset[a]) byAsset[a] = { wins: 0, losses: 0, pnl: 0, n: 0 };
    byAsset[a].n++;
    byAsset[a].pnl += t.pnl;
    if (t.won) byAsset[a].wins++; else byAsset[a].losses++;
  });
  Object.keys(byAsset).forEach(a => { byAsset[a].wr = byAsset[a].wins / byAsset[a].n; });

  // ── Win Rate by Hour ──
  const byHour = {};
  trades.forEach(t => {
    const h = t.hour != null ? t.hour.toString() : new Date(t.ts).getHours().toString();
    if (!byHour[h]) byHour[h] = { wins: 0, losses: 0, n: 0 };
    byHour[h].n++;
    if (t.won) byHour[h].wins++; else byHour[h].losses++;
  });
  Object.keys(byHour).forEach(h => { byHour[h].wr = byHour[h].wins / byHour[h].n; });

  // ── Win Rate by Entry Price Bucket ──
  const byPrice = { "0.40-0.45": { w: 0, l: 0 }, "0.45-0.48": { w: 0, l: 0 }, "0.48-0.50": { w: 0, l: 0 }, "0.50-0.52": { w: 0, l: 0 }, "0.52+": { w: 0, l: 0 } };
  trades.forEach(t => {
    const p = t.price || 0.50;
    let bucket;
    if (p < 0.45) bucket = "0.40-0.45";
    else if (p < 0.48) bucket = "0.45-0.48";
    else if (p < 0.50) bucket = "0.48-0.50";
    else if (p < 0.52) bucket = "0.50-0.52";
    else bucket = "0.52+";
    if (t.won) byPrice[bucket].w++; else byPrice[bucket].l++;
  });
  Object.keys(byPrice).forEach(b => {
    const tot = byPrice[b].w + byPrice[b].l;
    byPrice[b].wr = tot > 0 ? byPrice[b].w / tot : null;
    byPrice[b].n = tot;
  });

  // ── Win Rate by Side (YES vs NO) ──
  const bySide = { YES: { w: 0, l: 0 }, NO: { w: 0, l: 0 } };
  trades.forEach(t => {
    const s = t.side === "YES" || t.side === "UP" ? "YES" : "NO";
    if (t.won) bySide[s].w++; else bySide[s].l++;
  });
  Object.keys(bySide).forEach(s => {
    const tot = bySide[s].w + bySide[s].l;
    bySide[s].wr = tot > 0 ? bySide[s].w / tot : null;
    bySide[s].n = tot;
  });

  // ── Win Rate by Confidence Bucket ──
  const byConf = { "0-20%": { w: 0, l: 0 }, "20-40%": { w: 0, l: 0 }, "40-60%": { w: 0, l: 0 }, "60-80%": { w: 0, l: 0 }, "80-100%": { w: 0, l: 0 } };
  trades.forEach(t => {
    const c = (t.confidence || 0) * 100;
    let bucket;
    if (c < 20) bucket = "0-20%";
    else if (c < 40) bucket = "20-40%";
    else if (c < 60) bucket = "40-60%";
    else if (c < 80) bucket = "60-80%";
    else bucket = "80-100%";
    if (t.won) byConf[bucket].w++; else byConf[bucket].l++;
  });
  Object.keys(byConf).forEach(b => {
    const tot = byConf[b].w + byConf[b].l;
    byConf[b].wr = tot > 0 ? byConf[b].w / tot : null;
    byConf[b].n = tot;
  });

  // ── Win Rate by Strategy Signal ──
  const bySignal = {};
  trades.forEach(t => {
    (t.strategies || []).forEach(s => {
      if (!bySignal[s]) bySignal[s] = { w: 0, l: 0, pnl: 0 };
      if (t.won) bySignal[s].w++; else bySignal[s].l++;
      bySignal[s].pnl += t.pnl;
    });
  });
  Object.keys(bySignal).forEach(s => {
    const tot = bySignal[s].w + bySignal[s].l;
    bySignal[s].wr = tot > 0 ? bySignal[s].w / tot : null;
    bySignal[s].n = tot;
  });

  // ── Win Rate by Day of Week ──
  const byDay = {};
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  trades.forEach(t => {
    const d = t.dayOfWeek != null ? dayNames[t.dayOfWeek] : dayNames[new Date(t.ts).getDay()];
    if (!byDay[d]) byDay[d] = { w: 0, l: 0 };
    if (t.won) byDay[d].w++; else byDay[d].l++;
  });
  Object.keys(byDay).forEach(d => {
    const tot = byDay[d].w + byDay[d].l;
    byDay[d].wr = tot > 0 ? byDay[d].w / tot : null;
    byDay[d].n = tot;
  });

  // ── Win Rate by Time Left at Entry ──
  const byTimeLeft = { "60-120s": { w: 0, l: 0 }, "120-180s": { w: 0, l: 0 }, "180-240s": { w: 0, l: 0 }, "240s+": { w: 0, l: 0 } };
  trades.forEach(t => {
    if (t.timeLeftAtEntry == null) return;
    let bucket;
    if (t.timeLeftAtEntry < 120) bucket = "60-120s";
    else if (t.timeLeftAtEntry < 180) bucket = "120-180s";
    else if (t.timeLeftAtEntry < 240) bucket = "180-240s";
    else bucket = "240s+";
    if (t.won) byTimeLeft[bucket].w++; else byTimeLeft[bucket].l++;
  });
  Object.keys(byTimeLeft).forEach(b => {
    const tot = byTimeLeft[b].w + byTimeLeft[b].l;
    byTimeLeft[b].wr = tot > 0 ? byTimeLeft[b].w / tot : null;
    byTimeLeft[b].n = tot;
  });

  // ── Streak Analysis ──
  let maxWinStreak = 0, maxLossStreak = 0, curStreak = 0;
  trades.forEach(t => {
    if (t.won) { curStreak = curStreak > 0 ? curStreak + 1 : 1; maxWinStreak = Math.max(maxWinStreak, curStreak); }
    else { curStreak = curStreak < 0 ? curStreak - 1 : -1; maxLossStreak = Math.max(maxLossStreak, Math.abs(curStreak)); }
  });

  // ── Recommendations ──
  const recommendations = [];

  // Best asset
  const bestAsset = Object.entries(byAsset).sort((a, b) => b[1].wr - a[1].wr)[0];
  if (bestAsset && bestAsset[1].n >= 10) {
    recommendations.push(`Best asset: ${bestAsset[0]} (${(bestAsset[1].wr * 100).toFixed(1)}% WR, n=${bestAsset[1].n})`);
  }

  // Best hours (WR > 55% with n >= 5)
  const goodHours = Object.entries(byHour).filter(([, v]) => v.wr > 0.55 && v.n >= 5).sort((a, b) => b[1].wr - a[1].wr);
  if (goodHours.length > 0) {
    recommendations.push(`Best hours: ${goodHours.map(([h, v]) => `${h}:00 (${(v.wr * 100).toFixed(0)}%, n=${v.n})`).join(", ")}`);
  }

  // Bad hours (WR < 45% with n >= 5)
  const badHours = Object.entries(byHour).filter(([, v]) => v.wr < 0.45 && v.n >= 5).sort((a, b) => a[1].wr - b[1].wr);
  if (badHours.length > 0) {
    recommendations.push(`Avoid hours: ${badHours.map(([h, v]) => `${h}:00 (${(v.wr * 100).toFixed(0)}%, n=${v.n})`).join(", ")}`);
  }

  // Best entry price range
  const bestPrice = Object.entries(byPrice).filter(([, v]) => v.n >= 5).sort((a, b) => (b[1].wr || 0) - (a[1].wr || 0))[0];
  if (bestPrice) {
    recommendations.push(`Best entry price: $${bestPrice[0]} (${(bestPrice[1].wr * 100).toFixed(0)}% WR, n=${bestPrice[1].n})`);
  }

  // Side bias
  if (bySide.YES.n >= 10 && bySide.NO.n >= 10) {
    const diff = Math.abs(bySide.YES.wr - bySide.NO.wr);
    if (diff > 0.05) {
      const better = bySide.YES.wr > bySide.NO.wr ? "YES/UP" : "NO/DOWN";
      recommendations.push(`Side bias: ${better} is ${(diff * 100).toFixed(1)}pp better`);
    }
  }

  // Required WR for profitability
  const avgEntry = trades.reduce((s, t) => s + (t.price || 0.50), 0) / n;
  const breakEvenWR = avgEntry; // at $0.50 entry, need 50% WR; at $0.48 need 48%
  recommendations.push(`Break-even WR at avg entry $${avgEntry.toFixed(3)}: ${(breakEvenWR * 100).toFixed(1)}%`);

  const profitable = wr > breakEvenWR;
  if (profitable) {
    recommendations.push(`EDGE DETECTED: WR ${(wr * 100).toFixed(1)}% > break-even ${(breakEvenWR * 100).toFixed(1)}%`);
  } else {
    recommendations.push(`NO EDGE YET: WR ${(wr * 100).toFixed(1)}% < break-even ${(breakEvenWR * 100).toFixed(1)}%`);
  }

  return {
    summary: {
      totalTrades: n,
      wins, losses,
      winRate: wr,
      winRateCI95: `${(ciLow * 100).toFixed(1)}% - ${(ciHigh * 100).toFixed(1)}%`,
      totalPnl: trades.reduce((s, t) => s + t.pnl, 0),
      avgPnlPerTrade: ev,
      avgWinPnl, avgLossPnl,
      kellyFraction: kellyFraction,
      kellyBetSize: kellyFraction > 0 ? `$${(kellyFraction * 100).toFixed(1)} per $100 bankroll` : "Don't bet (no edge)",
      profitable,
      maxWinStreak, maxLossStreak,
    },
    breakdown: {
      byAsset, byHour, byPrice, bySide, byConf, bySignal, byDay, byTimeLeft,
    },
    recommendations,
    sampleSize: n,
    minRecommended: 100,
    confidence: n >= 200 ? "HIGH" : n >= 100 ? "MEDIUM" : n >= 50 ? "LOW" : "INSUFFICIENT",
  };
}

// ═══════════════════════════════════════════════════════════════
//  EXPORTS
// ═══════════════════════════════════════════════════════════════

module.exports = {
  analyze,
  recordTrade,
  recordSkip,
  getStatus,
  loadMemory,
  saveMemory,
  analyzeEdge,
  loadTradeHistory,
  SOUL,
  IDENTITY,
  Senses,
  Cortex,
};
