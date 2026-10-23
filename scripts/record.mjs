/**
 * PF2e Tactics: record.mjs
 * What a character has done this fight that PF2e doesn't keep anywhere the Turn Helper can read: whether the magus's
 * Spellstrike is charged, which foe the thaumaturge exploited, whether the chalice was drained or the wand boosted, and
 * which foes the character has Demoralized or asked a Pointed Question (each immune to it for 10 minutes). Read from the
 * character's own chat cards by the client that posted them, kept on the character as a flag for the current combat
 * (flags["pf2e-tactics"].record = { combat, spellstrike, exploited, chaliceDrained, wandBoosted, demoralized, asked }),
 * so it survives a reload and starts over with the next fight.
 */
import { MODULE_ID, flagOf } from "./shared.mjs";

const slugOf = (i) => i?.slug ?? String(i?.name ?? "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** Actions that recharge Spellstrike besides the plain recharge (a conflux spell is read from its traits). */
const RECHARGERS = new Set(["maguss-analysis", "running-recharge", "recharging-flurry", "rapid-recharge", "spell-retaliation", "recharge-spellstrike"]);

/** This character's record for the combat on now, or a fresh one. */
function ownRecord(actor, combat = game.combat) {
    const r = flagOf(actor, "record");
    if (!combat?.started) return null;
    // nothing seen yet this fight: Spellstrike is charged as the fight starts, unknown after that (a card or the toggle settles it)
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
    const author = message.author ?? message.user;
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
    if ((slug === "exploit-vulnerability" || opts.includes("action:exploit-vulnerability")) && targetToken) return save(actor, (r) => ({ ...r, exploited: targetToken }));
    if (slug === "drink-from-the-chalice" && isDamage) return save(actor, (r) => ({ ...r, chaliceDrained: true }));
    if (slug === "fling-magic" && isDamage && (message.rolls ?? []).some((r) => /d6/.test(r?.formula ?? ""))) return save(actor, (r) => ({ ...r, wandBoosted: combat.round ?? 0 }));
    if (opts.includes("action:demoralize") && targetToken) return save(actor, (r) => ({ ...r, demoralized: [...new Set([...(r.demoralized ?? []), targetToken])] }));
    if (opts.includes("action:pointed-question") && targetToken) return save(actor, (r) => ({ ...r, asked: [...new Set([...(r.asked ?? []), targetToken])] }));
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
        exploited: r.exploited ? { id: r.exploited } : null,
        chaliceDrained: typeof r.chaliceDrained === "boolean" ? r.chaliceDrained : undefined,
        // a boosted wand stays spent until the end of your next turn
        wandBoosted: r.wandBoosted != null ? round - r.wandBoosted <= 1 : undefined,
        demoralized: new Set(r.demoralized ?? []),
        asked: new Set(r.asked ?? []),
    };
}

/**
 * When a combat ends, its records go: the GM's client clears the record from every character that fought in it (the GM
 * owns them all; a record from an older fight is cleared too). Nothing about a fight outlives it.
 */
async function clearRecords(combat) {
    if (!game.users?.activeGM?.isSelf) return;
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

export { clearRecords, noteOwn, ownRecord, recordForBoard, setSpellstrike };
