/**
 * PF2e Tactics: classes/commander.mjs
 * See classes/_common.mjs for the shape of a class read.
 * The advisor drops every profile with the tactic trait (player.mjs adviceBoard), so this read plans all of them: each
 * tactic becomes a plan when its trigger can be read from the board (who stands next to whom, who carries a weapon that
 * reloads, who has a shield down, who is hurt) and a "when" note otherwise. The banner feats, the Strike riders
 * (Set-Up Strike, Guiding Shot, Unsteadying Strike) and the reactions follow. A tactic or banner with a frequency (once
 * per 10 minutes, once a day) is planned only while its uses left (system.frequency.value) aren't 0.
 */
import { bestStrike, canMove, castable, effect, focusLeft, has, hasAny, usesLeft, half, level, markOffGuard, moveText, myReach, allySpeed, pct, squareToReach, strikeRun, targets, worth, degreeChances, feetBetween, inReach, mapFor, strikeExpected, saveExpected, CONDITION_VALUE, nameOf, reachableSquares, signed } from "./_common.mjs";

const BANNER_FEET = 30;
const list = (cs) => cs.map(nameOf).join(", ");
const are = (cs) => (cs.length > 1 ? "are" : "is");
const dieAvg = (n, d) => n * (d + 1) / 2;
/** An ally's equipped weapons, from its sheet (allies are party members; the player can see their gear). */
function weaponsOf(a) {
    const items = a.actor?.itemTypes?.weapon ?? (a.actor?.items ?? []).filter((i) => i.type === "weapon");
    return items.filter((i) => i.isEquipped ?? (i.system?.equipped?.carryType === "held"));
}
const isRangedWeapon = (i) => !!(i.isRanged ?? (Number(i.system?.range) > 0 && !(i.system?.traits?.value ?? []).some((t) => /^thrown/.test(t))));
const reloadOf = (i) => Number(i.system?.reload?.value) || 0;
/** Allies holding a ranged weapon with a reload of 1 or more: Reload! and Ready, Aim, Fire! are for them. */
const reloaders = (a) => weaponsOf(a).filter((i) => isRangedWeapon(i) && reloadOf(i) >= 1);
const hasRanged = (a) => weaponsOf(a).some(isRangedWeapon) || (a.rangedReach ?? 0) > 0;
const hasShield = (a) => !!(a.actor?.heldShield ?? a.actor?.itemTypes?.shield?.some?.((s) => s.isEquipped) ?? (a.actor?.items ?? []).some((i) => i.type === "shield" && (i.isEquipped ?? i.system?.equipped?.carryType === "held")));
const hurt = (a, frac = 0.5) => a.maxHp > 0 && a.hp / a.maxHp <= frac;
const adjacentTo = (a, f) => inReach(a.rect, f.rect, 5);
const canStrideTo = (a, f, mult = 1) => feetBetween(a.rect, f.rect) <= mult * allySpeed(a) + (a.reach ?? 5);

function commander(board, ctx, out) {
    const { me } = board;
    const actor = me.actor;
    const lv = level(board);
    const squad = board.allies.filter((a) => a.actor?.hasPlayerOwner || a.type === "character");
    const up = squad.filter((a) => a.canAct !== false && a.hp > 0);
    const glorious = has(actor, "glorious-banner");
    // a planted banner's aura is a burst 10 feet larger
    const planted = !!effect(actor, /plant(ed)?-banner|banner-planted/);
    const auraFeet = (glorious ? 60 : BANNER_FEET) + (planted ? 10 : 0);
    const inAura = (c) => feetBetween(me.rect, c.rect) <= auraFeet;
    const classDc = actor.classDC?.value ?? actor.system?.attributes?.classDC?.value ?? 10 + lv + 4;
    const int = Number(actor.system?.abilities?.int?.mod ?? me.int ?? 3) || 0;
    /** A tactic or banner feat whose frequency is spent (0 uses left); null (no frequency, or the sheet doesn't say) is usable. */
    const spent = (slug) => usesLeft(actor, slug) === 0;
    const spentNames = [];
    const ok = (slug, name) => { if (!has(actor, slug)) return false; if (spent(slug)) { spentNames.push(name); return false; } return true; };
    /** A foe's HP as the player may quote it: its bar when the party sees it, "an estimate" otherwise. */
    const hpText = (f) => (f.estimated ? "" : ` (${f.hp}/${f.maxHp})`);
    /** A foe the party has seen shoot or cast this fight (the estimate's rangedReach), never its sheet. */
    const shoots = (f) => (f.rangedReach ?? 0) > 0;
    const drilled = has(actor, "drilled-reactions");
    const drillN = has(actor, "practiced-reflexes") ? 4 : has(actor, "drilled-reflexes") ? 2 : 1;
    const drill = drilled ? ` Drilled Reactions: ${drillN > 1 ? `up to ${drillN} responders' reactions` : "one responder's reaction"} for it ${drillN > 1 ? "are" : "is"} free.` : "";
    const foes = targets(board);
    const melee = (c) => c.hasMelee !== false;
    const inSquadAura = up.filter(inAura);
    const round = globalThis.game?.combat?.round ?? 2;
    // An ally's Strike as a reaction (its best melee Strike; a ranged one is read the same, the sheet only carries the melee numbers)
    const allyHit = (a, f, acAdj = 0) => strikeExpected(a.reactiveStrike?.bonus ?? lv + 6, f.ac + acAdj, a.reactiveStrike?.avg ?? 4);
    // A foe's save against your class DC; incapacitation shifts a higher-level foe one degree up
    const foeSave = (f, stat, incap = false) => { const c = degreeChances(f.saves?.[stat] ?? lv + 5, classDc, incap && (f.level ?? lv) > lv ? 1 : 0); return { fail: c.f + c.cf, cf: c.cf, s: c.s, cs: c.cs }; };
    const maneuver = (a, f, bonus = 0) => { const c = degreeChances((a.athletics ?? lv + 2) + bonus, 10 + (f.saves?.fortitude ?? lv + 5)); return c.s + c.cs; };
    const tripChance = (a, f, bonus = 0) => { const c = degreeChances((a.athletics ?? lv + 2) + bonus, 10 + (f.saves?.reflex ?? lv + 5)); return c.s + c.cs; };
    // My own follow-up with what's left: a Strike at f when in reach, else a Stride toward it, a shield, or cover
    const tail = (f, left, acAdj = 0) => {
        if (left < 1) return { steps: [], ev: 0 };
        const bs = f && inReach(me.rect, f.rect, myReach(board)) ? bestStrike(board, f, { made: ctx.made, acAdj }) : null;
        if (bs) return { steps: [{ cost: 1, text: `Strike ${nameOf(f)} with ${bs.s.label} (${signed(bs.bonus)}${acAdj ? ", off-guard" : ""}; hits about ${pct(bs.e.hit)})` }], ev: bs.e.expected };
        return { steps: [{ cost: 1, text: me.shield && !me.shieldRaised ? "Raise a Shield" : f ? `Stride toward ${nameOf(f)}, or Take Cover` : "Take Cover" }], ev: 0 };
    };
    const plan = (title, f, ev, steps, { bias = 0.5, dest = null, notes = [] } = {}) => out.plans.push({ kind: "tactic", title, target: f, ev, score: ev + bias, dest, steps, notes });

    // --- The banner: who it covers, how many tactics are prepared
    const dedicationOnly = actor?.class?.slug !== "commander" && has(actor, "commander-dedication");
    if (has(actor, "commanders-banner") || dedicationOnly) {
        const out_ = squad.filter((a) => !inAura(a));
        out.notes.push(`Banner (${auraFeet} ft${planted ? ", planted" : ""}${dedicationOnly ? ", for your tactics only: the dedication's banner gives no bonus against fear" : `, +${glorious ? 2 : 1} to Will saves and DCs against fear${glorious ? ", +1 AC, Fortitude and Reflex; enemies in it take -2 to Will" : ""}`}): ${list(squad.filter(inAura)) || "nobody"} inside${out_.length ? `; ${list(out_)} outside` : ""}.${has(actor, "battle-tested-companion") ? " On your companion the aura is 10 feet wider." : ""}`);
        if (glorious && foes.some(inAura)) out.notes.push(`Glorious Banner: ${list(foes.filter(inAura))} ${are(foes.filter(inAura))} in the banner, at -2 to Will against your tactics and Demoralize.`);
    }
    const prepared = 3 + (lv >= 7 ? 1 : 0) + (lv >= 15 ? 1 : 0) + (lv >= 19 ? 1 : 0) + (has(actor, "efficient-preparation") ? 1 : 0);
    const tacticItems = (actor.items ?? []).filter((i) => ["action", "feat"].includes(i.type) && (i.system?.traits?.value ?? i.traits ?? []).includes?.("tactic"));
    if (tacticItems.length > prepared) out.notes.push(`${tacticItems.length} tactics on your sheet, ${prepared} prepared a day: only the prepared ones work; the plans below assume these are.`);

    // ===== Mobility tactics (1 action)
    // Pincer Attack (1): squadmates Step; a foe an ally ends adjacent to is off-guard to the squad's melee
    if (has(actor, "pincer-attack") && ctx.actions >= 1) {
        for (const f of foes) {
            const near = up.filter((a) => canMove(a) && melee(a) && feetBetween(a.rect, f.rect) <= 10);
            if (!near.length) continue;
            const adjacent = near.filter((a) => adjacentTo(a, f));
            let ev = near.reduce((sum, a) => sum + 2 * 0.1 * (a.reactiveStrike?.avg ?? 4), 0);
            const steps = [{ cost: 1, text: `Pincer Attack: ${adjacent.length ? `${adjacent.map(nameOf).join(" and ")} ${are(adjacent)} already on ${nameOf(f)}` : `${near.map(nameOf).join(" and ")} can Step to ${nameOf(f)}`}; it's off-guard to the squad's melee until your next turn.${drill}` }];
            let left = ctx.actions - 1;
            const sq = left > 0 ? squareToReach(board, f, myReach(board), left) : null;
            if (sq && left - sq.route.actions >= 1) {
                if (sq.route.actions) { steps.push({ cost: sq.route.actions, text: moveText(sq, f) }); left -= sq.route.actions; }
                const b = bestStrike(board, f, { made: ctx.made, acAdj: -2 });
                if (b) { steps.push({ cost: 1, text: `Strike ${nameOf(f)} with ${b.s.label} (${signed(b.bonus)}, off-guard; hits about ${pct(b.e.hit)})` }); ev += b.e.expected; left -= 1; }
            }
            plan(`Pincer Attack on ${nameOf(f)}`, f, ev, steps, { dest: sq?.route?.actions ? { x: sq.x, y: sq.y } : null, notes: ["Only squadmates who respond get the off-guard; the rest of the party does not."] });
        }
    }
    // Coordinating Maneuvers (1): one squadmate in the banner Steps; next to a foe, it Trips as a reaction
    if (has(actor, "coordinating-maneuvers") && ctx.actions >= 1) {
        for (const f of foes.filter((f) => !f.conditions?.has?.("prone"))) {
            const can = inSquadAura.filter((a) => canMove(a) && feetBetween(a.rect, f.rect) <= 10 && a.canAct !== false);
            if (!can.length) continue;
            const a = can.sort((x, y) => (y.athletics ?? 0) - (x.athletics ?? 0))[0];
            const p = tripChance(a, f);
            const ev = p * worth(board, "prone");
            const t = tail(f, ctx.actions - 1, p > 0.5 ? -2 : 0);
            plan(`Coordinating Maneuvers: ${nameOf(a)} trips ${nameOf(f)}`, f, ev + t.ev * (1 + p * 0.1), [{ cost: 1, text: `Coordinating Maneuvers: ${nameOf(a)} ${adjacentTo(a, f) ? "is on" : "Steps to"} ${nameOf(f)} and Trips it (Athletics ${signed(a.athletics ?? lv + 2)}, lands about ${pct(p)}).${drill}` }, ...t.steps], { notes: ["Prone: off-guard, -2 to its attacks, an action to Stand."] });
        }
    }
    // Passage of Lines (1): everyone in the banner can swap with an adjacent ally; a hurt front-liner trades places with a fresh one
    if (has(actor, "passage-of-lines") && ctx.actions >= 1) {
        for (const a of inSquadAura.filter((a) => hurt(a, 0.4) && foes.some((f) => adjacentTo(a, f)))) {
            const fresh = inSquadAura.filter((b) => b !== a && !hurt(b, 0.6) && inReach(a.rect, b.rect, 5) && !foes.some((f) => adjacentTo(b, f)) && canMove(b));
            if (!fresh.length) continue;
            const f = foes.find((f) => adjacentTo(a, f));
            const b = fresh.sort((x, y) => y.hp - x.hp)[0];
            const ev = strikeExpected(f.reactiveStrike?.bonus ?? lv + 8, a.ac ?? 10 + lv + 5, f.reactiveStrike?.avg ?? 4 + lv * 1.5).expected * 0.8;
            const t = tail(null, ctx.actions - 1);
            plan(`Passage of Lines: ${nameOf(b)} relieves ${nameOf(a)}`, null, ev + t.ev, [{ cost: 1, text: `Passage of Lines: ${nameOf(a)} (${a.hp}/${a.maxHp}) swaps places with ${nameOf(b)} (${b.hp}/${b.maxHp}), out of ${nameOf(f)}'s reach; anyone else in the banner can swap with a neighbour too.` }, ...t.steps], { bias: 0.3 });
        }
    }
    // Protective Screen (1): a squadmate Strides to a caster or archer in the banner, who then casts or shoots without provoking
    if (has(actor, "protective-screen") && ctx.actions >= 1) {
        for (const c of inSquadAura.filter((a) => (a.caster || (hasRanged(a) && !melee(a))))) {
            const threat = foes.filter((f) => adjacentTo(c, f) && f.reactions?.some?.((r) => r.trigger?.onManipulate || r.trigger?.onRanged));
            if (!threat.length) continue;
            const guard = up.filter((a) => a !== c && canMove(a) && feetBetween(a.rect, c.rect) <= allySpeed(a) + 5 && !inReach(a.rect, c.rect, 5) || (a !== c && inReach(a.rect, c.rect, 5)));
            if (!guard.length) continue;
            const g = guard.sort((x, y) => feetBetween(x.rect, c.rect) - feetBetween(y.rect, c.rect))[0];
            const f = threat[0];
            const ev = strikeExpected(f.reactiveStrike?.bonus ?? lv + 8, c.ac ?? 10 + lv + 3, f.reactiveStrike?.avg ?? 4 + lv * 1.5).expected;
            const t = tail(f, ctx.actions - 1);
            plan(`Protective Screen for ${nameOf(c)}`, f, ev + t.ev, [{ cost: 1, text: `Protective Screen: ${nameOf(g)} ${inReach(g.rect, c.rect, 5) ? "stays" : "Strides to stand"} beside ${nameOf(c)}, whose spells and ranged attacks then don't trigger ${nameOf(f)}'s reaction until their next turn ends.${drill}` }, ...t.steps], { bias: 0.3 });
        }
    }
    // Reload! (1): every squadmate with a weapon that reloads does so as a reaction
    if (has(actor, "reload") && ctx.actions >= 1) {
        const who = up.filter((a) => reloaders(a).length);
        if (who.length) {
            const ev = who.reduce((s, a) => s + 0.5 * (a.reactiveStrike?.avg ?? 4), 0);
            const t = tail(foes[0] ?? null, ctx.actions - 1);
            plan(`Reload! for ${list(who)}`, null, ev + t.ev, [{ cost: 1, text: `Reload!: ${who.map((a) => `${nameOf(a)} (${reloaders(a).map((w) => w.name).join(", ")})`).join(", ")} ${are(who)} reloaded as a reaction, an action saved each.${drill}` }, ...t.steps], { bias: 0.3 });
        }
    }
    // Shields Up! (1): every squadmate in the banner with a shield down raises it
    if (has(actor, "shields-up") && ctx.actions >= 1) {
        const who = inSquadAura.filter((a) => hasShield(a) && !a.shieldRaised);
        if (who.length) {
            const ev = 2.5 * who.length;
            const t = tail(foes[0] ?? null, ctx.actions - 1);
            plan(`Shields Up! for ${list(who)}`, null, ev + t.ev, [{ cost: 1, text: `Shields Up!: ${list(who)} Raise${who.length > 1 ? "" : "s"} a Shield as a reaction (a caster with the shield cantrip can cast it instead).${drill}` }, ...t.steps], { bias: 0.3 });
        }
    }
    // Gather to Me! (1): everyone Strides into the banner; worth a note when the squad is scattered
    if (has(actor, "gather-to-me")) {
        const far = squad.filter((a) => !inAura(a) && canMove(a) && !board.enemies.some((e) => inReach(a.rect, e.rect, 5)));
        if (far.length) out.notes.push(`Gather to Me! (1 action): ${list(far)} ${are(far)} outside the banner and not engaged${far.length > 1 ? "; each could Stride into it as a reaction" : " and could Stride into it as a reaction"}.${drill}`);
    }
    if (has(actor, "take-the-high-ground")) out.notes.push(`Take the High Ground (1 action): a squadmate Strides to another and Leaps ${lv >= 15 ? "40 feet across or 25 up" : "25 feet across or 15 up"} off them, onto a ledge or over a line.`);
    if (has(actor, "defensive-retreat") && up.filter((a) => hurt(a, 0.4) && foes.some((f) => adjacentTo(a, f))).length >= 2) out.notes.push(`Defensive Retreat (2 actions): ${list(up.filter((a) => hurt(a, 0.4)))} ${are(up.filter((a) => hurt(a, 0.4)))} hurt and engaged; everyone in the banner Steps three times away from the foes, free.`);
    if (has(actor, "wait-for-it")) out.notes.push("Wait For It... (1 action): two squadmates who Delay or Ready get +1 AC and saves until they act; one can get a drilled reaction for the readied action.");
    if (has(actor, "mountaineering-training")) out.notes.push("Mountaineering Training (1 action): the squad gets a climb Speed of 20 feet until your next turn.");
    if (has(actor, "naval-training")) out.notes.push("Naval Training (1 action): the squad gets a swim Speed of 20 feet until your next turn.");
    if (has(actor, "shadows-in-the-moonlight") && foes.some((f) => f.state !== "observed")) out.notes.push("Shadows in the Moonlight (1 or 2 actions): the squad Hides and Sneaks as if Following the Expert; for 2 actions two squadmates Hide or Sneak at once.");
    if (has(actor, "alley-oop")) out.notes.push("Alley-Oop (1 action): a squadmate in the banner tosses a one-action consumable (an elixir, activated ammunition) to another, who catches and uses it as a reaction.");

    // ===== Offensive tactics
    // Strike Hard! (2): one squadmate in the banner Strikes as a reaction
    if (has(actor, "strike-hard") && ctx.actions >= 2) {
        const options = [];
        for (const a of inSquadAura) for (const f of foes) {
            const inRange = adjacentTo(a, f) || inReach(a.rect, f.rect, a.reach ?? 5) || (hasRanged(a) && feetBetween(a.rect, f.rect) <= (a.rangedReach || 30));
            if (!inRange) continue;
            const h = allyHit(a, f);
            if (h.expected >= 0.5) options.push({ a, f, h });
        }
        options.sort((x, y) => y.h.expected - x.h.expected);
        for (const { a, f, h } of options.slice(0, 2)) {
            const t = tail(f, ctx.actions - 2);
            plan(`Strike Hard!: ${nameOf(a)} on ${nameOf(f)}`, f, h.expected + t.ev, [{ cost: 2, text: `Strike Hard!: ${nameOf(a)} Strikes ${nameOf(f)} as a reaction (${signed(a.reactiveStrike?.bonus ?? lv + 6)}, hits about ${pct(h.hit)}; at their own multiple attack penalty if they've already attacked this round).${drill}` }, ...t.steps]);
        }
    }
    // Double Team (2): one squadmate Shoves or Repositions a foe in their reach; if it lands beside another squadmate, that one Strikes as a reaction
    if (has(actor, "double-team") && ctx.actions >= 2) {
        for (const f of foes) {
            for (const a of up.filter((x) => inReach(x.rect, f.rect, x.reach ?? 5))) {
                const others = up.filter((b) => b !== a && melee(b) && feetBetween(b.rect, f.rect) <= 10);
                if (!others.length) continue;
                const b = others.sort((x, y) => (y.reactiveStrike?.avg ?? 0) - (x.reactiveStrike?.avg ?? 0))[0];
                const p = maneuver(a, f);
                const hit = allyHit(b, f);
                const ev = p * hit.expected;
                const t = tail(f, ctx.actions - 2);
                plan(`Double Team ${nameOf(f)}`, f, ev + t.ev, [{ cost: 2, text: `Double Team: signal ${nameOf(a)} (${nameOf(f)} in reach): they Shove or Reposition it as a free action (Athletics ${signed(a.athletics ?? lv + 2)}, lands about ${pct(p)}); pushed next to ${nameOf(b)}, ${nameOf(b)} Strikes it as a reaction.${drill}` }, ...t.steps]);
            }
        }
    }
    // Tactical Takedown (2): two squadmates in the banner Stride half their Speed; both adjacent to a foe → Reflex vs class DC or prone
    if (has(actor, "tactical-takedown") && ctx.actions >= 2) {
        for (const f of foes.filter((f) => !f.conditions?.has?.("prone"))) {
            const can = inSquadAura.filter((a) => canMove(a) && feetBetween(a.rect, f.rect) <= half(allySpeed(a)) + 5);
            if (can.length < 2) continue;
            const pair = can.sort((x, y) => feetBetween(x.rect, f.rect) - feetBetween(y.rect, f.rect)).slice(0, 2);
            const s = foeSave(f, "reflex");
            const ev = s.fail * worth(board, "prone");
            const t = tail(f, ctx.actions - 2, s.fail > 0.5 ? -2 : 0);
            plan(`Tactical Takedown on ${nameOf(f)}`, f, ev + t.ev * (1 + s.fail * 0.1), [{ cost: 2, text: `Tactical Takedown: signal ${pair.map(nameOf).join(" and ")}; each Strides half their Speed to ${nameOf(f)}, and it saves (Reflex vs your class DC ${classDc}) or falls prone: about ${pct(s.fail)}.${drill}` }, ...t.steps], { notes: ["Prone: off-guard, -2 to its attacks, and it spends an action to Stand (which can set off Reactive Strikes)."] });
        }
    }
    // Demoralizing Charge (2): two squadmates Stride at a foe and Strike; each hit makes it save or be frightened
    if (has(actor, "demoralizing-charge") && ctx.actions >= 2) {
        for (const f of foes) {
            const can = inSquadAura.filter((a) => canMove(a) && melee(a) && canStrideTo(a, f)).sort((x, y) => allyHit(y, f).expected - allyHit(x, f).expected).slice(0, 2);
            if (!can.length) continue;
            const hits = can.map((a) => allyHit(a, f));
            const pHitAny = 1 - hits.reduce((p, h) => p * (1 - h.hit), 1);
            const pen = can.length === 2 ? 1 : 0;
            const c = degreeChances((f.saves?.will ?? lv + 5) - pen, classDc);
            const fright = (c.f + c.cf) * worth(board, "frightened") + c.cf * worth(board, "frightened");
            const ev = hits.reduce((s, h) => s + h.expected, 0) + pHitAny * fright;
            const t = tail(f, ctx.actions - 2);
            plan(`Demoralizing Charge on ${nameOf(f)}`, f, ev + t.ev, [{ cost: 2, text: `Demoralizing Charge: ${can.map(nameOf).join(" and ")} Stride${can.length > 1 ? "" : "s"} to ${nameOf(f)} and Strike${can.length > 1 ? "" : "s"} it as a reaction (${hits.map((h) => pct(h.hit)).join(", ")}); a hit makes it save (Will vs ${classDc}${pen ? ", at -1 for the double" : ""}) or be frightened 1 (2 on a critical failure).${drill}` }, ...t.steps]);
        }
    }
    // End It! (2, incapacitation): the squad outnumbers the foes and one went down since your last turn; everyone Steps and foes within 10 ft flee
    if (has(actor, "end-it") && ctx.actions >= 2) {
        const outnumber = up.length + 1 > foes.length;
        const downed = (board.downEnemies ?? []).length > 0;
        if (outnumber && downed) {
            const near = foes.filter((f) => [me, ...inSquadAura].some((a) => feetBetween(a.rect, f.rect) <= 15));
            if (near.length) {
                const ev = near.reduce((s, f) => { const sv = foeSave(f, "will", true); return s + sv.fail * worth(board, "fleeing") + sv.cf * worth(board, "frightened", 2); }, 0);
                const t = tail(near[0], ctx.actions - 2);
                plan(`End It! (${list(near)})`, near[0], ev + t.ev, [{ cost: 2, text: `End It!: you and every squadmate in the banner Step toward a foe; ${list(near)} then save${near.length > 1 ? "" : "s"} (Will vs ${classDc}) or flee${near.length > 1 ? "" : "s"} for a round (frightened 2 as well on a critical failure).` }, ...t.steps], { notes: ["Incapacitation: a foe above your level treats its save as one degree better."] });
            }
        } else out.notes.push(`End It! (2 actions) needs the squad to outnumber the foes and one to have dropped since your last turn${!outnumber ? "; you don't outnumber them yet" : "; nobody has dropped"}.`);
    }
    // The Bigger They Are (1): a squadmate with a foe in reach Shoves, Trips or Repositions it, with +1 per adjacent helper
    if (has(actor, "the-bigger-they-are") && ctx.actions >= 1) {
        for (const f of foes) {
            for (const a of inSquadAura.filter((x) => inReach(x.rect, f.rect, x.reach ?? 5))) {
                const helpers = up.filter((b) => b !== a && (inReach(b.rect, a.rect, 5) || adjacentTo(b, f)));
                if (!helpers.length) continue;
                const bonus = Math.min(4, helpers.length);
                const p = f.conditions?.has?.("prone") ? maneuver(a, f, bonus) : tripChance(a, f, bonus);
                const cond = f.conditions?.has?.("prone") ? "shoved" : "prone";
                const ev = p * (cond === "prone" ? worth(board, "prone") : 2);
                const t = tail(f, ctx.actions - 1, cond === "prone" && p > 0.5 ? -2 : 0);
                plan(`The Bigger They Are: ${nameOf(a)} on ${nameOf(f)}`, f, ev + t.ev, [{ cost: 1, text: `The Bigger They Are: ${nameOf(a)} ${cond === "prone" ? "Trips" : "Shoves or Repositions"} ${nameOf(f)} with ${list(helpers)} assisting as a reaction: +${bonus} and a target up to ${bonus} size${bonus > 1 ? "s" : ""} larger (Athletics ${signed((a.athletics ?? lv + 2) + bonus)}, about ${pct(p)}).${drill}` }, ...t.steps]);
            }
        }
    }
    // Pop, Drop, and Lock (2, once per 10 minutes): up to three squadmates with the same foe in reach: one Strikes, one Trips, one Grapples
    if (ok("pop-drop-and-lock", "Pop, Drop, and Lock") && ctx.actions >= 2) {
        for (const f of foes) {
            const on = inSquadAura.filter((a) => inReach(a.rect, f.rect, a.reach ?? 5));
            if (on.length < 2) continue;
            const three = on.slice(0, 3);
            const striker = three.sort((x, y) => allyHit(y, f).expected - allyHit(x, f).expected)[0];
            const rest = three.filter((a) => a !== striker).sort((x, y) => (y.athletics ?? 0) - (x.athletics ?? 0));
            let ev = allyHit(striker, f).expected;
            const parts = [`${nameOf(striker)} Strikes`];
            if (rest[0]) { const p = tripChance(rest[0], f); ev += p * worth(board, "prone"); parts.push(`${nameOf(rest[0])} Trips (about ${pct(p)})`); }
            if (rest[1]) { const p = maneuver(rest[1], f); ev += p * worth(board, "grabbed"); parts.push(`${nameOf(rest[1])} Grapples (about ${pct(p)})`); }
            if (ev < 0.5) continue;
            const t = tail(f, ctx.actions - 2);
            plan(`Pop, Drop, and Lock on ${nameOf(f)}`, f, ev + t.ev, [{ cost: 2, text: `Pop, Drop, and Lock (once per 10 minutes): ${parts.join(", ")} ${nameOf(f)} as reactions, in any order.${drill}` }, ...t.steps]);
        }
    }
    // Ready, Aim, Fire! (2, once per 10 minutes): up to three archers in the banner reload free and shoot a foe as a reaction
    if (ok("ready-aim-fire", "Ready, Aim, Fire!") && ctx.actions >= 2) {
        const archers = inSquadAura.filter((a) => hasRanged(a) || a.caster);
        if (archers.length && foes.length) {
            for (const f of foes.slice(0, 2)) {
                const three = archers.filter((a) => feetBetween(a.rect, f.rect) <= (a.rangedReach || 60)).slice(0, 3);
                if (!three.length) continue;
                const ev = three.reduce((s, a) => s + allyHit(a, f).expected, 0);
                const t = tail(f, ctx.actions - 2);
                plan(`Ready, Aim, Fire! at ${nameOf(f)}`, f, ev + t.ev, [{ cost: 2, text: `Ready, Aim, Fire! (once per 10 minutes): ${list(three)} reload free and shoot ${nameOf(f)} as a reaction (a caster can throw a damaging cantrip instead).${drill}` }, ...t.steps]);
            }
        }
    }
    // Executioner's Volley (2, once a day): you and every archer in the banner shoot one foe; it dies, the rest save or are frightened 2
    if (ok("executioners-volley", "Executioner's Volley") && ctx.actions >= 2) {
        const archers = inSquadAura.filter(hasRanged);
        const mine = board.strikes.filter((s) => s.ranged);
        if (archers.length + mine.length >= 2 && foes.length) {
            const f = foes.sort((x, y) => x.hp - y.hp)[0];
            let ev = archers.reduce((s, a) => s + allyHit(a, f).expected, 0);
            const b = mine.length ? bestStrike(board, f, { made: ctx.made, melee: false }) : null;
            if (b) ev += b.e.expected;
            const t = tail(null, ctx.actions - 2);
            plan(`Executioner's Volley at ${nameOf(f)}`, f, ev + t.ev, [{ cost: 2, text: `Executioner's Volley (once a day): ${list(archers)}${b ? ` and you (${b.s.label} ${signed(b.bonus)})` : ""} shoot ${nameOf(f)}${hpText(f)} as reactions, the damage pooled against its resistances; if it dies, every other foe in the banner saves or is frightened 2.${drill}` }, ...t.steps], { bias: 0.2 });
        }
    }
    // Roaring Charge (2, once per 10 minutes): the squad Strides twice its Speed at the foes; foes within 10 ft of a squadmate save or are frightened
    if (ok("roaring-charge", "Roaring Charge") && ctx.actions >= 2) {
        const chargers = inSquadAura.filter((a) => canMove(a));
        if (chargers.length && foes.length) {
            const reached = foes.filter((f) => chargers.some((a) => canStrideTo(a, f, 2)));
            if (reached.length) {
                const ev = reached.reduce((s, f) => { const sv = foeSave(f, "will", true); return s + sv.s * worth(board, "frightened") + (sv.fail - sv.cf) * worth(board, "frightened", 2) + sv.cf * (worth(board, "frightened", 3) + worth(board, "fleeing")); }, 0);
                const t = tail(reached[0], ctx.actions - 2);
                plan(`Roaring Charge at ${list(reached)}`, reached[0], ev + t.ev, [{ cost: 2, text: `Roaring Charge (once per 10 minutes): ${list(chargers)} Stride${chargers.length > 1 ? "" : "s"} twice their Speed at the foes as a reaction; ${list(reached)} then save${reached.length > 1 ? "" : "s"} (Will vs ${classDc}): frightened 1 even on a success, 2 on a failure, 3 and fleeing on a critical failure.${drill}` }, ...t.steps], { notes: ["Incapacitation: a foe above your level treats its save as one degree better."] });
            }
        }
    }
    // Cry Havoc! (3, once a day): squadmates Stride up to twice their Speed directly toward one target; each enemy a squadmate
    // comes adjacent to on the way saves or takes 2d6+2d6, plus 2d6+2d6 per squadmate taking part
    if (ok("cry-havoc", "Cry Havoc!") && ctx.actions >= 3 && foes.length) {
        const chargers = inSquadAura.filter((a) => canMove(a));
        const centre = (r) => ({ x: r.x + (r.w - 1) / 2, y: r.y + (r.h - 1) / 2 });
        /** The foes a squadmate comes adjacent to on a straight run toward t, up to twice its Speed (sampled every half square). */
        const passed = (a, t) => {
            const from = centre(a.rect), to = centre(t.rect);
            const len = Math.hypot(to.x - from.x, to.y - from.y);
            const run = Math.min(2 * allySpeed(a), Math.max(0, feetBetween(a.rect, t.rect) - 5)) / 5;
            const hit = new Set();
            if (!len) return hit;
            for (let k = 0; k <= Math.ceil(run * 2); k++) {
                const d = Math.min(run, k / 2);
                const at = { ...a.rect, x: Math.round(from.x + ((to.x - from.x) / len) * d - (a.rect.w - 1) / 2), y: Math.round(from.y + ((to.y - from.y) / len) * d - (a.rect.h - 1) / 2) };
                for (const g of foes) if (feetBetween(at, g.rect) <= 5) hit.add(g);
            }
            return hit;
        };
        const avg = dieAvg(2, 6) * 2 * (1 + chargers.length);
        let best = null;
        for (const f of chargers.length ? foes : []) {
            const caught = [...new Set(chargers.flatMap((a) => [...passed(a, f)]))];
            if (!caught.length) continue;
            const ev = caught.reduce((t, g) => t + saveExpected(g.saves?.fortitude ?? lv + 5, classDc, avg, { basic: true }).expected, 0);
            if (!best || ev > best.ev) best = { f, caught, ev };
        }
        if (best) plan(`Cry Havoc! at ${nameOf(best.f)}`, best.f, best.ev, [{ cost: 3, text: `Cry Havoc! (once a day): ${list(chargers)} Stride${chargers.length > 1 ? "" : "s"} up to twice their Speed straight at ${nameOf(best.f)}; ${list(best.caught)}, whom they come up beside, save${best.caught.length > 1 ? "" : "s"} (basic Fortitude vs ${classDc}) or take about ${avg} split bludgeoning and sonic (deafened on a critical failure), then are immune to it for a day.${drill}` }], { bias: 0.2 });
    }
    // Bloody Guillotine (2, once a day): three squadmates Stride half their Speed at a foe and Strike or Trip; the first hit makes it save or die
    if (ok("bloody-guillotine", "Bloody Guillotine") && ctx.actions >= 2 && foes.length) {
        for (const f of foes.filter((f) => (f.level ?? lv) <= lv + 1)) {
            const three = inSquadAura.filter((a) => canMove(a) && melee(a) && canStrideTo(a, f, 0.5)).sort((x, y) => allyHit(y, f).expected - allyHit(x, f).expected).slice(0, 3);
            if (!three.length) continue;
            const hits = three.map((a) => allyHit(a, f));
            const pHitAny = 1 - hits.reduce((p, h) => p * (1 - h.hit), 1);
            const sv = foeSave(f, "fortitude", true);
            const ev = hits.reduce((s, h) => s + h.expected, 0) + pHitAny * sv.fail * Math.max(0, f.hp - hits.reduce((s, h) => s + h.expected, 0));
            if (ev < 0.5) continue;
            const t = tail(f, ctx.actions - 2);
            plan(`Bloody Guillotine on ${nameOf(f)}`, f, ev + t.ev, [{ cost: 2, text: `Bloody Guillotine (once a day): ${list(three)} Stride${three.length > 1 ? "" : "s"} half their Speed to ${nameOf(f)} and Strike${three.length > 1 ? "" : "s"} it as ${three.length > 1 ? "reactions" : "a reaction"} (${hits.map((h) => pct(h.hit)).join(", ")}); the first hit makes it save (Fortitude vs ${classDc}) or die: about ${pct(sv.fail)}. Foes who watch it die save or are sickened 1.${drill}` }, ...t.steps], { bias: 0.2, notes: ["A death and incapacitation effect: a foe above your level treats its save as one degree better."] });
        }
    }
    // Buckle-Cut Blitz / Stupefying Raid (2): two squadmates Stride; every foe they pass beside saves or is clumsy 1 / stupefied 1
    for (const [slug, cond, name] of [["buckle-cut-blitz", "clumsy", "Buckle-Cut Blitz"], ["stupefying-raid", "stupefied", "Stupefying Raid"]]) {
        if (!has(actor, slug) || ctx.actions < 2) continue;
        const runners = inSquadAura.filter((a) => canMove(a)).sort((x, y) => allySpeed(y) - allySpeed(x)).slice(0, 2);
        if (!runners.length) continue;
        const touched = foes.filter((f) => runners.some((a) => feetBetween(a.rect, f.rect) <= allySpeed(a) + 5));
        if (!touched.length) continue;
        const ev = touched.reduce((s, f) => { const sv = foeSave(f, cond === "clumsy" ? "reflex" : "will"); return s + sv.fail * worth(board, cond) + sv.cf * worth(board, cond); }, 0);
        const t = tail(touched[0], ctx.actions - 2);
        plan(`${name} past ${list(touched)}`, touched[0], ev + t.ev, [{ cost: 2, text: `${name}: ${list(runners)} Stride${runners.length > 1 ? "" : "s"} as a reaction past ${list(touched)}, who save${touched.length > 1 ? "" : "s"} (vs ${classDc}) or ${are(touched)} ${cond} 1 for a round (2 on a critical failure).${drill}` }, ...t.steps], { bias: 0.3 });
    }
    // Corpse Crenellation (2, once per 10 minutes): two squadmates Stride half and Strike a foe; a kill leaves cover
    if (ok("corpse-crenellation", "Corpse Crenellation") && ctx.actions >= 2) {
        for (const f of foes.filter((f) => f.hp <= (f.maxHp || 1) * 0.4).slice(0, 2)) {
            const two = inSquadAura.filter((a) => canMove(a) && (canStrideTo(a, f, 0.5) || hasRanged(a))).sort((x, y) => allyHit(y, f).expected - allyHit(x, f).expected).slice(0, 2);
            if (!two.length) continue;
            const ev = two.reduce((s, a) => s + allyHit(a, f).expected, 0);
            if (ev < 0.5) continue;
            const t = tail(f, ctx.actions - 2);
            plan(`Corpse Crenellation on ${nameOf(f)}`, f, ev + t.ev, [{ cost: 2, text: `Corpse Crenellation (once per 10 minutes): ${list(two)} Stride${two.length > 1 ? "" : "s"} half their Speed and Strike ${nameOf(f)}${hpText(f)} as reactions; if it drops, its body is lesser cover for the squad around it until your next turn.${drill}` }, ...t.steps], { bias: 0.3 });
        }
    }
    // Sanguine Revitalization (2, once a day): the squad's edged weapons Stride half and Strike; a damaged foe saves or bleeds 10 persistent
    if (ok("sanguine-revitalization", "Sanguine Revitalization") && ctx.actions >= 2) {
        for (const f of foes.slice(0, 2)) {
            const cutters = inSquadAura.filter((a) => canMove(a) && melee(a) && canStrideTo(a, f, 0.5));
            if (!cutters.length) continue;
            const hits = cutters.map((a) => allyHit(a, f));
            const expectedHits = hits.reduce((s, h) => s + h.hit, 0);
            const pHitAny = 1 - hits.reduce((p, h) => p * (1 - h.hit), 1);
            const c = degreeChances((f.saves?.fortitude ?? lv + 5) - Math.min(4, Math.round(expectedHits)), classDc);
            const ev = hits.reduce((s, h) => s + h.expected, 0) + pHitAny * (c.f + c.cf) * 10 * 1.5;
            if (ev < 0.5) continue;
            const t = tail(f, ctx.actions - 2);
            plan(`Sanguine Revitalization on ${nameOf(f)}`, f, ev + t.ev, [{ cost: 2, text: `Sanguine Revitalization (once a day): ${list(cutters)} with piercing or slashing weapons Stride half their Speed and Strike ${nameOf(f)} as reactions; if it took damage it saves (Fortitude vs ${classDc}, -1 per hit) or bleeds 10 a round.${drill}` }, ...t.steps], { bias: 0.2 });
        }
    }
    // Slip and Sizzle (2): a squadmate beside a foe Trips it; a caster squadmate then casts a damaging spell at it as a reaction
    if (has(actor, "slip-and-sizzle") && ctx.actions >= 2) {
        for (const f of foes.filter((f) => !f.conditions?.has?.("prone"))) {
            const tripper = inSquadAura.filter((a) => adjacentTo(a, f)).sort((x, y) => (y.athletics ?? 0) - (x.athletics ?? 0))[0];
            const caster = inSquadAura.find((a) => a.caster && a !== tripper);
            if (!tripper || !caster) continue;
            const p = tripChance(tripper, f);
            const ev = p * (worth(board, "prone") + 2 + lv * 1.5);
            const t = tail(f, ctx.actions - 2, p > 0.5 ? -2 : 0);
            plan(`Slip and Sizzle on ${nameOf(f)}`, f, ev + t.ev, [{ cost: 2, text: `Slip and Sizzle: ${nameOf(tripper)} Trips ${nameOf(f)} (about ${pct(p)}); if it falls, ${nameOf(caster)} casts a damaging ranged spell of 2 actions or fewer at it as a reaction (a slot or focus spell leaves them slowed 1 next turn).${drill}` }, ...t.steps]);
        }
    }
    // Mirrored Wall (2, once per 10 minutes): a raised shield in the banner blinds a foe within 60 ft
    if (ok("mirrored-wall", "Mirrored Wall") && ctx.actions >= 2) {
        const shields = inSquadAura.filter((a) => hasShield(a) || a.shieldRaised);
        if (shields.length && foes.length) {
            const f = foes.filter((g) => feetBetween(me.rect, g.rect) <= 60).sort((x, y) => (y.level ?? 0) - (x.level ?? 0))[0];
            if (f) {
                const sv = foeSave(f, "fortitude");
                const ev = sv.fail * worth(board, "blinded") + sv.cf * worth(board, "dazzled", 3);
                const t = tail(f, ctx.actions - 2);
                plan(`Mirrored Wall on ${nameOf(f)}`, f, ev + t.ev, [{ cost: 2, text: `Mirrored Wall (once per 10 minutes, needs bright light or a lantern): the squad Raises Shields as a reaction, and ${nameOf(shields[0])}'s shield throws light into ${nameOf(f)}'s eyes: it saves (vs ${classDc}) or is blinded for a round (then dazzled 3 rounds on a critical failure).${drill}` }, ...t.steps], { bias: 0.3 });
            }
        }
    }
    if (ok("seek-and-destroy", "Seek and Destroy") && (board.enemies.some((e) => e.state !== "observed") || (board.unseenKnown ?? 0) > 0)) out.notes.push(`Seek and Destroy (2 actions, once per 10 minutes): two squadmates Seek free, then Point Out, Stride or Strike as a reaction; a foe they find takes ${half(lv)} extra precision from their next hit.`);
    if (ok("piranha-assault", "Piranha Assault") && foes.some((f) => f.iwr?.resist?.length)) out.notes.push(`Piranha Assault (1 action, once per 10 minutes): for a minute the squad ignores ${lv} of ${list(foes.filter((f) => f.iwr?.resist?.length))}'s resistance on every hit.`);
    if (ok("insta-ballista", "Insta-Ballista") && ctx.actions >= 2) out.notes.push("Insta-Ballista (2 actions, once a day): the squadmates you chose at preparation Stride into a knot and fire a ballista at a foe within 200 feet, +1 to hit per helper.");
    if (ok("for-talmandor-for-freedom", "For Talmandor! For Freedom!")) {
        const afflicted = [me, ...inSquadAura].filter((c) => ["clumsy", "controlled", "frightened", "slowed", "stunned", "confused", "fascinated", "paralyzed", "sickened", "stupefied"].some((k) => c.conditions?.has?.(k)));
        if (afflicted.length) out.notes.push(`For Talmandor! For Freedom! (1 action, once a day): a counteract (Warfare Lore) against one effect on each of ${afflicted.map((c) => (c === me ? "you" : nameOf(c))).join(", ")}: mental effects, or anything imposing clumsy, controlled, frightened, slowed, stunned and the like.`);
    }
    if (ok("valkyries-charge", "Valkyrie's Charge") && ctx.actions >= 3 && (board.downAllies?.length || up.filter((a) => hurt(a, 0.4)).length >= 2)) out.notes.push(`Valkyrie's Charge (3 actions, once a day): every squadmate in the banner heals${board.downAllies?.length ? `, ${list(board.downAllies)} Stand${board.downAllies.length > 1 ? "" : "s"} free` : ""}, Strides twice toward a foe and Strikes it as a reaction.`);

    // ===== Banner feats
    if (has(actor, "plant-banner") && ctx.actions >= 1 && !effect(actor, /plant(ed)?-banner|banner-planted/)) {
        const temp = 4 * (1 + Math.floor(lv / 4));
        const covered = up.filter((a) => feetBetween(me.rect, a.rect) <= 30);
        const engaged = covered.filter((a) => foes.some((f) => adjacentTo(a, f)));
        if (engaged.length >= 2 || (engaged.length && covered.length >= 3)) {
            const ev = covered.reduce((s, a) => s + (foes.some((f) => adjacentTo(a, f)) ? 0.6 : 0.2) * temp, 0);
            const t = tail(foes[0] ?? null, ctx.actions - 1);
            plan(`Plant Banner for ${list(covered)}`, null, ev + t.ev, [{ cost: 1, text: `Plant Banner: ${list(covered)} get${covered.length > 1 ? "" : "s"} ${temp} temporary HP each round they start within 30 feet of it${has(actor, "claim-the-field") ? " (Claim the Field: throw it to any corner in the weapon's first range increment instead)" : ""}; the banner's aura grows by 10 feet, and you signal by voice alone.` }, ...t.steps], { bias: 0.3, notes: ["A banner on a weapon takes that weapon out of your hands while it's planted."] });
        }
    }
    if (has(actor, "defiant-banner") && ctx.actions >= 1) {
        const engaged = [me, ...inSquadAura].filter((a) => foes.some((f) => adjacentTo(a, f) || (f.reach ?? 5) > 5 && inReach(f.rect, a.rect, f.reach)));
        if (engaged.length >= 2) {
            const ev = engaged.length * int * 1.2;
            const t = tail(foes[0] ?? null, ctx.actions - 1);
            plan(`Defiant Banner for ${engaged.map((c) => (c === me ? "you" : nameOf(c))).join(", ")}`, null, ev + t.ev, [{ cost: 1, text: `Defiant Banner: you and everyone in the banner resist ${int} physical damage per hit until your next turn.` }, ...t.steps], { bias: 0.3 });
        }
    }
    if (ok("rallying-banner", "Rallying Banner") && ctx.actions >= 1 && !effect(actor, /rallying-banner/)) {
        // 4d6 at 8th, +1d6 at 10th and every 2 levels after; each ally in the banner's aura, not you
        const heal = dieAvg(4 + Math.max(0, Math.floor((lv - 8) / 2)), 6);
        const wounded = inSquadAura.filter((a) => a.hp < a.maxHp);
        if (wounded.length) {
            const ev = wounded.reduce((s, a) => s + 0.8 * Math.min(heal, a.maxHp - a.hp), 0);
            const t = tail(foes[0] ?? null, ctx.actions - 1);
            plan(`Rallying Banner (${wounded.map((c) => nameOf(c)).join(", ")})`, null, ev + t.ev, [{ cost: 1, text: `Rallying Banner (once per 10 minutes): about ${Math.round(heal)} HP to each ally in the banner: ${wounded.map((c) => `${nameOf(c)} (${c.hp}/${c.maxHp})`).join(", ")}.` }, ...t.steps], { bias: 0.3 });
        }
    }
    if (ok("quickening-banner", "Quickening Banner") && ctx.actions >= 1 && inSquadAura.length) {
        const ev = inSquadAura.reduce((s, a) => s + 0.6 * (a.reactiveStrike?.avg ?? 4), 0);
        const t = tail(foes[0] ?? null, ctx.actions - 1);
        plan(`Quickening Banner for ${list(inSquadAura)}`, null, ev + t.ev, [{ cost: 1, text: `Quickening Banner (once per 10 minutes): ${list(inSquadAura)} ${are(inSquadAura)} quickened for a round, an extra Stride or Strike each.` }, ...t.steps], { bias: 0.4 });
    }
    if (ok("pennant-of-victory", "Pennant of Victory") && ctx.actions >= 1 && inSquadAura.length) {
        const ev = [me, ...inSquadAura].reduce((s, a) => s + 2 * (0.1 * (a.reactiveStrike?.avg ?? 4) * 4 + 4 * 0.6), 0) + 40 * 0.3 * (inSquadAura.length + 1);
        const t = tail(foes[0] ?? null, ctx.actions - 1);
        plan("Pennant of Victory", null, ev + t.ev, [{ cost: 1, text: `Pennant of Victory (once per 10 minutes): you and ${list(inSquadAura)} get +4 to attack and damage, +10 feet of Speed and 40 temporary HP until your next turn.` }, ...t.steps], { bias: 0.5 });
    }
    if (has(actor, "banner-twirl") && ctx.actions >= 1) {
        const shooters = foes.filter(shoots);
        const adj = up.filter((a) => inReach(me.rect, a.rect, 5));
        if (shooters.length) {
            const ev = (adj.length + 1) * 0.2 * (shooters[0].reactiveStrike?.avg ?? 4 + lv * 1.5);
            const t = tail(foes[0] ?? null, ctx.actions - 1);
            plan("Banner Twirl", null, ev + t.ev, [{ cost: 1, text: `Banner Twirl: you${adj.length ? ` and ${list(adj)}` : ""} ${adj.length ? "are" : "are"} concealed from ranged attacks until your next turn (${list(shooters)} shoot${shooters.length > 1 ? "" : "s"}).` }, ...t.steps], { bias: 0.2 });
        }
    }
    if (has(actor, "banners-inspiration") && ctx.actions >= 1) {
        const scared = inSquadAura.filter((a) => a.conditions?.has?.("frightened") || a.conditions?.has?.("confused") || a.conditions?.has?.("fascinated") || a.conditions?.has?.("controlled"));
        if (scared.length) {
            const ev = scared.reduce((s, a) => s + worth(board, a.conditions.has("frightened") ? "frightened" : "confused") * 0.7, 0);
            const t = tail(foes[0] ?? null, ctx.actions - 1);
            plan(`Banner's Inspiration for ${list(scared)}`, null, ev + t.ev, [{ cost: 1, text: `Banner's Inspiration: ${list(scared)} drop${scared.length > 1 ? "" : "s"} frightened by 1 and get${scared.length > 1 ? "" : "s"} a new save against one mental effect (then immune to this for 10 minutes).` }, ...t.steps], { bias: 0.3 });
        }
    }
    if (has(actor, "confusing-commands") && ctx.actions >= 2) {
        const inside = foes.filter(inAura);
        if (inside.length) {
            const ev = inside.reduce((s, f) => { const sv = foeSave(f, "will"); return s + sv.fail * worth(board, "confused") + sv.cf * worth(board, "confused"); }, 0);
            const t = tail(inside[0], ctx.actions - 2);
            plan(`Confusing Commands (${list(inside)})`, inside[0], ev + t.ev, [{ cost: 2, text: `Confusing Commands: ${list(inside)} save${inside.length > 1 ? "" : "s"} (Will vs ${classDc}) or ${are(inside)} confused for a round (two on a critical failure); a success makes it immune for a day.` }, ...t.steps]);
        }
    }
    if (has(actor, "demand-surrender") && ctx.actions >= 2) {
        const outnumber = up.length + 1 > foes.length;
        const downed = (board.downEnemies ?? []).length > 0;
        if (outnumber && downed && foes.length) {
            const f = foes.sort((x, y) => (y.level ?? 0) - (x.level ?? 0))[0];
            const sv = foeSave(f, "will", true);
            const ev = (sv.s + sv.fail) * 3 + sv.fail * worth(board, "frightened") + sv.cf * worth(board, "prone", 3);
            const t = tail(f, ctx.actions - 2);
            plan(`Demand Surrender from ${nameOf(f)}`, f, ev + t.ev, [{ cost: 2, text: `Demand Surrender: ${nameOf(f)} saves (Will vs ${classDc}): on anything but a critical success it can't target you for a round; on a failure it's frightened too; on a critical failure it drops its weapons and lies down for a minute, until someone attacks it.` }, ...t.steps], { notes: ["Incapacitation: a foe above your level treats its save as one degree better."] });
        } else out.notes.push("Demand Surrender (2 actions) needs the squad to outnumber the foes and one of them dying or dropped since your last turn.");
    }
    if (has(actor, "mercenary-reversal") && ctx.actions >= 2) {
        if (foes.length > up.length + 1) {
            const f = foes.sort((x, y) => (y.level ?? 0) - (x.level ?? 0))[0];
            const sv = foeSave(f, "will", true);
            const ev = sv.s * worth(board, "stunned") + sv.fail * worth(board, "controlled");
            const t = tail(f, ctx.actions - 2);
            plan(`Mercenary Reversal on ${nameOf(f)}`, f, ev + t.ev, [{ cost: 2, text: `Mercenary Reversal (you're outnumbered): ${nameOf(f)} saves (Will vs ${classDc}): stunned 1 on a success, and on a failure it changes sides for the fight (a new save whenever it takes damage).` }, ...t.steps], { notes: ["Incapacitation: a foe above your level treats its save as one degree better."] });
        } else out.notes.push("Mercenary Reversal (2 actions) works only while the foes outnumber the squad.");
    }

    // ===== Your own Strikes that set up an ally
    const allyFollowAvg = Math.max(0, ...up.map((a) => a.reactiveStrike?.avg ?? 4));
    const setupRider = (hit, crit) => {
        let bonus = 0;
        if (has(actor, "targeting-strike")) bonus += hit * int * 0.6;
        if (has(actor, "fortunate-blow")) bonus += hit * 0.2 * allyFollowAvg;
        return bonus;
    };
    if (has(actor, "set-up-strike") && ctx.actions >= 1 && up.length) {
        for (const f of foes) {
            const sq = squareToReach(board, f, myReach(board), ctx.actions - 1);
            const ranged = board.strikes.some((s) => s.ranged);
            if (!sq && !ranged) continue;
            const moveActs = sq ? sq.route.actions : 0;
            const b = bestStrike(board, f, { made: ctx.made, melee: !!sq });
            if (!b) continue;
            const ev = b.e.expected + b.e.hit * (2 * 0.1 * allyFollowAvg + 0.2) + setupRider(b.e.hit, b.e.crit);
            const steps = moveActs ? [{ cost: moveActs, text: moveText(sq, f) }] : [];
            steps.push({ cost: 1, text: `Set-Up Strike ${nameOf(f)} with ${b.s.label} (${signed(b.bonus)}, hits about ${pct(b.e.hit)}): a hit leaves it off-guard to the next ally's attack${has(actor, "targeting-strike") ? `, with ${int} extra precision` : ""}${has(actor, "fortunate-blow") ? ", rolled twice" : ""}` });
            const left = ctx.actions - 1 - moveActs;
            const run = left > 0 ? strikeRun(board, f, left, { made: ctx.made + 1 }) : null;
            if (run?.used.length) steps.push({ cost: run.used.length, text: run.text });
            plan(`Set-Up Strike on ${nameOf(f)}`, f, ev + (run?.ev ?? 0), steps, { bias: 0.3, dest: moveActs ? { x: sq.x, y: sq.y } : null, notes: ["Flourish: one a turn. The off-guard is for one ally's next attack before your next turn."] });
        }
    }
    if (has(actor, "guiding-shot") && ctx.actions >= 1 && up.length && board.strikes.some((s) => s.ranged)) {
        for (const f of foes) {
            const b = bestStrike(board, f, { made: ctx.made, melee: false });
            if (!b) continue;
            const ev = b.e.expected + b.e.hit * 0.1 * allyFollowAvg + b.e.crit * 0.1 * allyFollowAvg + setupRider(b.e.hit, b.e.crit);
            plan(`Guiding Shot at ${nameOf(f)}`, f, ev, [{ cost: 1, text: `Guiding Shot ${nameOf(f)} with ${b.s.label} (${signed(b.bonus)}, hits about ${pct(b.e.hit)}): a hit gives the next ally to attack it +1 (+2 on a critical hit)${has(actor, "targeting-strike") ? `, and ${int} extra precision` : ""}${has(actor, "fortunate-blow") ? ", rolled twice" : ""}` }], { bias: 0.3, notes: ["Flourish: one a turn."] });
        }
    }
    if (has(actor, "unsteadying-strike") && ctx.actions >= 1) {
        for (const f of foes) {
            const grapplers = up.filter((a) => melee(a) && feetBetween(a.rect, f.rect) <= 10 && (a.athletics ?? 0) >= lv + 2);
            if (!grapplers.length || !inReach(me.rect, f.rect, myReach(board))) continue;
            const b = bestStrike(board, f, { made: ctx.made });
            if (!b) continue;
            const ev = b.e.expected + b.e.hit * 0.1 * worth(board, "grabbed") * 2;
            plan(`Unsteadying Strike on ${nameOf(f)}`, f, ev, [{ cost: 1, text: `Unsteadying Strike ${nameOf(f)} with ${b.s.label} (${signed(b.bonus)}, hits about ${pct(b.e.hit)}): a hit gives it -2 to its DC against ${list(grapplers)}'s Grapple, Shove, Reposition or Disarm until your next turn` }], { bias: 0.2, notes: ["Flourish: one a turn."] });
        }
    }

    // ===== Reactions and the rest, as when notes
    if (has(actor, "defensive-swap")) {
        const weak = up.filter((a) => inReach(me.rect, a.rect, 5) && hurt(a, 0.4) && me.hp > a.hp);
        if (weak.length) out.notes.push(`Defensive Swap (reaction): when ${list(weak)} ${are(weak)} attacked, you trade places and take the hit (${me.hp}/${me.maxHp} against ${weak.map((a) => `${a.hp}/${a.maxHp}`).join(", ")}).`);
    }
    if (has(actor, "standard-bearers-sacrifice") && foes.some(shoots)) out.notes.push(`Standard-Bearer's Sacrifice (reaction, banner in hand): a foe aiming a ranged attack at an ally within its range of you saves (vs ${classDc}) or shoots you instead.`);
    if (round <= 1) {
        if (has(actor, "rapid-assessment")) out.notes.push(`Rapid Assessment (free, at initiative): Recall Knowledge about ${has(actor, "perfected-evaluations") ? "up to six foes" : "a foe"} you can see${has(actor, "warfare-expertise") ? ", with Warfare Lore" : ""}.`);
        if (has(actor, "adaptive-stratagem")) out.notes.push(`Adaptive Stratagem (free, at initiative): swap one prepared ${has(actor, "contact-with-the-enemy") ? "tactic" : "expert, mobility or offensive tactic"} for another in your folio.`);
    }
    if (has(actor, "combat-assessment")) out.notes.push(`Combat Assessment (1 action): a Strike and a Recall Knowledge about the target${has(actor, "observational-analysis") ? ", at +2 when someone attacked it since your last turn (+4 on a crit)" : ""}${has(actor, "unrivaled-analysis") ? "; up to four checks" : ""}.`);
    if (has(actor, "deceptive-tactics")) out.notes.push(`Deceptive Tactics: Feint and Create a Diversion with Warfare Lore (${signed(Number(actor.skills?.["warfare-lore"]?.mod ?? actor.skills?.warfareLore?.mod ?? lv + int + 4) || lv + int + 4)}) instead of Deception.`);
    if (has(actor, "shielded-recovery") && me.shield && has(actor, "battle-medicine")) {
        const patient = up.filter((a) => inReach(me.rect, a.rect, 5) && hurt(a, 0.6));
        if (patient.length) out.notes.push(`Shielded Recovery: Battle Medicine with your shield hand; ${list(patient)} would also get +1 AC and Reflex while beside you.`);
    }
    if (has(actor, "desperate-resuscitation") && board.downAllies?.length && ctx.actions >= 3) out.notes.push(`Desperate Resuscitation (3 actions, healer's kit): a Medicine check brings back ${list(board.downAllies)} if dead no more than 3 rounds, wounded one more.`);
    if (has(actor, "battle-hardened-companion") || has(actor, "peerless-mascot-companion")) out.notes.push(`Your companion acts once on your turn for free (a Stride or Strike) and keeps a reaction for your tactics${has(actor, "peerless-mascot-companion") ? "; as a peerless mascot it carries a second banner aura" : ""}.`);
    else if (hasAny(actor, "commanders-companion")) out.notes.push("Commander's Companion: your companion is always a squadmate; Command an Animal gives it a reaction for your tactics this turn.");
    if (spentNames.length) out.notes.push(`Spent for now (no uses left on your sheet): ${spentNames.join(", ")}.`);
    if (drilled && !out.notes.some((n) => /Drilled/.test(n)) && !out.plans.some((p) => /Drilled/.test(p.steps[0]?.text ?? ""))) out.notes.push(`Drilled Reactions: once per round, ${drillN > 1 ? `up to ${drillN} allies` : "one ally"} responding to your tactic get${drillN > 1 ? "" : "s"} a free reaction for it.`);
}

export { commander };
