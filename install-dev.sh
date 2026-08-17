#!/usr/bin/env bash
# Copy every mod in this repo into Sandustry's local mods folder.
#
# NOTE: copy, not symlink. The loader calls realpath() on each folder and rejects
# anything resolving outside the mods root ("local_mod_folder_outside_root"),
# so a symlink back into this repo is silently skipped.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HOME/.config/sandustry/mods"

if pgrep -x sandustry >/dev/null 2>&1; then
	echo "Sandustry is running — mods are only scanned at launch. Quit it first." >&2
	exit 1
fi

mkdir -p "$DEST"

for dir in "$REPO"/*/; do
	[ -f "$dir/modinfo.json" ] || continue
	name="$(basename "$dir")"
	# workshop.json is written by the in-game publisher and ties the folder to an
	# existing Workshop item. Losing it makes the next publish create a SECOND item.
	keep=""
	if [ -f "$DEST/$name/workshop.json" ]; then
		keep="$(mktemp)"
		cp "$DEST/$name/workshop.json" "$keep"
	fi
	rm -rf "${DEST:?}/$name"
	cp -r "${dir%/}" "$DEST/$name"
	if [ -n "$keep" ] && [ ! -f "$DEST/$name/workshop.json" ]; then
		cp "$keep" "$DEST/$name/workshop.json"
		echo "  preserved workshop.json (published item id kept)"
	fi
	[ -n "$keep" ] && rm -f "$keep"
	[ -f "$dir/preview.png" ] || echo "  WARNING: no preview.png — publishing will fail (preview_missing)"
	echo "installed $name -> $DEST/$name"
done

echo
echo "Launch Sandustry (mods branch) and check the Mods screen."
echo "Errors + load diagnostics: Options -> Tools -> Debug Console."
