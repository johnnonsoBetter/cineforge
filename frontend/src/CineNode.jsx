import { memo, useEffect, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { KIND_LABEL, STATUS_LABEL, statusColor, isVideo } from './ui.js';
import { verdictColor, verdictLabel, failedChecks } from './qc.js';
import { foundingFooter } from './founding.js';
import TvPlayer from './components/TvPlayer.jsx';

// What a card says while it works, by kind and lifecycle beat. Kept specific on purpose —
// "animating 8s" reads as a film being shot; a generic "rendering…" reads as a dead spinner.
const RENDER_VERB = {
  character: 'drafting reference',
  environment: 'painting plate',
  keyframe: 'composing frame',
  shot: 'animating 8s',
};
function phaseLabel(kind, phase) {
  if (phase === 'reviewing') return 'reviewing quality';
  if (phase === 'rerendering') return 're-rendering';
  if (phase?.startsWith('provider:')) {
    const [, status, pct] = phase.split(':');
    return pct ? `${status} ${pct}%` : status;
  }
  return RENDER_VERB[kind] || 'rendering';
}

// One card on the canvas. Its look is driven entirely by the graph node so a streamed
// status change (running → ready → stale) re-skins it in place.
function CineNodeImpl({ data, selected }) {
  const n = data.node;
  const { kind, status, title, data: d = {}, asset, qc, locked } = n;
  // Counted off the graph, never estimated — see stats.js.
  const stats = (data.stats || []).filter(Boolean);
  const running = status === 'running';
  const phase = data.phase;                 // 'reviewing' | 'rerendering' | undefined
  const reviewing = phase === 'reviewing';
  const thumb = asset?.thumbnail || asset?.url;
  const showThumb = thumb && !isVideo(thumb) ? thumb : asset?.thumbnail;

  // A video asset (a shot's clip, or the stitched final cut) plays right on the card: the
  // play badge swaps the poster for a real <video>, so a director scans the cut without ever
  // leaving the canvas. A fresh take (new url after a regenerate) drops back to the poster.
  const isVid = isVideo(asset?.url);
  const [playing, setPlaying] = useState(false);
  useEffect(() => { setPlaying(false); }, [asset?.url]);

  // A shot is a clip, so its card is a compact video card: the frame, its length, and only
  // the two things a director scans a cut for — which setup it is, and whether the gate passed
  // it. Everything else (coverage, takes, the full verdict) lives in the Inspector.
  if (kind === 'shot') {
    const dur = asset?.duration_sec;
    const flagged = qc && qc.verdict !== 'PASS' && qc.verdict !== 'SKIPPED';
    return (
      <div className={`node node-shot shot-card ${status} ${selected ? 'selected' : ''} ${locked ? 'locked' : ''}`}>
        <Handle type="target" position={Position.Left} />
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

        <div className={`node-media ${showThumb ? '' : 'empty'} ${running ? 'working' : ''} ${reviewing ? 'reviewing' : ''}`}>
          {playing && isVid
            ? <TvPlayer variant="slim" src={asset.url} poster={showThumb || undefined}
                        autoPlay onEnded={() => setPlaying(false)} className="nodrag nopan" />
            : showThumb && <img src={showThumb} alt={title} loading="lazy" draggable={false} />}
          {/* Shimmer until the still lands, then a scan sweep while the gate looks it over. */}
          {running && !showThumb && <span className="media-skeleton" aria-hidden="true" />}
          {running && showThumb && reviewing && <span className="media-scan" aria-hidden="true" />}
          {running && <span className="media-phase mini">{phaseLabel('shot', phase)}</span>}
          {!running && !showThumb && <span className="mono-label">no clip</span>}
          {/* The card's one state light — the gate's verdict if it has been reviewed, else the
              render status. */}
          <span className="shot-badge" title={qc ? verdictLabel(qc.verdict) : STATUS_LABEL[status] || status}>
            {running
              ? <span className="spinner" />
              : <span className="dot" style={{
                  background: qc ? verdictColor(qc.verdict) : statusColor(status),
                  color: qc ? verdictColor(qc.verdict) : statusColor(status),
                }} />}
          </span>
          {locked && <span className="shot-lock" title="Locked — regeneration skips this">🔒</span>}
          {isVid && !playing && (
            <button className="node-play nodrag" title="Play clip"
                    onClick={(e) => { e.stopPropagation(); setPlaying(true); }}>
              ▶ {dur ? `${dur}s` : 'clip'}
            </button>
          )}
        </div>

        <div className="shot-foot">
          <div className="shot-foot-top">
            <span className="node-title">{title}</span>
            {flagged && (
              <span className="shot-flag" style={{ color: verdictColor(qc.verdict) }}>
                {verdictLabel(qc.verdict)}
              </span>
            )}
          </div>
          {d.setup && <span className="shot-setup">{d.setup}</span>}
          {/* Timelined, lip-synced lines live on the clip — flag them on the card so a director
              scanning the cut sees which shots speak, and to whom, without opening the shot. */}
          {d.dialogue?.length > 0 && (
            <span className="shot-dialogue"
                  title={d.dialogue.map((c) => `${c.start ?? 0}s — ${c.character ? `${c.character}: ` : ''}${c.text}`).join('\n')}>
              💬 {d.dialogue.length} line{d.dialogue.length === 1 ? '' : 's'}
              {d.dialogue[0]?.character ? ` · ${d.dialogue[0].character}` : ''}
            </span>
          )}
        </div>
        <Handle type="source" position={Position.Right} />
      </div>
    );
  }

  const tags = [];
  if (kind === 'scene') {
    if (d.intent) tags.push(d.intent);
    if (d.shot) tags.push(d.shot);
    if (d.angle) tags.push(d.angle);
    if (d.time) tags.push(d.time);
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

  const mediaKinds = ['character', 'environment', 'keyframe', 'shot', 'timeline'];
  const hasMedia = mediaKinds.includes(kind);
  // Founding references (the two sheets-stage nodes everything downstream inherits) wear a
  // pared-back face: thumb + a metadata signature strip, never the four detail layers.
  const founding = kind === 'character' || kind === 'environment';

  return (
    <div className={`node node-${kind} ${status} ${selected ? 'selected' : ''} ${locked ? 'locked' : ''}`}>
      <Handle type="target" position={Position.Left} />
      {/* Floating corner state light — verdict if the gate has ruled, else render status. */}
      <span
        className="node-status-dot"
        title={qc ? verdictLabel(qc.verdict) : STATUS_LABEL[status] || status}
        style={{
          background: qc ? verdictColor(qc.verdict) : statusColor(status),
          color: qc ? verdictColor(qc.verdict) : statusColor(status),
        }}
      />
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
        {founding ? (
          // The weight a sheet card carries and a keyframe card doesn't: everything inherits
          // this, so it's gated hardest. Status and lock ride in the footer strip instead.
          <span className="node-founding-mark"
                title="Founding reference — every downstream frame inherits this, so it is gated hardest.">
            founding
          </span>
        ) : (
          <>
            {locked && <span className="node-lock" title="Locked — regeneration skips this">🔒</span>}
            <span className="node-status" style={{ color: statusColor(status) }}>
              {running && <span className="spinner" />}
              {STATUS_LABEL[status] || status}
            </span>
          </>
        )}
      </div>

      {hasMedia && (
        <div className={`node-media ${showThumb ? '' : 'empty'} ${running ? 'working' : ''} ${reviewing ? 'reviewing' : ''}`}>
          {playing && isVid
            ? <TvPlayer variant="slim" src={asset.url} poster={showThumb || undefined}
                        autoPlay onEnded={() => setPlaying(false)} className="nodrag nopan" />
            : showThumb && <img src={showThumb} alt={title} loading="lazy" draggable={false} />}
          {/* A shimmer skeleton holds the frame's shape until the first take lands; once a take
              is up, a scan sweep signals the gate is looking before its verdict pill appears. */}
          {running && !showThumb && <span className="media-skeleton" aria-hidden="true" />}
          {running && showThumb && reviewing && <span className="media-scan" aria-hidden="true" />}
          {running && (
            <span className="media-phase"><span className="spinner" />{phaseLabel(kind, phase)}</span>
          )}
          {!running && !showThumb && <span className="mono-label">no frame</span>}
          {isVid && !playing && (
            <button className="node-play nodrag" title={kind === 'timeline' ? 'Play film' : 'Play clip'}
                    onClick={(e) => { e.stopPropagation(); setPlaying(true); }}>
              ▶ {asset.duration_sec ? `${asset.duration_sec}s` : kind === 'timeline' ? 'film' : 'clip'}
            </button>
          )}
          {/* On a keyframe the verdict belongs on the frame, not in a prose row below it — a
              floating pill over the master frame reads at a glance and keeps the card frame-first. */}
          {kind === 'keyframe' && qc && (
            <span
              className="qc-overlay"
              style={{ color: verdictColor(qc.verdict), borderColor: verdictColor(qc.verdict) }}
              title={
                failedChecks(qc).length
                  ? failedChecks(qc).map((c) => c.criterion).join(', ')
                  : qc.summary || verdictLabel(qc.verdict)
              }
            >
              {qc.verdict === 'PASS' ? '✓' : qc.verdict === 'SKIPPED' ? '—' : '⚠'} {verdictLabel(qc.verdict)}
            </span>
          )}
        </div>
      )}

      <div className="node-body">
        <div className="node-title">{title}</div>
        {founding ? (
          <>
          {desc && <div className="node-founding-tag">{desc}</div>}
          <div className="node-founding-foot">
            {foundingFooter(n).map((c) => (
              <span className="ff-cell" key={c.key} style={{ color: c.color }} title={c.title}>
                {c.mark === 'spinner' && <span className="spinner ff-mark" />}
                {c.mark === 'dot' && <span className="dot ff-mark" style={{ background: c.color }} />}
                {c.label}
              </span>
            ))}
          </div>
          </>
        ) : (
          <>
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
        {qc && kind !== 'keyframe' && (
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

        {/* Another shot off this exact still: one clip, same frame, a different move. Belongs
            on the frame you would call it from, and only once the still actually exists. */}
        {kind === 'keyframe' && asset?.url && (
          <button
            className="node-add-shot"
            title="Re-animate this exact still with a different move — one clip, same frame"
            onClick={(e) => {
              e.stopPropagation();
              data.onAddShot?.(n);
            }}
          >
            + Shot
          </button>
        )}

        {/* Another angle of the whole scene: a genuinely new still plus its clip. It belongs
            on the scene — the thing a new frame is added to — not on any one frame already in
            it. Offered once the scene has at least one frame, i.e. its sheets are locked. */}
        {kind === 'scene' && data.canAddKeyframe && (
          <button
            className="node-add-shot"
            title="Compose a new still at another angle of this scene, then animate it"
            onClick={(e) => {
              e.stopPropagation();
              data.onAddKeyframe?.(n);
            }}
          >
            + Keyframe
          </button>
        )}
          </>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export const CineNode = memo(CineNodeImpl);
