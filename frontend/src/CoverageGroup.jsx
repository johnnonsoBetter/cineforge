import { memo } from 'react';

// The frame drawn behind a set of cards that belong together — a master frame's fan of
// shots, or the cast, or the locations. It carries no interaction of its own: it is the
// container that says "these read as one set", so the eye groups them instead of scanning a
// stack of loose cards. Sized in pixels by the layout to enclose the whole grid, with a
// header strip in the room left above the first card.
//
// Defaults describe the shot-coverage case it was born for; `label`/`countNoun` retarget it
// for the Cast and Locations groups without a second component.
function CoverageGroupImpl({ data }) {
  const { width, height, count, frameTitle, label = 'Coverage', countNoun = 'shots', variant } = data;
  return (
    <div className={`coverage-group${variant ? ` ${variant}-group` : ''}`} style={{ width, height }}>
      <div className="coverage-group-head">
        <span className="cg-kind">{label}</span>
        {frameTitle && <span className="cg-scene">{frameTitle}</span>}
        <span className="cg-count">{count} {countNoun}</span>
      </div>
    </div>
  );
}

export const CoverageGroup = memo(CoverageGroupImpl);
