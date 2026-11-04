#!/usr/bin/env python3
"""Build the Host Context v1 identity/model/release/QC registry in staging only."""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
STAGING_ROOT = ROOT / "staging" / "host-context" / "2026.09.1"
DB_PATH = STAGING_ROOT / "host_context_v1_staging.sqlite"
SCHEMA_PATH = ROOT / "schema" / "host_context_v1_staging.sql"
REPORT_JSON = ROOT / "host_registry_staging_build_202609.json"
REPORT_MD = ROOT / "HOST_REGISTRY_STAGING_BUILD_202609.md"
STAMP = "2026-09-15T00:00:00+08:00"

SOURCE_FILES = {
    "host_identity_registry_202609.json": "HOST_IDENTITY",
    "host_model_freeze_202609.json": "MODEL_RELEASE_FREEZE",
    "host_model_qc_202609.json": "STRUCTURAL_QC",
    "host_model_memote_202609.json": "MEMOTE_QC",
    "host_medium_validation_202609.json": "MEDIUM_VALIDATION",
    "host_condition_qc_202609.json": "CONDITION_CONSISTENCY_QC",
    "host_model_comparison_status_202609.json": "COMPARISON_DECISION",
    "host_model_audit_30_202609.json": "PROVENANCE_AND_PUBLICATION",
    "host_reaction_mapping_policy_202609.json": "FROZEN_REACTION_HOST_MAPPING_POLICY",
    "web_release/reactenzdb_web.db": "READ_ONLY_REACTION_REGISTRY_SNAPSHOT_SOURCE",
    "schema/host_context_v1_staging.sql": "DATABASE_SCHEMA",
}


def read_json(name: str) -> dict[str, Any]:
    return json.loads((ROOT / name).read_text(encoding="utf-8"))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def release_database_hashes() -> dict[str, str]:
    paths: set[Path] = set()
    for pattern in ("*.db", "*.sqlite", "*.sqlite3"):
        paths.update((ROOT / "web_release").glob(pattern))
    return {
        str(path.relative_to(ROOT)).replace("\\", "/"): sha256(path)
        for path in sorted(paths)
    }


def stable_id(prefix: str, *values: object) -> str:
    key = "|".join("" if value is None else str(value).strip().lower() for value in values)
    return f"{prefix}_{hashlib.sha256(key.encode('utf-8')).hexdigest()[:20]}"


def parse_reference_id(raw: str | None) -> tuple[str | None, str | None]:
    if not raw:
        return None, None
    label, separator, value = raw.partition(":")
    if not separator:
        return None, None
    if label.upper() == "DOI":
        return value.strip().lower(), None
    if label.upper() == "PMID":
        return None, value.strip()
    return None, None


def model_format(relpath: str) -> str:
    suffix = Path(relpath).suffix.lower()
    return {
        ".json": "COBRA_JSON",
        ".xml": "SBML_XML",
        ".sbml": "SBML_XML",
        ".omex": "COMBINE_OMEX",
        ".mat": "MATLAB_MODEL",
    }.get(suffix, suffix.lstrip(".").upper() or "UNKNOWN")


def license_projection(status: str, evidence: str) -> tuple[str, int | None, int | None, str]:
    text = evidence.lower()
    if "cc by-nc-sa" in text:
        name = "CC BY-NC-SA 4.0 (scope under review)"
    elif "cc-by-4.0" in text or "cc by 4.0" in text:
        name = "CC BY 4.0"
    elif "bsd 3-clause" in text:
        name = "BSD-3-Clause"
    elif "isc license" in text:
        name = "ISC"
    elif "cc0" in text:
        name = "CC0-1.0"
    elif "bigg" in text and "non-commercial" in text:
        name = "BiGG non-commercial resource terms"
    else:
        name = "UNRESOLVED_MODEL_LICENSE"

    if status in {
        "PASS_EXPLICIT_REPOSITORY_LICENSE",
        "PASS_EXPLICIT_MODEL_FILE_LICENSE",
        "PASS_BIOMODELS_CC0_RESOURCE_EVIDENCE",
    }:
        return name, 1, 1, "EVIDENCE_RECORDED_REQUIRES_FINAL_HUMAN_REVIEW"
    if status in {"REVIEW_NONCOMMERCIAL_RESOURCE_TERMS", "REVIEW_NONCOMMERCIAL_SHAREALIKE_SCOPE"}:
        return name, None, 0, "NONCOMMERCIAL_OR_SCOPE_REVIEW_REQUIRED"
    if status.startswith("BLOCKED_"):
        return name, 0, None, "NO_REDISTRIBUTION_AUTHORITY_RECORDED"
    return name, None, None, "MODEL_FILE_LICENSE_SCOPE_UNCONFIRMED"


def add_reference(
    references: dict[str, dict[str, Any]],
    *,
    doi: str | None = None,
    pmid: str | None = None,
    citation: str | None = None,
    url: str | None = None,
    role: str,
    note: str | None = None,
) -> str:
    doi = doi.lower().removeprefix("https://doi.org/") if doi else None
    pmid = str(pmid) if pmid else None
    identity_key = doi or (f"pmid:{pmid}" if pmid else None) or url
    if not identity_key:
        raise ValueError("reference requires DOI, PMID or URL")
    reference_id = stable_id("ref", identity_key)
    prior = references.get(reference_id)
    candidate = {
        "reference_id": reference_id,
        "doi": doi,
        "pmid": pmid,
        "citation": citation,
        "url": url,
        "reference_role": role,
        "note": note,
    }
    if prior:
        for key in ("doi", "pmid", "citation", "url", "note"):
            if not prior.get(key) and candidate.get(key):
                prior[key] = candidate[key]
        if prior["reference_role"] != role:
            prior["reference_role"] = "MULTI_ROLE"
    else:
        references[reference_id] = candidate
    return reference_id


def insert_qc_metric(
    connection: sqlite3.Connection,
    *,
    release_id: str,
    run_id: str,
    metric_name: str,
    value: Any,
    status: str = "RECORDED",
    unit: str | None = None,
    method: str | None = None,
    evidence_sha256: str | None = None,
    details: Any = None,
) -> None:
    if isinstance(value, bool):
        numeric, textual = int(value), None
    elif isinstance(value, (int, float)) and value is not None:
        numeric, textual = float(value), None
    else:
        numeric, textual = None, str(value) if value not in (None, "") else "NOT_REPORTED"
    qc_id = stable_id("qc", release_id, run_id, metric_name)
    connection.execute(
        """INSERT INTO host_model_qc(
            qc_id, release_id, qc_run_id, metric_name, metric_value_num,
            metric_value_text, unit, status, method, evidence_sha256,
            details_json, measured_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            qc_id, release_id, run_id, metric_name, numeric, textual, unit,
            status, method, evidence_sha256,
            json.dumps(details, ensure_ascii=False, sort_keys=True) if details is not None else None,
            STAMP,
        ),
    )


def build_database(temp_path: Path) -> dict[str, Any]:
    identity_payload = read_json("host_identity_registry_202609.json")
    freeze_payload = read_json("host_model_freeze_202609.json")
    qc_payload = read_json("host_model_qc_202609.json")
    memote_payload = read_json("host_model_memote_202609.json")
    medium_payload = read_json("host_medium_validation_202609.json")
    condition_payload = read_json("host_condition_qc_202609.json")
    comparison_payload = read_json("host_model_comparison_status_202609.json")
    audit_payload = read_json("host_model_audit_30_202609.json")
    mapping_policy = read_json("host_reaction_mapping_policy_202609.json")
    if mapping_policy["mapping_unit"]["left_key"] != "web_reactions.reaction_id":
        raise RuntimeError("mapping policy must use the biochemical reaction_id as its left key")
    if mapping_policy["mapping_unit"]["right_key"] != "host_model_releases.release_id":
        raise RuntimeError("mapping policy must use release_id as its right key")
    if set(mapping_policy["core_statuses"]) != {"EXACT_NATIVE", "DIRECTIONAL_NATIVE", "CONTEXT_ONLY", "NOT_MAPPED", "UNRESOLVED"}:
        raise RuntimeError("mapping policy core status contract drift")

    identity = {row["internal_source_host_id"]: row for row in identity_payload["rows"]}
    freeze = {row["host_id"]: row for row in freeze_payload["hosts"]}
    qc = {row["host_id"]: row for row in qc_payload["rows"]}
    memote = {row["host_id"]: row for row in memote_payload["rows"]}
    medium = {row["host_id"]: row for row in medium_payload["results"]}
    condition = {row["host_id"]: row for row in condition_payload["rows"]}
    comparison = {row["internal_source_host_id"]: row for row in comparison_payload["rows"]}
    audit = {row["internal_source_host_id"]: row for row in audit_payload["A_inventory"]}
    keys = [set(mapping) for mapping in (identity, freeze, qc, memote, medium, condition, comparison, audit)]
    if any(group != keys[0] for group in keys[1:]) or len(keys[0]) != 30:
        raise RuntimeError("30-host source reports do not have identical internal host identities")

    for internal_id, frozen in freeze.items():
        artifact = STAGING_ROOT.parent.parent / "host-models" / "2026.09.1" / frozen["artifact_relpath"]
        normalized = STAGING_ROOT.parent.parent / "host-models" / "2026.09.1" / "normalized" / f"{internal_id}.xml"
        if sha256(artifact) != frozen["sha256"]:
            raise RuntimeError(f"artifact SHA drift: {internal_id}")
        if sha256(normalized) != qc[internal_id]["normalized_sbml_sha256"]:
            raise RuntimeError(f"normalized model SHA drift: {internal_id}")

    connection = sqlite3.connect(temp_path)
    connection.row_factory = sqlite3.Row
    try:
        connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        connection.execute("BEGIN IMMEDIATE")
        source_hashes = {name: sha256(ROOT / name) for name in SOURCE_FILES}
        connection.executemany(
            "INSERT INTO registry_build_sources(source_path, source_role, sha256) VALUES (?,?,?)",
            [(name, SOURCE_FILES[name], source_hashes[name]) for name in sorted(SOURCE_FILES)],
        )
        metadata = {
            "schema_version": "reactenzdb-host-context-v1-staging-registry-v1",
            "release_target": "2026.09.1",
            "as_of_date": "2026-09-15",
            "build_timestamp_policy": "FIXED_TO_EVIDENCE_FREEZE_FOR_REPRODUCIBILITY",
            "database_role": "STAGING_ONLY_NOT_PRODUCTION",
            "preliminary_data_policy": "NOT_IMPORTED_NOT_OVERWRITTEN",
            "host_identity_policy": "HOST_MODEL_RELEASE_IDENTITIES_SEPARATED",
            "publication_status": "NOT_PUBLISHED_AWAITING_HUMAN_SIGN_OFF",
        }
        connection.executemany(
            "INSERT INTO registry_metadata(key, value) VALUES (?,?)",
            sorted(metadata.items()),
        )
        policy_sha = source_hashes["host_reaction_mapping_policy_202609.json"]
        connection.execute(
            """INSERT INTO mapping_policy_versions(
                policy_id, policy_version, policy_sha256, policy_json,
                policy_status, production_approval, frozen_at
            ) VALUES (?,?,?,?,?,?,?)""",
            (
                mapping_policy["policy_id"], mapping_policy["policy_version"], policy_sha,
                json.dumps(mapping_policy, ensure_ascii=False, sort_keys=True),
                mapping_policy["status"], mapping_policy["production_approval"], STAMP,
            ),
        )
        reaction_source = ROOT / "web_release" / "reactenzdb_web.db"
        reaction_uri = reaction_source.resolve().as_uri() + "?mode=ro&immutable=1"
        with sqlite3.connect(reaction_uri, uri=True) as reaction_db:
            reaction_db.execute("PRAGMA query_only=ON")
            reaction_rows = reaction_db.execute(
                """SELECT r.reaction_id, i.reactenz_reaction_id,
                          r.reaction_equation_display, r.reaction_direction
                   FROM web_reactions AS r
                   JOIN web_reaction_ids AS i USING(reaction_id)
                   ORDER BY r.reaction_id"""
            ).fetchall()
        if len(reaction_rows) != 19623 or len({row[0] for row in reaction_rows}) != len(reaction_rows):
            raise RuntimeError("ReactEnzDB reaction registry snapshot cardinality or uniqueness drift")
        connection.executemany(
            """INSERT INTO reaction_registry_snapshot(
                reaction_id, reactenz_reaction_id, reaction_equation,
                reaction_direction, source_path, source_database_sha256,
                snapshot_release
            ) VALUES (?,?,?,?,?,?,?)""",
            [
                (*row, "web_release/reactenzdb_web.db", source_hashes["web_release/reactenzdb_web.db"], "2026.08.1_LOCAL_READ_ONLY_SNAPSHOT")
                for row in reaction_rows
            ],
        )

        model_ids: dict[str, str] = {}
        release_ids: dict[str, str] = {}
        for internal_id in sorted(keys[0], key=lambda item: int(freeze[item]["ordinal"])):
            ident = identity[internal_id]
            frozen = freeze[internal_id]
            comp = comparison[internal_id]
            host_id = ident["host_id"]
            curation_status = "COMPARISON_ELIGIBLE" if comp["statistics_eligible"] else "LIMITED_CANDIDATE"
            connection.execute(
                """INSERT INTO curated_hosts(
                    host_id, scientific_name, strain, taxonomy_id, identity_scope,
                    identity_status, curation_status, comparison_status,
                    statistics_eligible, preliminary_migration_status, ordinal,
                    created_at, updated_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    host_id, ident["scientific_name"], ident["strain"], None,
                    ident["identity_scope"], ident["identity_status"], curation_status,
                    comp["comparison_status"], int(comp["statistics_eligible"]),
                    "NOT_IMPORTED", int(ident["ordinal"]), STAMP, STAMP,
                ),
            )
            model_id = stable_id("mdl", host_id, frozen["selected_model"])
            release_id = stable_id("rel", frozen["sha256"])
            model_ids[internal_id] = model_id
            release_ids[internal_id] = release_id
            connection.execute(
                "INSERT INTO host_models(model_id, host_id, model_name, model_scope, model_status) VALUES (?,?,?,?,?)",
                (model_id, host_id, frozen["selected_model"], ident["model_scope"], "SELECTED_FOR_2026.09.1_STAGING"),
            )
            connection.execute(
                """INSERT INTO host_model_releases(
                    release_id, model_id, internal_source_host_id, version_ref,
                    artifact_sha256, normalized_model_sha256, source_url,
                    artifact_relpath, model_format, objective_id, medium_id,
                    acquisition_status, selection_decision, release_status,
                    release_date, created_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    release_id, model_id, internal_id, frozen["version_ref"],
                    frozen["sha256"], qc[internal_id]["normalized_sbml_sha256"],
                    frozen["official_source_url"], frozen["artifact_relpath"],
                    model_format(frozen["artifact_relpath"]), medium[internal_id]["objective_reaction"],
                    medium[internal_id]["medium_id"], frozen["acquisition_status"],
                    frozen["selection_decision"], "FROZEN_STAGING_RELEASE", None, STAMP,
                ),
            )
            connection.execute(
                "UPDATE host_models SET preferred_release_id=? WHERE model_id=?",
                (release_id, model_id),
            )

        references: dict[str, dict[str, Any]] = {}
        pending_links: list[tuple[str, str, str, str, str, str]] = []
        identity_reference_ids: dict[str, list[str]] = {}
        for internal_id in sorted(keys[0], key=lambda item: int(freeze[item]["ordinal"])):
            host_id = identity[internal_id]["host_id"]
            model_id = model_ids[internal_id]
            release_id = release_ids[internal_id]
            inventory = audit[internal_id]
            doi, pmid = parse_reference_id(inventory.get("publication_id"))
            primary_ref = add_reference(
                references, doi=doi, pmid=pmid,
                citation=inventory.get("publication_source"),
                url=inventory.get("publication_source_url"),
                role="MODEL_PRIMARY_PUBLICATION",
            )
            pending_links.append((stable_id("lnk", primary_ref, release_id, "MODEL_PRIMARY_PUBLICATION"), primary_ref, host_id, model_id, release_id, "MODEL_PRIMARY_PUBLICATION"))

            identity_reference_ids[internal_id] = []
            for evidence in identity[internal_id].get("identity_evidence", []):
                evidence_doi, evidence_pmid = parse_reference_id(evidence.get("id"))
                reference_id = add_reference(
                    references, doi=evidence_doi, pmid=evidence_pmid,
                    citation=evidence.get("type"), url=evidence.get("url"),
                    role="HOST_IDENTITY_EVIDENCE", note=evidence.get("note"),
                )
                identity_reference_ids[internal_id].append(reference_id)
                pending_links.append((stable_id("lnk", reference_id, host_id, evidence.get("type")), reference_id, host_id, model_id, release_id, evidence.get("type", "HOST_IDENTITY_EVIDENCE")))

            manifest = json.loads((ROOT / medium[internal_id]["manifest_path"]).read_text(encoding="utf-8"))
            for evidence in manifest.get("source_evidence", []):
                evidence_doi = evidence.get("doi")
                evidence_pmid = evidence.get("pmid")
                url = evidence.get("url") or evidence.get("archive")
                if not (evidence_doi or evidence_pmid or url):
                    continue
                reference_id = add_reference(
                    references, doi=evidence_doi, pmid=evidence_pmid,
                    citation=evidence.get("citation"), url=url,
                    role="MEDIUM_EVIDENCE", note=evidence.get("supplement"),
                )
                pending_links.append((stable_id("lnk", reference_id, release_id, "MEDIUM_EVIDENCE"), reference_id, host_id, model_id, release_id, "MEDIUM_EVIDENCE"))

        connection.executemany(
            "INSERT INTO host_references(reference_id,doi,pmid,citation,url,reference_role,note) VALUES (:reference_id,:doi,:pmid,:citation,:url,:reference_role,:note)",
            [references[key] for key in sorted(references)],
        )
        connection.executemany(
            "INSERT OR IGNORE INTO host_reference_links(link_id,reference_id,host_id,model_id,release_id,link_role) VALUES (?,?,?,?,?,?)",
            pending_links,
        )

        for internal_id in sorted(keys[0], key=lambda item: int(freeze[item]["ordinal"])):
            ident = identity[internal_id]
            host_id = ident["host_id"]
            aliases: list[tuple[str, str, str | None]] = []
            for alias in ident.get("aliases", []):
                aliases.append((alias, "REGISTERED_ALIAS", None))
            if internal_id != host_id and internal_id not in {item[0] for item in aliases}:
                aliases.append((internal_id, "HISTORICAL_INTERNAL_HOST_ID", "Retained for QC/mapping artifact lookup only."))
            source_ref = identity_reference_ids[internal_id][0] if identity_reference_ids[internal_id] else None
            seen: set[str] = set()
            for alias, alias_type, note in aliases:
                normalized = alias.casefold()
                if normalized in seen or alias == host_id:
                    continue
                seen.add(normalized)
                connection.execute(
                    "INSERT INTO host_aliases(alias_id,host_id,alias,alias_type,source_reference_id,note) VALUES (?,?,?,?,?,?)",
                    (stable_id("als", host_id, alias), host_id, alias, alias_type, source_ref, note),
                )
            relation_refs = identity_reference_ids[internal_id]
            for index, relation in enumerate(ident.get("related_strains", [])):
                source_ref = relation_refs[min(index + 1, len(relation_refs) - 1)] if relation_refs else None
                connection.execute(
                    """INSERT INTO host_relationships(
                        relationship_id,host_id,related_scientific_name,related_strain,
                        relationship_type,source_reference_id,note
                    ) VALUES (?,?,?,?,?,?,?)""",
                    (
                        stable_id("relship", host_id, relation["strain"], relation["relation"]),
                        host_id, ident["scientific_name"], relation["strain"],
                        relation["relation"], source_ref, relation["note"],
                    ),
                )

            frozen = freeze[internal_id]
            license_name, redistribution, commercial, review_status = license_projection(
                frozen["license_status"], frozen["license_evidence"]
            )
            connection.execute(
                """INSERT INTO host_licenses(
                    license_id,release_id,license_name,evidence_text,evidence_url,
                    evidence_sha256,redistribution_allowed,commercial_use_allowed,
                    commercial_use_status,review_status
                ) VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (
                    stable_id("lic", release_ids[internal_id]), release_ids[internal_id],
                    license_name, frozen["license_evidence"], frozen["license_url"] or None,
                    None, redistribution, commercial,
                    "PERMITTED_BY_RECORDED_EVIDENCE" if commercial == 1 else (
                        "NOT_PERMITTED_WITHOUT_ADDITIONAL_PERMISSION" if commercial == 0 else "UNCONFIRMED"
                    ),
                    review_status,
                ),
            )

        run_specs = {
            "structural": ("STRUCTURAL_QC", "host_model_qc_202609.json", qc_payload.get("environment", {}), qc_payload.get("metric_definitions", {})),
            "memote": ("MEMOTE_QC", "host_model_memote_202609.json", {"environment_ref": memote_payload.get("environment_ref")}, memote_payload.get("memote_deviation", "")),
            "medium": ("MEDIUM_VALIDATION", "host_medium_validation_202609.json", medium_payload.get("environment", {}), {"growth_epsilon": medium_payload.get("growth_epsilon")}),
            "condition": ("CONDITION_CONSISTENCY", "host_condition_qc_202609.json", condition_payload.get("environment", {}), condition_payload.get("execution_policy", "")),
            "comparison": ("COMPARISON_DECISION", "host_model_comparison_status_202609.json", {}, comparison_payload.get("status_policy", {})),
        }
        run_ids: dict[str, str] = {}
        for key, (qc_type, source_path, environment, method_note) in run_specs.items():
            run_id = stable_id("run", qc_type, source_hashes[source_path])
            run_ids[key] = run_id
            connection.execute(
                "INSERT INTO qc_runs(qc_run_id,qc_type,source_path,source_sha256,environment_json,method_note,run_date) VALUES (?,?,?,?,?,?,?)",
                (
                    run_id, qc_type, source_path, source_hashes[source_path],
                    json.dumps(environment, ensure_ascii=False, sort_keys=True),
                    json.dumps(method_note, ensure_ascii=False, sort_keys=True) if not isinstance(method_note, str) else method_note,
                    "2026-09-15",
                ),
            )

        structural_numeric = [
            "reactions", "metabolites", "genes", "compartments", "boundary_reactions",
            "formula_coverage", "charge_coverage", "mass_balance_eligible",
            "mass_unbalanced_reactions", "mass_balance_fraction", "blocked_reactions",
            "blocked_fraction", "dead_end_metabolites", "gpr_coverage",
            "reaction_annotation_coverage", "metabolite_annotation_coverage",
            "embedded_bounds_objective", "elapsed_seconds",
        ]
        structural_text = ["parse_status", "parsed_model_id", "objective_reactions", "objective_status", "embedded_bounds_growth_status", "qc_status", "error"]
        memote_numeric = ["total_score", "consistency_score", "annotation_met_score", "annotation_rxn_score", "annotation_gene_score", "annotation_sbo_score", "passed", "failed", "skipped", "errored", "elapsed_seconds"]
        for internal_id in sorted(keys[0], key=lambda item: int(freeze[item]["ordinal"])):
            release_id = release_ids[internal_id]
            for name in structural_numeric + structural_text:
                insert_qc_metric(
                    connection, release_id=release_id, run_id=run_ids["structural"],
                    metric_name=name, value=qc[internal_id].get(name),
                    status=qc[internal_id]["qc_status"], evidence_sha256=source_hashes["host_model_qc_202609.json"],
                )
            for name in memote_numeric + ["status", "report_sha256", "error"]:
                insert_qc_metric(
                    connection, release_id=release_id, run_id=run_ids["memote"],
                    metric_name=f"memote_{name}", value=memote[internal_id].get(name),
                    status=memote[internal_id]["status"], method="MEMOTE_0.17.0_FROZEN_DEVIATION",
                    evidence_sha256=source_hashes["host_model_memote_202609.json"],
                )
            med = medium[internal_id]
            insert_qc_metric(
                connection, release_id=release_id, run_id=run_ids["medium"],
                metric_name="declared_medium_status", value=med["declared_medium_status"],
                status=med["declared_medium_status"], method=med["medium_evidence_class"],
                evidence_sha256=source_hashes["host_medium_validation_202609.json"], details={"validation_claim": med["validation_claim"], "controls": med["controls"], "caveats": med["caveats"]},
            )
            insert_qc_metric(
                connection, release_id=release_id, run_id=run_ids["medium"],
                metric_name="declared_medium_objective", value=med["base_condition"]["objective_value"],
                status=med["declared_medium_status"], unit="model objective flux",
                evidence_sha256=source_hashes["host_medium_validation_202609.json"],
            )
            cond = condition[internal_id]
            for name in ("base_objective_value", "condition_blocked_reactions", "condition_blocked_fraction", "condition_dead_end_metabolites", "elapsed_seconds"):
                insert_qc_metric(
                    connection, release_id=release_id, run_id=run_ids["condition"],
                    metric_name=f"condition_{name}", value=cond.get(name),
                    status=cond["condition_consistency_status"], method=cond["condition_consistency_method"],
                    evidence_sha256=source_hashes["host_condition_qc_202609.json"],
                )
            insert_qc_metric(
                connection, release_id=release_id, run_id=run_ids["condition"],
                metric_name="condition_consistency_status", value=cond["condition_consistency_status"],
                status=cond["condition_consistency_status"], method=cond["condition_consistency_method"],
                evidence_sha256=source_hashes["host_condition_qc_202609.json"], details={"error": cond["error"], "blocked_reaction_ids_sha256": cond["blocked_reaction_ids_sha256"]},
            )
            comp = comparison[internal_id]
            for name in ("exact_model_reactions", "statistics_eligible", "memote_score"):
                insert_qc_metric(
                    connection, release_id=release_id, run_id=run_ids["comparison"],
                    metric_name=f"comparison_{name}", value=comp.get(name),
                    status=comp["qc_verdict"], evidence_sha256=source_hashes["host_model_comparison_status_202609.json"],
                )
            for name in ("qc_verdict", "comparison_status", "mapping_status", "quality_warnings", "fatal_gates"):
                insert_qc_metric(
                    connection, release_id=release_id, run_id=run_ids["comparison"],
                    metric_name=f"comparison_{name}", value=comp.get(name),
                    status=comp["qc_verdict"], evidence_sha256=source_hashes["host_model_comparison_status_202609.json"],
                )

        connection.commit()
        foreign_key_errors = [dict(row) for row in connection.execute("PRAGMA foreign_key_check")]
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        counts = {
            name: connection.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
            for name in (
                "curated_hosts", "host_models", "host_model_releases", "host_model_qc",
                "host_aliases", "host_relationships", "host_references", "host_reference_links",
                "host_licenses", "qc_runs", "registry_build_sources",
                "mapping_policy_versions", "reaction_registry_snapshot",
                "reaction_host_mapping", "reaction_host_mapping_candidates",
            )
        }
        checks = {
            "integrity_ok": integrity == "ok",
            "foreign_keys_ok": not foreign_key_errors,
            "thirty_unique_hosts": counts["curated_hosts"] == 30,
            "one_selected_model_and_release_per_host": counts["host_models"] == 30 and counts["host_model_releases"] == 30,
            "twenty_nine_statistics_eligible": connection.execute("SELECT COUNT(*) FROM curated_hosts WHERE statistics_eligible=1").fetchone()[0] == 29,
            "iwx1009_limited": connection.execute("SELECT curation_status FROM curated_hosts WHERE host_id='blicheniformis_wx02'").fetchone()[0] == "LIMITED_CANDIDATE",
            "aniger_canonical_only": connection.execute("SELECT COUNT(*) FROM curated_hosts WHERE host_id='aniger_atcc1015'").fetchone()[0] == 1 and connection.execute("SELECT COUNT(*) FROM curated_hosts WHERE host_id='aniger_consensus'").fetchone()[0] == 0,
            "aniger_legacy_alias_resolves": connection.execute("SELECT COUNT(*) FROM host_aliases WHERE host_id='aniger_atcc1015' AND alias='aniger_consensus'").fetchone()[0] == 1,
            "kphaffii_x33_canonical": connection.execute("SELECT COUNT(*) FROM curated_hosts WHERE host_id='kphaffii_x33' AND strain='X-33'").fetchone()[0] == 1,
            "gs115_not_alias": connection.execute("SELECT COUNT(*) FROM host_aliases WHERE lower(alias)='gs115'").fetchone()[0] == 0,
            "gs115_relationship_recorded": connection.execute("SELECT COUNT(*) FROM host_relationships WHERE host_id='kphaffii_x33' AND related_strain='GS115' AND relationship_type='PARENT_OF_X33_NOT_ALIAS'").fetchone()[0] == 1,
            "no_preliminary_import": connection.execute("SELECT COUNT(*) FROM curated_hosts WHERE preliminary_migration_status<>'NOT_IMPORTED'").fetchone()[0] == 0,
            "all_releases_have_license_record": counts["host_licenses"] == 30,
            "all_releases_have_qc": connection.execute("SELECT COUNT(DISTINCT release_id) FROM host_model_qc").fetchone()[0] == 30,
            "mapping_policy_frozen_once": counts["mapping_policy_versions"] == 1,
            "reaction_snapshot_complete": counts["reaction_registry_snapshot"] == 19623,
            "no_reo_association_ids_in_reaction_snapshot": connection.execute("SELECT COUNT(*) FROM reaction_registry_snapshot WHERE substr(reaction_id,1,3)='REO'").fetchone()[0] == 0,
            "mapping_tables_empty_before_step3": counts["reaction_host_mapping"] == 0 and counts["reaction_host_mapping_candidates"] == 0,
        }
        if not all(checks.values()):
            raise RuntimeError(f"staging registry validation failed: {checks}; fk={foreign_key_errors}")
        connection.execute("VACUUM")
        return {"counts": counts, "checks": checks, "integrity_check": integrity, "foreign_key_errors": foreign_key_errors}
    finally:
        connection.close()


def main() -> None:
    production_before = release_database_hashes()
    STAGING_ROOT.mkdir(parents=True, exist_ok=True)
    resolved_root = STAGING_ROOT.resolve()
    if DB_PATH.resolve().parent != resolved_root:
        raise RuntimeError("staging database target escaped the intended staging directory")
    temp_path = STAGING_ROOT / "host_context_v1_staging.building.sqlite"
    if temp_path.exists():
        temp_path.unlink()
    try:
        validation = build_database(temp_path)
        os.replace(temp_path, DB_PATH)
    finally:
        if temp_path.exists():
            temp_path.unlink()
    production_after = release_database_hashes()
    if production_before != production_after:
        raise RuntimeError("release/Preliminary database SHA changed while building staging registry")

    preliminary_paths = [
        "web_release/host_context_chassis.sqlite",
        "web_release/host_pathway_coverage_analysis.sqlite",
    ]
    result = {
        "schema_version": "reactenzdb-host-context-v1-staging-build-v1",
        "as_of_date": "2026-09-15",
        "release_target": "2026.09.1",
        "database_path": str(DB_PATH.relative_to(ROOT)).replace("\\", "/"),
        "database_sha256": sha256(DB_PATH),
        "database_size_bytes": DB_PATH.stat().st_size,
        "database_writes": "STAGING_DATABASE_ONLY",
        "production_database_writes": "NONE",
        "preliminary_data_imported": False,
        "validation": validation,
        "release_database_integrity": {
            "files_checked": len(production_before),
            "unchanged": True,
            "sha256_before": production_before,
            "sha256_after": production_after,
        },
        "preliminary_database_integrity": {
            path: {"unchanged": production_before.get(path) == production_after.get(path), "sha256": production_after.get(path)}
            for path in preliminary_paths
        },
    }
    REPORT_JSON.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    counts = validation["counts"]
    REPORT_MD.write_text(f"""# Host registry build report

Database: `{result['database_path']}`

## Build summary

- The registry separates host, model and release identifiers.
- Table counts: `{json.dumps(counts, sort_keys=True)}`.
- SQLite integrity and foreign-key checks are included in the validation results.
- Existing release databases were checked for changes before and after this build.

## Identity and schema

- `aniger_atcc1015` is the canonical host; `aniger_consensus` is an alias.
- `kphaffii_x33` is the canonical host context. GS115 is a related parent strain, not an alias.
- The scope of iMT1026v3 remains species-consensus rather than an X-33-specific model.
- Registry tables describe host identity, model releases, QC, aliases, relationships, references and license records.

## Mapping requirements

Mappings use `reaction_id`, `release_id` and `policy_id`. Association-level `reo_id` values are not reaction keys.
Supported core states are `EXACT_NATIVE`, `DIRECTIONAL_NATIVE`, `CONTEXT_ONLY`, `NOT_MAPPED` and `UNRESOLVED`.
Comparison eligibility follows the recorded QC decisions and does not establish experimental suitability or licensing clearance.

## Release scope

This build creates staging data. Production use requires the corresponding data review and release decision.
Per-release licensing records remain applicable.

## Command

```bash
python scripts/build_host_registry_staging.py
```
""", encoding="utf-8")
    print(json.dumps({
        "database": result["database_path"],
        "sha256": result["database_sha256"],
        "counts": counts,
        "checks_passed": sum(validation["checks"].values()),
        "checks_total": len(validation["checks"]),
        "production_databases_unchanged": True,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
