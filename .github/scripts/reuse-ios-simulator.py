"""Reuse a simulator app only when its embedded revision has identical runtime sources."""

import argparse
import hashlib
import json
import plistlib
import re
import struct
import subprocess
from pathlib import Path


def revision_in(app):
    revisions = set()
    for path in app.rglob("*"):
        if path.suffix not in {".jsbundle", ".hbc", ".js"}:
            continue
        data = path.read_bytes()
        for encoding in ("utf-8", "utf-16-le"):
            prefix = 'concors-source-revision" content="'.encode(encoding)
            position = data.find(prefix)
            if position < 0:
                continue
            size = 2 if encoding == "utf-16-le" else 1
            value = data[position + len(prefix):position + len(prefix) + 47 * size]
            value = value.decode(encoding, errors="replace")
            match = re.match(r'([0-9a-f]{40})(?:-dirty)?"', value)
            if match:
                revisions.add(match[1])
    return next(iter(revisions)) if len(revisions) == 1 else None


def digest(app):
    value = hashlib.sha256()
    files = sorted(p for p in app.rglob("*") if p.is_file())
    for path in files:
        value.update(str(path.relative_to(app)).encode() + b"\0")
        value.update(struct.pack("<Q", path.stat().st_size))
        value.update(path.read_bytes())
    return value.hexdigest()


def reusable(app, bundle, arch, record=False):
    info = plistlib.loads((app / "Info.plist").read_bytes())
    if info.get("CFBundleIdentifier") != bundle:
        return {"reuse": False, "reason": "bundle-mismatch"}
    binary = (app / info["CFBundleExecutable"]).read_bytes()[:8]
    cpu = {"x86_64": 0x01000007, "arm64": 0x0100000C}[arch]
    if len(binary) != 8 or binary[:4] != b"\xcf\xfa\xed\xfe" or struct.unpack("<I", binary[4:])[0] != cpu:
        return {"reuse": False, "reason": "architecture-mismatch"}
    revision = revision_in(app)
    if not revision:
        return {"reuse": False, "reason": "source-stamp-missing"}
    # Asset generation rewrites these tracked PNGs using the runner's libvips. Their SVG/TSX
    # sources, generator and dependency lock remain part of the comparison.
    generated = ["icon", "adaptive-icon", "notification-icon", "splash", "splash-dark",
                 "codex", "claude", "opencode"]
    result = subprocess.run([
        "git", "diff", "--quiet", revision, "--", ".",
        ":(exclude).github", ":(exclude)docs", ":(exclude)AGENTS.md",
        ":(exclude)apps/mobile/e2e/native", ":(exclude)apps/mobile/release",
        *[f":(exclude)apps/mobile/assets/{name}.png" for name in generated],
    ], capture_output=True)
    if result.returncode != 0:
        return {"reuse": False, "reason": "runtime-change-or-missing-history"}
    metadata = app.parent / (app.name + ".source.json")
    expected = {"revision": revision, "digest": digest(app)}
    if record:
        metadata.write_text(json.dumps(expected) + "\n")
        return {"recorded": True, "embeddedRevision": revision}
    if not metadata.exists() or json.loads(metadata.read_text()) != expected:
        return {"reuse": False, "reason": "verified-artifact-record-missing-or-mismatched"}
    return {"reuse": True, "embeddedRevision": revision, "reason": "runtime-sources-and-artifact-match"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("app", type=Path)
    parser.add_argument("--bundle", default="xyz.hologram.concors.preview")
    parser.add_argument("--arch", choices=["x86_64", "arm64"], default="x86_64")
    parser.add_argument("--github-output", type=Path)
    parser.add_argument("--record", action="store_true")
    args = parser.parse_args()
    try:
        result = reusable(args.app, args.bundle, args.arch, args.record)
    except (OSError, ValueError, KeyError, plistlib.InvalidFileException):
        result = {"reuse": False, "reason": "cached-app-unavailable"}
    if args.github_output:
        with args.github_output.open("a") as output:
            output.write("reuse=" + str(result["reuse"]).lower() + "\n")
    print(json.dumps(result))
