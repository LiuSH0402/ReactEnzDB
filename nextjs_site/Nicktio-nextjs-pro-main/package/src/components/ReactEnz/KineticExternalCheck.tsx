import Badge from "@/components/ReactEnz/Badge";
import DataStatus from "@/components/ReactEnz/DataStatus";
import type { KineticExternalCheckRow } from "@/lib/reactenzdb";

const statusConfig: Record<string, { label: string; tone: "blue" | "green" | "amber" | "slate" }> = {
  matched: { label: "comparison match", tone: "blue" },
  weak_match: { label: "weak", tone: "amber" },
  ec_parameter_only: { label: "EC + parameter found", tone: "blue" },
  not_found: { label: "Not found", tone: "slate" },
};

export function buildKineticCheckMap(checks: KineticExternalCheckRow[]) {
  const map = new Map<string, KineticExternalCheckRow[]>();
  for (const check of checks) {
    const items = map.get(check.kinetic_id) ?? [];
    items.push(check);
    map.set(check.kinetic_id, items);
  }
  return map;
}

export default function KineticExternalCheck({ checks }: { checks?: KineticExternalCheckRow[] }) {
  if (!checks?.length) return <DataStatus status="not_reported" />;

  return (
    <div className="space-y-3">
      <p className="text-xs leading-5 text-muted">Comparison records may use value tolerances. Their pH and temperature apply to the external assay and are not automatically assigned to this measurement.</p>
      {checks.map((check) => (
        <ExternalCheckItem key={`${check.source_db}-${check.check_id}`} check={check} />
      ))}
    </div>
  );
}

function ExternalCheckItem({ check }: { check: KineticExternalCheckRow }) {
  const config = statusConfig[check.match_status] ?? { label: check.match_status, tone: "slate" as const };
  const valueText = formatExternalValue(check);
  const context = [
    check.external_substrate ? `substrate: ${check.external_substrate}` : null,
    check.external_organism ? `organism: ${check.external_organism}` : null,
    check.external_ph !== null && check.external_ph !== undefined ? `pH ${check.external_ph}` : null,
    check.external_temperature !== null && check.external_temperature !== undefined ? `${check.external_temperature} °C` : null,
  ].filter(Boolean);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={config.tone}>{config.label}</Badge>
        <span className="text-xs font-semibold text-muted">score {check.match_score}</span>
      </div>
      {valueText ? <div className="text-xs leading-5 text-muted">{valueText}</div> : null}
      {context.length ? <div className="text-xs leading-5 text-muted">{context.join("; ")}</div> : null}
      <div className="flex flex-wrap gap-2 text-xs">
        {check.source_url ? (
          <a className="font-semibold text-primary hover:underline" href={check.source_url} target="_blank" rel="noreferrer">
            {check.external_entry_id ? `External record ${check.external_entry_id}` : "External record"}
          </a>
        ) : null}
        {check.external_pubmed_id ? (
          <a className="font-semibold text-primary hover:underline" href={`https://pubmed.ncbi.nlm.nih.gov/${check.external_pubmed_id}`} target="_blank" rel="noreferrer">
            PMID:{check.external_pubmed_id}
          </a>
        ) : null}
      </div>
      {check.match_reason ? <div className="text-[11px] uppercase tracking-[0.08em] text-muted">{check.match_reason}</div> : null}
    </div>
  );
}

function formatExternalValue(check: KineticExternalCheckRow) {
  if (check.external_value_numeric === null || check.external_value_numeric === undefined) return "";
  const unit = check.external_unit ? ` ${check.external_unit}` : "";
  const normalized =
    check.external_normalized_value !== null && check.external_normalized_value !== undefined && check.external_normalized_unit
      ? `; normalized ${formatNumber(check.external_normalized_value)} ${check.external_normalized_unit}`
      : "";
  return `${check.external_parameter_type ?? "external value"} ${formatNumber(check.external_value_numeric)}${unit}${normalized}`;
}

function formatNumber(value: number) {
  if (!Number.isFinite(value)) return String(value);
  if (Math.abs(value) >= 1000 || (Math.abs(value) > 0 && Math.abs(value) < 0.001)) return value.toExponential(3);
  return Number(value.toPrecision(4)).toString();
}
