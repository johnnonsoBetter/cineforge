import { EDIT_CHANGE_LABEL, KIND_LABEL, timeAgo } from './ui.js';

// The applied-edit log, above the composer. Every row is one change that was written to the
// graph: what you actually asked for, what it touched, and when. Undo is LIFO — only the most
// recent change that is still standing can be reversed — so exactly one row carries the button
// and the rest read as history. Styled with Tailwind utilities over the project's tokens.
export default function EditHistory({ history, busy, onFocusNode, onUndo }) {
  if (!history.length) return null;
  const recent = history.slice(-6).reverse();
  const latestActive = [...history].reverse().find((edit) => !edit.undone_at);

  const meta = 'not-italic font-mono text-[9px] uppercase tracking-[0.05em]';

  return (
    <details open className="mb-3 rounded-[10px] border border-line bg-[rgba(0,0,0,0.14)]">
      <summary className="flex min-h-[40px] cursor-pointer list-none items-center justify-between px-3 font-mono text-[10px] uppercase tracking-[0.08em] text-muted [&::-webkit-details-marker]:hidden">
        <span>Edit history</span>
        <em className="not-italic text-gold">{history.length}</em>
      </summary>

      <ol className="m-0 grid list-none gap-1.5 p-2">
        {recent.map((edit) => {
          const undone = !!edit.undone_at;
          const canUndo = !undone && edit.edit_id === latestActive?.edit_id;
          // The instruction is the director's own words — far more recognisable than the
          // generic summary. Renames and undos carry no note, so they fall back to it.
          const line = edit.instruction?.trim() || edit.summary;
          const shell = canUndo
            ? 'border-[rgba(212,175,122,0.4)] bg-[rgba(212,175,122,0.06)]'
            : `border-line bg-[rgba(0,0,0,0.16)]${undone ? ' opacity-60' : ''}`;

          return (
            <li key={edit.edit_id}
                className={`flex items-stretch gap-1.5 overflow-hidden rounded-lg border transition-colors ${shell}`}>
              <button onClick={() => onFocusNode(edit.target_node_id)}
                      title="Show what this changed on the canvas"
                      className="min-w-0 flex-1 px-2.5 py-2 text-left text-cream">
                <span className={`block truncate text-[12.5px] leading-snug${undone ? ' text-faint line-through' : ''}`}>
                  {line}
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-1.5">
                  <em className={`${meta} rounded-full px-1.5 py-px ${undone ? 'bg-[rgba(255,255,255,0.06)] text-faint' : 'bg-[rgba(212,175,122,0.14)] text-gold'}`}>
                    {EDIT_CHANGE_LABEL[edit.change] || edit.change}
                  </em>
                  <em className={`${meta} min-w-0 max-w-[40%] truncate text-muted`}>
                    {edit.target_title || KIND_LABEL[edit.target_kind]}
                  </em>
                  <em className={`${meta} ml-auto text-faint`}>
                    {undone ? 'undone' : timeAgo(edit.created_at)}
                  </em>
                </span>
              </button>

              {canUndo && (
                <button disabled={busy} onClick={() => onUndo(edit)}
                        title={edit.rendered ? 'Preview undoing this — it re-renders' : 'Undo this change'}
                        className="min-w-[56px] flex-none border-l border-line font-mono text-[10px] uppercase tracking-[0.06em] text-gold transition-colors enabled:hover:bg-[rgba(212,175,122,0.12)] enabled:hover:text-cream disabled:text-faint">
                  Undo
                </button>
              )}
            </li>
          );
        })}
      </ol>

      {latestActive && (
        <p className="m-0 px-3 pb-2.5 font-mono text-[9px] uppercase tracking-[0.04em] text-faint">
          Only the most recent change can be undone.
        </p>
      )}
    </details>
  );
}
