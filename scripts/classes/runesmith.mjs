/**
 * PF2e Tactics: classes/runesmith.mjs
 * See classes/_common.mjs for the shape of a class read.
 * Reads the runic repertoire (the runes known, from the rune-named items on the sheet or the pf2e-tactics rune flag),
 * the runes already placed (effects on you and your allies, token marks or the flag for runes on foes), Trace Rune and
 * Invoke Rune with every rune's invocation scored on its save against your class DC, Engraving Strike, Remote Detonation,
 * Pattern Flight, Swiping Trace, Engraving Maneuver, Edifying Trace, Fortifying Knock, Terrifying Invocation, Words Fly Free,
 * Transpose Etching, Dance of Bloody Ink, Song of Glorious Invocation, Chain of Words, Vital Compound Invocation, Tracing
 * Trance, the diacritics Ur- and En- (free with Diacritic Fluency or Shades of Meaning), Rune-Singer's one-action range,
 * Drawn in Vital Ink, Distant and Unbounded Invocations, Smithing Weapons and the passives of Esvadir and Marssyl.
 * The PF2e system (8.6.1) ships no rune items: see the "how runes are read" block below. The rest are when-notes.
 */
import { bestStrike, canMove, effect, has, level, moveText, myReach, pct, slugOf, squareToReach, strikeRun, targets, worth, degreeChances, feetBetween, inReach, mapFor, strikeExpected, saveExpected, nameOf, signed } from "./_common.mjs";
import { damageAgainst } from "../reader.mjs";

/** Foundry's slugs drop apostrophes ("artists-attendance"); the catalog's keep a dash ("artist-s-attendance"). Both are tried. */
const hasAny = (actor, ...slugs) => slugs.some((s) => has(actor, s));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const listOf = (a) => (a.length <= 1 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);
const plus2 = (lv) => 1 + Math.floor((lv - 1) / 2); // "Level (+2)": one more die at 3rd, 5th, 7th...
const dieAvg = (n, d) => n * (d + 1) / 2;

/**
 * The rune list (Impossible Magic). usage: what it's drawn on; foe: worth tracing on an enemy; own: worth having on you, an ally
 * or your gear; inv: the invocation. A damage invocation: dice(lv), die, type, save, basic, cond { name, on: "f"|"cf" }.
 * A condition invocation: save, cond, on. The others carry only text and a flat worth.
 */
const RUNES = {
    atryl: { name: "Atryl, Rune of Fire", lv: 1, trad: "primal", usage: "creature", foe: true, passive: (lv) => `its fire resistance drops by ${5 + plus2(lv) - 1}`, inv: { kind: "damage", dice: plus2, die: 8, type: "fire", save: "fortitude", cond: { name: "dazzled", on: "cf" } } },
    baruiel: { name: "Baruiel, Rune of Hold's Bravery", lv: 1, trad: "magical", usage: "willing", own: true, passive: () => "near an ally, its frightened drops by 2 a round", inv: { kind: "text", text: "allies within 10 feet of the bearer reduce their frightened by 2", worth: 1 } },
    camonica: { name: "Camonica, Rune of Perplexity", lv: 1, trad: "occult", usage: "creature", foe: true, passive: (lv) => `${1 + plus2(lv)} mental damage the first time each round it uses a concentrate action`, inv: { kind: "damage", dice: plus2, die: 4, type: "mental", save: "will", cond: { name: "stupefied", on: "f" } } },
    esvadir: { name: "Esvadir, Rune of Whetstones", lv: 1, trad: "magical", usage: "weapon-ps", own: true, passive: () => "+2 persistent bleed per weapon die on its Strikes", inv: { kind: "damage", dice: plus2, die: 8, type: "slashing", save: "reflex", adjacent: true } },
    holtrik: { name: "Holtrik, Rune of Dwarven Ramparts", lv: 1, trad: "magical", usage: "shield", own: true, passive: () => "+1 status bonus to AC while the shield is raised", inv: { kind: "text", text: "the shield is raised as if by Raise a Shield, until the bearer's next turn", worth: 2.5 } },
    ledria: { name: "Ledria, Rune of Appeal", lv: 1, trad: "occult", usage: "creature", own: true, passive: (lv) => `+${lv >= 17 ? 3 : lv >= 9 ? 2 : 1} status to Deception, Diplomacy and Performance`, inv: { kind: "text", text: "each creature within 30 feet may Step toward the bearer", worth: 0.5 } },
    lyskel: { name: "Lyskel, Rune of Frost", lv: 1, trad: "primal", usage: "creature", foe: true, passive: () => "-5 feet to its Speeds, and clumsy 1 after it moves", inv: { kind: "damage", dice: plus2, die: 4, type: "cold", save: "fortitude", extra: 1, extraText: "snow makes its square and the ones around it difficult terrain for a round" } },
    marssyl: { name: "Marssyl, Rune of Impact", lv: 1, trad: "magical", usage: "weapon-b", own: true, passive: () => "1 bludgeoning splash per weapon die on its Strikes", inv: { kind: "weapon", text: "the next hit with it before the end of its wielder's next turn deals an extra weapon die, and the target is pushed 10 feet on a failed Fortitude save" } },
    oljinex: { name: "Oljinex, Rune of Cowards' Bane", lv: 1, trad: "arcane", usage: "shield", own: true, passive: (lv) => `+${2 + Math.floor((lv - 1) / 4)} Hardness against ranged physical damage`, inv: { kind: "text", text: "creatures adjacent to the bearer can't willingly move away from it for a round (an illusion; a Seek disbelieves it)", worth: 2 } },
    pluuna: { name: "Pluuna, Rune of Illumination", lv: 1, trad: "magical", usage: "creature", foe: true, own: true, passive: () => "bright light in 20 feet, -1 to Stealth inside it", inv: { kind: "condition", save: "fortitude", cond: "dazzled", area: 20, areaText: "every creature in its light" } },
    ranshu: { name: "Ranshu, Rune of Thunder", lv: 1, trad: "primal", usage: "creature", foe: true, passive: (lv) => `${3 + plus2(lv) - 1} electricity damage on any turn it doesn't move`, inv: { kind: "damage", dice: plus2, die: 8, type: "electricity", save: "fortitude" } },
    rehgog: { name: "Rehgog, Rune of Bestial Might", lv: 1, trad: "primal", usage: "willing", own: true, passive: () => "imprecise scent 30 feet", inv: { kind: "text", text: "the bearer Steps for free and its next unarmed Strike before your next turn deals an extra die", worth: 2.5 } },
    sertum: { name: "Sertum, Rune of Preparedness", lv: 1, trad: "primal", usage: "creature", own: true, passive: (lv) => `+${lv >= 17 ? 3 : lv >= 9 ? 2 : 1} status to Survival, and initiative with it`, inv: { kind: "text", text: "the bearer Steps up to three times for free", worth: 2 } },
    thullax: { name: "Thullax, Rune of Corrosion", lv: 1, trad: "arcane", usage: "creature", foe: true, passive: (lv) => `its physical resistances drop by ${plus2(lv)}`, inv: { kind: "damage", dice: plus2, die: 6, type: "acid", save: "fortitude", cfPersistent: (lv) => plus2(lv) } },
    tilus: { name: "Tilus, Rune of Vocabulary", lv: 1, trad: "arcane", usage: "creature", own: true, passive: () => "a language, and a status bonus to Society", inv: { kind: "text", text: "the bearer auto-succeeds at flat checks against auditory actions for a round", worth: 0.5 } },
    zohk: { name: "Zohk, Rune of Homecoming", lv: 1, trad: "arcane", usage: "creature", foe: true, own: true, passive: () => "+15 feet Speed when moving toward you", inv: { kind: "condition", save: "will", cond: "pulled", worthFlat: 2.5, text: "it's teleported to a square adjacent to you (Will negates for an unwilling bearer); an ally comes for free" } },
    // diacritics (5th, 13th)
    av: { name: "Av-, Diacritic Rune of Succession", lv: 5, diacritic: true, text: "when the base rune is invoked, Invoke one more Rune on another bearer within 15 feet for free" },
    en: { name: "En-, Diacritic Rune of Expansion", lv: 5, diacritic: true, text: "the base rune's invocation also hits every other creature within 15 feet of the bearer" },
    fob: { name: "Fob-, Diacritic Rune of Doubling", lv: 5, diacritic: true, text: "you too are affected by the invocation of a rune that deals no damage" },
    kit: { name: "Kit-, Diacritic Rune of Mercy", lv: 5, diacritic: true, text: "the invocation is nonlethal and the bearer takes -1 to its save" },
    per: { name: "Per-, Diacritic Rune of Continuum", lv: 5, diacritic: true, text: "after the invocation the base rune traces itself on another target within 15 feet" },
    sun: { name: "Sun-, Diacritic Rune of Preservation", lv: 5, diacritic: true, text: "after the invocation the base rune traces itself back on the same target" },
    ti: { name: "Ti-, Diacritic Rune of Fundaments", lv: 5, diacritic: true, text: "the invocation's acid, cold, electricity or fire becomes any of the four" },
    ur: { name: "Ur-, Diacritic Rune of Intensity", lv: 5, diacritic: true, text: "the invocation gets a status bonus to damage of 2 plus half your level" },
    eck: { name: "Eck-, Diacritic Rune of Phantasma", lv: 13, diacritic: true, text: "the invocation's damage becomes spirit, and your enemies adjacent to the bearer take persistent spirit damage" },
    inth: { name: "Inth-, Diacritic Rune of Corruption", lv: 13, diacritic: true, text: "the rune is unholy (a holy bearer is enfeebled 2) and the invocation adds persistent fire" },
    nesh: { name: "Nesh-, Diacritic Rune of Contingency", lv: 13, diacritic: true, text: "the base rune invokes itself as a reaction on a trigger you set" },
    sar: { name: "Sar-, Diacritic Rune of Righteousness", lv: 13, diacritic: true, text: "the rune is holy (an unholy bearer is enfeebled 2) and the invocation drains the target 1" },
    // 9th
    astillu: { name: "Astillu, Rune of Submersion", lv: 9, trad: "magical", usage: "creature", own: true, passive: () => "water breathing and a swim Speed", inv: { kind: "text", text: "the bearer Swims 60 feet for free without triggering reactions", worth: 1 } },
    cruonign: { name: "Cruonign, Rune of Leeching", lv: 9, trad: "magical", usage: "weapon-ps", own: true, passive: () => "+3 void on its Strikes, and temporary HP for the void dealt", inv: { kind: "damage", dice: () => 4, die: 10, type: "void", save: "fortitude", cone: 30, healSelf: 12 } },
    feikris: { name: "Feikris, Rune of Gravity", lv: 9, trad: "arcane", usage: "creature", own: true, passive: (lv) => `+${lv >= 17 ? 3 : 2} status to Athletics, and maneuvers against bigger foes`, inv: { kind: "condition", save: "fortitude", cond: "pulled", worthFlat: 1.5, area: 15, areaText: "every creature within 15 feet of the bearer", text: "pulled 5 feet toward the bearer (10 on a critical failure)" } },
    germantria: { name: "Germantria, Rune of Partnership", lv: 9, trad: "magical", usage: "creature", own: true, passive: () => "it takes half damage and you take the rest", inv: { kind: "heal", amount: (lv) => 20 + 5 * Math.floor((lv - 9) / 2), both: true } },
    ichelsu: { name: "Ichelsu, Rune of Observation", lv: 9, trad: "occult", usage: "creature", own: true, passive: () => "see the unseen and all-around vision (no flanking it)", inv: { kind: "text", text: "for 2 rounds, invisible creatures within 20 feet are only concealed and concealed ones aren't", worth: 1.5 } },
    jurroz: { name: "Jurroz, Rune of Dragon Fury", lv: 9, trad: "magical", usage: "creature", own: true, passive: () => "an enemy that Strikes the bearer is off-guard for a round", inv: { kind: "text", text: "the bearer Flies 60 feet to an enemy that hurt it in the last minute, which is off-guard to it until the end of its next turn", worth: 3 } },
    kojastri: { name: "Kojastri, Rune of Insulation", lv: 9, trad: "arcane", usage: "armor", own: true, passive: (lv) => `resistance ${4 + Math.floor((lv - 9) / 2)} to one energy type, and ${2 + Math.floor((lv - 9) / 2)} of it to whatever touches the bearer`, inv: { kind: "text", text: "whatever has the bearer grabbed, restrained, engulfed or swallowed takes 8d4 (and more by level) of the rune's energy, basic Reflex, and lets go on a failure", worth: 0 } },
    oraloq: { name: "Oraloq, Rune of Inarticulateness", lv: 9, trad: "magical", usage: "creature", foe: true, passive: () => "a DC 5 flat check on its linguistic actions and non-subtle spells", inv: { kind: "damage", dice: () => 0, die: 0, flat: (lv) => 20 + 5 * Math.floor((lv - 9) / 2), type: "mental", save: "will", basic: false, conditional: 0.6, extraText: "when it next speaks, casts or uses a linguistic action before the end of its next turn" } },
    piteregrin: { name: "Piteregrin, Rune of Transposition", lv: 9, trad: "magical", usage: "creature", own: true, passive: () => "it can swap places with another willing rune-bearer within 15 feet for 1 action", inv: { kind: "text", text: "the bearer and each Large or smaller creature adjacent to it reappear in squares you choose within 15 feet (Will negates for unwilling ones)", worth: 2 } },
    trolistri: { name: "Trolistri, Rune of Forlorn Sorrow", lv: 9, trad: "arcane", usage: "creature", own: true, passive: () => "enemies within 20 feet treat the ground between them and the bearer as difficult terrain", inv: { kind: "condition", save: "will", cond: "slowed", area: 15, areaText: "every enemy within 15 feet of the bearer", text: "slowed 1 for a round (slowed 2 on a critical failure), then immune for an hour" } },
    ulgatus: { name: "Ulgatus, Rune of Restraint", lv: 9, trad: "magical", usage: "armor", own: true, passive: (lv) => `a DC ${lv >= 17 ? 10 : 15} flat check to shrug off drained, enfeebled or sickened`, inv: { kind: "text", text: "resistance 10 (20 at 17th) to critical hits for a minute", worth: 2 } },
    yudici: { name: "Yudici, Rune of Remonstrance", lv: 9, trad: "divine", usage: "shield", own: true, passive: () => "allies within 10 feet get +1 AC while the shield is raised", inv: { kind: "text", text: `the shield regains Hit Points and allies within 10 feet get +1 status to attacks and skills for a round`, worth: 2 } },
    // 17th
    aiuen: { name: "Aiuen, The Elf-Gate Key", lv: 17, trad: "arcane", usage: "creature", own: true, foe: true, passive: () => "once a turn its Stride can be a teleport of its Speed", inv: { kind: "condition", save: "will", cond: "pulled", worthFlat: 3, text: "the bearer is teleported next to any of your other runes (up to 60 feet, Will negates, if unwilling)" } },
    ochygholl: { name: "Ochygholl, The Poisoned Star", lv: 17, trad: "magical", usage: "creature", foe: true, passive: () => "doomed 1, as are allies that start their turn next to it, and 10 mental damage the first time each round it attacks or rolls a skill check", inv: { kind: "damage", dice: () => 8, die: 6, type: "fire", save: "reflex", extraDice: { n: 3, die: 10, type: "bludgeoning", radius: 10 }, burst: 40 } },
    rovan: { name: "Rovan, Seal of the Dead Vault", lv: 17, trad: "divine", usage: "creature", foe: true, passive: () => "-20 feet to its land Speed and -40 to the others", inv: { kind: "condition", save: "fortitude", cond: "slowed", successToo: true, cfCond: "restrained", text: "slowed 1 for a round on a success, slowed 2 on a failure, trapped in earth (restrained, blinded, slowed 2, petrified in 3 rounds) on a critical failure; incapacitation" } },
    xinsala: { name: "Xinsala, The Well of Virtues", lv: 17, trad: "magical", usage: "square", own: true, passive: () => "you and your allies within 30 feet get +1 AC and saves against magic and resistance 10 to magical damage", inv: { kind: "heal", amount: () => 70, split: true, text: "and you and your allies in the area are quickened (Stride or Strike) for a round with +20 feet Speed" } },
};
const RUNE_KEYS = Object.keys(RUNES);
/** A rune named in an item's name or slug: "atryl", "Atryl, Rune of Fire", "effect-rune-atryl", "ur-diacritic-rune-of-intensity". */
function runeIn(text) {
    const t = String(text ?? "").toLowerCase();
    for (const k of RUNE_KEYS) {
        const r = RUNES[k];
        if (r.diacritic ? /rune|diacritic/.test(t) && (new RegExp(`(^|[^a-z])${k}-`).test(t) || t.includes(r.name.split(", ")[1].toLowerCase()) || t.includes(r.name.split(", ")[1].toLowerCase().replace(/ /g, "-"))) : new RegExp(`(^|[^a-z])${k}([^a-z]|$)`).test(t)) return k;
    }
    return null;
}
/** The flag a player or macro may set: actor.flags["pf2e-tactics"].runes = { known: [...], tattoo, on: { self|<ally or token id or name>: [ "atryl" | { rune, etched, on } ] } }. */
const runeFlag = (actor) => actor?.flags?.["pf2e-tactics"]?.runes ?? null;

function runesmith(board, ctx, out) {
    const actor = board.me.actor;
    const me = board.me;
    const lv = level(board);
    const cls = actor?.class?.slug ?? (actor?.class?.name ?? "").toLowerCase();
    const isClass = cls === "runesmith" || has(actor, "runic-repertoire") || has(actor, "runes");
    const dedication = !isClass && has(actor, "runesmith-dedication");
    if (!isClass && !dedication) return;
    const fl = runeFlag(actor);
    const classDC = Number(actor?.classDC?.value ?? actor?.system?.attributes?.classDC?.value) || 10 + lv + 4;
    const foes = targets(board);
    const items = actor?.items ?? [];
    const flagged = (fl?.known ?? []).map(runeIn).filter(Boolean);
    const known = new Set([...flagged, ...items.filter((i) => !["effect", "condition"].includes(i.type) && (["feat", "action"].includes(i.type) || (i.system?.traits?.value ?? []).includes("rune"))).map((i) => runeIn(i.name) ?? runeIn(slugOf(i))).filter(Boolean)]);
    const know = (k) => known.has(k);
    const canTrace = isClass || has(actor, "trace-rune") || has(actor, "tracing-studies");
    const invokeMax = isClass || has(actor, "invoke-rune") ? (has(actor, "unbounded-invocations") ? 99 : 2) : 1; // Solitary Invocation for the archetype
    const invRange = 30 + (has(actor, "distant-invocation") ? 30 : 0);
    const trance = effect(actor, /tracing-trance/);
    const noInvoke = !!trance; // Tracing Trance: no invocation actions this turn
    const singer = has(actor, "generational-rune-singer") ? "at-will" : has(actor, "prodigal-rune-singer") ? "round" : has(actor, "rune-singer") ? "10min" : null;
    const singerItem = items.find((i) => slugOf(i) === "rune-singer");
    const singerLeft = singer === "at-will" || singer === "round" || (singer === "10min" && (singerItem?.system?.frequency?.value ?? 1) > 0);
    const singRange = singer === "at-will" ? 60 : 30;
    const vitalInk = has(actor, "drawn-in-vital-ink") && effect(actor, /drawn-in-vital-ink/);
    const fluency = has(actor, "diacritic-fluency") && (items.find((i) => slugOf(i) === "diacritic-fluency")?.system?.frequency?.value ?? 1) > 0;
    const shades = has(actor, "shades-of-meaning");
    const freeDiacritic = shades || fluency;
    const urBonus = know("ur") ? 2 + Math.floor(lv / 2) : 0;
    const melee = board.strikes.filter((s) => !s.ranged);
    const weaponDice = (s) => (Number(s.item?.system?.damage?.dice) || 1) + (Number(s.item?.system?.runes?.striking) || 0);
    const weaponGroup = (s) => s.item?.system?.group ?? s.group ?? null;
    const ammoStrike = board.strikes.filter((s) => s.ranged && !s.thrown && (s.reload >= 0) && !(s.traits ?? []).includes("thrown"));
    const push = (plan) => out.plans.push({ kind: "class", dest: null, notes: [], ...plan, score: plan.ev + (plan.bias ?? 0.4) });
    const tattooKey = (() => { const f = fl?.tattoo ? runeIn(fl.tattoo) : null; if (f) return f; const it = items.find((i) => /tattoo/.test(slugOf(i)) && (runeIn(i.name) ?? runeIn(slugOf(i)))); return it ? (runeIn(it.name) ?? runeIn(slugOf(it))) : null; })();
    const tattooFaded = !!effect(actor, /tattoo.*(faded|drained|spent)/);

    // ---- runes already placed: on you and your gear (effects), on allies (their effects), on foes (token marks or the flag)
    const placed = []; // { key, r, etched, holder: "self"|"ally"|"foe", who (creature), on: "creature"|"weapon"|"shield"|"armor"|"square" }
    const slotOf = (r, text) => (/weapon|blade|sword|axe|hammer|spear|bow/.test(text) ? "weapon" : /shield/.test(text) ? "shield" : /armor|armour/.test(text) ? "armor" : r.usage.startsWith("weapon") ? "weapon" : r.usage === "shield" ? "shield" : r.usage === "armor" ? "armor" : r.usage === "square" ? "square" : "creature");
    const addPlaced = (holder, who, k, text, etched) => { const r = RUNES[k]; if (!r || r.diacritic) return; placed.push({ key: k, r, etched, holder, who, on: slotOf(r, String(text).toLowerCase()) }); };
    for (const i of items) if (["effect", "condition"].includes(i.type)) { const k = runeIn(i.name) ?? runeIn(slugOf(i)); if (k) addPlaced("self", me, k, `${i.name} ${slugOf(i)}`, /etch|tattoo/.test(`${i.name} ${slugOf(i)}`.toLowerCase())); }
    for (const a of board.allies) for (const i of a.actor?.items ?? []) if (["effect", "condition"].includes(i.type)) { const k = runeIn(i.name) ?? runeIn(slugOf(i)); if (k) addPlaced("ally", a, k, `${i.name} ${slugOf(i)}`, /etch|tattoo/.test(`${i.name} ${slugOf(i)}`.toLowerCase())); }
    const marks = actor?.synthetics?.tokenMarks;
    if (marks?.entries) for (const [uuid, slugs] of marks.entries()) {
        const id = String(uuid).split(".").pop();
        const f = foes.find((e) => e.id === id || e.tokenId === id);
        if (!f) continue;
        for (const s of Array.isArray(slugs) ? slugs : [slugs]) { const k = runeIn(s); if (k && /rune/.test(String(s))) addPlaced("foe", f, k, s, /etch/.test(String(s))); }
    }
    for (const [whoKey, list] of Object.entries(fl?.on ?? {})) {
        const entries = (Array.isArray(list) ? list : [list]).map((e) => (typeof e === "string" ? { rune: e } : e)).filter((e) => e && e.rune);
        const who = whoKey === "self" || whoKey === "me" ? me : board.allies.find((a) => a.id === whoKey || a.name === whoKey) ?? foes.find((e) => e.id === whoKey || e.name === whoKey);
        if (!who) continue;
        const holder = who === me ? "self" : board.allies.includes(who) ? "ally" : "foe";
        for (const e of entries) { const k = runeIn(e.rune); if (k) addPlaced(holder, who, k, `${e.rune} ${e.on ?? ""}`, !!e.etched); }
    }
    if (tattooKey && !tattooFaded && !placed.some((p) => p.holder === "self" && p.key === tattooKey)) addPlaced("self", me, tattooKey, "tattoo", true);
    const runesOn = (c) => placed.filter((p) => p.who === c);
    const bears = (c) => runesOn(c).length > 0;
    const etchedMax = isClass ? (lv >= 17 ? 6 : lv >= 13 ? 5 : lv >= 9 ? 4 : lv >= 5 ? 3 : 2) : (lv >= 17 ? 3 : lv >= 9 ? 2 : 1);

    // ---- what one invocation is worth against a foe f bearing rune r (bearer-centred areas: the others within reach of it)
    const saveOf = (f, s) => Number(f.saves?.[s]) || 8;
    const friends = [me, ...board.allies];
    const edify = effect(actor, /edifying-trace/) ? 1 : 0; // -1 status to saves against your invocations on that target
    function invokeOn(r, f, { bonus = 0, pen = 0, en = false } = {}) {
        const inv = r.inv;
        if (!inv) return { ev: 0, own: 0, text: "", affected: [] };
        if (inv.kind === "damage") {
            const avg = dieAvg(inv.dice(lv), inv.die) + (inv.flat?.(lv) ?? 0) + bonus;
            const one = (t) => {
                const dmg = damageAgainst(t.iwr, [inv.type]);
                const e = saveExpected(saveOf(t, inv.save) - pen - edify, classDC, avg, { basic: inv.basic !== false, delta: dmg.delta, immune: dmg.immune });
                let ev = e.expected * (inv.conditional ?? 1);
                if (inv.cond) ev += worth(board, inv.cond.name) * (inv.cond.on === "cf" ? e.critFail : e.fail);
                if (inv.cfPersistent) ev += e.critFail * inv.cfPersistent(lv) * 2;
                if (inv.extra) ev += inv.extra;
                if (inv.extraDice && !inv.extraDice.radius) ev += saveExpected(saveOf(t, inv.save) - pen - edify, classDC, dieAvg(inv.extraDice.n, inv.extraDice.die), { basic: true }).expected;
                return { ev, e };
            };
            const main = one(f);
            let ev = main.ev;
            const others = [], caught = [];
            // bearer-centred areas catch your side too: each friend inside costs about 0.6 x the average (it rolls its own save)
            if (inv.extraDice?.radius) { for (const t of foes.filter((x) => feetBetween(f.rect, x.rect) <= inv.extraDice.radius)) ev += saveExpected(saveOf(t, inv.save), classDC, dieAvg(inv.extraDice.n, inv.extraDice.die), { basic: true }).expected; for (const a of friends.filter((x) => feetBetween(f.rect, x.rect) <= inv.extraDice.radius)) { ev -= 0.6 * dieAvg(inv.extraDice.n, inv.extraDice.die); caught.push(a); } }
            if (inv.burst) { for (const t of foes.filter((x) => x !== f && feetBetween(f.rect, x.rect) <= inv.burst)) { ev += one(t).ev; others.push(t); } for (const a of friends.filter((x) => feetBetween(f.rect, x.rect) <= inv.burst)) { ev -= 0.6 * avg; if (!caught.includes(a)) caught.push(a); } }
            if (en) { if (friends.some((x) => feetBetween(f.rect, x.rect) <= 15)) return null; for (const t of foes.filter((x) => x !== f && feetBetween(f.rect, x.rect) <= 15)) { ev += one(t).ev; others.push(t); } }
            const diceText = inv.dice(lv) ? `${inv.dice(lv)}d${inv.die}${bonus ? `+${bonus}` : ""}` : `${inv.flat(lv) + bonus}`;
            const text = `${diceText} ${inv.type}, ${inv.basic === false ? "" : "basic "}${cap(inv.save)} DC ${classDC} (about ${pct(main.e.fail)} to fail)${inv.cond ? `, ${inv.cond.name} on a ${inv.cond.on === "cf" ? "critical failure" : "failure"}` : ""}${inv.extraText ? `; ${inv.extraText}` : ""}${others.length ? `; ${others.map(nameOf).join(", ")} too` : ""}${caught.length ? ` (and ${caught.map((c) => (c === me ? "you" : nameOf(c))).join(", ")} in it)` : ""}`;
            return { ev, own: main.ev, text, hit: main.e.fail, affected: [f, ...others] };
        }
        if (inv.kind === "condition") {
            const list = inv.area ? foes.filter((x) => feetBetween(f.rect, x.rect) <= inv.area || x === f) : [f];
            let ev = 0, p0 = 0;
            for (const t of list) {
                const c = degreeChances(saveOf(t, inv.save) - pen - edify, classDC);
                const p = c.f + c.cf + (inv.successToo ? c.s : 0);
                ev += (inv.worthFlat ?? worth(board, inv.cond)) * p + (inv.cfCond ? worth(board, inv.cfCond) * c.cf : 0);
                if (t === f) p0 = p;
            }
            return { ev, own: ev, text: `${inv.areaText ?? nameOf(f)}: ${inv.text ?? `${inv.cond} for a round`}, ${cap(inv.save)} DC ${classDC} (about ${pct(p0)})`, hit: p0, affected: list };
        }
        return { ev: inv.worth ?? 0, own: inv.worth ?? 0, text: inv.text, hit: 1, affected: [f] };
    }
    /** Worth of invoking a rune placed on you, an ally or your gear (weapon runes, shield runes, heals, buffs). */
    function invokeOwn(p) {
        const r = p.r, inv = r.inv;
        if (!inv) return null;
        if (inv.kind === "damage" && inv.adjacent) { // Esvadir: a creature adjacent to the bearer
            const near = foes.filter((f) => inReach(p.who.rect, f.rect, 5)).map((f) => ({ f, ...invokeOn(r, f) })).sort((a, b) => b.ev - a.ev)[0];
            return near ? { ev: near.ev, text: `${r.name.split(",")[0]} on ${p.on === "weapon" ? "your weapon" : nameOf(p.who)}: ${nameOf(near.f)} takes ${near.text}`, target: near.f } : null;
        }
        if (inv.kind === "damage" && inv.cone) { // Cruonign: a cone from the wielder
            const inCone = foes.filter((f) => feetBetween(p.who.rect, f.rect) <= inv.cone);
            if (!inCone.length) return null;
            const best = inCone.map((c) => { const dx = Math.sign(c.rect.x - p.who.rect.x), dy = Math.sign(c.rect.y - p.who.rect.y); const side = (x) => x !== p.who && feetBetween(p.who.rect, x.rect) <= inv.cone && Math.sign(x.rect.x - p.who.rect.x) * dx >= 0 && Math.sign(x.rect.y - p.who.rect.y) * dy >= 0; const hit = inCone.filter(side); return { hit, ev: hit.reduce((s, f) => s + invokeOn(r, f).ev, 0) - 0.6 * dieAvg(4, 10) * friends.filter(side).length }; }).sort((a, b) => b.ev - a.ev)[0];
            if (best.ev <= 0) return null;
            const heal = Math.min(inv.healSelf, Math.max(0, (p.who.maxHp ?? 0) - (p.who.hp ?? 0))) * 0.8;
            return { ev: best.ev + heal, text: `Cruonign on ${p.on === "weapon" ? "your weapon" : nameOf(p.who)}: a 30-foot cone of 4d10 void, basic Fortitude DC ${classDC}, at ${best.hit.map(nameOf).join(", ")}; the wielder regains 12 HP if any take damage`, target: best.hit[0] };
        }
        if (inv.kind === "weapon") { // Marssyl: the next hit this turn
            const s = melee.sort((a, b) => b.avg - a.avg)[0];
            const f = foes.filter((x) => inReach(me.rect, x.rect, s?.reach || 5)).sort((a, b) => a.ac - b.ac)[0];
            if (!s || !f || p.holder !== "self") return null;
            const b = bestStrike(board, f, { made: ctx.made });
            if (!b) return null;
            const die = Number(String(s.item?.system?.damage?.die ?? "d8").replace("d", "")) || 8;
            return { ev: b.e.hit * ((die + 1) / 2 + 1), text: `Marssyl on your weapon: your next hit before the end of your next turn deals an extra d${die} and pushes the target 10 feet (Fortitude DC ${classDC})`, target: f, before: true };
        }
        if (inv.kind === "heal") {
            const hurt = [me, ...board.allies].filter((c) => inv.split || feetBetween(p.who.rect, c.rect) <= 30 || c === p.who).map((c) => ({ c, missing: Math.max(0, (c.maxHp ?? 0) - (c.hp ?? 0)) })).sort((a, b) => b.missing - a.missing);
            const amt = inv.amount(lv);
            const healed = inv.both ? Math.min(amt, hurt.find((h) => h.c === p.who)?.missing ?? 0) + Math.min(amt, hurt.find((h) => h.c === me)?.missing ?? 0) : inv.split ? Math.min(amt, hurt.reduce((s, h) => s + h.missing, 0)) : Math.min(amt, hurt[0]?.missing ?? 0);
            if (healed < 5) return null;
            return { ev: 0.8 * healed, text: `${r.name.split(",")[0]}: ${inv.both ? `you and ${nameOf(p.who)} each regain ${amt} HP` : `${amt} HP split among those in the well`}${inv.text ? ` ${inv.text}` : ""}` };
        }
        if (p.key === "holtrik") return me.shield && !me.shieldRaised && p.holder === "self" ? { ev: 2.5 + 1, text: "Holtrik on your shield: it's raised as if by Raise a Shield (+1 status to AC on top) until your next turn" } : null;
        if (p.key === "jurroz" || p.key === "zohk" || p.key === "sertum" || p.key === "rehgog") return p.holder === "self" || p.holder === "ally" ? { ev: inv.worth * 0.6, text: `${r.name.split(",")[0]} on ${nameOf(p.who)}: ${inv.text}` } : null;
        if (inv.kind === "condition" && inv.area) { // Trolistri, Feikris on an ally or you: the enemies around the bearer
            const list = foes.filter((x) => feetBetween(p.who.rect, x.rect) <= inv.area);
            if (!list.length) return null;
            let ev = 0;
            for (const t of list) { const c = degreeChances(saveOf(t, inv.save), classDC); ev += (inv.worthFlat ?? worth(board, inv.cond)) * (c.f + c.cf); }
            return { ev, text: `${r.name.split(",")[0]} on ${nameOf(p.who)}: ${list.map(nameOf).join(", ")} ${inv.text}, ${cap(inv.save)} DC ${classDC}` };
        }
        return inv.worth ? { ev: inv.worth * 0.5, text: `${r.name.split(",")[0]} on ${nameOf(p.who)}: ${inv.text}` } : null;
    }

    // ---- the runes to trace on a foe, best first, with the diacritic that pays
    const hostile = RUNE_KEYS.filter((k) => know(k) && RUNES[k].foe && RUNES[k].inv);
    function bestTraceOn(f, { exclude = [], freeDia = freeDiacritic } = {}) {
        let best = null;
        for (const k of hostile) {
            if (exclude.includes(k)) continue;
            const r = RUNES[k];
            const plain = invokeOn(r, f);
            let pick = { key: k, r, ...plain, dia: null };
            if (freeDia && r.inv.kind === "damage") {
                if (urBonus) { const u = invokeOn(r, f, { bonus: urBonus }); if (u.ev > pick.ev) pick = { key: k, r, ...u, dia: "ur" }; }
                if (know("en")) { const e = invokeOn(r, f, { en: true }); if (e && e.ev > pick.ev) pick = { key: k, r, ...e, dia: "en" }; }
            }
            if (!best || pick.ev > best.ev) best = pick;
        }
        return best;
    }
    const diaText = (d) => (d === "ur" ? ` with Ur- (+${urBonus} damage${shades ? ", Shades of Meaning" : ", Diacritic Fluency"})` : d === "en" ? ` with En- (everyone within 15 feet of it too${shades ? ", Shades of Meaning" : ", Diacritic Fluency"})` : "");
    /** How to get a rune onto f: { cost, text } for the cheapest way, or null. */
    function traceWay(f, { at = me.rect, actions = ctx.actions } = {}) {
        if (!canTrace) return null;
        const d = feetBetween(at, f.rect);
        if (inReach(at, f.rect, 5)) return { cost: 1, how: has(actor, "edifying-trace") ? "Edifying Trace" : "Trace", adjacent: true };
        if (vitalInk && d <= 60) return { cost: 1, how: "Trace (Drawn in Vital Ink, 60 feet)" };
        if (singerLeft && d <= singRange) return { cost: 1, how: `Trace by song (Rune-Singer${singer === "10min" ? ", your one this 10 minutes" : ""})` };
        if (d <= 30 && actions >= 2) return { cost: 2, how: "Trace (2 actions, within 30 feet)" };
        return null;
    }
    const edifyText = (w) => (w.adjacent && has(actor, "edifying-trace") ? " and Recall Knowledge about it (a success: -1 to its saves against your invocations for a minute)" : "");
    const invokeWord = invokeMax === 1 ? "Solitary Invocation" : "Invoke Rune";

    // ---- notes on the repertoire and the runes up
    if (known.size) out.notes.push(`Runes you know: ${[...known].map((k) => RUNES[k].name.split(",")[0]).join(", ")}${isClass ? ` (${etchedMax} etched at a time)` : ` (${etchedMax} etched, ${invokeWord} invokes one)`}.`);
    else out.notes.push(`No rune items found on your sheet: add your runes as feats or actions named after them (Atryl, Rune of Fire...) or set the pf2e-tactics rune flag, and traced or etched runes as effects (Effect: Rune (Atryl), Etched Rune: Esvadir) so the plans can read them.`);
    for (const p of placed) out.notes.push(`${p.etched ? "Etched" : "Traced"}: ${p.r.name.split(",")[0]} on ${p.holder === "self" ? (p.on === "creature" ? "you" : `your ${p.on}`) : nameOf(p.who)}${p.holder === "foe" ? "" : ` (${p.r.passive(lv)})`}${p.etched ? "" : "; a traced rune lasts until the end of your next turn"}.`);
    if (noInvoke) out.notes.push("Tracing Trance: you're quickened this turn for Trace Rune only, and you can't invoke anything until your next turn.");

    // ---- plans
    const foeRunes = placed.filter((p) => p.holder === "foe" && feetBetween(me.rect, p.who.rect) <= invRange);
    const ownInv = placed.filter((p) => p.holder !== "foe" && feetBetween(me.rect, p.who.rect) <= invRange).map((p) => ({ p, ...(invokeOwn(p) ?? { ev: -1 }) })).filter((x) => x.ev > 0);

    // A. Invoke what's already up (1 action): the best runes, up to the limit, then Strikes with what's left
    if (!noInvoke && ctx.actions >= 1 && (foeRunes.length || ownInv.length)) {
        const cands = [...foeRunes.map((p) => ({ p, ...invokeOn(p.r, p.who), target: p.who })), ...ownInv.filter((c) => c.ev >= 2)].filter((c) => c.ev > 0).sort((a, b) => b.ev - a.ev);
        const take = cands.slice(0, invokeMax);
        if (take.length) {
            const ev = take.reduce((s, c) => s + c.ev, 0);
            const target = take.find((c) => c.target)?.target ?? foes[0] ?? null;
            const steps = [{ cost: 1, text: `${invokeWord}: ${take.map((c) => c.target && c.p.holder === "foe" ? `${c.p.r.name.split(",")[0]} on ${nameOf(c.target)} (${c.text})` : c.text).join("; ")}` }];
            let tot = ev;
            const f = target && foes.includes(target) ? target : null;
            if (f && ctx.actions > 1) {
                const sq = squareToReach(board, f, myReach(board), ctx.actions - 2);
                const extra = has(actor, "smithing-weapons") && bears(f) && ["hammer", "knife", "pick"].includes(weaponGroup(bestStrike(board, f)?.s)) ? 1 : 0;
                if (sq) {
                    const left = ctx.actions - 1 - sq.route.actions;
                    if (sq.route.actions) steps.push({ cost: sq.route.actions, text: moveText(sq, f) });
                    const r = strikeRun(board, f, left, { made: ctx.made, extra });
                    if (r.used.length) { steps.push({ cost: r.used.length, text: r.text }); tot += r.ev; }
                }
            }
            const spent = take.filter((c) => c.p.etched).map((c) => c.p.r.name.split(",")[0]);
            push({ title: `Invoke ${listOf(take.map((c) => c.p.r.name.split(",")[0]))}`, target, ev: tot, steps, notes: spent.length ? [`${spent.join(" and ")} ${spent.length > 1 ? "are" : "is"} etched: invoked, ${spent.length > 1 ? "they're" : "it's"} gone until you etch again (10 minutes out of combat${tattooKey && spent.includes(RUNES[tattooKey].name.split(",")[0]) ? "; the tattoo only comes back with your daily preparations" : ""}).`] : [] });
            if (cands.length > invokeMax && has(actor, "song-of-glorious-invocation") && (items.find((i) => slugOf(i) === "song-of-glorious-invocation")?.system?.frequency?.value ?? 1) > 0) {
                const bearers = [...new Set(cands.filter((c) => c.target).map((c) => c.target))].slice(0, 3);
                const picks = bearers.map((b) => cands.find((c) => c.target === b));
                if (picks.length >= 2) push({ title: `Song of Glorious Invocation on ${picks.length} rune-bearers`, target: picks[0].target, ev: picks.reduce((s, c) => s + c.ev, 0), bias: 0.3, steps: [{ cost: 1, text: `Song of Glorious Invocation: one rune on each of ${picks.map((c) => `${nameOf(c.target)} (${c.p.r.name.split(",")[0]}: ${c.text})`).join(", ")}` }], notes: ["Once per 10 minutes; the bearers also get +1 to skills and saves against fear for a minute."] });
            }
        }
    }

    // B. Trace then Invoke on a foe: one rune (1+1, or 2+1 at range) or two different runes on it (1+1+1), or one rune on each of two adjacent foes
    if (!noInvoke && canTrace && hostile.length && ctx.actions >= 2) {
        const cands = [];
        for (const f of foes) {
            const w = traceWay(f);
            const pick = bestTraceOn(f);
            if (!pick || pick.ev <= 0) continue;
            if (w && w.cost + 1 <= ctx.actions) {
                const steps = [{ cost: w.cost, text: `${w.how} ${pick.r.name.split(",")[0]} on ${nameOf(f)}${diaText(pick.dia)}${edifyText(w)}` }, { cost: 1, text: `${invokeWord}: ${pick.r.name.split(",")[0]} on ${nameOf(f)}: ${pick.text}` }];
                let ev = pick.ev, dest = null;
                const left = ctx.actions - w.cost - 1;
                let title = `Trace ${pick.r.name.split(",")[0]} on ${nameOf(f)}, then invoke it`;
                if (left >= 1 && w.adjacent) {
                    const second = bestTraceOn(f, { exclude: [pick.key], freeDia: shades });
                    const run = strikeRun(board, f, left, { made: ctx.made, extra: has(actor, "smithing-weapons") && melee.some((s) => ["hammer", "knife", "pick"].includes(weaponGroup(s))) ? 1 : 0 });
                    if (second && second.ev > 0 && invokeMax >= 2 && second.ev >= run.ev) {
                        steps.splice(1, 0, { cost: 1, text: `Trace ${second.r.name.split(",")[0]} on ${nameOf(f)} too${diaText(second.dia)}` });
                        steps[2].text = `${invokeWord}: both runes on ${nameOf(f)}: ${pick.r.name.split(",")[0]} (${pick.text}); ${second.r.name.split(",")[0]} (${second.text})`;
                        ev += second.ev; title = `Trace ${pick.r.name.split(",")[0]} and ${second.r.name.split(",")[0]} on ${nameOf(f)}, then invoke both`;
                    } else if (run.used.length) { steps.push({ cost: run.used.length, text: run.text }); ev += run.ev; }
                } else if (left >= 1) { // traced at range: a Strike only once in reach (closing first if the actions allow)
                    const sq = squareToReach(board, f, myReach(board), left - 1);
                    const l2 = sq ? left - sq.route.actions : 0;
                    const run = l2 >= 1 ? strikeRun(board, f, l2, { made: ctx.made }) : { used: [], ev: 0, text: "" };
                    if (run.used.length) { if (sq.route.actions) steps.push({ cost: sq.route.actions, text: moveText(sq, f) }); steps.push({ cost: run.used.length, text: run.text }); ev += run.ev; dest = sq.route.actions ? { x: sq.x, y: sq.y } : null; }
                }
                cands.push({ title, target: f, ev, steps, dest });
            } else if (!w && canMove(me) && ctx.actions >= 3) { // Stride into reach, Trace (1), Invoke (1)
                const sq = squareToReach(board, f, 5, 1);
                if (sq && sq.route.actions === 1) cands.push({ title: `Close on ${nameOf(f)}, Trace ${pick.r.name.split(",")[0]} and invoke it`, target: f, ev: pick.ev, dest: { x: sq.x, y: sq.y }, steps: [{ cost: 1, text: moveText(sq, f) }, { cost: 1, text: `Trace ${pick.r.name.split(",")[0]} on ${nameOf(f)}${diaText(pick.dia)}` }, { cost: 1, text: `${invokeWord}: ${pick.text}` }] });
            }
        }
        // two adjacent foes, a rune each, one invocation
        if (ctx.actions >= 3 && invokeMax >= 2) {
            const adj = foes.filter((f) => inReach(me.rect, f.rect, 5)).map((f) => ({ f, pick: bestTraceOn(f) })).filter((x) => x.pick && x.pick.ev > 0).sort((a, b) => b.pick.ev - a.pick.ev);
            if (adj.length >= 2) {
                const a = adj[0];
                let b = { f: adj[1].f, pick: bestTraceOn(adj[1].f, { freeDia: shades }) };
                // the same rune twice affects each creature once: the second copy only adds what the first's area missed
                const same = b.pick && b.pick.key === a.pick.key && a.pick.affected.includes(b.f);
                if (same) { const alt = bestTraceOn(b.f, { exclude: [a.pick.key], freeDia: shades }); b = alt ? { f: b.f, pick: alt } : null; }
                if (b?.pick) cands.push({ title: `Trace a rune on ${nameOf(a.f)} and ${nameOf(b.f)}, then invoke both`, target: a.f, ev: a.pick.ev + b.pick.ev, steps: [{ cost: 1, text: `Trace ${a.pick.r.name.split(",")[0]} on ${nameOf(a.f)}${diaText(a.pick.dia)}` }, { cost: 1, text: `Trace ${b.pick.r.name.split(",")[0]} on ${nameOf(b.f)}${diaText(b.pick.dia)}` }, { cost: 1, text: `${invokeWord}: ${nameOf(a.f)} (${a.pick.r.name.split(",")[0]}: ${a.pick.text}); ${nameOf(b.f)} (${b.pick.r.name.split(",")[0]}: ${b.pick.text})` }] });
            }
        }
        cands.sort((a, b) => b.ev - a.ev);
        for (const c of cands.slice(0, 3)) push({ ...c, notes: c.notes ?? ["A traced rune lasts until the end of your next turn; one you don't invoke now can wait a turn."] });
    }

    // C. Engraving Strike (1 action, flourish): a melee Strike that traces a rune on a hit; then invoke, then the rest
    if (!noInvoke && has(actor, "engraving-strike") && hostile.length && melee.length && ctx.actions >= 2) {
        let best = null;
        for (const f of foes) {
            const sq = squareToReach(board, f, myReach(board), ctx.actions - 2);
            if (!sq) continue;
            const left = ctx.actions - sq.route.actions;
            if (left < 2) continue;
            const already = runesOn(f).filter((p) => p.r.inv);
            const b = bestStrike(board, f, { made: ctx.made, extra: has(actor, "smithing-weapons") && already.length && ["hammer", "knife", "pick"].includes(weaponGroup(bestStrike(board, f)?.s)) ? 1 : 0 });
            if (!b) continue;
            const pick = bestTraceOn(f, { exclude: already.map((p) => p.key) });
            if (!pick) continue;
            const alsoUp = already.map((p) => ({ p, ...invokeOn(p.r, f) })).sort((x, y) => y.ev - x.ev).slice(0, Math.max(0, invokeMax - 1));
            const ev0 = b.e.expected + b.e.hit * pick.ev + alsoUp.reduce((s, x) => s + x.ev, 0);
            const steps = [];
            if (sq.route.actions) steps.push({ cost: sq.route.actions, text: moveText(sq, f) });
            steps.push({ cost: 1, text: `Engraving Strike ${nameOf(f)} with ${b.s.label} (${signed(b.bonus)}, about ${pct(b.e.hit)}): a hit traces ${pick.r.name.split(",")[0]} on it${diaText(pick.dia)}` });
            steps.push({ cost: 1, text: `${invokeWord}: ${pick.r.name.split(",")[0]} on ${nameOf(f)} (${pick.text})${alsoUp.length ? `; and ${alsoUp.map((x) => `${x.p.r.name.split(",")[0]} (${x.text})`).join("; ")}` : ""}` });
            let ev = ev0;
            if (left >= 3) { const r = strikeRun(board, f, left - 2, { made: ctx.made + 1 }); if (r.used.length) { steps.push({ cost: r.used.length, text: r.text }); ev += r.ev; } }
            if (!best || ev > best.ev) best = { title: `Engraving Strike ${nameOf(f)}, then invoke`, target: f, ev, steps, dest: sq.route.actions ? { x: sq.x, y: sq.y } : null, notes: ["If the Strike misses, nothing is traced: Trace it by hand instead of invoking, or Strike again."] };
        }
        if (best) push(best);
    }

    // D. Remote Detonation (1 action, flourish): a ranged Strike with ammunition in the first increment; a hit invokes up to two runes on the target
    if (!noInvoke && has(actor, "remote-detonation") && ammoStrike.length && ctx.actions >= 1) {
        let best = null;
        for (const f of foes) {
            const s = ammoStrike.filter((x) => feetBetween(me.rect, f.rect) <= (x.range ?? 30)).sort((a, b) => b.avg - a.avg)[0];
            if (!s) continue;
            const up = runesOn(f).filter((p) => p.r.inv).map((p) => ({ p, ...invokeOn(p.r, f) })).sort((x, y) => y.ev - x.ev);
            const steps = [];
            const made = ctx.made;
            let cost = 0;
            let runes = up.slice(0, 2);
            if (!runes.length && hostile.length && canTrace) {
                const w = traceWay(f, { actions: ctx.actions - 1 });
                if (!w || w.cost + 1 > ctx.actions) continue;
                const pick = bestTraceOn(f);
                if (!pick) continue;
                steps.push({ cost: w.cost, text: `${w.how} ${pick.r.name.split(",")[0]} on ${nameOf(f)}${diaText(pick.dia)}` });
                cost += w.cost; runes = [{ p: { r: pick.r, key: pick.key }, ...pick }];
            }
            if (!runes.length) continue;
            const b = s.bonus + mapFor(made, s.agile);
            const e = strikeExpected(b, f.ac, s.avg, { deadly: s.deadly });
            const inv = runes.reduce((t, x) => t + x.ev, 0);
            const ev = e.expected + e.hit * inv + e.crit * 0.05 * inv;
            steps.push({ cost: 1, text: `Remote Detonation: ${s.label} at ${nameOf(f)} (${signed(b)}, about ${pct(e.hit)}); a hit invokes ${runes.map((x) => `${x.p.r.name.split(",")[0]} (${x.text})`).join(" and ")}; a critical hit gives it -1 to the saves` });
            cost += 1;
            let tot = ev;
            if (ctx.actions - cost >= 1) { const r = strikeRun(board, f, ctx.actions - cost, { made: made + 1, melee: false }); if (r.used.length) { steps.push({ cost: r.used.length, text: r.text }); tot += r.ev; } }
            if (!best || tot > best.ev) best = { title: `Remote Detonation on ${nameOf(f)}`, target: f, ev: tot, steps, notes: ["A miss invokes nothing: the runes stay on it until the end of your next turn."] };
        }
        if (best) push(best);
    }

    // E. Pattern Flight (2 actions, flourish): a ranged Strike in the first increment that ignores cover, then a Trace on the target (or one in line)
    if (has(actor, "pattern-flight") && ammoStrike.length && hostile.length && ctx.actions >= 2) {
        let best = null;
        for (const f of foes) {
            const s = ammoStrike.filter((x) => feetBetween(me.rect, f.rect) <= (x.range ?? 30)).sort((a, b) => b.avg - a.avg)[0];
            if (!s) continue;
            const b = s.bonus + mapFor(ctx.made, s.agile);
            const e = strikeExpected(b, f.ac, s.avg, { deadly: s.deadly });
            const pick = bestTraceOn(f);
            if (!pick) continue;
            const invokeNow = !noInvoke && ctx.actions >= 3;
            const ev = e.expected + (invokeNow ? pick.ev : 0.6 * pick.ev);
            const steps = [{ cost: 2, text: `Pattern Flight: ${s.label} at ${nameOf(f)} (${signed(b)}, ignoring its cover), then Trace ${pick.r.name.split(",")[0]} on it${diaText(pick.dia)}` }];
            if (invokeNow) steps.push({ cost: 1, text: `${invokeWord}: ${pick.r.name.split(",")[0]} on ${nameOf(f)} (${pick.text})` });
            if (!best || ev > best.ev) best = { title: `Pattern Flight at ${nameOf(f)}`, target: f, ev, bias: 0.3, steps, notes: invokeNow ? [] : ["The rune waits on it until the end of your next turn: invoke it then."] };
        }
        if (best) push(best);
    }

    // F. Swiping Trace (3 actions, flourish): one melee Strike compared to two foes in reach, the same rune traced on each hit; invoke next turn
    if (has(actor, "swiping-trace") && hostile.length && melee.length && ctx.actions === 3) {
        const s = melee.sort((a, b) => b.avg - a.avg)[0];
        const near = foes.filter((f) => inReach(me.rect, f.rect, s.reach || 5));
        if (near.length >= 2) {
            const pair = near.map((f) => ({ f, pick: bestTraceOn(f) })).filter((x) => x.pick).sort((a, b) => b.pick.ev - a.pick.ev).slice(0, 2);
            if (pair.length === 2) {
                const key = pair[0].pick.key;
                const b = s.bonus + mapFor(ctx.made, s.agile) + ((s.traits ?? []).includes("sweep") ? 1 : 0);
                let ev = 0;
                for (const x of pair) { const e = strikeExpected(b, x.f.ac, s.avg, { deadly: s.deadly }); ev += e.expected + 0.6 * e.hit * invokeOn(RUNES[key], x.f).ev; }
                push({ title: `Swiping Trace on ${pair.map((x) => nameOf(x.f)).join(" and ")}`, target: pair[0].f, ev, bias: 0.2, steps: [{ cost: 3, text: `Swiping Trace with ${s.label} (${signed(b)}) against ${pair.map((x) => nameOf(x.f)).join(" and ")}, one damage roll; ${RUNES[key].name.split(",")[0]} is traced on each one hit` }], notes: ["Counts as two attacks; the runes are invoked next turn (they last until its end)."] });
            }
        }
    }

    // G. Engraving Maneuver (1 action, flourish): Trip, Shove or Disarm with a weapon that has the trait; a success traces a rune
    if (has(actor, "engraving-maneuver") && hostile.length && ctx.actions >= 1) {
        const w = melee.find((s) => (s.traits ?? []).includes("trip")) ?? melee.find((s) => (s.traits ?? []).includes("shove"));
        const athletics = me.athletics ?? actor?.skills?.athletics?.mod ?? null;
        if (w && athletics != null) {
            const kind = (w.traits ?? []).includes("trip") ? "Trip" : "Shove";
            let best = null;
            for (const f of foes.filter((x) => inReach(me.rect, x.rect, w.reach || 5) && !(kind === "Trip" && x.conditions?.has?.("prone")))) {
                const dc = 10 + saveOf(f, kind === "Trip" ? "reflex" : "fortitude");
                const c = degreeChances(athletics + mapFor(ctx.made, false), dc);
                const pick = bestTraceOn(f);
                if (!pick) continue;
                const p = c.s + c.cs;
                const invokeNow = !noInvoke && ctx.actions >= 2;
                const ev = (kind === "Trip" ? worth(board, "prone") * p + c.cs * 2 : 1.5 * p) + p * (invokeNow ? pick.ev : 0.6 * pick.ev);
                const steps = [{ cost: 1, text: `Engraving Maneuver: ${kind} ${nameOf(f)} with ${w.label} (Athletics ${signed(athletics + mapFor(ctx.made, false))} vs DC ${dc}, about ${pct(p)}); a success traces ${pick.r.name.split(",")[0]} on it` }];
                if (invokeNow) steps.push({ cost: 1, text: `${invokeWord}: ${pick.r.name.split(",")[0]} on ${nameOf(f)} (${pick.text})` });
                if (!best || ev > best.ev) best = { title: `Engraving Maneuver: ${kind} ${nameOf(f)}`, target: f, ev, bias: 0.3, steps, notes: ["The maneuver counts toward your multiple attack penalty."] };
            }
            if (best) push(best);
        }
    }

    // H. Transpose Etching (1 action): move an etched damaging rune from you, an ally or an object onto a foe within 30 feet, then invoke it
    if (!noInvoke && has(actor, "transpose-etching") && ctx.actions >= 2) {
        const movable = placed.filter((p) => p.holder !== "foe" && p.r.foe && p.r.inv && !(p.holder === "self" && p.key === tattooKey) && feetBetween(me.rect, p.who.rect) <= 30);
        let best = null;
        for (const p of movable) for (const f of foes.filter((x) => feetBetween(me.rect, x.rect) <= 30)) {
            const v = invokeOn(p.r, f);
            if (!best || v.ev > best.ev) best = { p, f, ...v };
        }
        if (best && best.ev > 0) push({ title: `Transpose ${best.p.r.name.split(",")[0]} onto ${nameOf(best.f)}, then invoke`, target: best.f, ev: best.ev, bias: 0.3, steps: [{ cost: 1, text: `Transpose Etching: move ${best.p.r.name.split(",")[0]} from ${best.p.holder === "self" ? "you" : nameOf(best.p.who)} onto ${nameOf(best.f)}` }, { cost: 1, text: `${invokeWord}: ${best.p.r.name.split(",")[0]} on ${nameOf(best.f)} (${best.text})` }], notes: best.p.etched ? [`${best.p.r.name.split(",")[0]} is etched: no Trace needed, but once invoked it's gone until you etch again.`] : [] });
    }

    // I. Words, Fly Free (1 action): the tattoo rune traced on every matching target in a 15-foot cone, then invoked
    if (!noInvoke && hasAny(actor, "words-fly-free", "words,-fly-free") && tattooKey && RUNES[tattooKey].foe && RUNES[tattooKey].inv && !tattooFaded && ctx.actions >= 2) {
        const r = RUNES[tattooKey];
        const near = foes.filter((f) => feetBetween(me.rect, f.rect) <= 15);
        if (near.length) {
            const best = near.map((c) => { const dx = Math.sign(c.rect.x - me.rect.x), dy = Math.sign(c.rect.y - me.rect.y); const hit = near.filter((f) => Math.sign(f.rect.x - me.rect.x) * dx >= 0 && Math.sign(f.rect.y - me.rect.y) * dy >= 0); return hit; }).sort((a, b) => b.length - a.length)[0];
            const vals = best.map((f) => ({ f, ...invokeOn(r, f) })).sort((a, b) => b.ev - a.ev).slice(0, invokeMax);
            const ev = vals.reduce((s, x) => s + x.ev, 0);
            if (ev > 0) push({ title: `Words, Fly Free: ${r.name.split(",")[0]} on ${best.length} foe${best.length > 1 ? "s" : ""}, then invoke`, target: vals[0].f, ev, bias: 0.3, steps: [{ cost: 1, text: `Words, Fly Free: your tattooed ${r.name.split(",")[0]} is traced on ${best.map(nameOf).join(", ")} (a 15-foot cone)` }, { cost: 1, text: `${invokeWord}: ${vals.map((x) => `${nameOf(x.f)} (${x.text})`).join("; ")}${best.length > vals.length ? `; the other${best.length - vals.length > 1 ? "s" : ""} next turn` : ""}` }], notes: ["Your tattoo is then faded until your daily preparations."] });
        }
    }

    // J. Fortifying Knock (1 action, flourish): Raise a Shield and Trace a Rune on it (Holtrik's +1 AC; Runic Reprisal buries a damaging rune for the Shield Block)
    if (has(actor, "fortifying-knock") && canTrace && me.shield && !me.shieldRaised && ctx.actions >= 1) {
        const shieldRune = ["holtrik", "yudici", "oljinex"].find((k) => know(k) && !placed.some((p) => p.holder === "self" && p.key === k));
        const nearest = foes.slice().sort((a, b) => feetBetween(me.rect, a.rect) - feetBetween(me.rect, b.rect))[0];
        const reprisal = has(actor, "runic-reprisal") && nearest ? hostile.filter((k) => RUNES[k].inv.kind === "damage").map((k) => ({ k, ev: invokeOn(RUNES[k], nearest).ev })).sort((a, b) => b.ev - a.ev)[0] : null;
        if (shieldRune || reprisal) {
            const useRep = reprisal && (!shieldRune || reprisal.ev * 0.5 > 1);
            const ev = 2.5 + (useRep ? 0.5 * reprisal.ev : shieldRune === "holtrik" ? 1 : shieldRune === "yudici" ? 0.5 * board.allies.filter((a) => feetBetween(me.rect, a.rect) <= 10).length : 0.5);
            push({ title: "Fortifying Knock", target: foes[0] ?? null, ev, bias: 0.3, steps: [{ cost: 1, text: useRep ? `Fortifying Knock: Raise a Shield and bury ${RUNES[reprisal.k].name.split(",")[0]} in it (Runic Reprisal): a Shield Block against a melee Strike invokes it on the attacker` : `Fortifying Knock: Raise a Shield and Trace ${RUNES[shieldRune].name.split(",")[0]} on it (${RUNES[shieldRune].passive(lv)})` }], notes: ["A flourish: not in the same turn as Engraving Strike or Swiping Trace."] });
        }
    }

    // K. Terrifying Invocation (1 action): Demoralize a rune-bearer within 30 feet and invoke one rune on it
    if (!noInvoke && has(actor, "terrifying-invocation") && me.intimidation != null && ctx.actions >= 1) {
        let best = null;
        for (const p of foeRunes.filter((x) => x.r.inv && feetBetween(me.rect, x.who.rect) <= 30)) {
            const f = p.who;
            const v = invokeOn(p.r, f);
            const c = degreeChances(me.intimidation, 10 + saveOf(f, "will"));
            const fear = f.conditions?.has?.("frightened") ? 0 : worth(board, "frightened") * (c.s + c.cs) + worth(board, "frightened") * c.cs;
            const ev = v.ev + fear;
            if (!best || ev > best.ev) best = { p, f, v, c, ev, fear };
        }
        if (best) push({ title: `Terrifying Invocation on ${nameOf(best.f)}`, target: best.f, ev: best.ev, bias: 0.3, steps: [{ cost: 1, text: `Terrifying Invocation: Demoralize ${nameOf(best.f)} (Intimidation ${signed(me.intimidation)} vs Will DC ${10 + saveOf(best.f, "will")}, about ${pct(best.c.s + best.c.cs)}${best.fear ? "" : ", it's already frightened"}; no language penalty) and invoke ${best.p.r.name.split(",")[0]} on it (${best.v.text})` }] });
    }

    // L. Dance of Bloody Ink (3 actions): invoke the rune on your weapon, Strike, Step, Strike; the second hit traces a rune
    if (!noInvoke && has(actor, "dance-of-bloody-ink") && ctx.actions === 3 && melee.length) {
        const wr = placed.find((p) => p.holder === "self" && p.on === "weapon" && p.r.inv);
        if (wr) {
            let best = null;
            for (const f of foes.filter((x) => inReach(me.rect, x.rect, myReach(board)))) {
                const own = invokeOwn(wr);
                const b = bestStrike(board, f, { made: ctx.made });
                if (!b) continue;
                const die = Number(String(b.s.item?.system?.damage?.die ?? "d8").replace("d", "")) || 8;
                const extra = wr.key === "marssyl" ? (die + 1) / 2 : 0;
                const e1 = strikeExpected(b.bonus, f.ac, b.s.avg + extra, { deadly: b.s.deadly });
                const e2 = strikeExpected(b.bonus, f.ac, b.s.avg, { deadly: b.s.deadly }); // the penalty climbs only after both
                const pick = bestTraceOn(f);
                const ev = (own && wr.key !== "marssyl" ? own.ev : 0) + e1.expected + e2.expected + (pick ? 0.6 * e2.hit * pick.ev : 0);
                if (!best || ev > best.ev) best = { f, ev, text: `Dance of Bloody Ink: invoke ${wr.r.name.split(",")[0]} on ${b.s.label}${own ? ` (${own.text})` : ""}, Strike ${nameOf(f)} (${signed(b.bonus)}), Step, Strike again at the same bonus${pick ? `; the second hit traces ${pick.r.name.split(",")[0]} on it` : ""}` };
            }
            if (best) push({ title: `Dance of Bloody Ink on ${nameOf(best.f)}`, target: best.f, ev: best.ev, bias: 0.3, steps: [{ cost: 3, text: best.text }], notes: [wr.etched ? `${wr.r.name.split(",")[0]} is etched on the weapon: invoking it spends it until you etch again.` : "Both attacks count toward your penalty only after they're made."] });
        }
    }

    // M. Chain of Words (2 actions, once per 10 minutes): invoke two runes within 60 feet; a line of force between the bearers
    if (!noInvoke && has(actor, "chain-of-words") && ctx.actions >= 2 && (items.find((i) => slugOf(i) === "chain-of-words")?.system?.frequency?.value ?? 1) > 0) {
        const all = placed.filter((p) => p.r.inv && feetBetween(me.rect, p.who.rect) <= 60);
        const dice = Math.max(5, Math.floor(lv / 2));
        let best = null;
        for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
            const a = all[i], b = all[j];
            if (a.who === b.who) continue;
            const ax = a.who.rect.x, ay = a.who.rect.y, bx = b.who.rect.x, by = b.who.rect.y;
            const near = (f) => { const t = Math.max(0, Math.min(1, ((f.rect.x - ax) * (bx - ax) + (f.rect.y - ay) * (by - ay)) / Math.max(1, (bx - ax) ** 2 + (by - ay) ** 2))); return Math.hypot(f.rect.x - (ax + t * (bx - ax)), f.rect.y - (ay + t * (by - ay))) <= 0.75; };
            const line = foes.filter((f) => f !== a.who && f !== b.who && near(f));
            const evA = a.holder === "foe" ? invokeOn(a.r, a.who).ev : invokeOwn(a)?.ev ?? 0;
            const evB = b.holder === "foe" ? invokeOn(b.r, b.who).ev : invokeOwn(b)?.ev ?? 0;
            let ev = evA + evB;
            for (const f of line) { const e = saveExpected(saveOf(f, "reflex"), classDC, dieAvg(dice, 6), { basic: true, ...damageAgainst(f.iwr, ["force"]) }); ev += e.expected + worth(board, "immobilized") * e.critFail; }
            if (!best || ev > best.ev) best = { a, b, line, ev };
        }
        if (best && best.line.length) push({ title: `Chain of Words between ${nameOf(best.a.who)} and ${nameOf(best.b.who)}`, target: best.line[0], ev: best.ev, bias: 0.3, steps: [{ cost: 2, text: `Chain of Words: invoke ${best.a.r.name.split(",")[0]} on ${nameOf(best.a.who)} and ${best.b.r.name.split(",")[0]} on ${nameOf(best.b.who)}; ${best.line.map(nameOf).join(", ")} in the line between them take ${dice}d6 force, basic Reflex DC ${classDC} (immobilized on a critical failure)` }], notes: ["Once per 10 minutes."] });
    }

    // N. Vital Compound Invocation (1 action): one divine and one primal rune invoked; a creature within 30 feet of both regains 5 + 2 x level
    if (!noInvoke && has(actor, "vital-compound-invocation") && ctx.actions >= 1) {
        const trad = (p) => p.r.trad;
        const div = placed.filter((p) => trad(p) === "divine"), pri = placed.filter((p) => trad(p) === "primal");
        const heal = 5 + 2 * lv;
        let best = null;
        for (const a of div) for (const b of pri) {
            const hurt = [me, ...board.allies].filter((c) => feetBetween(c.rect, a.who.rect) <= 30 && feetBetween(c.rect, b.who.rect) <= 30).map((c) => ({ c, m: Math.max(0, (c.maxHp ?? 0) - (c.hp ?? 0)) })).sort((x, y) => y.m - x.m)[0];
            const evA = a.holder === "foe" ? invokeOn(a.r, a.who).ev : invokeOwn(a)?.ev ?? 0;
            const evB = b.holder === "foe" ? invokeOn(b.r, b.who).ev : invokeOwn(b)?.ev ?? 0;
            const ev = evA + evB + 0.8 * Math.min(heal, hurt?.m ?? 0);
            if (!best || ev > best.ev) best = { a, b, hurt, ev };
        }
        if (best && best.hurt?.m >= 5) push({ title: `Vital Compound Invocation: heal ${nameOf(best.hurt.c)}`, target: best.a.holder === "foe" ? best.a.who : foes[0] ?? null, ev: best.ev, bias: 0.3, steps: [{ cost: 1, text: `Vital Compound Invocation: invoke ${best.a.r.name.split(",")[0]} (divine) on ${nameOf(best.a.who)} and ${best.b.r.name.split(",")[0]} (primal) on ${nameOf(best.b.who)}; ${nameOf(best.hurt.c)} regains ${heal} HP` }] });
        else if (!div.length || !pri.length) out.notes.push(`Vital Compound Invocation (1 action) needs a divine and a primal rune up at once (a magical rune can be drawn as either if you're trained in the skill): it heals ${heal} HP to one creature near both.`);
    }
    if (has(actor, "clashing-compound-invocation")) out.notes.push("Clashing Compound Invocation (1 action): invoke an arcane rune with a divine one, or an occult with a primal, and a creature within 30 feet of both must save or be sickened 1 (2 on a critical failure).");
    if (has(actor, "astral-compound-invocation")) out.notes.push("Astral Compound Invocation (1 action): invoke an arcane rune with an occult one and a creature within 30 feet of both must save or be stupefied 1 to 3 until the end of your next turn.");
    if (has(actor, "annihilating-compound-invocation")) out.notes.push(`Annihilating Compound Invocation (1 action): four runes up, one of each tradition, and a creature within 30 feet of all four takes 10d4 force, basic Fortitude DC ${classDC}; a creature dropped to 0 HP by it or the runes is destroyed.`);

    // O. Tracing Trance (free, at the start of your turn): a setup turn of four Traces and no invocation
    if (has(actor, "tracing-trance") && !trance && canTrace && hostile.length && ctx.made === 0 && ctx.actions === 3) {
        const todo = [];
        let left = 4;
        for (const f of foes.sort((a, b) => feetBetween(me.rect, a.rect) - feetBetween(me.rect, b.rect))) {
            const w = traceWay(f, { actions: left });
            const pick = bestTraceOn(f, { exclude: runesOn(f).map((p) => p.key), freeDia: todo.length ? shades : freeDiacritic });
            if (!w || !pick || w.cost > left) continue;
            if (todo.length && w.how === "Edifying Trace") w.how = "Trace"; // one flourish a turn
            todo.push({ f, w, pick }); left -= w.cost;
            if (left <= 0) break;
        }
        if (todo.length >= 2) {
            const ev = 0.7 * todo.reduce((s, t) => s + t.pick.ev, 0);
            push({ title: `Tracing Trance: set ${todo.length} runes for next turn`, target: todo[0].f, ev, bias: 0.1, steps: [{ cost: 0, text: "Tracing Trance (free, at the start of your turn): quickened for Trace Rune, no invocations this turn" }, ...todo.map((t) => ({ cost: t.w.cost, text: `${t.w.how} ${t.pick.r.name.split(",")[0]} on ${nameOf(t.f)}${diaText(t.pick.dia)}` }))], notes: [`Next turn one ${invokeWord} sets off ${Math.min(invokeMax, todo.length)} of them; the value here is discounted for the wait.`] });
        }
    }

    // ---- marks and strike math from runes up
    for (const p of placed.filter((x) => x.holder === "self" && x.on === "weapon")) {
        if (p.key === "esvadir") for (const s of melee) if (!s.esvadir && (s.damageTypes ?? []).some((t) => ["piercing", "slashing"].includes(t))) { s.esvadir = true; s.avg += 2 * weaponDice(s); out.notes.push(`Esvadir on your ${s.label}: +${2 * weaponDice(s)} persistent bleed on each hit (counted once in the plans).`); }
        if (p.key === "cruonign") for (const s of melee) if (!s.cruonign) { s.cruonign = true; s.avg += 3; }
    }
    for (const p of placed.filter((x) => x.key === "jurroz" && x.holder !== "foe")) out.notes.push(`Jurroz on ${p.holder === "self" ? "you" : nameOf(p.who)}: any enemy that Strikes ${p.holder === "self" ? "you" : "them"} is off-guard for a round afterward.`);
    if (has(actor, "smithing-weapons") && melee.some((s) => ["hammer", "knife", "pick"].includes(weaponGroup(s)))) out.notes.push("Smithing Weapons: your hammer, knife or pick deals +1 fire to a foe bearing one of your runes, and etches without a toolkit.");

    // ---- when-notes
    if (singer) out.notes.push(`Rune-Singer: Trace a Rune at ${singRange} feet for one action by singing${singer === "at-will" ? ", at will" : singer === "round" ? ", once a round" : `, once per 10 minutes${singerLeft ? "" : " (used)"}`}; no hands and no manipulate trait.`);
    if (has(actor, "drawn-in-vital-ink")) out.notes.push(`Drawn in Vital Ink (free, right after a melee hit with physical damage on something that bleeds): for a minute you Trace on that creature at 60 feet as a single action${vitalInk ? " (up now)" : ""}.`);
    if (has(actor, "diacritic-fluency")) out.notes.push(`Diacritic Fluency (free, once per 10 minutes${fluency ? "" : ", used"}): your next Trace this turn also traces a diacritic on the rune${know("ur") ? `; Ur- adds +${urBonus} to the invocation's damage` : ""}${know("en") ? "; En- spreads it to everyone within 15 feet of the bearer" : ""}.`);
    if (shades) out.notes.push("Shades of Meaning: every rune you etch or trace carries a diacritic you know for free.");
    const dias = [...known].filter((k) => RUNES[k].diacritic);
    if (dias.length && !freeDiacritic) out.notes.push(`A diacritic costs its own Trace on the rune: ${dias.map((k) => `${RUNES[k].name.split(",")[0]} (${RUNES[k].text})`).join("; ")}.`);
    if (has(actor, "runic-tattoo")) out.notes.push(tattooKey ? `Runic Tattoo: ${RUNES[tattooKey].name.split(",")[0]} is always etched on you${tattooFaded ? ", faded until your daily preparations" : ", outside your etched limit"}.` : "Runic Tattoo: name the tattooed rune in an effect or the rune flag (Runic Tattoo: Atryl) for the plans to use it.");
    if (hasAny(actor, "artists-attendance", "artist-s-attendance") && placed.some((p) => p.holder === "foe")) out.notes.push("Artist's Attendance (2 actions, flourish): Stride twice, and if you end within reach of a rune-bearer, Trace a Rune on it or something adjacent for free.");
    if (has(actor, "edifying-trace") && !edify) out.notes.push("Edifying Trace (1 action, flourish): Trace on an adjacent enemy and Recall Knowledge about it; a success gives it -1 to saves against your invocations for a minute.");
    if (has(actor, "enhanced-glyph-familiar")) out.notes.push("Enhanced Glyph Familiar: a one-action Trace can target something adjacent to your familiar (within 30 feet of you) instead of you.");
    else if (has(actor, "glyph-familiar")) out.notes.push("Glyph Familiar: your familiar is a construct that flies and is tough; it can carry a rune for Transpose Etching or Chain of Words.");
    if (has(actor, "backup-runic-enhancement")) out.notes.push("Backup Runic Enhancement: runic weapon (or runic body) once a day as an innate spell at half your level, rounded up; the cantrip at will.");
    if (has(actor, "rune-ward")) out.notes.push("Rune Ward (reaction, when a spell targets you from a tradition whose skill you're trained in): +1 to AC and the save against it.");
    if (has(actor, "invisible-ink")) out.notes.push("Invisible Ink: Hide any rune you apply as a free action, against your Crafting DC.");
    if (has(actor, "ghostly-resonance")) out.notes.push("Ghostly Resonance: a divine or occult rune on a weapon or creature also gives it ghost touch while the rune lasts.");
    if (has(actor, "song-of-glorious-invocation") && !foeRunes.length) out.notes.push("Song of Glorious Invocation (1 action, once per 10 minutes): one rune invoked on each of up to three bearers within 30 feet, and +1 to their skills and saves against fear for a minute.");
    if (has(actor, "runic-reprisal") && !has(actor, "fortifying-knock")) out.notes.push("Runic Reprisal works through Fortifying Knock: a damaging rune buried in your shield goes off on whoever you Shield Block.");
    if (has(actor, "orbiting-runestone") && hostile.some((k) => RUNES[k].inv.kind === "damage") && !effect(actor, /orbiting-runestone/)) out.notes.push(`Orbiting Runestone (1 action): a 10-HP stone that blocks a hit on a DC 11 flat check, and when broken invokes ${RUNES[hostile.find((k) => RUNES[k].inv.kind === "damage")].name.split(",")[0]} on an attacker within 15 feet.`);
    if (has(actor, "overloaded-ammunition")) out.notes.push(`Overloaded Ammunition: two ${lv >= 14 ? "greater " : ""}explosive rounds a day at your class DC; they burn out by tomorrow.`);
    if (has(actor, "unerring-runic-attraction") && foeRunes.length && ammoStrike.length) out.notes.push(`Unerring Runic Attraction (1 action): a ranged Strike at a rune-bearer in your first increment that needs no line of sight, ignores hidden and all cover and shield bonuses: ${[...new Set(foeRunes.map((p) => nameOf(p.who)))].join(", ")}.`);
    if (has(actor, "define-the-canvas")) out.notes.push("Define the Canvas (2 actions, once per 10 minutes): a 20-foot burst on the ground where one Trace puts the rune on every eligible target inside, for a minute.");
    if (has(actor, "henge-gate")) out.notes.push("Henge Gate (2 actions, once per 10 minutes): two stones within 30 feet; any ranged hit with ammunition that passes between them traces the chosen rune on its target, for a minute.");
    if (has(actor, "by-your-name")) out.notes.push("By Your Name (1 action, once an hour, a foe whose name you know): a Crafting check; a success gives your runes on it -2 to its saves for a minute, a critical success adds half your level to their damage.");
    if (has(actor, "return-unto-runes")) out.notes.push("Return Unto Runes (reaction, once per 10 minutes, a spell attack against your AC): +4 AC against it, and a miss is sealed into a rune you can trace and invoke on someone until the end of your next turn.");
    if (has(actor, "maze-of-runes")) out.notes.push("Maze of Runes: quandary once a day as an innate spell; while you Sustain it you can also Trace or Invoke a Rune on the target as if adjacent.");
    if (has(actor, "runesight")) out.notes.push("Runesight: every rune-bearer within 60 feet is a precise sense to you, hidden or not.");
    if (has(actor, "distant-invocation")) out.notes.push("Distant Invocation: your invocations reach 60 feet.");
    if (has(actor, "unbounded-invocations")) out.notes.push("Unbounded Invocations: one Invoke Rune sets off every rune within reach, not two.");
    if (has(actor, "stone-forge-of-the-first")) out.notes.push("Stone Forge of the First (2 actions, once a day): a forge within 30 feet for a minute; traced runes in 30 feet of it don't run out and invoked ones go faint but keep their passive benefit.");
    if (has(actor, "forge-new-word")) out.notes.push("Forge New Word: your own rune casts its spell from the bearer's square when invoked (class DC - 10 as the attack roll).");
    if (lv >= 7 && isClass && board.strikes.some((s) => Number(s.item?.system?.runes?.striking) > 0)) out.notes.push(`Runic Optimization: ${lv >= 15 ? "+4 to +8" : "+2 to +4"} damage with a striking weapon is already in your Strike numbers.`);
    if (lv >= 11 && isClass) out.notes.push("Forged Endurance: a success on a Fortitude save is a critical success.");
    if (has(actor, "seek-the-hidden-glyphs")) out.notes.push("Seek the Hidden Glyphs: if you set off a magical trap by critically failing to disable it, Trace a Rune on yourself as a reaction first.");
}

export { runesmith, RUNES };
