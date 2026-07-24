// The QC vocabulary, mirrored from the backend's checklist.
//
// A verdict on its own is a label. What makes the gate trustworthy is being able to see
// *which* criterion failed, how badly, what the judge was looking at when it decided, and
// whether it could see at all — so all of that has names here.

export const CRITICAL = new Set(['identity', 'continuity', 'brief']);

const VERDICT = {
  PASS:       { label: 'Pass',         color: 'var(--green)' },
  BORDERLINE: { label: 'Borderline',   color: 'var(--amber)' },
  FAIL:       { label: 'Fail',         color: 'var(--red)' },
  FLAGGED:    { label: 'Flagged',      color: 'var(--red)' },
  SKIPPED:    { label: 'Not reviewed', color: 'var(--faint)' },
  ERROR:      { label: 'Review error', color: 'var(--red)' },
};

export const verdictColor = (v) => VERDICT[v]?.color || 'var(--faint)';
export const verdictLabel = (v) => VERDICT[v]?.label || v || '—';

// What each criterion actually asks of a frame. Shown when the judge left no note, so a
// failure always explains itself rather than just naming a word.
export const CRITERION = {
  brief: 'Every detail the description specifies — age, build, hair, wardrobe, architecture, props — is present and correct.',
  plate: 'A clean reference sheet: neutral background, orthographic identity view.',
  emptiness: 'An establishing plate with no people in it.',
  identity: 'The person in frame is the same character as the reference sheet — face first.',
  environment: 'The location matches its plate and its written description.',
  framing: 'The requested shot size and angle, subject off-centre, with a foreground layer.',
  continuity: 'The clip still matches the keyframe it was animated from.',
  motion: 'Coherent real-time movement — no morphing, no slideshow.',
  style: 'Grade, lens character and lighting match the film’s locked style.',
  integrity: 'No mangled hands, extra limbs, warped faces or garbled text.',
};

// A judgement is only worth as much as what the judge could actually see.
export const SOURCE = {
  vision: 'A vision model looked at the frames.',
  mock: 'Mock review — placeholder pixels carry nothing real to judge.',
  unavailable: 'The asset could not be sampled, so nothing was reviewed.',
  error: 'The reviewer itself failed.',
};

export const isSighted = (r) => r?.source === 'vision';

// Whether a human still owes this asset a look.
export const needsReview = (v) => v === 'FAIL' || v === 'BORDERLINE' || v === 'ERROR';

export const failedChecks = (r) => (r?.checks || []).filter((c) => !c.ok);

// The reviewer's own voice, for the rail. Mirrors the backend's phrasing so a verdict reads
// the same whether it arrived on the run's stream or from a re-review asked for by hand.
export function headline(r) {
  if (!r) return '';
  if (r.verdict === 'PASS') return 'Reviewed — clean.';
  if (r.verdict === 'SKIPPED') return r.summary || 'Not reviewed.';
  const bad = failedChecks(r).map((c) => c.criterion).join(', ');
  const v = String(r.verdict || '').toLowerCase();
  return bad ? `Reviewed — ${v} on ${bad}.` : `Reviewed — ${v}.`;
}
