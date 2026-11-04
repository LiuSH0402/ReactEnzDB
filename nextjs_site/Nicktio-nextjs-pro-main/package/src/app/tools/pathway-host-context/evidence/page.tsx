import Link from "next/link";
import type { Metadata } from "next";
import { ParentBackLink } from "@/components/ReactEnz/ParentBackLink";
import { formatKineticParameterType, getReaction, getReactionKinetics, getEnzymeProteinDomains, getEnzymeProteinFeatures, getEnzymeReferences, getEnzymeMcsaEntries, getPdbMappings, getAlphaFoldMappings } from "@/lib/reactenzdb";
import { getCandidateEvidenceBoard } from "@/lib/candidateEvidenceBoard";
import { evidenceLevels, type EvidenceLevel } from "@/lib/candidateEvidenceLogic";
import { getHostRegistryPreview } from "@/lib/hostRegistryPreview";
import { getLocalMappingsForReactions, localMappingPreviewAvailable } from "@/lib/hostMappingLocalPreview";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Candidate enzyme evidence board", robots: { index: false, follow: false } };
type Props = { searchParams: Promise<{ reactionId?: string; releaseId?: string; level?: string; page?: string }> };

export default async function LocalEvidenceBoard({ searchParams }: Props) {
  const params = await searchParams;
  if (!localMappingPreviewAvailable()) return (
    <main className="reactenz-container reactenz-page">
      <section className="reactenz-page-compact-hero overflow-hidden lg:p-8">
        <p className="reactenz-eyebrow">Host Context · unreviewed preview</p>
        <h1>Evidence board unavailable</h1>
        <p className="reactenz-page-copy">This unreviewed host-context view is disabled in this deployment.</p>
      </section>
    </main>
  );
  const publicId = params.reactionId?.trim() ?? "";
  const level: EvidenceLevel = evidenceLevels.includes(params.level as EvidenceLevel) ? params.level as EvidenceLevel : "nr90";
  const reaction = /^R\d{5}$/.test(publicId) ? getReaction(publicId) : null;
  const board = reaction ? getCandidateEvidenceBoard(reaction.reaction_id, level, Number(params.page) || 1, 30) : null;
  const host = (getHostRegistryPreview() ?? []).find((item) => item.release_id === params.releaseId);
  const mapping = reaction && host ? getLocalMappingsForReactions([reaction.reaction_id], [host.release_id])?.[0] : null;
  const kinetics = reaction ? getReactionKinetics(reaction.reaction_id, 250) : [];
  const kineticsByEnzyme = new Map<string, typeof kinetics>();
  for (const row of kinetics) if (row.biopart_id) kineticsByEnzyme.set(row.biopart_id, [...(kineticsByEnzyme.get(row.biopart_id) ?? []), row]);
  const details = (board?.representatives ?? []).map((row) => ({
    ...row,
    flags: board?.flags.get(row.biopart_id),
    domains: getEnzymeProteinDomains(row.biopart_id, 20),
    sites: getEnzymeProteinFeatures(row.biopart_id, 30).filter((item) => item.feature_type === "active_site"),
    mcsa: getEnzymeMcsaEntries(row.biopart_id, 3),
    references: getEnzymeReferences(row.biopart_id, 4),
    pdb: getPdbMappings(row.biopart_id).slice(0, 1),
    alphafold: getAlphaFoldMappings(row.biopart_id).slice(0, 1),
    kinetics: (kineticsByEnzyme.get(row.biopart_id) ?? []).slice(0, 3),
  }));
  const urlFor = (next: EvidenceLevel) => `/tools/pathway-host-context/evidence?reactionId=${encodeURIComponent(publicId)}${host ? `&releaseId=${encodeURIComponent(host.release_id)}` : ""}&level=${next}`;
  const pageUrl = (next: number) => `${urlFor(level)}&page=${next}`;
  return <main className="reactenz-container reactenz-page">
    <ParentBackLink href="/tools/pathway-host-context" label="Pathway Host Context" />
    <section className="reactenz-page-compact-hero overflow-hidden lg:p-8">
      <p className="reactenz-eyebrow">Host Context · unreviewed preview</p>
      <h1>Candidate enzyme evidence board</h1>
      <p className="reactenz-page-copy">Reaction-specific evidence and independent NR100/90/70/50 sequence views. Representatives are chosen by the number of populated evidence categories, never by host suitability. This board is not an expression or feasibility prediction.</p>
    </section>
    {!reaction || !board ? <div className="mt-8 border-l-4 border-amber-500 bg-amber-50 px-5 py-4 text-sm text-amber-950">Enter a valid public reaction ID using the pathway workbench, or open a supported reaction such as <Link className="font-bold underline" href="/tools/pathway-host-context/evidence?reactionId=R00711">R00711</Link>.</div> : <>
      <div className="mt-7 border-y border-border py-5 text-sm dark:border-dark_border">
        <Link className="font-bold text-primary" href={`/reactions/${encodeURIComponent(publicId)}`}>Reaction {publicId} →</Link>
        <span className="mx-3 text-muted">|</span>
        {host ? <span><strong>{host.scientific_name} · {host.strain}</strong> / {host.model_name} · fixed release <code>{host.release_id}</code></span> : <span className="text-muted">No host release selected; evidence is reaction-specific only.</span>}
        {host ? <p className="mt-2 text-xs text-muted">Unreviewed model mapping: <strong>{mapping?.mapping_status ?? "NO_MATRIX_ROW"}</strong>. This is a fixed-model record, not biological absence or candidate–host compatibility.</p> : null}
      </div>
      <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="All associated enzymes" value={board.total_associated_enzymes} />
        <Metric label="Sequence candidates" value={board.diversity.sequence_candidates} />
        <Metric label="NR100 clusters" value={board.diversity.nr100} />
        <Metric label="NR90 clusters" value={board.diversity.nr90} />
        <Metric label="NR70 clusters" value={board.diversity.nr70} />
        <Metric label="NR50 clusters" value={board.diversity.nr50} />
      </div>
      <p className="mt-3 text-xs leading-5 text-muted">NR levels are independent similarity views, not nested lineage levels. Sequence clustering excludes associated enzymes without usable sequence; NR100 is not labelled a count of unique exact sequences.</p>
      <nav aria-label="Candidate diversity view" className="mt-7 flex flex-wrap gap-2">
        {evidenceLevels.map((item) => <Link aria-current={level === item ? "page" : undefined} className={`border px-4 py-2 text-sm font-bold ${level === item ? "border-primary bg-primary text-white" : "border-border text-primary hover:border-primary dark:border-dark_border"}`} href={urlFor(item)} key={item}>{item === "all" ? "All" : item.toUpperCase()}</Link>)}
      </nav>
      <p className="mt-3 text-xs text-muted">{level === "all" ? "All sequence-bearing candidates" : `One evidence-completeness representative per ${level.toUpperCase()} cluster`}; {board.total_view_candidates.toLocaleString()} in this view, page {board.page} of {board.page_count}. Open the full candidate-set workspace for other selection intents.</p>
      {details.length ? <div className="mt-6 space-y-5">{details.map((row, index) => <article className="border-t border-border pt-5 dark:border-dark_border" key={row.biopart_id}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-xs font-bold uppercase tracking-wider text-muted">{index + 1}. Evidence completeness {row.evidence_completeness}/8 · {level === "all" ? "candidate" : `${level.toUpperCase()} representative`}</p><h2 className="mt-2 text-xl font-black"><Link className="text-primary hover:underline" href={`/enzymes/${encodeURIComponent(row.reactenz_enzyme_id)}`}>{row.reactenz_enzyme_id}</Link> <span className="font-normal text-midnight_text dark:text-white">{row.enzyme_name || "Unnamed enzyme"}</span></h2><p className="mt-1 text-sm text-muted">Source organism: {row.organism || "not reported"}{row.taxonomy_id ? ` · taxon ${row.taxonomy_id}` : ""}</p></div>
          <Link className="text-xs font-bold text-primary hover:underline" href={`/sequence-families/candidates?reactionId=${encodeURIComponent(publicId)}&mode=best-supported`}>Full candidate sets →</Link>
        </div>
        <div className="mt-4 grid gap-x-8 gap-y-3 text-sm leading-6 md:grid-cols-2 xl:grid-cols-3">
          <Evidence label="Reaction identity" value={`${row.is_known_active ? "strict known-active" : "association; exact catalytic evidence not established"} · ${row.best_evidence_class?.replaceAll("_", " ") ?? "class unavailable"} · rank ${row.best_evidence_rank ?? "unknown"}`} note={`${row.catalytic_assertion_count} catalytic assertions; ${row.reaction_exact_external_count} exact external checks; source ${row.flags?.source_db || "not recorded"}; link evidence ${row.flags?.evidence_level || "not recorded"}`} />
          <Evidence label="Sequence" value={row.sequence_length > 0 ? `${row.sequence_length} aa${row.protein_id ? ` · ${row.protein_id}` : ""}` : "unavailable"} note="Open enzyme detail for sequence and UniProt mapping provenance." />
          <Evidence label="Family" value={`Pfam ${row.domains.filter((item) => item.annotation_db === "Pfam").map((item) => item.entry_id).slice(0, 3).join(", ") || "not recorded"}; InterPro ${row.domains.filter((item) => item.annotation_db === "InterPro").map((item) => item.entry_id).slice(0, 3).join(", ") || "not recorded"}`} />
          <Evidence label="Structure" value={`${row.pdb_count} PDB entries · ${row.alphafold_count} AlphaFold models`} note={`${row.pdb[0] ? `PDB ${row.pdb[0].pdb_id} (${row.pdb[0].experimental_method || "method unspecified"})` : "No PDB example"}; ${row.alphafold[0] ? `AlphaFold ${row.alphafold[0].model_entity_id || "predicted model"}` : "no AlphaFold model"}`} />
          <Evidence label="Catalytic sites" value={`${row.active_site_count} site annotations · ${row.mcsa_count} M-CSA links`} note={row.sites[0] ? `${row.sites[0].feature_type} ${row.sites[0].position_start ?? "?"}; coordinate status ${row.sites[0].coordinate_status ?? "not recorded"}` : row.mcsa[0] ? `M-CSA ${row.mcsa[0].mcsa_id}; mapping type ${row.mcsa[0].match_type}` : "No site detail recorded"} />
          <Evidence label="Reaction-linked kinetics" value={row.kinetics.length ? row.kinetics.map((item) => `${formatKineticParameterType(item.parameter_type)} ${item.value_text ?? item.value_numeric ?? "value unavailable"} ${item.unit ?? ""}`.trim()).join("; ") : "No strict reaction-linked kinetic row displayed"} note={row.kinetics[0] ? `${row.kinetics[0].source_db ?? "source unavailable"}; ${row.kinetics[0].condition_text || "conditions not recorded"}; ${row.kinetics[0].reaction_assignment_status ?? "assignment unspecified"}` : `${row.reaction_kinetic_count} snapshot-linked kinetic records`} />
          <Evidence label="Literature" value={`${row.citation_count} reaction evidence citations; ${row.references.length} enzyme references shown`} note={row.references.map((item) => item.pmid ? `PMID ${item.pmid}` : item.citation_text?.slice(0, 80) || item.source_db).filter(Boolean).slice(0, 2).join("; ") || "No enzyme-level reference displayed"} />
          <Evidence label="Sequence diversity" value={`NR100 ${row.nr100_cluster_id}; NR90 ${row.nr90_cluster_id}; NR70 ${row.nr70_cluster_id}; NR50 ${row.nr50_cluster_id}`} />
        </div>
      </article>)}</div> : <p className="mt-7 border-l-4 border-amber-500 pl-4 text-sm text-muted">No sequence-bearing candidate is available for this reaction. This does not mean no enzyme association exists.</p>}
      {board.page_count > 1 ? <nav aria-label="Evidence candidate pages" className="mt-7 flex items-center gap-5 text-sm font-bold"><span>Page {board.page} / {board.page_count}</span>{board.page > 1 ? <Link className="text-primary hover:underline" href={pageUrl(board.page - 1)}>← Previous</Link> : null}{board.page < board.page_count ? <Link className="text-primary hover:underline" href={pageUrl(board.page + 1)}>Next →</Link> : null}</nav> : null}
      <p className="mt-8 border-l-2 border-primary pl-4 text-xs leading-6 text-muted">Evidence completeness counts eight populated categories: exact-reaction support, sequence, reaction-linked kinetics, family, structure, catalytic site, literature, and source organism. A populated category is not a quality score. Ties use stable enzyme ID only. Neither this order nor any NR representative implies host suitability, expression success, catalytic activity in a new host, or pathway feasibility.</p>
    </>}
  </main>;
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="border-l-2 border-primary pl-3"><div className="text-2xl font-black">{value.toLocaleString()}</div><div className="text-xs text-muted">{label}</div></div>; }
function Evidence({ label, value, note }: { label: string; value: string; note?: string }) { return <div><h3 className="text-xs font-black uppercase tracking-wide text-muted">{label}</h3><p className="mt-1 break-words font-semibold text-midnight_text dark:text-white">{value}</p>{note ? <p className="mt-1 break-words text-xs text-muted">{note}</p> : null}</div>; }
