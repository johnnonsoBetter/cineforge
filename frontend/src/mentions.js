// The @-reference index for the director's composer.
//
// A note like "warm this up" only works if the system can tell what "this" is. Typing an
// @-reference makes that explicit: the referenced node is sent as the edit's target, so the
// intent router never has to guess. Everything here is pure — the composer owns the state.

import { isVideo } from './ui.js';

// The kinds an edit can actually be aimed at. Story and the final cut are assembled from
// the graph rather than generated, so referencing them would offer a target the backend
// would only refuse.
const REFERABLE = new Set(['scene', 'character', 'environment', 'keyframe', 'shot']);

const KIND_ORDER = ['scene', 'character', 'environment', 'keyframe', 'shot'];
const GROUP_TITLE = {
  scene: 'Scenes', character: 'Cast', environment: 'Locations',
  keyframe: 'Keyframes', shot: 'Shots',
};

const snip = (s, n = 64) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

// The token that goes in the text. Short and stable — it is what the user reads back in
// their own sentence, and what a ref is matched against when the text is edited by hand.
export function labelOf(node) {
  const d = node.data || {};
  if (node.kind === 'scene') return `Scene ${d.n ?? ''}`.trim();
  if (node.kind === 'keyframe') return `Keyframe ${d.n ?? ''}`.trim();
  return node.title;
}

function subOf(node) {
  const d = node.data || {};
  if (node.kind === 'scene') return snip(node.title.replace(/^Scene\s*\d+:\s*/, '') || d.action);
  if (node.kind === 'keyframe') return snip(d.scene_title || d.action);
  if (node.kind === 'shot') return snip(d.setup || d.vo);
  if (node.kind === 'character') return snip(d.dna);
  if (node.kind === 'environment') return snip(d.desc);
  return '';
}

function thumbOf(node) {
  const a = node.asset;
  if (!a) return null;
  if (a.thumbnail) return a.thumbnail;
  return a.url && !isVideo(a.url) ? a.url : null;
}

const toEntry = (node) => ({
  nodeId: node.node_id,
  kind: node.kind,
  label: labelOf(node),
  sub: subOf(node),
  thumb: thumbOf(node),
  status: node.status,
  node,
});

const orderKey = (node) => {
  const d = node.data || {};
  return [d.n ?? 0, d.i ?? 0];
};

function sortEntries(entries) {
  return entries.slice().sort((a, b) => {
    const ka = KIND_ORDER.indexOf(a.kind), kb = KIND_ORDER.indexOf(b.kind);
    if (ka !== kb) return ka - kb;
    const [an, ai] = orderKey(a.node), [bn, bi] = orderKey(b.node);
    if (an !== bn) return an - bn;
    if (ai !== bi) return ai - bi;
    return a.label.localeCompare(b.label);
  });
}

export const allEntries = (nodes) =>
  sortEntries(nodes.filter((n) => REFERABLE.has(n.kind)).map(toEntry));

// Everything hanging off one node, in both directions: for a scene that is its cast and
// location above, and its keyframe and every shot below. Picking a scene and seeing exactly
// what it is made of is the whole point of the drill-in — the graph already knows, so the
// composer should never make you go and look it up on the canvas.
export function connectedEntries(nodes, nodeId) {
  const node = nodes.find((n) => n.node_id === nodeId);
  if (!node) return [];
  const byId = new Map(nodes.map((n) => [n.node_id, n]));
  const out = new Map();

  const add = (n) => {
    if (n && n.node_id !== nodeId && REFERABLE.has(n.kind)) out.set(n.node_id, n);
  };

  for (const pid of node.parent_ids || []) add(byId.get(pid));

  const children = nodes.filter((n) => (n.parent_ids || []).includes(nodeId));
  for (const c of children) {
    add(c);
    for (const g of nodes.filter((n) => (n.parent_ids || []).includes(c.node_id))) add(g);
  }

  return sortEntries([...out.values()].map(toEntry));
}

export const hasConnections = (nodes, nodeId) => connectedEntries(nodes, nodeId).length > 0;

export function filterEntries(entries, query) {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter((e) =>
    e.label.toLowerCase().includes(q)
    || e.sub.toLowerCase().includes(q)
    || e.node.title.toLowerCase().includes(q));
}

// Entries stay in one flat order (that's what the keyboard walks); the headers are derived
// from it, so the rendered list and the highlighted index can never disagree.
export function groupEntries(entries) {
  const groups = [];
  let last = null;
  entries.forEach((e, i) => {
    if (e.kind !== last) {
      groups.push({ kind: e.kind, title: GROUP_TITLE[e.kind] || e.kind, items: [] });
      last = e.kind;
    }
    groups[groups.length - 1].items.push({ entry: e, index: i });
  });
  return groups;
}

// ---- the token being typed ----

// The @-token under the caret, or null. An @ only counts at a word boundary, so an email
// address in a note doesn't open the picker.
export function mentionRange(text, caret) {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf('@');
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(upto[at - 1])) return null;
  const query = upto.slice(at + 1);
  if (query.includes('\n') || query.length > 32) return null;
  return { start: at, end: caret, query };
}

export function applyMention(text, range, label) {
  const head = `${text.slice(0, range.start)}@${label} `;
  return { text: head + text.slice(range.end), caret: head.length };
}

// Refs are only as good as the text that still carries them: anything the user has since
// deleted or typed over stops being a reference.
export function liveRefs(text, refs) {
  const seen = new Set();
  return refs.filter((r) => {
    if (seen.has(r.nodeId) || !text.includes(`@${r.label}`)) return false;
    seen.add(r.nodeId);
    return true;
  });
}
