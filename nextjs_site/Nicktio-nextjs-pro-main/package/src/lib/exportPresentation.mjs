const origins = new Set([
  "source_db", "source_db_raw", "source_db_normalized", "source_label", "source_labels",
  "source_release", "source_name", "source_note", "source_description", "model_source",
  "mapping_source", "structure_source", "evidence_source", "source_database", "database_source",
  "source_manifest", "source_manifest_json", "included_sources", "provenance", "representative_source_labels",
]);
export function projectExportValue(value) {
  if (typeof value === "string" && /^[\[{]/.test(value.trim())) {
    try {
      const parsed = JSON.parse(value);
      return JSON.stringify(projectExportValue(parsed));
    } catch { return value; }
  }
  if (Array.isArray(value)) return value.map(projectExportValue).filter(v => v !== null);
  if (!value || typeof value !== "object") return value;
  const identifierKeys = new Set(["source", "source_db", "id", "entity_type", "entity_id", "identifier_namespace", "xref_db", "xref_value", "xref_url", "url", "link"]);
  const identifierRecord = Boolean((value.xref_db && value.xref_value) || (value.source && value.id)) && Object.keys(value).every(key => identifierKeys.has(key));
  const keggOrigin = item => Array.isArray(item) ? item.some(keggOrigin) : typeof item === "string" && item.toLowerCase().includes("kegg");
  if (!identifierRecord && Object.entries(value).some(([key, item]) => (origins.has(key) || key === "source") && keggOrigin(item))) return null;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "source_name" && ("source_compound_id" in value || "compound_id" in value || "smiles" in value)) {
      result.compound_name = projectExportValue(item);
    } else if (origins.has(key)) continue;
    else if (key === "source") {
      if (value.id) result.identifier_namespace = item;
    } else result[key === "source_url" ? "record_url" : key === "source_entry_id" ? "external_record_id" : key] = projectExportValue(item);
  }
  return result;
}
