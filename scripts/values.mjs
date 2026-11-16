/**
 * PF2e Tactics: values.mjs
 *
 * The weights the advisor, the reader and the threat table share: what a condition is worth to a fight, how a creature
 * picks targets by its wits, about what one hit does at a level, and the threat settings. Imports only shared.mjs, so
 * any file can use it without pulling in the others.
 */
import { setting } from "./shared.mjs";

/** Rough worth of each condition to the fight, from what it does: losing actions and being unable to act weigh most. */
const CONDITION_VALUE = { frightened: 2, sickened: 2.5, clumsy: 1.5, enfeebled: 1.5, stupefied: 1.5, drained: 1.5, fatigued: 1.5, dazzled: 2, blinded: 5, deafened: 0.5,
    "off-guard": 2, prone: 3.5, slowed: 5, stunned: 5, immobilized: 2.5, grabbed: 3.5, restrained: 7, paralyzed: 10, confused: 5,
    fascinated: 2, fleeing: 5, unconscious: 10, petrified: 10, controlled: 12, doomed: 1 };

const isAnimal = (me) => !!(me?.mindless || (me?.int ?? 0) <= -4);
/**
 * How it picks targets, by Intelligence. 0 instinct (mindless or Int -4 or lower), 1 crude (Int -3 to +0),
 * 2 tactical (+1), 3 shrewd (+2), 4 sharp (+3 or more).
 */
const tierOf = (me) => (isAnimal(me) ? 0 : (me?.int ?? 0) <= 0 ? 1 : me.int === 1 ? 2 : me.int === 2 ? 3 : 4);
const TIER_TEXT = [
    "On instinct: the closest foe, or whatever hurt it most",
    "Crude: goes by what it sees (armor, wounds, who's in its face)",
    "Tactical: flanks, focuses fire, finishes off the hurt",
    "Shrewd: tactical, and goes for healers and casters first",
    "Sharp: reads real AC and saves, goes for healers and casters",
];
/** How much of the harm done to its allies a creature takes in, by wits (see threatPull in advisor.mjs). */
const NOTICE = [0, 0.25, 0.5, 0.6, 0.75];
const actorTier = (a) => tierOf({ mindless: a?.traits?.has?.("mindless") ?? false, int: a?.system?.abilities?.int?.mod ?? 0 });

/** About what one hit does at a level (close to the system's creatures' median Strike damage, FOE_GUESS.damage), so fixed
 *  amounts stay in proportion from level -1 to 25. */
const hitWorth = (level) => Math.max(4, 6 + 1.6 * (Number(level) || 0));

// The threat settings
const threatOn = () => setting("threat", true) !== false;
const threatDecay = () => { const v = Number(setting("threatDecay", "0.5")); return v > 0 && v <= 1 ? v : 0.5; };
const threatScale = () => Number(setting("threatWeight", "1")) || 1;

/** Spells that get round a hidden or invisible foe, and how (the Turn Helper and the NPC card both use them). */
const REVEAL_SPELLS = [
    { re: /^revealing light$/i, how: "a 10-foot burst, Reflex save: a foe that fails is dazzled, and if it is invisible it becomes concealed instead of hidden" },
    { re: /^see the unseen$/i, how: "you see invisible creatures as concealed rather than hidden" },
    { re: /^faerie fire$/i, how: "a 10-foot burst: creatures in it can't be concealed, and invisible ones are concealed instead of hidden" },
    { re: /^glitterdust$/i, how: "a 10-foot burst, Reflex save: invisible creatures are revealed" },
    { re: /^true seeing$/i, how: "you see through illusions and invisibility" },
];

/**
 * A creature of level L as the PF2e system's own creatures run (T20): the median of every npc in the system's packs at
 * each level, fitted to a formula (PF2e 8.7.0: AC, saves and attack within two; HP and damage within about 10%,
 * HP exact from level -1 to 8). No published table is stored;
 * _dev's check script compares the formula with the packs after each PF2e update. ac, the middle of its three saves,
 * hp, its best melee Strike's bonus, and that Strike's average damage.
 */
const FOE_GUESS = Object.freeze({
    ac: (L) => Math.max(15, 14 + Math.floor(1.5 * L)),
    save: (L) => 5 + Math.floor(1.45 * L),
    hp: (L) => (L < 0 ? 8 : L <= 1 ? 15 + 5 * L : L <= 5 ? 15 * L : 20 * L - 25),
    attack: (L) => 8 + Math.floor(1.5 * L),
    damage: (L) => Math.max(3.5, Math.round(2 * (4 + 1.8 * L)) / 2),
});

export { CONDITION_VALUE, FOE_GUESS, NOTICE, REVEAL_SPELLS, TIER_TEXT, actorTier, hitWorth, isAnimal, threatDecay, threatOn, threatScale, tierOf };
