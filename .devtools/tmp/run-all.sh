#!/bin/bash
cd /Users/swcho/Documents/MARTIALDEX
export PGLITE_DIR=/private/tmp/claude-501/-Users-swcho-Documents-MARTIALDEX/52af9c97-39f6-49c6-9857-0702a7ccbab1/scratchpad/pglite/node_modules
for f in .devtools/test-*.mjs; do
  out=$(node "$f" 2>&1); code=$?
  summary=$(echo "$out" | grep -E "[0-9]+/[0-9]+ (passed|통과)|passed|NOT TESTED" | tail -1)
  echo "$code | $f | $summary"
  if [ $code -ne 0 ]; then echo "$out" | grep -E "FAIL|Error" | head -5 | sed 's/^/      /'; fi
done
