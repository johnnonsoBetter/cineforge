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

// ---------------------------------------------------------------------------
// The recommended action — the cheapest thing that could resolve this verdict.
// ---------------------------------------------------------------------------
//
// Three operations resolve a flagged asset, and they cost wildly different things: a
// re-review re-reads pixels that already exist (a text call, no render); checking out an
// earlier take costs nothing; a re-render spends the budget and stales everything downstream.
// So the menu must never *default* to re-render — it reads the asset's state and names the
// cheapest action that could actually resolve it, then lets the director overrule that.
//
// This is a pure function of what the report and node already carry — the same fields the
// backend computed — so it adds no round-trip and no new state.

// Mirrors the backend budget (config: QC_MAX_REGENS / QC_MAX_VIDEO_REGENS). A re-animation
// costs minutes and real money where a re-frame costs cents, so video gets one aimed
// re-render and stills get two.
export const REGEN_BUDGET = { video: 1, still: 2 };

const budgetFor = (node) => (node?.kind === 'shot' ? REGEN_BUDGET.video : REGEN_BUDGET.still);

// An earlier take that already passes everything the current one fails — the optimal take is
// often one you already paid for. Must have been sighted, must clear every failing criterion.
// Prefer a clean PASS, newest first.
function betterEarlierTake(node, report) {
  const failing = failedChecks(report).map((c) => c.criterion);
  if (!failing.length) return null;
  const head = node?.accepted_version;
  const clears = (v) =>
    v?.qc && isSighted(v.qc) &&
    failing.every((crit) => (v.qc.checks || []).some((c) => c.criterion === crit && c.ok));
  return (node?.versions || [])
    .filter((v) => v.version !== head && clears(v))
    .sort((a, b) => (b.qc.verdict === 'PASS') - (a.qc.verdict === 'PASS') || b.version - a.version)[0]
    || null;
}

// A director's note aimed at exactly what failed, seeded from the judge's own words — so the
// next render is corrective, not a blind re-roll. The note replaces rather than stacks, so
// it stands alone.
function aimedNote(checks) {
  const seed = checks.map((c) => (c.note || '').trim()).filter(Boolean).join('; ');
  return seed || null;
}

// Returns { key, label, cost, why, note?, version? } for the cheapest resolving action, or
// null when a sighted PASS leaves nothing to resolve. key ∈ review | regenerate | select |
// accept | flag.
export function recommendAction(node, report) {
  if (!report) return null;
  const spent = node?.attempt || 0;
  const remaining = budgetFor(node) - spent;

  // A render that never produced pixels can only be fixed by rendering again.
  if (report.verdict === 'ERROR') {
    return remaining > 0
      ? { key: 'regenerate', label: '↻ Re-render', cost: 'render',
          note: 'The render failed before producing frames.',
          why: 'The render failed before it produced anything to judge. Re-render to try again.' }
      : { key: 'flag', label: 'Needs a human', cost: 'none',
          why: 'The render keeps failing and the budget is spent. This needs a human.' };
  }

  // 1. Trust before quality. You cannot pay to fix a verdict a sighted judge never gave — a
  //    mock or skipped review judged pixels nobody looked at. Re-review before a re-render.
  if (!isSighted(report)) {
    return { key: 'review', label: '⟳ Re-review', cost: 'text',
             why: 'This verdict came from a review that never saw the pixels. Re-review before paying to re-render.' };
  }

  if (report.verdict === 'PASS') return null;

  const failing = failedChecks(report);
  const crit = failing.filter((c) => CRITICAL.has(c.criterion));

  // 2. A soft miss (one non-critical criterion) is a taste call — the cheapest resolution is
  //    free. Keep the take you already have rather than paying for a coin flip.
  if (report.verdict === 'BORDERLINE') {
    return { key: 'accept', label: 'Keep as is', cost: 'free',
             why: `A single soft miss on ${failing.map((c) => c.criterion).join(', ')}. Keeping it clears the flag for free; a re-render spends budget on a taste call.` };
  }

  // 3. A real fail. The optimal take is often one you already paid for — if an earlier take
  //    already passes everything this one fails, switching to it costs nothing.
  const earlier = betterEarlierTake(node, report);
  if (earlier) {
    return { key: 'select', label: `Compare version ${earlier.version}`, version: earlier.version, cost: 'free',
             why: `Version ${earlier.version} already passes ${failing.map((c) => c.criterion).join(', ')} and is already made. Compare it with the one in use, then switch — costs nothing.` };
  }

  // 4. Nothing cheaper is left: an aimed re-render while budget remains, seeded from what the
  //    judge said failed so the next take is corrective, not a blind re-roll.
  if (remaining > 0) {
    const aim = (crit.length ? crit : failing).map((c) => c.criterion).join(' & ');
    return { key: 'regenerate', label: '↻ Re-render aimed', cost: 'render',
             note: aimedNote(crit.length ? crit : failing),
             why: `${aim} is wrong in the frame — a re-read can't move pixels. Re-render aimed at what failed (${remaining} left).` };
  }

  // 5. Budget spent, still failing: hold the bar. The tool will not recommend an override
  //    here — that would let the ledger claim a pass the reviewer never gave.
  return { key: 'flag', label: 'Needs a human', cost: 'none',
           why: 'The re-render budget is spent and a critical check still fails. Hold the bar — this is a human call, not an override.' };
}
