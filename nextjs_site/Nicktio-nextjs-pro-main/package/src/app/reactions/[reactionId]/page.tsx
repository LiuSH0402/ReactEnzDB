import { formatExperimentalConditions } from "@/lib/experimentalConditions";
import { presentAttributeValue } from "@/lib/dataPresentation";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { annotationCoverageLabel, structureCoverageLabel } from "@/lib/qualitySemantics";
import Badge from "@/components/ReactEnz/Badge";
import DetailJumpNav from "@/components/ReactEnz/DetailJumpNav";
import AttributeExternalCheck, { buildAttributeCheckMap } from "@/components/ReactEnz/AttributeExternalCheck";
import DataStatus, { displayValue, type DataStatusKind } from "@/components/ReactEnz/DataStatus";
import DetailDownloadLink from "@/components/ReactEnz/DetailDownloadLink";
import ExternalDbLink, { ExternalDbLinks, externalDbUrl } from "@/components/ReactEnz/ExternalDbLink";
import KineticExternalCheck, { buildKineticCheckMap } from "@/components/ReactEnz/KineticExternalCheck";
import McsaMechanismPanel from "@/components/ReactEnz/McsaMechanismPanel";
import SpecificReactionEvidence from "@/components/ReactEnz/SpecificReactionEvidence";
import ExperimentalExpressionEvidence from "@/components/ReactEnz/ExperimentalExpressionEvidence";
import ReactionStandardizationPanel from "@/components/ReactEnz/ReactionStandardizationPanel";
import { getReactionEvidenceBundle } from "@/lib/evidence-release";
import { getExpressionEvidenceForReaction } from "@/lib/expressionEvidence";
import { getReactionStandardizationBundle } from "@/lib/reaction-standardization";
import { getLocalMappingsForReaction } from "@/lib/hostMappingLocalPreview";
import {
  getReaction,
  getReactionChassis,
  getReactionCompounds,
  getReactionEnzymes,
  getReactionAttributeEvidences,
  getReactionAttributeExternalChecks,
  getReactionKineticExternalChecks,
  getReactionKinetics,
  formatKineticParameterType,
  getReactionMcsaCompounds,
  getReactionMcsaEntries,
  getReactionMcsaMechanisms,
  getReactionMcsaMechanismSteps,
  getReactionMcsaReferences,
  getReactionMcsaResidues,
  getReactionPathways,
  getReactionReferences,
  getReactionXrefs,
  imageUrl,
  type AttributeEvidenceRow,
  type AttributeExternalCheckRow,
  type CompoundParticipant,
  type KineticExternalCheckRow,
  type KineticRow,
  type ReferenceRow,
  type XrefRow,
} from "@/lib/reactenzdb";
import { getReactionRetrosynthesisLinks, type RetrosynthesisRuleMatch } from "@/lib/retrosynthesis";
import { getReactionSequenceClusters } from "@/lib/sequenceClusters";
import {
  getReactionCandidateComparison,
  type RankedPathwayCandidate,
} from "@/lib/pathwayExport";

export const revalidate = 60;

type PageProps = {
  params: Promise<{ reactionId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { reactionId } = await params;
  const reaction = getReaction(reactionId);
  if (!reaction) notFound();
  const equation = reaction.reaction_equation_display?.slice(0, 110);
  return {
    title: `${reaction.reactenz_reaction_id} reaction`,
    description: equation ? `${equation}. Enzyme candidates, source organisms, kinetics, structures, host-model context, and evidence in ReactEnzDB.` : `Reaction ${reaction.reactenz_reaction_id} and connected enzyme candidates in ReactEnzDB.`,
    alternates: { canonical: `/reactions/${encodeURIComponent(reaction.reactenz_reaction_id)}` },
  };
}

export default async function ReactionDetailPage({ params, searchParams }: PageProps) {
  const { reactionId } = await params;
  const reaction = getReaction(reactionId);
  if (!reaction) notFound();

  const compounds = getReactionCompounds(reaction.reaction_id);
  const enzymes = getReactionEnzymes(reaction.reaction_id, 80);
  const chassisRecords = getReactionChassis(reaction.reaction_id);
  const filters = (await searchParams) ?? {};
  const requestedPage = Number(Array.isArray(filters.kineticsPage) ? filters.kineticsPage[0] : filters.kineticsPage);
  const kineticPageSize = 200;
  const kineticPages = Math.max(1, Math.ceil(Number(reaction.kinetics_count ?? 0) / kineticPageSize));
  const kineticPage = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, kineticPages) : 1;
  const kineticOffset = (kineticPage - 1) * kineticPageSize;
  const kinetics = getReactionKinetics(reaction.reaction_id, kineticPageSize, kineticOffset);
  const kineticPageHref = (page: number) => `/reactions/${encodeURIComponent(reaction.reactenz_reaction_id)}?kineticsPage=${page}#kinetics`;
  const kineticExternalChecks = getReactionKineticExternalChecks(reaction.reaction_id, 100);
  const kineticExternalCheckMap = buildKineticCheckMap(kineticExternalChecks);
  const xrefs = getReactionXrefs(reaction.reaction_id);
  const references = getReactionReferences(reaction.reaction_id, 80);
  const attributeEvidences = getReactionAttributeEvidences(reaction.reaction_id, 100);
  const attributeExternalChecks = getReactionAttributeExternalChecks(reaction.reaction_id, 100);
  const attributeExternalCheckMap = buildAttributeCheckMap(attributeExternalChecks);
  const pathways = getReactionPathways(reaction.reaction_id);
  const mnxReactionIds = xrefs.filter((xref) => xref.xref_db === "mnx_reaction").map((xref) => xref.xref_value).join(";");
  const mcsaEntries = getReactionMcsaEntries(reaction.reaction_id, 12);
  const mcsaResidues = getReactionMcsaResidues(reaction.reaction_id, 160);
  const mcsaMechanisms = getReactionMcsaMechanisms(reaction.reaction_id, 20);
  const mcsaSteps = getReactionMcsaMechanismSteps(reaction.reaction_id, 180);
  const mcsaCompounds = getReactionMcsaCompounds(reaction.reaction_id, 120);
  const mcsaReferences = getReactionMcsaReferences(reaction.reaction_id, 160);
  const retrosynthesisLinks = getReactionRetrosynthesisLinks(reaction, 40);
  const localHostMappings = getLocalMappingsForReaction(reaction.reaction_id);
  const recordedHostMappings = localHostMappings?.filter((row) => row.mapping_status !== "NOT_MAPPED") ?? [];
  const candidateComparisons = getReactionCandidateComparison(reaction.reaction_id, 50);
  const reactionEvidence = getReactionEvidenceBundle(reaction.reactenz_reaction_id, { limit: 30, pairLimit: 80 });
  const experimentalExpression = getExpressionEvidenceForReaction(reaction.reaction_id, reaction.reactenz_reaction_id, 12);
  const sequenceFamilies = getReactionSequenceClusters(reaction.reaction_id, 60, 30);
  const standardizationBundle = getReactionStandardizationBundle(reaction.reaction_id);
  const left = compounds.filter((compound) => compound.side === "left");
  const right = compounds.filter((compound) => compound.side === "right");
  const organismCounts = new Map<string, number>();
  const organismIds = new Map<string, string>();
  const chassisCounts = new Map<string, { id: string | null; count: number }>();

  for (const record of chassisRecords) {
    if (!record.chassis_label || !record.reactenz_enzyme_id) continue;
    if (record.chassis_label) {
      const current = chassisCounts.get(record.chassis_label) ?? { id: record.reactenz_chassis_id, count: 0 };
      current.count += 1;
      if (!current.id && record.reactenz_chassis_id) current.id = record.reactenz_chassis_id;
      chassisCounts.set(record.chassis_label, current);
    }
    if (record.organism) {
      organismCounts.set(record.organism, (organismCounts.get(record.organism) ?? 0) + 1);
      if (record.reactenz_organism_id) organismIds.set(record.organism, record.reactenz_organism_id);
    }
  }

  for (const enzyme of enzymes) {
    if (enzyme.organism && !organismCounts.has(enzyme.organism)) {
      organismCounts.set(enzyme.organism, 1);
    }
    if (enzyme.organism && enzyme.reactenz_organism_id) organismIds.set(enzyme.organism, enzyme.reactenz_organism_id);
  }

  const organismSummary = Array.from(organismCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const chassisSummary = Array.from(chassisCounts.entries()).sort((a, b) => b[1].count - a[1].count).slice(0, 12);
  const richnessScore = Number(reaction.evidence_score ?? 0);
  const richnessTier = storedRichnessTier(reaction.evidence_tier, richnessScore);
  const evidenceProfile = buildReactionEvidenceProfile({
    attributeEvidences,
    chassisRecordCount: chassisRecords.length,
    enzymes,
    kinetics,
    references,
    structureComplete: Boolean(reaction.all_participants_have_smiles),
    xrefs,
    storedScore: richnessScore,
    storedTier: richnessTier,
  });
  const fullBalance = standardizationBundle?.balances.find((balance) => balance.balance_context === "full_explicit");
  const standardizationConflicts = standardizationBundle?.conflicts.length ?? 0;
  const hasReactionEvidence = Boolean((reactionEvidence.release.available && reactionEvidence.summary) || reactionEvidence.literature_records.length);
  const navSections = [
    { id: "overview", label: "Overview" },
    ...(compounds.length ? [{ id: "participants", label: "Participants" }] : []),
    ...(standardizationBundle ? [{ id: "standardization", label: "Identity & conflicts" }] : []),
    ...(candidateComparisons.length || enzymes.length ? [{ id: "candidate-comparison", label: "Candidate comparison" }] : []),
    ...(hasReactionEvidence ? [{ id: "reaction-evidence", label: "Reaction-specific evidence" }] : []),
    ...(sequenceFamilies.length ? [{ id: "sequence-families", label: "Sequence families" }] : []),
    ...(kinetics.length ? [{ id: "kinetics", label: "Kinetics" }] : []),
    ...(experimentalExpression.length ? [{ id: "experimental-expression", label: "Expression evidence" }] : []),
    { id: "host-context", label: "Host context" },
    ...(organismSummary.length || chassisSummary.length ? [{ id: "relationships", label: "Source & annotations" }] : []),
    ...(mcsaEntries.length ? [{ id: "mechanism", label: "Mechanism context" }] : []),
    ...(pathways.length ? [{ id: "pathways", label: "Pathways" }] : []),
    ...(retrosynthesisLinks.length ? [{ id: "retrosynthesis", label: "Retrosynthesis" }] : []),
    { id: "evidence", label: "Evidence & links" },
  ];

  return (
    <main className="reactenz-detail reactenz-container py-10">
      <div className="grid gap-8 lg:grid-cols-[230px_1fr]">
        <DetailJumpNav backHref="/reactions" backLabel="Reactions" label="Reaction record" sections={navSections} />

        <div className="min-w-0">
          <section id="overview" className="reactenz-detail-overview scroll-mt-8 border-b border-border pb-8 dark:border-dark_border">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                <Badge tone={standardizationBundle?.standardization.structure_completeness_status === "complete" ? "green" : "slate"}>
                  {standardizationBundle
                    ? standardizationBundle.standardization.structure_completeness_status.replaceAll("_", " ")
                    : reaction.all_participants_have_smiles ? "SMILES complete" : "partial structure"}
                </Badge>
                <Badge tone="slate">Direction {reaction.reaction_direction ?? "not curated"}</Badge>
                {fullBalance ? <Badge tone={fullBalance.mass_balance_status === "balanced" ? "green" : "amber"}>mass {fullBalance.mass_balance_status.replaceAll("_", " ")}</Badge> : null}
                {standardizationBundle ? <Badge tone={standardizationConflicts ? "amber" : "green"}>{standardizationConflicts} mapping conflicts</Badge> : null}
                <Badge tone={confidenceTone(richnessScore)}>{annotationCoverageLabel(richnessTier)} · {richnessScore}/100</Badge>
              </div>
              <DetailDownloadLink type="reaction-detail" id={reaction.reactenz_reaction_id} />
            </div>
            <p className="reactenz-eyebrow">{reaction.reactenz_reaction_id}</p>
            <h1 className="reactenz-detail-title mb-3">{reaction.reaction_equation_display ?? reaction.reactenz_reaction_id}</h1>
            {reaction.reaction_equation_raw && reaction.reaction_equation_raw !== reaction.reaction_equation_display ? (
              <p className="text-sm text-muted">Raw equation: {reaction.reaction_equation_raw}</p>
            ) : null}
            <dl className="mt-7 grid gap-x-8 gap-y-4 text-sm md:grid-cols-2 xl:grid-cols-4">
              <Meta label="Internal reaction ID" value={reaction.reaction_id} />
              <Meta label="Participants" value={reaction.participant_count} />
              <Meta label="SMILES coverage" value={`${reaction.smiles_count}/${reaction.participant_count}`} />
              <Meta label="Association records" value={reaction.enzyme_pair_count} />
              <Meta label="Unique enzymes" value={reaction.enzyme_count} />
              <Meta label="Kinetic records" value={reaction.kinetics_count} />
              <Meta label="Evidence level" value={reaction.evidence_level} status="not_curated" />
              <Meta label="Structure coverage" value={structureCoverageLabel(reaction.dataset_level)} status="not_curated" />
            </dl>
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <ExternalId label="EC" value={<ExternalDbLinks db="ec" value={reaction.ec_number} />} />
              <ExternalId label="Rhea" value={<ExternalDbLink db="rhea" value={reaction.rhea_id} />} />
              <ExternalId label="KEGG" value={<ExternalDbLink db="kegg_reaction" value={reaction.kegg_reaction_id} />} />
              <ExternalId label="MetaCyc" value={<ExternalDbLink db="metacyc_reaction" value={reaction.metacyc_reaction_id} />} />
              <ExternalId label="MNXref reaction" value={<ExternalDbLinks db="mnx_reaction" value={mnxReactionIds} />} />
            </div>
            <div className="mt-7 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <ConnectionCard
                href={candidateComparisons.length || enzymes.length ? "#candidate-comparison" : `/enzymes?reactionId=${encodeURIComponent(reaction.reactenz_reaction_id)}&sequence=false`}
                label="Candidate enzymes"
                value={reaction.enzyme_count}
              />
              <ConnectionCard
                href={organismSummary.length ? "#relationships" : "/organisms"}
                label="Source organisms"
                value={organismCounts.size}
              />
              <ConnectionCard
                href={chassisSummary.length ? "#relationships" : "/chassis"}
                label="Chassis annotations"
                value={chassisCounts.size}
              />
              <ConnectionCard
                href={kinetics.length ? "#kinetics" : "#evidence"}
                label="Kinetic evidence"
                value={reaction.kinetics_count}
              />
            </div>
          </section>

          {compounds.length ? (
            <Section id="participants" title="Participants And Structures">
              <div className="grid items-center gap-5 xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                <CompoundSide title="Reactants" compounds={left} />
                <div className="flex h-full items-center justify-center text-3xl font-semibold text-primary">{reaction.reaction_direction ?? "="}</div>
                <CompoundSide title="Products" compounds={right} />
              </div>
            </Section>
          ) : null}

          {standardizationBundle ? (
            <Section id="standardization" title="Normalized Reaction Identity And Cross-database Conflicts">
              <ReactionStandardizationPanel bundle={standardizationBundle} />
            </Section>
          ) : null}

          {candidateComparisons.length || enzymes.length ? (
            <Section id="candidate-comparison" title="Enzyme Candidate Evidence Table">
              <EnzymeCandidateEvidenceTable
                candidates={candidateComparisons}
                reactionId={reaction.reactenz_reaction_id}
                totalAssociated={reaction.enzyme_count ?? enzymes.length}
              />
            </Section>
          ) : null}

          {hasReactionEvidence ? (
            <Section id="reaction-evidence" title="Reaction-specific Enzyme Evidence">
              <SpecificReactionEvidence bundle={reactionEvidence} />
            </Section>
          ) : null}

          {sequenceFamilies.length ? (
            <Section id="sequence-families" title="Non-redundant Enzyme Candidate Families">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
                <p>NR90 compresses near-identical candidates while retaining reaction-specific evidence and taxonomic diversity. The representative is a starting point, not a catalytic-activity claim.</p>
                <div className="flex shrink-0 flex-wrap gap-3">
                  <Link className="rounded-lg bg-primary px-4 py-2 font-black text-white" href={`/sequence-families/candidates?reactionId=${encodeURIComponent(reaction.reactenz_reaction_id)}&mode=best-supported`}>Build candidate set →</Link>
                  <Link className="px-2 py-2 font-black text-primary" href="/sequence-families?threshold=90">Explore all families →</Link>
                </div>
              </div>
              <div className="overflow-x-auto rounded-2xl border border-border dark:border-dark_border">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead className="bg-hero-bg text-xs uppercase tracking-wider text-muted dark:bg-dark_b"><tr><th className="px-4 py-3">Representative</th><th className="px-4 py-3">Candidates</th><th className="px-4 py-3">Species / phyla</th><th className="px-4 py-3">Reaction evidence</th><th className="px-4 py-3">Structure / site</th><th className="px-4 py-3">Status</th></tr></thead>
                  <tbody className="divide-y divide-border dark:divide-dark_border">{sequenceFamilies.map((family) => (
                    <tr key={family.cluster_id}><td className="px-4 py-3"><Link className="font-black text-primary" href={`/enzymes/${encodeURIComponent(family.representative_enzyme_id)}`}>{family.representative_enzyme_id}</Link><div className="mt-1 max-w-[220px] truncate font-mono text-xs text-muted">{family.cluster_id}</div></td><td className="px-4 py-3 font-bold">{family.member_enzyme_count.toLocaleString()}</td><td className="px-4 py-3">{family.species_count} / {family.phylum_count}</td><td className="px-4 py-3">{family.experimental_supported_count} experimental · {family.kinetic_supported_count} kinetic</td><td className="px-4 py-3">{family.pdb_supported_count} PDB · {family.active_site_supported_count} site</td><td className="px-4 py-3"><Badge tone={family.underexplored ? "slate" : "green"}>{family.underexplored ? "underexplored" : "supported"}</Badge></td></tr>
                  ))}</tbody>
                </table>
              </div>
            </Section>
          ) : null}

          {kinetics.length ? (
            <Section id="kinetics" title="Kinetic Parameters">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-sm">
                <p className="text-muted">Showing {kineticOffset + 1}–{kineticOffset + kinetics.length} of {Number(reaction.kinetics_count).toLocaleString()} kinetic records.</p>
                {kineticPages > 1 ? (
                  <nav aria-label="Kinetic records pagination" className="flex flex-wrap items-center gap-4">
                    {kineticPage > 1 ? <Link className="font-bold text-primary" href={kineticPageHref(kineticPage - 1)}>Previous kinetics page</Link> : null}
                    <span>Page {kineticPage} of {kineticPages}</span>
                    {kineticPage < kineticPages ? <Link className="font-bold text-primary" href={kineticPageHref(kineticPage + 1)}>Next kinetics page</Link> : null}
                  </nav>
                ) : null}
              </div>
              <KineticTable kinetics={kinetics} checksByKineticId={kineticExternalCheckMap} />
            </Section>
          ) : null}

          {experimentalExpression.length ? (
            <Section id="experimental-expression" title="Expression Evidence">
              <ExperimentalExpressionEvidence bundles={experimentalExpression} title="Expression evidence linked through candidate enzymes" />
            </Section>
          ) : null}

          <Section id="host-context" title="Host Context">
            <div className="border-y border-border py-5 text-sm leading-7 dark:border-dark_border">
              <p className="font-bold text-midnight_text dark:text-white">Reaction × model-release status: {localHostMappings ? "unreviewed preview · not curated" : "not released"}</p>
              <p className="mt-2 text-muted">The release-qualified host mapping is under review. Hosts with no recorded model reaction are omitted. Omission is not biological absence, and a recorded mapping is not evidence that this reaction occurs in the organism.</p>
              {localHostMappings ? recordedHostMappings.length ? (
                <div className="mt-5 overflow-x-auto border-y border-border dark:border-dark_border" role="region" aria-label="Unreviewed host mapping preview">
                  <p className="py-3 text-sm text-muted">Fixed-model lookup, not yet manually reviewed. UNRESOLVED remains undecided.</p>
                  <table className="w-full min-w-[670px] text-left text-sm">
                    <thead><tr className="text-xs uppercase text-muted"><th className="py-2 pr-4">Host model</th><th className="py-2 pr-4">Recorded status</th><th className="py-2 pr-4">Model reaction</th><th className="py-2">Direction relation</th></tr></thead>
                    <tbody className="divide-y divide-border dark:divide-dark_border">{recordedHostMappings.map((row) => (
                      <tr key={row.release_id}>
                        <td className="py-2 pr-4"><Link className="font-semibold text-primary hover:underline" href={`/hosts/${row.host_id}`}>{row.scientific_name} · {row.strain}</Link><span className="block text-xs text-muted">{row.model_name}</span></td>
                        <td className="py-2 pr-4 font-mono">{row.mapping_status}</td>
                        <td className="py-2 pr-4 font-mono">{row.model_reaction_id ?? "—"}</td>
                        <td className="py-2 font-mono">{row.direction_relation}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <p className="mt-5 text-sm leading-7 text-muted">No model reaction was recorded for this ReactEnzDB reaction in the 30 fixed models.</p> : null}
              <div className="mt-3 font-semibold">
                <Link className="text-primary hover:underline" href="/hosts">View the host model registry</Link>
              </div>
            </div>
          </Section>

          {organismSummary.length || chassisSummary.length ? (
            <Section id="relationships" title="Source And Annotation Context">
              <div className="mb-4 text-sm leading-7 text-muted">
                This section separates enzyme provenance from source-retained chassis annotations. Neither field is a curated engineering-host recommendation.
              </div>
              <div className="grid gap-6 lg:grid-cols-2">
                <RelationshipList
                  emptyText="No source organism annotation available for this reaction."
                  items={organismSummary.map(([label, count]) => ({
                    href: organismIds.get(label)
                      ? `/organisms/${organismIds.get(label)}`
                      : `/organisms?q=${encodeURIComponent(label)}`,
                    label,
                    meta: `${count.toLocaleString()} association records`,
                  }))}
                  title="Source organisms"
                />
                <RelationshipList
                  emptyText="No chassis annotation available for this reaction."
                  items={chassisSummary.map(([label, item]) => ({
                    href: item.id ? `/chassis/${item.id}` : `/chassis?label=${encodeURIComponent(label)}`,
                    label,
                    meta: `${item.count.toLocaleString()} association records`,
                  }))}
                  title="Chassis annotations"
                />
              </div>
            </Section>
          ) : null}

          {mcsaEntries.length ? (
            <Section id="mechanism" title="M-CSA Catalytic Mechanism Context">
              <McsaMechanismPanel
                compounds={mcsaCompounds}
                entries={mcsaEntries}
                mechanisms={mcsaMechanisms}
                references={mcsaReferences}
                residues={mcsaResidues}
                scope="reaction"
                steps={mcsaSteps}
              />
            </Section>
          ) : null}

          {retrosynthesisLinks.length ? (
            <Section id="retrosynthesis" title="Retrosynthesis Rule Context">
              <RetrosynthesisRulePanel matches={retrosynthesisLinks} />
            </Section>
          ) : null}

          <Section id="evidence" title="Evidence, Literature And Cross Links">
            <EvidenceConfidence profile={evidenceProfile} />
            <div className="mb-6 grid gap-6 lg:grid-cols-2">
              <LinkList title="Reaction cross references" xrefs={xrefs} />
              <div className="rounded-2xl border border-border p-5 dark:border-dark_border">
                <h3 className="mb-4 text-20">Coverage summary</h3>
                <dl className="grid gap-3 text-sm">
                  <Meta label="Evidence level" value={reaction.evidence_level} status="not_curated" />
                  <Meta label="Structure completeness" value={reaction.all_participants_have_smiles ? "All participants have SMILES" : `${reaction.missing_smiles_count} participants unresolved`} />
                  <Meta label="Chassis annotation records" value={chassisRecords.length} />
                  <Meta label="Reaction references" value={references.length} />
                  <Meta label="Field-level evidence" value={attributeEvidences.length} />
                </dl>
                <details className="mt-4 border-t border-border pt-4 dark:border-dark_border" data-source-disclosure="reaction">
                  <summary className="cursor-pointer text-sm font-semibold text-primary">Record details</summary>
                  <dl className="mt-3 grid gap-3 text-sm">
                    <Meta label="External record ID" value={reaction.reaction_id} />
                  </dl>
                  <Link className="mt-3 inline-block text-sm font-semibold text-primary hover:underline" href="/methodology">Data processing</Link>
                </details>
              </div>
            </div>
            <EvidenceTable evidences={attributeEvidences} checksByEvidenceId={attributeExternalCheckMap} />
            <div className="mt-6">
              <ReferenceList references={references} />
            </div>
          </Section>
        </div>
      </div>
    </main>
  );
}

type EvidenceProfile = {
  score: number;
  tier: "strong" | "moderate" | "limited";
  summary: string;
  components: Array<{
    label: string;
    value: string;
    points: number;
    maxPoints: number;
    description: string;
  }>;
};

function storedRichnessTier(value: string | null | undefined, score: number): EvidenceProfile["tier"] {
  if (value === "strong" || value === "moderate" || value === "limited") return value;
  return score >= 75 ? "strong" : score >= 45 ? "moderate" : "limited";
}

function buildReactionEvidenceProfile({
  attributeEvidences,
  chassisRecordCount,
  enzymes,
  kinetics,
  references,
  structureComplete,
  xrefs,
  storedScore,
  storedTier,
}: {
  attributeEvidences: AttributeEvidenceRow[];
  chassisRecordCount: number;
  enzymes: Array<{ has_sequence: number }>;
  kinetics: KineticRow[];
  references: ReferenceRow[];
  structureComplete: boolean;
  xrefs: XrefRow[];
  storedScore: number;
  storedTier: EvidenceProfile["tier"];
}): EvidenceProfile {
  const referencePmids = new Set(references.map((item) => item.pmid).filter(Boolean));
  const fieldPmids = new Set(attributeEvidences.flatMap((item) => parseJsonArray(item.pmids_json)));
  const kineticPmids = new Set(kinetics.flatMap((item) => parseJsonArray(item.pmids_json)));
  const xrefDbs = new Set(xrefs.map((item) => item.xref_db).filter(Boolean));
  const sequencedEnzymes = enzymes.filter((item) => item.has_sequence).length;

  const components = [
    {
      label: "Publication PMIDs",
      value: `${referencePmids.size.toLocaleString()} unique PMIDs`,
      points: cappedPoints(referencePmids.size, 6, 6),
      maxPoints: 36,
      description: "Reaction-level literature references linked to this record.",
    },
    {
      label: "Field-level PMID evidence",
      value: `${attributeEvidences.length.toLocaleString()} evidence rows; ${fieldPmids.size.toLocaleString()} PMIDs`,
      points: cappedPoints(fieldPmids.size || attributeEvidences.length, 8, 3),
      maxPoints: 24,
      description: "PMID-backed values for linked reaction-enzyme attributes such as temperature, pH, cofactors, and kinetic fields.",
    },
    {
      label: "Kinetic PMID evidence",
      value: `${kineticPmids.size.toLocaleString()} PMIDs`,
      points: cappedPoints(kineticPmids.size, 4, 4),
      maxPoints: 16,
      description: "Kinetic records that retain direct publication evidence.",
    },
    {
      label: "External database links",
      value: `${xrefDbs.size.toLocaleString()} identifier namespaces`,
      points: cappedPoints(xrefDbs.size, 4, 4),
      maxPoints: 16,
      description: "External identifiers available for looking up corresponding records.",
    },
    {
      label: "Sequence support",
      value: `${sequencedEnzymes.toLocaleString()} linked enzymes with sequences`,
      points: sequencedEnzymes ? 5 : 0,
      maxPoints: 5,
      description: "At least one linked enzyme has an available protein sequence.",
    },
    {
      label: "Compound structure completeness",
      value: structureComplete ? "All participants have SMILES" : "Partial compound structure coverage",
      points: structureComplete ? 6 : 0,
      maxPoints: 6,
      description: "Reaction participants can be structurally resolved for search and comparison.",
    },
    {
      label: "Chassis annotation context",
      value: `${chassisRecordCount.toLocaleString()} annotation records`,
      points: chassisRecordCount ? 3 : 0,
      maxPoints: 3,
      description: "Source-retained chassis annotations add context; they do not establish host suitability.",
    },
  ];

  return evidenceProfileFromComponents(components, storedScore, storedTier);
}

function evidenceProfileFromComponents(
  components: EvidenceProfile["components"],
  storedScore?: number,
  storedTier?: EvidenceProfile["tier"],
): EvidenceProfile {
  const computedScore = Math.min(100, components.reduce((sum, item) => sum + item.points, 0));
  const score = storedScore ?? computedScore;
  const tier = storedTier ?? (score >= 75 ? "strong" : score >= 45 ? "moderate" : "limited");
  const summary =
    `This is the same annotation-richness index used on the list pages (${score}/100). It describes coverage of linked metadata, not catalytic confidence or experimental feasibility.`;

  return { components, score, summary, tier };
}

function cappedPoints(count: number, cap: number, weight: number) {
  return Math.min(count, cap) * weight;
}

function confidenceTone(score: number): "green" | "blue" | "amber" | "slate" {
  if (score >= 75) return "green";
  if (score >= 45) return "blue";
  if (score > 0) return "amber";
  return "slate";
}

function EvidenceConfidence({ profile }: { profile: EvidenceProfile }) {
  return (
    <div className="mb-6 rounded-3xl border border-primary/15 bg-gradient-to-br from-white via-hero-bg to-primary/5 p-6 shadow-sm dark:border-white/10 dark:from-darkmode dark:via-dark_b dark:to-primary/10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.18em] text-muted">Release-derived annotation richness</div>
          <h3 className="mt-2 text-24 text-midnight_text dark:text-white">{annotationCoverageLabel(profile.tier)} · {profile.score}/100</h3>
          <p className="mt-2 text-sm leading-7 text-muted">{profile.summary}</p>
        </div>
        <div className="rounded-2xl border border-primary/20 bg-white px-5 py-4 text-center shadow-sm dark:border-white/10 dark:bg-darkmode">
          <div className="text-4xl font-black text-primary">{profile.score}</div>
          <div className="text-xs font-black uppercase tracking-[0.14em] text-muted">richness index</div>
        </div>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {profile.components.map((item) => (
          <div key={item.label} className="rounded-2xl border border-border bg-white/80 p-4 dark:border-dark_border dark:bg-darkmode/80">
              <div className="text-xs font-black uppercase tracking-[0.12em] text-muted">{item.label}</div>
            <div className="mt-2 font-bold text-midnight_text dark:text-white">{item.value}</div>
            <p className="mt-2 text-xs leading-5 text-muted">{item.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="reactenz-detail-section scroll-mt-8 border-b border-border py-8 last:border-b-0 dark:border-dark_border">
      <h2 className="mb-5">{title}</h2>
      {children}
    </section>
  );
}

function IdentifierMeta({ label, value, status = "not_reported" }: { label: string; value: React.ReactNode; status?: DataStatusKind }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{label}</dt>
      <dd className="mt-0.5 break-all font-medium text-midnight_text dark:text-white">{displayValue(value, status)}</dd>
    </div>
  );
}

function Meta({ label, value, status = "not_reported" }: { label: string; value: React.ReactNode; status?: DataStatusKind }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd className="mt-1 font-semibold text-midnight_text dark:text-white">{displayValue(value, status)}</dd>
    </div>
  );
}

function ExternalId({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-border p-4 dark:border-dark_border">
      <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{label}</div>
      <div className="mt-2 break-words font-semibold text-midnight_text [overflow-wrap:anywhere] dark:text-white">{displayValue(value, "not_mapped")}</div>
    </div>
  );
}

function ConnectionCard({ href, label, value }: { href: string; label: string; value: React.ReactNode }) {
  return (
    <Link className="reactenz-connection-card min-w-0 overflow-hidden rounded-2xl border border-border bg-white p-3 transition hover:border-primary hover:shadow-sm dark:border-dark_border dark:bg-darkmode" href={href}>
      <div className="reactenz-connection-value break-words font-bold leading-snug text-primary [overflow-wrap:anywhere]">{displayValue(value, "not_reported")}</div>
      <div className="reactenz-connection-label mt-1 font-bold uppercase tracking-[0.08em] text-muted">{label}</div>
    </Link>
  );
}

function RelationshipList({
  title,
  items,
  emptyText,
}: {
  title: string;
  items: Array<{ href: string; label: string; meta: string }>;
  emptyText: string;
}) {
  return (
    <div className="rounded-2xl border border-border p-5 dark:border-dark_border">
      <h3 className="mb-4 text-20">{title}</h3>
      {items.length ? (
        <div className="grid gap-2">
          {items.map((item) => (
            <Link className="flex items-center justify-between gap-4 rounded-xl bg-hero-bg px-4 py-3 transition hover:text-primary dark:bg-dark_b" href={item.href} key={item.label}>
              <span className="font-semibold text-midnight_text dark:text-white">{item.label}</span>
              <span className="text-sm font-semibold text-muted">{item.meta}</span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="text-muted">{emptyText}</p>
      )}
    </div>
  );
}

function EnzymeCandidateEvidenceTable({
  candidates,
  reactionId,
  totalAssociated,
}: {
  candidates: RankedPathwayCandidate[];
  reactionId: string;
  totalAssociated: number;
}) {
  const fullListHref = `/enzymes?reactionId=${encodeURIComponent(reactionId)}&sequence=false`;
  if (!candidates.length) {
    return (
      <div className="rounded-2xl border border-border bg-hero-bg p-5 text-sm leading-7 text-muted dark:border-dark_border dark:bg-dark_b">
        Detailed candidate comparison is unavailable for this reaction. Browse the{" "}
        <Link className="font-semibold text-primary hover:underline" href={fullListHref}>full enzyme list</Link>.
      </div>
    );
  }

  const compared = candidates.slice(0, 40);

  return (
    <div className="grid gap-5">
      <div className="border-l-2 border-primary bg-primary/5 px-5 py-4">
        <h3 className="mb-2 text-20">Candidate evidence comparison</h3>
        <p className="text-sm leading-7 text-muted dark:text-white/60">
          Compare source organism, annotation richness, kinetics, structure, functional sites, domains, and sequence availability. No combined recommendation or feasibility score is calculated here; chassis annotations remain contextual only.
        </p>
        <p className="mt-2 text-sm leading-7 text-muted dark:text-white/60">
          Showing {compared.length.toLocaleString()} of {totalAssociated.toLocaleString()} associated enzymes.
          {totalAssociated > compared.length ? (
            <> Browse the <Link className="font-semibold text-primary hover:underline" href={fullListHref}>full enzyme list</Link> to see the remaining records.</>
          ) : null}
        </p>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border dark:border-dark_border">
        <table className="w-full min-w-[1480px] text-left text-sm">
          <thead className="bg-hero-bg text-muted dark:bg-dark_b">
            <tr>
              <th className="px-4 py-3">Candidate enzyme</th>
              <th className="px-4 py-3">Source organism</th>
              <th className="px-4 py-3">Annotation richness</th>
              <th className="px-4 py-3">Chassis annotations</th>
              <th className="px-4 py-3">Kinetics</th>
              <th className="px-4 py-3">pH / temperature</th>
              <th className="px-4 py-3">Structure evidence</th>
              <th className="px-4 py-3">Domain / family</th>
              <th className="px-4 py-3">Functional sites</th>
              <th className="px-4 py-3">Sequence</th>
              <th className="px-4 py-3">Evidence notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border dark:divide-dark_border">
            {compared.map((candidate) => (
              <tr className="align-top hover:bg-hero-bg/60 dark:hover:bg-dark_b" key={candidate.candidate_id}>
                <td className="px-4 py-3">
                  <Link className="font-black text-primary hover:underline" href={`/enzymes/${candidate.reactenz_enzyme_id ?? candidate.biopart_id}`}>
                    {candidate.reactenz_enzyme_id ?? candidate.biopart_id}
                  </Link>
                  <div className="mt-1 max-w-xs text-xs leading-5 text-muted">{candidate.enzyme_name ?? "enzyme name not reported"}</div>
                  {candidate.gene_name_primary ? <div className="mt-1 text-xs font-semibold text-midnight_text dark:text-white">Gene: {candidate.gene_name_primary}</div> : null}
                  {candidate.uniprot_accession ? (
                    <div className="mt-1 text-xs">
                      <ExternalDbLink db="uniprot" value={candidate.uniprot_accession} />
                    </div>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <div className="max-w-xs font-semibold text-midnight_text dark:text-white">{candidate.organism ?? "not reported"}</div>
                  {candidate.taxonomy_id ? (
                    <div className="mt-1 text-xs text-muted">
                      Taxonomy: <ExternalDbLink db="ncbi_taxonomy" value={candidate.taxonomy_id} />
                    </div>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <div className="font-black text-midnight_text dark:text-white">{candidate.enzyme_evidence_score}/100</div>
                  <div className="mt-1 max-w-xs text-xs leading-5 text-muted">Metadata and linked-evidence coverage; not biological confidence.</div>
                </td>
                <td className="px-4 py-3">
                  <div className="font-black text-midnight_text dark:text-white">{candidate.chassis_count} annotations</div>
                  <div className="mt-1 max-w-xs text-xs leading-5 text-muted">
                    {candidate.chassis_labels?.split(",").slice(0, 4).join(", ") ?? "no chassis annotation"}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="font-black text-midnight_text dark:text-white">{candidate.kinetic_record_count} records</div>
                  <div className="mt-1 text-xs leading-5 text-muted">
                    Km {candidate.km_count}; kcat {candidate.kcat_count}; kcat/Km {candidate.kcat_km_count}; Vmax {candidate.vmax_count}
                  </div>
                  {candidate.kinetic_subjects ? <div className="mt-1 max-w-xs truncate text-xs text-muted" title={candidate.kinetic_subjects}>{candidate.kinetic_subjects}</div> : null}
                </td>
                <td className="px-4 py-3">
                  <MetricLine label="pH" value={compactList(candidate.optimum_ph_values)} />
                  <MetricLine label="Temp" value={compactList(candidate.optimum_temperature_values, " C")} />
                </td>
                <td className="px-4 py-3">
                  <div className="font-black text-midnight_text dark:text-white">{candidate.structure_confidence_score}/100</div>
                  <Badge tone={confidenceTone(candidate.structure_confidence_score)}>{candidate.structure_confidence_tier ?? "no structure"}</Badge>
                  <div className="mt-1 text-xs text-muted">
                    {candidate.best_structure_type && candidate.best_structure_id ? `${candidate.best_structure_type}: ${candidate.best_structure_id}` : "no mapped structure"}
                  </div>
                  <div className="mt-1 text-xs text-muted">{candidate.catalytic_site_support_level ?? "site support not reported"}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="font-semibold text-midnight_text dark:text-white">InterPro {candidate.interpro_count}</div>
                  <div className="mt-1 text-xs text-muted">Pfam {candidate.pfam_count}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="font-semibold text-midnight_text dark:text-white">Active {candidate.active_site_count}</div>
                  <div className="mt-1 text-xs text-muted">Binding {candidate.binding_site_count}; conserved {candidate.conserved_site_count}</div>
                </td>
                <td className="px-4 py-3">
                  {candidate.has_sequence ? (
                    <>
                      <div className="font-black text-midnight_text dark:text-white">{candidate.sequence_length ?? 0} aa</div>
                      <div className="mt-1 text-xs text-muted">{sequenceDecision(candidate.sequence_length)}</div>
                    </>
                  ) : (
                    <DataStatus status="sequence_not_available" />
                  )}
                </td>
                <td className="px-4 py-3">
                  <ul className="grid gap-1 text-xs leading-5 text-muted">
                    {candidateEvidenceNotes(candidate).map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-xs leading-6 text-muted dark:text-white/60">
        Rows follow the model-ready dataset&apos;s evidence-coverage ordering. Inspect the enzyme detail page and original literature before experimental design; no row is a host recommendation or experimental feasibility conclusion.
      </div>
    </div>
  );
}

function candidateEvidenceNotes(candidate: RankedPathwayCandidate): string[] {
  const notes = [];
  if (candidate.kinetic_record_count > 0) notes.push(`${candidate.kinetic_record_count} kinetic records available`);
  if (candidate.chassis_count > 0) notes.push(`${candidate.chassis_count} chassis annotations`);
  if (candidate.structure_confidence_score >= 70) notes.push("high structure confidence");
  if (candidate.active_site_count + candidate.binding_site_count + candidate.conserved_site_count > 0) notes.push("functional-site annotation present");
  if (candidate.interpro_count || candidate.pfam_count) notes.push("family/domain annotation present");
  if (candidate.sequence_length && candidate.sequence_length > 1500) notes.push("sequence length exceeds 1,500 aa");
  if (!notes.length) notes.push("limited evidence coverage");
  return notes.slice(0, 5);
}

function compactList(value: string | null | undefined, suffix = ""): string {
  if (!value) return "not reported";
  return value
    .split(/[;,|]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4)
    .map((item) => `${item}${suffix}`)
    .join(", ") || "not reported";
}

function sequenceDecision(length: number | null): string {
  if (!length) return "length not reported";
  if (length > 1500) return "very long protein";
  if (length < 80) return "very short protein";
  return "sequence available";
}

function MetricLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-1">
      <span className="text-xs font-black uppercase tracking-[0.12em] text-muted">{label}: </span>
      <span className="font-semibold text-midnight_text dark:text-white">{value}</span>
    </div>
  );
}

function RetrosynthesisRulePanel({ matches }: { matches: RetrosynthesisRuleMatch[] }) {
  if (!matches.length) {
    return (
      <div className="rounded-2xl border border-border bg-hero-bg p-5 text-sm leading-7 text-muted dark:border-dark_border dark:bg-dark_b">
        No eligible BioNavi rule reference is currently mapped through this reaction's EC, Rhea, or MetaCyc identifiers. This is an explicit no-match state; weak text matches are not promoted.
      </div>
    );
  }

  const enzymaticCount = matches.filter((match) => match.rule_source === "enzymatic_metabolic").length;

  return (
    <div className="grid gap-5">
      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5">
        <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <h3 className="mb-2 text-20">Exact external-ID rule matches</h3>
            <p className="text-sm leading-7 text-muted dark:text-white/60">
              These available rules come from the retrosynthesis resource layer and are linked only by exact EC/Rhea/MetaCyc references. They are useful for model rule context and route design, not counted as new experimental evidence.
            </p>
          </div>
          <div className="rounded-2xl bg-white px-5 py-4 text-center shadow-sm dark:bg-darkmode">
            <div className="text-3xl font-black text-primary">{matches.length.toLocaleString()}</div>
            <div className="text-xs font-black uppercase tracking-wider text-muted">matched rules</div>
            <div className="mt-1 text-xs text-muted">{enzymaticCount.toLocaleString()} enzymatic/metabolic</div>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border dark:border-dark_border">
        <table className="w-full min-w-[1080px] text-left text-sm">
          <thead className="bg-hero-bg text-muted dark:bg-dark_b">
            <tr>
              <th className="px-4 py-3">Rule</th>
              <th className="px-4 py-3">Matched references</th>
              <th className="px-4 py-3">Reference support</th>
              <th className="px-4 py-3">SMARTS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border dark:divide-dark_border">
            {matches.map((match) => (
              <tr className="align-top" key={match.rule_id}>
                <td className="px-4 py-3">
                  <div className="font-mono text-xs font-black text-primary">{match.rule_id}</div>
                  <div className="mt-1 text-xs text-muted">{match.rule_type ?? "rule type not reported"}</div>
                </td>
                <td className="px-4 py-3">
                  <Badge tone={match.rule_source === "enzymatic_metabolic" ? "green" : "slate"}>{match.rule_source}</Badge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    {splitMatchedReferences(match.matched_references).map((item) => (
                      <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-black text-primary" key={item}>
                        {item}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="font-semibold">{match.matched_reference_count.toLocaleString()} matched refs</div>
                  <div className="mt-1 text-xs text-muted">
                    {match.reference_reaction_count.toLocaleString()} reaction refs; {match.reference_molecule_count.toLocaleString()} molecule refs; {match.reference_enzyme_count.toLocaleString()} enzyme refs
                  </div>
                </td>
                <td className="px-4 py-3">
                  <code className="block max-h-24 overflow-auto rounded-xl bg-hero-bg p-3 text-xs leading-5 text-midnight_text dark:bg-dark_b dark:text-white">
                    {match.smarts ?? "SMARTS not reported"}
                  </code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-sm leading-7 text-muted dark:text-white/60">
        Full source-attributed rule, building-block, and mapping files are available on the <Link className="font-bold text-primary hover:underline" href="/retrosynthesis">planning datasets</Link> and <Link className="font-bold text-primary hover:underline" href="/downloads">Downloads</Link> pages.
      </div>
    </div>
  );
}

function splitMatchedReferences(value: string | null): string[] {
  if (!value) return [];
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function CompoundSide({ title, compounds }: { title: string; compounds: CompoundParticipant[] }) {
  return (
    <div className="min-w-0">
      <h3 className="mb-3 text-20">{title}</h3>
      <div className={`grid gap-3 ${compounds.length > 1 ? "sm:grid-cols-2" : ""}`}>
        {compounds.map((compound) => {
          const url = imageUrl(compound.image_path);
          return (
            <div key={`${compound.compound_id}-${compound.side}-${compound.position_index}`} className="rounded-2xl border border-border bg-white p-3 dark:border-dark_border dark:bg-darkmode">
              <div className="mb-2 flex h-28 items-center justify-center rounded-xl bg-hero-bg p-2 dark:bg-white">
                {url ? (
                  <Image src={url} alt={compound.compound_name ?? compound.compound_id} width={360} height={160} className={compoundImageClass(compound)} />
                ) : (
                  <div className="text-sm text-muted"><DataStatus status="structure_not_available" /></div>
                )}
              </div>
              <div className="text-sm font-bold leading-5 text-midnight_text dark:text-white">{compound.compound_name ?? compound.compound_id}</div>
              <details className="group mt-2">
                <summary className="cursor-pointer list-none text-[11px] font-black text-primary">Identifiers</summary>
                <dl className="mt-1.5 grid gap-1 text-[11px] leading-4 text-muted">
                  <IdentifierMeta label="Compound ID" value={compound.compound_id} />
                  <IdentifierMeta label="Formula" value={compound.formula} status="not_reported" />
                  <IdentifierMeta label="ChEBI" value={<ExternalDbLink db="chebi" value={compound.chebi_id} />} />
                  <IdentifierMeta label="PubChem" value={<ExternalDbLink db="pubchem" value={compound.pubchem_id} />} />
                  <IdentifierMeta label="MNXref" value={<ExternalDbLinks db="mnx_compound" value={compound.mnx_compound_ids} />} />
                  <IdentifierMeta label="SMILES" value={compound.smiles ? <span className="break-all">{compound.smiles}</span> : null} status="structure_not_available" />
                  <IdentifierMeta label="Structure status" value={compound.structure_status ?? compound.image_status} status="unresolved" />
                </dl>
              </details>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function compoundImageClass(compound: CompoundParticipant) {
  const formula = compound.formula ?? "";
  const smiles = compound.smiles ?? "";
  const name = (compound.compound_name ?? "").toLowerCase();
  const heavyAtomMatches = formula.match(/[A-Z][a-z]?/g) ?? [];
  const tokenCount = smiles.replace(/\[[^\]]+\]/g, "A").match(/[A-Z][a-z]?|[cnosp]/g)?.length ?? heavyAtomMatches.length;
  const isVerySmall =
    tokenCount <= 4 ||
    /^(h2?o|co2|o2|h\+|phosphate|diphosphate|pyrophosphate)$/i.test(name.replace(/\s+/g, ""));

  if (isVerySmall) return "mx-auto h-24 w-full scale-125 object-contain";
  return "mx-auto h-24 w-full object-contain";
}

function KineticTable({ kinetics, checksByKineticId }: { kinetics: KineticRow[]; checksByKineticId: Map<string, KineticExternalCheckRow[]> }) {
  if (!kinetics.length) return <p className="text-muted">No resolved kinetic parameters in the release layer.</p>;
  return (
    <div className="overflow-x-auto rounded-2xl border border-border dark:border-dark_border">
      <table className="w-full min-w-[1240px] text-left text-sm">
        <thead className="bg-hero-bg text-muted dark:bg-dark_b">
          <tr>
            <th className="px-4 py-3">Parameter</th>
            <th className="px-4 py-3">Value</th>
            <th className="px-4 py-3">Subject</th>
            <th className="px-4 py-3">Condition</th>
            <th className="px-4 py-3">Enzyme</th>
            <th className="px-4 py-3">Assignment</th>
            <th className="px-4 py-3">External validation</th>
            <th className="px-4 py-3">Evidence</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border dark:divide-dark_border">
          {kinetics.map((item, index) => (
            <tr data-kinetic-id={item.kinetic_id} key={item.kinetic_id || `${item.parameter_type}-${item.value_text ?? item.value_numeric}-${index}`} className="align-top">
              <td className="px-4 py-3 font-semibold">{formatKineticParameterType(item.parameter_type)}</td>
              <td className="px-4 py-3">{item.value_text ?? item.value_numeric ?? <DataStatus status="not_reported" />} {item.unit ?? ""}</td>
              <td className="px-4 py-3">{item.subject_name ?? <DataStatus status="not_reported" />}</td>
              <td className="px-4 py-3">{formatExperimentalConditions(item.condition_text) ?? <DataStatus status="not_reported" />}</td>
              <td className="px-4 py-3">{item.reactenz_enzyme_id ?? item.biopart_id ?? <DataStatus status="not_mapped" />}</td>
              <td className="px-4 py-3">{item.reaction_assignment_status ?? <DataStatus status="unresolved" />}</td>
              <td className="px-4 py-3"><KineticExternalCheck checks={checksByKineticId.get(item.kinetic_id)} /></td>
              <td className="px-4 py-3"><PmidBadges pmids={parseJsonArray(item.pmids_json)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EvidenceTable({ evidences, checksByEvidenceId }: { evidences: AttributeEvidenceRow[]; checksByEvidenceId: Map<string, AttributeExternalCheckRow[]> }) {
  if (!evidences.length) {
    return <p className="text-muted">No field-level PMID evidence is available for the linked reaction-enzyme records in this release.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-border dark:border-dark_border">
      <table className="w-full min-w-[980px] text-left text-sm">
        <thead className="bg-hero-bg text-muted dark:bg-dark_b">
          <tr>
            <th className="px-4 py-3">Attribute</th>
            <th className="px-4 py-3">Value</th>
            <th className="px-4 py-3">Linked enzyme</th>
            <th className="px-4 py-3">External validation</th>
            <th className="px-4 py-3">PMID evidence</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border dark:divide-dark_border">
          {evidences.map((item) => (
            <tr key={item.attribute_evidence_id} className="align-top">
              <td className="px-4 py-3 font-semibold">{formatAttributeName(item.attribute_name)}</td>
              <td className="px-4 py-3">
                {presentAttributeValue(item.value_text) ?? item.value_numeric ?? <DataStatus status="not_reported" />} {item.unit ?? ""} {item.external_url ? <a className="ml-2 font-semibold text-primary hover:underline" href={item.external_url} target="_blank" rel="noreferrer">External record</a> : null}
              </td>
              <td className="px-4 py-3">
                {item.related_reactenz_id ? (
                  <Link className="font-semibold text-primary hover:underline" href={`/enzymes/${item.related_reactenz_id}`}>
                    {item.related_reactenz_id}
                  </Link>
                ) : (
                  <DataStatus status="not_mapped" />
                )}
                {item.related_name ? <div className="mt-1 text-xs text-muted">{item.related_name}</div> : null}
              </td>
              <td className="px-4 py-3"><AttributeExternalCheck checks={checksByEvidenceId.get(item.attribute_evidence_id)} /></td>
              <td className="px-4 py-3"><PmidBadges pmids={parseJsonArray(item.pmids_json)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReferenceList({ references }: { references: ReferenceRow[] }) {
  if (!references.length) return <p className="text-muted">No reaction-level publication references are available in this release.</p>;
  return (
    <div className="rounded-2xl border border-border p-5 dark:border-dark_border">
      <h3 className="mb-4 text-20">Reaction literature</h3>
      <ol className="grid list-decimal gap-3 pl-5 text-sm leading-6">
        {references.map((reference) => (
          <li key={`${reference.reference_id}-${reference.pmid}`} className="pl-1">
            <a className="font-semibold text-primary hover:underline" href={reference.reference_url ?? `https://pubmed.ncbi.nlm.nih.gov/${reference.pmid}`} target="_blank" rel="noreferrer">
              PMID:{reference.pmid}
            </a>
            <span className="ml-2 text-muted">{reference.citation_text ?? "Citation text not available."}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function PmidBadges({ pmids }: { pmids: string[] }) {
  if (!pmids.length) return <DataStatus status="not_reported" />;
  return (
    <span className="inline-flex flex-wrap gap-2">
      {pmids.map((pmid) => (
        <a key={pmid} className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-black text-primary hover:bg-primary hover:text-white" href={`https://pubmed.ncbi.nlm.nih.gov/${pmid}`} target="_blank" rel="noreferrer">
          PMID:{pmid}
        </a>
      ))}
    </span>
  );
}

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item).trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function formatAttributeName(value: string) {
  return value.replaceAll("_", " ");
}

function LinkList({ title, xrefs }: { title: string; xrefs: XrefRow[] }) {
  return (
    <div className="rounded-2xl border border-border p-5 dark:border-dark_border">
      <h3 className="mb-4 text-20">{title}</h3>
      {xrefs.length ? (
        <div className="grid gap-2 text-sm">
          {xrefs.map((xref) => (
            <a key={`${xref.xref_db}-${xref.xref_value}`} className="font-semibold text-primary hover:underline" href={xref.xref_url ?? xrefUrl(xref) ?? "#"} target="_blank" rel="noreferrer">
              {xref.xref_db}: {xref.xref_value}
            </a>
          ))}
        </div>
      ) : (
        <p className="text-muted">No cross references available.</p>
      )}
    </div>
  );
}

function xrefUrl(xref: XrefRow) {
  if (xref.xref_db === "kegg_reaction") return externalDbUrl("kegg_reaction", xref.xref_value);
  if (xref.xref_db === "metacyc_reaction") return externalDbUrl("metacyc_reaction", xref.xref_value);
  if (xref.xref_db === "mnx_reaction") return externalDbUrl("mnx_reaction", xref.xref_value);
  if (xref.xref_db === "rhea") return externalDbUrl("rhea", xref.xref_value);
  return null;
}
