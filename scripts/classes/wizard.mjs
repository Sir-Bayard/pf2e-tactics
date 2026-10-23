/**
 * PF2e Tactics: classes/wizard.mjs
 * See classes/_common.mjs for the shape of a class read.
 * The wizard's layer over the advisor's spell plans: slots and the school's extra one, the thesis, Arcane Bond
 * (Drain Bonded Item as a plan to recast the best spent spell), the school focus spells the advisor can't score
 * (Force Bolt hits by itself, Protective Wards is a buff, Hand of the Apprentice throws a weapon), the spellshape feats
 * as "when" notes, Quickened Casting as a two-spell turn, and the cantrip-or-slot rule.
 */
import { castable, effect, focusLeft, has, level, pct, targets, worth, feetBetween, inReach, mapFor, strikeExpected, saveExpected, CONDITION_VALUE, nameOf, signed } from "./_common.mjs";
import { averageOf } from "../reader.mjs";

/** Each school's curriculum (lower-cased names) and its initial and advanced school spells, from the class features. */
const SCHOOLS = {
    "school-of-ars-grammatica": { cur: ["message", "sigil", "command", "disguise magic", "runic body", "runic weapon", "dispel magic", "translate", "enthrall", "veil of privacy", "dispelling globe", "suggestion", "sending", "truespeech", "repulsion", "spellwrack", "contingency", "planar seal", "quandary", "unrelenting observation", "detonate magic"], initial: "Protective Wards", advanced: "Rune of Observation" },
    "school-of-battle-magic": { cur: ["shield", "telekinetic projectile", "breathe fire", "force barrage", "mystic armor", "mist", "resist energy", "earthbind", "fireball", "wall of fire", "weapon storm", "howling blizzard", "impaling spike", "chain lightning", "disintegrate", "energy aegis", "true target", "arctic rift", "desiccate", "falling stars"], initial: "Force Bolt", advanced: "Energy Absorption" },
    "school-of-breathtaking-influence": { cur: ["daze", "infectious enthusiasm", "command", "fear", "sleep", "blood vendetta", "phantom crowd", "enthrall", "mind of menace", "confusion", "outcast's curse", "subconscious suggestion", "wave of despair", "dominate", "never mind", "contingency", "puppet strings", "dream council", "hidden mind", "telepathic demand"], initial: "Appeal to Authority", advanced: "Hot Air" },
    "school-of-civic-wizardry": { cur: ["prestidigitation", "read aura", "hydraulic push", "pummeling rubble", "summon construct", "revealing light", "water walk", "cozy cabin", "safe passage", "creation", "unfettered movement", "control water", "wall of stone", "disintegrate", "wall of force", "planar palace", "retrocognition", "earthquake", "pinpoint", "foresight"], initial: "Earthworks", advanced: "Community Restoration" },
    "school-of-corentyn-armada": { cur: ["message", "spout", "gust of wind", "hydraulic push", "rude awakening", "water breathing", "water walk", "aquatic arsenal", "crashing wave", "ice storm", "telepathy", "control water", "searing rain", "chain lightning", "truesight", "energy aegis", "project image", "arctic rift", "desiccate", "wrathful storm"], initial: "Control Currents", advanced: "Choking Fog" },
    "school-of-gates": { cur: ["message", "telekinetic hand", "fleet step", "lock", "thoughtful gift", "knock", "warping pull", "echo jump", "trade items", "flicker", "translocate", "king's castle", "magic passage", "collective transposition", "teleport", "interplanar teleport", "planar seal", "quandary", "sudden transposition", "forest of gates"], initial: "Friendly Push", advanced: "Rapid Retreat" },
    "school-of-kalistrade": { cur: ["prestidigitation", "read aura", "alarm", "charm", "item facade", "ghostly carrier", "invisibility", "clairaudience", "veil of privacy", "outcast's curse", "suggestion", "imaginary lockbox", "subconscious suggestion", "repulsion", "scrying", "project image", "retrocognition", "disappearance", "hidden mind", "resplendent mansion"], initial: "Unexpected Windfall", advanced: "Capital Dividend" },
    "school-of-keen-inquiry": { cur: ["detect magic", "sigil", "disguise magic", "illusory disguise", "mindlink", "knock", "see the unseen", "clairaudience", "locate", "clairvoyance", "detect scrying", "mind probe", "scouting eye", "scrying", "truesight", "retrocognition", "true target", "disappearance", "pinpoint", "foresight"], initial: "Fact Check", advanced: "Unsettling Perspective" },
    "school-of-magical-technologies": { cur: ["needle darts", "shield", "mending", "runic weapon", "summon construct", "animated assault", "dismantle", "shrink item", "wooden double", "creation", "weapon storm", "impaling spike", "wall of stone", "field of razors", "petrify", "beheading buzz saw", "lifewood cage", "ferrous form", "quandary", "resplendent mansion"], initial: "Augmented Body", advanced: "Conjured Clockwork" },
    "school-of-mentalism": { cur: ["daze", "figment", "dizzying colors", "sleep", "sure strike", "illusory creature", "stupefy", "dream message", "mind reading", "nightmare", "vision of death", "hallucination", "illusory scene", "never mind", "phantasmal calamity", "project image", "warp mind", "disappearance", "uncontrollable dance", "phantasmagoria"], initial: "Charming Push", advanced: "Invisibility Cloak" },
    "school-of-nexian-spaces": { cur: ["phase bolt", "warp step", "alarm", "pet cache", "thoughtful gift", "dimensional drop", "vanish weapon", "cozy cabin", "far reach", "flicker", "liminal doorway", "banishment", "space fold gate", "collective transposition", "proximal shift", "interplanar teleport", "planar palace", "stars of another sky", "quandary", "resplendent mansion"], initial: "Extradimensional Cover", advanced: "Unbounded Sphere" },
    "school-of-protean-form": { cur: ["gouging claw", "tangle vine", "jump", "pest form", "spider sting", "enlarge", "humanoid form", "feet to fins", "vampiric feast", "mountain resilience", "vapor form", "elemental form", "toxic cloud", "cursed metamorphosis", "petrify", "duplicate foe", "fiery body", "desiccate", "monstrosity form", "metamorphosis"], initial: "Scramble Body", advanced: "Shifting Form" },
    "school-of-quantic-control": { cur: ["gale blast", "scatter scree", "cradle aloft", "gentle landing", "pummeling rubble", "dismantle", "unrelenting gravity", "chosen gravity", "inertia lock", "containment", "living terrain", "control water", "wall of stone", "repulsion", "wall of force", "infinitesimal collapse field", "planar seal", "arctic rift", "earthbreaker stride", "implosion"], initial: "Circle of Weakness", advanced: "Quantic Dampening" },
    "school-of-rooted-wisdom": { cur: ["detect magic", "alarm", "dispel magic", "safe passage", "mountain resilience", "control water", "truesight", "energy aegis", "quandary"], initial: "Halcyon Mists", advanced: "Call the Ten" },
    "school-of-shadow-veils": { cur: ["figment", "frostbite", "disguise magic", "gloom mantle", "illusory object", "darkness", "illusory creature", "shadow projectile", "shared invisibility", "liminal doorway", "mirage", "shadow blast", "slither", "mislead", "phantasmal calamity", "mask of terror", "shadow form", "disappearance", "phantasmagoria"], initial: "The Night is Mine", advanced: "Tenebrous Freedom" },
    "school-of-thassilonian-rune-magic": { cur: ["detect magic", "sigil", "mystic armor", "runic body", "runic weapon", "sure strike", "darkvision", "see the unseen", "clairaudience", "veil of privacy", "clairvoyance", "fly", "mind probe", "sending", "scrying", "truesight", "contingency", "spell riposte", "unrelenting observation", "hidden mind", "foresight"], initial: "your sin's school spell", advanced: "Personal Runewell" },
    "school-of-the-boundary": { cur: ["telekinetic hand", "void warp", "grim tendrils", "phantasmal minion", "summon undead", "darkness", "see the unseen", "bind undead", "ghostly weapon", "flicker", "translocate", "banishment", "invoke spirits", "teleport", "vampiric exsanguination", "eclipse burst", "interplanar teleport", "quandary", "unrelenting observation", "massacre"], initial: "Fortify Summoning", advanced: "Spiral of Horrors" },
    "school-of-the-reclamation": { cur: ["telekinetic hand", "telekinetic projectile", "fleet step", "gust of wind", "mending", "knock", "mental map", "locate", "overwhelming memory", "bridge of vines", "shape stone", "mind probe", "scouting eye", "truesight", "wall of force", "restore ground", "retrocognition", "pinpoint", "unrelenting observation", "metamorphosis"], initial: "Grasping Vine", advanced: "Unsettling Knowledge" },
    "school-of-unified-magical-theory": { cur: [], initial: "Hand of the Apprentice", advanced: "Interdisciplinary Incantation" },
    "red-mantis-magic-school": { cur: [], initial: null, advanced: null },
};
const THESES = ["spell-blending", "improved-familiar-attunement", "spell-substitution", "staff-nexus", "experimental-spellshaping"];

const lc = (s) => String(s ?? "").toLowerCase().trim();
const isFocus = (sp) => !!sp.traits?.includes("focus");
const item = (actor, slug) => actor?.items?.find?.((i) => ["feat", "action"].includes(i.type) && (i.slug ?? i.system?.slug ?? lc(i.name).replace(/[^a-z0-9]+/g, "-")) === slug) ?? null;
/** Uses left today of a feat or action with a frequency, or null when the sheet doesn't count them. */
function usesLeft(actor, slug) {
    const f = item(actor, slug)?.system?.frequency;
    return f && typeof f.value === "number" ? f.value : null;
}
/** The prepared entries' slots: by rank { left, max }, the spells cast today (spent), and the highest rank the character casts. */
function slotsOf(actor) {
    const byRank = {};
    const spent = [];
    let top = 0;
    for (const entry of actor?.spellcasting?.regular ?? []) {
        const prepared = entry.isPrepared ?? entry.system?.prepared?.value === "prepared";
        if (!prepared || entry.isFocusPool) continue;
        const slots = entry.system?.slots ?? {};
        for (const [key, slot] of Object.entries(slots)) {
            const rank = Number(key.replace(/\D/g, ""));
            if (!rank || rank > 10) continue;
            const max = Number(slot.max) || 0;
            if (!max) continue;
            top = Math.max(top, rank);
            const list = Array.isArray(slot.prepared) ? slot.prepared : Object.values(slot.prepared ?? {});
            let left = 0;
            for (const p of list) {
                if (!p?.id) continue;
                const sp = entry.spells?.get?.(p.id) ?? null;
                if (p.expended) spent.push({ name: sp?.name ?? "a spell", rank, spell: sp });
                else left += 1;
            }
            byRank[rank] = { left, max };
        }
    }
    return { byRank, spent, top: top || Math.max(1, Math.ceil((actor?.level ?? 1) / 2)) };
}
/** A spell's average damage at a rank: its formulas plus interval heightening (the reader's rule, kept local). */
function spellAvg(spell, rank) {
    if (!spell) return 0;
    const parts = {};
    for (const [k, d] of Object.entries(spell.system?.damage ?? {})) parts[k] = d.formula ?? "";
    const h = spell.system?.heightening;
    const base = Number(spell.baseRank ?? spell.system?.level?.value ?? 1);
    if (h?.type === "interval" && h.interval && rank > base) {
        const steps = Math.floor((rank - base) / h.interval);
        for (const [k, f] of Object.entries(h.damage ?? {})) parts[k] = `${parts[k] ?? ""}+${Array(steps).fill(f).join("+")}`;
    } else if (h?.type === "fixed") {
        for (const [lvl, data] of Object.entries(h.levels ?? {})) if (Number(lvl) <= rank) for (const [k, d] of Object.entries(data.damage ?? {})) parts[k] = d.formula ?? d;
    }
    return Object.values(parts).reduce((t, f) => t + averageOf(f), 0);
}
/** What a single-target spell on the board is expected to do to t: a save, an attack roll (with the penalty), or an automatic hit. */
function spellExpected(board, sp, t, made = 0) {
    const lv = level(board);
    if (sp.save?.stat) return saveExpected(t.saves?.[sp.save.stat] ?? lv + 5, sp.dc ?? 10 + lv + 4, sp.avg, { basic: sp.save.basic });
    if (sp.attack !== null && sp.attack !== undefined) return strikeExpected(sp.attack + mapFor(made, false), t.ac, sp.avg);
    return { hit: 1, expected: sp.avg || 0 };
}
/** Single-target damage spells the character can cast now at t from where it stands. */
const hurters = (board, t, costMax = 3) => castable(board, (sp) => sp.cost && sp.cost <= costMax && !sp.area && !sp.heals && sp.avg > 0 && (sp.save?.stat || (sp.attack !== null && sp.attack !== undefined) || isFocus(sp)) && feetBetween(board.me.rect, t.rect) <= (sp.range ?? 30));
/** The foe to measure against: the closest one that's still up, the most hurt among equals. */
function primary(board) {
    const foes = targets(board).filter((f) => f.hp > 0 || f.hp === undefined);
    foes.sort((a, b) => feetBetween(board.me.rect, a.rect) - feetBetween(board.me.rect, b.rect) || (a.hp ?? 99) - (b.hp ?? 99));
    return foes[0] ?? null;
}
const rankText = (sp) => (sp.cantrip ? "" : isFocus(sp) ? " (focus)" : ` (rank ${sp.rank})`);
const cap = (s) => String(s ?? "").charAt(0).toUpperCase() + String(s ?? "").slice(1);
/** The cantrip-or-slot rule (the magus read's): the best cantrip and the best slot spell at t, and whether the slot is worth it. */
function cantripOrSlot(board, t, actions, made) {
    let cantrip = null, slot = null;
    for (const sp of hurters(board, t, actions)) {
        if (isFocus(sp)) continue;
        const pick = { sp, e: spellExpected(board, sp, t, made) };
        if (sp.cantrip) { if (!cantrip || pick.e.expected > cantrip.e.expected) cantrip = pick; }
        else if (!slot || pick.e.expected > slot.e.expected) slot = pick;
    }
    const gain = cantrip && slot ? slot.e.expected - cantrip.e.expected : 0;
    const nearlyDown = !!slot && t.hp > 0 && t.hp <= slot.e.expected;
    const clear = !!slot && gain >= 3 + (slot.sp.rank ?? 1);
    return { cantrip, slot, gain, nearlyDown, clear, spend: !!slot && (!cantrip || clear || nearlyDown) };
}
/** The spell to cast after something else this turn: the cantrip unless the rule says the slot. already: damage already on the way. */
function spendOrNot(board, t, actions, made, already = 0) {
    const r = cantripOrSlot(board, t, actions, made);
    const nearly = r.slot && t.hp > 0 && t.hp <= r.slot.e.expected + already;
    return r.slot && (!r.cantrip || r.clear || nearly) ? r.slot : r.cantrip;
}

function wizard(board, ctx, out) {
    const actor = board.me.actor;
    const me = board.me;
    const lv = level(board);
    const foes = targets(board);
    const focus = focusLeft(actor);
    const slots = slotsOf(actor);
    const school = Object.keys(SCHOOLS).find((s) => has(actor, s)) ?? null;
    const info = school ? SCHOOLS[school] : null;
    const curriculum = (sp) => !!info?.cur.includes(lc(sp.name));
    const t = primary(board);
    const adjacentFoes = foes.filter((f) => inReach(f.rect, me.rect, f.reach ?? 5));
    const unified = school === "school-of-unified-magical-theory";

    // Slots left, by rank: the player sees the sheet, but the plans spend from here
    const ranks = Object.keys(slots.byRank).map(Number).sort((a, b) => b - a);
    if (ranks.length) {
        const parts = ranks.map((r) => `rank ${r}: ${slots.byRank[r].left} of ${slots.byRank[r].max}`);
        out.notes.push(`Slots left: ${parts.join(", ")}.${school && !unified ? " One slot of each rank is your school's, a curriculum spell." : ""}`);
    }

    // Cantrip or slot: the best of each against the foe in front of you, and the rule
    if (t && ctx.actions >= 1) {
        const { cantrip, slot, nearlyDown, clear } = cantripOrSlot(board, t, ctx.actions, ctx.made);
        if (cantrip && slot) {
            const verdict = nearlyDown ? `${nameOf(t)} is nearly down, so the slot is worth it`
                : clear ? `the slot is worth it unless you're saving it`
                : `keep the slot; the gain is small. Spend one only when the gain is clear, the foe is nearly down, or this is the day's last fight`;
            out.notes.push(`Against ${nameOf(t)}: ${cantrip.sp.name} does about ${Math.round(cantrip.e.expected)}, ${slot.sp.name} (rank ${slot.sp.rank}) about ${Math.round(slot.e.expected)}; ${verdict}.`);
        } else if (cantrip && !slot) out.notes.push(`No damaging slot spell of yours reaches ${nameOf(t)} from here; ${cantrip.sp.name} does about ${Math.round(cantrip.e.expected)}; your slots are for the save and utility spells.`);
    }

    // Arcane school: which prepared spells are its curriculum, and the school spells
    if (school && info) {
        const curPrepared = (board.spells ?? []).filter((sp) => !sp.cantrip && !isFocus(sp) && !sp.consumable && curriculum(sp)).map((sp) => sp.name);
        const spells = [info.initial, lv >= 8 && has(actor, "advanced-school-spell") ? info.advanced : null].filter(Boolean);
        if (unified) out.notes.push(`Unified Magical Theory: no curriculum, but Drain Bonded Item once per day for each spell rank you can cast, one use per rank.`);
        else if (curPrepared.length) out.notes.push(`Curriculum spells prepared: ${curPrepared.join(", ")}. The Drain Bonded Item plan prefers one of these when Linked Focus is on the sheet.`);
        if (spells.length) out.notes.push(`School spells: ${spells.join(" and ")}${focus !== null ? ` (${focus} Focus Point${focus === 1 ? "" : "s"} left)` : ""}.`);
    }

    // Focus spells the advisor can't score: Force Bolt (hits by itself), Hand of the Apprentice (a thrown weapon), Protective Wards (AC)
    const focusSpells = castable(board, (sp) => isFocus(sp) && sp.cost);
    const bolt = focusSpells.find((sp) => lc(sp.name) === "force bolt");
    if (bolt && t && ctx.actions >= 1 && feetBetween(me.rect, t.rect) <= 30) {
        const dice = 1 + Math.floor((Math.max(1, Math.ceil(lv / 2)) - 1) / 2);
        const avg = bolt.avg > 0 ? bolt.avg : dice * 3.5;
        const steps = [{ cost: 1, text: `Force Bolt at ${nameOf(t)}: ${dice}d4+${dice} force, no roll, it just hits (about ${Math.round(avg)})` }];
        let ev = avg;
        const rest = ctx.actions - 1;
        if (rest >= 1) {
            const next = spendOrNot(board, t, rest, ctx.made, avg);
            if (next) { steps.push({ cost: next.sp.cost, text: `Cast ${next.sp.name}${rankText(next.sp)} at ${nameOf(t)} (about ${Math.round(next.e.expected)})` }); ev += next.e.expected; }
        }
        const notes = [`Spends a Focus Point${focus !== null ? ` (${focus} left)` : ""}.`];
        if (adjacentFoes.length) notes.push(`Casting next to ${adjacentFoes.map(nameOf).join(", ")} provokes a Reactive Strike if it has one.`);
        out.plans.push({ kind: "class", title: `Force Bolt ${nameOf(t)}`, target: t, ev, score: ev + 0.3, dest: null, steps, notes });
    }
    const hand = focusSpells.find((sp) => lc(sp.name) === "hand of the apprentice");
    if (hand && t && ctx.actions >= 1 && hand.attack !== null && hand.attack !== undefined) {
        const weapon = board.strikes.filter((s) => !s.ranged).sort((a, b) => b.avg - a.avg)[0];
        if (weapon) {
            const str = actor.system?.abilities?.str?.mod ?? 0;
            const int = actor.system?.abilities?.int?.mod ?? 0;
            const avg = Math.max(1, weapon.avg - str + int);
            const e = strikeExpected(hand.attack + mapFor(ctx.made, false), t.ac, avg);
            out.plans.push({ kind: "class", title: `Hand of the Apprentice at ${nameOf(t)}`, target: t, ev: e.expected, score: e.expected + 0.3, dest: null,
                steps: [{ cost: 1, text: `Hand of the Apprentice: hurl your ${weapon.label} at ${nameOf(t)} (spell attack ${signed(hand.attack + mapFor(ctx.made, false))}, hits about ${pct(e.hit)}, its damage with your Intelligence instead of Strength, about ${Math.round(avg)}); it flies back to your hand` }],
                notes: [`Spends a Focus Point${focus !== null ? ` (${focus} left)` : ""}. It counts as an attack for the multiple attack penalty.`] });
        }
    }
    const wards = focusSpells.find((sp) => lc(sp.name) === "protective wards");
    if (wards && ctx.actions >= 1 && !effect(actor, /protective-wards/)) {
        const threatened = [me, ...board.allies.filter((a) => inReach(me.rect, a.rect, 5))].filter((c) => foes.some((f) => f.reach !== undefined ? inReach(f.rect, c.rect, f.reach ?? 5) : feetBetween(f.rect, c.rect) <= 10));
        if (threatened.length) {
            // +1 AC: about a tenth of a foe's hit per attack it makes, two attacks a round on each covered creature
            const hit = foes.reduce((m, f) => Math.max(m, f.reactiveStrike?.avg ?? 0), 0) || 3 + lv;
            const ev = 0.1 * hit * 2 * threatened.length;
            out.plans.push({ kind: "class", title: "Protective Wards", target: null, ev, score: ev + 0.2, dest: null,
                steps: [{ cost: 1, text: `Protective Wards: +1 status AC to you${threatened.length > 1 ? ` and ${threatened.filter((c) => c !== me).map(nameOf).join(", ")}, inside 5 feet of you` : " (and allies inside 5 feet)"}; Sustain it to grow the ring 5 feet a turn, up to 30` }],
                notes: [`Spends a Focus Point${focus !== null ? ` (${focus} left)` : ""}. Allies have to stay inside the ring to keep the bonus.`] });
        }
    }
    // The other school spells: when they're the right call
    const hint = { "charming push": (sp) => t ? `Charming Push on ${nameOf(t)} (Will DC ${sp.dc ?? "?"}): it can't act against you on a failure, and -1 to hit you on a success; incapacitation, so not on a foe above level ${2 * sp.rank}.` : null,
        "scramble body": (sp) => t ? `Scramble Body on ${nameOf(t)} (Fortitude DC ${sp.dc ?? "?"}): sickened 1 on a failure, sickened 2 and slowed 1 on a critical failure; best on a caster or a foe with weak Fortitude.` : null,
        "circle of weakness": () => `Circle of Weakness before an energy spell: foes in the 15-foot burst gain weakness to that type on a failed Fortitude save; cast it the turn before the big one, and Sustain it.`,
        "fortify summoning": () => `Fortify Summoning as you summon: +1 status to the creature's checks and DCs for the minute.`,
        "earthworks": () => `Earthworks (1 to 3 actions, 5 to 15-foot burst of difficult terrain): between you and the foes that are walking in.`,
        "friendly push": () => `Friendly Push: 10 feet of free movement for an ally out of position, or a downed one out of reach.`,
        "spiral of horrors": () => foes.filter((f) => feetBetween(me.rect, f.rect) <= 30).length >= 2 ? `Spiral of Horrors (2 actions): the ${foes.filter((f) => feetBetween(me.rect, f.rect) <= 30).length} foes within 30 feet are frightened 1 and can't shake it while the aura lasts.` : null,
        "grasping vine": (sp) => t ? `Grasping Vine on ${nameOf(t)} (Reflex DC ${sp.dc ?? "?"}): grabbed on a failure, and you can drag it 10 feet when you Sustain.` : null,
        "unexpected windfall": (sp) => t ? `Unexpected Windfall on ${nameOf(t)} (Fortitude DC ${sp.dc ?? "?"}): encumbered on a failure, prone on a critical failure.` : null,
        "hot air": (sp) => t ? `Hot Air on ${nameOf(t)}: fire damage with a basic Fortitude save, and a caster that fails burns each time it casts.` : null,
        "unsettling perspective": (sp) => t ? `Unsettling Perspective on ${nameOf(t)}: mental damage with a Will save, and on a failure you learn its place in things.` : null,
        "extradimensional cover": () => `Extradimensional Cover (2 actions): cover for you or an ally in a square only your side can stand in.`,
        "shifting form": () => `Shifting Form (1 action): +20 feet Speed to get out of reach, or claws when you're cornered.`,
        "invisibility cloak": () => `Invisibility Cloak (2 actions): invisible until you attack; walk out of a bad spot.`,
        "halcyon mists": () => { const hurt = [me, ...board.allies].find((a) => a.hp > 0 && a.hp <= a.maxHp * 0.5); return hurt ? `Halcyon Mists on ${hurt === me ? "yourself" : nameOf(hurt)} (2 actions): 1d8 temporary HP, ends persistent damage, and concealment.` : null; },
        "conjured clockwork": () => `Conjured Clockwork (2 actions, 10-foot burst): difficult terrain that cuts whatever stands in it each turn; Sustain to widen it.`,
        "unbounded sphere": () => `Unbounded Sphere (2 actions, 10-foot burst): a foe inside needs a Will save to get out; cast it on the one you want held.`,
        "personal runewell": () => `Personal Runewell (2 actions, 15-foot cylinder): damage with a basic Reflex save, and the well feeds on failures.`,
        "appeal to authority": (sp) => t ? `Appeal to Authority on ${nameOf(t)} (Will DC ${sp.dc ?? "?"}): sets up your emotion spells with a save penalty.` : null,
        "the night is mine": () => `The Night is Mine: your shadow magic's edge in dim light.`,
        "augmented body": () => `Augmented Body (1 action): resistance 1 to physical, a clockwork fist, or the other augments; a minute's worth.`,
        "control currents": () => `Control Currents: move a foe or an ally with the water.`,
    };
    for (const sp of focusSpells) {
        const fn = hint[lc(sp.name)];
        const text = fn ? fn(sp) : null;
        if (text) out.notes.push(text);
    }
    const reactive = { "energy absorption": "Energy Absorption (reaction, a Focus Point): resistance 15 to the acid, cold, electricity or fire of one hit on you.",
        "rapid retreat": "Rapid Retreat (reaction, a Focus Point) when an attack or spell damages you: teleport 20 feet and resist your level of that damage.",
        "community restoration": "Community Restoration (reaction, a Focus Point) when a slot spell helps allies without hurting them: 2 temporary HP per rank for you, and as many to share.",
        "capital dividend": "Capital Dividend (reaction, a Focus Point) when you'd drop to 0 HP: you stay at 1, and healing on you adds 8 for a minute.",
        "interdisciplinary incantation": "Interdisciplinary Incantation (reaction, a Focus Point) when a caster within 30 feet casts an arcane spell: cast it yourself by next turn's end from a slot of its rank.",
        "quantic dampening": "Quantic Dampening (2 actions): for a minute, you and allies within 15 feet treat a basic Reflex save against energy one degree better.",
        "fact check": "Fact Check (reaction, a Focus Point): a second roll on a Recall Knowledge check you or an ally within 30 feet just made." };
    for (const sp of (board.spells ?? []).filter((sp) => isFocus(sp) && !sp.consumable)) { const text = reactive[lc(sp.name)]; if (text && (focus === null || focus > 0)) out.notes.push(text); }

    // Arcane bond: Drain Bonded Item recasts the best spell spent today, this turn, without a slot
    const drainSlug = has(actor, "drain-familiar") || has(actor, "improved-familiar-attunement") ? "drain-familiar" : "drain-bonded-item";
    const bond = has(actor, "arcane-bond") || has(actor, drainSlug);
    if (bond) {
        const drainItem = item(actor, drainSlug);
        const left = usesLeft(actor, drainSlug);
        const usedEffect = !!effect(actor, /drain-bonded-item|drain-familiar|arcane-bond/);
        const used = left === 0 || usedEffect;
        const source = drainSlug === "drain-familiar" ? "familiar" : "bonded item";
        const spentCastable = slots.spent.filter((s) => s.spell && (s.rank <= slots.top) && !(lv >= 19 && s.rank >= 10));
        if (used) out.notes.push(`Drain ${source === "familiar" ? "Familiar" : "Bonded Item"} is spent for today${has(actor, "superior-bond") && left === 0 ? "; Superior Bond's extra use, if you still have it, recasts a spell 2 or more ranks below your top slot" : ""}.`);
        else if (!ranks.length || !spentCastable.length) {
            const drainText = `Drain ${source === "familiar" ? "Familiar" : "Bonded Item"} (free action, once a day${unified ? " per spell rank" : ""}): recast a spell you already cast today, this turn, without a slot.`;
            out.notes.push(ranks.length ? `${drainText} Nothing is spent yet.` : `${drainText}${drainItem ? "" : " Whether it's been used today isn't on the sheet, so count it yourself."}`);
        } else {
            // Score each spent spell against the foe in front: damage spells by save or attack, the rest by rank
            let best = null;
            for (const s of spentCastable) {
                const sp = s.spell;
                const traits = sp.system?.traits?.value ?? [];
                const save = sp.system?.defense?.save ?? null;
                const avg = spellAvg(sp, s.rank);
                const cost = (() => { const v = String(sp.system?.time?.value ?? "2"); return /reaction|free|minute|hour/.test(v) ? null : Number(/(\d)/.exec(v)?.[1] ?? 2); })();
                if (cost === null || cost > ctx.actions) continue;
                let ev = 0, how = "", caught = 1;
                if (t && avg > 0 && save?.statistic) {
                    const e = saveExpected(t.saves?.[save.statistic] ?? lv + 5, (board.spells ?? []).find((x) => x.dc)?.dc ?? 10 + lv + 4, avg, { basic: !!save.basic });
                    // An area: the foes near the first one, at most three, as a rough catch
                    caught = sp.system?.area ? Math.min(3, Math.max(1, foes.filter((f) => feetBetween(f.rect, t.rect) <= 2 * (Number(sp.system.area.value) || 10)).length)) : 1;
                    ev = e.expected * caught; how = `${save.basic ? "basic " : ""}${cap(save.statistic)} save, about ${Math.round(avg)} before it`;
                } else if (t && avg > 0 && traits.includes("attack")) {
                    const e = strikeExpected(((board.spells ?? []).find((x) => x.attack !== null && x.attack !== undefined)?.attack ?? lv + 6) + mapFor(ctx.made, false), t.ac, avg); ev = e.expected; how = `spell attack, hits about ${pct(e.hit)}, about ${Math.round(avg)} on a hit`;
                } else { ev = worth(board, "slowed", 0.5) * s.rank / Math.max(1, slots.top); how = "its effect again"; }
                if (has(actor, "linked-focus") && curriculum({ name: sp.name }) && focus !== null) ev += 1.5;
                if (!best || ev > best.ev) best = { s, ev, how, cost, avg, caught, area: !!sp.system?.area };
            }
            if (best) {
                const cur = has(actor, "linked-focus") && curriculum({ name: best.s.spell.name });
                const steps = [{ cost: 0, text: `Drain ${source === "familiar" ? "Familiar" : "Bonded Item"} (free action): ${best.s.spell.name} (rank ${best.s.rank}) comes back for this turn` },
                    { cost: best.cost, text: `Cast ${best.s.spell.name} ${best.area ? `on ${t ? nameOf(t) : "the foes"}${best.caught > 1 ? ` and the ${best.caught - 1} near it` : ""}` : `at ${t ? nameOf(t) : "the foe"}`} (${best.how})` }];
                const notes = [`No slot spent. ${lv >= 8 && has(actor, "bond-conservation") ? "Then Bond Conservation (1 action, before this turn or the next ends): a second drain for a spell 2 or more ranks lower." : "Once a day."}`];
                if (cur) notes.push("Linked Focus: a curriculum spell recast this way gives back 1 Focus Point.");
                out.plans.push({ kind: "class", title: `Drain your ${source}: ${best.s.spell.name} again`, target: t, ev: best.ev, score: best.ev + 0.4, dest: null, steps, notes });
            }
            if (has(actor, "superior-bond") && lv >= 14) out.notes.push(`Superior Bond: a second drain today, for a spell 2 or more ranks below your top slot (rank ${slots.top - 2} or lower).`);
        }
    }

    // Arcane thesis: what it means on this turn
    const thesis = THESES.find((s) => has(actor, s)) ?? null;
    if (thesis === "spell-blending") out.notes.push(`Spell Blending: your top-rank slots were bought with lower ones at preparation, so there's no cheap spell to fall back on; the cantrips are the fallback.`);
    else if (thesis === "improved-familiar-attunement") out.notes.push(`Your familiar carries the bond: Drain Familiar needs it within reach of you${lv >= 6 ? ", and its extra abilities are yours to use this turn" : ""}.`);
    else if (thesis === "spell-substitution") out.notes.push(`Spell Substitution: 10 minutes out of combat swaps a prepared spell for another in your book; nothing for this turn, but pick spells for the next fight after this one.`);
    else if (thesis === "staff-nexus") {
        const staffSpells = (board.spells ?? []).filter((sp) => /staff/i.test(String(sp.entry ?? "")) || sp.consumable === "staff");
        out.notes.push(`Staff Nexus: ${staffSpells.length ? `the staff's spells (${staffSpells.map((s) => s.name).join(", ")}) come from its charges, not your slots; use them first` : "the staff's spells come from its charges, not your slots; use them before a prepared one of the same rank"}.`);
    } else if (thesis === "experimental-spellshaping") out.notes.push(`Experimental Spellshaping: ${lv >= 4 ? `the spellshape feat you took at preparation (up to level ${Math.floor(lv / 2)}) ` : "your free spellshape feat "}is a 1-action prefix to a spell; the notes below say when each pays.`);

    // Spellshape feats: "when" notes. Each is one action (free at 20 with Spellshape Mastery) before the Cast a Spell
    const free = lv >= 20 && (has(actor, "spellshape-mastery") || has(actor, "metamagic-mastery"));
    const prefix = free ? "free action" : "1 action";
    const single = castable(board, (sp) => sp.cost && !sp.area && !sp.heals && sp.avg > 0 && (sp.save?.stat || (sp.attack !== null && sp.attack !== undefined)));
    if (has(actor, "reach-spell")) {
        const far = foes.filter((f) => { const d = feetBetween(me.rect, f.rect); return single.some((sp) => d > (sp.range ?? 30) && d <= (sp.range ?? 30) + 30); });
        if (far.length) out.notes.push(`Reach Spell (${prefix}): +30 feet of range puts ${far.map(nameOf).join(", ")} in reach of a spell that falls short now.`);
        else if (adjacentFoes.length === 0 && foes.length) out.notes.push(`Reach Spell (${prefix}): +30 feet of range, 30 feet for a touch spell; nothing out of range now.`);
    }
    if (has(actor, "widen-spell")) {
        const areas = castable(board, (sp) => sp.area && ["burst", "cone", "line"].includes(sp.area.shape) && sp.cost);
        if (areas.length && foes.length >= 2) out.notes.push(`Widen Spell (${prefix}): +5 feet on a burst of 10 or more, +5 or +10 on a cone or line; worth it when a second foe stands just outside ${areas[0].name}'s area.`);
    }
    if (has(actor, "conceal-spell")) out.notes.push(`Conceal Spell (${prefix}): the spell is subtle, so no one sees you cast it${adjacentFoes.length ? "; it doesn't stop a Reactive Strike" : ""}. For a spell you'd rather not be blamed for, or to keep a counterspeller guessing.`);
    if (has(actor, "elemental-defense") || has(actor, "energy-ablation")) {
        const which = has(actor, "energy-ablation") ? "Energy Ablation" : "Elemental Defense";
        out.notes.push(`${which} (${prefix}) before an energy spell: resistance ${has(actor, "energy-ablation") ? "equal to its rank to one energy type until your next turn ends" : "equal to twice its rank to its element until your next turn"}; worth the action when that element is coming back at you.`);
    }
    if (has(actor, "detonating-spell")) { const packed = t && foes.some((f) => f !== t && inReach(f.rect, t.rect, 5)); if (packed) out.notes.push(`Detonating Spell (${prefix}): a single-target spell that damages ${nameOf(t)} splashes its rank onto the foes next to it.`); }
    if (has(actor, "knockback-spell") && foes.length) out.notes.push(`Knockback Spell (${prefix}) on an area spell with a Reflex or Fortitude save and no duration: foes that fail are pushed 5 feet, 10 on a critical failure; away from the downed or off a ledge.`);
    if (has(actor, "chaotic-spell")) out.notes.push(`Chaotic Spell (${prefix}) on an acid, cold, electricity, fire or sonic spell: the type is rerolled and a rider comes with it (sickened, slowed, off-guard, persistent fire, deafened); a gamble when the foe resists your type.`);
    if (lv >= 12 && has(actor, "forcible-energy")) out.notes.push(`Forcible Energy (${prefix}) on an acid, cold, electricity, fire or sonic spell: one foe it damages gains weakness 5 to that type until your next turn ends; cast it first, then a second spell of the same type, or let an ally with that element follow.`);
    if (lv >= 14 && has(actor, "dizzying-spell")) out.notes.push(`Dizzying Spell (${prefix}) on a single-target Will spell: stupefied 2 for a round on a failure; aim it at a caster.`);
    if (lv >= 14 && has(actor, "secondary-detonation-array")) out.notes.push(`Secondary Detonation Array (${prefix}) on an area damage spell: a 5-foot circle inside it goes off again at your next turn's start, 1d6 per rank; set it where the foes will still be.`);
    if (lv >= 16 && has(actor, "scintillating-spell")) out.notes.push(`Scintillating Spell (${prefix}) on a Reflex spell with no duration: foes that fail are dazzled, blinded on a critical failure.`);
    if (has(actor, "explosive-arrival")) out.notes.push(`Explosive Arrival (free) when you summon: 1d4 fire per rank in a 10-foot burst around the creature; summon it next to the foes.`);
    if (lv >= 20 && has(actor, "worldsphere-gravity")) out.notes.push(`Worldsphere Gravity (${prefix}, once an hour) on an area spell of rank 5 or more: greater difficult terrain that grounds fliers, or a burst that quickens whoever starts in it.`);
    if (free) out.notes.push("Spellshape Mastery: your spellshape actions are free actions now, so every spell gets one.");

    // Quickened Casting (10, once a day): a 2-action spell cast in one, then another 2-action spell this turn
    if (lv >= 10 && has(actor, "quickened-casting") && ctx.actions >= 3 && t) {
        const qLeft = usesLeft(actor, "quickened-casting");
        if (qLeft === 0) out.notes.push("Quickened Casting is spent for today.");
        else {
            const pool = hurters(board, t, 2).filter((sp) => sp.cost === 2 && !isFocus(sp)).map((sp) => ({ sp, e: spellExpected(board, sp, t, ctx.made) }));
            const quickable = pool.filter((x) => x.sp.cantrip || (x.sp.rank ?? 1) <= slots.top - 2).sort((a, b) => b.e.expected - a.e.expected);
            const q = quickable[0];
            if (q) {
                const second = pool.filter((x) => x.sp !== q.sp).sort((a, b) => b.e.expected - a.e.expected)[0] ?? pool.find((x) => x.sp === q.sp && x.sp.cantrip) ?? null;
                if (second) {
                    const ev = q.e.expected + second.e.expected;
                    out.plans.push({ kind: "class", title: `Quickened Casting: ${q.sp.name}, then ${second.sp.name}`, target: t, ev, score: ev + 0.4, dest: null,
                        steps: [{ cost: 0, text: `Quickened Casting (free, once a day): ${q.sp.name}${rankText(q.sp)} takes 1 action` }, { cost: 1, text: `Cast ${q.sp.name} at ${nameOf(t)} (about ${Math.round(q.e.expected)})` }, { cost: 2, text: `Cast ${second.sp.name}${rankText(second.sp)} at ${nameOf(t)} (about ${Math.round(second.e.expected)})` }],
                        notes: [`Only a cantrip or a spell of rank ${Math.max(1, slots.top - 2)} or lower can be quickened. Two spells next to ${adjacentFoes.length ? adjacentFoes.map(nameOf).join(", ") : "a foe"} means two chances to provoke.`] });
                }
            }
        }
    }

    // Counterspell and its upgrades: a reaction, so a note on when it fires
    if (has(actor, "counterspell-prepared") || has(actor, "counterspell")) {
        const wide = lv >= 12 && has(actor, "clever-counterspell");
        out.notes.push(`Counterspell (reaction) fires when a foe you can see casts a spell ${wide ? "that's in your spellbook; you spend a prepared spell sharing a trait with it" : "you have prepared, and spends that prepared spell"} to counteract it${lv >= 14 && has(actor, "reflect-spell") ? "; Reflect Spell turns a countered spell back on its caster" : ""}${has(actor, "shrink-spell") ? "; Shrink Spell trims a burst, cone or line you fail to counter" : ""}.`);
    }
    if (lv >= 8 && has(actor, "spellbinding-speech") && ctx.actions >= 2 && adjacentFoes.length) out.notes.push(`Spellbinding Speech (1 action, Arcana against Will DC) on ${nameOf(adjacentFoes[0])}: no reactions from it until your next turn, so you can cast beside it; once per foe per day.`);
    if (lv >= 4 && has(actor, "spell-protection-array")) out.notes.push("Spell Protection Array (1 action, Sustain up to a minute): +1 status to saves against magic for everyone in a 10-foot burst; when the foes are casting.");
    if (lv >= 10 && has(actor, "shared-focus")) { const ally = board.allies.find((a) => (a.actor?.system?.resources?.focus?.max ?? 0) > 0 && feetBetween(me.rect, a.rect) <= 30); if (ally) out.notes.push(`Shared Focus (1 action): a temporary Focus Point for ${nameOf(ally)} until your next turn; once per ally per day.`); }
    if (lv >= 8 && has(actor, "knowledge-is-power-wizard")) out.notes.push("Knowledge is Power: a critical success on Recall Knowledge about a foe gives it -1 AC and saves against your next attack or spell; tell the party and they get it too.");
    if (lv >= 6 && has(actor, "steady-spellcasting") && adjacentFoes.length) out.notes.push("Steady Spellcasting: a Reactive Strike that would disrupt your casting only does so if you fail a DC 15 flat check.");
    if (lv >= 16 && has(actor, "effortless-concentration")) out.notes.push(board.sustain ? `Effortless Concentration: ${board.sustain.name} is Sustained for free at the start of your turn; the plans' Sustain action goes elsewhere.` : "Effortless Concentration: one of your spells is Sustained for free as your turn begins.");
    if (lv >= 14 && has(actor, "shift-spell") && board.sustain) out.notes.push(`Shift Spell (1 action): move ${board.sustain.name}'s area up to 120 feet, at half its remaining duration.`);
    if (lv >= 18 && has(actor, "second-thoughts")) out.notes.push("Second Thoughts (reaction) when a single-target mental spell is critically saved: cast it again on someone else by the end of your next turn, no slot spent.");
    if (lv >= 12 && has(actor, "redirect-teleportation")) out.notes.push("Redirect Teleportation (reaction) when a creature teleports in within 60 feet: spend a prepared teleportation spell to put it where you choose.");
    if (lv >= 6 && has(actor, "convincing-illusion")) out.notes.push("Convincing Illusion (reaction) when a foe succeeds but doesn't critically succeed against your illusion: Deception against its Perception DC keeps the illusion up.");

    // Scrolls made at preparation (Scroll Adept, or Scroll Savant before the Remaster): they vanish tomorrow, so they go first
    if (lv >= 10 && (has(actor, "scroll-adept") || has(actor, "scroll-savant"))) {
        const scrolls = (board.spells ?? []).filter((sp) => sp.consumable === "scroll");
        out.notes.push(scrolls.length ? `Your temporary scrolls (${scrolls.map((s) => s.name.replace(/ from a scroll$/, "")).join(", ")}) are gone at your next preparations: spend them before a slot of the same rank.` : "Scroll Adept: the scrolls you wrote this morning are gone at your next preparations, so they go before a slot of the same rank.");
    }
    if (lv >= 6 && has(actor, "split-slot")) out.notes.push("Split Slot: one slot holds two spells; cast whichever fits, the other dissipates.");
    if (lv >= 18 && has(actor, "infinite-possibilities")) out.notes.push(`Infinite Possibilities: one top slot casts any spell in your book of rank ${Math.max(1, slots.top - 2)} or lower; keep it for the spell no one prepared.`);
    if (lv >= 18 && has(actor, "reprepare-spell")) out.notes.push("Reprepare Spell: 10 minutes after this fight brings back a spent spell of rank 4 or lower with no duration, so those are the slots to spend now.");
    if (lv >= 20 && has(actor, "spell-mastery")) out.notes.push("Spell Mastery: your four mastered spells are always prepared, each in its own extra slot; they're the slots to spend first.");
    if (lv >= 20 && has(actor, "spell-combination")) out.notes.push(`Spell Combination: a combination slot of each rank from 3 up casts two spells at one target in one casting, each 2 or more ranks below the slot; against ${t ? nameOf(t) : "a single foe"}, that's the slot to open with.`);
    if (lv >= 19 && (has(actor, "archwizard-s-spellcraft") || has(actor, "archwizards-spellcraft"))) {
        const tenth = slots.byRank[10];
        out.notes.push(`Archwizard's Spellcraft: ${tenth ? `${tenth.left} of ${tenth.max} 10th-rank slot${tenth.max > 1 ? "s" : ""} left` : "a 10th-rank slot"}${lv >= 20 && has(actor, "archwizard-s-might") ? " (two with Archwizard's Might)" : ""}; Drain Bonded Item can't bring a 10th-rank spell back, so it's a once-a-day cast; save it for the fight that decides something.`);
    }
    if (lv >= 20 && has(actor, "reclaim-spell")) out.notes.push("Reclaim Spell: Dismiss a spell of rank 4 or lower with half its duration left and reprepare it in 10 minutes.");
    if (lv >= 14 && has(actor, "bonded-focus") && focus !== null && focus < (actor.system?.resources?.focus?.max ?? 0)) out.notes.push("Bonded Focus: a Refocus with your bonded item refills the whole pool, so spend the Focus Points.");
    if (lv >= 8 && has(actor, "form-retention")) out.notes.push("Form Retention: a battle form prepared 2 ranks up lasts 10 minutes; cast it before the fight starts, not during.");
}

export { wizard };
