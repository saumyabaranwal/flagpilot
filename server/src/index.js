// index.js - the HTTP layer. receives requests, calls the database or
// eval.js, sends replies. no flag logic lives in here.
require('dotenv').config();
const express = require('express');
const { pool } = require('./db');
const { evaluateFlag } = require('./eval');

const app = express();
app.use(express.json());

// ---------------------------------------------------------------
// auth - one shared token for now. the extension sends it, and any
// request without it is refused. we hash-compare later; for this
// version a plain compare against .env is enough.
// ---------------------------------------------------------------
function requireToken(req, res, next) {
  const sent = (req.headers.authorization || '').replace('Bearer ', '');
  if (sent !== process.env.API_TOKEN) {
    return res.status(401).json({ error: 'missing or wrong token' });
  }
  next();  // "fine, carry on to the route"
}

// ---------------------------------------------------------------
// health
// ---------------------------------------------------------------
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'connected' });
  } catch (err) {
    res.status(500).json({ ok: false, db: 'disconnected', error: err.message });
  }
});

// ---------------------------------------------------------------
// GET /api/projects  - the top level of the extension's tree
// ---------------------------------------------------------------
app.get('/api/projects', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT project_id, project_name, description, created_at FROM projects ORDER BY project_id'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------
// GET /api/flags?project_id=1&env=development
// every flag in one project, with its on/off state in one environment.
// this is exactly what the tree needs to draw.
// ---------------------------------------------------------------
app.get('/api/flags', async (req, res) => {
  const { project_id, env } = req.query;
  if (!project_id || !env) {
    return res.status(400).json({ error: 'project_id and env are required' });
  }

  try {
    const [rows] = await pool.query(
      `SELECT f.flag_id, f.flag_key, f.description,
              e.environment_id, e.environment_name,
              fe.flag_environment_id, fe.is_enabled, fe.updated_at
       FROM feature_flags f
       JOIN flag_environments fe ON fe.flag_id = f.flag_id
       JOIN environments e       ON e.environment_id = fe.environment_id
       WHERE f.project_id = ? AND e.environment_name = ?
       ORDER BY f.flag_key`,
      [project_id, env]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------
// POST /api/flags  - create a flag
// body: { project_id, flag_key, description }
//
// two things happen together, so this is our first transaction:
//   1. insert the flag
//   2. insert an on/off row for EVERY environment of that project
// if step 2 fails, step 1 must not be left behind. that's what
// BEGIN / COMMIT gives us.
// ---------------------------------------------------------------
app.post('/api/flags', requireToken, async (req, res) => {
  const { project_id, flag_key, description } = req.body;
  if (!project_id || !flag_key) {
    return res.status(400).json({ error: 'project_id and flag_key are required' });
  }

  const conn = await pool.getConnection();   // one connection, borrowed for the transaction
  try {
    await conn.beginTransaction();

    // who is doing this? the trigger can't see the HTTP request, so we
    // put the name into a session variable on THIS connection.
    await conn.query('SET @changed_by = ?', [req.body.changed_by || 'api']);

    const [result] = await conn.query(
      'INSERT INTO feature_flags (project_id, flag_key, description) VALUES (?, ?, ?)',
      [project_id, flag_key, description || null]
    );
    const flagId = result.insertId;   // the id the database just made for us

    // one off-switch per environment of this project
    const [envs] = await conn.query(
      'SELECT environment_id, environment_name FROM environments WHERE project_id = ?',
      [project_id]
    );
    if (envs.length === 0) {
      throw new Error('this project has no environments, so the flag would be unusable');
    }
    for (const e of envs) {
      await conn.query(
        'INSERT INTO flag_environments (flag_id, environment_id, is_enabled) VALUES (?, ?, FALSE)',
        [flagId, e.environment_id]
      );
    }

    // one history row saying "created", written by us because our trigger
    // only watches for UPDATEs, not INSERTs.
    await conn.query(
      `INSERT INTO flag_history
         (flag_id, flag_key, environment_id, environment_name,
          changed_by, action, old_value, new_value)
       VALUES (?, ?, NULL, NULL, ?, 'created', NULL, 'false')`,
      [flagId, flag_key, req.body.changed_by || 'api']
    );

    await conn.commit();
    res.status(201).json({ flag_id: flagId, flag_key, environments: envs.length });
  } catch (err) {
    await conn.rollback();   // undo whatever got halfway done
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();          // always give the connection back, even on error
  }
});

// ---------------------------------------------------------------
// PATCH /api/flags/:flagId/state  - the toggle
// body: { environment_id, is_enabled, changed_by }
//
// the interesting part is NOT the update. it's that the trigger fires
// and writes the history row for us.
// ---------------------------------------------------------------
app.patch('/api/flags/:flagId/state', requireToken, async (req, res) => {
  const { flagId } = req.params;
  const { environment_id, is_enabled } = req.body;

  if (environment_id === undefined || typeof is_enabled !== 'boolean') {
    return res.status(400).json({ error: 'environment_id and a boolean is_enabled are required' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // same connection as the UPDATE below - this is the whole trick.
    // if you run this on the pool and the UPDATE on another connection,
    // the trigger sees an empty variable and writes 'system'.
    await conn.query('SET @changed_by = ?', [req.body.changed_by || 'api']);

    const [result] = await conn.query(
      `UPDATE flag_environments
          SET is_enabled = ?
        WHERE flag_id = ? AND environment_id = ?`,
      [is_enabled, flagId, environment_id]
    );

    if (result.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'that flag has no switch in that environment' });
    }

    await conn.commit();
    res.json({ ok: true, flag_id: Number(flagId), environment_id, is_enabled });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ---------------------------------------------------------------
// POST /api/targeting  - "except for this user"
// body: { flag_id, environment_id, user_key, is_enabled }
// ---------------------------------------------------------------
app.post('/api/targeting', requireToken, async (req, res) => {
  const { flag_id, environment_id, user_key, is_enabled } = req.body;
  if (!flag_id || !environment_id || !user_key) {
    return res.status(400).json({ error: 'flag_id, environment_id and user_key are required' });
  }

  try {
    // find the switch this rule belongs to, and the project it lives in
    const [feRows] = await pool.query(
      `SELECT fe.flag_environment_id, f.project_id, f.flag_key
       FROM flag_environments fe
       JOIN feature_flags f ON f.flag_id = fe.flag_id
       WHERE fe.flag_id = ? AND fe.environment_id = ?`,
      [flag_id, environment_id]
    );
    if (feRows.length === 0) {
      return res.status(404).json({ error: 'no switch for that flag in that environment' });
    }
    const { flag_environment_id, project_id, flag_key } = feRows[0];

    // find or create the test user
    await pool.query(
      'INSERT IGNORE INTO test_users (project_id, user_key) VALUES (?, ?)',
      [project_id, user_key]
    );
    const [userRows] = await pool.query(
      'SELECT test_user_id FROM test_users WHERE project_id = ? AND user_key = ?',
      [project_id, user_key]
    );
    const test_user_id = userRows[0].test_user_id;

    // INSERT ... ON DUPLICATE KEY UPDATE = "create it, or if it already
    // exists just change the value". saves us checking first.
    await pool.query(
      `INSERT INTO targeting_rules (flag_environment_id, test_user_id, is_enabled)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE is_enabled = VALUES(is_enabled)`,
      [flag_environment_id, test_user_id, is_enabled === false ? false : true]
    );

    // targeting changes are not covered by our trigger, so log it here
    await pool.query(
      `INSERT INTO flag_history
         (flag_id, flag_key, environment_id, environment_name, changed_by, action, old_value, new_value)
       SELECT ?, ?, ?, e.environment_name, ?, 'targeting_added', NULL, ?
       FROM environments e WHERE e.environment_id = ?`,
      [flag_id, flag_key, environment_id, req.body.changed_by || 'api', user_key, environment_id]
    );

    res.status(201).json({ ok: true, flag_key, user_key, is_enabled: is_enabled !== false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------
// GET /api/history?flag_id=1  - the diary, newest first
// uses the index we built on (flag_id, changed_at)
// ---------------------------------------------------------------
app.get('/api/history', async (req, res) => {
  const { flag_id } = req.query;
  try {
    const [rows] = await pool.query(
      `SELECT history_id, flag_id, flag_key, environment_name,
              changed_by, action, old_value, new_value, changed_at
       FROM flag_history
       WHERE (? IS NULL OR flag_id = ?)
       ORDER BY changed_at DESC, history_id DESC
       LIMIT 100`,
      [flag_id || null, flag_id || null]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------
// GET /api/check?key=&env=&user=  - the question the app asks
// ---------------------------------------------------------------
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

// listen last: everything above is setup, this opens the door
const port = process.env.PORT || 3000;
app.listen(port, () => console.log('listening on http://localhost:' + port));
