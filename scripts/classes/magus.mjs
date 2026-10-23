/**
 * PF2e Tactics: classes/magus.mjs
 * See classes/_common.mjs for the shape of a class read.
 * Gate: class magus, or magus-dedication (Spellstrike comes with Spellstriker at 4th; without it only the notes run).
 * The Spellstrike charge: PF2e doesn't record it, so the read takes the helper's record when there is one
 * (board.me.spellstrikeCharged), assumes it charged in a fight's first round, and otherwise plans both turns: Spellstrike
 * first (labelled as assuming the charge) and recharge first (a recharge, Magus's Analysis, Running Recharge or a conflux spell).
 * Reads: Spellstrike (cantrip vs slot, melee, or ranged with Starlit Span or Volatile Spark), the ten hybrid studies and their conflux spells
 * (a third action that recharges Spellstrike while Focus Points remain), Arcane Cascade with its specialization steps,
 * Expansive/Devastating/Distracting/Lunging/Overwhelming/Dispelling Spellstrike, Spell Swipe, Whirlwind Spell,
 * Recharging Flurry, Running Recharge, Magus's Analysis, Cascading Ray, Spell Crash, and when-notes for the rest.
 */
import { bestStrike, canMove, castable, effect, focusLeft, has, half, spendsSlot, level, markOffGuard, moveText, myReach, allySpeed, pct, squareToReach, strikeRun, targets, worth, degreeChances, feetBetween, inReach, mapFor, strikeExpected, saveExpected, CONDITION_VALUE, nameOf, reachableSquares, signed } from "./_common.mjs";

const ENERGY = new Set(["acid", "cold", "electricity", "fire", "force", "sonic", "vitality", "void"]);
const RESISTABLE = new Set(["acid", "cold", "electricity", "fire", "sonic"]);
/**
 * The hybrid studies: what the study does on a turn, and its conflux spell (1 action, 1 Focus Point, recharges Spellstrike).
 * kind: the conflux spell's own Strike (melee, ranged, or none); reach: how far that Strike reaches when it isn't the weapon's
 * own; text by the spell's rank r (half your level, rounded up).
 */
const STUDIES = {
    "inexorable-iron": { name: "Inexorable Iron", conflux: "Thunderous Strike", re: /thunderous-strike/, kind: "melee", confluxText: (r) => `a melee Strike with your two-handed weapon; each creature in a 15-foot cone from you (the target has to be in it) takes ${r + 1} sonic, basic Fortitude, and falls prone on a critical failure`, text: "Inexorable Iron: when you enter Arcane Cascade and at the start of each of your turns in it, if you're wielding a melee weapon in two hands, you gain temporary HP equal to half your level (minimum 1)." },
    "laughing-shadow": { name: "Laughing Shadow", conflux: "Dimensional Assault", re: /dimensional-assault/, kind: "melee", confluxText: (r) => `teleport to a space you can see within ${r >= 5 ? "your Speed" : "half your Speed"} that's in reach of an enemy, then a melee Strike against it`, text: "Laughing Shadow: in Arcane Cascade your Speeds are 5 feet higher (10 unarmored), and a Strike against an off-guard creature with your other hand completely free deals the stance's extra damage as 3 (5 with weapon specialization, 7 with greater)." },
    "sparkling-targe": { name: "Sparkling Targe", conflux: "Shielding Strike", re: /shielding-strike/, kind: "melee", confluxText: "Raise your Shield (or cast shield), then a melee Strike", text: "Sparkling Targe: in Arcane Cascade with your shield raised, its circumstance bonus to AC also counts on your saves against spells and magical effects, and their damage can trigger Shield Block, with the shield's Hardness up by the stance's resistance." },
    "starlit-span": { name: "Starlit Span", conflux: "Shooting Star", re: /shooting-star/, kind: "ranged", confluxText: "a ranged Strike that ignores the target's concealment and lowers its cover by one degree; on a hit, everyone's attacks on it get the same until your next turn", text: "Starlit Span: your Spellstrike works with a ranged weapon against a target in its first range increment; in Arcane Cascade your ranged attacks ignore lesser cover your allies give the target." },
    "twisting-tree": { name: "Twisting Tree", conflux: "Spinning Staff", re: /spinning-staff/, kind: "melee", strikes: 2, confluxText: "a staff Strike against one foe, then another against a different foe, the multiple attack penalty applying to each as normal", text: "Twisting Tree: a staff in one hand is agile with a d6 die; in both hands it gains parry, reach and trip; in Arcane Cascade you can change your grip as a free action once a round." },
    "twofold-tine": { name: "Twofold Tine", conflux: "Force Fling", re: /force-fling/, kind: "melee", reach: 15, confluxText: "a melee Strike with a weapon you hold against a target anywhere within 15 feet, its physical damage turned to force (a lower penalty if you haven't attacked that creature this turn)", text: "Twofold Tine: in Arcane Cascade, a Strike with one melee weapon raises the stance's extra damage on a weapon in your other hand to 2 (4 with weapon specialization, 6 with greater) until your turn ends." },
    "aloof-firmament": { name: "Aloof Firmament", conflux: "Sky Laughs at Waves", re: /sky-laughs-at-waves/, kind: "melee", confluxText: "Fly up to your Speed, then Strike an adjacent creature with your one-handed sword (you fall afterward unless you can fly)", text: "Aloof Firmament: in Arcane Cascade your Fly, Leap, High Jump and Long Jump trigger no reactions, and the next Strike after one with a one-handed sword (other hand free) deals the stance's extra damage as 4 (6 with weapon specialization, 8 with greater)." },
    "unfurling-brocade": { name: "Unfurling Brocade", conflux: "Home Among Mulberry Leaves", re: /home-among-mulberry-leaves/, kind: "melee", confluxText: "a melee Strike with your qi-infused fabric; a hit immobilizes the target until your next turn (it can Escape against your spell DC), and a critical hit also makes it clumsy 1 or enfeebled 1", text: "Unfurling Brocade: your qi-infused fabric is a bladed scarf you can wield in one hand (d4 die)." },
    "resurgent-maelstrom": { name: "Resurgent Maelstrom", conflux: "Turbulent Tide", re: /turbulent-tide/, kind: "melee", confluxText: "a melee Strike with your improvised weapon, which then breaks; each creature adjacent to you saves (Fortitude) or is pushed 5 feet (10 on a critical failure)", text: "Resurgent Maelstrom: your improvised weapons take no -2 penalty, deal at least a d6 (d4 if agile), and gain backstabber in one hand or forceful in two." },
    "volatile-spark": { name: "Volatile Spark", conflux: "Booming Blast", re: /booming-blast/, kind: "ranged", firearm: true, confluxText: "a ranged firearm Strike with a loaded firearm; each enemy within 20 feet of you saves (Will) or is frightened 1 (2 on a critical failure)", text: "Volatile Spark: your Spellstrike works with a firearm against a target in its first range increment, and Reloading Cascade (1 action) enters Arcane Cascade and reloads." },
};
/** Other conflux spells, from feats: [slug, name, spell regex, text by rank]. */
const CONFLUX_FEATS = [
    ["force-fang", "Force Fang", /force-fang/, (r) => { const n = 1 + Math.floor((r - 1) / 2); return `${n}d4+${n} force to a creature in your melee reach (or the first range increment of a ranged Spellstrike weapon), no roll`; }],
    ["conjurers-countermeasure", "Conjurer's Countermeasure", /conjurer/, (r) => `resistance ${5 + 5 * Math.max(0, Math.floor((r - 3) / 3))} against damage from spells for a minute, on top of Arcane Cascade's`],
    ["runic-impression", "Runic Impression", /runic-impression/, () => "your weapon gains a property rune you choose (corrosive, flaming, frost, ghost touch, returning, shock, thundering) for a minute"],
    ["hasted-assault", "Hasted Assault", /hasted-assault/, () => "you're quickened for a minute (Strike or Stride with the extra action)"],
];
const isAttack = (sp) => sp.attack !== null && sp.attack !== undefined;
const isFirearm = (s) => String(s.item?.system?.group ?? s.group ?? "") === "firearm" || /\b(pistol|musket|arquebus|blunderbuss|firearm|gun)\b/i.test(s.label ?? "");
/**
 * Whether the Spellstrike is charged. PF2e 8.6.1 keeps no record of it (the action has only a description note: no effect,
 * flag or roll option), so: the helper's own record when it has one (board.me.spellstrikeCharged, from the player's chat
 * cards), charged on the first round of a fight, and unknown after that (null).
 */
function chargeOf(board, ctx) {
    if (typeof board.me.spellstrikeCharged === "boolean") return board.me.spellstrikeCharged;
    const round = Number(globalThis.game?.combat?.round ?? 0);
    return round <= 1 && ctx.made === 0 && ctx.actions >= 3 ? true : null;
}

function magus(board, ctx, out) {
    const actor = board.me.actor;
    const lv = level(board);
    // A Magus Dedication without Spellstriker has no Spellstrike: no Spellstrike plans, only the notes for what it took
    const ss = has(actor, "spellstrike");
    const inStance = !!effect(actor, /arcane-cascade/);
    const fp = focusLeft(actor);
    const study = Object.keys(STUDIES).find((s) => has(actor, s)) ?? null;
    const starlit = study === "starlit-span";
    const spark = study === "volatile-spark";
    const fRank = Math.max(1, Math.ceil(lv / 2));
    const charge = chargeOf(board, ctx);
    const spec = has(actor, "weapon-specialization") || (actor?.class?.slug === "magus" && lv >= 7);
    const gSpec = has(actor, "greater-weapon-specialization") || (actor?.class?.slug === "magus" && lv >= 15);
    const cascade = 1 + (spec ? 1 : 0) + (gSpec ? 1 : 0);
    const stanceExtra = inStance ? cascade : 0;
    const foes = targets(board).filter((f) => f.hp > 0);
    const reach = myReach(board);
    const melee = board.strikes.filter((s) => !s.ranged);
    const ranged = board.strikes.filter((s) => s.ranged);
    // The ranged weapons a Spellstrike can use: any with Starlit Span, a firearm with Volatile Spark
    const spellRanged = starlit ? ranged : spark ? ranged.filter(isFirearm) : [];
    const staff = board.strikes.find((s) => !s.ranged && (/staff/i.test(s.label) || s.traits?.includes("staff")));
    const spellAtk = board.spells.find((sp) => isAttack(sp))?.attack ?? lv + 4 + 3;
    const expansive = has(actor, "expansive-spellstrike");
    const devastating = has(actor, "devastating-spellstrike");
    const devDmg = lv >= 19 ? 5 : lv >= 14 ? 4 : lv >= 9 ? 3 : 2;
    // Spells a Spellstrike can carry: 1-2 actions, an attack roll or a save, damage; area spells only with Expansive Spellstrike.
    // Not the magus's own focus spells (a conflux spell carries its own Strike); another focus spell costs a Focus Point, not a slot.
    const spells = board.spells.filter((sp) => sp.cost !== null && sp.cost <= 2 && !sp.consumable && (isAttack(sp) || sp.save?.stat) && sp.avg > 0 && !sp.heals && (!sp.area || expansive) && !(sp.focus && (sp.traits ?? []).includes("magus")));
    const conflux = [];
    const ctext = (t) => (typeof t === "function" ? t(fRank) : t);
    const slugName = (x) => (x.name ?? "").toLowerCase().replace(/['\u2019]/g, "").replace(/[^a-z0-9]+/g, "-");
    if (study) { const s = STUDIES[study]; const sp = board.spells.find((x) => s.re.test(slugName(x))); conflux.push({ name: sp?.name ?? s.conflux, text: ctext(s.confluxText), strike: s.kind ?? null, strikes: s.strikes ?? 1, reach: s.reach ?? null, firearm: !!s.firearm }); }
    for (const [slug, name, re, text] of CONFLUX_FEATS) if (has(actor, slug)) conflux.push({ name: board.spells.find((x) => re.test(slugName(x)))?.name ?? name, text: ctext(text), strike: null, strikes: 1 });
    const recharger = (fp ?? 0) > 0 ? conflux[0] ?? null : null;

    /** Other foes a spell's area or Devastating Spellstrike would catch around f (within feet). */
    const around = (f, feet) => foes.filter((o) => o !== f && feetBetween(f.rect, o.rect) <= feet);
    /** The spell's expected damage on f when carried by a Strike with this hit chance, plus the area's spill onto others. */
    const spellPart = (sp, f, st) => {
        let e = 0, spill = 0;
        if (isAttack(sp)) e = st.hit * sp.avg + st.crit * sp.avg; // a crit doubles the spell too
        else {
            const dc = sp.dc ?? 10 + lv + 4;
            e = (1 - st.critFail) * saveExpected(f.saves?.[sp.save.stat] ?? lv + 5, dc, sp.avg, { basic: sp.save.basic }).expected;
            if (sp.area && expansive) for (const o of around(f, sp.area.shape === "burst" ? sp.area.size : 5)) spill += (1 - st.critFail) * saveExpected(o.saves?.[sp.save.stat] ?? lv + 5, dc, sp.avg, { basic: sp.save.basic }).expected;
        }
        return { e, spill };
    };
    /** The best cantrip and slot spell on the best Strike against f from a given distance (melee: in reach; ranged: first increment). */
    const picks = (f, { useRanged = false, at = board.me.rect, made = 0 } = {}) => {
        let cantrip = null, slot = null;
        const list = useRanged ? spellRanged.filter((s) => feetBetween(at, f.rect) <= (s.range ?? 30)) : melee.filter((s) => inReach(at, f.rect, s.reach || 5));
        for (const sp of spells) {
            for (const s of list) {
                const bonus = s.bonus + mapFor(made, s.agile);
                const c = degreeChances(bonus, f.ac);
                const st = { hit: c.s + c.cs, crit: c.cs, critFail: c.cf };
                const weapon = strikeExpected(bonus, f.ac, s.avg + (useRanged ? 0 : stanceExtra), { deadly: s.deadly }).expected;
                const { e, spill } = spellPart(sp, f, st);
                const pick = { sp, s, bonus, hit: st.hit, expected: weapon + e, spill, total: weapon + e + spill };
                if (sp.cantrip) { if (!cantrip || pick.total > cantrip.total) cantrip = pick; }
                else if (!slot || pick.total > slot.total) slot = pick;
            }
        }
        return { cantrip, slot };
    };
    /** Spend a slot or carry a cantrip: a slot is spent whether or not the Strike lands, and a magus has few. */
    const choose = (f, cantrip, slot) => {
        if (!cantrip && !slot) return null;
        const gain = cantrip && slot ? slot.total - cantrip.total : 0;
        const nearlyDown = f.hp > 0 && f.hp <= (cantrip?.expected ?? 0) + (slot?.expected ?? 0);
        const spend = !!slot && (!cantrip || (slot.hit >= 0.6 && gain >= 3 + (slot.sp.rank ?? 1)) || nearlyDown);
        return { best: spend ? slot : cantrip, other: spend ? cantrip : slot, gain, spend };
    };
    const carry = (x) => `${x.sp.name}${x.sp.cantrip ? "" : x.sp.focus ? " (1 Focus Point)" : ` (rank ${x.sp.rank})`}`;
    const what = (x) => (x?.sp?.focus ? "the Focus Point" : "the slot");
    const orText = (ch) => ch.other ? (ch.spend ? `; ${carry(ch.other)} keeps ${what(ch.best)} for about ${Math.round(ch.gain)} less` : ch.gain < 1 ? `; ${carry(ch.other)} would add nothing worth ${what(ch.other)}` : `; ${carry(ch.other)} would add about ${Math.round(ch.gain)} but spends ${what(ch.other)}${ch.other.hit < 0.6 ? " on a Strike that lands only about " + pct(ch.other.hit) + " of the time" : ""}`) : "";
    /** A Spellstrike plan that spends a slot joins spell thrift, but weighs its own slot (the Strike carries the spell). */
    const slotted = (plan, x) => { if (x && !x.sp.cantrip && !x.sp.focus) spendsSlot(plan, x.sp); plan.thrifted = true; return plan; };
    const spellText = (x, f) => isAttack(x.sp) ? ", the spell lands with the Strike" : `, ${nameOf(f)} saves against the spell as usual${x.sp.area && expansive ? ` (Expansive Spellstrike: its ${x.sp.area.shape} catches ${around(f, x.sp.area.shape === "burst" ? x.sp.area.size : 5).length ? around(f, x.sp.area.shape === "burst" ? x.sp.area.size : 5).map(nameOf).join(", ") : "nothing else"})` : ""}`;

    /**
     * The conflux spell's own Strikes at f with made attacks before them: one, or for Spinning Staff a second against a
     * different foe in reach at the next penalty (none when no other foe stands in reach).
     */
    const confluxStrikes = (f, made, at = board.me.rect) => {
        if (!recharger?.strike) return { ev: 0, text: "" };
        const m = recharger.strike === "melee";
        const b = bestStrike(board, f, { made, melee: m, extra: m ? stanceExtra : 0 });
        if (!b) return { ev: 0, text: "" };
        let ev = b.e.expected, text = `${b.s.label} at ${signed(b.bonus)}`;
        if (recharger.strikes > 1) {
            const g = foes.filter((o) => o !== f && inReach(at, o.rect, reach)).map((o) => ({ o, b: bestStrike(board, o, { made: made + 1, melee: true, extra: stanceExtra }) })).filter((x) => x.b).sort((x, y) => y.b.e.expected - x.b.e.expected)[0];
            if (g) { ev += g.b.e.expected; text += `, then ${nameOf(g.o)} at ${signed(g.b.bonus)}`; } else text += "; no second foe in reach for the other Strike";
        }
        return { ev, text };
    };
    /** What to do with a spare action after a Spellstrike: a conflux spell (recharges), the stance, an analysis, a Strike. */
    const after = (f, steps, ev, left, { useRanged = false } = {}) => {
        const notes = ["Spellstrike needs recharging before the next one: 1 action, or a conflux spell (1 Focus Point, no slot)."];
        if (left < 1) return { ev, notes };
        if (recharger) {
            let add = 0.8;
            let text = `${recharger.name} (conflux, 1 action, 1 Focus Point): ${recharger.text}; it recharges your Spellstrike`;
            const cs = confluxStrikes(f, 2);
            if (cs.text) { add += cs.ev; text += ` (${cs.text})`; }
            steps.push({ cost: 1, text }); ev += add;
            if (has(actor, "arcane-cascade") && !inStance) notes.push(`Arcane Cascade instead would give +${cascade} on your melee Strikes from now on.`);
            return { ev, notes };
        }
        if (has(actor, "arcane-cascade") && !inStance) {
            steps.push({ cost: 1, text: `Arcane Cascade: enter the stance (+${cascade} force on your melee Strikes${has(actor, "burning-cascade") ? `; Burning Cascade deals ${cascade} to each enemy within 5 feet` : ""}; after a spell this turn you can pick that spell's damage type instead)` });
            return { ev: ev + 0.8 * cascade, notes };
        }
        const b = bestStrike(board, f, { made: 2, melee: !useRanged, extra: useRanged ? 0 : stanceExtra });
        const alt = has(actor, "maguss-analysis") ? `Magus's Analysis: Recall Knowledge about ${nameOf(f)} (+1 if you hit it) and recharge Spellstrike` : has(actor, "running-recharge") ? "Running Recharge: recharge Spellstrike and Step or Stride half your Speed" : "recharge Spellstrike (1 action)";
        if (b && b.e.expected >= 2) steps.push({ cost: 1, text: `Strike ${nameOf(f)} with ${b.s.label} at ${signed(b.bonus)} (Spellstrike counts as two attacks), or ${alt}` });
        else steps.push({ cost: 1, text: `${alt.charAt(0).toUpperCase()}${alt.slice(1)}` });
        return { ev: ev + (b && b.e.expected >= 2 ? b.e.expected : 1), notes };
    };
    const extras = (f, steps) => {
        if (devastating) { const n = around(f, 5); if (n.length) { steps[steps.length - 1].text += `; Devastating Spellstrike: ${n.map(nameOf).join(", ")} take${n.length === 1 ? "s" : ""} ${devDmg + stanceExtra} on top`; return n.length * (devDmg + stanceExtra); } }
        return 0;
    };
    const planNotes = (f, ch) => {
        const notes = [];
        if (has(actor, "distracting-spellstrike") && !f.conditions?.has?.("off-guard")) notes.push(`Distracting Spellstrike (hand free): the same two actions also Feint ${nameOf(f)} right before the Strike${inStance ? `, at +${cascade} to Deception` : ""}; a success makes it off-guard for the Strike.`);
        if (has(actor, "overwhelming-spellstrike") && (f.iwr?.resist ?? []).some((r) => RESISTABLE.has(r.type))) notes.push(`Overwhelming Spellstrike: the spell ignores ${lv} of ${nameOf(f)}'s resistance to ${(f.iwr.resist.filter((r) => RESISTABLE.has(r.type)).map((r) => r.type)).join(", ")}.`);
        if (has(actor, "cascading-ray") && ch.best && (ch.best.sp.damageTypes ?? []).some((t) => ENERGY.has(t))) { const o = foes.find((x) => x !== f && feetBetween(f.rect, x.rect) <= 120); if (o) notes.push(`Cascading Ray (1 action, after the Spellstrike lands): a spell attack (${signed(spellAtk)}, no penalty) on ${nameOf(o)} for ${ch.best.sp.cantrip ? "1d4" : "1d8"} per rank.`); }
        if (has(actor, "killshots-report") && f.hp <= (ch.best?.expected ?? 0) * 1.5) notes.push(`Killshot's Report: if the Spellstrike drops ${nameOf(f)}, the spell also hits a creature within 10 feet of it.`);
        if (has(actor, "dispelling-spellstrike") && ctx.actions >= 3) notes.push("Dispelling Spellstrike (3 actions): the same Strike also counteracts one spell active on the target, at half your level.");
        if (has(actor, "sustaining-steel") && ch.spend) notes.push(`Sustaining Steel: casting from the slot heals you ${inStance ? 2 : 1} × its rank.`);
        return notes;
    };

    // --- Spellstrike: one foe, melee (moving if needed) or ranged with Starlit Span or Volatile Spark ----------------------
    // PF2e doesn't record the charge (see chargeOf): when the helper can't tell, the Spellstrike-first plans say they assume
    // it's charged, and the recharge-first plans further down are the turn for when it isn't.
    const assume = charge === null ? "This assumes your Spellstrike is charged. PF2e doesn't record it, so the helper can't see whether you've used it since you last recharged; if you haven't recharged, take a recharge-first plan." : null;
    const spellstrikeStep = (f, ch) => ({ cost: 2, text: `${ch.best.lunging ? "Lunging " : ""}Spellstrike ${nameOf(f)}${ch.best.lunging ? ` (your staff reaches ${5 * ch.best.sp.rank} feet farther)` : ""}: ${ch.best.s.label} (${signed(ch.best.bonus)}, hits about ${pct(ch.best.hit)}) carrying ${carry(ch.best)}${spellText(ch.best, f)}${orText(ch)}` });
    /** Where f can be Spellstruck from with made attacks before it: in reach now or after one Stride, ranged from here, a Lunging staff. */
    const optionsFor = (f, canStride, made) => {
        const options = [];
        const sq = canStride ? squareToReach(board, f, reach, 1) : (inReach(board.me.rect, f.rect, reach) ? { x: board.me.rect.x, y: board.me.rect.y, route: { actions: 0, provokes: [] } } : null);
        if (sq && melee.length) { const at = sq.route.actions ? { ...board.me.rect, x: sq.x, y: sq.y } : board.me.rect; options.push({ sq, at, useRanged: false, ...picks(f, { at, made }) }); }
        if (spellRanged.length) options.push({ sq: null, at: board.me.rect, useRanged: true, ...picks(f, { useRanged: true, made }) });
        // Lunging Spellstrike: a staff reaches 5 feet per rank farther with a slot spell, no move needed
        if (!sq && staff && has(actor, "lunging-spellstrike")) {
            const sb = staff.bonus + mapFor(made, staff.agile);
            const far = spells.filter((sp) => !sp.cantrip && feetBetween(board.me.rect, f.rect) <= (staff.reach || 5) + 5 * sp.rank);
            if (far.length) { const slot = far.map((sp) => { const c = degreeChances(sb, f.ac); const st = { hit: c.s + c.cs, crit: c.cs, critFail: c.cf }; const w = strikeExpected(sb, f.ac, staff.avg + stanceExtra, { deadly: staff.deadly }).expected; const { e, spill } = spellPart(sp, f, st); return { sp, s: staff, bonus: sb, hit: st.hit, expected: w + e, spill, total: w + e + spill, lunging: true }; }).sort((x, y) => y.total - x.total)[0]; options.push({ sq: { route: { actions: 0, provokes: [] } }, at: board.me.rect, useRanged: false, cantrip: null, slot }); }
        }
        return options;
    };
    if (ss && charge !== false && ctx.actions >= 2 && ctx.made === 0 && spells.length) {
        for (const f of foes) {
            for (const o of optionsFor(f, ctx.actions >= 3, 0)) {
                const ch = choose(f, o.cantrip, o.slot);
                if (!ch) continue;
                const steps = [];
                let ev = ch.best.total;
                if (o.sq?.route.actions) steps.push({ cost: o.sq.route.actions, text: moveText(o.sq, f) });
                steps.push(spellstrikeStep(f, ch));
                ev += extras(f, steps);
                const left = ctx.actions - 2 - (o.sq?.route.actions ?? 0);
                const r = after(f, steps, ev, left, { useRanged: o.useRanged });
                out.plans.push(slotted({ kind: "class", title: `${o.useRanged ? "Ranged " : ""}Spellstrike ${nameOf(f)}`, target: f, ev: r.ev, score: r.ev + 0.5, dest: o.sq?.route.actions ? { x: o.sq.x, y: o.sq.y } : null, steps, notes: [...(assume ? [assume] : []), ...r.notes, ...planNotes(f, ch)] }, ch.best));
            }
        }
        // Spell Swipe: two adjacent foes in reach, one attack roll against both; Whirlwind Spell: every foe in reach. One spell is
        // carried, so a foe other than the first takes it only when the spell has more than one target or an area.
        const inR = foes.filter((f) => melee.some((s) => inReach(board.me.rect, f.rect, s.reach || 5)));
        const spellOn = (x, g) => { const c = degreeChances(x.bonus, g.ac); return spellPart(x.sp, g, { hit: c.s + c.cs, crit: c.cs, critFail: c.cf }).e; };
        const multiOf = (x) => !!x.sp.area || /targets?|creatures/.test(String(x.sp.spell?.system?.target?.value ?? ""));
        if (ctx.actions >= 3 && has(actor, "spell-swipe") && inR.length >= 2) {
            for (let i = 0; i < inR.length; i++) for (let j = i + 1; j < inR.length; j++) {
                const a = inR[i], b = inR[j];
                if (feetBetween(a.rect, b.rect) > 5) continue;
                const pa = choose(a, ...Object.values(picks(a)));
                if (!pa) continue;
                const x = pa.best, multi = multiOf(x);
                const wa = strikeExpected(x.bonus, a.ac, x.s.avg + stanceExtra, { deadly: x.s.deadly }).expected;
                const wb = strikeExpected(x.bonus, b.ac, x.s.avg + stanceExtra, { deadly: x.s.deadly }).expected;
                const ev = wa + wb + (x.expected - wa) + (multi ? spellOn(x, b) : 0);
                out.plans.push(slotted({ kind: "class", title: `Spell Swipe ${nameOf(a)} and ${nameOf(b)}`, target: a, ev, score: ev + 0.4, dest: null, steps: [{ cost: 3, text: `Spell Swipe: one Strike with ${x.s.label} (${signed(x.bonus)}) against both ${nameOf(a)} and ${nameOf(b)}, carrying ${carry(x)}; the spell ${multi ? "affects every foe you hit" : "affects one of them, your pick"}${orText(pa)}` }], notes: [...(assume ? [assume] : []), "Spell Swipe counts as two attacks, applied after both Strikes."] }, x));
            }
        }
        if (ctx.actions >= 3 && has(actor, "whirlwind-spell") && inR.length >= 2) {
            const lead = choose(inR[0], ...Object.values(picks(inR[0])));
            if (lead) {
                const x = lead.best, multi = multiOf(x);
                let ev = 0;
                for (const g of inR) { const w = strikeExpected(x.bonus, g.ac, x.s.avg + stanceExtra, { deadly: x.s.deadly }).expected; ev += w + (multi || g === inR[0] ? spellOn(x, g) : 0); }
                out.plans.push(slotted({ kind: "class", title: `Whirlwind Spell on ${inR.length} foes`, target: inR[0], ev, score: ev + 0.4, dest: null, steps: [{ cost: 3, text: `Whirlwind Spell: a Strike at full bonus against ${inR.map((g) => nameOf(g)).join(", ")} carrying ${carry(x)}; the spell ${multi ? "affects every foe you hit" : "affects one of them"}` }], notes: [...(assume ? [assume] : []), "The penalty climbs only after all the Strikes."] }, x));
            }
        }
    }
    // --- Recharge first, then Spellstrike: the turn when the Spellstrike is spent (or may be) ---------------------------------
    if (ss && charge !== true && ctx.actions >= 3 && ctx.made === 0 && spells.length) {
        const spentNote = charge === false ? "Your Spellstrike is spent, so the recharge comes first." : "For when your Spellstrike is spent (you've used it and haven't recharged since): recharge first.";
        const speedHalf = half(allySpeed(board.me));
        for (const f of foes) {
            let best = null;
            const consider = (way, o) => {
                const ch = choose(f, o.cantrip, o.slot);
                if (!ch) return;
                const steps = [way.step, ...(o.sq?.route.actions && !way.moves ? [{ cost: o.sq.route.actions, text: moveText(o.sq, f) }] : []), spellstrikeStep(f, ch)];
                const ev = way.ev + ch.best.total + extras(f, steps);
                if (!best || ev > best.ev) best = { ev, steps, ch, o, way };
            };
            const near = inReach(board.me.rect, f.rect, reach);
            // a plain recharge, or Magus's Analysis (it recharges too and Recalls Knowledge), then a Spellstrike from here
            const plain = has(actor, "maguss-analysis") ? { step: { cost: 1, text: `Magus's Analysis: Recall Knowledge about ${nameOf(f)}, and your Spellstrike is recharged (once a day per creature)` }, ev: 0.3 } : { step: { cost: 1, text: "Recharge your Spellstrike (1 action, concentrate)" }, ev: 0 };
            for (const o of optionsFor(f, false, 0)) consider(plain, o);
            // Running Recharge: the recharge comes with a Step or a Stride of half your Speed, into reach
            if (!near && has(actor, "running-recharge") && melee.length) {
                const sq = squareToReach(board, f, reach, 1);
                if (sq && sq.route.actions === 1 && Number.isFinite(sq.route.feet) && sq.route.feet <= speedHalf) {
                    const at = { ...board.me.rect, x: sq.x, y: sq.y };
                    consider({ step: { cost: 1, text: `Running Recharge: Stride ${sq.route.feet} feet into reach of ${nameOf(f)} and recharge your Spellstrike` }, ev: 0, moves: true }, { sq, at, useRanged: false, ...picks(f, { at }) });
                }
            }
            // a conflux spell: its own Strike, then the Spellstrike at the next penalty
            if (recharger && (recharger.strike !== "melee" || near) && (recharger.strike !== "ranged" || spellRanged.length || ranged.length)) {
                const cs = confluxStrikes(f, 0);
                const madeAfter = recharger.strike ? recharger.strikes : 0;
                const way = { step: { cost: 1, text: `${recharger.name} (conflux, 1 action, 1 Focus Point): ${recharger.text}${cs.text ? ` (${cs.text})` : ""}; it recharges your Spellstrike` }, ev: cs.ev }; // the recharge is spent again by the Spellstrike
                for (const o of optionsFor(f, false, madeAfter)) consider(way, o);
            }
            if (!best) continue;
            const notes = [spentNote, "It's spent again after this Spellstrike; recharge it next turn (1 action) or with a conflux spell.", ...planNotes(f, best.ch)];
            out.plans.push(slotted({ kind: "class", title: `Recharge, then ${best.o.useRanged ? "ranged " : ""}Spellstrike ${nameOf(f)}`, target: f, ev: best.ev, score: best.ev + 0.4, dest: best.o.sq?.route.actions ? { x: best.o.sq.x, y: best.o.sq.y } : null, steps: best.steps, notes }, best.ch.best));
        }
    }
    // --- Spellstrike already used this turn: recharge it with Strikes, or spend the actions on the stance ------------
    if (ss && ctx.made >= 1 && ctx.actions >= 2 && has(actor, "recharging-flurry") && melee.length >= 2 && foes.length) {
        for (const f of foes.filter((x) => inReach(board.me.rect, x.rect, reach))) {
            const w = melee.slice(0, 2);
            let made = ctx.made, ev = 0;
            const shown = [];
            for (const s of w) { const b = s.bonus + mapFor(made, s.agile); ev += strikeExpected(b, f.ac, s.avg + stanceExtra, { deadly: s.deadly }).expected; shown.push(`${s.label} (${signed(b)})`); made += 1; }
            out.plans.push({ kind: "class", title: `Recharging Flurry on ${nameOf(f)}`, target: f, ev: ev + 1, score: ev + 1.3, dest: null, steps: [{ cost: 2, text: `Recharging Flurry: ${shown.join(" and ")} against ${nameOf(f)}, then your Spellstrike is recharged whether or not they hit` }], notes: [] });
        }
    }
    if (ss && ctx.made >= 1 && ctx.actions >= 1 && recharger?.strike && foes.length) {
        const rReach = recharger.reach ?? reach;
        const shoot = recharger.firearm ? ranged.filter(isFirearm) : ranged;
        for (const f of foes.filter((x) => recharger.strike === "melee" ? inReach(board.me.rect, x.rect, rReach) : shoot.some((s) => feetBetween(board.me.rect, x.rect) <= (s.range ?? 30)))) {
            const cs = confluxStrikes(f, ctx.made);
            if (!cs.text) continue;
            const ev = cs.ev + 0.8;
            out.plans.push({ kind: "class", title: `${recharger.name} on ${nameOf(f)}`, target: f, ev, score: ev + 0.3, dest: null, steps: [{ cost: 1, text: `${recharger.name} (conflux, 1 Focus Point): ${recharger.text} (${cs.text}); it recharges your Spellstrike` }], notes: [] });
        }
    }
    if (ss && ctx.made >= 1 && ctx.actions >= 1 && !recharger) out.notes.push(`If your Spellstrike isn't charged, ${has(actor, "running-recharge") ? "Running Recharge (1 action) recharges it and moves you" : has(actor, "maguss-analysis") ? "Magus's Analysis (1 action) recharges it and Recalls Knowledge" : "recharging it takes 1 action"}.`);
    // --- Spell Crash: a prepared slot as an area blast when foes bunch up ------------------------------------------
    if (has(actor, "spell-crash") && ctx.actions >= 2) {
        const slots = spells.filter((sp) => !sp.cantrip);
        const near = foes.filter((f) => feetBetween(board.me.rect, f.rect) <= 15);
        if (slots.length && near.length >= 2) out.notes.push(`Spell Crash (2 actions): spend a prepared slot for a blast (cone, line or burst from you) that hits ${near.map(nameOf).join(", ")}, scaled by the slot's rank with a basic save; a shove weapon pushes, a trip weapon knocks prone. It uses up your Spellstrike charge.`);
    }

    // --- Notes: stance, study, conflux and focus, and the when-notes ----------------------------------------------
    if (has(actor, "arcane-cascade")) out.notes.push(inStance ? `Arcane Cascade is up: +${cascade} force on your melee Strikes and resistance ${cascade} to spell damage.` : `Arcane Cascade (1 action, best right after a spell): +${cascade} force on your melee Strikes and resistance ${cascade} to spells while the stance lasts${spec ? "" : "; it grows to 2 at 7th and 3 at 15th"}.`);
    if (study) out.notes.push(STUDIES[study].text);
    if (conflux.length) out.notes.push(`Conflux spells (1 action, 1 Focus Point each, ${fp ?? 0} left): ${conflux.map((c) => `${c.name}, ${c.text}`).join("; ")}. Each recharges your Spellstrike.${has(actor, "conflux-focus") ? " Conflux Focus: Refocus refills the whole pool." : ""}`);
    if (has(actor, "standby-spell")) out.notes.push(`Standby Spell: your chosen spell can be cast from any slot of its rank or higher without being prepared, so a Spellstrike never lacks it.`);
    if (has(actor, "spell-parry") && ctx.actions >= 1) out.notes.push("Spell Parry (1 action, a hand free): +1 AC and +1 to saves against spells until your next turn.");
    if (has(actor, "raise-a-tome") && !board.me.shield) out.notes.push("Raise a Tome: Raise a Shield with your spellbook instead, for +2 AC until your next turn.");
    if (has(actor, "steady-spellcasting-magus") && foes.some((f) => f.reactiveStrike && inReach(f.rect, board.me.rect, f.reach ?? 5))) out.notes.push("Steady Spellcasting: if a reaction would disrupt your spell, a DC 15 flat check keeps it.");
    if (has(actor, "emergency-targe")) out.notes.push("Emergency Targe fires when an enemy hits you with a Strike or spell attack or you fail a save against its spell: you Raise a Shield or cast shield against that very attack.");
    if (has(actor, "spell-retaliation")) out.notes.push("Spell Retaliation (free): when you save against an enemy's spell or its spell attack misses you, your Spellstrike recharges.");
    if (has(actor, "capture-magic")) out.notes.push("Capture Magic fires when you save against a harmful spell: you enter Arcane Cascade in that spell's damage type, or amplify the stance by +2 until your next turn.");
    if (has(actor, "rapid-recharge")) out.notes.push("Rapid Recharge (free, once a day): recharge your Spellstrike on the spot.");
    if (has(actor, "preternatural-parry")) out.notes.push("Preternatural Parry fires when a Strike, spell attack or spell save targets you (hand free): +2 AC and saves against it.");
    if (has(actor, "stolen-spell")) out.notes.push("Stolen Spell (free): when you critically succeed against an enemy's spell, you can cast that spell once before your next turn ends, at no slot; in a Spellstrike against its caster, it's off-guard to your Strike.");
    if (has(actor, "versatile-spellstrike")) out.notes.push("Versatile Spellstrike: your open slot casts any spell from your spellbook, 2 ranks lower, as part of a Spellstrike.");
    if (has(actor, "supreme-spellstrike")) out.notes.push("Supreme Spellstrike: you're always quickened; the extra action Strikes or recharges Spellstrike.");
    if (has(actor, "arcane-shroud") && !inStance) out.notes.push("Arcane Shroud: entering Arcane Cascade also gives you one of your chosen aftereffect spells until your next turn ends.");
    if (has(actor, "resounding-cascade") && inStance) out.notes.push("Resounding Cascade: allies within your aura share the stance's base extra damage and resistance.");
    if (has(actor, "meteoric-spellstrike") && ranged.length) out.notes.push(`Meteoric Spellstrike (2 actions, slot spell): a ranged Spellstrike within the first range increment; everything in the line between you and the target takes twice the spell's rank.`);
    if (has(actor, "sprinting-spellstrike")) out.notes.push("Sprinting Spellstrike: with a line spell, you Stride in a straight line up to the line's length first, through enemies and without triggering reactions.");
    if (has(actor, "split-spellstrike") && melee.length >= 2) out.notes.push("Split Spellstrike (2 actions, two weapons, a multi-target or area spell): one Strike with each weapon at two different foes, both carrying the spell.");
    if (has(actor, "unsheathing-the-sword-light")) out.notes.push("Unsheathing the Sword-Light (2 actions, a one-handed sword, slot spell): a Spellstrike whose light copies deal twice the spell's rank to every creature within 10 feet of the target.");
    if (has(actor, "double-spellstrike")) out.notes.push("Double Spellstrike (once a day): a Spellstrike carrying two spells with ranks totalling 10 or less.");
}

export { magus };
