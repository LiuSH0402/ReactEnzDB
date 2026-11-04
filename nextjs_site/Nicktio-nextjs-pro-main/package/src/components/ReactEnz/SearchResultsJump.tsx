"use client";

import { useEffect } from "react";

export function SearchResultsJump() {
  useEffect(() => {
    document.getElementById("search-results")?.scrollIntoView({ block: "start" });
  }, []);

  return <span data-search-results-jump="" hidden />;
}
