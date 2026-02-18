#!/usr/bin/env bash
set -euo pipefail

OUTPUT_DIR="${1:-artifacts/lint}"
OUTPUT_FILE="$OUTPUT_DIR/eslint-baseline.json"

mkdir -p "$OUTPUT_DIR"

if bunx eslint . --format json --output-file "$OUTPUT_FILE"; then
  echo "[lint:baseline] no lint violations found."
else
  echo "[lint:baseline] captured current lint debt at $OUTPUT_FILE"
fi

echo "[lint:baseline] report path: $OUTPUT_FILE"
