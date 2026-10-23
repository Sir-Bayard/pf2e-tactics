/**
 * PF2e Tactics: classes/champion.mjs
 * See classes/_common.mjs for the shape of a class read.
 * Reads the Remaster champion (Player Core 2): the cause and its reaction with the relentless (9th) and exalted (11th)
 * upgrades, devotion spells as the focus layer over the advisor's own spell plans, Smite, the oaths, the auras, the
 * mount feats, the blessings and the capstones. Slugs are checked in both spellings the catalog and the system use
 * ("champions-reaction" / "champion-s-reaction").
 */
import { bestStrike, canMove, castable, effect, focusLeft, has, hasAny, halfLevel, slugOf, level, markOffGuard, moveText, myReach, allySpeed, pct, squareToReach, strikeRun, targets, worth, degreeChances, feetBetween, inReach, mapFor, strikeExpected, saveExpected, CONDITION_VALUE, nameOf, reachableSquares, signed } from "./_common.mjs";

const CHAMPION_REACTIONS = { justice: "Retributive Strike", redemption: "Glimpse of Redemption", liberation: "Liberating Step", grandeur: "Flash of Grandeur", obedience: "Iron Command", desecration: "Selfish Shield", iniquity: "Destructive Vengeance" };
/** Causes whose reaction fires when an enemy damages you (the others when it damages an ally). */
const SELF_CAUSES = new Set(["obedience", "desecration", "iniquity"]);
/** The damage die count of Iron Command and Destructive Vengeance by level. */
const reactionDice = (lv) => (lv >= 19 ? 6 : lv >= 16 ? 5 : lv >= 12 ? 4 : lv >= 9 ? 3 : lv >= 5 ? 2 : 1);
/** The extra spirit damage your Strikes deal to the triggering foe until the end of your next turn, by cause and level. */
const reactionExtra = (cause, lv) => (cause === "iniquity" ? (lv >= 16 ? 6 : lv >= 9 ? 4 : 2) : ["obedience", "desecration"].includes(cause) ? (lv >= 16 ? 3 : lv >= 9 ? 2 : 1) : 0);
/** Conditions a 2-action Lay on Hands with Mercy can counteract, by mercy (Mercy, 4th). */
const MERCY = { body: ["blinded", "dazzled", "deafened", "enfeebled", "sickened"], grace: ["clumsy", "grabbed", "paralyzed"], mind: ["fleeing", "frightened", "stupefied"] };
/** What Greater Mercy (8th) adds to each mercy you took: [level, conditions]. */
const GREATER_MERCY = { body: [[8, ["drained", "slowed"]], [16, ["stunned"]]], grace: [[8, ["immobilized", "restrained", "slowed"]], [12, ["petrified"]], [16, ["stunned"]]], mind: [[8, ["confused", "controlled", "slowed"]], [16, ["doomed", "stunned"]]] };
/** The mercies taken: each Mercy item's ChoiceSet (no flag, so PF2e keys it "mercy"), or the "mercy:<kind>" roll option; null when the sheet doesn't say. */
function merciesOf(actor) {
    const picked = new Set();
    for (const i of actor?.items ?? []) if (["feat", "action"].includes(i.type) && slugOf(i) === "mercy") { const v = i.flags?.pf2e?.rulesSelections?.mercy; if (MERCY[v]) picked.add(v); }
    for (const k of Object.keys(MERCY)) if (actor?.rollOptions?.all?.[`mercy:${k}`]) picked.add(k);
    return picked.size ? [...picked] : null;
}
/** A foe's sanctification as the party can see it: a fiend is unholy, a celestial holy. The trait itself isn't on show. */
const sanctOf = (f) => { const t = (f?.traits ?? []).map((x) => String(x).toLowerCase()); return t.includes("fiend") ? "unholy" : t.includes("celestial") ? "holy" : null; };
/** Token ids a PF2e token mark of this slug points at (Effect: Champion's Extra Damage marks the foe that triggered the reaction). */
function markedBy(actor, slug) {
    const marks = actor?.synthetics?.tokenMarks;
    const out = [];
    if (!marks?.entries) return out;
    for (const [uuid, slugs] of marks.entries()) if ((Array.isArray(slugs) ? slugs : [slugs]).includes(slug)) out.push(String(uuid).split(".").pop());
    return out;
}
const OATH_KINDS = ["aberration", "celestial", "dragon", "fiend", "undead"];
const traitsOf = (c) => (c?.traits ?? c?.actor?.system?.traits?.value ?? []).map((t) => String(t).toLowerCase());

function champion(board, ctx, out) {
    const actor = board.me.actor;
    const me = board.me;
    const lv = level(board);
    if (!hasAny(actor, "champions-reaction", "champions-aura", "deity-champion", "cause")) return;
    const own = (actor?.class?.slug ?? "") === "champion";
    const cause = Object.keys(CHAMPION_REACTIONS).find((k) => has(actor, k)) ?? null;
    // The cause grants its reaction to a champion, or to a dedication with the Champion's Reaction feat
    const reaction = cause && (own || has(actor, "champions-reaction") || has(actor, CHAMPION_REACTIONS[cause].toLowerCase().replace(/ /g, "-"))) ? CHAMPION_REACTIONS[cause] : null;
    const hl = halfLevel(board);
    const cha = Number(actor.system?.abilities?.cha?.mod ?? 0) || 0;
    const myTraits = traitsOf(me);
    const holy = myTraits.includes("holy") ? "holy" : myTraits.includes("unholy") ? "unholy" : null;
    const master = lv >= 13 || has(actor, "martial-weapon-mastery");
    const foes = targets(board);
    const focus = focusLeft(actor);
    const rank = Math.ceil(lv / 2);
    // The aura: 15 ft, 30 with Expand Aura running (an effect on the sheet)
    const expanded = !!effect(actor, /expand-aura/);
    const aura = expanded ? 30 : 15;
    const inside = board.allies.filter((a) => feetBetween(me.rect, a.rect) <= aura);
    const outside = board.allies.filter((a) => feetBetween(me.rect, a.rect) > aura);
    const foesInside = foes.filter((f) => feetBetween(me.rect, f.rect) <= aura);
    const relentless = lv >= 9 && has(actor, "relentless-reaction");
    const exalted = lv >= 11 && has(actor, "exalted-reaction");
    const greatness = exalted && has(actor, "exalted-greatness");

    // --- The champion's reaction, with what it does at this level and what the feats change
    if (reaction) {
        const dice = reactionDice(lv);
        const extra = reactionExtra(cause, lv);
        const res = SELF_CAUSES.has(cause) ? 2 + hl : 2 + lv;
        const bits = [];
        if (SELF_CAUSES.has(cause)) bits.push(`${reaction} (reaction): when an enemy in your ${aura}-foot aura damages you`);
        else bits.push(`${reaction} (reaction, ${aura}-foot aura): covers ${inside.length ? inside.map(nameOf).join(", ") : "nobody"}${outside.length ? `; ${outside.map(nameOf).join(", ")} ${outside.length > 1 ? "are" : "is"} outside` : ""}`);
        if (cause === "justice") bits.push(`the ally resists ${res} of it and you Strike the enemy if it's in reach${has(actor, "nimble-reprisal") ? " (Nimble Reprisal: a ranged Strike at range instead, or a Step first when it's 5 feet outside your reach)" : ""}`);
        if (cause === "redemption") bits.push(`the ally is unharmed if the enemy repents, else resists ${res} and the enemy is enfeebled 2${has(actor, "weight-of-guilt") ? " (or stupefied 2, your choice: pick that against a caster)" : ""} until the end of its next turn${has(actor, "lasting-doubt") ? ", then enfeebled 1 for a minute" : ""}`);
        if (cause === "liberation") bits.push(`the ally resists ${res} if it was damage, gets a new save or Escape against what holds it, and Steps free${has(actor, "liberating-stride") ? " (Liberating Stride: it Strides half its Speed instead)" : ""}${has(actor, "unimpeded-step") ? ", ignoring difficult terrain" : ""}`);
        if (cause === "grandeur") bits.push(`the ally resists ${res} and the enemy is under revealing light until the end of your next turn${has(actor, "brilliant-flash") ? " and off-guard for a round" : ""}`);
        if (cause === "obedience") bits.push(`it kneels (drops prone) or takes ${dice}d6 mental${has(actor, "iron-repercussions") ? " (or persistent mental, decided before it chooses)" : ""}; either way your Strikes against it deal ${extra} extra spirit until the end of your next turn`);
        if (cause === "desecration") bits.push(`you resist ${res} of it${has(actor, "ongoing-selfishness") ? ` and ${Math.floor(res / 2)} of anything more it does to you this turn` : ""}, and your Strikes against it deal ${extra} extra spirit until the end of your next turn`);
        if (cause === "iniquity") bits.push(`you take ${dice}d6 more and it takes ${dice}d6${has(actor, "vicious-vengeance") ? ` + ${dice}` : ""} spirit; your Strikes against it deal ${extra} extra spirit until the end of your next turn`);
        if (relentless) {
            const r = { justice: `Relentless: a hit also deals ${cha} persistent spirit`, redemption: `Relentless: a refusal also costs it ${cha} persistent spirit`, liberation: `Relentless: an enemy holding your ally takes ${cha} persistent spirit`, grandeur: `Relentless: ${cha} persistent spirit it can't recover from while the light lasts`, obedience: `Relentless: a refusal also costs it ${cha} persistent spirit`, desecration: cha >= 3 ? `Relentless: your resistance is ${cha + hl} instead` : "Relentless: no change (your Charisma is below +3)", iniquity: `Relentless: it also takes ${cha} persistent spirit` }[cause];
            if (r) bits.push(r);
        }
        if (exalted) {
            const pen = greatness || has(actor, "aura-of-vengeance") ? 2 : 5;
            const allyMelee = inside.filter((a) => a.hasMelee !== false && a.canAct !== false);
            const x = { justice: `Exalted: ${allyMelee.length ? allyMelee.map(nameOf).join(", ") + (allyMelee.length > 1 ? " can each" : " can") : "allies in the aura can"} spend a reaction to Strike it at -${pen} when it's in their reach`,
                redemption: `Exalted: on a refusal you can give the resistance (${greatness ? res : Math.max(0, res - 2)}) to yourself and every ally in the aura`,
                liberation: `Exalted: you and every ally in the aura Step free${greatness ? " and can try to break free too" : ""}`,
                grandeur: `Exalted: every other enemy in the aura (${Math.max(0, foesInside.length - 1)} besides it, if it's inside) is under revealing light for a round${greatness ? " (a minute)" : ""}`,
                obedience: `Exalted: every other enemy in the aura (${Math.max(0, foesInside.length - 1)} besides it, if it's inside) kneels or takes ${greatness ? "half the" : "the minimum"} damage`,
                desecration: `Exalted: every enemy in the aura takes -1 to attack you until your next turn${greatness ? ", and you get +2 to saves against their effects" : ""}`,
                iniquity: `Exalted: every other enemy in the aura (${Math.max(0, foesInside.length - 1)} besides it, if it's inside) takes half the damage${greatness ? ` + ${dice}` : ""}` }[cause];
            if (x) bits.push(x);
        }
        out.notes.push(bits.join("; ") + ".");
        if (has(actor, "divine-reflexes")) out.notes.push("Divine Reflexes: you have a second reaction each turn, only for your champion's reaction.");
        if (has(actor, "swift-retribution")) out.notes.push("Swift Retribution: a foe that triggers your reaction leaves you quickened next turn, for a Stride or Strike at it.");
        if (has(actor, "retributive-focus") && focus === 0) out.notes.push("Retributive Focus (once a day): with your pool empty, the next trigger of your reaction gives you a Focus Point back.");
        if (has(actor, "instrument-of-zeal") && cause === "justice") out.notes.push("Instrument of Zeal: a critical hit with Retributive Strike or Blessed Counterstrike adds a weapon die and slows it 1.");
        if (has(actor, "instrument-of-slaughter") && extra) out.notes.push("Instrument of Slaughter: a critical hit on a foe your reaction marked also bleeds it for two weapon dice.");
        if (has(actor, "banishing-blow")) out.notes.push("Banishing Blow: when a fiend in reach triggers your reaction, you Shove it as part of it (no penalty); on a success it can't teleport or summon for a minute.");
    } else if (hasAny(actor, "champions-aura")) out.notes.push(`Champion's aura (${aura} ft): ${inside.map(nameOf).join(", ") || "nobody"} inside.`);

    // --- A foe your reaction marked since your last turn: Blessed Counterstrike and Gruesome Strike are Strikes with a rider.
    // Iron Command, Selfish Shield and Destructive Vengeance put Effect: Champion's Extra Damage on you, its token mark on the
    // foe. The ally-shielding reactions leave nothing on your sheet, so for them the plan is offered as "if it triggered it".
    const markIds = markedBy(actor, "champions-extra-damage");
    const marked = markIds.length > 0 || !!effect(actor, /champions-extra-damage|^effect-selfish-shield$/);
    const extra = cause ? reactionExtra(cause, lv) : 0;
    const counter = has(actor, "blessed-counterstrike") && reaction;
    const gruesome = has(actor, "gruesome-strike") && reaction && extra > 0;
    const guess = counter && !marked && !SELF_CAUSES.has(cause);
    if ((marked || guess) && (counter || gruesome) && ctx.actions >= 1 && foes.length) {
        // The foe the mark names; without one, the foes in reach now (else the nearest)
        const named = foes.filter((f) => markIds.includes(f.id));
        const near = foes.filter((f) => inReach(me.rect, f.rect, myReach(board)));
        const pool = named.length ? named : near.length ? near : foes.slice().sort((x, y) => feetBetween(me.rect, x.rect) - feetBetween(me.rect, y.rect)).slice(0, 1);
        for (const f of pool) {
            const sq = squareToReach(board, f, myReach(board), ctx.actions - 1);
            if (!sq) continue;
            const left = ctx.actions - sq.route.actions;
            if (left < 1) continue;
            const dest = sq.route.actions ? { x: sq.x, y: sq.y } : null;
            const ifTrig = guess ? `if ${nameOf(f)} triggered your ${reaction} since your last turn: ` : "";
            if (counter) {
                const b = bestStrike(board, f, { made: ctx.made, extra: 4.5 + (marked ? extra : 0) });
                if (b) {
                    // The weakness pays on your own later Strikes (counted in them) and on your allies' hits before your next turn
                    const allyHits = Math.min(2, board.allies.filter((a) => a.canAct !== false && a.hasMelee !== false && feetBetween(a.rect, f.rect) <= 30).length * 0.6);
                    const ev = b.e.expected + hl * b.e.hit * allyHits;
                    const steps = sq.route.actions ? [{ cost: sq.route.actions, text: moveText(sq, f) }] : [];
                    steps.push({ cost: 1, text: `${ifTrig ? ifTrig.charAt(0).toUpperCase() + ifTrig.slice(1) : ""}Blessed Counterstrike ${nameOf(f)} with ${b.s.label} (${signed(b.bonus)}, one extra weapon die; hits about ${pct(b.e.hit)}): on a hit it has weakness ${hl} to your and your allies' Strikes until your next turn` });
                    const run = left - 1 > 0 ? strikeRun(board, f, left - 1, { made: ctx.made + 1, extra: (marked ? extra : 0) + hl * b.e.hit }) : null;
                    if (run?.used.length) steps.push({ cost: run.used.length, text: run.text });
                    const total = ev + (run?.ev ?? 0);
                    // A guess at the trigger scores below what it would be worth, so a sure plan of the same worth wins
                    out.plans.push({ kind: "class", title: `${guess ? "If it triggered your reaction: " : ""}Blessed Counterstrike ${nameOf(f)}`, target: f, ev: total, score: guess ? total * 0.6 : total + 0.4, dest, steps, notes: ["Only against the foe that triggered your champion's reaction since your last turn (flourish: one a turn)."] });
                }
            }
            if (gruesome && marked) {
                const b = bestStrike(board, f, { made: ctx.made, extra: extra * 2 });
                if (b) {
                    const dc = actor.classDC?.value ?? actor.system?.attributes?.classDC?.value ?? 10 + lv + 4;
                    const c = degreeChances(f.saves?.fortitude ?? lv + 5, dc);
                    const ev = b.e.expected + b.e.hit * (c.f + c.cf) * worth(board, "drained");
                    const steps = sq.route.actions ? [{ cost: sq.route.actions, text: moveText(sq, f) }] : [];
                    steps.push({ cost: 1, text: `Gruesome Strike ${nameOf(f)} with ${b.s.label} (${signed(b.bonus)}): a hit doubles your reaction's extra damage (${extra * 2}) and it saves against DC ${dc} or is drained 1` });
                    out.plans.push({ kind: "class", title: `Gruesome Strike ${nameOf(f)}`, target: f, ev, score: ev + 0.3, dest, steps, notes: ["Only against the foe that triggered your champion's reaction, once a day per foe."] });
                }
            }
        }
    } else {
        if (counter) out.notes.push(`Blessed Counterstrike (1 action): on a turn after a foe triggered your reaction, Strike it with an extra weapon die; a hit gives it weakness ${hl} to your and your allies' Strikes until your next turn.`);
        if (has(actor, "gruesome-strike") && reaction) out.notes.push("Gruesome Strike (1 action): while a foe still takes your reaction's extra damage, a hit doubles it and it saves or is drained 1.");
    }
    if (has(actor, "steed-s-toppling-strike") || has(actor, "steeds-toppling-strike")) out.notes.push("Steed's Toppling Strike (1 action): after a foe triggers your reaction, your mount Strikes it with an extra die and knocks it prone on a hit.");

    // --- Devotion spells: the advisor plans them as spells; here is the focus layer
    const spellsOf = (re) => castable(board, (sp) => re.test(sp.name ?? ""));
    const loh = spellsOf(/^lay on hands/i)[0] ?? null;
    const tov = spellsOf(/^touch of the void/i)[0] ?? null;
    const lohHeal = loh?.heals?.avg ?? loh?.avg ?? 6 * rank;
    if (focus !== null) {
        if (focus <= 0) out.notes.push(`No Focus Points left${has(actor, "desperate-prayer") ? " (Desperate Prayer: once a day, a free point at the start of a turn, for a devotion spell this turn)" : ""}: Refocus after the fight${has(actor, "devoted-focus") ? " (Devoted Focus: a Refocus fills the pool)" : ""}.`);
        else {
            const list = castable(board, (sp) => (sp.traits ?? []).includes("focus") || /lay on hands|touch of the void|shields of the spirit|light of revelation|sun blade|spectral advance|champion's sacrifice|hero's defiance/i.test(sp.name ?? "")).map((sp) => sp.name);
            out.notes.push(`Focus: ${focus} point${focus > 1 ? "s" : ""} left${list.length ? ` for ${list.join(", ")}` : ""}.`);
        }
    }
    if (loh || hasAny(actor, "devotion-spells")) {
        const riders = [has(actor, "accelerating-touch") ? "+10 ft Speed" : "", has(actor, "resilient-touch") ? "+1 to saves" : "", has(actor, "amplifying-touch") ? "+1 to attacks and 1 extra spirit on Strikes" : "", has(actor, "rejuvenating-touch") ? "10 temporary HP a round for 10 rounds" : ""].filter(Boolean);
        const hurtNear = board.allies.filter((a) => inReach(me.rect, a.rect, 5) && a.hp < a.maxHp);
        if (loh && focus > 0) out.notes.push(`Lay on Hands (1 action, focus): about ${Math.round(lohHeal)} HP to a touched ally and +2 AC for a round${riders.length ? `; they also get ${riders.join(", ")}` : ""}${hurtNear.length ? `; ${hurtNear.map((a) => `${nameOf(a)} (${a.hp}/${a.maxHp})`).join(", ")} ${hurtNear.length > 1 ? "are" : "is"} in reach` : ""}${has(actor, "heal-mount") ? `; on your mount it heals ${10 * rank}` : ""}.`);
        if (has(actor, "ultimate-mercy") && board.downAllies?.length) out.notes.push(`Ultimate Mercy: Lay on Hands (2 actions) can bring back ${board.downAllies.map(nameOf).join(", ")} if they died since your last turn, at 1 HP and wounded 1.`);
    }
    // Mercy: Lay on Hands for 2 actions counteracts a condition; a plan when an ally in reach carries one
    if (has(actor, "mercy") && focus > 0 && ctx.actions >= 2) {
        const kinds = merciesOf(actor) ?? Object.keys(MERCY); // the sheet's picks; all three only when it doesn't say
        const pool = new Set(kinds.flatMap((k) => MERCY[k]));
        if (has(actor, "greater-mercy")) for (const k of kinds) for (const [l, cs] of GREATER_MERCY[k]) if (lv >= l) cs.forEach((c) => pool.add(c));
        for (const a of [me, ...board.allies.filter((x) => inReach(me.rect, x.rect, 5))]) {
            const conds = [...(a.conditions ?? [])].filter((c) => pool.has(c));
            if (!conds.length) continue;
            const cond = conds.sort((x, y) => (CONDITION_VALUE[y] ?? 2) - (CONDITION_VALUE[x] ?? 2))[0];
            const heal = Math.min(lohHeal, Math.max(0, a.maxHp - a.hp)) * 0.8;
            const ev = heal + 0.6 * worth(board, cond);
            const who = a === me ? "yourself" : nameOf(a);
            out.plans.push({ kind: "class", title: `Mercy for ${who}: ${cond}`, target: null, ev, score: ev + 0.3, dest: null, steps: [{ cost: 2, text: `Lay on Hands on ${who} for 2 actions (Mercy): about ${Math.round(lohHeal)} HP, +2 AC for a round, and a counteract check (rank ${rank}) against ${cond}` }], notes: [merciesOf(actor) ? `Your mercies: ${kinds.join(", ")}.` : "Mercy covers only the conditions of the mercies you took (the sheet doesn't say which, so all three are read)."] });
        }
        if (has(actor, "affliction-mercy")) out.notes.push("Affliction Mercy: a 2-action Lay on Hands can counteract a poison, disease or curse instead of a condition.");
    }
    // Cruelty: Touch of the Void for 2 actions also enfeebles a living foe that fails
    if (has(actor, "cruelty") && focus > 0 && ctx.actions >= 2 && tov) {
        const dc = tov.dc ?? actor.classDC?.value ?? 10 + lv + 4;
        for (const f of foes) {
            if (traitsOf(f).includes("undead") || traitsOf(f).includes("construct")) continue;
            const sq = squareToReach(board, f, 5, ctx.actions - 2);
            if (!sq) continue;
            const cond = has(actor, "greater-cruelty") ? (f.caster ? "stupefied" : "clumsy") : "enfeebled"; // caster: the party has seen it cast
            const s = saveExpected(f.saves?.fortitude ?? lv + 5, dc, tov.avg ?? 3.5 * rank, { basic: true });
            const ev = s.expected + s.fail * worth(board, cond) + s.critFail * worth(board, cond);
            const steps = sq.route.actions ? [{ cost: sq.route.actions, text: moveText(sq, f) }] : [];
            steps.push({ cost: 2, text: `Touch of the Void on ${nameOf(f)} for 2 actions (Cruelty): ${Math.round(tov.avg ?? 3.5 * rank)} void, basic Fortitude DC ${dc}, and on a failure it's ${cond} 1 for a minute (2 on a critical failure): about ${pct(s.fail)}` });
            out.plans.push({ kind: "class", title: `Cruelty on ${nameOf(f)}`, target: f, ev, score: ev + 0.3, dest: sq.route.actions ? { x: sq.x, y: sq.y } : null, steps, notes: has(actor, "greater-cruelty") ? ["Greater Cruelty: pick enfeebled, clumsy or stupefied when you cast."] : [] });
        }
    }
    // Shields of the Spirit and Security: the shield's protection shared
    if (spellsOf(/shields of the spirit/i).length && focus > 0) {
        const adj = board.allies.filter((a) => inReach(me.rect, a.rect, 5) && !a.shieldRaised);
        out.notes.push(`Shields of the Spirit (1 action, focus): Raise a Shield and the shield's bonus also covers allies in your aura adjacent to you${adj.length ? ` (${adj.map(nameOf).join(", ")})` : ""}${has(actor, "security") ? "; for 2 actions (Security) one ally in the aura keeps a spirit shield for a minute wherever they go" : ""}${has(actor, "greater-security") ? ", and with your shield raised you can Shield Block for them" : ""}.`);
    }
    if (spellsOf(/light of revelation/i).length && focus > 0 && board.enemies.some((e) => e.state !== "observed")) out.notes.push(`Light of Revelation (focus): ${board.enemies.filter((e) => e.state !== "observed").map(nameOf).join(", ")} ${board.enemies.filter((e) => e.state !== "observed").length > 1 ? "are" : "is"} concealed or hidden; the light makes invisible things visible and concealed things plain.`);
    if (has(actor, "spectral-advance") && focus > 0) out.notes.push("Spectral Advance (focus): you teleport to a square next to an enemy in your aura, past anything in the way.");
    if (has(actor, "sun-blade") && focus > 0) out.notes.push("Sun Blade (focus): burning sunlight from your sword or spear; worth it against an undead or a fiend.");
    if (hasAny(actor, "champions-sacrifice") && focus > 0) out.notes.push("Champion's Sacrifice (reaction, focus): when an ally in your aura would be hit or fail a save against a foe, you take the damage and effects instead.");
    if (hasAny(actor, "heros-defiance") && lv >= 19) out.notes.push(focus > 0 ? "Hero's Defiance (free action, focus): when a hit would drop you to 0 HP, you first regain 6d8+20 HP and stay up." : "Hero's Defiance needs a Focus Point; with none left, a hit that drops you drops you.");
    if (hasAny(actor, "deitys-domain") && focus > 0) out.notes.push(`Your domain spell${has(actor, "advanced-deity-s-domain") || has(actor, "advanced-deitys-domain") ? "s are" : " is a"} devotion spell${has(actor, "advanced-deity-s-domain") || has(actor, "advanced-deitys-domain") ? "s" : ""} on the same focus pool as Lay on Hands.`);

    // --- Oaths (2nd): a daily or sworn target; the foe's visible traits tell whether it matters today
    const oathFoes = foes.filter((f) => traitsOf(f).some((t) => OATH_KINDS.includes(t)));
    if (has(actor, "oath-of-the-slayer")) {
        const bonus = lv >= 14 ? 3 : lv >= 7 ? 2 : 1;
        if (oathFoes.length) out.notes.push(`Oath of the Slayer: if today's oath is against ${[...new Set(oathFoes.flatMap((f) => traitsOf(f).filter((t) => OATH_KINDS.includes(t))))].join(" or ")}, your Strikes and devotion spells deal ${bonus} extra spirit to ${oathFoes.map(nameOf).join(", ")} (${bonus * 2} until your next turn after one triggers your reaction).`);
    }
    if (has(actor, "oath-of-the-defender") && oathFoes.length) out.notes.push(`Oath of the Defender: allies in your aura resist ${lv >= 17 ? 5 : lv >= 12 ? 4 : lv >= 7 ? 3 : 2} from today's sworn kind (${oathFoes.map(nameOf).join(", ")} ${oathFoes.length > 1 ? "qualify" : "qualifies"} if that's the one); your reaction's resistance grows by 5 against them.`);
    if (has(actor, "oath-of-the-avenger") || has(actor, "vengeful-oath")) out.notes.push("Your oath: Lay on Hands can harm a foe you invoked it against (you saw it harm an innocent or an ally), as if it were undead.");
    if (has(actor, "enforce-oath") && foes.length === 1 && !effect(actor, /enforce-oath/)) out.notes.push(`Enforce Oath (1 action, once an hour): against a sworn foe, +1 AC, saves and attacks against it, -1 against everyone else; worth it now with ${nameOf(foes[0])} the only foe in sight.`);
    else if (effect(actor, /enforce-oath/) && foes.length > 1) out.notes.push("Enforce Oath is running: -1 to AC, attacks and saves against every foe but the sworn one; Dismiss it (free) if that one is down.");

    // --- Smite (6th): +3 status to damage against one foe, +4 with master proficiency; +4/+6 against the opposite sanctification
    if (has(actor, "smite") && ctx.actions >= 2) {
        for (const f of foes) {
            const sq = squareToReach(board, f, myReach(board), ctx.actions - 2);
            if (!sq) continue;
            const left = ctx.actions - 1 - sq.route.actions;
            if (left < 1) continue;
            const opposed = holy && sanctOf(f) === (holy === "holy" ? "unholy" : "holy");
            const bonusDmg = opposed ? (master ? 6 : 4) : master ? 4 : 3;
            const steps = [{ cost: 1, text: `Smite ${nameOf(f)}: +${bonusDmg} damage on your Strikes against it until your next turn${opposed ? ` (a ${holy === "holy" ? "fiend, so unholy" : "celestial, so holy"})` : ""}` }];
            if (sq.route.actions) steps.push({ cost: sq.route.actions, text: moveText(sq, f) });
            const run = strikeRun(board, f, left, { made: ctx.made, extra: bonusDmg });
            if (!run.used.length) continue;
            steps.push({ cost: run.used.length, text: run.text });
            out.plans.push({ kind: "class", title: `Smite ${nameOf(f)}`, target: f, ev: run.ev, score: run.ev + 0.2, dest: sq.route.actions ? { x: sq.x, y: sq.y } : null, steps, notes: ["Smite lasts while the foe keeps attacking you or your allies; a new Smite ends the old one."] });
        }
    }

    // --- The aura feats: what they do for who is in it right now
    if (has(actor, "expand-aura") && !expanded && ctx.actions >= 1) {
        const would = board.allies.filter((a) => feetBetween(me.rect, a.rect) > 15 && feetBetween(me.rect, a.rect) <= 30);
        if (would.length) out.notes.push(`Expand Aura (1 action): a 30-foot aura ${lv >= 16 ? "until you Dismiss it" : lv >= 10 ? "for a minute" : "until your next turn"} would bring ${would.map(nameOf).join(", ")} inside.`);
    }
    if (has(actor, "aura-of-courage")) {
        const scared = inside.filter((c) => c.conditions?.has?.("frightened"));
        if (scared.length) out.notes.push(`Aura of Courage: at the end of your turn ${scared.map(nameOf).join(", ")} ${scared.length > 1 ? "drop" : "drops"} frightened by 1 more (yours already comes in 1 lower).`);
    }
    if (has(actor, "aura-of-despair") && foesInside.length) out.notes.push(`Aura of Despair: ${foesInside.map(nameOf).join(", ")} ${foesInside.length > 1 ? "take" : "takes"} -1 to saves against fear and can't drop below frightened 1 while ending a turn in your aura; Demoralize sticks.`);
    if (has(actor, "aura-of-faith") && holy && inside.length) out.notes.push(`Aura of Faith: ${inside.map(nameOf).join(", ")}'s Strikes count as ${holy} in your aura${foes.some((f) => sanctOf(f) === (holy === "holy" ? "unholy" : "holy")) ? ", which the fiends or celestials here may be weak to" : ""}.`);
    if (has(actor, "aura-of-life") && foes.some((f) => traitsOf(f).includes("undead"))) out.notes.push("Aura of Life: you and allies in your aura resist 5 void and get +1 to saves against void effects.");
    if (has(actor, "aura-of-righteousness") && foes.some((f) => sanctOf(f) === "unholy")) out.notes.push("Aura of Righteousness: you and allies in your aura resist 5 from unholy Strikes, spells and effects, and an unholy creature teleporting out of it faces a counteract.");
    if (has(actor, "anchoring-aura") && foes.some((f) => traitsOf(f).includes("fiend"))) out.notes.push("Anchoring Aura: a fiend's teleportation within 15 feet of you faces a counteract at your devotion spell rank.");
    if (has(actor, "aura-of-determination") && inside.length) out.notes.push("Aura of Determination: +1 to saves against mental, morph and polymorph effects for you and allies in your aura.");
    if (has(actor, "blessed-swiftness") && foes.some((f) => f.reactions?.some?.((r) => r.trigger?.onMove))) out.notes.push("Blessed Swiftness: an ally moving inside your aura gets +2 to all defenses against the reaction that movement triggers.");
    if (has(actor, "divine-wall") && me.shield && foes.some((f) => inReach(me.rect, f.rect, 5))) out.notes.push("Divine Wall: with a shield in hand, every square next to you is difficult terrain for enemies; a foe beside you can't Step away.");

    // --- Shields: Shield Block for allies, reckoning, grace, the paragon
    if (has(actor, "shield-warden")) out.notes.push("Shield Warden: with your shield raised, Shield Block can cover an adjacent ally.");
    if (has(actor, "shield-of-reckoning") && reaction) out.notes.push(`Shield of Reckoning (once a round): when a foe's attack on an ally triggers both Shield Block and ${reaction}, one reaction does both.`);
    if (has(actor, "shield-of-grace")) out.notes.push("Shield of Grace: when you Shield Block for an ally, you can split what gets through evenly between you.");
    if (has(actor, "shield-paragon") && me.shield) out.notes.push("Shield Paragon: your shield is always raised; don't spend the action.");
    if (has(actor, "sacrifice-armor")) out.notes.push(`Sacrifice Armor (reaction): a Strike that hits you for physical damage${has(actor, "greater-interpose") ? ", or anything with a Reflex save," : ""} deals twice your armor's level less, and your armor breaks.`);
    if (has(actor, "everdistant-defense")) out.notes.push("Everdistant Defense (reaction): a ranged attack into your aura or a creature moving through it counts every square as three.");
    if (has(actor, "swift-paragon")) out.notes.push("Swift Paragon: you're quickened for a Step or Stride each turn, and allies starting a move in your aura don't trigger reactions with it.");
    if (has(actor, "sacred-defender")) out.notes.push(`Sacred Defender: resist 5 physical${holy ? ` (10 from ${holy === "holy" ? "unholy" : "holy"} creatures)` : ""}, and a natural 20 against you doesn't upgrade.`);

    // --- Blessings: a note the first time, not every turn's math
    if (has(actor, "blessed-armament")) out.notes.push(`Blessed Armament: your chosen weapon has its critical specialization and a property rune of your choosing${has(actor, "radiant-armament") ? " (Radiant Armament: swap the rune in 10 minutes)" : ""}${has(actor, "armament-paragon") ? "; Armament Paragon: swap it as 1 action" : ""}.`);

    // --- The mount
    if (has(actor, "imposing-destrier") || has(actor, "auspicious-mount")) out.notes.push("Your mount acts once on your turn for free (a Stride or Strike) even without Command an Animal; that's its whole turn if you don't command it.");
    else if (has(actor, "faithful-steed") && lv >= 6 && has(actor, "loyal-warhorse")) out.notes.push("Loyal Warhorse: your mount is a mature companion; Command an Animal (1 action) gives it two.");
    if (has(actor, "faithful-stride")) out.notes.push("Faithful Stride (2 actions, mounted): your mount Strides twice its Speed (three times for 3 actions), even across water.");
    if (has(actor, "pale-horse")) out.notes.push(`Pale Horse: while you ride, anything that touches or hits your mount in melee takes ${lv >= 20 ? 3 : lv >= 16 ? 2 : 1}d6 of its chosen type.`);
}

export { champion };
