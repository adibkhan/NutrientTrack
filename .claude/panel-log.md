date | command | scope | agent | claims | struck | downgraded
2026-09-29 | feature-panel | whole-product | product-strategist | claims: 5 | struck: 0 | downgraded: 1 | note: P2 register row is Partial with P0 next step, not Gap
2026-09-29 | feature-panel | whole-product | ux-advocate | claims: 10 | struck: 0 | downgraded: 0
2026-09-29 | feature-panel | whole-product | skeptic | claims: 6 | struck: 0 | downgraded: 0
2026-09-29 | feature-panel | whole-product | correctness-auditor-proposal | claims: 11 | struck: 0 | downgraded: 2 | note: A6 and A8 confirmed but latent (no field gap today, DB_VERSION 1)
2026-09-29 | feature-panel | whole-product | verifier | claims: 32 | struck: 0 | downgraded: 0 | note: 0% strike below 5% floor, attempts listed; verifier misreported its total as 36 (table has 32 rows)
2026-09-30 | implement | data-durability | verifier | claims: 9 | struck: 2 | downgraded: 0 | note: struck D4 (clearAllData not wrapped) and D7 (CLAUDE.md invariants without enforcing tests); both fixed and re-gated
2026-09-30 | implement | cloud-sync | verifier | claims: 8 | struck: 1 | downgraded: 0 | note: struck C6 (stale docs); also found clear-undone-by-sync, stale restore, no retry after offline start, missing welcome toast, cross-tab sign-in; all fixed with regression tests
