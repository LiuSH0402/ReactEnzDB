PRAGMA foreign_keys = ON;

CREATE TABLE registry_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
) STRICT;

CREATE TABLE registry_build_sources (
    source_path TEXT PRIMARY KEY,
    source_role TEXT NOT NULL,
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64)
) STRICT;

CREATE TABLE curated_hosts (
    host_id TEXT PRIMARY KEY,
    scientific_name TEXT NOT NULL,
    strain TEXT NOT NULL,
    taxonomy_id INTEGER,
    identity_scope TEXT NOT NULL,
    identity_status TEXT NOT NULL,
    curation_status TEXT NOT NULL CHECK (
        curation_status IN ('COMPARISON_ELIGIBLE', 'LIMITED_CANDIDATE')
    ),
    comparison_status TEXT NOT NULL,
    statistics_eligible INTEGER NOT NULL CHECK (statistics_eligible IN (0, 1)),
    preliminary_migration_status TEXT NOT NULL DEFAULT 'NOT_IMPORTED',
    ordinal INTEGER NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE host_references (
    reference_id TEXT PRIMARY KEY,
    doi TEXT,
    pmid TEXT,
    citation TEXT,
    url TEXT,
    reference_role TEXT NOT NULL,
    note TEXT,
    CHECK (doi IS NOT NULL OR pmid IS NOT NULL OR url IS NOT NULL)
) STRICT;

CREATE TABLE host_models (
    model_id TEXT PRIMARY KEY,
    host_id TEXT NOT NULL REFERENCES curated_hosts(host_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    model_name TEXT NOT NULL,
    model_scope TEXT NOT NULL,
    model_status TEXT NOT NULL,
    preferred_release_id TEXT REFERENCES host_model_releases(release_id) DEFERRABLE INITIALLY DEFERRED,
    UNIQUE (host_id, model_name)
) STRICT;

CREATE TABLE host_model_releases (
    release_id TEXT PRIMARY KEY,
    model_id TEXT NOT NULL REFERENCES host_models(model_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    internal_source_host_id TEXT NOT NULL,
    version_ref TEXT NOT NULL,
    artifact_sha256 TEXT NOT NULL UNIQUE CHECK (length(artifact_sha256) = 64),
    normalized_model_sha256 TEXT NOT NULL CHECK (length(normalized_model_sha256) = 64),
    source_url TEXT NOT NULL,
    artifact_relpath TEXT NOT NULL,
    model_format TEXT NOT NULL,
    objective_id TEXT,
    medium_id TEXT,
    acquisition_status TEXT NOT NULL,
    selection_decision TEXT NOT NULL,
    release_status TEXT NOT NULL,
    release_date TEXT,
    created_at TEXT NOT NULL
) STRICT;

CREATE TABLE host_reference_links (
    link_id TEXT PRIMARY KEY,
    reference_id TEXT NOT NULL REFERENCES host_references(reference_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    host_id TEXT NOT NULL REFERENCES curated_hosts(host_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    model_id TEXT REFERENCES host_models(model_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    release_id TEXT REFERENCES host_model_releases(release_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    link_role TEXT NOT NULL,
    UNIQUE (reference_id, host_id, model_id, release_id, link_role)
) STRICT;

CREATE TABLE host_aliases (
    alias_id TEXT PRIMARY KEY,
    host_id TEXT NOT NULL REFERENCES curated_hosts(host_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    alias TEXT NOT NULL,
    alias_type TEXT NOT NULL,
    source_reference_id TEXT REFERENCES host_references(reference_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    note TEXT
) STRICT;

CREATE UNIQUE INDEX ux_host_aliases_host_alias_nocase
    ON host_aliases(host_id, alias COLLATE NOCASE);
CREATE INDEX ix_host_aliases_alias_nocase
    ON host_aliases(alias COLLATE NOCASE);

CREATE TABLE host_relationships (
    relationship_id TEXT PRIMARY KEY,
    host_id TEXT NOT NULL REFERENCES curated_hosts(host_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    related_scientific_name TEXT NOT NULL,
    related_strain TEXT NOT NULL,
    relationship_type TEXT NOT NULL,
    source_reference_id TEXT REFERENCES host_references(reference_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    note TEXT NOT NULL,
    UNIQUE (host_id, related_scientific_name, related_strain, relationship_type)
) STRICT;

CREATE TABLE host_licenses (
    license_id TEXT PRIMARY KEY,
    release_id TEXT NOT NULL UNIQUE REFERENCES host_model_releases(release_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    license_name TEXT NOT NULL,
    evidence_text TEXT NOT NULL,
    evidence_url TEXT,
    evidence_sha256 TEXT CHECK (evidence_sha256 IS NULL OR length(evidence_sha256) = 64),
    redistribution_allowed INTEGER CHECK (redistribution_allowed IN (0, 1) OR redistribution_allowed IS NULL),
    commercial_use_allowed INTEGER CHECK (commercial_use_allowed IN (0, 1) OR commercial_use_allowed IS NULL),
    commercial_use_status TEXT NOT NULL,
    review_status TEXT NOT NULL
) STRICT;

CREATE TABLE qc_runs (
    qc_run_id TEXT PRIMARY KEY,
    qc_type TEXT NOT NULL,
    source_path TEXT NOT NULL REFERENCES registry_build_sources(source_path) ON UPDATE CASCADE ON DELETE RESTRICT,
    source_sha256 TEXT NOT NULL CHECK (length(source_sha256) = 64),
    environment_json TEXT NOT NULL CHECK (json_valid(environment_json)),
    method_note TEXT NOT NULL,
    run_date TEXT NOT NULL
) STRICT;

CREATE TABLE host_model_qc (
    qc_id TEXT PRIMARY KEY,
    release_id TEXT NOT NULL REFERENCES host_model_releases(release_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    qc_run_id TEXT NOT NULL REFERENCES qc_runs(qc_run_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    metric_name TEXT NOT NULL,
    metric_value_num REAL,
    metric_value_text TEXT,
    unit TEXT,
    status TEXT NOT NULL,
    method TEXT,
    evidence_sha256 TEXT CHECK (evidence_sha256 IS NULL OR length(evidence_sha256) = 64),
    details_json TEXT CHECK (details_json IS NULL OR json_valid(details_json)),
    measured_at TEXT NOT NULL,
    CHECK (metric_value_num IS NOT NULL OR metric_value_text IS NOT NULL),
    UNIQUE (release_id, qc_run_id, metric_name)
) STRICT;

CREATE TABLE mapping_policy_versions (
    policy_id TEXT PRIMARY KEY,
    policy_version TEXT NOT NULL UNIQUE,
    policy_sha256 TEXT NOT NULL UNIQUE CHECK (length(policy_sha256) = 64),
    policy_json TEXT NOT NULL CHECK (json_valid(policy_json)),
    policy_status TEXT NOT NULL,
    production_approval TEXT NOT NULL,
    frozen_at TEXT NOT NULL
) STRICT;

CREATE TABLE reaction_registry_snapshot (
    reaction_id TEXT PRIMARY KEY,
    reactenz_reaction_id TEXT NOT NULL UNIQUE,
    reaction_equation TEXT,
    reaction_direction TEXT,
    source_path TEXT NOT NULL REFERENCES registry_build_sources(source_path) ON UPDATE CASCADE ON DELETE RESTRICT,
    source_database_sha256 TEXT NOT NULL CHECK (length(source_database_sha256) = 64),
    snapshot_release TEXT NOT NULL,
    CHECK (substr(reaction_id, 1, 3) <> 'REO')
) STRICT;

CREATE TABLE reaction_host_mapping (
    mapping_id TEXT PRIMARY KEY,
    reaction_id TEXT NOT NULL REFERENCES reaction_registry_snapshot(reaction_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    release_id TEXT NOT NULL REFERENCES host_model_releases(release_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    policy_id TEXT NOT NULL REFERENCES mapping_policy_versions(policy_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    model_reaction_id TEXT,
    mapping_status TEXT NOT NULL CHECK (
        mapping_status IN ('EXACT_NATIVE', 'DIRECTIONAL_NATIVE', 'CONTEXT_ONLY', 'NOT_MAPPED', 'UNRESOLVED')
    ),
    mapping_method TEXT NOT NULL,
    identity_basis TEXT NOT NULL,
    direction_relation TEXT NOT NULL CHECK (
        direction_relation IN ('SAME', 'REVERSE', 'HOST_REVERSIBLE', 'REACTENZDB_REVERSIBLE', 'BOTH_REVERSIBLE', 'CONSTRAINT_CONFLICT', 'UNKNOWN', 'NOT_APPLICABLE')
    ),
    reactenzdb_equation TEXT,
    host_equation TEXT,
    matched_metabolites_json TEXT NOT NULL CHECK (json_valid(matched_metabolites_json)),
    unmatched_metabolites_json TEXT NOT NULL CHECK (json_valid(unmatched_metabolites_json)),
    compartment_relation TEXT NOT NULL CHECK (
        compartment_relation IN ('SAME_COMPARTMENT', 'COMPARTMENT_NEUTRAL_MATCH', 'CROSS_COMPARTMENT_TRANSPORT_REQUIRED', 'MULTI_COMPARTMENT_AMBIGUOUS', 'NOT_APPLICABLE', 'UNKNOWN')
    ),
    gene_association TEXT,
    gene_ids_json TEXT NOT NULL CHECK (json_valid(gene_ids_json)),
    mapping_confidence REAL CHECK (mapping_confidence IS NULL OR (mapping_confidence >= 0.0 AND mapping_confidence <= 1.0)),
    mapping_notes TEXT NOT NULL,
    qc_flags_json TEXT NOT NULL CHECK (json_valid(qc_flags_json)),
    search_trace_json TEXT NOT NULL CHECK (json_valid(search_trace_json)),
    mapping_version TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (reaction_id, release_id, policy_id),
    CHECK (substr(reaction_id, 1, 3) <> 'REO'),
    CHECK (mapping_status <> 'NOT_MAPPED' OR model_reaction_id IS NULL),
    CHECK (mapping_status NOT IN ('EXACT_NATIVE', 'DIRECTIONAL_NATIVE') OR (model_reaction_id IS NOT NULL AND mapping_confidence = 1.0)),
    CHECK (mapping_status NOT IN ('EXACT_NATIVE', 'DIRECTIONAL_NATIVE') OR direction_relation <> 'UNKNOWN')
) STRICT;

CREATE TABLE reaction_host_mapping_candidates (
    candidate_id TEXT PRIMARY KEY,
    mapping_id TEXT NOT NULL REFERENCES reaction_host_mapping(mapping_id) ON UPDATE CASCADE ON DELETE CASCADE,
    model_reaction_id TEXT NOT NULL,
    candidate_rank INTEGER NOT NULL CHECK (candidate_rank > 0),
    candidate_status TEXT NOT NULL CHECK (
        candidate_status IN ('ACCEPTED', 'CONTEXT_ONLY', 'AMBIGUOUS', 'REJECTED')
    ),
    mapping_method TEXT NOT NULL,
    identity_basis TEXT NOT NULL,
    evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
    UNIQUE (mapping_id, model_reaction_id)
) STRICT;

CREATE INDEX ix_host_models_host ON host_models(host_id);
CREATE INDEX ix_host_model_releases_model ON host_model_releases(model_id);
CREATE INDEX ix_host_model_qc_release_metric ON host_model_qc(release_id, metric_name);
CREATE INDEX ix_host_reference_links_host ON host_reference_links(host_id, link_role);
CREATE INDEX ix_reaction_host_mapping_release_status ON reaction_host_mapping(release_id, mapping_status);
CREATE INDEX ix_reaction_host_mapping_reaction_status ON reaction_host_mapping(reaction_id, mapping_status);
CREATE INDEX ix_reaction_host_mapping_candidates_mapping ON reaction_host_mapping_candidates(mapping_id, candidate_rank);

CREATE VIEW v_host_registry_current AS
SELECT
    h.host_id,
    h.scientific_name,
    h.strain,
    h.identity_scope,
    h.identity_status,
    h.curation_status,
    h.comparison_status,
    h.statistics_eligible,
    m.model_id,
    m.model_name,
    m.model_scope,
    r.release_id,
    r.version_ref,
    r.artifact_sha256,
    r.normalized_model_sha256,
    r.objective_id,
    r.medium_id,
    l.license_name,
    l.redistribution_allowed,
    l.commercial_use_allowed,
    l.review_status
FROM curated_hosts AS h
JOIN host_models AS m ON m.host_id = h.host_id
JOIN host_model_releases AS r ON r.release_id = m.preferred_release_id
LEFT JOIN host_licenses AS l ON l.release_id = r.release_id;

CREATE VIEW v_host_alias_lookup AS
SELECT h.host_id, h.scientific_name, h.strain, h.host_id AS lookup_value, 'CANONICAL_HOST_ID' AS lookup_type
FROM curated_hosts AS h
UNION ALL
SELECT h.host_id, h.scientific_name, h.strain, a.alias AS lookup_value, a.alias_type AS lookup_type
FROM curated_hosts AS h
JOIN host_aliases AS a ON a.host_id = h.host_id;
