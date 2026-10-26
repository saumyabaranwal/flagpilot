-- db/01_schema.sql
-- FlagPilot schema — 7 tables.
--
-- Order matters! MySQL won't let a table reference a table that doesn't
-- exist yet, so parents are created first:
--
--   projects
--     |-- environments
--     |-- feature_flags
--     |-- test_users
--             |
--             --> flag_environments
--                     |-- targeting_rules
--                     |-- flag_history
--
-- to run:  mysql -u root -p < db/01_schema.sql
-- (or from inside the shell:  SOURCE db/01_schema.sql; )


-- ---------------------------------------------------------------------
-- 1. projects
-- the root of everything. we keep it simple: one project = one app the
-- developer is building.
-- ---------------------------------------------------------------------
CREATE TABLE projects (
  project_id    INT AUTO_INCREMENT PRIMARY KEY,
  project_name  VARCHAR(120) NOT NULL,
  description   VARCHAR(500),
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;


-- ---------------------------------------------------------------------
-- 2. environments
-- where the app runs: development, staging, production.
-- a flag can be ON in development and OFF in production, which is the
-- whole reason this table exists separately.
-- ---------------------------------------------------------------------
CREATE TABLE environments (
  environment_id   INT AUTO_INCREMENT PRIMARY KEY,
  project_id       INT NOT NULL,
  environment_name VARCHAR(50) NOT NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- stops two "production" rows in one project. if that happened, the
  -- check query (which looks an environment up by name) would return two
  -- rows and answer randomly. see D-05.
  CONSTRAINT uq_env_name UNIQUE (project_id, environment_name),

  -- delete a project, its environments go with it
  CONSTRAINT fk_env_project FOREIGN KEY (project_id)
    REFERENCES projects(project_id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;


-- ---------------------------------------------------------------------
-- 3. feature_flags
-- the flag itself, e.g. flag_key = 'dark_mode'.
-- notice there is NO is_enabled column here: on/off is per environment,
-- so the state lives in flag_environments below.
-- ---------------------------------------------------------------------
CREATE TABLE feature_flags (
  flag_id     INT AUTO_INCREMENT PRIMARY KEY,
  project_id  INT NOT NULL,
  flag_key    VARCHAR(100) NOT NULL,
  description VARCHAR(500),
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- one 'dark_mode' per project, no duplicates. this is also the key the
  -- developer types in their code, so it has to be exact.
  CONSTRAINT uq_flag_key UNIQUE (project_id, flag_key),

  CONSTRAINT fk_flag_project FOREIGN KEY (project_id)
    REFERENCES projects(project_id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;


-- ---------------------------------------------------------------------
-- 4. test_users
-- the fake users we target flags at. the real app's users don't live
-- here - this is only for testing "make it ON for me, OFF for everyone".
-- ---------------------------------------------------------------------
CREATE TABLE test_users (
  test_user_id INT AUTO_INCREMENT PRIMARY KEY,
  project_id   INT NOT NULL,
  user_key     VARCHAR(100) NOT NULL,
  display_name VARCHAR(120),
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- the same user_key can exist in two different projects, but not twice
  -- in the same one
  CONSTRAINT uq_test_user UNIQUE (project_id, user_key),

  CONSTRAINT fk_tu_project FOREIGN KEY (project_id)
    REFERENCES projects(project_id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;


-- ---------------------------------------------------------------------
-- 5. flag_environments
-- the important one. connects a flag to an environment and holds the
-- actual on/off switch.
-- "is dark_mode ON in production?" is answered by ONE row in here.
-- ---------------------------------------------------------------------
CREATE TABLE flag_environments (
  flag_environment_id INT AUTO_INCREMENT PRIMARY KEY,
  flag_id             INT NOT NULL,
  environment_id      INT NOT NULL,
  is_enabled          BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                               ON UPDATE CURRENT_TIMESTAMP,   -- db sets this, not node

  -- only one row per (flag, environment) pair. without this you could
  -- have two rows saying different things about the same flag, and the
  -- check query wouldn't know which to believe.
  CONSTRAINT uq_flag_env UNIQUE (flag_id, environment_id),

  -- delete a flag -> its on/off state rows go too
  CONSTRAINT fk_fe_flag FOREIGN KEY (flag_id)
    REFERENCES feature_flags(flag_id) ON DELETE CASCADE,

  -- delete an environment -> same
  CONSTRAINT fk_fe_env FOREIGN KEY (environment_id)
    REFERENCES environments(environment_id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;


-- ---------------------------------------------------------------------
-- 6. targeting_rules
-- the override layer, one step below flag_environments.
-- "keep the flag OFF for everyone, except user u_1001" = a row here.
-- one row overrides the environment default for exactly one user.
-- ---------------------------------------------------------------------
CREATE TABLE targeting_rules (
  rule_id             INT AUTO_INCREMENT PRIMARY KEY,
  flag_environment_id INT NOT NULL,
  test_user_id        INT NOT NULL,
  is_enabled          BOOLEAN NOT NULL DEFAULT TRUE,

  -- one rule per user per flag per environment. no point having two
  -- contradicting rules for the same person.
  CONSTRAINT uq_rule UNIQUE (flag_environment_id, test_user_id),

  CONSTRAINT fk_rule_fe FOREIGN KEY (flag_environment_id)
    REFERENCES flag_environments(flag_environment_id) ON DELETE CASCADE,
  CONSTRAINT fk_rule_tu FOREIGN KEY (test_user_id)
    REFERENCES test_users(test_user_id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;


-- ---------------------------------------------------------------------
-- 7. flag_history
-- who changed what, and when. written by triggers, not by our code.
--
-- two things that look odd but are on purpose (D-03 and D-04):
--   * flag_id is NULLABLE and ON DELETE SET NULL, so deleting a flag does
--     not wipe its history.
--   * but then the row wouldn't know which flag it was about, so flag_key
--     and environment_name are copied in as snapshots when the row is made.
--   history records the past, it is not a copy of current state.
-- ---------------------------------------------------------------------
CREATE TABLE flag_history (
  history_id       INT AUTO_INCREMENT PRIMARY KEY,

  flag_id          INT,                       -- a reference, can become null
  flag_key         VARCHAR(100) NOT NULL,     -- a snapshot, never becomes null
  environment_id   INT,
  environment_name VARCHAR(50),               -- snapshot again, 50 matches environments

  changed_by       VARCHAR(120) NOT NULL DEFAULT 'system',
  action           ENUM('created','enabled','disabled',
                        'targeting_added','targeting_removed','archived') NOT NULL,
  old_value        VARCHAR(255),              -- varchar, not boolean, because we
  new_value        VARCHAR(255),              -- also log user keys and other values
  changed_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_hist_flag FOREIGN KEY (flag_id)
    REFERENCES feature_flags(flag_id) ON DELETE SET NULL,
  CONSTRAINT fk_hist_env FOREIGN KEY (environment_id)
    REFERENCES environments(environment_id) ON DELETE SET NULL,

  -- the history panel always asks for "newest first, for one flag",
  -- so index exactly that
  INDEX idx_hist_flag_time (flag_id, changed_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;


-- ---------------------------------------------------------------------
-- done. expect 7 tables:
--   SHOW TABLES;
--
-- to check the foreign keys all landed:
--   SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME
--   FROM information_schema.KEY_COLUMN_USAGE
--   WHERE TABLE_SCHEMA = 'flagpilot' AND REFERENCED_TABLE_NAME IS NOT NULL;
-- should return 9 rows.
-- ---------------------------------------------------------------------
