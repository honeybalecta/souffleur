#!/usr/bin/env bash
# Legt Bericht, Logs und Bildschirmfotos im Zweig ci-log-<name> ab, damit sie sich ohne Anmeldung nachlesen lassen.
# Aufruf: tools/ci_log.sh <name> <status> <datei-oder-ordner>…
set -u
name="$1"; status="$2"; shift 2
dir="$(mktemp -d)"
for f in "$@"; do
  [ -e "$GITHUB_WORKSPACE/$f" ] && cp -r "$GITHUB_WORKSPACE/$f" "$dir/" || true
done
cd "$dir" || exit 0
{
  echo "# $name · Lauf $GITHUB_RUN_NUMBER · $status · $(date -u +%FT%TZ)"
  echo "Commit: $GITHUB_SHA"
  for log in *.log; do
    [ -f "$log" ] || continue
    echo; echo "## $log"; echo '```'
    grep -E "^e: |error:|ERROR|FAILURE|What went wrong|Could not|Execution failed|Exception|Traceback|✗|SHA-256|Signer" "$log" | grep -v "^> Task" | head -60 || true
    echo "----- letzte Zeilen -----"
    tail -60 "$log"
    echo '```'
  done
} > README.md
git init -q && git checkout -q -b "ci-log-$name"
git add -A
git -c user.name="ci" -c user.email="ci@users.noreply.github.com" commit -qm "$name $GITHUB_RUN_NUMBER $status"
git push -qf "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}" "ci-log-$name" || echo "Log-Zweig nicht geschrieben"
