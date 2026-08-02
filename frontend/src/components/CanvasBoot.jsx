import { useEffect, useState } from 'react';
import Logo from './Logo.jsx';

// The studio floor's empty state. The idea now enters on the landing composer, so arriving
// here means one of two things: a forge is spinning up (show the canvas booting), or the
// canvas is genuinely clear (send the director back to author a new film).
const BOOT_LINES = [
  'Reading your idea',
  'Assembling the canvas',
  'Waking the director',
  'Priming the pipeline',
];

export default function CanvasBoot({ booting = true, onNew }) {
  const [i, setI] = useState(0);

  useEffect(() => {
    if (!booting) return;
    const t = setInterval(() => setI((n) => (n + 1) % BOOT_LINES.length), 1800);
    return () => clearInterval(t);
  }, [booting]);

  return (
    <div className="cf-boot">
      <div className="cf-boot-inner">
        <div className="cf-boot-mark">
          <div className="cf-boot-ring" aria-hidden />
          <Logo variant="icon" className="cf-boot-logo" />
        </div>

        {booting ? (
          <>
            <div className="cf-boot-title">Starting up your canvas</div>
            <div className="cf-boot-status">
              <span className="cf-boot-dot" />
              {BOOT_LINES[i]}…
            </div>
            <div className="cf-boot-bar"><span /></div>
          </>
        ) : (
          <>
            <div className="cf-boot-title">Your canvas is clear</div>
            <div className="cf-boot-sub">
              Head back to the studio floor to forge a new film from a single idea.
            </div>
            {onNew && (
              <button className="cf-forge-btn cf-boot-btn" onClick={onNew}>
                Start a new film →
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
