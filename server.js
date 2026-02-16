require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const path = require("path");

let Wallet, providers, Contract;
try {
  const ethers = require("ethers");
  Wallet = ethers.Wallet;
  providers = ethers.providers;
  Contract = ethers.Contract;
  console.log("ethers loaded OK");
} catch (e) {
  console.warn("ethers not available:", e.message);
}

let ClobClient;
try {
  ClobClient = require("@polymarket/clob-client").ClobClient;
  console.log("clob-client loaded OK");
} catch (e) {
  console.warn("clob-client not available:", e.message);
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const PORT = process.env.PORT || 3001;

// ===== CONFIG =====
const GAMMA_API = "https://gamma-api.polymarket.com";
const CLOB_API = "https://clob.polymarket.com";
const POLYGON_RPC = "https://polygon-bor-rpc.publicnode.com";
const USDC_ADDR = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const USDC_ABI = ["function balanceOf(address) view returns (uint256)"];

const PRIVATE_KEY = process.env.POLY_PRIVATE_KEY || "";
const PROXY_ADDRESS = process.env.POLY_PROXY_ADDRESS || "";
const EOA_CREDS = {
  key: process.env.POLY_API_KEY || "",
  secret: process.env.POLY_API_SECRET || "",
  passphrase: process.env.POLY_API_PASSPHRASE || "",
};
const AUTH_TOKEN = process.env.RPOLY_AUTH_TOKEN || "";

const RPOLY_MODE = process.env.RPOLY_MODE || "live"; // "live" or "readonly"
const IS_READONLY = RPOLY_MODE === "readonly";
const HAS_TRADING = !IS_READONLY && !!(PRIVATE_KEY && PROXY_ADDRESS && EOA_CREDS.key);
const HAS_AUTH = !!AUTH_TOKEN;

// ===== AUTH MIDDLEWARE =====
function requireAuth(req, res, next) {
  if (!HAS_AUTH) return next(); // no token set = open (dev mode)

  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized. Send Authorization: Bearer <token>" });
  }
  const token = header.slice(7);
  if (token !== AUTH_TOKEN) {
    return res.status(403).json({ error: "Invalid token" });
  }
  next();
}

// ===== CLOB CLIENT =====
let clobClient = null;

function getClobClient() {
  if (!HAS_TRADING || !ClobClient || !Wallet) return null;
  if (!clobClient) {
    try {
      const signer = new Wallet(PRIVATE_KEY);
      clobClient = new ClobClient(CLOB_API, 137, signer, EOA_CREDS, 2, PROXY_ADDRESS);
    } catch (e) {
      console.error("ClobClient init error:", e.message);
      return null;
    }
  }
  return clobClient;
}

// ===== HELPERS =====

function getCurrent5mSlots() {
  const now = Math.floor(Date.now() / 1000);
  const next = Math.ceil(now / 300) * 300;
  return [next, next + 300, next + 600, next + 900];
}

async function findActive5mMarket() {
  for (const slot of getCurrent5mSlots()) {
    try {
      const res = await axios.get(`${GAMMA_API}/markets`, {
        params: { slug: `btc-updown-5m-${slot}` },
        timeout: 5000,
      });
      if (res.data?.length > 0 && !res.data[0].closed) {
        const m = res.data[0];
        const tokenIds = JSON.parse(m.clobTokenIds || "[]");
        const outcomes = JSON.parse(m.outcomes || "[]");
        const prices = JSON.parse(m.outcomePrices || "[]");
        return {
          id: m.id,
          conditionId: m.conditionId,
          question: m.question,
          slug: m.slug,
          negRisk: m.negRisk || false,
          upTokenId: tokenIds[0],
          downTokenId: tokenIds[1],
          outcomes,
          upPrice: parseFloat(prices[0]) || 0.5,
          downPrice: parseFloat(prices[1]) || 0.5,
          volume: m.volumeNum || m.volume || 0,
          liquidity: m.liquidityNum || m.liquidity || 0,
          endDate: m.endDate,
        };
      }
    } catch (e) { /* next slot */ }
  }
  return null;
}

async function getBalances() {
  if (!providers || !Contract || !Wallet) {
    return { eoa: { address: "n/a", usdc: 0, matic: 0 }, proxy: { address: PROXY_ADDRESS, usdc: 0 }, totalUsdc: 0 };
  }
  try {
    const provider = new providers.JsonRpcProvider(POLYGON_RPC);
    const usdc = new Contract(USDC_ADDR, USDC_ABI, provider);

    let eoaAddr = "unknown";
    try { eoaAddr = new Wallet(PRIVATE_KEY).address; } catch (e) {}

    const results = {
      eoa: { address: eoaAddr, usdc: 0, matic: 0 },
      proxy: { address: PROXY_ADDRESS, usdc: 0 },
      totalUsdc: 0,
    };

    try {
      const bal = await usdc.balanceOf(PROXY_ADDRESS);
      results.proxy.usdc = parseFloat(bal.toString()) / 1e6;
    } catch (e) { console.log("Proxy USDC error:", e.message); }

    if (eoaAddr !== "unknown") {
      try {
        const [eoaUsdc, eoaMatic] = await Promise.all([
          usdc.balanceOf(eoaAddr),
          provider.getBalance(eoaAddr),
        ]);
        results.eoa.usdc = parseFloat(eoaUsdc.toString()) / 1e6;
        results.eoa.matic = parseFloat(eoaMatic.toString()) / 1e18;
      } catch (e) { console.log("EOA balance error:", e.message); }
    }

    results.totalUsdc = results.eoa.usdc + results.proxy.usdc;
    return results;
  } catch (e) {
    console.error("Balances error:", e.message);
    return { eoa: { address: "error", usdc: 0, matic: 0 }, proxy: { address: PROXY_ADDRESS, usdc: 0 }, totalUsdc: 0 };
  }
}

async function getBTCPrice() {
  try {
    const res = await axios.get("https://api.binance.com/api/v3/ticker/24hr", {
      params: { symbol: "BTCUSDT" },
      timeout: 5000,
    });
    return { price: parseFloat(res.data.lastPrice) || 0, change24h: parseFloat(res.data.priceChangePercent) || 0 };
  } catch (e) {
    return { price: 0, change24h: 0 };
  }
}

// ===== PUBLIC ENDPOINTS =====

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    version: "2.1.0",
    mode: RPOLY_MODE,
    trading: HAS_TRADING ? "LIVE" : "READ_ONLY",
    auth: HAS_AUTH ? "ENABLED" : "OPEN",
  });
});

// Verify auth token
app.post("/api/auth", (req, res) => {
  if (!HAS_AUTH) return res.json({ ok: true, msg: "Auth not configured (dev mode)" });
  const { token } = req.body;
  if (token === AUTH_TOKEN) {
    res.json({ ok: true });
  } else {
    res.status(403).json({ ok: false, error: "Invalid token" });
  }
});

// Dashboard data (public read - no secrets exposed)
app.get("/api/dashboard", async (req, res) => {
  console.log("[dashboard] fetching...");

  const [balances, btc, market] = await Promise.all([
    getBalances().catch(() => ({ eoa: { usdc: 0, matic: 0 }, proxy: { usdc: 0 }, totalUsdc: 0 })),
    getBTCPrice().catch(() => ({ price: 0, change24h: 0 })),
    findActive5mMarket().catch(() => null),
  ]);

  let orderbook = null;
  let openOrders = [];

  if (market?.upTokenId) {
    const client = getClobClient();
    if (client) {
      try { orderbook = await client.getOrderBook(market.upTokenId); } catch (e) { console.log("Orderbook:", e.message); }
      try { openOrders = (await client.getOpenOrders()) || []; } catch (e) { console.log("OpenOrders:", e.message); }
    }
  }

  const signal = market
    ? market.upPrice > 0.55 ? "DOWN" : market.downPrice > 0.55 ? "UP" : "NEUTRAL"
    : "NO_MARKET";

  const result = {
    balances,
    btc,
    market,
    orderbook: orderbook ? {
      bestAsk: orderbook.asks?.length ? orderbook.asks[orderbook.asks.length - 1] : null,
      bestBid: orderbook.bids?.length ? orderbook.bids[0] : null,
      askDepth: orderbook.asks?.length || 0,
      bidDepth: orderbook.bids?.length || 0,
    } : null,
    signal,
    openOrders,
    hasTradingKeys: HAS_TRADING,
    authRequired: HAS_AUTH,
    mode: RPOLY_MODE,
    timestamp: Date.now(),
  };

  console.log("[dashboard] done:", {
    proxyUsdc: balances.proxy?.usdc,
    btcPrice: btc.price,
    market: market?.question?.slice(0, 40) || "none",
    signal,
  });

  res.json(result);
});

// 5m markets list (public)
app.get("/api/markets/5m", async (req, res) => {
  try {
    const now = Math.floor(Date.now() / 1000);
    const current = Math.ceil(now / 300) * 300;
    const markets = [];

    for (let i = -2; i <= 4; i++) {
      const slot = current + i * 300;
      try {
        const r = await axios.get(`${GAMMA_API}/markets`, {
          params: { slug: `btc-updown-5m-${slot}` },
          timeout: 3000,
        });
        if (r.data?.length > 0) {
          const m = r.data[0];
          const prices = JSON.parse(m.outcomePrices || "[]");
          const tokenIds = m.clobTokenIds ? JSON.parse(m.clobTokenIds) : [];
          markets.push({
            question: m.question,
            slug: m.slug,
            closed: m.closed || false,
            upPrice: parseFloat(prices[0]) || 0,
            downPrice: parseFloat(prices[1]) || 0,
            volume: m.volumeNum || 0,
            resolved: m.resolved || false,
            endDate: m.endDate,
            conditionId: m.conditionId,
            tokenIds,
          });
        }
      } catch (e) {}
    }

    res.json({ markets, timestamp: Date.now() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Profile + full stats from Data API & Gamma API
app.get("/api/profile", async (req, res) => {
  const DATA_API = "https://data-api.polymarket.com";
  const addr = PROXY_ADDRESS;
  if (!addr) return res.json({ error: "No proxy address" });

  const result = {
    profile: null, positionsValue: 0, positions: [], closedPositions: [],
    activity: [], marketsTraded: 0, totalPnl: 0, realizedPnl: 0,
    biggestWin: 0, wins: 0, losses: 0, winRate: 0, totalVolume: 0,
  };

  const [profileRes, valueRes, positionsRes, tradedRes, closedRes, activityRes] = await Promise.all([
    axios.get(`${GAMMA_API}/public-profile`, { params: { address: addr }, timeout: 5000 }).catch(() => null),
    axios.get(`${DATA_API}/value`, { params: { user: addr }, timeout: 5000 }).catch(() => null),
    axios.get(`${DATA_API}/positions`, { params: { user: addr, limit: 50, sortBy: "CASHPNL", sortDirection: "DESC" }, timeout: 5000 }).catch(() => null),
    axios.get(`${DATA_API}/traded`, { params: { user: addr }, timeout: 5000 }).catch(() => null),
    axios.get(`${DATA_API}/closed-positions`, { params: { user: addr, limit: 50, sortBy: "REALIZEDPNL", sortDirection: "DESC" }, timeout: 5000 }).catch(() => null),
    axios.get(`${DATA_API}/activity`, { params: { user: addr, limit: 100 }, timeout: 5000 }).catch(() => null),
  ]);

  // Profile
  if (profileRes?.data) {
    const p = profileRes.data;
    result.profile = {
      name: p.name || p.pseudonym || "Anon",
      bio: p.bio || "",
      image: p.profileImage || null,
      createdAt: p.createdAt,
      xUsername: p.xUsername || null,
      verified: p.verifiedBadge || false,
    };
  }

  // Positions value
  if (valueRes?.data?.length > 0) {
    result.positionsValue = valueRes.data[0].value || 0;
  }

  // Open positions
  if (positionsRes?.data?.length > 0) {
    result.positions = positionsRes.data.map(p => ({
      title: p.title, outcome: p.outcome, size: p.size, avgPrice: p.avgPrice,
      curPrice: p.curPrice, currentValue: p.currentValue, cashPnl: p.cashPnl,
      percentPnl: p.percentPnl,
    }));
    result.totalPnl = positionsRes.data.reduce((sum, p) => sum + (p.cashPnl || 0), 0);
  }

  // Markets traded count
  if (tradedRes?.data) {
    result.marketsTraded = tradedRes.data.traded || 0;
  }

  // Closed positions -> realized PnL, wins, losses, biggest win
  if (closedRes?.data?.length > 0) {
    result.closedPositions = closedRes.data.map(p => ({
      title: p.title, outcome: p.outcome, avgPrice: p.avgPrice,
      totalBought: p.totalBought, realizedPnl: p.realizedPnl, curPrice: p.curPrice,
      timestamp: p.timestamp,
    }));
    result.realizedPnl = closedRes.data.reduce((sum, p) => sum + (p.realizedPnl || 0), 0);
    result.biggestWin = Math.max(0, ...closedRes.data.map(p => p.realizedPnl || 0));
    result.wins = closedRes.data.filter(p => (p.realizedPnl || 0) > 0).length;
    result.losses = closedRes.data.filter(p => (p.realizedPnl || 0) < 0).length;
    const closed = result.wins + result.losses;
    result.winRate = closed > 0 ? Math.round((result.wins / closed) * 100) : 0;
  }

  // Activity -> total volume, recent activity list
  if (activityRes?.data?.length > 0) {
    const acts = activityRes.data;
    result.totalVolume = acts.reduce((sum, a) => sum + (a.usdcSize || 0), 0);
    result.activity = acts.slice(0, 15).map(a => ({
      type: a.type, side: a.side, title: a.title, outcome: a.outcome,
      size: a.size, usdcSize: a.usdcSize, price: a.price,
      timestamp: a.timestamp, tx: a.transactionHash,
    }));
  }

  res.json(result);
});

// ===== PROTECTED ENDPOINTS (require auth) =====

// Trade
app.post("/api/trade", requireAuth, async (req, res) => {
  if (IS_READONLY) return res.status(403).json({ error: "Read-only mode. Trading disabled." });
  if (!HAS_TRADING) return res.status(400).json({ error: "Trading keys not configured" });

  try {
    const { side, size, price } = req.body;
    if (!side || !size) return res.status(400).json({ error: "Missing side or size" });

    const market = await findActive5mMarket();
    if (!market) return res.status(400).json({ error: "No active 5m market" });

    const tokenId = side === "UP" ? market.upTokenId : market.downTokenId;
    const client = getClobClient();
    if (!client) return res.status(500).json({ error: "ClobClient not available" });

    let tickSize = "0.01";
    try { tickSize = (await client.getTickSize(tokenId)) || "0.01"; } catch (e) {}

    let orderPrice = price;
    if (!orderPrice) {
      const book = await client.getOrderBook(tokenId);
      const bestAsk = book.asks?.length ? book.asks[book.asks.length - 1] : null;
      if (!bestAsk) return res.status(400).json({ error: "No asks in orderbook" });
      orderPrice = parseFloat(bestAsk.price);
    }

    const orderSize = Math.max(5, parseInt(size) || 5);
    console.log(`[trade] ${side} x${orderSize} @ $${orderPrice} on ${market.question}`);

    const result = await client.createAndPostOrder(
      { tokenID: tokenId, price: orderPrice, side: "BUY", size: orderSize, feeRateBps: 1000, nonce: 0 },
      { tickSize, negRisk: market.negRisk }
    );

    console.log("[trade] result:", result);

    res.json({
      success: result.success || false,
      orderID: result.orderID,
      status: result.status,
      market: market.question,
      side,
      size: orderSize,
      price: orderPrice,
      cost: (orderSize * orderPrice).toFixed(2),
      tx: result.transactionsHashes?.[0] || null,
      error: result.errorMsg || result.error || null,
    });
  } catch (e) {
    console.error("[trade] error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Cancel all orders
app.post("/api/cancel-all", requireAuth, async (req, res) => {
  if (IS_READONLY) return res.status(403).json({ error: "Read-only mode. Trading disabled." });
  if (!HAS_TRADING) return res.status(400).json({ error: "Trading keys not configured" });
  try {
    const client = getClobClient();
    if (!client) return res.status(500).json({ error: "ClobClient not available" });
    const result = await client.cancelAll();
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// BTC chart - supports ?interval=1s|1m|5m|15m
app.get("/api/chart", async (req, res) => {
  const INTERVALS = {
    "1s": { binance: "1s", limit: 300 },   // 5 min of 1s candles
    "1m": { binance: "1m", limit: 120 },   // 2 hours of 1m candles
    "5m": { binance: "5m", limit: 96 },    // 8 hours of 5m candles
    "15m": { binance: "15m", limit: 96 },  // 24 hours of 15m candles
  };
  const interval = INTERVALS[req.query.interval] || INTERVALS["1s"];

  try {
    const r = await axios.get("https://api.binance.com/api/v3/klines", {
      params: { symbol: "BTCUSDT", interval: interval.binance, limit: interval.limit },
      timeout: 5000,
    });
    const candles = r.data.map(c => ({ t: c[0], o: +c[1], h: +c[2], l: +c[3], c: +c[4] }));
    return res.json({ candles, interval: req.query.interval || "1s", source: "binance", timestamp: Date.now() });
  } catch (e) {
    console.log("Binance chart error:", e.message);
    res.status(500).json({ error: "Chart data unavailable: " + e.message });
  }
});

// ===== PAGES =====
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/markets", (req, res) => res.sendFile(path.join(__dirname, "markets.html")));

// ===== START =====
// Only listen when running directly (not on Vercel)
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    let eoaAddr = "NOT SET";
    try { if (Wallet) eoaAddr = new Wallet(PRIVATE_KEY).address; } catch (e) {}

    console.log("");
    console.log("  rPoly v2.1.0");
    console.log("  http://localhost:" + PORT);
    console.log("");
    console.log("  EOA:     " + eoaAddr);
    console.log("  Proxy:   " + (PROXY_ADDRESS || "NOT SET"));
    console.log("  Mode:    " + RPOLY_MODE.toUpperCase());
    console.log("  Trading: " + (IS_READONLY ? "DISABLED (readonly)" : HAS_TRADING ? "LIVE (signatureType=2 GNOSIS_SAFE)" : "NO KEYS"));
    console.log("  Auth:    " + (IS_READONLY ? "NOT NEEDED (readonly)" : HAS_AUTH ? "ENABLED" : "OPEN"));
    console.log("");
  });
}

// Export for Vercel serverless
module.exports = app;
