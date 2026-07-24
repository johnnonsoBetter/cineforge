import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, Background, MiniMap, useReactFlow, ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import * as api from './api.js';
import { buildGraph } from './layout.js';
import { descendantsOf } from './graph.js';
import { CineNode } from './CineNode.jsx';
import Hero from './Hero.jsx';
import Rail from './Rail.jsx';
import Inspector from './Inspector.jsx';
import Timeline from './Timeline.jsx';
import ContextMenu from './ContextMenu.jsx';
import ShotDialog from './ShotDialog.jsx';
import QCGate from './QCGate.jsx';
import { headline as qcHeadline } from './qc.js';
import { STAGE_KEYS, STAGE_LABEL, isOpenGate } from './stages.js';

const seedStages = () => STAGE_KEYS.map((key) => ({ key, status: 'pending', gate: null }));

const nodeTypes = { cine: CineNode };
let MSG_SEQ = 0;
const mkMsg = (role, text) => ({ id: `m${++MSG_SEQ}`, role, text });

function Studio() {
  const [health, setHealth] = useState(null);
  const [projectId, setProjectId] = useState(null);
  const [nodes, setNodes] = useState([]);           // graph nodes from the backend
  const [messages, setMessages] = useState([mkMsg('director', "Give me one idea. I'll direct the whole film — story, cast, locations, keyframes, animated shots, final cut — and log every frame to Backblaze B2.")]);
  const [selectedId, setSelectedId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [built, setBuilt] = useState(false);
  const [toast, setToast] = useState(null);
  const [references, setReferences] = useState({});   // entity_id -> [{node_id, field, …}]
  const [ledger, setLedger] = useState(null);         // the run's QC record
  const [gateOpen, setGateOpen] = useState(false);

  // The gate's ledger is derived from the graph, so it is re-read whenever the graph could
  // have changed — after a run, a regeneration, or a human override.
  const loadLedger = useCallback((pid) => {
    const id = pid || projectId;
    if (!id) return;
    api.getQC(id).then(setLedger).catch(() => {});
  }, [projectId]);
  const [exportUrl, setExportUrl] = useState(null);
  const [mode, setMode] = useState('full');           // 'draft' = keyframes only
  const [stages, setStages] = useState(seedStages()); // the stage board
  const [gateMode, setGateMode] = useState('auto');   // who opens the next stage
  const [impact, setImpact] = useState(null);         // blast radius of changing the selection
  const [progress, setProgress] = useState({});       // stage key -> { done, total }
  const [menu, setMenu] = useState(null);             // { x, y, nodeId }
  const [shotAt, setShotAt] = useState(null);         // { node, x, y } — new-setup dialog
  const [lastSettings, setLastSettings] = useState(null);  // so Replay re-forges like-for-like

  const abortRef = useRef(null);
  const rf = useReactFlow();

  useEffect(() => { api.getHealth().then(setHealth).catch(() => {}); }, []);

  // Merge a streamed node into local state (upsert by id).
  const upsertNode = useCallback((node) => {
    setNodes((prev) => {
      const i = prev.findIndex((n) => n.node_id === node.node_id);
      if (i === -1) return [...prev, node];
      const next = prev.slice();
      next[i] = node;
      return next;
    });
  }, []);

  const pushMsg = useCallback((role, text) => setMessages((m) => [...m, mkMsg(role, text)]), []);

  const flash = useCallback((text) => {
    setToast(text);
    setTimeout(() => setToast(null), 2600);
  }, []);

  // Back-references power the Inspector's "referenced by" panel. Refreshed whenever the
  // graph's shape or naming could have changed.
  const loadReferences = useCallback((pid) => {
    const id = pid || projectId;
    if (!id) return;
    api.getProject(id).then((p) => setReferences(p.references || {})).catch(() => {});
  }, [projectId]);

  // One stage's row on the board, patched in place.
  const patchStage = useCallback((key, patch) => {
    setStages((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }, []);

  const handleEvent = useCallback((ev) => {
    if (ev.type === 'node' && ev.node) upsertNode(ev.node);
    else if (ev.type === 'progress' && ev.stage) {
      setProgress((p) => ({ ...p, [ev.stage]: { done: ev.done, total: ev.total } }));
    }
    else if (ev.type === 'stage_status' && ev.stage) {
      patchStage(ev.stage, { status: ev.stage_status });
    }
    // The gate is the point where the run either continues or stops, so it speaks in the
    // conversation like the reviewer does — a stage that halted production silently would
    // be indistinguishable from one that finished.
    else if (ev.type === 'gate' && ev.gate) {
      patchStage(ev.stage, { gate: ev.gate });
      pushMsg('gate', ev.label || ev.gate.summary);
    }
    else if (ev.type === 'stage' && ev.label) pushMsg('stage', ev.label);
    // The reviewer gets its own voice in the run. A verdict that only showed up afterwards,
    // buried in the node it changed, would be a gate nobody watched work.
    else if (ev.type === 'qc' && ev.qc) {
      pushMsg('qc', ev.label || qcHeadline(ev.qc));
    }
    else if (ev.type === 'done' && ev.label) pushMsg('done', ev.label);
    else if (ev.type === 'error' && ev.label) pushMsg('error', ev.label);
  }, [upsertNode, pushMsg, patchStage]);

  const fitSoon = useCallback(() => {
    setTimeout(() => rf.fitView({ padding: 0.18, duration: 520 }), 90);
  }, [rf]);

  // ---- run the film, one gated stage at a time ----
  //
  // The same call starts a film and continues one: stages that already cleared are skipped
  // by the backend, so "forge" and "carry on after I approved that gate" are one code path.
  // The run ends either because the film is finished or because a gate is waiting on the
  // director — and the board it reloads afterwards is what tells the two apart.
  const runFrom = useCallback(async (pid) => {
    setBusy(true);
    try {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      let first = true;
      await api.streamRun(pid, (ev) => {
        handleEvent(ev);
        if (ev.type === 'node' && first) { first = false; fitSoon(); }
      }, ctrl.signal, { stopAfter: mode === 'draft' ? 'keyframes' : undefined, gateMode });
      const board = await api.getStages(pid);
      setStages(board.stages);
      setBuilt(board.complete);
      loadReferences(pid);
      loadLedger(pid);
      fitSoon();
    } catch (e) {
      if (e.name !== 'AbortError') pushMsg('error', `The run stopped: ${e.message}`);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, [handleEvent, fitSoon, pushMsg, mode, gateMode, loadReferences, loadLedger]);

  // ---- forge a new film ----
  const forge = useCallback(async (idea, settings) => {
    setNodes([]);
    setSelectedId(null);
    setBuilt(false);
    setProgress({});
    setStages(seedStages());
    setLastSettings(settings || null);
    setMessages((m) => [...m, mkMsg('user', idea)]);
    try {
      const { project_id } = await api.createProject(idea, settings, gateMode);
      setProjectId(project_id);
      await runFrom(project_id);
    } catch (e) {
      pushMsg('error', `Something interrupted the forge: ${e.message}`);
    }
  }, [runFrom, pushMsg, gateMode]);

  // ---- open a gate, and let the next stage start ----
  const approveStage = useCallback(async (key, note) => {
    if (!projectId || busy) return;
    try {
      const { board } = await api.approveStage(projectId, key, note);
      setStages(board.stages);
      pushMsg('user', note
        ? `Approved ${STAGE_LABEL[key]} — ${note}`
        : `Approved ${STAGE_LABEL[key]}.`);
      await runFrom(projectId);
    } catch (e) {
      pushMsg('error', `Could not approve that stage: ${e.message}`);
    }
  }, [projectId, busy, runFrom, pushMsg]);

  // ---- refuse a stage the gate was willing to pass ----
  const holdStage = useCallback(async (key, note) => {
    if (!projectId || busy) return;
    try {
      const { board } = await api.holdStage(projectId, key, note);
      setStages(board.stages);
      pushMsg('user', note
        ? `Holding ${STAGE_LABEL[key]} — ${note}`
        : `Holding ${STAGE_LABEL[key]}. Nothing downstream will be built.`);
    } catch (e) {
      pushMsg('error', `Could not hold that stage: ${e.message}`);
    }
  }, [projectId, busy, pushMsg]);

  // ---- regenerate one node ----
  const regenerate = useCallback(async (node, note) => {
    if (!projectId || busy) return;
    setBusy(true);
    if (note) pushMsg('user', note);
    try {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      await api.streamRegenerate(projectId, node.node_id, note, handleEvent, ctrl.signal);
      flash(`${node.title} regenerated`);
      loadLedger();
      // A note can invalidate stages that had already cleared, so the board is re-read
      // rather than assumed: the film is only "built" while every stage still stands.
      const board = await api.getStages(projectId);
      setStages(board.stages);
      setBuilt(board.complete);
    } catch (e) {
      if (e.name !== 'AbortError') pushMsg('error', `Regeneration failed: ${e.message}`);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, [projectId, busy, handleEvent, pushMsg, flash, loadLedger]);

  // ---- shoot another setup off an existing keyframe ----
  // Additive by construction: the master frame is already approved and paid for, so this
  // buys one clip and invalidates nothing. That is why it needs no impact preview.
  const addShot = useCallback(async (keyframe, spec) => {
    if (!projectId || busy) return;
    setBusy(true);
    setShotAt(null);
    try {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      let added = null;
      await api.streamAddShot(projectId, keyframe.node_id, spec, (ev) => {
        handleEvent(ev);
        if (ev.type === 'node' && ev.node?.kind === 'shot') added = ev.node;
      }, ctrl.signal);
      if (added) setSelectedId(added.node_id);
      loadLedger();
    } catch (e) {
      if (e.name !== 'AbortError') pushMsg('error', `That setup failed: ${e.message}`);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, [projectId, busy, handleEvent, pushMsg, loadLedger]);

  // Let the director read the scene and propose the next setup. Costs a text call and
  // renders nothing — it fills the form in, and taking the shot is still a separate act.
  const suggestShot = useCallback(
    (keyframe) => api.suggestShot(projectId, keyframe.node_id),
    [projectId]
  );

  const openShotDialog = useCallback((node, at) => {
    setSelectedId(node.node_id);
    setMenu(null);
    setShotAt({ node, ...at });
  }, []);

  // ---- ask the gate for a second opinion ----
  // Deliberately distinct from regeneration: this re-reads pixels that already exist, so it
  // costs a text call rather than another render.
  const reviewQC = useCallback(async (node) => {
    if (!projectId || busy) return;
    setBusy(true);
    try {
      const { updated, report } = await api.reviewQC(projectId, node.node_id);
      updated.forEach(upsertNode);
      pushMsg('qc', `${node.title} — ${qcHeadline(report)}`);
      loadLedger();
    } catch (e) {
      pushMsg('error', `Re-review failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [projectId, busy, upsertNode, pushMsg, loadLedger]);

  // ---- overrule the gate on one node ----
  const acceptQC = useCallback(async (node) => {
    if (!projectId || busy) return;
    try {
      const { updated } = await api.acceptQC(projectId, node.node_id);
      updated.forEach(upsertNode);
      flash(`${node.title} kept over the gate's verdict`);
      loadLedger();
    } catch (e) {
      pushMsg('error', `Could not record the override: ${e.message}`);
    }
  }, [projectId, busy, upsertNode, flash, pushMsg, loadLedger]);

  // ---- conversational edit ----
  // No selection required: the backend's intent router reads the note against the graph
  // and works out what you meant. An @-reference in the note wins over both, because it is
  // the one signal the director stated outright; a selection is the next best thing.
  const sendEdit = useCallback(async (instruction, refs = []) => {
    if (!projectId || busy) return;
    setBusy(true);
    pushMsg('user', instruction);
    try {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const target = refs[0]?.nodeId || selectedId;
      await api.streamEdit(projectId, instruction, target, handleEvent, ctrl.signal);
      loadReferences();
    } catch (e) {
      if (e.name !== 'AbortError') pushMsg('error', `That edit failed: ${e.message}`);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, [projectId, busy, selectedId, handleEvent, pushMsg, loadReferences]);

  // ---- rename an entity (free: nothing is re-rendered) ----
  const renameEntity = useCallback(async (entityId, newName) => {
    if (!projectId) return;
    try {
      const { updated } = await api.renameEntity(projectId, entityId, newName);
      updated.forEach(upsertNode);
      loadReferences();
      flash(`Renamed to ${newName} — no frames re-rendered`);
    } catch (e) {
      pushMsg('error', `Rename failed: ${e.message}`);
    }
  }, [projectId, upsertNode, flash, pushMsg, loadReferences]);

  // ---- switch to another take (free — the asset already exists) ----
  const selectVersion = useCallback(async (version) => {
    if (!projectId || !selectedId) return;
    try {
      const { updated, board } = await api.selectVersion(projectId, selectedId, version);
      updated.forEach(upsertNode);
      if (board) { setStages(board.stages); setBuilt(board.complete); }
      flash(`Take ${version} is live — nothing was re-rendered`);
    } catch (e) {
      pushMsg('error', `Could not switch take: ${e.message}`);
    }
  }, [projectId, selectedId, upsertNode, flash, pushMsg]);

  // ---- lock / unlock ----
  const toggleLock = useCallback(async (locked) => {
    if (!projectId || !selectedId) return;
    try {
      const { updated } = await api.lockNode(projectId, selectedId, locked);
      updated.forEach(upsertNode);
      flash(locked ? 'Locked — regeneration will skip it' : 'Unlocked');
    } catch (e) {
      pushMsg('error', `Could not change the lock: ${e.message}`);
    }
  }, [projectId, selectedId, upsertNode, flash, pushMsg]);

  // ---- export the final cut ----
  const exportFilm = useCallback(async () => {
    if (!projectId || busy) return;
    setBusy(true);
    pushMsg('stage', 'Rendering the final cut…');
    try {
      const { export_url, shots: n } = await api.exportFilm(projectId);
      setExportUrl(export_url);
      pushMsg('done', `Final cut rendered — ${n} shots. Ready to download.`);
    } catch (e) {
      pushMsg('error', `Export failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [projectId, busy, pushMsg]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setNodes([]); setProjectId(null); setSelectedId(null); setBuilt(false); setBusy(false);
    setReferences({}); setExportUrl(null); setProgress({}); setStages(seedStages());
    setMessages([mkMsg('director', "Give me one idea. I'll direct the whole film — story, cast, locations, keyframes, animated shots, final cut — and log every frame to Backblaze B2.")]);
  }, []);

  const replay = useCallback(() => {
    const idea = [...messages].reverse().find((m) => m.role === 'user')?.text;
    if (idea) forge(idea, lastSettings);
  }, [messages, forge, lastSettings]);

  // ---- derived graph ----
  // The highlight is local (instant); the costed impact comes from the backend, which is
  // the only side that knows which of those descendants are media and have to be re-paid for.
  const impactIds = useMemo(() => descendantsOf(nodes, selectedId), [nodes, selectedId]);

  useEffect(() => {
    if (!projectId || !selectedId) { setImpact(null); return; }
    let cancelled = false;
    api.getImpact(projectId, selectedId)
      .then((i) => { if (!cancelled) setImpact(i); })
      .catch(() => { if (!cancelled) setImpact(null); });
    return () => { cancelled = true; };
  }, [projectId, selectedId, nodes.length]);

  const { rfNodes, rfEdges } = useMemo(
    () => buildGraph(nodes, { selectedId, impactIds, onAddShot: openShotDialog }),
    [nodes, selectedId, impactIds, openShotDialog]
  );

  const selectedNode = nodes.find((n) => n.node_id === selectedId) || null;
  const menuNode = menu ? nodes.find((n) => n.node_id === menu.nodeId) : null;
  // The one stage the run has stopped at, if any. There can only ever be one: the driver
  // returns the moment a gate doesn't open.
  const openGate = useMemo(() => stages.find((s) => isOpenGate(s.status)) || null, [stages]);

  // entity_id -> the node that entity became, once a stage has built it. The story brief
  // lists the whole cast from the screenplay, most of which has no node yet at the story
  // gate — this is what lets it link the ones that exist and say so about the ones that
  // don't, instead of offering a chip that does nothing.
  const entityNodes = useMemo(() => {
    const out = {};
    for (const n of nodes) {
      if ((n.kind === 'character' || n.kind === 'environment') && n.data?.id) out[n.data.id] = n;
    }
    return out;
  }, [nodes]);

  // For a selected scene: the shots filmed off its master frame, indexed by setup, so the
  // inspector's coverage list can link straight to the clip each setup produced.
  const sceneShots = useMemo(() => {
    if (selectedNode?.kind !== 'scene') return null;
    const kf = nodes.find((n) => n.kind === 'keyframe'
      && n.parent_ids?.includes(selectedNode.node_id));
    if (!kf) return null;
    const out = {};
    for (const n of nodes) {
      if (n.kind === 'shot' && n.parent_ids?.includes(kf.node_id)) out[n.data?.i ?? 0] = n;
    }
    return out;
  }, [nodes, selectedNode]);
  // The cut order: scene by scene, and within a scene the setups in the order they were
  // called for — including any shot added from the canvas after the fact.
  const shots = useMemo(
    () => nodes.filter((n) => n.kind === 'shot')
      .sort((a, b) => (a.data?.n ?? 0) - (b.data?.n ?? 0) || (a.data?.i ?? 0) - (b.data?.i ?? 0)),
    [nodes]
  );
  const storyTitle = nodes.find((n) => n.kind === 'story')?.title;
  // What the director is doing right now, for the monitor's footer line.
  const currentStage = useMemo(
    () => [...messages].reverse().find((m) => m.role === 'stage')?.text || null,
    [messages]
  );

  const [zoom, setZoom] = useState(100);
  useEffect(() => {
    const id = setInterval(() => setZoom(Math.round((rf.getZoom?.() || 1) * 100)), 350);
    return () => clearInterval(id);
  }, [rf]);

  const hasGraph = nodes.length > 0;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">CineForge</span>
          <span className="brand-sub">AI Film Studio</span>
        </div>
        <div className="topbar-title">{storyTitle || (hasGraph ? 'Untitled Film' : '')}</div>
        {hasGraph && (
          <span className="chip">
            {busy ? 'Working'
              : openGate ? `Gate · ${STAGE_LABEL[openGate.key]}`
              : built ? 'Ready' : 'Draft'}
          </span>
        )}
        <div className="topbar-spacer" />
        <div className="topbar-right">
          {/* Story and pixels go live independently, so say which — a "Mock" badge over a
              bespoke screenplay would undersell it, and the reverse would oversell it. */}
          <span className="chip" title={health ? `storage: ${health.storage}` : ''}>
            <span className="dot" style={{ background: health?.text_live ? 'var(--green)' : 'var(--faint)' }} />
            {health ? (health.text_live ? 'Story · live' : 'Story · sample') : '…'}
          </span>
          <span className="chip">
            <span className="dot" style={{ background: health?.media_live ? 'var(--gold)' : 'var(--faint)' }} />
            {health ? (health.media_live ? `Media · ${health.provider_stack}` : 'Media · mock') : '…'}
          </span>
          {!hasGraph && (
            <button className="btn" title="Draft renders keyframes only — fast and cheap"
                    onClick={() => setMode((m) => (m === 'full' ? 'draft' : 'full'))}>
              {mode === 'full' ? 'Full render' : 'Draft only'}
            </button>
          )}
          {/* Who opens the next stage. Switchable mid-film on purpose: the usual shape of a
              run is hand-approving the cheap early passes and then letting the reviewer
              carry the expensive ones once the look is settled. */}
          <button
            className="btn"
            title={gateMode === 'auto'
              ? 'QC opens each stage on its own, and stops the run when something fails'
              : 'Every stage waits for you before the next one starts'}
            onClick={() => setGateMode((g) => (g === 'auto' ? 'manual' : 'auto'))}
            disabled={busy}
          >
            {gateMode === 'auto' ? 'Gates · AI' : 'Gates · manual'}
          </button>
          {/* The gate's headline number belongs in the chrome: how much still needs a human
              is a fact about the film, not a detail inside one node. */}
          {ledger && ledger.reviewed > 0 && (
            <button
              className={`chip gate-chip ${ledger.needs_a_human?.length ? 'warn' : 'clear'}`}
              onClick={() => setGateOpen((o) => !o)}
              title="Quality gate"
            >
              <span className="dot" style={{
                background: ledger.needs_a_human?.length ? 'var(--amber)' : 'var(--green)',
              }} />
              {ledger.needs_a_human?.length
                ? `QC · ${ledger.needs_a_human.length} to review`
                : `QC · ${Math.round((ledger.pass_rate ?? 0) * 100)}% clear`}
            </button>
          )}
          {built && shots.length > 0 && (
            exportUrl
              ? <a className="btn-gold" href={exportUrl} download>↓ Download film</a>
              : <button className="btn-gold" onClick={exportFilm} disabled={busy}>Export film</button>
          )}
          <button className="btn" onClick={reset}>New</button>
          <button className="btn" onClick={replay} disabled={busy || !projectId}>Replay</button>
          <div className="zoomer">
            <button onClick={() => rf.zoomOut()} title="Zoom out">−</button>
            <span>{zoom}%</span>
            <button onClick={() => rf.zoomIn()} title="Zoom in">+</button>
          </div>
        </div>
      </header>

      <div className="body">
        <Rail
          messages={messages}
          // A note is the main way to fix what a gate is holding, so edits unlock at the
          // gate rather than only once the whole film is finished.
          canEdit={!!projectId && (built || !!openGate)}
          nodes={nodes}
          stages={stages}
          openGate={openGate}
          onApproveStage={approveStage}
          onHoldStage={holdStage}
          targetNode={selectedNode && ['character', 'environment', 'scene', 'keyframe', 'shot'].includes(selectedNode.kind) ? selectedNode : null}
          onClearTarget={() => setSelectedId(null)}
          onFocusNode={setSelectedId}
          onSend={sendEdit}
          busy={busy}
          progress={progress}
          current={currentStage}
        />

        <div className="stage">
          {!hasGraph && <Hero onForge={forge} busy={busy} />}

          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            onNodeClick={(_, n) => { setSelectedId(n.id); setMenu(null); }}
            onNodeContextMenu={(e, n) => {
              e.preventDefault();
              setSelectedId(n.id);
              setMenu({ x: e.clientX, y: e.clientY, nodeId: n.id });
            }}
            onPaneClick={() => { setSelectedId(null); setMenu(null); }}
            onMoveStart={() => setMenu(null)}
            minZoom={0.15}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
            fitView
            fitViewOptions={{ padding: 0.2 }}
          >
            <Background color="#3a3026" gap={26} size={1.4} />
            {hasGraph && (
              <MiniMap
                pannable zoomable
                nodeColor={() => '#4a3f30'}
                maskColor="rgba(20,17,13,0.6)"
                style={{ width: 168, height: 108 }}
              />
            )}
          </ReactFlow>

          {toast && <div className="toast">{toast}</div>}

          {shots.length > 0 && (
            <Timeline
              shots={shots}
              selectedId={selectedId}
              onSelect={setSelectedId}
              inspectorOpen={!!selectedNode}
            />
          )}

          {selectedNode && (
            <Inspector
              node={selectedNode}
              busy={busy}
              onClose={() => setSelectedId(null)}
              onRegenerate={(n) => regenerate(n)}
              impact={impact}
              references={references}
              onSelectNode={(id) => setSelectedId(id)}
              onSelectEntity={(entityId) => {
                const hit = nodes.find((n) => n.data?.id === entityId
                  && (n.kind === 'character' || n.kind === 'environment'));
                if (hit) setSelectedId(hit.node_id);
              }}
              onRename={(newName) => renameEntity(selectedNode.data?.id, newName)}
              onSelectVersion={selectVersion}
              onToggleLock={toggleLock}
              sceneShots={sceneShots}
              entityNodes={entityNodes}
              onAcceptQC={acceptQC}
              onReviewQC={reviewQC}
            />
          )}

          {gateOpen && (
            <QCGate
              ledger={ledger}
              busy={busy}
              onClose={() => setGateOpen(false)}
              onRecheck={() => loadLedger()}
              onSelectNode={(id) => { setSelectedId(id); setGateOpen(false); }}
            />
          )}

          {menu && menuNode && (
            <ContextMenu
              x={menu.x}
              y={menu.y}
              node={menuNode}
              busy={busy}
              onClose={() => setMenu(null)}
              onInspect={() => setSelectedId(menu.nodeId)}
              onRegenerate={regenerate}
              onToggleLock={toggleLock}
            />
          )}

          {shotAt && (
            <ShotDialog
              node={shotAt.node}
              at={shotAt}
              busy={busy}
              onClose={() => setShotAt(null)}
              onSubmit={addShot}
              onSuggest={suggestShot}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Studio />
    </ReactFlowProvider>
  );
}
