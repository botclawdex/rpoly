# rPoly Development Plan

## Status: IN PROGRESS
**Last Updated:** 2026-02-15

---

## v1.0.0 - MVP (DONE ✅)
- [x] Basic Express server with mock data
- [x] Frontend dashboard with retro hacker UI
- [x] Markets list
- [x] Basic scanner
- [x] Signals (mock)
- [x] Portfolio tracking
- [x] Settings form

---

## v1.1.0 - Real API Integration (IN PROGRESS)
- [x] Connect to Polymarket API (real market data) - DONE
- [ ] Real-time price updates (WebSocket)
- [ ] Connect to Twitter/X API for sentiment

### Tasks:
- [x] Integrate Polymarket Gamma API ✅
- [x] Add CLOB API for prices ✅
- [ ] Add WebSocket for real-time prices
- [ ] Connect Twitter sentiment analysis
- [ ] Add real trading execution

---

## v1.2.0 - Auto-Trading
- [ ] Sentiment-based signals
- [ ] Volume spike detection
- [ ] Auto-trade execution
- [ ] Stop-loss / Take-profit

---

## v1.3.0 - User Features
- [ ] User authentication
- [ ] Portfolio persistence
- [ ] Trade history
- [ ] Notifications

---

## v2.0.0 - Pro
- [ ] x402 payments
- [ ] API for external bots
- [ ] Multi-chain support (Polymarket, other prediction markets)
- [ ] Advanced strategies

---

## Notes
- Theme: Retro Hacker (green phosphor, CRT scanlines)
- Stack: Node.js + Express, Vanilla JS frontend
- Deployment: Vercel
