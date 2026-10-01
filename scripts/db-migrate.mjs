// Applies supabase/migrations/*.sql in name order, once each, recording them in app_meta.applied_migrations.
// Usage: DATABASE_URL=postgresql://... node scripts/db-migrate.mjs [--check]
//   --check  lists pending migrations without applying them.
// Each migration runs in its own transaction. Never edit an applied migration; add a new file.
import { readdir, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import pg from 'pg'

const dir = new URL('../supabase/migrations/', import.meta.url)
const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set.')
  process.exit(1)
}

// Verify the server certificate against Supabase's root CA: this connection carries the database password.
// DATABASE_CA can point at another CA file, e.g. for a self-hosted database.
const ca = await readFile(process.env.DATABASE_CA ?? new URL('../supabase/prod-ca-2021.crt', import.meta.url), 'utf8')
const client = new pg.Client({ connectionString: url, ssl: { ca, rejectUnauthorized: true } })
await client.connect()
try {
  await client.query(`create schema if not exists app_meta;
    create table if not exists app_meta.applied_migrations (
      name text primary key,
      sha256 text not null,
      applied_at timestamptz not null default now()
    );
    revoke all on schema app_meta from anon, authenticated;`)
  const applied = new Map((await client.query('select name, sha256 from app_meta.applied_migrations')).rows.map((row) => [row.name, row.sha256]))
  const files = (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort()
  for (const name of files) {
    const sql = (await readFile(new URL(name, dir), 'utf8')).replace(/\r\n/g, '\n')
    const sha256 = createHash('sha256').update(sql).digest('hex')
    if (applied.has(name)) {
      if (applied.get(name) !== sha256) throw new Error(`${name} was edited after it was applied. Add a new migration instead.`)
      continue
    }
    if (process.argv.includes('--check')) {
      console.log(`pending: ${name}`)
      continue
    }
    await client.query('begin')
    try {
      await client.query(sql)
      await client.query('insert into app_meta.applied_migrations (name, sha256) values ($1, $2)', [name, sha256])
      await client.query('commit')
      console.log(`applied: ${name}`)
    } catch (error) {
      await client.query('rollback')
      throw new Error(`${name} failed: ${error.message}`)
    }
  }
  console.log('database is up to date')
} finally {
  await client.end()
}
