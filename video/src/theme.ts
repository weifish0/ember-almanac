import { loadFont as loadFraunces } from "@remotion/google-fonts/Fraunces";
import { loadFont as loadInstrument } from "@remotion/google-fonts/InstrumentSans";
import { Easing, interpolate } from "remotion";

export const display = loadFraunces("normal", { weights: ["500", "600"], subsets: ["latin"] }).fontFamily;
export const text = loadInstrument("normal", { weights: ["400", "500", "600"], subsets: ["latin"] }).fontFamily;

export const C = {
  soot: "#14100e",
  soot2: "#221b17",
  paper: "#f4ecdc",
  paperDeep: "#e9dfca",
  ink: "#2a1d17",
  inkSoft: "#7a6657",
  onSoot: "#f1e7d4",
  onSootSoft: "#b3a48e",
  ember: "#de6220",
  emberDeep: "#a8321c",
  straw: "#f0a43e",
  modis: "#cdbfa8",
};

export const FPS = 30;
export const sec = (s: number) => Math.round(s * FPS);

const out = Easing.bezier(0.22, 1, 0.36, 1);
/** 0 -> 1 between two frames, eased out, clamped. */
export const ramp = (frame: number, from: number, to: number, easing = out) =>
  interpolate(frame, [from, to], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing });
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Voice-over clips: file, absolute start (s), and the caption shown for each stretch. */
export const VO = [
  { file: "vo/s1_t.wav", at: 0.3, lines: [[0, "Every day, NASA satellites record where Earth burns."], [3.85, "But that record is split in two."]] },
  { file: "vo/s2_t.wav", at: 6.15, lines: [[0, "MODIS sees coarse pixels."], [2.1, "VIIRS sees four times more fire."], [4.5, "Splice them, and history breaks."]] },
  { file: "vo/s3_t.wav", at: 13.15, lines: [[0, "Ember Almanac learns a local exchange rate where they overlap,"], [3.45, "and rebuilds one consistent record."]] },
  { file: "vo/s4_t.wav", at: 18.55, lines: [[0, "Draw any area to read its burning calendar:"], [3.3, "when fire peaks,"], [4.55, "and which years broke the pattern."]] },
  { file: "vo/s5_t.wav", at: 25.3, lines: [[0, "Ember Almanac."], [1.4, "One fire record, for any place on Earth."]] },
] as const;
export const VO_LENGTH = [5.63, 6.81, 5.23, 6.19, 3.87];
