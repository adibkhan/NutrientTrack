date | command | scope | agent | claims | struck | downgraded
2026-09-29 | feature-panel | whole-product | product-strategist | claims: 5 | struck: 0 | downgraded: 1 | note: P2 register row is Partial with P0 next step, not Gap
2026-09-29 | feature-panel | whole-product | ux-advocate | claims: 10 | struck: 0 | downgraded: 0
2026-09-29 | feature-panel | whole-product | skeptic | claims: 6 | struck: 0 | downgraded: 0
2026-09-29 | feature-panel | whole-product | correctness-auditor-proposal | claims: 11 | struck: 0 | downgraded: 2 | note: A6 and A8 confirmed but latent (no field gap today, DB_VERSION 1)
2026-09-29 | feature-panel | whole-product | verifier | claims: 32 | struck: 0 | downgraded: 0 | note: 0% strike below 5% floor, attempts listed; verifier misreported its total as 36 (table has 32 rows)
2026-09-30 | implement | data-durability | verifier | claims: 9 | struck: 2 | downgraded: 0 | note: struck D4 (clearAllData not wrapped) and D7 (CLAUDE.md invariants without enforcing tests); both fixed and re-gated
2026-09-30 | implement | cloud-sync | verifier | claims: 8 | struck: 1 | downgraded: 0 | note: struck C6 (stale docs); also found clear-undone-by-sync, stale restore, no retry after offline start, missing welcome toast, cross-tab sign-in; all fixed with regression tests
2026-09-30 | implement | pr5-review-fixes | verifier | claims: 11 | struck: 1 | downgraded: 0 | note: struck F4 (note/meal validation gap); found N1 (sign-out hang) and N2 (connect race), fixed
2026-09-30 | implement | pr5-review-fixes-pass2 | verifier | claims: 4 | struck: 0 | downgraded: 0 | note: found stale runSync status overwrite after timed-out sign-out, fixed with generation guard and signingOut flag
2026-10-01 | implement | ui-refresh | verifier | claims: 15 | struck: 0 | downgraded: 0 | note: 12 UI items in 6 batches; 9 low findings, 3 fixed (warn-chip contrast, 9px tab labels, negative macro goal), rest deferred; C13 helper-edit history unprovable (file untracked)
