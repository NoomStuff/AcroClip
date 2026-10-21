import unittest
from macos_fixture_health import stable_audio_output


class ReadinessTests(unittest.TestCase):
    def records(self):
        return [dict(event="audio-health", engineRunning=True, monotonicSeconds=10 + index,
                     renderedFrames=48000 * index, renderedToneFrames=46000 * index) for index in range(3)]

    def test_requires_sustained_non_silent_rendering(self):
        self.assertTrue(stable_audio_output(self.records()))
        self.assertFalse(stable_audio_output(self.records()[:2]))
        self.assertFalse(stable_audio_output([dict(event="ready", audioStarted=True)]))

    def test_rejects_a_running_engine_without_tone_output(self):
        records = self.records()
        for record in records:
            record["renderedToneFrames"] = 0
        self.assertFalse(stable_audio_output(records))

    def test_rejects_stalled_or_underfed_callbacks(self):
        for rate in (0, 24000):
            records = self.records()
            for index, record in enumerate(records):
                record["renderedFrames"] = rate * index
                record["renderedToneFrames"] = int(rate * 0.96) * index
            self.assertFalse(stable_audio_output(records))

    def test_rejects_invalid_clocks_and_stopped_engines(self):
        for key, value in (("monotonicSeconds", float("nan")), ("monotonicSeconds", 10), ("engineRunning", False), ("renderedFrames", "48000")):
            records = self.records()
            records[-1][key] = value
            self.assertFalse(stable_audio_output(records))


if __name__ == "__main__":
    unittest.main()
