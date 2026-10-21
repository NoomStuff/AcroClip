"""Readiness of the independent synthetic tone producer, before capture starts."""
import math
from collections.abc import Mapping, Sequence
from typing import cast


def stable_audio_output(events: Sequence[Mapping[str, object]]) -> bool:
    health = [event for event in events if event.get("event") == "audio-health"][-3:]
    if len(health) != 3 or any(event.get("engineRunning") is not True for event in health):
        return False
    fields = ("monotonicSeconds", "renderedFrames", "renderedToneFrames")
    for event in health:
        for field in fields:
            value = event.get(field)
            if type(value) not in (int, float) or not math.isfinite(float(cast(int | float, value))):
                return False
    for previous, current in zip(health, health[1:]):
        elapsed = float(cast(float, current["monotonicSeconds"])) - float(cast(float, previous["monotonicSeconds"]))
        frames = int(cast(int, current["renderedFrames"])) - int(cast(int, previous["renderedFrames"]))
        tone = int(cast(int, current["renderedToneFrames"])) - int(cast(int, previous["renderedToneFrames"]))
        if elapsed < 0.5 or elapsed > 2.5 or not 43200 <= frames / elapsed <= 52800:
            return False
        if not 0.9 <= tone / frames <= 1.02:
            return False
    return True
