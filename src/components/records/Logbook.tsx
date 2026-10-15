"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useUI } from "@/lib/store";
import { audio } from "@/lib/audio";
import { AU_KM, BODIES, CATEGORIES, ephemeris, type BodyDef, type Fact, type Kind } from "@/lib/solar";
import { useObservatory } from "../Observatory";
import RecordPreview from "./RecordPreview";
import { thumbFor } from "./thumbs";

const isVehicle = (k: Kind) => k === "spacecraft" || k === "satellite";

/** "9.57 AU · 1,432 MILLION KM" from the Sun, right now */
function fromSun(id: string) {
  const p = ephemeris(Date.now()).get(id);
  if (!p) return "—";
  const kmFromSun = Math.hypot(...p);
  return `${(kmFromSun / AU_KM).toFixed(2)} AU · ${Math.round(kmFromSun / 1e6).toLocaleString("en-US")} MILLION KM`;
}

export default function Logbook() {
  const records = useUI((s) => s.records);
  const identified = useUI((s) => s.identified);
  const reached = useUI((s) => s.reached);
  const { closeRecords } = useObservatory();
  const [selected, setSelected] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const open = records === "open";

  const known = useMemo(() => new Set([...identified, ...reached]), [identified, reached]);
  const total = CATEGORIES.reduce((s, c) => s + c.slots, 0);
  const ordered = useMemo(() => CATEGORIES.flatMap((c) => BODIES.filter((b) => c.kinds.includes(b.kind))), []);
  const knownList = ordered.filter((b) => known.has(b.id));
  const current = knownList.find((b) => b.id === selected) ?? knownList.find((b) => b.id === "uranus") ?? knownList[0] ?? null;

  useEffect(() => {
    if (open) closeRef.current?.focus({ preventScroll: true });
  }, [open]);

  if (records === "closed") return null;

  const close = () => {
    setSheet(false);
    closeRecords();
  };
  const pick = (id: string) => {
    audio.blip(990, 0.05, "square", 0.03);
    setSelected(id);
    setSheet(true);
  };
  const step = (dir: number) => {
    if (!current || !knownList.length) return;
    const i = knownList.indexOf(current);
    pick(knownList[(i + dir + knownList.length) % knownList.length].id);
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="records-title" id="codex" data-state={records} className="absolute inset-0 z-40 bg-void">
      {records === "loading" && (
        <p className="absolute inset-0 grid place-items-center font-clock text-[11px] tracking-[0.18em] text-mint glow">▸ OPENING YOUR RECORDS</p>
      )}
      <div className={`flex h-full flex-col transition-opacity duration-[220ms] [transition-timing-function:cubic-bezier(.4,0,.2,1)] ${open ? "opacity-100" : "opacity-0"}`}>
        <header className="relative h-[124px] shrink-0 px-[var(--side)] pt-[calc(env(safe-area-inset-top)+14px)] md:h-[136px] md:pt-[30px]">
          <h1 id="records-title" className="font-display text-[28px] font-[350] leading-[25px] tracking-[0.28px] text-mint glow md:text-[60px] md:leading-[52.8px] md:tracking-[0.6px]">
            SANCTUARY
          </h1>
          <p className="mt-[14px] flex flex-wrap items-center gap-x-[9px] gap-y-[2px] font-clock text-[10px] tracking-[0.12em] text-key md:mt-[12px] md:text-[13px] md:leading-[21px] md:tracking-[0.16em]">
            <span className="text-mint glow">▸ RECORDS</span>·
            <span>
              <b className="font-normal text-mint glow">{known.size}</b> / {total} RECORDED
            </span>
            ·
            <span>
              <span className="text-mint">●</span> REACHED <b className="font-normal text-mint glow">{reached.length}</b>
            </span>
            ·
            <span>
              <span className="text-gold">◇</span> IDENTIFIED <b className="font-normal text-mint glow">{Math.max(0, known.size - reached.length)}</b>
            </span>
          </p>
          <button
            ref={closeRef}
            id="codex-return"
            type="button"
            onClick={close}
            className="absolute right-[var(--side)] top-[calc(env(safe-area-inset-top)+14px)] flex h-[28px] items-center gap-[6px] whitespace-nowrap font-hud text-[12px] font-bold tracking-[0.3px] text-alert glow-halo hover:text-loc md:top-[30px]"
          >
            <span aria-hidden>⏎</span> RETURN
          </button>
        </header>

        <div className="relative mx-[var(--side)] grid min-h-0 flex-1 grid-cols-1 border border-b-0 border-ember/50 lg:grid-cols-[979px_1fr] xl:grid-cols-[minmax(0,979px)_381px]">
          <div className="dot-grid min-h-0 overflow-y-auto overscroll-contain">
            {CATEGORIES.map((cat) => {
              const items = BODIES.filter((b) => cat.kinds.includes(b.kind));
              const got = items.filter((b) => known.has(b.id)).length;
              return (
                <section key={cat.id} aria-label={cat.title} className="[&+section]:pt-[3px]">
                  <h2 className="flex h-[27px] items-center border-b border-ember/50 bg-void/85 px-[14px] font-hud text-[11px] font-bold tracking-[0.04em] text-key glow md:text-[12px]">
                    <span className="mr-[8px] text-[8px]">▸</span>
                    {cat.title}
                    <span className="ml-[10px] font-normal text-dim">
                      {got} / {cat.slots}
                    </span>
                  </h2>
                  <ul className="grid grid-cols-3 md:grid-cols-6 lg:grid-cols-9">
                    {Array.from({ length: cat.slots }, (_, i) => {
                      const b = items[i];
                      const isKnown = !!b && known.has(b.id);
                      const isSel = isKnown && current?.id === b.id;
                      return (
                        <li key={i} className="rec-cell aspect-square" data-known={isKnown}>
                          <span className="tick" />
                          {isKnown && b && <Cell body={b} selected={isSel} reached={reached.includes(b.id)} onPick={() => pick(b.id)} />}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>

          <aside className={`min-h-0 overflow-y-auto bg-void lg:static lg:block lg:border-l lg:border-ember/50 ${sheet ? "absolute inset-0 z-20 block" : "hidden"}`}>
            {current ? (
              <Detail
                body={current}
                index={knownList.filter((b) => isVehicle(b.kind) === isVehicle(current.kind)).indexOf(current) + 1}
                of={knownList.filter((b) => isVehicle(b.kind) === isVehicle(current.kind)).length}
                reached={reached.includes(current.id)}
                onStep={step}
                onClose={() => setSheet(false)}
              />
            ) : (
              <p className="p-6 font-saira text-[15px] text-voice">Nothing recorded yet. Scan to start your survey.</p>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

function Cell({ body, selected, reached, onPick }: { body: BodyDef; selected: boolean; reached: boolean; onPick: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const cell = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let live = true;
    // plates render (and vehicles fetch their models) only once the cell scrolls into view
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((en) => en.isIntersecting)) return;
        io.disconnect();
        thumbFor(body).then((u) => live && setSrc(u), () => undefined);
      },
      { rootMargin: "160px" },
    );
    if (cell.current) io.observe(cell.current);
    return () => {
      live = false;
      io.disconnect();
    };
  }, [body]);
  const glow = isVehicle(body.kind) ? "#8fdcff" : body.palette[1];
  return (
    <button ref={cell} type="button" onClick={onPick} aria-label={`${body.name}, ${reached ? "reached" : "identified"}`} className="rec-chip group absolute inset-0 overflow-visible text-left">
      {body.kind === "star" && <span className="pointer-events-none absolute -inset-[60%] rounded-full bg-[radial-gradient(circle,rgba(255,200,140,0.18),rgba(255,106,31,0.08)_40%,transparent_68%)]" />}
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          className="rec-plate absolute inset-0 m-auto h-[86%] w-[86%] object-contain transition-transform duration-300 group-hover:scale-105"
          style={{ filter: `drop-shadow(0 0 7px ${glow}55) drop-shadow(0 0 2px ${glow}66)` }}
        />
      )}
      <span
        className={`absolute left-[5px] top-[6px] rounded-[3px] px-[5px] py-[1px] font-hud text-[10px] font-bold leading-[13px] md:text-[11px] ${
          selected ? "border border-alert text-alert glow" : "bg-[#3a3a3a]/90 text-ink"
        }`}
      >
        {(body.short ?? body.name).toUpperCase()}
      </span>
      <span className="absolute right-[8px] top-[8px] text-[9px] leading-none">
        {reached ? <i className="not-italic text-mint glow">●</i> : <i className="not-italic text-gold">◇</i>}
      </span>
      <span className="absolute bottom-[5px] left-[5px] rounded-[2px] bg-[#2a2622]/80 px-[3px] font-hud text-[9px] leading-[12px] text-dim">{body.label}</span>
      {selected && (
        <>
          <span className="absolute left-[2px] top-[2px] h-[12px] w-[12px] border-l border-t border-alert" />
          <span className="absolute right-[2px] top-[2px] h-[12px] w-[12px] border-r border-t border-alert" />
          <span className="absolute bottom-[2px] left-[2px] h-[12px] w-[12px] border-b border-l border-alert" />
          <span className="absolute bottom-[2px] right-[2px] h-[12px] w-[12px] border-b border-r border-alert" />
        </>
      )}
    </button>
  );
}

function Detail({ body, index, of, reached, onStep, onClose }: { body: BodyDef; index: number; of: number; reached: boolean; onStep: (d: number) => void; onClose: () => void }) {
  const live: Fact[] = body.facts.map((f) => (f.label === "FROM THE SUN" ? { ...f, value: fromSun(body.id) } : f));
  const facts = reached ? live : live.slice(0, 4);
  return (
    <div className="px-[9px] pb-[24px] pt-[15px] md:px-[13px]" key={body.id}>
      <div className="flex items-center justify-between">
        <span className="badge inline-block">
          {isVehicle(body.kind) ? "VEHICLE" : "WORLD"} {String(index).padStart(2, "0")} / {of}
        </span>
        <div className="flex gap-[6px]">
          <button type="button" onClick={onClose} className="rec-chip h-[24px] border border-gold/60 px-2 font-hud text-[11px] text-gold lg:hidden">
            GRID
          </button>
          <button id="prev-world" type="button" aria-label="Previous entry" onClick={() => onStep(-1)} className="rec-chip h-[24px] w-[28px] border border-gold/60 text-gold">
            ‹
          </button>
          <button id="next-world" type="button" aria-label="Next entry" onClick={() => onStep(1)} className="rec-chip h-[24px] w-[28px] border border-gold/60 text-gold">
            ›
          </button>
        </div>
      </div>

      <div className="relative mt-[12px] h-[245px]">
        <span className="absolute left-0 top-0 h-[10px] w-[10px] border-l border-t border-gold/70" />
        <span className="absolute right-0 top-0 h-[10px] w-[10px] border-r border-t border-gold/70" />
        <span className="absolute bottom-0 left-0 h-[10px] w-[10px] border-b border-l border-gold/70" />
        <span className="absolute bottom-0 right-0 h-[10px] w-[10px] border-b border-r border-gold/70" />
        <RecordPreview body={body} />
        <span className="pointer-events-none absolute bottom-[6px] right-[10px] font-hud text-[9px] text-dim">DRAG · TURN</span>
      </div>

      <h2 className="mt-[12px] font-display text-[44px] font-[350] leading-[0.9] text-mint glow md:text-[48px]">{body.name.toUpperCase()}</h2>
      <p className="mt-[12px] font-hud text-[12px] font-bold text-gold">{body.sub}</p>
      <p className={`mt-[6px] font-hud text-[12px] font-bold glow ${reached ? "text-mint" : "text-gold"}`}>{reached ? "● REACHED · FULL SURVEY" : "◇ IDENTIFIED · PARTIAL SURVEY"}</p>

      <dl className="mt-[16px] font-hud text-[12px] uppercase">
        {facts.map((f) => (
          <div key={f.label} className="flex justify-between gap-4 border-b border-rule/70 py-[5px]">
            <dt className="text-dim">{f.label}</dt>
            <dd className="text-right text-ink">
              {f.value}
              {f.note && <small className="block text-[9px] text-dim">{f.note}</small>}
            </dd>
          </div>
        ))}
        {!reached && live.length > 4 && <div className="py-[7px] text-dim">+ {live.length - 4} MORE · FLY CLOSER TO COMPLETE</div>}
      </dl>
      <p className="mt-[12px] font-hud text-[13px] leading-snug text-ash">{body.note}</p>
      <p className="mt-[10px] font-hud text-[9px] uppercase leading-[13px] tracking-[0.02em] text-gold/80">SOURCE · {body.source}</p>
    </div>
  );
}
