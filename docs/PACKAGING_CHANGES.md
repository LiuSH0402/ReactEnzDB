# Source adaptations

This repository is an independent copy of the application and processing code. Preparing it did not change the deployed service.

## Presentation

The interface and generated reports use English. Technical file identifiers are omitted from user-facing views.

## Configuration

- Replaced machine-specific Python defaults with `python`, retaining environment overrides.
- Added configurable release paths and explicit download locations.
- Moved selected local processing inputs to `inputs/` or environment-configured paths.
- Adapted Docker build contexts and image names to this repository layout.
- Set Node.js requirements to 24 or later for the validated test and deployment configuration.
- Retained the npm dependencies, lockfile and `legacy-peer-deps` installation setting.

## Processing and evaluation

- Retained the core reaction matching, direction, identifier, inheritance and evidence-scope rules.
- Separated offline parsing and matching into processing modules. Isoform mapping now accepts local sequence dictionaries.
- Exposed database/report parameters for condition recovery and extracted the shared scoring function.
- Required explicit policies and new output copies for public-scope filtering.
- Preserved the 61 development queries, original summaries and comparison formulas; new replay results use a separate output directory.
- Distinguished data-independent tests from tests that require runtime snapshots.
- Removed one machine-local path from the website statistics metadata without changing scientific statistics.

Processing scripts still require their documented input schemas, source files and record-level decisions. Validation results and the functions checked against the original implementation are described in [Validation](VALIDATION.md).
