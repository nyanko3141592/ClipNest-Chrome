#!/bin/bash
set -euo pipefail

NAME="clipnest"
VERSION=$(grep '"version"' manifest.json | head -1 | sed 's/.*: *"\(.*\)".*/\1/')
OUT="${NAME}-v${VERSION}.zip"

rm -f "$OUT"

zip -r "$OUT" \
  manifest.json \
  background.js \
  content.js \
  popup.html \
  popup.js \
  options.html \
  options.css \
  options.js \
  images/ \
  _locales/ \
  -x "*.DS_Store"

echo "✓ Built $OUT ($(du -h "$OUT" | cut -f1))"
