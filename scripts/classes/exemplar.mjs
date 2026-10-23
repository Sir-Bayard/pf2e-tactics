/**
 * PF2e Tactics: classes/exemplar.mjs
 * See classes/_common.mjs for the shape of a class read.
 * Reads the divine spark (which ikon holds it: PF2e keeps it as the toggleable roll option "divine-spark:<ikon>", one per ikon
 * item), the three ikons' immanence and transcendence, the ikon feats that imbue more transcendence actions, Shift Immanence
 * (and Rapid Spark's free one), the epithets' after-transcendence abilities (root at 3, dominion at 7, sovereignty at 15),
 * and the spark economy: a transcendence casts the spark out of its ikon, so the immanence is gone until the next Shift.
 * Plans: "Shift Immanence to X, then Strike", "Transcend X (then Strikes, or Shift back)". The hourly 2- and 3-action feats
 * (Battle Hymn, Raise Island, the storms) stay with the advisor's own text reading; they get when-notes here.
 */
import { bestStrike, canMove, castable, effect, focusLeft, has, half, level, markOffGuard, moveText, myReach, allySpeed, pct, slugOf, squareToReach, strikeRun, targets, worth, degreeChances, feetBetween, inReach, mapFor, strikeExpected, saveExpected, CONDITION_VALUE, nameOf, reachableSquares, signed } from "./_common.mjs";

/** Foundry's slugs drop apostrophes ("barrows-edge"); the catalog's keep a dash for them ("barrow-s-edge"). Both are read. */
const norm = (s) => String(s ?? "").replace(/-s-/g, "s-").replace(/-s$/, "s");
const hasAny = (actor, ...slugs) => slugs.some((s) => has(actor, s) || has(actor, norm(s)));
const itemOf = (actor, slug) => actor?.items?.find?.((i) => ["feat", "action"].includes(i.type) && norm(slugOf(i)) === norm(slug)) ?? null;
/** Uses left today/this hour of a feat with a frequency; a feat without one on the sheet counts as available. */
const usesLeft = (actor, slug) => { const it = itemOf(actor, slug); if (!it) return 0; const v = it.system?.frequency?.value; return v == null ? 1 : Number(v) || 0; };
const abil = (actor, k) => Number(actor?.abilities?.[k]?.mod ?? actor?.system?.abilities?.[k]?.mod) || 0;
const classDC = (actor, lv) => Number(actor?.classDC?.value ?? actor?.system?.attributes?.classDC?.value) || 10 + lv + 4 + (lv >= 17 ? 6 : lv >= 9 ? 4 : 2);
const dieOf = (s) => Number(String(s.die ?? s.item?.system?.damage?.die ?? "d8").replace("d", "")) || 8;
/** Weapon damage dice of a Strike: the sheet's, or the striking rune a character of this level would carry. */
const diceOf = (s, lv) => Number(s.dice ?? s.item?.system?.damage?.dice) || (lv >= 19 ? 4 : lv >= 12 ? 3 : lv >= 4 ? 2 : 1);
const dieAvg = (s) => (dieOf(s) + 1) / 2;
const tags = (s) => s.item?.system?.traits?.otherTags ?? s.otherTags ?? [];

/**
 * The ikons: kind, the immanence in a few words, and the transcendence action PF2e grants with the ikon (its slug, name, cost).
 * imm: spirit damage per weapon die on a hit (weapon ikons); the rest is prose.
 */
const IKONS = {
    "barrows-edge": { name: "Barrow's Edge", kind: "weapon", melee: true, imm: 1, immText: "+1 spirit per weapon die on its hits, +3 per die against a foe below half its HP", tr: { slug: "drink-of-my-foes", name: "Drink of my Foes", cost: 1 } },
    "gleaming-blade": { name: "Gleaming Blade", kind: "weapon", melee: true, imm: 2, immText: "+2 spirit per weapon die on its hits", tr: { slug: "flowing-spirit-strike", name: "Flowing Spirit Strike", cost: 2 } },
    "hands-of-the-wildling": { name: "Hands of the Wildling", kind: "weapon", melee: true, imm: 1, immText: "+1 spirit splash per weapon die on its hits (foes next to the target take it too)", tr: { slug: "feral-swing", name: "Feral Swing", cost: 2 } },
    "mortal-harvest": { name: "Mortal Harvest", kind: "weapon", melee: true, imm: 1.5, immText: "1 persistent spirit per weapon die on its hits", tr: { slug: "reap-the-field", name: "Reap the Field", cost: 1 } },
    "noble-branch": { name: "Noble Branch", kind: "weapon", melee: true, imm: 2, immText: "+2 spirit per weapon die on its hits", tr: { slug: "strike-breathe-rend", name: "Strike, Breathe, Rend", cost: 1 } },
    "shadow-sheath": { name: "Shadow Sheath", kind: "weapon", thrown: true, imm: 2, immText: "+2 spirit per weapon die on its thrown hits, +3 against an off-guard foe; draw a copy for free", tr: { slug: "liars-hidden-blade", name: "Liar's Hidden Blade", cost: 1 } },
    "starshot": { name: "Starshot", kind: "weapon", ranged: true, imm: 1, immText: "+1 spirit splash per weapon die on its hits", tr: { slug: "giant-felling-comet", name: "Giant-Felling Comet", cost: 2 } },
    "titans-breaker": { name: "Titan's Breaker", kind: "weapon", melee: true, imm: 2, immText: "+2 spirit per weapon die on its hits (constructs and objects take it, through hardness up to your level)", tr: { slug: "fracture-mountains", name: "Fracture Mountains", cost: 2 } },
    "unfailing-bow": { name: "Unfailing Bow", kind: "weapon", ranged: true, imm: 1, immText: "+1 spirit per weapon die on its hits, 1d4 per die on a critical hit", tr: { slug: "arrow-splits-arrow", name: "Arrow Splits Arrow", cost: 1 } },
    "bands-of-imprisonment": { name: "Bands of Imprisonment", kind: "worn", immText: "+1 to Will saves, resistance to mental damage of half your level", tr: { slug: "break-free", name: "Break Free", cost: 2 } },
    "fetching-bangles": { name: "Fetching Bangles", kind: "worn", immText: "a foe within 10 feet that moves away needs a Will save or its move is disrupted", tr: { slug: "embrace-of-destiny", name: "Embrace of Destiny", cost: 1 } },
    "horn-of-plenty": { name: "Horn of Plenty", kind: "worn", immText: "draw and drink one of its elixirs in one action", tr: { slug: "feed-the-masses", name: "Feed the Masses", cost: 1 } },
    "mirrored-aegis": { name: "Mirrored Aegis", kind: "worn", immText: "+1 AC to you and allies within 15 feet", tr: { slug: "raise-the-walls", name: "Raise the Walls", cost: 1 } },
    "pelt-of-the-beast": { name: "Pelt of the Beast", kind: "worn", immText: "resistance of half your level to the attuned damage type", tr: { slug: "survive-the-wilds", name: "Survive the Wilds", cost: 1 } },
    "skybearers-belt": { name: "Skybearer's Belt", kind: "worn", immText: "+1 to Disarm, Grapple, Shove and Trip, against foes up to two sizes larger", tr: { slug: "bear-allies-burdens", name: "Bear Allies' Burdens", cost: 2 } },
    "thousand-league-sandals": { name: "Thousand-League Sandals", kind: "worn", immText: "+10 feet Speed", tr: { slug: "marathon-dash", name: "Marathon Dash", cost: 1 } },
    "victors-wreath": { name: "Victor's Wreath", kind: "worn", immText: "+1 to attack rolls for you and allies within 15 feet", tr: { slug: "one-moment-till-glory", name: "One Moment till Glory", cost: 1 } },
    "eye-catching-spot": { name: "Eye-Catching Spot", kind: "body", immText: "-1 to melee attacks against you", tr: { slug: "captivating-charm", name: "Captivating Charm", cost: 2 } },
    "gaze-sharp-as-steel": { name: "Gaze Sharp as Steel", kind: "body", immText: "+1 Perception, +2 AC against ranged attacks", tr: { slug: "a-moment-unending", name: "A Moment Unending", cost: 1 } },
    "scar-of-the-survivor": { name: "Scar of the Survivor", kind: "body", immText: "Diehard and +1 to Fortitude saves", tr: { slug: "no-scar-but-this", name: "No Scar but This", cost: 1 } },
    "skin-hard-as-horn": { name: "Skin Hard as Horn", kind: "body", immText: "resistance of half your level to the attuned physical damage type (not against critical hits)", tr: { slug: "crash-against-me", name: "Crash Against Me", cost: 1 } },
};
/** Ikon feats: the transcendence action they imbue (or the immanence they add), and the kinds of ikon they go into. */
const IKON_FEATS = {
    "steel-on-steel": { kinds: ["weapon", "worn"], tr: { slug: "ringing-challenge", name: "Ringing Challenge", cost: 2 } },
    "through-the-needles-eye": { kinds: ["weapon"], tr: { slug: "blinding-of-the-needle", name: "Blinding of the Needle", cost: 2 } },
    "follow-the-threads-of-fate": { kinds: ["weapon", "worn"], tr: { slug: "unravel-the-future", name: "Unravel the Future", cost: 1 } },
    "binding-serpents-celestial-arrow": { kinds: ["weapon"], tr: { slug: "coiling-serpents", name: "Coiling Serpents", cost: 2 } },
    "motionless-cutter": { kinds: ["weapon"], tr: { slug: "sever-four-dragonfly-wings", name: "Sever Four Dragonfly Wings", cost: 3 } },
    "riddle-the-sphinx": { kinds: ["body"], tr: { slug: "tangle-in-riddle", name: "Tangle in Riddle", cost: 1 } },
    "shield-of-stone": { kinds: ["worn"], tr: { slug: "brandish-the-gorgons-gaze", name: "Brandish the Gorgon's Gaze", cost: 1 } },
    "breath-of-vital-ash": { kinds: ["body"], tr: { slug: "mark-the-center", name: "Mark the Center", cost: 1 } },
    "journey-of-the-sky-chariot": { kinds: ["body", "worn"], tr: { slug: "race-the-skies", name: "Race the Skies", cost: 1 } },
    "mated-birds-in-paired-flight": { kinds: ["weapon"], tr: { slug: "rejoin-in-flight", name: "Rejoin in Flight", cost: 2 } },
    "compliant-gold": { kinds: ["weapon"], tr: { slug: "topple-the-pillar-of-heaven", name: "Topple the Pillar of Heaven", cost: 2 } },
    "warped-by-rage": { kinds: ["body", "worn"], tr: { slug: "spasm-of-the-berserker", name: "Spasm of the Berserker", cost: 1 } },
    "destined-victory": { kinds: ["worn"], tr: { slug: "only-you-and-i", name: "Only You and I", cost: 1 } },
    "infinite-blades-celestial-arrow": { kinds: ["weapon"], tr: { slug: "heaven-rains-an-ending", name: "Heaven Rains an Ending", cost: 3 } },
    "crown-of-rule": { kinds: ["worn", "body"], tr: { slug: "heavy-is-the-crown", name: "Heavy is the Crown", cost: 2 } },
    "gift-of-the-immortal-herb": { kinds: ["body"], tr: { slug: "shed-the-mortal-skin", name: "Shed the Mortal Skin", cost: 1 } },
    "mark-of-the-sage": { kinds: ["worn"], tr: { slug: "a-challenge-for-heroes", name: "A Challenge for Heroes", cost: 2 } },
    "shroud-of-ghosts": { kinds: ["worn"], tr: { slug: "skirt-the-underworld", name: "Skirt the Underworld", cost: 2 } },
    "branched-tree-of-pain": { kinds: ["weapon"], tr: { slug: "plant-thirty-barbs", name: "Plant Thirty Barbs", cost: 1 } },
    "eternity-incinerating-blaze": { kinds: ["weapon"], tr: { slug: "burn-out-of-time", name: "Burn out of Time", cost: 2 } },
    "seven-colored-cosmic-bridge": { kinds: ["weapon"], tr: { slug: "fleeting-arc-through-heaven-and-earth", name: "Fleeting Arc through Heaven and Earth", cost: 3 } },
    "sunwrecker": { kinds: ["weapon"], tr: { slug: "break-the-suns-legs", name: "Break the Sun's Legs", cost: 2 } },
    "hurl-at-the-horizon": { kinds: ["weapon"] }, "leap-the-falls": { kinds: ["body"] }, "red-gold-mortality": { kinds: ["weapon"] },
};
const ROOT = ["the-brave", "the-cunning", "the-deft", "the-mournful", "the-proud", "the-radiant"];
const DOMINION = ["born-of-the-bones-of-the-earth", "dancer-in-the-seasons", "of-verse-unbroken", "peerless-under-heaven", "plunderer-of-the-hives-riches", "restless-as-the-tide", "trespasser-in-deaths-realm", "whose-cry-is-thunder"];
const EPITHET_NAMES = { "the-brave": "The Brave", "the-cunning": "The Cunning", "the-deft": "The Deft", "the-mournful": "The Mournful", "the-proud": "The Proud", "the-radiant": "The Radiant",
    "born-of-the-bones-of-the-earth": "Born of the Bones of the Earth", "dancer-in-the-seasons": "Dancer in the Seasons", "of-verse-unbroken": "Of Verse Unbroken", "peerless-under-heaven": "Peerless under Heaven", "plunderer-of-the-hives-riches": "Plunderer of the Hive's Riches", "restless-as-the-tide": "Restless as the Tide", "trespasser-in-deaths-realm": "Trespasser in Death's Realm", "whose-cry-is-thunder": "Whose Cry is Thunder",
    "healer-of-the-world": "Healer of the World", "teacher-of-heroes": "Teacher of Heroes", "the-last-ruler": "The Last Ruler", "thief-of-moonlight": "Thief of Moonlight" };
const SOVEREIGN = ["healer-of-the-world", "teacher-of-heroes", "the-last-ruler", "thief-of-moonlight"];
/** Conditions that came from a save, which One Moment till Glory lets an ally roll again. */
const SAVED = ["frightened", "sickened", "slowed", "stupefied", "clumsy", "enfeebled", "stunned", "confused", "fascinated", "blinded", "deafened", "dazzled", "paralyzed", "fleeing", "controlled", "drained"];

/** The character's ikons from the sheet: the table's, plus any item tagged exemplar-ikon the table doesn't know. */
function ikonsOf(actor) {
    const out = [];
    for (const i of actor?.items ?? []) {
        if (!["feat", "action"].includes(i.type)) continue;
        const slug = norm(slugOf(i));
        const known = IKONS[slug];
        const ot = i.system?.traits?.otherTags ?? [];
        if (known) out.push({ slug, item: i, ...known });
        else if (ot.includes("exemplar-ikon")) out.push({ slug, item: i, name: i.name, kind: ot.includes("exemplar-weapon-ikon") ? "weapon" : ot.includes("exemplar-body-ikon") ? "body" : "worn", immText: "its immanence", tr: null, melee: true });
    }
    return out;
}
/** The ikon holding the spark: the roll option divine-spark:<ikon> (the ikon's own toggle), else the toggle's state on the item. */
function sparkOf(actor, ikons) {
    const ro = actor?.rollOptions?.all ?? {};
    for (const k of ikons) if (ro[`divine-spark:${k.slug}`] || ro[`divine-spark:${slugOf(k.item)}`]) return k;
    for (const k of ikons) {
        const r = (k.item.system?.rules ?? []).find((x) => x.key === "RollOption" && x.option === "divine-spark");
        if (r && r.value === true && (r.selection == null || norm(r.selection) === k.slug)) return k;
    }
    return null;
}
/** The ikon an ikon feat was imbued into (its ChoiceSet selection), else the first ikon of a kind the feat allows. */
function imbuedInto(actor, featSlug, ikons) {
    const it = itemOf(actor, featSlug);
    const sel = it?.flags?.pf2e?.rulesSelections?.ikon ?? it?.flags?.system?.rulesSelections?.ikon;
    if (sel) { const k = ikons.find((x) => x.slug === norm(sel)); if (k) return k; }
    const kinds = IKON_FEATS[featSlug]?.kinds ?? ["weapon", "worn", "body"];
    return ikons.find((k) => kinds.includes(k.kind)) ?? null;
}
/** The Strike that is this weapon ikon: the item tagged physical-ikon:<slug>, else the best Strike of the ikon's kind (a guess). */
function strikeOfIkon(board, k) {
    const tagged = board.strikes.find((s) => tags(s).some((t) => t === `physical-ikon:${k.slug}` || norm(t) === `physical-ikon:${k.slug}`));
    if (tagged) return { s: tagged, guessed: false };
    const pool = board.strikes.filter((s) => k.ranged ? s.ranged : k.thrown ? s.thrown || s.ranged : !s.ranged);
    pool.sort((a, b) => b.avg - a.avg);
    return pool[0] ? { s: pool[0], guessed: true } : null;
}

function exemplar(board, ctx, out) {
    const actor = board.me.actor;
    const me = board.me;
    const lv = level(board);
    if (!hasAny(actor, "divine-spark-and-ikons", "shift-immanence") && (actor?.class?.slug ?? "") !== "exemplar") return;
    const ikons = ikonsOf(actor);
    if (!ikons.length) { out.notes.push("No ikon on your sheet: the read needs your ikons as class feature items."); return; }
    const foes = targets(board);
    const dc = classDC(actor, lv);
    const spark = sparkOf(actor, ikons);
    const away = !!effect(actor, /fish-from-the-falls|falls-edge/);
    const archetype = (actor?.class?.slug ?? "") !== "exemplar";
    const secondIkon = has(actor, "second-ikon");
    const rapid = has(actor, "rapid-spark") && usesLeft(actor, "rapid-spark") > 0 && ctx.actions === 3 && ctx.made === 0;
    const shiftCost = rapid ? 0 : 1;
    const stride = board.move?.stride?.feet ?? 25;
    const missing = Math.max(0, me.maxHp - me.hp);
    const push = (plan) => out.plans.push({ kind: "class", dest: null, notes: [], ...plan, score: plan.ev + (plan.bias ?? 0.3) });
    const strikeText = (f, used) => `Strike ${nameOf(f)} with ${used[0].s.label}${used.length > 1 ? ` ${used.length === 2 ? "twice" : "three times"}` : ""} (${used.map((u) => signed(u.bonus)).join(", ")})`;
    const sheetCounts = (s) => !!s.formula; // the live sheet's damage formula carries the empowered ikon's immanence; the estimate doesn't

    // ---- what each ikon can transcend with: its own action plus the ikon feats imbued into it
    const trOf = (k) => {
        const list = k.tr ? [{ ...k.tr, feat: null }] : [];
        for (const [fs, def] of Object.entries(IKON_FEATS)) if (def.tr && hasAny(actor, fs) && imbuedInto(actor, fs, ikons)?.slug === k.slug) list.push({ ...def.tr, feat: fs });
        return list;
    };
    const immOf = (k, s, f) => { // immanence damage on one hit of the weapon ikon
        if (k.kind !== "weapon" || !s) return 0;
        const dice = diceOf(s, lv);
        if (k.slug === "barrows-edge") return dice * (f && f.hp != null && f.maxHp && f.hp < f.maxHp / 2 ? 3 : 1);
        return dice * (k.imm ?? 0);
    };
    /** The ikon's Strike with and without its immanence on the damage. */
    const empowered = (k, s, f) => s.avg + (sheetCounts(s) && spark?.slug === k.slug ? 0 : immOf(k, s, f));
    const plain = (k, s) => s.avg - (sheetCounts(s) && spark?.slug === k.slug ? immOf(k, s, null) : 0);
    const stripped = (k) => board.strikes.map((s) => ({ ...s, avg: plain(k, s) })); // every Strike without the spark's damage
    const withSpark = (k, s0, f) => board.strikes.map((s) => s === s0 ? { ...s, avg: empowered(k, s, f) } : { ...s, avg: plain(k, s) });
    /** A run of Strikes at f from these strikes, the penalty climbing. */
    const run = (strikes, f, n, made, at = me.rect, { acAdj = 0, extra = 0 } = {}) => {
        const used = [];
        let ev = 0;
        for (let i = 0; i < n; i++) {
            let best = null;
            for (const s of strikes) {
                if (s.ranged ? feetBetween(at, f.rect) > (s.range ?? 30) * 2 : !inReach(at, f.rect, s.reach || 5)) continue;
                const b = s.bonus + mapFor(made + used.length, s.agile);
                const e = strikeExpected(b, f.ac + acAdj, s.avg + extra, { deadly: s.deadly });
                if (!best || e.expected > best.e.expected) best = { s, bonus: b, e };
            }
            if (!best) break;
            used.push(best); ev += best.e.expected;
        }
        return { used, ev };
    };
    const shiftStep = (k) => ({ cost: shiftCost, text: `${rapid ? "Rapid Spark (free as your turn begins): Shift Immanence" : "Shift Immanence"} to ${k.name}: ${k.immText}` });
    const sparkNote = (k) => secondIkon ? `Second Ikon: your spark moves to your other ikon on its own.` : `your spark leaves ${k.name} as it transcends: no ${k.kind === "weapon" ? "spirit damage from it" : "immanence from it"} until you Shift Immanence again (1 action, once a round).`;
    /** The steps to have the spark in k this turn: none, or a Shift; null when it can't be done. */
    const pre = (k) => spark?.slug === k.slug && !away ? { steps: [], cost: 0 } : ctx.actions > shiftCost ? { steps: [shiftStep(k)], cost: shiftCost } : null;

    // ---- the epithet's after-transcendence ability: the best one for this plan, the others in a note
    const epithets = [...ROOT, ...DOMINION, ...SOVEREIGN].filter((e) => hasAny(actor, e));
    function epithetAfter(f, { adjacent = 0, at = me.rect } = {}) {
        const opts = [];
        const hurtAlly = board.allies.filter((a) => feetBetween(at, a.rect) <= 30 && a.maxHp && a.hp < a.maxHp).sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0];
        const far = foes.filter((x) => !inReach(at, x.rect, myReach(board)));
        const near30 = f && feetBetween(at, f.rect) <= 30 ? f : foes.find((x) => feetBetween(at, x.rect) <= 30);
        for (const e of epithets) {
            switch (e) {
                case "the-brave": if (far.length) opts.push({ e, ev: 0.5, text: `The Brave: Stride half your Speed straight toward ${nameOf(far[0])} for free (once per foe per 10 minutes)` }); break;
                case "the-cunning": if (near30 && me.deception != null) opts.push({ e, ev: 0.5 * worth(board, "off-guard") * 0.5, text: `The Cunning: Feint ${nameOf(near30)} for free (Deception ${signed(me.deception)}); it's off-guard to your next melee Strike` }); break;
                case "the-deft": opts.push({ e, ev: 0.3, text: "The Deft: a free Interact to reload or draw your weapon ikon, and a free Steal or Palm an Object" }); break;
                case "the-mournful": if (near30) opts.push({ e, ev: 0.5 * worth(board, "dazzled"), text: `The Mournful: ${nameOf(near30)} is dazzled until your next turn (then immune for 10 minutes)` }); break;
                case "the-proud": if (near30) opts.push({ e, ev: 0.6, text: `The Proud: boast at ${nameOf(near30)}; -1 to its attacks, damage and skill checks against anyone but you until your next turn` }); break;
                case "the-radiant": if (hurtAlly) { const h = Math.min(2 + 2 * lv, hurtAlly.maxHp - hurtAlly.hp); opts.push({ e, ev: 0.8 * h, text: `The Radiant: ${nameOf(hurtAlly)} regains ${2 + 2 * lv} HP (then immune for 10 minutes)` }); } break;
                case "peerless-under-heaven": if (near30) { const c = degreeChances(near30.saves?.will ?? 0, dc); opts.push({ e, ev: (c.f + c.cf) * worth(board, "frightened"), text: `Peerless under Heaven: ${nameOf(near30)} saves (Will DC ${dc}, ${pct(c.f + c.cf)} to fail) or is frightened 1` }); } break;
                case "dancer-in-the-seasons": opts.push({ e, ev: 0.3 * Math.floor(lv / 2), text: `Dancer in the Seasons: ${Math.floor(lv / 2)} temporary HP until your next turn` }); break;
                case "restless-as-the-tide": opts.push({ e, ev: 0.5, text: `Restless as the Tide: Step for free${f ? `, or move ${nameOf(f)} 5 feet unless it saves (DC ${dc}) when the transcendence hit it` : ""}` }); break;
                case "trespasser-in-deaths-realm": opts.push({ e, ev: adjacent * 3.5 * 0.7, text: `Trespasser in Death's Realm: living foes that start a turn next to you, or step next to you, take 1d6 void until your next turn${adjacent ? ` (${adjacent} adjacent now)` : ""}` }); break;
                case "whose-cry-is-thunder": opts.push({ e, ev: adjacent * 3.5 * 0.5, text: "Whose Cry is Thunder: charged until your next turn; a foe that hits you unarmed or with a non-reach melee weapon takes 1d6 electricity" }); break;
                case "plunderer-of-the-hives-riches": opts.push({ e, ev: 1.5, text: "Plunderer of the Hive's Riches: you're concealed until your next turn (a DC 5 flat check on every attack at you)" }); break;
                case "of-verse-unbroken": opts.push({ e, ev: 0.5, text: "Of Verse Unbroken: until your next turn an ally within 30 feet Sustains one effect for free as its turn begins" }); break;
                case "born-of-the-bones-of-the-earth": opts.push({ e, ev: 0.5, text: "Born of the Bones of the Earth: on earth or stone, the ground within 10 feet becomes difficult terrain for everyone but you" }); break;
                case "healer-of-the-world": { const n = board.allies.filter((a) => feetBetween(me.rect, a.rect) <= 30).length; const d = (board.downAllies ?? []).filter((a) => feetBetween(me.rect, a.rect) <= 30).length; opts.push({ e, ev: 3 * n + 6 * d, text: `Healer of the World: allies within 30 feet get 10 temporary HP until your next turn${d ? `, and ${d} dying one${d > 1 ? "s" : ""} stop dying` : ""}` }); break; }
                case "teacher-of-heroes": if (near30) opts.push({ e, ev: 1, text: `Teacher of Heroes: a free Recall Knowledge on ${nameOf(near30)}; the first thing you learn is its immunities, and every ally within 60 feet hears it` }); break;
                case "the-last-ruler": opts.push({ e, ev: 1, text: "The Last Ruler: until your next turn, a foe that misses you is Demoralized for free" }); break;
                case "thief-of-moonlight": if (near30) opts.push({ e, ev: 0.5, text: `Thief of Moonlight: a free Steal from ${nameOf(near30)} at 30 feet` }); break;
            }
        }
        opts.sort((a, b) => b.ev - a.ev);
        return opts[0] ?? null;
    }
    const after = (steps, f, extra = {}) => { const a = epithetAfter(f, extra); if (a) steps.push({ cost: 0, text: a.text }); return a?.ev ?? 0; };
    /** The immanence on one hit, in words. */
    const immLabel = (k, s, f) => { const d = diceOf(s, lv); return k.slug === "mortal-harvest" ? `${d} persistent spirit` : k.slug === "barrows-edge" ? `+${immOf(k, s, f)} spirit${f && f.hp != null && f.maxHp && f.hp < f.maxHp / 2 ? " (it's below half)" : ` (+${3 * d} once it's below half)`}` : `+${immOf(k, s, f)} spirit`; };

    // ---- the spark now
    if (away) out.notes.push("Your spark is with the ally Fish from the Falls' Edge saved: no immanence until your next turn begins, when it returns to an ikon you choose.");
    else if (spark) out.notes.push(`Your spark is in ${spark.name}: ${spark.immText}.${spark.kind === "weapon" ? " The sheet's Strike damage carries it; so do the plans." : ""}`);
    else out.notes.push(`Your spark is dormant: no immanence. Shift Immanence (1 action${rapid ? ", free this turn with Rapid Spark" : ""}) puts it in an ikon; you also get a free Shift when you roll initiative.`);
    if (archetype && !secondIkon) out.notes.push("With one ikon, a transcendence sends your spark back into your soul; only Shift Immanence brings it back.");

    // ======== weapon ikons
    for (const k of ikons.filter((x) => x.kind === "weapon")) {
        const found = strikeOfIkon(board, k);
        if (!found) continue;
        const { s, guessed } = found;
        const p = pre(k);
        if (!p) continue;
        const avail = ctx.actions - p.cost;
        const reach = s.ranged ? (s.range ?? 30) : (s.reach || 5);
        const guessNote = guessed ? `The sheet doesn't tag a weapon as ${k.name}; the plan assumes ${s.label}.` : null;
        const trs = trOf(k);
        const dice = diceOf(s, lv);
        // -- Shift to k, then Strike: only when the spark isn't there yet (the advisor's own Strikes cover the empowered case)
        if (p.steps.length && avail >= 1) {
            for (const f of foes) {
                const sq = s.ranged ? (feetBetween(me.rect, f.rect) <= reach * 2 ? { x: me.rect.x, y: me.rect.y, route: { actions: 0 } } : null) : squareToReach(board, f, reach, avail - 1);
                if (!sq) continue;
                const left = avail - sq.route.actions;
                if (left < 1) continue;
                const at = sq.route.actions ? { ...me.rect, x: sq.x, y: sq.y } : me.rect;
                const r = run(withSpark(k, s, f), f, left, ctx.made, at);
                if (!r.used.length || !r.used.some((u) => u.s.label === s.label)) continue;
                let ev = r.ev;
                const steps = [...p.steps];
                if (sq.route.actions) steps.push({ cost: sq.route.actions, text: moveText(sq, f) });
                const adj = hasAny(actor, "infinite-blades-celestial-arrow") && imbuedInto(actor, "infinite-blades-celestial-arrow", ikons)?.slug === k.slug ? Math.min(2, foes.filter((o) => o !== f && inReach(f.rect, o.rect, 5)).length) : 0;
                if (adj) ev += r.used.filter((u) => u.s.label === s.label).reduce((t, u) => t + u.e.hit * adj * dice, 0);
                steps.push({ cost: r.used.length, text: `${strikeText(f, r.used)}; ${immLabel(k, s, f)} on each hit${adj ? `, and ${adj} foe${adj > 1 ? "s" : ""} next to it take ${dice} spirit per hit (Infinite Blades)` : ""}` });
                push({ title: `Shift Immanence to ${k.name}, then Strike ${nameOf(f)}`, target: f, ev, bias: 0.3, dest: sq.route.actions ? { x: sq.x, y: sq.y } : null, steps, notes: [guessNote, spark && !away ? `You lose ${spark.name}'s immanence (${spark.immText}).` : null].filter(Boolean) });
            }
        }
        // -- the transcendence actions of k
        for (const t of trs) {
            if (avail < t.cost) continue;
            const base = `${t.name} (${t.cost} action${t.cost > 1 ? "s" : ""}, transcendence)`;
            const trPlan = (f, title, steps, ev, extra = {}) => push({ title, target: f, ev, bias: 0.4, dest: extra.dest ?? null, steps, notes: [guessNote, sparkNote(k), ...(extra.notes ?? [])].filter(Boolean) });
            /** Strikes after the transcendence resolved: the spark is gone, so the plain damage, at this penalty. */
            const tail = (steps, f, left, made, at) => { if (left < 1) return 0; const r = run(stripped(k), f, left, made, at); if (!r.used.length) return 0; steps.push({ cost: r.used.length, text: `${strikeText(f, r.used)} (no spirit damage: the spark has left)` }); return r.ev; };
            /** Shift back instead of a last Strike, when the immanence is worth more than that Strike. */
            const shiftBack = (steps, ev, f, left, made, at) => {
                if (left < 1 || p.cost > 0 || rapid) return; // Shift Immanence is once a round: not after a Shift this turn
                const back = immOf(k, s, f) * 1.2;
                const r = run(stripped(k), f, 1, made, at);
                if (back > (r.used[0]?.e.expected ?? 0) + 0.5) steps.push({ cost: 1, text: `Shift Immanence back to ${k.name}: its spirit damage is up again before the foes act` });
                else return false;
                return back;
            };
            for (const f of foes) {
                const sq = s.ranged ? (feetBetween(me.rect, f.rect) <= reach * 2 ? { x: me.rect.x, y: me.rect.y, route: { actions: 0 } } : null) : squareToReach(board, f, reach, avail - t.cost);
                if (!sq) continue;
                const left0 = avail - sq.route.actions;
                if (left0 < t.cost) continue;
                const at = sq.route.actions ? { ...me.rect, x: sq.x, y: sq.y } : me.rect;
                const move = sq.route.actions ? [{ cost: sq.route.actions, text: moveText(sq, f) }] : [];
                const b = s.bonus + mapFor(ctx.made, s.agile);
                const emp = empowered(k, s, f);
                const adjacent = foes.filter((o) => inReach(at, o.rect, 5)).length;
                const dest = sq.route.actions ? { x: sq.x, y: sq.y } : null;
                switch (t.slug) {
                    case "flowing-spirit-strike": {
                        const e1 = strikeExpected(b, f.ac, emp, { deadly: s.deadly });
                        const e2 = strikeExpected(b - (s.agile ? 0 : 2), f.ac, emp, { deadly: s.deadly });
                        const steps = [...p.steps, ...move, { cost: 2, text: `${base}: two Strikes at ${nameOf(f)} with ${s.label} (${signed(b)}, ${signed(b - (s.agile ? 0 : 2))}), both at your current penalty, all spirit damage; if both hit the damage is combined before resistance` }];
                        let ev = e1.expected + e2.expected + after(steps, f, { adjacent, at });
                        const left = left0 - 2;
                        ev += shiftBack(steps, ev, f, left, ctx.made + 2, at) || tail(steps, f, left, ctx.made + 2, at);
                        trPlan(f, `Flowing Spirit Strike at ${nameOf(f)}`, steps, ev, { dest, notes: ["It counts as two attacks for your penalty afterwards."] });
                        break;
                    }
                    case "strike-breathe-rend": {
                        if (left0 < 2) break;
                        const e1 = strikeExpected(b, f.ac, emp, { deadly: s.deadly });
                        const rend = dice * dieAvg(s);
                        const steps = [...p.steps, ...move, { cost: 1, text: `Strike ${nameOf(f)} with ${s.label} (${signed(b)}); ${immLabel(k, s, f)} on a hit` }, { cost: 1, text: `on a hit, ${base}: ${nameOf(f)} takes ${dice}d${dieOf(s)} spirit more, no roll` }];
                        let ev = e1.expected + e1.hit * rend + after(steps, f, { adjacent, at });
                        const left = left0 - 2;
                        ev += shiftBack(steps, ev, f, left, ctx.made + 1, at) || tail(steps, f, left, ctx.made + 1, at);
                        trPlan(f, `Strike ${nameOf(f)}, then Strike, Breathe, Rend`, steps, ev, { dest, notes: ["On a miss, keep the spark and Strike again instead."] });
                        break;
                    }
                    case "drink-of-my-foes": {
                        if (left0 < 2 || missing < 5) break;
                        const e1 = strikeExpected(b, f.ac, emp, { deadly: s.deadly });
                        const heal = Math.min(emp / 2, missing);
                        const steps = [...p.steps, ...move, { cost: 1, text: `Strike ${nameOf(f)} with ${s.label} (${signed(b)}); ${immLabel(k, s, f)} on a hit` }, { cost: 1, text: `on a hit, ${base}: you regain half the damage dealt (about ${Math.round(emp / 2)} HP; you're at ${me.hp}/${me.maxHp})` }];
                        let ev = e1.expected + e1.hit * 0.8 * heal + after(steps, f, { adjacent, at });
                        const left = left0 - 2;
                        ev += shiftBack(steps, ev, f, left, ctx.made + 1, at) || tail(steps, f, left, ctx.made + 1, at);
                        trPlan(f, `Strike ${nameOf(f)}, then Drink of my Foes`, steps, ev, { dest });
                        break;
                    }
                    case "reap-the-field": {
                        if (left0 < 2) break;
                        const e1 = strikeExpected(b, f.ac, emp, { deadly: s.deadly });
                        const others = foes.filter((g) => g !== f && feetBetween(at, g.rect) <= half(stride) + reach);
                        for (const g of others) {
                            const e2 = strikeExpected(b, g.ac, emp, { deadly: s.deadly }); // the same penalty as the first
                            const steps = [...p.steps, ...move, { cost: 1, text: `Strike ${nameOf(f)} with ${s.label} (${signed(b)}); ${dice} persistent spirit on a hit` }, { cost: 1, text: `on a hit, ${base}: Stride up to ${half(stride)} feet and Strike ${nameOf(g)} with ${s.label} at the same penalty (${signed(b)})` }];
                            let ev = e1.expected + e1.hit * e2.expected + after(steps, g, { adjacent, at });
                            ev += tail(steps, g, left0 - 2, ctx.made + 2, g.rect);
                            trPlan(f, `Strike ${nameOf(f)}, then Reap the Field to ${nameOf(g)}`, steps, ev, { dest, notes: ["Both Strikes count toward your penalty afterwards."] });
                        }
                        break;
                    }
                    case "fracture-mountains": {
                        const flat = lv >= 18 ? 8 : lv >= 10 ? 6 : 4, extraDice = lv >= 18 ? 3 : lv >= 10 ? 2 : 1;
                        const avg = plain(k, s) + flat + extraDice * dieAvg(s);
                        const e1 = strikeExpected(b, f.ac, avg, { deadly: s.deadly });
                        const steps = [...p.steps, ...move, { cost: 2, text: `${base}: a Strike at ${nameOf(f)} with ${s.label} (${signed(b)}); on a hit its spirit damage becomes ${flat} plus ${extraDice} extra weapon ${extraDice > 1 ? "dice" : "die"} (about ${Math.round(avg)} in all)` }];
                        let ev = e1.expected + after(steps, f, { adjacent, at });
                        const left = left0 - 2;
                        ev += shiftBack(steps, ev, f, left, ctx.made + 2, at) || tail(steps, f, left, ctx.made + 2, at);
                        trPlan(f, `Fracture Mountains at ${nameOf(f)}`, steps, ev, { dest, notes: ["It counts as two attacks for your penalty afterwards; a plain Strike twice may beat it against a low AC."] });
                        break;
                    }
                    case "feral-swing": {
                        const cone = foes.filter((g) => feetBetween(at, g.rect) <= 15 && feetBetween(f.rect, g.rect) <= 10);
                        if (cone.length < 2 || cone[0] !== f) break;
                        let ev = 0;
                        const shown = [];
                        for (const g of cone) { const c = degreeChances(g.saves?.reflex ?? 0, dc); ev += (c.f + c.cf) * emp; shown.push(`${nameOf(g)} (${pct(c.f + c.cf)})`); }
                        const steps = [...p.steps, ...move, { cost: 2, text: `${base}: a 15-foot cone; ${shown.join(", ")} save (Reflex DC ${dc}) or take your full Strike damage as spirit (about ${Math.round(emp)}); no attack roll, no penalty` }];
                        ev += after(steps, f, { adjacent, at });
                        ev += tail(steps, f, left0 - 2, ctx.made, at);
                        trPlan(f, `Feral Swing at ${cone.length} foes`, steps, ev, { dest, notes: ["Swing with abandon for -2 on their saves; you're off-guard until your next turn."] });
                        break;
                    }
                    case "giant-felling-comet": {
                        if (feetBetween(me.rect, f.rect) > 60) break;
                        const burst = foes.filter((g) => inReach(f.rect, g.rect, 5));
                        if (burst.length < 2 || burst[0] !== f) break;
                        let ev = 0;
                        const shown = [];
                        for (const g of burst) { const big = (g.sizeRank ?? 2) > (me.sizeRank ?? 2) ? -2 : 0; const c = degreeChances((g.saves?.reflex ?? 0) + big, dc); ev += (c.f + c.cf) * emp; shown.push(`${nameOf(g)} (${pct(c.f + c.cf)})`); }
                        const steps = [...p.steps, { cost: 2, text: `${base}: a 5-foot burst on ${nameOf(f)}; ${shown.join(", ")} save (Reflex DC ${dc}, larger foes at -2) or take your full Strike damage as spirit (about ${Math.round(emp)}); it uses ammunition, no attack roll` }];
                        ev += after(steps, f);
                        ev += tail(steps, f, left0 - 2, ctx.made, at);
                        trPlan(f, `Giant-Felling Comet on ${burst.length} foes`, steps, ev);
                        break;
                    }
                    case "arrow-splits-arrow": {
                        if (left0 < 2) break;
                        const e1 = strikeExpected(b, f.ac, emp, { deadly: s.deadly });
                        const b2 = s.bonus + mapFor(ctx.made + 1, s.agile);
                        const e2 = strikeExpected(b2, f.ac, emp, { deadly: s.deadly });
                        const need = f.ac - b2;
                        const steps = [...p.steps, { cost: 1, text: `Strike ${nameOf(f)} with ${s.label} (${signed(b)}); ${immLabel(k, s, f)} on a hit` }, { cost: 1, text: `${base}: the same d20 at ${signed(b2)}; use it when the first roll was ${Math.max(2, need)} or more (a sure hit), otherwise Strike afresh` }];
                        let ev = e1.expected + e2.expected * (2 - e2.hit) + after(steps, f);
                        const left = left0 - 2;
                        ev += shiftBack(steps, ev, f, left, ctx.made + 2, at) || tail(steps, f, left, ctx.made + 2, at);
                        trPlan(f, `Strike ${nameOf(f)}, then Arrow Splits Arrow`, steps, ev, { notes: ["Arrow Splits Arrow repeats the roll, so you spend it only when the number already hits at the penalty."] });
                        break;
                    }
                    case "liars-hidden-blade": {
                        if (left0 < 2 || feetBetween(me.rect, f.rect) > reach * 2) break;
                        const e1 = strikeExpected(b, f.ac, emp, { deadly: s.deadly });
                        const e2 = strikeExpected(b, f.ac - (f.conditions?.has?.("off-guard") ? 0 : 2), emp + dice, { deadly: s.deadly });
                        const steps = [...p.steps, { cost: 1, text: `Throw ${s.label} at ${nameOf(f)} (${signed(b)}); ${immLabel(k, s, f)} on a hit` }, { cost: 1, text: `on a miss, ${base}: draw another from the sheath and throw at the same penalty (${signed(b)}); ${nameOf(f)} is off-guard to it, +${dice * 3} spirit` }];
                        let ev = e1.expected + (1 - e1.hit) * e2.expected + after(steps, f);
                        ev += tail(steps, f, left0 - 2, ctx.made + 2, at);
                        trPlan(f, `Throw at ${nameOf(f)}, Liar's Hidden Blade on a miss`, steps, ev, { notes: ["On a hit, keep the spark and throw again."] });
                        break;
                    }
                    case "blinding-of-the-needle": {
                        const e1 = strikeExpected(b, f.ac, emp, { deadly: s.deadly });
                        const c = degreeChances(f.saves?.fortitude ?? 0, dc);
                        const steps = [...p.steps, ...move, { cost: 2, text: `${base}: a Strike at ${nameOf(f)} with ${s.label} (${signed(b)}); on a hit it saves (Fortitude DC ${dc}, ${pct(c.f + c.cf)} to fail) or is blinded for a round, or until it spends an Interact` }];
                        let ev = e1.expected + e1.hit * (c.f + c.cf) * worth(board, "blinded") * 0.6 + after(steps, f, { adjacent, at });
                        ev += tail(steps, f, left0 - 2, ctx.made + 1, at);
                        trPlan(f, `Blinding of the Needle at ${nameOf(f)}`, steps, ev, { dest });
                        break;
                    }
                    case "coiling-serpents": {
                        if (!s.ranged && !s.thrown) break;
                        const e1 = strikeExpected(b, f.ac, emp, { deadly: s.deadly });
                        const c = degreeChances(f.saves?.reflex ?? 0, dc);
                        const steps = [...p.steps, { cost: 2, text: `${base}: a ranged Strike at ${nameOf(f)} with ${s.label} (${signed(b)}); on a hit it saves (Reflex DC ${dc}, ${pct(c.f + c.cf)} to fail) or is immobilized until it Escapes (DC ${dc})` }];
                        let ev = e1.expected + e1.hit * (c.f + c.cf) * worth(board, "immobilized") * 1.5 + after(steps, f);
                        ev += tail(steps, f, left0 - 2, ctx.made + 1, at);
                        trPlan(f, `Coiling Serpents at ${nameOf(f)}`, steps, ev);
                        break;
                    }
                    case "sever-four-dragonfly-wings": {
                        if (left0 < 3 || sq.route.actions) break;
                        const chain = foes.filter((g) => inReach(at, g.rect, reach)).sort((x, y) => x.ac - y.ac).slice(0, 4);
                        if (chain.length < 2 || chain[0] !== f || !(s.damageTypes ?? []).includes("slashing") && s.damageTypes?.length) break;
                        let ev = 0, pp = 1;
                        const shown = [];
                        for (const g of chain) { const e = strikeExpected(b, g.ac, emp, { deadly: s.deadly }); ev += pp * e.expected; shown.push(`${nameOf(g)} (${pct(pp * e.hit)})`); pp *= e.hit; }
                        const steps = [...p.steps, { cost: 3, text: `${base}: Strike ${shown.join(", then ")} with ${s.label} (${signed(b)} each, no penalty between them); the chain stops at the first miss` }];
                        ev += after(steps, chain[0], { adjacent, at });
                        trPlan(chain[0], `Sever Four Dragonfly Wings: ${chain.length} foes`, steps, ev, { notes: ["Start with the lowest AC: a miss ends the chain."] });
                        break;
                    }
                    case "plant-thirty-barbs": {
                        const e1 = strikeExpected(b, f.ac, emp, { deadly: s.deadly });
                        const barb = 2 * dieAvg(s);
                        const steps = [...p.steps, ...move, { cost: 1, text: `${base}: a Strike at ${nameOf(f)} with ${s.label} (${signed(b)}); on a hit it takes 2d${dieOf(s)} the first time it moves each turn for 1d4 rounds` }];
                        let ev = e1.expected + e1.hit * barb * 1.2 + after(steps, f, { adjacent, at });
                        ev += tail(steps, f, left0 - 1, ctx.made + 1, at);
                        trPlan(f, `Plant Thirty Barbs in ${nameOf(f)}`, steps, ev, { dest });
                        break;
                    }
                    case "burn-out-of-time": {
                        const e1 = strikeExpected(b, f.ac, emp + 27, { deadly: s.deadly });
                        const steps = [...p.steps, ...move, { cost: 2, text: `${base}: a Strike at ${nameOf(f)} with ${s.label} (${signed(b)}) for 3d8 spirit and 3d8 void more; a foe it drops is erased from the last round, and an ally it killed this round returns with 5d8 HP` }];
                        let ev = e1.expected + after(steps, f, { adjacent, at });
                        ev += tail(steps, f, left0 - 2, ctx.made + 1, at);
                        trPlan(f, `Burn out of Time at ${nameOf(f)}`, steps, ev, { dest });
                        break;
                    }
                    case "rejoin-in-flight": {
                        if (!(s.thrown || s.ranged) || feetBetween(me.rect, f.rect) > reach) break;
                        const e = strikeExpected(b, f.ac - (f.conditions?.has?.("off-guard") ? 0 : 2), emp, { deadly: s.deadly });
                        const steps = [...p.steps, { cost: 2, text: `${base}: two thrown Strikes at ${nameOf(f)} (${signed(b)} both; it's flanked, so off-guard); both hit, +1 weapon die; the weapons return` }];
                        let ev = 2 * e.expected + e.hit * e.hit * dieAvg(s) + after(steps, f);
                        ev += tail(steps, f, left0 - 2, ctx.made + 2, at);
                        trPlan(f, `Rejoin in Flight at ${nameOf(f)}`, steps, ev);
                        break;
                    }
                    case "topple-the-pillar-of-heaven": {
                        const inLine = foes.filter((g) => { const d = feetBetween(me.rect, g.rect); if (d > 60) return false; const ax = f.rect.x - me.rect.x, ay = f.rect.y - me.rect.y, bx = g.rect.x - me.rect.x, by = g.rect.y - me.rect.y; const len = Math.hypot(ax, ay) || 1; return Math.abs(ax * by - ay * bx) / len <= 1.01 && (ax * bx + ay * by) >= 0; });
                        if (!inLine.length || inLine[0] !== f) break;
                        const n = Math.max(6, Math.floor(lv / 2)), avg = n * 4.5;
                        let ev = 0;
                        const shown = [];
                        for (const g of inLine) { const e = saveExpected(g.saves?.reflex ?? 0, dc, avg); ev += e.expected; shown.push(`${nameOf(g)} (${pct(e.fail)} to fail)`); }
                        const steps = [...p.steps, { cost: 2, text: `${base}: a 60-foot line through ${shown.join(", ")}; ${n}d8 of your weapon's damage type, basic Reflex DC ${dc}` }];
                        ev += after(steps, f);
                        ev += tail(steps, f, left0 - 2, ctx.made, at);
                        trPlan(f, `Topple the Pillar of Heaven: ${inLine.length} foe${inLine.length > 1 ? "s" : ""} in a line`, steps, ev);
                        break;
                    }
                    case "heaven-rains-an-ending": {
                        if (left0 < 3 || !s.ranged) break;
                        const inCone = foes.filter((g) => feetBetween(me.rect, g.rect) <= reach && feetBetween(f.rect, g.rect) <= reach * 0.8);
                        if (inCone.length < 2 || inCone[0] !== f) break;
                        let ev = 0;
                        const shown = [];
                        for (const g of inCone) { const e = strikeExpected(b - 2, g.ac, emp, { deadly: s.deadly }); ev += e.expected; shown.push(`${nameOf(g)} (${signed(b - 2)})`); }
                        const steps = [...p.steps, { cost: 3, text: `${base}: one ranged Strike at every foe in a ${reach}-foot cone: ${shown.join(", ")}; one damage roll, all spirit; the penalty climbs only afterwards` }];
                        ev += after(steps, f);
                        trPlan(f, `Heaven Rains an Ending: ${inCone.length} foes`, steps, ev);
                        break;
                    }
                    case "fleeting-arc-through-heaven-and-earth": {
                        if (left0 < 3) break;
                        const inCone = foes.filter((g) => feetBetween(me.rect, g.rect) <= 60 && feetBetween(f.rect, g.rect) <= 45);
                        if (inCone[0] !== f) break;
                        let ev = 0;
                        const shown = [];
                        for (const g of inCone) { const e = saveExpected(g.saves?.fortitude ?? 0, dc, 63); ev += e.expected; shown.push(`${nameOf(g)} (${pct(e.fail)} to fail)`); }
                        const steps = [...p.steps, { cost: 3, text: `${base}: a 60-foot cone, 9d6 spirit and 9d6 of your weapon's type, basic Fortitude DC ${dc}: ${shown.join(", ")}; then teleport anywhere in the cone` }];
                        ev += after(steps, f);
                        trPlan(f, `Fleeting Arc through Heaven and Earth: ${inCone.length} foe${inCone.length > 1 ? "s" : ""}`, steps, ev);
                        break;
                    }
                    case "ringing-challenge": {
                        const near = foes.filter((g) => feetBetween(at, g.rect) <= 15);
                        if (near.length < 2 || near[0] !== f) break;
                        const n = Math.max(1, Math.floor((lv - 2) / 2)), avg = n * 5;
                        let ev = 0;
                        const shown = [];
                        for (const g of near) { const e = saveExpected(g.saves?.fortitude ?? 0, dc, avg); ev += e.expected; shown.push(`${nameOf(g)} (${pct(e.fail)} to fail)`); }
                        const steps = [...p.steps, ...move, { cost: 2, text: `${base}: a 15-foot emanation (or a 30-foot cone): ${n}d4 spirit and ${n}d4 sonic, basic Fortitude DC ${dc}: ${shown.join(", ")}; deafened a minute on a critical failure` }];
                        ev += after(steps, f, { adjacent, at });
                        ev += tail(steps, f, left0 - 2, ctx.made, at);
                        trPlan(f, `Ringing Challenge: ${near.length} foes`, steps, ev, { dest });
                        break;
                    }
                    default: break; // the rest are notes below
                }
            }
        }
        // when-notes for this weapon ikon's transcendences the plans don't build
        for (const t of trs) {
            if (t.slug === "unravel-the-future") out.notes.push(`Unravel the Future (1 action, transcendence of ${k.name}): a thread that turns one failure into a success, or a success into a critical, when +1 would have, within a minute; it spends the spark.`);
            if (t.slug === "break-the-suns-legs") out.notes.push(`Break the Sun's Legs (2 actions, transcendence of ${k.name}): 9th-rank darkness in 120 feet for a minute and greater darkvision for you; for a fight your side sees in the dark and theirs doesn't.`);
        }
        if (hasAny(actor, "red-gold-mortality") && imbuedInto(actor, "red-gold-mortality", ikons)?.slug === k.slug && spark?.slug === k.slug) out.notes.push(`Red-Gold Mortality: a foe ${k.name} damages heals only half (none on a critical failure) against your class DC for a minute; hit the one with fast healing or a healer.`);
        if (hasAny(actor, "hurl-at-the-horizon") && imbuedInto(actor, "hurl-at-the-horizon", ikons)?.slug === k.slug && spark?.slug === k.slug) out.notes.push(`Hurl at the Horizon: ${k.name} is thrown 15 feet (10 more if already thrown) while the spark is in it.`);
        if (hasAny(actor, "branched-tree-of-pain") && imbuedInto(actor, "branched-tree-of-pain", ikons)?.slug === k.slug && spark?.slug === k.slug) out.notes.push(`Branched Tree of Pain: ${k.name} critically hits on a 19 that would hit; about 5% more critical hits the plans don't count.`);
        if (hasAny(actor, "compliant-gold") && imbuedInto(actor, "compliant-gold", ikons)?.slug === k.slug) out.notes.push(`Compliant Gold: ${k.name} has reach while the spark is in it (10 more feet if it had reach); the sheet's reach carries it.`);
        if (hasAny(actor, "seven-colored-cosmic-bridge") && imbuedInto(actor, "seven-colored-cosmic-bridge", ikons)?.slug === k.slug && spark?.slug === k.slug) out.notes.push(`Seven-Colored Cosmic Bridge: after a hit with ${k.name}, teleport up to 10 feet for free; to a flank, or out of a foe's reach.`);
        if (hasAny(actor, "eternity-incinerating-blaze") && imbuedInto(actor, "eternity-incinerating-blaze", ikons)?.slug === k.slug) out.notes.push(`Eternity-Incinerating Blaze: a critical hit with ${k.name} leaves the foe doomed 1 (more each time), spark or no spark.`);
        if (hasAny(actor, "sunwrecker") && imbuedInto(actor, "sunwrecker", ikons)?.slug === k.slug && spark?.slug === k.slug) out.notes.push(`Sunwrecker: a critical hit with ${k.name} casts 2nd-rank darkness on the foe.`);
        if (hasAny(actor, "infinite-blades-celestial-arrow") && imbuedInto(actor, "infinite-blades-celestial-arrow", ikons)?.slug === k.slug && spark?.slug === k.slug) out.notes.push(`Infinite Blades: each hit with ${k.name} deals ${dice} spirit to up to two foes next to the target.`);
        if (hasAny(actor, "mated-birds-in-paired-flight") && imbuedInto(actor, "mated-birds-in-paired-flight", ikons)?.slug === k.slug && spark?.slug === k.slug) out.notes.push(`Mated Birds in Paired Flight: ${k.name} returns to your hand after a throw while the spark is in it.`);
    }

    // ======== worn and body ikons
    for (const k of ikons.filter((x) => x.kind !== "weapon")) {
        const p = pre(k);
        if (!p) continue;
        const avail = ctx.actions - p.cost;
        const trs = trOf(k);
        const trPlan = (f, title, steps, ev, extra = {}) => push({ title, target: f, ev, bias: extra.bias ?? 0.3, dest: extra.dest ?? null, steps, notes: [sparkNote(k), ...(extra.notes ?? [])].filter(Boolean) });
        const tail = (steps, f, left, made, at = me.rect) => { if (left < 1 || !f) return 0; const r = run(board.strikes, f, left, made, at); if (!r.used.length) return 0; steps.push({ cost: r.used.length, text: strikeText(f, r.used) }); return r.ev; };
        const nearest = foes.filter((f) => inReach(me.rect, f.rect, myReach(board)))[0] ?? null;
        const adjacent = foes.filter((o) => inReach(me.rect, o.rect, 5)).length;
        for (const t of trs) {
            if (avail < t.cost) continue;
            const base = `${t.name} (${t.cost} action${t.cost > 1 ? "s" : ""}, transcendence of ${k.name})`;
            switch (t.slug) {
                case "one-moment-till-glory": {
                    const hit = board.allies.filter((a) => feetBetween(me.rect, a.rect) <= 15 && SAVED.some((c) => a.conditions?.has?.(c)));
                    if (!hit.length) break;
                    let ev = 0;
                    const shown = [];
                    for (const a of hit) { const c = SAVED.filter((x) => a.conditions.has(x)); ev += 0.45 * worth(board, c[0]); shown.push(`${nameOf(a)} (${c.join(", ")})`); }
                    const steps = [...p.steps, { cost: 1, text: `${base}: ${shown.join(", ")} roll a new save at +2 against one effect; the worse result is ignored` }];
                    ev += after(steps, nearest, { adjacent });
                    ev += tail(steps, nearest, avail - 1, ctx.made);
                    trPlan(nearest, `One Moment till Glory for ${hit.length} all${hit.length > 1 ? "ies" : "y"}`, steps, ev, { notes: ["Until you Shift again, your side loses the wreath's +1 to attack rolls."] });
                    break;
                }
                case "break-free": {
                    const held = me.conditions?.has?.("grabbed") || me.conditions?.has?.("restrained");
                    for (const f of foes) {
                        const d = feetBetween(me.rect, f.rect);
                        if (!held && inReach(me.rect, f.rect, myReach(board))) continue; // the advisor's own Strikes do it
                        if (d > 2 * stride + myReach(board)) continue;
                        const sqs = reachableSquares(board, 2).filter((sq) => inReach({ ...me.rect, x: sq.x, y: sq.y }, f.rect, myReach(board)));
                        const at = sqs[0] ? { ...me.rect, x: sqs[0].x, y: sqs[0].y } : inReach(me.rect, f.rect, myReach(board)) ? me.rect : null;
                        if (!at) continue;
                        const r = run(board.strikes, f, 1, ctx.made, at);
                        if (!r.used.length) continue;
                        const steps = [...p.steps, { cost: 2, text: `${base}: ${held ? "Escape at +2, then " : ""}Stride up to ${2 * stride} feet in a straight line to ${nameOf(f)} and ${strikeText(f, r.used)}` }];
                        let ev = r.ev + (held ? 0.7 * worth(board, me.conditions.has("restrained") ? "restrained" : "grabbed") : 0) + after(steps, f, { adjacent: 1 });
                        ev += tail(steps, f, avail - 2, ctx.made + 1, at);
                        trPlan(f, `Break Free to ${nameOf(f)}`, steps, ev, { dest: at !== me.rect ? { x: at.x, y: at.y } : null, bias: held ? 0.5 : 0.3 });
                    }
                    break;
                }
                case "embrace-of-destiny": {
                    for (const f of foes) {
                        const d = feetBetween(me.rect, f.rect);
                        if (d > 20 || inReach(me.rect, f.rect, myReach(board))) continue;
                        const c = degreeChances(f.saves?.will ?? 0, dc);
                        const pull = c.f + c.cf;
                        const beside = { ...f.rect, x: me.rect.x + 1, y: me.rect.y }; // it lands adjacent: the Strikes reach
                        const r2 = run(board.strikes, { ...f, rect: beside }, avail - 1, ctx.made);
                        if (!r2.used.length) continue;
                        const steps = [...p.steps, { cost: 1, text: `${base}: ${nameOf(f)} saves (Will DC ${dc}, ${pct(pull)} to fail) or is pulled next to you` }, { cost: r2.used.length, text: `if it comes, ${strikeText(f, r2.used)}` }];
                        const ev = pull * r2.ev + after(steps, f, { adjacent });
                        trPlan(f, `Embrace of Destiny: pull ${nameOf(f)}`, steps, ev, { notes: ["If it saves, Stride to it instead with what's left."] });
                    }
                    break;
                }
                case "marathon-dash": {
                    for (const f of foes) {
                        if (inReach(me.rect, f.rect, myReach(board))) continue;
                        const sq = squareToReach(board, f, myReach(board), 1);
                        if (!sq || !sq.route.actions) continue;
                        const at = { ...me.rect, x: sq.x, y: sq.y };
                        const r = run(board.strikes, f, avail - 1, ctx.made, at);
                        if (!r.used.length) continue;
                        const friends = board.allies.filter((a) => feetBetween(me.rect, a.rect) <= 10 && a.canAct !== false);
                        const steps = [...p.steps, { cost: 1, text: `${base}: Stride into reach of ${nameOf(f)}${friends.length ? `; ${friends.map(nameOf).join(", ")} within 10 feet may Stride as a reaction` : ""}` }, { cost: r.used.length, text: strikeText(f, r.used) }];
                        const ev = r.ev + friends.length * 1 + after(steps, f, { adjacent: 1 });
                        trPlan(f, `Marathon Dash to ${nameOf(f)}`, steps, ev, { dest: { x: sq.x, y: sq.y }, notes: ["A plain Stride does the same for you alone; the dash is for bringing allies along, and it spends the sandals' +10 feet."] });
                    }
                    break;
                }
                case "raise-the-walls": {
                    const ally = board.allies.filter((a) => feetBetween(me.rect, a.rect) <= 15).sort((a, b) => (a.hp / (a.maxHp || 1)) - (b.hp / (b.maxHp || 1)))[0];
                    if (me.shieldRaised) break;
                    const steps = [...p.steps, { cost: 1, text: `${base}: Raise the aegis, and you${ally ? ` and ${nameOf(ally)}` : ""} get +1 AC, Reflex, and saves against force, spirit, vitality and void for a minute` }];
                    let ev = 1 + 0.15 * lv + (ally ? 0.8 + 0.1 * lv : 0) + after(steps, nearest, { adjacent });
                    ev += tail(steps, nearest, avail - 1, ctx.made);
                    trPlan(nearest, `Raise the Walls${ally ? ` with ${nameOf(ally)}` : ""}`, steps, ev, { bias: 0.2, notes: ["It replaces Raise a Shield this turn; the aegis's +1 AC aura is gone until you Shift again, so the net gain is the ally's and the Reflex."] });
                    break;
                }
                case "no-scar-but-this": {
                    const heal = 4.5 * Math.ceil(lv / 2);
                    if (missing < heal / 2) break;
                    const steps = [...p.steps, { cost: 1, text: `${base}: you regain ${Math.ceil(lv / 2)}d8 HP (about ${Math.round(heal)}; you're at ${me.hp}/${me.maxHp})` }];
                    let ev = 0.8 * Math.min(heal, missing) + after(steps, nearest, { adjacent });
                    ev += tail(steps, nearest, avail - 1, ctx.made);
                    trPlan(nearest, "No Scar but This", steps, ev, { bias: me.hp <= me.maxHp / 3 ? 0.5 : 0.3, notes: ["You lose Diehard and the +1 Fortitude until you Shift again."] });
                    break;
                }
                case "a-moment-unending": {
                    const prec = 3.5 * (lv >= 18 ? 3 : lv >= 10 ? 2 : 1);
                    for (const f of foes) {
                        const sq = squareToReach(board, f, myReach(board), avail - 2);
                        if (!sq) continue;
                        const left = avail - 1 - sq.route.actions;
                        if (left < 1) continue;
                        const at = sq.route.actions ? { ...me.rect, x: sq.x, y: sq.y } : me.rect;
                        const r = run(board.strikes, f, left, ctx.made, at);
                        if (!r.used.length) continue;
                        const pAny = 1 - r.used.reduce((t, u) => t * (1 - u.e.hit), 1);
                        const steps = [...p.steps, { cost: 1, text: `${base}: your next hit before the end of your next turn deals ${lv >= 18 ? 3 : lv >= 10 ? 2 : 1}d6 precision more` }];
                        if (sq.route.actions) steps.push({ cost: sq.route.actions, text: moveText(sq, f) });
                        steps.push({ cost: r.used.length, text: `${strikeText(f, r.used)} (${pct(pAny)} that one lands)` });
                        const ev = r.ev + pAny * prec + after(steps, f, { adjacent });
                        trPlan(f, `A Moment Unending, then Strike ${nameOf(f)}`, steps, ev, { dest: sq.route.actions ? { x: sq.x, y: sq.y } : null, notes: ["It spends the gaze's +2 AC against ranged attacks until you Shift again."] });
                    }
                    break;
                }
                case "captivating-charm": {
                    for (const f of foes.filter((x) => feetBetween(me.rect, x.rect) <= 30 && !x.mindless)) {
                        const c = degreeChances(f.saves?.will ?? 0, dc);
                        const steps = [...p.steps, { cost: 2, text: `${base}: ${nameOf(f)} saves (Will DC ${dc}, ${pct(c.f + c.cf)} to fail) or is fascinated by you until your next turn; it ends if you attack it, not its allies` }];
                        let ev = (c.f + c.cf) * worth(board, "fascinated") + after(steps, f, { adjacent });
                        const other = foes.find((o) => o !== f && inReach(me.rect, o.rect, myReach(board)));
                        ev += tail(steps, other, avail - 2, ctx.made);
                        trPlan(f, `Captivating Charm on ${nameOf(f)}`, steps, ev, { bias: 0.2, notes: ["Best on a caster or an archer you can't reach; Strike someone else afterwards."] });
                    }
                    break;
                }
                case "tangle-in-riddle": {
                    for (const f of foes.filter((x) => feetBetween(me.rect, x.rect) <= 30 && !x.mindless)) {
                        const c = degreeChances(f.saves?.will ?? 0, dc);
                        const w = worth(board, "stupefied");
                        const steps = [...p.steps, { cost: 1, text: `${base}: ${nameOf(f)} saves (Will DC ${dc}, ${pct(c.f + c.cf)} to fail): stupefied 1 for a round on a success, for 1d4 rounds on a failure, and confused too on a critical failure; then immune an hour` }];
                        let ev = c.s * w * 0.5 + c.f * w * 1.5 + c.cf * (w * 1.5 + worth(board, "confused") * 1.5) + after(steps, f, { adjacent });
                        ev += tail(steps, nearest, avail - 1, ctx.made);
                        trPlan(f, `Tangle in Riddle at ${nameOf(f)}`, steps, ev, { bias: 0.2, notes: ["For a caster: stupefied is a flat check to cast."] });
                    }
                    break;
                }
                case "mark-the-center": {
                    const cone = foes.filter((g) => feetBetween(me.rect, g.rect) <= 15);
                    if (!cone.length) break;
                    const d6 = 4 + Math.max(0, Math.floor((lv - 10) / 3));
                    const steps = [...p.steps, { cost: 1, text: `${base}: a 15-foot cone marks ${cone.map(nameOf).join(", ")} for a minute; the next Strike that damages each deals ${d6}d6 precision or vitality more` }];
                    let ev = cone.length * 0.85 * d6 * 3.5 + after(steps, nearest, { adjacent });
                    const left = avail - 1;
                    if (left >= 1 && nearest) { const r = run(board.strikes, nearest, left, ctx.made); if (r.used.length) { steps.push({ cost: r.used.length, text: `${strikeText(nearest, r.used)}; the first hit springs its mark` }); ev += r.ev; } }
                    trPlan(nearest, `Mark the Center: ${cone.length} foe${cone.length > 1 ? "s" : ""}`, steps, ev, { bias: 0.4 });
                    break;
                }
                case "heavy-is-the-crown": {
                    for (const f of foes.filter((x) => feetBetween(me.rect, x.rect) <= 60)) {
                        const burst = foes.filter((g) => feetBetween(f.rect, g.rect) <= 15);
                        if (burst.length < 2 || burst[0] !== f) continue;
                        let ev = 0;
                        const shown = [];
                        for (const g of burst) { const e = saveExpected(g.saves?.will ?? 0, dc, lv); ev += e.expected + e.fail * worth(board, "prone"); shown.push(`${nameOf(g)} (${pct(e.fail)} to fail)`); }
                        const steps = [...p.steps, { cost: 2, text: `${base}: a 15-foot burst on ${nameOf(f)}: ${shown.join(", ")} take ${lv} spirit, basic Will DC ${dc}, and kneel (prone) on a failure` }];
                        ev += after(steps, f, { adjacent });
                        ev += tail(steps, nearest, avail - 2, ctx.made);
                        trPlan(f, `Heavy is the Crown on ${burst.length} foes`, steps, ev);
                    }
                    break;
                }
                case "ringing-challenge": {
                    const near = foes.filter((g) => feetBetween(me.rect, g.rect) <= 15);
                    if (near.length < 2) break;
                    const n = Math.max(1, Math.floor((lv - 2) / 2));
                    let ev = 0;
                    const shown = [];
                    for (const g of near) { const e = saveExpected(g.saves?.fortitude ?? 0, dc, n * 5); ev += e.expected; shown.push(`${nameOf(g)} (${pct(e.fail)} to fail)`); }
                    const steps = [...p.steps, { cost: 2, text: `${base}: ${n}d4 spirit and ${n}d4 sonic in a 15-foot emanation (or a 30-foot cone): ${shown.join(", ")}, basic Fortitude DC ${dc}; deafened a minute on a critical failure` }];
                    ev += after(steps, nearest, { adjacent });
                    ev += tail(steps, nearest, avail - 2, ctx.made);
                    trPlan(nearest, `Ringing Challenge: ${near.length} foes`, steps, ev);
                    break;
                }
                default: break;
            }
        }
        // -- Shift to an aura ikon: the party's +1 to hit (the wreath) or +1 AC (the aegis), then Strikes
        if (p.steps.length && avail >= 1 && ["victors-wreath", "mirrored-aegis"].includes(k.slug)) {
            const n = 1 + board.allies.filter((a) => feetBetween(me.rect, a.rect) <= 15 && a.canAct !== false && (k.slug === "mirrored-aegis" || a.hasMelee !== false)).length;
            const gain = k.slug === "victors-wreath" ? 0.1 * 8 * 2 * n : 0.8 * n;
            const f = nearest ?? foes[0];
            const steps = [...p.steps];
            let ev = gain;
            if (f) ev += tail(steps, f, avail, ctx.made);
            if (steps.length > p.steps.length || !f) push({ title: `Shift Immanence to ${k.name}`, target: f ?? null, ev, bias: 0.2, steps, notes: [`${n} of you in its 15 feet now.`, spark && !away ? `You lose ${spark.name}'s immanence (${spark.immText}).` : null].filter(Boolean) });
        }
        // when-notes for the transcendences the plans don't build
        for (const t of trs) {
            const cost = `${t.cost} action${t.cost > 1 ? "s" : ""}, transcendence of ${k.name}`;
            if (t.slug === "feed-the-masses") { const hurt = board.allies.filter((a) => feetBetween(me.rect, a.rect) <= 60 && a.maxHp && a.hp <= a.maxHp / 2); if (hurt.length) out.notes.push(`Feed the Masses (${cost}): drink an elixir from the horn and ${nameOf(hurt[0])} gets its effect at 60 feet (an elixir of life's healing can be split); the horn's daily elixir is a minor elixir of life unless you chose otherwise.`); }
            if (t.slug === "survive-the-wilds") out.notes.push(`Survive the Wilds (${cost}): re-attune the pelt and give yourself and allies within 15 feet +2 AC and saves against that trait until your next turn; for a foe whose breath or spells you've seen.`);
            if (t.slug === "bear-allies-burdens") out.notes.push(`Bear Allies' Burdens (${cost}): Stride carrying a willing ally and set them down anywhere along the way; for a downed or slow ally that needs to be elsewhere.`);
            if (t.slug === "crash-against-me") out.notes.push(`Crash Against Me (${cost}): resistance ${lv} to your attuned physical type until your next turn; a foe whose weapon of that type bounces off is off-guard and at -2 with it. For a turn you'll stand in front of a hitter.`);
            if (t.slug === "brandish-the-gorgons-gaze") out.notes.push(`Brandish the Gorgon's Gaze (${cost}): Raise the aegis; a melee attack you Shield Block before your next turn leaves its owner slowed 1 for a minute on a failed Fortitude save (DC ${dc}).`);
            if (t.slug === "race-the-skies") out.notes.push(`Race the Skies (${cost}): a fly Speed of ${Math.max(stride, 20)} feet for a minute; for a foe above you or across a gap.`);
            if (t.slug === "spasm-of-the-berserker") out.notes.push(`Spasm of the Berserker (${cost}): a 4th-rank enlarge (+2 damage, reach, clumsy 1) and a 6th-rank moon frenzy (jaws and claws, temporary HP, +10 Speed) until the end of your next turn; re-empower the ikon and it's a free action to extend.`);
            if (t.slug === "only-you-and-i") { if (nearest) out.notes.push(`Only You and I (${cost}): ${nameOf(nearest)} gets +2 to hit you, but moving away, hitting anyone else or casting past you costs it a Will save (DC ${dc}) or the action is lost, and each miss on you heals you 1d8+5.`); }
            if (t.slug === "shed-the-mortal-skin") out.notes.push(`Shed the Mortal Skin (${cost}): ends persistent fire or acid on you; the next hit you take grows an herb next to you that heals whoever eats it for half that damage.`);
            if (t.slug === "a-challenge-for-heroes") { if (nearest) out.notes.push(`A Challenge for Heroes (${cost}): ${nameOf(nearest)} deals 10 spirit more to you per hit for a minute, and every time it does, each ally with it in reach gets a Reactive Strike on it.`); }
            if (t.slug === "skirt-the-underworld") out.notes.push(`Skirt the Underworld (${cost}): invisible for a round and Fly your Speed; foes you pass next to save (Fortitude DC ${dc}) or are blinded a minute. Incapacitation: for foes of your level or lower. Not undead.`);
            if (t.slug === "unravel-the-future") out.notes.push(`Unravel the Future (${cost}): a thread that turns one failure into a success, or a success into a critical, when +1 would have, within a minute.`);
        }
        if (hasAny(actor, "leap-the-falls") && imbuedInto(actor, "leap-the-falls", ikons)?.slug === k.slug && spark?.slug === k.slug) out.notes.push(`Leap the Falls: Quick Jump and Powerful Leap while the spark is in ${k.name}; a Leap is one action and goes 5 feet further.`);
        if (hasAny(actor, "destined-victory") && imbuedInto(actor, "destined-victory", ikons)?.slug === k.slug && spark?.slug === k.slug) out.notes.push("Destined Victory: a foe that hits you in melee gives you +2 AC against its next attack before your turn.");
        if (hasAny(actor, "warped-by-rage") && imbuedInto(actor, "warped-by-rage", ikons)?.slug === k.slug && spark?.slug === k.slug) out.notes.push("Warped by Rage: a 4th-rank enlarge while the spark is in the ikon (+2 damage, reach +5, clumsy 1); the sheet's Strikes carry it when you took it.");
        if (hasAny(actor, "journey-of-the-sky-chariot") && imbuedInto(actor, "journey-of-the-sky-chariot", ikons)?.slug === k.slug && spark?.slug === k.slug) out.notes.push("Journey of the Sky Chariot: you stay aloft at the end of your turn without a Fly action.");
        if (hasAny(actor, "gift-of-the-immortal-herb") && imbuedInto(actor, "gift-of-the-immortal-herb", ikons)?.slug === k.slug) out.notes.push("Gift of the Immortal Herb: ten minutes of the spark in the ikon regrows a lost limb or organ.");
    }

    // ======== the spark's choice, when no plan uses it this turn (a dormant spark or an ikon with nothing to do)
    if (!spark && !away && ctx.actions >= 1 && !out.plans.length) {
        const w = ikons.find((k) => k.kind === "weapon") ?? ikons[0];
        out.notes.push(`Shift Immanence to ${w.name} (${rapid ? "free" : "1 action"}): ${w.immText}.`);
    }

    // ======== feats and features: when-notes, in level order
    const ro = actor?.rollOptions?.all ?? {};
    const energized = Object.keys(ro).map((x) => /^energized-spark:(\w+)$/.exec(x)?.[1]).filter(Boolean);
    if (has(actor, "energized-spark")) {
        const resistSpirit = foes.filter((f) => (f.iwr?.resist ?? []).some((r) => r.type === "spirit") || (f.iwr?.immune ?? []).includes("spirit"));
        out.notes.push(`Energized Spark: your exemplar spirit damage can be ${energized.length ? energized.join(" or ") : "your chosen type"} instead${resistSpirit.length ? `; ${resistSpirit.map(nameOf).join(", ")} ${resistSpirit.length > 1 ? "resist" : "resists"} spirit as far as you know` : ""}.`);
    }
    if (has(actor, "sanctified-soul")) out.notes.push("Sanctified Soul: your spirit damage is sanctified; it bites harder on a foe of the opposite sanctity.");
    if (has(actor, "vow-of-mortal-defiance") && !effect(actor, /vow-of-mortal-defiance/)) out.notes.push("Vow of Mortal Defiance (1 action): swear against one holy or unholy foe within 60 feet; your first damage to it each round deals 1d6 spirit more until one of you is down. Only for a foe that is holy or unholy.");
    if (has(actor, "humble-strikes") && board.strikes.some((s) => s.item?.system?.category === "simple")) out.notes.push("Humble Strikes: your simple weapons' dice are one step larger; the sheet carries it.");
    if (has(actor, "twin-stars")) out.notes.push("Twin Stars: an Interact splits your one-handed weapon ikon into two twins (and back); the spark empowers both.");
    if (has(actor, "only-the-worthy")) out.notes.push("Only the Worthy: Release an ikon over an adjacent foe and spend an action to fix it there; the foe needs Athletics against your class DC to Stand or move, and you can't use the ikon meanwhile.");
    if (has(actor, "topple-the-titans") && me.athletics != null && foes.some((f) => (f.sizeRank ?? 2) > (me.sizeRank ?? 2))) out.notes.push(`Topple the Titans (1 action, once a minute): right after you Trip a larger foe, the same Athletics result Trips every foe within 10 feet of it.`);
    if (has(actor, "flow-of-war")) { const n = usesLeft(actor, "flow-of-war"); out.notes.push(n > 0 ? "Flow of War (free as your turn begins, once an hour): quickened this turn for a Strike or a Stride; the plans don't count the fourth action, so add one." : "Flow of War: used this hour."); }
    if (has(actor, "spirit-striking") || has(actor, "greater-spirit-striking")) out.notes.push(`Spirit Striking: ${has(actor, "greater-spirit-striking") ? "4 to 8" : "2 to 4"} spirit on every weapon or unarmed hit by your proficiency; the sheet carries it, spark or no spark.`);
    for (const e of DOMINION.filter((x) => hasAny(actor, x))) {
        const crit = {
            "born-of-the-bones-of-the-earth": "a critical hit on earth or stone mires the foe: immobilized until it Escapes",
            "dancer-in-the-seasons": "a critical hit lets you Step for free",
            "of-verse-unbroken": `a critical hit stupefies 1 unless the foe saves (DC ${dc})`,
            "peerless-under-heaven": "your critical hits get the weapon group's critical specialization (the grievous rune's if you had it already)",
            "plunderer-of-the-hives-riches": "a critical hit gives you temporary HP equal to half the foe's level",
            "restless-as-the-tide": "a critical hit splashes bludgeoning equal to your weapon dice on the foe and everyone within 10 feet of it (your allies too)",
            "trespasser-in-deaths-realm": `a critical hit enfeebles 1 for a minute unless the foe saves (Will DC ${dc})`,
            "whose-cry-is-thunder": `a critical hit knocks the foe prone and deafens it for a minute unless it saves (Fortitude DC ${dc})`,
        }[e];
        out.notes.push(`Dominion: ${crit}.`);
    }
    if (epithets.length) out.notes.push(`After a transcendence you get one epithet ability: ${epithets.map((e) => EPITHET_NAMES[e] ?? e).join(", ")}; the plans pick the one worth most.`);
    if (has(actor, "additional-ikon")) out.notes.push(`Additional Ikon: ${ikons.length} ikons; the spark still sits in one at a time.`);
    if (has(actor, "exult-in-violence")) { const n = foes.filter((f) => feetBetween(me.rect, f.rect) <= 30).length; out.notes.push(`Exult in Violence (1 action, after a critical hit this turn): a pillar of light for ${lv >= 17 ? "10d6" : lv >= 12 ? "7d6" : "5d6"} spirit, basic save DC ${dc}, on a random other foe within 30 feet of the one you hit${n >= 2 ? "" : "; needs a second foe near"}.`); }
    if (has(actor, "fish-from-the-falls-edge") || hasAny(actor, "fish-from-the-falls-edge")) out.notes.push(`Fish from the Falls' Edge (reaction, once a day${usesLeft(actor, "fish-from-the-falls-edge") ? "" : ", used"}): when a living creature within 30 feet would die, it lives and regains ${Math.floor(lv / 2)}d8 HP; your spark goes with it until your next turn. It needs the spark in an ikon now.`);
    if (has(actor, "rapid-spark")) out.notes.push(rapid ? "Rapid Spark: your first Shift this turn is free (once a day); the plans count it." : usesLeft(actor, "rapid-spark") > 0 ? "Rapid Spark (free as your turn begins, once a day): a free Shift Immanence." : "Rapid Spark: used today.");
    if (has(actor, "extract-vow-of-nonviolence")) out.notes.push(`Extract Vow of Nonviolence (2 actions): Diplomacy or Intimidation against a weapon's wielder's Will DC; a success gives you resistance ${Math.floor(lv / 2)} to that weapon for a while. For the one big hitter.`);
    if (hasAny(actor, "complete-the-heros-journey")) out.notes.push(`Complete the Hero's Journey (1 action, once per 10 minutes): after transcending two different ikons in the last 10 minutes, with the spark in a third, transcend it as a 3-action heal or harm at rank ${Math.ceil(lv / 2)} instead.`);
    for (const [slug, name, what] of [["battle-hymn-to-the-lost", "Battle Hymn to the Lost", "a Strike plus spirits in a 15-foot cone (or a burst at range) for 4d10 (more at 12) with a basic save, and allies there who are dying regain that much"], ["forward-gaze-into-life", "Forward Gaze into Life", "two 15-foot cones, one ahead with vitality and one behind with void, basic save; stand between two groups"], ["raise-island", "Raise Island", "foes in a 20-foot burst save or are swept 15 feet and knocked prone, then a 10-foot pillar rises under you and you Strike one in reach"], ["rejoice-in-solstice-storm", "Rejoice in Solstice Storm", `${5 + Math.max(0, Math.floor((lv - 8) / 2))}d8 in a 30-foot emanation around you, four seasons with their own critical failures, basic save; your allies are in it too`], ["as-a-thousand-soldiers", "As a Thousand Soldiers", "fly twice your Speed as bees through any gap, no reactions, stinging every foe you pass for 3d4 piercing and poison (more at 10)"]]) {
        if (!has(actor, slug)) continue;
        const n = usesLeft(actor, slug);
        const near = foes.filter((f) => feetBetween(me.rect, f.rect) <= 30).length;
        out.notes.push(`${name} (once an hour${n ? "" : ", used"}): ${what}. Worth it when it catches two or more${near >= 2 ? ` (${near} foes within 30 feet now)` : ""}.`);
    }
    if (has(actor, "strike-rivers-seize-winds")) out.notes.push("Strike Rivers, Seize Winds (once an hour, each once a day): wall of stone, control water, the like, on your class DC, by strength alone; they can't be counteracted.");
    if (has(actor, "cutting-without-blade")) out.notes.push("Cutting Without Blade: every ikon feat applies to every ikon it could, and any object in hand becomes the ikon as a free action before or after you use it.");
    if (has(actor, "reach-for-immortality")) out.notes.push(`Reach for Immortality (once a day${usesLeft(actor, "reach-for-immortality") ? "" : ", used"}): when you would die, a free transcendence keeps you at 0 HP, clears your conditions, heals half your HP, Stands you and puts the spark where you like.`);
    if (has(actor, "remake-the-world")) out.notes.push(`Remake the World (once a day${usesLeft(actor, "remake-the-world") ? "" : ", used"}): any common divine spell of 8th rank or lower on your class DC, uncounterable.`);
    if (has(actor, "unassailable-soul") || has(actor, "greater-unassailable-soul")) out.notes.push("Unassailable Soul: a success on a Will save is a critical success for you.");
    if (has(actor, "mortality-reforged")) out.notes.push("Mortality Reforged: a success on a Fortitude save is a critical success for you.");
}

export { exemplar };
