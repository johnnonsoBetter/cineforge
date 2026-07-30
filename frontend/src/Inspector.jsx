import { useState } from 'react';
import { KIND_LABEL, STATUS_LABEL, statusColor, isVideo, shortHash } from './ui.js';
import { verdictColor, needsReview } from './qc.js';
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

// The verifiable chain behind an asset — who rendered it, on what, and the hashes that let
// anyone check the pixels weren't swapped. Its own tab; every row is evidence, not chrome.
function Provenance({ asset }) {
  const prov = asset?.provenance || {};
  return (
    <div className="insp-section" style={{ borderBottom: 'none' }}>
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

      {(prov.run_id || prov.parent_run_id) && (
        <>
          <h3 style={{ marginTop: 14 }}>Run lineage</h3>
          <div className="kv"><dt>Run</dt>
            <dd style={{ fontFamily: 'var(--mono)', fontSize: 11 }} title={prov.run_id}>{shortHash(prov.run_id) || '—'}</dd></div>
          <div className="kv"><dt>Parent</dt>
            <dd style={{ fontFamily: 'var(--mono)', fontSize: 11 }} title={prov.parent_run_id}>
              {prov.parent_run_id ? shortHash(prov.parent_run_id) : 'origin'}
            </dd></div>
        </>
      )}

      {prov.prompt && (
        <>
          <h3 style={{ marginTop: 14 }}>Generation prompt</h3>
          <div className="code-block">{prov.prompt}</div>
        </>
      )}
    </div>
  );
}

// Kind-specific metadata rows.
function meta(node) {
  const d = node.data || {};
  switch (node.kind) {
    case 'story':
      return [['Logline', d.logline], ['Style', d.style]];
    case 'character': {
      // The identity layer, one row per filled trait, then the separable wardrobe/bearing
      // layers. A character from before the layers existed carries only a flat dna, so fall
      // back to that. Empty rows are dropped by the caller.
      const id = d.identity || {};
      const idRows = Object.entries(id)
        .filter(([, v]) => v)
        .map(([k, v]) => [k[0].toUpperCase() + k.slice(1), v]);
      return [
        ['Ref ID', d.id],
        ...idRows,
        ['Wardrobe', d.wardrobe],
        ['Bearing', d.bearing],
        ...(idRows.length ? [] : [['Identity', d.dna]]),
      ];
    }
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

export default function Inspector({ node, onClose, onRegenerate, busy,
                                    references, onSelectNode, onSelectEntity, onRename,
                                    onSelectVersion, sceneShots, onAcceptQC,
                                    onReviewQC, entityNodes }) {
  const entityRefs = node?.data?.id ? (references?.[node.data.id] || []) : [];

  const asset = node?.asset;
  const url = asset?.url;
  const video = isVideo(url);
  const rows = meta(node || {}).filter(([, v]) => v != null && v !== '');
  // Each aspect gets its own tab, but only the ones this node actually has — an empty tab
  // reads as broken. Beyond the shared review/history/provenance, a node's own information
  // is split by kind: a scene's cast and coverage, an entity's dependants, a story's brief
  // each earn a tab rather than stacking inside one long Details scroll.
  const isEntity = node?.kind === 'character' || node?.kind === 'environment';
  const hasReview = !!(node?.qc || url);
  const hasHistory = (node?.versions?.length || 0) >= 2;
  const hasCast = node?.kind === 'scene' && (node?.data?.cast?.length || 0) > 0;
  const hasCoverage = node?.kind === 'scene' && (node?.data?.coverage?.length || 0) > 0;
  const hasUses = isEntity && entityRefs.length > 0;
  const hasBrief = node?.kind === 'story';
  // Details keeps the node's own fields and (for entities) rename — the blast radius and the
  // regenerate/lock controls now live on the conversational rail, next to the input.
  const hasDetails = rows.length > 0 || isEntity;
  const tabs = [
    hasReview && { id: 'review', label: 'Review' },
    hasHistory && { id: 'history', label: 'History' },
    hasDetails && { id: 'details', label: 'Details' },
    hasCast && { id: 'cast', label: 'Cast' },
    hasCoverage && { id: 'coverage', label: 'Coverage' },
    hasUses && { id: 'uses', label: 'Used by' },
    hasBrief && { id: 'brief', label: 'Brief' },
    asset && { id: 'provenance', label: 'Provenance' },
  ].filter(Boolean);

  // Open on the gate when it is asking for a decision; otherwise the first tab.
  const outstanding = node?.qc && needsReview(node.qc.verdict) && !node.data?.qc_override;
  const [tab, setTab] = useState(outstanding ? 'review' : tabs[0]?.id);
  // A "compare take N" recommendation from the gate opens History with that take already
  // loaded into the swipe — so a free checkout is confirmed against the pixels, not blind.
  const [compareVersion, setCompareVersion] = useState(null);
  const compareTake = (version) => { setCompareVersion(version); setTab('history'); };
  // The tab set can shift under a live node (a re-render adds History) — never leave a tab
  // selected that no longer exists.
  const active = tabs.some((t) => t.id === tab) ? tab : tabs[0]?.id;

  if (!node) return null;

  return (
    <aside className={`inspector node-${node.kind}`}>
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

      {url && (
        <div className="insp-preview">
          {video ? (
            <video src={url} poster={asset.thumbnail} controls playsInline preload="metadata" />
          ) : (
            <img src={url} alt={node.title} />
          )}
        </div>
      )}

      {tabs.length > 1 && (
        <div className="insp-tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={active === t.id}
              className={`insp-tab ${active === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {/* The verdict now lives behind a tab, so carry its colour out to the tab —
                  a red dot here is the only cue a hidden gate is failing. */}
              {t.id === 'review' && node.qc && (
                <span className="insp-tab-dot" style={{ background: verdictColor(node.qc.verdict) }} />
              )}
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div className="insp-scroll">
        {active === 'review' && (
          <QCPanel
            node={node}
            report={node.qc}
            busy={busy}
            onSelectNode={onSelectNode}
            onRegenerate={onRegenerate}
            onAccept={onAcceptQC}
            onReview={onReviewQC}
            onCompareVersion={compareTake}
          />
        )}

        {active === 'history' && (
          <Takes node={node} onSelectVersion={onSelectVersion} busy={busy}
                 focusVersion={compareVersion} />
        )}

        {active === 'details' && (
          <>
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

            {isEntity && <RenameBox node={node} onRename={onRename} busy={busy} />}
          </>
        )}

        {active === 'cast' && (
          <CastChips cast={node.data?.cast} onSelectEntity={onSelectEntity} />
        )}

        {active === 'coverage' && (
          <SceneCoverage node={node} onSelectNode={onSelectNode} shotsByIndex={sceneShots} />
        )}

        {active === 'uses' && (
          <References refs={entityRefs} onSelectNode={onSelectNode} />
        )}

        {active === 'brief' && (
          <StoryBrief node={node} entityNodes={entityNodes} onSelectNode={onSelectNode} />
        )}

        {active === 'provenance' && asset && <Provenance asset={asset} />}
      </div>
    </aside>
  );
}
