#!/usr/bin/env bash
set -euo pipefail

# Helper for regenerating / refreshing the shared event schema.
# Current state: schema is maintained manually because no WASM lives in this repo yet.
# When contracts are compiled and placed under contracts/ or wasm/, this script can be
# extended to call `stellar contract bindings json`.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "→ ACBU Event Schema helper"
echo ""

if ls contracts/**/*.wasm wasm/**/*.wasm 1>/dev/null 2>&1; then
  echo "WASM artifacts detected. Generating schema from bindings..."
  # Placeholder for future generation:
  # stellar contract bindings json --wasm <path> | jq -S . > shared/events-schema.json
  echo "(Automatic generation not yet wired – update shared/events-schema.json manually for now)"
else
  echo "No WASM artifacts found under contracts/ or wasm/."
  echo "Schema is currently the manual source of truth for Horizon effect shapes."
  echo ""
  echo "Current schema location: shared/events-schema.json"
  echo "Update it when:"
  echo "  • Contract event payloads change"
  echo "  • New listeners are added under src/jobs/acbu_*_event_listener.ts"
  echo ""
  echo "See WASM_INTEGRITY.md for how to register future .wasm files."
fi

echo ""
echo "✅ Done"
