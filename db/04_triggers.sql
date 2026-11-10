-- db/04_triggers.sql
-- Run this AFTER 02_seed.sql. (If it existed during seeding, every seeded
-- flag_environments row would have written a fake history row.)
--
-- what this does: whenever a flag is switched on or off, the database
-- writes the history entry itself. our route code never inserts history
-- for a toggle. that means history can't be skipped, even if someone
-- changes the data by hand in a SQL console.

USE flagpilot;

DROP TRIGGER IF EXISTS trg_fe_audit_update;

-- a trigger is a piece of SQL the database runs by itself when a table
-- changes. AFTER UPDATE = "once the update has happened, do this too".
--
-- this is a single statement, so it needs no BEGIN...END block. (If you
-- ever write a trigger with BEGIN...END, you must wrap it in DELIMITER $$
-- ... $$ because the inner semicolons would otherwise end the statement
-- early. we don't need that here.)
CREATE TRIGGER trg_fe_audit_update
AFTER UPDATE ON flag_environments
FOR EACH ROW
  INSERT INTO flag_history
    (flag_id, flag_key, environment_id, environment_name,
     changed_by, action, old_value, new_value, changed_at)
  -- INSERT ... SELECT, because the trigger only knows NEW.flag_id (a
  -- number). it has to LOOK UP the flag's name and the environment's
  -- name to store them as snapshots. reading other tables from inside a
  -- trigger is allowed - changing the table the trigger is ON is not.
  SELECT NEW.flag_id,
         f.flag_key,
         NEW.environment_id,
         e.environment_name,
         COALESCE(@changed_by, 'system'),   -- set by the server; 'system' if nobody did
         IF(NEW.is_enabled = 1, 'enabled', 'disabled'),
         IF(OLD.is_enabled = 1, 'true', 'false'),
         IF(NEW.is_enabled = 1, 'true', 'false'),
         NOW()
  FROM feature_flags f
  JOIN environments e ON e.environment_id = NEW.environment_id
  WHERE f.flag_id = NEW.flag_id
    AND OLD.is_enabled <> NEW.is_enabled;   -- don't log "saved with no change"


-- how to check it's there:
--   SHOW TRIGGERS;
--
-- how to test it WITHOUT the server, right now:
--   SET @changed_by = 'manual-test';
--   UPDATE flag_environments SET is_enabled = NOT is_enabled
--     WHERE flag_environment_id = 1;
--   SELECT * FROM flag_history ORDER BY history_id DESC LIMIT 1;
-- expect: action enabled/disabled, changed_by 'manual-test',
--         and flag_key + environment_name filled in.
