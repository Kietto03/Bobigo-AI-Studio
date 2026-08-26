#!/bin/bash
# ==============================================================================
# Bobigo AI Studio — Fetch self-hosted frontend vendor assets into web/vendor/
#
# The app is designed to run 100% offline: every JS library, icon font and text
# font is committed under web/vendor/. Run this once after cloning (or to bump
# versions), then commit the results.
#
# Usage: ./scripts/fetch_vendor.sh
# ==============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR="$ROOT/web/vendor"
mkdir -p "$VENDOR"

fetch() { # fetch <url> <dest>
    local url="$1" dest="$2"
    echo "⬇️  $dest"
    curl -fsSL --retry 3 --max-time 120 -o "$dest" "$url"
}

# ---------------------------------------------------------------- libraries --
mkdir -p "$VENDOR/hljs"
fetch "https://cdn.jsdelivr.net/npm/marked@15.0.12/marked.min.js"            "$VENDOR/marked.min.js"
fetch "https://cdn.jsdelivr.net/npm/dompurify@3.2.4/dist/purify.min.js"      "$VENDOR/purify.min.js"
fetch "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js" "$VENDOR/highlight.min.js"
fetch "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/tokyo-night-dark.min.css" "$VENDOR/hljs/tokyo-night-dark.min.css"
fetch "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css"           "$VENDOR/hljs/github.min.css"

# ------------------------------------------------------------- fontawesome ---
FA_VER="6.5.1"
mkdir -p "$VENDOR/fontawesome/css" "$VENDOR/fontawesome/webfonts"
fetch "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/$FA_VER/css/all.min.css" \
      "$VENDOR/fontawesome/css/all.min.css"
for f in fa-solid-900 fa-regular-400 fa-brands-400 fa-v4compatibility; do
    fetch "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/$FA_VER/webfonts/$f.woff2" \
          "$VENDOR/fontawesome/webfonts/$f.woff2"
    fetch "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/$FA_VER/webfonts/$f.ttf" \
          "$VENDOR/fontawesome/webfonts/$f.ttf"
done

# ------------------------------------------------------------------- fonts ---
# Plus Jakarta Sans (UI) & JetBrains Mono (code), weights 400–800,
# subsets: latin / latin-ext / vietnamese — served from the Fontsource CDN.
FONTS_CSS="$VENDOR/fonts/fonts.css"
mkdir -p "$VENDOR/fonts"
: > "$FONTS_CSS"
emit_face() { # emit_face <family-css-name> <fontsource-slug> <weight>
    local family="$1" slug="$2" weight="$3"
    for subset in vietnamese latin-ext latin; do
        local file="${slug}-${weight}-normal-${subset}.woff2"
        local range
        case "$subset" in
            vietnamese) range="U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB";;
            latin-ext)  range="U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";;
            latin)      range="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";;
        esac
        # Some fonts lack certain subsets (e.g. Pixelify Sans has no vietnamese)
        # — skip those instead of failing the whole fetch.
        if ! fetch "https://cdn.jsdelivr.net/fontsource/fonts/${slug}@latest/${subset}-${weight}-normal.woff2" \
                   "$VENDOR/fonts/$file"; then
            echo "⚠️  skipping $family $weight $subset (not published)"
            rm -f "$VENDOR/fonts/$file"
            continue
        fi
        cat >> "$FONTS_CSS" <<EOF
/* ${family} ${weight} ${subset} */
@font-face {
  font-family: '${family}';
  font-style: normal;
  font-weight: ${weight};
  font-display: swap;
  src: url('${file}') format('woff2');
  unicode-range: ${range};
}
EOF
    done
}

for w in 400 500 600 700 800; do
    emit_face "Plus Jakarta Sans" "plus-jakarta-sans" "$w"
    emit_face "JetBrains Mono"    "jetbrains-mono"    "$w"
done

# Pixel style skin ("style-pixel") renders the whole UI in a pixel font.
for w in 400 700; do
    emit_face "Pixelify Sans" "pixelify-sans" "$w"
done

echo ""
echo "✅ Vendor assets fetched into web/vendor/"