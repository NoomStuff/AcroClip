import math
import unittest
from audio_tone import tone_peak


class ToneTests(unittest.TestCase):
    def signal(self, tones):
        return [sum(amplitude * math.sin(2 * math.pi * frequency * index / 48000 + phase)
                    for frequency, amplitude, phase in tones) for index in range(48000)]

    def test_recovers_amplitude_with_device_clock_drift_and_arbitrary_phase(self):
        for frequency in (1611.8, 1613, 1614.25):
            peak = tone_peak(self.signal([(frequency, 0.28, 1.7)]), 48000, 1613)
            self.assertAlmostEqual(peak["amplitude"], 0.28, delta=0.012)
            self.assertAlmostEqual(peak["frequency"], frequency, delta=0.26)

    def test_preserves_half_gain_ratio_across_independent_clock_offsets(self):
        baseline = tone_peak(self.signal([(996.8, 0.28, 0.3)]), 48000, 997)
        quieter = tone_peak(self.signal([(997.25, 0.14, 2.1)]), 48000, 997)
        self.assertAlmostEqual(quieter["amplitude"] / baseline["amplitude"], 0.5, delta=0.025)

    def test_measures_leaked_decoy_independently_of_selected_tone(self):
        samples = self.signal([(997.1, 0.28, 0.2), (1611.8, 0.07, 2.0)])
        selected = tone_peak(samples, 48000, 997)["amplitude"]
        decoy = tone_peak(samples, 48000, 1613)["amplitude"]
        self.assertGreater(decoy, selected / 8)
        self.assertAlmostEqual(decoy, 0.07, delta=0.003)

    def test_silence_and_unrelated_tones_do_not_supply_the_expected_tone(self):
        self.assertEqual(tone_peak([0.0] * 48000, 48000, 1613)["amplitude"], 0)
        for frequency in (997, 1633):
            self.assertLess(tone_peak(self.signal([(frequency, 0.28, 0.2)]), 48000, 1613)["amplitude"], 0.005)

    def test_retains_low_amplitude_instead_of_normalizing_a_muted_track(self):
        self.assertLess(tone_peak(self.signal([(1612.1, 0.001, 0.7)]), 48000, 1613)["amplitude"], 0.005)

    def test_startup_silence_still_reduces_measured_amplitude(self):
        samples = self.signal([(997, 0.28, 0)])
        samples[:12000] = [0.0] * 12000
        self.assertAlmostEqual(tone_peak(samples, 48000, 997)["amplitude"], 0.21, delta=0.001)

    def test_phase_changes_do_not_cancel_a_continuous_tone(self):
        samples = self.signal([(997, 0.28, 0)])
        samples[24000:] = [-value for value in samples[24000:]]
        self.assertGreater(tone_peak(samples, 48000, 997)["amplitude"] / 0.28, 0.8)
        self.assertLess(tone_peak(samples, 48000, 997)["amplitude"] / 0.28, 1.2)

    def test_phase_changes_still_expose_gain_errors_and_leaked_audio(self):
        samples = self.signal([(997, 0.14, 0), (1613, 0.07, 1)])
        samples[24000:] = [-value for value in samples[24000:]]
        selected = tone_peak(samples, 48000, 997)["amplitude"]
        leaked = tone_peak(samples, 48000, 1613)["amplitude"]
        self.assertLess(selected / 0.28, 0.8)
        self.assertGreater(leaked, selected / 8)

    def test_silent_blocks_and_partial_final_block_remain_in_measurement(self):
        samples = self.signal([(997, 0.28, 0)])[:45599]
        samples[:24000] = [0.0] * 24000
        self.assertAlmostEqual(tone_peak(samples, 48000, 997)["amplitude"],
                               0.28 * (len(samples) - 24000) / len(samples), delta=0.002)


if __name__ == "__main__":
    unittest.main()
