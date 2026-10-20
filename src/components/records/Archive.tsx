"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { store, useUI } from "@/lib/store";
import { CLUES, clueById, type ArchiveEntry } from "@/lib/clues";
import { RECORDINGS, recordingById, type Recording } from "@/lib/finale";
import { audio } from "@/lib/audio";
import { gapBefore } from "@/lib/dialogue";
import { CHAR_MS } from "@/lib/script";
import { playVoice, stopVoice, voiceLatencyMs, voiceMs } from "@/lib/voice";
import { SignalTrace } from "../SignalTrace";

type Entry = { id: string; order: number; archive: ArchiveEntry; lines: string[] | null };

/** every record there is to recover, in the order it happened */
const SLOTS = [...CLUES.map((c) => ({ id: c.id, order: c.order })), ...RECORDINGS.map((r) => ({ id: r.id, order: r.order }))].sort((a, b) => a.order - b.order);

function entryFor(id: string): Entry | null {
  const c = clueById.get(id);
  if (c) return { id, order: c.order, archive: c.archive, lines: null };
  const r = recordingById.get(id);
  return r ? { id, order: r.order, archive: r.archive, lines: r.lines.map((l) => l.text) } : null;
}

// ---------- a recording played again ----------

const LINE_HOLD_MS = 300;
const LAST_HOLD_MS = 900;

/** each line of a recording: the silence before it, and how long it speaks (ms) */
function timing(rec: Recording) {
  return rec.lines.map((l, i) => ({
    gap: gapBefore({ who: "rec", text: l.text, pause: l.pause }, i ? { who: "rec", text: "" } : null),
    ms: voiceMs([l.text]) ?? l.text.length * CHAR_MS + 1900,
  }));
}

const clock = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

type Replay = { id: string; line: number; torn: boolean };

/**
 * Plays a recovered recording again, line by line, with the radio under it as when it was found.
 * It ends when it is stopped, when the archive closes, or when a line of the story comes up.
 */
function useReplay() {
  const [now, setNow] = useState<Replay | null>(null);
  const run = useRef(0);
  const active = useRef(false);
  /** until when (performance.now) the voice is speaking, for the trace */
  const until = useRef(0);
  const end = useCallback((cut: boolean) => {
    run.current++;
    if (!active.current) return;
    active.current = false;
    until.current = 0;
    if (cut) stopVoice();
    audio.radio(0);
    store.set({ replaying: false });
    setNow(null);
  }, []);
  const play = useCallback(
    async (rec: Recording) => {
      end(true);
      const my = run.current;
      active.current = true;
      // anything still being said gives way
      stopVoice();
      store.set({ replaying: true });
      audio.radio(1);
      const before = store.get().subtitle;
      // a story line coming up (it has already cut this voice off) or the archive closing ends it
      const off = store.subscribe(() => {
        const s = store.get();
        if (my !== run.current) return off();
        if (!s.archiveOpen) end(true);
        else if (s.subtitle && s.subtitle !== before) end(false);
      });
      const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
      const lines = timing(rec);
      for (let i = 0; i < rec.lines.length && my === run.current; i++) {
        const l = rec.lines[i];
        if (lines[i].gap) await wait(lines[i].gap);
        if (my !== run.current) break;
        setNow({ id: rec.id, line: i, torn: !!l.torn });
        if (l.torn) audio.radioBurst(l.torn === "heavy" ? 1 : 0.6);
        const ms = playVoice([l.text]);
        const lag = voiceLatencyMs();
        until.current = performance.now() + lag + (ms ?? 0);
        await wait(lag + lines[i].ms + (i === rec.lines.length - 1 ? LAST_HOLD_MS : LINE_HOLD_MS));
      }
      off();
      if (my === run.current) end(false);
    },
    [end],
  );
  // leaving the page (or the game) stops it
  useEffect(() => () => end(true), [end]);
  const talking = useCallback(() => performance.now() < until.current, []);
  return { now, play, stop: () => end(true), talking };
}

// The ARCHIVE: a full page like the records. Every record there is to recover has a place on the
// timeline; only what the player has actually recovered can be opened.
export default function Archive() {
  const open = useUI((s) => s.archiveOpen);
  const ids = useUI((s) => s.journey.archive);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const replay = useReplay();
  const lineRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (open) closeRef.current?.focus({ preventScroll: true });
  }, [open]);
  // the line being played stays in view
  useEffect(() => {
    lineRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [replay.now?.line]);
  if (!open) return null;

  const got = new Set(ids);
  const recovered = SLOTS.filter((s) => got.has(s.id));
  // the newest recovery opens first
  const current = entryFor(selected && got.has(selected) ? selected : (ids[ids.length - 1] ?? ""));
  const recordings = ids.filter((id) => recordingById.has(id)).length;
  const rec = current ? recordingById.get(current.id) : undefined;
  const playing = !!rec && replay.now?.id === rec.id ? replay.now : null;
  const length = rec ? timing(rec).reduce((t, l, i) => t + l.gap + l.ms + (i === rec.lines.length - 1 ? LAST_HOLD_MS : LINE_HOLD_MS), 0) : 0;
  const close = () => {
    audio.ui();
    replay.stop();
    setSheet(false);
    store.set({ archiveOpen: false });
  };
  const pick = (id: string) => {
    audio.blip(990, 0.05, "square", 0.03);
    if (replay.now && replay.now.id !== id) replay.stop();
    setSelected(id);
    setSheet(true);
  };

  return (
    <section role="dialog" aria-modal="true" aria-labelledby="archive-title" className="absolute inset-0 z-[30] flex flex-col bg-void">
      <header className="relative h-[124px] shrink-0 px-[var(--side)] pt-[calc(env(safe-area-inset-top)+14px)] md:h-[136px] md:pt-[30px]">
        <h2 id="archive-title" className="font-display text-[28px] font-[350] leading-[25px] tracking-[0.28px] text-mint glow md:text-[60px] md:leading-[52.8px] md:tracking-[0.6px]">
          ARCHIVE
        </h2>
        <p className="mt-[14px] flex flex-wrap items-center gap-x-[9px] gap-y-[2px] font-clock text-[10px] tracking-[0.12em] text-key md:mt-[12px] md:text-[13px] md:leading-[21px] md:tracking-[0.16em]">
          <span className="text-mint glow">▸ RECOVERED MATERIAL</span>·
          <span>
            <b className="font-normal text-mint glow">{recovered.length}</b> / {SLOTS.length} RECOVERED
          </span>
          ·
          <span>
            RECORDINGS <b className="font-normal text-mint glow">{recordings}</b>
          </span>
        </p>
        <button
          ref={closeRef}
          type="button"
          onClick={close}
          className="absolute right-[var(--side)] top-[calc(env(safe-area-inset-top)+14px)] flex h-[28px] items-center gap-[6px] whitespace-nowrap font-hud text-[12px] font-bold tracking-[0.3px] text-alert glow-halo hover:text-loc md:top-[30px]"
        >
          <span aria-hidden>⏎</span> RETURN · ESC
        </button>
      </header>

      <div className="relative mx-[var(--side)] grid min-h-0 flex-1 grid-cols-1 border border-b-0 border-ember/50 lg:grid-cols-[360px_minmax(0,1fr)] xl:grid-cols-[440px_minmax(0,1fr)]">
        <ol className="dot-grid min-h-0 overflow-y-auto overscroll-contain lg:border-r lg:border-ember/50" aria-label="Timeline">
          {SLOTS.map((s, i) => {
            const e = got.has(s.id) ? entryFor(s.id) : null;
            const on = !!e && current?.id === e.id;
            return (
              <li key={s.id} className="border-b border-ember/40">
                {e ? (
                  <button
                    type="button"
                    onClick={() => pick(e.id)}
                    aria-current={on}
                    className={`relative block w-full px-[16px] py-[13px] text-left transition-colors hover:bg-gold/[0.06] ${on ? "bg-gold/[0.08]" : ""}`}
                  >
                    {on && <span className="absolute inset-y-[8px] left-0 w-[2px] bg-alert" />}
                    <span className="flex items-baseline justify-between gap-3 font-hud text-[10.5px] tracking-[1.3px]">
                      <span className="text-alert">{e.archive.date}</span>
                      <span className="text-dim">{String(i + 1).padStart(2, "0")}</span>
                    </span>
                    <span className={`mt-[3px] block font-hud text-[14px] tracking-[0.5px] md:text-[15px] ${on ? "text-mint glow" : "text-mint/85"}`}>{e.archive.title}</span>
                    <span className="mt-[2px] block font-hud text-[9.5px] tracking-[0.9px] text-dim">
                      {e.lines ? "RECORDING · " : ""}
                      {e.archive.status}
                    </span>
                  </button>
                ) : (
                  <div className="flex items-center justify-between px-[16px] py-[15px] font-hud text-[10.5px] tracking-[1.3px] text-rule">
                    <span>▢ NOT RECOVERED</span>
                    <span>{String(i + 1).padStart(2, "0")}</span>
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        <article className={`min-h-0 overflow-y-auto bg-void lg:static lg:block ${sheet ? "absolute inset-0 z-20 block" : "hidden"}`}>
          {current ? (
            <div className="mx-auto max-w-[920px] px-[18px] pb-[40px] pt-[20px] md:px-[34px] md:pt-[28px]" key={current.id}>
              <div className="flex items-center justify-between">
                <span className="badge inline-block">{current.lines ? "RECORDING" : "RECORD"} · {current.archive.date}</span>
                <button type="button" onClick={() => setSheet(false)} className="rec-chip h-[24px] border border-gold/60 px-2 font-hud text-[11px] text-gold lg:hidden">
                  TIMELINE
                </button>
              </div>
              <h3 className="mt-[16px] font-display text-[36px] font-[350] leading-[0.95] text-mint glow md:text-[54px]">{current.archive.title}</h3>
              <dl className="mt-[18px] font-hud text-[12px] uppercase">
                {(
                  [
                    ["SOURCE", current.archive.source],
                    ["SUBJECT", current.archive.subject],
                    ["STATUS", current.archive.status],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-6 border-b border-rule/70 py-[6px]">
                    <dt className="shrink-0 text-dim">{k}</dt>
                    <dd className="text-right text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-[20px] max-w-[72ch] font-hud text-[14px] leading-[23px] tracking-[0.2px] text-ash md:text-[15px] md:leading-[25px]">{current.archive.text}</p>
              {rec && (
                <div className="mt-[24px] max-w-[72ch]">
                  <div className="flex flex-wrap items-center gap-x-[16px] gap-y-[8px]">
                    <button
                      type="button"
                      aria-pressed={!!playing}
                      onClick={() => {
                        audio.blip(990, 0.05, "square", 0.03);
                        if (playing) replay.stop();
                        else void replay.play(rec);
                      }}
                      className="flex h-[34px] items-center gap-[10px] border border-mint/60 px-[14px] font-hud text-[12px] tracking-[1.2px] text-mint glow transition-colors hover:bg-mint/[0.08]"
                    >
                      <span aria-hidden className="w-[10px] text-center">{playing ? "■" : "▶"}</span>
                      {playing ? "STOP PLAYBACK" : "PLAY RECORDING"}
                    </button>
                    <span className="font-clock text-[11px] tracking-[0.14em] text-dim">
                      {playing ? `LINE ${playing.line + 1} / ${rec.lines.length}` : clock(length)}
                    </span>
                  </div>
                  {playing && (
                    <div className="mt-[14px] max-w-[460px]" aria-hidden>
                      <p className="font-hud text-[10px] leading-[14px] tracking-[1.4px] text-alert">{rec.heading}</p>
                      <SignalTrace torn={playing.torn} talking={replay.talking} className="mt-[8px] h-[36px] w-full md:h-[44px]" />
                      <p className={`mt-[4px] font-hud text-[9.5px] tracking-[1.6px] ${playing.torn ? "text-alert" : "text-dim"}`}>{playing.torn ? "SIGNAL DEGRADED" : "PLAYBACK"}</p>
                    </div>
                  )}
                </div>
              )}
              {current.lines && (
                <div className="mt-[26px] max-w-[72ch] border-l border-alert/60 pl-[16px]">
                  <p className="font-hud text-[10.5px] tracking-[1.4px] text-alert">TRANSCRIPT</p>
                  {current.lines.map((l, i) => {
                    const on = playing?.line === i;
                    return (
                      <p
                        key={i}
                        ref={on ? lineRef : undefined}
                        aria-current={on || undefined}
                        className={`mt-[9px] font-hud text-[13.5px] italic leading-[21px] transition-colors duration-300 ${on ? "text-mint glow" : playing ? "text-voice/40" : "text-voice"}`}
                      >
                        “{l}”
                      </p>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <p className="p-6 font-hud text-[13px] tracking-[0.6px] text-dim">NOTHING RECOVERED YET. SCAN ARTIFICIAL OBJECTS TO RECOVER WHAT THEY HOLD.</p>
          )}
        </article>
      </div>
    </section>
  );
}
