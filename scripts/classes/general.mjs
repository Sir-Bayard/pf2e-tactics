/**
 * PF2e Tactics: classes/general.mjs
 * See classes/_common.mjs for the shape of a class read.
 */
import { bestStrike, canMove, castable, effect, focusLeft, has, half, level, markOffGuard, moveText, myReach, allySpeed, pct, squareToReach, strikeRun, targets, worth, degreeChances, feetBetween, inReach, mapFor, strikeExpected, saveExpected, CONDITION_VALUE, nameOf, reachableSquares, signed } from "./_common.mjs";


function general(board, ctx, out) {
    const actor = board.me.actor;
    const me = board.me;
    // Sneak Attack dice (rogues and anyone who picked them up): the advisor adds them against off-guard foes
    const sd = actor?.flags?.system?.sneakAttackDamage;
    if (sd && Number(sd.number) > 0 && Number(sd.faces) > 0) board.sneak = Math.max(board.sneak ?? 0, Number(sd.number) * (Number(sd.faces) + 1) / 2);
    if (me.shield && !me.shieldRaised && ctx.actions >= 1) out.notes.push("Raise a Shield (1 action) when you have an action to spare and something can reach you.");
    if (has(actor, "battle-medicine") && ctx.actions >= 1) {
        const rank = actor.skills?.medicine?.rank ?? 1;
        const mod = actor.skills?.medicine?.mod ?? level(board) + 3;
        const heal = [0, 9, 19, 39, 59][Math.min(4, Math.max(1, rank))];
        const dc = [0, 15, 20, 30, 40][Math.min(4, Math.max(1, rank))];
        const c = degreeChances(mod, dc);
        const hurt = [...board.allies, me].filter((a) => a.actor && a.hp > 0 && a.hp <= a.maxHp * 0.6 && inReach(me.rect, a.rect, 5) && !effect(a.actor, /battle-medicine-immunity/));
        for (const a of hurt) {
            const missing = Math.max(0, a.maxHp - a.hp);
            const ev = (c.s + c.cs) * Math.min(heal, missing) * 0.8;
            out.plans.push({ kind: "class", title: `Battle Medicine on ${a === me ? "yourself" : nameOf(a)}`, target: null, ev, score: ev, dest: null,
                steps: [{ cost: 1, text: `Battle Medicine on ${a === me ? "yourself" : nameOf(a)} (Medicine ${signed(mod)} vs DC ${dc}, about ${pct(c.s + c.cs)}; ${a === me ? "you're" : "they're"} at ${a.hp}/${a.maxHp}): restores about ${heal} HP` }],
                notes: ["Once per day per patient (with the immunity effect to say so). Then the rest of your turn as the other options say."] });
        }
    }
    if (has(actor, "sudden-charge") || has(actor, "vicious-swing")) { /* read by the advisor from the feat's text */ }
}

/** Plans and notes from the character's class and feats. ctx: { actions, made }. */


function reactionsNote(board, out) {
    const actor = board.me.actor;
    const names = (actor?.items?.contents ?? actor?.items ?? []).filter((i) => ["feat", "action"].includes(i.type) && i.system?.actionType?.value === "reaction").map((i) => i.name);
    const uniq = [...new Set(names)];
    if (uniq.length) out.notes.push(`Your reactions: ${uniq.slice(0, 6).join(", ")}${uniq.length > 6 ? "..." : ""}. One a round; the plans don't spend it.`);
}

export { general, reactionsNote };
