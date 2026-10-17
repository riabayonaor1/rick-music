#!/bin/bash
# Run only after configuring a Developer ID Application signing identity and an
# existing notarytool Keychain profile. No credentials are written by this script.
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_DIR="$(dirname "$PROJECT_DIR")"
: "${SIGNING_IDENTITY:?Configura SIGNING_IDENTITY con tu certificado Developer ID Application.}"
: "${NOTARY_PROFILE:?Configura NOTARY_PROFILE con el nombre de un perfil existente de notarytool.}"
ZIP_PATH="$OUTPUT_DIR/Rick-Music-macOS.zip"
if [[ ! -f "$ZIP_PATH" ]]; then
  echo "Primero ejecuta build-macos.sh para crear el ZIP universal." >&2
  exit 1
fi
BUILD_DIR="$(mktemp -d /private/tmp/rickmusic-notary.XXXXXX)"
trap 'rm -rf "$BUILD_DIR"' EXIT
RELEASE_DIR="$BUILD_DIR/Release"
mkdir -p "$RELEASE_DIR" "$BUILD_DIR/verified"
ditto -x -k --noextattr --norsrc "$ZIP_PATH" "$RELEASE_DIR"
APP_PATH="$RELEASE_DIR/Rick Music.app"
BINARY="$APP_PATH/Contents/MacOS/Rick Music"
xcrun lipo "$BINARY" -verify_arch arm64 x86_64
codesign --force --options runtime --timestamp --sign "$SIGNING_IDENTITY" "$APP_PATH"
codesign --verify --all-architectures --deep --strict "$APP_PATH"
codesign --display --verbose=4 "$APP_PATH" > "$BUILD_DIR/signature.txt" 2>&1
if ! /usr/bin/grep -q '^Authority=Developer ID Application:' "$BUILD_DIR/signature.txt"; then
  echo "La identidad usada no es Developer ID Application. No se enviará a Apple." >&2
  exit 1
fi
ditto -c -k --keepParent --norsrc "$APP_PATH" "$BUILD_DIR/submission.zip"
# Sends this application to Apple's notarization service using the existing
# profile. The app archive contains no user scores or private credentials.
xcrun notarytool submit "$BUILD_DIR/submission.zip" --keychain-profile "$NOTARY_PROFILE" \
  --wait --output-format json > "$BUILD_DIR/notary-result.json"
/usr/bin/python3 - "$BUILD_DIR/notary-result.json" <<'PY'
import json,sys
result=json.load(open(sys.argv[1]))
print('Notarización:', result.get('status', 'Sin estado'))
if result.get('status') != 'Accepted':
    print('Apple no aceptó la notarización. Consulta el informe con el ID:', result.get('id','no disponible'), file=sys.stderr)
    raise SystemExit(1)
PY
xcrun stapler staple "$APP_PATH"
xcrun stapler validate "$APP_PATH"
codesign --verify --all-architectures --deep --strict "$APP_PATH"
spctl --assess --type execute --verbose=2 "$APP_PATH"
cat > "$RELEASE_DIR/LEEME.txt" <<'TXT'
RICK MUSIC 0.2 — INSTALACIÓN EN MAC

Descomprime Rick-Music-macOS.zip y arrastra «Rick Music.app» a Aplicaciones.
Abre la aplicación desde Aplicaciones. Conserva una copia de tus partituras.

Esta copia está firmada con Developer ID Application, notarizada por Apple y
contiene el ticket de notarización adjunto. El proceso comprobó codesign,
stapler y la evaluación de Gatekeeper antes de generar este ZIP.

Compatibilidad prevista: macOS 12.0 o posterior; Apple Silicon e Intel de 64 bits.
La aplicación funciona localmente y sin conexión. La prueba de distribución en
el equipo de compilación no sustituye una prueba real en el Mac de destino.

Los documentos propios usan .rickmusic; se conserva lectura de .partitura.
Consulta el LEEME del proyecto para los formatos de intercambio y sus límites.
Rick Music es un editor independiente; no es una distribución de Finale.
TXT
{
  echo "Rick Music 0.2 — Validación de distribución"
  echo "Arquitecturas:"
  xcrun lipo -archs "$BINARY"
  echo "Firma:"
  cat "$BUILD_DIR/signature.txt"
  echo "Notarización aceptada:"
  cat "$BUILD_DIR/notary-result.json"
  echo "Ticket adjunto:"
  xcrun stapler validate "$APP_PATH"
  echo "Gatekeeper:"
  spctl --assess --type execute --verbose=2 "$APP_PATH" 2>&1
} > "$RELEASE_DIR/VALIDACION.txt"
ditto -c -k --norsrc "$RELEASE_DIR" "$BUILD_DIR/Rick-Music-macOS.zip"
ditto -x -k --noextattr --norsrc "$BUILD_DIR/Rick-Music-macOS.zip" "$BUILD_DIR/verified"
VERIFIED_APP="$BUILD_DIR/verified/Rick Music.app"
codesign --verify --all-architectures --deep --strict "$VERIFIED_APP"
xcrun lipo "$VERIFIED_APP/Contents/MacOS/Rick Music" -verify_arch arm64 x86_64
xcrun stapler validate "$VERIFIED_APP"
spctl --assess --type execute --verbose=2 "$VERIFIED_APP"
ditto --noextattr --norsrc "$BUILD_DIR/Rick-Music-macOS.zip" "$OUTPUT_DIR/.Rick-Music-macOS.zip.new.$$"
mv -f "$OUTPUT_DIR/.Rick-Music-macOS.zip.new.$$" "$ZIP_PATH"
APP_OUTPUT="$OUTPUT_DIR/Rick Music.app"
if [[ -e "$APP_OUTPUT" ]]; then rm -rf "$APP_OUTPUT"; fi
ditto --noextattr --norsrc "$VERIFIED_APP" "$APP_OUTPUT"
echo "ZIP firmado, notarizado, extraído y verificado: $ZIP_PATH"
