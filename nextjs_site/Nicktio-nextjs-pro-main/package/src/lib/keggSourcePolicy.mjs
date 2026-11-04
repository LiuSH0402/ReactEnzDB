export const keggAccessPolicy = {
  policy_version: "2026-10-08-external-links-only",
  mode: "external_links_only",
  permitted: ["identifier_cross_references", "ordinary_links_to_original_website"],
  withheld: ["KEGG pathway content and membership", "explicitly KEGG-sourced attributes", "KEGG chemistry comparisons and linked conflict evidence", "KEGG-dependent rule and host mappings", "mixed bulk data pending source separation"],
  source_snapshot_unchanged: true,
  provenance_limit: "Historical RDBSB records lack complete field-level upstream provenance. This policy does not certify their upstream rights or third-party predictor training data.",
  source_terms: "https://www.kegg.jp/kegg/legal.html",
};

// Exact allowlist: unreviewed bulk files and new filenames stay closed by default.
const publicMetadata = new Set([
  "manifest.json", "data_repair_manifest.json", "PUBLIC_RELEASE_GOVERNANCE.json", "PUBLIC_RELEASE_GOVERNANCE.md",
  "LICENSE_DATA.txt", "CITATION.cff", "README_RELEASE.md", "DATA_LAYER_REGISTRY.json", "DATA_LAYER_REGISTRY.md",
  "RETROSYNTHESIS_TOOL_REGISTRY.json", "RETROSYNTHESIS_TOOL_REGISTRY.md",
]);
export function releaseFileAllowed(filename) {
  return publicMetadata.has(filename);
}

export function keggPolicyUnavailable() {
  return Response.json({ error: "This mixed data resource is withheld under the KEGG external-links-only policy pending source separation.", policy: keggAccessPolicy },
    { status: 410, headers: { "Cache-Control": "no-store", "X-ReactEnzDB-Source-Policy": keggAccessPolicy.policy_version } });
}

