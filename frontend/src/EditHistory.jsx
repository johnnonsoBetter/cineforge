import { KIND_LABEL } from './ui.js';

export default function EditHistory({ history, busy, onFocusNode, onUndo }) {
  if (!history.length) return null;
  const recent = history.slice(-5).reverse();
  const latestActive = [...history].reverse().find((edit) => !edit.undone_at);

  return (
    <details className="edit-history">
      <summary>
        <span>Edit history</span>
        <em>{history.length}</em>
      </summary>
      <ol>
        {recent.map((edit) => {
          const canUndo = !edit.undone_at && edit.edit_id === latestActive?.edit_id;
          return (
            <li key={edit.edit_id} className={edit.undone_at ? 'undone' : ''}>
              <button className="history-copy" onClick={() => onFocusNode(edit.target_node_id)}>
                <span>{edit.summary}</span>
                <em>{KIND_LABEL[edit.target_kind] || edit.target_kind}{edit.undone_at ? ' · undone' : ''}</em>
              </button>
              {canUndo && (
                <button className="history-undo" disabled={busy} onClick={() => onUndo(edit)}>
                  Undo
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </details>
  );
}
