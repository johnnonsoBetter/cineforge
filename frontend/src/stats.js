// Card statistics.
//
// Every number here is counted off the graph the user can click through to verify. There is
// deliberately no "consistency: 98%" — we have a QC verdict and an attempt count, which are
// real, and inventing a confidence score would be the one number on the card that nothing
// backs up.

import { descendantsOf } from './graph.js';

const fmtSecs = (s) => (s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`);

export function nodeStats(node, nodes) {
  const byId = new Map(nodes.map((n) => [n.node_id, n]));
  const desc = [...descendantsOf(nodes, node.node_id)].map((id) => byId.get(id)).filter(Boolean);
  const count = (kind) => desc.filter((n) => n.kind === kind).length;
  const takes = node.versions?.length || 0;

  switch (node.kind) {
    case 'character': {
      const scenes = desc.filter((n) => n.kind === 'scene');
      return [
        ['Scenes', scenes.length],
        ['Shots', count('shot')],
        ['Lines', scenes.filter((s) => s.data?.vo).length],
        takes > 1 && ['Takes', takes],
      ];
    }
    case 'environment':
      return [
        ['Scenes', count('scene')],
        ['Shots', count('shot')],
        takes > 1 && ['Takes', takes],
      ];
    case 'scene':
      return [
        ['Cast', node.data?.cast?.length ?? node.data?.character_ids?.length ?? 0],
        ['Setups', count('shot')],
        node.data?.time && ['Time', node.data.time],
      ];
    case 'keyframe':
      // A master frame's job is to be shot from, so how much coverage it carries is the
      // number worth putting on the card.
      return [
        ['Setups', count('shot')],
        node.qc && ['QC', node.qc.verdict],
        takes > 1 && ['Takes', takes],
      ];
    case 'shot':
      return [
        node.asset?.duration_sec && ['Length', `${node.asset.duration_sec}s`],
        node.qc && ['QC', node.qc.verdict],
        takes > 1 && ['Takes', takes],
      ];
    case 'story':
      return [
        ['Scenes', count('scene')],
        ['Cast', count('character')],
        ['Locations', count('environment')],
      ];
    case 'timeline': {
      const shots = nodes.filter((n) => n.kind === 'shot' && n.asset?.duration_sec);
      const runtime = shots.reduce((a, s) => a + s.asset.duration_sec, 0);
      return [
        ['Shots', node.data?.shots?.length ?? shots.length],
        runtime > 0 && ['Runtime', fmtSecs(runtime)],
      ];
    }
    default:
      return [];
  }
}
