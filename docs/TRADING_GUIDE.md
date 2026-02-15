# rPoly - Autonomiczny Trading Bot

## Status: IN PROGRESS
**Ostatnia aktualizacja:** 2026-02-15

---

## 📝 DRAFT: v1.4.0 - AUTONOMICZNY TRADING

### 🔍 CZĘŚĆ 1: CO TO JEST?

**Polymarket** to platforma gdzie ludzie stawiają na wyniki wydarzeń. Istnieją rynki "Bitcoin Up or Down" gdzie:
- Kupujesz "UP" = stawiasz że BTC pójdzie w górę
- Kupujesz "DOWN" = stawiasz że BTC pójdzie w dół
- Każdy "share" kosztuje od $0.01 do $0.99
- Jeśli wygrasz, dostajesz $1.00

**5-minute markets** to rynki które trwają tylko 5 minut:
- "Czy BTC będzie wyżej niż teraz za 5 minut?"
- Możesz kupić UP lub DOWN
- Po 5 minutach rynek się zamyka

---

### 💰 CZĘŚĆ 2: NASZE KONTO

```
Adres: 0xDEB4f464d46B1A3CDB4A29c41C6E908378993914
Stan konta:
- ETH: 0.00097 ETH (~$2)
- USDC: 1.02 USDC (~$1)
- RAZEM: ~$3
```

**Max trade: 0.1 USDC** (10 centów)

---

### 🤖 CZĘŚĆ 3: JAK DZIAŁA AUTONOMICZNY BOT?

```
KROK 1: Pobierz dane
├── Gamma API → aktualny 5m rynek BTC
└── CoinGecko → aktualna cena BTC

KROK 2: Analizuj
├── Cena UP: 55% → rynek myśli że BTC pójdzie W GÓRĘ
├── Cena DOWN: 45% → rynek myśli że BTC pójdzie W DÓŁ
└── Nasz signal: ODWROTNIE (fade overbottled)

KROK 3: Decyzja
├── UP > 55% → Kupujemy DOWN
├── DOWN > 55% → Kupujemy UP
└── Wszystko ~50% → NIE TRADUJEMY
```

---

### 📊 CZĘŚĆ 4: STRATEGIA "FADE"

**Dlaczego odwrotnie?**
Kiedy rynek pokazuje UP > 55%, to znaczy że LUDZIE myślą że BTC pójdzie w górę. Ale krótkoterminowe ruchy są często losowe.

---

### ⚙️ CZĘŚĆ 5: TECHNOLOGIA

1. **Gamma API** - pobiera rynki
2. **CLOB API** - składa ordery
3. **Base RPC** - balans konta
4. **Wallet** - private key do podpisów

---

### ✅ CZĘŚĆ 6: CO ROBIĆ

1. [ ] Testuj CLOB API
2. [ ] Dodaj endpoint /api/trade/execute
3. [ ] Dodaj logikę FADE
4. [ ] Testuj z 0.01 USDC
5. [ ] Dodaj cron job

---

## PODSUMOWANIE

| Element | Wartość |
|---------|---------|
| Max trade | 0.1 USDC |
| Strategy | Fade overbought/oversold |
| Frequency | Co 5 minut |
