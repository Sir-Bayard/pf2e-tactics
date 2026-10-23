/**
 * PF2e Tactics: classes/inventor.mjs
 * See classes/_common.mjs for the shape of a class read.
 * Reads Overdrive (up or not: the Crafting check against the level's standard DC, the damage by tier, the mark on every
 * Strike), the innovation (weapon: the Strike on the sheet; armor: the suit; construct: the companion on the field and its
 * Command), Offensive Boost and Persistent Boost on the innovation's Strikes, and the unstable economy: one unstable action a
 * fight unless the DC 17 flat check passed. Plans: Overdrive then Strike, Megaton Strike (stable and unstable, Gigaton's
 * push), Explode, Megavolt, Searing Restoration, Tamper then Strike, Oil Fire, Electrify Armor, Wukong Extension, Overdrive
 * Ally, Helpful Tinkering, Command (and Lock On), Engine of Destruction, Devastating Weaponry. The rest are when-notes.
 */
import { effect, has, level, pct, squareToReach, strikeRun, targets, worth, degreeChances, feetBetween, inReach, mapFor, strikeExpected, saveExpected, nameOf, signed } from "./_common.mjs";
import { averageOf } from "../reader.mjs";

/** Foundry's slugs drop apostrophes ("hunters-aim"); the catalog's keep a dash for them ("hunter-s-aim"). Both are tried. */
const hasAny = (actor, ...slugs) => slugs.some((s) => has(actor, s));
const abil = (actor, k) => Number(actor?.abilities?.[k]?.mod ?? actor?.system?.abilities?.[k]?.mod) || 0;
/** The standard DC by level (Player Core, Table 10-5), level 0 to 20. */
const STANDARD_DC = [14, 15, 16, 18, 19, 20, 22, 23, 24, 26, 27, 28, 30, 31, 32, 34, 35, 36, 38, 39, 40];
const standardDC = (lv) => STANDARD_DC[Math.max(0, Math.min(20, lv))];
const classDC = (actor, lv) => Number(actor?.classDC?.value ?? actor?.system?.attributes?.classDC?.value) || 10 + lv + 4 + (lv >= 17 ? 6 : lv >= 9 ? 4 : 2);
const crafting = (actor, lv) => { const c = actor?.skills?.crafting; return c && c.mod != null ? Number(c.mod) || 0 : lv + abil(actor, "int") + (lv >= 15 ? 8 : lv >= 7 ? 6 : lv >= 3 ? 4 : 2); };
const strikeText = (f, used, tail = "") => `Strike ${nameOf(f)} with ${used[0].s.label}${used.length > 1 ? ` ${used.length === 2 ? "twice" : "three times"}` : ""} (${used.map((u) => signed(u.bonus)).join(", ")})${tail}`;
/** A Strike's weapon die (faces) and dice count, from the sheet's item or the mock's shorthand. */
const dieOf = (s) => Number(String(s?.item?.system?.damage?.die ?? s?.die ?? "d8").replace("d", "")) || 8;
/** The flat check after an unstable action: DC 17, so one roll in five keeps the innovation going; 7 or less is a critical failure. */
const UNSTABLE_PASS = 0.2, UNSTABLE_CRIT = 0.35;
/** Rect centres in feet, for the line of a Megavolt. */
const centre = (r) => ({ x: (r.x + r.w / 2) * 5, y: (r.y + r.h / 2) * 5 });
/** Foes on a line of the given length from origin o through the centre of foe f (the line is 5 feet wide). */
function onLine(o, f, candidates, length) {
    const O = centre(o), T = centre(f.rect);
    const dx = T.x - O.x, dy = T.y - O.y, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    return candidates.filter((g) => {
        const G = centre(g.rect);
        const t = (G.x - O.x) * ux + (G.y - O.y) * uy;
        if (t <= 0 || t > length + 2.5 * g.rect.w) return false;
        const perp = Math.abs((G.x - O.x) * uy - (G.y - O.y) * ux);
        return perp <= 2.5 * g.rect.w + 1.5;
    });
}

/** The character's construct companion on the field, or null: a construct minion among the allies, or an actor that names it as master. */
function findConstruct(board) {
    const me = board.me.actor;
    const isMine = (a) => {
        const ac = a.actor;
        const traits = new Set([...(a.traits ?? []), ...(ac?.system?.traits?.value ?? [])]);
        const cls = String(a.cls ?? ac?.class?.slug ?? ac?.class?.name ?? ac?.system?.details?.class?.name ?? "").toLowerCase();
        const master = ac?.system?.master?.id ?? ac?.flags?.pf2e?.master ?? ac?.flags?.pf2e?.masterId ?? null;
        if (master && me?.id && master === me.id) return true;
        if (traits.has("construct") && (traits.has("minion") || /construct/.test(cls))) return true;
        return /construct-companion|construct companion/.test(cls);
    };
    return (board.allies ?? []).find((a) => a.hp > 0 && isMine(a)) ?? null;
}
/** The construct's melee Strikes from its sheet (system.actions, as the reader reads a companion's), or its one estimated Strike. */
function constructStrikes(c) {
    let list = [];
    try {
        list = (c.actor?.system?.actions ?? []).filter((s) => s.item && s.type === "strike" && s.ready !== false).map((s) => {
            const item = s.item, traits = item.system?.traits?.value ?? [];
            const rolls = Object.values(item.system?.damageRolls ?? {});
            let avg = rolls.reduce((t, d) => t + averageOf(d.damage), 0);
            if (!rolls.length && item.system?.damage) { const d = item.system.damage; const die = Number(String(d.die ?? "").replace("d", "")) || 0; avg = (die ? (Number(d.dice) || 0) * (die + 1) / 2 : Number(d.dice) || 0) + (Number(d.modifier) || 0) + (Number(c.actor.system?.abilities?.str?.mod) || 0); }
            const ranged = !!(item.isRanged ?? traits.some((t) => t.startsWith("range")));
            return { label: s.label ?? item.name, bonus: s.totalModifier ?? 0, avg: Number.isFinite(avg) ? avg : 0, agile: traits.includes("agile"), ranged, reach: ranged ? 0 : (c.actor.getReach?.({ action: "attack", weapon: item }) ?? c.reach ?? 5), traits, deadly: 0 };
        }).filter((s) => !s.ranged);
    } catch { list = []; }
    if (!list.length) list = [{ label: `${nameOf(c)}'s Strike`, bonus: c.reactiveStrike?.bonus ?? 0, avg: c.reactiveStrike?.avg ?? 4, agile: false, ranged: false, reach: c.reach ?? 5, traits: [], deadly: 0 }];
    return list;
}

function inventor(board, ctx, out) {
    const actor = board.me.actor;
    const me = board.me;
    const lv = level(board);
    if (!hasAny(actor, "overdrive", "innovation", "weapon-innovation", "armor-innovation", "construct-innovation")) return;
    const foes = targets(board);
    const int = abil(actor, "int");
    const dc = classDC(actor, lv);
    const craft = crafting(actor, lv);
    const kind = has(actor, "weapon-innovation") ? "weapon" : has(actor, "armor-innovation") ? "armor" : has(actor, "construct-innovation") ? "construct" : has(actor, "light-mortar-innovation") ? "mortar" : null;
    const breakthrough = lv >= 7 && has(actor, "breakthrough-innovation");
    const revolutionary = lv >= 15 && has(actor, "revolutionary-innovation");
    const push = (plan) => out.plans.push({ kind: "class", dest: null, notes: [], ...plan, score: plan.ev + (plan.bias ?? 0.3) });
    const melee = () => board.strikes.filter((s) => !s.ranged);

    // ---- the innovation on the sheet
    // PF2e names the weapon innovation in roll options ("weapon-innovation:id:<item id>", "weapon-innovation:slug:<slug>"); older
    // data has a flag; failing both, the unique-rarity weapon, then the hardest-hitting weapon Strike (never a shield or unarmed).
    const roll = Object.keys(actor?.rollOptions?.all ?? {});
    const innovationId = roll.find((k) => k.startsWith("weapon-innovation:id:"))?.slice("weapon-innovation:id:".length) ?? actor?.flags?.pf2e?.innovationId ?? actor?.flags?.system?.innovationId ?? null;
    const innovationSlug = roll.find((k) => k.startsWith("weapon-innovation:slug:"))?.slice("weapon-innovation:slug:".length) ?? null;
    const strikeSlug = (s) => s.item?.slug ?? s.slug ?? null;
    const named = !!(innovationId || innovationSlug);
    const innovation = kind !== "weapon" ? null
        : named ? (board.strikes.find((s) => s.id && s.id === innovationId) ?? (innovationSlug ? board.strikes.find((s) => strikeSlug(s) === innovationSlug) : null) ?? null)
        : (board.strikes.find((s) => s.item?.system?.traits?.rarity === "unique" || s.innovation)
            ?? board.strikes.filter((s) => !s.traits?.includes("unarmed") && s.item?.type !== "shield" && !/shield/i.test(s.label ?? "")).sort((a, b) => b.avg - a.avg)[0] ?? null);
    const innovationItem = kind === "weapon" && named && !innovation ? (actor?.items?.find?.((i) => i.id === innovationId) ?? (innovationSlug ? actor?.items?.find?.((i) => i.type === "weapon" && i.slug === innovationSlug) : null)) ?? null : null;
    if (innovationItem) out.notes.push(`Your innovation (${innovationItem.name}) isn't in hand, so its boosts and Megaton Strike are off the table; draw it (1 Interact) if you'll be Striking.`);
    const construct = kind === "construct" || has(actor, "prototype-companion") ? findConstruct(board) : null;
    const broken = (kind === "weapon" && innovation?.item?.isBroken) || !!effect(actor, /^effect-broken-innovation/);
    const locked = !!effect(actor, /unstable-check-failure/);
    const redundancies = lv >= 14 && has(actor, "unstable-redundancies");
    /** Strikes that carry the innovation's boosts: the weapon innovation, every melee Strike with the armor (unarmed, plus one prepared weapon). */
    const boosted = (s) => (kind === "weapon" ? s === innovation : kind === "armor" ? !s.ranged : false);
    const coreType = has(actor, "variable-core") ? (actor.flags?.pf2e?.rulesSelections?.variableCore ?? actor.flags?.pf2e?.inventor?.variableCore ?? "acid, cold or electricity (your core's type)") : "fire";

    // ---- Overdrive: up, or the plan
    const od = effect(actor, /^effect-overdrive$/);
    const odOutcome = od ? (od.flags?.pf2e?.rulesSelections?.baseDamage ?? od.rulesSelections?.baseDamage ?? "success") : null;
    const tier = lv >= 15 && has(actor, "legendary-overdrive") ? 3 : lv >= 7 && has(actor, "master-overdrive") ? 2 : lv >= 3 && has(actor, "expert-overdrive") ? 1 : 0;
    const odDamage = (outcome) => (outcome === "critical-success" ? int + tier : outcome === "success" ? Math.floor(int / 2) + tier : outcome === "failure" ? 1 : 0);
    const odUp = od && odOutcome !== "failure";
    if (od) {
        const dmg = odDamage(odOutcome);
        for (const s of board.strikes) if (!s.overdriveCounted) { s.overdriveCounted = true; s.avg += dmg; }
        if (odOutcome === "failure") out.notes.push("Overdrive failed: +1 fire damage on your Strikes for the minute, nothing more. Overdrive again (1 action) for the real bonus; a critical failure ends it.");
        else out.notes.push(`${odOutcome === "critical-success" ? "Critical overdrive" : "Overdrive"}: +${dmg} damage on every Strike for a minute${kind === "weapon" ? ", fire if you choose" : ""}; the plans count it.${construct ? ` ${nameOf(construct)} gets the same.` : ""}${odOutcome === "success" && int + tier > dmg ? ` Overdrive again only to try for a critical (+${int + tier}); a critical failure ends it.` : ""}`);
        if (kind === "armor" && has(actor, "muscular-exoskeleton") && me.athletics != null && !me.exoCounted) { me.exoCounted = true; me.athletics += craft >= lv + 12 ? 2 : 1; }
    }
    // Offensive Boost (9): +1d6 on the innovation's Strikes; Persistent Boost (16): +1d8 persistent on a boosted hit
    const boostType = actor?.flags?.pf2e?.inventor?.offensiveBoost ?? null;
    if (lv >= 9 && has(actor, "offensive-boost") && kind !== "construct") {
        const persistent = lv >= 16 && has(actor, "persistent-boost");
        let marked = 0;
        for (const s of board.strikes) if (boosted(s) && !s.boostCounted) { s.boostCounted = true; s.avg += 3.5 + (persistent ? 1.5 * 4.5 : 0); marked += 1; }
        if (marked) out.notes.push(`Offensive Boost: +1d6${boostType ? ` ${boostType}` : ""} damage on ${kind === "weapon" ? `${innovation?.label ?? "your innovation"}` : "your unarmed Strikes and the weapon you prepared"}${persistent ? ", and Persistent Boost adds 1d8 persistent of the same type on a hit" : ""}; the plans count it.${has(actor, "boost-modulation") ? " Boost Modulation: an Interact swaps the type among your three against a foe that resists it." : ""}`);
    } else if (lv >= 9 && has(actor, "offensive-boost") && construct) out.notes.push(`Offensive Boost: ${nameOf(construct)}'s Strikes deal +1d6${boostType ? ` ${boostType}` : ""} damage${lv >= 16 && has(actor, "persistent-boost") ? ", plus 1d8 persistent on a hit" : ""}.`);

    // ---- the unstable economy: one a fight unless the flat check passed
    const unstableOK = !locked;
    const riskCost = UNSTABLE_CRIT * lv * 0.5; // the critical failure's fire damage to you, at half weight
    const unstableNote = redundancies ? `Unstable: Unstable Redundancies passes the DC 17 flat check for you once (then 10 minutes to reset them); after that one, a failure locks your innovation out of unstable actions until you retune it for 10 minutes, and a 7 or less also burns you for ${lv} fire.`
        : `Unstable: after it, a DC 17 flat check (about ${pct(UNSTABLE_PASS)} to pass); a failure locks your innovation out of unstable actions until you retune it for 10 minutes, and a 7 or less also burns you for ${lv} fire. One unstable action a fight unless the check passed; make it the one that matters.`;
    if (locked) out.notes.push("Your innovation failed its unstable flat check: no unstable actions (Explode, Megaton's unstable function, Searing Restoration) until you spend 10 minutes retuning it.");
    if (broken) out.notes.push(`Your innovation is broken${has(actor, "haphazard-repair") ? ": Haphazard Repair (1 action, unstable) repairs it on the spot, no flat surface needed" : ": Repair it (10 minutes) when the fight allows"}.`);

    // ---- Overdrive, then Strike: when it isn't up
    const sdc = standardDC(lv);
    const c = degreeChances(craft, sdc);
    const expectedOd = c.cs * odDamage("critical-success") + c.s * odDamage("success") + c.f * 1;
    const ubiquitous = lv >= 20 && has(actor, "ubiquitous-overdrive") ? (board.allies ?? []).filter((a) => a.canAct !== false && a.hasMelee !== false && feetBetween(me.rect, a.rect) <= 30 && a !== construct) : [];
    const odText = () => `Overdrive: Crafting ${signed(craft)} against DC ${sdc}, about ${pct(c.s + c.cs)} for +${odDamage("success")} on your Strikes for a minute (${pct(c.cs)} critical: +${odDamage("critical-success")}; a critical failure burns you for ${Math.ceil(lv / 2)} fire and locks it for 1d4 rounds)${construct ? `; ${nameOf(construct)} gets it too` : ""}${ubiquitous.length ? `; Ubiquitous Overdrive gives ${ubiquitous.map(nameOf).join(", ")} the base bonus` : ""}`;
    if (!odUp && ctx.actions >= 2 && foes.length) {
        const forward = expectedOd * 0.6 * 3 * (construct ? 2 : 1) + ubiquitous.length * (c.cs * int + c.s * Math.floor(int / 2)) * 0.6 * 3 - c.cf * Math.ceil(lv / 2) * 0.5;
        const odPlans = [];
        for (const f of foes) {
            const spare = ctx.actions - 1;
            const ranged = board.strikes.some((s) => s.ranged && feetBetween(me.rect, f.rect) <= (s.range ?? 30) * 2);
            const sq = squareToReach(board, f, Math.max(5, ...melee().map((s) => s.reach || 5)), spare - 1);
            if (!sq && !ranged) continue;
            const moveActs = sq ? sq.route.actions : 0;
            const left = spare - moveActs;
            if (left < 1) continue;
            const r = strikeRun(board, f, left, { made: ctx.made, extra: expectedOd, melee: !!sq });
            if (!r.used.length) continue;
            const steps = [{ cost: 1, text: odText() }];
            if (moveActs) steps.push({ cost: moveActs, text: `${sq.route.via ?? "Stride"}${moveActs > 1 ? ` ×${moveActs}` : ""} into reach of ${nameOf(f)}` });
            steps.push({ cost: r.used.length, text: `${strikeText(f, r.used)}, about +${Math.round(expectedOd * 10) / 10} each from the Overdrive` });
            odPlans.push({ title: `Overdrive, then Strike ${nameOf(f)}`, target: f, ev: r.ev + forward, bias: 0.4, dest: moveActs ? { x: sq.x, y: sq.y } : null, steps, notes: ["Overdrive lasts a minute; the plan's value counts this turn's Strikes and about three more hits later in the fight. A plain failure only smokes; a critical failure locks it for 1d4 rounds."] });
        }
        odPlans.sort((a, b) => b.ev - a.ev);
        for (const pl of odPlans.slice(0, 3)) push(pl);
    } else if (!odUp && ctx.actions === 1 && foes.length) out.notes.push(`${odText()}.`);

    /** A run of Strikes with the innovation (or any melee Strike with the armor) at f: the best boosted Strike each time. */
    const innovationRun = (f, n, made, { extra = 0, at = me.rect } = {}) => {
        const pool = kind === "weapon" ? (innovation ? [innovation] : []) : kind === "armor" ? melee() : [];
        const used = [];
        let ev = 0;
        for (let i = 0; i < n; i++) {
            let best = null;
            for (const s of pool) {
                if (s.ranged ? feetBetween(at, f.rect) > (s.range ?? 30) * 2 : !inReach(at, f.rect, s.reach || 5)) continue;
                const b = s.bonus + mapFor(made + used.length, s.agile);
                const e = strikeExpected(b, f.ac, s.avg + extra, { deadly: s.deadly });
                if (!best || e.expected > best.e.expected) best = { s, bonus: b, e };
            }
            if (!best) break;
            used.push(best); ev += best.e.expected;
        }
        return { used, ev };
    };

    // ---- Megaton Strike (4, 2 actions): the innovation's Strike with extra weapon dice; unstable adds one more and Gigaton pushes
    if (has(actor, "megaton-strike") && ctx.actions >= 2 && foes.length && (kind === "weapon" ? !!innovation : kind === "armor")) {
        const dice = lv >= 18 ? 3 : lv >= 10 ? 2 : 1;
        const gigaton = lv >= 8 && has(actor, "gigaton-strike");
        for (const f of foes) {
            const base = innovationRun(f, 1, ctx.made);
            if (!base.used.length) continue;
            const s = base.used[0].s;
            const die = dieOf(s), per = (die + 1) / 2;
            const stable = strikeExpected(base.used[0].bonus, f.ac, s.avg + dice * per, { deadly: s.deadly });
            const after = ctx.actions >= 3 ? innovationRun(f, 1, ctx.made + 1) : { used: [], ev: 0 };
            const tail = after.used.length ? [{ cost: 1, text: strikeText(f, after.used) }] : [];
            push({ title: `Megaton Strike ${nameOf(f)}`, target: f, ev: stable.expected + after.ev, bias: 0.3,
                steps: [{ cost: 2, text: `Megaton Strike ${nameOf(f)} with ${s.label} (${signed(base.used[0].bonus)}): +${dice}d${die} on the hit${kind === "armor" ? " (unarmed, or the weapon you rigged at daily preparations)" : ""}` }, ...tail],
                notes: [`Two actions for one Strike: it beats two Strikes when the second would land at ${signed(mapFor(ctx.made + 1, s.agile))}.`] });
            if (unstableOK) {
                const un = strikeExpected(base.used[0].bonus, f.ac, s.avg + (dice + 1) * per, { deadly: s.deadly });
                const pushWorth = gigaton ? (1 - degreeChances(f.saves?.fortitude ?? 0, dc).cs - degreeChances(f.saves?.fortitude ?? 0, dc).s * 0.5) * 1.5 : 0;
                push({ title: `Megaton Strike ${nameOf(f)}, unstable`, target: f, ev: un.expected + after.ev + un.hit * pushWorth - riskCost, bias: 0.2,
                    steps: [{ cost: 2, text: `Megaton Strike ${nameOf(f)} with ${s.label} (${signed(base.used[0].bonus)}), unstable function: +${dice + 1}d${die} on the hit${gigaton ? `; Gigaton Strike: on a hit it saves Fortitude against DC ${dc} or is pushed 5 feet (10 on a failure, 20 on a critical failure)` : ""}` }, ...tail],
                    notes: [unstableNote] });
            }
        }
    } else if (has(actor, "megaton-strike") && kind === "construct" && construct) out.notes.push(`Megaton Strike (2 actions): ${nameOf(construct)} Strikes with +${lv >= 18 ? 3 : lv >= 10 ? 2 : 1} weapon ${lv >= 10 ? "dice" : "die"} (one more with the unstable function${lv >= 8 && has(actor, "gigaton-strike") ? ", and Gigaton pushes the foe" : ""}); it's your action, not a Command.`);

    // ---- Explode (2 actions, unstable): fire in an emanation around you (or the construct)
    const origin = kind === "construct" && construct ? construct : me;
    if (has(actor, "explode") && unstableOK && ctx.actions >= 2 && !broken) {
        const radii = revolutionary ? [5, 10, 15] : breakthrough ? [5, 10] : [5];
        const avg = 3.5 * Math.max(2, lv);
        let best = null;
        for (const r of radii) {
            const hit = foes.filter((f) => inReach(origin.rect, f.rect, r));
            const friends = (board.allies ?? []).filter((a) => a !== origin && a.hp > 0 && inReach(origin.rect, a.rect, r));
            const selfHit = origin !== me && inReach(origin.rect, me.rect, r);
            let ev = 0;
            for (const f of hit) ev += saveExpected(f.saves?.reflex ?? 0, dc, avg).expected;
            ev -= friends.length * avg * 0.5 + (selfHit ? avg * 0.6 : 0);
            if (hit.length && (!best || ev > best.ev)) best = { r, hit, friends, selfHit, ev };
        }
        if (best && best.hit.length >= 2 - (foes.length === 1 ? 1 : 0)) {
            const hurtFriends = best.friends.length || best.selfHit;
            push({ title: `Explode on ${best.hit.length} ${best.hit.length === 1 ? "foe" : "foes"}`, target: best.hit[0], ev: best.ev - riskCost, bias: best.hit.length >= 2 ? 0.4 : 0.1,
                steps: [{ cost: 2, text: `Explode (${best.r}-foot emanation around ${origin === me ? "you" : nameOf(origin)}): ${best.hit.map(nameOf).join(", ")} take ${Math.max(2, lv)}d6 ${coreType}, basic Reflex DC ${dc}${hurtFriends ? `; it also catches ${[...best.friends.map(nameOf), ...(best.selfHit ? ["you"] : [])].join(", ")}` : ""}` }],
                notes: [best.hit.length >= 2 ? "Worth your one unstable action when two or more foes are packed around you." : "One foe only: Megaton Strike or a plain Strike is usually the better use of the unstable action.", unstableNote] });
        }
    }

    // ---- Megavolt (6, 2 actions): a 20-foot line of electricity, basic Reflex; unstable: 60 feet and d12s
    if (has(actor, "megavolt") && ctx.actions >= 2 && foes.length) {
        const dice = Math.max(3, Math.floor(lv / 2));
        const lines = [[20, 4, false], ...(unstableOK ? [[revolutionary ? 120 : breakthrough ? 90 : 60, 12, true]] : [])];
        for (const [length, faces, unstable] of lines) {
            let best = null;
            for (const f of foes) {
                if (feetBetween(origin.rect, f.rect) > length) continue;
                const hit = onLine(origin.rect, f, foes, length);
                const friends = onLine(origin.rect, f, (board.allies ?? []).filter((a) => a !== origin && a.hp > 0), length);
                const avg = dice * (faces + 1) / 2;
                let ev = 0;
                for (const g of hit) ev += saveExpected(g.saves?.reflex ?? 0, dc, avg).expected;
                ev -= friends.length * avg * 0.5;
                if (!best || ev > best.ev) best = { f, hit, friends, ev, avg };
            }
            if (!best) continue;
            if (unstable && best.hit.length < 2) continue;
            push({ title: `Megavolt${unstable ? ", unstable," : ""} through ${best.hit.map(nameOf).join(", ")}`, target: best.f, ev: best.ev - (unstable ? riskCost : 0), bias: unstable ? 0.2 : 0.3,
                steps: [{ cost: 2, text: `Megavolt${unstable ? " (unstable function)" : ""}: a ${length}-foot line from ${origin === me ? "you" : nameOf(origin)} through ${nameOf(best.f)}: ${best.hit.map(nameOf).join(", ")} take ${dice}d${faces} electricity, basic Reflex DC ${dc}${best.friends.length ? `; it also catches ${best.friends.map(nameOf).join(", ")}` : ""}${lv >= 12 && has(actor, "gigavolt") ? "; Gigavolt bounces it off walls for the rest of its length" : ""}` }],
                notes: unstable ? [unstableNote] : ["Aim the line so it leaves your allies out; a foe behind another is in it too."] });
        }
    }

    // ---- Searing Restoration (2, 1 action, unstable): heal yourself or an adjacent living ally
    if (has(actor, "searing-restoration") && unstableOK && ctx.actions >= 1) {
        const heal = 5.5 * Math.max(1, Math.ceil(lv / 2));
        const healer = kind === "construct" && construct ? construct : me;
        const living = (a) => !(a.traits ?? []).includes("construct") && !(a.actor?.system?.traits?.value ?? []).includes("construct");
        const cands = [...(healer === me ? [me] : []), ...(board.allies ?? []).filter((a) => a !== construct && a.hp > 0 && living(a) && inReach(healer.rect, a.rect, 5))];
        let best = null;
        for (const a of cands) { const missing = Math.max(0, (a.maxHp ?? 0) - (a.hp ?? 0)); const ev = 0.8 * Math.min(heal, missing); if (missing >= heal * 0.4 && (!best || ev > best.ev)) best = { a, ev, missing }; }
        if (best) push({ title: `Searing Restoration on ${best.a === me ? "yourself" : nameOf(best.a)}`, target: null, ev: best.ev - riskCost, bias: 0.3,
            steps: [{ cost: 1, text: `Searing Restoration${healer !== me ? ` from ${nameOf(healer)}` : ""}: ${best.a === me ? "you regain" : `${nameOf(best.a)} regains`} ${Math.max(1, Math.ceil(lv / 2))}d10 (about ${Math.round(heal)}; ${best.a.hp}/${best.a.maxHp} now), and a flat check against persistent bleed` }],
            notes: ["A heal for one action, but it's unstable: take it when the HP matter more than your Megaton or Explode this fight.", unstableNote] });
    }

    // ---- Tamper (1 action, a free hand): Crafting against its Reflex DC; its armor makes it off-guard and slow, its weapon -2
    if (has(actor, "tamper") && ctx.actions >= 2 && foes.length) {
        const freeHand = actor?.handsFree == null || actor.handsFree > 0 || board.strikes.some((s) => s.traits?.includes("free-hand"));
        if (!freeHand) out.notes.push("Tamper needs a free hand; Release or stow something first (an Integrated Gauntlet would free it).");
        else for (const f of foes.filter((f) => inReach(me.rect, f.rect, 5) && !f.conditions?.has?.("off-guard"))) {
            const t = degreeChances(craft, 10 + (f.saves?.reflex ?? 0));
            const p = t.s + t.cs;
            const left = ctx.actions - 1;
            const plain = strikeRun(board, f, left, { made: ctx.made });
            const off = strikeRun(board, f, left, { made: ctx.made, acAdj: -2 });
            if (!off.used.length) continue;
            const allyGain = (board.allies ?? []).some((a) => a.canAct !== false && a.hasMelee !== false && inReach(a.rect, f.rect, a.reach ?? 5)) ? worth(board, "off-guard") * 0.5 : 0;
            const ev = p * (off.ev + allyGain + 1) + (1 - p) * plain.ev - t.cf * lv * 0.5;
            push({ title: `Tamper with ${nameOf(f)}'s armor, then Strike`, target: f, ev, bias: 0.2,
                steps: [{ cost: 1, text: `Tamper with ${nameOf(f)}'s armor: Crafting ${signed(craft)} against its Reflex DC (about ${pct(p)}): it's off-guard and 10 feet slower until your next turn (until it Interacts, on a critical success); a critical failure burns you for ${lv} fire` }, { cost: off.used.length, text: `${strikeText(f, off.used)}, off-guard if the Tamper took` }],
                notes: ["If it wears no armor, tamper with its weapon instead: -2 to its attack and damage rolls with it. Your allies get the off-guard too."] });
        }
    }

    // ---- Oil Fire (2, armor, 1 action, unstable): a foe you've grabbed burns
    if (has(actor, "oil-fire") && kind === "armor" && unstableOK && ctx.actions >= 1) {
        for (const f of foes.filter((f) => f.conditions?.has?.("grabbed") && inReach(me.rect, f.rect, 5))) {
            const t = degreeChances(f.saves?.reflex ?? 0, dc);
            const ev = 1.5 * (t.f * Math.floor(lv / 2) + t.cf * lv + t.s * 1) - riskCost;
            push({ title: `Oil Fire on ${nameOf(f)}`, target: f, ev, bias: 0.2,
                steps: [{ cost: 1, text: `Oil Fire on ${nameOf(f)} (grabbed): Reflex DC ${dc}; a failure gives it ${Math.floor(lv / 2)} persistent fire (${lv} on a critical failure); on a success the grab ends` }],
                notes: ["Only while it's grabbed by you; the grab ends on its success.", unstableNote] });
        }
    }

    // ---- Electrify Armor (10, armor, 1 action): foes that hit you in melee take 1d4 (2d4 revolutionary); unstable: d12s for a minute
    if (has(actor, "electrify-armor") && kind === "armor" && ctx.actions >= 1) {
        const near = foes.filter((f) => f.hasMelee !== false && inReach(f.rect, me.rect, f.reach ?? 5));
        if (near.length) {
            const dice = revolutionary ? 2 : 1;
            const perRound = near.length * 1.2 * 0.6; // about one melee attack each, landing a little over half the time
            push({ title: `Electrify Armor against ${near.length} ${near.length === 1 ? "foe" : "foes"} on you`, target: near[0], ev: perRound * dice * 2.5, bias: 0.1,
                steps: [{ cost: 1, text: `Electrify Armor: for a round, any foe that touches you or hits you with an unarmed or non-reach melee attack takes ${dice}d4 electricity${unstableOK ? ` (unstable function: ${dice}d12 for a minute)` : ""}` }],
                notes: ["A third action when foes crowd you; the unstable version is worth your one unstable action only when two or more will keep hitting you for the whole fight."] });
        }
    }

    // ---- Wukong Extension (2, 1 action, unstable): a melee Strike with the weapon innovation at 30 feet
    if (has(actor, "wukong-extension") && kind === "weapon" && innovation && !innovation.ranged && unstableOK && ctx.actions >= 1) {
        for (const f of foes.filter((f) => !inReach(me.rect, f.rect, innovation.reach || 5) && feetBetween(me.rect, f.rect) <= 30)) {
            const b = innovation.bonus + mapFor(ctx.made, innovation.agile);
            const e = strikeExpected(b, f.ac, innovation.avg, { deadly: innovation.deadly });
            push({ title: `Wukong Extension at ${nameOf(f)}`, target: f, ev: e.expected - riskCost, bias: 0.2, steps: [{ cost: 1, text: `Wukong Extension: Strike ${nameOf(f)} with ${innovation.label} (${signed(b)}) at 30 feet without moving` }], notes: [unstableNote] });
        }
    }

    // ---- Devastating Weaponry (18, 3 actions): the innovation Strikes every foe within 30 feet, no penalty growth until after
    if (has(actor, "devastating-weaponry") && kind === "weapon" && innovation && ctx.actions === 3 && !(innovation.reload > 0)) {
        const hit = foes.filter((f) => feetBetween(me.rect, f.rect) <= 30);
        if (hit.length >= 2) {
            const b = innovation.bonus + mapFor(ctx.made, innovation.agile);
            let ev = 0;
            for (const f of hit) ev += strikeExpected(b, f.ac, innovation.avg, { deadly: innovation.deadly }).expected;
            push({ title: `Devastating Weaponry on ${hit.length} foes`, target: hit[0], ev, bias: 0.4, steps: [{ cost: 3, text: `Devastating Weaponry: Strike ${hit.map(nameOf).join(", ")} with ${innovation.label}, each at ${signed(b)}${!innovation.ranged ? "; the weapon flies to those out of reach and returns (keep a hand free for it)" : ""}` }], notes: ["All of the attacks count toward your penalty afterward, so it's the turn's last thing."] });
        }
    }

    // ---- Overdrive Ally (8, 1 action, in overdrive): an ally within 30 feet gets the base bonus until the end of its next turn
    if (odUp && has(actor, "overdrive-ally") && ctx.actions >= 1) {
        const dmg = odOutcome === "critical-success" ? int : Math.floor(int / 2);
        const shared = lv >= 12 && has(actor, "shared-overdrive");
        const already = (a) => a.actor?.items?.some?.((i) => i.type === "effect" && /effect-overdrive-ally/.test(i.slug ?? i.system?.slug ?? ""));
        const ally = (board.allies ?? []).filter((a) => a !== construct && a.canAct !== false && a.hasMelee !== false && feetBetween(me.rect, a.rect) <= 30 && !already(a) && !ubiquitous.includes(a)).sort((a, b) => (b.reactiveStrike?.avg ?? 0) - (a.reactiveStrike?.avg ?? 0))[0];
        if (ally && dmg > 0) push({ title: `Overdrive Ally: ${nameOf(ally)}`, target: null, ev: dmg * 0.6 * (shared ? 6 : 2), bias: 0.2,
            steps: [{ cost: 1, text: `Overdrive Ally (${nameOf(ally)}, within 30 feet): +${dmg} on their Strikes ${shared ? "for the rest of your Overdrive (Shared Overdrive, first use)" : "until the end of their next turn"}` }],
            notes: ["Worth a spare action when the ally will Strike twice or more before it fades; a martial ally over a caster."] });
    }
    // ---- Helpful Tinkering (10, 1 action, once per 10 minutes): an ally's weapon gets your offensive boost for a minute
    if (lv >= 10 && has(actor, "helpful-tinkering") && has(actor, "offensive-boost") && ctx.actions >= 1) {
        const item = actor.items?.find?.((i) => (i.slug ?? i.system?.slug) === "helpful-tinkering");
        const usesLeft = item?.system?.frequency?.value;
        if (usesLeft !== 0) {
            const t = degreeChances(craft, standardDC(lv) + 2);
            const ally = (board.allies ?? []).filter((a) => a !== construct && a.canAct !== false && a.hasMelee !== false && inReach(me.rect, a.rect, 5)).sort((a, b) => (b.reactiveStrike?.avg ?? 0) - (a.reactiveStrike?.avg ?? 0))[0];
            if (ally) push({ title: `Helpful Tinkering on ${nameOf(ally)}'s weapon`, target: null, ev: (t.s + t.cs) * 3.5 * 0.6 * 5 - t.cf * 3.5, bias: 0.1,
                steps: [{ cost: 1, text: `Helpful Tinkering: Crafting ${signed(craft)} against DC ${standardDC(lv) + 2} (about ${pct(t.s + t.cs)}): ${nameOf(ally)}'s weapon deals +1d6${boostType ? ` ${boostType}` : ""} for a minute; a critical failure deals that to them instead` }],
                notes: ["Once per 10 minutes; best on the first turn, on the ally who Strikes most."] });
        }
    }

    // ---- the construct: Command (1 action: 2 of its actions; 2 actions: 3), Lock On, Engine of Destruction
    if (construct) {
        const cs = constructStrikes(construct);
        const speed = Number(construct.actor?.system?.movement?.speeds?.land?.value ?? construct.actor?.system?.attributes?.speed?.value) || 25;
        const advanced = lv >= 4 && hasAny(actor, "advanced-construct-companion");
        const legendary = craft >= lv + 16;
        const runC = (f, n, bonus = 0, at = construct.rect) => {
            const used = [];
            let ev = 0;
            for (let i = 0; i < n; i++) {
                let best = null;
                for (const s of cs) { if (!inReach(at, f.rect, s.reach || 5)) continue; const b = s.bonus + bonus + mapFor(used.length, s.agile); const e = strikeExpected(b, f.ac, s.avg + (odUp ? odDamage(odOutcome) : 0), { deadly: s.deadly }); if (!best || e.expected > best.e.expected) best = { s, bonus: b, e }; }
                if (!best) break;
                used.push(best); ev += best.e.expected;
            }
            return { used, ev };
        };
        const reach = Math.max(5, ...cs.map((s) => s.reach || 5));
        const free = advanced ? 1 : 0; // the action it takes anyway if you don't Command it
        if (ctx.actions >= 1 && foes.length) {
            for (const f of foes) {
                const here = inReach(construct.rect, f.rect, reach);
                const canStride = feetBetween(construct.rect, f.rect) <= speed + reach;
                if (!here && !canStride) continue;
                for (const cmd of ctx.actions >= 2 ? [1, 2] : [1]) {
                    const acts = cmd + 1; // 2 with a one-action Command, 3 with two
                    const strikes = here ? acts : acts - 1;
                    const lockOn = lv >= 10 && has(actor, "lock-on") && ctx.actions >= cmd + 1 ? (cmd === 2 ? (legendary ? 4 : 3) : 2) : 0;
                    const r = runC(f, strikes, lockOn, here ? construct.rect : f.rect);
                    if (!r.used.length) continue;
                    const baseline = advanced ? runC(f, here ? 1 : 0).ev : 0;
                    const steps = [];
                    if (lockOn) steps.push({ cost: 1, text: `Lock On: ${nameOf(f)}; ${nameOf(construct)} gets +${lockOn} on its attacks against it this turn if you Command it next` });
                    steps.push({ cost: cmd, text: `Command ${nameOf(construct)} (${cmd} action${cmd > 1 ? "s" : ""}, ${acts} of its actions): ${here ? "" : `it Strides to ${nameOf(f)}, then `}${r.used.length === 1 ? "Strikes" : `Strikes ${r.used.length === 2 ? "twice" : "three times"}`} with ${r.used[0].s.label} (${r.used.map((u) => signed(u.bonus)).join(", ")})` });
                    push({ title: `${lockOn ? "Lock On and " : ""}Command ${nameOf(construct)} at ${nameOf(f)}`, target: f, ev: r.ev - baseline, bias: 0.3, steps,
                        notes: [advanced ? "Advanced Construct Companion: uncommanded it still Strides or Strikes once on your turn; the plan's value is what the Command adds." : "Uncommanded, it does nothing this round."] });
                }
            }
        }
        if (lv >= 18 && has(actor, "engine-of-destruction") && ctx.actions === 3) {
            const near = foes.filter((f) => feetBetween(construct.rect, f.rect) <= 30 + speed);
            if (near.length >= 2) {
                let ev = 0;
                const shown = [];
                for (const f of near) { const s = cs[0]; const b = s.bonus + 2; const e = strikeExpected(b, f.ac, s.avg + (odUp ? odDamage(odOutcome) : 0), { deadly: s.deadly }); ev += e.expected; shown.push(`${nameOf(f)} ${signed(b)}`); }
                push({ title: `Engine of Destruction: ${nameOf(construct)} on ${near.length} foes`, target: near[0], ev, bias: 0.4, steps: [{ cost: 3, text: `Engine of Destruction: ${nameOf(construct)} Strides once, then Strikes every foe within 30 feet of it at +2 with ${cs[0].label}: ${shown.join(", ")}; its penalty doesn't climb until after` }], notes: ["It needs a stride that leaves two or more foes within 30 feet of it."] });
            }
        }
        if (has(actor, "duo-dragon-kick") && inReach(me.rect, construct.rect, 5)) out.notes.push(`Duo Dragon Kick (2 actions, ${nameOf(construct)} adjacent): you both Leap the same way and each make an unarmed Strike; it spends its actions for the turn.`);
        if (has(actor, "no-no-i-created-you")) out.notes.push(`No! No! I Created You! (reaction, once a minute): when ${nameOf(construct)} would be confused or controlled, counteract it with Crafting ${signed(craft)}.`);
        if (has(actor, "construct-shell")) out.notes.push(`Construct Shell: riding ${nameOf(construct)} gives you lesser cover from everything, and its emanations can leave you out.`);
        if (has(actor, "distracting-explosion")) out.notes.push(`Distracting Explosion (reaction): ${nameOf(construct)} can take it for you, with your reaction.`);
    } else if (kind === "construct" || has(actor, "prototype-companion")) out.notes.push("Your construct companion isn't on the field (or isn't marked as yours): no Command plans.");

    // ---- when-notes
    if (lv >= 6 && has(actor, "clockwork-celerity") && ctx.actions >= 3 && ctx.made === 0) out.notes.push(`Clockwork Celerity (free as your turn begins, unstable): quickened this turn, the extra action for ${kind === "weapon" ? "a Strike with your innovation or its reload" : kind === "armor" ? "a Step or Stride" : "a Command"}; ${locked ? "not while your innovation is locked out" : "it spends your one safe unstable action before the Strikes"}.`);
    if (lv >= 20 && has(actor, "full-automation")) out.notes.push(`Full Automation: you're always quickened; the extra action is ${kind === "weapon" ? "a Strike with your innovation" : kind === "armor" ? "a Stride or Step (or your armor's Fly or Swim)" : "a Command of your construct"}.`);
    if (has(actor, "explosive-leap") && unstableOK) out.notes.push("Explosive Leap (1 action, unstable): a 30-foot jump in any direction, landing on solid ground or you fall after your next action; an escape or a climb for the price of your unstable action.");
    if (lv >= 10 && has(actor, "distracting-explosion") && has(actor, "offensive-boost")) {
        const casters = foes.filter((f) => f.caster && inReach(me.rect, f.rect, Math.max(5, ...melee().map((s) => s.reach || 5))));
        if (casters.length) out.notes.push(`Distracting Explosion (reaction): when ${casters.map(nameOf).join(" or ")} uses a concentrate action in your reach, a boosted melee Strike with no penalty; the unstable function disrupts the action on a hit.`);
    }
    if (lv >= 14 && has(actor, "explosive-maneuver") && innovation) {
        const m = ["grapple", "shove", "trip"].filter((t) => innovation.traits?.includes(t));
        if (m.length) out.notes.push(`Explosive Maneuver (1 action, right after a hit with ${innovation.label}): ${m.map((x) => x[0].toUpperCase() + x.slice(1)).join(" or ")} the same foe at the penalty that Strike had, not the next one.`);
    }
    if (innovation && !innovation.ranged && innovation.traits?.includes("backstabber")) out.notes.push(`${innovation.label} has backstabber: +${lv >= 12 ? 2 : 1} precision damage on an off-guard foe.`);
    if (innovation?.traits?.includes("ranged-trip")) out.notes.push(`${innovation.label} can Trip at range (ranged trip): a Trip with your attack roll against its Reflex DC, from its range.`);
    if (innovation?.traits?.includes("modular") || has(actor, "modular-head") || has(actor, "segmented-frame")) out.notes.push("Modular head: an Interact switches the weapon among bludgeoning, piercing and slashing (and nonlethal); worth it against a foe that resists one.");
    if (lv >= 7 && has(actor, "manifold-alloy")) { const w = foes.filter((f) => (f.iwr?.weak ?? []).some((x) => /silver|cold-iron|cold iron/i.test(x.type))); if (w.length) out.notes.push(`Manifold Alloy: ${innovation?.label ?? "your innovation"} is silver and cold iron; ${w.map(nameOf).join(", ")} ${w.length === 1 ? "has" : "have"} a weakness to it.`); }
    if (lv >= 15 && has(actor, "impossible-alloy")) { const w = foes.filter((f) => (f.iwr?.weak ?? []).some((x) => /abysium|adamantine|djezet|inubrix|noqual|orichalcum|siccatite|skymetal/i.test(x.type))); if (w.length) out.notes.push(`Impossible Alloy: ${innovation?.label ?? "your innovation"} counts as every skymetal; ${w.map(nameOf).join(", ")} ${w.length === 1 ? "has" : "have"} a weakness to one.`); }
    if (lv >= 15 && has(actor, "momentum-enhancer") && innovation?.reload > 0) out.notes.push(`Momentum Enhancer: one reload of ${innovation.label} each round is a free action.`);
    if (lv >= 15 && has(actor, "attack-refiner") && innovation) out.notes.push(`Attack Refiner: ${innovation.label} is forceful (+${innovation.item?.system?.damage?.dice ?? 1} damage on your second attack, double on the third) and backswing (+1 to hit after a miss).`);
    if (has(actor, "dual-form-weapon") && innovation) out.notes.push(`Dual-Form Weapon: two Interact actions turn ${innovation.label} into its other configuration; the second can wait for a later turn.`);
    if (lv >= 6 && has(actor, "silk-bracelet")) out.notes.push(`Silk Bracelet (2 actions): a melee Strike; on a hit the foe saves Fortitude DC ${dc} or is 10 feet slower for a round, takes ${lv >= 18 ? 3 : lv >= 12 ? 2 : 1}d4 poison on a failure, and is held until the end of its next turn on a critical failure.`);
    if (lv >= 8 && has(actor, "guardian-lion-roar")) out.notes.push(`Guardian Lion Roar (2 actions): a 20-foot line of sonic, basic Fortitude DC ${dc}; foes that fail are off-guard for a round. The unstable function makes it 60 feet and catches those that merely succeed too.`);
    if (lv >= 12 && has(actor, "deep-freeze")) out.notes.push(`Deep Freeze (2 actions): one foe within 60 feet takes ${lv} cold, Reflex DC ${dc}, and is slower for a round (slowed 1 on a critical failure). The unstable function makes it a 60-foot cone for ${2 * lv}: that's a fight-winning use of your unstable action against three or more.`);
    if (lv >= 12 && has(actor, "celestial-cacophony")) out.notes.push(`Celestial Cacophony (3 actions): a cone of fire and sonic, Reflex DC ${dc}, that leaves difficult terrain until your next turn; the unstable function widens it and raises the dice to d8s.`);
    if (lv >= 6 && has(actor, "xidao-sea-mine-drop")) out.notes.push("Xidao Sea Mine Drop: only underwater; two mines a day.");
    if (lv >= 10 && has(actor, "geobukseon-retaliation") && unstableOK) out.notes.push(`Geobukseon Retaliation (reaction, unstable): when you'd take damage, +4 AC and resistance 2 to physical until your next turn, and spiked chains hit everything around you (Reflex DC ${dc}).`);
    if (lv >= 18 && has(actor, "negate-damage") && kind === "armor") out.notes.push(`Negate Damage (reaction): when you'd take damage, 15 less${unstableOK ? "; the unstable function takes 50 off a blow that would drop you" : ""}.`);
    if (lv >= 16 && has(actor, "you-failed-to-account-for-this")) { const cdc = 10 + craft; out.notes.push(`You Failed to Account For... This! (reaction): an attack on you targets your Crafting DC ${cdc} instead of your AC ${me.ac}${cdc > me.ac ? ": take it on any attack" : cdc === me.ac ? ": only when a penalty drags your AC down" : ": only when your AC is penalized below that"}.`); }
    if (lv >= 16 && has(actor, "just-the-thing")) out.notes.push(`Just the Thing! (once an hour): one skill action of a minute or less with Crafting ${signed(craft)} in place of the skill, a device of your telling.`);
    if (lv >= 6 && has(actor, "visual-fidelity") && foes.some((f) => f.state === "hidden" || f.state === "concealed")) out.notes.push("Visual Fidelity: you see invisible things as translucent shapes (concealed, not hidden), and blinding must counteract your class DC.");
    if (kind === "armor") {
        if (lv >= 15 && has(actor, "automated-impediments")) out.notes.push("Automated Impediments: every square next to you is difficult terrain for your foes; they can't Step up to you and a Stride past you costs double.");
        if (lv >= 15 && has(actor, "multisensory-mask")) out.notes.push("Multisensory Mask: you're concealed from everything until you take a hostile action; one action with the manipulate trait restores it.");
        if (lv >= 7 && has(actor, "camouflage-pigmentation")) out.notes.push("Camouflage Pigmentation: you can Hide without cover or concealment while you stand still.");
        if (lv >= 14 && has(actor, "soaring-armor")) out.notes.push("Soaring Armor: a fly Speed equal to your land Speed; the plans' moves can be flights.");
        if (has(actor, "diving-armor")) out.notes.push("Diving Armor: you breathe underwater and swim at your land Speed.");
        if (has(actor, "muscular-exoskeleton") && odUp) out.notes.push(`Muscular Exoskeleton: +${craft >= lv + 12 ? 2 : 1} on Athletics while in Overdrive; the plans' Trips and Grapples count it.`);
        if (has(actor, "subtle-dampeners") && odUp) out.notes.push(`Subtle Dampeners: +${craft >= lv + 12 ? 2 : 1} on Stealth while in Overdrive.`);
        if (lv >= 7 && has(actor, "hyper-boosters")) out.notes.push(`Hyper Boosters: +10 feet of Speed, +${craft >= lv + 16 ? 30 : 20} while in Overdrive.`);
        else if (has(actor, "speed-boosters")) out.notes.push("Speed Boosters: +5 feet of Speed, +10 while in Overdrive.");
        if (lv >= 15 && has(actor, "perfect-fortification")) out.notes.push("Perfect Fortification: a DC 17 flat check turns a critical hit on you into a hit.");
    }
    if (kind === "mortar") out.notes.push("Light mortar innovation: the helper doesn't plan the mortar's Aim, Load and Launch; deploy it with an Interact, then Load and Launch at foes beyond its minimum range.");
    if (lv >= 4 && has(actor, "gadget-specialist")) {
        const gadgets = (actor.items ?? []).filter((i) => i.type === "consumable" && (i.system?.traits?.value ?? []).includes("gadget") && (i.system?.quantity ?? 1) > 0);
        if (gadgets.length) out.notes.push(`Gadgets ready: ${gadgets.map((g) => g.name).join(", ")}${lv >= 12 && has(actor, "contingency-gadgets") ? "; a contingency gadget becomes whichever you need when you draw it" : ""}.`);
    }
    if (has(actor, "haphazard-repair") && !broken && unstableOK) out.notes.push("Haphazard Repair (1 action, unstable): fixes your innovation on the spot if it breaks.");
    if (lv >= 20 && has(actor, "ubiquitous-overdrive") && odUp && ubiquitous.length) out.notes.push(`Ubiquitous Overdrive: ${ubiquitous.map(nameOf).join(", ")} ${ubiquitous.length === 1 ? "shares" : "share"} your Overdrive's base bonus while within 30 feet.`);
}

export { inventor };
