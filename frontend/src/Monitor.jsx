import { useState } from 'react';
import { STAGE_KEYS, STAGE_LABEL, stageStatus } from './stages.js';

// The production monitor — the stage board and the work inside it, in one place.
//
// A real run spends minutes inside image and video calls. A spinner would say "wait"; this
// says what is being made and how much of it is left. Each segment is one real unit of work
// — one character, one scene, one shot — so the bar can't overstate progress.
//
// Since generation is gated, each row also carries where that pass stands: queued, working,
// waiting on you, held, approved. A bar that filled to 100% while the run was actually
// stopped at a gate would be the monitor's one lie.

function Bar({ done, total }) {
  // Below ~30 units, discrete segments read as "12 of 16 shots". Above that they'd be
  // hairlines, so fall back to a continuous fill.
  if (total > 30) {
    return (
      <div className="mon-bar continuous">
        <span style={{ width: `${(done / total) * 100}%` }} />
      </div>
    );
  }
  return (
    <div className="mon-bar">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < done ? 'on' : i === done ? 'next' : ''} />
      ))}
    </div>
  );
}

// The gate, folded into the board it is a verdict on. The run has stopped at a stage and the
// next one is the director's call — so that call lives here, under the row it belongs to,
// rather than as a card floating over the canvas. Same decision as the old gate popover
// (approve/keep, or hold), compacted to the monitor's width; blockers still click through to
// the node they name.
function MonitorGate({ stage, busy, onApprove, onHold, onSelectNode }) {
  const [note, setNote] = useState('');
  const { gate } = stage;
  const held = gate.verdict === 'hold';
  const blockers = gate.blockers || [];

  return (
    <div className={`mon-gate ${held ? 'held' : 'clear'}`}>
      <div className="mon-gate-sum">{gate.summary}</div>

      {blockers.length > 0 && (
        <div className="mon-gate-blockers">
          {blockers.map((b) => (
            <button key={b.node_id} className="mon-blocker"
                    onClick={() => onSelectNode(b.node_id)} title="Show it on the canvas">
              <b>{b.title}</b>
              <span>{b.reason}</span>
              <em>›</em>
            </button>
          ))}
        </div>
      )}

      <input
        className="mon-gate-note"
        value={note}
        placeholder={held ? 'Why keep these? (optional)' : 'Note for the record (optional)'}
        disabled={busy}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !busy) onApprove(stage.key, note.trim()); }}
      />

      <div className="mon-gate-actions">
        <button className="btn-gold" disabled={busy}
                onClick={() => onApprove(stage.key, note.trim())}
                title={held ? 'Keep these anyway and start the next stage' : 'Start the next stage'}>
          {busy ? 'Working…' : held ? 'Keep & continue →' : 'Approve & continue →'}
        </button>
        <button className="btn" disabled={busy} onClick={() => onHold(stage.key, note.trim())}
                title="Leave this stage open — nothing downstream gets built">
          Hold
        </button>
      </div>
    </div>
  );
}

export default function Monitor({ progress, stages, current, gate, busy,
                                  onApprove, onHold, onSelectNode }) {
  const byKey = Object.fromEntries((stages || []).map((s) => [s.key, s]));
  const anyStage = (stages || []).some((s) => s.status !== 'pending');
  if (!Object.keys(progress).length && !anyStage) return null;

  const seen = STAGE_KEYS.filter((k) => progress[k]);
  const done = seen.reduce((a, k) => a + progress[k].done, 0);
  const total = seen.reduce((a, k) => a + progress[k].total, 0);
  const approved = (stages || []).filter((s) => s.status === 'approved').length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <div className="monitor">
      <div className="monitor-head">
        <span className="mono-label">Production monitor</span>
        <span className="monitor-pct">
          {stages?.length ? `${approved}/${stages.length} stages` : `${pct}%`}
        </span>
      </div>

      {STAGE_KEYS.map((key) => {
        const p = progress[key];
        const st = byKey[key]?.status;
        // The stage's own standing wins over the bar: a full bar on a pass that is sitting
        // at a gate is exactly the thing this row exists to not say.
        const s = st ? stageStatus(st) : null;
        const state = st === 'approved' ? 'done'
          : st === 'running' ? 'live'
          : st === 'awaiting' || st === 'blocked' ? 'gated'
          : !p ? 'idle' : p.done >= p.total ? 'done' : 'live';
        return (
          <div className={`mon-row ${state}`} key={key}>
            <div className="mon-label" title={s ? s.label : undefined}>
              <span style={s ? { color: s.color } : undefined}>
                {s ? s.mark : state === 'done' ? '✓' : state === 'live' ? '›' : '·'}
              </span>{' '}
              {STAGE_LABEL[key]}
            </div>
            {p ? <Bar done={p.done} total={p.total} /> : <div className="mon-bar empty" />}
            <div className="mon-count">{p ? `${p.done}/${p.total}` : '—'}</div>
          </div>
        );
      })}

      {current && <div className="monitor-now">{current}</div>}

      {/* The run has stopped and the next stage is waiting on the director — decided here,
          on the board, not in a floating card over the canvas. */}
      {gate?.gate && (
        <MonitorGate
          stage={gate}
          busy={busy}
          onApprove={onApprove}
          onHold={onHold}
          onSelectNode={onSelectNode}
        />
      )}
    </div>
  );
}
