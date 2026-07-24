import { useEffect, useRef, useState } from 'react';
import { isVideo } from './ui.js';

// The assembled film: shot thumbnails in scene order, plus a "Play film" cinema mode
// that runs the shots back to back with their voiceover line.
export default function Timeline({ shots, selectedId, onSelect, inspectorOpen }) {
  const [playing, setPlaying] = useState(false);
  if (!shots.length) return null;

  return (
    <>
      <div className={`timeline ${inspectorOpen ? 'with-inspector' : ''}`}>
        <div className="tl-head">
          <span className="tl-title">Final Film</span>
          <span className="mono-label">{shots.length} shot{shots.length > 1 ? 's' : ''} · {shots.length * 8}s</span>
          <span className="tl-spacer" />
          <button className="btn-gold" style={{ height: 29, padding: '0 15px', fontSize: 12.5 }} onClick={() => setPlaying(true)}>
            ▶ Play film
          </button>
        </div>
        <div className="tl-strip">
          {shots.map((s, i) => {
            const thumb = s.asset?.thumbnail;
            return (
              <button
                key={s.node_id}
                className={`tl-shot ${s.node_id === selectedId ? 'selected' : ''} ${s.status === 'stale' ? 'stale' : ''}`}
                onClick={() => onSelect(s.node_id)}
                title={s.data?.vo || s.title}
              >
                {thumb ? <img src={thumb} alt={s.title} draggable={false} /> : <div style={{ aspectRatio: '16/9' }} />}
                <div className="tl-shot-foot">
                  <span className="tl-shot-n">{String(i + 1).padStart(2, '0')}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.status === 'stale' ? 'needs re-render' : s.title}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
      {playing && <Cinema shots={shots} onClose={() => setPlaying(false)} />}
    </>
  );
}

function Cinema({ shots, onClose }) {
  const [i, setI] = useState(0);
  const videoRef = useRef(null);
  const shot = shots[i];
  const url = shot?.asset?.url;

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.play().catch(() => {});
  }, [i]);

  const next = () => {
    if (i < shots.length - 1) setI(i + 1);
    else onClose();
  };

  return (
    <div className="cinema" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(1120px, 100%)' }}>
        {isVideo(url) ? (
          <video ref={videoRef} src={url} poster={shot.asset?.thumbnail} controls autoPlay onEnded={next} />
        ) : (
          <img src={shot?.asset?.thumbnail} alt={shot?.title} style={{ width: '100%', borderRadius: 12 }} />
        )}
        <div className="cinema-bar">
          <div className="cinema-vo">{shot?.data?.vo ? `“${shot.data.vo}”` : ''}</div>
          <span className="cinema-count">{i + 1} / {shots.length}</span>
          <button className="btn" onClick={next}>{i < shots.length - 1 ? 'Next shot →' : 'Finish'}</button>
          <button className="btn" onClick={onClose}>Close ✕</button>
        </div>
      </div>
    </div>
  );
}
