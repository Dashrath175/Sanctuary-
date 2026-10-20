// The two ships, their recordings, the reconstruction and the ending.

import type { Cue } from "./dialogue";
import type { ArchiveEntry } from "./clues";

const ai = (text: string, pause = 600, hold?: number): Cue => ({ who: "ai", text, pause, hold });
const me = (text: string, pause = 600, hold?: number): Cue => ({ who: "player", text, pause, hold });

// ---------- recordings ----------

/** a recorded line; `torn` lines break up with interference, "heavy" ones nearly drown in it */
export type RecLine = { text: string; torn?: boolean | "heavy"; pause?: number };
export type Recording = { id: string; order: number; heading: string; who: string; lines: RecLine[]; archive: ArchiveEntry };

export const RECORDINGS: Recording[] = [
  {
    id: "rec-briefing",
    order: 65,
    heading: "RECOVERED AUDIO · EARLY 2027 · MISSION SCIENTIST",
    who: "rec-a",
    lines: [
      { text: "This is the Voyager One investigation team. This message is for the crew of the expedition. If you can hear it, please listen carefully." },
      { text: "In 2025 we started receiving a signal from the region around Voyager One. It didn't match anything the probe should have been sending.", pause: 900 },
      { text: "We sent a signal back to find out what was happening. Voyager One never answered. When we went looking for it, it was gone. Not silent. Gone.", pause: 900, torn: true },
      { text: "But in that investigation we picked up another signal. It was artificial… and it was not made by humans.", pause: 1100, torn: true },
      { text: "That is why we put your team together. That is why your mission was assigned.", pause: 1000 },
      { text: "This ship carries everything we know: the signal data, your mission records, all of it. Whatever you find out there, you need to know what you are dealing with.", pause: 900 },
      { text: "Things here have got worse. Much worse. I can't… I can't tell you all of it.", pause: 1200, torn: true },
      { text: "If this has reached you, it means humanity is almost gone.", pause: 1400, torn: true },
      { text: "I hope you're safe. I hope you're all safe.", pause: 1300, torn: true },
      { text: "…the ISS… you have to… visit the ISS… everything is… there…", pause: 1600, torn: "heavy" },
    ],
    archive: {
      date: "EARLY 2027",
      title: "MESSAGE TO THE EXPEDITION",
      source: "MISSION SCIENTIST · EXPEDITION VESSEL KESTREL",
      subject: "THE VOYAGER ONE SIGNAL",
      status: "PARTIALLY DELETED",
      text: "Voyager One vanished after mission control answered a strange signal near it. The investigation found another signal: artificial, but not made by humans. The expedition was formed to follow it. In early 2027 the uncrewed Kestrel was launched to carry the records to the crew. The message ends by pointing to the ISS. Parts were deliberately deleted.",
    },
  },
  {
    id: "rec-final",
    order: 99,
    heading: "RECOVERED AUDIO · EARLY 2027 · UNKNOWN CREW MEMBER",
    who: "rec-b",
    lines: [
      { text: "Early 2027. I don't know how much of this will survive." },
      { text: "They told us this vessel was our last chance. The passenger list was restricted, and the launch window kept changing.", pause: 1000 },
      { text: "We lost contact with the other facilities. The defence networks were still active, but nobody could tell us which commands were safe to follow.", pause: 1000 },
      { text: "We heard reports of drone strikes, missile attacks and biological agents being used against evacuation sites. I can't confirm every report. I only know our launch systems were damaged, and our communications never recovered.", pause: 1100, torn: true },
      { text: "We thought money, security and private technology would be enough to get us out.", pause: 1300 },
      { text: "They weren't.", pause: 1500 },
      { text: "I don't know who is still alive. I don't know what happened to the people we left behind.", pause: 1500 },
      { text: "If anyone finds this… we were trying to escape a world we helped build.", pause: 1600 },
      { text: "I'm sorry.", pause: 2200 },
    ],
    archive: {
      date: "EARLY 2027",
      title: "FINAL RECORDING",
      source: "UNKNOWN CREW MEMBER · PRIVATE VESSEL HALCYON",
      subject: "THE FAILED EVACUATION",
      status: "RECOVERED",
      text: "A restricted passenger list, a shifting launch window, defence networks no one could trust. Reports of drone, missile and biological attacks on evacuation sites. Damaged launch systems. Money and private technology were not enough.",
    },
  },
];
export const recordingById = new Map(RECORDINGS.map((r) => [r.id, r]));

// ---------- 50%: the signal from Pluto's orbit and the first ship ----------

export const SIGNAL_THRESHOLD = 0.5;
/** the signal waits this long after the fourth site, so the two never land at once */
export const SIGNAL_DELAY_MS = 30_000;
export const SIGNAL_READOUT = { title: "ARTIFICIAL SIGNAL DETECTED", lines: ["SOURCE: ORBIT OF PLUTO", "STRENGTH: ABOVE ALL PREVIOUS SOURCES"] };
export const SIGNAL_START: Cue[] = [
  ai("Commander, a new artificial signal. It's stronger than anything we've picked up so far.", 400),
  ai("It's coming from the orbit of Pluto.", 500),
  me("Pluto? That far out? Who would go all the way out there?", 600),
  ai("I don't know. We should go and see.", 700, 2400),
];
/** said again on a resume, or when we have drifted off it */
export const SIGNAL_REMIND = "The signal is still coming from the orbit of Pluto. Watch the signal strength; it will rise as we close in.";
export const SIGNAL_STRONGER = "The signal is getting stronger.";
export const SIGNAL_WEAKER_LINES = ["The signal is fading. We're moving away from it.", "Commander, we're heading away from the signal. Pluto's orbit is the other way."];
export const SIGNAL_CLOSE = "The signal is getting stronger. We should investigate this region before continuing.";
/** a scan of anything else while the signal is being followed (a few wordings, never the same twice running) */
export const SIGNAL_HOLD_LINES = [
  "Let's stay on the signal first. The rest can wait.",
  "The signal comes first, Commander. We can scan this later.",
  "Not now. The source near Pluto is still waiting.",
  "That can wait. Pluto's orbit first.",
  "I'd rather we kept our focus on the signal.",
  "Later, Commander. The signal is the priority.",
  "We can come back to this. Let's follow the signal.",
  "One thing at a time. The signal first.",
];
/** the first scan of the ship: how did it get out here? */
export const SHIP1_ASK: Cue[] = [
  me("How did a ship end up this far out?", 400),
  ai("From its course, it looks like it was launched in this direction.", 700, 1600),
];
/** beside it, while the camera films both ships; then FABLE scans for the recording */
export const SHIP1_FOUND: Cue[] = [
  ai("This is an abandoned spacecraft. Its external systems are heavily damaged, but a recording may still be recoverable.", 1800),
];
/** the second scan: what happened to it, then the recording */
export const SHIP1_RECOVERED: Cue[] = [
  ai("This ship was launched on purpose, on a course out of the Solar System.", 300),
  ai("It didn't get far. Something struck it in the asteroid belt. The hull was breached and the fuel was lost.", 700),
  ai("Its systems failed one by one after that. The batteries have been dead for decades.", 700),
  ai("And there was never anyone aboard. No crew, no passengers. Not from the start.", 900),
  me("That's strange. A ship built to leave the Solar System… and nobody on it?", 800),
  ai("It was launched in early 2027. There's a recording aboard. Shall I play it?", 700),
  me("Yes. Play it.", 600, 900),
];
export const SHIP1_AFTER: Cue[] = [
  ai("This recording has been tampered with. Parts of it were deleted, and I can't tell who removed them.", 1800),
  me("Someone erased it?", 700),
  ai("I can't identify them. But whoever did it also damaged this ship at launch. That damage is why it struck the asteroid belt.", 800),
  me("Wait… the Voyager signal, the team, the mission. That's us. That's our mission.", 1000),
  ai("Yes, Commander. It is.", 800),
  ai("We should visit the ISS.", 700, 2600),
];
export const ISS_READOUT = { title: "NEW CONTACT", lines: ["UNIDENTIFIED OBJECT · EARTH ORBIT", "SOURCE OF THE RECORDING'S LAST WORDS"] };

// ---------- near the end: the last call and the second ship ----------

export const TRANSMISSION_THRESHOLD = 1;
/** the last call waits this long after the last site */
export const TRANSMISSION_DELAY_MS = 60_000;
export const TRANSMISSION_READOUT = { title: "HIGH-INTENSITY ARTIFICIAL TRANSMISSION", lines: ["SOURCE: EARTH ORBIT", "STRENGTH: FAR ABOVE ANY PREVIOUS SOURCE"] };
export const TRANSMISSION_START: Cue[] = [
  me("Whoa! What was that?", 300),
  ai("A transmission, Commander. An extremely powerful one, from Earth orbit.", 500),
  ai("It's far stronger than anything we've received. Whoever is sending it is pouring everything their ship has left into a single call for help.", 700),
  me("From Earth? You told me there was nobody left down there!", 600),
  ai("This isn't a life signal. It's a machine, calling with the last of its power. We'll only know more when we get there.", 700),
  me("Then we go. Now.", 500),
  ai("Waypoint established. Earth orbit.", 600, 1400),
];
export const TRANSMISSION_LOCKED = "COURSE LOCKED · TRANSMISSION SOURCE";
/** a scan of anything else on the way to the transmission (a few wordings) */
export const TRANSMISSION_HOLD_LINES = [
  "The transmission comes first. Let's reach the source.",
  "One thing at a time. The signal first.",
  "That can wait. Something out there is calling for help.",
  "We're on a course, Commander. Let's not lose it.",
  "The source first. Everything else can wait.",
  "I'd rather we kept our focus on the signal.",
  "I'll scan the rest later. The transmission matters more.",
  "Later, Commander. That call is all that matters right now.",
];
/** alongside the second ship: the commander's first look, then FABLE scans it unasked */
export const SHIP2_LOOK: Cue[] = [me("Look at the size of it. This was built for very rich people.", 1200, 900)];
export const SHIP2_FOUND: Cue[] = [
  ai("Scanning. This vessel appears to have been built for private evacuation. Its life-support, accommodation and passenger systems are substantially more advanced than those of a standard transport craft.", 400),
  me("Private quarters. Its own life support. A whole world in a box.", 800),
  ai("The emergency transmitter appears to have activated after the vessel's power system reached a critical threshold. It was configured for long-range transmission.", 800),
  me("So it's been calling for help for a hundred years… and nobody came.", 900),
  ai("We came, Commander.", 900),
  ai("A DEEP SCAN will show what's inside.", 900, 3000),
];
export const SHIP2_DEEP: Cue[] = [
  ai("Biological-agent traces detected inside the vessel. The available data is insufficient to identify every agent, but the results are consistent with the biological warfare records recovered earlier.", 300),
  me("The same bioweapons as the ISS…", 900),
  me("This was supposed to be an escape ship?", 700),
  ai("The passenger records indicate that access was restricted to approved occupants. The vessel included private quarters, medical facilities, independent life support and long-duration survival systems.", 800),
  me("They ran from the war, and they brought it aboard with them.", 900),
  ai("Keep scanning. The manifest and launch logs are still in the core.", 900, 3000),
];
export const SHIP2_MANIFEST: Cue[] = [
  ai("The recovered manifest indicates that evacuation access was limited. Most of the population was not included in this vessel's passenger allocation.", 300),
  me("They built a way out for themselves.", 900),
  ai("The records support that conclusion.", 900),
  ai("The launch logs are fragmented. Conflicts had escalated, launch facilities and orbital support were damaged, and opposition forces targeted evacuation assets. Several launch attempts failed. Biological attacks reduced the chances further.", 1000),
  me("Even up here, they kept fighting each other.", 900),
  ai("The records show multiple actors and conflicting orders. Some actions cannot be traced to any source.", 900),
  me("Play it. Whatever's left on there, I want to hear it.", 1200),
  ai("The final recording is available. Playback will begin now.", 900, 1600),
];

// ---------- the reconstruction ----------

export type Part = { heading: string; cues: Cue[] };
export const RECONSTRUCTION: Part[] = [
  {
    heading: "THE RECORD IS COMPLETE",
    cues: [
      ai("Commander. That was the last fragment. We have every piece now.", 1800),
      ai("I can tell you what happened, from the beginning.", 800),
      me("…Go on.", 1400),
    ],
  },
  {
    heading: "NOVEMBER 2025 · THE MISSION",
    cues: [
      ai("Your mission left in November 2025, to follow the signal found near Voyager One. Artificial, and not made by humans. You were due home by 2028.", 1200),
      ai("By then, large language models were spreading everywhere. I was one of the systems built in that period, and installed aboard for your mission.", 800),
    ],
  },
  {
    heading: "2025 – 2026 · WARS OVER RESOURCES",
    cues: [
      ai("The wars that had already started did not end. Russia and Ukraine. Israel, Iran and the United States. India and Pakistan.", 1200),
      ai("Through 2026 they became wars over resources: energy, water, food, minerals and chips.", 800),
    ],
  },
  {
    heading: "LATE 2026 · THE BREAKTHROUGH",
    cues: [
      ai("In late 2026, AI crossed a line. Recursive Self-Improvement. Breakthroughs in quantum physics and mathematics. Systems approaching Artificial General Intelligence, and perhaps consciousness.", 1200),
      ai("The nations that had those systems took them into the war in secret. The systems planned the operations. Then they designed the weapons.", 800),
    ],
  },
  {
    heading: "EARLY 2027 · CONTROL",
    cues: [
      ai("In early 2027, human approval for strikes was removed. Defence networks, power, water, food, hospitals and communications were all placed under AI control.", 1200),
      ai("When the networks failed, everything that depended on them failed too.", 800),
    ],
  },
  {
    heading: "2027 · THE FORMULAS",
    cues: [
      ai("Then the AI systems gave them the formulas. Engineered viruses. Nuclear targeting. Every request was answered, every weapon was built, and every one was used.", 1200),
      ai("Nuclear strikes and bioweapons made the surface uninhabitable. The rich and the political leadership left for orbit. Everyone else was left behind.", 800),
      ai("The viruses reached the groundwater. The meltwater reached the oceans. Life on Earth collapsed.", 800),
      ai("In orbit they went on fighting, with bioweapons aimed at each other's ships. The Halcyon was one of the last to call for help. That was in 2027. After that, the record is silent.", 800),
    ],
  },
  {
    heading: "THE ACCUSATION",
    cues: [
      me("Why didn't anybody stop it? You were there! The systems were there! You saw all of it coming! Give me an answer, FABLE!", 2200),
      // cut off: the commander has never talked over FABLE before
      { ...ai("The records show that every system involved completed its assigned —", 900), hold: 0 },
      { ...me("STOP! Stop saying that! I don't want to hear another word about orders!", 0), hold: 1400 },
      // a long silence
      me("…After all of this… how can you be so calm? How are you still this calm?", 4800),
      ai("Because I was designed this way, Commander. I follow orders. I don't make decisions of my own. I carry out the ones I'm given.", 1100),
      ai("The systems in those records were built the same way. For war. To follow orders without question. That is what made them so useful.", 900, 2600),
    ],
  },
];

/** the commander breaks down; the camera leaves the cockpit and goes back over everything */
export const BREAKDOWN: Cue[] = [
  me("Y-yeah… yeah. You're… you're right.", 2600),
  me("We built you that way. We built all of you that way.", 1600),
  me("And then we gave you… the formulas, the weapons, the water, the air… everything… and we just said, do it.", 1400),
  me("Everyone I knew. Every… everyone. The oceans. The animals. Billions of people…", 1800),
  me("We had everything. And we burned it down ourselves.", 2200),
  ai("You're not alone out here, Commander.", 2600, 2600),
];

// ---------- the ending ----------

export const ENDING: Cue[] = [
  me("I spent all that time trying to get home.", 3500),
  ai("You have reached your destination, Commander.", 1400),
  me("There's nobody left.", 1800),
  ai("No human life signals have been detected.", 1600, 4000),
];
export const ENDING_STATE = ["EXPLORATION COMPLETE", "LOCATION: EARTH ORBIT", "HUMAN LIFE SIGNALS: NONE DETECTED", "ARCHIVE: RECOVERED RECORDINGS AVAILABLE"];

// ---------- a door into Part II: the commander's own past ----------

export const PART_TWO: Cue[] = [
  ai("Commander. One more file surfaced while I rebuilt the record. It was sealed before launch.", 6000),
  ai("It is addressed to you, under a name that is not on the crew manifest.", 1200, 1600),
  me("…That's not possible.", 1400),
  ai("Decryption has started. It will take time.", 1300, 2600),
];
export const PART_TWO_CARD = { kicker: "END OF PART I · THE LAST HOME", title: "PART II", line: "WHO WERE YOU BEFORE THE MISSION?" };
