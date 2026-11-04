import { releasePath } from "@/lib/paths";
import fs from "node:fs";
import path from "node:path";

export type ReleaseGovernance = {
  snapshot_id: string;
  snapshot_state: string;
  data_revision: string;
  generated_at_utc?: string;
  public_snapshot: { snapshot_id: string; core: { sha256: string }; frozen_at_utc: string } | null;
  licence: { status: string };
  transport: { http_url: string; https_status: string };
  long_term_archive: { status: string; doi: string | null };
};

export function getReleaseGovernance(): ReleaseGovernance | null {
  try {
    const file = releasePath("PUBLIC_RELEASE_GOVERNANCE.json");
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (typeof data.snapshot_id !== "string" || !data.licence || !data.transport || !data.long_term_archive) return null;
    return data as ReleaseGovernance;
  } catch {
    return null;
  }
}
