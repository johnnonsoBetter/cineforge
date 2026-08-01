import { useEffect, useState } from 'react';
import TvPlayer from './components/TvPlayer.jsx';

// The assembled film: shot thumbnails in scene order, plus a "Play film" cinema mode
// that runs the shots back to back with their voiceover line.
export default function Timeline({ shots, selectedId, onSelect, inspectorOpen }) {
  const [playing, setPlaying] = useState(false);
  // The filmstrip walls off the bottom of the canvas when it's always open — let the director
  // tuck it into a compact pill to reclaim the view, and roll it back out to scrub the cut.
  const [collapsed, setCollapsed] = useState(false);
  if (!shots.length) return null;

  return (
    <>
      <div className={`timeline ${inspectorOpen ? 'with-inspector' : ''} ${collapsed ? 'collapsed' : ''}`}>
        <div className="tl-head">
          <button className="tl-collapse" onClick={() => setCollapsed((c) => !c)}
                  title={collapsed ? 'Show the filmstrip' : 'Hide the filmstrip'}
                  aria-label={collapsed ? 'Show the filmstrip' : 'Hide the filmstrip'}>
            {collapsed ? '▸' : '▾'}
          </button>
          <span className="tl-title">Final Film</span>
          <span className="mono-label">{shots.length} shot{shots.length > 1 ? 's' : ''} · {shots.length * 8}s</span>
          <span className="tl-spacer" />
          <button className="btn-gold" style={{ height: 29, padding: '0 15px', fontSize: 12.5 }} onClick={() => setPlaying(true)}>
            ▶ Play film
          </button>
        </div>
        {!collapsed && (
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
        )}
      </div>
      {playing && <Cinema shots={shots} onClose={() => setPlaying(false)} />}
    </>
  );
}

function Cinema({ shots, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // The film's shots become the TV's channels; the player rolls them back to back and its
  // pills/prev-next let you jump between them. It closes itself when the last shot ends.
  const clips = shots.map((s, i) => ({
    src: s.asset?.url,
    poster: s.asset?.thumbnail,
    title: s.title,
    subtitle: s.data?.vo ? `“${s.data.vo}”` : undefined,
    badge: `${i + 1}/${shots.length}`,
    label: String(i + 1).padStart(2, '0'),
  }));

  return (
    <div className="cinema" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(1120px, 100%)' }}>
        <TvPlayer sources={clips} variant="frame" autoPlay onEnded={onClose} className="max-w-[1120px]" />
        <div className="cinema-bar">
          <span className="tl-title">Final Film</span>
          <span className="tl-spacer" />
          <button className="btn" onClick={onClose}>Close ✕</button>
        </div>
      </div>
    </div>
  );
}
