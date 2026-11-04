import Link from "next/link";
import type { CSSProperties } from "react";
import { annotationCoverageLabel } from "@/lib/qualitySemantics";
import Badge from "./Badge";
import DataStatus from "./DataStatus";
import ExternalDbLink from "./ExternalDbLink";
import RowSelectAll from "./RowSelectAll";
import SortableHeader from "./SortableHeader";
import { EnzymeRow } from "@/lib/reactenzdb";

type QueryValue = string | string[] | undefined;

type SortConfig = {
  pathname: string;
  searchParams: Record<string, QueryValue>;
  currentSort: string;
  currentDir: string;
};

function HeaderLabel({ column, label, sort }: { column: string; label: string; sort?: SortConfig }) {
  if (!sort) return label;
  return <SortableHeader column={column} label={label} {...sort} />;
}

function structureLabel(pdbCount = 0, alphafoldCount = 0) {
  if (pdbCount > 0 && alphafoldCount > 0) return "PDB + AF";
  if (pdbCount > 0) return "PDB";
  if (alphafoldCount > 0) return "AlphaFold";
  return "not mapped";
}

function evidenceTone(score = 0): "green" | "blue" | "amber" | "slate" {
  if (score >= 75) return "green";
  if (score >= 45) return "blue";
  if (score > 0) return "amber";
  return "slate";
}

export default function EnzymeTable({
  enzymes,
  tableId = "enzymes-table",
  sort,
}: {
  enzymes: EnzymeRow[];
  tableId?: string;
  sort?: SortConfig;
}) {
  const managedColumns = Boolean(sort);
  return (
    <div
      data-table={tableId}
      className={`overflow-hidden rounded-2xl border border-border bg-white dark:border-dark_border dark:bg-darkmode ${managedColumns ? "reactenz-compact-list-table" : ""}`}
      style={managedColumns ? ({ "--reactenz-visible-columns": 8 } as CSSProperties) : undefined}
    >
      <div className="overflow-x-auto">
        <table
          className={`w-full text-left ${managedColumns ? "" : "min-w-[2240px]"}`}
          style={managedColumns ? { minWidth: "max(100%, calc(var(--reactenz-visible-columns, 8) * 136px + 56px))" } : undefined}
        >
          <thead className="bg-hero-bg text-sm text-muted dark:bg-dark_b">
            <tr>
              <th className="w-14 px-5 py-4 text-center"><RowSelectAll tableId={tableId} /></th>
              <th data-col="reactenz_id" className="px-5 py-4"><HeaderLabel column="reactenz_id" label="ReactEnzDB ID" sort={sort} /></th>
              <th data-col="biopart_id" className="px-5 py-4">Biopart ID</th>
              <th data-col="protein_id" className="px-5 py-4">Protein ID</th>
              <th data-col="enzyme" className="px-5 py-4"><HeaderLabel column="enzyme" label="Enzyme" sort={sort} /></th>
              <th data-col="uniprot" className="px-5 py-4"><HeaderLabel column="uniprot" label="UniProt" sort={sort} /></th>
              <th data-col="gene" className="px-5 py-4"><HeaderLabel column="gene" label="Gene" sort={sort} /></th>
              <th data-col="organism" className="px-5 py-4"><HeaderLabel column="organism" label="Source organism" sort={sort} /></th>
              <th data-col="taxonomy" className="px-5 py-4"><HeaderLabel column="taxonomy" label="Taxonomy" sort={sort} /></th>
              <th data-col="sequence_status" className="px-5 py-4"><HeaderLabel column="sequence_status" label="Seq status" sort={sort} /></th>
              <th data-col="sequence" className="px-5 py-4"><HeaderLabel column="sequence" label="Sequence" sort={sort} /></th>
              <th data-col="reactions" className="px-5 py-4"><HeaderLabel column="reactions" label="Reactions" sort={sort} /></th>
              <th data-col="structure" className="px-5 py-4"><HeaderLabel column="structure" label="Structure" sort={sort} /></th>
              <th data-col="interpro" className="px-5 py-4"><HeaderLabel column="interpro" label="InterPro" sort={sort} /></th>
              <th data-col="pfam" className="px-5 py-4"><HeaderLabel column="pfam" label="Pfam" sort={sort} /></th>
              <th data-col="protein_sites" className="px-5 py-4"><HeaderLabel column="protein_sites" label="Sites" sort={sort} /></th>
              <th data-col="pdb" className="px-5 py-4"><HeaderLabel column="pdb" label="PDB" sort={sort} /></th>
              <th data-col="alphafold" className="px-5 py-4"><HeaderLabel column="alphafold" label="AlphaFold" sort={sort} /></th>
              <th data-col="structure_confidence" className="px-5 py-4"><HeaderLabel column="structure_confidence" label="Structure score" sort={sort} /></th>
              <th data-col="high_confidence_structure" className="px-5 py-4"><HeaderLabel column="high_confidence_structure" label="High-conf structure" sort={sort} /></th>
              <th data-col="catalytic_site_support" className="px-5 py-4"><HeaderLabel column="catalytic_site_support" label="Site support" sort={sort} /></th>
              <th data-col="kinetics" className="px-5 py-4"><HeaderLabel column="kinetics" label="Kinetics" sort={sort} /></th>
              <th data-col="evidence_score" className="px-5 py-4"><HeaderLabel column="evidence_score" label="Annotation richness" sort={sort} /></th>
              <th data-col="evidence_tier" className="px-5 py-4">Evidence tier</th>
              <th data-col="chassis" className="px-5 py-4"><HeaderLabel column="chassis" label="Chassis annotations" sort={sort} /></th>
              <th data-col="evidence" className="px-5 py-4"><HeaderLabel column="evidence" label="Evidence" sort={sort} /></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border dark:divide-dark_border">
            {enzymes.map((enzyme) => (
              <tr key={enzyme.reactenz_enzyme_id} className="align-top hover:bg-hero-bg/70 dark:hover:bg-dark_b">
                <td className="px-5 py-4 text-center">
                  <input
                    type="checkbox"
                    data-row-select
                    value={enzyme.reactenz_enzyme_id}
                    aria-label={`Select ${enzyme.reactenz_enzyme_id}`}
                    className="h-4 w-4 accent-primary"
                  />
                </td>
                <td data-col="reactenz_id" className="px-5 py-4 font-bold text-primary">
                  <Link href={`/enzymes/${enzyme.reactenz_enzyme_id}`}>{enzyme.reactenz_enzyme_id}</Link>
                </td>
                <td data-col="biopart_id" className="px-5 py-4 font-mono text-xs">{enzyme.biopart_id ?? <DataStatus status="not_reported" />}</td>
                <td data-col="protein_id" className="px-5 py-4 font-mono text-xs">{enzyme.protein_id ?? <DataStatus status="not_reported" />}</td>
                <td data-col="enzyme" className="px-5 py-4 text-sm text-midnight_text dark:text-white/80">{enzyme.enzyme_name}</td>
                <td data-col="uniprot" className="px-5 py-4 text-sm">
                  {enzyme.uniprot_accession ? (
                    <ExternalDbLink db="uniprot" value={enzyme.uniprot_accession} url={enzyme.uniprot_url} />
                  ) : (
                    <DataStatus status="not_mapped" />
                  )}
                  {enzyme.uniprot_entry_name ? <div className="mt-1 text-xs text-muted">{enzyme.uniprot_entry_name}</div> : null}
                  {enzyme.uniprot_mapping_method ? <div className="mt-1 text-xs text-muted">{enzyme.uniprot_mapping_method}</div> : null}
                </td>
                <td data-col="gene" className="px-5 py-4 text-sm">{enzyme.gene_name_primary ?? <DataStatus status="not_reported" />}</td>
                <td data-col="organism" className="px-5 py-4 text-sm">
                  {enzyme.organism ? (
                    <Link
                      className="font-semibold text-primary hover:underline"
                      href={enzyme.reactenz_organism_id
                        ? `/organisms/${enzyme.reactenz_organism_id}`
                        : `/organisms?q=${encodeURIComponent(enzyme.organism)}`}
                    >
                      {enzyme.organism}
                    </Link>
                  ) : (
                    <DataStatus status="not_curated" />
                  )}
                </td>
                <td data-col="taxonomy" className="px-5 py-4 text-sm"><ExternalDbLink db="ncbi_taxonomy" value={enzyme.taxonomy_id} /></td>
                <td data-col="sequence_status" className="px-5 py-4">
                  <Badge tone={enzyme.has_sequence ? "green" : "slate"}>{enzyme.has_sequence ? "available" : "not available"}</Badge>
                </td>
                <td data-col="sequence" className="px-5 py-4">
                  <Badge tone={enzyme.has_sequence ? "green" : "slate"}>{enzyme.sequence_length ?? 0} aa</Badge>
                </td>
                <td data-col="reactions" className="px-5 py-4 text-sm">{enzyme.reaction_count}</td>
                <td data-col="structure" className="px-5 py-4">
                  <Badge tone={(enzyme.structure_count ?? 0) > 0 ? "blue" : "slate"}>
                    {structureLabel(enzyme.pdb_count ?? 0, enzyme.alphafold_count ?? 0)}
                  </Badge>
                </td>
                <td data-col="interpro" className="px-5 py-4 text-sm">{enzyme.interpro_count?.toLocaleString() ?? 0}</td>
                <td data-col="pfam" className="px-5 py-4 text-sm">{enzyme.pfam_count?.toLocaleString() ?? 0}</td>
                <td data-col="protein_sites" className="px-5 py-4 text-sm">
                  {((enzyme.active_site_count ?? 0) + (enzyme.binding_site_count ?? 0) + (enzyme.conserved_site_count ?? 0)).toLocaleString()}
                </td>
                <td data-col="pdb" className="px-5 py-4 text-sm">{enzyme.pdb_count?.toLocaleString() ?? 0}</td>
                <td data-col="alphafold" className="px-5 py-4 text-sm">{enzyme.alphafold_count?.toLocaleString() ?? 0}</td>
                <td data-col="structure_confidence" className="px-5 py-4">
                  <Badge tone={evidenceTone(enzyme.structure_confidence_score)}>
                    {enzyme.structure_confidence_tier ?? "no_structure"} · {enzyme.structure_confidence_score ?? 0}/100
                  </Badge>
                </td>
                <td data-col="high_confidence_structure" className="px-5 py-4">
                  <Badge tone={enzyme.has_high_confidence_structure ? "green" : "slate"}>
                    {enzyme.has_high_confidence_structure ? "yes" : "no"}
                  </Badge>
                </td>
                <td data-col="catalytic_site_support" className="px-5 py-4 text-sm">
                  {enzyme.catalytic_site_support_level?.replaceAll("_", " ") ?? "none"}
                </td>
                <td data-col="kinetics" className="px-5 py-4 text-sm">{enzyme.kinetic_count?.toLocaleString() ?? 0}</td>
                <td data-col="evidence_score" className="px-5 py-4">
                  <Badge tone={evidenceTone(enzyme.evidence_score)}>
                    {annotationCoverageLabel(enzyme.evidence_tier)} · {enzyme.evidence_score ?? 0}/100
                  </Badge>
                </td>
                <td data-col="evidence_tier" className="px-5 py-4 text-sm">{enzyme.evidence_tier ?? <DataStatus status="not_reported" />}</td>
                <td data-col="chassis" className="px-5 py-4 text-sm">{enzyme.chassis_count?.toLocaleString() ?? 0}</td>
                <td data-col="evidence" className="px-5 py-4 text-sm">{enzyme.evidence_label ?? <DataStatus status="not_curated" />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
