import data from "../../public/data/reaction-enzyme-literature.json";

export type PairLiteratureRecord = typeof data.records[number];
export const pairLiteratureRevision = data.revision;

// Match both stable IDs. Notes for one protein or reaction never propagate to
// homologues, similarly named genes, or another reaction with the same EC.
export function getPairLiterature(reactionId: string, enzymeId: string): PairLiteratureRecord[] {
  return data.records.filter(row =>
    (row.reaction_id === reactionId || row.reactenz_reaction_id === reactionId) &&
    (row.biopart_id === enzymeId || row.reactenz_enzyme_id === enzymeId));
}

export function getTargetLiterature(target: "reaction" | "enzyme", id: string): PairLiteratureRecord[] {
  return data.records.filter(row => target === "reaction"
    ? row.reaction_id === id || row.reactenz_reaction_id === id
    : row.biopart_id === id || row.reactenz_enzyme_id === id);
}
