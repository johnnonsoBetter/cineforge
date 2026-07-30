import { useEffect, useRef } from 'react';

// Right-click actions for a node.
//
// Only actions the graph can actually perform are listed. A menu that offers Duplicate or
// Delete and then does nothing is worse than a shorter menu.
export default function ContextMenu({ x, y, node, busy, onClose, onInspect, onRegenerate,
                                      onToggleLock }) {
  const ref = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  const canRegen = ['character', 'environment', 'scene', 'keyframe', 'shot'].includes(node.kind);
  const takes = node.versions?.length || 0;

  const run = (fn) => () => { onClose(); fn(); };

  const items = [
    ['Inspect', run(onInspect), false],
    canRegen && [
      node.locked ? 'Locked — unlock to regenerate' : 'Regenerate',
      run(() => onRegenerate(node)),
      busy || node.locked,
    ],
    takes > 1 && [`Compare ${takes} takes`, run(onInspect), false],
    node.asset && [node.locked ? 'Unlock' : 'Lock this version', run(() => onToggleLock(!node.locked)), false],
  ].filter(Boolean);

  // Keep the menu on screen when the click lands near an edge.
  const style = {
    left: Math.min(x, window.innerWidth - 210),
    top: Math.min(y, window.innerHeight - items.length * 32 - 44),
  };

  return (
    <div className="ctx" style={style} ref={ref}>
      <div className="ctx-head">{node.title}</div>
      {items.map(([label, onClick, disabled]) => (
        <button key={label} className="ctx-item" onClick={onClick} disabled={disabled}>
          {label}
        </button>
      ))}
    </div>
  );
}
