// The stage vocabulary, mirrored from the backend's STAGE_KEYS / STAGE_LABELS.
//
// The film is produced in gated passes rather than one sweep, and the order matters: each
// pass costs more than the last and inherits its mistakes, which is what makes the gate
// between them worth stopping at.

export const STAGE_KEYS = ['synthesis', 'sheets', 'keyframes', 'video'];

export const STAGE_LABEL = {
  synthesis: 'Story bible',
  sheets: 'Reference sheets',
  keyframes: 'Keyframes',
  video: 'Video',
};

// What a stage's status means for the run, in the run's own terms.
export const STAGE_STATUS = {
  pending: { label: 'Queued', mark: '·', color: 'var(--faint)' },
  running: { label: 'Working', mark: '›', color: 'var(--gold)' },
  awaiting: { label: 'Waiting on you', mark: '⏸', color: 'var(--gold)' },
  blocked: { label: 'Held', mark: '!', color: 'var(--amber)' },
  approved: { label: 'Approved', mark: '✓', color: 'var(--green)' },
  failed: { label: 'Failed', mark: '✕', color: 'var(--red)' },
};

export const stageStatus = (s) => STAGE_STATUS[s] || STAGE_STATUS.pending;

// Whether the run has stopped and is waiting on a decision.
export const isOpenGate = (s) => s === 'awaiting' || s === 'blocked';
