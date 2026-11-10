// demo-app/server.js
// a tiny pretend "app" that uses feature flags.
//
// it talks to the FlagPilot API from its own server side, so the
// browser never calls port 3000 directly. no CORS to configure, and
// the page still loads if FlagPilot is down.

require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const FLAGPILOT = process.env.FLAGPILOT_URL || 'http://localhost:3000';
const DEFAULT_ENV = process.env.FLAGPILOT_ENV || 'development';

app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------
// this route is the "Node / server-side" snippet that the extension
// copies, running for real. one flag, one if. nothing else.
//
//   GET /feature?key=dark_mode&user=u_1001
//
// it answers the question "should I show this feature?" and the answer
// is either the feature or the fallback - the same shape as a real app
// checking one flag at one point in its code.
// ---------------------------------------------------------------------
app.get('/feature', async (req, res) => {
  const key = req.query.key;
  const user = req.query.user || 'u_1001';
  const env = req.query.env || DEFAULT_ENV;

  if (!key) {
    return res.status(400).json({ error: 'key is required, e.g. /feature?key=dark_mode' });
  }

  // --- this block is the snippet, verbatim ---
  const flagRes = await fetch(
    `${FLAGPILOT}/api/check?key=${encodeURIComponent(key)}` +
      `&env=${encodeURIComponent(env)}&user=${encodeURIComponent(user)}`
  );
  const flag = await flagRes.json();   // { enabled: true, reason: '...' }

  if (flag.enabled) {
    // show the new feature
    res.json({ key, show: 'the new feature', enabled: true, reason: flag.reason });
  } else {
    // fall back to the old behaviour
    res.json({ key, show: 'the old behaviour', enabled: false, reason: flag.reason });
  }
  // --- end of the snippet ---
});

// ---------------------------------------------------------------------
// this route is a *different* job: it fetches EVERY flag so the demo
// page can draw a table of all of them. that's why it has no if.
// the page in public/index.html does the deciding for dark_mode.
// ---------------------------------------------------------------------
app.get('/state', async (req, res) => {
  const env = req.query.env || DEFAULT_ENV;
  const user = req.query.user || 'u_1001';

  try {
    // 1. all flags in this environment, with their on/off state
    const flagsRes = await fetch(
      `${FLAGPILOT}/api/flags?project_id=1&env=${encodeURIComponent(env)}`
    );
    const flags = await flagsRes.json();

    // 2. ask the real check endpoint for each one, so we also get the
    //    reason. three flags = three requests, fine for a demo.
    const detailed = await Promise.all(
      flags.map(async (f) => {
        const r = await fetch(
          `${FLAGPILOT}/api/check?key=${encodeURIComponent(f.flag_key)}` +
            `&env=${encodeURIComponent(env)}&user=${encodeURIComponent(user)}`
        );
        const check = await r.json();
        return {
          flag_key: f.flag_key,
          description: f.description,
          enabled: check.enabled,
          reason: check.reason,
        };
      })
    );

    res.json({ env, user, flags: detailed });
  } catch (err) {
    // flagpilot being down must not break the page - say so and move on
    res.status(502).json({ error: 'flagpilot unavailable', detail: err.message });
  }
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log('demo app on http://localhost:' + port));
