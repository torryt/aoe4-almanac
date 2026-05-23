// Canonical civ slugs. We use the long-form `id` from aoe4world's civs-index.json
// (e.g. "knights_templar") as the canonical key everywhere in our DB and UI.
// The short `slug` form aoe4world also publishes (e.g. "templar") is treated
// as an alias and gets normalized into the canonical form on ingest.

export const ABBASID_DYNASTY = "abbasid_dynasty";
export const AYYUBIDS = "ayyubids";
export const BYZANTINES = "byzantines";
export const CHINESE = "chinese";
export const DELHI_SULTANATE = "delhi_sultanate";
export const ENGLISH = "english";
export const FRENCH = "french";
export const GOLDEN_HORDE = "golden_horde";
export const HOLY_ROMAN_EMPIRE = "holy_roman_empire";
export const HOUSE_OF_LANCASTER = "house_of_lancaster";
export const JAPANESE = "japanese";
export const JEANNE_DARC = "jeanne_darc";
export const JIN_DYNASTY = "jin_dynasty";
export const KNIGHTS_TEMPLAR = "knights_templar";
export const MACEDONIAN_DYNASTY = "macedonian_dynasty";
export const MALIANS = "malians";
export const MONGOLS = "mongols";
export const ORDER_OF_THE_DRAGON = "order_of_the_dragon";
export const OTTOMANS = "ottomans";
export const RUS = "rus";
export const SENGOKU_DAIMYO = "sengoku_daimyo";
export const TUGHLAQ_DYNASTY = "tughlaq_dynasty";
export const ZHU_XIS_LEGACY = "zhu_xis_legacy";

// Map: short aoe4world slug -> canonical id. Used by seed and the runtime
// normalize() so aoe4world payloads carrying short slugs are stored canonically.
export const SHORT_SLUG_TO_CANONICAL: Record<string, string> = {
  abbasid: ABBASID_DYNASTY,
  ayyubids: AYYUBIDS,
  byzantines: BYZANTINES,
  chinese: CHINESE,
  delhi: DELHI_SULTANATE,
  english: ENGLISH,
  french: FRENCH,
  goldenhorde: GOLDEN_HORDE,
  hre: HOLY_ROMAN_EMPIRE,
  lancaster: HOUSE_OF_LANCASTER,
  japanese: JAPANESE,
  jeannedarc: JEANNE_DARC,
  jindynasty: JIN_DYNASTY,
  templar: KNIGHTS_TEMPLAR,
  macedonian: MACEDONIAN_DYNASTY,
  malians: MALIANS,
  mongols: MONGOLS,
  orderofthedragon: ORDER_OF_THE_DRAGON,
  ottomans: OTTOMANS,
  rus: RUS,
  sengoku: SENGOKU_DAIMYO,
  tughlaq: TUGHLAQ_DYNASTY,
  zhuxi: ZHU_XIS_LEGACY,
};

// Variant -> parent canonical id. Updates needed when new variants ship.
export const VARIANT_PARENTS: Record<string, string> = {
  [AYYUBIDS]: ABBASID_DYNASTY,
  [GOLDEN_HORDE]: MONGOLS,
  [JEANNE_DARC]: FRENCH,
  [JIN_DYNASTY]: CHINESE,
  [HOUSE_OF_LANCASTER]: ENGLISH,
  [MACEDONIAN_DYNASTY]: BYZANTINES,
  [ORDER_OF_THE_DRAGON]: HOLY_ROMAN_EMPIRE,
  [SENGOKU_DAIMYO]: JAPANESE,
  [KNIGHTS_TEMPLAR]: FRENCH,
  [TUGHLAQ_DYNASTY]: DELHI_SULTANATE,
  [ZHU_XIS_LEGACY]: CHINESE,
};

export function canonicalCivSlug(raw: string): string {
  return SHORT_SLUG_TO_CANONICAL[raw] ?? raw;
}

// Display names, keyed by canonical slug. Source of truth for the web UI when
// the civs query hasn't loaded yet (and for any code that runs outside React).
export const CIV_NAMES: Record<string, string> = {
  [ABBASID_DYNASTY]: "Abbasid Dynasty",
  [AYYUBIDS]: "Ayyubids",
  [BYZANTINES]: "Byzantines",
  [CHINESE]: "Chinese",
  [DELHI_SULTANATE]: "Delhi Sultanate",
  [ENGLISH]: "English",
  [FRENCH]: "French",
  [GOLDEN_HORDE]: "Golden Horde",
  [HOLY_ROMAN_EMPIRE]: "Holy Roman Empire",
  [HOUSE_OF_LANCASTER]: "House of Lancaster",
  [JAPANESE]: "Japanese",
  [JEANNE_DARC]: "Jeanne d'Arc",
  [JIN_DYNASTY]: "Jin Dynasty",
  [KNIGHTS_TEMPLAR]: "Knights Templar",
  [MACEDONIAN_DYNASTY]: "Macedonian Dynasty",
  [MALIANS]: "Malians",
  [MONGOLS]: "Mongols",
  [ORDER_OF_THE_DRAGON]: "Order of the Dragon",
  [OTTOMANS]: "Ottomans",
  [RUS]: "Rus",
  [SENGOKU_DAIMYO]: "Sengoku Daimyo",
  [TUGHLAQ_DYNASTY]: "Tughlaq Dynasty",
  [ZHU_XIS_LEGACY]: "Zhu Xi's Legacy",
};

export function prettyCivName(slug: string): string {
  const canonical = canonicalCivSlug(slug);
  if (CIV_NAMES[canonical]) return CIV_NAMES[canonical];
  return slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
