import { useEffect, useMemo, useRef, useState } from 'react';
import Monitor from './Monitor.jsx';
import EditProposal from './EditProposal.jsx';
import EditHistory from './EditHistory.jsx';
import RegenMenu from './RegenMenu.jsx';
import MentionMenu from './MentionMenu.jsx';
import { KIND_LABEL } from './ui.js';
import {
  allEntries, connectedEntries, filterEntries, mentionRange, applyMention, liveRefs, labelOf,
} from './mentions.js';

// The Creative Director conversation. Streams stage lines while the pipeline runs,
// keeps the director/user turns, and hosts the conversational-edit composer.
export default function Rail({ messages, canEdit, nodes, targetNode, onClearTarget, onFocusNode,
                               onPropose, proposal, onApplyProposal, onDiscardProposal,
                               editHistory, onUndoEdit,
                               busy, progress, current, stages,
                               openGate, onApproveStage, onHoldStage, onSelectNode,
                               impact, onRegenerate, onToggleLock }) {
  const [draft, setDraft] = useState('');
  const [caret, setCaret] = useState(0);
  const [refs, setRefs] = useState([]);        // [{ nodeId, label, kind }] mentioned in the draft
  const [scopeId, setScopeId] = useState(null); // drilled into this node's connections
  const [cursor, setCursor] = useState(0);
  const [dismissedAt, setDismissedAt] = useState(null);
  const [proposing, setProposing] = useState(false);
  const logRef = useRef(null);
  const taRef = useRef(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const range = canEdit ? mentionRange(draft, caret) : null;
  const scope = useMemo(
    () => (scopeId ? nodes.find((n) => n.node_id === scopeId) : null),
    [nodes, scopeId]
  );

  // Inside a scope the connected set is the shortlist; if the query finds nothing there the
  // whole graph answers instead, so a reference is never a dead end.
  const entries = useMemo(() => {
    if (!range) return [];
    const all = allEntries(nodes);
    if (!scope) return filterEntries(all, range.query);
    const near = filterEntries(connectedEntries(nodes, scope.node_id), range.query);
    return near.length ? near : filterEntries(all, range.query);
  }, [nodes, scope, range?.query, range?.start]);

  // Only nodes that actually lead somewhere get the drill affordance.
  const drillable = useMemo(() => {
    const set = new Set();
    for (const e of entries) {
      if (connectedEntries(nodes, e.nodeId).length) set.add(e.nodeId);
    }
    return set;
  }, [entries, nodes]);

  const composerLocked = busy || proposing || !!proposal;
  const open = !!range && entries.length > 0 && range.start !== dismissedAt && !composerLocked;
  const active = entries[Math.min(cursor, entries.length - 1)] || null;

  useEffect(() => { setCursor(0); }, [range?.query, scopeId]);

  const shownRefs = useMemo(() => liveRefs(draft, refs), [draft, refs]);

  const sync = (el) => setCaret(el.selectionStart ?? el.value.length);

  const write = (text, nextCaret) => {
    setDraft(text);
    setCaret(nextCaret);
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const change = (e) => {
    const next = e.target.value;
    const nextCaret = e.target.selectionStart ?? next.length;
    const before = mentionRange(draft, caret);
    const after = mentionRange(next, nextCaret);
    // Opening the picker with a scene already selected on the canvas starts you inside that
    // scene: "@" right after clicking scene 3 should mean "something in scene 3".
    if (after && !before) setScopeId(targetNode ? targetNode.node_id : null);
    if (!after) setScopeId(null);
    setDismissedAt(null);
    setDraft(next);
    setCaret(nextCaret);
  };

  const pick = (entry) => {
    if (!range) return;
    const { text, caret: c } = applyMention(draft, range, entry.label);
    setRefs((prev) => [...prev, { nodeId: entry.nodeId, label: entry.label, kind: entry.kind }]);
    setScopeId(null);
    // The token is settled — the label it was completed with would otherwise keep matching
    // itself and leave the picker sitting open over the rest of the sentence.
    setDismissedAt(range.start);
    write(text, c);
  };

  // Entering a scope clears what you typed to get there: the words that found the scene
  // would otherwise filter out most of what you drilled in to look at.
  const drill = (entry) => {
    setScopeId(entry.nodeId);
    if (!range) return;
    const head = `${draft.slice(0, range.start)}@`;
    write(head + draft.slice(range.end), head.length);
  };

  const openPicker = () => {
    const el = taRef.current;
    const at = el?.selectionStart ?? draft.length;
    const pad = at > 0 && !/\s/.test(draft[at - 1]) ? ' ' : '';
    setScopeId(targetNode ? targetNode.node_id : null);
    setDismissedAt(null);
    write(`${draft.slice(0, at)}${pad}@${draft.slice(at)}`, at + pad.length + 1);
  };

  // Sending doesn't apply the note — it proposes it. The draft clears only after the note is
  // safely captured in the proposal card; failed requests leave the director's words intact.
  const send = async () => {
    const text = draft.trim();
    if (!text || composerLocked) return;
    setProposing(true);
    try {
      const accepted = await onPropose(text, liveRefs(text, refs));
      // Keep the note intact when routing or the request fails. Losing the director's words
      // on a network error makes the conversational surface feel unsafe.
      if (accepted) {
        setDraft('');
        setRefs([]);
        setScopeId(null);
        setCaret(0);
      }
    } finally {
      setProposing(false);
    }
  };

  const keyDown = (e) => {
    if (open) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCursor((c) => (c + 1) % entries.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((c) => (c - 1 + entries.length) % entries.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (active) pick(active);
        return;
      }
      if (e.key === 'ArrowRight' && active && drillable.has(active.nodeId)) {
        e.preventDefault();
        drill(active);
        return;
      }
      if (e.key === 'ArrowLeft' && scopeId) {
        e.preventDefault();
        setScopeId(null);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissedAt(range.start);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <div className="rail">
      <div className="rail-head">
        <div className="mono-label">Creative Director</div>
        <div className="rail-head-title">Orchestration is the product.</div>
      </div>

      <Monitor
        progress={progress}
        stages={stages}
        current={busy ? current : null}
        gate={openGate}
        busy={busy}
        onApprove={onApproveStage}
        onHold={onHoldStage}
        onSelectNode={onSelectNode}
      />

      <div className="rail-log" ref={logRef}>
        {messages.map((m) => (
          <div key={m.id} className={`msg msg-${m.role}`}>
            {m.role === 'stage' && <span className="dot" style={{ background: 'var(--gold-dim)' }} />}
            {m.text}
          </div>
        ))}
      </div>

      <div className="rail-foot">
        {targetNode && (
          <div className="target-chip">
            <span className="dot" style={{ background: 'var(--gold)' }} />
            Editing: {targetNode.title}
            <button onClick={onClearTarget} title="Clear target" aria-label="Clear edit target">✕</button>
          </div>
        )}

        {/* What the note is actually aimed at, spelled out before it is sent — an @-ref is
            only worth typing if you can see it landed. */}
        {shownRefs.length > 0 && (
          <div className="ref-chips">
            {shownRefs.map((r) => (
              <button key={r.nodeId} className="ref-chip" onClick={() => onFocusNode(r.nodeId)}
                      title={`Show ${r.label} on the canvas`}>
                <span>@{r.label}</span>
                <em>{KIND_LABEL[r.kind] || r.kind}</em>
              </button>
            ))}
          </div>
        )}

        {/* The note doesn't fire — it lands here as a proposal, above the input it came from,
            and waits for the director to approve, edit or drop it. */}
        {proposal && (
          <EditProposal
            proposal={proposal}
            busy={busy}
            onApply={onApplyProposal}
            onDiscard={onDiscardProposal}
            onFocusNode={onFocusNode}
          />
        )}

        <EditHistory
          history={editHistory}
          busy={busy || proposing || !!proposal}
          onFocusNode={onFocusNode}
          onUndo={onUndoEdit}
        />

        {/* The regeneration surface, shown only when a rendered entity is selected: what a
            redo would re-render, which of it to skip this pass, and the redo itself — on the
            same layer as the conversation, just above the input it belongs with. */}
        {targetNode && canEdit && (
          <RegenMenu
            node={targetNode}
            impact={impact}
            busy={busy}
            onRegenerate={onRegenerate}
            onToggleLock={onToggleLock}
          />
        )}

        <div className="composer-wrap">
          {open && (
            <MentionMenu
              entries={entries}
              cursor={Math.min(cursor, entries.length - 1)}
              scope={scope ? { label: labelOf(scope) } : null}
              drillable={drillable}
              onPick={pick}
              onDrill={drill}
              onBack={() => setScopeId(null)}
              onHover={setCursor}
            />
          )}
          <div className="composer">
            <textarea
              ref={taRef}
              rows={1}
              value={draft}
              placeholder={canEdit
                ? (proposal ? 'Review or discard the proposal above before adding another note…'
                  : proposing ? 'Reading your note…'
                  : targetNode ? `Change “${targetNode.title}” — or @ to reference…` : 'Describe a change — type @ to reference a scene, character or shot…')
                : 'Forge a film first…'}
              disabled={!canEdit || composerLocked}
              aria-label="Describe an edit"
              onChange={change}
              onKeyDown={keyDown}
              onKeyUp={(e) => sync(e.target)}
              onClick={(e) => sync(e.target)}
              onBlur={() => setDismissedAt(range ? range.start : null)}
            />
            <button className="composer-at" onClick={openPicker} disabled={!canEdit || composerLocked}
                    title="Reference a scene, character or shot" aria-label="Reference a scene, character, or shot">
              @
            </button>
            <button className={`composer-send ${draft.trim() && canEdit && !composerLocked ? 'on' : ''}`} onClick={send} disabled={!canEdit || composerLocked || !draft.trim()}
                    title="Preview edit" aria-label="Preview edit">
              {proposing ? '…' : '↑'}
            </button>
          </div>
        </div>

        <div className="rail-hint">
          {proposal
            ? 'Nothing has changed yet. Review the target, wording, and render impact above.'
            : proposing
              ? 'Reading the note and calculating its render impact…'
              : canEdit
            ? 'Type @ to reference a scene, character or shot — press → on a scene to see everything connected to it. Only affected shots re-render.'
            : 'Conversational edits unlock once the film is built.'}
        </div>
      </div>
    </div>
  );
}
