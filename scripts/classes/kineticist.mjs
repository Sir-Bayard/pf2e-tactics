/**
 * PF2e Tactics: classes/kineticist.mjs
 * See classes/_common.mjs for the shape of a class read.
 * Reads the kinetic gate (elements, single or dual, the thresholds' extra elements), whether the kinetic aura is up,
 * Channel Elements with its free 1-action blast or stance, Elemental Blast runs (1 and 2 actions, melee or ranged, the
 * element's die and range, Weapon Infusion's shapes, Two-Element Infusion, Chain Infusion, Lightning Rod), the damaging
 * and healing impulses by their level-scaled dice (areas placed on the board, overflow planned last with the aura's loss
 * counted), the stances as Channel's free action when they pay, the gate junctions the sheet shows, Extract Element,
 * Safe Elements, Final Gate and Kinetic Pinnacle. The rest are when-notes.
 * Numbers come from the system's rule elements: blast dice 1 + (level-1)/4 (the archetype's from Improved Elemental
 * Blast), the impulse attack from the "impulse" statistic (class DC - 10 when it isn't there).
 */
import { canMove, effect, has, level, moveText, pct, slugOf, squareToReach, targets, usesLeft, worth, degreeChances, feetBetween, inReach, mapFor, strikeExpected, nameOf, reachableSquares, signed, abil } from "./_common.mjs";
import { areaHits } from "../advisor.mjs";
import { centerOf, damageAgainst } from "../reader.mjs";
import { cap } from "../shared.mjs";

const F = (a, b) => Math.floor(a / b);
const dAvg = (n, d) => Math.max(0, n) * (d + 1) / 2;
const round1 = (n) => Math.round(n * 10) / 10;

/** The six elements: blast die, blast range, damage types; what the system automates of each junction (the rest is the feature's text). */
const ELEMENTS = {
    air: { die: 6, range: 60, types: ["electricity", "slashing"], versatile: "cold", resist: "air and electricity", skill: "Stealth", aura: "allies in your aura get +10 feet of Speed", crit: "the junction's rider on a critical air blast (see the gate feature)", impulse: "the junction's rider on every 2-action air impulse (see the gate feature)" },
    earth: { die: 8, range: 30, types: ["bludgeoning", "piercing"], versatile: "poison", resist: "earth and poison", skill: "Athletics", aura: "the junction's effect on your aura (see the gate feature)", crit: "the junction's rider on a critical earth blast (see the gate feature)", impulse: "the junction's rider on every 2-action earth impulse (see the gate feature)" },
    fire: { die: 6, range: 60, types: ["fire"], versatile: "cold", resist: "cold and fire", skill: "Intimidation", aura: "foes in your aura have weakness to your fire impulses equal to half your level", crit: "a critical fire blast adds 1d6 persistent fire (plus your gate's item bonus)", impulse: "2-action fire impulses roll one die size bigger, 2-action Elemental Blasts included (counted in the plans)" },
    metal: { die: 8, range: 30, types: ["piercing", "slashing"], versatile: "electricity", resist: "electricity and metal", skill: "Crafting", aura: "metal creatures in your aura take -1 AC", crit: "a critical metal blast adds 1d6 persistent bleed (plus your gate's item bonus)", impulse: "the junction's rider on every 2-action metal impulse (see the gate feature)" },
    water: { die: 8, range: 30, types: ["bludgeoning", "cold"], versatile: "acid", resist: "fire and water", skill: "Athletics", aura: "allies in your aura resist fire, half your level", crit: "a critical water blast splashes the creatures next to the target", impulse: "the junction's rider on every 2-action water impulse (see the gate feature)" },
    wood: { die: 8, range: 30, types: ["bludgeoning", "vitality"], versatile: "poison", resist: "poison and wood", skill: "Survival", aura: "allies that start their turn in your aura get temporary HP (1, 2 from 10th, 3 from 15th)", crit: "the junction's rider on a critical wood blast (see the gate feature)", impulse: "the junction's rider on every 2-action wood impulse (see the gate feature)" },
};
const ELS = Object.keys(ELEMENTS);

/**
 * The damaging, debuffing and healing impulses, with their dice by level from the system's inline rolls.
 * dmg(lv): [[dice, die, flat, type, persistent?]] (persistent counts 1.5x); area: { shape, size } or a function of the level;
 * from: "self" (a cone, line or emanation from you), "point" (a burst within range), "target" (one creature within range),
 * "leap" (an emanation where you land, a move away), "trees" (Rouse the Forest's Fury); save: the stat (basic unless basic: false);
 * attack: an impulse attack roll; rider(c, board, foe): worth of its conditions from the foe's degree chances c;
 * allySafe: you pick who it hits; heal: HP restored to allies in it; enemyOnly: it skips allies by text.
 */
const IMPULSES = {
    // level 1
    "aerial-boomerang": { name: "Aerial Boomerang", el: ["air"], cost: 2, area: { shape: "line", size: 60 }, from: "self", save: "reflex", dmg: (lv) => [[F(lv - 1, 2) + 2, 4, 0, "slashing"]], again: 0.5, tail: "the boomerang waits in the last square; 1 action next turn brings it back along a line for the same damage" },
    "flying-flame": { name: "Flying Flame", el: ["fire"], cost: 2, area: { shape: "line", size: 30 }, from: "self", save: "reflex", allySafe: true, dmg: (lv) => [[F(lv - 1, 2) + 1, 6, 0, "fire"]], tail: "its 30-foot path bends as you like, around your allies" },
    "hail-of-splinters": { name: "Hail of Splinters", el: ["wood"], cost: 2, overflow: true, area: { shape: "cone", size: 30 }, from: "self", save: "reflex", dmg: (lv) => [[F(lv - 1, 2) + 1, 4, 0, "piercing"], [F(lv - 1, 2) + 1, 4, 0, "bleed", true]] },
    "magnetic-pinions": { name: "Magnetic Pinions", el: ["metal"], cost: 3, overflow: true, kind: "pinions", range: 60, dmg: (lv) => [[F(lv - 1, 2) + 1, 4, 0, "bludgeoning"], [F(lv - 1, 2) + 1, 4, 0, "piercing"]] },
    "scorching-column": { name: "Scorching Column", el: ["fire"], cost: 3, overflow: true, area: { shape: "burst", size: 5 }, from: "point", range: 60, save: "reflex", terrain: true, dmg: (lv) => [[F(lv - 1, 3) + 1, 6, 0, "fire"]], sustain: "Sustain it (1 action) to keep the column's hazardous terrain up" },
    "shard-strike": { name: "Shard Strike (shards)", el: ["metal"], cost: 2, area: { shape: "cone", size: 15 }, from: "self", save: "reflex", dmg: (lv) => [[F(lv - 1, 2) + 1, 6, 0, "slashing"]], rider: (c) => c.cf * 1.5 * 3.5 },
    "shard-strike:spines": { name: "Shard Strike (spines)", el: ["metal"], cost: 2, area: { shape: "line", size: 30 }, from: "self", save: "reflex", dmg: (lv) => [[F(lv - 1, 2) + 1, 6, 0, "piercing"]], rider: (c, b) => c.cf * worth(b, "clumsy", 0.5) },
    "tidal-hands": { name: "Tidal Hands", el: ["water"], cost: 2, overflow: true, area: { shape: "cone", size: 30 }, from: "self", save: "reflex", dmg: (lv) => [[F(lv - 1, 2) + 1, 8, 0, "bludgeoning"]], rider: (c) => c.cf * 1, tail: "or two 15-foot cones that don't overlap" },
    tremor: { name: "Tremor", el: ["earth"], cost: 2, overflow: true, area: { shape: "burst", size: 10 }, from: "point", range: 30, save: "fortitude", terrain: true, dmg: (lv) => [[Math.ceil(lv / 2), 8, 0, "bludgeoning"]], rider: (c, b) => c.cf * worth(b, "prone") },
    "winter-s-clutch": { name: "Winter's Clutch", el: ["water"], cost: 2, area: { shape: "burst", size: 10 }, from: "point", range: 60, save: "reflex", terrain: true, dmg: (lv) => [[F(lv - 1, 2) + 2, 4, 0, "cold"]] },
    "fresh-produce": { name: "Fresh Produce", el: ["wood"], cost: 1, heal: true, from: "aura", healAvg: (lv) => dAvg(F(lv - 1, 2) + 1, 4) + F(lv - 1, 2) * 5 + 1, tail: "the produce grows in their hand; eating it is an Interact action of theirs" },
    "ocean-s-balm": { name: "Ocean's Balm", el: ["water"], cost: 1, heal: true, range: 5, healAvg: (lv) => dAvg(F(lv - 1, 2) + 1, 8), tail: "touch; they resist fire 2 for a minute and are immune to it for 10 minutes" },
    // level 3
    "extract-element": { name: "Extract Element", el: [], cost: 1, kind: "extract", range: 30, save: "fortitude", dmg: (lv) => [[Math.ceil(lv / 2), 4, 0, "untyped"]] },
    // level 4
    "blazing-wave": { name: "Blazing Wave", el: ["fire"], cost: 2, overflow: true, area: { shape: "cone", size: 30 }, from: "self", save: "reflex", dmg: (lv) => [[F(lv - 4, 2) + 4, 6, 0, "fire"]], rider: (c, b) => c.cf * worth(b, "prone") },
    "lava-leap": { name: "Lava Leap", el: ["earth", "fire"], cost: 2, overflow: true, area: { shape: "emanation", size: 10 }, from: "leap", save: "reflex", dmg: (lv) => [[F(lv - 4, 3) + 1, 6, 0, "bludgeoning"], [F(lv - 4, 3) + 2, 6, 0, "fire"]], tail: "Leap up to your Speed first; the cooled lava gives you +2 AC until your next turn" },
    "lightning-dash": { name: "Lightning Dash", el: ["air"], cost: 2, overflow: true, area: (lv) => ({ shape: "line", size: 30 + 5 * F(Math.max(0, lv - 4), 3) }), from: "self", save: "reflex", dmg: (lv) => [[F(lv - 4, 3) + 2, 12, 0, "electricity"]], tail: "you move along the line through the creatures and end at its far end; no reactions to the movement" },
    "tumbling-lumber": { name: "Tumbling Lumber", el: ["wood"], cost: 2, area: { shape: "line", size: 30 }, from: "self", save: "reflex", dmg: (lv) => [[F(lv - 4, 3) + 2, 8, 0, "bludgeoning"]], rider: (c, b) => c.f * 1 + c.cf * worth(b, "prone"), tail: "the line is 10 feet wide; a failure pushes the creature out of it" },
    "whirling-grindstone": { name: "Whirling Grindstone", el: ["earth", "metal"], cost: 2, kind: "attack", range: 35, dmg: (lv) => [[F(lv - 4, 5) + 2, 6, 0, "slashing"], [F(lv - 4, 5) + 1, 6, 0, "fire"]], sustain: "Sustain it (1 action) next turn: roll the grindstone 20 feet and attack again" },
    "rain-of-rust": null, // only metal creatures and metal armor: a note
    // level 6
    "ash-strider": { name: "Ash Strider", el: ["air", "fire"], cost: 2, overflow: true, kind: "pass", save: "reflex", dmg: (lv) => [[F(lv - 6, 2) + 3, 6, 0, "fire"]], tail: "a Stride as ash through the creature; you're concealed until your next turn" },
    "driving-rain": { name: "Driving Rain", el: ["water"], cost: 3, overflow: true, area: { shape: "burst", size: 15 }, from: "point", range: 120, save: "reflex", dmg: (lv) => [[F(lv - 6, 2) + 3, 8, 0, "bludgeoning"]], tail: "everything in the rain is concealed until your next turn" },
    "elemental-artillery": { name: "Elemental Artillery", el: ["metal", "wood"], cost: 3, kind: "attack", range: 150, dmg: (lv) => [[F(lv - 6, 3) + 3, 12, 0, "piercing"]], sustain: "the ballista needs two Interact actions to reload; Sustain it to roll it, shoot or reload" },
    "lightning-rod": { name: "Lightning Rod", el: ["air", "metal"], cost: 3, kind: "rod", dmg: (lv) => [[F(lv - 6, 6) + 1, 12, 0, "electricity"]] },
    "molten-wire": { name: "Molten Wire", el: ["fire", "metal"], cost: 2, kind: "attack", range: 15, dmg: (lv) => [[F(lv - 6, 4) + 2, 6, 0, "slashing"], [F(lv - 6, 4) + 2, 4, 0, "fire", true]], onHit: (b) => worth(b, "clumsy"), tail: "the wire holds for a minute: clumsy 1 and the fire each turn (basic Reflex) until it Escapes" },
    "rising-hurricane": { name: "Rising Hurricane", el: ["air", "water"], cost: 3, overflow: true, area: { shape: "burst", size: 15 }, from: "point", range: 120, save: "fortitude", dmg: (lv) => [[F(lv - 6, 3) + 2, 6, 0, "bludgeoning"]], rider: (c, b, f) => (c.f + c.cf) * ((f.rect?.z ?? 0) > 0 && f.flies ? 0 : 15), tail: "a failure lifts the creature and drops it for falling damage (about 20)" },
    "roiling-mudslide": { name: "Roiling Mudslide", el: ["earth", "water"], cost: 2, area: { shape: "cone", size: 30 }, from: "self", save: "fortitude", dmg: (lv) => [[F(lv - 6, 4) + 2, 8, 0, "bludgeoning"]], rider: (c, b) => (c.f + c.cf) * (1 + worth(b, "prone", 0.5)), tail: "a failure pushes 5 feet and coats in mud: it falls at the end of its next move" },
    "torrent-in-the-blood": { name: "Torrent in the Blood", el: ["water"], cost: 2, overflow: true, heal: true, area: { shape: "cone", size: 30 }, from: "self", healAvg: (lv) => dAvg(F(Math.max(6, lv) - 6, 2) + 3, 8), tail: "it heals every creature in the cone, foes too, and each gets a new save against a poison or disease" },
    "tree-of-duality": { name: "Tree of Duality", el: ["air", "wood"], cost: 3, heal: true, area: { shape: "burst", size: 10 }, from: "point", range: 60, healAvg: (lv) => dAvg(F(Math.max(6, lv) - 6, 2) + 3, 4), dazzle: true, tail: "enemies in it are dazzled; Sustain it up to a minute" },
    "weight-of-stone": { name: "Weight of Stone", el: ["earth"], cost: 3, overflow: true, area: { shape: "burst", size: 10 }, from: "point", range: 120, save: "reflex", dmg: (lv) => [[F(lv - 6, 2) + 4, 8, 0, "bludgeoning"]], rider: (c, b, f) => ((f.rect?.z ?? 0) > 0 ? (c.f + c.cf) * 3 : 0), tail: "a failure drives a flier to the ground and keeps it there a round" },
    "dash-of-herbs": { name: "Dash of Herbs", el: ["wood"], cost: 2, heal: true, range: 30, healAvg: (lv) => dAvg(F(Math.max(6, lv) - 6, 2) + 2, 10) + 4, tail: "choose injuries for the d10s, or a malady for a new save against it; they're immune for 10 minutes after" },
    "sand-snatcher": { name: "Sand Snatcher", el: ["earth"], cost: 2, kind: "snatcher", range: 35 },
    // level 8
    "call-the-hurricane": { name: "Call the Hurricane", el: ["water"], cost: 2, overflow: true, area: { shape: "emanation", size: 20 }, from: "self", save: "reflex", dmg: (lv) => [[F(lv - 8, 2) + 6, 8, 0, "bludgeoning"]], rider: (c) => (c.f + c.cf) * 1.5, tail: "a failure pushes 10 feet (20 on a critical failure); a 30-foot emanation when you stand in water" },
    "conductive-sphere": { name: "Conductive Sphere", el: ["metal"], cost: 2, kind: "target", range: 35, save: "reflex", dmg: (lv) => [[F(lv - 5, 3), 12, 0, "electricity"]], sustain: "Sustain it (1 action) each turn: it flies 20 feet or shocks a creature next to it again", tail: "allies next to the sphere resist electricity and their metal Strikes get the shock rune" },
    "retch-rust": { name: "Retch Rust", el: ["metal"], cost: 2, overflow: true, area: { shape: "cone", size: 30 }, from: "self", save: "fortitude", dmg: (lv) => [[F(lv - 8, 2) + 4, 10, 0, "slashing"]], tail: "a metal creature that fails also takes persistent slashing" },
    "sanguivolent-roots": { name: "Sanguivolent Roots", el: ["wood"], cost: 3, overflow: true, area: { shape: "burst", size: 15 }, from: "point", range: 120, save: "fortitude", enemyOnly: true, drain: true, dmg: (lv) => [[F(lv - 8, 2) + 3, 6, 0, "piercing"]], sustain: "the first Sustain each turn drains again", tail: "only living enemies bleed; your allies in the vines heal half the highest damage dealt" },
    "solar-detonation": { name: "Solar Detonation", el: ["fire"], cost: 3, overflow: true, incap: true, area: { shape: "burst", size: 20 }, from: "point", range: 60, save: "reflex", dmg: (lv) => [[F(lv - 8, 2) + 6, 6, 0, "fire"], [F(lv - 8, 2) + 2, 6, 0, "vitality"]], rider: (c, b) => c.s * worth(b, "dazzled", 0.5) + c.f * worth(b, "blinded", 0.7) + c.cf * worth(b, "blinded", 2), tail: "success dazzles, failure blinds until your next turn (a minute on a critical failure); incapacitation" },
    "storm-spiral": { name: "Storm Spiral", el: ["air"], cost: 3, overflow: true, area: { shape: "burst", size: 20 }, from: "point", range: 60, save: "reflex", dmg: (lv) => [[F(lv - 8, 3) + 3, 12, 0, "electricity"], [1, 10, 0, "sonic"]], rider: (c) => (c.f + c.cf) * 0.5, tail: "a failure deafens; metal-clad creatures save at -1" },
    // level 12
    "burning-demand": { name: "Burning Demand", el: ["fire"], cost: 2, overflow: true, kind: "target", range: 30, save: "fortitude", basic: false, dmg: (lv) => [[F(lv, 2) + 2, 6, 0, "fire"], [F(lv - 12, 2) + 2, 6, 0, "fire", true]], degrees: (avg, b) => ({ cs: 0, s: 1, f: 0.6 * avg + 1.2, cf: 0.8 * avg + 2 }), tail: "the sigil fires at the start of its turn unless it spends its first action obeying your command; a success still marks it for -1 against your fire impulses" },
    "glacial-prison": { name: "Glacial Prison", el: ["water"], cost: 2, overflow: true, incap: true, kind: "target", range: 120, save: "fortitude", basic: false, dmg: () => [], degrees: (avg, b) => ({ cs: 0, s: worth(b, "slowed", 0.5), f: worth(b, "stunned") + 4, cf: worth(b, "stunned") + 4 + worth(b, "slowed", 0.5) }), tail: "a failure freezes it solid (AC 9, can't act) until the end of your next turn or until the first hostile action on it; one big hit lands on it" },
    "rain-of-razors": { name: "Rain of Razors", el: ["metal"], cost: 3, overflow: true, area: { shape: "burst", size: 20 }, from: "point", range: 60, save: "reflex", terrain: true, dmg: (lv) => [[F(lv - 12, 2) + 9, 6, 0, "slashing"]], tail: "the razors make the area hazardous for a minute" },
    "witchwood-seed": { name: "Witchwood Seed", el: ["wood"], cost: 2, overflow: true, kind: "target", range: 5, save: "fortitude", dmg: (lv) => [[F(lv - 12, 4) + 5, 10, 0, "piercing"]], rider: (c, b) => c.s * 1 + c.f * (worth(b, "clumsy", 2) + worth(b, "immobilized")) + c.cf * (worth(b, "clumsy", 2) + worth(b, "immobilized", 1.5)), immuneTraits: ["plant", "fungus", "wood"], tail: "touch; a failure leaves it clumsy 2 and immobilized until the end of its next turn" },
    // level 14
    "walk-through-the-conflagration": { name: "Walk Through the Conflagration", el: ["fire"], cost: 2, overflow: true, area: { shape: "emanation", size: 5 }, from: "self", save: "reflex", dmg: (lv) => [[F(lv - 14, 3) + 4, 6, 0, "fire"]], tail: "then you teleport up to 120 feet to a space next to an open flame or a creature burning with persistent fire (the whorl can come after the jump instead)" },
    // level 18
    "all-shall-end-in-flames": { name: "All Shall End in Flames", el: ["fire"], cost: 3, overflow: true, area: { shape: "burst", size: 30 }, from: "point", range: 500, save: "reflex", dmg: (lv) => [[lv >= 20 ? 15 : 13, 6, 0, "fire"]], tail: "or a 30-foot emanation; anything it drops to 0 HP dies, and if it kills you, you rise at the start of your next turn" },
    "hell-of-1-000-000-needles": { name: "Hell of 1,000,000 Needles", el: ["metal"], cost: 3, overflow: true, area: { shape: "burst", size: 15 }, from: "point", range: 500, save: "reflex", terrain: true, dmg: (lv) => [[lv >= 20 ? 17 : 13, 6, 0, "piercing"]], rider: (c, b) => (c.f + c.cf) * worth(b, "immobilized") + c.cf * worth(b, "off-guard"), sustain: "the first Sustain each round adds 3d12 electricity to everything in the cube", tail: "a 30-foot cube; a failure impales (immobilized until it Escapes)" },
    "ignite-the-sun": { name: "Ignite the Sun", el: ["fire"], cost: 2, area: { shape: "burst", size: 5 }, from: "point", range: 500, save: "reflex", dmg: () => [[7, 6, 0, "fire"]], again: 0.5, sustain: "Sustain it (1 action) to grow the sun 5 feet and fly it 30 feet through more creatures", tail: "you and your allies in its light add 1d6 fire to every Strike" },
    "ride-the-tsunami": { name: "Ride the Tsunami", el: ["water"], cost: 3, overflow: true, area: { shape: "cone", size: 60 }, from: "self", save: "reflex", dmg: () => [[10, 10, 0, "bludgeoning"]], rider: (c) => (c.f + c.cf) * 2, tail: "or a 120-foot line; a failure is pushed 20 feet, and you can Swim to any point of the wave" },
    "ride-the-tsunami:line": { name: "Ride the Tsunami (line)", el: ["water"], cost: 3, overflow: true, area: { shape: "line", size: 120 }, from: "self", save: "reflex", dmg: () => [[10, 10, 0, "bludgeoning"]], rider: (c) => (c.f + c.cf) * 2 },
    "rouse-the-forest-s-fury": { name: "Rouse the Forest's Fury", el: ["wood"], cost: 3, overflow: true, kind: "trees" },
    "the-shattered-mountain-weeps": { name: "The Shattered Mountain Weeps", el: ["earth"], cost: 3, overflow: true, area: { shape: "burst", size: 20 }, from: "point", range: 120, save: "fortitude", terrain: true, dmg: (lv) => [[lv >= 20 ? 10 : 9, 10, 0, "bludgeoning"]], rider: (c, b, f, lv) => (c.f + c.cf) * worth(b, "prone") + 0.3 * dAvg(lv >= 20 ? 4 : 3, 10), tail: "those who fail fall prone; rocks keep falling for a minute on anyone ending its turn in the area" },
    "the-thousand-lashes-of-the-weeping-willow": { name: "The Thousand Lashes of the Weeping Willow", el: ["wood"], cost: 3, overflow: true, area: { shape: "burst", size: 30 }, from: "point", range: 500, save: "reflex", enemyOnly: true, dmg: (lv) => [[lv >= 20 ? 14 : 10, 8, 0, "slashing"]], rider: (c, b) => (c.f + c.cf) * worth(b, "slowed", 0.7), sustain: "the first Sustain each round lashes again for a quarter of the dice", tail: "the willow spares you and your allies; a failure is slowed 1 while it stands" },
};

/** Stances: the aura effect, and what entering one is worth with the foes and allies around you. */
const STANCES = {
    "geologic-attunement": { name: "Geologic Attunement", pays: "foes stand in your aura", el: "earth", lv: 1, text: "tremorsense in your aura and a free Seek each round", value: (ctx) => ctx.hiddenFoes ? 2.5 : 0.8 },
    "air-shroud": { name: "Air Shroud", pays: "your allies stand in your aura", el: "air", lv: 4, text: "ranged attacks through your aura take -1, flying foes in it are slowed by difficult terrain, and anyone in it can breathe", value: () => 1 },
    "magnetic-field": { name: "Magnetic Field", pays: "your allies stand in your aura", el: "metal", lv: 4, text: "metal-clad creatures treat your aura as difficult terrain to leave (attract) or to approach (repel)", value: () => 1 },
    "ravel-of-thorns": { name: "Ravel of Thorns", pays: "foes stand in your aura", el: "wood", lv: 4, text: (lv) => `thorns in your aura: -10 feet Speed to anyone starting its turn in them and ${F(Math.max(0, lv - 4), 4) + 2} piercing per square entered (double on soil or water); they regrow after you move`, value: (ctx, lv) => ctx.foesInAura * (F(Math.max(0, lv - 4), 4) + 2) * 1.2 },
    "thermal-nimbus": { name: "Thermal Nimbus", pays: "foes stand in your aura", el: "fire", lv: 4, text: (lv) => `you and allies in your aura resist fire or cold ${lv}; every creature that starts its turn in the aura or enters it takes ${F(lv, 2)} of that damage`, value: (ctx, lv) => ctx.foesInAura * F(lv, 2) * 1.2 + ctx.alliesInAura * 0.5 },
    "winter-sleet": { name: "Winter Sleet", pays: "foes stand in your aura", el: "water", lv: 4, text: "ice in your aura: anyone who moves on it falls prone unless it passes Acrobatics or Reflex against your DC - 2 (a Step is safe); your water crits and critical failures on it slow 1", value: (ctx, lv, b) => ctx.foesInAura * worth(b, "prone", 0.35) + 0.5 },
    "desert-wind": { name: "Desert Wind", pays: "foes stand in your aura", el: "air", lv: 6, text: "sand in your aura conceals those inside from those outside and the other way round, and your air impulses on anyone in the aura cut for extra slashing", value: (ctx) => 1.5 + ctx.foesInAura * 0.5 },
    "steam-knight": { name: "Steam Knight", pays: "foes stand in your aura", el: "fire", lv: 6, text: (lv) => `+10 feet Speed and Leaps as long as your Speed; at the start of each turn a free burst of steam does ${dAvg(F(Math.max(0, lv - 6), 5) + 2, 6)} fire (basic Reflex) to everything in your aura and pushes those that fail`, value: (ctx, lv) => ctx.foesInAura * dAvg(F(Math.max(0, lv - 6), 5) + 2, 6) * 0.7 + 1 },
    "kindle-inner-flames": { name: "Kindle Inner Flames", pays: "your allies stand in your aura", el: "fire", lv: 8, text: (lv) => `you and allies in your aura get +${lv >= 12 ? 2 : 1} to Reflex and Acrobatics, a free Step each round, and ${lv >= 12 ? "the flaming rune" : "+2 fire"} on Strikes after a move action`, value: (ctx) => 1.5 + ctx.alliesInAura * 1.5 },
    "drifting-pollen": { name: "Drifting Pollen", pays: "foes stand in your aura", el: "wood", lv: 8, text: "pollen in your aura: each creature in it saves (Fortitude) once a round or is sickened 1 (2 on a critical failure) and dazzled while sickened", value: (ctx, lv, b) => ctx.foesInAura * worth(b, "sickened", 0.6) + 0.5 },
    "drowning-mist": { name: "Drowning Mist", pays: "foes stand in your aura", el: "water", lv: 12, cost: 2, text: "your aura is difficult terrain to anyone without a swim Speed, and air-breathers in it hold their breath and save (Fortitude) each round", value: (ctx) => ctx.foesInAura * 2 + 0.5 },
    "ghosts-in-the-storm": { name: "Ghosts in the Storm", pays: "your allies stand in your aura", el: "air", lv: 12, text: "you and allies in your aura get +2 to Reflex and Acrobatics; after a move action you're concealed and your Strikes get the shock rune until your next turn", value: (ctx) => 2 + ctx.alliesInAura * 1.5 },
    "sea-glass-guardians": { name: "Sea Glass Guardians", pays: "your allies stand in your aura", el: "water", lv: 12, text: "you and allies in your aura get +1 AC and saves; the first of you critically hit or critically failing a save is healed and the stance ends", value: (ctx) => 2 + ctx.alliesInAura * 1.5 },
    shattershields: { name: "Shattershields", pays: "your allies stand in your aura", el: "metal", lv: 12, text: "you and allies in your aura get +1 AC and four plates that each soak 5 from a physical hit (1 action to replace them)", value: (ctx) => 2 + ctx.alliesInAura * 1.5 },
    "assume-earth-s-mantle": { name: "Assume Earth's Mantle", pays: "your allies stand in your aura", el: "earth", lv: 14, text: "you're Large with 5 feet more reach, climb earth, +1 Fortitude, +2 DC against being moved, and Strength +4 (or +1 more)", value: () => 2 },
    "orchard-s-endurance": { name: "Orchard's Endurance", pays: "your allies stand in your aura", el: "wood", lv: 14, text: (lv) => `you and allies in your aura resist bludgeoning and piercing ${5 + 2 * F(Math.max(0, lv - 14), 4)} and roll persistent-damage recovery twice`, value: (ctx) => 2 + ctx.alliesInAura * 1.5 },
    "crowned-in-tempest-s-fury": { name: "Crowned in Tempest's Fury", pays: "foes stand in your aura", el: "air", lv: 18, text: "anything that enters your aura or ends its turn there takes 2d12 electricity, you fly 20 feet (or your Cyclonic Ascent Speed) with +10 feet to all Speeds, and your air blasts add 1d12 electricity", value: (ctx) => ctx.foesInAura * 13 * 0.8 + 3 },
};

/** The character's kinetic elements: the system's flags first, then the gate features on the sheet. */
function elementsOf(actor) {
    const flags = actor?.flags?.system?.kineticist ?? actor?.flags?.pf2e?.kineticist ?? {};
    const set = new Set();
    for (const e of flags.elements ?? []) { const v = typeof e === "string" ? e : e?.value; if (ELEMENTS[v]) set.add(v); }
    for (const v of Object.values(flags.gate ?? {})) if (ELEMENTS[v]) set.add(v);
    for (const el of ELS) if (has(actor, `${el}-gate`)) set.add(el);
    return [...set];
}
/** Junctions by element from the roll options (junction:fire:impulse) or the Gate Junction items' choices. */
function junctionsOf(actor, elements, single) {
    const j = Object.fromEntries(elements.map((el) => [el, new Set()]));
    const ro = actor?.rollOptions?.all ?? {};
    for (const k of Object.keys(ro)) { const m = /^junction:(\w+):(\w+)$/.exec(k); if (m && ro[k] && j[m[1]]) j[m[1]].add(m[2]); }
    for (const it of actor?.items ?? []) {
        if (!/^gate-junction/.test(slugOf(it))) continue;
        const sel = it.flags?.system?.rulesSelections ?? it.flags?.pf2e?.rulesSelections ?? {};
        if (sel.element && sel.junction && j[sel.element]) j[sel.element].add(sel.junction);
    }
    if (single && elements.length) j[elements[0]].add("impulse");
    return j;
}

function kineticist(board, ctx, out) {
    const actor = board.me.actor;
    const me = board.me;
    const lv = level(board);
    const cls = actor?.class?.slug ?? (actor?.class?.name ?? "").toLowerCase();
    const isClass = cls === "kineticist";
    if (!isClass && !has(actor, "impulses") && !has(actor, "kineticist-dedication")) return;
    const elements = elementsOf(actor);
    if (!elements.length) { out.notes.push("No kinetic element is set on your sheet: pick the gate's element so the blasts and junctions can be read."); return; }
    const ro = actor?.rollOptions?.all ?? {};
    const flags = actor?.flags?.system?.kineticist ?? actor?.flags?.pf2e?.kineticist ?? {};
    const single = !!ro["kinetic-gate:initial:single-gate"] || (isClass && elements.length === 1 && !ro["kinetic-gate:initial:dual-gate"]);
    const junctions = junctionsOf(actor, elements, single);
    const auraOn = !!effect(actor, /^effect-kinetic-aura$/) || !!ro["self:effect:kinetic-aura"];
    const auraRadius = Number(flags.auraRadius) || 10;
    const stanceEffect = effect(actor, /^stance-/);
    const stanceSlug = stanceEffect ? slugOf(stanceEffect).replace(/^stance-/, "") : null;
    const activeStance = stanceSlug ? Object.entries(STANCES).find(([k]) => k.replace(/-s-/g, "s-") === stanceSlug || k === stanceSlug) : null;
    const stanceName = stanceEffect ? (activeStance?.[1].name ?? String(stanceEffect.name ?? "").replace(/^Stance:\s*/, "") ?? stanceSlug) : null;
    const con = abil(actor, "con"), str = abil(actor, "str");
    const classDC = Number(actor?.classDC?.value ?? actor?.system?.attributes?.classDC?.value) || 14 + lv;
    const sheetMod = actor?.getStatistic?.("impulse")?.mod ?? actor?.statistics?.impulse?.mod;
    const blastStrikes = board.strikes.filter((s) => slugOf(s.item ?? {}) === "elemental-blast" || /elemental blast/i.test(s.label ?? ""));
    // The sheet's own blast lines (when PF2e lists them as Strikes) carry the attack with its item bonus; they leave the advisor's Strikes,
    // which would plan them with the aura down
    if (blastStrikes.length) board.strikes = board.strikes.filter((s) => !blastStrikes.includes(s));
    const impulseMod = Number.isFinite(Number(sheetMod)) ? Number(sheetMod) : blastStrikes.length ? Math.max(...blastStrikes.map((s) => s.bonus)) : classDC - 10;
    const improved = (actor?.items ?? []).filter((i) => slugOf(i) === "improved-elemental-blast").length;
    const blastDice = isClass ? 1 + F(lv - 1, 4) : 1 + Math.min(3, improved);
    const versatile = has(actor, "versatile-blasts");
    const infusion = has(actor, "weapon-infusion");
    const twoElement = has(actor, "two-element-infusion") && elements.length >= 2;
    const finalGate = lv >= 19 && (has(actor, "final-gate") || isClass);
    const pinnacle = lv >= 20 && has(actor, "kinetic-pinnacle");
    const safe = has(actor, "safe-elements") ? Math.max(1, con) : 0;
    const foes = targets(board);
    const inAura = (c) => feetBetween(me.rect, c.rect) <= auraRadius;
    const foesInAura = foes.filter(inAura).length;
    const alliesInAura = board.allies.filter((a) => a.canAct !== false && inAura(a)).length;
    const stride = board.move?.stride?.feet ?? 25;
    const push = (plan) => out.plans.push({ kind: "class", dest: null, notes: [], ...plan, score: plan.ev + (plan.bias ?? 0.3) });
    /** Fire aura junction: foes in your aura have weakness to your fire impulses of half your level. */
    const fireWeak = (foe, types) => (junctions.fire?.has("aura") && auraOn && types.includes("fire") && inAura(foe) ? Math.max(1, F(lv, 2)) : 0);
    const extraDice = (el) => (el === "fire" && effect(actor, /^effect-furnace-form/) ? 1 : el === "metal" && effect(actor, /^effect-alloy-flesh-and-steel/) ? 1 : 0);
    const extraFlat = (el) => (el === "earth" && effect(actor, /^effect-rebirth-in-living-stone/) ? 5.5 : el === "air" && stanceSlug === "crowned-in-tempests-fury" ? 6.5 : 0);

    // ---- Elemental Blast: the best element, shape and range for one blast at f from `at`, with `made` attacks before it
    const blastTypes = (el) => ELEMENTS[el].types.concat(versatile ? [ELEMENTS[el].versatile] : []);
    const bestBlast = (f, at, made, cost) => {
        let best = null;
        const choices = elements.map((el) => ({ el, die: ELEMENTS[el].die, range: ELEMENTS[el].range, types: blastTypes(el), label: cap(el) }));
        if (twoElement) choices.push({ el: elements.slice().sort((a, b) => ELEMENTS[b].die - ELEMENTS[a].die)[0], two: true, die: Math.max(...elements.map((el) => ELEMENTS[el].die)), range: Math.max(...elements.map((el) => ELEMENTS[el].range)), types: [...new Set(elements.flatMap(blastTypes))], label: `Two-Element (${elements.slice(0, 2).map(cap).join(" and ")})` });
        const dist = feetBetween(at, f.rect);
        for (const c of choices) {
            const dice = blastDice + extraDice(c.el);
            // the fire impulse junction: a 2-action blast's fire damage rolls one die size bigger (the fire half of a Two-Element blast)
            const fireUp = cost === 2 && c.types.includes("fire") && !!junctions.fire?.has("impulse") && c.die < 12;
            const perDie = fireUp ? (c.two ? (c.die + 2) / 2 : (c.die + 3) / 2) : (c.die + 1) / 2;
            const diceAvg = dice * perDie;
            const dieText = fireUp && !c.two ? `${dice}d${c.die + 2}` : `${dice}d${c.die}`;
            const junctionText = fireUp ? (c.two ? `, the fire half a die bigger (fire junction)` : ", fire junction") : "";
            const base = diceAvg + extraFlat(c.el) + (cost === 2 ? con : 0);
            const dmg = damageAgainst(f.iwr, c.types);
            const delta = (dmg.immune ? 0 : Math.max(0, dmg.delta)) + fireWeak(f, c.types);
            const forms = [];
            // melee: reach 5 (10 with a reach infusion), Strength added; Weapon Infusion adds one trait, so the blast that
            // needs reach can't also be agile
            const needReach = !inReach(at, f.rect, 5);
            if (inReach(at, f.rect, infusion ? 10 : 5)) forms.push({ melee: true, bonus: impulseMod + mapFor(made, infusion && made > 0 && !needReach), avg: base + str, how: `melee${needReach ? ", reach infusion" : infusion && made > 0 ? ", agile infusion" : ""}` });
            // ranged: the element's range is a maximum, not an increment (Elemental Blast: "Earth ... 30 feet"); only Weapon
            // Infusion's shapes have range increments, -2 each past the first
            const pen = (r) => -2 * Math.max(0, Math.ceil(dist / r) - 1);
            if (dist <= c.range) forms.push({ melee: false, bonus: impulseMod + mapFor(made), avg: base, how: `ranged ${c.range} ft` });
            if (infusion) {
                if (dist <= 600) forms.push({ melee: false, bonus: impulseMod + mapFor(made) + pen(100) + (dist <= 30 ? -2 : 0), avg: base, how: `ranged, bow infusion 100 ft${dist <= 30 ? " (-2 volley)" : ""}` });
                if (dist <= 300) forms.push({ melee: false, bonus: impulseMod + mapFor(made) + pen(50), avg: base + F(Math.max(0, str), 2), how: "ranged, propulsive infusion 50 ft" });
                if (dist <= 120) forms.push({ melee: false, bonus: impulseMod + mapFor(made) + pen(20), avg: base + str, how: "ranged, thrown infusion 20 ft" });
            }
            for (const fm of forms) {
                const e = strikeExpected(fm.bonus, f.ac, fm.avg, { delta, immune: dmg.immune });
                if (!best || e.expected > best.e.expected) best = { ...fm, e, el: c.el, two: !!c.two, label: c.label, dice, die: c.die, cost, text: `${cost === 2 ? "2-action " : ""}${c.label} Blast at ${nameOf(f)}: ${fm.how} (${signed(fm.bonus)}, ${dieText}${fm.avg - diceAvg > 0 ? `+${Math.round(fm.avg - diceAvg)}` : ""}${cost === 2 ? ", Con added" : ""}${junctionText}${delta ? `, +${delta} weakness` : ""})` };
            }
        }
        return best;
    };
    /** A run of blasts at f: 1- and 2-action blasts in the order that pays most. free1: a free 1-action blast first (Channel); quick: one more 1-action blast at the end (Kinetic Pinnacle). */
    const blastRun = (f, at, actions, made, { free1 = false, quick = false } = {}) => {
        const seqs = { 3: [[2, 1], [1, 2], [1, 1, 1]], 2: [[2], [1, 1]], 1: [[1]], 0: [[]] }[Math.max(0, Math.min(3, actions))];
        let best = null;
        for (const seq of seqs) {
            const costs = [...(free1 ? [0] : []), ...seq, ...(quick ? [-1] : [])];
            const steps = [];
            let ev = 0, m = made, ok = true;
            for (const c of costs) {
                const b = bestBlast(f, at, m, c <= 0 ? 1 : c);
                if (!b) { ok = false; break; }
                steps.push({ cost: Math.max(0, c), text: c === 0 ? `with Channel's free blast: ${b.text}` : c === -1 ? `Kinetic Pinnacle's quickened action: ${b.text}` : b.text, blast: b });
                ev += b.e.expected; m += 1;
            }
            if (ok && (!best || ev > best.ev)) best = { steps, ev, made: m };
        }
        return best ?? { steps: [], ev: 0, made };
    };
    /** Channel Elements when the aura is down: 1 action (free with Final Gate), with a free 1-action blast at f or a stance (not for the dedication). */
    const opener = (f, at, stance = null) => {
        if (auraOn) return { steps: [], cost: 0, ev: 0, made: 0 };
        const cost = finalGate ? 0 : 1;
        const head = finalGate ? "Final Gate: Channel Elements free as your first action" : "Channel Elements";
        const aura = `your kinetic aura rises (${auraRadius}-foot emanation)`;
        if (!isClass) return { steps: [{ cost, text: `${head}: ${aura}; the dedication's Channel has no free blast` }], cost, ev: 0, made: 0 };
        if (stance) return { steps: [{ cost, text: `${head}: ${aura}, with ${stance.name} as its free stance: ${stance.text}` }], cost, ev: stance.ev, made: 0 };
        const b = f ? bestBlast(f, at, ctx.made, 1) : null;
        if (!b) return { steps: [{ cost, text: `${head}: ${aura}${safe ? `; Safe Elements: name up to ${safe} creatures the aura spares` : ""}` }], cost, ev: 0, made: 0 };
        return { steps: [{ cost, text: `${head}: ${aura}, with its free blast: ${b.text}${safe ? `; Safe Elements: name up to ${safe} creatures the aura spares` : ""}` }], cost, ev: b.e.expected, made: 1 };
    };
    /** What one 1-action blast is worth now: the yardstick an overflow impulse's lost aura is measured by. */
    const yardstick = foes.length ? Math.max(0, ...foes.map((f) => bestBlast(f, me.rect, 0, 1)?.e.expected ?? 0)) : 0;
    const overflowCost = (isClass ? 0.2 : 1) * yardstick + (stanceSlug ? 1.5 : 0) + (elements.some((el) => junctions[el].has("aura") || junctions[el].has("resistance")) ? 1 : 0);

    // ---- Plans: blast runs at each foe (Channel first when the aura is down), with a move in for a melee blast when Strength pays
    if (ctx.actions >= 1) for (const f of foes) {
        const op = opener(f, me.rect);
        const left = ctx.actions - op.cost;
        // Kinetic Pinnacle's quickened blast: added when ctx.actions doesn't count it yet; when it does, the 4th action is it
        const r = blastRun(f, me.rect, left, ctx.made + op.made, { quick: pinnacle && (ctx.actions <= 3 || left > 3) });
        const plan = r.steps.length || op.ev ? { title: `${auraOn ? "Elemental Blasts at" : "Channel Elements, then blast"} ${nameOf(f)}`, target: f, ev: op.ev + r.ev, steps: [...op.steps, ...r.steps] } : null;
        // A step in for a melee blast with Strength behind it
        if (str >= 2 && canMove(me) && !inReach(me.rect, f.rect, 5) && left >= 2) {
            const sq = squareToReach(board, f, infusion ? 10 : 5, 1);
            if (sq && sq.route.actions === 1) {
                const at = { ...me.rect, x: sq.x, y: sq.y };
                const op2 = opener(f, at);
                const left2 = ctx.actions - 1 - op2.cost;
                const r2 = blastRun(f, at, left2, ctx.made + op2.made, { quick: pinnacle && (ctx.actions <= 3 || left2 > 3) });
                if (r2.steps.length && op2.ev + r2.ev > (plan?.ev ?? 0) + 0.5) push({ title: `Close in and blast ${nameOf(f)} in melee`, target: f, ev: op2.ev + r2.ev, dest: { x: sq.x, y: sq.y }, steps: [{ cost: 1, text: moveText(sq, f) }, ...op2.steps, ...r2.steps], notes: [`A melee blast adds your Strength (+${str}) to each hit${sq.route.provokes.length ? "; the move provokes" : ""}.`] });
            }
        }
        // Out of range from here (an element's blast range is a maximum, not an increment): one Stride into range first
        if (!r.steps.length && !op.ev && canMove(me) && ctx.actions >= 2) {
            const far = Math.max(...elements.map((el) => ELEMENTS[el].range));
            const sq = squareToReach(board, f, far, 1);
            if (sq && sq.route.actions === 1) {
                const at = { ...me.rect, x: sq.x, y: sq.y };
                const op2 = opener(f, at);
                const left2 = ctx.actions - 1 - op2.cost;
                const r2 = blastRun(f, at, left2, ctx.made + op2.made, { quick: pinnacle && (ctx.actions <= 3 || left2 > 3) });
                if (r2.steps.length || op2.ev) push({ title: `Move into range and blast ${nameOf(f)}`, target: f, ev: op2.ev + r2.ev, dest: { x: sq.x, y: sq.y }, steps: [{ cost: 1, text: `${sq.route.via ?? "Stride"} to within ${far} feet of ${nameOf(f)}` }, ...op2.steps, ...r2.steps], notes: [`Your blasts reach ${far} feet and no farther${sq.route.provokes.length ? "; the move provokes" : ""}.`] });
            }
        }
        if (plan) push(plan);
    }
    // Chain Infusion (1 action, level 10): a ranged blast that jumps to the next foe each time it hits, the penalty climbing; one damage roll
    if (has(actor, "chain-infusion") && foes.length >= 2 && ctx.actions >= 2) {
        for (const f of foes) {
            const op = opener(null, me.rect);
            let bestChain = null;
            for (const cost of [1, 2]) {
                if (op.cost + 1 + cost > ctx.actions) continue;
                const first = bestBlast(f, me.rect, ctx.made, cost);
                if (!first || first.melee) continue;
                const range = ELEMENTS[first.el].range;
                let ev = first.e.expected, p = first.e.hit, made = ctx.made + 1, from = f;
                const chain = [];
                const left = foes.filter((g) => g !== f).sort((a, b) => feetBetween(f.rect, a.rect) - feetBetween(f.rect, b.rect));
                for (const g of left) {
                    if (chain.length >= 4 || feetBetween(from.rect, g.rect) > range) continue;
                    const e = strikeExpected(impulseMod + mapFor(made), g.ac, first.avg, { delta: fireWeak(g, blastTypes(first.el)) });
                    ev += p * e.expected; p *= e.hit; made += 1; from = g;
                    chain.push(`${nameOf(g)} (${signed(impulseMod + mapFor(made - 1))})`);
                }
                if (!chain.length) continue;
                const steps = [...op.steps, { cost: 1 + cost, text: `Chain Infusion, then ${first.text}; on a hit it jumps to ${chain.join(", then ")}, one damage roll for all` }];
                const r = blastRun(f, me.rect, ctx.actions - op.cost - 1 - cost, made, {});
                const plan = { title: `Chain Infusion through ${1 + chain.length} foes`, target: f, ev: op.ev + ev + r.ev, bias: 0.4, steps: [...steps, ...r.steps], notes: ["Each jump needs the blast before it to hit; the chain's later blasts carry your full penalty."] };
                if (!bestChain || plan.ev > bestChain.ev) bestChain = plan;
            }
            if (bestChain) push(bestChain);
        }
    }

    // ---- Impulses on the sheet: areas placed on the board, single targets, attacks, heals
    const dmgParts = (imp) => (imp.dmg ? imp.dmg(lv).filter(([n]) => n > 0) : []);
    const avgOf = (imp, parts = dmgParts(imp), twoAction = imp.cost >= 2) => parts.reduce((t, [n, d, flat, type, pers]) => {
        // the fire impulse junction: 2-action fire impulses roll one die size bigger
        const dd = twoAction && type === "fire" && junctions.fire?.has("impulse") && d < 12 ? d + 2 : d;
        return t + (dAvg(n, dd) + flat) * (pers ? 1.5 : 1);
    }, 0);
    const typesOf = (imp) => [...new Set(dmgParts(imp).map((p) => p[3]).filter((t) => t && t !== "untyped"))];
    const dmgText = (imp) => dmgParts(imp).map(([n, d, flat, type, pers]) => `${n}d${(imp.cost >= 2 && type === "fire" && junctions.fire?.has("impulse") && d < 12) ? d + 2 : d}${flat ? `+${flat}` : ""}${pers ? " persistent" : ""} ${type}`).join(" plus ");
    const dcText = (imp) => (imp.save ? `${imp.basic === false ? "" : "basic "}${cap(imp.save)} DC ${classDC}` : "");
    /** Expected worth of the impulse on one foe from its save. */
    const saveWorth = (imp, f, avg, types) => {
        if (imp.immuneTraits?.some((t) => (f.traits ?? []).includes(t))) return 0;
        const dmg = damageAgainst(f.iwr, types);
        const delta = (dmg.immune ? 0 : dmg.delta) + fireWeak(f, types);
        const shift = imp.incap && (f.level ?? 0) > lv ? 1 : 0;
        const c = degreeChances(f.saves?.[imp.save] ?? 8, classDC, shift);
        const hurt = (x) => (dmg.immune || x <= 0 ? 0 : Math.max(0, x + delta));
        let ev = 0;
        if (imp.degrees) { const d = imp.degrees(avg, board); ev = c.cs * d.cs + c.s * d.s + c.f * d.f + c.cf * d.cf; }
        else if (imp.basic === false) ev = (c.f + c.cf) * hurt(avg);
        else ev = c.cf * hurt(avg * 2) + c.f * hurt(avg) + c.s * hurt(avg / 2);
        if (imp.rider) ev += imp.rider(c, board, f, lv);
        return ev;
    };
    /** Places an area and sums what it does: foes caught, allies caught (Safe Elements spares up to Con of them), you in a burst. */
    const placeArea = (imp, area, at) => {
        const types = typesOf(imp);
        const avg = avgOf(imp);
        const judge = (hits, origin) => {
            const caught = hits.enemies.filter((e) => e.state !== "hidden");
            if (!caught.length) return null;
            let ev = caught.reduce((t, f) => t + saveWorth(imp, f, avg, types), 0);
            const allies = imp.allySafe || imp.enemyOnly ? [] : hits.allies.filter((a) => a.canAct !== false);
            const spared = Math.min(allies.length, safe);
            const hurtAllies = allies.slice(spared);
            ev -= hurtAllies.length * avg * 0.5 * 1.5;
            if (imp.terrain) ev += caught.length;
            const selfIn = origin && area.shape === "burst" && feetBetween(at, { x: origin.x, y: origin.y, w: 0, h: 0 }) <= area.size;
            if (selfIn) ev -= avg * 0.5;
            if (imp.drain) ev += hits.allies.reduce((t, a) => t + 0.8 * Math.min(Math.max(0, (a.maxHp ?? 0) - (a.hp ?? 0)), avg / 2), 0);
            return { caught, allies: hurtAllies, spared: allies.slice(0, spared), selfIn, ev };
        };
        let best = null;
        const consider = (hits, origin, aimText) => { const j = judge(hits, origin); if (j && (!best || j.ev > best.ev)) best = { ...j, aimText }; };
        if (area.shape === "emanation") consider(areaHits(board, "emanation", area.size, { at }), null, "around you");
        else if (area.shape === "burst") {
            const seen = new Set();
            for (const e of foes) for (const [x, y] of [[e.rect.x, e.rect.y], [e.rect.x + e.rect.w, e.rect.y], [e.rect.x, e.rect.y + e.rect.h], [e.rect.x + e.rect.w, e.rect.y + e.rect.h]]) {
                const k = `${x},${y}`; if (seen.has(k)) continue; seen.add(k);
                const pt = { x, y, w: 1, h: 1, z: e.rect.z ?? 0 };
                if (imp.range && feetBetween(at, pt) > imp.range) continue;
                consider(areaHits(board, "burst", area.size, { origin: { x, y }, originZ: e.rect.z ?? 0, at }), { x, y }, `centred by ${nameOf(e)}`);
            }
        } else for (const e of foes) consider(areaHits(board, area.shape, area.size, { aim: centerOf(e.rect), at }), null, `toward ${nameOf(e)}`);
        return best;
    };
    const areaOf = (imp) => (typeof imp.area === "function" ? imp.area(lv) : imp.area);
    /** Composes a plan around an impulse: Channel first when the aura is down, blasts with the actions left, the overflow impulse last. */
    const compose = (imp, f, at, { ev, cost = imp.cost, text, notes = [], dest = null, moveSteps = [], madeAfter = 0, title }) => {
        const moveCost = moveSteps.reduce((t, s) => t + s.cost, 0);
        const op = opener(f, at);
        const left = ctx.actions - op.cost - cost - moveCost;
        if (left < 0) return;
        const made = ctx.made + op.made;
        const r = f ? blastRun(f, at, left, made + (imp.overflow ? 0 : madeAfter), {}) : { steps: [], ev: 0 };
        const impulseStep = { cost, text: `${text}${imp.overflow ? "; overflow: your aura ends" : ""}` };
        const steps = imp.overflow ? [...op.steps, ...moveSteps, ...r.steps, impulseStep] : [...op.steps, ...moveSteps, impulseStep, ...r.steps];
        const total = op.ev + r.ev + ev - (imp.overflow ? overflowCost : 0);
        const n = notes.slice();
        if (imp.overflow) n.push(`Overflow ends your kinetic aura${stanceSlug ? ` and ${stanceName}` : ""}: it goes last, and next turn starts with Channel Elements (${finalGate ? "free with Final Gate" : "1 action"}${isClass ? ", with its free blast" : ""}); the plan's value takes that off (${round1(overflowCost)}).`);
        if (imp.sustain) n.push(`${imp.sustain}.`);
        if (imp.tail) n.push(`${cap(imp.tail)}.`);
        push({ title: title ?? `${imp.name} on ${nameOf(f)}`, target: f, ev: total, bias: 0.3, dest, steps, notes: n });
    };
    const impulsesOnSheet = [];
    for (const [key, imp] of Object.entries(IMPULSES)) { if (!imp) continue; const slug = key.split(":")[0]; if (has(actor, slug)) impulsesOnSheet.push({ key, slug, imp }); }
    for (const { imp } of impulsesOnSheet) {
        if (ctx.actions < imp.cost + (auraOn || finalGate ? 0 : 1)) continue;
        if (!foes.length && !imp.heal) continue;
        // Heals: the most-hurt ally it reaches
        if (imp.heal) {
            const hurt = board.allies.filter((a) => (a.maxHp ?? 0) > (a.hp ?? 0) && a.canAct !== false);
            const amount = imp.healAvg(lv);
            if (imp.area) {
                const area = areaOf(imp);
                let best = null;
                const targetsAll = [...board.allies, ...foes];
                const tryHits = (hits, where) => {
                    const healed = hits.allies.reduce((t, a) => t + 0.8 * Math.min(Math.max(0, (a.maxHp ?? 0) - (a.hp ?? 0)), amount), 0);
                    const foesIn = hits.enemies.filter((e) => e.state !== "hidden");
                    const ev = healed - (imp.dazzle ? 0 : foesIn.length * amount * 0.8) + (imp.dazzle ? foesIn.reduce((t, f) => t + worth(board, "dazzled", 0.7), 0) : 0);
                    if (ev > 0.5 && (!best || ev > best.ev)) best = { ev, healed, allies: hits.allies, foesIn, where };
                };
                if (area.shape === "cone") for (const a of hurt) tryHits(areaHits(board, "cone", area.size, { aim: centerOf(a.rect), at: me.rect }), `toward ${nameOf(a)}`);
                else for (const c of targetsAll) if (!imp.range || feetBetween(me.rect, c.rect) <= imp.range) tryHits(areaHits(board, "burst", area.size, { origin: { x: c.rect.x, y: c.rect.y }, originZ: c.rect.z ?? 0, at: me.rect }), `around ${nameOf(c)}`);
                if (best) compose(imp, best.foesIn[0] ?? foes[0] ?? null, me.rect, { ev: best.ev, title: `${imp.name}: heal ${best.allies.map(nameOf).join(", ")}`, text: `${imp.name} (${area.size}-foot ${area.shape} ${best.where}): about ${Math.round(amount)} HP to ${best.allies.map(nameOf).join(", ")}${best.foesIn.length ? `${imp.dazzle ? ", dazzling" : ", and healing"} ${best.foesIn.map(nameOf).join(", ")}` : ""}` });
                continue;
            }
            const reach = imp.from === "aura" ? auraRadius : imp.range ?? 30;
            const ally = hurt.filter((a) => feetBetween(me.rect, a.rect) <= reach).sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0];
            if (!ally) continue;
            const ev = 0.8 * Math.min(ally.maxHp - ally.hp, amount) * (imp.from === "aura" ? 0.8 : 1);
            compose(imp, foes[0] ?? null, me.rect, { ev, title: `${imp.name}: heal ${nameOf(ally)}`, text: `${imp.name} on ${nameOf(ally)} (${ally.hp}/${ally.maxHp} HP): about ${Math.round(amount)} HP back` });
            continue;
        }
        const avg = avgOf(imp);
        const types = typesOf(imp);
        if (imp.area) {
            const area = areaOf(imp);
            // from where you stand; a cone, line or emanation also from a square one move away when that catches more
            const spots = [{ at: me.rect, sq: null }];
            if (canMove(me) && ctx.actions >= imp.cost + 1 + (auraOn || finalGate ? 0 : 1) && (imp.from === "self" || imp.from === "leap")) for (const sq of reachableSquares(board, 1)) if (sq.route.actions === 1) spots.push({ at: { ...me.rect, x: sq.x, y: sq.y }, sq });
            let best = null;
            for (const sp of spots) {
                const p = placeArea(imp, area, sp.at);
                if (!p) continue;
                const moveCost = sp.sq && imp.from !== "leap" ? 1 : 0;
                const ev = p.ev - moveCost * 0.5 - (sp.sq?.route.provokes.length ? 2 : 0);
                if (!best || ev > best.ev) best = { ...p, ev, sp, moveCost };
            }
            if (!best) continue;
            const names = best.caught.map(nameOf).join(", ");
            const notes = [];
            if (best.allies.length) notes.push(`It also catches ${best.allies.map(nameOf).join(", ")}; the value takes that off.`);
            if (best.spared.length) notes.push(`Pacifying Infusion (free) first: ${best.spared.map(nameOf).join(", ")} are spared as your Safe Elements picks, and the impulse is nonlethal.`);
            if (best.selfIn) notes.push("You stand in it yourself.");
            if (imp.again) notes.push("The value counts half of a second round of it.");
            const moveSteps = best.sp.sq ? [{ cost: best.moveCost, text: imp.from === "leap" ? `Lava Leap carries you to ${best.sp.sq.x},${best.sp.sq.y} (up to your Speed, as part of the impulse)` : `${best.sp.sq.route.via ?? "Stride"} to ${best.sp.sq.x},${best.sp.sq.y} to line it up` }] : [];
            compose(imp, best.caught[0], best.sp.at, { ev: best.ev * (imp.again ? 1 + imp.again : 1), title: `${imp.name}: ${best.caught.length} foe${best.caught.length === 1 ? "" : "s"}`, dest: best.sp.sq ? { x: best.sp.sq.x, y: best.sp.sq.y } : null, moveSteps, notes,
                text: `${imp.name} (${area.size}-foot ${area.shape} ${best.aimText}) catching ${names}: ${dcText(imp)}, ${dmgText(imp)}` });
            continue;
        }
        if (imp.kind === "target" || imp.kind === "pass") {
            for (const f of foes) {
                const reach = imp.kind === "pass" ? stride : imp.range ?? 30;
                if (feetBetween(me.rect, f.rect) > reach) continue;
                const ev = saveWorth(imp, f, avg, types);
                if (ev <= 0) continue;
                compose(imp, f, me.rect, { ev, text: `${imp.name} on ${nameOf(f)}: ${dcText(imp)}${dmgParts(imp).length ? `, ${dmgText(imp)}` : ""}` });
            }
            continue;
        }
        if (imp.kind === "attack") {
            for (const f of foes) {
                if (feetBetween(me.rect, f.rect) > (imp.range ?? 30)) continue;
                const op = opener(f, me.rect);
                const bonus = impulseMod + mapFor(ctx.made + op.made);
                const dmg = damageAgainst(f.iwr, types);
                const e = strikeExpected(bonus, f.ac, avg, { delta: dmg.immune ? 0 : dmg.delta + fireWeak(f, types), immune: dmg.immune });
                const ev = e.expected + (imp.onHit ? e.hit * imp.onHit(board) : 0);
                compose(imp, f, me.rect, { ev, madeAfter: 1, text: `${imp.name} at ${nameOf(f)}: impulse attack ${signed(bonus)}, ${dmgText(imp)}` });
            }
            continue;
        }
        if (imp.kind === "pinions") {
            const near = foes.filter((f) => feetBetween(me.rect, f.rect) <= 60);
            if (!near.length) continue;
            const op = opener(near[0], me.rect);
            const bonus = impulseMod + mapFor(ctx.made + op.made);
            const picks = near.map((f) => ({ f, e: strikeExpected(bonus, f.ac, avg, damageAgainst(f.iwr, types)) })).sort((a, b) => b.e.expected - a.e.expected).slice(0, 3);
            compose(imp, picks[0].f, me.rect, { ev: picks.reduce((t, p) => t + p.e.expected, 0), title: `Magnetic Pinions at ${picks.length} foe${picks.length === 1 ? "" : "s"}`, text: `Magnetic Pinions: ranged impulse attacks at ${picks.map((p) => nameOf(p.f)).join(", ")}, all at ${signed(bonus)} (+1 against metal armor), ${dmgText(imp)} each` });
            continue;
        }
        if (imp.kind === "rod") {
            for (const f of foes) {
                const op = opener(f, me.rect);
                const b = bestBlast(f, me.rect, ctx.made + op.made, 2);
                if (!b) continue;
                const die = ELEMENTS.metal.die;
                const metalAvg = dAvg(b.dice, die) + (b.melee ? str : 0) + con;
                const e = strikeExpected(b.bonus, f.ac, metalAvg + avg, {});
                compose(imp, f, me.rect, { ev: e.expected + e.hit * 1.5, madeAfter: 1, text: `Lightning Rod: a 2-action metal blast at ${nameOf(f)} (${b.melee ? "melee" : "ranged 30 ft"}, ${signed(b.bonus)}, ${b.dice}d${die}+${Math.round(metalAvg - dAvg(b.dice, die))}) plus ${dmgText(imp)} on a hit; the rod gives it -1 to AC and saves against electricity (-2 if it's metal)` });
            }
            continue;
        }
        if (imp.kind === "snatcher") {
            for (const f of foes) {
                if (feetBetween(me.rect, f.rect) > 35 || (f.sizeRank ?? 2) > 3) continue;
                const op = opener(f, me.rect);
                const bonus = impulseMod + mapFor(ctx.made + op.made);
                const c = degreeChances(bonus, 10 + (f.saves?.fortitude ?? 8));
                const flank = board.allies.some((a) => a.hasMelee !== false && inReach(a.rect, f.rect, a.reach ?? 5)) ? 1.5 : 0;
                compose(imp, f, me.rect, { ev: c.s * worth(board, "grabbed") + c.cs * worth(board, "restrained") + flank, madeAfter: 1, text: `Sand Snatcher next to ${nameOf(f)}: it Grapples with your impulse attack (${signed(bonus)} vs Fortitude DC ${10 + (f.saves?.fortitude ?? 8)})${flank ? " and flanks with your ally" : ""}`, notes: ["Sustain it (1 action) each turn to Grapple again or move it 20 feet; its Escape DC is your class DC."] });
            }
            continue;
        }
        if (imp.kind === "trees") {
            const atk = lv >= 20 ? 32 : 30, dmgAvg = dAvg(lv >= 20 ? 5 : 4, 10) + 9;
            let ev = 0;
            const shots = [];
            for (let i = 0; i < 3; i++) {
                let best = null;
                for (const f of foes) { const e = strikeExpected(atk - 5 * i, f.ac, dmgAvg); if (!best || e.expected > best.e.expected) best = { f, e }; }
                if (!best) break;
                ev += best.e.expected; shots.push(`${nameOf(best.f)} (${signed(atk - 5 * i)})`);
            }
            if (shots.length) compose(imp, foes[0], me.rect, { ev, title: "Rouse the Forest's Fury", text: `Rouse the Forest's Fury: three trees rise by your foes and Strike ${shots.join(", ")} for ${lv >= 20 ? "5d10+9" : "4d10+9"}; a branch hit grabs`, notes: ["Sustain it (1 action) each turn for one more tree Strike; the trees flank for your allies."] });
            continue;
        }
        if (imp.kind === "extract") {
            for (const f of foes) {
                const el = elements.find((e) => (f.traits ?? []).includes(e));
                if (!el || feetBetween(me.rect, f.rect) > 30) continue;
                const c = degreeChances(f.saves?.fortitude ?? 8, classDC);
                const ev = c.cf * avg * 2 + c.f * avg + c.s * avg / 2 + (c.s + c.f + c.cf) * 2;
                compose(imp, f, me.rect, { ev, text: `Extract Element from ${nameOf(f)} (it has the ${el} trait): Fortitude DC ${classDC}, ${dmgText(imp)}; anything but a critical success strips its ${el} immunities and resistances against your impulses and gives it -1 to AC and saves against them` });
            }
        }
    }

    // ---- A stance as Channel's free action (or 1 action with the aura up) when it pays more than a blast
    {
        const sctx = { foesInAura, alliesInAura, hiddenFoes: board.enemies.some((e) => e.state === "hidden") };
        const near = foes.slice().sort((a, b) => feetBetween(me.rect, a.rect) - feetBetween(me.rect, b.rect))[0];
        for (const [slug, st] of Object.entries(STANCES)) {
            if (!has(actor, slug) || (activeStance && activeStance[0] === slug)) continue;
            const text = typeof st.text === "function" ? st.text(lv) : st.text;
            const value = st.value(sctx, lv, board);
            const name = st.name;
            const cost = st.cost ?? 1;
            if (value < Math.max(1.5, yardstick * 0.9)) { out.notes.push(`${name} (${cost} action${cost > 1 ? "s" : ""}, stance): ${text}; it pays when ${st.pays}.`); continue; }
            if (!auraOn && isClass && cost === 1) {
                const op = opener(near ?? null, me.rect, { name, text, ev: value });
                const r = near ? blastRun(near, me.rect, ctx.actions - op.cost, ctx.made, {}) : { steps: [], ev: 0 };
                push({ title: `Channel Elements into ${name}`, target: near ?? null, ev: op.ev + r.ev, bias: 0.3, steps: [...op.steps, ...r.steps], notes: [`${name} counts ${round1(value)} here with ${foesInAura} foe${foesInAura === 1 ? "" : "s"} and ${alliesInAura} all${alliesInAura === 1 ? "y" : "ies"} in your aura.`] });
            } else if (ctx.actions >= cost + (auraOn || finalGate ? 0 : 1)) {
                const op = opener(null, me.rect);
                const r = near ? blastRun(near, me.rect, ctx.actions - op.cost - cost, ctx.made, {}) : { steps: [], ev: 0 };
                push({ title: `Enter ${name}`, target: near ?? null, ev: op.ev + value + r.ev, bias: 0.3, steps: [...op.steps, { cost, text: `${name}: ${text}${activeStance ? ` (it replaces ${stanceName})` : ""}` }, ...r.steps] });
            }
        }
    }

    // ---- Notes: the gate, the aura, the junctions, what the sheet carries
    const elText = elements.map((el) => `${cap(el)} (${blastDice + extraDice(el)}d${ELEMENTS[el].die}, ${ELEMENTS[el].range} feet, ${blastTypes(el).join(" or ")})`).join("; ");
    out.notes.push(`${auraOn ? `Your kinetic aura is up (${auraRadius} feet)${stanceEffect ? `, in ${stanceName}` : ""}` : `Your kinetic aura is down: Channel Elements first (${finalGate ? "free as your first action" : "1 action"}${isClass ? ", with a free 1-action blast or stance" : ""})`}. Blasts: ${elText}; impulse attack ${signed(impulseMod)}, class DC ${classDC}; a melee blast adds your Strength (+${str}), a 2-action blast adds your Constitution (+${con}).`);
    for (const el of elements) {
        const j = junctions[el];
        if (!j.size) continue;
        const parts = [];
        if (j.has("impulse")) parts.push(ELEMENTS[el].impulse);
        if (j.has("critical")) parts.push(ELEMENTS[el].crit);
        if (j.has("aura")) parts.push(ELEMENTS[el].aura);
        if (j.has("resistance")) parts.push(`you resist ${ELEMENTS[el].resist} ${lv} while the aura is up${lv >= 17 ? ", and you're immune to effects with those traits" : ""}`);
        if (j.has("skill")) parts.push(`+${lv >= 17 ? 3 : lv >= 10 ? 2 : 1} to ${ELEMENTS[el].skill} while the aura is up`);
        out.notes.push(`${cap(el)} junctions: ${parts.join("; ")}.`);
    }
    if (!auraOn && !finalGate && foes.length) out.notes.push("No impulse works until the aura is up; the plans start with Channel Elements.");
    if (versatile) out.notes.push(`Versatile Blasts: ${elements.map((el) => `${el} blasts can be ${ELEMENTS[el].versatile}`).join(", ")}; pick the type a foe is weak to.`);
    if (infusion) out.notes.push("Weapon Infusion (free, before a blast): a melee blast can be agile, reach, forceful, sweep or backswing; a ranged one a 100-foot bow (volley 30), a 50-foot propulsive shot (half your Strength) or a 20-foot thrown one (full Strength); the type can turn physical. The plans already pick the best shape.");
    if (twoElement) out.notes.push("Two-Element Infusion (free): a blast of two elements takes the bigger die and the longer range, splits its damage between the two types and gets both elements' junction riders; the plans use it.");
    if (has(actor, "chain-infusion") && foes.length < 2) out.notes.push("Chain Infusion (1 action): a ranged blast that hits jumps to another foe in range of the one it hit, up to five, one damage roll; it pays with two or more foes near each other.");
    if (safe) out.notes.push(`Safe Elements: when you Channel or enter a stance, name up to ${safe} creatures that your aura spares; Pacifying Infusion (free) then keeps them out of an area impulse, which becomes nonlethal.`);
    if (has(actor, "aura-shaping")) out.notes.push(`Aura Shaping: your aura can be 5 to ${lv >= 20 ? 30 : lv >= 15 ? 25 : 20} feet; choose it when you Channel or enter a stance (small to keep allies out of a harmful one, wide for a helpful one).`);
    if (has(actor, "extract-element") && !foes.some((f) => elements.some((el) => (f.traits ?? []).includes(el)))) out.notes.push(`Extract Element (1 action, 30 feet): against a creature with the ${elements.join(" or ")} trait, ${Math.ceil(lv / 2)}d4 on a Fortitude save, and it loses its immunity and resistance to your impulses with -1 to AC and saves against them.`);
    if (has(actor, "kinetic-activation")) out.notes.push(`Kinetic Activation: you can use scrolls, wands and staves of ${elements.join(" or ")} spells with your impulse attack and class DC.`);
    if (has(actor, "elemental-overlap")) out.notes.push("Elemental Overlap: the composite impulse it gave works without its second element.");
    if (lv >= 11 && isClass) out.notes.push(`Reflow Elements: at daily preparations you can swap ${lv >= 17 ? "two impulse feats" : "one impulse feat"} for others of the same element${has(actor, "rapid-reattunement") ? ", or in 10 minutes with Rapid Reattunement" : ""}${has(actor, "omnikinesis") ? "; Omnikinesis does it as a single action in the fight" : ""}.`);
    if (finalGate) out.notes.push("Final Gate: your aura rises free at the start of each turn it's down, with the free blast or stance; you can suppress it.");
    if (pinnacle) out.notes.push("Kinetic Pinnacle: you're quickened; the extra action only Channels, makes a 1-action blast or enters a 1-action stance. The plans add a blast for it.");
    if (has(actor, "effortless-impulse")) out.notes.push("Effortless Impulse (free, at the start of your turn): Sustain one of your impulses without an action.");
    if (has(actor, "imperious-aura")) out.notes.push("Imperious Aura (free, at the start of your turn): enter a stance impulse that affects your aura without an action; the stance plans cost nothing with it.");
    if (has(actor, "elemental-transformation")) { const uses = usesLeft(actor, "elemental-transformation"); out.notes.push(`Elemental Transformation (1 action, once a day${uses != null ? `, ${uses} left` : ""}, aura down): elemental form heightened to rank ${Math.ceil(lv / 2)} instead of your aura; for a fight where the form's attacks and flight beat your impulses.`); }
    // impulses the read doesn't score: when they pay
    const n = (slug, text) => { if (has(actor, slug)) out.notes.push(text); };
    n("burning-jet", `Burning Jet (2 actions): a straight 40-foot Stride${lv >= 6 ? " or a 40-foot Leap in any direction" : ""} that ignores difficult terrain and triggers no reactions; the way out of a surrounded spot.`);
    n("four-winds", `Four Winds (2 actions): up to four willing creatures within 30 feet Stride ${lv >= 10 ? "their Speed" : "half their Speed"}; moves the party into place when the fight starts.`);
    n("stepping-stones", "Stepping Stones (2 actions): a 20-foot path over water, chasms or difficult terrain within 60 feet.");
    n("armor-in-earth", `Armor in Earth (1 action, 10 minutes): stone ${lv >= 3 ? "heavy armor (+5 AC, bulwark)" : "medium armor (+4 AC)"} with your best armor proficiency; put it on before the fight.`);
    n("hardwood-armor", "Hardwood Armor (1 action, 10 minutes): +3 AC medium armor and a wooden shield you can Shield Block with; the shield hand still counts as free for impulses.");
    n("metal-carapace", "Metal Carapace (1 action, 10 minutes): +3 AC medium armor and a steel shield you can Shield Block with; the shield hand still counts as free for impulses.");
    n("timber-sentinel", "Timber Sentinel (2 actions): a protector tree within 30 feet that takes the hits meant for the creatures next to it.");
    n("eternal-torch", "Eternal Torch (1 action): a lasting light within 120 feet, up to your Constitution modifier of them.");
    n("flashforge", "Flashforge (2 actions): a level-0 metal weapon or tool in your or an ally's hands for 10 minutes.");
    n("whisper-on-the-wind", "Whisper on the Wind (1 action): a message to a named creature far away.");
    n("rain-of-rust", `Rain of Rust (3 actions): a 10-foot burst within 60 feet that only bites metal: creatures made of metal or in metal armor are clumsy 1 in it and take ${F(Math.max(0, lv - 4), 2) + 3}d6 (basic Fortitude) at the start of each turn there, ignoring Hardness; worth it against armored foes.`);
    n("living-bonfire", `Living Bonfire (2 actions): a bonfire within 30 feet; your wood ranged blasts can fly from it with +${F(Math.max(0, lv - 4), 5) + 1}d6 fire, shrinking it each time.`);
    n("igneogenesis", "Igneogenesis (2 actions): a stone block in a square next to you, cover or a step up.");
    n("plate-in-treasure", "Plate in Treasure (1 action): a metal item you hold gets the plating a creature with a weakness needs.");
    n("return-to-the-sea", `Return to the Sea (2 actions): ${lv >= 6 ? "up to five creatures" : "a creature"} swims, breathes water and gets +1 AC and saves against aquatic foes for 10 minutes.`);
    n("born-to-the-trees", `Born to the Trees (2 actions): ${lv >= 6 ? "up to five creatures" : "a creature"} climbs at full Speed and Leaps farther for 10 minutes.`);
    n("command-elemental", `Command Elemental (2 actions, Will DC ${classDC}): an elemental of your element within 30 feet of level ${lv - 3} or lower is controlled while you Sustain it; a higher one is slowed 1.`);
    n("crawling-fire", "Crawling Fire (2 actions): a fire beast within 30 feet your fire impulses can start from; Sustain it to move it 40 feet, so your cones and lines reach around corners.");
    n("sand-snatcher", "Sand Snatcher is planned when a foe within 30 feet can be grabbed.");
    n("flinging-updraft", `Flinging Updraft (2 actions, Reflex DC ${classDC}): a creature within 60 feet jumps up to ${30 + 15 * F(Math.max(0, lv - 6), 2)} feet where you say (half on a failure); throw a foe off a ledge or out of reach, or move an ally for free.`);
    n("jagged-berms", `Jagged Berms (3 actions, overflow): up to six mounds of cover within 120 feet with stakes that do ${F(Math.max(0, lv - 6), 2) + 2}d6 piercing per square entered; a wall when your allies need it, and it ends your aura.`);
    n("scrap-barricade", "Scrap Barricade (3 actions, overflow): a 30-foot metal wall within 120 feet that cuts everyone next to it when a section breaks; it ends your aura.");
    n("wooden-palisade", "Wooden Palisade (3 actions, overflow): a 30-foot wooden wall with ledges within 120 feet; it ends your aura.");
    n("clear-as-air", `Clear as Air (2 actions, overflow): invisible until the end of your next turn${lv >= 10 ? ", concealed after a hostile action" : ", ending on a hostile action"}; it ends your aura, so it's for getting away, not for setting up.`);
    n("fearsome-familiar", `Fearsome Familiar (3 actions): your familiar becomes an elemental of level ${lv - 4} or lower while you Sustain it; a second use in a day kills the familiar.`);
    n("tree-of-duality", "Tree of Duality is planned where it heals allies or dazzles foes.");
    n("cyclonic-ascent", `Cyclonic Ascent (2 actions): fly ${Math.max(30, stride)} feet for 10 minutes${lv >= 14 ? ", and five others fly too" : ""}; you stay aloft on a turn you used an air impulse.`);
    n("swim-through-earth", "Swim Through Earth (2 actions): burrow at your Speed while you Sustain it; coming out early leaves you slowed 1.");
    n("spike-skin", `Spike Skin (2 actions, touch): resistance ${4 + 2 * F(Math.max(0, lv - 8), 2)} to physical damage for 10 minutes and ${Math.max(2, F(Math.max(0, lv - 8), 2) * 2 + 2)} piercing back at anything that hits the target in melee; put it on the front-liner before the fight.`);
    n("impenetrable-fog", "Impenetrable Fog (3 actions, overflow): a 10-foot fog bank within 120 feet, concealment and difficult terrain inside; it ends your aura.");
    n("purify-element", "Purify Element (2 actions): cleans a cubic foot of your element, counteracting poisons and curses in it.");
    n("architect-of-flame", `Architect of Flame (3 actions, overflow): a wall of fire within 120 feet, up to 60 feet high, while you Sustain it; it ends your aura.`);
    n("rattle-the-earth", `Rattle the Earth (2 actions, overflow): an earthquake in a 60-foot cone or your aura's reach that you're spared from; foes fall, lose actions and risk the fissures (Reflex DC ${classDC}). It ends your aura.`);
    n("rock-rampart", "Rock Rampart (3 actions, overflow): a 40-foot stone wall while you Sustain it; it ends your aura.");
    n("hedge-maze", "Hedge Maze (3 actions, overflow): ten hedges of cover and difficult terrain in a 30-foot square within 120 feet; it ends your aura.");
    n("furnace-form", `Furnace Form (2 actions): a fire elemental form until your next turn (Sustain to keep it and fly 20 feet), your fire blasts roll one more die; ${effect(actor, /^effect-furnace-form/) ? "it's on now and the plans count the die" : "two actions that pay back over a few blast turns"}.`);
    n("wiles-on-the-wind", `Wiles on the Wind (2 actions, Will DC ${classDC}): a sound within 500 feet that fascinates those who fail within 40 feet of it; draws guards away rather than winning a fight.`);
    n("alloy-flesh-and-steel", `Alloy Flesh and Steel (2 actions): a metal body until your next turn (Sustain to keep it, raising a metal shield as you do), your metal blasts roll one more die; ${effect(actor, /^effect-alloy-flesh-and-steel/) ? "it's on now and the plans count the die" : "for a turn you expect to be hit"}.`);
    n("barrier-of-boreal-frost", "Barrier of Boreal Frost (3 actions, overflow): an ice wall while you Sustain it; it ends your aura.");
    n("liberating-dive", `Liberating Dive (2 actions): fly ${Math.max(40, stride)} feet without reactions, a 1-action melee metal blast on a foe you pass and a free Escape or new save for an ally you pass; the move that frees a grabbed ally.`);
    n("rebirth-in-living-stone", `Rebirth in Living Stone (1 action): ${lv >= 20 ? 50 : 40} temporary HP, immunity to critical hits and precision, and +1d10 on your earth blasts until your next turn (Sustain to keep it); ${effect(actor, /^effect-rebirth-in-living-stone/) ? "it's on now" : "the first action of a turn you'll be hit"}.`);
    n("beasts-of-slumbering-steel", "Beasts of Slumbering Steel (3 actions): steel mounts for five allies, 80 feet on land or 60 feet climbing, flying or swimming, for a minute.");
    n("infinite-expanse-of-bluest-heaven", `Infinite Expanse of Bluest Heaven (3 actions, overflow, Will DC ${classDC}): a 20-foot burst within 100 feet where those who fail are off-guard and can't find their way out; it ends your aura.`);
    n("turn-the-wheel-of-seasons", "Turn the Wheel of Seasons (3 actions, overflow): four rounds of seasons over a 100-foot cube: temporary HP for allies, sunlight and slowing for foes, cold damage; it ends your aura.");
    n("usurp-the-lunar-reins", "Usurp the Lunar Reins (3 actions, overflow): floods, tides and waves over a 50-foot area within 500 feet; it ends your aura.");
    n("elemental-apotheosis", "Elemental Apotheosis: you have the elemental's Speeds and darkvision, and the elemental trait.");
    n("nourishing-gate", "Nourishing Gate: +2 to saves against poison, sleep and fatigue.");
    // reactions: when they fire
    n("air-cushion", `Air Cushion (reaction): when a creature within ${lv >= 8 ? 120 : 60} feet falls, it lands unhurt${lv >= 8 ? "; up to five of them" : ""}.`);
    n("deflecting-wave", `Deflecting Wave (reaction): when an enemy's attack or effect would do bludgeoning or slashing damage to you, resist ${lv} of it; acid or fire, ${2 * lv}.`);
    n("calcifying-sand", `Calcifying Sand (reaction, overflow): when an unarmed or short melee attack damages you, resist ${lv} of it and the attacker saves (Fortitude DC ${classDC}) or is slowed 1 (petrified on a critical failure); it ends your aura, so save it for a turn your aura is already going down.`);
    n("consume-power", `Consume Power (reaction): when you'd take acid, electricity, fire or sonic damage, resist ${lv} of it; if it stopped any, your next metal impulse by the end of your next turn gets +${F(lv, 2)} damage.`);
    n("counter-element", `Counter Element (reaction): when an enemy's ${elements.join(" or ")} effect targets or catches you, counteract it with your class DC - 10 (${classDC - 10})${lv >= 12 ? ", and turn it onto another creature within 30 feet" : ""}.`);
    n("volcanic-escape", `Volcanic Escape (reaction, overflow): when an enemy in your aura damages you, it takes ${F(Math.max(0, lv - 6), 4) + 1}d6 fire (basic Reflex DC ${classDC}) and you Leap half your Speed away without reactions; it ends your aura.`);
    n("body-of-air", `Body of Air (reaction, overflow): when an enemy targets you, you turn to vapor until your next turn (gaseous form, resistance ${8 + Math.max(0, lv - 14)}); it ends your aura, so it's the escape, not the opener.`);
    if (!auraOn && !foes.length) out.notes.push("No foe in sight: Channel Elements now so the aura is up when one appears, with a stance if you have one.");
}

export { kineticist };
