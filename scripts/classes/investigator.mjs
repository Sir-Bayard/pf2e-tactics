/**
 * PF2e Tactics: classes/investigator.mjs
 * See classes/_common.mjs for the shape of a class read.
 * What the investigator knows that the advisor doesn't: Devise a Stratagem is a roll you see before you commit, so the plan is
 * a decision table on the d20 (Strike with Intelligence and Strategic Strike's dice on a good roll, a maneuver with Athletic
 * Strategist on a middling one, something else on a bad one); the dice by level; Ongoing Strategy's flat precision on every
 * other Strike; the lead (Pursue a Lead, Person of Interest) that makes the Devise free; a stratagem already rolled this round
 * (the effect's badge is the d20); the riders on a devised hit (Shared Stratagem, Didactic Strike, Scalpel's Point, Certain
 * Stratagem, Strategic Bypass, Known Weaknesses); Pointed Question folded into the devised turn; Just as Planned's second d20.
 * The rest are when-notes.
 */
import { bestStrike, canMove, effect, has, level, moveText, myReach, pct, slugOf, squareToReach, targets, usesLeft, worth, degreeChances, feetBetween, inReach, mapFor, strikeExpected, nameOf, signed } from "./_common.mjs";

const abil = (actor, k) => Number(actor?.abilities?.[k]?.mod ?? actor?.system?.abilities?.[k]?.mod) || 0;
/** Strategic Strike dice: 1d6, +1 at 5, 9, 13 and 17. */
const strikeDice = (lv) => (lv >= 17 ? 5 : lv >= 13 ? 4 : lv >= 9 ? 3 : lv >= 5 ? 2 : 1);
const times = (n) => (n === 1 ? "" : n === 2 ? " twice" : n === 3 ? " three times" : ` ${n} times`);
const groupOf = (s) => String(s.group ?? s.item?.system?.group ?? "").toLowerCase();
const twoHanded = (s) => String(s.hands ?? s.item?.system?.usage?.value ?? "").includes("2") || (s.traits ?? []).some((t) => t === "two-hand" || t.startsWith("two-hand-"));
const pierceOrSlash = (s) => (s.damageTypes ?? []).some((t) => ["piercing", "slashing"].includes(t)) || /piercing|slashing/.test(String(s.item?.system?.damage?.damageType ?? ""));
/** The degree of a Strike whose d20 is already known: 0 crit fail, 1 fail, 2 hit, 3 crit. */
function degreeAt(r, bonus, ac) {
    const total = r + bonus;
    let d = total >= ac + 10 ? 3 : total >= ac ? 2 : total <= ac - 10 ? 0 : 1;
    if (r === 20) d = Math.min(3, d + 1);
    if (r === 1) d = Math.max(0, d - 1);
    return d;
}
/** Token ids carrying a PF2e token mark of this slug (the Devise a Stratagem effect marks its target; a lead effect may too). */
function markedIds(actor, slug) {
    const marks = actor?.synthetics?.tokenMarks;
    const out = [];
    if (!marks?.entries) return out;
    for (const [uuid, slugs] of marks.entries()) if ((Array.isArray(slugs) ? slugs : [slugs]).includes(slug)) out.push(String(uuid).split(".").pop());
    return out;
}
/** The subject of an active lead among the foes: a token mark, or a name in the effect's own name ("Effect: Pursue a Lead (Valeros)"). */
function leadSubjects(actor, foes) {
    const out = new Set();
    for (const id of markedIds(actor, "pursue-a-lead")) { const f = foes.find((x) => x.id === id); if (f) out.add(f); }
    for (const it of actor?.items ?? []) {
        if (it.type !== "effect" || !/pursue-a-lead|person-of-interest/.test(slugOf(it))) continue;
        const m = /\(([^)]+)\)/.exec(String(it.name ?? ""));
        const named = m ? foes.find((f) => nameOf(f).toLowerCase() === m[1].trim().toLowerCase()) : null;
        if (named) out.add(named);
        for (const id of [it.system?.context?.target?.token, it.flags?.pf2e?.target?.token].filter(Boolean)) { const f = foes.find((x) => String(id).endsWith(x.id)); if (f) out.add(f); }
    }
    return [...out];
}

function investigator(board, ctx, out) {
    const actor = board.me.actor;
    const me = board.me;
    const lv = level(board);
    const cls = actor?.class?.slug ?? (actor?.class?.name ?? "").toLowerCase();
    const archetype = !has(actor, "strategic-strike") && has(actor, "investigators-stratagem");
    // Devise a Stratagem: the class, or the archetype's Investigator's Stratagem; Investigator Dedication alone gives On the Case
    // (Pursue a Lead, Clue In), so it gets the notes and no stratagem plans
    const canDevise = cls === "investigator" || has(actor, "devise-a-stratagem") || archetype;
    if (!canDevise && !has(actor, "investigator-dedication")) return;
    const foes = targets(board);
    const n = (t) => { if (t) out.notes.push(t); };
    const int = abil(actor, "int"), str = abil(actor, "str"), dex = abil(actor, "dex");
    const dice = has(actor, "strategic-strike") ? strikeDice(lv) : 0;
    const prec = dice * 3.5;
    const useInt = !archetype; // Investigator's Stratagem (the archetype) substitutes the roll but keeps Strength or Dexterity
    const method = ["alchemical-sciences-methodology", "empiricism-methodology", "forensic-medicine-methodology", "interrogation-methodology"].find((m) => has(actor, m)) ?? null;
    const leadBonus = lv >= 9 && has(actor, "investigator-expertise") ? 2 : 1;
    const takedown = has(actor, "takedown-expert");
    const certain = has(actor, "certain-stratagem");
    const shared = has(actor, "shared-stratagem");
    const didactic = has(actor, "didactic-strike");
    const scalpel = has(actor, "scalpels-point");
    const bypass = has(actor, "strategic-bypass");
    const athletic = has(actor, "athletic-strategist");
    const pointed = has(actor, "pointed-question") || method === "interrogation-methodology";
    const sweat = has(actor, "make-em-sweat");
    const defensive = has(actor, "defensive-stratagem");
    const knownWeak = has(actor, "known-weaknesses");
    const planned = has(actor, "just-as-planned") && usesLeft(actor, "just-as-planned") !== 0;
    const poiLeft = has(actor, "person-of-interest") ? usesLeft(actor, "person-of-interest") : 0;
    const poiReady = has(actor, "person-of-interest") && poiLeft !== 0 && !effect(actor, /person-of-interest/);
    /** Does this Strike take the substituted roll (and Intelligence)? Agile or finesse in melee or thrown; any other ranged weapon;
     *  a one-handed club-group weapon with Takedown Expert. */
    const qualifies = (s) => {
        const t = s.traits ?? [];
        if (t.includes("agile") || t.includes("finesse")) return true;
        if (s.ranged && !s.thrown) return true;
        if (takedown && groupOf(s) === "club" && !twoHanded(s)) return true;
        return false;
    };
    /** The attack bonus with Intelligence in place of the Strike's own ability modifier, when that's better. */
    const devBonus = (s) => {
        if (!useInt) return s.bonus;
        const m = (s.action?.modifiers ?? []).find((x) => x.type === "ability" && x.enabled !== false);
        const own = m ? Number(m.modifier) || 0 : s.ranged ? dex : (s.traits ?? []).includes("finesse") ? Math.max(str, dex) : str;
        return s.bonus - own + Math.max(own, int);
    };
    const inRange = (s, at, f) => (s.ranged ? feetBetween(at, f.rect) <= (s.range ?? 30) * 2 : inReach(at, f.rect, s.reach || 5));
    const rangePen = (s, at, f) => (s.ranged && feetBetween(at, f.rect) > (s.range ?? 30) ? -2 : 0);
    const carry = board.strikes.filter(qualifies);
    const dont = board.strikes.filter((s) => !qualifies(s));

    // Ongoing Strategy (10): every Strike you didn't devise, with a weapon that could take the stratagem, deals flat precision equal to the dice count
    if (has(actor, "ongoing-strategy") && dice > 0) {
        for (const s of carry) if (!s.ongoingStrategy) { s.ongoingStrategy = true; s.avg += dice; }
        n(`Ongoing Strategy: +${dice} precision on every Strike you didn't devise${carry.length ? ` (${carry.map((s) => s.label).join(", ")})` : ""}; the plans count it.`);
    }
    if (dice > 0) n(`Strategic Strike: +${dice}d6 precision on the Strike you devised, with Intelligence (${signed(int)}) on the attack${carry.length ? `: ${carry.map((s) => s.label).join(", ")}` : ""}${dont.length ? `. ${dont.map((s) => s.label).join(", ")} ${dont.length === 1 ? "doesn't" : "don't"} qualify (not agile, finesse or ranged${takedown ? ", nor a one-handed club" : ""})` : ""}.`);
    else if (archetype) n("Investigator's Stratagem: the d20 you roll with Devise a Stratagem is your first attack roll against that foe, with your own Strength or Dexterity and no precision dice.");

    const leads = leadSubjects(actor, foes);
    const leadEffect = effect(actor, /pursue-a-lead/);
    if (leads.length) n(`Your lead: ${leads.map(nameOf).join(", ")}. Devise a Stratagem against it is a free action, and your +${leadBonus} investigation bonus applies to checks that bear on the case${has(actor, "detectives-readiness") ? " and to your saves against it (Detective's Readiness)" : ""}.`);
    else if (leadEffect) n(`You're pursuing a lead (+${leadBonus} to checks on the case). The helper can't tell which creature it concerns; if it's a foe here, Devise a Stratagem against it is a free action.`);

    const nearAllies = (f) => board.allies.filter((a) => a.canAct !== false && (a.hasMelee === false || inReach(a.rect, f.rect, a.reach ?? 5)));
    const allyAvg = (a) => a.reactiveStrike?.avg ?? 6;
    /** What a devised hit sets up for allies: Shared Stratagem (one ally, off-guard on its next attack) or Didactic Strike (up to ten, plus 2d6 each). */
    const riderWorth = (f) => {
        const near = nearAllies(f);
        if (!near.length) return 0;
        if (didactic) return near.slice(0, 10).reduce((t, a) => t + 0.2 * allyAvg(a) + 0.6 * 7, 0);
        if (shared) return Math.max(...near.map((a) => 0.2 * allyAvg(a)));
        return 0;
    };
    const resistCut = (f, s) => (bypass ? Math.min(int, Math.max(0, ...(f.iwr?.resist ?? []).filter((r) => (s.damageTypes ?? []).includes(r.type)).map((r) => Number(r.value) || 0))) : 0);
    /** The devised Strike's worth when the d20 shows r: the degree is known, the damage is the weapon's plus the dice. */
    const commitAt = (s, r, f, made, acAdj = 0, at = me.rect) => {
        const b = devBonus(s) + mapFor(made, s.agile) + rangePen(s, at, f);
        const d = degreeAt(r, b, f.ac + acAdj);
        // Ongoing Strategy's flat precision is on s.avg for the Strikes you didn't devise; the devised one takes the dice instead
        const dmg = s.avg - (s.ongoingStrategy ? dice : 0) + prec + resistCut(f, s);
        let v = d === 3 ? dmg * 2 + (s.deadly || 0) + (scalpel && pierceOrSlash(s) ? 5 : 0) : d === 2 ? dmg : certain && d === 1 ? (s.avg - (s.ongoingStrategy ? dice : 0)) / 2 : 0;
        if (d >= 2) v += riderWorth(f);
        return { v, d, b };
    };
    /** n ordinary Strikes at f after the devised one (Ongoing Strategy's flat precision is already on the Strikes). */
    const rest = (f, k, made, acAdj = 0, at = me.rect) => {
        const used = [];
        let ev = 0;
        for (let i = 0; i < k; i++) {
            let best = null;
            for (const s of board.strikes) {
                if (!inRange(s, at, f)) continue;
                const b = s.bonus + mapFor(made + used.length, s.agile) + rangePen(s, at, f);
                const e = strikeExpected(b, f.ac + acAdj, s.avg, { deadly: s.deadly });
                if (!best || e.expected > best.e.expected) best = { s, b, e };
            }
            if (!best) break;
            used.push(best); ev += best.e.expected;
        }
        return { used, ev, text: used.length ? `Strike ${nameOf(f)} with ${used[0].s.label}${times(used.length)} (${used.map((u) => signed(u.b)).join(", ")})` : "" };
    };
    /** Known Weaknesses: a Recall Knowledge inside the Devise; a critical success is +1 to your stratagem's attack and to every ally's next one. */
    const recall = () => {
        if (!knownWeak) return null;
        const skills = ["arcana", "nature", "occultism", "religion", "society", "crafting", "medicine"].map((k) => actor.skills?.[k]).filter((sk) => sk && (sk.rank ?? 0) >= 1).sort((a, b) => (b.mod ?? 0) - (a.mod ?? 0));
        const lores = Object.values(actor.skills ?? {}).filter((sk) => sk?.lore && (sk.rank ?? 0) >= 1);
        const sk = [...skills, ...lores].sort((a, b) => (b.mod ?? 0) - (a.mod ?? 0))[0];
        if (!sk) return null;
        const c = degreeChances(sk.mod ?? 0, 15 + lv);
        return { sk, p: c.cs, text: `Known Weaknesses: Recall Knowledge on it as part of the Devise (${sk.label ?? sk.slug} ${signed(sk.mod ?? 0)}, about ${pct(c.cs)} to critically succeed for +1 on your stratagem's attack and on every ally's next attack against it)` };
    };
    /** Pointed Question (1 action): Diplomacy against its Will DC; a success makes it off-guard to your devised Strike this turn. */
    const question = (f) => {
        if (!pointed) return null;
        const mod = actor.skills?.diplomacy?.mod;
        if (mod == null) return null;
        const c = degreeChances(Number(mod) || 0, 10 + (f.saves?.will ?? 8));
        return { p: c.s + c.cs, pCrit: c.cs, mod: Number(mod) || 0 };
    };
    /** Athletic Strategist: the roll on a Trip (Athletics with Intelligence) against its Reflex DC; prone, then the Strikes with it down. */
    const tripAt = (r, f, made, k, at) => {
        if (!athletic) return null;
        const ath = actor.skills?.athletics?.mod;
        if (ath == null || !inReach(at, f.rect, myReach(board))) return null;
        const b = (Number(ath) || 0) - str + Math.max(str, useInt ? int : str) + mapFor(made, false);
        const dc = 10 + (f.saves?.reflex ?? 8);
        const d = degreeAt(r, b, dc);
        const prone = worth(board, "prone");
        const after = rest(f, k, made + 1, d >= 2 ? -2 : 0, at);
        const v = (d === 3 ? prone + 3.5 : d === 2 ? prone : d === 0 ? -prone / 2 : 0) + after.ev;
        return { v, d, b, after, dc };
    };
    const push = (p) => out.plans.push({ kind: "class", dest: null, notes: [], ...p, score: p.ev + (p.bias ?? 0.4) });
    const weights = (twice) => Array.from({ length: 20 }, (_, i) => (twice ? (2 * (i + 1) - 1) / 400 : 0.05));
    /** The best use of each d20 result: commit to the Strike, ask a Pointed Question first, Trip with it, or do something else. */
    const table = (s, f, made, left, at, twice, fb) => {
        const w = weights(twice);
        const q = left >= 2 ? question(f) : null;
        const after1 = rest(f, left - 1, made + 1, 0, at);
        const after2 = left >= 2 ? rest(f, left - 2, made + 1, 0, at) : null;
        const rows = [];
        let ev = 0;
        for (let r = 1; r <= 20; r++) {
            const c = commitAt(s, r, f, made, 0, at);
            const opts = [{ k: "strike", v: c.v + after1.ev, d: c.d }];
            if (q) { const cq = commitAt(s, r, f, made, -2, at); opts.push({ k: "ask", v: q.p * (cq.v + (sweat ? worth(board, "frightened") : 0)) + (1 - q.p) * c.v + after2.ev, d: cq.d }); }
            const t = tripAt(r, f, made, left - 1, at);
            if (t) opts.push({ k: "trip", v: t.v, d: t.d });
            opts.push({ k: "else", v: fb.ev, d: null });
            const best = opts.reduce((a, b) => (b.v > a.v + 0.05 ? b : a));
            rows.push({ r, ...best });
            ev += w[r - 1] * best.v;
        }
        return { rows, ev, q, after1, after2, bonus: devBonus(s) + mapFor(made, s.agile) + rangePen(s, at, f) };
    };
    /** Rows grouped from 20 down into ranges of one choice. */
    const ranges = (rows) => {
        const out = [];
        for (let i = 19; i >= 0; i--) { const row = rows[i]; const last = out[out.length - 1]; if (last && last.k === row.k) last.lo = row.r; else out.push({ k: row.k, hi: row.r, lo: row.r }); }
        return out.reverse();
    };
    const span = (g) => (g.hi === g.lo ? `a ${g.hi}` : g.hi === 20 ? `a ${g.lo} or better` : g.lo === 1 ? `a ${g.hi} or lower` : `${g.lo} to ${g.hi}`);
    const fallbackFor = (f, left) => {
        const others = foes.filter((x) => x !== f);
        let best = { ev: 0, text: "" };
        const def = defensive ? ", or a defensive stratagem (+1 to AC and saves against it until your next turn)" : "";
        for (const o of others) { const r = rest(o, left, ctx.made); if (r.used.length && r.ev > best.ev) best = { ev: r.ev, text: `${r.text} instead${def}` }; }
        if (!best.text) best.text = `a skill stratagem (+1 to a skill check or Perception against it: Recall Knowledge, Demoralize)${def}, and spend the rest on Raise a Shield, Take Cover or a move`;
        return best;
    };
    const describe = (s, t, f, twice, fb) => {
        const steps = [];
        const notes = [];
        const gs = ranges(t.rows);
        const hitOn = Math.max(2, Math.min(20, f.ac - t.bonus)), critOn = f.ac + 10 - t.bonus;
        const strikeText = `Strike it with ${s.label} ${useInt ? "using Intelligence" : "on that roll"} (${signed(t.bonus)}; a ${hitOn} hits${critOn <= 20 ? `, a ${Math.max(2, critOn)} crits` : ""})${dice ? `, +${dice}d6 precision` : ""}${certain ? "; Certain Stratagem: half damage on a miss" : ""}`;
        // a choice can hold more than one range (a Pointed Question turns a 15 into a critical hit, a 17 crits anyway)
        const w = weights(twice);
        const mass = (list) => list.reduce((p, g) => { for (let r = g.lo; r <= g.hi; r++) p += w[r - 1]; return p; }, 0);
        const kinds = ["strike", "ask", "trip"].map((k) => ({ k, list: gs.filter((g) => g.k === k) })).filter((x) => x.list.length).map((x) => ({ ...x, p: mass(x.list), text: `On ${x.list.map(span).join(" or ")} (about ${pct(mass(x.list))})` }));
        const primary = kinds.slice().sort((a, b) => b.p - a.p)[0] ?? null;
        const lead = primary;
        const askText = (x, first) => `${x.text}: Pointed Question at ${nameOf(f)} ${first ? "first " : ""}(Diplomacy ${signed(t.q.mod)} against its Will DC, about ${pct(t.q.p)}; once an hour per creature, so not if you've asked it already): it's off-guard to your devised Strike${critOn - 2 <= 20 ? ` (a ${Math.max(2, critOn - 2)} crits then)` : ""}${sweat ? ", and frightened 1" : ""}`;
        const tripText = (x) => `${x.text}: Trip it with the roll instead (Athletics with Intelligence, Athletic Strategist), then Strike it prone`;
        if (primary?.k === "strike") { steps.push({ cost: 1, text: `${primary.text}: ${strikeText}` }); if (t.after1.used.length) steps.push({ cost: t.after1.used.length, text: t.after1.text }); }
        else if (primary?.k === "ask") { steps.push({ cost: 1, text: askText(primary, true) }); steps.push({ cost: 1, text: `Then ${strikeText}` }); if (t.after2?.used.length) steps.push({ cost: t.after2.used.length, text: t.after2.text }); }
        else if (primary?.k === "trip") { steps.push({ cost: 1, text: tripText(primary) }); if (t.after1.used.length) steps.push({ cost: t.after1.used.length, text: t.after1.text }); }
        for (const x of kinds) {
            if (x === primary) continue;
            if (x.k === "strike") notes.push(`${x.text}: ${strikeText}${t.after1.used.length ? `, then ${t.after1.text}` : ""}.`);
            if (x.k === "ask") notes.push(`${askText(x, true)}, then the Strike${t.after2?.used.length ? ` and ${t.after2.text.replace(/^Strike /, "")}` : ""}.`);
            if (x.k === "trip") notes.push(`${tripText(x)}.`);
        }
        const els = gs.filter((g) => g.k === "else");
        if (els.length) notes.push(`On ${els.map(span).join(" or ")} (about ${pct(mass(els))}): don't Strike it; ${fb.text}.`);
        if (shared && !didactic && nearAllies(f).length) notes.push("Shared Stratagem: when the devised Strike hits, name an ally; the foe is off-guard to that ally's next attack before your turn comes round.");
        if (didactic && nearAllies(f).length) notes.push("Didactic Strike: when the devised Strike hits, name up to ten allies; the foe is off-guard to each one's first attack, which deals +2d6 precision.");
        if (scalpel && pierceOrSlash(s)) notes.push("Scalpel's Point: a critical hit with the devised Strike adds 1d6 persistent bleed.");
        if (bypass && (f.iwr?.resist ?? []).length) notes.push(`Strategic Bypass: the devised hit ignores ${int} of each resistance that applies.`);
        if (has(actor, "strategic-assessment")) notes.push("Strategic Assessment: the first devised hit on a creature tells you its highest weakness, its highest resistance, its lowest save or an immunity.");
        return { steps, notes, lead };
    };

    /* ---- A stratagem already rolled this round: the effect's badge is the d20, its token mark the target ---- */
    const devised = effect(actor, /^effect-devise-a-stratagem$|^devise-a-stratagem$/);
    const rolled = devised ? Number(devised.system?.badge?.value) || null : null;
    const devisedIds = devised ? markedIds(actor, "devise-a-stratagem") : [];
    const devisedFoe = foes.find((f) => devisedIds.includes(f.id)) ?? null;
    if (canDevise && devised && rolled && devisedFoe && ctx.actions >= 1) {
        const f = devisedFoe;
        const fb = fallbackFor(f, ctx.actions);
        let best = null;
        for (const s of carry) {
            const sq = s.ranged ? null : squareToReach(board, f, s.reach || 5, ctx.actions - 1);
            if (!s.ranged && !sq) continue;
            if (s.ranged && !inRange(s, me.rect, f)) continue;
            const moveActs = sq?.route?.actions ?? 0;
            const at = moveActs ? { ...me.rect, x: sq.x, y: sq.y } : me.rect;
            const left = ctx.actions - moveActs;
            if (left < 1) continue;
            const t = table(s, f, ctx.made, left, at, false, fb);
            const row = t.rows[rolled - 1];
            if (!best || row.v > best.row.v) best = { s, t, row, sq, moveActs, at };
        }
        if (best) {
            const { s, t, row, sq, moveActs } = best;
            const steps = [];
            if (row.k === "else") steps.push({ cost: ctx.actions, text: `Your stratagem's d20 is a ${rolled}: too low to spend on ${nameOf(f)}. ${fb.text.charAt(0).toUpperCase()}${fb.text.slice(1)}` });
            else {
                if (moveActs) steps.push({ cost: moveActs, text: moveText(sq, f) });
                if (row.k === "ask") steps.push({ cost: 1, text: `Pointed Question at ${nameOf(f)} (Diplomacy ${signed(t.q.mod)} against its Will DC, about ${pct(t.q.p)}; once an hour per creature, so not if you've asked it already): off-guard to your devised Strike${sweat ? ", frightened 1" : ""}` });
                if (row.k === "trip") steps.push({ cost: 1, text: `Trip ${nameOf(f)} with the roll (Athletics with Intelligence): a ${rolled} ${row.d >= 2 ? "lands it prone" : "misses"}` });
                else steps.push({ cost: 1, text: `Strike ${nameOf(f)} with ${s.label}${useInt ? " using Intelligence" : ""} (${signed(t.bonus)}): the ${rolled} ${row.d === 3 ? "is a critical hit" : row.d === 2 ? "hits" : "misses"}${dice && row.d >= 2 ? `, +${dice}d6 precision` : ""}` });
                const after = row.k === "ask" ? t.after2 : t.after1;
                if (after?.used.length) steps.push({ cost: after.used.length, text: after.text });
            }
            push({ title: `Your stratagem on ${nameOf(f)}: the d20 shows ${rolled}`, target: f, ev: row.v, dest: moveActs && row.k !== "else" ? { x: sq.x, y: sq.y } : null, steps, notes: ["Devise a Stratagem is once per round; this is the roll you have."], bias: 0.5 });
        }
    } else if (devised && rolled && !devisedFoe) n(`Your stratagem's d20 is a ${rolled}, against a creature you can't target now; a Strike at it before your next turn would use that roll.`);

    /* ---- Devise a Stratagem, then decide: the plan is a table on the d20 ---- */
    if (canDevise && !devised && foes.length && carry.length) {
        for (const f of foes) {
            const free = leads.includes(f);
            const poi = !free && poiReady;
            const devCost = free ? 0 : 1;
            const spare = ctx.actions - devCost;
            if (spare < 1) continue;
            const fb = fallbackFor(f, spare);
            let best = null;
            for (const s of carry) {
                const sq = s.ranged ? null : squareToReach(board, f, s.reach || 5, spare - 1);
                if (!s.ranged && !sq) continue;
                if (s.ranged && !inRange(s, me.rect, f)) continue;
                const moveActs = sq?.route?.actions ?? 0;
                const at = moveActs ? { ...me.rect, x: sq.x, y: sq.y } : me.rect;
                const left = spare - moveActs;
                if (left < 1) continue;
                const t = table(s, f, ctx.made, left, at, planned, fb);
                if (!best || t.ev > best.t.ev) best = { s, t, sq, moveActs, at };
            }
            if (!best) continue;
            const { s, t, sq, moveActs } = best;
            const rk = recall();
            const d = describe(s, t, f, planned, fb);
            if (!d.lead) continue; // no roll is worth committing on: the advisor's own Strikes are the better turn
            const steps = [];
            steps.push({ cost: devCost, text: `${poi ? `Person of Interest on ${nameOf(f)}, then Devise a Stratagem against it for free` : `Devise a Stratagem against ${nameOf(f)}${free ? " (free: it's your lead)" : ""}`}: roll the d20 now${planned ? ", twice with Just as Planned, keeping the higher" : ""}${rk ? `. ${rk.text}` : ""}` });
            if (moveActs) steps.push({ cost: moveActs, text: moveText(sq, f) });
            steps.push(...d.steps);
            let ev = t.ev + (rk ? rk.p * (0.05 * (s.avg + prec) + nearAllies(f).reduce((a, x) => a + 0.1 * allyAvg(x), 0)) : 0) + (poi ? 0.5 : 0);
            const notes = [...d.notes];
            notes.unshift("You see the d20 before you choose: the attack stratagem binds you to that number on your first Strike against it this round; a skill stratagem means no Strike at it until your next turn.");
            if (poi) notes.push("Person of Interest lasts a minute: every Devise against it is free from here, so the turn costs the same as a plain Devise and the next ones cost less.");
            push({ title: `Devise a Stratagem against ${nameOf(f)}, then decide`, target: f, ev, dest: moveActs ? { x: sq.x, y: sq.y } : null, steps, notes, bias: 0.4 });
        }
    }

    /* ---- Methodology ---- */
    const res = actor?.system?.resources ?? {};
    const vials = res.versatileVials ?? res["versatile-vials"] ?? res.vials ?? null;
    if (method === "alchemical-sciences-methodology" || has(actor, "quick-tincture")) {
        const left = vials ? Number(vials.value) || 0 : null;
        n(`Quick Tincture (1 action, 1 versatile vial${left != null ? `; ${left} left` : ""}, a free hand): any elixir or tool you know the formula for, at your level or lower, good until the end of this turn, so drinking or throwing it is another action this turn${has(actor, "share-tincture") ? ". Share Tincture (1 action) keeps it until your next turn and lets you hand or throw it to an ally" : ""}.`);
    }
    if (method === "empiricism-methodology" || has(actor, "expeditious-inspection")) n(`Expeditious Inspection (free action, once per 10 minutes): a Recall Knowledge, Seek or Sense Motive that costs no action${has(actor, "empiricists-eye") ? ". Empiricist's Eye: a creature you Point Out is off-guard to your allies until your next turn, and your Point Out needs no voice" : ""}.`);
    if (method === "forensic-medicine-methodology") {
        const hurt = board.allies.filter((a) => a.hp != null && a.maxHp && a.hp < a.maxHp * 0.6 && feetBetween(me.rect, a.rect) <= 5);
        n(`Forensic Medicine: your Battle Medicine heals ${lv} more on a success, and the patient is immune for only an hour${hurt.length ? ` (${hurt.map((a) => `${nameOf(a)} ${a.hp}/${a.maxHp}`).join(", ")} next to you)` : ""}.`);
    }
    if (method === "interrogation-methodology" && !foes.length) n("Pointed Question (1 action): Diplomacy against a creature's Will DC; a success makes it off-guard to your devised Strike this turn, and you read its body language whatever it answers.");

    /* ---- Reactions and free actions: when they fire ---- */
    if (has(actor, "exploit-blunder")) n(devisedFoe || (devised && !devisedFoe) ? "Exploit Blunder fires when the creature you devised against last turn misses you with a Strike: a free Step." : "Exploit Blunder fires when a creature you devised against on your last turn misses you with a Strike: a free Step.");
    if (has(actor, "suspect-of-opportunity")) n(`Suspect of Opportunity fires when a creature outside your case attacks you: Person of Interest on it for free${poiLeft === 0 ? " (used up for now)" : ""}, so your Devise against it is free for a minute.`);
    if (has(actor, "foresee-danger")) { const pdc = Number(actor.perception?.dc?.value ?? actor.system?.perception?.dc?.value ?? actor.system?.attributes?.perception?.dc) || null; const ac = Number(actor.system?.attributes?.ac?.value ?? actor.attributes?.ac?.value) || null; n(`Foresee Danger fires when a foe you can see attacks you: the attack targets your Perception DC${pdc && ac ? ` (${pdc}) instead of your AC (${ac})${pdc > ac ? "" : "; it only pays when your AC is down"}` : " instead of your AC; worth it when your AC is down or you're off-guard"}.`); }
    if (has(actor, "clue-in")) n(`Clue In (reaction, once per 10 minutes) fires when an ally makes a check that bears on your case: they get your +${leadBonus}${has(actor, "clue-them-all-in") ? ", and every ally making the same check within a round (Clue Them All In)" : ""}.`);
    if (has(actor, "person-of-interest") && !poiReady && poiLeft === 0) n("Person of Interest is spent for the next 10 minutes.");
    if (has(actor, "defensive-stratagem") && !foes.length) n("Defensive Stratagem: after the Devise roll you may take +1 to AC and saves against the creature until your next turn instead of attacking it.");
    if (has(actor, "connect-the-dots") && ctx.actions >= 2 && board.allies.length && foes.length) n(`Connect the Dots (2 actions, Perception or Society against the higher of a foe's Deception and Will DC): an ally gets +${leadBonus} to their next Strike or check against it, to all of them until your next turn on a critical success.`);
    if (has(actor, "surgical-shock") && ctx.actions >= 1 && foes.some((f) => inReach(me.rect, f.rect, myReach(board)))) n("Surgical Shock (1 action, attack trait): Medicine against a foe's Fortitude DC in reach; clumsy 2 or stupefied 2 until the end of your next turn on a success, 3 on a critical success; a miss still gives +1 to your next attack action against it this turn.");
    if (has(actor, "just-as-planned") && !planned) n("Just as Planned is spent for the hour.");
    if (has(actor, "just-one-more-thing")) n("Just One More Thing (1 action, fortune): reroll a Make an Impression, Coerce or Request that failed without a critical failure; your investigation bonus doubles on it against someone tied to your case.");
    if (has(actor, "reason-rapidly") && ctx.actions >= 1) n("Reason Rapidly (1 action): up to five Recall Knowledge checks at once, without Known Weaknesses or other triggers on them.");
    if (takedown) n("Takedown Expert: any of your Strikes can be nonlethal without the -2, and a one-handed club-group weapon takes the stratagem.");
    if (has(actor, "strategic-repose")) n("Strategic Repose: the precision damage of a devised hit can be vitality instead, which undead take in full.");
    if (has(actor, "athletic-strategist") && !foes.some((f) => inReach(me.rect, f.rect, myReach(board)))) n("Athletic Strategist: the Devise roll can go on a Disarm, Grapple, Shove, Trip or Reposition instead of a Strike, with Intelligence for Strength.");
    if (has(actor, "thorough-research")) n("Thorough Research: a Recall Knowledge that succeeds tells you more; a critical success buys a follow-up question.");
    if (has(actor, "predictive-purchase-investigator") || has(actor, "predictive-purchase")) n(`Predictive Purchase: Prescient Planner pulls a common item you could have bought out of your pack as a ${has(actor, "implausible-purchase-investigator") || has(actor, "implausible-purchase") ? "single action, even after shopping, and five times a day it can be a consumable up to six levels below yours (Implausible Purchase)" : "2-action activity"}.`);
    else if (has(actor, "implausible-purchase-investigator") || has(actor, "implausible-purchase")) n("Implausible Purchase: Prescient Planner is one action, and five times a day pulls a common consumable up to six levels below yours.");
    if (has(actor, "everyones-a-suspect")) n("Everyone's a Suspect: anyone you've dealt with for a minute is a lead of yours without limit, so Devise a Stratagem against them is free.");
    if (lv >= 19 && has(actor, "master-detective")) n("Master Detective: in a new place the GM tells you a clue to your case exists and what kind, and when you've found it.");
    if (has(actor, "reconstruct-the-scene")) n("Reconstruct the Scene (exploration): a minute in a place tells you what happened there in the last day.");
    const exploration = [];
    if (has(actor, "thats-odd")) exploration.push("That's Odd points out one suspicious thing in each new room, and you may Pursue a Lead on it at once");
    if (has(actor, "solid-lead")) exploration.push("Solid Lead: one action returns you to the lead you set aside today");
    if (has(actor, "lie-detector")) exploration.push("Lie Detector: +1 to see through a lie, then +1 (or your investigation bonus +1) to your next social check against the liar within a minute");
    if (exploration.length) n(`Out of combat: ${exploration.join("; ")}.`);
}

export { investigator };
