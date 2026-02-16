// Get CURRENT markets
const { ClobClient } = require('@polymarket/clob-client');

const HOST = 'https://clob.polymarket.com';
const client = new ClobClient(HOST, 137);

async function test() {
  // Get markets that are still active and end in the future
  const now = new Date().toISOString();
  const markets = await client.getMarkets({ 
    closed: false, 
    active: true, 
    limit: 50
  });
  
  // Filter for future markets
  const future = markets.data.filter(m => {
    return m.end_date_iso && new Date(m.end_date_iso) > new Date();
  });
  
  console.log('Total markets:', markets.count);
  console.log('Future markets:', future.length);
  
  // Print first few
  future.slice(0, 10).forEach(m => {
    console.log(`- ${m.question?.slice(0,60)}... (ends: ${m.end_date_iso?.slice(0,10)})`);
  });
}

test().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
