// Turns the project graph into a positioned React Flow graph.
//
// The film reads left to right, the way it was made:
//   story → cast + locations → scenes → keyframes → shots → final cut
// A master frame is shot from one or more setups. Its shots lay out as a tidy grid to the
// right of the frame — coverage reads as a contact sheet, not an endless column — and when a
// frame carries more than one shot a coverage group is drawn behind that grid so the shots
// read as one cluster belonging to that frame. Frames themselves are never grouped.
//
// Positions are computed in pixels (not a shared row grid) because a compact shot card and a
// full keyframe card are very different heights: packing them on one row pitch would either
// overlap the tall cards or strand the short ones in dead space.

import { nodeStats } from './stats.js';

const COL_W = 372;                 // horizontal pitch of the columns
const CARD_W = 266;                // matches .node width in styles.css
const COL_GAP = COL_W - CARD_W;    // 106 — the gutter left between one column and the next
// Left edge of the fixed left-hand columns. Cast and locations share a column; scene,
// keyframe and shot columns are placed dynamically (see sceneX below) so they clear the cast
// grid, which is now two cards wide rather than one.
const COL_X = {
  story: 0,
  character: COL_W,
  environment: COL_W,
};

// Approximate rendered card heights, used only to centre a card in its band and to space the
// columns — the exact height isn't known until it renders, and the gaps below absorb the slack.
const KF_CARD_H = 410;             // full keyframe card (thumb + body + add-setup button)
const SHOT_CARD_H = 206;           // compact shot card (16:9 frame + two-line caption)
const SCENE_CARD_H = 372;
const CAST_CARD_H = 420;           // square floating cast sheet + tagline row; envs stack looser but clean
const TALL_CARD_H = 372;           // story / final-cut, for centring against their stacks

// The shot grid: a contact sheet of compact cards, two across.
const SHOT_COLS = 2;
const SHOT_GAP_X = 22;
const SHOT_GAP_Y = 26;
const CELL_W = CARD_W + SHOT_GAP_X;
const CELL_H = SHOT_CARD_H + SHOT_GAP_Y;

// Cast and locations each read as a titled grid inside a group frame — the same grammar the
// shot coverage uses, two cards across.
const GROUP_COLS = 2;
const CAST_CELL_W = CARD_W + SHOT_GAP_X;   // horizontal pitch of a cast/location grid

// Past a threshold, and only while no scene has been broken into keyframes yet, the scene
// column would be an endless spine of mostly-empty cards. So we tile many scenes into a
// compact grid instead — same grammar as the cast grid, sized for the shorter, image-less
// scene card. Once any scene fans out into keyframes/shots the column has to stay single so
// it can expand rightward, so the grid never applies then.
const SCENE_GRID_MIN = 7;          // grid kicks in above 6 scenes
const SCENE_GRID_COLS = 3;
const SCENE_TILE_H = 220;          // compact scene card: title + synopsis + tags + stats, no media
const SCENE_TILE_GAP_Y = 40;

// Vertical breathing room between siblings.
const KF_GAP = 46;                 // between frames of one scene
const SCENE_GAP = 72;              // between scenes
const CAST_GAP = 54;               // between cast / location cards, in a grid row/col
const CAST_GROUP_GAP = 46;         // between the cast frame and the locations frame

// The coverage frame drawn behind a grid of shots: header room on top, a hair everywhere else.
const GROUP_PAD_X = 20;
const GROUP_PAD_TOP = 54;
const GROUP_PAD_BOTTOM = 20;

const kindOf = (n) => n.kind;
const gridRowsFor = (n) => Math.ceil(n / SHOT_COLS);
const gridColsFor = (n) => Math.min(SHOT_COLS, n);
const gridWidth = (cols) => cols * CARD_W + (cols - 1) * SHOT_GAP_X;
const gridHeight = (rows) => rows * SHOT_CARD_H + (rows - 1) * SHOT_GAP_Y;

export function buildGraph(nodeList, { selectedId, impactIds, onAddShot, onAddKeyframe, phases } = {}) {
  const impact = impactIds || new Set();
  const focusing = impact.size > 0;
  const byId = new Map(nodeList.map((n) => [n.node_id, n]));
  const pos = new Map();  // node_id -> { x, y }

  const chars = nodeList.filter((n) => kindOf(n) === 'character');
  const envs = nodeList.filter((n) => kindOf(n) === 'environment');
  const scenes = nodeList.filter((n) => kindOf(n) === 'scene');

  // ---- cast + locations: each a titled grid inside its own group frame ----
  // Both share the same column; the cast frame sits above the locations frame. Members lay
  // out two across, so a film with a real ensemble reads as a contact sheet of the cast
  // rather than one long column.
  const castGroups = [];
  const buildCastGroup = (list, startY, label, countNoun) => {
    if (list.length === 0) return startY;
    const cols = Math.min(GROUP_COLS, list.length);
    const rows = Math.ceil(list.length / GROUP_COLS);
    const innerX = COL_X.character + GROUP_PAD_X;
    const innerY = startY + GROUP_PAD_TOP;
    list.forEach((n, i) => {
      pos.set(n.node_id, {
        x: innerX + (i % GROUP_COLS) * CAST_CELL_W,
        y: innerY + Math.floor(i / GROUP_COLS) * (CAST_CARD_H + CAST_GAP),
      });
    });
    const gW = cols * CARD_W + (cols - 1) * SHOT_GAP_X;
    const gH = rows * CAST_CARD_H + (rows - 1) * CAST_GAP;
    castGroups.push({
      x: COL_X.character, y: startY,
      width: gW + GROUP_PAD_X * 2,
      height: gH + GROUP_PAD_TOP + GROUP_PAD_BOTTOM,
      label, countNoun, count: list.length,
      members: list.map((n) => n.node_id),
    });
    return startY + gH + GROUP_PAD_TOP + GROUP_PAD_BOTTOM;
  };

  let cy = 0;
  cy = buildCastGroup(chars, cy, 'Cast', chars.length === 1 ? 'character' : 'characters');
  if (chars.length && envs.length) cy += CAST_GROUP_GAP;
  cy = buildCastGroup(envs, cy, 'Locations', envs.length === 1 ? 'location' : 'locations');
  const castH = cy;
  // How far right the cast region reaches — what the scene column has to clear.
  const castGridW = castGroups.reduce((w, g) => Math.max(w, g.width), 0);

  // The generation columns start after the cast grid rather than at a fixed multiple of
  // COL_W, so widening cast from one card to two doesn't collide with the scenes.
  const sceneX = COL_X.character + (castGridW || CARD_W) + COL_GAP;
  const keyframeX = sceneX + COL_W;
  const shotX = keyframeX + COL_W;

  // ---- scenes → frames → shot grids ----
  // A scene owns one or more master frames; each frame owns one or more shots laid out as a
  // grid. Every frame gets a band as tall as the taller of its card and its grid; the scene
  // centres on the whole stack of its frames' bands.
  const ordered = [...scenes].sort((a, b) => (a.data?.n ?? 0) - (b.data?.n ?? 0));

  const framesOf = new Map();  // sceneId -> keyframes, in plan order
  const shotsOf = new Map();   // keyframeId -> shots, in setup order
  for (const n of nodeList) {
    if (kindOf(n) === 'keyframe') {
      const sid = (n.parent_ids || []).find((p) => byId.get(p)?.kind === 'scene');
      if (!sid) continue;
      if (!framesOf.has(sid)) framesOf.set(sid, []);
      framesOf.get(sid).push(n);
    } else if (kindOf(n) === 'shot') {
      const kid = (n.parent_ids || []).find((p) => byId.get(p)?.kind === 'keyframe');
      if (!kid) continue;
      if (!shotsOf.has(kid)) shotsOf.set(kid, []);
      shotsOf.get(kid).push(n);
    }
  }
  const byI = (a, b) => (a.data?.i ?? 0) - (b.data?.i ?? 0);
  for (const list of framesOf.values()) list.sort(byI);
  for (const list of shotsOf.values()) list.sort(byI);

  // The scenes only earn a titled frame once there are enough of them to read as a set — a
  // handful of scenes stay loose. The decision is purely the scene count: it never depends on
  // the cast or any other entity. With the frame shown the stack starts below a header strip
  // (aligning the first scene with the first cast card); without it, scenes start at the top.
  const frameShown = scenes.length >= SCENE_GRID_MIN;
  const sceneGrid = frameShown && framesOf.size === 0;
  const sceneTop = frameShown ? GROUP_PAD_TOP : 0;

  const groups = [];       // coverage frames to draw behind a grid of shots
  let widestCols = 1;      // how far right the shots reach — the final cut sits beyond it
  let sceneH;
  let sceneFrameW = CARD_W;  // how wide the scene frame has to be — one card, or the grid

  if (sceneGrid) {
    // Compact tiled block: rows of SCENE_GRID_COLS. No keyframes exist yet, so nothing fans
    // out to the right and the grid is free to use the horizontal room.
    ordered.forEach((s, i) => {
      pos.set(s.node_id, {
        x: sceneX + (i % SCENE_GRID_COLS) * CELL_W,
        y: sceneTop + Math.floor(i / SCENE_GRID_COLS) * (SCENE_TILE_H + SCENE_TILE_GAP_Y),
      });
    });
    const cols = Math.min(SCENE_GRID_COLS, ordered.length);
    const rows = Math.ceil(ordered.length / SCENE_GRID_COLS);
    sceneFrameW = cols * CARD_W + (cols - 1) * SHOT_GAP_X;
    sceneH = sceneTop + rows * SCENE_TILE_H + (rows - 1) * SCENE_TILE_GAP_Y;
  } else {
    // Single column: each scene owns a band as tall as its frames' shot grids, and fans out
    // rightward into its keyframes and shots.
    let y = sceneTop;
    for (const s of ordered) {
      const frames = framesOf.get(s.node_id) || [];
      const bandStart = y;
      if (frames.length === 0) {
        pos.set(s.node_id, { x: sceneX, y });
        y += SCENE_CARD_H + SCENE_GAP;
        continue;
      }
      let firstFrameY = bandStart;
      frames.forEach((kf, fi) => {
        const shots = shotsOf.get(kf.node_id) || [];
        const n = Math.max(shots.length, 1);
        const cols = gridColsFor(n);
        const gH = gridHeight(gridRowsFor(n));
        const bandH = Math.max(KF_CARD_H, gH);
        widestCols = Math.max(widestCols, cols);

        const kfY = y + (bandH - KF_CARD_H) / 2;
        if (fi === 0) firstFrameY = kfY;
        pos.set(kf.node_id, { x: keyframeX, y: kfY });
        const gridTop = y + (bandH - gH) / 2;
        shots.forEach((sh, i) => {
          pos.set(sh.node_id, {
            x: shotX + (i % SHOT_COLS) * CELL_W,
            y: gridTop + Math.floor(i / SHOT_COLS) * CELL_H,
          });
        });
        if (shots.length > 1) {
          groups.push({
            keyframe: kf,
            x: shotX - GROUP_PAD_X,
            y: gridTop - GROUP_PAD_TOP,
            width: gridWidth(cols) + GROUP_PAD_X * 2,
            height: gH + GROUP_PAD_TOP + GROUP_PAD_BOTTOM,
            count: shots.length,
          });
        }
        y += bandH;
        if (fi < frames.length - 1) y += KF_GAP;
      });
      // The scene heads its frame stack: its card top-aligns with its first frame, so the
      // label reads as the title of the frames cascading below it rather than floating into
      // the middle of a tall stack.
      pos.set(s.node_id, { x: sceneX, y: firstFrameY });
      y += SCENE_GAP;
    }
    sceneH = ordered.length ? y - SCENE_GAP : 0;
  }

  // The titled frame behind the scenes — a compact grid when there are many and none has been
  // broken down yet, otherwise a single-column spine. Shown only past the scene-count
  // threshold above.
  const sceneGroup = frameShown ? {
    x: sceneX - GROUP_PAD_X,
    y: 0,
    width: sceneFrameW + GROUP_PAD_X * 2,
    height: sceneH + GROUP_PAD_BOTTOM,
    count: scenes.length,
    members: scenes.map((n) => n.node_id),
  } : null;

  // Story centres against the cast column; the final cut against the whole scene stack, and
  // clear of the widest shot grid so it never lands on the coverage.
  const timelineX = shotX + gridWidth(widestCols) + 90;
  for (const n of nodeList) {
    if (kindOf(n) === 'story') pos.set(n.node_id, { x: COL_X.story, y: (castH - TALL_CARD_H) / 2 });
    if (kindOf(n) === 'timeline') pos.set(n.node_id, { x: timelineX, y: (sceneH - TALL_CARD_H) / 2 });
  }

  // With something selected the canvas splits in three: the node itself, what depends on it,
  // and everything the change can't reach. Dimming the third makes the blast radius legible.
  const focusClass = (id) => {
    if (!focusing) return '';
    if (id === selectedId) return 'focus-root';
    return impact.has(id) ? 'focus-impact' : 'focus-dim';
  };

  // Coverage frames sit behind the shot cards (lower z, no pointer events) so a frame's shots
  // read as one cluster without stealing a click from the cards on top.
  const groupNodes = groups.map(({ keyframe, x, y: gyy, width, height, count }) => ({
    id: `coverage-${keyframe.node_id}`,
    type: 'coverageGroup',
    position: { x, y: gyy },
    data: { width, height, count, frameTitle: keyframe.title },
    className: focusing && !impact.has(keyframe.node_id) && keyframe.node_id !== selectedId
      ? 'focus-dim' : '',
    selectable: false,
    draggable: false,
    focusable: false,
    zIndex: 0,
  }));

  // The cast and locations frames, behind their grids — same node type as coverage, so the
  // three groupings read as one visual family. Dimmed with the rest when a change is focused
  // and none of the group's members is in its blast radius.
  const castGroupNodes = castGroups.map((g, idx) => ({
    id: `castgroup-${g.label}-${idx}`,
    type: 'coverageGroup',
    position: { x: g.x, y: g.y },
    data: { width: g.width, height: g.height, count: g.count,
            label: g.label, countNoun: g.countNoun },
    className: focusing && !g.members.some((m) => m === selectedId || impact.has(m))
      ? 'focus-dim' : '',
    selectable: false,
    draggable: false,
    focusable: false,
    zIndex: 0,
  }));

  // The scene spine — same node family as the coverage and cast frames, but its own variant so
  // it reads as the backbone of the film rather than one more copper cluster.
  const sceneGroupNode = sceneGroup ? {
    id: 'scenegroup',
    type: 'coverageGroup',
    position: { x: sceneGroup.x, y: sceneGroup.y },
    data: { width: sceneGroup.width, height: sceneGroup.height, count: sceneGroup.count,
            label: 'Scenes', countNoun: sceneGroup.count === 1 ? 'scene' : 'scenes',
            variant: 'scene' },
    className: focusing && !sceneGroup.members.some((m) => m === selectedId || impact.has(m))
      ? 'focus-dim' : '',
    selectable: false,
    draggable: false,
    focusable: false,
    zIndex: 0,
  } : null;

  const cardNodes = nodeList.map((n) => ({
    id: n.node_id,
    type: 'cine',
    position: pos.get(n.node_id) || { x: 0, y: 0 },
    data: { node: n, impacted: impact.has(n.node_id), stats: nodeStats(n, nodeList), onAddShot,
            onAddKeyframe,
            // + Keyframe is offered on a scene only once it has a frame — that is the signal
            // its founding sheets are locked, which the new still is composed against.
            canAddKeyframe: kindOf(n) === 'scene' && (framesOf.get(n.node_id)?.length > 0),
            phase: phases?.[n.node_id] },
    className: focusClass(n.node_id),
    selected: n.node_id === selectedId,
    draggable: true,
    zIndex: 1,
  }));

  const rfNodes = [...groupNodes, ...castGroupNodes,
    ...(sceneGroupNode ? [sceneGroupNode] : []), ...cardNodes];

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
