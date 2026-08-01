import { useMemo, useState } from 'react';
import { SHOT_SECONDS } from './ui.js';

// Author the timelined dialogue that gets lip-synced into this shot's clip. A shot is one 8s
// take, so every line is a spoken beat placed at an offset inside that window and mouth-edited
// in at its `start` — distinct from a scene voiceover, which is narration laid over the whole
// clip. Saving posts the whole cue list; clearing it (empty list) reverts to the clean plate.
//
// This is authoring only: it writes shot.data.dialogue and streams the re-sync. It never
// re-renders the animation — the clip is already shot, the mouth is edited on top of it.

let _seq = 0;
const withKeys = (cues) => cues.map((c) => ({ _k: ++_seq, character: '', text: '', start: 0, ...c }));
const strip = (rows) => rows.map(({ _k, ...c }) => ({ ...c, text: c.text.trim() }));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export default function DialogueEditor({ node, onSetDialogue, busy }) {
  const dur = node.asset?.duration_sec || SHOT_SECONDS;
  const saved = useMemo(() => (node.data?.dialogue || []).map((c) => ({
    character: c.character || '', text: c.text || '', start: c.start || 0,
    ...(c.voice_id ? { voice_id: c.voice_id } : {}),
  })), [node.data?.dialogue]);

  const [rows, setRows] = useState(() => withKeys(saved));
  const rendered = !!node.asset?.url;

  const filled = strip(rows).filter((c) => c.text);
  const dirty = !same(filled, saved);

  const set = (k, field, value) =>
    setRows((rs) => rs.map((r) => (r._k === k ? { ...r, [field]: value } : r)));
  const add = () => setRows((rs) => [...rs, { _k: ++_seq, character: '', text: '', start: 0 }]);
  const remove = (k) => setRows((rs) => rs.filter((r) => r._k !== k));

  const save = () => { if (!busy && dirty) onSetDialogue(node.node_id, filled); };
  const clearAll = () => { if (!busy) { setRows([]); onSetDialogue(node.node_id, []); } };

  return (
    <div className="insp-section" style={{ borderBottom: 'none' }}>
      <h3>Dialogue <span className="mono-label">· lip-synced into the clip</span></h3>

      {!rendered && (
        <div className="mono-label" style={{ margin: '4px 0 10px' }}>
          This shot hasn’t rendered yet — its clip has to exist before a line can be synced onto it.
        </div>
      )}

      {/* The 8s take, laid flat: every line is a marker at its start, so a director sees where
          each beat lands before spending anything to hear it. */}
      <div className="dlg-track" title={`${dur}s shot`}>
        {filled.map((c, i) => (
          <span key={i} className="dlg-tick"
                style={{ left: `${Math.min(100, (c.start / dur) * 100)}%` }}
                title={`${c.start.toFixed(1)}s — ${c.character || 'line'}`} />
        ))}
        <span className="dlg-track-end mono-label">{dur}s</span>
      </div>

      <div className="dlg-rows">
        {rows.map((r) => (
          <div className="dlg-row" key={r._k}>
            <div className="dlg-row-head">
              <input className="dlg-who" placeholder="Character"
                     value={r.character} disabled={busy}
                     onChange={(e) => set(r._k, 'character', e.target.value)} />
              <label className="dlg-at mono-label">
                at
                <input type="number" min="0" max={dur} step="0.5" value={r.start} disabled={busy}
                       onChange={(e) => set(r._k, 'start', Math.max(0, Number(e.target.value) || 0))} />
                s
              </label>
              <button className="dlg-del" title="Remove line" disabled={busy}
                      onClick={() => remove(r._k)}>✕</button>
            </div>
            <textarea className="shot-note" rows={2} placeholder="What they say…"
                      value={r.text} disabled={busy}
                      onChange={(e) => set(r._k, 'text', e.target.value)} />
          </div>
        ))}
      </div>

      <button className="dlg-add" onClick={add} disabled={busy}>+ Line</button>

      <div className="dlg-foot">
        <span className="mono-label">
          {filled.length} line{filled.length === 1 ? '' : 's'}
          {filled.length ? ' · one voice + one sync each' : ' · nothing to sync'}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          {saved.length > 0 && (
            <button className="btn" onClick={clearAll} disabled={busy}>Clear</button>
          )}
          <button className="btn-gold" onClick={save} disabled={busy || !dirty || !rendered}>
            {busy ? 'Syncing…' : 'Sync dialogue'}
          </button>
        </div>
      </div>
    </div>
  );
}
