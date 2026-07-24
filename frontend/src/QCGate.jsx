import { verdictColor, verdictLabel } from './qc.js';

// The gate, at the level of the whole run.
//
// Per-node reports answer "is this frame good?". This answers the question a producer asks
// before shipping: how much of the film was reviewed, how much cleared, what the gate cost
// in re-renders, which criterion keeps failing, and exactly what is still on someone's desk.
//
// Every number here is clickable through to the thing it counts. A summary that hides its
// exceptions is a summary nobody should ship on.

function Stat({ label, value, tone }) {
  return (
    <div className="gate-stat">
      <div className="gate-value" style={tone ? { color: tone } : undefined}>{value}</div>
      <div className="gate-label">{label}</div>
    </div>
  );
}

export default function QCGate({ ledger, onSelectNode, onClose, busy, onRecheck }) {
  if (!ledger) return null;

  const {
    reviewed = 0, passed = 0, verdicts = {}, pass_rate, regens_spent = 0,
    failing_criteria = {}, needs_a_human = [], overruled = 0, unreviewed = [],
    sighted = false,
  } = ledger;

  const rate = pass_rate == null ? '—' : `${Math.round(pass_rate * 100)}%`;
  const queue = needs_a_human;
  const failing = Object.entries(failing_criteria);
  const worst = failing.length ? failing[0] : null;

  return (
    <aside className="gate">
      <div className="gate-head">
        <div>
          <span className="mono-label">Quality gate</span>
          <h2>{queue.length ? `${queue.length} need a look` : 'Nothing outstanding'}</h2>
        </div>
        <button className="insp-close" onClick={onClose} title="Close">✕</button>
      </div>

      <div className="gate-scroll">
        <div className="gate-stats">
          <Stat label="Reviewed" value={reviewed} />
          <Stat label="Passed" value={passed} tone="var(--green)" />
          <Stat label="Pass rate" value={rate}
                tone={pass_rate != null && pass_rate < 0.8 ? 'var(--amber)' : 'var(--green)'} />
          <Stat label="Re-renders" value={regens_spent}
                tone={regens_spent ? 'var(--amber)' : undefined} />
          <Stat label="Overruled" value={overruled} tone={overruled ? 'var(--amber)' : undefined} />
          <Stat label="Unreviewed" value={unreviewed.length}
                tone={unreviewed.length ? 'var(--amber)' : undefined} />
        </div>

        {/* A pass rate bought with re-renders is a different claim from one that came out
            clean, and a mocked run is not a claim about quality at all. */}
        {!sighted && (
          <div className="qc-warn" style={{ marginTop: 12 }}>
            Nothing in this run was actually seen. Placeholder pixels carry nothing to judge,
            so these verdicts are a rehearsal of the gate — not evidence of quality.
          </div>
        )}

        {Object.keys(verdicts).length > 1 && (
          <div className="gate-verdicts">
            {Object.entries(verdicts).map(([v, n]) => (
              <span key={v} className="gate-tally" style={{ color: verdictColor(v) }}>
                {n} <em>{verdictLabel(v).toLowerCase()}</em>
              </span>
            ))}
          </div>
        )}

        {worst && (
          <>
            <h3 className="gate-h3">What keeps failing</h3>
            <ul className="gate-criteria">
              {failing.map(([crit, n]) => (
                <li key={crit}>
                  <span className="gate-crit">{crit}</span>
                  <span className="gate-crit-bar">
                    <i style={{ width: `${Math.round((n / worst[1]) * 100)}%` }} />
                  </span>
                  <span className="gate-crit-n">{n}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        {queue.length === 0 ? (
          <div className="gate-clean">
            Every reviewed asset cleared the gate
            {overruled > 0 && `, and ${overruled} was kept over its verdict by a human`}.
            Nothing is waiting.
          </div>
        ) : (
          <>
            <h3 className="gate-h3">Needs a human</h3>
            <ul className="gate-queue">
              {queue.map((o) => (
                <li key={o.node_id}>
                  <button className="gate-item" onClick={() => onSelectNode(o.node_id)}>
                    <span className="gate-item-head">
                      <span className="gate-verdict" style={{ color: verdictColor(o.verdict) }}>
                        {verdictLabel(o.verdict)}
                      </span>
                      <span className="gate-item-title">{o.title}</span>
                      <span className="gate-item-kind">{o.kind}</span>
                    </span>
                    {o.summary && <span className="gate-item-sum">{o.summary}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {unreviewed.length > 0 && (
          <div className="gate-unreviewed">
            {unreviewed.length} asset{unreviewed.length === 1 ? '' : 's'} never went through
            the gate. Open one and review it to bring it in.
          </div>
        )}
      </div>

      <div className="gate-foot">
        <button className="btn" disabled={busy} onClick={onRecheck}>↻ Refresh ledger</button>
      </div>
    </aside>
  );
}
