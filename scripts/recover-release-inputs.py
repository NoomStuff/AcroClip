#!/usr/bin/env python3
"""Recover hash-verified immutable inputs from a published source packet."""
import argparse
import hashlib
import json
import os
import re
from pathlib import Path, PurePosixPath
import shutil
import stat
import urllib.request
import urllib.error
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--platform", required=True, choices=["windows-x64", "linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64"])
parser.add_argument("--release", default="v0.2.0")
parser.add_argument("--destination", required=True)
args = parser.parse_args()
root = Path(args.destination).resolve()
if root.exists() and any(root.iterdir()):
    raise ValueError("Source destination must be empty")
headers = {"User-Agent": "AcroClip-source-inputs", "Accept": "application/vnd.github+json"}
if os.environ.get("GITHUB_TOKEN"):
    headers["Authorization"] = "Bearer " + os.environ["GITHUB_TOKEN"]
if args.release == "latest":
    request = urllib.request.Request("https://api.github.com/repos/NoomStuff/AcroClip/releases/latest", headers=headers)
    with urllib.request.urlopen(request, timeout=60) as response:
        current = json.load(response)
    if current.get("draft") or current.get("prerelease") or not re.fullmatch(r"v\d+\.\d+\.\d+", current.get("tag_name", "")):
        raise ValueError("Recover inputs only from a published stable release")
    args.release = current["tag_name"]


def api(path):
    request = urllib.request.Request("https://api.github.com/repos/NoomStuff/AcroClip/" + path, headers=headers)
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


# Since 0.23.0 sources ship on the app release itself. Earlier versions kept them
# in a "<tag>-sources" or "<tag>-sources-<key>" prerelease of the same commit.
public_name = "AcroClip-sources-" + args.platform.replace("darwin-", "macos-") + ".zip"
releases = []
for page in range(1, 11):
    batch = api("releases?per_page=100&page=" + str(page))
    releases += batch
    if len(batch) < 100:
        break
candidates = [item for item in releases if not item.get("draft") and (
    item["tag_name"] == args.release or item["tag_name"] == args.release + "-sources" or item["tag_name"].startswith(args.release + "-sources-"))]
assets = [asset for item in candidates for asset in item["assets"] if asset["name"] == public_name or (
    item["tag_name"] != args.release and "-" + args.platform + "-sources-" in asset["name"] and asset["name"].endswith(".zip"))]
if len(assets) != 1 or not assets[0].get("digest", "").startswith("sha256:"):
    raise ValueError("Published source packet has no unique verified digest")
asset = assets[0]
cache = Path(".cache/release-inputs")
cache.mkdir(parents=True, exist_ok=True)
# Public source names carry no version, so the cache key adds the release tag.
archive = cache / (args.release + "-" + Path(asset["name"]).name)
if not archive.exists():
    with urllib.request.urlopen(asset["browser_download_url"], timeout=120) as response, archive.open("wb") as target:
        shutil.copyfileobj(response, target)
with archive.open("rb") as source:
    digest = hashlib.file_digest(source, "sha256").hexdigest()
if "sha256:" + digest != asset["digest"] or archive.stat().st_size != asset["size"]:
    raise ValueError("Published source packet bytes differ")
with zipfile.ZipFile(archive) as bundle:
    for entry in bundle.infolist():
        path = PurePosixPath(entry.filename)
        if path.is_absolute() or ".." in path.parts or "\\" in entry.filename or ":" in entry.filename or stat.S_ISLNK(entry.external_attr >> 16):
            raise ValueError("Unsafe source archive member")
    root.mkdir(parents=True, exist_ok=True)
    bundle.extractall(root)
print(json.dumps({"packet": asset["name"], "sha256": digest, "destination": str(root)}))
