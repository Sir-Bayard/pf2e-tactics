/**
 * PF2e Tactics (module id pf2e-tactics)
 *
 * When an NPC's turn starts, the GM gets a card (a window or a whisper): one recommended turn with the reasoning
 * behind it, a few alternatives, the encounter's tactics and triggers, and every Strike, action, reaction and spell
 * it has. The Turn Helper gives a player the same kind of advice for their own character. The GM and players decide;
 * nothing is moved or rolled for them.
 *
 * One module in several files (ES modules, loaded by this entry):
 *   shared.mjs: constants and small helpers
 *   reader.mjs: abilities, dice, geometry, the board (pure where possible: these run in node for the tests)
 *   advisor.mjs: the turn advisor
 *   card.mjs: triggers, the card, the window, chat and the drawn path
 *   state.mjs: the turn ledger, recharge, threat and what the NPCs learn
 *   hooks.mjs: turns, whispers, Foundry hooks, settings and the API
 *   player.mjs: the Turn Helper, the player's own view of their character's turn, and its advice
 *   classes.mjs: what a character's class and feats add to that advice (one file per class in classes/)
 *   record.mjs: what a character did this fight that PF2e doesn't keep (Spellstrike, Exploit Vulnerability...)
 */
import "./hooks.mjs";
import "./player.mjs";
