import { useCallback, useSyncExternalStore } from "react";

/**
 * At this width and under the rail is a drawer and a top bar opens it.
 * styles.css switches its phone layout on the same query.
 */
export const PHONE_QUERY = "(max-width: 720px)";

/**
 * Wide enough to dock the inspector beside the chat; narrower, it opens as a
 * sheet over it. styles.css narrows the grid under `max-width: 1099.98px`, the
 * exact complement.
 */
export const DOCK_QUERY = "(min-width: 1100px)";

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}
