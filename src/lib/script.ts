// All narrative copy (placeholder lines written for this project) and story timings.
// The words are placeholders written for this project.

export type Line = { text: string; at?: number; named?: boolean; instructions?: boolean };

export const LOADER = {
  kicker: "SIGNAL / SURVEY FEED",
  title: "SANCTUARY / SURVEY ARCHIVE",
  sources: [
    "SRC JPL HORIZONS · PLANET + MOON STATES",
    "SRC HYG v4.4 · 41,486 STARS · CC BY-SA 4.0",
    "SRC ESA/GAIA/DPAC · MILKY WAY · CC BY-SA 3.0 IGO",
    "SRC NASA · USGS · MISSION MOSAICS · 41 SURVEY MAPS",
    "SRC RING TABLES · SATURN URANUS NEPTUNE",
    "SRC MISSION LOGS · 12 SPACECRAFT",
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
  gateDesktop: "CLICK TO WAKE",
  gatePhone: "TAP TO WAKE",
  phoneNotice: ["PHONE VIEW", "BEST ON DESKTOP"],
};

/** Opening lines; `at` is ms after the loader has faded. */
export const OPENING: Line[] = [
  { text: "you're awake.", at: 120 },
  { text: "nothing out here looks familiar.", at: 3650 },
  { text: "except that.", at: 8200 },
];
/** When the camera starts swinging onto the planet (ms after loader), and how long it takes. */
export const SWEEP_AT = 4600;
export const SWEEP_MS = 1600;

/** Lines after the first scan, read one after another. */
export const CONTACT: Line[] = [
  { text: "Uranus. seventh world out from the Sun.", named: true },
  { text: "close enough to read the rings.", named: true },
  { text: "the controls are yours.", named: true },
];

export const EXPLORE_DESKTOP: Line[] = [
  { text: "W A S D to fly.\nSHIFT ↑  SPACE ↓", named: true, instructions: true, at: 450 },
  { text: "this is close enough.", named: true, at: 5500 },
  { text: "much nearer and we'd be inside it.", named: true, at: 6400 },
  { text: "follow the horizon to circle around.", named: true, at: 9200 },
];
export const EXPLORE_PHONE: Line[] = [
  { text: "drag to look around.\npress and hold to fly ahead.", named: true, instructions: true, at: 450 },
  { text: "this is close enough.", named: true, at: 5500 },
  { text: "follow the horizon to circle around.", named: true, at: 8200 },
];

export const DEEP_SCAN_LINE = "I've named the brighter stars around us.";
/** entering the asteroid belt's slow zone in manual flight */
export const BELT_LINE = "the asteroid belt. easing the drive back a little until we're through.";
/** a contact too far away to identify */
export const SCAN_SIGHTED = (name: string) => `${name.toLowerCase().replace("unidentified object", "object")}. a signal, but too far out to read. get closer and scan again.`;
export const NOTHING_NEW = "nothing new in range.";
export const CHAR_MS = 32;
/** Name of the guide voice in the subtitles. */
export const SPEAKER = "ARGON";

const title = (name: string) => (name.startsWith("OBJECT") ? name.toLowerCase() : name.charAt(0) + name.slice(1).toLowerCase());

/** Autopilot lines (placeholder copy). */
export const TRAVEL = {
  engage: (name: string) => `course laid in for ${title(name)}. sit back.`,
  arrive: (name: string, known: boolean) => (known ? `${title(name)}. we're here.` : "here it is. let me get a better look."),
  cancel: "you have the helm.",
  already: "we're already here.",
};
