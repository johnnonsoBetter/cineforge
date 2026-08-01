import { EDIT_CHANGE_LABEL, KIND_LABEL, timeAgo } from './ui.js';

// The applied-edit log, above the composer. Every row is one change that was written to the
// graph: what you actually asked for, what it touched, and when. Undo is LIFO — only the most
// recent change that is still standing can be reversed — so exactly one row carries the button
// and the rest read as history. Styled with Tailwind utilities over the project's tokens.
export default function EditHistory({ history, busy, onFocusNode, onUndo }) {
  if (!history.length) return null;
  const recent = history.slice(-6).reverse();
  const latestActive = [...history].reverse().find((edit) => !edit.undone_at);

  return (
    <details open className="edits">
      <summary className="edits-head">
        <span>Edit history</span>
        <em className="edits-count">{history.length}</em>
      </summary>

      <ol className="edits-list">
        {recent.map((edit) => {
          const undone = !!edit.undone_at;
          const canUndo = !undone && edit.edit_id === latestActive?.edit_id;
          // The instruction is the director's own words — far more recognisable than the
          // generic summary. Renames and undos carry no note, so they fall back to it.
          const line = edit.instruction?.trim() || edit.summary;

          return (
            <li key={edit.edit_id}
                className={`edit-row ${canUndo ? 'active' : ''} ${undone ? 'undone' : ''}`}>
              <button onClick={() => onFocusNode(edit.target_node_id)}
                      title="Show what this changed on the canvas"
                      className="edit-main">
                <span className="edit-line">{line}</span>
                <span className="edit-meta">
                  <em className="edit-tag">{EDIT_CHANGE_LABEL[edit.change] || edit.change}</em>
                  <em className="edit-target">{edit.target_title || KIND_LABEL[edit.target_kind]}</em>
                  <em className="edit-when">{undone ? 'undone' : timeAgo(edit.created_at)}</em>
                </span>
              </button>

              {canUndo && (
                <button disabled={busy} onClick={() => onUndo(edit)}
                        title={edit.rendered ? 'Preview undoing this — it re-renders' : 'Undo this change'}
                        className="edit-undo">
                  Undo
                </button>
              )}
            </li>
          );
        })}
      </ol>

      {latestActive && (
        <p className="edits-note">Only the most recent change can be undone.</p>
      )}
    </details>
  );
}
