import { formatExperimentalConditions } from "@/lib/experimentalConditions";
import Image from "next/image";
import ReportedExperimentalObservations from "@/components/ReactEnz/ReportedExperimentalObservations";
import Badge from "@/components/ReactEnz/Badge";
import ExperimentalExpressionEvidence from "@/components/ReactEnz/ExperimentalExpressionEvidence";
import ExternalDbLink, { ExternalDbLinks } from "@/components/ReactEnz/ExternalDbLink";
import McsaMechanismPanel from "@/components/ReactEnz/McsaMechanismPanel";
import ReactionStandardizationPanel from "@/components/ReactEnz/ReactionStandardizationPanel";
import SpecificReactionEvidence from "@/components/ReactEnz/SpecificReactionEvidence";
import StructureViewer from "@/components/ReactEnz/StructureViewer";
import { getEnzymeEvidenceBundle, getReactionEvidenceBundle } from "@/lib/evidence-release";
import { getExpressionEvidenceForEnzyme, getExpressionEvidenceForOrganism, getExpressionEvidenceForReaction } from "@/lib/expressionEvidence";
import { getReactionStandardizationBundle } from "@/lib/reaction-standardization";
import { getEnzymeClusterMemberships } from "@/lib/sequenceClusters";
import {
  getAlphaFoldMappings,
  getEnzyme,
  getEnzymeAttributeEvidences,
  getEnzymeChassis,
  getEnzymeKinetics,
  getEnzymeMcsaCompounds,
  getEnzymeMcsaEntries,
  getEnzymeMcsaMechanisms,
  getEnzymeMcsaMechanismSteps,
  getEnzymeMcsaReferences,
  getEnzymeMcsaResidues,
  getEnzymeProteinAnnotation,
  getEnzymeProteinDomains,
  getEnzymeProteinFeatures,
  getEnzymeReferences,
  getEnzymeXrefs,
  getOrganism,
  getPdbMappings,
  getReaction,
  getReactionAttributeEvidences,
  getReactionCompounds,
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
  type KineticRow,
  type ReferenceRow,
  type XrefRow,
} from "@/lib/reactenzdb";

type Props = { reactionId: string; biopartId: string; organismId: string | null };

export default function ReoCompositeDetails({ reactionId, biopartId, organismId }: Props) {
  const reaction = getReaction(reactionId);
  const enzyme = getEnzyme(biopartId);
  const organism = organismId ? getOrganism(organismId) : null;
  if (!reaction || !enzyme) return null;

  const reactionCompounds = getReactionCompounds(reaction.reaction_id);
  const reactionKinetics = getReactionKinetics(reaction.reaction_id, 80);
  const reactionReferences = getReactionReferences(reaction.reaction_id, 80);
  const reactionEvidence = getReactionAttributeEvidences(reaction.reaction_id, 100);
  const reactionXrefs = withoutRdbsb(getReactionXrefs(reaction.reaction_id));
  const reactionPathways = getReactionPathways(reaction.reaction_id);
  const reactionStandardization = getReactionStandardizationBundle(reaction.reaction_id);
  const reactionExpression = getExpressionEvidenceForReaction(reaction.reaction_id, reaction.reactenz_reaction_id, 12);
  const reactionActivity = getReactionEvidenceBundle(reaction.reactenz_reaction_id, { limit: 30, pairLimit: 80 });
  const reactionMcsa = {
    entries: getReactionMcsaEntries(reaction.reaction_id, 12),
    residues: getReactionMcsaResidues(reaction.reaction_id, 160),
    mechanisms: getReactionMcsaMechanisms(reaction.reaction_id, 20),
    steps: getReactionMcsaMechanismSteps(reaction.reaction_id, 180),
    compounds: getReactionMcsaCompounds(reaction.reaction_id, 120),
    references: getReactionMcsaReferences(reaction.reaction_id, 160),
  };

  const pdb = getPdbMappings(enzyme.biopart_id);
  const alphafold = getAlphaFoldMappings(enzyme.biopart_id);
  const enzymeKinetics = getEnzymeKinetics(enzyme.biopart_id, 80);
  const enzymeReferences = getEnzymeReferences(enzyme.biopart_id, 100);
  const enzymeEvidence = getEnzymeAttributeEvidences(enzyme.biopart_id, 80);
  const enzymeXrefs = withoutRdbsb(getEnzymeXrefs(enzyme.biopart_id));
  const enzymeChassis = getEnzymeChassis(enzyme.biopart_id);
  const proteinAnnotation = getEnzymeProteinAnnotation(enzyme.biopart_id);
  const domains = getEnzymeProteinDomains(enzyme.biopart_id, 80);
  const features = getEnzymeProteinFeatures(enzyme.biopart_id, 80);
  const families = getEnzymeClusterMemberships(enzyme.biopart_id, true);
  const enzymeExpression = getExpressionEvidenceForEnzyme(enzyme.biopart_id, enzyme.reactenz_enzyme_id, 12);
  const enzymeActivity = getEnzymeEvidenceBundle(enzyme.reactenz_enzyme_id, { limit: 30, pairLimit: 80 });
  const enzymeMcsa = {
    entries: getEnzymeMcsaEntries(enzyme.biopart_id, 12),
    residues: getEnzymeMcsaResidues(enzyme.biopart_id, 160),
    mechanisms: getEnzymeMcsaMechanisms(enzyme.biopart_id, 20),
    steps: getEnzymeMcsaMechanismSteps(enzyme.biopart_id, 180),
    compounds: getEnzymeMcsaCompounds(enzyme.biopart_id, 120),
    references: getEnzymeMcsaReferences(enzyme.biopart_id, 160),
  };
  const organismExpression = organism ? getExpressionEvidenceForOrganism(organism.organism, 12) : [];
  const structureCoverage = organism?.enzyme_count
    ? Math.round(((organism.structured_enzyme_count ?? 0) / organism.enzyme_count) * 100)
    : 0;

  return (
    <div className="mt-12 space-y-16">
      <EntitySection code="01 · R" eyebrow="Reaction detail" id="reo-reaction" title="Biochemical transformation">
        <MetaGrid rows={[
          ["ReactEnzDB reaction ID", reaction.reactenz_reaction_id],
          ["Internal reaction ID", reaction.reaction_id],
          ["Direction", reaction.reaction_direction || "Not curated"],
          ["Participants", reaction.participant_count.toLocaleString()],
          ["SMILES coverage", `${reaction.smiles_count}/${reaction.participant_count}`],
          ["Kinetic records", reaction.kinetics_count.toLocaleString()],
          ["Evidence level", reaction.evidence_level || "Not curated"],
          ["Structure coverage", reaction.dataset_level || "Not assigned"],
        ]} />
        <DetailBlock id="reo-reaction-function" title="Catalytic function">
          <p className="bg-hero-bg px-5 py-4 text-lg font-bold leading-8 text-midnight_text dark:bg-dark_b dark:text-white">{reaction.reaction_equation_display}</p>
          {reaction.reaction_equation_raw && reaction.reaction_equation_raw !== reaction.reaction_equation_display ? <p className="mt-3 text-sm text-muted">Raw equation: {reaction.reaction_equation_raw}</p> : null}
          <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Identifier label="EC"><ExternalDbLinks db="ec" value={reaction.ec_number} /></Identifier>
            <Identifier label="Rhea"><ExternalDbLink db="rhea" value={reaction.rhea_id} /></Identifier>
            <Identifier label="KEGG"><ExternalDbLink db="kegg_reaction" value={reaction.kegg_reaction_id} /></Identifier>
            <Identifier label="MetaCyc"><ExternalDbLink db="metacyc_reaction" value={reaction.metacyc_reaction_id} /></Identifier>
            <Identifier label="Cross references">{reactionXrefs.length.toLocaleString()}</Identifier>
          </div>
        </DetailBlock>
        <DetailBlock id="reo-reaction-identity" title="Reaction identity and mapping quality">
          {reactionStandardization ? <ReactionStandardizationPanel bundle={reactionStandardization} /> : <Empty>No reaction-standardization record is available.</Empty>}
        </DetailBlock>
        <DetailBlock id="reo-reaction-participants" title="Participants and structures">
          <div className="grid gap-7 lg:grid-cols-2">
            <CompoundList title="Reactants" compounds={reactionCompounds.filter((item) => item.side === "left")} />
            <CompoundList title="Products" compounds={reactionCompounds.filter((item) => item.side === "right")} />
          </div>
        </DetailBlock>
        <DetailBlock id="reo-reaction-pathways" title="Pathway context">
          {reactionPathways.length ? <SimpleTable headings={["Pathway", "Name", "Mapping"]} rows={reactionPathways.map((item) => [item.pathway_id, item.pathway_name || "Not reported", item.mapping_method || "Not reported"])} /> : <Empty>No pathway membership is currently mapped.</Empty>}
        </DetailBlock>
        <DetailBlock id="reo-reaction-mechanism" title="Catalytic mechanism context"><McsaMechanismPanel {...reactionMcsa} scope="reaction" /></DetailBlock>
        <DetailBlock id="reo-reaction-activity" title="Reaction-specific activity evidence"><SpecificReactionEvidence bundle={reactionActivity} /></DetailBlock>
        <DetailBlock id="reo-reaction-expression" title="Expression evidence"><ExperimentalExpressionEvidence bundles={reactionExpression} title="Expression evidence linked through this reaction" /></DetailBlock>
        <DetailBlock id="reo-reaction-kinetics" title="Kinetic parameters"><KineticTable rows={reactionKinetics} /></DetailBlock>
        <DetailBlock id="reo-reaction-evidence" title="Evidence, literature and external identifiers">
          <EvidenceAndReferences evidences={reactionEvidence} references={reactionReferences} xrefs={reactionXrefs} />
        </DetailBlock>
      </EntitySection>

      <EntitySection code="02 · E" eyebrow="Enzyme detail" id="reo-enzyme" title="Catalytic candidate">
        <MetaGrid rows={[
          ["ReactEnzDB enzyme ID", enzyme.reactenz_enzyme_id],
          ["Internal biopart ID", enzyme.biopart_id],
          ["Enzyme name", enzyme.enzyme_name || "Not curated"],
          ["Gene", enzyme.gene_name_primary || "Not reported"],
          ["Protein ID", enzyme.protein_id || "Not mapped"],
          ["UniProt accession", enzyme.uniprot_accession || "Not mapped"],
          ["Sequence", enzyme.has_sequence ? `${enzyme.sequence_length ?? 0} aa` : "Not available"],
          ["Evidence", enzyme.evidence_label || "Not curated"],
        ]} />
        <DetailBlock id="reo-enzyme-names" title="Names and taxonomy">
          <MetaGrid rows={[
            ["Protein / enzyme name", enzyme.enzyme_name || "Not curated"],
            ["Gene name", enzyme.gene_name_primary || "Not reported"],
            ["UniProt entry", enzyme.uniprot_entry_name || "Not mapped"],
            ["UniProt mapping", enzyme.uniprot_mapping_method || "Not mapped"],
            ["Source organism", enzyme.organism || "Not curated"],
            ["NCBI taxonomy ID", enzyme.taxonomy_id || "Not mapped"],
            ["Lineage", enzyme.lineage?.split(";").filter(Boolean).join(" / ") || "Not reported"],
            ["Chassis annotations", (enzyme.chassis_count ?? 0).toLocaleString()],
          ]} />
        </DetailBlock>
        <DetailBlock id="reo-enzyme-sequence" title="Protein sequence">
          {enzyme.protein_sequence ? <details className="group"><summary className="cursor-pointer font-black text-primary">Show complete sequence · {enzyme.sequence_length?.toLocaleString()} aa</summary><pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap break-all bg-hero-bg p-5 font-mono text-sm leading-7 dark:bg-dark_b">{enzyme.protein_sequence}</pre></details> : <Empty>No protein sequence is available.</Empty>}
        </DetailBlock>
        <DetailBlock id="reo-enzyme-families" title="Non-redundant sequence family membership">
          {families.length ? <SimpleTable headings={["Identity", "Cluster", "Enzymes", "Species", "Evidence"]} rows={families.map((item) => [`NR${item.threshold}`, item.cluster_id, item.enzyme_record_count.toLocaleString(), item.species_count.toLocaleString(), `${item.experimental_supported_count} experimental · ${item.kinetic_supported_count} kinetic`])} /> : <Empty>No sequence-family membership is available.</Empty>}
        </DetailBlock>
        <DetailBlock id="reo-enzyme-annotation" title="Protein family, domain and functional-site annotation">
          <AnnotationSummary annotation={proteinAnnotation} />
          {domains.length ? <div className="mt-6"><SimpleTable headings={["Database", "Entry", "Name", "Type"]} rows={domains.map((item) => [item.annotation_db, item.entry_id, item.entry_name || "Not reported", item.entry_type || "Not reported"])} /></div> : null}
          {features.length ? <div className="mt-6"><SimpleTable headings={["Feature", "Position", "Ligand", "Note"]} rows={features.map((item) => [item.feature_type, formatPosition(item.position_start, item.position_end), item.ligand || "—", item.note || item.feature_text || "Not reported"])} /></div> : null}
        </DetailBlock>
        <DetailBlock id="reo-enzyme-mechanism" title="Catalytic residues and mechanism"><McsaMechanismPanel {...enzymeMcsa} scope="enzyme" /></DetailBlock>
        <DetailBlock id="reo-enzyme-activity" title="Reaction-specific activity evidence"><SpecificReactionEvidence bundle={enzymeActivity} /></DetailBlock>
        <DetailBlock id="reo-enzyme-expression" title="Expression evidence"><ExperimentalExpressionEvidence bundles={enzymeExpression} title="Expression hosts and outcomes linked to this enzyme" /></DetailBlock>
        <DetailBlock id="reo-enzyme-kinetics" title="Kinetic parameters"><KineticTable rows={enzymeKinetics} /></DetailBlock>
        <ReportedExperimentalObservations biopartId={enzyme.biopart_id} />
        <DetailBlock id="reo-enzyme-structure" title="Protein structure"><StructureViewer pdb={pdb} alphafold={alphafold} /></DetailBlock>
        <DetailBlock id="reo-enzyme-chassis" title="Chassis annotations">
          <p className="mb-4 text-sm leading-7 text-muted">These are source-retained annotation labels. They are not curated host recommendations or experimental compatibility claims.</p>
          {enzymeChassis.length ? <SimpleTable headings={["Chassis ID", "Annotation label", "Association records", "Reactions"]} rows={enzymeChassis.map((item) => [item.reactenz_chassis_id || "Not assigned", item.label, item.record_count.toLocaleString(), item.reaction_count.toLocaleString()])} /> : <Empty>No chassis annotation is available.</Empty>}
        </DetailBlock>
        <DetailBlock id="reo-enzyme-evidence" title="Evidence, literature and external identifiers">
          <EvidenceAndReferences evidences={enzymeEvidence} references={enzymeReferences} xrefs={enzymeXrefs} />
        </DetailBlock>
      </EntitySection>

      <EntitySection code="PROVENANCE" eyebrow="Context, not a third association entity" id="reo-organism" title="Source-organism provenance">
        {organism ? <>
          <MetaGrid rows={[
            ["ReactEnzDB source-organism ID", organism.reactenz_organism_id],
            ["Source organism", organism.organism],
            ["Association records", organism.relation_count.toLocaleString()],
            ["Associated reactions", organism.reaction_count.toLocaleString()],
            ["Associated enzymes", organism.enzyme_count.toLocaleString()],
            ["Chassis annotations", organism.chassis_count.toLocaleString()],
            ["Structured enzymes", (organism.structured_enzyme_count ?? 0).toLocaleString()],
            ["Structure coverage", `${structureCoverage}%`],
          ]} />
          <DetailBlock id="reo-organism-expression" title="Expression evidence"><ExperimentalExpressionEvidence bundles={organismExpression} title={`Expression evidence linked to enzymes from ${organism.organism}`} /></DetailBlock>
          <DetailBlock id="reo-organism-structure" title="Structure coverage">
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
              <Metric value={organism.enzyme_count} label="Total enzymes" />
              <Metric value={organism.structured_enzyme_count ?? 0} label="PDB or AlphaFold" />
              <Metric value={organism.pdb_enzyme_count ?? 0} label="PDB-mapped" />
              <Metric value={organism.alphafold_enzyme_count ?? 0} label="AlphaFold-mapped" />
            </div>
          </DetailBlock>
        </> : <Empty>The source organism is not assigned in this association record.</Empty>}
      </EntitySection>
    </div>
  );
}

function withoutRdbsb<T extends { source_db?: string | null }>(rows: T[]): T[] {
  return rows.filter((row) => !row.source_db?.toLowerCase().includes("rdbsb"));
}

function EntitySection({ code, eyebrow, id, title, children }: { code: string; eyebrow: string; id: string; title: string; children: React.ReactNode }) {
  return <section className="scroll-mt-8" id={id}><div className="mb-2 flex flex-wrap items-end justify-between gap-4 border-l-2 border-primary bg-[linear-gradient(90deg,rgba(235,244,253,0.9),rgba(248,251,253,0.35))] px-6 py-6 dark:bg-dark_b"><div><p className="reactenz-eyebrow">{eyebrow}</p><h2 className="mt-2 !text-[36px]">{title}</h2></div><span className="font-mono text-sm font-black tracking-[0.18em] text-primary">{code}</span></div><div>{children}</div></section>;
}

function DetailBlock({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return <section className="reactenz-detail-section scroll-mt-8 border-b border-border py-8 last:border-b-0 dark:border-dark_border" id={id}><h3 className="mb-5 text-[26px] font-black leading-tight text-midnight_text dark:text-white">{title}</h3>{children}</section>;
}

function MetaGrid({ rows }: { rows: Array<[string, string]> }) {
  return <dl className="grid border-l border-t border-border dark:border-dark_border md:grid-cols-2 xl:grid-cols-4">{rows.map(([label, value]) => <div className="border-b border-r border-border p-5 dark:border-dark_border" key={label}><dt className="text-xs font-black uppercase tracking-[0.12em] text-muted">{label}</dt><dd className="mt-2 break-words font-semibold leading-7 text-midnight_text dark:text-white">{value}</dd></div>)}</dl>;
}

function Identifier({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="border-l-2 border-primary/40 pl-4"><p className="text-xs font-black uppercase tracking-[0.12em] text-muted">{label}</p><div className="mt-2 font-bold text-primary">{children}</div></div>;
}

function CompoundList({ title, compounds }: { title: string; compounds: ReturnType<typeof getReactionCompounds> }) {
  return <div><h4 className="mb-4 text-lg font-black">{title}</h4><div className="divide-y divide-border border-y border-border dark:divide-dark_border dark:border-dark_border">{compounds.map((item) => { const src = imageUrl(item.image_path); return <div className="grid grid-cols-[76px_1fr] gap-4 py-4" key={`${item.compound_id}:${item.position_index}`}><div className="relative h-[68px] bg-white">{src ? <Image alt="" className="object-contain" fill sizes="76px" src={src} /> : null}</div><div><strong className="text-midnight_text dark:text-white">{item.compound_name || item.compound_id}</strong><p className="mt-1 font-mono text-xs text-muted">{item.compound_id}{item.formula ? ` · ${item.formula}` : ""}</p><p className="mt-2 break-all text-xs leading-5 text-muted">{item.smiles || "SMILES not available"}</p></div></div>; })}</div></div>;
}

function KineticTable({ rows }: { rows: KineticRow[] }) {
  return rows.length ? <SimpleTable headings={["Parameter", "Value", "Subject", "Conditions", "Assignment"]} rows={rows.map((item) => [formatKineticParameterType(item.parameter_type), item.value_text || [item.value_numeric, item.unit].filter(Boolean).join(" ") || "Not reported", item.subject_name || "Not reported", formatExperimentalConditions(item.condition_text) || "Not reported", item.reaction_assignment_status || "Not curated"])} /> : <Empty>No kinetic parameters are available.</Empty>;
}

function EvidenceAndReferences({ evidences, references, xrefs }: { evidences: AttributeEvidenceRow[]; references: ReferenceRow[]; xrefs: XrefRow[] }) {
  return <div className="space-y-7">{evidences.length ? <SimpleTable headings={["Attribute", "Value", "External ID", "Literature"]} rows={evidences.map((item) => [item.attribute_name.replaceAll("_", " "), item.value_text || [item.value_numeric, item.unit].filter(Boolean).join(" ") || "Not reported", item.external_id || "—", item.pmids_json || "—"])} /> : <Empty>No field-level evidence is available.</Empty>}{references.length ? <SimpleTable headings={["PMID", "Citation"]} rows={references.map((item) => [item.pmid, item.citation_text || "Citation text not available"])} /> : null}{xrefs.length ? <SimpleTable headings={["Database", "Identifier"]} rows={xrefs.map((item) => [item.xref_db, item.xref_value])} /> : null}</div>;
}

function AnnotationSummary({ annotation }: { annotation: ReturnType<typeof getEnzymeProteinAnnotation> }) {
  if (!annotation) return <Empty>No protein annotation summary is available.</Empty>;
  return <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-6"><Metric value={annotation.interpro_count} label="InterPro" /><Metric value={annotation.pfam_count} label="Pfam" /><Metric value={annotation.domain_feature_count} label="Domains" /><Metric value={annotation.active_site_count} label="Active sites" /><Metric value={annotation.binding_site_count} label="Binding sites" /><Metric value={annotation.conserved_site_count} label="Conserved sites" /></div>;
}

function Metric({ value, label }: { value: number; label: string }) {
  return <div className="border-l-2 border-primary/45 pl-4"><div className="text-3xl font-black text-midnight_text dark:text-white">{Number(value).toLocaleString()}</div><div className="mt-1 text-xs font-black uppercase tracking-[0.1em] text-muted">{label}</div></div>;
}

function SimpleTable({ headings, rows }: { headings: string[]; rows: string[][] }) {
  return <div className="overflow-x-auto border border-border dark:border-dark_border"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-hero-bg text-xs uppercase tracking-[0.1em] text-muted dark:bg-dark_b"><tr>{headings.map((item) => <th className="px-4 py-3" key={item}>{item}</th>)}</tr></thead><tbody className="divide-y divide-border dark:divide-dark_border">{rows.map((row, rowIndex) => <tr className="align-top transition-colors hover:bg-primary/[0.025]" key={rowIndex}>{row.map((item, index) => <td className="max-w-[440px] break-words px-4 py-3 leading-6" key={index}>{item}</td>)}</tr>)}</tbody></table></div>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="border-y border-border py-5 text-sm leading-7 text-muted dark:border-dark_border">{children}</p>;
}

function formatPosition(start: number | null, end: number | null): string {
  if (start == null && end == null) return "Not reported";
  if (start === end || end == null) return String(start);
  return `${start}–${end}`;
}
