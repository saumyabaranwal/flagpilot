#!/usr/bin/env bash
# server/check-tests.sh
# Runs all 10 cases from TEST_MATRIX.md against a running server and
# prints PASS or FAIL for each.
#
# Usage:
#   1. in one window:   cd server && npm run dev
#   2. in another:      ./server/check-tests.sh

BASE="http://localhost:3000/api/check"

# flag | env | user | expected_enabled | expected_reason
cases=(
  "dark_mode|development|u_1001|true|environment_default"
  "dark_mode|development|u_1002|false|targeting_rule"
  "dark_mode|development|u_9999|true|environment_default"
  "dark_mode|production|u_1001|true|targeting_rule"
  "dark_mode|production|u_1002|false|environment_default"
  "new_checkout|production|u_1002|true|targeting_rule"
  "beta_banner|development|u_1001|false|environment_default"
  "beta_banner|production|u_1001|true|environment_default"
  "dark_mode|staging|u_1001|false|unknown_environment"
  "nope_flag|development|u_1001|false|unknown_flag"
)

pass=0
fail=0

printf '%-3s %-14s %-13s %-8s %-22s %s\n' "#" "FLAG" "ENV" "USER" "EXPECTED" "RESULT"
printf '%s\n' "--------------------------------------------------------------------------------"

n=0
for c in "${cases[@]}"; do
  n=$((n + 1))
  IFS='|' read -r flag env user exp_enabled exp_reason <<< "$c"

  # -s silences curl's progress meter; the URL is quoted so & is not read by bash
  resp=$(curl -s --max-time 5 "$BASE?key=$flag&env=$env&user=$user")

  # pull the two fields out of the JSON without needing jq
  got_enabled=$(printf '%s' "$resp" | grep -o '"enabled":[^,}]*' | cut -d: -f2)
  got_reason=$(printf '%s' "$resp" | grep -o '"reason":"[^"]*"' | cut -d: -f2 | tr -d '"')

  if [[ "$got_enabled" == "$exp_enabled" && "$got_reason" == "$exp_reason" ]]; then
    verdict="PASS"
    pass=$((pass + 1))
  else
    verdict="FAIL  (got: enabled=$got_enabled reason=${got_reason:-none})"
    fail=$((fail + 1))
  fi

  printf '%-3s %-14s %-13s %-8s %-22s %s\n' "$n" "$flag" "$env" "$user" "$exp_enabled/$exp_reason" "$verdict"
done

printf '%s\n' "--------------------------------------------------------------------------------"
echo "$pass passed, $fail failed"

if [[ $fail -gt 0 ]]; then
  echo
  echo "if every case failed, is the server actually running on port 3000?"
  echo "raw response of the last request was:"
  echo "$resp"
fi
