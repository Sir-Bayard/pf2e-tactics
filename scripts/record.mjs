/**
 * PF2e Tactics: record.mjs
 * What a character has done this fight that PF2e doesn't keep anywhere the Turn Helper can read: whether the magus's
 * Spellstrike is charged, which foe the thaumaturge exploited, whether the chalice was drained or the wand boosted, and
 * which foes the character has Demoralized or asked a Pointed Question (each immune to it for 10 minutes). Read from the
 * character's own chat cards by the client that posted them, kept on the character as a flag for the current combat
 * (flags["pf2e-tactics"].record = { combat, spellstrike, exploited, chaliceDrained, wandBoosted, demoralized, asked }),
 * so it survives a reload and starts over with the next fight.
 */
import { flagOf, gmLater, gmLeadNow, isGmLead, MODULE_ID, slugOf } from "./shared.mjs";

/** Actions that recharge Spellstrike besides the plain recharge (a conflux spell is read from its traits). */
const RECHARGERS = new Set(["maguss-analysis", "running-recharge", "recharging-flurry", "rapid-recharge", "spell-retaliation", "recharge-spellstrike"]);

/** This character's record for the combat on now, a fresh one if it has none, or null outside a started combat. */
function ownRecord(actor, combat = game.combat) {
    const r = flagOf(actor, "record");
    if (!combat?.started) return null;
    // no record yet this fight: Spellstrike is charged in round 1, unknown later (a card or the toggle settles it)
    if (!r || r.combat !== combat.id) return { combat: combat.id, spellstrike: (combat.round ?? 0) <= 1 ? true : null, exploited: null, chaliceDrained: null, wandBoosted: null, demoralized: [], asked: [] };
    return { demoralized: [], asked: [], ...r };
}

let chain = Promise.resolve();
function save(actor, change) {
    chain = chain.then(async () => {
        const rec = ownRecord(actor);
        if (!rec) return;
        const next = change(foundry.utils.deepClone(rec));
        if (next) await actor.setFlag(MODULE_ID, "record", next);
    }).catch((err) => console.warn(`${MODULE_ID} | couldn't note what you did`, err));
    return chain;
}

/** A chat card the character's owner just posted: note what it changes. Only the posting client writes. */
function noteOwn(message) {
    const combat = game.combat;
    if (!combat?.started) return;
    const author = message.author;
    if (author?.id !== game.user.id) return;
    const actor = message.actor;
    if (!actor || actor.type !== "character" || !actor.isOwner) return;
    const item = message.item;
    const slug = item ? slugOf(item) : null;
    const ctx = message.flags?.pf2e?.context ?? {};
    const opts = ctx.options ?? [];
    const targetToken = ctx.target?.token ? String(ctx.target.token).split(".").pop() : null;
    const traits = item?.system?.traits?.value ?? [];
    const isDamage = (message.rolls ?? []).some((r) => r?.constructor?.name === "DamageRoll" || r?.options?.evaluatePersistent !== undefined || /damage/i.test(ctx.type ?? ""));
    if (slug === "spellstrike") return save(actor, (r) => ({ ...r, spellstrike: false }));
    if (slug && RECHARGERS.has(slug)) return save(actor, (r) => ({ ...r, spellstrike: true }));
    // a conflux spell that takes an action or more recharges it; another focus spell doesn't
    if (item?.type === "spell" && traits.includes("magus") && traits.includes("focus") && !/reaction|free/i.test(String(item.system?.time?.value ?? ""))) {
        return save(actor, (r) => ({ ...r, spellstrike: true }));
    }
    if ((slug === "exploit-vulnerability" || opts.includes("action:exploit-vulnerability")) && targetToken) {
        // the foe, which creature it is (its base actor: tokens of the same creature share it) and how the check went
        const tok = canvas?.scene?.tokens?.get?.(targetToken) ?? null;
        return save(actor, (r) => ({ ...r, exploited: { id: targetToken, kind: tok?.actorId ?? null, name: tok?.name ?? null, outcome: ctx.outcome ?? null } }));
    }
    if (slug === "drink-from-the-chalice" && isDamage) return save(actor, (r) => ({ ...r, chaliceDrained: true }));
    if (slug === "fling-magic" && isDamage && (message.rolls ?? []).some((r) => /d6/.test(r?.formula ?? ""))) return save(actor, (r) => ({ ...r, wandBoosted: combat.round ?? 0 }));
    if (opts.includes("action:demoralize") && targetToken) return save(actor, (r) => ({ ...r, demoralized: [...new Set([...(r.demoralized ?? []), targetToken])] }));
    if (opts.includes("action:pointed-question") && targetToken) return save(actor, (r) => ({ ...r, asked: [...new Set([...(r.asked ?? []), targetToken])] }));
}

/**
 * An NPC's Demoralize: the leading GM client notes on the combat which foes each NPC token has tried it on (each is
 * immune to that NPC's Demoralize for 10 minutes), so the advisor stops offering it (T35). Kept on the combat as
 * flags["pf2e-tactics"].demoralized = { npcTokenId: [targetTokenId] }; it goes with the combat.
 */
let npcChain = Promise.resolve();
function noteNpc(message, lead = false) {
    const combat = game.combat;
    if (!combat?.started) return;
    if (!lead && !isGmLead()) return gmLater((l) => noteNpc(message, l));
    const actor = message.actor;
    if (!actor || actor.type !== "npc" || actor.hasPlayerOwner) return;
    const ctx = message.flags?.pf2e?.context ?? {};
    if (!(ctx.options ?? []).includes("action:demoralize")) return;
    const target = ctx.target?.token ? String(ctx.target.token).split(".").pop() : null;
    const npcTok = message.token?.id ?? message.speaker?.token ?? null;
    if (!target || !npcTok) return;
    npcChain = npcChain.then(async () => {
        const all = foundry.utils.deepClone(flagOf(combat, "demoralized") ?? {});
        if ((all[npcTok] ?? []).includes(target)) return;
        all[npcTok] = [...(all[npcTok] ?? []), target];
        await combat.setFlag(MODULE_ID, "demoralized", all);
    }).catch((err) => console.warn(`${MODULE_ID} | couldn't note the Demoralize`, err));
    return npcChain;
}

/**
 * A player character's successful Recall Knowledge on a foe in the fight (T19): the leading GM client marks it identified
 * on the combat, so its creature traits reach the Turn Helper's board (flags["pf2e-tactics"].identified[tokenId]). The GM
 * can also set or clear it in the fight window. A blind roll counts too: the GM's client sees its result.
 */
function noteIdentify(message, lead = false) {
    const combat = game.combat;
    if (!combat?.started) return;
    if (!lead && !isGmLead()) return gmLater((l) => noteIdentify(message, l));
    const actor = message.actor;
    if (!actor || actor.type !== "character") return;
    const ctx = message.flags?.pf2e?.context ?? {};
    if (!(ctx.options ?? []).includes("action:recall-knowledge") || !["success", "criticalSuccess"].includes(ctx.outcome)) return;
    const target = ctx.target?.token ? String(ctx.target.token).split(".").pop() : null;
    if (!target || flagOf(combat, "identified")?.[target] || !combat.combatants.some((c) => c.tokenId === target && !c.actor?.hasPlayerOwner)) return;
    return combat.update({ [`flags.${MODULE_ID}.identified.${target}`]: true }).catch((err) => console.warn(`${MODULE_ID} | couldn't mark the foe identified`, err));
}

/**
 * A character's turn starts: the client of a player who owns it (or the GM's, when no owner is on) notes which foes are
 * down now, so "a foe dropped since your last turn" (End It!, Demand Surrender) can be told apart from one down for a
 * while (record.downAtTurn).
 */
function noteTurnStart(combat) {
    const actor = combat?.combatant?.actor;
    if (!combat?.started || !actor || actor.type !== "character" || !actor.isOwner) return;
    const ownerOn = (game.users?.contents ?? []).some((u) => u.active && !u.isGM && actor.testUserPermission?.(u, "OWNER"));
    if (game.user.isGM && ownerOn) return;
    const down = combat.combatants.filter((x) => x.actor && !x.actor.hasPlayerOwner && (x.isDefeated || (x.actor.hitPoints?.value ?? 1) <= 0)).map((x) => x.tokenId);
    return save(actor, (r) => ({ ...r, downAtTurn: down }));
}

/** The helper's toggle, for a Spellstrike rolled without its card. */
function setSpellstrike(actor, charged) {
    return save(actor, (r) => ({ ...r, spellstrike: !!charged }));
}

/** What the advice board takes from the record (the class reads use these keys when they're there). */
function recordForBoard(actor) {
    const r = ownRecord(actor);
    if (!r) return {};
    const round = game.combat?.round ?? 0;
    return {
        spellstrikeCharged: typeof r.spellstrike === "boolean" ? r.spellstrike : undefined,
        exploited: !r.exploited ? null : typeof r.exploited === "string" ? { id: r.exploited } : { ...r.exploited },
        chaliceDrained: typeof r.chaliceDrained === "boolean" ? r.chaliceDrained : undefined,
        // a boosted wand stays spent until the end of your next turn
        wandBoosted: r.wandBoosted != null ? round - r.wandBoosted <= 1 : undefined,
        demoralized: new Set(r.demoralized ?? []),
        asked: new Set(r.asked ?? []),
        // foes already down when this turn began (null until a turn of this fight has been seen)
        downAtTurn: Array.isArray(r.downAtTurn) ? new Set(r.downAtTurn) : null,
    };
}

/**
 * When a combat is deleted, the GM's client (which owns every character) clears the record from each character that
 * fought in it, and any record left from a combat that has since been deleted.
 */
async function clearRecords(combat) {
    if (!(await gmLeadNow())) return;
    const actors = new Set();
    for (const c of combat?.combatants ?? []) if (c.actor?.type === "character") actors.add(c.actor);
    for (const a of game.actors ?? []) if (a.type === "character" && flagOf(a, "record")) actors.add(a);
    for (const a of actors) {
        const r = flagOf(a, "record");
        if (!r) continue;
        if (r.combat !== combat?.id && game.combats?.get?.(r.combat)) continue; // still fighting elsewhere
        try { await a.unsetFlag(MODULE_ID, "record"); } catch (err) { console.warn(`${MODULE_ID} | couldn't clear a fight record`, err); }
    }
}
Hooks.on("deleteCombat", (combat) => { clearRecords(combat).catch(() => {}); });

export { clearRecords, noteIdentify, noteNpc, noteOwn, noteTurnStart, ownRecord, recordForBoard, setSpellstrike };
