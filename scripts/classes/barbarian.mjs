/**
 * PF2e Tactics: classes/barbarian.mjs
 * See classes/_common.mjs for the shape of a class read.
 * Reads Rage (the plan, the damage by instinct, the no-concentrate rule), the instincts' own Strikes and reach, and the
 * class feats that change the math: Swipe, Whirlwind Strike, Thrash, Spirit's Wrath, Terrifying Howl, Unbalancing Sweep,
 * Giant's Stature and Lunge, Desperate Wrath, Furious Bully, Brutal Critical, Share Rage. The rest are when-notes.
 */
import { bestStrike, canMove, castable, effect, focusLeft, has, half, level, markOffGuard, moveText, myReach, allySpeed, pct, squareToReach, strikeRun, targets, worth, degreeChances, feetBetween, inReach, mapFor, strikeExpected, saveExpected, CONDITION_VALUE, nameOf, reachableSquares, signed } from "./_common.mjs";

/** Foundry's slugs drop apostrophes ("hunters-aim"); the catalog's keep a dash for them ("hunter-s-aim"). Both are tried. */
const hasAny = (actor, ...slugs) => slugs.some((s) => has(actor, s));
/**
 * Rage damage by instinct: at 1st, with the 7th-level specialization, and with greater weapon specialization (15th).
 * fury 3/7/13; dragon 4/8/16 (with the dragon's damage type); giant 6/10/18 (with a larger weapon, clumsy 1); spirit 3/7/13
 * (as spirit damage); animal 2/5/12 (the animal's unarmed attacks only); superstition 3/7/13 (4/8/16 against a foe you've seen
 * cast a spell in the last hour); elemental 4/6/12; ligneous 6/10/18 (bark: -10 Speed); decay 6/10/18 (poison; you take
 * 1/5/10 at the end of each turn); bloodrager 2/4/8 (plus persistent bleed of half). No instinct: 2.
 */
const RAGE_DAMAGE = {
    fury: [3, 7, 13], dragon: [4, 8, 16], giant: [6, 10, 18], spirit: [3, 7, 13], animal: [2, 5, 12], superstition: [3, 7, 13],
    elemental: [4, 6, 12], ligneous: [6, 10, 18], decay: [6, 10, 18], bloodrager: [2, 4, 8], default: [2, 2, 2],
};
const RAGE_HOW = {
    dragon: "if you take your dragon's damage type", giant: "with your larger weapon (clumsy 1 while you wield it)", spirit: "as spirit damage if you like",
    animal: "with your animal's attacks; you can't use weapons", superstition: "and one more against a foe you've seen cast a spell", elemental: "as your element's damage",
    ligneous: "if you take the bark (your Speed drops by 10)", decay: "as poison, if you accept the rot (you take damage at the end of each of your turns)",
    bloodrager: "plus persistent bleed of half that", fury: "", default: "",
};
/** The animal instincts' attacks: [label, die, agile, traits, deadly die]. The sheet only shows them while raging. */
const ANIMALS = {
    ankylosaurus: [["Tail", 10, false]], ant: [["Mandibles", 10, false]], ape: [["Fist", 10, false]], bat: [["Fangs", 10, false], ["Wing", 4, false]],
    bear: [["Jaws", 10, false], ["Claw", 6, true]], bird: [["Beak", 10, false], ["Talon", 6, true]], brontosaurus: [["Tail", 10, false]], bull: [["Horn", 10, false]],
    cat: [["Jaws", 10, false], ["Claw", 6, true]], crab: [["Claw", 10, false], ["Pincer claw", 4, false]], crocodile: [["Jaws", 10, false], ["Tail", 6, true]],
    deer: [["Antler", 10, false]], frog: [["Jaws", 10, false], ["Tongue", 6, true]], orca: [["Jaws", 8, false]], scorpion: [["Stinger", 6, false, 10], ["Pincer", 4, false]],
    seal: [["Jaws", 10, false]], shark: [["Jaws", 10, false]], snake: [["Fangs", 10, false]], spider: [["Fangs", 8, false]],
    tyrannosaurus: [["Jaws", 8, false, 5, 12], ["Tail", 6, true]], wasp: [["Stinger", 4, false, 5, 8]], wolf: [["Jaws", 10, false]],
};
const SIZE = { tiny: 0, sm: 1, med: 2, lg: 3, huge: 4, grg: 5 };
const stepUp = (die) => ({ 4: 6, 6: 8, 8: 10, 10: 12, 12: 12 })[die] ?? die;
const abil = (actor, k) => Number(actor?.abilities?.[k]?.mod ?? actor?.system?.abilities?.[k]?.mod) || 0;
const classDC = (actor, lv) => Number(actor?.classDC?.value ?? actor?.system?.attributes?.classDC?.value) || 10 + lv + 4 + (lv >= 19 ? 6 : lv >= 11 ? 4 : 2);
/** Weapon specialization damage for a barbarian: expert at 5, master at 13; greater at 15. */
const weaponSpec = (lv) => (lv >= 15 ? 6 : lv >= 13 ? 3 : lv >= 7 ? 2 : 0);
const oversized = (s, actor) => s.item?.isOversized === true || (SIZE[s.item?.system?.size] ?? 2) > (SIZE[actor?.system?.traits?.size?.value] ?? 2);
const instinctStrike = (s) => !!s.synthetic || /^instinct-/.test(s.item?.slug ?? s.item?.system?.slug ?? "") || (s.item?.system?.traits?.otherTags ?? []).includes("instinct-unarmed-strike");
const strikeText = (f, used) => `Strike ${nameOf(f)} with ${used[0].s.label}${used.length > 1 ? ` ${used.length === 2 ? "twice" : "three times"}` : ""} (${used.map((u) => signed(u.bonus)).join(", ")})`;

/** The instinct and the Rage damage at this level; an archetype barbarian stays at 2 unless it took Instinct Ability. */
function rageDamage(actor, lv) {
    const own = (actor?.class?.slug ?? "") === "barbarian";
    const picked = Object.keys(RAGE_DAMAGE).find((k) => k !== "default" && (k === "bloodrager" ? has(actor, "bloodrager") : has(actor, `${k}-instinct`))) ?? "default";
    const inst = own || has(actor, "instinct-ability") ? picked : "default";
    const tier = !own ? 0 : lv >= 15 ? 2 : lv >= 7 ? 1 : 0;
    return { inst, tier, base: RAGE_DAMAGE[inst][tier] };
}
/** Rage damage on one Strike: none at range (thrown with Raging Thrower), the instinct's number where it applies, half with agile. */
function rageBonusFor(s, actor, inst, tier) {
    if (s.ranged && !(s.thrown && has(actor, "raging-thrower"))) return 0;
    let b = RAGE_DAMAGE[inst][tier];
    if (inst === "giant" && !oversized(s, actor)) b = 2;
    if (inst === "animal" && !instinctStrike(s)) b = 2;
    return s.agile ? Math.floor(b / 2) : b;
}
/** The animal instinct's attacks, built for the plan when the sheet doesn't show them yet (they appear while raging). */
function animalStrikes(board, actor, lv) {
    const item = actor?.items?.find?.((i) => (i.slug ?? i.system?.slug) === "animal-instinct");
    const animal = item?.flags?.pf2e?.rulesSelections?.animal ?? actor?.flags?.pf2e?.rulesSelections?.animal ?? "bear";
    const rows = ANIMALS[animal] ?? ANIMALS.bear;
    const melee = board.strikes.filter((s) => !s.ranged);
    const bonus = melee.length ? Math.max(...melee.map((s) => s.bonus)) : lv + 4 + abil(actor, "str");
    return rows.map(([label, die, agile, reach = 5, deadly = 0]) => {
        const d = lv >= 7 ? stepUp(die) : die;
        return { label, bonus, avg: (d + 1) / 2 + abil(actor, "str"), agile, ranged: false, reach, traits: ["unarmed", ...(agile ? ["agile"] : [])], deadly: deadly ? (deadly + 1) / 2 : 0, synthetic: true };
    });
}

function barbarian(board, ctx, out) {
    const actor = board.me.actor;
    const me = board.me;
    const lv = level(board);
    if (!has(actor, "rage")) return;
    const raging = !!effect(actor, /^effect-rage$/) || !!actor.rollOptions?.all?.rage || !!actor.rollOptions?.all?.["self:effect:rage"];
    const { inst, tier, base } = rageDamage(actor, lv);
    const foes = targets(board);
    const str = abil(actor, "str"), con = abil(actor, "con");
    const dc = classDC(actor, lv);
    const tempHp = lv + con;
    const howl = me.intimidation ?? null; // read before raging may hide Demoralize
    const round1 = typeof game !== "undefined" && game.combat?.round === 1;
    const heavy = actor.wornArmor?.category === "heavy" || !!actor.items?.some?.((i) => i.type === "armor" && i.system?.category === "heavy" && (i.isEquipped ?? i.system?.equipped?.inSlot));
    const quick = has(actor, "quick-tempered") && round1 && (!heavy || has(actor, "invulnerable-rager")) && ctx.made === 0 && ctx.actions >= 3;
    const fatigued = me.conditions?.has?.("fatigued");
    const spec = weaponSpec(lv);

    // ---- the Strikes the plans use: the sheet's, with Rage damage on them (and the animal's attacks when they're not up yet)
    let rs;
    if (raging) {
        for (const s of board.strikes) if (!s.rageCounted) { s.rageCounted = true; s.avg += rageBonusFor(s, actor, inst, tier); }
        if (inst === "animal") { const own = board.strikes.filter((s) => instinctStrike(s) || s.traits?.includes("unarmed")); if (own.length) board.strikes = own; }
        rs = board.strikes;
    } else {
        rs = inst === "animal" ? animalStrikes(board, actor, lv) : board.strikes.map((s) => ({ ...s, avg: s.avg + rageBonusFor(s, actor, inst, tier) }));
    }
    const reach = Math.max(5, ...rs.filter((s) => !s.ranged).map((s) => s.reach || 5));
    const canRage = !raging && !fatigued;
    const rageStep = () => ({ cost: quick ? 0 : 1, text: `${quick ? "Quick-Tempered: Rage as a free action" : "Rage"}: +${base} on your melee Strikes${RAGE_HOW[inst] ? ` (${RAGE_HOW[inst]})` : ""}, ${tempHp} temporary HP` });
    /** A run of Strikes at f with the raged Strikes, the penalty climbing; firstExtra on the first (Mighty Rage). */
    const run = (f, n, made, { firstExtra = 0, acAdj = 0, at = me.rect } = {}) => {
        const used = [];
        let ev = 0;
        for (let i = 0; i < n; i++) {
            let best = null;
            for (const s of rs) {
                if (s.ranged ? feetBetween(at, f.rect) > (s.range ?? 30) * 2 : !inReach(at, f.rect, s.reach || 5)) continue;
                const b = s.bonus + mapFor(made + used.length, s.agile);
                const e = strikeExpected(b, f.ac + acAdj, s.avg + (i === 0 ? firstExtra : 0), { deadly: s.deadly });
                if (!best || e.expected > best.e.expected) best = { s, bonus: b, e };
            }
            if (!best) break;
            used.push(best); ev += best.e.expected;
        }
        return { used, ev };
    };
    const push = (plan) => out.plans.push({ kind: "class", dest: null, notes: [], ...plan, score: plan.ev + (plan.bias ?? 0.3) });

    // ---- marks while raging
    if (raging) {
        out.notes.push(`Raging: +${base} on melee Strikes${RAGE_HOW[inst] ? ` ${RAGE_HOW[inst]}` : ""}, half with an agile weapon; the plans count it. No concentrate actions unless they have the rage trait; you can't stop on purpose.${has(actor, "brutality") ? " Brutality: your melee critical hits get the weapon's critical specialization." : ""}`);
        const dropped = board.spells.filter((sp) => (sp.traits ?? []).includes("concentrate") && !(sp.traits ?? []).includes("rage")).length;
        board.spells = board.spells.filter((sp) => !(sp.traits ?? []).includes("concentrate") || (sp.traits ?? []).includes("rage"));
        board.profiles = board.profiles.filter((p) => !(p.traits ?? []).includes("concentrate") || (p.traits ?? []).includes("rage"));
        if (has(actor, "raging-intimidation")) out.notes.push("Raging Intimidation: Demoralize keeps working while you rage (it has the rage trait for you).");
        else if (me.intimidation != null) { me.intimidation = null; out.notes.push("Demoralize is a concentrate action: not while raging (Raging Intimidation would allow it)."); }
        if (dropped && has(actor, "moment-of-clarity")) out.notes.push(`Moment of Clarity (1 action): concentrate actions are open to you until the end of this turn; ${dropped} of your spells need it.`);
        if (has(actor, "furious-bully") && !me.furiousBully) { me.furiousBully = true; if (me.athletics != null) me.athletics += 2; out.notes.push("Furious Bully: +2 on Athletics attack actions (Trip, Grapple, Shove, Disarm) while raging; the plans count it."); }
        if (has(actor, "desperate-wrath") && me.hp <= me.maxHp / 2 && !effect(actor, /desperate-wrath/)) {
            for (const s of board.strikes) if (!s.wrathCounted) { s.wrathCounted = true; s.bonus += 2; }
            out.notes.push(`Desperate Wrath (free action as your turn begins, at ${me.hp}/${me.maxHp} HP): +2 on attack rolls, -1 to AC and saves until your Rage ends or you're above half; the plans count the +2.`);
        }
        if (has(actor, "brutal-critical")) for (const s of board.strikes) if (!s.ranged && !s.brutalCounted) { s.brutalCounted = true; const die = Number(String(s.item?.system?.damage?.die ?? "d8").replace("d", "")) || 8; s.deadly = (s.deadly || 0) + (die + 1) / 2 * 4; }
    } else {
        if (fatigued) out.notes.push("Fatigued: you can't Rage.");
        else if (ctx.actions < 2 && !quick) out.notes.push(`Rage (1 action): +${base} on melee Strikes, ${tempHp} temporary HP, for a minute.`);
        if (has(actor, "wounded-rage") && !fatigued) out.notes.push("Wounded Rage (reaction): when you take damage, you Rage; the plans spend an action on it instead, so it's free if a foe hits you first.");
        if (has(actor, "second-wind")) out.notes.push("Second Wind: you can Rage again within the minute and still get the temporary HP, but you're fatigued when that Rage ends until you rest 10 minutes.");
        if (has(actor, "revitalizing-rage")) out.notes.push("Revitalizing Rage: one full turn out of a Rage, not a minute, and Rage gives temporary HP again.");
    }

    // ---- Rage, then Strike: the plan when not raging
    if (canRage && (ctx.actions >= 2 || quick) && foes.length) {
        const spare = ctx.actions - (quick ? 0 : 1);
        const scouring = has(actor, "scouring-rage") ? foes.filter((f) => feetBetween(me.rect, f.rect) <= 20) : [];
        const scourEv = scouring.reduce((t, f) => t + saveExpected(f.saves?.fortitude ?? 0, dc, lv).expected, 0);
        for (const f of foes) {
            const sq = squareToReach(board, f, reach, spare - 1);
            if (!sq) continue;
            const left = spare - sq.route.actions;
            if (left < 1) continue;
            const at = sq.route.actions ? { ...me.rect, x: sq.x, y: sq.y } : me.rect;
            const r = run(f, left, ctx.made, { firstExtra: quick && has(actor, "mighty-rage") ? base : 0, at });
            if (!r.used.length) continue;
            const steps = [rageStep()];
            if (scouring.length) steps.push({ cost: 0, text: `Scouring Rage (free): ${scouring.map(nameOf).join(", ")} within 20 feet take ${lv} ${inst === "default" ? "" : inst + " "}damage, basic Fortitude DC ${dc}` });
            if (sq.route.actions) steps.push({ cost: sq.route.actions, text: moveText(sq, f) });
            steps.push({ cost: r.used.length, text: `${strikeText(f, r.used)}; +${rageBonusFor(r.used[0].s, actor, inst, tier)} each${quick && has(actor, "mighty-rage") ? ", Mighty Rage doubles it on the first" : ""}` });
            const ev = r.ev + tempHp * 0.3 + scourEv;
            push({ title: `${quick ? "Rage free, then" : "Rage, then"} Strike ${nameOf(f)}`, target: f, ev, bias: 0.5, dest: sq.route.actions ? { x: sq.x, y: sq.y } : null, steps,
                notes: [quick ? "Quick-Tempered: your first turn's Rage costs no action." : has(actor, "quick-tempered") ? "Rage lasts a minute; Quick-Tempered makes it free on the first turn of a fight only." : "Rage lasts a minute; you can't use concentrate actions while it does."] });
        }
    }
    // Rage-trait plans below work when raging, or after a Rage step this turn
    const prefix = raging ? [] : canRage ? [rageStep()] : null;
    const pre = prefix ? prefix.reduce((t, s) => t + s.cost, 0) : 99;
    const avail = ctx.actions - pre;

    // ---- Swipe (2 actions): one roll against two adjacent foes, two attacks' worth of penalty
    if (has(actor, "swipe") && foes.length >= 2) {
        // Swipe has no rage trait: usable either way; a Rage step first only adds the damage
        const spare = (raging || !canRage ? ctx.actions : avail) - 2;
        if (spare >= 0) for (let i = 0; i < foes.length; i++) for (let j = i + 1; j < foes.length; j++) {
            const a = foes[i], b = foes[j];
            if (!inReach(a.rect, b.rect, 5)) continue;
            const sq = squareToReach(board, a, reach, spare);
            if (!sq) continue;
            const at = sq.route.actions ? { ...me.rect, x: sq.x, y: sq.y } : me.rect;
            if (!inReach(at, b.rect, reach)) continue;
            let best = null;
            for (const s of rs.filter((x) => !x.ranged && inReach(at, a.rect, x.reach || 5) && inReach(at, b.rect, x.reach || 5))) {
                const bon = s.bonus + mapFor(ctx.made, s.agile);
                const ev = strikeExpected(bon, a.ac, s.avg, { deadly: s.deadly }).expected + strikeExpected(bon, b.ac, s.avg, { deadly: s.deadly }).expected;
                if (!best || ev > best.ev) best = { s, bon, ev };
            }
            if (!best) continue;
            const steps = [...(raging || !canRage ? [] : prefix)];
            if (sq.route.actions) steps.push({ cost: sq.route.actions, text: moveText(sq, a) });
            steps.push({ cost: 2, text: `Swipe ${nameOf(a)} and ${nameOf(b)} with ${best.s.label} (${signed(best.bon)}, one roll against both; counts as two attacks)` });
            let ev = best.ev;
            const left = spare - sq.route.actions;
            if (left >= 1) { const r = run(a, 1, ctx.made + 2, { at }); if (r.used.length) { steps.push({ cost: 1, text: strikeText(a, r.used) }); ev += r.ev; } }
            push({ title: `Swipe ${nameOf(a)} and ${nameOf(b)}`, target: a, ev, dest: sq.route.actions ? { x: sq.x, y: sq.y } : null, steps });
        }
    }
    // ---- Whirlwind Strike (3 actions): a Strike at every foe in reach, all at the current penalty
    if (has(actor, "whirlwind-strike") && ctx.actions === 3 && (raging || pre === 0 || !canRage)) {
        const near = foes.filter((f) => inReach(me.rect, f.rect, reach));
        if (near.length >= 2) {
            let ev = 0;
            const shown = [];
            for (const f of near) { const b = bestStrikeOf(rs, f, ctx.made); if (b) { ev += b.e.expected; shown.push(`${nameOf(f)} (${signed(b.bonus)})`); } }
            if (shown.length >= 2) push({ title: `Whirlwind Strike: ${near.length} foes in reach`, target: near[0], ev, steps: [...(raging || !canRage ? [] : prefix), { cost: 3, text: `Whirlwind Strike: ${shown.join(", ")}, each at your current penalty` }] });
        }
    }
    // ---- Thrash (1 action, rage): a foe you have grabbed takes Str + specialization + Rage damage, basic Fortitude
    if (has(actor, "thrash") && avail >= 1) {
        const held = foes.filter((f) => inReach(me.rect, f.rect, reach) && (f.conditions?.has?.("grabbed") || f.conditions?.has?.("restrained")));
        const dmg = str + spec + base;
        for (const f of held) {
            let ev = saveExpected(f.saves?.fortitude ?? 0, dc, dmg).expected;
            const others = has(actor, "whirlwind-toss") ? foes.filter((o) => o !== f && inReach(me.rect, o.rect, 5)) : has(actor, "collateral-thrash") ? foes.filter((o) => o !== f && inReach(f.rect, o.rect, 5)).slice(0, 1) : [];
            for (const o of others) ev += saveExpected(o.saves?.fortitude ?? 0, dc, dmg).expected;
            const steps = [...prefix, { cost: 1, text: `Thrash ${nameOf(f)} (it's ${f.conditions.has("restrained") ? "restrained" : "grabbed"}): ${dmg} bludgeoning, basic Fortitude DC ${dc}${others.length ? `; ${has(actor, "whirlwind-toss") ? "Whirlwind Toss" : "Collateral Thrash"}: ${others.map(nameOf).join(", ")} too` : ""}` }];
            const left = avail - 1;
            if (left >= 1) { const r = run(f, left, ctx.made); if (r.used.length) { steps.push({ cost: r.used.length, text: strikeText(f, r.used) }); ev += r.ev; } }
            push({ title: `Thrash ${nameOf(f)}`, target: f, ev, bias: 0.4, steps, notes: ["Thrash needs the foe grabbed or restrained by you; no attack roll, so it ignores your penalty."] });
        }
    }
    // ---- Spirit's Wrath (1 action, rage): a wisp Strikes a foe within 120 feet for 4d8 + Con spirit; it counts toward your penalty
    if (hasAny(actor, "spirits-wrath", "spirit-s-wrath") && avail >= 1) {
        const melee = rs.filter((s) => !s.ranged);
        const potency = Math.max(0, ...melee.map((s) => Number(s.item?.system?.runes?.potency) || 0));
        const wisp = (melee.length ? Math.max(...melee.map((s) => s.bonus)) - potency : lv + 4 + str) + 2;
        const avg = 18 + con;
        for (const f of foes.filter((x) => feetBetween(me.rect, x.rect) <= 120)) {
            const b = wisp + mapFor(ctx.made, false);
            const e = strikeExpected(b, f.ac, avg);
            let ev = e.expected + e.crit * worth(board, "frightened");
            const steps = [...prefix, { cost: 1, text: `Spirit's Wrath at ${nameOf(f)} (wisp ${signed(b)}, 4d8+${con} spirit; frightened 1 on a critical hit)` }];
            const left = avail - 1;
            if (left >= 1 && inReach(me.rect, f.rect, reach)) { const r = run(f, left, ctx.made + 1); if (r.used.length) { steps.push({ cost: r.used.length, text: strikeText(f, r.used) }); ev += r.ev; } }
            push({ title: `Spirit's Wrath at ${nameOf(f)}`, target: f, ev, bias: inReach(me.rect, f.rect, reach) ? 0.2 : 0.4, steps, notes: ["No Rage damage or weapon specialization on the wisp's hit; it reaches 120 feet without moving you."] });
        }
    }
    // ---- Terrifying Howl (1 action, rage): Demoralize every foe within 30 feet, once a minute each
    if (has(actor, "terrifying-howl") && howl != null && avail >= 1) {
        const near = foes.filter((f) => feetBetween(me.rect, f.rect) <= 30 && !f.conditions?.has?.("frightened") && !f.conditions?.has?.("deafened"));
        if (near.length >= 2) {
            let ev = 0;
            const odds = new Map();
            for (const f of near) { const c = degreeChances(howl, 10 + (f.saves?.will ?? 0)); odds.set(f, c); ev += c.s * worth(board, "frightened") + c.cs * worth(board, "frightened", 2); }
            const steps = [...prefix, { cost: 1, text: `Terrifying Howl: Demoralize ${near.map((f) => `${nameOf(f)} (${pct(odds.get(f).s + odds.get(f).cs)})`).join(", ")} with Intimidation ${signed(howl)}; no language penalty` }];
            const left = avail - 1;
            let target = near[0];
            if (left >= 1) {
                let best = null;
                for (const f of near.filter((x) => inReach(me.rect, x.rect, reach))) { const c = odds.get(f); const r = run(f, left, ctx.made, { acAdj: -(c.s + 2 * c.cs) }); if (r.used.length && (!best || r.ev > best.r.ev)) best = { f, r }; }
                if (best) { steps.push({ cost: best.r.used.length, text: `${strikeText(best.f, best.r.used)}, its AC lower if it's frightened` }); ev += best.r.ev; target = best.f; }
            }
            push({ title: `Terrifying Howl at ${near.length} foes`, target, ev, bias: 0.4, steps, notes: ["Each foe is then immune to your Howl for a minute; Demoralize them one at a time after that."] });
        }
    }
    // ---- Unbalancing Sweep (3 actions, flourish): Trip or Shove up to three foes in reach, all at the current penalty
    if (has(actor, "unbalancing-sweep") && ctx.actions === 3 && me.athletics != null) {
        const near = foes.filter((f) => inReach(me.rect, f.rect, reach) && (f.sizeRank ?? 2) <= (me.sizeRank ?? 2) + 1).slice(0, 3);
        if (near.length >= 2) {
            const pen = mapFor(ctx.made, false);
            let ev = 0;
            const shown = [];
            for (const f of near) { const c = degreeChances(me.athletics + pen, 10 + (f.saves?.reflex ?? 0)); ev += (c.s + c.cs) * (worth(board, "prone") + (raging && has(actor, "brutal-bully") ? str : 0)); shown.push(`${nameOf(f)} (${pct(c.s + c.cs)})`); }
            push({ title: `Unbalancing Sweep: Trip ${near.length} foes`, target: near[0], ev, steps: [{ cost: 3, text: `Unbalancing Sweep: Trip ${shown.join(", ")} with Athletics ${signed(me.athletics + pen)} against their Reflex DCs${raging && has(actor, "brutal-bully") ? `; Brutal Bully adds ${str} bludgeoning to each that works` : ""}` }], notes: ["Shove instead of Trip if you'd rather have them away than prone."] });
        }
    }
    // ---- Giant's Stature, Titan's Stature, Giant's Lunge: reach for the rest of the rage, when a foe is just out of it
    const grown = !!effect(actor, /giants-stature|giant-s-stature|giants-lunge|giant-s-lunge/);
    const grow = grown ? 0 : hasAny(actor, "titans-stature", "titan-s-stature") ? 10 : hasAny(actor, "giants-stature", "giant-s-stature") ? 5 : hasAny(actor, "giants-lunge", "giant-s-lunge") ? Math.max(0, 10 - reach) : 0;
    if (grow && avail >= 2) {
        const stature = hasAny(actor, "giants-stature", "giant-s-stature") && (me.sizeRank ?? 2) <= 2;
        const name = stature ? (hasAny(actor, "titans-stature", "titan-s-stature") ? "Titan's Stature" : "Giant's Stature") : "Giant's Lunge";
        const just = foes.filter((f) => !inReach(me.rect, f.rect, reach) && inReach(me.rect, f.rect, reach + grow));
        for (const f of just) {
            // the Strikes' own reach is short of f; the grown reach covers it, so pick by damage alone
            const used = [];
            let ev = 0, made = ctx.made;
            for (let i = 0; i < avail - 1; i++) { const b = bestStrikeOf(rs, f, made); if (!b) break; used.push(b); ev += b.e.expected; made++; }
            if (!used.length) continue;
            push({ title: `${name}, then Strike ${nameOf(f)}`, target: f, ev, steps: [...prefix, { cost: 1, text: `${name}: reach +${grow} feet until your Rage ends${stature ? ", clumsy 1" : ""}; ${nameOf(f)} is in reach without moving` }, { cost: used.length, text: strikeText(f, used) }],
                notes: [stature ? "Clumsy 1 is -1 to AC, Reflex and Dexterity-based checks for the rest of the rage." : "Giant's Lunge gives all your melee attacks 10-foot reach for the rest of the rage."] });
        }
        if (!just.length && foes.some((f) => !inReach(me.rect, f.rect, reach))) out.notes.push(`${name} (1 action): reach +${grow} feet for the rest of the rage; worth it the turn a foe stands just outside your reach.`);
    }
    // ---- Share Rage (1 action, rage, once a rage): an ally within 30 feet gets Rage
    if (has(actor, "share-rage") && avail >= 1) {
        const ally = board.allies.filter((a) => a.hasMelee !== false && a.canAct !== false && feetBetween(me.rect, a.rect) <= 30 && !effect(a.actor, /^effect-rage$/)).sort((a, b) => (b.reactiveStrike?.avg ?? 0) - (a.reactiveStrike?.avg ?? 0))[0];
        if (ally) {
            const ev = ((ally.level ?? lv) + 2) * 0.3 + 0.1 * (ally.reactiveStrike?.avg ?? 6) * 2 * 2;
            push({ title: `Share Rage with ${nameOf(ally)}`, target: null, ev, bias: 0.2, steps: [...prefix, { cost: 1, text: `Share Rage: ${nameOf(ally)} gets Rage (+2 on melee Strikes, temporary HP equal to its level plus Constitution) and may still concentrate` }], notes: [has(actor, "contagious-rage") ? "Contagious Rage: as often as you like, and they may take your instinct's ability and specialization too." : "Once per Rage."] });
        }
    }

    // ---- when-notes, in level order
    if (raging) {
        if (has(actor, "furious-finish")) {
            const last = foes.length === 1 ? foes[0] : null;
            out.notes.push(`Furious Finish (1 action): a Strike with up to +10 damage (one per round left in your Rage)${last ? `; ${nameOf(last)} is the last foe standing, so this is its turn` : "; only on a turn that ends the fight"}: your Rage ends and you're fatigued until you rest 10 minutes.`);
        }
        if (has(actor, "shake-it-off") && (me.conditions?.has?.("frightened") || me.conditions?.has?.("sickened"))) out.notes.push("Shake It Off (1 action): frightened drops by 1 and you save against sickened as if you'd retched (it has the rage trait).");
        if (has(actor, "inner-strength") && me.conditions?.has?.("enfeebled")) out.notes.push("Inner Strength (1 action): enfeebled drops by 1.");
        if (has(actor, "supernatural-senses") && foes.some((f) => f.state === "concealed" || f.state === "hidden")) out.notes.push("Supernatural Senses: your flat check is DC 3 against a concealed foe and DC 9 against a hidden one while raging.");
        if (has(actor, "instinctive-strike") && foes.some((f) => f.state === "concealed" || f.state === "hidden")) out.notes.push("Instinctive Strike: no flat check on a melee Strike against a foe you're tracking by scent.");
        if (hasAny(actor, "spirits-interference", "spirits-interference")) out.notes.push("Spirits' Interference (1 action): until your Rage ends, every ranged attack on you needs a flat check or misses.");
        if (has(actor, "animalistic-brutality")) out.notes.push("Animalistic Brutality (1 action, once a rage): give your animal attack backswing, forceful, parry, razing or sweep until the Rage ends.");
        if (has(actor, "animal-rage")) out.notes.push("Animal Rage (1 action): animal form at 3rd rank with your own statistics and attacks; for a Speed (fly, swim, climb) or a reach you lack, not for damage.");
        if (has(actor, "renewed-vigor")) out.notes.push(`Renewed Vigor (1 action): ${Math.floor(lv / 2) + con} temporary HP, ${tempHp} after an attack action this turn; a third action when you're taking the hits.`);
        if (has(actor, "come-and-get-me")) out.notes.push(`Come and Get Me (1 action): you're off-guard and foes get +2 damage against you until the Rage ends; any foe that hits you is off-guard to you until the end of your next turn, and hitting it back gives you ${con} temporary HP${has(actor, "vengeful-strike") ? "; Vengeful Strike then fires as a reaction (free on a critical hit) when a foe in reach hits you: a melee Strike back" : ""}.`);
        if (has(actor, "furious-grab")) out.notes.push("Furious Grab (1 action, after a hit, with a free hand or a grapple weapon): the foe is grabbed, no roll.");
        if (has(actor, "knockback")) out.notes.push(`Knockback (1 action, after a hit): push the foe 5 feet and follow${has(actor, "awesome-blow") ? "; Awesome Blow: Athletics against its Fortitude DC for a Shove and a Trip in one" : ""}.`);
        if (has(actor, "follow-up-assault")) out.notes.push("Follow-Up Assault (1 action, after a missed melee Strike): Strike again with the same weapon, with backswing and forceful.");
        if (has(actor, "silencing-strike")) out.notes.push("Silencing Strike (1 action): a melee Strike; on a hit, Fortitude against your class DC or stunned 1 (3 on a critical failure); incapacitation, so against foes of your level or lower.");
        if (has(actor, "mage-hunter")) out.notes.push("Mage Hunter (2 actions): a melee Strike against a foe you've seen Cast a Spell; it's stupefied 1 (2 on a critical hit) until your next turn.");
        if (has(actor, "sunder-spell")) out.notes.push("Sunder Spell (2 actions): a melee Strike that counteracts one spell on the target or a spell manifestation (a wall, a guardian); once per target a day.");
        if (hasAny(actor, "dragons-rage-wings", "dragon-s-rage-wings") && !effect(actor, /rage-wings/)) out.notes.push("Dragon's Rage Wings (1 action): a fly Speed equal to your land Speed for the rest of the Rage; for a foe above you or across a gap.");
        if (has(actor, "impaling-thrust")) out.notes.push("Impaling Thrust (2 actions, piercing weapon): a Strike that grabs the foe on your weapon; it bleeds when it gets free.");
        if (has(actor, "vicious-evisceration")) out.notes.push("Vicious Evisceration (2 actions): a melee Strike that leaves the foe drained 1 (2 on a critical hit).");
        if (has(actor, "perfect-clarity")) out.notes.push("Perfect Clarity (reaction): when an attack roll or Will save fails, reroll it at +2 and keep the better; your Rage ends at once, so it's for the last big swing.");
        if (has(actor, "dragon-transformation") && !effect(actor, /dragon-transformation|dragon-form/)) out.notes.push(`Dragon Transformation (1 action, once per 10 minutes): dragon form at 6th rank with your own AC and attack modifier plus your Rage damage, and a breath on your class DC${lv >= 18 ? "; at 18th, +12 damage with its Strikes and +14 on the breath" : ""}.`);
        if (has(actor, "quaking-stomp")) out.notes.push("Quaking Stomp (1 action, once per 10 minutes): an earthquake on your class DC around you; your allies are in it too.");
        if (has(actor, "unstoppable-juggernaut")) out.notes.push(`Unstoppable Juggernaut: resistance ${3 + con} to all damage (${8 + con} to your instinct's types); at 0 HP you can end your Rage as a reaction to stay at 1 HP and take wounded 2.`);
        if (has(actor, "devastator")) out.notes.push("Devastator: your melee Strikes ignore up to 10 physical resistance.");
    }
    if (has(actor, "intimidating-strike")) out.notes.push("Intimidating Strike (2 actions): a melee Strike that leaves the foe frightened 1 (2 on a critical hit) when it damages; not concentrate, so it works while raging.");
    if (has(actor, "cleave")) {
        const low = foes.filter((f) => f.hp != null && f.hp <= (rs[0]?.avg ?? 8) * 1.2 && foes.some((o) => o !== f && inReach(f.rect, o.rect, 5)));
        out.notes.push(`Cleave (reaction): when your melee Strike drops a foe with another foe adjacent to it, a free melee Strike on that one${has(actor, "great-cleave") ? ", and on again while each drops" : ""}${low.length ? `; ${low.map(nameOf).join(", ")} may go down this turn with a neighbour` : ""}.`);
    }
    if (hasAny(actor, "dragons-rage-breath", "dragon-s-rage-breath")) {
        const near = foes.filter((f) => feetBetween(me.rect, f.rect) <= 30).length;
        out.notes.push(`Dragon's Rage Breath (2 actions, once per 10 minutes): your dragon's breath in a cone or line, basic Reflex DC ${dc}; it has the rage trait. Worth it when it catches two or more${near >= 2 ? ` (${near} foes within 30 feet now)` : "; not for one foe you could Strike"}.`);
    }
    if (has(actor, "elemental-explosion")) out.notes.push(`Elemental Explosion (2 actions, once a rage): ${lv}d8 of your element in a burst around you, basic Reflex DC ${dc}; it has the rage trait.`);
    if (has(actor, "brutal-bully") && !raging) out.notes.push(`Brutal Bully: while raging, a Grapple, Shove, Trip or Disarm that works deals ${str} bludgeoning.`);
    if (has(actor, "oversized-throw") && !board.strikes.some((s) => s.ranged)) out.notes.push(`Oversized Throw (2 actions, a free hand): hurl a boulder or table at a foe within 20 feet for ${lv >= 15 ? "3d10" : lv >= 7 ? "2d10" : "1d10"} bludgeoning plus your Rage damage with Raging Thrower.`);
    if (has(actor, "friendly-toss")) out.notes.push("Friendly Toss (2 actions, a free hand): throw an adjacent ally up to 30 feet to a spot you can see; they land standing and can Strike as a reaction if a foe is in reach.");
    if (hasAny(actor, "predators-pounce", "predator-s-pounce")) out.notes.push("Predator's Pounce (1 action, light or no armor): Stride and Strike in one; the plans' Stride-then-Strike turns cost one action less with it.");
    if (has(actor, "no-escape")) out.notes.push("No Escape (reaction): when a foe in reach moves away, you follow it your full Speed, keeping it in reach.");
    if (has(actor, "scars-of-steel")) out.notes.push(`Scars of Steel (reaction, once a day): resistance ${con + Math.floor(lv / 2)} against one critical hit that deals physical damage.`);
    if (has(actor, "tangle-of-battle")) out.notes.push("Tangle of Battle (reaction): when you critically hit an adjacent foe, Grapple it.");
    if (has(actor, "embrace-the-pain")) out.notes.push("Embrace the Pain (reaction): when a foe in reach damages you in melee, Grapple it or Disarm the weapon.");
    if (has(actor, "furious-vengeance")) out.notes.push("Furious Vengeance (reaction): when a foe in reach critically hits you in melee, a melee Strike back.");
    if (has(actor, "meditate-on-this")) out.notes.push("Meditate on This (1 action): until your next turn, a creature you hit unarmed, or that cuts you while adjacent, saves or is frightened 1 to 3; incapacitation.");
    if (has(actor, "penetrating-projectile") && board.strikes.some((s) => s.ranged)) out.notes.push("Penetrating Projectile (2 actions, a piercing ranged weapon): one shot at every creature in a 60-foot line, ignoring creatures' cover; counts as one attack per foe.");
    if (has(actor, "annihilating-swing")) out.notes.push("Annihilating Swing (2 actions): a melee Strike that ignores every resistance the foe has.");
    if (has(actor, "towering-transformation")) out.notes.push("Towering Transformation (reaction): when you grow (Giant's Stature), every smaller foe within 30 feet saves or is frightened.");
    if (has(actor, "brutal-crush") && inst === "animal") out.notes.push("Brutal Crush (1 action, after a bludgeoning hit with your animal attack): Strike again; a hit stupefies 2 for a round.");
    if (has(actor, "rip-and-tear") && inst === "animal") out.notes.push(`Rip and Tear (1 action, after a piercing or slashing hit with your animal attack): Strike again; a hit adds ${lv >= 12 ? "2d6" : "1d6"} persistent bleed.`);
    if (has(actor, "mighty-rage") && !raging && !quick && has(actor, "quick-tempered")) out.notes.push("Mighty Rage: when Quick-Tempered starts your Rage, your first Strike that turn deals your Rage damage again.");
    if (has(actor, "contagious-rage") && !raging) out.notes.push("Contagious Rage: Share Rage as often as you like, and allies may take your instinct's ability with it.");
}
/** The best of these melee Strikes at t for the nth attack, reach aside (the caller has checked it). */
function bestStrikeOf(strikes, t, made) {
    let best = null;
    for (const s of strikes.filter((s) => !s.ranged)) {
        const b = s.bonus + mapFor(made, s.agile);
        const e = strikeExpected(b, t.ac, s.avg, { deadly: s.deadly });
        if (!best || e.expected > best.e.expected) best = { s, bonus: b, e };
    }
    return best;
}

export { barbarian };
