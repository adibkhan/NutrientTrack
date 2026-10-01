// Runs every supabase/tests/*.sql file against DATABASE_URL. Each file manages its own transaction and rolls back.
// Usage: DATABASE_URL=postgresql://... node scripts/db-test.mjs
import { readdir, readFile } from 'node:fs/promises'
import pg from 'pg'

const dir = new URL('../supabase/tests/', import.meta.url)
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
let failed = 0
try {
  for (const name of (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort()) {
    try {
      await client.query(await readFile(new URL(name, dir), 'utf8'))
      console.log(`pass: ${name}`)
    } catch (error) {
      failed += 1
      console.error(`FAIL: ${name}: ${error.message}`)
      await client.query('rollback').catch(() => undefined)
    }
  }
} finally {
  await client.end()
}
process.exit(failed ? 1 : 0)
