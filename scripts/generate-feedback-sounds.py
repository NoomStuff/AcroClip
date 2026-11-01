"""Generate original temporary notification tones using only the standard library.

Replace resources/feedback/*.wav with the final sounds when they are ready.
"""

import math
from pathlib import Path
import struct
import wave


SAMPLE_RATE = 48000
OUTPUT = Path(__file__).resolve().parents[1] / "resources" / "feedback"
TONES = {
    "clip-saving": [(660, 0.09), (880, 0.12)],
    "clip-saved": [(880, 0.09), (1320, 0.17)],
    "recording-starting": [(440, 0.12)],
    "recording-started": [(550, 0.08), (825, 0.15)],
    "recording-stopped": [(825, 0.08), (550, 0.15)],
    "critical-error": [(330, 0.13), (0, 0.06), (277, 0.19)],
}


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for name, notes in TONES.items():
        samples = bytearray()
        for frequency, duration in notes:
            count = round(duration * SAMPLE_RATE)
            for index in range(count):
                time = index / SAMPLE_RATE
                attack = min(1.0, time / 0.006)
                release = min(1.0, (count - 1 - index) / (SAMPLE_RATE * 0.035))
                envelope = attack * release
                sample = 0.18 * envelope * math.sin(2 * math.pi * frequency * time)
                samples.extend(struct.pack("<h", round(sample * 32767)))
        with wave.open(str(OUTPUT / f"{name}.wav"), "wb") as sound:
            sound.setnchannels(1)
            sound.setsampwidth(2)
            sound.setframerate(SAMPLE_RATE)
            sound.writeframes(samples)
        print(f"Generated {name}.wav")


if __name__ == "__main__":
    main()
