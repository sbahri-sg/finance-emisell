import pg from 'pg'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is required')
export const pool = new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 })

export async function migrate() {
  const client = await pool.connect()
  try {
    await client.query('select pg_advisory_lock(783421)')
    await client.query('create table if not exists schema_migrations(name text primary key, applied_at timestamptz not null default now())')
    const directory = path.join(import.meta.dirname, 'migrations')
    for (const name of (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort()) {
      const exists = await client.query('select 1 from schema_migrations where name=$1', [name])
      if (exists.rowCount) continue
      await client.query('begin')
      try {
        await client.query(await readFile(path.join(directory, name), 'utf8'))
        await client.query('insert into schema_migrations(name) values($1)', [name])
        await client.query('commit')
      } catch (error) { await client.query('rollback'); throw error }
    }
  } finally { await client.query('select pg_advisory_unlock(783421)'); client.release() }
}
