#!/usr/bin/env bash
# Type-checks every Supabase Edge Function with tsc, the same way it's been
# verified by hand throughout development. Deno-only constructs (the global
# `Deno` object, .ts-extension imports, remote URL imports) aren't
# recognized by a plain Node/tsc setup, so those specific error codes are
# filtered out deliberately — everything else is a real problem.
set -uo pipefail
cd "$(dirname "$0")/.."

FILES=(
  "supabase-functions/_shared/digest.ts"
  "supabase-functions/_shared/notify.ts"
  "supabase-functions/_shared/dedupe.ts"
  "supabase-functions/ai-proxy/index.ts"
  "supabase-functions/whatsapp-webhook/index.ts"
  "supabase-functions/queue-processor/index.ts"
  "supabase-functions/weekly-digest/index.ts"
  "supabase-functions/send-report/index.ts"
)

TSC="npx tsc"
FAIL=0

for f in "${FILES[@]}"; do
  if [ ! -f "$f" ]; then
    echo "not found, skipping: $f"
    continue
  fi
  OUT=$($TSC --noEmit --target esnext --module esnext --moduleResolution bundler \
    --skipLibCheck --allowImportingTsExtensions --noImplicitAny false "$f" 2>&1 \
    | grep -v "TS2307\|Cannot find module\|Cannot find name 'Deno'\|TS7006")
  if [ -n "$OUT" ]; then
    echo "FAILED: $f"
    echo "$OUT"
    FAIL=1
  else
    echo "OK: $f"
  fi
done

exit $FAIL
