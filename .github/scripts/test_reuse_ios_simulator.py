import importlib.util
import os
import plistlib
import struct
import subprocess
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("cache", Path(__file__).with_name("reuse-ios-simulator.py"))
cache = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cache)


class CacheRules(unittest.TestCase):
    def setUp(self):
        self.previous = Path.cwd()
        self.temporary = tempfile.TemporaryDirectory()
        root = Path(self.temporary.name)
        repo = root / "repo"
        repo.mkdir()
        os.chdir(repo)
        self.git("init", "-q")
        Path("runtime.ts").write_text("export const value = 1;\n")
        Path(".github").mkdir()
        Path(".github/workflow.yml").write_text("original")
        self.git("add", ".")
        self.git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "Initial")
        self.revision = self.git("rev-parse", "HEAD").strip()
        self.app = root / "Preview.app"
        self.app.mkdir()
        with (self.app / "Info.plist").open("wb") as file:
            plistlib.dump({"CFBundleIdentifier": "preview", "CFBundleExecutable": "Preview"}, file)
        (self.app / "Preview").write_bytes(b"\xcf\xfa\xed\xfe" + struct.pack("<I", 0x01000007))
        # libvips-regenerated PNGs can mark an otherwise unchanged build dirty.
        (self.app / "main.jsbundle").write_bytes(
            ('<meta name="concors-source-revision" content="' + self.revision + '-dirty">').encode("utf-16-le")
        )

    def tearDown(self):
        os.chdir(self.previous)
        self.temporary.cleanup()

    def git(self, *args):
        return subprocess.check_output(["git", *args], stderr=subprocess.DEVNULL, text=True)

    def check(self, record=False):
        return cache.reusable(self.app, "preview", "x86_64", record)

    def test_unrecorded_cache_cannot_be_reused(self):
        self.assertFalse(self.check()["reuse"])

    def test_workflow_only_changes_keep_a_verified_app_reusable(self):
        self.assertTrue(self.check(record=True)["recorded"])
        Path(".github/workflow.yml").write_text("changed runner instructions")
        self.assertTrue(self.check()["reuse"])

    def test_runtime_edits_prevent_reuse_and_recording(self):
        self.check(record=True)
        Path("runtime.ts").write_text("export const value = 2;\n")
        self.assertFalse(self.check()["reuse"])
        self.assertFalse(self.check(record=True).get("recorded", False))

    def test_changed_binary_is_not_the_recorded_artifact(self):
        self.check(record=True)
        with (self.app / "Preview").open("ab") as file:
            file.write(b"changed")
        self.assertFalse(self.check()["reuse"])

    def test_other_bundle_and_architecture_are_rejected(self):
        self.check(record=True)
        self.assertFalse(cache.reusable(self.app, "production", "x86_64")["reuse"])
        self.assertFalse(cache.reusable(self.app, "preview", "arm64")["reuse"])

    def test_unknown_source_revision_is_not_trusted(self):
        (self.app / "main.jsbundle").write_bytes(
            ('concors-source-revision" content="' + "a" * 40 + '">').encode()
        )
        self.assertFalse(self.check()["reuse"])


if __name__ == "__main__":
    unittest.main()
