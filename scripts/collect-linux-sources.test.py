import importlib.util
import io
from pathlib import Path
import tarfile
import hashlib
import unittest
import urllib.error
from unittest.mock import patch
import tempfile

spec = importlib.util.spec_from_file_location("collector", Path(__file__).with_name("collect-linux-sources.py"))
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


class SourceEvidenceTest(unittest.TestCase):
    def test_runner_mirror_transport_keeps_suites_and_signed_index_keys(self):
        source = "Types: deb deb-src\nURIs: mirror+file:/etc/apt/apt-mirrors.txt\nSuites: noble noble-updates noble-security\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n"
        result = collector.concrete_repository_sources(source)
        self.assertEqual(result.splitlines(), ["Types: deb deb-src", "URIs: https://archive.ubuntu.com/ubuntu", "Suites: noble noble-updates noble-security", "Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg"])
        self.assertEqual(collector.concrete_repository_sources(result), result)

    def test_retry_still_requires_the_exact_expected_source_digest(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "source.tar.xz"
            content = b"exact source bytes"
            unavailable = urllib.error.HTTPError("https://example.org/source", 503, "Unavailable", None, None)
            with patch.object(collector.urllib.request, "urlopen", side_effect=[unavailable, io.BytesIO(content)]) as request, patch.object(collector.time, "sleep"):
                collector.download("https://example.org/source", target, hashlib.sha256(content).hexdigest())
                self.assertEqual(request.call_count, 2)
            self.assertEqual(target.read_bytes(), content)
            with patch.object(collector.urllib.request, "urlopen", return_value=io.BytesIO(b"different bytes")):
                with self.assertRaisesRegex(ValueError, "Checksum mismatch"):
                    collector.download("https://example.org/source", target, "0" * 64)
            self.assertEqual(target.read_bytes(), content)

    def test_compiler_only_packages_include_their_notice_owner(self):
        with tempfile.TemporaryDirectory() as temporary:
            docs = Path(temporary)
            base = docs / "gcc-13-base"
            base.mkdir()
            (base / "copyright").write_text("compiler license")
            (docs / "gcc-13").symlink_to(base, target_is_directory=True)
            groups = {("gcc-13", "13.3"): []}

            def query(args):
                if args[1] == "-S":
                    return f"gcc-13-base:amd64: {args[2]}\n"
                return "Package: gcc-13-base\nVersion: 13.3\n"

            with patch.object(collector, "run", side_effect=query):
                collector.include_copyright_owners(groups, docs)
            self.assertEqual(groups, {("gcc-13", "13.3"): [], ("gcc-13-base:amd64", "13.3"): []})

    def test_source_version_preserves_epoch_and_binary_revision_difference(self):
        record = collector.paragraphs("Package: libfoo\nVersion: 2:1.2-4build1\nSource: foo (2:1.2-4)\nChecksums-Sha256:\n abc 3 foo.tar.xz\n def 4 foo.dsc\n")[0]
        self.assertEqual(collector.source_identity(record), ("foo", "2:1.2-4"))
        self.assertEqual(record["Checksums-Sha256"].strip(), "abc 3 foo.tar.xz\ndef 4 foo.dsc")

    def test_binary_member_bytes_and_symlink_are_proven_without_extracting(self):
        data = io.BytesIO()
        content = b"actual bundled code"
        with tarfile.open(fileobj=data, mode="w") as archive:
            member = tarfile.TarInfo("./usr/lib/libfoo.so.1.2")
            member.size = len(content)
            archive.addfile(member, io.BytesIO(content))
            link = tarfile.TarInfo("./usr/lib/libfoo.so.1")
            link.type = tarfile.SYMTYPE
            link.linkname = "libfoo.so.1.2"
            archive.addfile(link)
        expected = hashlib.sha256(content).hexdigest()
        self.assertEqual(collector.match_member(data.getvalue(), "libfoo.so.1", expected), "./usr/lib/libfoo.so.1.2")
        self.assertIsNone(collector.match_member(data.getvalue(), "libfoo.so.1", "0" * 64))

    def test_package_default_source_is_exact_binary_version(self):
        self.assertEqual(collector.source_identity({"Package": "foo", "Version": "1.2+dfsg-1"}), ("foo", "1.2+dfsg-1"))

    def test_manifest_paths_cannot_read_outside_packet(self):
        with self.assertRaises(ValueError):
            collector.evidence_path(Path("/tmp/acroclip-source-test"), "../private")
        with self.assertRaises(ValueError):
            collector.evidence_path(Path("/tmp/acroclip-source-test"), "/etc/passwd")

    def test_upstream_archive_names_cannot_escape_download_directory(self):
        self.assertEqual(collector.archive_name("foo_1.2-3ubuntu0~24.04.1.tar.xz"), "foo_1.2-3ubuntu0~24.04.1.tar.xz")
        for name in ["../secret", "/etc/passwd", "foo/bar", ".."]:
            with self.assertRaises(ValueError):
                collector.archive_name(name)


if __name__ == "__main__":
    unittest.main()
