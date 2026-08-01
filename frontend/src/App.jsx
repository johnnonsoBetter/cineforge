import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useMatch, useLocation } from 'react-router-dom';
import {
  ReactFlow, Background, MiniMap, useReactFlow, ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import * as api from './api.js';
import { buildGraph } from './layout.js';
import { descendantsOf } from './graph.js';
import { CineNode } from './CineNode.jsx';
import { CoverageGroup } from './CoverageGroup.jsx';
import Hero from './Hero.jsx';
import Rail from './Rail.jsx';
import Inspector from './Inspector.jsx';
import Timeline from './Timeline.jsx';
import ContextMenu from './ContextMenu.jsx';
import ShotDialog from './ShotDialog.jsx';
import QCGate from './QCGate.jsx';
import Login from './Login.jsx';
import Landing from './Landing.jsx';
import Showcase from './Showcase.jsx';
import { authEnabled, getSession, onAuthChange, signOut } from './auth.js';
import { headline as qcHeadline } from './qc.js';
import { STAGE_KEYS, STAGE_LABEL, isOpenGate } from './stages.js';

const seedStages = () => STAGE_KEYS.map((key) => ({ key, status: 'pending', gate: null }));

const nodeTypes = { cine: CineNode, coverageGroup: CoverageGroup };
let MSG_SEQ = 0;
const mkMsg = (role, text) => ({ id: `m${++MSG_SEQ}`, role, text });

function Studio({ session }) {
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
  const [stages, setStages] = useState(seedStages()); // the stage board
  const [impact, setImpact] = useState(null);         // blast radius of changing the selection
  const [proposal, setProposal] = useState(null);     // a proposed edit, awaiting approval
  const [editHistory, setEditHistory] = useState([]); // persisted applied edits + undo state
  const [progress, setProgress] = useState({});       // stage key -> { done, total }
  const [phases, setPhases] = useState({});           // node_id -> transient beat (reviewing/rerendering)
  const [menu, setMenu] = useState(null);             // { x, y, nodeId }
  const [shotAt, setShotAt] = useState(null);         // { node, mode } — new-setup modal
  const [library, setLibrary] = useState([]);         // the caller's films, for the empty-state picker
  const [visibility, setVis] = useState('private');   // 'private' | 'public' — the open film's share state

  const abortRef = useRef(null);
  const proposalRequestRef = useRef(false);
  const rf = useReactFlow();

  // The URL is the source of truth for which film is open: `/` is the empty state, `/p/:id`
  // is a film on the canvas. This makes refresh, back/forward and shared links all work.
  const navigate = useNavigate();
  const routeMatch = useMatch('/p/:projectId');
  const urlProjectId = routeMatch?.params?.projectId || null;

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

  const loadEditHistory = useCallback((pid) => {
    const id = pid || projectId;
    if (!id) return;
    api.getProject(id).then((p) => setEditHistory(p.edit_history || [])).catch(() => {});
  }, [projectId]);

  // One stage's row on the board, patched in place.
  const patchStage = useCallback((key, patch) => {
    setStages((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }, []);

  // A node's transient lifecycle beat, cleared the moment it settles.
  const clearPhase = useCallback((id) => setPhases((p) => {
    if (!(id in p)) return p;
    const next = { ...p };
    delete next[id];
    return next;
  }), []);

  const handleEvent = useCallback((ev) => {
    if (ev.type === 'node' && ev.node) {
      upsertNode(ev.node);
      // A settled take speaks for itself (verdict / ready), so drop any phase narration; a
      // still-running emit is the preview frame arriving, which keeps its beat.
      if (ev.node.status !== 'running') clearPhase(ev.node.node_id);
      // The Final Film node arrives carrying the stitched cut — surface the download the
      // moment it lands, so the header flips from "Export film" to "Download film" on its own.
      if (ev.node.kind === 'timeline' && ev.node.asset?.url) setExportUrl(ev.node.asset.url);
    }
    // The gate narrating one card in place: frame under review, or re-rolling on a hard fail.
    else if (ev.type === 'node_phase' && ev.node_id) {
      setPhases((p) => ({ ...p, [ev.node_id]: ev.phase }));
    }
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
  }, [upsertNode, pushMsg, patchStage, clearPhase]);

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
      }, ctrl.signal);
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
  }, [handleEvent, fitSoon, pushMsg, loadReferences, loadLedger]);

  // ---- forge a new film ----
  const forge = useCallback(async (idea, settings) => {
    setNodes([]);
    setSelectedId(null);
    setBuilt(false);
    setProgress({});
    setPhases({});
    setStages(seedStages());
    setVis('private');
    setEditHistory([]);
    setMessages((m) => [...m, mkMsg('user', idea)]);
    try {
      const { project_id } = await api.createProject(idea, settings);
      setProjectId(project_id);
      navigate(`/p/${project_id}`);   // the film now has its own URL — refresh/share reopens it
      await runFrom(project_id);
    } catch (e) {
      pushMsg('error', `Something interrupted the forge: ${e.message}`);
    }
  }, [runFrom, pushMsg, navigate]);

  // Forging from the homepage: the landing hands the idea/settings via navigation state and
  // routes here, so the whole streaming forge stays in this one component. Fires once per
  // arrival, then clears the history state so a refresh doesn't re-run it.
  const location = useLocation();
  const forgedFromNav = useRef(false);
  useEffect(() => {
    const f = location.state?.forge;
    if (f && !forgedFromNav.current) {
      forgedFromNav.current = true;
      window.history.replaceState({}, '');
      forge(f.idea, f.settings);
    }
  }, [location, forge]);

  // ---- reopen an existing film ----
  // Hydrates the same state a fresh run fills, from what's already persisted server-side — so
  // "continue where I left off" costs nothing and re-renders nothing. Driven by the URL: the
  // effect below calls this whenever the route points at a film we don't already have loaded.
  const openProject = useCallback(async (pid) => {
    setBusy(true);
    try {
      const p = await api.getProject(pid);
      setProjectId(pid);
      setNodes(p.nodes || []);
      setReferences(p.references || {});
      setEditHistory(p.edit_history || []);
      setExportUrl(p.export_url || null);
      setVis(p.visibility || 'private');
      setSelectedId(null);
      const board = await api.getStages(pid);
      setStages(board.stages);
      setBuilt(board.complete);
      loadLedger(pid);
      fitSoon();
    } catch (e) {
      // A stale or forbidden id (deleted, or another user's) shouldn't strand us on a dead
      // URL — drop back to the library.
      navigate('/', { replace: true });
      pushMsg('error', `Could not open that film: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [loadLedger, fitSoon, pushMsg, navigate]);

  // Clear the canvas back to the empty state — the in-memory half of "go home". Kept separate
  // from navigation so the URL effect can call it (on a back-button to `/`) without looping.
  const clearView = useCallback(() => {
    abortRef.current?.abort();
    setNodes([]); setProjectId(null); setSelectedId(null); setBuilt(false); setBusy(false);
    setReferences({}); setEditHistory([]); setProposal(null); setExportUrl(null); setProgress({}); setPhases({}); setStages(seedStages()); setVis('private');
    setMessages([mkMsg('director', "Give me one idea. I'll direct the whole film — story, cast, locations, keyframes, animated shots, final cut — and log every frame to Backblaze B2.")]);
  }, []);

  // Sync the open film to the URL: open when the route names a film we don't have; clear when
  // it returns to `/` (e.g. the browser back button). Actions that change films navigate();
  // this effect only reacts, so there's a single source of truth.
  useEffect(() => {
    if (urlProjectId && urlProjectId !== projectId && !busy) openProject(urlProjectId);
    else if (!urlProjectId && projectId) clearView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlProjectId]);

  // The empty state's "My films" picker: refresh the list whenever we're back on it.
  useEffect(() => {
    if (projectId) return;
    api.getLibrary().then((r) => setLibrary(r.projects || [])).catch(() => setLibrary([]));
  }, [projectId]);

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
  const regenerate = useCallback(async (node, note, skip = []) => {
    if (!projectId || busy) return;
    setBusy(true);
    if (note) pushMsg('user', note);
    try {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      await api.streamRegenerate(projectId, node.node_id, note, skip, handleEvent, ctrl.signal);
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

  // Add another angle to a scene: a genuinely new still plus its clip, where + Shot only
  // re-animates an existing still. Called from the scene card, so it takes the scene. Additive
  // too — the scene is already written, so this adds coverage and stales nothing. Selects the
  // new frame so its own + Shot follows.
  const addKeyframe = useCallback(async (scene, spec) => {
    if (!projectId || busy) return;
    setBusy(true);
    setShotAt(null);
    try {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      let added = null;
      await api.streamAddKeyframe(projectId, scene.node_id, spec, (ev) => {
        handleEvent(ev);
        if (ev.type === 'node' && ev.node?.kind === 'keyframe') added = ev.node;
      }, ctrl.signal);
      if (added) setSelectedId(added.node_id);
      loadLedger();
    } catch (e) {
      if (e.name !== 'AbortError') pushMsg('error', `That angle failed: ${e.message}`);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, [projectId, busy, handleEvent, pushMsg, loadLedger]);

  // Author the timelined dialogue on a shot and lip-sync it into its existing clip. Additive
  // like + Shot — the clip is already rendered, so this only voices + mouth-edits each line and
  // re-stitches the cut. An empty list clears dialogue and reverts to the clean plate.
  const setDialogue = useCallback(async (shotId, dialogue) => {
    if (!projectId || busy) return;
    setBusy(true);
    try {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      await api.streamSetDialogue(projectId, shotId, dialogue, handleEvent, ctrl.signal);
      loadLedger();
    } catch (e) {
      if (e.name !== 'AbortError') pushMsg('error', `Dialogue sync failed: ${e.message}`);
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

  // Both openers share one dialog; `mode` picks the labels, cost line and submit handler.
  const openShotDialog = useCallback((node) => {
    // Only opens the New-shot modal — it does not select the node, so the detail stays as it
    // was. Opening the detail is the card click's job (see onNodeClick), not this button's.
    setMenu(null);
    setShotAt({ node, mode: 'shot' });
  }, []);

  const openKeyframeDialog = useCallback((node) => {
    setMenu(null);
    setShotAt({ node, mode: 'keyframe' });
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
  // A note doesn't apply — it proposes. The director reads the proposal above the input and
  // approves, edits or drops it; nothing is written or re-rendered until they do.
  const proposeEdit = useCallback(async (instruction, refs = []) => {
    if (!projectId || busy || proposal || proposalRequestRef.current) return false;
    proposalRequestRef.current = true;
    pushMsg('user', instruction);
    const target = refs[0]?.nodeId || selectedId;
    try {
      const p = await api.proposeEdit(projectId, instruction, target);
      if (p.ok) {
        setProposal(p);
        return true;
      }
      pushMsg('error', p.reason || "I couldn't work out what that note meant.");
    } catch (e) {
      pushMsg('error', `I couldn't read that note: ${e.message}`);
    } finally {
      proposalRequestRef.current = false;
    }
    return false;
  }, [projectId, busy, proposal, selectedId, pushMsg]);

  const applyProposal = useCallback(async (p) => {
    if (!projectId || busy) return;
    setBusy(true);
    setProposal(null);
    try {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      await api.applyEdit(projectId, p, handleEvent, ctrl.signal);
      loadReferences();
      loadEditHistory();
    } catch (e) {
      if (e.name !== 'AbortError') pushMsg('error', `That edit failed: ${e.message}`);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, [projectId, busy, handleEvent, pushMsg, loadReferences, loadEditHistory]);

  const discardProposal = useCallback(() => setProposal(null), []);

  // Undo is LIFO — it always reverses the latest standing edit. A free undo (nothing had
  // rendered) applies straight away so the click feels like a real undo; one that would
  // re-render lands as a proposal first, so its cost is seen before it's paid.
  const undoEdit = useCallback(async (edit) => {
    if (busy || proposal || proposalRequestRef.current) return false;
    proposalRequestRef.current = true;
    try {
      const p = await api.proposeEdit(projectId, 'Undo that edit', edit?.target_node_id);
      if (!p.ok) {
        pushMsg('error', p.reason || "There's nothing to undo yet.");
        return false;
      }
      if (p.rendered || p.impact?.stale?.length) setProposal(p);
      else await applyProposal(p);
      return true;
    } catch (e) {
      pushMsg('error', `I couldn't undo that: ${e.message}`);
      return false;
    } finally {
      proposalRequestRef.current = false;
    }
  }, [projectId, busy, proposal, pushMsg, applyProposal]);

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
      pushMsg('error', `Could not switch version: ${e.message}`);
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

  // "New" opens a fresh forge; the URL effect clears the canvas when the route leaves /p/:id.
  const reset = useCallback(() => { navigate('/studio'); }, [navigate]);

  // ---- share: make the film public, then hand out its link ----
  // Public means two things at once — reachable by anyone at /share/:id, and listed in the
  // homepage template gallery. Private returns it to owner-only.
  const toggleVisibility = useCallback(async () => {
    if (!projectId || busy) return;
    const next = visibility === 'public' ? 'private' : 'public';
    try {
      await api.setVisibility(projectId, next);
      setVis(next);
      flash(next === 'public'
        ? 'Public — anyone with the link can view, and it now shows in the gallery'
        : 'Private — only you can see this film');
    } catch (e) {
      pushMsg('error', `Could not change visibility: ${e.message}`);
    }
  }, [projectId, busy, visibility, flash, pushMsg]);

  const copyShareLink = useCallback(async () => {
    const url = `${window.location.origin}/share/${projectId}`;
    try {
      await navigator.clipboard.writeText(url);
      flash('Share link copied to clipboard');
    } catch {
      flash(url);
    }
  }, [projectId, flash]);

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
    () => buildGraph(nodes, { selectedId, impactIds, onAddShot: openShotDialog,
                              onAddKeyframe: openKeyframeDialog, phases }),
    [nodes, selectedId, impactIds, openShotDialog, openKeyframeDialog, phases]
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
    <div className={`app${hasGraph ? '' : ' empty'}`}>
      <header className="topbar">
        <div className="brand" onClick={() => navigate('/')} style={{ cursor: 'pointer' }} title="Home">
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
          {projectId && (
            <>
              <button
                className={`btn vis-toggle ${visibility}`}
                onClick={toggleVisibility}
                disabled={busy}
                title={visibility === 'public'
                  ? 'Public — anyone with the link can view. Click to make private.'
                  : 'Private — only you can see this. Click to make public.'}
              >
                {visibility === 'public' ? '🌐 Public' : '🔒 Private'}
              </button>
              {visibility === 'public' && (
                <button className="btn" onClick={copyShareLink} title="Copy the share link">Share</button>
              )}
            </>
          )}
          <button className="btn" onClick={reset}>New</button>
          {authEnabled && (
            <button
              className="btn"
              onClick={async () => {
                navigate('/');
                await signOut();
              }}
              title={session?.user?.email ? `Signed in as ${session.user.email}` : 'Sign out'}
            >
              Sign out
            </button>
          )}
          <div className="zoomer">
            <button onClick={() => rf.zoomOut()} title="Zoom out">−</button>
            <span>{zoom}%</span>
            <button onClick={() => rf.zoomIn()} title="Zoom in">+</button>
          </div>
        </div>
      </header>

      <div className="body">
        {/* The empty state is one idea in, nothing else — the director rail and its "forge a
            film first" composer only earn their column once a film exists to talk about. */}
        {hasGraph && (
          <Rail
            messages={messages}
            // A note is the main way to fix what a gate is holding, so edits unlock at the
            // gate rather than only once the whole film is finished.
            canEdit={!!projectId && (built || !!openGate)}
            nodes={nodes}
            stages={stages}
            targetNode={selectedNode && ['character', 'environment', 'scene', 'keyframe', 'shot'].includes(selectedNode.kind) ? selectedNode : null}
            onClearTarget={() => setSelectedId(null)}
            onFocusNode={setSelectedId}
            onPropose={proposeEdit}
            proposal={proposal}
            editHistory={editHistory}
            onUndoEdit={undoEdit}
            onApplyProposal={applyProposal}
            onDiscardProposal={discardProposal}
            busy={busy}
            progress={progress}
            current={currentStage}
            openGate={openGate}
            onApproveStage={approveStage}
            onHoldStage={holdStage}
            onSelectNode={setSelectedId}
            impact={impact}
            onRegenerate={regenerate}
            onToggleLock={toggleLock}
          />
        )}

        <div className="stage">
          {!hasGraph && <Hero onForge={forge} busy={busy} />}

          {/* Coming back to a film you already started: the empty state doubles as a library.
              Only rendered when there's something to reopen, so a first-time canvas stays clean. */}
          {!hasGraph && library.length > 0 && (
            <div className="library">
              <div className="library-head">Your films</div>
              <div className="library-grid">
                {library.map((f) => (
                  <button
                    key={f.project_id}
                    className="library-card"
                    onClick={() => navigate(`/p/${f.project_id}`)}
                    disabled={busy}
                    title={f.idea || f.title}
                  >
                    <div className="library-cover" style={f.cover ? { backgroundImage: `url(${f.cover})` } : undefined}>
                      {!f.cover && <span className="library-cover-empty">CineForge</span>}
                    </div>
                    <div className="library-meta">
                      <div className="library-title">{f.title || 'Untitled Film'}</div>
                      <div className="library-sub">{f.node_count} nodes{f.export_url ? ' · exported' : ''}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            onNodeClick={(e, n) => {
              // Clicking a card only opens its detail. The New-shot modal is a decision
              // surface that covers the canvas, so it must not compete with the Inspector —
              // it opens only from the card's explicit + Shot button (see openShotDialog).
              setSelectedId(n.id);
              setMenu(null);
            }}
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
              key={selectedNode.node_id}
              node={selectedNode}
              busy={busy}
              onClose={() => setSelectedId(null)}
              onRegenerate={(n, note) => regenerate(n, note)}
              references={references}
              onSelectNode={(id) => setSelectedId(id)}
              onSelectEntity={(entityId) => {
                const hit = nodes.find((n) => n.data?.id === entityId
                  && (n.kind === 'character' || n.kind === 'environment'));
                if (hit) setSelectedId(hit.node_id);
              }}
              onRename={(newName) => renameEntity(selectedNode.data?.id, newName)}
              onSelectVersion={selectVersion}
              sceneShots={sceneShots}
              entityNodes={entityNodes}
              onAcceptQC={acceptQC}
              onReviewQC={reviewQC}
              onSetDialogue={setDialogue}
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
              mode={shotAt.mode}
              busy={busy}
              onClose={() => setShotAt(null)}
              onSubmit={shotAt.mode === 'keyframe' ? addKeyframe : addShot}
              onSuggest={suggestShot}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// The studio is the only surface that requires a signed-in caller (when auth is on). The
// landing, share and login pages are public, so the gate lives here per-route rather than
// wrapping the whole app.
function StudioGate({ session }) {
  if (authEnabled && !session) return <Navigate to="/login" replace />;
  return <Studio session={session} />;
}

// The login page has no reason to show once you're in — bounce straight to the studio. With
// auth off there is nothing to sign into, so the same redirect applies.
function LoginRoute({ session }) {
  if (!authEnabled || session) return <Navigate to="/studio" replace />;
  return <Login />;
}

// CineForge is a visual studio — a living node canvas, a director rail and an inspector that
// all need width to work. Rather than reflow all of that onto a phone, we gate small screens
// behind a plain, friendly notice. Purely CSS-driven (a fixed overlay revealed under the
// breakpoint), so there's no resize bookkeeping and it covers whatever is behind it.
function MobileGate() {
  return (
    <div className="mobile-gate">
      <div className="mobile-gate-inner">
        <div className="hero-mark">Cine<em>Forge</em></div>
        <div className="mg-badge">Desktop experience</div>
        <h1>Best seen on the big screen</h1>
        <p>
          CineForge directs a whole film on a living canvas — screenplay, cast, keyframes and
          shots laid out side by side. That workspace needs room to breathe, so it isn't ready
          for phones just yet.
        </p>
        <p className="mg-hint">Open CineForge on a laptop or desktop — a window at least 900px wide — to start forging.</p>
      </div>
    </div>
  );
}

export default function App() {
  // undefined while we're still resolving the session (avoids a flash of the login gate);
  // null = signed out; an object = signed in. With auth off this settles to a stand-in
  // session immediately, so the gate never shows.
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    let alive = true;
    getSession().then((s) => {
      if (!alive) return;
      api.setAuthToken(s?.access_token || null);
      setSession(s);
    });
    const unsub = onAuthChange((s) => {
      api.setAuthToken(s?.access_token || null);
      setSession(s);
    });
    return () => { alive = false; unsub(); };
  }, []);

  if (session === undefined) return <><MobileGate /><div className="app empty" /></>;

  return (
    <>
      <MobileGate />
      <BrowserRouter>
        <ReactFlowProvider>
          <Routes>
            <Route path="/" element={<Landing session={session} />} />
            <Route path="/login" element={<LoginRoute session={session} />} />
            <Route path="/studio" element={<StudioGate session={session} />} />
            <Route path="/p/:projectId" element={<StudioGate session={session} />} />
            <Route path="/share/:projectId" element={<Showcase session={session} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ReactFlowProvider>
      </BrowserRouter>
    </>
  );
}
