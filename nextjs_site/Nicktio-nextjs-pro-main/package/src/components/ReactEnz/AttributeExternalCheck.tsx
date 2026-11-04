import Badge from "@/components/ReactEnz/Badge";
import DataStatus from "@/components/ReactEnz/DataStatus";
import type { AttributeExternalCheckRow } from "@/lib/reactenzdb";

const statusConfig: Record<string, { label: string; tone: "blue" | "green" | "amber" | "slate" }> = {
  matched: { label: "matched", tone: "green" },
  weak_match: { label: "weak", tone: "amber" },
  ec_attribute_only: { label: "EC + attribute found", tone: "blue" },
  not_found: { label: "not found", tone: "slate" },
};

export function buildAttributeCheckMap(checks: AttributeExternalCheckRow[]) {
  const map = new Map<string, AttributeExternalCheckRow[]>();
  for (const check of checks) {
    const items = map.get(check.attribute_evidence_id) ?? [];
    items.push(check);
    map.set(check.attribute_evidence_id, items);
  }
  return map;
}

export default function AttributeExternalCheck({ checks }: { checks?: AttributeExternalCheckRow[] }) {
  if (!checks?.length) return <DataStatus status="not_reported" />;
  return (
    <div className="space-y-3">
      {checks.map((check) => (
        <ExternalAttributeItem key={`${check.source_db}-${check.check_id}`} check={check} />
      ))}
    </div>
  );
}

function ExternalAttributeItem({ check }: { check: AttributeExternalCheckRow }) {
  const config = statusConfig[check.match_status] ?? { label: check.match_status, tone: "slate" as const };
  const valueText = formatExternalValue(check);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={config.tone}>{config.label}</Badge>
        <span className="text-xs font-semibold text-muted">score {check.match_score}</span>
      </div>
      {valueText ? <div className="text-xs leading-5 text-muted">{valueText}</div> : null}
      {check.external_organism ? <div className="text-xs leading-5 text-muted">organism: {check.external_organism}</div> : null}
      <div className="flex flex-wrap gap-2 text-xs">
        {check.source_url ? (
          <a className="font-semibold text-primary hover:underline" href={check.source_url} target="_blank" rel="noreferrer">
            External record
          </a>
        ) : null}
        {parseLiteratureIds(check.external_literature_ids).length ? (
          <span className="font-semibold text-muted">Unresolved reference IDs: {parseLiteratureIds(check.external_literature_ids).slice(0, 4).join(", ")}</span>
        ) : null}
      </div>
      {check.match_reason ? <div className="text-[11px] uppercase tracking-[0.08em] text-muted">{check.match_reason}</div> : null}
    </div>
  );
}

function formatExternalValue(check: AttributeExternalCheckRow) {
  if (check.external_value_numeric === null || check.external_value_numeric === undefined) return "";
  const max =
    check.external_value_maximum !== null && check.external_value_maximum !== undefined
      ? `-${formatNumber(check.external_value_maximum)}`
      : "";
  const unit = check.external_unit ? ` ${check.external_unit}` : "";
  return `${formatAttributeName(check.external_attribute_name)} ${formatNumber(check.external_value_numeric)}${max}${unit}`;
}

function formatAttributeName(value: string | null) {
  if (!value) return "external value";
  return value.replaceAll("_", " ");
}

function formatNumber(value: number) {
  if (!Number.isFinite(value)) return String(value);
  return Number(value.toPrecision(4)).toString();
}

function parseLiteratureIds(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean) : [];
  } catch {
    return [];
  }
}
