import { useMemo, useRef, useState } from 'react';
import StaticNoise from './StaticNoise';
import { useTvPlayer } from '../hooks/useTvPlayer';

// A real <video>-backed player wearing the Lumina retro-TV frame. One component serves the
// whole app: pass a single { src, poster, title } or a `sources` playlist (its clips are the
// TV's "channels"). `variant="frame"` is the full wooden set for hero contexts; `variant="slim"`
// drops the body to just the glowing screen for tight panels and canvas nodes.
export default function TvPlayer({
  src, poster, title, subtitle, badge,
  sources,
  variant = 'frame',
  brand = 'CineForge',
  autoPlay = false,
  startIndex = 0,
  onEnded,
  className = '',
}) {
  const clips = useMemo(
    () => (sources?.length ? sources : [{ src, poster, title, subtitle, badge }]),
    [sources, src, poster, title, subtitle, badge],
  );

  const videoRef = useRef(null);
  const screenRef = useRef(null);
  const trackRef = useRef(null);
  const hideTimer = useRef(null);
  const [showControls, setShowControls] = useState(false);

  const p = useTvPlayer(videoRef, screenRef, clips, { autoPlay, startIndex, onEnded });
  const playlist = clips.length > 1;
  const controlsUp = showControls || !p.playing;

  const reveal = () => {
    setShowControls(true);
    clearTimeout(hideTimer.current);
    if (p.playing) hideTimer.current = setTimeout(() => setShowControls(false), 2500);
  };

  const scrub = (clientX) => {
    const r = trackRef.current?.getBoundingClientRect();
    if (r) p.seekFraction(Math.max(0, Math.min(1, (clientX - r.left) / r.width)));
  };

  const onKey = (e) => {
    const k = e.key;
    if (k === ' ' || k === 'k') { e.preventDefault(); p.togglePlay(); }
    else if (k === 'ArrowRight') { e.preventDefault(); p.seekTo(p.time + 5); }
    else if (k === 'ArrowLeft') { e.preventDefault(); p.seekTo(p.time - 5); }
    else if (k === 'ArrowUp') { e.preventDefault(); p.changeVolume(Math.min(1, p.volume + 0.1)); }
    else if (k === 'ArrowDown') { e.preventDefault(); p.changeVolume(Math.max(0, p.volume - 0.1)); }
    else if (k === 'm') p.toggleMute();
    else if (k === 'f') p.toggleFullscreen();
    else if (playlist && (k === ']' || k === 'n')) p.next();
    else if (playlist && (k === '[' || k === 'P')) p.prev();
  };

  const btn = 'grid place-items-center rounded p-1.5 text-white/85 hover:text-white hover:bg-white/10 transition';

  const screen = (
    <div
      ref={screenRef}
      tabIndex={0}
      onKeyDown={onKey}
      onPointerMove={reveal}
      onClick={p.togglePlay}
      className="group relative w-full aspect-video overflow-hidden bg-black outline-none cursor-pointer rounded-md select-none"
    >
      <video
        ref={videoRef}
        src={p.clip?.src}
        poster={p.clip?.poster}
        playsInline
        preload="metadata"
        className="absolute inset-0 h-full w-full bg-black object-contain"
      />

      {/* CRT scanlines + glass glare — pure flourish, never eat clicks. */}
      <div
        className="pointer-events-none absolute inset-0 z-30"
        style={{ background: 'repeating-linear-gradient(0deg,transparent 0,transparent 2px,rgba(0,0,0,.05) 3px,rgba(0,0,0,.05) 4px)' }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-30 h-1/3"
        style={{ background: 'linear-gradient(180deg,rgba(255,255,255,.05),transparent)' }}
      />

      <StaticNoise active={p.switching} />

      {/* Channel corners */}
      {(p.clip?.badge || playlist) && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between p-3 font-mono text-[10px] tracking-[0.18em] text-white/55">
          <span>{playlist ? `CH ${String(p.index + 1).padStart(2, '0')}` : ''}</span>
          {p.clip?.badge && <span className="text-gold">{p.clip.badge}</span>}
        </div>
      )}

      {/* ON AIR while rolling */}
      {p.playing && (
        <div className="pointer-events-none absolute right-3 top-8 z-20 rounded bg-red px-2 py-0.5 font-mono text-[8px] font-bold tracking-[0.2em] text-white shadow">
          ● ON AIR
        </div>
      )}

      {/* Center title + big play (before start / when paused) */}
      {!p.playing && !p.switching && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 text-center">
          <button
            type="button"
            aria-label="Play"
            onClick={(e) => { e.stopPropagation(); p.togglePlay(); }}
            className="grid h-14 w-14 place-items-center rounded-full border border-white/25 bg-white/10 text-white backdrop-blur-md transition hover:scale-105 hover:bg-white/20"
          >
            <Play size={24} className="ml-0.5" />
          </button>
          {!p.started && p.clip?.title && (
            <div className="px-4">
              <div className="text-[15px] font-semibold text-white">{p.clip.title}</div>
              {p.clip.subtitle && (
                <div className="mt-0.5 text-[11px] uppercase tracking-[0.15em] text-white/55">{p.clip.subtitle}</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Controls */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`absolute inset-x-0 bottom-0 z-40 px-3 pb-2.5 pt-6 transition-transform duration-300 ${controlsUp ? 'translate-y-0' : 'translate-y-full'}`}
        style={{ background: 'linear-gradient(0deg,rgba(0,0,0,.92),rgba(0,0,0,.5) 65%,transparent)' }}
      >
        {/* Progress */}
        <div
          ref={trackRef}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); scrub(e.clientX); }}
          onPointerMove={(e) => { if (e.buttons === 1) scrub(e.clientX); }}
          className="group/track relative mb-2.5 h-1.5 cursor-pointer rounded-full bg-white/15"
        >
          <div className="absolute inset-y-0 left-0 rounded-full bg-white/20" style={{ width: `${p.bufferedPercent}%` }} />
          <div className="absolute inset-y-0 left-0 rounded-full bg-gold" style={{ width: `${p.progress}%` }}>
            <span className="absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 translate-x-1/2 rounded-full bg-gold opacity-0 shadow-[0_0_6px_rgba(228,165,85,.7)] transition-opacity group-hover/track:opacity-100" />
          </div>
        </div>

        {/* Buttons */}
        <div className="flex items-center gap-1.5">
          <button type="button" className={btn} onClick={p.togglePlay} aria-label={p.playing ? 'Pause' : 'Play'}>
            {p.playing ? <Pause size={18} /> : <Play size={18} />}
          </button>
          {playlist && (
            <>
              <button type="button" className={btn} onClick={p.prev} aria-label="Previous"><Prev size={18} /></button>
              <button type="button" className={btn} onClick={p.next} aria-label="Next"><Next size={18} /></button>
            </>
          )}
          <span className="mx-1 whitespace-nowrap font-mono text-[10px] tracking-wide text-white/60">{p.timeLabel}</span>
          <span className="flex-1" />
          <div className="flex items-center gap-1.5">
            <button type="button" className={btn} onClick={p.toggleMute} aria-label={p.muted ? 'Unmute' : 'Mute'}>
              {p.muted || p.volume === 0 ? <Muted size={18} /> : <Volume size={18} />}
            </button>
            <input
              type="range" min={0} max={1} step={0.01}
              value={p.muted ? 0 : p.volume}
              onChange={(e) => p.changeVolume(Number(e.target.value))}
              aria-label="Volume"
              className="h-1 w-14 cursor-pointer accent-gold"
            />
          </div>
          <button type="button" className={btn} onClick={p.toggleFullscreen} aria-label="Fullscreen">
            {p.fullscreen ? <Shrink size={18} /> : <Expand size={18} />}
          </button>
        </div>
      </div>
    </div>
  );

  // Slim: just the screen in a soft bezel — for the inspector panel and canvas nodes.
  if (variant === 'slim') {
    return (
      <div className={`overflow-hidden rounded-lg bg-black ${className}`}>{screen}</div>
    );
  }

  // Frame: the full Lumina set.
  return (
    <div className={`mx-auto w-full max-w-[680px] ${className}`}>
      <div
        className="rounded-[26px] p-4 pb-6"
        style={{
          background: 'linear-gradient(160deg,#3a3530,#2a2520 40%,#1e1a16)',
          boxShadow: '0 0 0 2px #4a4035, 0 8px 40px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.06)',
        }}
      >
        {/* Top bar */}
        <div className="mb-3 flex items-center justify-between px-1">
          <span className="font-mono text-[11px] font-black uppercase tracking-[0.3em] text-gold">{brand}</span>
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-white/15" />
            <span className={`h-1.5 w-1.5 rounded-full ${p.playing ? 'bg-red shadow-[0_0_6px_var(--red)]' : 'bg-white/15'}`} />
            <span className="h-1.5 w-1.5 rounded-full bg-white/15" />
          </div>
        </div>

        {/* Screen in its black bezel */}
        <div className="rounded-xl bg-[#0a0a0a] p-2.5" style={{ boxShadow: 'inset 0 2px 8px rgba(0,0,0,.9)' }}>
          {screen}
        </div>

        {/* Channel strip + power dot */}
        <div className="mt-4 flex items-center justify-between gap-3 px-1">
          <div className="flex flex-wrap gap-1.5">
            {playlist
              ? clips.map((c, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => p.goTo(i)}
                    className={`rounded-md border px-2.5 py-1 text-[10px] tracking-wide transition ${
                      p.index === i
                        ? 'border-gold bg-gold-soft text-gold'
                        : 'border-white/10 bg-black/30 text-white/45 hover:border-white/25 hover:text-white/70'
                    }`}
                  >
                    {c.label || c.title || `CH ${String(i + 1).padStart(2, '0')}`}
                  </button>
                ))
              : <span className="font-mono text-[10px] tracking-[0.15em] text-white/35">{p.clip?.subtitle || ''}</span>}
          </div>
          <span
            className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 border-white/10"
            style={{ background: 'linear-gradient(135deg,#3a3530,#2a2520)' }}
            aria-hidden="true"
          >
            <span className="absolute top-1 h-2 w-0.5 rounded bg-gold" />
          </span>
        </div>
      </div>

      {/* Stand */}
      <div className="flex flex-col items-center">
        <div className="h-4 w-14 rounded-b bg-[#241f19]" />
        <div className="h-2.5 w-32 rounded-b-lg bg-[#1c1813]" />
      </div>
    </div>
  );
}

/* ── inline icons (no icon dependency; the build inlines one offline file) ── */
function Play({ size = 18, className = '' }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}><path d="M7 4v16l13-8z" /></svg>;
}
function Pause({ size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>;
}
function Prev({ size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M18 6v12L9 12z" /><rect x="5" y="6" width="2.4" height="12" rx="1" /></svg>;
}
function Next({ size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M6 6v12l9-6z" /><rect x="16.6" y="6" width="2.4" height="12" rx="1" /></svg>;
}
function Volume({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9v6h3l5 4V5L7 9H4z" fill="currentColor" stroke="none" />
      <path d="M16 8.5a4 4 0 0 1 0 7M18.5 6a7 7 0 0 1 0 12" />
    </svg>
  );
}
function Muted({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9v6h3l5 4V5L7 9H4z" fill="currentColor" stroke="none" />
      <path d="M16 9l5 6M21 9l-5 6" />
    </svg>
  );
}
function Expand({ size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" /></svg>;
}
function Shrink({ size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8h5V3M21 8h-5V3M3 16h5v5M21 16h-5v5" /></svg>;
}
