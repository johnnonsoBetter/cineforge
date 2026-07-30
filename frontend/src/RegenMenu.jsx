import { useEffect, useState } from 'react';
import { KIND_LABEL } from './ui.js';

// The regeneration surface, folded into the rail just above the composer.
//
// Selecting a rendered entity used to hand the decision to a button on the far side panel;
// this brings it to the same layer the director is already talking on. It answers the one
// thing the conversational input can't show inline — if you redo this, what downstream gets
// re-rendered — and lets the director keep any of it out of this pass.
//
// "Skip" is deliberately not "lock": it leaves a dependency exactly as it is for this
// regeneration only and is then forgotten, where a lock seals a take against every future
// change. The entity's own lock still lives here, as the separate, heavier promise it is.
export default function RegenMenu({ node, impact, busy, onRegenerate, onToggleLock }) {
  const stale = impact?.stale || [];
  const [skip, setSkip] = useState(() => new Set());

  // A fresh selection starts with nothing skipped — the skip set is about this pass, not the
  // node, so it must not carry across entities.
  useEffect(() => { setSkip(new Set()); }, [node.node_id]);

  const toggle = (id) => setSkip((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const willRender = stale.filter((s) => !skip.has(s.node_id)).length;
  const running = node.status === 'running';

  return (
    <div className="regen-menu">
      <div className="regen-head">
        <span className="mono-label">If you regenerate</span>
        <button
          className={`regen-lock ${node.locked ? 'on' : ''}`}
          onClick={() => onToggleLock(!node.locked)}
          title={node.locked
            ? 'Sealed — every regeneration skips this take. Click to unlock.'
            : 'Seal this take against every future change (unlike a one-off skip).'}
        >
          {node.locked ? '🔒 Locked' : 'Lock take'}
        </button>
      </div>

      {stale.length > 0 ? (
        <>
          <div className="regen-sum">
            {node.title} re-renders {willRender} of {stale.length} downstream. Skip any to keep it.
          </div>
          <div className="regen-deps">
            {stale.map((s) => {
              const off = skip.has(s.node_id);
              return (
                <button key={s.node_id} className={`regen-dep ${off ? 'skipped' : ''}`}
                        onClick={() => toggle(s.node_id)}
                        title={off ? 'Kept as it is this pass — click to re-render it'
                                   : 'Re-renders on regenerate — click to skip it this pass'}>
                  <span className="regen-dep-title">{s.title}</span>
                  <span className="regen-dep-kind">{KIND_LABEL[s.kind] || s.kind}</span>
                  <span className="regen-dep-state">{off ? 'skip' : 're-render'}</span>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <div className="regen-sum">Nothing downstream re-renders — {node.title} redraws on its own.</div>
      )}

      <button
        className="btn-gold regen-go"
        disabled={busy || node.locked || running}
        onClick={() => onRegenerate(node, null, [...skip])}
      >
        {running ? 'Working…'
          : node.locked ? '🔒 Locked'
          : willRender ? `↻ Regenerate · ${willRender} downstream`
          : '↻ Regenerate'}
      </button>
    </div>
  );
}
