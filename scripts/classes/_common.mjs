/**
 * PF2e Tactics: classes/_common.mjs
 * Helpers every class read uses. A class read is a function (board, ctx, out) in classes/<class>.mjs:
 *   board  the advice board (player.mjs adviceBoard): me, strikes, spells, profiles, enemies (estimates, never sheets),
 *          allies, field, sneak...; the read may mark it (board.sneak, markOffGuard) before the advisor plans
 *   ctx    { actions, made, spent }: actions left this turn, attacks already made (for the multiple attack penalty),
 *          actions already spent
 *   out    { plans: [], notes: [] }: plans in the advisor's shape ({ kind, title, target, ev, score, dest, steps:
 *          [{ cost, text }], notes }), notes as plain sentences for the Your Class card
 * Wording is for the player ("you", "your"), in the house voice: plain, concrete, no exclamation marks.
 */
import { rules, signed, slugOf } from "../shared.mjs";
import { degreeChances, feetBetween, inReach, mapFor, slotsByRank, strikeExpected, strikeMap, saveExpected } from "../reader.mjs";
import { CONDITION_VALUE, FOE_GUESS, hitWorth } from "../values.mjs";
import { isOffGuard, nameOf, reachableSquares } from "../advisor.mjs";

const half = (n) => Math.floor((Number(n) || 0) / 2 / 5) * 5;
const pct = (x) => `${Math.round(x * 100)}%`;
/** A slug with any possessive folded the way Foundry folds it, so "hunter-s-aim" (the catalog's spelling) and "hunters-aim" match. */
const slugKey = (s) =>
    String(s ?? "")
        .toLowerCase()
        .replace(/['\u2019]/g, "")
        .replace(/([a-z0-9])-s(?=-|$)/g, "$1s");
function has(actor, slug) {
    const want = slugKey(slug);
    return !!actor?.items?.some?.((i) => ["feat", "action"].includes(i.type) && slugKey(slugOf(i)) === want);
}
/**
 * Does this Strike carry Sneak Attack? Agile or finesse melee, any ranged (a thrown melee weapon must be agile or finesse
 * too); a ruffian adds simple weapons to d8 and martial or advanced ones to d6. Unknown weapons get the benefit of the doubt.
 */
function sneaky(s, ruffian = false) {
    const t = s.traits ?? [];
    if (t.includes("agile") || t.includes("finesse")) return true;
    if (s.ranged && !s.thrown) return true;
    if (ruffian) {
        const die = Number(String(s.die ?? s.item?.system?.damage?.die ?? "").replace("d", "")) || 0;
        const cat = String(s.category ?? s.item?.system?.category ?? "");
        if (!die || !cat) return true;
        return cat === "simple" ? die <= 8 : die <= 6;
    }
    return false;
}
/** Half the character's level, rounded down (Player Core's "half your level"); `half()` is for distances. */
const halfLevel = (board) => Math.floor((board.me.level ?? 1) / 2);
/** Uses left today of a feat or action with a frequency (system.frequency.value), or null when it has none. */
function usesLeft(actor, slug) {
    const want = slugKey(slug);
    // a class feature and its action can share a slug (Overdrive): the one with a frequency is the one that counts
    const all = actor?.items?.filter?.((x) => ["feat", "action"].includes(x.type) && slugKey(slugOf(x)) === want) ?? [];
    const i = all.find((x) => x.system?.frequency?.max != null) ?? all[0];
    const f = i?.system?.frequency;
    if (!i || !f || f.max == null) return null;
    return Number(f.value ?? f.max) || 0;
}
/**
 * The standard DC for a level, read from the PF2e system's own table (kit pf2e-rules; T20), plus adj; null when the table
 * couldn't be read (the GM has been told). standardOdds gives even odds then, and dcWords says "the level's standard DC".
 */
const standardDC = (lv, adj = 0) => {
    const dc = rules.dcByLevel(Math.max(0, Math.min(25, Math.round(Number(lv) || 0))));
    return dc === null ? null : dc + adj;
};
const EVEN_ODDS = { cs: 0.05, s: 0.45, f: 0.45, cf: 0.05 };
const standardOdds = (mod, lv, adj = 0) => {
    const dc = standardDC(lv, adj);
    return dc === null ? EVEN_ODDS : degreeChances(mod, dc);
};
const dcWords = (lv, adj = 0) => {
    const dc = standardDC(lv, adj);
    return dc === null ? "the level's standard DC" : `DC ${dc}`;
};
/** A ChoiceSet's choice on an item (item.flags.pf2e.rulesSelections[flag]), by the item's slug. */
function choiceOf(actor, slug, flag) {
    const want = slugKey(slug);
    const i = actor?.items?.find?.((x) => slugKey(slugOf(x)) === want);
    return i?.flags?.pf2e?.rulesSelections?.[flag] ?? null;
}
/** A plan that casts a slot spell joins spell thrift: attach the board's spell (or { name, rank }) as plan.spell / plan.slot. */
const spendsSlot = (plan, spell, rank) =>
    spell && typeof spell === "object" && spell.name
        ? Object.assign(plan, { spell: rank ? { ...spell, rank } : spell })
        : Object.assign(plan, { slot: { name: String(spell ?? "a spell"), rank: Number(rank) || 1 } });
/** Any of these slugs. */
const hasAny = (actor, ...slugs) => slugs.flat().some((s) => has(actor, s));
function effect(actor, re) {
    return actor?.items?.find?.((i) => ["effect", "condition"].includes(i.type) && re.test(slugOf(i))) ?? null;
}
const canMove = (c) => c.canAct !== false && !["immobilized", "grabbed", "restrained", "paralyzed", "unconscious"].some((x) => c.conditions?.has?.(x));
const level = (board) => board.me.level ?? 1;
/** A rough worth, in damage, of a condition on a foe at this level (the advisor's table scaled by hits). */
const worth = (board, cond, mult = 1) => (CONDITION_VALUE[cond] ?? 2) * Math.max(1, hitWorth(level(board)) / 8) * mult;

/**
 * The best melee (or, with melee: false, ranged) Strike and what it's expected to do against t, with the attacks
 * already made.
 */
/**
 * One Strike s at t with this attack bonus, counting what a class read marked on the board: off-guard to this Strike
 * only (s.offGuardVs: Gang Up for melee, T5), its own extra damage (s.extra, T7), and sneak dice (s.sneak or
 * board.sneak) when t is off-guard to it, unless t is immune to precision.
 */
function strikeOn(board, s, t, bonus, { acAdj = 0, extra = 0 } = {}) {
    const offAlready = isOffGuard(t);
    const og = s.offGuardVs?.has?.(t.id) && !t.offGuardWhy && !offAlready ? -2 : 0;
    const precisionImmune = (t.iwr?.immune ?? []).includes("precision");
    const sneak = (offAlready || og) && s.sneaky !== false && !precisionImmune ? (s.sneak ?? board.sneak ?? 0) : 0;
    return strikeExpected(bonus, t.ac + acAdj + og, s.avg + extra + (s.extra ?? 0) + sneak, { deadly: s.deadly });
}
function bestStrike(board, t, { made = 0, melee = true, acAdj = 0, extra = 0 } = {}) {
    let best = null;
    for (const s of board.strikes.filter((s) => (melee ? !s.ranged : s.ranged))) {
        const bonus = s.bonus + strikeMap(s, made);
        const e = strikeOn(board, s, t, bonus, { acAdj, extra });
        if (!best || e.expected > best.e.expected) best = { s, bonus, e };
    }
    return best;
}
/**
 * A square within maxActions (default one) from which the character reaches t, or null; { route } with actions 0 when
 * already there.
 */
function squareToReach(board, t, reach = 5, maxActions = 1) {
    const me = board.me;
    if (inReach(me.rect, t.rect, reach)) return { x: me.rect.x, y: me.rect.y, route: { actions: 0, provokes: [], via: null } };
    const sqs = reachableSquares(board, maxActions).filter(
        (sq) => sq.route.actions >= 1 && inReach({ x: sq.x, y: sq.y, w: me.rect.w, h: me.rect.h, z: sq.z ?? me.rect.z }, t.rect, reach)
    );
    sqs.sort((a, b) => a.route.actions - b.route.actions || a.route.provokes.length - b.route.provokes.length);
    return sqs[0] ?? null;
}
/** The character's melee reach: its longest melee Strike's. */
const myReach = (board) => Math.max(5, ...board.strikes.filter((s) => !s.ranged).map((s) => s.reach || 5));
const allySpeed = (a) =>
    Number(a.actor?.system?.movement?.speeds?.land?.value ?? a.actor?.system?.attributes?.speed?.value ?? a.actor?.attributes?.speed?.total) || 25;
const moveText = (sq, t) => `${sq.route.via ?? "Stride"}${sq.route.actions > 1 ? ` ×${sq.route.actions}` : ""} into reach of ${nameOf(t)}`;

/** A foe this character counts as off-guard for a reason the board doesn't show: the estimate drops by 2 and the plans see it. */
function markOffGuard(board, e, why) {
    // a foe already off-guard (prone, grabbed...) has the -2 in its AC already; marking it again adds nothing
    if (!e.offGuardWhy) {
        if (!(e.conditions && isOffGuard(e))) e.ac -= 2;
        e.conditions = new Set([...(e.conditions ?? []), "off-guard"]);
        e.offGuardWhy = [];
    }
    e.offGuardWhy.push(why);
}
/** Foes the read may plan against: never a hidden one (the helper's policy; the advisor's own plans are filtered the same way). */
const targets = (board) => board.enemies.filter((e) => e.state !== "hidden");
/** A run of Strikes at t: best Strike each time, the penalty climbing. extra: flat damage on each; acAdj: on t's AC. */
function strikeRun(board, t, n, { made = 0, extra = 0, acAdj = 0, melee = true } = {}) {
    const used = [];
    let ev = 0;
    for (let i = 0; i < n; i++) {
        const b = bestStrike(board, t, { made: made + used.length, extra, acAdj, melee });
        if (!b) break;
        used.push(b);
        ev += b.e.expected;
    }
    return {
        used,
        ev,
        text: used.length
            ? `Strike ${nameOf(t)} with ${used[0].s.label}${used.length > 1 ? ` ${used.length === 2 ? "twice" : "three times"}` : ""} (${used.map((u) => signed(u.bonus)).join(", ")})`
            : ""
    };
}
/** Spells the character can cast: not consumables, with an action cost, and passing test. */
const castable = (board, test = () => true) => (board.spells ?? []).filter((sp) => !sp.consumable && sp.cost !== null && test(sp));
/** Focus Points left, or null when the character has no pool. */
const focusLeft = (actor) => {
    const f = actor?.system?.resources?.focus;
    return f && f.max > 0 ? Number(f.value) || 0 : null;
};

/* ---- small helpers the class reads share ---- */
/** An effect on the sheet that's still running (not expired, time left), or null (T8). */
function effectUp(actor, re) {
    const e = effect(actor, re);
    if (!e) return null;
    const rd = e.remainingDuration;
    if (rd && (rd.expired || (Number.isFinite(Number(rd.remaining)) && Number(rd.remaining) <= 0))) return null;
    return e;
}
/** A skill: { mod, rank, label }, from the sheet, else the board's number for it; null when neither has it (T8). */
const skillMod = (board, k) => {
    const sk = board.me.actor?.skills?.[k];
    const mod = sk?.mod ?? board.me[k];
    return mod == null ? null : { mod: Number(mod) || 0, rank: sk?.rank ?? (sk?.proficient ? 1 : 0), label: sk?.label ?? k[0].toUpperCase() + k.slice(1) };
};
/** No one stands on that square (true when the board can't say) (T8). */
const freeSquare = (board, x, y) => !board.occupant?.get?.(`${x},${y}`);
/** A creature's best melee Strike, { bonus, avg }: its Reactive Strike on the board, else a creature of its level's
 *  (FOE_GUESS) (T8, T20). */
const allyStrike = (c, lv = 1) => c?.reactiveStrike ?? { bonus: FOE_GUESS.attack(c?.level ?? lv), avg: FOE_GUESS.damage(c?.level ?? lv) };
/** An ability modifier from the sheet ("str", "dex"...). */
const abil = (actor, k) => Number(actor?.abilities?.[k]?.mod ?? actor?.system?.abilities?.[k]?.mod) || 0;
/** " twice", " three times", " 4 times" (nothing for one). */
const times = (n) => (n <= 1 ? "" : n === 2 ? " twice" : n === 3 ? " three times" : ` ${n} times`);
/** 1st, 2nd, 3rd, 4th... */
const ordinal = (r) => `${r}${r === 1 ? "st" : r === 2 ? "nd" : r === 3 ? "rd" : "th"}`;
const lc = (s) =>
    String(s ?? "")
        .toLowerCase()
        .trim();
/** The class DC from the sheet, else 10 + level + key ability (4) + proficiency (expert and master at the class's levels). */
const classDC = (actor, lv, { expertAt = 9, masterAt = 17 } = {}) =>
    Number(actor?.classDC?.value ?? actor?.system?.attributes?.classDC?.value) || 10 + lv + 4 + (lv >= masterAt ? 6 : lv >= expertAt ? 4 : 2);
/** "Strike Foe with Longsword twice (+12, +7)", from a strikeRun's used list ({ s, bonus }). */
const strikeText = (f, used, tail = "") =>
    `Strike ${nameOf(f)} with ${used[0].s.label}${times(used.length)} (${used.map((u) => signed(u.bonus)).join(", ")})${tail}`;
/** A Strike's weapon die size (8 for a d8), from the board's shorthand or the item; fallback when neither says. */
const dieOf = (s, fallback = 0) => Number(String(s?.die ?? s?.item?.system?.damage?.die ?? "").replace("d", "")) || fallback;
/** Its number of weapon dice; fallback when it doesn't say. */
const diceOf = (s, fallback = 1) => Number(s?.dice ?? s?.item?.system?.damage?.dice) || fallback;
/** The average of n dice of size d. */
const diceAvg = (n, d) => (n * (d + 1)) / 2;
/** A spell marked signature on the sheet. */
const isSignature = (sp) => !!(sp.signature ?? sp.spell?.system?.location?.signature);
/**
 * Spell slots left by rank across the actor's slot entries (focus, innate and ritual entries skipped): [{ rank, left,
 * max }].
 */
/** Spell slots left and in all at each rank, lowest first: [{ rank, left, max }] (slotsByRank in reader.mjs, as a list). */
function slotsLeft(actor) {
    return Object.entries(slotsByRank(actor))
        .map(([rank, v]) => ({ rank: Number(rank), left: v.left, max: v.max }))
        .sort((x, y) => x.rank - y.rank);
}

export {
    abil,
    classDC,
    diceAvg,
    diceOf,
    dieOf,
    isSignature,
    lc,
    ordinal,
    slotsLeft,
    strikeText,
    times,
    bestStrike,
    canMove,
    castable,
    choiceOf,
    effect,
    focusLeft,
    has,
    hasAny,
    half,
    halfLevel,
    slugKey,
    sneaky,
    spendsSlot,
    standardDC,
    standardOdds,
    dcWords,
    effectUp,
    skillMod,
    freeSquare,
    allyStrike,
    usesLeft,
    level,
    markOffGuard,
    moveText,
    myReach,
    allySpeed,
    pct,
    slugOf,
    squareToReach,
    strikeRun,
    strikeOn,
    targets,
    worth,
    degreeChances,
    feetBetween,
    inReach,
    mapFor,
    strikeExpected,
    saveExpected,
    CONDITION_VALUE,
    nameOf,
    reachableSquares,
    signed
};
