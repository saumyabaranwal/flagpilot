#!/usr/bin/env bash
# db/rebuild.sh
# Rebuilds the flagpilot database from scratch, in the right order.
#
#   ./db/rebuild.sh              -> reset + schema + seed
#   ./db/rebuild.sh --verify     -> ...and then run 99_verify.sql
#
# Run this from Git Bash (not from the mysql> prompt!).
# It asks for the MySQL root password once, because all files go into
# a single mysql session.

set -e   # stop on the first failure instead of carrying on with a half-built db

cd "$(dirname "$0")/.."   # so it works no matter which folder you call it from

files=(db/00_reset.sql db/01_schema.sql db/02_seed.sql)
if [[ "$1" == "--verify" ]]; then
  files+=(db/99_verify.sql)
fi

echo "rebuilding: ${files[*]}"
cat "${files[@]}" | mysql -u root -p

echo "done. 7 tables should exist:"
mysql -u root -p -e "USE flagpilot; SHOW TABLES;"
