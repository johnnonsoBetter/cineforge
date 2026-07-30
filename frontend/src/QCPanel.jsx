import { useState } from 'react';
import { relTime } from './diff.js';
import {
  CRITICAL, CRITERION, SOURCE, verdictColor, verdictLabel, failedChecks, isSighted,
  needsReview, recommendAction,
} from './qc.js';

// How the recommended action reads on the ledger's terms — what it costs to take it.
const COST_LABEL = {
  free: 'costs nothing', text: 'no render', render: 'spends a render', none: '',
};

// The cheapest resolving action, led with, so the menu never defaults to a paid re-render.
// Every action stays available in the row below — this only recommends; the director decides.
function Recommendation({ rec, node, busy, onReview, onRegenerate, onAccept, onCompareVersion }) {
  if (!rec) return null;
  const run = () => {
    if (rec.key === 'review') onReview(node);
    else if (rec.key === 'regenerate') onRegenerate(node, rec.note);
    else if (rec.key === 'select') onCompareVersion(rec.version);
    else if (rec.key === 'accept') onAccept(node);
  };
  return (
    <div className={`qc-rec ${rec.key}`}>
      <div className="qc-rec-head">
        <span className="qc-rec-tag">Recommended</span>
        {COST_LABEL[rec.cost] && <span className="qc-rec-cost">{COST_LABEL[rec.cost]}</span>}
      </div>
      <div className="qc-rec-why">{rec.why}</div>
      {rec.key !== 'flag' && (
        <button className={rec.key === 'regenerate' ? 'btn-gold' : 'btn'}
                disabled={busy} onClick={run}>
          {rec.label}
        </button>
      )}
    </div>
  );
}

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
                                  onReview, onCompareVersion, busy }) {
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
  // The override is the human's call — once made, the tool stops recommending its way out.
  const rec = override ? null : recommendAction(node, report);

  // The alternatives shown under the recommendation — the full menu minus whatever is already
  // the recommended button, so nothing appears twice.
  const otherActions = [
    { key: 'review', cls: 'btn', label: '⟳ Re-review',
      title: 'Look again — changes nothing else', run: () => onReview(node) },
    outstanding && { key: 'regenerate', cls: 'btn-gold', label: '↻ Re-render',
      title: 'Make this asset again', run: () => onRegenerate(node) },
    outstanding && { key: 'accept', cls: 'btn', label: 'Keep as is',
      title: 'Keep this version despite the verdict', run: () => onAccept(node) },
  ].filter(Boolean).filter((a) => a.key !== rec?.key);

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

          <Recommendation
            rec={rec} node={node} busy={busy}
            onReview={onReview} onRegenerate={onRegenerate}
            onAccept={onAccept} onCompareVersion={onCompareVersion}
          />

          {/* Every action the gate can take, minus the one already recommended above — so the
              same button never shows up twice. The recommendation leads with the cheapest;
              these are the alternatives, always available for the director to overrule with. */}
          {otherActions.length > 0 && (
            <>
              {rec && <div className="qc-actions-label">Other options</div>}
              <div className="qc-actions">
                {otherActions.map((a) => (
                  <button key={a.key} className={a.cls} disabled={busy}
                          onClick={a.run} title={a.title}>
                    {a.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
