export const QUALITY_SEMANTICS = {
  structureCoverage: {
    gold: "ChEBI-complete structure set",
    silver: "Structure-capable set",
  },
  annotationScore: "Annotation richness score",
  annotationScoreNote:
    "Summarizes available annotations and linked evidence; it is not a probability that a record is correct or that an enzyme is active.",
  hostCoverageScore: "Host-model coverage score",
  hostCoverageScoreNote:
    "Summarizes mappings to the selected host models; it is not a flux, growth, yield, expression, or production feasibility prediction.",
} as const;

export function structureCoverageLabel(value?: string | null) {
  if (value === "gold") return QUALITY_SEMANTICS.structureCoverage.gold;
  if (value === "silver") return QUALITY_SEMANTICS.structureCoverage.silver;
  return value || "Not assigned";
}

export function annotationCoverageLabel(value?: string | null) {
  if (value === "strong") return "high annotation coverage";
  if (value === "moderate") return "moderate annotation coverage";
  if (value === "limited") return "limited annotation coverage";
  return value || "not scored";
}
