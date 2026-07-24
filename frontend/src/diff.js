// Word-level diff for take history.
//
// The generation prompt is the closest thing a take has to source code: it is what actually
// produced the pixels. Diffing two takes' prompts shows precisely what a director's note
// changed, which is the one part of an image regeneration that *is* reviewable.

const TOKEN_CAP = 2000;   // past this the LCS table costs more than the answer is worth

const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean);

// Merge neighbouring ops of the same kind so the UI renders runs, not one span per word.
function coalesce(ops) {
  const out = [];
  for (const op of ops) {
    const last = out[out.length - 1];
    if (last && last.t === op.t) last.text += ` ${op.text}`;
    else out.push({ ...op });
  }
  return out;
}

/**
 * Diff two prompts.
 * Returns { ops: [{t:'same'|'add'|'del', text}], added, removed, truncated }
 * where `added`/`removed` are word counts and `truncated` means we bailed on the LCS.
 */
export function wordDiff(before, after) {
  const A = words(before);
  const B = words(after);

  if (!A.length && !B.length) return { ops: [], added: 0, removed: 0, truncated: false };

  if (A.length > TOKEN_CAP || B.length > TOKEN_CAP) {
    return {
      ops: [{ t: 'del', text: A.join(' ') }, { t: 'add', text: B.join(' ') }],
      added: B.length, removed: A.length, truncated: true,
    };
  }

  const n = A.length, m = B.length;
  // dp[i][j] = length of the longest common subsequence of A[i:] and B[j:]
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops = [];
  let added = 0, removed = 0;
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      ops.push({ t: 'same', text: A[i] }); i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ t: 'del', text: A[i] }); removed++; i++;
    } else {
      ops.push({ t: 'add', text: B[j] }); added++; j++;
    }
  }
  while (i < n) { ops.push({ t: 'del', text: A[i++] }); removed++; }
  while (j < m) { ops.push({ t: 'add', text: B[j++] }); added++; }

  return { ops: coalesce(ops), added, removed, truncated: false };
}

// "just now" / "4m ago" / "2h ago" — created_at is epoch seconds from the backend.
export function relTime(epochSeconds) {
  if (!epochSeconds) return '';
  const s = Math.max(0, Math.floor(Date.now() / 1000 - epochSeconds));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
