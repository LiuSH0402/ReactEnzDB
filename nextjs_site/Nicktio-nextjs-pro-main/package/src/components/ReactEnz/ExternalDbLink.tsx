import DataStatus from "./DataStatus";

type ExternalDb =
  | "ec"
  | "rhea"
  | "kegg_reaction"
  | "metacyc_reaction"
  | "mnx_reaction"
  | "mnx_compound"
  | "chebi"
  | "pubchem"
  | "uniprot"
  | "ncbi_taxonomy"
  | "pdb";

function cleanValue(db: ExternalDb, value: string) {
  const trimmed = value.trim();
  if (db === "rhea") return trimmed.replace(/^RHEA:/i, "");
  if (db === "chebi") return trimmed.replace(/^CHEBI:/i, "");
  if (db === "ec") return trimmed.replace(/^EC:/i, "");
  return trimmed;
}

export function externalDbUrl(db: ExternalDb, value: string, url?: string | null) {
  // KEGG links always go directly to the original website, never a local proxy.
  if (db === "kegg_reaction") {
    const id = value.trim().replace(/^KEGG[:\s]*/i, "").toUpperCase();
    return /^R\d{5}$/.test(id) ? `https://www.kegg.jp/entry/${id}` : null;
  }
  if (url && url !== "#") return url;
  const id = cleanValue(db, value);
  if (!id) return null;

  switch (db) {
    case "ec":
      return `https://enzyme.expasy.org/EC/${id}`;
    case "rhea":
      return `https://www.rhea-db.org/reaction?id=${id}`;
    case "metacyc_reaction":
      return `https://biocyc.org/META/NEW-IMAGE?type=REACTION&object=${encodeURIComponent(id)}`;
    case "mnx_reaction":
      return `https://www.metanetx.org/equa_info/${id}`;
    case "mnx_compound":
      return `https://www.metanetx.org/chem_info/${id}`;
    case "chebi":
      return `https://www.ebi.ac.uk/chebi/searchId.do?chebiId=CHEBI:${id}`;
    case "pubchem":
      return `https://pubchem.ncbi.nlm.nih.gov/compound/${id}`;
    case "uniprot":
      return `https://www.uniprot.org/uniprotkb/${id}/entry`;
    case "ncbi_taxonomy":
      return `https://www.ncbi.nlm.nih.gov/Taxonomy/Browser/wwwtax.cgi?id=${id}`;
    case "pdb":
      return `https://www.rcsb.org/structure/${id}`;
  }
}

export default function ExternalDbLink({
  db,
  value,
  url,
  className = "font-semibold text-primary hover:underline",
}: {
  db: ExternalDb;
  value: string | null | undefined;
  url?: string | null;
  className?: string;
}) {
  if (!value || !value.trim()) return <DataStatus status="not_mapped" />;
  const href = externalDbUrl(db, value, url);
  if (!href) return <span>{value}</span>;

  return (
    <a className={className} href={href} target="_blank" rel="noreferrer">
      {value}
    </a>
  );
}

export function ExternalDbLinks({
  db,
  value,
  separator = ";",
}: {
  db: ExternalDb;
  value: string | null | undefined;
  separator?: string;
}) {
  if (!value || !value.trim()) return <DataStatus status="not_mapped" />;
  const parts = value
    .split(separator)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return <DataStatus status="not_mapped" />;

  return (
    <span className="inline-flex flex-wrap gap-x-2 gap-y-1">
      {parts.map((part) => (
        <ExternalDbLink key={`${db}-${part}`} db={db} value={part} />
      ))}
    </span>
  );
}
