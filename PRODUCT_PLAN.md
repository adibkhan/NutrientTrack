# NutrientTrack: product direction

## Current implementation

The browser-local PWA now includes an offline USDA common-food catalog, search as you type with recent and saved results, gram-based portion preview, meal-grouped daily logging, repeat-previous-meal actions, a compact or full 24-hour timeline, drag movement between meals or hours, editable local timestamps, weight records, coverage-aware energy and protein trends, goals, and JSON backup/restore. [REFERENCE_FEATURES.md](REFERENCE_FEATURES.md) tracks each major reference capability; [FEATURE_PARITY.md](FEATURE_PARITY.md) records the design review. The current catalog does not yet provide packaged-food lookup or micronutrients.

## Promise

A fast, free nutrition and weight journal that works offline, keeps personal records in the user's browser, and makes trends understandable without an account. The interface takes inspiration from Apple Health's readable summaries and MacroFactor's fast logging, while using its own visual design.

**Working assumption:** the first users want to see their intake and weight patterns without a subscription, and accept keeping their data on one browser if backup and restore are straightforward. This needs user testing; competitor feature lists do not prove demand.

## What we are building first

The first usable loop is: set targets, log a meal in a few steps, see today's intake, log weight, review the trend, then export a backup. A person must be able to do this with the network disconnected after the app is installed. New accounts start empty. Nutrition values entered by the user are shown as entered; the app does not pretend it verified them.

Success should be evaluated with real use: whether someone can complete the first log without help, how long a repeat log takes, whether they return to log on multiple days, and whether they can restore a backup. Establish a baseline before setting numeric targets. Keep these measurements on device or collect them through consented research; do not silently transmit health data.

## Sequence

### Now: trustworthy local journal

- Daily meal entries, quick add, reusable custom foods, editable calorie and macro targets.
- Weight records and transparent energy/protein trends; missing days stay missing rather than being presented as zero intake. Logged-day averages show coverage and acknowledge that a logged day can be partial.
- IndexedDB persistence, installable and offline app shell, explicit JSON backup and restore.
- Accessible responsive screens, clear empty and error states.

### Next: make logging competitive

- Food discovery with credible nutrient provenance, serving units, recent/favorite foods, recipes, meal templates, copy and repeat actions.
- Barcode and nutrition-label input with manual verification before saving.
- Decide between a licensed downloadable food data subset and an optional public lookup. External food lookups must never include the user's personal log. Review each provider's API rules, attribution, quality, and offline limits before integration.

### Then: earn trust in guidance

- Weight trend and energy expenditure estimates using clearly documented, independently tested methods. Show data sufficiency and uncertainty; do not show a confident estimate from sparse or partial logs.
- User-controlled goals and weekly suggestions, with easy rejection or adjustment. Validate algorithm behavior before presenting it as coaching.
- More nutrient details, journal notes, hydration, and import/export formats.

### Later: GLP-1 context and interoperability

- Optional medication and symptom journal, hydration and protein visibility, flexible meal sizes, and a clinician-friendly export. Keep dose decisions and symptom diagnosis outside the app. Seek clinical review before publishing medication-specific prompts or target advice.
- Apple Health data exchange needs an iOS app or native companion with HealthKit permissions. A browser PWA can share the design language and accept user-initiated imports, but cannot promise direct HealthKit access.
- If AI features are added, make processing opt-in, explain what leaves the device, and keep the core journal free.

## Architecture and trust rules

- No account, application database, or server-side storage of personal nutrition, weight, or medication data in the PWA.
- Browser data is tied to the site origin and device. Browser clearing, private browsing, device loss, or storage eviction can remove it. Encourage backups and request persistent storage where supported; never promise backups exist automatically.
- Treat imported files as untrusted: validate schema and values before replacing local data, and make the replacement explicit.
- Nutrition guidance must not infer that lower intake is always better. GLP-1 support is a tracking and communication workflow, not medical advice.
- Functionality can be inspired by competitors; naming, assets, and screen composition remain original.

## Reference notes

- [MacroFactor's logging methods](https://help.macrofactorapp.com/en/articles/215-how-to-log-food-in-macrofactor) show the importance of search, quick add, barcode, and reusable foods in one fast flow.
- [MacroFactor's weight trend description](https://help.macrofactorapp.com/dashboard/weight_trend) explains why weight and intake history underpin adaptive estimates.
- [Apple Health Summary on Mobbin](https://mobbin.com/screens/97104df5-f817-4e56-80a0-0c46eee67e06) is a reference for readable hierarchy; [MacroFactor dashboard](https://mobbin.com/screens/0a81aa3f-649c-44f9-b5ca-626482d70c50) and [food log](https://mobbin.com/screens/78afc90b-af46-40fa-af35-cfa1f765fea3) are references for compact progress and rapid entry.
- [MDN on browser storage](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) documents eviction and persistent storage; [Apple's HealthKit setup](https://developer.apple.com/documentation/healthkit/setting-up-healthkit) documents the native entitlement and permission model.
