import ReportedExperimentalObservations from "@/components/ReactEnz/ReportedExperimentalObservations";
import { formatExperimentalConditions } from "@/lib/experimentalConditions";
import { presentAttributeValue } from "@/lib/dataPresentation";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { annotationCoverageLabel } from "@/lib/qualitySemantics";
import Badge from "@/components/ReactEnz/Badge";
import DetailJumpNav from "@/components/ReactEnz/DetailJumpNav";
import AttributeExternalCheck, { buildAttributeCheckMap } from "@/components/ReactEnz/AttributeExternalCheck";
import DataStatus, { displayValue, type DataStatusKind } from "@/components/ReactEnz/DataStatus";
import DetailDownloadLink from "@/components/ReactEnz/DetailDownloadLink";
import ExternalDbLink, { externalDbUrl } from "@/components/ReactEnz/ExternalDbLink";
import KineticExternalCheck, { buildKineticCheckMap } from "@/components/ReactEnz/KineticExternalCheck";
import McsaMechanismPanel from "@/components/ReactEnz/McsaMechanismPanel";
import SpecificReactionEvidence from "@/components/ReactEnz/SpecificReactionEvidence";
import ExperimentalExpressionEvidence from "@/components/ReactEnz/ExperimentalExpressionEvidence";
import { getEnzymeEvidenceBundle } from "@/lib/evidence-release";
import { getExpressionEvidenceForEnzyme } from "@/lib/expressionEvidence";
import ReactionTable from "@/components/ReactEnz/ReactionTable";
import StructureViewer from "@/components/ReactEnz/StructureViewer";
import {
  getEnzyme,
  getAlphaFoldMappings,
  getEnzymeAttributeEvidences,
  getEnzymeAttributeExternalChecks,
  getEnzymeChassis,
  getEnzymeKineticExternalChecks,
  getEnzymeKinetics,
  formatKineticParameterType,
  getEnzymeMcsaCompounds,
  getEnzymeMcsaEntries,
  getEnzymeMcsaMechanisms,
  getEnzymeMcsaMechanismSteps,
  getEnzymeMcsaReferences,
  getEnzymeMcsaResidues,
  getEnzymeProteinAnnotation,
  getEnzymeProteinDomains,
  getEnzymeProteinFeatures,
  getEnzymeReactions,
  getEnzymeReferences,
  getEnzymeStructureConfidence,
  getEnzymeXrefs,
  getPdbMappings,
  type AlphaFoldRow,
  type AttributeEvidenceRow,
  type AttributeExternalCheckRow,
  type KineticExternalCheckRow,
  type KineticRow,
  type PdbRow,
  type ProteinAnnotationSummary,
  type ProteinDomainRow,
  type ProteinFeatureRow,
  type ReferenceRow,
  type StructureConfidenceRow,
  type XrefRow,
} from "@/lib/reactenzdb";
import { getEnzymeClusterMemberships } from "@/lib/sequenceClusters";

export const revalidate = 60;

type PageProps = {
  params: Promise<{ biopartId: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { biopartId } = await params;
  const enzyme = getEnzyme(biopartId);
  if (!enzyme) notFound();
  const name = enzyme.enzyme_name || enzyme.reactenz_enzyme_id;
  return {
    title: `${name} enzyme record`,
    description: `${enzyme.reactenz_enzyme_id}: ${name}${enzyme.organism ? ` from ${enzyme.organism}` : ""}, with associated reactions, kinetics, protein annotations, structures, active-site evidence, and chassis annotations.`,
    alternates: { canonical: `/enzymes/${encodeURIComponent(enzyme.reactenz_enzyme_id)}` },
  };
}

export default async function EnzymeDetailPage({ params }: PageProps) {
  const { biopartId } = await params;
  const enzyme = getEnzyme(biopartId);
  if (!enzyme) notFound();

  const reactions = getEnzymeReactions(enzyme.biopart_id, 80);
  const pdb = getPdbMappings(enzyme.biopart_id);
  const alphafold = getAlphaFoldMappings(enzyme.biopart_id);
  const structureConfidence = getEnzymeStructureConfidence(enzyme.biopart_id);
  const chassis = getEnzymeChassis(enzyme.biopart_id);
  const kinetics = getEnzymeKinetics(enzyme.biopart_id, 200);
  const kineticExternalChecks = getEnzymeKineticExternalChecks(enzyme.biopart_id, 100);
  const kineticExternalCheckMap = buildKineticCheckMap(kineticExternalChecks);
  const reactionEvidence = getEnzymeEvidenceBundle(enzyme.reactenz_enzyme_id, { limit: 30, pairLimit: 80 });
  const experimentalExpression = getExpressionEvidenceForEnzyme(enzyme.biopart_id, enzyme.reactenz_enzyme_id, 12);
  const xrefs = getEnzymeXrefs(enzyme.biopart_id);
  const references = getEnzymeReferences(enzyme.biopart_id, 100);
  const attributeEvidences = getEnzymeAttributeEvidences(enzyme.biopart_id, 80);
  const attributeExternalChecks = getEnzymeAttributeExternalChecks(enzyme.biopart_id, 100);
  const attributeExternalCheckMap = buildAttributeCheckMap(attributeExternalChecks);
  const proteinAnnotation = getEnzymeProteinAnnotation(enzyme.biopart_id);
  const proteinDomains = getEnzymeProteinDomains(enzyme.biopart_id, 80);
  const proteinFeatures = getEnzymeProteinFeatures(enzyme.biopart_id, 80);
  const sequenceFamilies = getEnzymeClusterMemberships(enzyme.biopart_id, true);
  const mcsaEntries = getEnzymeMcsaEntries(enzyme.biopart_id, 12);
  const mcsaResidues = getEnzymeMcsaResidues(enzyme.biopart_id, 160);
  const mcsaMechanisms = getEnzymeMcsaMechanisms(enzyme.biopart_id, 20);
  const mcsaSteps = getEnzymeMcsaMechanismSteps(enzyme.biopart_id, 180);
  const mcsaCompounds = getEnzymeMcsaCompounds(enzyme.biopart_id, 120);
  const mcsaReferences = getEnzymeMcsaReferences(enzyme.biopart_id, 160);
  const lineage = enzyme.lineage?.split(";").map((item) => item.trim()).filter(Boolean) ?? [];
  const richnessScore = Number(enzyme.evidence_score ?? 0);
  const richnessTier = storedRichnessTier(enzyme.evidence_tier, richnessScore);
  const evidenceProfile = buildEnzymeEvidenceProfile({
    alphafoldCount: alphafold.length,
    attributeEvidences,
    chassisCount: chassis.length,
    hasSequence: Boolean(enzyme.has_sequence),
    kinetics,
    pdbCount: pdb.length,
    reactionCount: reactions.length,
    references,
    xrefs,
    storedScore: richnessScore,
    storedTier: richnessTier,
  });
  const sourceOrganismHref = enzyme.reactenz_organism_id
    ? `/organisms/${enzyme.reactenz_organism_id}`
    : enzyme.organism
      ? `/organisms?q=${encodeURIComponent(enzyme.organism)}`
      : "#overview";
  const hasProteinAnnotation = Boolean(proteinAnnotation || proteinDomains.length || proteinFeatures.length);
  const hasReactionEvidence = Boolean((reactionEvidence.release.available && reactionEvidence.summary) || reactionEvidence.literature_records.length);
  const hasExternalLinks = Boolean(xrefs.length || pdb.length || alphafold.length);
  const navSections = [
    { id: "overview", label: "Overview" },
    { id: "function", label: "Associated reactions" },
    { id: "sequence", label: "Sequence" },
    { id: "structure", label: "Structure" },
    ...(hasProteinAnnotation ? [{ id: "protein-annotation", label: "Protein annotation" }] : []),
    ...(kinetics.length ? [{ id: "kinetics", label: "Kinetics" }] : []),
    ...(hasReactionEvidence ? [{ id: "reaction-evidence", label: "Reaction-specific evidence" }] : []),
    ...(experimentalExpression.length ? [{ id: "experimental-expression", label: "Expression evidence" }] : []),
    ...(sequenceFamilies.length ? [{ id: "sequence-families", label: "Sequence families" }] : []),
    ...(chassis.length ? [{ id: "expression", label: "Chassis annotations" }] : []),
    ...(mcsaEntries.length ? [{ id: "mechanism", label: "Catalytic mechanism" }] : []),
    { id: "evidence", label: "Evidence & literature" },
    ...(hasExternalLinks ? [{ id: "links", label: "External links" }] : []),
  ];

  return (
    <main className="reactenz-detail reactenz-container py-10">
      <div className="grid gap-8 lg:grid-cols-[230px_1fr]">
        <DetailJumpNav backHref="/enzymes" backLabel="Enzymes" label="Enzyme record" sections={navSections} />

        <div className="min-w-0">
          <section id="overview" className="reactenz-detail-overview scroll-mt-8 border-b border-border pb-8 dark:border-dark_border">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                <Badge tone={enzyme.has_sequence ? "green" : "slate"}>{enzyme.has_sequence ? "sequence available" : "sequence not available"}</Badge>
                <Badge tone="blue">{enzyme.reaction_count} reactions</Badge>
                <Badge tone={enzyme.pdb_count ? "green" : "slate"}>{enzyme.pdb_count ?? 0} PDB</Badge>
                <Badge tone={alphafold.length ? "blue" : "slate"}>{alphafold.length} AlphaFold</Badge>
                <Badge tone={structureConfidence?.has_high_confidence_structure ? "green" : "slate"}>{structureConfidence?.structure_confidence_score ?? 0} structure</Badge>
                <Badge tone={structureConfidence && structureConfidence.catalytic_site_support_level !== "none" ? "green" : "slate"}>{structureConfidence?.catalytic_site_support_level ?? "no site support"}</Badge>
                <Badge tone={enzyme.kinetic_count ? "blue" : "slate"}>{enzyme.kinetic_count ?? 0} kinetic records</Badge>
                <Badge tone={proteinAnnotation?.interpro_count ? "green" : "slate"}>{proteinAnnotation?.interpro_count ?? 0} InterPro</Badge>
                <Badge tone={confidenceTone(richnessScore)}>{annotationCoverageLabel(richnessTier)} · {richnessScore}/100</Badge>
              </div>
              <DetailDownloadLink type="enzyme-detail" id={enzyme.reactenz_enzyme_id} />
            </div>
            <p className="reactenz-eyebrow">{enzyme.reactenz_enzyme_id}</p>
            <h1 className="reactenz-detail-title mb-2">{enzyme.enzyme_name ?? "Unnamed enzyme"}</h1>
            {enzyme.organism ? (
              <p className="text-base font-semibold text-midnight_text dark:text-white">
                <Link className="text-primary hover:underline" href={sourceOrganismHref}>{enzyme.organism}</Link>
              </p>
            ) : null}
            {lineage.length ? (
              <details className="mt-2 max-w-3xl">
                <summary className="cursor-pointer text-sm leading-6 text-muted">
                  {lineage.slice(-3).join(" / ")}
                </summary>
                <p className="mt-1.5 text-[12px] leading-5 text-muted">{lineage.join(" / ")}</p>
              </details>
            ) : null}
            <dl className="mt-7 grid gap-x-8 gap-y-4 text-sm md:grid-cols-2 xl:grid-cols-4">
              <Meta label="Internal source ID" value={enzyme.biopart_id} />
              <Meta label="Protein ID" value={enzyme.protein_id} status="not_mapped" />
              <Meta label="UniProt accession" value={<ExternalDbLink db="uniprot" value={enzyme.uniprot_accession} url={enzyme.uniprot_url} />} />
              <Meta label="UniProt entry" value={enzyme.uniprot_entry_name} status="not_mapped" />
              <Meta label="UniProt mapping" value={enzyme.uniprot_mapping_method} status="not_mapped" />
              <Meta label="Gene" value={enzyme.gene_name_primary} status="not_reported" />
              <Meta label="Amino acids" value={enzyme.sequence_length ? `${enzyme.sequence_length} aa` : null} status="sequence_not_available" />
              <Meta label="NCBI taxonomy ID" value={<ExternalDbLink db="ncbi_taxonomy" value={enzyme.taxonomy_id} />} />
              <Meta label="Evidence" value={enzyme.evidence_label} status="not_curated" />
              <Meta label="Chassis annotations" value={enzyme.chassis_count ?? 0} />
            </dl>
            <div className="mt-7 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <ConnectionCard
                href="#function"
                label="Associated reactions"
                value={reactions.length}
              />
              <ConnectionCard
                href={sourceOrganismHref}
                label="Source organism"
                value={enzyme.organism ?? "not curated"}
              />
              <ConnectionCard
                href={chassis.length ? "#expression" : "/chassis"}
                label="Chassis annotations"
                value={chassis.length}
              />
              <ConnectionCard
                href="#structure"
                label="Structure links"
                value={(pdb.length + alphafold.length).toLocaleString()}
              />
            </div>
          </section>

          <Section id="function" title="Associated Reactions">
            <div className="mb-4 text-sm leading-7 text-muted">
              This enzyme is associated with {(enzyme.reaction_count ?? reactions.length).toLocaleString()} reaction records in the current release view.
              Showing {reactions.length.toLocaleString()}
              {(enzyme.reaction_count ?? 0) > reactions.length ? " here." : "."}
              Host context is assessed for a specific reaction and model release, not for an enzyme record alone. No enzyme–host compatibility score is calculated here.
            </div>
            {reactions.length ? (
              <p className="mb-4 text-sm text-muted">
                Open host context on a reaction:{" "}
                {reactions.slice(0, 8).map((reaction, index) => (
                  <span key={reaction.reactenz_reaction_id}>
                    {index ? ", " : ""}
                    <Link className="font-semibold text-primary hover:underline" href={`/reactions/${encodeURIComponent(reaction.reactenz_reaction_id)}#host-context`}>
                      {reaction.reactenz_reaction_id}
                    </Link>
                  </span>
                ))}
                {reactions.length > 8 ? "…" : null}
              </p>
            ) : (
              <p className="mb-4 text-sm text-muted">No associated reaction is available in this release view; this is not a host-compatibility result.</p>
            )}
            <ReactionTable reactions={reactions} tableId="enzyme-reactions-table" />
          </Section>

          <Section id="sequence" title="Protein Sequence">
            <div className="mb-4 grid gap-4 text-sm md:grid-cols-3">
              <Meta label="Sequence status" value={enzyme.has_sequence ? "available" : null} status="sequence_not_available" />
              <Meta label="Length" value={enzyme.sequence_length ? `${enzyme.sequence_length} aa` : null} status="sequence_not_available" />
              <Meta label="Protein ID" value={enzyme.protein_id} status="not_mapped" />
            </div>
            <pre className="max-h-96 overflow-auto rounded-2xl bg-hero-bg p-5 text-sm leading-7 text-midnight_text dark:bg-dark_b dark:text-white">
              {formatSequence(enzyme.protein_sequence)}
            </pre>
          </Section>

          <Section id="structure" title="Structure">
            <StructureConfidencePanel confidence={structureConfidence} />
            <StructureViewer pdb={pdb} alphafold={alphafold} />
          </Section>

          {hasProteinAnnotation ? (
            <Section id="protein-annotation" title="Protein Family, Domain And Functional Site Annotation">
              <ProteinAnnotationPanel annotation={proteinAnnotation} domains={proteinDomains} features={proteinFeatures} />
            </Section>
          ) : null}

          {kinetics.length ? (
            <Section id="kinetics" title="Kinetic Parameters">
              <KineticTable kinetics={kinetics} checksByKineticId={kineticExternalCheckMap} />
            </Section>
          ) : null}

          {hasReactionEvidence ? (
            <Section id="reaction-evidence" title="Reaction-specific Activity Evidence">
              <SpecificReactionEvidence bundle={reactionEvidence} />
            </Section>
          ) : null}

          {experimentalExpression.length ? (
            <Section id="experimental-expression" title="Expression Evidence">
              <ExperimentalExpressionEvidence bundles={experimentalExpression} title="Expression hosts and outcomes linked to this enzyme" />
            </Section>
          ) : null}

          <ReportedExperimentalObservations biopartId={enzyme.biopart_id} />

          {sequenceFamilies.length ? (
            <Section id="sequence-families" title="Non-redundant Sequence Family Membership">
              <p className="mb-4 text-sm leading-7 text-muted">Four independent identity views show how strongly this record can be compressed and whether it is the evidence-weighted representative. Family membership supports candidate selection; it does not establish identical function.</p>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{sequenceFamilies.map((family) => (
                <Link key={family.threshold} href={`/sequence-families?threshold=${family.threshold}`} className="rounded-2xl border border-border p-5 transition hover:border-primary dark:border-dark_border">
                  <div className="flex items-center justify-between gap-2"><span className="text-xs font-black uppercase tracking-[0.16em] text-primary">NR{family.threshold}</span>{family.is_representative ? <Badge tone="green">representative</Badge> : null}</div>
                  <div className="mt-3 text-2xl font-black text-midnight_text dark:text-white">{family.enzyme_record_count.toLocaleString()}</div>
                  <div className="text-sm font-semibold text-muted">enzyme records · {family.unique_sequence_count.toLocaleString()} sequences</div>
                  <div className="mt-3 text-xs leading-5 text-muted">{family.species_count.toLocaleString()} species · {family.experimental_supported_count.toLocaleString()} evidence-supported</div>
                </Link>
              ))}</div>
            </Section>
          ) : null}

          {chassis.length ? (
            <Section id="expression" title="Chassis Annotations">
              <p className="mb-4 text-sm leading-7 text-muted">These source-retained labels provide annotation context only. They are not curated metabolic hosts, expression recommendations, or experimental compatibility conclusions.</p>
              <div className="grid gap-3 md:grid-cols-2">
                {chassis.map((item) => (
                  <Link key={item.label} className="rounded-2xl border border-border p-4 transition hover:border-primary dark:border-dark_border" href={item.reactenz_chassis_id ? `/chassis/${item.reactenz_chassis_id}` : `/chassis?label=${encodeURIComponent(item.label)}`}>
                    <div className="font-semibold text-primary">{item.reactenz_chassis_id}</div>
                    <div className="mt-1 font-semibold text-midnight_text dark:text-white">{item.label}</div>
                    <div className="mt-2 text-sm text-muted">{item.record_count.toLocaleString()} association records; {item.reaction_count.toLocaleString()} reactions</div>
                  </Link>
                ))}
              </div>
            </Section>
          ) : null}

          {mcsaEntries.length ? (
            <Section id="mechanism" title="Catalytic Residues And Mechanism">
              <McsaMechanismPanel
                compounds={mcsaCompounds}
                entries={mcsaEntries}
                mechanisms={mcsaMechanisms}
                references={mcsaReferences}
                residues={mcsaResidues}
                scope="enzyme"
                steps={mcsaSteps}
              />
            </Section>
          ) : null}

          <Section id="evidence" title="Evidence And Literature">
            <EvidenceConfidence profile={evidenceProfile} />
            <div className="mb-6 grid gap-6 lg:grid-cols-2">
            <EvidenceTable evidences={attributeEvidences} checksByEvidenceId={attributeExternalCheckMap} />
              <ReferenceList references={references} />
            </div>
          </Section>

          {hasExternalLinks ? (
            <Section id="links" title="External Links">
              <LinkList xrefs={xrefs} pdb={pdb} alphafold={alphafold} />
            </Section>
          ) : null}
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

function StructureConfidencePanel({ confidence }: { confidence: StructureConfidenceRow | null }) {
  if (!confidence) {
    return (
      <div className="mb-6 rounded-2xl border border-border bg-hero-bg p-5 text-sm leading-7 text-muted dark:border-dark_border dark:bg-dark_b">
        Structure confidence features have not been computed for this enzyme.
      </div>
    );
  }

  const siteSupport = confidence.catalytic_site_support_level.replaceAll("_", " ");
  const afRange =
    confidence.alphafold_residue_coverage_start && confidence.alphafold_residue_coverage_end
      ? `${confidence.alphafold_residue_coverage_start}-${confidence.alphafold_residue_coverage_end}`
      : "not mapped";

  return (
    <div className="mb-6 rounded-3xl border border-primary/15 bg-gradient-to-br from-white via-hero-bg to-primary/5 p-6 shadow-sm dark:border-white/10 dark:from-darkmode dark:via-dark_b dark:to-primary/10">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.18em] text-muted">Structure confidence and catalytic-site coverage</div>
          <h3 className="mt-2 break-words text-24 text-midnight_text dark:text-white">
            {confidence.structure_confidence_tier} structural support{" \u00B7 "}{confidence.structure_confidence_score}/100
          </h3>
          <p className="mt-2 text-sm leading-7 text-muted">
            This is a sequence-position structural coverage summary integrating AlphaFold pLDDT, PDB coverage/resolution,
            M-CSA catalytic residues, and UniProt active/binding/conserved sites. Pocket detection and 3D distance
            calculations are not computed in this release.
          </p>
        </div>
        <div className="rounded-2xl border border-primary/20 bg-white px-5 py-4 text-center shadow-sm dark:border-white/10 dark:bg-darkmode">
          <div className="text-4xl font-black text-primary">{confidence.structure_confidence_score}</div>
          <div className="text-xs font-black uppercase tracking-[0.14em] text-muted">score</div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StructureMetric label="Best structure" value={`${confidence.best_structure_type ?? "none"} ${confidence.best_structure_id ?? ""}`.trim() || "none"} />
        <StructureMetric label="Best AlphaFold pLDDT" value={confidence.best_alphafold_plddt ? confidence.best_alphafold_plddt.toFixed(1) : "not available"} />
        <StructureMetric label="Best PDB coverage" value={confidence.best_pdb_coverage !== null ? `${Math.round(confidence.best_pdb_coverage * 100)}%` : "not available"} />
        <StructureMetric label="Best PDB resolution" value={confidence.best_pdb_resolution ? `${confidence.best_pdb_resolution} A` : "not available"} />
        <StructureMetric label="High-confidence structure" value={confidence.has_high_confidence_structure ? "yes" : "no"} />
        <StructureMetric label="Catalytic-site support" value={siteSupport} />
        <StructureMetric label="M-CSA residues in AF coverage" value={`${confidence.mcsa_residues_in_alphafold_coverage}/${confidence.mcsa_residues_with_uniprot_position}`} />
        <StructureMetric label="M-CSA residues with PDB coordinates" value={`${confidence.mcsa_residues_with_pdb_coordinates}/${confidence.mcsa_residue_count}`} />
        <StructureMetric label="AlphaFold covered range" value={afRange} />
        <StructureMetric label="Active sites in AF coverage" value={`${confidence.active_sites_in_alphafold_coverage}/${confidence.active_site_count}`} />
        <StructureMetric label="Binding sites in AF coverage" value={`${confidence.binding_sites_in_alphafold_coverage}/${confidence.binding_site_count}`} />
        <StructureMetric label="Pocket status" value={confidence.pocket_status.replaceAll("_", " ")} />
      </div>
    </div>
  );
}

function StructureMetric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-border bg-white/80 p-4 dark:border-dark_border dark:bg-darkmode/80">
      <div className="text-xs font-black uppercase tracking-[0.12em] text-muted">{label}</div>
      <div className="mt-2 break-words font-bold text-midnight_text [overflow-wrap:anywhere] dark:text-white">{value}</div>
    </div>
  );
}

function buildEnzymeEvidenceProfile({
  alphafoldCount,
  attributeEvidences,
  chassisCount,
  hasSequence,
  kinetics,
  pdbCount,
  reactionCount,
  references,
  xrefs,
  storedScore,
  storedTier,
}: {
  alphafoldCount: number;
  attributeEvidences: AttributeEvidenceRow[];
  chassisCount: number;
  hasSequence: boolean;
  kinetics: KineticRow[];
  pdbCount: number;
  reactionCount: number;
  references: ReferenceRow[];
  xrefs: XrefRow[];
  storedScore: number;
  storedTier: EvidenceProfile["tier"];
}): EvidenceProfile {
  const referencePmids = new Set(references.map((item) => item.pmid).filter(Boolean));
  const fieldPmids = new Set(attributeEvidences.flatMap((item) => parseJsonArray(item.pmids_json)));
  const kineticPmids = new Set(kinetics.flatMap((item) => parseJsonArray(item.pmids_json)));
  const xrefDbs = new Set(xrefs.map((item) => {
    const database = item.xref_db?.trim();
    return database && ["uniprot", "uniprot_secondary"].includes(database.toLowerCase()) ? "UniProt" : database;
  }).filter(Boolean));
  const structureCount = pdbCount + alphafoldCount;

  const components = [
    {
      label: "Publication PMIDs",
      value: `${referencePmids.size.toLocaleString()} unique PMIDs`,
      points: cappedPoints(referencePmids.size, 6, 6),
      maxPoints: 36,
      description: "Enzyme-level literature references linked to this protein or biopart record.",
    },
    {
      label: "Field-level PMID evidence",
      value: `${attributeEvidences.length.toLocaleString()} evidence rows; ${fieldPmids.size.toLocaleString()} PMIDs`,
      points: cappedPoints(fieldPmids.size || attributeEvidences.length, 8, 3),
      maxPoints: 24,
      description: "PMID-backed enzyme attributes retained from the source evidence layer.",
    },
    {
      label: "Kinetic PMID evidence",
      value: `${kineticPmids.size.toLocaleString()} PMIDs`,
      points: cappedPoints(kineticPmids.size, 4, 4),
      maxPoints: 16,
      description: "Kinetic rows with direct publication evidence for this enzyme.",
    },
    {
      label: "External database links",
      value: `${xrefDbs.size.toLocaleString()} identifier namespaces`,
      points: cappedPoints(xrefDbs.size, 3, 4),
      maxPoints: 12,
      description: "External identifiers available for looking up corresponding records.",
    },
    {
      label: "Protein sequence",
      value: hasSequence ? "Sequence available" : "Sequence not available",
      points: hasSequence ? 5 : 0,
      maxPoints: 5,
      description: "Protein sequence support enables reproducible downstream annotation and structure mapping.",
    },
    {
      label: "Structure support",
      value: `${structureCount.toLocaleString()} PDB/AlphaFold links`,
      points: structureCount ? 7 : 0,
      maxPoints: 7,
      description: "PDB or AlphaFold mappings provide independent structural support for the enzyme record.",
    },
    {
      label: "Reaction and annotation context",
      value: `${reactionCount.toLocaleString()} reactions; ${chassisCount.toLocaleString()} chassis annotations`,
      points: reactionCount || chassisCount ? 4 : 0,
      maxPoints: 4,
      description: "Contextual links place the enzyme inside reaction associations and source-retained chassis annotations.",
    },
  ];

  return evidenceProfileFromComponents(components, storedScore, storedTier);
}

function storedRichnessTier(value: string | null | undefined, score: number): EvidenceProfile["tier"] {
  if (value === "strong" || value === "moderate" || value === "limited") return value;
  return score >= 75 ? "strong" : score >= 45 ? "moderate" : "limited";
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

function Meta({ label, value, status = "not_reported" }: { label: string; value: React.ReactNode; status?: DataStatusKind }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd className="mt-1 font-semibold text-midnight_text dark:text-white">{displayValue(value, status)}</dd>
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

function formatSequence(sequence: string | null) {
  if (!sequence) return "Sequence not available in this release.";
  return sequence.match(/.{1,60}/g)?.join("\n") ?? sequence;
}

function ProteinAnnotationPanel({
  annotation,
  domains,
  features,
}: {
  annotation: ProteinAnnotationSummary | null;
  domains: ProteinDomainRow[];
  features: ProteinFeatureRow[];
}) {
  if (!annotation && !domains.length && !features.length) {
    return (
      <div className="rounded-2xl border border-border bg-hero-bg p-5 text-sm leading-7 text-muted dark:border-dark_border dark:bg-dark_b">
        No InterPro/Pfam or UniProt feature annotation is currently available for this enzyme.
      </div>
    );
  }

  const siteCount = (annotation?.active_site_count ?? 0) + (annotation?.binding_site_count ?? 0) + (annotation?.conserved_site_count ?? 0);

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <AnnotationStat label="InterPro entries" value={annotation?.interpro_count ?? 0} />
        <AnnotationStat label="Pfam signatures" value={annotation?.pfam_count ?? 0} />
        <AnnotationStat label="Domain features" value={annotation?.domain_feature_count ?? 0} />
        <AnnotationStat label="Functional sites" value={siteCount} />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <DomainTable domains={domains} />
        <FeatureTable features={features} />
      </div>
    </div>
  );
}

function AnnotationStat({ label, value, compact = false }: { label: string; value: React.ReactNode; compact?: boolean }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-border bg-white p-4 dark:border-dark_border dark:bg-darkmode">
      <div className="text-xs font-black uppercase tracking-[0.12em] text-muted">{label}</div>
      <div className={`mt-2 font-black text-primary [overflow-wrap:anywhere] ${compact ? "text-base leading-6" : "text-2xl leading-7"}`}>{value}</div>
    </div>
  );
}

function DomainTable({ domains }: { domains: ProteinDomainRow[] }) {
  return (
    <div className="rounded-2xl border border-border p-5 dark:border-dark_border">
      <h3 className="mb-4 text-20">InterPro / Pfam domains and families</h3>
      {domains.length ? (
        <div className="max-h-[34rem] overflow-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-hero-bg text-muted dark:bg-dark_b">
              <tr>
                <th className="px-3 py-2">Database</th>
                <th className="px-3 py-2">Entry</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Name</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border dark:divide-dark_border">
              {domains.map((domain) => (
                <tr key={`${domain.annotation_db}-${domain.entry_id}-${domain.domain_id}`} className="align-top">
                  <td className="px-3 py-2 font-semibold">{domain.annotation_db}</td>
                  <td className="px-3 py-2">
                    <a className="font-semibold text-primary hover:underline" href={domain.entry_url ?? "#"} target="_blank" rel="noreferrer">
                      {domain.entry_id}
                    </a>
                  </td>
                  <td className="px-3 py-2">{formatProteinFeatureType(domain.entry_type ?? "entry")}</td>
                  <td className="px-3 py-2">{domain.entry_name ?? <DataStatus status="not_reported" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-muted">No InterPro or Pfam entry has been mapped for this enzyme.</p>
      )}
    </div>
  );
}

function FeatureTable({ features }: { features: ProteinFeatureRow[] }) {
  return (
    <div className="rounded-2xl border border-border p-5 dark:border-dark_border">
      <h3 className="mb-4 text-20">Active, binding and conserved sites</h3>
      {features.some((feature) => feature.coordinate_status) ? (
        <p className="mb-4 text-sm text-muted">Mapped positions refer to the stored enzyme sequence. Source-only annotations retain their UniProt coordinates and are not assigned to this sequence.</p>
      ) : null}
      {features.length ? (
        <div className="max-h-[34rem] overflow-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-hero-bg text-muted dark:bg-dark_b">
              <tr>
                <th className="px-3 py-2">Feature</th>
                <th className="px-3 py-2">Position</th>
                <th className="px-3 py-2">Note / ligand</th>
                <th className="px-3 py-2">Evidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border dark:divide-dark_border">
              {features.map((feature) => (
                <tr key={feature.feature_id} className="align-top">
                  <td className="px-3 py-2 font-semibold">{formatProteinFeatureType(feature.feature_type)}</td>
                  <td className="px-3 py-2">{formatFeaturePosition(feature)}</td>
                  <td className="px-3 py-2">
                    {feature.note ?? feature.ligand ?? <DataStatus status="not_reported" />}
                    {feature.ligand && feature.note ? <div className="mt-1 text-xs text-muted">Ligand: {feature.ligand}</div> : null}
                  </td>
                  <td className="px-3 py-2">{feature.evidence ?? <DataStatus status="not_reported" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-muted">No UniProt active-site, binding-site, or conserved-site feature is currently available.</p>
      )}
    </div>
  );
}

function formatFeaturePosition(feature: ProteinFeatureRow) {
  if (feature.coordinate_status) {
    const stored = feature.position_start == null ? null : feature.position_end === feature.position_start ? `${feature.position_start}` : `${feature.position_start}–${feature.position_end}`;
    const source = feature.source_position_start == null ? "Unresolved position" : feature.source_position_end === feature.source_position_start ? `${feature.source_position_start}` : `${feature.source_position_start}–${feature.source_position_end}`;
    return <div>
      <div>{stored ? `${stored} (stored sequence)` : "Not mapped to stored sequence"}</div>
      {feature.source_uniprot_accession ? <a className="mt-1 block text-xs text-primary hover:underline" href={`https://www.uniprot.org/uniprotkb/${encodeURIComponent(feature.source_uniprot_accession)}`} target="_blank" rel="noreferrer">UniProt {feature.source_uniprot_accession}: {source}</a> : null}
    </div>;
  }
  if (!feature.position_start) return <DataStatus status="not_reported" />;
  if (!feature.position_end || feature.position_end === feature.position_start) return feature.position_start;
  return `${feature.position_start}-${feature.position_end}`;
}

function formatProteinFeatureType(value: string) {
  return value.replaceAll("_", " ").replaceAll("-", " ");
}

function KineticTable({ kinetics, checksByKineticId }: { kinetics: KineticRow[]; checksByKineticId: Map<string, KineticExternalCheckRow[]> }) {
  if (!kinetics.length) return <p className="text-muted">No kinetic parameters available for this enzyme.</p>;
  return (
    <div className="overflow-x-auto rounded-2xl border border-border dark:border-dark_border">
      <table className="w-full min-w-[1200px] text-left text-sm">
        <thead className="bg-hero-bg text-muted dark:bg-dark_b">
          <tr>
            <th className="px-4 py-3">Parameter</th>
            <th className="px-4 py-3">Value</th>
            <th className="px-4 py-3">Subject</th>
            <th className="px-4 py-3">Condition</th>
            <th className="px-4 py-3">Assignment</th>
            <th className="px-4 py-3">External validation</th>
            <th className="px-4 py-3">Evidence</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border dark:divide-dark_border">
          {kinetics.map((item, index) => (
            <tr key={item.kinetic_id || `${item.parameter_type}-${item.value_text ?? item.value_numeric}-${index}`} className="align-top">
              <td className="px-4 py-3 font-semibold">{formatKineticParameterType(item.parameter_type)}</td>
              <td className="px-4 py-3">{item.value_text ?? item.value_numeric ?? <DataStatus status="not_reported" />} {item.unit ?? ""}</td>
              <td className="px-4 py-3">{item.subject_name ?? <DataStatus status="not_reported" />}</td>
              <td className="px-4 py-3">{formatExperimentalConditions(item.condition_text) ?? <DataStatus status="not_reported" />}</td>
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
  return (
    <div className="rounded-2xl border border-border p-5 dark:border-dark_border">
      <h3 className="mb-4 text-20">Field-level evidence</h3>
      {evidences.length ? (
        <div className="max-h-[34rem] overflow-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-hero-bg text-muted dark:bg-dark_b">
              <tr>
                <th className="px-3 py-2">Attribute</th>
                <th className="px-3 py-2">Value</th>
                <th className="px-3 py-2">External validation</th>
                <th className="px-3 py-2">PMID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border dark:divide-dark_border">
              {evidences.map((item) => (
                <tr key={item.attribute_evidence_id} className="align-top">
                  <td className="px-3 py-2 font-semibold">{formatAttributeName(item.attribute_name)}</td>
                  <td className="px-3 py-2">{presentAttributeValue(item.value_text) ?? item.value_numeric ?? <DataStatus status="not_reported" />} {item.unit ?? ""} {item.external_url ? <a className="ml-2 font-semibold text-primary hover:underline" href={item.external_url} target="_blank" rel="noreferrer">External record</a> : null}</td>
                  <td className="px-3 py-2"><AttributeExternalCheck checks={checksByEvidenceId.get(item.attribute_evidence_id)} /></td>
                  <td className="px-3 py-2"><PmidBadges pmids={parseJsonArray(item.pmids_json)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-muted">No field-level PMID evidence is available for this enzyme in the web release.</p>
      )}
    </div>
  );
}

function ReferenceList({ references }: { references: ReferenceRow[] }) {
  return (
    <div className="rounded-2xl border border-border p-5 dark:border-dark_border">
      <h3 className="mb-4 text-20">Publication references</h3>
      {references.length ? (
        <ol className="grid max-h-[34rem] list-decimal gap-3 overflow-auto pl-5 text-sm leading-6">
          {references.map((reference) => (
            <li key={`${reference.reference_id}-${reference.pmid}`} className="pl-1">
              <a className="font-semibold text-primary hover:underline" href={reference.reference_url ?? `https://pubmed.ncbi.nlm.nih.gov/${reference.pmid}`} target="_blank" rel="noreferrer">
                PMID:{reference.pmid}
              </a>
              <span className="ml-2 text-muted">{reference.citation_text ?? "Citation text not available."}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-muted">No enzyme-level publication references are available in this release.</p>
      )}
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

function LinkList({ xrefs, pdb, alphafold }: { xrefs: XrefRow[]; pdb: PdbRow[]; alphafold: AlphaFoldRow[] }) {
  const links = [
    ...xrefs.map((xref) => ({ key: `${xref.xref_db}-${xref.xref_value}`, label: `${xref.xref_db}: ${xref.xref_value}`, href: xref.xref_url ?? "#" })),
    ...pdb.slice(0, 12).map((item) => ({ key: `pdb-${item.pdb_id}-${item.chain_id}`, label: `PDB: ${item.pdb_id}`, href: externalDbUrl("pdb", item.pdb_id) ?? "#" })),
    ...alphafold.slice(0, 12).map((item) => ({
      key: `alphafold-${item.uniprot_accession}-${item.model_entity_id ?? "model"}`,
      label: `AlphaFold DB: ${item.model_entity_id ?? item.uniprot_accession}`,
      href: `https://alphafold.ebi.ac.uk/entry/${item.uniprot_accession}`,
    })),
  ];

  if (!links.length) return <p className="text-muted">No external links available.</p>;
  return (
    <div className="grid gap-2 text-sm md:grid-cols-2">
      {links.map((link) => (
        <a key={link.key} className="rounded-xl border border-border px-4 py-3 font-semibold text-primary hover:border-primary dark:border-dark_border" href={link.href} target="_blank" rel="noreferrer">
          {link.label}
        </a>
      ))}
    </div>
  );
}
