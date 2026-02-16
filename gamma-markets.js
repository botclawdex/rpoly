// Get current markets from gamma API
const axios = require('axios');

async function test() {
  const r = await axios.get('https://gamma-api.polymarket.com/markets?closed=false&limit=20');
  const markets = r.data;
  
  console.log('Got', markets.length, 'markets');
  
  for (const m of markets) {
    console.log(`\n${m.question?.slice(0,60)}`);
    console.log('Condition:', m.conditionId);
    console.log('End:', m.endDateIso);
    if (m.tokens) {
      console.log('Tokens:', m.tokens.map(t => `${t.outcome}:${t.price}`).join(', '));
    }
  }
}

test();
