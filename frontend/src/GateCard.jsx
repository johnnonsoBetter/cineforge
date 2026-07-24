import { useState } from 'react';
import { STAGE_LABEL } from './stages.js';

// The gate between two stages.
//
// This is the one place in the app where the run is *stopped*, so it has to answer three
// things without being clicked into: what the last pass produced, what the reviewer thought
// of it, and what happens next if you say yes. A card that only said "continue?" would be
// asking the director to approve something they can't see.
//
// Blockers are listed by name and click through to the node, because "1 asset needs a look"
// is not an actionable sentence — "The Usher: fail on brief" is.

export default function GateCard({ stage, busy, onApprove, onHold, onSelectNode }) {
  const [note, setNote] = useState('');
  if (!stage?.gate) return null;

  const { gate } = stage;
  const held = gate.verdict === 'hold';
  const label = STAGE_LABEL[stage.key] || stage.key;
  const blockers = gate.blockers || [];

  return (
    <div className={`gatecard ${held ? 'held' : 'clear'}`}>
      <div className="gatecard-head">
        <span className="dot" style={{ background: held ? 'var(--amber)' : 'var(--green)' }} />
        <span className="gatecard-stage">{label}</span>
        <span className="gatecard-verdict">{held ? 'held' : 'cleared'}</span>
      </div>

      <div className="gatecard-sum">{gate.summary}</div>

      {blockers.length > 0 && (
        <ul className="gatecard-blockers">
          {blockers.map((b) => (
            <li key={b.node_id}>
              <button onClick={() => onSelectNode(b.node_id)} title="Show it on the canvas">
                <span className="gatecard-b-title">{b.title}</span>
                <span className="gatecard-b-reason">{b.reason}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* A reason is optional when everything cleared and worth having when it didn't —
          the note is kept beside the reviewer's verdict, never in place of it. */}
      <input
        className="gatecard-note"
        value={note}
        placeholder={held ? 'Why are you keeping these? (optional)' : 'Note for the record (optional)'}
        disabled={busy}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !busy) onApprove(stage.key, note.trim()); }}
      />

      <div className="gatecard-actions">
        <button
          className="btn-gold"
          disabled={busy}
          onClick={() => onApprove(stage.key, note.trim())}
          title={held
            ? 'Keep these anyway and start the next stage'
            : 'Start the next stage'}
        >
          {busy ? 'Working…' : held ? 'Keep them & continue →' : 'Approve & continue →'}
        </button>
        <button className="btn" disabled={busy} onClick={() => onHold(stage.key, note.trim())}
                title="Leave this stage open — nothing downstream gets built">
          Hold
        </button>
      </div>

      <div className="gatecard-foot">
        {held
          ? 'Nothing after this stage has been generated yet. Fix a take with a note, or keep it and move on.'
          : 'Approving spends the next stage. Everything before it stays as it is.'}
      </div>
    </div>
  );
}
