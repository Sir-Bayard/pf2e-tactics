/**
 * PF2e Tactics: classes/monk.mjs
 * See classes/_common.mjs for the shape of a class read.
 * Reads Flurry of Blows (two Strikes for one action, with Stunning Blows, Flurry of Maneuvers, Stumbling Feint and Inner
 * Upheaval on it), the stances (which one is up from the sheet's stance-* effect; a stance's Strikes synthesized from a table
 * when it isn't up, like the barbarian's animal instinct), the stance feats that compose a turn (Tiger Slash, Wolf Drag,
 * Dragon Roar, Gorilla Pound, Mountain Quake, Wild Winds Gust), the grab feats (Whirling Throw, Sleeper Hold, Wave Dashes
 * Rocks), Flying Kick, Knockback Strike, One-Inch Punch, Disrupt Qi, Flinging Blow, Shattering Strike, Mixed Maneuver, and
 * Perfected Form on the first Strike. Qi spells are the advisor's where they're a spell (Qi Blast, Harmonize Self, Shadow's
 * Web...); the focus pool and the ones that compose with a Strike are read here. The rest are when-notes.
 */
import { effect, focusLeft, has, level, moveText, pct, slugOf, squareToReach, targets, worth, degreeChances, feetBetween, inReach, mapFor, strikeExpected, saveExpected, nameOf, signed } from "./_common.mjs";

/** Foundry's slugs drop apostrophes ("hunters-aim"); the catalog's keep a dash for them ("hunter-s-aim"). Both are tried. */
const hasAny = (actor, ...slugs) => slugs.some((s) => has(actor, s));
const abil = (actor, k) => Number(actor?.abilities?.[k]?.mod ?? actor?.system?.abilities?.[k]?.mod) || 0;
const classDC = (actor, lv) => Number(actor?.classDC?.value ?? actor?.system?.attributes?.classDC?.value) || 10 + lv + 4 + (lv >= 17 ? 6 : lv >= 9 ? 4 : 2);
const times = (n) => (n === 1 ? "" : n === 2 ? " twice" : n === 3 ? " three times" : ` ${n} times`);
const strikeText = (f, used) => `Strike ${nameOf(f)} with ${used[0].s.label}${times(used.length)} (${used.map((u) => signed(u.bonus)).join(", ")})`;
const r1 = (n) => Math.round(n * 10) / 10;

/**
 * The stances and the Strikes they give. die: the damage die; agile/finesse; only: the stance allows no other Strike
 * (the sheet replaces them all while it's up); reach 10 for a reach attack; range for a ranged one; deadly/fatal dice;
 * spell: entered by casting a qi spell (1 Focus Point); def: a rough worth of the stance's defence, in damage per level/5.
 * benefit: what entering it gives, for the step text.
 */
const STANCES = {
    "crane-stance": { name: "Crane Stance", label: "Crane wing", die: 6, agile: true, finesse: true, only: true, def: 1.5, benefit: "+1 circumstance bonus to AC; crane wing 1d6, agile, finesse" },
    "dragon-stance": { name: "Dragon Stance", label: "Dragon tail", die: 10, def: 0, benefit: "dragon tail 1d10 with backswing; ignore the first square of difficult terrain when you Stride" },
    "flood-stance": { name: "Flood Stance", label: "Flooded river", die: 8, only: true, def: 0, benefit: "flooded river 1d8 with trip, no penalty underwater; hold your breath while it lasts" },
    "gorilla-stance": { name: "Gorilla Stance", label: "Gorilla slam", die: 8, only: true, def: 0, benefit: "gorilla slam 1d8 with backswing, forceful and grapple; +2 to Climb" },
    "mountain-stance": { name: "Mountain Stance", label: "Falling stone", die: 8, only: true, def: 4, ground: true, benefit: "+4 item bonus to AC (in place of your clothing's rune) and +2 against Shove, Trip and forced movement, but no Dexterity to AC and -5 Speed; falling stone 1d8 with forceful" },
    "rain-of-embers-stance": { name: "Rain of Embers Stance", label: "Fire talon", die: 4, agile: true, finesse: true, only: true, def: 1.5, fire: true, benefit: "+1 status bonus to AC and fire resistance; fire talon 1d4 fire, agile, finesse" },
    "reflective-ripple-stance": { name: "Reflective Ripple Stance", label: "Flowing wave", die: 6, agile: true, finesse: true, def: 0.5, benefit: "flowing wave 1d6 with disarm and trip, agile, finesse; +1 to Trip and Disarm" },
    "rushing-goat-stance": { name: "Rushing Goat Stance", label: "Ramming horn", die: 8, only: true, def: 0, benefit: "ramming horn 1d8 with forceful and shove; after a Stride, Climb or Leap it adds its dice count to damage" },
    "stoked-flame-stance": { name: "Stoked Flame Stance", label: "Flashing spark", die: 8, def: 0, benefit: "flashing spark 1d8 slashing with forceful and sweep; +5 feet Speed (+15 with Incredible Movement)" },
    "stumbling-stance": { name: "Stumbling Stance", label: "Stumbling swing", die: 8, agile: true, finesse: true, only: true, def: 0.5, benefit: "stumbling swing 1d8 with backstabber, agile, finesse; a foe that hits you is off-guard to your next swing" },
    "tiger-stance": { name: "Tiger Stance", label: "Tiger claw", die: 8, agile: true, finesse: true, def: 0, benefit: "tiger claw 1d8 slashing, agile, finesse, 1d4 persistent bleed on a critical hit; Step 10 feet" },
    "twisting-petal-stance": { name: "Twisting Petal Stance", label: "Gale blossom", die: 6, agile: true, finesse: true, def: 0.5, benefit: "gale blossom 1d6 slashing with shove, agile, finesse; +1 to Shove and Feint" },
    "wolf-stance": { name: "Wolf Stance", label: "Wolf jaw", die: 8, agile: true, finesse: true, def: 0, benefit: "wolf jaw 1d8 piercing with backstabber, agile, finesse; trip too while you flank" },
    "cobra-stance": { name: "Cobra Stance", label: "Cobra fang", die: 4, agile: true, finesse: true, only: true, deadly: 10, def: 0.5, benefit: "cobra fang 1d4 piercing, agile, finesse, deadly d10, venomous; +1 Fortitude and poison resistance" },
    "ironblood-stance": { name: "Ironblood Stance", label: "Iron sweep", die: 8, def: 2, benefit: "resistance to all damage (2, 3 at 12th, 4 at 16th, 5 at 20th); iron sweep 1d8 with parry and sweep" },
    "jellyfish-stance": { name: "Jellyfish Stance", label: "Stinging lash", die: 6, finesse: true, reach: 10, def: 0.5, benefit: "stinging lash 1d6 slashing with reach, finesse; +2 Reflex and to Escape" },
    "kaiju-stance": { name: "Kaiju Stance", label: "Shattering earth", die: 8, only: true, reach: 10, fatal: 12, def: 0, benefit: "you're Large and clumsy 1; shattering earth 1d8 with reach, backswing and fatal d12; you ignore difficult terrain" },
    "tangled-forest-stance": { name: "Tangled Forest Stance", label: "Lashing branch", die: 8, agile: true, finesse: true, def: 0.5, benefit: "lashing branch 1d8 slashing, agile, finesse; foes in reach save against your class DC to move away" },
    "vitality-manipulating-stance": { name: "Vitality-Manipulating Stance", label: "Vitality blast", die: 4, range: 30, def: 0, benefit: "vitality blast 1d4 void or vitality at 30 feet; Stunning Blows can enfeeble 2 instead of stun" },
    "wild-winds-stance": { name: "Wild Winds Stance", label: "Wind crash", die: 6, agile: true, range: 30, propulsive: true, spell: true, def: 1, benefit: "wind crash 1d6 at 30 feet, agile, ignoring concealment and cover; +2 AC against ranged attacks" },
    "clinging-shadows-stance": { name: "Clinging Shadows Stance", label: "Shadow grasp", die: 4, agile: true, reach: 10, spell: true, def: 0, benefit: "shadow grasp 1d4 void with reach and grapple, agile; +2 to Grapple" },
};
/** Stances the character knows by a feat other than the stance's own slug. */
const STANCE_BY = { "wild-winds-stance": ["wild-winds-initiate"], "clinging-shadows-stance": ["clinging-shadows-initiate"] };
/** Stances without a Strike of their own: the read notes them, the sheet carries their effect. */
const OTHER_STANCES = ["monastic-archer-stance", "shooting-stars-stance", "waterfowl-stance", "peafowl-stance", "asp-stance", "whirling-blade-stance"];

/** Attack-roll chances when a die below 10 counts as 10 (Perfected Form on the first Strike of the turn). */
function chancesPerfected(mod, dc) {
    const out = { cs: 0, s: 0, f: 0, cf: 0 };
    const order = ["cf", "f", "s", "cs"];
    for (let r = 1; r <= 20; r++) {
        const roll = r < 10 ? 10 : r;
        const total = roll + mod;
        let d = total >= dc + 10 ? 3 : total >= dc ? 2 : total <= dc - 10 ? 0 : 1;
        if (r === 20) d = Math.min(3, d + 1);
        out[order[d]] += 0.05;
    }
    return out;
}
function expectPerfected(bonus, ac, avg, deadly = 0) {
    const c = chancesPerfected(bonus, ac);
    return { hit: c.s + c.cs, crit: c.cs, expected: c.s * avg + c.cs * (avg * 2 + deadly) };
}

function monk(board, ctx, out) {
    const actor = board.me.actor;
    const me = board.me;
    const lv = level(board);
    const own = (actor?.class?.slug ?? "") === "monk";
    const foes = targets(board);
    const str = abil(actor, "str"), dex = abil(actor, "dex"), wis = abil(actor, "wis");
    const dc = classDC(actor, lv);
    const n = (t) => out.notes.push(t);
    const push = (plan) => out.plans.push({ kind: "class", dest: null, notes: [], ...plan, score: plan.ev + (plan.bias ?? 0.3) });
    const spellItems = (actor?.items ?? []).filter((i) => i.type === "spell");
    const knowsSpell = (re) => (board.spells ?? []).some((sp) => re.test(sp.name ?? "")) || spellItems.some((i) => re.test(i.name ?? ""));
    const spellOf = (re) => (board.spells ?? []).find((sp) => re.test(sp.name ?? "")) ?? null;
    const focus = focusLeft(actor);

    // ---- the gate within the gate: a dedication monk with only Powerful Fist has nothing to read yet
    const flurryItem = actor?.items?.find?.((i) => ["feat", "action"].includes(i.type) && ["flurry-of-blows", "monks-flurry", "monk-s-flurry"].includes(slugOf(i)));
    const flurryKnown = !!flurryItem;
    const known = Object.keys(STANCES).filter((k) => has(actor, k) || (STANCE_BY[k] ?? []).some((f) => has(actor, f)));
    const otherKnown = OTHER_STANCES.filter((k) => has(actor, k));
    if (!own && !flurryKnown && !known.length && !otherKnown.length) return;

    // ---- the stance that's up, from the sheet's effect
    const stanceFx = effect(actor, /^stance-/);
    const stance = stanceFx ? slugOf(stanceFx).replace(/^stance-/, "") : null;
    const inStance = (k) => stance === k;
    const unarmored = !actor?.wornArmor && !actor?.items?.some?.((i) => i.type === "armor" && (i.isEquipped ?? i.system?.equipped?.inSlot) && (i.system?.category ?? "unarmored") !== "unarmored");
    const monastic = has(actor, "monastic-weaponry");
    const speed = (() => {
        const sheet = Number(actor?.system?.movement?.speeds?.land?.value ?? actor?.system?.attributes?.speed?.total ?? actor?.attributes?.speed?.total) || 0;
        if (sheet) return sheet;
        let s = 25;
        if (has(actor, "incredible-movement") && unarmored) s += inStance("stoked-flame-stance") ? 15 + 5 * Math.floor((lv - 3) / 4) : 10 + 5 * Math.floor((lv - 3) / 4);
        else if (has(actor, "monk-moves") && unarmored) s += 10;
        if (inStance("mountain-stance")) s -= 5;
        return s;
    })();

    // ---- Monk's Flurry (archetype) recharges 1d4 rounds; the sheet's recharge is what's known
    const recharging = flurryItem && slugOf(flurryItem) !== "flurry-of-blows" ? (board.rechargeLeft?.({ item: flurryItem }) ?? 0) : 0;
    const flurry = flurryKnown && !recharging;
    const stunning = hasAny(actor, "stunning-blows", "stunning-fist");
    const perfected = has(actor, "perfected-form");
    const brawlingCrit = has(actor, "brawling-focus") || (own && lv >= 5) || has(actor, "expert-strikes");
    // Enduring Quickness (20): the sheet carries quickened, and the advisor counts it; the extra action is a Stride or a Leap only
    const quickEQ = has(actor, "enduring-quickness") && me.conditions?.has?.("quickened");
    const strikeActs = quickEQ ? Math.min(ctx.actions, 3) : ctx.actions;

    // ---- the Strikes a monk feat may use: unarmed, monk weapons with Monastic Weaponry, the stance's ranged allowances
    const monkStrike = (s) => !!s.traits?.includes("unarmed") || (monastic && !!s.traits?.includes("monk"))
        || (inStance("shooting-stars-stance") && /shuriken/i.test(s.label)) || (inStance("monastic-archer-stance") && s.ranged && /bow/i.test(s.label));
    const flurryRange = (s) => (inStance("monastic-archer-stance") && /bow/i.test(s.label) ? Math.floor((s.range ?? 60) / 2) : s.range ?? 30);
    const reaches = (s, at, f) => (s.ranged ? feetBetween(at, f.rect) <= flurryRange(s) : inReach(at, f.rect, s.reach || 5));
    const pool = board.strikes.filter(monkStrike);
    const reach = Math.max(5, ...pool.filter((s) => !s.ranged).map((s) => s.reach || 5));
    /** The fist, for the dice and the flat damage a stance's Strike inherits. */
    const fist = pool.find((s) => /fist/i.test(s.label) && !s.ranged) ?? pool.find((s) => !s.ranged && s.traits?.includes("unarmed")) ?? pool.find((s) => !s.ranged) ?? null;
    const dice = Number(fist?.item?.system?.damage?.dice) || (lv >= 19 ? 4 : lv >= 12 ? 3 : lv >= 4 ? 2 : 1);
    const fistDie = Number(String(fist?.item?.system?.damage?.die ?? "d6").replace("d", "")) || 6;
    const flat = fist ? Math.max(0, fist.avg - dice * (fistDie + 1) / 2) : str + (lv >= 15 ? 4 : lv >= 7 ? 2 : 0);
    const fistBonus = fist?.bonus ?? lv + 4 + Math.max(str, dex) + (lv >= 13 ? 4 : lv >= 5 ? 2 : 0);
    const deadlyDice = dice >= 4 ? 3 : dice >= 3 ? 2 : 1;
    /** A stance's Strike built from the table: the fist's dice and bonus, Strength without finesse, half Strength if propulsive. */
    const synth = (k) => {
        const t = STANCES[k];
        const bonus = t.finesse || t.range ? fistBonus : fistBonus - Math.max(0, dex - str);
        const avg = dice * (t.die + 1) / 2 + (t.range ? (t.propulsive ? Math.floor(Math.max(0, str) / 2) : 0) : flat);
        const deadly = t.deadly ? deadlyDice * (t.deadly + 1) / 2 : t.fatal ? (t.fatal + 1) / 2 + dice * ((t.fatal + 1) / 2 - (t.die + 1) / 2) : 0;
        return { label: t.label, bonus, avg, agile: !!t.agile, ranged: !!t.range, range: t.range ?? null, reach: t.reach ?? 5, traits: ["unarmed", ...(t.agile ? ["agile"] : []), ...(t.finesse ? ["finesse"] : [])], deadly, synthetic: true, stance: k };
    };
    const poolIn = (k) => (STANCES[k].only ? [synth(k)] : [...pool, synth(k)]);

    /** Brawling critical specialization: slowed 1 until the end of its next turn unless it saves (Fortitude against your class DC). */
    const critWorth = (s, f) => (brawlingCrit && s.traits?.includes("unarmed") ? degreeChances(f.saves?.fortitude ?? 0, dc).f + degreeChances(f.saves?.fortitude ?? 0, dc).cf : 0) * worth(board, "slowed", 0.3);
    /**
     * A run of Strikes at f from the pool given, the penalty climbing. extra: flat damage on each; firstExtra: on the first only;
     * atkAdj: on the attack roll; acAdj: on f's AC. Perfected Form shapes the turn's first Strike.
     */
    const run = (f, count, made, { at = me.rect, from = pool, extra = 0, firstExtra = 0, atkAdj = 0, acAdj = 0, pick = () => true } = {}) => {
        const used = [];
        let ev = 0;
        for (let i = 0; i < count; i++) {
            let best = null;
            for (const s of from.filter(pick)) {
                if (!reaches(s, at, f)) continue;
                const b = s.bonus + atkAdj + mapFor(made + used.length, s.agile);
                const dmg = s.avg + extra + (i === 0 ? firstExtra : 0);
                const e = perfected && made + used.length === 0 ? expectPerfected(b, f.ac + acAdj, dmg, s.deadly) : strikeExpected(b, f.ac + acAdj, dmg, { deadly: s.deadly });
                const v = e.expected + e.crit * critWorth(s, f);
                if (!best || v > best.v) best = { s, bonus: b, e, v };
            }
            if (!best) break;
            used.push(best); ev += best.v;
        }
        return { used, ev };
    };
    /** A square from which f is in reach, within what the turn can spare after `cost` actions; the extra quickened action may carry the move. */
    const approach = (f, cost, { from = pool } = {}) => {
        if (strikeActs < cost) return null;
        const r = Math.max(5, ...from.filter((s) => !s.ranged).map((s) => s.reach || 5));
        const ranged = from.some((s) => s.ranged && feetBetween(me.rect, f.rect) <= flurryRange(s));
        const sq = ranged ? { x: me.rect.x, y: me.rect.y, route: { actions: 0, provokes: [], via: null } } : squareToReach(board, f, r, ctx.actions - cost);
        if (!sq) return null;
        const moveActs = sq.route.actions;
        const left = Math.min(strikeActs - cost, ctx.actions - cost - moveActs);
        if (left < 0) return null;
        return { sq, moveActs, left, at: moveActs ? { ...me.rect, x: sq.x, y: sq.y } : me.rect, dest: moveActs ? { x: sq.x, y: sq.y } : null };
    };
    const moveStep = (a, f) => (a.moveActs ? [{ cost: a.moveActs, text: moveText(a.sq, f) }] : []);
    /** Stunning Blows on a Flurry at f: either Strike hitting makes it save; incapacitation gives a higher-level foe a degree. */
    const stunOf = (f, used) => {
        if (!stunning || used.length < 2) return { ev: 0, text: "" };
        const pHit = 1 - (1 - used[0].e.hit) * (1 - used[1].e.hit);
        const c = degreeChances(f.saves?.fortitude ?? 0, dc, (f.level ?? lv) > lv ? 1 : 0);
        const ev = pHit * (c.f * worth(board, "stunned", 0.5) + c.cf * worth(board, "stunned", 1.2));
        const alt = inStance("vitality-manipulating-stance") ? " (or enfeebled 2 instead, your choice before it rolls)" : "";
        return { ev, text: `; Stunning Blows: if either hits, Fortitude DC ${dc} or stunned 1 (3 on a critical failure${alt})${(f.level ?? lv) > lv ? "; incapacitation, it's above your level" : ""} (${pct(pHit * (c.f + c.cf))})` };
    };
    const flurryText = (f, used) => `Flurry of Blows: Strike ${nameOf(f)} with ${used.length === 2 && used[0].s.label !== used[1].s.label ? `${used[0].s.label} and ${used[1].s.label}` : `${used[0].s.label}${times(used.length)}`} (${used.map((u) => signed(u.bonus)).join(", ")})`;
    const upheaval = spellOf(/^(inner upheaval|ki strike)$/i);
    const upheavalDice = upheaval ? 1 + Math.floor(((upheaval.rank ?? 1) - 1) / 4) : 0;
    const feintable = inStance("stumbling-stance") && has(actor, "stumbling-feint") && me.deception != null;
    const pFeint = (f) => (feintable ? (() => { const c = degreeChances(me.deception + 1, 10 + (f.saves?.will ?? 0)); return c.s + c.cs; })() : 0);

    // ---- Flurry of Blows (1 action, flourish): two Strikes, then the rest of the turn's Strikes
    const flurryPlans = (from, k = null, extraSteps = [], extraEv = 0, cost = 0) => {
        for (const f of foes) {
            const a = approach(f, cost + 1, { from });
            if (!a) continue;
            const feint = pFeint(f);
            const r = run(f, 2, ctx.made, { at: a.at, from, acAdj: -2 * feint });
            if (!r.used.length) continue;
            const st = stunOf(f, r.used);
            const rest = run(f, a.left, ctx.made + r.used.length, { at: a.at, from });
            const steps = [...extraSteps, ...moveStep(a, f)];
            if (feint) steps.push({ cost: 0, text: `Stumbling Feint (free): Feint ${nameOf(f)} with Deception ${signed(me.deception + 1)} (${pct(feint)}); a success makes it off-guard to both Strikes` });
            steps.push({ cost: 1, text: `${flurryText(f, r.used)}${st.text}` });
            if (rest.used.length) steps.push({ cost: rest.used.length, text: strikeText(f, rest.used) });
            const notes = [];
            if (inStance("asp-stance") && r.used.length === 2) notes.push("Asp Stance: a critical hit in the Flurry leaves it sickened 1.");
            if (recharging === 0 && slugOf(flurryItem) !== "flurry-of-blows") notes.push("Monk's Flurry: once used, Flurry recharges 1d4 rounds.");
            push({ title: `${k ? `${STANCES[k].name}, then ` : ""}Flurry of Blows at ${nameOf(f)}`, target: f, ev: r.ev + st.ev + rest.ev + extraEv, bias: k ? 0.25 : 0.35, dest: a.dest, steps, notes });
            // Inner Upheaval (1 action, 1 Focus Point): the Flurry with +1 to hit and extra dice on each Strike, for the same action
            if (!k && upheaval && focus > 0 && cost === 0) {
                const u = run(f, 2, ctx.made, { at: a.at, from, atkAdj: 1, extra: upheavalDice * 3.5, acAdj: -2 * feint });
                if (u.used.length) {
                    const su = stunOf(f, u.used);
                    const ur = run(f, a.left, ctx.made + u.used.length, { at: a.at, from });
                    const usteps = [...moveStep(a, f)];
                    if (feint) usteps.push({ cost: 0, text: `Stumbling Feint (free): Feint ${nameOf(f)} first (${pct(feint)})` });
                    usteps.push({ cost: 1, text: `Inner Upheaval (1 Focus Point): ${flurryText(f, u.used)}, +1 to hit and +${upheavalDice}d6 force, spirit, vitality or void on each${has(actor, "elemental-fist") ? " (or an element's damage with Elemental Fist)" : ""}${su.text}` });
                    if (ur.used.length) usteps.push({ cost: ur.used.length, text: strikeText(f, ur.used) });
                    push({ title: `Inner Upheaval: Flurry at ${nameOf(f)}`, target: f, ev: u.ev + su.ev + ur.ev, bias: 0.4, dest: a.dest, steps: usteps, notes: [`${focus} Focus Point${focus === 1 ? "" : "s"} left; the spell's Flurry is this turn's flourish.`] });
                }
            }
            // Flurry of Maneuvers (4): a Trip in place of the first Strike, then the second against it prone
            if (!k && has(actor, "flurry-of-maneuvers") && me.athletics != null && cost === 0 && !f.conditions?.has?.("prone") && (f.sizeRank ?? 2) <= (me.sizeRank ?? 2) + 1 && !a.moveActs) {
                const tb = me.athletics + mapFor(ctx.made, false);
                const c = degreeChances(tb, 10 + (f.saves?.reflex ?? 0));
                const pTrip = c.s + c.cs;
                const second = run(f, 1, ctx.made + 1, { at: a.at, from, acAdj: -2 * pTrip });
                if (second.used.length) {
                    const rest2 = run(f, a.left, ctx.made + 2, { at: a.at, from, acAdj: -2 * pTrip });
                    const ev = pTrip * worth(board, "prone") + second.ev + rest2.ev;
                    const steps = [{ cost: 1, text: `Flurry of Maneuvers: Trip ${nameOf(f)} with Athletics ${signed(tb)} against its Reflex DC (${pct(pTrip)}), then ${strikeText(f, second.used)} while it's prone` }];
                    if (rest2.used.length) steps.push({ cost: rest2.used.length, text: strikeText(f, rest2.used) });
                    push({ title: `Flurry of Maneuvers: Trip ${nameOf(f)}, then Strike`, target: f, ev, bias: 0.2, steps, notes: ["Grapple, Shove or Reposition can take a Strike's place in the Flurry instead; both maneuvers count toward your penalty."] });
                }
            }
        }
    };
    if (flurry && strikeActs >= 1) flurryPlans(pool);
    else if (flurryKnown && recharging) n(`Monk's Flurry is recharging (${recharging} more round${recharging === 1 ? "" : "s"}).`);
    if (upheaval) board.spells = board.spells.filter((sp) => sp !== upheaval);

    // ---- enter a stance (1 action), then Flurry or Strike with its attacks; the best two stances by what the turn is worth
    if (!stance && known.length && strikeActs >= 2 && unarmored) {
        const before = out.plans.length;
        for (const k of known) {
            const t = STANCES[k];
            if (t.spell && !(focus > 0 || has(actor, "qi-center"))) continue;
            if (t.ground && me.conditions?.has?.("flying")) continue;
            const from = poolIn(k);
            const def = t.def * (0.5 + lv / 10);
            const entry = { cost: 1, text: `${t.spell ? `Cast ${t.name}${has(actor, "qi-center") ? " (free with Qi Center once a minute, no Focus Point)" : " (1 Focus Point)"}` : `Enter ${t.name}`}: ${t.benefit}` };
            if (flurry) flurryPlans(from, k, [entry], def, 1);
            else for (const f of foes) {
                const a = approach(f, 2, { from });
                if (!a) continue;
                const r = run(f, a.left + 1, ctx.made, { at: a.at, from });
                if (!r.used.length) continue;
                push({ title: `${t.name}, then Strike ${nameOf(f)}`, target: f, ev: r.ev + def, bias: 0.25, dest: a.dest, steps: [entry, ...moveStep(a, f), { cost: r.used.length, text: strikeText(f, r.used) }] });
            }
        }
        const added = out.plans.splice(before).sort((a, b) => b.score - a.score);
        out.plans.push(...added.slice(0, 2));
        if (added.length) n(`You're in no stance. ${known.length === 1 ? STANCES[known[0]].name : `Your stances: ${known.map((k) => STANCES[k].name).join(", ")}`}${otherKnown.length ? ` (and ${otherKnown.map((k) => k.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())).join(", ")})` : ""}; a stance lasts until you leave it or fall unconscious.${has(actor, "immortal-techniques") ? " Immortal Techniques: the first stance action each round gives you 20 temporary HP until your next turn, so re-entering one every round pays." : ""}`);
    } else if (!stance && known.length && !unarmored) n("Your stances need you unarmored.");
    if (stance && STANCES[stance]) {
        const t = STANCES[stance];
        n(`In ${t.name}: ${t.benefit}${t.only ? "; no other Strikes while it lasts" : ""}.${has(actor, "immortal-techniques") ? " Immortal Techniques: leaving and re-entering a stance (1 action) gives 20 temporary HP until your next turn." : ""}`);
    }
    if (has(actor, "fuse-stance")) n("Fuse Stance: your fused stance gives both stances' attacks and benefits at once; enter it as one stance action.");
    if (has(actor, "reflexive-stance") && !stance && typeof game !== "undefined" && game.combat?.round === 1) n("Reflexive Stance: you could have entered a stance for free when you rolled initiative; if you did, apply it now.");

    // ---- stance feats that compose a turn
    const basePool = pool;
    // Tiger Slash (2 actions, Tiger Stance): tiger claw with two extra dice (three at 14th), the foe pushed 5 feet
    if (has(actor, "tiger-slash") && inStance("tiger-stance") && strikeActs >= 2) {
        const extraDice = lv >= 14 ? 3 : 2;
        for (const f of foes) {
            const a = approach(f, 2); if (!a) continue;
            const r = run(f, 1, ctx.made, { at: a.at, extra: extraDice * 4.5, pick: (s) => /tiger claw/i.test(s.label) });
            if (!r.used.length) continue;
            const steps = [...moveStep(a, f), { cost: 2, text: `Tiger Slash ${nameOf(f)} with ${r.used[0].s.label} (${signed(r.used[0].bonus)}): +${extraDice}d8, and push it 5 feet if you like; on a critical hit the bleed gets +${str}` }];
            let ev = r.ev;
            if (a.left >= 1) { const rest = run(f, a.left, ctx.made + 1, { at: a.at }); if (rest.used.length) { steps.push({ cost: rest.used.length, text: `${strikeText(f, rest.used)} (if you didn't push it)` }); ev += rest.ev; } }
            push({ title: `Tiger Slash ${nameOf(f)}`, target: f, ev, dest: a.dest, steps, notes: ["Two actions for one Strike: a Flurry is usually more damage; Tiger Slash is for a push or a big single hit."] });
        }
    }
    // Wolf Drag (2 actions, Wolf Stance): wolf jaw with fatal d12; a hit knocks the foe prone
    if (has(actor, "wolf-drag") && inStance("wolf-stance") && strikeActs >= 2) {
        for (const f of foes) {
            const a = approach(f, 2); if (!a) continue;
            const jaw = pool.find((s) => /wolf jaw/i.test(s.label)); if (!jaw) continue;
            const fatal = { ...jaw, avg: jaw.avg + dice * 2, deadly: 6.5 };
            const r = run(f, 1, ctx.made, { at: a.at, from: [fatal] });
            if (!r.used.length) continue;
            const prone = f.conditions?.has?.("prone") ? 0 : r.used[0].e.hit * worth(board, "prone");
            const steps = [...moveStep(a, f), { cost: 2, text: `Wolf Drag ${nameOf(f)} with Wolf jaw (${signed(r.used[0].bonus)}), fatal d12; a hit knocks it prone` }];
            let ev = r.ev + prone;
            if (a.left >= 1) { const rest = run(f, a.left, ctx.made + 1, { at: a.at, acAdj: -2 * r.used[0].e.hit }); if (rest.used.length) { steps.push({ cost: rest.used.length, text: `${strikeText(f, rest.used)}, it off-guard if it's prone` }); ev += rest.ev; } }
            push({ title: `Wolf Drag ${nameOf(f)}`, target: f, ev, dest: a.dest, steps });
        }
    }
    // Dragon Roar (1 action, Dragon Stance): foes within 15 feet save against your Intimidation DC or are frightened; +4 on your first hit on one
    if (has(actor, "dragon-roar") && inStance("dragon-stance") && me.intimidation != null && strikeActs >= 1) {
        const item = actor.items.find((i) => slugOf(i) === "dragon-roar");
        const wait = board.rechargeLeft?.({ item }) ?? 0;
        const near = foes.filter((f) => feetBetween(me.rect, f.rect) <= 15);
        if (wait) n(`Dragon Roar is recharging (${wait} more round${wait === 1 ? "" : "s"}).`);
        else if (near.length) {
            const idc = 10 + me.intimidation;
            let ev = 0;
            const shown = [];
            const odds = new Map();
            for (const f of near) { const c = degreeChances(f.saves?.will ?? 0, idc); odds.set(f, c.f + c.cf); ev += c.f * worth(board, "frightened") + c.cf * worth(board, "frightened", 2); shown.push(`${nameOf(f)} (${pct(c.f + c.cf)})`); }
            const steps = [{ cost: 1, text: `Dragon Roar: ${shown.join(", ")} within 15 feet save against Will DC ${idc} or are frightened 1 (2 on a critical failure); it can't drop below 1 while adjacent to you` }];
            let target = near[0];
            if (strikeActs >= 2) {
                let best = null;
                for (const f of near.filter((x) => inReach(me.rect, x.rect, reach))) {
                    const p = odds.get(f);
                    const r = flurry ? run(f, 2, ctx.made, { firstExtra: 4 * p, acAdj: -p }) : run(f, 1, ctx.made, { firstExtra: 4 * p, acAdj: -p });
                    if (r.used.length && (!best || r.ev > best.r.ev)) best = { f, r };
                }
                if (best) {
                    const st = stunOf(best.f, best.r.used);
                    steps.push({ cost: 1, text: `${flurry && best.r.used.length === 2 ? flurryText(best.f, best.r.used) : strikeText(best.f, best.r.used)}; +4 damage on the first hit if it's frightened${st.text}` });
                    ev += best.r.ev + st.ev; target = best.f;
                    const rest = run(best.f, strikeActs - 2, ctx.made + best.r.used.length, { acAdj: -odds.get(best.f) });
                    if (rest.used.length) { steps.push({ cost: rest.used.length, text: strikeText(best.f, rest.used) }); ev += rest.ev; }
                }
            }
            push({ title: `Dragon Roar at ${near.length} foe${near.length === 1 ? "" : "s"}`, target, ev, bias: 0.35, steps, notes: ["Then 1d4 rounds before you can roar again; it ends if you leave Dragon Stance, and those foes are immune for a minute."] });
        }
    }
    // Gorilla Pound (1 action, flourish, Gorilla Stance): Demoralize, then a gorilla slam with +3 x its frightened value
    if (has(actor, "gorilla-pound") && inStance("gorilla-stance") && me.intimidation != null && strikeActs >= 1) {
        for (const f of foes.filter((x) => inReach(me.rect, x.rect, reach) && feetBetween(me.rect, x.rect) <= 30)) {
            const c = degreeChances(me.intimidation, 10 + (f.saves?.will ?? 0));
            const p = c.s + c.cs;
            const fr = (Number(f.conditionValues?.frightened) || 0) + 1;
            const r = run(f, 1, ctx.made, { extra: 3 * fr * p + 3 * (fr - 1) * (1 - p), acAdj: -p, pick: (s) => /gorilla slam/i.test(s.label) });
            if (!r.used.length) continue;
            let ev = r.ev + p * worth(board, "frightened") + c.cs * worth(board, "frightened");
            const steps = [{ cost: 1, text: `Gorilla Pound: Demoralize ${nameOf(f)} with Intimidation ${signed(me.intimidation)} (${pct(p)}), then Strike it with ${r.used[0].s.label} (${signed(r.used[0].bonus)}), +3 damage per frightened value` }];
            const rest = run(f, strikeActs - 1, ctx.made + 1, { acAdj: -p });
            if (rest.used.length) { steps.push({ cost: rest.used.length, text: strikeText(f, rest.used) }); ev += rest.ev; }
            push({ title: `Gorilla Pound ${nameOf(f)}`, target: f, ev, steps, notes: ["A flourish: no Flurry of Blows this turn. It's then immune to your Demoralize for 10 minutes."] });
        }
    }
    // Mountain Quake (1 action, Mountain Stance, 14th): Strength damage to everything on the ground within 20 feet, basic Fortitude; a failure is prone
    if (has(actor, "mountain-quake") && inStance("mountain-stance") && strikeActs >= 1 && str > 0) {
        const item = actor.items.find((i) => slugOf(i) === "mountain-quake");
        const wait = board.rechargeLeft?.({ item }) ?? 0;
        const near = foes.filter((f) => feetBetween(me.rect, f.rect) <= 20 && !f.conditions?.has?.("flying"));
        const allies = board.allies.filter((a) => feetBetween(me.rect, a.rect) <= 20);
        if (wait) n(`Mountain Quake is recharging (${wait} more round${wait === 1 ? "" : "s"}).`);
        else if (near.length) {
            let ev = 0;
            for (const f of near) { const s = saveExpected(f.saves?.fortitude ?? 0, dc, str); ev += s.expected + (f.conditions?.has?.("prone") ? 0 : s.fail * worth(board, "prone")); }
            ev -= allies.length * str * 0.5;
            const steps = [{ cost: 1, text: `Mountain Quake: ${near.map(nameOf).join(", ")} within 20 feet take ${str} bludgeoning, basic Fortitude DC ${dc}, and fall prone on a failure${allies.length ? `; ${allies.map(nameOf).join(", ")} are in it too` : ""}` }];
            const rest = run(near[0], strikeActs - 1, ctx.made, { acAdj: -2 * saveExpected(near[0].saves?.fortitude ?? 0, dc, str).fail });
            if (rest.used.length) { steps.push({ cost: rest.used.length, text: strikeText(near[0], rest.used) }); ev += rest.ev; }
            push({ title: `Mountain Quake: ${near.length} foe${near.length === 1 ? "" : "s"} within 20 feet`, target: near[0], ev, bias: near.length >= 2 ? 0.4 : 0.1, steps, notes: ["Then 1d4 rounds before you can use it again."] });
        }
    }
    // Wild Winds Gust (2 actions, Wild Winds Stance, 14th): a wind crash at every creature in a 30-foot cone or 60-foot line, the penalty rising after all
    if (has(actor, "wild-winds-gust") && inStance("wild-winds-stance") && strikeActs >= 2) {
        const crash = pool.find((s) => /wind crash/i.test(s.label));
        const near = foes.filter((f) => feetBetween(me.rect, f.rect) <= 30);
        if (crash && near.length >= 2) {
            let ev = 0;
            const shown = [];
            for (const f of near) { const b = crash.bonus + mapFor(ctx.made, true); const e = strikeExpected(b, f.ac, crash.avg, { deadly: crash.deadly }); ev += e.expected; shown.push(`${nameOf(f)} (${signed(b)})`); }
            const steps = [{ cost: 2, text: `Wild Winds Gust: wind crash at ${shown.join(", ")} in a 30-foot cone or 60-foot line, all at your current penalty` }];
            if (strikeActs >= 3) { const rest = run(near[0], 1, ctx.made + near.length); if (rest.used.length) { steps.push({ cost: 1, text: strikeText(near[0], rest.used) }); ev += rest.ev; } }
            push({ title: `Wild Winds Gust at ${near.length} foes`, target: near[0], ev, bias: 0.4, steps, notes: ["Pick the cone or line that leaves your allies out; it's manipulate, so it provokes."] });
        }
    }

    // ---- the grab feats: a foe you have grabbed or restrained
    const held = foes.filter((f) => inReach(me.rect, f.rect, reach) && (f.conditions?.has?.("grabbed") || f.conditions?.has?.("restrained")));
    const heldWord = (f) => (f.conditions?.has?.("restrained") ? "restrained" : "grabbed");
    const sizeAdj = (f, one = 2, more = 4) => { const d = (f.sizeRank ?? 2) - (me.sizeRank ?? 2); return d >= 2 ? -more : d === 1 ? -one : d === -1 ? one : d <= -2 ? more : 0; };
    if (held.length && me.athletics != null && strikeActs >= 1) {
        for (const f of held) {
            const fortDC = 10 + (f.saves?.fortitude ?? 0);
            // Whirling Throw (1 action, attack): Athletics against its Fortitude DC; thrown 10 + 5 x Strength feet for Strength + 1d6 per 10 feet; prone on a critical success
            if (has(actor, "whirling-throw")) {
                const b = me.athletics + sizeAdj(f) + mapFor(ctx.made, false);
                const c = degreeChances(b, fortDC);
                const feet = 10 + 5 * Math.max(0, str);
                const dmg = Math.max(0, str) + Math.floor(feet / 10) * 3.5;
                const ev = (c.s + c.cs) * dmg + c.cs * worth(board, "prone");
                push({ title: `Whirling Throw ${nameOf(f)}`, target: f, ev, bias: 0.2, steps: [{ cost: 1, text: `Whirling Throw ${nameOf(f)} (it's ${heldWord(f)}): Athletics ${signed(b)} against its Fortitude DC (${pct(c.s + c.cs)}); up to ${feet} feet away for about ${Math.round(dmg)} bludgeoning, prone on a critical success` }],
                    notes: ["It counts as an attack; thrown into a wall, the damage uses the full distance. It lands out of your reach, so Strike first if you want both."] });
            }
            // Sleeper Hold (1 action, incapacitation): a Grapple that leaves it clumsy 1, or unconscious for a minute on a critical success
            if (has(actor, "sleeper-hold")) {
                const b = me.athletics + mapFor(ctx.made, false);
                const c = degreeChances(b, fortDC, (f.level ?? lv) > lv ? -1 : 0);
                let ev = c.cs * worth(board, "unconscious") + c.s * worth(board, "clumsy");
                const steps = [{ cost: 1, text: `Sleeper Hold ${nameOf(f)} (it's ${heldWord(f)}): Athletics ${signed(b)} against its Fortitude DC; a critical success (${pct(c.cs)}) puts it to sleep for a minute, a success leaves it clumsy 1${(f.level ?? lv) > lv ? "; incapacitation, it's above your level" : ""}` }];
                const rest = run(f, strikeActs - 1, ctx.made + 1);
                if (rest.used.length) { steps.push({ cost: rest.used.length, text: strikeText(f, rest.used) }); ev += rest.ev; }
                push({ title: `Sleeper Hold ${nameOf(f)}`, target: f, ev, bias: 0.2, steps, notes: ["Damage wakes it; the hold is for a foe your allies can leave alone."] });
            }
            // Wave Dashes Rocks (1 action): a Strike on the held foe that drops it prone, clumsy 1 and enfeebled 1; the grab ends
            if (has(actor, "wave-dashes-rocks")) {
                const r = run(f, 1, ctx.made);
                if (r.used.length) {
                    const h = r.used[0].e.hit;
                    let ev = r.ev + h * ((f.conditions?.has?.("prone") ? 0 : worth(board, "prone")) + worth(board, "clumsy") + worth(board, "enfeebled"));
                    const steps = [{ cost: 1, text: `Wave Dashes Rocks: ${strikeText(f, r.used)}; damage knocks it prone, clumsy 1 and enfeebled 1 until the end of its next turn, and your grab ends` }];
                    const rest = run(f, strikeActs - 1, ctx.made + 1, { acAdj: -2 * h });
                    if (rest.used.length) { steps.push({ cost: rest.used.length, text: strikeText(f, rest.used) }); ev += rest.ev; }
                    push({ title: `Wave Dashes Rocks on ${nameOf(f)}`, target: f, ev, steps });
                }
            }
            if (has(actor, "godbreaker") && strikeActs === 3) n(`Godbreaker (3 actions) on ${nameOf(f)} while you hold it: three Strikes, each throwing it 20 feet higher; all three hit and it takes your Strike damage plus a 60-foot fall, one miss and you both fall.`);
            if (has(actor, "explosive-death-drop") && inStance("rain-of-embers-stance")) n(`Explosive Death Drop (1 action) on ${nameOf(f)}: Athletics against its Fortitude DC for 12d6 fire (6d6 on a success) and fire on everything adjacent to where it lands.`);
        }
    } else if (hasAny(actor, "whirling-throw", "sleeper-hold", "wave-dashes-rocks", "godbreaker") && me.athletics != null) {
        n(`${["whirling-throw", "sleeper-hold", "wave-dashes-rocks", "godbreaker"].filter((k) => has(actor, k)).map((k) => k.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())).join(", ")}: for a foe you have grabbed; Grapple first (or Flurry of Maneuvers), and they follow next turn.`);
    }
    if (has(actor, "crushing-grab") && me.athletics != null) n(`Crushing Grab: a Grapple that works deals ${str} bludgeoning.`);

    // ---- Flying Kick (2 actions): Leap next to a foe and Strike it, for one just out of reach
    if (has(actor, "flying-kick") && strikeActs >= 2) {
        const leap = speed >= 30 ? 15 : 10;
        for (const f of foes.filter((x) => !inReach(me.rect, x.rect, reach) && feetBetween(me.rect, x.rect) <= leap + 5)) {
            const sq = squareToReach(board, f, reach, 1);
            if (!sq) continue;
            const at = { ...me.rect, x: sq.x, y: sq.y };
            const r = run(f, 1, ctx.made, { at, pick: (s) => !s.ranged });
            if (!r.used.length) continue;
            let ev = r.ev;
            const steps = [{ cost: 2, text: `Flying Kick: Leap ${feetBetween(me.rect, f.rect)} feet to ${nameOf(f)} and ${strikeText(f, r.used)}` }];
            const rest = run(f, strikeActs - 2, ctx.made + 1, { at });
            if (rest.used.length) { steps.push({ cost: rest.used.length, text: strikeText(f, rest.used) }); ev += rest.ev; }
            push({ title: `Flying Kick ${nameOf(f)}`, target: f, ev, bias: 0.2, dest: { x: sq.x, y: sq.y }, steps, notes: [`A Leap covers ${leap} feet; a Long Jump (Athletics) reaches further. The plans' Stride then Flurry usually beats it when a Stride gets you there.`] });
        }
    }
    // ---- Knockback Strike (2 actions, concentrate, 10th): an unarmed Strike; a hit lets you Shove at the same penalty, not counting
    if (has(actor, "knockback-strike") && me.athletics != null && strikeActs >= 2) {
        for (const f of foes.filter((x) => inReach(me.rect, x.rect, reach) && (x.sizeRank ?? 2) <= (me.sizeRank ?? 2) + 1)) {
            const r = run(f, 1, ctx.made, { pick: (s) => !s.ranged });
            if (!r.used.length) continue;
            const sb = me.athletics + mapFor(ctx.made, false);
            const c = degreeChances(sb, 10 + (f.saves?.fortitude ?? 0));
            const pushWorth = (c.s + c.cs) * 2 + c.cs * 1;
            let ev = r.ev + r.used[0].e.hit * pushWorth;
            const steps = [{ cost: 2, text: `Knockback Strike: ${strikeText(f, r.used)}; on a hit, Shove it with Athletics ${signed(sb)} (${pct(c.s + c.cs)}; 5 feet, 10 on a critical success${has(actor, "improved-knockback") ? ", +5 more with Improved Knockback, and damage if it hits a wall or a creature" : ""})` }];
            const rest = run(f, strikeActs - 2, ctx.made + 1);
            if (rest.used.length) { steps.push({ cost: rest.used.length, text: `${strikeText(f, rest.used)} (if it's still in reach)` }); ev += rest.ev; }
            push({ title: `Knockback Strike ${nameOf(f)}`, target: f, ev, bias: 0.1, steps, notes: ["Worth it when a push matters (off a ledge, out of an ally's face, into a hazard); it's concentrate."] });
        }
    }
    // ---- One-Inch Punch (2 or 3 actions): one unarmed Strike with extra dice: 1/2 at 6th, 2/4 at 10th, 3/6 at 18th
    if (has(actor, "one-inch-punch") && strikeActs >= 2) {
        const tier = lv >= 18 ? 3 : lv >= 10 ? 2 : 1;
        for (const f of foes.filter((x) => inReach(me.rect, x.rect, reach))) {
            for (const cost of [2, 3]) {
                if (strikeActs < cost) continue;
                const extra = tier * (cost - 1);
                const r = run(f, 1, ctx.made, { extra: extra * (fistDie + 1) / 2, pick: (s) => !s.ranged && s.traits?.includes("unarmed") });
                if (!r.used.length) continue;
                let ev = r.ev;
                const steps = [{ cost, text: `One-Inch Punch (${cost} actions): ${strikeText(f, r.used)} with ${extra} extra weapon ${extra === 1 ? "die" : "dice"}${has(actor, "one-millimeter-punch") ? `; a hit can send it flying: Fortitude DC ${dc} or pushed 5 to ${10 * cost} feet` : ""}` }];
                if (cost === 2 && strikeActs >= 3) { const rest = run(f, 1, ctx.made + 1); if (rest.used.length) { steps.push({ cost: 1, text: strikeText(f, rest.used) }); ev += rest.ev; } }
                push({ title: `One-Inch Punch ${nameOf(f)} (${cost} actions)`, target: f, ev, bias: 0.15, steps, notes: ["One roll at your current penalty: the choice when a Flurry would have to climb the penalty, or when one hit must land."] });
            }
        }
    }
    // ---- Disrupt Qi (2 actions, 12th): an unarmed Strike; damage to a living foe adds 2d6 persistent void (3d6 at 18th) and enfeebled 1 while it lasts
    if (has(actor, "disrupt-qi") && strikeActs >= 2) {
        const pd = lv >= 18 ? 10.5 : 7;
        for (const f of foes.filter((x) => inReach(me.rect, x.rect, reach))) {
            const r = run(f, 1, ctx.made, { pick: (s) => !s.ranged && s.traits?.includes("unarmed") });
            if (!r.used.length) continue;
            let ev = r.ev + r.used[0].e.hit * (pd * 1.5 + worth(board, "enfeebled"));
            const steps = [{ cost: 2, text: `Disrupt Qi: ${strikeText(f, r.used)}; if it's living and takes damage, ${lv >= 18 ? "3d6" : "2d6"} persistent void and enfeebled 1 until that ends` }];
            if (strikeActs >= 3) { const rest = run(f, 1, ctx.made + 1); if (rest.used.length) { steps.push({ cost: 1, text: strikeText(f, rest.used) }); ev += rest.ev; } }
            push({ title: `Disrupt Qi on ${nameOf(f)}`, target: f, ev, bias: 0.2, steps, notes: ["Nothing on an undead or a construct; best early in a fight, when the persistent damage has rounds to run."] });
        }
    }
    // ---- Flinging Blow (2 actions, 16th): an unarmed Strike; a hit makes it save or be thrown 10 feet (20 on a critical failure) and prone
    if (has(actor, "flinging-blow") && strikeActs >= 2) {
        for (const f of foes.filter((x) => inReach(me.rect, x.rect, reach))) {
            const r = run(f, 1, ctx.made, { pick: (s) => !s.ranged && s.traits?.includes("unarmed") });
            if (!r.used.length) continue;
            const c = degreeChances(f.saves?.fortitude ?? 0, dc);
            const ev = r.ev + r.used[0].e.hit * (c.f + c.cf) * (worth(board, "prone") + 1.5);
            push({ title: `Flinging Blow at ${nameOf(f)}`, target: f, ev, bias: 0.2, steps: [{ cost: 2, text: `Flinging Blow: ${strikeText(f, r.used)}; on a hit, Fortitude DC ${dc} (${pct(c.f + c.cf)} to fail) or it's thrown 10 feet (20 on a critical failure) and lands prone; damage to it and whatever it hits if something stops it` }],
                notes: ["It lands out of your reach, so make it the turn's last Strike."] });
        }
    }
    // ---- Shattering Strike (2 actions, 16th): an unarmed Strike through every resistance, half Hardness
    if (hasAny(actor, "shattering-strike-monk", "shattering-strike") && strikeActs >= 2) {
        const resisting = foes.filter((x) => inReach(me.rect, x.rect, reach) && (x.iwr?.resist ?? []).length);
        for (const f of resisting) {
            const r = run(f, 1, ctx.made, { pick: (s) => !s.ranged && s.traits?.includes("unarmed") });
            if (!r.used.length) continue;
            const res = Math.max(...f.iwr.resist.map((x) => Number(x.value) || 0), 0);
            const ev = r.ev + r.used[0].e.hit * Math.min(res, r.used[0].s.avg);
            push({ title: `Shattering Strike ${nameOf(f)}`, target: f, ev, bias: 0.2, steps: [{ cost: 2, text: `Shattering Strike: ${strikeText(f, r.used)}, ignoring its resistance${res ? ` (${res})` : ""}` }] });
        }
        if (!resisting.length) n("Shattering Strike (2 actions): an unarmed Strike that ignores resistances and halves Hardness; for a foe that's shrugging off your hits, or a wall.");
    }
    // ---- Mixed Maneuver (2 actions, 8th): two of Grapple, Shove, Trip, Reposition at the same penalty
    if (has(actor, "mixed-maneuver") && me.athletics != null && strikeActs >= 2 && me.freeHand !== false) {
        for (const f of foes.filter((x) => inReach(me.rect, x.rect, reach) && (x.sizeRank ?? 2) <= (me.sizeRank ?? 2) + 1)) {
            const b = me.athletics + mapFor(ctx.made, false);
            const trip = degreeChances(b, 10 + (f.saves?.reflex ?? 0));
            const grab = degreeChances(b, 10 + (f.saves?.fortitude ?? 0));
            const pT = f.conditions?.has?.("prone") ? 0 : trip.s + trip.cs, pG = held.includes(f) ? 0 : grab.s + grab.cs;
            if (!pT && !pG) continue;
            let ev = pT * worth(board, "prone") + pG * (worth(board, "grabbed") + (has(actor, "crushing-grab") ? str : 0)) + grab.cs * worth(board, "restrained", 0.5);
            const steps = [{ cost: 2, text: `Mixed Maneuver: Trip (${pct(trip.s + trip.cs)}) and Grapple (${pct(grab.s + grab.cs)}) ${nameOf(f)} with Athletics ${signed(b)}, both at your current penalty${has(actor, "crushing-grab") ? `; the Grapple deals ${str}` : ""}` }];
            if (strikeActs >= 3) { const rest = run(f, 1, ctx.made + 2, { acAdj: -2 * Math.max(pT, pG) }); if (rest.used.length) { steps.push({ cost: 1, text: `${strikeText(f, rest.used)}, it off-guard if either worked` }); ev += rest.ev; } }
            push({ title: `Mixed Maneuver on ${nameOf(f)}`, target: f, ev, bias: 0.2, steps, notes: ["Shove or Reposition can replace either; a grabbed and prone foe is off-guard and can't leave, and your grab feats follow."] });
        }
    }

    // ---- the focus pool and the qi spells that don't compose with a Strike
    const qi = [];
    if (knowsSpell(/^(qi rush|ki rush)$/i)) qi.push("Qi Rush (1 action): two Strides or Steps, concealed until your next turn; the way to a far foe or out of reach");
    if (knowsSpell(/^(harmonize self|wholeness of body)$/i)) qi.push(`Harmonize Self (1 action): heal yourself ${8 * Math.max(1, Math.ceil(lv / 2))}${has(actor, "endurance-of-the-rooted-tree") ? ", free at the start of your turn with Endurance of the Rooted Tree" : ""}; the plans list it as a heal`);
    if (knowsSpell(/^(qi blast|ki blast)$/i)) qi.push("Qi Blast (1 to 3 actions): a cone of force on Fortitude, bigger and harder with more actions; the plans list it as an area spell");
    if (knowsSpell(/^(shrink the span|abundant step)$/i)) qi.push(`Shrink the Span (1 action): teleport up to ${speed} feet in sight, no reactions`);
    if (knowsSpell(/^wind jump$/i)) qi.push("Wind Jump (1 action): fly at your Speed for a minute; end each turn on ground");
    if (knowsSpell(/^(ki cutting sight)$/i)) qi.push("Ki Cutting Sight (1 action): Perception against a foe's Fortitude DC; your next damaging Strike on it adds 4d10 slashing (more heightened)");
    if (knowsSpell(/^(wronged monk's wrath|medusa's wrath)$/i)) qi.push("Wronged Monk's Wrath (1 to 3 actions): force and lightning around you, basic Reflex; the plans list it as an area spell");
    if (knowsSpell(/^shadow's web$/i)) qi.push("Shadow's Web (2 actions): void damage in 30 feet with enfeebled on a failed Fortitude; the plans list it");
    if (knowsSpell(/^(qi form|ki form)$/i) && !effect(actor, /qi-form|ki-form/)) qi.push("Qi Form (1 action): a minute of flight, +1d6 on every Strike and a damaging aura; for the fight's big round");
    if (knowsSpell(/^medusa's wrath$/i)) qi.push("Medusa's Wrath (2 actions): an unarmed Strike; a hit leaves it slowed 1 (2 on a critical hit) and saving each turn against worse");
    if (qi.length && focus != null) n(`${focus} of ${actor.system.resources.focus.max} Focus Point${actor.system.resources.focus.max === 1 ? "" : "s"}${focus === 0 ? ": none to spend this turn" : ""}. ${qi.join(". ")}.${has(actor, "align-qi") ? ` Align Qi (reaction, once an hour): casting a monk spell heals you ${lv + wis}.` : ""}`);
    if (has(actor, "meditative-focus")) n("Meditative Focus: a Refocus restores your whole pool.");
    if (has(actor, "lightning-qi")) n("Lightning Qi (free, once per 10 minutes): your next qi spell of two or three actions costs one less.");
    if (has(actor, "overwhelming-breath") && foes.some((f) => (f.iwr?.resist ?? []).some((x) => /physical|bludgeoning|slashing|piercing|all/i.test(x.type ?? "")))) n(`Overwhelming Breath (1 action) before a monk spell without a duration: it and its Strikes ignore ${lv} of a foe's physical resistance.`);

    // ---- when-notes, in level order
    if (stunning && !flurry && !flurryKnown) n(`Stunning Blows needs Flurry of Blows (Monk's Flurry at 10th).`);
    if (has(actor, "brawling-focus") && lv < 5) n(`Brawling Focus: a critical hit with a brawling attack leaves the foe slowed 1 until the end of its next turn unless it saves against DC ${dc}; the plans count it.`);
    if (monastic) n("Monastic Weaponry: your monk weapons work with Flurry of Blows and your other monk feats (not a stance's own attack).");
    if (has(actor, "stand-still")) n("Stand Still (reaction): when a foe in reach moves, a melee Strike at it; a critical hit stops the move.");
    if (has(actor, "deflect-projectile")) n(`Deflect Projectile (reaction, a hand free): +4 AC against a physical ranged attack you see; a miss is deflected${has(actor, "projectile-snatching") ? ", and Projectile Snatching throws it back as a ranged Strike" : ""}${has(actor, "return-fire") && inStance("monastic-archer-stance") ? "; Return Fire shoots a deflected arrow back from your bow" : ""}.`);
    if (has(actor, "guarded-movement") && foes.some((f) => f.reactions?.some?.((r) => r.trigger?.onMove))) n("Guarded Movement: +4 AC against reactions your movement triggers, so a Stride past a foe is safer than the plans weigh it.");
    if (has(actor, "crane-flutter") && inStance("crane-stance")) n("Crane Flutter (reaction): against an attack you see, your crane AC bonus becomes +3; if it misses and the attacker is in reach, a crane wing Strike at -2.");
    if (has(actor, "mountain-stronghold") && inStance("mountain-stance") && strikeActs >= 1) n("Mountain Stronghold (1 action): +2 circumstance bonus to AC until your next turn; the third action when nothing better is in reach.");
    if (has(actor, "stumbling-feint") && inStance("stumbling-stance") && me.deception == null) n("Stumbling Feint: a free Feint before your Flurry, but you'd need Deception.");
    if (has(actor, "tangled-forest-stance") && inStance("tangled-forest-stance")) n(`Tangled Forest Stance: a foe in your reach that moves away must beat DC ${dc} (Reflex, Acrobatics or Athletics) or stay; stand where they want to leave.${has(actor, "tangled-forest-rake") ? " Tangled Forest Rake (1 action): a lashing branch Strike that drags the foe 10 feet on a hit, even through your space." : ""}`);
    if (has(actor, "ironblood-surge") && inStance("ironblood-stance")) n(`Ironblood Surge (1 action): +1 AC and your resistance becomes ${Math.max(str, lv >= 20 ? 5 : lv >= 16 ? 4 : lv >= 12 ? 3 : 2)} until your next turn.`);
    if (has(actor, "blazing-talon-surge") && inStance("rain-of-embers-stance")) n("Blazing Talon Surge (2 actions, flourish): Stride, then a fire talon Strike with extra fire damage and a Grapple on a hit; the flourish, so no Flurry that turn.");
    if (has(actor, "momentous-charge") && inStance("rushing-goat-stance")) n("Momentous Charge (2 actions): Stride, then a ramming horn Strike that pushes it 10 feet (stunned 1 on a critical hit).");
    if (has(actor, "five-gods-ram") && inStance("rushing-goat-stance")) n("Five-Gods Ram (3 actions): Stride and ram, push 10 feet, Stride and ram again for prone; a second miss leaves you stunned 1.");
    if (has(actor, "culverts-collapse") && inStance("flood-stance")) n("Culvert's Collapse (1 action): if an enemy damaged you since your last turn, a flooded river Strike at it with +1d8 bleed.");
    if (has(actor, "cobra-envenom") && inStance("cobra-stance")) n("Cobra Envenom (1 action, once a minute): a cobra fang Strike at 5 more feet of reach; a hit raises the venom to 1d4 persistent poison per die.");
    if (has(actor, "wake-to-strife") && foes.some((f) => inReach(me.rect, f.rect, reach) && f.conditions?.has?.("prone"))) n(`Wake to Strife (2 actions) on a prone foe in reach: Fortitude DC ${dc} or sickened 1 (2 on a failure), and a free Grapple.`);
    if (has(actor, "wall-run")) n("Wall Run (1 action): a Stride that runs up walls; reach a flier or a ledge, but you fall after your next action unless you're on ground.");
    if (has(actor, "winding-flow")) n(`Winding Flow (1 action, once a round): two of Stand, Step and Stride${me.conditions?.has?.("prone") ? "; you're prone, so Stand and Stride for one action" : ""}.`);
    if (has(actor, "peafowl-strut") && inStance("peafowl-stance")) n("Peafowl Strut (1 action, flourish): Step twice and Strike with your sword.");
    if (has(actor, "whirling-in-the-summer-storm") && inStance("twisting-petal-stance")) n(`Whirling in the Summer Storm (3 actions): Step, every foe in reach saves against DC ${Math.max(dc, 10 + (me.deception ?? 0))} or is off-guard to melee until your next turn, then up to three Shoves.`);
    if (has(actor, "wave-spiral") && inStance("reflective-ripple-stance")) n("Wave Spiral (2 actions, once a minute): Trip every creature on the ground in 10 feet, the penalty rising after all.");
    if (hasAny(actor, "snakebird-s-shadow", "snakebirds-shadow") && inStance("waterfowl-stance")) n("Snakebird's Shadow (2 actions): a sword Strike at every enemy in a 15-foot cone, the penalty rising after all.");
    if (has(actor, "blazing-streak") && inStance("stoked-flame-stance")) n("Blazing Streak (3 actions, flourish): Stride twice, Striking up to four different foes along the way with fire.");
    if (has(actor, "focused-shot") && inStance("monastic-archer-stance")) n("Focused Shot (1 action): a bow Strike that ignores concealment and cover.");
    if (has(actor, "triangle-shot") && inStance("monastic-archer-stance")) n("Triangle Shot (2 actions): three arrows at one target at -2, counting as two attacks; Stunning Blows applies.");
    if (has(actor, "pinning-fire")) n(`Pinning Fire (reaction): when both Strikes of a Flurry with piercing projectiles hit, Reflex DC ${dc} or the foe is immobilized until the projectiles are pulled.`);
    if (has(actor, "world-breaking-footfall") && inStance("kaiju-stance")) n(`World-Breaking Footfall (2 actions): the ground around you becomes difficult terrain and everything near you takes damage, basic Fortitude DC ${dc}.`);
    if (has(actor, "wake-of-devastation") && inStance("kaiju-stance")) n("Wake of Devastation: your shattering earth hits buckle the ground under you, and a critical hit on a foe in difficult terrain buries it until it escapes.");
    if (has(actor, "divert-streamflow")) n("Divert Streamflow (reaction): when a foe in reach damages you in melee, Trip it; a success lets you Step free.");
    if (has(actor, "rippling-spin") && inStance("reflective-ripple-stance")) n("Rippling Spin (reaction, flourish): when a melee attack hits you, Step within the attacker's reach and Trip or Disarm it.");
    if (has(actor, "scattering-in-spring") && inStance("twisting-petal-stance")) n("Scattering in Spring (reaction): +2 AC against a melee attack in reach; a miss lets you Shove or Trip it, a success counting as a critical.");
    if (has(actor, "prevailing-position") && stance) n("Prevailing Position (reaction): leave your stance for +4 AC against one attack or +4 on one Reflex save.");
    if (has(actor, "dodging-roll")) n(`Dodging Roll (reaction): against an area effect with a Reflex save, Step and resist ${lv} of it (${lv + dex} if the Step takes you out).`);
    if (has(actor, "electric-counter") && inStance("stoked-flame-stance")) n(`Electric Counter (reaction): when you'd take damage, electricity resistance ${lv} until your next turn, and a melee attacker takes electricity damage.`);
    if (has(actor, "inner-fire-monk") && inStance("stoked-flame-stance")) n(`Inner Fire: cold and fire resistance ${Math.floor(lv / 2)}, and anything that touches or grabs you takes ${Math.max(1, wis)} fire once a turn.`);
    if (has(actor, "lessons-of-flux")) n("Lessons of Flux (reaction, once an hour): reroll a failed Grapple, Reposition, Shove, Trip or Tumble Through.");
    if (has(actor, "enlightened-presence")) n(`Enlightened Presence: allies within 15 feet of you get +2 on Will saves against mental effects; ${board.allies.filter((a) => feetBetween(me.rect, a.rect) <= 15).length} of ${board.allies.length} are there now.`);
    if (has(actor, "qi-center") && (known.some((k) => STANCES[k].spell) || stance)) n("Qi Center (free, once a minute): cast a one-action qi stance (Wild Winds, Clinging Shadows) without a Focus Point.");
    if (has(actor, "swift-river")) n("Swift River (free, as your turn ends): end a Speed penalty, immobilized or slowed on you.");
    if (perfected) n("Perfected Form: your first Strike each turn treats a die below 10 as a 10; the plans count it.");
    if (quickEQ) n("Enduring Quickness: your extra action is a Stride or a Leap (or one action of a High Jump or Long Jump), not a Strike; the plans spend it on the move.");
    else if (has(actor, "enduring-quickness")) n("Enduring Quickness: you're always quickened, for a Stride or a Leap.");
    if (has(actor, "golden-body")) n("Golden Body: fast healing 20 while you're above 0 HP, and deadly d12 on your unarmed Strikes.");
    if (has(actor, "impossible-technique")) n("Impossible Technique (reaction, unarmored, not fatigued): an attack that hits you is rerolled with the lower result, or a failed save rerolled with the higher.");
    if (has(actor, "vitality-manipulating-stance") && inStance("vitality-manipulating-stance")) n("Vitality-Manipulating Stance: vitality blast at 30 feet, and Stunning Blows can enfeeble 2 for a round (a minute on a failure) instead of stunning.");
    if (has(actor, "one-millimeter-punch") && !has(actor, "one-inch-punch")) n("One-Millimeter Punch needs One-Inch Punch.");
}

export { monk };
