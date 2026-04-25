"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const PARAM = "listing";

/**
 * Drawer-selected mlsId synced to a URL search param so the page is
 * shareable. Reads on every render from the URL (which is the source of
 * truth), and pushes a shallow URL update without a full navigation when
 * the selection changes.
 */
export function useSelectedListing(): [string | null, (mlsId: string | null) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get(PARAM);

  const set = React.useCallback(
    (mlsId: string | null) => {
      const next = new URLSearchParams(searchParams.toString());
      if (mlsId) next.set(PARAM, mlsId);
      else next.delete(PARAM);
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  return [current, set];
}
