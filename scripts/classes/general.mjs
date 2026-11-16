/**
 * PF2e Tactics: classes/general.mjs
 * Reads that apply whatever the class: Sneak Attack dice, Raise a Shield, Battle Medicine, and the reactions note.
 * See classes/_common.mjs for the shape of a class read.
 */
import { bestStrike, canMove, castable, effect, focusLeft, has, slugOf, sneaky, level, markOffGuard, moveText, myReach, allySpeed, pct, squareToReach, strikeRun, targets, worth, degreeChances, feetBetween, inReach, mapFor, strikeExpected, saveExpected, CONDITION_VALUE, nameOf, reachableSquares, signed } from "./_common.mjs";
import { hitWorth } from "../values.mjs";


function general(board, ctx, out) {
    const actor = board.me.actor;
    const me = board.me;
    // Sneak Attack dice (rogues and anyone who picked them up): the advisor adds them against off-guard foes
    const sd = actor?.flags?.system?.sneakAttackDamage;
    if (sd && Number(sd.number) > 0 && Number(sd.faces) > 0) {
        board.sneak = Math.max(board.sneak ?? 0, Number(sd.number) * (Number(sd.faces) + 1) / 2);
        for (const s of board.strikes) s.sneaky ??= sneaky(s); // agile, finesse or ranged only (the rogue read widens it for a ruffian)
    }
    if (me.shield && !me.shieldRaised && ctx.actions >= 1) out.notes.push("Raise a Shield (1 action) when you have an action to spare and something can reach you.");
    if (has(actor, "battle-medicine") && ctx.actions >= 1) battleMedicine(board, ctx, out);
}

/** A fallen ally back on its feet is worth about two rounds of its hits (the advisor's revive weight for a thinking creature). */
const backWorth = (level) => 1.1 * hitWorth(level) * 2;
/** Treat Wounds by DC: [DC, HP on a success (2d8 + bonus), HP on a critical success (4d8 + bonus)], trained to legendary. */
const TREAT = [null, [15, 9, 18], [20, 19, 28], [30, 39, 48], [40, 59, 68]];

/**
 * Battle Medicine: heal a hurt ally (or yourself) in reach, or get a dying ally up, at whichever Treat Wounds DC your
 * rank allows pays best. Skips anyone already immune to your Battle Medicine.
 */
function battleMedicine(board, ctx, out) {
    const actor = board.me.actor;
    const me = board.me;
    const rank = Math.min(4, Math.max(1, actor.skills?.medicine?.rank ?? 1));
    const mod = actor.skills?.medicine?.mod ?? level(board) + 3;
    const mine = [actor.uuid, actor.id].filter(Boolean).map(String);
    /** Immune to your Battle Medicine: the immunity effect, from you (an effect whose origin is someone else's doesn't count). */
    const immune = (a) => (a.actor?.items?.contents ?? a.actor?.items ?? []).some?.((i) => {
        if (!["effect", "condition"].includes(i.type) || !/battle-medicine-immunity/.test(slugOf(i))) return false;
        const o = i.origin?.uuid ?? i.origin?.id ?? i.system?.context?.origin?.actor ?? null;
        return !o || !mine.length || mine.some((m) => String(o) === m || String(o).endsWith(`.${actor.id}`));
    }) ?? false;
    /**
     * The DC that's worth most for this much missing HP (back: the worth of getting a dying ally up): { ev, dc, heal,
     * p }.
     */
    const bestDc = (missing, back = 0) => {
        let best = null;
        for (let r = 1; r <= rank; r++) {
            const [dc, hs, hc] = TREAT[r];
            const c = degreeChances(mod, dc);
            const ev = (c.s * Math.min(hs, missing) + c.cs * Math.min(hc, missing)) * 0.8 + (c.s + c.cs) * back - c.cf * 4.5 * 0.8;
            if (!best || ev > best.ev) best = { ev, dc, heal: hs, p: c.s + c.cs };
        }
        return best;
    };
    const who = (a) => (a === me ? "yourself" : nameOf(a));
    const push = (a, b, steps, notes, dest = null) => out.plans.push({ kind: "class", title: `Battle Medicine on ${who(a)}`, target: null, ev: b.ev, score: b.ev, dest, steps, notes });
    const text = (a, b) => `Battle Medicine on ${who(a)} (Medicine ${signed(mod)} vs DC ${b.dc}, about ${pct(b.p)}; ${a === me ? "you're" : "they're"} at ${a.hp}/${a.maxHp}): restores about ${b.heal} HP${rank > 1 && b.dc < TREAT[rank][0] ? ` (the easier DC pays better here than DC ${TREAT[rank][0]})` : ""}`;
    const once = "Once a day per patient from you (the immunity effect says so); a critical failure deals 1d8 instead.";
    // Hurt allies (60% HP or less) and you, already in reach
    for (const a of [...board.allies, me].filter((x) => x.actor && x.hp > 0 && x.hp <= x.maxHp * 0.6 && inReach(me.rect, x.rect, 5) && !immune(x))) {
        const b = bestDc(Math.max(0, a.maxHp - a.hp));
        if (b.ev > 0) push(a, b, [{ cost: 1, text: text(a, b) }], [once, "Then the rest of your turn as the other options say."]);
    }
    // Allies down and dying: in reach, or a move away
    for (const a of (board.downAllies ?? []).filter((d) => (d.hp ?? 0) <= 0 && !immune(d))) {
        const sq = squareToReach(board, a, 5, canMove(me) ? Math.max(0, ctx.actions - 1) : 0);
        if (!sq || (sq.route.actions && !canMove(me))) continue;
        const b = bestDc(a.maxHp || 10, backWorth(a.level ?? me.level));
        const steps = sq.route.actions ? [{ cost: sq.route.actions, text: `${sq.route.via ?? "Stride"}${sq.route.actions > 1 ? ` ×${sq.route.actions}` : ""} to ${nameOf(a)}` }] : [];
        steps.push({ cost: 1, text: `${text(a, b)}; on a success they're up and fight next turn` });
        push(a, b, steps, [once, `${nameOf(a)} is down: brought back, they stand and fight next turn (wounded goes up by 1).`], sq.route.actions ? { x: sq.x, y: sq.y } : null);
    }
}

/** Notes the character's reactions (feats and actions with a reaction cost); the plans never spend one. */


function reactionsNote(board, out) {
    const actor = board.me.actor;
    const names = (actor?.items?.contents ?? actor?.items ?? []).filter((i) => ["feat", "action"].includes(i.type) && i.system?.actionType?.value === "reaction").map((i) => i.name);
    const uniq = [...new Set(names)];
    if (uniq.length) out.notes.push(`Your reactions: ${uniq.slice(0, 6).join(", ")}${uniq.length > 6 ? "..." : ""}. One a round; the plans don't spend it.`);
}

export { general, reactionsNote };
