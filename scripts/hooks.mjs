/**
 * PF2e NPC Tactics: hooks.mjs
 * Turns, trigger whispers, Foundry hooks, settings and the module API.
 * One module, several files: see pf2e-tactics.mjs for the whole.
 */
import { FLAG_SCOPE, MODULE_ID, esc, setting, flagOf } from "./shared.mjs";
import { HP_AT_TURN, RECENT, isDown, profileItem, readBoard, stripTags } from "./reader.mjs";
import { bindCard, buildCard, clearPath, closeWindow, editNotes, intentFrom, openCard, parseTriggers, postCard, rechargeLeft, refreshIfShowing, refreshSoon, registerSource, showWindow, triggersFor, turnWindow, usedEffects } from "./card.mjs";
import { currentLedger, ledgerFor, ledgerTotals, onAbilityUsed, onChatForTurn, onDropped, onLearnMessage, onLearnToolbelt, onMoved, onPersistent, onSustainCast, onThreatMessage, onToolbeltSaves, setThreatRow, threatFor } from "./state.mjs";
import { planTurn } from "./advisor.mjs";

// --- Turns -------------------------------------------------------------------------------------
const isNpcTurn = (c) => !!c?.actor && !c.actor.hasPlayerOwner && !c.isDefeated;

let lastPosted = null;
async function onTurn(combat) {
    if (!game.user.isGM || combat !== game.combat) return;
    clearPath();
    const m = setting("mode", "window");
    const c = combat.combatant;
    if (!combat.started || !isNpcTurn(c)) {
        if (m === "window") await closeWindow();
        return;
    }
    // How much it has lost since its last turn began (morale)
    const hpNow = c.actor.hitPoints?.value;
    const prev0 = HP_AT_TURN.get(c.tokenId);
    const prev = prev0?.combatId === combat.id ? prev0 : null;
    if (Number.isFinite(hpNow) && prev?.round !== combat.round) {
        RECENT.set(c.tokenId, { combatId: combat.id, round: combat.round, dmg: prev && prev.round < combat.round ? Math.max(0, prev.hp - hpNow) : 0 });
        HP_AT_TURN.set(c.tokenId, { combatId: combat.id, hp: hpNow, round: combat.round });
    }
    try {
        if (m === "window") await showWindow(c.actor, c.token?.object ?? c.token);
        else if (m === "chat" && game.users.activeGM?.id === game.user.id) {
            // Keyed on the combatant, and kept on the combat, so a re-sort or a reload doesn't post it twice
            const key = `${combat.round}:${c.id}`;
            if (key === lastPosted || flagOf(combat, "posted") === key) return;
            lastPosted = key;
            await combat.setFlag(FLAG_SCOPE, "posted", key);
            await postCard(c.actor, c.token?.object ?? c.token);
        }
    } catch (err) {
        console.error(`${MODULE_ID} | NPC turn card failed`, err);
    }
}

// --- Trigger whispers: the moment a trigger comes true, even on a player's turn ---------------------
let triggerTimer = null;
function checkTriggersSoon() {
    if (!game.combat?.started || !setting("triggerWhispers", true) || game.users.activeGM?.id !== game.user.id) return;
    clearTimeout(triggerTimer);
    triggerTimer = setTimeout(checkTriggers, 300);
}
const firedHere = new Map(); // combat id -> keys already whispered from this client (covers a slow setFlag)
async function checkTriggers() {
    const combat = game.combat;
    if (!combat?.started) return;
    if (!firedHere.has(combat.id)) firedHere.set(combat.id, new Set());
    const here = firedHere.get(combat.id);
    const fired = new Set([...(flagOf(combat, "fired") ?? []), ...here]);
    const fresh = [];
    for (const c of combat.combatants) {
        if (!c.actor || c.actor.hasPlayerOwner) continue;
        if (isDown(c.actor, c)) continue; // the fallen don't act on a trigger
        let list = [];
        try { list = triggersFor(c.actor, c.token, combat); } catch { continue; }
        for (const t of list) {
            if (t.state !== "now") continue;
            const key = `${c.id}:${t.raw}`;
            if (fired.has(key)) continue;
            fired.add(key);
            here.add(key);
            fresh.push({ c, t });
        }
    }
    if (!fresh.length) return;
    await combat.setFlag(FLAG_SCOPE, "fired", [...fired]);
    // One whisper per trigger line: an encounter-wide line ("two wolves are down") names everyone it moves
    const byLine = new Map();
    for (const { c, t } of fresh) {
        const k = t.who ? `${c.id}:${t.raw}` : t.raw;
        if (!byLine.has(k)) byLine.set(k, { t, names: [] });
        byLine.get(k).names.push(c.token?.name ?? c.actor.name);
    }
    for (const { t, names } of byLine.values()) {
        await ChatMessage.create({
            content: `<div class="npt-whisper"><strong>${esc(names.join(", "))}</strong>: ${esc(t.cond)}${t.then ? ` → <strong>${esc(t.then)}</strong>` : ""}</div>`,
            whisper: game.users.filter((u) => u.isGM).map((u) => u.id),
            speaker: { alias: "Trigger" },
        });
    }
    refreshSoon(50);
}


// --- Hooks -------------------------------------------------------------------------------------
Hooks.on("updateCombat", (combat, changes) => {
    if ("turn" in changes || "round" in changes || "started" in changes || "combatants" in changes) onTurn(combat);
    if ("round" in changes || "started" in changes) checkTriggersSoon();
    if (changes.flags?.[MODULE_ID]?.threat && combat === game.combat) refreshSoon(250);
});
Hooks.on("deleteCombat", () => { clearPath(); closeWindow(); });
Hooks.on("deleteToken", (doc) => { if (turnWindow?.token && doc.id === turnWindow.token.id) clearPath(); });
Hooks.on("combatStart", (combat) => onTurn(combat));
Hooks.on("updateCombatant", () => checkTriggersSoon());
Hooks.once("ready", () => {
    if (game.combat?.started) onTurn(game.combat);
});

// Only what can change the card: the creature shown, or anyone standing on the scene being read
const onScene = (actor) => !!canvas?.scene && (actor?.isToken ? actor.token?.parent === canvas.scene : !!actor?.getActiveTokens?.(true, true)?.some((t) => t.parent === canvas.scene));
Hooks.on("updateActor", (actor, changes) => {
    refreshIfShowing(actor);
    if (!("system" in changes)) return;
    // Someone else on the scene: only what the board reads matters (HP and the like, not spell slots or notes)
    const matters = !!(changes.system?.attributes || changes.system?.traits || changes.system?.movement || changes.system?.details?.alliance !== undefined || changes.system?.perception);
    if (matters && onScene(actor)) refreshSoon(250);
    if (changes.system?.attributes && game.combat?.combatants?.some((c) => c.actor === actor || c.actorId === actor.id)) checkTriggersSoon();
});
for (const hook of ["createItem", "updateItem", "deleteItem"]) Hooks.on(hook, (item) => {
    refreshIfShowing(item.parent);
    // Prone, grabbed, dying, a frenzy's effect: on anyone on the scene, that changes the board
    if (!["condition", "effect"].includes(item.type) || !onScene(item.parent)) return;
    refreshSoon(250);
    checkTriggersSoon();
});
// The board changed: someone moved, appeared or left
const BOARD_FIELDS = ["x", "y", "width", "height", "hidden", "elevation", "disposition", "delta", "actorId", "level", "movementAction"];
Hooks.on("updateToken", (doc, changes) => { if (doc.parent === canvas?.scene && BOARD_FIELDS.some((k) => k in changes)) refreshSoon(300); });
for (const hook of ["createToken", "deleteToken"]) Hooks.on(hook, (doc) => { if (doc.parent === canvas?.scene) refreshSoon(300); });
/** "When it scores a critical hit with a Strike, it recharges its Breath Weapon" (Draconic Momentum): clear the wait. */
async function onCritRecharge(message) {
    if (game.users.activeGM?.id !== game.user.id) return;
    const combat = game.combat;
    const ctx = message.flags?.pf2e?.context;
    if (!combat?.started || ctx?.type !== "attack-roll" || ctx.outcome !== "criticalSuccess") return;
    const actor = message.actor;
    if (!actor || actor.hasPlayerOwner) return;
    const waits = flagOf(actor, "recharge") ?? {};
    // Recharging: its own timer, or a PF2e Workbench "Used ..." effect
    const live = actor.items.filter((i) => ["action", "feat"].includes(i.type) && rechargeLeft(actor, i.id) > 0).map((i) => [i.id, waits[i.id] ?? null]);
    if (!live.length) return;
    const rule = actor.items.find((i) => i.type === "action" && i.system?.actionType?.value === "passive"
        && /\b(?:scores?|lands?|makes?|gets?) a critical hit\b/i.test(stripTags(i.system?.description?.value ?? "")) && /\brecharges?\b/i.test(stripTags(i.system?.description?.value ?? "")));
    if (!rule) return;
    const which = /\bbreath\b/i.test(stripTags(rule.system.description.value)) ? live.filter(([id]) => /breath/i.test(actor.items.get(id)?.name ?? "")) : live;
    if (!which.length) return;
    const ours = which.filter(([, w]) => w?.combatId === combat.id);
    if (ours.length) await actor.setFlag(FLAG_SCOPE, "recharge", Object.fromEntries(ours.map(([id, w]) => [id, { ...w, readyRound: combat.round, setRound: null }])));
    const effects = which.flatMap(([id]) => usedEffects(actor, actor.items.get(id))).map((e) => e.id);
    if (effects.length) await actor.deleteEmbeddedDocuments("Item", effects);
    await ChatMessage.create({
        content: `<p><strong>${esc(which.map(([id]) => actor.items.get(id)?.name ?? "?").join(", "))}</strong> recharges now (${esc(rule.name)}: a critical hit).</p>`,
        whisper: game.users.filter((u) => u.isGM).map((u) => u.id), speaker: { alias: "NPC Turn" },
    });
    refreshSoon(150);
}

Hooks.on("createChatMessage", (message) => {
    onAbilityUsed(message);
    onCritRecharge(message).catch((err) => console.warn(`${MODULE_ID} | couldn't recharge on the critical hit`, err));
    try { onChatForTurn(message); } catch (err) { console.warn(`${MODULE_ID} | couldn't count that toward the turn`, err); }
    try { onThreatMessage(message); } catch (err) { console.warn(`${MODULE_ID} | couldn't read that for threat`, err); }
    try { onLearnMessage(message); } catch (err) { console.warn(`${MODULE_ID} | couldn't read what the NPCs saw`, err); }
    try { onSustainCast(message); } catch (err) { console.warn(`${MODULE_ID} | couldn't note the sustained spell`, err); }
});
Hooks.on("updateChatMessage", (message, changes) => {
    // Damage undone from its card: take its threat back
    if (changes.flags?.pf2e?.appliedDamage?.isReverted === true) { try { onThreatMessage(message, -1); } catch (err) { console.warn(`${MODULE_ID} | couldn't take that threat back`, err); } }
    try { onToolbeltSaves(message, changes); } catch (err) { console.warn(`${MODULE_ID} | couldn't read those saves for threat`, err); }
    try { onLearnToolbelt(message, changes); } catch (err) { console.warn(`${MODULE_ID} | couldn't read what the NPCs saw`, err); }
});
Hooks.on("createItem", (item) => {
    onDropped(item).catch((err) => console.warn(`${MODULE_ID} | couldn't lower threat`, err));
    try { onPersistent(item); } catch (err) { console.warn(`${MODULE_ID} | couldn't note who set the persistent damage`, err); }
});
Hooks.on("moveToken", (doc, movement) => { try { onMoved(doc, movement); } catch (err) { console.warn(`${MODULE_ID} | couldn't count that move`, err); } });
Hooks.on("renderChatMessageHTML", (message, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (root?.querySelector?.(".npt-card")) bindCard(root, null);
});

Hooks.once("init", () => {
    game.settings.register(MODULE_ID, "mode", {
        name: "NPC turn cards",
        hint: "Window: one window that shows the NPC whose turn it is, and closes on player characters' turns. "
            + "Chat: a whisper to the GMs at the start of each NPC turn. The NPC Turn macro works with any setting.",
        scope: "world", config: true, type: String,
        choices: { window: "Window", chat: "Chat whisper", off: "Off" },
        default: "window",
        onChange: (value) => {
            if (value !== "window") closeWindow();
            else if (game.combat?.started) onTurn(game.combat);
        },
    });
    game.settings.register(MODULE_ID, "triggerWhispers", {
        name: "Whisper triggers",
        hint: "When a creature's Trigger line comes true during combat (below 20 HP, its leader is down...), whisper it to the GMs at once.",
        scope: "world", config: true, type: Boolean, default: true,
    });
    // Threat: who each creature is most set on, kept per fight
    const refresh = () => refreshSoon(100);
    game.settings.register(MODULE_ID, "threat", {
        name: "Track threat",
        hint: "Each creature remembers who hurt it, hindered it, healed its foes or attacked it this fight, and that sways who the card says to go for. Off: targets are picked from the board alone.",
        scope: "world", config: true, type: Boolean, default: true, onChange: refresh,
    });
    game.settings.register(MODULE_ID, "threatWeight", {
        name: "How much threat counts",
        hint: "How strongly the top threat pulls a creature's attention. At Normal the most dangerous foe counts as 35-50% juicier than they look (more for cleverer creatures, which also notice who is hurting their allies); Lightly halves that, Strongly doubles it.",
        scope: "world", config: true, type: String, default: "1",
        choices: { "0.5": "Lightly", "1": "Normal", "2": "Strongly" }, onChange: refresh,
    });
    game.settings.register(MODULE_ID, "threatDecay", {
        name: "How fast threat fades",
        hint: "Each new round, everyone's threat fades by this much.",
        scope: "world", config: true, type: String, default: "0.5",
        choices: { "0.5": "Halves each round", "0.75": "Loses a quarter each round", "1": "Never fades" }, onChange: refresh,
    });
    game.settings.register(MODULE_ID, "threatDrop", {
        name: "Threat lost when someone falls unconscious (%)",
        hint: "When someone drops, every creature's threat on them falls by this much, so they aren't the first target the moment they're back up.",
        scope: "world", config: true, type: Number, default: 50, range: { min: 0, max: 100, step: 10 }, onChange: refresh,
    });
    const module = game.modules.get(MODULE_ID);
    module.api = {
        open: openCard,
        card: (actor, token) => buildCard(actor, token),
        plan: async (token) => {
            const b = await readBoard(token?.object ?? token);
            if (!b) return null;
            b.rechargeLeft ??= (p) => rechargeLeft(b.me.actor, p.item?.id ?? p.id);
            const L = ledgerFor(b.me.actor, b.me.token);
            if (L) b.turn = ledgerTotals(L);
            return planTurn(b, { intent: intentFrom(triggersFor(b.me.actor, b.me.token.document).filter((t) => t.state === "now")) });
        },
        turn: () => { const L = currentLedger(); return L ? { ...ledgerTotals(L), log: L.log.map((e) => e.text) } : null; },
        threat: (token) => threatFor(game.combat, token?.id ?? token),
        setThreat: (token, values) => (game.combat ? setThreatRow(game.combat, token?.id ?? token, values) : null),
        board: (token) => readBoard(token?.object ?? token),
        profile: (item) => profileItem(item, item.actor?.name ?? ""),
        registerSource,
        editNotes,
        parseTriggers,
        triggers: (actor, token) => triggersFor(actor, token),
    };
    Hooks.callAll(`${MODULE_ID}.ready`, module.api);
});

