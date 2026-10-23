/**
 * PF2e Tactics: classes/witch.mjs
 * See classes/_common.mjs for the shape of a class read.
 * The witch's layer over the advisor's spell plans: hexes (one a turn; the patron's hex cantrip at will, the lesson hexes
 * for a Focus Point), what to Sustain and how (Cackle for a Focus Point as a free action, or the Sustain action; Hex
 * Master at 20), the familiar (the patron's "when you Cast or Sustain a hex" trick, Patron's Puppet, Phase Familiar,
 * Shed Spirit and the other familiar activities as plans), Sympathetic Strike and Split Hex as composed turns, Siphon
 * Power, Quickened Casting, the spellshape feats as "when" notes, slots left by rank and the cantrip-or-slot rule.
 * Hexes are planned here, so they're taken off board.spells before the advisor runs (nothing is listed twice).
 */
import { bestStrike, castable, effect, focusLeft, has, level, pct, targets, worth, degreeChances, feetBetween, inReach, mapFor, strikeExpected, saveExpected, nameOf, reachableSquares, signed } from "./_common.mjs";

const lc = (s) => String(s ?? "").toLowerCase().trim();
const cap = (s) => String(s ?? "").charAt(0).toUpperCase() + String(s ?? "").slice(1);
const slugOf = (i) => i?.slug ?? i?.system?.slug ?? lc(i?.name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** Foundry's sluggify drops apostrophes (witchs-charge); the catalog keeps a dash (witch-s-charge). Both are read. */
const hasAny = (actor, ...slugs) => slugs.some((s) => has(actor, s));
const item = (actor, ...slugs) => actor?.items?.find?.((i) => ["feat", "action"].includes(i.type) && slugs.includes(slugOf(i))) ?? null;
/** Uses left today of a feat with a frequency, or null when the sheet doesn't count them. */
function usesLeft(actor, ...slugs) { const f = item(actor, ...slugs)?.system?.frequency; return f && typeof f.value === "number" ? f.value : null; }
const isHex = (sp) => !!sp.traits?.includes("hex");
const isFocus = (sp) => !!sp.traits?.includes("focus");
const ordinal = (r) => `${r}${r === 1 ? "st" : r === 2 ? "nd" : r === 3 ? "rd" : "th"}`;
const points = (n) => `${n} Focus Point${n === 1 ? "" : "s"}`;

/** The patrons: tradition, hex cantrip, and the familiar's trick when you Cast or Sustain a hex (Remaster text). */
const PATRONS = {
    "the-resentment": { name: "The Resentment", trad: "occult", hex: "evil eye", familiar: "Ongoing Misery", reach: 15, trick: "prolongs the timed conditions on a creature within 15 feet of it by a round" },
    "faiths-flamekeeper": { name: "Faith's Flamekeeper", trad: "divine", hex: "stoke the heart", familiar: "Restored Spirit", reach: 15, trick: "gives a willing creature within 15 feet of it temporary HP until your next turn" },
    "silence-in-snow": { name: "Silence in Snow", trad: "primal", hex: "clinging ice", familiar: "Freezing Rime", reach: 0, trick: "makes a 5-foot burst of difficult terrain around its square until your next turn" },
    "the-inscribed-one": { name: "The Inscribed One", trad: "arcane", hex: "discern secrets", familiar: "Flowing Script", reach: 5, trick: "counts as a flanker (reach 5) for you and your allies until your next turn" },
    "wilding-steward": { name: "Wilding Steward", trad: "primal", hex: "wilding word", familiar: "Keen Senses", reach: 60, trick: "gains scent, tremorsense or wavesense to 60 feet and Points Out a hidden foe as a free action" },
    "spinner-of-threads": { name: "Spinner of Threads", trad: "occult", hex: "nudge fate", familiar: "Balanced Luck", reach: 15, trick: "gives a creature within 15 feet of it +1 AC or -1 AC until your next turn" },
    "starless-shadow": { name: "Starless Shadow", trad: "occult", hex: "shroud of night", familiar: "Stalking Night", reach: 5, trick: "frightens an adjacent enemy it's concealed, hidden or undetected to (frightened 1)" },
    "mosquito-witch": { name: "Mosquito Witch", trad: "primal", hex: "buzzing bites", familiar: "Swarm's Heart", reach: 0, trick: "conceals you or an ally sharing its square until your next turn" },
    "baba-yaga": { name: "Baba Yaga", trad: "occult", hex: "spirit object", familiar: "Obscuring Snowfall", reach: 0, trick: "drops snow in a 5-foot burst around its square; enemies that enter it are dazzled until your next turn" },
    "choir-politic": { name: "Choir Politic", trad: "divine", hex: "share vision", familiar: "Bolstering Aid", reach: 5, trick: "gives an adjacent ally +2 to its next non-attack skill check before your next turn" },
    "cobyslarni": { name: "Cobyslarni", trad: "occult", hex: "information overload", familiar: "Insightful Observation", reach: null, trick: "makes a free Recall Knowledge check with your bonus" },
    "devourer-of-decay": { name: "Devourer of Decay", trad: "primal", hex: "scrounger's glee", familiar: "Parasitic Might", reach: 15, trick: "sickens a creature within 15 feet of it that's below half HP unless it saves (Fortitude)" },
    "paradox-of-opposites": { name: "Paradox of Opposites", trad: "divine", hex: "trade death for life", familiar: "Paired Perplexity", reach: 20, trick: "stupefies a creature within 20 feet of it (stupefied 1, no save) until your next turn" },
    "ripple-in-the-deep": { name: "Ripple in the Deep", trad: "primal", hex: "sting of the sea", familiar: "Overwhelming Tides", reach: 10, trick: "pushes a creature within 10 feet of it 5 feet away" },
    "the-unseen-broker": { name: "The Unseen Broker", trad: "occult", hex: "pact broker", familiar: "Enticing Negotiation", reach: 10, trick: "makes one enemy within 10 feet of it off-guard until your next turn" },
    "whisper-of-wings": { name: "Whisper of Wings", trad: "primal", hex: "murmuration", familiar: "Nimble Flight", reach: null, trick: "Flies 15 feet without triggering reactions" },
    "seneschal": { name: "Seneschal", trad: null, hex: "manifest will", familiar: null, reach: null, trick: null },
};
/** Each lesson's hex, for the notes when the sheet carries the lesson but the hex isn't on the board (Focus Points gone). */
const LESSONS = { "lesson-of-dreams": "Veil of Dreams", "lesson-of-elements": "Elemental Betrayal", "lesson-of-the-elements": "Elemental Betrayal", "lesson-of-life": "Life Boost", "lesson-of-protection": "Blood Ward", "lesson-of-vengeance": "Needle of Vengeance", "lesson-of-calamity": "Stumbling Curse",
    "lesson-of-mischief": "Deceiver's Cloak", "lesson-of-shadow": "Malicious Shadow", "lesson-of-snow": "Personal Blizzard", "lesson-of-favors": "Return the Favor", "lesson-of-decay": "Mycological Malady", "lesson-of-the-flock": "Sheltering Wings", "lesson-of-the-shark": "Blood in the Water", "lesson-of-memory": "Unravel Knowledge", "lesson-of-vows": "Censure Falsehoods",
    "lesson-of-bargains": "Over the Coals", "lesson-of-death": "Curse of Death", "lesson-of-renewal": "Restorative Moment", "lesson-of-the-frozen-queen": "Glacial Heart" };

/** Slots of the prepared entries by rank { left, max }, the spells cast today, the known-but-unprepared spells, and the top rank. */
function slotsOf(actor) {
    const byRank = {};
    const spent = [];
    const known = [];
    let top = 0;
    for (const entry of actor?.spellcasting?.regular ?? []) {
        const prepared = entry.isPrepared ?? entry.system?.prepared?.value === "prepared";
        if (!prepared || entry.isFocusPool) continue;
        const slots = entry.system?.slots ?? {};
        const preparedIds = new Set();
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
                preparedIds.add(p.id);
                const sp = entry.spells?.get?.(p.id) ?? null;
                if (p.expended) spent.push({ name: sp?.name ?? "a spell", rank, spell: sp });
                else left += 1;
            }
            byRank[rank] = { left, max };
        }
        const all = entry.spells?.contents ?? (typeof entry.spells?.values === "function" ? [...entry.spells.values()] : []);
        for (const sp of all) if (!preparedIds.has(sp.id) && !sp.isCantrip && !sp.system?.traits?.value?.includes?.("focus")) known.push(sp);
    }
    return { byRank, spent, known, top: top || Math.max(1, Math.ceil((actor?.level ?? 1) / 2)) };
}
/** What a single-target spell on the board is expected to do to t: a save, an attack roll (with the penalty), or an automatic hit. */
function spellExpected(board, sp, t, made = 0) {
    const lv = level(board);
    if (sp.save?.stat) return saveExpected(t.saves?.[sp.save.stat] ?? lv + 5, sp.dc ?? 10 + lv + 4, sp.avg, { basic: sp.save.basic });
    if (sp.attack !== null && sp.attack !== undefined) return strikeExpected(sp.attack + mapFor(made, false), t.ac, sp.avg);
    return { hit: 1, expected: sp.avg || 0 };
}
/** Single-target damage spells (not hexes) the character can cast now at t from where it stands. */
const hurters = (board, t, costMax = 3) => castable(board, (sp) => !isHex(sp) && sp.cost && sp.cost <= costMax && !sp.area && !sp.heals && sp.avg > 0 && (sp.save?.stat || (sp.attack !== null && sp.attack !== undefined)) && feetBetween(board.me.rect, t.rect) <= (sp.range ?? 30));
/** The foe to measure against: the closest one that's still up, the most hurt among equals. */
function primary(board) {
    const foes = targets(board).filter((f) => f.hp > 0 || f.hp === undefined);
    foes.sort((a, b) => feetBetween(board.me.rect, a.rect) - feetBetween(board.me.rect, b.rect) || (a.hp ?? 99) - (b.hp ?? 99));
    return foes[0] ?? null;
}
const rankText = (sp) => (sp.cantrip ? "" : isFocus(sp) ? " (focus)" : ` (rank ${sp.rank})`);
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
/** What to do with the actions a hex turn leaves at t: the spell by the rule, then a 1-action spell or a Strike. */
function fillRest(board, t, rest, made, already = 0) {
    const steps = [];
    let ev = 0;
    let guard = 0;
    while (rest >= 1 && t && guard++ < 3) {
        const next = spendOrNot(board, t, rest, made, already + ev);
        if (next) { steps.push({ cost: next.sp.cost, text: `Cast ${next.sp.name}${rankText(next.sp)} at ${nameOf(t)} (about ${Math.round(next.e.expected)})` }); ev += next.e.expected; rest -= next.sp.cost; continue; }
        const b = bestStrike(board, t, { made });
        if (b && inReach(board.me.rect, t.rect, b.s.reach || 5)) { steps.push({ cost: 1, text: `Strike ${nameOf(t)} with ${b.s.label} (${signed(b.bonus)}, about ${Math.round(b.e.expected)})` }); ev += b.e.expected; made += 1; rest -= 1; continue; }
        break;
    }
    return { steps, ev, rest };
}
/** The target's chances against a hex's save (its save -1 when a Sympathetic Strike landed). */
const deg = (board, sp, t, stat, adj = 0, shift = 0) => degreeChances((t.saves?.[stat] ?? level(board) + 5) + adj, sp.dc ?? 10 + level(board) + 4, shift);
/** A foe's hit, as the party has seen it, for the worth of a penalty on its attacks. */
const foeHit = (board, t) => t.reactiveStrike?.avg ?? 4 + 1.5 * level(board);
const allyHit = (a) => a.reactiveStrike?.avg ?? 4;
const missing = (c) => Math.max(0, (c.maxHp ?? 0) - (c.hp ?? 0));
const canReachMe = (board, f) => inReach(f.rect, board.me.rect, f.reach ?? 5) || (f.rangedReach ?? 0) >= feetBetween(f.rect, board.me.rect);

/**
 * Each hex: who it goes on (foe, ally, me), its reach, whether it's Sustained, and what it's worth against t at this level.
 * ev(board, sp, t, env, adj) returns { ev, how } for a foe hex; ally hexes pick their own target.
 */
const HEXES = {
    "evil eye": { on: "foe", save: "will", ev(board, sp, t, env, adj) { const c = deg(board, sp, t, "will", adj); return { ev: (c.f + 1.6 * c.cf) * worth(board, "sickened"), how: `Will DC ${sp.dc ?? "?"}: sickened 1 on a failure, 2 on a critical failure (lands about ${pct(c.f + c.cf)}), and it stays at least 1 while you Sustain and can see it` }; } },
    "information overload": { on: "foe", save: "will", ev(board, sp, t, env, adj) { const c = deg(board, sp, t, "will", adj); return { ev: (c.f + 1.6 * c.cf) * worth(board, "stupefied") * (t.caster ? 1.6 : 1), how: `Will DC ${sp.dc ?? "?"}: stupefied 1 on a failure, 2 on a critical failure (about ${pct(c.f + c.cf)})${t.caster ? "; it's a caster, so its spells suffer" : ""}` }; } },
    "scrounger's glee": { on: "foe", save: "will", ev(board, sp, t, env, adj) { const c = deg(board, sp, t, "will", adj); return { ev: (c.f + 1.6 * c.cf) * worth(board, "frightened"), how: `Will DC ${sp.dc ?? "?"}: frightened 1 on a failure, 2 on a critical failure (about ${pct(c.f + c.cf)}), stuck at 1 while it can hear you; Dismiss it as a reaction when an ally crits it to heal them ${Math.ceil(level(board) / 2) + Math.floor(Math.max(0, sp.rank - 1) / 2)}d4` }; } },
    "buzzing bites": { on: "foe", save: "fortitude", ev(board, sp, t, env, adj) { const c = deg(board, sp, t, "fortitude", adj); const avg = sp.avg || 2.5 * sp.rank; const e = c.s * avg / 2 + c.f * avg + c.cf * avg * 2; return { ev: e + c.cf * worth(board, "sickened"), how: `Fortitude DC ${sp.dc ?? "?"}: ${sp.rank}d4 piercing (about ${Math.round(e)}), sickened 1 on a critical failure` }; } },
    "clinging ice": { on: "foe", save: "reflex", ev(board, sp, t, env, adj) { const c = deg(board, sp, t, "reflex", adj); const avg = sp.avg || 2.5 * sp.rank; const e = c.s * avg / 2 + c.f * avg + c.cf * avg * 2; return { ev: e + c.f * 1 + c.cf * 2, how: `Reflex DC ${sp.dc ?? "?"}: ${sp.rank}d4 cold (about ${Math.round(e)}), -5 feet of Speed on a failure, -10 on a critical failure while you Sustain` }; } },
    "shroud of night": { on: "foe", save: "will", ev(board, sp, t, env, adj) { const c = deg(board, sp, t, "will", adj); return { ev: (c.f + c.cf) * 0.2 * foeHit(board, t) * 2, how: `Will DC ${sp.dc ?? "?"}: on a failure (about ${pct(c.f + c.cf)}) everyone is concealed to it, a DC 5 flat check on each of its attacks; no good against greater darkvision` }; } },
    "wilding word": { on: "foe", save: "will", ev(board, sp, t, env, adj) { const plant = (t.traits ?? []).some((x) => ["animal", "fungus", "plant"].includes(x)); const c = deg(board, sp, t, "will", adj - (plant ? 1 : 0)); const scale = canReachMe(board, t) ? 1 : 0.5; return { ev: ((1 - c.cs) * 0.2 * foeHit(board, t) * 2 + (c.f + c.cf) * worth(board, "sickened") * 0.5) * scale, how: `Will DC ${sp.dc ?? "?"}${plant ? " (-1 for it, an animal, fungus or plant)" : ""}: -2 to its attacks and checks against you on any save but a critical success (about ${pct(1 - c.cs)}), and sickened 1 each time it damages you on a failure${scale < 1 ? "; it can't reach you now, so it's worth less" : ""}` }; } },
    "sting of the sea": { on: "foe", save: "fortitude", ev(board, sp, t, env, adj) { const c = deg(board, sp, t, "fortitude", adj); return { ev: c.f * worth(board, "dazzled") + c.cf * worth(board, "blinded") + c.s * 0.5, how: `Fortitude DC ${sp.dc ?? "?"} at the start of each of its turns: -2 Perception on a success, dazzled on a failure, blinded on a critical failure (about ${pct(c.cf)}) until its turn ends` }; } },
    "pact broker": { on: "foe", save: "will", ev(board, sp, t, env, adj) { const c = deg(board, sp, t, "will", adj); const avg = sp.avg || 2.5 * (sp.rank + 1); return { ev: (c.f + c.cf) * avg + (c.f + 2 * c.cf) * 0.1 * foeHit(board, t) * 2, how: `offer it peace; the first hostile action it takes means a Will save (DC ${sp.dc ?? "?"}): ${sp.rank + 1}d4 mental and -1 to its attacks and damage against you all on a failure, -2 on a critical failure (about ${pct(c.f + c.cf)})` }; } },
    "murmuration": { on: "foe", save: "will", ev(board, sp, t, env, adj) { const c = deg(board, sp, t, "will", adj); const avg = 2.5 * sp.rank; return { ev: (c.s * 0.5 + c.f + 2 * c.cf) * avg * 0.6, how: `name a creature it must keep away from; each round it moves closer, a Will save (DC ${sp.dc ?? "?"}) or ${sp.rank}d4 piercing or sonic, double on a critical failure` }; } },
    "trade death for life": { on: "foe", save: "fortitude", ev(board, sp, t, env, adj) { const c = deg(board, sp, t, "fortitude", adj); const avg = sp.avg || 2.5 * sp.rank; const e = c.s * avg / 2 + c.f * avg + c.cf * avg * 2; const hurt = env.hurt; const heal = hurt ? 0.8 * Math.min(missing(hurt), 3 * sp.rank) * (1 - c.cs) : 0; return { ev: e + heal, how: `basic Fortitude DC ${sp.dc ?? "?"}, ${sp.rank}d4 void (about ${Math.round(e)}); if it takes any, ${hurt ? (hurt === board.me ? "you get" : `${nameOf(hurt)} gets`) : "a willing creature gets"} fast healing ${sp.rank} while you Sustain` }; } },
    "veil of dreams": { on: "foe", save: "will", ev(board, sp, t, env, adj) { const c = deg(board, sp, t, "will", adj); return { ev: (1 - c.cs) * 0.1 * foeHit(board, t) * 2 + (c.f + c.cf) * (t.caster ? 3 : 1), how: `Will DC ${sp.dc ?? "?"}: -1 to its Perception, attacks and Will on any save but a critical success (about ${pct(1 - c.cs)}); on a failure each of its concentrate actions needs a DC 5 flat check${t.caster ? ", which bites a caster" : ""}` }; } },
    "elemental betrayal": { on: "foe", save: null, ev(board, sp, t, env) { const w = 2 + Math.floor(Math.max(0, sp.rank - 1) / 2); const el = ["fire", "water", "earth", "air", "metal", "wood"]; const mine = (board.spells ?? []).filter((x) => !isHex(x) && x.avg > 0 && el.some((e) => x.traits?.includes(e))); const pick = el.find((e) => mine.some((x) => x.traits?.includes(e))) ?? null; return { ev: w * (pick ? 1.5 : 0.5), how: `no save: weakness ${w} to ${pick ? `the ${pick} trait (your ${mine.find((x) => x.traits?.includes(pick)).name} has it)` : "one of air, earth, metal, fire, water or wood; pick the one your party throws"} while you Sustain` }; } },
    "needle of vengeance": { on: "foe", save: "will", ev(board, sp, t, env, adj) { const c = deg(board, sp, t, "will", adj); const avg = 2 * sp.rank; const e = c.s * avg / 2 + c.f * avg + c.cf * avg * 2; const named = env.guarded; return { ev: 2 * e, how: `name ${named === board.me ? "yourself" : nameOf(named)}: ${avg} mental with a basic Will save (DC ${sp.dc ?? "?"}) each time it acts against them, about ${Math.round(e)} per action` }; } },
    "stumbling curse": { on: "foe", save: "reflex", range: 60, ev(board, sp, t, env, adj) { const c = deg(board, sp, t, "reflex", adj); return { ev: (c.f + c.cf) * 2 + (1 - c.cs) * 0.5, how: `Reflex DC ${sp.dc ?? "?"}: -2 to its Athletics and Acrobatics; on a failure (about ${pct(c.f + c.cf)}) the first 5 feet of each Stride go a random way, your way on a critical failure` }; } },
    "malicious shadow": { on: "foe", save: null, attack: true, ev(board, sp, t, env, adj, made = 0) { const avg = sp.avg || 11 + 5.5 * Math.floor(Math.max(0, sp.rank - 3) / 2); const atk = (sp.attack ?? level(board) + 6) + mapFor(made, false); const e = strikeExpected(atk, t.ac, avg); return { ev: e.expected, how: `its shadow Strikes it (melee spell attack ${signed(atk)}, hits about ${pct(e.hit)}, about ${Math.round(avg)} bludgeoning, piercing or slashing) now and each time you Sustain; it uses your multiple attack penalty` }; } },
    "personal blizzard": { on: "foe", save: "fortitude", ev(board, sp, t, env, adj) { const c = deg(board, sp, t, "fortitude", adj); const d = 3.5 + Math.max(0, sp.rank - 3); const e = c.s * d + c.f * (d + 2 * d) + c.cf * (2 * d + 4 * d); return { ev: e + (c.f + c.cf) * 0.2 * foeHit(board, t) * 2, how: `Fortitude DC ${sp.dc ?? "?"}: 1d6+${Math.max(0, sp.rank - 3)} cold, and on a failure (about ${pct(c.f + c.cf)}) as much persistent cold and it's concealed from everyone and everyone from it, while you Sustain` }; } },
    "mycological malady": { on: "foe", save: "fortitude", range: 5, ev(board, sp, t, env, adj) { const c = deg(board, sp, t, "fortitude", adj); const en = worth(board, "enfeebled"); return { ev: c.s * en * 0.7 + c.f * en * 1.5 + c.cf * (en * 1.5 + worth(board, "slowed")), how: `touch, Fortitude DC ${sp.dc ?? "?"}: enfeebled 2 for a round on a success, the disease on a failure (enfeebled 2, then slowed 1 at stage 2) while you Sustain; undead aren't immune` }; } },
    "blood in the water": { on: "foe", save: "reflex", needsBleed: true, ev(board, sp, t, env, adj) { const avg = sp.avg || 7 + 7 * Math.floor(Math.max(0, sp.rank - 3) / 2); const e = saveExpected(t.saves?.reflex ?? level(board) + 5, sp.dc ?? 10 + level(board) + 4, avg, { basic: true, delta: 0 }); return { ev: e.expected, how: `basic Reflex DC ${sp.dc ?? "?"}, about ${Math.round(avg)} spirit now and each time you Sustain; your slashing damage on it Sustains it for free` }; } },
    "curse of death": { on: "foe", save: "fortitude", ev(board, sp, t, env, adj) { const c = deg(board, sp, t, "fortitude", adj); const s1 = Math.max(4, sp.rank - 1) * 3.5, s2 = Math.max(8, sp.rank + 3) * 3.5; return { ev: (c.s + c.f) * s1 + c.cf * s2 + (1 - c.cs) * worth(board, "fatigued") * 0.5, how: `Fortitude DC ${sp.dc ?? "?"}: the curse at stage 1 on a success or failure (${Math.max(4, sp.rank - 1)}d6 void and fatigued, about ${Math.round(s1)}), stage 2 on a critical failure (${Math.max(8, sp.rank + 3)}d6); it climbs while you Sustain unless it keeps saving, and it's immune for a day after` }; } },
    "over the coals": { on: "foe", save: "will", range: 120, ev(board, sp, t, env, adj) { const c = deg(board, sp, t, "will", adj); const f = 13.5 * 1.5, ff = 27 * 1.5 + worth(board, "drained"); return { ev: c.s * f + c.f * ff + c.cf * ff * 1.3, how: `demand it stand down or pay (Will DC ${sp.dc ?? "?"}): 3d8 persistent void if it doesn't comply by its next turn's end, 6d8 and drained 1 on a failure, worse on a critical failure; immune for a day after` }; } },
    "glacial heart": { on: "foe", save: "fortitude", ev(board, sp, t, env, adj) { const c = deg(board, sp, t, "fortitude", adj); const avg = sp.avg || 35 + 7 * Math.max(0, sp.rank - 5); const e = c.s * avg / 2 + c.f * avg + c.cf * avg * 2; return { ev: e + c.s * worth(board, "slowed") * 0.5 + (c.f + c.cf) * worth(board, "slowed") * 1.5, how: `Fortitude DC ${sp.dc ?? "?"}: about ${Math.round(avg)} cold (about ${Math.round(e)} expected), slowed 1 for a round on a success, slowed 1 and climbing on a failure (about ${pct(c.f + c.cf)}) until it's encased; immune for a day after` }; } },
    "unravel knowledge": { on: "foe", save: "will", ev(board, sp, t, env, adj) { const c = deg(board, sp, t, "will", adj); return { ev: (c.f + c.cf) * 7.5 * 1.5, how: `name an ability you know it has (Will DC ${sp.dc ?? "?"}): on a failure (about ${pct(c.f + c.cf)}) 3d8 mental the first time it uses it each round while you Sustain, 3d4 for a basic action like Strike` }; } },
    "censure falsehoods": { on: "foe", save: "fortitude", ev(board, sp, t, env, adj) { const c = deg(board, sp, t, "fortitude", adj); const sick = worth(board, "sickened"); return { ev: (c.s * sick + (c.f + c.cf) * sick * 2) * (t.state !== "observed" ? 1 : 0.6), how: `only on a creature that tried Deception or Stealth on you this month (Fortitude DC ${sp.dc ?? "?"}): sickened 1 on a success, sickened 2 and a DC 5 flat check on each spell or speech on a failure, for as long as it stays sickened` }; } },
    // Ally hexes: the target is chosen by the hex
    "stoke the heart": { on: "ally", pick(board, env) { return env.strikers[0] ?? null; }, ev(board, sp, a) { const b = 2 + Math.floor(Math.max(0, sp.rank - 1) / 2); return { ev: b * 0.2 * allyHit(a) * 1.5, how: `+${b} status to ${a === board.me ? "your" : "its"} damage rolls while you Sustain` }; } },
    "nudge fate": { on: "ally", pick(board, env) { return env.strikers[0] ?? board.me; }, ev(board, sp, a) { return { ev: 1 + 0.1 * allyHit(a), how: `for a minute, no Sustain, the first time ${a === board.me ? "you" : "it"} fail${a === board.me ? "" : "s"} a roll by 1, it counts as a success instead` }; } },
    "discern secrets": { on: "ally", pick(board, env) { return env.unseen ? (env.strikers[0] ?? board.me) : board.me; }, ev(board, sp, a, env) { return { ev: env.unseen ? worth(board, "off-guard") * 0.5 : 1, how: env.unseen ? `a free Seek with +1 for ${a === board.me ? "you" : nameOf(a)} while you Sustain; there's something unseen to find` : `a free Recall Knowledge, Seek or Sense Motive with +1 while you Sustain` }; } },
    "life boost": { on: "ally", sustain: false, pick(board, env) { return env.hurt ?? null; }, ev(board, sp, a) { const fh = 2 * sp.rank; return { ev: 0.8 * Math.min(missing(a), 4 * fh), how: `fast healing ${fh} for 4 rounds (${a === board.me ? "you're" : "they're"} at ${a.hp}/${a.maxHp})` }; } },
    "blood ward": { on: "ally", pick(board, env) { return env.exposed[0] ?? null; }, ev(board, sp, a, env) { const b = sp.rank >= 5 ? 2 : 1; const t = env.t; const trait = (t?.traits ?? []).find((x) => ["aberration", "animal", "beast", "celestial", "construct", "dragon", "elemental", "fey", "fiend", "fungus", "monitor", "ooze", "plant", "undead"].includes(x)) ?? null; return { ev: trait ? b * 0.1 * foeHit(board, t) * 2 * 1.5 : b, how: `+${b} status to AC and saves against ${trait ? `${trait}s like ${nameOf(t)}` : "one creature trait; the foes' isn't known, so guess it"} while you Sustain` }; } },
    "spirit object": { on: "note", text: () => "Spirit Object (1 action, 30 feet): an unattended object of 1 Bulk or less walks 25 feet; Sustain it to move it again or to Strike (melee spell attack, 2d4). Only when there's something to animate." },
    "share vision": { on: "note", text: () => "Share Vision (1 action, 10 minutes, no Sustain): you and an ally share senses and +2 Perception; cast it before the fight, not during." },
    "manifest will": { on: "note", text: () => "Manifest Will (1 action, 10-foot emanation, Sustain): concealed from anyone outside it, and your tradition's effect on whoever starts a turn inside it." },
    "deceiver's cloak": { on: "note", text: () => "Deceiver's Cloak (2 actions, 1 Focus Point, an hour): an illusory disguise; not a fighting hex." },
    "restorative moment": { on: "note", text: (board) => { const d = [board.me, ...board.allies].find((a) => a.conditions?.has?.("drained") || a.conditions?.has?.("doomed")); return d ? `Restorative Moment (2 actions, 1 Focus Point) on ${d === board.me ? "yourself" : nameOf(d)}: drained and doomed drop by 1 and it saves against its afflictions now; once a day per creature.` : null; } },
    "cackle": { on: "none" }, "phase familiar": { on: "none" }, "patron's puppet": { on: "none" }, "return the favor": { on: "none" }, "sheltering wings": { on: "none" },
};
/** A hex not in the table: scored from what the board knows (save, damage, inflicts). */
function genericHex(board, sp, t, adj = 0) {
    if (!sp.save?.stat) return sp.avg > 0 ? { ev: sp.avg, how: `about ${Math.round(sp.avg)}` } : { ev: 1.5, how: "its effect" };
    const c = deg(board, sp, t, sp.save.stat, adj);
    const conds = (sp.inflicts ?? []).reduce((s, k) => s + worth(board, k), 0);
    const e = sp.avg > 0 ? (sp.save.basic ? c.s * sp.avg / 2 + c.f * sp.avg + c.cf * sp.avg * 2 : (c.f + c.cf) * sp.avg) : 0;
    return { ev: e + (c.f + 1.5 * c.cf) * conds, how: `${cap(sp.save.stat)} DC ${sp.dc ?? "?"}${sp.inflicts?.length ? ` (${sp.inflicts.join(", ")})` : ""}${sp.avg > 0 ? `, about ${Math.round(e)}` : ""}, lands about ${pct(c.f + c.cf)}` };
}

/** The best cast of a hex this turn: its target, worth and step text, or null. adj: the foe's save penalty (Sympathetic Strike). */
function castOf(board, sp, env, { adj = 0, made = 0, only = null } = {}) {
    const H = HEXES[lc(sp.name)] ?? null;
    const on = H?.on ?? (sp.save?.stat || sp.avg > 0 ? "foe" : "none");
    if (on === "none" || on === "note") return null;
    const range = H?.range ?? sp.range ?? 30;
    if (on === "ally") {
        const a = H.pick(board, env);
        if (!a || (only && a !== only)) return null;
        if (a !== board.me && feetBetween(board.me.rect, a.rect) > (env.charge && range === 5 ? 30 : range)) return null;
        const r = H.ev(board, sp, a, env);
        return { sp, target: a, ev: r.ev, cost: sp.cost ?? 1, text: `${sp.name}${rankText(sp)} on ${a === board.me ? "yourself" : nameOf(a)}: ${r.how}`, ally: true };
    }
    let best = null;
    for (const t of env.foes) {
        if (only && t !== only) continue;
        if (feetBetween(board.me.rect, t.rect) > range) continue;
        if (H?.save && (sp.inflicts ?? []).length && sp.inflicts.every((c) => t.conditions?.has?.(c))) continue;
        const r = H ? H.ev(board, sp, t, env, adj, made) : genericHex(board, sp, t, adj);
        if (!best || r.ev > best.ev) best = { sp, target: t, ev: r.ev, cost: sp.cost ?? 1, text: `${sp.name}${rankText(sp)} on ${nameOf(t)}: ${r.how}`, attack: !!H?.attack, needsBleed: !!H?.needsBleed };
    }
    return best;
}

function witch(board, ctx, out) {
    const actor = board.me.actor;
    const me = board.me;
    const lv = level(board);
    const foes = targets(board);
    const fp = focusLeft(actor);
    const fmax = Number(actor?.system?.resources?.focus?.max) || 0;
    const slots = slotsOf(actor);
    const patronSlug = Object.keys(PATRONS).find((s) => hasAny(actor, s, s === "faiths-flamekeeper" ? "faith-s-flamekeeper" : s)) ?? null;
    const patron = patronSlug ? PATRONS[patronSlug] : null;
    const hexMaster = lv >= 20 && has(actor, "hex-master");
    const effortless = lv >= 16 && has(actor, "effortless-concentration");
    const cackleKnown = has(actor, "cackle") || (board.spells ?? []).some((sp) => lc(sp.name) === "cackle");
    const familiar = board.allies.find((a) => a.type === "familiar" || a.actor?.type === "familiar") ?? null;
    const famRect = familiar?.rect ?? me.rect;
    const adjacentFoes = foes.filter((f) => inReach(f.rect, me.rect, f.reach ?? 5));
    const t = primary(board);

    // The hexes on the board (the focus hexes vanish from it when the pool is empty), then off it: this read plans them
    const allHexes = (board.spells ?? []).filter((sp) => isHex(sp) && !sp.consumable);
    const hexes = allHexes.filter((sp) => sp.cost !== null && sp.cost !== undefined && sp.cost <= ctx.actions && (sp.cantrip || fp === null || fp > 0));
    board.spells = (board.spells ?? []).filter((sp) => !isHex(sp));

    // Whose turn to buff, who's hurt, who the foes can reach
    const strikers = [...board.allies.filter((a) => a.type !== "familiar" && a.actor?.type !== "familiar" && a.hasMelee !== false && a.canAct !== false), ...(board.strikes.length ? [me] : [])].sort((a, b) => allyHit(b) - allyHit(a));
    const hurtList = [me, ...board.allies].filter((a) => a.hp > 0 && missing(a) > 0).sort((a, b) => missing(b) / (b.maxHp || 1) - missing(a) / (a.maxHp || 1));
    const exposed = [me, ...board.allies].filter((a) => foes.some((f) => inReach(f.rect, a.rect, f.reach ?? 5))).sort((a, b) => (a === me ? 1 : 0) - (b === me ? 1 : 0));
    const guarded = exposed.find((a) => a !== me) ?? me;
    const unseen = board.enemies.some((e) => e.state !== "observed") || (board.unseenKnown ?? 0) > 0;
    const env = { foes, t, strikers, hurt: hurtList[0] ?? null, exposed, guarded, unseen, charge: lv >= 6 && hasAny(actor, "witchs-charge", "witch-s-charge") };

    // What's left: Focus Points and slots
    if (fp !== null) {
        const focusHexes = allHexes.filter((sp) => !sp.cantrip && lc(sp.name) !== "cackle").map((sp) => sp.name);
        const lessonHexes = Object.entries(LESSONS).filter(([slug]) => has(actor, slug)).map(([, name]) => name).filter((n) => !focusHexes.some((f) => lc(f) === lc(n)));
        if (fp <= 0) out.notes.push(`No Focus Points left: only your hex cantrip${lessonHexes.length ? ` (${lessonHexes.join(", ")} wait for a Refocus, 10 minutes with your familiar${lv >= 12 && has(actor, "hex-focus") ? ", which refills the whole pool with Hex Focus" : ""})` : ""}${cackleKnown ? "; Cackle is out too, so Sustain costs an action" : ""}.`);
        else out.notes.push(`Focus Points: ${fp} of ${fmax}${focusHexes.length ? ` for ${focusHexes.join(", ")}` : ""}${cackleKnown ? ", and Cackle" : ""}.${lv >= 12 && has(actor, "hex-focus") ? " Hex Focus refills the whole pool on a Refocus, so spend them." : fp === fmax && fmax > 1 ? " A Refocus brings back one, so a full pool is points going unused." : ""}`);
    }
    const ranks = Object.keys(slots.byRank).map(Number).sort((a, b) => b - a);
    if (ranks.length) out.notes.push(`Slots left: ${ranks.map((r) => `rank ${r}: ${slots.byRank[r].left} of ${slots.byRank[r].max}`).join(", ")}.${lv >= 19 && slots.byRank[10] ? ` The 10th-rank slot${slots.byRank[10].max > 1 ? "s are Patron's Gift and Patron's Truth" : " is Patron's Gift"}: nothing recasts or replaces it, so it's for the fight that decides the day.` : ""}`);
    if (t && ctx.actions >= 1) {
        const { cantrip, slot, nearlyDown, clear } = cantripOrSlot(board, t, ctx.actions, ctx.made);
        if (cantrip && slot) {
            const verdict = nearlyDown ? `${nameOf(t)} is nearly down, so the slot is worth it` : clear ? "the slot is worth it unless you're saving it" : "keep the slot; the gain is small. Spend one only when the gain is clear, the foe is nearly down, or this is the day's last fight";
            out.notes.push(`Against ${nameOf(t)}: ${cantrip.sp.name} does about ${Math.round(cantrip.e.expected)}, ${slot.sp.name} (rank ${slot.sp.rank}) about ${Math.round(slot.e.expected)}; ${verdict}.`);
        } else if (cantrip && !slot) out.notes.push(`No damaging slot spell of yours reaches ${nameOf(t)} from here; ${cantrip.sp.name} does about ${Math.round(cantrip.e.expected)}, and your slots are for the save spells (Slow, Fear) and the rest.`);
    }

    // The hex already up: the sustained spell the flag remembers, or a hex's effect still on you or an ally
    const upFromFlag = board.sustain && (allHexes.some((sp) => lc(sp.name) === lc(board.sustain.name)) || HEXES[lc(board.sustain.name)]) ? { name: board.sustain.name, value: board.sustain.value ?? 0 } : null;
    let up = upFromFlag;
    if (!up) {
        for (const c of [me, ...board.allies]) {
            const fx = c.actor?.items?.find?.((i) => i.type === "effect" && /^spell-effect-(stoke-the-heart|blood-ward|discern-secrets|elemental-betrayal|needle-of-vengeance|clinging-ice|evil-eye|veil-of-dreams|sting-of-the-sea|murmuration|pact-broker|personal-blizzard|malicious-shadow|trade-death-for-life|stumbling-curse|share-vision)$/.test(slugOf(i)));
            if (fx) { const name = String(fx.name ?? "").replace(/^Spell Effect:\s*/i, ""); if (lc(name) !== "share vision") up = { name, value: 0 }; break; }
        }
    }
    if (up && !(up.value > 0)) {
        const sp = allHexes.find((x) => lc(x.name) === lc(up.name));
        const c = sp ? castOf(board, sp, env) : null;
        up.value = c ? 0.6 * c.ev : 0.3 * (6 + 1.6 * lv);
    }
    const sustainFree = up && effortless;

    // The hex to cast this turn: the best on a foe, and the best on an ally, each then the spell by the rule
    // The hex already up isn't cast again (a second casting ends the first)
    const casts = hexes.filter((sp) => !up || lc(sp.name) !== lc(up.name)).map((sp) => castOf(board, sp, env, { made: ctx.made })).filter(Boolean);
    const cheapCackle = cackleKnown && fp === 1 && up && !sustainFree;
    for (const c of casts) if (!c.sp.cantrip && cheapCackle) c.ev -= 1;
    const bestFoe = casts.filter((c) => !c.ally && !c.needsBleed).sort((a, b) => b.ev - a.ev)[0] ?? null;
    const bestAlly = casts.filter((c) => c.ally).sort((a, b) => b.ev - a.ev)[0] ?? null;
    const focusNote = (c) => (c.sp.cantrip ? null : `${c.sp.name} spends a Focus Point${fp !== null ? ` (${fp} left)` : ""}.`);
    const familiarNote = (plan) => {
        if (!patron?.trick) return;
        const inRange = patron.reach === null || patron.reach === 0 || foes.some((f) => feetBetween(famRect, f.rect) <= patron.reach) || [me, ...board.allies].some((a) => a !== familiar && feetBetween(famRect, a.rect) <= patron.reach);
        let text = `Your familiar (${patron.familiar}) ${patron.trick} when you Cast or Sustain a hex`;
        if (patronSlug === "the-unseen-broker") { const near = foes.filter((f) => feetBetween(famRect, f.rect) <= 10); if (near.length) { plan.ev += worth(board, "off-guard"); text += `: ${nameOf(near[0])} is within 10 feet of it, off-guard for your allies' turn`; } else text += "; it's not within 10 feet of a foe now"; }
        else if (patronSlug === "paradox-of-opposites") { const near = foes.filter((f) => feetBetween(famRect, f.rect) <= 20); if (near.length) { plan.ev += worth(board, "stupefied") * 0.7; text += `: ${nameOf(near.find((f) => f.caster) ?? near[0])}`; } }
        else if (patronSlug === "faiths-flamekeeper") { plan.ev += 0.4 * (2 + Math.floor(lv / 2)); text += `: ${2 + Math.floor(lv / 2)} temporary HP, on whoever the foes will swing at`; }
        else if (patronSlug === "spinner-of-threads") { plan.ev += 0.1 * (t ? foeHit(board, t) : 5) * 2; text += t && feetBetween(famRect, t.rect) <= 15 ? `: -1 AC on ${nameOf(t)} before your allies attack it` : ""; }
        else if (patronSlug === "the-inscribed-one") { const f = foes.find((x) => inReach(famRect, x.rect, 5) && board.allies.some((a) => a !== familiar && inReach(a.rect, x.rect, a.reach ?? 5))); if (f) { plan.ev += worth(board, "off-guard") * 0.5; text += `: it stands at ${nameOf(f)}, so an ally opposite it flanks`; } else text += "; move it to the far side of a foe your melee allies are on"; }
        else if (patronSlug === "devourer-of-decay") { const f = foes.find((x) => feetBetween(famRect, x.rect) <= 15 && x.hp !== undefined && x.maxHp && x.hp < x.maxHp / 2); if (f) { plan.ev += worth(board, "sickened") * 0.5; text += `: ${nameOf(f)} is below half`; } }
        else if (patronSlug === "the-resentment") { const f = foes.find((x) => feetBetween(famRect, x.rect) <= 15 && (x.conditions?.size ?? 0) > 0); if (f) text += `: ${nameOf(f)}'s ${[...f.conditions].join(", ")} last a round longer`; }
        else if (patronSlug === "wilding-steward") { if (unseen) { plan.ev += 1.5; text += ": there's an unseen foe to Point Out"; } }
        else if (patronSlug === "starless-shadow") { const f = foes.find((x) => inReach(famRect, x.rect, 5)); text += f ? `; it's next to ${nameOf(f)}, so if that foe can't see it, frightened 1` : "; it has to be next to a foe that can't see it"; }
        else if (!inRange) text += "; nothing is in its reach now";
        plan.notes.push(`${text}.`);
    };
    const hexPlan = (c, { prefix = [], prefixEv = 0, prefixNotes = [], title = null, sustain = null, allowSpell = true, made = ctx.made } = {}) => {
        const steps = [...prefix];
        let ev = prefixEv;
        let rest = ctx.actions - prefix.reduce((n, s) => n + (s.cost || 0), 0);
        if (sustain) { steps.push(sustain.step); ev += sustain.ev; rest -= sustain.step.cost || 0; }
        let moved = false;
        if (c) {
            const target = c.ally ? null : c.target;
            const range = HEXES[lc(c.sp.name)]?.range ?? c.sp.range ?? 30;
            if (target && feetBetween(me.rect, target.rect) > range) {
                const sq = reachableSquares(board, 1).filter((s) => s.route.actions === 1 && feetBetween({ x: s.x, y: s.y, w: me.rect.w, h: me.rect.h }, target.rect) <= range).sort((a, b) => a.route.provokes.length - b.route.provokes.length)[0];
                if (!sq || rest < 1 + c.cost) return null;
                steps.push({ cost: 1, text: `${sq.route.via ?? "Stride"} into range of ${nameOf(target)}` }); rest -= 1; moved = true; c.dest = { x: sq.x, y: sq.y };
            }
            if (rest < c.cost) return null;
            steps.push({ cost: c.cost, text: c.text }); ev += c.ev; rest -= c.cost;
            if (c.attack) made += 1;
        }
        const notes = [...prefixNotes];
        if (c && focusNote(c)) notes.push(focusNote(c));
        if (allowSpell && rest >= 1) {
            const at = c && !c.ally ? c.target : t;
            if (at && !moved) { const f = fillRest(board, at, rest, made, ev); steps.push(...f.steps); ev += f.ev; rest = f.rest; }
            else if (at && moved) { const next = spendOrNot(board, at, rest, made, ev); if (next && (next.sp.range ?? 30) >= feetBetween(me.rect, at.rect) - 30) { steps.push({ cost: next.sp.cost, text: `Cast ${next.sp.name}${rankText(next.sp)} at ${nameOf(at)} (about ${Math.round(next.e.expected)})` }); ev += next.e.expected; rest -= next.sp.cost; } }
        }
        if (rest >= 1 && adjacentFoes.length && !moved) steps.push({ cost: 1, text: `Step out of reach of ${adjacentFoes.map(nameOf).join(", ")}` });
        if (sustain && sustain.step.cost === 0) notes.push(`Cackle spends a Focus Point${fp !== null ? ` (${fp} left)` : ""}.`);
        if (c && sustain && HEXES[lc(c.sp.name)]?.sustain !== false && !hexMaster) notes.push(`Two hexes up next turn: a Sustain action for each, or Cackle for one and the action for the other.`);
        if (c && !c.sp.cantrip && HEXES[lc(c.sp.name)]?.sustain !== false && !hexMaster && !sustain) notes.push(`${c.sp.name} keeps going only while you Sustain it${cackleKnown ? "; Cackle (free, 1 Focus Point) does that next turn and counts as that turn's hex" : "; that's an action each turn"}.`);
        if (up && !sustain && !sustainFree && c) notes.push(`${up.name} ends: this doesn't Sustain it.`);
        if (sustainFree) { ev += up.value; notes.push(`Effortless Concentration Sustains ${up.name} for free as your turn begins.`); }
        if (adjacentFoes.length && c) notes.push(`Casting next to ${adjacentFoes.map(nameOf).join(", ")} provokes a Reactive Strike if it has one.`);
        const plan = { kind: "class", title: title ?? (c ? `${c.sp.name} on ${c.ally ? (c.target === me ? "yourself" : nameOf(c.target)) : nameOf(c.target)}` : "Hex turn"), target: c && !c.ally ? c.target : null, ev, score: ev + 0.3, dest: c?.dest ?? null, steps, notes };
        if (c) familiarNote(plan); else if (sustain) familiarNote(plan);
        plan.score = plan.ev + 0.3;
        return plan;
    };
    const push = (p) => { if (p && p.steps.length) out.plans.push(p); };

    // One hex a turn (Hex Master lifts it): the foe hex and the ally hex are two plans, not one
    const sustainStep = up && !sustainFree ? { step: { cost: 1, text: `Sustain ${up.name} (if it's still up)` }, ev: up.value } : null;
    const cackleStep = up && !sustainFree && cackleKnown && fp !== null && fp > 0 ? { step: { cost: 0, text: `Cackle (free action, 1 Focus Point): Sustain ${up.name}${hexMaster ? " and every other hex you have going" : ""}` }, ev: up.value } : null;
    if (hexMaster && bestFoe && bestAlly && ctx.actions >= bestFoe.cost + bestAlly.cost) {
        const both = hexPlan(bestFoe, { title: `${bestFoe.sp.name} and ${bestAlly.sp.name}`, prefix: [{ cost: bestAlly.cost, text: bestAlly.text }], prefixEv: bestAlly.ev, prefixNotes: ["Hex Master: no limit of one hex a turn."], sustain: cackleStep });
        push(both);
    }
    const freeHex = [bestFoe, bestAlly].some((c) => c && !c.sp.cantrip) ? casts.filter((c) => c.sp.cantrip && !c.needsBleed && c !== bestFoe && c !== bestAlly).sort((a, b) => b.ev - a.ev)[0] ?? null : null;
    for (const c of [bestFoe, bestAlly, freeHex].filter(Boolean)) {
        if (sustainFree || !up) push(hexPlan(c));
        else {
            // Keep the hex up and cast another: the Sustain action, or Cackle (a hex itself, so no second hex unless Hex Master)
            if (ctx.actions >= 1 + c.cost) push(hexPlan(c, { title: `Sustain ${up.name}, then ${c.sp.name}`, sustain: sustainStep }));
            if (cackleStep && hexMaster) push(hexPlan(c, { title: `Cackle for ${up.name}, then ${c.sp.name}`, sustain: cackleStep }));
            push(hexPlan(c));
        }
    }
    if (cackleStep && !hexMaster) push(hexPlan(null, { title: `Cackle for ${up.name}, then a spell`, sustain: cackleStep, prefixNotes: ["Cackle is your hex for this turn: no other hex until your next turn."] }));
    if (!hexes.length && allHexes.length && fp === 0) out.notes.push("No hex this turn unless you have a hex cantrip in range; the lesson hexes need a Focus Point.");

    // Sympathetic Strike (4): an armament Strike that lands puts -1 on the foe's saves against your hexes (-2 on a crit)
    const armaments = board.strikes.filter((s) => !s.ranged && /nails|jaws|hair|teeth/i.test(s.label ?? ""));
    if (lv >= 4 && has(actor, "sympathetic-strike") && armaments.length && bestFoe && HEXES[lc(bestFoe.sp.name)]?.save && ctx.actions >= 1 + bestFoe.cost) {
        const f = bestFoe.target;
        if (inReach(me.rect, f.rect, Math.max(...armaments.map((s) => s.reach || 5)))) {
            const s = armaments.sort((a, b) => b.avg - a.avg)[0];
            const e = strikeExpected(s.bonus + mapFor(ctx.made, s.agile), f.ac, s.avg, { deadly: s.deadly });
            const sp = bestFoe.sp;
            const hit = castOf(board, sp, env, { adj: -1, only: f });
            const crit = castOf(board, sp, env, { adj: -2, only: f });
            if (hit && crit) {
                const hexEv = e.hit * ((e.hit - e.crit) / Math.max(0.01, e.hit) * hit.ev + e.crit / Math.max(0.01, e.hit) * crit.ev) + (1 - e.hit) * bestFoe.ev;
                const c = { ...bestFoe, ev: hexEv, text: hit.text };
                push(hexPlan(c, { title: `Sympathetic Strike, then ${sp.name}`, prefix: [{ cost: 1, text: `Sympathetic Strike: ${s.label} at ${nameOf(f)} (${signed(s.bonus + mapFor(ctx.made, s.agile))}, hits about ${pct(e.hit)}, about ${Math.round(e.expected)}); a hit gives it -1 to saves against your hexes until your next turn, -2 on a crit` }], prefixEv: e.expected, made: ctx.made + 1, sustain: up && !sustainFree && cackleStep && hexMaster ? cackleStep : null }));
            }
        }
    }
    // Blood in the Water (Lesson of the Shark): a slashing Strike first meets its requirement
    const blood = casts.find((c) => c.needsBleed);
    if (blood && ctx.actions >= 1 + blood.cost) {
        const slashers = board.strikes.filter((s) => !s.ranged && (s.traits?.includes("slashing") || /nails|sword|axe|scythe|sickle/i.test(s.label ?? "")) && inReach(me.rect, blood.target.rect, s.reach || 5));
        const s = slashers.sort((a, b) => b.avg - a.avg)[0];
        if (s) {
            const e = strikeExpected(s.bonus + mapFor(ctx.made, s.agile), blood.target.ac, s.avg, { deadly: s.deadly });
            push(hexPlan({ ...blood, ev: blood.ev, needsBleed: false }, { title: `Cut ${nameOf(blood.target)}, then Blood in the Water`, prefix: [{ cost: 1, text: `Strike ${nameOf(blood.target)} with ${s.label} (${signed(s.bonus + mapFor(ctx.made, s.agile))}, slashing, about ${Math.round(e.expected)}): that's the hex's requirement${e.hit < 1 ? ", met whether it hits or not" : ""}` }], prefixEv: e.expected, made: ctx.made + 1, allowSpell: false }));
        } else out.notes.push(`Blood in the Water (2 actions, 1 Focus Point) needs a bleeding foe or slashing damage from your last action; nothing you hold slashes in reach of ${nameOf(blood.target)}.`);
    }
    // Split Hex (18): the next harmful single-target hex, 2 ranks lower, on a second foe too
    if (lv >= 18 && has(actor, "split-hex") && bestFoe && HEXES[lc(bestFoe.sp.name)]?.on === "foe" && ctx.actions >= 1 + bestFoe.cost) {
        const r2 = Math.max(1, bestFoe.sp.rank - 2);
        const low = { ...bestFoe.sp, rank: r2, avg: (bestFoe.sp.avg || 0) * r2 / Math.max(1, bestFoe.sp.rank) };
        const second = foes.filter((f) => f !== bestFoe.target && feetBetween(me.rect, f.rect) <= (HEXES[lc(bestFoe.sp.name)]?.range ?? 30)).map((f) => castOf(board, low, env, { only: f })).filter(Boolean).sort((a, b) => b.ev - a.ev)[0] ?? null;
        if (second) {
            const lowered = castOf(board, low, env, { only: bestFoe.target });
            const c = { ...bestFoe, ev: (lowered?.ev ?? bestFoe.ev) + second.ev, text: `${bestFoe.sp.name} at rank ${Math.max(1, bestFoe.sp.rank - 2)} on ${nameOf(bestFoe.target)} and ${nameOf(second.target)}: ${(lowered ?? bestFoe).text.replace(/^[^:]*:\s*/, "")}` };
            push(hexPlan(c, { title: `Split Hex: ${bestFoe.sp.name} on two`, prefix: [{ cost: 1, text: `Split Hex (1 action): the hex loses 2 ranks and gains a second target` }], sustain: up && !sustainFree ? (cackleStep && hexMaster ? cackleStep : null) : null }));
        }
    }

    // The familiar's own activities (its two actions after you Command it, 1 action of yours)
    const dc = (board.spells ?? []).find((x) => x.dc)?.dc ?? allHexes.find((x) => x.dc)?.dc ?? 10 + lv + 4;
    const famPlan = (title, text, ev, notes, allowHex = true) => {
        if (ctx.actions < 1) return;
        const rest = ctx.actions - 1;
        // With a hex up: Cackle keeps it (and is the turn's hex unless Hex Master); without Cackle the hex drops
        const hexOk = allowHex && bestFoe && bestFoe.cost <= rest && (!up || sustainFree || !cackleStep || hexMaster);
        const after = hexOk ? bestFoe : null;
        const steps = [{ cost: 1, text: `Command your familiar: ${text}` }];
        let total = ev;
        if (cackleStep) { steps.unshift(cackleStep.step); total += cackleStep.ev; }
        else if (up && !sustainFree) notes.push(`${up.name} ends: this doesn't Sustain it.`);
        if (after) { steps.push({ cost: after.cost, text: after.text }); total += after.ev; if (focusNote(after)) notes.push(focusNote(after)); }
        const left = rest - (after?.cost ?? 0);
        if (left >= 1 && t) { const f = fillRest(board, t, left, ctx.made, total); steps.push(...f.steps); total += f.ev; }
        out.plans.push({ kind: "class", title, target: t, ev: total, score: total + 0.3, dest: null, steps, notes });
    };
    const famDice = 6 + Math.max(0, Math.ceil((lv - 8) / 2) * 2);
    if (lv >= 8 && hasAny(actor, "spirit-familiar-witch", "spirit-familiar") && t && feetBetween(famRect, t.rect) <= 20) {
        const e = saveExpected(t.saves?.will ?? lv + 5, dc, famDice * 3.5, { basic: true });
        const ally = hurtList.find((a) => feetBetween(a.rect, t.rect) <= 30) ?? null;
        const heal = ally ? 0.8 * Math.min(missing(ally), e.expected / 2) : 0;
        famPlan(`Shed Spirit at ${nameOf(t)}`, `Shed Spirit (its 2 actions): ${famDice}d6 spirit at ${nameOf(t)} with a basic Will save against your DC ${dc} (about ${Math.round(e.expected)})${ally ? `, then it heals ${ally === me ? "you" : nameOf(ally)} half of what it dealt` : ""}`, e.expected + heal, ["Once every 10 minutes; the sheet doesn't count it, so count it yourself. Its spirit flies from where it stands, 20 feet to the foe."]);
    }
    if (lv >= 8 && has(actor, "stitched-familiar") && t && feetBetween(famRect, t.rect) <= 30) {
        const e = saveExpected(t.saves?.reflex ?? lv + 5, dc, famDice * 3.5, { basic: true });
        famPlan(`Stitching Strike at ${nameOf(t)}`, `Stitching Strike (its 2 actions): ${famDice}d6 slashing at ${nameOf(t)} with a basic Reflex save against your DC ${dc} (about ${Math.round(e.expected)}), immobilized for a round on a failure`, e.expected + e.fail * worth(board, "immobilized"), ["Once every 10 minutes; the sheet doesn't count it, so count it yourself."]);
    }
    if (lv >= 14 && hasAny(actor, "patrons-presence", "patron-s-presence")) {
        const inAura = foes.filter((f) => feetBetween(famRect, f.rect) <= 15);
        if (inAura.length) {
            const ev = inAura.reduce((s, f) => { const c = degreeChances(f.saves?.will ?? lv + 5, dc); return s + (c.f * 2 + c.cf * 3) * worth(board, "stupefied") * 0.7 * (f.caster ? 1.5 : 1); }, 0);
            famPlan(`Patron's Presence on ${inAura.map(nameOf).join(", ")}`, `Patron's Presence (its 2 actions, once an hour): a 15-foot aura; ${inAura.map(nameOf).join(", ")} save against Will DC ${dc} or are stupefied 2 (3 on a critical failure) while inside it`, ev, ["The aura lasts until your next turn ends; the familiar can Sustain it up to a minute. Casters inside it suffer most."]);
        }
    }
    if (lv >= 18 && hasAny(actor, "patrons-claim", "patron-s-claim") && t && feetBetween(famRect, t.rect) <= 30) {
        const e = saveExpected(t.saves?.fortitude ?? lv + 5, dc, 55, { basic: true });
        famPlan(`Patron's Claim on ${nameOf(t)}`, `Patron's Claim (its 2 actions, once an hour): 10d10 spirit at ${nameOf(t)}, basic Fortitude against DC ${dc} (about ${Math.round(e.expected)}); drained 2 on a failure (4 on a critical failure), and you get a Focus Point back`, e.expected + e.fail * worth(board, "drained") * 2 + (fp !== null && fp < fmax ? 1.5 : 0), []);
    }

    // The familiar's other hexes and the patron's trick when no hex is planned
    if (allHexes.some((sp) => lc(sp.name) === "patron's puppet")) out.notes.push(`Patron's Puppet (free action as your turn begins, 1 Focus Point): your familiar acts without the Command action, but it counts as your hex for the turn${hexMaster ? " (not with Hex Master)" : ""}; worth it only on a turn the familiar's two actions matter more than a hex.`);
    if (allHexes.some((sp) => lc(sp.name) === "phase familiar") && (fp === null || fp > 0)) out.notes.push(`Phase Familiar (reaction, 1 Focus Point) when your familiar would take damage: resistance ${5 + 2 * Math.max(0, Math.ceil(lv / 2) - 1)} to it and immunity to precision. Your prepared spells survive its death; it's the hex tricks you'd lose until morning.`);
    if (allHexes.some((sp) => lc(sp.name) === "return the favor") && (fp === null || fp > 0)) out.notes.push(`Return the Favor (reaction, 1 Focus Point) when an ally's reaction helps you: that ally gets ${12 + 4 * Math.max(0, Math.ceil(lv / 2) - 3)} temporary HP for a minute.`);
    if (allHexes.some((sp) => lc(sp.name) === "sheltering wings") && (fp === null || fp > 0)) out.notes.push("Sheltering Wings (reaction, 1 Focus Point) when an ally moves within 15 feet of you: your familiar flies 30 feet to ride on them and gives them cover until your next turn.");
    for (const sp of allHexes) { const H = HEXES[lc(sp.name)]; if (H?.on === "note") { const text = H.text(board); if (text) out.notes.push(text); } }
    if (!out.plans.length && patron?.trick) out.notes.push(`Your familiar (${patron.familiar}) ${patron.trick} each time you Cast or Sustain a hex.`);
    if (patron && !allHexes.length) out.notes.push(`${patron.name}: your hex cantrip is ${patron.hex.replace(/\b\w/g, (ch) => ch.toUpperCase())}; it isn't on the board, so check the focus spell entry.`);

    // Siphon Power (16, once a day, before you act): a patron or lesson spell cast without a slot, rank top-1 or lower
    if (lv >= 16 && has(actor, "siphon-power") && ctx.actions === 3 && ctx.made === 0) {
        const left = usesLeft(actor, "siphon-power");
        if (left === 0) out.notes.push("Siphon Power is spent for today.");
        else {
            const lessonNames = new Set(["sleep", "breathe fire", "air bubble", "hydraulic push", "pummeling rubble", "spirit link", "mystic armor", "phantom pain", "ill omen", "mad monkeys", "chilling darkness", "wall of wind", "mind of menace", "insect form", "levitate", "feet to fins", "subconscious suggestion", "raise dead", "field of life", "wall of ice", "cursed metamorphosis"]);
            const cands = slots.known.filter((sp) => lessonNames.has(lc(sp.name)) && Number(sp.rank ?? sp.system?.level?.value ?? 1) <= slots.top - 1).map((sp) => sp.name);
            out.notes.push(`Siphon Power (free action before you act, once a day): cast a spell your patron or a lesson taught your familiar without a slot or preparing it, rank ${Math.max(1, slots.top - 1)} or lower${cands.length ? `; unprepared now: ${[...new Set(cands)].join(", ")}` : ""}. Use it on the first turn you want two slot spells, or a spell you didn't prepare.`);
        }
    }
    // Quickened Casting (10, once a day): a 2-action spell in one action, then another 2-action spell
    if (lv >= 10 && has(actor, "quickened-casting") && ctx.actions >= 3 && t) {
        const qLeft = usesLeft(actor, "quickened-casting");
        if (qLeft === 0) out.notes.push("Quickened Casting is spent for today.");
        else {
            const pool = hurters(board, t, 2).filter((sp) => sp.cost === 2 && !isFocus(sp)).map((sp) => ({ sp, e: spellExpected(board, sp, t, ctx.made) }));
            const q = pool.filter((x) => x.sp.cantrip || (x.sp.rank ?? 1) <= slots.top - 2).sort((a, b) => b.e.expected - a.e.expected)[0];
            if (q) {
                const second = pool.filter((x) => x.sp !== q.sp).sort((a, b) => b.e.expected - a.e.expected)[0] ?? (q.sp.cantrip ? q : null);
                if (second) {
                    const ev = q.e.expected + second.e.expected;
                    out.plans.push({ kind: "class", title: `Quickened Casting: ${q.sp.name}, then ${second.sp.name}`, target: t, ev, score: ev + 0.4, dest: null,
                        steps: [{ cost: 0, text: `Quickened Casting (free, once a day): ${q.sp.name}${rankText(q.sp)} takes 1 action` }, { cost: 1, text: `Cast ${q.sp.name} at ${nameOf(t)} (about ${Math.round(q.e.expected)})` }, { cost: 2, text: `Cast ${second.sp.name}${rankText(second.sp)} at ${nameOf(t)} (about ${Math.round(second.e.expected)})` }],
                        notes: [`Only a cantrip or a spell of rank ${Math.max(1, slots.top - 2)} or lower can be quickened. No hex this turn, unless you drop the second spell for one.${up && !sustainFree ? ` ${up.name} ends unless Cackle keeps it.` : ""}`] });
                }
            }
        }
    }

    // Witch's Armaments and the hair feats: the Strikes are on the board; what changes the math
    if (lv >= 6 && hasAny(actor, "wild-witchs-armaments", "wild-witch-s-armaments")) {
        if (armaments.some((s) => /nails/i.test(s.label))) out.notes.push(`Wild Witch's Armaments: a second nails hit in a row on the same foe adds ${Math.floor(lv / 2)} slashing; two nails Strikes beat one Strike and a cantrip only against a low AC.`);
        if (armaments.some((s) => /jaws|teeth/i.test(s.label))) out.notes.push("Wild Witch's Armaments: a jaws critical hit means a save against your DC or sickened 1.");
        if (board.strikes.some((s) => /quills/i.test(s.label))) out.notes.push("Your quills (15 feet) are the armament to use when nothing is in reach.");
    }
    if (lv >= 8 && hasAny(actor, "syu-tak-nwas-hexed-locks", "syu-tak-nwa-s-hexed-locks") && armaments.some((s) => /hair/i.test(s.label))) {
        const hair = armaments.find((s) => /hair/i.test(s.label));
        const two = allHexes.filter((sp) => sp.cost >= 2 && !HEXES[lc(sp.name)]?.attack);
        if (two.length && t && inReach(me.rect, t.rect, hair.reach || 10)) { const e = strikeExpected(hair.bonus + mapFor(ctx.made, hair.agile), t.ac, hair.avg); out.notes.push(`Hexed Locks: a 2-action hex on ${nameOf(t)} (${two.map((s) => s.name).join(", ")}) can ride a hair Strike (${signed(hair.bonus + mapFor(ctx.made, hair.agile))}, hits about ${pct(e.hit)}); the hex is lost on a miss, so only when the hit chance beats the save's.`); }
        else out.notes.push("Hexed Locks: your hair has reach, and a 2-action hex on a foe in reach can ride a hair Strike (no hex on a miss).");
    }
    if (lv >= 20 && hasAny(actor, "demons-hair", "demon-s-hair")) out.notes.push(`Demon's Hair: while your familiar is alive and within 30 feet you're quickened, the extra action a hair Strike only${familiar && feetBetween(famRect, me.rect) > 30 ? "; it's farther than that now" : ""}. A non-cantrip 2-action hex on a foe in reach can ride a hair Strike, and is lost on a miss.`);

    // Spellshape feats: one action before the spell, each with its moment (free with Spellshape Mastery)
    const free = lv >= 20 && (has(actor, "spellshape-mastery") || has(actor, "metamagic-mastery"));
    const prefix = free ? "free action" : "1 action";
    const single = castable(board, (sp) => sp.cost && !sp.area && !sp.heals && sp.avg > 0 && (sp.save?.stat || (sp.attack !== null && sp.attack !== undefined)));
    if (has(actor, "reach-spell")) {
        const far = foes.filter((f) => { const d = feetBetween(me.rect, f.rect); return [...single, ...allHexes].some((sp) => d > (sp.range ?? 30) && d <= (sp.range ?? 30) + 30); });
        if (far.length) out.notes.push(`Reach Spell (${prefix}): +30 feet of range puts ${far.map(nameOf).join(", ")} in reach of a spell or hex that falls short now.`);
        else if (foes.length && !adjacentFoes.length) out.notes.push(`Reach Spell (${prefix}): +30 feet of range, 30 feet for a touch spell; nothing out of range now.`);
    }
    if (has(actor, "widen-spell")) { const areas = castable(board, (sp) => sp.area && ["burst", "cone", "line"].includes(sp.area.shape) && sp.cost); if (areas.length && foes.length >= 2) out.notes.push(`Widen Spell (${prefix}): +5 feet on a burst of 10 or more, +5 or +10 on a cone or line; worth it when a second foe stands just outside ${areas[0].name}'s area.`); }
    if (has(actor, "conceal-spell")) out.notes.push(`Conceal Spell (${prefix}): the spell is subtle, so no one sees you cast it${adjacentFoes.length ? "; it doesn't stop a Reactive Strike" : ""}.`);
    if (lv >= 6 && has(actor, "detonating-spell") && t && foes.some((f) => f !== t && inReach(f.rect, t.rect, 5))) out.notes.push(`Detonating Spell (${prefix}): a single-target spell that damages ${nameOf(t)} splashes its rank onto the foes next to it.`);
    if (lv >= 8 && has(actor, "chaotic-spell")) out.notes.push(`Chaotic Spell (${prefix}) on an acid, cold, electricity, fire or sonic spell: the type is rerolled and a rider comes with it; a gamble when the foe resists your type.`);
    if (free) out.notes.push("Spellshape Mastery: your spellshape actions are free actions now, so every spell gets one.");
    if (lv >= 12 && has(actor, "coven-spell")) { const casters = board.allies.filter((a) => a.caster && feetBetween(me.rect, a.rect) <= 30); if (casters.length) out.notes.push(`Coven Spell (reaction) when ${casters.map(nameOf).join(" or ")} casts within 30 feet: a damage spell with no duration gets +its rank to damage, or you lend it one of your spellshapes.`); }

    // Reactions and the rest that fire on a condition
    if (has(actor, "counterspell-prepared") || has(actor, "counterspell")) out.notes.push(`Counterspell (reaction) fires when a foe you can see casts a spell you have prepared: that prepared spell is spent to counteract it${lv >= 14 && has(actor, "reflect-spell") ? "; Reflect Spell turns a countered targeted or area spell back on its caster" : ""}.`);
    if (lv >= 4 && has(actor, "portents-of-the-haruspex")) { const low = foes.filter((f) => f.hp !== undefined && f.hp <= 0.25 * (f.maxHp ?? f.hp)); out.notes.push(`Portents of the Haruspex (reaction) when a creature within 30 feet drops to 0 HP: roll a d12 for a damage type, and the next foe to take it from the party before your next turn ends has weakness ${lv} to it${low.length ? `; ${low.map(nameOf).join(", ")} may drop this round` : ""}.`); }
    if (lv >= 6 && has(actor, "steady-spellcasting") && adjacentFoes.length) out.notes.push("Steady Spellcasting: a Reactive Strike that would disrupt your casting only does so if you fail a DC 15 flat check.");
    if (effortless && !up) out.notes.push("Effortless Concentration: one of your hexes is Sustained for free as your turn begins.");
    if (env.charge) { const touch = castable(board, (sp) => (sp.range ?? 30) <= 5 && sp.cost); if (touch.length) out.notes.push(`Witch's Charge: your touch spells (${touch.map((s) => s.name).join(", ")}) reach your charge from 30 feet${lv >= 10 && hasAny(actor, "witchs-communion", "witch-s-communion") ? ", and you have up to your Intelligence modifier of charges" : ""}.`); }
    if (lv >= 8 && hasAny(actor, "witchs-bottle", "witch-s-bottle") && fp !== null && fp < fmax) out.notes.push("Witch's Bottle: a bottled hex holds its Focus Point until someone drinks it; if you brewed one this morning, that's where the missing point is, and an ally can drink a Stoke the Heart or a foe can be fed an Evil Eye.");
    if (lv >= 2 && has(actor, "scatter-swarm") && foes.some((f) => (f.traits ?? []).includes("swarm"))) out.notes.push(`Scatter Swarm (1 action): a swarm sharing your familiar's space takes its area weakness in acid, cold, electricity or fire; move the familiar into ${nameOf(foes.find((f) => (f.traits ?? []).includes("swarm")))} first.`);
    if (lv >= 8 && hasAny(actor, "helts-spelldance", "helt-s-spelldance") && adjacentFoes.length) out.notes.push(`Helt's Spelldance (3 actions): Performance against ${adjacentFoes.map(nameOf).join(", ")}'s Perception DC, then Stride away without their reactions and cast a 2-action spell; the way out of melee that still casts.`);
    if (lv >= 4 && has(actor, "rites-of-convocation")) out.notes.push("Rites of Convocation: 10 minutes with your familiar swaps a prepared spell for your summon spell at the same rank; nothing for this turn, but think of it between fights.");
    if (lv >= 14 && has(actor, "rites-of-transfiguration")) out.notes.push("Rites of Transfiguration: 10 minutes with your familiar swaps a prepared 6th-rank or higher spell for Cursed Metamorphosis; between fights.");
    if (lv >= 10 && has(actor, "double-double") && !has(actor, "cauldron")) out.notes.push("Double, Double needs Cauldron's brew; the morning's temporary potions are gone tomorrow, so drink them before a slot does the same job.");
    else if (has(actor, "cauldron")) out.notes.push("Cauldron: the potion or oil you brewed this morning is gone at your next preparations; use it before a slot that does the same job.");
    if (lv >= 20 && has(actor, "hex-master")) out.notes.push("Hex Master: as many hexes a turn as you have actions, and one Cackle Sustains all of them.");
}

export { witch };
