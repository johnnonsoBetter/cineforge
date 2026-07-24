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

export default function Monitor({ progress, stages, current }) {
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
    </div>
  );
}
