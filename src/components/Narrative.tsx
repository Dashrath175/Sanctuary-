"use client";

import { useUI } from "@/lib/store";
import { CHAR_MS, SPEAKER } from "@/lib/script";
import { useObservatory } from "./Observatory";
import { SoundToggle } from "./hud/Hud";
import { Credit } from "./icons";

// Subtitles (letter-by-letter inside word boxes), the CONTINUE prompt and SKIP OPENING.
export default function Narrative() {
  const story = useUI((s) => s.story);
  const sub = useUI((s) => s.subtitle);
  const { advance, skip } = useObservatory();
  const opening = story === "waking";
  const canSkip = story === "waking" || story === "awaiting-scan" || story === "contact";

  return (
    <section id="narrative" className="pointer-events-none absolute inset-0 z-10">
      {sub && (
        <div
          id="subtitle-box"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="absolute bottom-[calc(env(safe-area-inset-bottom)+138px)] left-1/2 w-[350px] -translate-x-1/2 text-center font-saira md:bottom-[157px] md:w-[570px]"
        >
          {sub.named && <span className="block text-[10px] leading-[15px] tracking-[1px] text-voice soft">{SPEAKER}</span>}
          <p key={sub.key} className={`${sub.named ? "mt-[5px] md:mt-[7px]" : ""} text-[14.5px] leading-[21px] tracking-[0.24px] text-voice soft md:text-[16.065px] md:leading-[24.1px]`}>
            <span className="sr-only">{sub.text}</span>
            <Typed text={sub.text} />
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

function Typed({ text }: { text: string }) {
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
          <span key={j} style={{ animationDelay: `${(idx + j) * CHAR_MS}ms` }}>
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
