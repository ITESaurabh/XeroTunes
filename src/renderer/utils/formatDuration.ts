/** Track length as m:ss; anything missing or non-positive renders as blank. */
export function formatDuration(seconds: unknown): string {
  const secs = typeof seconds === 'number' && seconds > 0 ? seconds : null;
  if (secs == null) return '';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Dates stored as epoch millis; anything else renders as blank. */
export function formatDate(val: unknown): string {
  if (!val || typeof val !== 'number') return '';
  return new Date(val).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
