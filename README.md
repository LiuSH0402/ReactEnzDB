# ReactEnzDB

ReactEnzDB is a reaction-centered database that connects biochemical reactions with candidate enzymes, kinetic information and supporting evidence. Its web interface supports reaction searches and links outputs from prediction and pathway-planning tools to enzyme and evidence records.

**Website:** [ReactEnzDB](http://reactenzdb.lin-group.cn/)

The current data release contains 23,598 reaction records, 155,428 enzyme records, 249,032 reaction–enzyme associations and 23,634 reaction-linked kinetic records.

## Repository contents

| Directory | Contents |
| --- | --- |
| `nextjs_site/Nicktio-nextjs-pro-main/package/` | Web interface, API routes, reaction matching and evidence navigation |
| `processing/` | Offline parsing, normalization and record matching |
| `scripts/` | Data processing, evidence construction, export and validation |
| `predictor_runtime/`, `retrobiocat_runtime/`, `subnetx_runtime/` | ReactEnzDB service adapters for prediction and pathway tools |
| `experiments/matching/` | Saved development queries, component comparisons and summary scripts |
| `examples/` | Single-step and multistep examples |
| `tests/`, `schemas/` | Regression tests and runtime database schemas |
| `deploy/` | Docker Compose and deployment configuration templates |

## Installation

Use Node.js 24 or later and Python with RDKit. The validated environment is described in [Validation](docs/VALIDATION.md).

```bash
python -m pip install -r requirements-web.txt
cd nextjs_site/Nicktio-nextjs-pro-main/package
npm ci
npm run build
npm run test:unit
```

Run the Python tests from the repository root:

```bash
python -m unittest discover -s tests -v
```

For offline processing, install the additional dependencies in `requirements-processing.txt`.

## Running the website

Full search and evidence features require compatible runtime databases. See [Data layout](docs/DATA_LAYOUT.md) for the required files and their availability.

Copy `.env.example` to `.env.local` in the website directory and configure the data locations and Python interpreter.

```bash
# From the repository root
python scripts/check_runtime_inputs.py --core /path/to/reactenzdb_web.db --evidence /path/to/reactenzdb_evidence_rc.sqlite

cd nextjs_site/Nicktio-nextjs-pro-main/package
npm run dev
```

Docker and optional tool services are described in [Deployment](docs/DEPLOYMENT.md) and [Tool integration](docs/TOOLS.md).

## Data processing

Processing starts from local source files and covers chemical normalization, protein identifiers, reaction–enzyme associations, evidence organization and release exports. See [Processing](docs/PROCESSING.md) for inputs and individual commands, and [Data sources](docs/DATA_SOURCES.md) for source attribution.

## Examples and evaluation

[Examples](examples/README.md) include a single-step reaction query and a recorded two-step route. The evaluation scripts replay 61 development queries using saved tool outputs to compare the retained baseline and current matching component.

```bash
# Configure the runtime inputs described in docs/DATA_LAYOUT.md first
node experiments/matching/replay.cjs
python experiments/matching/summarize.py
```

See [Reproducibility](docs/REPRODUCIBILITY.md) for the evaluation scope and interpretation.

## License

See [LICENSE](LICENSE) and [Third-party notices](THIRD_PARTY_NOTICES.md).
