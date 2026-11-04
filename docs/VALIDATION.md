# Validation

The following checks were completed on the source package on 4 November 2026. Runtime-dependent checks used existing local databases.

| Check | Result | Scope |
| --- | --- | --- |
| Frontend dependency installation | Passed; 150 platform packages | Original lockfile, `--ignore-scripts --legacy-peer-deps` |
| Next.js production build | Passed | Next.js 15.5.24; Node.js 24.22.1 |
| Python tests | 57 passed | 52 retained core tests and five offline-processing tests; standard-library unittest and RDKit 2026.03.1 |
| Website tests without full runtime inputs | 71 passed, eight skipped, zero failed | Data-dependent tests skipped |
| Website tests with read-only runtime inputs | 79 passed, zero skipped, zero failed | Evidence scope, literature notes, matching and kinetic-source summaries |
| Development replay | 61/61 requests completed | Matching, cohort and route coverage reproduced the 1 November 2026 results |
| Evidence-scope audit | 384 record pairs; 351 assertion-to-pair links; zero violations | Record-link consistency |
| Local production HTTP checks | Seven passed | Help, Search, two reaction pages, two candidate-specific literature endpoints and an invalid-pair 404 |
| Docker Compose | `config --quiet` passed | Configuration parsing and expansion |
| Offline function comparison | Passed | 54 functions across five extracted modules retained their original ASTs; site saving uses a local isoform source; the complete offline HTML parser AST, including 51 functions, matched the original |
| Runtime-input checks | Passed | Compatible runtime accepted; incomplete download projection identified |
| Static checks | Passed | Python syntax, undefined globals in extracted modules, collection-call patterns, common credential patterns and machine-local paths |

Detailed results are stored in [`HTTP_CHECK.json`](HTTP_CHECK.json), [`EVALUATION_REPLAY_CHECK.json`](EVALUATION_REPLAY_CHECK.json) and [`FUNCTION_PRESERVATION.json`](FUNCTION_PRESERVATION.json).

## Scope

These checks establish buildability and the behavior tested on the stated inputs. They do not constitute independent biological validation or deployment verification.

The following were outside this validation:

- The complete `npm run test:release` contract, which requires all frozen runtime/derived layers and the download catalog.
- Full historical database reconstruction and record-level review replay.
- All model inference, sequence clustering, host analyses and optional Docker services.
- Independent accuracy assessment, participant timing and new experimental validation.
- Other operating systems or future dependency versions.

Full data, installed dependencies, build caches and actual environment files are supplied or generated separately.
