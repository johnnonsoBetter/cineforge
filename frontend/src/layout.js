// Turns the project graph into a positioned React Flow graph.
//
// The film reads left to right, the way it was made:
//   story → cast + locations → scenes → keyframes → shots → final cut
// Scene, keyframe and shot share a row per scene, so each scene's chain reads as one line.

import { nodeStats } from './stats.js';

const KIND_COL = {
  story: 0,
  character: 1,
  environment: 1,
  scene: 2,
  keyframe: 3,
  shot: 4,
  timeline: 5,
};

export const COL_W = 372;
// A full card (thumbnail + 3-line description + tags + QC line) runs ~350px, so rows have to
// clear that before any gap reads as a gap.
export const ROW_H = 384;
// Extra rows inserted between one scene's band of frames and the next, so the frames of a
// scene read as one group instead of one unbroken column.
const SCENE_GAP = 0.45;

const kindOf = (n) => n.kind;

export function buildGraph(nodeList, { selectedId, impactIds, onAddShot } = {}) {
  const impact = impactIds || new Set();
  const focusing = impact.size > 0;
  const byId = new Map(nodeList.map((n) => [n.node_id, n]));
  const row = new Map(); // node_id -> row index

  const chars = nodeList.filter((n) => kindOf(n) === 'character');
  const envs = nodeList.filter((n) => kindOf(n) === 'environment');
  const scenes = nodeList.filter((n) => kindOf(n) === 'scene');

  chars.forEach((n, i) => row.set(n.node_id, i));
  envs.forEach((n, i) => row.set(n.node_id, chars.length + i));

  // Scenes keep the order the director planned them in.
  const ordered = [...scenes].sort(
    (a, b) => (a.data?.n ?? 0) - (b.data?.n ?? 0)
  );

  // A scene is one master frame covered from several setups, so the band it owns is as
  // tall as its *coverage*: the shots fan out to the right of a single keyframe, and the
  // scene and its frame both sit level with the middle of that fan.
  const shotsOf = new Map();   // keyframeId -> its shots, in setup order
  const frameOf = new Map();   // sceneId -> its master keyframe
  for (const n of nodeList) {
    if (kindOf(n) === 'keyframe') {
      const sid = (n.parent_ids || []).find((p) => byId.get(p)?.kind === 'scene');
      if (sid) frameOf.set(sid, n);
    } else if (kindOf(n) === 'shot') {
      const kid = (n.parent_ids || []).find((p) => byId.get(p)?.kind === 'keyframe');
      if (!kid) continue;
      if (!shotsOf.has(kid)) shotsOf.set(kid, []);
      shotsOf.get(kid).push(n);
    }
  }
  for (const list of shotsOf.values()) {
    list.sort((a, b) => (a.data?.i ?? 0) - (b.data?.i ?? 0));
  }

  let cursor = 0;
  for (const s of ordered) {
    const kf = frameOf.get(s.node_id);
    const shots = (kf && shotsOf.get(kf.node_id)) || [];
    const span = Math.max(shots.length, 1);
    const middle = cursor + (span - 1) / 2;
    row.set(s.node_id, middle);
    if (kf) row.set(kf.node_id, middle);
    shots.forEach((sh, i) => row.set(sh.node_id, cursor + i));
    cursor += span + SCENE_GAP;
  }
  // The last scene adds no trailing gap, so nothing below it is centred against dead space.
  const sceneRows = ordered.length ? cursor - SCENE_GAP : cursor;

  // Story sits centred against the cast column; the final cut against the whole scene stack.
  const castRows = Math.max(chars.length + envs.length, 1);
  nodeList.forEach((n) => {
    if (kindOf(n) === 'story') row.set(n.node_id, (castRows - 1) / 2);
    if (kindOf(n) === 'timeline') row.set(n.node_id, (Math.max(sceneRows, 1) - 1) / 2);
  });

  // With something selected the canvas splits in three: the node itself, what depends on
  // it, and everything the change can't reach. Dimming the third is what makes the blast
  // radius legible at a glance.
  const focusClass = (id) => {
    if (!focusing) return '';
    if (id === selectedId) return 'focus-root';
    return impact.has(id) ? 'focus-impact' : 'focus-dim';
  };

  const rfNodes = nodeList.map((n) => ({
    id: n.node_id,
    type: 'cine',
    position: {
      x: (KIND_COL[n.kind] ?? 0) * COL_W,
      y: (row.get(n.node_id) ?? 0) * ROW_H,
    },
    data: { node: n, impacted: impact.has(n.node_id), stats: nodeStats(n, nodeList), onAddShot },
    className: focusClass(n.node_id),
    selected: n.node_id === selectedId,
    draggable: true,
  }));

  const rfEdges = [];
  for (const n of nodeList) {
    for (const pid of n.parent_ids || []) {
      if (!byId.has(pid)) continue;
      // An edge is "in the blast radius" when the change actually flows down it.
      const carries = focusing && impact.has(n.node_id)
        && (pid === selectedId || impact.has(pid));
      const state = n.status === 'running' ? 'live' : n.status === 'stale' ? 'stale' : '';
      rfEdges.push({
        id: `${pid}->${n.node_id}`,
        source: pid,
        target: n.node_id,
        type: 'bezier',
        className: [state, focusing ? (carries ? 'focus-impact' : 'focus-dim') : '']
          .filter(Boolean).join(' '),
        animated: n.status === 'running' || carries,
      });
    }
  }

  return { rfNodes, rfEdges };
}
