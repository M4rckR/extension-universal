#!/bin/sh
# Arma el .zip para subir a la Chrome Web Store con SOLO los archivos que la
# extensión usa en tiempo de ejecución — nada de docs, referencia/, .claude/,
# .impeccable/ ni este directorio. Uso: sh store/package.sh
set -e
cd "$(dirname "$0")/.."

VERSION=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' manifest.json)
OUT="dist/alloyscope-$VERSION.zip"

mkdir -p dist
rm -f "$OUT"
zip -q -X -r "$OUT" \
  manifest.json background.js content.js inject.js popup.html popup.js i18n.js \
  _locales \
  assets/icon16.png assets/icon32.png assets/icon48.png assets/icon128.png \
  assets/icon48.svg \
  assets/fonts

echo "Listo: $OUT"
unzip -l "$OUT" | tail -n +4 | sed '$d' | sed '$d'
