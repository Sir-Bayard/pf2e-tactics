/**
 * PF2e NPC Tactics: state.mjs
 * What the fight has done so far: the turn ledger, recharge timers, the threat table and what the NPCs have learned of their foes' defences. Written by the active GM from chat and token moves.
 * One module, several files: see pf2e-tactics.mjs for the whole.
 */
import { CONDITION_VALUE, NOTICE, actorTier } from "./advisor.mjs";
import { FLAG_SCOPE, MODULE_ID, cap, costGlyph, esc, setting, flagOf } from "./shared.mjs";
import { LAST_TARGET, profileItem, readDescription, readRecharge, speedsOf, spellEffects } from "./reader.mjs";
import { refreshSoon, workbenchRecharge } from "./card.mjs";

// --- The turn so far: what the creature whose turn it is has done, read from the board and chat ------
// Kept in memory on each GM's client for the current turn only. Movement comes from the token moving
// (consecutive moves add up, so dragging in pieces or with the arrow keys counts as the Strides it adds up
// to); Strikes, maneuvers and other checks, ability cards and spells come from chat. The −/+ buttons
// on the card correct it.
const MANEUVER_SLUGS = new Set(["trip", "shove", "grapple", "disarm", "reposition", "escape"]);
// Actions that are a move and a check together: what they cost (High Jump and Long Jump include a Stride)
const TERRAIN_CHECKS = new Set(["balance", "climb"]);
const MOVE_CHECK_COST = { "tumble-through": 1, sneak: 1, climb: 1, swim: 1, balance: 1, leap: 1, "high-jump": 2, "long-jump": 2, squeeze: 1, "maneuver-in-flight": 1 };
/** An ability's credit covers what comes straight after it; anything else ends it. */
function clearCredit(L) { L.credit = { from: null, strikes: 0, moves: 0, checks: 0 }; }
let LEDGER = null;
function turnKey(combat = game.combat) {
    const c = combat?.combatant;
    // Keyed on the combatant, not the turn index, which shifts when someone joins or leaves mid-turn
    return combat?.started && c ? `${combat.id}:${combat.round}:${c.id}` : null;
}
function currentLedger() {
    const key = turnKey();
    if (!key) return null;
    if (LEDGER?.key !== key) LEDGER = { key, log: [], adjActions: 0, adjAttacks: 0, credit: { from: null, strikes: 0, moves: 0, checks: 0 } };
    return LEDGER;
}
/** The ledger, if this creature is the one whose turn it is. */
function ledgerFor(actor, token) {
    const c = game.combat?.combatant;
    if (!game.combat?.started || !c) return null;
    const doc = token?.document ?? token ?? null;
    const mine = doc?.id ? doc.id === c.tokenId : c.actor === actor;
    return mine ? currentLedger() : null;
}
function ledgerTotals(L) {
    const sum = (k) => L.log.reduce((t, e) => t + (e[k] ?? 0), 0);
    return {
        spent: Math.max(0, sum("cost") + L.adjActions),
        attacks: Math.max(0, sum("attack") + L.adjAttacks),
        flourish: L.log.some((e) => e.flourish),
        // Its last action was a Strike that hit: Knockdown, Grab and the like can follow now
        lastHit: L.log.at(-1)?.kind === "strike" && L.log.at(-1).hit ? { target: L.log.at(-1).target, riders: L.log.at(-1).riders ?? null } : null,
    };
}
function moveCost(feet, speed) {
    if (feet <= 0) return 0;
    if (feet <= 5) return 1; // a Step, or a short Stride
    return Math.max(1, Math.ceil(feet / Math.max(5, speed || 0)));
}
function moveText(e) {
    return `Moved ${e.feet} ft${e.credited ? ` (part of ${e.from})` : e.cost > 1 ? ` (${e.cost} moves)` : ""}`;
}
const SPEED_FOR_ACTION = { fly: "fly", swim: "swim", climb: "climb", burrow: "burrow" };
// Moves this close together are one move (arrow keys, a drag let go and picked up again); further apart, a new action
const MOVE_MERGE_MS = 4000;
/** The ledger is the GM's; a player's client keeps one too for their own character's turn (the Turn Helper shows it). */
function ledgerMine() {
    if (game.user.isGM) return true;
    const a = game.combat?.combatant?.actor;
    return !!a?.isOwner && a.hasPlayerOwner;
}
function onMoved(doc, movement) {
    if (!ledgerMine()) return;
    const c = game.combat?.combatant;
    if (!game.combat?.started || !c || c.tokenId !== doc.id) return;
    const L = currentLedger();
    if (!L) return;
    const feet = Math.round(Number(movement?.passed?.cost ?? movement?.passed?.distance) || 0);
    if (!feet) return;
    const sp = speedsOf(doc.actor);
    const mode = movement?.passed?.waypoints?.at?.(-1)?.action ?? doc.movementAction;
    const speed = sp[SPEED_FOR_ACTION[mode] ?? "land"] || sp.land || Math.max(0, ...Object.values(sp).map(Number).filter(Number.isFinite));
    // A terrain check rolled on the way (Balance on ice) sits after the move it belongs to: look past it
    const last = L.log.findLast((e) => !e.terrain);
    if (movement?.method === "undo") {
        if (last?.kind !== "move") return;
        last.feet -= feet;
        if (last.feet <= 0) L.log.splice(L.log.lastIndexOf(last)); // and the terrain checks rolled on it
        else { if (!last.credited) last.cost = moveCost(last.feet, speed); last.text = moveText(last); }
    } else if (last?.kind === "move" && (Date.now() - (last.at ?? 0) < MOVE_MERGE_MS
        // Foundry 14 carries a token up or down a Change Level region (stairs, a ladder) once its dialog is answered:
        // that's the rest of the move that reached the stairs, however long the GM took to answer
        || (movement?.method === "api" && movement?.origin?.level && movement?.destination?.level && movement.origin.level !== movement.destination.level))) {
        // A drag in pieces or arrow-key steps: one move, priced as the Strides it adds up to
        last.feet += feet;
        last.at = Date.now();
        if (!last.credited) last.cost = moveCost(last.feet, speed);
        last.text = moveText(last);
    } else {
        const credited = L.credit.moves > 0;
        if (!credited) clearCredit(L);
        const e = { kind: "move", feet, cost: credited ? 0 : moveCost(feet, speed), credited, from: L.credit.from, at: Date.now() };
        if (credited) L.credit.moves = 0;
        e.text = moveText(e);
        L.log.push(e);
    }
    refreshSoon(200);
}
function onChatForTurn(message) {
    if (!ledgerMine()) return;
    const combat = game.combat;
    const c = combat?.combatant;
    if (!combat?.started || !c) return;
    const sp = message.speaker ?? {};
    if (!(sp.token ? sp.token === c.tokenId : !!sp.actor && sp.actor === c.actorId)) return;
    const pf = message.flags?.pf2e ?? {};
    const ctx = pf.context ?? null;
    if (ctx?.isReroll) return;
    const L = currentLedger();
    if (!L) return;
    const opts = ctx?.options ?? [];
    const item = message.item ?? null;
    const name = item?.name ?? "";
    const part = (k) => { if (L.credit[k] > 0) { L.credit[k] -= 1; return ` (part of ${L.credit.from})`; } return null; };
    // "This attempt neither applies nor counts toward the multiple attack penalty" (Knockdown, Grab...)
    const counts = (inAbility) => !(inAbility && L.credit.noMap);
    if (ctx?.type === "attack-roll") {
        const inAbility = part("strikes");
        // Whether it hit, and whom: a follow-up like Knockdown can come straight after a hit
        const hit = ["success", "criticalSuccess"].includes(ctx.outcome);
        const target = String(ctx.target?.token ?? "").split(".").pop() || null;
        // The riders on the Strike that hit (Knockdown, Grab...), so only a follow-up it lists is offered
        const riders = item?.system?.attackEffects?.value ?? null;
        if (!inAbility) clearCredit(L);
        L.log.push({ kind: "strike", text: `Strike${name ? `: ${name}` : ""}${inAbility ?? ""}`, cost: inAbility ? 0 : 1, attack: counts(inAbility) ? 1 : 0, hit, target, riders });
    } else if (ctx?.type === "spell-attack-roll") {
        L.log.push({ kind: "attack", text: `Spell attack${name ? `: ${name}` : ""}`, cost: 0, attack: 1 });
        clearCredit(L);
    } else if (ctx && ["skill-check", "perception-check", "check"].includes(ctx.type)) {
        // Only checks made as an action (Trip, Demoralize, Seek...): PF2e tags them action:<slug>
        const slug = opts.map((o) => /^action:([a-z-]+)$/.exec(o)?.[1]).find(Boolean);
        if (!slug) {
            // A plain Athletics roll right after an ability that includes a check (Knockdown's Trip rolled by hand):
            // that's its check, so it uses up the ability's credit instead of leaving it for a later Shove
            if (L.credit.checks > 0 && ctx.type === "skill-check") {
                const inAbility = part("checks");
                L.log.push({ kind: "check", text: `${cap(opts.map((o) => /^skill:([a-z-]+)$/.exec(o)?.[1]).find(Boolean) ?? "check")}${inAbility}`, cost: 0, attack: counts(true) && !L.credit.noMap ? 1 : 0 });
                refreshSoon(150);
            }
            return;
        }
        const attack = MANEUVER_SLUGS.has(slug) || opts.includes("self:action:trait:attack") || (ctx.traits ?? []).includes("attack");
        // PF2e Terrains rolls Balance or Climb as a token crosses uneven ground or an incline: part of that move,
        // which already counts by its distance, not an action of its own
        const lastMove = L.log.findLast((e) => !e.terrain);
        if (TERRAIN_CHECKS.has(slug) && lastMove?.kind === "move" && Date.now() - (lastMove.at ?? 0) < 6000) {
            L.log.push({ kind: "check", text: `${cap(slug)} (part of the move)`, cost: 0, attack: 0, terrain: true });
            refreshSoon(150);
            return;
        }
        const inAbility = part("checks");
        // Moves rolled as a check (Tumble Through, Climb, Sneak...): the check is the action, and the token's
        // movement that goes with it, just before or just after, is part of it
        let cost = inAbility ? 0 : (MOVE_CHECK_COST[slug] ?? 1);
        if (!inAbility) clearCredit(L);
        if (!inAbility && MOVE_CHECK_COST[slug]) {
            const last = L.log.at(-1);
            if (last?.kind === "move" && !last.credited && Date.now() - (last.at ?? 0) < 15000) {
                last.credited = true; last.cost = 0; last.from = cap(slug.replace(/-/g, " ")); last.text = moveText(last);
            } else L.credit = { from: cap(slug.replace(/-/g, " ")), strikes: 0, moves: 1, checks: 0 };
        }
        L.log.push({ kind: "check", text: `${cap(slug.replace(/-/g, " "))}${inAbility ?? ""}`, cost, attack: attack && counts(inAbility) ? 1 : 0 });
    } else if (!ctx && item && ["action", "feat"].includes(item.type) && pf.origin) {
        // An ability posted to chat: its cost, and the Strikes, move and check it includes, so those don't count twice
        if (item.system?.actionType?.value !== "action") return;
        const cost = Number(item.system?.actions?.value) || 1;
        const traits = item.system?.traits?.value ?? [];
        if (L.log.some((x) => x.kind === "ability" && x.itemId === item.id)) {
            const once = traits.includes("flourish") || (!!item.system?.frequency?.max && ["turn", "round"].includes(item.system.frequency.per)) || !!readRecharge(readDescription(item.system?.description?.value ?? "", { localize: (k) => game.i18n.localize(k) }).text);
            if (once) { refreshSoon(150); return; } // its card posted again (to show the players, or a double click)
        }
        let prof = null;
        try { prof = profileItem(item, item.actor?.name ?? ""); } catch { /* unreadable ability: count its cost only */ }
        const checks = prof && (prof.skillCheck || prof.control.some((x) => MANEUVER_SLUGS.has(x))) ? 1 : 0;
        const noMap = /\b(?:neither applies nor counts|doesn'?t (?:apply or )?count|does not (?:apply or )?count)\b[^.]{0,40}\bmultiple attack penalty\b/i.test(prof?.text ?? "");
        L.credit = { from: item.name, strikes: prof?.strikes ? (prof.strikes.count ?? 1) : 0, moves: prof?.moves?.length ? 1 : 0, checks, noMap };
        L.log.push({ kind: "ability", itemId: item.id, text: item.name, cost, attack: traits.includes("attack") && !prof?.strikes && !checks ? 1 : 0, flourish: traits.includes("flourish") });
    } else if (!ctx && pf.origin?.type === "consumable") {
        // Drinking a potion, using an elixir or a talisman: Activate, one action (a scroll or wand casts its spell, and
        // that card is counted). Drawing it first is an Interact: add it with + if it wasn't in hand.
        const what = item?.name ?? /\bUses?\s+(.+)$/i.exec(String(message.flavor ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())?.[1] ?? "an item";
        if (["scroll", "wand"].includes(item?.category) || /\b(scroll|wand)\b/i.test(what)) return;
        clearCredit(L);
        // Drawing it first is an Interact: two actions unless it was already in hand (the last one of a stack is
        // gone by now, so it counts as drawn; - takes the action back)
        const held = item?.system?.equipped?.carryType === "held";
        L.log.push({ kind: "item", text: `${held ? "Used" : "Drew and used"} ${what}`, cost: held ? 1 : 2, attack: 0 });
    } else if (!ctx && !item && /<strong>\s*Sustain\s*<\/strong>/i.test(message.flavor ?? "")) {
        // PF2e's Sustain action card (or the card's Sustain button): one action
        clearCredit(L);
        L.log.push({ kind: "sustain", text: "Sustain", cost: 1, attack: 0 });
    } else if (!ctx && !item && /<h4 class="action">/.test(message.flavor ?? "")) {
        // PF2e's simple action cards (Stand, Take Cover, Raise a Shield, Interact, Step, Stride...): the glyph says
        // the cost; reactions and free actions don't count
        const m = /<h4 class="action">\s*<strong>([^<]+)<\/strong>\s*<span class="action-glyph[^"]*">\s*([123])\s*<\/span>/i.exec(message.flavor ?? "");
        if (!m) return;
        clearCredit(L);
        L.log.push({ kind: "action", text: m[1].trim(), cost: Number(m[2]), attack: 0 });
    } else if ((!ctx || ctx.type === "spell-cast") && item?.type === "spell" && pf.origin) {
        const cost = Number(/^[123]/.exec(String(item.system?.time?.value ?? ""))?.[0] ?? 0);
        if (!cost) return; // reactions and free actions
        clearCredit(L);
        L.log.push({ kind: "spell", text: `Cast ${item.name}`, cost, attack: 0 });
    } else return;
    refreshSoon(150);
}
function adjustLedger(kind, delta) {
    const L = currentLedger();
    if (!L) return;
    if (kind === "reset") { L.log = []; L.adjActions = 0; L.adjAttacks = 0; clearCredit(L); return; }
    const t = ledgerTotals(L);
    if (kind === "act") L.adjActions += delta < 0 && t.spent <= 0 ? 0 : delta;
    if (kind === "atk") L.adjAttacks += delta < 0 && t.attacks <= 0 ? 0 : delta;
}
function turnHtml(L, board) {
    const t = ledgerTotals(L);
    const cv = board?.me?.conditionValues ?? {};
    const quick = board?.me?.conditions?.has?.("quickened") && !cv.stunned ? 1 : 0;
    const base = Math.max(0, Math.min(3, 3 - (cv.stunned ? cv.stunned : cv.slowed ?? 0))) + quick;
    const left = Math.max(0, base - t.spent);
    const pips = Array.from({ length: Math.max(base, t.spent) }, (_, i) => `<span class="npt-pip${i < t.spent ? " npt-used" : ""}"></span>`).join("");
    const btn = (k, d, label, title, cls = "") => `<button type="button"${cls ? ` class="${cls}"` : ""} data-npt-adj="${k}:${d}" data-tooltip="${title}">${label}</button>`;
    const map = t.attacks ? `<span class="npt-map">next ${t.attacks >= 2 ? "−10 (agile −8)" : "−5 (agile −4)"}</span>` : "";
    const log = L.log.length ? `<div class="npt-log">So far: ${L.log.map((e) => `${esc(e.text)}${e.cost ? ` ${costGlyph(Math.min(3, e.cost))}` : ""}`).join(" · ")}</div>` : "";
    return `<div class="npt-turn"><div class="npt-turn-row">
        <span class="npt-step"><span class="npt-k">Actions</span>${btn("act", -1, "−", "One action fewer used")}<span class="npt-pips">${pips}</span>${btn("act", 1, "+", "One more action used")}<span class="npt-left">${left} left</span></span>
        <span class="npt-step"><span class="npt-k">Attacks</span>${btn("atk", -1, "−", "One attack fewer made")}<span class="npt-val">${t.attacks}</span>${btn("atk", 1, "+", "One more attack made")}${map}</span>
        ${btn("reset", 0, '<i class="fa-solid fa-rotate-left"></i>', "Start the turn's count again", "npt-reset")}</div>${log}</div>`;
}

// --- Recharge: an ability that "can't be used again for 1d4 rounds" was just used ------------------
async function onAbilityUsed(message) {
    if (game.users.activeGM?.id !== game.user.id) return;
    const combat = game.combat;
    if (!combat?.started) return;
    const originUuid = message.flags?.pf2e?.origin?.uuid;
    if (!originUuid || message.flags?.pf2e?.context || message.flags?.pf2e?.appliedDamage) return;
    const item = await fromUuid(originUuid).catch(() => null);
    const actor = item?.actor;
    if (!item || !["action", "feat"].includes(item.type) || !actor || actor.hasPlayerOwner) return;
    // Already rolled for this use (the card posted again, or a second GM client)
    const wait = flagOf(actor, "recharge")?.[item.id];
    if (wait?.combatId === combat.id && wait.setRound === combat.round && wait.setTurn === combat.turn) return;
    // Read it the way the profile does: Monster Core writes "again for [[/gmr 1d4 #Recharge X]]{1d4 rounds}"
    const formula = readRecharge(readDescription(item.system?.description?.value ?? "", { localize: (k) => game.i18n.localize(k) }).text);
    if (!formula) return;
    // PF2e Workbench already rolls it and puts a "Used ..." effect on the creature: one roll, one timer
    if (workbenchRecharge() && /^\s*1d\d+\s*$/.test(formula)) { refreshSoon(400); return; }
    try {
        const roll = await new Roll(formula).evaluate({ allowInteractive: false });
        await actor.setFlag(FLAG_SCOPE, "recharge", { [item.id]: { combatId: combat.id, readyRound: combat.round + roll.total, setRound: combat.round, setTurn: combat.turn } });
        await ChatMessage.create({
            content: `<p><strong>${esc(item.name)}</strong> recharges in ${roll.total} round${roll.total === 1 ? "" : "s"} (round ${combat.round + roll.total}).</p>`,
            whisper: game.users.filter((u) => u.isGM).map((u) => u.id),
            speaker: { alias: "NPC Turn" },
            rolls: [roll],
        });
    } catch (err) {
        console.warn(`${MODULE_ID} | Recharge roll failed for ${item.name}`, err);
    }
}

// --- Threat ------------------------------------------------------------------------------------
// Each creature in the fight keeps a table of who has hurt it, healed its foes or attacked it. Stored on the
// combat (flag "threat": { round, t: { npcTokenId: { tokenId: value } } }), written by the active GM only, halved
// for every round that passes. Damage counts its amount, healing a foe half the HP healed, a miss 2, a maneuver 1 to 3.
const threatOn = () => setting("threat", true) !== false;
const threatDecay = () => { const v = Number(setting("threatDecay", "0.5")); return v > 0 && v <= 1 ? v : 0.5; };
const threatScale = () => Number(setting("threatWeight", "1")) || 1;
const dropCut = () => Math.min(100, Math.max(0, Number(setting("threatDrop", 50)) || 0)) / 100;
/** About what one hit does at a level (GM Core's moderate Strike damage), so fixed amounts stay in proportion from level -1 to 25. */
const hitWorth = (level) => Math.max(4, 6 + 1.6 * (Number(level) || 0));
const threatQueue = new Map();
/** Who last hurt or hit each creature (token id -> { src, at }), to credit persistent damage it then takes. */
const LAST_HIT = new Map();
let threatTimer = null;
let threatChain = Promise.resolve();

function threatFor(combat, tokenId) {
    if (!threatOn()) return {};
    const f = flagOf(combat, "threat");
    const row = f?.t?.[tokenId];
    if (!row || typeof row !== "object") return {};
    const k = Math.pow(threatDecay(), Math.max(0, (combat.round ?? 0) - (f.round ?? 0)));
    return Object.fromEntries(Object.entries(row).map(([id, v]) => [id, (Number(v) || 0) * k]));
}

function addThreat(combat, npcTokenId, srcTokenId, amount) {
    if (!combat || !npcTokenId || !srcTokenId || npcTokenId === srcTokenId || !amount) return; // negative takes it back (a reverted damage card)
    const q = threatQueue.get(combat.id) ?? new Map();
    threatQueue.set(combat.id, q);
    // Keyed by round too, so an event saved after the round moves on still decays
    const key = `${npcTokenId}|${srcTokenId}|${combat.round ?? 0}`;
    q.set(key, (q.get(key) ?? 0) + amount);
    clearTimeout(threatTimer);
    threatTimer = setTimeout(() => flushThreat(), 400);
}

/**
 * Change the table: read it (decayed to this round), let fn change it, save it. One change at a time, each
 * reading what the last one wrote. Every key is kept (a flag update merges, so a dropped key would keep its old value).
 */
function mutateThreat(combat, fn) {
    threatChain = threatChain.then(async () => {
        if (!game.combats?.get(combat.id)) return;
        const f = flagOf(combat, "threat") ?? {};
        const round = combat.round ?? 0;
        const k = Math.pow(threatDecay(), Math.max(0, round - (f.round ?? 0)));
        const t = {};
        for (const [npc, row] of Object.entries(f.t ?? {})) {
            for (const [src, v] of Object.entries(row ?? {})) (t[npc] ??= {})[src] = Math.round((Number(v) || 0) * k * 10) / 10;
        }
        fn(t, round);
        // A round set back (the GM undoing a round) keeps the later round, so going forward again doesn't fade it twice
        await combat.setFlag(MODULE_ID, "threat", { round: Math.max(round, f.round ?? 0), t });
    }).catch((err) => console.warn(`${MODULE_ID} | couldn't save the threat table`, err));
    return threatChain;
}

async function flushThreat() {
    for (const [cid, q] of [...threatQueue]) {
        threatQueue.delete(cid);
        const combat = game.combats?.get(cid);
        if (!combat) continue;
        await mutateThreat(combat, (t, round) => {
            for (const [key, v] of q) {
                const [npc, src, at] = key.split("|");
                // Queued in an earlier round (the round moved on before it was saved): faded like everything else
                const add = v * Math.pow(threatDecay(), Math.max(0, round - (Number(at) || 0)));
                (t[npc] ??= {})[src] = Math.max(0, Math.round(((t[npc][src] ?? 0) + add) * 10) / 10);
            }
        });
    }
}

/** The GM sets a creature's table by hand (a taunt, a grudge), or clears it. */
const setThreatRow = (combat, npcTokenId, values) => mutateThreat(combat, (t) => { t[npcTokenId] = { ...(t[npcTokenId] ?? {}), ...values }; });

async function editThreat(tokenId) {
    const combat = game.combat;
    const token = canvas?.tokens?.get?.(tokenId);
    if (!combat || !token?.actor) return;
    const me = token.actor;
    const row = threatFor(combat, tokenId);
    const foes = combat.combatants.filter((c) => c.tokenId && c.tokenId !== tokenId && c.actor && (me.isEnemyOf?.(c.actor) ?? false));
    if (!foes.length) return ui.notifications.info(`No one in this fight is hostile to ${token.name}.`);
    const rows = foes.map((c) => `<div class="form-group"><label>${esc(c.token?.name ?? c.name)}</label><input type="number" name="${esc(c.tokenId)}" value="${Math.round(row[c.tokenId] ?? 0)}" min="0" step="1"></div>`).join("");
    const result = await foundry.applications.api.DialogV2.wait({
        window: { title: `Threat: ${token.name}`, icon: "fa-solid fa-scale-unbalanced" },
        position: { width: 360 },
        content: `<p style="margin-top:0">Who ${esc(token.name)} is most set on. Raise someone to have it go for them (a taunt, a grudge), or set them to 0 to have it forget them. It fades each round as usual.</p>${rows}`,
        buttons: [
            { action: "save", label: "Save", icon: "fa-solid fa-floppy-disk", default: true,
                callback: (event, button) => Object.fromEntries(foes.map((c) => [c.tokenId, Math.max(0, Number(button.form.elements[c.tokenId]?.value) || 0)])) },
            { action: "reset", label: "Reset", icon: "fa-solid fa-rotate-left", callback: () => Object.fromEntries(foes.map((c) => [c.tokenId, 0])) },
            { action: "cancel", label: "Cancel", icon: "fa-solid fa-xmark" },
        ],
        rejectClose: false,
    });
    if (!result || typeof result !== "object") return;
    await setThreatRow(combat, tokenId, result);
}

/** A creature starts burning or bleeding: note on the condition who did it, so its persistent damage is credited. */
function onPersistent(item) {
    if (item?.type !== "condition" || item.slug !== "persistent-damage" || !threatOn()) return;
    const combat = game.combat;
    if (!combat?.started || !game.users?.activeGM?.isSelf) return;
    const actor = item.parent;
    const c = combat.combatants.find((x) => x.actor === actor || (actor && x.actor?.uuid === actor.uuid));
    const last = c?.tokenId ? LAST_HIT.get(c.tokenId) : null;
    if (last && Date.now() - last.at < 15000) {
        PERSIST_SRC.set(item.uuid, last.src);
        if (PERSIST_SRC.size > 500) PERSIST_SRC.delete(PERSIST_SRC.keys().next().value);
        item.setFlag(MODULE_ID, "source", last.src).catch(() => {});
    }
}
const PERSIST_SRC = new Map(); // persistent-damage condition uuid -> token id of whoever set it

/** Someone falls unconscious: every creature's threat on them drops (setting, 50% by default). */
async function onDropped(item) {
    if (item?.type !== "condition" || item.slug !== "unconscious" || !threatOn()) return;
    const combat = game.combat;
    if (!combat?.started || !game.users?.activeGM?.isSelf) return;
    const actor = item.parent;
    const c = combat.combatants.find((x) => x.actor === actor || (actor && x.actor?.uuid === actor.uuid));
    const cut = dropCut();
    if (!c?.tokenId || cut <= 0) return;
    // Threat still waiting to be saved goes in first, so the cut applies to it too
    clearTimeout(threatTimer);
    await flushThreat();
    await mutateThreat(combat, (t) => {
        for (const row of Object.values(t)) if (row[c.tokenId]) row[c.tokenId] = Math.round(row[c.tokenId] * (1 - cut) * 10) / 10;
    });
}

/** What an item leaves on whoever it hits, by degree of success (read once per item). */
const EFFECTS = new Map();
function effectsOf(item) {
    if (!item) return null;
    const key = item.uuid ?? item.id ?? item.name;
    if (!EFFECTS.has(key)) {
        let e = null;
        try { e = spellEffects(item); } catch { e = null; }
        EFFECTS.set(key, e);
    }
    return EFFECTS.get(key);
}

/**
 * Threat for a save a creature rolled against someone's spell or ability: what the result left on it (slowed counts
 * about a hit, paralyzed two, frightened under half), or a little for being targeted when it left nothing.
 * Damage from the same spell is counted when it's applied.
 */
function saveThreat(npc, item, outcome) {
    const hit = hitWorth(npc?.level ?? 0);
    const eff = effectsOf(item);
    const failed = outcome === "failure" || outcome === "criticalFailure";
    let list = null;
    if (eff?.byDegree) list = outcome === "criticalFailure" ? eff.byDegree.criticalFailure ?? eff.byDegree.failure : eff.byDegree[outcome] ?? null;
    else if (failed) list = eff?.inflicts ?? null;
    const worth = (list ?? []).reduce((sum, c) => sum + (CONDITION_VALUE[c] ?? 1), 0);
    // A success usually means a shorter or lighter version (slowed for a round, not a minute): half
    return worth > 0 ? (worth / 5) * hit * (outcome === "success" ? 0.5 : 1) : 0.15 * hit;
}

const MANEUVER_OPTIONS = /^action:(trip|grapple|shove|disarm|reposition|demoralize|feint|bon-mot|dirty-trick|create-a-diversion)$/;

/** Read a chat message for threat: damage applied, healing on a foe, an attack or maneuver aimed at a creature. */
function onThreatMessage(message, sign = 1) {
    const combat = game.combat;
    if (!threatOn() || !combat?.started || !game.users?.activeGM?.isSelf) return;
    const f = message.flags?.pf2e ?? {};
    const tokenOf = (actor) => (actor ? combat.combatants.find((c) => c.actor === actor || c.actor?.uuid === actor.uuid)?.tokenId ?? null : null);
    const applied = f.appliedDamage;
    if (applied) {
        // sign -1: the card was just reverted (PF2e's undo on the damage card), so the threat it added is taken back
        if (applied.isReverted && sign > 0) return;
        const target = message.actor;
        const o = f.origin?.actor ? fromUuidSync(f.origin.actor) : null;
        const src = o?.documentName === "Actor" ? o : o?.actor ?? null;
        const srcTok = tokenOf(src);
        const amt = sign * (applied.updates ?? []).filter((u) => u.path === "system.attributes.hp.value" || u.path === "system.attributes.hp.temp")
            .reduce((x, u) => x + Math.abs(Number(u.value) || 0), 0);
        if (!target || !src || !amt) return;
        // Persistent damage names the burning creature as its own source: credit whoever set it going
        if (!applied.isHealing && (src === target || o?.uuid === target.uuid)) {
            const cond = f.origin?.uuid ? fromUuidSync(f.origin.uuid) : null;
            // From the condition's flag, or from memory when the condition is already gone (recovered before the damage was applied)
            const by = flagOf(cond, "source") ?? PERSIST_SRC.get(f.origin?.uuid);
            const tTok0 = message.token?.id ?? message.speaker?.token ?? tokenOf(target);
            if (by && tTok0 && !target.hasPlayerOwner) addThreat(combat, tTok0, by, amt);
            return;
        }
        if (!srcTok) return;
        if (applied.isHealing) {
            // Healing someone on the other side: every creature in the fight that's hostile to the healer notices
            for (const c of combat.combatants) {
                if (c.tokenId !== srcTok && c.actor && !c.actor.hasPlayerOwner && (c.actor.isEnemyOf?.(src) ?? false)) addThreat(combat, c.tokenId, srcTok, amt / 2);
            }
            return;
        }
        const tTok = message.token?.id ?? message.speaker?.token ?? tokenOf(target);
        if (tTok && sign > 0) LAST_HIT.set(tTok, { src: srcTok, at: Date.now() });
        if (!target.hasPlayerOwner && target.isEnemyOf?.(src) && combat.combatants.some((c) => c.tokenId === tTok)) {
            addThreat(combat, tTok, srcTok, amt);
            // Its allies watching notice who is hurting their side: a share by their wits (animals only care about themselves)
            for (const c of combat.combatants) {
                if (!c.tokenId || c.tokenId === tTok || !c.actor || c.actor.hasPlayerOwner || c.isDefeated || !(c.actor.isEnemyOf?.(src) ?? false) || !(c.actor.isAllyOf?.(target) ?? true)) continue;
                const frac = NOTICE[actorTier(c.actor)] ?? 0;
                if (frac > 0 && (c.actor.hitPoints?.value ?? 1) > 0) addThreat(combat, c.tokenId, srcTok, amt * frac);
            }
        }
        return;
    }
    const ctx = f.context;
    if (ctx?.type === "saving-throw") return onSaveThreat(combat, message, ctx, tokenOf);
    if ((!ctx || ctx.type === "spell-cast") && f.origin?.type === "spell") return onSpellCast(combat, message, tokenOf);
    if (!ctx?.target?.token || !["attack-roll", "spell-attack-roll", "skill-check"].includes(ctx.type)) return;
    const tdoc = fromUuidSync(ctx.target.token);
    const npc = tdoc?.actor;
    const src = message.actor;
    const srcTok = message.token?.id ?? message.speaker?.token ?? tokenOf(src);
    if (!npc || !src || !srcTok || npc.hasPlayerOwner || !(npc.isEnemyOf?.(src) ?? false) || !combat.combatants.some((c) => c.tokenId === tdoc.id)) return;
    const hit = ["success", "criticalSuccess"].includes(ctx.outcome);
    if (hit) LAST_HIT.set(tdoc.id, { src: srcTok, at: Date.now() });
    // A hit's damage is counted when it's applied; a miss still marks who swung
    if (ctx.type !== "skill-check") { if (!hit) addThreat(combat, tdoc.id, srcTok, 2); return; }
    if ((ctx.options ?? []).some((o) => MANEUVER_OPTIONS.test(o))) addThreat(combat, tdoc.id, srcTok, hit ? 3 : 1);
}

/** A creature rolled a save against someone's spell or ability (from the spell's card): the caster gains threat. */
function onSaveThreat(combat, message, ctx, tokenOf) {
    if (ctx.isReroll) return;
    const npc = message.actor;
    const npcTok = message.token?.id ?? message.speaker?.token ?? tokenOf(npc);
    const o = ctx.origin?.actor ? fromUuidSync(ctx.origin.actor) : null;
    const src = o?.documentName === "Actor" ? o : o?.actor ?? null;
    const srcTok = (ctx.origin?.token ? fromUuidSync(ctx.origin.token)?.id : null) ?? tokenOf(src);
    if (!npc || !src || !srcTok || npc.hasPlayerOwner || !(npc.isEnemyOf?.(src) ?? false) || !combat.combatants.some((c) => c.tokenId === npcTok)) return;
    const originUuid = message.flags?.pf2e?.origin?.uuid;
    const item = message.item ?? (originUuid ? fromUuidSync(originUuid) : null);
    LAST_HIT.set(npcTok, { src: srcTok, at: Date.now() });
    const once = saveKey(combat, item, npcTok, srcTok);
    if (SAVE_SEEN.has(once)) return;
    SAVE_SEEN.add(once);
    addThreat(combat, npcTok, srcTok, saveThreat(npc, item, ctx.outcome));
}

/**
 * Any spell cast in the fight: every foe of the caster notices (a cantrip a little, a slot spell more). What it does to
 * the ones it hits (damage, a failed save) counts on top. Healing spells spread their own threat from the HP healed.
 */
function onSpellCast(combat, message, tokenOf) {
    const caster = message.actor;
    const item = message.item;
    if (!caster || item?.type !== "spell") return;
    const sys = item.system ?? {};
    const traits = sys.traits?.value ?? [];
    if (traits.includes("healing")) return;
    const srcTok = message.token?.id ?? message.speaker?.token ?? tokenOf(caster);
    if (!srcTok) return;
    for (const c of combat.combatants) {
        if (c.tokenId === srcTok || !c.actor || c.actor.hasPlayerOwner || !(c.actor.isEnemyOf?.(caster) ?? false)) continue;
        addThreat(combat, c.tokenId, srcTok, (item.isCantrip ? 0.2 : 0.4) * hitWorth(c.actor.level ?? 0));
    }
}

// --- What the NPCs learn: every attack on a foe shows a bit of their AC, every save they roll against one of them a bit of that save
const learnQueue = new Map();
const LEARN_SEEN = new Set();
let learnTimer = null;
let learnChain = Promise.resolve();
function learn(combat, tokenId, what, once, bounds = null, flag = "learned") {
    if (!combat || !tokenId || !what || LEARN_SEEN.has(`${flag}|${once}`)) return;
    LEARN_SEEN.add(`${flag}|${once}`);
    if (LEARN_SEEN.size > 2000) LEARN_SEEN.delete(LEARN_SEEN.values().next().value);
    const q = learnQueue.get(`${combat.id}|${flag}`) ?? new Map();
    learnQueue.set(`${combat.id}|${flag}`, q);
    const k = `${tokenId}|${what}`;
    const cur = q.get(k) ?? { n: 0, lo: -Infinity, hi: Infinity };
    cur.n += 1;
    if (bounds) { cur.lo = Math.max(cur.lo, bounds.lo ?? -Infinity); cur.hi = Math.min(cur.hi, bounds.hi ?? Infinity); }
    q.set(k, cur);
    clearTimeout(learnTimer);
    learnTimer = setTimeout(() => flushLearned(), 500);
}
function flushLearned() {
    learnChain = learnChain.then(async () => {
        for (const [qid, q] of [...learnQueue]) {
            learnQueue.delete(qid);
            const [cid, flag] = qid.split("|");
            const combat = game.combats?.get(cid);
            if (!combat) continue;
            const cur = foundry.utils.deepClone(flagOf(combat, flag) ?? {});
            for (const [key, v] of q) {
                const [tok, what] = key.split("|");
                const old = cur[tok]?.[what];
                const prev = old && typeof old === "object" ? old : { n: Number(old) || 0 };
                const next = { n: Math.min(9, (prev.n || 0) + v.n) };
                // Bounds only make sense while they agree; a contradiction (a buff, Take Cover) starts them over
                const lo = Math.max(prev.lo ?? -Infinity, v.lo), hi = Math.min(prev.hi ?? Infinity, v.hi);
                if (Number.isFinite(lo) || Number.isFinite(hi)) {
                    if (lo <= hi) { if (Number.isFinite(lo)) next.lo = lo; if (Number.isFinite(hi)) next.hi = hi; }
                    else { if (Number.isFinite(v.lo)) next.lo = v.lo; if (Number.isFinite(v.hi)) next.hi = v.hi; }
                }
                (cur[tok] ??= {})[what] = next;
            }
            await combat.setFlag(MODULE_ID, flag, cur);
        }
    }).catch((err) => console.warn(`${MODULE_ID} | couldn't note what the NPCs saw`, err));
    return learnChain;
}
const SAVE_STATS = ["fortitude", "reflex", "will"];
function onLearnMessage(message) {
    const combat = game.combat;
    if (!combat?.started || !game.users?.activeGM?.isSelf) return;
    const ctx = message.flags?.pf2e?.context;
    if (!ctx || ctx.isReroll) return;
    const tokenOf = (actor) => (actor ? combat.combatants.find((c) => c.actor === actor || c.actor?.uuid === actor.uuid)?.tokenId ?? null : null);
    if (["attack-roll", "spell-attack-roll"].includes(ctx.type) && ctx.target?.token) {
        const npc = message.actor;
        const tdoc = fromUuidSync(ctx.target.token);
        const foe = tdoc?.actor;
        if (!npc || !foe || !(npc.isEnemyOf?.(foe) ?? false) || !combat.combatants.some((c) => c.tokenId === tdoc.id)) return;
        // What the roll showed: a hit means AC is at most the total, a miss that it's more; a crit or a critical
        // miss narrows it by ten more (a natural 20 or 1 shifts the degree, so it says less)
        const roll = message.rolls?.[0];
        const total = Number(roll?.total);
        const nat = roll?.dice?.find((d) => d.faces === 20)?.results?.find((r) => r.active && !r.discarded)?.result ?? null;
        let bounds = null;
        if (Number.isFinite(total) && ctx.outcome) {
            if (ctx.outcome === "criticalSuccess") bounds = { hi: nat === 20 ? total : total - 10 };
            else if (ctx.outcome === "success") bounds = { hi: total, lo: nat === 20 ? -Infinity : total - 9 };
            else if (ctx.outcome === "failure") bounds = { lo: total + 1, hi: nat === 1 ? Infinity : total + 10 };
            else if (ctx.outcome === "criticalFailure") bounds = { lo: nat === 1 ? total + 1 : total + 11 };
        }
        // A player's attack on an NPC: what the party has learned of that NPC's AC (the Turn Helper shows it)
        if (npc.hasPlayerOwner) { if (!foe.hasPlayerOwner) learn(combat, tdoc.id, "ac", message.id, bounds, "party"); return; }
        const npcTok = message.token?.id ?? message.speaker?.token ?? tokenOf(npc);
        if (npcTok) LAST_TARGET.set(npcTok, { combatId: combat.id, id: tdoc.id, round: combat.round ?? 0 });
        learn(combat, tdoc.id, "ac", message.id, bounds);
    } else if (ctx.type === "saving-throw") {
        const foe = message.actor;
        const o = ctx.origin?.actor ? fromUuidSync(ctx.origin.actor) : null;
        const src = o?.documentName === "Actor" ? o : o?.actor ?? null;
        const stat = SAVE_STATS.find((k) => (ctx.domains ?? []).includes(k));
        const tok = message.token?.id ?? message.speaker?.token ?? tokenOf(foe);
        if (!foe || !src || !(src.isEnemyOf?.(foe) ?? false) || !stat || !tok) return;
        // An NPC's save against a player's spell: the roll shows its modifier outright (total less the die)
        if (src.hasPlayerOwner) {
            if (foe.hasPlayerOwner) return;
            const roll = message.rolls?.[0];
            const nat = roll?.dice?.find((d) => d.faces === 20)?.results?.find((r) => r.active && !r.discarded)?.result ?? null;
            const mod = Number.isFinite(Number(roll?.total)) && nat !== null ? Number(roll.total) - nat : null;
            learn(combat, tok, stat, `${message.id}|${stat}`, mod === null ? null : { lo: mod, hi: mod }, "party");
            return;
        }
        learn(combat, tok, stat, `${combat.round}|${message.flags?.pf2e?.origin?.uuid ?? ctx.origin?.actor}|${tok}|${stat}`);
    }
}
/** Saves rolled through PF2e Toolbelt's Target Helper, against an NPC's spell or ability. */
function onLearnToolbelt(message, changes) {
    const combat = game.combat;
    const th = changes?.flags?.["pf2e-toolbelt"]?.targetHelper;
    if (!th || !combat?.started || !game.users?.activeGM?.isSelf) return;
    const src = message.actor;
    if (!src || src.hasPlayerOwner) return;
    const counted = { ...(flagOf(message, "learnSaves") ?? {}) };
    let added = false;
    for (const [vid, v] of Object.entries(th.saveVariants ?? {})) {
        const stat = v?.statistic ?? message.flags?.["pf2e-toolbelt"]?.targetHelper?.saveVariants?.[vid]?.statistic;
        if (!SAVE_STATS.includes(stat)) continue;
        for (const [tokenId, part] of Object.entries(v?.saves ?? {})) {
            const foe = combat.combatants.find((c) => c.tokenId === tokenId)?.actor;
            if (!part?.success || !foe || !(src.isEnemyOf?.(foe) ?? false) || counted[`${vid}|${tokenId}`]) continue;
            counted[`${vid}|${tokenId}`] = true;
            added = true;
            learn(combat, tokenId, stat, `${combat.round}|${message.item?.uuid ?? message.id}|${tokenId}|${stat}`);
        }
    }
    if (added) message.setFlag?.(MODULE_ID, "learnSaves", counted)?.catch?.(() => {});
}

/** The card's Sustain button: PF2e's own Sustain action (its chat card), noted at once so the advice drops it. */
async function sustainNow(actor) {
    const combat = game.combat;
    const action = game.pf2e?.actions?.get?.("sustain");
    if (action?.use) await action.use({ actors: [actor] });
    else await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `<h4 class="action"><strong>Sustain</strong> <span class="action-glyph">1</span></h4>` });
    if (combat?.started) await actor.setFlag(FLAG_SCOPE, "sustained", { combatId: combat.id, round: combat.round ?? 0 });
}

/** An NPC casts a sustained spell: note it, so its later turns offer the Sustain. */
function onSustainCast(message) {
    const combat = game.combat;
    if (!combat?.started || !game.users?.activeGM?.isSelf) return;
    const ctx = message.flags?.pf2e?.context;
    if (ctx && ctx.type !== "spell-cast") return;
    const item = message.item;
    const actor = message.actor;
    if (!actor || actor.hasPlayerOwner) return;
    // PF2e's Sustain action card
    if (!item && /<strong>\s*Sustain\s*<\/strong>/i.test(message.flavor ?? "")) {
        actor.setFlag(FLAG_SCOPE, "sustained", { combatId: combat.id, round: combat.round ?? 0 }).catch(() => {});
        return;
    }
    if (item?.type !== "spell" || !item.system?.duration?.sustained || item.parent !== actor) return;
    actor.setFlag(FLAG_SCOPE, "sustain", { [item.id]: { combatId: combat.id, round: combat.round ?? 0, itemId: item.id, name: item.name, rank: message.flags?.pf2e?.origin?.castRank ?? item.rank ?? null } })
        .catch((err) => console.warn(`${MODULE_ID} | couldn't note the sustained spell`, err));
}

/** One count per save, whichever way it arrives (its own message, or PF2e Toolbelt's card). */
const SAVE_SEEN = new Set();
const saveKey = (combat, item, npcTok, srcTok) => `${combat.id}|${combat.round ?? 0}|${item?.uuid ?? item?.name ?? "?"}|${npcTok}|${srcTok}`;

/** Saves rolled through PF2e Toolbelt's Target Helper are written into the spell's card instead of a message of their own. */
function onToolbeltSaves(message, changes) {
    if (!changes?.flags?.["pf2e-toolbelt"]?.targetHelper || !threatOn()) return;
    const combat = game.combat;
    if (!combat?.started || !game.users?.activeGM?.isSelf) return;
    const src = message.actor;
    const srcTok = message.token?.id ?? message.speaker?.token ?? combat.combatants.find((c) => c.actor === src)?.tokenId ?? null;
    if (!src || !srcTok) return;
    const item = message.item;
    // Only the saves this change brought; the ones already counted are noted on the card, so a reload doesn't count them again
    const changed = changes.flags["pf2e-toolbelt"].targetHelper.saveVariants ?? {};
    const counted = { ...(flagOf(message, "threatSaves") ?? {}) };
    let added = false;
    for (const [vid, v] of Object.entries(changed)) {
        for (const [tokenId, part] of Object.entries(v?.saves ?? {})) {
            const save = message.flags?.["pf2e-toolbelt"]?.targetHelper?.saveVariants?.[vid]?.saves?.[tokenId] ?? part;
            const key = `${vid}|${tokenId}`;
            if (counted[key] || !save?.success) continue;
            counted[key] = true;
            added = true;
            const npc = combat.combatants.find((c) => c.tokenId === tokenId)?.actor;
            if (!npc || npc.hasPlayerOwner || !(npc.isEnemyOf?.(src) ?? false)) continue;
            const once = saveKey(combat, item, tokenId, srcTok);
            if (SAVE_SEEN.has(once)) continue;
            SAVE_SEEN.add(once);
            addThreat(combat, tokenId, srcTok, saveThreat(npc, item, save.success));
        }
    }
    if (added) message.setFlag?.(MODULE_ID, "threatSaves", counted)?.catch?.(() => {});
}


export { adjustLedger, currentLedger, editThreat, flushThreat, hitWorth, ledgerFor, ledgerTotals, onAbilityUsed, onChatForTurn, onDropped, onLearnMessage, onLearnToolbelt, onMoved, onPersistent, onSustainCast, onThreatMessage, onToolbeltSaves, saveThreat, setThreatRow, sustainNow, threatFor, threatOn, threatScale, turnHtml };
