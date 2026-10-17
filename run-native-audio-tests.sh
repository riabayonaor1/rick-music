#!/bin/bash
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/partitura-audio-tests.XXXXXX")"
trap 'rm -rf "$TEST_DIR"' EXIT
cp "$PROJECT_DIR/tests/NativeAudioTests.swift" "$TEST_DIR/NativeAudioTests.swift"
xcrun swiftc -O -framework AVFoundation -framework AudioToolbox "$TEST_DIR/NativeAudioTests.swift" -o "$TEST_DIR/native-audio-tests"
"$TEST_DIR/native-audio-tests"
