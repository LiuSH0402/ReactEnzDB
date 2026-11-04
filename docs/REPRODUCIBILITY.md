# Reproducibility and evaluation

The repository supports source installation/build checks and replay of saved development queries with compatible runtime data. A complete reconstruction from original source resources also requires the historical inputs and curation decisions described in [Processing](PROCESSING.md).

## Development queries

`experiments/matching/queries.json` contains 43 single-step predictions, 13 non-empty multistep route steps and five engineering controls. These inputs were used during development and are not an independent test set. The comparison covers the retained baseline and current ReactEnzDB matching component, rather than all capabilities of the upstream prediction tools.

`recorded_20261101/summary.json` stores the original results. `recorded_20261101/inputs.json` describes the runtime inputs used for that evaluation. Original planner proposals, including two empty routes among ten proposals, are retained in `original_routes/`.

## Replay

Provide the runtime inputs listed in [Data layout](DATA_LAYOUT.md), then configure:

- `REACTENZDB_RELEASE_DIR`: core database, lookup index and analysis layers.
- `REACTENZDB_PYTHON`: Python with the RDKit version required by the lookup.
- `REACTENZDB_EVIDENCE_DB` and `REACTENZDB_EVIDENCE_RELEASE_DIR`: evidence database and summary locations.
- `REACTENZDB_EVALUATION_OUTPUT`: optional output directory; defaults to `experiments/matching/results/`.

Run from the repository root:

```bash
node experiments/matching/replay.cjs
python experiments/matching/summarize.py
```

Replay calls the retained baseline function and current API route with saved model outputs. It traverses evidence pagination and checks that each assertion belongs to the corresponding reaction and protein, with measurements, citations and conditions linked to that assertion. New model inference is not required for this replay.

## Recorded results

The local replay completed all 61 requests and reproduced the matching, cohort and route-coverage summaries recorded on 1 November 2026. The evidence audit covered 384 reaction–protein record pairs and 351 assertion-to-pair links, with no scope violations detected.

| Development inputs | Baseline: inputs with a reference match | Current component: inputs with a reference match |
| --- | --- | --- |
| Single-step predictions | 3/43 | 19/43 |
| Non-empty route steps | 4/13 | 11/13 |

These results measure reference-candidate retrieval coverage. They do not establish independent reaction accuracy, experimental activity, human time savings or pathway success. Candidate interpretation may still depend on additional participants, reaction direction, construct identity and result limits. Publication identifiers and automated evidence labels do not replace checking the underlying experiments.

## Examples

`examples/single_step/query.json` contains an L-phenylalanine-to-trans-cinnamate query. `examples/multistep/recorded_route_20261031.json` preserves a recorded CAR-to-reduction route and its historical verification status.

The website's later literature notes are stored separately in `nextjs_site/Nicktio-nextjs-pro-main/package/public/data/reaction-enzyme-literature.json`. References found for individual steps do not establish direct experimental support for every specified candidate or compatibility of the combined cascade, including conditions, cofactors, product identification and E/Z specificity.
