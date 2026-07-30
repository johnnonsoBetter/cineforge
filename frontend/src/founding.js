// The compact metadata signature for a founding-reference node face.
//
// CHARACTER and ENVIRONMENT are the sheets stage's founding references — the two nodes every
// downstream frame inherits. Their canvas face is deliberately austere: a thumb, a tagline,
// and this strip, nothing else. The four detail layers (creative / production / pipeline /
// storage) live in the Inspector on selection.
//
// The face carries only the three cells a director actually scans for — how far the reference
// has come (status + version), whether its pixels are trusted (manifest), and whether it is
// held (lock). The pipeline step and the content-addressed storage note are provenance, not
// scanning signal, so they fold into the status cell's tooltip rather than eating a column.
// Every value is read off the graph node — none is estimated.

import { STATUS_LABEL, statusColor } from './ui.js';

export function foundingFooter(node) {
  const { kind, status, locked, asset, versions = [], accepted_version } = node;
  const prov = asset?.provenance || {};

  // The entity-specific pipeline step that produced this reference. A character is a sheet;
  // a location is a plate — same skeleton, different orthographic identity view.
  const step = kind === 'environment' ? 'plate' : 'sheet';

  // The honesty ladder, condensed to where this node actually sits right now:
  //   no asset yet        → synthesized (planned in the bible, nothing rendered)
  //   asset, not verified → unverified  (rendered + manifested, pixels not checked)
  //   verified            → verified    (manifest checked against the pixels)
  const manifest = !asset
    ? { label: 'synthesized', color: 'var(--faint)' }
    : prov.verified
      ? { label: 'verified', color: 'var(--green)' }
      : { label: 'unverified', color: 'var(--amber)' };

  const ver = accepted_version ? `v${accepted_version}` : '—';
  const takes = versions.length > 1 ? ` · ${versions.length} takes` : '';

  return [
    {
      // Status and version read as one thing — "how far has this come" — so they share a cell.
      // Step and content-addressed storage ride in the tooltip; they are provenance, not scan.
      key: 'status',
      label: `${STATUS_LABEL[status] || status} · ${ver}`,
      color: statusColor(status),
      mark: status === 'running' ? 'spinner' : 'dot',
      title: `${step} · content-addressed${takes}`,
    },
    {
      key: 'manifest',
      label: manifest.label,
      color: manifest.color,
      title: 'Manifest state: synthesized (planned) → unverified (rendered) → verified (manifest checked against the pixels).',
    },
    {
      key: 'lock',
      label: locked ? 'locked' : 'open',
      color: locked ? 'var(--gold)' : 'var(--faint)',
      title: locked ? 'Locked — regeneration skips this reference, holding the identity every frame is matched against.' : 'Unlocked — regeneration may replace this version.',
    },
  ];
}
