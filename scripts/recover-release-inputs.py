#!/usr/bin/env python3
"""Recover hash-verified immutable inputs from a published source packet."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import urllib.request
import urllib.error
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--platform", required=True, choices=["windows-x64", "linux-x64", "darwin-arm64"])
parser.add_argument("--release", default="v0.2.0")
parser.add_argument("--destination", required=True)
args = parser.parse_args()
root = Path(args.destination).resolve()
if root.exists() and any(root.iterdir()):
    raise ValueError("Source destination must be empty")
headers = {"User-Agent": "AcroClip-source-inputs", "Accept": "application/vnd.github+json"}
if os.environ.get("GITHUB_TOKEN"):
    headers["Authorization"] = "Bearer " + os.environ["GITHUB_TOKEN"]
release = None
for tag in (args.release + "-sources", args.release):
    request = urllib.request.Request("https://api.github.com/repos/NoomStuff/AcroClip/releases/tags/" + tag, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            release = json.load(response)
        break
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
if release is None:
    raise ValueError("No corresponding source release was found")
assets = [asset for asset in release["assets"] if "-" + args.platform + "-sources-" in asset["name"] and asset["name"].endswith(".zip")]
if len(assets) != 1 or not assets[0].get("digest", "").startswith("sha256:"):
    raise ValueError("Published source packet has no unique verified digest")
asset = assets[0]
cache = Path(".cache/release-inputs")
cache.mkdir(parents=True, exist_ok=True)
archive = cache / Path(asset["name"]).name
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
