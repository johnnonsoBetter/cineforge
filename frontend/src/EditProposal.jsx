import { useEffect, useRef, useState } from 'react';
import { KIND_LABEL } from './ui.js';

// The proposed edit, shown above the composer before anything is written.
//
// This is the working surface the whole edit flow turns on: a note doesn't fire, it
// proposes, and the director reads the proposal here — what it targets, what it changes, and
// what it re-renders — then approves it, tweaks it, or drops it. Nothing downstream has
// changed and nothing has been paid for until Apply.
//
// The proposed value is editable on purpose. "make the agbada white" is a starting point;
// the director owns the final wording, so a field edit lands in a textarea they can correct
// before it becomes the bible text every later frame is matched against.

const CHANGE_LABEL = { rename: 'Rename', field: 'Rewrite', note: 'Note', undo: 'Undo' };

export default function EditProposal({ proposal, busy, onApply, onDiscard, onFocusNode }) {
  const [value, setValue] = useState(proposal.to ?? proposal.note ?? '');
  const ref = useRef(null);

  // A fresh proposal replaces whatever was being edited — the target and the text both move.
  useEffect(() => {
    setValue(proposal.to ?? proposal.note ?? '');
  }, [proposal]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const { target, change, label, impact } = proposal;
  const editsField = change === 'field';
  const isRename = change === 'rename';
  const isUndo = change === 'undo';
  const stale = impact?.stale || [];
  const valid = isRename || isUndo || value.trim().length > 0;

  // What Apply will actually send: the edited value flows back as the new field text (field
  // edits) or as the note (everything else), so a correction in the box is never lost.
  const apply = () => {
    const v = value.trim();
    if (busy || !valid) return;
    if (isRename || isUndo) onApply(proposal);
    else onApply(editsField ? { ...proposal, to: v } : { ...proposal, note: v || proposal.note });
  };

  return (
    <section className="proposal" aria-label="Edit proposal" aria-live="polite">
      <div className="proposal-head">
        <span className="proposal-kind">{CHANGE_LABEL[change] || 'Edit'}</span>
        <button className="proposal-target" onClick={() => onFocusNode(target.node_id)}
                title="Show it on the canvas">
          {target.title}
          <em>{KIND_LABEL[target.kind] || target.kind}</em>
        </button>
        <button className="proposal-x" onClick={onDiscard} disabled={busy} title="Discard" aria-label="Discard proposal">✕</button>
      </div>

      {/* A rename is a clean before/after with no render — show it as one, not as a box. */}
      {isUndo ? (
        <div className="proposal-undo-copy">{proposal.summary}</div>
      ) : isRename ? (
        <div className="proposal-rename">
          <span className="proposal-from">{proposal.from}</span>
          <span className="proposal-arrow">→</span>
          <span className="proposal-to">{proposal.to}</span>
        </div>
      ) : (
        <>
          {editsField && proposal.from && (
            <div className="proposal-was" title={`current ${label}`}>{proposal.from}</div>
          )}
          <textarea
            ref={ref}
            className="proposal-edit"
            value={value}
            rows={1}
            disabled={busy}
            placeholder={editsField ? `New ${label}…` : 'The note steering this change…'}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); apply(); }
            }}
            aria-label={editsField ? `Proposed ${label}` : 'Edit instruction'}
          />
        </>
      )}

      <div className="proposal-cost">{impact?.cost_hint}</div>

      {stale.length > 0 && (
        <ul className="proposal-stale">
          {stale.map((s) => (
            <li key={s.node_id}>
              <button onClick={() => onFocusNode(s.node_id)} title="Show it on the canvas">
                {s.title}<em>re-renders</em>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="proposal-actions">
        <button className="btn-gold" disabled={busy || !valid} onClick={apply}>
          {busy ? 'Working…' : isUndo ? (stale.length ? `Undo & re-render ${stale.length} →` : 'Undo change →')
            : isRename ? 'Rename everywhere →'
            : stale.length ? `Apply & re-render ${stale.length} →` : 'Apply →'}
        </button>
        <button className="btn" disabled={busy} onClick={onDiscard}>Discard</button>
      </div>
    </section>
  );
}
