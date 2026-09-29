# NutrientTrack

NutrientTrack is a local-first nutrition diary PWA. It is a small, private first slice built for honest daily logging: the first launch is empty, and every metric on screen comes from something you entered.

## Run locally

```bash
npm install
npm run dev
```

Create a production build with `npm run build`, then serve `dist/` from a static HTTPS host to enable installation and the offline shell. `npm run typecheck` runs the TypeScript check.

## Current scope

- Daily diary with previous, next, and today navigation.
- Add, edit, and delete entries with meal category, calories, protein, carbs, and fat.
- Private reusable custom foods with quick logging.
- Optional calorie and macro goals that are entered by the user.
- Weight check-ins with 7-day and 30-day trend windows. Missing days stay unplotted and the chart uses date-proportional spacing.
- JSON export and restore. Restores validate the backup schema and values, ask for explicit replacement confirmation, and write all stores in one IndexedDB transaction.
- Settings that explain local storage, offer a browser persistence request, export/import, and clear-data controls.
- Installable manifest, raster and vector icons, and a cache-first service worker for the app shell.

## Local data caveat

Entries, saved foods, goals, and weight logs are stored in IndexedDB in the current browser profile. There is no account, API, database, or sync service. Browser storage is best effort unless the browser grants persistent storage, and clearing site data, using private browsing, or changing devices can remove it. Export a JSON backup before clearing data or moving to another device. Imported backups replace the current local data only after confirmation.

## Roadmap

The next product layers may include a broader food catalog and barcode capture, recipes, adaptive expenditure insights, and a later GLP-1 support layer designed with appropriate clinical review. A native Apple Health / HealthKit bridge can be explored after the local web foundation is stable. These are not part of the current app.

NutrientTrack does not make medical claims or health recommendations.
