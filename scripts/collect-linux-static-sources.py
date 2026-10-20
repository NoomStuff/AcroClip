#!/usr/bin/env python3
"""Capture exact static/header source packages from an actual Ubuntu build-info file."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import importlib.util
import json
from pathlib import Path
import re
import sys
import time

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location("collector", Path(__file__).with_name("collect-linux-sources.py"))
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


def capture_package(root, destination, owner, version):
    started = time.monotonic()
    print(f"Static source start {owner}={version}", flush=True)
    binary, source_record, _, urls = collector.historical_inputs(root, owner, version)
    source, source_version = collector.source_identity(binary)
    folder = destination / re.sub(r"[^a-zA-Z0-9._-]", "_", owner)
    folder.mkdir(parents=True, exist_ok=True)
    archives = []
    for line in source_record["Checksums-Sha256"].splitlines():
        if not line.strip():
            continue
        sha256, size, name = line.split()
        collector.archive_name(name)
        collector.download(urls[name], folder / name, sha256, int(size))
        archives.append({"path": str((folder / name).relative_to(root)), "sha256": sha256, "size": int(size), "url": urls[name]})
    print(f"Static source done {owner}={version}, {time.monotonic() - started:.1f}s", flush=True)
    return {"binaryPackage": owner, "binaryVersion": version, "sourcePackage": source, "sourceVersion": source_version, "sourceArchives": archives}


def checkpoint(destination, manifest):
    # Only the coordinator writes the manifest. A stopped worker cannot leave
    # a partial JSON record that a later run mistakes for a completed input.
    target = destination / "manifest.json"
    pending = target.with_suffix(".json.pending")
    pending.write_text(json.dumps(manifest, indent=2) + "\n")
    pending.replace(target)


def collect(args):
    workers = getattr(args, "workers", 4)
    if not 1 <= workers <= 8:
        raise ValueError("Static source workers must be between 1 and 8")
    root = Path(args.output).resolve()
    info = Path(args.buildinfo).resolve()
    if not info.is_relative_to(root):
        raise ValueError("Build-info must remain inside source packet")
    record = next(record for record in collector.paragraphs(info.read_text()) if "Installed-Build-Depends" in record)
    dependencies = re.findall(r"(?:^|[\n,])\s*([^\s,(]+)\s*\(= ([^)]+)\)", record["Installed-Build-Depends"])
    selected = [(name, version) for name, version in dependencies if re.fullmatch(args.packages, name)]
    if not selected:
        raise ValueError("No requested exact dependencies in actual build-info")
    destination = root / "static" / info.parent.name
    destination.mkdir(parents=True, exist_ok=True)
    manifest = {"buildinfo": {"path": str(info.relative_to(root)), "sha256": collector.digest(info), "sourcePackage": record["Source"], "sourceVersion": record["Version"]}, "selection": args.packages, "packages": [], "blockers": []}
    if args.append and (destination / "manifest.json").exists():
        previous = json.loads((destination / "manifest.json").read_text())
        if previous["buildinfo"] != manifest["buildinfo"]:
            raise ValueError("Cannot append inputs from a different actual build-info file")
        if any((package["binaryPackage"], package["binaryVersion"]) not in set(dependencies) for package in previous["packages"]):
            raise ValueError("Checkpoint includes a package absent from the actual build-info")
        manifest["packages"] = previous["packages"]
        manifest["blockers"] = previous["blockers"]
        manifest["selection"] = "(?:" + previous["selection"] + ")|(?:" + args.packages + ")"
    # Append is also revalidated against current official metadata. A cached
    # manifest never authorizes trusting its own rewritten archive checksums.
    selected = sorted(set(selected + [(item["binaryPackage"], item["binaryVersion"]) for item in manifest["packages"]]))
    manifest["packages"] = []
    manifest["blockers"] = []
    print(f"Collect {len(selected)} exact static inputs with {workers} workers; verified archive downloads resume from disk/cache", flush=True)
    with ThreadPoolExecutor(max_workers=workers) as executor:
        pending = {executor.submit(capture_package, root, destination, owner, version): (owner, version) for owner, version in selected}
        for completed, future in enumerate(as_completed(pending), 1):
            owner, version = pending[future]
            try:
                manifest["packages"].append(future.result())
                manifest["packages"].sort(key=lambda package: (package["binaryPackage"], package["binaryVersion"]))
            except Exception as error:
                manifest["blockers"].append(f"{owner}={version}: {error}")
                print(f"Static source failed {owner}={version}: {error}", flush=True)
            checkpoint(destination, manifest)
            print(f"Static source progress {completed}/{len(selected)}, {len(manifest['blockers'])} blockers", flush=True)
    print(f"Captured {len(manifest['packages'])} exact static/header package sources, {len(manifest['blockers'])} blockers", flush=True)
    return 1 if manifest["blockers"] else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    parser.add_argument("--buildinfo", required=True)
    parser.add_argument("--packages", required=True, help="Full-match regex selecting actual installed build dependencies")
    parser.add_argument("--append", action="store_true", help="Retain previously captured inputs from the same build-info")
    parser.add_argument("--workers", type=int, default=4, help="Concurrent independent packages, between 1 and 8")
    raise SystemExit(collect(parser.parse_args()))
