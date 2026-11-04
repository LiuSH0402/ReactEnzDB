# Matching evaluation protocol

Recorded on 1 November 2026. This protocol separates replay of existing development cases from proposed independent accuracy and usability studies. Only the development replay and automated checks were performed.

## Fixed development inputs

1. All 43 saved predictions for the six single-step targets fixed on 31 October 2026. Preserve precursors, products, tools, order and duplicates; use the saved predictions.
2. All 13 non-empty steps from the previously selected top-five routes for two products. Retain empty proposals in the original planner records and report them separately.
3. Five constructed engineering controls, reported separately from natural predictions.

The 56 prediction/step inputs are not 56 independent targets. Report tool outputs and deduplicated structure queries separately; repeated route steps are not independent experiments.

## Controlled component comparison

- **A — retained baseline:** `findExactRetrosynthesisReactionMatches`, canonical-SMILES matching with left-to-right coverage, at most five reference records and 30 core enzyme candidates per reference.
- **B — current website route:** protonation normalization, direction interpretation and exclusion of no-net-change queries, with the same reference and core-candidate limits.
- Use the same core database and predictions. First verify that old and new indexes contain the same logical `(reaction_id, side, canonical_smiles, is_currency)` records.
- Audit both arms against the same evidence database. The baseline detail pages already contain evidence, so baseline evidence must not be treated as absent. An offline evidence join is distinct from a direct pair-specific interface link.
- This compares two ReactEnzDB components. It is not a comparison of the complete READRetro, GSETRetro or RetroBioCat products and their native enzyme, EC or specificity features.

## Automated measurements

Record request outcomes, predictions with reference candidates, unmatched/invalid/wildcard/no-net-change queries, unspecified directions, truncation, deduplicated reaction–protein pairs, and candidates linked to assertions, measurements and citations. Traverse all evidence pages and verify that each assertion belongs to both the reaction and the protein.

These measures describe retrieval and link consistency. They are not accuracy, true recall, experimental-support precision or human time savings. Technical execution times are reproducibility information; differences in implementation and caching preclude interpreting them as participant task times.

## Proposed independent studies

The following studies were specified but have not been conducted.

### Reaction and evidence correspondence

Freeze a new task set that was not used in development. Record the sampling population, seed, exclusions and failures. Stratify by stereochemistry, regioselectivity, direction, cofactors/additional substrates, exchange/transport and single-step versus overall reactions.

Two reviewers would independently assess materials with method identities hidden, with a third reviewer resolving disagreements. Label query-side coverage, complete reaction identity, protein identity, construct identity and experimental support separately as supported, contradicted or insufficient. Report disagreements and indeterminate cases. Report true recall only when a complete reference set exists.

### Evidence retrieval

Require a specific reaction, protein/construct, assay parameters, conditions and the supporting passage, figure or table. Distinguish finding a source lead, finding a matching experiment and verifying the original report.

Compare the ReactEnzDB workflow against complete upstream tools plus public resources, recording versions, network availability and native enzyme/activity features.

### Human operations and task time

Use real participants, fixed tasks, counterbalanced workflow order and matched task difficulty. Specify tasks, timing boundaries, time limits and completion criteria before testing. Blind final correctness reviewers to method identity where possible.

Record searches, copying, identifier conversions, resource switches, reading and verification steps, including failures, timeouts, assistance and interruptions. External-site actions require observation, screen records or participant event logs; ReactEnzDB logs alone are insufficient. Exclude recorder actions from task operations.

Compare time to the same correct endpoint and report completion and error rates alongside time. Account for participant background and paired/stratified analysis; determine sample size from pilot variance and target precision.

## Recorded status

Automated raw results and summaries are available. Independent correctness review and participant-operation measurements were not performed. Development replay results describe changes in reference-record and source-lead accessibility, without establishing independent superiority.
