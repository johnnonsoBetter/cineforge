import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from './api.js';
import { authEnabled, signOut } from './auth.js';
import { SETTING_GROUPS, DEFAULT_SETTINGS } from './ui.js';

/* ─────────────────────────────────────────────────────────────────────────────
   CineForge — Elevated Landing
   Palette: near-black #0a0805 · gold #e4a555 · cream #c8c0b4 · surface #1a1410
   Type: Georgia serif (wordmark/display) · monospace (labels/meta) · sans (body/UI)
───────────────────────────────────────────────────────────────────────────── */

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;1,400&display=swap');

  :root {
    --ink:      #0a0805;
    --gold:     #e4a555;
    --gold-dim: rgba(228,165,85,0.18);
    --gold-mid: rgba(228,165,85,0.42);
    --cream:    #c8c0b4;
    --muted:    #6b5f4a;
    --faint:    #3d3428;
    --surface:  #131008;
    --card:     rgba(22,17,10,0.82);
    --card-bdr: rgba(228,165,85,0.14);
    --card-bdr-hover: rgba(228,165,85,0.55);
    --glass:    rgba(255,255,255,0.03);
    --font-display: 'Playfair Display', Georgia, serif;
    --font-mono:    ui-monospace, 'Cascadia Code', 'Fira Code', monospace;
    --font-body:    -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }

  .cf-root {
    min-height: 100vh;
    background: var(--ink);
    color: var(--cream);
    font-family: var(--font-body);
    position: relative;
    overflow-x: hidden;
  }

  /* ── Grain & vignette ── */
  .cf-root::before {
    content: '';
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 0;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)' opacity='0.045'/%3E%3C/svg%3E");
    background-size: 300px 300px;
    animation: grain 8s steps(10, end) infinite;
    opacity: 0.6;
  }
  .cf-root::after {
    content: '';
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 0;
    background: radial-gradient(ellipse 80% 70% at 50% 0%, transparent 30%, rgba(10,8,5,0.72) 100%),
                radial-gradient(ellipse 100% 50% at 50% 100%, rgba(10,8,5,0.9) 0%, transparent 60%);
  }
  @keyframes grain {
    0%,100% { background-position: 0 0; }
    10%  { background-position: -5% -10%; }
    30%  { background-position: -15% 5%; }
    50%  { background-position: 7% -20%; }
    70%  { background-position: -10% 10%; }
    90%  { background-position: 5% 5%; }
  }

  /* ── Ambient light leaks ── */
  .cf-glow {
    position: fixed;
    border-radius: 50%;
    pointer-events: none;
    filter: blur(120px);
    z-index: 0;
  }
  .cf-glow-top {
    top: -160px; left: 50%;
    transform: translateX(-50%);
    width: 700px; height: 340px;
    background: radial-gradient(ellipse, rgba(228,165,85,0.07) 0%, transparent 70%);
  }
  .cf-glow-left {
    bottom: 20%; left: -120px;
    width: 400px; height: 500px;
    background: radial-gradient(ellipse, rgba(228,165,85,0.04) 0%, transparent 70%);
  }
  .cf-glow-right {
    top: 30%; right: -100px;
    width: 350px; height: 450px;
    background: radial-gradient(ellipse, rgba(200,192,180,0.03) 0%, transparent 70%);
  }

  /* ── Topbar ── */
  .cf-topbar {
    position: relative;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 28px;
    border-bottom: 1px solid rgba(228,165,85,0.07);
  }
  .cf-icon-btn {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 6px;
    border-radius: 8px;
    transition: color 0.2s;
    display: flex;
    align-items: center;
  }
  .cf-icon-btn:hover { color: var(--cream); }

  .cf-topbar-wordmark {
    font-family: var(--font-display);
    font-size: 15px;
    font-weight: 500;
    letter-spacing: 0.12em;
    color: var(--gold);
    opacity: 0.9;
    text-transform: uppercase;
  }
  .cf-topbar-nav {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .cf-nav-link {
    background: none;
    border: none;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.08em;
    cursor: pointer;
    padding: 6px 12px;
    border-radius: 6px;
    transition: color 0.2s;
    text-transform: uppercase;
  }
  .cf-nav-link:hover { color: var(--cream); }
  .cf-nav-btn {
    background: var(--glass);
    border: 1px solid var(--card-bdr);
    color: var(--cream);
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 7px 16px;
    border-radius: 8px;
    cursor: pointer;
    backdrop-filter: blur(8px);
    transition: border-color 0.2s, color 0.2s;
  }
  .cf-nav-btn:hover { border-color: var(--gold-mid); color: var(--gold); }

  /* ── Main ── */
  .cf-main {
    position: relative;
    z-index: 1;
    max-width: 680px;
    margin: 0 auto;
    padding: 0 24px 80px;
  }

  /* ── Hero ── */
  .cf-hero {
    text-align: center;
    padding: 72px 0 52px;
  }
  .cf-eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--gold);
    opacity: 0.7;
    margin-bottom: 22px;
  }
  .cf-eyebrow-dot {
    width: 5px; height: 5px;
    border-radius: 50%;
    background: var(--gold);
    opacity: 0.8;
  }
  .cf-wordmark {
    font-family: var(--font-display);
    font-size: clamp(54px, 10vw, 88px);
    font-weight: 400;
    letter-spacing: -0.01em;
    color: #e8e0d4;
    line-height: 1;
    margin: 0 0 20px;
  }
  .cf-tagline {
    font-family: var(--font-display);
    font-style: italic;
    font-size: 17px;
    color: var(--muted);
    margin: 0;
    letter-spacing: 0.01em;
  }

  /* ── Composer ── */
  .cf-composer-wrap {
    margin-bottom: 56px;
  }
  .cf-composer {
    background: var(--card);
    border: 1px solid var(--card-bdr);
    border-radius: 18px;
    overflow: hidden;
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    transition: border-color 0.25s;
    box-shadow: 0 40px 80px rgba(0,0,0,0.55), 0 0 0 0.5px rgba(228,165,85,0.05) inset;
  }
  .cf-composer:focus-within {
    border-color: rgba(228,165,85,0.28);
    box-shadow: 0 40px 80px rgba(0,0,0,0.6), 0 0 32px rgba(228,165,85,0.05);
  }
  .cf-composer-body {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    padding: 20px 22px 12px;
  }
  .cf-badge {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: rgba(228,165,85,0.1);
    border: 1px solid rgba(228,165,85,0.22);
    border-radius: 10px;
    padding: 8px 10px;
    margin-top: 2px;
  }
  .cf-badge-star {
    color: var(--gold);
    font-size: 13px;
    line-height: 1;
  }
  .cf-composer-ta {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    resize: none;
    color: var(--cream);
    font-family: var(--font-body);
    font-size: 15px;
    line-height: 1.6;
    caret-color: var(--gold);
    min-height: 48px;
  }
  .cf-composer-ta::placeholder { color: var(--faint); }

  /* Options panel */
  .cf-opts {
    border-top: 1px solid rgba(228,165,85,0.07);
    padding: 16px 22px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .cf-opt-group { display: flex; flex-direction: column; gap: 8px; }
  .cf-opt-label {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .cf-opt-row { display: flex; flex-wrap: wrap; gap: 6px; }
  .cf-opt-btn {
    background: rgba(255,255,255,0.03);
    border: 1px solid var(--faint);
    border-radius: 8px;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 5px 12px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .cf-opt-btn:hover { border-color: var(--gold-mid); color: var(--cream); }
  .cf-opt-btn--on {
    background: rgba(228,165,85,0.12);
    border-color: var(--gold-mid);
    color: var(--gold);
  }

  /* Composer footer */
  .cf-composer-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px 14px;
    border-top: 1px solid rgba(228,165,85,0.06);
  }
  .cf-foot-left { display: flex; align-items: center; gap: 8px; }
  .cf-foot-right { display: flex; align-items: center; gap: 8px; }

  .cf-toggle-btn {
    width: 30px; height: 30px;
    border-radius: 8px;
    border: 1px solid var(--faint);
    background: none;
    color: var(--muted);
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.15s;
  }
  .cf-toggle-btn:hover { border-color: var(--gold-mid); color: var(--gold); }
  .cf-toggle-btn--on { border-color: var(--gold-mid); color: var(--gold); background: rgba(228,165,85,0.08); }

  .cf-style-pill {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    border: 1px solid var(--faint);
    border-radius: 8px;
    background: none;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 5px 12px;
    cursor: pointer;
    transition: all 0.15s;
    letter-spacing: 0.05em;
  }
  .cf-style-pill::before {
    content: '◈';
    font-size: 10px;
    color: inherit;
    opacity: 0.7;
  }
  .cf-style-pill:hover { border-color: var(--gold-mid); color: var(--cream); }
  .cf-style-pill--on { border-color: var(--gold-mid); color: var(--gold); background: rgba(228,165,85,0.06); }

  .cf-meta-btn {
    border: 1px solid var(--faint);
    border-radius: 8px;
    background: none;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 5px 12px;
    cursor: pointer;
    transition: all 0.15s;
    letter-spacing: 0.04em;
  }
  .cf-meta-btn:hover { border-color: var(--gold-mid); color: var(--cream); }

  .cf-send-btn {
    width: 36px; height: 36px;
    border-radius: 50%;
    border: none;
    background: var(--gold);
    color: var(--ink);
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: transform 0.15s, background 0.15s, box-shadow 0.15s;
    box-shadow: 0 4px 18px rgba(228,165,85,0.28);
    flex-shrink: 0;
  }
  .cf-send-btn:hover:not(:disabled) {
    background: #f0b96a;
    transform: scale(1.07);
    box-shadow: 0 6px 24px rgba(228,165,85,0.42);
  }
  .cf-send-btn:disabled { opacity: 0.28; cursor: default; }

  /* ── Section header ── */
  .cf-section { margin-top: 16px; }
  .cf-section-header {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 18px;
  }
  .cf-section-label {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--muted);
    white-space: nowrap;
  }
  .cf-section-rule {
    flex: 1;
    height: 1px;
    background: linear-gradient(to right, rgba(228,165,85,0.14), transparent);
  }

  /* ── Genre grid ── */
  .cf-genre-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }
  .cf-genre-card {
    all: unset;
    display: block;
    cursor: pointer;
    border-radius: 14px;
    overflow: hidden;
    border: 1px solid var(--card-bdr);
    aspect-ratio: 4/3;
    position: relative;
    transition: border-color 0.2s, transform 0.2s, box-shadow 0.2s;
  }
  .cf-genre-card:hover {
    border-color: var(--gold-mid);
    transform: translateY(-3px);
    box-shadow: 0 24px 48px rgba(0,0,0,0.55), 0 0 0 0.5px rgba(228,165,85,0.1);
  }
  .cf-genre-card--on {
    border-color: rgba(228,165,85,0.7) !important;
    box-shadow: 0 0 0 2px rgba(228,165,85,0.2), 0 24px 48px rgba(0,0,0,0.6);
  }
  .cf-genre-hover {
    position: absolute;
    inset: 0;
    background: rgba(228,165,85,0);
    transition: background 0.2s;
    pointer-events: none;
  }
  .cf-genre-card:hover .cf-genre-hover { background: rgba(228,165,85,0.03); }

  .cf-genre-names {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    margin-top: 8px;
  }
  .cf-genre-name {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.06em;
    color: var(--muted);
    text-align: center;
    display: block;
    transition: color 0.15s;
    text-transform: uppercase;
  }
  .cf-genre-name--on { color: var(--gold); }

  /* ── Thumbnail internals ── */
  .gt-base {
    width: 100%; height: 100%;
    display: flex; flex-direction: column;
    justify-content: flex-end;
    padding: 10px;
    position: relative;
    overflow: hidden;
  }

  /* Neon Noir */
  .gt-neon-noir {
    width: 100%; height: 100%;
    background: #020e04;
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 10px 10px 8px;
  }
  .gt-scanlines {
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,255,80,0.015) 3px, rgba(0,255,80,0.015) 4px);
    pointer-events: none;
  }
  .gt-mono { font-family: var(--font-mono); line-height: 1.4; }
  .gt-green { color: #22c55e; font-size: 9px; font-weight: 500; }
  .gt-green-dim { color: rgba(34,197,94,0.42); font-size: 7px; display: block; margin-top: 2px; }
  .gt-binary-row { color: rgba(34,197,94,0.22); font-size: 6px; letter-spacing: 0.08em; }

  /* Stage Drama */
  .gt-stage-drama {
    width: 100%; height: 100%;
    background: linear-gradient(160deg, #3d0a0a 0%, #1a0505 50%, #0d0000 100%);
    position: relative;
    overflow: hidden;
    display: flex; align-items: center; justify-content: center;
  }
  .gt-curtain {
    position: absolute;
    top: 0; bottom: 0;
    width: 38%;
    background: linear-gradient(to bottom, #7a1010 0%, #3d0808 60%, #200404 100%);
    opacity: 0.9;
  }
  .gt-curtain::before {
    content: '';
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(180deg, rgba(255,255,255,0.03) 0px, rgba(255,255,255,0.03) 1px, transparent 1px, transparent 8px);
  }
  .gt-curtain-l { left: 0; border-radius: 0 40% 20% 0 / 0 30% 15% 0; }
  .gt-curtain-r { right: 0; border-radius: 40% 0 0 20% / 30% 0 0 15%; }
  .gt-stage-center { text-align: center; z-index: 1; }
  .gt-serif-sm {
    font-family: var(--font-display);
    font-style: italic;
    color: #f5c8a8;
    font-size: 9px;
    display: block;
    letter-spacing: 0.04em;
  }
  .gt-stage-sub {
    font-family: var(--font-mono);
    color: rgba(245,200,168,0.35);
    font-size: 6px;
    display: block;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    margin-top: 4px;
  }

  /* Flow Shader */
  .gt-flow-shader {
    width: 100%; height: 100%;
    background: linear-gradient(135deg, #061830 0%, #0a1e3a 40%, #051525 100%);
    position: relative;
    overflow: hidden;
    display: flex;
    align-items: center;
  }
  .gt-orb {
    position: absolute;
    border-radius: 50%;
    filter: blur(24px);
  }
  .gt-orb-1 {
    width: 80px; height: 80px;
    top: -20px; left: -10px;
    background: radial-gradient(circle, rgba(56,189,248,0.35) 0%, transparent 70%);
  }
  .gt-orb-2 {
    width: 60px; height: 60px;
    bottom: -15px; right: -5px;
    background: radial-gradient(circle, rgba(99,102,241,0.3) 0%, transparent 70%);
  }
  .gt-flow-text {
    padding: 0 12px;
    z-index: 1;
  }
  .gt-flow-word {
    display: block;
    font-family: var(--font-display);
    font-size: 13px;
    font-weight: 500;
    color: rgba(186,230,253,0.9);
    letter-spacing: 0.2em;
    line-height: 1.3;
  }
  .gt-flow-sub {
    display: block;
    font-family: var(--font-mono);
    font-size: 6px;
    color: rgba(147,197,253,0.35);
    letter-spacing: 0.1em;
    margin-top: 6px;
    text-transform: uppercase;
  }

  /* Journeys */
  .gt-journeys {
    width: 100%; height: 100%;
    background: linear-gradient(170deg, #1a110a 0%, #0e0b07 60%, #080604 100%);
    position: relative;
    overflow: hidden;
    display: flex;
    align-items: flex-end;
    padding: 10px;
  }
  .gt-film-lines {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(180deg, rgba(200,170,100,0.06) 1px, transparent 1px),
      linear-gradient(90deg, rgba(200,170,100,0.04) 1px, transparent 1px);
    background-size: 100% 12px, 12px 100%;
  }
  .gt-notch {
    position: absolute;
    width: 8px; height: 12px;
    background: rgba(200,170,100,0.15);
    border-radius: 2px;
  }
  .gt-notch-tl { top: 8px; left: 8px; }
  .gt-notch-tr { top: 8px; right: 8px; }
  .gt-journeys-caption { z-index: 1; }
  .gt-serif-italic {
    display: block;
    font-family: var(--font-display);
    font-style: italic;
    font-size: 8px;
    color: rgba(200,180,140,0.75);
    line-height: 1.5;
  }

  /* Dusk */
  .gt-dusk {
    width: 100%; height: 100%;
    background: linear-gradient(to bottom, #0f0a14 0%, #1e0e24 30%, #3d1a10 65%, #6b2d10 80%, #1a0a05 100%);
    position: relative;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .gt-dusk-sun {
    position: absolute;
    width: 36px; height: 36px;
    border-radius: 50%;
    background: radial-gradient(circle, #fbbf24 0%, #f97316 50%, rgba(249,115,22,0) 100%);
    top: 50%; left: 50%;
    transform: translate(-50%, -50%) translateY(4px);
    box-shadow: 0 0 24px 8px rgba(251,191,36,0.2), 0 0 60px 20px rgba(249,115,22,0.1);
  }
  .gt-dusk-horizon {
    position: absolute;
    bottom: 0; left: 0; right: 0;
    height: 30%;
    background: linear-gradient(to top, rgba(26,10,5,0.95), transparent);
  }
  .gt-dusk-label {
    position: absolute;
    bottom: 8px; left: 10px;
    font-family: var(--font-mono);
    font-size: 7px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: rgba(251,191,36,0.35);
  }

  /* Archive */
  .gt-archive {
    width: 100%; height: 100%;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 2px;
    background: #0d0b09;
    position: relative;
    overflow: hidden;
  }
  .gt-archive-cell {
    background: #141210;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .gt-archive-thumb {
    width: 60%; height: 55%;
    background: linear-gradient(135deg, #2a2520, #1a1712);
    border-radius: 2px;
    border: 1px solid rgba(200,192,180,0.08);
  }
  .gt-archive-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(135deg, rgba(13,11,9,0.4), rgba(13,11,9,0.1));
    display: flex;
    align-items: flex-end;
    justify-content: flex-end;
    padding: 8px;
  }
  .gt-archive-label {
    font-family: var(--font-mono);
    font-size: 7px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: rgba(200,192,180,0.3);
  }

  /* ── Gallery cards (real data) ── */
  .cf-gallery-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
  }

  /* ── Footer ── */
  .cf-footer {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 28px;
    border-top: 1px solid rgba(228,165,85,0.06);
  }
  .cf-footer-brand {
    font-family: var(--font-display);
    font-size: 14px;
    font-weight: 400;
    color: var(--gold);
    opacity: 0.6;
    letter-spacing: 0.06em;
  }
  .cf-footer-dot { color: var(--faint); }
  .cf-footer-sub {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.1em;
    color: var(--faint);
    text-transform: uppercase;
  }

  @media (max-width: 500px) {
    .cf-genre-grid, .cf-genre-names, .cf-gallery-grid { grid-template-columns: repeat(2, 1fr); }
    .cf-wordmark { font-size: 52px; }
    .cf-hero { padding: 48px 0 36px; }
  }
`;

export default function Landing({ session }) {
  const navigate = useNavigate();
  const [gallery, setGallery] = useState([]);
  const [adopting, setAdopting] = useState(null);

  useEffect(() => {
    api.getGallery().then((r) => setGallery(r.projects || [])).catch(() => setGallery([]));
  }, []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'auto';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const startForge = (idea, settings) => {
    if (authEnabled && !session) { navigate('/login'); return; }
    navigate('/studio', { state: { forge: { idea, settings } } });
  };

  const useTemplate = async (projectId) => {
    if (authEnabled && !session) { navigate('/login'); return; }
    if (adopting) return;
    setAdopting(projectId);
    try {
      const { project_id } = await api.cloneProject(projectId);
      navigate(`/p/${project_id}`);
    } catch {
      setAdopting(null);
    }
  };

  const scrollToTemplates = () =>
    document.getElementById('cf-templates')?.scrollIntoView({ behavior: 'smooth' });

  return (
    <div className="cf-root">
      <style>{CSS}</style>

      <div className="cf-glow cf-glow-top"   aria-hidden />
      <div className="cf-glow cf-glow-left"  aria-hidden />
      <div className="cf-glow cf-glow-right" aria-hidden />

      {/* Topbar */}
      <header className="cf-topbar">
        <button className="cf-icon-btn" title="Menu">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="7" height="18" rx="1.5"/>
            <rect x="14" y="3" width="7" height="18" rx="1.5"/>
          </svg>
        </button>

        <span className="cf-topbar-wordmark">CineForge</span>

        <nav className="cf-topbar-nav">
          <button className="cf-nav-link" onClick={scrollToTemplates}>Templates</button>
          {authEnabled && session && (
            <button className="cf-nav-btn" onClick={() => signOut()} title={session.user?.email}>Sign out</button>
          )}
          {authEnabled && !session && (
            <button className="cf-nav-btn" onClick={() => navigate('/login')}>Sign in</button>
          )}
        </nav>
      </header>

      <main className="cf-main">
        {/* Hero */}
        <div className="cf-hero">
          <div className="cf-eyebrow">
            <span className="cf-eyebrow-dot" />
            AI Film Studio
          </div>
          <h1 className="cf-wordmark">CineForge</h1>
          <p className="cf-tagline">Give us one idea. We direct the whole film.</p>
        </div>

        {/* Composer */}
        <Composer onForge={startForge} />

        {/* Templates */}
        <section className="cf-section" id="cf-templates">
          <div className="cf-section-header">
            <span className="cf-section-label">Select template</span>
            <span className="cf-section-rule" />
          </div>
          {gallery.length > 0 ? (
            <div className="cf-gallery-grid">
              {gallery.map((f) => (
                <GalleryCard
                  key={f.project_id}
                  film={f}
                  busy={adopting === f.project_id}
                  onClick={() => useTemplate(f.project_id)}
                />
              ))}
            </div>
          ) : (
            <GenreGrid />
          )}
        </section>
      </main>

      <footer className="cf-footer">
        <span className="cf-footer-brand">CineForge</span>
        <span className="cf-footer-dot">·</span>
        <span className="cf-footer-sub">One idea, one finished cut</span>
      </footer>
    </div>
  );
}

/* ── Composer ── */
function Composer({ onForge }) {
  const [idea, setIdea]         = useState('');
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [showOpts, setShowOpts] = useState(false);

  const submit = () => { const t = idea.trim(); if (t) onForge(t, settings); };

  const styleLabel =
    SETTING_GROUPS.find(([k]) => k === 'style_preset')?.[2]
      .find(([v]) => v === settings.style_preset)?.[1] || settings.style_preset;

  return (
    <div className="cf-composer-wrap">
      <div className={`cf-composer${showOpts ? ' cf-composer--open' : ''}`}>
        <div className="cf-composer-body">
          <div className="cf-badge">
            <span className="cf-badge-star">✦</span>
          </div>
          <textarea
            className="cf-composer-ta"
            placeholder="Describe the film you want to make…"
            value={idea}
            autoFocus
            rows={2}
            onChange={(e) => setIdea(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
            }}
          />
        </div>

        {showOpts && (
          <div className="cf-opts">
            {SETTING_GROUPS.map(([key, label, options]) => (
              <div className="cf-opt-group" key={key}>
                <span className="cf-opt-label">{label}</span>
                <div className="cf-opt-row">
                  {options.map(([value, text]) => (
                    <button
                      key={value}
                      className={`cf-opt-btn${settings[key] === value ? ' cf-opt-btn--on' : ''}`}
                      onClick={() => setSettings((s) => ({ ...s, [key]: value }))}
                    >
                      {text}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="cf-composer-foot">
          <div className="cf-foot-left">
            <button
              className={`cf-toggle-btn${showOpts ? ' cf-toggle-btn--on' : ''}`}
              onClick={() => setShowOpts((o) => !o)}
              title="Film settings"
            >
              {showOpts ? '×' : '+'}
            </button>
            <button
              className={`cf-style-pill${showOpts ? ' cf-style-pill--on' : ''}`}
              onClick={() => setShowOpts((o) => !o)}
              title="Style preset"
            >
              {styleLabel}
            </button>
          </div>

          <div className="cf-foot-right">
            <button
              className="cf-meta-btn"
              onClick={() => setShowOpts((o) => !o)}
              title="Length & format"
            >
              {settings.length_min} min · {settings.aspect} ⌄
            </button>
            <button
              className="cf-send-btn"
              onClick={submit}
              disabled={!idea.trim()}
              title="Forge the film"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="19" x2="12" y2="5"/>
                <polyline points="5 12 12 5 19 12"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Genre grid ── */
const GENRES = [
  {
    id: 'neon-noir', name: 'Neon Noir',
    Thumb: () => (
      <div className="gt-neon-noir">
        <div className="gt-scanlines" />
        <div>
          <span className="gt-mono gt-green">Memory Lab</span>
          <span className="gt-mono gt-green-dim">Exploring digital consciousness</span>
        </div>
        <div>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="gt-mono gt-binary-row">
              {Array.from({ length: 14 }).map(() => Math.random() > 0.5 ? '1' : '0').join(' ')}
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: 'stage-drama', name: 'Stage Drama',
    Thumb: () => (
      <div className="gt-stage-drama">
        <div className="gt-curtain gt-curtain-l" />
        <div className="gt-curtain gt-curtain-r" />
        <div className="gt-stage-center">
          <span className="gt-serif-sm">Virginia Woolf</span>
          <span className="gt-mono gt-stage-sub">Stage Drama</span>
        </div>
      </div>
    ),
  },
  {
    id: 'flow-shader', name: 'Flow Shader',
    Thumb: () => (
      <div className="gt-flow-shader">
        <div className="gt-orb gt-orb-1" />
        <div className="gt-orb gt-orb-2" />
        <div className="gt-flow-text">
          <span className="gt-flow-word">FLOW</span>
          <span className="gt-flow-word">SHADER</span>
          <span className="gt-flow-sub">You Design with Light</span>
        </div>
      </div>
    ),
  },
  {
    id: 'journeys', name: 'Journeys',
    Thumb: () => (
      <div className="gt-journeys">
        <div className="gt-film-lines" />
        <div className="gt-notch gt-notch-tl" />
        <div className="gt-notch gt-notch-tr" />
        <div className="gt-journeys-caption">
          <span className="gt-serif-italic">Journeys That</span>
          <span className="gt-serif-italic">Shape the Soul</span>
        </div>
      </div>
    ),
  },
  {
    id: 'dusk', name: 'Dusk',
    Thumb: () => (
      <div className="gt-dusk">
        <div className="gt-dusk-sun" />
        <div className="gt-dusk-horizon" />
        <span className="gt-dusk-label">Dusk</span>
      </div>
    ),
  },
  {
    id: 'archive', name: 'Archive',
    Thumb: () => (
      <div className="gt-archive">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="gt-archive-cell">
            <div className="gt-archive-thumb" />
          </div>
        ))}
        <div className="gt-archive-overlay">
          <span className="gt-archive-label">Archive</span>
        </div>
      </div>
    ),
  },
];

function GenreGrid() {
  const [selected, setSelected] = useState(null);
  return (
    <div>
      <div className="cf-genre-grid">
        {GENRES.map(({ id, name, Thumb }) => (
          <button
            key={id}
            onClick={() => setSelected((s) => (s === id ? null : id))}
            className={`cf-genre-card${selected === id ? ' cf-genre-card--on' : ''}`}
            aria-pressed={selected === id}
            title={name}
          >
            <Thumb />
            <div className="cf-genre-hover" />
          </button>
        ))}
      </div>
      <div className="cf-genre-names">
        {GENRES.map(({ id, name }) => (
          <span key={id} className={`cf-genre-name${selected === id ? ' cf-genre-name--on' : ''}`}>
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── Real gallery cards ── */
const styleName = (p) =>
  SETTING_GROUPS.find(([k]) => k === 'style_preset')?.[2].find(([v]) => v === p)?.[1] || p;

function GalleryCard({ film, busy, onClick }) {
  return (
    <button
      style={{ all: 'unset', display: 'flex', flexDirection: 'column', cursor: 'pointer', textAlign: 'left' }}
      onClick={onClick}
      disabled={busy}
      title={film.idea || film.title}
    >
      <div
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '16/9',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          borderRadius: 14,
          border: '1px solid rgba(228,165,85,0.14)',
          background: '#131008',
          backgroundImage: film.cover ? `url(${film.cover})` : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          transition: 'all 0.2s',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.transform = 'translateY(-3px)';
          e.currentTarget.style.borderColor = 'rgba(228,165,85,0.55)';
          e.currentTarget.style.boxShadow = '0 24px 48px rgba(0,0,0,0.55)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.transform = '';
          e.currentTarget.style.borderColor = 'rgba(228,165,85,0.14)';
          e.currentTarget.style.boxShadow = '';
        }}
      >
        {!film.cover && (
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontStyle: 'italic', color: 'var(--faint)' }}>
            CineForge
          </span>
        )}
        {film.style_preset && (
          <span style={{
            position: 'absolute', top: 10, right: 10,
            borderRadius: 6,
            border: '1px solid rgba(228,165,85,0.3)',
            background: 'rgba(20,16,12,0.8)',
            padding: '3px 8px',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: '#c8c0b4',
            backdropFilter: 'blur(8px)',
            letterSpacing: '0.06em',
            textTransform: 'capitalize',
          }}>
            {styleName(film.style_preset)}
          </span>
        )}
        {busy && (
          <span style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(20,16,12,0.85)',
            fontFamily: 'var(--font-mono)', fontSize: 10,
            letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--gold)',
            backdropFilter: 'blur(8px)',
          }}>
            Adopting…
          </span>
        )}
      </div>
      <div style={{ padding: '10px 2px 0' }}>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {film.title || 'Untitled Film'}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--faint)', marginTop: 3, letterSpacing: '0.05em' }}>
          {film.node_count ?? 0} nodes · {film.length_min ?? 1} min
        </div>
      </div>
    </button>
  );
}