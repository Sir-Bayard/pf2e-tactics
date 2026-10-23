/**
 * PF2e Tactics: classes/guardian.mjs
 * See classes/_common.mjs for the shape of a class read.
 * Reads the guardian (Battlecry!): Taunt on the foe most likely to hurt an ally (its estimated Strike, who it can reach,
 * how hurt they are) with Taunting Strike, Shielding Taunt, Long-Distance Taunt, Group Taunt and Bodyguard; where to stand
 * so Intercept Attack covers the ally the foes will hit; the stances (Hampering, Covering) and the stance feats (Lock Down,
 * Not So Fast!); the Strikes with a rider (Shoulder Check, Shield Wallop, Proud Nail, Ring Their Bell, Weakening Assault,
 * Clobber, Demolish Defenses, Bloody Denial, Belly Flop, Momentum Strike); the shoves and charges (Flying Tackle, Stomp
 * Ground, Scattering Charge, Retaliating Rescue, Armor Break); Blanket Defense; the once-a-while HP feats; and when-notes
 * for the reactions and the passives that change a maneuver (Larger Than Life, Punishing Shove, Right Where You Want Them).
 * Slugs are checked in both spellings ("guardians-armor" / "guardian-s-armor").
 */
import { bestStrike, canMove, effect, has, level, moveText, myReach, pct, squareToReach, strikeRun, targets, worth, degreeChances, feetBetween, inReach, mapFor, strikeExpected, saveExpected, nameOf, reachableSquares, signed } from "./_common.mjs";

/** Foundry's slugs drop apostrophes ("guardians-armor"); the catalog's keep a dash ("guardian-s-armor"). Both are tried. */
const hasAny = (actor, ...slugs) => slugs.some((s) => has(actor, s) || has(actor, s.replace(/-s-/g, "s-")) || has(actor, s.replace(/([a-z])s-/, "$1-s-")));
const abil = (actor, k) => Number(actor?.abilities?.[k]?.mod ?? actor?.system?.abilities?.[k]?.mod) || 0;
/** The average of one weapon die of a Strike: from its formula ("2d12+6" -> 6.5), else a d8. */
const dieAvg = (s) => { const m = /(\d+)d(\d+)/.exec(String(s?.formula ?? "")); return m ? (Number(m[2]) + 1) / 2 : 4.5; };
/** Uses left today or this hour of a feat with a frequency, or null when the sheet doesn't say. */
const usesLeft = (actor, slug) => { const i = actor?.items?.find?.((x) => (x.slug ?? x.system?.slug) === slug); const v = i?.system?.frequency?.value; return v == null ? null : Number(v); };
const plural = (xs) => (xs.length > 1 ? "are" : "is");
const list = (xs) => xs.map(nameOf).join(", ");

function guardian(board, ctx, out) {
    const actor = board.me.actor;
    const me = board.me;
    const lv = level(board);
    if (!(has(actor, "taunt") || has(actor, "intercept-attack") || hasAny(actor, "guardian-s-techniques"))) return;
    const foes = targets(board);
    const allies = board.allies.filter((a) => a.canAct !== false || a.hp > 0);
    const str = abil(actor, "str");
    const acts = ctx.actions;
    const reach = myReach(board);
    const cat = actor.wornArmor?.category ?? actor.system?.attributes?.armor?.category ?? null;
    const armored = cat ? ["medium", "heavy"].includes(cat) : true; // a guardian without armor on the sheet is still read as armored
    const heavy = cat ? cat === "heavy" : true;
    const classDC = actor.classDC?.value ?? actor.system?.attributes?.classDC?.value ?? 10 + lv + (lv >= 19 ? 6 : lv >= 9 ? 4 : 2) + 2;
    const halfLv = Math.floor(lv / 2);
    const resist = armored ? (has(actor, "unyielding-force") ? 6 : 1) + halfLv : 0;
    const athRank = actor.skills?.athletics?.rank ?? 1;
    const punish = has(actor, "punishing-shove") ? str + [0, 0, 2, 6, 12][Math.min(4, athRank)] : 0;
    const stance = effect(actor, /hampering-stance|covering-stance/);
    const hampering = !!effect(actor, /hampering-stance/);
    const covering = !!effect(actor, /covering-stance/);
    const melee = board.strikes.filter((s) => !s.ranged);
    const bestMelee = melee.slice().sort((a, b) => b.bonus - a.bonus)[0] ?? null;
    const push = (title, target, ev, sq, steps, notes = [], bias = 0.3) => out.plans.push({ kind: "class", title, target, ev, score: ev + bias, dest: sq?.route?.actions ? { x: sq.x, y: sq.y, z: sq.z } : null, steps, notes });

    // --- Marks: Larger Than Life makes your Shove, Trip, Grapple and Reposition reach a size larger (the advisor's maneuver plans see it)
    if (hasAny(actor, "larger-than-life-guardian", "larger-than-life") && heavy && !me.largerThanLife) { me.largerThanLife = true; me.sizeRank = (me.sizeRank ?? 2) + 1; out.notes.push("Larger Than Life: in heavy armor you count as one size larger for Shove, Trip, Grapple, Reposition and Swallow Whole; the maneuver plans count it."); }

    // --- Who the foes will hurt: each foe's estimated Strike against each ally it can reach, weighted by how hurt the ally is
    const allyAc = (a) => a.ac ?? 10 + lv + 6;
    const reachFactor = (f, a) => {
        const fr = f.reach || 5;
        const feet = feetBetween(f.rect, a.rect);
        let k = inReach(f.rect, a.rect, fr) ? 1 : feet <= fr + 25 ? 0.8 : f.rangedReach && feet <= f.rangedReach ? 0.8 : 0.2;
        if (inReach(f.rect, me.rect, fr) && !inReach(f.rect, a.rect, fr)) k *= 0.6; // it has you in reach already
        return k;
    };
    const threatTo = (f, a) => 2 * strikeExpected(f.reactiveStrike?.bonus ?? lv + 8, allyAc(a), f.reactiveStrike?.avg ?? 4 + lv * 1.5).expected * reachFactor(f, a) * (1 + 0.6 * (1 - Math.min(1, a.hp / Math.max(1, a.maxHp))));
    const threat = new Map(foes.map((f) => { let best = null; for (const a of allies) { const v = threatTo(f, a); if (!best || v > best.value) best = { ally: a, value: v }; } return [f.id, best ?? { ally: null, value: 0 }]; }));
    const allyThreat = (a) => Math.max(0, ...foes.map((f) => threatTo(f, a)));
    const menaced = allies.filter((a) => allyThreat(a) > 1).sort((x, y) => allyThreat(y) - allyThreat(x));
    const maxFoeAvg = Math.max(4, ...foes.map((f) => f.reactiveStrike?.avg ?? 0));

    // --- Intercept Attack: who it covers from here, what you resist, what the feats add
    const intercept = has(actor, "intercept-attack") || hasAny(actor, "guardian-s-techniques");
    const coverRange = 10;
    if (intercept) {
        const covered = allies.filter((a) => feetBetween(me.rect, a.rect) <= coverRange);
        const uncovered = menaced.filter((a) => !covered.includes(a));
        const bits = [`Intercept Attack (reaction): when an ally within 10 feet takes physical${has(actor, "energy-interceptor") ? ", acid, cold, electricity, fire or sonic" : ""} damage (15 feet when it comes from your taunted foe), you Step to them and take it instead${resist ? `, resisting ${resist} of physical` : ""}`];
        bits.push(`covers ${covered.length ? list(covered) : "nobody"} now${uncovered.length ? `; ${list(uncovered)} ${plural(uncovered)} ${uncovered.map((a) => feetBetween(me.rect, a.rect)).join(" and ")} feet off` : ""}`);
        if (has(actor, "get-behind-me")) bits.push("Get Behind Me: you can move the ally 10 feet away from the attacker as part of it");
        if (has(actor, "disarming-intercept")) bits.push("Disarming Intercept: against an adjacent foe's melee weapon you then try to Disarm it, no hand needed");
        if (has(actor, "armored-counterattack")) bits.push("Armored Counterattack: against an adjacent foe's melee Strike you Strike back, and a hit Taunts it");
        if (covering) bits.push("Covering Stance: the ally you cover Steps free after it");
        if (has(actor, "quick-vengeance")) bits.push("Quick Vengeance: after it or Shield Block you're quickened next turn to Stride at or Strike that foe");
        out.notes.push(bits.join("; ") + ".");
        if (has(actor, "reaction-time")) out.notes.push(`Reaction Time: a second reaction each turn for guardian reactions, so Intercept Attack and ${has(actor, "shield-block") ? "Shield Block" : "another guardian reaction"} can both fire in one round.`);
        else if ((board.round ?? 2) <= 1) out.notes.push("Ever Ready: you have a reaction before your first turn, for Intercept Attack or another guardian reaction.");
    }

    // --- Taunt: the foe most likely to hurt an ally, then Strikes from a square that also keeps Intercept Attack in range
    const tauntRange = has(actor, "long-distance-taunt") ? 120 : 30;
    const bodyguard = has(actor, "bodyguard");
    const tauntWorth = (f) => { const t = threat.get(f.id); const w = 0.25 * t.value + (t.value > 1 ? 0.4 * worth(board, "off-guard") : 0); return bodyguard ? w * 1.15 : w; };
    const tauntText = (fs) => `Taunt ${list(fs)}: -1 to ${fs.length > 1 ? "their" : "its"} attacks and DCs against anyone but you${bodyguard ? " (-2 against your charge)" : ""} until your next turn; ${fs.length > 1 ? "one that acts" : "if it acts"} against an ally and not you ${fs.length > 1 ? "is" : "it's"} off-guard until ${fs.length > 1 ? "its" : "its"} next turn${fs.length === 1 ? ` (${nameOf(threat.get(fs[0].id).ally ?? allies[0] ?? me)} is who it's likeliest to go for)` : ""}`;
    const shieldWorth = 0.2 * maxFoeAvg + 1;
    const coverWorth = (sq, taunted) => {
        // Intercept Attack from that square: the single most threatened ally inside 10 feet (15 from the taunted foe)
        let best = 0;
        for (const a of menaced) { const r = taunted && threat.get(taunted.id)?.ally === a ? 15 : coverRange; if (feetBetween({ ...me.rect, x: sq.x, y: sq.y }, a.rect) <= r) best = Math.max(best, 0.4 * allyThreat(a)); }
        return best;
    };
    const tauntable = foes.filter((f) => feetBetween(me.rect, f.rect) <= tauntRange).sort((a, b) => tauntWorth(b) - tauntWorth(a));
    const taunts = has(actor, "group-taunt") ? tauntable.slice(0, 3) : tauntable.slice(0, 1);
    const tauntValue = taunts.reduce((s, f, i) => s + tauntWorth(f) * [1, 0.8, 0.7][i], 0);
    if (has(actor, "taunt") && acts >= 1 && taunts.length && canMove(me)) {
        const t0 = taunts[0];
        const coverHere = intercept ? coverWorth({ x: me.rect.x, y: me.rect.y }, t0) : 0;
        const sqs = reachableSquares(board, Math.max(0, acts - 2)).filter((sq) => sq.route.actions === 0 || sq.route.provokes.length === 0 || acts >= 3);
        let best = null;
        for (const sq of sqs) {
            const at = { ...me.rect, x: sq.x, y: sq.y };
            const left = acts - 1 - sq.route.actions;
            const near = foes.filter((f) => inReach(at, f.rect, reach));
            // Strikes from there: the taunted foe if it's in reach, else the best run on anyone
            let run = null, target = null;
            if (left >= 1) for (const f of near) { const r = strikeRun(board, f, left, { made: ctx.made }); if (r.used.length && (!run || r.ev + (f === t0 ? 0.5 : 0) > run.ev + (target === t0 ? 0.5 : 0))) { run = r; target = f; } }
            const cover = intercept ? coverWorth(sq, t0) - coverHere : 0; // what moving gains or loses for Intercept Attack
            const ev = (run?.ev ?? 0) + cover - sq.route.provokes.length * 2 - (sq.route.actions ? 0.1 : 0);
            if (!best || ev > best.ev) best = { sq, run, target, cover, ev, left };
        }
        if (best) {
            const steps = [];
            let ev = tauntValue + best.ev;
            const notes = [];
            const shieldTaunt = has(actor, "shielding-taunt") && me.shield && !me.shieldRaised && taunts.length === 1;
            const taunting = has(actor, "taunting-strike") && taunts.length === 1 && best.target === t0 && best.run;
            if (taunting) {
                // Taunting Strike: the first Strike at it is the Taunt too, so the turn has one more Strike in it
                const run = strikeRun(board, t0, best.left + 1, { made: ctx.made });
                if (best.sq.route.actions) steps.push({ cost: best.sq.route.actions, text: moveText(best.sq, t0) });
                steps.push({ cost: 1, text: `Taunting Strike ${nameOf(t0)} with ${run.used[0].s.label} (${signed(run.used[0].bonus)}): hit or miss it's Taunted (${tauntText([t0]).replace(/^Taunt [^:]+: /, "")})` });
                if (run.used.length > 1) steps.push({ cost: run.used.length - 1, text: `Strike ${nameOf(t0)} with ${run.used[1].s.label}${run.used.length > 2 ? " twice" : ""} (${run.used.slice(1).map((u) => signed(u.bonus)).join(", ")})` });
                ev = tauntValue + run.ev + best.cover - best.sq.route.provokes.length * 2;
                notes.push("Taunting Strike is a flourish: one a turn.");
            } else {
                steps.push({ cost: 1, text: shieldTaunt ? `Shielding Taunt: Raise your Shield and ${tauntText(taunts)}` : tauntText(taunts) });
                if (shieldTaunt) { ev += shieldWorth; notes.push("Shielding Taunt is a flourish: one a turn."); }
                if (best.sq.route.actions) steps.push({ cost: best.sq.route.actions, text: best.target ? moveText(best.sq, best.target) : `Stride to stand within ${coverRange} feet of ${list(menaced.slice(0, 1))} for Intercept Attack` });
                if (best.run) steps.push({ cost: best.run.used.length, text: best.run.text });
            }
            if (taunts.length > 1) notes.push("Group Taunt: up to three taunted foes at once; each new Taunt lets you drop or keep the old ones.");
            const coveredThere = menaced.filter((a) => feetBetween({ ...me.rect, x: best.sq.x, y: best.sq.y }, a.rect) <= (threat.get(t0.id)?.ally === a ? 15 : coverRange));
            if (intercept && best.sq.route.actions && coveredThere.length) notes.push(`From there Intercept Attack covers ${list(coveredThere)}.`);
            else if (intercept && menaced.length && !coveredThere.length) notes.push(`${list(menaced.slice(0, 1))} stays out of Intercept Attack's reach${best.sq.route.actions ? " from there" : ""}.`);
            if (has(actor, "bodyguard")) notes.push("Bodyguard: the penalty is -2 against the ally you named your charge today.");
            push(`Taunt ${list(taunts)}${best.run ? `, Strike ${nameOf(best.target)}` : ""}`, t0, ev, best.sq, steps, notes, 0.35);
        }
    } else if (has(actor, "taunt") && acts >= 1 && !taunts.length && foes.length) out.notes.push(`Taunt reaches ${tauntRange} feet: no foe in sight is that close.`);

    // --- Weakening Assault (12th) and Demolish Defenses (18th): the Taunt, then the two-action Strike on the taunted foe
    const t0 = taunts[0] ?? null;
    if (t0 && acts >= 3 && (has(actor, "weakening-assault") || has(actor, "demolish-defenses"))) {
        const sq = squareToReach(board, t0, reach, acts - 3);
        if (sq) {
            const steps = [{ cost: 1, text: tauntText([t0]) }];
            if (sq.route.actions) steps.push({ cost: sq.route.actions, text: moveText(sq, t0) });
            if (has(actor, "weakening-assault")) {
                const r = strikeRun(board, t0, 2, { made: ctx.made });
                if (r.used.length === 2) {
                    const p1 = r.used[0].e.hit, p2 = r.used[1].e.hit;
                    const both = p1 * p2, one = p1 + p2 - 2 * both;
                    const ev = tauntValue + r.ev + one * worth(board, "enfeebled") + both * 3 * worth(board, "enfeebled");
                    push(`Taunt ${nameOf(t0)}, Weakening Assault`, t0, ev, sq, [...steps, { cost: 2, text: `Weakening Assault ${nameOf(t0)}: Strike twice with ${r.used[0].s.label} (${r.used.map((u) => signed(u.bonus)).join(", ")}); one hit leaves it enfeebled 1, both hits enfeebled 3, until your next turn` }], [], 0.3);
                }
            }
            if (has(actor, "demolish-defenses")) {
                const b = bestStrike(board, t0, { made: ctx.made, extra: 2 * dieAvg(bestMelee) });
                if (b) {
                    const c = degreeChances(t0.saves?.fortitude ?? lv + 5, classDC);
                    const rider = c.s * worth(board, "off-guard") + c.f * (2 * worth(board, "clumsy") + worth(board, "off-guard")) + c.cf * (3 * worth(board, "clumsy") + worth(board, "off-guard"));
                    const ev = tauntValue + b.e.expected + b.e.hit * rider;
                    push(`Taunt ${nameOf(t0)}, Demolish Defenses`, t0, ev, sq, [...steps, { cost: 2, text: `Demolish Defenses ${nameOf(t0)} with ${b.s.label} (${signed(b.bonus)}, two extra weapon dice against your taunted foe): a hit makes it save (Fortitude DC ${classDC}) or be off-guard until your next turn, clumsy 2 on a failure (about ${pct(c.f + c.cf)}), clumsy 3 on a critical failure` }], ["Demolish Defenses counts as two attacks for your penalty."], 0.3);
                }
            }
        }
    }

    // --- The foe that ignored your Taunt: it's off-guard, and Proud Nail or Ring Their Bell make it pay
    const fist = melee.find((s) => /\bfist\b/i.test(s.label)) ?? null;
    const shieldStrike = melee.find((s) => /shield (?:bash|boss|spikes)/i.test(s.label)) ?? null;
    const armorStrike = () => shieldStrike ?? fist ?? (bestMelee ? { label: "Fist", bonus: bestMelee.bonus, avg: 2.5 + str, agile: true, ranged: false, reach: 5, traits: ["agile", "unarmed"], deadly: 0 } : null);
    const ignored = foes.filter((f) => f.conditions?.has?.("off-guard") && inReach(me.rect, f.rect, reach));
    if (acts >= 1 && ignored.length && (has(actor, "proud-nail") || has(actor, "ring-their-bell"))) {
        for (const f of ignored) {
            if (has(actor, "proud-nail")) {
                const dice = lv >= 18 ? 3 : lv >= 10 ? 2 : 1;
                const b = bestStrike(board, f, { made: ctx.made, extra: dice * dieAvg(bestMelee) });
                if (b) {
                    const run = acts > 1 ? strikeRun(board, f, acts - 1, { made: ctx.made + 1 }) : null;
                    const steps = [{ cost: 1, text: `Proud Nail ${nameOf(f)} with ${b.s.label} (${signed(b.bonus)}): ${dice} extra weapon ${dice > 1 ? "dice" : "die"} on a hit` }];
                    if (run?.used.length) steps.push({ cost: run.used.length, text: run.text });
                    push(`Proud Nail ${nameOf(f)}`, f, b.e.expected + (run?.ev ?? 0), null, steps, ["Only if it's off-guard for ignoring your Taunt (it went for an ally and not you). Flourish: one a turn."], 0.3);
                }
            }
            if (has(actor, "ring-their-bell") && armored) {
                const s = armorStrike();
                if (s) {
                    const bonus = s.bonus + mapFor(ctx.made, s.agile);
                    const e = strikeExpected(bonus, f.ac, s.avg, { deadly: s.deadly });
                    const c = degreeChances(f.saves?.fortitude ?? lv + 5, classDC);
                    const stun = c.s * 1 + c.f * 2 + c.cf * 3;
                    const ev = e.expected + e.hit * stun * worth(board, "stunned") * 0.8;
                    const run = acts > 1 ? strikeRun(board, f, acts - 1, { made: ctx.made + 1 }) : null;
                    const steps = [{ cost: 1, text: `Ring Their Bell: ${s.label} Strike ${nameOf(f)} (${signed(bonus)}); a hit makes it save (Fortitude DC ${classDC}) or be stunned 1, stunned 2 on a failure (about ${pct(c.f + c.cf)}), 3 on a critical failure` }];
                    if (run?.used.length) steps.push({ cost: run.used.length, text: run.text });
                    push(`Ring Their Bell ${nameOf(f)}`, f, ev + (run?.ev ?? 0), null, steps, ["Only if it's off-guard for ignoring your Taunt. Incapacitation: a foe above your level treats its save as one degree better. Flourish: one a turn."], 0.3);
                }
            }
        }
    } else {
        if (has(actor, "proud-nail")) out.notes.push(`Proud Nail (1 action): when your taunted foe is off-guard for ignoring you, a melee Strike at it adds ${lv >= 18 ? 3 : lv >= 10 ? 2 : 1} weapon ${lv >= 10 ? "dice" : "die"}.`);
        if (has(actor, "ring-their-bell")) out.notes.push("Ring Their Bell (1 action): when your taunted foe is off-guard for ignoring you, a fist or shield Strike that hits makes it save or be stunned 1 to 3 (incapacitation).");
    }

    // --- Shoulder Check (1st): an armor Strike that opens the foe up for the next melee Strike this turn
    if (has(actor, "shoulder-check") && armored && acts >= 2 && bestMelee) {
        const s = armorStrike();
        for (const f of foes) {
            const sq = squareToReach(board, f, 5, acts - 2);
            if (!sq || !s) continue;
            const left = acts - 1 - sq.route.actions;
            if (left < 1) continue;
            const bonus = s.bonus + mapFor(ctx.made, s.agile);
            const e = strikeExpected(bonus, f.ac, s.avg, { deadly: s.deadly });
            const og = f.conditions?.has?.("off-guard");
            // Success: off-guard to your next melee Strike this turn; a critical: to all of them until your next turn
            const next = bestStrike(board, f, { made: ctx.made + 1, acAdj: og ? 0 : -2 * e.hit });
            const rest = left > 1 ? strikeRun(board, f, left - 1, { made: ctx.made + 2, acAdj: og ? 0 : -2 * e.crit }) : null;
            if (!next) continue;
            const ev = e.expected + next.e.expected + (rest?.ev ?? 0) - 0.5 * degreeChances(bonus, f.ac).cf * worth(board, "off-guard");
            const steps = [];
            if (sq.route.actions) steps.push({ cost: sq.route.actions, text: moveText(sq, f) });
            steps.push({ cost: 1, text: `Shoulder Check ${nameOf(f)} with your ${s.label.toLowerCase()} (${signed(bonus)}, hits about ${pct(e.hit)}): a hit makes it off-guard to your next melee Strike this turn, a critical hit to all of them until your next turn` });
            steps.push({ cost: 1, text: `Strike ${nameOf(f)} with ${next.s.label} (${signed(next.bonus)})` });
            if (rest?.used.length) steps.push({ cost: rest.used.length, text: rest.text });
            push(`Shoulder Check ${nameOf(f)}, then Strike`, f, ev, sq, steps, ["A critical failure leaves you off-guard to its melee attacks until your next turn."], 0.25);
        }
    }

    // --- Shield Wallop (8th) and Devastating Shield Wallop (12th): a shield Strike that stupefies, then topples
    if (has(actor, "shield-wallop") && me.shield && acts >= 1 && bestMelee) {
        const s = shieldStrike ?? { label: "Shield bash", bonus: bestMelee.bonus, avg: 2.5 + str, agile: false, ranged: false, reach: 5, traits: [], deadly: 0 };
        const tower = !!actor.heldShield?.system?.traits?.value?.includes?.("tower") || /tower|fortress/i.test(actor.heldShield?.name ?? "");
        const dev = has(actor, "devastating-shield-wallop");
        for (const f of foes) {
            const sq = squareToReach(board, f, 5, acts - 1);
            if (!sq) continue;
            const left = acts - 1 - sq.route.actions;
            const bonus = s.bonus + mapFor(ctx.made, s.agile);
            const e = strikeExpected(bonus, f.ac, s.avg, { deadly: s.deadly });
            const stup = tower ? 2 : 1;
            let rider = stup * worth(board, "stupefied") * (f.caster ? 1 : 0.4);
            let acAdj = 0;
            if (dev) {
                const c = degreeChances(f.saves?.fortitude ?? lv + 5, classDC + (tower ? 2 : 0));
                rider += c.s * 0.5 * worth(board, "off-guard") + c.f * worth(board, "prone") + c.cf * (worth(board, "prone") + worth(board, "stunned"));
                acAdj = -2 * e.hit * (1 - c.cs);
            }
            const rest = left >= 1 ? strikeRun(board, f, left, { made: ctx.made + 1, acAdj: f.conditions?.has?.("off-guard") ? 0 : acAdj }) : null;
            const ev = e.expected + e.hit * rider + (rest?.ev ?? 0);
            const steps = [];
            if (sq.route.actions) steps.push({ cost: sq.route.actions, text: moveText(sq, f) });
            steps.push({ cost: 1, text: `Shield Wallop ${nameOf(f)} with your ${s.label.toLowerCase()} (${signed(bonus)}): a hit leaves it stupefied ${stup} until your next turn${dev ? ` and it saves (Fortitude DC ${classDC}${tower ? ", -2 from your tower shield" : ""}) or is off-guard this turn, prone on a failure, prone and stunned 1 on a critical failure` : ""}` });
            if (rest?.used.length) steps.push({ cost: rest.used.length, text: rest.text });
            push(`Shield Wallop ${nameOf(f)}`, f, ev, sq, steps, ["Flourish: one a turn. Stupefied matters most against a caster."], 0.25);
        }
    }

    // --- Clobber (16th): a Strike with an extra die that Shoves and topples on a hit (two attacks' worth of penalty)
    if (has(actor, "clobber") && armored && acts >= 2) {
        for (const f of foes) {
            const sq = squareToReach(board, f, reach, acts - 2);
            if (!sq) continue;
            const b = bestStrike(board, f, { made: ctx.made, extra: dieAvg(bestMelee) });
            if (!b) continue;
            const left = acts - 2 - sq.route.actions;
            const rest = left >= 1 ? strikeRun(board, f, left, { made: ctx.made + 2, acAdj: f.conditions?.has?.("off-guard") ? 0 : -2 * b.e.hit }) : null;
            const ev = b.e.expected + b.e.hit * (worth(board, "prone") + punish + 1) + (rest?.ev ?? 0);
            const steps = [];
            if (sq.route.actions) steps.push({ cost: sq.route.actions, text: moveText(sq, f) });
            steps.push({ cost: 2, text: `Clobber ${nameOf(f)} with ${b.s.label} (${signed(b.bonus)}, one extra weapon die): a hit Shoves it ${has(actor, "right-where-you-want-them") ? "10" : "5"} feet${punish ? ` for ${punish} more bludgeoning` : ""} and knocks it prone` });
            if (rest?.used.length) steps.push({ cost: rest.used.length, text: rest.text.replace(/\(([^)]*)\)$/, "($1, after two attacks' penalty)") });
            push(`Clobber ${nameOf(f)}`, f, ev, sq, steps, ["Clobber counts as two attacks for your penalty; a pushed foe out of your reach ends the follow-up."], 0.3);
        }
    }

    // --- Momentum Strike (10th): a hit shoves the foe into a creature beside it for double your Strength
    if (has(actor, "momentum-strike") && acts >= 2 && str > 0) {
        for (const f of foes) {
            if ((f.sizeRank ?? 2) > (me.sizeRank ?? 2)) continue;
            const sq = squareToReach(board, f, reach, acts - 2);
            if (!sq) continue;
            const at = { ...me.rect, x: sq.x, y: sq.y };
            const others = foes.filter((g) => g !== f && inReach(f.rect, g.rect, 5) && inReach(at, g.rect, reach));
            if (!others.length) continue;
            const b = bestStrike(board, f, { made: ctx.made });
            if (!b) continue;
            const g = others[0];
            const ev = b.e.expected + b.e.hit * 2 * str;
            const steps = [];
            if (sq.route.actions) steps.push({ cost: sq.route.actions, text: moveText(sq, f) });
            steps.push({ cost: 2, text: `Momentum Strike ${nameOf(f)} with ${b.s.label} (${signed(b.bonus)}): a hit shoves it 5 feet into ${nameOf(g)} (10 on a critical hit), which takes ${2 * str} bludgeoning and is pushed clear` });
            push(`Momentum Strike ${nameOf(f)} into ${nameOf(g)}`, f, ev, sq, steps, ["Flourish: one a turn. The foe must be your size or smaller and stay within your reach as it moves."], 0.3);
        }
    }

    // --- Bloody Denial (14th): a hit makes the foe save or lose its reactions, which matters when it has one
    if (has(actor, "bloody-denial") && acts >= 2) {
        for (const f of foes) {
            if (!(f.reactions?.length)) continue;
            const sq = squareToReach(board, f, reach, acts - 2);
            if (!sq) continue;
            const b = bestStrike(board, f, { made: ctx.made });
            if (!b) continue;
            const c = degreeChances(f.saves?.fortitude ?? lv + 5, classDC);
            const ev = b.e.expected + b.e.hit * (c.s * 1.5 + c.f * 3 + c.cf * (3 + worth(board, "stunned")));
            const steps = [];
            if (sq.route.actions) steps.push({ cost: sq.route.actions, text: moveText(sq, f) });
            steps.push({ cost: 2, text: `Bloody Denial ${nameOf(f)} with ${b.s.label} (${signed(b.bonus)}): a hit makes it save (Fortitude DC ${classDC}, one degree worse on a critical hit) or lose its reactions against one ally you pick, all of them on a failure (about ${pct(c.f + c.cf)}), and be stunned 1 on a critical failure` });
            push(`Bloody Denial ${nameOf(f)}`, f, ev, sq, steps, ["Flourish: one a turn. Use it on the turn before your allies move past it."], 0.3);
        }
    }

    // --- Belly Flop (10th): a prone foe beside you is pinned under your armor
    if (has(actor, "belly-flop") && armored && acts >= 1 && !me.conditions?.has?.("prone")) {
        const s = armorStrike();
        for (const f of foes.filter((f) => f.conditions?.has?.("prone") && inReach(me.rect, f.rect, 5) && !f.conditions?.has?.("immobilized"))) {
            if (!s) break;
            const bonus = s.bonus + mapFor(ctx.made, s.agile);
            const e = strikeExpected(bonus, f.ac - (f.conditions?.has?.("off-guard") ? 0 : 2), s.avg, { deadly: s.deadly }); // prone: off-guard to you
            const ev = e.expected + e.hit * worth(board, "immobilized") - 0.5 * worth(board, "prone");
            if (ev <= 0) continue;
            push(`Belly Flop on ${nameOf(f)}`, f, ev, null, [{ cost: 1, text: `Belly Flop: drop prone and ${s.label} Strike ${nameOf(f)} (${signed(bonus)}, no prone penalty): a hit immobilizes it while you stay down there` }], ["You're prone afterwards: off-guard and -2 to your attacks until you Stand, which frees it."], 0.2);
        }
    }

    // --- Stomp Ground (6th): everyone beside you saves or falls; then a Strike at the one that fell
    if (has(actor, "stomp-ground") && acts >= 2) {
        const near = foes.filter((f) => inReach(me.rect, f.rect, 5));
        const friends = allies.filter((a) => inReach(me.rect, a.rect, 5));
        if (near.length) {
            let ev = 0, bestF = null, bestP = 0;
            const shown = [];
            for (const f of near) {
                const c = degreeChances(f.saves?.reflex ?? lv + 5, classDC);
                const v = c.s * 0.5 * worth(board, "off-guard") + c.f * worth(board, "prone") + c.cf * (worth(board, "prone") + 3.5);
                ev += v;
                shown.push(`${nameOf(f)} (falls about ${pct(c.f + c.cf)})`);
                if (c.f + c.cf > bestP) { bestP = c.f + c.cf; bestF = f; }
            }
            ev -= friends.length * 0.5 * worth(board, "prone");
            const rest = acts > 2 && bestF ? strikeRun(board, bestF, acts - 2, { made: ctx.made, acAdj: bestF.conditions?.has?.("off-guard") ? 0 : -2 * (1 - degreeChances(bestF.saves?.reflex ?? lv + 5, classDC).cs) }) : null;
            const steps = [{ cost: 2, text: `Stomp Ground: ${shown.join(", ")} save against Reflex DC ${classDC}; a success still leaves them off-guard this turn, a failure knocks them prone, a critical failure adds 1d6` }];
            if (rest?.used.length) steps.push({ cost: rest.used.length, text: rest.text });
            push(`Stomp Ground on ${near.length} foe${near.length > 1 ? "s" : ""}`, bestF, ev + (rest?.ev ?? 0), null, steps, friends.length ? [`${list(friends)} ${plural(friends)} beside you too and must save as well.`] : [], 0.3);
        }
    }

    // --- Flying Tackle (4th): a Stride and a Leap, then a Trip whose success is a critical one
    if (has(actor, "flying-tackle") && acts >= 2 && me.athletics != null && canMove(me)) {
        for (const f of foes) {
            if ((f.sizeRank ?? 2) > (me.sizeRank ?? 2) + 1) continue;
            const sq = squareToReach(board, f, 5, 1);
            if (!sq) continue;
            const c = degreeChances(me.athletics + mapFor(ctx.made, false), 10 + (f.saves?.reflex ?? lv + 5));
            const win = c.s + c.cs;
            const ev = win * (worth(board, "prone") + 3.5) - c.cf * worth(board, "prone");
            const rest = acts > 2 ? strikeRun(board, f, acts - 2, { made: ctx.made + 1, acAdj: f.conditions?.has?.("off-guard") ? 0 : -2 * win }) : null;
            const steps = [{ cost: 2, text: `Flying Tackle: Stride and Leap to ${nameOf(f)}, then Trip it (Athletics ${signed(me.athletics + mapFor(ctx.made, false))} against its Reflex DC; any success is a critical one, about ${pct(win)}: prone and 1d6)` }];
            if (rest?.used.length) steps.push({ cost: rest.used.length, text: rest.text });
            push(`Flying Tackle ${nameOf(f)}`, f, ev + (rest?.ev ?? 0), sq, steps, ["Flourish: one a turn. A critical failure on the Trip leaves you prone."], 0.25);
        }
    }

    // --- Scattering Charge (12th): a Stride, then Shoves on up to three foes in reach at one penalty
    if (has(actor, "scattering-charge") && armored && acts >= 3 && me.athletics != null && canMove(me)) {
        let best = null;
        for (const sq of reachableSquares(board, 1)) {
            const at = { ...me.rect, x: sq.x, y: sq.y };
            const near = foes.filter((f) => inReach(at, f.rect, 5) && (f.sizeRank ?? 2) <= (me.sizeRank ?? 2) + 1).slice(0, 3);
            if (near.length < 2) continue;
            let ev = 0;
            const shown = [];
            for (const f of near) {
                const c = degreeChances(me.athletics + mapFor(ctx.made, false), 10 + (f.saves?.fortitude ?? lv + 5));
                const win = c.s + c.cs;
                const guard = allies.some((a) => inReach(f.rect, a.rect, f.reach || 5)) ? 0.3 * threat.get(f.id).value : 0;
                ev += win * (1.5 + punish + guard) - c.cf * worth(board, "prone");
                shown.push(`${nameOf(f)} (about ${pct(win)})`);
            }
            ev -= sq.route.provokes.length * 2;
            if (!best || ev > best.ev) best = { sq, near, ev, shown };
        }
        if (best) push(`Scattering Charge: Shove ${best.near.length} foes`, best.near[0], best.ev, best.sq, [{ cost: 3, text: `Scattering Charge: ${best.sq.route.actions ? "Stride, then " : ""}Shove ${best.shown.join(", ")} with Athletics ${signed(me.athletics + mapFor(ctx.made, false))} against their Fortitude DCs, all at the same penalty${punish ? `; each one pushed takes ${punish} bludgeoning` : ""}${has(actor, "right-where-you-want-them") ? "; 10 feet each, 15 on a critical" : ""}` }], ["Flourish. You can't follow the shoved foes."], 0.3);
    }

    // --- Retaliating Rescue (6th): reach an ally in a foe's grip, push them clear and hit the foe
    if (has(actor, "retaliating-rescue") && acts >= 2 && canMove(me)) {
        const pairs = [];
        for (const a of allies) for (const f of foes) if (inReach(f.rect, a.rect, f.reach || 5)) pairs.push({ a, f });
        let best = null;
        if (pairs.length) for (const sq of reachableSquares(board, 1)) {
            const at = { ...me.rect, x: sq.x, y: sq.y };
            for (const { a, f } of pairs) {
                if (!inReach(at, a.rect, 5) || !inReach(at, f.rect, reach)) continue;
                const clear = (f.reach || 5) <= 5; // a 5-foot push can leave a 5-foot reach, not a 10-foot one
                const b = bestStrike(board, f, { made: ctx.made, acAdj: clear ? -2 : 0 });
                if (!b) continue;
                const ev = b.e.expected + (clear ? 0.4 * threatTo(f, a) : 0) - sq.route.provokes.length * 2;
                if (!best || ev > best.ev) best = { sq, a, f, b, clear, ev };
            }
        }
        if (best) {
            const rest = acts > 2 ? strikeRun(board, best.f, acts - 2, { made: ctx.made + 1 }) : null;
            const steps = [{ cost: 2, text: `Retaliating Rescue: Stride to ${nameOf(best.a)}, push them 5 feet${best.clear ? ` out of ${nameOf(best.f)}'s reach` : ""} and Strike ${nameOf(best.f)} with ${best.b.s.label} (${signed(best.b.bonus)}${best.clear ? ", +2 counted for the push" : ""})` }];
            if (rest?.used.length) steps.push({ cost: rest.used.length, text: rest.text });
            push(`Retaliating Rescue: ${nameOf(best.a)} from ${nameOf(best.f)}`, best.f, best.ev + (rest?.ev ?? 0), best.sq, steps, ["The ally is pushed, so it doesn't trigger reactions; they can still act on their own turn."], 0.3);
        }
    }

    // --- Armor Break (12th): at half HP, shards from your armor hit everyone within 10 feet; your armor breaks for the rest of the fight
    if (has(actor, "armor-break") && armored && acts >= 2 && me.hp <= me.maxHp / 2 && !me.conditions?.has?.("broken-armor")) {
        const near = foes.filter((f) => feetBetween(me.rect, f.rect) <= 10);
        if (near.length) {
            const dice = 11 + Math.max(0, lv - 14);
            let ev = 0;
            const shown = [];
            for (const f of near) { const s = saveExpected(f.saves?.reflex ?? lv + 5, classDC, dice * 3.5, { basic: true }); ev += s.expected; shown.push(`${nameOf(f)} (fails about ${pct(s.fail)})`); }
            ev -= 3 + halfLv / 2; // the broken armor costs AC for the rest of the fight
            push(`Armor Break on ${near.length} foe${near.length > 1 ? "s" : ""}`, near[0], ev, null, [{ cost: 2, text: `Armor Break: ${dice}d6 piercing to ${shown.join(", ")}, basic Reflex DC ${classDC}; a failure also lets you push them 5 feet (10 on a critical failure)` }], ["Your armor is broken afterwards (a lower AC until it's repaired, though no Speed penalty); only while you're at half HP or less."], 0.2);
        }
    }

    // --- The stances: enter one on a turn with an action to spare
    if (!stance && acts >= 1 && (has(actor, "hampering-stance") || has(actor, "covering-stance"))) {
        const nearFoes = foes.filter((f) => feetBetween(me.rect, f.rect) <= 10);
        const adjAllies = allies.filter((a) => inReach(me.rect, a.rect, 5));
        const options = [];
        if (has(actor, "hampering-stance")) options.push({ slug: "hampering", title: "Hampering Stance", ev: 1.5 + 0.6 * nearFoes.length + (has(actor, "not-so-fast") ? 1 : 0) + (has(actor, "lock-down") ? 0.5 : 0), text: `Hampering Stance: the squares around you are difficult terrain for enemies${has(actor, "not-so-fast") ? ", and Not So Fast! can Strike one that moves out of your reach" : ""}${has(actor, "lock-down") ? "; Lock Down works while you hold it" : ""}` });
        if (has(actor, "covering-stance") && adjAllies.length) { const a = adjAllies.slice().sort((x, y) => allyThreat(y) - allyThreat(x))[0]; options.push({ slug: "covering", title: "Covering Stance", ev: 0.5 + 0.1 * allyThreat(a) + 0.5, text: `Covering Stance: at the end of your turn ${nameOf(a)} gets lesser cover (+1 AC) while they stay beside you, and Steps free after you Intercept an Attack on them` }); }
        const o = options.sort((x, y) => y.ev - x.ev)[0];
        if (o) {
            const near = foes.filter((f) => inReach(me.rect, f.rect, reach));
            const rest = acts > 1 && near.length ? near.map((f) => strikeRun(board, f, acts - 1, { made: ctx.made })).sort((x, y) => y.ev - x.ev)[0] : null;
            const steps = [{ cost: 1, text: o.text }];
            if (rest?.used.length) steps.push({ cost: rest.used.length, text: rest.text });
            push(`Enter ${o.title}${rest?.used.length ? ", then Strike" : ""}`, near[0] ?? null, o.ev + (rest?.ev ?? 0), null, steps, ["A stance lasts until you leave it or fall unconscious; one at a time."], 0.2);
        }
    } else if (covering) {
        const adjAllies = allies.filter((a) => inReach(me.rect, a.rect, 5)).sort((x, y) => allyThreat(y) - allyThreat(x));
        out.notes.push(adjAllies.length ? `Covering Stance: at the end of your turn give the cover to ${nameOf(adjAllies[0])}${adjAllies.length > 1 ? ` (${list(adjAllies.slice(1))} also beside you)` : ""}; it lasts while they stay adjacent.` : "Covering Stance: nobody is beside you to cover at the end of this turn.");
    }
    if (hampering) {
        if (has(actor, "not-so-fast")) out.notes.push("Not So Fast! (reaction, in Hampering Stance): a melee Strike at a foe leaving a square within your reach; a hit cuts its Speed by 10 feet for that move, a critical hit stops it.");
        // Lock Down: the last Strike of the turn, since another attack with that weapon ends it
        if (has(actor, "lock-down") && acts >= 1) {
            for (const f of foes.filter((f) => inReach(me.rect, f.rect, reach))) {
                const run = acts > 1 ? strikeRun(board, f, acts - 1, { made: ctx.made }) : null;
                const b = bestStrike(board, f, { made: ctx.made + (run?.used.length ?? 0) });
                if (!b) continue;
                const hold = allies.some((a) => !inReach(f.rect, a.rect, f.reach || 5)) ? 0.6 * worth(board, "immobilized") : 0.3 * worth(board, "immobilized");
                const ev = (run?.ev ?? 0) + b.e.expected + b.e.hit * hold;
                const steps = [];
                if (run?.used.length) steps.push({ cost: run.used.length, text: run.text });
                steps.push({ cost: 1, text: `Lock Down ${nameOf(f)} with ${b.s.label} (${signed(b.bonus)}) last: a hit keeps it within ${b.s.reach || 5} feet of you until your next turn, as long as you don't move or Strike with that weapon again` });
                push(`Strike ${nameOf(f)}, Lock Down last`, f, ev, null, steps, ["Flourish: one a turn. Lock Down goes last because another Strike with the same weapon frees it."], 0.25);
            }
        }
    } else {
        if (has(actor, "not-so-fast")) out.notes.push("Not So Fast! needs Hampering Stance: enter it and a foe moving out of your reach eats a Strike that slows it.");
        if (has(actor, "lock-down")) out.notes.push("Lock Down needs Hampering Stance.");
    }

    // --- Blanket Defense (14th): three actions for a shield over everyone beside you
    if (has(actor, "blanket-defense") && me.shield && acts >= 3) {
        const adj = allies.filter((a) => inReach(me.rect, a.rect, 5));
        if (adj.length) push(`Blanket Defense over ${list(adj)}`, null, shieldWorth * (1 + 0.8 * adj.length) + 0.2 * adj.reduce((s, a) => s + allyThreat(a), 0), null, [{ cost: 3, text: `Blanket Defense: Raise your Shield; ${list(adj)} ${adj.length > 1 ? "keep" : "keeps"} its bonus while they end their turns beside you, and you can Shield Block for any of them${has(actor, "reaction-time") ? " (two reactions a round)" : ""}` }], ["Your whole turn. Best when the foes' turn is coming and the allies will stay put."], 0.2);
    }

    // --- The HP feats: once an hour or a day, when they count
    if (has(actor, "armored-courage") && armored && acts >= 1) {
        const left = usesLeft(actor, "armored-courage");
        const fr = me.conditionValues?.frightened ?? (me.conditions?.has?.("frightened") ? 1 : 0);
        if (left === 0) out.notes.push("Armored Courage is spent this hour.");
        else if (fr > 0 || me.hp <= me.maxHp * 0.6) push("Armored Courage", null, 0.4 * lv + (fr > 0 ? worth(board, "frightened") : 0), null, [{ cost: 1, text: `Armored Courage: ${lv} temporary HP for a minute${fr > 0 ? ` and frightened drops to ${fr - 1}` : ""}` }], ["Once an hour."], 0.2);
    }
    if (has(actor, "tough-cookie") && acts >= 2 && me.hp <= me.maxHp / 2) {
        const left = usesLeft(actor, "tough-cookie");
        if (left === 0) out.notes.push("Tough Cookie is spent today.");
        else push("Tough Cookie", null, Math.min(0.35 * Math.floor(me.maxHp / 2), 10 + 1.5 * maxFoeAvg * Math.max(1, foes.filter((f) => inReach(f.rect, me.rect, f.reach || 5)).length)), null, [{ cost: 2, text: `Tough Cookie: ${Math.floor(me.maxHp / 2)} temporary HP for a minute (you're at ${me.hp}/${me.maxHp})` }], ["Once a day; only at half HP or less."], 0.3);
    }
    if (has(actor, "keep-up-the-good-fight")) out.notes.push(usesLeft(actor, "keep-up-the-good-fight") === 0 ? "Keep Up the Good Fight is spent this hour." : `Keep Up the Good Fight (reaction, once an hour): a hit that would drop you leaves you at 1 HP with ${lv} temporary HP for a round, and wounded 1 more.`);
    if (has(actor, "tough-to-kill") && me.hp <= me.maxHp / 4) out.notes.push("Tough to Kill: the first time today you'd reach dying 3 or worse, you stay at dying 2.");

    // --- The shield reactions and the other reactions: when they fire
    const ranged = foes.filter((f) => f.rangedReach > 0);
    if (has(actor, "shield-from-arrows") && me.shield) out.notes.push(`Shield from Arrows (reaction, shield raised): an adjacent ally targeted by a physical ranged Strike${has(actor, "shield-from-spells") ? ", a spell attack or any ranged attack" : ""} gets +4 AC against it${ranged.length ? ` (${list(ranged)} ${plural(ranged)} shooting)` : ""}.`);
    if (has(actor, "repositioning-block") && me.shield) out.notes.push(`Repositioning Block (free, after a Shield Block): Reposition the foe you blocked, no hand needed${has(actor, "right-where-you-want-them") ? ", 10 feet on a success" : ""}.`);
    if (has(actor, "clang")) out.notes.push("Clang! (reaction): when a foe critically misses you, Strike it, or Stride to it and it's off-guard until the end of your next turn.");
    if (has(actor, "shielded-attrition") && me.shield && acts >= 1) {
        const reactive = foes.filter((f) => f.reactions?.some?.((r) => r.trigger?.onMove));
        if (reactive.length && menaced.length) out.notes.push(`Shielded Attrition (1 action): Raise your Shield and Stride half your Speed past ${list(reactive)}; ${reactive.length > 1 ? "they" : "it"} can't then react to your allies' moves this round.`);
    }
    if (has(actor, "guarded-advance") && me.shield) out.notes.push("Guarded Advance (1 action): Raise your Shield and Step twice, for 10 feet of movement that never provokes.");
    if (has(actor, "juggernaut-charge") && armored && acts >= 2) {
        const pinned = menaced.length ? foes.filter((f) => inReach(f.rect, menaced[0].rect, f.reach || 5)) : [];
        out.notes.push(`Juggernaut Charge (2 actions): Stride, Strike, Stride again, and a foe you hit is dragged along${pinned.length ? `; use it to haul ${list(pinned)} off ${nameOf(menaced[0])}` : ""}.`);
    }
    if (has(actor, "great-shield-mastery") && me.shield) out.notes.push("Great Shield Mastery: your tower shield's cover is on whenever it's raised, no Take Cover needed.");
    if (has(actor, "raise-haft")) out.notes.push("Raise Haft: a two-handed weapon has parry: 1 action for +1 circumstance to AC until your next turn (+2 if it already had parry).");
    if (punish) out.notes.push(`Punishing Shove: a Shove that works also deals ${punish} bludgeoning (${2 * punish} on a critical)${has(actor, "right-where-you-want-them") ? "; Right Where You Want Them: 10 feet on a success, 15 on a critical" : ""}.`);
    else if (has(actor, "right-where-you-want-them")) out.notes.push("Right Where You Want Them: your Shove and Reposition move a foe 10 feet on a success, 15 on a critical.");
    if (has(actor, "area-armor") && armored && foes.some((f) => f.caster)) out.notes.push(`Area Armor: allies beside you get +${lv >= 11 ? 2 : 1} to Reflex saves against area effects.`);
    if (has(actor, "phalanx-formation")) out.notes.push("Phalanx Formation: you don't give foes cover against your allies' attacks; stand in the line of fire freely.");
}

export { guardian };
