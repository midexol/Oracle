import React, { useState, useEffect, useMemo } from "react";
import { ChevronUp, ChevronDown, ArrowRight, Check, Trophy, Zap, Users, TrendingUp, Search, CircleCheck, Minus, Plus } from "lucide-react";

/* ================================================================== *
 *  ORACLE - Premium Landing Page
 *  All PRD sections: Hero, Live Feed, Loop, Battles, Leaderboard,
 *  How it Works, Mission, FAQ, CTA
 * ================================================================== */

const C = {
  bg: "#07090D",
  surface: "#0D1016",
  surfaceElevated: "#12161E",
  border: "#1B2028",
  borderStrong: "#252C36",
  text: "#F4F6F8",
  muted: "#6B7280",
  faint: "#374151",
  up: "#20E58A",
  upSoft: "rgba(32,229,138,0.09)",
  upBorder: "rgba(32,229,138,0.28)",
  down: "#FF5263",
  downSoft: "rgba(255,82,99,0.09)",
  downBorder: "rgba(255,82,99,0.28)",
  gold: "#E7B84B",
};

const FALLBACK_MARKETS = {
  BTC:  { price: 67142.3,  change: 2.41 },
  ETH:  { price: 3184.05,  change: -0.86 },
  SOL:  { price: 162.77,   change: 4.12 },
  XRP:  { price: 0.5812,   change: -1.23 },
  BNB:  { price: 412.50,   change: 1.05 },
  AVAX: { price: 38.44,    change: -2.18 },
  DOGE: { price: 0.1234,   change: 3.67 },
  ADA:  { price: 0.4512,   change: 0.88 },
  MATIC:{ price: 0.8901,   change: -0.44 },
};

function formatUsd(value) {
  const num = Number(value || 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: num >= 100 ? 2 : 3,
  }).format(num);
}

function formatSignedPercent(value) {
  return `${value >= 0 ? "+" : ""}${Number(value || 0).toFixed(2)}%`;
}

function GlobalStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');

      .orl-root, .orl-root *, .orl-root *::before, .orl-root *::after { box-sizing: border-box; margin: 0; padding: 0; }
      .orl-root { background: #000; color: ${C.text}; scroll-behavior: smooth; }
      .orl-root .font-display { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; letter-spacing: -0.02em; }
      .orl-root .font-body { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 500; }
      .orl-root .tnum { font-variant-numeric: tabular-nums; }
      .orl-root button { font-family: inherit; }
      .orl-root button:focus-visible { outline: 2px solid rgba(255,255,255,0.4); outline-offset: 2px; }

      @keyframes orlPulseDot { 0%,100% { opacity:1; } 50% { opacity:.3; } }
      .orl-live-dot { animation: orlPulseDot 2s ease-in-out infinite; }

      @keyframes orlRiseIn { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
      .orl-rise-in { animation: orlRiseIn .4s cubic-bezier(.2,.8,.2,1) both; }

      .orl-link-btn { transition: color .15s ease; }
      .orl-link-btn:hover { color: #fff !important; }
      .orl-btn { transition: filter .15s ease, transform .08s ease; }
      .orl-btn:active { transform: scale(0.985); }
      .orl-btn:hover { filter: brightness(1.08); }

      .orl-root .site-container { max-width: 1140px; margin: 0 auto; padding: 0 40px; }

      /* ── Background images are now completely static — no drift/pan
         animation at all, on any screen size. This removes any possibility
         of the panning-reveals-empty-space bug that kept recurring; a
         fixed, slightly oversized crop can't ever expose an edge. ── */
      .orl-bg-drift     { }
      .orl-bg-drift-alt { }

      /* ── Hero ── */
      .orl-root .hero-section {
        position: relative; overflow: hidden;
        min-height: 100vh; display: flex; align-items: center; background: #000;
      }
      .orl-root .hero-bg-img {
        position: absolute; inset: 0; width: 100%; height: 100%;
        object-fit: cover; object-position: center; opacity: 1;
      }
      .orl-root .hero-overlay {
        position: absolute; inset: 0;
        background:
          radial-gradient(ellipse 58% 58% at 50% 50%, rgba(0,0,0,0.42) 0%, rgba(0,0,0,0.28) 50%, rgba(0,0,0,0.0) 100%),
          linear-gradient(to bottom, rgba(0,0,0,0.38) 0%, rgba(0,0,0,0) 22%, rgba(0,0,0,0) 72%, rgba(0,0,0,0.65) 100%);
      }

      /* ── Gradient sections (image 4) ── */
      .orl-root .gradient-section { position: relative; overflow: hidden; background: #07090D; }
      .orl-root .gradient-bg-img {
        position: absolute; inset: 0; width: 100%; height: 100%;
        object-fit: cover; opacity: 0.65; mix-blend-mode: screen;
      }
      .orl-root .gradient-overlay {
        position: absolute; inset: 0;
        background: linear-gradient(to bottom, rgba(7,9,13,0.82) 0%, rgba(7,9,13,0.48) 40%, rgba(7,9,13,0.48) 60%, rgba(7,9,13,0.90) 100%);
      }

      /* ── Spheres section (image 5) ── */
      .orl-root .spheres-section { position: relative; overflow: hidden; background: #000; }
      .orl-root .spheres-bg-img {
        position: absolute; inset: 0; width: 100%; height: 100%;
        object-fit: cover; opacity: 0.8;
      }
      .orl-root .spheres-overlay {
        position: absolute; inset: 0;
        background:
          radial-gradient(ellipse 72% 65% at 50% 50%, rgba(0,0,0,0.70) 0%, rgba(0,0,0,0.28) 70%, rgba(0,0,0,0) 100%),
          linear-gradient(to bottom, rgba(0,0,0,0.68) 0%, rgba(0,0,0,0.18) 30%, rgba(0,0,0,0.18) 70%, rgba(0,0,0,0.80) 100%);
      }

      .orl-root .staging-line { position:absolute; left:0; right:0; height:1px; background:linear-gradient(90deg,transparent,rgba(150,180,220,0.28) 35%,rgba(150,180,220,0.12) 65%,transparent); }
      .orl-root .nav-links { display:flex; align-items:center; gap:32px; }
      .orl-root .shimmer-divider { height:1px; background:linear-gradient(90deg,transparent 0%,rgba(255,255,255,0.12) 40%,rgba(255,255,255,0.07) 60%,transparent 100%); }

      /* ── Layouts ── */
      .orl-root .site-stats-grid { display:grid; grid-template-columns:repeat(4,1fr); }
      .orl-root .stat-item { padding:0 36px; text-align:center; border-right:1px solid rgba(255,255,255,0.08); }
      .orl-root .stat-item:first-child { padding-left:0; }
      .orl-root .stat-item:last-child { border-right:none; padding-right:0; }

      .orl-root .how-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:24px; }
      .orl-root .mission-grid { display:grid; grid-template-columns:1.1fr 0.9fr; gap:64px; align-items:center; }
      .orl-root .preview-grid { display:grid; grid-template-columns:0.95fr 1.05fr; gap:64px; align-items:center; }
      .orl-root .phone-frame { width:268px; border-radius:36px; border:1px solid ${C.borderStrong}; background:linear-gradient(180deg,#10131A,#0A0C10); padding:14px; box-shadow:0 40px 80px rgba(0,0,0,0.6); }

      /* ── Social feed card ── */
      .orl-root .social-card {
        background: rgba(10,13,19,0.78);
        backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
        border: 1px solid rgba(255,255,255,0.07);
        border-radius: 18px;
        overflow: hidden;
        transition: border-color .22s ease, box-shadow .22s ease;
      }
      .orl-root .social-card:hover {
        border-color: rgba(255,255,255,0.14);
        box-shadow: 0 12px 40px rgba(0,0,0,0.55);
      }
      .orl-root .social-card::before {
        content:""; position:absolute; top:0; left:0; right:0; height:1px;
        background:linear-gradient(90deg,transparent,rgba(255,255,255,0.10) 40%,rgba(255,255,255,0.06) 60%,transparent);
      }

      /* ── Loop step ── */
      .orl-root .loop-step {
        display: flex; flex-direction: column; align-items: center; text-align: center;
        padding: 28px 20px;
        border-radius: 18px;
        background: rgba(255,255,255,0.025);
        border: 1px solid rgba(255,255,255,0.06);
        transition: border-color .22s ease, background .22s ease;
        position: relative;
      }
      .orl-root .loop-step:hover {
        border-color: rgba(255,255,255,0.12); background: rgba(255,255,255,0.05);
      }

      /* ── How card ── */
      .orl-root .how-card {
        padding:26px 22px; border-radius:16px;
        background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06);
        transition:border-color .22s ease, background .22s ease;
      }
      .orl-root .how-card:hover { border-color:rgba(255,255,255,0.11); background:rgba(255,255,255,0.05); }

      /* ── Battle card ── */
      .orl-root .battle-glass {
        background: rgba(10,13,19,0.75);
        backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 22px;
        overflow: hidden;
        position: relative;
      }

      /* ── Leaderboard row ── */
      .orl-root .lb-row {
        display:flex; align-items:center; justify-content:space-between;
        padding:14px 0;
        border-bottom: 1px solid rgba(255,255,255,0.06);
        transition: background .15s ease;
      }
      .orl-root .lb-row:last-child { border-bottom:none; }

      /* ── Ticker ── */
      @keyframes ticker { from { transform:translateX(0); } to { transform:translateX(-50%); } }
      .ticker-track { animation: ticker 32s linear infinite; }

      @keyframes orlGlowPulse { 0%,100% { opacity:.4; } 50% { opacity:.65; } }
      .orl-root .hero-center-glow {
        position:absolute; width:650px; height:650px; left:50%; top:50%;
        transform:translate(-50%,-50%); border-radius:50%;
        background:radial-gradient(circle,rgba(20,60,110,0.22) 0%,transparent 70%);
        animation:orlGlowPulse 5s ease-in-out infinite; pointer-events:none;
      }
      @keyframes orlSphereFloat { from { transform:translateY(0); } to { transform:translateY(-14px); } }
      .orl-root .sphere-float { animation:orlSphereFloat 7.5s ease-in-out infinite alternate; }

      @media (max-width:900px) {
        .orl-root .mission-grid,.orl-root .preview-grid { grid-template-columns:1fr; gap:40px; }
        .orl-root .how-grid { grid-template-columns:repeat(2,1fr); }
        .orl-root .site-stats-grid { grid-template-columns:repeat(2,1fr); }
        .orl-root .stat-item { border-right:none; border-bottom:1px solid rgba(255,255,255,0.08); padding:22px; }
        .orl-root .feed-grid { grid-template-columns:1fr !important; gap:20px; }
        .orl-root .loop-grid { grid-template-columns:repeat(2,1fr) !important; gap:20px; }
        .orl-root .loop-connector { display:none; }
        .orl-root .battles-grid,.orl-root .leaderboard-hero-grid { grid-template-columns:1fr !important; gap:40px; }
        .orl-root .site-container[style*="100px"],
        .orl-root .site-container[style*="108px"],
        .orl-root .site-container[style*="120px"] { padding-top:64px !important; padding-bottom:64px !important; }
      }
      @media (max-width:768px) { .orl-root .nav-links { display:none; } }
      @media (max-width:640px) {
        .orl-root .site-container { padding:0 20px; }
        .orl-root .how-grid { grid-template-columns:1fr; }
        .orl-root .loop-grid { grid-template-columns:1fr !important; }
        .orl-root .site-container[style*="px 40px"],
        .orl-root .site-container[style*="px 24px"] { padding-left:20px !important; padding-right:20px !important; }
      }

      /* ── Ultra-minimal scrollbar ── */
      .orl-root ::-webkit-scrollbar { width: 3px; height: 3px; }
      .orl-root ::-webkit-scrollbar-track { background: transparent; }
      .orl-root ::-webkit-scrollbar-thumb {
        background: rgba(255,255,255,0.055);
        border-radius: 999px;
      }
      .orl-root ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.12); }
      .orl-root * { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.055) transparent; }

      /* ── Premium Launch App button shimmer ── */
      @keyframes premiumShimmer {
        0%   { background-position: -400px 0; }
        100% { background-position: 400px 0; }
      }
      .premium-btn {
        position: relative; overflow: hidden;
        background: linear-gradient(180deg, #1B1F27 0%, #0C0E12 100%) !important;
        color: #fff !important;
        border: 1px solid rgba(255,255,255,0.16) !important;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.09), inset 0 -1px 0 rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.5);
      }
      .premium-btn::after {
        content: "";
        position: absolute; inset: 0;
        background: linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.14) 50%, transparent 70%);
        background-size: 400px 100%;
        animation: premiumShimmer 3.2s ease-in-out infinite;
        pointer-events: none;
        border-radius: inherit;
      }
      @keyframes premiumGlow {
        0%,100% { box-shadow: inset 0 1px 0 rgba(255,255,255,0.09), inset 0 -1px 0 rgba(0,0,0,0.4), 0 0 0 rgba(255,255,255,0); }
        50%      { box-shadow: inset 0 1px 0 rgba(255,255,255,0.11), inset 0 -1px 0 rgba(0,0,0,0.4), 0 0 20px rgba(255,255,255,0.12); }
      }
      .premium-btn { animation: premiumGlow 3s ease-in-out infinite; }
      .premium-btn:hover { filter: brightness(1.15) !important; }
    `}</style>
  );
}

/* ──────────────── Atoms ──────────────── */

function OracleLogo({ size = 19, color = "#fff" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.7" />
      <circle cx="12" cy="7.6" r="2.1" fill={color} />
    </svg>
  );
}

function LiveDot({ label = "LIVE ON DREAMDEX" }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="orl-live-dot" style={{ width:5, height:5, borderRadius:999, background:C.up, display:"inline-block" }} />
      <span className="font-body" style={{ fontSize:10, color:C.muted, letterSpacing:"0.10em", fontWeight:600 }}>{label}</span>
    </span>
  );
}

function Avatar({ initials, size=36, live }) {
  const shades = ["#1A1F2A", "#141820", "#0F1319", "#1C2130", "#11151D"];
  const shade = shades[(initials?.charCodeAt(0) ?? 0) % shades.length];
  return (
    <div style={{ position:"relative", width:size, height:size, flexShrink:0 }}>
      <div style={{
        width:size, height:size, borderRadius:999,
        background: shade,
        border:"1.5px solid rgba(255,255,255,0.10)",
        display:"flex", alignItems:"center", justifyContent:"center",
        overflow:"hidden",
        boxShadow:"0 2px 8px rgba(0,0,0,0.5)",
      }}>
        <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="8" r="4" fill="rgba(255,255,255,0.72)" />
          <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="rgba(255,255,255,0.72)" strokeWidth="1.6" strokeLinecap="round" fill="none" />
        </svg>
      </div>
      {live && <span style={{ position:"absolute", bottom:-1, right:-1, width:size*0.28, height:size*0.28, borderRadius:999, background:C.up, border:`2px solid #000` }} />}
    </div>
  );
}

function DirBadge({ dir, sm }) {
  const up = dir==="UP";
  return (
    <span className="font-display inline-flex items-center gap-1" style={{
      color:up?C.up:C.down, background:up?C.upSoft:C.downSoft,
      border:`1px solid ${up?C.upBorder:C.downBorder}`,
      padding:sm?"3px 8px":"5px 11px", borderRadius:6,
      fontWeight:700, fontSize:sm?11:12, letterSpacing:"0.02em",
    }}>
      {up?<ChevronUp size={12} strokeWidth={3}/>:<ChevronDown size={12} strokeWidth={3}/>}
      {dir}
    </span>
  );
}

function Btn({ children, variant="white", onClick, style:extra={}, extraClass="" }) {
  const base = { fontFamily:"'Space Grotesk',sans-serif", fontWeight:700, fontSize:14, letterSpacing:"0.01em", padding:"12px 22px", borderRadius:999, border:"none", cursor:"pointer", display:"inline-flex", alignItems:"center", gap:6 };
  let s = { ...base };
  if(variant==="white")   s = { ...s, background:"#fff", color:"#07090D" };
  if(variant==="green")   s = { ...s, background:C.up, color:"#04180E", boxShadow:"0 0 24px rgba(32,229,138,0.30)" };
  if(variant==="outline") s = { ...s, background:"transparent", color:"#fff", border:"1px solid rgba(255,255,255,0.20)", backdropFilter:"blur(10px)" };
  if(variant==="ghost")   s = { ...s, background:"rgba(255,255,255,0.06)", color:"#fff", border:"1px solid rgba(255,255,255,0.10)" };
  return <button className={`orl-btn${extraClass ? " " + extraClass : ""}`} onClick={onClick} style={{ ...s, ...extra }}>{children}</button>;
}

/* ──────────────── Ticker strip ──────────────── */
function TickerStrip({ items }) {
  const row = [...items, ...items];
  return (
    <div style={{ borderBottom:"1px solid rgba(255,255,255,0.05)", background:"rgba(4,5,8,0.85)", overflow:"hidden", padding:"5px 0" }}>
      <div className="ticker-track flex" style={{ width:"max-content" }}>
        {row.map((t,i) => (
          <div key={i} className="flex items-center gap-2 font-body tnum" style={{ fontSize:11, whiteSpace:"nowrap", padding:"0 20px", borderRight:i%items.length!==items.length-1?"1px solid rgba(255,255,255,0.06)":"none" }}>
            <span style={{ color:C.muted, fontWeight:600 }}>{t.a}</span>
            <span style={{ color:"#fff" }}>{t.p}</span>
            <span style={{ color:t.chg>=0?C.up:C.down, fontWeight:600 }}>{formatSignedPercent(t.chg)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ──────────────── Nav ──────────────── */
function SiteNav({ onLaunch }) {
  const scrollTo = id => document.getElementById(id)?.scrollIntoView({ behavior:"smooth" });
  return (
    <div className="site-container flex items-center justify-between" style={{ height:68, position:"relative", zIndex:5 }}>
      <div className="flex items-center gap-2"><OracleLogo /><span className="font-display" style={{ fontSize:15, fontWeight:700, letterSpacing:"0.03em" }}>ORACLE</span></div>
      <div className="nav-links">
        {[["mission","Product"],["how","How it works"],["leaderboard-preview","Leaderboard"]].map(([id,label]) => (
          <button key={id} onClick={() => scrollTo(id)} className="font-body orl-link-btn" style={{ background:"none", border:"none", cursor:"pointer", fontSize:14, color:C.muted }}>{label}</button>
        ))}
      </div>
      <Btn variant="white" onClick={onLaunch} style={{ fontSize:13, padding:"10px 20px", fontWeight:800, letterSpacing:"0.01em" }} extraClass="premium-btn">Launch App <ArrowRight size={13}/></Btn>
    </div>
  );
}

/* ──────────────── Section header ──────────────── */
function SectionHeader({ eyebrow, headline, sub, center=true }) {
  return (
    <div style={{ textAlign:center?"center":"left", marginBottom:60 }}>
      {eyebrow && <div className="font-body" style={{ fontSize:11, color:C.muted, fontWeight:700, letterSpacing:"0.14em", textTransform:"uppercase", marginBottom:14 }}>{eyebrow}</div>}
      <h2 className="font-display" style={{ fontSize:"clamp(26px,3.6vw,44px)", color:"#fff", fontWeight:700, letterSpacing:"-0.04em", lineHeight:1.04 }} dangerouslySetInnerHTML={{ __html:headline }} />
      {sub && <p className="font-body" style={{ fontSize:15, color:C.muted, marginTop:14, lineHeight:1.65, maxWidth:center?520:480, margin:center?"14px auto 0":"14px 0 0" }}>{sub}</p>}
    </div>
  );
}

/* ──────────────── Social prediction card ──────────────── */
function SocialPredCard({ user, initials, acc, market, contractId, dir, price, assetAcc, asset, time, onBack, watched, backed }) {
  const up = dir==="UP";
  return (
    <div className="social-card" style={{ position:"relative" }}>
      {/* User header - X/Twitter style */}
      <div className="flex items-center justify-between" style={{ padding:"16px 18px 12px", borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
        <div className="flex items-center gap-2.5">
          <Avatar initials={initials} size={40} live />
          <div>
            <div className="font-body" style={{ fontSize:14, color:"#fff", fontWeight:700 }}>@{user}</div>
            <div className="font-body tnum" style={{ fontSize:11, color:C.muted }}>{acc}% overall accuracy</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <LiveDot label="LIVE" />
          <span style={{ fontSize:10, fontWeight:600, color:C.muted, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.07)", padding:"3px 8px", borderRadius:999 }}>{contractId}</span>
        </div>
      </div>

      {/* Prediction content - the "post" */}
      <div style={{ padding:"14px 18px 0" }}>
        <div className="flex items-center justify-between" style={{ marginBottom:12 }}>
          <div>
            <div className="font-display" style={{ fontSize:22, fontWeight:700, color:"#fff", letterSpacing:"-0.02em" }}>{market}</div>
            <div className="font-body" style={{ fontSize:12.5, color:C.muted, marginTop:3 }}>Will {asset} finish higher?</div>
          </div>
          <DirBadge dir={dir} />
        </div>

        {/* 3-column stats */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:0, borderTop:"1px solid rgba(255,255,255,0.05)", borderBottom:"1px solid rgba(255,255,255,0.05)", padding:"12px 0", marginBottom:14 }}>
          {[
            { label:"DREAMDEX", value:formatUsd(price), color:up?C.up:C.down },
            { label:`${asset} ACC.`, value:Math.round(assetAcc)+"%", color:"#fff" },
            { label:"TIME LEFT", value:time, color:C.gold },
          ].map((s,i) => (
            <div key={i} style={{ textAlign:"center", borderRight:i<2?"1px solid rgba(255,255,255,0.06)":"none", padding:"0 4px" }}>
              <div className="font-body" style={{ fontSize:8.5, color:C.muted, fontWeight:700, letterSpacing:"0.06em", marginBottom:4, textTransform:"uppercase", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{s.label}</div>
              <div className="font-display tnum" style={{ fontSize:14, fontWeight:700, color:s.color, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Full-width CTA */}
        <div style={{ padding:"0 0 14px" }}>
          <button className="orl-btn" onClick={onBack} style={{
            width:"100%", border:"none", cursor:"pointer", padding:"14px 20px",
            borderRadius:12, fontSize:14.5, fontWeight:700,
            fontFamily:"'Space Grotesk',sans-serif", letterSpacing:"0.02em",
            background:up?"linear-gradient(135deg,#20E58A,#18C97A)":"linear-gradient(135deg,#FF5263,#E03E4E)",
            color:up?"#04180E":"#1a0204",
          }}>Back {dir}</button>
        </div>
      </div>

      {/* Engagement footer - social metrics */}
      <div className="flex items-center gap-4" style={{ padding:"10px 18px", borderTop:"1px solid rgba(255,255,255,0.04)", background:"rgba(0,0,0,0.2)" }}>
        <span className="font-body" style={{ fontSize:11, color:C.faint, display:"flex", alignItems:"center", gap:4 }}><Users size={11}/> {watched} watching</span>
        <span className="font-body" style={{ fontSize:11, color:C.faint, display:"flex", alignItems:"center", gap:4 }}><TrendingUp size={11}/> {backed} backed</span>
      </div>
    </div>
  );
}

/* ──────────────── Data ──────────────── */
const siteStats = [
  { value:"78%",    label:"Top predictor accuracy" },
  { value:"12,400+", label:"Active predictors" },
  { value:"$4.2M",  label:"Volume backed" },
  { value:"60+",    label:"Live markets" },
];
const loopSteps = [
  { Icon: Search,      label:"Discover", desc:"Browse live predictions from real DreamDEX traders with verified track records.", step:"01" },
  { Icon: CircleCheck, label:"Back",     desc:"Back a prediction with a real Event Contract trade on DreamDEX.", step:"02" },
  { Icon: Zap,         label:"Resolve",  desc:"The market settles on-chain. Your prediction becomes WIN or LOSS.", step:"03" },
  { Icon: Trophy,      label:"Compete",  desc:"Build reputation. Climb leaderboards. Compete for the top predictor spot.", step:"04" },
];
const howItWorks = [
  { title:"Discover",  copy:"Browse live predictions from real DreamDEX traders, not anonymous charts.", num:"01" },
  { title:"Back",      copy:"See the record behind a call, then back it with a real Event Contract trade.", num:"02" },
  { title:"Compete",   copy:"Go head-to-head in Battles, or climb the board on accuracy alone.", num:"03" },
  { title:"Earn",      copy:"Every settled prediction builds your Oracle Score and public track record.", num:"04" },
];
const faqs = [
  { q:"What is DreamDEX?", a:"DreamDEX is the underlying exchange. It supplies the Event Contracts, order book, pricing and on-chain settlement that Oracle trades against." },
  { q:"Is backing a prediction the same as placing a trade?", a:"Yes. Tapping Back submits a real Event Contract order on DreamDEX under your wallet. Oracle doesn't hold a separate balance." },
  { q:"How is Oracle Score calculated?", a:"Simple and transparent: resolved predictions, accuracy, and volume. No hidden AI weighting, just a verifiable track record." },
  { q:"What network does this run on?", a:"The current build runs on Somnia Shannon testnet (chain 50312)." },
  { q:"Can I make my own predictions?", a:"Yes. You can stake a prediction on any live DreamDEX Event Contract. Your result and history are recorded and contribute to your public Oracle Score." },
];

export default function OracleLanding({ onLaunch = () => {} }) {
  const [openFaq, setOpenFaq] = useState(null);
  const [lbTab, setLbTab] = useState("ALL");
  const [marketData, setMarketData] = useState(FALLBACK_MARKETS);

  useEffect(() => {
    const fetchMarketData = async () => {
      try {
        const response = await fetch("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin,ethereum,solana,ripple,binancecoin,avalanche-2,dogecoin,cardano,matic-network&price_change_percentage=24h");
        if (!response.ok) throw new Error("Market data request failed");

        const rawData = await response.json();
        const symbolMap = {
          btc: "BTC", eth: "ETH", sol: "SOL", xrp: "XRP",
          bnb: "BNB", avax: "AVAX", doge: "DOGE", ada: "ADA", matic: "MATIC",
        };
        const nextMarketData = rawData.reduce((acc, coin) => {
          const key = symbolMap[coin.symbol?.toLowerCase()];
          if (!key) return acc;
          acc[key] = { price: coin.current_price, change: coin.price_change_percentage_24h ?? 0 };
          return acc;
        }, {});

        setMarketData({
          BTC:  nextMarketData.BTC  || FALLBACK_MARKETS.BTC,
          ETH:  nextMarketData.ETH  || FALLBACK_MARKETS.ETH,
          SOL:  nextMarketData.SOL  || FALLBACK_MARKETS.SOL,
          XRP:  nextMarketData.XRP  || FALLBACK_MARKETS.XRP,
          BNB:  nextMarketData.BNB  || FALLBACK_MARKETS.BNB,
          AVAX: nextMarketData.AVAX || FALLBACK_MARKETS.AVAX,
          DOGE: nextMarketData.DOGE || FALLBACK_MARKETS.DOGE,
          ADA:  nextMarketData.ADA  || FALLBACK_MARKETS.ADA,
          MATIC:nextMarketData.MATIC|| FALLBACK_MARKETS.MATIC,
        });
      } catch (error) {
        setMarketData(FALLBACK_MARKETS);
      }
    };

    fetchMarketData();
    const interval = setInterval(fetchMarketData, 30000);
    return () => clearInterval(interval);
  }, []);

  const tickerItems = useMemo(() => [
    { a: "BTC/USD",  p: formatUsd(marketData.BTC?.price  ?? FALLBACK_MARKETS.BTC.price),  chg: marketData.BTC?.change  ?? FALLBACK_MARKETS.BTC.change },
    { a: "ETH/USD",  p: formatUsd(marketData.ETH?.price  ?? FALLBACK_MARKETS.ETH.price),  chg: marketData.ETH?.change  ?? FALLBACK_MARKETS.ETH.change },
    { a: "SOL/USD",  p: formatUsd(marketData.SOL?.price  ?? FALLBACK_MARKETS.SOL.price),  chg: marketData.SOL?.change  ?? FALLBACK_MARKETS.SOL.change },
    { a: "XRP/USD",  p: formatUsd(marketData.XRP?.price  ?? FALLBACK_MARKETS.XRP.price),  chg: marketData.XRP?.change  ?? FALLBACK_MARKETS.XRP.change },
    { a: "BNB/USD",  p: formatUsd(marketData.BNB?.price  ?? FALLBACK_MARKETS.BNB.price),  chg: marketData.BNB?.change  ?? FALLBACK_MARKETS.BNB.change },
    { a: "AVAX/USD", p: formatUsd(marketData.AVAX?.price ?? FALLBACK_MARKETS.AVAX.price), chg: marketData.AVAX?.change ?? FALLBACK_MARKETS.AVAX.change },
    { a: "DOGE/USD", p: formatUsd(marketData.DOGE?.price ?? FALLBACK_MARKETS.DOGE.price), chg: marketData.DOGE?.change ?? FALLBACK_MARKETS.DOGE.change },
    { a: "ADA/USD",  p: formatUsd(marketData.ADA?.price  ?? FALLBACK_MARKETS.ADA.price),  chg: marketData.ADA?.change  ?? FALLBACK_MARKETS.ADA.change },
    { a: "MATIC/USD",p: formatUsd(marketData.MATIC?.price?? FALLBACK_MARKETS.MATIC.price),chg: marketData.MATIC?.change?? FALLBACK_MARKETS.MATIC.change },
  ], [marketData]);

  const leaderboard = [
    { rank:1, name:"Alpha",  initials:"AL", acc:78, count:91,  bg:"linear-gradient(135deg,rgba(231,184,75,0.12),rgba(0,0,0,0))" },
    { rank:2, name:"Mide",   initials:"MI", acc:74, count:63,  bg:"transparent" },
    { rank:3, name:"QuantX", initials:"QU", acc:71, count:118, bg:"transparent" },
  ];

  return (
    <div className="orl-root font-body" style={{ position:"relative", minHeight:"100vh" }}>
      <GlobalStyles />

      {/* ── Sticky Nav ── */}
      <div style={{ position:"sticky", top:0, zIndex:20, background:"rgba(4,5,8,0.88)", backdropFilter:"blur(20px)", WebkitBackdropFilter:"blur(20px)", borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
        <SiteNav onLaunch={onLaunch} />
        <TickerStrip items={tickerItems} />
      </div>

      {/* ═══════════════════════════════════════════
           HERO - glass lenses background
           ═══════════════════════════════════════ */}
      <section className="hero-section" style={{ borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
        <img src="/hero-bg.jpg" alt="" className="hero-bg-img orl-bg-drift" aria-hidden="true" />
        <div className="hero-overlay" />
        <div className="hero-center-glow" />

        <div className="site-container" style={{ position:"relative", zIndex:2, textAlign:"center", padding:"130px 24px 80px", width:"100%" }}>
          {/* Live badge */}
          <div className="flex items-center justify-center" style={{ marginBottom:28 }}>
            <div style={{ display:"inline-flex", alignItems:"center", gap:8, padding:"6px 14px", borderRadius:999, border:"1px solid rgba(255,255,255,0.12)", background:"rgba(255,255,255,0.05)", backdropFilter:"blur(12px)" }}>
              <LiveDot />
            </div>
          </div>

          {/* Headline */}
          <h1 className="font-display" style={{ fontSize:"clamp(40px,6.5vw,74px)", color:"#fff", fontWeight:700, letterSpacing:"-0.04em", lineHeight:1.0, marginBottom:22, textShadow:"0 2px 40px rgba(0,0,0,0.8)" }}>
            Discover who's really<br />right about the market.
          </h1>
          <p className="font-body" style={{ fontSize:16.5, color:"rgba(180,188,200,0.85)", maxWidth:520, margin:"0 auto 36px", lineHeight:1.65 }}>
            Oracle is a social prediction network where every call is tied to a real DreamDEX Event Contract. See a trader's track record, then back their prediction with an actual trade.
          </p>

          {/* CTAs */}
          <div className="flex items-center justify-center" style={{ gap:12, flexWrap:"wrap" }}>
            <Btn variant="green" onClick={onLaunch} style={{ fontSize:15, padding:"15px 32px" }} extraClass="premium-btn">Launch App <ArrowRight size={15}/></Btn>
            <Btn variant="outline" onClick={() => document.getElementById("how")?.scrollIntoView({ behavior:"smooth" })} style={{ fontSize:15, padding:"15px 28px" }}>How it works</Btn>
          </div>

          {/* Inline stats below hero */}
          <div className="flex items-center justify-center" style={{ marginTop:72, gap:48, flexWrap:"wrap" }}>
            {siteStats.map((s,i) => (
              <div key={i} style={{ textAlign:"center" }}>
                <div className="font-display tnum" style={{ fontSize:30, fontWeight:700, color:"#fff", letterSpacing:"-0.03em" }}>{s.value}</div>
                <div className="font-body" style={{ fontSize:12, color:C.muted, marginTop:4 }}>{s.label}</div>
              </div>
            ))}
          </div>

          <div style={{ marginTop:64, display:"flex", flexDirection:"column", alignItems:"center" }}>
            <div style={{ width:1, height:36, background:"linear-gradient(to bottom,transparent,rgba(255,255,255,0.5))" }} />
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════
           LIVE SOCIAL FEED PREVIEW
           Shows what the platform looks like - X style
           ═══════════════════════════════════════ */}
      <section style={{ background:"radial-gradient(ellipse 70% 45% at 50% 0%, rgba(40,70,130,0.12) 0%, rgba(7,9,13,0) 60%), linear-gradient(180deg, #0B0E15 0%, #07090D 45%, #05070A 100%)", borderBottom:"1px solid rgba(255,255,255,0.05)", padding:"100px 0" }}>
        <div className="site-container">
          <SectionHeader
            eyebrow="Live Predictions"
            headline="Predictions from real traders.<br/>Back them with real trades."
            sub="Every prediction you see is connected to a live DreamDEX Event Contract. The Back button isn't social media engagement. It's a real order."
          />
          {/* 3-column social feed cards */}
          <div className="feed-grid" style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:18 }}>
            <SocialPredCard user="Mide" initials="MD" acc={74} market="BTC 15M" contractId="OC-BTC-001" dir="UP"   price={marketData.BTC.price} assetAcc={Math.min(98, Math.max(60, 60 + Math.abs(marketData.BTC.change)))} asset="BTC" time="06:42" watched="1,284" backed="312"  onBack={onLaunch} />
            <SocialPredCard user="AlphaTrader" initials="AT" acc={78} market="ETH 1H"  contractId="OC-ETH-002" dir="DOWN" price={marketData.ETH.price} assetAcc={Math.min(98, Math.max(60, 60 + Math.abs(marketData.ETH.change)))} asset="ETH" time="41:10" watched="876"  backed="195"  onBack={onLaunch} />
            <SocialPredCard user="QuantX" initials="QX" acc={71} market="BTC 1H"  contractId="OC-BTC-003" dir="UP"   price={marketData.BTC.price} assetAcc={Math.min(98, Math.max(60, 60 + Math.abs(marketData.BTC.change) * 0.8))} asset="BTC" time="22:03" watched="640"  backed="148"  onBack={onLaunch} />
          </div>
          <div className="text-center" style={{ marginTop:40 }}>
            <Btn variant="outline" onClick={onLaunch}>See all live predictions <ArrowRight size={14}/></Btn>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════
           CORE LOOP - Predict → Back → Resolve → Earn
           ═══════════════════════════════════════ */}
      <section id="how" className="gradient-section" style={{ borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
        <img src="/gradient-bg.png" alt="" className="gradient-bg-img orl-bg-drift-alt" aria-hidden="true" />
        <div className="gradient-overlay" />
        <div className="site-container" style={{ padding:"100px 40px", position:"relative", zIndex:2 }}>
          <SectionHeader
            eyebrow="The Oracle Loop"
            headline="A prediction isn't a post.<br/>It's a position."
            sub="Oracle turns DreamDEX Event Contracts into a social game where predictions drive real trades, and real trades build reputation."
          />

          {/* 4-step loop */}
          <div className="loop-grid" style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:16, marginBottom:48 }}>
            {loopSteps.map((s,i) => (
              <div key={i} className="loop-step">
                {/* Connector arrow between steps */}
                {i < loopSteps.length-1 && (
                  <div className="loop-connector" style={{ position:"absolute", top:"50%", right:-12, transform:"translateY(-50%)", color:C.faint, zIndex:1 }}>
                    <ArrowRight size={16} strokeWidth={2} />
                  </div>
                )}
                <div style={{ marginBottom:14, display:"flex", alignItems:"center", justifyContent:"center", width:48, height:48, borderRadius:12, background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.12)" }}>
                  <s.Icon size={22} color="#ffffff" strokeWidth={2} />
                </div>
                <div className="font-body" style={{ fontSize:10, color:C.muted, fontWeight:700, letterSpacing:"0.12em", marginBottom:8 }}>{s.step}</div>
                <div className="font-display" style={{ fontSize:17, color:"#fff", fontWeight:700, letterSpacing:"-0.02em", marginBottom:8 }}>{s.label}</div>
                <p className="font-body" style={{ fontSize:13, color:C.muted, lineHeight:1.6 }}>{s.desc}</p>
              </div>
            ))}
          </div>

          {/* Full loop visualization */}
          <div style={{ border:"1px solid rgba(255,255,255,0.07)", borderRadius:18, padding:"24px 32px", background:"rgba(0,0,0,0.4)", backdropFilter:"blur(12px)" }}>
            <div className="font-body" style={{ fontSize:11, color:C.muted, fontWeight:700, letterSpacing:"0.12em", marginBottom:14, textTransform:"uppercase" }}>The complete loop</div>
            <div className="flex items-center" style={{ gap:8, flexWrap:"wrap" }}>
              {["Prediction","arrow","DreamDEX trade","arrow","Market outcome","arrow","WIN / LOSS","arrow","Reputation","arrow","Leaderboard","arrow","More trading"].map((item,i) => (
                item === "arrow" ? (
                  <ArrowRight key={i} size={14} color={C.faint} strokeWidth={2} style={{ flexShrink:0 }} />
                ) : (
                <span key={i} className="font-body" style={{
                  fontSize:12.5, fontWeight:600,
                  color:"#fff",
                  background:"rgba(255,255,255,0.05)",
                  padding:"4px 10px", borderRadius:6,
                  border:"1px solid rgba(255,255,255,0.07)",
                }}>
                  {item}
                </span>
                )
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════
           PREDICTION BATTLES
           ═══════════════════════════════════════ */}
      <section style={{ background:"radial-gradient(ellipse 70% 45% at 50% 0%, rgba(40,70,130,0.12) 0%, rgba(7,9,13,0) 60%), linear-gradient(180deg, #0B0E15 0%, #07090D 45%, #05070A 100%)", borderBottom:"1px solid rgba(255,255,255,0.05)", padding:"100px 0" }}>
        <div className="site-container">
          <div className="battles-grid" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:64, alignItems:"center" }}>
            {/* Left: copy */}
            <div>
              <div className="font-body" style={{ fontSize:11, color:C.muted, fontWeight:700, letterSpacing:"0.14em", textTransform:"uppercase", marginBottom:14 }}>Battles</div>
              <h2 className="font-display" style={{ fontSize:"clamp(26px,3.6vw,44px)", color:"#fff", fontWeight:700, letterSpacing:"-0.04em", lineHeight:1.04, marginBottom:20 }}>
                Head-to-head.<br />One market.<br />Two predictions.
              </h2>
              <p className="font-body" style={{ fontSize:15, color:C.muted, lineHeight:1.7, marginBottom:28, maxWidth:420 }}>
                Battles let you go head-to-head against other traders. Back either side with a real DreamDEX Event Contract trade. The market is the judge.
              </p>
              <div className="flex flex-col" style={{ gap:12, marginBottom:32 }}>
                {["All predictions backed by real trades","On-chain settlement, no debate","Shareable results with prediction receipts"].map((t,i) => (
                  <div key={i} className="flex items-center gap-2.5">
                    <Check size={14} color={C.up} />
                    <span className="font-body" style={{ fontSize:14, color:"rgba(210,218,228,0.85)" }}>{t}</span>
                  </div>
                ))}
              </div>
              <Btn variant="outline" onClick={onLaunch}>See live battles <ArrowRight size={14}/></Btn>
            </div>

            {/* Right: battle card */}
            <div className="battle-glass" style={{ padding:"28px 24px" }}>
              <div className="flex items-center gap-2 justify-center" style={{ marginBottom:22 }}>
                <LiveDot label="LIVE BATTLE" />
              </div>
              <div className="font-display text-center" style={{ fontSize:20, color:"#fff", fontWeight:700, letterSpacing:"-0.02em", marginBottom:28 }}>BTC 15M</div>

              <div style={{ display:"grid", gridTemplateColumns:"1fr auto 1fr", gap:16, alignItems:"center", marginBottom:24 }}>
                <div style={{ textAlign:"center", padding:"20px 16px", borderRadius:14, background:"rgba(32,229,138,0.06)", border:"1px solid rgba(32,229,138,0.18)" }}>
                  <Avatar initials="MI" size={44} live />
                  <div className="font-display" style={{ fontSize:14, color:"#fff", fontWeight:700, margin:"10px 0 8px" }}>Mide</div>
                  <div className="font-body tnum" style={{ fontSize:11, color:C.muted, marginBottom:10 }}>74% acc</div>
                  <DirBadge dir="UP" />
                </div>
                <div className="font-display" style={{ fontSize:13, color:C.faint, fontWeight:700, letterSpacing:"0.08em" }}>VS</div>
                <div style={{ textAlign:"center", padding:"20px 16px", borderRadius:14, background:"rgba(255,82,99,0.06)", border:"1px solid rgba(255,82,99,0.18)" }}>
                  <Avatar initials="AL" size={44} live />
                  <div className="font-display" style={{ fontSize:14, color:"#fff", fontWeight:700, margin:"10px 0 8px" }}>Alpha</div>
                  <div className="font-body tnum" style={{ fontSize:11, color:C.muted, marginBottom:10 }}>78% acc</div>
                  <DirBadge dir="DOWN" />
                </div>
              </div>

              <div className="text-center font-display tnum" style={{ fontSize:18, color:C.gold, fontWeight:700, marginBottom:20 }}>06:42</div>

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:16 }}>
                <button className="orl-btn" onClick={onLaunch} style={{ width:"100%", border:"none", cursor:"pointer", padding:"13px", borderRadius:10, fontSize:13.5, fontWeight:700, fontFamily:"'Space Grotesk',sans-serif", background:"linear-gradient(135deg,#20E58A,#18C97A)", color:"#04180E" }}>Back Mide</button>
                <button className="orl-btn" onClick={onLaunch} style={{ width:"100%", border:"none", cursor:"pointer", padding:"13px", borderRadius:10, fontSize:13.5, fontWeight:700, fontFamily:"'Space Grotesk',sans-serif", background:"linear-gradient(135deg,#FF5263,#E03E4E)", color:"#1a0204" }}>Back Alpha</button>
              </div>
              <div className="flex justify-center gap-6 font-body" style={{ fontSize:11, color:C.faint }}>
                <span>1,284 watching</span><span>312 positions taken</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════
           LEADERBOARD PREVIEW - ESPN-style
           ═══════════════════════════════════════ */}
      <section id="leaderboard-preview" className="spheres-section" style={{ borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
        <img src="/spheres-bg.png" alt="" className="spheres-bg-img orl-bg-drift" aria-hidden="true" />
        <div className="spheres-overlay" />
        <div className="site-container" style={{ padding:"100px 40px", position:"relative", zIndex:2 }}>
          <div className="leaderboard-hero-grid" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:64, alignItems:"center" }}>
            {/* Left: leaderboard */}
            <div>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:32 }}>
                <Trophy size={18} color={C.gold} />
                <h2 className="font-display" style={{ fontSize:"clamp(22px,2.8vw,32px)", color:"#fff", fontWeight:700, letterSpacing:"-0.03em" }}>Top Predictors</h2>
              </div>

              {/* Filter tabs */}
              <div style={{ display:"flex", gap:2, marginBottom:24, background:"rgba(13,16,22,0.8)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:999, padding:3, width:"fit-content" }}>
                {["ALL","BTC","ETH","15M","1H"].map(t => (
                  <button key={t} onClick={() => setLbTab(t)} className="font-body" style={{ padding:"5px 14px", borderRadius:999, border:"none", cursor:"pointer", fontSize:12, fontWeight:lbTab===t?700:500, background:lbTab===t?"rgba(255,255,255,0.95)":"transparent", color:lbTab===t?"#07090D":C.muted, transition:"all .15s ease" }}>{t}</button>
                ))}
              </div>

              <div style={{ borderRadius:18, overflow:"hidden", border:"1px solid rgba(255,255,255,0.07)", background:"rgba(7,9,13,0.7)", backdropFilter:"blur(16px)" }}>
                {leaderboard.map((r,i) => (
                  <div key={i} className="lb-row" style={{ padding:"16px 20px", borderBottom:i<2?"1px solid rgba(255,255,255,0.06)":"none", background:r.bg }}>
                    <div className="flex items-center gap-3">
                      <span className="font-display tnum" style={{ fontSize:13, color:r.rank===1?C.gold:C.faint, fontWeight:700, width:20 }}>#{r.rank}</span>
                      <Avatar initials={r.initials} size={36} />
                      <div>
                        <div className="font-body" style={{ fontSize:14, color:"#fff", fontWeight:700 }}>{r.name}</div>
                        <div className="font-body tnum" style={{ fontSize:11, color:C.muted }}>{r.count} predictions</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-display tnum" style={{ fontSize:18, color:r.rank===1?C.gold:"#fff", fontWeight:700 }}>{r.acc}%</div>
                      <div className="font-body" style={{ fontSize:10, color:C.muted }}>accuracy</div>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop:20 }}>
                <Btn variant="ghost" onClick={onLaunch} style={{ fontSize:13 }}>View full leaderboard <ArrowRight size={13}/></Btn>
              </div>
            </div>

            {/* Right: copy */}
            <div>
              <div className="font-body" style={{ fontSize:11, color:C.muted, fontWeight:700, letterSpacing:"0.14em", textTransform:"uppercase", marginBottom:14 }}>Reputation</div>
              <h2 className="font-display" style={{ fontSize:"clamp(26px,3.2vw,42px)", color:"#fff", fontWeight:700, letterSpacing:"-0.04em", lineHeight:1.05, marginBottom:20 }}>
                Build a verifiable<br />track record.
              </h2>
              <p className="font-body" style={{ fontSize:15, color:C.muted, lineHeight:1.7, marginBottom:32, maxWidth:420 }}>
                Every prediction creates a permanent on-chain record. Your Oracle Score is calculated from resolved predictions, accuracy, and volume. Transparent and publicly verifiable.
              </p>

              {/* Score card preview */}
              <div style={{ border:"1px solid rgba(255,255,255,0.08)", borderRadius:18, padding:"20px 24px", background:"rgba(7,9,13,0.7)", backdropFilter:"blur(16px)", maxWidth:320 }}>
                <div className="flex items-center gap-3" style={{ marginBottom:16 }}>
                  <Avatar initials="MD" size={44} live />
                  <div>
                    <div className="font-display" style={{ fontSize:18, color:"#fff", fontWeight:700 }}>Mide</div>
                    <div className="font-body" style={{ fontSize:11, color:C.gold, fontWeight:700, letterSpacing:"0.08em" }}>ELITE PREDICTOR</div>
                  </div>
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:0, borderTop:"1px solid rgba(255,255,255,0.06)", paddingTop:16 }}>
                  {[{ v:"82", l:"Score" },{ v:"74%", l:"Accuracy" },{ v:"63", l:"Preds" },{ v:"47", l:"Correct" }].map((s,i) => (
                    <div key={i} style={{ textAlign:"center", borderRight:i<3?"1px solid rgba(255,255,255,0.06)":"none" }}>
                      <div className="font-display tnum" style={{ fontSize:20, fontWeight:700, color:"#fff", letterSpacing:"-0.02em" }}>{s.v}</div>
                      <div className="font-body" style={{ fontSize:10, color:C.muted, marginTop:3 }}>{s.l}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════
           HOW IT WORKS (4-step)
           ═══════════════════════════════════════ */}
      <section style={{ background:"radial-gradient(ellipse 70% 45% at 50% 0%, rgba(40,70,130,0.12) 0%, rgba(7,9,13,0) 60%), linear-gradient(180deg, #0B0E15 0%, #07090D 45%, #05070A 100%)", borderBottom:"1px solid rgba(255,255,255,0.05)", padding:"100px 0" }}>
        <div className="site-container">
          <SectionHeader eyebrow="Step by step" headline="Simple by design.<br/>Serious by execution." sub="Oracle removes the complexity of prediction markets and replaces it with a social experience. The DreamDEX infrastructure handles everything else." />
          <div className="how-grid">
            {howItWorks.map((h,i) => (
              <div key={i} className="how-card">
                <div className="font-body tnum" style={{ fontSize:11, color:C.faint, fontWeight:700, letterSpacing:"0.10em", marginBottom:18 }}>{h.num}</div>
                <div className="font-display" style={{ fontSize:18, color:"#fff", fontWeight:700, marginBottom:10, letterSpacing:"-0.02em" }}>{h.title}</div>
                <p className="font-body" style={{ fontSize:13.5, color:C.muted, lineHeight:1.65 }}>{h.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════
           MISSION / WHY ORACLE
           ═══════════════════════════════════════ */}
      <section id="mission" className="gradient-section" style={{ borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
        <img src="/gradient-bg.png" alt="" className="gradient-bg-img orl-bg-drift" aria-hidden="true" />
        <div className="gradient-overlay" />
        <div className="site-container mission-grid" style={{ padding:"108px 40px", position:"relative", zIndex:2 }}>
          <div>
            <div className="font-body" style={{ fontSize:11, color:C.muted, fontWeight:700, letterSpacing:"0.14em", textTransform:"uppercase", marginBottom:18 }}>Why Oracle</div>
            <h2 className="font-display" style={{ fontSize:"clamp(26px,3.6vw,44px)", color:"#fff", fontWeight:700, letterSpacing:"-0.04em", lineHeight:1.04, marginBottom:22 }}>
              DreamDEX provides the market.<br />Oracle provides the reason to trade.
            </h2>
            <p className="font-body" style={{ fontSize:15, color:C.muted, lineHeight:1.7, marginBottom:36, maxWidth:440 }}>
              New users open DreamDEX and see Event Contracts, prices, order books and time limits. Oracle turns that intimidating experience into a social game: see who's predicting what, check their record, then back them with a real trade.
            </p>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
              {[
                { label:"Discovery", desc:"Find Event Contracts through people, not charts." },
                { label:"Execution", desc:"Every Back = a real DreamDEX order." },
                { label:"Competition", desc:"Battles drive repeated market participation." },
                { label:"Reputation", desc:"Track record keeps users coming back." },
              ].map((item,i) => (
                <div key={i} style={{ padding:"16px", borderRadius:12, background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.07)" }}>
                  <div className="font-display" style={{ fontSize:13.5, color:"#fff", fontWeight:700, marginBottom:5 }}>{item.label}</div>
                  <div className="font-body" style={{ fontSize:12.5, color:C.muted, lineHeight:1.55 }}>{item.desc}</div>
                </div>
              ))}
            </div>
          </div>
          {/* Glass sphere decoration */}
          <div style={{ position:"relative", height:380, display:"flex", alignItems:"center", justifyContent:"center" }}>
            <div className="sphere-float" style={{ position:"relative" }}>
              <div style={{ width:290, height:290, borderRadius:"50%", background:"radial-gradient(circle at 30% 24%,rgba(255,255,255,0.5) 0%,rgba(255,255,255,0.08) 14%,rgba(10,14,20,0.92) 46%,#000 76%)", boxShadow:"inset 0 -20px 32px rgba(60,130,255,0.32),inset 0 10px 18px rgba(255,255,255,0.06),0 22px 46px rgba(0,0,0,0.6)", border:"1px solid rgba(255,255,255,0.07)" }} />
            </div>
            {[0,1,2].map(i => (
              <div key={i} className="staging-line" style={{ bottom:`${16+i*28}px`, opacity:0.6-i*0.15 }} />
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════
           FAQ
           ═══════════════════════════════════════ */}
      <section id="faq" style={{ background:"radial-gradient(ellipse 70% 45% at 50% 0%, rgba(40,70,130,0.12) 0%, rgba(7,9,13,0) 60%), linear-gradient(180deg, #0B0E15 0%, #07090D 45%, #05070A 100%)", borderBottom:"1px solid rgba(255,255,255,0.05)", padding:"100px 0" }}>
        <div className="site-container" style={{ maxWidth:740 }}>
          <SectionHeader eyebrow="Questions" headline="Frequently asked" />
          {faqs.map((f,i) => (
            <div key={i}>
              <div className="shimmer-divider" />
              <button
                onClick={() => setOpenFaq(openFaq===i?null:i)}
                className="flex items-center justify-between font-body"
                style={{ width:"100%", background:"none", border:"none", cursor:"pointer", padding:"20px 2px", fontSize:15, color:"#fff", fontWeight:600, textAlign:"left" }}
              >
                {f.q}
                <span style={{ width:28, height:28, borderRadius:999, border:"1px solid rgba(255,255,255,0.12)", display:"inline-flex", alignItems:"center", justifyContent:"center", color:openFaq===i?"#fff":C.faint, flexShrink:0, marginLeft:16, background:openFaq===i?"rgba(255,255,255,0.08)":"transparent", transition:"all .15s ease" }}>
                  {openFaq===i ? <Minus size={14} strokeWidth={2.5} /> : <Plus size={14} strokeWidth={2.5} />}
                </span>
              </button>
              {openFaq===i && <p className="font-body orl-rise-in" style={{ fontSize:14, color:C.muted, lineHeight:1.7, padding:"0 2px 24px", maxWidth:580 }}>{f.a}</p>}
            </div>
          ))}
          <div className="shimmer-divider" />
        </div>
      </section>

      {/* ═══════════════════════════════════════════
           FINAL CTA - image 2 style
           ═══════════════════════════════════════ */}
      <section className="gradient-section" style={{ borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
        <img src="/gradient-bg.png" alt="" className="gradient-bg-img orl-bg-drift-alt" aria-hidden="true" style={{ opacity:0.55 }} />
        <div className="gradient-overlay" />
        <div className="site-container text-center" style={{ padding:"120px 24px", position:"relative", zIndex:2 }}>
          <div className="font-body" style={{ fontSize:11, color:C.muted, fontWeight:700, letterSpacing:"0.14em", textTransform:"uppercase", marginBottom:18 }}>Get started</div>
          <h2 className="font-display" style={{ fontSize:"clamp(30px,5vw,58px)", color:"#fff", fontWeight:700, letterSpacing:"-0.04em", lineHeight:1.0, marginBottom:16 }}>
            See who's right,<br />right now.
          </h2>
          <p className="font-body" style={{ fontSize:15.5, color:C.muted, marginBottom:40, lineHeight:1.65, maxWidth:480, margin:"0 auto 40px" }}>
            Open the dashboard to browse live predictions, check trader records, and back your first Event Contract on DreamDEX.
          </p>
          <Btn variant="white" onClick={onLaunch} style={{ fontSize:15.5, padding:"17px 40px", fontWeight:800 }} extraClass="premium-btn">Launch App <ArrowRight size={15}/></Btn>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{ background:"#050709", borderTop:"1px solid rgba(255,255,255,0.05)" }}>
        <div className="site-container flex items-center justify-between" style={{ padding:"28px 40px", flexWrap:"wrap", gap:12 }}>
          <div className="flex items-center gap-2">
            <OracleLogo size={14} color={C.muted} />
            <span className="font-body" style={{ fontSize:12, color:C.muted }}>© 2026 Oracle · Built on DreamDEX · Somnia Shannon Testnet</span>
          </div>
          <div className="font-body" style={{ fontSize:12, color:C.faint }}>Chain 50312</div>
        </div>
      </footer>
    </div>
  );
}
