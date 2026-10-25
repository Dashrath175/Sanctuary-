"use client";

import { useEffect, useState } from "react";
import { store, useUI } from "@/lib/store";
import { LOADER } from "@/lib/script";
import { useObservatory } from "./Observatory";
import { usePhone, useTouch } from "@/lib/usePhone";
import { LogoMark } from "./LogoMark";

// Archive loader: log lines type in one after another with a block cursor, a thin progress
// bar fills, then the whole layer fades out over 0.55 s (or waits on a wake gate).

const LINES = [...LOADER.sources.map((t) => ({ t, milestone: false })), ...LOADER.milestones.map((t) => ({ t, milestone: true }))];
const TYPE_MS = 16;
const GAP_MS = 24;

export default function Loader() {
  const story = useUI((s) => s.story);
  const notice = useUI((s) => s.phoneNotice);
  const { loaded, wake, newJourney } = useObservatory();
  // starting over erases the journey, so it takes a second click (within a few seconds) to confirm
  const [erase, setErase] = useState(false);
  useEffect(() => {
    if (!erase) return;
    const id = window.setTimeout(() => setErase(false), 5000);
    return () => window.clearTimeout(id);
  }, [erase]);
  const assets = useUI((s) => s.assets);
  const resuming = useUI((s) => s.journey.chapter !== "awakening");
  const [line, setLine] = useState(0);
  const [chars, setChars] = useState(0);
  const [gone, setGone] = useState(false);
  const phone = usePhone();
  // a tablet has the wide layout and no mouse either: the words follow the hand, not the width
  const touch = useTouch();
  const active = story === "loading" || story === "gate";

  // type the log
  useEffect(() => {
    if (story !== "loading") return;
    if (line >= LINES.length) {
      // the log is done; the game starts once every asset is in
      if (assets < 1) return;
      const id = window.setTimeout(() => loaded(), 160);
      return () => window.clearTimeout(id);
    }
    const text = LINES[line].t;
    if (chars < text.length) {
      const id = window.setTimeout(() => setChars((c) => Math.min(text.length, c + Math.ceil(text.length / 3))), TYPE_MS);
      return () => window.clearTimeout(id);
    }
    const id = window.setTimeout(() => {
      setLine((l) => l + 1);
      setChars(0);
    }, GAP_MS);
    return () => window.clearTimeout(id);
  }, [story, line, chars, loaded, assets]);

  // unmount after the fade
  useEffect(() => {
    if (active) return;
    const id = window.setTimeout(() => setGone(true), 600);
    return () => window.clearTimeout(id);
  }, [active]);

  if (gone) return null;
  const done = line >= LINES.length;
  const typed = Math.min(1, (line + (LINES[line] ? chars / LINES[line].t.length : 0)) / LINES.length);
  const progress = typed * 0.3 + assets * 0.7;
  const current = !done
    ? LINES[Math.min(line, LINES.length - 1)].t
    : assets < 1
      ? `${LOADER.assets} · ${Math.floor(assets * 100)}%`
      : LOADER.milestones[LOADER.milestones.length - 1];

  return (
    <div
      id="loading"
      role="status"
      aria-label="Loading the survey"
      onClick={() => story === "gate" && wake()}
      className={`absolute inset-0 z-30 grid place-items-center bg-void p-8 transition-[opacity,visibility] duration-[550ms] ${
        active ? "opacity-100" : "pointer-events-none invisible opacity-0"
      } ${story === "gate" ? "cursor-pointer" : ""}`}
    >
      <div className="w-[calc(100vw-32px)] max-w-[462px] font-saira md:w-[462px]">
        <div className="mb-[22px] flex items-center gap-[12px] md:mb-[30px] md:gap-[16px]">
          <LogoMark className="h-[52px] w-[52px] shrink-0 md:h-[72px] md:w-[72px]" />
          <div>
            <p className="font-display text-[40px] font-[360] leading-[0.9] tracking-[2.5px] text-mint glow md:text-[58px] md:tracking-[3.5px]">SANCTUARY</p>
            <p className="mt-[6px] font-clock text-[8.5px] tracking-[0.42em] text-ember md:mt-[8px] md:text-[11px]">{LOADER.part}</p>
          </div>
        </div>
        <span className="inline-block rounded-[5.5px] border border-ember px-[11px] py-[2px] text-[11px] font-semibold leading-[16px] tracking-[0.33px] text-kick shadow-[0_0_9px_rgba(242,101,0,0.22)] [text-shadow:0_0_5px_rgba(255,92,85,0.33)] md:px-[14px] md:py-[3px] md:text-[14.35px] md:leading-[20px] md:tracking-[0.43px]">
          {LOADER.kicker}
        </span>
        <p className="mt-[8px] text-[11px] leading-[16px] tracking-[0.015em] text-key md:mt-[10px] md:text-[14.35px] md:leading-[20px]">
          <span className="mr-[6px] text-[0.6em] align-middle">▸</span>
          {LOADER.title}
        </p>
        <ol className="mt-[8px] space-y-[1px] text-[10px] leading-[15px] tracking-[0.015em] text-feed [text-shadow:0_0_4px_rgba(56,193,112,0.27)] md:mt-[10px] md:space-y-[2px] md:text-[14.35px] md:leading-[20px]">
          {LINES.map((l, i) => (
            <li
              key={i}
              className={`${l.milestone ? "mt-[3px] md:mt-[2.4px]" : ""} ${i === line && !done ? "cursor-block" : ""} ${i > line ? "invisible" : ""}`}
            >
              {l.milestone && <span className="mr-[7px] text-[0.55em] align-middle">▸</span>}
              {i === line ? l.t.slice(0, chars) : l.t}
            </li>
          ))}
        </ol>
        <div className="mt-[12px] h-[2px] w-full bg-[rgba(113,73,31,0.2)] md:mt-[15px]">
          <div className="h-full bg-ember shadow-[0_0_6px_rgba(242,101,0,0.8)] transition-[width] duration-150" style={{ width: `${progress * 100}%` }} />
        </div>
        <p className="status-block mt-[8px] text-[9px] leading-[13px] tracking-[0.04em] text-ember md:mt-[9px] md:text-[11.1px] md:leading-[16px] md:tracking-[0.44px]">{current}</p>
        <p className="mt-[6px] text-[8px] leading-[12px] tracking-[0.08em] text-note md:mt-[8px] md:text-[9.87px] md:leading-[14px] md:tracking-[0.79px]">{done ? LOADER.footer : LOADER.note}</p>
        {story === "gate" && (
          <>
            <div className="mt-[14px] h-px w-full bg-note/40" />
            <p className="cursor-block mt-[12px] text-[10px] tracking-[0.04em] text-mint md:text-[12px]">
              <span className="mr-[7px] text-[0.6em] align-middle">▸</span>
              {resuming ? (touch ? LOADER.resumePhone : LOADER.resumeDesktop) : touch ? LOADER.gatePhone : LOADER.gateDesktop}
            </p>
            {resuming && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (erase) newJourney();
                  else setErase(true);
                }}
                className={`mt-[10px] text-[9px] tracking-[0.08em] md:text-[10.5px] ${erase ? "text-alert glow" : "text-note hover:text-alert"}`}
              >
                <span className="mr-[7px] text-[0.6em] align-middle">▸</span>
                {erase ? (touch ? LOADER.newConfirmPhone : LOADER.newConfirm) : LOADER.newJourney}
              </button>
            )}
          </>
        )}
      </div>

      {notice && phone && (
        <div className="absolute left-1/2 top-[76px] flex w-[296px] -translate-x-1/2 items-center justify-between rounded-[4px] border border-ember px-[14px] py-[13px] font-hud text-[10px] font-bold">
          <span>
            <span className="text-alert">{LOADER.phoneNotice[0]}</span>
            <span className="text-mint"> · {LOADER.phoneNotice[1]}</span>
          </span>
          <button type="button" aria-label="Dismiss notice" onClick={(e) => { e.stopPropagation(); store.set({ phoneNotice: false }); }} className="text-alert">
            ×
          </button>
        </div>
      )}
    </div>
  );
}
