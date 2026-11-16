/**
 * PF2e Tactics: board-data.mjs
 *
 * What the board reads from documents about a creature: encounter tactics (from other modules' sources and its own
 * flag), the GM's notes, recharge waits (this module's and PF2e Workbench's), and the threat table on the combat.
 */
import { FLAG_SCOPE, MODULE_ID, baseActorOf, flagOf, refreshCard } from "./shared.mjs";
import { threatDecay, threatOn } from "./values.mjs";

const SOURCES = [];

/** Another module can supply tactics text for an actor: { id, label?, get(actor, token) -> [{ title, html }] }. */
function registerSource(source) {
    if (!source?.id || typeof source.get !== "function") throw new Error(`${MODULE_ID} | registerSource needs { id, get }`);
    const i = SOURCES.findIndex((s) => s.id === source.id);
    if (i >= 0) SOURCES.splice(i, 1, source);
    else SOURCES.push(source);
    refreshCard(100); // a source that loads late (after a combat was already running) still shows up
}

function tacticsOf(actor, token) {
    const out = [];
    for (const s of SOURCES) {
        try { for (const t of s.get(actor, token) ?? []) if (t?.html) out.push({ title: t.title ?? s.label ?? s.id, html: t.html }); } catch (err) { console.warn(`${MODULE_ID} | tactics source ${s.id} failed`, err); }
    }
    const base = baseActorOf(actor);
    for (const t of flagOf(actor, "tactics") ?? flagOf(base, "tactics") ?? []) if (t?.html) out.push({ title: t.title ?? "Tactics", html: t.html });
    return out;
}

/** Your notes for the creature. */
function notesOf(actor) {
    return flagOf(actor, "notes") ?? "";
}

// --- Recharge
function rechargeLeft(actor, itemId) {
    const combat = game.combat;
    if (!combat) return 0;
    let left = 0;
    const entry = actor?.flags?.[FLAG_SCOPE]?.recharge?.[itemId];
    if (entry && entry.combatId === combat.id) left = Math.max(0, Number(entry.readyRound) - Number(combat.round || 0));
    // PF2e Workbench's recharge reminder: a "Used <ability>" effect whose duration is the recharge it rolled
    // The first roll is the real one (posting the card again makes Workbench roll again)
    const used = usedEffects(actor, actor?.items?.get?.(itemId)).filter((e) => !e.remainingDuration?.expired && Number.isFinite(Number(e.remainingDuration?.remaining)))
        .sort((a, b) => (a._stats?.createdTime ?? 0) - (b._stats?.createdTime ?? 0))[0];
    if (used) left = Math.max(left, Math.ceil((Number(used.remainingDuration.remaining) || 0) / 6));
    return left;
}

/** The "Used <ability>" effects PF2e Workbench puts on a creature for a recharge ability it used. */
function usedEffects(actor, item) {
    if (!actor || !item?.name) return [];
    let prefix = "Used ";
    try { const l = game.i18n?.localize?.("xdy-pf2e-workbench.SETTINGS.reminderBreathWeapon.used"); if (l && !l.startsWith("xdy-")) prefix = l; } catch { /* English */ }
    const name = item.name.toLowerCase();
    const want = [`${prefix}${item.name}`, `used ${item.name}`].map((x) => x.toLowerCase().trim());
    return (actor.itemTypes?.effect ?? []).filter((e) => {
        const n = String(e.name ?? "").toLowerCase().trim();
        return want.includes(n) || (String(e.system?.slug ?? "").startsWith("xdy-breath-weapon-reminder") && n.endsWith(name));
    });
}

/** With PF2e Workbench's "Recharge reminder" on, Workbench rolls recharges and this module reads its effect. */
const workbenchRecharge = () => {
    try { return !!game.modules.get("xdy-pf2e-workbench")?.active && !!game.settings.get("xdy-pf2e-workbench", "reminderBreathWeapon"); } catch { return false; }
};

// --- Threat
function threatFor(combat, tokenId) {
    if (!threatOn()) return {};
    const f = flagOf(combat, "threat");
    const row = f?.t?.[tokenId];
    if (!row || typeof row !== "object") return {};
    const k = Math.pow(threatDecay(), Math.max(0, (combat.round ?? 0) - (f.round ?? 0)));
    return Object.fromEntries(Object.entries(row).map(([id, v]) => [id, (Number(v) || 0) * k]));
}

export { notesOf, rechargeLeft, registerSource, tacticsOf, threatFor, usedEffects, workbenchRecharge };
