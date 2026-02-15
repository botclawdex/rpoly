// rPoly - AI Polymarket Trading Bot
// v1.4.0 - CLOB Trade Endpoint
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("."));

const PORT = process.env.PORT || 3001;

// ===== POLYMARKET API =====
const GAMMA_API = "https://gamma-api.polymarket.com";
const CLOB_API = "https://clob.polymarket.com";

// ===== BINANCE API =====
const BINANCE_API = "https://api.binance.com";

// ===== WALLET CONFIG =====
const WALLET_ADDR = "0xDEB4f464d46B1A3CDB4A29c41C6E908378993914";
const USDC_ADDR = "0x833589fCD6eDb6E08f4c7C32D4f71B54bdA02913"; // Base USDC
const POLYGON_USDC_ADDR = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"; // Polygon USDC

// ===== ETHERSCAN V2 API (works on all networks) =====
const ETHERSCAN_V2_API = {
  base: "https://api.basescan.org/api/v2",
  polygon: "https://api.polygonscan.com/api/v2",
  ethereum: "https://api.etherscan.io/api/v2"
};
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "HSHV72NNW6KVQA88YB5BFSZHTVPFWC2GJU";

// Mock portfolio for demo
let portfolio = {
  balance: 1000, // USD
  positions: [],
  pnl: 0,
  history: []
};

// ===== POLYMARKET HELPER FUNCTIONS =====

// Get current 5-minute window timestamp
// Returns the NEXT window (the one that just opened), not the current one which may be closing
function getCurrent5mWindowTs() {
  const nowMs = Date.now();
  const nowSeconds = Math.floor(nowMs / 1000);
  // Round down to get current window start in seconds (300 = 5 min * 60 sec)
  const currentWindowSec = Math.floor(nowSeconds / 300) * 300;
  // Return next window (5 min ahead)
  return currentWindowSec + 300;
}

// Fetch markets from Polymarket (includes 5m markets)
async function getMarkets(limit = 50, filter5m = false) {
  try {
    // For 5m markets, we need to calculate the current window timestamp
    // and query by slug directly
    if (filter5m) {
      const windowTs = getCurrent5mWindowTs();
      const slug = `btc-updown-5m-${windowTs}`;
      console.log("Fetching 5m market with slug:", slug, "windowTs:", windowTs);
      
      try {
        const response = await axios.get(`${GAMMA_API}/markets`, {
          params: { slug: slug },
          timeout: 8000
        });
        
        console.log("5m API response length:", response.data?.length);
        
        if (response.data && response.data.length > 0) {
          const market = response.data[0];
          
          // Parse prices
          let yesPrice = null;
          let noPrice = null;
          
          try {
            const parsed = JSON.parse(market.outcomePrices || "[]");
            yesPrice = parsed[0] ? parseFloat(parsed[0]) : null;
            noPrice = parsed[1] ? parseFloat(parsed[1]) : null;
          } catch {}
          
          return [{
            id: market.id,
            question: market.question,
            slug: market.slug,
            volume: market.volumeNum || market.volume || market.volume24hr || 0,
            liquidity: market.liquidityNum || market.liquidity || 0,
            yesPrice: yesPrice,
            noPrice: noPrice,
            tokenYes: market.clobTokenIds?.[0],
            tokenNo: market.clobTokenIds?.[1],
            endDate: market.endDate || market.end_date_utc,
            is5m: true,
            resolved: false,
            acceptingOrders: market.acceptingOrders || true,
            category: "Crypto 5m"
          }];
        }
      } catch (e) {
        console.log("5m market not found for slug:", slug, e.message);
      }
      
      // Also try to get recent 5m windows (last few)
      const markets = [];
      for (let i = 0; i <= 3; i++) {
        const pastWindowTs = getCurrent5mWindowTs() - (i * 300);
        const pastSlug = `btc-updown-5m-${pastWindowTs}`;
        
        try {
          const response = await axios.get(`${GAMMA_API}/markets`, {
            params: { slug: pastSlug },
            timeout: 5000
          });
          
          if (response.data && response.data.length > 0) {
            const market = response.data[0];
            
            let yesPrice = null;
            let noPrice = null;
            
            try {
              const parsed = JSON.parse(market.outcomePrices || "[]");
              yesPrice = parsed[0] ? parseFloat(parsed[0]) : null;
              noPrice = parsed[1] ? parseFloat(parsed[1]) : null;
            } catch {}
            
            markets.push({
              id: market.id,
              question: market.question,
              slug: market.slug,
              volume: market.volumeNum || market.volume || market.volume24hr || 0,
              liquidity: market.liquidityNum || market.liquidity || 0,
              yesPrice: yesPrice,
              noPrice: noPrice,
              tokenYes: market.clobTokenIds?.[0],
              tokenNo: market.clobTokenIds?.[1],
              endDate: market.endDate || market.end_date_utc,
              is5m: true,
              resolved: market.resolved || false,
              acceptingOrders: market.acceptingOrders || false,
              category: "Crypto 5m"
            });
          }
        } catch {}
      }
      
      return markets;
    }
    
    // Regular markets (non-5m)
    const response = await axios.get(`${GAMMA_API}/markets`, {
      params: {
        active: true,
        closed: false,
        limit: 200
      },
      timeout: 8000
    });
    
    let markets = [];
    
    // Get all markets from response, filter out 5m
    for (const market of response.data) {
      // Skip closed or inactive
      if (market.closed) continue;
      if (!market.active) continue;
      
      // Skip 5m markets for regular list
      const is5m = market.slug?.includes('updown') && 
                   (market.slug?.includes('5m') || market.slug?.match(/updown-\d+/));
      
      if (is5m) continue;
      
      // Parse prices
      let yesPrice = null;
      let noPrice = null;
      
      try {
        const parsed = JSON.parse(market.outcomePrices || "[]");
        yesPrice = parsed[0] ? parseFloat(parsed[0]) : null;
        noPrice = parsed[1] ? parseFloat(parsed[1]) : null;
      } catch {}
      
      // Get category from events if available
      let category = market.category || "Unknown";
      if (market.events && market.events.length > 0) {
        category = market.events[0].category || market.category || "Crypto";
      }
      
      markets.push({
        id: market.id,
        question: market.question,
        slug: market.slug,
        volume: market.volumeNum || market.volume || market.volume24hr || 0,
        liquidity: market.liquidityNum || market.liquidity || 0,
        yesPrice: yesPrice,
        noPrice: noPrice,
        tokenYes: market.clobTokenIds?.[0],
        tokenNo: market.clobTokenIds?.[1],
        endDate: market.endDate || market.end_date_utc,
        is5m: false,
        resolved: false,
        acceptingOrders: market.acceptingOrders || true,
        category: category
      });
      
      if (markets.length >= limit * 2) break;
    }
    
    // Sort by volume
    markets.sort((a, b) => b.volume - a.volume);
    return markets.slice(0, limit);
  } catch (error) {
    console.error("Error fetching markets:", error.message);
    return [];
  }
}

// Fetch active markets from Polymarket (legacy - uses /events)
async function getActiveMarkets(limit = 20, filter5m = false) {
  return getMarkets(limit, filter5m);
}

// ===== COINGECKO API (for crypto prices) =====
const COINGECKO_API = "https://api.coingecko.com/api/v3";

// Get crypto prices from CoinGecko
async function getCryptoPrices() {
  try {
    const res = await axios.get(`${COINGECKO_API}/simple/price?ids=bitcoin,ethereum&vs_currencies=usd`);
    return {
      btc: res.data.bitcoin?.usd || null,
      eth: res.data.ethereum?.usd || null,
      timestamp: Date.now()
    };
  } catch (e) {
    console.error("Price error:", e.message);
    return null;
  }
}

// Get native token balance (ETH/POL/MATIC) from Etherscan V2 API
async function getNativeBalance(chain) {
  try {
    const url = `${ETHERSCAN_V2_API[chain]}/?module=account&action=balance&address=${WALLET_ADDR}&tag=latest&apikey=${ETHERSCAN_API_KEY}`;
    const res = await axios.get(url, { timeout: 10000 });
    
    if (res.data.status === "1") {
      const wei = parseInt(res.data.result);
      return wei / 1e18;
    }
    return 0;
  } catch (e) {
    console.error(`${chain} balance error:`, e.message);
    return 0;
  }
}

// Get ERC-20 token balance from Etherscan V2 API
async function getTokenBalance(chain, tokenAddr) {
  try {
    const url = `${ETHERSCAN_V2_API[chain]}/?module=account&action=tokenbalance&address=${WALLET_ADDR}&contractaddress=${tokenAddr}&tag=latest&apikey=${ETHERSCAN_API_KEY}`;
    const res = await axios.get(url, { timeout: 10000 });
    
    if (res.data.status === "1") {
      // USDC has 6 decimals
      const decimals = tokenAddr.toLowerCase() === USDC_ADDR.toLowerCase() || 
                       tokenAddr.toLowerCase() === POLYGON_USDC_ADDR.toLowerCase() ? 6 : 18;
      const wei = parseInt(res.data.result);
      return wei / Math.pow(10, decimals);
    }
    return 0;
  } catch (e) {
    console.error(`${chain} token balance error:`, e.message);
    return 0;
  }
}

// Get multi-chain portfolio using Etherscan V2 API
async function getMultiChainPortfolio() {
  try {
    // Base network
    const baseEth = await getNativeBalance("base");
    const baseUsdc = await getTokenBalance("base", USDC_ADDR);
    
    // Polygon network (Polymarket)
    const polygonMatic = await getNativeBalance("polygon");
    const polygonUsdc = await getTokenBalance("polygon", POLYGON_USDC_ADDR);
    
    // Get ETH price for USD conversion
    const prices = await getCryptoPrices();
    const ethUsd = prices?.eth || 0;
    
    // Calculate totals
    const baseTotal = (baseEth * ethUsd) + baseUsdc;
    const polygonTotal = polygonUsdc; // MATIC value is small, roughly $0.50-1.00
    
    return {
      base: {
        eth: baseEth,
        usdc: baseUsdc,
        totalUsd: baseTotal
      },
      polygon: {
        matic: polygonMatic,
        usdc: polygonUsdc,
        totalUsd: polygonTotal
      },
      totalUsd: baseTotal + polygonTotal,
      address: WALLET_ADDR,
      timestamp: Date.now()
    };
  } catch (e) {
    console.error("Multi-chain portfolio error:", e.message);
    return null;
  }
}

// Legacy: Get on-chain balance using Base RPC (kept for compatibility)
async function getOnChainBalance(address) {
  // Use Etherscan V2 instead
  const portfolio = await getMultiChainPortfolio();
  if (portfolio) {
    return {
      eth: portfolio.base.eth,
      usdc: portfolio.base.usdc,
      address: address,
      timestamp: Date.now()
    };
  }
  return null;
}

// Get market details
async function getMarketDetails(marketIdOrSlug) {
  try {
    const response = await axios.get(`${GAMMA_API}/markets`, {
      params: { id: marketIdOrSlug }
    });
    
    if (response.data && response.data.length > 0) {
      return response.data[0];
    }
    return null;
  } catch (error) {
    console.error("Error fetching market:", error.message);
    return null;
  }
}

// Get orderbook for a market
async function getOrderbook(tokenId) {
  try {
    const response = await axios.get(`${CLOB_API}/book`, {
      params: { token_id: tokenId }
    });
    return response.data;
  } catch (error) {
    console.error("Error fetching orderbook:", error.message);
    return null;
  }
}

// ===== ENDPOINTS =====

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "rPoly API", version: "1.3.0", network: "polymarket" });
});

// Dashboard - portfolio overview
app.get("/api/dashboard", (req, res) => {
  res.json({
    portfolio: portfolio.balance,
    positions: portfolio.positions,
    pnl: portfolio.pnl,
    pnlPercent: ((portfolio.pnl / portfolio.balance) * 100).toFixed(2),
    timestamp: Date.now()
  });
});

// Get markets list
app.get("/api/markets", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const filter = req.query.filter || '5m'; // '5m' or 'all'
    const filter5m = filter === '5m';
    
    const markets = await getActiveMarkets(limit, filter5m);
    
    res.json({ markets, filter: filter, timestamp: Date.now() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get 5m markets only (short-term BTC up/down)
app.get("/api/markets/5m", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const markets = await getMarkets(limit, true);
    
    res.json({ markets, type: "5m", timestamp: Date.now() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get long-term markets (non-5m)
app.get("/api/markets/long", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const category = req.query.category;
    const markets = await getMarkets(limit, false);
    
    // Filter by category if provided
    let filtered = markets;
    if (category) {
      filtered = markets.filter(m => m.category?.toLowerCase() === category.toLowerCase());
    }
    
    res.json({ markets: filtered, type: "long", category: category || "all", timestamp: Date.now() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== NOWE ENDPOINTY =====

// Analyze 5m BTC market
app.get("/api/analyze", async (req, res) => {
  try {
    const prices = await getCryptoPrices();
    const btc = prices?.btc ? { price: prices.btc } : null;
    const windowTs = getCurrent5mWindowTs();
    
    // Get current 5m market
    const slug = `btc-updown-5m-${windowTs}`;
    const marketRes = await axios.get(`${GAMMA_API}/markets`, { params: { slug } });
    
    let market = null;
    if (marketRes.data?.[0]) {
      const m = marketRes.data[0];
      const prices = JSON.parse(m.outcomePrices || "[]");
      market = {
        question: m.question,
        slug: m.slug,
        upPrice: parseFloat(prices[0]) || 0,
        downPrice: parseFloat(prices[1]) || 0,
        volume: m.volumeNum || 0,
        liquidity: m.liquidityNum || 0,
        endDate: m.endDate
      };
    }
    
    // Calculate signal based on Polymarket prices
    // If UP price > 55%, market thinks UP so signal DOWN (fade)
    // If DOWN price > 55%, market thinks DOWN so signal UP (fade)
    const signal = market?.upPrice > 0.55 ? "DOWN" :
                   market?.downPrice > 0.55 ? "UP" : "NEUTRAL";
    
    res.json({
      btc,
      market,
      signal,
      windowTs,
      timestamp: Date.now()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Real on-chain portfolio (multi-chain via Etherscan V2)
app.get("/api/portfolio/real", async (req, res) => {
  try {
    const portfolio = await getMultiChainPortfolio();
    
    if (!portfolio) {
      return res.status(500).json({ error: "Failed to fetch portfolio" });
    }
    
    res.json(portfolio);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get BTC chart data
app.get("/api/chart", async (req, res) => {
  try {
    const response = await axios.get(`${COINGECKO_API}/coins/bitcoin/ohlc?vs_currency=usd&days=1`);
    // Format: [timestamp, open, high, low, close]
    const candles = response.data.map(c => ({
      t: c[0],
      o: c[1],
      h: c[2],
      l: c[3],
      c: c[4]
    }));
    res.json({ candles, timestamp: Date.now() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Execute trade (simulated for now - full CLOB signing requires wallet)
app.post("/api/trade", async (req, res) => {
  try {
    const { marketSlug, side, amount } = req.body;
    
    // Validate
    if (!marketSlug || !side || !amount) {
      return res.status(400).json({ error: "Missing required fields: marketSlug, side, amount" });
    }
    
    if (amount > 0.1) {
      return res.status(400).json({ error: "Max trade amount is 0.1 USDC" });
    }
    
    // For now, return simulated trade
    // Full implementation requires:
    // 1. Create order with EIP712 signature
    // 2. Sign with wallet private key  
    // 3. POST to CLOB /orders endpoint
    
    const trade = {
      id: "trade_" + Date.now(),
      marketSlug,
      side: side.toUpperCase(),
      amount: parseFloat(amount),
      status: "SIMULATED",
      message: "CLOB signing not implemented yet - trade is simulated",
      timestamp: Date.now()
    };
    
    res.json({ 
      success: true, 
      trade,
      note: "This is a simulated trade. Full CLOB integration requires EIP712 order signing."
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single market details
app.get("/api/market/:id", async (req, res) => {
  try {
    const market = await getMarketDetails(req.params.id);
    if (!market) {
      return res.status(404).json({ error: "Market not found" });
    }
    res.json({ market, timestamp: Date.now() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get orderbook
app.get("/api/orderbook/:tokenId", async (req, res) => {
  try {
    const orderbook = await getOrderbook(req.params.tokenId);
    if (!orderbook) {
      return res.status(404).json({ error: "Orderbook not found" });
    }
    res.json({ orderbook, timestamp: Date.now() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Scanner - find opportunities (5m markets focus)
app.get("/api/scan", async (req, res) => {
  try {
    const mode = req.query.mode || '5m'; // '5m' or 'long'
    const is5m = mode === '5m';
    
    const markets = await getMarkets(50, is5m);
    
    // Find opportunities based on volume and price
    const opportunities = markets
      .filter(m => m.volume > 10000) // Lower threshold for 5m markets
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 5)
      .map(m => {
        // For 5m markets: up/down logic
        // For regular: yes/no logic
        const is5mMarket = m.is5m;
        const price = is5mMarket ? m.yesPrice : m.yesPrice;
        
        const signal = price > 0.6 ? "STRONG_BUY" : 
                      price > 0.4 ? "BUY" : 
                      price < 0.3 ? "SELL" : "HOLD";
        
        return {
          id: m.id,
          question: m.question,
          volume: m.volume,
          price: price,
          signal,
          reason: is5mMarket 
            ? (price > 0.5 ? "Bullish momentum" : "Bearish momentum")
            : (price > 0.5 ? "High probability" : "Low probability"),
          category: m.category,
          is5m: is5mMarket,
          tokenYes: m.tokenYes,
          tokenNo: m.tokenNo
        };
      });
    
    res.json({ opportunities, mode, timestamp: Date.now() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Trade execution
app.post("/api/trade", async (req, res) => {
  try {
    const { marketId, side, amount } = req.body;
    
    if (!marketId || !side || !amount) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    
    // In production: call Polymarket API
    // For now: mock trade
    const trade = {
      id: Math.random().toString(36).substr(2, 9),
      marketId,
      side,
      amount,
      price: side === "yes" ? 0.42 : 0.58,
      timestamp: Date.now(),
      status: "filled"
    };
    
    // Update portfolio
    const cost = amount * trade.price;
    if (cost > portfolio.balance) {
      return res.status(400).json({ error: "Insufficient balance" });
    }
    
    portfolio.balance -= cost;
    portfolio.positions.push({
      ...trade,
      currentValue: cost,
      pnl: 0
    });
    
    portfolio.history.push(trade);
    
    res.json({ trade, portfolio: portfolio.balance });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Signals - AI sentiment analysis
app.get("/api/signals", async (req, res) => {
  try {
    // In production: analyze Twitter/X sentiment
    const signals = [
      {
        market: "BTC $100K by 2026",
        sentiment: 0.72,
        trend: "bullish",
        twitterVolume: 1250,
        newsSentiment: "positive",
        recommendation: "BUY yes"
      },
      {
        market: "Trump BTC reserve",
        sentiment: 0.65,
        trend: "bullish",
        twitterVolume: 3420,
        newsSentiment: "positive",
        recommendation: "BUY yes"
      },
      {
        market: "ETH flip BTC",
        sentiment: 0.35,
        trend: "bearish",
        twitterVolume: 890,
        newsSentiment: "neutral",
        recommendation: "SELL/BUY no"
      }
    ];
    
    res.json({ signals, timestamp: Date.now() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Portfolio history
app.get("/api/history", (req, res) => {
  res.json({ history: portfolio.history, timestamp: Date.now() });
});

// Settings
app.get("/api/settings", (req, res) => {
  res.json({
    maxTradeSize: 100,
    stopLoss: 15,
    takeProfit: 50,
    autoTrade: false,
    notifications: true
  });
});

// Get available categories/tags
app.get("/api/tags", async (req, res) => {
  try {
    const response = await axios.get(`${GAMMA_API}/tags`, {
      params: { limit: 50 }
    });
    res.json({ tags: response.data, timestamp: Date.now() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/settings", (req, res) => {
  const { maxTradeSize, stopLoss, takeProfit, autoTrade, notifications } = req.body;
  // In production: save to DB
  res.json({ success: true, settings: req.body });
});

// Serve frontend
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

app.listen(PORT, () => {
  console.log(`🦞 rPoly API running on port ${PORT}`);
});
