import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("static_inputs", Path(__file__).with_name("linux-source-inputs.py"))
inputs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inputs)


class StaticBuildSelectionTest(unittest.TestCase):
    def fixture(self, root):
        packages = [
            {"binaryPackage": "libobs-dev", "binaryVersion": "1", "sourcePackage": "obs-studio", "sourceVersion": "1"},
            {"binaryPackage": "obs-studio", "binaryVersion": "1", "sourcePackage": "obs-studio", "sourceVersion": "1"},
            {"binaryPackage": "libavcodec60:arm64", "binaryVersion": "2", "sourcePackage": "ffmpeg", "sourceVersion": "2"},
        ]
        (root / "manifest.json").write_text(json.dumps({"packages": packages}))
        records = []
        for package in packages[1:]:
            identifier = hashlib.sha256((package["binaryPackage"] + "=" + package["binaryVersion"]).encode()).hexdigest()[:16]
            file = root / "history" / identifier / "binary.buildinfo"
            file.parent.mkdir(parents=True)
            file.write_text(f"Source: {package['sourcePackage']}\nVersion: {package['sourceVersion']}\nInstalled-Build-Depends: libsimde-dev (= 1)\n")
            records.append(file)
        return records

    def test_uses_captured_runtime_build_instead_of_uncaptured_development_package(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = self.fixture(root)
            self.assertEqual([record[2] for record in inputs.selected_builds(root)], files)

    def test_rejects_missing_build_for_a_required_source_family(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = self.fixture(root)
            files[0].unlink()
            with self.assertRaisesRegex(ValueError, "Missing actual build evidence"):
                inputs.selected_builds(root)

    def test_rejects_build_info_from_another_source_version(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = self.fixture(root)
            files[0].write_text("Source: obs-studio\nVersion: 99\nInstalled-Build-Depends: libsimde-dev (= 1)\n")
            with self.assertRaisesRegex(ValueError, "another actual source build"):
                inputs.selected_builds(root)


if __name__ == "__main__":
    unittest.main()
