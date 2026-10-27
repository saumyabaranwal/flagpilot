// eval.js - answers ONE question:
// "is this flag on, for this user, in this environment?"
//
// it returns two things:
//   enabled  -> true or false
//   reason   -> which step made that decision (this is your debugger)

const { pool } = require('./db');

async function evaluateFlag(flagKey, environmentName, userKey) {
  // one query. it fetches BOTH possible answers at once:
  //   default_val  = the environment's own on/off switch
  //   targeted_val = an exception for this user, if one exists
  const sql = `
    SELECT fe.is_enabled AS default_val,
           tr.is_enabled AS targeted_val
    FROM feature_flags f
    JOIN flag_environments fe     ON fe.flag_id = f.flag_id
    JOIN environments e           ON e.environment_id = fe.environment_id
    LEFT JOIN test_users tu       ON tu.project_id = f.project_id
                                 AND tu.user_key = ?
    LEFT JOIN targeting_rules tr  ON tr.flag_environment_id = fe.flag_environment_id
                                 AND tr.test_user_id = tu.test_user_id
    WHERE f.flag_key = ? AND e.environment_name = ?
  `;

  // the ? placeholders fill in this order: user, flag, environment
  const [rows] = await pool.query(sql, [userKey, flagKey, environmentName]);

  // no rows means the flag or the environment doesn't exist at all.
  // find out which one, so the reason is useful and not just "false".
  if (rows.length === 0) {
    return explainMissing(flagKey, environmentName);
  }

  const row = rows[0];

  // an exception, if there is one, always wins.
  // mysql stores true/false as 1/0, and "no exception" comes back as null.
  if (row.targeted_val !== null) {
    return {
      enabled: row.targeted_val === 1,
      reason: 'targeting_rule',
    };
  }

  // otherwise the environment's own switch decides
  return {
    enabled: row.default_val === 1,
    reason: 'environment_default',
  };
}

// called only when the main query found nothing. two cheap lookups
// to say WHY, instead of returning a vague false.
async function explainMissing(flagKey, environmentName) {
  const [flagRows] = await pool.query(
    'SELECT 1 FROM feature_flags WHERE flag_key = ? LIMIT 1',
    [flagKey]
  );
  if (flagRows.length === 0) {
    return { enabled: false, reason: 'unknown_flag' };
  }

  const [envRows] = await pool.query(
    'SELECT 1 FROM environments WHERE environment_name = ? LIMIT 1',
    [environmentName]
  );
  if (envRows.length === 0) {
    return { enabled: false, reason: 'unknown_environment' };
  }

  // both exist, but nobody created on/off rows for this flag yet
  return { enabled: false, reason: 'flag_not_in_environment' };
}

module.exports = { evaluateFlag };
