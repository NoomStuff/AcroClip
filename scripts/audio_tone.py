"""Measure fixture tones despite small differences between device clocks."""
import math
from collections.abc import Sequence
from typing import TypedDict


class TonePeak(TypedDict):
    frequency: float
    amplitude: float


def tone_peak(samples: Sequence[float], sample_rate: int, nominal: int) -> TonePeak:
    if len(samples) < 2 or sample_rate <= 0:
        raise ValueError("A tone measurement requires audio samples and a positive sample rate")
    weights = [0.5 - 0.5 * math.cos(2 * math.pi * index / (len(samples) - 1)) for index in range(len(samples))]
    weighted = [value * weight for value, weight in zip(samples, weights)]
    window_scale = 2 / sum(weights)

    def amplitude_at(frequency: float) -> float:
        coefficient = 2 * math.cos(2 * math.pi * frequency / sample_rate)
        previous, older = 0.0, 0.0
        # Retain every decoded sample with equal weight, including startup
        # silence or missing audio. Do not trim or taper the captured interval.
        for value in samples:
            current = value + coefficient * previous - older
            older, previous = previous, current
        power = max(0.0, previous * previous + older * older - coefficient * previous * older)
        uniform_amplitude = 2 * math.sqrt(power) / len(samples)
        previous, older = 0.0, 0.0
        for value in weighted:
            current = value + coefficient * previous - older
            older, previous = previous, current
        power = max(0.0, previous * previous + older * older - coefficient * previous * older)
        # Reject leakage from unrelated tones with a second Hann projection.
        # It cannot increase the result above the uniformly weighted amplitude,
        # so tapering cannot hide startup silence or missing captured samples.
        return min(uniform_amplitude, window_scale * math.sqrt(power))

    peak: TonePeak = dict(frequency=float(nominal), amplitude=0.0)
    # The two fixtures are 616 Hz apart. This fixed +/-4 Hz band measures each
    # tone independently without treating a different tone as the expected one.
    for offset in range(-8, 9):
        frequency = nominal + offset * 0.5
        amplitude = amplitude_at(frequency)
        if amplitude > peak["amplitude"]:
            peak = dict(frequency=frequency, amplitude=amplitude)
    center = peak["frequency"]
    for offset in range(-10, 11):
        frequency = center + offset * 0.05
        if abs(frequency - nominal) > 4:
            continue
        amplitude = amplitude_at(frequency)
        if amplitude > peak["amplitude"]:
            peak = dict(frequency=frequency, amplitude=amplitude)
    return peak
