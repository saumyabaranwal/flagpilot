#!/usr/bin/env bash
# db/rebuild.sh
# Rebuilds the flagpilot database from scratch, in the right order.
#
#   ./db/rebuild.sh              -> reset + schema + seed + view + triggers
#   ./db/rebuild.sh --verify     -> ...and then run 99_verify.sql
#
# Run this from Git Bash (not from the mysql> prompt!).
# It asks for the MySQL root password once, because all files go into
# a single mysql session.

set -e   # stop on the first failure instead of carrying on with a half-built db

cd "$(dirname "$0")/.."   # so it works no matter which folder you call it from

# order matters:
#   reset must come first, schema before seed,
#   and triggers MUST come after the seed (see 04_triggers.sql for why)
files=(db/00_reset.sql db/01_schema.sql db/02_seed.sql db/03_indexes_views.sql db/04_triggers.sql)
if [[ "$1" == "--verify" ]]; then
  files+=(db/99_verify.sql)
fi

echo "rebuilding: ${files[*]}"
cat "${files[@]}" | mysql -u root -p

# -- check the result instead of assuming it ------------------------------
# 7 tables + 1 view = 8 rows in SHOW TABLES.
# the trigger is the one thing that can silently go missing: dropping
# flag_environments drops its trigger with it, so if 04_triggers.sql
# didn't run, you get no error and no audit trail. catch it here.

tables=$(mysql -u root -p -N -B -e "USE flagpilot; SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='flagpilot' AND TABLE_TYPE='BASE TABLE';")
views=$(mysql -u root -p -N -B -e "USE flagpilot; SELECT COUNT(*) FROM information_schema.VIEWS WHERE TABLE_SCHEMA='flagpilot';")
triggers=$(mysql -u root -p -N -B -e "USE flagpilot; SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='flagpilot';")

echo
echo "tables:   $tables  (expect 7)"
echo "views:    $views  (expect 1)"
echo "triggers: $triggers  (expect 1)"

if [[ "$tables" != "7" || "$views" != "1" || "$triggers" != "1" ]]; then
  echo
  echo "!! something is missing. the database was rebuilt but is not complete."
  echo "!! if triggers is 0, re-run:  mysql -u root -p < db/04_triggers.sql"
  exit 1
fi

echo
echo "rebuild complete."
