// Thin client over the CineForge API. The generate/edit/regenerate endpoints stream
// Server-Sent Events; we POST/GET and parse the `data:` frames ourselves (EventSource
// can't POST), invoking onEvent for each StageEvent as it arrives so the canvas blooms live.

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export async function getHealth() {
  const r = await fetch('/api/health');
  if (!r.ok) throw new Error('health check failed');
  return r.json();
}

export async function createProject(idea, settings, gateMode) {
  const r = await fetch('/api/projects', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ idea, settings: settings || null, gate_mode: gateMode || null }),
  });
  if (!r.ok) throw new Error('could not create project');
  return r.json(); // { project_id, gate_mode }
}

// Stream any SSE endpoint, calling onEvent(parsedEvent) per frame.
// Returns an AbortController so the caller can cancel an in-flight run.
async function streamSSE(url, { method = 'GET', body } = {}, onEvent, signal) {
  const res = await fetch(url, {
    method,
    headers: body ? JSON_HEADERS : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`stream failed (${res.status})`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line.
    let sep;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const line = frame.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(6)));
      } catch {
        /* ignore malformed frame */
      }
    }
  }
}

// The staged run. Called with no arguments this both starts a film and continues one —
// stages that already cleared their gate are skipped — so after approving a gate the
// client's whole job is to call this again.
export function streamRun(projectId, onEvent, signal, { stopAfter, gateMode } = {}) {
  const q = new URLSearchParams();
  if (stopAfter) q.set('stop_after', stopAfter);
  if (gateMode) q.set('gate_mode', gateMode);
  const qs = q.toString();
  return streamSSE(`/api/projects/${projectId}/run${qs ? `?${qs}` : ''}`, {}, onEvent, signal);
}

// The stage board — what is done, what is open, and what the run is waiting on.
export async function getStages(projectId) {
  const r = await fetch(`/api/projects/${projectId}/stages`);
  if (!r.ok) throw new Error('could not load the stage board');
  return r.json();
}

// Open a gate. The reviewer's verdict is left as filed; the override is recorded beside it.
export async function approveStage(projectId, stage, note) {
  const r = await fetch('/api/stages/approve', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ project_id: projectId, stage, note: note || null }),
  });
  if (!r.ok) throw new Error('could not approve that stage');
  return r.json();
}

// Hold a stage the gate was willing to pass — the director's own veto.
export async function holdStage(projectId, stage, note) {
  const r = await fetch('/api/stages/hold', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ project_id: projectId, stage, note: note || null }),
  });
  if (!r.ok) throw new Error('could not hold that stage');
  return r.json();
}

export async function getProject(projectId) {
  const r = await fetch(`/api/projects/${projectId}`);
  if (!r.ok) throw new Error('could not load project');
  return r.json();
}

// What a change would cost, before committing to it: `rewritten` is free text
// re-resolution, `stale` is media that has to be paid for again.
export async function getImpact(projectId, nodeId, change = 'semantic') {
  const r = await fetch(`/api/projects/${projectId}/impact?node_id=${nodeId}&change=${change}`);
  if (!r.ok) throw new Error('could not compute impact');
  return r.json();
}

// The run's QC record — counts, pass rate, what the gate cost, and the queue of assets a
// human still has to look at.
export async function getQC(projectId) {
  const r = await fetch(`/api/projects/${projectId}/qc`);
  if (!r.ok) throw new Error('could not load the QC ledger');
  return r.json();
}

// A second opinion on pixels that already exist. Costs one text call, renders nothing —
// which is what makes it a different decision from re-rendering.
export async function reviewQC(projectId, nodeId) {
  const r = await fetch('/api/qc/review', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ project_id: projectId, node_id: nodeId }),
  });
  if (!r.ok) throw new Error('re-review failed');
  return r.json();
}

// Keep a take the gate did not clear. The verdict stands; the override is recorded next to it.
export async function acceptQC(projectId, nodeId) {
  const r = await fetch('/api/qc/accept', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ project_id: projectId, node_id: nodeId }),
  });
  if (!r.ok) throw new Error('could not record the override');
  return r.json();
}

// Rename an entity everywhere. Regenerates nothing.
export async function renameEntity(projectId, entityId, newName) {
  const r = await fetch('/api/entities/rename', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ project_id: projectId, entity_id: entityId, new_name: newName }),
  });
  if (!r.ok) throw new Error('rename failed');
  return r.json();
}

// Accept an earlier take. Costs nothing — that asset is already rendered and stored.
export async function selectVersion(projectId, nodeId, version) {
  const r = await fetch('/api/versions/select', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ project_id: projectId, node_id: nodeId, version }),
  });
  if (!r.ok) throw new Error('could not switch take');
  return r.json();
}

// Lock a node so regeneration passes over it.
export async function lockNode(projectId, nodeId, locked) {
  const r = await fetch('/api/nodes/lock', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ project_id: projectId, node_id: nodeId, locked }),
  });
  if (!r.ok) throw new Error('could not change the lock');
  return r.json();
}

export async function exportFilm(projectId) {
  const r = await fetch(`/api/projects/${projectId}/export`, { method: 'POST' });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.detail || 'export failed');
  return body;
}

export function streamRegenerate(projectId, nodeId, note, onEvent, signal) {
  return streamSSE('/api/regenerate', {
    method: 'POST',
    body: { project_id: projectId, node_id: nodeId, note: note || null },
  }, onEvent, signal);
}

// What to shoot next on this frame, and why. Read-only — renders nothing.
export async function suggestShot(projectId, keyframeId) {
  const r = await fetch(`/api/shots/suggest?project_id=${projectId}&keyframe_id=${keyframeId}`);
  if (!r.ok) throw new Error('could not read the scene');
  return r.json();
}

// Shoot one more setup off an existing keyframe. Purely additive — nothing goes stale.
export function streamAddShot(projectId, keyframeId, spec, onEvent, signal) {
  return streamSSE('/api/shots/add', {
    method: 'POST',
    body: {
      project_id: projectId,
      keyframe_id: keyframeId,
      shot: spec.shot || null,
      angle: spec.angle || null,
      move: spec.move || null,
      note: spec.note || null,
    },
  }, onEvent, signal);
}

export function streamEdit(projectId, instruction, targetNodeId, onEvent, signal) {
  return streamSSE('/api/edit', {
    method: 'POST',
    body: { project_id: projectId, instruction, target_node_id: targetNodeId || null },
  }, onEvent, signal);
}
