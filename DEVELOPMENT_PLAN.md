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

## v1.2.0 - 5m Markets Focus (IN PROGRESS)
- [x] Use /markets API instead of /events (5m markets there) ✅
- [ ] Data API → real portfolio (/positions)
- [ ] WebSocket → real-time prices

### Tasks:
- [x] Switch to Gamma /markets endpoint ✅
- [x] Filter for 5m markets ✅
- [ ] Add Data API for positions
- [ ] Add WebSocket for real-time

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
