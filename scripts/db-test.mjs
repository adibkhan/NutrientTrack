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

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
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
