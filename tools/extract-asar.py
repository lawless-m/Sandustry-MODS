#!/usr/bin/env python3
"""Unpack Sandustry's app.asar so the game's JavaScript can be read.

    tools/extract-asar.py              # everything -> ./_game/
    tools/extract-asar.py bundle.js    # just files whose name matches

The game is Electron, so all of its logic is readable (minified, not obfuscated)
JavaScript. Files worth reading:

    dist/js/bundle.js              main thread: UI, structures, the sandkit api
    dist/js/simulation-worker.js   the sand/fluid simulation
    workshop-mods.js               mod loader + manifest validator
    local-mod-publisher.js         Workshop upload flow
    main.js                        Electron main process, paths, IPC
"""
import json
import os
import struct
import sys

ASAR = os.path.expanduser(
    "~/.local/share/Steam/steamapps/common/Sandustry/resources/app.asar"
)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "_game")


def main():
    pattern = sys.argv[1] if len(sys.argv) > 1 else None

    if not os.path.exists(ASAR):
        sys.exit(f"app.asar not found at {ASAR}")

    with open(ASAR, "rb") as f:
        _, _, _, header_size = struct.unpack("<4I", f.read(16))
        header = json.loads(f.read(header_size).decode("utf8").rstrip("\0"))
        base = 16 + header_size

        written = 0

        def walk(node, path=""):
            nonlocal written
            for name, entry in node.get("files", {}).items():
                rel = f"{path}/{name}".lstrip("/")
                if "files" in entry:
                    walk(entry, rel)
                    continue
                # Some entries live in app.asar.unpacked rather than the archive.
                if "offset" not in entry:
                    continue
                if pattern and pattern not in name:
                    continue
                dest = os.path.join(OUT, rel)
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                f.seek(base + int(entry["offset"]))
                data = f.read(entry["size"])
                # asar pads the header; PNGs and friends can start a few bytes late.
                if name.lower().endswith(".png"):
                    sig = data.find(b"\x89PNG")
                    if sig > 0:
                        data = data[sig:]
                with open(dest, "wb") as out:
                    out.write(data)
                written += 1

        walk(header)

    print(f"wrote {written} files to {os.path.normpath(OUT)}")
    if not written and pattern:
        print(f"(nothing matched {pattern!r})")


if __name__ == "__main__":
    main()
