/** Conservative, local-only interpretation of fixed-model evidence. */

export type RequestedDirection = "forward" | "reverse" | "unspecified";
export type DirectionCheck = "SUPPORTED_IN_MODEL_RECORD" | "CONFLICTS_WITH_MODEL_RECORD" | "INSUFFICIENT" | "NO_EXACT_MODEL_MAPPING";
export type ModelGapCheck = "MODEL_NATIVE_CANDIDATE" | "MODEL_NO_EXACT_MATCH" | "CONTEXT_ONLY_NO_NATIVE_MATCH" | "DIRECTION_CONFLICT" | "INSUFFICIENT";
export type ContinuityCheck = "POSSIBLE_DIRECT_CHEMICAL_LINK" | "CURRENCY_ONLY_LINK" | "NO_DIRECT_MAIN_PARTICIPANT_LINK" | "INSUFFICIENT";

export type PathwayParticipant = {
  reaction_id: string;
  side: "left" | "right";
  source_name: string | null;
  chebi_id: string | null;
  stoichiometric_coefficient: number | null;
  structure_status: string;
  participant_role: string;
};

const currencyNames = new Set([
  "h+", "h(+)" , "h2o", "water", "o2", "oxygen", "co2", "carbon dioxide",
  "atp", "adp", "amp", "gtp", "gdp", "utp", "udp", "nad+", "nad(+)",
  "nadh", "nadp+", "nadp(+)", "nadph", "fad", "fadh2", "coa", "coenzyme a",
  "phosphate", "orthophosphate", "diphosphate", "pyrophosphate",
]);

function plainName(value: string | null): string {
  return (value ?? "").replace(/<[^>]+>/g, "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function evaluateDirection(
  requested: RequestedDirection,
  coreDirection: string | null,
  mappingStatus: string,
  directionRelation: string | null,
  coefficientsReconciled = true,
): { status: DirectionCheck; reason: string } {
  if (mappingStatus !== "EXACT_NATIVE" && mappingStatus !== "DIRECTIONAL_NATIVE") {
    return { status: mappingStatus === "NOT_MAPPED" || mappingStatus === "CONTEXT_ONLY" ? "NO_EXACT_MODEL_MAPPING" : "INSUFFICIENT", reason: "No accepted exact chemistry with a checkable direction in this fixed model." };
  }
  if (!coefficientsReconciled) return { status: "INSUFFICIENT", reason: "The current reaction equation and stored participant coefficients are not reconciled." };
  if (requested === "unspecified") return { status: "INSUFFICIENT", reason: "Pathway step direction was not specified." };
  if (directionRelation === "BOTH_REVERSIBLE" || directionRelation === "HOST_REVERSIBLE") {
    return { status: "SUPPORTED_IN_MODEL_RECORD", reason: "The fixed model reaction was recorded as reversible; this is not flux feasibility." };
  }
  if (directionRelation === "SAME" || directionRelation === "REVERSE") {
    // REVERSE is an opposite stored equation orientation whose allowed flux
    // was transformed into the same *core* direction by the frozen mapper.
    const allowed = coreDirection === "=>" ? "forward" : coreDirection === "<=" ? "reverse" : null;
    if (!allowed) return { status: "INSUFFICIENT", reason: "The core direction cannot be reduced to one unambiguous displayed-equation direction." };
    return requested === allowed
      ? { status: "SUPPORTED_IN_MODEL_RECORD", reason: "Requested direction agrees with the frozen model-bound relation in the core equation frame." }
      : { status: "CONFLICTS_WITH_MODEL_RECORD", reason: "Requested direction opposes the frozen model-bound relation in the core equation frame." };
  }
  return { status: "INSUFFICIENT", reason: `${directionRelation ?? "Missing"} does not retain enough orientation/bound detail for this requested direction.` };
}

export function classifyModelGap(mappingStatus: string, direction: DirectionCheck): ModelGapCheck {
  if (mappingStatus === "NOT_MAPPED") return "MODEL_NO_EXACT_MATCH";
  if (mappingStatus === "CONTEXT_ONLY") return "CONTEXT_ONLY_NO_NATIVE_MATCH";
  if (mappingStatus !== "EXACT_NATIVE" && mappingStatus !== "DIRECTIONAL_NATIVE") return "INSUFFICIENT";
  if (direction === "CONFLICTS_WITH_MODEL_RECORD") return "DIRECTION_CONFLICT";
  if (direction !== "SUPPORTED_IN_MODEL_RECORD") return "INSUFFICIENT";
  return "MODEL_NATIVE_CANDIDATE";
}

export function evaluateAdjacentContinuity(
  from: PathwayParticipant[],
  to: PathwayParticipant[],
  fromDirection: RequestedDirection,
  toDirection: RequestedDirection,
  coefficientsReconciled: boolean,
): { status: ContinuityCheck; shared: Array<{ chebi_id: string; name: string }>; reason: string } {
  if (fromDirection === "unspecified" || toDirection === "unspecified") {
    return { status: "INSUFFICIENT", shared: [], reason: "Both step directions must be declared to identify products and substrates." };
  }
  if (!coefficientsReconciled) {
    return { status: "INSUFFICIENT", shared: [], reason: "At least one reaction has insufficient coefficient evidence." };
  }
  const products = from.filter((row) => row.side === (fromDirection === "forward" ? "right" : "left"));
  const substrates = to.filter((row) => row.side === (toDirection === "forward" ? "left" : "right"));
  if (!products.length || !substrates.length || [...products, ...substrates].some((row) => !row.chebi_id || !row.stoichiometric_coefficient || row.stoichiometric_coefficient <= 0)) {
    return { status: "INSUFFICIENT", shared: [], reason: "Participant identity or coefficient is incomplete." };
  }
  const byId = new Map(substrates.map((row) => [row.chebi_id!, row]));
  const shared = products.filter((row) => byId.has(row.chebi_id!)).map((row) => ({
    chebi_id: row.chebi_id!, name: row.source_name ?? row.chebi_id!,
    main: row.participant_role.startsWith("main_") && byId.get(row.chebi_id!)!.participant_role.startsWith("main_")
      && row.structure_status === "complete" && byId.get(row.chebi_id!)!.structure_status === "complete"
      && !currencyNames.has(plainName(row.source_name)) && !currencyNames.has(plainName(byId.get(row.chebi_id!)!.source_name)),
  }));
  const main = shared.filter((row) => row.main);
  if (main.length) return { status: "POSSIBLE_DIRECT_CHEMICAL_LINK", shared: main.map(({ chebi_id, name }) => ({ chebi_id, name })), reason: "Exact ChEBI identity links a displayed product to the next displayed substrate; compartment, transport and flux are unverified." };
  if ([...products, ...substrates].some((row) => row.participant_role.startsWith("main_") && row.structure_status !== "complete")) {
    return { status: "INSUFFICIENT", shared: [], reason: "A main participant has a generic or missing structure, so absence of an exact ChEBI link cannot be interpreted." };
  }
  if (shared.length) return { status: "CURRENCY_ONLY_LINK", shared: shared.map(({ chebi_id, name }) => ({ chebi_id, name })), reason: "Only currency/cofactor or non-main participants overlap; this is not a pathway connection." };
  return { status: "NO_DIRECT_MAIN_PARTICIPANT_LINK", shared: [], reason: "No exact ChEBI product–substrate overlap was found between these adjacent steps; this does not rule out an indirect route." };
}
