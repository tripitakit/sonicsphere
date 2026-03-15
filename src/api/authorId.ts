const STORAGE_KEY = 'sonicsphere-author-id';

function generateUUID(): string {
  return crypto.randomUUID();
}

let cached: string | null = null;

export function getAuthorId(): string {
  if (cached) return cached;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) { cached = stored; return stored; }
  } catch { /* ignore */ }
  const id = generateUUID();
  try { localStorage.setItem(STORAGE_KEY, id); } catch { /* ignore */ }
  cached = id;
  return id;
}
