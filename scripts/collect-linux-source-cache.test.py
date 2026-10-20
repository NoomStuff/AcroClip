import hashlib
import importlib.util
import io
import json
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("cached_collector", Path(__file__).with_name("collect-linux-sources.py"))
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


class VerifiedDownloadCacheTest(unittest.TestCase):
    def test_cross_job_reuse_checks_authoritative_digest_and_size(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = b"immutable source"
            digest = hashlib.sha256(data).hexdigest()
            with patch.dict(os.environ, {"ACROCLIP_SOURCE_DOWNLOAD_CACHE": str(root / "cache")}):
                with patch.object(collector.urllib.request, "urlopen", return_value=io.BytesIO(data)) as network:
                    collector.download("https://example.org/source", root / "job1/source", digest, len(data))
                    self.assertEqual(network.call_count, 1)
                with patch.object(collector.urllib.request, "urlopen", side_effect=AssertionError("Cache hit must not fetch")):
                    collector.download("https://example.org/source", root / "job2/source", digest, len(data))
                self.assertEqual((root / "job2/source").read_bytes(), data)

    def test_changed_cache_is_rejected_and_replaced_only_with_verified_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = b"official bytes"
            digest = hashlib.sha256(data).hexdigest()
            cached = root / "cache" / digest[:2] / digest
            cached.parent.mkdir(parents=True)
            cached.write_bytes(b"changed bytes!")
            with patch.dict(os.environ, {"ACROCLIP_SOURCE_DOWNLOAD_CACHE": str(root / "cache")}), patch.object(collector.urllib.request, "urlopen", return_value=io.BytesIO(data)) as network:
                collector.download("https://example.org/source", root / "source", digest, len(data))
            self.assertEqual(network.call_count, 1)
            self.assertEqual(cached.read_bytes(), data)

    def test_failed_input_never_enters_cache_or_completed_target(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            digest = hashlib.sha256(b"expected").hexdigest()
            with patch.dict(os.environ, {"ACROCLIP_SOURCE_DOWNLOAD_CACHE": str(root / "cache")}), patch.object(collector.urllib.request, "urlopen", return_value=io.BytesIO(b"wrong")):
                with self.assertRaisesRegex(ValueError, "Checksum mismatch"):
                    collector.download("https://example.org/source", root / "source", digest, 8)
            self.assertFalse((root / "source").exists())
            self.assertFalse((root / "cache" / digest[:2] / digest).exists())
            self.assertFalse(list(root.glob("*.pending")))

    def test_correct_hash_does_not_override_wrong_expected_size(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = b"exact"
            with patch.dict(os.environ, {"ACROCLIP_SOURCE_DOWNLOAD_CACHE": str(root / "cache")}), patch.object(collector.urllib.request, "urlopen", return_value=io.BytesIO(data)):
                with self.assertRaisesRegex(ValueError, "size mismatch"):
                    collector.download("https://example.org/source", root / "source", hashlib.sha256(data).hexdigest(), len(data) + 1)
            self.assertFalse((root / "source").exists())

    def test_concurrent_identical_downloads_share_one_verified_cache_write(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = b"shared exact source"
            digest = hashlib.sha256(data).hexdigest()
            with patch.dict(os.environ, {"ACROCLIP_SOURCE_DOWNLOAD_CACHE": str(root / "cache")}), patch.object(collector.urllib.request, "urlopen", side_effect=lambda *args, **kwargs: io.BytesIO(data)) as network:
                with ThreadPoolExecutor(max_workers=4) as workers:
                    list(workers.map(lambda index: collector.download("https://example.org/source", root / str(index), digest, len(data)), range(8)))
                self.assertEqual(network.call_count, 1)
            self.assertTrue(all((root / str(index)).read_bytes() == data for index in range(8)))

    def test_connection_retries_stop_after_four_attempts(self):
        with patch.object(collector.urllib.request, "urlopen", side_effect=TimeoutError), patch.object(collector.time, "sleep") as pause:
            with self.assertRaisesRegex(RuntimeError, "four attempts"):
                collector.source_response("https://example.org/source", timeout=1)
            self.assertEqual(pause.call_count, 3)

    def test_publication_metadata_is_memoized_only_in_process_and_copied(self):
        collector._official_json.cache_clear()
        with patch.object(collector.urllib.request, "urlopen", side_effect=lambda *args, **kwargs: io.BytesIO(json.dumps({"entries": [{"version": "1"}]}).encode())) as network:
            first = collector.official_json("https://api.launchpad.net/1.0/fixture")
            first["entries"][0]["version"] = "rewritten"
            self.assertEqual(collector.official_json("https://api.launchpad.net/1.0/fixture")["entries"][0]["version"], "1")
            self.assertEqual(network.call_count, 1)
        collector._official_json.cache_clear()


if __name__ == "__main__":
    unittest.main()
