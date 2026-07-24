import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { KIND_LABEL, STATUS_LABEL, statusColor, isVideo } from './ui.js';
import { verdictColor, verdictLabel, failedChecks } from './qc.js';

// One card on the canvas. Its look is driven entirely by the graph node so a streamed
// status change (running → ready → stale) re-skins it in place.
function CineNodeImpl({ data, selected }) {
  const n = data.node;
  const { kind, status, title, data: d = {}, asset, qc, locked } = n;
  // Counted off the graph, never estimated — see stats.js.
  const stats = (data.stats || []).filter(Boolean);
  const running = status === 'running';
  const thumb = asset?.thumbnail || asset?.url;
  const showThumb = thumb && !isVideo(thumb) ? thumb : asset?.thumbnail;

  const tags = [];
  if (kind === 'scene') {
    if (d.intent) tags.push(d.intent);
    if (d.shot) tags.push(d.shot);
    if (d.angle) tags.push(d.angle);
    if (d.time) tags.push(d.time);
  } else if (kind === 'keyframe') {
    tags.push('master frame');
  } else if (kind === 'shot') {
    if (d.setup) tags.push(d.setup);
    if (d.coverage?.move) tags.push(d.coverage.move);
    if (d.added) tags.push('added on set');
    if (d.vo) tags.push('dialogue');
  } else if (kind === 'story') {
    if (d.style) tags.push('style locked');
  } else if (kind === 'timeline') {
    if (Array.isArray(d.shots)) tags.push(`${d.shots.length} shots`);
  }

  const desc =
    kind === 'character' ? d.dna
    : kind === 'environment' ? d.desc
    : kind === 'scene' ? d.action
    : kind === 'keyframe' ? d.action
    : kind === 'story' ? d.logline
    : kind === 'shot' ? (d.vo ? `“${d.vo}”` : d.coverage?.action)
    : '';

  const mediaKinds = ['character', 'environment', 'keyframe', 'shot'];
  const hasMedia = mediaKinds.includes(kind);

  return (
    <div className={`node ${status} ${selected ? 'selected' : ''} ${locked ? 'locked' : ''}`}>
      <Handle type="target" position={Position.Left} />
      {/* Re-emits as a contextmenu event so the button and right-click share one code path
          — React Flow's onNodeContextMenu picks it up as it bubbles. */}
      <button
        className="node-more"
        title="Actions"
        onClick={(e) => {
          e.stopPropagation();
          e.currentTarget.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true, clientX: e.clientX, clientY: e.clientY,
          }));
        }}
      >
        ⋯
      </button>
      <div className="node-head">
        <span className="node-kind">{KIND_LABEL[kind] || kind}</span>
        {locked && <span className="node-lock" title="Locked — regeneration skips this">🔒</span>}
        <span className="node-status" style={{ color: statusColor(status) }}>
          {running ? <span className="spinner" /> : <span className="dot" style={{ background: statusColor(status) }} />}
          {STATUS_LABEL[status] || status}
        </span>
      </div>

      {hasMedia && (
        <div className={`node-media ${showThumb ? '' : 'empty'}`}>
          {showThumb ? (
            <img src={showThumb} alt={title} loading="lazy" draggable={false} />
          ) : (
            <span className="mono-label">{running ? 'rendering…' : 'no frame'}</span>
          )}
          {kind === 'shot' && asset?.url && (
            <span className="node-play">▶ {asset.duration_sec ? `${asset.duration_sec}s` : 'shot'}</span>
          )}
        </div>
      )}

      <div className="node-body">
        <div className="node-title">{title}</div>
        {desc && <div className="node-desc">{desc}</div>}
        {tags.length > 0 && (
          <div className="node-meta">
            {tags.map((t, i) => (
              <span className="node-tag" key={i}>{t}</span>
            ))}
          </div>
        )}
        {stats.length > 0 && (
          <div className="node-stats">
            {stats.map(([label, value]) => (
              <div className="stat" key={label}>
                <span className="stat-value">{value}</span>
                <span className="stat-label">{label}</span>
              </div>
            ))}
          </div>
        )}
        {qc && (
          <div className="node-qc" style={{ color: verdictColor(qc.verdict) }}>
            <span className="dot" style={{ background: 'currentColor' }} />
            {verdictLabel(qc.verdict)}
            {/* Name what failed, not just that something did — "identity" tells you whether
                this is worth a re-render at a glance; "FAIL" does not. */}
            <span style={{ color: 'var(--faint)', letterSpacing: 0, textTransform: 'none' }}>
              {failedChecks(qc).length
                ? ` · ${failedChecks(qc).map((c) => c.criterion).join(', ')}`
                : qc.summary ? ` · ${qc.summary}` : ''}
            </span>
          </div>
        )}

        {/* Calling for another angle belongs on the frame you would call it from, not in a
            menu three clicks away. Only offered once the master actually exists — there is
            nothing to shoot from until then. */}
        {kind === 'keyframe' && asset?.url && (
          <button
            className="node-add-shot"
            title="Shoot another setup from this frame"
            onClick={(e) => {
              e.stopPropagation();
              data.onAddShot?.(n, { x: e.clientX, y: e.clientY });
            }}
          >
            + Setup
          </button>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export const CineNode = memo(CineNodeImpl);
