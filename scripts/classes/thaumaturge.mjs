/**
 * PF2e Tactics: classes/thaumaturge.mjs
 * See classes/_common.mjs for the shape of a class read.
 * Gate: class thaumaturge, or thaumaturge-dedication (Glimpse Vulnerability then Strike, nothing of the implements).
 * Reads: Exploit Vulnerability (the Esoteric Lore check against a standard DC for the foe's level, estimated from the
 * party's; personal antithesis 2 + half level, or a known weakness), the implements held (amulet, bell, chalice, lantern,
 * mirror, regalia, shield, tome, wand, weapon) with their initiate, adept, paragon and Intensify Vulnerability benefits,
 * Implement's Empowerment and Regalia's adept damage on the Strikes, Drink from the Chalice, Mirror's Reflection, Fling
 * Magic, Divine Disharmony, Root to Life, Twin Weakness, Cursed Effigy, Share/Ubiquitous Weakness, Unlimited Esoterica,
 * Implement's Assault, and when-notes for the rest.
 * What PF2e doesn't record: which creature you exploited, whether the chalice is drained, whether the wand's boost is spent
 * (none has an effect or flag). The read takes the helper's record when there is one (board.me.exploited, .chaliceDrained,
 * .wandBoosted), treats them as fresh in the fight's first round, and otherwise offers both turns with the assumption named.
 */
import { bestStrike, effect, has, halfLevel, level, moveText, myReach, pct, squareToReach, standardDC, strikeRun, targets, worth, degreeChances, feetBetween, inReach, strikeExpected, saveExpected, nameOf, signed, diceOf } from "./_common.mjs";

const IMPLEMENTS = ["amulet", "bell", "chalice", "lantern", "mirror", "regalia", "shield", "tome", "wand", "weapon"];
/** Weapon damage dice on a Strike (PF2e counts striking runes in system.damage.dice). */
const twoHands = (s) => Number(s.item?.system?.equipped?.handsHeld) === 2 || /two-hands/.test(String(s.item?.system?.usage?.value ?? ""));

function thaumaturge(board, ctx, out) {
    const actor = board.me.actor;
    const full = has(actor, "exploit-vulnerability");
    if (!full && !has(actor, "glimpse-vulnerability")) return;
    const lv = level(board);
    const me = board.me;
    const foes = targets(board).filter((f) => f.hp > 0);
    const reach = myReach(board);
    const round = Number(globalThis.game?.combat?.round ?? 0);
    const fresh = round <= 1 && ctx.made === 0 && ctx.actions >= 3; // the fight's first turn: nothing used yet
    /** Strikes at f with a weakness applied on each hit: a weakness is added once, after a critical hit doubles the damage. */
    const exRun = (f, n, { made = ctx.made, acAdj = 0, weak = 0 } = {}) => {
        const run = strikeRun(board, f, n, { made, acAdj });
        return { ...run, ev: run.ev + run.used.reduce((t, u) => t + u.e.hit * weak, 0) };
    };

    // --- Thaumaturge Dedication: Glimpse Vulnerability (weakness 2 to your Strikes), then Strike ---------------------
    if (!full) {
        if (ctx.actions >= 2) for (const f of foes) {
            const sq = squareToReach(board, f, reach, ctx.actions - 2);
            if (!sq) continue;
            const left = ctx.actions - 1 - sq.route.actions;
            const run = exRun(f, left, { weak: 2 });
            if (!run.used.length) continue;
            const steps = [{ cost: 1, text: `Glimpse Vulnerability on ${nameOf(f)}: weakness 2 to your Strikes until you use it again` }];
            if (sq.route.actions) steps.push({ cost: sq.route.actions, text: moveText(sq, f) });
            steps.push({ cost: run.used.length, text: `${run.text}; +2 on each hit` });
            out.plans.push({ kind: "class", title: `Glimpse ${nameOf(f)}, then Strike`, target: f, ev: run.ev, score: run.ev + 0.3, dest: sq.route.actions ? { x: sq.x, y: sq.y } : null, steps, notes: ["Once a round. If your Glimpse is already on this creature from an earlier turn, skip it and Strike: the weakness is still there."] });
        }
        out.notes.push("Glimpse Vulnerability (1 action, once a round): a creature you see takes weakness 2 to your Strikes until you Glimpse again.");
        return;
    }

    const extra = 2 + halfLevel(board);
    const effUp = effect(actor, /exploit-vulnerability|personal-antithesis|mortal-weakness/); // a module's or homebrew effect, if any
    const recId = me.exploited?.id ?? me.exploited ?? null;
    const recTarget = recId ? foes.find((f) => f.id === recId) ?? null : null;
    const upTarget = recTarget ?? (effUp ? foes.find((f) => f.id && (String(effUp.system?.context?.target?.token ?? "").includes(f.id) || String(effUp.system?.context?.target?.actor ?? "").includes(f.actorId ?? "\u0000"))) ?? null : null);
    // up: true (known), false (the first turn), null (it may be on someone from an earlier turn; the helper can't see it)
    const up = effUp || recTarget ? true : fresh ? false : null;
    const intensified = !!effect(actor, /intensify-vulnerability/);
    const lore = actor.skills?.["esoteric-lore"]?.mod ?? actor.skills?.esotericLore?.mod ?? Object.values(actor.skills ?? {}).find((s) => /esoteric/i.test(s.label ?? ""))?.mod ?? lv + 4;
    const classDc = actor.classDC?.value ?? actor.system?.attributes?.classDC?.value ?? 10 + lv + 4;
    const held = IMPLEMENTS.filter((i) => has(actor, i));
    const adept = (i) => has(actor, `adept-benefit-${i}`) || has(actor, `${i}-adept`) || (held.length === 1 && lv >= 7 && has(actor, "implement-adept")) || (held.length === 2 && lv >= 11 && has(actor, "second-adept") && has(actor, "implement-adept"));
    const paragon = (i) => has(actor, `paragon-benefit-${i}`) || has(actor, `${i}-paragon`) || (held.length === 1 && has(actor, "implement-paragon"));
    const canIntensify = has(actor, "intensify-vulnerability") || has(actor, "third-implement");
    const freeEV = has(actor, "unlimited-esoterica");
    const evCost = freeEV ? 0 : 1;
    const hurt = (c) => Math.max(0, (c.maxHp ?? 0) - (c.hp ?? 0));
    // the standard DC for the foe's level: the party's level unless the GM lets the helper use each creature's, never printed
    const chance = (f) => { const c = degreeChances(lore, standardDC(f.level ?? lv)); return { ok: c.s + c.cs, crit: c.cs }; };

    // --- On your Strikes: Implement's Empowerment (2 per weapon die, one one-handed weapon and implements in hand) and
    // Regalia's adept aura (+2 status to damage, +3 at 11th, +4 at 17th); PF2e's rule elements, which the board's averages leave out
    const regaliaDmg = held.includes("regalia") && adept("regalia") ? (lv >= 17 ? 4 : lv >= 11 ? 3 : 2) : 0;
    const empower = has(actor, "implements-empowerment");
    for (const s of board.strikes) {
        if (empower && !twoHands(s) && !s.empowerCounted) { s.empowerCounted = true; s.avg += 2 * diceOf(s); }
        if (regaliaDmg && !s.regaliaCounted) { s.regaliaCounted = true; s.avg += regaliaDmg; }
    }

    // --- Exploit Vulnerability, then Strike -------------------------------------------------------------------------
    const unsure = (f) => `If your Exploit Vulnerability is already on ${nameOf(f)} from an earlier turn, skip it and Strike: using it again starts over (and can lose a mortal weakness).`;
    if (up === true) out.notes.push(`Exploit Vulnerability is up${upTarget ? ` on ${nameOf(upTarget)}` : ""}: your Strikes against that creature deal +${extra} (personal antithesis), or its weakness if that's higher.${intensified ? " Intensify Vulnerability is up too." : ""}`);
    else if (ctx.actions < 1 + evCost) out.notes.push(`Exploit Vulnerability (${freeEV ? "free action" : "1 action"}, once a round, Esoteric Lore ${signed(lore)}): +${extra} damage on every Strike against that creature until you use it again.`);
    if (up !== true && ctx.actions >= 1 + evCost) {
        for (const f of foes) {
            const sq = squareToReach(board, f, reach, ctx.actions - 1 - evCost);
            if (!sq) continue;
            const left = ctx.actions - evCost - sq.route.actions;
            if (left < 1) continue;
            const c = chance(f);
            const steps = [{ cost: evCost, text: `Exploit Vulnerability on ${nameOf(f)} (Esoteric Lore ${signed(lore)} against a standard DC for its level, about ${pct(c.ok)} to learn its weaknesses; even a failure gives +${extra} on your Strikes against it)${held.includes("shield") && lv >= 5 ? "; your shield implement lets you Raise a Shield with it for free" : ""}` }];
            if (sq.route.actions) steps.push({ cost: sq.route.actions, text: moveText(sq, f) });
            const run = exRun(f, left, { weak: extra });
            if (!run.used.length) continue;
            steps.push({ cost: run.used.length, text: `${run.text}; +${extra} on each hit` });
            const notes = [];
            if (up === null) notes.push(unsure(f));
            if (has(actor, "esoteric-warden")) notes.push(`Esoteric Warden: on a success you also get +1 AC against its next attack and +1 to your next save against it (+2 on a critical success).`);
            if (has(actor, "breached-defenses") && (f.iwr?.resist ?? []).length) notes.push(`Breached Defenses: on a success you can pick its ${f.iwr.resist.map((r) => r.type).join("/")} resistance for your Strikes to bypass instead of the usual benefit.`);
            if (held.includes("regalia") && canIntensify) notes.push("Regalia (Intensify): a hit on the exploited creature gives an ally you see +1 to attack it until your next turn, +2 on a critical hit.");
            if (has(actor, "diverse-lore")) notes.push("Diverse Lore: a good enough Esoteric Lore result also tells you what a Recall Knowledge check would.");
            // Exploit lasts until you use it again: the turns after this one get the bonus too. Counted for one more turn
            // (two Strikes), when the foe looks likely to last that long.
            const next = (f.hp ?? 0) > run.ev ? exRun(f, 2, { made: 0, weak: extra }).ev - exRun(f, 2, { made: 0 }).ev : 0;
            if (next > 0) notes.push(`From next turn it keeps paying: about ${Math.round(next)} more a turn on your Strikes against ${nameOf(f)} (+${extra} on each hit) until you Exploit again.`);
            out.plans.push({ kind: "class", title: `Exploit ${nameOf(f)}, then Strike`, target: f, ev: run.ev, score: run.ev + next + 0.3, dest: sq.route.actions ? { x: sq.x, y: sq.y } : null, steps, notes });
        }
    }
    // --- Exploit is up (or may be, from an earlier turn): Intensify Vulnerability, Twin Weakness, the Strikes with it ---
    if (up !== false && ctx.actions >= 1) {
        // Known: its target, or every foe when the effect doesn't say. Unknown: the foes in reach now, labelled as the assumption.
        const tgts = up === true ? (upTarget ? [upTarget] : foes) : foes.filter((f) => inReach(me.rect, f.rect, reach)).slice(0, 2);
        for (const f of tgts) {
            const sq = squareToReach(board, f, reach, ctx.actions - 1);
            if (!sq) continue;
            let left = ctx.actions - sq.route.actions;
            const steps = [];
            if (sq.route.actions) steps.push({ cost: sq.route.actions, text: moveText(sq, f) });
            let acAdj = 0, ev = 0;
            const note = up === null ? [`This assumes your Exploit Vulnerability from an earlier turn is still on ${nameOf(f)}; PF2e doesn't record it, so the helper can't tell.`] : [];
            if (canIntensify && !intensified && left >= 1 + (freeEV ? 0 : 1) && held.length) {
                const parts = [];
                if (held.includes("weapon")) { parts.push("weapon: +2 status to your attack rolls against it (the plan takes this one)"); acAdj = -2; }
                if (held.includes("tome")) parts.push("tome: roll a d20 now and use it for one Strike against it before your next turn");
                if (held.includes("mirror")) parts.push("mirror: you're concealed from it");
                if (held.includes("amulet")) parts.push("amulet: +2 status to your AC and saves against it");
                if (held.includes("bell")) parts.push("bell: a hit on it gives it -2 status to saves against your Ring Bell for a round (-3 on a critical hit)");
                if (held.includes("chalice")) parts.push(`chalice: within 30 feet of it, a sip gives ${lv} more temporary HP and a drain ${2 * lv} more HP`);
                if (held.includes("lantern")) parts.push("lantern: the light's aura doubles; against it the lantern's bonuses are +2, and in the aura it takes -2 to Deception and Stealth and can't be concealed");
                if (held.includes("regalia")) parts.push("regalia: each hit on it gives an ally you see +1 circumstance to attack it until your next turn (+2 on a critical hit)");
                if (held.includes("wand")) parts.push(`wand: Fling Magic against it gains +${lv} status damage`);
                if (held.includes("shield")) parts.push("shield: a hit on it restores half your level in shield HP (at full HP, your Charisma to its Hardness until your next turn)");
                steps.push({ cost: freeEV ? 0 : 1, text: `Intensify Vulnerability on ${nameOf(f)} (${freeEV ? "free action" : "1 action"}, once a round; one implement you hold: ${parts.join("; ")})` });
                left -= freeEV ? 0 : 1;
                ev += 0.5;
            }
            if (has(actor, "twin-weakness") && left >= 2) {
                const b = bestStrike(board, f, { made: ctx.made, acAdj });
                if (b) {
                    const bonus = (1 - degreeChances(b.bonus, f.ac + acAdj).cf) * extra;
                    steps.push({ cost: 2, text: `Twin Weakness: Strike ${nameOf(f)} with ${b.s.label} (${signed(b.bonus)}); unless it's a critical failure, your implement also deals the +${extra} on its own` });
                    ev += b.e.expected + b.e.hit * extra + bonus; left -= 2;
                    const rest = exRun(f, left, { made: ctx.made + 2, acAdj, weak: extra });
                    if (rest.used.length) { steps.push({ cost: rest.used.length, text: `${rest.text}; +${extra} on each hit` }); ev += rest.ev; }
                }
            } else {
                const run = exRun(f, left, { acAdj, weak: extra });
                if (!run.used.length) continue;
                steps.push({ cost: run.used.length, text: `${run.text}; +${extra} on each hit` });
                ev += run.ev;
            }
            if (has(actor, "cursed-effigy") && left >= 1) note.push(`Cursed Effigy (1 action, right after a Strike that hits with physical damage): ${nameOf(f)} takes -2 to saves against your class DC while it's exploited.`);
            const kind = steps.some((s) => /Intensify/.test(s.text)) ? "Intensify" : steps.some((s) => /Twin/.test(s.text)) ? "Twin Weakness" : "Strike";
            out.plans.push({ kind: "class", title: `${up === null ? "If Exploit is still on it: " : ""}${kind} ${kind === "Strike" ? "" : "on "}${nameOf(f)}`.replace(/\s+/g, " "), target: f, ev, score: ev + (up === null ? 0.1 : 0.3), dest: sq.route.actions ? { x: sq.x, y: sq.y } : null, steps, notes: note });
        }
    }

    // --- Chalice: a sip for temporary HP, a drain for a real heal, on you or an adjacent ally -------------------------
    if (held.includes("chalice") && ctx.actions >= 1) {
        const near = intensified && upTarget && feetBetween(me.rect, upTarget.rect) <= 30;
        const sip = Math.max(3, lv) + (near ? lv : 0);
        const drainHp = 3 * lv + (near ? 2 * lv : 0);
        // drained: the helper's record, a module's effect, or unknown after the first turn (it refills after 10 minutes undrunk)
        const drained = typeof me.chaliceDrained === "boolean" ? me.chaliceDrained : effect(actor, /chalice-drained|drained-chalice/) ? true : fresh ? false : null;
        const cands = [me, ...(board.allies ?? []).filter((a) => a.hp > 0 && inReach(me.rect, a.rect, 5))];
        for (const c of cands) {
            const missing = hurt(c);
            const useDrain = drained !== true && missing >= Math.max(6, drainHp * 0.6);
            const heal = useDrain ? Math.min(missing, drainHp) : sip;
            const ev = useDrain ? 0.8 * heal : 0.4 * sip;
            if (!useDrain && missing < 1 && c !== me) continue;
            const who = c === me ? "you" : nameOf(c);
            const steps = [{ cost: 1, text: `Drink from the Chalice, ${useDrain ? "drain" : "sip"}, for ${who}: ${useDrain ? `heals ${drainHp} HP (${who === "you" ? "you're" : `${who} is`} down ${missing}); it can't be drained again until 10 minutes pass with nobody drinking` : `${sip} temporary HP until the end of your next turn`}` }];
            const f = foes.filter((x) => inReach(me.rect, x.rect, reach))[0];
            let total = ev;
            if (f && ctx.actions >= 2) { const run = exRun(f, ctx.actions - 1, { weak: up === true && (!upTarget || upTarget === f) ? extra : 0 }); if (run.used.length) { steps.push({ cost: run.used.length, text: run.text }); total += run.ev; } }
            const notes = [];
            if (useDrain && drained === null) notes.push("This assumes the chalice is full: PF2e doesn't record a drain, so the helper can't tell whether it's been drained in the last 10 minutes.");
            if (adept("chalice")) notes.push(`Chalice (adept): for someone who took a critical piercing or slashing hit or bleed damage since your last turn, a sip gives ${2 * lv} temporary HP and a drain heals ${5 * lv}.`);
            if (useDrain && paragon("chalice")) notes.push("Chalice (paragon): the drain also lowers clumsy, enfeebled, frightened, stupefied, stunned and drained by 1 and tries to counteract poisons, diseases and curses.");
            if (ev >= 2) out.plans.push({ kind: "class", title: `${useDrain ? "Drain" : "Sip from"} the chalice for ${who}`, target: f ?? null, ev: total, score: total + 0.2, dest: null, steps, notes });
        }
        out.notes.push(`Drink from the Chalice (1 action, once a round, you or an adjacent ally): a sip gives ${sip} temporary HP, a drain heals ${drainHp} HP; once drained, the chalice refills only after 10 minutes with nobody drinking.`);
    }

    // --- Mirror: a second self within 15 feet, to reach a foe without moving or to flank it with yourself -----------
    if (held.includes("mirror") && ctx.actions >= 2) {
        const free = (x, y) => !board.occupant?.get?.(`${x},${y}`) && (!board.field?.land || board.field.land.has(`${x},${y}`));
        for (const f of foes) {
            const near = inReach(me.rect, f.rect, reach);
            const flanked = f.conditions?.has?.("off-guard");
            let sq = null, why = "";
            if (near && !flanked) {
                // the square straight across the foe from you
                const cx = f.rect.x + (f.rect.x - me.rect.x) + (f.rect.w - 1) * Math.sign(f.rect.x - me.rect.x), cy = f.rect.y + (f.rect.y - me.rect.y) + (f.rect.h - 1) * Math.sign(f.rect.y - me.rect.y);
                if (free(cx, cy) && feetBetween(me.rect, { x: cx, y: cy, w: 1, h: 1 }) <= 15) { sq = { x: cx, y: cy }; why = "flank"; }
            } else if (!near && ctx.actions >= 2) {
                const cands = [];
                for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) { const x = me.rect.x + dx, y = me.rect.y + dy; if ((dx || dy) && free(x, y) && feetBetween(me.rect, { x, y, w: 1, h: 1 }) <= 15 && inReach({ ...me.rect, x, y }, f.rect, reach)) cands.push({ x, y }); }
                if (cands.length) { sq = cands[0]; why = "reach"; }
            }
            if (!sq) continue;
            const acAdj = why === "flank" ? -2 : 0;
            const run = exRun(f, ctx.actions - 1, { acAdj, weak: up === true && (!upTarget || upTarget === f) ? extra : 0 });
            if (!run.used.length) continue;
            const ev = run.ev + (why === "flank" ? 0.5 : 0.3);
            out.plans.push({ kind: "class", title: `Mirror's Reflection: ${why === "flank" ? `flank ${nameOf(f)} with yourself` : `reach ${nameOf(f)} without moving`}`, target: f, ev, score: ev + 0.3, dest: null, steps: [{ cost: 1, text: `Mirror's Reflection: put your reflection in the square ${why === "flank" ? `across ${nameOf(f)} from you (${nameOf(f)} is then flanked, off-guard to you)` : `next to ${nameOf(f)}`}; you're in both places until your next turn` }, { cost: run.used.length, text: `${run.text}${why === "flank" ? " (off-guard)" : ", from the reflection"}` }], notes: ["Anything that targets your reflection hits you; when one of you is affected, the effect hits you once."] });
        }
        if (adept("mirror")) out.notes.push(`Mirror (adept): when an enemy next to one of your selves damages you, you can shatter that self (free action): ${2 + halfLevel(board)} slashing, or the attack's damage if lower, to everything within 5 feet of it, and the other self is the real you.`);
        if (paragon("mirror")) out.notes.push("Mirror (paragon): making the reflection also lets one of your selves Interact, Seek or Strike at once.");
    }

    // --- Wand: Fling Magic, 2 actions, a basic Reflex save against your class DC ----------------------------------------
    const flingDice = Math.ceil(lv / 2) + 2;
    const flingRange = paragon("wand") ? 180 : adept("wand") ? 120 : 60;
    if (held.includes("wand") && ctx.actions >= 2) {
        // the boost: the helper's record, charged on the fight's first turn, unknown after (it recharges at the end of your next turn)
        const boosted = typeof me.wandBoosted === "boolean" ? !me.wandBoosted : effect(actor, /wand-discharged|fling-magic-boost|wand-boost/) ? false : fresh ? true : null;
        const avg = flingDice * (boosted === true ? 3.5 : 2.5);
        for (const f of foes.filter((x) => feetBetween(me.rect, x.rect) <= flingRange)) {
            const bonus = intensified && upTarget === f ? lv : 0;
            const sv = saveExpected(f.saves?.reflex ?? lv + 5, classDc, avg + bonus, { basic: true });
            let ev = sv.expected;
            const steps = [];
            if (up === true && upTarget === f && canIntensify && !intensified && ctx.actions >= 3) { steps.push({ cost: freeEV ? 0 : 1, text: `Intensify Vulnerability (wand): Fling Magic against ${nameOf(f)} gains +${lv} status damage` }); ev = saveExpected(f.saves?.reflex ?? lv + 5, classDc, avg + lv, { basic: true }).expected; }
            const gain = saveExpected(f.saves?.reflex ?? lv + 5, classDc, flingDice * 1, { basic: true }).expected;
            const boostText = boosted === true ? "; the boost recharges at the end of your next turn" : boosted === null ? `; boosted to d6s if the wand is charged (about ${Math.round(gain)} more; it recharges at the end of your next turn after a boost)` : "; the boost is spent";
            steps.push({ cost: 2, text: `Fling Magic at ${nameOf(f)} (${flingRange} feet): ${flingDice}d${boosted === true ? 6 : 4}${bonus || steps.length ? ` +${lv}` : ""} ${boosted === true ? "boosted, " : ""}basic Reflex against DC ${classDc} (fails about ${pct(sv.fail)})${boostText}` });
            if (up !== true && ctx.actions >= 2 + evCost) { steps.push({ cost: evCost, text: `Exploit Vulnerability on ${nameOf(f)} for the next turns (Esoteric Lore ${signed(lore)})` }); ev += 0.5; }
            const notes = [];
            if (adept("wand")) notes.push("Wand (adept): if it fails the save and takes damage, cold slows it 10 feet for a round, electricity leaves it off-guard until the end of your next turn, fire adds 1d10 persistent fire (2d10 on a critical failure).");
            if (paragon("wand")) notes.push("Wand (paragon): any of the three damage types, and Fling Magic can hit every creature in a 20-foot burst instead of one.");
            out.plans.push({ kind: "class", title: `Fling Magic at ${nameOf(f)}`, target: f, ev, score: ev + 0.2, dest: null, steps, notes });
        }
    }

    // --- Divine Disharmony: off-guard to you from 60 feet with Deception or Intimidation ------------------------------
    if (has(actor, "divine-disharmony") && ctx.actions >= 2) {
        const dec = actor.skills?.deception?.mod ?? lv + 3, intim = actor.skills?.intimidation?.mod ?? lv + 3;
        const mod = Math.max(dec, intim), skill = dec >= intim ? "Deception" : "Intimidation";
        for (const f of foes.filter((x) => feetBetween(me.rect, x.rect) <= 60 && !x.conditions?.has?.("off-guard"))) {
            const sq = squareToReach(board, f, reach, ctx.actions - 2);
            if (!sq) continue;
            const left = ctx.actions - 1 - sq.route.actions;
            if (left < 1) continue;
            const c = degreeChances(mod, 10 + (f.saves?.will ?? lv + 5));
            const p = c.s + c.cs;
            const weak = up === true && (!upTarget || upTarget === f) ? extra : 0;
            const hit = exRun(f, left, { weak, acAdj: -2 });
            const miss = exRun(f, left, { weak });
            if (!hit.used.length) continue;
            const ev = p * hit.ev + (1 - p) * miss.ev;
            const steps = [{ cost: 1, text: `Divine Disharmony on ${nameOf(f)} (${skill} ${signed(mod)} against its Will DC, about ${pct(p)}; +2 if it's devout): off-guard to you this turn, until your next turn on a critical success` }];
            if (sq.route.actions) steps.push({ cost: sq.route.actions, text: moveText(sq, f) });
            steps.push({ cost: hit.used.length, text: `${hit.text} (off-guard if the display worked)` });
            out.plans.push({ kind: "class", title: `Divine Disharmony on ${nameOf(f)}`, target: f, ev, score: ev + 0.2, dest: sq.route.actions ? { x: sq.x, y: sq.y } : null, steps, notes: [] });
        }
    }

    // --- Root to Life: a dying ally next to you -------------------------------------------------------------------
    if (has(actor, "root-to-life") && ctx.actions >= 1) {
        for (const d of (board.downAllies ?? []).filter((d) => (d.hp <= 0 || d.conditions?.has?.("dying")) && inReach(me.rect, d.rect, 5))) {
            const ev = 6 + lv;
            out.plans.push({ kind: "class", title: `Root to Life: stabilize ${nameOf(d)}`, target: null, ev, score: ev + 0.3, dest: null, steps: [{ cost: ctx.actions >= 2 ? 2 : 1, text: `Root to Life on ${nameOf(d)}: no longer dying, at 0 HP${ctx.actions >= 2 ? "; with 2 actions, DC 10 flat checks end each persistent damage on them" : ""}` }], notes: [] });
        }
    }

    // --- Implements held: what each does this turn ----------------------------------------------------------------
    const impl = [];
    if (held.includes("amulet")) impl.push(`Amulet's Abeyance fires when the exploited creature would damage you or an ally within 15 feet: resistance ${2 + lv} to all of that damage${adept("amulet") ? `; adept: the one protected keeps resistance ${lv >= 15 ? 10 : 5} to one of its damage types until your next turn` : ""}${paragon("amulet") ? "; paragon: it protects you and every ally within 15 feet at once, the lingering resistance included" : ""}`);
    if (held.includes("bell")) impl.push(`Ring Bell fires when the exploited creature within 30 feet Strikes or Casts a Spell at you or an ally: it saves against DC ${classDc} or, for a spell, is stupefied ${paragon("bell") ? 2 : 1} (${paragon("bell") ? 3 : 2} on a critical failure), for a Strike enfeebled or clumsy ${paragon("bell") ? 2 : 1} (${paragon("bell") ? 3 : 2}), ${adept("bell") ? "for 3 rounds (adept)" : "until the end of your next turn"}${paragon("bell") ? "; paragon: it can fire off any enemy's Strike or spell, lasting only until your next turn then" : ""}`);
    if (held.includes("lantern")) impl.push(`Lantern: a ${paragon("lantern") ? 40 : adept("lantern") ? 30 : 20}-foot aura of bright light; you and allies get +1 status to visual Perception to notice what's in it and to Recall Knowledge about creatures in it${adept("lantern") ? "; adept: invisible and ethereal creatures in it show as distortions (still concealed)" : ""}${paragon("lantern") ? "; paragon: a counteract check lets you see through illusions, morphs and polymorphs in it" : ""}`);
    if (held.includes("regalia")) impl.push(`Regalia: +${adept("regalia") ? "2 (with master proficiency)" : "1"} circumstance to Deception, Diplomacy and Intimidation, and you and allies within 15 feet who see you get +1 status to saves against ${adept("regalia") ? "mental effects" : "fear"}${regaliaDmg ? `; adept: you and allies in the aura get +${regaliaDmg} status to damage rolls (your plans count it)` : ""}${paragon("regalia") ? "; paragon: allies in the aura aren't off-guard from flanking unless you are, and their clumsy, enfeebled, frightened, sickened and stupefied penalties are 1 lower" : ""}`);
    if (held.includes("shield")) impl.push(`Shield: Shield Block, and the shield stops at 1 HP instead of breaking${lv >= 5 ? "; Exploit Vulnerability also Raises it for free" : ""}${adept("shield") ? "; adept: raised, its AC bonus also counts on your saves against magic, and Shield Block works against magical damage" : ""}${paragon("shield") ? "; paragon: raised, its bonuses cover allies within 15 feet, and you can Shield Block for them" : ""}`);
    if (held.includes("tome")) impl.push(`Tome: +${paragon("tome") ? 2 : 1} circumstance to Recall Knowledge${adept("tome") ? `, and at the start of each turn a free Recall Knowledge (Esoteric Lore ${signed(lore)}) about a creature you see: on a success +1 to your next attack against it${paragon("tome") ? ", to every attack until your next turn" : ""}` : ""}`);
    if (held.includes("weapon")) impl.push(`Implement's Interruption fires when the exploited creature uses a concentrate, manipulate or move action in your reach (10 feet with a ranged weapon): a Strike outside your multiple attack penalty, and ${paragon("weapon") ? "any hit (paragon)" : "a critical hit"} disrupts the action${adept("weapon") ? "; adept: a miss short of a critical miss still deals 1 damage, plus its weakness" : ""}`);
    if (held.includes("wand")) impl.push(`Wand: Fling Magic (2 actions, ${flingRange} feet, ${flingDice}d4 or d6 boosted, basic Reflex DC ${classDc})`);
    if (held.includes("mirror") && ctx.actions < 2) impl.push("Mirror's Reflection (1 action): a second self within 15 feet, to Strike or flank from until your next turn");
    if (impl.length) out.notes.push(`Implements: ${impl.join(". ")}.`);
    if (has(actor, "second-implement") && held.length >= 2) out.notes.push("Second Implement: swap the implement in your hand for a worn one as a free Interact right before using its action.");
    if (has(actor, "esoteric-reflexes")) out.notes.push("Esoteric Reflexes: a second reaction each turn, for your implements' reactions only.");
    if (empower) out.notes.push(`Implement's Empowerment: +2 per weapon damage die${board.strikes.some((s) => s.empowerCounted) ? ` (the plans count it on ${board.strikes.filter((s) => s.empowerCounted).map((s) => s.label).join(", ")})` : ""}, only with your hands clear: one one-handed weapon, implements and esoterica, nothing else. Keep its toggle on when you roll.`);
    if (has(actor, "scroll-thaumaturgy")) out.notes.push(`Scroll Thaumaturgy: you can activate any scroll, at your class DC ${classDc}, from the hand holding an implement.`);
    if (has(actor, "scroll-esoterica")) out.notes.push(`Scroll Esoterica: your daily temporary scrolls (rank 1${lv >= 8 ? ", 2" : ""}${has(actor, "elaborate-scroll-esoterica") ? `, 3${lv >= 14 ? ", 4" : ""}${lv >= 16 ? ", 5" : ""}` : ""}${has(actor, "grand-scroll-esoterica") ? `, ${lv >= 20 ? 7 : 6}` : ""}) are spells the advisor can plan once they're on your sheet.`);
    if (has(actor, "share-weakness") && up !== false) out.notes.push("Share Weakness (1 action, mortal weakness up): an adjacent ally's Strikes apply the weakness too, until your Exploit ends.");
    if (has(actor, "ubiquitous-weakness")) out.notes.push("Ubiquitous Weakness: when you Exploit with mortal weakness, every ally within 30 feet applies the weakness on their Strikes.");
    if (has(actor, "sympathetic-vulnerabilities") && up !== false) out.notes.push("Sympathetic Vulnerabilities: a mortal weakness applies to every creature with that weakness; a personal antithesis on a non-humanoid applies to all of its exact kind.");
    if (has(actor, "instructive-strike")) out.notes.push("Instructive Strike (1 action): a Strike that hits also lets you Recall Knowledge about the target (+2 on a critical hit).");
    if (has(actor, "sever-magic") && ctx.actions >= 2) out.notes.push(`Sever Magic (2 actions): a Strike that damages also counteracts one spell on the target, at half your level with a modifier of ${classDc - 10}.`);
    if (has(actor, "implements-assault") && ctx.actions >= 3 && foes.filter((f) => feetBetween(me.rect, f.rect) <= 30).length >= 2) {
        const near = foes.filter((f) => feetBetween(me.rect, f.rect) <= 30);
        let ev = 0;
        for (const f of near) { const b = bestStrike(board, f, { made: ctx.made, melee: !board.strikes.every((s) => s.ranged) }) ?? bestStrike(board, f, { made: ctx.made, melee: false }); if (b) ev += b.e.expected + (up === true && (!upTarget || upTarget === f) ? b.e.hit * extra : 0); }
        if (ev > 0) out.plans.push({ kind: "class", title: `Implement's Assault on ${near.length} foes`, target: near[0], ev, score: ev + 0.3, dest: null, steps: [{ cost: 3, text: `Implement's Assault: one Strike at full bonus against each of ${near.map(nameOf).join(", ")}; a melee weapon flies out and returns` }], notes: [] });
    }
    if (has(actor, "trespass-teleportation") && up !== false) out.notes.push("Trespass Teleportation fires when the exploited creature within 120 feet teleports: you go with it.");
    if (has(actor, "implements-flight")) out.notes.push("Implement's Flight: you fly at your land Speed while holding an implement.");
    if (has(actor, "wonder-worker")) out.notes.push("Wonder Worker (once a day): cast any common spell of 8th rank or lower from a tradition whose skill you're legendary in, at your class DC.");
    if (has(actor, "unlimited-esoterica")) out.notes.push("Unlimited Esoterica: Exploit Vulnerability and Intensify Vulnerability are free actions, once a round each.");
    if (has(actor, "turn-away-misfortune")) out.notes.push("Turn Away Misfortune fires when a misfortune effect would touch your roll: it cancels out.");
    if (has(actor, "one-more-activation")) out.notes.push("One More Activation (once a day): an invested item's daily activation once more, if its level is half yours or lower.");
}

export { thaumaturge };
