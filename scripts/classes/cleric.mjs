/**
 * PF2e Tactics: classes/cleric.mjs
 * See classes/_common.mjs for the shape of a class read.
 * The advisor already plans every spell on the board (heal on a hurt ally, a revive, harm as a save spell, bless as a
 * buff). This read adds the cleric layer: the font (what's left, what each casting does), the turns the advisor can't
 * compose (the 30-foot heal around you, Channel Smite, Restorative Strike, Cast Down, Sanctify Armament), the doctrine,
 * the domain pool, and "when" notes for the feats that ride on a heal or a harm.
 */
import { bestStrike, canMove, castable, choiceOf, effect, focusLeft, has, half, level, spendsSlot, markOffGuard, moveText, myReach, allySpeed, pct, squareToReach, strikeRun, targets, worth, degreeChances, feetBetween, inReach, mapFor, strikeExpected, saveExpected, CONDITION_VALUE, nameOf, reachableSquares, signed } from "./_common.mjs";

const isUndead = (c) => (c?.traits ?? []).includes("undead");
const itemsOf = (actor) => actor?.items?.contents ?? (Array.isArray(actor?.items) ? actor.items : []);
const itemById = (actor, id) => actor?.items?.get?.(id) ?? itemsOf(actor).find((i) => i.id === id) ?? null;
const hitWorth = (lv) => Math.max(4, 6 + 1.6 * lv);

/**
 * The divine font as the sheet shows it: which spells it holds, how many are still prepared and unexpended, at what
 * rank, and the die each rolls. Counts every prepared Heal and Harm (font slots and ordinary ones alike), since the
 * sheet doesn't tell them apart; a sheet that prepares spells but no Heal or Harm has none. With no prepared slots to
 * read it falls back to the spells on the board.
 * kinds is the font (the Divine Font's own choice, else the deity's, both with Versatile Font); heal/harm.usable is
 * whether one is prepared and unexpended, whatever slot it sits in (Channel Smite and Cast Down take either).
 */
function fontOf(actor, board) {
    const lv = actor?.level ?? 1;
    const deity = itemsOf(actor).find((i) => i.type === "deity");
    const chosen = choiceOf(actor, "divine-font", "divineFont");
    const deityFont = (chosen ? [chosen] : deity?.system?.font ?? []).map((f) => String(f).toLowerCase());
    const versatile = has(actor, "versatile-font");
    let heal = 0, harm = 0, rank = 0, read = false;
    const entries = actor?.spellcasting?.regular ?? [];
    for (const entry of Array.isArray(entries) ? entries : entries.contents ?? []) {
        const slots = entry?.system?.slots ?? {};
        for (const [key, slot] of Object.entries(slots)) {
            const r = Number(/slot(\d+)/.exec(key)?.[1]);
            if (!r || r > 9 || !Array.isArray(slot?.prepared)) continue;
            for (const p of slot.prepared) {
                if (p?.id) read = true;
                if (!p?.id || p.expended) continue;
                const sp = entry.spells?.get?.(p.id) ?? (Array.isArray(entry.spells) ? entry.spells.find((x) => x.id === p.id) : null) ?? itemById(actor, p.id);
                const name = (sp?.name ?? "").toLowerCase();
                if (name === "heal") { heal += 1; rank = Math.max(rank, r); }
                else if (name === "harm") { harm += 1; rank = Math.max(rank, r); }
            }
        }
    }
    const onBoard = (n) => (board.spells ?? []).find((sp) => sp.name.toLowerCase() === n && !sp.consumable);
    const healSp = onBoard("heal"), harmSp = onBoard("harm");
    if (!read) { heal = healSp ? null : 0; harm = harmSp ? null : 0; rank = Math.max(healSp?.rank ?? 0, harmSp?.rank ?? 0); }
    if (!rank) rank = Math.min(9, Math.ceil(lv / 2));
    const kinds = versatile ? ["heal", "harm"] : deityFont.length ? deityFont.filter((f) => f === "heal" || f === "harm") : [heal !== 0 ? "heal" : null, harm !== 0 ? "harm" : null].filter(Boolean);
    const max = lv >= 15 ? 6 : lv >= 5 ? 5 : 4;
    return {
        kinds, rank, max, versatile,
        heal: { left: heal, die: has(actor, "healing-hands") ? 5.5 : 4.5, sp: healSp, usable: heal !== 0 && !!(healSp || read) },
        harm: { left: harm, die: has(actor, "harming-hands") ? 5.5 : 4.5, sp: harmSp, usable: harm !== 0 && !!(harmSp || read) },
        dc: healSp?.dc ?? harmSp?.dc ?? (board.spells ?? []).find((sp) => sp.dc)?.dc ?? 10 + lv + 4 + (lv >= 19 ? 4 : lv >= 15 ? 3 : lv >= 7 ? 2 : 1),
    };
}
const leftText = (f) => (f.left === null ? "some" : String(f.left));

/** Strikes with the deity's favored weapon, as far as the labels tell (the deity item lists base weapons). */
function favoredStrikes(board, actor) {
    const deity = itemsOf(actor).find((i) => i.type === "deity");
    const names = (deity?.system?.weapons ?? []).map((w) => String(w).toLowerCase().replace(/-/g, " "));
    if (!names.length) return [];
    return board.strikes.filter((s) => names.some((n) => s.label.toLowerCase().includes(n)));
}

function cleric(board, ctx, out) {
    const actor = board.me.actor;
    const me = board.me;
    const lv = level(board);
    if (!(has(actor, "divine-font") || has(actor, "cleric-spellcasting") || has(actor, "cleric-dedication") || actor?.class?.slug === "cleric")) return;
    const warpriest = has(actor, "warpriest") || has(actor, "first-doctrine-warpriest");
    const cloistered = has(actor, "cloistered-cleric") || has(actor, "first-doctrine-cloistered-cleric");
    const creed = has(actor, "battle-creed") || has(actor, "initial-creed");
    const myTraits = actor?.system?.traits?.value ?? actor?.traits ?? [];
    const sanct = myTraits.includes("holy") ? "holy" : myTraits.includes("unholy") ? "unholy" : null;
    const opposed = sanct === "holy" ? "unholy" : sanct === "unholy" ? "holy" : null;
    const font = fontOf(actor, board);
    const fast = has(actor, "fast-channel");
    const foes = targets(board);
    const living = foes.filter((f) => !isUndead(f) && f.hp > 0);
    const undead = foes.filter((f) => isUndead(f) && f.hp > 0);
    const favored = favoredStrikes(board, actor);
    const hurt = (c) => Math.max(0, (c.maxHp ?? 0) - (c.hp ?? 0));
    const allies = (board.allies ?? []).filter((a) => a.hp > 0);
    const down = (board.downAllies ?? []).filter((d) => d.hp <= 0 || d.conditions?.has?.("dying"));
    const touchAvg = (k) => font[k].die * font.rank;
    const R = font.rank;

    // --- The font: what's left and what each casting does ---------------------------------------------------------
    if (font.kinds.length && has(actor, "divine-font")) {
        const parts = [];
        if (font.kinds.includes("heal")) parts.push(`${leftText(font.heal)} heal${font.heal.left === 1 ? "" : "s"} at rank ${R}: 1 action touches for about ${Math.round(touchAvg("heal"))} HP, 2 actions reach 30 feet for about ${Math.round(touchAvg("heal") + 8 * R)}, ${fast ? "2 actions (Fast Channel)" : "3 actions"} heal every living creature within 30 feet of you for about ${Math.round(touchAvg("heal"))}, foes included`);
        if (font.kinds.includes("harm")) parts.push(`${leftText(font.harm)} harm${font.harm.left === 1 ? "" : "s"} at rank ${R}: 1 action touches for about ${Math.round(touchAvg("harm"))} void damage (basic Fortitude), 2 actions reach 30 feet, ${fast ? "2 actions (Fast Channel)" : "3 actions"} hit every living creature within 30 feet of you, allies included`);
        out.notes.push(`Divine Font: ${parts.join("; ")}.`);
        if (font.heal.left === 0 && font.kinds.includes("heal") && !font.heal.sp) out.notes.push("No heal spells left today: Battle Medicine, potions or a scroll are what remain.");
    }

    // --- The 30-foot heal around you: several hurt allies, or a fallen one plus others; the advisor only plans one target
    const burstCost = fast ? 2 : 3;
    if (font.heal.usable && ctx.actions >= burstCost) {
        const avg = touchAvg("heal");
        const near = (c) => feetBetween(me.rect, c.rect) <= 30 && (!c.rect?.lvl || !me.rect?.lvl || c.rect.lvl === me.rect.lvl);
        const healed = [{ c: me, self: true }, ...allies.map((c) => ({ c, self: false }))].filter(({ c }) => near(c) && !isUndead(c) && hurt(c) > 0);
        const fallen = down.filter((d) => near(d) && !isUndead(d));
        const livingFoes = living.filter(near);
        const undeadFoes = undead.filter(near);
        const gains = healed.map(({ c, self }) => ({ c, self, v: Math.min(avg, hurt(c)) * 0.8 * (self ? 1 : 0.9) }));
        const back = fallen.map((d) => ({ c: d, v: Math.min(avg, d.maxHp ?? avg) * 0.8 + 0.8 * 1.1 * hitWorth(d.level ?? lv) * 2 }));
        const selective = has(actor, "selective-energy") ? 5 : 0;
        const losses = livingFoes.map((f) => ({ c: f, v: Math.min(avg, hurt(f)) * 0.8 })).sort((a, b) => b.v - a.v);
        const kept = losses.slice(selective);
        const excluded = losses.slice(0, selective);
        const undeadDmg = undeadFoes.reduce((t, f) => t + saveExpected(f.saves?.fortitude ?? lv + 8, font.dc, avg, { basic: true }).expected, 0);
        const recipients = gains.length + back.length;
        const meaningful = gains.filter((g) => g.v >= 2).length + back.length;
        if (recipients >= 2 && meaningful >= 2) {
            const ev = gains.reduce((t, g) => t + g.v, 0) + back.reduce((t, b) => t + b.v, 0) + undeadDmg - kept.reduce((t, l) => t + l.v, 0);
            if (ev > 0) {
                const who = [...back.map((b) => nameOf(b.c)), ...gains.map((g) => (g.self ? "you" : nameOf(g.c)))];
                const list = who.length > 1 ? `${who.slice(0, -1).join(", ")} and ${who.at(-1)}` : who[0];
                let text = `Heal (${burstCost} actions${fast ? ", Fast Channel" : ""}): 30-foot emanation, about ${Math.round(avg)} HP to ${list}`;
                if (undeadFoes.length) text += `, and about ${Math.round(avg)} vitality damage to ${undeadFoes.map(nameOf).join(", ")} (basic Fortitude)`;
                if (excluded.length) text += `; Selective Energy keeps it off ${excluded.map((l) => nameOf(l.c)).join(", ")}`;
                if (kept.length) text += `; ${kept.map((l) => nameOf(l.c)).join(", ")} ${kept.length > 1 ? "are" : "is"} living and heal${kept.length > 1 ? "" : "s"} too${has(actor, "directed-channel") ? " (Directed Channel can make it a 30-foot cone instead, aimed away from them)" : ""}`;
                const notes = [`It spends one of your ${leftText(font.heal)} heal spells.`];
                if (back.length) notes.push(`${back.map((b) => nameOf(b.c)).join(", ")} ${back.length > 1 ? "are" : "is"} down: healed, ${back.length > 1 ? "they stand" : "it stands"} next turn${has(actor, "resurrectionist") ? ", with fast healing 5 for a minute (Resurrectionist)" : ""}.`);
                if (has(actor, "remediate")) notes.push("Remediate (free, once an hour): this casting also tries to counteract one divine effect in the area.");
                out.plans.push({ kind: "class", title: `Heal everyone around you`, target: null, ev, score: ev + 0.3, dest: null, steps: [{ cost: burstCost, text }], notes });
            }
        }
    }
    // A fallen ally the touch heal reaches: the advisor plans the revive; Heroic Recovery and Resurrectionist ride on it
    if (down.length && font.heal.usable) {
        const riders = [];
        if (has(actor, "heroic-recovery")) riders.push("Heroic Recovery first (1 action): the one you heal stands up free of charge and gets +1 to attacks and damage until the end of its next turn");
        if (has(actor, "resurrectionist")) riders.push("Resurrectionist: a dying ally you heal gets fast healing 5 for a minute");
        if (riders.length) out.notes.push(`Healing ${down.map(nameOf).join(" or ")} back up: ${riders.join("; ")}.`);
    }

    // --- Channel Smite: a melee Strike that carries a 1-action font spell, the target failing its save outright ----
    if (has(actor, "channel-smite") && ctx.actions >= 2) {
        for (const f of foes.filter((x) => x.hp > 0)) {
            const kind = isUndead(f) ? "heal" : "harm";
            if (!font[kind].usable) continue;
            const sq = squareToReach(board, f, myReach(board), ctx.actions - 2);
            if (!sq) continue;
            const b = bestStrike(board, f, { made: ctx.made });
            if (!b) continue;
            const spAvg = touchAvg(kind);
            const ev = b.e.expected + b.e.hit * spAvg + b.e.crit * spAvg;
            const steps = [];
            if (sq.route.actions) steps.push({ cost: sq.route.actions, text: moveText(sq, f) });
            steps.push({ cost: 2, text: `Channel Smite ${nameOf(f)} with ${b.s.label} (${signed(b.bonus)}, hits about ${pct(b.e.hit)}): on a hit, rank-${R} ${kind} adds about ${Math.round(spAvg)} ${kind === "harm" ? "void" : "vitality"} damage with no save (double on a critical hit)` });
            const left = ctx.actions - 2 - sq.route.actions;
            const notes = [`It spends one of your ${leftText(font[kind])} ${kind} spells, hit or miss${has(actor, "rebounding-smite") ? "; on a miss, Rebounding Smite (reaction) throws the 1-action spell at another creature instead" : ""}.`];
            let total = ev;
            if (left >= 1) { const r = strikeRun(board, f, left, { made: ctx.made + 1 }); if (r.used.length) { steps.push({ cost: r.used.length, text: r.text }); total += r.ev; } }
            out.plans.push(spendsSlot({ kind: "class", title: `Channel Smite ${nameOf(f)}`, target: f, ev: total, score: total + 0.3, dest: sq.route.actions ? { x: sq.x, y: sq.y } : null, steps, notes }, font[kind].sp ?? (kind === "heal" ? "Heal" : "Harm"), R));
        }
    }

    // --- Restorative Strike: a 1-action heal on yourself, then a melee Strike; a hit heals a second creature beside the foe
    if (has(actor, "restorative-strike") && ctx.actions >= 2 && font.heal.usable && !isUndead(me)) {
        const avg = touchAvg("heal");
        const selfGain = Math.min(avg, hurt(me)) * 0.8;
        const plans = [];
        for (const f of foes.filter((x) => x.hp > 0)) {
            const sq = squareToReach(board, f, myReach(board), ctx.actions - 2);
            if (!sq) continue;
            // The best Strike, the favored weapon at +1
            let b = null;
            for (const s of board.strikes.filter((s) => !s.ranged)) {
                const bonus = s.bonus + mapFor(ctx.made, s.agile) + (favored.includes(s) ? 1 : 0);
                const e = strikeExpected(bonus, f.ac, s.avg, { deadly: s.deadly });
                if (!b || e.expected > b.e.expected) b = { s, bonus, e };
            }
            if (!b) continue;
            const second = allies.filter((a) => !isUndead(a) && inReach(a.rect, f.rect, 5) && hurt(a) > 0).sort((x, y) => hurt(y) - hurt(x))[0] ?? null;
            const secondGain = second ? Math.min(avg, hurt(second)) * 0.8 * 0.9 * b.e.hit : 0;
            if (selfGain + secondGain < 2) continue;
            const ev = selfGain + b.e.expected + secondGain;
            const steps = [];
            if (sq.route.actions) steps.push({ cost: sq.route.actions, text: moveText(sq, f) });
            steps.push({ cost: 2, text: `Restorative Strike: heal yourself for about ${Math.round(Math.min(avg, hurt(me)))} HP, then Strike ${nameOf(f)} with ${b.s.label} (${signed(b.bonus)}${favored.includes(b.s) ? ", +1 with your deity's weapon" : ""})${second ? `; on a hit ${nameOf(second)}, beside it, heals the same` : ""}` });
            const left = ctx.actions - 2 - sq.route.actions;
            let total = ev;
            if (left >= 1) { const r = strikeRun(board, f, left, { made: ctx.made + 1 }); if (r.used.length) { steps.push({ cost: r.used.length, text: r.text }); total += r.ev; } }
            plans.push({ kind: "class", title: `Restorative Strike ${nameOf(f)}`, target: f, ev: total, score: total + 0.2, dest: sq.route.actions ? { x: sq.x, y: sq.y } : null, steps, notes: [`It spends one of your ${leftText(font.heal)} heal spells.`] });
        }
        // The three best: one a foe, and most of them say the same thing
        out.plans.push(...plans.sort((a, b) => b.ev - a.ev).slice(0, 3));
    }

    // --- Cast Down: a 1-action spellshape, then a font spell on one foe; any damage knocks it prone -----------------
    if (has(actor, "cast-down") && ctx.actions >= 2) {
        const prone = worth(board, "prone");
        for (const f of foes.filter((x) => x.hp > 0 && !x.conditions?.has?.("prone"))) {
            const kind = isUndead(f) ? "heal" : "harm";
            if (!font[kind].usable) continue;
            const avg = touchAvg(kind);
            const sv = saveExpected(f.saves?.fortitude ?? lv + 8, font.dc, avg, { basic: true });
            const value = sv.expected + prone * (1 - sv.chances.cs) + sv.critFail * 1;
            const dist = feetBetween(me.rect, f.rect);
            let steps = null, cost = 0, dest = null;
            if (dist <= 5) { steps = [{ cost: 2, text: `Cast Down, then touch ${nameOf(f)} with a 1-action ${kind}: about ${Math.round(avg)} ${kind === "harm" ? "void" : "vitality"} damage (basic Fortitude, fails about ${pct(sv.fail)}) and it's knocked prone if it takes any` }]; cost = 2; }
            else if (dist <= 30 && ctx.actions >= 3) { steps = [{ cost: 3, text: `Cast Down, then a 2-action ${kind} at ${nameOf(f)} (30 feet): about ${Math.round(avg)} ${kind === "harm" ? "void" : "vitality"} damage (basic Fortitude, fails about ${pct(sv.fail)}) and it's knocked prone if it takes any` }]; cost = 3; }
            else if (ctx.actions >= 3) {
                const sq = squareToReach(board, f, 5, 1);
                if (!sq || !sq.route.actions) continue;
                steps = [{ cost: 1, text: moveText(sq, f) }, { cost: 2, text: `Cast Down, then touch ${nameOf(f)} with a 1-action ${kind}: about ${Math.round(avg)} damage (basic Fortitude, fails about ${pct(sv.fail)}) and it's knocked prone if it takes any` }]; cost = 3; dest = { x: sq.x, y: sq.y };
            }
            if (!steps) continue;
            const notes = [`It spends one of your ${leftText(font[kind])} ${kind} spells. On a critical failure it's also 10 feet slower for a minute.`];
            const left = ctx.actions - cost;
            let total = value;
            if (left >= 1 && dist <= 5) { const r = strikeRun(board, f, left, { made: ctx.made, acAdj: -2 }); if (r.used.length) { steps.push({ cost: r.used.length, text: `${r.text}, prone so off-guard if the spell landed` }); total += r.ev * (1 - sv.chances.cs) + strikeRun(board, f, left, { made: ctx.made }).ev * sv.chances.cs; } }
            out.plans.push(spendsSlot({ kind: "class", title: `Cast Down ${nameOf(f)}`, target: f, ev: total, score: total + 0.3, dest, steps, notes }, font[kind].sp ?? (kind === "heal" ? "Heal" : "Harm"), R));
        }
    }

    // --- Sanctify Armament: a round of +2d6 spirit against the opposed sanctification -------------------------------
    if (has(actor, "sanctify-armament") && sanct && ctx.actions >= 2) {
        const up = effect(actor, /sanctify-armament/);
        const marks = foes.filter((f) => f.hp > 0 && (f.traits ?? []).includes(opposed));
        if (up) out.notes.push(`Sanctify Armament is up: your weapon is ${sanct} and deals +2d6 spirit against ${opposed} creatures${marks.length ? ` (${marks.map(nameOf).join(", ")})` : ""}.`);
        else for (const f of marks) {
            const sq = squareToReach(board, f, myReach(board), ctx.actions - 2);
            if (!sq) continue;
            const left = ctx.actions - 1 - sq.route.actions;
            if (left < 1) continue;
            const r = strikeRun(board, f, left, { made: ctx.made, extra: 7 });
            if (!r.used.length) continue;
            const steps = [{ cost: 1, text: `Sanctify Armament: your weapon is ${sanct} and deals +2d6 spirit against ${opposed} creatures ${has(actor, "lasting-armament") ? "for an hour" : "this round"}` }];
            if (sq.route.actions) steps.push({ cost: sq.route.actions, text: moveText(sq, f) });
            steps.push({ cost: r.used.length, text: `${r.text}, +2d6 spirit` });
            out.plans.push({ kind: "class", title: `Sanctify, then Strike ${nameOf(f)}`, target: f, ev: r.ev, score: r.ev + 0.3, dest: sq.route.actions ? { x: sq.x, y: sq.y } : null, steps, notes: [] });
        }
    }

    // --- Doctrine ------------------------------------------------------------------------------------------------
    if (warpriest) {
        const bits = [];
        if (me.shield) bits.push(`Shield Block is yours from the doctrine${has(actor, "emblazon-armament") ? "; an emblazoned shield blocks 1 more" : ""}${lv >= 14 && has(actor, "channeling-block") ? "; Channeling Block can spend a heal or harm for +1d8 Hardness per rank on one block" : ""}`);
        if (has(actor, "deadly-simplicity")) bits.push("Deadly Simplicity: your deity's weapon rolls one die size up (in your Strike numbers)");
        if (lv >= 7) bits.push(`your deity's weapon applies its critical specialization${lv >= 19 ? " (master proficiency now)" : ""}`);
        if (bits.length) out.notes.push(`Warpriest: ${bits.join("; ")}.`);
    } else if (creed) {
        out.notes.push(`Battle creed: martial weapons, expert at 5, master with your deity's weapon at 13; no healing font, so your heals are your ordinary slots.`);
    } else if (cloistered && lv >= 11) out.notes.push("Cloistered cleric: your deity's weapon applies its critical specialization on a critical hit, against your spell DC.");
    if (has(actor, "emblazon-armament") && !warpriest) out.notes.push(`Emblazon Armament: your emblazoned weapon's +1 damage is in your Strike numbers${has(actor, "emblazon-energy") ? ", or it deals +1d4 of its energy" : ""}; an emblazoned shield blocks 1 more.`);

    // --- Domain spells and the focus pool -----------------------------------------------------------------------
    const focus = focusLeft(actor);
    const fmax = actor?.system?.resources?.focus?.max ?? 0;
    if (focus !== null && (has(actor, "domain-initiate") || has(actor, "expanded-domain-initiate") || has(actor, "advanced-domain"))) {
        const riders = [];
        if (has(actor, "shield-of-faith")) riders.push("+1 AC until your next turn after a domain spell (Shield of Faith)");
        if (has(actor, "deitys-protection")) riders.push(`resistance ${Math.min(9, Math.ceil(lv / 2))} to all damage until your next turn after a domain spell (Deity's Protection)`);
        out.notes.push(focus > 0 ? `Domain spells: ${focus} of ${fmax} Focus Point${fmax === 1 ? "" : "s"} left; they're among your spell options${riders.length ? `, and each casting gives ${riders.join(" and ")}` : ""}.`
            : `No Focus Points left for your domain spells${has(actor, "surging-focus") ? " (Surging Focus: once a day, one comes back when an ally you can see drops)" : ""}; Refocus after the fight${has(actor, "domain-focus") ? " refills the whole pool (Domain Focus)" : ""}.`);
    }

    // --- Feats that ride on a heal or harm: say when, the advisor plans the spell ------------------------------------
    const hurtAllies = allies.filter((a) => hurt(a) > 0);
    if (hurtAllies.length || hurt(me) > 0) {
        const riders = [];
        if (has(actor, "heroic-recovery") && hurtAllies.length && !(down.length && font.heal.usable)) riders.push("Heroic Recovery (1 action before a heal on one living creature): +1 to its attacks and damage and +5 feet of Speed until the end of its next turn, and it Stands free if prone");
        if (has(actor, "divine-infusion") && hurtAllies.some((a) => a.hasMelee)) riders.push(`Divine Infusion (1 action before a heal on one creature): its melee Strikes deal +${R >= 8 ? "3d6" : R >= 5 ? "2d6" : "1d6"} vitality until the end of its next turn`);
        if (has(actor, "defensive-recovery")) riders.push("Defensive Recovery (1 action before a heal on one creature): +2 to its AC and saves for a round");
        if (has(actor, "communal-healing") && hurtAllies.length + (hurt(me) > 0 ? 1 : 0) >= 2) riders.push(`Communal Healing: a heal on one creature gives another in range ${R} HP too`);
        if (has(actor, "martyr") && hurtAllies.length && me.hp > me.maxHp * 0.6) riders.push(`Martyr (1 action before a heal on one ally): you lose ${R}d8 HP and the ally regains that much more`);
        if (riders.length) out.notes.push(`${riders.join(". ")}.`);
    }
    if (has(actor, "ebb-and-flow") && font.kinds.length && (undead.length ? hurtAllies.length : living.length && allies.some(isUndead))) out.notes.push("Ebb and Flow (1 action before a 1- or 2-action heal or harm): the spell damages one creature in range and heals another at the same time.");
    if (has(actor, "divine-weapon") && board.strikes.length && castable(board, (sp) => !sp.cantrip && !sp.consumable).length) out.notes.push(`Divine Weapon (free, once a turn, after a spell from a slot): your weapon deals +1d4 spirit until the end of your turn${sanct ? `, 2d4 against ${opposed} creatures` : ""}; cast first, then Strike.`);
    if (has(actor, "divine-castigation") && sanct && foes.some((f) => (f.traits ?? []).includes(opposed))) out.notes.push(`Divine Castigation: a heal or harm can carry your ${sanct} trait and deal spirit damage to ${opposed} creatures (${foes.filter((f) => (f.traits ?? []).includes(opposed)).map(nameOf).join(", ")})${has(actor, "castigating-weapon") ? `; Castigating Weapon then adds ${R} spirit to your Strikes until the end of your turn` : ""}.`);
    if (undead.length) {
        const u = undead.map(nameOf).join(", ");
        if (font.heal.usable) {
            const bits = [];
            if (has(actor, "panic-the-dead")) bits.push("one that fails is frightened 1 (and fleeing on a critical failure)");
            if (has(actor, "cremate-undead")) bits.push(`one it damages takes ${R} persistent fire`);
            out.notes.push(`Heal damages the undead here (${u}): ${Math.round(touchAvg("heal"))} vitality, basic Fortitude${bits.length ? `; ${bits.join("; ")}` : ""}.`);
        }
        if (has(actor, "command-undead") && font.harm.usable) out.notes.push(`Command Undead (1 action, then harm on one undead of level ${lv - 3} or lower): a Will save; on a failure it's your minion for ${has(actor, "improved-command-undead") ? "10 minutes (a round even on a plain success, a day on a critical failure)" : "a minute"}, until you or an ally attacks it.`);
    }
    if (living.length && font.harm.usable && has(actor, "void-siphon")) out.notes.push("Void Siphon: a living creature that critically fails against your harm is drained 1.");
    if (living.length && font.harm.usable && has(actor, "sap-life")) out.notes.push(`Sap Life: a harm that damages a living creature gives you ${R} HP back.`);

    // --- Raise Symbol and the symbol reactions -------------------------------------------------------------------
    const raised = !!effect(actor, /raise-symbol|raise-a-shield/);
    if (has(actor, "raise-symbol") && !raised && ctx.actions >= 1) out.notes.push(`Raise Symbol (1 action, with an action to spare): +2 to your saves until your next turn, and a success against vitality or void becomes a critical success${has(actor, "emblazon-armament") && me.shield ? "; an emblazoned shield raises with it" : ""}.`);
    if (has(actor, "sapping-symbol") && raised) out.notes.push("Sapping Symbol (reaction, symbol raised): when a melee attack is about to hit you, a check against its Will DC leaves it enfeebled 1 or 2 until it moves away.");

    // --- Reactions and free actions: when they fire -----------------------------------------------------------------
    if (has(actor, "rapid-response")) out.notes.push("Rapid Response (reaction): when an ally drops to 0 HP, you Stride toward them at +10 feet.");
    if (has(actor, "divine-rebuttal") && favored.length) out.notes.push("Divine Rebuttal (reaction, wielding your deity's weapon): when an ally is about to save against a magical ability of a creature adjacent to you, Strike it; a hit gives your allies +2 to that save (+3 on a critical hit).");
    if (has(actor, "zealous-rush")) out.notes.push("Zealous Rush (reaction): after a spell that affects only you, Stride 10 feet, or your full Speed after a 2-action one.");
    if (has(actor, "premonition-of-clarity")) out.notes.push(`Premonition of Clarity (reaction, once an hour): reroll a failed save against a mental effect at +2${has(actor, "shared-clarity") ? ", and allies within 15 feet who failed the same save can spend theirs to reroll too" : ""}.`);
    if (has(actor, "swift-banishment") && castable(board, (sp) => /^banishment$/i.test(sp.name)).length) out.notes.push("Swift Banishment (reaction): a critical hit on a creature away from its home plane expends your banishment on it, no casting needed.");
    if (has(actor, "avatars-protection") && castable(board, (sp) => /^avatar$/i.test(sp.name)).length) out.notes.push("Avatar's Protection (reaction): when an enemy critically hits you, cast avatar from your slots; the hit becomes a normal one, taken after the avatar's temporary HP.");
    if (has(actor, "denier-of-destruction") && font.heal.usable) out.notes.push(`Denier of Destruction (reaction): when an ally within 30 feet is about to take damage from something you can see, a heal reduces it by about ${Math.round(touchAvg("heal"))}.`);
    if (has(actor, "replenishment-of-war") && favored.length) out.notes.push(`Replenishment of War: a hit with your deity's weapon gives you ${Math.floor(lv / 2)} temporary HP (${lv} on a critical hit) until your next turn${has(actor, "shared-replenishment") ? ", or an ally within 10 feet instead (Shared Replenishment)" : ""}.`);

    // --- Auras and the top of the tree ---------------------------------------------------------------------------
    if (has(actor, "eternal-blessing")) { const inside = allies.filter((a) => feetBetween(me.rect, a.rect) <= 15); out.notes.push(`Eternal Blessing: bless runs around you at 15 feet (+1 to attacks for ${inside.length ? inside.map(nameOf).join(", ") : "nobody but you"} right now).`); }
    if (has(actor, "eternal-bane")) { const inside = foes.filter((f) => feetBetween(me.rect, f.rect) <= 15); out.notes.push(`Eternal Bane: bane runs around you at 15 feet (${inside.length ? `${inside.map(nameOf).join(", ")} at -1 to attacks` : "no foe inside it right now"}).`); }
    if (has(actor, "through-spell") && castable(board, (sp) => sp.attack !== null && sp.attack !== undefined).length) out.notes.push("Through Spell (1 action before a spell attack): the target gets no cover from creatures in the way.");
    if (has(actor, "restorative-channel") && font.heal.usable) {
        const bad = ["blinded", "deafened", "frightened", "sickened", "stupefied", "clumsy", "enfeebled", "drained", "paralyzed", "slowed"];
        const afflicted = [me, ...allies].filter((c) => bad.some((x) => c.conditions?.has?.(x)));
        if (afflicted.length) out.notes.push(`Restorative Channel: a font heal can become a condition-removing spell at rank ${R} (clear mind, sound body, sure footing) for ${afflicted.map((c) => (c === me ? "you" : nameOf(c))).join(", ")}${has(actor, "fortunate-relief") ? "; Fortunate Relief rolls the counteract twice" : ""}.`);
    }
    if (has(actor, "miraculous-possibility")) out.notes.push(`Miraculous Possibility: your held slot can cast any divine spell you know of rank ${Math.max(1, Math.min(9, Math.ceil(lv / 2)) - 2)} or lower.`);
    if (has(actor, "miraculous-spell")) {
        const tenth = castable(board, (sp) => sp.rank >= 10 && !sp.cantrip);
        out.notes.push(tenth.length ? `Miraculous Spell: ${tenth.map((sp) => sp.name).join(" and ")} at rank 10 ${tenth.length > 1 ? "are" : "is"} still prepared${has(actor, "maker-of-miracles") ? " (two slots with Maker of Miracles)" : ""}.` : "Miraculous Spell: your 10th-rank slot is spent or empty.");
    }
    if (has(actor, "dance-of-intercession") && ctx.actions >= 3) out.notes.push("Dance of Intercession (3 actions, three times a day): Stride half your Speed with a Performance check and cast a free 3-action heal or harm at rank 9 (7 on a success); each use today rolls a degree worse.");
    if (has(actor, "spellshape-channel") && font.kinds.length) out.notes.push("Spellshape Channel (free): one of your 1-action spellshapes applies to a heal or harm without the action.");
}

export { cleric };
