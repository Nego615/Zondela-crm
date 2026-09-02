// Expands the migration includes in schema.sql.
//
// schema.sql is the one file you paste into the Supabase SQL editor, but the
// auth/RBAC half of it is also useful on its own (applying just the auth
// changes to a live database). Rather than keep two copies in step by hand,
// the migration file is the source and schema.sql carries an include marker:
//
//   -- @@INCLUDE:migrations/0001_closed_access_rbac.sql@@
//
// Running `npm run sync:schema` replaces the marker with the file's contents,
// wrapped in BEGIN/END markers so the next run can find and replace it again.
//
// Usage: node supabase/build-schema.mjs [--check]
//   --check exits non-zero if schema.sql is out of date instead of writing.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const schemaPath = join(here, 'schema.sql')

const MARKER = /^-- @@INCLUDE:(\S+)@@$/gm
const BLOCK = /^-- @@BEGIN:(\S+)@@\n[\s\S]*?^-- @@END:\1@@$/gm

function expand(source) {
  // Collapse any previously expanded block back to its marker first, so the
  // script is idempotent and always re-reads the migration from disk.
  const collapsed = source.replace(BLOCK, (_m, file) => `-- @@INCLUDE:${file}@@`)

  return collapsed.replace(MARKER, (_m, file) => {
    const body = readFileSync(join(here, file), 'utf8').trimEnd()
    return [
      `-- @@BEGIN:${file}@@`,
      `-- Generated from supabase/${file} by supabase/build-schema.mjs.`,
      '-- Edit that file, then run `npm run sync:schema`.',
      '',
      body,
      '',
      `-- @@END:${file}@@`,
    ].join('\n')
  })
}

const current = readFileSync(schemaPath, 'utf8')
const next = expand(current)

if (process.argv.includes('--check')) {
  if (current !== next) {
    console.error('schema.sql is out of date — run `npm run sync:schema`.')
    process.exit(1)
  }
  console.log('schema.sql is up to date.')
} else {
  writeFileSync(schemaPath, next)
  console.log('schema.sql updated.')
}
