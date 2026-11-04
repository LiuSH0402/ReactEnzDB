# Tool integration

ReactEnzDB adapters connect prediction and pathway-planning outputs to reaction searches, candidate enzymes and evidence records.

## Included adapters

| Implementation | Role |
| --- | --- |
| `predictor_runtime/image/server.py`, `scripts/run_retrosynthesis_predictor.py` | Local CPU prediction services with a common output format |
| `retrobiocat_runtime/image/server.py`, `adapter.py` | Bounded rule-based planning adapter |
| `subnetx_runtime/image/server.py`, `engine.py` | Bounded candidate-path extraction |
| Website matching API, `retrosynthesis_mapping.py`, `retrosynthesisMapping.ts` | Structure matching, direction interpretation and reaction–enzyme–evidence links |

The RetroBioCat adapter does not implement the upstream project's complete substrate-specificity scoring workflow. The SubNetX adapter does not run CPLEX optimization and does not estimate final yield or pathway feasibility.

## Upstream resources

- [GSETRetro](https://github.com/momozhangcn/GSETRetro)
- [READRetro](https://github.com/SeulLee05/READRetro)
- [BioNavi-NP](https://github.com/prokia/BioNavi-NP)
- [RetroBioCat](https://retrobiocat.com/)
- [SubNetX](https://github.com/EPFL-LCSB/SubNetX)

Install compatible upstream source code, weights, rules and graph resources separately, subject to their respective terms. This repository contains the ReactEnzDB adapters; see [Third-party notices](../THIRD_PARTY_NOTICES.md).

## Configuration

The predictor uses `RETROSYNTHESIS_DATA_ROOT` for upstream project and weight directories. Service `requirements.txt` files retain the relevant dependencies. RetroBioCat service variables specify its source directory, rule YAML and building-block database. SubNetX uses `SUBNETX_DATABASE`.

Tool services are disabled by default until their resources and environment variables are configured. Enable them through the supported settings and the Compose `tools` profile; see [Deployment](DEPLOYMENT.md).

The recorded evaluation replays saved predictions and routes. All upstream models and optional service containers were not rebuilt or rerun during source-package validation.
