/** Collection provenance stays in storage; data-facing values omit its labels. */
const collectionKeys = new Set([
  "source_db", "source_db_raw", "source_db_normalized", "source_label",
  "source_labels", "source_release", "source_manifest", "source_manifest_json",
  "source_database", "database_source", "included_sources", "provenance",
]);

function dataValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dataValue);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.entries(record).flatMap(([key, item]) => {
      if (collectionKeys.has(key.toLowerCase())) return [];
      if (key === "source") {
        // An evidence accession needs its namespace; it is an identifier rather
        // than a description of where ReactEnzDB collected the row.
        return record.id ? [["identifier_namespace", item]] : [];
      }
      return [[key, dataValue(item)]];
    }));
  }
  return value;
}

export function presentAttributeValue(value: string | null | undefined) {
  if (!value || !/^[\[{]/.test(value.trim())) return value;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed.name === "string" && Array.isArray(parsed.reactionCrossReferences)) {
      return parsed.name;
    }
    return JSON.stringify(dataValue(parsed));
  } catch {
    return value;
  }
}
