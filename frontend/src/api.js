// Thin client over the CineForge API. The generate/edit/regenerate endpoints stream
// Server-Sent Events; we POST/GET and parse the `data:` frames ourselves (EventSource
// can't POST), invoking onEvent for each StageEvent as it arrives so the canvas blooms live.

// The Supabase access token for the signed-in user, kept in sync by App via setAuthToken.
// When auth is off (no Supabase env) this stays null and no Authorization header is sent —
// the backend then treats every request as the single `local` user.
let authToken = null;
export function setAuthToken(t) { authToken = t || null; }
const authHeader = () => (authToken ? { Authorization: `Bearer ${authToken}` } : {});
const jsonHeaders = () => ({ 'Content-Type': 'application/json', ...authHeader() });

export async function createProject(idea, settings) {
  const r = await fetch('/api/projects', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ idea, settings: settings || null }),
  });
  if (!r.ok) throw new Error('could not create project');
  return r.json(); // { project_id }
}

// Stream any SSE endpoint, calling onEvent(parsedEvent) per frame.
// Returns an AbortController so the caller can cancel an in-flight run.
async function streamSSE(url, { method = 'GET', body } = {}, onEvent, signal) {
  const res = await fetch(url, {
    method,
    headers: body ? jsonHeaders() : authHeader(),
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
// the pass that already cleared its gate is skipped — so after approving a gate the
// client's whole job is to call this again. Every pass stops for the director.
export function streamRun(projectId, onEvent, signal) {
  return streamSSE(`/api/projects/${projectId}/run`, {}, onEvent, signal);
}

// The stage board — what is done, what is open, and what the run is waiting on.
export async function getStages(projectId) {
  const r = await fetch(`/api/projects/${projectId}/stages`, { headers: authHeader() });
  if (!r.ok) throw new Error('could not load the stage board');
  return r.json();
}

// Open a gate. The reviewer's verdict is left as filed; the override is recorded beside it.
export async function approveStage(projectId, stage, note) {
  const r = await fetch('/api/stages/approve', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ project_id: projectId, stage, note: note || null }),
  });
  if (!r.ok) throw new Error('could not approve that stage');
  return r.json();
}

// Hold a stage the gate was willing to pass — the director's own veto.
export async function holdStage(projectId, stage, note) {
  const r = await fetch('/api/stages/hold', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ project_id: projectId, stage, note: note || null }),
  });
  if (!r.ok) throw new Error('could not hold that stage');
  return r.json();
}

export async function getProject(projectId) {
  const r = await fetch(`/api/projects/${projectId}`, { headers: authHeader() });
  if (!r.ok) throw new Error('could not load project');
  return r.json();
}

// The caller's films — one card each. Scoped to the signed-in user by the backend when auth
// is on; every project when it's off.
export async function getLibrary() {
  const r = await fetch('/api/library', { headers: authHeader() });
  if (!r.ok) throw new Error('could not load your films');
  return r.json(); // { projects: [{ project_id, title, idea, cover, node_count, export_url }] }
}

// The public template gallery — every film its owner marked public. No auth required, but
// a token is sent when present so an owner sees their own public films here too.
export async function getGallery() {
  const r = await fetch('/api/gallery', { headers: authHeader() });
  if (!r.ok) throw new Error('could not load the gallery');
  return r.json(); // { projects: [{ project_id, title, idea, cover, node_count, export_url, visibility }] }
}

// A public film, read-only — the target of a share link and the template preview. 404s for
// anything not public (or since re-privatised), which the caller surfaces as "not found".
export async function getPublicProject(projectId) {
  const r = await fetch(`/api/public/projects/${projectId}`, { headers: authHeader() });
  if (!r.ok) throw new Error('this film is private or no longer exists');
  return r.json();
}

// Make a film public (shareable + listed in the gallery) or private again. Owner only.
export async function setVisibility(projectId, visibility) {
  const r = await fetch(`/api/projects/${projectId}/visibility`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ visibility }),
  });
  if (!r.ok) throw new Error('could not change visibility');
  return r.json(); // { project_id, visibility }
}

// Fork a public (or owned) film into a new editable project the caller owns — "Use template".
export async function cloneProject(projectId) {
  const r = await fetch(`/api/projects/${projectId}/clone`, { method: 'POST', headers: authHeader() });
  if (!r.ok) throw new Error('could not use this template');
  return r.json(); // { project_id }
}

// What a change would cost, before committing to it: `rewritten` is free text
// re-resolution, `stale` is media that has to be paid for again.
export async function getImpact(projectId, nodeId, change = 'semantic') {
  const r = await fetch(`/api/projects/${projectId}/impact?node_id=${nodeId}&change=${change}`,
    { headers: authHeader() });
  if (!r.ok) throw new Error('could not compute impact');
  return r.json();
}

// The run's QC record — counts, pass rate, what the gate cost, and the queue of assets a
// human still has to look at.
export async function getQC(projectId) {
  const r = await fetch(`/api/projects/${projectId}/qc`, { headers: authHeader() });
  if (!r.ok) throw new Error('could not load the QC ledger');
  return r.json();
}

// A second opinion on pixels that already exist. Costs one text call, renders nothing —
// which is what makes it a different decision from re-rendering.
export async function reviewQC(projectId, nodeId) {
  const r = await fetch('/api/qc/review', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ project_id: projectId, node_id: nodeId }),
  });
  if (!r.ok) throw new Error('re-review failed');
  return r.json();
}

// Keep a take the gate did not clear. The verdict stands; the override is recorded next to it.
export async function acceptQC(projectId, nodeId) {
  const r = await fetch('/api/qc/accept', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ project_id: projectId, node_id: nodeId }),
  });
  if (!r.ok) throw new Error('could not record the override');
  return r.json();
}

// Rename an entity everywhere. Regenerates nothing.
export async function renameEntity(projectId, entityId, newName) {
  const r = await fetch('/api/entities/rename', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ project_id: projectId, entity_id: entityId, new_name: newName }),
  });
  if (!r.ok) throw new Error('rename failed');
  return r.json();
}

// Accept an earlier take. Costs nothing — that asset is already rendered and stored.
export async function selectVersion(projectId, nodeId, version) {
  const r = await fetch('/api/versions/select', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ project_id: projectId, node_id: nodeId, version }),
  });
  if (!r.ok) throw new Error('could not switch version');
  return r.json();
}

// Lock a node so regeneration passes over it.
export async function lockNode(projectId, nodeId, locked) {
  const r = await fetch('/api/nodes/lock', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ project_id: projectId, node_id: nodeId, locked }),
  });
  if (!r.ok) throw new Error('could not change the lock');
  return r.json();
}

export async function exportFilm(projectId) {
  const r = await fetch(`/api/projects/${projectId}/export`, { method: 'POST', headers: authHeader() });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.detail || 'export failed');
  return body;
}

export function streamRegenerate(projectId, nodeId, note, skip, onEvent, signal) {
  return streamSSE('/api/regenerate', {
    method: 'POST',
    body: { project_id: projectId, node_id: nodeId, note: note || null, skip: skip || [] },
  }, onEvent, signal);
}

// What to shoot next on this scene, and why. Read-only — renders nothing. `nodeId` is the
// scene (+ Keyframe) or one of its frames (+ Shot); the backend reads the same scene either way.
export async function suggestShot(projectId, nodeId) {
  const r = await fetch(`/api/shots/suggest?project_id=${projectId}&node_id=${nodeId}`,
    { headers: authHeader() });
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

// Add another angle to the scene: a genuinely new still plus its one clip. Also additive —
// the scene is already written, so this only adds coverage and stales nothing.
export function streamAddKeyframe(projectId, sceneId, spec, onEvent, signal) {
  return streamSSE('/api/keyframes/add', {
    method: 'POST',
    body: {
      project_id: projectId,
      scene_id: sceneId,
      shot: spec.shot || null,
      angle: spec.angle || null,
      move: spec.move || null,
      note: spec.note || null,
    },
  }, onEvent, signal);
}

// Author the timelined dialogue on a shot and lip-sync it into the existing clip. Additive —
// the clip is already rendered, so this only voices + mouth-edits each line and re-stitches the
// cut. `dialogue` is the shot's whole cue list ([{character, text, start, voice_id?}]); an empty
// list clears it and reverts to the clean plate.
export function streamSetDialogue(projectId, shotId, dialogue, onEvent, signal) {
  return streamSSE('/api/shots/dialogue', {
    method: 'POST',
    body: { project_id: projectId, shot_id: shotId, dialogue: dialogue || [] },
  }, onEvent, signal);
}

export function streamEdit(projectId, instruction, targetNodeId, onEvent, signal) {
  return streamSSE('/api/edit', {
    method: 'POST',
    body: { project_id: projectId, instruction, target_node_id: targetNodeId || null },
  }, onEvent, signal);
}

// Read a note against the graph and describe the change — writes nothing. The answer is a
// proposal the composer shows above the input for the director to approve, tweak or drop.
export async function proposeEdit(projectId, instruction, targetNodeId) {
  const r = await fetch('/api/edit/propose', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ project_id: projectId, instruction, target_node_id: targetNodeId || null }),
  });
  if (!r.ok) throw new Error('could not read that note');
  return r.json();
}

// Execute an approved proposal. The only half of an edit that writes or spends a render.
export function applyEdit(projectId, proposal, onEvent, signal) {
  return streamSSE('/api/edit/apply', {
    method: 'POST',
    body: {
      project_id: projectId,
      target_node_id: proposal.target.node_id,
      change: proposal.change,
      field: proposal.field || null,
      to: proposal.to ?? null,
      note: proposal.note || null,
      new_name: proposal.new_name || null,
      edit_id: proposal.edit_id || null,
    },
  }, onEvent, signal);
}
