import { useCallback, useEffect, useRef, useState } from 'react';

// mm:ss for a seconds value; guards NaN/Infinity from an un-loaded <video>.
export function fmt(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Drives a real <video> for TvPlayer: playback, seek, volume, a clip playlist (the
// "channels"), a brief static-noise transition between clips, and fullscreen. `clips` is an
// array of { src, poster, title, subtitle, badge, label }; a single video is a one-clip list.
export function useTvPlayer(videoRef, containerRef, clips, { autoPlay = false, startIndex = 0, onEnded } = {}) {
  const [index, setIndex] = useState(startIndex);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [switching, setSwitching] = useState(false);
  const [started, setStarted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  // Whether the clip that loads next should auto-play — set when the viewer was already
  // watching and we swap the source, so a channel change doesn't silently pause the film.
  const resume = useRef(autoPlay);
  const switchTimer = useRef(null);

  const clip = clips[index] || clips[0];

  // Switch clips behind a short burst of static, like retuning a channel.
  const go = useCallback((i, { play = true } = {}) => {
    const n = clips.length;
    if (n <= 1) return;
    const next = ((i % n) + n) % n;
    if (next === index) return;
    resume.current = play;
    setSwitching(true);
    if (switchTimer.current) clearTimeout(switchTimer.current);
    switchTimer.current = setTimeout(() => {
      setIndex(next);
      setTime(0);
      setSwitching(false);
    }, 320);
  }, [clips.length, index]);

  // Mirror the <video>'s own events into state so custom controls stay in sync with the
  // element (including changes we didn't initiate, e.g. keyboard media keys).
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setTime(v.currentTime);
    const onMeta = () => setDuration(v.duration || 0);
    const onPlay = () => { setPlaying(true); setStarted(true); };
    const onPause = () => setPlaying(false);
    const onVol = () => { setVolume(v.volume); setMuted(v.muted); };
    const onProg = () => {
      try { if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1)); } catch { /* not ready */ }
    };
    const onEnd = () => {
      if (index < clips.length - 1) go(index + 1);
      else { setPlaying(false); onEnded?.(); }
    };
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('durationchange', onMeta);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('volumechange', onVol);
    v.addEventListener('progress', onProg);
    v.addEventListener('ended', onEnd);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('durationchange', onMeta);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('volumechange', onVol);
      v.removeEventListener('progress', onProg);
      v.removeEventListener('ended', onEnd);
    };
  }, [videoRef, index, clips.length, go, onEnded]);

  // When the source changes (channel switch, or first mount with autoPlay), reload and pick
  // up playback if the viewer was mid-film.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    setBuffered(0);
    if (resume.current) v.play().catch(() => {});
  }, [videoRef, index]);

  // Track OS/browser fullscreen so the expand/shrink icon reflects reality.
  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, [containerRef]);

  useEffect(() => () => { if (switchTimer.current) clearTimeout(switchTimer.current); }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, [videoRef]);

  const seekTo = useCallback((seconds) => {
    const v = videoRef.current;
    if (!v || !isFinite(v.duration)) return;
    v.currentTime = Math.max(0, Math.min(v.duration, seconds));
  }, [videoRef]);

  const seekFraction = useCallback((f) => {
    const v = videoRef.current;
    if (v && isFinite(v.duration)) seekTo(f * v.duration);
  }, [videoRef, seekTo]);

  const changeVolume = useCallback((value) => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = value;
    v.muted = value === 0;
  }, [videoRef]);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.muted || v.volume === 0) { v.muted = false; if (v.volume === 0) v.volume = 0.8; }
    else v.muted = true;
  }, [videoRef]);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.();
  }, [containerRef]);

  return {
    clip, index, count: clips.length,
    playing, muted, volume, time, duration, buffered,
    switching, started, fullscreen,
    progress: duration ? (time / duration) * 100 : 0,
    bufferedPercent: duration ? (buffered / duration) * 100 : 0,
    timeLabel: `${fmt(time)} / ${fmt(duration)}`,
    togglePlay, seekTo, seekFraction, changeVolume, toggleMute, toggleFullscreen,
    next: () => go(index + 1),
    prev: () => go(index - 1),
    goTo: (i) => go(i),
  };
}
