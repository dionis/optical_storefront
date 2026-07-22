"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { FacetDistribution } from "meilisearch";
import { searchClient, FRAMES_INDEX } from "@/lib/search-client";
import type { MeilisearchFrameDocument } from "@eyewear/shared";
import {
  type ListingFilters,
  buildMeiliFilter,
  MEILI_SORT_PARAMS,
} from "@/lib/filter-params";

const HITS_PER_PAGE = 24;

const FACET_ATTRIBUTES = [
  "shape",
  "material",
  "gender",
  "collection",
  "features",
  "colors",
];

export interface UseFramesSearchResult {
  hits: MeilisearchFrameDocument[];
  totalHits: number;
  facets: FacetDistribution;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  /** Translate with useTranslations("listing") — "errorTitle" is a fixed label, this is just a raw message. */
  error: string | null;
  loadMore: () => void;
}

export function useFramesSearch(
  filters: ListingFilters
): UseFramesSearchResult {
  const [hits, setHits] = useState<MeilisearchFrameDocument[]>([]);
  const [totalHits, setTotalHits] = useState(0);
  const [facets, setFacets] = useState<FacetDistribution>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pageRef = useRef(0);
  // Track the filter key to detect when filters change vs. load-more
  const filterKeyRef = useRef("");

  const filterKey = JSON.stringify(filters);

  const fetchPage = useCallback(
    async (page: number, append: boolean) => {
      try {
        const filter = buildMeiliFilter(filters);
        const sort = MEILI_SORT_PARAMS[filters.sort];

        const result = await searchClient
          .index(FRAMES_INDEX)
          .search<MeilisearchFrameDocument>(filters.query, {
            filter: filter || undefined,
            facets: FACET_ATTRIBUTES,
            sort: sort.length ? sort : undefined,
            hitsPerPage: HITS_PER_PAGE,
            offset: page * HITS_PER_PAGE,
          });

        if (append) {
          setHits((prev) => [...prev, ...result.hits]);
        } else {
          setHits(result.hits);
          setFacets(result.facetDistribution ?? {});
          setTotalHits(result.estimatedTotalHits ?? 0);
        }
        setError(null);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "search_failed");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filterKey]
  );

  // Re-fetch from page 0 when filters change
  useEffect(() => {
    if (filterKeyRef.current === filterKey) return;
    filterKeyRef.current = filterKey;
    pageRef.current = 0;
    setIsLoading(true);
    setHits([]);
    fetchPage(0, false).finally(() => setIsLoading(false));
  }, [filterKey, fetchPage]);

  // Initial load
  useEffect(() => {
    filterKeyRef.current = filterKey;
    setIsLoading(true);
    fetchPage(0, false).finally(() => setIsLoading(false));
    // only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMore = useCallback(() => {
    if (isLoadingMore) return;
    const nextPage = pageRef.current + 1;
    pageRef.current = nextPage;
    setIsLoadingMore(true);
    fetchPage(nextPage, true).finally(() => setIsLoadingMore(false));
  }, [isLoadingMore, fetchPage]);

  const hasMore = hits.length < totalHits;

  return {
    hits,
    totalHits,
    facets,
    isLoading,
    isLoadingMore,
    hasMore,
    error,
    loadMore,
  };
}
