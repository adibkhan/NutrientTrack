# Backup fixtures

These files are FROZEN. Each one is a real-shaped export from a shipped backup format version and exists
to prove that every future build can still restore it.

- Never edit an existing fixture, not even to fix formatting or to make a test pass. If a test fails
  against one, the code is wrong, not the fixture.
- When the backup format moves to version N+1, add `backup-vN+1.json` and keep `backup-vN.json`.
- `backup-v2.json` is the version 2 format: it adds `water` and `measurements` and carries every optional field added since v1 (nutrients, `planned`, `favorite`, recipe `ingredients`, `bodyFat`, `preferences`, `program`) plus unknown fields on an entry, on settings and on the program.
- `backup-v1.json` deliberately carries unknown fields (`sodium` on an entry, `theme` on settings) to
  simulate data written by a newer build; they must survive import, storage, and export.
