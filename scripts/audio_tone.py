"""Measure fixture tones despite small differences between device clocks."""
import math
from collections.abc import Sequence
from typing import TypedDict


class TonePeak(TypedDict):
    frequency: float
    amplitude: float


def tone_peak(samples: Sequence[float], sample_rate: int, nominal: int) -> TonePeak:
    if len(samples) < 3 or sample_rate <= 0:
        raise ValueError("A tone measurement requires audio samples and a positive sample rate")
    # Device resampling and delayed callbacks can change phase within a clip.
    # A single coherent projection then cancels parts of the same audible tone.
    # Average independently measured 200 ms blocks, weighted by sample count.
    # Include every block, including silence, rather than selecting good audio.
    block_size = max(3, sample_rate // 5)
    peaks: list[tuple[int, TonePeak]] = []
    offset = 0
    while offset < len(samples):
        end = min(len(samples), offset + block_size)
        if len(samples) - end < 3:
            end = len(samples)
        peaks.append((end - offset, _window_peak(samples[offset:end], sample_rate, nominal)))
        offset = end
    amplitude = sum(count * peak["amplitude"] for count, peak in peaks) / len(samples)
    frequency = (sum(count * peak["amplitude"] * peak["frequency"] for count, peak in peaks)
                 / (amplitude * len(samples))) if amplitude else float(nominal)
    return dict(frequency=frequency, amplitude=amplitude)


def _window_peak(samples: Sequence[float], sample_rate: int, nominal: int) -> TonePeak:
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
    # The fixture tones are hundreds of Hz apart. This fixed +/-4 Hz band measures each
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
