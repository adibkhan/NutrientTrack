# NutrientTrack

Local-first nutrition diary PWA (React 18, TypeScript, Vite). All user data lives in the visitor's browser (IndexedDB `nutrienttrack-local`), which stays the primary copy. Signing in turns on optional cloud backup and sync through Supabase (`public.sync_records`, see `supabase/`). The Cloud Run container only serves static files.

## Gates

Run all three before calling work done. CI runs them on every PR and blocks deploys on failure.

- `npm run typecheck` (`tsc -b --noEmit`)
- `npm test` (Vitest + jsdom)
- `npm run build`

## Deploy

Merging to `main` deploys via `.github/workflows/deploy.yml`, which uses Cloud Build to deploy to the Cloud Run service `nutrienttrack` (project `prisential-prod`, us-central1), then smoke-tests the site. It is served at https://nutrienttrack.com. The health check is `/health`; Cloud Run reserves paths ending in `z`, such as `/healthz`. Users' data is tied to the exact origin, so share only `nutrienttrack.com`.

## Data invariants

The browser holds the primary copy, and most users have no server copy at all because sync is opt-in. A change that breaks stored data loses it for good. These rules outrank feature work. Breaking one is a blocking defect, and a rule without an enforcing test is itself a finding.

1. **Fields are additive.** New fields are optional. A missing value means "not recorded", never zero. Never rename, remove, or repurpose a stored field.
   - Enforced by: `src/lib/db.test.ts` (the v1 fixture round-trips with its unknown fields intact), `src/lib/backup.fixtures.test.ts` (v1 and v2 fixtures, unknown fields on entries, settings and program) and `src/lib/backup.nutrients.test.ts` (every optional field accepted when absent).
2. **Edits preserve unknown fields.** Saves start from the stored record (`{ ...existing, ...fromForm }`). They clear only the optional fields the form owns (`ENTRY_FORM_OPTIONAL_KEYS` in `src/App.tsx`). A record written by a newer build must survive an edit by an older one.
   - Enforced by: `src/App.durability.test.tsx`, plus the unknown-field cases in `src/App.nutrients.test.tsx`, `src/App.planned.test.tsx`, `src/App.program.test.tsx`, `src/App.preferences.test.tsx`, `src/App.favorites.test.tsx`, `src/App.bodyfat.test.tsx` and `src/App.measurements.test.tsx`.
3. **Schema changes are numbered migrations.** Append a step to `MIGRATIONS` in `src/lib/db.ts`; `DB_VERSION` follows its length. Never edit or remove a shipped step. Bump only for new stores or indexes, or when data must be rewritten; a new optional field needs no bump.
   - Enforced by: `src/lib/db.test.ts`, which opens a database created by the original v1 code, and `src/lib/db.local-stores.test.ts`, which upgrades a version 2 database to the current version.
4. **Old backups always restore.** A backup format change bumps `BACKUP_VERSION` and appends a `BACKUP_MIGRATIONS` step in `src/lib/backup.ts`. A backup from a newer build is refused with a clear message, never corrupted.
   - Enforced by: `src/lib/backup.fixtures.test.ts` and `src/lib/backup.v2.test.ts` (a version 1 file is upgraded with empty water and measurement logs; the next version is refused as newer).
5. **Fixtures are frozen.** Files in `src/lib/__fixtures__/` record real formats that users hold. Never edit one; add a new file for each new version and keep testing every old one.
   - Enforced by: `src/lib/invariants.test.ts`, which pins each fixture's content fingerprint.
6. **Imports and clears are atomic.** `importBackup` and `clearAllData` run in a single transaction.
   - Enforced by: `src/lib/db.test.ts` (the synchronous and mid-transaction failure tests for import, clear and batch save) and `src/lib/db.local-stores.test.ts` (water and measurements are part of the same import and clear).
7. **The catalog is versioned by file name.** The catalog is cached by URL (`force-cache`, then the service worker). A content change ships as a new file, e.g. `usda-common-v2.json`, and is added to `APP_SHELL` in `public/sw.js`. Catalog IDs are never reused. Diary entries store nutrition snapshots, so catalog changes never rewrite history.
   - Enforced by: `src/lib/invariants.test.ts`, which pins the catalog content to its file name and checks the service worker precaches that file.
8. **Multiple tabs are expected.** `db.ts` handles `blocked` and `versionchange`, so an old tab closes its connection instead of blocking an upgrade, and the UI asks the user to reload.
   - Enforced by: the database events tests in `src/lib/db.test.ts` and the event message tests in `src/App.durability.test.tsx`.

## Cloud sync

- **Schema:** changes go in a new file under `supabase/migrations/` (never edit an applied one). Apply with `npm run db:migrate` and test with `npm run db:test`; both need `DATABASE_URL`, the Supabase session pooler (IPv4) URL. Never commit it.
- **Keys:** the app uses only the publishable key in `src/lib/cloud.ts`, which is public by design. Never put a secret or service-role key in the app, the repo, or CI.
- **Sync rules** (note that clearing local data while signed in signs the device out first, so the next sync can't pull the data back):
  - Last write wins on `client_updated_at`, enforced by the database trigger.
  - Deletes are markers; devices never hard-delete rows.
  - Restoring a backup and "Clear local data" never delete anything in the cloud.
- **Failure rules** (each has a test in `src/lib/sync.test.ts`, `src/lib/outbox.test.ts`, `src/lib/cloud.test.ts` or `src/App.cloud.test.tsx`):
  - A record the server rejects is set aside and reported, never retried forever; one bad row must not block the rest.
  - Pull always runs, even when push failed.
  - Cloud records are validated before they are stored locally (`isValidSyncRecord`).
  - Restoring a backup resets the pull cursor; deletes are queued only once a device has synced (`everSynced`).
  - "Clear local data" decides from the stored session (`hasStoredSession`), and sign-out works offline.
- **Database scripts:** `npm run db:migrate` and `db:test` verify the server certificate against `supabase/prod-ca-2021.crt` (Supabase's public root CA, valid to 2031). Never turn verification off; point `DATABASE_CA` at another CA file if the host changes.
- **Local-only stores:** `water` and `measurements` (DB version 3, backup version 2) are saved on the device and in backups but are not synced, because `public.sync_records.store` is restricted to `entries`, `foods`, `weights` and `settings`. To sync them, add a new file under `supabase/migrations/` that widens that check, apply it, then add the stores to `SYNCED_STORES` in `src/lib/db.ts` and to `isValidSyncRecord`. Do both together or not at all.
- **Loading:** the Supabase library is loaded only when someone asks for a sign-in link or already has a session (`src/lib/cloud.ts`, gated by `mightBeSignedIn`). People who never sign in never download it, and the offline app must not depend on it. The same rule covers the ZXing barcode decoder (`src/lib/scanner.ts`): it is imported only when someone opens the scanner, the browser's own BarcodeDetector is used first where it exists, and the lookup itself (`src/lib/barcode.ts`) runs only after `preferences.barcodeLookup` is switched on.

## Conventions

- Keep diffs small, and add a regression test that fails before the fix.
- UI changes need browser proof at 320px width in both light and dark, with an empty database and a populated one. Theme is a stored preference (`settings.preferences.theme`); colours come only from the tokens at the top of `src/styles.css`, never hard-coded.
- Design tokens live at the top of `src/styles.css` (the "Standard Compact" system: white surfaces, `#2E6FE8` accent, 10px cards / 8px controls, 44px rows). IBM Plex Sans is self-hosted from `public/fonts/` and precached by the service worker; never load fonts or other assets from a CDN, since the app must work offline and makes no third-party requests.
- `.claude/panel-log.md` records review panels. Append to it; don't rewrite it.
