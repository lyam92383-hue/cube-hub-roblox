export const LONG = { working: 'bosse', waiting: 'attend ta réponse', done: 'terminé' };
export const SHORT = { working: 'bosse', waiting: 'attend', done: 'terminé' };

/** "12 min", "1 h 05". */
export function duration(since, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(since)) / 60000));
  if (!Number.isFinite(minutes)) return '';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

/** "850 tokens", "210k tokens", "1,2M tokens". */
export function tokens(n) {
  if (!n) return '';
  if (n < 1000) return `${n} tokens`;
  if (n < 1_000_000) return `${Math.floor(n / 1000)}k tokens`;
  return `${(n / 1_000_000).toFixed(1).replace('.', ',')}M tokens`;
}

export function escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
