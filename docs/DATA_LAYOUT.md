# Runtime data

The repository contains source code and database schemas. Full databases are supplied separately. Release metadata are recorded in [`data/RELEASE_IDENTITY.json`](../data/RELEASE_IDENTITY.json); schema differences are listed in [`data/DOWNLOAD_VS_RUNTIME_SCHEMA.json`](../data/DOWNLOAD_VS_RUNTIME_SCHEMA.json).

## Data availability and compatibility

The website download is an analysis-oriented export rather than a complete runtime snapshot. Its four core record counts match the runtime database, but some source columns, internal tables and indexes are omitted. The runtime core has 102 regular/FTS-related table entries, compared with 71 in the download; this difference does not represent a count of missing scientific entities.

The current download catalog does not include the standalone evidence database, `reactenzdb_evidence_rc.sqlite`. Downloaded evidence tables are not a substitute for its complete assertions, measurements and citations. Full evidence navigation and evaluation replay therefore require additional compatible runtime inputs. The validation in this repository used an existing local runtime snapshot; those databases are not bundled here.

## Expected layout

```text
web_release/
  reactenzdb_web.db
  retrosynthesis_reaction_lookup.sqlite
  reaction_standardization.sqlite
  evidence/
    reactenzdb_evidence_rc.sqlite
    reactenzdb_evidence_rc.summary.json
  expression/
    expression_evidence.sqlite
  RETROSYNTHESIS_TOOL_REGISTRY.json
  PUBLIC_RELEASE_GOVERNANCE.json
  DATA_LAYER_REGISTRY.json
  ...                                   # Additional analysis layers and summaries

data/downloads/
  catalog_public.json
  download_bundle/...
```

Set `REACTENZDB_RELEASE_DIR` to override the release directory. Evidence, expression and download locations have separate environment variables; see the website `.env.example` and [Deployment](DEPLOYMENT.md). Optional host-context functions use `HOST_CONTEXT_STAGING_DB_PATH` and `REACTENZDB_PATHWAY_COEFFICIENT_EVIDENCE_PATH`.

`schemas/runtime_core.sql` and `schemas/runtime_evidence.sql` describe the runtime schemas without data rows.

## Check the inputs

```bash
python scripts/check_runtime_inputs.py --core /path/to/reactenzdb_web.db --evidence /path/to/reactenzdb_evidence_rc.sqlite
```

The command checks minimum schema requirements and exits with code 2 when inputs are insufficient. It does not download or modify databases. Optional layers must be configured separately.

The reaction lookup records its RDKit version and rejects an incompatible interpreter. To rebuild a derived lookup from a compatible core database:

```bash
python scripts/build_retrosynthesis_reaction_lookup.py --source /path/to/core.db --output /path/to/new_lookup.sqlite
```

Point `REACTENZDB_RETROSYNTHESIS_LOOKUP_DB` to the new file and retain the original snapshot separately.
