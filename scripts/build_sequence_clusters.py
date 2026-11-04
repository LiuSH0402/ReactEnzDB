#!/usr/bin/env python3
"""Build the ReactEnzDB non-redundant enzyme sequence-family layer.

The core ReactEnzDB release is never modified. This script exports a frozen FASTA,
runs independent NR90/NR70/NR50 MMseqs2 clusterings (NR100 is exact sequence
identity), enriches clusters with evidence and taxonomy, and writes a standalone
SQLite database plus compressed TSV exports and a reproducibility summary.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import re
import shutil
import sqlite3
import statistics
import subprocess
import tarfile
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]
RELEASE = ROOT / "web_release"
CORE_DB = RELEASE / "reactenzdb_web.db"
WORK = RELEASE / "sequence_clusters_work"
OUTPUT_DB = RELEASE / "enzyme_sequence_clusters.sqlite"
SUMMARY_JSON = RELEASE / "enzyme_sequence_clusters.summary.json"
README_MD = RELEASE / "ENZYME_SEQUENCE_CLUSTERS.md"
DOWNLOADS = RELEASE / "downloads"
MMSEQS_WINDOWS = ROOT / "external" / "mmseqs2" / "bin" / "mmseqs"
TAXDUMP = ROOT / "external" / "ncbi_taxonomy" / "taxdump.tar.gz"
THRESHOLDS = (100, 90, 70, 50)
VALID_AA = set("ACDEFGHIKLMNPQRSTVWYBXZJUO")


@dataclass(frozen=True)
class EnzymeRecord:
    biopart_id: str
    reactenz_enzyme_id: str
    sequence_key: str
    sequence: str
    sequence_length: int
    sequence_status: str
    organism: str | None
    taxonomy_id: str | None
    uniprot_accession: str | None
    evidence_score: int
    publication_pmids: int
    kinetic_pmids: int
    kinetic_count: int
    exact_external_kinetics: int
    pdb_count: int
    alphafold_count: int
    active_site_count: int
    binding_site_count: int
    conserved_site_count: int
    mcsa_count: int
    structure_confidence_score: int

    @property
    def experimental_support(self) -> int:
        return int(
            self.publication_pmids > 0
            or self.kinetic_pmids > 0
            or self.exact_external_kinetics > 0
        )

    @property
    def feature_site_count(self) -> int:
        return self.active_site_count + self.binding_site_count + self.conserved_site_count


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sequence_status(sequence: str) -> str:
    if not sequence:
        return "missing"
    if any(char not in VALID_AA for char in sequence):
        return "invalid_sequence"
    if len(sequence) < 50:
        return "possible_fragment"
    if len(sequence) > 5000:
        return "length_outlier"
    return "valid_full_length"


def sequence_key(sequence: str) -> str:
    return "SEQ_" + hashlib.sha256(sequence.encode("ascii")).hexdigest()[:24]


def query_map(conn: sqlite3.Connection, sql: str, key_index: int = 0) -> dict[str, sqlite3.Row]:
    return {str(row[key_index]): row for row in conn.execute(sql)}


def load_records(conn: sqlite3.Connection) -> list[EnzymeRecord]:
    conn.row_factory = sqlite3.Row
    evidence = query_map(
        conn,
        """
        SELECT entity_id,
               MAX(evidence_score) AS evidence_score,
               MAX(publication_pmids) AS publication_pmids,
               MAX(kinetic_pmids) AS kinetic_pmids
        FROM web_evidence_scores
        WHERE lower(entity_type) = 'enzyme'
        GROUP BY entity_id
        """,
    )
    kinetics = query_map(
        conn,
        """
        SELECT biopart_id,
               COUNT(*) AS kinetic_count,
               SUM(CASE WHEN pmids_json IS NOT NULL AND trim(pmids_json) NOT IN ('', '[]', '{}') THEN 1 ELSE 0 END) AS kinetic_pmids
        FROM web_kinetics
        WHERE biopart_id IS NOT NULL
        GROUP BY biopart_id
        """,
    )
    exact_checks = query_map(
        conn,
        """
        SELECT k.biopart_id, COUNT(DISTINCT c.check_id) AS exact_count
        FROM web_kinetics k
        JOIN web_kinetic_external_checks c ON c.kinetic_id = k.kinetic_id
        WHERE k.biopart_id IS NOT NULL AND lower(c.match_status) LIKE '%exact%'
        GROUP BY k.biopart_id
        """,
    )
    structures = query_map(
        conn,
        """
        SELECT biopart_id,
               MAX(pdb_structure_count) AS pdb_count,
               MAX(alphafold_model_count) AS alphafold_count,
               MAX(active_site_count) AS active_site_count,
               MAX(binding_site_count) AS binding_site_count,
               MAX(conserved_site_count) AS conserved_site_count,
               MAX(mcsa_entry_count) AS mcsa_count,
               MAX(structure_confidence_score) AS structure_confidence_score
        FROM web_structure_confidence
        GROUP BY biopart_id
        """,
    )
    uniprot = query_map(
        conn,
        """
        SELECT biopart_id, MIN(uniprot_accession) AS uniprot_accession
        FROM web_enzyme_uniprot
        WHERE uniprot_accession IS NOT NULL AND trim(uniprot_accession) <> ''
        GROUP BY biopart_id
        """,
    )
    rows = conn.execute(
        """
        SELECT e.biopart_id, eid.reactenz_enzyme_id, e.protein_sequence,
               e.organism, e.taxonomy_id
        FROM web_enzymes e
        JOIN web_enzyme_ids eid ON eid.biopart_id = e.biopart_id
        ORDER BY eid.reactenz_enzyme_id
        """
    ).fetchall()
    records: list[EnzymeRecord] = []
    for row in rows:
        sequence = re.sub(r"\s+", "", row["protein_sequence"] or "").upper()
        if not sequence:
            continue
        ev = evidence.get(str(row["biopart_id"]))
        kin = kinetics.get(str(row["biopart_id"]))
        checks = exact_checks.get(str(row["biopart_id"]))
        stru = structures.get(str(row["biopart_id"]))
        uni = uniprot.get(str(row["biopart_id"]))
        records.append(
            EnzymeRecord(
                biopart_id=str(row["biopart_id"]),
                reactenz_enzyme_id=str(row["reactenz_enzyme_id"]),
                sequence_key=sequence_key(sequence),
                sequence=sequence,
                sequence_length=len(sequence),
                sequence_status=sequence_status(sequence),
                organism=row["organism"],
                taxonomy_id=str(row["taxonomy_id"]) if row["taxonomy_id"] is not None else None,
                uniprot_accession=uni["uniprot_accession"] if uni else None,
                evidence_score=int(ev["evidence_score"] or 0) if ev else 0,
                publication_pmids=int(ev["publication_pmids"] or 0) if ev else 0,
                kinetic_pmids=max(
                    int(ev["kinetic_pmids"] or 0) if ev else 0,
                    int(kin["kinetic_pmids"] or 0) if kin else 0,
                ),
                kinetic_count=int(kin["kinetic_count"] or 0) if kin else 0,
                exact_external_kinetics=int(checks["exact_count"] or 0) if checks else 0,
                pdb_count=int(stru["pdb_count"] or 0) if stru else 0,
                alphafold_count=int(stru["alphafold_count"] or 0) if stru else 0,
                active_site_count=int(stru["active_site_count"] or 0) if stru else 0,
                binding_site_count=int(stru["binding_site_count"] or 0) if stru else 0,
                conserved_site_count=int(stru["conserved_site_count"] or 0) if stru else 0,
                mcsa_count=int(stru["mcsa_count"] or 0) if stru else 0,
                structure_confidence_score=int(stru["structure_confidence_score"] or 0) if stru else 0,
            )
        )
    return records


def write_fasta(records: list[EnzymeRecord]) -> tuple[Path, dict[str, str]]:
    WORK.mkdir(parents=True, exist_ok=True)
    unique: dict[str, str] = {}
    for record in records:
        if record.sequence_status in {"valid_full_length", "possible_fragment", "length_outlier"}:
            unique.setdefault(record.sequence_key, record.sequence)
    fasta = WORK / "unique_sequences.fasta"
    with fasta.open("w", encoding="ascii", newline="\n") as handle:
        for key in sorted(unique):
            handle.write(f">{key}\n")
            sequence = unique[key]
            for start in range(0, len(sequence), 80):
                handle.write(sequence[start : start + 80] + "\n")
    return fasta, unique


def write_input_manifest(records: list[EnzymeRecord], unique: dict[str, str]) -> dict[str, object]:
    lengths = sorted(len(sequence) for sequence in unique.values())
    record_counts = Counter(record.sequence_key for record in records)
    audit = {
        "generated_at_utc": utc_now(),
        "core_database": str(CORE_DB),
        "enzyme_records_with_sequence": len(records),
        "unique_sequences": len(unique),
        "duplicate_sequence_groups": sum(count > 1 for count in record_counts.values()),
        "enzyme_records_in_duplicate_groups": sum(count for count in record_counts.values() if count > 1),
        "sequence_status": dict(Counter(record.sequence_status for record in records)),
        "taxonomy_id_available": sum(bool(record.taxonomy_id) for record in records),
        "experimental_support_available": sum(record.experimental_support for record in records),
        "kinetic_support_available": sum(record.kinetic_count > 0 for record in records),
        "pdb_available": sum(record.pdb_count > 0 for record in records),
        "alphafold_available": sum(record.alphafold_count > 0 for record in records),
        "active_or_functional_site_available": sum(record.feature_site_count > 0 for record in records),
        "length": {
            "min": lengths[0],
            "p01": lengths[int(len(lengths) * 0.01)],
            "median": statistics.median(lengths),
            "p99": lengths[min(len(lengths) - 1, int(len(lengths) * 0.99))],
            "max": lengths[-1],
        },
    }
    (WORK / "input_audit.json").write_text(json.dumps(audit, indent=2), encoding="utf-8")
    return audit


def windows_to_wsl(path: Path) -> str:
    resolved = path.resolve()
    drive = resolved.drive.rstrip(":").lower()
    relative = resolved.as_posix().split(":", 1)[-1].lstrip("/")
    return f"/mnt/host/{drive}/{relative}"


def mmseqs_version() -> str:
    result = subprocess.run(
        ["wsl", "-d", "docker-desktop", "--", windows_to_wsl(MMSEQS_WINDOWS), "version"],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return result.stdout.strip()


def run_mmseqs(fasta: Path, force: bool = False, threads: int = 20) -> dict[int, Path]:
    if not MMSEQS_WINDOWS.exists():
        raise FileNotFoundError(f"MMseqs2 not found at {MMSEQS_WINDOWS}")
    outputs: dict[int, Path] = {}
    for threshold in (90, 70, 50):
        stage = WORK / f"nr{threshold}"
        prefix = stage / f"nr{threshold}"
        cluster_tsv = Path(str(prefix) + "_cluster.tsv")
        outputs[threshold] = cluster_tsv
        if cluster_tsv.exists() and not force:
            continue
        if stage.exists():
            shutil.rmtree(stage)
        stage.mkdir(parents=True)
        tmp = stage / "tmp"
        command = [
            "wsl", "-d", "docker-desktop", "--", windows_to_wsl(MMSEQS_WINDOWS),
            "easy-cluster", windows_to_wsl(fasta), windows_to_wsl(prefix), windows_to_wsl(tmp),
            "--min-seq-id", str(threshold / 100),
            "-c", "0.8", "--cov-mode", "0", "--cluster-mode", "2",
            "--threads", str(threads),
        ]
        subprocess.run(command, check=True)
        if not cluster_tsv.exists():
            raise RuntimeError(f"MMseqs2 did not create {cluster_tsv}")
    return outputs


def deterministic_cluster_id(threshold: int, members: Iterable[str]) -> str:
    digest = hashlib.sha1("\n".join(sorted(members)).encode("ascii")).hexdigest()[:14]
    return f"NR{threshold}_{digest}"


def load_clusters(unique_keys: set[str], mmseqs_outputs: dict[int, Path]) -> dict[int, dict[str, str]]:
    mappings: dict[int, dict[str, str]] = {
        100: {key: f"NR100_{key.removeprefix('SEQ_')[:14]}" for key in unique_keys}
    }
    for threshold, path in mmseqs_outputs.items():
        groups: dict[str, list[str]] = defaultdict(list)
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                representative, member = line.rstrip("\n").split("\t")[:2]
                groups[representative].append(member)
        mapping: dict[str, str] = {}
        for members in groups.values():
            cluster_id = deterministic_cluster_id(threshold, members)
            for member in members:
                if member in mapping:
                    raise RuntimeError(f"{member} assigned twice at NR{threshold}")
                mapping[member] = cluster_id
        missing = unique_keys - set(mapping)
        if missing:
            raise RuntimeError(f"NR{threshold} is missing {len(missing)} unique sequences")
        mappings[threshold] = mapping
    return mappings


def parse_taxonomy(taxids: set[str]) -> tuple[dict[str, dict[str, str | None]], dict[str, object]]:
    if not TAXDUMP.exists():
        return {}, {"status": "not_available", "file": str(TAXDUMP)}
    parent: dict[str, str] = {}
    rank: dict[str, str] = {}
    names: dict[str, str] = {}
    merged: dict[str, str] = {}
    archive_hash = hashlib.sha256(TAXDUMP.read_bytes()).hexdigest()
    with tarfile.open(TAXDUMP, "r:gz") as archive:
        nodes = archive.extractfile("nodes.dmp")
        scientific = archive.extractfile("names.dmp")
        merged_file = archive.extractfile("merged.dmp")
        if nodes:
            for raw in nodes:
                fields = raw.decode("utf-8", "replace").split("\t|\t")
                parent[fields[0].strip()] = fields[1].strip()
                rank[fields[0].strip()] = fields[2].strip()
        if scientific:
            for raw in scientific:
                fields = raw.decode("utf-8", "replace").split("\t|\t")
                if len(fields) >= 4 and fields[3].replace("\t|\n", "").strip() == "scientific name":
                    names[fields[0].strip()] = fields[1].strip()
        if merged_file:
            for raw in merged_file:
                fields = raw.decode("utf-8", "replace").split("\t|\t")
                merged[fields[0].strip()] = fields[1].replace("\t|\n", "").strip()
    output: dict[str, dict[str, str | None]] = {}
    unresolved = 0
    for original in taxids:
        taxid = re.sub(r"\D", "", original or "")
        taxid = merged.get(taxid, taxid)
        if not taxid or taxid not in parent:
            unresolved += 1
            continue
        lineage: dict[str, str | None] = {"species": None, "genus": None, "family": None, "order": None, "class": None, "phylum": None, "superkingdom": None}
        current = taxid
        seen: set[str] = set()
        while current and current not in seen:
            seen.add(current)
            current_rank = rank.get(current)
            if current_rank in lineage and lineage[current_rank] is None:
                lineage[current_rank] = names.get(current)
            next_id = parent.get(current)
            if not next_id or next_id == current:
                break
            current = next_id
        output[original] = lineage
    return output, {
        "status": "loaded",
        "file": str(TAXDUMP),
        "sha256": archive_hash,
        "requested_taxonomy_ids": len(taxids),
        "resolved_taxonomy_ids": len(output),
        "unresolved_taxonomy_ids": unresolved,
    }


def representative_score(record: EnzymeRecord, median_length: float) -> float:
    length_penalty = abs(record.sequence_length - median_length) / max(median_length, 1)
    return (
        record.experimental_support * 1000
        + min(record.publication_pmids, 20) * 20
        + min(record.kinetic_pmids, 20) * 25
        + min(record.exact_external_kinetics, 10) * 30
        + int(record.pdb_count > 0) * 80
        + int(record.alphafold_count > 0) * 20
        + int(record.active_site_count > 0) * 50
        + int(record.mcsa_count > 0) * 60
        + int(record.uniprot_accession is not None) * 20
        + record.evidence_score
        + int(record.sequence_status == "valid_full_length") * 30
        - length_penalty * 10
    )


def choose_representative(records: list[EnzymeRecord]) -> tuple[EnzymeRecord, float]:
    median_length = statistics.median(record.sequence_length for record in records)
    ranked = sorted(
        ((representative_score(record, median_length), record) for record in records),
        key=lambda item: (-item[0], item[1].reactenz_enzyme_id),
    )
    score, record = ranked[0]
    return record, round(score, 3)


def shannon(values: Iterable[str | None]) -> float:
    counts = Counter(value for value in values if value)
    total = sum(counts.values())
    if total <= 1:
        return 0.0
    import math
    return round(-sum((count / total) * math.log(count / total) for count in counts.values()), 6)


def create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=NORMAL;
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE sequence_cluster_runs (
          threshold INTEGER PRIMARY KEY, min_sequence_identity REAL NOT NULL,
          min_bidirectional_coverage REAL NOT NULL, clustering_tool TEXT NOT NULL,
          clustering_mode TEXT NOT NULL, generated_at_utc TEXT NOT NULL
        );
        CREATE TABLE enzyme_sequence_records (
          biopart_id TEXT PRIMARY KEY, reactenz_enzyme_id TEXT NOT NULL,
          sequence_key TEXT NOT NULL, sequence_length INTEGER NOT NULL,
          sequence_status TEXT NOT NULL, organism TEXT, taxonomy_id TEXT,
          species TEXT, genus TEXT, family TEXT, taxonomic_order TEXT, class_name TEXT, phylum TEXT, superkingdom TEXT,
          uniprot_accession TEXT, evidence_score INTEGER NOT NULL,
          experimental_support INTEGER NOT NULL, publication_pmids INTEGER NOT NULL,
          kinetic_pmids INTEGER NOT NULL, kinetic_count INTEGER NOT NULL,
          exact_external_kinetics INTEGER NOT NULL, pdb_count INTEGER NOT NULL,
          alphafold_count INTEGER NOT NULL, active_site_count INTEGER NOT NULL,
          binding_site_count INTEGER NOT NULL, conserved_site_count INTEGER NOT NULL,
          mcsa_count INTEGER NOT NULL, structure_confidence_score INTEGER NOT NULL
        );
        CREATE INDEX idx_sequence_records_key ON enzyme_sequence_records(sequence_key);
        CREATE INDEX idx_sequence_records_enzyme ON enzyme_sequence_records(reactenz_enzyme_id);
        CREATE TABLE sequence_clusters (
          threshold INTEGER NOT NULL, cluster_id TEXT NOT NULL,
          unique_sequence_count INTEGER NOT NULL, enzyme_record_count INTEGER NOT NULL,
          species_count INTEGER NOT NULL, genus_count INTEGER NOT NULL,
          family_count INTEGER NOT NULL, phylum_count INTEGER NOT NULL,
          taxonomy_shannon REAL NOT NULL, experimental_supported_count INTEGER NOT NULL,
          kinetic_supported_count INTEGER NOT NULL, pdb_supported_count INTEGER NOT NULL,
          alphafold_supported_count INTEGER NOT NULL, active_site_supported_count INTEGER NOT NULL,
          mcsa_supported_count INTEGER NOT NULL, global_representative_biopart_id TEXT NOT NULL,
          global_representative_enzyme_id TEXT NOT NULL, representative_score REAL NOT NULL,
          underexplored INTEGER NOT NULL, PRIMARY KEY(threshold, cluster_id)
        );
        CREATE TABLE sequence_cluster_members (
          threshold INTEGER NOT NULL, cluster_id TEXT NOT NULL, sequence_key TEXT NOT NULL,
          biopart_id TEXT NOT NULL, reactenz_enzyme_id TEXT NOT NULL,
          is_global_representative INTEGER NOT NULL,
          PRIMARY KEY(threshold, biopart_id)
        );
        CREATE INDEX idx_cluster_members_cluster ON sequence_cluster_members(threshold, cluster_id);
        CREATE TABLE reaction_cluster_members (
          threshold INTEGER NOT NULL, reaction_id TEXT NOT NULL, reactenz_reaction_id TEXT NOT NULL,
          cluster_id TEXT NOT NULL, biopart_id TEXT NOT NULL, reactenz_enzyme_id TEXT NOT NULL,
          reaction_kinetic_count INTEGER NOT NULL, reaction_kinetic_pmid_count INTEGER NOT NULL,
          reaction_exact_external_count INTEGER NOT NULL,
          PRIMARY KEY(threshold, reaction_id, biopart_id)
        );
        CREATE INDEX idx_reaction_cluster_members_reaction ON reaction_cluster_members(threshold, reaction_id);
        CREATE INDEX idx_reaction_cluster_members_cluster ON reaction_cluster_members(threshold, reaction_id, cluster_id);
        CREATE TABLE reaction_sequence_clusters (
          threshold INTEGER NOT NULL, reaction_id TEXT NOT NULL, reactenz_reaction_id TEXT NOT NULL,
          cluster_id TEXT NOT NULL, member_enzyme_count INTEGER NOT NULL,
          unique_sequence_count INTEGER NOT NULL, species_count INTEGER NOT NULL,
          genus_count INTEGER NOT NULL, phylum_count INTEGER NOT NULL,
          taxonomy_shannon REAL NOT NULL, experimental_supported_count INTEGER NOT NULL,
          kinetic_supported_count INTEGER NOT NULL, pdb_supported_count INTEGER NOT NULL,
          alphafold_supported_count INTEGER NOT NULL, active_site_supported_count INTEGER NOT NULL,
          representative_biopart_id TEXT NOT NULL, representative_enzyme_id TEXT NOT NULL,
          representative_score REAL NOT NULL, underexplored INTEGER NOT NULL,
          PRIMARY KEY(threshold, reaction_id, cluster_id)
        );
        CREATE INDEX idx_reaction_clusters_reaction ON reaction_sequence_clusters(threshold, reaction_id);
        """
    )


def build_database(records: list[EnzymeRecord], mappings: dict[int, dict[str, str]], audit: dict[str, object], mmseqs_ver: str) -> dict[str, object]:
    taxonomy, taxonomy_meta = parse_taxonomy({record.taxonomy_id for record in records if record.taxonomy_id})
    record_by_id = {record.biopart_id: record for record in records}
    records_by_sequence: dict[str, list[EnzymeRecord]] = defaultdict(list)
    for record in records:
        records_by_sequence[record.sequence_key].append(record)
    if OUTPUT_DB.exists():
        OUTPUT_DB.unlink()
    conn = sqlite3.connect(OUTPUT_DB)
    # Reaction-level enrichment is read from the immutable core release.  Only
    # derived cluster tables are written to OUTPUT_DB.
    attach_core(conn)
    create_schema(conn)
    conn.executemany(
        "INSERT INTO metadata VALUES (?, ?)",
        [
            ("release", "ReactEnzDB enzyme sequence clusters 2026.08"),
            ("generated_at_utc", utc_now()),
            ("core_database", CORE_DB.name),
            ("mmseqs_version", mmseqs_ver),
            ("clustering_note", "NR100 exact identity; NR90/70/50 are independent MMseqs2 views with 80% bidirectional coverage."),
            ("functional_boundary", "Sequence similarity does not prove identical substrate specificity or catalytic activity."),
            ("experimental_support_definition", "PMID-backed enzyme evidence, PMID-backed kinetics, or exact external kinetic confirmation."),
            ("taxonomy_source", json.dumps(taxonomy_meta, ensure_ascii=False)),
        ],
    )
    now = utc_now()
    conn.executemany(
        "INSERT INTO sequence_cluster_runs VALUES (?, ?, 0.8, ?, ?, ?)",
        [(threshold, threshold / 100, "MMseqs2" if threshold < 100 else "SHA256 exact identity", "independent greedy length clustering" if threshold < 100 else "exact sequence hash", now) for threshold in THRESHOLDS],
    )
    record_rows = []
    for record in records:
        lineage = taxonomy.get(record.taxonomy_id or "", {})
        record_rows.append((
            record.biopart_id, record.reactenz_enzyme_id, record.sequence_key,
            record.sequence_length, record.sequence_status, record.organism, record.taxonomy_id,
            lineage.get("species"), lineage.get("genus"), lineage.get("family"), lineage.get("order"),
            lineage.get("class"), lineage.get("phylum"), lineage.get("superkingdom"),
            record.uniprot_accession, record.evidence_score, record.experimental_support,
            record.publication_pmids, record.kinetic_pmids, record.kinetic_count,
            record.exact_external_kinetics, record.pdb_count, record.alphafold_count,
            record.active_site_count, record.binding_site_count, record.conserved_site_count,
            record.mcsa_count, record.structure_confidence_score,
        ))
    conn.executemany("INSERT INTO enzyme_sequence_records VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", record_rows)

    cluster_summary: dict[str, object] = {}
    for threshold in THRESHOLDS:
        grouped: dict[str, list[EnzymeRecord]] = defaultdict(list)
        mapping = mappings[threshold]
        for record in records:
            if record.sequence_key in mapping:
                grouped[mapping[record.sequence_key]].append(record)
        cluster_rows = []
        member_rows = []
        cluster_sizes: list[int] = []
        for cluster_id, members in grouped.items():
            representative, rep_score = choose_representative(members)
            unique_sequence_count = len({member.sequence_key for member in members})
            cluster_sizes.append(len(members))
            species = [taxonomy.get(member.taxonomy_id or "", {}).get("species") or member.organism for member in members]
            genera = [taxonomy.get(member.taxonomy_id or "", {}).get("genus") for member in members]
            families = [taxonomy.get(member.taxonomy_id or "", {}).get("family") for member in members]
            phyla = [taxonomy.get(member.taxonomy_id or "", {}).get("phylum") for member in members]
            experimental = sum(member.experimental_support for member in members)
            underexplored = int(experimental == 0 and not any(member.kinetic_count or member.pdb_count or member.active_site_count for member in members))
            cluster_rows.append((
                threshold, cluster_id, unique_sequence_count, len(members), len({x for x in species if x}),
                len({x for x in genera if x}), len({x for x in families if x}), len({x for x in phyla if x}),
                shannon(species), experimental, sum(member.kinetic_count > 0 for member in members),
                sum(member.pdb_count > 0 for member in members), sum(member.alphafold_count > 0 for member in members),
                sum(member.feature_site_count > 0 for member in members), sum(member.mcsa_count > 0 for member in members),
                representative.biopart_id, representative.reactenz_enzyme_id, rep_score, underexplored,
            ))
            member_rows.extend((threshold, cluster_id, member.sequence_key, member.biopart_id, member.reactenz_enzyme_id, int(member.biopart_id == representative.biopart_id)) for member in members)
        conn.executemany("INSERT INTO sequence_clusters VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", cluster_rows)
        conn.executemany("INSERT INTO sequence_cluster_members VALUES (?,?,?,?,?,?)", member_rows)
        cluster_summary[f"NR{threshold}"] = {
            "clusters": len(grouped),
            "compression_vs_enzyme_records": round(1 - len(grouped) / max(len(records), 1), 6),
            "singletons": sum(size == 1 for size in cluster_sizes),
            "median_enzyme_records_per_cluster": statistics.median(cluster_sizes),
            "max_enzyme_records_per_cluster": max(cluster_sizes),
        }

    reaction_rows = conn.execute(
        """
        SELECT re.reaction_id, rid.reactenz_reaction_id, re.biopart_id,
               COALESCE(k.kinetic_count, 0), COALESCE(k.kinetic_pmid_count, 0),
               COALESCE(k.exact_external_count, 0)
        FROM main_core.web_reaction_enzymes re
        JOIN main_core.web_reaction_ids rid ON rid.reaction_id = re.reaction_id
        JOIN enzyme_sequence_records e ON e.biopart_id = re.biopart_id
        LEFT JOIN (
          SELECT wk.reaction_id, wk.biopart_id,
                 COUNT(*) AS kinetic_count,
                 SUM(CASE WHEN wk.pmids_json IS NOT NULL AND trim(wk.pmids_json) NOT IN ('', '[]', '{}') THEN 1 ELSE 0 END) AS kinetic_pmid_count,
                 COUNT(DISTINCT CASE WHEN lower(c.match_status) LIKE '%exact%' THEN c.check_id END) AS exact_external_count
          FROM main_core.web_kinetics wk
          LEFT JOIN main_core.web_kinetic_external_checks c ON c.kinetic_id = wk.kinetic_id
          GROUP BY wk.reaction_id, wk.biopart_id
        ) k ON k.reaction_id = re.reaction_id AND k.biopart_id = re.biopart_id
        """
    ).fetchall()
    # The attached database is used only during construction; output tables remain standalone.
    reaction_member_rows = []
    reaction_groups: dict[tuple[int, str, str, str], list[tuple[EnzymeRecord, int, int, int]]] = defaultdict(list)
    for reaction_id, reactenz_reaction_id, biopart_id, kinetic_count, kinetic_pmids, exact_count in reaction_rows:
        record = record_by_id[str(biopart_id)]
        for threshold in THRESHOLDS:
            cluster_id = mappings[threshold][record.sequence_key]
            reaction_member_rows.append((threshold, reaction_id, reactenz_reaction_id, cluster_id, biopart_id, record.reactenz_enzyme_id, kinetic_count, kinetic_pmids, exact_count))
            reaction_groups[(threshold, reaction_id, reactenz_reaction_id, cluster_id)].append((record, kinetic_count, kinetic_pmids, exact_count))
    conn.executemany("INSERT INTO reaction_cluster_members VALUES (?,?,?,?,?,?,?,?,?)", reaction_member_rows)

    reaction_cluster_rows = []
    per_reaction_counts: dict[int, Counter[str]] = {threshold: Counter() for threshold in THRESHOLDS}
    for (threshold, reaction_id, reactenz_reaction_id, cluster_id), member_data in reaction_groups.items():
        members = [item[0] for item in member_data]
        median_length = statistics.median(member.sequence_length for member in members)
        ranked = sorted(
            (
                (
                    int(kinetic_pmids > 0 or exact_count > 0) * 5000
                    + kinetic_pmids * 100 + exact_count * 150
                    + representative_score(record, median_length),
                    record,
                )
                for record, _, kinetic_pmids, exact_count in member_data
            ),
            key=lambda item: (-item[0], item[1].reactenz_enzyme_id),
        )
        rep_score, representative = ranked[0]
        species = [taxonomy.get(member.taxonomy_id or "", {}).get("species") or member.organism for member in members]
        genera = [taxonomy.get(member.taxonomy_id or "", {}).get("genus") for member in members]
        phyla = [taxonomy.get(member.taxonomy_id or "", {}).get("phylum") for member in members]
        experimental_count = sum(int(kinetic_pmids > 0 or exact_count > 0) for _, _, kinetic_pmids, exact_count in member_data)
        underexplored = int(experimental_count == 0 and not any(member.pdb_count or member.active_site_count for member in members))
        reaction_cluster_rows.append((
            threshold, reaction_id, reactenz_reaction_id, cluster_id, len(members),
            len({member.sequence_key for member in members}), len({x for x in species if x}),
            len({x for x in genera if x}), len({x for x in phyla if x}), shannon(species),
            experimental_count, sum(kinetic_count > 0 for _, kinetic_count, _, _ in member_data),
            sum(member.pdb_count > 0 for member in members), sum(member.alphafold_count > 0 for member in members),
            sum(member.feature_site_count > 0 for member in members), representative.biopart_id,
            representative.reactenz_enzyme_id, round(rep_score, 3), underexplored,
        ))
        per_reaction_counts[threshold][reaction_id] += 1
    conn.executemany("INSERT INTO reaction_sequence_clusters VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", reaction_cluster_rows)
    conn.commit()

    reaction_summary = {}
    for threshold, counts in per_reaction_counts.items():
        values = sorted(counts.values())
        reaction_summary[f"NR{threshold}"] = {
            "reactions": len(values),
            "reaction_cluster_rows": sum(values),
            "median_clusters_per_reaction": statistics.median(values),
            "p90_clusters_per_reaction": values[min(len(values) - 1, int(len(values) * 0.9))],
            "max_clusters_per_reaction": max(values),
        }
    qa = {
        "all_sequence_records_have_four_memberships": conn.execute("SELECT COUNT(*) FROM (SELECT biopart_id FROM sequence_cluster_members GROUP BY biopart_id HAVING COUNT(*) <> 4)").fetchone()[0] == 0,
        "all_reaction_members_have_four_memberships": conn.execute("SELECT COUNT(*) FROM (SELECT reaction_id, biopart_id FROM reaction_cluster_members GROUP BY reaction_id, biopart_id HAVING COUNT(*) <> 4)").fetchone()[0] == 0,
        "orphan_cluster_members": conn.execute("SELECT COUNT(*) FROM sequence_cluster_members m LEFT JOIN sequence_clusters c ON c.threshold=m.threshold AND c.cluster_id=m.cluster_id WHERE c.cluster_id IS NULL").fetchone()[0],
        "orphan_reaction_clusters": conn.execute("SELECT COUNT(*) FROM reaction_sequence_clusters r LEFT JOIN sequence_clusters c ON c.threshold=r.threshold AND c.cluster_id=r.cluster_id WHERE c.cluster_id IS NULL").fetchone()[0],
    }
    conn.close()
    return {"input_audit": audit, "taxonomy": taxonomy_meta, "cluster_summary": cluster_summary, "reaction_summary": reaction_summary, "qa": qa}


def attach_core(conn: sqlite3.Connection) -> None:
    conn.execute("ATTACH DATABASE ? AS main_core", (str(CORE_DB),))


def export_table(conn: sqlite3.Connection, table: str, filename: str) -> dict[str, object]:
    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    path = DOWNLOADS / filename
    cursor = conn.execute(f"SELECT * FROM {table}")
    columns = [item[0] for item in cursor.description]
    rows = 0
    with gzip.open(path, "wt", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
        writer.writerow(columns)
        for row in cursor:
            writer.writerow(row)
            rows += 1
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return {"file": f"downloads/{filename}", "table": table, "rows": rows, "columns": len(columns), "size": path.stat().st_size, "sha256": digest.hexdigest()}


def file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def export_representative_fasta(conn: sqlite3.Connection, threshold: int) -> dict[str, object]:
    filename = f"enzyme_representatives_nr{threshold}.fasta.gz"
    path = DOWNLOADS / filename
    rows = conn.execute(
        """
        SELECT c.cluster_id, c.global_representative_enzyme_id,
               c.global_representative_biopart_id, e.protein_sequence,
               c.enzyme_record_count, c.species_count,
               c.experimental_supported_count
        FROM sequence_clusters c
        JOIN main_core.web_enzymes e
          ON e.biopart_id = c.global_representative_biopart_id
        WHERE c.threshold = ?
        ORDER BY c.cluster_id
        """,
        (threshold,),
    )
    count = 0
    with gzip.open(path, "wt", encoding="utf-8", newline="\n") as handle:
        for cluster_id, enzyme_id, biopart_id, sequence, members, species, experimental in rows:
            if not sequence:
                continue
            handle.write(
                f">{enzyme_id} cluster={cluster_id} biopart={biopart_id} "
                f"members={members} species={species} experimental={experimental}\n"
            )
            sequence = str(sequence).strip().upper()
            handle.write("\n".join(sequence[index:index + 80] for index in range(0, len(sequence), 80)) + "\n")
            count += 1
    return {"file": f"downloads/{filename}", "format": "FASTA.GZ", "rows": count, "size": path.stat().st_size, "sha256": file_digest(path)}


def write_outputs(summary: dict[str, object], mmseqs_ver: str) -> dict[str, object]:
    conn = sqlite3.connect(OUTPUT_DB)
    attach_core(conn)
    files = [
        export_table(conn, "sequence_clusters", "enzyme_sequence_clusters.tsv.gz"),
        export_table(conn, "sequence_cluster_members", "enzyme_cluster_members.tsv.gz"),
        export_table(conn, "reaction_sequence_clusters", "reaction_enzyme_clusters.tsv.gz"),
        export_table(conn, "reaction_cluster_members", "reaction_cluster_members.tsv.gz"),
        export_table(conn, "enzyme_sequence_records", "enzyme_cluster_taxonomy.tsv.gz"),
    ]
    files.extend(export_representative_fasta(conn, threshold) for threshold in THRESHOLDS)
    conn.close()
    summary.update({
        "release": "ReactEnzDB enzyme sequence clusters 2026.08",
        "generated_at_utc": utc_now(),
        "core_database": CORE_DB.name,
        "output_database": OUTPUT_DB.name,
        "parameters": {"thresholds": list(THRESHOLDS), "min_bidirectional_coverage": 0.8, "views_are_independent": True},
        "mmseqs_version": mmseqs_ver,
        "files": files,
        "notes": [
            "NR100 is exact sequence identity; NR90/NR70/NR50 are independent clustering views and are not guaranteed to be nested.",
            "Sequence similarity does not establish identical substrate specificity or catalytic activity.",
            "Global representatives maximize reusable evidence; reaction-specific representatives prioritize same-reaction kinetic or exact external evidence.",
            "Underexplored clusters lack strict reaction-level experimental support and mapped PDB/functional-site evidence; they are not claimed to be novel enzyme families.",
            "Distance to a known active enzyme is not claimed in this release; the representative score is evidence-based rather than an activity prediction.",
        ],
    })
    SUMMARY_JSON.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    readme = f"""# ReactEnzDB enzyme sequence clusters

Release: 2026.08  
Generated: {summary['generated_at_utc']}

This derived layer provides four non-redundant views of ReactEnzDB enzyme sequences:
NR100 exact identity and independent MMseqs2 NR90, NR70, and NR50 clusterings. MMseqs2
views use a minimum 80% bidirectional alignment coverage. Sequence clusters support
candidate compression and diversity browsing; they do not prove shared catalytic activity.

## Representative policy

Global representatives prioritize direct evidence, PMID-backed kinetics, exact external
kinetic confirmation, PDB/M-CSA/functional-site support, UniProt mapping, sequence
completeness, and annotation richness. Reaction-specific representatives first prioritize
evidence tied to the selected reaction.

## Experimental-support boundary

Strict reaction-cluster experimental support requires PMID-backed kinetics or an exact
external kinetic confirmation for the same reaction and enzyme. AlphaFold, sequence
similarity, EC-class context, and structure availability are reported separately.

## Reproducibility

MMseqs2 version: `{mmseqs_ver}`  
Minimum coverage: `0.8`, bidirectional (`--cov-mode 0`)  
Clustering mode: greedy by sequence length (`--cluster-mode 2`)

See `enzyme_sequence_clusters.summary.json` for counts, QA, taxonomy source checksum,
parameters, and export checksums.
"""
    README_MD.write_text(readme, encoding="utf-8")
    return summary


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage", choices=("audit", "cluster", "build", "all"), default="all")
    parser.add_argument("--force-cluster", action="store_true")
    parser.add_argument("--threads", type=int, default=20)
    args = parser.parse_args()
    if not CORE_DB.exists():
        raise FileNotFoundError(CORE_DB)
    with sqlite3.connect(CORE_DB) as core:
        records = load_records(core)
    fasta, unique = write_fasta(records)
    audit = write_input_manifest(records, unique)
    print(json.dumps(audit, indent=2))
    if args.stage == "audit":
        return
    mmseqs_ver = mmseqs_version()
    outputs = run_mmseqs(fasta, force=args.force_cluster, threads=max(1, args.threads))
    if args.stage == "cluster":
        print(json.dumps({threshold: str(path) for threshold, path in outputs.items()}, indent=2))
        return
    mappings = load_clusters(set(unique), outputs)
    summary = build_database(records, mappings, audit, mmseqs_ver)
    write_outputs(summary, mmseqs_ver)
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
