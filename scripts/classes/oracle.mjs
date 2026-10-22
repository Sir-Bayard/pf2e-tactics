/**
 * PF2e Tactics: classes/oracle.mjs
 * See classes/_common.mjs for the shape of a class read.
 * The advisor plans every spell on the board; this read adds the oracle's layer: the mystery and its curse (what the
 * current cursebound stage costs, what the next one would), the cursebound feats as plans or notes with the stage they
 * raise the curse to, the revelation spells and Focus Points, slots and signature spells by the sorcerer's approach,
 * and the once-a-day and reaction features with the moment they fire.
 * Remaster text (Player Core 2): revelation spells are plain focus spells; only the cursebound feats (and a Diverse
 * Mystery spell) raise the curse. The sheet already carries every curse penalty (the system's rule elements), so the
 * read never applies a stage twice; it only folds the stage a plan would reach into that plan's own follow-ups.
 */
import { bestStrike, castable, focusLeft, has, level, pct, squareToReach, strikeRun, targets, worth, degreeChances, feetBetween, mapFor, strikeExpected, saveExpected, nameOf, signed } from "./_common.mjs";

const hasAny = (actor, ...slugs) => slugs.some((s) => has(actor, s));
const ordinal = (r) => `${r}${r === 1 ? "st" : r === 2 ? "nd" : r === 3 ? "rd" : "th"}`;
const dice = (n, d) => n * (d + 1) / 2;

/** Each mystery: its curse feature, the curse by stage (what each stage adds; a value curse scales with the number),
 *  the revelation spells (initial, advanced, greater) and the cursebound feat it grants. */
const MYSTERIES = {
    ancestors: { curse: "curse-of-ancestral-meddling", feat: "whispers-of-weakness", spells: ["Ancestral Touch", "Ancestral Defense", "Ancestral Form"],
        value: (n) => `clumsy ${n} (${signed(-n)} to AC, Reflex and Dexterity-based attacks and checks)` },
    ashes: { curse: "curse-of-creeping-ashes", feat: "whispers-of-weakness", spells: ["Ashen Wind", "Incendiary Ashes", "Ash Form"],
        stages: (lv) => ["weakness 2 to fire and your fire resistance is off", "-2 to ranged attack rolls", `fire weakness ${5 + lv}`, "-10 feet to your Speeds"] },
    battle: { curse: "curse-of-the-mortal-warrior", feat: "oracular-warning", spells: ["Weapon Trance", "Battlefield Persistence", "Revel in Retribution"],
        stages: (lv) => ["weakness 2 to damage from spells", "-1 to saves against spells", `weakness ${lv} to damage from spells`, "-2 to saves against spells"] },
    blight: { curse: "curse-of-inevitable-rot", feat: "whispers-of-weakness", spells: ["Ulcerous Canker", "Purging Toxins", "Accelerated Decomposition"],
        stages: (lv) => ["weakness 2 to acid and poison", "-1 to saves against disease and poison, and Treat Wounds on you at -1", `weakness ${2 * lv} to acid and poison`, "-2 to those saves and to Treat Wounds on you"] },
    bones: { curse: "curse-of-the-living-death", feat: "nudge-the-scales", spells: ["Soul Siphon", "Armor of Bones", "Claim Undead"],
        stages: (lv) => ["weakness 2 to vitality and void, and both hurt you", "-1 to Fortitude saves", `weakness ${5 + lv} to vitality and void`, "-2 to Fortitude saves"] },
    cosmos: { curse: "curse-of-the-sky-s-call", feat: "oracular-warning", spells: ["Spray of Stars", "Interstellar Void", "Moonlight Bridge"],
        value: (n) => `enfeebled ${n} (${signed(-n)} to melee attack and damage) and ${signed(-n)} against forced movement` },
    flames: { curse: "curse-of-engulfing-flames", feat: "foretell-harm", spells: ["Incendiary Aura", "Whirling Flames", "Flaming Fusillade"],
        value: (n) => `${n} persistent fire on you each round, your fire resistance off` },
    life: { curse: "curse-of-outpouring-life", feat: "nudge-the-scales", spells: ["Life Link", "Delay Affliction", "Life-Giving Form"],
        value: (n, lv) => `magical healing on you is ${Math.max(1, lv) * n} lower` },
    lore: { curse: "curse-of-torrential-knowledge", feat: "whispers-of-weakness", spells: ["Brain Drain", "Access Lore", "Dread Secret"],
        value: (n) => `${signed(-n)} to Perception and Will saves${n >= 4 ? ", stupefied 1 and you can't speak" : ""}` },
    tempest: { curse: "curse-of-inclement-headwinds", feat: "foretell-harm", spells: ["Tempest Touch", "Thunderburst", "Tempest Form"],
        stages: (lv) => ["weakness 2 to electricity and you count as wearing metal", "-2 to ranged attack rolls", `electricity weakness ${5 + lv}`, "-10 feet to your Speeds"] },
    time: { curse: "curse-of-turbulent-moments", feat: "trance-of-celerity", spells: ["Temporal Distortion", "Time Skip", "Manifold Lives"],
        value: (n) => `${signed(-n)} AC against reactions and free actions (a Reactive Strike on you) and ${signed(-n)} against slowed and fatigued` },
};
/** When a revelation or domain spell with no damage number pays, by name. */
const WHEN = {
    "Ancestral Defense": "a reaction before a Will save: roll it twice",
    "Ancestral Form": "2 actions, a minute, sustained: invisible, resistance 10 to most damage, a fly Speed, but no casting; for getting out or holding a line",
    "Ashen Wind": "2 actions, 10-foot burst at 120 feet, Fortitude: sickened 1 on a failure, 2 on a critical failure, no damage; for two or more foes in the burst",
    "Ash Form": "2 actions, a minute: fast healing 3, resistance 10 to piercing and slashing, no precision damage; when melee has you",
    "Weapon Trance": "1 action, a minute: your martial weapons use your simple-weapon proficiency; cast it before the first Strike with one",
    "Battlefield Persistence": "a reaction before a save: +2, and an incapacitation effect treats you as two levels higher",
    "Revel in Retribution": "1 action, a minute: Reactive Strike plus an extra reaction for it every turn, 5 temporary HP a hit; when foes will move past or cast next to you",
    "Purging Toxins": "2 actions on a poisoned or diseased ally: a counteract check, and it takes poison equal to the rank",
    "Armor of Bones": "1 action, a minute: resistance to cold, electricity, fire, piercing and slashing; cast it before the foes reach you",
    "Claim Undead": "2 actions, one undead within 30 feet, Will, incapacitation: it fights for you on a failure; a lower-level undead only",
    "Interstellar Void": "2 actions, 30 feet, basic Fortitude, sustained: cold damage now and each Sustain, and the foe is fatigued; on the foe that will take the longest to kill",
    "Moonlight Bridge": "2 actions, 10 minutes: a bridge only you and your allies can cross; for a gap or a line foes shouldn't cross",
    "Incendiary Aura": "2 actions, a minute, 10-foot emanation: anything in it that takes fire damage catches fire; cast it before your fire spells, with foes near you",
    "Flaming Fusillade": "2 actions, a minute: Ignition becomes 1 action (and at 9th rank gets +rank damage); then Ignition three times a turn",
    "Life Link": "1 action, 30 feet, a minute: a small heal, then the first hit on the ally each round is reduced and you take it instead; on the front-liner, while you're safe",
    "Delay Affliction": "2 actions, 30 feet: a heal and one affliction suspended for an hour; on an ally with a poison or disease on them",
    "Life-Giving Form": "2 actions, a minute: an Interact touch heals a rank's worth of d8s, never you; when two or more allies are hurt and near you",
    "Access Lore": "1 action, a minute: one Lore skill at your spellcasting rank; out of combat, mostly",
    "Dread Secret": "2 actions, up to 6 foes at 60 feet, Will: a resistance you know of is off, or a weakness is triggered, and they're frightened on a failure; only with a resistance or weakness you've learned",
    "Time Skip": "1 action, 30 feet: an ally is quickened next turn (Step, Stride or Strike); on your best striker",
    "Tempest Form": "2 actions, a minute, sustained: amorphous, resistance 10 to physical, a fly or swim Speed, no casting; for escape or holding a chokepoint",
    "Temporal Distortion": "1 action, 30 feet, Will: clumsy, enfeebled or stupefied 1 (the die decides), 4 rounds on a failure; cheap on a foe that will stay in the fight",
};

/** The cursebound value from the character's own sheet (the board's conditions, or the condition item). */
function cursebound(board) {
    const me = board.me;
    if (me.conditions?.has?.("cursebound")) return Number(me.conditionValues?.cursebound) || 1;
    const item = me.actor?.items?.find?.((i) => i.type === "condition" && (i.slug ?? i.system?.slug) === "cursebound");
    return item ? Number(item.system?.value?.value ?? item.value ?? 1) || 1 : 0;
}
const curseMax = (actor) => (has(actor, "extreme-curse") ? 4 : has(actor, "major-curse") ? 3 : 2);
/** What stage n adds (a staged curse) or what the curse is at value n (a value curse). */
function stageText(m, n, lv) {
    if (!m) return "";
    if (m.value) return m.value(n, lv);
    return m.stages(lv)[n - 1] ?? "";
}
/** The whole curse at value n, in one clause. */
function curseText(m, n, lv) {
    if (!m || n <= 0) return "";
    if (m.value) return m.value(n, lv);
    return m.stages(lv).slice(0, n).join(", ");
}

const isFocus = (sp) => !!(sp.traits?.includes("focus") || /focus|revelation|domain/i.test(sp.entry ?? ""));
const isSlot = (sp) => !sp.cantrip && !isFocus(sp) && !sp.consumable;
const isSignature = (sp) => !!(sp.signature ?? sp.spell?.system?.location?.signature);
/** Spell slots left by rank from the actor's spontaneous entries: [{ rank, left, max }]. */
function slotsLeft(actor) {
    const out = new Map();
    const entries = actor?.spellcasting?.regular ?? actor?.spellcasting?.contents ?? actor?.spellcasting ?? [];
    for (const e of Array.isArray(entries) ? entries : []) {
        if (e.isFocusPool || e.isRitual || e.isInnate || e.system?.prepared?.value === "focus" || e.system?.prepared?.value === "innate") continue;
        const slots = e.system?.slots ?? {};
        for (let r = 1; r <= 10; r++) {
            const s = slots[`slot${r}`];
            if (!s || !(Number(s.max) > 0)) continue;
            const cur = out.get(r) ?? { rank: r, left: 0, max: 0 };
            cur.left += Math.max(0, Number(s.value) || 0); cur.max += Number(s.max) || 0;
            out.set(r, cur);
        }
    }
    return [...out.values()].sort((a, b) => a.rank - b.rank);
}
/** What a spell is expected to do to t at the given average (single target; an area counts its main target). */
function spellExpected(sp, t, avg, made) {
    if (sp.attack !== null && sp.attack !== undefined) return strikeExpected(sp.attack + mapFor(made, false), t.ac, avg);
    if (sp.save?.stat) { const e = saveExpected(t.saves?.[sp.save.stat] ?? 0, sp.dc ?? 15, avg, { basic: sp.save.basic }); return { hit: e.hit ?? e.fail ?? 0.5, expected: e.expected }; }
    return null;
}
const avgAtRank = (sp, r) => (sp.avg ?? 0) * (r / Math.max(1, sp.rank));
const spellDC = (board) => Math.max(0, ...(board.spells ?? []).map((s) => Number(s.dc) || 0)) || Number(board.me.actor?.classDC?.value) || 10 + level(board) + 5;
const spellAttack = (board) => Math.max(0, ...(board.spells ?? []).map((s) => Number(s.attack) || 0)) || spellDC(board) - 10;
const usesLeft = (actor, slug) => { const it = actor?.items?.find?.((i) => (i.slug ?? i.system?.slug) === slug); const f = it?.system?.frequency; return f && f.max ? (Number(f.value) ?? f.max) : null; };
const hurtOf = (c) => Math.max(0, (c.maxHp ?? 0) - (c.hp ?? 0));
const within = (me, c, ft) => feetBetween(me.rect, c.rect) <= ft;

function oracle(board, ctx, out) {
    const actor = board.me.actor;
    const me = board.me;
    const lv = level(board);
    const mSlug = Object.keys(MYSTERIES).find((k) => has(actor, k) || has(actor, MYSTERIES[k].curse)) ?? null;
    const m = mSlug ? MYSTERIES[mSlug] : null;
    const cb = cursebound(board);
    const cbMax = curseMax(actor);
    const atMax = cb >= cbMax;
    const foes = targets(board);
    const live = foes.filter((f) => f.hp > 0);
    const spells = castable(board);
    const dc = spellDC(board);
    const allies = (board.allies ?? []).filter((a) => a.hp > 0);
    const rangedCurseNext = m && !m.value && cb + 1 === 2 && ["ashes", "tempest"].includes(mSlug); // the next stage costs ranged attacks -2

    // --- The curse: where it stands, what the next stage costs ------------------------------------------------------
    const nextText = !atMax && m ? `${stageText(m, cb + 1, lv)}` : "";
    if (m) {
        if (cb <= 0) out.notes.push(`You aren't cursebound. Your first cursebound ability makes you cursebound 1: ${stageText(m, 1, lv)}. Your curse can reach ${cbMax} (${cbMax === 4 ? "Extreme Curse" : cbMax === 3 ? "Major Curse" : "until Major Curse at 11th"}); only a Refocus lowers it, by 1.`);
        else if (atMax) out.notes.push(`Cursebound ${cb}, your limit: ${curseText(m, cb, lv)}. No cursebound ability until you Refocus (10 minutes, -1 to the curse and a Focus Point back).${has(actor, "blaze-of-revelation") && cb >= 4 ? " Blaze of Revelation is open: see below." : ""}`);
        else out.notes.push(`Cursebound ${cb} of ${cbMax}: ${curseText(m, cb, lv)}. The next cursebound ability raises it to ${cb + 1}: ${nextText}.`);
    } else if (has(actor, "oracular-curse")) {
        out.notes.push(`Cursebound ${cb} of ${cbMax}; your mystery's curse isn't one this read knows, so check its stage on the sheet.`);
    }
    const raise = (n = 1) => (atMax ? "" : `raises your curse to ${Math.min(cbMax, cb + n)}${m ? `: ${stageText(m, Math.min(cbMax, cb + n), lv)}` : ""}`);
    const forestall = has(actor, "forestall-curse") && (usesLeft(actor, "forestall-curse") ?? 1) > 0;

    // --- Cursebound feats the read plans: each shows the stage it reaches ---------------------------------------------
    // Whispers of Weakness (1 action, 60 feet): +2 status to your next attack roll this turn, and its weaknesses and lowest save.
    if (has(actor, "whispers-of-weakness") && !atMax && ctx.actions >= 2 && live.length) {
        let best = null;
        for (const f of live) {
            if (!within(me, f, 60)) continue;
            const left = ctx.actions - 1;
            // A Strike with the +2, then the rest at the usual penalty
            for (const melee of [true, false]) {
                const sq = melee ? squareToReach(board, f, Math.max(5, ...board.strikes.filter((s) => !s.ranged).map((s) => s.reach || 5)), left - 1) : { route: { actions: 0 } };
                if (!sq) continue;
                const n = left - sq.route.actions;
                if (n < 1) continue;
                const first = bestStrike(board, f, { made: ctx.made, melee, acAdj: -2 });
                if (!first) continue;
                const rest = n > 1 ? strikeRun(board, f, n - 1, { made: ctx.made + 1, melee, acAdj: rangedCurseNext && !melee ? 2 : 0 }) : { used: [], ev: 0, text: "" };
                const ev = first.e.expected + rest.ev + 1;
                if (!best || ev > best.ev) best = { f, ev, sq, first, rest, melee, kind: "strike" };
            }
            // Or a spell attack with the +2
            for (const sp of spells.filter((s) => s.attack !== null && s.attack !== undefined && s.avg > 0 && s.cost && s.cost <= left)) {
                const e = strikeExpected(sp.attack + 2 + mapFor(ctx.made, false), f.ac, sp.avg);
                const ev = e.expected + 1;
                if (!best || ev > best.ev) best = { f, ev, sp, e, kind: "spell" };
            }
        }
        if (best) {
            const { f } = best;
            const steps = [{ cost: 1, text: `Whispers of Weakness on ${nameOf(f)}: you learn its weaknesses and its lowest save, and your next attack roll on it this turn is at +2` }];
            if (best.kind === "strike") {
                if (best.sq.route.actions) steps.push({ cost: best.sq.route.actions, text: `${best.sq.route.via ?? "Stride"} into reach of ${nameOf(f)}` });
                steps.push({ cost: 1, text: `Strike ${nameOf(f)} with ${best.first.s.label} (${signed(best.first.bonus + 2)}, about ${pct(best.first.e.hit)})` });
                if (best.rest.used.length) steps.push({ cost: best.rest.used.length, text: best.rest.text });
            } else {
                steps.push({ cost: best.sp.cost, text: `Cast ${best.sp.name} at ${nameOf(f)} (${signed(best.sp.attack + 2 + mapFor(ctx.made, false))}, about ${pct(best.e.hit)})` });
            }
            const notes = [`Whispers of Weakness ${raise()}.${forestall ? " Forestall Curse (1 action, once a day) first would hold the curse where it is." : ""}`];
            if (rangedCurseNext && best.kind === "strike" && !best.melee) notes.push("At cursebound 2 your ranged attacks after the first are at -2; the plan counts it.");
            out.plans.push({ kind: "class", title: `Whispers of Weakness, then ${best.kind === "strike" ? "Strike" : best.sp.name} ${nameOf(f)}`, target: f, ev: best.ev, score: best.ev + 0.3, dest: best.kind === "strike" && best.sq.route.actions ? { x: best.sq.x, y: best.sq.y } : null, steps, notes });
        }
    }

    // Nudge the Scales (1 action, 30 feet): 2 x (level + 1) HP to one creature, living or undead.
    if (has(actor, "nudge-the-scales") && !atMax && ctx.actions >= 1) {
        const heal = 2 * (lv + 1);
        const cands = [...allies.map((a) => ({ c: a, self: false })), { c: me, self: true }].filter(({ c }) => hurtOf(c) > 0 && within(me, c, 30));
        let best = null;
        for (const { c, self } of cands) {
            const penalty = self && mSlug === "life" ? Math.max(1, lv) * (cb + 1) : 0;
            const got = Math.min(Math.max(0, heal - penalty), hurtOf(c));
            const ev = 0.8 * got;
            if (ev > 0 && (!best || ev > best.ev)) best = { c, self, got, ev };
        }
        if (best && best.got >= heal / 2) {
            const who = best.self ? "yourself" : nameOf(best.c);
            out.plans.push({ kind: "class", title: `Nudge the Scales on ${who}`, target: null, ev: best.ev, score: best.ev + 0.2, dest: null,
                steps: [{ cost: 1, text: `Nudge the Scales: ${who} ${best.self ? "regain" : "regains"} ${best.got} HP${best.self && mSlug === "life" ? ` (${heal} less your curse's ${heal - best.got})` : ""}` }],
                notes: [`Nudge the Scales ${raise()}. It heals undead too.`] });
        }
    }

    // Debilitating Dichotomy (2 actions, 30 feet): you and one foe each take 3d6 per two levels past 2 mental, basic Will; it's stunned 1 on a critical failure.
    if (has(actor, "debilitating-dichotomy") && !atMax && ctx.actions >= 2 && live.length) {
        const avg = dice(3 * Math.floor((lv - 2) / 2), 6);
        let best = null;
        for (const f of live.filter((f) => within(me, f, 30))) {
            const e = saveExpected(f.saves?.will ?? 0, dc, avg, { basic: true });
            const ev = e.expected + e.critFail * worth(board, "stunned", 0.6) - 0.15 * avg; // your own save is one degree better: a success is a critical success
            if (!best || ev > best.ev) best = { f, e, ev };
        }
        if (best) out.plans.push({ kind: "class", title: `Debilitating Dichotomy on ${nameOf(best.f)}`, target: best.f, ev: best.ev, score: best.ev + 0.3, dest: null,
            steps: [{ cost: 2, text: `Debilitating Dichotomy: ${nameOf(best.f)} takes ${Math.round(avg)} mental, basic Will (fails about ${pct(best.e.fail)}), stunned 1 on a critical failure; you take the same with your save one degree better` }],
            notes: [`Debilitating Dichotomy ${raise()}. Your own save counts a success as a critical success, so you usually take nothing or half.`] });
    }

    // On Borrowed Time (2 actions, 30 feet): 3d6 persistent mental (4d6 at cursebound 2, 5d6 at 3), basic Will; an extra round passes for it each turn.
    if (has(actor, "on-borrowed-time") && !atMax && ctx.actions >= 2 && live.length) {
        const n = cb >= 3 ? 5 : cb >= 2 ? 4 : 3;
        const avg = dice(n, 6);
        let best = null;
        for (const f of live.filter((f) => within(me, f, 30))) {
            const e = saveExpected(f.saves?.will ?? 0, dc, avg * 2, { basic: true }); // about two rounds of persistent damage
            const ev = e.expected + 1;
            if (!best || ev > best.ev) best = { f, e, ev };
        }
        if (best) out.plans.push({ kind: "class", title: `On Borrowed Time on ${nameOf(best.f)}`, target: best.f, ev: best.ev, score: best.ev + 0.3, dest: null,
            steps: [{ cost: 2, text: `On Borrowed Time: ${nameOf(best.f)} takes ${n}d6 persistent mental, basic Will (fails about ${pct(best.e.fail)}), and an extra round passes for it each turn (its buffs, afflictions and other persistent damage tick twice)` }],
            notes: [`On Borrowed Time ${raise()}.${n < 5 ? ` The die count climbs with your curse (4d6 at cursebound 2, 5d6 at 3).` : ""} Best on the foe with the longest fight left or a persistent effect already on it.`] });
    }

    // The Dead Walk (2 actions): two ghostly warriors (three at cursebound 2, four at 3) within 30 feet each Strike an adjacent foe at your spell attack, 4d6 spirit; they flank.
    if (has(actor, "the-dead-walk") && !atMax && ctx.actions >= 2 && live.length) {
        const n = cb >= 3 ? 4 : cb >= 2 ? 3 : 2;
        const atk = spellAttack(board);
        const near = live.filter((f) => within(me, f, 30)).sort((a, b) => a.ac - b.ac);
        if (near.length) {
            // Two warriors on the softest foe flank each other; more spread to the next foes, each pair flanking
            let ev = 0; const hits = [];
            for (let i = 0; i < n; i++) {
                const f = near[Math.min(near.length - 1, Math.floor(i / 2))];
                const e = strikeExpected(atk, f.ac - 2, dice(4, 6));
                ev += e.expected; hits.push({ f, e });
            }
            const named = [...new Set(hits.map((h) => nameOf(h.f)))].join(" and ");
            out.plans.push({ kind: "class", title: `The Dead Walk against ${named}`, target: near[0], ev, score: ev + 0.3, dest: null,
                steps: [{ cost: 2, text: `The Dead Walk: ${n} ghostly warriors appear next to ${named} and each Strike (${signed(atk)} against a flanked foe, about ${pct(hits[0].e.hit)}, 4d6 spirit)` }],
                notes: [`The Dead Walk ${raise()}.${n < 4 ? ` More warriors with a deeper curse (three at cursebound 2, four at 3).` : ""} The warriors stay until your next turn and flank with you and your allies, so ${named} ${hits.length > 1 && named.includes(" and ") ? "are" : "is"} off-guard to your allies' Strikes this round.`] });
        }
    }

    // Trial by Skyfire (1 action): a 10-foot emanation on you, 2d6 fire basic Reflex to everything in it at the end of each of your turns for a minute (4d6 and 15 feet from cursebound 3).
    if (has(actor, "trial-by-skyfire") && !atMax && ctx.actions >= 1 && live.length) {
        const big = cb + 1 >= 3;
        const r = big ? 15 : 10, avg = dice(big ? 4 : 2, 6);
        const inFoes = live.filter((f) => within(me, f, r));
        const inAllies = allies.filter((a) => within(me, a, r));
        if (inFoes.length) {
            const rounds = 3;
            const gain = inFoes.reduce((t, f) => t + saveExpected(f.saves?.reflex ?? 0, dc, avg, { basic: true }).expected, 0) * rounds;
            const cost = (inAllies.length + 1) * avg * 0.5 * rounds * 0.8;
            const ev = gain - cost;
            if (ev > 2) out.plans.push({ kind: "class", title: `Trial by Skyfire`, target: inFoes[0], ev, score: ev + 0.2, dest: null,
                steps: [{ cost: 1, text: `Trial by Skyfire: ${big ? 4 : 2}d6 fire, basic Reflex, on everything within ${r} feet of you at the end of each of your turns for a minute (${inFoes.map(nameOf).join(", ")} now${inAllies.length ? `, and ${inAllies.map(nameOf).join(", ")} with them` : ""})` }],
                notes: [`Trial by Skyfire ${raise()}. You can't step out of it; a Sustain action skips one round of it. It counts about ${rounds} rounds, and the foes staying in it.`] });
        }
    }

    // Waters of Creation (2 actions): a 15-foot emanation heals every creature in it, foes too; d8s instead of d6s at cursebound 3.
    if (has(actor, "waters-of-creation") && !atMax && ctx.actions >= 2) {
        const d8 = cb + 1 >= 3;
        const heal = dice(Math.floor(lv / 2), d8 ? 8 : 6);
        const selfPenalty = mSlug === "life" ? Math.max(1, lv) * (cb + 1) : 0;
        const group = [...allies.filter((a) => within(me, a, 15)).map((a) => Math.min(heal, hurtOf(a))), Math.min(Math.max(0, heal - selfPenalty), hurtOf(me))];
        const healed = group.reduce((t, x) => t + x, 0);
        const foeHeal = live.filter((f) => within(me, f, 15)).reduce((t, f) => t + Math.min(heal, hurtOf(f)), 0);
        const ev = 0.8 * (healed - foeHeal);
        if (ev > 0 && healed >= heal) out.plans.push({ kind: "class", title: `Waters of Creation`, target: null, ev, score: ev + 0.2, dest: null,
            steps: [{ cost: 2, text: `Waters of Creation: ${Math.floor(lv / 2)}d${d8 ? 8 : 6} (about ${Math.round(heal)}) HP to every creature within 15 feet of you, about ${Math.round(healed)} to your side${foeHeal ? ` and ${Math.round(foeHeal)} to the foes in it` : ""}` }],
            notes: [`Waters of Creation ${raise()}.${d8 ? "" : " At cursebound 3 it rolls d8s."} It heals foes in the ring too; step away from them first if you can.`] });
    }

    // --- Cursebound feats the advisor reads itself, or that fire out of turn: a note with the stage ------------------
    if (has(actor, "foretell-harm") && !atMax) {
        const best = spells.filter((s) => isSlot(s) && s.avg > 0).sort((a, b) => b.rank - a.rank)[0];
        out.notes.push(`Foretell Harm (free, once a round, right after a slot spell that dealt damage): the target takes twice the rank more at the start of its next turn${best ? ` (${2 * best.rank} after ${best.name})` : ""}; it ${raise()}. Not worth a stage on a foe about to drop.`);
    }
    if (has(actor, "trance-of-celerity") && !atMax) out.notes.push(`Trance of Celerity (1 action, a minute): +5 feet to your Speeds, +10 at cursebound 2, +15 at 3, +20 at 4; it ${raise()}. Only when the fight is about reaching something.`);
    if (has(actor, "meddling-futures") && !atMax) out.notes.push(`Meddling Futures (free): a d4 picks your next action and sweetens it (a Strike at +1 and +2 damage, a spell at +rank damage or healing, a skill check at +1, a Stride at +10 feet; ${cb + 1 >= 3 ? "cursebound 3 makes those +6, +rank+3, +2 and +20" : "more at cursebound 3"}); a different action needs a DC 6 flat check; it ${raise()}. Use it before a spell you'd cast anyway.`);
    if (has(actor, "thousand-visions") && !atMax && board.enemies.some((e) => e.state !== "observed" || e.conditions?.has?.("concealed"))) out.notes.push(`Thousand Visions (free, a minute): within 30 feet no flat check against concealment, hidden foes don't make you off-guard and a hidden one needs only DC 5; beyond 30 feet everything is imprecise. It ${raise()}; worth it with ${board.enemies.filter((e) => e.state !== "observed").map(nameOf).join(", ") || "a concealed foe"} to pin down.`);
    if (has(actor, "knowledge-of-shapes") && !atMax) out.notes.push(`Knowledge of Shapes (free): Reach Spell or Widen Spell for no action before a spell; it ${raise()}. A stage for +30 feet of range or a wider area pays only when it adds a foe to the area or a target you couldn't reach.`);
    if (has(actor, "roll-the-bones-of-fate") && !atMax) {
        const left = usesLeft(actor, "roll-the-bones-of-fate");
        out.notes.push(`Roll the Bones of Fate (1 action, once in 10 minutes${left === 0 ? ", used" : ""}): a d4; 1 gives you or an ally the better of two rolls on the next attack or check, 2 makes a foe (Will) take the worse of two, 3 both, 4 everyone within 30 feet rolls twice and the die decides which they take. It ${raise()}; a gamble, best on a turn with an action to spare.`);
    }
    if (has(actor, "oracular-warning")) out.notes.push(`Oracular Warning (free, as initiative is rolled): allies within 20 feet get +2 to initiative (+3 at cursebound 2, +4 at 3) and ${Math.floor(lv / 2)} temporary HP; it raises your curse before the fight starts.`);
    if (has(actor, "conduit-of-void-and-vitality") && !atMax) {
        const hh = spells.filter((s) => /^(heal|harm)$/i.test(s.name) && isSlot(s));
        if (hh.length) out.notes.push(`Conduit of Void and Vitality (2 actions, a slot): a 3-action ${hh.map((s) => s.name).join(" or ")} that gives one creature ${cb + 1}d8 more (1d8 per cursebound value after the raise); it ${raise()}. It needs the spell as a signature spell.`);
    }
    if (has(actor, "mystery-conduit") && !atMax) out.notes.push(`Mystery Conduit (free): the next spell of 5th rank or lower with no duration costs no slot; it ${raise()}. Spend the stage on a 5th-rank signature spell rather than a cantrip's worth.`);

    // Diverse Mystery: a borrowed revelation spell with the cursebound trait and the other mystery's first stage on top
    if (has(actor, "diverse-mystery")) {
        const borrowed = spells.filter((s) => isFocus(s) && s.traits?.includes("cursebound"));
        const other = Object.entries(MYSTERIES).find(([k, v]) => k !== mSlug && borrowed.some((b) => v.spells.includes(b.name)));
        if (borrowed.length) out.notes.push(`${borrowed.map((s) => s.name).join(", ")} is your Diverse Mystery spell: it ${atMax ? "can't be cast at your curse's limit" : raise()}${other ? `, and you also take the ${other[0]} curse's first stage (${stageText(other[1], 1, lv)})` : ""}.${forestall ? " Forestall Curse skips both." : ""}`);
    }

    // --- Revelation spells and Focus Points -------------------------------------------------------------------------
    const fp = focusLeft(actor);
    const fmax = Number(actor?.system?.resources?.focus?.max) || 0;
    const focus = spells.filter((s) => isFocus(s) && !s.cantrip);
    if (fp !== null) {
        if (fp <= 0) out.notes.push(`No Focus Points left: your revelation spells are out until you Refocus (10 minutes${has(actor, "revelation-s-focus") || has(actor, "revelations-focus") ? ", and Revelation's Focus refills the whole pool" : ""}, and a Refocus also lowers your curse by 1).`);
        else {
            // The best revelation spell this turn: by expected damage where there's a number, else the first one with a moment
            let pick = null;
            for (const sp of focus.filter((s) => s.cost && s.cost <= ctx.actions)) {
                if (sp.avg > 0 && !sp.heals) {
                    for (const f of live) {
                        if (sp.range !== null && sp.range !== undefined && sp.range > 0 && !within(me, f, sp.range)) continue;
                        if (sp.range === 0 && !(sp.area?.size >= 5 && within(me, f, sp.area.size))) continue;
                        const e = spellExpected(sp, f, sp.avg, ctx.made);
                        if (!e) continue;
                        const n = sp.area ? live.filter((g) => within(f, g, sp.area.size)).length : 1;
                        const ev = e.expected * Math.max(1, Math.min(n, 3));
                        if (!pick || ev > pick.ev) pick = { sp, f, ev, e, n };
                    }
                } else if (sp.heals && sp.avg > 0) {
                    const hurt = [...allies, me].filter((c) => hurtOf(c) > 0 && (sp.range === 0 || within(me, c, sp.range || 30)) && !(c === me && /life-giving/i.test(sp.name)));
                    if (hurt.length) { const ev = 0.8 * Math.min(sp.avg, Math.max(...hurt.map(hurtOf))); if (!pick || ev > pick.ev) pick = { sp, ev, heal: true, who: hurt.sort((a, b) => hurtOf(b) - hurtOf(a))[0] }; }
                }
            }
            const names = focus.map((s) => s.name);
            const cbNote = (sp) => (sp.traits?.includes("cursebound") ? ` It ${atMax ? "can't be cast at your limit" : raise()}.` : " No curse cost.");
            if (pick && !pick.heal) out.notes.push(`Revelation this turn: ${pick.sp.name} (${pick.sp.cost} action${pick.sp.cost > 1 ? "s" : ""}, 1 of ${fp} Focus Point${fp > 1 ? "s" : ""}) at ${nameOf(pick.f)} does about ${Math.round(pick.e.expected)}${pick.n > 1 ? ` to each of ${pick.n} foes` : ""}${WHEN[pick.sp.name] ? `; ${WHEN[pick.sp.name].replace(/^[^:]+: /, "")}` : ""}.${cbNote(pick.sp)}`);
            else if (pick) out.notes.push(`Revelation this turn: ${pick.sp.name} (1 of ${fp} Focus Point${fp > 1 ? "s" : ""}) on ${pick.who === me ? "yourself" : nameOf(pick.who)}, about ${Math.round(Math.min(pick.sp.avg, hurtOf(pick.who)))} HP${mSlug === "life" && pick.who === me ? `, less your curse's ${Math.max(1, lv) * Math.max(1, cb)}` : ""}.${cbNote(pick.sp)}`);
            else if (names.length) out.notes.push(`Focus Points: ${fp} of ${fmax} for ${names.join(", ")}; no damage number this turn. ${names.filter((n) => WHEN[n]).map((n) => `${n}: ${WHEN[n]}`).join(". ")}${names.some((n) => WHEN[n]) ? "." : ""}`);
            else out.notes.push(`Focus Points: ${fp} of ${fmax}.`);
            const others = focus.filter((s) => s !== pick?.sp && WHEN[s.name]);
            if (pick && others.length) out.notes.push(`Also in the pool: ${others.map((s) => `${s.name} (${WHEN[s.name]})`).join("; ")}.`);
            const domain = focus.filter((s) => m && !m.spells.includes(s.name) && !s.traits?.includes("cursebound"));
            if (domain.length && hasAny(actor, "domain-acumen", "domain-fluency", "paradoxical-mystery")) out.notes.push(`${domain.map((s) => s.name).join(", ")} ${domain.length > 1 ? "are domain spells" : "is a domain spell"} cast as a revelation: same pool, no curse.`);
            if (hasAny(actor, "revelation-s-focus", "revelations-focus") && fp < fmax) out.notes.push("Revelation's Focus: a Refocus refills the whole pool, so spend the points.");
        }
    }
    if (has(actor, "blaze-of-revelation")) {
        if (cb >= 4) out.notes.push("Blaze of Revelation (free, you're cursebound 4): for a minute one revelation spell a turn costs no Focus Point; at the end you save or you're drained 2 (success) or 4 (failure) until tomorrow, and a critical failure kills you. For the fight that decides the day only.");
        else if (cbMax >= 4) out.notes.push(`Blaze of Revelation needs cursebound 4 (you're at ${cb}): a free revelation spell every turn for a minute, then a save that can leave you drained or dead.`);
    }

    // --- Slots by rank, and the top rank with a slot left (the sorcerer's approach) ----------------------------------
    const slots = slotsLeft(actor);
    const topRank = slots.filter((s) => s.left > 0).map((s) => s.rank).pop() ?? Math.max(0, ...spells.filter(isSlot).map((s) => s.rank));
    if (slots.length) {
        const txt = slots.map((s) => `${ordinal(s.rank)} ${s.left}/${s.max}`).join(", ");
        const empty = slots.filter((s) => s.left === 0).map((s) => ordinal(s.rank));
        const effusion = has(actor, "divine-effusion") ? usesLeft(actor, "divine-effusion") : null;
        out.notes.push(`Slots left: ${txt}.${empty.length && has(actor, "divine-effusion") && effusion !== 0 ? ` Divine Effusion (twice a day, two different ranks${effusion ? `, ${effusion} left` : ""}) still casts from an empty rank (${empty.join(", ")}).` : ""}${has(actor, "gifted-power") ? ` Gifted Power: one more ${ordinal(topRank || 1)} slot for a mystery spell only.` : ""}`);
    }

    // Cantrip or slot: against the foe where a slot pays most, say what it buys over the best cantrip
    if (live.length) {
        let pick = null;
        for (const f of live) {
            let cantrip = null, slot = null;
            for (const sp of spells) {
                if (!(sp.avg > 0) || sp.heals || !sp.cost || sp.cost > ctx.actions) continue;
                const e = spellExpected(sp, f, sp.avg, ctx.made);
                if (!e) continue;
                const x = { sp, e };
                if (sp.cantrip) { if (!cantrip || e.expected > cantrip.e.expected) cantrip = x; }
                else if (isSlot(sp)) { if (!slot || e.expected > slot.e.expected) slot = x; }
            }
            if (!slot) continue;
            const gain = slot.e.expected - (cantrip?.e.expected ?? 0);
            if (!pick || gain > pick.gain) pick = { f, cantrip, slot, gain };
        }
        if (pick) {
            const { f, cantrip, slot, gain } = pick;
            const finishes = f.hp > 0 && f.hp <= slot.e.expected && (!cantrip || f.hp > cantrip.e.expected);
            const bar = 3 + slot.sp.rank;
            const spend = finishes || gain >= bar;
            const cText = cantrip ? `${cantrip.sp.name} does about ${Math.round(cantrip.e.expected)}` : "you have no damaging cantrip for it";
            out.notes.push(spend
                ? `Spend a slot on ${nameOf(f)}: ${slot.sp.name} (rank ${slot.sp.rank}) does about ${Math.round(slot.e.expected)}${finishes ? `, enough to finish it at ${f.hp} HP` : ` against ${cantrip ? `${cantrip.sp.name}'s about ${Math.round(cantrip.e.expected)}` : "no damaging cantrip"}`}.${has(actor, "foretell-harm") && !atMax ? ` Foretell Harm after it adds ${2 * slot.sp.rank} next turn for a curse stage.` : ""}`
                : `Keep the slot against ${nameOf(f)}: ${cText}; ${slot.sp.name} (rank ${slot.sp.rank}) adds only about ${Math.round(Math.max(0, gain))}. A slot earns its place when it adds ${bar} or more, or finishes the foe.`);
        }
    }

    // Signature spells: heighten freely, so a lower slot often does the job. Say so when a visible foe is low enough.
    const sigs = spells.filter((sp) => isSlot(sp) && isSignature(sp));
    if (sigs.length) {
        let said = false;
        const lowRanks = slots.filter((s) => s.left > 0).map((s) => s.rank);
        for (const sp of sigs.filter((s) => s.avg > 0 && !s.heals)) {
            for (const f of live) {
                const top = spellExpected(sp, f, sp.avg, ctx.made);
                if (!top || top.expected < f.hp) continue;
                const base = Number(sp.spell?.baseRank ?? sp.spell?.system?.level?.value ?? sp.baseRank ?? 1) || 1;
                for (const r of lowRanks.filter((r) => r >= base && r < sp.rank)) {
                    const e = spellExpected(sp, f, avgAtRank(sp, r), ctx.made);
                    if (e && e.expected >= f.hp) {
                        out.notes.push(`${sp.name} is a signature spell: cast it from a ${ordinal(r)} slot at ${nameOf(f)} (about ${Math.round(e.expected)}, it has ${f.hp} HP) and keep the ${ordinal(sp.rank)}.`);
                        said = true; break;
                    }
                }
                if (said) break;
            }
            if (said) break;
        }
        if (!said) out.notes.push(`Signature spells (${sigs.map((s) => s.name).join(", ")}) cast from any rank you have a slot for: a top slot (${ordinal(topRank)}) for a save against the biggest foe or an area with two or more in it, a lower one to finish a hurt foe.`);
    } else if (topRank >= 2 && slots.length) {
        out.notes.push(`Your ${ordinal(topRank)} slots are for a save against the biggest foe or an area with two or more in it; a lower slot finishes a hurt foe.`);
    }
    if (lv >= 19 && has(actor, "oracular-clarity")) {
        const tenth = slots.find((s) => s.rank === 10);
        out.notes.push(`10th-rank slot${has(actor, "oracular-providence") ? "s" : ""}: ${tenth ? `${tenth.left} of ${tenth.max} left` : has(actor, "oracular-providence") ? "two a day" : "one a day"}, for the two 10th-rank spells only; Mystery Conduit and Divine Effusion don't touch them.`);
    }

    // --- Spellshapes and the rest that fires on a condition ---------------------------------------------------------
    if (has(actor, "surging-might")) {
        const resists = live.filter((f) => (f.iwr?.resist ?? []).some((r) => ["spirit", "vitality", "void"].includes(r.type)));
        const have = spells.some((s) => s.avg > 0 && (s.damageTypes ?? []).some((d) => ["spirit", "vitality", "void"].includes(d)));
        if (have && resists.length) out.notes.push(`Surging Might (1 action) before a spirit, vitality or void spell: it ignores ${lv} of ${resists.map(nameOf).join(", ")}'s resistance to it.`);
    }
    if (has(actor, "portentous-spell")) out.notes.push("Portentous Spell (1 action) before a spell: a reaction against the casting (a Reactive Strike, a counter) rolls at -2, and foes you hit or that fail are fascinated with you until your next turn; when you're casting in reach of a foe.");
    if (has(actor, "divine-aegis")) out.notes.push("Divine Aegis (reaction) fires before you roll a save against a magical effect: +1 against anything but divine magic, -1 against divine; skip it against a cleric or a celestial.");
    if (has(actor, "forestall-curse")) out.notes.push(`Forestall Curse (1 action, once a day${forestall ? "" : ", used"}): the next cursebound ability doesn't raise your curse. ${forestall ? `Best spent on the ability that would reach ${Math.min(cbMax, cb + 1)}${m && !atMax ? ` (${stageText(m, cb + 1, lv)})` : ""}, or on the one you'd otherwise be too close to the limit for.` : ""}`.trim());
    if (has(actor, "scapegoat-parallel-self")) out.notes.push(`Scapegoat Parallel Self (reaction, once a day${(usesLeft(actor, "scapegoat-parallel-self") ?? 1) > 0 ? "" : ", used"}) fires as your turn starts or your curse would advance: set your curse to any stage. Let a cursebound ability push you to the limit, then drop back to 1.`);
    if (has(actor, "epiphany-at-the-crossroads") && me.conditions?.has?.("dying")) out.notes.push(`Epiphany at the Crossroads (free, once a day) fires as your turn begins while you're dying: you stop dying, regain ${2 * lv} HP and can Stand, with an Augury's worth of vision.`);
    if (has(actor, "lighter-than-air") && cb >= 1) out.notes.push(`Lighter than Air: while cursebound you fly (Fly instead of Stride${cb >= 3 ? ", +10 feet to it" : ""}), so difficult ground and a drop don't hold you.`);
    else if (has(actor, "water-walker") && cb >= 1) out.notes.push(`Water Walker: while cursebound you ${cb >= 2 ? "walk on water" : "can Stride across water, ending on something solid"}.`);
    if (mSlug === "flames" && cb >= 1) out.notes.push(`Your curse burns you for ${cb} fire a round; a Refocus puts it out. A foe's fire spell finds no resistance on you.`);
    if (mSlug === "life" && cb >= 1) out.notes.push(`Healing on you is ${Math.max(1, lv) * cb} short while cursebound ${cb}: let the healer spend on someone else, or take the heal before the next cursebound ability.`);
    if (mSlug === "time" && cb >= 1 && board.enemies.some((e) => e.reactions?.some?.((r) => r.trigger?.onMove))) out.notes.push(`A Reactive Strike on you hits at +${cb} while cursebound ${cb}: don't provoke this turn if you can help it.`);
    if (mSlug === "lore" && cb >= 1) out.notes.push(`Will saves at ${signed(-cb)} while cursebound ${cb}; a mental or fear effect on you is the thing to fear this round.`);
}

export { oracle };
