/**
 * PF2e Tactics: classes/fighter.mjs
 * See classes/_common.mjs for the shape of a class read.
 * What the fighter knows that the advisor doesn't: Vicious Swing's extra dice, Double Slice and Swipe (two Strikes at one
 * penalty), Slam Down (Strike then Trip at the same penalty), Intimidating Strike, Sudden Charge, Lunge, Whirlwind Strike,
 * Double Shot, the press feats (Exacting, Certain, Brutish Shove, Combat Grab, Brutal Finish, Two-Weapon Flurry...) picked
 * slot by slot after a first Strike, Desperate Finisher as a fourth press, Agile Grace's -3/-6, Fearsome Brute's bonus,
 * Weapon Supremacy's extra Strike; and when-notes for stances, parries, ripostes and the rest.
 */
import { bestStrike, canMove, castable, effect, focusLeft, has, half, level, markOffGuard, moveText, myReach, allySpeed, pct, squareToReach, strikeRun, targets, worth, degreeChances, feetBetween, inReach, mapFor, strikeExpected, saveExpected, CONDITION_VALUE, nameOf, reachableSquares, signed } from "./_common.mjs";

/* ---- weapon facts the board doesn't spell out (the item when the board carries it, else a fair guess) ---- */
const unarmed = (s) => !!s.traits?.includes("unarmed");
const weaponsOf = (board) => board.strikes.filter((s) => !s.ranged && !unarmed(s));
const usageOf = (s) => String(s.hands ?? s.item?.system?.usage?.value ?? "");
const twoHanded = (s) => usageOf(s) === "2" || /two-hands/.test(usageOf(s));
const oneHanded = (s) => !twoHanded(s) && !unarmed(s);
/** The weapon's damage die (its average) and how many: from the item when the board has it, else by level and agility. */
const dieAvg = (s) => { const d = Number(String(s.die ?? s.item?.system?.damage?.die ?? "").replace("d", "")); return d ? (d + 1) / 2 : s.agile ? 3.5 : 4.5; };
const diceOf = (s, lv) => Number(s.dice ?? s.item?.system?.damage?.dice) || (lv >= 19 ? 4 : lv >= 12 ? 3 : lv >= 4 ? 2 : 1);
/** The flat part of a Strike's damage: what Certain Strike deals on a miss. */
const flatOf = (s, lv) => Math.max(0, s.avg - diceOf(s, lv) * dieAvg(s));
/** A free hand: at most one one-handed weapon and no shield. The sheet says no more than this. */
const freeHand = (board) => { const w = weaponsOf(board); return !board.me.shield && w.length <= 1 && w.every(oneHanded); };
/** One one-handed weapon and nothing else in hand: Dueling Parry, Disarming Twist, Guardian's Deflection. */
const duelist = (board) => { const w = weaponsOf(board); return !board.me.shield && w.length === 1 && oneHanded(w[0]); };
const slashing = (s) => !s.damageTypes?.length || s.damageTypes.includes("slashing");
const piercing = (s) => !s.damageTypes?.length || s.damageTypes.includes("piercing");
const adjacent = (a, b) => inReach(a.rect, b.rect, 5);
const times = (n) => (n === 1 ? "" : n === 2 ? " twice" : n === 3 ? " three times" : ` ${n} times`);
const r1 = (n) => Math.round(n * 10) / 10;

function fighter(board, ctx, out) {
    const actor = board.me.actor;
    const me = board.me;
    const lv = level(board);
    const foes = targets(board);
    const weapons = weaponsOf(board);
    const melee = board.strikes.filter((s) => !s.ranged);
    const reach = myReach(board);
    const stance = (re) => !!effect(actor, re);
    // Weapon Supremacy (20): quickened for Strikes. Counted here when the condition isn't already on the sheet.
    const supremacy = has(actor, "weapon-supremacy") && !me.conditions?.has?.("quickened") && ctx.actions > 0 ? 1 : 0;
    const acts = ctx.actions + supremacy;
    // Agile Grace (10): -3/-6 with agile weapons. Every plan here uses this penalty.
    const agileGrace = has(actor, "agile-grace");
    const mapOf = (n, agile) => (agile && agileGrace ? (n <= 0 ? 0 : n === 1 ? -3 : -6) : mapFor(n, agile));
    // Fearsome Brute (10): +2 x frightened value on Strikes (x3 as a master of Intimidation)
    const fearsome = has(actor, "fearsome-brute") ? ((actor.skills?.intimidation?.rank ?? 0) >= 3 ? 3 : 2) : 0;
    const frightOf = (f) => (f.conditions?.has?.("frightened") ? Number(f.conditionValues?.frightened) || 1 : 0);
    const extraVs = (f) => fearsome * frightOf(f);
    const offGuardTo = (f) => !!f.conditions?.has?.("off-guard");
    const athletics = me.athletics ?? actor.skills?.athletics?.mod ?? lv + 5;
    /** The best Strike at f with n attacks made, by this read's penalty. extra: flat or per-Strike function; pick: a weapon filter. */
    const best = (f, made, { extra = 0, acAdj = 0, pick = () => true, ranged = false, penalty = 0, countMap = true } = {}) => {
        let b = null;
        for (const s of board.strikes.filter((s) => !!s.ranged === ranged && pick(s))) {
            const bonus = s.bonus + (countMap ? mapOf(made, s.agile) : 0) + penalty;
            const x = typeof extra === "function" ? extra(s) : extra;
            const e = strikeExpected(bonus, f.ac + acAdj, s.avg + x + extraVs(f), { deadly: s.deadly });
            if (!b || e.expected > b.e.expected) b = { s, bonus, e };
        }
        return b;
    };
    /** n plain Strikes at f from `made` attacks in: steps text and ev. */
    const run = (f, n, made, opts = {}) => {
        const used = [];
        let ev = 0;
        for (let i = 0; i < n; i++) { const b = best(f, made + used.length, opts); if (!b) break; used.push(b); ev += b.e.expected; }
        return { used, ev, text: used.length ? `Strike ${nameOf(f)} with ${used[0].s.label}${times(used.length)} (${used.map((u) => signed(u.bonus)).join(", ")})` : "" };
    };
    const push = (title, f, ev, sq, steps, notes = [], bias = 0.3) => out.plans.push({ kind: "class", title, target: f, ev, score: ev + bias, dest: sq?.route?.actions ? { x: sq.x, y: sq.y } : null, steps, notes });
    const approach = (f, cost) => { if (acts < cost) return null; const sq = squareToReach(board, f, reach, acts - cost); return sq ? { sq, moveActs: sq.route.actions, left: acts - cost - sq.route.actions } : null; };
    const supremacyNote = supremacy ? "Weapon Supremacy: your fourth action is the extra Strike (it can only be a Strike)." : null;

    /* ---- Vicious Swing (1; 2 actions, flourish): one Strike, an extra die (two at 10, three at 18), counts as two attacks ---- */
    if ((has(actor, "vicious-swing") || has(actor, "power-attack")) && melee.length) {
        const dice = lv >= 18 ? 3 : lv >= 10 ? 2 : 1;
        const focus = has(actor, "furious-focus");
        for (const f of foes) {
            const a = approach(f, 2); if (!a) continue;
            const b = best(f, ctx.made, { extra: (s) => dice * dieAvg(s) });
            if (!b) continue;
            const steps = [];
            if (a.moveActs) steps.push({ cost: a.moveActs, text: moveText(a.sq, f) });
            steps.push({ cost: 2, text: `Vicious Swing ${nameOf(f)} with ${b.s.label} (${signed(b.bonus)}): +${dice} weapon ${dice === 1 ? "die" : "dice"} on a hit, about ${r1(dice * dieAvg(b.s))}` });
            let ev = b.e.expected;
            const after = ctx.made + (focus && twoHanded(b.s) ? 1 : 2);
            if (a.left >= 1) { const r = run(f, a.left, after); if (r.used.length) { steps.push({ cost: r.used.length, text: r.text }); ev += r.ev; } }
            const notes = [focus && twoHanded(b.s) ? "Furious Focus: in two hands, Vicious Swing counts as one attack toward your penalty." : "Vicious Swing counts as two attacks: whatever follows it is at your third-attack penalty.", supremacyNote].filter(Boolean);
            push(`Vicious Swing ${nameOf(f)}`, f, ev, a.sq, steps, notes);
        }
    }

    /* ---- Double Slice (1; 2 actions): both weapons at the current penalty; Graceful Poise (16) makes an agile second count as one attack ---- */
    if (has(actor, "double-slice") && weapons.length >= 2) {
        const poise = stance(/graceful-poise/);
        for (const f of foes) {
            const a = approach(f, 2); if (!a) continue;
            let b = null;
            for (const x of weapons) for (const y of weapons) {
                if (x === y) continue;
                const b1 = x.bonus + mapOf(ctx.made, x.agile), b2 = y.bonus + mapOf(ctx.made, y.agile) - (y.agile ? 0 : 2);
                const e1 = strikeExpected(b1, f.ac, x.avg + extraVs(f), { deadly: x.deadly });
                const e2 = strikeExpected(b2, f.ac, y.avg + extraVs(f), { deadly: y.deadly });
                const ev = e1.expected + e2.expected;
                if (!b || ev > b.ev) b = { x, y, b1, b2, ev };
            }
            if (!b) continue;
            const steps = [];
            if (a.moveActs) steps.push({ cost: a.moveActs, text: moveText(a.sq, f) });
            steps.push({ cost: 2, text: `Double Slice ${nameOf(f)}: ${b.x.label} (${signed(b.b1)}) and ${b.y.label} (${signed(b.b2)}), both at your current penalty` });
            let ev = b.ev;
            const after = ctx.made + (poise && b.y.agile ? 1 : 2);
            if (a.left >= 1) { const r = run(f, a.left, after); if (r.used.length) { steps.push({ cost: r.used.length, text: r.text }); ev += r.ev; } }
            const notes = [];
            if (poise && b.y.agile) notes.push("Graceful Poise: with the agile weapon second, Double Slice counts as one attack.");
            else if (has(actor, "graceful-poise") && b.y.agile) notes.push("Graceful Poise (1 action, stance): enter it first and Double Slice counts as one attack toward your penalty.");
            if (supremacyNote) notes.push(supremacyNote);
            push(`Double Slice ${nameOf(f)}`, f, ev, a.sq, steps, notes);
        }
    }

    /* ---- Slam Down / Knockdown (4; 2 actions): Strike, then Trip at the same penalty if it hit; Crashing Slam (10): the Trip is a critical success ---- */
    if ((has(actor, "slam-down") || has(actor, "knockdown")) && melee.length) {
        const crashing = has(actor, "crashing-slam") || has(actor, "improved-knockdown");
        for (const f of foes) {
            if (f.conditions?.has?.("prone")) continue;
            const a = approach(f, 2); if (!a) continue;
            const b = best(f, ctx.made, { pick: (s) => twoHanded(s) || freeHand(board) });
            if (!b) continue;
            const dc = 10 + (f.saves?.reflex ?? 0);
            const c = degreeChances(athletics + mapOf(ctx.made, false), dc);
            const prone = worth(board, "prone");
            const critDie = crashing && twoHanded(b.s) ? dieAvg(b.s) : 3.5;
            const pTrip = b.e.hit * (crashing ? 1 : c.s + c.cs);
            const tripValue = crashing ? prone + critDie : (c.s + c.cs) * prone + c.cs * 3.5 - c.cf * 2;
            let ev = b.e.expected + b.e.hit * tripValue;
            const steps = [];
            if (a.moveActs) steps.push({ cost: a.moveActs, text: moveText(a.sq, f) });
            steps.push({ cost: 2, text: `Slam Down ${nameOf(f)} with ${b.s.label} (${signed(b.bonus)}): if it hits, ${crashing ? `it's knocked prone and takes 1d${crashing && twoHanded(b.s) ? Math.round(dieAvg(b.s) * 2 - 1) : 6} (Crashing Slam: the Trip is a critical success)` : `Trip it (Athletics ${signed(athletics + mapOf(ctx.made, false))} vs Reflex DC ${dc}, about ${pct(c.s + c.cs)}) at the same penalty`}` });
            if (a.left >= 1) { const r = run(f, a.left, ctx.made + 2, { acAdj: offGuardTo(f) ? 0 : -2 * pTrip }); if (r.used.length) { steps.push({ cost: r.used.length, text: `${r.text}, it off-guard if it went down` }); ev += r.ev; } }
            push(`Slam Down ${nameOf(f)}`, f, ev, a.sq, steps, ["A prone foe is off-guard and spends an action to Stand; it's -2 on its own attacks until it does.", supremacyNote].filter(Boolean));
        }
    }

    /* ---- Intimidating Strike (2; 2 actions): frightened 1 on a hit, 2 on a critical hit ---- */
    if (has(actor, "intimidating-strike") && melee.length) {
        for (const f of foes) {
            if (f.conditions?.has?.("frightened")) continue;
            const a = approach(f, 2); if (!a) continue;
            const b = best(f, ctx.made);
            if (!b) continue;
            const fr = worth(board, "frightened");
            let ev = b.e.expected + (b.e.hit - b.e.crit) * fr + b.e.crit * 2 * fr;
            const steps = [];
            if (a.moveActs) steps.push({ cost: a.moveActs, text: moveText(a.sq, f) });
            steps.push({ cost: 2, text: `Intimidating Strike ${nameOf(f)} with ${b.s.label} (${signed(b.bonus)}): frightened 1 on a hit, 2 on a critical hit` });
            if (a.left >= 1) {
                const drop = b.e.hit + b.e.crit; // expected frightened value, as AC lost
                const r = run(f, a.left, ctx.made + 1, { acAdj: -drop, extra: fearsome * drop });
                if (r.used.length) { steps.push({ cost: r.used.length, text: `${r.text}, its AC and saves down by its frightened value` }); ev += r.ev; }
            }
            const notes = ["Frightened drops by 1 at the end of each of its turns and lowers its AC, saves and attacks."];
            if (has(actor, "shatter-defenses")) notes.push("Shatter Defenses (1 action, press) after it: a hit makes it off-guard until its fear ends.");
            if (fearsome) notes.push(`Fearsome Brute: +${fearsome} damage per frightened value on your Strikes against it.`);
            if (supremacyNote) notes.push(supremacyNote);
            push(`Intimidating Strike ${nameOf(f)}`, f, ev, a.sq, steps, notes);
        }
    }

    /* ---- Swipe (4; 2 actions, flourish): one attack roll against two adjacent foes in reach, counts as two attacks ---- */
    if (has(actor, "swipe") && melee.length && acts >= 2) {
        const done = new Set();
        for (const f of foes) for (const g of foes) {
            if (f === g || done.has(`${g.id}|${f.id}`) || !adjacent(f, g)) continue;
            done.add(`${f.id}|${g.id}`);
            const a = approach(f, 2); if (!a) continue;
            const at = a.moveActs ? { ...me.rect, x: a.sq.x, y: a.sq.y } : me.rect;
            if (!inReach(at, g.rect, reach)) continue;
            let b = null;
            for (const s of melee) {
                const bonus = s.bonus + mapOf(ctx.made, s.agile);
                const ef = strikeExpected(bonus, f.ac, s.avg + extraVs(f), { deadly: s.deadly }), eg = strikeExpected(bonus, g.ac, s.avg + extraVs(g), { deadly: s.deadly });
                const ev = ef.expected + eg.expected;
                if (!b || ev > b.ev) b = { s, bonus, ev };
            }
            if (!b) continue;
            const steps = [];
            if (a.moveActs) steps.push({ cost: a.moveActs, text: moveText(a.sq, f) });
            steps.push({ cost: 2, text: `Swipe ${nameOf(f)} and ${nameOf(g)} with ${b.s.label} (${signed(b.bonus)}): one roll against both, damage rolled once` });
            let ev = b.ev;
            if (a.left >= 1) { const tgt = f.ac <= g.ac ? f : g; const r = run(tgt, a.left, ctx.made + 2); if (r.used.length) { steps.push({ cost: r.used.length, text: r.text }); ev += r.ev; } }
            push(`Swipe ${nameOf(f)} and ${nameOf(g)}`, f, ev, a.sq, steps, ["Swipe counts as two attacks; both targets must be adjacent to each other and in your reach.", supremacyNote].filter(Boolean));
        }
    }

    /* ---- Whirlwind Strike (14; 3 actions): a Strike on every foe in reach, all at the current penalty ---- */
    if (has(actor, "whirlwind-strike") && melee.length && ctx.actions >= 3) {
        const around = foes.filter((f) => inReach(me.rect, f.rect, reach));
        if (around.length >= 2) {
            let ev = 0;
            const shown = [];
            for (const f of around) { const b = best(f, ctx.made); if (!b) continue; ev += b.e.expected; shown.push(`${nameOf(f)} (${b.s.label} ${signed(b.bonus)})`); }
            const steps = [{ cost: 3, text: `Whirlwind Strike: one Strike on each of ${shown.join(", ")}, every one at your current penalty` }];
            if (supremacy) { const t = around.slice().sort((x, y) => x.ac - y.ac)[0]; const b = best(t, ctx.made + around.length); if (b) { steps.push({ cost: 1, text: `Weapon Supremacy: Strike ${nameOf(t)} with ${b.s.label} (${signed(b.bonus)})` }); ev += b.e.expected; } }
            push(`Whirlwind Strike: ${around.length} foes`, around[0], ev, null, steps, ["Every Whirlwind Strike counts toward your penalty, but it doesn't climb until they're all made."]);
        }
    }

    /* ---- Sudden Charge (1; 2 actions): Stride twice, then Strike: for a foe two moves away ---- */
    if (has(actor, "sudden-charge") && melee.length && acts >= 2 && canMove(me)) {
        for (const f of foes) {
            const sq = squareToReach(board, f, reach, 2);
            if (!sq || sq.route.actions !== 2) continue;
            const b = best(f, ctx.made);
            if (!b) continue;
            const steps = [{ cost: 2, text: `Sudden Charge: ${moveText(sq, f)}, then Strike with ${b.s.label} (${signed(b.bonus)})` }];
            let ev = b.e.expected;
            if (acts - 2 >= 1) { const r = run(f, acts - 2, ctx.made + 1); if (r.used.length) { steps.push({ cost: r.used.length, text: r.text }); ev += r.ev; } }
            push(`Sudden Charge ${nameOf(f)}`, f, ev, sq, steps, [supremacyNote].filter(Boolean));
        }
    }

    /* ---- Lunge (2; 1 action): a Strike at reach +5, for a foe just out of reach without moving ---- */
    if (has(actor, "lunge") && weapons.length && acts >= 1) {
        for (const f of foes) {
            if (inReach(me.rect, f.rect, reach) || !inReach(me.rect, f.rect, reach + 5)) continue;
            const r = run(f, acts, ctx.made, { pick: (s) => !unarmed(s) });
            if (!r.used.length) continue;
            push(`Lunge at ${nameOf(f)}`, f, r.ev, null, [{ cost: r.used.length, text: `Lunge${times(r.used.length)}: ${r.text} from where you stand, reach +5 feet each` }], ["You stay where you are: it has to come to you, or spend its turn otherwise.", supremacyNote].filter(Boolean));
        }
    }

    /* ---- Sever Space (20; 2 actions, flourish): a slashing Strike at 80 feet, then you're adjacent ---- */
    if (has(actor, "sever-space") && acts >= 2) {
        for (const f of foes) {
            const d = feetBetween(me.rect, f.rect);
            if (d <= reach || d > 80) continue;
            const sq = squareToReach(board, f, reach, 1);
            if (sq && sq.route.actions <= 1) continue; // a Stride does the same job for one action
            const b = best(f, ctx.made, { pick: (s) => !s.ranged && slashing(s) });
            if (!b) continue;
            const steps = [{ cost: 2, text: `Sever Space: Strike ${nameOf(f)} with ${b.s.label} (${signed(b.bonus)}) at 80 feet, then teleport next to it (or pull it to you: Fortitude save vs your class DC)` }];
            let ev = b.e.expected;
            if (acts - 2 >= 1) { const r = run(f, acts - 2, ctx.made + 1, { pick: (s) => !s.ranged }); if (r.used.length) { steps.push({ cost: r.used.length, text: r.text }); ev += r.ev; } }
            push(`Sever Space to ${nameOf(f)}`, f, ev, null, steps, ["Flourish: not with Vicious Swing, Swipe or Two-Weapon Flurry on the same turn."]);
        }
    }

    /* ---- Overwhelming Blow (16; 3 actions): a hit is a critical hit; then you're stunned 1 and off-guard ---- */
    if (has(actor, "overwhelming-blow") && melee.length && ctx.actions >= 3) {
        for (const f of foes) {
            if (!inReach(me.rect, f.rect, reach)) continue;
            const b = best(f, ctx.made);
            if (!b) continue;
            const plain = best(f, 0);
            const cost = 0.35 * (plain?.e.expected ?? 0) + worth(board, "off-guard") * 0.5;
            const ev = b.e.hit * (2 * b.s.avg + extraVs(f) * 2) + b.e.crit * 6.5 - cost;
            push(`Overwhelming Blow on ${nameOf(f)}`, f, ev, null, [{ cost: 3, text: `Overwhelming Blow ${nameOf(f)} with ${b.s.label} (${signed(b.bonus)}): a hit is a critical hit (a natural one adds deadly d12)` }], ["Afterwards you're stunned 1 and off-guard until your next turn: for a foe this blow finishes, or when little can reach you."], 0.2);
        }
    }

    /* ---- Double Shot (4; 2 actions, flourish) and Triple Shot (6): quick shots at -2 (-4 for three), the penalty not climbing ---- */
    const quick = board.strikes.filter((s) => s.ranged && (s.reload ?? 0) === 0);
    if (has(actor, "double-shot") && quick.length && ctx.actions >= 2) {
        const multishot = stance(/multishot-stance/);
        const triple = has(actor, "triple-shot");
        const inRange = foes.filter((f) => quick.some((s) => feetBetween(me.rect, f.rect) <= (s.range ?? 30)));
        const pen2 = multishot ? -1 : -2, pen3 = multishot ? -2 : -4;
        if (inRange.length >= 2 || (triple && inRange.length >= 1)) {
            const sorted = inRange.slice().sort((x, y) => x.ac - y.ac);
            const f = sorted[0], g = triple ? f : sorted[1];
            const shot = (t, pen) => best(t, ctx.made, { ranged: true, penalty: pen, pick: (s) => (s.reload ?? 0) === 0 });
            const b1 = shot(f, pen2), b2 = shot(g, pen2);
            if (b1 && b2) {
                const steps = [{ cost: 2, text: g === f ? `Double Shot: two ${b1.s.label} shots at ${nameOf(f)} (${signed(b1.bonus)} each, ${pen2}), the penalty climbing only afterwards` : `Double Shot: ${b1.s.label} at ${nameOf(f)} (${signed(b1.bonus)}) and at ${nameOf(g)} (${signed(b2.bonus)}), ${pen2} each, the penalty climbing only afterwards` }];
                let ev = b1.e.expected + b2.e.expected;
                if (ctx.actions >= 3) {
                    const b3 = shot(f, pen3), c2 = shot(f, pen3), c3 = shot(g, pen3);
                    const tripleEv = triple && b3 && c2 && c3 ? b3.e.expected + c2.e.expected + c3.e.expected : -1;
                    const third = best(f, ctx.made + 2, { ranged: true });
                    if (tripleEv > ev + (third?.e.expected ?? 0)) { steps[0] = { cost: 3, text: `Triple Shot: three ${b3.s.label} shots at ${nameOf(f)} (${signed(b3.bonus)} each, ${pen3}), the penalty climbing only afterwards` }; ev = tripleEv; }
                    else if (third) { steps.push({ cost: 1, text: `Strike ${nameOf(f)} with ${third.s.label} (${signed(third.bonus)})` }); ev += third.e.expected; }
                }
                push(`${steps[0].cost === 3 ? "Triple Shot" : "Double Shot"}: ${nameOf(f)}${g !== f ? ` and ${nameOf(g)}` : ""}`, f, ev, null, steps, [multishot ? "Multishot Stance: the penalty is lower while you don't move." : has(actor, "multishot-stance") ? "Multishot Stance (1 action): -1 for Double Shot, -2 for Triple Shot, until you move." : null, "Flourish: one per turn."].filter(Boolean));
            }
        }
    }

    /* ---- The press plan: a first Strike, then the best press each action (Exacting, Certain, Brutish Shove, Combat Grab,
            Advantageous Assault, Shatter Defenses, Disarming Twist, Brutal Finish, Two-Weapon Flurry), Desperate Finisher after ---- */
    const presses = ["exacting-strike", "certain-strike", "brutish-shove", "dragging-strike", "combat-grab", "advantageous-assault", "shatter-defenses", "disarming-twist", "brutal-finish", "two-weapon-flurry", "snagging-strike"].filter((s) => has(actor, s));
    if (melee.length && acts >= 1 && (presses.length || agileGrace || supremacy)) {
        const finisher = has(actor, "desperate-finisher");
        for (const f of foes) {
            const a = approach(f, 1); if (!a) continue;
            const slots = a.left + 1;
            let made = ctx.made, acAdj = 0, ev = 0, ended = false;
            const steps = [];
            const notes = [];
            if (a.moveActs) steps.push({ cost: a.moveActs, text: moveText(a.sq, f) });
            const next = (m, adj) => best(f, m, { acAdj: adj })?.e.expected ?? 0;
            const option = (name, cost, { pick, extra = 0, after = (b) => ({ made: made + 1, acAdj }), text, bonus = (b) => 0 }) => {
                const b = best(f, made, { acAdj, pick, extra });
                if (!b) return null;
                const st = after(b);
                const immediate = b.e.expected + bonus(b);
                return { name, cost, b, immediate, st, text: text(b) };
            };
            for (let slot = 0; slot < slots && !ended; slot++) {
                const last = slot === slots - 1;
                const opts = [];
                const plainB = best(f, made, { acAdj });
                if (!plainB) break;
                opts.push({ name: "Strike", cost: 1, b: plainB, immediate: plainB.e.expected, st: { made: made + 1, acAdj }, text: `Strike ${nameOf(f)} with ${plainB.s.label} (${signed(plainB.bonus)})` });
                const pressOk = made >= 1; // press: only once you're at a multiple attack penalty
                if (slot === 0 && has(actor, "snagging-strike") && freeHand(board) && !offGuardTo(f)) opts.push(option("Snagging Strike", 1, {
                    after: (b) => ({ made: made + 1, acAdj: -2 * b.e.hit }), bonus: (b) => b.e.hit * worth(board, "off-guard") * 0.3,
                    text: (b) => `Snagging Strike ${nameOf(f)} with ${b.s.label} (${signed(b.bonus)}), a hand free: a hit leaves it off-guard until your next turn` }));
                if (pressOk && has(actor, "exacting-strike")) opts.push(option("Exacting Strike", 1, {
                    bonus: (b) => (last ? 0 : (1 - b.e.hit) * (next(made, acAdj) - next(made + 1, acAdj))),
                    text: (b) => `Exacting Strike ${nameOf(f)} with ${b.s.label} (${signed(b.bonus)}): a miss doesn't raise your penalty` }));
                if (pressOk && has(actor, "certain-strike")) opts.push(option("Certain Strike", 1, {
                    bonus: (b) => degreeChances(b.bonus, f.ac + acAdj).f * flatOf(b.s, lv),
                    text: (b) => `Certain Strike ${nameOf(f)} with ${b.s.label} (${signed(b.bonus)}): a miss still deals ${Math.round(flatOf(b.s, lv))}` }));
                if (pressOk && has(actor, "brutish-shove") && weapons.some(twoHanded)) opts.push(option("Brutish Shove", 1, {
                    pick: twoHanded, after: (b) => ({ made: made + 1, acAdj: offGuardTo(f) ? acAdj : -2 * (1 - degreeChances(b.bonus, f.ac + acAdj).cf) }),
                    bonus: (b) => b.e.hit * 0.5, text: (b) => `Brutish Shove ${nameOf(f)} with ${b.s.label} (${signed(b.bonus)}): hit or miss it's off-guard until your turn ends; a hit also Shoves it${has(actor, "flinging-shove") ? " (Flinging Shove: 5 feet even on a miss)" : ""}` }));
                else if (pressOk && has(actor, "dragging-strike")) opts.push(option("Dragging Strike", 1, {
                    after: (b) => ({ made: made + 1, acAdj: offGuardTo(f) ? acAdj : -2 * (1 - degreeChances(b.bonus, f.ac + acAdj).cf) }),
                    text: (b) => `Dragging Strike ${nameOf(f)} with ${b.s.label} (${signed(b.bonus)}): a hit pulls it 5 feet, a miss leaves it off-guard until your turn ends` }));
                if (pressOk && has(actor, "combat-grab") && freeHand(board) && !f.conditions?.has?.("grabbed")) opts.push(option("Combat Grab", 1, {
                    after: (b) => ({ made: made + 1, acAdj: offGuardTo(f) ? acAdj : -2 * b.e.hit }), bonus: (b) => b.e.hit * worth(board, "grabbed") * 0.6,
                    text: (b) => `Combat Grab ${nameOf(f)} with ${b.s.label} (${signed(b.bonus)}): a hit grabs it until the end of your next turn` }));
                if (pressOk && has(actor, "advantageous-assault") && ["grabbed", "prone", "restrained"].some((c) => f.conditions?.has?.(c))) opts.push(option("Advantageous Assault", 1, {
                    extra: (s) => diceOf(s, lv) + (twoHanded(s) ? 2 : 0), bonus: (b) => degreeChances(b.bonus, f.ac + acAdj).f * (diceOf(b.s, lv) + (twoHanded(b.s) ? 2 : 0)),
                    text: (b) => `Advantageous Assault ${nameOf(f)} with ${b.s.label} (${signed(b.bonus)}): +${diceOf(b.s, lv) + (twoHanded(b.s) ? 2 : 0)} damage, the same on a miss` }));
                if (pressOk && has(actor, "shatter-defenses") && f.conditions?.has?.("frightened") && !offGuardTo(f)) opts.push(option("Shatter Defenses", 1, {
                    after: (b) => ({ made: made + 1, acAdj: -2 * b.e.hit }), bonus: (b) => b.e.hit * worth(board, "off-guard") * 0.5,
                    text: (b) => `Shatter Defenses ${nameOf(f)} with ${b.s.label} (${signed(b.bonus)}): a hit makes it off-guard until its fear ends` }));
                if (pressOk && has(actor, "disarming-twist") && duelist(board)) opts.push(option("Disarming Twist", 1, {
                    pick: oneHanded, after: (b) => ({ made: made + 1, acAdj: offGuardTo(f) ? acAdj : -2 * degreeChances(b.bonus, f.ac + acAdj).f }), bonus: (b) => b.e.hit * 1,
                    text: (b) => `Disarming Twist ${nameOf(f)} with ${b.s.label} (${signed(b.bonus)}): a hit also Disarms (a miss leaves it off-guard until your turn ends)` }));
                if (pressOk && has(actor, "two-weapon-flurry") && weapons.length >= 2) {
                    const [x, y] = weapons.slice().sort((p, q) => q.avg - p.avg);
                    const e1 = strikeExpected(x.bonus + mapOf(made, x.agile), f.ac + acAdj, x.avg + extraVs(f), { deadly: x.deadly }), e2 = strikeExpected(y.bonus + mapOf(made + 1, y.agile), f.ac + acAdj, y.avg + extraVs(f), { deadly: y.deadly });
                    opts.push({ name: "Two-Weapon Flurry", cost: 1, b: { s: x }, immediate: e1.expected + e2.expected, st: { made: made + 2, acAdj }, text: `Two-Weapon Flurry ${nameOf(f)}: ${x.label} (${signed(x.bonus + mapOf(made, x.agile))}) and ${y.label} (${signed(y.bonus + mapOf(made + 1, y.agile))}) for one action` });
                }
                if (pressOk && last && has(actor, "brutal-finish") && weapons.some(twoHanded)) {
                    const dice = lv >= 18 ? 2 : 1;
                    opts.push(option("Brutal Finish", 1, { pick: twoHanded, extra: (s) => dice * dieAvg(s), bonus: (b) => degreeChances(b.bonus, f.ac + acAdj).f * dice * dieAvg(b.s), after: () => ({ made: made + 1, acAdj, end: true }),
                        text: (b) => `Brutal Finish ${nameOf(f)} with ${b.s.label} (${signed(b.bonus)}): +${dice} weapon ${dice === 1 ? "die" : "dice"}, ${dice} ${dice === 1 ? "die" : "dice"} even on a miss; your turn ends` }));
                }
                const pick = opts.filter(Boolean).sort((p, q) => q.immediate - p.immediate)[0];
                steps.push({ cost: pick.cost, text: pick.text });
                ev += pick.immediate; made = pick.st.made; acAdj = pick.st.acAdj; ended = !!pick.st.end;
            }
            // Desperate Finisher (14): one more press as a reaction, your reactions gone until your next turn
            if (finisher && !ended && made >= 1 && steps.length) {
                const fin = [];
                if (has(actor, "certain-strike")) { const b = best(f, made, { acAdj }); if (b) fin.push({ ev: b.e.expected + degreeChances(b.bonus, f.ac + acAdj).f * flatOf(b.s, lv), text: `Desperate Finisher (reaction): Certain Strike ${nameOf(f)} with ${b.s.label} (${signed(b.bonus)})` }); }
                if (has(actor, "brutal-finish") && weapons.some(twoHanded)) { const dice = lv >= 18 ? 2 : 1; const b = best(f, made, { acAdj, pick: twoHanded, extra: (s) => dice * dieAvg(s) }); if (b) fin.push({ ev: b.e.expected + degreeChances(b.bonus, f.ac + acAdj).f * dice * dieAvg(b.s), text: `Desperate Finisher (reaction): Brutal Finish ${nameOf(f)} with ${b.s.label} (${signed(b.bonus)})` }); }
                if (has(actor, "two-weapon-flurry") && weapons.length >= 2) { const [x, y] = weapons.slice().sort((p, q) => q.avg - p.avg); const e1 = strikeExpected(x.bonus + mapOf(made, x.agile), f.ac + acAdj, x.avg, { deadly: x.deadly }), e2 = strikeExpected(y.bonus + mapOf(made + 1, y.agile), f.ac + acAdj, y.avg, { deadly: y.deadly }); fin.push({ ev: e1.expected + e2.expected, text: `Desperate Finisher (reaction): Two-Weapon Flurry ${nameOf(f)} (${signed(x.bonus + mapOf(made, x.agile))}, ${signed(y.bonus + mapOf(made + 1, y.agile))})` }); }
                for (const s of ["exacting-strike", "advantageous-assault", "dragging-strike", "brutish-shove"]) if (has(actor, s) && !fin.length) { const b = best(f, made, { acAdj, pick: s === "brutish-shove" ? twoHanded : undefined }); if (b) fin.push({ ev: b.e.expected, text: `Desperate Finisher (reaction): ${b.s.label} ${s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} on ${nameOf(f)} (${signed(b.bonus)})` }); }
                const bestFin = fin.sort((p, q) => q.ev - p.ev)[0];
                if (bestFin) { steps.push({ cost: 0, text: `${bestFin.text}; you give up your reactions until your next turn` }); ev += bestFin.ev * 0.8; notes.push("Desperate Finisher spends your reactions: no Reactive Strike until your next turn. Skip it when a foe is about to move past you."); }
            }
            if (!steps.some((s) => s.cost >= 1)) continue;
            if (agileGrace && board.strikes.some((s) => s.agile && !s.ranged)) notes.push("Agile Grace: your agile penalty is -3/-6, counted here.");
            if (supremacyNote) notes.push(supremacyNote);
            const title = presses.length ? `Strike ${nameOf(f)}, then press` : `Strike ${nameOf(f)} at your real penalty`;
            push(title, f, ev, a.sq, steps, notes, 0.25);
        }
    }

    /* ---- Notes: when things fire, what stances give, what's situational ---- */
    const n = (t) => { if (t) out.notes.push(t); };
    if (agileGrace) {
        const agile = board.strikes.filter((s) => s.agile);
        if (agile.length) n(`Agile Grace: -3 and -6 with ${agile.map((s) => s.label).join(", ")} instead of -4 and -8. The generic Strike plans count the usual penalty; the fighter plans here count yours.`);
    }
    if (supremacy) n("Weapon Supremacy: you're quickened every turn, the extra action for a Strike only. The plans count four actions.");
    if (has(actor, "combat-flexibility")) n(`Combat Flexibility: the fighter feat${has(actor, "ultimate-flexibility") ? "s (three, Ultimate Flexibility; an hour's training swaps them)" : has(actor, "improved-flexibility") ? "s (two, Improved Flexibility)" : ""} you prepared this morning ${has(actor, "improved-flexibility") ? "are" : "is"} on your sheet until tomorrow and read like any other.`);
    // Parry and riposte
    const duel = duelist(board);
    if (has(actor, "dueling-dance-fighter") || has(actor, "dueling-dance")) {
        if (stance(/dueling-dance/)) n("Dueling Dance: your Dueling Parry is always up (+2 AC) while you hold one one-handed weapon and nothing else.");
        else if (duel) n("Dueling Dance (1 action, stance): a constant Dueling Parry, +2 AC, with your one-handed weapon and a free hand.");
    } else if (has(actor, "dueling-parry") && ctx.actions >= 1) {
        n(duel ? "Dueling Parry (1 action): +2 AC until your next turn with your one one-handed weapon and a free hand. A good third action when something can reach you." : "Dueling Parry needs a single one-handed weapon and nothing else in your hands.");
    }
    if (has(actor, "dueling-riposte")) {
        const improved = has(actor, "improved-dueling-riposte");
        n(`Dueling Riposte fires when a foe in your reach critically fails a Strike against you${improved ? " (Improved: with or without your parry up, and you have a second reaction each turn for it alone)" : " while your Dueling Parry is up"}: a Strike or a Disarm${has(actor, "guiding-riposte") ? "; Guiding Riposte: a hit moves it up to 10 feet" : ""}.`);
    }
    if (has(actor, "twinned-defense-fighter") || has(actor, "twinned-defense")) {
        if (weapons.length >= 2) n(stance(/twinned-defense/) ? "Twinned Defense: a constant Twin Parry, +1 AC (+2 with a parry weapon) while you hold both weapons." : "Twinned Defense (1 action, stance): a constant Twin Parry, +1 AC (+2 with a parry weapon), with a weapon in each hand.");
    } else if (has(actor, "twin-parry") && weapons.length >= 2 && ctx.actions >= 1) n("Twin Parry (1 action): +1 AC until your next turn (+2 if either weapon has the parry trait). A fair third action when something can reach you.");
    if (has(actor, "improved-twin-riposte-fighter") || has(actor, "improved-twin-riposte")) n("Twin Riposte fires when a foe in your reach critically fails a Strike against you, parry up or not, with a second reaction each turn for it alone.");
    else if (has(actor, "twin-riposte")) n("Twin Riposte fires when a foe in your reach critically fails a Strike against you while your Twin Parry is up: a Strike or a Disarm.");
    if (has(actor, "guardian-s-deflection-fighter") || has(actor, "guardians-deflection")) n(duel ? "Guardian's Deflection fires when an ally in your reach is hit and +2 AC would have made it a miss: you deflect it with your one-handed weapon." : "Guardian's Deflection needs a single one-handed weapon and a free hand to deflect an ally's hit.");
    // Shield
    if (has(actor, "shielded-stride")) n(me.shieldRaised ? "Shielded Stride: with your shield raised you Stride half your Speed without triggering reactions." : me.shield ? "Shielded Stride: Raise a Shield first, then a Stride of half your Speed triggers no reactions." : null);
    if (has(actor, "reactive-shield")) n("Reactive Shield fires when a foe's melee Strike is about to hit you: you Raise your Shield as a reaction.");
    if (has(actor, "aggressive-block") && me.shield) n("Aggressive Block: when your Shield Block takes a melee hit from an adjacent foe, it's pushed 5 feet or off-guard, its choice.");
    if (has(actor, "mirror-shield")) n("Mirror Shield fires when a spell attack against you critically fails while your shield is raised: you throw the spell back with a ranged attack.");
    // Reactions and reach
    const extraRs = [];
    if (has(actor, "tactical-reflexes") || has(actor, "combat-reflexes")) extraRs.push("a second reaction each turn, only for a Reactive Strike");
    if (has(actor, "boundless-reprisals")) extraRs.push("Boundless Reprisals: a fresh reaction at the start of every foe's turn, for fighter reactions only");
    if (extraRs.length) n(`You have ${extraRs.join("; ")}.`);
    if (has(actor, "disorienting-opening")) n("Disorienting Opening: a foe your Reactive Strike hits is off-guard until the start of your next turn.");
    if (has(actor, "lunging-stance")) n(stance(/lunging-stance/) ? "Lunging Stance: your Reactive Strike reaches 5 feet further than your weapon." : "Lunging Stance (1 action): Reactive Strike at reach +5 while you hold a melee weapon.");
    if (has(actor, "disruptive-stance")) n(stance(/disruptive-stance/) ? "Disruptive Stance: a concentrate action in your reach triggers your Reactive Strike too, and a hit disrupts a concentrate or manipulate action, not only a critical hit." : "Disruptive Stance (1 action): worth entering with a caster in reach: Reactive Strike on concentrate actions, and any hit disrupts.");
    if (has(actor, "quick-reversal") && foes.filter((f) => adjacent(me, f)).length >= 2) n("Quick Reversal (1 action, flourish, press) when two foes flank you: Strike one, then the other at the same penalty, the second not counting.");
    if (has(actor, "dazing-blow") && foes.some((f) => f.conditions?.has?.("grabbed") && inReach(me.rect, f.rect, reach))) n("Dazing Blow (1 action, press) on a foe you have grabbed: bludgeoning, and on a hit a Fortitude save or stunned 1 to 3 (incapacitation).");
    if (has(actor, "dashing-strike") && foes.some((f) => adjacent(me, f)) && foes.length >= 2) n("Dashing Strike (1 action, press): Stride from the foe next to you to another and Strike it.");
    if (has(actor, "dual-handed-assault") && duel) n("Dual-Handed Assault (1 action, flourish): your one-handed weapon's die one step bigger for one Strike, your free hand still free after.");
    if (has(actor, "positioning-assault") && weapons.some(twoHanded)) n("Positioning Assault (2 actions, flourish): a two-handed Strike that moves the foe 5 feet on a hit.");
    if (has(actor, "guiding-finish") && duel) n("Guiding Finish (1 action, press): a hit moves the foe up to 10 feet, even through your space; a miss still 5.");
    if (has(actor, "felling-strike") && foes.some((f) => (f.rect?.z ?? 0) > (me.rect?.z ?? 0))) n("Felling Strike (2 actions) on a flier: a hit brings it down up to 120 feet; a critical hit grounds it until your next turn ends.");
    if (has(actor, "revealing-stab") && board.enemies.some((f) => ["concealed", "hidden"].includes(f.state)) && weapons.some(piercing)) n("Revealing Stab (2 actions) with a piercing weapon: no flat check on a concealed foe, DC 5 on a hidden one; a hit leaves the weapon in it and shows everyone where it is.");
    if (has(actor, "cut-from-the-air")) n(`Cut from the Air fires when a physical ranged Strike targets you${has(actor, "smash-from-the-air") ? " or a ranged spell attack (Smash from the Air)" : ""}: +4 AC against it, with a hand free or a melee weapon.`);
    if (has(actor, "reflecting-riposte")) n("Reflecting Riposte fires when you critically succeed at a save against a spell with your shield raised or a parry up: counteract it and throw it back.");
    if (has(actor, "blade-brake")) n("Blade Brake fires when something would push you and a hard surface is in reach: you don't move (5 feet at most from 20 or more).");
    if (has(actor, "rock-the-boat")) n("Rock the Boat fires when a foe in reach knocks you prone or makes you fall: Athletics against its Reflex DC to take it down with you.");
    // Ranged
    const rangedStrikes = board.strikes.filter((s) => s.ranged);
    if (has(actor, "point-blank-stance") && rangedStrikes.length) n(stance(/point-blank/) ? "Point Blank Stance: +2 damage in the first range increment (no volley penalty with a volley weapon). The plans don't count the +2." : "Point Blank Stance (1 action): +2 damage on shots within the first range increment, or no volley penalty.");
    if (has(actor, "parting-shot") && rangedStrikes.length && foes.some((f) => adjacent(me, f))) n("Parting Shot (2 actions): Step away, then a ranged Strike with the foe off-guard to it.");
    if (has(actor, "mobile-shot-stance") && rangedStrikes.length) n(stance(/mobile-shot/) ? "Mobile Shot Stance: your ranged Strikes don't trigger Reactive Strikes." : "Mobile Shot Stance (1 action): shoot in melee without triggering reactions.");
    if (has(actor, "incredible-aim") && rangedStrikes.length && board.enemies.some((f) => f.state === "concealed")) n("Incredible Aim (2 actions) on the concealed foe: +2 and no flat check.");
    if (has(actor, "incredible-ricochet") && rangedStrikes.length) n("Incredible Ricochet (1 action, press): a second shot at a foe you shot at this turn ignores concealment and all cover.");
    if (has(actor, "debilitating-shot") && rangedStrikes.length) n("Debilitating Shot (2 actions, flourish): a hit leaves the foe slowed 1 through its next turn.");
    if (has(actor, "assisting-shot") && rangedStrikes.length) n("Assisting Shot (1 action, press): a hit gives the next ally to attack that foe +1 (+2 on a critical hit).");
    if ((has(actor, "ricochet-stance-fighter") || has(actor, "ricochet-stance")) && board.strikes.some((s) => s.thrown)) n(stance(/ricochet-stance/) ? "Ricochet Stance: your thrown bludgeoning and slashing weapons come back to your hand within their range increment." : "Ricochet Stance (1 action): thrown bludgeoning or slashing weapons return to your hand.");
    if (has(actor, "flinging-charge") && board.strikes.some((s) => s.thrown)) n("Flinging Charge (2 actions, flourish): Stride twice and throw on the way; a hit makes the foe off-guard to your next melee attack this turn.");
    if (has(actor, "rebounding-toss") && board.strikes.some((s) => s.thrown)) n("Rebounding Toss (2 actions, flourish): a thrown hit bounces to a second foe within 10 feet for another Strike, the penalty climbing only afterwards.");
    // Fear and fortitude
    if (fearsome) { const fr = foes.filter((f) => frightOf(f) > 0); if (fr.length) n(`Fearsome Brute: +${fearsome} damage per frightened value against ${fr.map(nameOf).join(", ")}; the fighter plans count it.`); }
    if (has(actor, "shatter-defenses") && !has(actor, "intimidating-strike") && foes.some((f) => frightOf(f) > 0 && !offGuardTo(f))) n(`Shatter Defenses (1 action, press) on ${foes.filter((f) => frightOf(f) > 0 && !offGuardTo(f)).map(nameOf).join(", ")}: a hit makes it off-guard until its fear ends.`);
    if (has(actor, "bravery")) n(`Bravery: frightened comes in one lower, and a success against fear is a critical success${has(actor, "resounding-bravery") ? "; Resounding Bravery: that critical success gives you +1 to saves and temporary HP for a minute" : ""}.`);
    if (has(actor, "determination")) {
        const bad = [...(me.conditions ?? [])].filter((c) => ["frightened", "sickened", "slowed", "stunned", "clumsy", "enfeebled", "stupefied", "drained", "fatigued", "dazzled", "blinded", "deafened", "confused", "fascinated", "fleeing", "paralyzed", "immobilized", "controlled", "doomed"].includes(c));
        const item = actor.items?.find?.((i) => (i.slug ?? i.system?.slug) === "determination");
        const used = item?.system?.frequency && Number(item.system.frequency.value) === 0;
        if (bad.length && !used) n(`Determination (1 action, once a day): end one of ${bad.join(", ")} on you, or counteract a spell on you with a Will save.`);
        else if (used) n("Determination is spent for today.");
    }
    if (has(actor, "savage-critical")) n("Savage Critical: a 19 that hits is a critical hit with your legendary weapon group.");
    if (has(actor, "cheaters-always-prosper")) n("Cheaters Always Prosper: Dirty Trick with your weapon, no free hand needed; drop it to turn a critical failure into a failure.");
    if ((has(actor, "powerful-shove") || has(actor, "flinging-shove")) && !has(actor, "brutish-shove")) n(`${has(actor, "flinging-shove") ? "Flinging Shove: Shove and Aggressive Block move a foe 10 feet, 20 on a critical success" : "Powerful Shove: Shove foes up to two sizes bigger; one that stops against something takes your Strength modifier"}.`);
}

export { fighter };
