# Offline data processing

The processing modules operate on local source files and working databases. See [Data sources](DATA_SOURCES.md) for attribution and [`PROCESSING_INPUTS.json`](PROCESSING_INPUTS.json) for script-specific inputs.

## Modules

| Module | Function | Inputs |
| --- | --- | --- |
| `processing/source_parser/parser.py` | Parse reactions, proteins, references and kinetic fields | Source HTML; `parse_detail_page(biopart_id, html)` |
| `processing/normalization.py`, `cleaning.py` | Normalize EC/compound fields and apply cleaning rules | Working database using the curation schema |
| `processing/compounds_pubchem.py` | Validate structures and apply local compound supplements | Previously obtained compound records |
| `processing/protein_domains.py` | Parse domains/sites and map sequence positions conservatively | UniProt rows, InterPro dictionaries and local isoform sequences |
| `processing/match_alphafold.py` | Associate existing structure records with enzymes | Local prediction metadata |
| `processing/kinetics_external_checks.py` | Parse and match external kinetic records | Local BRENDA/SABIO-RK results and a working database |
| `processing/mcsa_mechanisms.py` | Parse and map mechanism entries | Local M-CSA entries |
| `processing/condition_parser.py`, `recover_direct_conditions.py` | Extract explicit pH/temperature and link kinetic identities | Working database and explicit database/report arguments |
| `processing/scoped_observations.py` | Store expression/stability observations with defined scope | Reviewed input records |
| `processing/scope_filter.py` | Apply release policies and check linked-record consistency | An explicit filtering policy |

Isoform sequences are supplied through `set_local_isoform_sequences({accession: sequence})`. Missing sequences remain unresolved rather than being replaced with assumed residues.

## Locations and dependencies

- `REACTENZDB_INPUT_ROOT`: defaults to `inputs/`, with documented subdirectories such as `inputs/rdbsb_v2/`.
- `RETROSYNTHESIS_DATA_ROOT`: optional upstream tool resources.
- `web_release/`, `evidence_work/`, `expression_work/`, `reaction_standardization_work/`: working or derived outputs, excluded from version control when generated.

Scripts use stage-specific formats and do not share a universal input argument. Run database-writing commands on working copies. The website download schema is not interchangeable with the original curation schema.

## Build release layers

`build_web_release.py --source-db ... --output-db ...` reads the curation database and creates release tables. `data_semantics.py` handles source/direction semantics, `reo_ids.py` assigns stable identifiers, and `enrich_web_evidence.py` combines local curation records and exports.

Reaction standardization, standalone evidence, expression, sequence and candidate layers are separate processing stages. Reconstructing a full release requires matching source versions, revision inputs, reviewed inheritance plans and release policies. These inputs are not all included in the repository.

## Apply a release policy

```bash
python -m processing.apply_public_scope --source /path/to/working_input.sqlite --output /path/to/new_output.sqlite --policy /path/to/approved_policy.json
```

The command creates a new output copy. Policy fields include `hidden_reactions`, `held_identifier_pairs` and exclusion sets for enzymes, associations and kinetic identifiers. Internal record lists are supplied separately; tests use synthetic identifiers.

The output reports `derived_statistics_rebuilt: false`. Rebuild the affected statistics, evidence scores and other derived layers before treating the output as a complete release.

## Exports and additional stages

`prepare_data_display_exports.py` creates a display-oriented projection that omits some source descriptions. Supply source attribution and the required record mappings separately when distributing that projection.

Additional scripts include:

- `build_reaction_cross_database_layer.py`: reaction mappings from local source files.
- `build_rxnmapper_atom_mapping_layer.py`: atom mapping, stereochemical restoration, calibration and validation; requires a compatible RXNMapper/PyTorch environment and model resources.
- `refresh_sequence_cluster_final_evidence.py`: propagate scoped final evidence to sequence clusters.
- `build_host_registry_staging.py`, `build_reaction_host_mapping_v1.py` and `schema/host_context_v1_staging.sql`: optional host registries and mappings, using their model and policy inputs.

Core matching and processing tests were run. Full historical reconstruction, atom mapping, sequence clustering, optional inference and host analyses were not rerun as part of the source-package validation; see [Validation](VALIDATION.md).
