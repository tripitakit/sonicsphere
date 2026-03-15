import type { WorldDef, WorldSummary } from '../types.ts';
import { getAuthorId } from './authorId.ts';

const BASE = '/api/worlds';

function authHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', 'X-Author-Id': getAuthorId() };
}

export async function listWorlds(limit = 50, offset = 0): Promise<WorldSummary[]> {
  const res = await fetch(`${BASE}?limit=${limit}&offset=${offset}`);
  if (!res.ok) throw new Error(`listWorlds failed: ${res.status}`);
  return res.json();
}

export async function getWorld(id: string): Promise<WorldDef> {
  const res = await fetch(`${BASE}/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`getWorld failed: ${res.status}`);
  return res.json();
}

export async function createWorld(world: WorldDef): Promise<void> {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(world),
  });
  if (!res.ok) throw new Error(`createWorld failed: ${res.status}`);
}

export async function updateWorld(world: WorldDef): Promise<void> {
  const res = await fetch(`${BASE}/${encodeURIComponent(world.id)}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(world),
  });
  if (!res.ok) throw new Error(`updateWorld failed: ${res.status}`);
}

export async function deleteWorld(id: string): Promise<void> {
  const res = await fetch(`${BASE}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`deleteWorld failed: ${res.status}`);
}
