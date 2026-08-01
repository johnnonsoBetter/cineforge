import { useEffect, useRef, useState } from 'react';
import * as api from './api.js';

// Bring-your-own Genblaze key. Opens two ways: on its own from the toolbar, or automatically
// when a run hits the shared preview's credit wall (`reason="wall"`, which swaps in the copy
// that explains why it appeared). The key is stored server-side, encrypted, per account — this
// dialog only ever POSTs it up or reads back whether one is on file.
export default function KeyDialog({ reason = 'manual', status, onClose, onSaved }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const ref = useRef(null);
  const inputRef = useRef(null);
  const hasKey = Boolean(status?.has_key);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    const previous = document.activeElement;
    inputRef.current?.focus();
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus?.(); };
  }, [onClose]);

  const save = async () => {
    const k = key.trim();
    if (!k || busy) return;
    setBusy(true); setErr(null);
    try {
      const res = await api.setGenblazeKey(k);
      onSaved?.(res); // { has_key, masked } — parent closes and offers to resume
    } catch (e) {
      setErr(e.message || 'Could not save that key.');
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      await api.clearGenblazeKey();
      onSaved?.({ has_key: false, masked: null });
    } catch (e) {
      setErr(e.message || 'Could not remove that key.');
      setBusy(false);
    }
  };

  return (
    <div className="shot-dialog-layer" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="shot-dialog keyvault-dialog" ref={ref} role="dialog" aria-modal="true"
           aria-labelledby="key-dialog-title" aria-describedby="key-dialog-intro">
        <div className="shot-dialog-head">
          <div>
            <span className="mono-label">Your key</span>
            <strong id="key-dialog-title">
              {reason === 'wall' ? 'Out of preview credits' : 'Bring your own Genblaze key'}
            </strong>
          </div>
          <span className="shot-mode-badge">GMICloud</span>
          <button className="insp-close" onClick={onClose} title="Close"
                  aria-label="Close key dialog">✕</button>
        </div>

        <div className="shot-dialog-body">
          <p className="shot-dialog-intro" id="key-dialog-intro">
            {reason === 'wall'
              ? "The shared preview just ran out of generation credits. Paste your own GMICloud (Genblaze) key and your films render for real on your own credits — no waiting on the shared pool."
              : "Paste your own GMICloud (Genblaze) key to render image and video for real on your own credits, past the shared preview's limit. It's stored encrypted and used only for your renders."}
          </p>

          {hasKey && (
            <div className="suggest-why">
              <span className="mono-label">On file · {status.masked}</span>
              <span> — new renders already use your key. Replace it below, or remove it to fall back to the shared preview.</span>
            </div>
          )}

          <div className="shot-row">
            <span className="mono-label">Genblaze key</span>
            <input
              ref={inputRef}
              type="password"
              className="key-input"
              placeholder={hasKey ? 'Paste a new key to replace…' : 'sk-… / your GMICloud key'}
              value={key}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
            />
          </div>

          <p className="key-hint">
            Get a key at <span className="mono-label">console.gmicloud.ai</span>. We never display it back — only the last four characters.
          </p>

          {err && <div className="suggest-why bad"><span>{err}</span></div>}
        </div>

        <div className="shot-dialog-foot">
          {hasKey && (
            <button className="btn" onClick={remove} disabled={busy}>Remove key</button>
          )}
          <div className="topbar-spacer" />
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-gold" onClick={save} disabled={busy || !key.trim()}>
            {busy ? 'Saving…' : hasKey ? 'Replace key' : 'Save & continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
