/**
 * PF2e Tactics: classes/bard.mjs
 * See classes/_common.mjs for the shape of a class read.
 * The bard's layer: composition cantrips as one-action plans worth what the allies they reach will do with them,
 * the focus spells that shape them (Lingering, Fortissimo), the muse's upgrades as "when" notes, what to Sustain.
 */
import { bestStrike, castable, effect, focusLeft, has, level, pct, standardDC, strikeRun, targets, worth, degreeChances, feetBetween, inReach, strikeExpected, saveExpected, nameOf, signed } from "./_common.mjs";
/** The compositions this read knows, by a name pattern that also takes the Legacy names. */
const COMPS = {
    anthem: /^(courageous anthem|inspire courage)$/i,
    rally: /^(rallying anthem|inspire defense)$/i,
    dirge: /^dirge of doom$/i,
    triple: /^triple time$/i,
    allegro: /^allegro$/i,
    strength: /^song of strength$/i,
    walls: /^house of imaginary walls$/i,
    silver: /^silver'?s refrain$/i,
    lingering: /^lingering composition$/i,
    fortissimo: /^(fortissimo composition|inspire heroics)$/i,
    hymn: /^hymn of healing$/i,
    ballad: /^soothing ballad$/i,
    symphony: /^symphony of the unfettered heart$/i,
    counter: /^counter performance$/i,
    ouroboros: /^ode to ouroboros$/i,
    aria: /^fatal aria$/i,
};
const CASTER_CLASSES = new Set(["wizard", "sorcerer", "witch", "psychic", "oracle", "druid", "cleric", "bard", "summoner", "animist", "necromancer"]);
/** A spell effect of this composition on the creature, still running (an expired one left on the sheet doesn't count). */
function compUp(c, re) {
    const e = c?.actor?.items?.find?.((i) => i.type === "effect" && (re.test(String(i.name ?? "").replace(/^(spell )?effect:\s*/i, "")) || re.test(String(i.slug ?? i.system?.slug ?? "").replace(/^spell-effect-/, "").replace(/-/g, " "))));
    if (!e) return null;
    const rd = e.remainingDuration;
    if (rd && (rd.expired || (Number.isFinite(Number(rd.remaining)) && Number(rd.remaining) <= 0))) return null;
    return e;
}

function bard(board, ctx, out) {
    const actor = board.me.actor;
    const me = board.me;
    const lv = level(board);
    const rank = Math.max(1, Math.ceil(lv / 2));
    const cha = Number(actor?.system?.abilities?.cha?.mod) || 3;
    const perf = Number(actor?.skills?.performance?.mod) || lv + cha + (lv >= 15 ? 8 : lv >= 7 ? 6 : lv >= 3 ? 4 : 2);
    const fp = focusLeft(actor);
    const foes = targets(board);
    const spell = (re) => (board.spells ?? []).find((sp) => re.test(sp.name));
    const comp = (key) => spell(COMPS[key]);
    const muses = ["maestro", "warrior", "enigma", "polymath", "zoophonia"].filter((m) => has(actor, m));
    const symphony = has(actor, "symphony-of-the-muse");
    const eternal = has(actor, "eternal-composition");
    const oneUp = (c) => Object.entries(COMPS).filter(([k]) => ["anthem", "rally", "dirge", "triple", "allegro", "strength", "silver"].includes(k)).map(([k, re]) => (compUp(c, re) ? k : null)).find(Boolean) ?? null;
    const upKey = oneUp(me) ?? (board.allies ?? []).map(oneUp).find(Boolean) ?? null;
    const upName = upKey ? comp(upKey)?.name ?? upKey : null;

    // Versatile Performance: Demoralize with Performance, so the advisor's Demoralize plans use the better of the two
    if (has(actor, "versatile-performance") && perf > (me.intimidation ?? -99)) { me.intimidation = perf; out.notes.push(`Versatile Performance: you Demoralize with Performance (${signed(perf)}); the plans use it.`); }

    const near = (c) => foes.slice().sort((x, y) => feetBetween(c.rect, x.rect) - feetBetween(c.rect, y.rect))[0] ?? null;
    const inRange = (a, ft) => a.hp > 0 && a.canAct !== false && feetBetween(me.rect, a.rect) <= ft;
    const allies = (board.allies ?? []).filter((a) => inRange(a, 60));
    const discordant = has(actor, "discordant-voice");
    /** What a +bonus status to attack and damage is worth over one round to this ally: a tenth of a Strike's damage and
     *  0.6 a point per +1 per Strike, two Strikes a round for a striker, one for a caster; a foe to swing at, or nothing. */
    const anthemFor = (a, bonus) => {
        const f = near(a);
        if (!f) return 0;
        const rs = a.reactiveStrike ?? { bonus: (a.level ?? lv) + 8, avg: 4 + (a.level ?? lv) * 1.5 };
        const closeEnough = inReach(a.rect, f.rect, (a.reach ?? 5) + 25) || (a.rangedReach ?? 0) >= feetBetween(a.rect, f.rect);
        if (!closeEnough) return 0;
        const e = strikeExpected(rs.bonus, f.ac, rs.avg);
        const strikes = CASTER_CLASSES.has(a.cls) && !inReach(a.rect, f.rect, a.reach ?? 5) ? 1 : 2;
        return strikes * (bonus * (0.1 * e.expected + 0.6 * e.hit) + (discordant ? 3.5 * e.hit : 0));
    };
    const anthemRound = (bonus) => allies.reduce((s, a) => s + anthemFor(a, bonus), 0);
    /** The rest of the turn after a composition: Strikes at a foe in reach (with the anthem's own bonus on them), or the best
     *  damaging cantrip with two actions left, or nothing it can reach. */
    const rest = (left, made, selfBonus = 0) => {
        if (left < 1) return { steps: [], ev: 0, strikeHit: 0 };
        const inReachFoe = foes.find((f) => board.strikes.some((s) => s.ranged ? feetBetween(me.rect, f.rect) <= (s.range ?? 30) : inReach(me.rect, f.rect, s.reach || 5)));
        let best = null;
        if (inReachFoe) {
            const melee = board.strikes.some((s) => !s.ranged && inReach(me.rect, inReachFoe.rect, s.reach || 5));
            const r = strikeRun(board, inReachFoe, left, { made, acAdj: -selfBonus, extra: selfBonus, melee });
            if (r.used.length) best = { steps: [{ cost: r.used.length, text: r.text }], ev: r.ev, strikeHit: r.used[0].e.hit };
        }
        if (left >= 2) {
            for (const sp of castable(board, (x) => x.cantrip && x.cost <= left && x.avg > 0 && (x.attack !== null && x.attack !== undefined || x.save?.stat) && !x.traits?.includes("composition"))) {
                const f = foes.filter((x) => feetBetween(me.rect, x.rect) <= Math.max(5, sp.range ?? 30)).sort((x, y) => feetBetween(me.rect, x.rect) - feetBetween(me.rect, y.rect))[0];
                if (!f) continue;
                const e = sp.attack !== null && sp.attack !== undefined ? strikeExpected(sp.attack + selfBonus, f.ac, sp.avg + selfBonus) : saveExpected(f.saves?.[sp.save.stat] ?? lv + 5, sp.dc ?? 10 + lv + 4, sp.avg, { basic: sp.save.basic });
                if (!best || e.expected > best.ev) best = { steps: [{ cost: sp.cost, text: `Cast ${sp.name} at ${nameOf(f)} (about ${Math.round(e.expected)} damage)` }], ev: e.expected, strikeHit: 0 };
            }
        }
        return best ?? { steps: [{ cost: left, text: "Then move to where your allies will fight, or Raise a Shield; nothing of yours reaches a foe" }], ev: 0, strikeHit: 0 };
    };
    const compNote = () => upName && !symphony ? ` Your ${upName} ends when you cast it.` : "";
    const push = (title, ev, steps, notes = [], bias = 0.3) => out.plans.push({ kind: "class", title, target: null, ev, score: ev + bias, dest: null, steps, notes });

    // ---- Courageous Anthem: +1 to attack and damage for you and allies within 60 feet, one action. The best first action
    // of most rounds when three or four allies are about to Strike; a cantrip beats it when they aren't.
    const anthem = comp("anthem");
    const anthemCost = 1; // with Eternal Composition it's the quickened action, still one of the turn's
    if (anthem && ctx.actions >= Math.max(1, anthemCost)) {
        if (upKey === "anthem") {
            out.notes.push(`${anthem.name} is still up this round (an extended casting): don't recast it; spend the action on a Strike, a cantrip or a slot spell.`);
        } else {
            const perRound = anthemRound(1);
            const selfPart = rest(ctx.actions - anthemCost, ctx.made, 1);
            const selfPlain = rest(ctx.actions - anthemCost, ctx.made, 0);
            const selfGain = Math.max(0, selfPart.ev - selfPlain.ev);
            const martial = has(actor, "martial-performance") && selfPart.strikeHit > 0 ? selfPart.strikeHit : 0;
            const base = perRound + selfGain;
            if (base > 0 && allies.length) {
                const who = allies.filter((a) => anthemFor(a, 1) > 0);
                const stepText = (bonus, extra = "") => `${anthem.name}${eternal ? " (your Eternal Composition action)" : ""}: +${bonus} status to attack and damage${extra} for you and ${who.length} ${who.length === 1 ? "ally" : "allies"} within 60 feet (${who.map(nameOf).join(", ")})`;
                // Plain casting: this round, extended a round by a Strike that lands (Martial Performance)
                const ev = base * (1 + martial * 0.8) + selfPart.ev;
                const notes = [];
                if (martial) notes.push(`Martial Performance: a Strike that damages a foe this turn extends the anthem a round (about ${pct(martial)}).`);
                if (upName && upKey !== "anthem" && !symphony) notes.push(`Your ${upName} ends when the anthem starts; only a harmonized composition survives it.`);
                push(`${anthem.name}, then ${selfPart.steps[0]?.text?.split(" ")[0] === "Strike" ? "Strike" : selfPart.ev > 0 ? "a cantrip" : "move"}`, ev, [{ cost: anthemCost, text: stepText(1) }, ...selfPart.steps], notes, 0.4);
                // Lingering Composition (1 Focus Point, free action): 3 or 4 rounds on a Performance check; a failure keeps the point
                const lingering = comp("lingering") && (fp ?? 0) > 0;
                const fortissimo = comp("fortissimo") && (fp ?? 0) > 0;
                const options = [];
                if (lingering) {
                    const hi = Math.max(lv, ...allies.map((a) => a.level ?? lv));
                    const dc = standardDC(hi);
                    const c = degreeChances(perf, dc);
                    const rounds = 4 * c.cs + 3 * c.s + 1 * (c.f + c.cf);
                    const evL = base * (1 + 0.8 * (rounds - 1)) + selfPart.ev;
                    options.push({ key: "lingering", ev: evL, text: `Lingering Composition (free, 1 Focus Point; Performance ${signed(perf)} vs DC ${dc}: ${pct(c.s + c.cs)} for 3 rounds, ${pct(c.cs)} for 4; a failure keeps the point), then ${stepText(1)}`, note: `Lingering: about ${Math.round(rounds * 10) / 10} rounds of anthem for one Focus Point, instead of recasting each turn.` });
                }
                if (fortissimo) {
                    const willDc = 10 + Math.max(me.saves?.will ?? lv + 6, ...allies.map((a) => a.saves?.will ?? lv + 6));
                    const c = degreeChances(perf, willDc);
                    const bonus = 1 + c.s + 2 * c.cs;
                    const evF = anthemRound(bonus) + selfGain * bonus + selfPart.ev;
                    options.push({ key: "fortissimo", ev: evF * (1 + martial * 0.8), text: `Fortissimo Composition (free, 1 Focus Point; Performance ${signed(perf)} vs your side's highest Will DC ${willDc}: ${pct(c.s)} for +2, ${pct(c.cs)} for +3; a failure keeps the point), then ${stepText(2, " (+3 on a critical success)")}`, note: `Fortissimo: a bigger bonus this round, not stacked with Lingering on the same casting; it works on Rallying Anthem and Song of Strength too.` });
                }
                options.sort((a, b) => b.ev - a.ev);
                if (options[0] && options[0].ev > ev + 0.5) {
                    const o = options[0];
                    push(`${o.key === "lingering" ? "Lingering" : "Fortissimo"} ${anthem.name}`, o.ev, [{ cost: anthemCost, text: o.text }, ...selfPart.steps], [o.note, ...(options[1] ? [`${options[1].key === "lingering" ? "Lingering" : "Fortissimo"} instead would be worth about ${Math.round(options[1].ev)}.`] : []), `Focus Points: ${fp} left.`], 0.5);
                }
                // Warrior muse spellshapes: an ally reacts to the anthem with a Stride, a Strike, or both
                const shape = (slug, name, kind) => {
                    if (!has(actor, slug) || ctx.actions < anthemCost + 1) return;
                    let bestAlly = null;
                    for (const a of who) {
                        const f = near(a);
                        if (!f) continue;
                        const rs = a.reactiveStrike ?? { bonus: (a.level ?? lv) + 8, avg: 4 + (a.level ?? lv) * 1.5 };
                        const canStrike = kind === "assault" ? inReach(a.rect, f.rect, a.reach ?? 5) : kind === "onslaught" ? inReach(a.rect, f.rect, (a.reach ?? 5) + 25) : false;
                        const v = canStrike ? strikeExpected(rs.bonus + 1, f.ac - 0, rs.avg + 1).expected : kind === "advance" && !inReach(a.rect, f.rect, a.reach ?? 5) && inReach(a.rect, f.rect, (a.reach ?? 5) + 25) ? 0.4 * strikeExpected(rs.bonus + 1, f.ac, rs.avg + 1).expected : 0;
                        if (v > 0 && (!bestAlly || v > bestAlly.v)) bestAlly = { a, f, v };
                    }
                    if (!bestAlly) return;
                    const r2 = rest(ctx.actions - anthemCost - 1, ctx.made, 1);
                    const evS = base + bestAlly.v + r2.ev;
                    push(`${name} with ${anthem.name}`, evS, [{ cost: 1 + anthemCost, text: `${name}, then ${stepText(1)}: ${nameOf(bestAlly.a)} uses its reaction to ${kind === "advance" ? "Stride" : kind === "assault" ? `Strike ${nameOf(bestAlly.f)}` : `Stride and Strike ${nameOf(bestAlly.f)}`} now (about ${Math.round(bestAlly.v)})` }, ...r2.steps], [`${nameOf(bestAlly.a)} spends its reaction on it.${has(actor, "shared-assault") && kind !== "advance" ? " Shared Assault: on a critical hit a second ally under the anthem reacts with a Strike too." : ""}`], 0.4);
                };
                shape("courageous-advance", "Courageous Advance", "advance");
                shape("courageous-assault", "Courageous Assault", "assault");
                shape("courageous-onslaught", "Courageous Onslaught", "onslaught");
                // Vigorous Anthem (14): temp HP for everyone it reaches, once a minute is enough
                if (has(actor, "vigorous-anthem") && ctx.actions >= anthemCost + 1 && !compUp(me, /vigorous anthem/i) && !allies.some((a) => compUp(a, /vigorous anthem/i))) {
                    const thp = 3 + cha;
                    const evV = base + 0.5 * thp * (who.length + 1) + rest(ctx.actions - anthemCost - 1, ctx.made, 1).ev;
                    push(`Vigorous Anthem with ${anthem.name}`, evV, [{ cost: 1 + anthemCost, text: `Vigorous Anthem, then ${stepText(1)}: you and they gain ${thp} temporary HP for a minute` }, ...rest(ctx.actions - anthemCost - 1, ctx.made, 1).steps], ["Temporary HP don't stack: once a minute is enough."], 0.3);
                }
                // When the cantrip beats the song: one ally about to attack is not enough
                const cantrip = rest(Math.min(2, ctx.actions), ctx.made, 0);
                if (cantrip.ev > 0 && cantrip.steps[0]?.text?.startsWith("Cast ")) {
                    const perAction = cantrip.ev / Math.max(1, cantrip.steps[0].cost);
                    if (perRound >= perAction) out.notes.push(`${anthem.name} first: with ${who.length} ${who.length === 1 ? "ally" : "allies"} about to Strike it's worth about ${Math.round(perRound)} for one action, more than an action of your best cantrip (about ${Math.round(perAction)}).`);
                    else out.notes.push(`An action of your best cantrip (about ${Math.round(perAction)}) beats ${anthem.name} this round (about ${Math.round(perRound)}): too few allies swinging at a foe they can hit. Sing when three or four of them are.`);
                }
            } else if (anthem && !allies.length) out.notes.push(`${anthem.name} needs allies within 60 feet to be worth the action; none are.`);
        }
    }

    // ---- Rallying Anthem: +1 AC and saves and physical resistance for everyone within 60 feet (2 actions' worth of
    // foe attacks per threatening foe). Worth more than the anthem when the foes hit harder than the party does.
    const rally = comp("rally");
    if (rally && ctx.actions >= Math.max(1, anthemCost) && upKey !== "rally") {
        const res = Math.floor(rank / 2);
        const side = [me, ...allies].filter((c) => c.hp > 0);
        let evR = 0;
        const hit = [];
        for (const f of foes) {
            const t = side.filter((c) => inReach(f.rect, c.rect, (f.reach ?? 5) + 25)).sort((x, y) => feetBetween(f.rect, x.rect) - feetBetween(f.rect, y.rect))[0];
            if (!t) continue;
            const rs = f.reactiveStrike ?? { bonus: lv + 8, avg: 4 + lv * 1.5 };
            const e = strikeExpected(rs.bonus, t.ac ?? 10 + lv + 5, rs.avg);
            const attacks = inReach(f.rect, t.rect, f.reach ?? 5) ? 2 : 1.5;
            evR += attacks * (0.1 * e.expected + res * e.hit);
            hit.push(t);
        }
        if (evR > 0) {
            const r = rest(ctx.actions - anthemCost, ctx.made, 0);
            const names = [...new Set(hit.map(nameOf))];
            push(`${rally.name}, then ${r.steps[0]?.text?.startsWith("Strike") ? "Strike" : r.ev > 0 ? "a cantrip" : "move"}`, evR + r.ev, [{ cost: anthemCost, text: `${rally.name}: +1 status to AC and saves${res ? ` and resistance ${res} to physical damage` : ""} for you and allies within 60 feet; ${hit.length} ${hit.length === 1 ? "foe is" : "foes are"} within a move of ${names.map((n) => (n === nameOf(me) ? "you" : n)).join(", ")}` }, ...r.steps], [`${rally.name} protects; ${anthem ? `${anthem.name} hurts. Pick the song for the side that's hitting harder this round.` : "it's your song when the foes hit harder than your side does."}${compNote()}`], 0.3);
            if (has(actor, "defensive-coordination") && me.shield && !me.shieldRaised) out.notes.push("Defensive Coordination (1 action before Rallying Anthem): you Raise a Shield and one ally under the anthem reacts to Raise theirs.");
        }
    }

    // ---- Dirge of Doom: frightened 1 to every foe within 30 feet, no save, and they can't shake it while they stay in the area
    const dirge = comp("dirge");
    if (dirge && ctx.actions >= Math.max(1, anthemCost) && upKey !== "dirge") {
        const inArea = foes.filter((f) => feetBetween(me.rect, f.rect) <= 30 && !(f.traits ?? []).includes("mindless"));
        const fresh = inArea.filter((f) => !f.conditions?.has?.("frightened"));
        const evD = fresh.length * worth(board, "frightened") + (inArea.length - fresh.length) * worth(board, "frightened") * 0.4;
        if (inArea.length) {
            const r = rest(ctx.actions - anthemCost, ctx.made, 0);
            push(`${dirge.name}, then ${r.steps[0]?.text?.startsWith("Strike") ? "Strike" : r.ev > 0 ? "a cantrip" : "move"}`, evD + r.ev, [{ cost: anthemCost, text: `${dirge.name}: frightened 1 (no save) to ${inArea.map(nameOf).join(", ")} within 30 feet; they can't drop below frightened 1 while they stay in it` }, ...r.steps],
                [`Frightened 1 is -1 to everything they roll and to their AC and DCs, for your whole side; no check, no save, no immunity after. ${fresh.length < inArea.length ? "A foe already frightened only keeps its fear. " : ""}Mindless foes are immune.${compNote()}`], 0.3);
            if (anthem && !symphony && !has(actor, "harmonize")) out.notes.push(`One composition at a time: ${dirge.name} or ${anthem.name}, not both, until ${muses.includes("maestro") ? "you have Harmonize (maestro, level 6)" : "Symphony of the Muse (level 20; Harmonize at 6 is the maestro's)"}.`);
        }
        else out.notes.push(`${dirge.name}: frightened 1 to every foe within 30 feet, no save. None are that close.`);
    }

    // ---- Harmonize (6): one action so the next composition keeps running when you cast another; Symphony of the Muse (20) frees it all
    const dirgePlan = out.plans.find((p) => p.title.startsWith(dirge?.name ?? "\u0000"));
    const anthemPlan = out.plans.find((p) => anthem && p.title.startsWith(anthem.name));
    if (anthem && dirge && dirgePlan && anthemPlan && ctx.actions >= 3 && upKey !== "anthem" && upKey !== "dirge") {
        const aRound = anthemRound(1);
        const dRound = dirgePlan.ev - rest(ctx.actions - anthemCost, ctx.made, 0).ev;
        if (symphony) {
            const r = rest(ctx.actions - 2 * anthemCost, ctx.made, 1);
            push(`${anthem.name} and ${dirge.name}`, aRound + dRound + r.ev, [{ cost: anthemCost, text: `${anthem.name}: +1 to attack and damage for your side within 60 feet` }, { cost: anthemCost, text: `${dirge.name}: frightened 1 to the foes within 30 feet` }, ...r.steps], ["Symphony of the Muse: every composition keeps running when you start another."], 0.5);
        } else if (has(actor, "harmonize") && aRound > 0 && dRound > 0) {
            push(`Harmonize ${anthem.name}, then ${dirge.name}`, 0.8 * aRound + dRound, [{ cost: 1, text: `Harmonize: your next composition keeps running when you cast another` }, { cost: anthemCost, text: `${anthem.name}: +1 to attack and damage for your side within 60 feet, harmonized` }, { cost: anthemCost, text: `${dirge.name}: frightened 1 to the foes within 30 feet` }], ["Next rounds: recast only the one that ended; the harmonized anthem lasts its own duration. Lingering on the harmonized one stretches it to 3 or 4 rounds."], 0.4);
        }
    }

    // ---- Allegro (14): one ally within 30 feet is quickened this round (Strike, Stride or Step)
    const allegro = comp("allegro");
    if (allegro && ctx.actions >= Math.max(1, anthemCost) && upKey !== "allegro") {
        let best = null;
        for (const a of (board.allies ?? []).filter((x) => inRange(x, 30))) {
            const f = near(a);
            if (!f || !inReach(a.rect, f.rect, (a.reach ?? 5) + 25)) continue;
            const rs = a.reactiveStrike ?? { bonus: (a.level ?? lv) + 8, avg: 4 + (a.level ?? lv) * 1.5 };
            // Its extra action is a third Strike at -10, or a Stride that lets its two Strikes happen: half a fresh Strike
            const v = Math.max(strikeExpected(rs.bonus - 10, f.ac, rs.avg).expected, inReach(a.rect, f.rect, a.reach ?? 5) ? 0 : 0.5 * strikeExpected(rs.bonus, f.ac, rs.avg).expected) + 0.5;
            if (!best || v > best.v) best = { a, f, v };
        }
        if (best) {
            const r = rest(ctx.actions - anthemCost, ctx.made, 0);
            push(`${allegro.name} on ${nameOf(best.a)}`, best.v + r.ev, [{ cost: anthemCost, text: `${allegro.name}: ${nameOf(best.a)} is quickened this round (an extra Strike, Stride or Step; about ${Math.round(best.v)})` }, ...r.steps], [`One ally, one round; ${anthem ? `${anthem.name} usually gives more when three allies are swinging` : "best on your hardest hitter"}.${compNote()}`], 0.3);
        }
    }

    // ---- Triple Time: +10 feet Speed for the side this round, a note when allies have ground to cross
    const triple = comp("triple");
    if (triple && foes.length) {
        const crossing = allies.filter((a) => a.hasMelee !== false && !foes.some((f) => inReach(a.rect, f.rect, a.reach ?? 5)) && foes.some((f) => feetBetween(a.rect, f.rect) <= 60));
        if (crossing.length >= 2) out.notes.push(`${triple.name}: +10 feet Speed for everyone within 60 feet this round; ${crossing.map(nameOf).join(" and ")} still have ground to cross to reach a foe.`);
    }
    // ---- Song of Strength, Silver's Refrain, House of Imaginary Walls: when, not plans
    if (comp("strength") && (board.allies ?? []).some((a) => (a.athletics ?? 0) >= lv + 5)) out.notes.push("Song of Strength: +1 status to Athletics and to DCs against Trip, Shove, Disarm and Reposition for your side; cast it on a round an ally means to Grapple or Trip.");
    if (comp("silver") && foes.some((f) => (f.traits ?? []).includes("devil"))) out.notes.push("Silver's Refrain: your allies' weapon Strikes count as silver this round, and a devil's dimension door into the area is counteracted. Devils are here.");
    if (comp("walls")) out.notes.push("House of Imaginary Walls (1 action, touch): a 10-foot invisible wall next to you that foes who saw the performance treat as solid; use it to close a corridor or cover a retreat.");

    // ---- Hymn of Healing (2 actions, 1 Focus Point, 30 feet): fast healing 2 per rank for 4 rounds, temp HP on the cast and each Sustain
    const hymn = comp("hymn");
    if (hymn && (fp ?? 0) > 0 && ctx.actions >= 2) {
        const per = 2 * rank;
        const hurt = [me, ...(board.allies ?? [])].filter((c) => c.hp > 0 && c.hp <= c.maxHp * 0.6 && feetBetween(me.rect, c.rect) <= 30 && !compUp(c, /hymn of healing/i)).sort((x, y) => (x.hp / x.maxHp) - (y.hp / y.maxHp));
        const t = hurt[0];
        if (t) {
            const missing = Math.max(0, t.maxHp - t.hp);
            const ev = 0.8 * Math.min(missing, per * 4) * 0.7 + 0.5 * per;
            push(`Hymn of Healing on ${t === me ? "yourself" : nameOf(t)}`, ev, [{ cost: 2, text: `Hymn of Healing on ${t === me ? "yourself" : nameOf(t)} (${t.hp}/${t.maxHp}): fast healing ${per} for 4 rounds, ${per} temporary HP now and each time you Sustain it` }],
                [`Sustain it (1 action) on rounds ${t === me ? "you're" : "they're"} still being hit, for the temporary HP; the fast healing runs either way.${has(actor, "effortless-concentration") ? " Effortless Concentration: the first Sustain each turn is free at the start of your turn." : ""} Focus Points: ${fp} left.${compNote()}`], 0.2);
        }
    }
    // ---- Soothing Ballad (14, maestro; 2 actions, 1 Focus Point): heal the side within 30 feet, or counteract fear or paralysis
    const ballad = comp("ballad");
    if (ballad && (fp ?? 0) > 0 && ctx.actions >= 2) {
        const avg = 4.5 * Math.max(7, rank);
        const side = [me, ...(board.allies ?? [])].filter((c) => c.hp > 0 && feetBetween(me.rect, c.rect) <= 30);
        const healed = side.reduce((s, c) => s + Math.min(avg, Math.max(0, c.maxHp - c.hp)), 0);
        const hurtOnes = side.filter((c) => c.hp <= c.maxHp * 0.7);
        if (healed >= avg * 0.8 || hurtOnes.length >= 2) {
            push(`Soothing Ballad: heal ${hurtOnes.length ? hurtOnes.map((c) => (c === me ? "yourself" : nameOf(c))).join(", ") : "your side"}`, 0.8 * healed, [{ cost: 2, text: `Soothing Ballad: about ${Math.round(avg)} HP to you and each ally within 30 feet, about ${Math.round(healed)} HP restored in all` }], [`One Focus Point for the whole side; ${fp} left.${compNote()}`], 0.3);
        }
        const scared = side.filter((c) => c.conditions?.has?.("frightened") || c.conditions?.has?.("paralyzed"));
        if (scared.length) out.notes.push(`Soothing Ballad can instead counteract fear or paralysis on your side within 30 feet: ${scared.map(nameOf).join(", ")}.`);
    }
    // ---- Symphony of the Unfettered Heart (10; 2 actions, 1 Focus Point, 30 feet): free an ally of grabbed, immobilized, paralyzed, restrained, slowed or stunned
    const symph = comp("symphony");
    if (symph && (fp ?? 0) > 0 && ctx.actions >= 2) {
        const conds = ["paralyzed", "restrained", "stunned", "grabbed", "immobilized", "slowed"];
        const held = [me, ...(board.allies ?? [])].map((c) => ({ c, cond: conds.find((k) => c.conditions?.has?.(k)) })).filter((x) => x.cond && x.c.hp > 0 && feetBetween(me.rect, x.c.rect) <= 30).sort((x, y) => worth(board, y.cond) - worth(board, x.cond));
        const top = held.slice(0, lv >= 17 ? 4 : 1);
        if (top.length) {
            // The effect's DC isn't known: a hard DC for a creature of your level is the guess (a foe's level is never read)
            const dc = standardDC(lv) + 2;
            const c = degreeChances(perf, dc);
            const odds = c.s + c.cs;
            const ev = top.reduce((s, x) => s + worth(board, x.cond) * 1.5, 0) * odds;
            push(`Symphony of the Unfettered Heart: free ${top.map((x) => (x.c === me ? "yourself" : nameOf(x.c))).join(", ")}`, ev, [{ cost: 2, text: `Symphony of the Unfettered Heart on ${top.map((x) => `${x.c === me ? "yourself" : nameOf(x.c)} (${x.cond})`).join(", ")}: Performance ${signed(perf)} to counteract, about ${pct(odds)} against a DC near ${dc}` }], [`A failure locks that effect out for a day. Focus Points: ${fp} left.${compNote()}`], 0.3);
        }
    }
    // ---- Fatal Aria (20; 1 action, 1 Focus Point, 30 feet): a foe of level 16 or lower dies; 17 dies under 51 HP; 18 and up takes 50
    // The odds use the estimate's level (the party's, or the GM's setting behind the scenes); the text never states a foe's level
    const aria = comp("aria");
    if (aria && (fp ?? 0) > 0 && ctx.actions >= 1) {
        for (const f of foes.filter((x) => feetBetween(me.rect, x.rect) <= 30)) {
            const L = f.level ?? lv;
            const ev = L <= 16 ? f.hp * 1.2 : L === 17 ? (f.hp <= 50 ? f.hp * 1.2 : f.hp) : Math.min(50, f.hp);
            push(`Fatal Aria on ${nameOf(f)}`, ev, [{ cost: 1, text: `Fatal Aria on ${nameOf(f)}, no save: a creature of level 16 or lower dies outright, level 17 dies at 50 HP or fewer (else drops to 0 and dying 1), and anything higher takes 50 damage and dies at 0 HP` }], ["Once a minute per target; it's immune after. Focus Points: " + fp + " left." + compNote()], 0.5);
        }
    }

    // ---- Reactions and free actions that spend a Focus Point: when they fire
    if (comp("counter") && (fp ?? 0) > 0) out.notes.push("Counter Performance (reaction, 1 Focus Point) fires when you or an ally within 60 feet rolls a save against an auditory or visual effect: everyone in 60 feet may use your Performance roll instead.");
    if (comp("ouroboros") && (fp ?? 0) > 0 && (board.downAllies ?? []).length) out.notes.push(`Ode to Ouroboros (reaction, 1 Focus Point, 60 feet): when a dying ally would die, they stay one step short of it. ${(board.downAllies ?? []).map(nameOf).join(", ")} ${(board.downAllies ?? []).length === 1 ? "is" : "are"} down.`);
    if (has(actor, "emotional-push")) out.notes.push("Emotional Push (reaction): when a foe fails its save against your emotion spell, it's off-guard to your next attack before the end of your next turn.");
    if (has(actor, "reflexive-courage") && anthem) out.notes.push(`Reflexive Courage (reaction, while under your ${anthem.name}): a melee Strike at a creature in your reach that uses an auditory effect, a manipulate or move action, a ranged attack, or leaves a square.`);
    if (has(actor, "triumphant-inspiration")) out.notes.push("Triumphant Inspiration (free): a critical hit with a melee Strike lets you cast a one-action composition cantrip on the spot.");
    if (has(actor, "ringmasters-introduction")) out.notes.push("Ringmaster's Introduction (reaction): when an ally's first turn of the fight begins, they're quickened for it (Stride, Strike, Demoralize, Feint or Perform).");
    if (has(actor, "call-and-response") && anthem) out.notes.push("Call and Response (1 action before a one-round composition): one ally under it can spend an action to keep it going a round, so you needn't recast.");
    if (has(actor, "in-tune") && (board.allies ?? []).some((a) => a.hp > 0 && feetBetween(me.rect, a.rect) > 60)) out.notes.push("In Tune (1 action before a composition): its emanation spreads from an ally within 60 feet instead of you; some of your allies are beyond 60 feet now.");
    if (has(actor, "directed-audience")) out.notes.push("Directed Audience: a composition's emanation can be a cone 10 feet larger (up to double); handy when the foes are all one way and you'd rather not catch them in a Dirge, or your allies are all ahead.");
    if (has(actor, "bard-weapon-expertise")) out.notes.push("Bard Weapon Expertise: your critical hits apply the weapon's critical specialization while a composition is running.");
    if (has(actor, "combat-reading") && foes.some((f) => f.estimated)) out.notes.push("Combat Reading (1 action, secret check): the GM tells you a foe's lowest save, highest weakness, an immunity or its highest resistance. Worth a first-round action on a foe that will take a while.");
    if (has(actor, "harmonize") && !symphony && anthem && dirge) out.notes.push("Harmonize (1 action): the next composition keeps running when you cast another, so an anthem and a Dirge can both be up.");
    if (lv >= 10 && has(actor, "quickened-casting")) { const top = Math.max(1, ...(board.spells ?? []).filter((sp) => !sp.cantrip && !sp.consumable && !(sp.traits ?? []).includes("focus")).map((sp) => sp.rank ?? 1)); out.notes.push(`Quickened Casting (free, once a day): a cantrip or a spell of rank ${Math.max(1, top - 2)} or lower costs one action less: two spells this turn, or a composition, a quickened spell and an action to spare.`); }
    if (eternal) out.notes.push("Eternal Composition: you're permanently quickened for one-action composition cantrips, and the one you performed while exploring is already up on round 1.");
    if (has(actor, "effortless-concentration") && !hymn) out.notes.push("Effortless Concentration: at the start of your turn one of your class spells is Sustained for free.");
    if (has(actor, "discordant-voice") && anthem) out.notes.push(`Discordant Voice: allies under your ${anthem.name} add 1d6 sonic to weapon and unarmed Strikes; the anthem plans count it.`);
    // Focus pool and the muse
    if (fp !== null) {
        const max = Number(actor?.system?.resources?.focus?.max) || 1;
        const spenders = ["lingering", "fortissimo", "hymn", "ballad", "symphony", "counter", "ouroboros", "aria"].map((k) => comp(k)?.name).filter(Boolean);
        if (fp <= 0) out.notes.push(`No Focus Points left: your composition cantrips still work, but ${spenders.length ? spenders.slice(0, 3).join(", ") + " and the other focus spells" : "the focus spells"} wait for a Refocus (10 minutes${has(actor, "inspirational-focus") ? ", which refills the whole pool" : ""}).`);
        else out.notes.push(`Focus Points: ${fp} of ${max}.${has(actor, "inspirational-focus") ? " A Refocus refills the whole pool." : ""}`);
    }
    if (muses.length) {
        const text = { maestro: "maestro: Lingering Composition at 1, Fortissimo Composition at 8, Soothing Ballad at 14 are its song", warrior: "warrior: Martial Performance at 1, Courageous Advance at 4, Defensive Coordination at 6, Reflexive Courage at 8, Courageous Assault at 10, Triumphant Inspiration at 14, Courageous Onslaught at 16 are its feats", enigma: "enigma: Bardic Lore at 1, Loremaster's Etude at 2, Assured Knowledge at 6, True Hypercognition at 14 are knowledge, not combat math", polymath: "polymath: Versatile Performance at 1 and the Esoteric Polymath line are spell flexibility, not combat math", zoophonia: "zoophonia: animal messages and Songbird's Call" };
        out.notes.push(`Muse${muses.length > 1 ? "s" : ""}: ${muses.map((m) => text[m] ?? m).join("; ")}.`);
    }
    if (has(actor, "deep-lore") || has(actor, "studious-capacity")) out.notes.push(`${[has(actor, "deep-lore") ? "Deep Lore" : null, has(actor, "studious-capacity") ? "Studious Capacity (one spell a day past your slots, not top rank)" : null].filter(Boolean).join(" and ")}: more spells, no change to any turn.`);
}

export { bard };
