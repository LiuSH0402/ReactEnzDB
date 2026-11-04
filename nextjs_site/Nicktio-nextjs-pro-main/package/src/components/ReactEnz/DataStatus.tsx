import type { ReactNode } from "react";

export type DataStatusKind =
  | "not_reported"
  | "not_curated"
  | "not_mapped"
  | "not_available"
  | "not_applicable"
  | "unresolved"
  | "sequence_not_available"
  | "structure_not_available"
  | "no_annotation";

const labels: Record<DataStatusKind, string> = {
  not_reported: "not reported",
  not_curated: "not curated",
  not_mapped: "not mapped",
  not_available: "not available",
  not_applicable: "not applicable",
  unresolved: "unresolved",
  sequence_not_available: "sequence not available",
  structure_not_available: "structure not available",
  no_annotation: "no annotation",
};

export function hasData(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value !== "string") return true;
  const normalized = value.trim();
  if (!normalized) return false;
  return !/^(na|n\/a|null|none|-)$/i.test(normalized);
}

export function displayValue(value: ReactNode, status: DataStatusKind = "not_reported") {
  return hasData(value) ? value : <DataStatus status={status} />;
}

export default function DataStatus({
  status = "not_reported",
  className = "",
}: {
  status?: DataStatusKind;
  className?: string;
}) {
  return (
    <span className={`inline-flex rounded-[2px] bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500 dark:bg-white/10 dark:text-white/55 ${className}`}>
      {labels[status]}
    </span>
  );
}
