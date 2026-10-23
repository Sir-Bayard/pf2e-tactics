/**
 * PF2e Tactics: classes/_common.mjs
 * Helpers every class read uses. A class read is a function (board, ctx, out) in classes/<class>.mjs:
 *   board  the advice board (player.mjs adviceBoard): me, strikes, spells, profiles, enemies (estimates, never sheets),
 *          allies, field, sneak...; the read may mark it (board.sneak, markOffGuard) before the advisor plans
 *   ctx    { actions, made }: actions left this turn, attacks already made (for the multiple attack penalty)
 *   out    { plans: [], notes: [] }: plans in the advisor's shape ({ kind, title, target, ev, score, dest, steps:
 *          [{ cost, text }], notes }), notes as plain sentences for the Your Class card
 * Wording is for the player ("you", "your"), in the house voice: plain, concrete, no exclamation marks.
 */
import { signed } from "../shared.mjs";
import { degreeChances, feetBetween, inReach, mapFor, strikeExpected, saveExpected } from "../reader.mjs";
import { CONDITION_VALUE, isOffGuard, nameOf, reachableSquares } from "../advisor.mjs";

const half = (n) => Math.floor((Number(n) || 0) / 2 / 5) * 5;
const pct = (x) => `${Math.round(x * 100)}%`;
/** An item's slug as Foundry makes it: apostrophes drop ("Hunter's Aim" -> "hunters-aim"). */
const slugOf = (i) => i?.slug ?? i?.system?.slug ?? (i?.name ?? "").toLowerCase().replace(/['\u2019]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** A slug with any possessive folded the way Foundry folds it, so "hunter-s-aim" (the catalog's spelling) and "hunters-aim" match. */
const slugKey = (s) => String(s ?? "").toLowerCase().replace(/['\u2019]/g, "").replace(/([a-z0-9])-s(?=-|$)/g, "$1s");
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
    const all = (actor?.items?.filter?.((x) => ["feat", "action"].includes(x.type) && slugKey(slugOf(x)) === want)) ?? [];
    const i = all.find((x) => x.system?.frequency?.max != null) ?? all[0];
    const f = i?.system?.frequency;
    if (!i || !f || f.max == null) return null;
    return Number(f.value ?? f.max) || 0;
}
/** The standard DC by level (GM Core, Table 10-5), level 0 to 20. */
const STANDARD_DC = [14, 15, 16, 18, 19, 20, 22, 23, 24, 26, 27, 28, 30, 31, 32, 34, 35, 36, 38, 39, 40];
const standardDC = (lv) => STANDARD_DC[Math.max(0, Math.min(20, Number(lv) || 0))];
/** A ChoiceSet's choice on an item (item.flags.pf2e.rulesSelections[flag]), by the item's slug. */
function choiceOf(actor, slug, flag) {
    const want = slugKey(slug);
    const i = actor?.items?.find?.((x) => slugKey(slugOf(x)) === want);
    return i?.flags?.pf2e?.rulesSelections?.[flag] ?? null;
}
/** A plan that casts a slot spell joins spell thrift: attach the board's spell (or { name, rank }) as plan.spell / plan.slot. */
const spendsSlot = (plan, spell, rank) => (spell && typeof spell === "object" && spell.name ? Object.assign(plan, { spell: rank ? { ...spell, rank } : spell }) : Object.assign(plan, { slot: { name: String(spell ?? "a spell"), rank: Number(rank) || 1 } }));
/** Any of these slugs. */
const hasAny = (actor, ...slugs) => slugs.flat().some((s) => has(actor, s));
function effect(actor, re) {
    return actor?.items?.find?.((i) => ["effect", "condition"].includes(i.type) && re.test(slugOf(i))) ?? null;
}
const canMove = (c) => c.canAct !== false && !["immobilized", "grabbed", "restrained", "paralyzed", "unconscious"].some((x) => c.conditions?.has?.(x));
const level = (board) => board.me.level ?? 1;
/** A rough worth, in damage, of a condition on a foe at this level (the advisor's table scaled by hits). */
const worth = (board, cond, mult = 1) => (CONDITION_VALUE[cond] ?? 2) * Math.max(1, (6 + 1.6 * level(board)) / 8) * mult;

/** The best melee Strike and what it's expected to do against t, with the attacks already made. */
function bestStrike(board, t, { made = 0, melee = true, acAdj = 0, extra = 0 } = {}) {
    let best = null;
    for (const s of board.strikes.filter((s) => (melee ? !s.ranged : s.ranged))) {
        const bonus = s.bonus + mapFor(made, s.agile);
        const e = strikeExpected(bonus, t.ac + acAdj, s.avg + extra, { deadly: s.deadly });
        if (!best || e.expected > best.e.expected) best = { s, bonus, e };
    }
    return best;
}
/** A square within one action from which the character reaches t, or null; { route } with actions 0 when already there. */
function squareToReach(board, t, reach = 5, maxActions = 1) {
    const me = board.me;
    if (inReach(me.rect, t.rect, reach)) return { x: me.rect.x, y: me.rect.y, route: { actions: 0, provokes: [], via: null } };
    const sqs = reachableSquares(board, maxActions).filter((sq) => sq.route.actions >= 1 && inReach({ x: sq.x, y: sq.y, w: me.rect.w, h: me.rect.h, z: sq.z ?? me.rect.z }, t.rect, reach));
    sqs.sort((a, b) => a.route.actions - b.route.actions || a.route.provokes.length - b.route.provokes.length);
    return sqs[0] ?? null;
}
/** The character's melee reach: its longest melee Strike's. */
const myReach = (board) => Math.max(5, ...board.strikes.filter((s) => !s.ranged).map((s) => s.reach || 5));
const allySpeed = (a) => Number(a.actor?.system?.movement?.speeds?.land?.value ?? a.actor?.system?.attributes?.speed?.value ?? a.actor?.attributes?.speed?.total) || 25;
const moveText = (sq, t) => `${sq.route.via ?? "Stride"}${sq.route.actions > 1 ? ` ×${sq.route.actions}` : ""} into reach of ${nameOf(t)}`;

/** A foe this character counts as off-guard for a reason the board doesn't show: the estimate drops by 2 and the plans see it. */
function markOffGuard(board, e, why) {
    // a foe already off-guard (prone, grabbed...) has the -2 in its AC already; marking it again adds nothing
    if (!e.offGuardWhy) { if (!(e.conditions && isOffGuard(e))) e.ac -= 2; e.conditions = new Set([...(e.conditions ?? []), "off-guard"]); e.offGuardWhy = []; }
    e.offGuardWhy.push(why);
}
/** Foes the read may plan against: never a hidden one (the helper's policy; the advisor's own plans are filtered the same way). */
const targets = (board) => board.enemies.filter((e) => e.state !== "hidden");
/** A run of Strikes at t: best Strike each time, the penalty climbing. extra: flat damage on each; acAdj: on t's AC. */
function strikeRun(board, t, n, { made = 0, extra = 0, acAdj = 0, melee = true } = {}) {
    const used = [];
    let ev = 0;
    for (let i = 0; i < n; i++) { const b = bestStrike(board, t, { made: made + used.length, extra, acAdj, melee }); if (!b) break; used.push(b); ev += b.e.expected; }
    return { used, ev, text: used.length ? `Strike ${nameOf(t)} with ${used[0].s.label}${used.length > 1 ? ` ${used.length === 2 ? "twice" : "three times"}` : ""} (${used.map((u) => signed(u.bonus)).join(", ")})` : "" };
}
/** Spells the character can cast now: not consumables, with an attack roll or a save or a heal, by the filter given. */
const castable = (board, test = () => true) => (board.spells ?? []).filter((sp) => !sp.consumable && sp.cost !== null && test(sp));
/** Focus Points left, or null when the character has no pool. */
const focusLeft = (actor) => { const f = actor?.system?.resources?.focus; return f && f.max > 0 ? Number(f.value) || 0 : null; };

/* ---- small helpers the class reads share (3.4.1: these were copied into a dozen files) ---- */
/** An ability modifier from the sheet ("str", "dex"...). */
const abil = (actor, k) => Number(actor?.abilities?.[k]?.mod ?? actor?.system?.abilities?.[k]?.mod) || 0;
/** " twice", " three times", " 4 times" (nothing for one). */
const times = (n) => (n <= 1 ? "" : n === 2 ? " twice" : n === 3 ? " three times" : ` ${n} times`);
/** 1st, 2nd, 3rd, 4th... */
const ordinal = (r) => `${r}${r === 1 ? "st" : r === 2 ? "nd" : r === 3 ? "rd" : "th"}`;
const lc = (s) => String(s ?? "").toLowerCase().trim();
/** The class DC from the sheet, else 10 + level + key ability (4) + proficiency (expert and master at the class's levels). */
const classDC = (actor, lv, { expertAt = 9, masterAt = 17 } = {}) => Number(actor?.classDC?.value ?? actor?.system?.attributes?.classDC?.value) || 10 + lv + 4 + (lv >= masterAt ? 6 : lv >= expertAt ? 4 : 2);
/** "Strike Foe with Longsword twice (+12, +7)", from a strikeRun's used list ({ s, bonus }). */
const strikeText = (f, used, tail = "") => `Strike ${nameOf(f)} with ${used[0].s.label}${times(used.length)} (${used.map((u) => signed(u.bonus)).join(", ")})${tail}`;
/** A Strike's weapon die size (8 for a d8), from the board's shorthand or the item; fallback when neither says. */
const dieOf = (s, fallback = 0) => Number(String(s?.die ?? s?.item?.system?.damage?.die ?? "").replace("d", "")) || fallback;
/** Its number of weapon dice; fallback when it doesn't say. */
const diceOf = (s, fallback = 1) => Number(s?.dice ?? s?.item?.system?.damage?.dice) || fallback;
/** The average of n dice of size d. */
const diceAvg = (n, d) => n * (d + 1) / 2;
/** A spell marked signature on the sheet. */
const isSignature = (sp) => !!(sp.signature ?? sp.spell?.system?.location?.signature);
/** Spell slots left by rank from the actor's spontaneous entries: [{ rank, left, max }]. */
function slotsLeft(actor) {
    const out = new Map();
    const entries = actor?.spellcasting?.regular ?? actor?.spellcasting?.contents ?? actor?.spellcasting ?? [];
    for (const e of Array.isArray(entries) ? entries : []) {
        if (e.isFocusPool || e.isRitual || e.isInnate || e.system?.prepared?.value === "focus" || e.system?.prepared?.value === "innate") continue;
        const slots = e.system?.slots ?? {};
        for (let r = 1; r <= 10; r++) {
            const s = slots[`slot${r}`];
            if (!s || !(Number(s.max) > 0)) continue;
            const cur = out.get(r) ?? { rank: r, left: 0, max: 0 };
            cur.left += Math.max(0, Number(s.value) || 0); cur.max += Number(s.max) || 0;
            out.set(r, cur);
        }
    }
    return [...out.values()].sort((a, b) => a.rank - b.rank);
}

export { abil, classDC, diceAvg, diceOf, dieOf, isSignature, lc, ordinal, slotsLeft, strikeText, times, bestStrike, canMove, castable, choiceOf, effect, focusLeft, has, hasAny, half, halfLevel, slugKey, sneaky, spendsSlot, standardDC, STANDARD_DC, usesLeft, level, markOffGuard, moveText, myReach, allySpeed, pct, slugOf, squareToReach, strikeRun, targets, worth, degreeChances, feetBetween, inReach, mapFor, strikeExpected, saveExpected, CONDITION_VALUE, nameOf, reachableSquares, signed };
