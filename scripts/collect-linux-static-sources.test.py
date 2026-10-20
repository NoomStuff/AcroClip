import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("parallel_static", Path(__file__).with_name("collect-linux-static-sources.py"))
sources = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sources)


class StaticCollectionTest(unittest.TestCase):
    def setUp(self):
        cache = tempfile.TemporaryDirectory()
        self.addCleanup(cache.cleanup)
        environment = patch.dict(os.environ, {"ACROCLIP_SOURCE_DOWNLOAD_CACHE": cache.name})
        environment.start()
        self.addCleanup(environment.stop)

    def fixture(self, root, workers=2):
        info = root / "history/build/binary.buildinfo"
        info.parent.mkdir(parents=True)
        info.write_text("Source: ffmpeg\nVersion: 1\nInstalled-Build-Depends: liba (= 1), libb (= 1), libc (= 1), libd (= 1)\n")
        return SimpleNamespace(output=str(root), buildinfo=str(info), packages="lib.*", append=False, workers=workers)

    def metadata(self, root, owner, version):
        data = (owner + " official source").encode()
        name = owner + ".tar.xz"
        return {"Package": owner, "Version": version}, {"Checksums-Sha256": f"{hashlib.sha256(data).hexdigest()} {len(data)} {name}"}, "", {name: "https://example.org/" + owner}

    def response(self, request, **kwargs):
        return io.BytesIO((request.full_url.rsplit("/", 1)[-1] + " official source").encode())

    def test_worker_limit_and_single_writer_preserve_every_successful_record(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            args = self.fixture(root)
            barrier = threading.Barrier(2)
            guard = threading.Lock()
            active = peak = 0
            def metadata(*args):
                nonlocal active, peak
                with guard:
                    active += 1
                    peak = max(peak, active)
                barrier.wait(timeout=5)
                result = self.metadata(*args)
                with guard:
                    active -= 1
                return result
            with patch.object(sources.collector, "historical_inputs", side_effect=metadata), patch.object(sources.collector.urllib.request, "urlopen", side_effect=self.response):
                self.assertEqual(sources.collect(args), 0)
            self.assertEqual(peak, 2)
            manifest = json.loads((root / "static/build/manifest.json").read_text())
            self.assertEqual(len(manifest["packages"]), 4)
            self.assertEqual(manifest["blockers"], [])
            self.assertFalse(list(root.rglob("*.pending")))

    def test_failed_input_is_not_accepted_and_retry_resumes_verified_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            args = self.fixture(root)
            def first_metadata(root, owner, version):
                if owner == "libb":
                    raise RuntimeError("server unavailable")
                return self.metadata(root, owner, version)
            with patch.object(sources.collector.urllib.request, "urlopen", side_effect=self.response) as network:
                with patch.object(sources.collector, "historical_inputs", side_effect=first_metadata):
                    self.assertEqual(sources.collect(args), 1)
                manifest = json.loads((root / "static/build/manifest.json").read_text())
                self.assertEqual(len(manifest["packages"]), 3)
                self.assertEqual(len(manifest["blockers"]), 1)
                self.assertFalse((root / "static/build/libb/libb.tar.xz").exists())
                with patch.object(sources.collector, "historical_inputs", side_effect=self.metadata) as publications:
                    self.assertEqual(sources.collect(args), 0)
                    self.assertEqual(publications.call_count, 4)
                self.assertEqual(network.call_count, 4)
            self.assertEqual(json.loads((root / "static/build/manifest.json").read_text())["blockers"], [])

    def test_forged_checkpoint_cannot_authorize_changed_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            args = self.fixture(root)
            with patch.object(sources.collector, "historical_inputs", side_effect=self.metadata), patch.object(sources.collector.urllib.request, "urlopen", side_effect=self.response):
                self.assertEqual(sources.collect(args), 0)
                file = root / "static/build/liba/liba.tar.xz"
                file.write_bytes(b"changed source")
                manifest_path = root / "static/build/manifest.json"
                manifest = json.loads(manifest_path.read_text())
                manifest["packages"][0]["sourceArchives"][0]["sha256"] = hashlib.sha256(file.read_bytes()).hexdigest()
                manifest_path.write_text(json.dumps(manifest))
                args.append = True
                self.assertEqual(sources.collect(args), 0)
            self.assertEqual(file.read_bytes(), b"liba official source")

    def test_unbounded_worker_counts_fail_before_collecting(self):
        for count in (0, 9, 1000):
            with self.assertRaisesRegex(ValueError, "between 1 and 8"):
                sources.collect(SimpleNamespace(workers=count))


if __name__ == "__main__":
    unittest.main()
