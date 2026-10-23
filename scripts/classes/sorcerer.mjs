/**
 * PF2e Tactics: classes/sorcerer.mjs
 * See classes/_common.mjs for the shape of a class read.
 * The advisor plans every spell on the board; this read adds the sorcerer's layer: Sorcerous Potency on slot spells,
 * blood magic and when it pays, Focus Points and bloodline spells, slots left by rank, signature spells and when a
 * lower slot does the job, the spellshape feats and the reactions that spend slots. Whether a slot is worth spending
 * over a cantrip is spell thrift's call (player.mjs); this read doesn't keep a rule of its own.
 */
import { castable, focusLeft, has, level, pct, slugKey, targets, degreeChances, mapFor, strikeExpected, saveExpected, nameOf, signed } from "./_common.mjs";

/** Each bloodline: its tradition and what its blood magic does, with the moment it pays (Remaster text). */
const BLOODLINES = {
    aberrant: { trad: "occult", magic: "Eerie Veil: a target takes -1 to Will saves for a round, or you get +2 to Will", pays: "before a Will-save spell on the same foe, or when a caster is eyeing you" },
    aesir: { trad: "divine", magic: "Call the Storm: a target takes 1 electricity per rank, or you get +2 to Reflex for a round", pays: "on a damage spell (the extra rides the first damage), the Reflex when an area is coming" },
    angelic: { trad: "divine", magic: "Divine Aura: you or one target get +1 to saves for a round", pays: "when the foe's next turn brings a save, on whoever is most exposed" },
    demonic: { trad: "divine", magic: "Corruption of Sin: a target takes -1 AC for a round, or you get +2 to Intimidation", pays: "the -1 AC on the foe your allies are about to Strike" },
    diabolic: { trad: "divine", magic: "Tongue of Flame: a target takes 1 fire per rank, or you get +2 to Deception", pays: "the fire on any damage spell, unless the foe shrugs off fire" },
    draconic: { trad: "arcane", magic: "Scaly Hide: you or one target get +1 AC for a round", pays: "on whoever the foes will swing at next, usually the front-liner" },
    elemental: { trad: "primal", magic: "Elemental Fury: a target takes 1 damage per rank of your element, or you get +2 to Intimidation", pays: "the damage on any damage spell" },
    fey: { trad: "primal", magic: "Cloak of Ribbons: you're concealed for a round, or +2 to Performance", pays: "the concealment when foes can reach you this round" },
    genie: { trad: "arcane", magic: "a target takes -1 to Perception for a round, or you get +1 to Deception", pays: "the Perception penalty when an ally means to Hide or Feint" },
    hag: { trad: "occult", magic: "Retributive Spite: the first creature to damage you before your next turn takes 4 mental per rank (basic Will), else you get temporary HP equal to the rank", pays: "when something can reach you this round" },
    harrow: { trad: "occult", magic: "you're concealed for a round", pays: "when foes can reach you this round" },
    imperial: { trad: "arcane", magic: "Imperious Defense: +1 AC or +1 to saves until your next turn", pays: "the AC when melee can reach you, the saves when a caster or a breath is coming" },
    nymph: { trad: "primal", magic: "a target takes -1 to Will saves for a round, or you get +1 to Diplomacy", pays: "before a Will-save spell on the same foe" },
    phoenix: { trad: "primal", magic: "you or a target get temporary HP equal to the rank, or a target takes fire equal to the rank", pays: "the fire on a damage spell, the temporary HP when you're hurt" },
    psychopomp: { trad: "divine", magic: "a target takes 1 void (living) or vitality (undead) per rank, or you get +2 to Fortitude for a round", pays: "the damage on any damage spell" },
    shadow: { trad: "occult", magic: "a target takes -1 to Perception for a round, or you get +1 to Stealth", pays: "the Perception penalty when an ally means to Hide or Feint" },
    undead: { trad: "divine", magic: "Stolen Life: temporary HP equal to the rank until your next turn, or a target takes 1 void per rank", pays: "the void on a damage spell, the temporary HP when you're the one in reach" },
    wyrmblessed: { trad: "divine", magic: "a target takes -1 to Will saves for a round, or you get +1 to Intimidation", pays: "before a Will-save spell on the same foe" },
};

const isFocus = (sp) => !!(sp.traits?.includes("focus") || /focus|bloodline/i.test(sp.entry ?? ""));
const isSlot = (sp) => !sp.cantrip && !isFocus(sp) && !sp.consumable;
const isSignature = (sp) => !!(sp.signature ?? sp.spell?.system?.location?.signature);
const ordinal = (r) => `${r}${r === 1 ? "st" : r === 2 ? "nd" : r === 3 ? "rd" : "th"}`;

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
function spellExpected(sp, t, avg, made) {
    if (sp.attack !== null && sp.attack !== undefined) return strikeExpected(sp.attack + mapFor(made, false), t.ac, avg);
    if (sp.save?.stat) { const e = saveExpected(t.saves?.[sp.save.stat] ?? 0, sp.dc ?? 15, avg, { basic: sp.save.basic }); return { hit: e.hit ?? e.fail ?? 0.5, expected: e.expected }; }
    return null;
}
/** A slot spell's damage at a lower rank: the dice scale with the rank, Sorcerous Potency adds the rank cast. */
function avgAtRank(sp, r, potency) {
    const base = Math.max(0, (sp.avg ?? 0) - (sp._potency ?? 0));
    return base * (r / Math.max(1, sp.rank)) + (potency ? r : 0);
}

function sorcerer(board, ctx, out) {
    const actor = board.me.actor;
    const lv = level(board);
    const blSlug = Object.keys(BLOODLINES).find((k) => has(actor, `bloodline-${k}`)) ?? null;
    const bl = blSlug ? BLOODLINES[blSlug] : null;
    // A draconic exemplar picks the tradition (arcane, divine, occult or primal): the bloodline item's ChoiceSet holds it
    const blItem = blSlug ? actor?.items?.find?.((i) => slugKey(i.slug ?? i.system?.slug ?? "") === `bloodline-${blSlug}`) : null;
    const dragon = blItem?.flags?.pf2e?.rulesSelections?.dragonBloodline ?? blItem?.flags?.system?.rulesSelections?.dragonBloodline ?? null;
    const dragonTrad = typeof dragon === "string" ? dragon : dragon?.tradition ?? null;
    const trad = (blSlug === "draconic" && ["arcane", "divine", "occult", "primal"].includes(dragonTrad) ? dragonTrad : bl?.trad) ?? "your tradition";
    const potency = has(actor, "sorcerous-potency") || has(actor, "dangerous-sorcery");
    const foes = targets(board);
    const spells = castable(board);

    // Sorcerous Potency: +rank status damage or healing on a slot spell. The sheet's formula doesn't carry it, so the
    // board's averages get it here, once, and the advisor's spell plans see the real number.
    if (potency) {
        for (const sp of spells) {
            if (!isSlot(sp) || sp._potency) continue;
            if (!(sp.avg > 0) && !sp.heals) continue;
            sp._potency = sp.rank;
            sp.avg = (sp.avg || 0) + sp.rank;
            if (sp.twoAction) sp.twoAction.avg += sp.rank;
        }
    }

    // Slots by rank, and the top rank with a slot left
    const slots = slotsLeft(actor);
    const topRank = slots.filter((s) => s.left > 0).map((s) => s.rank).pop() ?? Math.max(0, ...spells.filter(isSlot).map((s) => s.rank));
    if (slots.length) {
        const txt = slots.map((s) => `${ordinal(s.rank)} ${s.left}/${s.max}`).join(", ");
        const empty = slots.filter((s) => s.left === 0).map((s) => ordinal(s.rank));
        out.notes.push(`Slots left: ${txt}.${empty.length && has(actor, "greater-vital-evolution") ? ` Greater Vital Evolution (twice a day, two different ranks) still casts from an empty rank (${empty.join(", ")}).` : ""}`);
    }

    // Signature spells: heighten freely, so a lower slot often does the job. Say so when a visible foe is low enough.
    const sigs = spells.filter((sp) => isSlot(sp) && isSignature(sp));
    if (sigs.length) {
        let said = false;
        const lowRanks = slots.filter((s) => s.left > 0).map((s) => s.rank);
        for (const sp of sigs.filter((s) => s.avg > 0 && !s.heals)) {
            for (const f of foes) {
                if (!(f.hp > 0)) continue;
                const top = spellExpected(sp, f, sp.avg, ctx.made);
                if (!top || top.expected < f.hp) continue;
                const base = Number(sp.spell?.baseRank ?? sp.spell?.system?.level?.value ?? sp.baseRank ?? 1) || 1;
                for (const r of lowRanks.filter((r) => r >= base && r < sp.rank)) {
                    const e = spellExpected(sp, f, avgAtRank(sp, r, potency), ctx.made);
                    if (e && e.expected >= f.hp) {
                        out.notes.push(`${sp.name} is a signature spell: cast it from a ${ordinal(r)} slot at ${nameOf(f)} (about ${Math.round(e.expected)}, it has ${f.estimated ? `about ${f.hp} HP by the party's guess` : `${f.hp} HP`}) and keep the ${ordinal(sp.rank)}.`);
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

    // Blood magic: when a bloodline spell or a sorcerous gift cast from a slot pays its extra
    if (bl) {
        const extras = [];
        if (has(actor, "propelling-sorcery")) extras.push("Propelling Sorcery (Step free, or shove the target 5 feet)");
        if (has(actor, "explosion-of-power")) extras.push(`Explosion of Power (1d6 per rank around you, basic Reflex; ${trad === "arcane" ? "force" : trad === "divine" ? "spirit" : trad === "occult" ? "mental" : "fire"}): only when foes are next to you and your allies aren't`);
        if (has(actor, "terraforming-trickery")) extras.push("Terraforming Trickery (the squares around you become difficult terrain): when melee is closing on you");
        if (has(actor, "reflect-harm")) extras.push("Reflect Harm (the first spell that damages you before your next turn is thrown back on a spell attack): when a caster is on you");
        if (has(actor, "crossblooded-evolution")) extras.push("your second bloodline's effect (Crossblooded Evolution)");
        out.notes.push(`Blood magic (${blSlug} bloodline) comes with your bloodline spells and your sorcerous gift spells cast from a slot: ${bl.magic}. It pays ${bl.pays}.${extras.length ? ` You also know ${extras.join("; ")}: pick whichever fits the turn.` : ""}${has(actor, "blood-sovereignty") ? ` Blood Sovereignty: lose twice the rank in HP to take two effects at once${board.me.hp <= board.me.maxHp * 0.4 ? ", not while you're this hurt" : ""}.` : ""}${has(actor, "tenacious-blood-magic") ? " Tenacious Blood Magic (once a minute): a one-round effect lasts a minute instead; use it on the first one." : ""}`);
        if (has(actor, "anoint-ally") && board.allies.length) out.notes.push("Anoint Ally (1 action, adjacent ally, lasts a minute): your blood magic can go to them instead; worth it before the fight or when an ally will be in reach of the foes and you won't.");
        if (has(actor, "ancestral-blood-magic")) out.notes.push("Ancestral Blood Magic: your ancestry's non-cantrip spells trigger blood magic too.");
    }

    // Focus Points and bloodline spells
    const fp = focusLeft(actor);
    const focus = spells.filter(isFocus).filter((sp) => !sp.cantrip);
    const fmax = Number(actor?.system?.resources?.focus?.max) || 0;
    if (fp !== null) {
        const names = focus.map((s) => s.name);
        if (fp <= 0) out.notes.push(`No Focus Points left: your bloodline spells are out until you Refocus (10 minutes${has(actor, "bloodline-focus") ? ", and Bloodline Focus refills the whole pool" : fmax > 1 ? ", 1 point" : ""}).`);
        else out.notes.push(`Focus Points: ${fp} of ${fmax} left${names.length ? ` for ${names.join(", ")}` : ""}. A bloodline spell costs no slot and always brings your blood magic.${has(actor, "bloodline-focus") ? " Bloodline Focus: a Refocus refills the whole pool, so spend them." : ""}`);
    }

    // Bleed Out: an attack after a blood-magic spell
    if (has(actor, "bleed-out") && foes.length) {
        const atk = spells.find((s) => s.attack !== null && s.attack !== undefined)?.attack;
        const near = foes.filter((f) => f.hp > 0);
        const f = near.sort((a, b) => a.ac - b.ac)[0];
        if (f) {
            const bonus = (atk ?? lv + 7) + mapFor(ctx.made, false);
            const c = degreeChances(bonus, f.ac);
            out.notes.push(`Bleed Out (1 action, right after a slot spell that gave you blood magic): a ranged spell attack (${signed(bonus)} vs ${nameOf(f)}, about ${pct(c.s + c.cs)}) for persistent bleed equal to the spell's rank. It's an attack, so it takes and raises the multiple attack penalty.`);
        }
    }

    // Spellshape feats: one action before the spell, each with its moment
    const attackSpells = spells.filter((s) => s.attack !== null && s.attack !== undefined && s.avg > 0 && !s.area);
    if (has(actor, "split-shot") && attackSpells.length && foes.length >= 2) out.notes.push(`Split Shot (1 action) before ${attackSpells[0].name}: one roll against two foes in range, the second takes half damage and no rider; worth it when two foes are both in range (${foes.slice(0, 2).map(nameOf).join(" and ")}).`);
    if (has(actor, "safeguard-spell") && spells.some((s) => s.area)) out.notes.push("Safeguard Spell (1 action) before an area spell you'd be inside: it skips you, so an emanation or a burst next to you is safe.");
    if (has(actor, "elaborate-flourish")) out.notes.push("Elaborate Flourish (1 action) before a spell when a foe caster could Counterspell it: -2 to identify or counteract it.");
    if (has(actor, "energy-fusion")) {
        const energy = spells.filter((s) => isSlot(s) && s.avg > 0 && s.damageTypes?.some((d) => ["acid", "cold", "electricity", "fire", "sonic", "force", "vitality", "void"].includes(d)));
        if (energy.length) out.notes.push(`Energy Fusion (1 action) before ${energy[0].name}: spend a second slot of another energy spell's rank for that many extra damage, split between the two types; worth it against a foe that resists one of them, or when the slot would otherwise go unused.`);
    }
    if (has(actor, "interweave-dispel")) out.notes.push("Interweave Dispel (1 action) before a single-target spell: on a hit or a failed save, a free Dispel Magic on one effect on that foe (its slot is spent as usual); for a foe that's buffed or warded.");
    if (has(actor, "spell-shroud")) out.notes.push("Spell Shroud (1 action) before a spell that targets you: a 10-foot mist around you until your next turn, everyone in it concealed; when you need to break line of sight or shake off ranged foes.");
    if (has(actor, "echoing-spell")) {
        const best = spells.filter((s) => isSlot(s) && s.rank <= 4 && s.avg > 0).sort((a, b) => b.avg - a.avg)[0];
        out.notes.push(`Echoing Spell (1 action) before a rank 4 or lower spell with no duration: cast it again before the end of your next turn for no slot${best ? `; ${best.name} at rank ${best.rank} is your best candidate` : ""}.`);
    }
    if (has(actor, "bloodline-conduit")) out.notes.push("Bloodline Conduit (1 action, once a minute) before a rank 5 or lower spell with no duration: it costs no slot. Spend it on your first slot spell this fight; a signature spell heightened to 5th makes the most of it.");
    if (has(actor, "metamagic-mastery") || has(actor, "spellshape-mastery")) out.notes.push("Spellshape Mastery: your spellshape actions are free actions now, so every spell gets one.");
    if (lv >= 10 && has(actor, "quickened-casting")) out.notes.push(`Quickened Casting (free, once a day): a cantrip or a spell of rank ${Math.max(1, topRank - 2)} or lower costs one action less; with three actions that's two spells this turn.`);

    // Slot-fed reactions and the rest that fires on a condition
    if (has(actor, "counterspell-spontaneous") || has(actor, "counterspell")) {
        const openRanks = slots.filter((s) => s.left > 0).map((s) => ordinal(s.rank));
        out.notes.push(`Counterspell fires when a foe you can see casts a spell in your repertoire: spend a slot of that spell's rank or higher to counteract it${openRanks.length ? ` (slots open at ${openRanks.join(", ")})` : ""}.${has(actor, "consume-spell") ? ` Consume Spell: a counterspelled ${trad} spell also heals you twice its rank.` : ""}`);
    }
    if (has(actor, "energetic-resonance")) out.notes.push("Energetic Resonance fires when a spell would deal you acid, cold, electricity, fire or sonic damage: spend a slot of that rank or higher for resistance equal to twice the slot's rank.");
    if (has(actor, "blood-rising")) out.notes.push(`Blood Rising fires when a creature targets you with ${trad === "arcane" || trad === "occult" ? "an" : "a"} ${trad} spell: a blood magic effect of your choice, on you or on the caster${has(actor, "blood-ascendancy") ? ", two effects with Blood Ascendancy" : ""}; its bonus to AC or saves counts against that spell.`);
    if (has(actor, "spell-relay")) out.notes.push("Spell Relay fires when an ally casts a spell with you inside its range: they can measure range and cover from your square instead.");
    if (has(actor, "tap-into-blood")) {
        const t = { arcane: "Recall Knowledge with Arcana", divine: "Step, or Shove a creature in reach with Religion", occult: "Step up to 10 feet", primal: "Demoralize with Nature" }[trad] ?? "a minor trick of your tradition";
        out.notes.push(`Tap into Blood (1 action while a blood magic effect is on you): ${t}.`);
    }
    if (has(actor, "diverting-vortex") && foes.some((f) => (f.rangedReach ?? 0) > 0)) out.notes.push("Diverting Vortex (1 action, right after a slot spell): +1 AC against ranged attacks until your next turn; when the archers have you.");
    if (has(actor, "energy-ward")) out.notes.push("Energy Ward (free, once a turn, right after a slot spell that dealt energy damage): resistance 4 plus the rank to one energy type until your next turn; pick the type the foes throw.");
    if (has(actor, "divine-evolution")) out.notes.push(`Divine Evolution: one extra ${ordinal(topRank || 1)} slot that only casts Heal or Harm, so a Heal from it costs you nothing else.`);
    if (has(actor, "primal-evolution")) out.notes.push(`Primal Evolution: one extra ${ordinal(topRank || 1)} slot that only casts Summon Animal or Summon Plant or Fungus.`);
    if (has(actor, "greater-physical-evolution")) out.notes.push("Greater Physical Evolution (once a day): a slot casts any common battle form of its rank as a signature spell; for a fight where you'd rather be the front line.");
    if (has(actor, "bloodline-resistance") && foes.some((f) => f.caster)) out.notes.push("Bloodline Resistance: +1 to saves against spells and magic, so the DC of a foe that has been casting is one lower for you.");
    if (has(actor, "ruby-resurrection")) out.notes.push(`Ruby Resurrection (once a day) fires when you'd drop to 0 HP: back to 30 HP and a rank 6 Fireball on everything around you but you${board.me.hp <= board.me.maxHp * 0.3 ? "; you're low enough that it may fire this round, so stand where the burst catches foes, not allies" : ""}.`);
    if (lv >= 19 && (has(actor, "bloodline-paragon") || has(actor, "bloodline-perfection"))) {
        const tenth = slots.find((s) => s.rank === 10);
        out.notes.push(`10th-rank slot${has(actor, "bloodline-perfection") ? "s" : ""}: ${tenth ? `${tenth.left} of ${tenth.max} left` : has(actor, "bloodline-perfection") ? "two a day" : "one a day"}; they take no spellshape that waives a slot, so spend them on the fight that decides the day.`);
    }
}

export { sorcerer };
