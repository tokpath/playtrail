"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Filters } from "./GameFilters";

/** Shared URL updates; a category landing page keeps its category in the path. */
export function useListNavigation(fixedCategory?: string) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const push = useCallback(
    (patch: Partial<Filters>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value == null || value === "") params.delete(key);
        else params.set(key, value);
      }
      params.delete("page");
      if (fixedCategory) params.delete("category");
      const query = params.toString();
      router.push(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
    },
    [fixedCategory, pathname, router, searchParams],
  );
  const clear = () => router.push(pathname, { scroll: false });
  return { push, clear, pathname };
}
