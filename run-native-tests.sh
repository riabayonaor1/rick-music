#!/bin/bash
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/partitura-tests.XXXXXX")"
trap 'rm -rf "$TEST_DIR"' EXIT
cp "$PROJECT_DIR/tests/NativeEditorTests.swift" "$TEST_DIR/NativeEditorTests.swift"
cp "${RICK_SCENARIO_PATH:-$PROJECT_DIR/tests/editor-scenario.js}" "$TEST_DIR/editor-scenario.js"
cp -R "$PROJECT_DIR/dist" "$TEST_DIR/dist"
if [[ -n "${RICK_HTML_PATH:-}" ]]; then cp "$RICK_HTML_PATH" "$TEST_DIR/dist/index.html"; fi
cp -R "$PROJECT_DIR/Ejemplos" "$TEST_DIR/Ejemplos"
xcrun swiftc -O -target "$(uname -m)-apple-macos12.0" -framework AppKit -framework WebKit \
  "$TEST_DIR/NativeEditorTests.swift" -o "$TEST_DIR/native-editor-tests"
"$TEST_DIR/native-editor-tests" "$TEST_DIR/dist/index.html" "$TEST_DIR/editor-scenario.js" "${RICK_PREVIEW_PATH:-$TEST_DIR/preview.png}"
