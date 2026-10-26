-- db/00_reset.sql
-- Wipes the schema so 01_schema.sql can be re-run from scratch.
-- Run this whenever you want a clean slate. Safe to run before the tables exist.

CREATE DATABASE IF NOT EXISTS flagpilot
  DEFAULT CHARACTER SET utf8mb4;
USE flagpilot;

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS flag_history, targeting_rules, test_users,
                     flag_environments, feature_flags, environments, projects;
SET FOREIGN_KEY_CHECKS = 1;
