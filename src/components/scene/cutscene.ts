// Cutscenes: the view leaves the cockpit and films our own ship. A cutscene is a few shots;
// each one moves the camera from one point to another (eased) while it looks at the ship, a
// body, or a point between the two. Points are given in metres in the ship's frame: x toward
// the sunlit side (so the hull we film is lit), y up, z along the ship's nose. Between shots the
// screen dips to black, and the last shot of the ending holds until the player moves on.
//
// A shot can also film a body anywhere in the Solar System instead of our ship (`orbit`): the
// camera circles it on its sunlit side, so the montage at the end can go back over the worlds and
// every place the record was found.

import { BODIES } from "@/lib/solar";

/** metres in the ship's frame: [toward the sunlit side, up, ahead] */
export type ShipPoint = [number, number, number];

/** what a shot looks at: a point on or near our ship, a body by id, or `{ between }` the ship
 * and a body (0 = our ship, 1 = the body; "" means the cutscene's target) */
export type Look = ShipPoint | string | { between: string; k: number };

/** around a body: [distance in body sizes, degrees round from the sunward side, degrees up] */
export type OrbitPoint = [number, number, number];

export type Shot = {
  /** seconds */
  dur: number;
  from: ShipPoint;
  to: ShipPoint;
  look: Look;
  /** where the look ends up by the end of the shot (defaults to `look`) */
  lookTo?: Look;
  /** stay on the last frame until the cutscene is ended from outside */
  hold?: boolean;
  /** move our ship (and so the cockpit) when the shot starts: "dayside" is high above Earth's
   * sunlit side, home at last */
  at?: "dayside";
  /** field of view, degrees, from the start of the shot to its end (a slow push or pull) */
  fov?: [number, number];
  /** the horizon's tilt, degrees, from start to end */
  roll?: [number, number];
  /** a hand-held drift, degrees: the camera breathes a little instead of gliding on rails */
  drift?: number;
  /** film this body instead of our ship: the camera moves round it, looking at it */
  orbit?: { body: string; from: OrbitPoint; to: OrbitPoint };
  /** fly from a point round one body to a point round another (closing in steadily on the second,
   * turning to it early), looking from the first to the second; it starts from wherever the camera
   * is when the shot begins */
  transfer?: { from: { body: string; at: OrbitPoint }; to: { body: string; at: OrbitPoint } };
  /** no dip to black into this shot: it carries straight on from the one before */
  seamless?: boolean;
};

/**
 * - opening: adrift near Uranus before the commander wakes (the ship faces Uranus)
 * - mission: a major mission (Earth, either story ship): the camera stays outside on our ship and
 *   what we came to, moving all the time, until the story ends it (the ship faces the target)
 * - showcase: a look at a world the dialogue is talking about (Pluto, when the signal comes from
 *   its orbit): in close on its sunlit side, then slowly round it, held until the story cuts back
 * - montage: the end, back over the worlds and the places the record was found
 * - ending: in Earth orbit at the end, pulling away until the ship is a speck against Earth
 */
export type CutName = "opening" | "mission" | "showcase" | "montage" | "ending";

/** the cockpit sits a little behind the middle of the hull, just above it */
const COCKPIT: ShipPoint = [0, 0.9, -4.5];
const HULL: ShipPoint = [0, 0, 0];
const NONE: ShipPoint = [0, 0, 0];

export type CutOptions = {
  /** how far the mission's target is (metres) */
  sep?: number;
  /** the mission's target is a world (Earth), not a ship */
  world?: boolean;
  /** the target ship's length, metres (close shots keep clear of it) */
  span?: number;
  /** the world a showcase looks at */
  body?: string;
  /** a showcase that flies on from the world to this vehicle near it, without a cut */
  then?: string;
  /** how many shots the montage has (one per line said over it) */
  count?: number;
  /** how long the montage should run (ms) */
  ms?: number;
  /** the montage's stops in order: every place the record was found, and the ships */
  stops?: string[];
};

/** The shots of one cutscene. */
export function cutShots(name: CutName, o: CutOptions = {}): Shot[] {
  const sep = o.sep ?? 0;
  switch (name) {
    case "opening":
      // Uranus fills the sky and our ship is a sliver against it; then low along its sunlit flank as
      // it drifts past; then along the spine to the cockpit window, where the commander is waking
      return [
        { dur: 6, from: [70, 26, -190], to: [44, 16, -120], look: [0, 2, 10], fov: [34, 30], roll: [5, 2], drift: 0.25 },
        { dur: 4.5, from: [30, -3.5, 34], to: [22, -2, -8], look: [0, 0.5, 0], fov: [44, 38], roll: [-6, -2], drift: 0.35 },
        { dur: 5, from: [15, 5, -16], to: [7.5, 3.2, 3], look: [0, 0.6, -10], lookTo: COCKPIT, fov: [44, 34], drift: 0.2 },
      ];
    case "mission":
      return shuffle(o.world ? missionAtWorld() : missionAtShip(Math.max(sep, 150), o.span ?? 40));
    case "showcase":
      return o.body ? showcase(o.body, o.then) : [];
    case "montage":
      return montage(o.stops ?? [], o.count ?? 10);
    case "ending":
      // above Earth's day side: close and slow round the ship with Earth beyond it, then a long
      // pull away until it is a speck against home; hold
      return [
        { dur: 10, from: [30, 6, -70], to: [14, 4, -50], look: HULL, at: "dayside", fov: [36, 30], roll: [3, -1], drift: 0.2 },
        { dur: 18, from: [12, 8, -62], to: [70, 140, -950], look: HULL, hold: true, fov: [34, 40], drift: 0.15 },
      ];
  }
}

/**
 * A world the dialogue is about, whole in the frame and lit: in from its sunlit quarter, then
 * slowly round toward the Sun-facing side (never onto its night side), held until the story
 * cuts back to the cockpit. With `then`, the first shot holds instead until the story moves it
 * on, and the camera flies from the world to that vehicle without a cut and circles it slowly.
 */
function showcase(body: string, then?: string): Shot[] {
  const side = Math.random() < 0.5 ? -1 : 1;
  const tilt = rnd(1.5, 3) * side;
  const into: Shot = { dur: 6.5, from: NONE, to: NONE, look: body, orbit: { body, from: [6.2, 40 * side, 12], to: [4.6, 30 * side, 8] }, fov: [34, 30], roll: [tilt, tilt * 0.5], drift: 0.2 };
  if (!then)
    return [into, { dur: 16, from: NONE, to: NONE, look: body, orbit: { body, from: [4.6, 30 * side, 8], to: [4.4, -10 * side, 14] }, fov: [30, 29], roll: [tilt * 0.5, 0], drift: 0.2, hold: true, seamless: true }];
  const near: OrbitPoint = [5.2, 35 * side, 10];
  return [
    // a long, slow move in, still going when the story sends the camera on
    { ...into, dur: 15, hold: true },
    { dur: 4.2, from: NONE, to: NONE, look: body, lookTo: then, transfer: { from: { body, at: [4.6, 30 * side, 8] }, to: { body: then, at: near } }, fov: [30, 38], roll: [tilt * 0.5, 0], drift: 0.1, seamless: true },
    { dur: 16, from: NONE, to: NONE, look: then, orbit: { body: then, from: near, to: [4.6, 5 * side, 6] }, fov: [38, 36], roll: [0, -tilt * 0.5], drift: 0.25, hold: true, seamless: true },
  ];
}

/** the target of a mission: "" is the cutscene's target */
const THEM = (k: number): Look => ({ between: "", k });
const missionLen = () => rnd(7.5, 10);

/**
 * At a world (Earth, far ahead of the nose): our ship in the foreground with the world beyond
 * it in every shot but one, from over the shoulder, three-quarter, below, round the stern, far
 * behind on a long lens, and high behind.
 */
function missionAtWorld(): Shot[] {
  return [
    { dur: missionLen(), from: [14, 8, -62], to: [8, 5.5, -44], look: THEM(1), fov: [40, 30], drift: 0.25 },
    { dur: missionLen(), from: [44, 6, -58], to: [34, 11, -30], look: [0, 0, 40], lookTo: [0, 0, 24], fov: [46, 42], roll: [-3, 2], drift: 0.25 },
    { dur: missionLen(), from: [10, -16, -48], to: [6, -10, -30], look: [0, 2, 60], fov: [44, 38], roll: [4, 1], drift: 0.3 },
    { dur: missionLen(), from: [46, 12, 10], to: [16, 8, -50], look: [0, 0, 14], fov: [46, 40], drift: 0.2 },
    { dur: missionLen(), from: [4, 2.5, -170], to: [3, 2, -120], look: THEM(1), fov: [28, 24], drift: 0.15 },
    { dur: missionLen(), from: [12, 40, -90], to: [8, 30, -110], look: [0, 0, 90], fov: [42, 38], roll: [2, -1], drift: 0.2 },
  ];
}

/**
 * Beside another ship `d` metres ahead and `span` metres long: theirs close on its own, a two-shot
 * from behind ours, over our shoulder, slowly round theirs, both side on, from below between
 * them, a pan from our hull across to theirs, and high behind both. Shots of theirs alone stay at
 * least a ship's length and a half from it; shots of the pair stand back far enough (by the gap
 * and by the size of theirs) that both fit, however big theirs is.
 */
function missionAtShip(d: number, span: number): Shot[] {
  const r = Math.max(d * 0.45, span * 1.7);
  const w = Math.max(d * 1.5, span * 2.6);
  /** a point `r`-scaled around theirs (which sits `d` ahead of us) */
  const T = (x: number, y: number, z: number): ShipPoint => [x * r, y * r, d + z * r];
  /** a point `w`-scaled around the middle of the pair */
  const M = (x: number, y: number, z: number): ShipPoint => [x * w, y * w, d / 2 + z * w];
  return [
    { dur: missionLen(), from: T(0.6, 0.24, -0.76), to: T(0.45, 0.12, -0.6), look: THEM(1), fov: [38, 30], roll: [4, 0], drift: 0.3 },
    { dur: missionLen(), from: M(0.5, 0.14, -0.85), to: M(0.42, 0.12, -0.7), look: THEM(0.4), fov: [44, 40], drift: 0.2 },
    { dur: missionLen(), from: [13, 7, -58], to: [8, 5, -40], look: THEM(1), fov: [40, 32], roll: [-2, 0], drift: 0.25 },
    { dur: missionLen(), from: T(0.95, 0.2, -0.3), to: T(0.6, 0.4, 0.7), look: THEM(1), fov: [40, 36], drift: 0.25 },
    { dur: missionLen(), from: M(0.97, 0.2, -0.15), to: M(0.95, 0.24, 0.2), look: THEM(0.5), fov: [44, 40], drift: 0.2 },
    { dur: missionLen(), from: T(0.3, -0.45, -1.4), to: T(0.2, -0.35, -1.05), look: THEM(1), fov: [44, 38], roll: [5, 2], drift: 0.3 },
    { dur: missionLen(), from: [26, 10, -36], to: [18, 6, -24], look: [0, 0, 8], lookTo: THEM(0.6), fov: [44, 40], drift: 0.2 },
    { dur: missionLen(), from: M(0.3, 0.85, -0.55), to: M(0.25, 0.8, -0.2), look: THEM(0.5), fov: [46, 42], drift: 0.2 },
  ];
}

const PLANETS = ["mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune"];
/** moons worth a look, per planet (one or two are picked at random) */
const MOONS: Record<string, string[]> = {
  earth: ["moon"],
  mars: ["phobos", "deimos"],
  jupiter: ["io", "europa", "ganymede", "callisto"],
  saturn: ["titan", "enceladus", "rhea", "mimas"],
  uranus: ["titania", "miranda", "ariel"],
  neptune: ["triton"],
};
const known = new Set(BODIES.map((b) => b.id));
const shuffle = <T,>(a: T[]) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

type Move = "round" | "push" | "pull" | "crane" | "drift" | "reveal";
const MOVES: Move[] = ["round", "push", "pull", "crane", "drift", "reveal"];

/**
 * One shot of a body, on its lit side, by one of a few camera moves (a slow circle round it, a
 * push in, a pull back, a crane up past it, a sideways drift on a long lens, a swing out from
 * behind its limb). The move runs long and the shot holds: the dialogue decides when it cuts.
 */
function bodyShot(body: string, move: Move, kind: "sun" | "world" | "craft"): Shot {
  const d = kind === "sun" ? rnd(4.6, 5.8) : kind === "craft" ? rnd(4.2, 5.6) : rnd(2.4, 3.2);
  const side = Math.random() < 0.5 ? -1 : 1;
  const az = rnd(25, 60) * side;
  const el = rnd(4, 16) * (Math.random() < 0.3 ? -1 : 1);
  const tilt = rnd(1.5, 4) * (Math.random() < 0.5 ? -1 : 1);
  const lens: [number, number] = kind === "craft" ? [40, 36] : [36, 32];
  const at = (from: [number, number, number], to: [number, number, number], fov = lens): Shot => ({
    dur: 16,
    from: NONE,
    to: NONE,
    look: body,
    orbit: { body, from, to },
    fov,
    roll: [tilt, tilt * 0.4],
    drift: 0.22,
    hold: true,
  });
  switch (move) {
    case "round":
      return at([d, az, el], [d, az + rnd(45, 70) * side, el + rnd(-4, 4)]);
    case "push":
      return at([d * 1.55, az, el], [d * 0.9, az + rnd(6, 12) * side, el]);
    case "pull":
      return at([d * 0.85, az, el], [d * 1.6, az + rnd(6, 12) * side, el + rnd(2, 6)]);
    case "crane":
      return at([d, az, -rnd(10, 18)], [d * 1.05, az + rnd(8, 16) * side, rnd(16, 26)]);
    case "drift":
      return at([d * 1.25, az, el], [d * 1.25, az + rnd(14, 22) * side, el], [lens[0] - 4, lens[1] - 10]);
    case "reveal":
      return at([d, 92 * side, el], [d * 0.95, rnd(20, 35) * side, el + rnd(-3, 3)]);
  }
}

/**
 * The end, one shot for each line said over it: the Sun first (its surface as a scan reads it,
 * from a distance), then the places the record was found, the ships and the worlds and their
 * moons in no set order (not all of them), and Earth last, held.
 */
function montage(stops: string[], count: number): Shot[] {
  const places = stops.filter((id) => known.has(id));
  const worlds: string[] = [];
  for (const p of PLANETS) worlds.push(p, ...shuffle((MOONS[p] ?? []).filter((m) => known.has(m))).slice(0, 1));
  if (known.has("moon")) worlds.push("moon");
  const middle = Math.max(0, count - 2);
  // about half places, half worlds, then mixed at random
  const pickPlaces = shuffle([...places]).slice(0, Math.min(places.length, Math.ceil(middle / 2)));
  const pool = shuffle([...pickPlaces, ...shuffle(worlds).slice(0, middle - pickPlaces.length)]);
  const kindOf = (id: string) => (BODIES.find((b) => b.id === id && (b.kind === "planet" || b.kind === "moon" || b.kind === "dwarf")) ? "world" : "craft");
  let last: Move | null = null;
  const move = () => {
    const m = shuffle(MOVES.filter((x) => x !== last))[0];
    last = m;
    return m;
  };
  const shots = [bodyShot("sun", move(), "sun"), ...pool.map((id) => bodyShot(id, move(), kindOf(id)))];
  shots.push(bodyShot("earth", "pull", "world"));
  return shots.slice(0, Math.max(1, count));
}

/** Ease in and out. */
export const easeCut = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
