# NutrientTrack reference review and parity map

For the complete capability-by-capability status, see [REFERENCE_FEATURES.md](REFERENCE_FEATURES.md).

Updated 2026-09-29. This is a living map of user tasks and information patterns, not a plan to copy another app's artwork or screen layout.

## What the reference apps make easy

| User task | Reference pattern | NutrientTrack direction |
| --- | --- | --- |
| Find food while typing | MacroFactor groups history, custom, common, and branded foods in one search flow; MyFitnessPal starts from a meal and offers search, recent foods, and other logging methods. | Keep one logger with local recent/saved results and an offline common-food catalog. Make the source and serving basis visible. |
| Log an accurate amount | MacroFactor previews the effect of a portion on calories and nutrients before adding it. | Show live calories and macros as grams or a defined serving changes. Save the chosen amount and a snapshot of nutrition values. |
| Read the day at a glance | MacroFactor uses a time-based food timeline and compact progress indicators; MyFitnessPal organizes foods by meal. | Use meal sections with section totals, clear Add actions, optional time, and a daily summary. |
| Correct a log | MacroFactor supports selecting and moving food to an hour or date; MyFitnessPal supports moving between meals. | Put an accessible Move control on every entry, with quick destination choices. Preserve edit and delete. |
| Understand health patterns | Apple Health emphasizes named measures, dates, concise summaries, and legible trends. | Keep nutrition and weight visualizations labeled with units, time windows, and an accessible data alternative. Missing entries stay missing. |

## Functional coverage

| Area | Status after current food-search milestone | Remaining work for broad parity |
| --- | --- | --- |
| Diary and quick add | Working | Multi-select, copy/paste, repeat days, hourly go-to foods |
| Food discovery | Bundled USDA common foods plus local saved/recent foods | Broad branded catalog, barcode, label capture, regional coverage, typo tolerance |
| Portions | Grams with live macro scaling | Household serving units, weight/volume conversions, favorites for units |
| Meals and timeline | Meal sections, a 24-hour timeline, automatic local time for new logs, and direct dragging between meals or hours | Configurable meal labels and timeline preferences |
| Personal library | Custom foods | Recipes, meal templates, favorites, recipe scaling and ingredient breakdown |
| Nutrition views | Calories and three macros | Fiber, sodium, vitamins and minerals, nutrient goals, weekly averages and details |
| Body data | Weight entries and basic 7/30-day chart | Trend-weight algorithm, body measurements, richer comparisons |
| Guidance | User-set goals only | Validated expenditure estimate, change-rate views, weekly check-ins and optional adaptive recommendations |
| Other logs | — | Water, exercise, notes and optional GLP-1 medication/symptom journal |
| Interoperability | JSON backup/restore | CSV import/export and optional native HealthKit or Health Connect companion |

## Food database decision

The bundled common-food catalog uses USDA FoodData Central [SR Legacy](https://fdc.nal.usda.gov/download-datasets/) data, with optional newer Foundation records. USDA marks FoodData Central data as public domain under CC0 and asks for source attribution. Nutrients in this first catalog are per 100 g. Packaged-food coverage and serving choices will be narrower than the commercial apps until later data work.

[Open Food Facts](https://github.com/openfoodfacts/openfoodfacts-server/blob/main/docs/api/index.md) is promising for a later explicit packaged-food or barcode lookup. Its public API permits only 10 searches per minute per IP and specifically warns against using that endpoint for search as you type. Its database license also has attribution and share-alike conditions. We therefore use local search for typing and will evaluate an explicit lookup separately.

## References

- [MacroFactor food logging methods](https://help.macrofactorapp.com/en/articles/215-how-to-log-food-in-macrofactor), [move workflow](https://help.macrofactorapp.com/en/articles/97-move-foods-to-a-different-time-on-the-timeline), [search database](https://help.macrofactorapp.com/en/articles/46-food-search-database), and [expenditure model](https://help.macrofactorapp.com/en/articles/20-expenditure).
- [MacroFactor diary screen](https://mobbin.com/screens/41fa995f-d576-4366-99d7-cb06dc132192), [food search screen](https://mobbin.com/screens/4e39baf4-cced-4365-8065-3f099767072f), and [move flow](https://mobbin.com/flows/bcbdfee1-27d3-4436-82da-9b3d4ac8fcf7) on Mobbin.
- [MyFitnessPal food logging](https://support.myfitnesspal.com/hc/en-us/articles/360032274592-How-to-log-food-to-your-diary) and [Today screen](https://support.myfitnesspal.com/hc/en-us/articles/39985611667341-Your-Today-tab); [meal-section screen](https://mobbin.com/screens/1800e77c-5f49-45ca-aa15-455ff67e56d8) on Mobbin.
- [Apple Health overview](https://support.apple.com/guide/iphone/intro-to-health-data-iphbb8259c61/27/ios/27) and [summary screen](https://mobbin.com/screens/97104df5-f817-4e56-80a0-0c46eee67e06) on Mobbin.
