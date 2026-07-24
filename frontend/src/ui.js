// Small shared bits of presentation vocabulary used across the canvas and inspector.

export const KIND_LABEL = {
  story: 'Story',
  character: 'Character',
  environment: 'Location',
  scene: 'Scene',
  keyframe: 'Keyframe',
  shot: 'Shot',
  timeline: 'Final Cut',
};

const C = {
  ready: 'var(--green)',
  running: 'var(--gold)',
  stale: 'var(--amber)',
  flagged: 'var(--red)',
  failed: 'var(--red)',
  pending: 'var(--faint)',
};

export const statusColor = (s) => C[s] || 'var(--faint)';

export const STATUS_LABEL = {
  ready: 'Ready',
  running: 'Working',
  stale: 'Stale',
  flagged: 'Flagged',
  failed: 'Failed',
  pending: 'Queued',
};

// Suggestion ideas for the hero empty state (match the design's tone).
export const SUGGESTIONS = [
  'A comedy about a Nigerian man who arrives at a wedding expecting VIP treatment.',
  'A lonely lighthouse keeper who befriends a storm.',
  'Two rival food trucks fall in love over one long night market.',
];

// Production settings. Each of these reaches generation: length sets the scene count,
// style leads the prompt's style block, format is the ratio frames are rendered at, and
// language is the language dialogue is written in.
export const SETTING_GROUPS = [
  ['length_min', 'Length', [[1, '1 min'], [3, '3 min'], [5, '5 min']]],
  ['style_preset', 'Style', [
    ['cinematic', 'Cinematic'], ['pixar', 'Pixar'], ['anime', 'Anime'],
    ['ghibli', 'Ghibli'], ['photorealistic', 'Photoreal'],
  ]],
  ['aspect', 'Format', [['16:9', 'Landscape'], ['9:16', 'Vertical'], ['1:1', 'Square']]],
  ['language', 'Dialogue', [
    ['English', 'English'], ['Igbo', 'Igbo'], ['Yoruba', 'Yoruba'], ['Nigerian Pidgin', 'Pidgin'],
  ]],
];

export const DEFAULT_SETTINGS = {
  length_min: 1, style_preset: 'cinematic', aspect: '16:9', language: 'English',
};

// How many setups a scene gets is the scene's business — the story agent spends more on a
// scene that turns and less on one that doesn't. These are the planning figures only:
// the runtime buys a shot budget, and two setups per scene is the typical spend.
// Mirrors TYPICAL_COVERAGE in models.py.
export const TYPICAL_COVERAGE = 2;
export const SHOT_SECONDS = 8;          // mirrors SHOT_SECONDS in models.py
export const shotCount = (s) => Math.max(3, Math.round((s.length_min * 60) / SHOT_SECONDS));
export const sceneCount = (s) => Math.max(3, Math.round(shotCount(s) / TYPICAL_COVERAGE));

// The vocabulary for calling another setup off a keyframe. Deliberately the language a
// director would use on the day, not model parameters.
export const COVERAGE_OPTIONS = {
  shot: ['wide shot', 'medium shot', 'medium two-shot', 'close-up', 'over-the-shoulder', 'insert'],
  angle: ['eye level', 'low angle', 'high angle', 'dutch angle'],
  move: ['locked camera', 'slow push-in', 'slow pull-back', 'handheld drift', 'slow pan'],
};

export const isVideo = (url) => typeof url === 'string' && /\.(mp4|webm|mov)(\?|$)/i.test(url);

export function shortHash(h) {
  if (!h) return '—';
  return h.length > 18 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h;
}
