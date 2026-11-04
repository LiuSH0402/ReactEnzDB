import { releasePath } from "@/lib/paths";
import fs from "node:fs";
import path from "node:path";
import { getReleaseGovernance } from "@/lib/releaseGovernance";

export function getLocalReleaseRevision(): { revision: string; date: string; published: boolean } | null {
  const governance = getReleaseGovernance();
  if (governance?.data_revision) {
    return {
      revision: governance.data_revision,
      date: String(governance.generated_at_utc ?? "").slice(0, 10),
      published: governance.snapshot_state === "server_frozen_public_bytes",
    };
  }
  try {
    const file = releasePath("data_repair_manifest.json");
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (!["local_data_repair_not_published", "published_data_repair"].includes(data.status) || typeof data.working_revision !== "string") return null;
    return { revision: data.working_revision, date: String(data.generated_at_utc ?? "").slice(0, 10), published: data.status === "published_data_repair" };
  } catch {
    return null;
  }
}
