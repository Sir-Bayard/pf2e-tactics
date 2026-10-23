/**
 * PF2e Tactics: classes/druid.mjs
 * See classes/_common.mjs for the shape of a class read.
 * The druid's layer over the advisor: the order (its focus spell and what it steers), the animal companion (Command an
 * Animal as a plan worth its Strikes, Side by Side flanking), Untamed Form (which shape, and whether a form beats
 * casting from here on), summons (worth on the turn they appear, what a Sustain buys afterwards), Untamed Shift,
 * Focus Points and the once-a-day features, and the spellshapes and reactions as "when" notes.
 */
import { companionOf, summonedOf as summonedAlly } from "./minions.mjs";
import { bestStrike, canMove, castable, effect, focusLeft, has, half, level, spendsSlot, markOffGuard, moveText, myReach, allySpeed, pct, squareToReach, strikeRun, targets, worth, degreeChances, feetBetween, inReach, mapFor, strikeExpected, saveExpected, CONDITION_VALUE, nameOf, reachableSquares, signed } from "./_common.mjs";

/** The orders (Remaster first, Legacy after), with the order spell each grants. */
const ORDERS = [
    ["animal-order", "animal", "Heal Animal"], ["leaf-order", "leaf", "Cornucopia"], ["storm-order", "storm", "Tempest Surge"],
    ["untamed-order", "untamed", "Untamed Shift"], ["wave-order", "wave", "Rising Surf"], ["stone-order", "stone", "Crushing Ground"],
    ["flame-order", "flame", "Wildfire"], ["cultivation-order", "cultivation", "Cornucopia"], ["spore-order", "spore", "Mushroom Patch"],
    ["wild-order", "untamed", "Wild Morph"],
];
/**
 * Battle forms Untamed Form can take, by the feat that adds them: the form spell's numbers at each rank it heightens to
 * (Player Core and Player Core 2 text). atk: the form's attack modifier; ac: added to your level; thp: temporary HP;
 * avg: the best Strike's average with the form's damage bonus; reach in feet; agile when the best Strike is.
 * Untamed Form is heightened to half your level rounded up; a shape uses its spell's highest entry at or under that.
 */
const FORMS = [
    { key: "animal", feat: "untamed-form", name: "animal form", shape: "a bear's jaws", tiers: { 2: { atk: 9, ac: 16, thp: 5, avg: 10, reach: 5 }, 3: { atk: 14, ac: 17, thp: 10, avg: 14, reach: 5 }, 4: { atk: 16, ac: 18, thp: 15, avg: 18, reach: 10 }, 5: { atk: 18, ac: 18, thp: 20, avg: 25, reach: 15 } } },
    { key: "insect", feat: "insect-shape", name: "insect form", shape: "a beetle's mandibles", tiers: { 3: { atk: 13, ac: 18, thp: 10, avg: 13, reach: 5 }, 4: { atk: 16, ac: 18, thp: 15, avg: 17, reach: 10 }, 5: { atk: 18, ac: 18, thp: 20, avg: 24, reach: 15 } } },
    { key: "dinosaur", feat: "ferocious-shape", name: "dinosaur form", shape: "a stegosaurus's tail", tiers: { 4: { atk: 16, ac: 18, thp: 15, avg: 18, reach: 10 }, 5: { atk: 18, ac: 18, thp: 20, avg: 24, reach: 15 }, 7: { atk: 25, ac: 21, thp: 25, avg: 33, reach: 20 } } },
    { key: "aerial", feat: "soaring-shape", name: "aerial form", shape: "a bird's beak, flying", tiers: { 4: { atk: 16, ac: 18, thp: 5, avg: 14, reach: 5 }, 5: { atk: 18, ac: 18, thp: 10, avg: 17, reach: 5 }, 6: { atk: 21, ac: 21, thp: 15, avg: 22, reach: 10 } }, fly: true },
    { key: "elemental", feat: "elemental-shape", name: "elemental form", shape: "an earth elemental's boulder", tiers: { 5: { atk: 18, ac: 19, thp: 10, avg: 20, reach: 5 }, 6: { atk: 23, ac: 22, thp: 15, avg: 24, reach: 10 }, 7: { atk: 25, ac: 22, thp: 20, avg: 33, reach: 15 } } },
    { key: "plant", feat: "plant-shape", name: "plant form", shape: "an arboreal's branch", tiers: { 5: { atk: 17, ac: 19, thp: 12, avg: 22, reach: 15 }, 6: { atk: 21, ac: 22, thp: 24, avg: 27, reach: 20 } } },
    { key: "dragon", feat: "dragon-shape", name: "dragon form", shape: "a dragon's jaws, flying", tiers: { 6: { atk: 22, ac: 18, thp: 10, avg: 26, reach: 5, breath: 35 }, 8: { atk: 28, ac: 21, thp: 15, avg: 32, reach: 10, breath: 49 } }, fly: true },
    { key: "monstrosity", feat: "monstrosity-shape", name: "monstrosity form", shape: "a sea serpent's jaws", tiers: { 8: { atk: 28, ac: 20, thp: 20, avg: 33, reach: 15 }, 9: { atk: 31, ac: 22, thp: 25, avg: 39, reach: 15 } } },
    { key: "kaiju", feat: "heart-of-the-kaiju", name: "kaiju form", shape: "a kaiju's jaws", tiers: { 9: { atk: 32, ac: 23, thp: 25, avg: 39.5, reach: 20, breath: 45 } } },
];
/** The best tier of a form at this Untamed Form rank, or null when the rank is too low. */
function tierAt(form, rank) {
    const ranks = Object.keys(form.tiers).map(Number).filter((r) => r <= rank);
    return ranks.length ? { rank: Math.max(...ranks), ...form.tiers[Math.max(...ranks)] } : null;
}
/** A summoned creature of the level a summon spell of this rank brings, as the Monster Core's high attack and moderate Strike. */
const SUMMON_LEVEL = { 1: -1, 2: 1, 3: 2, 4: 3, 5: 5, 6: 7, 7: 9, 8: 11, 9: 13, 10: 15 };
const CREATURE_ATK = { "-1": 8, 0: 8, 1: 9, 2: 11, 3: 12, 4: 14, 5: 15, 6: 17, 7: 18, 8: 20, 9: 21, 10: 23, 11: 24, 12: 26, 13: 27, 14: 29, 15: 30 };
const CREATURE_AVG = { "-1": 3.5, 0: 4.5, 1: 5.5, 2: 8.5, 3: 10.5, 4: 12, 5: 14, 6: 16, 7: 18, 8: 20, 9: 22, 10: 24, 11: 26, 12: 26.5, 13: 28.5, 14: 30.5, 15: 32.5 };
const summonStats = (rank) => { const L = SUMMON_LEVEL[Math.min(10, Math.max(1, rank))]; return { level: L, atk: CREATURE_ATK[L] ?? L + 10, avg: CREATURE_AVG[L] ?? 4 + L * 1.5 }; };
/** A battle form or morph the character is already under (PF2e's spell effects). */
const formEffect = (actor) => effect(actor, /(pest|animal|insect|dinosaur|aerial|elemental|plant|dragon|monstrosity|ooze|fey|daemon|demon|devil|angel|cosmic)-form|nature-incarnate|untamed-form/);
/** The character's own unarmed attack modifier: an unarmed Strike's bonus, else the best melee bonus. */
function unarmedBonus(board) {
    const ua = board.strikes.filter((s) => !s.ranged && (s.traits ?? []).includes("unarmed")).sort((a, b) => b.bonus - a.bonus)[0];
    if (ua) return ua.bonus;
    const m = board.strikes.filter((s) => !s.ranged).sort((a, b) => b.bonus - a.bonus)[0];
    return m ? m.bonus : level(board) + 2 + (board.me.actor?.system?.abilities?.str?.mod ?? 0);
}
/** The best 2-action damage spell (cantrip when cantripOnly) against f, as expected damage; what a turn of casting is worth. */
function bestCast(board, f, { cantripOnly = false } = {}) {
    let best = null;
    for (const sp of castable(board, (sp) => sp.cost >= 1 && sp.cost <= 2 && sp.avg > 0 && !sp.heals && (!cantripOnly || sp.cantrip))) {
        if (sp.range !== null && sp.range !== undefined && sp.range > 0 && feetBetween(board.me.rect, f.rect) > sp.range) continue;
        let e = 0;
        if (sp.attack !== null && sp.attack !== undefined) e = strikeExpected(sp.attack, f.ac, sp.avg).expected;
        else if (sp.save?.stat) e = saveExpected(f.saves?.[sp.save.stat] ?? level(board) + 5, sp.dc ?? 10 + level(board) + 4, sp.avg, { basic: sp.save.basic }).expected;
        else continue;
        if (!best || e > best.e) best = { sp, e };
    }
    return best;
}
/** Two Strikes by a creature with one attack (bonus, avg) at f: the second at -5. */
const twoStrikes = (bonus, avg, f, acAdj = 0) => strikeExpected(bonus, f.ac + acAdj, avg).expected + strikeExpected(bonus - 5, f.ac + acAdj, avg).expected;
/** A free square next to f for a Medium creature, when the board says who stands where (true when it can't say). */
function squareBeside(board, f) {
    if (!board.occupant) return true;
    for (let dx = -1; dx <= f.rect.w; dx++) for (let dy = -1; dy <= f.rect.h; dy++) {
        if (dx >= 0 && dx < f.rect.w && dy >= 0 && dy < f.rect.h) continue;
        const k = `${f.rect.x + dx},${f.rect.y + dy}`;
        if (!board.occupant.has(k)) return true;
    }
    return false;
}

function druid(board, ctx, out) {
    const actor = board.me.actor;
    const me = board.me;
    const lv = level(board);
    const rank = Math.max(1, Math.ceil(lv / 2));
    const foes = targets(board);
    const focus = focusLeft(actor);
    const order = ORDERS.find(([slug]) => has(actor, slug)) ?? null;
    const orderKey = order?.[1] ?? null;
    const companion = companionOf(board);
    const inForm = formEffect(actor);
    const spellNamed = (re) => (board.spells ?? []).find((sp) => re.test(sp.name ?? "") && !sp.consumable) ?? null;
    const nearest = (xs, at = me.rect) => xs.slice().sort((a, b) => feetBetween(at, a.rect) - feetBetween(at, b.rect))[0] ?? null;

    /* ---------------------------------------------------------------- in a battle form: Strike with it, no spells */
    if (inForm && !/untamed-shift|wild-morph/.test(inForm.slug ?? inForm.system?.slug ?? "")) {
        const name = (inForm.name ?? "your form").replace(/^(Spell )?Effect: /i, "");
        out.notes.push(`${name}: your Strikes are the form's (the sheet shows them), and you can't Cast a Spell or use manipulate actions until you Dismiss it (1 action). The plans use the form's Strikes.`);
        board.spells = [];
        board.profiles = (board.profiles ?? []).filter((p) => !(p.traits ?? []).includes("manipulate") && !(p.traits ?? []).includes("concentrate"));
        if (has(actor, "defensive-dismissal")) out.notes.push("Defensive Dismissal (reaction): when a Strike critically hits you, Dismiss the form and the hit becomes a plain hit.");
        if (has(actor, "elemental-shape")) out.notes.push("Elemental Shape: resistance 5 to fire while transformed.");
        if (has(actor, "plant-shape") && has(actor, "untamed-form")) out.notes.push("Plant Shape: resistance 5 to poison while transformed.");
        if (has(actor, "dragon-shape")) out.notes.push("Dragon Shape: resistance 5 to bludgeoning or poison (your pick) while transformed.");
        if (has(actor, "pesh-skin") && /plant/i.test(name)) out.notes.push("Pesh Skin (1 action, while a plant): anything that touches or hits you in melee takes damage, and a piercing or slashing hit must save or be stupefied 1.");
    }

    /* ---------------------------------------------------------------- Focus Points and the order */
    if (focus !== null) {
        const refill = has(actor, "primal-focus") ? "Refocus refills the whole pool (Primal Focus)" : "Refocus brings back 1 point in 10 minutes";
        if (focus <= 0) out.notes.push(`No Focus Points left: your order spells are off the table until you ${refill}.${has(actor, "floral-restoration") ? " Floral Restoration (1 action, once a day, standing among plants): 1 Focus Point back and some HP." : ""}`);
        else out.notes.push(`Focus Points: ${focus} left; ${refill}.`);
    }
    if (orderKey === "storm" && focus > 0 && spellNamed(/^tempest surge$/i)) out.notes.push(`Tempest Surge (2 actions, 1 Focus Point, Reflex): ${rank}d12 electricity, and a foe that fails is clumsy 2 for a round (-2 AC and Reflex for the party's attacks). Spend it on a foe your melee allies are about to hit.`);
    if (orderKey === "leaf" || orderKey === "cultivation") {
        const sp = spellNamed(/^(cornucopia|goodberry)$/i);
        if (sp) out.notes.push(`${sp.name} (2 actions, 1 Focus Point): food that heals when eaten with an Interact action. In a fight it costs three actions for the healing of one; make it before the fight or hand it to an ally who has an action to spare.`);
    }
    if (orderKey === "wave" && spellNamed(/^rising surf$/i)) out.notes.push("Rising Surf (1 action, 1 Focus Point): ride a wave 35 feet and up to 5 feet off the ground; it still provokes. Use it to leave a melee or reach high ground without a second Stride.");
    if (orderKey === "stone" && spellNamed(/^crushing ground$/i)) out.notes.push(`Crushing Ground (2 actions, 1 Focus Point, 60 feet, one foe, Reflex): ${2 * (spellNamed(/^crushing ground$/i).rank ?? rank)}d6 bludgeoning; off-guard and -10 feet of Speed on a failure, immobilized on a critical failure. Spend it on the foe your melee allies are about to hit, or one closing on you.`);
    if (orderKey === "flame" && spellNamed(/^wildfire$/i)) out.notes.push("Wildfire (2 actions, 1 Focus Point): fire that spreads from the square it lands in on the turns you Sustain it; drop it where the foes stand and your allies don't.");
    if (orderKey === "spore" && spellNamed(/^mushroom patch$/i)) out.notes.push("Mushroom Patch (1 Focus Point): fungal terrain to Sustain; put it where foes must cross.");

    /* ---------------------------------------------------------------- the animal companion */
    if (companion) {
        const comp = companion;
        // Command an Animal and Side by Side: classes/minions.mjs, for every class with a companion
        // Heal Animal: the advisor's heal plans don't know it heals only animals; the companion is the patient
        const ha = spellNamed(/^heal animal$/i);
        if (ha && focus > 0 && comp.hp <= comp.maxHp * 0.6) {
            const missing = Math.max(0, comp.maxHp - comp.hp);
            const r = ha.rank ?? rank;
            const touch = inReach(me.rect, comp.rect, 5);
            const one = Math.min(missing, r * 4.5) * 0.8, two = Math.min(missing, r * 12.5) * 0.8;
            const near = feetBetween(me.rect, comp.rect) <= 30;
            if (touch && ctx.actions >= 1) out.plans.push({ kind: "class", title: `Heal Animal on ${nameOf(comp)}`, target: null, ev: one, score: one + 0.2, dest: null, steps: [{ cost: 1, text: `Heal Animal (1 action, touch) on ${nameOf(comp)}: about ${Math.round(r * 4.5)} HP (it's at ${comp.hp}/${comp.maxHp})` }], notes: [has(actor, "instinctive-support") ? "Instinctive Support: after the spell it gets its actions, one of them Support." : "1 Focus Point."] });
            if (near && ctx.actions >= 2) out.plans.push({ kind: "class", title: `Heal Animal (2 actions) on ${nameOf(comp)}`, target: null, ev: two, score: two + 0.2, dest: null, steps: [{ cost: 2, text: `Heal Animal (2 actions, 30 feet) on ${nameOf(comp)}: about ${Math.round(r * 12.5)} HP (it's at ${comp.hp}/${comp.maxHp})` }], notes: [has(actor, "instinctive-support") ? "Instinctive Support: after the spell it gets its actions, one of them Support." : "1 Focus Point."] });
        } else if (ha) out.notes.push("Heal Animal heals only animals: your companion, not the party.");
        if (has(actor, "apex-companion") && focus > 0) out.notes.push(`Apex Companion (focus spell): ${nameOf(comp)} becomes an apex of its kind for a minute, Huge with better Strikes; cast it on a turn it can reach the foe it will stay on.`);
    } else if (has(actor, "animal-companion") || has(actor, "animal-order")) {
        if (spellNamed(/^heal animal$/i)) out.notes.push("Heal Animal heals only animals; your companion isn't on the field.");
    }

    /* ---------------------------------------------------------------- Untamed Form: which shape, and whether a form beats casting */
    const untamed = has(actor, "untamed-form") || has(actor, "wild-shape");
    if (untamed && !inForm && focus > 0 && ctx.actions >= 2 && foes.length) {
        const own = unarmedBonus(board) + 2;
        const shapes = FORMS.filter((fm) => has(actor, fm.feat)).map((fm) => ({ fm, t: tierAt(fm, rank) })).filter((x) => x.t);
        if (!shapes.length) out.notes.push(`Untamed Form at rank ${rank} only gives pest form (no Strikes): a scout's shape, not a fighter's, until level 3 brings animal form.`);
        for (const x of shapes) x.atk = Math.max(x.t.atk, own);
        // The foe to size the form against: one already in reach of a form, else the nearest
        const ordered = foes.slice().sort((a, b) => feetBetween(me.rect, a.rect) - feetBetween(me.rect, b.rect));
        for (const f of ordered) {
            // The best shape by three Strikes a turn at this foe; a flier when the foe is out of reach of the ground
            let best = null;
            for (const x of shapes) {
                const turn = [0, 1, 2].reduce((t, n) => t + strikeExpected(x.atk + mapFor(n, false), f.ac, x.t.avg).expected, 0);
                if (!best || turn > best.turn) best = { ...x, turn };
            }
            if (!best) continue;
            // A turn of your own: a cantrip and a Strike, or three weapon Strikes (the form is free of slots, so slot spells aren't the measure)
            const cantrip = bestCast(board, f, { cantripOnly: true });
            const oneStrike = Math.max(strikeRun(board, f, 1, { made: 0 }).ev, strikeRun(board, f, 1, { made: 0, melee: false }).ev);
            const other = Math.max(cantrip ? cantrip.e + (cantrip.sp.cost <= 2 ? oneStrike : 0) : 0, strikeRun(board, f, 3, { made: 0 }).ev, strikeRun(board, f, 3, { made: 0, melee: false }).ev);
            const inReachNow = inReach(me.rect, f.rect, best.t.reach);
            const steps = [{ cost: 2, text: `Untamed Form (rank ${best.t.rank}): ${best.fm.name}, ${best.fm.shape} (${signed(best.atk)}${best.atk === own ? ", your own modifier +2" : ""}, about ${Math.round(best.t.avg)} a hit, reach ${best.t.reach} feet), AC ${best.t.ac + lv}, ${best.t.thp} temporary HP${best.fm.fly ? ", flying" : ""}` }];
            let ev = best.t.thp * 0.3;
            let left = ctx.actions - 2;
            const notes = [];
            // Healing Transformation (level 10): one more action, and the form heals you
            if (has(actor, "healing-transformation") && left >= 1 && me.hp < me.maxHp * 0.7) {
                const heal = Math.min(me.maxHp - me.hp, 3.5 * best.t.rank) * 0.8;
                steps.unshift({ cost: 1, text: `Healing Transformation first: the form also heals you about ${Math.round(3.5 * best.t.rank)} (you're at ${me.hp}/${me.maxHp})` });
                ev += heal; left -= 1;
            }
            // Explosive Metamorphosis (level 12): a burst around the new form, friends included
            const adjFoes = foes.filter((g) => inReach(me.rect, g.rect, 5));
            const adjAllies = board.allies.filter((a) => inReach(me.rect, a.rect, 5));
            if (has(actor, "explosive-metamorphosis") && left >= 1 && adjFoes.length && !adjAllies.length) {
                const dc = (board.spells ?? []).find((sp) => sp.dc)?.dc ?? 10 + lv + 4;
                const burst = adjFoes.reduce((t, g) => t + saveExpected(g.saves?.reflex ?? lv + 5, dc, 3.5 * best.t.rank, { basic: true }).expected, 0);
                steps.unshift({ cost: 1, text: `Explosive Metamorphosis first: ${best.t.rank}d6 energy to ${adjFoes.map(nameOf).join(", ")} around you (basic Reflex DC ${dc})` });
                ev += burst; left -= 1;
            }
            if (left >= 1 && inReachNow) {
                const e = strikeExpected(best.atk, f.ac, best.t.avg);
                steps.push({ cost: 1, text: `Strike ${nameOf(f)} with the form (${signed(best.atk)}, hits about ${pct(e.hit)})` });
                ev += e.expected;
            } else if (left >= 1) steps.push({ cost: left, text: `Stride toward ${nameOf(f)}; the form reaches ${best.t.reach} feet` });
            if (has(actor, "toppling-transformation") && best.t.reach >= 10 && adjFoes.length) { notes.push(`Toppling Transformation (reaction, as you grow): a free Trip or Shove on ${nameOf(nearest(adjFoes))}.`); ev += worth(board, "prone") * 0.4; }
            // The investment: each later turn is three form Strikes against the best two-action cast or three weapon Strikes
            const edge = best.turn - other;
            notes.push(`From the next turn, three Strikes in this form are worth about ${Math.round(best.turn)} a turn against ${nameOf(f)}; your best turn of a cantrip and a Strike, or of weapon Strikes, is about ${Math.round(other)}${cantrip ? ` (${cantrip.sp.name}: ${Math.round(cantrip.e)})` : ""}. ${edge > 0 ? "The form wins for the rest of the fight" : "Casting keeps up; take the form for the temporary HP, reach or mobility, not the damage"}; it lasts a minute, and you can't cast while in it.`);
            if (has(actor, "misty-transformation")) notes.push("Misty Transformation (reaction, once a minute): a concealing mist around you as you change.");
            if (best.t.breath) notes.push(`The form's breath (2 actions, basic save, about ${best.t.breath} in a cone) is its best opener, then 1d4 rounds to recharge.`);
            ev += Math.max(0, edge) * 0.5;
            out.plans.push({ kind: "class", title: `Untamed Form: ${best.fm.name} against ${nameOf(f)}`, target: f, ev, score: ev + 0.3, dest: null, steps, notes });
            break; // one plan: the shape is the same whichever foe; the advisor's Strike plans take it from here
        }
        if (has(actor, "true-shapeshifter") && lv >= 20) out.notes.push("True Shapeshifter (once a day): cast nature incarnate as a kaiju without preparing it, no Focus Point or slot; for the fight that decides the day.");
        if (shapes.length && has(actor, "form-control")) out.notes.push(`Form Control (1 action before Untamed Form): the form at rank ${Math.max(1, rank - 2)} for ${has(actor, "perfect-form-control") ? "as long as you like" : "an hour"}: for the trek, not this fight.`);
        if (shapes.length && has(actor, "bizarre-transformation")) out.notes.push("Bizarre Transformation (1 action before Untamed Form): the form's Strike deals acid, cold, electricity, fire or poison instead; pick what the foe is weak to or can't resist.");
        if (shapes.length && has(actor, "reactive-transformation")) out.notes.push("Reactive Transformation (reaction): a fall, or fire, poison or bludgeoning damage, puts you in a form that resists it.");
    }

    /* ---------------------------------------------------------------- Untamed Shift: claws for a minute */
    const shift = spellNamed(/^(untamed shift|wild morph)$/i);
    const shifted = !!effect(actor, /untamed-shift|wild-morph/);
    if (shift && !shifted && focus > 0 && ctx.actions >= 2 && foes.length && !inForm) {
        const str = actor.system?.abilities?.str?.mod ?? 0;
        const bleed = shift.rank >= 10 ? 14 : shift.rank >= 6 ? 7 : 0;
        const claw = { label: "claws", bonus: unarmedBonus(board), avg: 3.5 + str + bleed * 1.5, agile: true, ranged: false, reach: 5, traits: ["unarmed", "agile", "finesse"] };
        const f = nearest(foes.filter((g) => inReach(me.rect, g.rect, 5)));
        if (f) {
            let ev = 0, made = ctx.made;
            const shown = [];
            for (let i = 0; i < ctx.actions - 1; i++) { const b = claw.bonus + mapFor(made, true); ev += strikeExpected(b, f.ac, claw.avg).expected; shown.push(signed(b)); made += 1; }
            const own = strikeRun(board, f, ctx.actions - 1, { made: ctx.made }).ev;
            if (ev > own + 1 || bleed) out.plans.push({ kind: "class", title: `Untamed Shift, then claw ${nameOf(f)}`, target: f, ev, score: ev + 0.2, dest: null,
                steps: [{ cost: 1, text: `Untamed Shift (1 Focus Point): claws, 1d6${str ? signed(str) : ""} slashing, agile and finesse${bleed ? `, ${shift.rank >= 10 ? "4d6" : "2d6"} persistent bleed on a hit` : ""}, for a minute` }, { cost: ctx.actions - 1, text: `Strike ${nameOf(f)} with the claws${ctx.actions - 1 > 1 ? ` ${ctx.actions - 1 === 2 ? "twice" : "three times"}` : ""} (${shown.join(", ")})` }],
                notes: [has(actor, "plant-shape") ? "Or vines: reach 10 feet for a minute, the same spell." : "A morph, not a battle form: you keep your spells and your hands."] });
        }
        if (shift.rank >= 6) out.notes.push("Untamed Shift at this rank gives two effects at once: claws with bleed, jaws with poison, elemental skin, vines for reach, or wings (2 actions).");
    }

    /* ---------------------------------------------------------------- summons: classes/minions.mjs plans the cast and the Sustain */
    const summons = castable(board, (sp) => /^summon\b/i.test(sp.name ?? "") && !sp.cantrip && sp.cost === 3);
    const active = summonedAlly(board);
    if (!summons.length && !active && (has(actor, "call-of-the-wild") || has(actor, "elemental-summons"))) out.notes.push(`${has(actor, "call-of-the-wild") ? "Call of the Wild" : "Elemental Summons"}: between fights, 10 minutes turns a prepared spell into a summon of the same rank.`);

    /* ---------------------------------------------------------------- spellshapes and the rest: when they matter */
    if (has(actor, "thunderclap-spell") && castable(board, (sp) => (sp.traits ?? []).includes("electricity") && sp.save).length) out.notes.push("Thunderclap Spell (1 action before an electricity save spell): foes that fail are deafened a round, and a critical failure knocks them prone.");
    if (has(actor, "current-spell") && castable(board, (sp) => ["air", "water"].some((t) => (sp.traits ?? []).includes(t))).length) out.notes.push("Current Spell (1 action before an air or water spell): +1 AC (+2 against ranged) until your next turn.");
    if (has(actor, "snowdrift-spell") && castable(board, (sp) => ["air", "water", "cold"].some((t) => (sp.traits ?? []).includes(t)) && !(sp.traits ?? []).includes("fire")).length) out.notes.push("Snowdrift Spell (1 action before an air, water or cold spell): the squares around one target fill with snow, difficult terrain until your next turn; use it on a foe you want held off your allies.");
    if (has(actor, "garland-spell") && castable(board, (sp) => ["plant", "fungus"].some((t) => (sp.traits ?? []).includes(t))).length) out.notes.push(`Garland Spell (1 action before a plant or fungus spell): a patch of thorns in the spell's range, difficult and hazardous terrain for ${lv >= 20 ? "4d6" : lv >= 16 ? "3d6" : "2d6"} a turn to anything that moves through it, for a minute.`);
    if (has(actor, "sow-spell") && ctx.actions >= 2) out.notes.push("Sow Spell (1 action): plant a 1- or 2-action spell in an adjacent square; it goes off as a reaction when something steps next to it within 10 minutes. A trap for a foe about to charge you.");
    if (has(actor, "cryptic-spell")) out.notes.push("Cryptic Spell (1 action, in natural terrain): your next spell is subtle, so a foe can't tell you cast it.");
    if (has(actor, "purifying-spell") && spellNamed(/^heal$/i)) out.notes.push("Purifying Spell (1 action before Heal on one creature): also counteracts a poison or disease on them.");
    if (has(actor, "ley-line-conduit") || has(actor, "leyline-conduit")) {
        const pick = castable(board, (sp) => !sp.cantrip && (sp.rank ?? 1) <= 5 && sp.avg > 0 && !sp.buff && !sp.heals).sort((a, b) => b.avg - a.avg)[0];
        out.notes.push(`Ley Line Conduit (1 action, once a minute): the next rank 5 or lower spell with no duration costs no slot${pick ? `; ${pick.name} (rank ${pick.rank}) is the one to use it on` : ""}.`);
    }
    if (has(actor, "hierophants-power") || has(actor, "primal-wellspring")) {
        const tens = (board.spells ?? []).filter((sp) => !sp.cantrip && sp.rank === 10 && !(sp.traits ?? []).includes("focus"));
        out.notes.push(`Two 10th-rank slots (Hierophant's Power): ${tens.length ? tens.map((sp) => sp.name).join(" and ") + " still prepared" : "both spent"}.`);
    }
    if (has(actor, "raise-menhir") && ctx.actions >= 2 && foes.some((f) => f.caster)) out.notes.push("Raise Menhir (2 actions, once an hour): +2 to the party's saves against one tradition within 15 feet of the stone for a minute of Sustaining; worth it against a caster whose tradition you know.");
    if (has(actor, "deimatic-display") && ctx.actions >= 1 && foes.length > 1) out.notes.push(`Deimatic Display (1 action): one Intimidation check to Demoralize every foe within 30 feet, +2 against animals, plants and fungi and -2 against the rest; ${foes.filter((f) => feetBetween(me.rect, f.rect) <= 30 && !f.conditions?.has?.("frightened")).length} in range and unfrightened.`);
    if (has(actor, "harden-flesh") && ctx.actions >= 1 && foes.some((f) => inReach(f.rect, me.rect, f.reach ?? 5))) out.notes.push(`Harden Flesh (1 action, on earth or stone): resistance ${Math.min(6, 3 + Math.floor(Math.max(0, lv - 8) / 4))} to physical damage until your next turn, with a foe already on you.`);
    if (has(actor, "pristine-weapon")) out.notes.push("Pristine Weapon: your verdant weapon counts as cold iron and silver; a critical hit on a foe weak to either slows its healing.");
    if (has(actor, "storm-born")) out.notes.push("Storm Born: weather and fog don't penalize your ranged spell attacks or force flat checks on your targeted spells.");
    if (has(actor, "storm-retribution")) out.notes.push(`Storm Retribution (reaction, 1 Focus Point): when an adjacent foe critically hits you in melee, Tempest Surge hits it back and pushes it 5 feet on a failed save${focus !== null && focus <= 0 ? "; no point left for it now" : ""}.`);
    if (has(actor, "fiery-retort")) out.notes.push(`Fiery Retort (reaction, once a minute): an adjacent foe that hits you in melee takes ${lv} fire.`);
    if (has(actor, "wild-willpower") || lv >= 11) { /* Will master, success to critical success: a save, nothing to plan */ }
    if (has(actor, "primal-aegis")) out.notes.push(`Primal Aegis: you and allies within 30 feet resist acid, cold, electricity, fire, vitality and void ${actor.system?.abilities?.wis?.mod ?? 4}.`);
    if ((has(actor, "animal-empathy") || has(actor, "wild-empathy")) && foes.some((f) => (f.traits ?? []).includes("animal"))) out.notes.push(`Animal Empathy: ${foes.filter((f) => (f.traits ?? []).includes("animal")).map(nameOf).join(", ")} can be talked to; Diplomacy may end this without a fight if it isn't someone's trained beast.`);
    if (has(actor, "plant-empathy") && foes.some((f) => ["plant", "fungus"].some((t) => (f.traits ?? []).includes(t)))) out.notes.push("Plant Empathy: the plant or fungus foe can be spoken to and asked to stand down.");
    if (has(actor, "floral-restoration") && focus !== null && focus > 0 && me.hp < me.maxHp * 0.5) out.notes.push(`Floral Restoration (1 action, once a day, among plants): 1 Focus Point and about ${Math.round(4.5 * (1 + Math.floor(Math.max(0, lv - 7) / 2)))} HP.`);
    if (me.shield && has(actor, "shield-block")) out.notes.push("Shield Block (reaction): with your shield raised, the first hit on you loses the shield's Hardness; raise it when a foe is on you and you have a spare action.");
    const sustainers = castable(board, (sp) => /^(impaling briars|invoke disaster|wildfire|mushroom patch|hedge prison|fungal exhalation)$/i.test(sp.name ?? ""));
    if (sustainers.length) out.notes.push(`${sustainers.map((sp) => sp.name).join(", ")}: focus spells that keep going each turn you Sustain them; cast one only on a turn you can spare the action afterwards.`);
}

export { druid };
