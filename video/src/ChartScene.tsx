import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import data from "./data.json";
import { C, display, lerp, ramp, sec, text } from "./theme";

// Real global totals from the pipeline: raw MODIS, raw VIIRS and the harmonized record, per year.
const rows = data.annual.filter((r) => r.year >= 2001);
const L = 170;
const R = 1770;
const T = 360;
const B = 870;
const MAX = 20e6;
const slot = (R - L) / rows.length;
const BW = 44;
const x = (i: number) => L + i * slot + (slot - BW) / 2;
const y = (v: number) => B - (v / MAX) * (B - T);

const Title: React.FC<{ from: number; to: number; children: React.ReactNode }> = ({ from, to, children }) => {
  const f = useCurrentFrame();
  const o = Math.min(ramp(f, from, from + 14), 1 - ramp(f, to - 8, to));
  if (o <= 0) return null;
  return (
    <div style={{ position: "absolute", left: L, top: 120, font: `500 84px/1.05 ${display}`, letterSpacing: "-0.025em", color: C.onSoot, opacity: o, transform: `translateY(${lerp(18, 0, ramp(f, from, from + 14))}px)` }}>
      {children}
    </div>
  );
};

export const ChartScene: React.FC = () => {
  const f = useCurrentFrame();
  const modisGrow = (i: number) => ramp(f, sec(0.15) + i * 1.1, sec(0.15) + i * 1.1 + 16);
  const viirsGrow = (i: number) => ramp(f, sec(2.2) + (i - 11) * 1.6, sec(2.2) + (i - 11) * 1.6 + 18);
  const ratio = ramp(f, sec(3.2), sec(3.2) + 14);
  const splice = ramp(f, sec(4.6), sec(5.75), (t) => t);
  const crack = ramp(f, sec(5.78), sec(5.78) + 10);
  const overlap = ramp(f, sec(7.2), sec(7.2) + 18);
  const lift = ramp(f, sec(10.55), sec(10.55) + 34);
  const proof = ramp(f, sec(11.2), sec(11.2) + 16);
  const tT2 = sec(4.5);
  const tT3 = sec(7.0);
  const tT4 = sec(10.5);

  const top = (i: number) => {
    const r = rows[i];
    return r.year >= 2012 ? r.viirs : lerp(r.modis, r.harm, lift);
  };
  const pts = rows.map((_, i) => [x(i) + BW / 2, y(top(i))] as const);
  const lineLen = pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
  const jumpX = (x(10) + BW + x(11)) / 2;
  const ox0 = x(11) - 10;
  const ox1 = x(20) + BW + 10; // 2012 - 2021

  return (
    <AbsoluteFill style={{ background: C.soot }}>
      <Title from={2} to={tT2}>Two satellites. Two yardsticks.</Title>
      <Title from={tT2} to={tT3}>Splice them, and history breaks.</Title>
      <Title from={tT3} to={tT4}>Learn the exchange rate where they overlap.</Title>
      <Title from={tT4} to={9999}>One consistent record, 2000 to today.</Title>

      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <pattern id="hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="9" height="9" fill="#7a3a1c" />
            <line x1="0" y1="0" x2="0" y2="9" stroke={C.ember} strokeWidth="5" />
          </pattern>
        </defs>

        {/* overlap years */}
        <rect x={ox0} y={T - 30} width={ox1 - ox0} height={B - T + 30} fill={C.onSoot} opacity={0.07 * overlap * (1 - lift * 0.5)} />
        <g opacity={overlap * (1 - lift)}>
          <line x1={ox0} x2={ox1} y1={T - 30} y2={T - 30} stroke={C.onSoot} strokeWidth={2} />
          <text x={(ox0 + ox1) / 2} y={T - 46} textAnchor="middle" fill={C.onSoot} style={{ font: `600 24px ${text}`, letterSpacing: "0.04em" }}>
            2012–2021 · both satellites flying
          </text>
        </g>

        {[0, 5, 10, 15, 20].map((m) => (
          <g key={m}>
            <line x1={L} x2={R} y1={y(m * 1e6)} y2={y(m * 1e6)} stroke={C.onSootSoft} strokeOpacity={m ? 0.18 : 0.6} strokeDasharray={m ? "2 6" : undefined} />
            <text x={L - 16} y={y(m * 1e6) + 7} textAnchor="end" fill={C.onSootSoft} style={{ font: `500 20px ${text}` }}>
              {m ? `${m}M` : "0"}
            </text>
          </g>
        ))}
        <text x={L} y={T - 30} fill={C.onSootSoft} style={{ font: `500 20px ${text}` }} opacity={1 - overlap}>
          global fire detections per year
        </text>

        {rows.map((r, i) => {
          const hm = (B - y(r.modis)) * modisGrow(i);
          const hv = r.year >= 2012 ? (B - y(r.viirs)) * viirsGrow(i) : 0;
          const hh = r.year < 2012 ? (B - y(lerp(r.modis, r.harm, lift))) * (lift > 0 ? 1 : 0) : 0;
          return (
            <g key={r.year}>
              {hv > 0 && <rect x={x(i)} y={B - hv} width={BW} height={hv} fill={C.ember} />}
              {hh > 0 && <rect x={x(i)} y={B - hh} width={BW} height={hh} fill="url(#hatch)" />}
              <rect x={x(i) + (r.year >= 2012 || lift > 0 ? 10 : 0)} y={B - hm} width={r.year >= 2012 || lift > 0 ? BW - 20 : BW} height={hm} fill={C.modis} />
              {(i % 2 === 0 || r.year === 2012) && (
                <text x={x(i) + BW / 2} y={B + 34} textAnchor="middle" fill={r.year === 2012 ? C.onSoot : C.onSootSoft} style={{ font: `${r.year === 2012 ? 600 : 500} 20px ${text}` }}>
                  {r.year}
                </text>
              )}
            </g>
          );
        })}

        {/* the spliced record, then the healed one */}
        {splice > 0 && <path d={path} fill="none" stroke={C.onSoot} strokeWidth={5} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={lineLen} strokeDashoffset={lineLen * (1 - splice)} />}
        <g opacity={crack * (1 - lift)}>
          <line x1={jumpX} x2={jumpX} y1={y(rows[11].viirs) - 12} y2={y(rows[10].modis) + 12} stroke="#ff5a36" strokeWidth={4} strokeDasharray="10 8" />
          <text x={jumpX - 18} y={y(11.5e6)} textAnchor="end" fill="#ff7a52" style={{ font: `600 30px ${text}` }}>
            a fourfold jump
          </text>
          <text x={jumpX - 18} y={y(11.5e6) + 36} textAnchor="end" fill="#ff7a52" style={{ font: `600 30px ${text}` }}>
            that never happened
          </text>
        </g>
      </svg>

      {/* sensor labels */}
      <div style={{ position: "absolute", left: x(0), top: y(4.6e6) - 78, color: C.modis, opacity: ramp(f, 12, 28) * (1 - lift), font: `600 26px ${text}` }}>
        MODIS <span style={{ color: C.onSootSoft, fontWeight: 500 }}>· 1 km pixels · since 2000</span>
      </div>
      <div style={{ position: "absolute", left: x(11), top: y(18e6) - 84, color: C.ember, opacity: ramp(f, sec(2.4), sec(2.4) + 14) * (1 - overlap), font: `600 26px ${text}` }}>
        VIIRS <span style={{ color: C.onSootSoft, fontWeight: 500 }}>· 375 m pixels · since 2012</span>
      </div>
      <div style={{ position: "absolute", left: x(1), top: y(19.4e6), color: C.onSoot, opacity: ratio * (1 - ramp(f, sec(4.25), sec(4.55))), transform: `scale(${lerp(0.85, 1, ratio)})`, transformOrigin: "left top" }}>
        <div style={{ font: `500 150px/1 ${display}`, letterSpacing: "-0.03em" }}>{data.validation.ratio.toFixed(1)}×</div>
        <div style={{ font: `500 28px ${text}`, color: C.onSootSoft, marginTop: 6 }}>more detections from the same fires</div>
      </div>

      {/* the exchange rate */}
      <div style={{ position: "absolute", left: L, top: 232, color: C.onSootSoft, font: `500 28px ${text}`, opacity: overlap * (1 - lift) }}>
        Per 0.25° cell, per month — from <b style={{ color: C.onSoot }}>2.6×</b> to <b style={{ color: C.onSoot }}>6.3×</b>, depending on the place and the season.
      </div>
      <div style={{ position: "absolute", left: L, top: 232, display: "flex", gap: 44, color: C.onSootSoft, font: `500 28px ${text}`, opacity: proof }}>
        <span>Backcast on unseen years</span>
        <span><b style={{ color: C.onSoot }}>{data.validation.reg_year_mdape}%</b> typical regional error</span>
        <span><b style={{ color: C.onSoot }}>+{data.validation.bias}%</b> bias <span style={{ opacity: 0.7 }}>(raw splice: {data.validation.raw_bias}%)</span></span>
      </div>
      {/* the reference sensor has just retired: the record carries on with NOAA-20 */}
      <div style={{ position: "absolute", right: 1920 - R, top: y(19.6e6) - 70, textAlign: "right", font: `600 26px ${text}`, color: C.onSoot, opacity: ramp(f, sec(11.5), sec(11.5) + 14) }}>
        2 Nov 2026: Suomi NPP falls silent <span style={{ color: C.straw }}>→ NOAA-20 carries the record on</span>
      </div>
      <div style={{ position: "absolute", left: x(0), top: y(19.6e6) - 70, color: C.straw, font: `600 26px ${text}`, opacity: ramp(f, sec(11.0), sec(11.0) + 14) }}>
        MODIS, restated in VIIRS terms
      </div>
    </AbsoluteFill>
  );
};
