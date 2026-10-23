/**
 * PF2e Tactics: classes/summoner.mjs
 * See classes/_common.mjs for the shape of a class read.
 * The summoner's layer over the advisor: the eidolon (a second token among the allies, found by its eidolon trait, its
 * class or its master flag) and the shared pool of actions, multiple attack penalty and Hit Points. The read composes the
 * turns the advisor can't: Act Together (Boost Eidolon while the eidolon Strikes, a cantrip while it Strikes), the eidolon's
 * Strikes from its own sheet with the shared penalty, Tandem Strike, Magical Onslaught, the eidolon's type activities
 * (Furious Strike, Beast's Charge, Draconic Frenzy, Dragon Breath, Primal Roar, Whirlwind Maul, Drain Life, Visions of Sin,
 * Field of Roots, Elemental Burst, Elemental Maelstrom, Tendril Strike's reach), Eidolon's Wrath, Piercing Jab, Eidolon's
 * Trample, Seething Frenzy, Lifelink Surge, and Manifest Eidolon when the eidolon isn't on the board. The rest are when-notes.
 */
import { bestStrike, castable, effect, focusLeft, has, level, myReach, allySpeed, pct, slugOf, squareToReach, targets, worth, degreeChances, feetBetween, inReach, mapFor, strikeExpected, saveExpected, nameOf, signed } from "./_common.mjs";
import { averageOf } from "../reader.mjs";

/** Foundry's slugs drop apostrophes ("eidolons-wrath"); the catalog's keep a dash for them ("eidolon-s-wrath"). Both are tried. */
const hasAny = (actor, ...slugs) => slugs.some((s) => has(actor, s));
const abil = (actor, k) => Number(actor?.abilities?.[k]?.mod ?? actor?.system?.abilities?.[k]?.mod) || 0;
const times = (n) => (n === 1 ? "" : n === 2 ? " twice" : n === 3 ? " three times" : ` ${n} times`);
const r1 = (x) => Math.round(x * 10) / 10;
const center = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const angleDiff = (a, b) => { let d = Math.abs(a - b) % (2 * Math.PI); return d > Math.PI ? 2 * Math.PI - d : d; };
/** The standard DC by level (GM Core), for Extend Boost's check. */
const STANDARD_DC = [14, 15, 16, 18, 19, 20, 22, 23, 24, 26, 27, 28, 30, 31, 32, 34, 35, 36, 38, 39, 40];
/** Eidolon types: feature slug, the tradition's skill, the tradition. */
const TYPES = [
    ["angel-eidolon", "angel", "divine"], ["anger-phantom-eidolon", "anger", "occult"], ["beast-eidolon", "beast", "primal"], ["construct-eidolon", "construct", "arcane"],
    ["demon-eidolon", "demon", "divine"], ["devotion-phantom-eidolon", "devotion", "occult"], ["dragon-eidolon", "dragon", null], ["elemental-eidolon", "elemental", "primal"],
    ["fey-eidolon", "fey", "primal"], ["plant-eidolon", "plant", "primal"], ["psychopomp-eidolon", "psychopomp", "divine"], ["undead-eidolon", "undead", "divine"],
    ["aberrant-eidolon", "aberrant", "occult"], ["ooze-eidolon", "ooze", "primal"], ["swarm-eidolon", "swarm", "primal"],
];
const SKILL_OF = { arcane: "arcana", divine: "religion", occult: "occultism", primal: "nature" };

/** The character's eidolon among its allies: the eidolon trait, the Eidolon class, a master flag pointing here, or an eidolon-type feat on its sheet. */
function eidolonOf(board) {
    const me = board.me;
    const myId = String(me.actor?.id ?? me.actor?.uuid ?? "");
    const isEidolon = (a) => {
        if (!a?.actor) return false;
        const traits = [...(a.traits ?? a.actor.traits ?? a.actor.system?.traits?.value ?? [])];
        if (traits.includes("eidolon")) return true;
        if ((a.cls ?? "") === "eidolon" || /^eidolon$/i.test(a.actor.class?.name ?? "")) return true;
        const master = a.actor.flags?.pf2e?.master ?? a.actor.flags?.pf2e?.eidolon?.master ?? a.actor.system?.master?.id ?? null;
        if (master && myId && String(master).includes(myId)) return true;
        return !!a.actor.items?.some?.((i) => i.type === "feat" && /-eidolon$/.test(slugOf(i)));
    };
    return board.allies.find((a) => a.canAct !== false && isEidolon(a)) ?? board.allies.find(isEidolon) ?? null;
}
/** The eidolon's Strikes from its own sheet (system.actions), read like reader.mjs's strikesOf, which isn't exported: label, bonus, avg, agile, ranged, reach, range, dice, damage types. */
function sheetStrikes(actor) {
    const out = [];
    for (const s of actor?.system?.actions ?? []) {
        if (!s?.item || s.type !== "strike" || s.ready === false) continue;
        const item = s.item;
        const traits = item.system?.traits?.value ?? [];
        const rolls = Object.values(item.system?.damageRolls ?? {});
        const ranged = !!(item.isRanged ?? traits.some((t) => t.startsWith("range")));
        let avg = rolls.reduce((t, d) => t + averageOf(d.damage), 0);
        const d = item.system?.damage;
        let dice = Number(d?.dice) || 0;
        if (!rolls.length && d) {
            const die = Number(String(d.die ?? "").replace("d", "")) || 0;
            const str = Number(actor.system?.abilities?.str?.mod) || 0;
            avg = (die ? dice * (die + 1) / 2 : dice) + (Number(d.modifier) || 0) + (ranged ? (traits.includes("propulsive") ? Math.floor(Math.max(0, str) / 2) : 0) : str);
        }
        if (!(avg > 0) || !Number.isFinite(Number(s.totalModifier))) continue;
        out.push({ id: item.id, label: s.label ?? item.name, item, bonus: Number(s.totalModifier), avg, agile: traits.includes("agile"), ranged, traits, deadly: 0, dice: dice || 1,
            reach: ranged ? 0 : (actor.getReach?.({ action: "attack", weapon: item }) ?? 5), range: ranged ? (item.range?.increment ?? item.system?.range?.increment ?? 30) : null,
            damageTypes: rolls.map((r) => r.damageType).filter(Boolean).concat(rolls.length ? [] : [d?.damageType].filter(Boolean)) });
    }
    return out;
}
/** Spell slots left by rank, from the actor's spellcasting entries: [{ rank, left, max }]. */
function slotsLeft(actor) {
    const by = new Map();
    for (const sc of actor?.spellcasting?.regular ?? []) {
        for (const [k, v] of Object.entries(sc.system?.slots ?? {})) {
            const rank = Number(String(k).replace("slot", ""));
            if (!rank || !(Number(v?.max) > 0)) continue;
            const left = Array.isArray(v.prepared) && v.prepared.length ? v.prepared.filter((p) => !p.expended).length : Number(v.value) || 0;
            const cur = by.get(rank) ?? { rank, left: 0, max: 0 };
            by.set(rank, { rank, left: cur.left + left, max: cur.max + Number(v.max) });
        }
    }
    return [...by.values()].sort((a, b) => a.rank - b.rank);
}

function summoner(board, ctx, out) {
    const actor = board.me.actor;
    const me = board.me;
    const lv = level(board);
    if (!has(actor, "eidolon") && !has(actor, "summoner-dedication") && (actor?.class?.slug ?? "") !== "summoner") return;
    const foes = targets(board);
    const rank = Math.max(1, Math.ceil(lv / 2));
    const focus = focusLeft(actor);
    const cha = abil(actor, "cha");
    const type = TYPES.find(([slug]) => has(actor, slug)) ?? null;
    const kind = type?.[1] ?? null;
    const tradition = actor.flags?.pf2e?.eidolon?.tradition ?? actor.flags?.system?.eidolon?.tradition ?? type?.[2] ?? null;
    const dedication = has(actor, "summoner-dedication") && (actor?.class?.slug ?? "") !== "summoner";
    const tandem = has(actor, "act-together") && !dedication;
    const spellNamed = (re) => (board.spells ?? []).find((sp) => re.test(sp.name ?? "") && !sp.consumable) ?? null;
    const boostKnown = !!spellNamed(/^boost eidolon$/i) || has(actor, "link-spells");
    const reinforceKnown = !!spellNamed(/^reinforce eidolon$/i) || has(actor, "reinforce-eidolon");
    const eternal = lv >= 20 && has(actor, "eternal-boost");
    const dc = (board.spells ?? []).map((s) => s.dc).filter((d) => Number.isFinite(d)).sort((a, b) => b - a)[0] ?? (Number(actor.classDC?.value) || 10 + lv + cha + (lv >= 15 ? 6 : lv >= 9 ? 4 : 2));
    const push = (plan) => out.plans.push({ kind: "class", dest: null, notes: [], ...plan, score: plan.ev + (plan.bias ?? 0.4) });
    // The link spells are the read's: the advisor would plan Lifelink Surge as a heal and the boosts as buffs on the party
    board.spells = (board.spells ?? []).filter((sp) => !/^(boost eidolon|reinforce eidolon|lifelink surge|evolution surge|unfetter eidolon|extend boost|eidolon's wrath)$/i.test(sp.name ?? ""));
    const eid = eidolonOf(board);
    // Eternal Boost: permanently quickened, the extra action only for Boost or Reinforce; the plans spend the other actions
    const A = eternal && me.conditions?.has?.("quickened") ? Math.max(0, ctx.actions - 1) : ctx.actions;
    const made0 = ctx.made;

    /* ---------------------------------------------------------------- no eidolon on the board: Manifest it */
    if (!eid) {
        const instant = lv >= 19 && has(actor, "instant-manifestation");
        const cost = instant ? 1 : 3;
        const fp = focus;
        if (A >= cost) {
            const guess = { bonus: lv + 6 + (lv >= 5 ? 2 : 0) + (lv >= 13 ? 2 : 0), avg: 4.5 + 4 + Math.floor(lv / 4) * 4.5 };
            const adj = foes.filter((f) => inReach(me.rect, f.rect, 10)).sort((a, b) => a.hp - b.hp);
            const f = adj[0] ?? foes.sort((a, b) => feetBetween(me.rect, a.rect) - feetBetween(me.rect, b.rect))[0] ?? null;
            const now = f && adj.length ? strikeExpected(guess.bonus + mapFor(made0, false), f.ac, guess.avg).expected : 0;
            const later = f ? strikeExpected(guess.bonus, f.ac, guess.avg).expected + strikeExpected(guess.bonus - 5, f.ac, guess.avg).expected : 0;
            const steps = [];
            let ev = now + 0.5 * later;
            if (has(actor, "ostentatious-arrival") && !instant && fp > 0) {
                const burst = foes.filter((x) => feetBetween(me.rect, x.rect) <= 15);
                if (burst.length) { const d = Math.floor(lv / 2) * 2.5; ev += burst.length * d; steps.push({ cost: 0, text: `Ostentatious Arrival (free action, 1 Focus Point of ${fp}): it arrives in an explosion, ${Math.floor(lv / 2)}d4 to everything within 10 feet of it but you (${burst.map(nameOf).join(", ")}; allies beside you too)` }); }
            }
            steps.push({ cost, text: `Manifest Eidolon (${cost} action${cost > 1 ? "s" : ""}${instant ? ", Instant Manifestation" : ""}): it appears beside you and takes one action${adj.length ? `, a Strike at ${nameOf(f)}` : f ? `, a Stride toward ${nameOf(f)}` : ""}` });
            if (instant && A > cost) steps.push({ cost: A - cost, text: `Then ${A - cost} action${A - cost > 1 ? "s" : ""} for its Strikes or your spells` });
            const notes = ["The read found no eidolon token among your allies (it looks for the eidolon trait, the Eidolon class or a master flag): if it is on the field under another name, this plan is moot.", "Manifest Eidolon has the concentrate and manipulate traits: it provokes from a foe in reach."];
            if (has(actor, "reactive-dismissal")) notes.push("If you dismissed it with Reactive Dismissal last turn, you can't Manifest it until after the end of your next turn.");
            if (has(actor, "meld-into-eidolon")) notes.push("Meld into Eidolon (3 actions) instead: you become it, use its statistics and can't be targeted apart from it, but you can't cast or use tandem actions until it unmanifests.");
            if (lv >= 20 && has(actor, "twin-eidolon")) notes.push("Twin Eidolon: when you Manifest it you can become its duplicate until it unmanifests, with its statistics and evolutions but without your spells.");
            push({ title: "Manifest your eidolon", target: adj.length ? f : null, ev, bias: 0.3, steps, notes });
        } else out.notes.push(`Your eidolon isn't on the board and Manifest Eidolon takes ${instant ? "1 action" : "3 actions"}: this turn is yours alone.`);
        if (focus !== null && focus > 0 && spellNamed(/summon/i)) out.notes.push("With the eidolon away, a summon spell is your other body on the field.");
        summonerNotes(board, ctx, out, { actor, me, lv, foes, focus, kind, eid: null, dedication, tradition, rank, dc });
        return;
    }

    /* ---------------------------------------------------------------- the eidolon's Strikes, from its sheet or the board's best guess */
    const E = eid;
    const eName = nameOf(E);
    const dicePerLevel = lv >= 19 ? 4 : lv >= 12 ? 3 : lv >= 4 ? 2 : 1;
    let fromSheet = true;
    let strikes = [];
    try { strikes = sheetStrikes(E.actor); } catch { strikes = []; }
    const reach = Math.max(E.reach ?? 5, has(actor, "towering-size") ? 15 : has(actor, "hulking-size") ? 10 : 0) + (kind === "plant" && lv >= 7 && !(E.reach > 5) ? 5 : 0);
    if (!strikes.length) {
        fromSheet = false;
        const rs = E.reactiveStrike ?? { bonus: lv + 6, avg: 4 + lv };
        strikes = [
            { label: "primary attack", bonus: rs.bonus, avg: rs.avg, agile: false, ranged: false, reach, traits: ["unarmed"], deadly: 0, dice: dicePerLevel, damageTypes: [] },
            { label: "secondary attack", bonus: rs.bonus, avg: Math.max(1, rs.avg - dicePerLevel), agile: true, ranged: false, reach, traits: ["unarmed", "agile"], deadly: 0, dice: dicePerLevel, damageTypes: [] },
        ];
    } else for (const s of strikes) if (!s.ranged) s.reach = Math.max(s.reach || 5, reach);
    const primary = strikes.filter((s) => !s.ranged).sort((a, b) => b.avg - a.avg)[0] ?? strikes[0];
    const secondary = strikes.filter((s) => !s.ranged && s !== primary).sort((a, b) => b.avg - a.avg)[0] ?? primary;
    const nimble = has(actor, "nimble-form");
    /** The shared multiple attack penalty on the eidolon's attack n (0-based): Nimble Form softens its agile ones. */
    const eMap = (n, agile) => (n <= 0 ? 0 : nimble && agile ? (n === 1 ? -3 : -6) : mapFor(n, agile));
    const frenzy = kind === "anger" && lv >= 7 && !!effect(E.actor, /seething-frenzy/);
    const boostOf = (s) => (frenzy ? Math.min(12, 3 * (s.dice ?? 1)) : Math.min(8, 2 * (s.dice ?? 1)));
    const boostText = `+${boostOf(primary)}${boostOf(secondary) !== boostOf(primary) ? ` (+${boostOf(secondary)} with its ${secondary.label})` : ""} damage`;
    const speed = allySpeed(E);
    const eReach = (s) => s.reach || reach;
    const canHit = (s, at, f) => (s.ranged ? feetBetween(at, f.rect) <= (s.range ?? 30) : inReach(at, f.rect, eReach(s)));
    /** The eidolon's best Strike at f from `at` with n attacks already made this turn; extra on the damage. */
    const eBest = (f, n, { extra = 0, acAdj = 0, at = E.rect, bonusAdj = 0, boosted = false } = {}) => {
        let best = null;
        for (const s of strikes) {
            if (!canHit(s, at, f)) continue;
            const b = s.bonus + eMap(n, s.agile) + bonusAdj;
            const e = strikeExpected(b, f.ac + acAdj, s.avg + extra + (boosted ? boostOf(s) : 0), { deadly: s.deadly });
            if (!best || e.expected > best.e.expected) best = { s, bonus: b, e };
        }
        return best;
    };
    /** A run of k eidolon Strikes at f, the shared penalty climbing from n. */
    const eRun = (f, k, n, { boosted = false, at = E.rect, extra = 0, acAdj = 0 } = {}) => {
        const used = [];
        let ev = 0;
        for (let i = 0; i < k; i++) { const b = eBest(f, n + used.length, { boosted, at, extra, acAdj }); if (!b) break; used.push(b); ev += b.e.expected; }
        const same = used.every((u) => u.s.label === used[0]?.s.label);
        const text = !used.length ? "" : same ? `${eName} Strikes ${nameOf(f)} with its ${used[0].s.label}${times(used.length)} (${used.map((u) => signed(u.bonus)).join(", ")})` : `${eName} Strikes ${nameOf(f)} with its ${used.map((u) => `${u.s.label} (${signed(u.bonus)})`).join(", then its ")}`;
        return { used, ev, text, made: n + used.length };
    };
    /** How the eidolon gets to f: 0 actions in reach, 1 Stride within its Speed, 2 with two Strides; null beyond. */
    const moveTo = (f) => {
        if (strikes.some((s) => canHit(s, E.rect, f))) return { acts: 0, at: E.rect };
        const d = feetBetween(E.rect, f.rect);
        const dir = { x: Math.sign(f.rect.x - E.rect.x), y: Math.sign(f.rect.y - E.rect.y) };
        const at = { ...E.rect, x: f.rect.x - dir.x, y: f.rect.y - dir.y }; // the square beside f on the way in
        if (d <= speed + reach) return { acts: 1, at };
        if (d <= 2 * speed + reach) return { acts: 2, at };
        return null;
    };
    const ownAction = "a 1-action of your own (Stride, Demoralize, Raise a Shield, Reinforce Eidolon)";
    /** The Boost step: inside Act Together (busy) it costs nothing more; with Eternal Boost it's the quickened action and stands alone (null inside Act Together). */
    const eternalStep = eternal && !frenzy ? { cost: 0, text: `Boost Eidolon with your quickened action (Eternal Boost): ${boostText} on its Strikes this round` } : null;
    const boostStep = (busy) => (frenzy || eternal ? null : boostKnown ? { cost: busy ? 0 : 1, text: `${busy ? "you cast " : ""}Boost Eidolon (1 action, cantrip): ${boostText} on its Strikes this round` } : null);
    const extendNote = () => {
        if (!has(actor, "extend-boost") || !(focus > 0) || eternal || frenzy) return null;
        const skill = SKILL_OF[tradition] ?? null;
        const mod = skill ? Number(actor.skills?.[skill]?.mod) : NaN;
        const want = STANDARD_DC[Math.min(20, lv)] ?? 20;
        const c = Number.isFinite(mod) ? degreeChances(mod, want) : null;
        return `Extend Boost (free action, 1 Focus Point of ${focus}) before the Boost: ${skill ? `${skill[0].toUpperCase()}${skill.slice(1)}` : "the tradition's skill"} against DC ${want}${c ? `, about ${pct(c.s + c.cs)} to keep it 3 rounds (${pct(c.cs)} for 4)` : ""}; on a failure it lasts the round and the point isn't spent.`;
    };
    const shared = `You and ${eName} share your ${ctx.actions} action${ctx.actions === 1 ? "" : "s"}, one multiple attack penalty and one pool of Hit Points (${me.hp}/${me.maxHp}).`;
    out.notes.push(`${shared}${fromSheet ? "" : ` The plans use ${eName}'s best Strike from the board and guess an agile second one: open its sheet for the real pair.`}${tandem ? " Act Together is once per round: the plans assume you haven't used it yet." : dedication ? " Your dedication has no Act Together or tandem actions: each of its actions is one of yours, spent plainly." : ""}`);
    if (frenzy) out.notes.push(`Seething Frenzy is on: ${eName} counts as boosted (3 per die on its Strikes) with temporary HP, at -1 AC, and can't stop for a minute. Don't cast Boost Eidolon.`);

    /* ---------------------------------------------------------------- Boost and Strike: Act Together pairs the cantrip with its first Strike */
    for (const f of foes) {
        const mv = moveTo(f);
        if (!mv || mv.acts >= 2 || A < 1) continue;
        const m = mv.acts;
        const bs = boostStep(true);
        const steps = [];
        let ev = 0, n = made0;
        const boosted = !!bs || frenzy || eternal;
        if (tandem) {
            if (A - m < 1) continue;
            if (m) {
                const r = eRun(f, A - 1, n, { boosted, at: mv.at });
                if (!r.used.length) continue;
                steps.push({ cost: 1, text: `Act Together: ${eName} Strides into reach of ${nameOf(f)} and ${bs ? bs.text : `you take ${ownAction}`}` });
                steps.push({ cost: A - 1, text: r.text }); ev = r.ev;
            } else {
                const first = eBest(f, n, { boosted });
                if (!first) continue;
                steps.push({ cost: 1, text: `Act Together: ${bs ? bs.text : `you take ${ownAction}`} and ${eName} Strikes ${nameOf(f)} with its ${first.s.label} (${signed(first.bonus)})` });
                ev = first.e.expected; n += 1;
                if (A > 1) { const r = eRun(f, A - 1, n, { boosted }); if (r.used.length) { steps.push({ cost: A - 1, text: r.text }); ev += r.ev; } }
            }
            if (eternalStep) steps.unshift(eternalStep);
        } else {
            // No Act Together: Boost costs an action of its own; it pays when it adds more than the Strike it displaces
            const withBoost = bs && A - m - 1 >= 1 ? eRun(f, A - m - 1, n, { boosted: true, at: mv.at }) : null;
            const plain = eRun(f, A - m, n, { boosted: frenzy || eternal, at: mv.at });
            const pick = withBoost && withBoost.ev > plain.ev ? withBoost : plain;
            if (!pick.used.length) continue;
            if (m) steps.push({ cost: 1, text: `${eName} Strides into reach of ${nameOf(f)}` });
            if (pick === withBoost) steps.push({ cost: 1, text: bs.text.replace(/^you cast /, "") });
            else if (eternalStep) steps.unshift(eternalStep);
            steps.push({ cost: pick.used.length, text: pick.text }); ev = pick.ev;
        }
        const notes = [];
        const ex = extendNote();
        if (ex && boosted) notes.push(ex);
        if (reinforceKnown && me.hp <= me.maxHp * 0.5) notes.push(`Reinforce Eidolon instead of the Boost when it's taking the hits: +1 AC and saves and resistance ${Math.max(1, Math.floor(rank / 2))} to all damage for the round.`);
        if (kind === "plant" && !inReach(E.rect, f.rect, reach) && inReach(E.rect, f.rect, reach + 5)) notes.push("Tendril Strike: each of these Strikes reaches 5 feet further than its reach, so it needn't move.");
        push({ title: `${bs || frenzy || eternal ? "Boost and " : ""}Strike ${nameOf(f)} with ${eName}`, target: f, ev, steps, notes });
    }

    /* ---------------------------------------------------------------- Seething Frenzy (anger phantom, 7): the Boost that lasts a minute */
    if (kind === "anger" && lv >= 7 && !frenzy && A >= 1) {
        const f = foes.filter((x) => moveTo(x)?.acts === 0).sort((a, b) => a.hp - b.hp)[0];
        if (f && A >= 2) {
            const steps = [{ cost: 1, text: tandem ? `Act Together: ${eName} starts a Seething Frenzy (temporary HP ${lv}, -1 AC, boosted for a minute) and you take ${ownAction}` : `${eName} starts a Seething Frenzy (temporary HP ${lv}, -1 AC, boosted for a minute)` }];
            const r = eRun(f, A - 1, made0, { boosted: true });
            if (r.used.length) { steps.push({ cost: A - 1, text: r.text }); push({ title: `Seething Frenzy, then Strike ${nameOf(f)}`, target: f, ev: r.ev + 0.1 * lv, bias: 0.3, steps, notes: ["The frenzy is a Boost that lasts the fight: every later round's Act Together is free for something else. It can't stop it early."] }); }
        }
    }

    /* ---------------------------------------------------------------- Tandem Strike (6, 2 actions): its Strike and yours at the same penalty */
    if (has(actor, "tandem-strike") && A >= 2 && board.strikes.some((s) => !s.ranged)) {
        for (const f of foes) {
            if (!inReach(me.rect, f.rect, myReach(board)) || !strikes.some((s) => !s.ranged && inReach(E.rect, f.rect, eReach(s)))) continue;
            const bs = A >= 3 ? boostStep(false) : null;
            const boosted = !!bs || frenzy || eternal;
            const eb = eBest(f, made0, { boosted });
            const mb = bestStrike(board, f, { made: made0 });
            if (!eb || !mb) continue;
            const steps = [];
            if (bs) steps.push(bs); else if (eternalStep) steps.push(eternalStep);
            steps.push({ cost: 2, text: `Tandem Strike: ${eName} Strikes ${nameOf(f)} with its ${eb.s.label} (${signed(eb.bonus)}), then you Strike it with ${mb.s.label} (${signed(mb.bonus)}); both at the same penalty` });
            let ev = eb.e.expected + mb.e.expected;
            if (!bs && A >= 3) { const r = eRun(f, 1, made0 + 2, { boosted: frenzy || eternal }); if (r.used.length) { steps.push({ cost: 1, text: r.text }); ev += r.ev; } }
            push({ title: `Tandem Strike on ${nameOf(f)}`, target: f, ev, bias: 0.3, steps, notes: ["If both hit, the damage is combined against its resistances."] });
        }
    }

    /* ---------------------------------------------------------------- Magical Onslaught (10, 2 actions): its Strike opens your cantrip */
    if (has(actor, "magical-onslaught") && A >= 2) {
        const cantrips = castable(board, (sp) => sp.cantrip && sp.cost >= 1 && sp.cost <= 2 && sp.avg > 0 && !sp.heals && (sp.attack != null || sp.save?.stat));
        for (const f of foes) {
            if (!strikes.some((s) => !s.ranged && inReach(E.rect, f.rect, eReach(s)))) continue;
            const spells = cantrips.filter((sp) => !(sp.range > 0) || feetBetween(me.rect, f.rect) <= sp.range);
            if (!spells.length) continue;
            const cast = (sp, hit, n) => {
                if (sp.attack != null) { const b = sp.attack + mapFor(n, false); return hit * strikeExpected(b, f.ac - 2, sp.avg).expected + (1 - hit) * strikeExpected(b, f.ac, sp.avg).expected; }
                const sv = f.saves?.[sp.save.stat] ?? lv + 5;
                return hit * saveExpected(sv - 2, sp.dc ?? dc, sp.avg, { basic: sp.save.basic }).expected + (1 - hit) * saveExpected(sv, sp.dc ?? dc, sp.avg, { basic: sp.save.basic }).expected;
            };
            let best = null;
            // (a) Act Together: Boost and a Strike, then the Onslaught with the boosted Strike; (b) the Onslaught first, then a Strike
            for (const sp of spells) {
                if (A >= 3 && tandem && (boostKnown || frenzy || eternal)) {
                    const first = eBest(f, made0, { boosted: true });
                    const second = first ? eBest(f, made0 + 1, { boosted: true }) : null;
                    if (first && second) {
                        const ev = first.e.expected + second.e.expected + cast(sp, second.e.hit, made0 + 1);
                        const bs = boostStep(true);
                        const steps = [...(eternalStep ? [eternalStep] : []), { cost: 1, text: `Act Together: ${bs ? bs.text : `you take ${ownAction}`} and ${eName} Strikes ${nameOf(f)} with its ${first.s.label} (${signed(first.bonus)})` },
                            { cost: 2, text: `Magical Onslaught: ${eName} Strikes it again (${signed(second.bonus)}), then you cast ${sp.name} on it; on a hit it's ${sp.attack != null ? "off-guard to the spell" : "at -2 to its save"}` }];
                        if (!best || ev > best.ev) best = { ev, steps, sp };
                    }
                }
                const first = eBest(f, made0, { boosted: frenzy || eternal });
                if (first) {
                    let ev = first.e.expected + cast(sp, first.e.hit, made0);
                    const steps = [...(eternalStep ? [eternalStep] : []), { cost: 2, text: `Magical Onslaught: ${eName} Strikes ${nameOf(f)} with its ${first.s.label} (${signed(first.bonus)}), then you cast ${sp.name} on it; on a hit it's ${sp.attack != null ? "off-guard to the spell" : "at -2 to its save"}` }];
                    if (A >= 3) { const r = eRun(f, 1, made0 + 2, { boosted: frenzy || eternal }); if (r.used.length) { steps.push({ cost: 1, text: r.text }); ev += r.ev; } }
                    if (!best || ev > best.ev) best = { ev, steps, sp };
                }
            }
            if (best) push({ title: `Magical Onslaught on ${nameOf(f)} with ${best.sp.name}`, target: f, ev: best.ev, bias: 0.3, steps: best.steps, notes: ["Its Strike and your spell attack share the penalty, which doesn't climb until both are made. Same damage type on both: combined against resistances."] });
        }
    }

    /* ---------------------------------------------------------------- the eidolon's two-action activities, folded into Act Together */
    /** X: { name, ev, text, attacks, boosted, target, notes }. Act Together pairs it with the Boost (when its Strikes are boosted) or with an eidolon Strike; the actions left are its Strikes. */
    const activity = (X) => {
        if (A < 2) return;
        const steps = [];
        let ev = X.ev, n = made0 + X.attacks;
        const bs = X.boosted ? boostStep(true) : null;
        if (tandem) {
            if (bs) steps.push({ cost: 2, text: `Act Together: ${bs.text} and ${X.text}` });
            else {
                const partner = X.target ? eBest(X.target, X.attacks ? n : made0, { boosted: frenzy }) : null;
                if (partner && X.partnerStrike !== false) { steps.push({ cost: 2, text: `Act Together: ${X.text}, and ${eName} Strikes ${nameOf(X.target)} with its ${partner.s.label} (${signed(partner.bonus)})` }); ev += partner.e.expected; n += 1; }
                else steps.push({ cost: 2, text: `Act Together: ${X.text}, and you take ${ownAction}` });
            }
        } else {
            if (bs && A >= 3) steps.push({ cost: 1, text: bs.text.replace(/^you cast /, "") });
            steps.push({ cost: 2, text: X.text });
        }
        if (eternalStep && X.boosted) steps.unshift(eternalStep);
        const spent = steps.reduce((t, s) => t + s.cost, 0);
        if (A - spent >= 1 && X.target && X.after !== false) { const r = eRun(X.target, A - spent, n, { boosted: X.boosted && (!!bs || frenzy || eternal) }); if (r.used.length) { steps.push({ cost: r.used.length, text: r.text }); ev += r.ev; } }
        push({ title: X.title, target: X.target ?? null, ev, bias: X.bias ?? 0.3, steps, notes: X.notes ?? [] });
    };
    const inReachOfE = (f) => strikes.some((s) => !s.ranged && inReach(E.rect, f.rect, eReach(s)));
    const dieAvg = (s) => ((Number(String(s.item?.system?.damage?.die ?? "").replace("d", "")) || 8) + 1) / 2;
    // Furious Strike (anger phantom, 2 actions, counts as two attacks): extra dice and a flat bonus on a hit
    if (kind === "anger") {
        const extraDice = lv >= 18 ? 3 : lv >= 10 ? 2 : 1;
        for (const f of foes.filter(inReachOfE)) {
            const b = eBest(f, made0, { boosted: boostKnown || frenzy || eternal, extra: extraDice * dieAvg(primary) + extraDice });
            if (!b) continue;
            activity({ title: `Furious Strike on ${nameOf(f)}`, target: f, ev: b.e.expected, attacks: 2, boosted: true, text: `${eName} uses Furious Strike on ${nameOf(f)} (${signed(b.bonus)}): +${extraDice} weapon ${extraDice === 1 ? "die" : "dice"} and +${extraDice} on a hit; it counts as two attacks`, notes: ["One big Strike for the cost of two: better than two Strikes when the second would be at -5 against a high AC."] });
        }
    }
    // Beast's Charge (beast, 2 actions): two Strides and a Strike, +1 after 20 feet in a straight line
    if (kind === "beast") {
        for (const f of foes) {
            const mv = moveTo(f);
            if (!mv || mv.acts === 0 || (mv.acts === 1 && A >= 3)) continue;
            const straight = feetBetween(E.rect, f.rect) >= 20;
            const b = eBest(f, made0, { boosted: boostKnown || frenzy || eternal, at: mv.at, bonusAdj: straight ? 1 : 0 });
            if (!b) continue;
            activity({ title: `Beast's Charge at ${nameOf(f)}`, target: f, ev: b.e.expected, attacks: 1, boosted: true, text: `${eName} uses Beast's Charge: Strides twice to ${nameOf(f)} and Strikes with its ${b.s.label} (${signed(b.bonus)}${straight ? ", +1 counted for 20 feet in a straight line" : ""})`, notes: ["The +1 needs 20 feet of movement in a straight line; the plan counts it when the foe is that far."], bias: 0.2 });
        }
    }
    // Draconic Frenzy (dragon, 7; 2 actions): the primary once and the secondary twice, the penalty climbing
    if (kind === "dragon" && lv >= 7) {
        for (const f of foes.filter(inReachOfE)) {
            const boosted = boostKnown || frenzy || eternal;
            const b1 = strikeExpected(primary.bonus + eMap(made0, primary.agile), f.ac, primary.avg + (boosted ? boostOf(primary) : 0), { deadly: primary.deadly });
            const b2 = strikeExpected(secondary.bonus + eMap(made0 + 1, secondary.agile), f.ac, secondary.avg + (boosted ? boostOf(secondary) : 0), { deadly: secondary.deadly });
            const b3 = strikeExpected(secondary.bonus + eMap(made0 + 2, secondary.agile), f.ac, secondary.avg + (boosted ? boostOf(secondary) : 0), { deadly: secondary.deadly });
            activity({ title: `Draconic Frenzy on ${nameOf(f)}`, target: f, ev: b1.expected + b2.expected + b3.expected, attacks: 3, boosted: true, after: false, text: `${eName} uses Draconic Frenzy on ${nameOf(f)}: ${primary.label} (${signed(primary.bonus + eMap(made0, primary.agile))}) and ${secondary.label} twice (${signed(secondary.bonus + eMap(made0 + 1, secondary.agile))}, ${signed(secondary.bonus + eMap(made0 + 2, secondary.agile))})`, notes: ["A critical hit in the frenzy recovers its Dragon Breath at once. Three attacks: the action left is for a move or a cantrip, not a fourth Strike."] });
        }
    }
    // Dragon Breath (dragon, 2 actions): a 60-foot line or a 30-foot cone from the eidolon, basic Reflex, then 1d4 rounds to recharge
    if (kind === "dragon") {
        const dice = Math.ceil(lv / 2);
        const c0 = center(E.rect);
        const ang = (c) => Math.atan2(center(c.rect).y - c0.y, center(c.rect).x - c0.x);
        const cands = foes.filter((f) => feetBetween(E.rect, f.rect) <= 60 && f.rect !== E.rect).map((f) => ({ f, ang: ang(f), d: feetBetween(E.rect, f.rect) }));
        let best = null;
        for (const a of cands) {
            const cone = cands.filter((b) => b.d <= 30 && angleDiff(a.ang, b.ang) <= Math.PI / 4 + 1e-9).map((b) => b.f);
            const line = cands.filter((b) => angleDiff(a.ang, b.ang) <= Math.PI / 16 + 1e-9).map((b) => b.f);
            for (const [shape, hit] of [["cone", cone], ["line", line]]) {
                if (!hit.length) continue;
                const ev = hit.reduce((t, f) => t + saveExpected(f.saves?.reflex ?? lv + 5, dc, dice * 3.5).expected, 0);
                if (!best || ev > best.ev) best = { ev, hit, shape, aim: a.f, ang: a.ang };
            }
        }
        if (best) {
            const caught = [me, ...board.allies.filter((x) => x !== E)].filter((x) => x.rect && feetBetween(E.rect, x.rect) <= (best.shape === "cone" ? 30 : 60) && angleDiff(ang(x), best.ang) <= (best.shape === "cone" ? Math.PI / 4 : Math.PI / 16) + 1e-9);
            const notes = ["Then it can't breathe again for 1d4 rounds; the read can't see whether it has recharged.", `${best.shape === "cone" ? "A 30-foot cone" : "A 60-foot line"} from where it stands, if that's the shape you chose; the other shape may catch a different set.`];
            if (caught.length) notes.push(`It also catches ${caught.map(nameOf).join(", ")}: aim it or move first.`);
            if (lv >= 17) notes.push("Empower Breath (free action, once a minute) first: double the dice and the area.");
            activity({ title: `Dragon Breath on ${best.hit.length} foe${best.hit.length > 1 ? "s" : ""}`, target: best.aim, ev: best.ev, attacks: 0, boosted: false, text: `${eName} breathes (${dice}d6, basic Reflex DC ${dc}) ${best.shape === "cone" ? "in a cone" : "in a line"} through ${best.hit.map(nameOf).join(", ")}`, notes, bias: best.hit.length >= 2 ? 0.5 : 0.2 });
        }
    }
    // Primal Roar (beast, 7; 2 actions): one Intimidation check to Demoralize every foe that hears it
    if (kind === "beast" && lv >= 7 && A >= 2) {
        const mod = Number(E.actor?.skills?.intimidation?.mod ?? me.intimidation ?? lv + 3 + cha) || 0;
        const fresh = foes.filter((f) => !f.conditions?.has?.("frightened") && feetBetween(E.rect, f.rect) <= 60);
        if (fresh.length >= 2) {
            let ev = 0;
            for (const f of fresh) { const c = degreeChances(mod, 10 + (f.saves?.will ?? lv + 5)); ev += (c.s + c.cs) * worth(board, "frightened") + c.cs * worth(board, "frightened"); }
            activity({ title: `Primal Roar at ${fresh.length} foes`, target: fresh.sort((a, b) => a.hp - b.hp)[0], ev, attacks: 0, boosted: false, text: `${eName} roars (Intimidation ${signed(mod)} against each foe's Will DC, no language penalty): ${fresh.map(nameOf).join(", ")} may be frightened`, notes: ["Each foe it rattles is then immune to its Demoralize for 10 minutes. Best before the party's attacks, when none is frightened yet."], bias: 0.3 });
        }
    }
    // Whirlwind Maul (beast, 17; 2 actions): a Strike at up to four foes in reach at the same penalty
    if (kind === "beast" && lv >= 17) {
        const near = foes.filter(inReachOfE).slice(0, 4);
        if (near.length >= 2) {
            const boosted = boostKnown || frenzy || eternal;
            const bs = near.map((f) => eBest(f, made0, { boosted })).filter(Boolean);
            activity({ title: `Whirlwind Maul on ${bs.length} foes`, target: near[0], ev: bs.reduce((t, b) => t + b.e.expected, 0), attacks: bs.length, boosted: true, text: `${eName} uses Whirlwind Maul: a Strike at ${near.map(nameOf).join(", ")} (${bs.map((b) => signed(b.bonus)).join(", ")}), the penalty climbing only afterward`, bias: 0.4 });
        }
    }
    // Drain Life (undead, 7; 2 actions): a Strike at a living foe, then a Fortitude save for extra void damage and drained
    if (kind === "undead" && lv >= 7) {
        for (const f of foes.filter(inReachOfE)) {
            const b = eBest(f, made0, { boosted: boostKnown || frenzy || eternal });
            if (!b) continue;
            const c = degreeChances(f.saves?.fortitude ?? lv + 5, dc);
            const rider = b.e.hit * ((c.s + c.f + c.cf) * Math.floor(lv / 2) + c.f * worth(board, "drained") + c.cf * 2 * worth(board, "drained"));
            activity({ title: `Drain Life on ${nameOf(f)}`, target: f, ev: b.e.expected + rider, attacks: 1, boosted: true, text: `${eName} uses Drain Life on ${nameOf(f)} (${signed(b.bonus)}): on a hit, Fortitude DC ${dc} or +${Math.floor(lv / 2)} void and drained 1 (drained 2 and temporary HP for it on a critical failure)`, notes: ["Only against a living foe; a critical hit worsens its save by a degree."] });
        }
    }
    // Visions of Sin (demon, 7; 2 actions, once per 10 minutes): Will save or no reactions, slowed 1 on a failure, confused on a critical failure
    if (kind === "demon" && lv >= 7) {
        const near = foes.filter((f) => feetBetween(E.rect, f.rect) <= 30);
        for (const f of near) {
            const c = degreeChances(f.saves?.will ?? lv + 5, dc);
            const ev = (c.s + c.f + c.cf) * 1 + (c.f + c.cf) * worth(board, "slowed") + c.cf * worth(board, "confused") * 0.5;
            activity({ title: `Visions of Sin on ${nameOf(f)}`, target: f, ev, attacks: 0, boosted: false, text: `${eName} uses Visions of Sin on ${nameOf(f)} (Will DC ${dc}): it loses its reactions; slowed 1 on a failure, confused a round on a critical failure, until the end of your next turn`, notes: ["Once per 10 minutes, and the foe is then immune for a day; it can Sustain it up to a minute. Spend it on the foe whose reactions or actions matter most."], bias: 0.2 });
        }
    }
    // Field of Roots (plant, 17; 2 actions): every foe in its reach saves or takes its best Strike's damage and keeps taking it
    if (kind === "plant" && lv >= 17) {
        const near = foes.filter((f) => inReach(E.rect, f.rect, reach));
        if (near.length >= 2) {
            let ev = 0;
            for (const f of near) { const c = degreeChances(f.saves?.reflex ?? lv + 5, dc); ev += c.cf * primary.avg * 2 + c.f * primary.avg * 0.5 * 2 + (c.s + c.f) * 1 + c.cf * worth(board, "immobilized"); }
            activity({ title: `Field of Roots on ${near.length} foes`, target: near[0], ev, attacks: 0, boosted: false, after: false, partnerStrike: false, text: `${eName} uses Field of Roots (Reflex DC ${dc}) on ${near.map(nameOf).join(", ")}: its best Strike's damage, again at the end of each of their turns while they stay in its reach`, notes: ["Afterward it is immobilized until it spends an Interact action to detach, which also ends the roots."], bias: 0.4 });
        }
    }
    // Elemental Burst (elemental, 7; 2 actions, once per 10 minutes): a 20-foot burst within 60 feet for max(6, level-1)d6, at the cost of your level in shared HP
    if (kind === "elemental" && lv >= 7) {
        const dice = Math.max(6, lv - 1);
        let best = null;
        for (const c of foes) {
            if (feetBetween(E.rect, c.rect) > 60) continue;
            const hit = foes.filter((f) => feetBetween(c.rect, f.rect) <= 20);
            const ev = hit.reduce((t, f) => t + saveExpected(f.saves?.reflex ?? lv + 5, dc, dice * 3.5).expected, 0) - 0.8 * lv;
            if (!best || ev > best.ev) best = { c, hit, ev };
        }
        if (best && best.hit.length >= 2 && best.ev > 0) {
            const caught = [me, ...board.allies.filter((x) => x !== E)].filter((x) => x.rect && feetBetween(best.c.rect, x.rect) <= 20);
            activity({ title: `Elemental Burst on ${best.hit.length} foes`, target: best.c, ev: best.ev, attacks: 0, boosted: false, text: `${eName} hurls an Elemental Burst centred on ${nameOf(best.c)} (${dice}d6, basic Reflex DC ${dc}): ${best.hit.map(nameOf).join(", ")}`, notes: [`It costs ${lv} of your shared HP (counted), and it's once per 10 minutes.`, ...(caught.length ? [`It also catches ${caught.map(nameOf).join(", ")}.`] : [])], bias: 0.4 });
        }
    }
    // Elemental Maelstrom (elemental, 17; 3 actions): a Stride with a Strike at every foe it passes, the penalty climbing afterward
    if (kind === "elemental" && lv >= 17 && A >= 3) {
        const along = foes.filter((f) => feetBetween(E.rect, f.rect) <= speed + reach);
        if (along.length >= 2) {
            const bs = along.map((f) => eBest(f, made0, { boosted: frenzy || eternal, at: f.rect === E.rect ? E.rect : { ...E.rect, x: f.rect.x - 1, y: f.rect.y } })).filter(Boolean);
            if (bs.length >= 2) push({ title: `Elemental Maelstrom through ${bs.length} foes`, target: along[0], ev: bs.reduce((t, b) => t + b.e.expected, 0), bias: 0.3, steps: [{ cost: 3, text: `${eName} becomes a maelstrom: a Stride with a Strike at each of ${along.map(nameOf).join(", ")} it passes (${bs.map((b) => signed(b.bonus)).join(", ")})` }], notes: ["Its whole turn; plot the Stride so its reach sweeps each foe once."] });
        }
    }
    // Tendril Strike (plant, 1 action): a melee Strike 5 feet beyond its reach. The Boost-and-Strike plans already use the longer reach; this is the note on it.
    // Eidolon's Wrath (6, focus, 2 actions, cast by the eidolon): a 20-foot emanation around it, basic Reflex
    if (hasAny(actor, "eidolons-wrath", "eidolon-s-wrath") && focus > 0) {
        const hit = foes.filter((f) => feetBetween(E.rect, f.rect) <= 20);
        if (hit.length) {
            const avg = (5 + 2 * Math.max(0, rank - 3)) * 3.5;
            const ev = hit.reduce((t, f) => t + saveExpected(f.saves?.reflex ?? lv + 5, dc, avg).expected, 0);
            const caught = [me, ...board.allies.filter((x) => x !== E)].filter((x) => x.rect && feetBetween(E.rect, x.rect) <= 20);
            const alt = eRun(hit[0], 2, made0, { boosted: boostKnown || frenzy }).ev;
            const notes = [`1 Focus Point of ${focus}. ${hit.length >= 2 || ev >= alt + 3 + rank ? "It catches enough to be worth the point." : `Two boosted Strikes on ${nameOf(hit[0])} come to about ${r1(alt)}; keep the point unless the spread matters.`}`];
            if (caught.length) notes.push(`The emanation also catches ${caught.map(nameOf).join(", ")}.`);
            activity({ title: `Eidolon's Wrath on ${hit.length} foe${hit.length > 1 ? "s" : ""}`, target: hit[0], ev, attacks: 0, boosted: false, text: `${eName} casts Eidolon's Wrath (${5 + 2 * Math.max(0, rank - 3)}d6, basic Reflex DC ${dc}, 20 feet around it): ${hit.map(nameOf).join(", ")}`, notes, bias: 0.2 });
        }
    }
    // Piercing Jab (14; 2 actions, a piercing primary): a Strike that grabs, and bleeds when the grab ends
    if (has(actor, "piercing-jab") && (primary.damageTypes ?? []).includes("piercing")) {
        for (const f of foes.filter((x) => inReach(E.rect, x.rect, eReach(primary)))) {
            const boosted = boostKnown || frenzy || eternal;
            const e = strikeExpected(primary.bonus + eMap(made0, primary.agile), f.ac, primary.avg + (boosted ? boostOf(primary) : 0), { deadly: primary.deadly });
            const ev = e.expected + e.hit * (worth(board, "grabbed") + (primary.dice ?? 1) * 1.5);
            activity({ title: `Piercing Jab on ${nameOf(f)}`, target: f, ev, attacks: 1, boosted: true, text: `${eName} uses Piercing Jab on ${nameOf(f)} with its ${primary.label} (${signed(primary.bonus + eMap(made0, primary.agile))}): a hit grabs it until it Escapes, and ${primary.dice ?? 1} persistent bleed when the grab ends`, notes: ["Its next primary Strike releases the grab: follow with the secondary attack."], bias: 0.2 });
        }
    }
    // Eidolon's Trample (16; 3 actions): a double Stride through smaller foes, each saving against its secondary attack's damage
    if (hasAny(actor, "eidolons-trample", "eidolon-s-trample") && A >= 3) {
        const small = foes.filter((f) => (f.sizeRank ?? 2) < (E.sizeRank ?? 2) && feetBetween(E.rect, f.rect) <= 2 * speed);
        if (small.length >= 2) {
            const ev = small.reduce((t, f) => t + saveExpected(f.saves?.reflex ?? lv + 5, dc, secondary.avg).expected, 0);
            push({ title: `Eidolon's Trample over ${small.length} foes`, target: small[0], ev, bias: 0.3, steps: [{ cost: 3, text: `${eName} Tramples: Strides up to ${2 * speed} feet through ${small.map(nameOf).join(", ")} (${r1(secondary.avg)} bludgeoning each, basic Reflex DC ${dc})` }], notes: ["Only creatures at least a size smaller than it; its whole turn."] });
        }
    }

    /* ---------------------------------------------------------------- Lifelink Surge (4, focus, 1 action): fast healing on the shared pool */
    if (has(actor, "lifelink-surge") && focus > 0 && A >= 1 && me.hp <= me.maxHp * 0.6) {
        const fh = 4 + 2 * Math.max(0, rank - 2);
        const missing = me.maxHp - me.hp;
        const ev = 0.8 * Math.min(missing, 2.5 * fh);
        push({ title: "Lifelink Surge", target: null, ev, bias: 0.2, steps: [{ cost: 1, text: `Lifelink Surge (1 action, 1 Focus Point of ${focus}): fast healing ${fh} for 4 rounds on ${eName}, which is your shared pool (${me.hp}/${me.maxHp})` }], notes: ["It heals at the start of each of its turns: the earlier in the fight, the more it returns. It has the manipulate trait."] });
    }

    summonerNotes(board, ctx, out, { actor, me, lv, foes, focus, kind, eid: E, dedication, tradition, rank, dc, reach, speed, primary, fromSheet, tandem });
}

/** The when-notes, with or without the eidolon on the board. */
function summonerNotes(board, ctx, out, { actor, me, lv, foes, focus, kind, eid, dedication, tradition, rank, dc, reach = 5, speed = 25, primary = null, tandem = false }) {
    const n = (t) => { if (t) out.notes.push(t); };
    const E = eid;
    const eName = E ? nameOf(E) : "your eidolon";
    const nearMe = foes.filter((f) => inReach(f.rect, me.rect, 10));
    const half = Math.max(1, Math.floor(lv / 2));
    // Focus and slots
    if (focus !== null) {
        const spells = [];
        if (has(actor, "link-spells") || has(actor, "evolution-surge")) spells.push("Evolution Surge (2 actions, a minute: +20 Speed, swim, senses" + (rank >= 5 ? ", Large or Huge with reach, a climb or fly Speed" : rank >= 3 ? ", Large with reach 10, a climb Speed" : "") + ")");
        if (has(actor, "lifelink-surge")) spells.push(`Lifelink Surge (1 action: fast healing ${4 + 2 * Math.max(0, rank - 2)} for 4 rounds)`);
        if (has(actor, "unfetter-eidolon")) spells.push("Unfetter Eidolon (2 actions: no tether for a minute, +1 against being held)");
        if (has(actor, "extend-boost")) spells.push("Extend Boost (free action: a Boost that lasts 3 rounds on a skill check)");
        if (hasAny(actor, "eidolons-wrath", "eidolon-s-wrath")) spells.push("Eidolon's Wrath (2 actions by the eidolon: a 20-foot blast around it)");
        n(`Focus Points: ${focus} left${has(actor, "link-focus") ? "; Refocus refills the whole pool (Link Focus)" : "; Refocus brings back 1 in 10 minutes"}.${spells.length ? ` Link spells: ${spells.join("; ")}.` : ""}`);
    }
    const slots = slotsLeft(actor);
    if (slots.length) {
        const left = slots.filter((s) => s.max > 0).map((s) => `rank ${s.rank}: ${s.left} of ${s.max}`).join(", ");
        n(`Spell slots left: ${left}. Two a rank at most: ${eName}'s Strikes and your cantrips carry the fight, a slot when a spell catches two foes or ends one.${has(actor, "master-summoner") ? " Master Summoner: the slot you split holds only summon or incarnate spells." : ""}${lv >= 20 && has(actor, "legendary-summoner") ? " Legendary Summoner: those summoning slots cast at rank 10." : ""}`);
    }
    if (tandem && E) {
        n(`Act Together with 2 actions: a 2-action spell of yours and a Strike by ${eName} in the same two actions; add its Strike to any spell plan below. With 3: a 3-action spell and its Strike.`);
        if (has(actor, "tandem-movement")) n(`Tandem Movement (1 action): you both Stride; the plans' eidolon Stride can be this and bring you along.`);
    }
    if (E) {
        const d = feetBetween(me.rect, E.rect);
        if (d > 60 && !has(actor, "unfetter-eidolon")) n(`${eName} is ${d} feet from you: beyond 100 feet it unmanifests.`);
        else if (d > 60) n(`${eName} is ${d} feet from you: Unfetter Eidolon (2 actions, 1 Focus Point) lifts the 100-foot tether for a minute.`);
        if (has(actor, "defend-summoner") && nearMe.length && inReach(E.rect, me.rect, reach)) n(`Defend Summoner (1 action, ${eName}): +2 AC for you until your next turn while you stay in its reach.`);
        if (has(actor, "transpose") && nearMe.length && !foes.some((f) => inReach(E.rect, f.rect, reach))) n(`Transpose (1 action): you and ${eName} swap places; it takes your spot in the melee and you leave it.`);
        if (hasAny(actor, "summoners-call", "summoner-s-call") && d > 5) n(`Summoner's Call (reaction): when you or ${eName} take damage from a foe, it teleports to your side.`);
        if (hasAny(actor, "eidolons-retort", "eidolon-s-retort")) n(`Eidolon's Retort (reaction): when a creature in ${eName}'s reach moves, uses a manipulate action or makes a ranged attack, it Strikes them outside the shared penalty${has(actor, "guiding-retort") ? "; Guiding Retort: a hit moves them up to 10 feet" : ""}.`);
        if (kind === "devotion") n(`Dutiful Retaliation (reaction): when a foe within 15 feet of you hits you, ${eName} within 15 feet Strikes it back, reach or not.`);
        if (has(actor, "reactive-dismissal")) n(`Reactive Dismissal (reaction): when ${eName} would take damage, reduce it by ${2 * lv} and it unmanifests; no Manifest until after the end of your next turn.`);
        if (has(actor, "protective-bond")) n(`Protective Bond (reaction): when an area catches you both, you take the lower of the two damage amounts.`);
        if (has(actor, "phase-out") && me.hp <= me.maxHp * 0.4) n(`Phase Out (3 actions): ${eName} gains resistance ${half} to almost all damage but can't Strike until it Dismisses the effect; a turn to weather a bad round.`);
        if (has(actor, "shrink-down")) n(`Shrink Down (1 action): ${eName} shrinks to Small${has(actor, "miniaturize") ? " or Tiny" : ""} with reach 5, to fit a gap or a doorway.`);
        if (has(actor, "constricting-hold")) { const held = foes.find((f) => f.conditions?.has?.("grabbed") || f.conditions?.has?.("restrained")); if (held) n(`Constricting Hold (1 action): ${nameOf(held)} is held, so ${eName} can crush it for ${lv + abil(E.actor, "str")} bludgeoning, basic Fortitude DC ${dc}.`); }
        if (has(actor, "grasping-limbs")) n(`Grasping Limbs: ${eName} can Grab (1 action) with its grapple attack after a hit; a grabbed foe is off-guard to the whole party.`);
        if (has(actor, "weighty-impact")) n(`Weighty Impact: ${eName} can Knockdown or Push (1 action) with that attack after a hit; prone is worth about ${r1(worth(board, "prone"))} to the party.`);
        else if (has(actor, "pushing-attack")) n(`Pushing Attack: ${eName} can Push (1 action) with its shove attack after a hit.`);
        if (has(actor, "merciless-rend")) n(`Merciless Rend (1 action): after ${eName} hits the same foe with two slashing Strikes this turn, its secondary attack's damage lands again without a roll; the third action of a two-Strike turn.`);
        if (has(actor, "surprising-leap")) n(`Surprising Leap (2 actions): ${eName} Leaps or Long Jumps up to ${2 * speed} feet and Strikes along the way; a way over a gap or a wall.`);
        if (has(actor, "blood-frenzy")) n(`Blood Frenzy (1 action, right after it deals bleed): ${eName} gains Boost Eidolon and ${lv} temporary HP for a minute at -1 AC.`);
        if (has(actor, "bloodletting-claws")) n(`Bloodletting Claws: ${eName}'s critical hits with slashing or piercing attacks add persistent bleed.`);
        if (has(actor, "hobbling-criticals")) n(`Hobbling Criticals: a critical hit by ${eName} makes the foe save or be slowed 1 and -10 Speed for a round.`);
        if (has(actor, "energy-heart")) n(`Energy Heart: one of ${eName}'s attacks deals energy damage with resistance ${has(actor, "energy-resistance") ? lv : half} to it${has(actor, "dual-energy-heart") ? ", versatile for a second type" : ""}; pick that attack against a foe that resists physical damage.`);
        if (kind === "angel") n(`Hallowed Strikes: ${eName}'s attacks are holy and deal 1 extra spirit damage to unholy foes; nonlethal at no penalty.${lv >= 7 ? " Traveler's Aura: it is never off-guard to lower-level foes within 20 feet." : ""}${lv >= 17 ? " Angelic Mercy: it can cast Heal, Clear Mind and Cleanse Affliction once a day each at rank 9." : ""}`);
        if (kind === "demon") n(`Demonic Strikes: ${eName}'s attacks are unholy and deal 1 extra spirit damage to holy foes.${lv >= 17 ? " Blasphemous Decree: Divine Decree once a day at rank 9, and you are unaffected." : ""}`);
        if (kind === "psychopomp") n(`Spirit Touch: ${eName}'s attacks reach incorporeal foes as if ghost touch, +1 void to the living and +1 vitality to undead.${lv >= 7 ? " Hidden Watcher: once an hour it can cast Invisibility on you, itself or both." : ""}`);
        if (kind === "anger" && lv >= 17) n(`Anger Aura: every creature within 20 feet of ${eName}, friend or foe, has its resistances reduced by 10; it can hold the aura in for 1 action.`);
        if (kind === "devotion" && lv >= 17) n(`Devotion Aura: when an ally within 20 feet of ${eName} takes damage, you can cut it by 6 and lose half that from your own HP.`);
        if (kind === "undead" && lv >= 17) n(`Rejuvenation: the first time a day your turn begins while you're dying, you regain ${3 * lv} HP.`);
        if (kind === "plant" && lv < 17) n(`Tendril Strike (1 action): a Strike 5 feet beyond ${eName}'s reach${lv >= 7 ? ", on top of Growing Vines' reach" : ""}; the plans count the longer reach.`);
        if (kind === "elemental") n(`Elemental core: ${eName}'s attacks carry its element's trait${lv >= 7 ? "; Elemental Burst (2 actions, once per 10 minutes) is the plan above when two foes stand together" : ""}.`);
        if (kind === "fey") n(`Fey Gift: ${eName} casts two cantrips as innate spells${lv >= 7 ? " and two rank-2 and rank-1 spells once a day" : ""}; they cost your shared actions like any of its actions.`);
        if (has(actor, "magical-understudy") || has(actor, "magical-adept") || has(actor, "magical-master")) n(`${eName} has innate spells of its own (Magical ${has(actor, "magical-master") ? "Master" : has(actor, "magical-adept") ? "Adept" : "Understudy"}); they cost your shared actions${has(actor, "share-eidolon-magic") ? ", and Share Eidolon Magic lets you cast them too, off the same daily uses" : ""}.`);
        if (has(actor, "ranged-combatant") && primary && !primary.ranged) n(`Ranged Combatant: ${eName} has a 30-foot ranged unarmed attack (1d4, propulsive)${E.actor?.system?.actions ? "" : "; the read didn't see it on the board"}.`);
        if (has(actor, "airborne-form")) n(`Airborne Form: ${eName} flies at its Speed.`);
        if (has(actor, "steed-form")) n(`Steed Form: ride ${eName} and you keep 3 actions; its moves then have the tandem trait.`);
        if (has(actor, "protective-pose") && me.hp <= me.maxHp * 0.6) n(`Protective Pose (2 actions, within 30 feet of each other): resistance ${half} to one energy type for everyone near either of you until your next turn.`);
        if (has(actor, "boost-summons") && board.allies.some((a) => (a.traits ?? []).includes("summoned"))) n("Boost Summons: your Boost Eidolon also reaches your summoned creatures within 60 feet.");
        if (lv >= 20 && has(actor, "eternal-boost")) n("Eternal Boost: you're quickened, the extra action only for Boost or Reinforce Eidolon; the plans spend it on the Boost.");
        if (lv >= 20 && has(actor, "twin-eidolon")) n("Twin Eidolon: Manifest it again to become its duplicate until it unmanifests.");
    }
    if (has(actor, "share-senses") && foes.some((f) => f.state === "hidden" || f.state === "concealed")) n(`Share Senses (1 action): perceive through ${eName} for a minute; useful when it has the better view or senses.`);
    if (has(actor, "meld-into-eidolon") && E && inReach(me.rect, E.rect, 5)) n(`Meld into Eidolon (3 actions): you merge into ${eName} and can't be targeted apart from it, at the cost of your spells and tandem actions.`);
    if (dedication) n("Summoner Dedication: your eidolon's Strikes and moves each spend one of your actions, with no Act Together.");
}

export { summoner };
