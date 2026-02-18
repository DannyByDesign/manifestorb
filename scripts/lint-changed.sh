#!/usr/bin/env bash
set -euo pipefail

BASE_REF="${1:-origin/main}"
HAS_BASE_REF=true
if ! git rev-parse --verify --quiet "$BASE_REF" >/dev/null; then
  echo "[lint:changed] warning: base ref '$BASE_REF' not found; linting only working tree deltas."
  HAS_BASE_REF=false
fi

collect_changed_files() {
  if [[ "$HAS_BASE_REF" == "true" ]]; then
    local merge_base
    merge_base="$(git merge-base "$BASE_REF" HEAD)"
    git diff --name-only --diff-filter=ACMR -z "$merge_base"...HEAD
  fi

  git diff --name-only --diff-filter=ACMR -z
  git diff --name-only --cached --diff-filter=ACMR -z
  git ls-files --others --exclude-standard -z
}

# Bash + `set -u` can be finicky about empty arrays in some environments; keep this
# explicitly initialized so `${files[@]}` never trips "unbound variable".
declare -a files
files=()
while IFS= read -r -d '' path; do
  [[ -n "$path" ]] || continue
  [[ -f "$path" ]] || continue

  case "$path" in
    *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs) ;;
    *) continue ;;
  esac

  already_added=false
  for existing in "${files[@]:-}"; do
    if [[ "$existing" == "$path" ]]; then
      already_added=true
      break
    fi
  done

  if [[ "$already_added" == "false" ]]; then
    files+=("$path")
  fi
done < <(collect_changed_files)

if [[ ${#files[@]} -eq 0 ]]; then
  echo "[lint:changed] no changed JS/TS files found."
  exit 0
fi

echo "[lint:changed] linting ${#files[@]} changed file(s)"
bunx eslint --max-warnings=0 "${files[@]}"
