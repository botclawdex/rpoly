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

// Fetch active markets from Polymarket
async function getActiveMarkets(limit = 20) {
  try {
    const response = await axios.get(`${GAMMA_API}/events`, {
      params: {
        active: true,
        closed: false,
        limit: limit
      }
    });
    
    const markets = [];
    for (const event of response.data) {
      if (event.markets && event.markets.length > 0) {
        for (const market of event.markets) {
          // Get current price from CLOB
          let yesPrice = null;
          let noPrice = null;
          
          if (market.clobTokenIds && market.clobTokenIds.length >= 2) {
            try {
              const yesPriceRes = await axios.get(`${CLOB_API}/price`, {
                params: { token_id: market.clobTokenIds[0], side: 'buy' }
              });
              const noPriceRes = await axios.get(`${CLOB_API}/price`, {
                params: { token_id: market.clobTokenIds[1], side: 'buy' }
              });
              yesPrice = parseFloat(yesPriceRes.data.price);
              noPrice = parseFloat(noPriceRes.data.price);
            } catch (e) {
              // Use prices from gamma if CLOB fails
              try {
                const parsed = JSON.parse(market.outcomePrices || "[]");
                yesPrice = parsed[0] || null;
                noPrice = parsed[1] || null;
              } catch {}
            }
          }
          
          markets.push({
            id: market.id,
            question: market.question,
            description: event.description || "",
            slug: market.slug,
            volume: market.volume || market.volume24hr || 0,
            liquidity: market.liquidity || 0,
            yesPrice: yesPrice,
            noPrice: noPrice,
            tokenYes: market.clobTokenIds?.[0],
            tokenNo: market.clobTokenIds?.[1],
            endDate: market.endDate || market.end_date_utc,
            category: event.tags?.[0]?.label || "Unknown",
            tags: event.tags?.map(t => t.label) || []
          });
        }
      }
    }
    
    return markets;
  } catch (error) {
    console.error("Error fetching markets:", error.message);
    return [];
  }
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
    const markets = await getActiveMarkets(limit);
    
    res.json({ markets, timestamp: Date.now() });
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

// Scanner - find opportunities
app.get("/api/scan", async (req, res) => {
  try {
    const markets = await getActiveMarkets(50);
    
    // Find opportunities based on volume and price
    const opportunities = markets
      .filter(m => m.volume > 100000) // Only markets with significant volume
      .sort((a, b) => b.volume - a.volume) // Sort by volume
      .slice(0, 5)
      .map(m => {
        const signal = m.yesPrice > 0.6 ? "STRONG_BUY" : 
                      m.yesPrice > 0.4 ? "BUY" : 
                      m.yesPrice < 0.3 ? "SELL" : "HOLD";
        
        return {
          id: m.id,
          question: m.question,
          volume: m.volume,
          yesPrice: m.yesPrice,
          noPrice: m.noPrice,
          signal,
          reason: m.yesPrice > 0.5 ? "High probability" : "Low probability",
          category: m.category
        };
      });
    
    res.json({ opportunities, timestamp: Date.now() });
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
