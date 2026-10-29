#!/usr/bin/env bash
# fj-check.sh — ten-second production truth check for FJ - Find Jobs.
#
#   bash fj-check.sh                 # checks https://fj-find-jobs.pages.dev
#   BASE=http://127.0.0.1:5173 bash fj-check.sh
#
# Checks: feed freshness + scheduler heartbeat, field coverage vs floors,
# plan prices and the free-alerts entitlement, crawler prerender length,
# security headers, auth vendor names, and the OTP endpoint. Read-only,
# except one OTP request for a made-up address (counts against rate limits
# only). Exits non-zero if anything fails.
set -u
BASE="${BASE:-https://fj-find-jobs.pages.dev}"
FAIL=0
pass() { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; FAIL=1; }
note() { printf '  --   %s\n' "$1"; }

json() { # json <url> <python-expression over d>
  curl -s --max-time 20 "$1" | python3 -c "import sys,json
try:
    d=json.load(sys.stdin)
    print($2)
except Exception as e:
    print('')" 2>/dev/null
}

echo "FJ check against $BASE"

echo "[ingestion]"
AGE_H=$(json "$BASE/api/feed-status" "
import datetime
u=d.get('updatedAt')
print(round((datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(u.replace('Z','+00:00'))).total_seconds()/3600,1) if u else '')")
TOTAL=$(json "$BASE/api/feed-status" "d.get('total','')")
STALE=$(json "$BASE/api/feed-status" "d.get('schedulerStale','')")
SOURCES=$(json "$BASE/api/feed-status" "d.get('sourceCount','')")
note "jobs=$TOTAL sources=$SOURCES data age=${AGE_H}h schedulerStale=$STALE"
[ -n "$AGE_H" ] && python3 -c "exit(0 if float('$AGE_H') < 12 else 1)" && pass "data age < 12h" || fail "data age >= 12h or unknown"
[ "$STALE" = "False" ] && pass "scheduler heartbeat fresh" || fail "scheduler heartbeat stale/missing"

echo "[coverage] (floors: workMode .6 seniority .6 requiredSkills .5 location .6)"
for pair in "workMode 0.6" "seniority 0.6" "requiredSkills 0.5" "locationCountry 0.6"; do
  set -- $pair
  V=$(json "$BASE/api/jobs/stats" "d.get('coverage',{}).get('$1','')")
  note "$1=$V"
  [ -n "$V" ] && python3 -c "exit(0 if float('$V') >= float('$2') else 1)" && pass "$1 >= $2" || fail "$1 below floor $2"
done
CAUTION=$(json "$BASE/api/jobs/stats" "d.get('moderation',{}).get('caution','')")
note "caution share=$CAUTION"
[ -n "$CAUTION" ] && python3 -c "exit(0 if float('$CAUTION') < 0.2 else 1)" && pass "caution < 20%" || fail "caution >= 20%"

echo "[plans]"
PRO=$(json "$BASE/api/billing/plans" "next((p['price']['amount'] for p in d['plans'] if p['id']=='pro'),'')")
GRAD=$(json "$BASE/api/billing/plans" "next((p['price']['amount'] for p in d['plans'] if p['id']=='pro_graduate'),'')")
ANN=$(json "$BASE/api/billing/plans" "next((p['price']['amount'] for p in d['plans'] if p['id']=='pro_annual'),'')")
FREE_ALERTS=$(json "$BASE/api/billing/plans" "'alerts' in next((p['entitlements'] for p in d['plans'] if p['id']=='free'),[])")
note "pro=$PRO graduate=$GRAD annual=$ANN freeAlerts=$FREE_ALERTS"
[ "$PRO" = "10000" ] && pass "pro is 10000" || fail "pro price is $PRO (want 10000)"
[ "$GRAD" = "3000" ] && pass "graduate is 3000" || fail "graduate price is $GRAD (want 3000)"
[ "$ANN" = "100000" ] && pass "annual is 100000" || fail "annual price is $ANN (want 100000)"
[ "$FREE_ALERTS" = "True" ] && pass "alerts on free tier" || fail "alerts missing from free tier"

echo "[prerender]"
BODY=$(curl -s --max-time 20 -A "Mozilla/5.0 (compatible; Googlebot/2.1)" "$BASE/privacy")
LEN=${#BODY}
note "googlebot /privacy bytes=$LEN"
[ "$LEN" -gt 1200 ] && pass "crawler body is real content" || fail "crawler body too short ($LEN)"

echo "[headers + auth]"
HDRS=$(curl -sI --max-time 20 "$BASE/")
echo "$HDRS" | grep -qi "content-security-policy" && pass "CSP header present" || note "no CSP on / (check host config)"
echo "$HDRS" | grep -qi "cloudflareaccess" && fail "Cloudflare Access reference in headers" || pass "no Access references"
OTP=$(curl -s --max-time 20 -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/otp/request" -H 'Content-Type: application/json' -d '{"email":"fj-check@example.com"}')
case "$OTP" in
  200) pass "OTP request 200 (email provider configured)" ;;
  503) fail "OTP request 503 email_not_configured — set RESEND_API_KEY (+ EMAIL_FROM/OTP_FROM)" ;;
  429) note "OTP request 429 (rate limited; provider state unknown)" ;;
  *)   fail "OTP request unexpected status $OTP" ;;
esac

echo "[bundle]"
JS=$(curl -s --max-time 20 "$BASE/" | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1)
if [ -n "$JS" ]; then
  BUNDLE=$(curl -s --max-time 30 "$BASE/$JS")
  echo "$BUNDLE" | grep -q "cloudflareaccess" && fail "bundle mentions Cloudflare Access" || pass "bundle free of Access references"
  echo "$BUNDLE" | grep -q "₦5,000 / month" && fail "bundle shows stale ₦5,000 price" || pass "no stale ₦5,000 price literal"
else
  note "could not locate bundle js"
fi

echo
[ "$FAIL" = "0" ] && echo "ALL CHECKS PASSED" || echo "SOME CHECKS FAILED"
exit "$FAIL"
