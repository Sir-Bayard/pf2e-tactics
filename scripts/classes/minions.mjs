/**
 * PF2e Tactics: classes/minions.mjs
 * What a character's minions add to its turn, whatever its class (3.5.0; the druid's read did this for druids alone):
 * an animal companion (Command an Animal, 1 action: two actions for it, then two of yours), a summoned creature (Sustain,
 * 1 action: its two actions; or a summon spell cast beside a foe), and a familiar (a note: it acts when Commanded).
 * The eidolon (summoner), the construct companion (inventor) and thralls (necromancer) are read by their classes.
 * A minion is the character's when it names the character as its master (a familiar's master, flags.pf2e.master), or,
 * failing that, when it is a companion or summon owned by the same player.
 */
import { bestStrike, castable, has, level, markOffGuard, myReach, allySpeed, spendsSlot, squareToReach, strikeRun, targets, feetBetween, inReach, strikeExpected, saveExpected, nameOf, signed } from "./_common.mjs";

/** A summoned creature of the level a summon spell of this rank brings, as the Monster Core's high attack and moderate Strike. */
const SUMMON_LEVEL = { 1: -1, 2: 1, 3: 2, 4: 3, 5: 5, 6: 7, 7: 9, 8: 11, 9: 13, 10: 15 };
const CREATURE_ATK = { "-1": 8, 0: 8, 1: 9, 2: 11, 3: 12, 4: 14, 5: 15, 6: 17, 7: 18, 8: 20, 9: 21, 10: 23, 11: 24, 12: 26, 13: 27, 14: 29, 15: 30 };
const CREATURE_AVG = { "-1": 3.5, 0: 4.5, 1: 5.5, 2: 8.5, 3: 10.5, 4: 12, 5: 14, 6: 16, 7: 18, 8: 20, 9: 22, 10: 24, 11: 26, 12: 26.5, 13: 28.5, 14: 30.5, 15: 32.5 };
const summonStats = (rank) => { const L = SUMMON_LEVEL[Math.min(10, Math.max(1, rank))]; return { level: L, atk: CREATURE_ATK[L] ?? L + 10, avg: CREATURE_AVG[L] ?? 4 + L * 1.5 }; };

const traitsOf = (a) => [...(a.traits ?? []), ...(a.actor?.system?.traits?.value ?? [])];
const masterOf = (a) => a.actor?.system?.master?.id ?? a.actor?.flags?.pf2e?.master ?? null;
/** The non-GM users who own an actor. */
function playerOwners(actor) {
    const own = actor?.ownership ?? {};
    const lv = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
    return Object.entries(own).filter(([id, v]) => id !== "default" && v >= lv && !globalThis.game?.users?.get?.(id)?.isGM).map(([id]) => id);
}
/** Is this ally the character's own? Its master says so, or (no master named) it shares a player owner with the character. */
function isMine(board, a) {
    const me = board.me.actor;
    const m = masterOf(a);
    if (m) return m === me?.id;
    const mine = playerOwners(me);
    const theirs = playerOwners(a.actor);
    // a GM-run character (no player owner) takes a minion no player owns
    return mine.length ? theirs.some((id) => mine.includes(id)) : theirs.length === 0;
}
/** The character's animal companion on the field (not an eidolon, construct or thrall: their classes read those). */
function companionOf(board) {
    return board.allies.find((a) => {
        if (!(a.hp > 0) || !a.actor || a.type === "familiar") return false;
        const t = traitsOf(a);
        if (t.includes("summoned") || t.includes("eidolon") || t.includes("thrall") || ["eidolon", "construct-companion"].includes(a.cls)) return false;
        const companion = a.cls === "animal-companion" || (t.includes("minion") && t.includes("animal"));
        return companion && isMine(board, a);
    }) ?? null;
}
/** A creature the character summoned and still has about. */
const summonedOf = (board) => board.allies.find((a) => a.hp > 0 && traitsOf(a).includes("summoned") && isMine(board, a)) ?? null;
/** The character's familiar on the field. */
const familiarOf = (board) => board.allies.find((a) => a.type === "familiar" && isMine(board, a)) ?? null;
/** Two Strikes by a creature with one attack (bonus, avg) at f: the second at -5. */
const twoStrikes = (bonus, avg, f) => strikeExpected(bonus, f.ac, avg).expected + strikeExpected(bonus - 5, f.ac, avg).expected;
/** A free square next to f for a Medium creature, when the board says who stands where (true when it can't say). */
function squareBeside(board, f) {
    if (!board.occupant) return true;
    for (let dx = -1; dx <= f.rect.w; dx++) for (let dy = -1; dy <= f.rect.h; dy++) {
        if (dx >= 0 && dx < f.rect.w && dy >= 0 && dy < f.rect.h) continue;
        if (!board.occupant.has(`${f.rect.x + dx},${f.rect.y + dy}`)) return true;
    }
    return false;
}
/** The best 2-action cantrip (or any 2-action damage spell) against f: { sp, e }. */
function bestCast(board, f, { cantripOnly = true } = {}) {
    let best = null;
    for (const sp of castable(board, (sp) => sp.cost >= 1 && sp.cost <= 2 && sp.avg > 0 && !sp.heals && (!cantripOnly || sp.cantrip))) {
        if (sp.range != null && sp.range > 0 && feetBetween(board.me.rect, f.rect) > sp.range) continue;
        let e = 0;
        if (sp.attack != null) e = strikeExpected(sp.attack, f.ac, sp.avg).expected;
        else if (sp.save?.stat) e = saveExpected(f.saves?.[sp.save.stat] ?? level(board) + 5, sp.dc ?? 10 + level(board) + 4, sp.avg, { basic: sp.save.basic }).expected;
        else continue;
        if (!best || e > best.e) best = { sp, e };
    }
    return best;
}
/** Your own two actions after a Command or Sustain, at the same foe: two Strikes in reach, a Stride and a Strike, two shots, or a cantrip. */
function yourTwo(board, f, ctx, made = ctx.made) {
    const opts = [];
    if (board.strikes.some((s) => !s.ranged && inReach(board.me.rect, f.rect, s.reach || 5))) { const r = strikeRun(board, f, 2, { made }); if (r.used.length) opts.push({ ev: r.ev, steps: [{ cost: r.used.length, text: r.text }] }); }
    else {
        const sq = squareToReach(board, f, myReach(board), 1);
        if (sq && sq.route.actions === 1) { const r = strikeRun(board, f, 1, { made }); if (r.used.length) opts.push({ ev: r.ev, steps: [{ cost: 1, text: `Stride into reach of ${nameOf(f)}` }, { cost: 1, text: r.text }], dest: { x: sq.x, y: sq.y } }); }
    }
    const shot = bestStrike(board, f, { made, melee: false });
    if (shot && feetBetween(board.me.rect, f.rect) <= (shot.s.range ?? 30)) { const r = strikeRun(board, f, 2, { made, melee: false }); if (r.used.length) opts.push({ ev: r.ev, steps: [{ cost: r.used.length, text: r.text }] }); }
    const c = bestCast(board, f);
    if (c) opts.push({ ev: c.e, steps: [{ cost: 2, text: `Cast ${c.sp.name} at ${nameOf(f)} (about ${Math.round(c.e)})` }] });
    return opts.sort((a, b) => b.ev - a.ev)[0] ?? null;
}

function minions(board, ctx, out) {
    const actor = board.me.actor;
    const me = board.me;
    const lv = level(board);
    const foes = targets(board);
    const nearest = (xs, at = me.rect) => xs.slice().sort((a, b) => feetBetween(at, a.rect) - feetBetween(at, b.rect))[0] ?? null;
    const anySlug = (re) => !!actor?.items?.some?.((i) => ["feat", "action"].includes(i.type) && re.test(i.slug ?? ""));

    /* ---------------------------------------------------------------- an animal companion */
    const comp = companionOf(board);
    if (comp) {
        const mature = anySlug(/^mature-animal-companion/);
        const strike = comp.reactiveStrike ?? { bonus: lv + 6, avg: 4 + lv };
        const reach = comp.reach ?? 5;
        // Side by Side: a foe adjacent to both of you is flanked, whatever the geometry
        if (anySlug(/^side-by-side/)) for (const f of foes) if (inReach(me.rect, f.rect, myReach(board)) && inReach(comp.rect, f.rect, reach)) markOffGuard(board, f, `Side by Side: ${nameOf(comp)} and you are both on it`);
        if (ctx.actions >= 1 && comp.canAct !== false) {
            const speed = allySpeed(comp);
            for (const f of foes) {
                const adjacent = inReach(comp.rect, f.rect, reach);
                if (!adjacent && feetBetween(comp.rect, f.rect) > speed + reach) continue;
                // Command an Animal (1 action): two actions for it. A mature companion acts once on its own anyway, so the
                // command buys its second Strike (adjacent) or the Strike after its Stride (not)
                const full = twoStrikes(strike.bonus, strike.avg, f);
                const one = strikeExpected(strike.bonus, f.ac, strike.avg).expected;
                const second = strikeExpected(strike.bonus - 5, f.ac, strike.avg).expected;
                const ev = adjacent ? (mature ? second : full) : one;
                const what = adjacent ? `Strikes ${nameOf(f)} twice (${signed(strike.bonus)}, ${signed(strike.bonus - 5)}; about ${Math.round(strike.avg)} a hit)` : `Strides to ${nameOf(f)} and Strikes (${signed(strike.bonus)}, about ${Math.round(strike.avg)})`;
                const notes = [];
                if (mature) notes.push(adjacent ? `Mature companion: it Strikes once on its own if you don't Command it; the command is worth its second Strike, about ${Math.round(second)}.` : "Mature companion: without the command it only Strides or Strikes, not both.");
                if (has(actor, "primal-howl")) notes.push("Primal Howl: it can Howl instead (Demoralize all within 30 feet) when the foes are fresh and unfrightened.");
                const steps = [{ cost: 1, text: `Command an Animal: ${nameOf(comp)} ${what}` }];
                let total = ev, dest = null;
                const rest = ctx.actions >= 3 ? yourTwo(board, f, ctx) : null;
                if (rest) { steps.push(...rest.steps); total += rest.ev; dest = rest.dest ?? null; }
                out.plans.push({ kind: "class", title: `Command ${nameOf(comp)} at ${nameOf(f)}`, target: f, ev: total, score: total + 0.3, dest, steps, notes });
            }
        }
    }

    /* ---------------------------------------------------------------- summons: the Sustain, or the turn one appears */
    const summons = castable(board, (sp) => /^summon\b/i.test(sp.name ?? "") && !sp.cantrip && sp.cost === 3);
    const active = summonedOf(board);
    if (active) {
        const f = nearest(foes, active.rect);
        const st = active.reactiveStrike ?? { bonus: lv + 8, avg: 4 + lv * 1.5 };
        if (f && ctx.actions >= 1) {
            const adjacent = inReach(active.rect, f.rect, active.reach ?? 5);
            const value = adjacent ? twoStrikes(st.bonus, st.avg, f) : strikeExpected(st.bonus, f.ac, st.avg).expected;
            if (board.sustain && /^summon/i.test(board.sustain.name ?? "")) board.sustain.value = Math.max(board.sustain.value ?? 0, value);
            const steps = [{ cost: 1, text: `Sustain your summon: ${nameOf(active)} ${adjacent ? `Strikes ${nameOf(f)} twice` : `closes on ${nameOf(f)} and Strikes`} (about ${signed(st.bonus)}, ${Math.round(st.avg)} a hit)` }];
            let total = value, dest = null;
            const rest = ctx.actions >= 3 ? yourTwo(board, f, ctx) : null;
            if (rest) { steps.push(...rest.steps); total += rest.ev; dest = rest.dest ?? null; }
            out.plans.push({ kind: "class", title: `Sustain ${nameOf(active)} at ${nameOf(f)}`, target: f, ev: total, score: total + 0.3, dest, steps, notes: ["Let it lapse only when it can't reach anything or you need all three actions; it goes at 0 HP and the spell lasts a minute."] });
        }
    } else if (summons.length && ctx.actions >= 3 && foes.length) {
        for (const f of foes) {
            if (feetBetween(me.rect, f.rect) > 30 || !squareBeside(board, f)) continue;
            const sp = summons.slice().sort((a, b) => (b.rank ?? 1) - (a.rank ?? 1))[0];
            const s = summonStats(sp.rank ?? 1);
            const ev = twoStrikes(s.atk, s.avg, f);
            const cantrip = bestCast(board, f);
            const notes = [`Each later turn, Sustain (1 action) buys its two actions, about ${Math.round(ev)} against this foe, and leaves you two for ${cantrip ? `a cantrip (${cantrip.sp.name}, about ${Math.round(cantrip.e)})` : "Strikes"}. It has the minion trait and goes at 0 HP; the spell lasts a minute.`];
            if (has(actor, "primal-summons")) notes.push("Primal Summons: give it air (fly 60 feet), earth (burrow, +1d6 bludgeoning), fire (+1d6 fire, fire resistance) or water (swim, +1d6 bludgeoning) as you summon it.");
            out.plans.push(spendsSlot({ kind: "class", title: `${sp.name} beside ${nameOf(f)}`, target: f, ev, score: ev + 0.3, dest: null,
                steps: [{ cost: 3, text: `Cast ${sp.name} (rank ${sp.rank}): a level ${s.level} creature appears next to ${nameOf(f)} and Strikes twice at once (about ${signed(s.atk)}, ${Math.round(s.avg)} a hit)` }], notes }, sp));
            break;
        }
    }

    /* ---------------------------------------------------------------- a familiar: it acts when Commanded */
    const fam = familiarOf(board);
    if (fam && !has(actor, "witch-spellcasting") && (board.me.actor?.class?.slug ?? "") !== "witch") {
        out.notes.push(`${nameOf(fam)} (your familiar) acts only when you Command it (1 action, two actions for it): to carry an item, Aid, or use its familiar abilities; it doesn't attack.`);
    }
}

export { companionOf, familiarOf, minions, summonedOf, summonStats };
