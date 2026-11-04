import Link from "next/link";
import type { CSSProperties } from "react";
import { annotationCoverageLabel } from "@/lib/qualitySemantics";
import Badge from "./Badge";
import DataStatus from "./DataStatus";
import ExternalDbLink, { ExternalDbLinks } from "./ExternalDbLink";
import RowSelectAll from "./RowSelectAll";
import SortableHeader from "./SortableHeader";
import { ReactionRow } from "@/lib/reactenzdb";

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

function enzymeStructureText(reaction: ReactionRow) {
  const structured = reaction.structured_enzyme_count ?? 0;
  if (structured === 0) return "not mapped";
  return `${structured.toLocaleString()} enzymes`;
}

function evidenceTone(score = 0): "green" | "blue" | "amber" | "slate" {
  if (score >= 75) return "green";
  if (score >= 45) return "blue";
  if (score > 0) return "amber";
  return "slate";
}

function qualityTone(value: string | null | undefined): "green" | "blue" | "amber" | "slate" {
  if (!value) return "slate";
  if (value === "balanced" || value === "complete" || value === "complete_or_not_applicable") return "green";
  if (value === "unbalanced" || value.includes("missing")) return "amber";
  return "slate";
}

export default function ReactionTable({
  reactions,
  tableId = "reactions-table",
  sort,
}: {
  reactions: ReactionRow[];
  tableId?: string;
  sort?: SortConfig;
}) {
  const managedColumns = Boolean(sort);
  return (
    <div
      data-table={tableId}
      className={`overflow-hidden rounded-2xl border border-border bg-white dark:border-dark_border dark:bg-darkmode ${managedColumns ? "reactenz-compact-list-table" : ""}`}
      style={managedColumns ? ({ "--reactenz-visible-columns": 6 } as CSSProperties) : undefined}
    >
      <div className="overflow-x-auto">
        <table
          className={`w-full text-left ${managedColumns ? "" : "min-w-[2240px]"}`}
          style={managedColumns ? { minWidth: "max(100%, calc(var(--reactenz-visible-columns, 6) * 136px + 56px))" } : undefined}
        >
          <thead className="bg-hero-bg text-sm text-muted dark:bg-dark_b">
            <tr>
              <th className="w-14 px-5 py-4 text-center"><RowSelectAll tableId={tableId} /></th>
              <th data-col="reactenz_id" className="px-5 py-4"><HeaderLabel column="reactenz_id" label="ReactEnzDB ID" sort={sort} /></th>
              <th data-col="internal_id" className="px-5 py-4">Internal reaction ID</th>
              <th data-col="equation" className="px-5 py-4"><HeaderLabel column="equation" label="Equation" sort={sort} /></th>
              <th data-col="direction" className="px-5 py-4"><HeaderLabel column="direction" label="Direction" sort={sort} /></th>
              <th data-col="dataset" className="px-5 py-4">Dataset level</th>
              <th data-col="participants" className="px-5 py-4"><HeaderLabel column="participants" label="Participants" sort={sort} /></th>
              <th data-col="smiles" className="px-5 py-4"><HeaderLabel column="smiles" label="SMILES" sort={sort} /></th>
              <th data-col="enzymes" className="px-5 py-4"><HeaderLabel column="enzymes" label="Enzymes" sort={sort} /></th>
              <th data-col="pairs" className="px-5 py-4"><HeaderLabel column="pairs" label="Associations" sort={sort} /></th>
              <th data-col="kinetics" className="px-5 py-4"><HeaderLabel column="kinetics" label="Kinetics" sort={sort} /></th>
              <th data-col="evidence_score" className="px-5 py-4"><HeaderLabel column="evidence_score" label="Annotation richness" sort={sort} /></th>
              <th data-col="evidence_tier" className="px-5 py-4">Annotation tier</th>
              <th data-col="ec" className="px-5 py-4"><HeaderLabel column="ec" label="EC" sort={sort} /></th>
              <th data-col="rhea" className="px-5 py-4"><HeaderLabel column="rhea" label="Rhea" sort={sort} /></th>
              <th data-col="kegg" className="px-5 py-4"><HeaderLabel column="kegg" label="KEGG" sort={sort} /></th>
              <th data-col="metacyc" className="px-5 py-4"><HeaderLabel column="metacyc" label="MetaCyc" sort={sort} /></th>
              <th data-col="mnxref" className="px-5 py-4"><HeaderLabel column="mnxref" label="MNXref" sort={sort} /></th>
              <th data-col="structure" className="px-5 py-4"><HeaderLabel column="structure" label="Compound structure" sort={sort} /></th>
              <th data-col="standardization" className="px-5 py-4">Reaction standardization</th>
              <th data-col="enzyme_structure" className="px-5 py-4"><HeaderLabel column="enzyme_structure" label="Enzyme structure" sort={sort} /></th>
              <th data-col="pdb" className="px-5 py-4"><HeaderLabel column="pdb" label="PDB enzymes" sort={sort} /></th>
              <th data-col="alphafold" className="px-5 py-4"><HeaderLabel column="alphafold" label="AlphaFold enzymes" sort={sort} /></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border dark:divide-dark_border">
            {reactions.map((reaction) => (
              <tr key={reaction.reactenz_reaction_id} className="align-top hover:bg-hero-bg/70 dark:hover:bg-dark_b">
                <td className="px-5 py-4 text-center">
                  <input
                    type="checkbox"
                    data-row-select
                    value={reaction.reactenz_reaction_id}
                    aria-label={`Select ${reaction.reactenz_reaction_id}`}
                    className="h-4 w-4 accent-primary"
                  />
                </td>
                <td data-col="reactenz_id" className="px-5 py-4 font-bold text-primary">
                  <Link href={`/reactions/${reaction.reactenz_reaction_id}`}>{reaction.reactenz_reaction_id}</Link>
                </td>
                <td data-col="internal_id" className="px-5 py-4 font-mono text-xs">{reaction.reaction_id ?? <DataStatus status="not_reported" />}</td>
                <td data-col="equation" className="max-w-3xl px-5 py-4 text-sm leading-6 text-midnight_text dark:text-white/80">
                  {reaction.reaction_equation_display}
                </td>
                <td data-col="direction" className="px-5 py-4 text-sm">{reaction.reaction_direction ?? <DataStatus status="not_curated" />}</td>
                <td data-col="dataset" className="px-5 py-4 text-sm">{reaction.dataset_level ?? <DataStatus status="not_reported" />}</td>
                <td data-col="participants" className="px-5 py-4 text-sm">{reaction.participant_count?.toLocaleString() ?? <DataStatus status="not_curated" />}</td>
                <td data-col="smiles" className="px-5 py-4 text-sm">
                  {(reaction.smiles_count ?? 0).toLocaleString()} mapped; {(reaction.missing_smiles_count ?? 0).toLocaleString()} unresolved
                </td>
                <td data-col="enzymes" className="px-5 py-4 text-sm font-semibold text-primary">
                  <Link href={`/enzymes?reactionId=${encodeURIComponent(reaction.reactenz_reaction_id)}&sequence=false`}>
                    {reaction.enzyme_count?.toLocaleString()}
                  </Link>
                </td>
                <td data-col="pairs" className="px-5 py-4 text-sm">{reaction.enzyme_pair_count?.toLocaleString()}</td>
                <td data-col="kinetics" className="px-5 py-4 text-sm">{reaction.kinetics_count?.toLocaleString()}</td>
                <td data-col="evidence_score" className="px-5 py-4">
                  <Badge tone={evidenceTone(reaction.evidence_score)}>
                    {annotationCoverageLabel(reaction.evidence_tier)} · {reaction.evidence_score ?? 0}/100
                  </Badge>
                </td>
                <td data-col="evidence_tier" className="px-5 py-4 text-sm">{reaction.evidence_level ?? reaction.evidence_tier ?? <DataStatus status="not_reported" />}</td>
                <td data-col="ec" className="px-5 py-4 text-sm"><ExternalDbLinks db="ec" value={reaction.ec_number} /></td>
                <td data-col="rhea" className="px-5 py-4 text-sm"><ExternalDbLink db="rhea" value={reaction.rhea_id} /></td>
                <td data-col="kegg" className="px-5 py-4 text-sm"><ExternalDbLink db="kegg_reaction" value={reaction.kegg_reaction_id} /></td>
                <td data-col="metacyc" className="px-5 py-4 text-sm"><ExternalDbLink db="metacyc_reaction" value={reaction.metacyc_reaction_id} /></td>
                <td data-col="mnxref" className="px-5 py-4 text-sm"><ExternalDbLinks db="mnx_reaction" value={reaction.mnx_reaction_ids} /></td>
                <td data-col="structure" className="px-5 py-4">
                  <Badge tone={reaction.all_participants_have_smiles ? "green" : "slate"}>
                    {reaction.all_participants_have_smiles ? "SMILES complete" : "partial"}
                  </Badge>
                </td>
                <td data-col="standardization" className="px-5 py-4">
                  <div className="flex max-w-[280px] flex-wrap gap-1.5">
                    <Badge tone={qualityTone(reaction.full_mass_balance_status)}>mass {reaction.full_mass_balance_status?.replaceAll("_", " ") ?? "unknown"}</Badge>
                    <Badge tone={qualityTone(reaction.stereo_completeness_status)}>stereo {reaction.stereo_completeness_status?.replaceAll("_", " ") ?? "unknown"}</Badge>
                    {reaction.exact_rhea_identity ? <Badge tone="green">exact Rhea</Badge> : null}
                    {reaction.atom_mapping_available ? <Badge tone="blue">atom-mapped</Badge> : null}
                    <Badge tone={(reaction.mapping_conflict_count ?? 0) > 0 ? "amber" : "green"}>{reaction.mapping_conflict_count ?? 0} conflicts</Badge>
                  </div>
                </td>
                <td data-col="enzyme_structure" className="px-5 py-4">
                  <Badge tone={(reaction.structured_enzyme_count ?? 0) > 0 ? "blue" : "slate"}>
                    {enzymeStructureText(reaction)}
                  </Badge>
                </td>
                <td data-col="pdb" className="px-5 py-4 text-sm">{reaction.pdb_enzyme_count?.toLocaleString() ?? 0}</td>
                <td data-col="alphafold" className="px-5 py-4 text-sm">{reaction.alphafold_enzyme_count?.toLocaleString() ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
