import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("inputs", Path(__file__).with_name("prepare-linux-cli-inputs.py"))
inputs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inputs)


class RestoreSourceInputsTest(unittest.TestCase):
    def fixture(self, root):
        packet = root / "packet"
        (packet / "controlled-cli/build").mkdir(parents=True)
        (packet / "controlled-cli/sources").mkdir()
        archives = []
        for name in ["ffmpeg", "x264", "dav1d", "zlib"]:
            data = (name + " exact source").encode()
            relative = name + ".tar.gz"
            (packet / "controlled-cli/sources" / relative).write_bytes(data)
            archives.append({"path": relative, "sha256": hashlib.sha256(data).hexdigest(), "size": len(data)})
        build = {"producer": "acroclip-controlled-linux", "target": "linux-x64", "sourceArchives": archives, "sourceCommits": {name: "a" * 40 for name in ["ffmpeg", "x264", "dav1d", "zlib"]}}
        (packet / "controlled-cli/build/build-manifest.json").write_text(json.dumps(build))
        return packet

    def mac_fixture(self, root):
        packet = self.fixture(root)
        old = packet / "controlled-cli/build/build-manifest.json"
        build = json.loads(old.read_text())
        build.update(producer="acroclip-controlled-macos", target="macos-arm64")
        (packet / "controlled-cli/build-manifest.json").write_text(json.dumps(build))
        old.unlink()
        records = []
        for name in ["obs.tar.gz", "obs-license.txt"]:
            data = (name + " exact bytes").encode()
            (packet / name).write_bytes(data)
            records.append({"path": name, "sha256": hashlib.sha256(data).hexdigest(), "size": len(data)})
        (packet / "obs-inputs.json").write_text(json.dumps({"sources": [{**records[0], "licenses": [records[1]]}], "dependencySources": []}))
        return packet

    def test_restore_mac_obs_sources_and_licenses_with_controlled_cli_inputs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            packet = self.mac_fixture(root)
            inputs.prepare(packet, root / "app")
            target = root / "app/work/release-sources"
            self.assertEqual((target / "obs-license.txt").read_bytes(), b"obs-license.txt exact bytes")
            self.assertEqual((target / "ffmpeg.tar.gz").read_bytes(), b"ffmpeg exact source")
            self.assertEqual(len(json.loads((target / "manifest.json").read_text())["sources"]), 2)

    def test_reject_changed_mac_obs_license(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            packet = self.mac_fixture(root)
            (packet / "obs-license.txt").write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "Mac OBS source input changed"):
                inputs.prepare(packet, root / "app")

    def test_restore_then_reject_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            packet = self.fixture(root)
            project = root / "app"
            inputs.prepare(packet, project)
            self.assertEqual((project / "work/release-sources/ffmpeg.tar.gz").read_bytes(), b"ffmpeg exact source")
            manifest = json.loads((project / "work/release-sources/manifest.json").read_text())
            self.assertEqual(manifest["sources"][0]["repository"], "FFmpeg/FFmpeg")
            self.assertEqual(len(manifest["dependencySources"]), 3)
            with self.assertRaisesRegex(ValueError, "overwrite"):
                inputs.prepare(packet, project)

    def test_reject_changed_input(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            packet = self.fixture(root)
            (packet / "controlled-cli/sources/ffmpeg.tar.gz").write_bytes(b"changed source")
            with self.assertRaisesRegex(ValueError, "changed"):
                inputs.prepare(packet, root / "app")


if __name__ == "__main__":
    unittest.main()
