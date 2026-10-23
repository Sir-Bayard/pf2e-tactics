/**
 * PF2e Tactics (module id pf2e-tactics)
 *
 * When an NPC's turn starts, a window (or a GM whisper) shows what it can do and how to use it
 * well on the board as it stands: one recommended turn with the reasoning behind it, a few
 * alternatives, the encounter's own tactics and triggers, and every Strike, action, reaction and
 * spell it has, so nothing gets forgotten. The GM decides; nothing is moved or rolled for you.
 *
 * Abilities are read from PF2e's data first (action costs, traits, links to the basic actions,
 * checks, damage and templates in the text) and from the wording second, so an ability like
 * Elf Step ("Step 5 feet twice") replaces a plain Step wherever a turn needs one.
 *
 * Triggers: a line in an encounter's tactics or in your notes of the form
 *     Trigger: Bandit Captain, below 20 HP: calls the retreat and runs for the door.
 * is watched during combat. The card shows it as soon as it's true, and the GM gets a whisper
 * the moment it happens, even on a player's turn. Conditions it understands: below N HP, below
 * half (a third, a quarter, N%) of its HP, <name> is down/dead, round N, alone, half its allies
 * down. Anything else is shown as a reminder to watch for.
 */
const MODULE_ID = "pf2e-tactics";
const FLAG_SCOPE = MODULE_ID;
/** A flag of this module's on a document (getFlag throws for an inactive module's scope, so the raw flags are the fallback). */
const flagOf = (doc, key) => {
    let v;
    try { v = doc?.getFlag?.(MODULE_ID, key); } catch { v = undefined; }
    return v ?? doc?.flags?.[MODULE_ID]?.[key];
};
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

/** The world actor behind a token, so notes are shared by every token of it. */
const baseActorOf = (actor) => (actor?.isToken ? game.actors.get(actor.id) ?? actor : actor);

function setting(key, fallback) {
    try { return game.settings.get(MODULE_ID, key); } catch { return fallback; }
}
// ---------------------------------------------------------------------------------------------

export { FLAG_SCOPE, MODULE_ID, POSITION_KEY, flagOf, baseActorOf, cap, costGlyph, esc, link, section, setting, signed, ul };
