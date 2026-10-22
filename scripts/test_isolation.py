"""Prevent interactive Mac proofs from using the developer's desktop or audio."""
import os


def require_isolated_runner() -> None:
    if os.environ.get("GITHUB_ACTIONS") != "true" or os.environ.get("ACROCLIP_ISOLATED_TEST_RUNNER") != "github-hosted":
        raise RuntimeError("Interactive tests did not run. Run this exact revision in disposable macOS CI. No local source, desktop or audio was used or uploaded.")
