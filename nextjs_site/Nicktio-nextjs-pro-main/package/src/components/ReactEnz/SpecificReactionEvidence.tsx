import PairLiteratureEvidence from "@/components/ReactEnz/PairLiteratureEvidence";
import Link from "next/link";
import Badge from "@/components/ReactEnz/Badge";
import type {
  EnzymeEvidenceSummary,
  EvidenceAssertion,
  EvidenceAssayCondition,
  EvidenceBundle,
  EvidenceCitation,
  EvidenceMeasurement,
  ReactionEvidenceSummary,
} from "@/lib/evidence-release";

export default function SpecificReactionEvidence({ bundle }: { bundle: EvidenceBundle }) {
  const { release, summary } = bundle;
  if (!release.available) {
    return (<>
      <PairLiteratureEvidence records={bundle.literature_records} />
      <div className="border-l-4 border-amber-400 bg-amber-50 px-5 py-4 text-sm leading-7 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
        The reaction-specific evidence release is not mounted on this server. The core ReactEnzDB record remains available.
      </div>
    </>);
  }

  if (!summary) {
    return (<>
      <PairLiteratureEvidence records={bundle.literature_records} />
      <div className="border border-border px-5 py-4 text-sm leading-7 text-muted dark:border-dark_border">
        No assay-level assertion is currently mapped to this record in {release.metadata.release_version ?? "the evidence release"}. Absence here means “not yet mapped”, not evidence of inactivity.
      </div>
    </>);
  }

  const reactionSummary = bundle.target === "reaction" ? (summary as ReactionEvidenceSummary) : null;
  const enzymeSummary = bundle.target === "enzyme" ? (summary as EnzymeEvidenceSummary) : null;
  const measurementsByAssertion = groupBy(bundle.measurements, (row) => row.assertion_id);
  const citationsByAssertion = groupBy(bundle.citations, (row) => row.assertion_id);
  const conditionsByAssertion = groupBy(bundle.assay_conditions, (row) => row.assertion_id);

  return (
    <div className="space-y-6">
      <PairLiteratureEvidence records={bundle.literature_records} />
      <div className="border-l-4 border-primary bg-primary/5 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="blue">{release.metadata.release_version ?? "Evidence RC"}</Badge>
            <Badge tone={release.metadata.release_status === "release_candidate" ? "amber" : "green"}>
              {(release.metadata.release_status ?? "available").replaceAll("_", " ")}
            </Badge>
            <span className="text-sm font-semibold text-midnight_text dark:text-white">
              Reaction-specific evidence layer
            </span>
          </div>
          <a className="text-sm font-black text-primary hover:underline" href="/api/reactenzdb/evidence/status">API status</a>
        </div>
        <p className="mt-3 max-w-5xl text-sm leading-6 text-muted dark:text-white/60">
          Automatic strict structure matches are shown separately from literature-verified assertions. A same-EC or sequence annotation is not treated as proof that this enzyme catalyzes the exact substrate–product pair.
        </p>
      </div>

      <dl className="grid gap-x-8 gap-y-4 border-y border-border py-5 text-sm dark:border-dark_border sm:grid-cols-2 xl:grid-cols-6">
        <EvidenceStat label={bundle.target === "reaction" ? "Enzymes with evidence" : "Reactions tested"} value={reactionSummary?.enzyme_count ?? enzymeSummary?.reaction_count ?? 0} />
        <EvidenceStat label="Assertions" value={summary.assertion_count} />
        <EvidenceStat label={bundle.target === "reaction" ? "Exact enzymes" : "Exact reactions"} value={reactionSummary?.exact_enzyme_count ?? enzymeSummary?.exact_reaction_count ?? 0} />
        <EvidenceStat label="Catalytic assertions" value={summary.catalytic_assertion_count} />
        <EvidenceStat label="Inactive / negative" value={summary.inactive_or_negative_count} />
        <EvidenceStat label="Citations" value={summary.citation_count} />
      </dl>

      {bundle.brenda_context_records.length ? (
        <details className="border-y border-border py-4 dark:border-dark_border">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-black text-midnight_text dark:text-white">
            <span>EC-level context ({bundle.brenda_context_records.length.toLocaleString()} records shown)</span>
            <span className="text-xl text-primary">+</span>
          </summary>
          <p className="mt-3 max-w-5xl text-sm leading-6 text-muted">
            These pH, temperature, cofactor, inhibitor, metal, expression, cloning, activator, and modification records share an EC context. They are supporting context only and are not automatically assigned to this specific enzyme–reaction assay.
          </p>
          <div className="mt-4 max-h-[30rem] overflow-auto border border-border dark:border-dark_border">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="bg-hero-bg text-xs uppercase tracking-wider text-muted dark:bg-dark_b">
                <tr><th className="px-4 py-3">Context</th><th className="px-4 py-3">Value</th><th className="px-4 py-3">Organism</th><th className="px-4 py-3">EC</th><th className="px-4 py-3">Unresolved reference IDs</th></tr>
              </thead>
              <tbody className="divide-y divide-border dark:divide-dark_border">
                {bundle.brenda_context_records.map((row) => (
                  <tr key={row.context_id} className="align-top">
                    <td className="px-4 py-3 font-semibold">{formatLabel(row.context_type)}</td>
                    <td className="px-4 py-3">{contextValue(row.value_text, row.value_max_text)}</td>
                    <td className="px-4 py-3">{row.organism ?? "not reported"}</td>
                    <td className="px-4 py-3 font-mono text-xs">{row.ec_number}</td>
                    <td className="px-4 py-3 text-xs text-muted">{parseStringArray(row.literature_ids_json).join(", ") || "not mapped"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}

      <div>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-20">Ranked reaction–enzyme evidence</h3>
            <p className="mt-1 text-sm text-muted">Ordered by evidence class, exact-match count, literature verification, citations, and measurements—not by predicted performance.</p>
          </div>
          <a
            className="text-sm font-black text-primary hover:underline"
            href={bundle.target === "reaction"
              ? `/api/reactenzdb/reactions/${encodeURIComponent(String((summary as ReactionEvidenceSummary).reactenz_reaction_id))}/evidence?limit=100&pairLimit=250`
              : `/api/reactenzdb/enzymes/${encodeURIComponent(String((summary as EnzymeEvidenceSummary).reactenz_enzyme_id))}/evidence?limit=100&pairLimit=250`}
          >
            JSON API
          </a>
        </div>
        <div className="overflow-x-auto border border-border dark:border-dark_border">
          <table className="w-full min-w-[1050px] text-left text-sm">
            <thead className="bg-hero-bg text-xs uppercase tracking-wider text-muted dark:bg-dark_b">
              <tr>
                <th className="px-4 py-3">{bundle.target === "reaction" ? "Enzyme" : "Reaction"}</th>
                <th className="px-4 py-3">Best evidence</th>
                <th className="px-4 py-3">Exact / catalytic</th>
                <th className="px-4 py-3">Negative</th>
                <th className="px-4 py-3">Measurements / citations</th>
                <th className="px-4 py-3">Review</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border dark:divide-dark_border">
              {bundle.reaction_enzyme_summaries.map((row) => (
                <tr key={`${row.reaction_id}-${row.biopart_id}`} className="align-top hover:bg-hero-bg/60 dark:hover:bg-dark_b">
                  <td className="px-4 py-3">
                    <Link className="font-black text-primary hover:underline" href={bundle.target === "reaction" ? `/enzymes/${encodeURIComponent(row.reactenz_enzyme_id)}` : `/reactions/${encodeURIComponent(row.reactenz_reaction_id)}`}>
                      {bundle.target === "reaction" ? row.reactenz_enzyme_id : row.reactenz_reaction_id}
                    </Link>
                  </td>
                  <td className="px-4 py-3"><Badge tone={evidenceTone(row.best_evidence_rank)}>{formatLabel(row.best_evidence_class)}</Badge></td>
                  <td className="px-4 py-3 font-semibold">{row.exact_assertion_count} / {row.catalytic_assertion_count}</td>
                  <td className="px-4 py-3">{row.inactive_or_negative_count || "—"}</td>
                  <td className="px-4 py-3">{row.measurement_count} / {row.citation_count}</td>
                  <td className="px-4 py-3">
                    <span className="font-semibold text-emerald-700 dark:text-emerald-300">{row.literature_verified_count} verified</span>
                    {row.literature_discrepancy_count ? <div className="mt-1 font-semibold text-red-700 dark:text-red-300">{row.literature_discrepancy_count} discrepancy</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="text-20">Assay assertions and quantitative context</h3>
        <p className="mt-1 text-sm text-muted">
          Showing {bundle.assertions.length.toLocaleString()} of {bundle.pagination.total.toLocaleString()} filtered assertions. Values retain the source form and, where safely convertible, a release-normalized value.
          {bundle.assertion_scope === "same_ec_background"
            ? " This list contains same-EC background records, not evidence for the target substrate–product pair."
            : " Same-EC records for different substrates are excluded from this list and its total; they remain available via the API evidenceClass filter."}
        </p>
        <div className="mt-3 divide-y divide-border border-y border-border dark:divide-dark_border dark:border-dark_border">
          {bundle.assertions.map((assertion) => (
            <AssertionRow
              key={assertion.assertion_id}
              assertion={assertion}
              measurements={measurementsByAssertion.get(assertion.assertion_id) ?? []}
              citations={citationsByAssertion.get(assertion.assertion_id) ?? []}
              conditions={conditionsByAssertion.get(assertion.assertion_id) ?? []}
              target={bundle.target}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function AssertionRow({ assertion, measurements, citations, conditions, target }: {
  assertion: EvidenceAssertion;
  measurements: EvidenceMeasurement[];
  citations: EvidenceCitation[];
  conditions: EvidenceAssayCondition[];
  target: "reaction" | "enzyme";
}) {
  const counterpartId = target === "reaction" ? assertion.primary_reactenz_enzyme_id : assertion.reactenz_reaction_id;
  const counterpartHref = target === "reaction" ? `/enzymes/${encodeURIComponent(counterpartId ?? "")}` : `/reactions/${encodeURIComponent(counterpartId ?? "")}`;
  return (
    <details className="group py-4">
      <summary className="grid cursor-pointer list-none gap-3 md:grid-cols-[minmax(180px,1.1fr)_minmax(200px,1.5fr)_minmax(140px,0.8fr)_minmax(160px,1fr)_24px] md:items-center">
        <div>
          {counterpartId ? <Link className="font-black text-primary hover:underline" href={counterpartHref}>{counterpartId}</Link> : <span className="font-semibold text-muted">Unmapped counterpart</span>}
          {assertion.duplicate_group_member_count > 1 ? <div className="mt-1 text-xs font-semibold text-muted">Canonical record · {assertion.duplicate_group_member_count} duplicate source assertions</div> : null}
        </div>
        <div><Badge tone={evidenceTone(assertion.evidence_rank)}>{assertion.display_evidence_label}</Badge></div>
        <div className="text-sm font-semibold">{formatLabel(assertion.outcome_class)}</div>
        <div className="text-xs leading-5 text-muted">{measurements.length} measurements · {citations.length} citations · {conditions.length} conditions</div>
        <span className="text-xl font-black text-primary transition group-open:rotate-45">+</span>
      </summary>
      <div className="mt-4 grid gap-5 bg-hero-bg/70 p-4 dark:bg-dark_b md:grid-cols-2 xl:grid-cols-4">
        <EvidenceDetail label="Identity boundary" value={`${formatLabel(assertion.enzyme_identity_status)}; ${formatLabel(assertion.substrate_identity_status)}; ${formatLabel(assertion.product_identity_status)}`} />
        <EvidenceDetail label="Enzyme form" value={[assertion.wild_type_status, assertion.mutation_text, assertion.form_accession].filter(Boolean).join(" · ") || "not reported"} />
        <EvidenceDetail label="Curation" value={formatLabel(assertion.curation_status)} />
        <EvidenceDetail label="External record" value={assertion.source_url ? <a className="font-semibold text-primary hover:underline" href={assertion.source_url} target="_blank" rel="noreferrer">{assertion.source_record_id}</a> : assertion.source_record_id} />
        <div className="md:col-span-2">
          <div className="text-xs font-black uppercase tracking-wider text-muted">Measurements</div>
          <ul className="mt-2 space-y-1 text-sm">{measurements.length ? measurements.map((row) => <li key={row.measurement_id}>{formatMeasurement(row)}</li>) : <li className="text-muted">No quantitative measurement.</li>}</ul>
        </div>
        <div>
          <div className="text-xs font-black uppercase tracking-wider text-muted">Conditions</div>
          <ul className="mt-2 space-y-1 text-sm">{conditions.length ? conditions.map((row) => <li key={row.condition_id}>{formatCondition(row)}</li>) : <li className="text-muted">No structured assay condition.</li>}</ul>
        </div>
        <div>
          <div className="text-xs font-black uppercase tracking-wider text-muted">Literature</div>
          <ul className="mt-2 space-y-1 text-sm">{citations.length ? citations.map((row, index) => <li key={`${row.pmid}-${row.doi}-${index}`}>{citationLink(row)}</li>) : <li className="text-muted">No PMID or DOI mapped.</li>}</ul>
        </div>
      </div>
    </details>
  );
}

function EvidenceStat({ label, value }: { label: string; value: number }) {
  return <div><dt className="text-xs font-black uppercase tracking-wider text-muted">{label}</dt><dd className="mt-1 text-2xl font-black text-midnight_text dark:text-white">{value.toLocaleString()}</dd></div>;
}

function EvidenceDetail({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><div className="text-xs font-black uppercase tracking-wider text-muted">{label}</div><div className="mt-2 text-sm leading-6 text-midnight_text dark:text-white">{value}</div></div>;
}

function evidenceTone(rank: number): "green" | "blue" | "amber" | "slate" {
  if (rank === 1) return "green";
  if (rank === 2) return "blue";
  if (rank <= 4) return "amber";
  return "slate";
}

function formatLabel(value: string | null | undefined) {
  return value ? value.replaceAll("_", " ") : "not reported";
}

function contextValue(value: string | null, maximum: string | null) {
  if (value && maximum) return `${value}–${maximum}`;
  return value ?? maximum ?? "reported; value not available";
}

function parseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function formatMeasurement(row: EvidenceMeasurement) {
  const rawValue = row.raw_value_text ?? row.raw_value_numeric;
  const normalized = row.release_normalization_status === "normalized" && row.release_normalized_value !== null
    ? ` → ${row.release_normalized_value.toLocaleString()} ${row.release_normalized_unit ?? ""}`
    : "";
  return `${row.parameter_type_canonical}: ${rawValue ?? "not reported"} ${row.raw_unit ?? ""}${normalized}${row.subject_name ? ` (${row.subject_name})` : ""}`;
}

function formatCondition(row: EvidenceAssayCondition) {
  return [row.ph !== null ? `pH ${row.ph}` : null, row.temperature_c !== null ? `${row.temperature_c} °C` : null, row.buffer_text, row.cofactor_text, row.condition_text].filter(Boolean).join(" · ") || "Condition text not reported";
}

function citationLink(row: EvidenceCitation) {
  if (row.pmid) return <a className="font-semibold text-primary hover:underline" href={`https://pubmed.ncbi.nlm.nih.gov/${row.pmid}`} target="_blank" rel="noreferrer">PMID:{row.pmid} · {formatLabel(row.verification_status)}</a>;
  if (row.doi) return <a className="font-semibold text-primary hover:underline" href={`https://doi.org/${row.doi}`} target="_blank" rel="noreferrer">DOI:{row.doi} · {formatLabel(row.verification_status)}</a>;
  return formatLabel(row.verification_status);
}

function groupBy<T>(rows: T[], key: (row: T) => string) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const value = key(row);
    grouped.set(value, [...(grouped.get(value) ?? []), row]);
  }
  return grouped;
}
