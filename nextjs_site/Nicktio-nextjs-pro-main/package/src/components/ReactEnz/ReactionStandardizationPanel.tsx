import Badge from "@/components/ReactEnz/Badge";
import ExternalDbLink from "@/components/ReactEnz/ExternalDbLink";
import { REACTENZDB_RELEASE } from "@/lib/release";
import type {
  CrossDatabaseMapping,
  ReactionBalance,
  ReactionStandardizationBundle,
} from "@/lib/reaction-standardization";

export default function ReactionStandardizationPanel({ bundle }: { bundle: ReactionStandardizationBundle }) {
  const { standardization, participants, balances, cross_database_mappings: mappings, conflicts, atom_mappings: atomMappings } = bundle;
  const exactMappings = mappings.filter((mapping) => mapping.chemistry_equivalence === "exact_normalized_identity").length;
  const manualReview = conflicts.filter((conflict) => conflict.requires_manual_review).length;

  return (
    <div className="grid gap-8">
      <p className="text-sm leading-7 text-muted">Counts below cover the currently available public records.</p>
      <div className="border-y border-border py-5 dark:border-dark_border">
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4 xl:divide-x xl:divide-border dark:xl:divide-dark_border">
          <Metric label="Standardization" value={pretty(standardization.standardization_status)} tone={tone(standardization.standardization_status)} />
          <Metric label="Structure scope" value={pretty(standardization.structure_completeness_status)} tone={tone(standardization.structure_completeness_status)} />
          <Metric label="Exact database identities" value={`${exactMappings}/${mappings.length}`} tone={exactMappings ? "green" : "slate"} />
          <Metric label="Manual-review conflicts" value={manualReview.toLocaleString()} tone={manualReview ? "amber" : "green"} />
        </div>
      </div>

      <div className="grid min-w-0 gap-7 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="min-w-0">
          <Eyebrow>Normalized identity</Eyebrow>
          <h3 className="mt-2 text-22">Two identities, one explicit direction model</h3>
          <p className="mt-2 text-sm leading-7 text-muted dark:text-white/60">
            Directional keys preserve the displayed substrate/product sides. Directionless keys collapse the forward and reverse forms; the no-stereo keys support explicitly labelled connectivity-only comparisons.
          </p>
          <dl className="mt-5 divide-y divide-border border-y border-border text-sm dark:divide-dark_border dark:border-dark_border">
            <IdentityRow label="Normalized direction" value={pretty(standardization.normalized_direction)} />
            <IdentityRow label="Reversibility" value={pretty(standardization.reversibility_status)} />
          </dl>
          <details className="group mt-4 border-b border-border pb-4 dark:border-dark_border">
            <summary className="cursor-pointer list-none text-sm font-black text-primary transition group-open:mb-3">Show canonical reaction SMILES</summary>
            <code className="block overflow-x-auto whitespace-pre-wrap break-all bg-hero-bg p-4 text-xs leading-6 text-midnight_text dark:bg-dark_b dark:text-white">
              {standardization.canonical_reaction_smiles ?? "Canonical reaction SMILES unavailable."}
            </code>
          </details>
        </div>

        <div className="min-w-0">
          <Eyebrow>Balance interpretation</Eyebrow>
          <h3 className="mt-2 text-22">Full reaction and core transformation</h3>
          <p className="mt-2 text-sm leading-7 text-muted dark:text-white/60">
            Full balance uses all represented participants. Core balance excludes only explicitly classified currency and cofactor participants and must not be read as a replacement for the full equation.
          </p>
          <div className="mt-5 divide-y divide-border border-y border-border dark:divide-dark_border dark:border-dark_border">
            {balances.map((balance) => <BalanceRow balance={balance} key={balance.balance_result_id} />)}
          </div>
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Eyebrow>Normalized participants</Eyebrow>
            <h3 className="mt-2 text-22">Stoichiometry, role, charge, and stereo state</h3>
          </div>
          <span className="text-sm font-semibold text-muted">{participants.length} participant records</span>
        </div>
        <div className="mt-5 overflow-x-auto border-y border-border dark:border-dark_border">
          <table className="w-full min-w-[1120px] text-left text-sm">
            <thead className="bg-hero-bg text-xs uppercase tracking-[0.1em] text-muted dark:bg-dark_b">
              <tr><th className="px-4 py-3">Side</th><th className="px-4 py-3">Coefficient</th><th className="px-4 py-3">Participant</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Formula / charge</th><th className="px-4 py-3">Structure</th><th className="px-4 py-3">Stereo</th></tr>
            </thead>
            <tbody className="divide-y divide-border dark:divide-dark_border">
              {participants.map((participant) => (
                <tr className="align-top transition hover:bg-hero-bg/60 dark:hover:bg-dark_b" key={participant.participant_id}>
                  <td className="px-4 py-3"><Badge tone={participant.side === "left" ? "blue" : "green"}>{participant.side}</Badge></td>
                  <td className="px-4 py-3"><div className="font-black text-midnight_text dark:text-white">{participant.stoichiometric_coefficient ?? 1}</div><div className="mt-1 text-xs text-muted">{pretty(participant.stoichiometry_status)}</div></td>
                  <td className="px-4 py-3"><div className="max-w-xs font-bold text-midnight_text dark:text-white">{participant.source_name ?? participant.source_compound_id ?? "Unnamed participant"}</div><div className="mt-1 flex flex-wrap gap-2 text-xs"><ExternalDbLink db="chebi" value={participant.chebi_id} />{participant.mnx_compound_id ? <ExternalDbLink db="mnx_compound" value={participant.mnx_compound_id} /> : null}</div></td>
                  <td className="px-4 py-3"><Badge tone={participant.role_confidence && participant.role_confidence >= 0.8 ? "green" : "slate"}>{pretty(participant.participant_role)}</Badge><div className="mt-1 text-xs text-muted">confidence {formatNumber(participant.role_confidence)}</div></td>
                  <td className="px-4 py-3"><div className="font-mono text-xs font-bold text-midnight_text dark:text-white">{participant.molecular_formula ?? "unknown"}</div><div className="mt-1 text-xs text-muted">formal charge {participant.formal_charge ?? "unknown"}</div></td>
                  <td className="px-4 py-3"><Badge tone={tone(participant.structure_status)}>{pretty(participant.structure_status)}</Badge></td>
                  <td className="px-4 py-3"><Badge tone={tone(participant.stereo_status)}>{pretty(participant.stereo_status)}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid min-w-0 gap-8 2xl:grid-cols-[minmax(0,1.15fr)_minmax(24rem,1fr)]">
        <div className="min-w-0">
          <Eyebrow>Cross-database identity</Eyebrow>
          <h3 className="mt-2 text-22">Mappings remain evidence, not silent equivalence</h3>
          <p className="mt-2 text-sm leading-7 text-muted dark:text-white/60">Confidence tiers combine identifier provenance with normalized participants, direction, stoichiometry, and stereo agreement.</p>
          <div className="mt-5 overflow-x-auto border-y border-border dark:border-dark_border">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="bg-hero-bg text-xs uppercase tracking-[0.1em] text-muted dark:bg-dark_b"><tr><th className="px-4 py-3">Database record</th><th className="px-4 py-3">Confidence</th><th className="px-4 py-3">Chemistry</th><th className="px-4 py-3">Direction / stereo</th><th className="px-4 py-3">Review state</th></tr></thead>
              <tbody className="divide-y divide-border dark:divide-dark_border">
                {mappings.map((mapping) => <MappingRow mapping={mapping} key={mapping.mapping_id} />)}
              </tbody>
            </table>
          </div>
        </div>

        <div className="min-w-0">
          <Eyebrow>Atom mapping and reaction centre</Eyebrow>
          <h3 className="mt-2 text-22">Source-matched and quality-gated maps</h3>
          <p className="mt-2 text-sm leading-7 text-muted dark:text-white/60">EnzymeMap records and RXNMapper predictions remain explicitly separated. Predicted maps appear here only after calibrated correspondence, element, mass-balance, rearrangement, confidence, and reaction-centre checks.</p>
          <div className="mt-5 divide-y divide-border border-y border-border dark:divide-dark_border dark:border-dark_border">
            {atomMappings.length ? atomMappings.map((mapping) => (
              <div className="py-5" key={mapping.atom_mapping_id}>
                <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="font-black text-midnight_text dark:text-white">{mapping.mapping_source}</div><div className="mt-1 text-xs text-muted">{pretty(String(mapping.validation_flags.match_basis ?? mapping.validation_flags.quality_tier ?? mapping.mapping_method))}</div></div><div className="flex flex-wrap gap-2">{mapping.mapping_source.includes("RXNMapper") ? <Badge tone="blue">predicted</Badge> : <Badge tone="slate">source matched</Badge>}<Badge tone={tone(mapping.mapping_status)}>{pretty(mapping.mapping_status)}</Badge></div></div>
                <dl className="mt-4 grid grid-cols-2 gap-4 text-sm"><SmallMeta label="Mapped atoms" value={mapping.mapped_atom_count} /><SmallMeta label="Conserved fraction" value={formatNumber(mapping.conserved_atom_fraction)} /><SmallMeta label="Mapping confidence" value={formatNumber(mapping.mapping_confidence)} /><SmallMeta label="Unmapped atoms" value={mapping.unmapped_atom_count} /></dl>
                {mapping.reaction_centre ? <div className="mt-4 border-l-2 border-primary pl-4 text-sm"><div className="font-black text-midnight_text dark:text-white">Reaction centre: {pretty(mapping.reaction_centre.extraction_status)}</div><div className="mt-2 text-muted">Changed atoms {mapping.reaction_centre.changed_atom_maps.length}; broken bonds {mapping.reaction_centre.broken_bonds.length}; formed bonds {mapping.reaction_centre.formed_bonds.length}; changed bonds {mapping.reaction_centre.changed_bonds.length}.</div>{mapping.reaction_centre.core_transformation_smarts ? <code className="mt-2 block break-all text-xs text-primary">{mapping.reaction_centre.core_transformation_smarts}</code> : null}</div> : null}
                <details className="group mt-4"><summary className="cursor-pointer list-none text-sm font-black text-primary transition group-open:mb-3">Show mapping detail</summary>{mapping.public_structure_detail && mapping.atom_mapped_reaction_smiles ? <code className="block max-h-64 overflow-auto whitespace-pre-wrap break-all bg-hero-bg p-4 text-xs leading-6 dark:bg-dark_b">{mapping.atom_mapped_reaction_smiles}</code> : <p className="bg-hero-bg p-4 text-xs leading-6 text-muted dark:bg-dark_b">The mapping conclusion is public, but this source-derived structure string is not redistributed under the current release scope.</p>}</details>
              </div>
            )) : <p className="py-5 text-sm leading-7 text-muted">No source-matched or predicted atom mapping passed the current quality gate for this reaction.</p>}
          </div>
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-end justify-between gap-3"><div><Eyebrow>Conflict layer</Eyebrow><h3 className="mt-2 text-22">Differences are retained and explained</h3></div><Badge tone={conflicts.length ? "amber" : "green"}>{conflicts.length ? `${conflicts.length} recorded` : "no recorded conflict"}</Badge></div>
        {conflicts.length ? <div className="mt-5 divide-y divide-border border-y border-border dark:divide-dark_border dark:border-dark_border">{conflicts.map((conflict) => (
          <details className="group py-4" key={conflict.conflict_id} open={conflict.requires_manual_review === 1}>
            <summary className="cursor-pointer list-none"><div className="flex flex-wrap items-center justify-between gap-3"><div className="font-black text-midnight_text dark:text-white">{pretty(conflict.conflict_type)}</div><div className="flex gap-2"><Badge tone={conflict.conflict_severity === "error" ? "amber" : "slate"}>{conflict.conflict_severity}</Badge>{conflict.requires_manual_review ? <Badge tone="amber">manual review</Badge> : null}</div></div><p className="mt-2 text-sm leading-6 text-muted">{conflict.explanation}</p></summary>
            <dl className="mt-4 grid gap-3 text-xs md:grid-cols-2"><IdentityRow label="ReactEnzDB representation" value={conflict.reactenz_value} mono /><IdentityRow label="External representation" value={conflict.external_value ?? "Redacted or not structurally available"} mono /></dl>
          </details>
        ))}</div> : <p className="mt-4 border-y border-border py-5 text-sm text-muted dark:border-dark_border">No eligible cross-database conflict is shown under the current access policy.</p>}
        <p className="mt-4 text-xs leading-6 text-muted">Release {REACTENZDB_RELEASE.version}. {bundle.release.publication_scope}</p>
      </div>
    </div>
  );
}

function BalanceRow({ balance }: { balance: ReactionBalance }) {
  const delta = Object.entries(balance.element_delta).map(([element, value]) => `${element} ${signed(value)}`).join(", ") || "none";
  const missingCount = balance.missing_participants.length;
  return (
    <div className="grid min-w-0 gap-3 py-4">
      <div className="min-w-0">
        <div className="font-black text-midnight_text dark:text-white">{balance.balance_context === "full_explicit" ? "Full explicit equation" : "Core transformation"}</div>
        <div className="mt-1 break-words text-xs leading-5 text-muted">Element delta: {delta}; charge delta: {balance.charge_delta === null ? "unknown" : signed(balance.charge_delta)}</div>
        {missingCount ? <div className="mt-1 text-xs leading-5 text-amber-700">{missingCount} generic or missing participant structure{missingCount === 1 ? "" : "s"} prevent a definitive mass or charge result.</div> : null}
      </div>
      <div className="flex min-w-0 flex-wrap gap-2">
        <Badge tone={tone(balance.mass_balance_status)}>mass {balanceLabel(balance.mass_balance_status)}</Badge>
        <Badge tone={tone(balance.charge_balance_status)}>charge {balanceLabel(balance.charge_balance_status)}</Badge>
      </div>
    </div>
  );
}

function MappingRow({ mapping }: { mapping: CrossDatabaseMapping }) {
  return <tr className="align-top transition hover:bg-hero-bg/60 dark:hover:bg-dark_b"><td className="px-4 py-3"><div className="text-xs font-black uppercase tracking-[0.1em] text-muted">{mapping.target_db}</div><div className="mt-1">{mappingLink(mapping)}</div></td><td className="px-4 py-3"><Badge tone={mapping.confidence_tier === "A" ? "green" : mapping.confidence_tier === "D" ? "amber" : "blue"}>tier {mapping.confidence_tier}</Badge><div className="mt-1 text-xs text-muted">{formatNumber(mapping.mapping_confidence)}</div></td><td className="px-4 py-3"><Badge tone={tone(mapping.chemistry_equivalence)}>{pretty(mapping.chemistry_equivalence)}</Badge><div className="mt-1 text-xs text-muted">{pretty(mapping.participant_relation)}; stoichiometry {pretty(mapping.stoichiometry_relation)}</div></td><td className="px-4 py-3"><div className="font-semibold text-midnight_text dark:text-white">{pretty(mapping.direction_relation)}</div><div className="mt-1 text-xs text-muted">stereo {pretty(mapping.stereo_relation)}</div></td><td className="px-4 py-3"><Badge tone={mapping.review_status.includes("required") ? "amber" : "slate"}>{pretty(mapping.review_status)}</Badge>{mapping.conflict_explanation ? <p className="mt-2 max-w-sm text-xs leading-5 text-muted">{mapping.conflict_explanation}</p> : null}</td></tr>;
}

function mappingLink(mapping: CrossDatabaseMapping) {
  const db = mapping.target_db === "Rhea" ? "rhea" : mapping.target_db === "KEGG" ? "kegg_reaction" : mapping.target_db === "MetaCyc" ? "metacyc_reaction" : mapping.target_db === "MetaNetX" ? "mnx_reaction" : null;
  return db ? <ExternalDbLink db={db} value={mapping.target_reaction_id} /> : <span className="font-mono text-xs">{mapping.target_reaction_id}</span>;
}

function Metric({ label, value, tone: metricTone }: { label: string; value: string; tone: "blue" | "green" | "amber" | "slate" }) { return <div className="xl:px-5 first:xl:pl-0"><div className="text-xs font-black uppercase tracking-[0.12em] text-muted">{label}</div><div className="mt-2 text-xl font-black text-midnight_text dark:text-white">{value}</div><div className="mt-2"><Badge tone={metricTone}>{metricTone === "green" ? "verified" : metricTone === "amber" ? "review" : "reported"}</Badge></div></div>; }
function Eyebrow({ children }: { children: React.ReactNode }) { return <div className="max-w-full text-xs font-black uppercase tracking-[0.12em] text-primary">{children}</div>; }
function IdentityRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) { return <div className="grid gap-2 py-3 md:grid-cols-[190px_1fr]"><dt className="text-xs font-black uppercase tracking-[0.1em] text-muted">{label}</dt><dd className={`min-w-0 ${mono ? "overflow-x-auto whitespace-nowrap font-mono text-xs" : "font-semibold"} text-midnight_text dark:text-white`}>{value ?? "not available"}</dd></div>; }
function SmallMeta({ label, value }: { label: string; value: React.ReactNode }) { return <div><dt className="text-xs font-black uppercase tracking-[0.1em] text-muted">{label}</dt><dd className="mt-1 font-bold text-midnight_text dark:text-white">{value ?? "unknown"}</dd></div>; }
function pretty(value: string | null | undefined) { return value ? value.replaceAll("_", " ") : "not available"; }
function balanceLabel(value: string) {
  if (value === "unknown_missing_structure") return "unknown";
  if (value === "hydrogen_only_imbalance") return "H-only imbalance";
  return pretty(value);
}
function formatNumber(value: number | null | undefined) { return value === null || value === undefined ? "unknown" : Number(value).toFixed(3).replace(/0+$/, "").replace(/\.$/, ""); }
function signed(value: number) { return value > 0 ? `+${value}` : String(value); }
function tone(value: string): "blue" | "green" | "amber" | "slate" { const v = value.toLowerCase(); if (v.includes("balanced") && !v.includes("unbalanced") || v.includes("complete") && !v.includes("incomplete") || v.includes("exact") || v === "valid" || v === "validated_predicted" || v === "extracted") return "green"; if (v.includes("conflict") || v.includes("unbalanced") || v.includes("error") || v.includes("missing")) return "amber"; if (v.includes("partial") || v.includes("unknown") || v.includes("incomplete")) return "slate"; return "blue"; }
