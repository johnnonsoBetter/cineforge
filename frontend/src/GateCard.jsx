import { useState } from 'react';
import { STAGE_LABEL } from './stages.js';

// The gate between two stages — a small pill anchored to the canvas corner, not a chat
// message and not a wall.
//
// Collapsed it is just a "checkpoint reached" cue that stays out of the way of the cards it
// is a verdict on. Clicking Review opens a compact popover with the three things a director
// needs before spending the next stage: what the last pass produced, what the reviewer
// thought, and what happens next. Blockers are named and click through to the node — "1 asset
// needs a look" is not actionable; "The Usher: fail on brief" is.

export default function GateCard({ stage, busy, onApprove, onHold, onSelectNode }) {
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  if (!stage?.gate) return null;

  const { gate } = stage;
  const held = gate.verdict === 'hold';
  const label = STAGE_LABEL[stage.key] || stage.key;
  const blockers = gate.blockers || [];
  const color = held ? 'var(--amber)' : 'var(--green)';

  return (
    <div className={`gate ${held ? 'held' : 'clear'} ${open ? 'open' : ''}`}>
      <button className="gate-fab" onClick={() => setOpen((o) => !o)}
              title={open ? 'Close' : 'Review this checkpoint'}>
        <span className="dot" style={{ background: color }} />
        <span className="gate-fab-label">{label}</span>
        {held && blockers.length > 0 && <span className="gate-fab-count">{blockers.length}</span>}
        <span className="gate-fab-cue">{open ? '✕' : 'Review'}</span>
      </button>

      {open && (
        <div className="gate-panel">
          <div className="gate-accent" />
          <div className="gate-panel-head">
            <span className="gate-verdict">{held ? 'held' : 'cleared'}</span>
          </div>

          <div className="gate-sum">{gate.summary}</div>

          {blockers.length > 0 && (
            <div className="gate-blockers">
              {blockers.map((b) => (
                <button key={b.node_id} className="blocker"
                        onClick={() => onSelectNode(b.node_id)} title="Show it on the canvas">
                  <b>{b.title}</b>
                  <span>{b.reason}</span>
                  <em>›</em>
                </button>
              ))}
            </div>
          )}

          {/* A reason is optional when everything cleared and worth having when it didn't. */}
          <input
            className="gate-note"
            value={note}
            placeholder={held ? 'Why keep these? (optional)' : 'Note for the record (optional)'}
            disabled={busy}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !busy) onApprove(stage.key, note.trim()); }}
          />

          <div className="gate-actions">
            <button
              className="btn-gold"
              disabled={busy}
              onClick={() => onApprove(stage.key, note.trim())}
              title={held ? 'Keep these anyway and start the next stage' : 'Start the next stage'}
            >
              {busy ? 'Working…' : held ? 'Keep & continue →' : 'Approve & continue →'}
            </button>
            <button className="btn" disabled={busy} onClick={() => onHold(stage.key, note.trim())}
                    title="Leave this stage open — nothing downstream gets built">
              Hold
            </button>
          </div>

          <div className="gate-foot">
            {held
              ? 'Nothing downstream is built yet. Fix a version with a note, or keep it and move on.'
              : 'Approving spends the next stage. Everything before it stays as it is.'}
          </div>
        </div>
      )}
    </div>
  );
}
