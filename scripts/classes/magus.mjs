/**
 * PF2e Tactics: classes/magus.mjs
 * See classes/_common.mjs for the shape of a class read.
 * Gate: class magus, or the spellstrike feature (Magus Dedication's Spellstrike at 4th).
 * Reads: Spellstrike (cantrip vs slot, melee or ranged with Starlit Span), the hybrid studies and their conflux spells
 * (a third action that recharges Spellstrike while Focus Points remain), Arcane Cascade with its specialization steps,
 * Expansive/Devastating/Distracting/Lunging/Overwhelming/Dispelling Spellstrike, Spell Swipe, Whirlwind Spell,
 * Recharging Flurry, Running Recharge, Magus's Analysis, Cascading Ray, Spell Crash, and when-notes for the rest.
 */
import { bestStrike, canMove, castable, effect, focusLeft, has, half, level, markOffGuard, moveText, myReach, allySpeed, pct, squareToReach, strikeRun, targets, worth, degreeChances, feetBetween, inReach, mapFor, strikeExpected, saveExpected, CONDITION_VALUE, nameOf, reachableSquares, signed } from "./_common.mjs";

const ENERGY = new Set(["acid", "cold", "electricity", "fire", "force", "sonic", "vitality", "void"]);
const RESISTABLE = new Set(["acid", "cold", "electricity", "fire", "sonic"]);
/** The hybrid studies: what the study does on a turn, and its conflux spell (1 action, 1 Focus Point, recharges Spellstrike). */
const STUDIES = {
    "inexorable-iron": { name: "Inexorable Iron", conflux: "Thunderous Strike", re: /thunderous-strike/, confluxText: "a Strike with your two-handed weapon whose shockwave also hits what stands in a line behind the target (basic Reflex)", text: "Inexorable Iron: at the start of each turn you're below full HP while holding your weapon in two hands, you gain temporary HP equal to half your level." },
    "laughing-shadow": { name: "Laughing Shadow", conflux: "Dimensional Assault", re: /dimensional-assault/, confluxText: "teleport to a square you can see within your Speed, then a melee Strike", text: "Laughing Shadow: in Arcane Cascade you move faster, and with a one-handed weapon and a free hand the stance's extra damage is 2 higher." },
    "sparkling-targe": { name: "Sparkling Targe", conflux: "Shielding Strike", re: /shielding-strike/, confluxText: "a melee Strike, then Raise your Shield for free", text: "Sparkling Targe: while your shield is raised, its bonus also counts on your saves against spells; Arcane Cascade adds its resistance to your Shield Block." },
    "starlit-span": { name: "Starlit Span", conflux: "Shooting Star", re: /shooting-star/, confluxText: "a ranged Strike that ignores the target's concealment and lesser cover", text: "Starlit Span: your Spellstrike works with a ranged weapon against a target in its first range increment." },
    "twisting-tree": { name: "Twisting Tree", conflux: "Spinning Staff", re: /spinning-staff/, confluxText: "two staff Strikes against two different foes", text: "Twisting Tree: you can change your grip on the staff as a free action, so it works one-handed with a hand free or two-handed for the bigger die." },
};
/** Other conflux spells, from feats. */
const CONFLUX_FEATS = [
    ["force-fang", "Force Fang", /force-fang/, "1d4 force (+1d4 per 2 ranks) to one creature within 30 feet, no roll"],
    ["conjurer-s-countermeasure", "Conjurer's Countermeasure", /conjurer/, "resistance to the spell damage you choose until your next turn"],
    ["runic-impression", "Runic Impression", /runic-impression/, "your weapon gains a property rune for a minute"],
    ["hasted-assault", "Hasted Assault", /hasted-assault/, "you're quickened for a minute (Strike or Stride with the extra action)"],
];
const isAttack = (sp) => sp.attack !== null && sp.attack !== undefined;

function magus(board, ctx, out) {
    const actor = board.me.actor;
    const lv = level(board);
    if (!has(actor, "spellstrike")) return;
    const inStance = !!effect(actor, /arcane-cascade/);
    const fp = focusLeft(actor);
    const study = Object.keys(STUDIES).find((s) => has(actor, s)) ?? null;
    const starlit = study === "starlit-span";
    const spec = has(actor, "weapon-specialization") || (actor?.class?.slug === "magus" && lv >= 7);
    const gSpec = has(actor, "greater-weapon-specialization") || (actor?.class?.slug === "magus" && lv >= 15);
    const cascade = 1 + (spec ? 1 : 0) + (gSpec ? 1 : 0);
    const stanceExtra = inStance ? cascade : 0;
    const foes = targets(board).filter((f) => f.hp > 0);
    const reach = myReach(board);
    const melee = board.strikes.filter((s) => !s.ranged);
    const ranged = board.strikes.filter((s) => s.ranged);
    const staff = board.strikes.find((s) => !s.ranged && (/staff/i.test(s.label) || s.traits?.includes("staff")));
    const spellAtk = board.spells.find((sp) => isAttack(sp))?.attack ?? lv + 4 + 3;
    const expansive = has(actor, "expansive-spellstrike");
    const devastating = has(actor, "devastating-spellstrike");
    const devDmg = lv >= 19 ? 5 : lv >= 14 ? 4 : lv >= 9 ? 3 : 2;
    // Spells a Spellstrike can carry: 1-2 actions, an attack roll or a save, damage; area spells only with Expansive Spellstrike
    const spells = board.spells.filter((sp) => sp.cost !== null && sp.cost <= 2 && !sp.consumable && (isAttack(sp) || sp.save?.stat) && sp.avg > 0 && !sp.heals && (!sp.area || expansive));
    const conflux = [];
    if (study) { const s = STUDIES[study]; const sp = board.spells.find((x) => s.re.test((x.name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-"))); conflux.push({ name: sp?.name ?? s.conflux, text: s.confluxText, strike: study !== "starlit-span" ? "melee" : "ranged", strikes: study === "twisting-tree" ? 2 : 1 }); }
    for (const [slug, name, re, text] of CONFLUX_FEATS) if (has(actor, slug)) conflux.push({ name: board.spells.find((x) => re.test((x.name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-")))?.name ?? name, text, strike: null });
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
        const list = useRanged ? ranged.filter((s) => feetBetween(at, f.rect) <= (s.range ?? 30)) : melee.filter((s) => inReach(at, f.rect, s.reach || 5));
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
    const carry = (x) => `${x.sp.name}${x.sp.cantrip ? "" : ` (rank ${x.sp.rank})`}`;
    const orText = (ch) => ch.other ? (ch.spend ? `; ${carry(ch.other)} keeps the slot for about ${Math.round(ch.gain)} less` : ch.gain < 1 ? `; ${carry(ch.other)} would add nothing worth its slot` : `; ${carry(ch.other)} would add about ${Math.round(ch.gain)} but spends the slot${ch.other.hit < 0.6 ? " on a Strike that lands only about " + pct(ch.other.hit) + " of the time" : ""}`) : "";
    const spellText = (x, f) => isAttack(x.sp) ? ", the spell lands with the Strike" : `, ${nameOf(f)} saves against the spell as usual${x.sp.area && expansive ? ` (Expansive Spellstrike: its ${x.sp.area.shape} catches ${around(f, x.sp.area.shape === "burst" ? x.sp.area.size : 5).length ? around(f, x.sp.area.shape === "burst" ? x.sp.area.size : 5).map(nameOf).join(", ") : "nothing else"})` : ""}`;

    /** What to do with a spare action after a Spellstrike: a conflux spell (recharges), the stance, an analysis, a Strike. */
    const after = (f, steps, ev, left, { useRanged = false } = {}) => {
        const notes = ["Spellstrike needs recharging before the next one: 1 action, or a conflux spell (1 Focus Point, no slot)."];
        if (left < 1) return { ev, notes };
        if (recharger) {
            let add = 0.8;
            let text = `${recharger.name} (conflux, 1 action, 1 Focus Point): ${recharger.text}; it recharges your Spellstrike`;
            if (recharger.strike) {
                const b = bestStrike(board, f, { made: 2, melee: recharger.strike === "melee", extra: recharger.strike === "melee" ? stanceExtra : 0 });
                if (b) { add += b.e.expected * recharger.strikes; text += ` (${b.s.label} at ${signed(b.bonus)}${recharger.strikes > 1 ? ", twice" : ""})`; }
            }
            steps.push({ cost: 1, text }); ev += add;
            if (has(actor, "arcane-cascade") && !inStance) notes.push(`Arcane Cascade instead would give +${cascade} on your melee Strikes from now on.`);
            return { ev, notes };
        }
        if (has(actor, "arcane-cascade") && !inStance) {
            steps.push({ cost: 1, text: `Arcane Cascade: enter the stance (+${cascade} force on your melee Strikes${has(actor, "burning-cascade") ? `; Burning Cascade deals ${cascade} to each enemy within 5 feet` : ""}; after a spell this turn you can pick that spell's damage type instead)` });
            return { ev: ev + 0.8 * cascade, notes };
        }
        const b = bestStrike(board, f, { made: 2, melee: !useRanged, extra: useRanged ? 0 : stanceExtra });
        const alt = has(actor, "magus-s-analysis") ? `Magus's Analysis: Recall Knowledge about ${nameOf(f)} (+1 if you hit it) and recharge Spellstrike` : has(actor, "running-recharge") ? "Running Recharge: recharge Spellstrike and Step or Stride half your Speed" : "recharge Spellstrike (1 action)";
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
        if (has(actor, "killshot-s-report") && f.hp <= (ch.best?.expected ?? 0) * 1.5) notes.push(`Killshot's Report: if the Spellstrike drops ${nameOf(f)}, the spell also hits a creature within 10 feet of it.`);
        if (has(actor, "dispelling-spellstrike") && ctx.actions >= 3) notes.push("Dispelling Spellstrike (3 actions): the same Strike also counteracts one spell active on the target, at half your level.");
        if (has(actor, "sustaining-steel") && ch.spend) notes.push(`Sustaining Steel: casting from the slot heals you ${inStance ? 2 : 1} × its rank.`);
        return notes;
    };

    // --- Spellstrike: one foe, melee (moving if needed) or ranged with Starlit Span ----------------------------------
    if (ctx.actions >= 2 && ctx.made === 0 && spells.length) {
        for (const f of foes) {
            const options = [];
            const sq = ctx.actions >= 3 ? squareToReach(board, f, reach, 1) : (inReach(board.me.rect, f.rect, reach) ? { x: board.me.rect.x, y: board.me.rect.y, route: { actions: 0, provokes: [] } } : null);
            if (sq && melee.length) { const at = sq.route.actions ? { ...board.me.rect, x: sq.x, y: sq.y } : board.me.rect; options.push({ sq, at, useRanged: false, ...picks(f, { at }) }); }
            if (starlit && ranged.length) options.push({ sq: null, at: board.me.rect, useRanged: true, ...picks(f, { useRanged: true }) });
            // Lunging Spellstrike: a staff reaches 5 feet per rank farther with a slot spell, no move needed
            if (!sq && staff && has(actor, "lunging-spellstrike")) {
                const far = spells.filter((sp) => !sp.cantrip && feetBetween(board.me.rect, f.rect) <= (staff.reach || 5) + 5 * sp.rank);
                if (far.length) { const slot = far.map((sp) => { const c = degreeChances(staff.bonus, f.ac); const st = { hit: c.s + c.cs, crit: c.cs, critFail: c.cf }; const w = strikeExpected(staff.bonus, f.ac, staff.avg + stanceExtra, { deadly: staff.deadly }).expected; const { e, spill } = spellPart(sp, f, st); return { sp, s: staff, bonus: staff.bonus, hit: st.hit, expected: w + e, spill, total: w + e + spill, lunging: true }; }).sort((a, b) => b.total - a.total)[0]; options.push({ sq: { route: { actions: 0, provokes: [] } }, at: board.me.rect, useRanged: false, cantrip: null, slot }); }
            }
            for (const o of options) {
                const ch = choose(f, o.cantrip, o.slot);
                if (!ch) continue;
                const steps = [];
                let ev = ch.best.total;
                if (o.sq?.route.actions) steps.push({ cost: o.sq.route.actions, text: moveText(o.sq, f) });
                steps.push({ cost: 2, text: `${ch.best.lunging ? "Lunging " : ""}Spellstrike ${nameOf(f)}${ch.best.lunging ? ` (your staff reaches ${5 * ch.best.sp.rank} feet farther)` : ""}: ${ch.best.s.label} (${signed(ch.best.bonus)}, hits about ${pct(ch.best.hit)}) carrying ${carry(ch.best)}${spellText(ch.best, f)}${orText(ch)}` });
                ev += extras(f, steps);
                const left = ctx.actions - 2 - (o.sq?.route.actions ?? 0);
                const r = after(f, steps, ev, left, { useRanged: o.useRanged });
                out.plans.push({ kind: "class", title: `${o.useRanged ? "Ranged " : ""}Spellstrike ${nameOf(f)}`, target: f, ev: r.ev, score: r.ev + 0.5, dest: o.sq?.route.actions ? { x: o.sq.x, y: o.sq.y } : null, steps, notes: [...r.notes, ...planNotes(f, ch)] });
            }
        }
        // Spell Swipe: two adjacent foes in reach, both Struck at full bonus; Whirlwind Spell: every foe in reach
        const inR = foes.filter((f) => melee.some((s) => inReach(board.me.rect, f.rect, s.reach || 5)));
        if (ctx.actions >= 3 && has(actor, "spell-swipe") && inR.length >= 2) {
            for (let i = 0; i < inR.length; i++) for (let j = i + 1; j < inR.length; j++) {
                const a = inR[i], b = inR[j];
                if (feetBetween(a.rect, b.rect) > 5) continue;
                const pa = choose(a, ...Object.values(picks(a))), pb = choose(b, ...Object.values(picks(b)));
                if (!pa || !pb) continue;
                // One Strike each at full bonus; the spell lands on one unless it has targets or an area
                const multi = pa.best.sp.area || /targets?/.test(String(pa.best.sp.spell?.system?.target?.value ?? "")) || (pa.best.sp.spell?.system?.target?.value ?? "").includes("creatures");
                const wa = strikeExpected(pa.best.bonus, a.ac, pa.best.s.avg + stanceExtra, { deadly: pa.best.s.deadly }).expected;
                const wb = strikeExpected(pb.best.s.bonus, b.ac, pb.best.s.avg + stanceExtra, { deadly: pb.best.s.deadly }).expected;
                const ev = wa + wb + (pa.best.expected - wa) + (multi ? (pb.best.expected - wb) : 0);
                out.plans.push({ kind: "class", title: `Spell Swipe ${nameOf(a)} and ${nameOf(b)}`, target: a, ev, score: ev + 0.4, dest: null, steps: [{ cost: 3, text: `Spell Swipe: Strike ${nameOf(a)} and ${nameOf(b)} with ${pa.best.s.label} (${signed(pa.best.bonus)} each) carrying ${carry(pa.best)}; the spell ${multi ? "affects every foe you hit" : "affects one of them, your pick"}${orText(pa)}` }], notes: ["Spell Swipe counts as two attacks, applied after both Strikes."] });
            }
        }
        if (ctx.actions >= 3 && has(actor, "whirlwind-spell") && inR.length >= 2) {
            const chs = inR.map((f) => ({ f, ch: choose(f, ...Object.values(picks(f))) })).filter((x) => x.ch);
            if (chs.length >= 2) {
                const lead = chs[0].ch;
                const multi = !!lead.best.sp.area || (lead.best.sp.spell?.system?.target?.value ?? "").includes("creatures");
                let ev = 0;
                for (const x of chs) { const w = strikeExpected(x.ch.best.s.bonus, x.f.ac, x.ch.best.s.avg + stanceExtra, { deadly: x.ch.best.s.deadly }).expected; ev += w + (multi || x === chs[0] ? x.ch.best.expected - w : 0); }
                out.plans.push({ kind: "class", title: `Whirlwind Spell on ${chs.length} foes`, target: chs[0].f, ev, score: ev + 0.4, dest: null, steps: [{ cost: 3, text: `Whirlwind Spell: a Strike at full bonus against ${chs.map((x) => nameOf(x.f)).join(", ")} carrying ${carry(lead.best)}; the spell ${multi ? "affects every foe you hit" : "affects one of them"}` }], notes: ["The penalty climbs only after all the Strikes."] });
            }
        }
    }
    // --- Spellstrike already used this turn: recharge it with Strikes, or spend the actions on the stance ------------
    if (ctx.made >= 1 && ctx.actions >= 2 && has(actor, "recharging-flurry") && melee.length >= 2 && foes.length) {
        for (const f of foes.filter((x) => inReach(board.me.rect, x.rect, reach))) {
            const w = melee.slice(0, 2);
            let made = ctx.made, ev = 0;
            const shown = [];
            for (const s of w) { const b = s.bonus + mapFor(made, s.agile); ev += strikeExpected(b, f.ac, s.avg + stanceExtra, { deadly: s.deadly }).expected; shown.push(`${s.label} (${signed(b)})`); made += 1; }
            out.plans.push({ kind: "class", title: `Recharging Flurry on ${nameOf(f)}`, target: f, ev: ev + 1, score: ev + 1.3, dest: null, steps: [{ cost: 2, text: `Recharging Flurry: ${shown.join(" and ")} against ${nameOf(f)}, then your Spellstrike is recharged whether or not they hit` }], notes: [] });
        }
    }
    if (ctx.made >= 1 && ctx.actions >= 1 && recharger?.strike && foes.length) {
        for (const f of foes.filter((x) => recharger.strike === "melee" ? inReach(board.me.rect, x.rect, reach) : ranged.some((s) => feetBetween(board.me.rect, x.rect) <= (s.range ?? 30)))) {
            const b = bestStrike(board, f, { made: ctx.made, melee: recharger.strike === "melee", extra: recharger.strike === "melee" ? stanceExtra : 0 });
            if (!b) continue;
            const ev = b.e.expected * recharger.strikes + 0.8;
            out.plans.push({ kind: "class", title: `${recharger.name} on ${nameOf(f)}`, target: f, ev, score: ev + 0.3, dest: null, steps: [{ cost: 1, text: `${recharger.name} (conflux, 1 Focus Point): ${recharger.text} (${b.s.label} at ${signed(b.bonus)}); it recharges your Spellstrike` }], notes: [] });
        }
    }
    if (ctx.made >= 1 && ctx.actions >= 1 && !recharger) out.notes.push(`If your Spellstrike isn't charged, ${has(actor, "running-recharge") ? "Running Recharge (1 action) recharges it and moves you" : has(actor, "magus-s-analysis") ? "Magus's Analysis (1 action) recharges it and Recalls Knowledge" : "recharging it takes 1 action"}.`);
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
