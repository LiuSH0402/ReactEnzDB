export function transformationSearchHref(input: {
  substrates?: string | null;
  products?: string | null;
  reaction?: string | null;
}): string {
  const params = new URLSearchParams({ mode: "transformation" });
  const reaction = input.reaction?.trim();
  const substrates = input.substrates?.trim();
  const products = input.products?.trim();
  if (reaction) params.set("reaction", reaction);
  if (substrates) params.set("substrates", substrates);
  if (products) params.set("products", products);
  return `/search?${params.toString()}#transformation-results`;
}

export function structureResultsHref(input: {
  substrates: string;
  products: string;
  q?: string;
  matchMode: "complete" | "related";
  page: number;
}): string {
  const params = new URLSearchParams({ substrates: input.substrates, products: input.products,
    structureMatch: input.matchMode, page: String(input.page) });
  if (input.q) params.set("q", input.q);
  return `/search?${params.toString()}#search-results`;
}
