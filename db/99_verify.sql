-- db/99_verify.sql
-- Not part of the build. Run this any time to check the seed is sane.
-- These 6 results are your Day 1 report screenshots.
--   SOURCE db/99_verify.sql;

USE flagpilot;

-- 1. every table has rows. expect 1 / 2 / 3 / 6 / 2 / 3 / 4
SELECT 'projects' AS tbl, COUNT(*) AS rows_ FROM projects
UNION ALL SELECT 'environments',      COUNT(*) FROM environments
UNION ALL SELECT 'feature_flags',     COUNT(*) FROM feature_flags
UNION ALL SELECT 'flag_environments', COUNT(*) FROM flag_environments
UNION ALL SELECT 'test_users',        COUNT(*) FROM test_users
UNION ALL SELECT 'targeting_rules',   COUNT(*) FROM targeting_rules
UNION ALL SELECT 'flag_history',      COUNT(*) FROM flag_history;

-- 2. all flags of project 1 in development, with their on/off state
--    (this is the shape the VS Code tree will need)
SELECT f.flag_key, e.environment_name, fe.is_enabled
FROM feature_flags f
JOIN flag_environments fe ON fe.flag_id = f.flag_id
JOIN environments e       ON e.environment_id = fe.environment_id
WHERE f.project_id = 1 AND e.environment_name = 'development'
ORDER BY f.flag_key;

-- 3. how many flags are ON per environment (aggregate + join)
SELECT e.environment_name, COUNT(*) AS total_flags,
       SUM(fe.is_enabled) AS enabled_flags
FROM environments e
JOIN flag_environments fe ON fe.environment_id = e.environment_id
WHERE e.project_id = 1
GROUP BY e.environment_name;

-- 4. the targeting override for u_1002 on dark_mode in development.
--    expect is_enabled = 0, while the environment default is 1.
--    this is the row that makes the eval order testable.
SELECT f.flag_key, e.environment_name, u.user_key,
       fe.is_enabled AS env_default, tr.is_enabled AS user_override
FROM feature_flags f
JOIN flag_environments fe ON fe.flag_id = f.flag_id
JOIN environments e       ON e.environment_id = fe.environment_id
JOIN targeting_rules tr   ON tr.flag_environment_id = fe.flag_environment_id
JOIN test_users u         ON u.test_user_id = tr.test_user_id
WHERE f.flag_key = 'dark_mode' AND e.environment_name = 'development';

-- 5. all 9 foreign keys landed. expect 9 rows.
SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = 'flagpilot' AND REFERENCED_TABLE_NAME IS NOT NULL
ORDER BY TABLE_NAME;

-- 6. the 5 unique constraints. expect 5 rows.
SELECT TABLE_NAME, CONSTRAINT_NAME
FROM information_schema.TABLE_CONSTRAINTS
WHERE TABLE_SCHEMA = 'flagpilot' AND CONSTRAINT_TYPE = 'UNIQUE'
ORDER BY TABLE_NAME;


-- ---------------------------------------------------------------------
-- 7. UNIQUE proof. run this by hand, it is SUPPOSED to fail.
--    a constraint you never tested is a constraint you don't have.
--
-- INSERT INTO environments (project_id, environment_name)
--   VALUES (1, 'production');
--
-- expected: ERROR 1062 (23000): Duplicate entry '1-production' for key
--           'environments.uq_env_name'
--
-- screenshot that error. it's the clearest proof in the whole report.
-- ---------------------------------------------------------------------

-- 8. cascade proof. also by hand. run it, then re-run
--    00_reset -> 01_schema -> 02_seed to restore.
--
--   DELETE FROM projects WHERE project_id = 1;
--   SELECT COUNT(*) FROM flag_environments;   -- expect 0, not 6
--
-- the 6 flag_environments rows vanish because the delete cascades
-- projects -> environments -> flag_environments.
--
-- BUT: SELECT COUNT(*) FROM flag_history;  -- still 4.
-- flag_id became NULL (ON DELETE SET NULL) and flag_key survived,
-- which is D-03 and D-04 doing their job. this is the best demo you have.
