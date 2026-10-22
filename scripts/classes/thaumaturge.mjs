/**
 * PF2e Tactics: classes/thaumaturge.mjs
 * See classes/_common.mjs for the shape of a class read.
 * Gate: class thaumaturge, or the exploit-vulnerability feature (Thaumaturge Dedication grants it at 4th).
 * Reads: Exploit Vulnerability (the Esoteric Lore check against a standard DC for the foe's level, estimated from the
 * party's; personal antithesis 2 + half level, or a known weakness), the implements held (amulet, bell, chalice, lantern,
 * mirror, regalia, shield, tome, wand, weapon) with their initiate, adept, paragon and Intensify Vulnerability benefits,
 * Drink from the Chalice, Mirror's Reflection, Fling Magic, Divine Disharmony, Root to Life, Twin Weakness,
 * Cursed Effigy, Share/Ubiquitous Weakness, Unlimited Esoterica, Implement's Assault, and when-notes for the rest.
 */
import { bestStrike, canMove, castable, effect, focusLeft, has, half, level, markOffGuard, moveText, myReach, allySpeed, pct, squareToReach, strikeRun, targets, worth, degreeChances, feetBetween, inReach, mapFor, strikeExpected, saveExpected, CONDITION_VALUE, nameOf, reachableSquares, signed } from "./_common.mjs";

/** Standard DC by level (GM Core), for the Exploit Vulnerability check against a creature of that level. */
const DC_BY_LEVEL = [14, 15, 16, 18, 19, 20, 22, 23, 24, 26, 27, 28, 30, 31, 32, 34, 35, 36, 38, 39, 40, 42, 44, 46, 48, 50];
const standardDc = (lv) => DC_BY_LEVEL[Math.max(0, Math.min(25, Math.round(lv)))];
const IMPLEMENTS = ["amulet", "bell", "chalice", "lantern", "mirror", "regalia", "shield", "tome", "wand", "weapon"];

function thaumaturge(board, ctx, out) {
    const actor = board.me.actor;
    if (!has(actor, "exploit-vulnerability")) return;
    const lv = level(board);
    const me = board.me;
    const extra = 2 + Math.floor(lv / 2);
    const up = effect(actor, /exploit-vulnerability|personal-antithesis|mortal-weakness/);
    const intensified = !!effect(actor, /intensify-vulnerability/);
    const lore = actor.skills?.["esoteric-lore"]?.mod ?? actor.skills?.esotericLore?.mod ?? Object.values(actor.skills ?? {}).find((s) => /esoteric/i.test(s.label ?? ""))?.mod ?? lv + 4;
    const classDc = actor.classDC?.value ?? actor.system?.attributes?.classDC?.value ?? 10 + lv + 4;
    const foes = targets(board).filter((f) => f.hp > 0);
    const reach = myReach(board);
    const held = IMPLEMENTS.filter((i) => has(actor, i));
    const adept = (i) => has(actor, `adept-benefit-${i}`) || has(actor, `${i}-adept`) || (held.length === 1 && lv >= 7 && has(actor, "implement-adept")) || (held.length === 2 && lv >= 11 && has(actor, "second-adept") && has(actor, "implement-adept"));
    const paragon = (i) => has(actor, `paragon-benefit-${i}`) || has(actor, `${i}-paragon`) || (held.length === 1 && has(actor, "implement-paragon"));
    const canIntensify = has(actor, "intensify-vulnerability") || has(actor, "third-implement");
    const freeEV = has(actor, "unlimited-esoterica");
    const evCost = freeEV ? 0 : 1;
    const hurt = (c) => Math.max(0, (c.maxHp ?? 0) - (c.hp ?? 0));
    const dcFor = (f) => standardDc(f.level ?? lv);
    const chance = (f) => { const c = degreeChances(lore, dcFor(f)); return { ok: c.s + c.cs, crit: c.cs }; };
    const weakText = (f) => { const w = (f.iwr?.weak ?? []).sort((a, b) => b.value - a.value)[0]; return w && w.value > extra ? ` (mortal weakness: its weakness ${w.value} to ${w.type} on every Strike instead)` : ""; };
    // The foe being exploited, if the effect names it; otherwise unknown
    const upTarget = up ? foes.find((f) => f.id && (String(up.system?.context?.target?.token ?? "").includes(f.id) || String(up.system?.context?.target?.actor ?? "").includes(f.actorId ?? "\u0000"))) ?? null : null;

    // --- Exploit Vulnerability, then Strike -------------------------------------------------------------------------
    if (up) out.notes.push(`Exploit Vulnerability is up${upTarget ? ` on ${nameOf(upTarget)}` : ""}: your Strikes against that creature deal +${extra} (personal antithesis), or its weakness if that's higher.${intensified ? " Intensify Vulnerability is up too." : ""}`);
    else if (ctx.actions < 1 + evCost) out.notes.push(`Exploit Vulnerability (${freeEV ? "free action" : "1 action"}, Esoteric Lore ${signed(lore)}): +${extra} damage on every Strike against that creature until you use it again.`);
    const weaponBonus = (f) => (held.includes("weapon") && canIntensify && (intensified && upTarget === f) ? 2 : 0);
    if (!up && ctx.actions >= 1 + evCost) {
        for (const f of foes) {
            const sq = squareToReach(board, f, reach, ctx.actions - 1 - evCost);
            if (!sq) continue;
            const left = ctx.actions - evCost - sq.route.actions;
            if (left < 1) continue;
            const c = chance(f);
            const steps = [{ cost: evCost, text: `Exploit Vulnerability on ${nameOf(f)} (Esoteric Lore ${signed(lore)} against about DC ${dcFor(f)}: ${pct(c.ok)} to learn its weaknesses; even a failure gives +${extra} on your Strikes against it)${weakText(f)}${held.includes("shield") && lv >= 5 ? "; your shield implement lets you Raise a Shield with it for free" : ""}` }];
            if (sq.route.actions) steps.push({ cost: sq.route.actions, text: moveText(sq, f) });
            const run = strikeRun(board, f, left, { made: ctx.made, extra });
            if (!run.used.length) continue;
            steps.push({ cost: run.used.length, text: `${run.text}; +${extra} on each hit` });
            const notes = [];
            if (has(actor, "esoteric-warden")) notes.push(`Esoteric Warden: on a success you also get +1 AC against its next attack and +1 to your next save against it (+2 on a critical success).`);
            if (has(actor, "breached-defenses") && (f.iwr?.resist ?? []).length) notes.push(`Breached Defenses: on a success you can pick its ${f.iwr.resist.map((r) => r.type).join("/")} resistance for your Strikes to bypass instead of the usual benefit.`);
            if (held.includes("regalia") && canIntensify) notes.push("Regalia (Intensify): a hit on the exploited creature gives an ally you see +1 to attack it until your next turn, +2 on a critical hit.");
            if (has(actor, "diverse-lore")) notes.push("Diverse Lore: a good enough Esoteric Lore result also tells you what a Recall Knowledge check would.");
            out.plans.push({ kind: "class", title: `Exploit ${nameOf(f)}, then Strike`, target: f, ev: run.ev, score: run.ev + 0.3, dest: sq.route.actions ? { x: sq.x, y: sq.y } : null, steps, notes });
        }
    }
    // --- Exploit is up: Intensify Vulnerability then Strike, Twin Weakness, Cursed Effigy -------------------------
    if (up && ctx.actions >= 1) {
        const tgts = upTarget ? [upTarget] : foes;
        for (const f of tgts) {
            const sq = squareToReach(board, f, reach, ctx.actions - 1);
            if (!sq) continue;
            let left = ctx.actions - sq.route.actions;
            const steps = [];
            if (sq.route.actions) steps.push({ cost: sq.route.actions, text: moveText(sq, f) });
            let acAdj = 0, ev = 0;
            const note = [];
            if (canIntensify && !intensified && left >= 1 + (freeEV ? 0 : 1) && held.length) {
                const parts = [];
                if (held.includes("weapon")) { parts.push("weapon: +2 status to attack rolls against it"); acAdj = -2; }
                if (held.includes("tome")) parts.push("tome: roll a d20 now and keep it for any Strike against it before your next turn");
                if (held.includes("mirror")) parts.push("mirror: you're concealed from it");
                if (held.includes("amulet")) parts.push("amulet: Amulet's Abeyance also covers persistent damage and allies within 15 feet");
                if (held.includes("bell")) parts.push("bell: a hit on it gives -2 to its saves against Ring Bell (-3 on a crit)");
                if (held.includes("chalice")) parts.push("chalice: within 30 feet of it, a sip gives +" + lv + " more temporary HP, a drain " + 2 * lv + " more HP");
                if (held.includes("lantern")) parts.push("lantern: its aura doubles, it gets -2 to Deception and Stealth in it and can't be concealed");
                if (held.includes("regalia")) parts.push("regalia: each hit gives an ally +1 to attack it");
                if (held.includes("wand")) parts.push(`wand: Fling Magic against it deals +${lv}`);
                if (held.includes("shield")) parts.push("shield: your raised shield also gives its bonus to saves against it");
                steps.push({ cost: freeEV ? 0 : 1, text: `Intensify Vulnerability on ${nameOf(f)} (${freeEV ? "free action" : "1 action"}; ${parts.join("; ")})` });
                left -= freeEV ? 0 : 1;
                ev += 0.5;
            }
            if (has(actor, "twin-weakness") && left >= 2) {
                const b = bestStrike(board, f, { made: ctx.made, extra, acAdj });
                if (b) {
                    const bonus = (1 - degreeChances(b.bonus, f.ac + acAdj).cf) * extra;
                    steps.push({ cost: 2, text: `Twin Weakness: Strike ${nameOf(f)} with ${b.s.label} (${signed(b.bonus)}); unless it's a critical failure, your implement also deals the +${extra} on its own` });
                    ev += b.e.expected + bonus; left -= 2;
                    const rest = strikeRun(board, f, left, { made: ctx.made + 2, extra, acAdj });
                    if (rest.used.length) { steps.push({ cost: rest.used.length, text: `${rest.text}; +${extra} on each hit` }); ev += rest.ev; }
                }
            } else {
                const run = strikeRun(board, f, left, { made: ctx.made, extra, acAdj });
                if (!run.used.length) continue;
                steps.push({ cost: run.used.length, text: `${run.text}; +${extra} on each hit` });
                ev += run.ev;
            }
            if (has(actor, "cursed-effigy") && left >= 1) note.push(`Cursed Effigy (1 action, right after a Strike that hits with physical damage): ${nameOf(f)} takes -2 to saves against your class DC while it's exploited.`);
            if (steps.some((s) => /Intensify|Twin/.test(s.text))) out.plans.push({ kind: "class", title: `${steps.some((s) => /Intensify/.test(s.text)) ? "Intensify" : "Twin Weakness"} on ${nameOf(f)}`, target: f, ev, score: ev + 0.3, dest: sq.route.actions ? { x: sq.x, y: sq.y } : null, steps, notes: note });
        }
    }

    // --- Chalice: a sip for temporary HP, a drain for a real heal, on you or an adjacent ally -------------------------
    if (held.includes("chalice") && ctx.actions >= 1) {
        const sip = Math.max(3, lv) + (intensified && held.includes("chalice") ? lv : 0);
        const drainHp = 3 * lv + (intensified ? 2 * lv : 0);
        const drained = !!effect(actor, /chalice-drained|drink-from-the-chalice|drained-chalice/);
        const cands = [me, ...(board.allies ?? []).filter((a) => a.hp > 0 && inReach(me.rect, a.rect, 5))];
        for (const c of cands) {
            const missing = hurt(c);
            const useDrain = !drained && missing >= Math.max(6, drainHp * 0.6);
            const heal = useDrain ? Math.min(missing, drainHp) : sip;
            const ev = useDrain ? 0.8 * heal : 0.4 * sip;
            if (!useDrain && missing < 1 && c !== me) continue;
            const who = c === me ? "you" : nameOf(c);
            const steps = [{ cost: 1, text: `Drink from the Chalice, ${useDrain ? "drain" : "sip"}, for ${who}: ${useDrain ? `heals ${drainHp} HP (${who === "you" ? "you're" : `${who} is`} down ${missing}); the chalice refills in 10 minutes` : `${sip} temporary HP until the end of your next turn`}` }];
            const f = foes.filter((x) => inReach(me.rect, x.rect, reach))[0];
            let total = ev;
            if (f && ctx.actions >= 2) { const run = strikeRun(board, f, ctx.actions - 1, { made: ctx.made, extra: up ? extra : 0 }); if (run.used.length) { steps.push({ cost: run.used.length, text: run.text }); total += run.ev; } }
            if (ev >= 2) out.plans.push({ kind: "class", title: `${useDrain ? "Drain" : "Sip from"} the chalice for ${who}`, target: f ?? null, ev: total, score: total + 0.2, dest: null, steps, notes: adept("chalice") ? ["Chalice (adept): its healing is more generous, and a drain also lets the drinker shrug off something that ails them."] : [] });
        }
        out.notes.push(`Drink from the Chalice (1 action, once a round, you or an adjacent ally): a sip gives ${sip} temporary HP, a drain heals ${drainHp} HP once per 10 minutes${paragon("chalice") ? "; as a paragon implement it refills faster" : ""}.`);
    }

    // --- Mirror: a second self within 15 feet, to reach a foe without moving or to flank it with yourself -----------
    if (held.includes("mirror") && ctx.actions >= 2) {
        const free = (x, y) => !board.occupant?.get?.(`${x},${y}`) && (!board.field?.land || board.field.land.has(`${x},${y}`));
        for (const f of foes) {
            const near = inReach(me.rect, f.rect, reach);
            const flanked = f.conditions?.has?.("off-guard");
            let sq = null, why = "";
            if (near && !flanked) {
                // the square straight across the foe from you
                const cx = f.rect.x + (f.rect.x - me.rect.x) + (f.rect.w - 1) * Math.sign(f.rect.x - me.rect.x), cy = f.rect.y + (f.rect.y - me.rect.y) + (f.rect.h - 1) * Math.sign(f.rect.y - me.rect.y);
                if (free(cx, cy) && feetBetween(me.rect, { x: cx, y: cy, w: 1, h: 1 }) <= 15) { sq = { x: cx, y: cy }; why = "flank"; }
            } else if (!near && ctx.actions >= 2) {
                const cands = [];
                for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) { const x = me.rect.x + dx, y = me.rect.y + dy; if ((dx || dy) && free(x, y) && feetBetween(me.rect, { x, y, w: 1, h: 1 }) <= 15 && inReach({ ...me.rect, x, y }, f.rect, reach)) cands.push({ x, y }); }
                if (cands.length) { sq = cands[0]; why = "reach"; }
            }
            if (!sq) continue;
            const acAdj = why === "flank" ? -2 : 0;
            const run = strikeRun(board, f, ctx.actions - 1, { made: ctx.made, extra: up ? extra : 0, acAdj });
            if (!run.used.length) continue;
            const ev = run.ev + (why === "flank" ? 0.5 : 0.3);
            out.plans.push({ kind: "class", title: `Mirror's Reflection: ${why === "flank" ? `flank ${nameOf(f)} with yourself` : `reach ${nameOf(f)} without moving`}`, target: f, ev, score: ev + 0.3, dest: null, steps: [{ cost: 1, text: `Mirror's Reflection: put your reflection in the square ${why === "flank" ? `across ${nameOf(f)} from you (${nameOf(f)} is then flanked, off-guard to you)` : `next to ${nameOf(f)}`}; you're in both places until your next turn` }, { cost: run.used.length, text: `${run.text}${why === "flank" ? " (off-guard)" : ", from the reflection"}` }], notes: ["Anything that targets your reflection hits you; when one of you is affected, the effect hits you once."] });
        }
        if (adept("mirror")) out.notes.push("Mirror (adept): when your reflection takes a hit meant for you, you can let it shatter and reform elsewhere, and a foe that attacks the wrong one is fooled until it Seeks.");
    }

    // --- Wand: Fling Magic, 2 actions at 60 feet, a basic save against your class DC ---------------------------------
    if (held.includes("wand") && ctx.actions >= 2) {
        const dice = 1 + Math.floor(Math.max(0, lv - 1) / 2);
        const boosted = !effect(actor, /wand-discharged|fling-magic-boost|wand-boost/);
        const avg = dice * (boosted ? 3.5 : 2.5);
        for (const f of foes.filter((x) => feetBetween(me.rect, x.rect) <= 60)) {
            const bonus = intensified && upTarget === f ? lv : 0;
            const sv = saveExpected(f.saves?.reflex ?? lv + 5, classDc, avg + bonus, { basic: true });
            let ev = sv.expected;
            const steps = [];
            let cost = 2;
            if (!up && ctx.actions >= 2 + evCost && canIntensify === false) { /* no room for Exploit and Intensify both */ }
            if (up && upTarget === f && canIntensify && !intensified && ctx.actions >= 3 && held.includes("wand")) { steps.push({ cost: freeEV ? 0 : 1, text: `Intensify Vulnerability (wand): Fling Magic against ${nameOf(f)} deals +${lv}` }); cost += freeEV ? 0 : 1; ev = saveExpected(f.saves?.reflex ?? lv + 5, classDc, avg + lv, { basic: true }).expected; }
            steps.push({ cost: 2, text: `Fling Magic at ${nameOf(f)} (60 feet): ${dice}d${boosted ? 6 : 4}${bonus || steps.length ? ` +${lv}` : ""} ${boosted ? "boosted, " : ""}basic Reflex against DC ${classDc} (fails about ${pct(sv.fail)})${boosted ? "; the boost recharges at the end of your next turn" : ""}` });
            if (!up && ctx.actions >= cost + evCost) { steps.push({ cost: evCost, text: `Exploit Vulnerability on ${nameOf(f)} for the next turns (Esoteric Lore ${signed(lore)})` }); ev += 0.5; }
            out.plans.push({ kind: "class", title: `Fling Magic at ${nameOf(f)}`, target: f, ev, score: ev + 0.2, dest: null, steps, notes: adept("wand") ? ["Wand (adept): on a failed save the target also suffers a lingering effect of the wand's damage type."] : [] });
        }
    }

    // --- Divine Disharmony: off-guard to you from 60 feet with Deception or Intimidation ------------------------------
    if (has(actor, "divine-disharmony") && ctx.actions >= 2) {
        const dec = actor.skills?.deception?.mod ?? lv + 3, intim = actor.skills?.intimidation?.mod ?? lv + 3;
        const mod = Math.max(dec, intim), skill = dec >= intim ? "Deception" : "Intimidation";
        for (const f of foes.filter((x) => feetBetween(me.rect, x.rect) <= 60 && !x.conditions?.has?.("off-guard"))) {
            const sq = squareToReach(board, f, reach, ctx.actions - 2);
            if (!sq) continue;
            const left = ctx.actions - 1 - sq.route.actions;
            if (left < 1) continue;
            const c = degreeChances(mod, 10 + (f.saves?.will ?? lv + 5));
            const p = c.s + c.cs;
            const hit = strikeRun(board, f, left, { made: ctx.made, extra: up ? extra : 0, acAdj: -2 });
            const miss = strikeRun(board, f, left, { made: ctx.made, extra: up ? extra : 0 });
            if (!hit.used.length) continue;
            const ev = p * hit.ev + (1 - p) * miss.ev;
            const steps = [{ cost: 1, text: `Divine Disharmony on ${nameOf(f)} (${skill} ${signed(mod)} against its Will DC, about ${pct(p)}; +2 if it's devout): off-guard to you this turn, until your next turn on a critical success` }];
            if (sq.route.actions) steps.push({ cost: sq.route.actions, text: moveText(sq, f) });
            steps.push({ cost: hit.used.length, text: `${hit.text} (off-guard if the display worked)` });
            out.plans.push({ kind: "class", title: `Divine Disharmony on ${nameOf(f)}`, target: f, ev, score: ev + 0.2, dest: sq.route.actions ? { x: sq.x, y: sq.y } : null, steps, notes: [] });
        }
    }

    // --- Root to Life: a dying ally next to you -------------------------------------------------------------------
    if (has(actor, "root-to-life") && ctx.actions >= 1) {
        for (const d of (board.downAllies ?? []).filter((d) => (d.hp <= 0 || d.conditions?.has?.("dying")) && inReach(me.rect, d.rect, 5))) {
            const ev = 6 + lv;
            out.plans.push({ kind: "class", title: `Root to Life: stabilize ${nameOf(d)}`, target: null, ev, score: ev + 0.3, dest: null, steps: [{ cost: ctx.actions >= 2 ? 2 : 1, text: `Root to Life on ${nameOf(d)}: no longer dying, at 0 HP${ctx.actions >= 2 ? "; with 2 actions, DC 10 flat checks end each persistent damage on them" : ""}` }], notes: [] });
        }
    }

    // --- Implements held: what each does this turn ----------------------------------------------------------------
    const impl = [];
    if (held.includes("amulet")) impl.push(`Amulet's Abeyance fires when the exploited creature would damage you or an ally within 15 feet: resistance ${2 + lv} to that damage${adept("amulet") ? "; adept: the resistance lasts until your next turn" : ""}${paragon("amulet") ? "; paragon: it covers any creature's damage" : ""}`);
    if (held.includes("bell")) impl.push(`Ring Bell fires when the exploited creature within 30 feet Strikes or Casts a Spell at you or an ally: a save against DC ${classDc} or the Strike is hampered, or the caster is stupefied 1 until your next turn${adept("bell") ? "; adept: a failed save also costs it its reaction" : ""}`);
    if (held.includes("lantern")) impl.push(`Lantern: within its 20-foot light you get +1 status to Perception, and hidden or illusory things in it stand out when you Seek${adept("lantern") ? "; adept: creatures in the light can't be concealed by dim light or magic" : ""}`);
    if (held.includes("regalia")) impl.push(`Regalia: +1 status to Deception, Diplomacy and Intimidation, and allies within 15 feet get +1 status to saves against fear${adept("regalia") ? "; adept: the aura reaches 30 feet and also steadies allies against mental effects" : ""}${paragon("regalia") ? "; paragon: allies in the aura get +1 status to attack rolls" : ""}`);
    if (held.includes("shield")) impl.push(`Shield: Shield Block, and from 5th Exploit Vulnerability also Raises your Shield; it never drops below 1 HP${adept("shield") ? "; adept: Shield Block also protects an adjacent ally" : ""}`);
    if (held.includes("tome")) impl.push(`Tome: +${paragon("tome") ? 2 : 1} circumstance to Recall Knowledge${adept("tome") ? `, and at the start of each turn a free Recall Knowledge (Esoteric Lore ${signed(lore)}) about a creature you see: on a success +1 to your next attack against it${paragon("tome") ? ", to every attack until your next turn" : ""}` : ""}`);
    if (held.includes("weapon")) impl.push(`Implement's Interruption fires when the exploited creature uses a concentrate, manipulate or move action in your reach: a free Strike at full bonus, and a critical hit disrupts the action${adept("weapon") ? "; adept: it also fires when the creature Strikes, and the Strike deals extra damage" : ""}`);
    if (held.includes("wand")) impl.push(`Wand: Fling Magic (2 actions, 60 feet, ${1 + Math.floor(Math.max(0, lv - 1) / 2)}d4 or d6 boosted, basic Reflex DC ${classDc})`);
    if (held.includes("mirror") && ctx.actions < 2) impl.push("Mirror's Reflection (1 action): a second self within 15 feet, to Strike or flank from until your next turn");
    if (impl.length) out.notes.push(`Implements: ${impl.join(". ")}.`);
    if (has(actor, "second-implement") && held.length >= 2) out.notes.push("Second Implement: swap the implement in your hand for a worn one as a free Interact right before using its action.");
    if (has(actor, "esoteric-reflexes")) out.notes.push("Esoteric Reflexes: a second reaction each turn, for your implements' reactions only.");
    if (has(actor, "implement-s-empowerment") || has(actor, "implements-empowerment")) out.notes.push("Implement's Empowerment (+2 per weapon die) needs your hands clear: one one-handed weapon, implements and esoterica, nothing else.");
    if (has(actor, "scroll-thaumaturgy")) out.notes.push(`Scroll Thaumaturgy: you can activate any scroll, at your class DC ${classDc}, from the hand holding an implement.`);
    if (has(actor, "scroll-esoterica")) out.notes.push(`Scroll Esoterica: your daily temporary scrolls (rank 1${lv >= 8 ? ", 2" : ""}${has(actor, "elaborate-scroll-esoterica") ? `, 3${lv >= 14 ? ", 4" : ""}${lv >= 16 ? ", 5" : ""}` : ""}${has(actor, "grand-scroll-esoterica") ? `, ${lv >= 20 ? 7 : 6}` : ""}) are spells the advisor can plan once they're on your sheet.`);
    if (has(actor, "share-weakness") && up) out.notes.push("Share Weakness (1 action, mortal weakness up): an adjacent ally's Strikes apply the weakness too, until your Exploit ends.");
    if (has(actor, "ubiquitous-weakness")) out.notes.push("Ubiquitous Weakness: when you Exploit with mortal weakness, every ally within 30 feet applies the weakness on their Strikes.");
    if (has(actor, "sympathetic-vulnerabilities") && up) out.notes.push("Sympathetic Vulnerabilities: a mortal weakness applies to every creature with that weakness; a personal antithesis on a non-humanoid applies to all of its exact kind.");
    if (has(actor, "instructive-strike")) out.notes.push("Instructive Strike (1 action): a Strike that hits also lets you Recall Knowledge about the target (+2 on a critical hit).");
    if (has(actor, "sever-magic") && ctx.actions >= 2) out.notes.push(`Sever Magic (2 actions): a Strike that damages also counteracts one spell on the target, at half your level with a modifier of ${classDc - 10}.`);
    if (has(actor, "implement-s-assault") && ctx.actions >= 3 && foes.filter((f) => feetBetween(me.rect, f.rect) <= 30).length >= 2) {
        const near = foes.filter((f) => feetBetween(me.rect, f.rect) <= 30);
        let ev = 0;
        for (const f of near) { const b = bestStrike(board, f, { made: ctx.made, melee: !board.strikes.every((s) => s.ranged), extra: up && (!upTarget || upTarget === f) ? extra : 0 }) ?? bestStrike(board, f, { made: ctx.made, melee: false }); if (b) ev += b.e.expected; }
        if (ev > 0) out.plans.push({ kind: "class", title: `Implement's Assault on ${near.length} foes`, target: near[0], ev, score: ev + 0.3, dest: null, steps: [{ cost: 3, text: `Implement's Assault: one Strike at full bonus against each of ${near.map(nameOf).join(", ")}; a melee weapon flies out and returns` }], notes: [] });
    }
    if (has(actor, "trespass-teleportation") && up) out.notes.push("Trespass Teleportation fires when the exploited creature within 120 feet teleports: you go with it.");
    if (has(actor, "implement-s-flight")) out.notes.push("Implement's Flight: you fly at your land Speed while holding an implement.");
    if (has(actor, "wonder-worker")) out.notes.push("Wonder Worker (once a day): cast any common spell of 8th rank or lower from a tradition whose skill you're legendary in, at your class DC.");
    if (has(actor, "unlimited-esoterica")) out.notes.push("Unlimited Esoterica: Exploit Vulnerability and Intensify Vulnerability are free actions, once a round each.");
    if (has(actor, "turn-away-misfortune")) out.notes.push("Turn Away Misfortune fires when a misfortune effect would touch your roll: it cancels out.");
    if (has(actor, "one-more-activation")) out.notes.push("One More Activation (once a day): an invested item's daily activation once more, if its level is half yours or lower.");
}

export { thaumaturge };
