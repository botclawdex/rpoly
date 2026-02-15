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

// Mock portfolio for demo
let portfolio = {
  balance: 1000, // USD
  positions: [],
  pnl: 0,
  history: []
};

// ===== POLYMARKET HELPER FUNCTIONS =====

// Fetch markets from Polymarket (includes 5m markets)
async function getMarkets(limit = 50, filter5m = false) {
  try {
    const response = await axios.get(`${GAMMA_API}/markets`, {
      params: {
        active: true,
        closed: false,
        limit: 200 // Get more to filter
      },
      timeout: 8000
    });
    
    let markets = [];
    for (const market of response.data) {
      // Skip closed markets
      if (market.closed) continue;
      if (!market.active) continue;
      
      // Filter 5m markets (BTC up/down every 5 minutes)
      const is5m = market.slug?.includes('updown') && market.slug?.includes('5m');
      if (filter5m && !is5m) continue;
      if (!filter5m && is5m) continue;
      
      // Get prices
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
        volume: market.volume || market.volume24hr || 0,
        liquidity: market.liquidity || 0,
        yesPrice: yesPrice,
        noPrice: noPrice,
        tokenYes: market.clobTokenIds?.[0],
        tokenNo: market.clobTokenIds?.[1],
        endDate: market.endDate || market.end_date_utc,
        is5m: is5m,
        resolved: false,
        acceptingOrders: market.acceptingOrders || true,
        category: market.category || "Unknown"
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
  res.json({ status: "ok", service: "rPoly API", version: "1.1.0", network: "polymarket" });
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
    const filter5m = req.query['5m'] === 'true';
    const markets = await getActiveMarkets(limit, filter5m);
    
    res.json({ markets, timestamp: Date.now() });
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
