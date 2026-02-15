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
const POLYMARKET_API = "https://clob.polymarket.com";
const POLYMARKET_MARKETS = "https://clob.polymarket.com/markets";

// Mock portfolio for demo
let portfolio = {
  balance: 1000, // USD
  positions: [],
  pnl: 0,
  history: []
};

// ===== ENDPOINTS =====

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "rPoly API", version: "1.0.0" });
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
    // In production: fetch real markets from Polymarket
    // For now: mock data
    const markets = [
      {
        id: "1",
        question: "Will BTC reach $100K by end of 2026?",
        description: "Bitcoin price prediction",
        volume: 1250000,
        liquidity: 890000,
        yesPrice: 0.42,
        noPrice: 0.58,
        endDate: "2026-12-31",
        category: "crypto"
      },
      {
        id: "2",
        question: "Will ETH flip BTC market cap in 2026?",
        description: "Ethereum Flippening",
        volume: 890000,
        liquidity: 650000,
        yesPrice: 0.18,
        noPrice: 0.82,
        endDate: "2026-12-31",
        category: "crypto"
      },
      {
        id: "3",
        question: "Will there be a crypto regulation bill passed in 2026?",
        description: "US Crypto Regulation",
        volume: 560000,
        liquidity: 420000,
        yesPrice: 0.65,
        noPrice: 0.35,
        endDate: "2026-12-31",
        category: "regulation"
      },
      {
        id: "4",
        question: "Will Base TVL exceed $50B in 2026?",
        description: "Base Network TVL",
        volume: 340000,
        liquidity: 280000,
        yesPrice: 0.38,
        noPrice: 0.62,
        endDate: "2026-12-31",
        category: "defi"
      },
      {
        id: "5",
        question: "Will AI agents manage >$10B onchain by 2026?",
        description: "AI Agents TVL",
        volume: 210000,
        liquidity: 180000,
        yesPrice: 0.55,
        noPrice: 0.45,
        endDate: "2026-12-31",
        category: "ai"
      },
      {
        id: "6",
        question: "Will Trump declare BTC reserve in 2026?",
        description: "US Bitcoin Reserve",
        volume: 2100000,
        liquidity: 1500000,
        yesPrice: 0.35,
        noPrice: 0.65,
        endDate: "2026-12-31",
        category: "politics"
      }
    ];
    
    res.json({ markets, timestamp: Date.now() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Scanner - find opportunities
app.get("/api/scan", async (req, res) => {
  try {
    // Find markets with high volume or price moves
    const markets = [
      {
        id: "6",
        question: "Will Trump declare BTC reserve in 2026?",
        volume: 2100000,
        change24h: 15.2,
        signal: "STRONG_BUY",
        reason: "Volume spike + positive sentiment"
      },
      {
        id: "1",
        question: "Will BTC reach $100K by end of 2026?",
        volume: 1250000,
        change24h: 8.5,
        signal: "BUY",
        reason: "Volume up, BTC momentum"
      }
    ];
    
    res.json({ opportunities: markets, timestamp: Date.now() });
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
