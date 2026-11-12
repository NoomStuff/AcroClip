// OBS Studio's audio filters, run by the recorder. Defaults are OBS's own.
// Ranges are the useful part of OBS's, which native/audio-filters.cpp accepts in full.
interface AudioFilterParameter {
   key: string;
   label: string;
   min: number;
   max: number;
   step: number;
   default: number;
   unit: string;
   // OBS reads these settings as whole numbers.
   integer?: boolean;
}
interface AudioFilterChoice {
   key: string;
   label: string;
   values: readonly { value: string; label: string }[];
}
interface AudioFilterPreset {
   label: string;
   settings: Record<string, number | string>;
}
export interface AudioFilterDefinition {
   label: string;
   detail: string;
   parameters: readonly AudioFilterParameter[];
   choices?: readonly AudioFilterChoice[];
   presets?: readonly AudioFilterPreset[];
}
const db = (key: string, label: string, min: number, max: number, value: number, step = 0.1): AudioFilterParameter => ({
   key,
   label,
   min,
   max,
   step,
   default: value,
   unit: " dB",
});
const ms = (key: string, label: string, min: number, max: number, value: number): AudioFilterParameter => ({
   key,
   label,
   min,
   max,
   step: 1,
   default: value,
   unit: " ms",
   integer: true,
});
const ratio = (min: number, max: number, value: number, step: number): AudioFilterParameter => ({
   key: "ratio",
   label: "Ratio",
   min,
   max,
   step,
   default: value,
   unit: ":1",
});
export const audioFilterKinds = [
   "noise-suppression",
   "noise-gate",
   "gain",
   "compressor",
   "limiter",
   "expander",
   "upward-compressor",
   "equalizer",
   "invert-polarity",
] as const;
export type AudioFilterKind = (typeof audioFilterKinds)[number];
export const audioFilterDefinitions: Record<AudioFilterKind, AudioFilterDefinition> = {
   "noise-suppression": { label: "Noise suppression", detail: "Removes steady background noise with RNNoise.", parameters: [] },
   "noise-gate": {
      label: "Noise gate",
      detail: "Silences the source until it is louder than the open threshold.",
      parameters: [
         db("close_threshold", "Close threshold", -60, 0, -32, 1),
         db("open_threshold", "Open threshold", -60, 0, -26, 1),
         ms("attack_time", "Attack", 0, 100, 25),
         ms("hold_time", "Hold", 0, 1000, 200),
         ms("release_time", "Release", 0, 1000, 150),
      ],
   },
   gain: { label: "Gain", detail: "Boosts or reduces the level before the fader.", parameters: [db("db", "Gain", -30, 30, 0)] },
   compressor: {
      label: "Compressor",
      detail: "Reduces loud peaks so the level stays even.",
      parameters: [
         ratio(1, 20, 10, 0.5),
         db("threshold", "Threshold", -60, 0, -18),
         ms("attack_time", "Attack", 1, 100, 6),
         ms("release_time", "Release", 1, 1000, 60),
         db("output_gain", "Output gain", -20, 20, 0),
      ],
   },
   limiter: {
      label: "Limiter",
      detail: "Keeps the level from exceeding the threshold.",
      parameters: [db("threshold", "Threshold", -30, 0, -6), ms("release_time", "Release", 1, 500, 60)],
   },
   expander: {
      label: "Expander",
      detail: "Lowers quiet sounds below the threshold.",
      parameters: [
         ratio(1, 10, 2, 0.1),
         db("threshold", "Threshold", -60, 0, -40),
         ms("attack_time", "Attack", 1, 100, 10),
         ms("release_time", "Release", 1, 500, 50),
         db("output_gain", "Output gain", -20, 20, 0),
      ],
      choices: [
         {
            key: "detector",
            label: "Detection",
            values: [
               { value: "RMS", label: "RMS" },
               { value: "peak", label: "Peak" },
            ],
         },
      ],
      presets: [
         { label: "Expander", settings: { ratio: 2, threshold: -40, attack_time: 10, release_time: 50, output_gain: 0, detector: "RMS" } },
         { label: "Gate", settings: { ratio: 10, threshold: -40, attack_time: 10, release_time: 125, output_gain: 0, detector: "RMS" } },
      ],
   },
   "upward-compressor": {
      label: "Upward compressor",
      detail: "Raises quiet sounds toward the threshold.",
      parameters: [
         ratio(0, 1, 0.5, 0.01),
         db("threshold", "Threshold", -60, 0, -20),
         ms("attack_time", "Attack", 1, 100, 10),
         ms("release_time", "Release", 1, 500, 50),
         db("output_gain", "Output gain", -20, 20, 0),
         { key: "knee_width", label: "Knee", min: 0, max: 20, step: 1, default: 10, unit: " dB", integer: true },
      ],
   },
   equalizer: {
      label: "3-band equalizer",
      detail: "Adjusts low, mid and high frequencies.",
      parameters: [db("low", "Low", -20, 20, 0), db("mid", "Mid", -20, 20, 0), db("high", "High", -20, 20, 0)],
   },
   "invert-polarity": { label: "Invert polarity", detail: "Flips the waveform, which can fix phase cancellation.", parameters: [] },
};
export const maxAudioFilters = 8;
export interface AudioFilter {
   id: string;
   kind: AudioFilterKind;
   enabled: boolean;
   settings: Record<string, number | string>;
}
export function defaultAudioFilterSettings(kind: AudioFilterKind): Record<string, number | string> {
   const definition = audioFilterDefinitions[kind];
   return Object.fromEntries([
      ...definition.parameters.map((parameter) => [parameter.key, parameter.default] as const),
      ...(definition.choices ?? []).map((choice) => [choice.key, choice.values[0]!.value] as const),
   ]);
}
export function createAudioFilter(kind: AudioFilterKind, id: string): AudioFilter {
   return { id, kind, enabled: true, settings: defaultAudioFilterSettings(kind) };
}
