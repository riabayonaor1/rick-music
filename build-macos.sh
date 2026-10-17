#!/bin/bash
# Build the distribution in /private/tmp: File Provider can attach FinderInfo
# to bundles under Documents, invalidating signed resource seals.
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_DIR="$(dirname "$PROJECT_DIR")"
APP_NAME="Rick Music"
APP_DIR="$OUTPUT_DIR/$APP_NAME.app"
ZIP_PATH="$OUTPUT_DIR/Rick-Music-macOS.zip"
for input in dist/index.html native/Partitura.swift native/Info.plist native/AppIcon.icns native/SUPPORT.txt LEEME.txt TERCEROS.txt FUNCIONES.txt LICENSES/Bravura-OFL.txt; do
  if [[ ! -f "$PROJECT_DIR/$input" ]]; then
    echo "Falta $input; prepara la interfaz y el icono antes de empaquetar." >&2
    exit 1
  fi
done
BUILD_DIR="$(mktemp -d /private/tmp/rickmusic-build.XXXXXX)"
trap 'rm -rf "$BUILD_DIR"' EXIT
RELEASE_DIR="$BUILD_DIR/Release"
PACKAGE_DIR="$RELEASE_DIR/$APP_NAME.app"
BINARY="$PACKAGE_DIR/Contents/MacOS/$APP_NAME"
mkdir -p "$PACKAGE_DIR/Contents/MacOS" "$PACKAGE_DIR/Contents/Resources" "$BUILD_DIR/verified"
ditto --noextattr --norsrc "$PROJECT_DIR/native/Partitura.swift" "$BUILD_DIR/Partitura.swift"
for arch in arm64 x86_64; do
  xcrun swiftc -O -target "$arch-apple-macos12.0" \
    -framework AppKit -framework WebKit -framework PDFKit -framework AVFoundation -framework AudioToolbox -framework CoreMIDI \
    "$BUILD_DIR/Partitura.swift" -o "$BUILD_DIR/RickMusic-$arch"
done
xcrun lipo -create "$BUILD_DIR/RickMusic-arm64" "$BUILD_DIR/RickMusic-x86_64" -output "$BINARY"
xcrun lipo "$BINARY" -verify_arch arm64 x86_64
ditto --noextattr --norsrc "$PROJECT_DIR/native/Info.plist" "$PACKAGE_DIR/Contents/Info.plist"
ditto --noextattr --norsrc "$PROJECT_DIR/native/AppIcon.icns" "$PACKAGE_DIR/Contents/Resources/AppIcon.icns"
ditto --noextattr --norsrc "$PROJECT_DIR/dist" "$PACKAGE_DIR/Contents/Resources/Web"
ditto --noextattr --norsrc "$PROJECT_DIR/TERCEROS.txt" "$PACKAGE_DIR/Contents/Resources/TERCEROS.txt"
ditto --noextattr --norsrc "$PROJECT_DIR/LICENSES" "$PACKAGE_DIR/Contents/Resources/LICENSES"
ditto --noextattr --norsrc "$PROJECT_DIR/LEEME.txt" "$PACKAGE_DIR/Contents/Resources/LEEME.txt"
ditto --noextattr --norsrc "$PROJECT_DIR/FUNCIONES.txt" "$PACKAGE_DIR/Contents/Resources/FUNCIONES.txt"
# Ad-hoc signing seals this local build. It is not Developer ID signing or
# Apple notarization, and must never be described as a Gatekeeper-approved app.
codesign --force --sign - --timestamp=none "$PACKAGE_DIR"
codesign --verify --all-architectures --deep --strict "$PACKAGE_DIR"
ditto --noextattr --norsrc "$PROJECT_DIR/native/SUPPORT.txt" "$RELEASE_DIR/LEEME.txt"
ditto --noextattr --norsrc "$PROJECT_DIR/LEEME.txt" "$RELEASE_DIR/MANUAL.txt"
ditto --noextattr --norsrc "$PROJECT_DIR/FUNCIONES.txt" "$RELEASE_DIR/FUNCIONES.txt"
ditto --noextattr --norsrc "$PROJECT_DIR/TERCEROS.txt" "$RELEASE_DIR/TERCEROS.txt"
ditto --noextattr --norsrc "$PROJECT_DIR/LICENSES" "$RELEASE_DIR/LICENSES"
{
  echo "Rick Music 0.2 — Validación del paquete"
  echo "Sistemas previstos: macOS 12.0 o posterior, Apple Silicon e Intel de 64 bits."
  echo "Prueba realizada en este equipo; no constituye una prueba en otro Mac."
  echo "Arquitecturas incluidas:"
  xcrun lipo -archs "$BINARY"
  echo "Firma:"
  codesign --display --verbose=2 "$PACKAGE_DIR" 2>&1
  echo "Evaluación local de Gatekeeper:"
  if spctl --assess --type execute --verbose=2 "$PACKAGE_DIR" 2>&1; then
    echo "Evaluación aceptada en el equipo de compilación."
  else
    echo "Paquete sin Developer ID ni notarización: la distribución descargada puede quedar bloqueada."
  fi
} > "$RELEASE_DIR/VALIDACION.txt"
# Build the ZIP from the clean staging area, never from the delivered .app.
ditto -c -k --norsrc "$RELEASE_DIR" "$BUILD_DIR/Rick-Music-macOS.zip"
ditto -x -k --noextattr --norsrc "$BUILD_DIR/Rick-Music-macOS.zip" "$BUILD_DIR/verified"
VERIFIED_APP="$BUILD_DIR/verified/$APP_NAME.app"
codesign --verify --all-architectures --deep --strict "$VERIFIED_APP"
xcrun lipo "$VERIFIED_APP/Contents/MacOS/$APP_NAME" -verify_arch arm64 x86_64
plutil -lint "$VERIFIED_APP/Contents/Info.plist"
# Publish ZIP atomically only after extraction and signature verification.
ditto --noextattr --norsrc "$BUILD_DIR/Rick-Music-macOS.zip" "$OUTPUT_DIR/.Rick-Music-macOS.zip.new.$$"
mv -f "$OUTPUT_DIR/.Rick-Music-macOS.zip.new.$$" "$ZIP_PATH"
# This copy is convenient for this Mac; the verified ZIP is the distribution.
if [[ "${ZIP_ONLY:-0}" != "1" ]]; then
  if [[ -e "$APP_DIR" ]]; then rm -rf "$APP_DIR"; fi
  ditto --noextattr --norsrc "$PACKAGE_DIR" "$APP_DIR"
  echo "Aplicación universal creada: $APP_DIR"
else
  echo "Sólo ZIP: se conserva la aplicación local existente."
fi
echo "ZIP extraído y firma verificada para ambas arquitecturas: $ZIP_PATH"
echo "Estado de distribución: firma local ad-hoc; sin Developer ID ni notarización."
