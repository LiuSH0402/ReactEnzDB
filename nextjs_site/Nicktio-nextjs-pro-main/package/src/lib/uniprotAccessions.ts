/** Recognize primary/secondary accession syntax without asserting identity. */
export function isUniProtAccession(value: string): boolean {
  return /^(?:[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})(?:-[1-9][0-9]*)?$/i.test(value.trim());
}
