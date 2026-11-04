import { readReviewedCatalog } from "./reviewedDownloadFiles.mjs";

export type ReviewedArtifact = {
  path: string; name: string; group: "sqlite" | "csv" | "tsv" | "metadata" | "bundle";
  size: number; sha256: string; format: string; rows?: number; columns?: number;
};
export type ReviewedCatalog = {
  revision: string; source_snapshot: string; release_date: string;
  availability: string; files: ReviewedArtifact[];
};
export function getReviewedCatalog(): ReviewedCatalog | null {
  return readReviewedCatalog() as ReviewedCatalog | null;
}
