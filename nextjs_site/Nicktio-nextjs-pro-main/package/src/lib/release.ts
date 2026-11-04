export const REACTENZDB_RELEASE = {
  version: "2026.09.1",
  date: "2026-09-22",
  label: "ReactEnzDB 2026.09.1",
  previous: "2026.08.1",
  includesHostContext: true,
  hostCount: 30,
} as const;

export type ReactenzdbRelease = typeof REACTENZDB_RELEASE;
