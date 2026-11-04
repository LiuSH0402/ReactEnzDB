import type { StatMap } from "@/lib/reactenzdb";

export const CORE_RELEASE_METRIC_DEFINITIONS = [
  { key: "reaction_enzyme_pairs", label: "Association Records" },
  { key: "reactions", label: "Reactions" },
  { key: "enzymes", label: "Enzymes" },
  { key: "source_organisms", label: "Source Organisms" },
  { key: "chassis_labels", label: "Chassis Annotations" },
  { key: "kinetics", label: "Kinetic records" },
] as const;

export const PUBLIC_HERO_METRIC_DEFINITIONS = [
  { key: "reactions", label: "Reactions" },
  { key: "enzymes", label: "Enzymes" },
  { key: "source_organisms", label: "Source Organisms" },
  { key: "kinetics", label: "Kinetic records" },
] as const;

export type CoreReleaseMetricKey = (typeof CORE_RELEASE_METRIC_DEFINITIONS)[number]["key"];

export function getCoreReleaseMetrics(stats: StatMap) {
  return CORE_RELEASE_METRIC_DEFINITIONS.map((metric) => ({
    ...metric,
    value: Number(stats[metric.key] ?? 0),
  }));
}

export function getPublicHeroMetrics(stats: StatMap, hostCount = 0) {
  return [
    ...PUBLIC_HERO_METRIC_DEFINITIONS.map((metric) => ({
      ...metric,
      value: Number(stats[metric.key] ?? 0),
    })),
    ...(hostCount ? [{ key: "host_models" as const, value: hostCount, label: "Host models" }] : []),
  ];
}

export function coreReleaseMetricMap(stats: StatMap) {
  return new Map(getCoreReleaseMetrics(stats).map((metric) => [metric.key, metric]));
}
