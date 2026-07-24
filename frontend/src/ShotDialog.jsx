import { useEffect, useRef, useState } from 'react';
import { COVERAGE_OPTIONS } from './ui.js';

// Calling for another setup on a frame that already exists.
//
// Everything here is optional on purpose: the scene is already staged, so a blank form is
// a complete request — "shoot it again the way it's written". What you pick only overrides
// the part you care about, which is how a director actually asks for a shot.
export default function ShotDialog({ node, at, onClose, onSubmit, onSuggest, busy }) {
  const [spec, setSpec] = useState({ shot: '', angle: '', move: '', note: '' });
  const [thinking, setThinking] = useState(false);
  const [why, setWhy] = useState(null);   // { note, source, covered }
  const ref = useRef(null);

  // Dismiss on outside click / Escape, like every other transient surface on the canvas.
  useEffect(() => {
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const key = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);

  // Touching a control after a suggestion means the director is overriding it, so the
  // rationale stops being a description of what is in the form and has to go.
  const pick = (field, value) => {
    setWhy(null);
    setSpec((s) => ({ ...s, [field]: s[field] === value ? '' : value }));
  };

  const suggest = async () => {
    if (thinking || busy) return;
    setThinking(true);
    try {
      const s = await onSuggest(node);
      // Filled in, not applied: every field stays editable and nothing is shot yet.
      setSpec({ shot: s.shot || '', angle: s.angle || '', move: s.move || '',
                note: s.note || '' });
      setWhy(s);
    } catch {
      setWhy({ note: 'Could not read the scene — pick a setup yourself.', source: 'error' });
    } finally {
      setThinking(false);
    }
  };

  const submit = () => { if (!busy) onSubmit(node, spec); };

  // Keep the panel on screen when the frame it belongs to sits near an edge.
  const style = {
    left: Math.min(at?.x ?? 200, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 360),
    top: Math.min(at?.y ?? 200, (typeof window !== 'undefined' ? window.innerHeight : 800) - 380),
  };

  return (
    <div className="shot-dialog" style={style} ref={ref}>
      <div className="shot-dialog-head">
        <span className="mono-label">New setup</span>
        <strong>{node.title}</strong>
        <button className="insp-close" onClick={onClose} title="Close">✕</button>
      </div>

      <div className="shot-dialog-body">
        {/* The scene, its intent and everything already in the can are on the graph, so
            the obvious question — "what's missing?" — is one the studio can answer itself. */}
        <button className="suggest-btn" onClick={suggest} disabled={thinking || busy}>
          {thinking ? 'Reading the scene…' : '✦ Suggest the next setup'}
        </button>

        {why && (
          <div className={`suggest-why ${why.source === 'error' ? 'bad' : ''}`}>
            {why.note}
            {why.source && why.source !== 'error' && (
              <span className="mono-label">
                {why.covered ? `${why.covered} already shot · ` : 'first setup · '}
                {why.source === 'llm' ? 'read by the director' : 'standard coverage'}
              </span>
            )}
          </div>
        )}

        {[['shot', 'Shot'], ['angle', 'Angle'], ['move', 'Camera']].map(([field, label]) => (
          <div className="shot-row" key={field}>
            <span className="mono-label">{label}</span>
            <div className="chip-row">
              {COVERAGE_OPTIONS[field].map((opt) => (
                <button
                  key={opt}
                  className={`opt-chip ${spec[field] === opt ? 'on' : ''}`}
                  onClick={() => pick(field, opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        ))}

        <div className="shot-row">
          <span className="mono-label">Direction</span>
          <textarea
            className="shot-note"
            rows={2}
            value={spec.note}
            placeholder="What is this setup for? e.g. land the joke on his face"
            onChange={(e) => { setWhy(null); setSpec((s) => ({ ...s, note: e.target.value })); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
            }}
          />
        </div>
      </div>

      <div className="shot-dialog-foot">
        {/* The honest cost, stated up front: the master frame is already paid for, so this
            buys one clip and changes nothing else in the film. */}
        <span className="mono-label">
          One clip · the master frame is reused · nothing goes stale
        </span>
        <button className="btn-gold" onClick={submit} disabled={busy}>
          {busy ? 'Shooting…' : 'Shoot it'}
        </button>
      </div>
    </div>
  );
}
