import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { initDb, getDb } from './db.ts';

initDb();

const app = new Hono();
app.use('/api/*', cors());

// ── Helpers ──────────────────────────────────────────────────────────────────

function getAuthorId(c: { req: { header: (name: string) => string | undefined } }): string | null {
  return c.req.header('x-author-id') ?? null;
}

function now(): number {
  return Date.now();
}

// ── GET /api/worlds — list all (summary, paginated) ─────────────────────────

app.get('/api/worlds', (c) => {
  const url = new URL(c.req.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);

  const rows = getDb()
    .prepare(
      `SELECT id, author_id, name, created_at, updated_at, source_count, zone_count
       FROM worlds ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as Array<{
      id: string; author_id: string; name: string;
      created_at: number; updated_at: number;
      source_count: number; zone_count: number;
    }>;

  return c.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      authorId: r.author_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      sourceCount: r.source_count,
      zoneCount: r.zone_count,
    })),
  );
});

// ── GET /api/worlds/:id — full world ─────────────────────────────────────────

app.get('/api/worlds/:id', (c) => {
  const row = getDb()
    .prepare('SELECT id, author_id, name, created_at, updated_at, data FROM worlds WHERE id = ?')
    .get(c.req.param('id')) as {
      id: string; author_id: string; name: string;
      created_at: number; updated_at: number; data: string;
    } | undefined;

  if (!row) return c.json({ error: 'Not found' }, 404);

  const { sources, zones } = JSON.parse(row.data);
  return c.json({
    id: row.id,
    name: row.name,
    authorId: row.author_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sources,
    zones,
  });
});

// ── POST /api/worlds — create ────────────────────────────────────────────────

app.post('/api/worlds', async (c) => {
  const authorId = getAuthorId(c);
  if (!authorId) return c.json({ error: 'Missing X-Author-Id header' }, 400);

  const body = await c.req.json<{
    id: string; name: string;
    sources: unknown[]; zones: unknown[];
  }>();

  if (!body.id || !body.name) return c.json({ error: 'Missing id or name' }, 400);

  const ts = now();
  const data = JSON.stringify({ sources: body.sources ?? [], zones: body.zones ?? [] });

  getDb()
    .prepare(
      `INSERT INTO worlds (id, author_id, name, created_at, updated_at, source_count, zone_count, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(body.id, authorId, body.name, ts, ts, (body.sources ?? []).length, (body.zones ?? []).length, data);

  return c.json({ id: body.id, name: body.name, authorId, createdAt: ts, updatedAt: ts }, 201);
});

// ── PUT /api/worlds/:id — update (author must match) ─────────────────────────

app.put('/api/worlds/:id', async (c) => {
  const authorId = getAuthorId(c);
  if (!authorId) return c.json({ error: 'Missing X-Author-Id header' }, 400);

  const id = c.req.param('id');
  const existing = getDb()
    .prepare('SELECT author_id FROM worlds WHERE id = ?')
    .get(id) as { author_id: string } | undefined;

  if (!existing) return c.json({ error: 'Not found' }, 404);
  if (existing.author_id !== authorId) return c.json({ error: 'Forbidden' }, 403);

  const body = await c.req.json<{
    name?: string; sources?: unknown[]; zones?: unknown[];
  }>();

  const ts = now();
  const data = JSON.stringify({ sources: body.sources ?? [], zones: body.zones ?? [] });

  getDb()
    .prepare(
      `UPDATE worlds SET name = ?, updated_at = ?, source_count = ?, zone_count = ?, data = ?
       WHERE id = ?`,
    )
    .run(body.name ?? '', ts, (body.sources ?? []).length, (body.zones ?? []).length, data, id);

  return c.json({ id, updatedAt: ts });
});

// ── DELETE /api/worlds/:id — delete (author must match) ──────────────────────

app.delete('/api/worlds/:id', (c) => {
  const authorId = getAuthorId(c);
  if (!authorId) return c.json({ error: 'Missing X-Author-Id header' }, 400);

  const id = c.req.param('id');
  const existing = getDb()
    .prepare('SELECT author_id FROM worlds WHERE id = ?')
    .get(id) as { author_id: string } | undefined;

  if (!existing) return c.json({ error: 'Not found' }, 404);
  if (existing.author_id !== authorId) return c.json({ error: 'Forbidden' }, 403);

  getDb().prepare('DELETE FROM worlds WHERE id = ?').run(id);
  return c.json({ ok: true });
});

// ── Start ────────────────────────────────────────────────────────────────────

const port = Number(process.env.PORT) || 3001;
serve({ fetch: app.fetch, port }, () => {
  console.log(`Sonic Sphere API running on http://localhost:${port}`);
});
