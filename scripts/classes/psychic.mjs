/**
 * PF2e Tactics: classes/psychic.mjs
 * See classes/_common.mjs for the shape of a class read.
 * The advisor plans every spell on the board; this read adds the psychic's layer: Unleash Psyche (when it's up the
 * damaging spells get +2 per rank here, so the advisor's spell plans see the real number; when it's not, when to use
 * it), the psi cantrips and their amps (an amped cantrip costs a Focus Point: planned when the gain over the plain
 * cantrip pays, else the plain one stays with the advisor), Strain Mind as the amp without a point, the alternate amps
 * from feats, the psyche actions while unleashed (the subconscious mind's own, Psi Burst, Violent Unleash, Psi
 * Catastrophe, Emotional Surge...), Focus Points, slots left by rank and the cantrip-or-slot rule, signature spells,
 * Counter Thought and the other reactions, and "when" notes for the rest.
 * Plans here: the amped psi cantrip turns, Brain Drain, Restore the Mind, Psi Burst and Violent Unleash as steps.
 */
import { bestStrike, castable, effect, focusLeft, has, level, pct, targets, worth, degreeChances, feetBetween, inReach, mapFor, strikeExpected, saveExpected, nameOf, signed } from "./_common.mjs";

const lc = (s) => String(s ?? "").toLowerCase().trim();
const slugOf = (i) => i?.slug ?? i?.system?.slug ?? lc(i?.name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** Foundry's sluggify drops apostrophes (dark-personas-presence); the catalog keeps a dash (dark-persona-s-presence). Both are read. */
const hasAny = (actor, ...slugs) => slugs.some((s) => has(actor, s));
const item = (actor, ...slugs) => actor?.items?.find?.((i) => ["feat", "action"].includes(i.type) && slugs.includes(slugOf(i))) ?? null;
/** Uses left today of a feat with a frequency, or null when the sheet doesn't count them. */
function usesLeft(actor, ...slugs) { const f = item(actor, ...slugs)?.system?.frequency; return f && typeof f.value === "number" ? f.value : null; }
const ordinal = (r) => `${r}${r === 1 ? "st" : r === 2 ? "nd" : r === 3 ? "rd" : "th"}`;
const points = (n) => `${n} Focus Point${n === 1 ? "" : "s"}`;
const spellSlug = (sp) => sp.spell?.slug ?? sp.spell?.system?.slug ?? lc(sp.name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const flatCheck = (dc) => Math.max(0, Math.min(1, (21 - dc) / 20));

/** The six conscious minds: the two standard psi cantrips, the three unique ones (surface 1, deeper 6, deepest 10), the granted spells. */
const MINDS = {
    "the-distant-grasp": { name: "Distant Grasp", standard: ["telekinetic-hand", "telekinetic-projectile"], unique: ["telekinetic-rend", "vector-screen", "dancing-blade"], granted: "Kinetic Ram, Telekinetic Maneuver, Gravity Well, Fly, Telekinetic Haul, Poltergeist's Fury, Telekinetic Bombardment, Falling Sky, Implosion" },
    "the-infinite-eye": { name: "Infinite Eye", standard: ["detect-magic", "guidance"], unique: ["glimpse-weakness", "omnidirectional-scan", "foresee-the-path"], granted: "Sure Strike, Augury, Locate, Clairvoyance, Scouting Eye, Truesight, True Target, Unrelenting Observation, Foresight" },
    "the-oscillating-wave": { name: "Oscillating Wave", standard: ["frostbite", "ignition"], unique: ["thermal-stasis", "entropic-wheel", "redistribute-potential"], granted: "Breathe Fire, Blazing Bolt, Fireball, Ice Storm, Howling Blizzard, Frozen Fog, Volcanic Eruption, Arctic Rift, Falling Stars" },
    "the-silent-whisper": { name: "Silent Whisper", standard: ["daze", "message"], unique: ["forbidden-thought", "shatter-mind", "contagious-idea"], granted: "Mindlink, Stupefy, Heroism, Telepathy, Synaptic Pulse, Sending, Visions of Danger, Uncontrollable Dance, Telepathic Demand" },
    "the-tangible-dream": { name: "Tangible Dream", standard: ["figment", "shield"], unique: ["imaginary-weapon", "astral-rain", "hologram-cage"], granted: "Dizzying Colors, Invisibility, Sea of Thought, Containment, Etheric Shards, Scintillating Safeguard, Project Image, Confusing Colors, Resplendent Mansion" },
    "the-unbound-step": { name: "Unbound Step", standard: ["phase-bolt", "warp-step"], unique: ["distortion-lens", "ghostly-shift", "tesseract-tunnel"], granted: "Thoughtful Gift, Enlarge, Rally Point, Translocate, Strange Geometry, Collective Transposition, Momentary Recovery, Quandary, Bilocation" },
};
const ALL_PSI = new Set(Object.values(MINDS).flatMap((m) => [...m.standard, ...m.unique]));
/** The four subconscious minds and the psyche action each grants (usable only while the psyche is unleashed). */
const SUBMINDS = {
    "emotional-acceptance": { name: "Emotional Acceptance", action: "Restore the Mind", slug: "restore-the-mind" },
    "gathered-lore": { name: "Gathered Lore", action: "Recall the Teachings", slug: "recall-the-teachings" },
    "precise-discipline": { name: "Precise Discipline", action: "Calculate Threats", slug: "calculate-threats" },
    "wandering-reverie": { name: "Wandering Reverie", action: "Fade Into Daydreams", slug: "fade-into-daydreams" },
};

/**
 * The psi cantrips whose amp changes the numbers: plain and amped damage at rank r (Remaster text of the conscious
 * minds), how the spell lands (attack, or a save), its range, and what the amp adds beyond damage.
 * d: average per die. k2: the "+1 per 2 ranks" step count.
 */
const k2 = (r) => 1 + Math.floor((r - 1) / 2);
const AMPS = {
    ignition: { cost: 2, range: 60, attack: true, plain: (r, melee) => (melee ? 3.5 : 2.5) * (r + 1), amped: (r, melee) => (melee ? 6.5 : 5.5) * r + r, rider: "1 fire splash per rank around it, d12s in melee reach", riderWorth: () => 0 },
    frostbite: { cost: 2, range: 120, save: "fortitude", plain: (r) => 2.5 * (r + 1), amped: (r) => 2.5 * (2 * r + 1), rider: "temporary HP equal to half the damage it takes", riderWorth: (r, e) => 0.5 * e.expected / 2 },
    daze: { cost: 2, range: 120, save: "will", plain: (r) => 3.5 * k2(r), amped: (r) => 5.5 * (2 * k2(r) - 1), rider: "on a failed save weakness to mental and -1 to Will until the end of its next turn", riderWorth: (r, e) => 1.5 * e.fail },
    "telekinetic-projectile": { cost: 2, range: 60, attack: true, plain: (r) => 3.5 * (r + 1), amped: (r) => 7 * r, rider: "a hit pushes it 5 feet (10 on a critical hit)", riderWorth: (r, e) => 1 * e.hit },
    "phase-bolt": { cost: 2, range: 60, attack: true, acAdj: -2, plain: (r) => 2.5 * (r + 2), amped: (r) => 2.5 * (2 * r + 1), rider: "it's off-guard against the bolt and the bolt ignores resistance to piercing equal to half the rank", riderWorth: () => 0 },
    "imaginary-weapon": { cost: 2, range: 5, attack: true, twoTargets: true, plain: (r) => 3.5 * (r + 1), amped: (r) => 7 * r, rider: "a second weapon at a second foe in reach, both rolls at the same multiple attack penalty", riderWorth: () => 0 },
    "telekinetic-rend": { cost: 2, range: 60, save: "fortitude", bursts: 2, ampBursts: 3, plain: (r) => 3.5 * k2(r), amped: (r) => 7 * k2(r), rider: "a third burst, and a critical failure is stunned 1", riderWorth: (r, e) => worthOf.stunned * e.critFail },
    "shatter-mind": { cost: 2, range: 15, ampRange: 30, save: "will", cone: true, base: 3, plain: (r) => 2.5 * Math.max(3, r), amped: (r) => 5.5 * Math.max(3, r), rider: "a 30-foot cone, and a failed save is stupefied 1 until your next turn", riderWorth: (r, e) => worthOf.stupefied * e.fail },
    "redistribute-potential": { cost: 2, range: 60, save: "fortitude", near: 5, ampNear: 15, base: 5, plain: (r) => 2.5 * Math.max(4, r - 1), amped: (r) => 3.5 * Math.max(6, 2 * r - 4), rider: "two 10-foot bursts instead of two squares, and clumsy 1 or enfeebled 1 for a minute on a failed save", riderWorth: (r, e) => worthOf.clumsy * e.fail },
    "forbidden-thought": { cost: 2, range: 30, save: "will", conditional: 0.7, plain: (r) => 3.5 * (r + 1), amped: (r) => 3.5 * (r + 1), rider: "a failed save is also stunned 1", riderWorth: (r, e) => worthOf.stunned * e.fail },
};
const worthOf = { stunned: 5, stupefied: 1.5, clumsy: 1.5 };

/** Spell slots left by rank from the actor's spontaneous entries: [{ rank, left, max }]. Empty when nothing is visible. */
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
function spellExpected(board, sp, t, avg, made) {
    const lv = level(board);
    if (sp.attack !== null && sp.attack !== undefined) { const e = strikeExpected(sp.attack + mapFor(made, false), t.ac, avg); return { hit: e.hit, fail: e.hit, critFail: e.crit, expected: e.expected }; }
    if (sp.save?.stat) { const e = saveExpected(t.saves?.[sp.save.stat] ?? lv + 5, sp.dc ?? 10 + lv + 4, avg, { basic: sp.save.basic }); return { hit: e.fail, fail: e.fail, critFail: e.critFail, expected: e.expected }; }
    return null;
}
const isSlot = (sp) => !sp.cantrip && !sp.focus && !sp.traits?.includes("focus") && !sp.consumable;
const isSignature = (sp) => !!(sp.signature ?? sp.spell?.system?.location?.signature);

/** The Unleash Psyche effect on the sheet, still running. */
function unleashUp(actor) {
    const e = effect(actor, /unleash-psyche|psyche-unleashed|unleashed-psyche/);
    if (!e || /psi-strikes/.test(slugOf(e))) return null;
    const rd = e.remainingDuration;
    if (rd && (rd.expired || (Number.isFinite(Number(rd.remaining)) && Number(rd.remaining) <= 0))) return null;
    return e;
}

function psychic(board, ctx, out) {
    const actor = board.me.actor;
    const me = board.me;
    const lv = level(board);
    const rank = Math.max(1, Math.ceil(lv / 2));
    const foes = targets(board);
    const spells = castable(board);
    const mindSlug = Object.keys(MINDS).find((k) => has(actor, k)) ?? null;
    const mind = mindSlug ? MINDS[mindSlug] : null;
    const subSlug = Object.keys(SUBMINDS).find((k) => has(actor, k)) ?? null;
    const sub = subSlug ? SUBMINDS[subSlug] : null;
    const fullPsychic = has(actor, "psi-cantrips-and-amps") || lc(actor?.class?.slug) === "psychic";
    const fp = focusLeft(actor);
    const fmax = Number(actor?.system?.resources?.focus?.max) || 0;
    const cv = me.conditionValues ?? {};
    const stupefied = Number(cv.stupefied) || (me.conditions?.has?.("stupefied") ? 1 : 0);
    const castOk = stupefied ? flatCheck(5 + stupefied) : 1;
    const unleash = unleashUp(actor);
    const unleashed = !!unleash;
    const rem = Number(unleash?.remainingDuration?.remaining);
    const justUnleashed = unleashed && Number.isFinite(rem) && rem >= 12;
    const dc = spells.map((s) => s.dc).find((d) => Number.isFinite(d)) ?? Number(actor?.classDC?.value) ?? 10 + lv + 4;
    const spellAtk = spells.map((s) => s.attack).find((a) => Number.isFinite(a)) ?? dc - 10;
    const plans = [];

    // Which cantrips on the board are psi cantrips: the mind's standard two, the unique ones (psychic trait), and any
    // of another mind's with Parallel Breakthrough (or a dedication's pick, which comes with the mind feature).
    const psi = spells.filter((sp) => sp.cantrip && (sp.traits?.includes("psychic") || (ALL_PSI.has(spellSlug(sp)) && (mind ? [...mind.standard, ...mind.unique].includes(spellSlug(sp)) || has(actor, "parallel-breakthrough") : true))));
    const psiSlugs = new Set(psi.map(spellSlug));

    // Unleash Psyche up: +2 per rank status damage on every damaging spell cast with your psychic spellcasting (the
    // sheet's formula doesn't carry it, so the board's averages get it here, once, and the advisor's spell plans see it).
    if (unleashed) {
        for (const sp of spells) {
            if (sp._unleash || !(sp.avg > 0) || sp.heals || sp.consumable) continue;
            if (sp.focus && !sp.cantrip && !psiSlugs.has(spellSlug(sp))) continue; // an archetype's focus spell isn't psychic spellcasting
            sp._unleash = 2 * sp.rank;
            sp.avg += sp._unleash;
            if (sp.twoAction) sp.twoAction.avg += sp._unleash;
        }
    }

    // --- Psi cantrips and amps: plan the amp when it pays ---------------------------------------------------------
    const bar = (r, finishes) => (finishes ? 1 : (fp >= 2 ? 2 + r : 4 + r) - (unleashed ? 2 : 0));
    let ampPick = null;
    const ampCandidates = [];
    for (const sp of psi) {
        const m = AMPS[spellSlug(sp)];
        if (!m || !sp.cost || sp.cost > ctx.actions || !foes.length) continue;
        const r = sp.rank || rank;
        const un = sp._unleash ?? 0;
        for (const f of foes) {
            if (!(f.hp > 0)) continue;
            const dist = feetBetween(me.rect, f.rect);
            const melee = dist <= 5;
            const rangeOk = dist <= (m.ampRange ?? m.range) || (m.twoTargets && inReach(me.rect, f.rect, 5));
            if (!rangeOk) continue;
            const plainOk = dist <= m.range;
            const probe = { ...sp, save: m.save ? { stat: m.save, basic: true } : null, attack: m.attack ? sp.attack ?? spellAtk : null, dc: sp.dc ?? dc };
            const pe = plainOk ? spellExpected(board, probe, f, m.plain(r, melee) + un, ctx.made) : { expected: 0, hit: 0, fail: 0, critFail: 0 };
            const ae = spellExpected(board, probe, { ...f, ac: f.ac + (m.acAdj ?? 0) }, m.amped(r, melee) + un, ctx.made);
            if (!ae) continue;
            let plainEv = pe.expected * (m.conditional ?? 1);
            let ampEv = (ae.expected + m.riderWorth(r, ae)) * (m.conditional ?? 1);
            const others = [];
            // Areas: a second foe (a third burst with the amp), a cone or the bigger bursts catch what stands near
            if (m.bursts) {
                const more = foes.filter((o) => o !== f && o.hp > 0 && feetBetween(me.rect, o.rect) <= m.range).map((o) => ({ o, pe: spellExpected(board, probe, o, m.plain(r) + un, ctx.made), ae: spellExpected(board, probe, o, m.amped(r) + un, ctx.made) })).sort((a, b) => b.ae.expected - a.ae.expected);
                more.slice(0, m.bursts - 1).forEach((x) => { plainEv += x.pe.expected; });
                more.slice(0, m.ampBursts - 1).forEach((x) => { ampEv += x.ae.expected; others.push(x.o); });
            } else if (m.cone) {
                const near = foes.filter((o) => o !== f && o.hp > 0 && feetBetween(me.rect, o.rect) <= m.ampRange && feetBetween(f.rect, o.rect) <= 15);
                for (const o of near) { const d = feetBetween(me.rect, o.rect); if (d <= m.range) plainEv += spellExpected(board, probe, o, m.plain(r) + un, ctx.made).expected; ampEv += spellExpected(board, probe, o, m.amped(r) + un, ctx.made).expected; others.push(o); }
            } else if (m.near) {
                const near = foes.filter((o) => o !== f && o.hp > 0 && feetBetween(me.rect, o.rect) <= m.range && feetBetween(f.rect, o.rect) <= m.ampNear);
                for (const o of near) { if (feetBetween(f.rect, o.rect) <= m.near) plainEv += spellExpected(board, probe, o, m.plain(r) + un, ctx.made).expected; ampEv += spellExpected(board, probe, o, m.amped(r) + un, ctx.made).expected; others.push(o); }
            } else if (m.twoTargets) {
                const second = foes.filter((o) => o !== f && o.hp > 0 && inReach(me.rect, o.rect, 5)).map((o) => ({ o, e: spellExpected(board, probe, o, m.amped(r) + un, ctx.made) })).sort((a, b) => b.e.expected - a.e.expected)[0];
                if (second) { ampEv += second.e.expected; others.push(second.o); }
            }
            const finishes = f.hp <= ae.expected && f.hp > pe.expected;
            ampCandidates.push({ sp, m, f, r, pe, ae, plainEv, ampEv, gain: ampEv - plainEv, finishes, others, melee });
        }
    }
    ampCandidates.sort((a, b) => b.ampEv - a.ampEv);
    ampPick = ampCandidates[0] ?? null;

    // Alternate amps with numbers of their own (Target of Psychic Ire, Shatter Space): the better of them and the native amp
    const altAmp = (c) => {
        const alts = [];
        if (hasAny(actor, "target-of-psychic-ire") && c.m.cost >= 2) {
            const per = 2.5 * c.r;
            const e = saveExpected(c.f.saves?.reflex ?? lv + 5, c.sp.dc ?? dc, per, { basic: true });
            alts.push({ name: "Target of Psychic Ire", ev: c.pe.expected * (c.m.conditional ?? 1) + Math.min(Math.max(0, c.f.hp - c.pe.expected), 3 * e.expected), text: `${Math.round(per)} bludgeoning (basic save) at the start of each of its turns for 3 rounds` });
        }
        if (hasAny(actor, "shatter-space") && c.m.cost >= 2) {
            const adj = foes.filter((o) => o.hp > 0 && feetBetween(c.f.rect, o.rect) <= 20);
            const per = 3.5 * c.r;
            const ev = adj.reduce((t, o) => t + saveExpected(o.saves?.reflex ?? lv + 5, c.sp.dc ?? dc, per, { basic: true }).expected, 0);
            if (adj.length >= 2) alts.push({ name: "Shatter Space", ev: c.pe.expected * (c.m.conditional ?? 1) + ev, text: `a torn-space aura around ${nameOf(c.f)}: ${Math.round(per)} slashing (basic save) to each creature that starts its turn in it or enters it, ${adj.map(nameOf).join(", ")} are in it now` });
        }
        return alts.sort((a, b) => b.ev - a.ev)[0] ?? null;
    };

    const fpAvailable = fp === null ? 0 : fp;
    const strainOk = fpAvailable <= 0 && hasAny(actor, "strain-mind") && usesLeft(actor, "strain-mind") !== 0;
    if (ampPick) {
        const c = ampPick;
        const alt = altAmp(c);
        const useAlt = alt && alt.ev > c.ampEv;
        const ampEv = useAlt ? alt.ev : c.ampEv;
        const gain = ampEv - c.plainEv;
        const strainCost = 4 * c.r;
        const canPay = fpAvailable > 0 || (strainOk && me.hp - strainCost >= me.maxHp * 0.5);
        const b = bar(c.r, c.finishes);
        const tgt = `${nameOf(c.f)}${c.others.length ? ` and ${c.others.map(nameOf).join(", ")}` : ""}`;
        if (canPay && gain >= b && ctx.actions >= c.m.cost) {
            const steps = [{ cost: 0, text: fpAvailable > 0 ? `Amp ${c.sp.name} (1 Focus Point, ${fpAvailable - 1} left after)` : `Strain Mind: amp ${c.sp.name} for ${strainCost} HP instead of a Focus Point (once an hour)` }];
            const how = useAlt ? `${alt.name}: ${alt.text}` : c.m.rider;
            steps.push({ cost: c.m.cost, text: `Cast amped ${c.sp.name} at ${tgt} (about ${Math.round(ampEv * castOk)}; ${how})` });
            const notes = [`The plain cantrip does about ${Math.round(c.plainEv * castOk)}; the amp adds about ${Math.round(gain * castOk)}${c.finishes ? ` and can finish ${nameOf(c.f)} at ${c.f.hp} HP` : ""}.`];
            if (unleashed) notes.push(`Your psyche is unleashed: +${2 * c.r} damage rides on it already.`);
            if (c.m.twoTargets && !c.others.length) notes.push("Only one foe is in reach, so the second weapon has no target; the amp still doubles the dice.");
            if (c.melee && spellSlug(c.sp) === "ignition") notes.push("In reach, so the flame is a melee spell attack with d12s.");
            let ev = ampEv * castOk;
            const rest = ctx.actions - c.m.cost;
            if (rest >= 1) { const fill = filler(board, ctx, c.f, rest, ctx.made, { unleashed, sub, dc, lv, castOk }); steps.push(...fill.steps); ev += fill.ev; notes.push(...fill.notes); }
            plans.push({ kind: "class", title: `Amped ${c.sp.name} at ${nameOf(c.f)}`, target: c.f, ev, score: ev + 0.3, dest: null, steps, notes });
        } else if (fpAvailable > 0 || strainOk) {
            out.notes.push(`Keep the Focus Point${fpAvailable > 0 ? "" : " (Strain Mind)"}: amped ${c.sp.name} at ${tgt} adds only about ${Math.round(Math.max(0, gain))} over the plain cantrip (about ${Math.round(c.plainEv)}). An amp earns its point when it adds ${b} or more, or finishes the foe.`);
        }
    }

    // --- Focus Points ------------------------------------------------------------------------------------------------
    if (fp !== null && fullPsychic) {
        if (fp <= 0) out.notes.push(`No Focus Points left: your psi cantrips cast plain until you Refocus (10 minutes; ${hasAny(actor, "amp-focus") ? "Amp Focus refills the whole pool" : "2 points back when you've spent them only on amps and psychic abilities"}).${strainOk ? ` Strain Mind (once an hour) still amps one psi cantrip for 4 HP per rank (${4 * rank} HP now).` : ""}${hasAny(actor, "brain-drain") && usesLeft(actor, "brain-drain") !== 0 ? " Brain Drain (2 actions, once a day) can win one back." : ""}`);
        else out.notes.push(`Focus Points: ${fp} of ${fmax} left, one per amp${psi.length ? ` (psi cantrips: ${psi.map((s) => s.name).join(", ")})` : ""}. A Refocus gives 2 back when you've spent them only on amps and psychic abilities${hasAny(actor, "amp-focus") ? ", all of them with Amp Focus" : ""}, so spend them.`);
    }

    // --- Unleash Psyche ----------------------------------------------------------------------------------------------
    if (fullPsychic && has(actor, "unleash-psyche")) {
        const psycheActs = [];
        if (sub) psycheActs.push(sub.action);
        for (const [s, n] of [["psi-burst", "Psi Burst"], ["dream-guise", "Dream Guise"], ["emotional-surge", "Emotional Surge"], ["impose-order-psychic", "Impose Order"], ["impose-order", "Impose Order"], ["scour-the-library", "Scour the Library"], ["psi-catastrophe", "Psi Catastrophe"], ["wandering-thoughts", "Wandering Thoughts"], ["cranial-detonation", "Cranial Detonation"], ["all-in-your-head", "All in Your Head"]]) if (has(actor, s) && !psycheActs.includes(n)) psycheActs.push(n);
        const bestDmg = spells.filter((s) => s.avg > 0 && !s.heals && s.cost && s.cost <= ctx.actions).sort((a, b) => b.rank - a.rank || b.avg - a.avg)[0];
        if (unleashed) {
            out.notes.push(`Your psyche is unleashed${Number.isFinite(rem) ? ` (${rem >= 12 ? "this round and the next" : "this round only"})` : ""}: every damaging spell you cast gets +2 per rank (${bestDmg ? `${bestDmg.name} +${2 * bestDmg.rank}` : `a cantrip +${2 * rank}`}), and your psyche actions are open${psycheActs.length ? `: ${psycheActs.join(", ")}` : ""}. When it ends you're stupefied 1 for 2 rounds (a DC 6 flat check to cast, -1 to spell attacks and DCs), so make these the spell turns and spend your amps now.${has(actor, "mental-buffer") ? ` Mental Buffer: resistance ${lv} to mental damage while it lasts.` : ""}${has(actor, "thoughtsense") ? " Thoughtsense is imprecise to 30 feet now, so you can Seek thinking creatures with it." : ""}${has(actor, "constant-levitation") ? " Constant Levitation: +10 feet to your fly Speed." : ""}`);
            if (sub?.slug === "calculate-threats" && foes.some((f) => f.reach && feetBetween(me.rect, f.rect) <= (f.reach + (f.speed ?? 25)))) out.notes.push("Calculate Threats (1 action, psyche): +2 circumstance to AC and Reflex until your next turn; worth an action when a foe can reach you this round.");
            if (sub?.slug === "fade-into-daydreams" && foes.length) out.notes.push("Fade Into Daydreams (1 action, psyche): concealed until your next turn, a DC 5 flat check on every attack at you; worth an action when you're in reach or under fire, not for Hiding.");
            if (sub?.slug === "recall-the-teachings" && board.allies.length) out.notes.push("Recall the Teachings (1 action, psyche): you count as prepared to Aid every ally within 30 feet until your next turn, with Occultism; worth it when an ally's big Strike or check comes before your turn.");
            if (has(actor, "psi-catastrophe") && ctx.actions >= 2) {
                const inArea = foes.filter((f) => f.hp > 0 && feetBetween(me.rect, f.rect) <= 20);
                const alliesIn = board.allies.filter((a) => feetBetween(me.rect, a.rect) <= 20);
                const avg = 3.5 * lv;
                const ev = inArea.reduce((t, f) => t + saveExpected(f.saves?.reflex ?? lv + 5, dc, avg, { basic: true }).expected, 0);
                if (inArea.length >= 2 && !alliesIn.length) out.notes.push(`Psi Catastrophe (2 actions, psyche): ${Math.round(avg)} bludgeoning in a 20-foot emanation, basic Reflex, about ${Math.round(ev)} across ${inArea.map(nameOf).join(", ")}; it ends your psyche at once (and the stupefied 1 follows), so it's the last thing you do while unleashed, not the first.`);
                else out.notes.push(`Psi Catastrophe (2 actions, psyche) wants two or more foes within 20 feet of you and no allies${alliesIn.length ? ` (${alliesIn.map(nameOf).join(", ")} would be in it)` : ""}; it ends your psyche.`);
            }
            if (has(actor, "emotional-surge") && ctx.actions >= 3) {
                const atkSp = spells.filter((s) => s.attack !== null && s.attack !== undefined && s.avg > 0 && s.cost === 2).sort((a, b) => b.avg - a.avg)[0];
                const f = foes.filter((x) => x.hp > 0).sort((a, b) => a.ac - b.ac)[0];
                if (atkSp && f) { const base = strikeExpected(atkSp.attack + mapFor(ctx.made, false), f.ac, atkSp.avg).expected; const up = strikeExpected(atkSp.attack + 2 + mapFor(ctx.made, false), f.ac, atkSp.avg).expected; out.notes.push(`Emotional Surge (1 action, psyche): +2 status to attack rolls until your next turn, about +${Math.round(up - base)} on ${atkSp.name} at ${nameOf(f)}; worth it before a spell attack, not before a save spell.`); }
            }
            if (hasAny(actor, "impose-order-psychic", "impose-order")) out.notes.push(`Impose Order (1 action, psyche, fortune): your damage dice count as their average rounded up until the end of your turn; take it before a many-dice spell when a low roll would leave the foe standing${bestDmg ? ` (${bestDmg.name} this turn)` : ""}.`);
            if (has(actor, "scour-the-library") && foes.length) out.notes.push(`Scour the Library (1 action, psyche): Recall Knowledge on a foe within 60 feet; a success is +1 to your next attack roll against it and +1 AC against its next attack (+2 on a critical success).`);
            if (has(actor, "dream-guise") && board.allies.length) out.notes.push("Dream Guise (1 action, psyche): Stride into an ally's space and one of you Strides out, both wearing one shared look; foes have to guess which is which until one of you acts. For getting out of reach with a bodyguard.");
            if (has(actor, "wandering-thoughts")) out.notes.push("Wandering Thoughts (free, once a round, right after you Cast a Spell): teleport 15 feet to a square you can see, so cast and then slip out of reach or out of a cone.");
            if (has(actor, "cranial-detonation")) { const low = foes.filter((f) => f.hp > 0 && f.hp <= (bestDmg?.avg ?? 0)); out.notes.push(`Cranial Detonation (free, once a round) fires when a spell drops a non-mindless foe to 0: 35 bludgeoning (10d6, basic Reflex) to everything within 15 feet of it, chaining through any it drops.${low.length ? ` ${low.map(nameOf).join(", ")} ${low.length > 1 ? "are" : "is"} low enough to drop this turn; stand your allies clear of it.` : ""}`); }
            if (has(actor, "all-in-your-head")) out.notes.push("All in Your Head (reaction, psyche) fires when you're about to roll a Fortitude or Reflex save: roll Will instead, without Walls of Will's or Fortress of Will's upgrades.");
            if (has(actor, "autonomic-psychic-action")) out.notes.push("Autonomic Psychic Action: you're quickened, and the extra action is for psyche actions only, so a psyche action a turn is free.");
        } else if (stupefied) {
            out.notes.push(`Stupefied ${stupefied}: Unleash Psyche is closed to you until it clears, and a spell needs a DC ${5 + stupefied} flat check (${pct(castOk)}). Amped psi cantrips are the cheap thing to risk on that check; keep the slot spells for a clean turn.`);
        } else {
            const nextRound = bestDmg ? `${bestDmg.name} +${2 * bestDmg.rank}` : `a cantrip +${2 * rank}`;
            out.notes.push(`Unleash Psyche is a free action as your turn begins when you Cast a Spell on your previous turn and aren't stupefied: for 2 rounds${has(actor, "twin-psyche") ? " (4 with Twin Psyche)" : ""} every damaging spell gets +2 per rank (${nextRound}) and your psyche actions open${psycheActs.length ? ` (${psycheActs.join(", ")})` : ""}. Afterwards you're stupefied 1 for 2 rounds and can't Unleash again for 2. It pays when the next two turns are spell turns against foes that will still be standing; cast a spell this turn to have it ready.`);
            if (has(actor, "violent-unleash") && ctx.actions >= 3) {
                const inArea = foes.filter((f) => f.hp > 0 && feetBetween(me.rect, f.rect) <= 20);
                const alliesIn = board.allies.filter((a) => feetBetween(me.rect, a.rect) <= 20);
                const avg = 3.5 * Math.ceil(lv / 2);
                if (inArea.length) out.notes.push(`Violent Unleash (1 action, right after you Unleash): ${Math.round(avg)} force in a 20-foot emanation, basic Reflex, on ${inArea.map(nameOf).join(", ")}${alliesIn.length ? ` and on ${alliesIn.map(nameOf).join(", ")} too` : ""}; best on the turn you Unleash with foes close and allies not.`);
            }
            if (hasAny(actor, "dark-persona-s-presence", "dark-personas-presence")) out.notes.push("Dark Persona's Presence fires when you Unleash: every creature within 30 feet saves (Will) or is frightened 1 to 3, and can't shake below frightened 1 while inside; stand near the foes and away from your allies before you Unleash.");
            if (has(actor, "no")) out.notes.push("No!!! (reaction) fires when an ally within 60 feet drops to 0 HP: Unleash your Psyche at once without having cast last turn (or take a 1-action psyche action if it's already up).");
        }
    }

    // Violent Unleash as a step on the turn the psyche was just unleashed
    if (justUnleashed && has(actor, "violent-unleash") && ctx.actions >= 1) {
        const inArea = foes.filter((f) => f.hp > 0 && feetBetween(me.rect, f.rect) <= 20);
        const alliesIn = board.allies.filter((a) => feetBetween(me.rect, a.rect) <= 20);
        const avg = 3.5 * Math.ceil(lv / 2);
        const ev = inArea.reduce((t, f) => t + saveExpected(f.saves?.reflex ?? lv + 5, dc, avg, { basic: true }).expected, 0) - alliesIn.length * avg * 0.5;
        if (inArea.length && ev > 0) {
            const steps = [{ cost: 1, text: `Violent Unleash (first action, right after Unleash): ${Math.round(avg)} force in a 20-foot emanation at ${inArea.map(nameOf).join(", ")}, basic Reflex (about ${Math.round(ev)})` }];
            let total = ev;
            const f = inArea.sort((a, b) => a.hp - b.hp)[0];
            if (ctx.actions > 1) { const fill = filler(board, ctx, f, ctx.actions - 1, ctx.made, { unleashed, sub, dc, lv, castOk, spells }); steps.push(...fill.steps); total += fill.ev; }
            plans.push({ kind: "class", title: "Violent Unleash", target: f, ev: total, score: total + 0.3, dest: null, steps, notes: alliesIn.length ? [`${alliesIn.map(nameOf).join(", ")} ${alliesIn.length > 1 ? "are" : "is"} in the emanation too.`] : [] });
        }
    }

    // Restore the Mind as a plan while unleashed: a heal of 2 + 2 x level to an ally within 30 feet (once each per 10 minutes)
    if (unleashed && sub?.slug === "restore-the-mind" && ctx.actions >= 1) {
        const heal = 2 + 2 * lv;
        const cands = board.allies.filter((a) => a.maxHp > 0 && a.maxHp - a.hp >= Math.min(heal, a.maxHp * 0.25) && feetBetween(me.rect, a.rect) <= 30).map((a) => ({ a, v: 0.8 * Math.min(heal, a.maxHp - a.hp) })).sort((x, y) => y.v - x.v);
        if (cands.length) {
            const { a, v } = cands[0];
            const steps = [{ cost: 1, text: `Restore the Mind (psyche) on ${nameOf(a)}: ${heal} HP back (it's at ${a.hp}/${a.maxHp})` }];
            let total = v;
            const f = foes.filter((x) => x.hp > 0).sort((x, y) => feetBetween(me.rect, x.rect) - feetBetween(me.rect, y.rect))[0];
            if (ctx.actions > 1 && f) { const fill = filler(board, ctx, f, ctx.actions - 1, ctx.made, { unleashed, sub, dc, lv, castOk, spells, noRestore: true }); steps.push(...fill.steps); total += fill.ev; }
            plans.push({ kind: "class", title: `Restore the Mind on ${nameOf(a)}`, target: null, ev: total, score: total + 0.2, dest: null, steps, notes: ["An ally healed this way is immune to it for 10 minutes; the other choice is +1 to its saves against mental effects while your psyche lasts."] });
        }
    }

    // Brain Drain (8, 2 actions, once a day): a Will save or stupefied 1 and a Focus Point back; for a turn with no point left
    if (hasAny(actor, "brain-drain") && ctx.actions >= 2 && usesLeft(actor, "brain-drain") !== 0 && fp !== null) {
        const f = foes.filter((x) => x.hp > 0 && feetBetween(me.rect, x.rect) <= 30 && !x.traits?.includes?.("mindless")).map((x) => ({ x, c: degreeChances(x.saves?.will ?? lv + 5, dc) })).sort((a, b) => (b.c.f + b.c.cf) - (a.c.f + a.c.cf))[0];
        if (f) {
            const fail = f.c.f + f.c.cf;
            const pointWorth = ampPick ? Math.max(3, ampPick.gain) : 3 + rank;
            const ev = fail * (worth(board, "stupefied") + pointWorth);
            if (fp <= 0) plans.push({ kind: "class", title: `Brain Drain ${nameOf(f.x)}`, target: f.x, ev, score: ev + 0.2, dest: null, steps: [{ cost: 2, text: `Brain Drain ${nameOf(f.x)} (Will DC ${dc}, fails about ${pct(fail)}): stupefied 1 for a minute and a Focus Point back for you` }], notes: ["Once a day; it works only on a failed save, so pick the foe with the worst Will."] });
            else out.notes.push(`Brain Drain (2 actions, once a day): a Focus Point back on a failed Will save (${nameOf(f.x)} fails about ${pct(fail)}) and stupefied 1 on it; save it for when the pool is empty.`);
        }
    }

    // --- Slots left, cantrip or slot, signature spells (the advisor taxes slot spells itself: not again here) ----------
    const slots = slotsLeft(actor);
    const topRank = slots.filter((s) => s.left > 0).map((s) => s.rank).pop() ?? Math.max(0, ...spells.filter(isSlot).map((s) => s.rank));
    if (slots.length) {
        const txt = slots.map((s) => `${ordinal(s.rank)} ${s.left}/${s.max}`).join(", ");
        out.notes.push(`Slots left: ${txt}. You have fewer than other casters, so the psi cantrips and their amps are the everyday damage; a slot is for the save spell on the biggest foe or the area with two or more in it.${has(actor, "conscious-spell-specialization") ? ` Conscious Spell Specialization: an extra slot of 1st to 4th${lv >= 18 ? " and 5th" : ""} rank for your conscious mind's spells only (${mind?.granted ?? "the granted spells"}).` : ""}`);
    }
    if (foes.length) {
        let pick = null;
        for (const f of foes) {
            let cantrip = null, slot = null;
            for (const sp of spells) {
                if (!(sp.avg > 0) || sp.heals || !sp.cost || sp.cost > ctx.actions) continue;
                const e = spellExpected(board, sp, f, sp.avg, ctx.made);
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
            const b = 3 + slot.sp.rank;
            const left = slots.find((s) => s.rank === slot.sp.rank);
            const ampTxt = ampPick && ampPick.f === f ? ` (amped ${ampPick.sp.name} does about ${Math.round(ampPick.ampEv)} for a Focus Point)` : "";
            out.notes.push(gain >= b || finishes
                ? `Spend a slot on ${nameOf(f)}: ${slot.sp.name} (rank ${slot.sp.rank}${left ? `, ${left.left} of ${left.max} left` : ""}${slot.sp._unleash ? `, +${slot.sp._unleash} unleashed` : ""}) does about ${Math.round(slot.e.expected)}${finishes ? `, enough to finish it at ${f.hp} HP` : ` against ${cantrip ? `${cantrip.sp.name}'s about ${Math.round(cantrip.e.expected)}` : "no damaging cantrip"}`}${ampTxt}.`
                : `Keep the slot against ${nameOf(f)}: ${cantrip ? `${cantrip.sp.name} does about ${Math.round(cantrip.e.expected)}` : "you have no damaging cantrip for it"}${ampTxt}; ${slot.sp.name} (rank ${slot.sp.rank}) adds only about ${Math.round(Math.max(0, gain))}. A slot earns its place when it adds ${b} or more, or finishes the foe.`);
        }
    }
    const sigs = spells.filter((sp) => isSlot(sp) && isSignature(sp));
    if (sigs.length) {
        let said = false;
        const lowRanks = slots.filter((s) => s.left > 0).map((s) => s.rank);
        for (const sp of sigs.filter((s) => s.avg > 0 && !s.heals)) {
            for (const f of foes) {
                if (!(f.hp > 0)) continue;
                const top = spellExpected(board, sp, f, sp.avg, ctx.made);
                if (!top || top.expected < f.hp) continue;
                const base = Number(sp.spell?.baseRank ?? sp.spell?.system?.level?.value ?? sp.baseRank ?? 1) || 1;
                for (const r of lowRanks.filter((r) => r >= base && r < sp.rank)) {
                    const avgAt = Math.max(0, sp.avg - (sp._unleash ?? 0)) * (r / Math.max(1, sp.rank)) + (sp._unleash ? 2 * r : 0);
                    const e = spellExpected(board, sp, f, avgAt, ctx.made);
                    if (e && e.expected >= f.hp) { out.notes.push(`${sp.name} is a signature spell: cast it from a ${ordinal(r)} slot at ${nameOf(f)} (about ${Math.round(e.expected)}, it has ${f.hp} HP) and keep the ${ordinal(sp.rank)}.`); said = true; break; }
                }
                if (said) break;
            }
            if (said) break;
        }
        if (!said) out.notes.push(`Signature spells (${sigs.map((s) => s.name).join(", ")}) cast from any rank you have a slot for: a top slot (${ordinal(topRank)}) for the biggest foe or an area with two or more in it, a lower one to finish a hurt foe.${hasAny(actor, "signature-spell-expansion-psychic", "signature-spell-expansion") ? " Signature Spell Expansion gave you two more of rank 3 or lower." : ""}`);
    }

    // --- The conscious mind's other psi cantrips and amps: when each pays ------------------------------------------
    const have = (s) => psiSlugs.has(s);
    const near = foes.filter((f) => f.hp > 0);
    const nearestFoe = near.sort((a, b) => feetBetween(me.rect, a.rect) - feetBetween(me.rect, b.rect))[0] ?? null;
    const meleeAllies = board.allies.filter((a) => a.hasMelee !== false);
    if (have("telekinetic-hand") && nearestFoe && fpAvailable > 0) out.notes.push(`Amped Telekinetic Hand (2 actions, 1 Focus Point): Shove a Medium or smaller foe with a spell attack against its Fortitude DC and slow it by 10 feet while you Sustain; a Shove again each turn you Sustain${rank >= 4 ? ", or Disarm it instead" : ""}. For a foe you need off an ally or away from an edge.`);
    if (have("figment") && meleeAllies.length && near.length && fpAvailable > 0) out.notes.push(`Amped Figment (2 actions, 1 Focus Point): an illusion in an empty square that flanks for one melee attack before your next turn${meleeAllies.length ? `, so ${nameOf(meleeAllies[0])} gets off-guard on a Strike at ${nameOf(near[0])}` : ""}; Sustain it to keep and move it. The plain Figment Creates a Diversion at +2 when you Sustain it.`);
    if (have("shield")) out.notes.push(`Shield can go on an ally within 30 feet instead of you (your reaction to Shield Block). Amped (1 Focus Point): three layers, Sustained up to a minute, each Shield Block breaks one; worth the point when a front-liner is taking hits.`);
    if (have("guidance") && board.allies.length) out.notes.push("Amped Guidance is a reaction (1 Focus Point) when an ally within 120 feet fails a roll by 1: the +1 turns the failure into a success, and amped it ignores their immunity. Keep a point for it when the pool allows.");
    if (have("detect-magic") && foes.some((f) => f.caster || f.spells?.length)) out.notes.push("Amped Detect Magic (1 Focus Point): +1 status to saves against magic from each foe it shows for 3 rounds; before a caster's big round.");
    if (have("warp-step")) out.notes.push(`Warp Step: +10 feet to your Speed and two Strides for 2 actions. Amped (1 Focus Point) it's a single action${rank >= 4 ? ", or a teleport up to double your Speed to a square you can see" : ""}; the way out when you're in reach.`);
    if (have("message") && board.allies.length) out.notes.push(`Amped Message (1 action, 1 Focus Point) to an ally within 120 feet: they spend their reaction to Step or Stride${rank >= 4 ? ", or to Shove, Strike or Trip" : ""} at once; a free move for an ally who's out of position.`);
    if (have("thermal-stasis")) out.notes.push(`Thermal Stasis (1 action): resistance ${2 * rank} to fire and cold on one creature until your next turn; amped (1 Focus Point) it lasts a minute. For whoever stands in a breath or a burst.`);
    if (have("distortion-lens") && (board.allies.some((a) => a.hasMelee === false) || foes.some((f) => f.ranged))) out.notes.push("Distortion Lens (1 action, 30 feet): your side's ranged attacks through it reach 10 feet further, the foes' need 10 more; amped (1 Focus Point) it holds a minute, allies move through it free and it's difficult terrain for foes.");
    if (have("glimpse-weakness") && meleeAllies.length && near.length) { const pl = 1 + rank, am = 3.5 * k2(rank); out.notes.push(`Glimpse Weakness (1 action, 60 feet) on ${nameOf(near[0])}: the first ally Strike to hit adds ${pl} precision; amped (1 Focus Point) about ${Math.round(am)} instead. Before ${nameOf(meleeAllies[0])}'s turn, not after.`); }
    if (have("omnidirectional-scan") && board.allies.length && near.length) out.notes.push(`Omnidirectional Scan (1 action): Seek the 30 feet around you and prepare to Aid an ally's attack on a foe with your spell attack; amped (1 Focus Point) you learn its best and worst saves and your whole party within 30 feet gets +1 to attacks and damage against it (more if your Aid lands). Worth the point on the fight's main foe while it still has HP to lose.`);
    if (have("foresee-the-path") && meleeAllies.length && near.length) out.notes.push(`Foresee the Path (1 action): a Perception check against ${nameOf(near[0])}'s Will or Deception DC gives ${nameOf(meleeAllies[0])} a Reactive Strike against it (or +2 on the one it has); amped (1 Focus Point) a failure counts as a success and each Sustain adds an ally.`);
    if (have("astral-rain") && near.length) out.notes.push(`Astral Rain (2 actions, 60 feet): ${Math.round(2.5 * (rank + 1))} in a 5-foot cube now and on anything that enters before your next turn, basic Reflex; amped (1 Focus Point) a 5-foot burst you Sustain up to a minute and move 20 feet a round, so one action a round keeps hurting whoever you follow.`);
    if (have("entropic-wheel")) out.notes.push(`Entropic Wheel (reaction, when you deal fire or cold damage): a wheel of up to ${rank} motes that adds the opposite energy to each fire or cold spell; amped (1 Focus Point) it starts with two and gains two at a time. Cast it on your first fire or cold hit of the fight.`);
    if (have("vector-screen") && foes.some((f) => f.ranged)) out.notes.push(`Vector Screen (2 actions): a ${rank >= 5 ? 20 : 10}-foot line that catches arrows and bolts and gives -2 to bigger ranged weapons${rank >= 6 ? " and spells" : ""}; amped (1 Focus Point) it lasts a minute and you can fire the caught projectiles back. For a turn under archers.`);
    if (have("ghostly-shift")) out.notes.push(`Ghostly Shift (1 action): resistance ${2 + Math.floor((rank - 3) / 2)} to all but force damage for a minute; amped (1 Focus Point) you Stride through a foe's space once a round for ${Math.round(3.5 * (2 + Math.floor((rank - 3) / 2)))} force (basic Fortitude).`);
    if (have("contagious-idea") && (board.allies.length || near.length)) out.notes.push(`Contagious Idea (2 actions, 30 feet): a pleasant thought is 5 temporary HP to two creatures, a terrifying one frightened 1 or 2 (Will); amped (1 Focus Point) it reaches a third and the pleasant thought gives ${10 + 2 * Math.max(0, rank - 5)}.`);
    if (have("hologram-cage")) out.notes.push("Hologram Cage (3 actions, 60 feet): a 20-foot cube nothing sees into or out of, to split a fight or blind the archers; amped (1 Focus Point) its walls are force with hardness and HP, a real pen.");
    if (have("dancing-blade") && near.length) out.notes.push(`Dancing Blade (2 actions, 30 feet): a weapon of yours Strikes with your spell attack for ${Math.round(3.5 * (3 + Math.floor((rank - 5) / 2)))}, and again each turn you Sustain (your multiple attack penalty); amped (1 Focus Point) d10s, and it can Guard an ally (+2 AC against melee) or Push instead.`);
    if (have("tesseract-tunnel")) out.notes.push("Tesseract Tunnel (2 actions): Stride and leave a portal pair behind you that allies can take; amped (1 Focus Point) you teleport instead and the tunnel runs both ways for a minute.");
    if (have("forbidden-thought") && nearestFoe) out.notes.push(`Forbidden Thought (2 actions, 30 feet) locks one action (Strike, Stride, Cast a Spell or one you've seen it use) on ${nameOf(nearestFoe)}: ${Math.round(3.5 * (rank + 1))} mental (basic Will) if it tries it next turn; amped (1 Focus Point) a failed save is also stunned 1. Lock the action it will take anyway.`);

    // The Oscillating Wave's Conservation of Energy: fire and cold alternate
    if (mindSlug === "the-oscillating-wave") {
        const fireBad = foes.filter((f) => f.iwr?.immune?.includes?.("fire") || f.iwr?.resist?.some?.((r) => r.type === "fire"));
        const coldBad = foes.filter((f) => f.iwr?.immune?.includes?.("cold") || f.iwr?.resist?.some?.((r) => r.type === "cold"));
        out.notes.push(`Conservation of Energy: your standard psi cantrips and the Oscillating Wave's granted spells alternate, adding energy (fire) one cast and removing it (cold) the next, from a free choice on the first cast of the fight (and after a Refocus).${fireBad.length ? ` ${fireBad.map(nameOf).join(", ")} shrug${fireBad.length > 1 ? "" : "s"} off fire: time the cold cast for ${fireBad.length > 1 ? "them" : "it"}.` : ""}${coldBad.length ? ` ${coldBad.map(nameOf).join(", ")} shrug${coldBad.length > 1 ? "" : "s"} off cold: time the fire cast for ${coldBad.length > 1 ? "them" : "it"}.` : ""} A mindshift action can take the energy instead of mental and then asks a Reflex save.`);
    }

    // --- Alternate amps from feats (one amp per cantrip; these replace the native one) --------------------------------
    const alts = [];
    if (hasAny(actor, "mental-balm") && (board.allies.some((a) => a.conditions?.has?.("frightened") || a.conditions?.has?.("stupefied")) || me.conditions?.has?.("frightened") || stupefied)) alts.push("Mental Balm on a psi cantrip that touches only you or allies (Shield, Guidance, Thermal Stasis, Message...): +2 to Will against emotion effects for a minute and a counteract against the frightened or stupefied on you or that ally; the stupefied after an Unleash counts");
    if (hasAny(actor, "warp-space")) alts.push("Warp Space on a ranged psi cantrip: measure range, line of effect and cover from a square within 30 feet, so a foe behind a wall or a shield-wall is open");
    if (hasAny(actor, "homing-beacon") && foes.some((f) => f.state === "concealed" || f.conditions?.has?.("concealed") || f.conditions?.has?.("hidden"))) alts.push(`Homing Beacon on a hit or a failed save: for a minute the foe is never better than concealed and never concealed at all; for ${foes.filter((f) => f.state === "concealed" || f.conditions?.has?.("concealed")).map(nameOf).join(", ") || "the one that keeps slipping away"}`);
    if (hasAny(actor, "inertial-barrier")) alts.push(`Inertial Barrier on any psi cantrip: resistance ${2 + rank} to physical damage for you or one target until your next turn; on the ally the foes are swinging at`);
    if (hasAny(actor, "remove-presence")) alts.push("Remove Presence on a hit or a failed save: you're undetected by that foe for a minute or until you act hostile; for slipping away from the one that's on you");
    if (hasAny(actor, "whispering-steps")) alts.push("Whispering Steps on a 2-action psi cantrip that hits or lands its save: the foe Strides up to half its Speed where you say, once a day per foe; out of your front-liner's reach, into an ally's flank, or off the archer's sight line");
    if (hasAny(actor, "shatter-space")) alts.push(`Shatter Space on a 2-action psi cantrip: an aura up to 20 feet around you or a target, ${Math.round(3.5 * rank)} slashing (basic save) to anything that starts its turn in it or enters, prone on a critical failure; put it on the front-liner with foes around them`);
    if (hasAny(actor, "target-of-psychic-ire")) alts.push(`Target of Psychic Ire on a 2-action psi cantrip at a creature: ${Math.round(2.5 * rank)} bludgeoning (basic save) at the start of each of its turns for 3 rounds; on a foe with the HP to be there in 3 rounds`);
    if (alts.length && (fpAvailable > 0 || strainOk)) out.notes.push(`Other amps you know, each in place of a cantrip's own (still 1 Focus Point): ${alts.join("; ")}.`);
    if (hasAny(actor, "astral-tether") && board.allies.length) out.notes.push("Astral Tether (1 action, ally within 60 feet, lasts until you use it again or get 60 feet apart): the benefits your amps would give you (temporary HP, resistance, a barrier) go to that ally instead. Set it on the front-liner before the first amp.");
    if (hasAny(actor, "psi-strikes") && board.strikes.length) out.notes.push(`Psi Strikes (free, once a turn, right after you Cast a Spell or Unleash): +1d6 force on one weapon or unarmed attack until the end of the turn${unleashed ? ", or until your psyche subsides while it's unleashed" : ""}; for a turn that ends with a Strike.`);

    // --- Reactions and the rest ------------------------------------------------------------------------------------
    if (hasAny(actor, "counter-thought")) {
        const open = slots.filter((s) => s.left > 0).map((s) => ordinal(s.rank));
        out.notes.push(`Counter Thought fires when a creature you can see Casts a Spell with the mental trait: spend a slot of a rank you could cast a mental spell at to counteract it${open.length ? ` (slots open at ${open.join(", ")})` : ""}.`);
    }
    if (hasAny(actor, "mental-static")) out.notes.push(`Mental Static fires when you critically succeed at a Will save against a creature's mental effect: ${lv} mental damage back at it${has(actor, "walls-of-will") ? " (Walls of Will makes every Will success a critical one, so it fires often)" : ""}.`);
    if (hasAny(actor, "foreseen-failure") && usesLeft(actor, "foreseen-failure") !== 0) out.notes.push("Foreseen Failure (free, once a day) fires when a spell does nothing (every target critically succeeded or every attack critically failed): the slot is spent, but you cast a different spell of the same or fewer actions at once.");
    if (hasAny(actor, "thoughtform-summoning") && spells.some((s) => /^summon /i.test(s.name))) out.notes.push("Thoughtform Summoning: a summoned creature can be a psychic construct instead, with resistance to physical damage equal to half its level and weakness 5 to force and mental, and it walks through foes' spaces; take it against melee foes, not against casters.");
    if (hasAny(actor, "deep-roots") && spells.some((s) => s.traits?.includes("incapacitation") || /command|dominate|suggestion|demand|dance/i.test(s.name))) out.notes.push("Deep Roots: a target that critically fails against your Command, Suggestion, Dominate or the like takes 1d6 mental per rank when it finishes the orders or the spell is removed.");
    if (hasAny(actor, "unlimited-potential") && usesLeft(actor, "unlimited-potential") !== 0 && slots.length) out.notes.push("Unlimited Potential (1 action, spellshape, once a minute) before a rank 5 or lower spell with no duration: the slot isn't spent. Put it on your first slot spell of the fight.");
    if (hasAny(actor, "psychic-rapport")) out.notes.push("Psychic Rapport: after a mental spell, +1 to Deception, Diplomacy, Intimidation and Sense Motive until your next turn; a Demoralize after a Daze lands harder.");
    if (hasAny(actor, "mind-over-matter") || hasAny(actor, "infinite-mind")) { const tenth = slots.find((s) => s.rank === 10); out.notes.push(`10th-rank slot${hasAny(actor, "mind-over-matter") ? "s" : ""}: ${tenth ? `${tenth.left} of ${tenth.max} left` : hasAny(actor, "mind-over-matter") ? "two a day" : "one a day"}, for your two 10th-rank spells only and never with Unlimited Potential; the fight that decides the day.`); }
    if (hasAny(actor, "become-thought")) out.notes.push("Become Thought: resistance 10 to physical damage and weakness 5 to mental, so stand in melee before you stand near a mind-mage.");
    if (hasAny(actor, "twin-psyche") && !unleashed) out.notes.push("Twin Psyche: your Unleash can run 4 rounds instead of 2; take the doubling when the fight has that long in it, since the stupefied comes after either way.");

    out.plans.push(...plans);
}

/**
 * What fills the actions after a psi cantrip: Psi Burst while unleashed (once a round), a Strike in reach (with Psi
 * Strikes' die when known), Restore the Mind on a hurt ally while unleashed. { steps, ev, notes }.
 */
function filler(board, ctx, t, rest, made, { unleashed, sub, dc, lv, castOk = 1, noRestore = false }) {
    const actor = board.me.actor;
    const me = board.me;
    const steps = [];
    const notes = [];
    let ev = 0;
    let burstUsed = false;
    let guard = 0;
    while (rest >= 1 && guard++ < 3) {
        const opts = [];
        if (unleashed && !burstUsed && has(actor, "psi-burst") && t && feetBetween(me.rect, t.rect) <= 30) {
            const avg = 2.5 * Math.ceil(lv / 2);
            const e = saveExpected(t.saves?.reflex ?? lv + 5, dc, avg, { basic: true });
            opts.push({ ev: e.expected, cost: 1, text: `Psi Burst (psyche, once a round) at ${nameOf(t)}: ${Math.round(avg)} bludgeoning, basic Reflex (about ${Math.round(e.expected)})`, burst: true });
        }
        const b = t ? bestStrike(board, t, { made, extra: has(actor, "psi-strikes") ? 3.5 : 0 }) : null;
        if (b && inReach(me.rect, t.rect, b.s.reach || 5)) opts.push({ ev: b.e.expected, cost: 1, text: `Strike ${nameOf(t)} with ${b.s.label} (${signed(b.bonus)}, about ${Math.round(b.e.expected)}${has(actor, "psi-strikes") ? ", Psi Strikes' 1d6 force in" : ""})`, strike: true });
        if (unleashed && !noRestore && sub?.slug === "restore-the-mind") {
            const heal = 2 + 2 * lv;
            const a = board.allies.filter((x) => x.maxHp > 0 && x.maxHp - x.hp >= Math.min(heal, x.maxHp * 0.25) && feetBetween(me.rect, x.rect) <= 30).sort((x, y) => (x.hp / x.maxHp) - (y.hp / y.maxHp))[0];
            if (a) opts.push({ ev: 0.8 * Math.min(heal, a.maxHp - a.hp), cost: 1, text: `Restore the Mind (psyche) on ${nameOf(a)}: ${heal} HP back`, restore: true });
        }
        opts.sort((x, y) => y.ev - x.ev);
        const pick = opts[0];
        if (!pick || pick.ev <= 0) break;
        steps.push({ cost: pick.cost, text: pick.text });
        ev += pick.ev;
        rest -= pick.cost;
        if (pick.burst) burstUsed = true;
        if (pick.strike) made += 1;
        if (pick.restore) noRestore = true;
    }
    return { steps, ev, notes };
}

export { psychic };
