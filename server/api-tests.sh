#!/usr/bin/env bash
# server/api-tests.sh
# Day 3 smoke test: create, toggle, target, read history.
# Start the server first:  cd server && npm run dev
#
#   ./server/api-tests.sh
#
# The token must match API_TOKEN in server/.env

BASE="http://localhost:3000"
TOKEN="${API_TOKEN:-dev-token-123}"

h() { echo; echo "=== $1 ==="; }

h "1. list projects"
curl -s "$BASE/api/projects"; echo

h "2. list flags in development"
curl -s "$BASE/api/flags?project_id=1&env=development"; echo

h "3. toggle dark_mode (flag 1) ON in development"
curl -s -X PATCH "$BASE/api/flags/1/state" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"environment_id":1,"is_enabled":true,"changed_by":"saumya@local"}'; echo

h "4. history for dark_mode - the row above should now be logged"
curl -s "$BASE/api/history?flag_id=1"; echo

h "5. toggle it back OFF"
curl -s -X PATCH "$BASE/api/flags/1/state" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"environment_id":1,"is_enabled":false,"changed_by":"saumya@local"}'; echo

h "6. create a new flag - should make 2 switches + 1 history row"
curl -s -X POST "$BASE/api/flags" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"project_id":1,"flag_key":"test_flag","description":"created from curl","changed_by":"saumya@local"}'; echo

h "7. target u_1002 to see dark_mode in production"
curl -s -X POST "$BASE/api/targeting" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"flag_id":1,"environment_id":2,"user_key":"u_1002","is_enabled":true,"changed_by":"saumya@local"}'; echo

h "8. is dark_mode on for u_1002 in production now?"
curl -s "$BASE/api/check?key=dark_mode&env=production&user=u_1002"; echo

h "9. no token - should be 401"
curl -s -o /dev/null -w "status: %{http_code}\n" -X PATCH "$BASE/api/flags/1/state" \
  -H "Content-Type: application/json" -d '{"environment_id":1,"is_enabled":true}'

h "10. bad flag id - should be 404"
curl -s -o /dev/null -w "status: %{http_code}\n" -X PATCH "$BASE/api/flags/999/state" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"environment_id":1,"is_enabled":true}'

echo
echo "done. now check in mysql:"
echo "  SELECT history_id, flag_key, action, changed_by, changed_at"
echo "    FROM flag_history ORDER BY history_id DESC LIMIT 6;"
