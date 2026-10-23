/**
 * PF2e NPC Tactics: player.mjs
 * The Turn Helper: a window for one player character, showing what that character can see of the board on
 * its turn. Reach, Strikes and their targets, flanks, the way squares provoke, cover, and what the party has
 * learned of each foe this fight. Nothing an NPC's sheet knows and the party doesn't: no HP, no saves, no
 * threat, no tactics, no notes. Opened from the "PF2e Tactics: Turn Helper" macro, or on the player's turn
 * when they turn that on for themselves. Its advice (Your Turn) is the advisor run on what the party can judge of
 * each foe (see adviceBoard), plus what the character's class adds (classes.mjs).
 *
 * What a foe's state means here (PF2e detection): observed and concealed foes are shown in full; a hidden foe
 * (the square is known, the creature isn't seen) is shown in its square with the flat check it takes to
 * target it, and the ways round that the character has (Seek, a reveal spell, an area); an undetected foe is
 * not shown at all, and the only trace of one is a line about Seeking, when the party already knows it is
 * there (its combatant is in the tracker).
 */
import { MODULE_ID, esc, link, setting, signed, flagOf } from "./shared.mjs";
import { coverBetween, feetBetween, flanks, inReach, isDown, readBoard, tokenStandIn, visibilityOf, withVisioner } from "./reader.mjs";
import { flankingAlly, isOffGuard, nameOf, planTurn, reachableSquares } from "./advisor.mjs";
import { bindCard, foldOpen, panel, statusLine, stepsHtml, titleCase } from "./card.mjs";
import { ledgerFor, ledgerTotals, turnHtml } from "./state.mjs";
import { classFeatures } from "./classes.mjs";

const HELPER_POSITION_KEY = `${MODULE_ID}.helper`;

/* ------------------------------------------------------------------ what foes have shown */

/** Reactions each NPC token has used this fight (from its chat cards): combat id -> token id -> Set of names. */
const SHOWN = new Map();
/** What each NPC token has been seen to do this fight: combat id -> token id -> Set of "cast", "ranged", "heal". */
const DID = new Map();
function shownReactions(combat, tokenId) {
    return SHOWN.get(combat?.id)?.get(tokenId) ?? new Set();
}
function shownDoing(combat, tokenId) {
    return DID.get(combat?.id)?.get(tokenId) ?? new Set();
}
const bucket = (map, combatId, tokenId) => {
    const byCombat = map.get(combatId) ?? map.set(combatId, new Map()).get(combatId);
    return byCombat.get(tokenId) ?? byCombat.set(tokenId, new Set()).get(tokenId);
};
/**
 * What a chat card shows the table about the NPC that made it: a reaction it used (an item with the reaction glyph, or an
 * attack roll made outside its own turn, which is a Reactive Strike or the like), a spell it cast, a ranged attack, a heal.
 * The Turn Helper treats a foe as able to do these only once the party has seen it do them.
 */
function noteReaction(message) {
    const combat = game.combat;
    if (!combat?.started) return;
    const tokenId = message.speaker?.token;
    const actor = message.actor;
    if (!tokenId || !actor || actor.hasPlayerOwner) return;
    const item = message.item;
    const ctx = message.flags?.pf2e?.context ?? {};
    const isAttack = ctx.type === "attack-roll" || ctx.type === "spell-attack-roll";
    const offTurn = combat.combatant?.tokenId && combat.combatant.tokenId !== tokenId;
    const isReaction = item?.system?.actionType?.value === "reaction"
        || /<span class="action-glyph[^"]*">\s*[rR]\s*<\/span>/.test(message.flavor ?? "")
        || (isAttack && offTurn && !item?.isRanged);
    if (isReaction) bucket(SHOWN, combat.id, tokenId).add(item?.system?.actionType?.value === "reaction" ? (item?.name ?? "a reaction") : "Reactive Strike");
    const did = bucket(DID, combat.id, tokenId);
    if (item?.type === "spell" || ctx.type === "spell-attack-roll" || message.flags?.pf2e?.casting) did.add("cast");
    if (isAttack && (item?.isRanged || (item?.system?.traits?.value ?? []).some((t) => /^(range|thrown)/.test(t)))) did.add("ranged");
    if (item?.type === "spell" && (item.system?.traits?.value ?? []).includes("healing")) did.add("heal");
}

/* ------------------------------------------------------------------ reading the board for a PC */

const REVEAL_SPELLS = [
    { re: /^revealing light$/i, how: "a 10-foot burst, Reflex save: a foe that fails is dazzled, and if it is invisible it becomes concealed instead of hidden" },
    { re: /^see the unseen$/i, how: "you see invisible creatures as concealed rather than hidden" },
    { re: /^faerie fire$/i, how: "a 10-foot burst: creatures in it can't be concealed, and invisible ones are concealed instead of hidden" },
    { re: /^glitterdust$/i, how: "a 10-foot burst, Reflex save: invisible creatures are revealed" },
    { re: /^true seeing$/i, how: "you see through illusions and invisibility" },
];

/** What this character can see of a foe: "observed", "concealed", "hidden" or "undetected". */
function stateOf(board, e) {
    const light = board.lightAt ? board.lightAt(e.rect) : "bright";
    const feet = feetBetween(board.me.rect, e.rect);
    const computed = visibilityOf({ senses: board.me.senses, conditions: board.me.conditions }, e, light, feet);
    return withVisioner(computed, board.visioner?.get?.(e.id)?.state, true, e.conditions);
}

/** The party's knowledge of a foe's AC this fight: bounds from the party's attack rolls against it, or nothing. */
function knownAc(board, e) {
    const v = flagOf(game.combat, "party")?.[e.id]?.ac;
    if (!v || typeof v !== "object" || !(v.n > 0)) return null;
    const lo = Number.isFinite(v.lo) ? v.lo : null, hi = Number.isFinite(v.hi) ? v.hi : null;
    if (lo === null && hi === null) return null;
    const text = lo !== null && hi !== null ? (lo === hi ? `AC ${lo}` : `AC ${lo}–${hi}`) : lo !== null ? `AC ${lo} or more` : `AC ${hi} or less`;
    return `${text} (${v.n} attack${v.n === 1 ? "" : "s"} this fight)`;
}

/** The character's reveal spells and areas, for a hidden foe. */
function waysToReveal(board) {
    const out = [];
    for (const sp of board.spells ?? []) {
        const r = REVEAL_SPELLS.find((x) => x.re.test(sp.name ?? ""));
        if (r) out.push({ kind: "reveal", name: sp.name, text: `${sp.name}${sp.rank ? ` (rank ${sp.rank})` : ""}: ${r.how}` });
    }
    for (const sp of board.spells ?? []) {
        if (!sp.area || !(sp.save || sp.attack) || REVEAL_SPELLS.some((x) => x.re.test(sp.name ?? ""))) continue;
        out.push({ kind: "area", name: sp.name, text: `${sp.name} (${sp.area.shape ?? "area"}${sp.area.size ? ` ${sp.area.size} ft` : ""}): an area needs no flat check to include a hidden creature's square` });
    }
    return out;
}

async function readHelperBoard(token) {
    // Only reactions the party has seen a foe use count on this board (paths and warnings go round those alone)
    const combat = game.combat;
    const board = await readBoard(token, combat, {
        reactionsSeen: (e, r) => shownReactions(combat, e.id).has(r.name) || (/reactive strike|attack of opportunity/i.test(r.name) && shownReactions(combat, e.id).has("Reactive Strike")),
        unseen: (e, b) => stateOf(b, e) === "undetected",
    });
    return board ? annotateBoard(board) : null;
}
/** What the character sees of the board: foes by state, cover, what the party knows, what each has shown. */
function annotateBoard(board) {
    const combat = game.combat;
    // Foes as the character sees them. Undetected ones are left out, except for the Seek line.
    const seen = [];
    let unseenKnown = 0;
    for (const e of board.enemies) {
        const state = stateOf(board, e);
        if (state === "undetected") {
            const c = combat?.combatants?.find((x) => x.tokenId === e.id);
            if (c && !c.hidden) unseenKnown += 1; // the party knows it is in the fight
            continue;
        }
        seen.push({ ...e, state, cover: Math.max(0, coverBetween(board, board.me.rect, e, { ranged: true, fromSize: board.me.sizeRank ?? 2 })), known: knownAc(board, e), shown: shownReactions(combat, e.id) });
    }
    board.seenFoes = seen;
    board.unseenKnown = unseenKnown;
    board.reveals = waysToReveal(board);
    return board;
}

/* ------------------------------------------------------------------ what the party knows: the advice board */

/** The level the party judges foes by: its own. The GM can let the helper use each creature's real level instead. */
function partyLevel(board) {
    const pcs = [board.me, ...board.allies.filter((a) => a.type === "character")];
    return Math.round(pcs.reduce((s, c) => s + (c.level ?? 1), 0) / Math.max(1, pcs.length));
}
/** Moderate numbers for a creature of level L (GM Core's creature building tables, roughly). */
const MODERATE = { ac: (L) => 15 + L + (L >= 5 ? 1 : 0) + (L >= 15 ? 1 : 0), save: (L) => 5 + L + (L >= 4 ? 1 : 0) + (L >= 11 ? 1 : 0), hp: (L) => Math.max(8, 7 + 13 * L) };
/** Does a player see this token's bars? (The GM's choice on the token.) */
function barsVisible(e) {
    const mode = e.token?.document?.displayBars ?? 0;
    const M = CONST.TOKEN_DISPLAY_MODES ?? {};
    return mode === (M.ALWAYS ?? 50) || mode === (M.HOVER ?? 30);
}
/**
 * A foe as the party can judge it: AC from the party's hits and misses this fight (the middle of the bounds),
 * saves from the rolls it has made, HP from its bar when players can see it, otherwise a creature of the party's
 * level. Nothing from its sheet: no weaknesses, no skills, no level.
 */
function estimateFoe(board, e, known, L) {
    const k = known?.[e.id] ?? {};
    const mid = (v, fallback) => {
        if (!v || typeof v !== "object" || !(v.n > 0)) return fallback;
        const lo = Number.isFinite(v.lo) ? v.lo : null, hi = Number.isFinite(v.hi) ? v.hi : null;
        if (lo !== null && hi !== null) return Math.round((lo + hi) / 2);
        if (lo !== null) return Math.max(lo, fallback);
        if (hi !== null) return Math.min(hi, fallback);
        return fallback;
    };
    const bars = barsVisible(e);
    const did = shownDoing(game.combat, e.id);
    return { ...e,
        // What the sheet knows and the party doesn't: its senses, languages, class, spell list, ranged attacks and
        // feats (All-Around Vision, Deny Advantage) are left out; casting, shooting and healing count once seen
        actor: undefined, cls: null, senses: null, languages: [], flankImmune: null,
        caster: did.has("cast"), healer: did.has("heal"), rangedReach: did.has("ranged") || did.has("cast") ? 60 : 0,
        level: L,
        // the party's bounds are the AC it rolled against; an off-guard foe's estimate drops by 2 like a sheet's would
        ac: mid(k.ac, MODERATE.ac(L)) + (e.shieldBonus ?? 0) - (e.conditions && isOffGuard(e) ? 2 : 0),
        saves: Object.fromEntries(["fortitude", "reflex", "will"].map((s) => [s, mid(k[s], MODERATE.save(L))])),
        hp: bars ? e.hp : (e.hp > 0 ? MODERATE.hp(L) : 0), maxHp: bars ? e.maxHp : MODERATE.hp(L),
        iwr: { weak: [], resist: [], immune: [] },
        perception: null, athletics: null,
        // What its attacks are worth when weighing a square's risk: a creature of level L
        reactiveStrike: { bonus: L + 8, avg: 4 + L * 1.5 },
        estimated: !bars,
    };
}
/** Abilities classes.mjs plans itself (the advisor's generic reading of them is dropped). */
/** Actions a class read plans itself (3.1.1: one list per class), so the advisor's own text reading of them is set aside. */
const CLASS_HANDLED = new Set([
    "battle-medicine", "quick-draw", "mountaineering-training",
    // fighter
    "sudden-charge", "double-slice", "dueling-parry", "vicious-swing", "power-attack", "slam-down", "knockdown", "intimidating-strike", "swipe", "whirlwind-strike", "lunge", "sever-space", "overwhelming-blow", "double-shot", "triple-shot", "exacting-strike", "certain-strike", "brutish-shove", "dragging-strike", "combat-grab", "advantageous-assault", "shatter-defenses", "disarming-twist", "two-weapon-flurry", "brutal-finish", "snagging-strike", "desperate-finisher",
    // barbarian
    "rage", "thrash", "spirits-wrath", "terrifying-howl", "giants-stature", "titans-stature", "giants-lunge", "share-rage", "unbalancing-sweep",
    // ranger
    "hunt-prey", "twin-takedown", "hunted-shot", "deadly-aim", "hunters-aim", "impossible-flurry", "impossible-volley", "wardens-boon", "second-sting",
    // rogue
    "twin-feint", "nimble-dodge", "opportune-backstab", "youre-next", "debilitating-strike", "tumble-behind", "instant-opening", "spring-from-the-shadows", "skirmish-strike", "twist-the-knife", "analyze-weakness",
    // champion
    "smite", "blessed-counterstrike", "gruesome-strike",
    // commander (tactics carry the tactic trait and are dropped by it)
    "gather-to-me", "pincer-attack", "quickening-banner", "pennant-of-victory", "defiant-banner", "banner-twirl", "banners-inspiration", "confusing-commands", "demand-surrender", "mercenary-reversal", "double-team", "tactical-takedown", "plant-banner", "set-up-strike", "guiding-shot", "unsteadying-strike", "rallying-banner",
    // magus
    "spellstrike", "arcane-cascade", "spell-swipe", "whirlwind-spell", "recharging-flurry", "lunging-spellstrike",
    // thaumaturge
    "exploit-vulnerability", "glimpse-vulnerability", "drink-from-the-chalice", "intensify-vulnerability", "twin-weakness", "divine-disharmony", "root-to-life", "implements-assault", "fling-magic", "mirrors-reflection",
    // alchemist
    "quick-alchemy", "quick-bomber", "mega-bomb",
    // cleric
    "channel-smite", "cast-down", "divine-weapon", "restorative-strike",
    // druid
    "untamed-form", "untamed-shift", "command-an-animal",
    // investigator
    "devise-a-stratagem", "person-of-interest", "pointed-question", "just-as-planned",
    // oracle
    "whispers-of-weakness", "nudge-the-scales", "debilitating-dichotomy", "on-borrowed-time", "the-dead-walk", "trial-by-skyfire", "waters-of-creation",
    // monk
    "flurry-of-blows", "monks-flurry", "tiger-slash", "wolf-drag", "dragon-roar", "gorilla-pound", "mountain-quake", "wild-winds-gust", "whirling-throw", "sleeper-hold", "wave-dashes-rocks", "flying-kick", "knockback-strike", "one-inch-punch", "disrupt-qi", "flinging-blow", "shattering-strike-monk", "mixed-maneuver",
    "asp-stance", "clinging-shadows-stance", "cobra-stance", "crane-stance", "dragon-stance", "flood-stance", "fuse-stance", "gorilla-stance", "ironblood-stance", "jellyfish-stance", "kaiju-stance", "monastic-archer-stance", "mountain-stance", "peafowl-stance", "rain-of-embers-stance", "reflective-ripple-stance", "reflexive-stance", "rushing-goat-stance", "shooting-stars-stance", "stoked-flame-stance", "stumbling-stance", "tangled-forest-stance", "tiger-stance", "twisting-petal-stance", "vitality-manipulating-stance", "waterfowl-stance", "whirling-blade-stance", "wild-winds-stance", "wolf-stance",
    // swashbuckler
    "confident-finisher", "basic-finisher", "unbalancing-finisher", "retreating-finisher", "bleeding-finisher", "dual-finisher", "impaling-finisher", "stunning-finisher", "stumbling-finisher", "targeting-finisher", "mobile-finisher", "perfect-finisher", "revitalizing-finisher", "lethal-finisher", "illimitable-finisher", "lunging-finisher", "vexing-tumble", "the-bigger-they-are", "leading-dance", "extravagant-parry",
    // witch (and wizard: quickened casting)
    "sympathetic-strike", "split-hex", "quickened-casting", "siphon-power", "cackle", "patrons-presence", "patrons-claim", "shed-spirit", "stitching-strike",
    // inventor
    "overdrive", "explode", "megaton-strike", "megavolt", "searing-restoration", "tamper", "oil-fire", "electrify-armor", "wukong-extension", "devastating-weaponry", "overdrive-ally", "helpful-tinkering", "lock-on", "engine-of-destruction", "command-a-construct",
    // psychic
    "psi-burst", "violent-unleash", "brain-drain", "restore-the-mind", "strain-mind", "unleash-psyche",
    // kineticist
    "channel-elements", "elemental-blast", "extract-element", "chain-infusion", "two-element-infusion", "weapon-infusion", "lightning-rod", "magnetic-pinions", "aerial-boomerang", "flying-flame", "hail-of-splinters", "scorching-column", "shard-strike", "tidal-hands", "tremor", "winters-clutch", "fresh-produce", "oceans-balm", "blazing-wave", "lava-leap", "lightning-dash", "tumbling-lumber", "whirling-grindstone", "ash-strider", "driving-rain", "elemental-artillery", "molten-wire", "rising-hurricane", "roiling-mudslide", "torrent-in-the-blood", "tree-of-duality", "weight-of-stone", "dash-of-herbs", "sand-snatcher", "call-the-hurricane", "conductive-sphere", "retch-rust", "sanguivolent-roots", "solar-detonation", "storm-spiral", "burning-demand", "glacial-prison", "rain-of-razors", "witchwood-seed", "walk-through-the-conflagration", "all-shall-end-in-flames", "hell-of-1-000-000-needles", "ignite-the-sun", "ride-the-tsunami", "rouse-the-forests-fury", "the-shattered-mountain-weeps", "the-thousand-lashes-of-the-weeping-willow", "geologic-attunement", "air-shroud", "magnetic-field", "ravel-of-thorns", "thermal-nimbus", "winter-sleet", "desert-wind", "steam-knight", "kindle-inner-flames", "drifting-pollen", "drowning-mist", "ghosts-in-the-storm", "sea-glass-guardians", "shattershields", "assume-earths-mantle", "orchards-endurance", "crowned-in-tempests-fury",
    // summoner
    "act-together", "manifest-eidolon", "tandem-strike", "magical-onslaught", "seething-frenzy", "furious-strike", "beasts-charge", "draconic-frenzy", "dragon-breath", "primal-roar", "whirlwind-maul", "drain-life", "visions-of-sin", "field-of-roots", "elemental-burst", "elemental-maelstrom", "piercing-jab", "eidolons-trample", "ostentatious-arrival",
    // gunslinger
    "reloading-strike", "raconteurs-reload", "covered-reload", "thoughtful-reload", "clear-a-path", "touch-and-go", "risky-reload", "paired-shots", "twin-shot-knockdown", "two-weapon-fusillade", "drifters-juke", "bullet-split", "penetrating-fire", "snipers-aim", "called-shot", "headshot", "vital-shot", "ghost-shot", "blast-tackle", "pistol-twirl", "scatter-blast", "alchemical-shot", "final-shot", "pistoleros-challenge", "triggerbrand-salvo", "stab-and-blast", "break-them-down", "wind-them-up", "spinning-crush", "siegebreaker", "drifters-wake", "triggerbrand-blitz", "grim-swagger", "dance-of-thunder", "flesh-wound",
    // guardian
    "taunt", "taunting-strike", "shielding-taunt", "shoulder-check", "proud-nail", "ring-their-bell", "weakening-assault", "demolish-defenses", "shield-wallop", "clobber", "momentum-strike", "bloody-denial", "belly-flop", "stomp-ground", "flying-tackle", "scattering-charge", "retaliating-rescue", "armor-break", "hampering-stance", "covering-stance", "lock-down", "blanket-defense", "armored-courage", "tough-cookie",
    // animist
    "grudge-strike", "forests-heart", "circle-of-spirits",
    // necromancer
    "create-thrall", "thrall-charge", "command-a-thrall", "consume-thrall", "draining-strike", "anatomical-quartering", "reclaim-power", "amalgamate", "infuse-void", "skeletal-extension",
    // runesmith
    "trace-rune", "invoke-rune", "solitary-invocation", "engraving-strike", "remote-detonation", "pattern-flight", "swiping-trace", "engraving-maneuver", "edifying-trace", "fortifying-knock", "terrifying-invocation", "transpose-etching", "words-fly-free", "dance-of-bloody-ink", "chain-of-words", "vital-compound-invocation", "song-of-glorious-invocation", "tracing-trance",
    // exemplar
    "shift-immanence", "flowing-spirit-strike", "strike-breathe-rend", "drink-of-my-foes", "reap-the-field", "fracture-mountains", "feral-swing", "giant-felling-comet", "arrow-splits-arrow", "liars-hidden-blade", "blinding-of-the-needle", "coiling-serpents", "sever-four-dragonfly-wings", "plant-thirty-barbs", "burn-out-of-time", "rejoin-in-flight", "topple-the-pillar-of-heaven", "heaven-rains-an-ending", "fleeting-arc-through-heaven-and-earth", "ringing-challenge", "one-moment-till-glory", "break-free", "embrace-of-destiny", "marathon-dash", "raise-the-walls", "no-scar-but-this", "a-moment-unending", "captivating-charm", "tangle-in-riddle", "mark-the-center", "heavy-is-the-crown",
]);
/** The board the advisor plans on for a player: foes as estimates, no threat table, the character read as sharp. */
function adviceBoard(board, ledger) {
    const known = flagOf(game.combat, "party") ?? {};
    const L = setting("helperKnowsLevel", false) ? null : partyLevel(board);
    const est = (e) => estimateFoe(board, e, known, L ?? e.level ?? partyLevel(board));
    const seen = board.seenFoes.map(est);
    // Abilities classes.mjs reads itself are kept from the advisor, which would misread them (a tactic as a debuff)
    const slug = (n) => String(n ?? "").toLowerCase().replace(/['\u2019]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");  // apostrophes drop, as Foundry's sluggify does ("hunters-aim")
    const profiles = board.profiles.filter((p) => !(p.traits ?? []).includes("tactic") && !CLASS_HANDLED.has(slug(p.name)));
    return { ...board,
        me: { ...board.me, int: Math.max(3, board.me.int ?? 0), pc: true },
        profiles,
        enemies: seen,
        downEnemies: (board.downEnemies ?? []).map(est),
        threat: {},
        learned: known,
        vicious: false,
        turn: ledger ? ledgerTotals(ledger) : null,
    };
}

/* ------------------------------------------------------------------ advice */

/** The advisor's wording is for a creature; this is for the player. */
const YOU = [[/\bif it can\b/g, "if you can"], [/\bit must\b/g, "you must"], [/\bIts last action/g, "Your last action"], [/\bIts last actions/g, "Your last actions"], [/\bit has\b/g, "you have"], [/\bwhat it has\b/g, "what you have"],
    [/\bto stay up\b/g, "to stay up"], [/\bTake Cover behind something if it can\b/g, "Take Cover behind something if you can"], [/\bcan't see it there\b/g, "can't see you there"]];
const forYou = (text) => YOU.reduce((t, [re, to]) => t.replace(re, to), text);
/** How many actions the character has this turn, less those spent (the advisor's own count, redone here for the class reads). */
function actionsLeft(board, ledger) {
    const cv = board.me.conditionValues ?? {};
    const mc = board.me.conditions ?? new Set();
    const base = Math.max(0, Math.min(3, 3 - (cv.stunned ? cv.stunned : cv.slowed ?? 0))) + (mc.has("quickened") && !cv.stunned ? 1 : 0);
    const t = ledger ? ledgerTotals(ledger) : null;
    return { actions: Math.max(0, base - (t?.spent ?? 0)), made: t?.attacks ?? 0, spent: t?.spent ?? 0 };
}
/** A hidden foe is a target only when nothing else stands, or the plan is an area or a reveal. */
function allowedTarget(board, plan) {
    const t = plan.target;
    if (!t) return true;
    const f = board.seenFoes.find((x) => x.id === t.id);
    if (!f || f.state !== "hidden") return true;
    if (plan.kind === "area") return true;
    if (plan.spell && REVEAL_SPELLS.some((r) => r.re.test(plan.spell.name ?? ""))) return true;
    const others = board.seenFoes.filter((x) => x.state !== "hidden");
    return others.length === 0 && board.unseenKnown === 0;
}
/** The advisor's turn for this character, plus what its class adds. */
function adviseHelper(board, ledger) {
    const b = adviceBoard(board, ledger);
    const ctx = actionsLeft(board, ledger);
    // The class reads first: it can mark the board (sneak attack dice, foes off-guard to this character) before the advisor plans
    let cls = { plans: [], notes: [] };
    try { cls = classFeatures(b, ctx); } catch (err) { console.warn(`${MODULE_ID} | couldn't read the class`, err); }
    let plans = [];
    try { plans = planTurn(b, {}) ?? []; } catch (err) { console.warn(`${MODULE_ID} | couldn't plan the player's turn`, err); }
    plans = plans.filter((p) => !["none"].includes(p.kind) || plans.length === 1).filter((p) => allowedTarget(board, p));
    const clsPlans = cls.plans.filter((p) => allowedTarget(board, p));
    const thriftNote = spellThrift(b, [...plans, ...clsPlans]);
    const all = [...plans, ...clsPlans].map((p) => ({ ...p, steps: p.steps.map((s) => ({ ...s, text: forYou(s.text) })), notes: (p.notes ?? []).map(forYou) }));
    all.sort((a, c) => (c.score ?? c.ev) - (a.score ?? a.ev));
    const estimated = b.enemies.some((e) => e.estimated) || b.enemies.some((e) => !(flagOf(game.combat, "party")?.[e.id]?.ac?.n > 0));
    return { plans: all, notes: [...cls.notes, ...(thriftNote ? [thriftNote] : [])], actions: ctx.actions, estimated };
}
function adviceSectionFor(board, adv) {
    const key = "h-advice";
    if (!adv.plans.length) {
        const why = board.seenFoes.length ? "Nothing you have reaches a foe this turn: close the distance, take cover, or hold." : "No foe you can see. Seek, hold, or help someone.";
        return panel("Your Turn", { key, open: true, cls: "npt-act", body: `<p class="npt-dim">${why}</p>` });
    }
    const best = adv.plans[0];
    const notes = best.notes?.length ? `<div class="npt-notes">${best.notes.map(esc).join(" · ")}</div>` : "";
    const seen = new Set([`${best.kind}|${best.target?.id ?? ""}|${best.title}`]);
    const alts = [];
    for (const p of adv.plans.slice(1)) {
        const k = `${p.kind}|${p.target?.id ?? ""}`;
        if (seen.has(k) || seen.has(`${p.kind}|${p.target?.id ?? ""}|${p.title}`) || alts.some((a) => a.title === p.title)) continue;
        seen.add(k);
        alts.push(p);
        if (alts.length >= 3) break;
    }
    const altHtml = alts.length ? `<details class="npt-alts" data-npt-fold="h-alts"${foldOpen("h-alts", true) ? " open" : ""}><summary>${alts.length} other option${alts.length === 1 ? "" : "s"}</summary><ul>${alts.map((p) => `<li><strong>${esc(titleCase(p.title))}</strong>: ${p.steps.map((s) => esc(s.text)).join("; ")}${p.notes?.length ? ` <span class="npt-dim">(${esc(p.notes[0])})</span>` : ""}</li>`).join("")}</ul></details>` : "";
    const foot = `<div class="npt-dim npt-est">${adv.estimated ? "Odds are estimates: a foe's AC and saves come from the party's rolls against it this fight, and until then from a creature of your level. Nothing comes from its sheet." : "Odds use what the party's rolls have shown of each foe this fight."}</div>`;
    return panel("Your Turn", { key, open: true, cls: "npt-act", sum: esc(titleCase(best.title)), body: `<div class="npt-plan-title">${esc(titleCase(best.title))}</div>${stepsHtml(best.steps)}${notes}${altHtml}${foot}` });
}
function classSection(adv) {
    if (!adv.notes.length) return "";
    return panel("Your Class", { key: "h-class", open: true, body: `<ul class="npt-list">${adv.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` });
}

/* ------------------------------------------------------------------ the card */

const COVER_NAME = { 1: "lesser cover (+1 AC)", 2: "standard cover (+2 AC)", 4: "greater cover (+4 AC)" };
const STATE_NOTE = {
    concealed: "concealed: DC 5 flat check to target",
    hidden: "hidden: you know the square, not the creature. DC 11 flat check to target; Seek to observe it",
};

function foeLine(f) {
    const bits = [];
    if (f.state !== "observed") bits.push(STATE_NOTE[f.state] ?? f.state);
    if (f.cover) bits.push(COVER_NAME[f.cover] ?? "cover");
    const conds = [...(f.conditions ?? [])].filter((c) => !["hidden", "undetected", "concealed", "invisible"].includes(c));
    if (conds.length) bits.push(conds.join(", "));
    if (f.known) bits.push(f.known);
    if (f.shown?.size) bits.push(`has used ${[...f.shown].join(", ")} this fight`);
    const size = f.sizeRank != null ? ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"][f.sizeRank] ?? "" : "";
    return `<li><strong>${esc(nameOf(f))}</strong>${size ? ` <span class="npt-dim">${size}</span>` : ""}${bits.length ? `: ${esc(bits.join(" · "))}` : ""}</li>`;
}

function reachSection(board) {
    const me = board.me;
    const melee = (board.strikes ?? []).filter((s) => !s.ranged);
    const reach = melee.length ? Math.max(...melee.map((s) => s.reach || 5)) : 0;
    const foes = board.seenFoes;
    const inMine = reach ? foes.filter((f) => inReach(me.rect, f.rect, reach)) : [];
    const onMe = foes.filter((f) => inReach(f.rect, me.rect, f.reach || 5));
    const rows = [];
    rows.push(`<div class="npt-row"><span class="npt-k">In your reach</span>${inMine.length ? esc(inMine.map(nameOf).join(", ")) : reach ? "nobody" : "no melee Strike"}</div>`);
    rows.push(`<div class="npt-row"><span class="npt-k">Can reach you</span>${onMe.length ? esc(onMe.map((f) => `${nameOf(f)}${(f.reach || 5) > 5 ? ` (reach ${f.reach})` : ""}`).join(", ")) : "nobody"}</div>`);
    // Where a Step takes you out of everyone's reach
    const stepOut = [...(board.field?.step?.values() ?? [])].filter((c) => c.end && !(c.x === me.rect.x && c.y === me.rect.y)
        && !onMe.some((f) => inReach(f.rect, { x: c.x, y: c.y, w: me.rect.w, h: me.rect.h, z: me.rect.z }, f.reach || 5)));
    if (onMe.length) rows.push(`<div class="npt-row"><span class="npt-k">Step</span>${stepOut.length ? `${stepOut.length} square${stepOut.length === 1 ? "" : "s"} take you out of their reach (a Step never provokes)` : "no Step gets you out of their reach"}</div>`);
    return panel("Reach", { key: "h-reach", open: true, body: rows.join("") });
}

function strikesSection(board) {
    const me = board.me;
    const strikes = board.strikes ?? [];
    if (!strikes.length) return "";
    const foes = board.seenFoes;
    const squares = reachableSquares(board, 1);
    const items = strikes.map((s) => {
        const map = s.agile ? "−4 / −8 after the first" : "−5 / −10 after the first";
        const here = foes.filter((f) => (s.ranged ? feetBetween(me.rect, f.rect) <= (s.range ?? 30) * 6 : inReach(me.rect, f.rect, s.reach || 5)));
        const afterMove = s.ranged ? [] : foes.filter((f) => !here.includes(f) && squares.some((sq) => sq.route.actions <= 1 && inReach({ x: sq.x, y: sq.y, w: me.rect.w, h: me.rect.h, z: sq.z ?? me.rect.z }, f.rect, s.reach || 5)));
        const tgt = (f) => {
            const extra = [];
            if (s.ranged) {
                const d = feetBetween(me.rect, f.rect);
                const inc = s.range ? Math.max(0, Math.ceil(d / s.range) - 1) : 0;
                if (inc) extra.push(`${inc} range increment${inc === 1 ? "" : "s"} out: −${2 * inc}`);
                if (s.volley && d <= s.volley) extra.push(`volley: −2 this close`);
            }
            if (f.state === "concealed") extra.push("DC 5 flat check");
            if (f.state === "hidden") extra.push("DC 11 flat check");
            if (f.cover) extra.push(COVER_NAME[f.cover] ?? "cover");
            return `${esc(nameOf(f))}${extra.length ? ` <span class="npt-dim">(${esc(extra.join("; "))})</span>` : ""}`;
        };
        const who = here.length ? here.map(tgt).join(", ") : "nobody from here";
        const later = afterMove.length ? ` · after a Stride: ${afterMove.map((f) => esc(nameOf(f))).join(", ")}` : "";
        return `<li><strong>${esc(s.label)}</strong> ${signed(s.bonus)}${s.ranged ? ` <span class="npt-dim">(range ${s.range ?? "?"} ft${s.reload ? `, reload ${s.reload}` : ""})</span>` : (s.reach || 5) > 5 ? ` <span class="npt-dim">(reach ${s.reach})</span>` : ""}: ${who}${later}<div class="npt-dim">MAP ${map}${s.traits?.length ? ` · ${esc(s.traits.filter((t) => !/^(?:magical|range-|reload-|thrown-|volley-|attack)/.test(t)).join(", "))}` : ""}</div></li>`;
    });
    return panel("Strikes", { key: "h-strikes", open: true, body: `<ul class="npt-list">${items.join("")}</ul>` });
}

function flankSection(board) {
    const me = board.me;
    if (!(board.strikes ?? []).some((s) => !s.ranged)) return "";
    const foes = board.seenFoes.filter((f) => f.state !== "hidden");
    const squares = reachableSquares(board, 2);
    const rows = [];
    for (const f of foes) {
        // Already flanking from where you stand?
        const now = flankingAlly(board, me.rect, f);
        if (now && inReach(me.rect, f.rect, Math.max(...board.strikes.filter((s) => !s.ranged).map((s) => s.reach || 5)))) { rows.push(`<li><strong>${esc(nameOf(f))}</strong>: you flank with ${esc(nameOf(now))} now (off-guard to your melee Strikes)</li>`); continue; }
        const options = squares.filter((sq) => sq.route.actions >= 1 && sq.route.actions <= 2).map((sq) => ({ sq, ally: flankingAlly(board, { x: sq.x, y: sq.y, w: me.rect.w, h: me.rect.h, z: sq.z ?? me.rect.z }, f) })).filter((o) => o.ally);
        if (!options.length) continue;
        const best = options.sort((a, b) => a.sq.route.actions - b.sq.route.actions || a.sq.route.provokes.length - b.sq.route.provokes.length)[0];
        rows.push(`<li><strong>${esc(nameOf(f))}</strong>: ${best.sq.route.actions === 1 ? "one move" : "two moves"} to flank with ${esc(nameOf(best.ally))}${best.sq.route.via ? ` <span class="npt-dim">(${esc(best.sq.route.via)})</span>` : ""}</li>`);
    }
    // Who flanks you
    const flankedBy = [];
    for (const a of foes) for (const b of foes) {
        if (a === b || !inReach(a.rect, me.rect, a.reach || 5) || !inReach(b.rect, me.rect, b.reach || 5)) continue;
        if (flanks(a.rect, b.rect, me.rect) && !flankedBy.some(([x, y]) => (x === b && y === a))) flankedBy.push([a, b]);
    }
    if (flankedBy.length) rows.push(`<li class="npt-warn">You are flanked by ${esc(flankedBy.map(([a, b]) => `${nameOf(a)} and ${nameOf(b)}`).join("; "))}: off-guard to their melee attacks</li>`);
    if (!rows.length) return "";
    return panel("Flanking", { key: "h-flank", open: true, body: `<ul class="npt-list">${rows.join("")}</ul>` });
}

function moveSection(board) {
    const me = board.me;
    const rows = [];
    const adjacent = board.seenFoes.filter((f) => inReach(f.rect, me.rect, f.reach || 5));
    const shownMove = adjacent.filter((f) => [...f.shown].some((n) => /reactive strike|attack of opportunity|opportunist|stand still/i.test(n)));
    if (shownMove.length) rows.push(`<div class="npt-row npt-warn"><span class="npt-k">Provokes</span>moving out of reach of ${esc(shownMove.map(nameOf).join(", "))} (they have shown a Reactive Strike this fight); a Step doesn't</div>`);
    else if (adjacent.length) rows.push(`<div class="npt-row"><span class="npt-k">Provokes</span>${esc(adjacent.map(nameOf).join(", "))} ${adjacent.length === 1 ? "is" : "are"} in reach of you: moving away may set off a reaction if they have one. A Step never does</div>`);
    const stride = board.move?.stride;
    if (stride?.feet) rows.push(`<div class="npt-row"><span class="npt-k">Speed</span>${stride.feet} ft${board.move?.speeds?.fly ? `, fly ${board.move.speeds.fly}` : ""}${board.move?.speeds?.swim ? `, swim ${board.move.speeds.swim}` : ""}${board.move?.speeds?.climb ? `, climb ${board.move.speeds.climb}` : ""}</div>`);
    // Cover you could take from the foes who can reach or shoot you
    if (board.seenFoes.length) {
        const sq = reachableSquares(board, 1).filter((s) => s.route.actions === 1 && !s.route.provokes.length);
        const covered = sq.filter((s) => board.seenFoes.every((f) => coverBetween(board, f.rect, { ...me, rect: { x: s.x, y: s.y, w: me.rect.w, h: me.rect.h, z: s.z ?? me.rect.z } }, { ranged: true, fromSize: f.sizeRank ?? 2 }) >= 2)).length;
        if (covered) rows.push(`<div class="npt-row"><span class="npt-k">Cover</span>${covered} square${covered === 1 ? "" : "s"} one move away ${covered === 1 ? "has" : "have"} standard cover from everyone you can see; Take Cover there for greater</div>`);
    }
    if (!rows.length) return "";
    return panel("Moving", { key: "h-move", open: true, body: rows.join("") });
}

function foesSection(board) {
    const foes = board.seenFoes;
    const rows = [];
    if (foes.length) rows.push(`<ul class="npt-list">${foes.map(foeLine).join("")}</ul>`);
    const hidden = foes.filter((f) => f.state === "hidden");
    if (hidden.length) {
        const lines = [];
        const lastOne = foes.length === hidden.length && board.unseenKnown === 0;
        if (lastOne) lines.push(`${hidden.length === 1 ? `${esc(nameOf(hidden[0]))} is the last foe standing and it's hidden` : "Every foe left is hidden"}: Seek (one action, Perception against its Stealth DC) to observe it, attack its square with a DC 11 flat check, or cover the square with an area, which needs no flat check.`);
        else lines.push(`A hidden foe: Seek to observe it before you commit to it, or leave it to someone who can.`);
        for (const w of board.reveals) lines.push(esc(w.text));
        rows.push(`<div class="npt-hidden">${lines.map((l) => `<div>${l}</div>`).join("")}</div>`);
    }
    if (board.unseenKnown) rows.push(`<div class="npt-hidden">Something in this fight is undetected by you${board.unseenKnown > 1 ? ` (${board.unseenKnown} of them)` : ""}: Seek a 30-foot cone or 15-foot burst (one action) to find it${board.reveals.some((w) => w.kind === "reveal") ? `, or ${esc(board.reveals.find((w) => w.kind === "reveal").name)} on where you think it is` : ""}.</div>`);
    if (!rows.length) return panel("Foes", { body: `<div class="npt-dim">Nobody you can see.</div>` });
    return panel("Foes", { key: "h-foes", open: true, body: rows.join("") });
}

function helperBody(board) {
    return reachSection(board) + strikesSection(board) + flankSection(board) + moveSection(board) + foesSection(board);
}

function turnLine(actor) {
    const combat = game.combat;
    if (!combat?.started) return `<div class="npt-dim">No fight on.</div>`;
    const c = combat.combatant;
    const mine = c?.actor === actor || c?.actor?.id === actor.id;
    if (mine) return "";
    return `<div class="npt-dim npt-notyet">${c?.name ? `${esc(c.name)}'s turn` : "Not your turn"}: this is what you could do when yours comes.</div>`;
}

async function buildHelper(actor, token) {
    const placeable = token?.object ?? (token?.document ? token : null) ?? (token?.documentName === "Token" ? tokenStandIn(token) : null)
        ?? canvas?.tokens?.placeables?.find((t) => t.actor === actor) ?? null;
    const name = placeable?.name ?? token?.name ?? actor.name;
    const top = `<div class="npt-top">${actor.img ? `<img src="${esc(actor.img)}" alt="">` : ""}
        <div class="npt-who"><h3>${link(actor, name)}</h3>${statusLine(actor)}</div></div>`;
    let board = null;
    try { board = placeable ? await readHelperBoard(placeable) : null; } catch (err) { console.error(`${MODULE_ID} | turn helper failed`, err); }
    const ledger = board ? ledgerFor(actor, placeable ?? token) : null;
    let advice = "";
    if (board) {
        try { const adv = adviseHelper(board, ledger); advice = adviceSectionFor(board, adv) + classSection(adv); }
        catch (err) { console.error(`${MODULE_ID} | turn advice failed`, err); advice = panel("Your Turn", { cls: "npt-act", body: `<p class="npt-dim">Couldn't work out a turn from this board.</p>` }); }
    }
    const body = board
        ? advice + helperBody(board)
        : `<div class="npt-dim">${placeable ? "Couldn't read the scene." : "No token of yours on this scene."}</div>`;
    const buttons = `<div class="npt-foot"><button type="button" data-npt-refresh><i class="fa-solid fa-rotate"></i> Refresh</button></div>`;
    return `<div class="npt-card npt-helper">${top}${turnLine(actor)}${ledger ? turnHtml(ledger, board) : ""}<div class="npt-body">${body}</div>${buttons}</div>`;
}

/* ------------------------------------------------------------------ the window */

function savedHelperPosition() {
    try { return JSON.parse(localStorage.getItem(HELPER_POSITION_KEY) ?? "{}") ?? {}; } catch { return {}; }
}

let HelperWindow = null;
function helperClass() {
    if (HelperWindow) return HelperWindow;
    HelperWindow = class extends foundry.applications.api.ApplicationV2 {
        static DEFAULT_OPTIONS = {
            id: `${MODULE_ID}-helper`,
            classes: ["npt-window", "npt-helper-window"],
            window: { title: "Turn Helper", icon: "fa-solid fa-eye", resizable: true },
            position: { width: 440, height: "auto" },
        };
        constructor(options = {}) {
            const pos = savedHelperPosition();
            super(foundry.utils.mergeObject(options, { position: Object.fromEntries(Object.entries({ left: pos.left, top: pos.top, width: pos.width }).filter(([, v]) => Number.isFinite(v))) }, { inplace: false }));
            this.actor = null;
            this.token = null;
        }
        get title() { return this.actor ? `Turn Helper: ${this.token?.name ?? this.actor.name}` : "Turn Helper"; }
        async _renderHTML() {
            const html = this.actor ? await buildHelper(this.actor, this.token) : "<p>No character.</p>";
            const editor = foundry.applications.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
            return editor.enrichHTML(html, { async: true });
        }
        _replaceHTML(result, content) {
            content.innerHTML = result;
            const titleEl = this.window?.title ?? this.element?.querySelector?.(".window-title");
            if (titleEl) titleEl.textContent = this.title;
            Object.assign(content.style, { maxHeight: "78vh", overflowY: "auto" });
            bindCard(content, () => this.render());
        }
        setPosition(position) {
            const result = super.setPosition(position);
            try { const p = this.position; localStorage.setItem(HELPER_POSITION_KEY, JSON.stringify({ left: p.left, top: p.top, width: p.width })); } catch { /* blocked storage */ }
            return result;
        }
    };
    return HelperWindow;
}

let helperWindow = null;
async function showHelper(actor, token) {
    const Cls = helperClass();
    helperWindow ??= new Cls();
    helperWindow.actor = actor;
    helperWindow.token = token ?? null;
    await helperWindow.render({ force: true });
}

/** The character to help: a selected token the user owns, else their assigned character's token on the scene. */
function helperTarget() {
    const owned = (canvas?.tokens?.controlled ?? []).filter((t) => t.actor?.isOwner && t.actor.type === "character");
    if (owned.length) return [owned[0].actor, owned[0]];
    const mine = game.user.character;
    if (mine) {
        const tok = canvas?.tokens?.placeables?.find((t) => t.actor === mine || t.actor?.id === mine.id) ?? null;
        return [mine, tok];
    }
    const any = (canvas?.tokens?.placeables ?? []).find((t) => t.actor?.isOwner && t.actor.type === "character");
    return any ? [any.actor, any] : null;
}

async function openHelper(target) {
    let pair = null;
    if (target?.actor && target?.document) pair = [target.actor, target];
    else if (target?.documentName === "Token") pair = [target.actor, target.object ?? target];
    else if (target?.documentName === "Actor") pair = [target, canvas?.tokens?.placeables?.find((t) => t.actor === target) ?? null];
    else pair = helperTarget();
    if (!pair?.[0]) return ui.notifications.warn("Select your character's token, or have a character assigned to you.");
    if (!pair[0].isOwner) return ui.notifications.warn("The Turn Helper is for your own character.");
    await showHelper(...pair);
}

let helperTimer = null;
function refreshHelper(delay = 250) {
    if (!helperWindow?.rendered || !helperWindow.actor) return;
    clearTimeout(helperTimer);
    helperTimer = setTimeout(() => helperWindow?.rendered && helperWindow.render(), delay);
}

/* ------------------------------------------------------------------ spell thrift */

/** Spell slots left by rank, from the character's spellcasting entries: { rank: { left, max } }. Prepared entries count the
 *  spells still prepared and not expended; spontaneous ones their uses left. Empty when the sheet carries no slots. */
function slotsByRank(actor) {
    const out = {};
    for (const e of actor?.spellcasting?.regular ?? []) {
        if (e.isFocusPool || e.isRitual) continue;
        const slots = e.system?.slots ?? {};
        for (const [key, slot] of Object.entries(slots)) {
            const rank = Number(key.replace("slot", ""));
            if (!rank || !(slot?.max > 0)) continue;
            const prepared = Array.isArray(slot.prepared) ? slot.prepared : Object.values(slot.prepared ?? {});
            const left = e.isPrepared && !e.isFlexible ? prepared.filter((p) => p?.id && !p.expended).length : Math.max(0, Number(slot.value) || 0);
            const cur = out[rank] ?? (out[rank] = { left: 0, max: 0 });
            cur.left += left; cur.max += slot.max;
        }
    }
    return out;
}
const THRIFT = { frugal: 1.5, normal: 1, free: 0 };
/**
 * A slot spent now is a slot gone for the day's later fights, so a slot spell has to beat the best cantrip by a clear
 * margin to be the recommended turn. Each slot plan's score drops by a reserve that grows with the slot's rank (the top
 * ranks are the day's decisive spells), shrinks as more slots of that rank remain, and halves when the spell is decisive
 * here (two or more foes caught, or a foe it can drop). Cantrips, focus spells, heals and buffs are never taxed. The
 * plan's own note says the numbers, so the player sees why the cantrip came first. Returns a one-line class note.
 */
function spellThrift(board, plans) {
    const mult = THRIFT[setting("helperThrift", "normal")] ?? 1;
    if (!mult) return null;
    const spells = board.spells ?? [];
    const slotSpells = spells.filter((sp) => !sp.cantrip && !sp.consumable && !sp.potion && sp.cost !== null && !sp.focus && !sp.isFocus);
    if (!slotSpells.length) return null;
    const byRank = slotsByRank(board.me.actor);
    const top = Math.max(...slotSpells.map((sp) => sp.rank || 1), ...Object.keys(byRank).map(Number));
    // A class plan that spends a slot says so with plan.spell (a board spell) or plan.slot ({ rank, name }); one that weighs
    // its own slot (Spellstrike) sets plan.thrifted. Plans that spend nothing are the baseline when there's no cantrip.
    const spellOf = (p) => p.spell ?? (p.slot ? { name: p.slot.name, rank: p.slot.rank } : null) ?? (p.kind === "area" ? spells.find((sp) => p.title.startsWith(`${sp.name}:`)) : null);
    const free = (p) => { const sp = spellOf(p); return !sp || sp.cantrip || sp.focus || sp.isFocus; };
    const cantripPlans = plans.filter((p) => p.spell?.cantrip && p.kind !== "heal");
    const bestCantrip = cantripPlans.reduce((b, p) => (!b || p.ev > b.ev ? p : b), null);
    const bestFree = bestCantrip ?? plans.filter((p) => free(p) && !p.thrifted && p.kind !== "none" && p.kind !== "heal").reduce((b, p) => (!b || p.ev > b.ev ? p : b), null);
    const baseline = Math.max(4, bestFree?.ev ?? 0);
    const freeName = bestCantrip ? bestCantrip.spell.name : bestFree ? `"${bestFree.title}"` : null;
    let taxed = 0;
    for (const p of plans) {
        if (p.thrifted) continue;
        const sp = spellOf(p);
        if (!sp || sp.cantrip || sp.consumable || sp.potion || sp.focus || sp.isFocus || p.kind === "heal" || p.kind === "buff" || p.revive) continue;
        const rank = sp.rank || 1;
        const left = byRank[rank]?.left ?? null;
        if (left === 0) continue;   // nothing to spend: the advisor's spell list already dropped it, this is just in case
        // an innate spell (no slot entry) or one from a staff or wand: no slot at stake
        if (!byRank[rank] && sp.entry && !(board.me.actor?.spellcasting?.regular ?? []).some((e) => e.name === sp.entry && !e.isFocusPool && !e.isInnate)) continue;
        const scarcity = left === null ? 0.6 : left >= 4 ? 0.3 : [1, 1, 0.7, 0.45][left];
        const decisive = (p.caught?.length ?? 0) >= 2 || (p.target && p.target.hp > 0 && p.ev >= p.target.hp);
        const reserve = Math.round(10 * mult * (0.5 + 1.5 * rank / Math.max(1, top)) * scarcity * baseline * (decisive ? 0.5 : 1)) / 10;
        const gain = p.ev - (bestFree?.ev ?? 0);
        p.score = (p.score ?? p.ev) - reserve;
        p.notes = p.notes ?? [];
        p.notes.push(`Spends a rank-${rank} slot${left !== null ? ` (${left} of ${byRank[rank].max} left)` : ""}: ${freeName ? `it has to beat ${freeName} (about ${Math.round(bestFree.ev)}) by about ${Math.round(reserve)} to be worth the slot; it does by ${Math.round(gain)}${gain >= reserve ? ", so spend it" : `, so ${bestCantrip ? "the cantrip" : "that"} keeps it`}` : `worth it only if the fight turns on it (about ${Math.round(reserve)} in reserve)`}${decisive ? "; it's decisive here, so the reserve is halved" : ""}.`);
        taxed++;
    }
    if (!taxed) return null;
    const ranks = Object.keys(byRank).map(Number).sort((a, b) => b - a).filter((r) => byRank[r].max > 0);
    const held = ranks.length ? ranks.map((r) => `${byRank[r].left}/${byRank[r].max} at rank ${r}`).join(", ") : "your slots";
    return `Spell thrift: a slot spent now is gone for the day's later fights, so a slot spell has to beat your best cantrip by a margin that grows with its rank and shrinks as more slots of that rank remain (${held}); two foes caught or a foe it can drop halves the margin. Cantrips and focus spells cost nothing, so they come first when the gain is small.`;
}

/* ------------------------------------------------------------------ hooks and settings */

Hooks.once("init", () => {
    game.settings.register(MODULE_ID, "helperKnowsLevel", {
        name: "Turn Helper: judge foes by their real level",
        hint: "Off (default), the helper's odds treat every foe as a creature of the party's level until the party's rolls say otherwise. On, it uses each creature's real level behind the scenes (never shown), for truer odds at the cost of a hint about how tough things are.",
        scope: "world", config: true, type: Boolean, default: false,
    });
    game.settings.register(MODULE_ID, "helperThrift", {
        name: "Turn Helper: spell thrift",
        hint: "How dearly the Turn Helper holds your spell slots. Normal (default): a slot spell is the recommended turn only when it beats your best cantrip by a margin that grows with its rank and shrinks as more slots remain. Frugal: half again as dear. Free-spending: slots are weighed on their damage alone.",
        scope: "client", config: true, type: String, choices: { frugal: "Frugal", normal: "Normal", free: "Free-spending" }, default: "normal",
    });
    game.settings.register(MODULE_ID, "helperAutoOpen", {
        name: "Turn Helper: open on my turn",
        hint: "Opens the Turn Helper for your character when your turn starts. Off, the \"PF2e Tactics: Turn Helper\" macro opens it.",
        scope: "client", config: true, type: Boolean, default: false,
    });
});

Hooks.once("ready", () => {
    const module = game.modules.get(MODULE_ID);
    module.api = Object.assign(module.api ?? {}, { helper: openHelper, helperCard: (actor, token) => (actor?.isOwner || game.user.isGM ? buildHelper(actor, token) : Promise.resolve("")) });
});

Hooks.on("updateCombat", (combat, changes) => {
    if (combat !== game.combat) return;
    if ("turn" in changes || "round" in changes) {
        refreshHelper(100);
        if (!game.user.isGM && setting("helperAutoOpen", false) && combat.started) {
            const c = combat.combatant;
            if (c?.actor?.isOwner && c.actor.type === "character" && c.actor.hasPlayerOwner) {
                const tok = c.token?.object ?? canvas?.tokens?.get?.(c.tokenId) ?? null;
                showHelper(c.actor, tok).catch((err) => console.warn(`${MODULE_ID} | couldn't open the Turn Helper`, err));
            }
        }
    }
    if ("started" in changes || changes.flags?.[MODULE_ID]?.party) refreshHelper(250);
});
Hooks.on("deleteCombat", () => { SHOWN.clear(); DID.clear(); refreshHelper(100); });
Hooks.on("createChatMessage", (message) => {
    try { noteReaction(message); } catch { /* not a card we read */ }
    const sp = message.speaker ?? {};
    if (helperWindow?.rendered && (sp.actor === helperWindow.actor?.id || sp.token === helperWindow.token?.id)) refreshHelper(300);
});
const BOARD_FIELDS = ["x", "y", "width", "height", "hidden", "elevation", "disposition", "level"];
Hooks.on("updateToken", (doc, changes) => { if (doc.parent === canvas?.scene && BOARD_FIELDS.some((k) => k in changes)) refreshHelper(300); });
for (const hook of ["createToken", "deleteToken"]) Hooks.on(hook, (doc) => { if (doc.parent === canvas?.scene) refreshHelper(300); });
Hooks.on("updateActor", (actor, changes) => { if (helperWindow?.rendered && (changes.system?.attributes || changes.system?.traits)) refreshHelper(300); });
for (const hook of ["createItem", "deleteItem"]) Hooks.on(hook, (item) => { if (helperWindow?.rendered && ["condition", "effect"].includes(item.type)) refreshHelper(300); });
Hooks.on("canvasReady", () => refreshHelper(400));

export { adviceBoard, adviseHelper, annotateBoard, buildHelper, estimateFoe, helperBody, noteReaction, openHelper, readHelperBoard, shownDoing, shownReactions, slotsByRank, spellThrift };
