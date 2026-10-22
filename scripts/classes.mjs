/**
 * PF2e Tactics: classes.mjs
 * What a player character's class, feats, ancestry feats and archetypes add to the Turn Helper's advice. One file per
 * class in classes/; each is keyed to feature slugs, so a feature from an archetype reads the same as the class's.
 * classFeatures runs before the advisor plans, so a read can mark the board (sneak dice, foes off-guard) first.
 */
import { has } from "./classes/_common.mjs";
import { general, reactionsNote } from "./classes/general.mjs";
import { rogue } from "./classes/rogue.mjs";
import { fighter } from "./classes/fighter.mjs";
import { barbarian } from "./classes/barbarian.mjs";
import { ranger } from "./classes/ranger.mjs";
import { champion } from "./classes/champion.mjs";
import { commander } from "./classes/commander.mjs";
import { magus } from "./classes/magus.mjs";
import { thaumaturge } from "./classes/thaumaturge.mjs";
import { alchemist } from "./classes/alchemist.mjs";
import { cleric } from "./classes/cleric.mjs";
import { sorcerer } from "./classes/sorcerer.mjs";
import { wizard } from "./classes/wizard.mjs";
import { bard } from "./classes/bard.mjs";
import { druid } from "./classes/druid.mjs";
import { investigator } from "./classes/investigator.mjs";
import { oracle } from "./classes/oracle.mjs";
import { monk } from "./classes/monk.mjs";
import { swashbuckler } from "./classes/swashbuckler.mjs";
import { witch } from "./classes/witch.mjs";

/** Every class read: [slug of the class, a feature slug that also turns it on (archetypes), the read]. */
const READS = [
    ["cleric", "divine-font", cleric],
    ["sorcerer", "bloodline-spells", sorcerer],
    ["wizard", "arcane-bond", wizard],
    ["bard", "composition-spells", bard],
    ["druid", "untamed-form", druid],
    ["investigator", "devise-a-stratagem", investigator],
    ["oracle", "oracular-curse", oracle],
    ["monk", "powerful-fist", monk],
    ["swashbuckler", "panache", swashbuckler],
    ["witch", "hex-spells", witch],
    ["fighter", "double-slice", fighter],
    ["barbarian", "rage", barbarian],
    ["ranger", "hunt-prey", ranger],
    ["champion", "champions-reaction", champion],
    ["rogue", "sneak-attack", rogue],
    ["commander", "tactics", commander],
    ["magus", "spellstrike", magus],
    ["thaumaturge", "exploit-vulnerability", thaumaturge],
    ["alchemist", "quick-alchemy", alchemist],
];

/** Plans and notes from the character's class and feats. ctx: { actions, made }. */
function classFeatures(board, ctx) {
    const out = { plans: [], notes: [] };
    const actor = board.me.actor;
    const cls = actor?.class?.slug ?? (actor?.class?.name ?? "").toLowerCase();
    const safe = (fn) => { try { fn(board, ctx, out); } catch (err) { console.warn("pf2e-tactics | class feature read failed", err); } };
    safe(general);
    for (const [slug, feature, read] of READS) if (cls === slug || has(actor, feature)) safe(read);
    safe((b, c, o) => reactionsNote(b, o));
    return out;
}

export { classFeatures, READS };
