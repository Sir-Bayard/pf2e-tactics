/**
 * PF2e Tactics: classes/gunslinger.mjs
 * See classes/_common.mjs for the shape of a class read.
 * Reads the reload economy of firearms and crossbows (a Strike spends the shot; the next needs an Interact, or the way's
 * slinger's reload, which also does its skill action), the way's reload and deeds (Drifter, Pistolero, Sniper, Spellshot,
 * Vanguard, Triggerbrand), the flourishes and two-weapon shots (Paired Shots, Twin Shot Knockdown, Two-Weapon Fusillade,
 * Risky Reload, Drifter's Juke, Bullet Split, Penetrating Fire, Called Shot, Sniper's Aim, Pistol Twirl, Alchemical Shot,
 * Scatter Blast, Headshot, Blast Tackle, Dance of Thunder, Final Shot, Pistolero's Challenge, Triggerbrand Salvo and
 * Stab and Blast, Flesh Wound), and the crit math of fatal weapons (Fatal Bullet, Piercing Critical). The rest are when-notes.
 * The loaded state of each weapon comes from the PF2e Ranged Combat module when it's active; otherwise every weapon is
 * assumed loaded at the start of the turn, and the read says so.
 */
import { canMove, effect, focusLeft, has, hasAny, level, markOffGuard, moveText, myReach, pct, slugOf, squareToReach, targets, usesLeft, worth, degreeChances, feetBetween, inReach, mapFor, strikeExpected, saveExpected, nameOf, reachableSquares, signed } from "./_common.mjs";

const abil = (actor, k) => Number(actor?.abilities?.[k]?.mod ?? actor?.system?.abilities?.[k]?.mod) || 0;
const skill = (board, k) => { const sk = board.me.actor?.skills?.[k]; const mod = sk?.mod ?? board.me[k]; return mod == null ? null : { mod: Number(mod) || 0, rank: sk?.rank ?? (sk?.proficient ? 1 : 0), label: sk?.label ?? k[0].toUpperCase() + k.slice(1) }; };
const usageOf = (s) => String(s.hands ?? s.item?.system?.usage?.value ?? "");
const twoHanded = (s) => usageOf(s) === "2" || /two-hands/.test(usageOf(s));
const dieOf = (s) => Number(String(s.die ?? s.item?.system?.damage?.die ?? "").replace("d", "")) || 0;
const dieAvg = (s) => { const d = dieOf(s); return d ? (d + 1) / 2 : 3.5; };
const diceOf = (s) => Number(s.dice ?? s.item?.system?.damage?.dice) || 1;
const groupOf = (s) => String(s.group ?? s.item?.group ?? s.item?.system?.group ?? "");
const traitNum = (s, re) => { const t = (s.traits ?? []).find((x) => re.test(x)); const m = t && /(\d+)$/.exec(t); return m ? Number(m[1]) : 0; };
const round = () => globalThis.game?.combat?.round ?? 2;
const strikeText = (f, used) => `Strike ${nameOf(f)} with ${used[0].label}${used.length > 1 ? ` ${used.length === 2 ? "twice" : "three times"}` : ""} (${used.map((u) => signed(u.bonus)).join(", ")})`;
/** Range increments past the first: -2 each. */
const rangeSteps = (dist, inc) => (inc > 0 && dist > inc ? Math.ceil(dist / inc) - 1 : 0);

/** The way, from the way feature or the actions it grants (a dedication grants the way feature but not its deeds). */
function wayOf(actor) {
    if (hasAny(actor, "way-of-the-drifter") || hasAny(actor, "reloading-strike")) return "drifter";
    if (hasAny(actor, "way-of-the-pistolero") || hasAny(actor, "raconteurs-reload", "raconteur-s-reload")) return "pistolero";
    if (hasAny(actor, "way-of-the-sniper") || hasAny(actor, "covered-reload")) return "sniper";
    if (hasAny(actor, "way-of-the-spellshot") || hasAny(actor, "thoughtful-reload")) return "spellshot";
    if (hasAny(actor, "way-of-the-vanguard") || hasAny(actor, "clear-a-path")) return "vanguard";
    if (hasAny(actor, "way-of-the-triggerbrand") || hasAny(actor, "touch-and-go")) return "triggerbrand";
    return null;
}
const WAY_RELOAD = { drifter: "reloading-strike", pistolero: "raconteurs-reload", sniper: "covered-reload", spellshot: "thoughtful-reload", vanguard: "clear-a-path", triggerbrand: "touch-and-go" };
const WAY_RELOAD_NAME = { drifter: "Reloading Strike", pistolero: "Raconteur's Reload", sniper: "Covered Reload", spellshot: "Thoughtful Reload", vanguard: "Clear a Path", triggerbrand: "Touch and Go" };

/** Whether this weapon is loaded: the PF2e Ranged Combat module's effects when it runs, the strike's own flag, else assumed. */
function loadedState(actor, s) {
    if (typeof s.loaded === "boolean") return { loaded: s.loaded, known: true };
    const mod = globalThis.game?.modules?.get?.("pf2e-ranged-combat");
    if (!mod?.active) return { loaded: true, known: false };
    const id = s.id ?? s.item?.id;
    // Ranged Combat 8+: the loaded round is a sub-item of the weapon (type ammo, with uses left); earlier versions: a Loaded effect
    const subs = s.item?.system?.subitems ?? s.item?._source?.system?.subitems ?? [];
    const rounds = subs.filter((x) => x.type === "ammo" && (Number(x.system?.uses?.value ?? x.system?.quantity ?? 1) || 0) > 0);
    if (rounds.length) return { loaded: true, known: true };
    const effects = (actor?.items?.contents ?? actor?.items ?? []).filter?.((i) => i.type === "effect") ?? [];
    const mine = effects.filter((i) => { const fl = i.flags?.["pf2e-ranged-combat"]; return fl && (fl.targetId === id || fl.weaponId === id || (fl.name && fl.name === s.label)); });
    if (!mine.length) return { loaded: false, known: true };
    const loaded = mine.some((i) => /loaded|magazine|chamber/i.test(String(i.name ?? i.slug ?? "")) && !/unloaded|empty/i.test(String(i.name ?? "")));
    return { loaded, known: true };
}

function gunslinger(board, ctx, out) {
    const actor = board.me.actor;
    const me = board.me;
    const lv = level(board);
    const way = wayOf(actor);
    const classed = actor?.class?.slug === "gunslinger";
    if (!classed && !way && !hasAny(actor, "slingers-precision", "singular-expertise", "gunslingers-way", "gunslinger-dedication")) return;
    const foes = targets(board);
    const n = (t) => out.notes.push(t);
    const push = (plan) => out.plans.push({ kind: "class", dest: null, notes: [], ...plan, score: plan.ev + (plan.bias ?? 0.4) });
    const legend = lv >= 13 && (classed || hasAny(actor, "gunslinging-legend"));
    const fatalBullet = hasAny(actor, "fatal-bullet");
    const piercing = hasAny(actor, "piercing-critical") && legend;
    const unerring = hasAny(actor, "unerring-shot");
    const shootist = lv >= 17 && hasAny(actor, "shootists-edge", "shootist-s-edge");
    const crackShot = hasAny(actor, "crossbow-crack-shot");
    const fleshWound = hasAny(actor, "flesh-wound");
    const swordPistol = hasAny(actor, "sword-and-pistol");
    const dualReload = hasAny(actor, "dual-weapon-reload");
    const classDC = Number(actor?.classDC?.value) || 14 + lv;
    const gunSpec = lv >= 15 ? (legend ? 8 : 6) : lv >= 13 && legend ? 4 : lv >= 7 ? 3 : 0;
    const str = abil(actor, "str");

    // ---- the weapons: firearms and crossbows with their reload, hands, loaded state and crit extras
    let assumed = false;
    const guns = board.strikes.filter((s) => s.ranged && !s.thrown && ["firearm", "crossbow"].includes(groupOf(s)) || (s.ranged && (s.traits ?? []).some((t) => /^(?:fatal|concussive|scatter|kickback|combination)/.test(t)))).map((s) => {
        const st = loadedState(actor, s);
        if (!st.known) assumed = true;
        if (st.known && !st.loaded) s.empty = true; // the advisor's own ranged plans then open with the reload
        const fatalDie = traitNum(s, /^fatal-(?:\d+)?d\d+$/) || Number((/^fatal-(?:\d+)?d(\d+)$/.exec((s.traits ?? []).find((t) => /^fatal/.test(t)) ?? "") ?? [])[1]) || 0;
        const group = groupOf(s) || ((s.traits ?? []).some((t) => /^(?:fatal|concussive|scatter|kickback)/.test(t)) ? "firearm" : "crossbow");
        return {
            s, label: s.label, group, two: twoHanded(s), reload: Number(s.reload) || 0, loaded: st.loaded, loadedKnown: st.known,
            fatalDie, concussive: (s.traits ?? []).includes("concussive"), scatter: traitNum(s, /^scatter-\d+$/), kickback: (s.traits ?? []).includes("kickback"),
            combination: (s.traits ?? []).includes("combination"), repeating: (s.traits ?? []).includes("repeating"), range: s.range || 30,
            deadly: (s.deadly ?? 0) + (fatalBullet && fatalDie ? (fatalDie + 1) / 2 : 0),
            // precision the sheet already adds (Slinger's Precision), counted once on a paired shot
            precision: (s.traits ?? []).includes("repeating") ? 0 : group === "firearm" ? (legend ? 3.5 : 2.5) : (legend ? 3 : 2),
        };
    });
    const melee = board.strikes.filter((s) => !s.ranged);
    const melee1 = melee.filter((s) => !twoHanded(s));
    const oneHandGuns = guns.filter((w) => !w.two);
    const loadedGuns = guns.filter((w) => w.loaded);
    if (!guns.length) { if (classed) n("No firearm or crossbow Strike is ready: your reload tricks and deeds need one in hand."); return; }
    if (assumed) n(`Your weapons are assumed loaded at the start of the turn (the PF2e Ranged Combat module isn't tracking them): if ${guns.length === 1 ? guns[0].label : "one"} is empty, its first shot here is a reload instead.`);
    for (const w of guns) if (w.loadedKnown && !w.loaded) n(`${w.label} is empty: it needs ${w.reload > 1 ? `${w.reload} Interact actions` : "an Interact"} (or your slinger's reload) before it fires.`);

    /** Range penalty for a shot at dist feet with w: -2 an increment past the first, unless Unerring Shot or Shootist's Edge waives it. */
    const rangePen = (w, dist) => { const k = rangeSteps(dist, w.range); return unerring ? 0 : shootist && k <= 2 ? 0 : -2 * k; };
    const inRange = (w, at, f) => feetBetween(at, f.rect) <= w.range * 6;
    /**
     * A shot's expected damage, with Piercing Critical (a 19 that succeeds crits) and, for a plain shot taken as a Flesh Wound
     * (flesh: true, only from shootRun), its failure effect: a die plus specialization. Special shots aren't Flesh Wounds.
     */
    const expectedShot = (w, bonus, f, { extra = 0, acAdj = 0, flesh = false } = {}) => {
        const ac = f.ac + acAdj;
        const e = strikeExpected(bonus, ac, w.s.avg + extra, { deadly: w.deadly });
        if (piercing && 19 + bonus >= ac && 19 + bonus < ac + 10) { e.expected += 0.05 * (w.s.avg + extra + w.deadly); e.crit += 0.05; }
        if (fleshWound && flesh) { const c = degreeChances(bonus, ac); e.expected += c.f * (dieAvg(w.s) * diceOf(w.s) + gunSpec); }
        return e;
    };
    const meleeBest = (f, made, at = me.rect, { acAdj = 0, oneHanded = false } = {}) => {
        let best = null;
        for (const s of oneHanded ? melee1 : melee) {
            if (!inReach(at, f.rect, s.reach || 5)) continue;
            const b = s.bonus + mapFor(made, s.agile);
            const e = strikeExpected(b, f.ac + acAdj, s.avg, { deadly: s.deadly });
            if (!best || e.expected > best.e.expected) best = { s, bonus: b, e };
        }
        return best;
    };
    const jamCost = (w, f) => 0.6 * expectedShot(w, w.s.bonus, f, { flesh: false }).expected + 1;

    /**
     * The way's reload action, aimed at f from `at` with `made` attacks already: its text, worth, the AC adjustment it gives the
     * next shot, and how many attacks it adds to the penalty. lastHit: the chance the shot before it hit (Sword and Pistol).
     */
    const wayReload = (w, f, made, at, lastHit = 0) => {
        const plain = { text: `Interact to reload ${w.label}`, ev: 0, acAdj: 0, attacks: 0 };
        if (!way || !has(actor, WAY_RELOAD[way])) return plain;
        const name = WAY_RELOAD_NAME[way];
        if (way === "drifter") {
            if (w.two) return { ...plain, text: `Interact to reload ${w.label} (Reloading Strike needs the gun in one hand)` };
            let best = null;
            for (const t of foes) { const b = meleeBest(t, made, at, { oneHanded: true }); if (!b) continue; const og = swordPistol && t === f ? lastHit : 0; const ev = og ? og * strikeExpected(b.bonus, t.ac - 2, b.s.avg, { deadly: b.s.deadly }).expected + (1 - og) * b.e.expected : b.e.expected; if (!best || ev > best.ev) best = { t, b, ev }; }
            if (!best) return { ...plain, text: `Reloading Strike with no foe in reach is a plain Interact: reload ${w.label}` };
            return { text: `Reloading Strike: ${best.b.s.label} at ${nameOf(best.t)} (${signed(best.b.bonus)}${swordPistol && best.t === f ? ", off-guard to it if your shot hit" : ""}), then reload ${w.label} without a free hand`, ev: best.ev, acAdj: 0, attacks: 1 };
        }
        if (way === "pistolero") {
            const intim = skill(board, "intimidation"), dec = skill(board, "deception");
            const opts = [];
            if (intim && feetBetween(at, f.rect) <= 30 && !f.conditions?.has?.("frightened") && !f.conditions?.has?.("deafened")) { const c = degreeChances(intim.mod, 10 + (f.saves?.will ?? 0)); opts.push({ kind: "Demoralize", c, ev: c.s * worth(board, "frightened") + c.cs * worth(board, "frightened") * 2, acAdj: -(c.s + 2 * c.cs), text: `Demoralize ${nameOf(f)} (Intimidation ${signed(intim.mod)} vs Will DC ${10 + (f.saves?.will ?? 0)})` }); }
            if (dec) { const c = degreeChances(dec.mod, 10 + (f.perception ?? f.saves?.will ?? 0)); opts.push({ kind: "Create a Diversion", c, ev: 0, acAdj: -2 * (c.s + c.cs), text: `Create a Diversion (Deception ${signed(dec.mod)} vs Perception DC ${10 + (f.perception ?? f.saves?.will ?? 0)}: hidden to it until you shoot, so it's off-guard to that shot)` }); }
            if (!opts.length) return { ...plain, text: `Raconteur's Reload: reload ${w.label}, then Demoralize or Create a Diversion` };
            opts.sort((a, b) => (b.ev - b.acAdj * 0.1 * w.s.avg) - (a.ev - a.acAdj * 0.1 * w.s.avg));
            const o = opts[0];
            return { text: `Raconteur's Reload: reload ${w.label}, then ${o.text}`, ev: o.ev, acAdj: o.acAdj, attacks: 0 };
        }
        if (way === "sniper") {
            const st = skill(board, "stealth");
            const dc = 10 + (f.perception ?? f.saves?.will ?? 0);
            const c = st ? degreeChances(st.mod, dc) : null;
            const p = c ? (c.s + c.cs) * 0.5 : 0; // half: the cover or concealment Hide needs isn't read here
            return { text: `Covered Reload: ${st ? `Hide (Stealth ${signed(st.mod)} vs Perception DC ${dc}; needs cover or concealment, and ${nameOf(f)} is off-guard to your next shot if it works)` : "Hide"} or Take Cover (+2 AC, +4 behind real cover), then reload ${w.label}`, ev: 0.5, acAdj: -2 * p, attacks: 0 };
        }
        if (way === "spellshot") {
            const ks = ["arcana", "nature", "occultism", "religion", "society"].map((k) => skill(board, k)).filter((s) => s && s.rank >= 1).sort((a, b) => b.mod - a.mod);
            return { text: `Thoughtful Reload: Recall Knowledge on ${nameOf(f)}${ks[0] ? ` (${ks[0].label} ${signed(ks[0].mod)})` : ""}, then reload ${w.label}`, ev: 0.3, acAdj: 0, attacks: 0 };
        }
        if (way === "vanguard") {
            if (!w.two) return { ...plain, text: `Interact to reload ${w.label} (Clear a Path needs a two-handed firearm or crossbow)` };
            const ath = skill(board, "athletics");
            const adj = foes.filter((t) => inReach(at, t.rect, 5)).sort((a, b) => (a === f ? -1 : 0) - (b === f ? -1 : 0));
            if (!adj.length || !ath) return { ...plain, text: `Clear a Path with no foe adjacent is a plain Interact: reload ${w.label}` };
            const t = adj[0];
            const pen = made > 0 ? mapFor(made - 1, false) : 0; // the same penalty as the shot before it
            const c = degreeChances(ath.mod + pen, 10 + (t.saves?.fortitude ?? 0));
            return { text: `Clear a Path: Shove ${nameOf(t)} with the gun (Athletics ${signed(ath.mod + pen)} vs Fortitude DC ${10 + (t.saves?.fortitude ?? 0)}, no free hand needed; 5 feet back, 10 on a critical success), then reload ${w.label}`, ev: (c.s + c.cs) * worth(board, "prone", 0.4), acAdj: 0, attacks: 1 };
        }
        if (way === "triggerbrand") {
            if (!w.combination) return { ...plain, text: `Interact to reload ${w.label} (Touch and Go needs a combination weapon)` };
            return { text: `Touch and Go: Step toward a foe, switch ${w.label}'s mode if you like, then reload it`, ev: 0, acAdj: 0, attacks: 0 };
        }
        return plain;
    };

    /**
     * A run of shots at f with w from `at`: Strike while loaded, reload when not (the way's reload first, then plain Interacts;
     * Risky Reload when allowed), the penalty climbing. Returns steps, ev, the attacks made and the loaded state at the end.
     */
    const shootRun = (w, f, actions, made0, { at = me.rect, risky = false, loaded = w.loaded, allowWay = true, acAdj0 = 0, bonus0 = 0 } = {}) => {
        const steps = [];
        let ev = 0, made = made0, left = actions, isLoaded = loaded, usedWay = !allowWay, usedRisky = !risky, acAdj = acAdj0, bonusAdj = bonus0, crack = false, lastHit = 0;
        const dist = feetBetween(at, f.rect);
        const pen = rangePen(w, dist);
        const used = [];
        const flush = () => { if (used.length) { steps.push({ cost: used.length, text: (fleshWound ? "Flesh Wound: " : "") + strikeText(f, used) + (pen ? ` (${-pen} off for range counted)` : "") }); used.length = 0; } };
        const shot = () => { const b = w.s.bonus + mapFor(made, w.s.agile) + pen + bonusAdj; const e = expectedShot(w, b, f, { acAdj, extra: crack ? diceOf(w.s) : 0, flesh: fleshWound }); used.push({ label: w.label + (acAdj ? " (off-guard counted)" : "") + (crack ? ` (Crack Shot +${diceOf(w.s)})` : ""), bonus: b }); ev += e.expected; made += 1; isLoaded = false; left -= 1; acAdj = 0; bonusAdj = 0; crack = false; lastHit = e.hit; return e; };
        while (left > 0) {
            if (isLoaded) { shot(); continue; }
            if (!usedRisky && w.group === "firearm" && w.reload === 1) {
                flush();
                const b = w.s.bonus + mapFor(made, w.s.agile) + pen + bonusAdj;
                const e = expectedShot(w, b, f, { acAdj });
                const jam = jamCost(w, f);
                steps.push({ cost: 1, text: `Risky Reload: reload ${w.label} and Strike ${nameOf(f)} (${signed(b)}); a miss jams the gun (${pct(1 - e.hit)}, about ${Math.round(jam * 10) / 10} damage of lost actions counted)` });
                ev += e.expected - (1 - e.hit) * jam; made += 1; left -= 1; usedRisky = true; acAdj = 0; bonusAdj = 0; lastHit = e.hit;
                continue;
            }
            if (!usedWay) {
                flush();
                const wr = wayReload(w, f, made, at, lastHit);
                steps.push({ cost: 1, text: wr.text });
                ev += wr.ev; acAdj = wr.acAdj; made += wr.attacks; usedWay = true; left -= 1;
                if (w.reload > 1) { if (left >= w.reload - 1) { steps.push({ cost: w.reload - 1, text: `Interact to finish reloading ${w.label}` }); left -= w.reload - 1; } else break; }
                isLoaded = true; if (crackShot && w.group === "crossbow") crack = true;
                continue;
            }
            if (left >= w.reload && w.reload > 0) { flush(); steps.push({ cost: w.reload, text: `Interact to reload ${w.label}${w.reload > 1 ? ` (${w.reload} actions)` : ""}` }); left -= w.reload; isLoaded = true; if (crackShot && w.group === "crossbow") crack = true; continue; }
            if (w.reload === 0) { isLoaded = true; continue; }
            break;
        }
        flush();
        // ending loaded saves next turn an action: credited as part of a fresh shot
        const credit = isLoaded && w.reload > 0 && steps.length ? 0.4 * expectedShot(w, w.s.bonus + pen, f, { flesh: false }).expected : 0;
        return { steps, ev: ev + credit, made, loaded: isLoaded, left, credit };
    };
    const shootPlan = (w, f, actions, made0, opts = {}) => {
        const a = shootRun(w, f, actions, made0, { ...opts, risky: false });
        const b = hasAny(actor, "risky-reload") && w.group === "firearm" && w.reload === 1 ? shootRun(w, f, actions, made0, { ...opts, risky: true }) : null;
        return b && b.ev > a.ev + 0.5 ? b : a;
    };
    const wayName = way && has(actor, WAY_RELOAD[way]) ? WAY_RELOAD_NAME[way] : null;
    const bestGunFor = (f, at = me.rect) => { let best = null; for (const w of guns) { if (!inRange(w, at, f)) continue; const e = expectedShot(w, w.s.bonus + rangePen(w, feetBetween(at, f.rect)), f).expected / (1 + w.reload * 0.5); if (!best || e > best.e) best = { w, e }; } return best?.w ?? null; };
    /** The three foes a shot does most to: the special shots are planned against these, the plain shots against every foe. */
    const rankFoe = (f) => { const w = bestGunFor(f); return w ? expectedShot(w, w.s.bonus + rangePen(w, feetBetween(me.rect, f.rect)), f).expected : -1; };
    const topFoes = [...foes].sort((a, b) => rankFoe(b) - rankFoe(a)).slice(0, 3);

    // ---- the main plan: shots with the slinger's reload between them, per foe in range
    if (ctx.actions >= 1) for (const f of foes) {
        const w = bestGunFor(f);
        if (!w) continue;
        const r = shootPlan(w, f, ctx.actions, ctx.made);
        if (!r.steps.length) continue;
        const notes = [];
        if (!r.loaded && w.reload > 0) notes.push(`${w.label} is empty at the end: next turn opens with a reload.`);
        else if (r.credit) notes.push(`${w.label} is loaded at the end: next turn opens with a shot (about ${Math.round(r.credit * 10) / 10} of the value).`);
        if (w.fatalDie) notes.push(`Fatal d${w.fatalDie}: a critical hit rolls d${w.fatalDie}s, doubled, plus one more${fatalBullet ? " (two more with Fatal Bullet)" : ""}; the plan's value counts it.`);
        if (w.concussive) notes.push("Concussive: piercing or bludgeoning, whichever the target resists less.");
        if (w.kickback && str < 2) notes.push("Kickback: -2 to hit without Strength +2 or a stabilizer; the sheet's bonus already shows it.");
        if (hasAny(actor, "finish-the-job") && !w.two && (melee1.length || !melee.length) && meleeBest(f, ctx.made, me.rect, { oneHanded: true })) { const mb = meleeBest(f, ctx.made, me.rect, { oneHanded: true }); notes.push(`Finish the Job (1 action): if a shot at ${nameOf(f)} fails but not critically, a ${mb.s.label} Strike on it at the same penalty (${signed(mb.bonus)}, about ${Math.round(mb.e.expected * 10) / 10}); your penalty then climbs as usual.`); }
        if (swordPistol && !w.two && inReach(me.rect, f.rect, myReach(board))) notes.push("Sword and Pistol: a shot that hits a foe in your reach makes it off-guard to your next one-handed melee Strike; a melee hit makes your next shot at it safe from Reactive Strike.");
        push({ title: `Shoot ${nameOf(f)}${wayName && r.steps.some((s) => s.text.startsWith(wayName)) ? `, ${wayName} between shots` : ""}`, target: f, ev: r.ev, steps: r.steps, notes });
    }

    // ---- two one-handed guns: Paired Shots (2 actions, both at the current penalty), Twin Shot Knockdown, Ostentatious Reload
    const twoLoaded = loadedGuns.filter((w) => !w.two);
    if (twoLoaded.length >= 2 && ctx.actions >= 2) for (const f of topFoes) {
        const pair = twoLoaded.filter((w) => inRange(w, me.rect, f)).sort((a, b) => expectedShot(b, b.s.bonus, f).expected - expectedShot(a, a.s.bonus, f).expected).slice(0, 2);
        if (pair.length < 2) continue;
        const es = pair.map((w, i) => { const b = w.s.bonus + mapFor(ctx.made, w.s.agile) + rangePen(w, feetBetween(me.rect, f.rect)); return { w, b, e: expectedShot(w, b, f, { extra: i ? -w.precision : 0 }) }; });
        const reloadNote = dualReload ? "" : " (a free hand is needed to reload with two guns held: Dual-Weapon Reload would fix that)";
        if (hasAny(actor, "paired-shots")) {
            const ev = es[0].e.expected + es[1].e.expected;
            const steps = [{ cost: 2, text: `Paired Shots at ${nameOf(f)}: ${es.map((x) => `${x.w.label} (${signed(x.b)})`).join(" and ")}, both at your current penalty; one damage roll if both hit, precision once` }];
            if (ctx.actions >= 3) steps.push({ cost: 1, text: `Interact to reload ${pair[0].label}${reloadNote}` });
            push({ title: `Paired Shots at ${nameOf(f)}`, target: f, ev, steps, notes: ["Two shots without the second attack's penalty; both guns are empty afterward."] });
        }
        if (hasAny(actor, "twin-shot-knockdown")) {
            // the second Strike takes the penalty: Twin Shot Knockdown doesn't waive it
            const b2 = es[1].w.s.bonus + mapFor(ctx.made + 1, es[1].w.s.agile) + rangePen(es[1].w, feetBetween(me.rect, f.rect));
            const e2 = expectedShot(es[1].w, b2, f); // two ordinary Strikes: no "precision once" clause (that's Paired Shots)
            push({ title: `Twin Shot Knockdown on ${nameOf(f)}`, target: f, ev: es[0].e.expected + e2.expected + es[0].e.hit * e2.hit * worth(board, "prone"), bias: 0.3, steps: [{ cost: 2, text: `Twin Shot Knockdown: ${es[0].w.label} (${signed(es[0].b)}) and ${es[1].w.label} (${signed(b2)}) at ${nameOf(f)}; both hit (${pct(es[0].e.hit * e2.hit)}) and it falls prone` }, ...(ctx.actions >= 3 ? [{ cost: 1, text: `Interact to reload ${pair[0].label}${reloadNote}` }] : [])], notes: [`Paired Shots is the better pair when the knockdown is unlikely; prone is worth about ${Math.round(worth(board, "prone") * 10) / 10} here.`] });
        }
    }
    if (hasAny(actor, "ostentatious-reload") && oneHandGuns.length >= 2 && oneHandGuns.some((w) => !w.loaded || !w.loadedKnown)) { const perf = skill(board, "performance"); const dc = Math.max(10, 12 + lv - 2); const c = perf ? degreeChances(perf.mod, dc) : null; n(`Ostentatious Reload (1 action, two one-handed firearms): a Performance check against an easy DC (${dc}${c ? `, ${pct(c.cs)} to reload both, ${pct(c.s)} one` : ""}); a failure drops a gun.`); }

    // ---- Two-Weapon Fusillade (1 action, flourish): a Strike with each hand, one a loaded gun
    if (hasAny(actor, "two-weapon-fusillade") && ctx.actions >= 1) for (const f of topFoes) {
        const w = loadedGuns.filter((x) => !x.two && inRange(x, me.rect, f)).sort((a, b) => expectedShot(b, b.s.bonus, f).expected - expectedShot(a, a.s.bonus, f).expected)[0];
        if (!w) continue;
        const other = meleeBest(f, ctx.made + 1, me.rect, { oneHanded: true });
        const gun2 = twoLoaded.filter((x) => x !== w && inRange(x, me.rect, f)).sort((a, b) => expectedShot(b, b.s.bonus, f).expected - expectedShot(a, a.s.bonus, f).expected)[0];
        const b1 = w.s.bonus + mapFor(ctx.made, w.s.agile) + rangePen(w, feetBetween(me.rect, f.rect));
        const e1 = expectedShot(w, b1, f);
        let second = null;
        if (other) second = { label: other.s.label, bonus: other.bonus, ev: swordPistol ? e1.hit * strikeExpected(other.bonus, f.ac - 2, other.s.avg, { deadly: other.s.deadly }).expected + (1 - e1.hit) * other.e.expected : other.e.expected };
        if (gun2) { const b2 = gun2.s.bonus + mapFor(ctx.made + 1, gun2.s.agile) + rangePen(gun2, feetBetween(me.rect, f.rect)); const e2 = expectedShot(gun2, b2, f); if (!second || e2.expected > second.ev) second = { label: gun2.label, bonus: b2, ev: e2.expected }; }
        if (!second) continue;
        const steps = [{ cost: 1, text: `Two-Weapon Fusillade at ${nameOf(f)}: ${w.label} (${signed(b1)}) and ${second.label} (${signed(second.bonus)}) in one action` }];
        let ev = e1.expected + second.ev;
        if (ctx.actions >= 2) { const r = shootPlan(w, f, ctx.actions - 1, ctx.made + 2, { loaded: false }); steps.push(...r.steps); ev += r.ev; }
        push({ title: `Two-Weapon Fusillade at ${nameOf(f)}`, target: f, ev, bias: 0.3, steps, notes: ["Two Strikes for one action, then the reload; the flourish is once a turn."] });
    }

    // ---- Drifter's Juke (2 actions, flourish): Step, Strike, Step, Strike, one with the gun and one in melee
    if (hasAny(actor, "drifters-juke", "drifter-s-juke") && ctx.actions >= 2 && oneHandGuns.length && melee.length) for (const f of topFoes) {
        const w = oneHandGuns.filter((x) => x.loaded && inRange(x, me.rect, f))[0];
        const mb = meleeBest(f, ctx.made + 1, me.rect, { oneHanded: true }) ?? (feetBetween(me.rect, f.rect) <= 10 ? meleeBest(f, ctx.made + 1, { ...me.rect, x: f.rect.x - 1 }, { oneHanded: true }) : null);
        if (!w || !mb) continue;
        const b1 = w.s.bonus + mapFor(ctx.made, w.s.agile) + rangePen(w, feetBetween(me.rect, f.rect));
        const e1 = expectedShot(w, b1, f);
        const m = swordPistol ? e1.hit * strikeExpected(mb.bonus, f.ac - 2, mb.s.avg, { deadly: mb.s.deadly }).expected + (1 - e1.hit) * mb.e.expected : mb.e.expected;
        const steps = [{ cost: 2, text: `Drifter's Juke: shoot ${nameOf(f)} with ${w.label} (${signed(b1)}), Step in, ${mb.s.label} (${signed(mb.bonus)}${swordPistol ? ", off-guard to it if the shot hit" : ""}), Step away` }];
        let ev = e1.expected + m;
        if (ctx.actions >= 3) { const wr = wayReload(w, f, ctx.made + 2, me.rect, 0); steps.push({ cost: 1, text: wr.text }); ev += wr.ev; }
        push({ title: `Drifter's Juke on ${nameOf(f)}`, target: f, ev, bias: 0.3, steps, notes: ["The Steps are optional: skip the one that would leave you where a foe can reach you."] });
    }

    // ---- Bullet Split (1 action, flourish): one shot at two foes adjacent to each other, each at -2, one attack for the penalty
    if (hasAny(actor, "bullet-split") && ctx.actions >= 1 && oneHandGuns.some((w) => w.loaded) && melee1.some((s) => (s.damageTypes ?? []).includes("slashing") || (s.traits ?? []).includes("versatile-s"))) {
        let best = null;
        for (const w of oneHandGuns.filter((x) => x.loaded)) for (const a of foes) for (const b of foes) {
            if (a === b || !inReach(a.rect, b.rect, 5) || !inRange(w, me.rect, a) || !inRange(w, me.rect, b)) continue;
            const bonus = w.s.bonus - 2 + mapFor(ctx.made, w.s.agile);
            const ev = expectedShot(w, bonus + rangePen(w, feetBetween(me.rect, a.rect)), a).expected + expectedShot(w, bonus + rangePen(w, feetBetween(me.rect, b.rect)), b).expected;
            if (!best || ev > best.ev) best = { w, a, b, bonus, ev };
        }
        if (best) {
            const steps = [{ cost: 1, text: `Bullet Split: one shot from ${best.w.label} at ${nameOf(best.a)} and ${nameOf(best.b)} (${signed(best.bonus)} each, one attack toward your penalty)` }];
            let ev = best.ev;
            if (ctx.actions >= 2) { const r = shootPlan(best.w, best.a, ctx.actions - 1, ctx.made + 1, { loaded: false }); steps.push(...r.steps); ev += r.ev; }
            push({ title: `Bullet Split on ${nameOf(best.a)} and ${nameOf(best.b)}`, target: best.a, ev, bias: 0.3, steps });
        }
    }

    // ---- Penetrating Fire (2 actions): one shot through a foe into the one behind it
    if (hasAny(actor, "penetrating-fire") && ctx.actions >= 2 && loadedGuns.length) {
        const centre = (r) => ({ x: r.x + (r.w ?? 1) / 2, y: r.y + (r.h ?? 1) / 2 });
        const behind = (near, far) => { const o = centre(me.rect), a = centre(near.rect), b = centre(far.rect); const dx = b.x - o.x, dy = b.y - o.y, len = Math.hypot(dx, dy) || 1; const t = ((a.x - o.x) * dx + (a.y - o.y) * dy) / (len * len); if (t <= 0 || t >= 1) return false; const cross = Math.abs((a.x - o.x) * dy - (a.y - o.y) * dx) / len; return cross <= 0.75; };
        let best = null;
        for (const w of loadedGuns) for (const a of foes) for (const b of foes) {
            if (a === b || !behind(a, b) || !inRange(w, me.rect, b)) continue;
            const bonus = w.s.bonus + mapFor(ctx.made, w.s.agile) + rangePen(w, feetBetween(me.rect, b.rect));
            const ev = expectedShot(w, bonus, a).expected + expectedShot(w, bonus, b).expected;
            if (!best || ev > best.ev) best = { w, a, b, bonus, ev };
        }
        if (best) {
            const steps = [{ cost: 2, text: `Penetrating Fire with ${best.w.label}: one Strike (${signed(best.bonus)}) at ${nameOf(best.a)} and through it at ${nameOf(best.b)}, one damage roll, no cover from the nearer one; counts as two attacks` }];
            let ev = best.ev;
            if (ctx.actions >= 3) { const wr = wayReload(best.w, best.b, ctx.made + 2, me.rect, 0); steps.push({ cost: 1, text: wr.text }); ev += wr.ev; }
            push({ title: `Penetrating Fire through ${nameOf(best.a)}`, target: best.b, ev, bias: 0.3, steps });
        }
    }

    // ---- aimed single shots: Sniper's Aim (+2, ignores concealment), Called Shot (enfeebled 2 or stupefied 2 on a hit), Headshot, Vital Shot, Ghost Shot
    const aimed = (title, w, f, { bonus = 0, extra = 0, cost = 2, rider = 0, critRider = 0, text, notes = [], acAdj = 0 }) => {
        const b = w.s.bonus + mapFor(ctx.made, w.s.agile) + rangePen(w, feetBetween(me.rect, f.rect)) + bonus;
        const e = expectedShot(w, b, f, { extra, acAdj });
        const steps = [{ cost, text: text(b, e) }];
        let ev = e.expected + rider * e.hit + critRider * e.crit;
        if (ctx.actions > cost) { const r = shootPlan(w, f, ctx.actions - cost, ctx.made + 1, { loaded: false }); steps.push(...r.steps); ev += r.ev; }
        push({ title, target: f, ev, bias: 0.2, steps, notes });
        return e;
    };
    for (const f of topFoes) {
        const w = loadedGuns.filter((x) => inRange(x, me.rect, f)).sort((a, b) => expectedShot(b, b.s.bonus, f).expected - expectedShot(a, a.s.bonus, f).expected)[0];
        if (!w) continue;
        const dist = feetBetween(me.rect, f.rect);
        if (hasAny(actor, "snipers-aim", "sniper-s-aim") && ctx.actions >= 2) aimed(`Sniper's Aim at ${nameOf(f)}`, w, f, { bonus: 2, text: (b) => `Sniper's Aim: ${w.label} at ${nameOf(f)} (${signed(b)}, +2 counted${f.state === "concealed" ? ", no flat check for its concealment" : ""}${w.kickback ? ", no kickback penalty" : ""})`, notes: ["Two actions for one shot: it pays against a concealed foe, or when the second shot would be at -10."] });
        if (hasAny(actor, "called-shot") && ctx.actions >= 2) aimed(`Called Shot at ${nameOf(f)}`, w, f, { rider: worth(board, "enfeebled", 2), text: (b, e) => `Called Shot at ${nameOf(f)}'s arms with ${w.label} (${signed(b)}): a hit (${pct(e.hit)}) leaves it enfeebled 2 until the end of your next turn (head for stupefied 2 against a caster, legs for -10 feet, wings to ground a flier)` });
        if (hasAny(actor, "headshot") && ctx.actions >= 2 && (f.hp ?? 0) < (f.maxHp ?? 1)) { const shift = (f.level ?? lv) > lv ? 1 : 0; const sv = degreeChances(f.saves?.fortitude ?? 0, classDC, shift); aimed(`Headshot on ${nameOf(f)}`, w, f, { critRider: (sv.f + sv.cf) * 0.8 * (f.hp ?? 30), text: (b, e) => `Headshot: ${w.label} at ${nameOf(f)} (${signed(b)}): on a critical hit (${pct(e.crit)}) it saves against your class DC ${classDC} or dies (Fortitude ${signed(f.saves?.fortitude ?? 0)}: ${pct(sv.f + sv.cf)} to fail), if you've damaged it with this gun in the last minute`, notes: ["A death effect: a creature with no head is immune, and a survivor is immune for a day."] }); }
        if (hasAny(actor, "vital-shot") && ctx.actions >= 2 && f.conditions?.has?.("off-guard")) { const bleed = (lv >= 15 ? 10.5 : lv >= 9 ? 7 : 3.5) * 1.5; aimed(`Vital Shot at ${nameOf(f)}`, w, f, { extra: dieAvg(w.s), rider: bleed, text: (b, e) => `Vital Shot: ${w.label} at off-guard ${nameOf(f)} (${signed(b)}): an extra weapon die, and persistent bleed equal to your One Shot, One Kill precision (${lv >= 15 ? "3d6" : lv >= 9 ? "2d6" : "1d6"}) on a hit (${pct(e.hit)})` }); }
        else if (hasAny(actor, "vital-shot") && ctx.actions >= 2 && f === foes[0]) n("Vital Shot (2 actions): a ranged Strike that adds a weapon die and persistent bleed against an off-guard foe; make one off-guard first (hidden, a flank, a Feint, Covered Reload's Hide).");
        if (hasAny(actor, "ghost-shot") && ctx.actions >= 1 && (me.conditions?.has?.("hidden") || me.conditions?.has?.("undetected"))) aimed(`Ghost Shot at ${nameOf(f)}`, w, f, { cost: 1, extra: lv >= 15 ? 10.5 : lv >= 9 ? 7 : 3.5, text: (b) => `Ghost Shot: ${w.label} at ${nameOf(f)} (${signed(b)}) with One Shot, One Kill's precision (${lv >= 15 ? "3d6" : lv >= 9 ? "2d6" : "1d6"}) while you're hidden from it; you stay hidden afterward`, notes: ["The flourish is once a turn; hidden foes count as off-guard to you, which the estimate doesn't show."] });
        if (hasAny(actor, "blast-tackle") && ctx.actions >= 2 && inReach(me.rect, f.rect, 5) && (w.two && w.group === "crossbow" || w.kickback || w.scatter)) {
            const ath = skill(board, "athletics");
            if (ath) { const c = degreeChances(ath.mod + mapFor(ctx.made, false), 10 + (f.saves?.fortitude ?? 0)); const b = w.s.bonus + mapFor(ctx.made + 1, w.s.agile); const e = expectedShot(w, b, f, { extra: 10.5 }); const p = c.s + c.cs; push({ title: `Blast Tackle ${nameOf(f)}`, target: f, ev: p * (e.expected + worth(board, "grabbed")), bias: 0.3, steps: [{ cost: 2, text: `Blast Tackle: Grapple ${nameOf(f)} (Athletics ${signed(ath.mod + mapFor(ctx.made, false))} vs Fortitude DC ${10 + (f.saves?.fortitude ?? 0)}, ${pct(p)}), then ${w.label} point-blank (${signed(b)}) with +3d6 precision` }, ...(ctx.actions >= 3 ? [{ cost: 1, text: `Interact to reload ${w.label} one-handed while it's grabbed` }] : [])], notes: ["While it stays grabbed you reload and shoot it with one hand."] }); }
        }
        if (dist <= w.range && hasAny(actor, "pistol-twirl") && !w.two && ctx.actions >= 2) {
            const dec = skill(board, "deception");
            if (dec && dec.rank >= 1 && !f.conditions?.has?.("off-guard")) {
                const c = degreeChances(dec.mod, 10 + (f.perception ?? f.saves?.will ?? 0));
                const p = c.s + c.cs;
                const r = shootPlan(w, f, ctx.actions - 1, ctx.made, { acAdj0: -2 * p });
                push({ title: `Pistol Twirl, then shoot ${nameOf(f)}`, target: f, ev: r.ev, bias: 0.2, steps: [{ cost: 1, text: `Pistol Twirl: Feint ${nameOf(f)} at range (Deception ${signed(dec.mod)} vs Perception DC ${10 + (f.perception ?? f.saves?.will ?? 0)}, ${pct(p)}): off-guard to your next shot (all your attacks on it this turn on a critical success)` }, ...r.steps], notes: ["A critical failure leaves you off-guard to it instead."] });
            }
        }
    }

    // ---- Scatter Blast (2 actions): a scatter shot with +20 feet of range and radius; a miss misfires, a critical miss bursts the gun
    if (hasAny(actor, "scatter-blast") && ctx.actions >= 2) for (const w of loadedGuns.filter((x) => x.scatter)) for (const f of topFoes) {
        const others = foes.filter((o) => o !== f && feetBetween(o.rect, f.rect) <= w.scatter + 20);
        if (others.length < 1 || feetBetween(me.rect, f.rect) > (w.range + 20) * 6) continue;
        const b = w.s.bonus + mapFor(ctx.made, w.s.agile) + (unerring ? 0 : -2 * rangeSteps(feetBetween(me.rect, f.rect), w.range + 20));
        const e = expectedShot(w, b, f);
        const splash = diceOf(w.s) * others.length * e.hit;
        const jam = jamCost(w, f);
        push({ title: `Scatter Blast at ${nameOf(f)}`, target: f, ev: e.expected + splash - (1 - e.hit) * jam, bias: 0.2, steps: [{ cost: 2, text: `Scatter Blast: ${w.label} at ${nameOf(f)} (${signed(b)}), splash ${diceOf(w.s)} to ${others.map(nameOf).join(", ")} within ${w.scatter + 20} feet; a miss (${pct(1 - e.hit)}) jams the gun, a critical miss breaks it and it bursts on everyone within 20 feet of you` }], notes: ["A gamble: the jam and the burst are counted against it."] });
    }

    // ---- Alchemical Shot (2 actions): a bomb poured on the shot, its damage type and persistent damage; a miss hurts you and jams the gun
    const bombs = (actor?.items?.contents ?? actor?.items ?? []).filter?.((i) => ["consumable", "weapon"].includes(i.type) && (i.system?.traits?.value ?? []).includes("bomb") && (Number(i.system?.quantity) || 1) > 0) ?? [];
    if (hasAny(actor, "alchemical-shot") && ctx.actions >= 2 && bombs.length) for (const f of topFoes) {
        const w = loadedGuns.filter((x) => inRange(x, me.rect, f))[0];
        if (!w) continue;
        const bombLv = Math.max(...bombs.map((i) => Number(i.system?.level?.value) || 1));
        const pers = (bombLv >= 17 ? 10.5 : bombLv >= 11 ? 7 : 3.5) * 1.5;
        const b = w.s.bonus + mapFor(ctx.made, w.s.agile) + rangePen(w, feetBetween(me.rect, f.rect));
        const e = expectedShot(w, b, f);
        const bomb = bombs.sort((x, y) => (Number(y.system?.level?.value) || 0) - (Number(x.system?.level?.value) || 0))[0];
        push({ title: `Alchemical Shot at ${nameOf(f)}`, target: f, ev: e.expected + e.hit * pers - (1 - e.hit) * (jamCost(w, f) + 3.5), bias: 0.2, steps: [{ cost: 2, text: `Alchemical Shot: pour ${bomb.name} on the round and shoot ${nameOf(f)} with ${w.label} (${signed(b)}): the bomb's damage type and ${bombLv >= 17 ? "3d6" : bombLv >= 11 ? "2d6" : "1d6"} persistent on a hit; a miss burns you for 1d6 and jams the gun` }], notes: ["Worth it against a foe weak to the bomb's type; the plan's value doesn't know its weaknesses."] });
    }

    // ---- Final Shot (3 actions, an empty firearm): a triple charge; a success is a critical hit, a failure a misfire; then prone and stunned 1
    if (hasAny(actor, "final-shot") && ctx.actions >= 3 && ctx.made === 0) for (const w of guns.filter((x) => x.group === "firearm" && x.loadedKnown && !x.loaded)) for (const f of topFoes) {
        if (feetBetween(me.rect, f.rect) > w.range) continue;
        const b = w.s.bonus;
        const c = degreeChances(b, f.ac);
        const ev = (c.s + c.cs) * (w.s.avg * 2 + w.deadly) - c.f * jamCost(w, f) - worth(board, "stunned") - worth(board, "prone");
        push({ title: `Final Shot at ${nameOf(f)}`, target: f, ev, bias: 0.1, steps: [{ cost: 3, text: `Final Shot: triple-charge ${w.label} and shoot ${nameOf(f)} (${signed(b)}): a success is a critical hit (${pct(c.s + c.cs)}), a failure jams it; you end prone and stunned 1` }], notes: ["For a turn that should end the fight: the stun and the prone are counted against it."] });
    }

    // ---- Pistolero's Challenge (1 action, flourish): +2/+3/+4 status damage both ways against one foe
    if (hasAny(actor, "pistoleros-challenge", "pistolero-s-challenge") && ctx.actions >= 2 && !effect(actor, /pistolero-?s?-challenge/)) {
        const sk = [skill(board, "intimidation"), skill(board, "deception")].filter(Boolean).sort((a, b) => b.mod - a.mod)[0];
        if (sk) for (const f of foes.filter((x) => feetBetween(me.rect, x.rect) <= 30)) {
            const w = bestGunFor(f);
            if (!w) continue;
            const c = degreeChances(sk.mod, 10 + (f.saves?.will ?? 0));
            const bonus = sk.rank >= 4 ? 4 : sk.rank >= 3 ? 3 : 2;
            const r = shootPlan(w, f, ctx.actions - 1, ctx.made);
            const shots = r.steps.reduce((t, s) => t + (/Strike|Risky Reload/.test(s.text) ? s.cost : 0), 0);
            // your hits this turn gain the bonus; the foe's against you is a cost (about one hit before your next turn)
            const ev = r.ev + (c.s + c.cs) * bonus * 0.6 * (shots - 1) - c.cf * worth(board, "frightened");
            push({ title: `Challenge ${nameOf(f)}, then shoot`, target: f, ev, bias: 0.2, steps: [{ cost: 1, text: `Pistolero's Challenge: ${sk.label} ${signed(sk.mod)} vs Will DC ${10 + (f.saves?.will ?? 0)} (${pct(c.s + c.cs)}): +${bonus} status damage on your Strikes against each other until one of you is down` }, ...r.steps], notes: [has(actor, "come-at-me") ? "Come at Me: you can hold any number of challenges." : "One challenge at a time; a new one ends the old. A critical failure frightens you instead."] });
        }
    }

    // ---- the Triggerbrand: Salvo and Stab and Blast (1 action: melee, then a +2 shot if it hit), Wind Them Up, Break Them Down, Blitz
    const combos = guns.filter((w) => w.combination);
    const comboMelee = (w) => melee.find((s) => s.id === w.s.id || s.label === w.label || /\(melee\)/i.test(s.label)) ?? melee[0];
    if (combos.length && ctx.actions >= 1) for (const f of foes.filter((x) => inReach(me.rect, x.rect, 5))) {
        const w = combos.filter((x) => x.loaded)[0] ?? combos[0];
        const m = comboMelee(w);
        if (!m) continue;
        const bm = m.bonus + mapFor(ctx.made, m.agile);
        const em = strikeExpected(bm, f.ac, m.avg, { deadly: m.deadly });
        const salvo = hasAny(actor, "triggerbrand-salvo") ? "Triggerbrand Salvo" : hasAny(actor, "stab-and-blast") ? "Stab and Blast" : null;
        if (salvo && w.loaded) {
            const bs = w.s.bonus + 2 + mapFor(ctx.made, w.s.agile);
            const es = expectedShot(w, bs, f);
            const steps = [{ cost: 1, text: `${salvo}: ${m.label} at ${nameOf(f)} (${signed(bm)}); if it hits (${pct(em.hit)}), shoot it point-blank with ${w.label} at +2 (${signed(bs)}) at the same penalty` }];
            let ev = em.expected + em.hit * es.expected;
            if (ctx.actions >= 2) { const r = shootPlan(w, f, ctx.actions - 1, ctx.made + 2, { loaded: false }); steps.push(...r.steps); ev += r.ev; }
            push({ title: `${salvo} on ${nameOf(f)}`, target: f, ev, bias: 0.3, steps, notes: ["Two attacks in one action; both count toward your penalty afterward."] });
        }
        if (hasAny(actor, "break-them-down") && w.loaded && ctx.actions >= 2) {
            const bs = w.s.bonus + mapFor(ctx.made, w.s.agile);
            const esHit = expectedShot(w, bs + 1, f), esMiss = expectedShot(w, bs, f);
            const both = em.hit * esHit.hit;
            const steps = [{ cost: 2, text: `Break Them Down: ${m.label} at ${nameOf(f)} (${signed(bm)}), then ${w.label} point-blank (${signed(bs)}, +1 if the blade hit), both at your current penalty; if both hit (${pct(both)}) it takes 2d6 persistent bleed and is dazzled while it bleeds` }];
            let ev = em.expected + em.hit * esHit.expected + (1 - em.hit) * esMiss.expected + both * (7 * 1.5 + worth(board, "dazzled"));
            if (ctx.actions >= 3) { const wr = wayReload(w, f, ctx.made + 2, me.rect, 0); steps.push({ cost: 1, text: wr.text }); ev += wr.ev; }
            push({ title: `Break Them Down on ${nameOf(f)}`, target: f, ev, bias: 0.3, steps });
        }
        if (hasAny(actor, "wind-them-up") && ctx.actions >= 2) {
            const th = skill(board, "thievery");
            if (th) {
                const c = degreeChances(th.mod - 5, 10 + (f.perception ?? f.saves?.will ?? 0));
                const p = c.s + c.cs;
                const steps = [{ cost: 2, text: `Wind Them Up: ${m.label} at ${nameOf(f)} (${signed(bm)}), then Steal from it (Thievery ${signed(th.mod - 5)} vs Perception DC ${10 + (f.perception ?? f.saves?.will ?? 0)}, ${pct(p)}): off-guard to your shots until your next turn, and they don't provoke` }];
                let ev = em.expected;
                if (ctx.actions >= 3 && w.loaded) { const r = shootPlan(w, f, 1, ctx.made + 1, { acAdj0: -2 * p, allowWay: false }); steps.push(...r.steps); ev += r.ev; }
                push({ title: `Wind Them Up ${nameOf(f)}`, target: f, ev, bias: 0.2, steps, notes: ["The off-guard lasts until your next turn: it sets up next turn's shots too."] });
            }
        }
    }

    // ---- the Vanguard: Spinning Crush (3 actions, everyone adjacent), Siegebreaker (2 actions, Stride then a +3d8 point-blank shot)
    if (hasAny(actor, "spinning-crush") && ctx.actions >= 3 && loadedGuns.length) {
        const adjFoes = foes.filter((f) => inReach(me.rect, f.rect, 5));
        const adjAllies = board.allies.filter((a) => inReach(me.rect, a.rect, 5));
        if (adjFoes.length >= 1) {
            const dice = Math.min(4, Math.max(1, ...loadedGuns.map((w) => diceOf(w.s))));
            const avg = (2 + 2 * dice) * 3.5 + str;
            let ev = 0;
            for (const f of adjFoes) { const s = saveExpected(f.saves?.reflex ?? 0, classDC, avg); ev += s.expected + s.fail * worth(board, "prone", 0.3); }
            ev -= adjAllies.length * avg * 0.8;
            push({ title: `Spinning Crush on ${adjFoes.length} adjacent foe${adjFoes.length > 1 ? "s" : ""}`, target: adjFoes[0], ev, bias: 0.3, steps: [{ cost: 3, text: `Spinning Crush: ${2 + 2 * dice}d6+${str} bludgeoning to everything adjacent (${[...adjFoes, ...adjAllies].map(nameOf).join(", ")}), basic Reflex against your class DC ${classDC}; a failure is pushed 10 feet` }], notes: [adjAllies.length ? `It hits your allies too: ${adjAllies.map(nameOf).join(", ")} are adjacent.` : "No attack roll and no penalty: a good turn when they've closed on you."] });
        }
    }
    if (hasAny(actor, "siegebreaker") && ctx.actions >= 2) for (const w of loadedGuns.filter((x) => x.kickback || x.scatter || x.two && x.group === "crossbow")) for (const f of topFoes) {
        const sq = squareToReach(board, f, 5, 1);
        if (!sq) continue;
        const b = w.s.bonus + mapFor(ctx.made, w.s.agile);
        const e = expectedShot(w, b, f, { extra: 13.5 });
        const steps = [{ cost: 2, text: `Siegebreaker: ${sq.route.actions ? `Stride to ${nameOf(f)} and ` : ""}shoot it point-blank with ${w.label} (${signed(b)}) for +3d8 bludgeoning, through 10 Hardness; you're then immobilized and parrying (+${(w.s.traits ?? []).includes("parry") || has(actor, "defensive-armaments") ? 2 : 1} AC) until your next turn` }];
        let ev = e.expected + 1;
        if (ctx.actions >= 3) { const wr = wayReload(w, f, ctx.made + 1, sq.route.actions ? { ...me.rect, x: sq.x, y: sq.y } : me.rect, 0); steps.push({ cost: 1, text: wr.text }); ev += wr.ev; }
        push({ title: `Siegebreaker on ${nameOf(f)}`, target: f, ev, bias: 0.3, dest: sq.route.actions ? { x: sq.x, y: sq.y } : null, steps, notes: ["You can't move until your next turn: don't do it where the rest of them can gang up on you."] });
    }

    // ---- the greater deeds of the Drifter and the Pistolero: Drifter's Wake, Grim Swagger; Triggerbrand Blitz; Dance of Thunder
    const sweep = (title, slugs, { stride = true, combo = false, cost = 3, after = "" }) => {
        if (!hasAny(actor, ...slugs) || ctx.actions < cost) return;
        const left = usesLeft(actor, slugs.find((s) => has(actor, s)));
        if (left === 0) return;
        const speed = Number(actor?.system?.movement?.speeds?.land?.value ?? actor?.system?.attributes?.speed?.total) || 25;
        // per foe, the best melee Strike and the best shot (one shot in the whole sweep: the gun needs a reload)
        const picks = [];
        const pool = combo ? combos.map((w) => w.s).concat(combos.map(comboMelee).filter(Boolean)) : [...melee1, ...oneHandGuns.filter((w) => w.loaded).map((w) => w.s)];
        for (const f of foes) {
            const near = stride ? feetBetween(me.rect, f.rect) <= speed + 5 : inReach(me.rect, f.rect, myReach(board));
            let gun = null, blade = null;
            for (const s of pool) {
                if (s.ranged ? feetBetween(me.rect, f.rect) > (s.range || 30) : !near) continue;
                const b = s.bonus + mapFor(ctx.made, s.agile);
                const e = strikeExpected(b, f.ac, s.avg, { deadly: s.deadly });
                const o = { s, b, e, f };
                if (s.ranged) { if (!gun || e.expected > gun.e.expected) gun = o; } else if (!blade || e.expected > blade.e.expected) blade = o;
            }
            if (gun || blade) picks.push({ f, gun, blade });
        }
        picks.sort((a, b) => Math.max(b.gun?.e.expected ?? 0, b.blade?.e.expected ?? 0) - Math.max(a.gun?.e.expected ?? 0, a.blade?.e.expected ?? 0));
        const top = picks.slice(0, 3);
        const gunTo = top.filter((p) => p.gun).sort((a, b) => ((b.gun.e.expected - (b.blade?.e.expected ?? 0)) - (a.gun.e.expected - (a.blade?.e.expected ?? 0))))[0];
        const chosen = top.map((p) => (p === gunTo ? p.gun : p.blade)).filter(Boolean);
        if (chosen.length < 2) return;
        push({ title: `${title}: ${chosen.length} foes`, target: chosen[0].f, ev: chosen.reduce((t, p) => t + p.e.expected, 0), bias: 0.3, steps: [{ cost, text: `${title}: Stride and Strike ${chosen.map((p) => `${nameOf(p.f)} with ${p.s.label} (${signed(p.b)})`).join(", ")}, all at your current penalty${after}` }], notes: [`One shot at most: the gun needs a reload between shots.${left != null ? ` ${left} use${left === 1 ? "" : "s"} left.` : ""}`] });
    };
    sweep("Drifter's Wake", ["drifters-wake", "drifter-s-wake"], { after: "; the movement doesn't provoke" });
    sweep("Triggerbrand Blitz", ["triggerbrand-blitz"], { combo: true, after: "; you're fatigued for a minute after" });
    if (hasAny(actor, "grim-swagger") && ctx.actions >= 2 && oneHandGuns.length) {
        const sk = [skill(board, "intimidation"), skill(board, "deception")].filter(Boolean).sort((a, b) => b.mod - a.mod)[0];
        const near = foes.filter((f) => feetBetween(me.rect, f.rect) <= 30 && !f.conditions?.has?.("frightened"));
        if (sk && near.length >= 2) {
            let ev = 0;
            for (const f of near) { const c = degreeChances(sk.mod, 10 + (f.saves?.will ?? 0)); ev += c.s * worth(board, "frightened", 1.2) + c.cs * (worth(board, "frightened", 1.5) + ((f.level ?? lv) < lv ? worth(board, "fleeing", 0.3) : 0)); }
            const steps = [{ cost: 2, text: `Grim Swagger: one ${sk.label} check (${signed(sk.mod)}) against the Will DC of ${near.map((f) => `${nameOf(f)} (${10 + (f.saves?.will ?? 0)})`).join(", ")}: frightened 2 on a success, frightened 3 and fleeing a round on a critical success against a lower-level foe` }];
            if (ctx.actions >= 3) { const f = near[0]; const w = bestGunFor(f); if (w && w.loaded) { const r = shootPlan(w, f, 1, ctx.made, { acAdj0: -1.5, allowWay: false }); steps.push(...r.steps); ev += r.ev; } }
            push({ title: `Grim Swagger on ${near.length} foes`, target: near[0], ev, bias: 0.3, steps, notes: ["Each of them is immune to it for 10 minutes afterward, whatever the result."] });
        }
    }
    if (hasAny(actor, "dance-of-thunder") && ctx.actions >= 3 && !me.conditions?.has?.("fatigued") && usesLeft(actor, "dance-of-thunder") !== 0) for (const f of topFoes) {
        const w = loadedGuns.filter((x) => feetBetween(me.rect, f.rect) <= x.range).sort((a, b) => expectedShot(b, b.s.bonus, f).expected - expectedShot(a, a.s.bonus, f).expected)[0];
        if (!w || w.reload > 1) continue;
        const es = [0, 1, 2].map((i) => expectedShot(w, w.s.bonus + mapFor(ctx.made + i, w.s.agile), f));
        const ev = es[0].expected + es[0].hit * (es[1].expected + es[1].hit * es[2].expected) - worth(board, "fatigued");
        push({ title: `Dance of Thunder on ${nameOf(f)}`, target: f, ev, bias: 0.3, steps: [{ cost: 3, text: `Dance of Thunder: Step, shoot ${nameOf(f)} with ${w.label} (${signed(w.s.bonus + mapFor(ctx.made, w.s.agile))}), reload; a hit (${pct(es[0].hit)}) repeats all three (${signed(w.s.bonus + mapFor(ctx.made + 1, w.s.agile))}), and a second hit once more (${signed(w.s.bonus + mapFor(ctx.made + 2, w.s.agile))}); you're fatigued for a minute after` }], notes: ["Up to three shots and three Steps in one activity, loaded at the end; once a minute."] });
    }

    // ---- initial deeds and the first round
    if (round() <= 1) {
        if (hasAny(actor, "into-the-fray") && foes.length && ctx.made === 0) n(`Into the Fray: you drew a one-handed ranged and a one-handed melee weapon when you rolled initiative, and your first action can be a free Stride toward ${nameOf(foes[0])}.`);
        if (hasAny(actor, "ten-paces")) n("Ten Paces: a free Step of up to 10 feet as your first action this turn, and a one-handed gun already drawn.");
        if (hasAny(actor, "one-shot-one-kill")) n(`One Shot, One Kill: if you rolled Stealth for initiative, your first hit with the gun you drew deals +${lv >= 15 ? "3d6" : lv >= 9 ? "2d6" : "1d6"} precision this fight; the plans don't count it.`);
        if (hasAny(actor, "living-fortification")) n("Living Fortification: your drawn gun parries for +1 AC (+2 with the parry trait) until the end of this turn.");
        if (hasAny(actor, "spring-the-trap")) n("Spring the Trap: this turn your movement and your shots don't provoke reactions.");
        if (hasAny(actor, "energy-shot")) n("Energy Shot: your first three shots this fight deal +1 acid, cold, fire or electricity per weapon die, your choice each time; pick what the foe is weak to.");
        if (hasAny(actor, "hair-trigger")) n("Hair Trigger: your initial deed let you Strike with a gun in hand instead of drawing; a hit left the target off-guard until the end of this turn.");
    } else if (hasAny(actor, "energy-shot") && round() <= 3) n("Energy Shot: if you still have any of your first three shots, they deal +1 energy damage per weapon die, your choice of type.");

    // ---- when-notes
    if (wayName && !out.plans.some((p) => p.steps.some((s) => s.text.startsWith(wayName)))) {
        const w = guns[0];
        if (w && foes.length) n(`${wayName} (1 action) is your reload: ${wayReload(w, foes[0], ctx.made, me.rect).text}.`);
        else if (w) n(`${wayName} (1 action) is your reload: it reloads ${w.label} and does your way's skill action in the same breath.`);
    }
    if (way === "pistolero" && hasAny(actor, "pistoleros-retort", "pistolero-s-retort") && oneHandGuns.length) n("Pistolero's Retort (reaction): when a foe within your one-handed gun's first range increment critically fails an attack on you, you shoot it.");
    if (way === "spellshot" && hasAny(actor, "recall-ammunition")) n("Recall Ammunition (reaction): when a shot misses, the round comes back loaded; the plans' reloads after a miss are free.");
    if (way === "spellshot" && hasAny(actor, "dispelling-bullet") && ctx.actions >= 2) n(`Dispelling Bullet (2 actions): a shot that counteracts a spell effect on the foe it hits (rank ${Math.ceil(lv / 2)}, check ${signed(classDC - 10)}); for a buffed or shielded foe.`);
    if (hasAny(actor, "quick-draw")) n("Quick Draw (1 action): draw a weapon and Strike with it in one action; a holstered loaded pistol is a Strike that skips the reload.");
    if (hasAny(actor, "running-reload") && guns.some((w) => w.reload > 0)) n("Running Reload (1 action): Stride, Step or Sneak, then reload; the plans' plain reloads can be this one.");
    if (hasAny(actor, "cover-fire") && ctx.actions >= 1 && loadedGuns.length) n("Cover Fire (1 action, once a round): a shot the target may duck (+2 AC against it, +4 behind cover, then -2 on its ranged attacks until its next turn ends) or take at +1 to your roll; aim it at their archer or caster.");
    if (hasAny(actor, "warning-shot") && loadedGuns.some((w) => w.group === "firearm")) n("Warning Shot (1 action): Demoralize out to the gun's maximum range with no penalty for language; it fires the loaded round.");
    if (hasAny(actor, "fake-out") && loadedGuns.length) n(`Fake Out (reaction): when an ally attacks a foe within your gun's first range increment, an attack roll to Aid them (+1 to your roll if you damaged it with that gun since your last turn).${has(actor, "deflecting-shot") ? " Deflecting Shot (reaction): +2 AC to an ally in that range who's just been hit, after you see the roll." : ""}`);
    else if (hasAny(actor, "deflecting-shot") && loadedGuns.length) n("Deflecting Shot (reaction): when an ally within your gun's first range increment is hit and you see the attacker, +2 AC against that attack, after the roll is known.");
    if (hasAny(actor, "redirecting-shot") && loadedGuns.length) n("Redirecting Shot (reaction): when an ally misses with a thrown weapon or ammunition at a foe in your first range increment, your d20 replaces theirs and the shot ignores cover and concealment.");
    if (hasAny(actor, "hit-the-dirt")) n(`Hit the Dirt (reaction): when a ranged Strike targets you, Leap for +2 AC against it and land prone${has(actor, "leap-and-fire") ? "; Leap and Fire shoots the attacker during the Leap" : ""}.`);
    if (hasAny(actor, "instant-backup")) n("Instant Backup (reaction): when your gun misfires, drop it and draw another in the same breath.");
    if (hasAny(actor, "instant-return") && guns.some((w) => w.loadedKnown && !w.loaded)) n("Instant Return (reaction): with an empty gun, a bullet that misses you is caught, loaded and fired back.");
    if (hasAny(actor, "grit-and-tenacity")) { const left = usesLeft(actor, "grit-and-tenacity"); n(`Grit and Tenacity (reaction, once an hour${left != null ? `, ${left} left` : ""}): reroll a failed Fortitude or Will save at +2${has(actor, "unshakable-grit") ? "; Unshakable Grit turns a success into a critical success and a critical failure into a failure" : ""}.`); }
    if (hasAny(actor, "slingers-reflexes", "slinger-s-reflexes")) n("Slinger's Reflexes: an extra reaction on every creature's turn, for gunslinger reactions only.");
    if (hasAny(actor, "perfect-readiness")) n("Perfect Readiness: you're quickened; the extra action is a Step or a reload, so a plan's reload rides on it.");
    if (hasAny(actor, "defensive-armaments") && guns.some((w) => w.two) && ctx.actions >= 1) n("Defensive Armaments (1 action): parry with your two-handed gun for +1 AC (+2 if it has the parry trait) until your next turn, and no splash damage while you do.");
    if (hasAny(actor, "black-powder-boost") && loadedGuns.some((w) => w.group === "firearm")) n("Black Powder Boost (1 action): a Leap 10 feet farther, firing the round; 2 actions for a High Jump or Long Jump without the run-up.");
    if (hasAny(actor, "smoke-curtain") && loadedGuns.some((w) => w.group === "firearm") && ctx.actions >= 2) n("Smoke Curtain (2 actions, a dose of black powder): a shot that leaves a cloud of smoke around you until your next turn; everything in it is concealed, and so is everything outside it from inside.");
    if (hasAny(actor, "trick-shot") && ctx.actions >= 2 && loadedGuns.length) n("Trick Shot (2 actions): shoot an object near a foe instead (an easy DC): knock something out of position, douse a light, set off a barrel; ask what's there.");
    if (hasAny(actor, "ricochet-shot") && ctx.actions >= 1 && loadedGuns.length) n(`Ricochet Shot (1 action): bounce the shot off a surface in your first range increment and the foe's cover is judged from there${has(actor, "ricochet-legend") ? "; Ricochet Legend: off any surface in three increments, no cover short of total, and a Reflex save against your class DC or stunned 2 the first time" : has(actor, "ricochet-master") ? "; Ricochet Master: two surfaces, and the foe is off-guard to the first one each fight" : ""}.`);
    if (hasAny(actor, "blood-in-the-air") && foes.some((f) => f.state === "concealed" || f.state === "hidden")) n("Blood in the Air (1 action): a shot at a foe you've wounded with a ranged weapon this minute that ignores concealment and hides behind a DC 5 flat check instead of 11.");
    if (hasAny(actor, "deadeye")) n("Deadeye (1 action): invisible creatures are only concealed to you until your next turn.");
    if (hasAny(actor, "shattering-shot") && bombs.length && ctx.actions >= 1) n(`Shattering Shot (1 action): shoot a thrown ${bombs[0].name} over a square in your first range increment: its damage in a burst, Reflex against your class DC ${classDC}, no splash or persistent.`);
    if (hasAny(actor, "rebounding-assault") && loadedGuns.some((w) => !w.two) && melee1.some((s) => (s.damageTypes ?? []).some((t) => ["bludgeoning", "slashing"].includes(t))) && ctx.actions >= 2) n("Rebounding Assault (2 actions): throw your melee weapon and shoot its hilt home: both at your current penalty, combined damage +1d6 precision if both hit, and the weapon comes back.");
    if (hasAny(actor, "phalanx-breaker") && loadedGuns.some((w) => w.two) && ctx.actions >= 2) n("Phalanx Breaker (2 actions): a shot in the first range increment that pushes the foe 10 feet back (20 on a critical hit), with damage if it meets a wall.");
    if (hasAny(actor, "cauterize") && loadedGuns.some((w) => w.group === "firearm")) n("Cauterize (1 action): a shot, then the hot barrel to a bleeding wound on you or an adjacent ally for an immediate flat check at the lower DC.");
    if (hasAny(actor, "seize-an-advantage")) n("Seize an Advantage (1 action, after a Dirty Trick): a shot or a reload that doesn't provoke that foe.");
    if (hasAny(actor, "disruptive-blur")) n("Disruptive Blur: after any shot, your movement this turn doesn't provoke; shoot first, then move.");
    if (hasAny(actor, "showstopper") && skill(board, "deception")) n("Showstopper: Create a Diversion (as Raconteur's Reload does) against every foe in your first range increment with one roll.");
    if (hasAny(actor, "shooters-camouflage", "shooter-s-camouflage")) n("Shooter's Camouflage: in your chosen terrain you Hide and Sneak without cover; Covered Reload's Hide works anywhere there.");
    if (hasAny(actor, "crossbow-crack-shot") && guns.some((w) => w.group === "crossbow")) n(`Crossbow Crack Shot: the first reload of a crossbow each round gives its next shot +10 feet of range and +${guns.find((w) => w.group === "crossbow") ? diceOf(guns.find((w) => w.group === "crossbow").s) : 1} precision; the plans count it after a reload.`);
    if (unerring) n("Unerring Shot: no range penalty at any distance, and cover is one step worse for the foe (none for lesser, lesser for standard).");
    else if (shootist) n("Shootist's Edge: no penalty in the second and third range increments with a weapon you've mastered.");
    if (piercing) n("Piercing Critical: a 19 that hits is a critical hit with a gun you're legendary in; the plans count it.");
    if (hasAny(actor, "fatal-bullet") && guns.some((w) => w.fatalDie)) n("Fatal Bullet: one more fatal die on a critical hit, after doubling; counted in the plans.");
    if (hasAny(actor, "nightwave-springing-reload")) n("Nightwave Springing Reload (1 action): Leap and reload, or reload and Leap; 2 actions for a High Jump or Long Jump.");
    if (hasAny(actor, "blast-lock")) n("Blast Lock (1 action): shoot a lock within 10 feet open; a miss makes it harder to pick.");
    if (hasAny(actor, "munitions-crafter") || hasAny(actor, "munitions-machinist")) n("Your advanced alchemy makes bombs and alchemical ammunition; Alchemical Shot and Shattering Shot spend them.");
    if (!loadedGuns.length && guns.length && guns.every((w) => w.loadedKnown)) n("Every gun is empty: this turn opens with a reload, or a melee Strike while you load with Reloading Strike if that's your way.");
}

export { gunslinger };
