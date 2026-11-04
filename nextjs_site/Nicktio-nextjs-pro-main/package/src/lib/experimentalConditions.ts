export function formatExperimentalConditions(text: string | null | undefined): string | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) return text;
    const fields: string[] = [];
    if (value.ph != null) fields.push(`pH ${value.ph}${value.ph_end != null && value.ph_end !== value.ph ? `–${value.ph_end}` : ""}`);
    if (value.temperature != null) fields.push(`${value.temperature}${value.temperature_end != null && value.temperature_end !== value.temperature ? `–${value.temperature_end}` : ""} ${value.temperature_unit || "°C"}`);
    if (value.buffer_text) fields.push(`Buffer: ${value.buffer_text}`);
    if (value.original_annotation) fields.push(String(value.original_annotation));
    if (typeof value.evidence_scope === "string" && value.evidence_scope.includes("not independently revalidated")) fields.push("Construct form not independently revalidated.");
    if (value.literature_review_status === "measurement_citation_linked_full_text_pending") fields.push("Measurement citation linked; full-text validation pending.");
    return fields.length ? [...new Set(fields)].join("; ") : text;
  } catch { return text; }
}
