import fs from "node:fs";
import path from "node:path";

export function reviewedDownloadRoot() {
  if (process.env.REACTENZDB_DOWNLOAD_ROOT) return path.resolve(process.env.REACTENZDB_DOWNLOAD_ROOT);
  return path.resolve(process.cwd(), "../../../data/downloads");
}

function safeRelative(value) {
  return typeof value === "string" && value.split("/").every(part => /^[A-Za-z0-9_.-]+$/.test(part) && part !== "." && part !== "..");
}

export function readReviewedCatalog(root = reviewedDownloadRoot()) {
  try {
    const catalog = JSON.parse(fs.readFileSync(path.join(root, "catalog_public.json"), "utf8"));
    if (catalog.availability !== "published" || catalog.identified_kegg_content_excluded !== true || !Array.isArray(catalog.files)) return null;
    const paths = new Set();
    for (const file of catalog.files) {
      if (!safeRelative(file.path) || paths.has(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 0) return null;
      paths.add(file.path);
    }
    return catalog;
  } catch { return null; }
}

export function resolveReviewedFile(key, aliases = {}, root = reviewedDownloadRoot()) {
  const catalog = readReviewedCatalog(root);
  if (!catalog) return null;
  let item;
  if (key === "catalog") {
    return { filePath: path.join(root, "catalog_public.json"), filename: "catalog_public.json", revision: catalog.revision, sha256: null, size: null };
  }
  if (key === "bundle") item = catalog.files.find(file => file.group === "bundle");
  else if (key.startsWith("reviewed:")) item = catalog.files.find(file => file.path === key.slice(9));
  else if (key.startsWith("download:")) item = catalog.files.find(file => file.group !== "sqlite" && file.name === key.slice(9));
  else if (aliases[key]) item = catalog.files.find(file => file.name === aliases[key]);
  if (!item) return null;
  const filePath = path.resolve(root, item.path);
  const relative = path.relative(root, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(filePath)) return null;
  const realRoot = fs.realpathSync(root);
  const realRelative = path.relative(realRoot, fs.realpathSync(filePath));
  if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) return null;
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size !== item.size) return null;
  return { filePath, filename: item.name, revision: catalog.revision, sha256: item.sha256, size: item.size };
}

export function reviewedHref(file) {
  return `/api/reactenzdb/release-file?file=${encodeURIComponent("reviewed:" + file.path)}`;
}
