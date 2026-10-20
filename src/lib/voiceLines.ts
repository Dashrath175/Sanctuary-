// Every line the game can speak (`npx tsx scripts/voice-lines.ts` prints the list). Each recording
// is found by its caption text, so captions and recordings must match word for word.

import type { Cue } from "./dialogue";
import { BODIES, EPOCH_MS, ephemeris, type BodyDef } from "./solar";
import * as S from "./script";
import { CLUES, DEEP_TOO_FAR, HINT_INWARD, HINT_NEAR_LINES, HINT_OUTWARD } from "./clues";
import * as F from "./finale";

/** `torn`: a stretch of a recording that breaks up */
/** `torn`: a stretch of a recording that breaks up; `bark`: small talk around scans and travel, not the story */
export type VoiceLine = { voice: "ai" | "player" | "rec-a" | "rec-b"; text: string; torn?: boolean; bark?: boolean };

export function allVoiceLines(): VoiceLine[] {
  const out = new Map<string, VoiceLine>();
  const add = (voice: VoiceLine["voice"], text: string, torn = false, bark = false) =>
    out.set(text.trim(), { voice, text: text.trim(), ...(torn ? { torn } : {}), ...(bark ? { bark } : {}) });
  const bark = (voice: VoiceLine["voice"], text: string) => add(voice, text, false, true);
  const cues = (list: Cue[]) => list.forEach((c) => !c.instructions && add(c.who === "player" ? "player" : "ai", c.text));

  cues(S.OPENING);
  cues(S.CONTACT);
  cues(S.HOMEWARD);
  cues(S.INBOUND_TALK);
  cues([S.EARTH_NONE]);
  cues(S.BELT_ENTER);
  cues(S.BELT_CLEAR);
  cues(S.EARTH_FOUND);
  cues(S.EARTH_YEAR);
  cues(S.EARTH_SIGNALS);
  for (const t of [...S.DEEP_SCAN_LINES, ...S.SCAN_SIGHTED_LINES, ...S.NOTHING_NEW_LINES, ...S.RESCAN_LINES, ...S.LOGGED_LINES, ...S.CRAFT_LOGGED_LINES, ...S.TRAVEL.cancels, ...S.TRAVEL.alreadys, ...S.BRAKE_LINES])
    bark("ai", t);
  for (const t of [...S.TRAVEL.anyEngage, ...S.TRAVEL.anyArrive, ...S.SITE_ALONGSIDE_LINES]) bark("ai", t);
  for (const t of [...S.PLAYER_ARRIVE_LINES, ...S.PLAYER_BRAKE_LINES]) bark("player", t);
  for (const t of [...S.TRAVEL.engages("OBJECT"), ...S.TRAVEL.arrives("OBJECT")]) bark("ai", t);

  // every body: travel lines and the name part of its identification, in every wording
  const named = (b: BodyDef) => b.name.toUpperCase();
  for (const b of BODIES) {
    for (const t of [...S.TRAVEL.engages(named(b)), ...S.TRAVEL.arrives(named(b))]) bark("ai", t);
    // its introduction (a dwarf planet's depends on where it is: below)
    if (b.kind !== "dwarf") bark("ai", S.identifyIntro(b, 0));
  }
  // the distance part: every value any body reaches over the next four years (sampled weekly),
  // and a dwarf planet's wording for wherever it actually is then (Ceres in the belt, Pluto beyond)
  const pos = new Map<string, [number, number, number]>();
  for (let t = EPOCH_MS; t < EPOCH_MS + 4 * 365.25 * 86_400_000; t += 7 * 86_400_000) {
    ephemeris(t, pos);
    for (const b of BODIES) {
      const p = pos.get(b.id);
      if (!p || b.kind === "star") continue;
      if (b.kind === "dwarf") bark("ai", S.identifyIntro(b, Math.hypot(...p)));
      if (b.kind !== "satellite") bark("ai", S.distanceLine(Math.hypot(...p)));
    }
  }

  for (const c of CLUES) {
    cues(c.scan);
    if (c.deep) cues(c.deep);
  }
  for (const t of HINT_NEAR_LINES) bark("ai", t);
  bark("ai", DEEP_TOO_FAR);
  const regions = ["", ...["jupiter", "saturn", "neptune", "ceres", "earth", "mars", "mercury", "uranus"].map((id) => `, around ${BODIES.find((b) => b.id === id)!.name}`)];
  for (const w of regions) {
    bark("ai", HINT_OUTWARD(w));
    bark("ai", HINT_INWARD(w));
  }

  cues(F.SIGNAL_START);
  for (const t of [F.SIGNAL_REMIND, F.SIGNAL_STRONGER, ...F.SIGNAL_WEAKER_LINES, F.SIGNAL_CLOSE, ...F.SIGNAL_HOLD_LINES, ...F.TRANSMISSION_HOLD_LINES]) bark("ai", t);
  cues(F.SHIP1_ASK);
  cues(F.SHIP1_FOUND);
  cues(F.SHIP1_RECOVERED);
  cues(F.SHIP1_AFTER);
  cues(F.TRANSMISSION_START);
  cues(F.SHIP2_LOOK);
  cues(F.SHIP2_FOUND);
  cues(F.SHIP2_DEEP);
  cues(F.SHIP2_MANIFEST);
  F.RECONSTRUCTION.forEach((p) => cues(p.cues));
  cues(F.BREAKDOWN);
  cues(F.ENDING);
  cues(F.PART_TWO);
  for (const r of F.RECORDINGS) for (const l of r.lines) add(r.who === "rec-a" ? "rec-a" : "rec-b", l.text, !!l.torn);

  return [...out.values()];
}
