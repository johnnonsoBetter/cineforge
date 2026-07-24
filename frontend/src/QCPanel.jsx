import { useState } from 'react';
import { relTime } from './diff.js';
import {
  CRITICAL, CRITERION, SOURCE, verdictColor, verdictLabel, failedChecks, isSighted,
  needsReview,
} from './qc.js';

// One asset's review, in full.
//
// The point of a gate is that a human can disagree with it, so this shows its work: every
// criterion it checked, how confident it was, what it was looking at, and whether it could
// see at all. A verdict you can't audit is a verdict nobody will trust on a paid run.

function Check({ check }) {
  const critical = CRITICAL.has(check.criterion);
  const pct = Math.round(Math.max(0, Math.min(1, check.score ?? 0)) * 100);
  return (
    <li className={`qc-check ${check.ok ? 'ok' : 'bad'}`}>
      <span className="qc-mark" aria-hidden="true">{check.ok ? '✓' : '✕'}</span>
      <div className="qc-check-body">
        <div className="qc-check-head">
          <span className="qc-crit">{check.criterion}</span>
          {critical && <span className="qc-critical" title="A failure here is fatal on its own">critical</span>}
          <span className="qc-score">{pct}%</span>
        </div>
        <div className="qc-bar"><i style={{ width: `${pct}%` }} /></div>
        <div className={`qc-note ${check.note ? '' : 'dim'}`}>
          {check.note || CRITERION[check.criterion] || ''}
        </div>
      </div>
    </li>
  );
}

// What the judge had in front of it. Sampled frames on one side, the references it was
// comparing them against on the other — the references click through to their source node.
function Evidence({ report, onSelectNode }) {
  const frames = report.frames || [];
  const refs = report.references || [];
  if (!frames.length && !refs.length) return null;

  return (
    <div className="qc-evidence">
      {frames.length > 0 && (
        <>
          <div className="mono-label">Frames reviewed · {frames.length}</div>
          <div className="qc-strip">
            {frames.map((f, i) => <img key={i} src={f} alt={`frame ${i + 1}`} loading="lazy" />)}
          </div>
        </>
      )}
      {refs.length > 0 && (
        <>
          <div className="mono-label" style={{ marginTop: 10 }}>Compared against · {refs.length}</div>
          <div className="qc-refs">
            {refs.map((r, i) => (
              <button key={i} className="qc-ref" disabled={!r.node_id}
                      onClick={() => r.node_id && onSelectNode(r.node_id)}
                      title={r.node_id ? `Go to ${r.label}` : r.label}>
                <img src={r.url} alt={r.label} loading="lazy" />
                <span>{r.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function QCPanel({ node, report, onSelectNode, onRegenerate, onAccept,
                                  onReview, busy }) {
  const [open, setOpen] = useState(true);

  // An asset with no report has simply not been through the gate yet. Offering the review
  // beats rendering nothing — otherwise the gate looks broken on exactly the assets that
  // most need it.
  if (!report) {
    if (!node?.asset?.url) return null;
    return (
      <div className="insp-section qc-panel">
        <div className="qc-head" style={{ cursor: 'default' }}>
          <span className="qc-verdict" style={{ color: 'var(--faint)', borderColor: 'var(--faint)' }}>
            Unreviewed
          </span>
          <span className="qc-headline">This asset has not been through the gate.</span>
        </div>
        <div className="qc-actions">
          <button className="btn" disabled={busy} onClick={() => onReview(node)}>
            ⟳ Review now
          </button>
        </div>
      </div>
    );
  }

  const bad = failedChecks(report);
  const color = verdictColor(report.verdict);
  const override = node?.data?.qc_override;
  const outstanding = needsReview(report.verdict) && !override;

  return (
    <div className="insp-section qc-panel">
      <button className="qc-head" onClick={() => setOpen((o) => !o)}>
        <span className="qc-verdict" style={{ color, borderColor: color }}>
          {verdictLabel(report.verdict)}
        </span>
        <span className="qc-headline">
          {bad.length
            ? `${bad.length} of ${report.checks.length} checks failed`
            : report.checks?.length
              ? `all ${report.checks.length} checks passed`
              : 'not reviewed'}
        </span>
        <span className={`drawer-caret ${open ? 'open' : ''}`}>▶</span>
      </button>

      {open && (
        <>
          {report.summary && <div className="qc-summary">{report.summary}</div>}

          {/* A mock or skipped review is not a pass — saying so is the difference between
              a gate and a rubber stamp. */}
          {!isSighted(report) && (
            <div className="qc-warn">{SOURCE[report.source] || 'Not a sighted review.'}</div>
          )}

          {override && (
            <div className="qc-override">
              Accepted by a human over a {verdictLabel(override.verdict)} verdict
              {override.at ? ` · ${relTime(override.at)}` : ''}
            </div>
          )}

          {report.checks?.length > 0 && (
            <ul className="qc-checks">
              {report.checks.map((c, i) => <Check key={i} check={c} />)}
            </ul>
          )}

          <Evidence report={report} onSelectNode={onSelectNode} />

          <div className="qc-meta">
            {isSighted(report) ? 'sighted' : report.source}
            {report.model ? ` · ${report.model}` : ''}
            {/* The re-render count is a property of the asset, not of the latest review —
                asking for a second opinion must not erase what the first one cost. */}
            {node?.attempt > 0 ? ` · after ${node.attempt} re-render${node.attempt > 1 ? 's' : ''}` : ''}
            {report.judged_at ? ` · ${relTime(report.judged_at)}` : ''}
          </div>

          {/* Three different decisions, and the difference between them is what they cost.
              Re-review re-reads pixels that exist (a text call). Re-render pays for the
              asset again. Accepting pays nothing and keeps what you already have. */}
          <div className="qc-actions">
            <button className="btn" disabled={busy} onClick={() => onReview(node)}
                    title="Look again — renders nothing">
              ⟳ Re-review
            </button>
            {outstanding && (
              <>
                <button className="btn-gold" disabled={busy} onClick={() => onRegenerate(node)}
                        title="Render this asset again">
                  ↻ Re-render
                </button>
                <button className="btn" disabled={busy} onClick={() => onAccept(node)}
                        title="Keep this take despite the verdict">
                  Keep
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
