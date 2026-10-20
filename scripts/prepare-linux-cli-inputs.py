#!/usr/bin/env python3
"""Restore controlled CLI inputs and matching Mac OBS inputs from a verified source packet."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil


def prepare(packet, project):
    mac = (packet / "controlled-cli/build-manifest.json").is_file()
    manifest = "controlled-cli/build-manifest.json" if mac else "controlled-cli/build/build-manifest.json"
    build = json.loads((packet / manifest).read_text())
    producer = "acroclip-controlled-macos" if mac else "acroclip-controlled-linux"
    targets = {"macos-arm64", "macos-x64"} if mac else {"linux-x64", "linux-arm64"}
    if build["producer"] != producer or build["target"] not in targets or len(build["sourceArchives"]) != 4:
        raise ValueError("Unexpected controlled source recipe")
    root = project / "work/release-sources"
    if (root / "manifest.json").exists():
        raise ValueError("Input manifest already exists. Do not overwrite another platform's packet")
    origins = ["https://github.com/FFmpeg/FFmpeg", "https://code.videolan.org/videolan/x264.git", "https://code.videolan.org/videolan/dav1d.git", "https://github.com/madler/zlib.git"]
    sources = []
    dependencies = []
    if mac:
        obs = json.loads((packet / "obs-inputs.json").read_text())
        sources = obs["sources"]
        dependencies = obs["dependencySources"]
        for item in [*sources, *dependencies]:
            for record in [item, *item["licenses"]]:
                source = (packet / record["path"]).resolve()
                target = (root / record["path"]).resolve()
                if not source.is_relative_to(packet) or not target.is_relative_to(root.resolve()):
                    raise ValueError("Mac OBS input escapes its source folder")
                with source.open("rb") as stream:
                    actual = hashlib.file_digest(stream, "sha256").hexdigest()
                if actual != record["sha256"] or source.stat().st_size != record["size"]:
                    raise ValueError("Mac OBS source input changed")
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, target)
    for index, record in enumerate(build["sourceArchives"]):
        relative = record["path"]
        source = (packet / "controlled-cli/sources" / relative).resolve()
        target = (root / relative).resolve()
        if not source.is_relative_to((packet / "controlled-cli/sources").resolve()) or not target.is_relative_to(root.resolve()):
            raise ValueError("Source recipe path escapes its input folder")
        with source.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        if digest != record["sha256"] or source.stat().st_size != record["size"]:
            raise ValueError("Controlled source input changed")
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and target.read_bytes() != source.read_bytes():
            raise ValueError("An existing input has different bytes")
        shutil.copyfile(source, target)
        if index == 0:
            sources.append({**record, "repository": "FFmpeg/FFmpeg", "commit": build["sourceCommits"]["ffmpeg"]})
        else:
            name = ["ffmpeg", "x264", "dav1d", "zlib"][index]
            if not any(item["path"] == record["path"] and item["sha256"] == record["sha256"] for item in dependencies):
                dependencies.append({**record, "origin": origins[index], "resolvedRevision": build["sourceCommits"][name]})
    (root / "manifest.json").write_text(json.dumps({"sources": sources, "dependencySources": dependencies}, indent=2) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("packet")
    parser.add_argument("project")
    args = parser.parse_args()
    prepare(Path(args.packet).resolve(), Path(args.project).resolve())
