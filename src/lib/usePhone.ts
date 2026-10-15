"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 700px)";

/** Phone layout flag that is `false` during SSR/hydration and live afterwards. */
export function usePhone() {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(QUERY);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
