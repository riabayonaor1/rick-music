#!/bin/bash
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEST_DIR="$(mktemp -d /private/tmp/rickmusic-bridge-tests.XXXXXX)"
trap 'rm -rf "$TEST_DIR"' EXIT
python3 - "$PROJECT_DIR" "$TEST_DIR" <<'PY'
from pathlib import Path
import sys
root, temporary = map(Path, sys.argv[1:])
source = (root/'native/Partitura.swift').read_text()
start = source.index('private func nativeJavaScriptCommand(')
end = source.index('\n}\n', start) + 3
helper = source[start:end]
(temporary/'NativeBridgeTests.swift').write_text('import AppKit\nimport WebKit\n' + helper + '\n' + (root/'tests/NativeBridgeTests.swift').read_text())
PY
xcrun swiftc -O -target "$(uname -m)-apple-macos12.0" -framework AppKit -framework WebKit "$TEST_DIR/NativeBridgeTests.swift" -o "$TEST_DIR/native-bridge-tests"
"$TEST_DIR/native-bridge-tests"
