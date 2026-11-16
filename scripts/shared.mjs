/**
 * PF2e Tactics: shared.mjs
 *
 * Constants and small helpers every file uses; the kit's window memory, browser storage, safe text and GM tab election
 * for the rest of the module. One module, several files: see pf2e-tactics.mjs for the whole.
 */
import { rememberWindow } from "./kit/window-memory.mjs";
import { storage } from "./kit/storage.mjs";
import { gmTabs } from "./kit/gm-tabs.mjs";
import { safe, tipAttr, labelAttr } from "./kit/safe-text.mjs";
import { pf2eRules } from "./kit/pf2e-rules.mjs";
const MODULE_ID = "pf2e-tactics";
const FLAG_SCOPE = MODULE_ID;
/** A flag of this module's on a document (getFlag throws for an inactive module's scope, so the raw flags are the fallback). */
const flagOf = (doc, key) => {
    let v;
    try { v = doc?.getFlag?.(MODULE_ID, key); } catch { v = undefined; }
    return v ?? doc?.flags?.[MODULE_ID]?.[key];
};
/** Rules numbers read from the PF2e system at run time (kit pf2e-rules): the standard DC by level. Loaded at ready; a GM is
 *  told once if the table can't be read. */
const rules = pf2eRules({ module: MODULE_ID, title: "PF2e Tactics", tables: ["dcsByLevel"] });
const POSITION_KEY = `${MODULE_ID}.window`;
const GLYPHS = { 1: "1", 2: "2", 3: "3", reaction: "r", free: "f" };

const esc = (t) => foundry.utils.escapeHTML(String(t ?? ""));
const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);
const cap = (s) => String(s ?? "").charAt(0).toUpperCase() + String(s ?? "").slice(1);
const link = (doc, label) => (doc?.uuid ? `@UUID[${doc.uuid}]{${esc(label ?? doc.name)}}` : esc(label ?? doc?.name));
const glyph = (key) => (GLYPHS[key] ? `<span class="action-glyph">${GLYPHS[key]}</span>` : "");
const costGlyph = (n) => (n >= 1 && n <= 3 ? glyph(n) : "");
const ul = (items) => (items.length ? `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>` : "");
const section = (title, inner, cls = "") => (inner ? `<section class="npt-section ${cls}"><h4>${title}</h4>${inner}</section>` : "");

/** A name as Foundry makes a slug of it: apostrophes drop ("Hunter's Aim" -> "hunters-aim"). */
const slugify = (n) => String(n ?? "").toLowerCase().replace(/['\u2019]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** An item's slug: its own, else one made from its name. */
const slugOf = (i) => i?.slug ?? i?.system?.slug ?? slugify(i?.name);
/** Token fields that change what a board reads (a redraw follows a change to any of them). */
const BOARD_FIELDS = ["x", "y", "width", "height", "hidden", "elevation", "disposition", "delta", "actorId", "level", "movementAction"];

/** The world actor behind a token, so notes are shared by every token of it. */
const baseActorOf = (actor) => (actor?.isToken ? game.actors.get(actor.id) ?? actor : actor);

function setting(key, fallback) {
    try { return game.settings.get(MODULE_ID, key); } catch { return fallback; }
}

/** Does PF2e hide NPC names that a token's nameplate doesn't show (its "Tokens Determine NPC Name Visibility" setting)? */
function tokensSetNames() {
    try { return !!game.settings.get("pf2e", "metagame_tokenSetsNameVisibility"); } catch { return false; }
}
/** Can players see this token's name? PF2e's own getter ignores its setting, so the setting is checked here. */
const playersSeeName = (tokenDoc) => !tokensSetNames() || tokenDoc?.playersCanSeeName !== false;
/** Redraw the GM's turn card soon, if it's open: card.mjs registers how (setCardRefresh), so other files needn't import it. */
let cardRefresh = () => {};
const refreshCard = (delay) => cardRefresh(delay);
const setCardRefresh = (fn) => { cardRefresh = typeof fn === "function" ? fn : () => {}; };

/** This module's browser storage, per world and user. */
const store = storage("pf2e-tactics");

/**
 * One GM in two browser tabs does the GM's work once: the kit's tab election over the module's socket, started at ready
 * (startGmTabs). Before it starts (node tests, the first moment of a page) the active GM's client counts as the lead.
 */
const tabs = gmTabs("pf2e-tactics");
let tabsStarted = false;
function startGmTabs() {
    if (tabsStarted || !game.socket) return;
    game.socket.on("module.pf2e-tactics", (msg, senderId) => { tabs.handle(msg, senderId); });
    tabs.start();
    tabsStarted = true;
}
/** True in the one client that should do the GM's work now (a hook that can't wait). */
const isGmLead = () => (tabsStarted ? tabs.isLead() : !!game.users?.activeGM?.isSelf);
/** The same for work on an event that can wait a moment: waits out a new tab's first 1.5 s and asks a silent lead. */
const gmLeadNow = async () => (tabsStarted ? tabs.leadNow() : !!game.users?.activeGM?.isSelf);
/**
 * GM work on an event that found no lead at once (a new tab's first moments, or a lead tab that vanished without saying
 * goodbye): ask (leadNow, up to 3 s) and run it then if this tab leads, so the work isn't silently dropped. fn gets true.
 */
const gmLater = (fn) => {
    if (!tabsStarted || !game.users?.activeGM?.isSelf) return;
    tabs.leadNow().then((lead) => { if (lead) fn(true); }).catch(() => {});
};

/** Can every player see this chat card? A whispered or blind one teaches the party nothing. */
const playersSee = (message) => !message?.blind && !((message?.whisper?.length ?? message?.whisper?.size ?? 0) > 0);

export { baseActorOf, BOARD_FIELDS, cap, costGlyph, esc, FLAG_SCOPE, flagOf, gmLater, gmLeadNow, isGmLead, labelAttr, link, MODULE_ID, playersSee, playersSeeName, POSITION_KEY, refreshCard, rememberWindow, rules, safe, section, setCardRefresh, setting, signed, slugify, slugOf, startGmTabs, store, tipAttr, tokensSetNames, ul };
