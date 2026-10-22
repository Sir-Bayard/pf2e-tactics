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
import { CONDITION_VALUE, nameOf, reachableSquares } from "../advisor.mjs";

const half = (n) => Math.floor((Number(n) || 0) / 2 / 5) * 5;
const pct = (x) => `${Math.round(x * 100)}%`;
const slugOf = (i) => i?.slug ?? i?.system?.slug ?? (i?.name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
function has(actor, slug) {
    return !!actor?.items?.some?.((i) => ["feat", "action"].includes(i.type) && slugOf(i) === slug);
}
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
    if (!e.offGuardWhy) { e.ac -= 2; e.conditions = new Set([...(e.conditions ?? []), "off-guard"]); e.offGuardWhy = []; }
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

export { bestStrike, canMove, castable, effect, focusLeft, has, half, level, markOffGuard, moveText, myReach, allySpeed, pct, slugOf, squareToReach, strikeRun, targets, worth, degreeChances, feetBetween, inReach, mapFor, strikeExpected, saveExpected, CONDITION_VALUE, nameOf, reachableSquares, signed };
