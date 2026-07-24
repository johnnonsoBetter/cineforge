import { useState } from 'react';
import { KIND_LABEL, STATUS_LABEL, statusColor, isVideo, shortHash } from './ui.js';
import Takes from './Takes.jsx';
import QCPanel from './QCPanel.jsx';
import StoryBrief from './StoryBrief.jsx';

// A scene's cast is a real dependency on character nodes, not decoration — clicking a
// chip walks the graph to whoever it points at.
function CastChips({ cast, onSelectEntity }) {
  if (!cast?.length) return null;
  return (
    <div className="insp-section">
      <h3>Cast</h3>
      <div className="chip-row">
        {cast.map((c) => (
          <button key={c.id} className="entity-chip" onClick={() => onSelectEntity(c.id)}
                  title={`Go to ${c.name}`}>
            {c.name}
          </button>
        ))}
      </div>
    </div>
  );
}

// Everywhere this entity is depended upon. Answers "what breaks if I change this?"
// before the user finds out the expensive way.
function References({ refs, onSelectNode }) {
  if (!refs?.length) return null;
  const structural = refs.filter((r) => r.structural).length;
  return (
    <div className="insp-section">
      <h3>Referenced by <span className="mono-label">· {refs.length}</span></h3>
      <div className="chip-row">
        {refs.map((r, i) => (
          <button key={`${r.node_id}-${r.field}-${i}`} className="ref-chip"
                  onClick={() => onSelectNode(r.node_id)}
                  title={`${r.node_title} — ${r.field}`}>
            {r.node_title}
            <span className="ref-field">{r.field}</span>
          </button>
        ))}
      </div>
      <div className="mono-label" style={{ marginTop: 8 }}>
        {structural} structural · {refs.length - structural} in dialogue &amp; action
      </div>
    </div>
  );
}

// What changing this node would actually cost, before committing to it. The split is the
// product's whole thesis: `rewritten` is text the graph re-resolves for free, `stale` is
// media that has to be generated — and paid for — a second time.
const IMPACT_VERB = {
  story: 'Update', scene: 'Update', character: 'Regenerate',
  environment: 'Regenerate', keyframe: 'Regenerate', shot: 'Re-render',
  timeline: 'Re-assemble',
};

const countByKind = (entries) => {
  const m = new Map();
  for (const e of entries || []) m.set(e.kind, (m.get(e.kind) || 0) + 1);
  return [...m.entries()];
};

const plural = (n, kind) => {
  const label = (KIND_LABEL[kind] || kind).toLowerCase();
  return `${n} ${label}${n === 1 ? '' : 's'}`;
};

function ImpactPanel({ impact, node, onSelectNode }) {
  const stale = impact?.stale || [];
  const rewritten = impact?.rewritten || [];
  if (!stale.length && !rewritten.length) return null;

  const usedIn = countByKind([...rewritten, ...stale]);
  const plan = [
    ...countByKind(rewritten).map(([k, n]) => [`${IMPACT_VERB[k] || 'Update'} ${plural(n, k)}`, false]),
    ...countByKind(stale).map(([k, n]) => [`${IMPACT_VERB[k] || 'Regenerate'} ${plural(n, k)}`, true]),
  ];

  return (
    <div className="insp-section impact">
      <h3>If you change this</h3>
      <div className="prose" style={{ fontSize: 14, marginBottom: 10 }}>
        {node.title} is used in {usedIn.map(([k, n]) => plural(n, k)).join(', ')}.
      </div>

      <ul className="impact-plan">
        {plan.map(([text, costs]) => (
          <li key={text} className={costs ? 'costs' : ''}>
            <span className="impact-tick">✓</span>{text}
            {!costs && <span className="impact-free">free</span>}
          </li>
        ))}
        <li className="preserved">
          <span className="impact-tick">✓</span>
          Dialogue, cast identity and camera blocking are read from the graph — they carry over
        </li>
      </ul>

      {impact.cost_hint && <div className="mono-label impact-cost">{impact.cost_hint}</div>}

      {stale.length > 0 && (
        <div className="chip-row" style={{ marginTop: 10 }}>
          {stale.map((s) => (
            <button key={s.node_id} className="ref-chip" onClick={() => onSelectNode(s.node_id)}
                    title={`Go to ${s.title}`}>
              {s.title}
              <span className="ref-field">{KIND_LABEL[s.kind] || s.kind}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// How the scene is covered: the camera setups it is filmed from, all of them the same
// moment seen from a different place. Reads as a shot list because that is what it is.
function SceneCoverage({ node, onSelectNode, shotsByIndex }) {
  const coverage = node.data?.coverage || [];
  if (!coverage.length) return null;
  return (
    <div className="insp-section">
      <h3>Coverage <span className="mono-label">· {coverage.length} setup{coverage.length > 1 ? 's' : ''}</span></h3>
      <ol className="beats">
        {coverage.map((c, i) => {
          const shot = shotsByIndex?.[i];
          return (
            <li key={i}>
              <span className="beat-name">{c.shot}{c.angle ? ` · ${c.angle}` : ''}</span>
              <span className="beat-text">{c.action}</span>
              {c.intent && <span className="beat-text dim">to {c.intent}</span>}
              {shot && (
                <button className="ref-chip beat-jump" onClick={() => onSelectNode(shot.node_id)}>
                  {shot.title}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// Renaming is a graph edit, not a regeneration — the copy here says so, because that is
// the whole point of the entity layer.
function RenameBox({ node, onRename, busy }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(node.title);
  if (!node.data?.id) return null;

  return (
    <div className="insp-section">
      {!open ? (
        <button className="btn" onClick={() => { setValue(node.title); setOpen(true); }}>
          ✎ Rename everywhere
        </button>
      ) : (
        <>
          <h3>Rename</h3>
          <input className="rename-input" value={value} autoFocus
                 onChange={(e) => setValue(e.target.value)}
                 onKeyDown={(e) => {
                   if (e.key === 'Enter' && value.trim()) { onRename(value.trim()); setOpen(false); }
                   if (e.key === 'Escape') setOpen(false);
                 }} />
          <div className="mono-label" style={{ margin: '8px 0' }}>
            Updates the story, every scene and the voiceover. No frames are re-rendered.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-gold" disabled={busy || !value.trim()}
                    onClick={() => { onRename(value.trim()); setOpen(false); }}>
              Rename
            </button>
            <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}

function Copyable({ value }) {
  const [done, setDone] = useState(false);
  if (!value) return <span style={{ color: 'var(--faint)' }}>—</span>;
  return (
    <div className="hashline">
      <code title={value}>{value}</code>
      <button
        className="copy-btn"
        onClick={() => {
          navigator.clipboard?.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        }}
      >
        {done ? 'copied' : 'copy'}
      </button>
    </div>
  );
}

// Kind-specific metadata rows.
function meta(node) {
  const d = node.data || {};
  switch (node.kind) {
    case 'story':
      return [['Logline', d.logline], ['Style', d.style]];
    case 'character':
      return [['Ref ID', d.id], ['Identity', d.dna]];
    case 'environment':
      return [['Ref ID', d.id], ['Plate', d.desc]];
    case 'scene':
      return [
        ['Scene', d.n != null ? `#${d.n}` : null],
        ['Intent', d.intent],
        ['Action', d.action],
        ['Shot', d.shot],
        ['Angle', d.angle],
        ['Camera', d.move],
        ['Time', d.time],
        ['Mood', d.atmosphere],
        // Cast is rendered as live entity chips below, not as flat text.
        ['Voiceover', d.vo ? `“${d.vo}”` : null],
      ];
    case 'shot':
      return [
        ['Duration', node.asset?.duration_sec ? `${node.asset.duration_sec}s` : null],
        ['Dialogue', d.vo ? `“${d.vo}”` : null],
      ];
    case 'timeline':
      return [['Shots', Array.isArray(d.shots) ? `${d.shots.length} in sequence` : null]];
    default:
      return [];
  }
}

export default function Inspector({ node, onClose, onRegenerate, busy, impact,
                                    references, onSelectNode, onSelectEntity, onRename,
                                    onSelectVersion, onToggleLock, sceneShots, onAcceptQC,
                                    onReviewQC, entityNodes }) {
  const [provOpen, setProvOpen] = useState(false);
  if (!node) return null;
  const entityRefs = node.data?.id ? (references?.[node.data.id] || []) : [];

  const asset = node.asset;
  const url = asset?.url;
  const video = isVideo(url);
  const prov = asset?.provenance || {};
  const rows = meta(node).filter(([, v]) => v != null && v !== '');
  const canRegen = ['character', 'environment', 'scene', 'keyframe', 'shot'].includes(node.kind);
  const staleCount = impact?.stale?.length || 0;

  return (
    <aside className="inspector">
      <div className="insp-head">
        <div style={{ flex: 1 }}>
          <span className="mono-label">{KIND_LABEL[node.kind] || node.kind}</span>
          <h2>{node.title}</h2>
        </div>
        <span className="node-status" style={{ color: statusColor(node.status), marginTop: 4 }}>
          <span className="dot" style={{ background: statusColor(node.status) }} />
          {STATUS_LABEL[node.status] || node.status}
        </span>
        <button className="insp-close" onClick={onClose} title="Close">✕</button>
      </div>

      <div className="insp-scroll">
        {url && (
          <div className="insp-preview">
            {video ? (
              <video src={url} poster={asset.thumbnail} controls playsInline preload="metadata" />
            ) : (
              <img src={url} alt={node.title} />
            )}
          </div>
        )}

        <QCPanel
          node={node}
          report={node.qc}
          busy={busy}
          onSelectNode={onSelectNode}
          onRegenerate={onRegenerate}
          onAccept={onAcceptQC}
          onReview={onReviewQC}
        />

        <Takes node={node} onSelectVersion={onSelectVersion} busy={busy} />

        {canRegen && <ImpactPanel impact={impact} node={node} onSelectNode={onSelectNode} />}

        {rows.length > 0 && (
          <div className="insp-section">
            <h3>Details</h3>
            <dl style={{ margin: 0 }}>
              {rows.map(([k, v]) => (
                <div className="kv" key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {node.kind === 'story' && (
          <StoryBrief node={node} entityNodes={entityNodes} onSelectNode={onSelectNode} />
        )}

        {node.kind === 'scene' && (
          <>
            <CastChips cast={node.data?.cast} onSelectEntity={onSelectEntity} />
            <SceneCoverage node={node} onSelectNode={onSelectNode} shotsByIndex={sceneShots} />
          </>
        )}

        {(node.kind === 'character' || node.kind === 'environment') && (
          <>
            <References refs={entityRefs} onSelectNode={onSelectNode} />
            <RenameBox node={node} onRename={onRename} busy={busy} />
          </>
        )}

        {asset && (
          <>
            <button className="drawer-toggle" onClick={() => setProvOpen((o) => !o)}>
              Provenance
              {prov.verified && (
                <span style={{ color: 'var(--green)', marginLeft: 8, letterSpacing: '0.06em' }}>✓ verified</span>
              )}
              <span className={`drawer-caret ${provOpen ? 'open' : ''}`}>▶</span>
            </button>
            {provOpen && (
              <div className="insp-section drawer-body" style={{ borderTop: 'none' }}>
                <dl style={{ margin: '0 0 12px' }}>
                  <div className="kv"><dt>Provider</dt><dd>{prov.provider || '—'}</dd></div>
                  <div className="kv"><dt>Model</dt><dd>{prov.model || '—'}</dd></div>
                  <div className="kv"><dt>Verified</dt><dd style={{ color: prov.verified ? 'var(--green)' : 'var(--amber)' }}>{prov.verified ? 'yes — manifest checked' : 'unverified'}</dd></div>
                  <div className="kv"><dt>Asset ID</dt><dd>{asset.asset_id}</dd></div>
                </dl>

                <h3 style={{ marginTop: 4 }}>SHA-256</h3>
                <Copyable value={prov.sha256} />

                <h3 style={{ marginTop: 14 }}>Canonical hash</h3>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text)' }} title={prov.canonical_hash}>
                  {shortHash(prov.canonical_hash)}
                </div>

                <h3 style={{ marginTop: 14 }}>Backblaze B2 manifest</h3>
                <Copyable value={prov.manifest_uri} />

                {prov.prompt && (
                  <>
                    <h3 style={{ marginTop: 14 }}>Generation prompt</h3>
                    <div className="code-block">{prov.prompt}</div>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {canRegen && (
        <div className="insp-foot">
          {/* The cost rides on the button you actually press, so nobody spends a re-render
              they didn't mean to. */}
          <button
            className="btn-gold"
            disabled={busy || node.locked || node.status === 'running'}
            onClick={() => onRegenerate(node)}
          >
            {node.status === 'running' ? 'Working…'
              : node.locked ? '🔒 Locked'
              : staleCount ? `↻ Regenerate · ${staleCount} downstream`
              : '↻ Regenerate'}
          </button>
          <button
            className="btn insp-lock"
            onClick={() => onToggleLock(!node.locked)}
            title={node.locked
              ? 'Unlock so this can be regenerated again'
              : 'Lock this take — every regeneration will skip it'}
          >
            {node.locked ? 'Unlock' : 'Lock'}
          </button>
        </div>
      )}
    </aside>
  );
}
