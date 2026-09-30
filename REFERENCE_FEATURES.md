# NutrientTrack reference feature register

Updated 2026-09-29. This is a source-backed audit of major user-visible capabilities in MacroFactor (MF), MyFitnessPal (MFP, the assumed meaning of “Calorie Counter”), and Apple Health (Health). It is a release checklist, not a claim of current parity. The reference products change, so recheck the list at each release. NutrientTrack follows useful interaction patterns in its own design.

**Status:** **Ready** = usable now; **Partial** = usable subset with a material limit; **Gap** = absent; **Native** = needs an iOS/Android companion or user-initiated import. **Priority:** P0 = core free nutrition journal; P1 = deeper nutrition parity; P2 = broader health/coaching. A status is promoted only after an end-to-end desktop/mobile check and reload/offline check for local data.

## Food discovery and capture

| Capability | Reference | Status | Priority and completion gate |
| --- | --- | --- | --- |
| Search food as you type | MF, MFP | **Partial** — 7,793 offline USDA common foods | P0 — branded/regional coverage, source shown |
| Recent foods and remembered servings | MF, MFP | **Partial** — recent/saved search results, recent catalog grams recalled | P0 — preserve serving units beyond grams |
| Favorite/custom foods | MF, MFP | **Ready** — private saved foods | P0 — maintain edit/delete/quick log |
| Branded packaged foods | MF, MFP | **Gap** | P0 — licensed, verified product data |
| Barcode lookup | MF, MFP | **Gap** | P0 — camera/manual code, missing-item fallback |
| Nutrition label capture | MF | **Gap** | P1 — editable extraction and source |
| Photo/meal scan | MF, MFP | **Gap** | P2 — optional AI, review before saving |
| Voice/describe logging | MF, MFP | **Gap** | P2 — editable interpretation, privacy choice |
| Quick-add calories and macros | MF, MFP | **Ready** | P0 — clear validation |
| Portion preview | MF, MFP | **Partial** — grams scale energy/three macros | P0 — household units, servings count |
| Metric and imperial food units | MF | **Gap** — grams only | P1 — food-specific reliable conversions |
| Nutrition detail before logging | MF, MFP | **Partial** — energy/protein/carbs/fat | P1 — full nutrients and data provenance |
| Saved meals and recipes | MF, MFP | **Gap** | P0 — ingredients, scaling, log as unit |
| Recipe URL import | MF | **Gap** | P1 — review parsed ingredients |
| Food corrections | MFP | **Partial** — manual entry/edit | P1 — distinguish catalog from correction |

## Diary and daily workflow

| Capability | Reference | Status | Priority and completion gate |
| --- | --- | --- | --- |
| Date/week navigation | MF, MFP | **Ready** | P0 — preserve date on logging/move |
| Meal-based diary | MFP | **Ready** — five sections and energy subtotals | P0 — maintain fast Add actions |
| Hourly timeline | MF | **Ready** — all 24 hours and untimed legacy entries | P0 — maintain clear destination labels |
| Automatic local timestamp | MF, MFP | **Ready** — device-local time on new logs, editable | P0 — preserve historical blank entries |
| Move between meals | MF, MFP | **Ready** — mouse/touch drag and dialog | P0 — preserve time and accessible fallback |
| Move to another hour | MF | **Ready** — mouse/touch drag and dialog | P0 — preserve meal and nutrition |
| Move to another date | MF | **Ready** via dialog | P0 — preserve nutrition and amount |
| Edit amount/nutrition/date/time; delete | MF, MFP | **Ready** | P0 — visible controls, destructive confirmation |
| Copy/paste food, meal, or day | MF | **Partial** — repeat latest earlier meal into selected date with duplicate confirmation | P0 — individual food/day copy and destination chooser |
| Multi-day logging | MFP | **Gap** | P1 — explicit dates and duplicate prevention |
| Multi-select batch actions | MF | **Gap** | P1 — move/copy/delete selected foods |
| Custom meal names/count | MFP | **Gap** | P1 — preserve logs when renamed |
| Timeline hour range/density | MF | **Partial** — compact occupied hours or all 24 hours | P1 — save a local preference and customize range |
| Hide/show timestamps, details, empty hours | MF | **Gap** | P1 — do not hide needed destinations |
| Daily notes | MF | **Gap** | P1 — included in backup |
| Daily calorie/macro progress | MF, MFP | **Ready** | P0 — truthful empty/goal states |
| Meal-level macro breakdown | MFP | **Partial** — energy subtotal only | P1 — three macros per meal |

## Nutrition, goals, and analytics

| Capability | Reference | Status | Priority and completion gate |
| --- | --- | --- | --- |
| User-set calorie/macro goals | MF, MFP | **Ready** — one daily goal | P0 — optional, units clear |
| Different goals by day/meal | MF, MFP | **Gap** | P1 — schedules with historical context |
| Maintain/lose/gain goal modes | MF | **Gap** | P1 — explicit mode, responsible guidance |
| Coached/collaborative/manual plans | MF | **Gap** — manual goals only | P2 — validate recommendations |
| Weight-change rate and goal ETA | MF | **Gap** | P2 — assumptions and confidence visible |
| Weekly dynamic adjustment | MF | **Gap** | P2 — validated check-in logic |
| Energy expenditure estimate | MF | **Gap** | P1 — handle missing/partial food days |
| Macro distributions and net carbs | MF, MFP | **Gap** | P1 — correct definitions |
| Micronutrients, fiber, sodium, vitamins | MF, MFP | **Gap** | P1 — complete food data, units, source |
| Custom nutrient dashboard/targets | MF, MFP | **Gap** | P1 — selected measures, missing data visible |
| Top nutrient food sources | MF | **Gap** | P1 — tied to logged foods |
| Daily/weekly/monthly averages | MF, MFP | **Partial** — energy/protein logged-day averages in 7/30-day views | P1 — more nutrients and period summaries |
| Nutrient timing insights | MF, MFP | **Gap** | P2 — enough timestamps, clear calculation |
| Fasting windows | MFP | **Gap** | P2 — optional, no inferred advice |
| Weight entries and chart | MF, MFP, Health | **Partial** — 7/30-day weight chart | P0 — longer ranges and data table |
| Smoothed weight trend | MF | **Gap** | P1 — documented algorithm |
| Nutrition/weight habits and highlights | MF, MFP, Health | **Partial** — energy/protein history with coverage and weight trend | P1 — cautious personalized highlights |
| Body measurements/progress photos | MF, Health | **Gap** | P2 — private storage and export |

## Health and adjacent tracking

| Capability | Reference | Status | Priority and completion gate |
| --- | --- | --- | --- |
| Water/beverages | MFP, Health | **Gap** | P1 — volume and daily trends |
| Exercise/activity/steps | MFP, MF, Health | **Gap** | P2 — avoid double-counting energy |
| Sleep, vitals, mental health, cycle | Health; MF has period tracking | **Gap** | P2 — separate private modules |
| Medication log/reminders | Health | **Gap** | P2 — clinical/safety review, no dosing advice |
| GLP-1 tolerance, symptoms, hydration | NutrientTrack direction | **Gap** | P2 — optional journal and clinical review |
| Pinned health summary/highlights | Health | **Partial** — nutrition/weight cards | P1 — user-selected cards |
| Weekly/monthly/yearly health views | Health | **Partial** — energy/protein and weight in 7/30-day views | P1 — longer ranges and more measures |
| Health records/provider data | Health | **Native** | P2 — consent and standards path |
| Apple Health/HealthKit sync | MF, MFP, Health | **Native** | P1 — iOS companion or file import |
| Android Health Connect sync | MF, MFP | **Native** | P1 — Android companion/permissions |
| Home/lock screen widgets | MF | **Native** | P2 — after core PWA |

## Data and platform

| Capability | Reference | Status | Priority and completion gate |
| --- | --- | --- | --- |
| Browser-local private journal/no account | NutrientTrack direction | **Ready** — IndexedDB | P0 — no analytics connection |
| Installable/offline PWA | NutrientTrack direction | **Ready** — shell and catalog | P0 — fresh offline install/update check |
| Export/restore local records | MF, MFP, Health | **Partial** — validated JSON | P0 — CSV and versioned migration |
| Multi-device sync/account | MF, MFP, Health | **Gap** by local-first design | P2 — optional encrypted sync if needed |
| Source/permission controls | Health | **Partial** — catalog label, data controls | P1 — record provenance/import permissions |
| Ad-free core | MF, NutrientTrack direction | **Ready** | P0 — keep the journal free |

## Data and implementation decisions

The bundled catalog uses [USDA FoodData Central SR Legacy](https://fdc.nal.usda.gov/download-datasets/) CC0 data per 100 g. It does not cover packaged foods, household units, or full micronutrients. [Open Food Facts' API guidance](https://github.com/openfoodfacts/openfoodfacts-server/blob/main/docs/api/index.md) warns against using its rate-limited public endpoint for search-as-you-type. Evaluate it for explicit barcode lookup, with license obligations and a missing-product fallback.

Apple's [HealthKit setup guide](https://developer.apple.com/documentation/HealthKit/setting-up-healthkit) requires an entitled native app and user permission. A PWA cannot directly access HealthKit. User-initiated file import or a native companion are later paths.

Release gates: (1) timestamps and direct diary movement; (2) packaged-food/barcode coverage; (3) recipes, portions, copy/paste; (4) full nutrients and trustworthy trend/expenditure calculations; then broader health and GLP-1 modules. Each gate requires a useful end-to-end flow, not only a screen.

## Reference evidence

- [MacroFactor feature breakdown](https://macrofactor.com/macrofactor/), [food timeline collection](https://help.macrofactorapp.com/en/collections/30-food-timeline), [timeline customization](https://help.macrofactorapp.com/en/articles/218-how-to-configure-your-food-timeline), [logging methods](https://help.macrofactorapp.com/en/articles/215-how-to-log-food-in-macrofactor), [move workflow](https://help.macrofactorapp.com/en/articles/97-move-foods-to-a-different-time-on-the-timeline).
- Mobbin: [MacroFactor diary](https://mobbin.com/screens/41fa995f-d576-4366-99d7-cb06dc132192), [search](https://mobbin.com/screens/4e39baf4-cced-4365-8065-3f099767072f), [move flow](https://mobbin.com/flows/bcbdfee1-27d3-4436-82da-9b3d4ac8fcf7).
- [MyFitnessPal food logging](https://support.myfitnesspal.com/hc/en-us/articles/360032274592-How-to-log-food-to-your-diary), [Today tab](https://support.myfitnesspal.com/hc/en-us/articles/39985611667341-Your-Today-tab), [Premium features](https://support.myfitnesspal.com/hc/en-us/articles/360032625951-MyFitnessPal-Premium-features); [Mobbin meal diary](https://mobbin.com/screens/1800e77c-5f49-45ca-aa15-455ff67e56d8).
- [Apple Health overview](https://support.apple.com/guide/iphone/intro-to-health-data-iphbb8259c61/27/ios/27), [trends/pinned measures](https://support.apple.com/en-mt/guide/iphone/iphe3d379c32/ios); [Mobbin summary](https://mobbin.com/screens/97104df5-f817-4e56-80a0-0c46eee67e06).
