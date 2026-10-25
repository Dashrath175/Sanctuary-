"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 700px)";
/** a touch screen with no mouse or trackpad: hints say tap and drag, not keys */
const TOUCH = "(hover: none) and (pointer: coarse)";

function useQuery(query: string) {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Phone layout flag that is `false` during SSR/hydration and live afterwards. */
export function usePhone() {
  return useQuery(QUERY);
}

/** Touch-only device flag (phone or tablet), `false` during SSR/hydration and live afterwards. */
export function useTouch() {
  return useQuery(TOUCH);
}

let touchList: MediaQueryList | null = null;

/** The same, read outside React (the list is live, so it is made once). */
export const isTouch = () => typeof window !== "undefined" && (touchList ??= window.matchMedia(TOUCH)).matches;

/** a phone turned on its side: globals.css covers the game with the rotate notice (keep the two alike) */
const SIDEWAYS = "(orientation: landscape) and (max-height: 540px) and (hover: none) and (pointer: coarse)";

/** True while that notice is up, so a tap on it does not reach the game behind it. */
export const isSideways = () => typeof window !== "undefined" && window.matchMedia(SIDEWAYS).matches;
