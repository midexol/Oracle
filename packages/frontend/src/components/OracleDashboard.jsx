import React, { useState, useEffect, useMemo } from "react";
import {
  ChevronUp,
  ChevronDown,
  Wallet,
  Check,
  Users,
  Flame,
  Trophy,
  Compass,
  LineChart,
  X as XIcon,
  Share2,
  Star,
  ArrowUpRight,
  Clock,
  TrendingUp,
  User,
  ArrowLeft,
  Target,
} from "lucide-react";
import TradingViewChart, { marketToSymbol, marketToInterval } from "./TradingViewChart";
import { getLeaderboard, getUserProfile, createPrediction, getAuthChallenge, verifyAuthSignature, setAuthToken } from "../services/api.js";

/* ================================================================== *
 *  ORACLE - product dashboard (premium redesign)
 *  DreamDEX-powered social prediction trading
 * ================================================================== */

const C = {
  bg: "#07090D",
  surface: "#0D1016",
  surfaceElevated: "#12161E",
  surfaceHover: "#171C25",
  border: "#1B2028",
  borderStrong: "#252C36",
  text: "#F4F6F8",
  muted: "#737B88",
  faint: "#454C57",
  up: "#20E58A",
  upSoft: "rgba(32,229,138,0.09)",
  upBorder: "rgba(32,229,138,0.30)",
  down: "#FF5263",
  downSoft: "rgba(255,82,99,0.09)",
  downBorder: "rgba(255,82,99,0.30)",
  gold: "#E0E4EC",
  goldSoft: "rgba(224,228,236,0.10)",
};

const GlobalStyles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');

    :root {
      --bg: ${C.bg}; --surface: ${C.surface}; --surface-elevated: ${C.surfaceElevated};
      --border: ${C.border}; --border-strong: ${C.borderStrong};
      --text: ${C.text}; --muted: ${C.muted}; --faint: ${C.faint};
      --up: ${C.up}; --down: ${C.down}; --gold: ${C.gold};
      --radius-sm: 6px; --radius-md: 10px; --radius-lg: 16px;
    }
    .font-display { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; letter-spacing: -0.02em; }
    .font-body { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 500; }
    .tnum { font-variant-numeric: tabular-nums; }
    .orc-root *, .orc-root *::before, .orc-root *::after { box-sizing: border-box; }
    .orc-root ::selection { background: rgba(32,229,138,0.22); }
    .orc-root button { font-family: inherit; }
    .orc-root button:focus-visible, .orc-root a:focus-visible, .orc-root input:focus-visible {
      outline: 2px solid ${C.up}; outline-offset: 2px;
    }

    @keyframes pulseDot { 0%,100% { opacity: 1; } 50% { opacity: .4; } }
    .live-dot { animation: pulseDot 1.9s ease-in-out infinite; }
    @keyframes riseIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    .rise-in { animation: riseIn .35s cubic-bezier(.2,.8,.2,1); }
    @keyframes rowIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
    .row-in { animation: rowIn .3s cubic-bezier(.2,.8,.2,1); }
    @keyframes ticker { from { transform: translateX(0); } to { transform: translateX(-50%); } }
    .ticker-track { animation: ticker 30s linear infinite; }
    @keyframes shimmer { 0% { background-position: -300px 0; } 100% { background-position: 300px 0; } }
    .skeleton { background: linear-gradient(90deg, #12161E 25%, #171C25 37%, #12161E 63%); background-size: 300px 100%; animation: shimmer 1.4s ease-in-out infinite; border-radius: 5px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .spin { animation: spin .8s linear infinite; }

    /* Button glow animation - subtle, not overpowering */
    @keyframes btnGlow {
      0%,100% { box-shadow: 0 0 6px rgba(32,229,138,0.18); }
      50%      { box-shadow: 0 0 16px rgba(32,229,138,0.28), 0 0 28px rgba(32,229,138,0.08); }
    }
    @keyframes btnGlowDown {
      0%,100% { box-shadow: 0 0 6px rgba(255,82,99,0.18); }
      50%      { box-shadow: 0 0 16px rgba(255,82,99,0.28), 0 0 28px rgba(255,82,99,0.08); }
    }
    @keyframes btnGlowGold {
      0%,100% { box-shadow: 0 0 6px rgba(255,255,255,0.10); }
      50%      { box-shadow: 0 0 14px rgba(255,255,255,0.18), 0 0 24px rgba(255,255,255,0.06); }
    }
    .glow-btn-up   { animation: btnGlow     3.5s ease-in-out infinite; }
    .glow-btn-down { animation: btnGlowDown 3.5s ease-in-out infinite; }
    .glow-btn-gold { animation: btnGlowGold 3.5s ease-in-out infinite; }

    /* Wallet connect — red/green flowing border like chat thinking indicator */
    @keyframes borderFlow { 
      0% { background-position: 0% 0%; }
      100% { background-position: 100% 0%; }
    }
    .wallet-glow-wrap { 
      position: relative; 
      z-index: 0;
      display: inline-block;
    }
    .wallet-glow-wrap::before {
      content: "";
      position: absolute;
      inset: -2px;
      border-radius: inherit;
      padding: 2px;
      background: linear-gradient(90deg, #20E58A, #FF5263, #20E58A, #FF5263, #20E58A);
      background-size: 200% 100%;
      animation: borderFlow 2s linear infinite;
      -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
      -webkit-mask-composite: xor;
      mask-composite: exclude;
      pointer-events: none;
      z-index: -1;
    }
    .wallet-glow-wrap > .btn { 
      position: relative; 
      z-index: 1;
    }

    /* Background is completely static — no drift/pan animation at all,
       eliminating any possibility of a pan revealing bare space at an edge. */
    .bg-drift { }
    .bg-drift-alt { }

    .hover-row { transition: background .15s ease, border-color .15s ease; }
    .btn { transition: filter .15s ease, transform .08s ease; }
    .btn:active { transform: scale(0.985); }
    .btn:hover { filter: brightness(1.1); }
    .link-btn { transition: opacity .15s ease; }
    .link-btn:hover { opacity: 0.7; }

    .orc-root .container { max-width: 900px; margin: 0 auto; padding: 0 24px; }
    .orc-root .page { padding: 26px 0 100px; }

    /* ── Glass card (image 6 style) ── */
    .glass-card {
      background: rgba(13,16,22,0.55);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      border: 1px solid rgba(255,255,255,0.07);
      border-radius: 18px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -1px 0 rgba(0,0,0,0.3);
      position: relative;
      overflow: hidden;
    }
    .glass-card::before {
      content: "";
      position: absolute;
      top: 0; left: 0; right: 0; height: 1px;
      background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.14) 40%, rgba(255,255,255,0.08) 60%, transparent 100%);
    }
    .glass-card:hover {
      border-color: rgba(255,255,255,0.12);
      box-shadow: 0 12px 44px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.08);
    }

    /* Prediction card in discover */
    .pred-card {
      background: rgba(10,13,19,0.72);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255,255,255,0.07);
      border-radius: 16px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05);
      margin-bottom: 16px;
      overflow: hidden;
      transition: border-color .2s ease, box-shadow .2s ease;
    }
    .pred-card:hover {
      border-color: rgba(255,255,255,0.13);
      box-shadow: 0 8px 36px rgba(0,0,0,0.6);
    }

    /* Navbar pill tabs (image 8 style) */
    .nav-pill-tabs {
      display: flex;
      align-items: center;
      gap: 2px;
      background: rgba(18,22,30,0.7);
      border: 1px solid rgba(255,255,255,0.07);
      border-radius: 999px;
      padding: 3px;
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
    }
    .nav-pill-tab {
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 12.5px;
      font-weight: 500;
      padding: 6px 16px;
      border-radius: 999px;
      border: none;
      cursor: pointer;
      transition: background .18s ease, color .18s ease;
      white-space: nowrap;
    }
    .nav-pill-tab.active {
      background: #fff;
      color: #07090D;
      font-weight: 700;
    }
    .nav-pill-tab.inactive {
      background: transparent;
      color: ${C.muted};
    }
    .nav-pill-tab.inactive:hover {
      color: ${C.text};
    }

    /* Filter pill tabs (image 7 style) */
    .filter-pill-tabs {
      display: flex;
      align-items: center;
      gap: 2px;
      background: rgba(13,16,22,0.8);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 999px;
      padding: 3px;
    }
    .filter-pill-tab {
      font-family: 'Inter', sans-serif;
      font-size: 12px;
      font-weight: 500;
      padding: 5px 14px;
      border-radius: 999px;
      border: none;
      cursor: pointer;
      transition: background .15s ease, color .15s ease;
    }
    .filter-pill-tab.active {
      background: rgba(255,255,255,0.95);
      color: #07090D;
      font-weight: 700;
    }
    .filter-pill-tab.inactive {
      background: transparent;
      color: ${C.muted};
    }
    .filter-pill-tab.inactive:hover { color: ${C.text}; }

    /* Leaderboard podium bars */
    .podium-bar {
      border-radius: 8px 8px 0 0;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding-top: 10px;
    }

    /* Profile hero */
    .profile-hero {
      position: relative;
      overflow: hidden;
      border-radius: 20px;
      padding: 28px 24px 24px;
      background: rgba(13,16,22,0.7);
      backdrop-filter: blur(20px);
      border: 1px solid rgba(255,255,255,0.08);
    }
    .profile-hero::before {
      content: "";
      position: absolute; inset: 0;
      background: radial-gradient(ellipse 400px 300px at 70% -20%, rgba(32,229,138,0.1), transparent 70%);
      pointer-events: none;
    }

    .orc-root .nav-links { display: flex; align-items: center; gap: 30px; }
    .orc-root .bottom-nav { display: none; }

    /* Desktop nav: horizontal top bar restored (sidebar markup kept in the
       DOM below but hidden at all sizes) */
    .orc-root .app-topbar-row { display: flex; }
    .orc-root .app-sidebar {
      display: none;
      flex-direction: column;
      position: fixed;
      top: 0; left: 0; bottom: 0;
      width: 220px;
      padding: 22px 14px;
      background: rgba(7,9,13,0.92);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
      border-right: 1px solid rgba(255,255,255,0.06);
      z-index: 25;
      gap: 4px;
    }
    .orc-root .app-sidebar-logo {
      display: flex; align-items: center; gap: 8px;
      padding: 6px 10px 26px;
      background: none; border: none; cursor: pointer;
    }
    .orc-root .app-sidebar-link {
      display: flex; align-items: center; gap: 12px;
      width: 100%; text-align: left;
      background: none; border: none; cursor: pointer;
      padding: 11px 14px; border-radius: 10px;
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 13.5px; font-weight: 600;
      color: ${C.muted};
      transition: background .15s ease, color .15s ease;
    }
    .orc-root .app-sidebar-link:hover { background: rgba(255,255,255,0.05); color: ${C.text}; }
    .orc-root .app-sidebar-link.active { background: rgba(32,229,138,0.1); color: ${C.up}; }
    .orc-root .app-sidebar-footer { margin-top: auto; display: flex; flex-direction: column; gap: 8px; }
    .orc-root .app-shell-content { padding-left: 0; }

    .orc-root .market-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .orc-root .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); }
    .orc-root .battle-grid { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 18px; }
    .orc-root .trade-split { display: grid; grid-template-columns: 1fr 1fr; }

    /* Section bg image container */
    .section-bg-wrap {
      position: fixed;
      inset: 0;
      pointer-events: none;
      overflow: hidden;
      z-index: 0;
    }
    .section-bg-img {
      position: absolute;
      object-fit: cover;
      object-position: 74% 58%; /* frames the large sphere in this artwork
        instead of the sparse gap that a default center-crop can land on
        when a wide, sparsely-composed image is cropped into a narrow
        portrait viewport */
    }

    /* ── Mobile optimizations — no overlapping ── */
    @media (max-width: 1024px) {
      .orc-root .container { padding: 0 20px; }
      .orc-root .page { padding: 24px 0; }
      .orc-root .glass-card { border-radius: 12px; }
      .orc-root h1 { font-size: clamp(24px, 5vw, 48px); }
    }
    
    @media (max-width: 768px) {
      .orc-root .nav-links { display: none; }
      .orc-root .bottom-nav { display: flex; }
      .orc-root .page { padding: 24px 0 120px 0; }
      .orc-root .nav-pill-tabs { display: none; }
      .orc-root .container { padding: 0 16px; }
      .orc-root .app-sidebar { display: none; }
      .orc-root .app-topbar-row { display: flex; }
      .orc-root .app-shell-content { padding-left: 0; }
      
      /* Better spacing on tablet */
      .orc-root .glass-card { padding: 16px !important; border-radius: 12px; }
      .orc-root .pred-card { border-radius: 12px; }
      .orc-root .pred-card .btn { min-height: 44px; }
      
      /* Fix grid layouts */
      .orc-root .market-grid { grid-template-columns: 1fr; gap: 16px; }
      .orc-root .stats-grid { grid-template-columns: repeat(2, 1fr); gap: 16px; }
      .orc-root .battle-grid { grid-template-columns: 1fr; gap: 12px; text-align: center; }
      
      /* Better button sizing */
      .orc-root .btn { 
        min-height: 44px; 
        padding: 12px 18px !important;
        border-radius: 10px;
        font-size: 13px;
      }
      
      /* Modal adjustments */
      .glass-card { 
        width: calc(100% - 32px) !important;
        max-width: 100% !important;
        margin: 0 auto;
      }
      
      /* Profile optimizations */
      .orc-root .profile-hero { margin-bottom: 16px; }
      .orc-root .profile-hero .flex { flex-wrap: wrap; gap: 16px; }
      
      /* Fix prediction detail view */
      .orc-root .container.page { max-width: 100% !important; }
    }
    
    @media (max-width: 640px) {
      .orc-root .container { padding: 0 12px; }
      .orc-root .page { padding: 20px 0 120px 0; }
      
      /* Responsive typography */
      .orc-root h1 { font-size: clamp(20px, 4vw, 36px); line-height: 1.2; }
      .orc-root h2 { font-size: clamp(18px, 3.5vw, 28px); }
      
      /* Better spacing for small screens */
      .orc-root .glass-card { 
        padding: 14px !important; 
        border-radius: 10px;
        margin-bottom: 12px;
      }
      .orc-root .pred-card { 
        border-radius: 10px;
        padding: 0 !important;
      }
      
      /* Grid fixes */
      .orc-root .market-grid { grid-template-columns: 1fr; gap: 12px; }
      .orc-root .stats-grid { 
        grid-template-columns: repeat(2, 1fr); 
        gap: 12px; 
      }
      .orc-root .battle-grid { 
        grid-template-columns: 1fr; 
        gap: 10px; 
        text-align: center; 
      }
      
      /* Touch-friendly buttons */
      .orc-root .btn {
        min-height: 44px;
        min-width: 44px;
        padding: 12px 16px !important;
        border-radius: 8px;
        font-size: 12px;
        width: 100%;
      }
      
      .orc-root .btn.full { width: 100%; }
      
      /* Nav adjustments */
      .orc-root .page { margin-top: 0; }
      .orc-root nav { height: auto; }
      
      /* Feed cards */
      .orc-root .pred-card { 
        border-radius: 10px;
        overflow: hidden;
        margin-bottom: 12px;
      }
      .orc-root .pred-card .flex { flex-wrap: wrap; gap: 8px; }
      
      /* Avatar sizing */
      .orc-root .avatar { width: 32px; height: 32px; }
      
      /* Modal fixes */
      .glass-card {
        width: calc(100% - 24px) !important;
        max-width: calc(100% - 24px) !important;
        margin: 0 auto;
        padding: 20px !important;
        border-radius: 14px;
      }
      
      /* Trade modal */
      .orc-root .trade-split { 
        display: flex; 
        gap: 8px;
      }
      .orc-root .trade-split button { 
        flex: 1;
        min-height: 48px;
      }
      
      /* Profile page */
      .orc-root .profile-hero {
        padding: 16px;
        border-radius: 12px;
        margin-bottom: 16px;
      }
      .orc-root .profile-hero .text-right { text-align: left; }

      /* Leaderboard */
      .orc-root .podium-bar { min-height: 60px; }
      .orc-root .avatar { margin: 0 auto; }
      
      /* Prevent overlapping in list items */
      .orc-root .hover-row {
        padding: 12px 14px;
        gap: 12px;
        min-height: 52px;
      }
      
      /* Ticker adjustments */
      .ticker-track { font-size: 10px; }
      
      /* Input fields */
      .orc-root input { 
        min-height: 44px;
        padding: 10px 12px !important;
        border-radius: 8px;
        font-size: 14px;
      }
      
      /* Select/dropdown like elements */
      .orc-root button[style*="select"], 
      .orc-root button[style*="Select"] {
        min-height: 40px;
        padding: 8px 12px;
      }
      
      /* Fix battle view layout */
      .orc-root .battle-grid { 
        grid-template-columns: 1fr;
      }
      
      /* Better spacing in flex containers */
      .orc-root .flex { gap: 8px !important; }
      .orc-root .flex.items-center { gap: 8px; }
      
      /* Prevent text overflow */
      .orc-root .font-display,
      .orc-root .font-body {
        word-break: break-word;
        overflow-wrap: break-word;
      }
      
      /* Wallet button alignment */
      .orc-root .wallet-glow-wrap { display: block; width: 100%; }
      
      /* Better margin for sections */
      .orc-root .container.page > div { margin-bottom: 16px; }
    }
    
    @media (max-width: 480px) {
      .orc-root .container { padding: 0 10px; }
      .orc-root .page { padding: 16px 0 120px 0; }
      
      /* Extra small screen optimizations */
      .orc-root h1 { font-size: clamp(18px, 3.5vw, 28px); }
      .orc-root .glass-card { padding: 12px !important; }
      .orc-root .btn { font-size: 11px; padding: 10px 12px !important; }
      
      /* Reduce gaps on very small screens */
      .orc-root .flex { gap: 6px !important; }
      .orc-root .market-grid,
      .orc-root .stats-grid { gap: 10px; }
      
      /* Compact modals */
      .glass-card { width: calc(100% - 16px) !important; padding: 14px !important; }
      
      /* Fix overlapping text */
      .orc-root .font-display { font-size: 14px; }
      .orc-root .font-body { font-size: 12px; }
    }

    /* ── Ultra-minimal scrollbar ── */
    .orc-root ::-webkit-scrollbar { width: 3px; height: 3px; }
    .orc-root ::-webkit-scrollbar-track { background: transparent; }
    .orc-root ::-webkit-scrollbar-thumb {
      background: rgba(255,255,255,0.055);
      border-radius: 999px;
    }
    .orc-root ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.12); }
    .orc-root * { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.055) transparent; }
  `}</style>
);

/* ──────────────────── Live market data ──────────────────── */

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
    minimumFractionDigits: num >= 100 ? 2 : 2,
    maximumFractionDigits: num >= 100 ? 2 : 3,
  }).format(num);
}

function formatSignedPercent(value) {
  return `${value >= 0 ? "+" : ""}${Number(value || 0).toFixed(2)}%`;
}

function shortAddress(address) {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

const COINBASE_PRODUCTS = { BTC: "BTC-USD", ETH: "ETH-USD", SOL: "SOL-USD", AVAX: "AVAX-USD" };
function assetToCoinbaseProduct(asset) {
  return COINBASE_PRODUCTS[asset?.toUpperCase()] || "BTC-USD";
}

function formatTimeAgo(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return `${m}m`;
}

function makeLiveCountdown() {
  const totalSeconds = 15 * 60;
  const elapsed = Math.floor((Date.now() / 1000) % totalSeconds);
  const remaining = Math.max(0, totalSeconds - elapsed);
  const minutes = String(Math.floor(remaining / 60)).padStart(2, "0");
  const seconds = String(remaining % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function normalizeMarketPrice(asset, liveData) {
  const base = liveData?.[asset]?.price ?? FALLBACK_MARKETS[asset]?.price ?? 1;
  const change = liveData?.[asset]?.change ?? FALLBACK_MARKETS[asset]?.change ?? 0;
  return {
    asset,
    price: Number(base.toFixed(2)),
    realPrice: Number(base.toFixed(2)),
    change: Number(change.toFixed(2)),
  };
}

const predictor = {
  name: "Mide",
  score: 82,
  accuracy: 74,
  count: 63,
  correct: 47,
  joined: "Jan 2026",
  specialties: [
    { market: "BTC 15M", acc: 78 },
    { market: "BTC 1H", acc: 72 },
    { market: "ETH 15M", acc: 67 },
  ],
  history: [
    { market: "BTC", dir: "UP", price: 43, result: "win" },
    { market: "ETH", dir: "DOWN", price: 57, result: "win" },
    { market: "BTC", dir: "DOWN", price: 61, result: "loss" },
    { market: "BTC", dir: "UP", price: 48, result: "win" },
    { market: "SOL", dir: "UP", price: 39, result: "loss" },
  ],
};

const leaderboard = [
  { rank: 1, name: "Alpha", initials: "AL", acc: 78, count: 91 },
  { rank: 2, name: "Mide", initials: "MI", acc: 74, count: 63 },
  { rank: 3, name: "QuantX", initials: "QU", acc: 71, count: 118 },
  { rank: 4, name: "NovaRae", initials: "NR", acc: 65, count: 44 },
  { rank: 5, name: "Boone", initials: "BO", acc: 61, count: 205 },
];

function scoreTier(score) {
  if (score >= 80) return "ELITE";
  if (score >= 60) return "SHARP";
  return "RISING";
}

/* ──────────────────── Atoms ──────────────────── */

function OracleLogo({ size = 20, color = C.text }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.6" />
      <circle cx="12" cy="7.6" r="2.1" fill={color} />
    </svg>
  );
}

function LiveDot({ label = "LIVE" }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="live-dot" style={{ width: 5, height: 5, borderRadius: 999, background: C.up, display: "inline-block" }} />
      <span className="font-body" style={{ fontSize: 10, color: C.muted, letterSpacing: "0.10em", fontWeight: 600 }}>{label}</span>
    </span>
  );
}

function PriceDisplay({ value, unit = "$", size = 32, color }) {
  const numericValue = Number(value ?? 0);
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: numericValue >= 100 ? 2 : 2,
    maximumFractionDigits: numericValue >= 100 ? 2 : 3,
  }).format(numericValue);
  const [whole, dec] = formatted.includes(".") ? formatted.split(".") : [formatted, null];
  // size can be a plain number (px) or any CSS length/clamp() string for
  // responsive call sites — calc() supports multiplying either form.
  const unitSize = typeof size === "number" ? size * 0.55 : `calc(${size} * 0.55)`;

  return (
    <span className="font-display tnum" style={{ fontSize: size, fontWeight: 700, letterSpacing: "-0.04em", color: color || C.text }}>
      {whole}
      {dec && <span style={{ color: C.faint, fontWeight: 600 }}>.{dec}</span>}
      <span style={{ color: C.faint, fontWeight: 600, fontSize: unitSize }}>{unit}</span>
    </span>
  );
}

function DirectionBadge({ dir, size = "md" }) {
  const up = dir === "UP";
  const pad = size === "sm" ? "3px 8px" : "5px 11px";
  return (
    <span
      className="font-display inline-flex items-center gap-1"
      aria-label={`Direction: ${dir}`}
      style={{
        color: up ? C.up : C.down,
        background: up ? C.upSoft : C.downSoft,
        border: `1px solid ${up ? C.upBorder : C.downBorder}`,
        padding: pad,
        borderRadius: "var(--radius-sm)",
        fontWeight: 700,
        fontSize: size === "sm" ? 11 : 12,
        letterSpacing: "0.02em",
      }}
    >
      {up ? <ChevronUp size={12} strokeWidth={3} /> : <ChevronDown size={12} strokeWidth={3} />}
      {dir}
    </span>
  );
}

function Avatar({ initials, size = 36, live }) {
  // Deterministic color from initials for visual variety (still B&W palette)
  const shades = ["#1A1F2A", "#141820", "#0F1319", "#1C2130", "#11151D"];
  const shade = shades[(initials?.charCodeAt(0) ?? 0) % shades.length];
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <div
        style={{
          width: size, height: size, borderRadius: 999,
          background: shade,
          border: `1.5px solid ${C.borderStrong}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          overflow: "hidden",
          boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
        }}
      >
        <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="8" r="4" fill="rgba(255,255,255,0.72)" />
          <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="rgba(255,255,255,0.72)" strokeWidth="1.6" strokeLinecap="round" fill="none" />
        </svg>
      </div>
      {live && (
        <span style={{ position: "absolute", bottom: -1, right: -1, width: size * 0.28, height: size * 0.28, borderRadius: 999, background: C.up, border: `2px solid ${C.bg}` }} />
      )}
    </div>
  );
}

/* Glowing button with light animation behind it */
function Button({ children, variant = "primary", onClick, style: extra = {}, full, ariaLabel, glow = false, walletGlow = false }) {
  const base = {
    fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 13.5,
    letterSpacing: "0.02em", padding: "13px 22px", borderRadius: "999px",
    border: "1px solid transparent", cursor: "pointer", width: full ? "100%" : "auto",
    position: "relative",
  };
  let style = { ...base };
  let glowClass = "";

  if (variant === "primary") style = { ...style, background: C.text, color: C.bg };
  if (variant === "up") {
    style = {
      ...style,
      background: "linear-gradient(135deg, #20E58A 0%, #18C97A 100%)",
      color: "#04180E",
    };
    if (glow) glowClass = "glow-btn-up";
  }
  if (variant === "down") {
    style = {
      ...style,
      background: "linear-gradient(135deg, #FF5263 0%, #E03E4E 100%)",
      color: "#26050A",
    };
    if (glow) glowClass = "glow-btn-down";
  }
  if (variant === "ghost") {
    style = {
      ...style,
      background: "rgba(18,22,30,0.7)",
      color: C.text,
      border: `1px solid rgba(255,255,255,0.1)`,
      backdropFilter: "blur(10px)",
    };
  }
  if (variant === "gold") {
    style = {
      ...style,
      background: "rgba(255,255,255,0.95)",
      color: "#07090D",
      border: "1px solid rgba(255,255,255,0.2)",
    };
    if (glow) glowClass = "glow-btn-gold";
  }

  const btn = (
    <button className={`btn ${glowClass}`} onClick={onClick} aria-label={ariaLabel} style={{ ...style, ...extra }}>
      {children}
    </button>
  );

  if (walletGlow) {
    return <span className="wallet-glow-wrap" style={{ borderRadius: 999, display: full ? "block" : "inline-block" }}>{btn}</span>;
  }
  return btn;
}

function Stat({ label, value, accent }) {
  return (
    <div>
      <div className="font-display tnum" style={{ fontSize: 25, color: accent || C.text, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1 }}>
        {value}
      </div>
      <div className="font-body" style={{ fontSize: 10.5, color: C.muted, marginTop: 7, textTransform: "uppercase", letterSpacing: "0.08em" }}>
        {label}
      </div>
    </div>
  );
}

/* Glass panel matching image 6 */
function Panel({ children, style: extra = {}, pad = 16 }) {
  return (
    <div
      className="glass-card"
      style={{ padding: pad, ...extra }}
    >
      {children}
    </div>
  );
}

function SectionLabel({ children, right }) {
  return (
    <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
      <div className="font-body" style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, letterSpacing: "0.10em", textTransform: "uppercase" }}>
        {children}
      </div>
      {right}
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.08) 30%, rgba(255,255,255,0.06) 70%, transparent)", margin: "20px 0" }} />;
}

function ScoreGauge({ score, size = 92 }) {
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - score / 100);
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke={C.border} strokeWidth="5" fill="none" />
        <circle
          cx={size / 2} cy={size / 2} r={r} stroke="#E0E4EC" strokeWidth="5" fill="none"
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset .6s cubic-bezier(.2,.8,.2,1)", filter: "drop-shadow(0 0 4px rgba(255,255,255,0.28))" }}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span className="font-display tnum" style={{ fontSize: size * 0.3, fontWeight: 700, color: C.text, letterSpacing: "-0.03em" }}>{score}</span>
      </div>
    </div>
  );
}

/* ──────────────────── Ticker ──────────────────── */

function TickerStrip({ tickerData }) {
  const row = [...tickerData, ...tickerData];
  return (
    <div style={{ borderBottom: `1px solid rgba(255,255,255,0.05)`, background: "rgba(7,9,13,0.8)", backdropFilter: "blur(10px)", overflow: "hidden", padding: "5px 0" }}>
      <div className="ticker-track flex" style={{ width: "max-content" }}>
        {row.map((t, i) => (
          <div key={i} className="flex items-center gap-2 font-body tnum" style={{ fontSize: 11.5, whiteSpace: "nowrap", padding: "0 18px", borderRight: i % tickerData.length !== tickerData.length - 1 ? `1px solid rgba(255,255,255,0.06)` : "none" }}>
            <span style={{ color: C.muted, fontWeight: 600 }}>{t.a}</span>
            <span style={{ color: C.text }}>{t.p}</span>
            <span style={{ color: t.chg >= 0 ? C.up : C.down, fontWeight: 600 }}>{formatSignedPercent(t.chg)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ──────────────────── Nav (image 8 style pill tabs) ──────────────────── */

function Nav({ view, setView, wallet, walletBalance, signedIn, connectWallet, onExit, tickerData }) {
  const items = [
    ["feed", "Discover"],
    ["market", "Markets"],
    ["predict", "Predict"],
    ["battle", "Battles"],
    ["leaderboard", "Rankings"],
  ];
  const mobileItems = [
    ["feed", "Discover", Compass],
    ["market", "Markets", LineChart],
    ["predict", "Predict", Target],
    ["battle", "Battles", Flame],
    ["leaderboard", "Rankings", Trophy],
    ["profile", "Profile", User],
  ];
  const sidebarItems = [
    ["feed", "Discover", Compass],
    ["market", "Markets", LineChart],
    ["predict", "Predict", Target],
    ["battle", "Battles", Flame],
    ["leaderboard", "Rankings", Trophy],
  ];

  const mainViews = ["feed", "market", "predict", "battle", "leaderboard"];
  const activeTab = view === "profile" ? "profile" : mainViews.includes(view) ? view : null;

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="app-sidebar" aria-label="Main navigation">
        <button
          onClick={() => setView("feed")}
          className="app-sidebar-logo link-btn"
          aria-label="Oracle home"
        >
          <OracleLogo size={19} color={C.text} />
          <span className="font-display" style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em", color: C.text }}>ORACLE</span>
        </button>

        <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {sidebarItems.map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={`app-sidebar-link ${activeTab === key ? "active" : ""}`}
              aria-current={activeTab === key ? "page" : undefined}
            >
              <Icon size={18} strokeWidth={2} />
              {label}
            </button>
          ))}
        </nav>

        <div className="app-sidebar-footer">
          <button
            onClick={() => setView("profile")}
            className={`app-sidebar-link ${view === "profile" ? "active" : ""}`}
            aria-current={view === "profile" ? "page" : undefined}
          >
            <User size={18} strokeWidth={2} />
            Profile
          </button>
          {wallet ? (
            <button
              onClick={() => setView("profile")}
              className="font-body tnum flex items-center gap-2 link-btn"
              style={{
                fontSize: 12, color: C.text,
                background: "rgba(18,22,30,0.8)",
                border: "1px solid rgba(255,255,255,0.1)",
                padding: "9px 12px", borderRadius: 10, cursor: "pointer",
              }}
              aria-label="View your profile"
            >
              <span
                title={signedIn ? "Signed in" : "Connected, not signed in"}
                style={{ width: 6, height: 6, borderRadius: 999, background: signedIn ? C.up : C.muted, display: "inline-block", boxShadow: signedIn ? `0 0 6px ${C.up}` : "none" }}
              />
              {wallet}
            </button>
          ) : (
            <Button variant="ghost" onClick={connectWallet} ariaLabel="Connect wallet" walletGlow full>
              <span className="flex items-center gap-2"><Wallet size={13} /> Connect</span>
            </Button>
          )}
          {onExit && (
            <button
              onClick={onExit}
              className="font-body link-btn"
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: C.muted, display: "flex", alignItems: "center", gap: 5, padding: "8px 10px" }}
              aria-label="Back to site"
            >
              <ArrowLeft size={14} strokeWidth={2} /> Back to site
            </button>
          )}
        </div>
      </aside>

      <div style={{
        position: "sticky", top: 0, zIndex: 20,
        background: "rgba(5,7,10,0.9)",
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}>
      <div className="app-topbar-row container flex items-center justify-between" style={{ height: 62 }}>
        {/* Left: logo + back */}
        <div className="flex items-center" style={{ gap: 20 }}>
          {onExit && (
            <button
              onClick={onExit}
              className="font-body link-btn"
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: C.muted, display: "flex", alignItems: "center", gap: 5 }}
              aria-label="Back to site"
            >
              <ArrowLeft size={14} strokeWidth={2} /> Site
            </button>
          )}
          <button
            onClick={() => setView("feed")}
            className="flex items-center gap-2 link-btn"
            style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
            aria-label="Oracle home"
          >
            <OracleLogo size={19} color={C.text} />
            <span className="font-display" style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em", color: C.text }}>ORACLE</span>
          </button>
        </div>

        {/* Center: pill tab bar (image 8 style) */}
        <nav className="nav-pill-tabs" aria-label="Main navigation">
          {items.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={`nav-pill-tab ${activeTab === key ? "active" : "inactive"}`}
              aria-current={activeTab === key ? "page" : undefined}
            >
              {label}
            </button>
          ))}
        </nav>

        {/* Right: profile icon + wallet */}
        <div className="flex items-center" style={{ gap: 8 }}>
          <button
            onClick={() => setView("profile")}
            className="link-btn"
            style={{
              background: view === "profile" ? "rgba(32,229,138,0.12)" : "rgba(18,22,30,0.8)",
              border: `1px solid ${view === "profile" ? "rgba(32,229,138,0.3)" : "rgba(255,255,255,0.1)"}`,
              backdropFilter: "blur(10px)",
              padding: "7px 10px", borderRadius: 999, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: view === "profile" ? C.up : C.muted,
            }}
            aria-label="View profile"
            aria-current={view === "profile" ? "page" : undefined}
          >
            <User size={16} strokeWidth={2} />
          </button>
          {wallet ? (
            <button
              onClick={() => setView("profile")}
              className="font-body tnum flex items-center gap-2 link-btn"
              style={{
                fontSize: 12, color: C.text,
                background: "rgba(18,22,30,0.8)",
                border: "1px solid rgba(255,255,255,0.1)",
                backdropFilter: "blur(10px)",
                padding: "7px 12px", borderRadius: 999, cursor: "pointer",
              }}
              aria-label="View your profile"
            >
              <span
                title={signedIn ? "Signed in" : "Connected, not signed in"}
                style={{ width: 6, height: 6, borderRadius: 999, background: signedIn ? C.up : C.muted, display: "inline-block", boxShadow: signedIn ? `0 0 6px ${C.up}` : "none" }}
              />
              {wallet}
              {walletBalance != null && (
                <span style={{ color: C.muted, fontWeight: 500 }}>· {walletBalance.toFixed(4)} ETH</span>
              )}
            </button>
          ) : (
            <Button variant="ghost" onClick={connectWallet} ariaLabel="Connect wallet" walletGlow>
              <span className="flex items-center gap-2"><Wallet size={13} /> Connect</span>
            </Button>
          )}
        </div>
      </div>

      <TickerStrip tickerData={tickerData} />
      </div>

      {/* Mobile bottom nav — rendered outside the backdrop-filtered header,
          since backdrop-filter creates a containing block for fixed descendants
          and would pin "bottom:0" to the header box instead of the viewport. */}
      <div className="bottom-nav" style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "rgba(7,9,13,0.95)", backdropFilter: "blur(16px)", borderTop: `1px solid rgba(255,255,255,0.07)`, zIndex: 30, padding: "6px 2px 8px" }}>
        <div className="flex items-center justify-around" style={{ width: "100%" }}>
      {mobileItems.map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className="flex flex-col items-center gap-1 font-body"
              style={{ background: "none", border: "none", cursor: "pointer", color: activeTab === key ? C.up : C.muted, fontSize: 9, fontWeight: 600, padding: "2px 4px", minWidth: 0 }}
              aria-current={activeTab === key ? "page" : undefined}
            >
              <Icon size={16} strokeWidth={2} />
              {label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

/* ──────────────────── Discover / Feed (social-native) ──────────────────── */

function PredictionCard({ p, onOpen, onBack }) {
  const up = p.dir === "UP";
  return (
    <div
      className="pred-card"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(p)}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(p); }}
      style={{ cursor: "pointer" }}
    >
      {/* Card header - X/Twitter style with @handle */}
      <div className="flex items-center justify-between" style={{ padding: "16px 18px 12px" }}>
        <div className="flex items-center gap-2.5">
          <Avatar initials={p.initials} size={40} live />
          <div>
            <div className="font-body" style={{ fontSize: 14, color: C.text, fontWeight: 700 }}>@{p.user}</div>
            <div className="font-body tnum" style={{ fontSize: 11, color: C.muted }}>{p.userAcc}% overall accuracy</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <LiveDot />
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: C.muted, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.07)", padding: "3px 8px", borderRadius: 999 }}>
            {p.contractId}
          </span>
        </div>
      </div>

      {/* Prediction "post" body */}
      <div style={{ padding: "0 18px 0", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="flex items-center justify-between" style={{ paddingTop: 14, marginBottom: 8 }}>
          <div>
            <div className="font-display" style={{ fontSize: 22, color: C.text, fontWeight: 700, letterSpacing: "-0.02em", marginBottom: 4 }}>{p.market}</div>
            <div className="font-body" style={{ fontSize: 12.5, color: C.muted }}>{p.question}</div>
          </div>
          <DirectionBadge dir={p.dir} />
        </div>

        {/* Stats row - 3 columns with dividers */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", marginTop: 14, marginBottom: 14, borderTop: "1px solid rgba(255,255,255,0.05)", borderBottom: "1px solid rgba(255,255,255,0.05)", padding: "12px 0" }}>
          {[
            { label: "DREAMDEX", value: formatUsd(p.price), color: up ? C.up : C.down },
            { label: p.asset + " ACC.", value: Math.round(p.marketAcc) + "%", color: C.text },
            { label: "TIME LEFT", value: p.time, color: C.gold },
          ].map((s, i) => (
            <div key={i} style={{ textAlign: "center", borderRight: i < 2 ? "1px solid rgba(255,255,255,0.06)" : "none", padding: "0 4px" }}>
              <div className="font-body" style={{ fontSize: 8.5, color: C.muted, fontWeight: 700, letterSpacing: "0.06em", marginBottom: 4, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.label}</div>
              <div className="font-display tnum" style={{ fontSize: 14, fontWeight: 700, color: s.color, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Back button - full width */}
        <div style={{ paddingBottom: 14 }}>
          <Button
            variant={up ? "up" : "down"}
            full glow
            onClick={(e) => { e.stopPropagation(); onBack(p); }}
            ariaLabel={`Back ${p.dir} on ${p.market}`}
            style={{ borderRadius: 10, fontSize: 14, padding: "14px 20px" }}
          >
            Back {p.dir}
          </Button>
        </div>
      </div>

      {/* Social engagement footer */}
      <div className="flex items-center gap-4" style={{ padding: "9px 18px", borderTop: "1px solid rgba(255,255,255,0.04)", background: "rgba(0,0,0,0.18)" }}>
        <span className="font-body" style={{ fontSize: 11, color: C.faint, display: "flex", alignItems: "center", gap: 4 }}>
          <Users size={11} /> {p.watched || "1,284"} watching
        </span>
        <span className="font-body" style={{ fontSize: 11, color: C.faint, display: "flex", alignItems: "center", gap: 4 }}>
          <TrendingUp size={11} /> {p.backed || "312"} backed
        </span>
        <span className="font-body" style={{ fontSize: 11, color: C.faint, marginLeft: "auto" }}>
          {p.time} left
        </span>
      </div>
    </div>
  );
}

function FeedSkeleton() {
  return (
    <div className="pred-card" style={{ padding: "18px" }}>
      <div className="skeleton" style={{ width: 140, height: 12, marginBottom: 14 }} />
      <div className="skeleton" style={{ width: 180, height: 22, marginBottom: 10 }} />
      <div className="skeleton" style={{ width: "100%", height: 46, marginBottom: 14 }} />
      <div className="skeleton" style={{ width: "100%", height: 44, borderRadius: 10 }} />
    </div>
  );
}

/* Create Prediction Modal */
function CreatePredModal({ onClose, onSubmit }) {
  const [market, setMarket] = useState("BTC 15M");
  const [dir, setDir] = useState("UP");
  const [stake, setStake] = useState(5);
  const markets = ["BTC 15M", "BTC 1H", "ETH 15M", "ETH 1H", "SOL 15M"];

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(4,5,7,0.82)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: "16px", overflowY: "auto" }} onClick={onClose}>
      <div className="rise-in glass-card" style={{ padding: "clamp(16px, 3vw, 28px)", width: "clamp(280px, 90vw, 400px)", maxWidth: "100%" }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between" style={{ marginBottom: 22 }}>
          <div className="font-display" style={{ fontSize: "clamp(14px, 3vw, 18px)", color: C.text, fontWeight: 700 }}>Make a Prediction</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, flexShrink: 0 }}><XIcon size={16} /></button>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div className="font-body" style={{ fontSize: "clamp(10px, 1.8vw, 11px)", color: C.muted, fontWeight: 700, letterSpacing: "0.10em", marginBottom: 8 }}>MARKET</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {markets.map(m => (
              <button key={m} onClick={() => setMarket(m)} className="font-body"
                style={{ padding: "6px 12px", borderRadius: 999, border: `1px solid ${market === m ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.08)"}`, background: market === m ? "rgba(255,255,255,0.1)" : "transparent", color: market === m ? C.text : C.muted, fontSize: "clamp(11px, 1.8vw, 12.5px)", fontWeight: 600, cursor: "pointer", minHeight: 32 }}>
                {m}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div className="font-body" style={{ fontSize: "clamp(10px, 1.8vw, 11px)", color: C.muted, fontWeight: 700, letterSpacing: "0.10em", marginBottom: 8 }}>PREDICTION</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {["UP", "DOWN"].map(d => (
              <button key={d} onClick={() => setDir(d)}
                style={{ padding: "14px", borderRadius: 10, border: `1px solid ${dir === d ? (d === "UP" ? C.upBorder : C.downBorder) : "rgba(255,255,255,0.07)"}`, background: dir === d ? (d === "UP" ? C.upSoft : C.downSoft) : "transparent", color: dir === d ? (d === "UP" ? C.up : C.down) : C.muted, fontSize: "clamp(12px, 2vw, 14px)", fontWeight: 700, cursor: "pointer", fontFamily: "'Plus Jakarta Sans',sans-serif", letterSpacing: "0.04em", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44 }}>
                {d === "UP" ? <ChevronUp size={16} strokeWidth={3} /> : <ChevronDown size={16} strokeWidth={3} />} {d}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 22 }}>
          <div className="font-body" style={{ fontSize: "clamp(10px, 1.8vw, 11px)", color: C.muted, fontWeight: 700, letterSpacing: "0.10em", marginBottom: 8 }}>STAKE</div>
          <div style={{ display: "flex", gap: 6 }}>
            {[5, 10, 25, 50].map(v => (
              <button key={v} onClick={() => setStake(v)} className="font-body tnum"
                style={{ flex: 1, padding: "10px 8px", borderRadius: 8, border: `1px solid ${stake === v ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.08)"}`, background: stake === v ? "rgba(255,255,255,0.09)" : "transparent", color: stake === v ? C.text : C.muted, fontSize: "clamp(11px, 2vw, 13px)", fontWeight: 700, cursor: "pointer", minHeight: 40 }}>
                ${v}
              </button>
            ))}
          </div>
        </div>

        <Button variant={dir === "UP" ? "up" : "down"} full glow
          onClick={() => onSubmit({ market, dir, stake })}
          style={{ borderRadius: 12, fontSize: "clamp(12px, 2vw, 14px)", padding: "14px", minHeight: 44 }}>
          Predict {dir} · ${stake}
        </Button>
      </div>
    </div>
  );
}

function FeedView({ predictions, onOpen, onBack }) {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 350);
    return () => clearTimeout(t);
  }, [predictions]);

  return (
    <div className="container page">
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div style={{ marginBottom: 28, display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 18 }}>
          <div>
            <div className="font-body" style={{ fontSize: 11, color: C.up, fontWeight: 700, letterSpacing: "0.12em", marginBottom: 10 }}>DISCOVER</div>
            <h1 className="font-display" style={{ fontSize: "clamp(32px,5vw,52px)", color: C.text, fontWeight: 700, letterSpacing: "-0.05em", lineHeight: 0.96, marginBottom: 12 }}>
              WHO'S<br />RIGHT?
            </h1>
          </div>
          <div className="font-body" style={{ fontSize: 14, color: C.muted, maxWidth: 360, lineHeight: 1.6 }}>
            Live predictions from verified traders with real price data and on-chain-backed positions.
          </div>
        </div>

        <SectionLabel right={<span className="font-body tnum" style={{ fontSize: 11, color: C.faint }}>{String(predictions.length).padStart(2, "0")} ACTIVE</span>}>
          Live Predictions
        </SectionLabel>

        <div style={{ display: "grid", gap: 16 }}>
          {loading
            ? [0, 1, 2].map((i) => <FeedSkeleton key={i} />)
            : predictions.map((p) => <PredictionCard key={p.id} p={p} onOpen={onOpen} onBack={onBack} />)
          }
        </div>
      </div>
    </div>
  );
}

/* ──────────────────── Predict page ──────────────────── */

function PredictView({ marketOptions, onSubmit, wallet, connectWallet }) {
  const [selected, setSelected] = useState(marketOptions[0]);
  const [dir, setDir] = useState("UP");
  const [stake, setStake] = useState(10);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!marketOptions?.length) return;
    setSelected((current) => marketOptions.find((item) => item.id === current?.id) || marketOptions[0]);
  }, [marketOptions]);

  const handleSubmit = () => {
    if (!wallet) {
      connectWallet();
      return;
    }
    onSubmit({ market: selected.market, dir, stake, asset: selected.asset, price: selected.price });
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 3000);
  };

  return (
    <div className="container page">
      <div style={{ marginBottom: 28 }}>
        <div className="font-body" style={{ fontSize: 11, color: C.up, fontWeight: 700, letterSpacing: "0.12em", marginBottom: 10 }}>PREDICT</div>
        <h1 className="font-display" style={{ fontSize: "clamp(32px,5vw,52px)", color: C.text, fontWeight: 800, letterSpacing: "-0.05em", lineHeight: 0.96, marginBottom: 12 }}>
          CALL THE<br />MARKET
        </h1>
        <p className="font-body" style={{ fontSize: 14, color: C.muted, maxWidth: 420, lineHeight: 1.6 }}>
          Study live candlestick data from TradingView, then stake your prediction on any active DreamDEX Event Contract.
        </p>
      </div>

      {/* Market selector */}
      <SectionLabel>Select Market</SectionLabel>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
        {marketOptions.map((m) => (
          <button
            key={m.id}
            onClick={() => setSelected(m)}
            className="font-body"
            style={{
              padding: "8px 16px", borderRadius: 999, cursor: "pointer",
              border: `1px solid ${selected.id === m.id ? "rgba(32,229,138,0.4)" : "rgba(255,255,255,0.08)"}`,
              background: selected.id === m.id ? "rgba(32,229,138,0.1)" : "transparent",
              color: selected.id === m.id ? C.up : C.muted,
              fontSize: 13, fontWeight: 700,
            }}
          >
            {m.market}
          </button>
        ))}
      </div>

      {/* Live TradingView chart */}
      <Panel style={{ marginBottom: 20 }} pad={0}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div className="font-display" style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{selected.market}</div>
            <div className="font-body" style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{selected.question}</div>
          </div>
          <div className="flex items-center gap-2">
            <LiveDot />
            <span className="font-body tnum" style={{ fontSize: 12, color: C.gold, fontWeight: 700 }}>{selected.time}</span>
          </div>
        </div>
        <TradingViewChart
          symbol={marketToSymbol(selected.market)}
          interval={marketToInterval(selected.market)}
          height={420}
        />
      </Panel>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }} className="pred-controls">
        {/* Direction picker */}
        <Panel pad={16}>
          <SectionLabel>Your Prediction</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {["UP", "DOWN"].map((d) => (
              <button
                key={d}
                onClick={() => setDir(d)}
                style={{
                  padding: "18px 12px", borderRadius: 12, cursor: "pointer", minHeight: 44,
                  border: `1px solid ${dir === d ? (d === "UP" ? C.upBorder : C.downBorder) : "rgba(255,255,255,0.07)"}`,
                  background: dir === d ? (d === "UP" ? C.upSoft : C.downSoft) : "transparent",
                  color: dir === d ? (d === "UP" ? C.up : C.down) : C.muted,
                  fontSize: "clamp(12px, 2vw, 15px)", fontWeight: 800, fontFamily: "'Plus Jakarta Sans',sans-serif",
                  letterSpacing: "0.04em", display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                }}
              >
                {d === "UP" ? <ChevronUp size={22} strokeWidth={3} /> : <ChevronDown size={22} strokeWidth={3} />}
                {d}
              </button>
            ))}
          </div>
        </Panel>

        {/* Stake picker */}
        <Panel pad={16}>
          <SectionLabel>Stake Amount</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {[5, 10, 25, 50].map((v) => (
              <button
                key={v}
                onClick={() => setStake(v)}
                className="font-body tnum"
                style={{
                  padding: "14px 8px", borderRadius: 10, cursor: "pointer", minHeight: 44,
                  border: `1px solid ${stake === v ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.08)"}`,
                  background: stake === v ? "rgba(255,255,255,0.09)" : "transparent",
                  color: stake === v ? C.text : C.muted,
                  fontSize: "clamp(11px, 1.8vw, 15px)", fontWeight: 700,
                }}
              >
                ${v}
              </button>
            ))}
          </div>
        </Panel>
      </div>
      
      <style>{`
        @media (max-width: 768px) {
          .pred-controls { grid-template-columns: 1fr !important; gap: 12px !important; }
        }
      `}</style>

      {submitted ? (
        <div className="flex items-center justify-center gap-2 font-display" style={{ padding: "16px", borderRadius: 12, background: C.upSoft, border: `1px solid ${C.upBorder}`, color: C.up, fontWeight: 700, fontSize: 14 }}>
          <Check size={18} strokeWidth={2.5} /> Prediction submitted on {selected.market}
        </div>
      ) : (
        <Button variant={dir === "UP" ? "up" : "down"} full glow onClick={handleSubmit} style={{ borderRadius: 12, fontSize: 15, padding: "16px 20px" }}>
          <span className="flex items-center justify-center gap-2">
            <Target size={16} strokeWidth={2} />
            {wallet ? `Predict ${dir} · $${stake}` : "Connect Wallet to Predict"}
          </span>
        </Button>
      )}

      {/* Other open markets */}
      <div style={{ marginTop: 32 }}>
        <SectionLabel>Open Markets</SectionLabel>
        <Panel pad={0}>
          {marketOptions.filter((m) => m.id !== selected.id).map((m, i) => (
            <button
              key={m.id}
              onClick={() => setSelected(m)}
              className="flex items-center justify-between hover-row"
              style={{
                width: "100%", padding: "14px 18px", background: "none", border: "none", cursor: "pointer",
                borderTop: i === 0 ? "none" : "1px solid rgba(255,255,255,0.05)",
              }}
            >
              <div className="text-left">
                <div className="font-display" style={{ fontSize: 14, color: C.text, fontWeight: 700 }}>{m.market}</div>
                <div className="font-body" style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>{m.question}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-display tnum" style={{ fontSize: 13, color: C.gold, fontWeight: 700 }}>{m.time}</span>
                <ArrowUpRight size={14} color={C.faint} />
              </div>
            </button>
          ))}
        </Panel>
      </div>
    </div>
  );
}

/* ──────────────────── Markets ──────────────────── */

function DepthRow({ price, size, side, maxSize }) {
  const pct = Math.min(100, (size / maxSize) * 100);
  const isUp = side === "up";
  return (
    <div style={{ position: "relative", padding: "4px 2px" }}>
      <div style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: pct + "%", background: isUp ? "rgba(32,229,138,0.08)" : "rgba(255,82,99,0.08)", transition: "width .4s ease" }} />
      <div className="flex justify-between font-body tnum" style={{ fontSize: 12, position: "relative" }}>
        <span style={{ color: isUp ? C.up : C.down, fontWeight: 600 }}>${Number(price).toFixed(2)}</span>
        <span style={{ color: C.muted }}>{size.toLocaleString()}</span>
      </div>
    </div>
  );
}

/* Live order book + recent trades, both fed by a single Coinbase WebSocket
 * (wss://ws-feed.exchange.coinbase.com). WebSocket streams aren't subject to
 * browser CORS the way the old REST polling was, and the subscribe ack /
 * snapshot arrives in one round trip instead of waiting on a 4s poll loop —
 * so both panels populate instantly and then update tick-by-tick as real
 * fills happen, instead of refreshing every few seconds. */
function useCoinbaseMarketFeed(asset) {
  const [book, setBook] = useState(null);
  const [trades, setTrades] = useState(null);
  const [status, setStatus] = useState("connecting"); // connecting | live | error

  useEffect(() => {
    let cancelled = false;
    let ws = null;
    let reconnectTimer = null;
    let flushTimer = null;
    const bids = new Map();
    const asks = new Map();

    setBook(null);
    setTrades(null);
    setStatus("connecting");
    const product = assetToCoinbaseProduct(asset);

    const topLevels = (map, side) => {
      const rows = [...map.entries()].filter(([, size]) => size > 0);
      rows.sort((a, b) => (side === "bid" ? b[0] - a[0] : a[0] - b[0]));
      return rows.slice(0, side === "bid" ? 2 : 3);
    };

    const flushBook = () => {
      if (cancelled || (!bids.size && !asks.size)) return;
      setBook({ bids: topLevels(bids, "bid"), asks: topLevels(asks, "ask") });
    };

    const connect = () => {
      ws = new WebSocket("wss://ws-feed.exchange.coinbase.com");

      ws.onopen = () => {
        if (cancelled) return;
        ws.send(JSON.stringify({
          type: "subscribe",
          product_ids: [product],
          channels: ["level2_batch", "matches"],
        }));
      };

      ws.onmessage = (event) => {
        if (cancelled) return;
        const msg = JSON.parse(event.data);

        if (msg.type === "snapshot") {
          bids.clear(); asks.clear();
          msg.bids.forEach(([p, s]) => bids.set(Number(p), Number(s)));
          msg.asks.forEach(([p, s]) => asks.set(Number(p), Number(s)));
          setStatus("live");
          flushBook();
        } else if (msg.type === "l2update") {
          msg.changes.forEach(([side, price, size]) => {
            const map = side === "buy" ? bids : asks;
            const p = Number(price), s = Number(size);
            if (s === 0) map.delete(p); else map.set(p, s);
          });
        } else if (msg.type === "last_match" || msg.type === "match") {
          setStatus("live");
          setTrades((prev) => [
            { side: msg.side === "sell" ? "DOWN" : "UP", price: Number(msg.price), size: Number(msg.size), ts: Date.parse(msg.time) },
            ...(prev || []),
          ].slice(0, 6));
        }
      };

      ws.onerror = () => { if (!cancelled) setStatus((s) => (s === "connecting" ? "error" : s)); };
      ws.onclose = () => { if (!cancelled) reconnectTimer = setTimeout(connect, 2000); };
    };

    connect();
    flushTimer = setInterval(flushBook, 200);

    return () => {
      cancelled = true;
      clearInterval(flushTimer);
      clearTimeout(reconnectTimer);
      if (ws) { ws.onclose = null; ws.close(); }
    };
  }, [asset]);

  return { book, trades, status };
}

function OrderBook({ book, status }) {
  if (status === "error" && !book) {
    return (
      <Panel pad={14}>
        <SectionLabel>Order Book</SectionLabel>
        <div className="font-body" style={{ fontSize: 12, color: C.faint, padding: "24px 4px", textAlign: "center" }}>Live order book unavailable right now.</div>
      </Panel>
    );
  }

  if (!book || (book.asks.length === 0 && book.bids.length === 0)) {
    return (
      <Panel pad={14}>
        <SectionLabel right={<span className="font-body tnum" style={{ fontSize: 10.5, color: C.faint }}>SIZE</span>}>Order Book</SectionLabel>
        <div className="skeleton" style={{ height: 122, borderRadius: 8 }} />
      </Panel>
    );
  }

  const asks = book.asks && book.asks.length > 0 ? [...book.asks].sort((a, b) => b[0] - a[0]) : [];
  const bids = book.bids && book.bids.length > 0 ? [...book.bids].sort((a, b) => b[0] - a[0]) : [];
  const allSizes = [...asks.map((a) => a[1] || 0), ...bids.map((b) => b[1] || 0)];
  const maxSize = allSizes.length > 0 ? Math.max(...allSizes, 1) : 1;
  const spread = asks.length > 0 && bids.length > 0 ? Math.max(0, asks[asks.length - 1][0] - bids[0][0]) : 0;

  return (
    <Panel pad={14}>
      <SectionLabel right={<span className="font-body tnum" style={{ fontSize: 10.5, color: C.faint }}>SIZE</span>}>Order Book</SectionLabel>
      {asks.map(([price, size], i) => <DepthRow key={"a" + i} price={price} size={size} side="down" maxSize={maxSize} />)}
      <div className="flex items-center justify-center font-body" style={{ fontSize: 10, color: C.faint, letterSpacing: "0.10em", padding: "7px 0", borderTop: `1px solid rgba(255,255,255,0.06)`, borderBottom: `1px solid rgba(255,255,255,0.06)`, margin: "3px 0" }}>
        SPREAD · ${Number(spread).toFixed(2)}
      </div>
      {bids.map(([price, size], i) => <DepthRow key={"b" + i} price={price} size={size} side="up" maxSize={maxSize} />)}
    </Panel>
  );
}

function RecentTrades({ trades, status }) {
  if (status === "error" && !trades) {
    return (
      <Panel pad={14}>
        <SectionLabel>Recent Trades</SectionLabel>
        <div className="font-body" style={{ fontSize: 12, color: C.faint, padding: "24px 4px", textAlign: "center" }}>Live trades unavailable right now.</div>
      </Panel>
    );
  }

  if (!trades || trades.length === 0) {
    return (
      <Panel pad={14}>
        <SectionLabel>Recent Trades</SectionLabel>
        <div className="skeleton" style={{ height: 122, borderRadius: 8 }} />
      </Panel>
    );
  }

  const now = Date.now();
  const validTrades = trades.filter((t) => t && t.ts && t.price && t.size !== undefined);
  
  return (
    <Panel pad={14}>
      <SectionLabel>Recent Trades</SectionLabel>
      {validTrades.length > 0 ? (
        validTrades.map((t, i) => (
          <div key={t.ts + "-" + i} className="flex justify-between font-body tnum row-in" style={{ fontSize: 12, padding: "5px 2px", animationDelay: `${i * 60}ms` }}>
            <span style={{ color: t.side === "UP" ? C.up : C.down, fontWeight: 600 }}>{t.side} ${Number(t.price).toFixed(2)}</span>
            <span style={{ color: C.faint }}>{Number(t.size).toFixed(4)} · {formatTimeAgo(now - t.ts)}</span>
          </div>
        ))
      ) : (
        <div className="font-body" style={{ fontSize: 12, color: C.faint, padding: "12px 4px", textAlign: "center" }}>Waiting for trades...</div>
      )}
    </Panel>
  );
}

function MarketFeedPanels({ asset }) {
  const { book, trades, status } = useCoinbaseMarketFeed(asset);
  return (
    <div className="market-grid" style={{ marginBottom: 20 }}>
      <OrderBook book={book} status={status} />
      <RecentTrades trades={trades} status={status} />
    </div>
  );
}

function TradePanel({ market, onBack }) {
  const [amount, setAmount] = useState(10);
  const [side, setSide] = useState("UP");
  const downPrice = Math.max(1, Number((market.price * 0.96).toFixed(2)));
  const payout = (amount * (100 / (side === "UP" ? market.price : downPrice))).toFixed(2);
  return (
    <Panel pad={16} style={{ border: `1px solid rgba(255,255,255,0.1)` }}>
      <SectionLabel>Trade</SectionLabel>
      <div className="flex items-center" style={{ gap: 10, marginBottom: 14 }}>
        <span className="font-body" style={{ fontSize: 12.5, color: C.muted }}>Amount</span>
        <div style={{ position: "relative" }}>
          <span className="font-display tnum" style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: C.faint, fontSize: 13 }}>$</span>
          <input
            type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))}
            className="font-display tnum"
            style={{ background: "rgba(7,9,13,0.7)", border: `1px solid rgba(255,255,255,0.1)`, borderRadius: "var(--radius-sm)", padding: "8px 10px 8px 20px", color: C.text, width: 110, fontSize: 13, fontWeight: 700 }}
          />
        </div>
      </div>

      <div className="trade-split" style={{ border: `1px solid rgba(255,255,255,0.08)`, borderRadius: "var(--radius-sm)", overflow: "hidden", marginBottom: 12 }}>
        <button
          onClick={() => setSide("UP")}
          className="btn"
          style={{ background: side === "UP" ? C.upSoft : "transparent", border: "none", borderRight: `1px solid rgba(255,255,255,0.08)`, padding: "14px 10px", cursor: "pointer", textAlign: "left" }}
          aria-pressed={side === "UP"}
        >
          <div className="font-body" style={{ fontSize: 10.5, color: C.up, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 4 }}>UP</div>
          <PriceDisplay value={market.price} size={20} />
        </button>
        <button
          onClick={() => setSide("DOWN")}
          className="btn"
          style={{ background: side === "DOWN" ? C.downSoft : "transparent", border: "none", padding: "14px 10px", cursor: "pointer", textAlign: "left" }}
          aria-pressed={side === "DOWN"}
        >
          <div className="font-body" style={{ fontSize: 10.5, color: C.down, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 4 }}>DOWN</div>
          <PriceDisplay value={downPrice} size={20} />
        </button>
      </div>

      <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
        <span className="font-body" style={{ fontSize: 12, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Potential payout</span>
        <span className="font-display tnum" style={{ fontSize: 15, color: C.gold, fontWeight: 700 }}>${payout}</span>
      </div>

      <Button variant={side === "UP" ? "up" : "down"} full glow onClick={() => onBack({ ...market, dir: side, amount, price: side === "UP" ? market.price : downPrice })}>
        Back {side}
      </Button>
    </Panel>
  );
}

function MarketView({ market, onBack }) {
  return (
    <div className="container page">
      <div className="flex items-start justify-between" style={{ marginBottom: 18, gap: 12, flexWrap: "wrap" }}>
        <div>
          <div className="font-body" style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>{market.market} · Will {market.asset} finish up?</div>
          <div className="flex items-end" style={{ gap: 28, flexWrap: "wrap" }}>
            <div>
              <div className="font-body" style={{ fontSize: 10.5, color: C.up, marginBottom: 4, fontWeight: 700, letterSpacing: "0.08em" }}>UP</div>
              <PriceDisplay value={market.price} size="clamp(24px, 7vw, 48px)" />
            </div>
            <div>
              <div className="font-body" style={{ fontSize: 10.5, color: C.down, marginBottom: 4, fontWeight: 700, letterSpacing: "0.08em" }}>DOWN</div>
              <PriceDisplay value={100 - market.price} size="clamp(24px, 7vw, 48px)" />
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="font-body" style={{ fontSize: 10, color: C.faint, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.08em" }}>Time left</div>
          <div className="font-display tnum" style={{ fontSize: 18, color: C.gold, fontWeight: 700, whiteSpace: "nowrap" }}>{market.time}</div>
        </div>
      </div>

      <Panel style={{ marginBottom: 16 }} pad={0}>
        <TradingViewChart
          symbol={marketToSymbol(market.market || market.asset)}
          interval={marketToInterval(market.market)}
          height={380}
        />
      </Panel>

      <MarketFeedPanels asset={market.asset} />

      <div style={{ marginBottom: 20 }}>
        <SectionLabel>What people are predicting</SectionLabel>
        <div>
          {[{ user: "Mide", dir: "UP", acc: 78 }, { user: "Alpha", dir: "DOWN", acc: 66 }, { user: "QuantX", dir: "UP", acc: 69 }].map((s, i) => (
            <div key={i} className="flex items-center justify-between hover-row" style={{ padding: "9px 2px", borderBottom: `1px solid rgba(255,255,255,0.05)` }}>
              <div className="flex items-center gap-2.5">
                <Avatar initials={s.user.slice(0, 2).toUpperCase()} size={24} />
                <span className="font-body" style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{s.user}</span>
                <span className="font-body tnum" style={{ fontSize: 11.5, color: C.faint }}>{s.acc}%</span>
              </div>
              <DirectionBadge dir={s.dir} size="sm" />
            </div>
          ))}
        </div>
      </div>

      <TradePanel market={market} onBack={onBack} />
    </div>
  );
}

/* ──────────────────── Prediction detail ──────────────────── */

function PredictionDetailView({ p, onOpenMarket, onOpenProfile, onBack }) {
  const up = p.dir === "UP";
  return (
    <div className="container page" style={{ maxWidth: 560 }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 22 }}>
        <span className="font-body" style={{ fontSize: 12, color: C.muted }}>{p.market}</span>
        <span className="font-display tnum" style={{ fontSize: 13, color: C.gold, fontWeight: 700 }}>{p.time}</span>
      </div>

      <button onClick={() => onOpenProfile(p)} className="flex items-center gap-2.5 link-btn" style={{ background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: 26 }}>
        <Avatar initials={p.initials} size={30} live />
        <span className="font-body" style={{ fontSize: 14, color: C.text, fontWeight: 600 }}>{p.user} predicts</span>
      </button>

      <Panel style={{ marginBottom: 24 }} pad={24}>
        <div className="text-center">
          <div style={{ marginBottom: 10 }}>{up ? <ChevronUp size={26} color={C.up} strokeWidth={2.5} /> : <ChevronDown size={26} color={C.down} strokeWidth={2.5} />}</div>
          <div className="font-display" style={{ fontSize: 15, color: up ? C.up : C.down, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 12 }}>{p.dir}</div>
          <div onClick={() => onOpenMarket(p)} style={{ cursor: "pointer", display: "inline-block" }}>
            <PriceDisplay value={p.price} size={64} />
          </div>
        </div>
      </Panel>

      <Divider />

      <div className="stats-grid" style={{ marginBottom: 26 }}>
        <Stat label="Score" value={predictor.score} accent={C.gold} />
        <Stat label="Accuracy" value={p.userAcc + "%"} />
        <Stat label={p.asset + " Acc."} value={p.marketAcc + "%"} />
        <Stat label="Predictions" value={predictor.count} />
      </div>

      <Divider />

      <div style={{ marginBottom: 28 }}>
        <SectionLabel>Why this matters</SectionLabel>
        <p className="font-body" style={{ fontSize: 14, color: C.text, lineHeight: 1.65, opacity: 0.82 }}>
          {p.user} has correctly called {p.market} markets {p.userAcc}% of the time across {predictor.count} predictions.
        </p>
      </div>

      <Button variant={up ? "up" : "down"} full glow onClick={() => onBack(p)} style={{ borderRadius: 12, fontSize: 14.5, padding: "15px 20px" }}>
        Back This Prediction
      </Button>
    </div>
  );
}

/* ──────────────────── Profile page ──────────────────── */

function ProfileView({ profile, profileLoading, walletAddress, onOpenReceipt }) {
  const [activeTab, setActiveTab] = useState("history");
  const tabs = ["history", "specialties", "stats"];

  const hasRealProfile = Boolean(walletAddress && profile);

  const view = hasRealProfile
    ? {
        name: profile.username || shortAddress(profile.wallet),
        initials: profile.username ? profile.username.slice(0, 2).toUpperCase() : profile.wallet.slice(2, 4).toUpperCase(),
        joined: null,
        score: Math.round(profile.predictionScore),
        accuracy: Math.round(profile.winRate),
        count: profile.totalPredictions,
        correct: profile.totalWins,
        specialties: profile.categoryBreakdown.map((c) => ({ market: c.label, acc: Math.round(c.accuracy) })),
        history: profile.history.map((h) => ({
          market: h.market,
          dir: h.dir,
          price: h.price,
          result: h.result === "WON" ? "win" : "loss",
        })),
      }
    : { ...predictor, initials: "MD" };

  if (walletAddress && profileLoading && !profile) {
    return (
      <div className="container page" style={{ maxWidth: 640 }}>
        <div className="skeleton" style={{ height: 300, borderRadius: 12 }} />
      </div>
    );
  }

  return (
    <div className="container page" style={{ maxWidth: 640 }}>

      {/* Hero card */}
      <div className="profile-hero" style={{ marginBottom: 20 }}>
        <div className="flex items-start justify-between" style={{ marginBottom: 20, gap: 16, flexWrap: "wrap" }}>
          <div className="flex items-center gap-4" style={{ flexWrap: "wrap" }}>
            <div style={{ position: "relative" }}>
              <Avatar initials={view.initials} size={64} live />
              <div style={{
                position: "absolute", inset: -3, borderRadius: 999,
                border: "1.5px solid rgba(32,229,138,0.3)",
                boxShadow: "0 0 16px rgba(32,229,138,0.2)",
              }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="font-display" style={{ fontSize: "clamp(18px, 4vw, 24px)", color: C.text, fontWeight: 700, letterSpacing: "-0.03em", marginBottom: 2 }}>{view.name}</div>
              {view.joined && <div className="font-body" style={{ fontSize: "clamp(10px, 2vw, 11.5px)", color: C.muted }}>Predictor since {view.joined}</div>}
              <div className="flex items-center gap-2" style={{ marginTop: 6 }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
                  color: C.text, background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.16)",
                  padding: "2px 8px", borderRadius: 999,
                }}>{scoreTier(view.score)}</span>
              </div>
            </div>
          </div>
          <div className="flex" style={{ gap: 8, flexWrap: "wrap" }}>
            <Button variant="ghost" glow style={{ fontSize: 12, padding: "9px 12px" }}>
              <span className="flex items-center gap-1.5"><Star size={12} />Follow</span>
            </Button>
            <Button variant="ghost" style={{ fontSize: 12, padding: "9px 12px" }}>
              <span className="flex items-center gap-1.5"><Share2 size={12} />Share</span>
            </Button>
          </div>
        </div>

        {/* Score gauge + stats — responsive grid */}
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr 1fr", gap: 24, alignItems: "center", gridAutoFlow: "dense" }} className="profile-stats-grid">
          <div className="flex flex-col items-center gap-1">
            <ScoreGauge score={view.score} size={80} />
            <div className="font-body" style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: "0.08em" }}>ORACLE SCORE</div>
          </div>
          <div className="text-center">
            <div className="font-display tnum" style={{ fontSize: "clamp(20px, 4vw, 26px)", fontWeight: 700, color: C.text, letterSpacing: "-0.03em" }}>{view.accuracy}%</div>
            <div className="font-body" style={{ fontSize: "clamp(9px, 1.8vw, 10.5px)", color: C.muted, marginTop: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Accuracy</div>
          </div>
          <div className="text-center">
            <div className="font-display tnum" style={{ fontSize: "clamp(20px, 4vw, 26px)", fontWeight: 700, color: C.text, letterSpacing: "-0.03em" }}>{view.count}</div>
            <div className="font-body" style={{ fontSize: "clamp(9px, 1.8vw, 10.5px)", color: C.muted, marginTop: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Predictions</div>
          </div>
          <div className="text-center">
            <div className="font-display tnum" style={{ fontSize: "clamp(20px, 4vw, 26px)", fontWeight: 700, color: C.up, letterSpacing: "-0.03em" }}>{view.correct}</div>
            <div className="font-body" style={{ fontSize: "clamp(9px, 1.8vw, 10.5px)", color: C.muted, marginTop: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Correct</div>
          </div>
        </div>
      </div>
      
      <style>{`
        @media (max-width: 640px) {
          .orc-root .profile-hero .profile-stats-grid {
            grid-template-columns: 1fr 1fr !important;
            gap: 16px !important;
          }
          .orc-root .container .profile-stats-tab-grid {
            grid-template-columns: 1fr 1fr !important;
          }
        }
      `}</style>

      {/* Tabs */}
      <div className="flex" style={{ gap: 2, marginBottom: 20, background: "rgba(13,16,22,0.7)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: 4 }}>
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className="font-body"
            style={{
              flex: 1, border: "none", cursor: "pointer", padding: "9px 12px",
              borderRadius: 9, fontSize: 12.5, fontWeight: activeTab === t ? 700 : 500,
              background: activeTab === t ? "rgba(255,255,255,0.09)" : "transparent",
              color: activeTab === t ? C.text : C.muted,
              textTransform: "capitalize",
              transition: "all .15s ease",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "history" && (
        <Panel pad={0}>
          <div style={{ padding: "16px 18px 6px" }}>
            <SectionLabel>Prediction History</SectionLabel>
          </div>
          {view.history.length === 0 && (
            <div className="font-body" style={{ fontSize: 12, color: C.faint, padding: "20px", textAlign: "center" }}>No predictions yet</div>
          )}
          {view.history.map((h, i) => {
            const win = h.result === "win";
            return (
              <button
                key={i}
                onClick={() => onOpenReceipt(h)}
                className="flex items-center justify-between hover-row link-btn"
                style={{
                  width: "100%", background: "none", border: "none", cursor: "pointer",
                  padding: "14px 18px",
                  borderTop: i === 0 ? "none" : `1px solid rgba(255,255,255,0.05)`,
                }}
              >
                <div className="flex items-center gap-3">
                  <div style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: win ? "rgba(32,229,138,0.08)" : "rgba(255,82,99,0.08)",
                    border: `1px solid ${win ? "rgba(32,229,138,0.2)" : "rgba(255,82,99,0.2)"}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {win ? <TrendingUp size={14} color={C.up} /> : <ChevronDown size={14} color={C.down} />}
                  </div>
                  <div>
                    <div className="font-body" style={{ fontSize: 13.5, color: C.text, fontWeight: 600 }}>{h.market}</div>
                    <DirectionBadge dir={h.dir} size="sm" />
                  </div>
                </div>
                <div className="text-right">
                  <span className="font-body" style={{
                    fontSize: 11.5, fontWeight: 700, padding: "4px 10px", borderRadius: 6,
                    color: win ? C.up : C.down, background: win ? C.upSoft : C.downSoft,
                    border: `1px solid ${win ? C.upBorder : C.downBorder}`,
                  }}>
                    {win ? "WIN" : "LOSS"}
                  </span>
                  <div className="font-body tnum" style={{ fontSize: 11, color: C.faint, marginTop: 4 }}>${Number(h.price).toFixed(2)}</div>
                </div>
              </button>
            );
          })}
        </Panel>
      )}

      {activeTab === "specialties" && (
        <Panel pad={20}>
          <SectionLabel>Market Specialties</SectionLabel>
          {view.specialties.length === 0 && (
            <div className="font-body" style={{ fontSize: 12, color: C.faint, textAlign: "center" }}>No category data yet</div>
          )}
          <div className="flex flex-col" style={{ gap: 18 }}>
            {view.specialties.map((s, i) => (
              <div key={i}>
                <div className="flex justify-between font-body" style={{ fontSize: 13.5, color: C.text, marginBottom: 8 }}>
                  <span style={{ fontWeight: 600 }}>{s.market}</span>
                  <span className="tnum" style={{ fontWeight: 700, color: C.up }}>{s.acc}%</span>
                </div>
                <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: s.acc + "%", background: `linear-gradient(90deg, ${C.up}, rgba(32,229,138,0.5))`, borderRadius: 3, boxShadow: `0 0 8px rgba(32,229,138,0.4)` }} />
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {activeTab === "stats" && (
        <div className="profile-stats-tab-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {[
            { label: "Win Rate", value: view.accuracy + "%", accent: C.up },
            { label: "Total Preds", value: view.count, accent: C.text },
            { label: "Correct", value: view.correct, accent: C.up },
            { label: "Oracle Score", value: view.score, accent: C.gold },
          ].map((s, i) => (
            <Panel key={i} pad={20}>
              <div className="font-display tnum" style={{ fontSize: 30, fontWeight: 700, color: s.accent, letterSpacing: "-0.03em", marginBottom: 4 }}>{s.value}</div>
              <div className="font-body" style={{ fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>{s.label}</div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}

/* ──────────────────── Leaderboard (image 7 style) ──────────────────── */

function LeaderboardView({ leaderboardData, leaderboardLoading }) {
  const [tab, setTab] = useState("ALL");
  const filterTabs = ["ALL", "BTC", "ETH", "15M", "1H"];
  
  // Use fetched data or fallback to empty array
  const displayData = leaderboardData || [];
  const top3 = displayData.slice(0, 3);
  const rest = displayData.slice(3);
  
  // reorder for podium: 2nd, 1st, 3rd
  const podiumOrder = [top3[1], top3[0], top3[2]].filter(Boolean);
  const podiumHeights = { 1: 110, 2: 80, 3: 68 };
  const medalColors = { 1: "#F4F6F8", 2: "#A8B0BC", 3: "#737B88" };

  // Helper to get initials from username or wallet
  const getInitials = (entry) => {
    if (entry.username) return entry.username.slice(0, 2).toUpperCase();
    return entry.wallet.slice(2, 4).toUpperCase();
  };

  if (leaderboardLoading && !leaderboardData) {
    return (
      <div className="container page" style={{ maxWidth: 580 }}>
        <div className="text-center" style={{ marginBottom: 8 }}>
          <h1 className="font-display" style={{ fontSize: 32, color: C.text, fontWeight: 700, fontStyle: "italic", letterSpacing: "-0.02em" }}>
            Top Predictors
          </h1>
        </div>
        <div className="skeleton" style={{ height: 300, borderRadius: 12 }} />
      </div>
    );
  }

  return (
    <div className="container page" style={{ maxWidth: 580 }}>
      {/* Header */}
      <div className="text-center" style={{ marginBottom: 8 }}>
        <h1 className="font-display" style={{ fontSize: 32, color: C.text, fontWeight: 700, fontStyle: "italic", letterSpacing: "-0.02em" }}>
          Top Predictors
        </h1>
        <div className="font-body" style={{ fontSize: 10, color: C.up, fontWeight: 700, letterSpacing: "0.12em", marginTop: 6 }}>
          RANKED BY DREAMDEX-VERIFIED ACCURACY
        </div>
      </div>

      {/* Filter tabs (image 8 style pill) */}
      <div className="flex justify-center" style={{ marginBottom: 36, marginTop: 20 }}>
        <div className="filter-pill-tabs">
          {filterTabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`filter-pill-tab ${tab === t ? "active" : "inactive"}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Podium */}
      {podiumOrder.length > 0 && (
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: "clamp(8px, 3vw, 16px)", marginBottom: 40, flexWrap: "wrap" }} className="podium-container">
          {podiumOrder.map((r) => (
            <div key={r.rank} className="flex flex-col items-center" style={{ width: "clamp(80px, 25vw, 120px)" }}>
              <div className="font-display tnum" style={{ fontSize: "clamp(10px, 2vw, 12px)", color: medalColors[r.rank], fontWeight: 700, marginBottom: 6 }}>
                #{r.rank}
              </div>
              <Avatar initials={getInitials(r)} size={r.rank === 1 ? 54 : 44} />
              <div className="font-display" style={{ fontSize: "clamp(12px, 2.5vw, 14px)", color: C.text, fontWeight: 700, margin: "8px 0 2px", textAlign: "center", wordBreak: "break-word" }}>{r.username || shortAddress(r.wallet)}</div>
              <div className="font-body tnum" style={{ fontSize: "clamp(9px, 1.8vw, 11px)", color: C.muted, marginBottom: 10, textAlign: "center", whiteSpace: "nowrap" }}>{r.accuracy.toFixed(0)}% · {r.totalPredictions}</div>
              <div
                className="podium-bar"
                style={{
                  width: "100%",
                  height: podiumHeights[r.rank],
                  background: r.rank === 1
                    ? `linear-gradient(to bottom, rgba(231,184,75,0.18), rgba(18,22,30,0.8))`
                    : `linear-gradient(to bottom, rgba(255,255,255,0.06), rgba(13,16,22,0.8))`,
                  border: `1px solid ${r.rank === 1 ? "rgba(231,184,75,0.25)" : "rgba(255,255,255,0.06)"}`,
                  borderBottom: "none",
                  boxShadow: r.rank === 1 ? "0 0 20px rgba(231,184,75,0.1)" : "none",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <span className="font-display tnum" style={{ fontSize: "clamp(16px, 3vw, 20px)", fontWeight: 700, color: medalColors[r.rank] }}>{r.rank}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      
      <style>{`
        @media (max-width: 640px) {
          .podium-container { margin-bottom: 30px; }
        }
      `}</style>

      {/* Rest of leaderboard */}
      <Panel pad={0}>
        {rest.length > 0 ? (
          rest.map((r, i) => (
            <div
              key={r.wallet}
              className="flex items-center justify-between hover-row"
              style={{ padding: "16px 20px", borderTop: i === 0 ? "none" : `1px solid rgba(255,255,255,0.05)` }}
            >
              <div className="flex items-center gap-3.5">
                <Avatar initials={getInitials(r)} size={36} />
                <span className="font-body" style={{ fontSize: 14.5, color: C.text, fontWeight: 600 }}>{r.username || shortAddress(r.wallet)}</span>
              </div>
              <div className="text-right">
                <div className="font-display tnum" style={{ fontSize: 15, color: C.text, fontWeight: 700 }}>{r.accuracy.toFixed(0)}%</div>
                <div className="font-body tnum" style={{ fontSize: 10.5, color: C.muted }}>{r.totalPredictions} predictions</div>
              </div>
            </div>
          ))
        ) : (
          <div className="font-body" style={{ fontSize: 12, color: C.faint, padding: "20px", textAlign: "center" }}>No leaderboard data available</div>
        )}
      </Panel>
    </div>
  );
}

/* ──────────────────── Battles ──────────────────── */

function BattleView({ onBack }) {
  return (
    <div className="container page" style={{ maxWidth: 560 }}>
      <div className="flex items-center gap-2" style={{ marginBottom: 4, justifyContent: "center" }}>
        <LiveDot label="LIVE BATTLE" />
      </div>
      <h1 className="font-display" style={{ fontSize: 21, color: C.text, fontWeight: 700, marginBottom: 26, textAlign: "center" }}>BTC 15M</h1>

      <Panel pad={24} style={{ marginBottom: 20 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 18 }}>
          <div className="text-center">
            <Avatar initials="MD" size={48} live />
            <div className="font-display" style={{ fontSize: 15, color: C.text, fontWeight: 600, margin: "10px 0 8px" }}>Mide</div>
            <DirectionBadge dir="UP" />
          </div>
          <div className="font-display" style={{ fontSize: 13, color: C.faint, fontWeight: 700, letterSpacing: "0.08em" }}>VS</div>
          <div className="text-center">
            <Avatar initials="AL" size={48} live />
            <div className="font-display" style={{ fontSize: 15, color: C.text, fontWeight: 600, margin: "10px 0 8px" }}>Alpha</div>
            <DirectionBadge dir="DOWN" />
          </div>
        </div>
        <div className="text-center font-display tnum" style={{ fontSize: 18, color: C.gold, fontWeight: 700, marginTop: 20 }}>06:42</div>
      </Panel>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
        <Button variant="up" full glow onClick={() => onBack({ market: "BTC 15M", dir: "UP", user: "Mide", price: 43 })}>Back Mide</Button>
        <Button variant="down" full glow onClick={() => onBack({ market: "BTC 15M", dir: "DOWN", user: "Alpha", price: 57 })}>Back Alpha</Button>
      </div>

      <div className="flex items-center justify-center gap-6 font-body tnum" style={{ fontSize: 12, color: C.muted }}>
        <span className="flex items-center gap-1.5"><Users size={13} /> 1,284 watching</span>
        <span>312 positions taken</span>
      </div>
    </div>
  );
}

/* ──────────────────── Modals ──────────────────── */

function PredictionReceipt({ item, onClose }) {
  if (!item) return null;
  const win = item.result === "win";
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(4,5,7,0.82)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: "16px", overflowY: "auto" }} onClick={onClose}>
      <div
        className="rise-in glass-card"
        style={{ padding: "clamp(16px, 3vw, 28px)", width: "clamp(280px, 90vw, 360px)", maxWidth: "100%", position: "relative" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ position: "absolute", top: -24, right: -24, opacity: 0.04 }}><OracleLogo size={140} /></div>

        <div className="flex items-center justify-between" style={{ marginBottom: 22, position: "relative" }}>
          <div className="flex items-center gap-1.5">
            <OracleLogo size={14} color={C.muted} />
            <span className="font-display" style={{ fontSize: "clamp(10px, 1.8vw, 11px)", color: C.muted, fontWeight: 700, letterSpacing: "0.10em" }}>ORACLE</span>
          </div>
          <button onClick={onClose} aria-label="Close receipt" style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, flexShrink: 0 }}><XIcon size={16} /></button>
        </div>

        <div className="font-body" style={{ fontSize: "clamp(10px, 1.8vw, 11.5px)", color: C.muted, marginBottom: 4 }}>MIDE PREDICTED</div>
        <div className="font-display" style={{ fontSize: "clamp(16px, 3vw, 22px)", color: C.text, fontWeight: 700, marginBottom: 16 }}>{item.market} 15M</div>

        <div className="flex items-center gap-3" style={{ marginBottom: 18 }}>
          <DirectionBadge dir={item.dir} />
          <PriceDisplay value={item.price} size={26} />
        </div>

        <div style={{ borderTop: `1px solid rgba(255,255,255,0.07)`, paddingTop: 16, marginBottom: 20 }}>
          <span className="font-display flex items-center gap-2" style={{ fontSize: "clamp(12px, 2vw, 13px)", fontWeight: 700, color: win ? C.up : C.down, letterSpacing: "0.04em" }}>
            {win ? <><Check size={16} strokeWidth={2.5} /> CORRECT</> : <><XIcon size={16} strokeWidth={2.5} /> INCORRECT</>}
          </span>
        </div>

        <Button variant="ghost" full onClick={() => {}} style={{ minHeight: 44 }}>
          <span className="flex items-center justify-center gap-2"><Share2 size={13} /> Share Receipt</span>
        </Button>
      </div>
    </div>
  );
}

function TradeModal({ order, onClose, status, onConfirm, onRetry }) {
  if (!order) return null;
  const up = order.dir === "UP";
  const amount = order.amount || 10;
  const price = order.price ?? 43;
  const payout = (amount * (100 / price)).toFixed(2);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(4,5,7,0.82)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: "16px", overflowY: "auto" }} onClick={status === "pending" ? undefined : onClose}>
      <div className="rise-in glass-card" style={{ padding: "clamp(16px, 3vw, 26px)", width: "clamp(280px, 90vw, 380px)", maxWidth: "100%" }} onClick={(e) => e.stopPropagation()}>
        {status === "confirm" && (
          <>
            <div className="font-body" style={{ fontSize: 11, color: C.muted, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.08em" }}>Execute Trade</div>
            <div className="font-display" style={{ fontSize: "clamp(14px, 3vw, 18px)", color: C.text, fontWeight: 700, marginBottom: 20 }}>{order.market}</div>
            <div className="flex flex-col" style={{ gap: 13, marginBottom: 22 }}>
              <div className="flex items-center justify-between"><span className="font-body" style={{ fontSize: "clamp(11px, 2vw, 12.5px)", color: C.muted }}>Side</span><DirectionBadge dir={order.dir} /></div>
              <div className="flex items-center justify-between"><span className="font-body" style={{ fontSize: "clamp(11px, 2vw, 12.5px)", color: C.muted }}>Price</span><PriceDisplay value={price} size={14} /></div>
              <div className="flex items-center justify-between"><span className="font-body" style={{ fontSize: "clamp(11px, 2vw, 12.5px)", color: C.muted }}>Amount</span><span className="font-display tnum" style={{ fontSize: "clamp(12px, 2vw, 14px)", color: C.text, fontWeight: 700 }}>${amount}</span></div>
              <div className="flex items-center justify-between" style={{ borderTop: `1px solid rgba(255,255,255,0.07)`, paddingTop: 13 }}>
                <span className="font-body" style={{ fontSize: "clamp(11px, 2vw, 12.5px)", color: C.muted }}>Potential payout</span>
                <span className="font-display tnum" style={{ fontSize: "clamp(12px, 2vw, 14px)", color: C.gold, fontWeight: 700 }}>${payout}</span>
              </div>
            </div>
            <Button variant={up ? "up" : "down"} full glow onClick={onConfirm} style={{ borderRadius: 12, fontSize: "clamp(12px, 2vw, 14px)", minHeight: 44 }}>Confirm Trade</Button>
          </>
        )}

        {status === "pending" && (
          <div className="text-center" style={{ padding: "18px 0" }}>
            <div className="spin" style={{ width: 30, height: 30, border: `2px solid rgba(255,255,255,0.08)`, borderTopColor: C.up, borderRadius: 999, margin: "0 auto 16px" }} />
            <div className="font-body" style={{ fontSize: "clamp(12px, 2vw, 13px)", color: C.muted }}>Submitting to DreamDEX…</div>
          </div>
        )}

        {status === "done" && (
          <div className="text-center" style={{ padding: "10px 0" }}>
            <div style={{ width: 52, height: 52, borderRadius: 999, background: C.upSoft, border: `1px solid ${C.upBorder}`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", boxShadow: `0 0 20px rgba(32,229,138,0.25)` }}>
              <Check size={22} color={C.up} strokeWidth={2.5} />
            </div>
            <div className="font-display" style={{ fontSize: "clamp(14px, 2.5vw, 16px)", color: C.text, fontWeight: 700, marginBottom: 6 }}>Position Confirmed</div>
            <div className="font-body tnum" style={{ fontSize: "clamp(11px, 1.8vw, 12px)", color: C.muted, marginBottom: 4 }}>${amount} on {order.dir} · {order.market}</div>
            <div className="font-body" style={{ fontSize: "clamp(10px, 1.8vw, 11px)", color: C.faint, marginBottom: 20 }}>DreamDEX order submitted</div>
            <Button variant="ghost" full onClick={onClose} style={{ minHeight: 44 }}>Close</Button>
          </div>
        )}

        {status === "error" && (
          <div className="text-center" style={{ padding: "10px 0" }}>
            <div style={{ width: 52, height: 52, borderRadius: 999, background: C.downSoft, border: `1px solid ${C.downBorder}`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
              <XIcon size={22} color={C.down} strokeWidth={2.5} />
            </div>
            <div className="font-display" style={{ fontSize: "clamp(14px, 2.5vw, 15px)", color: C.text, fontWeight: 700, marginBottom: 6 }}>Trade Couldn't Be Completed</div>
            <div className="font-body" style={{ fontSize: "clamp(11px, 2vw, 12px)", color: C.muted, marginBottom: 20 }}>Your position was not submitted.</div>
            <Button variant="ghost" full onClick={onRetry} style={{ minHeight: 44 }}>Try Again</Button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ──────────────────── Wallet Selection Modal ──────────────────── */

function WalletModal({ onConnect, onClose }) {
  const wallets = [
    {
      id: "metamask",
      name: "MetaMask",
      desc: "Browser extension wallet",
      installed: !!window.ethereum,
      icon: (
        <svg width={32} height={32} viewBox="0 0 32 32" fill="none">
          <rect width={32} height={32} rx={8} fill="#F6851B" />
          <path d="M26.4 5L17.7 11.4l1.6-3.8L26.4 5z" fill="#E17726" stroke="#E17726" strokeWidth=".2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M5.6 5l8.6 6.5-1.5-3.9L5.6 5z" fill="#E27625" stroke="#E27625" strokeWidth=".2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M23.2 21.2l-2.3 3.5 4.9 1.4 1.4-4.8-4-0.1zM4.8 21.3l1.4 4.8 4.9-1.4-2.3-3.5-4 0.1z" fill="#E27625" stroke="#E27625" strokeWidth=".2" strokeLinecap="round" strokeLinejoin="round"/>
          <circle cx={16} cy={16} r={5} fill="#fff" fillOpacity={0.15}/>
        </svg>
      ),
    },
    {
      id: "coinbase",
      name: "Coinbase Wallet",
      desc: "Connect via Coinbase",
      installed: !!(window.coinbaseWalletExtension),
      icon: (
        <svg width={32} height={32} viewBox="0 0 32 32" fill="none">
          <rect width={32} height={32} rx={8} fill="#1652F0" />
          <circle cx={16} cy={16} r={9} fill="#fff" fillOpacity={0.15}/>
          <rect x={12} y={12} width={8} height={8} rx={2} fill="#fff"/>
        </svg>
      ),
    },
    {
      id: "phantom",
      name: "Phantom",
      desc: "Solana & multi-chain",
      installed: !!(window.phantom?.solana?.isPhantom || window.solana?.isPhantom),
      icon: (
        <svg width={32} height={32} viewBox="0 0 32 32" fill="none">
          <rect width={32} height={32} rx={8} fill="#AB9FF2"/>
          <ellipse cx={16} cy={15} rx={8} ry={7} fill="#fff" fillOpacity={0.18}/>
          <circle cx={13} cy={14} r={2} fill="#fff"/>
          <circle cx={19} cy={14} r={2} fill="#fff"/>
          <path d="M11 19c1.2 2 8.8 2 10 0" stroke="#fff" strokeWidth={1.5} strokeLinecap="round"/>
        </svg>
      ),
    },
    {
      id: "walletconnect",
      name: "WalletConnect",
      desc: "Scan with any wallet",
      installed: false,
      icon: (
        <svg width={32} height={32} viewBox="0 0 32 32" fill="none">
          <rect width={32} height={32} rx={8} fill="#3B99FC"/>
          <path d="M9.5 14.5c3.6-3.6 9.4-3.6 13 0l.4.4a.4.4 0 010 .6l-1.4 1.4a.2.2 0 01-.3 0l-.6-.6c-2.5-2.5-6.6-2.5-9.1 0l-.6.6a.2.2 0 01-.3 0l-1.4-1.4a.4.4 0 010-.6l.3-.4zm16 3l1.3 1.3a.4.4 0 010 .6l-5.7 5.7a.4.4 0 01-.6 0l-4-4a.2.2 0 00-.3 0l-4 4a.4.4 0 01-.6 0L5.8 19.4a.4.4 0 010-.6l1.3-1.3a.4.4 0 01.6 0l4 4a.2.2 0 00.3 0l4-4a.4.4 0 01.6 0l4 4a.2.2 0 00.3 0l4-4a.4.4 0 01.6 0z" fill="#fff"/>
        </svg>
      ),
    },
  ];

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(4,5,7,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: "16px", overflowY: "auto" }}
      onClick={onClose}
    >
      <div
        className="rise-in glass-card"
        style={{ padding: "clamp(16px, 3vw, 28px)", width: "clamp(280px, 90vw, 400px)", maxWidth: "100%", position: "relative" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between" style={{ marginBottom: 24 }}>
          <div>
            <div className="font-display" style={{ fontSize: "clamp(14px, 3vw, 18px)", color: C.text, fontWeight: 700 }}>Connect Wallet</div>
            <div className="font-body" style={{ fontSize: "clamp(11px, 2vw, 12px)", color: C.muted, marginTop: 3 }}>Choose your wallet to continue</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, padding: 4, flexShrink: 0 }}>
            <XIcon size={18} />
          </button>
        </div>

        {/* Wallet options */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {wallets.map((w) => (
            <button
              key={w.id}
              onClick={() => onConnect(w.id)}
              className="flex items-center gap-3 btn"
              style={{
                width: "100%", padding: "14px 16px", borderRadius: 14, cursor: "pointer", minHeight: 52,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.09)",
                textAlign: "left",
                transition: "background .15s ease, border-color .15s ease",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.16)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.09)"; }}
            >
              {w.icon}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="font-body" style={{ fontSize: "clamp(12px, 2vw, 14px)", color: C.text, fontWeight: 700 }}>{w.name}</div>
                <div className="font-body" style={{ fontSize: "clamp(10px, 1.8vw, 11.5px)", color: C.muted, marginTop: 1 }}>{w.desc}</div>
              </div>
              {w.installed && (
                <span style={{ fontSize: 9, fontWeight: 700, color: C.up, background: "rgba(32,229,138,0.1)", border: "1px solid rgba(32,229,138,0.25)", padding: "2px 6px", borderRadius: 999, letterSpacing: "0.06em", whiteSpace: "nowrap" }}>
                  INSTALLED
                </span>
              )}
              {!w.installed && (
                <span style={{ fontSize: 10, fontWeight: 600, color: C.muted, letterSpacing: "0.04em", whiteSpace: "nowrap" }}>
                  Get →
                </span>
              )}
            </button>
          ))}
        </div>

        <p className="font-body" style={{ fontSize: "clamp(10px, 1.8vw, 11px)", color: C.faint, textAlign: "center", marginTop: 20, lineHeight: 1.6 }}>
          By connecting, you agree to trade on DreamDEX Event Contracts.<br/>No custody - your keys, your wallet.
        </p>
      </div>
    </div>
  );
}

/* ──────────────────── Onboarding ──────────────────── */

function OnboardingScreen({ wallet, connectWallet, onContinue, onSkip }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: C.bg }}>
      <div className="rise-in glass-card" style={{ padding: "clamp(28px, 5vw, 44px) clamp(24px, 4vw, 36px)", width: "clamp(280px, 92vw, 420px)", maxWidth: "100%", textAlign: "center" }}>
        <div className="flex items-center justify-center gap-2" style={{ marginBottom: 22 }}>
          <OracleLogo size={26} color={C.text} />
          <span className="font-display" style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em", color: C.text }}>ORACLE</span>
        </div>

        {!wallet ? (
          <>
            <div className="font-display" style={{ fontSize: "clamp(20px, 4vw, 26px)", fontWeight: 700, color: C.text, letterSpacing: "-0.02em", marginBottom: 10 }}>
              Connect your wallet
            </div>
            <p className="font-body" style={{ fontSize: 13.5, color: C.muted, lineHeight: 1.65, marginBottom: 28 }}>
              Oracle is non-custodial — every prediction you back is a real DreamDEX Event Contract order signed by your own wallet. Connect now, or browse first and connect later.
            </p>
            <Button variant="up" full glow onClick={connectWallet} ariaLabel="Connect wallet">
              <span className="flex items-center justify-center gap-2"><Wallet size={14} /> Connect Wallet</span>
            </Button>
            <button
              onClick={onSkip}
              className="font-body link-btn"
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12.5, color: C.muted, marginTop: 18, padding: 6 }}
            >
              Continue without a wallet
            </button>
          </>
        ) : (
          <>
            <div style={{
              width: 52, height: 52, borderRadius: "50%", margin: "0 auto 18px",
              background: "rgba(32,229,138,0.12)", border: "1px solid rgba(32,229,138,0.3)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Check size={24} color={C.up} strokeWidth={2.5} />
            </div>
            <div className="font-display" style={{ fontSize: "clamp(20px, 4vw, 26px)", fontWeight: 700, color: C.text, letterSpacing: "-0.02em", marginBottom: 8 }}>
              You're connected
            </div>
            <p className="font-body tnum" style={{ fontSize: 13.5, color: C.muted, marginBottom: 28 }}>
              {wallet}
            </p>
            <Button variant="up" full glow onClick={onContinue} ariaLabel="Continue to dashboard">
              <span className="flex items-center justify-center gap-2">Continue to Dashboard <ArrowUpRight size={14} /></span>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/* ──────────────────── Dashboard root ──────────────────── */

export default function OracleDashboard({ onExit }) {
  const [onboarded, setOnboarded] = useState(() => {
    try { return localStorage.getItem("oracle_onboarded") === "1"; } catch { return false; }
  });
  const [view, setView] = useState("feed");
  const [detail, setDetail] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [walletAddress, setWalletAddress] = useState(null);
  const [walletBalance, setWalletBalance] = useState(null);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [order, setOrder] = useState(null);
  const [orderStatus, setOrderStatus] = useState("confirm");
  const [receipt, setReceipt] = useState(null);
  const [liveMarketData, setLiveMarketData] = useState(FALLBACK_MARKETS);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);

  useEffect(() => {
    const fetchMarketData = async () => {
      try {
        const response = await fetch(
          "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin,ethereum,solana,ripple,binancecoin,avalanche-2,dogecoin,cardano,matic-network&price_change_percentage=24h"
        );
        if (!response.ok) throw new Error("Market data request failed");

        const rawData = await response.json();
        const symbolMap = {
          btc: "BTC", eth: "ETH", sol: "SOL", xrp: "XRP",
          bnb: "BNB", avax: "AVAX", doge: "DOGE", ada: "ADA", matic: "MATIC",
        };
        const marketMap = rawData.reduce((acc, coin) => {
          const key = symbolMap[coin.symbol?.toLowerCase()];
          if (!key) return acc;
          acc[key] = {
            price: coin.current_price,
            change: coin.price_change_percentage_24h ?? 0,
          };
          return acc;
        }, {});

        setLiveMarketData({
          BTC:  marketMap.BTC  || FALLBACK_MARKETS.BTC,
          ETH:  marketMap.ETH  || FALLBACK_MARKETS.ETH,
          SOL:  marketMap.SOL  || FALLBACK_MARKETS.SOL,
          XRP:  marketMap.XRP  || FALLBACK_MARKETS.XRP,
          BNB:  marketMap.BNB  || FALLBACK_MARKETS.BNB,
          AVAX: marketMap.AVAX || FALLBACK_MARKETS.AVAX,
          DOGE: marketMap.DOGE || FALLBACK_MARKETS.DOGE,
          ADA:  marketMap.ADA  || FALLBACK_MARKETS.ADA,
          MATIC:marketMap.MATIC|| FALLBACK_MARKETS.MATIC,
        });
      } catch (error) {
        setLiveMarketData(FALLBACK_MARKETS);
      }
    };

    fetchMarketData();
    const interval = setInterval(fetchMarketData, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const provider = window.ethereum;
    if (!provider) return;

    const handleAccountsChanged = (accounts) => {
      const addr = accounts?.[0] || null;
      setWallet(addr ? shortAddress(addr) : null);
      setWalletAddress(addr);
      setSignedIn(false);
      setAuthToken(null);
      if (!addr) setWalletBalance(null);
      else signInWithWallet(addr, window.ethereum);
    };

    provider.on?.("accountsChanged", handleAccountsChanged);
    return () => provider.removeListener?.("accountsChanged", handleAccountsChanged);
  }, []);

  useEffect(() => {
    if (!walletAddress || !window.ethereum) {
      setWalletBalance(null);
      return;
    }
    let cancelled = false;
    const fetchBalance = async () => {
      try {
        const hex = await window.ethereum.request({
          method: "eth_getBalance",
          params: [walletAddress, "latest"],
        });
        if (cancelled) return;
        setWalletBalance(Number(BigInt(hex)) / 1e18);
      } catch {
        // network hiccup — keep the last known balance
      }
    };
    fetchBalance();
    const interval = setInterval(fetchBalance, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [walletAddress]);

  // Fetch leaderboard data from API
  const [leaderboardData, setLeaderboardData] = useState(null);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [userProfileData, setUserProfileData] = useState(null);
  const [userProfileLoading, setUserProfileLoading] = useState(false);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      setLeaderboardLoading(true);
      try {
        const data = await getLeaderboard({ limit: 10 });
        setLeaderboardData(data);
      } catch (error) {
        console.error("Failed to fetch leaderboard:", error);
        setLeaderboardData(null);
      } finally {
        setLeaderboardLoading(false);
      }
    };

    fetchLeaderboard();
    const interval = setInterval(fetchLeaderboard, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  // Fetch user profile when wallet is connected
  useEffect(() => {
    if (!walletAddress) {
      setUserProfileData(null);
      return;
    }

    const fetchUserProfile = async () => {
      setUserProfileLoading(true);
      try {
        const data = await getUserProfile(walletAddress);
        setUserProfileData(data);
      } catch (error) {
        console.error("Failed to fetch user profile:", error);
        setUserProfileData(null);
      } finally {
        setUserProfileLoading(false);
      }
    };

    fetchUserProfile();
    const interval = setInterval(fetchUserProfile, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, [walletAddress]);

  const connectWallet = () => setWalletModalOpen(true);

  const finishOnboarding = () => {
    setOnboarded(true);
    try { localStorage.setItem("oracle_onboarded", "1"); } catch { /* private browsing — non-fatal */ }
  };

  // Proves ownership of the connected address to oracle-backend: fetch a
  // one-time nonce, have the wallet sign it, exchange the signature for a
  // JWT. EVM-only (personal_sign) - Phantom (Solana) is skipped since
  // DreamDEX/Oracle only exists on the EVM side.
  const signInWithWallet = async (address, provider) => {
    if (!provider) return;
    try {
      const { nonce, message } = await getAuthChallenge(address);
      const signature = await provider.request({
        method: "personal_sign",
        params: [message, address],
      });
      await verifyAuthSignature({ walletAddress: address, nonce, signature });
      setSignedIn(true);
    } catch (err) {
      // User rejected the signature, or the backend is unreachable - stay
      // connected but unsigned; predictions fall back to unsigned writes
      // wherever the backend still allows that.
      console.error("Wallet sign-in failed", err);
      setSignedIn(false);
    }
  };

  const handleWalletConnect = async (type) => {
    try {
      if (type === "metamask") {
        if (!window.ethereum) {
          window.open("https://metamask.io/download/", "_blank");
          return;
        }
        const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
        setWallet(accounts?.[0] ? shortAddress(accounts[0]) : null);
        setWalletAddress(accounts?.[0] || null);
        setWalletModalOpen(false);
        if (accounts?.[0]) await signInWithWallet(accounts[0], window.ethereum);
      } else if (type === "phantom") {
        const phantom = window.phantom?.solana || window.solana;
        if (!phantom?.isPhantom) {
          window.open("https://phantom.app/", "_blank");
          return;
        }
        const resp = await phantom.connect();
        setWallet(shortAddress(resp.publicKey.toString()));
        setWalletModalOpen(false);
      } else if (type === "coinbase") {
        const cbProvider = window.coinbaseWalletExtension || window.ethereum;
        if (!cbProvider) {
          window.open("https://www.coinbase.com/wallet", "_blank");
          return;
        }
        const accounts = await cbProvider.request({ method: "eth_requestAccounts" });
        setWallet(accounts?.[0] ? shortAddress(accounts[0]) : null);
        setWalletAddress(accounts?.[0] || null);
        setWalletModalOpen(false);
        if (accounts?.[0]) await signInWithWallet(accounts[0], cbProvider);
      } else if (type === "walletconnect") {
        // WalletConnect v2 deeplink - opens the QR/deeplink flow
        window.open("https://walletconnect.com/", "_blank");
        setWalletModalOpen(false);
      }
    } catch (err) {
      console.error("Wallet connection failed", err);
    }
  };

  const openDetail = (p) => { setDetail(p); setView("detail"); };
  const openMarket = (p) => { setDetail(p); setView("market"); };
  const openProfile = () => setView("profile");
  const openOrder = (o) => { setOrder(o); setOrderStatus("confirm"); };

  const confirmOrder = async () => {
    setOrderStatus("pending");
    try {
      // Only send to API if wallet is connected
      if (walletAddress && order) {
        await createPrediction({
          wallet: walletAddress,
          marketId: order.market || `${order.asset}-${order.dir}`,
          asset: order.asset || "BTC",
          duration: order.duration || "15M",
          prediction: order.dir || "UP",
          entryPrice: order.price ? order.price / 100 : 0.5, // Normalize to 0-1 range
          username: wallet ? wallet : undefined,
        });
      }
      setTimeout(() => setOrderStatus("done"), 1100);
    } catch (error) {
      console.error("Failed to record prediction:", error);
      setOrderStatus("error");
    }
  };
  const retryOrder = () => confirmOrder();

  const tickerData = useMemo(() => [
    { a: "BTC/USD",  p: formatUsd(liveMarketData.BTC?.price  ?? FALLBACK_MARKETS.BTC.price),  chg: liveMarketData.BTC?.change  ?? FALLBACK_MARKETS.BTC.change },
    { a: "ETH/USD",  p: formatUsd(liveMarketData.ETH?.price  ?? FALLBACK_MARKETS.ETH.price),  chg: liveMarketData.ETH?.change  ?? FALLBACK_MARKETS.ETH.change },
    { a: "SOL/USD",  p: formatUsd(liveMarketData.SOL?.price  ?? FALLBACK_MARKETS.SOL.price),  chg: liveMarketData.SOL?.change  ?? FALLBACK_MARKETS.SOL.change },
    { a: "XRP/USD",  p: formatUsd(liveMarketData.XRP?.price  ?? FALLBACK_MARKETS.XRP.price),  chg: liveMarketData.XRP?.change  ?? FALLBACK_MARKETS.XRP.change },
    { a: "BNB/USD",  p: formatUsd(liveMarketData.BNB?.price  ?? FALLBACK_MARKETS.BNB.price),  chg: liveMarketData.BNB?.change  ?? FALLBACK_MARKETS.BNB.change },
    { a: "AVAX/USD", p: formatUsd(liveMarketData.AVAX?.price ?? FALLBACK_MARKETS.AVAX.price), chg: liveMarketData.AVAX?.change ?? FALLBACK_MARKETS.AVAX.change },
    { a: "DOGE/USD", p: formatUsd(liveMarketData.DOGE?.price ?? FALLBACK_MARKETS.DOGE.price), chg: liveMarketData.DOGE?.change ?? FALLBACK_MARKETS.DOGE.change },
    { a: "ADA/USD",  p: formatUsd(liveMarketData.ADA?.price  ?? FALLBACK_MARKETS.ADA.price),  chg: liveMarketData.ADA?.change  ?? FALLBACK_MARKETS.ADA.change },
    { a: "MATIC/USD",p: formatUsd(liveMarketData.MATIC?.price?? FALLBACK_MARKETS.MATIC.price),chg: liveMarketData.MATIC?.change?? FALLBACK_MARKETS.MATIC.change },
  ], [liveMarketData]);

  const marketOptions = useMemo(() => {
    const btc = normalizeMarketPrice("BTC", liveMarketData);
    const eth = normalizeMarketPrice("ETH", liveMarketData);
    const sol = normalizeMarketPrice("SOL", liveMarketData);

    return [
      { id: "btc15", market: "BTC 15M", asset: "BTC", question: "Will BTC finish higher in the next 15 minutes?", time: makeLiveCountdown(), price: btc.price },
      { id: "btc1h", market: "BTC 1H", asset: "BTC", question: "Will BTC finish higher in the next hour?", time: makeLiveCountdown(), price: btc.price },
      { id: "eth15", market: "ETH 15M", asset: "ETH", question: "Will ETH finish higher in the next 15 minutes?", time: makeLiveCountdown(), price: eth.price },
      { id: "eth1h", market: "ETH 1H", asset: "ETH", question: "Will ETH finish higher in the next hour?", time: makeLiveCountdown(), price: eth.price },
      { id: "sol15", market: "SOL 15M", asset: "SOL", question: "Will SOL finish higher in the next 15 minutes?", time: makeLiveCountdown(), price: sol.price },
    ];
  }, [liveMarketData]);

  const predictions = useMemo(() => {
    const btc = normalizeMarketPrice("BTC", liveMarketData);
    const eth = normalizeMarketPrice("ETH", liveMarketData);
    const sol = normalizeMarketPrice("SOL", liveMarketData);
    const now = makeLiveCountdown();

    return [
      { id: 1, user: "Mide", initials: "MD", market: "BTC 15M", contractId: "OC-BTC-001", asset: "BTC", dir: "UP", price: btc.realPrice, userAcc: 74, marketAcc: Math.min(99, Math.max(60, 60 + Math.abs(btc.change))), time: now, question: "Will BTC finish higher?", watched: "1,284", backed: "312" },
      { id: 2, user: "AlphaTrader", initials: "AT", market: "ETH 1H", contractId: "OC-ETH-002", asset: "ETH", dir: "DOWN", price: eth.realPrice, userAcc: 78, marketAcc: Math.min(99, Math.max(60, 60 + Math.abs(eth.change))), time: makeLiveCountdown(), question: "Will ETH finish higher?", watched: "876", backed: "195" },
      { id: 3, user: "QuantX", initials: "QX", market: "BTC 1H", contractId: "OC-BTC-003", asset: "BTC", dir: "UP", price: btc.realPrice, userAcc: 71, marketAcc: Math.min(99, Math.max(60, 60 + Math.abs(btc.change) * 0.8)), time: makeLiveCountdown(), question: "Will BTC finish higher?", watched: "640", backed: "148" },
      { id: 4, user: "NovaRae", initials: "NR", market: "SOL 15M", contractId: "OC-SOL-004", asset: "SOL", dir: "DOWN", price: sol.realPrice, userAcc: 65, marketAcc: Math.min(99, Math.max(55, 55 + Math.abs(sol.change))), time: makeLiveCountdown(), question: "Will SOL finish higher?", watched: "412", backed: "94" },
    ];
  }, [liveMarketData]);

  const marketFocus = predictions[0] || {
    id: 1,
    user: "Mide",
    initials: "MD",
    market: "BTC 15M",
    contractId: "OC-BTC-001",
    asset: "BTC",
    dir: "UP",
    price: normalizeMarketPrice("BTC", liveMarketData).price,
    userAcc: 74,
    marketAcc: 77,
    time: makeLiveCountdown(),
    question: "Will BTC finish higher?",
    watched: "1,284",
    backed: "312",
  };

  const bgImage = "/spheres-bg.png";
  const bgClass = "bg-drift-alt";

  if (!onboarded) {
    return (
      <div className="orc-root font-body">
        <GlobalStyles />
        <OnboardingScreen wallet={wallet} connectWallet={connectWallet} onContinue={finishOnboarding} onSkip={finishOnboarding} />
        {walletModalOpen && <WalletModal onConnect={handleWalletConnect} onClose={() => setWalletModalOpen(false)} />}
      </div>
    );
  }

  return (
    <div className="orc-root font-body" style={{ background: C.bg, minHeight: "100vh", color: C.text, position: "relative" }}>
      <GlobalStyles />

      <div className="section-bg-wrap" aria-hidden="true">
        <img
          src={bgImage}
          alt=""
          className={`section-bg-img ${bgClass}`}
          style={{
            opacity: 0.28,
            inset: 0,
            width: "100%",
            height: "100%",
          }}
        />
        {/* White circular glow - top center */}
        <div style={{
          position: "absolute", inset: 0,
          background: "radial-gradient(circle 600px at 50% 0%, rgba(255,255,255,0.032), transparent 70%)",
          pointerEvents: "none",
        }} />
        {/* Subtle white circular accent - bottom */}
        <div style={{
          position: "absolute", inset: 0,
          background: "radial-gradient(circle 400px at 50% 100%, rgba(255,255,255,0.018), transparent 60%)",
          pointerEvents: "none",
        }} />
      </div>

      <div className="app-shell-content" style={{ position: "relative", zIndex: 1 }}>
        <Nav
          view={view}
          setView={(v) => { setView(v); setDetail(null); }}
          wallet={wallet}
          walletBalance={walletBalance}
          signedIn={signedIn}
          connectWallet={connectWallet}
          onExit={onExit}
          tickerData={tickerData}
        />

        {view === "feed" && <FeedView predictions={predictions} onOpen={openDetail} onBack={openOrder} />}
        {view === "market" && <MarketView market={detail || marketFocus} onBack={openOrder} />}
        {view === "predict" && <PredictView marketOptions={marketOptions} onSubmit={openOrder} wallet={wallet} connectWallet={connectWallet} />}
        {view === "detail" && detail && <PredictionDetailView p={detail} onOpenMarket={openMarket} onOpenProfile={openProfile} onBack={openOrder} />}
        {view === "profile" && (
          <ProfileView
            profile={userProfileData}
            profileLoading={userProfileLoading}
            walletAddress={walletAddress}
            onOpenReceipt={setReceipt}
          />
        )}
        {view === "leaderboard" && <LeaderboardView leaderboardData={leaderboardData} leaderboardLoading={leaderboardLoading} />}
        {view === "battle" && <BattleView onBack={openOrder} />}
      </div>

      <TradeModal order={order} status={orderStatus} onClose={() => setOrder(null)} onConfirm={confirmOrder} onRetry={retryOrder} />
      <PredictionReceipt item={receipt} onClose={() => setReceipt(null)} />
      {walletModalOpen && <WalletModal onConnect={handleWalletConnect} onClose={() => setWalletModalOpen(false)} />}
    </div>
  );
}
