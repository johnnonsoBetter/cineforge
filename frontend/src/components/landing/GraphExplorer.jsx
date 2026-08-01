import { useCallback, useState, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  applyNodeChanges,
  applyEdgeChanges,
  Handle,
  Position,
} from '@xyflow/react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BookText,
  User,
  MapPin,
  Clapperboard,
  Camera,
  Film,
  Hash,
  Cpu,
  ArrowLeft,
  X,
} from 'lucide-react';

/* ---------- tone maps (warm re-skin) ---------- */
const toneRing = {
  amber: 'ring-amber-400/40',
  accent: 'ring-accent-400/40',
  orange: 'ring-orange-400/40',
  rose: 'ring-rose-400/40',
};
const toneIcon = {
  amber: 'from-amber-400 to-amber-600 text-ink-950',
  accent: 'from-accent-400 to-accent-600 text-ink-950',
  orange: 'from-orange-400 to-orange-600 text-ink-950',
  rose: 'from-rose-400 to-rose-600 text-white',
};
const toneDot = {
  amber: 'bg-amber-400',
  accent: 'bg-accent-400',
  orange: 'bg-orange-400',
  rose: 'bg-rose-400',
};
const toneHex = {
  amber: '#fbbf24',
  accent: '#e4a555',
  orange: '#fb923c',
  rose: '#fb7185',
};

function AssetCard({ data, selected }) {
  return (
    <div className="relative group">
      <div
        className={`relative flex items-center gap-3 rounded-xl glass-strong px-4 py-3 ring-1 transition-all min-w-[180px] ${
          selected ? `${toneRing[data.tone]} shadow-lg` : toneRing[data.tone]
        }`}
      >
        <div
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br ${toneIcon[data.tone]}`}
        >
          {data.icon}
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-white leading-tight">
            {data.label}
          </span>
          <span className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">
            {data.kind}
          </span>
        </div>
        <span className={`absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full ${toneDot[data.tone]}`} />
      </div>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { asset: AssetCard };

/* ---------- Graph: The VIP Treatment ---------- */
const initialNodes = [
  {
    id: 'bible',
    type: 'asset',
    position: { x: 20, y: 200 },
    data: {
      label: 'Story Bible',
      kind: 'synthesis',
      icon: <BookText className="h-4 w-4" strokeWidth={2.2} />,
      tone: 'amber',
      prompt: 'A comedy about a Lagos socialite who mistakes a taxi driver for a VIP concierge.',
      provider: 'openai',
      model: 'gpt-4o',
      hash: 'b1a2c3...',
      deps: [],
    },
  },
  {
    id: 'simeon',
    type: 'asset',
    position: { x: 280, y: 80 },
    data: {
      label: 'Simeon',
      kind: 'character',
      icon: <User className="h-4 w-4" strokeWidth={2.2} />,
      tone: 'accent',
      prompt: 'Nigerian man, mid-30s, taxi driver, warm smile, slightly worn jacket.',
      provider: 'flux',
      model: 'flux-1.1-pro',
      hash: 'd4e5f6...',
      deps: ['bible'],
    },
  },
  {
    id: 'maya',
    type: 'asset',
    position: { x: 280, y: 320 },
    data: {
      label: 'Maya',
      kind: 'character',
      icon: <User className="h-4 w-4" strokeWidth={2.2} />,
      tone: 'accent',
      prompt: 'Lagos socialite, elegant, bold lipstick, designer sunglasses.',
      provider: 'flux',
      model: 'flux-1.1-pro',
      hash: 'g7h8i9...',
      deps: ['bible'],
    },
  },
  {
    id: 'loc1',
    type: 'asset',
    position: { x: 280, y: 200 },
    data: {
      label: 'Hotel Lobby',
      kind: 'location',
      icon: <MapPin className="h-4 w-4" strokeWidth={2.2} />,
      tone: 'orange',
      prompt: 'Opulent Lagos hotel lobby, marble floors, golden hour light.',
      provider: 'flux',
      model: 'flux-1.1-pro',
      hash: 'j1k2l3...',
      deps: ['bible'],
    },
  },
  {
    id: 'scene3',
    type: 'asset',
    position: { x: 560, y: 200 },
    data: {
      label: 'Scene 3',
      kind: 'scene',
      icon: <Clapperboard className="h-4 w-4" strokeWidth={2.2} />,
      tone: 'rose',
      prompt: 'Maya enters the lobby, spots Simeon, mistakes him for the concierge.',
      deps: ['bible', 'simeon', 'maya', 'loc1'],
    },
  },
  {
    id: 'shot7',
    type: 'asset',
    position: { x: 820, y: 100 },
    data: {
      label: 'Shot 7',
      kind: 'keyframe',
      icon: <Camera className="h-4 w-4" strokeWidth={2.2} />,
      tone: 'accent',
      prompt: 'Medium shot, Maya approaching Simeon, warm tones, shallow DOF.',
      provider: 'flux',
      model: 'flux-1.1-pro',
      hash: 'm4n5o6...',
      deps: ['scene3', 'simeon', 'maya', 'loc1'],
    },
  },
  {
    id: 'shot8',
    type: 'asset',
    position: { x: 820, y: 220 },
    data: {
      label: 'Shot 8',
      kind: 'keyframe',
      icon: <Camera className="h-4 w-4" strokeWidth={2.2} />,
      tone: 'accent',
      prompt: 'Close-up, Simeon confused, soft key light from lobby window.',
      provider: 'flux',
      model: 'flux-1.1-pro',
      hash: 'p7q8r9...',
      deps: ['scene3', 'simeon', 'loc1'],
    },
  },
  {
    id: 'shot9',
    type: 'asset',
    position: { x: 820, y: 340 },
    data: {
      label: 'Shot 9',
      kind: 'video',
      icon: <Film className="h-4 w-4" strokeWidth={2.2} />,
      tone: 'orange',
      prompt: 'Two-shot, Maya handing keys to Simeon, subtle comedy beat.',
      provider: 'seedance',
      model: 'seedance-2-0',
      hash: 's1t2u3...',
      deps: ['shot7', 'shot8'],
    },
  },
];

const initialEdges = [
  { id: 'e1', source: 'bible', target: 'simeon', style: { stroke: '#e4a555' } },
  { id: 'e2', source: 'bible', target: 'maya', style: { stroke: '#e4a555' } },
  { id: 'e3', source: 'bible', target: 'loc1', style: { stroke: '#e4a555' } },
  { id: 'e4', source: 'bible', target: 'scene3', style: { stroke: '#e4a555' } },
  { id: 'e5', source: 'simeon', target: 'scene3', style: { stroke: '#d68f3c' } },
  { id: 'e6', source: 'maya', target: 'scene3', style: { stroke: '#d68f3c' } },
  { id: 'e7', source: 'loc1', target: 'scene3', style: { stroke: '#fb923c' } },
  { id: 'e8', source: 'scene3', target: 'shot7', style: { stroke: '#fb7185' } },
  { id: 'e9', source: 'scene3', target: 'shot8', style: { stroke: '#fb7185' } },
  { id: 'e10', source: 'shot7', target: 'shot9', animated: true, style: { stroke: '#d68f3c' } },
  { id: 'e11', source: 'shot8', target: 'shot9', animated: true, style: { stroke: '#d68f3c' } },
];

const nodeById = Object.fromEntries(initialNodes.map((n) => [n.id, n.data]));

export default function GraphExplorer() {
  const [nodes, setNodes] = useState(initialNodes);
  const [edges, setEdges] = useState(initialEdges);
  const [selected, setSelected] = useState(null);

  const onNodesChange = useCallback(
    (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );
  const onEdgesChange = useCallback(
    (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [],
  );

  const onNodeClick = useCallback((_, node) => setSelected(node.id), []);

  const selectedData = useMemo(
    () => (selected ? nodeById[selected] : null),
    [selected],
  );

  // what depends on this node
  const backRefs = useMemo(() => {
    if (!selected) return [];
    return edges
      .filter((e) => e.source === selected)
      .map((e) => nodeById[e.target]?.label)
      .filter(Boolean);
  }, [selected, edges]);

  return (
    <section className="relative px-6 py-28">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col items-center text-center mb-14">
          <span className="section-eyebrow mb-4">Graph explorer</span>
          <h2 className="font-display text-3xl sm:text-4xl md:text-5xl font-semibold text-white tracking-tight">
            Explore the real graph
          </h2>
          <p className="mt-4 max-w-2xl text-slate-400 text-lg">
            This is the actual dependency graph for <span className="text-white">The VIP Treatment</span>.
            Pan, zoom, click any node to inspect its provenance and back-references.
          </p>
        </div>

        <div className="relative rounded-3xl glass-strong overflow-hidden shadow-2xl shadow-black/50">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06] bg-ink-900/60">
            <span className="h-3 w-3 rounded-full bg-rose-400/70" />
            <span className="h-3 w-3 rounded-full bg-amber-400/70" />
            <span className="h-3 w-3 rounded-full bg-accent-400/70" />
            <span className="ml-3 text-xs font-mono text-slate-500">
              cineforge / graph / the-vip-treatment
            </span>
            <span className="ml-auto text-xs font-mono text-slate-500">
              {initialNodes.length} nodes · {initialEdges.length} edges
            </span>
          </div>

          <div className="cf-graph relative h-[560px] grid-bg">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={onNodeClick}
              fitView
              fitViewOptions={{ padding: 0.15 }}
              proOptions={{ hideAttribution: true }}
              defaultEdgeOptions={{ type: 'smoothstep' }}
              minZoom={0.3}
              maxZoom={1.8}
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={22}
                size={1.5}
                color="#40331f"
              />
              <Controls
                showInteractive={false}
                position="bottom-left"
              />
              <MiniMap
                position="bottom-right"
                pannable
                zoomable
                nodeStrokeWidth={2}
                nodeColor={(n) => toneHex[n.data?.tone] || '#e4a555'}
                nodeStrokeColor={(n) => toneHex[n.data?.tone] || '#e4a555'}
                maskColor="rgba(10,8,5,0.66)"
                style={{
                  background: 'rgba(28,22,14,0.72)',
                  border: '1px solid rgba(228,165,85,0.16)',
                  borderRadius: 12,
                }}
              />
            </ReactFlow>

            {/* inspector panel */}
            <AnimatePresence>
              {selectedData && (
                <motion.div
                  initial={{ opacity: 0, x: 40 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 40 }}
                  transition={{ duration: 0.3, ease: 'easeOut' }}
                  className="absolute top-4 right-4 bottom-4 w-72 rounded-2xl glass-strong p-5 overflow-y-auto z-10"
                >
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-xs font-mono uppercase tracking-widest text-slate-500">
                      Inspector
                    </span>
                    <button
                      onClick={() => setSelected(null)}
                      className="grid h-7 w-7 place-items-center rounded-lg glass text-slate-400 hover:text-white"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="flex items-center gap-3 mb-5">
                    <div
                      className={`grid h-10 w-10 place-items-center rounded-lg bg-gradient-to-br ${toneIcon[selectedData.tone]}`}
                    >
                      {selectedData.icon}
                    </div>
                    <div>
                      <h3 className="font-display text-lg font-semibold text-white leading-tight">
                        {selectedData.label}
                      </h3>
                      <span className="text-xs text-slate-400 font-mono uppercase tracking-wider">
                        {selectedData.kind}
                      </span>
                    </div>
                  </div>

                  {selectedData.prompt && (
                    <div className="mb-5">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500">
                        Prompt
                      </span>
                      <p className="mt-1.5 text-sm text-slate-300 leading-relaxed">
                        {selectedData.prompt}
                      </p>
                    </div>
                  )}

                  {selectedData.provider && (
                    <div className="mb-5 space-y-2">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500">
                        Provenance
                      </span>
                      <div className="flex items-center gap-2 text-xs font-mono text-slate-300">
                        <Cpu className="h-3.5 w-3.5 text-accent-300" />
                        {selectedData.provider} · {selectedData.model}
                      </div>
                      <div className="flex items-center gap-2 text-xs font-mono text-slate-300">
                        <Hash className="h-3.5 w-3.5 text-orange-300" />
                        {selectedData.hash}
                      </div>
                    </div>
                  )}

                  <div>
                    <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500">
                      Depends on
                    </span>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {selectedData.deps?.length ? (
                        selectedData.deps.map((d) => (
                          <span
                            key={d}
                            className="px-2 py-1 rounded-md glass text-xs font-mono text-slate-300"
                          >
                            {nodeById[d]?.label ?? d}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-slate-500 font-mono">root</span>
                      )}
                    </div>
                  </div>

                  <div className="mt-4">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500">
                      Back-references
                    </span>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {backRefs.length ? (
                        backRefs.map((r) => (
                          <span
                            key={r}
                            className="px-2 py-1 rounded-md bg-amber-500/10 border border-amber-500/20 text-xs font-mono text-amber-300"
                          >
                            {r}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-slate-500 font-mono">leaf node</span>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* hint */}
            {!selectedData && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="absolute top-4 left-4 flex items-center gap-2 text-xs font-mono text-slate-500 glass rounded-lg px-3 py-2"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                click a node to inspect
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
