import { useState } from 'react';
import { wordDiff, relTime } from './diff.js';
import { isVideo, shortHash } from './ui.js';

// Take history, as a commit log.
//
// Regeneration appends rather than overwrites, so a node genuinely has a history — and the
// useful questions about it are git's questions: what is checked out, what changed, and can
// I go back. A row of thumbnails answers none of those, so this renders the log instead:
// graph gutter, HEAD marker, the director's note as the commit message, and a real diff of
// the prompt that produced each take.

// A take carries the review it was accepted on — takes predating the gate simply have none.
const verdictOf = (v) => v?.qc?.verdict ?? null;

const still = (asset) => {
  if (!asset) return null;
  // Shots are video; their thumbnail is the keyframe they were animated from.
  return isVideo(asset.url) ? asset.thumbnail : (asset.url || asset.thumbnail);
};

// Drag-to-compare. Side-by-side makes you hunt for the difference; a swipe puts both
// versions through the same pixels, which is how drift actually becomes visible.
function Swipe({ a, b, labelA, labelB }) {
  const [x, setX] = useState(50);
  if (!a || !b) return null;
  return (
    <div className="swipe">
      <img className="swipe-base" src={b} alt={labelB} />
      <div className="swipe-top" style={{ clipPath: `inset(0 ${100 - x}% 0 0)` }}>
        <img src={a} alt={labelA} />
      </div>
      <div className="swipe-line" style={{ left: `${x}%` }} />
      <span className="swipe-tag left">{labelA}</span>
      <span className="swipe-tag right">{labelB}</span>
      <input
        className="swipe-range"
        type="range" min="0" max="100" value={x}
        aria-label={`Compare ${labelA} against ${labelB}`}
        onChange={(e) => setX(+e.target.value)}
      />
    </div>
  );
}

function PromptDiff({ before, after }) {
  const { ops, added, removed, truncated } = wordDiff(before, after);
  if (!ops.length) return null;

  return (
    <div className="diff">
      <div className="diff-head">
        <span className="mono-label">Prompt</span>
        <span className="diff-stat">
          {added > 0 && <em className="add">+{added}</em>}
          {removed > 0 && <em className="del">−{removed}</em>}
          {added === 0 && removed === 0 && <em className="none">no change</em>}
        </span>
      </div>
      <div className="diff-body">
        {ops.map((op, i) => (
          <span key={i} className={`d-${op.t}`}>{op.text} </span>
        ))}
      </div>
      {truncated && (
        <div className="mono-label" style={{ marginTop: 6 }}>
          Prompts too long to diff word by word — shown whole.
        </div>
      )}
    </div>
  );
}

export default function Takes({ node, onSelectVersion, busy }) {
  const versions = node.versions || [];
  const [sel, setSel] = useState(null);
  if (versions.length < 2) return null;

  const headN = node.accepted_version;
  const head = versions.find((v) => v.version === headN);
  const picked = versions.find((v) => v.version === sel) || null;
  const log = [...versions].sort((a, b) => b.version - a.version);  // newest first, like git log

  return (
    <div className="insp-section takes-section">
      <div className="takes-head">
        <h3 style={{ margin: 0 }}>History <span className="mono-label">· {versions.length} takes</span></h3>
        <span className="mono-label">HEAD → take {headN}</span>
      </div>

      <ol className="log">
        {log.map((v, i) => {
          const isHead = v.version === headN;
          const isSel = v.version === sel;
          const prov = v.asset?.provenance || {};
          const verdict = verdictOf(v);
          return (
            <li key={v.version} className={`log-row ${isHead ? 'head' : ''} ${isSel ? 'sel' : ''}`}>
              <span className="log-graph" aria-hidden="true">
                <i className="log-dot" />
                {i < log.length - 1 && <i className="log-line" />}
              </span>

              <button className="log-entry" onClick={() => setSel(isSel ? null : v.version)}>
                <span className="log-top">
                  <span className="log-ref">take {v.version}</span>
                  {isHead && <span className="log-head">HEAD</span>}
                  <span className="log-when">{relTime(v.created_at)}</span>
                </span>

                <span className="log-msg">
                  {v.note ? `“${v.note}”` : i === log.length - 1 ? 'initial generation' : 'regenerated'}
                </span>

                <span className="log-meta">
                  {shortHash(prov.sha256 || v.asset?.asset_id)}
                  {prov.model ? ` · ${prov.model}` : ''}
                  {verdict ? ` · QC ${verdict}` : ''}
                </span>
              </button>

              {still(v.asset) && (
                <img className="log-thumb" src={still(v.asset)} alt={`take ${v.version}`} loading="lazy" />
              )}
            </li>
          );
        })}
      </ol>

      {picked && picked.version !== headN && (
        <div className="take-diff">
          <div className="diff-title">
            <span className="mono-label">Diff</span>
            <span>take {picked.version} → take {headN}</span>
          </div>

          <Swipe
            a={still(picked.asset)} b={still(head?.asset)}
            labelA={`take ${picked.version}`} labelB={`take ${headN} · HEAD`}
          />

          <PromptDiff
            before={picked.asset?.provenance?.prompt}
            after={head?.asset?.provenance?.prompt}
          />

          <button className="btn-gold checkout" disabled={busy}
                  onClick={() => { onSelectVersion(picked.version); setSel(null); }}>
            Check out take {picked.version} — no re-render
          </button>
        </div>
      )}

      {picked && picked.version === headN && (
        <div className="mono-label" style={{ marginTop: 10 }}>
          Take {headN} is already checked out. Pick an older take to diff against it.
        </div>
      )}
    </div>
  );
}
