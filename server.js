// server.js (CommonJS)
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Config
const PORT = process.env.PORT || 3001;
const COINS_PER_USD = Number(process.env.COINS_PER_USD || 100);
const STARTING_COINS = Number(process.env.STARTING_COINS || 2000);
const DATA_FILE = path.join(__dirname, 'data.json');

// Helpers
function readData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    const init = { users: [], orders: [], payments: [] };
    fs.writeFileSync(DATA_FILE, JSON.stringify(init, null, 2));
    return init;
  }
}
function writeData(obj) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(obj, null, 2));
}

// Health
app.get('/', (req, res) => {
  res.send('✅ Hall Inc Server is running successfully!');
});

/* ---------------- Users ---------------- */
app.get('/api/users', (req, res) => {
  const db = readData();
  res.json({ ok: true, users: db.users });
});

// register: creates user with starter coins and crypto
app.post('/api/register', (req, res) => {
  const { id, name, email } = req.body;
  const db = readData();
  const userId = id || `user-${Date.now()}`;
  if (db.users.find(u=>u.id===userId)) return res.status(400).json({ ok:false, error: 'user exists' });
  const user = { id: userId, name: name||'User', email: email||'', coins: STARTING_COINS, crypto: { BTC: Number(process.env.STARTER_BTC||0.0005), ETH: Number(process.env.STARTER_ETH||0.01) }, createdAt: Date.now() };
  db.users.unshift(user);
  writeData(db);
  res.json({ ok: true, user });
});

/* ---------------- Convert coins -> USD preview ---------------- */
app.post('/api/convert', (req, res) => {
  const { userId, coins } = req.body;
  if (!userId || typeof coins === 'undefined') return res.status(400).json({ ok:false, error:'userId and coins required' });
  const db = readData();
  const user = db.users.find(u=>u.id===userId);
  if (!user) return res.status(404).json({ ok:false, error:'user not found' });
  const coinsNum = Number(coins);
  if (coinsNum > user.coins) return res.status(400).json({ ok:false, error:'insufficient coins' });
  const usd = (coinsNum / COINS_PER_USD);
  res.json({ ok:true, usd: Number(usd.toFixed(2)) });
});

/* ---------------- Create mock Coinbase charge and deduct coins ---------------- */
app.post('/api/coinbase-charge', (req, res) => {
  const { userId, coins } = req.body;
  if (!userId || typeof coins === 'undefined') return res.status(400).json({ ok:false, error:'userId and coins required' });
  const db = readData();
  const user = db.users.find(u=>u.id===userId);
  if (!user) return res.status(404).json({ ok:false, error:'user not found' });
  const coinsNum = Number(coins);
  if (coinsNum < 2000 || coinsNum > 10500) return res.status(400).json({ ok:false, error:'coins must be 2000–10500' });
  if (user.coins < coinsNum) return res.status(400).json({ ok:false, error:'insufficient coins' });
  const amountUSD = Number((coinsNum / COINS_PER_USD).toFixed(2));
  // Deduct coins immediately (pending payment)
  user.coins = Math.round((user.coins - coinsNum) * 100) / 100;
  // create payment record
  db.payments = db.payments || [];
  const paymentId = `pay-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  const payment = { id: paymentId, userId, coins: coinsNum, amountUSD, status:'PENDING', createdAt: Date.now() };
  db.payments.unshift(payment);
  writeData(db);
  // Return mocked hosted_url (in real setup server would call Coinbase Commerce)
  const hosted_url = `https://commerce.coinbase.com/charges/mock-hosted-url?paymentId=${paymentId}`;
  res.json({ ok:true, payment, hosted_url, simulated:true });
});

/* ---------------- Webhook skeleton (Coinbase Commerce) ---------------- */
app.post('/webhook/coinbase-commerce', (req, res) => {
  // This route expects Coinbase webhook calls. In this demo it will accept a simple JSON to simulate confirmation.
  const { paymentId, action } = req.body;
  if (!paymentId) return res.status(400).json({ ok:false, error:'paymentId required' });
  const db = readData();
  db.payments = db.payments || [];
  const p = db.payments.find(x=>x.id===paymentId);
  if (!p) return res.status(404).json({ ok:false, error:'payment not found' });
  if (p.status === 'CONFIRMED') return res.json({ ok:true, message:'already confirmed' });
  if (action === 'confirm') {
    // credit BTC by amountUSD / price (simplified using fixed rate or env)
    const cryptoType = (process.env.DEFAULT_CRYPTO || 'BTC').toUpperCase();
    // For demo, we'll assume a fixed price: 1 BTC = $30000 if not fetching live
    const priceUSD = Number(process.env.MOCK_BTC_PRICE || 30000);
    const cryptoAmount = Number((p.amountUSD / priceUSD).toFixed(8));
    const user = db.users.find(u=>u.id===p.userId);
    if (!user) return res.status(404).json({ ok:false, error:'user not found' });
    user.crypto = user.crypto || {};
    user.crypto[cryptoType] = (user.crypto[cryptoType] || 0) + cryptoAmount;
    p.status = 'CONFIRMED';
    p.confirmedAt = Date.now();
    p.cryptoType = cryptoType;
    p.cryptoAmount = cryptoAmount;
    // create a simple order record
    db.orders = db.orders || [];
    db.orders.unshift({ id:`order-${Date.now()}`, userId: p.userId, paymentId: p.id, coinsDeducted: p.coins, amountUSD: p.amountUSD, cryptoType, cryptoAmount, status:'COMPLETED', createdAt: Date.now() });
    writeData(db);
    return res.json({ ok:true, message:'payment confirmed', p });
  }
  return res.status(400).json({ ok:false, error:'unknown action' });
});

/* ---------------- Inspect payments/orders ----------------*/
app.get('/api/payments', (req, res) => {
  const db = readData();
  res.json({ ok:true, payments: db.payments });
});
app.get('/api/orders', (req, res) => {
  const db = readData();
  res.json({ ok:true, orders: db.orders });
});

// Start server
app.listen(PORT, () => console.log(`Hall Inc server running on port ${PORT}`));
