import crypto from "node:crypto";
import { projectExportValue } from "@/lib/exportPresentation.mjs";
import { gzipSync } from "node:zlib";
import {
  getAlphaFoldMappings,
  getChassis,
  getChassisRecords,
  getEnzyme,
  getReportedExperimentalObservations,
  getEnzymeAttributeExternalChecks,
  getEnzymeChassis,
  getEnzymeKineticExternalChecks,
  getEnzymeKinetics,
  getEnzymeMcsaCompounds,
  getEnzymeMcsaEntries,
  getEnzymeMcsaMechanisms,
  getEnzymeMcsaMechanismSteps,
  getEnzymeMcsaReferences,
  getEnzymeMcsaResidues,
  getEnzymeReactions,
  getEnzymeStructureConfidence,
  getEnzymeXrefs,
  getOrganism,
  getPdbMappings,
  getReaction,
  getReactionAttributeExternalChecks,
  getReactionChassis,
  getReactionCompoundMnxMappings,
  getReactionCompounds,
  getReactionEnzymes,
  getReactionKineticExternalChecks,
  getReactionKinetics,
  getReactionMcsaCompounds,
  getReactionMcsaEntries,
  getReactionMcsaMechanisms,
  getReactionMcsaMechanismSteps,
  getReactionMcsaReferences,
  getReactionMcsaResidues,
  getReactionMnxMappings,
  getReactionXrefs,
  searchChassisPage,
  searchEnzymes,
  searchEnzymesPage,
  searchOrganismsPage,
  searchReactions,
  searchReactionsPage,
} from "@/lib/reactenzdb";
import { getReactionStandardizationBundle } from "@/lib/reaction-standardization";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ExportColumn<T> = {
  id: string;
  label: string;
  value: (row: T) => unknown;
};

type ExportTable = {
  name: string;
  columns: string[];
  rows: unknown[][];
};

const MAX_EXPORT_ROWS = 250000;

const reactionColumns = [
  { id: "reactenz_id", label: "ReactEnzDB ID", value: (row) => row.reactenz_reaction_id },
  { id: "internal_id", label: "Internal reaction ID", value: (row) => row.reaction_id },
  { id: "equation", label: "Equation", value: (row) => row.reaction_equation_display },
  { id: "direction", label: "Direction", value: (row) => row.reaction_direction },
  { id: "dataset", label: "Dataset level", value: (row) => row.dataset_level },
  { id: "participants", label: "Participants", value: (row) => row.participant_count },
  { id: "smiles", label: "SMILES", value: (row) => `${row.smiles_count ?? 0} mapped; ${row.missing_smiles_count ?? 0} unresolved` },
  { id: "enzymes", label: "Enzymes", value: (row) => row.enzyme_count },
  { id: "pairs", label: "Reaction-enzyme records", value: (row) => row.enzyme_pair_count },
  { id: "kinetics", label: "Kinetic records", value: (row) => row.kinetics_count },
  { id: "evidence_score", label: "Annotation richness score", value: (row) => row.evidence_score ?? 0 },
  { id: "evidence_tier", label: "Evidence tier", value: (row) => row.evidence_tier },
  { id: "ec", label: "EC", value: (row) => row.ec_number },
  { id: "rhea", label: "Rhea", value: (row) => row.rhea_id },
  { id: "kegg", label: "KEGG", value: (row) => row.kegg_reaction_id },
  { id: "metacyc", label: "MetaCyc", value: (row) => row.metacyc_reaction_id },
  { id: "mnxref", label: "MNXref", value: (row) => row.mnx_reaction_ids },
  { id: "structure", label: "Compound structure", value: (row) => (row.all_participants_have_smiles ? "SMILES complete" : "partial") },
  { id: "standardization", label: "Reaction standardization", value: (row) => JSON.stringify({
    status: row.standardization_status,
    structure: row.standardized_structure_status,
    stereo: row.stereo_completeness_status,
    mass_balance: row.full_mass_balance_status,
    charge_balance: row.full_charge_balance_status,
    exact_rhea_identity: Boolean(row.exact_rhea_identity),
    atom_mapping_available: Boolean(row.atom_mapping_available),
    mapping_conflict_count: row.mapping_conflict_count ?? 0,
  }) },
  { id: "enzyme_structure", label: "Enzyme structure", value: (row) => row.structured_enzyme_count ?? 0 },
  { id: "pdb", label: "PDB enzymes", value: (row) => row.pdb_enzyme_count ?? 0 },
  { id: "alphafold", label: "AlphaFold enzymes", value: (row) => row.alphafold_enzyme_count ?? 0 },
] satisfies ExportColumn<ReturnType<typeof searchReactions>[number]>[];

// Release 2026.08.1 compatibility contract: workbook column labels and sheet names below
// are serialized output, not current UI terminology. Do not rename them in place.
const enzymeColumns = [
  { id: "reactenz_id", label: "ReactEnzDB ID", value: (row) => row.reactenz_enzyme_id },
  { id: "biopart_id", label: "Biopart ID", value: (row) => row.biopart_id },
  { id: "protein_id", label: "Protein ID", value: (row) => row.protein_id },
  { id: "enzyme", label: "Enzyme", value: (row) => row.enzyme_name },
  { id: "uniprot", label: "UniProt", value: (row) => row.uniprot_accession },
  { id: "gene", label: "Gene", value: (row) => row.gene_name_primary },
  { id: "organism", label: "Organism", value: (row) => row.organism },
  { id: "taxonomy", label: "Taxonomy", value: (row) => row.taxonomy_id },
  { id: "sequence_status", label: "Sequence status", value: (row) => (row.has_sequence ? "available" : "not available") },
  { id: "sequence", label: "Sequence length", value: (row) => row.sequence_length },
  { id: "reactions", label: "Reactions", value: (row) => row.reaction_count },
  { id: "structure", label: "Structure", value: (row) => (row.structure_count ?? 0) },
  { id: "interpro", label: "InterPro entries", value: (row) => row.interpro_count ?? 0 },
  { id: "pfam", label: "Pfam signatures", value: (row) => row.pfam_count ?? 0 },
  { id: "protein_sites", label: "Protein functional sites", value: (row) => (row.active_site_count ?? 0) + (row.binding_site_count ?? 0) + (row.conserved_site_count ?? 0) },
  { id: "pdb", label: "PDB", value: (row) => row.pdb_count ?? 0 },
  { id: "alphafold", label: "AlphaFold", value: (row) => row.alphafold_count ?? 0 },
  { id: "structure_confidence", label: "Structure confidence score", value: (row) => row.structure_confidence_score ?? 0 },
  { id: "high_confidence_structure", label: "High-confidence structure", value: (row) => row.has_high_confidence_structure ? "yes" : "no" },
  { id: "catalytic_site_support", label: "Catalytic-site structural support", value: (row) => row.catalytic_site_support_level ?? "none" },
  { id: "kinetics", label: "Kinetics", value: (row) => row.kinetic_count ?? 0 },
  { id: "evidence_score", label: "Annotation richness score", value: (row) => row.evidence_score ?? 0 },
  { id: "evidence_tier", label: "Evidence tier", value: (row) => row.evidence_tier },
  { id: "chassis", label: "Chassis", value: (row) => row.chassis_count ?? 0 },
  { id: "evidence", label: "Evidence", value: (row) => row.evidence_label },
] satisfies ExportColumn<ReturnType<typeof searchEnzymes>[number]>[];

const organismColumns = [
  { id: "reactenz_id", label: "ReactEnzDB ID", value: (row) => row.reactenz_organism_id },
  { id: "organism", label: "Organism", value: (row) => row.organism },
  { id: "relations", label: "R-E-O records", value: (row) => row.relation_count },
  { id: "reactions", label: "Reactions", value: (row) => row.reaction_count },
  { id: "enzymes", label: "Enzymes", value: (row) => row.enzyme_count },
  { id: "chassis", label: "Chassis labels", value: (row) => row.chassis_count },
  { id: "evidence_score", label: "Annotation richness score", value: (row) => row.evidence_score ?? 0 },
  { id: "evidence_tier", label: "Evidence tier", value: (row) => row.evidence_tier },
  { id: "structure", label: "Structured enzymes", value: (row) => row.structured_enzyme_count ?? 0 },
  { id: "structure_coverage", label: "Structure coverage (%)", value: (row) => row.enzyme_count > 0 ? Math.round(((row.structured_enzyme_count ?? 0) / row.enzyme_count) * 100) : 0 },
  { id: "pdb", label: "PDB enzymes", value: (row) => row.pdb_enzyme_count ?? 0 },
  { id: "alphafold", label: "AlphaFold enzymes", value: (row) => row.alphafold_enzyme_count ?? 0 },
] satisfies ExportColumn<ReturnType<typeof searchOrganismsPage>["rows"][number]>[];

const chassisColumns = [
  { id: "reactenz_id", label: "ReactEnzDB ID", value: (row) => row.reactenz_chassis_id },
  { id: "label", label: "Chassis label", value: (row) => row.label },
  { id: "records", label: "R-E-O records", value: (row) => row.record_count },
  { id: "reactions", label: "Reactions", value: (row) => row.reaction_count },
  { id: "enzymes", label: "Enzymes", value: (row) => row.enzyme_count },
  { id: "organisms", label: "Organisms", value: (row) => row.organism_count },
  { id: "evidence_score", label: "Annotation richness score", value: (row) => row.evidence_score ?? 0 },
  { id: "evidence_tier", label: "Evidence tier", value: (row) => row.evidence_tier },
  { id: "structure", label: "Structured enzymes", value: (row) => row.structured_enzyme_count ?? 0 },
  { id: "structure_coverage", label: "Structure coverage (%)", value: (row) => row.enzyme_count > 0 ? Math.round(((row.structured_enzyme_count ?? 0) / row.enzyme_count) * 100) : 0 },
  { id: "pdb", label: "PDB enzymes", value: (row) => row.pdb_enzyme_count ?? 0 },
  { id: "alphafold", label: "AlphaFold enzymes", value: (row) => row.alphafold_enzyme_count ?? 0 },
] satisfies ExportColumn<ReturnType<typeof searchChassisPage>["rows"][number]>[];

function single(params: URLSearchParams, key: string): string {
  return params.get(key) ?? "";
}

function boolFilter(value: string): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function selectedColumns<T>(allColumns: ExportColumn<T>[], params: URLSearchParams): ExportColumn<T>[] {
  const requested = single(params, "columns")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!requested.length) return allColumns;
  const requestedSet = new Set(requested);
  const selected = allColumns.filter((column) => requestedSet.has(column.id));
  return selected.length ? selected : allColumns;
}

function selectedIds(params: URLSearchParams): Set<string> | null {
  const ids = single(params, "ids")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return ids.length ? new Set(ids) : null;
}

function filterSelected<T>(rows: T[], params: URLSearchParams, getId: (row: T) => string): T[] {
  const ids = selectedIds(params);
  if (!ids) return rows;
  return rows.filter((row) => ids.has(getId(row)));
}

function makeTable<T>(name: string, rows: T[], columns: ExportColumn<T>[]): ExportTable {
  return {
    name,
    columns: columns.map((column) => column.label),
    rows: rows.map((row) => columns.map((column) => column.value(row))),
  };
}

function listExport(type: string, params: URLSearchParams): { filename: string; tables: ExportTable[] } {
  if (type === "reactions") {
    const rows = filterSelected(searchReactionsPage({
      q: single(params, "q"),
      dataset: single(params, "dataset") || "all",
      direction: single(params, "direction") || "all",
      complete: boolFilter(single(params, "complete")),
      organism: single(params, "organism"),
      chassis: single(params, "chassis"),
      sort: single(params, "sort") || "completeness",
      dir: single(params, "dir") || "desc",
      ec: single(params, "ec"),
      rhea: single(params, "rhea"),
      kegg: single(params, "kegg"),
      metacyc: single(params, "metacyc"),
      mnx: single(params, "mnx"),
      minEnzymes: single(params, "minEnzymes"),
      maxEnzymes: single(params, "maxEnzymes"),
      minParticipants: single(params, "minParticipants"),
      maxParticipants: single(params, "maxParticipants"),
      minPairs: single(params, "minPairs"),
      maxPairs: single(params, "maxPairs"),
      minKinetics: single(params, "minKinetics"),
      maxKinetics: single(params, "maxKinetics"),
      minEvidenceScore: single(params, "minEvidenceScore"),
      maxEvidenceScore: single(params, "maxEvidenceScore"),
      massBalance: single(params, "massBalance"),
      chargeBalance: single(params, "chargeBalance"),
      stereoStatus: single(params, "stereoStatus"),
      structureStatus: single(params, "structureStatus"),
      exactRhea: boolFilter(single(params, "exactRhea")),
      atomMapped: boolFilter(single(params, "atomMapped")),
      conflictFree: boolFilter(single(params, "conflictFree")),
      limit: MAX_EXPORT_ROWS,
    }).rows, params, (row) => row.reactenz_reaction_id);
    return { filename: "reactenzdb_reactions.xls", tables: [makeTable("Reactions", rows, selectedColumns(reactionColumns, params))] };
  }

  if (type === "enzymes") {
    const sequence = single(params, "sequence") || "all";
    const rows = filterSelected(searchEnzymesPage({
      q: single(params, "q"),
      sequenceOnly: single(params, "sequence") === "true",
      sequence,
      organism: single(params, "organism"),
      reactionId: single(params, "reactionId"),
      chassis: single(params, "chassis"),
      sort: single(params, "sort") || "completeness",
      dir: single(params, "dir") || "desc",
      gene: single(params, "gene"),
      taxonomy: single(params, "taxonomy"),
      proteinId: single(params, "proteinId"),
      uniprot: single(params, "uniprot"),
      minLength: single(params, "minLength"),
      maxLength: single(params, "maxLength"),
      minReactions: single(params, "minReactions"),
      maxReactions: single(params, "maxReactions"),
      minPdb: single(params, "minPdb"),
      maxPdb: single(params, "maxPdb"),
      minAlphaFold: single(params, "minAlphaFold"),
      maxAlphaFold: single(params, "maxAlphaFold"),
      minKinetics: single(params, "minKinetics"),
      maxKinetics: single(params, "maxKinetics"),
      minChassis: single(params, "minChassis"),
      maxChassis: single(params, "maxChassis"),
      hasPdb: single(params, "hasPdb") || "all",
      hasAlphaFold: single(params, "hasAlphaFold") || "all",
      hasStructure: single(params, "hasStructure") || "all",
      hasKinetics: single(params, "hasKinetics") || "all",
      hasInterPro: single(params, "hasInterPro") || "all",
      hasHighConfidenceStructure: single(params, "hasHighConfidenceStructure") || "all",
      hasCatalyticSiteSupport: single(params, "hasCatalyticSiteSupport") || "all",
      minEvidenceScore: single(params, "minEvidenceScore"),
      maxEvidenceScore: single(params, "maxEvidenceScore"),
      minStructureConfidenceScore: single(params, "minStructureConfidenceScore"),
      limit: MAX_EXPORT_ROWS,
    }).rows, params, (row) => row.reactenz_enzyme_id);
    return { filename: "reactenzdb_enzymes.xls", tables: [makeTable("Enzymes", rows, selectedColumns(enzymeColumns, params))] };
  }

  if (type === "organisms") {
    const rows = filterSelected(searchOrganismsPage({
      q: single(params, "q"),
      sort: single(params, "sort") || "completeness",
      dir: single(params, "dir") || "desc",
      minEvidenceScore: single(params, "minEvidenceScore"),
      maxEvidenceScore: single(params, "maxEvidenceScore"),
      minEnzymes: single(params, "minEnzymes"),
      maxEnzymes: single(params, "maxEnzymes"),
      minReactions: single(params, "minReactions"),
      maxReactions: single(params, "maxReactions"),
      minRelations: single(params, "minRelations"),
      maxRelations: single(params, "maxRelations"),
      minChassis: single(params, "minChassis"),
      maxChassis: single(params, "maxChassis"),
      hasStructure: single(params, "hasStructure") || "all",
      limit: MAX_EXPORT_ROWS,
    }).rows, params, (row) => row.reactenz_organism_id);
    return { filename: "reactenzdb_organisms.xls", tables: [makeTable("Organisms", rows, selectedColumns(organismColumns, params))] };
  }

  if (type === "chassis") {
    const rows = filterSelected(searchChassisPage({
      q: single(params, "q"),
      sort: single(params, "sort") || "completeness",
      dir: single(params, "dir") || "desc",
      minEvidenceScore: single(params, "minEvidenceScore"),
      maxEvidenceScore: single(params, "maxEvidenceScore"),
      minRecords: single(params, "minRecords"),
      maxRecords: single(params, "maxRecords"),
      minReactions: single(params, "minReactions"),
      maxReactions: single(params, "maxReactions"),
      minEnzymes: single(params, "minEnzymes"),
      maxEnzymes: single(params, "maxEnzymes"),
      minOrganisms: single(params, "minOrganisms"),
      maxOrganisms: single(params, "maxOrganisms"),
      hasStructure: single(params, "hasStructure") || "all",
      limit: MAX_EXPORT_ROWS,
    }).rows, params, (row) => row.reactenz_chassis_id);
    return { filename: "reactenzdb_chassis.xls", tables: [makeTable("Chassis", rows, selectedColumns(chassisColumns, params))] };
  }

  throw new Error("Unsupported export type.");
}

function objectTable(name: string, inputRows: Record<string, unknown>[]): ExportTable {
  const rows = inputRows.map(row => projectExportValue(row)).filter(row => row !== null) as Record<string, unknown>[];
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  return {
    name,
    columns,
    rows: rows.map((row) => columns.map((column) => {
      const value = row[column];
      return value !== null && typeof value === "object" ? JSON.stringify(value) : value;
    })),
  };
}

function detailExport(type: string, id: string): { filename: string; tables: ExportTable[] } {
  if (type === "reaction-detail") {
    const reaction = getReaction(id);
    if (!reaction) throw new Error("Reaction not found.");
    const standardization = getReactionStandardizationBundle(reaction.reaction_id);
    const reactionCentres = standardization?.atom_mappings
      .map((mapping) => mapping.reaction_centre)
      .filter((centre) => centre !== null) ?? [];
    return {
      filename: `reactenzdb_${reaction.reactenz_reaction_id}.xls`,
      tables: [
        objectTable("Reaction summary", [reaction as unknown as Record<string, unknown>]),
        objectTable("Normalized identity", standardization ? [standardization.standardization as unknown as Record<string, unknown>] : []),
        objectTable("Normalized participants", standardization?.participants as unknown as Record<string, unknown>[] ?? []),
        objectTable("Mass and charge balance", standardization?.balances as unknown as Record<string, unknown>[] ?? []),
        objectTable("Cross-database mappings", standardization?.cross_database_mappings as unknown as Record<string, unknown>[] ?? []),
        objectTable("Mapping conflicts", standardization?.conflicts as unknown as Record<string, unknown>[] ?? []),
        objectTable("Atom mappings", standardization?.atom_mappings as unknown as Record<string, unknown>[] ?? []),
        objectTable("Reaction centres", reactionCentres as unknown as Record<string, unknown>[]),
        objectTable("Participants", getReactionCompounds(reaction.reaction_id) as unknown as Record<string, unknown>[]),
        objectTable("MNX reaction mappings", getReactionMnxMappings(reaction.reaction_id) as unknown as Record<string, unknown>[]),
        objectTable("MNX compound mappings", getReactionCompoundMnxMappings(reaction.reaction_id) as unknown as Record<string, unknown>[]),
        objectTable("M-CSA entries", getReactionMcsaEntries(reaction.reaction_id, MAX_EXPORT_ROWS) as unknown as Record<string, unknown>[]),
        objectTable("M-CSA catalytic residues", getReactionMcsaResidues(reaction.reaction_id, MAX_EXPORT_ROWS) as unknown as Record<string, unknown>[]),
        objectTable("M-CSA mechanisms", getReactionMcsaMechanisms(reaction.reaction_id, MAX_EXPORT_ROWS) as unknown as Record<string, unknown>[]),
        objectTable("M-CSA mechanism steps", getReactionMcsaMechanismSteps(reaction.reaction_id, MAX_EXPORT_ROWS) as unknown as Record<string, unknown>[]),
        objectTable("M-CSA compounds", getReactionMcsaCompounds(reaction.reaction_id, MAX_EXPORT_ROWS) as unknown as Record<string, unknown>[]),
        objectTable("M-CSA references", getReactionMcsaReferences(reaction.reaction_id, MAX_EXPORT_ROWS) as unknown as Record<string, unknown>[]),
        objectTable("Enzymes", getReactionEnzymes(reaction.reaction_id, MAX_EXPORT_ROWS) as unknown as Record<string, unknown>[]),
        objectTable("Kinetics", getReactionKinetics(reaction.reaction_id, MAX_EXPORT_ROWS) as unknown as Record<string, unknown>[]),
        objectTable("Kinetic external checks", getReactionKineticExternalChecks(reaction.reaction_id, MAX_EXPORT_ROWS) as unknown as Record<string, unknown>[]),
        objectTable("Attribute external checks", getReactionAttributeExternalChecks(reaction.reaction_id, MAX_EXPORT_ROWS) as unknown as Record<string, unknown>[]),
        objectTable("Chassis", getReactionChassis(reaction.reaction_id) as unknown as Record<string, unknown>[]),
        objectTable("External links", getReactionXrefs(reaction.reaction_id) as unknown as Record<string, unknown>[]),
      ],
    };
  }

  if (type === "enzyme-detail") {
    const enzyme = getEnzyme(id);
    if (!enzyme) throw new Error("Enzyme not found.");
    const reported = getReportedExperimentalObservations(enzyme.biopart_id);
    return {
      filename: `reactenzdb_${enzyme.reactenz_enzyme_id}.xls`,
      tables: [
        objectTable("Enzyme summary", [enzyme as unknown as Record<string, unknown>]),
        objectTable("Reported expression yields", reported.expression as unknown as Record<string, unknown>[]),
        objectTable("Reported stability", reported.stability as unknown as Record<string, unknown>[]),
        objectTable("Reactions", getEnzymeReactions(enzyme.biopart_id, MAX_EXPORT_ROWS) as unknown as Record<string, unknown>[]),
        objectTable("Kinetics", getEnzymeKinetics(enzyme.biopart_id, MAX_EXPORT_ROWS) as unknown as Record<string, unknown>[]),
        objectTable("Kinetic external checks", getEnzymeKineticExternalChecks(enzyme.biopart_id, MAX_EXPORT_ROWS) as unknown as Record<string, unknown>[]),
        objectTable("Attribute external checks", getEnzymeAttributeExternalChecks(enzyme.biopart_id, MAX_EXPORT_ROWS) as unknown as Record<string, unknown>[]),
        objectTable("Structure confidence", [getEnzymeStructureConfidence(enzyme.biopart_id)].filter(Boolean) as unknown as Record<string, unknown>[]),
        objectTable("M-CSA entries", getEnzymeMcsaEntries(enzyme.biopart_id, MAX_EXPORT_ROWS) as unknown as Record<string, unknown>[]),
        objectTable("M-CSA catalytic residues", getEnzymeMcsaResidues(enzyme.biopart_id, MAX_EXPORT_ROWS) as unknown as Record<string, unknown>[]),
        objectTable("M-CSA mechanisms", getEnzymeMcsaMechanisms(enzyme.biopart_id, MAX_EXPORT_ROWS) as unknown as Record<string, unknown>[]),
        objectTable("M-CSA mechanism steps", getEnzymeMcsaMechanismSteps(enzyme.biopart_id, MAX_EXPORT_ROWS) as unknown as Record<string, unknown>[]),
        objectTable("M-CSA compounds", getEnzymeMcsaCompounds(enzyme.biopart_id, MAX_EXPORT_ROWS) as unknown as Record<string, unknown>[]),
        objectTable("M-CSA references", getEnzymeMcsaReferences(enzyme.biopart_id, MAX_EXPORT_ROWS) as unknown as Record<string, unknown>[]),
        objectTable("PDB mappings", getPdbMappings(enzyme.biopart_id) as unknown as Record<string, unknown>[]),
        objectTable("AlphaFold mappings", getAlphaFoldMappings(enzyme.biopart_id) as unknown as Record<string, unknown>[]),
        objectTable("Chassis", getEnzymeChassis(enzyme.biopart_id) as unknown as Record<string, unknown>[]),
        objectTable("External links", getEnzymeXrefs(enzyme.biopart_id) as unknown as Record<string, unknown>[]),
      ],
    };
  }

  if (type === "organism-detail") {
    const organism = getOrganism(id);
    if (!organism) throw new Error("Organism not found.");
    return {
      filename: `reactenzdb_${organism.reactenz_organism_id}.xls`,
      tables: [
        objectTable("Organism summary", [organism as unknown as Record<string, unknown>]),
        makeTable("Reactions", searchReactions({ organism: organism.organism, complete: false, limit: MAX_EXPORT_ROWS }), reactionColumns),
        makeTable("Enzymes", searchEnzymes({ organism: organism.organism, sequenceOnly: false, limit: MAX_EXPORT_ROWS }), enzymeColumns),
      ],
    };
  }

  if (type === "chassis-detail") {
    const chassis = getChassis(id);
    if (!chassis) throw new Error("Chassis not found.");
    return {
      filename: `reactenzdb_${chassis.reactenz_chassis_id}.xls`,
      tables: [
        objectTable("Chassis summary", [chassis as unknown as Record<string, unknown>]),
        objectTable("Relation records", getChassisRecords(chassis.label, MAX_EXPORT_ROWS) as unknown as Record<string, unknown>[]),
        makeTable("Reactions", searchReactions({ chassis: chassis.label, complete: false, limit: MAX_EXPORT_ROWS }), reactionColumns),
        makeTable("Enzymes", searchEnzymes({ chassis: chassis.label, sequenceOnly: false, limit: MAX_EXPORT_ROWS }), enzymeColumns),
      ],
    };
  }

  throw new Error("Unsupported detail export type.");
}

function escapeHtml(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function xlsDocument(title: string, tables: ExportTable[]): string {
  const sheets = tables.map((table) => {
    const header = table.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("");
    const body = table.rows
      .map((row) => `<tr>${row.map((cell) => `<td style="mso-number-format:'\\@';">${escapeHtml(cell)}</td>`).join("")}</tr>`)
      .join("");
    return `
      <h2>${escapeHtml(table.name)}</h2>
      <table border="1">
        <thead><tr>${header}</tr></thead>
        <tbody>${body}</tbody>
      </table>
      <br/>
    `;
  });

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
</head>
<body>
  ${sheets.join("\n")}
</body>
</html>`;
}

function tsvCell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  let text = String(value);
  // Prevent spreadsheet programs from evaluating downloaded database text as a formula.
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  if (/[\t\r\n"]/.test(text)) text = `"${text.replaceAll('"', '""')}"`;
  return text;
}

function compressedTsv(table: ExportTable): Buffer {
  const rows = [
    table.columns.map(tsvCell).join("\t"),
    ...table.rows.map((row) => row.map(tsvCell).join("\t")),
  ];
  return gzipSync(Buffer.from(`\uFEFF${rows.join("\n")}\n`, "utf8"), { level: 6 });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const type = single(url.searchParams, "type");
    const id = single(url.searchParams, "id");
    const exportData = id ? detailExport(type, id) : listExport(type, url.searchParams);
    const format = single(url.searchParams, "format");
    const useCompressedTsv = !id && (format === "tsv.gz" || (type === "enzymes" && format !== "xls"));
    if (useCompressedTsv) {
      const body = compressedTsv(exportData.tables[0]);
      const filename = exportData.filename.replace(/\.xls$/i, ".tsv.gz");
      return new Response(new Uint8Array(body), {
        headers: {
          "Content-Type": "application/gzip",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Content-Length": String(body.byteLength),
          "X-Content-SHA256": crypto.createHash("sha256").update(body).digest("hex"),
          "Cache-Control": "private, no-store",
        },
      });
    }
    const body = xlsDocument(exportData.filename, exportData.tables);

    return new Response(body, {
      headers: {
        "Content-Type": "application/vnd.ms-excel; charset=utf-8",
        "Content-Disposition": `attachment; filename="${exportData.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Export failed." }, { status: 400 });
  }
}
