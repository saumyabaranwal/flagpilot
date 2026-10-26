-- db/02_seed.sql
-- Run AFTER 01_schema.sql and BEFORE 04_triggers.sql.
-- (If triggers exist when this runs, every flag_environments insert
--  would write a fake history row.)
USE flagpilot;

INSERT INTO projects (project_id, project_name, description) VALUES
  (1, 'FlagPilot Demo App', 'Sample project used for seed data and demos');

INSERT INTO environments (environment_id, project_id, environment_name) VALUES
  (1, 1, 'development'),
  (2, 1, 'production');

INSERT INTO feature_flags (flag_id, project_id, flag_key, description) VALUES
  (1, 1, 'dark_mode',    'Dark colour theme for the UI'),
  (2, 1, 'new_checkout', 'Redesigned checkout flow'),
  (3, 1, 'beta_banner',  'Announcement banner for the beta programme');

INSERT INTO test_users (test_user_id, project_id, user_key, display_name) VALUES
  (1, 1, 'u_1001', 'Asha Verma'),
  (2, 1, 'u_1002', 'Rohan Mehta');

-- every flag x every environment = 6 rows
-- development: 2 enabled, production: 1 enabled (so the per-env count differs)
INSERT INTO flag_environments (flag_environment_id, flag_id, environment_id, is_enabled) VALUES
  (1, 1, 1, TRUE),    -- dark_mode    / development
  (2, 1, 2, FALSE),   -- dark_mode    / production
  (3, 2, 1, TRUE),    -- new_checkout / development
  (4, 2, 2, FALSE),   -- new_checkout / production
  (5, 3, 1, FALSE),   -- beta_banner  / development
  (6, 3, 2, TRUE);    -- beta_banner  / production

-- overrides: "OFF for everyone, ON for this user" and one the other way round
INSERT INTO targeting_rules (rule_id, flag_environment_id, test_user_id, is_enabled) VALUES
  (1, 2, 1, TRUE),    -- dark_mode    / production  / u_1001 -> ON
  (2, 4, 2, TRUE),    -- new_checkout / production  / u_1002 -> ON
  (3, 1, 2, FALSE);   -- dark_mode    / development / u_1002 -> OFF (overrides ON default)

-- hand-written history, because triggers aren't installed yet.
-- these are snapshots: flag_key / environment_name are stored as text.
INSERT INTO flag_history
  (flag_id, flag_key, environment_id, environment_name, changed_by, action, old_value, new_value, changed_at)
VALUES
  (1, 'dark_mode',    1, 'development', 'seed', 'enabled',         'false', 'true',   '2026-10-20 10:00:00'),
  (1, 'dark_mode',    2, 'production',  'seed', 'targeting_added', NULL,    'u_1001', '2026-10-21 11:30:00'),
  (2, 'new_checkout', 1, 'development', 'seed', 'enabled',         'false', 'true',   '2026-10-22 09:15:00'),
  (3, 'beta_banner',  2, 'production',  'seed', 'enabled',         'false', 'true',   '2026-10-23 16:45:00');