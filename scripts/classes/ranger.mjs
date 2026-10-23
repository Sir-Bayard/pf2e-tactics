/**
 * PF2e Tactics: classes/ranger.mjs
 * See classes/_common.mjs for the shape of a class read.
 * Reads Hunt Prey and the edges (the penalty and precision against the prey, Masterful Hunter, Manifold Edge, Swift Prey,
 * Double Prey and Triple Threat), the flourishes against the prey (Twin Takedown, Hunted Shot, Deadly Aim, Hunter's Aim,
 * Second Sting, Impossible Flurry, Impossible Volley, Time Dilation Cascade), Monster Hunter on the Hunt, Warden's Boon,
 * Far Shot and Legendary Shot on the board's ranges. The rest are when-notes.
 */
import { bestStrike, canMove, castable, effect, focusLeft, has, hasAny, standardDC, level, markOffGuard, moveText, myReach, allySpeed, pct, squareToReach, strikeRun, targets, worth, degreeChances, feetBetween, inReach, mapFor, strikeExpected, saveExpected, CONDITION_VALUE, nameOf, reachableSquares, signed } from "./_common.mjs";

const abil = (actor, k) => Number(actor?.abilities?.[k]?.mod ?? actor?.system?.abilities?.[k]?.mod) || 0;
/** Weapon specialization damage for a ranger: expert at 5, master at 13; greater at 15. */
const weaponSpec = (lv) => (lv >= 15 ? 6 : lv >= 13 ? 3 : lv >= 7 ? 2 : 0);
const strikeText = (f, used, tail = "") => `Strike ${nameOf(f)} with ${used[0].s.label}${used.length > 1 ? ` ${used.length === 2 ? "twice" : "three times"}` : ""} (${used.map((u) => signed(u.bonus)).join(", ")})${tail}`;

/** The hunted prey's token ids, from PF2e's token marks (two with Double Prey, three with Triple Threat). */
function huntedPrey(actor) {
    const marks = actor?.synthetics?.tokenMarks;
    const out = [];
    if (!marks?.entries) return out;
    for (const [uuid, slugs] of marks.entries()) if ((Array.isArray(slugs) ? slugs : [slugs]).includes("hunted-prey")) out.push(String(uuid).split(".").pop());
    return out;
}
function ranger(board, ctx, out) {
    const actor = board.me.actor;
    const me = board.me;
    const lv = level(board);
    if (!has(actor, "hunt-prey")) return;
    const edge = has(actor, "flurry") ? "flurry" : has(actor, "precision") ? "precision" : has(actor, "outwit") ? "outwit" : has(actor, "vindicator") || has(actor, "vindication") ? "vindicator" : null;
    const master = lv >= 17 && has(actor, "masterful-hunter");
    const precisionDice = lv >= 19 ? 3 : lv >= 11 ? 2 : 1;
    const foes = targets(board);
    const preyIds = huntedPrey(actor);
    const preys = foes.filter((f) => preyIds.includes(f.id));
    const preyMax = has(actor, "triple-threat") ? 3 : has(actor, "double-prey") ? 2 : 1;
    const str = abil(actor, "str");
    const spec = weaponSpec(lv);
    const swift = lv >= 19 && has(actor, "swift-prey") && ctx.made === 0 && ctx.actions >= 3; // Hunt Prey free as the turn's first action
    const inRange = (s, at, f) => (s.ranged ? feetBetween(at, f.rect) <= (s.range ?? 30) * (master ? 3 : 2) : inReach(at, f.rect, s.reach || 5));
    const melee2 = () => board.strikes.filter((s) => !s.ranged && !s.traits?.includes("unarmed"));
    const reload0 = () => board.strikes.filter((s) => s.ranged && !(s.reload > 0));
    // Far Shot doubles range increments. Its AdjustStrike rule already doubles the weapon's increment on a real sheet, which
    // the board reads; only a Strike whose range still equals its weapon's own (the rule didn't reach it) is doubled here.
    if (has(actor, "far-shot")) for (const s of board.strikes) {
        const base = Number(s.item?._source?.system?.range ?? s.item?._source?.system?.range?.increment) || 0;
        if (s.ranged && s.range && !s.farShot && base && s.range === base) { s.farShot = true; s.range *= 2; }
    }
    // The multiple attack penalty against the prey, by edge
    const mapVs = (n, agile) => (n === 0 ? 0 : edge === "flurry" ? (master ? (n === 1 ? (agile ? -1 : -2) : (agile ? -2 : -4)) : (n === 1 ? (agile ? -2 : -3) : (agile ? -4 : -6))) : mapFor(n, agile));
    /** Precision damage on the hitIndex-th hit of the round against the prey (0-based): 1d8/2d8/3d8 on the first; Masterful Hunter adds a second and a third. */
    const precisionOn = (hitIndex) => (edge !== "precision" ? 0 : hitIndex === 0 ? precisionDice * 4.5 : !master ? 0 : hitIndex === 1 ? (lv >= 19 ? 9 : 4.5) : hitIndex === 2 && lv >= 19 ? 4.5 : 0);
    const edgeText = edge === "flurry" ? `Flurry: your penalty against it is ${master ? "-2/-4 (-1/-2 agile)" : "-3/-6 (-2/-4 agile)"}` : edge === "precision" ? `Precision: +${precisionDice}d8 on your first hit each round${master ? lv >= 19 ? ", +2d8 on the second and +1d8 on the third" : ", +1d8 on the second" : ""}` : edge === "outwit" ? `Outwit: +${master ? 2 : 1} AC against it, +${master ? 4 : 2} to Deception, Intimidation, Stealth and Recall Knowledge about it` : edge === "vindicator" ? "Vindication: your Strikes against it count as sanctified, and the warden spells you cast on it get your deity's edge" : "";
    const deadlyAim = has(actor, "deadly-aim") ? (lv >= 15 ? 8 : lv >= 11 ? 6 : 4) : 0;
    /**
     * A run of Strikes at f with the edge counted: a flourish first when one fits (Twin Takedown with two melee weapons,
     * Hunted Shot with a reload-0 ranged weapon, Deadly Aim on the first ranged Strike), then the best Strike each time.
     */
    const run = (f, actions, made0, { hunted, at = me.rect, flourish = true, hits0 = 0 } = {}) => {
        const steps = [];
        let ev = 0, made = made0, hits = hits0, left = actions, usedFlourish = !flourish;
        const expected = (s, b, extra = 0) => strikeExpected(b, f.ac, s.avg + (hunted ? precisionOn(hits) : 0) + extra, { deadly: s.deadly });
        const twin = has(actor, "twin-takedown") && melee2().length >= 2 && melee2().every((s) => inReach(at, f.rect, s.reach || 5));
        const shot = has(actor, "hunted-shot") && reload0().some((s) => inRange(s, at, f));
        if (hunted && left >= 1 && !usedFlourish && (twin || shot)) {
            const w = twin ? melee2().slice(0, 2) : (() => { const s = reload0().filter((x) => inRange(x, at, f)).sort((a, b) => b.avg - a.avg)[0]; return [s, s]; })();
            let tot = 0;
            const shown = [];
            for (const s of w) { const b = s.bonus + mapVs(made, s.agile); const e = expected(s, b); tot += e.expected; hits += e.hit >= 0.5 ? 1 : 0; made += 1; shown.push(`${s.label} (${signed(b)})`); }
            steps.push({ cost: 1, text: twin ? `Twin Takedown: ${shown.join(" and ")} against ${nameOf(f)}` : `Hunted Shot: two ${w[0].label} Strikes at ${nameOf(f)} (${shown.map((x) => /\(([^)]+)\)/.exec(x)[1]).join(", ")})` });
            ev += tot; left -= 1; usedFlourish = true;
        }
        const used = [];
        let aimed = false;
        const hitsBefore = hits;
        for (let i = 0; i < left; i++) {
            let best = null;
            for (const s of board.strikes) {
                if (!inRange(s, at, f)) continue;
                const b = s.bonus + (hunted ? mapVs(made, s.agile) : mapFor(made, s.agile));
                let e = expected(s, b), aim = false;
                if (hunted && s.ranged && deadlyAim && !usedFlourish) { const d = expected(s, b - 2, deadlyAim); if (d.expected > e.expected) { e = d; aim = true; } }
                // Second Sting: a press (after the first attack) with two melee weapons; a miss still deals the other weapon's flat damage
                const sting = hunted && !s.ranged && made >= 1 && has(actor, "second-sting") && melee2().length >= 2 && melee2().includes(s) ? (1 - e.hit) * 0.8 * (str + spec) : 0;
                const tot = e.expected + sting;
                if (!best || tot > best.tot) best = { s, bonus: aim ? b - 2 : b, e, tot, aim, sting };
            }
            if (!best) break;
            if (best.aim) { usedFlourish = true; aimed = true; }
            used.push(best); ev += best.tot; made += 1; if (best.e.hit >= 0.5) hits += 1;
        }
        if (used.length) steps.push({ cost: used.length, text: strikeText(f, used, `${aimed ? `; Deadly Aim on the ${used[0].aim ? "first" : "aimed one"}: -2 to hit, +${deadlyAim} damage` : ""}${hunted && edge === "precision" && hitsBefore === 0 ? `, +${precisionDice}d8 on the first hit` : ""}${used.some((u) => u.sting) ? "; Second Sting: a miss after the first attack still deals the other weapon's flat damage" : ""}`) });
        return { steps, ev };
    };
    const push = (plan) => out.plans.push({ kind: "class", dest: null, notes: [], ...plan, score: plan.ev + (plan.bias ?? 0.4) });
    /** Monster Hunter: a Recall Knowledge on the prey as part of Hunt Prey; +1 (+2 Legendary) to the next attack on a critical success (a success with Master). */
    const monster = () => {
        if (!has(actor, "monster-hunter")) return null;
        const skills = ["nature", "arcana", "occultism", "religion", "society"].map((k) => actor.skills?.[k]).filter((sk) => sk && (sk.rank ?? 0) >= 1).sort((a, b) => (b.mod ?? 0) - (a.mod ?? 0));
        const sk = has(actor, "master-monster-hunter") ? actor.skills?.nature ?? skills[0] : skills[0];
        if (!sk) return null;
        const c = degreeChances((sk.mod ?? 0) + (edge === "outwit" ? (master ? 4 : 2) : 0), standardDC(lv)); // a creature of the party's level
        const p = has(actor, "master-monster-hunter") ? c.s + c.cs : c.cs;
        const bonus = has(actor, "legendary-monster-hunter") ? 2 : 1;
        return { text: `Monster Hunter: Recall Knowledge on it as part of the Hunt (${sk.label ?? sk.slug ?? "Nature"} ${signed(sk.mod ?? 0)}, about ${pct(p)} for the +${bonus} on your next attack, and your allies' if you tell them)`, ev: p * bonus * 0.1 * (board.strikes[0]?.avg ?? 6) * 2, bonus, p };
    };
    const tail = (one) => (preyMax > 1 && one ? ` and ${preyMax === 3 ? "two more" : "one more"} (${has(actor, "triple-threat") ? "Triple Threat" : "Double Prey"})` : has(actor, "shared-prey") ? " (Shared Prey: or give an ally the benefits too)" : "");

    if (preys.length) {
        for (const prey of preys) {
            out.notes.push(`Hunted prey: ${nameOf(prey)}. ${edgeText}${edgeText ? ". " : ""}No range penalty in its second${master ? " or third" : ""} increment${has(actor, "legendary-shot") && lv >= 20 ? " (five with Legendary Shot)" : ""}${lv >= 5 && has(actor, "ranger-weapon-expertise") ? "; your critical hits on it get the weapon's critical specialization" : ""}.`);
            // Strikes at the prey with the edge: the advisor's own Strike plans don't know the edge, so this one does
            const sq = squareToReach(board, prey, myReach(board), Math.max(0, ctx.actions - 1));
            const ranged = board.strikes.some((s) => s.ranged && inRange(s, me.rect, prey));
            if ((sq || ranged) && ctx.actions >= 1) {
                const moveActs = ranged ? 0 : sq.route.actions;
                const at = moveActs ? { ...me.rect, x: sq.x, y: sq.y } : me.rect;
                const r = run(prey, ctx.actions - moveActs, ctx.made, { hunted: true, at });
                if (r.steps.length) {
                    const steps = moveActs ? [{ cost: moveActs, text: moveText(sq, prey) }, ...r.steps] : r.steps;
                    push({ title: `Strike your prey, ${nameOf(prey)}`, target: prey, ev: r.ev, dest: moveActs ? { x: sq.x, y: sq.y } : null, steps });
                }
            }
        }
        // Hunter's Aim (2 actions, concentrate): one ranged Strike at the prey at +2, no flat check for concealment, through lesser cover
        if (hasAny(actor, "hunters-aim", "hunter-s-aim") && ctx.actions >= 2) for (const prey of preys) {
            const shots = board.strikes.filter((s) => s.ranged && inRange(s, me.rect, prey));
            if (!shots.length) continue;
            const concealed = prey.state === "concealed";
            let best = null;
            for (const s of shots) { const b = s.bonus + mapVs(ctx.made, s.agile) + 2; const e = strikeExpected(b, prey.ac, s.avg + precisionOn(0), { deadly: s.deadly }); const ev = e.expected / (concealed ? 0.8 : 1); if (!best || ev > best.ev) best = { s, b, ev, e }; }
            const steps = [{ cost: 2, text: `Hunter's Aim: ${best.s.label} at ${nameOf(prey)} (${signed(best.b)}, +2 counted${concealed ? ", no flat check for its concealment" : ""}, through lesser cover)` }];
            let ev = best.ev;
            if (ctx.actions >= 3) { const r = run(prey, 1, ctx.made + 1, { hunted: true, flourish: false, hits0: best.e.hit >= 0.5 ? 1 : 0 }); if (r.steps.length) { steps.push(...r.steps); ev += r.ev; } }
            push({ title: `Hunter's Aim at ${nameOf(prey)}`, target: prey, ev, bias: 0.2, steps, notes: ["Two actions for one Strike: it pays when the foe is concealed or behind cover, or when a second Strike would be at a steep penalty."] });
        }
        // Impossible Flurry (3 actions, two melee weapons): three Strikes with each; the first with each as a second attack, the rest at the full penalty
        if (has(actor, "impossible-flurry") && ctx.actions === 3 && ctx.made === 0 && melee2().length >= 2) for (const prey of preys) {
            const w = melee2().slice(0, 2);
            if (!w.every((s) => inReach(me.rect, prey.rect, s.reach || 5))) continue;
            let ev = 0, hits = 0;
            const shown = [];
            for (const s of w) for (let i = 0; i < 3; i++) { const b = s.bonus + mapVs(i === 0 ? 1 : 2, s.agile); const e = strikeExpected(b, prey.ac, s.avg + precisionOn(hits), { deadly: s.deadly }); ev += e.expected; if (e.hit >= 0.5) hits += 1; if (i === 0) shown.push(`${s.label} ${signed(b)} then ${signed(s.bonus + mapVs(2, s.agile))} twice`); }
            push({ title: `Impossible Flurry on ${nameOf(prey)}`, target: prey, ev, bias: 0.3, steps: [{ cost: 3, text: `Impossible Flurry at ${nameOf(prey)}: six Strikes, ${shown.join("; ")}` }], notes: [edge === "flurry" ? "Flurry keeps the penalties low: this is your best turn against a prey you can reach." : "Without the flurry edge most of these land at -10; only against a prey with a low AC."] });
        }
        // Time Dilation Cascade (3 actions): six Strikes now, one action next turn
        if (has(actor, "time-dilation-cascade") && ctx.actions === 3 && ctx.made === 0) for (const prey of preys) {
            const r = run(prey, 6, 0, { hunted: true, flourish: false });
            if (!r.steps.length) continue;
            const back = run(prey, 2, 0, { hunted: true, flourish: false }).ev; // the two actions you won't have next turn
            push({ title: `Time Dilation Cascade on ${nameOf(prey)}`, target: prey, ev: r.ev - back, bias: 0.2, steps: [{ cost: 3, text: `Time Dilation Cascade: six Strikes at ${nameOf(prey)}, the penalty climbing to its maximum; you get 1 action next turn` }], notes: ["Worth it when the fight ends this turn or next; the plan's value already takes off the two actions you lose."] });
        }
        // Warden's Boon (1 action): an ally gets your Hunt Prey and edge against it until the end of their next turn
        if (hasAny(actor, "wardens-boon", "warden-s-boon") && ctx.actions >= 1 && edge) for (const prey of preys) {
            const ally = board.allies.filter((a) => a.canAct !== false && a.hasMelee !== false && feetBetween(me.rect, a.rect) <= 60 && (inReach(a.rect, prey.rect, a.reach ?? 5) || feetBetween(a.rect, prey.rect) <= 30)).sort((a, b) => (b.reactiveStrike?.avg ?? 0) - (a.reactiveStrike?.avg ?? 0))[0];
            if (!ally) continue;
            const avg = ally.reactiveStrike?.avg ?? 6;
            const ev = edge === "flurry" ? 0.1 * avg * (master ? 4 : 3) * 2 : edge === "precision" ? precisionDice * 4.5 * 0.6 : edge === "outwit" ? 1.5 : 1;
            push({ title: `Warden's Boon: ${nameOf(ally)} hunts ${nameOf(prey)}`, target: prey, ev, bias: 0.2, steps: [{ cost: 1, text: `Warden's Boon: ${nameOf(ally)} gets Hunt Prey and your ${edge} edge against ${nameOf(prey)} until the end of their next turn` }], notes: ["A third action when your own Strike would be at -10 and an ally will Strike it twice."] });
        }
    }
    // Hunt Prey (1 action, free with Swift Prey as your first action), then Strike
    if (preys.length < preyMax && (ctx.actions >= 2 || swift) && foes.length) {
        const mh = monster();
        const others = foes.filter((f) => !preyIds.includes(f.id));
        for (const f of others) {
            const spare = ctx.actions - (swift ? 0 : 1);
            const sq = squareToReach(board, f, myReach(board), spare - 1);
            const ranged = board.strikes.some((s) => s.ranged && inRange(s, me.rect, f));
            if (!sq && !ranged) continue;
            const moveActs = ranged ? 0 : sq.route.actions;
            const left = spare - moveActs;
            if (left < 1) continue;
            const r = run(f, left, ctx.made, { hunted: true, at: moveActs ? { ...me.rect, x: sq.x, y: sq.y } : me.rect });
            if (!r.steps.length) continue;
            const steps = [{ cost: swift ? 0 : 1, text: `${swift ? "Swift Prey: Hunt Prey as a free action" : "Hunt Prey"}: ${nameOf(f)}${tail(true)}${edgeText ? ` (${edgeText})` : ""}${mh ? `; ${mh.text}` : ""}` }];
            if (moveActs) steps.push({ cost: moveActs, text: moveText(sq, f) });
            steps.push(...r.steps);
            const notes = ["Hunt Prey lasts until your next daily preparations, or until you hunt something else."];
            if (has(actor, "manifold-edge")) notes.push("Manifold Edge: you may take a different edge for this Hunt (flurry for many Strikes, precision for one big hit, outwit to survive it), without Masterful Hunter's extra.");
            push({ title: `Hunt ${nameOf(f)}, then Strike`, target: f, ev: r.ev + (mh?.ev ?? 0), dest: moveActs ? { x: sq.x, y: sq.y } : null, steps, notes });
        }
    }
    // Impossible Volley (3 actions, a volley weapon with reload 0): a Strike at -2 at every foe in a 10-foot burst beyond the volley range
    if (has(actor, "impossible-volley") && ctx.actions === 3) {
        const bow = board.strikes.find((s) => s.ranged && s.volley > 0 && !(s.reload > 0));
        if (bow) {
            let best = null;
            for (const c of foes) {
                const hit = foes.filter((f) => feetBetween(c.rect, f.rect) <= 10 && feetBetween(me.rect, f.rect) >= bow.volley && feetBetween(me.rect, f.rect) <= bow.range * 2);
                if (hit.length < 2) continue;
                let ev = 0;
                for (const f of hit) ev += strikeExpected(bow.bonus - 2 + (preyIds.includes(f.id) ? mapVs(ctx.made, bow.agile) : mapFor(ctx.made, bow.agile)), f.ac, bow.avg, { deadly: bow.deadly }).expected;
                if (!best || ev > best.ev) best = { c, hit, ev };
            }
            if (best) push({ title: `Impossible Volley on ${best.hit.length} foes`, target: best.c, ev: best.ev, bias: 0.3, steps: [{ cost: 3, text: `Impossible Volley with ${bow.label} centred on ${nameOf(best.c)}: ${best.hit.map(nameOf).join(", ")} each at ${signed(bow.bonus - 2 + mapFor(ctx.made, bow.agile))}, one damage roll` }], notes: ["The burst must sit at or beyond the weapon's volley range; all the attacks count toward your penalty afterward."] });
        }
    }

    // ---- when-notes
    if (has(actor, "quick-draw")) out.notes.push("Quick Draw (1 action): draw a weapon and Strike with it in one action; a stowed bow or blade costs you no extra action to bring out.");
    if (has(actor, "crossbow-ace") && board.strikes.some((s) => s.ranged && s.reload >= 1)) out.notes.push("Crossbow Ace (1 action): Step or Take Cover, then reload your crossbow; a reload action that also moves you.");
    if (has(actor, "running-reload") && board.strikes.some((s) => s.ranged && s.reload >= 1)) out.notes.push("Running Reload (1 action): Stride, Step or Sneak, then reload; the plans' reload actions can be this one.");
    if (has(actor, "relentless-stalker") && preys.some((p) => inReach(me.rect, p.rect, 5))) out.notes.push("Relentless Stalker (reaction): when your adjacent prey moves away, you Stride with it and stay adjacent.");
    if (has(actor, "disrupt-prey") && preys.some((p) => inReach(me.rect, p.rect, myReach(board)))) out.notes.push("Disrupt Prey (reaction): when your prey in reach moves, uses a manipulate action or leaves a square, a melee Strike on it; a critical hit disrupts the action.");
    if (has(actor, "favored-prey") || has(actor, "giant-hunter")) out.notes.push(`${has(actor, "giant-hunter") ? "Giant Hunter" : "Favored Prey"}: when you roll initiative seeing ${has(actor, "giant-hunter") ? "a giant" : "one of your favored kind"}, Hunt it as a free action.`);
    if (has(actor, "nature-prowler")) out.notes.push("Nature Prowler: when your turn begins with you hidden from or unnoticed by your prey, it's off-guard to you until the end of your turn.");
    if (has(actor, "snap-shot") && board.strikes.some((s) => s.ranged)) out.notes.push("Snap Shot: a reaction that would make a melee Strike can be a ranged Strike at an adjacent foe instead.");
    if (has(actor, "mature-animal-companion-ranger") || has(actor, "mature-animal-companion")) out.notes.push(`Your companion acts once on its own (Stride or Strike) if you don't Command it${hasAny(actor, "companions-cry", "companion-s-cry") ? "; Companion's Cry: a 2-action Command gives it an extra action" : ""}.`);
    else if (hasAny(actor, "companions-cry", "companion-s-cry")) out.notes.push("Companion's Cry: spend 2 actions to Command an Animal and your companion gets an extra action.");
    if (has(actor, "side-by-side-ranger") || has(actor, "side-by-side")) out.notes.push("Side by Side: a foe adjacent to both you and your companion is flanked by you both, wherever you stand.");
    if (has(actor, "twin-parry") && melee2().length >= 2 && ctx.actions >= 1) out.notes.push(`Twin Parry (1 action): +${melee2().some((s) => s.traits?.includes("parry")) ? 2 : 1} AC until your next turn with both weapons in hand${has(actor, "twin-riposte") ? "; Twin Riposte then Strikes a foe that critically misses you" : ""}${has(actor, "improved-twin-riposte-ranger") || has(actor, "improved-twin-riposte") ? "; Improved Twin Riposte gives you a second reaction for it each turn" : ""}.`);
    if (has(actor, "united-assault")) out.notes.push("United Assault (1 action): a Strike with +1 damage per other creature that damaged the target since its last turn (up to +4); a good first Strike after your allies have gone.");
    if (has(actor, "skirmish-strike")) out.notes.push("Skirmish Strike (1 action): Step and Strike in either order; the plans' Step-then-Strike turns cost one action less with it.");
    if (lv >= 9 && hasAny(actor, "natures-edge", "nature-s-edge")) out.notes.push("Nature's Edge: a foe standing in difficult terrain is off-guard to you.");
    if (has(actor, "blind-fight") && foes.some((f) => f.state === "concealed" || f.state === "hidden")) out.notes.push("Blind-Fight: no flat check against a concealed foe, and a hidden one only needs a DC 5.");
    if (has(actor, "hamstringing-strike") && preys.length) out.notes.push("Hamstringing Strike (1 action): a Strike at -2 on your prey; a hit cuts its Speed by 5 feet (10 on a critical hit).");
    if (has(actor, "penetrating-shot") && preys.length && board.strikes.some((s) => s.ranged)) out.notes.push("Penetrating Shot (2 actions): when another creature gives your prey lesser cover, one Strike at both that ignores the cover; it counts as two attacks.");
    if (has(actor, "greater-distracting-shot") && board.strikes.some((s) => s.ranged)) out.notes.push("Greater Distracting Shot: any ranged hit on your prey makes it off-guard until your next turn; a critical hit or two hits, until the end of your next turn.");
    else if (has(actor, "distracting-shot") && board.strikes.some((s) => s.ranged)) out.notes.push("Distracting Shot: a critical hit on your prey with a ranged weapon, or two hits on it in a turn, makes it off-guard until your next turn; Hunted Shot gets you there in one action.");
    if (has(actor, "targeting-shot") && preys.some((p) => p.state === "concealed") && board.strikes.some((s) => s.ranged)) out.notes.push("Targeting Shot (1 action, after your first attack): a ranged Strike on your prey that ignores its concealment and all cover.");
    if (has(actor, "camouflage")) out.notes.push("Camouflage: in natural terrain you can Hide and Sneak without cover.");
    if (has(actor, "shadow-hunter")) out.notes.push("Shadow Hunter: in natural terrain you're concealed from every foe but your prey, if you choose.");
    if (hasAny(actor, "wardens-step", "warden-s-step")) out.notes.push("Warden's Step: your allies get your Avoid Notice in natural terrain during exploration.");
    if (has(actor, "giant-slayer")) out.notes.push("Giant Slayer: two critical hits on the same giant in one turn and it must save against your class DC or die.");
    if (has(actor, "roll-with-it-kingmaker")) out.notes.push("Roll with It (reaction): when your giant prey hits you in melee, a Reflex save turns the hit aside or halves it.");
    if (has(actor, "perfect-shot") && preys.length && board.strikes.some((s) => s.ranged && s.reload >= 1)) out.notes.push("Perfect Shot (3 actions, a loaded reload weapon you haven't reloaded since last turn): one Strike at your prey for maximum damage; your turn ends.");
    if (has(actor, "legendary-shot") && lv >= 20) out.notes.push("Legendary Shot: no range penalty on your prey out to five increments with a weapon you've mastered.");
    if (has(actor, "superior-sight")) out.notes.push("Superior Sight: no flat check against a concealed, hidden or invisible foe.");
    if (has(actor, "mimic-protections") && preys.length) out.notes.push("Mimic Protections: resistance 10 to every damage type your prey resists, while it's within 100 feet.");
    if (has(actor, "to-the-ends-of-the-earth") && preys.length) out.notes.push("To the Ends of the Earth: you know your prey's exact position wherever it goes.");
    if (has(actor, "ultimate-skirmisher")) out.notes.push("Ultimate Skirmisher: difficult and hazardous terrain don't slow you, and hazards you walk onto don't trigger.");
    if (has(actor, "dazzling-display") && me.intimidation != null && ctx.actions >= 1) {
        const near = foes.filter((f) => feetBetween(me.rect, f.rect) <= 30 && !f.conditions?.has?.("frightened"));
        if (near.length >= 2) out.notes.push(`Dazzling Display (1 action): Demoralize every foe within 30 feet (${near.length} now), +1 if your last action was a critical hit or a kill; each is then immune for a minute.`);
    }
    // Warden spells: what the pool holds
    const fp = focusLeft(actor);
    const gravity = (board.spells ?? []).some((sp) => /^gravity weapon$/i.test(sp.name ?? "")) || (actor.items ?? []).some?.((i) => i.type === "spell" && /^gravity weapon$/i.test(i.name ?? ""));
    if (has(actor, "warden-spells") || has(actor, "initiate-warden") || gravity) out.notes.push(`Warden spells are focus spells${fp != null ? ` (${fp} Focus Point${fp === 1 ? "" : "s"} left)` : ""}${gravity ? ": Gravity Weapon (1 action) gives a status bonus to damage of twice your weapon's damage dice on your first weapon Strike each round, for a minute" : ""}${hasAny(actor, "wardens-focus", "warden-s-focus") ? "; Warden's Focus refills the whole pool when you Refocus" : ""}${hasAny(actor, "wardens-reload", "warden-s-reload") ? "; Warden's Reload reloads for free right after a warden spell" : ""}.`);
}

export { ranger };
