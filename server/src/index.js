
const express = require('express');
const { pool } = require('./db');
const { evaluateFlag } = require('./eval');

const app = express();
app.use(express.json());

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'connected' });
  } catch (err) {
    res.status(500).json({ ok: false, db: 'disconnected', error: err.message });
  }
});

app.listen(process.env.PORT || 3000, () => console.log('listening on http://localhost:' + (process.env.PORT || 3000)));

app.get('/api/check', async (req, res) => {
  const { key, env, user } = req.query;

  if (!key || !env || !user) {
    return res.status(400).json({ error: 'key, env and user are all required' });
  }

  try {
    res.json(await evaluateFlag(key, env, user));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

