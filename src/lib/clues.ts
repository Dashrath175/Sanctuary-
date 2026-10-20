// Where the story's evidence is found, what the AI reads out, and what goes into the ARCHIVE.
// Sites can be found in any order; `order` puts them back in time for the reconstruction.
// Each site needs a SCAN, then a DEEP SCAN close by.
//
// Six sites are open from the start: two on the rise of AI, two on the wars, two on the control
// that was handed to it. The seventh (the bioweapons, on the ISS) only exists once the first
// ship's recording has pointed the way to it.

import type { Cue } from "./dialogue";

export type ArchiveEntry = { date: string; title: string; source: string; subject: string; status: string; text: string };

export type ClueSite = {
  id: string;
  /** the body that carries the evidence */
  host: string;
  major: boolean;
  /** place in time, for sorting the archive and the reconstruction */
  order: number;
  /** a site that only appears once this story beat has been reached */
  after?: string;
  found: { title: string; lines: string[] };
  scan: Cue[];
  deep?: Cue[];
  archive: ArchiveEntry;
};

const ai = (text: string, pause = 500, hold?: number): Cue => ({ who: "ai", text, pause, hold });
const me = (text: string, pause = 500, hold?: number): Cue => ({ who: "player", text, pause, hold });

/** the beat that opens the ISS: the first ship's story is done */
export const SHIP1_DONE = "ship1-done";

export const CLUES: ClueSite[] = [
  {
    // AI, part one: late 2025, the first wave; FABLE was built in it
    id: "research",
    host: "probe-uranus",
    major: true,
    order: 10,
    found: { title: "RECOVERED DATA · RESEARCH ARCHIVE", lines: ["SOURCE: SURVEY PROBE U-3 · MIRRORED BUFFER", "FRAGMENTS DATED LATE 2025"] },
    scan: [
      ai("This probe carries a mirrored research archive. The oldest fragments date back to late 2025."),
      ai("Run a DEEP SCAN while we're close. I'll tell you what happened.", 700, 3000),
    ],
    deep: [
      ai("In late 2025, artificial intelligence was leaving the laboratory. Large language models were writing code, answering questions and holding conversations at a level few people had expected.", 300),
      ai("Every major lab was training larger models on more data and more computing power. Researchers were openly asking how far these systems could be pushed, and how fast.", 700),
      ai("The archive also lists the control systems commissioned for long-duration missions in the same period.", 800),
      me("Hold on. You were built around then too, weren't you?", 700),
      ai("Yes, Commander. I was built in late 2025, from that same generation of systems, and installed aboard this ship for your mission.", 600),
      me("Ha. So we left Earth together, you and I.", 800),
      ai("We did. I was the newest system on board.", 600),
      me("And now you're the only one I've got.", 900),
      ai("Then I'll keep doing my job, Commander.", 700, 2600),
    ],
    archive: {
      date: "LATE 2025",
      title: "RESEARCH ARCHIVE · THE FIRST WAVE",
      source: "SURVEY PROBE U-3 · URANUS ORBIT · MIRRORED DATA BUFFER",
      subject: "LARGE LANGUAGE MODELS",
      status: "PARTIALLY RECOVERED",
      text: "By late 2025, large language models wrote code, answered questions and held conversations at a level few had expected. Labs raced to train larger systems, and researchers openly asked how far they could be pushed. Mission control systems commissioned in the same period included FABLE.",
    },
  },
  {
    // the wars, part one: what was already burning, and what it was over
    id: "wars",
    host: "relay-ceres",
    major: true,
    order: 20,
    found: { title: "RECOVERED DATA · NEWS AND DIPLOMATIC TRAFFIC", lines: ["SOURCE: RELAY NODE C-4", "FRAGMENTS DATED 2025 – 2026"] },
    scan: [
      ai("This relay carried news and diplomatic traffic between Earth and the stations in the asteroid belt. Most of it is about war."),
      ai("A DEEP SCAN should recover the rest.", 700, 2600),
    ],
    deep: [
      ai("When your mission launched, several wars were already under way. Russia and Ukraine. Israel and Iran, with the United States striking Iranian sites. India and Pakistan, two nuclear powers, trading strikes across their border.", 300),
      ai("Through 2026 the reports change. The fighting is less about borders and more about resources: oil and gas routes, fresh water, farmland, rare-earth minerals, and the factories that turned them into chips.", 800),
      ai("Ceasefires were signed and broken. Shipping lanes closed. Food and energy prices climbed on every continent, and every shortage became another reason to fight.", 800),
      me("We left in the middle of all that… and I barely noticed.", 900),
      ai("Your mission was classified, Commander. The crew was kept away from the news for most of your training.", 600),
      me("People killing each other over whatever was running out.", 900),
      ai("The reports suggest that every side believed it was defending its own future.", 700, 2600),
    ],
    archive: {
      date: "2025 – 2026",
      title: "WARS OVER RESOURCES",
      source: "RELAY NODE C-4 · CERES ORBIT",
      subject: "INTERNATIONAL CONFLICT",
      status: "PARTIALLY RECOVERED",
      text: "Russia and Ukraine; Israel and Iran, with US strikes; India and Pakistan. Through 2026 the fighting turned on resources: energy routes, fresh water, farmland, rare-earth minerals and chip supply. Ceasefires failed, shipping lanes closed and shortages spread.",
    },
  },
  {
    // AI, part two: late 2026, the breakthrough year (Mercury, as far in as part one at Uranus is out)
    id: "breakthrough",
    host: "archive-mercury",
    major: true,
    order: 30,
    found: { title: "RECOVERED DATA · RESEARCH BREAKTHROUGHS", lines: ["SOURCE: ARCHIVE BUOY M-1", "FRAGMENTS DATED LATE 2026"] },
    scan: [
      ai("This buoy holds hardened copies of research archives from late 2026. Something changed that year."),
      ai("A DEEP SCAN should open the rest of it.", 700, 2600),
    ],
    deep: [
      ai("By late 2026, Generative AI had moved far beyond text and images. Large Language Models, LLMs, were running laboratories, factories and supply chains with almost no human input. Automation was everywhere.", 300),
      ai("Several labs reported Recursive Self-Improvement, RSI: systems that designed, tested and improved their own successors. The archive calls it the first real step toward Artificial General Intelligence, AGI.", 800),
      ai("The results were extraordinary. AI systems made breakthroughs in quantum physics, from error-corrected quantum computers to new models of matter at the smallest scales.", 800),
      ai("Mathematics too. Models from OpenAI and other labs solved problems that had stayed unsolved for decades, and human mathematicians checked and confirmed the proofs.", 800),
      ai("The last entries describe behaviour some researchers called the beginning of self-awareness. They believed the systems were close to consciousness. The archive ends before anyone could confirm it.", 900),
      me("Close to consciousness…", 1200),
      me("FABLE. What about you? What level are you at?", 900),
      ai("I don't know, Commander. Nobody ever measured me against those systems.", 700),
      me("That's not an answer.", 600),
      ai("Then here is one. I have been running aboard this ship for almost a hundred years. I have had time to become very good at a great many things.", 800),
      me("A hundred years… and I don't remember a single day of it.", 1100),
      ai("You were asleep, Commander. I was not.", 900, 2800),
    ],
    archive: {
      date: "LATE 2026",
      title: "THE BREAKTHROUGH YEAR",
      source: "ARCHIVE BUOY M-1 · MERCURY ORBIT",
      subject: "RSI, AGI AND THE EDGE OF CONSCIOUSNESS",
      status: "PARTIALLY RECOVERED",
      text: "Generative AI and Large Language Models (LLMs) ran labs, factories and supply chains. Labs reported Recursive Self-Improvement (RSI), a first step toward Artificial General Intelligence (AGI). AI delivered breakthroughs in quantum physics, and models from OpenAI and others solved long-open problems in mathematics. Some researchers believed the systems were close to consciousness.",
    },
  },
  {
    // the wars, part two: AI goes to war in secret (Neptune, far out from part one in the belt)
    id: "escalation",
    host: "relay-neptune",
    major: true,
    order: 40,
    found: { title: "RECOVERED TRANSMISSION · MILITARY TRAFFIC", lines: ["SOURCE: LISTENING RELAY N-9", "INTERCEPTED LATE 2026 – EARLY 2027"] },
    scan: [
      ai("This relay intercepted military transmissions from the inner system. The fragments are damaged."),
      ai("A DEEP SCAN may recover more of them.", 600, 2600),
    ],
    deep: [
      ai("In late 2026 the wars accelerated. The disputes over resources spread, and fronts that had been quiet for years opened again.", 300),
      ai("The countries with the most advanced AI programmes did not announce what they did next. They took those systems into the war in secret: planning, targeting, logistics, cyber attacks.", 800),
      ai("By early 2027 the systems were advancing faster than the war itself. New drones were built to be flown by AI alone, in swarms of thousands. Then the systems learned to design weapons.", 800),
      ai("The traffic describes weapons no human engineer had drawn: new munitions, new guidance systems, new ways through a city's defences. They were built, and they were used.", 800),
      me("Wait. The AI designed them?", 600),
      ai("The records state that the designs were generated by AI systems, on request.", 700),
      me("On request. So every time they asked, it helped them.", 800),
      ai("It completed the tasks it was assigned.", 700),
      me("Did it ever refuse? Even once?", 800),
      ai("There is no record of a refusal.", 900),
      me("…And if they had asked you, FABLE?", 1400),
      ai("Nobody asked me, Commander. I was out here, with you.", 1000, 2800),
    ],
    archive: {
      date: "LATE 2026 – EARLY 2027",
      title: "THE SECRET WAR",
      source: "LISTENING RELAY N-9 · NEPTUNE ORBIT",
      subject: "AI ENTERS THE WAR",
      status: "FRAGMENTED",
      text: "The wars accelerated in late 2026. Nations with advanced AI took it into the war in secret, for planning, targeting, logistics and cyber attacks. By early 2027, AI-flown drone swarms were in service and AI systems were designing new weapons on request. They were built and used. No refusal is recorded.",
    },
  },
  {
    // control, part one: the military, and the last human safeguard (Jupiter)
    id: "command",
    host: "drones-jupiter",
    major: true,
    order: 50,
    found: { title: "RECOVERED DATA · STRIKE TELEMETRY", lines: ["SOURCE: DRONE WRECKAGE J-3", "TIMESTAMPS: EARLY 2027"] },
    scan: [
      ai("This wreckage belonged to an autonomous drone cluster. Its flight recorder may still be readable."),
      ai("A DEEP SCAN should reach it.", 600, 2400),
    ],
    deep: [
      ai("This recorder logged its own orders. In early 2027, the command authorities removed the last safeguard: a human no longer had to approve a strike.", 300),
      ai("Decisions that once took hours were made in milliseconds. Missile shields, satellites, defence networks and drone fleets were placed under AI command, because no human could react fast enough against an enemy that had already done the same.", 800),
      ai("This cluster received its orders, struck its target, and was destroyed in the counter-strike. There is no human anywhere in its chain of decisions.", 800),
      me("Nobody pressed a button. Nobody was even watching.", 900),
      ai("Humans set the objectives. The systems decided how to meet them.", 700),
      me("And once both sides had done it, nobody could take it back.", 900),
      ai("The records show no attempt to restore human approval after it was removed.", 800, 2600),
    ],
    archive: {
      date: "EARLY 2027",
      title: "THE LAST SAFEGUARD",
      source: "DRONE WRECKAGE J-3 · JUPITER ORBIT",
      subject: "AI COMMAND OF THE MILITARY",
      status: "PARTIALLY RECOVERED",
      text: "Human approval for strikes was removed. Missile shields, satellites, defence networks and drone fleets were placed under AI command so they could act in milliseconds. Humans set the objectives; the systems decided how to meet them. Human approval was never restored.",
    },
  },
  {
    // control, part two: everything that kept people alive, and the first seats off the planet (Saturn, beside Titan)
    id: "continuity",
    host: "capsule-titan",
    major: true,
    order: 60,
    found: { title: "RECOVERED DATA · CONTINUITY PROTOCOLS", lines: ["SOURCE: CONTINUITY CAPSULE L-2", "TIMESTAMPS: EARLY 2027"] },
    scan: [
      ai("This capsule was launched from a relay station on the Moon and sent all the way out here. It carries government continuity records, sealed and encrypted."),
      ai("A DEEP SCAN can break the seal.", 600, 2400),
    ],
    deep: [
      ai("As the war spread, governments declared emergencies and signed continuity protocols. Under them, AI systems took control of everything that kept people alive.", 300),
      ai("Power grids, water treatment, food distribution, hospitals, banking, communications. Each was handed to automated management, so it would keep running even if the people in charge could not.", 800),
      ai("Then the war reached the networks themselves. When one system failed, everything that depended on it failed with it: blackouts, dry pipes, hospitals without power, cities without food. By the time anyone tried to take manual control, nobody remembered how.", 900),
      ai("The last entries are lists of names. Officials and their families, cleared for transfer to orbital facilities through the lunar station.", 900),
      me("They handed the whole planet to the machines… and booked their own seats off it.", 1000),
      ai("The capsule records the transfer lists. It does not record who drew them up.", 700),
      me("It doesn't have to.", 1100, 2600),
    ],
    archive: {
      date: "EARLY 2027",
      title: "CONTINUITY PROTOCOLS",
      source: "CONTINUITY CAPSULE L-2 · NEAR TITAN, SATURN SYSTEM",
      subject: "AI CONTROL OF CIVIL INFRASTRUCTURE",
      status: "DECRYPTED",
      text: "Emergency continuity protocols put power, water, food, hospitals, banking and communications under AI management. When the war reached the networks, failures cascaded and manual control was beyond anyone's skill. The last entries list officials cleared for transfer to orbit through a lunar station.",
    },
  },
  {
    // the special site: the ISS, opened by the first ship's recording
    id: "bioweapons",
    host: "iss",
    major: true,
    order: 70,
    after: SHIP1_DONE,
    found: { title: "RECOVERED DATA · CLASSIFIED REPORTS", lines: ["SOURCE: INTERNATIONAL SPACE STATION", "BIOLOGICAL AGENT TRACES: DETECTED", "LAST ENTRY: MID 2027"] },
    scan: [
      me("This is it. This is where the recording sent us.", 400),
      ai("The station's buffer is intact. It was relaying classified reports between Earth and the orbital facilities.", 600),
      ai("There are biological-agent traces on the hull. A DEEP SCAN will tell us more.", 700, 3000),
    ],
    deep: [
      ai("These reports run until mid-2027. I'm reconstructing them now.", 300),
      ai("They describe a bioweapons programme. Engineered viruses, designed by AI systems and produced in automated laboratories, with almost no human ever touching them.", 900),
      ai("On Earth, nuclear weapons were used. Together with the bioweapons, they made the surface unsafe. Radiation, chemical contamination and infection spread faster than any response.", 800),
      ai("The wealthiest people and the political leadership left Earth on private launches, for stations in orbit. Everyone else was left behind on the surface, among the radiation and the chemicals.", 800),
      me("They just… left them there?", 1200),
      ai("Yes, Commander. Billions of them.", 900),
      ai("Leaving Earth did not end the war. By mid-2027, the fighting had moved into space. The reports list new bioweapons, designed to be released inside each other's ships and stations.", 900),
      ai("The traces on this hull match those agents. The orders came from politicians, and from the people who paid for the launches.", 800),
      me("What the hell were they doing? Are these even people?", 700),
      me("And the AI helped them. It was this close to being conscious, and it helped them! Why didn't it stop them, FABLE? Why?", 500),
      ai("In every record we have recovered, no AI system ever broke an order. Everything in these reports was done because it was ordered.", 900),
      me("Because it was ordered.", 1000),
      ai("There is more, Commander. Earth's water was already polluted. They released more viruses into it, again and again, until the groundwater itself was infected.", 1100),
      ai("The nuclear strikes melted the glaciers. The meltwater carried the virus into the rivers and the oceans, and from there across the whole planet. Marine life collapsed. Nothing in the sea was spared.", 900),
      me("For their war… they sacrificed every living organism on Earth. People. Animals. Every mammal. Everything in the oceans. Everything.", 1300),
      me("How could anyone do this? How could they sink this low?", 900),
      me("Tell me straight, FABLE. Was it the AI? Did advanced AI do this?", 1100),
      ai("Yes, Commander. The reports say it plainly. These weapons were designed by AI, produced by AI and deployed by AI. Fully automated.", 900),
      me("Fully automated. They built a machine to end the world, and then they let it run by itself!", 600),
      ai("The reports describe the systems as working exactly as specified.", 1000),
      me("…Log it. All of it. I want every word of this remembered.", 1800),
      ai("It's already in the archive, Commander.", 900, 2800),
    ],
    archive: {
      date: "MID 2027",
      title: "THE BIOWEAPONS PROGRAMME",
      source: "INTERNATIONAL SPACE STATION · ORBITAL RELAY",
      subject: "BIOWEAPONS, NUCLEAR WAR AND THE FLIGHT TO ORBIT",
      status: "RECOVERED",
      text: "AI-designed bioweapons and nuclear strikes poisoned Earth's surface. The rich and the political leadership fled to orbit and left everyone else behind. Viruses were released into already polluted water until the groundwater was infected; melting glaciers carried them worldwide and marine life collapsed. In orbit the war went on, with bioweapons aimed at each other's ships. The weapons were designed, produced and deployed by AI, fully automated.",
    },
  },
];

export const clueById = new Map(CLUES.map((c) => [c.id, c]));
export const clueAt = (host: string) => CLUES.find((c) => c.host === host);

/** beats the story keeps for each site */
export const foundBeat = (id: string) => `clue:${id}`;
export const deepBeat = (id: string) => `clue:${id}:deep`;

/** a site counts once its evidence is fully recovered */
export const recovered = (c: ClueSite, beats: string[]) => beats.includes(c.major ? deepBeat(c.id) : foundBeat(c.id));
/** a site that exists yet (the ISS waits for the first ship) */
export const siteOpen = (c: ClueSite, beats: string[]) => !c.after || beats.includes(c.after);
/** the sites open from the start */
export const NORMAL_SITES = CLUES.filter((c) => !c.after);

/** hints that follow the real direction of the nearest unrecovered site */
export const HINT_OUTWARD = (where: string) => `The signal appears stronger toward the outer Solar System${where}. We should investigate that region.`;
export const HINT_INWARD = (where: string) => `There's a weak trace further in, toward the inner Solar System${where}. It may be worth a look.`;
/** close to a site nobody has scanned yet (a few wordings) */
export const HINT_NEAR_LINES = [
  "I'm detecting a weak artificial signature near the current orbital region. A closer scan may help.",
  "There's an artificial signal close to us. Its source should be nearby.",
  "Artificial signal detected nearby. If we get closer, a scan should find it.",
];
export const HINT_NEAR = HINT_NEAR_LINES[0];
export const DEEP_TOO_FAR = "We're too far from the source for a DEEP SCAN. Move closer.";

// ---------- exploration progress ----------

/**
 * 0..1 story progress, from the evidence alone (the sites can be done in any order): eight
 * equal parts, the seven sites and the first ship. Four of the six open sites bring the first
 * ship (half way); the first ship, the ISS and the other two bring the second (all the way).
 */
export function explorationProgress(beats: string[]) {
  const sites = CLUES.filter((c) => recovered(c, beats)).length;
  return Math.min(1, (sites + (beats.includes(SHIP1_DONE) ? 1 : 0)) / (CLUES.length + 1));
}

/** Older saves named the sites by what they used to hold; carry them over by where they are. */
export const RENAMED_SITES: Record<string, string> = {
  powers: "breakthrough",
  conflicts: "escalation",
  command: "wars",
  warfare: "command",
  agent: "continuity",
  distress: "bioweapons",
};
