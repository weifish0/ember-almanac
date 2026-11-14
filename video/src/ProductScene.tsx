import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, lerp, ramp, sec, text } from "./theme";

// Real screenshots of the deployed app (scripts/capture.mjs). Box = where the Northern Thailand area sits on screen.
const BOX = { x0: 363.6, y0: 374.3, x1: 780.2, y1: 704.8 };
const PANEL_X = 1140;
const PANEL_W = 780;
const io = Easing.bezier(0.65, 0, 0.35, 1);

export const ProductScene: React.FC = () => {
  const f = useCurrentFrame();
  // 1 - draw the box
  const approach = ramp(f, 2, 12);
  const drag = ramp(f, 13, 32, io);
  const cx = drag > 0 ? lerp(BOX.x0, BOX.x1, drag) : lerp(250, BOX.x0, approach);
  const cy = drag > 0 ? lerp(BOX.y0, BOX.y1, drag) : lerp(560, BOX.y0, approach);
  // 2 - the almanac appears, camera moves in on it
  const reveal = ramp(f, 34, 46);
  const zoom = ramp(f, 40, 76, io);
  const s = lerp(1, 1.5, zoom);
  const tx = 1920 - 1920 * s; // keep the right edge (the almanac) in frame
  // 3 - scroll through the report, in step with the narration
  const scroll = interpolate(
    f,
    [0, 46, 78, sec(3.2), sec(3.2) + 26, sec(4.5), sec(4.5) + 28, 220],
    [0, 0, 318, 318, 930, 930, 1700, 1730],
    { extrapolateRight: "clamp", easing: io },
  );
  const tag = (from: number, to: number) => Math.min(ramp(f, from, from + 10), 1 - ramp(f, to - 8, to));
  const tags: [number, number, string][] = [
    [4, 36, "1 · Draw any area"],
    [50, sec(3.2), "2 · Read its burning calendar"],
    [sec(3.25), sec(4.5), "3 · See when fire peaks"],
    [sec(4.55), 230, "4 · See which years broke the pattern"],
  ];
  return (
    <AbsoluteFill style={{ background: C.soot }}>
      <div style={{ position: "absolute", width: 1920, height: 1080, transformOrigin: "0 0", transform: `translate(${tx}px, 0px) scale(${s})` }}>
        <Img src={staticFile("cap/before.jpg")} style={{ position: "absolute", width: 1920, height: 1080 }} />
        <Img src={staticFile("cap/after.jpg")} style={{ position: "absolute", width: 1920, height: 1080, opacity: reveal }} />
        {/* the report, scrolling inside its column */}
        <div style={{ position: "absolute", left: PANEL_X, top: 0, width: PANEL_W, height: 1080, overflow: "hidden", opacity: reveal, background: C.paper }}>
          <Img src={staticFile("cap/panel.png")} style={{ position: "absolute", width: PANEL_W, top: -scroll }} />
        </div>
        {/* the drawn box + cursor */}
        {drag > 0 && reveal < 1 && (
          <div
            style={{
              position: "absolute", left: BOX.x0, top: BOX.y0, width: cx - BOX.x0, height: cy - BOX.y0,
              border: `2.5px solid ${C.paper}`, background: "rgba(244,236,220,0.1)", boxShadow: "0 0 0 2px rgba(20,16,14,0.5)", opacity: 1 - reveal,
            }}
          />
        )}
        <svg width={34} height={34} viewBox="0 0 24 24" style={{ position: "absolute", left: cx - 4, top: cy - 3, opacity: 1 - reveal, filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.6))" }}>
          <path d="M4 2l15 9.5-6.6 1.5 4 7-2.7 1.5-4-7L5 19z" fill="#fff" stroke="#14100e" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      </div>
      {/* step labels */}
      {tags.map(([from, to, label]) => {
        const o = tag(from, to);
        return o > 0 ? (
          <div key={label} style={{ position: "absolute", left: 70, top: 64, opacity: o, transform: `translateY(${lerp(10, 0, ramp(f, from, from + 10))}px)`, background: C.paper, color: C.ink, font: `600 34px ${text}`, padding: "14px 24px 16px", borderRadius: 4, boxShadow: "0 8px 30px rgba(0,0,0,0.45)" }}>
            {label}
          </div>
        ) : null;
      })}
    </AbsoluteFill>
  );
};
