"use client";

import { useEffect, useMemo, useState } from "react";
import { useUI } from "@/lib/store";
import { CLUES, deepBeat, foundBeat, recovered, siteOpen } from "@/lib/clues";
import type { Chapter } from "@/lib/journey";
import { PART_TWO_CARD } from "@/lib/finale";

// What makes it play like a game: the current objective, and a title card at each chapter.

const CARDS: Partial<Record<Chapter, [string, string]>> = {
  awakening: ["CHAPTER 1", "AWAKENING"],
  inbound: ["CHAPTER 2", "BEARINGS"],
  inner: ["CHAPTER 3", "THE INNER SYSTEM"],
  explore: ["CHAPTER 4", "FRAGMENTS"],
  signal: ["CHAPTER 5", "THE FIRST SIGNAL"],
  transmission: ["CHAPTER 6", "THE LAST CALL"],
  reckoning: ["CHAPTER 7", "THE RECORD"],
  ending: ["EPILOGUE", "HOME"],
};

/** The objective line for where the story stands. */
function objectiveFor(chapter: Chapter, beats: string[], story: string): string | null {
  const has = (b: string) => beats.includes(b);
  switch (chapter) {
    case "awakening":
      return story === "awaiting-scan" ? "SCAN THE PLANET AHEAD · F" : null;
    case "inbound":
      return "FOLLOW THE SUN TOWARD THE INNER SYSTEM";
    case "belt":
      return "CROSS THE ASTEROID BELT";
    case "inner":
      return "FIND EARTH AND SCAN IT";
    case "earth":
      return "STAND BY";
    case "explore": {
      const waiting = CLUES.some((c) => c.major && has(foundBeat(c.id)) && !has(deepBeat(c.id)));
      if (waiting) return "DEEP SCAN THE SOURCE YOU FOUND · F";
      const open = CLUES.filter((c) => siteOpen(c, beats));
      const done = open.filter((c) => recovered(c, beats)).length;
      const iss = CLUES.find((c) => c.after && siteOpen(c, beats) && !recovered(c, beats));
      if (iss && !has(foundBeat(iss.id))) return `VISIT THE ISS IN EARTH ORBIT · ${done}/${open.length} RECOVERED`;
      return `INVESTIGATE THE ARTIFICIAL SIGNALS · ${done}/${open.length} RECOVERED`;
    }
    case "signal":
      return !has("ship1-found") ? "TRACE THE SIGNAL TO PLUTO'S ORBIT · WATCH ITS STRENGTH" : !has("cut-ship1") ? "REACH THE VESSEL" : "STAND BY";
    case "transmission":
      return has("cut-ship2") ? "STAND BY" : "REACH THE TRANSMISSION IN EARTH ORBIT";
    case "reckoning":
      return "LISTEN";
    case "ending":
      return "EXPLORATION COMPLETE";
  }
}

export function Objective() {
  const chapter = useUI((s) => s.journey.chapter);
  const beats = useUI((s) => s.journey.beats);
  const story = useUI((s) => s.story);
  const text = useMemo(() => objectiveFor(chapter, beats, story), [chapter, beats, story]);
  if (!text) return null;
  return (
    // on a phone the top corners hold the drive and bearings panels, so the objective sits under
    // the drive panel; from md up it sits top right, under the byline
    <div className="absolute left-[var(--side)] top-[calc(env(safe-area-inset-top)+172px)] max-w-[52vw] text-left font-hud halo md:left-auto md:right-[var(--side)] md:top-[92px] md:max-w-[360px] md:text-right">
      <p className="text-[9px] tracking-[1.6px] text-dim md:text-[10px]">OBJECTIVE</p>
      <p key={text} className="readout-line mt-[2px] text-[10.5px] leading-[15px] tracking-[0.8px] text-loc md:text-[12px] md:leading-[17px]">
        {text}
      </p>
    </div>
  );
}

/** A chapter's title, held for a few seconds whenever the story moves into it. */
export function ChapterCard() {
  const chapter = useUI((s) => s.journey.chapter);
  const story = useUI((s) => s.story);
  const live = story !== "loading" && story !== "gate";
  const [card, setCard] = useState<{ k: number; c: [string, string] } | null>(null);
  useEffect(() => {
    const c = live ? CARDS[chapter] : undefined;
    if (!c) return;
    const k = Date.now();
    const a = window.setTimeout(() => setCard({ k, c }), 0);
    const b = window.setTimeout(() => setCard((x) => (x?.k === k ? null : x)), 4200);
    return () => {
      window.clearTimeout(a);
      window.clearTimeout(b);
    };
  }, [chapter, live]);
  if (!card) return null;
  return (
    <div key={card.k} aria-live="polite" className="chapter-card pointer-events-none absolute inset-x-0 top-[30%] z-[12] text-center">
      <p className="font-hud text-[11px] tracking-[4px] text-alert halo md:text-[13px]">{card.c[0]}</p>
      <p className="mt-[6px] font-display text-[34px] leading-[36px] tracking-[3px] text-mint glow md:text-[54px] md:leading-[56px]">{card.c[1]}</p>
    </div>
  );
}

/** "SYSTEMS ONLINE": what just unlocked, centred for a few seconds. */
export function UnlockBanner() {
  const u = useUI((s) => s.unlock);
  const [shown, setShown] = useState<NonNullable<typeof u> | null>(null);
  useEffect(() => {
    if (!u) return;
    const a = window.setTimeout(() => setShown(u), 0);
    const b = window.setTimeout(() => setShown((x) => (x?.key === u.key ? null : x)), 6500);
    return () => {
      window.clearTimeout(a);
      window.clearTimeout(b);
    };
  }, [u]);
  if (!shown) return null;
  return (
    <div key={shown.key} role="status" className="unlock-banner pointer-events-none absolute left-1/2 top-[34%] z-[12] w-max max-w-[92vw] border border-mint/70 bg-void/80 px-[22px] py-[12px] text-center font-hud shadow-[0_0_26px_rgba(71,255,169,0.25)]">
      <p className="text-[12px] font-bold tracking-[3px] text-mint glow md:text-[15px]">{shown.title}</p>
      <div className="mt-[8px] flex flex-wrap justify-center gap-x-[16px] gap-y-[4px]">
        {shown.items.map((it, i) => (
          <span key={it} className="unlock-item text-[10px] tracking-[1.6px] text-loc md:text-[11.5px]" style={{ animationDelay: `${300 + i * 260}ms` }}>
            ▸ {it}
          </span>
        ))}
      </div>
    </div>
  );
}

/** After the story: Part II's door, then keep flying or start a new journey. */
export function EndingChoices({ onContinue, onNew }: { onContinue: () => void; onNew: () => void }) {
  const finished = useUI((s) => s.finished);
  if (!finished) return null;
  return (
    <div className="pointer-events-auto absolute inset-0 z-[20] grid place-items-center bg-void/70">
      <div className="chapter-in text-center font-hud">
        <p className="text-[11px] tracking-[3px] text-alert halo md:text-[13px]">{PART_TWO_CARD.kicker}</p>
        <p className="mt-[10px] font-display text-[44px] leading-[46px] tracking-[3px] text-mint glow md:text-[64px] md:leading-[66px]">{PART_TWO_CARD.title}</p>
        <p className="mt-[6px] text-[11px] tracking-[2px] text-loc md:text-[13px]">{PART_TWO_CARD.line}</p>
        <div className="mt-[28px] flex justify-center gap-[14px]">
          <button type="button" onClick={onContinue} className="border border-mint/70 px-[16px] py-[9px] text-[11px] tracking-[1.8px] text-mint hover:bg-mint/10">
            CONTINUE EXPLORING
          </button>
          <button type="button" onClick={onNew} className="border border-alert/70 px-[16px] py-[9px] text-[11px] tracking-[1.8px] text-alert hover:bg-alert/10">
            NEW JOURNEY
          </button>
        </div>
      </div>
    </div>
  );
}

/** The HUD shakes and dims with the sensor interference (the asteroid belt, signal bursts). */
export function useHudInterference(read: () => number) {
  useEffect(() => {
    let raf = 0;
    const hud = () => document.getElementById("helmet-hud");
    const tick = () => {
      const k = read();
      const el = hud();
      if (el) {
        if (k > 0.03) {
          const hit = Math.random() < 0.25 + k * 0.5;
          el.style.opacity = String(hit ? 1 - k * (0.25 + Math.random() * 0.5) : 1 - k * 0.08);
          el.style.transform = hit ? `translate(${((Math.random() - 0.5) * 6 * k).toFixed(1)}px, ${((Math.random() - 0.5) * 2 * k).toFixed(1)}px)` : "";
        } else if (el.style.opacity) {
          el.style.opacity = "";
          el.style.transform = "";
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [read]);
}

/** Cutscenes: black bars slide in, and every cut between shots dips to black (under the captions,
 * so a line being read never blinks out at a cut). */
export function Letterbox() {
  const cut = useUI((s) => s.cut);
  const shot = useUI((s) => s.cutShot);
  return (
    <>
      <div aria-hidden className="pointer-events-none absolute inset-0 z-[9] overflow-hidden">{shot > 0 && <div key={shot} className="cut-dip" />}</div>
      <div aria-hidden className="pointer-events-none absolute inset-0 z-[19] overflow-hidden">
        <div className="letterbox-bar top-0" data-on={cut} />
        <div className="letterbox-bar bottom-0" data-on={cut} />
      </div>
    </>
  );
}

/** A hard stop: the screen drops toward black and flickers back, darker and longer the harder it was. */
export function JoltFlash() {
  const jolt = useUI((s) => s.jolt);
  if (!jolt) return null;
  // the dark only flickers for a moment, even at full drive; the visor's glitch carries the rest
  const style = { "--peak": Math.min(0.82, 0.1 + jolt.k * 0.72), "--dur": `${0.22 + jolt.k * 0.3}s` } as React.CSSProperties;
  return <div key={jolt.key} aria-hidden className="jolt-flash pointer-events-none absolute inset-0 z-[23]" style={style} />;
}
