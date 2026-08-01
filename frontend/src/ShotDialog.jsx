import { useEffect, useRef, useState } from 'react';
import { COVERAGE_OPTIONS } from './ui.js';

// Calling for more coverage on a frame that already exists — either another setup off the
// same still (mode 'shot') or a genuinely new still at a new angle (mode 'keyframe').
//
// Everything here is optional on purpose: the scene is already staged, so a blank form is
// a complete request — "shoot it the way it's written". What you pick only overrides the
// part you care about, which is how a director actually asks for a shot. A reused frame can
// only change motion/direction; a new keyframe can also change framing and angle.
const COPY = {
  shot: {
    label: 'New shot',
    badge: 'Reuse frame',
    intro: 'Animate another take from this exact frame. Framing and angle stay locked.',
    cost: 'One clip · the master frame is reused · nothing goes stale',
    submit: 'Shoot it', busy: 'Shooting…',
  },
  keyframe: {
    label: 'New keyframe',
    badge: 'New frame',
    intro: 'Compose a new view of this scene, then animate it as a new shot.',
    suggest: '✦ Suggest the next setup',
    cost: 'One still + one clip · a new frame of this scene · nothing goes stale',
    submit: 'Frame it', busy: 'Framing…',
  },
};

export default function ShotDialog({ node, mode = 'shot', onClose, onSubmit, onSuggest, busy }) {
  const copy = COPY[mode] || COPY.shot;
  const [spec, setSpec] = useState({ shot: '', angle: '', move: '', note: '' });
  const [thinking, setThinking] = useState(false);
  const [why, setWhy] = useState(null);   // { note, source, covered }
  const ref = useRef(null);
  const closeRef = useRef(null);

  // This is a decision modal, not another canvas detail. Move focus into it, restore focus on
  // close, and let the backdrop own outside-click dismissal so the inspector cannot compete.
  useEffect(() => {
    const key = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'Tab' || !ref.current) return;
      const focusable = [...ref.current.querySelectorAll('button:not(:disabled), textarea:not(:disabled)')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    const previous = document.activeElement;
    closeRef.current?.focus();
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      previous?.focus?.();
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
      setSpec(mode === 'shot'
        ? { shot: '', angle: '', move: s.move || '', note: s.note || '' }
        : { shot: s.shot || '', angle: s.angle || '', move: s.move || '', note: s.note || '' });
      setWhy(s);
    } catch {
      setWhy({ note: 'Could not read the scene — pick a setup yourself.', source: 'error' });
    } finally {
      setThinking(false);
    }
  };

  const submit = () => { if (!busy) onSubmit(node, spec); };

  const fields = mode === 'shot'
    ? [['move', 'Camera movement']]
    : [['shot', 'Shot size'], ['angle', 'Angle'], ['move', 'Camera movement']];

  return (
    <div className="shot-dialog-layer" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="shot-dialog" ref={ref} role="dialog" aria-modal="true"
           aria-labelledby="shot-dialog-title" aria-describedby="shot-dialog-intro">
        <div className="shot-dialog-head">
          <div>
            <span className="mono-label">{copy.label}</span>
            <strong id="shot-dialog-title">{node.title}</strong>
          </div>
          <span className="shot-mode-badge">{copy.badge}</span>
          <button ref={closeRef} className="insp-close" onClick={onClose} title="Close"
                  aria-label={`Close ${copy.label.toLowerCase()} dialog`}>✕</button>
        </div>

        <div className="shot-dialog-body">
          <p className="shot-dialog-intro" id="shot-dialog-intro">{copy.intro}</p>
        {/* The scene, its intent and everything already in the can are on the graph, so
            the obvious question — "what's missing?" — is one the studio can answer itself. */}
        {mode === 'keyframe' && (
          <button className="suggest-btn" onClick={suggest} disabled={thinking || busy}>
            {thinking ? 'Reading the scene…' : copy.suggest}
          </button>
        )}

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

        {fields.map(([field, label]) => (
          <div className="shot-row" key={field}>
            <span className="mono-label">{label}</span>
            <div className="chip-row">
              {COVERAGE_OPTIONS[field].map((opt) => (
                <button
                  key={opt}
                  className={`opt-chip ${spec[field] === opt ? 'on' : ''}`}
                  onClick={() => pick(field, opt)}
                  aria-pressed={spec[field] === opt}
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
            placeholder={mode === 'shot'
              ? 'What should change in this take? e.g. hold still, then slowly push in'
              : 'What is this setup for? e.g. land the joke on his face'}
            onChange={(e) => { setWhy(null); setSpec((s) => ({ ...s, note: e.target.value })); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
            }}
          />
        </div>
        </div>

        <div className="shot-dialog-foot">
        {/* The honest cost, stated up front, and it differs by mode: + Setup reuses the paid
            still and buys one clip; + Keyframe composes a new still and then animates it. */}
        <span className="mono-label">{copy.cost}</span>
        <button className="btn-gold" onClick={submit} disabled={busy}>
          {busy ? copy.busy : copy.submit}
        </button>
        </div>
      </div>
    </div>
  );
}
