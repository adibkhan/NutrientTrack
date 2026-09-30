# NutrientTrack

Local-first nutrition diary PWA (React 18, TypeScript, Vite). All user data lives in the visitor's browser (IndexedDB `nutrienttrack-local`). There is no server-side storage; the Cloud Run container only serves static files.

## Gates

Run all three before calling work done. CI runs them on every PR and blocks deploys on failure.

- `npm run typecheck` (`tsc -b --noEmit`)
- `npm test` (Vitest + jsdom)
- `npm run build`

## Deploy

Merging to `main` deploys via `.github/workflows/deploy.yml`, which uses Cloud Build to deploy to the Cloud Run service `nutrienttrack` (project `prisential-prod`, us-central1), then smoke-tests the site. It is served at https://nutrienttrack.com. The health check is `/health`; Cloud Run reserves paths ending in `z`, such as `/healthz`. Users' data is tied to the exact origin, so share only `nutrienttrack.com`.

## Data invariants

Users have no server copy of their diary. A change that breaks stored data loses it for good. These rules outrank feature work. Breaking one is a blocking defect, and a rule without an enforcing test is itself a finding.

1. **Fields are additive.** New fields are optional. A missing value means "not recorded", never zero. Never rename, remove, or repurpose a stored field.
   - Enforced by: `src/lib/db.test.ts` (the v1 fixture round-trips with its unknown fields intact) and `src/lib/backup.fixtures.test.ts`.
2. **Edits preserve unknown fields.** Saves start from the stored record (`{ ...existing, ...fromForm }`). They clear only the optional fields the form owns (`ENTRY_FORM_OPTIONAL_KEYS` in `src/App.tsx`). A record written by a newer build must survive an edit by an older one.
   - Enforced by: `src/App.durability.test.tsx`.
3. **Schema changes are numbered migrations.** Append a step to `MIGRATIONS` in `src/lib/db.ts`; `DB_VERSION` follows its length. Never edit or remove a shipped step. Bump only for new stores or indexes, or when data must be rewritten; a new optional field needs no bump.
   - Enforced by: `src/lib/db.test.ts`, which opens a database created by the original v1 code.
4. **Old backups always restore.** A backup format change bumps `BACKUP_VERSION` and appends a `BACKUP_MIGRATIONS` step in `src/lib/backup.ts`. A backup from a newer build is refused with a clear message, never corrupted.
   - Enforced by: `src/lib/backup.fixtures.test.ts`.
5. **Fixtures are frozen.** Files in `src/lib/__fixtures__/` record real formats that users hold. Never edit one; add a new file for each new version and keep testing every old one.
   - Enforced by: `src/lib/invariants.test.ts`, which pins each fixture's content fingerprint.
6. **Imports and clears are atomic.** `importBackup` and `clearAllData` run in a single transaction.
   - Enforced by: `src/lib/db.test.ts` (the synchronous and mid-transaction failure tests for import, clear and batch save).
7. **The catalog is versioned by file name.** The catalog is cached by URL (`force-cache`, then the service worker). A content change ships as a new file, e.g. `usda-common-v2.json`, and is added to `APP_SHELL` in `public/sw.js`. Catalog IDs are never reused. Diary entries store nutrition snapshots, so catalog changes never rewrite history.
   - Enforced by: `src/lib/invariants.test.ts`, which pins the catalog content to its file name and checks the service worker precaches that file.
8. **Multiple tabs are expected.** `db.ts` handles `blocked` and `versionchange`, so an old tab closes its connection instead of blocking an upgrade, and the UI asks the user to reload.
   - Enforced by: the database events tests in `src/lib/db.test.ts` and the event message tests in `src/App.durability.test.tsx`.

## Conventions

- Keep diffs small, and add a regression test that fails before the fix.
- UI changes need browser proof at 320px width. There is no dark theme yet.
- `.claude/panel-log.md` records review panels. Append to it; don't rewrite it.
