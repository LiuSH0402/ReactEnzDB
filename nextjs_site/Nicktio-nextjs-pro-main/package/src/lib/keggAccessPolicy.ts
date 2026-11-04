import type { DatabaseSync } from "node:sqlite";

export { keggAccessPolicy, releaseFileAllowed, keggPolicyUnavailable } from "./keggSourcePolicy.mjs";

/** Read-only public SQL projection. TEMP views also protect joins and aggregates;
 * main database bytes and historical freeze checksums remain unchanged.
 * Never query main.* directly from a public route: it bypasses this projection.
 */
export function installKeggPublicProjection(db: DatabaseSync): void {
  // Node 22 on production lacks FTS5. Introspecting virtual FTS tables would
  // load that unavailable module; their source-independent identifier index
  // is already handled by the application's Python FTS fallback.
  const tables = db.prepare("SELECT name FROM main.sqlite_master WHERE type = 'table' AND upper(coalesce(sql, '')) NOT LIKE 'CREATE VIRTUAL TABLE%'").all() as Array<{ name: string }>;
  const names = new Set(tables.map(row => row.name));
  const view = (table: string, condition: string) => {
    if (names.has(table)) db.exec(`CREATE TEMP VIEW "${table}" AS SELECT * FROM main."${table}" WHERE ${condition}`);
  };
  // Provenance is filtered before LIMIT, joins or COUNT, including mixed labels.
  for (const { name } of tables) {
    if (!/^[a-zA-Z0-9_]+$/.test(name) || name === "web_xrefs") continue;
    const columns = db.prepare(`PRAGMA main.table_info("${name}")`).all() as Array<{ name: string }>;
    const provenanceColumns = columns.filter(column => ["source_db", "target_db", "mapping_source", "structure_source"].includes(column.name));
    if (provenanceColumns.length) view(name, provenanceColumns.map(column =>
      `instr(lower(coalesce("${column.name}", '')), 'kegg') = 0`).join(" AND "));
  }
  if (names.has("web_xrefs")) {
    const columns = db.prepare('PRAGMA main.table_info("web_xrefs")').all() as Array<{ name: string }>;
    const projection = columns.map(({ name }) => name === "xref_url"
      ? `CASE WHEN instr(lower(xref_db), 'kegg') > 0 THEN
           CASE WHEN xref_value <> '' AND xref_value NOT GLOB '*[^A-Za-z0-9_:.-]*'
             THEN 'https://www.kegg.jp/entry/' || xref_value ELSE NULL END
           ELSE xref_url END AS xref_url`
      : `"${name}"`).join(", ");
    db.exec(`CREATE TEMP VIEW web_xrefs AS SELECT ${projection} FROM main.web_xrefs`);
  }
  if (names.has("bionavi_reaction_rules")) {
    // The biochemical rule pool mixes KEGG and other databases; no independent
    // per-rule source separation has been accepted. Organic USPTO rules remain.
    view("bionavi_reaction_rules", "rule_source <> 'enzymatic_metabolic'");
    view("bionavi_rule_references", "rule_id IN (SELECT rule_id FROM temp.bionavi_reaction_rules) AND upper(coalesce(external_db, '')) <> 'KEGG'");
    view("bionavi_building_blocks", "block_set IN ('BioNavi chemo building blocks', 'READRetro amino acid building blocks')");
    view("readretro_compounds", "0");
    view("retrosynthesis_benchmark_sets", "dataset_name = 'BioNavi-NP USPTO_NPL'");
    view("retrosynthesis_benchmark_reactions", "benchmark_id IN (SELECT benchmark_id FROM temp.retrosynthesis_benchmark_sets)");
    view("retrosynthesis_route_targets", "0");
  }
  if (names.has("rule_templates")) {
    view("rule_templates", "coalesce(rule_source, '') <> 'enzymatic_metabolic'");
    view("rule_template_reaction_links", "upper(coalesce(external_db, '')) <> 'KEGG' AND template_id IN (SELECT template_id FROM temp.rule_templates)");
    view("rule_template_enzyme_candidate_links", "template_id IN (SELECT template_id FROM temp.rule_templates)");
  }
  if (names.has("cross_database_mappings")) {
    view("mapping_conflicts", "mapping_id IS NULL OR mapping_id IN (SELECT mapping_id FROM temp.cross_database_mappings)");
  }
  if (names.has("reaction_host_mapping")) {
    const columns = db.prepare('PRAGMA main.table_info("reaction_host_mapping")').all() as Array<{ name: string }>;
    const replacements: Record<string, string> = {
      mapping_status: "'UNRESOLVED'", model_reaction_id: "NULL", identity_basis: "'WITHHELD_KEGG_POLICY'",
      direction_relation: "'UNRESOLVED'", compartment_relation: "'UNRESOLVED'", qc_flags_json: "'[\"WITHHELD_KEGG_POLICY\"]'",
    };
    const projection = columns.map(({ name }) => replacements[name]
      ? `CASE WHEN instr(lower(coalesce(identity_basis, '')), 'kegg') > 0 THEN ${replacements[name]} ELSE "${name}" END AS "${name}"`
      : `"${name}"`).join(", ");
    db.exec(`CREATE TEMP VIEW reaction_host_mapping AS SELECT ${projection} FROM main.reaction_host_mapping`);
  }
}
