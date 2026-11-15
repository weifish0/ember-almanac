import React from "react";
import { AbsoluteFill, Audio, Img, Sequence, staticFile, useCurrentFrame } from "remotion";
import { C, FPS, VO, VO_LENGTH, display, lerp, ramp, sec, text } from "./theme";
import { ChartScene } from "./ChartScene";
import { ProductScene } from "./ProductScene";

// Scene boundaries (frames) follow the voice-over.
export const CUT = { globe: 0, chart: sec(6.1), product: sec(18.5), end: sec(25.15), total: sec(29.8) };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const GLOBE_FRAMES = 180;

const Fade: React.FC<{ children: React.ReactNode; length: number; inFrames?: number; outFrames?: number }> = ({ children, length, inFrames = 8, outFrames = 8 }) => {
  const f = useCurrentFrame();
  const o = Math.min(inFrames ? ramp(f, 0, inFrames) : 1, outFrames ? 1 - ramp(f, length - outFrames, length) : 1);
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>;
};

const GlobeScene: React.FC = () => {
  const f = useCurrentFrame();
  const idx = Math.min(GLOBE_FRAMES - 1, f);
  const month = MONTHS[Math.min(11, Math.floor((idx / GLOBE_FRAMES) * 12))];
  const split = sec(0.3 + 3.85); // "But that record is split in two."
  const a = ramp(f, 6, 26);
  const b = ramp(f, split - 4, split + 14);
  const gap = ramp(f, split + 6, split + 30);
  const barW = 560;
  const cut = (11 / 25) * barW; // 2012 on a 2000-2025 axis
  return (
    <AbsoluteFill style={{ background: C.soot }}>
      <Img src={staticFile(`cap/globe/${String(idx).padStart(3, "0")}.jpg`)} style={{ width: "100%", height: "100%", transform: `scale(${lerp(1.04, 1, ramp(f, 0, 180, (t) => t))})`, transformOrigin: "70% 50%" }} />
      <AbsoluteFill style={{ background: `linear-gradient(90deg, ${C.soot} 0%, ${C.soot}e6 22%, ${C.soot}00 52%)` }} />
      <div style={{ position: "absolute", left: 110, top: 250, width: 760, color: C.onSoot }}>
        <div style={{ font: `600 22px ${text}`, letterSpacing: "0.14em", color: C.straw, opacity: a }}>NASA FIRMS · MODIS + VIIRS ACTIVE FIRES</div>
        <div style={{ position: "relative", height: 330, marginTop: 22 }}>
          <div style={{ position: "absolute", font: `500 98px/1.02 ${display}`, letterSpacing: "-0.025em", opacity: a * (1 - b), transform: `translateY(${lerp(24, 0, a) - 20 * b}px)` }}>
            Where Earth burns, every day since 2000.
          </div>
          <div style={{ position: "absolute", font: `500 98px/1.02 ${display}`, letterSpacing: "-0.025em", opacity: b, transform: `translateY(${lerp(26, 0, b)}px)` }}>
            But the record is split in two.
          </div>
        </div>
        {/* the two eras */}
        <div style={{ position: "relative", height: 90, marginTop: 34, opacity: b }}>
          <div style={{ position: "absolute", left: 0, top: 30, width: cut - gap * 16, height: 14, background: C.modis }} />
          <div style={{ position: "absolute", left: cut + gap * 16, top: 30, width: barW - cut - gap * 16, height: 14, background: C.ember }} />
          <div style={{ position: "absolute", left: 0, top: 0, font: `600 19px ${text}`, color: C.modis, letterSpacing: "0.06em" }}>MODIS · 2000</div>
          <div style={{ position: "absolute", left: cut + gap * 16, top: 0, font: `600 19px ${text}`, color: C.ember, letterSpacing: "0.06em" }}>VIIRS · 2012</div>
          <div style={{ position: "absolute", left: 0, top: 56, font: `500 18px ${text}`, color: C.onSootSoft }}>1 km pixels</div>
          <div style={{ position: "absolute", left: cut + gap * 16, top: 56, font: `500 18px ${text}`, color: C.onSootSoft }}>375 m pixels</div>
        </div>
      </div>
      <div style={{ position: "absolute", right: 90, top: 80, textAlign: "right", color: C.onSoot, opacity: a }}>
        <div style={{ font: `500 54px ${display}`, letterSpacing: "-0.01em" }}>{month}</div>
        <div style={{ font: `500 19px ${text}`, color: C.onSootSoft, marginTop: 2 }}>typical fire detections, harmonized record</div>
      </div>
    </AbsoluteFill>
  );
};

const EndScene: React.FC = () => {
  const f = useCurrentFrame();
  const a = ramp(f, 4, 24);
  const b = ramp(f, sec(1.3), sec(1.3) + 22);
  const c = ramp(f, sec(2.4), sec(2.4) + 22);
  return (
    <AbsoluteFill style={{ background: C.paper, color: C.ink }}>
      {/* a strip of the real burning calendar */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 250, overflow: "hidden", opacity: 0.95 }}>
        <Img src={staticFile("cap/panel.png")} style={{ position: "absolute", width: 780 * 3.06, left: -82 * 3.06, top: -(605 * 3.06) - lerp(0, 70, ramp(f, 0, 150, (t) => t)) }} />
        <div style={{ position: "absolute", inset: 0, background: `linear-gradient(180deg, ${C.paper}00 55%, ${C.paper} 100%)` }} />
      </div>
      <div style={{ position: "absolute", left: 130, top: 330 }}>
        <div style={{ font: `600 176px/1 ${display}`, letterSpacing: "-0.035em", opacity: a, transform: `translateY(${lerp(30, 0, a)}px)` }}>Ember Almanac</div>
        <div style={{ font: `500 54px/1.2 ${display}`, marginTop: 30, opacity: b, transform: `translateY(${lerp(20, 0, b)}px)` }}>One fire record, for any place on Earth.</div>
        <div style={{ display: "flex", gap: 46, alignItems: "baseline", marginTop: 74, opacity: c }}>
          <div style={{ font: `600 34px ${text}`, color: C.emberDeep }}>weifish0.github.io/ember-almanac</div>
          <div style={{ font: `500 22px ${text}`, color: C.inkSoft }}>Open source · open data</div>
        </div>
        <div style={{ width: 1660, borderTop: `2px solid ${C.ink}`, marginTop: 56, paddingTop: 18, font: `500 21px/1.5 ${text}`, color: C.inkSoft, opacity: c }}>
          Data: NASA FIRMS — MODIS Collection 6.1 and VIIRS 375 m (Suomi NPP, NOAA-20) active fires, 490,810,661 detections, Nov 2000 – Nov 2026 · Imagery: NASA GIBS Blue Marble
          <br />
          NASA Space Apps Challenge 2026 · Harmonization of MODIS and VIIRS Hot Spots
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Captions: React.FC = () => {
  const f = useCurrentFrame();
  const t = f / FPS;
  let line: string | null = null;
  VO.forEach((clip, i) => {
    clip.lines.forEach(([start, textLine], k) => {
      const from = clip.at + start;
      const to = k + 1 < clip.lines.length ? clip.at + clip.lines[k + 1][0] : clip.at + VO_LENGTH[i] + 0.25;
      if (t >= from && t < to) line = textLine;
    });
  });
  if (!line) return null;
  const onPaper = f >= CUT.end;
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 44, display: "flex", justifyContent: "center" }}>
      <div
        style={{
          font: `500 30px ${text}`, padding: "10px 22px 12px", borderRadius: 4,
          color: onPaper ? C.paper : C.onSoot, background: onPaper ? `${C.ink}e6` : "rgba(20,16,14,0.82)",
        }}
      >
        {line}
      </div>
    </div>
  );
};

export const Demo: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: C.soot }}>
      <Sequence name="Globe" from={CUT.globe} durationInFrames={CUT.chart - CUT.globe + 8}>
        <Fade length={CUT.chart - CUT.globe + 8} inFrames={10}>
          <GlobeScene />
        </Fade>
      </Sequence>
      <Sequence name="Two records" from={CUT.chart} durationInFrames={CUT.product - CUT.chart + 8}>
        <Fade length={CUT.product - CUT.chart + 8}>
          <ChartScene />
        </Fade>
      </Sequence>
      <Sequence name="Product" from={CUT.product} durationInFrames={CUT.end - CUT.product + 8}>
        <Fade length={CUT.end - CUT.product + 8}>
          <ProductScene />
        </Fade>
      </Sequence>
      <Sequence name="End card" from={CUT.end} durationInFrames={CUT.total - CUT.end}>
        <Fade length={CUT.total - CUT.end} outFrames={0}>
          <EndScene />
        </Fade>
      </Sequence>
      <Captions />
      {VO.map((clip) => (
        <Sequence key={clip.file} name={clip.file} from={sec(clip.at)}>
          <Audio src={staticFile(clip.file)} volume={1.3} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
