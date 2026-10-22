// All story copy and its timings. The words are written for this project.

import type { Cue } from "./dialogue";
import { AU_KM, BODIES, type BodyDef } from "./solar";
import { SITE } from "./site";

export const LOADER = {
  part: "PART I · THE LAST HOME",
  kicker: "SIGNAL / SURVEY FEED",
  title: "SANCTUARY / SURVEY ARCHIVE",
  /** the credits, typed in as the survey loads (links and licences in the README) */
  sources: [
    "SRC NASA/JPL HORIZONS · PLANET + MOON POSITIONS",
    "SRC HYG v4.4 · DAVID NASH · 41,486 STARS · CC BY-SA 4.0",
    "SRC ESA/GAIA/DPAC · A. MOITINHO · MILKY WAY · CC BY-SA 3.0 IGO",
    "SRC NASA · JPL · USGS · JHUAPL · SSI · GSFC/ASU · 41 SURVEY MAPS",
    "SRC NASA 3D RESOURCES · NASA VTAD · SPACECRAFT MODELS",
    "SHIP SPACE GLIDER γ-UNIT · -X-SCORNGAMES · CC BY 4.0",
    "SHIP AQUARIS · ARTY LOCKSMITH · CC BY 4.0",
    "SHIP COOL SPACESHIP WITH LOGO · FORBESANDREW602 · CC BY 4.0",
    "MUSIC DARK WAS THE NIGHT, COLD WAS THE GROUND · BLIND WILLIE JOHNSON, 1927",
    `STORY + GAME · © 2026 ${SITE.author.toUpperCase()} · ALL RIGHTS RESERVED`,
  ],
  milestones: [
    "LOADING STAR CATALOGUE + PLACING THE SKY",
    "BUILDING THE SOLAR SYSTEM",
    "SETTING WORLDS + MOONS IN ORBIT",
    "LOADING URANUS SURVEY",
    "SURVEY LINK READY",
  ],
  note: "IST CLOCK · LIVE POSITIONS",
  footer: "IST CLOCK · TWO-BODY EPHEMERIS · OFFLINE",
  gateDesktop: "CLICK TO BEGIN · SOUND ON",
  gatePhone: "TAP TO BEGIN · SOUND ON",
  resumeDesktop: "CLICK TO RESUME YOUR JOURNEY",
  resumePhone: "TAP TO RESUME YOUR JOURNEY",
  newJourney: "OR START A NEW JOURNEY",
  newConfirm: "CLICK AGAIN TO ERASE YOUR PROGRESS AND START OVER",
  assets: "LOADING MAPS · VEHICLES · VOICES",
  phoneNotice: ["PHONE VIEW", "BEST ON DESKTOP"],
};

export const CHAR_MS = 32;
/** Caption names. The AI keeps its name; the player is addressed as Commander. */
export const SPEAKERS = { ai: "FABLE", player: "COMMANDER", rec: "RECOVERED AUDIO" } as const;

// ---------- 1. awakening near Uranus ----------

/** Opening lines (the voice is not named yet); `at` is ms after the loader has faded. */
export const OPENING: (Cue & { at: number })[] = [
  { who: null, text: "You're awake.", at: 120 },
  { who: null, text: "Nothing out here look familiar?", at: 3650 },
];
/** When the camera starts swinging onto the planet (ms after loader), and how long it takes. */
export const SWEEP_AT = 4600;
export const SWEEP_MS = 1600;
/** the scan prompt comes up on its own this long after the swing ends */
export const SCAN_PROMPT_AFTER_MS = 1400;

/** After the opening scan identifies Uranus. */
export const CONTACT: Cue[] = [
  { who: "ai", text: "Uranus. The seventh planet from the Sun. We're close to the outer edge of the Solar System.", pause: 70, hold: 2300 },
];
/** Still in the opening: the view swings onto the Sun and leans in on it while these play;
 * then the controls are handed over and the journey starts. */
export const HOMEWARD: Cue[] = [
  { who: "ai", text: "Look for the brightest star. The Sun should lead us home.", pause: 400 },
  { who: "ai", text: "Somewhere in that direction is Earth. Let's find it.", pause: 500, hold: 1200 },
  { who: "player", text: "Alright. Let's head for Earth.", pause: 500 },
  { who: "ai", text: "Control is yours, Commander.", pause: 400, hold: 2000 },
];

export const CONTROLS_DESKTOP: Cue = { who: "ai", text: "W A S D to fly.\nSHIFT ↑  SPACE ↓", instructions: true, hold: 4600 };
export const CONTROLS_PHONE: Cue = { who: "ai", text: "drag to look around.\npress and hold to fly ahead.", instructions: true, hold: 4600 };

/** on the way in, a while after the controls are handed over (well before the belt) */
export const INBOUND_TALK_AFTER_MS = 35_000;
export const INBOUND_TALK: Cue[] = [
  { who: "player", text: "My head is splitting.", pause: 400 },
  { who: "ai", text: "The last transit hit the ship hard. Your recovery may take some time.", pause: 700 },
  { who: "player", text: "Do we still have the mission records?", pause: 900 },
  { who: "ai", text: "Yes, Commander. They are secure.", pause: 600, hold: 2400 },
];

// ---------- 2. the asteroid belt ----------

export const BELT_ENTER: Cue[] = [
  { who: "ai", text: "Entering the asteroid belt. Watch your trajectory.", hold: 1500 },
  { who: "ai", text: "SCAN and DEEP SCAN are currently unavailable. I'll notify you when the systems are back online.", pause: 1400, hold: 2600 },
];
export const BELT_CLEAR: Cue[] = [{ who: "ai", text: "Sensor interference is clearing. SCAN and DEEP SCAN are back online.", hold: 2800 }];
/** later crossings: the drive limit is shown, nobody speaks */
export const BELT_TOAST_IN = "ASTEROID BELT · DRIVE HELD AT 120,000 KM/S";
export const BELT_TOAST_OUT = "CLEAR OF THE BELT · FULL DRIVE";

/** what the HUD says when a scan is pressed while the sensors are down */
export const SCAN_DOWN = {
  settling: "SCAN OFFLINE · SENSORS RECALIBRATING",
  belt: "SCAN + DEEP SCAN UNAVAILABLE · SENSOR INTERFERENCE",
  locked: "SCAN UNAVAILABLE",
};
export const MAP_LOCKED = "NAVIGATION OFFLINE";

// ---------- 3. Earth ----------

export const EARTH_FOUND: Cue[] = [
  { who: "ai", text: "Earth confirmed. Welcome home, Commander.", pause: 300, hold: 1700 },
  { who: "player", text: "We made it.", pause: 500, hold: 1500 },
  { who: "ai", text: "There's a problem. I can't detect any life signals nearby.", pause: 1600, hold: 2000 },
  { who: "player", text: "No. That's not possible. Run a DEEP SCAN.", pause: 500 },
];
/** straight after the deep scan of Earth reads out */
export const EARTH_NONE: Cue = { who: "ai", text: "Deep scan complete. There are no life signals anywhere in the Solar System.", pause: 1200, hold: 1400 };
export const EARTH_YEAR: Cue[] = [
  { who: "player", text: "What the hell? Are we even in the right Solar System?", pause: 3200 },
  { who: "ai", text: "Solar System confirmed. We are in the Sol system. According to Earth's calendar, the current year is 2126.", pause: 700, hold: 2600 },
  { who: "player", text: "2126? It should be 2028. We were supposed to be back before the event. I haven't aged.", pause: 500 },
  { who: "ai", text: "Checking temporal records. The current year remains 2126.", pause: 1400 },
  { who: "player", text: "That's impossible. What happened?", pause: 400 },
  { who: "ai", text: "I cannot determine the cause from the available records.", pause: 900, hold: 2400 },
];
export const EARTH_SIGNALS: Cue[] = [
  { who: "ai", text: "I'm detecting artificial signals across the Solar System. They're extremely weak, distorted and scattered. I can't pinpoint their sources yet.", pause: 1600, hold: 2400 },
  { who: "player", text: "Can you give me a direction?", pause: 400 },
  { who: "ai", text: "There are too many signals to resolve from here. As we get closer, I can pin down where they're coming from. We'll find them as we explore.", pause: 600, hold: 2800 },
];
export const EXPLORE_UNLOCKED = "NAVIGATION ONLINE · ARCHIVE ONLINE";

// ---------- scans and travel, any time ----------
// The small talk around scans and travel comes in a few wordings each, picked at random and
// never the same twice running, so the same moment doesn't sound canned. None of it carries
// the story: story scenes keep their own fixed lines.

const lastPick = new Map<string, number>();
/** One of a moment's wordings at random, never the one picked last time for `key`. */
export function pick(options: string[], key: string) {
  if (options.length < 2) return options[0];
  let i = Math.floor(Math.random() * options.length);
  if (i === lastPick.get(key)) i = (i + 1 + Math.floor(Math.random() * (options.length - 1))) % options.length;
  lastPick.set(key, i);
  return options[i];
}

const decks = new Map<string, string[]>();
const lastDealt = new Map<string, string>();
/** Lines dealt like cards: every one once, in a shuffled order, before any repeats. */
export function deal(options: string[], key: string) {
  let deck = decks.get(key);
  if (!deck?.length) {
    deck = [...options];
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    // a fresh deck never opens with the line the last one ended on
    if (deck.length > 1 && deck[deck.length - 1] === lastDealt.get(key)) [deck[0], deck[deck.length - 1]] = [deck[deck.length - 1], deck[0]];
    decks.set(key, deck);
  }
  const line = deck.pop()!;
  lastDealt.set(key, line);
  return line;
}

/** FABLE, after X stops us hard from high speed */
export const BRAKE_LINES = [
  "Commander, a stop that hard puts the whole hull under strain. Please don't do that.",
  "That was too abrupt. The ship can't take many stops like that.",
  "Structural load just spiked. Ease off the drive before you brake.",
  "The inertial dampers are at their limit. Slow down first, then stop.",
  "I'd prefer we keep this ship in one piece. Gentler, please.",
  "Hull stress warning. Another stop like that could damage the frame.",
  "Sensors are recalibrating after that jolt. Please brake more gently.",
  "That nearly overloaded the drive. Be careful, Commander.",
  "This ship wasn't built for emergency stops at that speed.",
  "Every hard stop costs us hull integrity. We only have one ship.",
  "That was rough. Next time, bring the speed down before you brake.",
  "Emergency stop logged. Please don't make a habit of it.",
];

export const READ_UNIDENTIFIED = "UNIDENTIFIED OBJECT";
export const READ_IDENTIFIED = (name: string) => `OBJECT IDENTIFIED: ${name.toUpperCase()}`;
export const MAP_UNIDENTIFIED = "UNIDENTIFIED · SCAN IT TO SET A COURSE";

/** a deep scan of open sky */
export const DEEP_SCAN_LINES = [
  "I've catalogued the brighter stars around us.",
  "The brighter stars around us are catalogued.",
  "Deep scan complete. I've named the brightest stars in view.",
  "Star field mapped. The brightest ones are in the records now.",
];
/** a contact too far away to identify */
export const SCAN_SIGHTED_LINES = [
  "I've detected an unidentified object ahead. Move closer and scan it again.",
  "There's something ahead, too far to identify. Get closer and scan again.",
  "Unidentified contact. We need to be closer for a proper reading.",
  "Something's out there, but it's too far to read. Bring us closer.",
];
/** alongside a story site we have not scanned yet: we are there, now scan it */
export const SITE_ALONGSIDE_LINES = [
  "We're alongside it. Scan it, Commander.",
  "This is where the signal is coming from. A scan should tell us what it is.",
  "We're right next to it now. Run a scan.",
];
export const NOTHING_NEW_LINES = ["Nothing new in range.", "No new contacts.", "Nothing here we haven't already logged.", "Sensors show nothing new.", "All quiet. Nothing new out here."];
/** a body scanned again that is already in the records */
export const RESCAN_LINES = ["Already in the records.", "We've logged this one.", "Known contact. No change.", "Nothing new on this one.", "Same readings as last time."];
/** now and then, after a first identification */
export const LOGGED_LINES = ["Logged for the survey.", "Adding it to the records.", "Readings are clean.", "That's another one for the survey."];
export const CRAFT_LOGGED_LINES = ["No response on any channel.", "Logged.", "Silent, like the rest.", "No signal. Nobody home."];

/** the commander, now and then, on reaching a world for the first time (after Earth) */
export const PLAYER_ARRIVE_LINES = [
  "Look at that.",
  "Beautiful… and nobody left to see it.",
  "Still nothing. Not a single signal.",
  "I used to stare at pictures of this when I was a kid.",
  "Quiet out here. Too quiet.",
  "Hard to believe we're really here.",
  "Ha. Never thought I'd see this one up close.",
];
/** the commander, now and then, after FABLE complains about a hard stop */
export const PLAYER_BRAKE_LINES = ["Yeah, yeah. Sorry.", "Okay, okay. I hear you.", "Noted, FABLE."];

// the first wording of each, for anything that wants the plain line
export const DEEP_SCAN_LINE = DEEP_SCAN_LINES[0];
export const SCAN_SIGHTED = SCAN_SIGHTED_LINES[0];
export const NOTHING_NEW = NOTHING_NEW_LINES[0];

/** a body's own name for one the HUD shows in capitals; "the object" for one not yet identified */
const title = (name: string) => {
  if (name.includes("OBJECT")) return "the object";
  const b = BODIES.find((x) => x.name.toUpperCase() === name.toUpperCase());
  if (!b) return name.charAt(0) + name.slice(1).toLowerCase();
  return THE.has(b.id) ? `the ${b.name}` : b.name;
};
/** names that read with "the" in a sentence ("Course set for the Sun.") */
const THE = new Set(["sun", "moon", "iss", "jwst", "mro", "psyche-craft"]);
const opening = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export const TRAVEL = {
  engages: (name: string) => [`Course set for ${title(name)}.`],
  arrives: (name: string) => [`${opening(title(name))}. We've arrived.`],
  /** wordings without a name, mixed in so the same line isn't heard every time */
  anyEngage: ["Autopilot engaged.", "Plotting the course now."],
  anyArrive: ["We've arrived, Commander.", "Arrival. Holding position here."],
  cancels: ["You have the helm.", "Manual control. The helm is yours."],
  alreadys: ["We're already here.", "Already here, Commander."],
  engage: (name: string) => pick([...TRAVEL.engages(name), ...TRAVEL.anyEngage], "engage"),
  arrive: (name: string) => pick([...TRAVEL.arrives(name), ...TRAVEL.anyArrive], "arrive"),
  get cancel() {
    return pick(TRAVEL.cancels, "cancel");
  },
  get already() {
    return pick(TRAVEL.alreadys, "already");
  },
};

// ---------- identification ----------

const ORDINAL = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"];
const PLANETS = ["mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune"];
const MAJOR_KM = 200;
const majors = (parent: string) => BODIES.filter((b) => b.kind === "moon" && b.parent === parent && b.radiusKm >= MAJOR_KM).length;
const nameOf = (id: string) => BODIES.find((b) => b.id === id)?.name ?? id;

/** The distance part of an identification, in the words the AI speaks. */
export function distanceLine(sunKm: number) {
  const au = sunKm / AU_KM;
  return `Distance from the Sun: ${au < 9.95 ? au.toFixed(1) : Math.round(au)} astronomical units.`;
}

/**
 * What the AI says on identifying a body: its name and what it is (in one of a few wordings),
 * then (for anything with an orbit of its own to report) how far it is from the Sun right now,
 * and now and then a short word after. A body already in the records gets a short line instead
 * (`known`). `parts` are the recorded pieces, spoken back to back.
 */
export function identifyLine(def: BodyDef, sunKm: number, known = false): { text: string; parts: string[] } {
  const far = def.kind === "star" || def.kind === "satellite" ? null : distanceLine(sunKm);
  const craft = def.kind === "satellite" || def.kind === "spacecraft";
  const parts = known ? [pick(RESCAN_LINES, "rescan")] : [identifyIntro(def, sunKm)];
  if (far) parts.push(far);
  if (!known && def.kind !== "star" && Math.random() < 0.45) parts.push(pick(craft ? CRAFT_LOGGED_LINES : LOGGED_LINES, "logged"));
  return { text: parts.join(" "), parts };
}

/**
 * Which wording each body is introduced with (the first unless listed). A body is named once, so
 * one wording each is enough: the same body always reads the same way, and bodies of a kind
 * don't all read alike.
 */
const INTRO_WORDING: Record<string, number> = {
  moon: 1, enceladus: 1, rhea: 1, hyperion: 1, pluto: 1, "relay-neptune": 1, "probe-uranus": 1,
  jwst: 1, mro: 2, dawn: 2, "psyche-craft": 1, "voyager-2": 1,
};

/** How a body is introduced (its one wording; a dwarf planet's depends on where it is). */
export function identifyIntro(def: BodyDef, sunKm: number) {
  const all = identifyIntros(def, sunKm);
  return all[INTRO_WORDING[def.id] ?? 0] ?? all[0];
}

/** Every wording of a body's introduction (the first is the plainest). */
export function identifyIntros(def: BodyDef, sunKm: number): string[] {
  const n = def.name;
  switch (def.kind) {
    case "star":
      return ["The Sun. Our star, at the centre of the Solar System.", "The Sun. Everything out here still turns around it.", "Our star. The Sun, at the heart of the Solar System."];
    case "planet": {
      const ord = ORDINAL[PLANETS.indexOf(def.id)];
      return [`${n}. The ${ord} planet from the Sun.`, `That's ${n}, the ${ord} planet out from the Sun.`, `${n} confirmed. ${opening(ord)} planet from the Sun.`];
    }
    case "moon": {
      const p = nameOf(def.parent ?? "");
      if (def.id === "moon") return ["The Moon. Earth's only natural satellite.", "Earth's Moon. Its only natural satellite.", "The Moon. Earth's one natural satellite."];
      if (def.radiusKm < MAJOR_KM) return [`${n}, a small moon of ${p}.`, `${n}. One of ${p}'s smaller moons.`, `A small moon of ${p}: ${n}.`];
      if (majors(def.parent ?? "") > 1) return [`${n}, one of ${p}'s major moons.`, `${n}. A major moon of ${p}.`, `That's ${n}, one of the large moons of ${p}.`];
      return [`${n}, ${p}'s largest moon.`, `${n}. The largest moon of ${p}.`, `${p}'s biggest moon: ${n}.`];
    }
    case "dwarf": {
      const where = sunKm < 6 * AU_KM ? "in the asteroid belt" : "in the outer Solar System";
      return [`${n}. A dwarf planet ${where}.`, `${n}, a dwarf planet ${where}.`, `Dwarf planet ${n}, ${where}.`];
    }
    case "asteroid":
      return [
        `${n}. Asteroid identified. Composition and orbital data are available in the scan results.`,
        `${n}. An asteroid. Its composition and orbit are in the scan results.`,
        `Asteroid ${n}. Orbit and composition logged in the scan results.`,
      ];
    case "satellite":
      return [
        `Artificial satellite detected: the ${n}. Its communication systems are inactive, but some structural data remains recoverable.`,
        `The ${n}. An artificial satellite, silent now, though some structural data is still recoverable.`,
        `Artificial satellite: the ${n}. No active communications. Some structural data remains.`,
      ];
    case "spacecraft": {
      // "the James Webb Space Telescope", as the travel lines say it
      const the = THE.has(def.id) ? `the ${n}` : n;
      const The = opening(the);
      return def.launchYear
        ? [`${The}. An artificial spacecraft, launched in ${def.launchYear}. Its systems are inactive.`, `${The}. A spacecraft launched in ${def.launchYear}. Nothing aboard is running.`, `That's ${the}, launched in ${def.launchYear}. Its systems are dark.`]
        : [`${The}. An artificial spacecraft. Its systems are inactive.`, `${The}. A spacecraft, its systems dark.`, `${The}. Artificial, and inactive.`];
    }
  }
}
