#!/bin/bash
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEST_DIR="$(mktemp -d /private/tmp/rickmusic-audio-export-tests.XXXXXX)"
trap 'rm -rf "$TEST_DIR"' EXIT
python3 - "$PROJECT_DIR" "$TEST_DIR" <<'PY'
from pathlib import Path
import sys
root, temporary = map(Path, sys.argv[1:])
source = (root/'native/Partitura.swift').read_text()
start = source.index('final class NativeAudioExporter {')
end = source.index('// Receive external MIDI devices', start)
(temporary/'NativeAudioExportTests.swift').write_text('import Foundation\nimport AVFoundation\nimport AudioToolbox\n' + source[start:end] + '\n' + (root/'tests/NativeAudioExportTests.swift').read_text())
PY
xcrun swiftc -O -target "$(uname -m)-apple-macos12.0" -framework AVFoundation -framework AudioToolbox "$TEST_DIR/NativeAudioExportTests.swift" -o "$TEST_DIR/native-audio-export-tests"
"$TEST_DIR/native-audio-export-tests" "$@"
