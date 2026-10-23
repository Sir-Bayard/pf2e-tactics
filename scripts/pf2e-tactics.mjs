/**
 * PF2e Tactics (module id pf2e-tactics)
 *
 * One module in several files (ES modules, loaded by this entry):
 *   shared.mjs   constants and small helpers
 *   reader.mjs   abilities, dice, geometry, the board (pure where possible: these run in node for the tests)
 *   advisor.mjs  the turn advisor
 *   card.mjs     triggers, the card, the window, chat and the drawn path
 *   state.mjs    the turn ledger, recharge, threat and what the NPCs learn
 *   hooks.mjs    turns, whispers, Foundry hooks, settings and the API
 *   player.mjs   the Turn Helper: the player's own view of their character's turn, and its advice
 *   classes.mjs  what a character's class and feats add to that advice
 */
import "./hooks.mjs";
import "./player.mjs";
