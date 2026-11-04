import fs from "node:fs";
import path from "node:path";
import { getHostRegistryPreview, hostContextLayerAvailable } from "@/lib/hostRegistryPreview";
import { querySqliteParams } from "@/lib/sqlite";

function resolveHostContextDb(): string {
  if (process.env.HOST_CONTEXT_STAGING_DB_PATH) {
    return path.resolve(process.env.HOST_CONTEXT_STAGING_DB_PATH);
  }
  const freeze = path.resolve(process.cwd(), "../../../staging/releases/2026.09.1/host_context_v1.sqlite");
  if (fs.existsSync(freeze)) return freeze;
  return path.resolve(process.cwd(), "../../../staging/host-context/2026.09.1/host_context_v1_staging.sqlite");
}

const DB_PATH = resolveHostContextDb();

export const MAX_HOST_RELEASES = 30;
export const mappingStatuses = ["EXACT_NATIVE", "DIRECTIONAL_NATIVE", "CONTEXT_ONLY", "NOT_MAPPED", "UNRESOLVED"] as const;
export type MappingStatus = (typeof mappingStatuses)[number];

export type LocalMappingRow = {
  reaction_id: string;
  reactenz_reaction_id: string;
  release_id: string;
  host_id: string;
  scientific_name: string;
  strain: string;
  model_name: string;
  mapping_status: MappingStatus;
  model_reaction_id: string | null;
  identity_basis: string;
  direction_relation: string;
  compartment_relation: string;
  qc_flags_json: string;
  mapping_version: string;
};

export function localMappingPreviewAvailable(): boolean {
  return hostContextLayerAvailable() && getHostRegistryPreview() !== null;
}

function selectedReleases(releaseIds: string[]) {
  const registry = getHostRegistryPreview();
  if (!localMappingPreviewAvailable() || !registry) return null;
  const selected = registry.filter((row) => releaseIds.includes(row.release_id));
  if (selected.length !== releaseIds.length || new Set(selected.map((row) => row.host_id)).size !== selected.length) return null;
  return selected;
}

export function getLocalMappingsForReactions(reactionIds: string[], releaseIds: string[]): LocalMappingRow[] | null {
  if (!reactionIds.length || !releaseIds.length || reactionIds.length > 30 || releaseIds.length > MAX_HOST_RELEASES) return null;
  if (!reactionIds.every((id) => /^OENA\d+$/.test(id)) || !selectedReleases(releaseIds)) return null;
  const rows = querySqliteParams<LocalMappingRow>(DB_PATH, `
    SELECT m.reaction_id, s.reactenz_reaction_id, m.release_id,
           h.host_id, h.scientific_name, h.strain, hm.model_name,
           m.mapping_status, m.model_reaction_id, m.identity_basis,
           m.direction_relation, m.compartment_relation, m.qc_flags_json, m.mapping_version
    FROM reaction_host_mapping m
    JOIN reaction_registry_snapshot s ON s.reaction_id = m.reaction_id
    JOIN host_model_releases r ON r.release_id = m.release_id
    JOIN host_models hm ON hm.model_id = r.model_id
    JOIN curated_hosts h ON h.host_id = hm.host_id
    WHERE m.reaction_id IN (SELECT value FROM json_each(?))
      AND m.release_id IN (SELECT value FROM json_each(?))
    ORDER BY s.reactenz_reaction_id, h.ordinal
  `, [JSON.stringify(reactionIds), JSON.stringify(releaseIds)]);
  return rows;
}

export function getLocalMappingsForReaction(reactionId: string): LocalMappingRow[] | null {
  const registry = getHostRegistryPreview();
  if (!registry) return null;
  return getLocalMappingsForReactions([reactionId], registry.map((row) => row.release_id));
}

export function getLocalReactionIdsByHostStatus(releaseId: string, status: MappingStatus): string[] | null {
  if (!mappingStatuses.includes(status) || !selectedReleases([releaseId])) return null;
  const rows = querySqliteParams<{ reaction_id: string }>(DB_PATH, `
    SELECT reaction_id FROM reaction_host_mapping
    WHERE release_id = ? AND mapping_status = ?
    ORDER BY reaction_id
  `, [releaseId, status]);
  return rows.map((row) => row.reaction_id);
}
