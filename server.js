require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

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

// builder-relayer/viem kept as dependencies for future gasless redeem (not used yet)

let brain;
try {
  brain = require("./brain/strategy.js");
  console.log("brain loaded OK — stage:", brain.IDENTITY.getCurrentStage(brain.loadMemory()).name);
} catch (e) {
  console.warn("brain not available:", e.message);
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

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
// Builder API creds kept in .env for future gasless redeem (not used in runtime yet)

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
  const current = Math.floor(now / 300) * 300;  // Current slot (may be active NOW)
  const next = current + 300;
  return [current, next, next + 300, next + 600];
}

const ASSET_CONFIGS = [
  { prefix: 'btc', binanceSymbol: 'BTCUSDT', name: 'BTC' },
  { prefix: 'eth', binanceSymbol: 'ETHUSDT', name: 'ETH' },
  { prefix: 'sol', binanceSymbol: 'SOLUSDT', name: 'SOL' },
];

async function getCryptoPrice(binanceSymbol) {
  try {
    const res = await axios.get("https://api.binance.com/api/v3/ticker/24hr", {
      params: { symbol: binanceSymbol },
      timeout: 5000,
    });
    const price = parseFloat(res.data.lastPrice) || 0;
    if (price > 0) return { price, change24h: parseFloat(res.data.priceChangePercent) || 0, source: "binance" };
  } catch (e) {}
  return { price: 0, change24h: 0, source: "none" };
}

async function findActive5mMarketForAsset(asset) {
  for (const slot of getCurrent5mSlots()) {
    try {
      const res = await axios.get(`${GAMMA_API}/markets`, {
        params: { slug: `${asset.prefix}-updown-5m-${slot}` },
        timeout: 5000,
      });
      if (res.data?.length > 0 && !res.data[0].closed) {
        const m = res.data[0];
        const tokenIds = JSON.parse(m.clobTokenIds || "[]");
        const outcomes = JSON.parse(m.outcomes || "[]");
        const prices = JSON.parse(m.outcomePrices || "[]");
        const eventStart = m.eventStartTime || null;
        let priceToBeat = null;
        if (eventStart) {
          const startMs = new Date(eventStart).getTime();
          try {
            const kRes = await axios.get("https://api.binance.com/api/v3/klines", {
              params: { symbol: asset.binanceSymbol, interval: "1m", startTime: startMs, limit: 1 },
              timeout: 5000,
            });
            if (kRes.data?.length > 0) {
              priceToBeat = parseFloat(kRes.data[0][1]);
            }
          } catch (e) {}
          if (!priceToBeat) {
            const fallback = await getCryptoPrice(asset.binanceSymbol);
            if (fallback.price > 0) priceToBeat = fallback.price;
          }
        }

        return {
          id: m.id,
          conditionId: m.conditionId,
          question: m.question,
          slug: m.slug,
          asset: asset.name,
          binanceSymbol: asset.binanceSymbol,
          negRisk: m.negRisk || false,
          upTokenId: tokenIds[0],
          downTokenId: tokenIds[1],
          outcomes,
          upPrice: parseFloat(prices[0]) || 0.5,
          downPrice: parseFloat(prices[1]) || 0.5,
          volume: m.volumeNum || m.volume || 0,
          liquidity: m.liquidityNum || m.liquidity || 0,
          endDate: m.endDate,
          eventStartTime: eventStart,
          priceToBeat,
        };
      }
    } catch (e) { /* next slot */ }
  }
  return null;
}

async function findActive5mMarket() {
  return await findActive5mMarketForAsset(ASSET_CONFIGS[0]);
}

// ===== 15-MINUTE MARKETS =====

function getCurrent15mSlots() {
  const now = Math.floor(Date.now() / 1000);
  const current = Math.floor(now / 900) * 900;
  const next = current + 900;
  return [current, next, next + 900];
}

async function findActive15mMarket() {
  for (const slot of getCurrent15mSlots()) {
    try {
      const res = await axios.get(`${GAMMA_API}/markets`, {
        params: { slug: `btc-updown-15m-${slot}` },
        timeout: 5000,
      });
      if (res.data?.length > 0 && !res.data[0].closed) {
        const m = res.data[0];
        const tokenIds = JSON.parse(m.clobTokenIds || "[]");
        const outcomes = JSON.parse(m.outcomes || "[]");
        const prices = JSON.parse(m.outcomePrices || "[]");
        const eventStart = m.eventStartTime || null;
        let priceToBeat = null;
        if (eventStart) {
          const startMs = new Date(eventStart).getTime();
          try {
            const kRes = await axios.get("https://api.binance.com/api/v3/klines", {
              params: { symbol: "BTCUSDT", interval: "1m", startTime: startMs, limit: 1 },
              timeout: 5000,
            });
            if (kRes.data?.length > 0) priceToBeat = parseFloat(kRes.data[0][1]);
          } catch (e) {}
          if (!priceToBeat) {
            const fallback = await getCryptoPrice("BTCUSDT");
            if (fallback.price > 0) priceToBeat = fallback.price;
          }
        }
        return {
          id: m.id, conditionId: m.conditionId, question: m.question, slug: m.slug,
          asset: "BTC-15m", binanceSymbol: "BTCUSDT", negRisk: m.negRisk || false,
          upTokenId: tokenIds[0], downTokenId: tokenIds[1], outcomes,
          upPrice: parseFloat(prices[0]) || 0.5, downPrice: parseFloat(prices[1]) || 0.5,
          volume: m.volumeNum || m.volume || 0, liquidity: m.liquidityNum || m.liquidity || 0,
          endDate: m.endDate, eventStartTime: eventStart, priceToBeat, marketType: "15m",
        };
      }
    } catch (e) {}
  }
  return null;
}

async function findAllActive5mMarkets() {
  const results = await Promise.all(
    ASSET_CONFIGS.map(asset => findActive5mMarketForAsset(asset).catch(() => null))
  );
  return results.filter(m => m !== null);
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
  // Try Binance first
  try {
    const res = await axios.get("https://api.binance.com/api/v3/ticker/24hr", {
      params: { symbol: "BTCUSDT" },
      timeout: 5000,
    });
    const price = parseFloat(res.data.lastPrice) || 0;
    if (price > 0) return { price, change24h: parseFloat(res.data.priceChangePercent) || 0, source: "binance" };
  } catch (e) {
    console.log("[btc] Binance failed:", e.message);
  }

  // Fallback 1: CoinGecko
  try {
    const res = await axios.get("https://api.coingecko.com/api/v3/simple/price", {
      params: { ids: "bitcoin", vs_currencies: "usd", include_24hr_change: "true" },
      timeout: 5000,
    });
    const price = res.data?.bitcoin?.usd || 0;
    if (price > 0) return { price, change24h: res.data?.bitcoin?.usd_24h_change || 0, source: "coingecko" };
  } catch (e) {
    console.log("[btc] CoinGecko failed:", e.message);
  }

  // Fallback 2: CoinCap
  try {
    const res = await axios.get("https://api.coincap.io/v2/assets/bitcoin", { timeout: 5000 });
    const price = parseFloat(res.data?.data?.priceUsd) || 0;
    if (price > 0) return { price, change24h: parseFloat(res.data?.data?.changePercent24Hr) || 0, source: "coincap" };
  } catch (e) {
    console.log("[btc] CoinCap failed:", e.message);
  }

  console.log("[btc] ALL sources failed — returning 0");
  return { price: 0, change24h: 0, source: "none" };
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

async function fetchOrderbookForMarket(mkt) {
  if (!mkt?.upTokenId) return { orderbook: null, downOrderbook: null };
  const client = getClobClient();
  if (!client) return { orderbook: null, downOrderbook: null };

  const [obResult, dnObResult] = await Promise.all([
    client.getOrderBook(mkt.upTokenId).catch(() => null),
    mkt.downTokenId ? client.getOrderBook(mkt.downTokenId).catch(() => null) : null,
  ]);

  const formatOb = (ob) => ob ? {
    bestAsk: ob.asks?.length ? ob.asks[ob.asks.length - 1] : null,
    bestBid: ob.bids?.length ? ob.bids[ob.bids.length - 1] : null,
    askDepth: ob.asks?.length || 0,
    bidDepth: ob.bids?.length || 0,
  } : null;

  return { orderbook: formatOb(obResult), downOrderbook: formatOb(dnObResult) };
}

// Dashboard data (public read - no secrets exposed)
app.get("/api/dashboard", async (req, res) => {
  console.log("[dashboard] fetching...");

  const [balances, btc, allMarkets, market15m, positionsRes] = await Promise.all([
    getBalances().catch(() => ({ eoa: { usdc: 0, matic: 0 }, proxy: { usdc: 0 }, totalUsdc: 0 })),
    getBTCPrice().catch(() => ({ price: 0, change24h: 0 })),
    findAllActive5mMarkets().catch(() => []),
    findActive15mMarket().catch(() => null),
    axios.get("https://data-api.polymarket.com/positions", {
      params: { user: PROXY_ADDRESS, limit: 50, sizeThreshold: 0, sortBy: "CASHPNL", sortDirection: "DESC" },
      timeout: 5000,
    }).catch(() => null),
  ]);

  // Parse open positions for agent's pre-close sell logic
  const positions = (positionsRes?.data || []).map(p => ({
    conditionId: p.conditionId,
    asset: p.asset,
    title: p.title,
    side: p.outcome,
    size: p.size,
    avgPrice: p.avgPrice,
    curPrice: p.curPrice,
    currentValue: p.currentValue,
    cashPnl: p.cashPnl,
    endDate: p.endDate,
    redeemable: p.redeemable,
  }));

  // Include 15m market in the pool if found
  const allMarketsPlus15m = market15m ? [...allMarkets, market15m] : allMarkets;

  // Fetch orderbooks + live crypto prices for all markets in parallel
  const marketsWithOb = await Promise.all(
    allMarketsPlus15m.map(async (mkt) => {
      const [{ orderbook, downOrderbook }, livePrice] = await Promise.all([
        fetchOrderbookForMarket(mkt),
        getCryptoPrice(mkt.binanceSymbol).catch(() => ({ price: 0 })),
      ]);
      return { ...mkt, orderbook, downOrderbook, cryptoPrice: livePrice.price };
    })
  );

  // Primary market (BTC for backward compat)
  const market = allMarkets.find(m => m.asset === 'BTC') || allMarkets[0] || null;
  const primaryMkt = marketsWithOb.find(m => m.asset === 'BTC') || marketsWithOb[0] || null;

  let orderbook = primaryMkt?.orderbook || null;
  let downOrderbook = primaryMkt?.downOrderbook || null;
  let openOrders = [];
  let midpoint = null;
  let spread = null;

  if (market?.upTokenId) {
    const client = getClobClient();
    const fetches = [
      client ? client.getOpenOrders().catch(() => []) : [],
      axios.get(CLOB_API + "/midpoint", { params: { token_id: market.upTokenId }, timeout: 3000 }).catch(() => null),
      axios.get(CLOB_API + "/spread", { params: { token_id: market.upTokenId }, timeout: 3000 }).catch(() => null),
    ];
    const [ordersResult, midResult, spreadResult] = await Promise.all(fetches);
    openOrders = ordersResult || [];
    midpoint = midResult?.data?.mid ? parseFloat(midResult.data.mid) : null;
    spread = spreadResult?.data?.spread ? parseFloat(spreadResult.data.spread) : null;
  }

  // Build rich signal
  let signal;
  if (!market) {
    signal = { direction: "NO_MARKET", confidence: 0, factors: {}, midpoint: null, spread: null };
  } else {
    const up = market.upPrice;
    const dn = market.downPrice;
    const skew = Math.abs(up - 0.5);
    const confidence = Math.min(Math.round(skew * 200), 100);

    const direction = up > 0.55 ? "DOWN" : dn > 0.55 ? "UP" : "NEUTRAL";

    const askDepth = orderbook?.askDepth || 0;
    const bidDepth = orderbook?.bidDepth || 0;
    const bookBias = bidDepth > askDepth * 1.3 ? "BUY" : askDepth > bidDepth * 1.3 ? "SELL" : "BALANCED";
    const btcBias = btc.change24h > 0.5 ? "UP" : btc.change24h < -0.5 ? "DOWN" : "FLAT";
    const volBias = (market.volume || 0) > 5000 ? "HIGH" : "LOW";

    signal = {
      direction,
      confidence,
      midpoint,
      spread,
      factors: {
        marketSkew: { label: "Market Odds", value: up, pct: Math.round(up * 100), bias: up > 0.55 ? "DOWN" : dn > 0.55 ? "UP" : "NEUTRAL", strength: Math.min(Math.round(skew * 10), 5) },
        btcTrend:   { label: "BTC 24h", value: btc.change24h, bias: btcBias, strength: Math.min(Math.round(Math.abs(btc.change24h)), 5) },
        volume:     { label: "Volume", value: market.volume || 0, bias: volBias, strength: volBias === "HIGH" ? 4 : (market.volume || 0) > 1000 ? 2 : 1 },
        bookDepth:  { label: "Book Depth", askDepth, bidDepth, bias: bookBias, strength: Math.min(Math.round((askDepth + bidDepth) / 5), 5) },
      },
    };
  }

  const result = {
    balances,
    btc,
    market,
    markets: marketsWithOb,
    positions,
    orderbook,
    downOrderbook,
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
    marketsFound: marketsWithOb.map(m => m.asset).join(',') || 'none',
    market: market?.question?.slice(0, 40) || "none",
    signal: signal.direction,
    confidence: signal.confidence,
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
          let ptb = null;
          const evStart = m.eventStartTime || null;
          if (evStart) {
            try {
              const sMs = new Date(evStart).getTime();
              if (sMs <= Date.now()) {
                const kr = await axios.get("https://api.binance.com/api/v3/klines", {
                  params: { symbol: "BTCUSDT", interval: "1m", startTime: sMs, limit: 1 },
                  timeout: 3000,
                });
                if (kr.data?.length > 0) ptb = parseFloat(kr.data[0][1]);
              }
            } catch (e) {}
            if (!ptb) {
              try { const fb = await getBTCPrice(); if (fb.price > 0) ptb = fb.price; } catch (e) {}
            }
          }
          markets.push({
            question: m.question,
            slug: m.slug,
            closed: m.closed || false,
            upPrice: parseFloat(prices[0]) || 0,
            downPrice: parseFloat(prices[1]) || 0,
            volume: m.volumeNum || 0,
            resolved: m.resolved || false,
            endDate: m.endDate,
            eventStartTime: evStart,
            priceToBeat: ptb,
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
    axios.get(`${DATA_API}/activity`, { params: { user: addr, limit: 500 }, timeout: 10000 }).catch(() => null),
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
  }

  // Markets traded count
  if (tradedRes?.data) {
    result.marketsTraded = tradedRes.data.traded || 0;
  }

  // Closed positions (keep for reference)
  if (closedRes?.data?.length > 0) {
    result.closedPositions = closedRes.data.map(p => ({
      title: p.title, outcome: p.outcome, avgPrice: p.avgPrice,
      totalBought: p.totalBought, realizedPnl: p.realizedPnl, curPrice: p.curPrice,
      timestamp: p.timestamp,
    }));
  }

  // REAL stats from activity — per-market buy vs sell+redeem accounting
  if (activityRes?.data?.length > 0) {
    const acts = activityRes.data;
    result.totalVolume = acts.reduce((sum, a) => sum + (a.usdcSize || 0), 0);
    result.activity = acts.slice(0, 15).map(a => ({
      type: a.type, side: a.side, title: a.title, outcome: a.outcome,
      size: a.size, usdcSize: a.usdcSize, price: a.price,
      timestamp: a.timestamp, tx: a.transactionHash,
    }));

    // Per-market P/L (real accounting)
    const marketAccounting = {};
    acts.forEach(a => {
      const id = a.conditionId;
      if (!id) return;
      if (!marketAccounting[id]) marketAccounting[id] = { spent: 0, received: 0, title: a.title };
      const usd = parseFloat(a.usdcSize) || 0;
      if (a.type === "TRADE" && a.side === "BUY") marketAccounting[id].spent += usd;
      else if (a.type === "TRADE" && a.side === "SELL") marketAccounting[id].received += usd;
      else if (a.type === "REDEEM") marketAccounting[id].received += usd;
    });

    let totalPnl = 0, wins = 0, losses = 0, bestTrade = 0, worstTrade = 0;
    Object.values(marketAccounting).forEach(m => {
      const pnl = m.received - m.spent;
      totalPnl += pnl;
      if (pnl > 0.01) { wins++; if (pnl > bestTrade) bestTrade = pnl; }
      else if (pnl < -0.01) { losses++; if (pnl < worstTrade) worstTrade = pnl; }
    });

    result.totalPnl = totalPnl;
    result.realizedPnl = totalPnl;
    result.wins = wins;
    result.losses = losses;
    result.biggestWin = bestTrade;
    result.worstTrade = worstTrade;
    const closed = wins + losses;
    result.winRate = closed > 0 ? Math.round((wins / closed) * 100) : 0;
  }

  if (statsBaseline?.profile) {
    const bp = statsBaseline.profile;
    result.totalPnl = result.totalPnl - (bp.totalPnl || 0);
    result.realizedPnl = result.realizedPnl - (bp.realizedPnl || 0);
    result.wins = Math.max(0, result.wins - (bp.wins || 0));
    result.losses = Math.max(0, result.losses - (bp.losses || 0));
    const adjClosed = result.wins + result.losses;
    result.winRate = adjClosed > 0 ? Math.round((result.wins / adjClosed) * 100) : 0;
    result.totalVolume = Math.max(0, result.totalVolume - (bp.totalVolume || 0));
    result.baselineActive = true;
  }

  res.json(result);
});

// ===== PROTECTED ENDPOINTS (require auth) =====

// Trade
app.post("/api/trade", requireAuth, async (req, res) => {
  if (IS_READONLY) return res.status(403).json({ error: "Read-only mode. Trading disabled." });
  if (!HAS_TRADING) return res.status(400).json({ error: "Trading keys not configured" });

  try {
    const { side, size, price, orderType, asset } = req.body;
    if (!side || !size) return res.status(400).json({ error: "Missing side or size" });

    let market;
    if (asset === "BTC-15m") {
      market = await findActive15mMarket();
      if (!market) return res.status(400).json({ error: "No active 15m BTC market" });
    } else {
      const assetConfig = asset ? ASSET_CONFIGS.find(a => a.name === asset) : ASSET_CONFIGS[0];
      market = await findActive5mMarketForAsset(assetConfig || ASSET_CONFIGS[0]);
      if (!market) return res.status(400).json({ error: `No active 5m market for ${asset || 'BTC'}` });
    }

    const tokenId = side === "UP" ? market.upTokenId : market.downTokenId;
    const client = getClobClient();
    if (!client) return res.status(500).json({ error: "ClobClient not available" });

    let tickSize = "0.01";
    try { tickSize = (await client.getTickSize(tokenId)) || "0.01"; } catch (e) {}

    // For market orders (FOK): amount = dollars to spend
    // For limit orders (GTC): need price + size
    const useMarketOrder = !price && orderType !== "GTC";
    const amountUsd = Math.max(1, parseFloat(size) || 5);

    if (useMarketOrder) {
      // FOK MARKET ORDER — instant fill or cancel entirely
      console.log(`[trade] MARKET BUY ${side} $${amountUsd} on ${market.question}`);

      const result = await client.createAndPostMarketOrder(
        { tokenID: tokenId, amount: amountUsd, side: "BUY", feeRateBps: 1000, nonce: 0 },
        { tickSize, negRisk: market.negRisk },
        "FOK"
      );

      console.log("[trade] FOK result:", JSON.stringify(result));

      logTrade({ action: "BUY_MKT", side, amount: amountUsd, market: market.question, result: result.success ? "OK" : (result.errorMsg || "FAIL") });

      res.json({
        success: result.success || false,
        orderID: result.orderID,
        status: result.status,
        market: market.question,
        side,
        size: amountUsd,
        price: null,
        cost: amountUsd.toFixed(2),
        type: "FOK",
        tx: result.transactionsHashes?.[0] || null,
        error: result.errorMsg || result.error || null,
      });
    } else {
      // GTC LIMIT ORDER — rests on book
      let orderPrice = parseFloat(price);
      if (!orderPrice) {
        const book = await client.getOrderBook(tokenId);
        const bestAsk = book.asks?.length ? book.asks[book.asks.length - 1] : null;
        if (!bestAsk) return res.status(400).json({ error: "No asks in orderbook" });
        orderPrice = parseFloat(bestAsk.price);
      }

      const orderSize = Math.max(5, parseInt(size) || 5);
      console.log(`[trade] LIMIT BUY ${side} x${orderSize} @ $${orderPrice} on ${market.question}`);

      const result = await client.createAndPostOrder(
        { tokenID: tokenId, price: orderPrice, side: "BUY", size: orderSize, feeRateBps: 1000, nonce: 0 },
        { tickSize, negRisk: market.negRisk }
      );

      console.log("[trade] GTC result:", JSON.stringify(result));

      logTrade({ action: "BUY_LMT", side, size: orderSize, price: orderPrice, market: market.question, result: result.success ? "OK" : (result.errorMsg || "FAIL") });

      res.json({
        success: result.success || false,
        orderID: result.orderID,
        status: result.status,
        market: market.question,
        side,
        size: orderSize,
        price: orderPrice,
        cost: (orderSize * orderPrice).toFixed(2),
        type: "GTC",
        tx: result.transactionsHashes?.[0] || null,
        error: result.errorMsg || result.error || null,
      });
    }
  } catch (e) {
    console.error("[trade] error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Sell (market sell existing position — FOK by default)
app.post("/api/sell", requireAuth, async (req, res) => {
  if (IS_READONLY) return res.status(403).json({ error: "Read-only mode. Trading disabled." });
  if (!HAS_TRADING) return res.status(400).json({ error: "Trading keys not configured" });
  try {
    const { side, size, price, orderType, asset } = req.body;
    if (!side || !size) return res.status(400).json({ error: "Missing side or size" });

    let market;
    if (asset === "BTC-15m") {
      market = await findActive15mMarket();
      if (!market) return res.status(400).json({ error: "No active 15m BTC market" });
    } else {
      const assetConfig = asset ? ASSET_CONFIGS.find(a => a.name === asset) : ASSET_CONFIGS[0];
      market = await findActive5mMarketForAsset(assetConfig || ASSET_CONFIGS[0]);
      if (!market) return res.status(400).json({ error: `No active 5m market for ${asset || 'BTC'}` });
    }

    const tokenId = side === "UP" ? market.upTokenId : market.downTokenId;
    const client = getClobClient();
    if (!client) return res.status(500).json({ error: "ClobClient not available" });

    let tickSize = "0.01";
    try { tickSize = (await client.getTickSize(tokenId)) || "0.01"; } catch (e) {}

    const useMarketOrder = !price && orderType !== "GTC";
    const shareCount = parseFloat(size) || 1;
    if (shareCount < 0.01) return res.json({ success: true, skipped: true, reason: "size too small" });

    if (useMarketOrder) {
      // FOK MARKET SELL — instant fill, amount = shares to sell
      console.log(`[sell] MARKET SELL ${side} x${shareCount} shares on ${market.question}`);

      const result = await client.createAndPostMarketOrder(
        { tokenID: tokenId, amount: shareCount, side: "SELL", feeRateBps: 1000, nonce: 0 },
        { tickSize, negRisk: market.negRisk },
        "FOK"
      );

      console.log("[sell] FOK result:", JSON.stringify(result));

      logTrade({ action: "SELL_MKT", side, shares: shareCount, market: market.question, result: result.success ? "OK" : (result.errorMsg || "FAIL") });

      res.json({
        success: result.success || false,
        orderID: result.orderID,
        status: result.status,
        market: market.question,
        side,
        size: shareCount,
        price: null,
        type: "FOK",
        tx: result.transactionsHashes?.[0] || null,
        error: result.errorMsg || result.error || null,
      });
    } else {
      // GTC LIMIT SELL
      let orderPrice = parseFloat(price);
      if (!orderPrice) {
        const book = await client.getOrderBook(tokenId);
        const bestBid = book.bids?.length ? book.bids[book.bids.length - 1] : null;
        if (!bestBid) return res.status(400).json({ error: "No bids in orderbook" });
        orderPrice = parseFloat(bestBid.price);
      }

      const orderSize = Math.max(1, parseInt(size) || 1);
      console.log(`[sell] LIMIT SELL ${side} x${orderSize} @ $${orderPrice} on ${market.question}`);

      const result = await client.createAndPostOrder(
        { tokenID: tokenId, price: orderPrice, side: "SELL", size: orderSize, feeRateBps: 1000, nonce: 0 },
        { tickSize, negRisk: market.negRisk }
      );

      logTrade({ action: "SELL_LMT", side, size: orderSize, price: orderPrice, market: market.question, result: result.success ? "OK" : (result.errorMsg || "FAIL") });

      res.json({
        success: result.success || false,
        orderID: result.orderID,
        status: result.status,
        market: market.question,
        side,
        size: orderSize,
        price: orderPrice,
        revenue: (orderSize * orderPrice).toFixed(2),
        type: "GTC",
        tx: result.transactionsHashes?.[0] || null,
        error: result.errorMsg || result.error || null,
      });
    }
  } catch (e) {
    console.error("[sell] error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Sell orphaned position by tokenId (for old/non-current markets)
app.post("/api/sell-orphan", requireAuth, async (req, res) => {
  if (IS_READONLY) return res.status(403).json({ error: "Read-only mode." });
  if (!HAS_TRADING) return res.status(400).json({ error: "Trading keys not configured" });
  try {
    const { tokenId, size } = req.body;
    if (!tokenId || !size) return res.status(400).json({ error: "Missing tokenId or size" });

    const client = getClobClient();
    if (!client) return res.status(500).json({ error: "ClobClient not available" });

    let tickSize = "0.01";
    try { tickSize = (await client.getTickSize(tokenId)) || "0.01"; } catch (e) {}

    const shareCount = parseFloat(size) || 1;
    if (shareCount < 0.01) return res.json({ success: true, skipped: true, reason: "size too small" });
    console.log(`[sell-orphan] MARKET SELL tokenId=${tokenId.slice(0, 12)}... x${shareCount} shares`);

    const result = await client.createAndPostMarketOrder(
      { tokenID: tokenId, amount: shareCount, side: "SELL", feeRateBps: 1000, nonce: 0 },
      { tickSize, negRisk: false },
      "FOK"
    );

    console.log("[sell-orphan] FOK result:", JSON.stringify(result));

    if (result?.orderID || result?.orderHashes?.length > 0) {
      res.json({ success: true, status: result.status || "matched", price: null });
    } else {
      res.json({
        success: false,
        status: result.status || "failed",
        error: result.errorMsg || "no match",
      });
    }
  } catch (e) {
    console.error("[sell-orphan] error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Sell limit (take-profit / stop-loss)
app.post("/api/sell-limit", requireAuth, async (req, res) => {
  if (IS_READONLY) return res.status(403).json({ error: "Read-only mode. Trading disabled." });
  if (!HAS_TRADING) return res.status(400).json({ error: "Trading keys not configured" });
  try {
    const { side, size, price, expireSeconds } = req.body;
    if (!side || !size || !price) return res.status(400).json({ error: "Missing side, size, or price" });

    const market = await findActive5mMarket();
    if (!market) return res.status(400).json({ error: "No active 5m market" });

    const tokenId = side === "UP" ? market.upTokenId : market.downTokenId;
    const client = getClobClient();
    if (!client) return res.status(500).json({ error: "ClobClient not available" });

    let tickSize = "0.01";
    try { tickSize = (await client.getTickSize(tokenId)) || "0.01"; } catch (e) {}

    const orderSize = Math.max(1, parseInt(size) || 1);
    const orderPrice = parseFloat(price);
    const expSec = parseInt(expireSeconds) || 300;
    const expiration = Math.floor(Date.now() / 1000) + 60 + expSec;

    console.log(`[sell-limit] ${side} x${orderSize} @ $${orderPrice} exp=${expSec}s on ${market.question}`);

    const result = await client.createAndPostOrder(
      { tokenID: tokenId, price: orderPrice, side: "SELL", size: orderSize, feeRateBps: 1000, nonce: 0, expiration },
      { tickSize, negRisk: market.negRisk }
    );

    logTrade({ action: "SELL-LIMIT", side, size: orderSize, price: orderPrice, market: market.question, result: result.success ? "OK" : (result.errorMsg || "FAIL") });

    res.json({
      success: result.success || false,
      orderID: result.orderID,
      status: result.status,
      market: market.question,
      side,
      size: orderSize,
      price: orderPrice,
      expiresIn: expSec + "s",
      error: result.errorMsg || result.error || null,
    });
  } catch (e) {
    console.error("[sell-limit] error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Open orders
app.get("/api/open-orders", async (req, res) => {
  try {
    const client = getClobClient();
    if (!client) return res.json({ orders: [] });
    const orders = await client.getOpenOrders();
    res.json({ orders: (orders || []).map(o => ({
      id: o.id,
      side: o.side,
      price: o.price,
      size: o.original_size || o.size,
      filledSize: o.size_matched || 0,
      status: o.status,
      tokenId: o.asset_id,
      created: o.created_at,
      expiration: o.expiration,
    })) });
  } catch (e) {
    res.json({ orders: [], error: e.message });
  }
});

// Cancel single order
app.post("/api/cancel-order/:id", requireAuth, async (req, res) => {
  if (IS_READONLY) return res.status(403).json({ error: "Read-only mode." });
  if (!HAS_TRADING) return res.status(400).json({ error: "Trading keys not configured" });
  try {
    const client = getClobClient();
    if (!client) return res.status(500).json({ error: "ClobClient not available" });
    const result = await client.cancelOrder({ orderID: req.params.id });
    res.json({ success: true, ...result });
  } catch (e) {
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

// ===== BOT MESSAGE TICKER =====
let botMessages = [];
const BOT_MSG_FILE = path.join(__dirname, "trades", "bot-messages.json");

function loadBotMessages() {
  try {
    if (fs.existsSync(BOT_MSG_FILE)) botMessages = JSON.parse(fs.readFileSync(BOT_MSG_FILE, "utf8"));
  } catch (e) { botMessages = []; }
}
loadBotMessages();

function saveBotMessages() {
  try { fs.writeFileSync(BOT_MSG_FILE, JSON.stringify(botMessages.slice(-50))); } catch (e) {}
}

app.post("/api/bot-message", requireAuth, async (req, res) => {
  const { text, type } = req.body;
  if (!text) return res.status(400).json({ error: "Missing text" });
  const msg = { text, type: type || "info", ts: Date.now() };
  botMessages.push(msg);
  if (botMessages.length > 50) botMessages = botMessages.slice(-50);
  saveBotMessages();
  res.json({ success: true, msg });
});

app.get("/api/bot-messages", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  res.json({ messages: botMessages.slice(-limit) });
});

// ===== TRADE LOG =====
let tradeLog = [];
const TRADE_LOG_FILE = path.join(__dirname, "trades", "trade-log.json");

function loadTradeLog() {
  try {
    if (fs.existsSync(TRADE_LOG_FILE)) tradeLog = JSON.parse(fs.readFileSync(TRADE_LOG_FILE, "utf8"));
  } catch (e) { tradeLog = []; }
}
loadTradeLog();

function logTrade(entry) {
  entry.ts = Date.now();
  tradeLog.push(entry);
  if (tradeLog.length > 100) tradeLog = tradeLog.slice(-100);
  try { fs.writeFileSync(TRADE_LOG_FILE, JSON.stringify(tradeLog)); } catch (e) {}
}

app.get("/api/trade-log", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 30, 100);
  res.json({ trades: tradeLog.slice(-limit).reverse() });
});

// ===== REDEEM (manual for now, sell-before-close strategy) =====
// Contract addresses kept for future auto-redeem implementation:
// CTF: 0x4D97DCd97eC945f40cF65F87097ACe5EA0476045
// NegRiskAdapter: 0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296

app.get("/api/redeemable", async (req, res) => {
  try {
    const r = await axios.get("https://data-api.polymarket.com/positions", {
      params: { user: PROXY_ADDRESS, redeemable: true, sizeThreshold: 0.01, limit: 100 },
      timeout: 10000,
    });
    const positions = r.data || [];
    const byCondition = {};
    positions.forEach(p => {
      const cid = p.conditionId;
      if (!byCondition[cid]) {
        byCondition[cid] = { conditionId: cid, title: p.title || "Unknown", negRisk: !!p.negativeRisk, outcomes: [], totalValue: 0 };
      }
      const val = Math.max(0, parseFloat(p.currentValue) || 0);
      const size = Math.max(0, parseFloat(p.size) || 0);
      byCondition[cid].outcomes.push({ outcome: p.outcome, index: p.outcomeIndex, size, value: val });
      byCondition[cid].totalValue += val;
    });
    const grouped = Object.values(byCondition);
    const totalValue = grouped.reduce((s, g) => s + g.totalValue, 0);
    res.json({ count: grouped.length, totalValue: +totalValue.toFixed(4), positions: grouped });
  } catch (e) {
    console.log("[redeemable] error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/redeem — STUB (manual redeem for now)
// Bot strategy: SELL 30s before market close to avoid needing redeem.
// If positions go to resolution, owner redeems manually via polymarket.com.
// TODO: Implement automated gasless redeem via Builder Relayer when stable.
app.post("/api/redeem", requireAuth, async (req, res) => {
  res.json({
    success: false,
    message: "Auto-redeem not yet implemented. Redeem manually at polymarket.com. Bot should SELL 30s before market close instead.",
    redeemableUrl: "/api/redeemable",
  });
});

// ===== DISPLAY BASELINE (show stats "from now") =====
const BASELINE_FILE = path.join(__dirname, "trades", "stats-baseline.json");

function loadBaseline() {
  try {
    if (fs.existsSync(BASELINE_FILE)) return JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));
  } catch (e) {}
  return null;
}

let statsBaseline = loadBaseline();

app.post("/api/reset-display", requireAuth, (req, res) => {
  if (!brain) return res.status(500).json({ error: "Brain not loaded" });
  const memory = brain.loadMemory();
  statsBaseline = {
    resetAt: Date.now(),
    resetDate: new Date().toISOString(),
    brain: {
      totalTrades: memory.stats.totalTrades,
      wins: memory.stats.wins,
      losses: memory.stats.losses,
      skips: memory.stats.skips,
      totalPnl: memory.stats.totalPnl,
      bestTrade: memory.stats.bestTrade,
      worstTrade: memory.stats.worstTrade,
    },
    profile: {
      totalPnl: 0,
      realizedPnl: 0,
      wins: 0,
      losses: 0,
      biggestWin: 0,
      totalVolume: 0,
    },
  };

  try {
    const profileData = {};
    axios.get(`https://data-api.polymarket.com/activity`, {
      params: { user: PROXY_ADDRESS, limit: 500 },
      timeout: 10000,
    }).then(activityRes => {
      if (activityRes?.data?.length > 0) {
        const acts = activityRes.data;
        const marketAccounting = {};
        acts.forEach(a => {
          const id = a.conditionId;
          if (!id) return;
          if (!marketAccounting[id]) marketAccounting[id] = { spent: 0, received: 0 };
          const usd = parseFloat(a.usdcSize) || 0;
          if (a.type === "TRADE" && a.side === "BUY") marketAccounting[id].spent += usd;
          else if (a.type === "TRADE" && a.side === "SELL") marketAccounting[id].received += usd;
          else if (a.type === "REDEEM") marketAccounting[id].received += usd;
        });
        let totalPnl = 0, wins = 0, losses = 0, bestTrade = 0;
        Object.values(marketAccounting).forEach(m => {
          const pnl = m.received - m.spent;
          totalPnl += pnl;
          if (pnl > 0.01) { wins++; if (pnl > bestTrade) bestTrade = pnl; }
          else if (pnl < -0.01) losses++;
        });
        statsBaseline.profile = { totalPnl, realizedPnl: totalPnl, wins, losses, biggestWin: bestTrade, totalVolume: acts.reduce((s, a) => s + (a.usdcSize || 0), 0) };
        fs.writeFileSync(BASELINE_FILE, JSON.stringify(statsBaseline, null, 2));
      }
    }).catch(() => {});
  } catch (e) {}

  fs.writeFileSync(BASELINE_FILE, JSON.stringify(statsBaseline, null, 2));
  console.log("[reset-display] Stats baseline saved at", new Date().toISOString());
  res.json({ success: true, resetAt: statsBaseline.resetDate, baseline: statsBaseline });
});

app.get("/api/baseline", (req, res) => {
  res.json(statsBaseline || { active: false });
});

// ===== BRAIN (Trading Intelligence) =====

// GET /api/strategies — Available strategy profiles
app.get("/api/strategies", (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, "brain", "strategy-profiles.json"), "utf8"));
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: "Strategy profiles not found" });
  }
});

// GET /api/brain/status — Full brain introspection (with baseline offset)
app.get("/api/brain/status", (req, res) => {
  if (!brain) return res.status(500).json({ error: "Brain not loaded" });
  const status = brain.getStatus();

  if (statsBaseline?.brain) {
    const b = statsBaseline.brain;
    const rawWins = parseInt(status.memory.wins) || 0;
    const rawLosses = parseInt(status.memory.losses) || 0;
    const adjWins = Math.max(0, rawWins - (b.wins || 0));
    const adjLosses = Math.max(0, rawLosses - (b.losses || 0));
    const adjTotal = adjWins + adjLosses;
    const rawPnl = parseFloat(String(status.memory.totalPnl).replace('$','')) || 0;
    const adjPnl = rawPnl - (b.totalPnl || 0);

    status.memory.totalTrades = (status.memory.totalTrades || 0) - (b.totalTrades || 0);
    status.memory.wins = adjWins;
    status.memory.losses = adjLosses;
    status.memory.skips = Math.max(0, (parseInt(status.memory.skips) || 0) - (b.skips || 0));
    status.memory.winRate = adjTotal > 0 ? (adjWins / adjTotal * 100).toFixed(1) + "%" : "0.0%";
    status.memory.totalPnl = "$" + adjPnl.toFixed(2);

    const mem = brain.loadMemory();
    const postResetTrades = (mem.recentTrades || []).filter(t => t.ts > statsBaseline.resetAt);
    if (postResetTrades.length > 0) {
      const best = Math.max(...postResetTrades.map(t => t.pnl));
      const worst = Math.min(...postResetTrades.map(t => t.pnl));
      status.memory.bestTrade = "$" + Math.max(0, best).toFixed(2);
      status.memory.worstTrade = "$" + Math.min(0, worst).toFixed(2);
    } else {
      status.memory.bestTrade = "$0.00";
      status.memory.worstTrade = "$0.00";
    }

    status.baselineActive = true;
    status.baselineResetAt = statsBaseline.resetDate;
  }

  res.json(status);
});

// POST /api/brain/analyze — Run analysis on current market data
app.post("/api/brain/analyze", requireAuth, async (req, res) => {
  if (!brain) return res.status(500).json({ error: "Brain not loaded" });

  try {
    // Fetch all data sources the brain needs
    const [dashRes, oddsRes, whalesRes, globalRes, patternsRes] = await Promise.allSettled([
      axios.get(`http://localhost:${PORT}/api/dashboard`),
      axios.get(`http://localhost:${PORT}/api/learn/odds-history`),
      axios.get(`http://localhost:${PORT}/api/learn/whales`),
      axios.get(`http://localhost:${PORT}/api/learn/global-trades`),
      axios.get(`http://localhost:${PORT}/api/learn/patterns`),
    ]);

    const dash = dashRes.status === "fulfilled" ? dashRes.value.data : {};
    const bankroll = req.body.bankroll || dash.balances?.proxy?.usdc || 0;

    // Use market data from agent request (per-asset), fallback to dashboard
    const market = req.body.market || dash.market || {};
    const cryptoPrice = req.body.btcPrice || market.cryptoPrice || dash.btc?.price || 0;

    // Enrich market with orderbook data from dashboard if not already present
    const dashMarket = (dash.markets || []).find(m => m.conditionId === market.conditionId);
    const ob = dashMarket?.orderbook || dash.orderbook;
    const dnOb = dashMarket?.downOrderbook || dash.downOrderbook;
    if (ob && !market.bestAsk) {
      const bestAsk = ob.bestAsk ? parseFloat(ob.bestAsk.price) : null;
      const bestBid = ob.bestBid ? parseFloat(ob.bestBid.price) : null;
      market.askDepth = ob.askDepth || 0;
      market.bidDepth = ob.bidDepth || 0;
      market.bestAsk = bestAsk;
      market.bestBid = bestBid;
      if (bestAsk && bestBid) market.bookSpread = (bestAsk - bestBid) / bestAsk;
    }
    if (dash.signal && !market.apiSpread) {
      market.apiSpread = dash.signal.spread || null;
      market.apiMidpoint = dash.signal.midpoint || null;
    }

    // Use time left from agent request, fallback to calculation
    const timeLeftSec = req.body.timeLeftSec || (market.endDate ? Math.max(0, Math.floor((new Date(market.endDate).getTime() - Date.now()) / 1000)) : 0);

    // Extract arrays from wrapped API responses:
    // odds-history returns { count, data: [...] }
    // whales returns { latest: {...}, totalScans }  — brain expects array of snapshots
    // global-trades returns { trades: [...], stats }
    // patterns returns object (already correct)
    const oddsData = oddsRes.status === "fulfilled" ? oddsRes.value.data : {};
    const whalesData = whalesRes.status === "fulfilled" ? whalesRes.value.data : {};
    const globalData = globalRes.status === "fulfilled" ? globalRes.value.data : {};
    const patternsData = patternsRes.status === "fulfilled" ? patternsRes.value.data : null;

    const decision = brain.analyze({
      market,
      btcPrice: cryptoPrice,
      bankroll,
      timeLeftSec,
      oddsHistory: Array.isArray(oddsData?.data) ? oddsData.data : (Array.isArray(oddsData) ? oddsData : []),
      whaleData: whalesData?.latest ? [whalesData.latest] : (Array.isArray(whalesData) ? whalesData : []),
      globalTrades: Array.isArray(globalData?.trades) ? globalData.trades : (Array.isArray(globalData) ? globalData : []),
      patterns: patternsData,
    });

    res.json(decision);
  } catch (e) {
    console.error("[brain] analyze error:", e.message, e.stack?.split('\n').slice(0, 5).join('\n'));
    res.status(500).json({ error: e.message || "Unknown brain error" });
  }
});

// POST /api/brain/record — Record a trade outcome (called after trade completes)
app.post("/api/brain/record", requireAuth, (req, res) => {
  if (!brain) return res.status(500).json({ error: "Brain not loaded" });

  const { side, amount, price, won, pnl, confidence, strategies, regime,
          asset, timeLeftAtEntry, spreadAtEntry, cryptoPrice, priceToBeat, exitType, signalStrength } = req.body;
  if (typeof won !== "boolean" || typeof pnl !== "number") {
    return res.status(400).json({ error: "Required: won (bool), pnl (number)" });
  }

  const result = brain.recordTrade({
    action: "BUY",
    side: side || "YES",
    amount: amount || 1,
    price: price || 0.5,
    won,
    pnl,
    confidence: confidence || 0.5,
    strategies: strategies || [],
    regime: regime || "unknown",
    asset: asset || "BTC",
    timeLeftAtEntry: timeLeftAtEntry || null,
    spreadAtEntry: spreadAtEntry || null,
    cryptoPrice: cryptoPrice || null,
    priceToBeat: priceToBeat || null,
    exitType: exitType || "resolution",
    signalStrength: signalStrength || null,
  });

  res.json({ success: true, ...result });
});

// GET /api/brain/edge — Statistical edge analysis across all trades
app.get("/api/brain/edge", (req, res) => {
  if (!brain) return res.status(500).json({ error: "Brain not loaded" });
  try {
    const analysis = brain.analyzeEdge();
    res.json(analysis);
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

// ===== DATA COLLECTOR =====
const TRADES_DIR = path.join(__dirname, "trades");

function todayFile(prefix) {
  const d = new Date().toISOString().slice(0, 10);
  return path.join(TRADES_DIR, `${prefix}-${d}.json`);
}

function appendToFile(filepath, entry) {
  try {
    let arr = [];
    if (fs.existsSync(filepath)) {
      try { arr = JSON.parse(fs.readFileSync(filepath, "utf8")); } catch (e) { arr = []; }
    }
    arr.push(entry);
    fs.writeFileSync(filepath, JSON.stringify(arr, null, 0));
  } catch (e) {
    console.warn("[collector] write error:", e.message);
  }
}

function readJsonFile(filepath) {
  try {
    if (fs.existsSync(filepath)) return JSON.parse(fs.readFileSync(filepath, "utf8"));
  } catch (e) {}
  return [];
}

const collectorState = { running: false, stats: { odds: 0, globalTrades: 0, whales: 0, lastMarket: null } };

async function collectOddsSnapshot() {
  try {
    const market = await findActive5mMarket().catch(() => null);
    if (!market) return;
    collectorState.stats.lastMarket = market.slug;

    const mid = await axios.get(CLOB_API + "/midpoint", { params: { token_id: market.upTokenId }, timeout: 3000 }).catch(() => null);

    appendToFile(todayFile("odds"), {
      t: Date.now(),
      market: market.slug,
      question: market.question,
      upPrice: market.upPrice,
      downPrice: market.downPrice,
      midpoint: mid?.data?.mid ? parseFloat(mid.data.mid) : null,
      volume: market.volume,
      endDate: market.endDate,
    });
    collectorState.stats.odds++;
  } catch (e) {
    console.warn("[collector] odds error:", e.message);
  }
}

async function collectGlobalTrades() {
  try {
    const market = await findActive5mMarket().catch(() => null);
    if (!market?.conditionId) return;

    const DATA_API = "https://data-api.polymarket.com";
    const res = await axios.get(`${DATA_API}/trades`, {
      params: { market: market.conditionId, limit: 20 },
      timeout: 5000,
    }).catch(() => null);

    if (res?.data?.length > 0) {
      const trades = res.data.map(t => ({
        t: Date.now(),
        market: market.slug,
        maker: t.maker?.slice(0, 8),
        side: t.side,
        size: t.size,
        price: t.price,
        outcome: t.outcome,
        timestamp: t.timestamp,
      }));
      const file = todayFile("global");
      let existing = readJsonFile(file);
      const seen = new Set(existing.map(t => t.timestamp + '-' + t.size + '-' + t.side));
      const newTrades = trades.filter(t => !seen.has(t.timestamp + '-' + t.size + '-' + t.side));
      if (newTrades.length > 0) {
        existing = existing.concat(newTrades);
        fs.writeFileSync(file, JSON.stringify(existing, null, 0));
        collectorState.stats.globalTrades += newTrades.length;
      }
    }
  } catch (e) {
    console.warn("[collector] global trades error:", e.message);
  }
}

async function collectWhalePositions() {
  try {
    const market = await findActive5mMarket().catch(() => null);
    if (!market?.conditionId) return;

    const DATA_API = "https://data-api.polymarket.com";
    const res = await axios.get(`${DATA_API}/holders`, {
      params: { market: market.conditionId, limit: 10 },
      timeout: 5000,
    }).catch(() => null);

    if (res?.data?.length > 0) {
      const holders = res.data.flatMap(token =>
        (token.holders || []).map(h => ({
          addr: h.proxyWallet?.slice(0, 10),
          name: h.pseudonym || h.name || null,
          amount: h.amount,
          outcome: token.token === market.upTokenId ? "UP" : "DOWN",
        }))
      );
      if (holders.length > 0) {
        appendToFile(todayFile("whales"), {
          t: Date.now(),
          market: market.slug,
          holders: holders.slice(0, 10),
        });
        collectorState.stats.whales++;
      }
    }
  } catch (e) {
    console.warn("[collector] whales error:", e.message);
  }
}

let patternsCache = null;

function rebuildPatterns() {
  try {
    const files = fs.readdirSync(TRADES_DIR).filter(f => f.startsWith("odds-") && f.endsWith(".json"));
    let allOdds = [];
    files.forEach(f => {
      const data = readJsonFile(path.join(TRADES_DIR, f));
      if (Array.isArray(data)) allOdds = allOdds.concat(data);
    });

    const buckets = { "40-45": { w: 0, l: 0 }, "45-50": { w: 0, l: 0 }, "50-55": { w: 0, l: 0 }, "55-60": { w: 0, l: 0 }, "60+": { w: 0, l: 0 } };
    const marketSnapshots = {};
    allOdds.forEach(s => {
      if (!marketSnapshots[s.market]) marketSnapshots[s.market] = [];
      marketSnapshots[s.market].push(s);
    });

    patternsCache = {
      totalSnapshots: allOdds.length,
      totalMarkets: Object.keys(marketSnapshots).length,
      uniqueDays: files.length,
      oddsBuckets: buckets,
      lastUpdated: Date.now(),
    };

    const pFile = path.join(TRADES_DIR, "patterns.json");
    fs.writeFileSync(pFile, JSON.stringify(patternsCache, null, 2));
  } catch (e) {
    console.warn("[collector] patterns rebuild error:", e.message);
  }
}

function startDataCollector() {
  collectorState.running = true;
  console.log("  Collector: STARTED");
  if (!fs.existsSync(TRADES_DIR)) fs.mkdirSync(TRADES_DIR, { recursive: true });

  collectOddsSnapshot();
  setTimeout(() => collectGlobalTrades(), 5000);
  setTimeout(() => collectWhalePositions(), 10000);
  setTimeout(() => rebuildPatterns(), 15000);

  setInterval(collectOddsSnapshot, 30000);
  setInterval(collectGlobalTrades, 30000);
  setInterval(collectWhalePositions, 60000);
  setInterval(rebuildPatterns, 300000);
}

// ===== LEARN API =====

app.get("/api/learn/status", (req, res) => {
  res.json({
    running: collectorState.running,
    stats: collectorState.stats,
    timestamp: Date.now(),
  });
});

app.get("/api/learn/odds-history", (req, res) => {
  const market = req.query.market || null;
  const minutes = parseInt(req.query.minutes) || 60;
  const cutoff = Date.now() - minutes * 60000;

  const files = fs.readdirSync(TRADES_DIR).filter(f => f.startsWith("odds-") && f.endsWith(".json")).sort().reverse().slice(0, 3);
  let all = [];
  files.forEach(f => {
    const data = readJsonFile(path.join(TRADES_DIR, f));
    if (Array.isArray(data)) all = all.concat(data);
  });

  let filtered = all.filter(s => s.t >= cutoff);
  if (market && market !== "current") filtered = filtered.filter(s => s.market === market);
  filtered.sort((a, b) => a.t - b.t);

  res.json({ count: filtered.length, data: filtered.slice(-500) });
});

app.get("/api/learn/whales", async (req, res) => {
  const file = todayFile("whales");
  const data = readJsonFile(file);
  const latest = data.length > 0 ? data[data.length - 1] : null;
  res.json({
    latest,
    totalScans: data.length,
    timestamp: Date.now(),
  });
});

app.get("/api/learn/global-trades", (req, res) => {
  const file = todayFile("global");
  const data = readJsonFile(file);
  const last50 = data.slice(-50);

  let buyCount = 0, sellCount = 0, totalSize = 0;
  data.forEach(t => {
    if (t.side === "BUY") buyCount++; else sellCount++;
    totalSize += parseFloat(t.size) || 0;
  });

  res.json({
    trades: last50,
    stats: { total: data.length, buys: buyCount, sells: sellCount, avgSize: data.length > 0 ? (totalSize / data.length).toFixed(2) : 0 },
    timestamp: Date.now(),
  });
});

app.get("/api/learn/patterns", (req, res) => {
  if (patternsCache) return res.json(patternsCache);
  const pFile = path.join(TRADES_DIR, "patterns.json");
  const data = readJsonFile(pFile);
  res.json(data.length === undefined ? data : { totalSnapshots: 0, totalMarkets: 0, lastUpdated: null });
});

app.get("/api/learn/trades", (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const file = path.join(TRADES_DIR, `my-trades-${date}.json`);
  const data = readJsonFile(file);
  res.json({ count: data.length, trades: data });
});

// ===== PAGES =====
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/trade", (req, res) => res.sendFile(path.join(__dirname, "public", "trade.html")));
app.get("/hub", (req, res) => res.sendFile(path.join(__dirname, "public", "hub.html")));
app.get("/learn", (req, res) => res.sendFile(path.join(__dirname, "public", "learn.html")));
app.get("/markets", (req, res) => res.sendFile(path.join(__dirname, "public", "markets.html")));

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
    console.log("  Redeem:  MANUAL (sell 30s before close, owner redeems via polymarket.com)");
    if (brain) {
      const status = brain.getStatus();
      console.log("  Brain:   " + status.identity.stage + " (" + status.memory.totalTrades + " trades, WR " + status.memory.winRate + ", P/L " + status.memory.totalPnl + ")");
    } else {
      console.log("  Brain:   NOT LOADED");
    }
    console.log("");

    // Start data collector in live mode
    startDataCollector();
  });
}

// Export for Vercel serverless
module.exports = app;
