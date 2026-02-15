# rPoly Trading Brain

## Analiza rynku - 2026-02-15

### Twitter Sentiment (BTC)
```
- @hilarycuff: "69k hit, 4 wins in a row" - bullish
- @dbetrading: "HIGH RISK SETUP" - hedging longs, bearish
- @zenji_trades: "be very careful... go with direction of trend" - cautious
- @Mudassirbaig42: buyers defending support - bullish
- @PolymarketSuccubus: 5-min BTC markets NEW META - bullish on 5m
- @akk_pkl: shorts more over-leveraged, upside pressure possible - bullish squeeze
- @SjXBT_: "sellers dominating the action" - bearish
- @thomas_fahrer: "bull market has begun" - very bullish
```

### Web Search Sentiment
```
- CoinCodex: BEARISH (26 bearish vs 4 bullish indicators)
- TradingView: EXTREME FEAR (often = buying opportunity)
- CoinDCX: Could reach $100-105K by Feb 2026
- BeInCrypto: Cautious sentiment, gradual upside
```

### Kluczowe obserwacje
1. **Twitter jest podzielony** - część bullish, część bearish
2. **Web sentiment: BEARISH** - wskaźniki techniczne na "sprzedaj"
3. **TradingView: EXTREME FEAR** - to często odwrócenie trendu
4. **Polymarket 5m: NOWY META** - nikt jeszcze nie wie jak handlować

---

## Strategy: ANTI-TULUM (Anti-Crowd)

### Zasada przewodnia
> "Nie idź za głosem tłumu. Tłum na Twitterze = zazwyczaj przegrywa. 
>  Myśl swoim własnym mózgiem."

### Analiza moich wygranych tradeów (historii)
```
Brak historii - bot jest nowy.
Strategia: Zacznij od małych kwot, ucz się na błędach.
```

### Logika tradingu

```
SYGNAŁ KUPUJ UP:
├── BTC 1h trend: W GÓRĘ (EMA 50 > EMA 200)
├── Twitter sentiment: < 40% bullish (tłum sprzedaje)
├── Polymarket UP: < 45% (tłum kupuje DOWN)
└── Akcja: Kup UP

SYGNAŁ KUPUJ DOWN:
├── BTC 1h trend: W DÓŁ (EMA 50 < EMA 200)  
├── Twitter sentiment: > 60% bullish (tłum kupuje)
├── Polymarket DOWN: < 45% (tłum kupuje UP)
└── Akcja: Kup DOWN

BRAK TRADE:
├── Wszystko ~50/50
├── Zbyt wysokie ryzyko
└── Akcja: CZEKAJ
```

### Bezpieczeństwo

```
MAX TRADE: 0.1 USDC (3% kapitału)
STOP LOSS: Nie ma (5m market sam się zamyka)
CZEKAJ po stracie: 2 okna (10 min)
CZEKAJ po wygranej: 1 okno (5 min)
```

### Co NIE robić
```
✗ Nie kupuj gdy UP > 55% (tłum już kupuje UP)
✗ Nie kupuj gdy Twitter 80% bullish
✗ Nie gonić trendu w ostatniej minucie
✗ Nie tradeuj po 3 stratach z rzędu
```

### Co ROBIC
```
✓ Kupuj gdy INNI się boją (Extreme Fear = OK)
✓ Kupuj gdy Polymarket jest blisko 50/50
✓ Obserwuj własne wyniki - ucz się
✓ Zapisuj KAŻDY trade do analizy
```

---

## Konfiguracja

```javascript
{
  maxTrade: 0.1,        // USDC
  minConfidence: 0.45,    // minimum odds do trade
  waitAfterLoss: 2,      // okna po stracie
  waitAfterWin: 1,       // okna po wygranej
  trendThreshold: 0.50   // minimalny trend do uwzględnienia
}
```

---

## Learning (do uzupełnienia)

```json
{
  "totalTrades": 0,
  "wins": 0,
  "losses": 0,
  "winRate": 0,
  "avgWin": 0,
  "avgLoss": 0,
  "bestStrategy": null,
  "worstStrategy": null
}
```
