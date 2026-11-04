import Badge from "@/components/ReactEnz/Badge";
import DataStatus from "@/components/ReactEnz/DataStatus";
import type {
  McsaCompoundRow,
  McsaEntryRow,
  McsaMechanismRow,
  McsaMechanismStepRow,
  McsaReferenceRow,
  McsaResidueRow,
} from "@/lib/reactenzdb";

type Props = {
  entries: McsaEntryRow[];
  residues: McsaResidueRow[];
  mechanisms: McsaMechanismRow[];
  steps: McsaMechanismStepRow[];
  compounds: McsaCompoundRow[];
  references: McsaReferenceRow[];
  scope: "enzyme" | "reaction";
};

export default function McsaMechanismPanel({ entries, residues, mechanisms, steps, compounds, references, scope }: Props) {
  if (!entries.length) {
    return (
      <p className="text-muted">
        No M-CSA catalytic residue or mechanism annotation is currently mapped for this {scope}.
      </p>
    );
  }

  const scopeText =
    scope === "enzyme"
      ? "High-confidence M-CSA annotations mapped by exact UniProt accession."
      : "M-CSA mechanism context mapped by exact EC number; this is reaction-level context, not direct evidence for every linked enzyme.";

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-primary/15 bg-gradient-to-br from-white via-hero-bg to-primary/5 p-5 dark:border-white/10 dark:from-darkmode dark:via-dark_b dark:to-primary/10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.18em] text-muted">M-CSA mechanism layer</div>
            <h3 className="mt-2 text-24 text-midnight_text dark:text-white">
              {entries.length.toLocaleString()} entries · {residues.length.toLocaleString()} catalytic residues
            </h3>
            <p className="mt-2 max-w-4xl text-sm leading-7 text-muted">{scopeText}</p>
          </div>
          <Badge tone={scope === "enzyme" ? "green" : "blue"}>{scope === "enzyme" ? "UniProt exact" : "EC context"}</Badge>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {entries.map((entry) => {
          const entryMechanisms = mechanisms.filter((item) => item.mcsa_id === entry.mcsa_id);
          const entryCompounds = compounds.filter((item) => item.mcsa_id === entry.mcsa_id);
          const entryReferences = references.filter((item) => item.mcsa_id === entry.mcsa_id);
          return (
            <div key={entry.mcsa_id} className="rounded-2xl border border-border bg-white p-5 dark:border-dark_border dark:bg-darkmode">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <a className="text-20 font-black text-primary hover:underline" href={entry.entry_url ?? `https://www.ebi.ac.uk/thornton-srv/m-csa/entry/${entry.mcsa_id}/`} target="_blank" rel="noreferrer">
                    M-CSA {entry.mcsa_id}: {entry.enzyme_name ?? "enzyme mechanism"}
                  </a>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <Badge tone={entry.detailed_mechanism_count ? "green" : "blue"}>
                      {entry.detailed_mechanism_count ? "detailed mechanism" : "catalytic site"}
                    </Badge>
                    <Badge tone="slate">EC {parseJsonArray(entry.all_ecs_json).join(", ") || "not reported"}</Badge>
                    {entry.matched_uniprot ? <Badge tone="blue">UniProt {entry.matched_uniprot}</Badge> : null}
                    {entry.matched_ec ? <Badge tone="blue">matched EC {entry.matched_ec}</Badge> : null}
                  </div>
                </div>
                <div className="text-right text-xs font-semibold text-muted">
                  {entry.residue_count.toLocaleString()} residues<br />
                  {entry.mechanism_count.toLocaleString()} mechanisms
                </div>
              </div>
              {entry.description ? <p className="mt-4 line-clamp-4 text-sm leading-7 text-muted">{entry.description}</p> : null}
              <MechanismList mechanisms={entryMechanisms} steps={steps} />
              <CompoundList compounds={entryCompounds} />
              <ReferenceList references={entryReferences} />
            </div>
          );
        })}
      </div>

      <ResidueTable residues={residues} />
    </div>
  );
}

function MechanismList({ mechanisms, steps }: { mechanisms: McsaMechanismRow[]; steps: McsaMechanismStepRow[] }) {
  if (!mechanisms.length) return null;
  return (
    <div className="mt-5 space-y-3">
      <div className="text-xs font-black uppercase tracking-[0.14em] text-muted">Mechanism summary</div>
      {mechanisms.map((mechanism) => {
        const mechanismSteps = steps.filter((step) => step.mcsa_id === mechanism.mcsa_id && step.mechanism_id === mechanism.mechanism_id);
        return (
          <div key={`${mechanism.mcsa_id}-${mechanism.mechanism_id}`} className="rounded-xl bg-hero-bg p-4 dark:bg-dark_b">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={mechanism.is_detailed ? "green" : "blue"}>mechanism {mechanism.mechanism_id}</Badge>
              {mechanism.rating ? <span className="text-xs font-semibold text-muted">rating {mechanism.rating}</span> : null}
            </div>
            {mechanism.components_summary ? <div className="mt-2 text-sm font-semibold text-midnight_text dark:text-white">{mechanism.components_summary}</div> : null}
            {mechanism.mechanism_text ? <p className="mt-2 text-sm leading-7 text-muted">{mechanism.mechanism_text}</p> : null}
            {mechanismSteps.length ? (
              <ol className="mt-3 grid list-decimal gap-2 pl-5 text-xs leading-6 text-muted">
                {mechanismSteps.slice(0, 6).map((step) => (
                  <li key={`${step.mcsa_id}-${step.mechanism_id}-${step.step_id}`}>
                    {step.description ?? "Mechanism step"}
                    {step.figure_url ? (
                      <a className="ml-2 font-semibold text-primary hover:underline" href={step.figure_url} target="_blank" rel="noreferrer">
                        scheme
                      </a>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function CompoundList({ compounds }: { compounds: McsaCompoundRow[] }) {
  if (!compounds.length) return null;
  return (
    <div className="mt-5">
      <div className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-muted">M-CSA reactants/products/cofactors</div>
      <div className="flex flex-wrap gap-2 text-xs">
        {compounds.slice(0, 12).map((compound) => (
          <span key={compound.mcsa_compound_id} className="rounded-full bg-primary/10 px-2.5 py-1 font-semibold text-primary">
            {compound.compound_type ?? "compound"}: {compound.compound_name ?? compound.chebi_id ?? "not named"}
          </span>
        ))}
      </div>
    </div>
  );
}

function ReferenceList({ references }: { references: McsaReferenceRow[] }) {
  if (!references.length) return null;
  const unique = references.filter((reference, index, list) => {
    const key = reference.pubmed_id ?? reference.doi ?? reference.title;
    return key && list.findIndex((item) => (item.pubmed_id ?? item.doi ?? item.title) === key) === index;
  });
  return (
    <div className="mt-5">
      <div className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-muted">Mechanism literature</div>
      <div className="flex flex-wrap gap-2 text-xs">
        {unique.slice(0, 10).map((reference) =>
          reference.pubmed_id ? (
            <a key={reference.mcsa_reference_id} className="rounded-full bg-primary/10 px-2.5 py-1 font-semibold text-primary hover:bg-primary hover:text-white" href={`https://pubmed.ncbi.nlm.nih.gov/${reference.pubmed_id}`} target="_blank" rel="noreferrer">
              PMID:{reference.pubmed_id}
            </a>
          ) : (
            <span key={reference.mcsa_reference_id} className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-600">
              {reference.doi ?? "reference"}
            </span>
          ),
        )}
      </div>
    </div>
  );
}

function ResidueTable({ residues }: { residues: McsaResidueRow[] }) {
  if (!residues.length) return null;
  return (
    <div className="overflow-x-auto rounded-2xl border border-border dark:border-dark_border">
      <table className="w-full min-w-[980px] text-left text-sm">
        <thead className="bg-hero-bg text-muted dark:bg-dark_b">
          <tr>
            <th className="px-4 py-3">M-CSA</th>
            <th className="px-4 py-3">UniProt residue</th>
            <th className="px-4 py-3">PDB residue</th>
            <th className="px-4 py-3">Roles</th>
            <th className="px-4 py-3">Annotation</th>
            <th className="px-4 py-3">Domain</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border dark:divide-dark_border">
          {residues.slice(0, 120).map((residue) => (
            <tr key={residue.mcsa_residue_id} className="align-top">
              <td className="px-4 py-3 font-semibold">
                <a className="text-primary hover:underline" href={`https://www.ebi.ac.uk/thornton-srv/m-csa/entry/${residue.mcsa_id}/`} target="_blank" rel="noreferrer">
                  {residue.mcsa_id}
                </a>
              </td>
              <td className="px-4 py-3">
                {residue.uniprot_residue_code && residue.uniprot_residue_position ? `${residue.uniprot_residue_code}${residue.uniprot_residue_position}` : <DataStatus status="not_reported" />}
                {residue.uniprot_id ? <div className="text-xs text-muted">{residue.uniprot_id}</div> : null}
              </td>
              <td className="px-4 py-3">
                {residue.pdb_id ? (
                  <a className="font-semibold text-primary hover:underline" href={`https://www.rcsb.org/structure/${residue.pdb_id}`} target="_blank" rel="noreferrer">
                    {residue.pdb_id}:{residue.pdb_chain ?? "-"} {residue.pdb_residue_code ?? ""}{residue.pdb_residue_position ?? ""}
                  </a>
                ) : (
                  <DataStatus status="not_reported" />
                )}
              </td>
              <td className="px-4 py-3">{residue.roles_summary ?? <DataStatus status="not_reported" />}</td>
              <td className="px-4 py-3">{residue.main_annotation || residue.ptm || <DataStatus status="not_reported" />}</td>
              <td className="px-4 py-3">{residue.domain_name ?? residue.domain_cath_id ?? <DataStatus status="not_reported" />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean) : [];
  } catch {
    return [];
  }
}
