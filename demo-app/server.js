// demo-app/server.js
// a tiny pretend "app" that uses a feature flag.
//
// it talks to the FlagPilot server from its own server side, so the
// browser never calls port 3000 directly. that means no CORS setup,
// and the browser only ever talks to the page it came from.

require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const FLAGPILOT = process.env.FLAGPILOT_URL || 'http://localhost:3000';
const ENV = process.env.FLAGPILOT_ENV || 'development';

app.use(express.static(path.join(__dirname, 'public')));

// the page asks us "is dark_mode on for this user?" and we ask flagpilot
app.get('/flag', async (req, res) => {
  const key = req.query.key;
  const user = req.query.user || 'u_1001';

  try {
    const reply = await fetch(
      `${FLAGPILOT}/api/check?key=${encodeURIComponent(key)}&env=${ENV}&user=${encodeURIComponent(user)}`
    );
    res.json(await reply.json());
  } catch (err) {
    // flagpilot being down must not break the app - say so and move on
    res.status(502).json({ enabled: false, reason: 'flagpilot unavailable' });
  }
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log('demo app on http://localhost:' + port));
