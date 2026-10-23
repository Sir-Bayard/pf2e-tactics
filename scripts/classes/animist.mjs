/**
 * PF2e Tactics: classes/animist.mjs
 * See classes/_common.mjs for the shape of a class read.
 * The advisor already plans every spell on the board: the prepared divine spells, the apparition repertoire, the
 * cantrips, and it taxes the slot spells (spell thrift in player.mjs). This read adds the animist layer: which
 * apparitions are attuned today and which is primary (its vessel spell is the focus spell on the sheet), the vessel
 * spells as plans of their own (the advisor can't value a sustained aura, a battle trance or a tentacle), Channeler's
 * Stance, Circle of Spirits as the way to another vessel, the practice's benefits, the wandering feats that hang on an
 * apparition's Lore, and "when" notes for the feats that ride on a spell. The vessel spells are taken off the board so
 * the advisor doesn't plan them a second time.
 */
import { bestStrike, castable, effect, focusLeft, has, hasAny, level, pct, slugOf, squareToReach, strikeRun, targets, worth, feetBetween, inReach, mapFor, strikeExpected, saveExpected, nameOf, signed, moveText, myReach, reachableSquares } from "./_common.mjs";

const itemsOf = (actor) => actor?.items?.contents ?? (Array.isArray(actor?.items) ? actor.items : []);
const hitWorth = (lv) => Math.max(4, 6 + 1.6 * lv);
const hurt = (c) => Math.max(0, (c?.maxHp ?? 0) - (c?.hp ?? 0));
const list = (names) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] ?? "");

/**
 * The apparitions the system ships (class features tagged animist-apparition), by slug: the Lore skills they grant
 * (the wandering feats' requirements), their cantrip and their vessel spell. Attuned today means the feature is on the
 * sheet. PF2e 8.6.1 records no primary apparition (no roll option, effect or ChoiceSet: Apparition Attunement and Circle
 * of Spirits carry no rules), and players keep every attuned apparition's vessel spell in the focus entry. So the read
 * allows one primary (two for a medium from 9th, Dual Invocation): the pf2e-tactics flag primaryApparition when set,
 * else a vessel spell that is up, else the first vessel spell on the sheet. The other vessel spells are planned behind
 * Circle of Spirits (1 action), or not at all without it.
 */
const APPARITIONS = {
    "crafter-in-the-vault": { name: "Crafter in the Vault", lores: ["architecture", "engineering"], cantrip: "Sigil", vessel: "Traveling Workshop" },
    "custodian-of-groves-and-gardens": { name: "Custodian of Groves and Gardens", lores: ["farming", "herbalism"], cantrip: "Tangle Vine", vessel: "Garden of Healing" },
    "echo-of-lost-moments": { name: "Echo of Lost Moments", lores: ["fortune-telling", "genealogy"], cantrip: "Figment", vessel: "Store Time" },
    "impostor-in-hidden-places": { name: "Impostor in Hidden Places", lores: ["fortune-telling", "underworld"], cantrip: "Telekinetic Hand", vessel: "Discomfiting Whispers" },
    "lurker-in-devouring-dark": { name: "Lurker in Devouring Dark", lores: ["ocean", "sailing"], cantrip: "Caustic Blast", vessel: "Devouring Dark Form" },
    "monarch-of-the-fey-courts": { name: "Monarch of the Fey Courts", lores: ["art", "fey"], cantrip: "Tangle Vine", vessel: "Nymph's Grace" },
    "reveler-in-lost-glee": { name: "Reveler in Lost Glee", lores: ["circus", "fortune-telling"], cantrip: "Prestidigitation", vessel: "Trickster's Mirrors" },
    "stalker-in-darkened-boughs": { name: "Stalker in Darkened Boughs", lores: ["forest", "hunting"], cantrip: "Gouging Claw", vessel: "Darkened Forest Form" },
    "steward-of-stone-and-fire": { name: "Steward of Stone and Fire", lores: ["mountain", "volcano"], cantrip: "Ignition", vessel: "Earth's Bile" },
    "vanguard-of-roaring-waters": { name: "Vanguard of Roaring Waters", lores: ["mountain", "river"], cantrip: "Rousing Splash", vessel: "River Carving Mountains" },
    "witness-to-ancient-battles": { name: "Witness to Ancient Battles", lores: ["battlegrounds", "heraldry"], cantrip: "Shield", vessel: "Embodiment of Battle" },
    "shepherd-of-errant-winds": { name: "Shepherd of Errant Winds", lores: ["sailing", "scouting"], cantrip: "Slashing Gust", vessel: "Gift of the Anemos" },
    "speaker-in-sibilance": { name: "Speaker in Sibilance", lores: ["fortune-telling", "mountain"], cantrip: "Puff of Poison", vessel: "Crown of Prophets" },
    "lamentation-of-sinister-deals": { name: "Lamentation of Sinister Deals", lores: ["legal", "scribing"], cantrip: "Message", vessel: "Wish Market" },
};
/** What each vessel spell is for, in a line, for the Circle of Spirits note (the one that isn't primary right now). */
const VESSEL_LINE = {
    "Traveling Workshop": "Crafting and Thievery tools; nothing for a fight",
    "Garden of Healing": "a 10-foot aura that heals everyone in it each round you Sustain it",
    "Store Time": "a spare reaction each round for your animist and apparition reactions",
    "Discomfiting Whispers": "foes starting a turn next to you roll their first attack twice and take the worse, void damage when it misses",
    "Devouring Dark Form": "a tentacle with 10-foot reach and a free Grapple each Sustain",
    "Nymph's Grace": "foes that enter or start in a 10-foot aura are confused for a round on a failed Will save",
    "Trickster's Mirrors": "mirrors that take half the attacks aimed at you",
    "Darkened Forest Form": "a pest form, or at rank 2 an animal battle form",
    "Earth's Bile": "a 10-foot burst of fire and stone each round you Sustain it",
    "River Carving Mountains": "+10 Speed, lesser cover from ranged attacks, a free Stride each Sustain",
    "Embodiment of Battle": "+1 to attacks and damage (more at rank 4 and 7) and Reactive Strike",
    "Gift of the Anemos": "a free Step or Shove each round, and foes that miss you badly turn off-guard",
    "Crown of Prophets": "fangs, and free poison on a foe that hurt you",
    "Wish Market": "+1 to Perception and a skill, a free Recall Knowledge or Seek each round, at a random price",
};
const vesselOf = (name) => Object.values(APPARITIONS).find((a) => a.vessel.toLowerCase() === String(name ?? "").toLowerCase()) ?? null;

/** The apparition features on the sheet: known ones by slug, unknown ones by the system's tag. */
function attunedOf(actor) {
    const out = [];
    for (const i of itemsOf(actor)) {
        if (i.type !== "feat") continue;
        const slug = slugOf(i);
        const known = APPARITIONS[slug];
        const tagged = (i.system?.traits?.otherTags ?? []).includes("animist-apparition");
        if (!known && !tagged) continue;
        out.push({ slug, name: known?.name ?? i.name, lores: known?.lores ?? [], cantrip: known?.cantrip ?? null, vessel: known?.vessel ?? null, item: i });
    }
    return out;
}
/** Slots by rank per spellcasting entry: the prepared divine entry and the spontaneous apparition one. */
function entriesOf(actor) {
    const out = [];
    const regular = actor?.spellcasting?.regular ?? [];
    for (const e of Array.isArray(regular) ? regular : regular.contents ?? []) {
        if (e.isFocusPool || e.isRitual) continue;
        const ranks = {};
        for (const [key, slot] of Object.entries(e.system?.slots ?? {})) {
            const rank = Number(key.replace("slot", ""));
            if (!rank || !(slot?.max > 0)) continue;
            const prepared = Array.isArray(slot.prepared) ? slot.prepared : Object.values(slot.prepared ?? {});
            const left = e.isPrepared ? prepared.filter((p) => p?.id && !p.expended).length : Math.max(0, Number(slot.value) || 0);
            ranks[rank] = { left, max: slot.max };
        }
        out.push({ name: e.name ?? "", prepared: !!e.isPrepared, apparition: /apparition/i.test(e.name ?? "") || (!e.isPrepared && !!e.isSpontaneous), ranks });
    }
    return out;
}
const slotsText = (ranks) => Object.keys(ranks).map(Number).sort((a, b) => b - a).map((r) => `${ranks[r].left}/${ranks[r].max} at rank ${r}`).join(", ");

/** The best one- or two-action damaging spell at f (cantrips only when asked), as the advisor would value it. */
function bestCast(board, f, { cantripOnly = false, maxCost = 2 } = {}) {
    let best = null;
    for (const sp of castable(board, (sp) => sp.cost >= 1 && sp.cost <= maxCost && sp.avg > 0 && !sp.heals && (!cantripOnly || sp.cantrip))) {
        if (sp.range !== null && sp.range !== undefined && sp.range > 0 && feetBetween(board.me.rect, f.rect) > sp.range) continue;
        let e = 0;
        if (sp.attack !== null && sp.attack !== undefined) e = strikeExpected(sp.attack, f.ac, sp.avg).expected;
        else if (sp.save?.stat) e = saveExpected(f.saves?.[sp.save.stat] ?? level(board) + 5, sp.dc ?? 10 + level(board) + 4, sp.avg, { basic: sp.save.basic }).expected;
        else continue;
        if (!best || e > best.e) best = { sp, e };
    }
    return best;
}
/** The unarmed attack bonus, from a Strike on the board or the sheet's numbers. */
function unarmedBonus(board) {
    const own = board.strikes.filter((s) => (s.traits ?? []).includes("unarmed") && !s.ranged).sort((a, b) => b.bonus - a.bonus)[0];
    if (own) return own.bonus;
    const lv = level(board);
    const ab = board.me.actor?.system?.abilities ?? {};
    return lv + (lv >= 11 ? 4 : 2) + Math.max(Number(ab.str?.mod) || 0, Number(ab.dex?.mod) || 0);
}

function animist(board, ctx, out) {
    const actor = board.me.actor;
    const me = board.me;
    const lv = level(board);
    if (!(actor?.class?.slug === "animist" || hasAny(actor, "apparition-attunement", "animist-apparition-spellcasting", "animist-dedication"))) return;
    const dedication = actor?.class?.slug !== "animist" && !hasAny(actor, "apparition-attunement", "animist-apparition-spellcasting");
    const practice = ["liturgist", "medium", "seer", "shaman"].find((p) => has(actor, p)) ?? null;
    const foes = targets(board).filter((f) => f.hp > 0);
    const allies = (board.allies ?? []).filter((a) => a.hp > 0);
    const near = (c, ft, from = me) => feetBetween(from.rect, c.rect) <= ft && (!c.rect?.lvl || !from.rect?.lvl || c.rect.lvl === from.rect.lvl);
    const inStance = !!effect(actor, /channelers?-s?-?stance/);
    const relinquished = !!effect(actor, /relinquish-control/);
    const focus = focusLeft(actor);
    const fmax = Number(actor?.system?.resources?.focus?.max) || 0;
    const rankTop = Math.max(1, Math.min(10, Math.ceil(lv / 2)));
    const dc = (board.spells ?? []).find((sp) => sp.dc)?.dc ?? 10 + lv + 4 + (lv >= 19 ? 4 : lv >= 15 ? 3 : lv >= 7 ? 2 : 1);
    const attuned = attunedOf(actor);
    const lores = new Set(attuned.flatMap((a) => a.lores));
    const entries = entriesOf(actor);
    const apparitionEntry = entries.find((e) => e.apparition) ?? null;
    const spellNamed = (re) => (board.spells ?? []).find((sp) => re.test(sp.name ?? ""));

    // --- The vessel spells on the sheet. They come off the board: this read plans them ---------------------------------
    const vessels = (board.spells ?? []).filter((sp) => !sp.consumable && vesselOf(sp.name));
    board.spells = (board.spells ?? []).filter((sp) => !vessels.includes(sp));
    const vesselUp = (name) => {
        const re = new RegExp(name.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-?"));
        if (effect(actor, re)) return true;
        return !!board.sustain && re.test(String(board.sustain.name ?? "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-"));
    };
    // The primary apparition(s): one, or two for a medium from 9th (Dual Invocation). The sheet doesn't say which, so: the
    // flag, else what is up, else the sheet's order. The rest of the vessel spells need Circle of Spirits first.
    const maxPrimaries = practice === "medium" && lv >= 9 ? 2 : 1;
    const named = String(actor?.flags?.["pf2e-tactics"]?.primaryApparition ?? "").toLowerCase();
    const flagged = named ? vessels.filter((sp) => named.includes(sp.name.toLowerCase()) || named.includes(vesselOf(sp.name).name.toLowerCase())) : [];
    const upNow = vessels.filter((sp) => vesselUp(sp.name) && !flagged.includes(sp));
    const primaryVessels = [...new Set([...flagged, ...upNow, ...vessels])].slice(0, maxPrimaries);
    const guessed = vessels.length > maxPrimaries ? (flagged.length ? "your pf2e-tactics primaryApparition flag" : upNow.length ? "the vessel spell you have up" : "the first vessel spell on your sheet") : null;
    const primaries = primaryVessels.map((sp) => vesselOf(sp.name));
    const circle = hasAny(actor, "circle-of-spirits");

    // --- Relinquish Control (Medium): only Strikes, Steps and apparition or vessel spells this turn ---------------------
    const fromApparition = (sp) => sp.focus || sp.isFocus || (sp.traits ?? []).includes("focus") || (apparitionEntry ? (sp.entry ?? "") === apparitionEntry.name : true);
    if (relinquished) {
        const before = board.spells.length;
        board.spells = board.spells.filter(fromApparition);
        board.profiles = (board.profiles ?? []).filter((p) => (p.traits ?? []).includes("apparition"));
        out.notes.push(`You've Relinquished Control: until your next turn only Strikes, Steps, Recall Knowledge, apparition and vessel spells and apparition actions are yours${hasAny(actor, "instinctive-maneuvers") ? ", plus Grapple, Reposition, Shove and Trip at +2" : ""}${before > board.spells.length ? "; your other spells are off the plans" : apparitionEntry ? "" : "; the read can't tell your apparition spells from the rest, so mind the list"}. You move only by Step: the class plans here keep to that, the general plans below may still Stride, so skip those. +4 to saves against being controlled${lv >= 17 && practice === "medium" ? "; your Strikes deal +2 spirit and you resist physical damage " + Math.floor(lv / 2) + " but have weakness " + lv + " to spirit" : ""}.`);
    }

    // --- What's attuned, what's primary, what's left in the pool ---------------------------------------------------
    if (attuned.length || vessels.length) {
        const names = attuned.map((a) => a.name);
        const prim = primaries.map((p) => p.name);
        // the attuned apparitions that aren't primary: their features, and the vessel spells on the sheet beyond the primaries
        const others = [...attuned.filter((a) => !prim.includes(a.name)), ...vessels.filter((sp) => !primaryVessels.includes(sp)).map((sp) => vesselOf(sp.name)).filter((p) => !attuned.some((a) => a.name === p.name))];
        let text = attuned.length ? `Attuned today: ${list(names)}` : `No apparition feature on your sheet; the vessel spell${vessels.length > 1 ? "s say" : " says"} you're attuned to ${list(vessels.map((sp) => vesselOf(sp.name).name))}`;
        if (prim.length) text += `${attuned.length ? "; p" : ". P"}${prim.length > 1 ? "rimaries" : "rimary"} ${list(prim)} (vessel spell${prim.length > 1 ? "s" : ""} ${list(primaryVessels.map((v) => v.name))})`;
        else if (attuned.length) text += "; no vessel spell on your sheet, so the read can't tell which is primary (add the primary's vessel spell to your focus spells)";
        if (guessed) text += `. Your sheet doesn't record which apparition is primary and you hold ${maxPrimaries > 1 ? "two primaries" : "one primary"}, so the read takes ${list(prim)} (${guessed}) and puts Circle of Spirits in front of ${list(vessels.filter((sp) => !primaryVessels.includes(sp)).map((sp) => sp.name))}; if another is primary, set the pf2e-tactics primaryApparition flag or keep only the primary's vessel spell on the sheet`;
        if (focus !== null) text += `. ${focus} of ${fmax} Focus Point${fmax === 1 ? "" : "s"} left${focus === 0 ? ": no vessel spell until you Refocus" : ""}`;
        out.notes.push(`${text}.`);
        if (others.length && circle && ctx.actions >= 2) {
            const lines = others.filter((a) => a.vessel).map((a) => `${a.name} for ${a.vessel} (${VESSEL_LINE[a.vessel] ?? "its vessel spell"})`);
            if (lines.length) out.notes.push(`Circle of Spirits (1 action, once a round, no Focus Point): make ${lines.join("; or ")} your primary instead. It pays only when that vessel suits this fight better than ${list(primaryVessels.map((v) => v.name)) || "what you hold"}${focus === 0 ? "; with no Focus Point left the new vessel spell waits for a Refocus" : ""}${maxPrimaries > 1 ? "; as a medium you hold two primaries, so it swaps one" : ""}.`);
        } else if (others.length && !circle && guessed) out.notes.push(`Without Circle of Spirits you change your primary only when you Refocus, so ${list(vessels.filter((sp) => !primaryVessels.includes(sp)).map((sp) => sp.name))} ${vessels.length - primaryVessels.length > 1 ? "are" : "is"} off the plans this fight.`);
    }
    if (apparitionEntry && Object.keys(apparitionEntry.ranks).length) {
        const divine = entries.find((e) => e.prepared && e !== apparitionEntry);
        out.notes.push(`Apparition slots (spontaneous, your apparitions' spells): ${slotsText(apparitionEntry.ranks)}${divine && Object.keys(divine.ranks).length ? `; prepared divine slots: ${slotsText(divine.ranks)}` : ""}. The advisor's thrift note says when a slot beats a cantrip.`);
    }

    // --- Channeler's Stance: +rank to an energy-damage apparition or vessel spell, +rank to a vitality or void heal -------
    const stanceFeat = hasAny(actor, "channelers-stance", "channeler-s-stance");
    const stanceBonus = (sp) => (sp && ["fire", "cold", "electricity", "acid", "sonic", "force", "spirit", "vitality", "void"].some((t) => (sp.damageTypes ?? []).includes(t) || (sp.traits ?? []).includes(t)) ? sp.rank ?? rankTop : 0);
    if (stanceFeat && !relinquished) {
        if (inStance) out.notes.push(`Channeler's Stance is up: +rank status damage on each apparition or vessel spell that deals energy damage, +rank on the healing of a vitality or void spell${hasAny(actor, "channeled-protection") ? "; Channeled Protection (1 action after a slot spell): +1 AC and Reflex for you and adjacent allies until your next turn, +2 after a rank 7 or higher spell" : ""}.`);
        else if (ctx.actions >= 2) {
            const gainers = [...vessels, ...board.spells.filter((sp) => apparitionEntry ? fromApparition(sp) : sp.focus)].filter((sp) => stanceBonus(sp) > 0 || (sp.heals && ((sp.traits ?? []).includes("vitality") || (sp.traits ?? []).includes("void"))));
            if (gainers.length) out.notes.push(`Channeler's Stance (1 action, lasts until you leave it): +${rankTop} on each casting or Sustain of ${list([...new Set(gainers.map((sp) => sp.name))].slice(0, 4))}. Worth the action on the first turn of a long fight${hasAny(actor, "cycle-of-souls") ? "; Cycle of Souls (free at the start of your turn) Steps and enters it for nothing" : ""}.`);
        }
    }

    // --- The vessel spells: a plan each, with the rest of the turn behind it -------------------------------------------
    const enhancement = hasAny(actor, "apparitions-enhancement", "apparition-s-enhancement") && board.strikes.some((s) => !s.ranged);
    /** The rest of the turn after a one-action vessel spell at f: Strikes (with Apparition's Enhancement's 1d6 spirit after a non-cantrip spell) or the best cantrip. */
    const restAt = (f, left, { bonus = 0, made = ctx.made } = {}) => {
        if (left < 1 || !f) return { ev: 0, steps: [] };
        const run = inReach(me.rect, f.rect, myReach(board)) ? strikeRun(board, f, left, { made, extra: bonus + (enhancement ? 3.5 : 0), acAdj: -bonus }) : { used: [], ev: 0, text: "" };
        const cast = bestCast(board, f, { cantripOnly: true, maxCost: left });
        if (run.used.length && run.ev >= (cast?.e ?? 0)) return { ev: run.ev, steps: [{ cost: run.used.length, text: `${run.text}${enhancement ? ", +1d6 spirit (Apparition's Enhancement, free after the spell)" : ""}` }] };
        if (cast) return { ev: cast.e, steps: [{ cost: cast.sp.cost, text: `Cast ${cast.sp.name} at ${nameOf(f)} (about ${Math.round(cast.e)})` }] };
        return { ev: 0, steps: [] };
    };
    const costNote = (name) => `${name} costs 1 Focus Point (${focus} left) and an action each round to Sustain, up to a minute${lv >= 9 && practice === "liturgist" ? "; as a liturgist a Step, Leap or Tumble Through Sustains it for you" : ""}.`;
    const push = (title, target, ev, steps, notes, dest = null, bias = 0.3) => out.plans.push({ kind: "class", title, target, ev, score: ev + bias, dest, steps, notes });
    const nearestFoe = foes.slice().sort((a, b) => feetBetween(me.rect, a.rect) - feetBetween(me.rect, b.rect))[0] ?? null;
    /** A square from which you reach f: under Relinquish Control only a Step (one 5-foot move) or none, else up to maxActions of movement. */
    const reachSq = (f, reach, maxActions) => {
        if (!relinquished) return squareToReach(board, f, reach, maxActions);
        if (inReach(me.rect, f.rect, reach)) return { x: me.rect.x, y: me.rect.y, route: { actions: 0, provokes: [], via: null } };
        if (maxActions < 1) return null;
        return reachableSquares(board, 1).find((sq) => sq.route.actions === 1 && sq.route.step && inReach({ ...me.rect, x: sq.x, y: sq.y, z: sq.z ?? me.rect.z }, f.rect, reach)) ?? null;
    };

    for (const sp of vessels) {
        const name = sp.name;
        const rank = sp.rank ?? rankTop;
        const up = vesselUp(name);
        // A vessel spell that isn't the primary's: Circle of Spirits (1 action, once a round) first, or nothing
        const swap = !primaryVessels.includes(sp);
        if (swap && (!circle || ctx.actions < 2)) continue;
        const A = swap ? ctx.actions - 1 : ctx.actions;
        const canCast = focus > 0 && A >= 1 && !up;
        const say = (t) => { if (!swap) out.notes.push(t); }; // the Circle of Spirits note covers the others
        const swapTo = vesselOf(name).name;
        const pushV = (title, target, ev, steps, notes, dest, bias) => (swap
            ? push(`Circle of Spirits to ${swapTo}, then ${title}`, target, ev, [{ cost: 1, text: `Circle of Spirits: ${swapTo} becomes your primary apparition${primaries.length ? ` in place of ${list(primaries.map((p) => p.name))}` : ""}` }, ...steps], [...notes, `${list(primaries.map((p) => p.name)) || "Your old primary"}'s vessel spell is off until you swap back.`], dest, bias)
            : push(title, target, ev, steps, notes, dest, bias));
        const stanceNow = inStance ? 1 : 0;
        switch (vesselOf(name).vessel) {
            case "Earth's Bile": {
                const dice = 1 + Math.floor((rank - 1) / 2);
                const avg = 5 * dice + stanceNow * rank;
                const persist = Math.ceil(rank / 2);
                if (up) {
                    const f = nearestFoe;
                    if (board.sustain && /earth/i.test(board.sustain.name ?? "")) board.sustain.value = Math.max(board.sustain.value ?? 0, f ? saveExpected(f.saves?.reflex ?? lv + 8, dc, avg, { basic: true }).expected + persist : avg * 0.5);
                    say(`Earth's Bile is up: Sustain it (1 action) for another 10-foot burst within 30 feet, about ${Math.round(avg)} fire and bludgeoning (basic Reflex) plus ${persist} persistent fire on a failure.`);
                    break;
                }
                if (!canCast) break;
                let best = null;
                for (const c of foes.filter((f) => near(f, 30))) {
                    const caught = foes.filter((f) => near(f, 10, c));
                    const burned = [me, ...allies].filter((a) => near(a, 10, c));
                    let ev = 0;
                    for (const f of caught) { const sv = saveExpected(f.saves?.reflex ?? lv + 8, dc, avg, { basic: true }); ev += sv.expected + persist * 2 * sv.fail; }
                    for (const a of burned) ev -= Math.min(avg, a.hp ?? avg) * (a === me ? 1 : 0.9);
                    if (!best || ev > best.ev) best = { c, caught, burned, ev };
                }
                if (!best || best.ev <= 0) { if (foes.some((f) => near(f, 30))) say(`Earth's Bile (1 action, 1 Focus Point): a 10-foot burst within 30 feet for about ${Math.round(avg)} fire and bludgeoning (basic Reflex) and ${persist} persistent fire, again each Sustain; right now every spot that catches a foe catches you or an ally too, so hold it until the lines part.`); break; }
                const rest = restAt(best.c, A - 1);
                const steps = [{ cost: 1, text: `Earth's Bile: a 10-foot burst on ${nameOf(best.c)}, catching ${list(best.caught.map(nameOf))}, about ${Math.round(avg)} fire and bludgeoning each (basic Reflex) and ${persist} persistent fire on a failure${best.burned.length ? `; ${list(best.burned.map((a) => (a === me ? "you" : nameOf(a))))} ${best.burned.length > 1 ? "are" : "is"} in it too` : ""}` }, ...rest.steps];
                const notes = [costNote(name), `Each later turn, the Sustain is the same burst again for one action${stanceFeat && !inStance ? `; in Channeler's Stance it deals +${rank} each time` : ""}.`];
                pushV(`Earth's Bile on ${nameOf(best.c)}`, best.c, best.ev + rest.ev, steps, notes);
                break;
            }
            case "Garden of Healing": {
                const avg = 2.5 * rank;
                const healed = [me, ...allies].filter((a) => near(a, 10) && hurt(a) > 0);
                const foesIn = foes.filter((f) => near(f, 10));
                if (up) {
                    if (board.sustain && /garden/i.test(board.sustain.name ?? "")) board.sustain.value = Math.max(board.sustain.value ?? 0, healed.reduce((t, a) => t + 0.8 * Math.min(avg, hurt(a)), 0));
                    say(`Garden of Healing is up: Sustain it (1 action) for another ${Math.round(avg)} HP to everyone within 10 feet${healed.length ? ` (${list(healed.map((a) => (a === me ? "you" : nameOf(a))))} right now)` : ""}${foesIn.length ? `, ${list(foesIn.map(nameOf))} included` : ""}.`);
                    break;
                }
                if (!canCast) break;
                const gain = healed.reduce((t, a) => t + 0.8 * Math.min(avg, hurt(a)) * (a === me ? 1 : 0.9), 0) - foesIn.reduce((t, f) => t + 0.8 * Math.min(avg, hurt(f)), 0);
                if (healed.length < 2 || gain < 3) {
                    if (healed.length < 2 && hurt(me) + allies.reduce((t, a) => t + hurt(a), 0) > 0) say(`Garden of Healing (1 action, 1 Focus Point): ${Math.round(avg)} HP a round to everyone within 10 feet of you while you Sustain it; it pays when two or more hurt allies stand close${foesIn.length ? ", and the foes in it heal too" : ""}.`);
                    break;
                }
                const f = nearestFoe;
                const rest = restAt(f, A - 1);
                const steps = [{ cost: 1, text: `Garden of Healing: about ${Math.round(avg)} HP now to ${list(healed.map((a) => (a === me ? "you" : nameOf(a))))}, and again each turn you Sustain it${foesIn.length ? `; ${list(foesIn.map(nameOf))} heal${foesIn.length > 1 ? "" : "s"} too` : ""}` }, ...rest.steps];
                pushV("Garden of Healing", null, gain + rest.ev, steps, [costNote(name), "The healing lands once a round, so it's a slow heal for a long fight, not a rescue; a creature it has healed gets nothing from a second casting for 10 minutes."]);
                break;
            }
            case "Embodiment of Battle": {
                const bonus = rank >= 7 ? 3 : rank >= 4 ? 2 : 1;
                if (up) { say(`Embodiment of Battle is up: +${bonus} to your attacks and damage and Reactive Strike while you Sustain it; your spell DC and attacks are 2 lower.`); break; }
                if (!canCast || !board.strikes.some((s) => !s.ranged)) break;
                const drafts = [];
                for (const f of foes) {
                    const sq = reachSq(f, myReach(board), A - 2);
                    if (!sq) continue;
                    const left = A - 1 - sq.route.actions;
                    if (left < 1) continue;
                    const run = strikeRun(board, f, left, { made: ctx.made, extra: bonus + (enhancement ? 3.5 : 0), acAdj: -bonus });
                    if (!run.used.length) continue;
                    const plain = strikeRun(board, f, left, { made: ctx.made });
                    const reactive = 0.4 * (bestStrike(board, f, { made: 0, extra: bonus, acAdj: -bonus })?.e.expected ?? 0);
                    const ev = run.ev + reactive;
                    const steps = [{ cost: 1, text: `Embodiment of Battle: +${bonus} to attacks and damage, martial weapons at your simple proficiency, and Reactive Strike for a minute while you Sustain it` }];
                    if (sq.route.actions) steps.push({ cost: sq.route.actions, text: moveText(sq, f) });
                    steps.push({ cost: run.used.length, text: `${run.text}${enhancement ? ", +1d6 spirit (Apparition's Enhancement)" : ""}` });
                    drafts.push([`Embodiment of Battle, then Strike ${nameOf(f)}`, f, ev, steps, [costNote(name), `Worth about ${Math.round(run.ev - plain.ev)} over plain Strikes this turn plus a Reactive Strike; your spell attacks and DC are 2 lower while it runs, so it's for a turn or two of hitting, not casting.`], sq.route.actions ? { x: sq.x, y: sq.y } : null, 0.2]);
                }
                for (const d of drafts.sort((a, b) => b[2] - a[2]).slice(0, 2)) pushV(...d);
                break;
            }
            case "Nymph's Grace": {
                const inAura = foes.filter((f) => near(f, 10));
                if (up) { say(`Nymph's Grace is up: Sustain it (1 action) and ${inAura.length ? list(inAura.map(nameOf)) + " must" : "a foe that enters or starts in the aura must"} save against Will or be confused for a round; a foe it confuses never harms you.`); break; }
                if (!canCast || !inAura.length) break;
                let ev = 0;
                for (const f of inAura) { const sv = saveExpected(f.saves?.will ?? lv + 8, dc, 1, { basic: false, shift: (f.level ?? lv) > rank * 2 ? 1 : 0 }); ev += sv.fail * worth(board, "confused") * 0.7; }
                if (ev < 2) break;
                const rest = restAt(nearestFoe, A - 1);
                pushV("Nymph's Grace", null, ev + rest.ev, [{ cost: 1, text: `Nymph's Grace: a 10-foot aura; ${list(inAura.map(nameOf))} save against Will (DC ${dc}) at the start of each turn or ${inAura.length > 1 ? "are" : "is"} confused for a round and can't harm you while confused` }, ...rest.steps], [costNote(name), "Incapacitation: a foe of higher level than twice the rank saves one degree better. Sustain it each turn to keep the aura."]);
                break;
            }
            case "Discomfiting Whispers": {
                const adj = foes.filter((f) => near(f, 5));
                const dmg = 3.5 * (1 + Math.floor((rank - 1) / 2)) + stanceNow * rank;
                if (up) { say(`Discomfiting Whispers is up: Sustain it (1 action) and ${adj.length ? list(adj.map(nameOf)) + " roll" : "a foe starting its turn next to you rolls"} the first attack twice and take${adj.length === 1 ? "s" : ""} the lower on a failed Will save, ${Math.round(dmg)} void when that attack misses.`); break; }
                if (!canCast || !adj.length) break;
                let ev = 0;
                for (const f of adj) { const sv = saveExpected(f.saves?.will ?? lv + 8, dc, 1, { basic: false }); ev += sv.fail * (0.3 * hitWorth(lv) + 0.4 * dmg); }
                if (ev < 2) break;
                const rest = restAt(nearestFoe, A - 1);
                pushV("Discomfiting Whispers", null, ev + rest.ev, [{ cost: 1, text: `Discomfiting Whispers: a 5-foot aura; ${list(adj.map(nameOf))} save${adj.length > 1 ? "" : "s"} against Will (DC ${dc}) at the start of each turn or roll${adj.length > 1 ? "" : "s"} the first attack twice and take${adj.length > 1 ? "" : "s"} the lower, ${Math.round(dmg)} void if it misses` }, ...rest.steps], [costNote(name), "It only touches foes that start their turn adjacent to you, so it's for when melee is on you and you mean to stay."]);
                break;
            }
            case "Devouring Dark Form": {
                const str = Number(actor?.system?.abilities?.str?.mod) || 0;
                const tent = { label: "tentacle", bonus: unarmedBonus(board), avg: 4.5 + str, reach: 10 };
                if (up) { say(`Devouring Dark Form is up: the first Sustain each round (1 action) is also a free Grapple with the tentacle (reach 10 feet); the tentacle Strikes at ${signed(tent.bonus)} for about ${Math.round(tent.avg)}.`); break; }
                if (!canCast) break;
                const f = foes.filter((g) => inReach(me.rect, g.rect, 10)).sort((a, b) => a.ac - b.ac)[0];
                if (!f) break;
                let ev = 0, made = ctx.made;
                const shown = [];
                for (let i = 0; i < A - 1; i++) { const b = tent.bonus + mapFor(made, false); ev += strikeExpected(b, f.ac, tent.avg + (enhancement ? 3.5 : 0)).expected; shown.push(signed(b)); made += 1; }
                const own = inReach(me.rect, f.rect, myReach(board)) ? strikeRun(board, f, A - 1, { made: ctx.made }).ev : 0;
                if (ev <= own + 1 && A - 1 > 0) break;
                pushV(`Devouring Dark Form, then Strike ${nameOf(f)}`, f, ev, [{ cost: 1, text: `Devouring Dark Form: a tentacle, 1d8${str ? signed(str) : ""} bludgeoning, reach 10 feet, grapple${rank >= 2 ? `; or a shark battle form (animal form rank ${rank})` : ""}` }, ...(A - 1 > 0 ? [{ cost: A - 1, text: `Strike ${nameOf(f)} with the tentacle${A - 1 > 1 ? ` ${A - 1 === 2 ? "twice" : "three times"}` : ""} (${shown.join(", ")})${enhancement ? ", +1d6 spirit (Apparition's Enhancement)" : ""}` }] : [])], [costNote(name), "Each later turn the first Sustain is also a free Grapple with the tentacle."], null, 0.2);
                break;
            }
            case "Crown of Prophets": {
                const poison = 2.5 * (rank + 1);
                const close = foes.filter((f) => near(f, 15));
                if (up) { say(`Crown of Prophets is up: the first Sustain each round (1 action) is also Toxic Prophecy, about ${Math.round(poison)} poison (basic Fortitude) on a foe within 15 feet that damaged you since your last turn${close.length ? ` (${list(close.map(nameOf))} ${close.length > 1 ? "are" : "is"} close enough)` : ""}, or a free Recall Knowledge.`); break; }
                if (!canCast) break;
                const ab = actor?.system?.abilities ?? {};
                const fangs = { bonus: unarmedBonus(board), avg: 3.5 + (Number(ab.str?.mod) || 0) };
                say(`Crown of Prophets (1 action, 1 Focus Point, ${focus} left): fangs (${signed(fangs.bonus)}, agile, finesse, about ${Math.round(fangs.avg)}), and on each cast or Sustain a free Toxic Prophecy, about ${Math.round(poison)} poison (basic Fortitude, DC ${dc}) on a foe within 15 feet that damaged you since your last turn${hurt(me) > 0 && close.length ? `; ${list(close.map(nameOf))} ${close.length > 1 ? "are" : "is"} within 15 feet now` : ""}. Cast it on a turn you've been hit and mean to stay in the thick of it.`);
                break;
            }
            case "Trickster's Mirrors": {
                const onMe = foes.filter((f) => inReach(f.rect, me.rect, f.reach ?? 5));
                if (up) { say(`Trickster's Mirrors is up: Sustain it (1 action) for another mirror, up to three (then 1 in 4 attacks find you); a mirror an adjacent attacker breaks deals ${Math.round(2.5 * rank)} mental (basic Will).`); break; }
                if (!canCast) break;
                say(`Trickster's Mirrors (1 action, 1 Focus Point, ${focus} left): one mirror now, so half the attacks on you hit glass instead, a mirror more each Sustain up to three${onMe.length ? `; ${list(onMe.map(nameOf))} ${onMe.length > 1 ? "have" : "has"} you in reach, so it's the turn for it` : "; cast it when melee reaches you"}. An attacker within 5 feet that breaks one takes ${Math.round(2.5 * rank)} mental (basic Will).`);
                break;
            }
            case "River Carving Mountains": {
                if (up) { say("River Carving Mountains is up: the Sustain (1 action) is also a free Stride that leaves difficult terrain behind you; +10 Speed and lesser cover from ranged attacks while it runs."); break; }
                if (!canCast) break;
                say(`River Carving Mountains (1 action, 1 Focus Point, ${focus} left): +10 feet to your Speeds, lesser cover against ranged attacks, and a free Stride on the cast and each Sustain that turns the squares you cross into difficult terrain until your next turn. It's for getting away from melee or laying a line the foes must wade through, not for standing still.`);
                break;
            }
            case "Gift of the Anemos": {
                const inAura = foes.filter((f) => near(f, 10));
                if (up) { say(`Gift of the Anemos is up: the Sustain (1 action) is also a free Step, a Shove with your spell attack modifier${inAura.length ? ` (${list(inAura.map(nameOf))} in the aura)` : ""}, or a 10-foot jump; a foe that critically misses you with a Strike saves against Reflex or is off-guard until the end of your next turn.`); break; }
                if (!canCast) break;
                say(`Gift of the Anemos (1 action, 1 Focus Point, ${focus} left): a 10-foot aura; the cast and each Sustain give a free Step, a Shove with your spell attack modifier on a foe in the aura, or a 10-foot jump, and a foe that critically misses you with a Strike is off-guard until the end of your next turn on a failed Reflex save${inAura.length ? `; ${list(inAura.map(nameOf))} ${inAura.length > 1 ? "are" : "is"} in it now` : ""}.`);
                break;
            }
            case "Darkened Forest Form": {
                if (up) { say("Darkened Forest Form is up: each Sustain (1 action) can change your form to another on its lists; the form's Strikes are on your sheet while it lasts."); break; }
                if (!canCast) break;
                say(`Darkened Forest Form (1 action, 1 Focus Point, ${focus} left): a pest form${rank >= 2 ? `, or an animal battle form at rank ${rank} (its own attack bonus and damage, your spells off while you hold it)` : ""}${rank >= 5 ? ", or an elemental form" : ""}; it lasts while you Sustain it${hasAny(actor, "walk-the-wilds") ? ", up to 5 minutes in an animal form (Walk the Wilds)" : ""}. A battle form is a turn of setup; pick it when the fight will run long and your spells are spent.`);
                break;
            }
            case "Store Time": {
                const reactions = [["whispers-of-warning", "Whispers of Warning"], ["blazing-spirit", "Blazing Spirit"], ["apparition-cloud", "Apparition Cloud"], ["shadows-within-shadows", "Shadows Within Shadows"]].filter(([s]) => hasAny(actor, s)).map(([, n]) => n);
                if (up) { say(`Store Time is up: the first Sustain each round (1 action) gives you a spare reaction for ${reactions.length ? list(reactions) : "your animist and apparition reactions"}.`); break; }
                if (!canCast) break;
                say(`Store Time (1 action, 1 Focus Point, ${focus} left): a spare reaction each round, for animist and apparition reactions only${reactions.length ? ` (${list(reactions)})` : ", and you have none on the sheet, so it does little here"}.`);
                break;
            }
            case "Traveling Workshop": say("Traveling Workshop is your vessel spell: tools and Crafting, nothing for a fight. Circle of Spirits to another apparition if you have one."); break;
            case "Wish Market": if (!up && canCast) say(`Wish Market (2 actions, 1 Focus Point, ${focus} left): +${rank >= 7 ? 3 : rank >= 4 ? 2 : 1} to Perception and one of Acrobatics, Athletics, Nature, Occultism or Religion, a free Recall Knowledge or Seek on the cast and each Sustain, at a random -2 to a pair of skills. For a fight with something to identify or find, not for damage.`); break;
            default: break;
        }
    }
    if (vessels.length && focus === 0 && !vessels.some((v) => vesselUp(v.name))) out.notes.push(`No Focus Points: ${list(vessels.map((v) => v.name))} wait${vessels.length > 1 ? "" : "s"} for a Refocus; your cantrips and slots carry the turn.`);

    // --- Feats that ride on a spell: say when --------------------------------------------------------------------------
    if (enhancement && !relinquished && (vessels.length || castable(board, (sp) => !sp.cantrip).length) && ctx.actions >= 2) out.notes.push("Apparition's Enhancement (free, once a turn, right after a non-cantrip spell): one weapon or unarmed attack deals +1d6 spirit until the end of your turn. A one-action vessel spell then a Strike is the cheap way to it.");
    if (hasAny(actor, "grasping-spirits-spell") && ctx.actions >= 2) {
        const single = castable(board, (sp) => sp.range > 0 && !sp.area && (sp.attack !== null && sp.attack !== undefined || sp.save) && sp.cost <= ctx.actions - 1);
        const far = foes.filter((f) => !inReach(me.rect, f.rect, myReach(board)));
        if (single.length && far.length) out.notes.push(`Grasping Spirits Spell (1 action before a one-target ranged spell, once per 10 minutes): +30 feet of range, and the target is pulled up to 30 feet toward you on a failed Fortitude save (DC ${dc}). Use it to drag ${list(far.slice(0, 2).map(nameOf))} into your allies' reach.`);
    }
    if (hasAny(actor, "spiritual-expansion-spell") && ctx.actions >= 3 && castable(board, (sp) => sp.area && ["burst", "cone", "line"].includes(sp.area.shape) && sp.cost <= 2).length) out.notes.push("Spiritual Expansion Spell (1 action before a burst, cone or line spell): +5 feet to a burst of 10 feet or more, +5 to a cone or line of 15 feet or less, +10 to a longer one. Worth it when one more foe falls inside.");
    if (hasAny(actor, "spiritual-spellshape-stance") && hasAny(actor, "grasping-spirits-spell", "spiritual-expansion-spell")) out.notes.push(`Spiritual Spellshape Stance${effect(actor, /spiritual-spellshape/) ? " is up" : " (1 action)"}: once a turn a one-action spellshape is free, on a spirit, vitality or void spell only.`);
    if (hasAny(actor, "apparitions-quickening", "apparition-s-quickening") && attuned.length >= 2 && ctx.actions >= 1) {
        const cheap = castable(board, (sp) => sp.cost >= 2 && (sp.cantrip || (sp.rank ?? 1) <= rankTop - 2)).sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0))[0];
        out.notes.push(`Apparition's Quickening (free, once a round): a cantrip or a spell 2 or more ranks below your top costs one action less${cheap ? ` (${cheap.name} for ${cheap.cost - 1})` : ""}, but the apparition you draw on is gone until tomorrow with its spells, Lore and vessel. For the turn that ends a fight, not a routine one.`);
    }
    if (hasAny(actor, "apparitions-reflection", "apparition-s-reflection") && apparitionEntry) {
        const spent = Object.entries(apparitionEntry.ranks).filter(([r, s]) => Number(r) <= rankTop - 2 && s.left < s.max).map(([r]) => Number(r));
        if (spent.length) out.notes.push(`Apparition's Reflection (once an hour): recast an apparition spell from a spent slot at rank ${Math.max(...spent)} or lower for the spell's own actions, and you're confused until the end of your next turn after it. A last reserve, not a first resort.`);
    }
    if (hasAny(actor, "fly-on-shadowed-wings") && ctx.actions >= 2 && attuned.length >= 2 && !effect(actor, /shadowed-wings/)) out.notes.push(`Fly on Shadowed Wings (2 actions, once an hour): fly at your land Speed and resist precision damage ${lv} for 10 minutes; one apparition is gone for those 10 minutes. For a foe you can't reach on foot or one you need to get away from.`);
    if (hasAny(actor, "cardinal-guardians") && attuned.length >= 2) out.notes.push("Cardinal Guardians: once an apparition or vessel spell hits or a foe fails against one, your other apparitions' spells get +2 to hit it and it saves at -2 against them until the end of your next turn; follow one apparition's spell with another's.");
    if (hasAny(actor, "channeled-protection") && !inStance && stanceFeat && !relinquished && castable(board, (sp) => !sp.cantrip && !sp.focus).length) out.notes.push("Channeled Protection needs Channeler's Stance first, then a slot spell, then its action: +1 AC and Reflex for you and adjacent allies until your next turn.");
    if (hasAny(actor, "apparition-stabilization")) out.notes.push(`Apparition Stabilization: a reaction that would disrupt your casting fails on a flat check of ${lv >= 15 ? 10 : lv >= 7 ? 13 : 15} or more.`);

    // --- Relinquish Control before it's used: when it pays ------------------------------------------------------------
    if (hasAny(actor, "relinquish-control") && !relinquished && ctx.actions === 3) {
        const mental = foes.some((f) => (f.traits ?? []).some((t) => ["fey", "fiend", "aberration", "undead", "spirit"].includes(t)));
        out.notes.push(`Relinquish Control (free at the start of your turn): +4 to saves against being controlled or charmed until your next turn, but only Strikes, Steps, Recall Knowledge and apparition and vessel spells for the turn${hasAny(actor, "instinctive-maneuvers") ? ", plus Grapple, Reposition, Shove and Trip at +2" : ""}${lv >= 17 && practice === "medium" ? "; your Strikes deal +2 spirit, you resist physical damage " + Math.floor(lv / 2) + " and have weakness " + lv + " to spirit" : ""}. ${mental ? "Something here may try your mind; worth it on a turn you'd spend on apparition spells anyway." : "Only on a turn you'd spend on apparition spells anyway."}`);
    }

    // --- The wandering feats that hang on an apparition's Lore ------------------------------------------------------
    const lore = (...ls) => ls.some((l) => lores.has(l));
    if (hasAny(actor, "grudge-strike") && ctx.actions >= 2 && lore("heraldry", "underworld") && board.strikes.some((s) => !s.ranged)) {
        for (const f of foes) {
            const sq = reachSq(f, myReach(board), ctx.actions - 2);
            if (!sq) continue;
            const b = bestStrike(board, f, { made: ctx.made, acAdj: -2, extra: 7 });
            if (!b) continue;
            const left = ctx.actions - 2 - sq.route.actions;
            const steps = [];
            if (sq.route.actions) steps.push({ cost: sq.route.actions, text: moveText(sq, f) });
            const undead = (f.traits ?? []).includes("undead");
            steps.push({ cost: 2, text: `Grudge Strike ${nameOf(f)} with ${b.s.label} (${signed(b.bonus)}, +2 in it): +2d6 ${undead ? "vitality" : "void"} on a hit, about ${Math.round(b.e.expected)} in all` });
            let ev = b.e.expected;
            if (left >= 1) { const r = strikeRun(board, f, left, { made: ctx.made + 1 }); if (r.used.length) { steps.push({ cost: r.used.length, text: r.text }); ev += r.ev; } }
            push(`Grudge Strike ${nameOf(f)}`, f, ev, steps, [], sq.route.actions ? { x: sq.x, y: sq.y } : null, 0.3);
        }
    } else if (hasAny(actor, "grudge-strike") && !lore("heraldry", "underworld") && attuned.length) out.notes.push("Grudge Strike needs an apparition with Heraldry or Underworld Lore attuned; none is today.");
    if (hasAny(actor, "blazing-spirit")) out.notes.push(lore("battlegrounds", "volcano") ? `Blazing Spirit (reaction, once per 10 minutes): when a melee attack damages you, resistance ${lv} to it and the attacker takes ${lv >= 18 ? "3d6" : lv >= 12 ? "2d6" : "1d6"} fire and ${lv >= 18 ? 3 : lv >= 12 ? 2 : 1} persistent fire.` : "Blazing Spirit needs an apparition with Battlegrounds or Volcano Lore attuned; none is today.");
    if (hasAny(actor, "roaring-heart") && ctx.actions >= 2) out.notes.push(lore("mountain") ? `Roaring Heart (2 actions): Stride twice and Shove up to two foes you pass; one Shove that lands gives you and allies within 30 feet ${Math.floor(lv / 2)} temporary HP until your next turn, both landing gives ${lv}. For a turn you're moving through the line anyway.` : "Roaring Heart needs an apparition with Mountain Lore attuned; none is today.");
    if (hasAny(actor, "shadows-within-shadows")) out.notes.push(lore("hunting", "underworld") ? "Shadows Within Shadows (reaction): a foe Seeking you, or counteracting your invisibility or concealment, rerolls and takes the worse." : "Shadows Within Shadows needs an apparition with Hunting or Underworld Lore attuned; none is today.");
    if (hasAny(actor, "forests-heart", "forest-s-heart") && ctx.actions >= 1) {
        if (!lore("forest", "herbalism")) out.notes.push("Forest's Heart needs an apparition with Forest or Herbalism Lore attuned; none is today.");
        else if (effect(actor, /forests?-s?-?heart/)) out.notes.push("Forest's Heart is up: your roots Strike at 30-foot reach, 4d8 bludgeoning, finesse and grapple; they're among your Strikes.");
        else {
            const ab = actor?.system?.abilities ?? {};
            const root = { bonus: unarmedBonus(board), avg: 18 + Math.max(Number(ab.str?.mod) || 0, 0) };
            for (const f of foes.filter((g) => inReach(me.rect, g.rect, 30)).sort((a, b) => a.ac - b.ac).slice(0, 2)) {
                let ev = 0, made = ctx.made;
                const shown = [];
                for (let i = 0; i < ctx.actions - 1; i++) { const b = root.bonus + mapFor(made, false); ev += strikeExpected(b, f.ac, root.avg).expected; shown.push(signed(b)); made += 1; }
                const own = inReach(me.rect, f.rect, myReach(board)) ? strikeRun(board, f, ctx.actions - 1, { made: ctx.made }).ev : 0;
                if (ev <= own + 1) continue;
                push(`Forest's Heart, then Strike ${nameOf(f)}`, f, ev, [{ cost: 1, text: "Forest's Heart: roots and vines as unarmed attacks, 4d8 bludgeoning, finesse, grapple, reach 30 feet, until you leave the stance" }, ...(ctx.actions - 1 > 0 ? [{ cost: ctx.actions - 1, text: `Strike ${nameOf(f)} with the roots${ctx.actions - 1 > 1 ? ` ${ctx.actions - 1 === 2 ? "twice" : "three times"}` : ""} (${shown.join(", ")})` }] : [])], ["The roots take no striking rune, only handwraps' attack bonus and property runes; the stance holds until you leave it, so later turns are three root Strikes or a Grapple at 30 feet."], null, 0.2);
            }
        }
    }
    if (hasAny(actor, "jesters-gambol", "jester-s-gambol") && ctx.actions >= 1 && !effect(actor, /jesters?-s?-?gambol/)) out.notes.push(lore("circus", "fey") ? `Jester's Gambol (1 action, a stance): you ignore difficult terrain and resist ${Math.floor(lv / 2)} damage from animals, beasts, fey, fungi and plants${foes.some((f) => (f.traits ?? []).some((t) => ["animal", "beast", "fey", "fungus", "plant"].includes(t))) ? "; such foes are here" : ""}.` : "Jester's Gambol needs an apparition with Circus or Fey Lore attuned; none is today.");
    if (hasAny(actor, "monstrous-inclinations") && !lore("forest", "ocean") && attuned.length) out.notes.push("Monstrous Inclinations needs an apparition with Forest or Ocean Lore attuned; none is today, so monstrosity form is off your repertoire.");

    // --- Reactions and free actions: when they fire --------------------------------------------------------------------
    if (hasAny(actor, "whispers-of-warning")) out.notes.push("Whispers of Warning (reaction, once per 10 minutes): an attack that would hit you, not critically, is rolled again and takes the lower.");
    if (hasAny(actor, "apparition-cloud")) out.notes.push("Apparition Cloud (reaction, familiar adjacent or in your space): an attack aimed at you misses outright, your familiar can't be targeted, and the squares around you are difficult terrain for foes until your next turn.");
    if (hasAny(actor, "spirits-sacrifice", "spirit-s-sacrifice") && me.hp <= me.maxHp * 0.35) out.notes.push(`Spirit's Sacrifice (free, even unconscious): if you would die, an apparition disperses for the day, you don't, your wounded drops to 1 and you regain ${2 * lv} HP.`);
    if (hasAny(actor, "cycle-of-souls") && !inStance && ctx.actions === 3 && hasAny(actor, "channelers-stance", "channeler-s-stance", "forests-heart", "forest-s-heart", "jesters-gambol", "jester-s-gambol", "spiritual-spellshape-stance")) out.notes.push("Cycle of Souls (free at the start of your turn): Step, then enter one of your animist stances, both for nothing.");

    // --- The practice -------------------------------------------------------------------------------------------------
    const spiritFoes = foes.filter((f) => { const t = f.traits ?? []; return t.includes("spirit") || t.includes("haunt") || (t.includes("undead") && t.includes("incorporeal")); });
    if (practice === "seer" && spiritFoes.length) out.notes.push(`Seer: +${lv >= 17 ? 3 : lv >= 9 ? 2 : 1} to AC and saves against haunts, spirits and incorporeal undead${lv >= 9 ? `, and resistance ${Math.floor(lv / 2)} to spirit and void` : ""}; ${list(spiritFoes.map(nameOf))} ${spiritFoes.length > 1 ? "are" : "is"} that kind.`);
    if (practice === "shaman" || hasAny(actor, "spirit-familiar-animist", "spirit-familiar")) {
        const familiar = board.allies?.find((a) => a.type === "familiar" || /familiar/i.test(a.actor?.type ?? "")) ?? null;
        out.notes.push(`Spirit familiar: it is one of your apparitions made flesh; if it's destroyed you lose that apparition's spells, Lore and vessel until tomorrow${familiar ? `, so keep ${nameOf(familiar)} out of the line` : ""}${lv >= 17 && practice === "shaman" ? "; it can turn incorporeal for a minute (1 action, within 60 feet of you)" : ""}.`);
    }
    if (practice === "liturgist") {
        if (lv >= 9 && (vessels.some((v) => vesselUp(v.name)) || board.sustain)) out.notes.push("Dancing Invocation: a Step, Leap or Tumble Through this turn also Sustains your apparition or vessel spell, so the Sustain costs you no extra action.");
        if (lv >= 17 && ctx.actions === 3 && (board.turn?.round ?? globalThis.game?.combat?.round ?? 1) <= 1) {
            const prim = primaries[0];
            out.notes.push(`Invocation of Praise: Circle of Spirits was free at initiative, and if your first action now is ${prim?.cantrip ? `${prim.cantrip} (${prim.name}'s cantrip)` : "your primary apparition's cantrip"} it costs one action less.`);
        }
    }
    if (practice === "medium" && lv >= 9 && vessels.length < 2 && attuned.length >= 2) out.notes.push("Dual Invocation: you hold two primary apparitions, so two vessel spells belong on your sheet; only one is there.");

    // --- The top of the tree --------------------------------------------------------------------------------------------
    if (hasAny(actor, "supreme-incarnation")) {
        const avatar = spellNamed(/^avatar$/i);
        const prim = primaries[0];
        out.notes.push(avatar ? `Supreme Incarnation: avatar from your 10th-rank apparition slot turns you into ${prim ? `${prim.name}'s avatar form` : "your primary apparition's avatar form"} for a minute; the fight that deserves it is the one you can't win with slots.` : "Supreme Incarnation: your 10th-rank apparition slot is spent or holds no avatar.");
    }
    if (hasAny(actor, "true-channel-spell")) { const tenth = castable(board, (sp) => sp.rank >= 10 && !sp.cantrip && !sp.focus); out.notes.push(tenth.length ? `True Channel Spell: ${list(tenth.map((sp) => sp.name))} at rank 10 ${tenth.length > 1 ? "are" : "is"} still prepared.` : "True Channel Spell: your 10th-rank prepared slot is spent."); }
    if (hasAny(actor, "embodiment-of-the-balance") && !spellNamed(/^(heal|harm)$/i) && apparitionEntry) out.notes.push("Embodiment of the Balance puts heal and harm in your apparition repertoire; neither is on the board, so the slots are spent or they aren't on the sheet.");
    if (dedication) out.notes.push("Animist Dedication: one bonded apparition, its spells prepared in your archetype slots; no vessel spell unless a feat grants one.");
}

export { animist };
