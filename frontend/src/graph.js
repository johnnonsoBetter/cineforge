// Graph traversal shared by the layout and the card statistics.

// Everything that inherits from a node, transitively. Computed on the client because the
// highlight has to land on the same frame as the click — a round trip would make the canvas
// feel like it was thinking about it.
export function descendantsOf(nodeList, nodeId) {
  if (!nodeId) return new Set();
  const kids = new Map();
  for (const n of nodeList) {
    for (const p of n.parent_ids || []) {
      if (!kids.has(p)) kids.set(p, []);
      kids.get(p).push(n.node_id);
    }
  }
  const out = new Set();
  const queue = [...(kids.get(nodeId) || [])];
  while (queue.length) {
    const id = queue.shift();
    if (out.has(id)) continue;
    out.add(id);
    queue.push(...(kids.get(id) || []));
  }
  return out;
}
