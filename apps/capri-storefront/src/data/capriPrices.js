// Real wholesale costs from Capri Optics — "Discount Price List July 2026".
// Key = model/SKU (uppercase, spaces stripped).  Value = USD discount cost.
// This is the COST TO US; retail = cost × FRAME_MARKUP (×3).
//
// Source: CAPRI_Prices.pdf (Brett Bowman, OD — Acct# BBOCA).
// Maintained by hand when Capri sends an updated list.

const CAPRI_PRICES = {
  // ── Di Caprio  DC198–DC256  ($79.99 book → $16.99 discount) ──────────
  DC198: 16.99, DC205: 16.99, DC210: 16.99, DC211: 16.99, DC214: 16.99,
  DC215: 16.99, DC216: 16.99, DC217: 16.99, DC218: 16.99, DC219: 16.99,
  DC220: 16.99, DC222: 16.99, DC223: 16.99, DC224: 16.99, DC225: 16.99,
  DC226: 16.99, DC227: 16.99, DC228: 16.99, DC230: 16.99, DC231: 16.99,
  DC232: 16.99, DC233: 16.99, DC234: 16.99, DC235: 16.99, DC236: 16.99,
  DC237: 16.99, DC238: 16.99, DC239: 16.99, DC240: 16.99, DC241: 16.99,
  DC242: 16.99, DC243: 16.99, DC244: 16.99, DC245: 16.99, DC246: 16.99,
  DC247: 16.99, DC248: 16.99, DC249: 16.99, DC250: 16.99, DC251: 16.99,
  DC252: 16.99, DC253: 16.99, DC254: 16.99, DC255: 16.99, DC256: 16.99,

  // ── Di Caprio  DC308–DC409  ($89.99 book → $20.99 discount) ──────────
  DC308: 20.99, DC327: 20.99, DC329: 20.99, DC330: 20.99, DC335: 20.99,
  DC336: 20.99, DC341: 20.99, DC345: 20.99, DC346: 20.99, DC348: 20.99,
  DC350: 20.99, DC352: 20.99, DC353: 20.99, DC354: 20.99, DC355: 20.99,
  DC360: 20.99, DC361: 20.99, DC362: 20.99, DC363: 20.99, DC365: 20.99,
  DC367: 20.99, DC368: 20.99, DC369: 20.99, DC370: 20.99, DC371: 20.99,
  DC372: 20.99, DC373: 20.99, DC374: 20.99, DC375: 20.99, DC376: 20.99,
  DC378: 20.99, DC379: 20.99, DC380: 20.99, DC381: 20.99, DC382: 20.99,
  DC383: 20.99, DC384: 20.99, DC385: 20.99, DC386: 20.99, DC387: 20.99,
  DC388: 20.99, DC389: 20.99, DC390: 20.99, DC391: 20.99, DC392: 20.99,
  DC393: 20.99, DC394: 20.99, DC395: 20.99, DC396: 20.99, DC397: 20.99,
  DC398: 20.99, DC399: 20.99,
  // CLIP variants
  "DC400CLIP": 20.99, "DC401CLIP": 20.99, "DC403CLIP": 20.99,
  DC404: 20.99, DC405: 20.99, DC406: 20.99, DC407: 20.99, DC408: 20.99,
  DC409: 20.99,

  // ── Di Caprio  DC502–DC509  ($99.99 book → $25.99 discount) ──────────
  DC502: 25.99, DC503: 25.99, DC504: 25.99, DC506: 25.99,
  DC508: 25.99, DC509: 25.99,

  // ── Flexure  FX3–FX121  ($89.99 book → $16.99 discount) ─────────────
  FX3: 16.99, FX4: 16.99, FX6: 16.99, FX8: 16.99, FX10: 16.99,
  FX101: 16.99, FX103: 16.99, FX104: 16.99, FX107: 16.99, FX110: 16.99,
  FX111: 16.99, FX114: 16.99, FX115: 16.99, FX116: 16.99, FX117: 16.99,
  FX118: 16.99, FX119: 16.99, FX120: 16.99, FX121: 16.99,
  FX19: 16.99, FX20: 16.99, FX22: 16.99, FX27: 16.99, FX28: 16.99,
  FX30: 16.99,

  // ── Millennial  ML1–ML8  ($54.99 book → $6.25 discount) ─────────────
  ML1: 6.25, ML3: 6.25, ML4: 6.25, ML5: 6.25, ML6: 6.25, ML7: 6.25,
  ML8: 6.25,

  // ── Millennial named models  ($55.99 book → $8.50 discount) ─────────
  EXTRA: 8.50, FOMO: 8.50, PETER: 8.50, PERF: 8.50,

  // ── Peachtree  PT48–PT113  ($49.99 book → $3.75 discount) ───────────
  PT48: 3.75, PT55: 3.75, PT56: 3.75, PT61: 3.75, PT68: 3.75, PT69: 3.75,
  PT70: 3.75, PT71: 3.75, PT78: 3.75, PT84: 3.75, PT85: 3.75, PT86: 3.75,
  PT88: 3.75, PT90: 3.75, PT91: 3.75, PT92: 3.75, PT93: 3.75, PT94: 3.75,
  PT95: 3.75, PT96: 3.75, PT97: 3.75, PT98: 3.75, PT99: 3.75,
  PT100: 3.75, PT101: 3.75, PT102: 3.75, PT103: 3.75, PT104: 3.75,
  PT105: 3.75, PT106: 3.75, PT107: 3.75, PT108: 3.75, PT109: 3.75,
  PT110: 3.75, PT111: 3.75, PT112: 3.75, PT113: 3.75,

  // ── Peachtree  PT202–PT215  ($52.99 book → $4.75 discount) ──────────
  PT202: 4.75, PT203: 4.75, PT204: 4.75, PT206: 4.75, PT207: 4.75,
  PT208: 4.75, PT209: 4.75, PT210: 4.75, PT211: 4.75, PT212: 4.75,
  PT213: 4.75, PT214: 4.75, PT215: 4.75,

  // ── Four You  U13–U220  ($49.99 book → $2.99 discount) ──────────────
  U13: 2.99, U14: 2.99, U200: 2.99, U201: 2.99, U202: 2.99, U203: 2.99,
  U204: 2.99, U205: 2.99, U206: 2.99, U207: 2.99, U208: 2.99, U209: 2.99,
  U21: 2.99, U210: 2.99, U211: 2.99, U212: 2.99, U213: 2.99, U214: 2.99,
  U215: 2.99, U216: 2.99, U217: 2.99, U218: 2.99, U219: 2.99, U220: 2.99,
  U23: 2.99, U32: 2.99, U33: 2.99, U34: 2.99, U35: 2.99, U36: 2.99,
  U38: 2.99, U39: 2.99, U40: 2.99, U41: 2.99, U42: 2.99, U47: 2.99,

  // ── Four You  UP303–UP336  ($54.99 book → $4.99 discount) ───────────
  UP303: 4.99, UP305: 4.99, UP306: 4.99, UP307: 4.99, UP308: 4.99,
  UP310: 4.99, UP312: 4.99, UP313: 4.99, UP314: 4.99, UP315: 4.99,
  UP316: 4.99, UP318: 4.99, UP319: 4.99, UP320: 4.99, UP321: 4.99,
  UP322: 4.99, UP323: 4.99, UP324: 4.99, UP325: 4.99, UP326: 4.99,
  UP327: 4.99, UP328: 4.99, UP329: 4.99, UP330: 4.99, UP331: 4.99,
  UP332: 4.99, UP333: 4.99, UP335: 4.99, UP336: 4.99,

  // ── Four You  US53–US135  ($52.99 book → $3.99 discount) ────────────
  US53: 3.99, US54: 3.99, US55: 3.99, US56: 3.99, US58: 3.99, US59: 3.99,
  US60: 3.99, US61: 3.99, US63: 3.99, US68: 3.99, US69: 3.99, US70: 3.99,
  US73: 3.99, US74: 3.99, US75: 3.99, US77: 3.99, US78: 3.99, US80: 3.99,
  US83: 3.99, US84: 3.99, US85: 3.99, US86: 3.99, US88: 3.99,
  US89: 3.99, US90: 3.99, US91: 3.99, US92: 3.99, US93: 3.99, US94: 3.99,
  US95: 3.99, US96: 3.99, US97: 3.99, US98: 3.99, US100: 3.99,
  US102: 3.99, US103: 3.99, US105: 3.99, US106: 3.99, US107: 3.99,
  US108: 3.99, US109: 3.99, US110: 3.99, US111: 3.99, US112: 3.99,
  US114: 3.99, US115: 3.99, US116: 3.99, US117: 3.99, US118: 3.99,
  US119: 3.99, US120: 3.99, US121: 3.99, US122: 3.99, US123: 3.99,
  US124: 3.99, US125: 3.99, US126: 3.99, US127: 3.99, US128: 3.99,
  US129: 3.99, US130: 3.99, US131: 3.99, US132: 3.99, US133: 3.99,
  US134: 3.99, US135: 3.99,

  // ── Trendy  T35–T39  ($54.99 book → $8.50 discount) ─────────────────
  T35: 8.50, T36: 8.50, T37: 8.50, T38: 8.50, T39: 8.50,

  // ── Trendy  TF1–TF6  ($89.99 book → $19.99 discount) ───────────────
  TF1: 19.99, TF2: 19.99, TF3: 19.99, TF4: 19.99, TF5: 19.99, TF6: 19.99,

  // ── Cases / Estuches ─────────────────────────────────────────────────
  "CAPRIO CASE": 0.99, "CASEC-1": 0.98, "CASEC-2": 0.98,
  "CASEC-3": 0.98, "CASEC-6": 0.98, "CASEC-8": 0.98,
  "CASEC-11": 0.98, "CASEC-15": 0.98, "CASEC-20": 0.98,
  "CASEC-24": 0.98, "CASEC-25": 0.98, "CASEC-26": 0.98,
  "CASEKC-3": 0.69, "CASESC-1": 0.49, "CASESC-2W/CLIP": 0.59,
  "CASESC-4": 0.49, "CASESC-5": 0.59, "CASESC-6": 0.44,
  "CASESE-2(20)": 1.49, "CASESE-3": 0.49, "CASESE-4": 0.31,

  // ── Other models (alphabetical from price list) ──────────────────────
  "21102": 19.95, "21186": 19.95, "28017": 19.95, "39061": 19.95,
  "7710": 3.75, "7713": 3.75, "7719": 3.75, "7730": 3.75,
  AG5003: 49.95, AG5010: 49.95, AG5014: 49.95, AG5020: 49.95,
  AG5023: 49.95, AG5026: 49.95, AG5027: 49.95, AG5030: 49.95,
  AG5031: 49.95, AG5032: 49.95,
  AGO1005: 74.95, AGO1006: 74.95, AGO1008: 74.95, AGO1009: 74.95,
  AGO1010: 74.95, AGO1023: 74.95, AGO1024: 74.95, AGO1025: 74.95,
  AGO1026: 74.95, AGO1029: 74.95,
  AGOT700: 95.95, AGOT702: 95.95, AGOT704: 95.95,
  ALAN: 29.99, ALBERT: 29.99, ALEX: 10.50, AMBER: 6.25, ANGEL: 8.50,
  ANGLEFIT: 0.69, "ANGLEFITXL": 0.89,
  ANNA: 6.25,
  ART312: 24.95, ART317: 24.95, ART320: 24.95, ART322: 24.95,
  ART323: 24.95, ART324: 24.95, ART325: 24.95, ART351: 24.95,
  ART413: 29.95, ART415: 29.95, ART417: 29.95, ART418: 29.95,
  ART419: 29.95,
  BERTHA: 29.99,
  CHAT: 6.25, CLAUDETTE: 29.99,
  CO1112: 19.95, CO1113: 19.95, CO1144: 19.95,
  COLLEGE: 6.25,
  CS5134: 19.95, CS88937: 19.95, CS88945: 19.95,
  CS97278: 19.95, CSG018: 19.95, CSG030: 19.95,
  DC50: 16.99, DC72: 16.99, DC86: 16.99, DC97: 16.99,
  DC102: 16.99, DC107: 16.99, DC109: 16.99, DC110: 16.99,
  DC121: 16.99, DC125: 16.99, DC128: 16.99, DC140: 16.99,
  DC143: 16.99, DC158: 16.99, DC170: 16.99, DC179: 16.99,
  DC182: 16.99, DC184: 16.99, DC186: 16.99, DC188: 16.99,
  DC189: 16.99, DC193: 16.99, DC194: 16.99, DC197: 16.99,
  DOWNLOAD: 6.25,
  "ESSIMON": 29.99, EVAN: 8.50,
  "FITOVER684": 7.95, "FITOVER700": 7.95,
  FRASER: 5.25,
  GARY: 8.50, GENIUS: 6.25, GIF: 6.25,
  "GLASSCLEANER2": 0.96, "GLASSCLEANER8": 0.72,
  GOALS: 6.25, GOLDEN: 5.25,
  GR801: 16.99, GR803: 16.99, GR811: 16.99, GR815: 16.99,
  GR817: 16.99, GR818: 16.99, GR820: 16.99, GR821: 16.99,
  GR822: 16.99, GR823: 16.99, GR824: 16.99, GR825: 16.99,
  GR826: 16.99, GR827: 16.99, GR828: 16.99, GR829: 16.99,
  "HALFCOURT": 12.95, HARLEY: 10.50, HARVEY: 29.99,
  "HASHTAG#": 6.25,
  ISAAC: 29.99, JAMES: 8.50, JOYCE: 6.25, JUNIOR: 6.25,
  KLARA: 29.99, LILAC: 3.75, LIT: 6.25, LIU: 29.99, LOL: 6.25,
  MALALA: 29.99, MARSHA: 29.99, MAX: 8.50,
  MB1194: 19.95,
  MF90001: 74.95, MF90007: 74.95, MF90009: 74.95, MF90011: 74.95,
  "MICROFIBERCLO": 0.28,
  "MIRROREDPLZDS": 20.00,
  NUJOOD: 29.99, OLIVE: 3.75, OMG: 6.25, ONLINE: 6.25, PALM: 3.75,
  PAR103: 8.50, PAR105: 8.50, PARTY: 6.25, PEACH: 5.25,
  PF80001: 74.95, PF80007: 74.95,
  "PLAYBALL": 12.95,
  "POLARIZEDARSU": 17.00, "POLARIZEDSUNL": 12.00,
  PROTECH: 12.95,
  PT37: 3.75, PT42: 3.75, PT45: 3.75,
  PUPIL: 6.25,
  RAD: 6.25, READ2: 1.80, RENAISSANCE: 5.25,
  "RIDEPRORX": 14.95,
  ROBERT: 8.50, S1: 2.99, S3: 2.99,
  "SAFETY26": 6.95, "SAFETY65": 6.95,
  SIMON: 8.50,
  SL101: 29.99, SL102: 29.99, SL103: 29.99, SL104: 29.99,
  SL105: 29.99, SL106: 29.99, SL107: 29.99, SL108: 29.99,
  SL109: 29.99, SL110: 29.99, SL111: 29.99, SL112: 29.99,
  SL113: 29.99, SL114: 29.99, SL115: 29.99, SL116: 29.99,
  SL701: 20.99, SL702: 20.99, SL703: 20.99, SL705: 20.99,
  SL706: 20.99, SL707: 20.99,
  SL901: 24.99, SL902: 24.99, SL903: 24.99, SL904: 24.99,
  SL905: 24.99, SL906: 24.99, SL907: 24.99,
  "SLIMFOLD1": 95.00, "SLIMFOLD3": 95.00, "SLIMFOLD5": 105.00,
  "SLIMFOLDCASE1": 39.95,
  "SPECIALC1": 0.75, "SPECIALC15": 0.75, "SPECIALC2": 0.75,
  STORY: 6.25, STUDENT: 6.25, SYLVIA: 29.99,
  T17: 8.50, T23: 8.50, T27: 8.50, T28: 8.50, T29: 8.50,
  T30: 8.50, T31: 8.50, T32: 8.50, T33: 8.50, T34: 8.50,
  TIFFANY: 6.25, TWEET: 6.25,
  UL90: 2.99, UL91: 2.99, UL92: 2.99,
  UM70: 2.99, UM72: 2.99, UM73: 2.99,
  UNIVERSITY: 6.25,
  UPLOAD: 6.25,
  USTP5: 2.99,
  VA6004: 19.95,
  VP106: 7.50, VP111: 7.50, VP113: 7.50, VP126: 7.50, VP131: 8.50,
  VP134: 7.50, VP18: 7.50, VP210: 10.50, VP212: 10.50, VP29: 7.50,
  VS502: 5.25, VS505: 5.25,
  WILLOW: 3.75, WINDSOR: 5.25,
};

// Brand-level fallback tiers for SKUs not explicitly listed.
// Uses the prefix to determine which brand pricing tier to apply.
const BRAND_TIERS = [
  { prefix: "DC",   ranges: [[0, 299, 16.99], [300, 499, 20.99], [500, 999, 25.99]] },
  { prefix: "FX",   default: 16.99 },
  { prefix: "ML",   default: 6.25 },
  { prefix: "PT",   ranges: [[0, 199, 3.75], [200, 299, 4.75]] },
  { prefix: "U",    default: 2.99 },  // U + UL + UM series
  { prefix: "US",   default: 3.99 },
  { prefix: "UP",   default: 4.99 },
  { prefix: "T",    default: 8.50 },  // Trendy T series
  { prefix: "TF",   default: 19.99 }, // Trendy TF series
  { prefix: "GR",   default: 16.99 },
  { prefix: "SL",   ranges: [[100, 199, 29.99], [700, 799, 20.99], [900, 999, 24.99]] },
  { prefix: "ART",  ranges: [[300, 399, 24.95], [400, 499, 29.95]] },
  { prefix: "AGO",  default: 74.95 },
  { prefix: "VP",   default: 7.50 },
  { prefix: "VS",   default: 5.25 },
];

/**
 * Normalize a SKU string into the key format used in CAPRI_PRICES.
 * Strips spaces, uppercases.  "ML 8" → "ML8", "DC 406" → "DC406".
 */
function normSku(sku) {
  return String(sku).toUpperCase().replace(/\s+/g, "");
}

/**
 * Look up the real Capri discount price for a given SKU.
 * Returns the price in USD or `undefined` if the SKU is unknown.
 */
export function capriPrice(sku) {
  const key = normSku(sku);
  if (key in CAPRI_PRICES) return CAPRI_PRICES[key];

  // Brand-tier fallback: extract letter prefix + numeric suffix.
  // Longer prefixes checked first so "US" beats "U", "TF" beats "T", "UP" beats "U".
  const sorted = [...BRAND_TIERS].sort((a, b) => b.prefix.length - a.prefix.length);
  for (const tier of sorted) {
    if (!key.startsWith(tier.prefix)) continue;
    const numPart = key.slice(tier.prefix.length).replace(/[^0-9]/g, "");
    const num = numPart ? parseInt(numPart, 10) : NaN;
    if (tier.ranges && Number.isFinite(num)) {
      for (const [lo, hi, price] of tier.ranges) {
        if (num >= lo && num <= hi) return price;
      }
    }
    if (tier.default != null) return tier.default;
    break;
  }

  return undefined; // unknown SKU — caller decides fallback
}

export default CAPRI_PRICES;
