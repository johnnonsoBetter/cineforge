import { useEffect, useRef } from 'react';
import { KIND_LABEL, statusColor } from './ui.js';
import { groupEntries } from './mentions.js';

// The @-picker over the composer. Presentational: the composer owns the query, the scope
// and the highlighted index, because the keyboard has to keep working while focus stays in
// the textarea — a picker that steals focus can't filter as you type.
export default function MentionMenu({ entries, cursor, scope, drillable, onPick, onDrill,
                                      onBack, onHover }) {
  const listRef = useRef(null);
  const groups = groupEntries(entries);

  useEffect(() => {
    listRef.current?.querySelector('.mention-row.on')?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  return (
    <div className="mention-menu" onMouseDown={(e) => e.preventDefault()}>
      {scope && (
        <button className="mention-scope" onClick={onBack} title="Back to everything">
          ← <strong>{scope.label}</strong>
          <span>connected</span>
        </button>
      )}

      <div className="mention-list" ref={listRef}>
        {groups.map((g) => (
          <div className="mention-group" key={g.kind}>
            <div className="mention-group-title">{g.title}</div>
            {g.items.map(({ entry, index }) => (
              <div
                key={entry.nodeId}
                className={`mention-row ${index === cursor ? 'on' : ''}`}
                onMouseEnter={() => onHover(index)}
                onClick={() => onPick(entry)}
              >
                <span className={`mention-thumb ${entry.thumb ? '' : 'empty'}`}>
                  {entry.thumb
                    ? <img src={entry.thumb} alt="" loading="lazy" draggable={false} />
                    : <span className="dot" style={{ background: statusColor(entry.status) }} />}
                </span>
                <span className="mention-text">
                  <span className="mention-label">
                    {entry.label}
                    <em>{KIND_LABEL[entry.kind] || entry.kind}</em>
                  </span>
                  {entry.sub && <span className="mention-sub">{entry.sub}</span>}
                </span>
                {/* Drilling in is the answer to "what is this scene actually made of" —
                    the graph knows, so the picker offers it rather than sending you to
                    the canvas to find out. */}
                {drillable.has(entry.nodeId) && (
                  <button
                    className="mention-drill"
                    title={`Show what ${entry.label} is connected to`}
                    onClick={(e) => { e.stopPropagation(); onDrill(entry); }}
                  >
                    ›
                  </button>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="mention-hint">
        ↑↓ move · ↵ insert · → connected · {scope ? '← back' : 'esc close'}
      </div>
    </div>
  );
}
