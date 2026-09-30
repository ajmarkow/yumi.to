#!/usr/bin/env bash
# Link parity check for the l.ajm.codes Vercel->AWS migration.
# Compares redirect behavior between an old host and a new host for every
# short in a Supabase export, plus the acceptance-contract edge cases.
#
# Usage: scripts/verify-links.sh OLD_HOST NEW_HOST EXPORT_PATH
#   OLD_HOST    e.g. https://l.ajm.codes
#   NEW_HOST    e.g. https://l-next.ajm.codes
#   EXPORT_PATH e.g. /var/lib/paseo/projects/yumi.to-migration-data/shortlinks-2026-09-30.json
#
# Env:
#   DELAY_SECONDS  pause between requests (default 0.2)

set -uo pipefail

OLD_HOST="${1:?usage: verify-links.sh OLD_HOST NEW_HOST EXPORT_PATH}"
NEW_HOST="${2:?usage: verify-links.sh OLD_HOST NEW_HOST EXPORT_PATH}"
EXPORT_PATH="${3:?usage: verify-links.sh OLD_HOST NEW_HOST EXPORT_PATH}"
DELAY_SECONDS="${DELAY_SECONDS:-0.2}"

OLD_HOST="${OLD_HOST%/}"
NEW_HOST="${NEW_HOST%/}"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 2
fi
if [ ! -f "$EXPORT_PATH" ]; then
  echo "export file not found: $EXPORT_PATH" >&2
  exit 2
fi

total=0
matched=0
mismatched=0
mismatch_list=()

# Compares one path's redirect status/location across both hosts.
check_path() {
  local label="$1" path="$2"
  local old new
  old=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$OLD_HOST$path")
  new=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$NEW_HOST$path")
  total=$((total + 1))
  if [ "$old" = "$new" ]; then
    matched=$((matched + 1))
  else
    mismatched=$((mismatched + 1))
    mismatch_list+=("$label $path: old=[$old] new=[$new]")
    echo "MISMATCH $label $path: old=[$old] new=[$new]"
  fi
  sleep "$DELAY_SECONDS"
}

echo "== parity check: every short in $EXPORT_PATH =="
while IFS= read -r short; do
  # short values are stored verbatim, so URL-encode before requesting
  encoded=$(jq -rn --arg s "$short" '$s|@uri')
  check_path "export" "/$encoded"
done < <(jq -r '.[].short' "$EXPORT_PATH")

echo "== edge cases from the plan =="
check_path "unknown-short" "/zzz-verify-nonexistent-000"
check_path "gh" "/gh/nix-server"

# Prefix matching exactly one row: pick a short prefix of one export row
# that is not itself a stored short, and confirm only one row starts with it.
prefix_one=$(jq -r '
  [.[].short] as $all
  | $all[]
  | . as $s
  | ($s[0:4]) as $p
  | select(($all | index($p)) == null)
  | select(($all | map(select(startswith($p))) | length) == 1)
  | $p
' "$EXPORT_PATH" | head -n1)
if [ -n "$prefix_one" ]; then
  check_path "prefix-single-match" "/$prefix_one"
else
  echo "WARN: could not find a single-match prefix in the export; skipping"
fi

# Prefix matching 2+ rows: find a prefix shared by multiple shorts, where the
# prefix itself is NOT a stored short (else exact match would short-circuit
# before the prefix branch ever runs).
prefix_many=$(jq -r '
  [.[].short] as $all
  | ($all | map(.[0:6])) as $prefixes
  | $prefixes[]
  | . as $p
  | select(($all | index($p)) == null)
  | select(($all | map(select(startswith($p))) | length) >= 2)
  | $p
' "$EXPORT_PATH" | sort -u | head -n1)
if [ -n "$prefix_many" ]; then
  check_path "prefix-multi-match" "/$prefix_many"
else
  echo "WARN: could not find a multi-match prefix in the export; skipping"
fi

# /blog/<x> uses https://ajm.codes/blog/dictionary.json, independent of DB.
blog_key=$(curl -s https://ajm.codes/blog/dictionary.json | jq -r 'keys[0] // empty' 2>/dev/null)
if [ -n "${blog_key:-}" ]; then
  check_path "blog" "/blog/$blog_key"
else
  echo "WARN: https://ajm.codes/blog/dictionary.json unavailable or empty; skipping /blog/ edge case"
fi

# robots.txt: NOT a parity check. The old (Vercel) site has a known bug --
# it serves "Disallow:" (empty), which allows all crawling. The migration
# deliberately fixes this to "Disallow: /" (disallow everything), so the new
# host is expected to differ from the old host here. Only assert the new
# host actually disallows everything; still report both bodies for the record.
echo "== robots.txt body (deliberate fix, not a parity check) =="
old_robots=$(curl -s "$OLD_HOST/robots.txt")
new_robots=$(curl -s "$NEW_HOST/robots.txt")
echo "--- old ($OLD_HOST) ---"
echo "$old_robots"
echo "--- new ($NEW_HOST) ---"
echo "$new_robots"
total=$((total + 1))
if echo "$new_robots" | grep -qE '^Disallow:[[:space:]]*/[[:space:]]*$'; then
  matched=$((matched + 1))
else
  mismatched=$((mismatched + 1))
  mismatch_list+=("robots.txt on $NEW_HOST does not disallow everything")
  echo "MISMATCH: $NEW_HOST/robots.txt does not contain 'Disallow: /'"
fi

echo
echo "== summary =="
echo "total: $total  matched: $matched  mismatched: $mismatched"

if [ "$mismatched" -gt 0 ]; then
  exit 1
fi
exit 0
