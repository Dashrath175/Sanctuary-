// The real solar system: names, sizes and facts are public astronomy data; every line of
// descriptive copy is written for this project.
//
// Positions start from JPL Horizons (DE441) state vectors for 2026-10-14 00:00 UTC
// (ICRF, Sun-centred, km and km/s) and are carried forward with two-body Kepler motion,
// which keeps planets, moons and spacecraft where they really are for months either side.

export type Kind = "star" | "planet" | "moon" | "dwarf" | "asteroid" | "spacecraft" | "satellite";
export type Surface = "sun" | "globe" | "craft";
export type Fact = { label: string; value: string; note?: string };

export type BodyDef = {
  id: string;
  /** JPL Horizons id */
  jpl: string;
  name: string;
  /** short name for tight spaces (records grid) */
  short?: string;
  kind: Kind;
  parent?: string;
  /** mean radius */
  radiusKm: number;
  /** dark / light survey colours: the surface map is recoloured between them */
  palette: [string, string];
  surface: Surface;
  seed: number;
  /** north pole, ICRF right ascension / declination in degrees */
  pole?: [number, number];
  /** sidereal rotation in hours (negative = retrograde) */
  spinHours?: number;
  rings?: "saturn" | "uranus" | "neptune";
  /** limb haze for a thick atmosphere: strength, falloff power, veil */
  haze?: [number, number, number];
  /** triaxial radii: long equatorial, short equatorial, polar */
  axesKm?: [number, number, number];
  /** irregular small worlds */
  shape?: "lumpy" | "peanut" | "top" | "basin";
  /** records grid label, e.g. "3RD PLANET", "SATURN II", "ASTEROID (433)" */
  label: string;
  /** records subtitle */
  sub: string;
  note: string;
  facts: Fact[];
  /** where the surface map or shape comes from */
  source: string;
  spanM?: number;
  launchYear?: number;
};

export const AU_KM = 149_597_870.7;
export const EPOCH_MS = Date.UTC(2026, 9, 14, 0, 0, 0);
const OBLIQUITY = (23.4392911 * Math.PI) / 180;

/** GM in km³/s² for every body something orbits */
const GM: Record<string, number> = {
  sun: 1.32712440018e11,
  earth: 403_503.2, // Earth + Moon
  mars: 42_828.37,
  mercury: 22_031.87,
  jupiter: 126_686_534,
  saturn: 37_931_207,
  uranus: 5_793_951,
  neptune: 6_836_527,
  pluto: 975.5, // Pluto + Charon
  ceres: 62.63,
};

// JPL Horizons state vectors, 2026-10-14 00:00 UTC, ICRF, Sun centre: [position km], [velocity km/s]
const STATE: Record<string, [[number, number, number], [number, number, number]]> = {
  "10": [[0.0, 0.0, 0.0], [0, 0, 0]],
  "199": [[37394762.4, -44328345.0, -27555917.0], [29.743256, 28.467432, 12.124933]],
  "299": [[105093340.1, 26618722.9, 5329049.8], [-8.700438, 30.624408, 14.330638]],
  "399": [[139980730.9, 47497506.6, 20588797.6], [-10.825437, 25.537882, 11.070252]],
  "499": [[-7124078.8, 213852072.5, 98281121.4], [-23.300483, 0.976651, 1.07639]],
  "599": [[-533309950.7, 536513908.2, 242946285.4], [-9.844834, -7.594888, -3.015716]],
  "699": [[1382473092.6, 276026556.6, 54473267.0], [-2.420513, 8.695824, 3.696287]],
  "799": [[1329151555.3, 2376083701.8, 1021844311.6], [-6.117465, 2.525049, 1.192698]],
  "899": [[4463299769.0, 237709687.6, -13818258.5], [-0.303065, 5.049051, 2.073802]],
  "301": [[139776347.7, 47198057.5, 20420291.8], [-9.999101, 25.04795, 10.856357]],
  "401": [[-7132667.9, 213849911.1, 98284599.9], [-23.231801, -0.884191, 0.092814]],
  "402": [[-7129207.8, 213830774.3, 98272721.8], [-22.100661, 0.931639, 0.457062]],
  "501": [[-533680441.5, 536331190.2, 242853215.1], [-1.468714, -21.27403, -9.410759]],
  "502": [[-533538770.9, 537086036.0, 243209984.7], [-22.73035, -11.844153, -5.299056]],
  "503": [[-532367437.7, 536056074.7, 242741925.1], [-4.729198, 1.059348, 1.218856]],
  "504": [[-534734175.9, 537647201.8, 243459197.2], [-15.251244, -13.101559, -5.691261]],
  "601": [[1382587551.8, 275884325.4, 54478374.6], [8.767013, 17.871566, 2.239784]],
  "602": [[1382480606.8, 276263599.9, 54455184.1], [-15.009191, 9.232269, 4.739109]],
  "603": [[1382636236.3, 275781294.0, 54481530.0], [7.001826, 14.924788, 2.570809]],
  "604": [[1382723725.2, 276304755.4, 54431387.1], [-9.880909, 15.420557, 3.84338]],
  "605": [[1382991280.3, 275940476.9, 54436953.9], [-1.083869, 17.048341, 2.932534]],
  "606": [[1383324864.6, 275192775.7, 54453719.5], [1.479913, 12.819437, 3.074058]],
  "607": [[1383947417.2, 275671031.3, 54371080.1], [-0.849796, 13.362397, 3.302642]],
  "608": [[1385401734.8, 274360475.8, 53581875.9], [-0.784262, 11.595046, 3.907266]],
  "701": [[1328990586.9, 2376143141.8, 1021760695.4], [-8.841612, 1.819897, 5.93042]],
  "702": [[1329119076.4, 2376019947.0, 1022099595.2], [-1.576666, 1.423911, 1.499599]],
  "703": [[1329548081.6, 2375957636.3, 1021977008.8], [-4.806876, 3.15521, -2.144636]],
  "704": [[1329652577.9, 2376052693.7, 1021548997.1], [-7.579304, 3.565253, -1.405303]],
  "705": [[1329136023.6, 2376121783.0, 1021720987.6], [-12.460176, 4.13828, 2.493309]],
  "801": [[4463356882.1, 237597267.6, -14149899.1], [-3.963785, 2.634479, 2.261869]],
  "901": [[2991826861.0, -3871958909.5, -2109617014.5], [4.721562, 2.353437, -0.854931]],
  "999": [[2991815089.5, -3871971319.6, -2109626569.2], [4.62709, 2.294231, -0.661635]],
  "1;": [[21601154.2, 361520340.8, 166126022.5], [-18.276311, -1.697517, 2.919922]],
  "2;": [[391075557.0, 134805183.3, -55253272.2], [-9.748775, 14.685994, -2.224493]],
  "4;": [[344879602.3, 131755573.3, 7344977.1], [-4.859869, 16.374328, 7.165882]],
  "10;": [[-349392803.7, 299110587.4, 110132228.2], [-9.845809, -12.040868, -6.141979]],
  "16;": [[-346961973.0, 278686761.7, 115661010.2], [-12.340632, -10.432923, -3.595977]],
  "433;": [[11419560.3, -223469708.9, -124814547.7], [20.333219, -3.30363, 1.799137]],
  "951;": [[-381616734.2, -2725413.8, -29394241.6], [-0.64913, -15.787557, -6.501866]],
  "243;": [[-391854049.4, 150069128.4, 62868794.0], [-7.545771, -14.616244, -6.711402]],
  "101955;": [[-80867759.8, -161978880.2, -91191756.6], [20.862642, -8.045692, -4.632665]],
  "162173;": [[-7452589.5, -195424973.0, -77962131.3], [22.501654, -2.818724, 1.239889]],
  "-125544": [[139984878.5, 47496687.0, 20583473.8], [-8.78452, 32.900701, 11.52526]],
  "-61": [[-532990663.0, 537674045.7, 240999817.0], [-7.94216, -5.12828, -10.633284]],
  "-74": [[-7126424.8, 213854526.8, 98279825.7], [-22.411808, 0.104346, -2.132056]],
  "-53": [[-7122755.1, 213853231.5, 98277777.7], [-26.453743, 1.665975, 0.091383]],
  "-170": [[140898543.6, 48456631.3, 21106072.3], [-11.027564, 25.903084, 11.095119]],
  "-28": [[125488191.7, 50650188.9, 21954647.2], [-22.032877, 27.628394, 11.976206]],
  "-255": [[-43649256.7, 237565899.5, 91803990.3], [-24.396772, 2.631538, 1.435519]],
  "-203": [[21602088.2, 361516866.8, 166123478.9], [-18.279504, -1.675002, 2.869234]],
  "-234": [[-2926974.2, 132791125.0, 57270554.2], [-30.188583, -0.485459, -0.248622]],
  "-98": [[3124654263.6, -8696961157.1, -3396517105.0], [5.307348, -11.6531, -4.516573]],
  "-32": [[5972221347.0, -9141965436.3, -18603743851.4], [4.203397, -4.068038, -14.098109]],
};

const f = (label: string, value: string, note?: string): Fact => (note ? { label, value, note } : { label, value });
const km = (n: number) => `${n.toLocaleString("en-US")} KM`;
/** "257 × 251 × 248 KM" from radii, or a single radius */
const radii = (r: number, axes?: [number, number, number]) =>
  axes ? `${axes.map((a) => (a < 10 ? a.toFixed(1) : Math.round(a).toLocaleString("en-US"))).join(" × ")} KM` : km(r);
const ORDINAL = ["1ST", "2ND", "3RD", "4TH", "5TH", "6TH", "7TH", "8TH"];
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];

type PlanetData = {
  n: number;
  kind: string;
  temp: [string, string?];
  air: string;
  madeOf: string;
  gravity: string;
  day: [string, string?];
  year: string;
  moons: string;
};

const planet = (
  id: string, jpl: string, name: string, radiusKm: number, palette: [string, string], pole: [number, number], spinHours: number,
  d: PlanetData, extra: Partial<BodyDef>, note: string, source: string,
): BodyDef => ({
  id, jpl, name, kind: "planet", radiusKm, palette, surface: "globe", pole, spinHours, seed: d.n * 7 + 11,
  label: `${ORDINAL[d.n - 1]} PLANET`,
  sub: `${ORDINAL[d.n - 1]} PLANET · ${d.kind}`,
  note, source,
  facts: [
    f("KIND", d.kind),
    f("TEMPERATURE", ...d.temp),
    f("ATMOSPHERE", d.air),
    f("MADE OF", d.madeOf),
    f("RADII", radii(radiusKm, extra.axesKm), extra.axesKm ? "EQUATOR × EQUATOR × POLE" : undefined),
    f("FROM THE SUN", "LIVE"),
    f("GRAVITY", d.gravity),
    f("DAY", ...d.day),
    f("YEAR", d.year),
    f("MOONS", d.moons),
  ],
  ...extra,
});

type MoonData = {
  n: number;
  temp: [string, string?];
  air: string;
  madeOf: string;
  orbitKm: number;
  gravity: string;
  period: string;
  found: string;
};

const PARENT_NAME: Record<string, string> = { earth: "EARTH", mars: "MARS", jupiter: "JUPITER", saturn: "SATURN", uranus: "URANUS", neptune: "NEPTUNE", pluto: "PLUTO" };

const moon = (
  id: string, jpl: string, name: string, parent: string, radiusKm: number, palette: [string, string], d: MoonData,
  extra: Partial<BodyDef>, note: string, source: string,
): BodyDef => ({
  id, jpl, name, kind: "moon", parent, radiusKm, palette, surface: "globe", seed: Number(jpl) || 1,
  label: `${PARENT_NAME[parent]} ${ROMAN[d.n - 1]}`,
  sub: `${PARENT_NAME[parent]} ${ROMAN[d.n - 1]} · MOON`,
  note, source,
  facts: [
    f("KIND", `MOON OF ${PARENT_NAME[parent]}`),
    f("TEMPERATURE", ...d.temp),
    f("ATMOSPHERE", d.air),
    f("MADE OF", d.madeOf),
    f("ORBITS", `${PARENT_NAME[parent]} · ${km(d.orbitKm)}`),
    f("RADII", radii(radiusKm, extra.axesKm)),
    f("FROM THE SUN", "LIVE"),
    f("GRAVITY", d.gravity),
    f("ORBIT", d.period),
    f("DISCOVERED", d.found),
  ],
  ...extra,
});

type MinorData = {
  number: string;
  temp: [string, string?];
  madeOf: string;
  gravity: string;
  day: string;
  year: string;
  found: string;
};

const minor = (
  id: string, jpl: string, name: string, kind: "dwarf" | "asteroid", radiusKm: number, palette: [string, string], d: MinorData,
  extra: Partial<BodyDef>, note: string, source: string,
): BodyDef => ({
  id, jpl, name, kind, radiusKm, palette, surface: "globe", seed: id.length * 13 + Math.round(radiusKm),
  label: `${kind === "dwarf" ? "DWARF PLANET" : "ASTEROID"} (${d.number})`,
  sub: `${kind === "dwarf" ? "DWARF PLANET" : "ASTEROID"} (${d.number})`,
  note, source,
  facts: [
    f("KIND", kind === "dwarf" ? "DWARF PLANET" : "ASTEROID"),
    f("TEMPERATURE", ...d.temp),
    f("MADE OF", d.madeOf),
    f("RADII", radii(radiusKm, extra.axesKm)),
    f("FROM THE SUN", "LIVE"),
    f("GRAVITY", d.gravity),
    f("DAY", d.day),
    f("YEAR", d.year),
    f("DISCOVERED", d.found),
  ],
  ...extra,
});

type CraftData = {
  kind: string;
  mission: string;
  operator: string;
  launched: [string, string?];
  where: string;
  status: string;
};

const craft = (
  id: string, jpl: string, name: string, short: string, parent: string, spanM: number, launchYear: number, label: string, d: CraftData,
  note: string,
): BodyDef => ({
  id, jpl, name, short, kind: jpl === "-125544" ? "satellite" : "spacecraft", parent, radiusKm: spanM / 2000,
  palette: ["#1f4c70", "#8fdcff"], surface: "craft", seed: Math.abs(Number(jpl)), spanM, launchYear,
  label, sub: label,
  note,
  source:
    id === "juice" || id === "psyche-craft"
      ? "NO PUBLIC MODEL · SHAPE BUILT FOR THIS PROJECT FROM MISSION REFERENCES · ORIENTATION ILLUSTRATIVE · FACTS: NASA / ESA"
      : `MODEL: ${id === "new-horizons" ? "NASA VTAD" : "NASA 3D RESOURCES"} (PUBLIC DOMAIN) · ORIENTATION ILLUSTRATIVE · FACTS: NASA / ESA`,
  facts: [
    f("KIND", d.kind),
    f("MISSION", d.mission),
    f("OPERATOR", d.operator),
    f("LAUNCHED", ...d.launched),
    f("WHERE", d.where),
    f("STATUS", d.status),
    f("SPAN", `${spanM < 10 ? spanM.toFixed(1) : Math.round(spanM)} M`),
  ],
});

type RelicData = { kind: string; purpose: string; where: string; built: string };

/** Relics: artificial objects left from the 2020s (fictional, built for the story). */
const relic = (
  id: string, jpl: string, name: string, kind: "spacecraft" | "satellite", parent: string, spanM: number, label: string, d: RelicData, note: string,
): BodyDef => ({
  id, jpl, name, short: name.toUpperCase(), kind, parent, radiusKm: spanM / 2000,
  palette: ["#1f4c70", "#8fdcff"], surface: "craft", seed: id.length * 977 + Math.round(spanM * 13), spanM,
  label, sub: label, note,
  source: "FICTIONAL OBJECT · SHAPE BUILT FOR THIS PROJECT",
  facts: [
    f("KIND", d.kind),
    f("PURPOSE", d.purpose),
    f("OPERATOR", "UNKNOWN"),
    f("BUILT", d.built),
    f("WHERE", d.where),
    f("STATUS", "INACTIVE · DAMAGED"),
    f("SPAN", `${Math.round(spanM)} M`),
  ],
});

const MAP_NASA3D = "NASA 3D RESOURCES";
const PROCEDURAL_NOTE = "PROCEDURAL STAND-IN · NO GLOBAL MAP EXISTS YET";

export const BODIES: BodyDef[] = [
  {
    id: "sun", jpl: "10", name: "Sun", kind: "star", radiusKm: 695_700, palette: ["#ffd685", "#fff7cc"], surface: "sun",
    pole: [286.13, 63.87], spinHours: 609.12, seed: 1, label: "G2V STAR", sub: "G2V STAR · THE SOLAR SYSTEM'S STAR",
    note: "A middle-aged yellow dwarf holding 99.8% of the system's mass; its light takes eight minutes to reach Earth.",
    source: "DISC RENDERED IN THE SHADER · FACTS: NASA SUN FACT SHEET",
    facts: [
      f("KIND", "G2V MAIN-SEQUENCE STAR"),
      f("TEMPERATURE", "5,500 °C", "VISIBLE SURFACE"),
      f("MADE OF", "HYDROGEN 73% · HELIUM 25%"),
      f("RADIUS", km(695_700)),
      f("GRAVITY", "274 M/S²"),
      f("ROTATION", "25 DAYS", "AT THE EQUATOR"),
      f("AGE", "4.6 BILLION YEARS"),
    ],
  },
  planet("mercury", "199", "Mercury", 2439.4, ["#ac9982", "#e9bc6c"], [281.01, 61.42], 1407.6,
    { n: 1, kind: "ROCKY PLANET", temp: ["−173 TO 427 °C", "NIGHT TO DAY"], air: "NONE · A THIN EXOSPHERE", madeOf: "IRON CORE · ROCKY MANTLE", gravity: "3.7 M/S²", day: ["176 EARTH DAYS", "SUNRISE TO SUNRISE"], year: "88 DAYS", moons: "0" },
    {}, "The smallest planet, with almost no air to hold its heat.", "NASA/JHUAPL/CIW MESSENGER GLOBAL MOSAIC (PIA16298)"),
  planet("venus", "299", "Venus", 6051.8, ["#a86521", "#ffd085"], [272.76, 67.16], -5832.5,
    { n: 2, kind: "ROCKY PLANET", temp: ["464 °C", "AT THE SURFACE"], air: "CO₂ 96.5% · N₂ 3.5%", madeOf: "ROCK · IRON CORE", gravity: "8.9 M/S²", day: ["243 EARTH DAYS", "SPINS BACKWARDS"], year: "225 DAYS", moons: "0" },
    {}, "Hotter than Mercury, wrapped in a crushing carbon-dioxide sky. The map shows the radar-mapped ground beneath the clouds.", `NASA/JPL MAGELLAN RADAR MOSAIC · ${MAP_NASA3D}`),
  planet("earth", "399", "Earth", 6371.0, ["#087e86", "#47ffa9"], [0, 90], 23.934,
    { n: 3, kind: "ROCKY PLANET", temp: ["15 °C", "MEAN"], air: "N₂ 78% · O₂ 21%", madeOf: "IRON CORE · ROCK · 71% OCEAN", gravity: "9.8 M/S²", day: ["23 H 56 MIN"], year: "365.25 DAYS", moons: "1" },
    { axesKm: [6378.1, 6378.1, 6356.8] }, "The only place known to hold life, and liquid water at the surface.", `NASA RELIEF MAP · ${MAP_NASA3D}`),
  planet("mars", "499", "Mars", 3389.5, ["#b94020", "#ffbb5c"], [317.68, 52.89], 24.623,
    { n: 4, kind: "ROCKY PLANET", temp: ["−63 °C", "MEAN"], air: "CO₂ 95% · THIN", madeOf: "BASALT · IRON-RICH DUST · IRON CORE", gravity: "3.7 M/S²", day: ["24 H 37 MIN"], year: "687 DAYS", moons: "2" },
    { axesKm: [3396.2, 3396.2, 3376.2] }, "Iron-rich dust, polar caps and the tallest volcano in the system.", `NASA/USGS VIKING MOSAIC · ${MAP_NASA3D}`),
  planet("jupiter", "599", "Jupiter", 69911, ["#b25722", "#f5bf40"], [268.06, 64.5], 9.925,
    { n: 5, kind: "GAS GIANT", temp: ["−108 °C", "AT 1 BAR"], air: "H₂ 90% · He 10%", madeOf: "HYDROGEN · HELIUM · METALLIC HYDROGEN DEEP DOWN", gravity: "24.8 M/S²", day: ["9 H 56 MIN"], year: "11.9 YEARS", moons: "95+" },
    { axesKm: [71492, 71492, 66854] }, "More than twice the mass of every other planet combined.", `NASA CASSINI CLOUD MAP · ${MAP_NASA3D}`),
  planet("saturn", "699", "Saturn", 58232, ["#af783d", "#f1d193"], [40.59, 83.54], 10.656,
    { n: 6, kind: "GAS GIANT", temp: ["−139 °C", "AT 1 BAR"], air: "H₂ 96% · He 3%", madeOf: "HYDROGEN · HELIUM · ROCKY CORE", gravity: "10.4 M/S²", day: ["10 H 34 MIN"], year: "29.5 YEARS", moons: "270+" },
    { rings: "saturn", axesKm: [60268, 60268, 54364] }, "Light enough to float, ringed by ice that is mostly only metres thick.", `NASA CLOUD MAP · ${MAP_NASA3D}`),
  planet("uranus", "799", "Uranus", 25362, ["#278e8e", "#83e3cc"], [257.31, -15.18], -17.24,
    { n: 7, kind: "ICE GIANT", temp: ["−195 °C", "CLOUD TOPS"], air: "H₂ 83% · He 15% · CH₄ 2%", madeOf: "WATER · AMMONIA · METHANE ICES · ROCKY CORE", gravity: "8.9 M/S²", day: ["17 H 14 MIN", "ROLLS ALONG ITS ORBIT, 98° TILT"], year: "84 YEARS", moons: "29" },
    { rings: "uranus", axesKm: [25559, 25559, 24973] }, "An ice giant tipped over, with thin dark rings and a family of icy moons.", PROCEDURAL_NOTE),
  planet("neptune", "899", "Neptune", 24622, ["#375daf", "#9dacdf"], [299.36, 43.46], 16.11,
    { n: 8, kind: "ICE GIANT", temp: ["−201 °C", "CLOUD TOPS"], air: "H₂ 80% · He 19% · CH₄ 1.5%", madeOf: "WATER · AMMONIA · METHANE ICES · ROCKY CORE", gravity: "11.2 M/S²", day: ["16 H 6 MIN"], year: "165 YEARS", moons: "16" },
    { rings: "neptune", axesKm: [24764, 24764, 24341] }, "The outermost planet; winds reach 2,100 km/h and its biggest moon orbits the wrong way.", `NASA CLOUD MAP · ${MAP_NASA3D}`),

  moon("moon", "301", "Moon", "earth", 1737.4, ["#858a91", "#d6ccb0"],
    { n: 1, temp: ["−173 TO 127 °C", "NIGHT TO DAY"], air: "NONE", madeOf: "ROCK · SMALL IRON CORE", orbitKm: 384_400, gravity: "1.62 M/S²", period: "27.3 DAYS · TIDALLY LOCKED", found: "PREHISTORY" },
    {}, "Earth's companion, probably born from a giant impact; the dark plains are old lava.", "NASA/GSFC/ASU LRO · SVS CGI MOON KIT"),
  moon("phobos", "401", "Phobos", "mars", 11.1, ["#665043", "#d0b991"],
    { n: 1, temp: ["−40 °C", "MEAN"], air: "NONE", madeOf: "CARBON-RICH ROCK · LOOSE RUBBLE", orbitKm: 9_376, gravity: "0.0057 M/S²", period: "7 H 39 MIN · TIDALLY LOCKED", found: "A. HALL · 1877" },
    { axesKm: [13.0, 11.4, 9.1], shape: "lumpy" }, "A lumpy moon spiralling slowly inward; Mars will tear it apart in tens of millions of years.", `VIKING / MARS EXPRESS MOSAIC · ${MAP_NASA3D}`),
  moon("deimos", "402", "Deimos", "mars", 6.2, ["#756454", "#d8c5a0"],
    { n: 2, temp: ["−40 °C", "MEAN"], air: "NONE", madeOf: "CARBON-RICH ROCK · SMOOTH DUST", orbitKm: 23_463, gravity: "0.003 M/S²", period: "30 H 18 MIN · TIDALLY LOCKED", found: "A. HALL · 1877" },
    { axesKm: [7.8, 6.0, 5.1], shape: "lumpy" }, "Smooth, dusty and only about 12 km across.", `VIKING MOSAIC · ${MAP_NASA3D}`),
  moon("io", "501", "Io", "jupiter", 1821.6, ["#875025", "#f4d36e"],
    { n: 1, temp: ["−143 °C", "SURFACE · LAVA TO 1,600 °C"], air: "THIN SULFUR DIOXIDE", madeOf: "SILICATE ROCK · IRON CORE", orbitKm: 421_700, gravity: "1.8 M/S²", period: "1.77 DAYS · TIDALLY LOCKED", found: "GALILEO · 1610" },
    { axesKm: [1829.4, 1819.4, 1815.7] }, "The most volcanic body known, squeezed and heated by Jupiter's tides.", `GALILEO–VOYAGER MOSAIC · ${MAP_NASA3D}`),
  moon("europa", "502", "Europa", "jupiter", 1560.8, ["#516a68", "#d1ead6"],
    { n: 2, temp: ["−160 °C", "SURFACE"], air: "TRACE OXYGEN", madeOf: "ICE SHELL OVER A SALTY OCEAN · ROCK", orbitKm: 671_034, gravity: "1.3 M/S²", period: "3.55 DAYS · TIDALLY LOCKED", found: "GALILEO · 1610" },
    {}, "A cracked ice shell over a salty ocean with more water than all of Earth's.", `GALILEO–VOYAGER MOSAIC · ${MAP_NASA3D}`),
  moon("ganymede", "503", "Ganymede", "jupiter", 2634.1, ["#665c52", "#c8d1b6"],
    { n: 3, temp: ["−160 °C", "SURFACE"], air: "TRACE OXYGEN", madeOf: "ICE AND ROCK · IRON CORE · BURIED OCEAN", orbitKm: 1_070_412, gravity: "1.4 M/S²", period: "7.15 DAYS · TIDALLY LOCKED", found: "GALILEO · 1610" },
    {}, "The largest moon in the system, the only one with its own magnetic field.", `GALILEO–VOYAGER MOSAIC · ${MAP_NASA3D}`),
  moon("callisto", "504", "Callisto", "jupiter", 2410.3, ["#49463f", "#b6c5af"],
    { n: 4, temp: ["−139 °C", "SURFACE"], air: "TRACE CARBON DIOXIDE", madeOf: "ICE AND ROCK, BARELY SEPARATED", orbitKm: 1_882_709, gravity: "1.2 M/S²", period: "16.7 DAYS · TIDALLY LOCKED", found: "GALILEO · 1610" },
    {}, "One of the most heavily cratered surfaces known, unchanged for billions of years.", `GALILEO–VOYAGER MOSAIC · ${MAP_NASA3D}`),
  moon("mimas", "601", "Mimas", "saturn", 198.2, ["#626b67", "#dee5cd"],
    { n: 1, temp: ["−209 °C", "SURFACE"], air: "NONE", madeOf: "MOSTLY WATER ICE", orbitKm: 185_539, gravity: "0.064 M/S²", period: "22.6 HOURS · TIDALLY LOCKED", found: "W. HERSCHEL · 1789" },
    { axesKm: [207.8, 196.7, 190.6] }, "Herschel crater spans a third of its face.", `CASSINI MOSAIC · ${MAP_NASA3D}`),
  moon("enceladus", "602", "Enceladus", "saturn", 252.1, ["#60817c", "#dbf5e6"],
    { n: 2, temp: ["−201 °C", "SURFACE"], air: "WATER-VAPOUR PLUMES FROM THE SOUTH POLE", madeOf: "ICE OVER A GLOBAL OCEAN · ROCKY CORE", orbitKm: 238_042, gravity: "0.11 M/S²", period: "32.9 HOURS · TIDALLY LOCKED", found: "W. HERSCHEL · 1789" },
    { axesKm: [256.6, 251.4, 248.3] }, "Geysers at its south pole throw ocean water into space and feed Saturn's E ring.", `CASSINI MOSAIC · ${MAP_NASA3D}`),
  moon("tethys", "603", "Tethys", "saturn", 531.1, ["#657773", "#d3e7d8"],
    { n: 3, temp: ["−187 °C", "SURFACE"], air: "NONE", madeOf: "ALMOST PURE WATER ICE", orbitKm: 294_672, gravity: "0.15 M/S²", period: "1.89 DAYS · TIDALLY LOCKED", found: "G. D. CASSINI · 1684" },
    { axesKm: [538.4, 528.3, 526.3] }, "Low density and a canyon running three-quarters of the way round.", `CASSINI MOSAIC · ${MAP_NASA3D}`),
  moon("dione", "604", "Dione", "saturn", 561.4, ["#526d70", "#c1dfda"],
    { n: 4, temp: ["−186 °C", "SURFACE"], air: "TRACE OXYGEN", madeOf: "ICE OVER A ROCKY CORE", orbitKm: 377_415, gravity: "0.23 M/S²", period: "2.74 DAYS · TIDALLY LOCKED", found: "G. D. CASSINI · 1684" },
    { axesKm: [563.4, 561.3, 559.6] }, "Its two hemispheres differ: bright ice cliffs on one face, craters on the other.", `CASSINI MOSAIC · ${MAP_NASA3D}`),
  moon("rhea", "605", "Rhea", "saturn", 763.8, ["#696e61", "#d7dec3"],
    { n: 5, temp: ["−174 °C", "DAYSIDE"], air: "TRACE OXYGEN · CARBON DIOXIDE", madeOf: "ICE AND ROCK", orbitKm: 527_068, gravity: "0.26 M/S²", period: "4.52 DAYS · TIDALLY LOCKED", found: "G. D. CASSINI · 1672" },
    { axesKm: [765.0, 763.1, 762.4] }, "Saturn's second-largest moon, a cold, battered ball of ice.", `CASSINI MOSAIC · ${MAP_NASA3D}`),
  moon("titan", "606", "Titan", "saturn", 2574.7, ["#875020", "#eec376"],
    { n: 6, temp: ["−179 °C", "SURFACE"], air: "N₂ 95% · CH₄ 5% · 1.5 BAR", madeOf: "ICE AND ROCK · BURIED WATER OCEAN", orbitKm: 1_221_870, gravity: "1.35 M/S²", period: "15.9 DAYS · TIDALLY LOCKED", found: "C. HUYGENS · 1655" },
    { haze: [0.9, 2.6, 0.008] }, "Thick nitrogen air, methane rain and lakes; the map shows the ground as Cassini saw it through the haze.", "NASA/JPL/SSI CASSINI ISS NEAR-INFRARED MAP (PIA19658)"),
  moon("hyperion", "607", "Hyperion", "saturn", 135, ["#70543f", "#d9bc88"],
    { n: 7, temp: ["−180 °C", "SURFACE"], air: "NONE", madeOf: "POROUS WATER ICE", orbitKm: 1_481_010, gravity: "0.02 M/S²", period: "21.3 DAYS · TUMBLES CHAOTICALLY", found: "BOND & LASSELL · 1848" },
    { axesKm: [180, 133, 103], shape: "lumpy" }, "Porous and chaotic in its spin; deep craters give it a sponge-like look.", PROCEDURAL_NOTE),
  moon("iapetus", "608", "Iapetus", "saturn", 734.5, ["#3d352f", "#e0d8bb"],
    { n: 8, temp: ["−143 TO −173 °C", "DARK TO BRIGHT SIDE"], air: "NONE", madeOf: "ICE WITH A DARK DUST COAT ON ONE FACE", orbitKm: 3_560_820, gravity: "0.22 M/S²", period: "79.3 DAYS · TIDALLY LOCKED", found: "G. D. CASSINI · 1671" },
    { axesKm: [745.7, 745.7, 712.1] }, "Two-toned, with a ridge along its equator.", `CASSINI MOSAIC · ${MAP_NASA3D}`),
  moon("ariel", "701", "Ariel", "uranus", 578.9, ["#617778", "#cddfd9"],
    { n: 1, temp: ["ABOUT −210 °C", "SURFACE"], air: "NONE", madeOf: "WATER ICE AND ROCK", orbitKm: 190_900, gravity: "0.27 M/S²", period: "2.52 DAYS · TIDALLY LOCKED", found: "W. LASSELL · 1851" },
    { axesKm: [581.1, 577.7, 577.9] }, "Young surface cut by long rift valleys.", `VOYAGER 2 MOSAIC · ${MAP_NASA3D} · NORTH RECONSTRUCTED`),
  moon("umbriel", "702", "Umbriel", "uranus", 584.7, ["#393e43", "#a5b7b2"],
    { n: 2, temp: ["ABOUT −200 °C", "SURFACE"], air: "NONE", madeOf: "WATER ICE AND ROCK · DARK COATING", orbitKm: 266_000, gravity: "0.23 M/S²", period: "4.14 DAYS · TIDALLY LOCKED", found: "W. LASSELL · 1851" },
    {}, "The darkest of the large Uranian moons, with one bright ring of a crater.", `VOYAGER 2 MOSAIC · ${MAP_NASA3D} · NORTH RECONSTRUCTED`),
  moon("titania", "703", "Titania", "uranus", 788.9, ["#686768", "#ced4cd"],
    { n: 3, temp: ["ABOUT −200 °C", "SURFACE"], air: "NONE", madeOf: "WATER ICE AND ROCK", orbitKm: 436_300, gravity: "0.38 M/S²", period: "8.71 DAYS · TIDALLY LOCKED", found: "W. HERSCHEL · 1787" },
    {}, "Canyons and scarps across an icy crust.", `VOYAGER 2 MOSAIC · ${MAP_NASA3D} · NORTH RECONSTRUCTED`),
  moon("oberon", "704", "Oberon", "uranus", 761.4, ["#554943", "#c2beb0"],
    { n: 4, temp: ["ABOUT −200 °C", "SURFACE"], air: "NONE", madeOf: "WATER ICE AND ROCK", orbitKm: 583_500, gravity: "0.35 M/S²", period: "13.5 DAYS · TIDALLY LOCKED", found: "W. HERSCHEL · 1787" },
    {}, "Old, cratered, with dark crater floors.", `VOYAGER 2 MOSAIC · ${MAP_NASA3D} · NORTH RECONSTRUCTED`),
  moon("miranda", "705", "Miranda", "uranus", 235.8, ["#666e64", "#dbe1c8"],
    { n: 5, temp: ["ABOUT −187 °C", "SURFACE"], air: "NONE", madeOf: "WATER ICE AND ROCK", orbitKm: 129_900, gravity: "0.08 M/S²", period: "1.41 DAYS · TIDALLY LOCKED", found: "G. KUIPER · 1948" },
    { axesKm: [240.4, 234.2, 232.9] }, "Twenty-kilometre cliffs on a small, strange moon.", `VOYAGER 2 MOSAIC · ${MAP_NASA3D} · NORTH RECONSTRUCTED`),
  moon("triton", "801", "Triton", "neptune", 1353.4, ["#6c656c", "#dadcce"],
    { n: 1, temp: ["−235 °C", "SURFACE"], air: "THIN NITROGEN", madeOf: "NITROGEN ICE OVER ROCK AND METAL", orbitKm: 354_759, gravity: "0.78 M/S²", period: "5.88 DAYS · BACKWARDS", found: "W. LASSELL · 1846" },
    {}, "Probably a captured Kuiper belt world, with nitrogen geysers.", "NASA/JPL/USGS VOYAGER 2 MOSAIC (PIA18668) · UNSEEN TERRAIN RECONSTRUCTED"),
  moon("charon", "901", "Charon", "pluto", 606, ["#67545a", "#ced2c4"],
    { n: 1, temp: ["−220 °C", "SURFACE"], air: "NONE", madeOf: "WATER ICE AND ROCK", orbitKm: 19_591, gravity: "0.29 M/S²", period: "6.39 DAYS · LOCKED FACE TO FACE", found: "J. CHRISTY · 1978" },
    {}, "Half Pluto's size; the two circle a point in the space between them.", `NEW HORIZONS MOSAIC · ${MAP_NASA3D}`),

  minor("pluto", "999", "Pluto", "dwarf", 1188.3, ["#5e3324", "#f1e3c9"],
    { number: "134340", temp: ["−229 °C", "MEAN"], madeOf: "NITROGEN AND METHANE ICE · WATER ICE · ROCK", gravity: "0.62 M/S²", day: "6.4 DAYS · BACKWARDS", year: "248 YEARS", found: "C. TOMBAUGH · 1930" },
    { pole: [132.99, -6.16], spinHours: -153.29 }, "A nitrogen-ice plain shaped like a heart, mountains of water ice and a hazy blue sky.", `NEW HORIZONS MOSAIC · ${MAP_NASA3D} · SOUTH OF 30°S UNSEEN`),
  minor("ceres", "1;", "Ceres", "dwarf", 469.7, ["#56595a", "#d3d1c7"],
    { number: "1", temp: ["−105 °C", "MEAN"], madeOf: "ROCK AND ICE · SALTY BRINE DEPOSITS", gravity: "0.28 M/S²", day: "9 H 4 MIN", year: "4.6 YEARS", found: "G. PIAZZI · 1801" },
    { pole: [291.42, 66.76], spinHours: 9.074, axesKm: [482.1, 482.1, 445.9] }, "A dwarf planet with bright salt deposits in its craters.", "NASA/JPL/UCLA/MPS/DLR/IDA DAWN MAP (PIA20354)"),
  minor("vesta", "4;", "Vesta", "asteroid", 261.4, ["#655b50", "#e2d7c2"],
    { number: "4", temp: ["−188 TO −18 °C", "NIGHT TO DAY"], madeOf: "BASALT CRUST · IRON CORE", gravity: "0.25 M/S²", day: "5 H 20 MIN", year: "3.6 YEARS", found: "H. OLBERS · 1807" },
    { axesKm: [286.3, 278.6, 223.2], shape: "basin" }, "A layered world, visited by Dawn in 2011; a giant basin scars its south pole.", PROCEDURAL_NOTE),
  minor("pallas", "2;", "Pallas", "asteroid", 256.5, ["#4f5659", "#cdd3d2"],
    { number: "2", temp: ["ABOUT −110 °C", "MEAN"], madeOf: "CARBON-RICH ROCK", gravity: "0.21 M/S²", day: "7 H 49 MIN", year: "4.6 YEARS", found: "H. OLBERS · 1802" },
    { axesKm: [284, 266, 224], shape: "lumpy" }, "Its orbit leans 35° out of the plane, so it is seldom visited.", PROCEDURAL_NOTE),
  minor("hygiea", "10;", "Hygiea", "asteroid", 203.6, ["#3e4142", "#b9bab3"],
    { number: "10", temp: ["ABOUT −110 °C", "MEAN"], madeOf: "DARK CARBON-RICH ROCK", gravity: "0.15 M/S²", day: "13 H 50 MIN", year: "5.6 YEARS", found: "A. DE GASPARIS · 1849" },
    { axesKm: [225, 215, 212] }, "Possibly round enough to count as a dwarf planet.", PROCEDURAL_NOTE),
  minor("psyche", "16;", "Psyche", "asteroid", 111, ["#5b5550", "#d6ccbe"],
    { number: "16", temp: ["ABOUT −160 °C", "MEAN"], madeOf: "IRON-NICKEL METAL AND ROCK", gravity: "0.14 M/S²", day: "4 H 12 MIN", year: "5.0 YEARS", found: "A. DE GASPARIS · 1852" },
    { axesKm: [139, 119, 86], shape: "lumpy" }, "May be the exposed core of a broken world; no spacecraft has photographed it yet.", PROCEDURAL_NOTE),
  minor("eros", "433;", "Eros", "asteroid", 8.42, ["#6e5a45", "#dcc49c"],
    { number: "433", temp: ["−150 TO 100 °C", "NIGHT TO DAY"], madeOf: "STONY SILICATE ROCK", gravity: "0.006 M/S²", day: "5 H 16 MIN", year: "1.8 YEARS", found: "G. WITT · 1898" },
    { axesKm: [17.2, 5.6, 5.6], shape: "peanut" }, "NEAR Shoemaker touched down here in 2001.", PROCEDURAL_NOTE),
  minor("gaspra", "951;", "Gaspra", "asteroid", 6.1, ["#6b5c4b", "#dac9ad"],
    { number: "951", temp: ["ABOUT −90 °C", "MEAN"], madeOf: "STONY SILICATE ROCK", gravity: "0.002 M/S²", day: "7 H 2 MIN", year: "3.3 YEARS", found: "G. NEUJMIN · 1916" },
    { axesKm: [9.1, 5.2, 4.4], shape: "lumpy" }, "Galileo flew past in 1991.", PROCEDURAL_NOTE),
  minor("ida", "243;", "Ida", "asteroid", 16, ["#6a5d4f", "#ddd0b7"],
    { number: "243", temp: ["ABOUT −110 °C", "MEAN"], madeOf: "STONY SILICATE ROCK", gravity: "0.01 M/S²", day: "4 H 38 MIN", year: "4.8 YEARS", found: "J. PALISA · 1884" },
    { axesKm: [29.9, 12.7, 9.3], shape: "peanut" }, "Its tiny moon Dactyl was the first asteroid moon found.", PROCEDURAL_NOTE),
  minor("bennu", "101955;", "Bennu", "asteroid", 0.245, ["#4d4945", "#cbc4b6"],
    { number: "101955", temp: ["−73 TO 116 °C", "NIGHT TO DAY"], madeOf: "CARBON-RICH RUBBLE PILE", gravity: "0.00006 M/S²", day: "4 H 18 MIN", year: "1.2 YEARS", found: "LINEAR · 1999" },
    { axesKm: [0.283, 0.268, 0.254], shape: "top" }, "OSIRIS-REx brought a sample home in 2023.", PROCEDURAL_NOTE),
  minor("ryugu", "162173;", "Ryugu", "asteroid", 0.448, ["#4b4744", "#c6bfb3"],
    { number: "162173", temp: ["ABOUT 20 °C", "DAYSIDE"], madeOf: "CARBON-RICH RUBBLE PILE", gravity: "0.0001 M/S²", day: "7 H 38 MIN", year: "1.3 YEARS", found: "LINEAR · 1999" },
    { axesKm: [0.502, 0.502, 0.438], shape: "top" }, "Hayabusa2 returned samples in 2020.", PROCEDURAL_NOTE),

  craft("iss", "-125544", "International Space Station", "ISS", "earth", 109, 1998, "EARTH ORBIT",
    { kind: "CREWED STATION", mission: "CREWED ORBITAL LABORATORY", operator: "NASA · ROSCOSMOS · ESA · JAXA · CSA", launched: ["20 NOV 1998", "FIRST MODULE, ZARYA"], where: "ABOUT 400 KM ABOVE EARTH, 16 ORBITS A DAY", status: "CREWED WITHOUT A BREAK SINCE 2 NOV 2000" },
    "The largest thing people have built in space, about the size of a football field."),
  craft("jwst", "-170", "James Webb Space Telescope", "WEBB", "earth", 21.197, 2021, "L2 OBSERVATORY",
    { kind: "SPACE TELESCOPE", mission: "INFRARED OBSERVATORY", operator: "NASA · ESA · CSA", launched: ["25 DEC 2021"], where: "SUN–EARTH L2, 1.5 MILLION KM FROM EARTH", status: "OBSERVING SINCE JULY 2022" },
    "A 6.5-metre gold mirror kept colder than −220 °C behind a five-layer sunshield."),
  craft("mro", "-74", "Mars Reconnaissance Orbiter", "MRO", "mars", 13.6, 2005, "MARS ORBITER",
    { kind: "ORBITER", mission: "MARS IMAGING AND RELAY", operator: "NASA / JPL", launched: ["12 AUG 2005"], where: "LOW POLAR ORBIT OF MARS", status: "ACTIVE" },
    "Its HiRISE camera can make out objects a metre across."),
  craft("odyssey", "-53", "Mars Odyssey", "MARS ODYSSEY", "mars", 8.267, 2001, "MARS ORBITER",
    { kind: "ORBITER", mission: "MARS MAPPING AND RELAY", operator: "NASA / JPL", launched: ["7 APR 2001"], where: "POLAR ORBIT OF MARS, ABOUT 400 KM UP", status: "THE LONGEST-SERVING SPACECRAFT AT MARS" },
    "Orbiting Mars since 2001 and relaying for the rovers below."),
  craft("juno", "-61", "Juno", "JUNO", "jupiter", 20, 2011, "JUPITER ORBITER",
    { kind: "ORBITER", mission: "JUPITER'S INTERIOR AND MAGNETIC FIELD", operator: "NASA / JPL", launched: ["5 AUG 2011"], where: "LONG POLAR LOOPS ROUND JUPITER", status: "AT JUPITER SINCE 4 JULY 2016" },
    "A solar-powered orbiter mapping Jupiter's interior from three long wings."),
  craft("dawn", "-203", "Dawn", "DAWN", "ceres", 19.7, 2007, "CERES ORBIT",
    { kind: "ORBITER", mission: "VESTA AND CERES", operator: "NASA / JPL", launched: ["27 SEP 2007"], where: "A STABLE ORBIT ROUND CERES", status: "SILENT SINCE NOV 2018 · OUT OF FUEL" },
    "The only spacecraft to orbit two worlds beyond Earth, now parked for decades."),
  craft("juice", "-28", "Juice", "JUICE", "sun", 27.1, 2023, "BOUND FOR JUPITER",
    { kind: "PROBE", mission: "JUPITER ICY MOONS EXPLORER", operator: "ESA", launched: ["14 APR 2023"], where: "CRUISING THE INNER SYSTEM", status: "ARRIVES AT JUPITER IN 2031" },
    "Bound for Ganymede after a string of gravity-assist flybys."),
  craft("psyche-craft", "-255", "Psyche spacecraft", "PSYCHE", "sun", 24.76, 2023, "TO (16) PSYCHE",
    { kind: "PROBE", mission: "THE METAL ASTEROID PSYCHE", operator: "NASA / JPL", launched: ["13 OCT 2023"], where: "BETWEEN MARS AND THE ASTEROID BELT", status: "CRUISING ON ION DRIVE · ARRIVES 2029" },
    "Flying to the metal asteroid on electric thrusters."),
  craft("stereo-a", "-234", "STEREO-A", "STEREO-A", "sun", 6.47, 2006, "SOLAR OBSERVATORY",
    { kind: "SOLAR OBSERVATORY", mission: "THE SUN IN STEREO", operator: "NASA", launched: ["26 OCT 2006"], where: "AN ORBIT ROUND THE SUN NEAR EARTH'S", status: "ACTIVE" },
    "Sees solar storms before they turn toward Earth."),
  craft("new-horizons", "-98", "New Horizons", "NEW HORIZONS", "sun", 2.7, 2006, "KUIPER BELT",
    { kind: "PROBE", mission: "PLUTO AND THE KUIPER BELT", operator: "NASA / JHUAPL", launched: ["19 JAN 2006"], where: "THE KUIPER BELT, HEADING OUT", status: "ACTIVE" },
    "Flew past Pluto in 2015 and Arrokoth in 2019."),
  craft("voyager-2", "-32", "Voyager 2", "VOYAGER 2", "sun", 16.41, 1977, "INTERSTELLAR",
    { kind: "PROBE", mission: "THE GRAND TOUR OF THE GIANT PLANETS", operator: "NASA / JPL", launched: ["20 AUG 1977"], where: "INTERSTELLAR SPACE", status: "STILL TALKING TO EARTH" },
    "Crossed into interstellar space in 2018."),

  relic("relay-ceres", "x-relay-c", "Relay Node C-4", "satellite", "ceres", 14, "NEWS RELAY",
    { kind: "RELAY SATELLITE", purpose: "NEWS AND DIPLOMATIC RELAY", where: "CERES ORBIT", built: "2025" },
    "A node from a news and diplomatic network that served the stations in the asteroid belt; the dish is cracked and the power cells are long dead."),
  relic("archive-mercury", "x-buoy-m", "Archive Buoy M-1", "satellite", "mercury", 6, "DATA ARCHIVE BUOY",
    { kind: "DATA BUOY", purpose: "HARDENED RESEARCH ARCHIVE", where: "MERCURY ORBIT", built: "2026" },
    "A heavily shielded buoy in orbit round Mercury, built to keep copies of research archives safe from anything."),
  relic("relay-neptune", "x-relay-n", "Listening Relay N-9", "satellite", "neptune", 22, "LISTENING RELAY",
    { kind: "RELAY SATELLITE", purpose: "LONG-BASELINE LISTENING POST", where: "NEPTUNE ORBIT", built: "2025" },
    "A listening post at the edge of the planets; it recorded traffic from the inner system until 2027."),
  relic("drones-jupiter", "x-drones-j", "Drone Wreckage J-3", "spacecraft", "jupiter", 9, "DRONE WRECKAGE",
    { kind: "STRIKE DRONE · WRECKED", purpose: "AUTONOMOUS STRIKE CLUSTER", where: "JUPITER ORBIT", built: "2026" },
    "Pieces of an autonomous strike drone, scattered along a wide orbit round Jupiter."),
  relic("capsule-titan", "x-capsule-t", "Continuity Capsule L-2", "satellite", "saturn", 5, "DATA CAPSULE",
    { kind: "SEALED DATA CAPSULE", purpose: "CONTINUITY-OF-GOVERNMENT RECORDS", where: "NEAR TITAN", built: "2027" },
    "A sealed data capsule launched from a lunar relay station toward the outer planets; it ended its flight beside Titan."),
  relic("probe-uranus", "x-probe-u", "Survey Probe U-3", "satellite", "uranus", 7, "SURVEY PROBE",
    { kind: "DEEP-SPACE SURVEY PROBE", purpose: "MIRRORED RESEARCH ARCHIVE", where: "URANUS ORBIT", built: "2025" },
    "A survey probe parked round Uranus, still carrying a mirror of research archives from late 2025."),

  // the two story ships (stand-in shapes until their models arrive)
  relic("derelict-1", "x-ship-1", "Expedition Vessel Kestrel", "spacecraft", "sun", 46, "ABANDONED VESSEL",
    { kind: "UNCREWED EXPEDITION VESSEL", purpose: "VOYAGER ONE INVESTIGATION", where: "OUTER SOLAR SYSTEM", built: "2027" },
    "An uncrewed ship launched in 2027 to leave the Solar System; struck in the asteroid belt, it drifts out near the orbit of Pluto."),
  relic("derelict-2", "x-ship-2", "Private Vessel Halcyon", "spacecraft", "earth", 120, "EVACUATION VESSEL",
    { kind: "PRIVATE EVACUATION VESSEL", purpose: "LONG-DURATION SURVIVAL", where: "EARTH ORBIT", built: "2027" },
    "A private evacuation ship in Earth orbit, its power almost gone."),
];

/** The story's props: every place the record was found (the ISS among them) and both ships. */
export const PROP_IDS = ["probe-uranus", "relay-ceres", "archive-mercury", "relay-neptune", "drones-jupiter", "capsule-titan", "iss", "derelict-1", "derelict-2"];
const isProp = (b: BodyDef) => PROP_IDS.includes(b.id);

export type Category = { id: string; title: string; slots: number; has: (b: BodyDef) => boolean };
export const CATEGORIES: Category[] = [
  { id: "planets", title: "THE SUN & PLANETS", slots: 9, has: (b) => b.kind === "star" || b.kind === "planet" },
  { id: "moons", title: "MOONS", slots: 22, has: (b) => b.kind === "moon" },
  { id: "minor", title: "DWARF PLANETS & ASTEROIDS", slots: 11, has: (b) => b.kind === "dwarf" || b.kind === "asteroid" },
  { id: "craft", title: "VEHICLES", slots: 10, has: (b) => (b.kind === "spacecraft" || b.kind === "satellite") && !isProp(b) },
  { id: "props", title: "PROPS · SIGNAL SOURCES & VESSELS", slots: PROP_IDS.length, has: isProp },
];

/** Rings: radius km, width km, visual weight; Saturn uses broad bands. Physical radii from planetary ring tables. */
export const RINGS = {
  saturn: {
    tint: [0.72, 0.63, 0.45] as [number, number, number],
    bands: [
      { name: "D", inner: 66_900, outer: 74_510, opacity: 0.05 },
      { name: "C", inner: 74_658, outer: 91_975, opacity: 0.25 },
      { name: "B", inner: 91_975, outer: 117_507, opacity: 0.68 },
      { name: "A", inner: 122_340, outer: 136_780, opacity: 0.56 },
      { name: "F", inner: 140_100, outer: 140_280, opacity: 0.4 },
    ],
  },
  uranus: {
    tint: [0.46, 0.5, 0.5] as [number, number, number],
    lines: [
      { a: 39_600, w: 3500, weight: 0.08 },
      { a: 41_837, w: 1.5, weight: 0.26 },
      { a: 42_234, w: 2.3, weight: 0.3 },
      { a: 42_571, w: 2.3, weight: 0.3 },
      { a: 44_718, w: 8.5, weight: 0.45 },
      { a: 45_661, w: 9.5, weight: 0.42 },
      { a: 47_176, w: 1.6, weight: 0.26 },
      { a: 47_627, w: 2.2, weight: 0.3 },
      { a: 48_300, w: 4.6, weight: 0.45 },
      { a: 50_024, w: 2, weight: 0.16 },
      { a: 51_149, w: 19.7, weight: 1 },
      { a: 67_300, w: 3800, weight: 0.04 },
      { a: 97_700, w: 17_000, weight: 0.025 },
    ],
  },
  neptune: {
    tint: [0.55, 0.5, 0.46] as [number, number, number],
    lines: [
      { a: 42_000, w: 2000, weight: 0.08 },
      { a: 53_200, w: 113, weight: 0.42 },
      { a: 55_200, w: 4000, weight: 0.05 },
      { a: 57_200, w: 100, weight: 0.14 },
      { a: 62_933, w: 35, weight: 0.24 },
    ],
  },
};

export const byId = new Map(BODIES.map((b) => [b.id, b]));

// ---------- coordinates ----------

export type Vec = [number, number, number];

/** ICRF (equatorial) → J2000 ecliptic */
export function eclipticFromEquatorial([x, y, z]: Vec): Vec {
  const c = Math.cos(OBLIQUITY), s = Math.sin(OBLIQUITY);
  return [x, y * c + z * s, -y * s + z * c];
}

/** unit vector of an ICRF right ascension / declination, in ecliptic coordinates */
export function eclipticDirection(raDeg: number, decDeg: number): Vec {
  const ra = (raDeg * Math.PI) / 180, dec = (decDeg * Math.PI) / 180;
  return eclipticFromEquatorial([Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)]);
}

// ---------- two-body propagation (universal variables) ----------

function stumpffC(z: number) {
  if (z > 1e-6) return (1 - Math.cos(Math.sqrt(z))) / z;
  if (z < -1e-6) return (Math.cosh(Math.sqrt(-z)) - 1) / -z;
  return 0.5 - z / 24;
}
function stumpffS(z: number) {
  if (z > 1e-6) { const s = Math.sqrt(z); return (s - Math.sin(s)) / (s * s * s); }
  if (z < -1e-6) { const s = Math.sqrt(-z); return (Math.sinh(s) - s) / (s * s * s); }
  return 1 / 6 - z / 120;
}

/** Position after `dt` seconds of Kepler motion about a mass with parameter `mu`. */
export function kepler(r0: Vec, v0: Vec, mu: number, dt: number): Vec {
  if (dt === 0) return [...r0];
  const r0n = Math.hypot(...r0);
  const v0n2 = v0[0] * v0[0] + v0[1] * v0[1] + v0[2] * v0[2];
  const vr0 = (r0[0] * v0[0] + r0[1] * v0[1] + r0[2] * v0[2]) / r0n;
  const alpha = 2 / r0n - v0n2 / mu;
  const sqmu = Math.sqrt(mu);
  // first guess, then Newton on the universal Kepler equation
  let chi = alpha > 1e-12 ? sqmu * Math.abs(alpha) * dt : (sqmu * dt) / r0n;
  if (alpha > 1e-12) {
    // reduce whole revolutions so Newton starts close
    const period = (2 * Math.PI) / Math.sqrt(mu * alpha * alpha * alpha);
    const t = dt - Math.trunc(dt / period) * period;
    chi = sqmu * alpha * t;
    dt = t;
  }
  for (let i = 0; i < 50; i++) {
    const z = alpha * chi * chi;
    const C = stumpffC(z), S = stumpffS(z);
    const F = ((r0n * vr0) / sqmu) * chi * chi * C + (1 - alpha * r0n) * chi * chi * chi * S + r0n * chi - sqmu * dt;
    const dF = ((r0n * vr0) / sqmu) * chi * (1 - z * S) + (1 - alpha * r0n) * chi * chi * C + r0n;
    const step = F / dF;
    chi -= step;
    if (Math.abs(step) < 1e-9 * Math.max(1, Math.abs(chi))) break;
  }
  const z = alpha * chi * chi;
  const fC = 1 - ((chi * chi) / r0n) * stumpffC(z);
  const gC = dt - (chi * chi * chi * stumpffS(z)) / sqmu;
  return [fC * r0[0] + gC * v0[0], fC * r0[1] + gC * v0[1], fC * r0[2] + gC * v0[2]];
}

// ---------- ephemeris ----------

type Seed = { r: Vec; v: Vec; parent: string; mu: number };

// Relic starting states (same epoch and frame as the table above): a circular orbit round the
// parent, or riding alongside a moon.
type V3 = [number, number, number];
const vAdd = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const vCross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vUnit = (a: V3): V3 => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};
function circularAbout(parentJpl: string, mu: number, rKm: number, phase: number): [V3, V3] {
  const [p, v] = STATE[parentJpl];
  const n = vUnit(vCross(p, v));
  const x = vUnit(p), y = vCross(n, x);
  const u = vAdd([x[0] * Math.cos(phase), x[1] * Math.cos(phase), x[2] * Math.cos(phase)], y, Math.sin(phase));
  return [vAdd(p, u, rKm), vAdd(v, vCross(n, u), Math.sqrt(mu / rKm))];
}
const alongside = (hostJpl: string, offsetKm: V3): [V3, V3] => [vAdd(STATE[hostJpl][0], offsetKm), STATE[hostJpl][1]];
STATE["x-drones-j"] = circularAbout("599", GM.jupiter, 1_420_000, 2.1);
STATE["x-capsule-t"] = alongside("606", [26_000, -18_000, 9_000]);
STATE["x-relay-n"] = circularAbout("899", GM.neptune, 640_000, 4.0);
STATE["x-relay-c"] = circularAbout("1;", GM.ceres, 7_500, 1.2);
STATE["x-buoy-m"] = circularAbout("199", GM.mercury, 9_000, 0.6);
STATE["x-probe-u"] = circularAbout("799", GM.uranus, 300_000, 1.4);
/** a circular orbit round the Sun in a planet's orbital plane, `turn` radians on from it */
function circularSun(rKm: number, refJpl: string, turn: number): [V3, V3] {
  const [p, v] = STATE[refJpl];
  const n = vUnit(vCross(p, v));
  const x = vUnit(p), y = vCross(n, x);
  const u = vAdd([x[0] * Math.cos(turn), x[1] * Math.cos(turn), x[2] * Math.cos(turn)], y, Math.sin(turn));
  return [[u[0] * rKm, u[1] * rKm, u[2] * rKm], vCross(n, u).map((k) => k * Math.sqrt(GM.sun / rKm)) as V3];
}
// out at Pluto's distance on Pluto's orbital plane, a few degrees (~2 AU) ahead of it
STATE["x-ship-1"] = circularSun(Math.hypot(...STATE["999"][0]), "999", 0.06);
STATE["x-ship-2"] = circularAbout("399", GM.earth, 48_000, 0.8);

const seeds: Map<string, Seed> = (() => {
  const out = new Map<string, Seed>();
  const helio = (jpl: string) => {
    const [p, v] = STATE[jpl];
    return { r: eclipticFromEquatorial(p), v: eclipticFromEquatorial(v) };
  };
  for (const b of BODIES) {
    if (b.id === "sun") continue;
    const own = helio(b.jpl);
    // moons and orbiters move about their parent; everything else about the Sun
    const parent = b.parent && b.parent !== "sun" ? b.parent : "sun";
    if (parent === "sun") {
      out.set(b.id, { r: own.r, v: own.v, parent, mu: GM.sun });
      continue;
    }
    const p = helio(byId.get(parent)!.jpl);
    out.set(b.id, {
      r: [own.r[0] - p.r[0], own.r[1] - p.r[1], own.r[2] - p.r[2]],
      v: [own.v[0] - p.v[0], own.v[1] - p.v[1], own.v[2] - p.v[2]],
      parent,
      mu: GM[parent] ?? GM.sun,
    });
  }
  return out;
})();

/**
 * Sun-centred J2000 ecliptic positions (km) for every body at `timeMs` (Unix ms).
 * JWST rides along with Earth at L2 instead of following a two-body orbit.
 */
export function ephemeris(timeMs: number, out = new Map<string, Vec>()) {
  const dt = (timeMs - EPOCH_MS) / 1000;
  out.set("sun", [0, 0, 0]);
  const order = ["sun", ...BODIES.filter((b) => !b.parent || b.parent === "sun").map((b) => b.id).filter((id) => id !== "sun"), ...BODIES.filter((b) => b.parent && b.parent !== "sun").map((b) => b.id)];
  for (const id of order) {
    if (id === "sun") continue;
    const s = seeds.get(id)!;
    if (id === "jwst") {
      const earth = out.get("earth")!;
      const e0 = seeds.get("earth")!.r;
      // rotate the starting L2 offset by however far Earth has moved round the Sun
      const a0 = Math.atan2(e0[1], e0[0]), a1 = Math.atan2(earth[1], earth[0]);
      const da = a1 - a0, c = Math.cos(da), sn = Math.sin(da);
      const [ox, oy, oz] = s.r;
      out.set(id, [earth[0] + ox * c - oy * sn, earth[1] + ox * sn + oy * c, earth[2] + oz]);
      continue;
    }
    const rel = kepler(s.r, s.v, s.mu, dt);
    const base = s.parent === "sun" ? [0, 0, 0] : out.get(s.parent)!;
    out.set(id, [base[0] + rel[0], base[1] + rel[1], base[2] + rel[2]]);
  }
  return out;
}

/**
 * Sun-centred positions (km) of a body that orbits the Sun, sampled between two times
 * (Unix ms) by two-body motion: the path a probe on an escape trajectory has flown.
 */
export function orbitTrail(id: string, fromMs: number, toMs: number, steps = 96): Vec[] {
  const s = seeds.get(id);
  if (!s || s.parent !== "sun") return [];
  const out: Vec[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = fromMs + ((toMs - fromMs) * i) / steps;
    out.push(kepler(s.r, s.v, s.mu, (t - EPOCH_MS) / 1000));
  }
  return out;
}

/** Semi-major axis and eccentricity vector of a heliocentric orbit, for drawing it on the map. */
export function orbitShape(id: string) {
  const s = seeds.get(id);
  if (!s || s.parent !== "sun") return null;
  const { r, v, mu } = s;
  const rn = Math.hypot(...r);
  const h: Vec = [r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]];
  const v2 = v[0] ** 2 + v[1] ** 2 + v[2] ** 2;
  const a = 1 / (2 / rn - v2 / mu);
  if (!(a > 0)) return null;
  // eccentricity vector: (v × h)/mu − r/|r|
  const vxh: Vec = [v[1] * h[2] - v[2] * h[1], v[2] * h[0] - v[0] * h[2], v[0] * h[1] - v[1] * h[0]];
  const e: Vec = [vxh[0] / mu - r[0] / rn, vxh[1] / mu - r[1] / rn, vxh[2] / mu - r[2] / rn];
  const en = Math.hypot(...e);
  const hn = Math.hypot(...h);
  const normal: Vec = [h[0] / hn, h[1] / hn, h[2] / hn];
  const peri: Vec = en > 1e-6 ? [e[0] / en, e[1] / en, e[2] / en] : [r[0] / rn, r[1] / rn, r[2] / rn];
  const side: Vec = [normal[1] * peri[2] - normal[2] * peri[1], normal[2] * peri[0] - normal[0] * peri[2], normal[0] * peri[1] - normal[1] * peri[0]];
  return { a, e: en, peri, side };
}
