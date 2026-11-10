-- db/03_indexes_views.sql
-- A view and one extra index. Small file, but it's where the
-- "views" and "indexes" marks in the syllabus come from.

USE flagpilot;

-- ---------------------------------------------------------------
-- 1. a view: the three-table join, saved under a name
--
-- The extension's tree asks "show me every flag and whether it's on,
-- for one project+environment". That's a join across projects,
-- feature_flags, flag_environments and environments.
--
-- A view stores the QUERY, not the data. It always returns fresh
-- results, and it means the join is written once here instead of
-- being repeated in every route.
-- ---------------------------------------------------------------
CREATE OR REPLACE VIEW v_flag_status AS
SELECT p.project_id,
       p.project_name,
       e.environment_id,
       e.environment_name,
       f.flag_id,
       f.flag_key,
       f.description,
       fe.flag_environment_id,
       fe.is_enabled,
       fe.updated_at
FROM projects p
JOIN feature_flags f      ON f.project_id = p.project_id
JOIN flag_environments fe ON fe.flag_id = f.flag_id
JOIN environments e       ON e.environment_id = fe.environment_id;

-- use it like a table:
--   SELECT flag_key, is_enabled FROM v_flag_status
--   WHERE project_id = 1 AND environment_name = 'development';


-- ---------------------------------------------------------------
-- 2. one extra index
--
-- The other tables don't need new indexes: every lookup we do is
-- already covered by a UNIQUE constraint, because MySQL creates an
-- index for a UNIQUE automatically. For example
--   UNIQUE (project_id, flag_key)  also serves  WHERE project_id = ?
--
-- The one case that isn't covered is the history panel with no flag
-- chosen, which sorts by changed_at across all flags:
--   ORDER BY changed_at DESC
-- so give that column its own index.
-- ---------------------------------------------------------------
CREATE INDEX idx_hist_changed_at ON flag_history (changed_at);


-- ---------------------------------------------------------------
-- how to prove the index is used. run this in the monitor:
--
--   EXPLAIN SELECT * FROM flag_history ORDER BY changed_at DESC LIMIT 20;
--
-- look for "key: idx_hist_changed_at". if it says NULL, MySQL is
-- reading the whole table instead of using the index.
--
-- and the same trick on the check query:
--
--   EXPLAIN SELECT fe.is_enabled FROM feature_flags f
--   JOIN flag_environments fe ON fe.flag_id = f.flag_id
--   WHERE f.flag_key = 'dark_mode';
--
-- key should mention uq_flag_key - proof our UNIQUE constraints are
-- doing the indexing work as a side effect.
-- ---------------------------------------------------------------
