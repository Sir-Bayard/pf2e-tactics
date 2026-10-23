/**
 * PF2e NPC Tactics: reader.mjs
 * Reading abilities, dice math, grid geometry and the live scene into plain data the advisor plans on. Pure functions where possible, so they run outside Foundry for testing.
 * One module, several files: see pf2e-tactics.mjs for the whole.
 */
import { CONDITION_VALUE } from "./advisor.mjs";
import { FLAG_SCOPE, MODULE_ID, baseActorOf, cap, esc, flagOf } from "./shared.mjs";
import { hitWorth, threatFor } from "./state.mjs";
import { notesOf, rechargeLeft, tacticsOf } from "./card.mjs";

// Reading abilities. Pure functions over plain data, so they run outside Foundry for testing.
// An ability is { name, kind, cost, category, traits, html, rules, selfName } and comes back as a
// profile: what it does in the terms the advisor plans with (movement, Strikes, areas, saves,
// conditions it leaves, what it needs first, what triggers it).
// ---------------------------------------------------------------------------------------------

const CONDITION_WORDS = ["grabbed", "restrained", "prone", "off-guard", "frightened", "stunned", "slowed", "sickened",
    "clumsy", "enfeebled", "drained", "stupefied", "blinded", "dazzled", "deafened", "immobilized", "paralyzed",
    "fatigued", "confused", "fascinated", "doomed", "persistent damage", "petrified", "unconscious", "controlled",
    "fleeing", "concealed", "hidden", "invisible", "undetected", "quickened", "wounded"];
/** Conditions that make a target easier to hit or hurt next, or take it out of the fight. */
const SETUP_CONDITIONS = new Set(["grabbed", "restrained", "prone", "off-guard", "frightened", "stunned", "slowed",
    "blinded", "dazzled", "immobilized", "paralyzed", "clumsy", "sickened", "stupefied", "enfeebled", "fleeing",
    "confused", "fascinated", "petrified", "unconscious", "controlled"]);
const NUMBER_WORDS = { once: 1, one: 1, a: 1, an: 1, twice: 2, two: 2, double: 2, thrice: 3, three: 3, "three times": 3, four: 4, "two times": 2 };
const MOVE_VERBS = { step: "step", steps: "step", stride: "stride", strides: "stride", fly: "fly", flies: "fly",
    burrow: "burrow", burrows: "burrow", climb: "climb", climbs: "climb", swim: "swim", swims: "swim",
    leap: "leap", leaps: "leap", move: "move", moves: "move", teleport: "teleport", teleports: "teleport",
    crawl: "crawl", crawls: "crawl", charges: "stride", dashes: "stride", shift: "step", shifts: "step" };
const SPEED_OF = { fly: "fly", burrow: "burrow", climb: "climb", swim: "swim" };
/** Words that, before a move verb in its sentence, mean someone else is moving. */
const OTHER_SUBJECT = /\b(target|targets|enemy|enemies|foe|foes|ally|allies|creature|creatures|opponent|it pushes|pushed|pulled|knocks|attacker|each|anyone|someone|a pc|can'?t|cannot|can not|without|unable|instead of|would|if (?:the|a|an)\b[^,]*\b(?:enemy|creature|target))\b/i;

const stripTags = (html) => String(html ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();

/**
 * Plain text from a description with Foundry's enrichers turned into words. Collects what the
 * enrichers say exactly (links, checks, damage, templates) on the side.
 * lookup: { name(uuid) -> string|null, localize(key) -> string }
 */
function readDescription(html, lookup = {}) {
    const links = [];
    const checks = [];
    const damage = [];
    const templates = [];
    let raw = String(html ?? "");
    // @Localize[...] pulls in shared glossary text (Grab, Constrict, Trample...)
    for (let i = 0; i < 3 && /@Localize\[/.test(raw); i++) {
        raw = raw.replace(/@Localize\[([^\]]+)\]/g, (m, key) => lookup.localize?.(key) ?? "");
    }
    raw = raw.replace(/@UUID\[([^\]]+)\](?:\{([^}]*)\})?/g, (m, uuid, label) => {
        const name = lookup.name?.(uuid) ?? uuid.split(".").pop();
        const pack = /Compendium\.[^.]+\.([^.]+)\./.exec(uuid)?.[1] ?? null;
        links.push({ uuid, pack, name, label: label ?? name });
        return label ?? name;
    });
    raw = raw.replace(/@Check\[([^\]]+)\](?:\{([^}]*)\})?/g, (m, body, label) => {
        const parts = body.split("|").map((p) => p.trim());
        const o = {};
        for (const p of parts) {
            const [k, ...v] = p.split(":");
            if (v.length) o[k.toLowerCase()] = v.join(":");
            else if (!o.type) o.type = k.toLowerCase();
            else o[k.toLowerCase()] = true;
        }
        checks.push(o);
        const stat = (o.type ?? "").replace(/-/g, " ");
        return label ?? `${o.dc ? `DC ${o.dc} ` : ""}${o.basic ? "basic " : ""}${stat}${["fortitude", "reflex", "will"].includes(o.type) ? " save" : " check"}`;
    });
    raw = raw.replace(/@Damage\[((?:[^\[\]]|\[[^\]]*\])*)\](?:\{([^}]*)\})?/g, (m, body, label) => {
        const parts = [];
        for (const piece of body.split(/,(?![^\[]*\])/)) {
            const f = /^\(?([^\[]+?)\)?\[([^\]]*)\]/.exec(piece.trim());
            if (f) parts.push({ formula: f[1].replace(/[()\s]/g, ""), type: f[2].split(",").filter((t) => !/^(persistent|splash|precision)$/.test(t)).pop() ?? null, persistent: /persistent/.test(f[2]) });
            else parts.push({ formula: piece.replace(/[()\s]/g, ""), type: null, persistent: false });
        }
        damage.push(...parts);
        return label ?? parts.map((p) => `${p.formula}${p.persistent ? " persistent" : ""}${p.type ? ` ${p.type}` : ""} damage`).join(" plus ");
    });
    raw = raw.replace(/@Template\[([^\]]+)\](?:\{([^}]*)\})?/g, (m, body, label) => {
        const o = {};
        for (const p of body.split("|")) {
            const [k, ...v] = p.split(":");
            if (v.length) o[k.trim().toLowerCase()] = v.join(":").trim().toLowerCase();
            else o.type = k.trim().toLowerCase();
        }
        const t = { shape: o.type ?? null, size: Number(o.distance ?? o.radius ?? o.length) || null };
        templates.push(t);
        return label ?? `${t.size}-foot ${t.shape}`;
    });
    raw = raw.replace(/\[\[\/[a-z]+ ([^\]#]+?)(?:\s*#[^\]]*)?\]\](?:\{([^}]*)\})?/gi, (m, formula, label) => label ?? formula);
    raw = raw.replace(/@\w+\[[^\]]*\](?:\{([^}]*)\})?/g, (m, label) => label ?? "");
    // Sections: Trigger, Requirements, Frequency, Effect, degrees of success
    const text = stripTags(raw.replace(/<\/(p|li|hr|div|h\d)>|<hr\s*\/?>|<br\s*\/?>/gi, "\n"));
    const sections = {};
    const SECTION = /\b(Trigger|Requirements?|Frequency|Effect|Critical Success|Success|Failure|Critical Failure|Activate|Cost)\b\s/g;
    const blocks = String(raw).split(/<hr\s*\/?>/i).map((b) => stripTags(b));
    for (const b of blocks) {
        const marks = [...b.matchAll(SECTION)].filter((m) => m.index === 0 || /[\s.;]$/.test(b.slice(0, m.index)));
        if (!marks.length) { sections.body = `${sections.body ?? ""} ${b}`.trim(); continue; }
        if (marks[0].index > 0) sections.body = `${sections.body ?? ""} ${b.slice(0, marks[0].index)}`.trim();
        marks.forEach((m, i) => {
            const key = m[1].toLowerCase().replace(/requirements?/, "requirements");
            const end = marks[i + 1]?.index ?? b.length;
            sections[key] = `${sections[key] ?? ""} ${b.slice(m.index + m[0].length, end)}`.trim();
        });
    }
    return { text, sections, links, checks, damage, templates };
}

/** Split text into sentences, keeping it simple. */
const sentencesOf = (t) => String(t ?? "").split(/(?<=[.;!?])\s+(?=[A-Z@(])|\n+/).map((s) => s.trim()).filter(Boolean);

function countWord(w) {
    if (!w) return 1;
    const k = w.toLowerCase().trim();
    return NUMBER_WORDS[k] ?? (Number(k) || 1);
}

/**
 * Movement the creature itself makes as part of an ability, from its Effect text.
 * Returns [{ verb, times, feet, speedMult, noReactions, teleport, speed }].
 */
function readMoves(effect, selfName) {
    const out = [];
    const self = selfName ? selfName.toLowerCase().split(/[\s,(]+/).filter((w) => w.length > 2) : [];
    const noReactionsAll = /\b(doesn'?t|does not|don'?t|do not|without) (?:provoke|trigger|triggering|provoking) reactions\b|\bdoesn'?t trigger reactions\b|\bno reactions are triggered\b/i.test(effect);
    const PRONOUN = /\b(it|they|he|she|you|itself|themselves|yourself|him|her|them)\b/i;
    for (const s of sentencesOf(effect)) {
        // PF2e capitalizes its actions (Step, Stride, Fly, Leap...); lowercase "steps" or "flies into a rage" isn't one
        const re = /\b(Steps?|Strides?|Fly|Flies|Burrows?|Climbs?|Swims?|Leaps?|[Jj]umps?|[Mm]oves?|[Tt]eleports?|Crawls?|[Cc]harges|[Dd]ashes)\b/g;
        const found = [];
        let m;
        while ((m = re.exec(s))) {
            const verb = MOVE_VERBS[m[1].toLowerCase()] ?? (/^jumps?$/i.test(m[1]) ? "leap" : null);
            if (!verb) continue;
            const before = s.slice(0, m.index);
            const after = s.slice(m.index + m[0].length, m.index + m[0].length + 80);
            const lowerBefore = before.toLowerCase();
            // Whose movement is it? Skip when someone else is the subject: the last "other" word
            // before the verb with no mention of the creature (or it/they) after it.
            const others = [...lowerBefore.matchAll(new RegExp(OTHER_SUBJECT.source, "gi"))];
            if (others.length) {
                const last = others[others.length - 1];
                const rest = lowerBefore.slice(last.index + last[0].length);
                const startsSelf = PRONOUN.test(s.split(/\s+/).slice(0, 1).join(" ")) || self.some((w) => s.toLowerCase().split(/\s+/).slice(0, 4).join(" ").includes(w));
                const selfAfter = self.some((w) => rest.includes(w)) || PRONOUN.test(rest.replace(/\bit\b(?= is grabbed| grabbed)/g, ""));
                const continues = /(,|\band\b|\bthen\b)\s*$/.test(lowerBefore.trimEnd() + " ") && startsSelf && !/\b(who|that|which|can|may)\b[^,]*$/.test(rest);
                if (!selfAfter && !continues) continue;
            }
            if (/\b(its|their|his|her|the|a|an|this|that|each|any)\s*$/i.test(before) && verb !== "teleport") continue; // "its move", "the Stride"
            if (/^\s*(speed|action|actions|ability|trait|reaction)\b/i.test(after)) continue;
            if (/\bend(s|ing)? (its|their|his|her) move\b/i.test(s.slice(Math.max(0, m.index - 20), m.index + 10))) continue;
            if (verb === "move" && !/^\s*(up to|\d+|its|their|half|twice|double|a number|straight)/i.test(after)) continue;
            if (verb === "leap" && /^jump/i.test(m[1]) && !/^\s*(up to|\d+)/i.test(after)) continue;
            let times = 1;
            const t1 = /^\s*(twice|two times|three times|thrice|once)\b/i.exec(after);
            const t2 = /^\s*up to (twice|two|three) times\b/i.exec(after);
            if (t1) times = countWord(t1[1]);
            else if (t2) times = countWord(t2[1]);
            let feet = null;
            let speedMult = null;
            const f1 = /^\s*(?:\w+\s+){0,3}?(?:up to )?(\d+) (?:feet|ft)/i.exec(after);
            const f2 = /^\s*(?:\w+\s+){0,3}?up to (twice|double|half|three times|its|their) (?:its |their )?(?:(fly|burrow|climb|swim|land) )?speed/i.exec(after);
            if (f2) speedMult = { twice: 2, double: 2, half: 0.5, "three times": 3, its: 1, their: 1 }[f2[1].toLowerCase()] ?? 1;
            else if (f1) feet = Number(f1[1]);
            const t3 = /^\s*(?:up to )?\d+ (?:feet|ft)\s+(twice|two times|three times)\b/i.exec(after);
            if (t3) times = countWord(t3[1]);
            if (verb === "step" && !feet) feet = 5;
            if (verb === "teleport" && !feet && !speedMult) {
                const ft = /(\d+) (?:feet|ft)/.exec(s.slice(m.index));
                if (ft) feet = Number(ft[1]);
            }
            const speed = SPEED_OF[verb] ?? (f2?.[2] && f2[2] !== "land" ? f2[2].toLowerCase() : "land");
            const sentenceNoReactions = /\b(doesn'?t|does not|without) (?:trigger|provoke|triggering|provoking) reactions\b/i.test(s);
            found.push({
                verb, times, feet, speedMult, speed,
                teleport: verb === "teleport",
                noReactions: verb === "step" || verb === "teleport" || sentenceNoReactions || noReactionsAll,
            });
        }
        // "Strides or Flies twice": the count belongs to every choice
        const shared = /\bor\b[^.]{0,25}\b(twice|three times)\b/i.exec(s);
        if (shared && found.length > 1) for (const f of found) f.times = Math.max(f.times, countWord(shared[1]));
        out.push(...found);
    }
    // "Strides twice" read as one Stride twice: drop exact duplicates in a row
    return out.filter((m, i) => i === 0 || JSON.stringify(m) !== JSON.stringify(out[i - 1]));
}

/** Strikes the creature makes as part of an ability. */
function readStrikes(effect) {
    let count = 0;
    let each = false;
    const notes = [];
    for (const s of sentencesOf(effect)) {
        if (/\b(target|enemy|ally|creature|attacker)\b[^.]{0,30}\bstrikes?\b/i.test(s) && !/\bmakes?\b/i.test(s)) continue;
        const m = /\b(?:makes?|make|making|striking|attempts?|can make|uses?|then)\b[^.]{0,40}?\b(a|an|one|two|three|four|\d+)?\s*(?:[\w-]+\s+){0,3}?strikes?\b/i.exec(s);
        if (m) {
            count = Math.max(count, countWord(m[1]) || 1);
            if (/\b(each|every)\b[^.]{0,30}(creature|enemy|foe|target)|\bagainst each\b|\bstrike against each\b|\bfor each\b/i.test(s)) each = true;
        }
        // The MAP rule can sit in its own sentence ("Both attacks count toward the MAP, but it doesn't increase until after")
        if (/\bmultiple attack penalty\b/i.test(s) && !notes.some((n) => n === "no MAP" || n === "MAP applies")) notes.push(/doesn'?t|does not|don'?t|not (?:increase|apply|count)|increases? only after|uses? (?:the|its|their|your) current multiple attack penalty/i.test(s) ? "no MAP" : "MAP applies");
        const two = /\b(two|three|four)\s+(?:[\w-]+\s+){0,3}strikes?\b/i.exec(s) ?? (/\bstriking once with each of (?:its|their) (\w+)/i.test(s) || /\bstrikes? with each of (?:its|their) (?:heads|arms|claws|jaws|tentacles|hands|weapons|mouths)\b/i.test(s) ? ["", "two"] : null);
        if (/\bcount as (?:a single|one) attack\b/i.test(s)) notes.push("one attack");
        if (two) count = Math.max(count, countWord(two[1]));
        const parts = [...s.matchAll(/\b(an?|one|two|three|four)\s+(?:[\w-]+\s+){0,2}?strikes?\b/gi)];
        if (parts.length > 1 && /\band\b/i.test(s)) count = Math.max(count, parts.reduce((t, x) => t + (countWord(x[1]) || 1), 0));
    }
    return count ? { count, each, notes } : null;
}

/** The area, from a template or the words. */
function readArea(desc, text) {
    const t = desc.templates.find((x) => x.shape && x.size);
    if (t) return { shape: t.shape, size: t.size };
    const m = /\b(\d+)[ -]foot[ -](cone|line|burst|emanation|radius|cube)\b/i.exec(text);
    if (m) return { shape: m[2].toLowerCase() === "radius" ? "burst" : m[2].toLowerCase(), size: Number(m[1]) };
    return null;
}

function readSave(desc, text) {
    const c = desc.checks.find((x) => ["fortitude", "reflex", "will"].includes(x.type));
    if (c) return { stat: c.type, dc: c.dc ? Number(c.dc) : null, basic: !!c.basic };
    const m = /\b(?:DC (\d+) )?(basic )?(fortitude|reflex|will) save(?:[^.]{0,20}DC (\d+))?/i.exec(text);
    if (!m) return null;
    return { stat: m[3].toLowerCase(), dc: Number(m[1] ?? m[4]) || null, basic: !!m[2] };
}

/** Skill checks the ability attempts against a target (Athletics vs Fortitude DC: Shove, Trip...). */
function readSkillCheck(desc) {
    const c = desc.checks.find((x) => x.defense && !["fortitude", "reflex", "will", "flat"].includes(x.type));
    return c ? { skill: c.type, against: c.defense } : null;
}

function readDamage(desc, text) {
    if (desc.damage.length) return desc.damage.filter((d) => /\d/.test(d.formula));
    const m = /\b(\d+d\d+(?:\s*[+-]\s*\d+)?)\s+(?:(persistent)\s+)?(acid|bleed|bludgeoning|cold|electricity|fire|force|mental|piercing|poison|slashing|sonic|spirit|void|vitality|negative|positive|good|evil|chaotic|lawful|precision)?\s*damage\b/i.exec(text);
    return m ? [{ formula: m[1].replace(/\s+/g, ""), type: m[3]?.toLowerCase() ?? null, persistent: !!m[2] }] : [];
}

/** Conditions the ability leaves on others, from condition links first and words second. */
function readInflicts(desc, effect, selfName) {
    const found = new Set();
    const selfWords = selfName ? selfName.toLowerCase().split(/[\s,(]+/).filter((w) => w.length > 2) : [];
    for (const s of sentencesOf(effect)) {
        const lower = s.toLowerCase();
        // Drawbacks on the creature itself: "the ogre is off-guard until", "it becomes fatigued"
        const selfSentence = /^(?:the [\w' -]+|it|they|he|she) (?:is|are|becomes?|gets?|falls?|remains?)\b/i.test(s)
            && (selfWords.some((w) => lower.split(/ (?:is|are|becomes?) /)[0].includes(w)) || /^(it|they|he|she)\b/i.test(s));
        if (selfSentence && !/\btarget|creature|enemy|foe\b/.test(lower.split(/ (?:is|are|becomes?) /)[0])) continue;
        for (const c of CONDITION_WORDS) {
            const word = c.replace("-", "[- ]");
            if (!new RegExp(`\\b${word}\\b`).test(lower)) continue;
            // "if the target is prone", "can't be frightened", "immune to", "while grabbed" are not effects
            const at = lower.search(new RegExp(`\\b${word}\\b`));
            const pre = lower.slice(Math.max(0, at - 40), at);
            const startsSelf = /^(?:it|they|he|she)\b/i.test(s) || selfWords.some((w) => lower.split(/\s+/).slice(0, 4).join(" ").includes(w));
            if (startsSelf && /(?:then |and |, )?(?:becomes?|becoming|is|are|remains?)\s*$/.test(pre) && !/\b(target|creature|enemy|foe|each|it hits|that)\b[^.]{0,25}$/.test(pre)) continue;
            if (/\b(if|while|when|unless|already|immune|can'?t be|cannot be|isn'?t|not|except|removes?|ends?|reduce|reduces|that is|who is|that are)\b[^.]{0,30}$/.test(pre)) continue;
            if (c === "persistent damage" || c === "hidden" || c === "concealed" || c === "invisible" || c === "undetected" || c === "quickened") {
                if (!/\b(target|creature|enemy|foe|each|those|any)\b/.test(lower)) continue;
            }
            found.add(c === "persistent damage" ? "persistent" : c);
        }
    }
    return [...found];
}

/** What the ability needs first, from its Requirements line (and "must" sentences). */
function readRequires(sections, text) {
    const req = `${sections.requirements ?? ""}`.toLowerCase();
    const r = { text: sections.requirements ?? null };
    if (/\b(has|have) (?:a |an |one or more |any )?(?:creature|creatures|target|foe|enemy|[\w-]+)?\s*(?:grabbed|restrained|grappled)\b|\bgrabbed by\b|\bis grabbing\b/.test(req)) r.grab = true;
    if (/\b(?:creature|target|foe|enemy)\b[^.]{0,20}\b(?:is|are) (?:grabbed|restrained)\b/.test(req)) r.grab = true;
    if (/\b(grabbed|restrained) by (?:it|them|him|her|the monster)\b|\bthat (?:it|they) (?:has|have) (?:grabbed|restrained)\b|\bcreatures? (?:it|they) (?:has|have) grabbed\b/i.test(text)) r.grab = true;
    if (/\b(target|creature|foe|enemy)\b[^.]{0,30}\bprone\b/.test(req)) r.targetProne = true;
    if (/\b(target|creature|foe|enemy)\b[^.]{0,30}\boff-guard\b/.test(req)) r.targetOffGuard = true;
    if (/\b(hidden|undetected|unnoticed|invisible)\b/.test(req)) r.hidden = true;
    if (/\b(last|previous) action\b/.test(req)) r.lastAction = true;
    // Written-out press and open: "is currently suffering a multiple attack penalty", "hasn't attempted a Strike this turn"
    if (/\b(?:already (?:attacked|made an? (?:attack|strike)|used an attack action)|suffering (?:a |from a |from (?:its|their|his|her) )?multiple attack penalty)\b/i.test(`${req} ${text}`)) r.priorAttack = true;
    if (/\bhas(?:n'?t| not) (?:yet )?(?:attempted|made|used) (?:a|an|any) (?:strike|attack)/.test(req)) r.firstAttack = true;
    if (/\bshield\b/.test(req)) r.shield = true;
    if (/\badjacent\b/.test(req)) r.adjacent = true;
    if (/\bflanking\b/.test(req)) r.flanking = true;
    if (/\bswallow|engulf|inside\b/.test(req)) r.engulfed = true;
    if (/\b(hit|damaged|critically hit) (?:a |the |the same )?(?:creature|target|foe|enemy)\b|\bstrike (?:hit|that hit)\b|\bprevious strike\b|\bsuccessful [\w-]+ strike\b|\blast action was a (?:successful )?[\w-]* ?strike\b/.test(req)) r.afterHit = true;
    return r;
}

/** What sets off a reaction or free action. */
function readTrigger(sections) {
    const t = (sections.trigger ?? "").toLowerCase();
    if (!t) return null;
    return {
        text: sections.trigger,
        onMove: /\b(moves?|move action|leaves? a square|strides?|steps?|flies|climbs|burrows|swims)\b/.test(t) && /\b(within (?:its|their|his|her) reach|adjacent|reach|leaves|square|within)\b/.test(t),
        onManipulate: /\bmanipulate\b/.test(t),
        onRanged: /\branged attack\b/.test(t),
        onSpell: /\b(casts? a spell|spell)\b/.test(t),
        onHit: /\b(hits?|damages?|deals? damage|critically hits?)\b[^.]{0,30}\b(it|them|him|her|the [\w-]+|an ally)\b/.test(t) || /\btakes? damage\b/.test(t),
        onMissed: /\b(fails|misses|critically fails)\b/.test(t),
        onAlly: /\ball(y|ies)\b/.test(t),
        onEnemyTurn: /\b(begins?|ends?|starts?) (?:its|their) turn\b/.test(t),
        onDeath: /\b(dies|reduced to 0|destroyed)\b/.test(t),
    };
}

function readCost(item, text) {
    if (item.kind !== "action") return null;
    const v = Number(item.cost);
    if (v) return v;
    const m = /\b(\d) to (\d) actions\b/i.exec(text);
    return m ? Number(m[1]) : 1;
}

function readRecharge(text) {
    const m = /can['’]?t use [^.]*?\bagain for\b\s*(\d+d\d+(?:\s*[+-]\s*\d+)?|\d+)\s*rounds?\b/i.exec(text);
    return m ? m[1].replace(/\s+/g, "") : null;
}

/** Movement rules that are always on: "movement doesn't trigger reactions", ignores difficult terrain. */
function readMovementPassive(text, name) {
    const t = text.toLowerCase();
    const p = {};
    if (/\b(movement|moves?|strides?|steps?)\b[^.]{0,40}\b(doesn'?t|does not|don'?t|do not|never) (?:trigger|provoke) reactions\b/.test(t)) {
        // NPC Core's Mobility: "moves half its Speed or less, that movement does not trigger reactions"
        if (/\bhalf (?:its|their|his|her) speed\b/.test(t)) p.noReactionsHalf = true;
        else p.noReactions = true;
    }
    if (/\bignores? (?:the effects of )?(?:non-?magical )?(?:greater )?difficult terrain\b|\bdifficult terrain\b[^.]{0,40}\bdoesn'?t (?:affect|hamper|impede)/.test(t)
        || /^(woodland|swamp|ice|jungle|snow|desert|mountain|forest|water|trackless|shadow|sand|swift) (stride|step|steps)$/i.test(name)) p.ignoresDifficult = true;
    if (/\bquickened\b/.test(t) && /\bonly to (?:step|stride)/.test(t)) p.extraMove = true;
    return Object.keys(p).length ? p : null;
}

/**
 * The whole profile of an ability.
 * item: { id, name, kind: "action"|"reaction"|"free"|"passive", cost, category, traits[], html, rules[] }
 */
function profileAbility(item, { selfName = "", lookup = {} } = {}) {
    const desc = readDescription(item.html, lookup);
    const text = desc.text;
    const effect = [desc.sections.effect, desc.sections.body, desc.sections.activate].filter(Boolean).join(" ") || text;
    const degreeText = ["critical success", "success", "failure", "critical failure"].map((k) => desc.sections[k] ?? "").join(" ");
    const traits = new Set(item.traits ?? []);
    const linkNames = new Set(desc.links.filter((l) => l.pack === "actionspf2e").map((l) => String(l.name).toLowerCase()));
    const p = {
        id: item.id ?? null,
        name: item.name,
        kind: item.kind,
        cost: readCost(item, text),
        traits: [...traits],
        category: item.category ?? null,
        text, sections: desc.sections,
        moves: item.kind === "passive" ? [] : readMoves(effect, selfName),
        strikes: readStrikes(effect),
        area: readArea(desc, `${effect} ${degreeText}`),
        save: readSave(desc, `${effect} ${degreeText}`),
        skillCheck: readSkillCheck(desc),
        damage: readDamage(desc, `${effect} ${degreeText}`),
        inflicts: readInflicts(desc, `${effect} ${degreeText}`, selfName),
        requires: readRequires(desc.sections, text),
        trigger: readTrigger(desc.sections) ?? (item.kind === "reaction" || item.kind === "free" ? readTrigger({ trigger: desc.sections.body ?? text }) : null),
        recharge: readRecharge(text),
        frequency: desc.sections.frequency ?? null,
        movementPassive: item.kind === "passive" ? readMovementPassive(text, item.name) : null,
        attackRoll: /\b(spell attack|attack roll|makes? an? (?:\w+ )?attack)\b/i.test(effect) && !/\bstrike\b/i.test(effect),
        links: [...linkNames],
    };
    const t = text.toLowerCase();
    const eff = effect.toLowerCase();
    p.buff = !/\b(doesn'?t|does not) (?:change|affect)\b[^.]{0,60}\bbonus/.test(eff) && /\btemporary hit points\b|\b(?:status|circumstance|item) bonus (?:to|on)\b|\bquickened\b|\bgains? resistance\b|\bbonus to (?:its|their|attack|ac|damage)/.test(eff) && !/\bpenalty\b[^.]{0,20}\bbonus\b/.test(eff);
    p.allies = /\ball(?:y|ies)\b/.test(eff) && (p.buff || /\bregains?\b/.test(eff));
    p.heals = /\bregains?\b[^.]{0,60}\bhit points\b|\bfast healing\b|\bhealing\b[^.]{0,20}\b(?:spell|effect)/.test(eff) || traits.has("healing");
    p.defense = linkNames.has("raise a shield") || linkNames.has("take cover") || linkNames.has("hide") || linkNames.has("sneak")
        || /\b(becomes?|turns?) (?:invisible|concealed)\b|\bAC\b[^.]{0,30}\bbonus\b|\bbonus to (?:its |their )?ac\b|\braises? (?:its|their|a) shield\b/i.test(effect);
    p.control = ["shove", "trip", "grapple", "reposition", "disarm", "demoralize", "feint", "create a diversion", "escape"]
        .filter((a) => linkNames.has(a) || new RegExp(`\\b${a}s?\\b`, "i").test(effect));
    if (/\bpush(?:es)?\b[^.]{0,30}\b\d+ feet\b|\bpull(?:s)?\b[^.]{0,30}\b\d+ feet\b/i.test(effect)) p.control.push("push or pull");
    p.summon = /\bsummons?\b|\bcalls? forth\b|\bconjures?\b/i.test(effect);
    p.aura = traits.has("aura") || (item.kind === "passive" && !!p.area && p.area.shape === "emanation");
    p.swallow = /\bswallow whole\b|\bengulf/i.test(t);
    p.setup = p.inflicts.some((c) => SETUP_CONDITIONS.has(c)) && !p.requires.grab;
    // When in a turn it can go. NPC abilities are written per stat block: they can share a name with a
    // Player Core feat and still differ (the ruffian's Combat Grab has no press), so only this ability's own
    // traits and wording count.
    p.afterAttack = traits.has("press") || !!p.requires.priorAttack;
    p.opensTurn = traits.has("open") || !!p.requires.firstAttack;
    p.payoff = !!(p.requires.grab || p.requires.targetProne || p.requires.targetOffGuard || p.requires.hidden || p.requires.afterHit);
    p.blast = !!((p.area || (p.save && p.damage.length && !p.strikes)) && !p.requires.grab);
    // "As Attack of Opportunity" and the like: the standard trigger
    if (p.trigger && (linkNames.has("reactive strike") || linkNames.has("attack of opportunity") || /^(reactive strike|attack of opportunity)$/i.test(item.name)
        || desc.links.some((l) => /^(Attack of Opportunity|Reactive Strike)$/i.test(l.name)))) Object.assign(p.trigger, { onMove: true, onManipulate: true, onRanged: true });
    p.role = roleOf(p);
    return p;
}

function roleOf(p) {
    if (p.kind === "reaction") return "reaction";
    if (p.kind === "passive") return p.aura ? "aura" : p.movementPassive ? "movement-rule" : "passive";
    const moving = p.moves.some((m) => m.verb !== "teleport" || m.feet || m.speedMult);
    if (p.strikes && moving) return "move-strike";
    if (p.strikes && (p.strikes.count > 1 || p.strikes.each)) return "multi-strike";
    if (p.blast) return "area";
    if (p.payoff) return "payoff";
    if (p.setup && !p.strikes) return "setup";
    if (p.strikes) return "strike-variant";
    if (moving) return "movement";
    if (p.heals) return "heal";
    if (p.control.length && !p.allies) return "control";
    if (p.buff) return "buff";
    if (p.defense) return "defense";
    if (p.summon) return "summon";
    if (p.attackRoll || p.save || p.damage.length) return "attack";
    return "other";
}

// ---------------------------------------------------------------------------------------------
// The creature's movement options, per action
// ---------------------------------------------------------------------------------------------
/**
 * Best ways to move for one action. speeds: { land, fly, burrow, climb, swim } in feet.
 * Returns { step: {feet, by, noReactions}, stride: {feet, by, noReactions, speed}, notes[] }.
 * "by" is the ability name, or null for the basic action.
 */
function movementOptions(profiles, speeds) {
    const land = Number(speeds.land) || 0;
    const fly = Number(speeds.fly) || 0;
    const passives = profiles.filter((p) => p.movementPassive);
    const allNoReactions = passives.some((p) => p.movementPassive.noReactions);
    const halfNoReactions = !allNoReactions && passives.some((p) => p.movementPassive.noReactionsHalf);
    const step = { feet: land >= 10 ? 5 : 0, by: null, noReactions: true, cost: 1 }; // Step needs a land Speed of 10 feet or more
    let stride = { feet: Math.max(land, fly), by: null, noReactions: allNoReactions, cost: 1, speed: fly > land ? "fly" : "land" };
    // Mobility: a move of half its Speed or less doesn't trigger reactions
    if (halfNoReactions) stride.noReactionsUpTo = Math.floor(stride.feet / 2 / 5) * 5;
    if (!stride.feet) {
        // No land or fly Speed: a swimmer, climber or burrower moves that way (an aquatic creature in its water)
        const alt = ["swim", "climb", "burrow"].map((k) => ({ k, v: Number(speeds[k]) || 0 })).sort((a, b) => b.v - a.v)[0];
        stride = alt.v ? { feet: alt.v, by: { swim: "Swim", climb: "Climb", burrow: "Burrow" }[alt.k], noReactions: allNoReactions, cost: 1, speed: alt.k } : { feet: 0, by: null, noReactions: false, cost: 1, speed: "land" };
    }
    const extra = [];
    for (const p of profiles) {
        if (p.kind !== "action" || !p.moves.length || p.strikes) continue;
        // Abilities with limits we can't check (only in darkness, within dragonmist...) still count, with their name shown
        for (const m of p.moves) {
            const per = (m.feet ?? (m.speedMult ? m.speedMult * (Number(speeds[m.speed]) || land) : (Number(speeds[m.speed]) || land))) * (m.verb === "step" && !m.feet ? 1 : 1);
            const total = m.verb === "step" ? (m.feet ?? 5) * m.times : per * (m.speedMult ? 1 : m.times);
            if (!total) continue;
            const option = { feet: total, by: p.name, noReactions: m.noReactions || allNoReactions, cost: p.cost ?? 1, teleport: m.teleport, limits: p.requires.text ?? null, recharge: p.recharge, frequency: p.frequency };
            extra.push(option);
            if (option.cost === 1 && option.noReactions && option.feet > step.feet && !option.limits && !p.recharge && !p.frequency) Object.assign(step, option);
            if (option.cost === 1 && option.feet > stride.feet && !option.limits && !p.recharge && !p.frequency) stride = { ...option, speed: m.speed };
        }
    }
    return {
        step, stride, extra,
        ignoresDifficult: passives.some((p) => p.movementPassive.ignoresDifficult),
        extraMove: passives.some((p) => p.movementPassive.extraMove),
        noReactions: allNoReactions,
        noReactionsUpTo: stride.noReactionsUpTo ?? null,
        speeds: { land, fly: fly || null, burrow: Number(speeds.burrow) || null, climb: Number(speeds.climb) || null, swim: Number(speeds.swim) || null },
    };
}
// ---------------------------------------------------------------------------------------------
// Dice math. Pure functions.
// ---------------------------------------------------------------------------------------------

/** Average of a formula such as "2d6+4", "1d4 + 4", "3d8", "5". Unknown parts count as 0. */
function averageOf(formula) {
    const f = String(formula ?? "").replace(/\s+/g, "").replace(/\[[^\]]*\]/g, "");
    if (!f) return 0;
    let total = 0;
    for (const m of f.matchAll(/([+-]?)(\d*)d(\d+)|([+-]?)(\d+)(?!d|\d)/g)) {
        if (m[3]) total += (m[1] === "-" ? -1 : 1) * (Number(m[2]) || 1) * (Number(m[3]) + 1) / 2;
        else if (m[5]) total += (m[4] === "-" ? -1 : 1) * Number(m[5]);
    }
    return Math.max(0, total);
}

/**
 * Chances of each degree of success for a d20 check: { cs, s, f, cf }.
 * Beat the DC by 10 for a critical success, miss it by 10 for a critical failure; a natural 20
 * moves the result one step up and a natural 1 one step down.
 */
function degreeChances(mod, dc, shift = 0) {
    // shift: degrees moved after the natural 20/1 step (incapacitation: +1 for a higher-level target)
    const out = { cs: 0, s: 0, f: 0, cf: 0 };
    const order = ["cf", "f", "s", "cs"];
    for (let r = 1; r <= 20; r++) {
        const total = r + mod;
        let d = total >= dc + 10 ? 3 : total >= dc ? 2 : total <= dc - 10 ? 0 : 1;
        if (r === 20) d = Math.min(3, d + 1);
        if (r === 1) d = Math.max(0, d - 1);
        d = Math.max(0, Math.min(3, d + shift));
        out[order[d]] += 0.05;
    }
    return out;
}

/** Chance a flat check of this DC succeeds (DC 5 concealed, DC 11 hidden). */
const flatCheck = (dc) => Math.max(0, Math.min(1, (21 - dc) / 20));

/**
 * Expected damage of one Strike: hit for the average, a critical hit for double plus deadly dice.
 * delta: the target's weakness minus resistance to this damage (once per hit); immune: no damage.
 */
function strikeExpected(bonus, ac, avg, { deadly = 0, delta = 0, immune = false, shift = 0 } = {}) {
    const c = degreeChances(bonus, ac, shift);
    if (immune) return { hit: c.s + c.cs, crit: c.cs, expected: 0 };
    return { hit: c.s + c.cs, crit: c.cs, expected: c.s * Math.max(0, avg + delta) + c.cs * Math.max(0, avg * 2 + deadly + delta) };
}

/** Expected damage against a save. Basic saves: 2x, 1x, half, none. Others: as given. */
function saveExpected(saveMod, dc, avg, { basic = true, shift = 0, delta = 0, immune = false } = {}) {
    const c = degreeChances(saveMod, dc, shift); // the target rolls: cs, s, f, cf are the target's results
    const hurt = (x) => (immune || x <= 0 ? 0 : Math.max(0, x + delta));
    const exp = basic ? c.cf * hurt(avg * 2) + c.f * hurt(avg) + c.s * hurt(avg / 2) : (c.f + c.cf) * hurt(avg);
    return { fail: c.f + c.cf, critFail: c.cf, expected: exp, chances: c };
}

/**
 * Weakness and resistance against damage of these types, as one adjustment per hit.
 * iwr: { weak: [{type, value}], resist: [{type, value, exceptions}], immune: [type] }
 */
const PHYSICAL = new Set(["bludgeoning", "piercing", "slashing", "bleed"]);
const ENERGY = new Set(["acid", "cold", "electricity", "fire", "sonic", "vitality", "void", "force", "spirit"]);
function damageAgainst(iwr, types = []) {
    if (!iwr || !types.length) return { delta: 0, immune: false };
    const fits = (t, k) => k === t || k === "all-damage" || (k === "physical" && PHYSICAL.has(t)) || (k === "energy" && ENERGY.has(t))
        || (k === "non-magical" && PHYSICAL.has(t));
    const immune = types.every((t) => (iwr.immune ?? []).some((k) => fits(t, k)));
    let delta = 0;
    for (const t of new Set(types)) {
        const w = Math.max(0, ...(iwr.weak ?? []).filter((x) => fits(t, x.type)).map((x) => Number(x.value) || 0));
        const r = Math.max(0, ...(iwr.resist ?? []).filter((x) => fits(t, x.type) && !(x.exceptions ?? []).some((e) => types.includes(e))).map((x) => Number(x.value) || 0));
        delta += w - r;
    }
    return { delta, immune };
}

/**
 * Extra damage a critical hit adds beyond double damage, from deadly and fatal.
 * deadly-dX: one extra die (two with 3 weapon dice, three with 4: the striking runes).
 * fatal-dX: the weapon's dice become dX before doubling, plus one more dX.
 * formula: the Strike's damage, "1d8+5", for the dice it rolls.
 */
function critExtra(traits = [], formula = "") {
    const m = /(\d+)d(\d+)/.exec(String(formula ?? ""));
    const n = m ? Number(m[1]) : 1, die = m ? Number(m[2]) : 6;
    let extra = 0;
    for (const t of traits) {
        const d = /^deadly-(?:\d+)?d(\d+)$/.exec(t);
        if (d) extra += (n >= 4 ? 3 : n >= 3 ? 2 : 1) * (Number(d[1]) + 1) / 2;
        const f = /^fatal-(?:\d+)?d(\d+)$/.exec(t);
        if (f) { const fa = (Number(f[1]) + 1) / 2; extra += 2 * n * (fa - (die + 1) / 2) + fa; }
    }
    return extra;
}

/** Multiple attack penalty for the nth attack this turn (0-based), agile or not. */
function mapFor(n, agile) {
    if (n <= 0) return 0;
    return (agile ? -4 : -5) * Math.min(n, 2);
}

const round1 = (n) => Math.round(n * 10) / 10;
const pct = (p) => `${Math.round(p * 100)}%`;
// ---------------------------------------------------------------------------------------------
// Grid geometry on a square grid, in squares. Pure functions; the board reader supplies the
// scene through callbacks. A rect is { x, y, w, h } in grid squares (x..x+w-1).
// ---------------------------------------------------------------------------------------------

/** A creature's height in feet: 5 a square of its size (a Large creature is 10 feet tall). */
const heightOf = (r) => r.ht ?? 5 * Math.max(1, r.w ?? 1);

/** Feet of open air between a height z and a creature (0 when z is within its height). */
const verticalGap = (z, r) => Math.max(0, (r.z ?? 0) - z, z - ((r.z ?? 0) + heightOf(r) - 5));

/** Squares between two rects along each axis, counting the target's space but not the origin's. dz is the height
 *  gap, in squares, the way PF2e measures it: a Medium creature 10 feet above another is two squares up. */
function gapSquares(a, b) {
    const dx = Math.max(0, b.x - (a.x + a.w - 1), a.x - (b.x + b.w - 1));
    const dy = Math.max(0, b.y - (a.y + a.h - 1), a.y - (b.y + b.h - 1));
    const az = a.z ?? 0, bz = b.z ?? 0;
    const dzFeet = Math.max(0, bz - (az + heightOf(a) - 5), az - (bz + heightOf(b) - 5));
    return { dx, dy, dz: Math.ceil(dzFeet / 5 - 1e-9) };
}

/** Distance in feet between two creatures, PF2e style (every second diagonal counts 10 feet), height included. */
function feetBetween(a, b) {
    const { dx, dy, dz } = gapSquares(a, b);
    const h = Math.max(dx, dy) + Math.floor(Math.min(dx, dy) / 2);
    return 5 * (Math.max(h, dz) + Math.floor(Math.min(h, dz) / 2));
}

/** Can a creature at rect a reach rect b with this reach? 10-foot reach reaches two squares diagonally. Not
 *  through a floor: creatures on different levels of a building can't reach each other. */
function inReach(a, b, reach) {
    if (a.lvl && b.lvl && a.lvl !== b.lvl) return false;
    const { dx, dy, dz } = gapSquares(a, b);
    if (reach === 10 && dx <= 2 && dy <= 2 && dz === 0) return true;
    return feetBetween(a, b) <= reach;
}

const centerOf = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** Two segments cross at a single point inside both (no touching at an end, no running along each other). */
function segmentsCrossProperly(p1, p2, p3, p4) {
    const d = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
    const e = 1e-9;
    return ((d1 > e && d2 < -e) || (d1 < -e && d2 > e)) && ((d3 > e && d4 < -e) || (d3 < -e && d4 > e));
}

function segmentsCross(p1, p2, p3, p4) {
    const d = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const on = (a, b, c) => Math.min(a.x, b.x) - 1e-9 <= c.x && c.x <= Math.max(a.x, b.x) + 1e-9 && Math.min(a.y, b.y) - 1e-9 <= c.y && c.y <= Math.max(a.y, b.y) + 1e-9;
    const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
    return (Math.abs(d1) < 1e-9 && on(p3, p4, p1)) || (Math.abs(d2) < 1e-9 && on(p3, p4, p2))
        || (Math.abs(d3) < 1e-9 && on(p1, p2, p3)) || (Math.abs(d4) < 1e-9 && on(p1, p2, p4));
}

/**
 * Flanking: the line between the two attackers' centers passes through opposite sides (or
 * opposite corners) of the target's space. Both must be able to reach the target.
 */
function flanks(att, ally, target) {
    const a = centerOf(att), b = centerOf(ally);
    const L = target.x, R = target.x + target.w, T = target.y, B = target.y + target.h;
    const left = segmentsCross(a, b, { x: L, y: T }, { x: L, y: B });
    const right = segmentsCross(a, b, { x: R, y: T }, { x: R, y: B });
    const top = segmentsCross(a, b, { x: L, y: T }, { x: R, y: T });
    const bottom = segmentsCross(a, b, { x: L, y: B }, { x: R, y: B });
    return (left && right) || (top && bottom);
}

/**
 * Cheapest movement to every square within maxFeet, PF2e diagonals (5, 10, 5, 10...).
 * opts:
 *   start      rect of the mover
 *   maxFeet    how far to look
 *   canEnter(x, y)         footprint at x,y can be passed through (no walls inside, no enemies)
 *   canEnd(x, y)           footprint at x,y is a legal place to stop (no other creature)
 *   blocked(x1, y1, x2, y2) a wall between the two footprint positions
 *   costAt(x, y)           terrain for entering: 1 normal, 2 difficult (+5 ft), 3 greater difficult (+10 ft)
 *   threats(x, y)          ids of enemies whose movement reactions cover the footprint at x,y
 *   noReactions            this movement doesn't trigger reactions
 *   avoid                  "safe": fewest reactions provoked first, then feet; "fast": feet only
 * Returns Map "x,y" -> { x, y, feet, provokes: [ids], end: bool, prev: "x,y"|null }.
 */
function movementField(opts) {
    const { start, maxFeet, canEnter, canEnd, blocked, costAt = () => 1, edgeFeet = () => 0, threats = () => [], noReactions = false, noReactionsUpTo = null, avoid = "safe", flatDiagonals = false } = opts;
    const key = (x, y, p) => `${x},${y},${p}`;
    const best = new Map();
    const startKey = key(start.x, start.y, 0);
    const heap = [[0, 0, start.x, start.y, 0, []]]; // [score, feet, x, y, parity, provokes]
    const seen = new Map([[startKey, 0]]);
    const out = new Map();
    const push = (item) => {
        heap.push(item);
        let i = heap.length - 1;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (heap[p][0] <= heap[i][0]) break;
            [heap[p], heap[i]] = [heap[i], heap[p]];
            i = p;
        }
    };
    const pop = () => {
        const top = heap[0];
        const last = heap.pop();
        if (heap.length) {
            heap[0] = last;
            let i = 0;
            for (;;) {
                const l = 2 * i + 1, r = l + 1;
                let m = i;
                if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
                if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
                if (m === i) break;
                [heap[m], heap[i]] = [heap[i], heap[m]];
                i = m;
            }
        }
        return top;
    };
    const prevOf = new Map();
    const edgeCache = new Map();
    const isBlocked = (x1, y1, x2, y2) => {
        const k = `${x1},${y1}>${x2},${y2}`;
        if (!edgeCache.has(k)) edgeCache.set(k, !!blocked(x1, y1, x2, y2));
        return edgeCache.get(k);
    };
    while (heap.length) {
        const [score, feet, x, y, parity, provokes] = pop();
        const k = key(x, y, parity);
        if ((seen.get(k) ?? Infinity) < score) continue;
        const cell = `${x},${y}`;
        const have = out.get(cell);
        if (!have || (avoid === "safe" ? (provokes.length < have.provokes.length || (provokes.length === have.provokes.length && feet < have.feet)) : feet < have.feet)) {
            out.set(cell, { x, y, feet, provokes, end: canEnd(x, y), prev: prevOf.get(k) ?? null });
        }
        const leaving = noReactions ? [] : threats(x, y);
        for (let ddx = -1; ddx <= 1; ddx++) {
            for (let ddy = -1; ddy <= 1; ddy++) {
                if (!ddx && !ddy) continue;
                const nx = x + ddx, ny = y + ddy;
                const diag = ddx && ddy;
                // Difficult terrain adds 5 feet to the square (greater difficult 10), on top of the diagonal's cost
                const step = (diag && !flatDiagonals ? (parity ? 10 : 5) : 5) + 5 * (Math.max(1, costAt(nx, ny)) - 1) + edgeFeet(x, y, nx, ny, feet);
                const nf = feet + step;
                if (nf > maxFeet) continue;
                if (!canEnter(nx, ny) || isBlocked(x, y, nx, ny)) continue;
                const np = diag ? 1 - parity : parity;
                // Mobility: the first half-Speed of movement provokes nothing (one Stride's worth; longer moves do)
                const free = noReactionsUpTo != null && nf <= noReactionsUpTo;
                const nprov = leaving.length && !free ? [...new Set([...provokes, ...leaving])] : provokes;
                const nscore = avoid === "safe" ? nprov.length * 10000 + nf : nf;
                const nk = key(nx, ny, np);
                if ((seen.get(nk) ?? Infinity) <= nscore) continue;
                seen.set(nk, nscore);
                prevOf.set(nk, cell);
                push([nscore, nf, nx, ny, np, nprov]);
            }
        }
    }
    best.clear();
    return out;
}

/** Is square (x, y) in a cone, line, burst or emanation? Returns the test and the box it can be true in. Origin and aim in squares. */
function areaTest(shape, size, { origin, aim, self }) {
    const n = Math.round(size / 5);
    if (shape === "burst" || shape === "emanation" || shape === "cube") {
        // Burst: from a grid corner; emanation: from the creature's space. Count squares whose
        // nearest point is within size feet, PF2e diagonals.
        const src = shape === "emanation" ? self : { x: origin.x, y: origin.y, w: 0, h: 0 };
        const sw = src.w || 0, sh = src.h || 0, extra = shape === "burst" ? 5 : 0;
        const box = { x0: src.x - n - 1, x1: src.x + sw + n, y0: src.y - n - 1, y1: src.y + sh + n };
        const test = (x, y) => {
            if (x < box.x0 || x > box.x1 || y < box.y0 || y > box.y1) return false;
            if (shape === "emanation" && x >= self.x && x < self.x + self.w && y >= self.y && y < self.y + self.h) return false;
            const cx = x + 0.5, cy = y + 0.5;
            const ex = Math.max(src.x - cx, 0, cx - (src.x + sw));
            const ey = Math.max(src.y - cy, 0, cy - (src.y + sh));
            const sx = Math.ceil(ex - 0.5 + 1e-9), sy = Math.ceil(ey - 0.5 + 1e-9);
            const feet = 5 * (Math.max(sx, sy) + Math.floor(Math.min(sx, sy) / 2)) + extra;
            return feet <= size + extra && feet > 0;
        };
        return { test, box };
    }
    // Cone and line: from the edge of the creature's space, toward the aim point
    const c = centerOf(self);
    const dir = Math.atan2(aim.y - c.y, aim.x - c.x);
    const ux = Math.cos(dir), uy = Math.sin(dir);
    // Edge point: where the ray from the center leaves the creature's space
    const half = Math.min(self.w / 2 / Math.max(Math.abs(ux), 1e-9), self.h / 2 / Math.max(Math.abs(uy), 1e-9));
    const o = { x: c.x + ux * half, y: c.y + uy * half };
    const box = { x0: self.x - n - 1, x1: self.x + self.w + n, y0: self.y - n - 1, y1: self.y + self.h + n };
    const test = (x, y) => {
        if (x < box.x0 || x > box.x1 || y < box.y0 || y > box.y1) return false;
        if (x >= self.x && x < self.x + self.w && y >= self.y && y < self.y + self.h) return false;
        const cx = x + 0.5 - o.x, cy = y + 0.5 - o.y;
        const along = cx * ux + cy * uy;
        const across = -cx * uy + cy * ux;
        if (along <= 0) return false;
        // Reach is counted like movement (every second diagonal 10 feet), not as a straight-line distance
        if (feetBetween(self, { x, y, w: 1, h: 1 }) > n * 5) return false;
        return shape === "line" ? Math.abs(across) <= 0.5 + 1e-9 : Math.abs(across) <= along + 1e-9;
    };
    return { test, box };
}

/** The squares of a cone, line, burst or emanation, as a Set of "x,y". Origin and aim in squares. */
function areaSquares(shape, size, opts) {
    const { test, box } = areaTest(shape, size, opts);
    const out = new Set();
    for (let x = box.x0; x <= box.x1; x++) for (let y = box.y0; y <= box.y1; y++) if (test(x, y)) out.add(`${x},${y}`);
    return out;
}

/** Is any square of rect r in the area? */
const rectInArea = (test, r) => {
    for (let x = r.x; x < r.x + r.w; x++) for (let y = r.y; y < r.y + r.h; y++) if (test(x, y)) return true;
    return false;
};

const rectSquares = (r) => {
    const s = [];
    for (let x = r.x; x < r.x + r.w; x++) for (let y = r.y; y < r.y + r.h; y++) s.push(`${x},${y}`);
    return s;
};

// --- Cover and lines of effect ---------------------------------------------------------------------
/** Does the segment p1-p2 pass through the inside of rect r (not just touch its edge)? */
function segmentHitsRect(p1, p2, r) {
    const e = 0.05; // shrink a little so a line along a shared edge doesn't count
    const R = { x: r.x + e, y: r.y + e, w: r.w - 2 * e, h: r.h - 2 * e };
    const inside = (p) => p.x > R.x && p.x < R.x + R.w && p.y > R.y && p.y < R.y + R.h;
    if (inside(p1) || inside(p2)) return true;
    const c = [{ x: R.x, y: R.y }, { x: R.x + R.w, y: R.y }, { x: R.x + R.w, y: R.y + R.h }, { x: R.x, y: R.y + R.h }];
    for (let i = 0; i < 4; i++) if (segmentsCross(p1, p2, c[i], c[(i + 1) % 4])) return true;
    return false;
}

const SIZE_RANK = { tiny: 0, sm: 1, small: 1, med: 2, medium: 2, lg: 3, large: 3, huge: 4, grg: 5, gargantuan: 5 };

/**
 * Cover the target has against an attack from `from`: 0 none, 1 lesser, 2 standard, 4 greater, -1 no line of effect.
 * board.lineBlocked(p1, p2) answers for walls (grid units); creatures in the way give lesser cover
 * (standard when 2+ sizes bigger than both), but not against areas.
 * Rules: center-to-center line; a wall on it gives standard cover if some corner-to-corner line is clear.
 */
function coverBetween(board, from, target, { area = false, ranged = true, fromSize = 2 } = {}) {
    const rect = target.rect ?? target;
    const a = centerOf(from), b = centerOf(rect);
    let cover = 0;
    if (board.lineBlocked && board.lineBlocked(a, b)) {
        const corners = (r) => [{ x: r.x + 0.01, y: r.y + 0.01 }, { x: r.x + r.w - 0.01, y: r.y + 0.01 }, { x: r.x + 0.01, y: r.y + r.h - 0.01 }, { x: r.x + r.w - 0.01, y: r.y + r.h - 0.01 }];
        let clear = false;
        for (const p of corners(from)) { for (const q of corners(rect)) if (!board.lineBlocked(p, q)) { clear = true; break; } if (clear) break; }
        if (!clear) return -1;
        cover = 2;
    }
    if (!area && cover < 2) {
        const tSize = target.sizeRank ?? 2;
        for (const c of [...(board.enemies ?? []), ...(board.allies ?? [])]) {
            if (c === target || c.rect === rect || (c.rect.x === from.x && c.rect.y === from.y)) continue;
            if (!segmentHitsRect(a, b, c.rect)) continue;
            cover = Math.max(cover, (c.sizeRank ?? 2) >= Math.max(tSize, fromSize) + 2 ? 2 : 1);
            if (cover >= 2) break;
        }
    }
    // Take Cover: standard becomes greater, none becomes standard; prone and taking cover is greater against ranged
    if (target.takingCover) cover = target.conditions?.has?.("prone") && ranged ? 4 : cover >= 2 ? 4 : Math.max(cover, 2);
    if (area && cover === 1) cover = 0;
    return cover;
}

// --- Seeing: light, senses, conditions -------------------------------------------------------------
/**
 * How a viewer perceives a creature: "observed", "concealed", "hidden" or "undetected" (PF2e detection).
 * viewer: { senses: { darkvision, greaterDarkvision, lowLight, seeInvisible, precise: [{type, range}], imprecise: [{type, range}] }, conditions }
 * light: "bright" | "dim" | "dark" | "magical" (darkness from a spell; plain darkvision doesn't see through rank 4+ darkness, so treat as dark to darkvision only when greater is missing)
 */
function visibilityOf(viewer, target, light = "bright", feet = 0) {
    const vs = viewer?.senses ?? {};
    const vc = viewer?.conditions ?? new Set();
    const tc = target?.conditions ?? new Set();
    const order = ["observed", "concealed", "hidden", "undetected"];
    let state = 0;
    const raise = (s) => { state = Math.max(state, order.indexOf(s)); };
    // A precise sense other than sight (tremorsense, echolocation...) in range sees through all of it
    const preciseOther = (vs.precise ?? []).some((s) => !/vision|sight|darkvision/.test(s.type) && (!s.range || feet <= s.range));
    if (!preciseOther) {
        if (vc.has("blinded")) raise("hidden");
        else {
            // Invisible: undetected, narrowed to hidden by hearing below
            if (tc.has("invisible") && !vs.seeInvisible) raise("undetected");
            // Magical darkness: the common rank 2 spell doesn't stop darkvision (rank 4 and up does; the card can't tell)
            if (light === "dark" || light === "magical") { if (!vs.darkvision && !vs.greaterDarkvision) raise("hidden"); }
            else if (light === "dim") { if (!vs.lowLight && !vs.darkvision && !vs.greaterDarkvision) raise("concealed"); }
            if (vc.has("dazzled")) raise("concealed");
        }
    }
    // An imprecise sense in range (hearing, scent, tremorsense) narrows undetected to hidden
    if (state === 3 && (vs.imprecise ?? []).some((s) => !s.range || feet <= s.range)) state = 2;
    // Conditions the GM has set on the target count as set
    if (tc.has("concealed")) raise("concealed");
    if (tc.has("hidden")) raise("hidden");
    if (tc.has("undetected") || tc.has("unnoticed")) raise("undetected");
    return order[state];
}

/** Chance to get an attack or targeted effect through: concealed DC 5, hidden DC 11, undetected DC 11 and a guessed square. */
function flatFor(state) {
    return state === "concealed" ? flatCheck(5) : state === "hidden" ? flatCheck(11) : state === "undetected" ? flatCheck(11) * 0.6 : 1;
}
// ---------------------------------------------------------------------------------------------
// Reading the live scene into a plain board the advisor plans on.
// ---------------------------------------------------------------------------------------------
const CASTER_CLASSES = new Set(["wizard", "sorcerer", "cleric", "druid", "witch", "bard", "oracle", "psychic", "summoner", "animist", "magus", "kineticist"]);
const HEALER_CLASSES = new Set(["cleric", "druid", "oracle", "animist"]);

/** Foundry lookups for the ability reader. */
const foundryLookup = {
    name: (uuid) => {
        try { return fromUuidSync(uuid, { strict: false })?.name ?? null; } catch { return null; }
    },
    localize: (key) => {
        const s = game.i18n.localize(key);
        return s === key ? "" : s;
    },
};

/** Ability items worth reading: actions, and feats that are actions or change movement. */
function abilityItems(actor) {
    return (actor?.items ?? []).filter((i) => i.type === "action" || (i.type === "feat" && i.system?.actionType));
}

const profileCache = new Map();
function profileItem(item, selfName) {
    const key = `${item.uuid}|${item._stats?.modifiedTime ?? ""}|${selfName}`;
    if (profileCache.has(key)) return profileCache.get(key);
    const p = profileAbility({
        id: item.id,
        name: item.name,
        kind: item.system?.actionType?.value ?? "passive",
        cost: item.system?.actions?.value ?? null,
        category: item.system?.category ?? null,
        traits: item.system?.traits?.value ?? [],
        html: item.system?.description?.value ?? "",
    }, { selfName, lookup: foundryLookup });
    p.item = item;
    if (profileCache.size > 2000) profileCache.clear();
    profileCache.set(key, p);
    return p;
}

function profilesOf(actor) {
    const selfName = actor?.name ?? "";
    return abilityItems(actor).map((i) => profileItem(i, selfName))
        .filter((p) => p.kind !== "passive" || p.item.type === "action" || p.movementPassive);
}

function speedsOf(actor) {
    // PF2e 8: system.movement.speeds.<type>.value; older: system.attributes.speed (+ otherSpeeds)
    const out = { land: 0 };
    const speeds = actor?.system?.movement?.speeds;
    if (speeds) {
        for (const [type, sp] of Object.entries(speeds)) if (sp && type !== "travel") out[type] = Number(sp.value ?? sp.total) || 0;
        return out;
    }
    const sp = actor?.system?.attributes?.speed ?? {};
    out.land = Number(sp.total ?? sp.value) || 0;
    for (const o of sp.otherSpeeds ?? []) out[o.type] = Number(o.total ?? o.value) || 0;
    return out;
}

/** Difficult terrain the creature's rules let it ignore (PF2e 8: system.movement.terrain). */
function ignoresDifficultTerrain(actor) {
    const t = actor?.system?.movement?.terrain;
    const ignored = (t?.difficult?.ignored ?? []).map((x) => String(x?.slug ?? x?.type ?? x).toLowerCase());
    return ignored.some((x) => ["all", "any", "difficult"].includes(x));
}

const RIDERS = { grab: "Grab", "improved-grab": "Improved Grab", knockdown: "Knockdown", "improved-knockdown": "Improved Knockdown",
    push: "Push", "improved-push": "Improved Push", trip: "Trip", pull: "Pull" };

function strikesOf(actor) {
    return (actor?.system?.actions ?? []).filter((s) => s.item && s.type === "strike" && s.ready !== false).map((s) => {
        const item = s.item;
        const traits = item.system?.traits?.value ?? [];
        const rolls = Object.values(item.system?.damageRolls ?? {});
        let avg = rolls.reduce((t, d) => t + averageOf(d.damage), 0);
        const ranged = !!(item.isRanged ?? traits.some((t) => t.startsWith("range")));
        if (!rolls.length && item.system?.damage) { // a PC's weapon: dice, plus Strength in melee (half for propulsive, all for thrown)
            const d = item.system.damage;
            const die = Number(String(d.die ?? "").replace("d", "")) || 0;
            const dice = Number(d.dice) || 0;
            const str = actor.system?.abilities?.str?.mod ?? 0;
            const strPart = traits.includes("bomb") ? 0 : ranged ? (traits.includes("propulsive") ? Math.floor(Math.max(0, str) / 2) : traits.some((t) => t.startsWith("thrown")) ? str : 0) : str;
            avg = (die ? dice * (die + 1) / 2 : dice) + (Number(d.modifier) || 0) + strPart;
            // Bombs: flat damage, splash on top, and persistent damage counted as about a round and a half of ticks
            if (traits.includes("bomb")) {
                avg += Number(item.system?.splashDamage?.value) || 0;
                const pd = d.persistent;
                if (pd && (Number(pd.number) || Number(pd.faces))) avg += 1.5 * ((Number(pd.number) || 1) * ((Number(pd.faces) || 0) + 1) / 2 || Number(pd.number) || 0);
            }
            if (!Number.isFinite(avg)) avg = 0;
        }
        const reload = Number(traits.find((t) => /^reload-\d/.test(t))?.split("-")[1] ?? 0);
        const thrown = ranged && traits.some((t) => t.startsWith("thrown")) && !traits.includes("returning");
        return {
            id: item.id, label: s.label ?? item.name, item, action: s,
            bonus: s.totalModifier ?? 0,
            avg, deadly: critExtra(traits, rolls[0]?.damage ?? (item.system?.damage ? `${item.system.damage.dice}${item.system.damage.die}` : "")), traits,
            volley: Number(traits.find((t) => /^volley-\d+/.test(t))?.split("-")[1] ?? 0),
            damageTypes: rolls.map((d) => d.damageType).filter(Boolean).concat(rolls.length ? [] : [item.system?.damage?.damageType].filter(Boolean)),
            agile: traits.includes("agile"),
            ranged, reload, thrown,
            reach: ranged ? 0 : (actor.getReach?.({ action: "attack", weapon: item }) ?? 5),
            range: ranged ? (item.range?.increment ?? item.system?.range?.increment ?? 30) : null,
            riders: (item.system?.attackEffects?.value ?? []).map((r) => RIDERS[r] ?? null).filter(Boolean),
            riderKeys: item.system?.attackEffects?.value ?? [],
        };
    });
}

function feetOf(text) {
    const s = String(text ?? "").toLowerCase();
    if (/touch/.test(s)) return 5;
    const m = /(\d+)\s*(?:feet|ft|foot)/.exec(s);
    return m ? Number(m[1]) : null;
}

function costOfSpell(spell) {
    const v = String(spell.system?.time?.value ?? "2").toLowerCase();
    if (/reaction|free|minute|hour|day|round/.test(v)) return null;
    const m = /(\d)/.exec(v);
    return m ? Number(m[1]) : 2;
}

/** Spell damage at the rank it's cast, from the spell's heightening data. */
function spellAverage(spell, rank) {
    const dmg = spell.system?.damage ?? {};
    const parts = {};
    for (const [k, d] of Object.entries(dmg)) parts[k] = d.formula ?? "";
    const h = spell.system?.heightening;
    const base = Number(spell.baseRank ?? spell.system?.level?.value ?? 1);
    if (h?.type === "interval" && h.interval && rank > base && !spell.isCantrip) {
        const steps = Math.floor((rank - base) / h.interval);
        for (const [k, f] of Object.entries(h.damage ?? {})) parts[k] = `${parts[k] ?? ""}+${Array(steps).fill(f).join("+")}`;
    } else if (h?.type === "interval" && h.interval && spell.isCantrip) {
        // A cantrip heightens from its own base rank (1 for most; a psychic's unique cantrips start at 3 or 5)
        const steps = Math.max(0, Math.floor((rank - Math.max(1, base)) / h.interval));
        for (const [k, f] of Object.entries(h.damage ?? {})) parts[k] = `${parts[k] ?? ""}+${Array(steps).fill(f).join("+")}`;
    } else if (h?.type === "fixed") {
        for (const [lvl, data] of Object.entries(h.levels ?? {})) {
            if (Number(lvl) <= rank) for (const [k, d] of Object.entries(data.damage ?? {})) parts[k] = d.formula ?? d;
        }
    }
    return Object.values(parts).reduce((t, f) => t + averageOf(f), 0);
}

/** Spells that can still be cast, with what the advisor needs. */
async function spellsOf(actor) {
    const out = [];
    for (const entry of actor?.spellcasting?.regular ?? []) {
        let data;
        try { data = await entry.getSheetData(); } catch { continue; }
        // A focus pool with no Focus Points left only has its cantrips
        const focusSpent = !!entry.isFocusPool && Number(actor.system?.resources?.focus?.value ?? 1) <= 0;
        const dc = entry.statistic?.dc?.value ?? null;
        const attack = entry.statistic?.check?.mod ?? null;
        for (const g of data?.groups ?? []) {
            const slotsGone = typeof g.uses?.value === "number" && g.uses.max > 0 && g.uses.value <= 0;
            for (const a of g.active ?? []) {
                if (!a?.spell || a.expended || slotsGone || (focusSpent && !a.spell.isCantrip)) continue;
                if (typeof a.uses?.value === "number" && a.uses.value <= 0) continue;
                const s = a.spell;
                const rank = Number(g.id === "cantrips" ? Math.max(1, Math.ceil((actor.level ?? 1) / 2)) : (a.castRank ?? g.id ?? s.rank ?? 1)) || 1;
                const traits = s.system?.traits?.value ?? [];
                const area = s.system?.area ? { shape: s.system.area.type, size: Number(s.system.area.value) } : null;
                const save = s.system?.defense?.save ?? null;
                const avg = spellAverage(s, rank);
                out.push({
                    id: s.id, name: s.name, spell: s, rank, cantrip: !!s.isCantrip, cost: costOfSpell(s),
                    area, range: feetOf(s.system?.range?.value) ?? (area?.shape === "emanation" ? 0 : null),
                    save: save ? { stat: save.statistic, basic: !!save.basic } : null,
                    attack: traits.includes("attack") ? attack : null,
                    dc, avg, traits,
                    heals: traits.includes("healing"),
                    damageTypes: Object.values(s.system?.damage ?? {}).map((d) => d.type ?? d.damageType).filter(Boolean),
                    incapacitation: traits.includes("incapacitation"),
                    buff: readBuff(s),
                    vitality: traits.includes("vitality"), void: traits.includes("void"),
                    // Heal and harm: two actions make them ranged (30 feet) and add 8 per rank
                    twoAction: /^(heal|harm)$/i.test(s.name) ? { avg: avg + 8 * rank, range: 30 } : null,
                    ...spellEffects(s),
                    entry: entry.name, focus: !!entry.isFocusPool,
                });
            }
        }
    }
    // One per spell name: the highest rank still available
    const best = new Map();
    for (const s of out) if (!best.has(s.name) || best.get(s.name).rank < s.rank) best.set(s.name, s);
    return [...best.values()];
}

/**
 * A spell that helps its allies fight: "+1 status bonus to attack rolls (and damage rolls)" for you and your allies.
 * Returns { attack, damage, self, size, rounds } or null.
 */
function readBuff(spell) {
    const t = stripTags(spell.system?.description?.value ?? "");
    if (!/\ballies\b/i.test(t)) return null;
    const m = /\+(\d) status bonus to attack rolls(,? (?:and )?damage rolls)?/i.exec(t);
    if (!m) return null;
    const area = spell.system?.area;
    const size = Number(area?.value) || Number(/(\d+)-foot (?:emanation|aura|burst)/i.exec(t)?.[1]) || 30;
    const dur = String(spell.system?.duration?.value ?? "").toLowerCase();
    const rounds = /round/.test(dur) && !/minute|hour/.test(dur) ? 1 : 3;
    return { attack: Number(m[1]), damage: m[2] ? Number(m[1]) : 0, self: /\byou and\b/i.test(t), size, rounds };
}

/** What a spell leaves on its target, overall and by the target's degree of success. */
function spellEffects(spell) {
    const p = profileAbility({ name: spell.name, kind: "action", cost: 2, html: spell.system?.description?.value ?? "" }, { lookup: foundryLookup });
    const byDegree = {};
    for (const [key, label] of [["success", "success"], ["failure", "failure"], ["criticalFailure", "critical failure"]]) {
        const text = p.sections[label];
        if (text) byDegree[key] = readInflicts({ links: [] }, text, "");
    }
    return { inflicts: p.inflicts, byDegree: Object.keys(byDegree).length ? byDegree : null };
}

function rectOf(tokenDoc, size) {
    const w = Math.max(1, Math.round(tokenDoc.width));
    return {
        x: Math.round(tokenDoc.x / size), y: Math.round(tokenDoc.y / size),
        w, h: Math.max(1, Math.round(tokenDoc.height)),
        z: Number(tokenDoc.elevation) || 0, ht: 5 * w, lvl: tokenDoc.level ?? null,
    };
}

function isDown(actor, combatant) {
    if (!actor) return true;
    if (combatant?.isDefeated) return true;
    const hp = actor.hitPoints ?? actor.system?.attributes?.hp;
    if (hp && hp.max > 0 && hp.value <= 0) return true;
    return !!(actor.statuses?.has?.("dead") || actor.statuses?.has?.("unconscious"));
}

/**
 * Light level at a square: "bright", "dim", "dark", or "magical" (inside a darkness effect).
 * The scene's own level (PF2e: bright, dimly lit or dark), raised by light sources that reach the square.
 */
function lightReader(scene, size) {
    const cache = new Map();
    const base = scene.isBright ?? true ? "bright" : scene.isDimlyLit ? "dim" : "dark";
    const sources = [...(canvas.effects?.lightSources?.values?.() ?? [])].filter((ls) => ls.active !== false && !/global/i.test(ls.constructor?.name ?? "") && ls !== canvas.environment?.globalLightSource);
    return (rect) => {
        const k = `${rect.x},${rect.y},${rect.w}`;
        if (cache.has(k)) return cache.get(k);
        const pt = { x: (rect.x + rect.w / 2) * size, y: (rect.y + rect.h / 2) * size };
        let level = base;
        try { if (canvas.effects?.testInsideDarkness?.(pt)) level = "magical"; } catch { /* older cores */ }
        if (level !== "bright" && level !== "magical") {
            for (const ls of sources) {
                const d = ls.data ?? {};
                const inShape = ls.shape?.contains ? ls.shape.contains(pt.x, pt.y) : true;
                if (!inShape) continue;
                const dist = Math.hypot(pt.x - (d.x ?? ls.x ?? 0), pt.y - (d.y ?? ls.y ?? 0));
                if (dist <= (d.bright ?? 0)) { level = "bright"; break; }
                if (dist <= (d.dim ?? 0)) level = "dim";
            }
        }
        cache.set(k, level);
        return level;
    };
}

/** How a creature perceives: darkvision, low-light vision, and precise or imprecise senses with their ranges. */
function sensesOf(actor, tokenDoc) {
    const list = [...(actor?.system?.perception?.senses ?? []), ...(actor?.perception?.senses?.contents ?? actor?.perception?.senses ?? [])]
        .filter((x) => x && typeof x === "object");
    const has = (t) => list.some((x) => x.type === t);
    const out = {
        darkvision: has("darkvision") || has("greater-darkvision") || !!tokenDoc?.hasDarkvision,
        greaterDarkvision: has("greater-darkvision") || has("greaterDarkvision"),
        lowLight: has("low-light-vision") || !!tokenDoc?.hasLowLightVision,
        seeInvisible: has("see-invisibility") || has("truesight"),
        precise: list.filter((x) => x.acuity === "precise" && !/vision|darkvision/.test(x.type)).map((x) => ({ type: x.type, range: x.range ?? null })),
        imprecise: [{ type: "hearing", range: null }, ...list.filter((x) => x.acuity === "imprecise").map((x) => ({ type: x.type, range: x.range ?? null }))],
    };
    if (actor?.conditions?.active?.some?.((c) => c.slug === "deafened")) out.imprecise = out.imprecise.filter((x) => x.type !== "hearing");
    return out;
}

/** Weaknesses, resistances and immunities, as plain lists. */
function iwrOf(actor) {
    const a = actor?.attributes ?? actor?.system?.attributes ?? {};
    const list = (x) => (Array.isArray(x) ? x : Array.isArray(x?.value) ? x.value : []);
    return {
        weak: list(a.weaknesses).map((w) => ({ type: w.type, value: Number(w.value) || 0 })),
        resist: list(a.resistances).map((r) => ({ type: r.type, value: Number(r.value) || 0, exceptions: (r.exceptions ?? []).map((e) => e?.label ?? e) })),
        immune: list(a.immunities).map((i) => i.type ?? i),
    };
}

const conditionValues = (actor) => Object.fromEntries((actor?.conditions?.active ?? []).map((c) => [c.slug, Number(c.value ?? 1) || 1]));
const CANT_ACT = ["paralyzed", "unconscious", "petrified", "stunned", "restrained", "dying"];
const hasAbility = (actor, re) => !!actor?.items?.some?.((i) => re.test(i.name ?? ""));

/** The creatures on the scene, as the advisor sees them. */
function creatureOf(token, size) {
    const a = token.actor;
    const cls = a.class?.slug ?? a.class?.name?.toLowerCase() ?? null;
    const reactions = abilityItems(a).filter((i) => i.system?.actionType?.value === "reaction").map((i) => profileItem(i, a.name))
        .filter((p) => p.trigger && (p.trigger.onMove || p.trigger.onManipulate || p.trigger.onRanged));
    const hp = a.hitPoints ?? a.system?.attributes?.hp ?? {};
    const conditions = new Set((a.conditions?.active ?? []).map((c) => c.slug));
    const pcStrike = a.type === "character" ? strikesOf(a).filter((s) => !s.ranged).sort((x, y) => y.bonus - x.bonus)[0] : null;
    // How far it can hurt something it can't reach: its longest ranged Strike's first increment, or 60 ft for a caster
    const pcRanged = a.type === "character" ? strikesOf(a).filter((s) => s.ranged).sort((x, y) => (y.range ?? 0) - (x.range ?? 0))[0] : null;
    return {
        id: token.id, name: token.name, token, actor: a, rect: rectOf(token.document, size),
        type: a.type, level: a.level ?? 0,
        ac: a.armorClass?.value ?? 10,
        saves: Object.fromEntries(["fortitude", "reflex", "will"].map((s) => [s, a.saves?.[s]?.mod ?? 0])),
        hp: hp.value ?? 0, maxHp: hp.max ?? 1,
        conditions,
        reach: a.getReach?.({ action: "attack" }) ?? 5,
        reactions,
        reactiveStrike: pcStrike ? { bonus: pcStrike.bonus, avg: pcStrike.avg } : { bonus: (a.level ?? 1) + 8, avg: 4 + (a.level ?? 1) * 1.5 },
        rangedReach: pcRanged?.range ?? (CASTER_CLASSES.has(cls) || (a.spellcasting?.regular?.length ?? 0) > 0 ? 60 : 0),
        caster: CASTER_CLASSES.has(cls) || (a.spellcasting?.regular?.length ?? 0) > 0,
        sizeRank: SIZE_RANK[a.size] ?? 2,
        senses: sensesOf(a, token.document),
        languages: a.system?.details?.languages?.value ?? [],
        iwr: iwrOf(a),
        perception: a.perception?.mod ?? a.system?.perception?.mod ?? null,
        athletics: a.skills?.athletics?.mod ?? null,
        canAct: !CANT_ACT.some((c) => conditions.has(c)),
        hasMelee: a.type === "character" || strikesOf(a).some((s) => !s.ranged),
        flankImmune: hasAbility(a, /^all-around vision$/i) ? "all" : hasAbility(a, /^deny advantage$/i) ? "deny" : null,
        takingCover: !!a.items?.some?.((i) => i.type === "effect" && /take cover|^effect: cover/i.test(i.name ?? "")),
        // What anyone can see of its defences: the armor it wears (characters only) and a raised shield
        armor: a.type === "character" ? (a.wornArmor?.category ?? "unarmored") : null,
        shieldRaised: !!a.heldShield?.isRaised,
        shieldBonus: a.heldShield?.isRaised ? Number(a.heldShield?.system?.acBonus ?? 2) || 2 : 0,
        healer: HEALER_CLASSES.has(cls) || a.itemTypes?.spell?.some?.((s) => /^heal$/i.test(s.name)),
        traits: [...(a.traits ?? a.system?.traits?.value ?? [])],
        cls,
    };
}

/**
 * Difficult terrain from scene regions, as a multiplier per square: core "Modify Movement Cost"
 * behaviors, and PF2e's Environment Feature (terrain.difficult 1 = difficult, 2 = greater).
 */
function terrainReader(scene, size, { climb = false, z = 0 } = {}) {
    const costOf = (b) => {
        if (b.disabled) return 1;
        // PF2e Terrains: uneven ground takes a Balance check (treated as difficult), an incline a Climb (much slower
        // without a climb Speed), hazardous terrain hurts (treated as difficult so the way round is preferred)
        if (b.type === "pf2e-terrains.unevenGround" || b.type === "pf2e-terrains.hazardousTerrain") return 2;
        if (b.type === "pf2e-terrains.inclines") return climb ? 1 : 4;
        if (b.type === "modifyMovementCost" || b.type === "pf2e-toolbelt.difficult-terrain") {
            const d = b.system?.difficulties ?? {};
            return Number(d.walk ?? d.land ?? Object.values(d)[0] ?? 1) || 1;
        }
        if (b.type === "environmentFeature") {
            const level = Number(b.system?.terrain?.difficult ?? 0);
            return level >= 2 ? 3 : level >= 1 ? 2 : 1;
        }
        return 1;
    };
    const regions = (scene?.regions?.contents ?? []).filter((r) => r.behaviors?.some?.((b) => costOf(b) > 1));
    if (!regions.length) return () => 1;
    const cache = new Map();
    return (x, y) => {
        const k = `${x},${y}`;
        if (cache.has(k)) return cache.get(k);
        let mult = 1;
        const point = { x: (x + 0.5) * size, y: (y + 0.5) * size, elevation: z };
        for (const r of regions) {
            let inside = false;
            try { inside = r.testPoint?.(point) ?? r.object?.testPoint?.(point) ?? false; } catch { inside = false; }
            if (!inside) continue;
            for (const b of r.behaviors) mult = Math.max(mult, costOf(b));
        }
        cache.set(k, mult);
        return mult;
    };
}

/** What a square holds that the GM should hear about: uneven ground, an incline, hazardous terrain. */
function terrainNotes(scene, size, z = 0) {
    const describe = (b) => {
        if (b.disabled) return null;
        if (b.type === "pf2e-terrains.unevenGround") return `uneven ground (Balance DC ${b.system?.dc ?? "?"}; off-guard on a failure)`;
        if (b.type === "pf2e-terrains.inclines") return `an incline (Climb, Athletics DC ${b.system?.dc ?? "?"})`;
        if (b.type === "pf2e-terrains.hazardousTerrain") return `hazardous terrain (${b.system?.formula ?? "damage"})`;
        return null;
    };
    const regions = (scene?.regions?.contents ?? []).filter((r) => r.behaviors?.some?.((b) => describe(b)));
    const cache = new Map();
    return (x, y) => {
        if (!regions.length) return [];
        const k = `${x},${y}`;
        if (cache.has(k)) return cache.get(k);
        const point = { x: (x + 0.5) * size, y: (y + 0.5) * size, elevation: z };
        const out = [];
        for (const r of regions) {
            let inside = false;
            try { inside = r.testPoint?.(point) ?? false; } catch { inside = false; }
            if (inside) for (const b of r.behaviors) { const d = describe(b); if (d && !out.includes(d)) out.push(d); }
        }
        cache.set(k, out);
        return out;
    };
}

/**
 * Read the scene around an acting token. Returns null when there's no scene or token.
 */
/**
 * Scrolls and wands it carries (only with spellcasting of its own: it casts them with its first entry's DC and attack),
 * and healing potions and elixirs. Each comes out like a spell: a scroll or wand costs an Interact more to draw unless
 * it's already in hand; a potion is drawn and drunk (or fed to someone beside it).
 */
function itemSpellsOf(actor) {
    const out = [];
    const items = actor?.itemTypes?.consumable ?? actor?.items?.filter?.((i) => i.type === "consumable") ?? [];
    const entries = actor?.spellcasting?.regular ?? [];
    for (const it of items) {
        if ((it.quantity ?? it.system?.quantity ?? 1) <= 0) continue;
        const cat = it.category ?? it.system?.category;
        const held = it.system?.equipped?.carryType === "held";
        const traits = it.system?.traits?.value ?? [];
        if ((cat === "scroll" || cat === "wand") && entries.length) {
            if (cat === "wand" && Number(it.system?.uses?.value ?? 1) <= 0) continue;
            const sp = it.embeddedSpell;
            if (!sp) continue;
            // Only a spell on one of its lists: an entry of the spell's tradition, whose DC and attack it casts with
            const trads = sp.system?.traits?.traditions ?? [];
            const entry = entries.find((e) => trads.includes(e.tradition ?? e.system?.tradition?.value));
            if (!entry) continue;
            const dc = entry.statistic?.dc?.value ?? null;
            const attack = entry.statistic?.check?.mod ?? null;
            const cost = costOfSpell(sp);
            if (!cost) continue;
            const rank = Number(sp.rank ?? 1) || 1;
            const t = sp.system?.traits?.value ?? [];
            const area = sp.system?.area ? { shape: sp.system.area.type, size: Number(sp.system.area.value) } : null;
            const save = sp.system?.defense?.save ?? null;
            const avg = spellAverage(sp, rank);
            let eff = { inflicts: [], byDegree: null };
            try { eff = spellEffects(sp); } catch { /* text it can't read */ }
            out.push({
                id: it.id, name: `${sp.name} from ${cat === "wand" ? "its wand" : "a scroll"}`, spell: sp, rank, cantrip: false, cost: cost + (held ? 0 : 1), drawn: !held, consumable: cat,
                area, range: feetOf(sp.system?.range?.value) ?? (area?.shape === "emanation" ? 0 : null),
                save: save ? { stat: save.statistic, basic: !!save.basic } : null, attack: t.includes("attack") ? attack : null, dc, avg, traits: t,
                heals: t.includes("healing"), damageTypes: Object.values(sp.system?.damage ?? {}).map((d) => d.type ?? d.damageType).filter(Boolean),
                incapacitation: t.includes("incapacitation"), buff: readBuff(sp), vitality: t.includes("vitality"), void: t.includes("void"),
                twoAction: /^(heal|harm)$/i.test(sp.name) ? { avg: avg + 8 * rank, range: 30 } : null, ...eff, entry: cat,
            });
        } else if ((cat === "potion" || cat === "elixir") && traits.includes("healing")) {
            const text = stripTags(it.system?.description?.value ?? "");
            const formula = it.system?.damage?.formula ?? /\b(?:regains?|restores?|recovers?|heals?)\s+(\d+d\d+(?:\s*\+\s*\d+)?)\s*(?:Hit Points|HP)/i.exec(text)?.[1]
                ?? /(\d+d\d+(?:\s*\+\s*\d+)?)\s*(?:Hit Points|HP)/i.exec(text)?.[1];
            const avg = formula ? averageOf(String(formula)) : 0;
            if (!(avg > 0)) continue;
            out.push({ id: it.id, name: it.name, potion: true, held, cost: held ? 1 : 2, range: 5, avg, heals: true, traits: ["manipulate"], vitality: traits.includes("vitality"), void: traits.includes("void"),
                save: null, attack: null, dc: null, area: null, buff: null, inflicts: [], rank: 0, entry: cat });
        }
    }
    // One of each
    const seen = new Set();
    return out.filter((x) => (seen.has(x.name) ? false : seen.add(x.name)));
}

/** How a heal is given: "Cast heal", "Draw and drink a minor healing potion". */
function healUse(sp, who, actions = null) {
    if (sp.potion) return `${sp.held ? "" : "Draw and "}${who === "itself" ? (sp.held ? "Drink" : "drink") : (sp.held ? "Feed" : "feed")} ${sp.name}${who === "itself" ? "" : ` to ${who}`}`;
    return `Cast ${sp.name}${actions && actions !== sp.cost ? ` with ${actions} actions` : ""} on ${who}`;
}

/** What its side has seen of each foe this fight: { tokenId: { ac: attacks, fortitude: saves, ... } }. */
function learnedFor(combat) {
    const f = flagOf(combat, "learned");
    return f && typeof f === "object" ? f : {};
}
/** How far it trusts what it has seen over its guess: a third per look, sure after three. Animals don't learn; Sharp creatures read it outright. */
const learnedN = (v) => (v && typeof v === "object" ? Number(v.n) || 0 : Number(v) || 0);
const learnK = (board, t, what, tier) => (tier >= 1 && tier < 4 ? Math.min(1, 0.34 * learnedN(board.learned?.[t?.id]?.[what])) : 0);
/** AC bounds the attacks so far have shown: { lo, hi } with lo <= AC <= hi, or null. */
function learnedAcBounds(board, t) {
    const v = board.learned?.[t?.id]?.ac;
    if (!v || typeof v !== "object" || !Number.isFinite(v.lo) || !Number.isFinite(v.hi)) return null;
    return { lo: v.lo, hi: v.hi };
}

/** The sustained spell it cast on an earlier turn of this fight (within a minute), worth Sustaining. */
function sustainOf(actor, combat) {
    const f = flagOf(actor, "sustain");
    if (!f || !combat) return null;
    // Its Sustain action posted this fight: already done this round; and once the GM uses it, a round without it means the spell ended
    const done = flagOf(actor, "sustained");
    const seen = done?.combatId === combat.id ? done.round : null;
    if (seen === combat.round) return null;
    let best = null;
    for (const v of Object.values(f)) {
        const sp = actor.items?.get?.(v?.itemId);
        // Most last up to a minute (10 rounds); the longest, 10 minutes
        const cap = /minute/i.test(String(sp?.system?.duration?.value ?? "")) && !/10 minutes/i.test(String(sp?.system?.duration?.value ?? "")) ? 10 : 100;
        if (!v || v.combatId !== combat.id || !((combat.round ?? 0) > (v.round ?? 0)) || (combat.round ?? 0) - (v.round ?? 0) > cap) continue;
        if (seen !== null && (combat.round ?? 0) - 1 > Math.max(seen, v.round ?? 0)) continue;
        const lvl = actor.level ?? 0;
        let value = 0.3 * hitWorth(lvl);
        if (sp) {
            const avg = spellAverage(sp, Number(v.rank ?? sp.rank ?? 1) || 1);
            let eff = null;
            try { eff = spellEffects(sp); } catch { eff = null; }
            const worth = (eff?.inflicts ?? []).reduce((t, c) => t + (CONDITION_VALUE[c] ?? 1), 0);
            value = Math.max(value, avg * 0.5, (worth / 5) * hitWorth(lvl) * 0.5);
        }
        if (!best || value > best.value) best = { name: v.name ?? sp?.name ?? "its spell", itemId: v.itemId, value };
    }
    return best;
}

/** "Vicious", "finishes off the fallen": the rare creature that goes on hitting a foe who is down. */
const VICIOUS_WORDS = /\b(?:vicious|merciless|coup de grace|finish(?:es|ing)? off (?:the |any )?(?:fallen|downed|dying|wounded|helpless)|(?:kills?|savages?|mauls?) (?:the |any )?(?:fallen|downed|dying|helpless)|keeps? (?:attacking|hitting|savaging|mauling) (?:the |a )?(?:fallen|downed|dying))\b/gi;
/** Vicious, unless the words are denied ("never finishes off the fallen", "not vicious"). */
const viciousIn = (text) => [...String(text ?? "").matchAll(VICIOUS_WORDS)].some((m) => !/\b(?:never|not|no|doesn'?t|don'?t|won'?t|isn'?t|aren'?t|rarely|seldom|nor)\b[\w\s,'-]{0,25}$/i.test(String(text).slice(Math.max(0, m.index - 40), m.index)));
/** Damage taken since its last turn (token id -> { round, dmg }), and the HP it had when that turn began. */
const RECENT = new Map();
const HP_AT_TURN = new Map();
/** Whom each NPC last attacked (token id -> { id, round }). */
const LAST_TARGET = new Map();
/** A token on another level of the scene has no object on the canvas: stand in for it with its document. */
const tokenStandIn = (doc) => ({ id: doc.id, name: doc.name, actor: doc.actor, document: doc });

const VIS_ORDER = ["observed", "concealed", "hidden", "undetected"];
/**
 * PF2E Visioner's visibility between this token and each of the others, both ways, when the module is active and
 * answers. Its API: getVisibility(observerId, targetId) -> "observed" | "concealed" | "hidden" | "undetected".
 * Returns Map token id -> { state, seen }, or null when Visioner isn't there.
 */
function visionerStates(token, others) {
    const mod = game.modules?.get?.("pf2e-visioner");
    const api = mod?.active ? mod.api : null;
    if (typeof api?.getVisibility !== "function") return null;
    const map = new Map();
    for (const t of others) {
        try {
            const state = api.getVisibility(token.id, t.id);
            const seen = api.getVisibility(t.id, token.id);
            if (VIS_ORDER.includes(state) || VIS_ORDER.includes(seen)) {
                map.set(t.id, { state: VIS_ORDER.includes(state) ? state : "observed", seen: VIS_ORDER.includes(seen) ? seen : "observed" });
            }
        } catch { /* Visioner couldn't answer for this pair: fall back to conditions and light */ }
    }
    return map;
}
/**
 * A visibility state with Visioner's reading folded in. From the creature's own square Visioner's answer stands
 * (it reads light and senses itself). From any other square the computed state is used, except that hidden and
 * undetected carry: a creature that Hid or Sneaked stays so until it's found, wherever the observer moves to.
 */
function withVisioner(computed, visionerState, fromOwnSquare) {
    if (!visionerState) return computed;
    if (fromOwnSquare) return visionerState;
    const vi = VIS_ORDER.indexOf(visionerState);
    return vi >= 2 && vi > VIS_ORDER.indexOf(computed) ? visionerState : computed;
}

/**
 * reactionsSeen: for the player's Turn Helper, a test (enemy, reaction) => boolean: reactions it rejects are dropped
 * from the board, so paths and warnings only go round reactions the party has seen. The GM's card passes nothing.
 */
async function readBoard(token, combat = game.combat, { extra = [], reactionsSeen = null } = {}) {
    if (token && !token.document && token.documentName === "Token") token = token.object ?? tokenStandIn(token);
    const scene = token?.document?.parent ?? canvas?.scene;
    if (!token?.actor || !scene || scene !== canvas?.scene) return null;
    const size = canvas.grid.size;
    const square = canvas.grid.type === CONST.GRID_TYPES.SQUARE;
    const actor = token.actor;
    const combatantOf = (t) => combat?.combatants?.find?.((c) => c.tokenId === t.id) ?? null;
    // Every token in the scene, on every level (Foundry 14 only draws the level being viewed)
    const others = [...(scene.tokens?.contents ?? []).map((d) => d.object ?? tokenStandIn(d)), ...extra]
        .filter((t) => t.id !== token.id && t.actor && (!t.document.hidden || t.actor.alliance === actor.alliance));
    const alive = others.filter((t) => !isDown(t.actor, combatantOf(t)));
    const enemyTokens = alive.filter((t) => actor.isEnemyOf?.(t.actor) ?? (t.actor.alliance && actor.alliance && t.actor.alliance !== actor.alliance));
    const allyTokens = alive.filter((t) => !enemyTokens.includes(t) && (actor.isAllyOf?.(t.actor) ?? t.actor.alliance === actor.alliance));
    // PF2E Visioner, when it's running: what it says each side can see of the other (Hide, Sneak, Seek and its
    // own light reading), per observer. Optional; without it, conditions, light and senses decide.
    const visioner = visionerStates(token, enemyTokens);
    // What its tactics say it's after: neutral creatures they name ("the wolves are after the mules")
    let tacticsText = "";
    try { tacticsText = stripTags([...tacticsOf(actor, token.document).map((t) => t.html), String(notesOf(baseActorOf(actor)) ?? "")].join(" ")).toLowerCase(); } catch { tacticsText = ""; }
    // Its whole name, less a number ("Mule 2" -> mule), singular or plural (mules, wolves, ponies); creatures only
    const nameForms = (n) => {
        const base = String(n ?? "").toLowerCase().replace(/\s*\((?:elite|weak)\)/g, "").replace(/\s+\d+$/, "").replace(/[^a-z' -]/g, " ").replace(/\s+/g, " ").trim();
        if (base.length < 3) return [];
        const esc = base.replace(/[-']/g, (c) => `\\${c}`);
        return [esc, `${esc}s`, `${esc}es`, esc.replace(/f$/, "ves"), esc.replace(/fe$/, "ves"), esc.replace(/y$/, "ies")];
    };
    const named = (t) => ["npc", "character", "familiar"].includes(t.actor.type)
        && [...new Set([t.name, t.actor.name].flatMap(nameForms))].some((x) => new RegExp(`\\b${x}\\b`).test(tacticsText));
    const objectiveTokens = tacticsText ? alive.filter((t) => !enemyTokens.includes(t) && !allyTokens.includes(t) && !t.actor.hasPlayerOwner && named(t)) : [];
    const profiles = profilesOf(actor);
    const move = movementOptions(profiles, speedsOf(actor));
    const me = {
        id: token.id, name: token.name, token, actor, rect: rectOf(token.document, size),
        hp: actor.hitPoints?.value ?? 0, maxHp: actor.hitPoints?.max ?? 1, ac: actor.armorClass?.value ?? 10, level: actor.level ?? 0,
        int: actor.system?.abilities?.int?.mod ?? 0,
        wis: actor.system?.abilities?.wis?.mod ?? 0,
        // A hand free for a Shove or a Grapple: false when what it holds fills both (sword and shield)
        freeHand: (() => { const held = (actor.items?.contents ?? []).reduce((n, i) => n + (Number(i.system?.equipped?.handsHeld) || 0), 0); return held < 2; })(),
        mindless: actor.traits?.has?.("mindless") ?? false,
        conditions: new Set((actor.conditions?.active ?? []).map((c) => c.slug)),
        intimidation: actor.skills?.intimidation?.mod ?? null,
        deception: actor.skills?.deception?.mod ?? null,
        deceptionTrained: !!(actor.skills?.deception?.proficient || (actor.skills?.deception?.rank ?? 0) >= 1),
        athletics: actor.skills?.athletics?.mod ?? null,
        acrobatics: actor.skills?.acrobatics?.mod ?? null,
        conditionValues: conditionValues(actor),
        senses: sensesOf(actor, token.document),
        languages: actor.system?.details?.languages?.value ?? [],
        sizeRank: SIZE_RANK[actor.size] ?? 2,
        traits: [...(actor.traits ?? actor.system?.traits?.value ?? [])],
        saves: Object.fromEntries(["fortitude", "reflex", "will"].map((k) => [k, actor.saves?.[k]?.mod ?? 0])),
        iwr: iwrOf(actor),
        shield: !!(actor.heldShield ?? actor.itemTypes?.shield?.some?.((s) => s.isEquipped)),
        shieldRaised: !!actor.heldShield?.isRaised,
    };
    // Sneak Attack and the like: extra damage against an off-guard target
    let sneak = 0;
    for (const p of profiles) {
        if (p.kind !== "passive" || !/\boff-guard\b/i.test(p.text)) continue;
        const m = /\bextra (\d+d\d+(?:\s*[+-]\s*\d+)?)\s*(?:precision )?damage\b/i.exec(p.text) ?? /\b(\d+d\d+)\s*(?:extra )?precision damage\b/i.exec(p.text);
        if (m) sneak = Math.max(sneak, averageOf(m[1]));
    }
    // Pack Attack: "Strikes deal 1d4 extra damage to creatures within reach of at least two of the wolf's allies"
    let pack = null;
    for (const p of profiles) {
        if (p.kind !== "passive") continue;
        const m = /\b(\d+d\d+(?:\s*[+-]\s*\d+)?) extra damage to (?:any )?(?:creatures?|targets?|foes?|enemies) within (?:the )?reach of at least (one|two|three|\d) of\b/i.exec(p.text);
        if (m) pack = { avg: averageOf(m[1]), allies: { one: 1, two: 2, three: 3 }[m[2].toLowerCase()] ?? Number(m[2]) };
    }
    const strikes = strikesOf(actor);
    // A character's Strike damage comes from PF2e's own formula (runes, racket, specialization, rage and the rest),
    // which the system can give without rolling. Creatures keep their stat-block rolls.
    if (actor.type === "character") {
        for (const s of strikes) {
            try {
                const f = await s.action?.damage?.({ getFormula: true });
                const a = averageOf(f);
                if (a > 0) { s.avg = a; s.formula = String(f); }
            } catch { /* a Strike that can't say: keep the estimate */ }
        }
    }
    const board = {
        square, size, me, profiles, move, sneak, pack,
        rechargeLeft: (p) => rechargeLeft(actor, p.item?.id ?? p.id),
        strikes,
        spells: [...await spellsOf(actor), ...itemSpellsOf(actor)],
        enemies: [...enemyTokens.map((t) => creatureOf(t, size)), ...objectiveTokens.map((t) => ({ ...creatureOf(t, size), objective: true }))],
        tacticsText,
        allies: allyTokens.map((t) => creatureOf(t, size)),
        // Allies down but not dead (dying or unconscious, and not marked defeated): healing brings them back
        downAllies: others.filter((t) => isDown(t.actor, combatantOf(t)) && !combatantOf(t)?.isDefeated && !t.actor.statuses?.has?.("dead")
            && ((t.actor.hitPoints?.value ?? 1) <= 0 || t.actor.hasCondition?.("dying")) && ["dying", "unconscious"].some((c) => t.actor.hasCondition?.(c) || t.actor.statuses?.has?.(c)) && !(actor.isEnemyOf?.(t.actor) ?? false)
            && (actor.isAllyOf?.(t.actor) ?? t.actor.alliance === actor.alliance)).map((t) => creatureOf(t, size)),
        // Foes down but not dead: only a vicious creature goes on hitting them
        downEnemies: others.filter((t) => isDown(t.actor, combatantOf(t)) && !t.actor.statuses?.has?.("dead") && !combatantOf(t)?.isDefeated && (actor.isEnemyOf?.(t.actor) ?? false))
            .map((t) => creatureOf(t, size)),
        // Its own side's fallen (dead or down), for morale
        fallenAllies: others.filter((t) => combatantOf(t) && isDown(t.actor, combatantOf(t)) && !(actor.isEnemyOf?.(t.actor) ?? false) && (actor.isAllyOf?.(t.actor) ?? t.actor.alliance === actor.alliance))
            .map((t) => ({ id: t.id, name: t.name, level: t.actor.level ?? 0 })),
        // Damage taken since its last turn began
        recentDamage: (() => { const r = RECENT.get(token.id); return r && r.combatId === combat?.id && r.round === (combat?.round ?? 0) ? r.dmg : 0; })(),
        // Whom it attacked last (this round or last): it tends to stay on them
        lastTarget: (() => { const l = LAST_TARGET.get(token.id); const d = (combat?.round ?? 0) - (l?.round ?? 0); return l && l.combatId === combat?.id && d >= 0 && d <= 1 ? l.id : null; })(),
        vicious: viciousIn(tacticsText),
        round: combat?.round ?? 0,
        // Who has hurt it, healed its foes or attacked it this fight (decays by half each round)
        threat: threatFor(combat, token.id),
        // What its side has seen of each foe's defences this fight: attacks on their AC, saves they rolled
        learned: learnedFor(combat),
        // A spell it cast on an earlier turn that it can Sustain
        sustain: sustainOf(actor, combat),
        // Visioner's per-observer states: enemy token id -> { state: how it sees them, seen: how they see it }
        visioner,
    };
    // Levels (Foundry 14): walls belong to a level, and a creature on another floor is out of reach. It only sees
    // creatures on levels its own looks onto (an open gallery over a hall), not through a floor.
    const lvlDoc = me.rect.lvl ? scene.levels?.get?.(me.rect.lvl) ?? null : null;
    if (lvlDoc && (scene.levels?.size ?? 0) > 1) {
        const looks = (from, to) => { const v = scene.levels.get(from)?.visibility?.levels; return !!(v?.has ? v.has(to) : v?.includes?.(to)); };
        // A floor between them: a surface (Define Surface region) between the two heights over either of them
        const surfaces = (scene.regions?.contents ?? []).filter((r) => r.behaviors?.some?.((b) => b.type === "defineSurface" && !b.disabled && b.system?.sight !== false));
        const center = (r) => ({ x: (r.x + r.w / 2) * size, y: (r.y + r.h / 2) * size });
        // The line from its eyes to the middle of the other creature crosses each floor's height somewhere: is that
        // point on the floor (looking out of an upper window into the yard: not; down through the boards: yes)
        const floorBetween = (c) => {
            const za = me.rect.z + heightOf(me.rect) * 0.75, zb = c.rect.z + heightOf(c.rect) * 0.5;
            const pa = center(me.rect), pb = center(c.rect);
            return surfaces.some((r) => {
                const b = r.elevation?.bottom;
                if (!Number.isFinite(b) || b <= Math.min(za, zb) || b >= Math.max(za, zb)) return false;
                const t = (b - za) / (zb - za);
                try { return r.testPoint?.({ x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t, elevation: b }) ?? false; } catch { return false; }
            });
        };
        const sees = (c) => !c.rect.lvl || c.rect.lvl === me.rect.lvl || ((looks(me.rect.lvl, c.rect.lvl) || looks(c.rect.lvl, me.rect.lvl)) && !floorBetween(c));
        board.elsewhere = board.enemies.filter((e) => !sees(e));
        board.downEnemies = board.downEnemies.filter((e) => sees(e));
        board.enemies = board.enemies.filter((e) => sees(e));
        board.allies = board.allies.filter((a) => sees(a));
    }
    const floorZ = [lvlDoc?.elevation?.bottom, lvlDoc?.elevation?.base].find((v) => Number.isFinite(v)) ?? 0;
    board.floorZ = floorZ;
    // Up in the air: its token is flying (its movement is set to Fly) above its floor. A gargoyle perched on a roof isn't.
    const flies = (speedsOf(actor)?.fly ?? 0) > 0;
    me.airborne = flies && token.document.movementAction === "fly" && me.rect.z > floorZ;
    // Inclines (PF2e Terrains): the faces a walker can Climb between two heights
    board.inclines = (scene.regions?.contents ?? []).flatMap((r) => (r.behaviors ?? []).filter((b) => b.type === "pf2e-terrains.inclines" && !b.disabled)
        .map((b) => ({ region: r, bottom: Number.isFinite(r.elevation?.bottom) ? r.elevation.bottom : -Infinity, top: Number.isFinite(r.elevation?.top) ? r.elevation.top : Infinity, dc: b.system?.dc ?? null })));
    // Light at a square and walls between two points (grid units), for cover and who can see whom
    board.lightAt = lightReader(scene, size);
    const sight = CONFIG.Canvas.polygonBackends?.sight;
    const lvlCfg = lvlDoc ? { level: lvlDoc } : {};
    board.lineBlocked = (p, q) => {
        try { return !!sight?.testCollision({ x: p.x * size, y: p.y * size, elevation: me.rect.z + 1 }, { x: q.x * size, y: q.y * size, elevation: me.rect.z + 1 }, { type: "sight", mode: "any", ...lvlCfg }); } catch { return false; }
    };
    if (!square) return board;

    // Who stands where
    const occupant = new Map();
    for (const c of [...board.enemies, ...board.allies]) for (const k of rectSquares(c.rect)) occupant.set(k, c);
    // The dying and unconscious still fill their squares: nothing ends its move on top of them
    for (const c of [...(board.downAllies ?? []), ...(board.downEnemies ?? [])]) for (const k of rectSquares(c.rect)) if (!occupant.has(k)) occupant.set(k, c);
    const blockers = new Map(); // dead bodies don't block; living enemies block passage
    for (const c of board.enemies) for (const k of rectSquares(c.rect)) blockers.set(k, c);
    const rect = board.sceneRect = {
        x: Math.floor(canvas.dimensions.sceneRect.x / size), y: Math.floor(canvas.dimensions.sceneRect.y / size),
        w: Math.floor(canvas.dimensions.sceneRect.width / size), h: Math.floor(canvas.dimensions.sceneRect.height / size),
    };
    const { w, h } = me.rect;
    const footprint = (x, y) => rectSquares({ x, y, w, h });
    const inScene = (x, y) => x >= rect.x && y >= rect.y && x + w <= rect.x + rect.w && y + h <= rect.y + rect.h;
    const backend = CONFIG.Canvas.polygonBackends?.move;
    const closedDoors = (scene.walls?.contents ?? [...(scene.walls ?? [])]).filter((wl) => wl.door && wl.ds === 0)
        .map((wl) => ({ a: { x: wl.c[0] / size, y: wl.c[1] / size }, b: { x: wl.c[2] / size, y: wl.c[3] / size } }));
    // A move goes through a closed door when its line properly crosses the door (touching a door's end doesn't count,
    // so a diagonal can't slip past the wall where it meets the door). Cached per edge: pathfinding asks a lot.
    const doorCache = new Map();
    const doorBetween = (x1, y1, x2, y2) => {
        if (!closedDoors.length) return false;
        const k = `${x1},${y1}>${x2},${y2}`;
        let v = doorCache.get(k);
        if (v === undefined) {
            const a = { x: x1 + w / 2, y: y1 + h / 2 }, b = { x: x2 + w / 2, y: y2 + h / 2 };
            const lo = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) }, hi = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) };
            v = closedDoors.some((d) => Math.max(d.a.x, d.b.x) >= lo.x && Math.min(d.a.x, d.b.x) <= hi.x && Math.max(d.a.y, d.b.y) >= lo.y && Math.min(d.a.y, d.b.y) <= hi.y
                && segmentsCrossProperly(a, b, d.a, d.b));
            doorCache.set(k, v);
        }
        return v;
    };
    board.doorBetween = doorBetween;
    const centerPx = (x, y) => ({ x: (x + w / 2) * size, y: (y + h / 2) * size });
    // Flying passes over ground terrain; blinded, normal terrain counts as difficult
    const ground = move.ignoresDifficult || ignoresDifficultTerrain(actor) || move.stride.speed === "fly" ? () => 1 : terrainReader(scene, size, { climb: !!speedsOf(actor)?.climb, z: me.rect.z });
    board.terrainNoteAt = move.stride.speed === "fly" ? () => [] : terrainNotes(scene, size, me.rect.z);
    const terrain = me.conditions.has("blinded") ? (x, y) => Math.max(2, ground(x, y)) : ground;
    if (typeof reactionsSeen === "function") for (const e of board.enemies) e.reactions = e.reactions.filter((r) => reactionsSeen(e, r));
    const threatsAt = (x, y, z = me.rect.z) => {
        const at = { x, y, w, h, z, ht: me.rect.ht, lvl: me.rect.lvl };
        return board.enemies.filter((e) => e.reactions.some((r) => r.trigger.onMove) && inReach(e.rect, at, e.reach)).map((e) => e.id);
    };
    const maxFeet = Math.min(move.stride.speed === "fly" ? 240 : 150, 3 * Math.max(move.stride.feet, move.step.feet, 5));
    // Tiny creatures can move into and stop in a bigger creature's space (they have to, to attack with no reach)
    const tiny = me.sizeRank === 0 || me.traits?.includes("swarm"); // swarms share spaces too
    const common = {
        start: me.rect, maxFeet,
        canEnter: (x, y) => inScene(x, y) && (tiny || footprint(x, y).every((k) => !blockers.has(k))),
        canEnd: (x, y) => footprint(x, y).every((k) => !occupant.has(k) || (tiny && (occupant.get(k).sizeRank ?? 2) > 0)),
        blocked: (x1, y1, x2, y2) => {
            let hit = false;
            try { hit = !!backend?.testCollision({ ...centerPx(x1, y1), elevation: me.rect.z }, { ...centerPx(x2, y2), elevation: me.rect.z }, { type: "move", mode: "any", ...lvlCfg }); } catch { hit = false; }
            return hit && !doorBetween(x1, y1, x2, y2);
        },
        // Opening the door on the way costs an action, and ends the Stride it was on: round up to the end of that
        // Stride, add one Stride's worth for the Interact, and the next square starts a new Stride
        edgeFeet: (x1, y1, x2, y2, feet) => {
            if (!doorBetween(x1, y1, x2, y2)) return 0;
            const S = Math.max(5, move.stride.feet);
            return Math.ceil(feet / S) * S - feet + S;
        },
        costAt: terrain,
        threats: threatsAt,
    };
    board.threatsAt = threatsAt;
    board.field = {
        safe: movementField({ ...common, noReactions: move.stride.noReactions, noReactionsUpTo: move.stride.noReactionsUpTo ?? null, avoid: "safe" }),
        // The shortest way, for saying which reactions the safe way goes around
        fast: move.stride.noReactions ? null : movementField({ ...common, noReactions: false, noReactionsUpTo: move.stride.noReactionsUpTo ?? null, avoid: "fast" }),
        step: movementField({ ...common, maxFeet: move.step.feet, noReactions: true, avoid: "fast", flatDiagonals: true, costAt: (x, y) => (terrain(x, y) > 1 ? 99 : 1), edgeFeet: (x1, y1, x2, y2) => (doorBetween(x1, y1, x2, y2) ? 999 : 0) }),
    };
    // Step, then Stride: when it stands in someone's reach, the Step squares that leave every reaction behind, and
    // the ground reachable from the best two of them (a Step costs an action but provokes nothing). Thinking
    // creatures and animals alike know to back off before they run.
    board.field.stepThen = [];
    if (!move.stride.noReactions && move.step.feet > 0 && threatsAt(me.rect.x, me.rect.y).length && maxFeet > move.stride.feet) {
        const outs = [...board.field.step.values()].filter((c) => c.end && !(c.x === me.rect.x && c.y === me.rect.y) && threatsAt(c.x, c.y).length === 0);
        // Prefer the squares farthest from the foes in reach now
        const near = board.enemies.filter((e) => threatsAt(me.rect.x, me.rect.y).includes(e.id));
        const r = (c) => ({ x: c.x, y: c.y, w: me.rect.w, h: me.rect.h, z: me.rect.z ?? 0 });
        outs.sort((a, b) => Math.min(...near.map((e) => feetBetween(e.rect, r(b)))) - Math.min(...near.map((e) => feetBetween(e.rect, r(a)))));
        for (const sq of outs.slice(0, 2)) {
            const f = movementField({ ...common, start: { ...me.rect, x: sq.x, y: sq.y }, maxFeet: maxFeet - move.stride.feet, noReactions: false, noReactionsUpTo: move.stride.noReactionsUpTo ?? null, avoid: "safe" });
            board.field.stepThen.push({ sq, field: f });
        }
    }
    board.occupant = occupant;
    // Ramps, slopes, paths and stairs cut into a bank (regions so named, spanning two heights): the way up or down on foot
    board.ramps = rampsOf(scene, board.field.safe, size, me.rect);
    // Stairs and ladders to another level (Change Level regions), with the squares of them it can reach
    board.stairs = [];
    if (lvlDoc && (scene.levels?.size ?? 0) > 1) {
        for (const r of scene.regions?.contents ?? []) {
            if (!(r.behaviors ?? []).some((b) => b.type === "changeLevel" && !b.disabled)) continue;
            const lv = [...(r.levels ?? [])];
            if (!lv.includes(me.rect.lvl)) continue;
            const to = lv.filter((l) => l !== me.rect.lvl && scene.levels.get(l));
            if (!to.length) continue;
            const bottom = Number.isFinite(r.elevation?.bottom) ? r.elevation.bottom : -Infinity;
            const top = Number.isFinite(r.elevation?.top) ? r.elevation.top : Infinity;
            const e = Math.min(Math.max(me.rect.z, bottom), top - 1);
            const cells = [];
            for (const c of board.field.safe.values()) {
                try { if (r.testPoint?.({ x: (c.x + w / 2) * size, y: (c.y + h / 2) * size, elevation: e })) cells.push(c); } catch { /* skip */ }
            }
            if (!cells.length) continue;
            board.stairs.push({ name: String(r.name ?? "").replace(/\s*\([^)]*\).*$/, "").trim(), ladder: /\b(ladder|rope|hatch|trapdoor)\b/i.test(r.name ?? ""), to, cells,
                z: Object.fromEntries(to.map((l) => [l, scene.levels.get(l)?.elevation?.bottom ?? 0])), names: Object.fromEntries(to.map((l) => [l, scene.levels.get(l)?.name ?? "another floor"])) });
        }
    }
    // Where a Shove would put a foe: a wall stops it; hazardous terrain hurts; off the top of an incline, it falls
    const hazards = (scene.regions?.contents ?? []).flatMap((r) => (r.behaviors ?? []).filter((b) => b.type === "pf2e-terrains.hazardousTerrain" && !b.disabled)
        .map((b) => ({ region: r, formula: String(b.system?.formula ?? ""), avg: averageOf(String(b.system?.formula ?? "")) })).filter((x) => x.avg > 0));
    const inRegion = (r, x, y, elevation) => { try { return !!r.testPoint?.({ x: (x + 0.5) * size, y: (y + 0.5) * size, elevation }); } catch { return false; } };
    board.pushInto = (hazards.length || board.inclines.length) ? (t, dx, dy) => {
        const r = t.rect;
        const z = r.z ?? 0;
        const out = {};
        const own = rectSquares(r).map((q) => q.split(",").map(Number));
        let x = r.x, y = r.y, ok = true;
        for (const [k, n] of [["s", 1], ["cs", 2]]) {
            if (!ok) break;
            // Over the edge on the first 5 feet: a critical success can stop there
            if (k === "cs" && out.s?.fall) { out.cs = out.s; break; }
            while (ok && (Math.abs(x - r.x) < n && Math.abs(y - r.y) < n)) {
                const nx = x + dx, ny = y + dy;
                const from = { x: (x + r.w / 2) * size, y: (y + r.h / 2) * size, elevation: z }, to = { x: (nx + r.w / 2) * size, y: (ny + r.h / 2) * size, elevation: z };
                let hit = false;
                try { hit = !!backend?.testCollision(from, to, { type: "move", mode: "any", ...lvlCfg }); } catch { hit = false; }
                const taken = rectSquares({ x: nx, y: ny, w: r.w, h: r.h }).some((q) => occupant.has(q) && occupant.get(q).id !== t.id);
                if (hit || taken) { ok = false; break; }
                x = nx; y = ny;
            }
            if (!ok) break;
            const feet = rectSquares({ x, y, w: r.w, h: r.h }).map((q) => q.split(",").map(Number));
            // Off the edge: onto an incline face that drops away below where it stood
            const face = board.inclines.find((i) => i.top >= z - 1 && i.bottom <= z - 10 && !rectSquares(r).some((q) => { const [a, b] = q.split(",").map(Number); return inRegion(i.region, a, b, Math.max(i.bottom, z - 5)); })
                && feet.some(([a, b]) => inRegion(i.region, a, b, Math.max(i.bottom, z - 5))));
            const fall = face ? z - Math.max(face.bottom, board.floorZ ?? -Infinity) : 0;
            const lz = fall ? z - fall : z;
            const hz = hazards.filter((hd) => feet.some(([a, b]) => inRegion(hd.region, a, b, lz)) && !own.some(([a, b]) => inRegion(hd.region, a, b, z))).sort((u, v) => v.avg - u.avg)[0] ?? null;
            if (!fall && !hz) { out[k] = null; continue; }
            const dmg = (fall ? Math.floor(fall / 2) : 0) + (hz?.avg ?? 0);
            const why = [fall ? `off the edge, a ${fall}-foot drop (${Math.floor(fall / 2)} bludgeoning, lands prone)` : null, hz ? `into ${((n) => (!n ? "the hazardous terrain" : /^the\b/i.test(n) ? n : `the ${n}`))(String(hz.region.name ?? "").replace(/\s*\([^)]*\)/g, "").trim())} (${hz.formula})` : null].filter(Boolean).join(", and ");
            out[k] = { dmg, fall, prone: fall > 0, why };
        }
        return out.s || out.cs ? out : null;
    } : null;
    return board;
}

/** Regions named like a ramp, slope, path, trail or stairs (not an incline face, not stairs to another level) that span
 *  at least 10 feet of height, each with the squares of the movement field that lie in it. */
const RAMP_NAME = /\b(ramps?|slopes?|paths?|trails?|stairs?|stairways?|steps|switchbacks?|collapse|breach)\b/i;
function rampsOf(scene, field, size, me) {
    if (!field) return [];
    const out = [];
    for (const r of scene.regions?.contents ?? []) {
        if (!RAMP_NAME.test(r.name ?? "")) continue;
        if ((r.behaviors ?? []).some((b) => !b.disabled && ["pf2e-terrains.inclines", "changeLevel", "pf2e-terrains.hazardousTerrain"].includes(b.type))) continue;
        // Its bottom and top must be set (a region left at the default spans every height, and isn't a ramp)
        const bottom = r.elevation?.bottom, top = r.elevation?.top;
        if (!Number.isFinite(bottom) || !Number.isFinite(top) || top - bottom < 10) continue;
        const e = Math.min(Math.max(me.z ?? 0, bottom), top - 1);
        const cells = [];
        for (const c of field.values()) {
            try { if (r.testPoint?.({ x: (c.x + me.w / 2) * size, y: (c.y + me.h / 2) * size, elevation: e })) cells.push(c); } catch { /* skip */ }
        }
        // Rubble or a steep path: difficult terrain on the way along it
        let mult = 1;
        for (const b of r.behaviors ?? []) {
            if (b.disabled) continue;
            if (b.type === "environmentFeature") { const lv = Number(b.system?.terrain?.difficult ?? 0); mult = Math.max(mult, lv >= 2 ? 3 : lv >= 1 ? 2 : 1); }
            if (b.type === "modifyMovementCost" || b.type === "pf2e-toolbelt.difficult-terrain") { const d = b.system?.difficulties ?? {}; mult = Math.max(mult, Number(d.walk ?? d.land ?? Object.values(d)[0] ?? 1) || 1); }
        }
        // Its name without the GM's note in brackets: "The collapse (difficult terrain)" is "The collapse"
        const label = String(r.name ?? "").replace(/\s*\([^)]*\)/g, "").trim() || "ramp";
        if (cells.length) out.push({ name: label, bottom, top, cells, mult });
    }
    return out;
}
// ---------------------------------------------------------------------------------------------

export { HP_AT_TURN, LAST_TARGET, RECENT, RIDERS, areaTest, averageOf, centerOf, coverBetween, damageAgainst, degreeChances, feetBetween, flanks, flatCheck, flatFor, gapSquares, healUse, heightOf, inReach, isDown, itemSpellsOf, learnK, learnedAcBounds, mapFor, movementField, movementOptions, pct, profileAbility, profileItem, profilesOf, readBoard, readDescription, readMovementPassive, readRecharge, rectInArea, round1, saveExpected, segmentsCrossProperly, speedsOf, spellEffects, strikeExpected, stripTags, sustainOf, tokenStandIn, verticalGap, viciousIn, visibilityOf, withVisioner };
