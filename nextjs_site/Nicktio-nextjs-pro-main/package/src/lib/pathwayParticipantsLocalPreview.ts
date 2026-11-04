import { releasePath } from "@/lib/paths";
import path from "node:path";
import { hostContextLayerAvailable } from "@/lib/hostRegistryPreview";
import { querySqliteParams } from "@/lib/sqlite";
import type { PathwayParticipant } from "@/lib/pathwayLocalCalculations";

const STANDARD_DB = releasePath("reaction_standardization.sqlite");

export function getLocalPathwayParticipants(reactionIds: string[]): PathwayParticipant[] {
  if (!hostContextLayerAvailable()) return [];
  if (!reactionIds.length || reactionIds.length > 30 || !reactionIds.every((id) => /^OENA\d+$/.test(id))) return [];
  return querySqliteParams<PathwayParticipant>(STANDARD_DB, `
    SELECT reaction_id, side, source_name, chebi_id,
           stoichiometric_coefficient, structure_status, participant_role
    FROM normalized_participants
    WHERE reaction_id IN (SELECT value FROM json_each(?))
    ORDER BY reaction_id, side, position_index
  `, [JSON.stringify(reactionIds)]);
}
