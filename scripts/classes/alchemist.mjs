/**
 * PF2e Tactics: classes/alchemist.mjs
 * See classes/_common.mjs for the shape of a class read.
 * Gate: class alchemist, or alchemist-dedication (Quick Alchemy's benefits, 4 vials).
 * Reads: the research field (bomber, chirurgeon, mutagenist, toxicologist) and its field vials, Quick Alchemy as a plan
 * when no bomb is in hand: a quick vial (the Remaster's free bomb, every turn, no vial spent) or a formula bomb that spends
 * a versatile vial, offered only when it's worth the vial (make one and throw it: 2 actions, 1 with Quick Bomber), the bomb additives (Debilitating,
 * Sticky, Sour, Unstable: the best one on the bomb made), Calculated/Expanded Splash and Directional Bombs, Far Lobber
 * and Uncanny Bombs, Perpetual Infusions/Potency/Perfection (free bombs or elixirs when the vials run out), Double
 * Brew and Alchemical Alacrity, Chirurgeon heals (field vial, elixir of life, Healing Bomb), mutagens as effects,
 * poisons on weapons, Mega Bomb, and when-notes for the rest.
 */
import { bestStrike, canMove, castable, effect, focusLeft, has, half, level, markOffGuard, moveText, myReach, allySpeed, pct, squareToReach, strikeRun, targets, worth, degreeChances, feetBetween, inReach, mapFor, strikeExpected, saveExpected, CONDITION_VALUE, nameOf, reachableSquares, signed } from "./_common.mjs";
import { provokeCost } from "../advisor.mjs";

/** Bomb tiers by the item level an alchemist can make: alchemist's fire as the reference (dice d8, persistent, splash, item bonus). */
const BOMB_TIERS = [[17, "major", 4, 4], [11, "greater", 3, 3], [3, "moderate", 2, 2], [1, "lesser", 1, 1]];
const bombTier = (lvl) => BOMB_TIERS.find(([l]) => lvl >= l) ?? BOMB_TIERS[3];
/**
 * A versatile vial as a bomb, by the vial's type (its SpecialResource steps at 1st, 4th, 12th and 18th): d6 acid dice, splash,
 * and the item bonus to the attack roll, as for a lesser, moderate, greater and major bomb.
 */
const vialTier = (lv) => (lv >= 18 ? { dice: 4, splash: 4, item: 3 } : lv >= 12 ? { dice: 3, splash: 3, item: 2 } : lv >= 4 ? { dice: 2, splash: 2, item: 1 } : { dice: 1, splash: 1, item: 0 });
const vialDice = (lv) => vialTier(lv).dice;
/** Elixir of life by the item level available: [level, name, d6 dice (minor: 1d8), flat]. */
const ELIXIRS = [[19, "true", 10, 27], [15, "major", 8, 21], [13, "greater", 7, 18], [9, "moderate", 5, 12], [5, "lesser", 3, 6], [1, "minor", 1, 0]]; // minor: 1d6
const elixirFor = (lvl) => ELIXIRS.find(([l]) => lvl <= 0 ? false : lvl >= l) ?? ELIXIRS[5];

function alchemist(board, ctx, out) {
    const actor = board.me.actor;
    if (!has(actor, "quick-alchemy") && !has(actor, "alchemist-dedication")) return;
    const lv = level(board);
    const me = board.me;
    const int = actor.system?.abilities?.int?.mod ?? 3;
    const dex = actor.system?.abilities?.dex?.mod ?? 2;
    const classDc = actor.classDC?.value ?? actor.system?.attributes?.classDC?.value ?? 10 + lv + 4;
    const res = actor.system?.resources ?? {};
    const vialRes = res.versatileVials ?? res["versatile-vials"] ?? Object.entries(res).find(([k]) => /versatile|vial/i.test(k))?.[1] ?? null;
    const vials = vialRes ? Number(vialRes.value) || 0 : null;
    const field = ["bomber", "chirurgeon", "mutagenist", "toxicologist"].find((f) => has(actor, f)) ?? null;
    const foes = targets(board).filter((f) => f.hp > 0);
    const bombs = board.strikes.filter((s) => s.ranged && s.traits?.includes("bomb"));
    const quickBomber = has(actor, "quick-bomber");
    const range = has(actor, "uncanny-bombs") ? 60 : has(actor, "far-lobber") ? 30 : 20;
    const perpetualLevel = has(actor, "perpetual-perfection") ? 11 : has(actor, "perpetual-potency") ? 3 : has(actor, "perpetual-infusions") ? 1 : 0;
    const brews = has(actor, "alchemical-alacrity") ? 3 : has(actor, "double-brew") ? 2 : 1;
    const hurt = (c) => Math.max(0, (c.maxHp ?? 0) - (c.hp ?? 0));
    const prof = lv >= 15 ? 6 : lv >= 7 ? 4 : 2;
    const splashRadius = has(actor, "expanded-splash") ? (has(actor, "greater-field-discovery-bomber") || (field === "bomber" && lv >= 13) ? 15 : 10) : (has(actor, "greater-field-discovery-bomber") || (field === "bomber" && lv >= 13) ? 10 : 5);
    const bigSplash = has(actor, "calculated-splash") || has(actor, "field-discovery-bomber") || (field === "bomber" && lv >= 5);
    const splashOf = (base) => (bigSplash ? Math.max(1, int) : base) + (has(actor, "expanded-splash") ? int : 0);
    // Manipulate: Quick Alchemy provokes from a foe with a reactive strike in reach
    const provokers = foes.filter((f) => f.reactions?.some?.((r) => r.trigger?.onManipulate) && inReach(f.rect, me.rect, f.reach ?? 5)).map((f) => f.id);
    const provoke = provokers.length ? provokeCost(board, provokers) : 0;

    // --- The bomb Quick Alchemy would make: the best formula bomb (alchemist's fire as the reference) at the level available
    const perpetualKind = field === "bomber" ? "bomb" : field === "chirurgeon" ? "elixir" : field === "mutagenist" ? "mutagen" : field === "toxicologist" ? "poison" : null;
    const freeBombs = perpetualLevel > 0 && perpetualKind === "bomb";
    const canMake = (vials ?? 1) > 0 || perpetualLevel > 0;
    const canBomb = (vials ?? 1) > 0 || freeBombs;
    const makeLevel = (vials ?? 1) > 0 ? lv : perpetualLevel;
    const tier = bombTier(makeLevel);
    const bombAvg = tier[2] * 4.5 + 1.5 * tier[3];
    const splash = splashOf(tier[3]);
    // a formula bomb's item bonus: lesser +0, moderate +1, greater +2, major +3
    const bombBonus = bombs[0]?.bonus ?? lv + prof + dex + tier[3] - 1;
    // the quick vial (Quick Alchemy's second mode): a bomb that costs no vial, potent until the end of this turn
    const vt = vialTier(lv);
    const vialSplash = splashOf(vt.splash);
    const vialAvg = vt.dice * 3.5;
    const vialBonus = lv + prof + dex + vt.item;
    const free = (vials ?? 1) <= 0 && freeBombs;
    const freeField = (vials ?? 1) <= 0 && perpetualLevel > 0;
    /** The best additive for a thrown bomb against f, by what it adds in damage terms (one additive per item). */
    const additive = (f, hit) => {
        const opts = [];
        if (has(actor, "debilitating-bomb")) {
            const cond = has(actor, "true-debilitating-bomb") ? ["enfeebled 2", 2 * worth(board, "enfeebled")] : has(actor, "greater-debilitating-bomb") ? ["enfeebled 1", worth(board, "enfeebled")] : ["off-guard", worth(board, "off-guard")];
            const c = degreeChances(f.saves?.fortitude ?? lv + 5, classDc);
            const fail = has(actor, "perfect-debilitation") ? 1 - c.cs : c.f + c.cf;
            opts.push({ name: `Debilitating Bomb (${cond[0]} until your next turn unless it saves${has(actor, "perfect-debilitation") ? ", only a critical success avoids it" : ""})`, ev: hit * fail * cond[1] });
        }
        if (has(actor, "sticky-bomb")) opts.push({ name: `Sticky Bomb (+${tier[3]} persistent)`, ev: hit * 1.5 * tier[3] });
        if (has(actor, "sour-bomb")) { const c = degreeChances(f.saves?.fortitude ?? lv + 5, classDc); opts.push({ name: "Sour Bomb (sickened 1 on a failed save)", ev: hit * (c.f + c.cf) * worth(board, "sickened") }); }
        if (has(actor, "unstable-concoction")) opts.push({ name: `Unstable Concoction (d10s instead of d8s; you take a flat check or ${tier[0]} acid)`, ev: hit * tier[2] - 1 });
        if (has(actor, "exploitive-bomb") && (f.iwr?.resist ?? []).some((r) => r.type === "fire")) opts.push({ name: `Exploitive Bomb (ignores ${lv} of its fire resistance)`, ev: hit * Math.min(lv, f.iwr.resist.find((r) => r.type === "fire").value) });
        opts.sort((a, b) => b.ev - a.ev);
        return opts[0] ?? null;
    };
    /** A bomb thrown at f from here: hit chance with the range penalty, damage with splash on the target and the foes around it. */
    const throwAt = (f, made, { bonus = bombBonus, avg = bombAvg, spl = splash } = {}) => {
        const dist = feetBetween(me.rect, f.rect);
        if (dist > range * 3) return null;
        const pen = -2 * Math.max(0, Math.ceil(dist / range) - 1);
        const b = bonus + pen + mapFor(made, false);
        const c = degreeChances(b, f.ac);
        const hit = c.s + c.cs;
        const others = foes.filter((o) => o !== f && feetBetween(f.rect, o.rect) <= splashRadius);
        const ev = hit * avg + c.cs * avg + (hit + c.f) * spl + hit * spl * others.length;
        return { bonus: b, hit, ev, others, dist, pen };
    };

    // --- Quick Alchemy then throw: when no bomb is in hand (the advisor throws the ones that are) ------------------
    // Every throw is a quick vial, which costs no vial, unless a formula bomb is worth the versatile vial it spends (or a
    // perpetual infusion makes it free); Double Brew makes two at once, the second thrown for 1 action.
    const vialThrow = (f, made) => throwAt(f, made, { bonus: vialBonus, avg: vialAvg, spl: vialSplash });
    const vialName = `${vt.dice}d6 ${field === "bomber" ? "acid, cold, electricity or fire" : "acid"}, splash ${vialSplash}`;
    const per = quickBomber ? 1 : 2;
    if (!bombs.length && ctx.actions >= per) {
        for (const f of foes) {
            const tv = vialThrow(f, ctx.made);
            if (!tv) continue;
            const tb = canBomb ? throwAt(f, ctx.made) : null;
            const addV = additive(f, tv.hit), addB = tb ? additive(f, tb.hit) : null;
            const evV = tv.ev + (addV?.ev ?? 0), evB = tb ? tb.ev + (addB?.ev ?? 0) : -Infinity;
            const formula = !!tb && (free ? evB > evV : evB - evV >= 2);
            const first = formula
                ? { t: tb, add: addB, what: `a ${tier[1]} bomb from your formula book (alchemist's fire: ${tier[2]}d8 fire, ${tier[3]} persistent, splash ${splash}${addB ? `; ${addB.name}` : ""})${free ? ", a perpetual infusion, no vial spent" : `, spending a versatile vial${vials !== null ? ` (${vials} left)` : ""}`}` }
                : { t: tv, add: addV, what: `a quick vial (${vialName}${addV ? `; ${addV.name}` : ""}), no vial spent, potent until the end of this turn` };
            let ev = first.t.ev + (first.add?.ev ?? 0) - provoke;
            const steps = [];
            const throwText = `throw it at ${nameOf(f)} (${signed(first.t.bonus)}, hits about ${pct(first.t.hit)}${first.t.pen ? `, ${first.t.pen} for the range` : ""}${first.t.others.length ? `; the splash also catches ${first.t.others.map(nameOf).join(", ")}` : ""})`;
            if (quickBomber) steps.push({ cost: 1, text: `Quick Bomber: Quick Alchemy ${first.what}, and ${throwText}` });
            else { steps.push({ cost: 1, text: `Quick Alchemy: ${first.what}` }); steps.push({ cost: 1, text: `Strike: ${throwText}` }); }
            let left = ctx.actions - per, made = ctx.made + 1;
            if (brews > 1 && left >= 1) {
                const t2 = vialThrow(f, made);
                if (t2 && t2.hit >= 0.3) { steps.push({ cost: 1, text: `Throw a quick vial made in the same Quick Alchemy (${brews === 3 ? "Alchemical Alacrity" : "Double Brew"}) at ${nameOf(f)} (${signed(t2.bonus)})` }); ev += t2.ev; left -= 1; made += 1; }
            }
            while (left >= per) {
                const t3 = vialThrow(f, made);
                if (!t3 || t3.hit < 0.3) break;
                steps.push({ cost: per, text: `${quickBomber ? "Quick Bomber again" : "Quick Alchemy and throw again"}: a quick vial at ${nameOf(f)} (${signed(t3.bonus)})` });
                ev += t3.ev; left -= per; made += 1;
            }
            const notes = [];
            if (provoke) notes.push("Quick Alchemy has the manipulate trait: it triggers a reaction from the foe next to you.");
            if (formula && !free) notes.push(`The formula bomb is worth about ${Math.round(evB - evV)} more than a quick vial on that first throw, for one of your versatile vials.`);
            else if (tb && !free && evB - evV >= 0.5) notes.push(`A ${tier[1]} formula bomb instead would add about ${Math.round(evB - evV)}, for one of your versatile vials; the quick vial is free.`);
            if (has(actor, "directional-bombs") && first.t.others.length) notes.push(`Directional Bombs: aim the splash as a ${splashRadius >= 10 ? "30" : "15"}-foot cone to spare an ally next to the target.`);
            if (field === "bomber") notes.push("Bomber: you can also keep the splash to the target alone.");
            out.plans.push({ kind: "class", title: `Quick Alchemy a bomb for ${nameOf(f)}`, target: f, ev, score: ev + 0.3 - (formula && !free ? 0.3 : 0), dest: null, steps, notes });
        }
    }
    // --- Mega Bomb: Quick Alchemy with the additive (1), then the 2-action throw: a 30-foot burst within 60 feet, basic Reflex ---
    if (has(actor, "mega-bomb") && foes.length >= 2 && ctx.actions >= 3) {
        const useBomb = canBomb && (vials ?? 1) > 0 && bombAvg + splash > vialAvg + vialSplash;
        const avg = useBomb ? bombAvg + splash : vialAvg + vialSplash;
        let best = null;
        for (const c of foes.filter((f) => feetBetween(me.rect, f.rect) <= 60)) {
            const inB = foes.filter((o) => feetBetween(c.rect, o.rect) <= 30);
            const ev = inB.reduce((t, o) => t + saveExpected(o.saves?.reflex ?? lv + 5, classDc, avg, { basic: true }).expected, 0);
            if (!best || ev > best.ev) best = { c, inB, ev };
        }
        if (best && best.inB.length >= 2) out.plans.push({ kind: "class", title: `Mega Bomb on ${best.inB.length} foes`, target: best.c, ev: best.ev, score: best.ev + 0.3, dest: null, steps: [{ cost: 1, text: `Quick Alchemy ${useBomb ? `a ${tier[1]} bomb (a versatile vial)` : "a quick vial"} with the Mega Bomb additive` }, { cost: 2, text: `Mega Bomb: a 30-foot burst centred on ${nameOf(best.c)} (within 60 feet); ${best.inB.map(nameOf).join(", ")} each take the full bomb, basic Reflex against DC ${classDc}` }], notes: ["Mega Bomb isn't a Strike: no attack roll, and no splash beyond the burst."] });
    }

    // --- Chirurgeon: heals from vials and elixirs ------------------------------------------------------------------
    if (field === "chirurgeon" && ctx.actions >= 1) {
        const el = elixirFor((vials ?? 1) > 0 ? lv : perpetualLevel);
        const maxed = has(actor, "greater-field-discovery-chirurgeon") || lv >= 13;
        const elAvg = el[1] === "minor" ? (maxed ? 6 : 3.5) : el[2] * (maxed ? 6 : 3.5) + el[3];
        const vialHeal = vialDice(lv) * 3.5;
        const cands = [me, ...(board.allies ?? []).filter((a) => a.hp > 0)];
        for (const c of cands) {
            const missing = hurt(c);
            if (missing < 5) continue;
            const self = c === me;
            const dist = self ? 0 : feetBetween(me.rect, c.rect);
            const who = self ? "you" : nameOf(c);
            const options = [];
            // The elixir: drink it yourself (2 actions), or throw it with Healing Bomb (2 actions, 20 feet), or hand it over (they drink on their turn)
            if (self && canMake) options.push({ cost: 2, heal: Math.min(missing, elAvg), text: `Quick Alchemy a ${el[1]} elixir of life and drink it: about ${Math.round(elAvg)} HP${has(actor, "field-discovery-chirurgeon") || lv >= 5 ? ` and ${Math.max(0, int)} temporary HP` : ""}` });
            else if (canMake && has(actor, "healing-bomb") && dist <= 20) options.push({ cost: 2, heal: Math.min(missing, elAvg), text: `Quick Alchemy a ${el[1]} elixir of life and throw it (Healing Bomb) at ${who}: about ${Math.round(elAvg)} HP, and ${el[2]} to each living creature next to them` });
            else if (canMake && dist <= 5) options.push({ cost: 2, heal: Math.min(missing, elAvg) * 0.7, text: `Quick Alchemy a ${el[1]} elixir of life and hand it to ${who}: about ${Math.round(elAvg)} HP when they drink it (1 of their actions)` });
            // The field vial: a quick vial (no vial spent) drunk, or thrown to a willing creature within 20 feet as an Interact
            if (dist <= 20 && vialHeal > 0) options.push({ cost: 2, heal: Math.min(missing, vialHeal), text: `Quick Alchemy a quick vial and ${self ? "drink it" : `throw it to ${who}`}: about ${Math.round(vialHeal)} HP${missing >= (c.maxHp ?? 0) / 2 && lv >= 11 ? "" : " (coagulant: it heals less if they were healed this way recently)"}` });
            options.sort((a, b) => b.heal - a.heal);
            const o = options[0];
            if (!o || ctx.actions < o.cost) continue;
            const ev = 0.8 * o.heal;
            const steps = [{ cost: o.cost, text: o.text }];
            const f = foes.find((x) => inReach(me.rect, x.rect, myReach(board)));
            let total = ev;
            if (f && ctx.actions - o.cost >= 1) { const r = strikeRun(board, f, ctx.actions - o.cost, { made: ctx.made }); if (r.used.length) { steps.push({ cost: r.used.length, text: r.text }); total += r.ev; } }
            out.plans.push({ kind: "class", title: `Heal ${who} with alchemy`, target: null, ev: total, score: total + 0.3, dest: null, steps, notes: has(actor, "merciful-elixir") ? ["Merciful Elixir: an elixir of life 2 levels below your best also tries to end a fear or paralysis on the drinker."] : [] });
        }
        out.notes.push(`Chirurgeon: Battle Medicine and Treat Wounds use your Crafting modifier; your versatile vials heal ${vialDice(lv)}d6 to a creature that drinks one or is hit by one you throw (20 feet).`);
    }

    // --- Mutagenist: the mutagen up, or one to drink -------------------------------------------------------------
    if (field === "mutagenist") {
        const mut = effect(actor, /mutagen/);
        if (mut) {
            out.notes.push(`${mut.name} is up${has(actor, "field-discovery-mutagenist") || lv >= 5 ? "; a Fortitude save you dislike can be rerolled by ending it" : ""}${has(actor, "mutant-physique") ? "; Mutant Physique adds its extra (bestial: bigger claws, deadly d10; juggernaut: physical resistance " + Math.floor(lv / 2) + "; quicksilver: 10-foot Steps)" : ""}.`);
            if (has(actor, "revivifying-mutagen") && hurt(me) >= 3 * Math.floor(lv / 2)) out.plans.push({ kind: "class", title: "Revivifying Mutagen", target: null, ev: 0.8 * Math.min(hurt(me), 3.5 * Math.floor(lv / 2)), score: 0.8 * Math.min(hurt(me), 3.5 * Math.floor(lv / 2)) + 0.2, dest: null, steps: [{ cost: 1, text: `Revivifying Mutagen: regain ${Math.floor(lv / 2)}d6 HP; the mutagen ends` }], notes: [] });
            if (has(actor, "regurgitate-mutagen") && ctx.actions >= 1) { const f = foes.find((x) => feetBetween(me.rect, x.rect) <= 30); if (f) out.notes.push(`Regurgitate Mutagen (1 action): ${Math.floor(lv / 2)}d6 acid at ${nameOf(f)}, basic Reflex DC ${classDc}, sickened 1 on a failure (2 on a critical failure); the mutagen ends.`); }
            if ((vials ?? 0) > 0) out.notes.push("A versatile vial drunk suppresses one of your mutagen's drawbacks for a minute.");
        } else if (canMake && ctx.actions >= 2) {
            out.plans.push({ kind: "class", title: "Drink a mutagen", target: null, ev: 0.3 * (6 + lv), score: 0.3 * (6 + lv) + 0.2, dest: null, steps: [{ cost: 2, text: `Quick Alchemy a mutagen (bestial for claws and jaws, quicksilver for Dexterity and Speed, juggernaut for HP) and drink it: it lasts 10 minutes, and you gain ${Math.max(0, int) + Math.floor(lv / 2)} temporary HP${freeField ? "; a perpetual infusion costs no vial" : ""}` }], notes: has(actor, "mutagenic-flashback") ? ["Mutagenic Flashback (free, once a day): a mutagen you drank today comes back for a minute."] : [] });
        }
    }

    // --- Toxicologist: a poison on the weapon in one action --------------------------------------------------------
    if (field === "toxicologist" && ctx.actions >= 2 && canMake) {
        const f = foes.find((x) => inReach(me.rect, x.rect, myReach(board)));
        const w = board.strikes.find((s) => !s.ranged && !s.traits?.includes("unarmed"));
        if (f && w) {
            const r = strikeRun(board, f, ctx.actions - 1, { made: ctx.made });
            if (r.used.length) {
                const ev = r.ev + r.used[0].e.hit * (2 + lv) * 0.8;
                out.plans.push({ kind: "class", title: `Poison your weapon, then Strike ${nameOf(f)}`, target: f, ev, score: ev + 0.2, dest: null, steps: [{ cost: 1, text: `Quick Alchemy an injury poison and apply it to ${w.label} in the same action${freeField ? " (a perpetual infusion, no vial)" : ""}${has(actor, "potent-poisoner") ? `; its DC rises up to 4, to at most your class DC ${classDc}` : ""}` }, { cost: r.used.length, text: `${r.text}; the first hit exposes it to the poison (Fortitude)${has(actor, "pinpoint-poisoner") && f.conditions?.has?.("off-guard") ? ", at -2 on its save (Pinpoint Poisoner)" : ""}` }], notes: ["Your poisons also work on creatures immune to poison, as acid.", ...(has(actor, "sticky-poison") ? ["Sticky Poison: a flat check keeps the poison on the blade after a hit, until your next turn ends."] : []), ...(has(actor, "greater-field-discovery-toxicologist") || lv >= 13 ? ["A failed first save sprays the poison onto a creature adjacent to the target."] : [])] });
            }
        }
    }

    // --- Notes: vials and perpetual infusions, the bombs in hand, the field and feat when-notes -------------------
    const vialText = vials !== null ? `${vials} versatile vial${vials === 1 ? "" : "s"} left` : "a versatile vial each";
    const perp = perpetualLevel ? `; perpetual infusions give two ${field === "bomber" ? "bombs" : field === "chirurgeon" ? "healing elixirs" : field === "mutagenist" ? "mutagens" : "poisons"} of level ${perpetualLevel} or lower at no vial` : "";
    out.notes.push(`Quick Alchemy (1 action, ${vialText}${perp}): any bomb, elixir or poison in your formula book for a vial, potent until the start of your next turn${has(actor, "enduring-alchemy") ? " (tools and elixirs until the end of it)" : ""}; or a quick vial for nothing, a bomb (${vialName})${field === "chirurgeon" ? " or a healing vial" : ""} good until the end of this turn${brews > 1 ? `; ${brews === 3 ? "Alchemical Alacrity" : "Double Brew"} makes ${brews} at once, a vial for each consumable` : ""}.${bombs.length ? ` Bombs in hand: ${bombs.map((b) => `${b.label} (${signed(b.bonus)})`).join(", ")}, range ${range} feet.` : ""}`);
    if (has(actor, "abundant-vials")) out.notes.push("Abundant Vials: you're always quickened; the extra action makes a quick vial.");
    if (bombs.length && !quickBomber) out.notes.push("Drawing a bomb is an Interact action unless it's already in hand; Quick Bomber would fold the draw into the throw.");
    if (field === "bomber" && bombs.length) out.notes.push(`Bomber: splash ${bigSplash ? `is ${Math.max(1, int)} (your Intelligence)` : "as listed"}${has(actor, "expanded-splash") ? `, +${int} and 10 feet wide with Expanded Splash` : ""}${splashRadius >= 10 && !has(actor, "expanded-splash") ? `, ${splashRadius} feet wide` : ""}; you can keep it to the target alone, or aim it as a cone with Directional Bombs.`);
    if (has(actor, "uncanny-bombs")) out.notes.push("Uncanny Bombs: 60-foot range increment, cover counts 1 less, and no flat check against a concealed or hidden target.");
    if (has(actor, "smoke-bomb")) out.notes.push("Smoke Bomb additive: the bomb also fills a 10-foot burst with smoke for a minute; everyone in it is concealed.");
    if (has(actor, "artokuss-fire") && lv >= 3) out.notes.push("Artokus's Fire: an alchemist's fire made 2 levels below your best burns harder, needs two flat checks to put out, and burns underwater.");
    if (has(actor, "lingering-bomb")) out.notes.push("Lingering Bomb: a persistent-damage bomb leaves a flame in the target's square for a minute instead of hitting directly.");
    if (has(actor, "balm-bomb")) out.notes.push("Balm Bomb (a second vial): a bomb that hits also gives an ally within 5 feet of the target a healing elixir.");
    if (has(actor, "combine-elixirs")) out.notes.push("Combine Elixirs (a second vial): two elixirs in one drink, such as two elixirs of life.");
    if (has(actor, "extend-elixir") || has(actor, "eternal-elixir")) out.notes.push(`${has(actor, "eternal-elixir") ? "Eternal Elixir: one elixir of half your level or lower lasts until you replace it" : "Extend Elixir: your infused elixirs last twice as long on you"}.`);
    if (has(actor, "miracle-worker")) out.notes.push("Miracle Worker (once per 10 minutes): a major or true elixir of life brings back a creature dead for at most 2 rounds, at 1 HP and wounded 1.");
    if (has(actor, "invigorating-elixir")) out.notes.push("Invigorating Elixir additive: a healing elixir also tries to counteract a condition on the drinker, and a paralyzed creature can still drink it.");
    if (has(actor, "clotting-elixirs")) out.notes.push("Clotting Elixirs: a healing elixir lets the drinker roll to end persistent bleed.");
    if (has(actor, "chemical-purification")) out.notes.push("Chemical Purification: an alchemist's fire or ghost charge made 2 levels below your best also deals vitality damage to undead.");
    if (has(actor, "retaliatory-cleansing")) out.notes.push("Retaliatory Cleansing fires when an adjacent creature's Strike would damage you, holding holy water or a vitality bomb: it takes the bomb's damage.");
    if (has(actor, "improvise-admixture") && (vials ?? 1) < (vialRes?.max ?? 99)) out.notes.push("Improvise Admixture (1 action, once a day): a Crafting check for 1 to 3 vials back.");
    if (has(actor, "astonishing-explosion")) out.notes.push("Astonishing Explosion: a bomb made 2 levels below your best leaves its target fascinated by you for a round, stunned 1 on a critical hit.");
    if (has(actor, "plum-deluge")) out.notes.push("Plum Deluge (3 actions, three of the same contact poison): everything in a 20-foot burst within 60 feet is exposed at once.");
    if (has(actor, "alchemical-revivification")) out.notes.push("Alchemical Revivification: dying under an elixir brings you back at the start of your next turn.");
    if (has(actor, "powerful-alchemy")) out.notes.push(`Powerful Alchemy: your infused items use your class DC ${classDc} for their saves.`);
}

export { alchemist };
