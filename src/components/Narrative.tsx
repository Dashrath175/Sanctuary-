"use client";

import { store, useUI } from "@/lib/store";
import { CHAR_MS, SPEAKERS } from "@/lib/script";
import { useObservatory } from "./Observatory";
import { SoundToggle } from "./hud/Hud";
import { Credit } from "./icons";
import { SignalTrace } from "./SignalTrace";

// Subtitles (letter-by-letter inside word boxes), a recording's trace, CONTINUE and SKIP OPENING.
export default function Narrative() {
  const story = useUI((s) => s.story);
  const sub = useUI((s) => s.subtitle);
  const { advance, skip } = useObservatory();
  const playback = useUI((s) => s.playback);
  const opening = story === "waking";
  const canSkip = story === "waking" || story === "awaiting-scan" || story === "contact";

  return (
    <section id="narrative" className="pointer-events-none absolute inset-0 z-10">
      {playback && <Playback heading={playback.heading} torn={playback.torn} />}
      {sub && (
        <div
          id="subtitle-box"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="absolute bottom-[calc(env(safe-area-inset-bottom)+138px)] left-1/2 w-[350px] -translate-x-1/2 text-center font-saira md:bottom-[157px] md:w-[570px]"
        >
          {sub.who && <span className={`block text-[10px] leading-[15px] tracking-[1px] soft ${sub.who === "player" ? "text-ink" : "text-voice"}`}>{SPEAKERS[sub.who]}</span>}
          <p key={sub.key} className={`${sub.who ? "mt-[5px] md:mt-[7px]" : ""} text-[14.5px] leading-[21px] tracking-[0.24px] soft md:text-[16.065px] md:leading-[24.1px] ${sub.who === "player" ? "text-ink" : "text-voice"}`}>
            <span className="sr-only">{sub.text}</span>
            <Typed text={sub.text} charMs={sub.charMs ?? CHAR_MS} />
          </p>
          {opening && (
            <button
              type="button"
              onClick={advance}
              aria-label="Continue dialogue"
              className="pointer-events-auto absolute left-1/2 top-full mt-[14px] -translate-x-1/2 whitespace-nowrap px-[10px] py-[10px] text-[10px] leading-[13px] tracking-[2.2px] text-ash opacity-70 halo hover:opacity-100"
            >
              CONTINUE ↵
            </button>
          )}
        </div>
      )}
      {canSkip && (
        <div className="pointer-events-auto absolute bottom-[calc(env(safe-area-inset-bottom)+44px)] right-[var(--side)] flex flex-col items-end md:bottom-auto md:top-[30px]">
          <SoundToggle />
          <Credit className="mt-[4px] hidden md:flex" />
        </div>
      )}
      {canSkip && (
        <button
          type="button"
          onClick={skip}
          className="pointer-events-auto absolute right-[var(--side)] top-[calc(env(safe-area-inset-top)+50px)] py-[12px] text-[10px] leading-[15px] tracking-[1px] text-ash halo hover:text-ink md:top-[100px]"
        >
          SKIP OPENING
        </button>
      )}
    </section>
  );
}

/** a recording is talking while its line is the caption */
const recTalking = () => store.get().subtitle?.who === "rec";

/** A recovered recording: its heading and a live trace of the signal, torn where it breaks up. */
function Playback({ heading, torn }: { heading: string; torn: boolean }) {
  return (
    <div id="playback" className="absolute left-1/2 top-[calc(env(safe-area-inset-top)+92px)] w-[300px] -translate-x-1/2 text-center font-hud md:top-[120px] md:w-[420px]" aria-hidden>
      <p className="text-[10px] leading-[14px] tracking-[1.4px] text-alert halo">{heading}</p>
      <SignalTrace torn={torn} talking={recTalking} className="mt-[8px] h-[34px] w-full md:h-[44px]" />
      <p className={`mt-[4px] text-[9.5px] tracking-[1.6px] halo ${torn ? "text-alert" : "text-dim"}`}>{torn ? "SIGNAL DEGRADED" : "PLAYBACK · CONTROLS LOCKED"}</p>
    </div>
  );
}

function Typed({ text, charMs }: { text: string; charMs: number }) {
  // each letter fades in after the previous one; words stay unbroken
  const nodes: React.ReactNode[] = [];
  let idx = 0;
  const rows = text.split("\n");
  for (let r = 0; r < rows.length; r++) {
    if (r > 0) nodes.push(<br key={`br${r}`} />);
    const parts = rows[r].split(/(\s+)/);
    for (let k = 0; k < parts.length; k++) {
      const w = parts[k];
      if (!w) continue;
      if (/^\s+$/.test(w)) {
        nodes.push(<span key={`${r}-${k}`}>{w}</span>);
        idx += w.length;
        continue;
      }
      const letters: React.ReactNode[] = [];
      for (let j = 0; j < w.length; j++) {
        letters.push(
          <span key={j} style={{ animationDelay: `${Math.round((idx + j) * charMs)}ms` }}>
            {w[j]}
          </span>,
        );
      }
      idx += w.length;
      nodes.push(
        <span key={`${r}-${k}`} className="typed-word">
          {letters}
        </span>,
      );
    }
  }
  return <span aria-hidden>{nodes}</span>;
}
