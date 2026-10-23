/**
 * PF2e NPC Tactics: card.mjs
 * Trigger lines, the card, the window, chat cards, notes and the path drawn on the GM's canvas.
 * One module, several files: see pf2e-tactics.mjs for the whole.
 */
import { FLAG_SCOPE, LEGACY_MODULE, LEGACY_OLDER, MODULE_ID, POSITION_KEY, baseActorOf, cap, costGlyph, esc, link, section, setting, signed, ul, flagOf, OLD_ID } from "./shared.mjs";
import { RIDERS, feetBetween, profilesOf, readBoard, round1, stripTags, tokenStandIn, visibilityOf, withVisioner } from "./reader.mjs";
import { RUN_WORDS, TIER_TEXT, nameOf, planTurn, tierOf } from "./advisor.mjs";
import { adjustLedger, editThreat, ledgerFor, ledgerTotals, sustainNow, threatOn, turnHtml } from "./state.mjs";

// Triggers: "Trigger: <who>, <condition>: <what happens>" lines in tactics and notes.
// Parsing is pure; checking reads the combat.
// ---------------------------------------------------------------------------------------------
const FRACTIONS = { half: 0.5, "a half": 0.5, "a third": 1 / 3, "one third": 1 / 3, "a quarter": 0.25, "one quarter": 0.25, "a fourth": 0.25, "three quarters": 0.75, "two thirds": 2 / 3 };

/** Text of one line of HTML, entities and all ("Valeros&#39;s" is "Valeros's"). */
function plainLine(html) {
    const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "\u2019", lsquo: "\u2018", ldquo: "\u201c", rdquo: "\u201d", ndash: "\u2013", mdash: "\u2014" };
    return String(html ?? "").replace(/<[^>]+>/g, " ")
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
        .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m)
        .replace(/\s+/g, " ").trim();
}

/** Trigger lines from HTML or plain text. */
function parseTriggers(source) {
    const html = String(source ?? "");
    const lines = html.split(/<\/p>|<br\s*\/?>|<\/li>|\n/i).map(plainLine).filter(Boolean);
    const out = [];
    for (const line of lines) {
        const m = /^\s*(?:\*\*)?trigger(?:\*\*)?\s*[:.]\s*(?:\*\*)?\s*(.+)$/i.exec(line);
        if (!m) continue;
        const body = m[1].trim();
        const colon = body.indexOf(":");
        const left = colon >= 0 ? body.slice(0, colon).trim() : body;
        const then = colon >= 0 ? body.slice(colon + 1).trim() : "";
        const comma = left.indexOf(",");
        const who = comma >= 0 ? left.slice(0, comma).trim() : null;
        const cond = (comma >= 0 ? left.slice(comma + 1) : left).trim();
        out.push({ raw: line.trim(), who, cond, then, test: parseCondition(cond) });
    }
    return out;
}

// "out" as in out of the fight, not "out of reach"; "taken" as in taken down, not "taken hostage"
const DOWN_WORDS = "down|dying|dead|defeated|unconscious|killed|out(?! of (?!(?:the fight|action|commission|the running)\\b))|taken(?! (?:to|by|away|aback|hostage|prisoner|captive|in|from|off)\\b)";
const DOWN_RE = new RegExp(`^(.+?)\\s+(?:is|are|goes|falls|drops|gets)\\s+(?:knocked\\s+)?(${DOWN_WORDS})\\b`);
const ALLIES_DOWN_RE = new RegExp(`^(half|most|two|three|all)\\b(?: of)?(?: (?:its|their|his|her|the|them))?(?: [\\w'-]+)?\\s+(?:are |is )?(down|defeated|dead|fallen|gone|killed|out(?! of (?!(?:the fight|action)\\b)))\\b`);
/** A condition with two clauses ("X is down while Y is still on the bridge") is more than the tests below can judge. */
const COMPOUND_RE = /\s+(?:while|and|but|unless|as long as|provided|except|or|until|before|after)\s+(?=\S)/;

function parseCondition(cond) {
    const c = cond.toLowerCase().replace(/[.;]+$/, "").trim().replace(/^(?:when|if|once|as soon as)\s+/, "");
    // Two clauses: never fire on the first alone. The GM watches for it, with the chip saying why.
    if (COMPOUND_RE.test(c) && !/^\S+ (?:and|or) \S+ (?:is|are) /.test(c)) return { type: "manual", compound: true };
    let m;
    if ((m = /\b(below|under|at or below|at most|less than)\s+(\d+)\s*(?:hp|hit points)\b/.exec(c)) && !/^(?!(?:below|under|at|less|drops|falls|is|it|she|he|they)\b)(\S+.*?)\s+(?:is |drops |falls )?(below|under)/.test(c)) {
        return { type: "hp", value: Number(m[2]), inclusive: /at or below|at most/.test(m[1]) };
    }
    if ((m = /\b(below|under|at or below)\s+(half|a half|a third|one third|a quarter|one quarter|a fourth|three quarters|two thirds|(\d+)\s*%)/.exec(c)) && /^(?:it |she |he |they )?(?:drops |falls |is |gets )?(below|under|at)/.test(c)) {
        return { type: "fraction", value: m[3] ? Number(m[3]) / 100 : FRACTIONS[m[2]], inclusive: /at or below/.test(m[1]) };
    }
    if ((m = ALLIES_DOWN_RE.exec(c))) {
        const v = { half: 0.5, most: 0.6, two: 2, three: 3, all: 1 }[m[1]];
        return { type: "allies-down", value: v, count: v >= 2 };
    }
    if ((m = DOWN_RE.exec(c))) {
        // "one tough is down": any of them will do; "the pack leader is down": all that match
        const any = /^(?:one|a|an|any|either)\s+(?:of the\s+)?/.exec(m[1]);
        return { type: "down", name: m[1].replace(/^(?:one|a|an|any|either)\s+(?:of the\s+)?/, "").replace(/^the\s+/, "").trim(), any: !!any };
    }
    if ((m = /^(.+?)\s+(?:is |drops |falls )?(below|under)\s+(half|a third|a quarter|three quarters|(\d+)\s*%|(\d+)\s*(?:hp|hit points))/.exec(c))) {
        const value = m[5] ? Number(m[5]) : m[4] ? Number(m[4]) / 100 : FRACTIONS[m[3]];
        return { type: "other-hp", name: m[1].replace(/^the\s+/, "").trim(), value, absolute: !!m[5] };
    }
    if ((m = /\b(from|after|by|on|at the start of|start of)?\s*round\s+(\d+)\b/.exec(c))) {
        return { type: "round", value: Number(m[2]) + (m[1] === "after" ? 1 : 0) };
    }
    if (/\b(alone|last one standing|last standing|only one left|no allies (?:left|standing)|all (?:its|their|his|her) allies (?:are )?(?:down|dead|defeated|gone))\b/.test(c)) return { type: "alone" };
    return { type: "manual" };
}

const lc = (s) => String(s ?? "").toLowerCase().trim();
function nameMatches(who, names) {
    const w = lc(who).replace(/^the\s+/, "");
    if (!w) return false;
    // Whole words, hyphens split, plurals folded: "the wolves" finds "Dire Wolf 2", "pack leader" finds
    // "Dire Wolf Pack Leader"; "Goblin Commando" doesn't find "Goblin Pyro"
    const one = (x) => x.replace(/ves$/, "f").replace(/(?<=[a-z]{3})s$/, "");
    const words = (t) => ` ${t.replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim().split(" ").map(one).join(" ")} `;
    return names.filter(Boolean).map(lc).some((n) => n === w || words(n).includes(words(w)) || w.startsWith(n));
}
/** Every name a creature goes by: its token's, its own, and (for an unlinked token) its world actor's. */
function namesOf(actor, token) {
    const base = actor?.isToken ? game.actors?.get?.(actor.id) : null;
    return [token?.name, actor?.name, actor?.prototypeToken?.name, base?.name, base?.prototypeToken?.name];
}

/** Combatants (or tokens on the scene) whose name matches. */
function findByName(name, combat) {
    const pool = combat?.combatants?.contents?.length ? combat.combatants.contents.map((c) => ({ actor: c.actor, token: c.token, combatant: c }))
        : (canvas?.tokens?.placeables ?? []).map((t) => ({ actor: t.actor, token: t.document, combatant: null }));
    return pool.filter((p) => p.actor && nameMatches(name, namesOf(p.actor, p.token)));
}

/** Does this trigger belong to this creature? A name that matches nobody in the fight applies to everyone. */
function triggerApplies(t, actor, token, combat) {
    if (!t.who) return true;
    if (nameMatches(t.who, namesOf(actor, token))) return true;
    return !findByName(t.who, combat).length;
}

function hpOf(actor) {
    const hp = actor?.hitPoints ?? actor?.system?.attributes?.hp ?? {};
    return { value: Number(hp.value) || 0, max: Number(hp.max) || 1 };
}
function downOf(entry) {
    if (!entry?.actor) return false;
    if (entry.combatant?.isDefeated) return true;
    return hpOf(entry.actor).value <= 0 || !!entry.actor.statuses?.has?.("dead") || !!entry.actor.statuses?.has?.("unconscious");
}

/** "now" (true), "watch" (checked, not yet true) or "manual" (the GM watches for it). */
function checkTrigger(t, actor, token, combat) {
    const test = t.test;
    const hp = hpOf(actor);
    switch (test.type) {
        case "hp": return (test.inclusive ? hp.value <= test.value : hp.value < test.value) ? "now" : "watch";
        case "fraction": return (test.inclusive ? hp.value <= hp.max * test.value : hp.value < hp.max * test.value) ? "now" : "watch";
        case "down": {
            const found = findByName(test.name, combat);
            if (!found.length) return "manual";
            return (test.any ? found.some(downOf) : found.every(downOf)) ? "now" : "watch";
        }
        case "other-hp": {
            const found = findByName(test.name, combat);
            if (!found.length) return "manual";
            return found.some((f) => {
                const h = hpOf(f.actor);
                return test.absolute ? h.value < test.value : h.value < h.max * test.value;
            }) ? "now" : "watch";
        }
        case "round": return combat?.started && combat.round >= test.value ? "now" : "watch";
        case "alone":
        case "allies-down": {
            if (!combat) return "manual";
            const mine = combat.combatants.filter((c) => c.actor && c.actor !== actor && c.token?.id !== token?.id
                && (actor.isAllyOf?.(c.actor) ?? c.actor.alliance === actor.alliance));
            if (!mine.length) return "manual"; // never had allies in this fight: the GM judges it
            const down = mine.filter((c) => downOf({ actor: c.actor, combatant: c })).length;
            if (test.type === "alone") return down === mine.length ? "now" : "watch";
            if (test.count) return down >= test.value ? "now" : "watch";
            return down / mine.length >= test.value ? "now" : "watch";
        }
        default: return "manual";
    }
}

/** What the advisor should do when a trigger is live: leave the fight, or stop and talk. */
function intentFrom(allLive) {
    // A trigger naming this creature outranks one for the whole encounter
    const named = allLive.filter((t) => t.who);
    const live = named.length ? named : allLive;
    for (const t of live) {
        if (/\b(surrenders?|gives? up|yields?|bargains?|begs?|parley)\b/i.test(t.then)) return { stop: true, text: t.then };
    }
    for (const t of live) if (RUN_WORDS.test(t.then)) return { run: true, text: t.then };
    return null;
}
// ---------------------------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------------------------
const SOURCES = [];

/** Another module can supply tactics text for an actor: get(actor, token) -> [{ title, html }]. */
function registerSource(source) {
    if (!source?.id || typeof source.get !== "function") throw new Error(`${MODULE_ID} | registerSource needs { id, get }`);
    const i = SOURCES.findIndex((s) => s.id === source.id);
    if (i >= 0) SOURCES.splice(i, 1, source);
    else SOURCES.push(source);
    refreshSoon(100); // a source that loads late (after a combat was already running) still shows up
}

function tacticsOf(actor, token) {
    const out = [];
    for (const s of SOURCES) {
        try { for (const t of s.get(actor, token) ?? []) if (t?.html) out.push({ title: t.title ?? s.label ?? s.id, html: t.html }); } catch (err) { console.warn(`${MODULE_ID} | tactics source ${s.id} failed`, err); }
    }
    const base = baseActorOf(actor);
    for (const t of flagOf(actor, "tactics") ?? flagOf(base, "tactics") ?? []) if (t?.html) out.push({ title: t.title ?? "Tactics", html: t.html });
    return out;
}

/** Your notes: this module's flag, or the ones an older campaign module kept. */
function notesOf(actor) {
    return flagOf(actor, "notes") ?? actor?.flags?.[LEGACY_MODULE]?.notes ?? actor?.flags?.[LEGACY_OLDER]?.tactics ?? "";
}

/** Every trigger for this creature, with its state now. */
function triggersFor(actor, token, combat = game.combat) {
    const base = baseActorOf(actor);
    const texts = [...tacticsOf(actor, token).map((t) => t.html), String(notesOf(base) ?? "")]; // notes are plain text; escaped when shown
    const seen = new Set();
    const out = [];
    for (const text of texts) {
        for (const t of parseTriggers(text)) {
            if (seen.has(t.raw) || !triggerApplies(t, actor, token, combat)) continue;
            seen.add(t.raw);
            out.push({ ...t, state: checkTrigger(t, actor, token, combat) });
        }
    }
    return out;
}

/** Tactics without their Trigger paragraphs and list items (they're shown in Triggers instead). */
const withoutTriggerLines = (html) => String(html ?? "").replace(/<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi,
    (all, tag, inner) => (/^\W*trigger\W*[:.]/i.test(plainLine(inner)) ? "" : all));

// --- Recharge ----------------------------------------------------------------------------------
function rechargeLeft(actor, itemId) {
    const combat = game.combat;
    if (!combat) return 0;
    let left = 0;
    for (const scope of [FLAG_SCOPE, OLD_ID, LEGACY_MODULE]) {
        const entry = actor?.flags?.[scope]?.recharge?.[itemId];
        if (entry && entry.combatId === combat.id) { left = Math.max(0, Number(entry.readyRound) - Number(combat.round || 0)); break; }
    }
    // PF2e Workbench's recharge reminder: a "Used <ability>" effect whose duration is the recharge it rolled
    // The first roll is the real one (posting the card again makes Workbench roll again)
    const used = usedEffects(actor, actor?.items?.get?.(itemId)).filter((e) => !e.remainingDuration?.expired && Number.isFinite(Number(e.remainingDuration?.remaining)))
        .sort((a, b) => (a._stats?.createdTime ?? 0) - (b._stats?.createdTime ?? 0))[0];
    if (used) left = Math.max(left, Math.ceil((Number(used.remainingDuration.remaining) || 0) / 6));
    return left;
}

/** The "Used <ability>" effects PF2e Workbench puts on a creature for a recharge ability it used. */
function usedEffects(actor, item) {
    if (!actor || !item?.name) return [];
    let prefix = "Used ";
    try { const l = game.i18n?.localize?.("xdy-pf2e-workbench.SETTINGS.reminderBreathWeapon.used"); if (l && !l.startsWith("xdy-")) prefix = l; } catch { /* English */ }
    const name = item.name.toLowerCase();
    const want = [`${prefix}${item.name}`, `used ${item.name}`].map((x) => x.toLowerCase().trim());
    return (actor.itemTypes?.effect ?? []).filter((e) => {
        const n = String(e.name ?? "").toLowerCase().trim();
        return want.includes(n) || (String(e.system?.slug ?? "").startsWith("xdy-breath-weapon-reminder") && n.endsWith(name));
    });
}

/** PF2e Workbench rolls recharges itself ("Recharge reminder"): then NPC Tactics reads its effect instead of rolling too. */
const workbenchRecharge = () => {
    try { return !!game.modules.get("xdy-pf2e-workbench")?.active && !!game.settings.get("xdy-pf2e-workbench", "reminderBreathWeapon"); } catch { return false; }
};

function frequencyText(item) {
    const f = item.system?.frequency;
    if (!f?.max) return "";
    const PER = { turn: "turn", round: "round", PT1M: "minute", PT10M: "10 minutes", PT1H: "hour", PT24H: "day", day: "day", P1W: "week", P1M: "month", P1Y: "year" };
    const left = typeof f.value === "number" ? `, ${f.value} left` : "";
    return ` <em>(${f.max}/${PER[f.per] ?? f.per}${left})</em>`;
}

// --- Sections ------------------------------------------------------------------------------------
function statusLine(actor) {
    const hp = actor.hitPoints ?? actor.system?.attributes?.hp ?? {};
    const pctHp = hp.max ? Math.round((100 * hp.value) / hp.max) : null;
    const cls = pctHp === null ? "" : pctHp <= 25 ? "npt-hp-low" : pctHp <= 50 ? "npt-hp-mid" : "";
    const saves = ["fortitude", "reflex", "will"].map((s) => actor.saves?.[s]?.mod).filter((v) => typeof v === "number");
    const conditions = (actor.conditions?.active ?? []).map((c) => (c.value && !new RegExp(`\\b${c.value}$`).test(c.name) ? `${c.name} ${c.value}` : c.name));
    const parts = [
        `<strong class="${cls}">HP ${hp.value ?? "?"}/${hp.max ?? "?"}</strong>${pctHp !== null && pctHp < 100 ? ` (${pctHp}%)` : ""}`,
        actor.armorClass ? `AC ${actor.armorClass.value}` : null,
        ...(saves.length === 3 ? [`Fort ${signed(saves[0])}`, `Ref ${signed(saves[1])}`, `Will ${signed(saves[2])}`] : []),
        actor.perception ? `Per ${signed(actor.perception.mod)}` : null,
    ].filter(Boolean);
    return `<div class="npt-stats">${parts.join(" · ")}</div>` + (conditions.length ? `<div class="npt-stats npt-dim">${esc(conditions.join(", "))}</div>` : "");
}

// --- Panels: a header strip, then cards with a coloured left edge, styled like Campaign Trackers ------
const ABBREVIATIONS = { hp: "HP", ac: "AC", dc: "DC", gm: "GM", pc: "PC", pcs: "PCs", npc: "NPC" };
const SMALL_WORDS = new Set(["a", "an", "the", "and", "but", "or", "nor", "for", "so", "yet", "at", "by", "in", "of", "on", "to", "as", "from", "with", "into", "via", "vs"]);
/** Title case for card titles ("The Board", "Always On", "Close and Strike Valeros"). Only ever raises a first letter. */
function titleCase(text) {
    const words = String(text ?? "").split(" ");
    if (words.length > 8) return String(text ?? ""); // a sentence, not a title
    return words.map((w, i) => {
        const bare = w.replace(/^[^\p{L}]+/u, "");
        if (!bare) return w;
        const edge = i === 0 || i === words.length - 1 || /[:.!?]$/.test(words[i - 1] ?? "");
        const word = bare.toLowerCase().replace(/[^\p{L}]+$/u, "");
        const k = w.length - bare.length;
        if (ABBREVIATIONS[word]) return w.slice(0, k) + ABBREVIATIONS[word] + bare.slice(word.length);
        if (!edge && SMALL_WORDS.has(word)) return w;
        return w.slice(0, k) + bare.charAt(0).toUpperCase() + bare.slice(1);
    }).join(" ");
}

/** The Show button for a plan that moves (its path) or aims an area (its point); drawn on this client's map only. */
function showButton(plan) {
    if (!plan?.dest && !plan?.aim) return "";
    return `<button type="button" class="npt-show" data-npt-show="${esc(JSON.stringify(plan.dest ?? plan.aim))}" data-npt-path="${esc(JSON.stringify(plan.path ?? []))}" data-npt-kind="${plan.dest ? "square" : "point"}" data-tooltip="Draw the path on your map (only you see it). Click again to hide it."><i class="fa-solid fa-location-crosshairs"></i> Show</button>`;
}

/** Which cards are open: kept per GM in this browser, the way each was left. The Turn Helper's folds ("h-" keys) last only
 *  for the turn: each turn starts from the defaults (Your Turn open, the rest folded). */
const FOLD_KEY = `${MODULE_ID}.folds`;
const TURN_FOLDS = new Map();
function resetTurnFolds() { TURN_FOLDS.clear(); }
function foldOpen(key, fallback) {
    if (String(key).startsWith("h-")) return TURN_FOLDS.get(key) ?? fallback;
    try {
        const v = JSON.parse(localStorage.getItem(FOLD_KEY) ?? "{}")[key];
        return typeof v === "boolean" ? v : fallback;
    } catch { return fallback; }
}
function saveFold(key, open) {
    if (String(key).startsWith("h-")) return void TURN_FOLDS.set(key, open);
    try {
        const all = JSON.parse(localStorage.getItem(FOLD_KEY) ?? "{}");
        all[key] = open;
        localStorage.setItem(FOLD_KEY, JSON.stringify(all));
    } catch { /* private window or blocked storage */ }
}

/** A card: title, a one-line summary, buttons, and a body. With a key and a body it folds. title and sum are HTML. */
function panel(title, { key = null, sum = "", body = "", cls = "", open = false, tools = "" } = {}) {
    const head = `<h4>${title}</h4>${sum ? `<span class="npt-sum">${sum}</span>` : ""}${tools ? `<span class="npt-tools">${tools}</span>` : ""}`;
    if (key && body) {
        return `<details class="npt-panel ${cls}" data-npt-fold="${esc(key)}"${foldOpen(key, open) ? " open" : ""}><summary><span class="npt-chev"></span>${head}</summary><div class="npt-pbody">${body}</div></details>`;
    }
    return `<section class="npt-panel ${cls}"><header>${head}</header>${body ? `<div class="npt-pbody">${body}</div>` : ""}</section>`;
}

const clip = (text) => String(text ?? "").trim().replace(/[.!;:]+$/, "");
const firstSentence = (text) => String(text ?? "").replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0] ?? "";
const minus = (s) => String(s).replace(/-/g, "−");

const TIER_NAME = ["Instinct", "Crude", "Tactical", "Shrewd", "Sharp"];
/** How it picks targets, as a chip by its name. */
function tierChip(actor) {
    if (!actor || actor.type === "hazard" || actor.hasPlayerOwner) return "";
    const me = { mindless: actor.traits?.has?.("mindless") ?? false, int: actor.system?.abilities?.int?.mod ?? 0 };
    const t = tierOf(me);
    return `<span class="npt-chip npt-tier" data-tooltip="${esc(TIER_TEXT[t])}">${TIER_NAME[t]} · Int ${minus(signed(me.int))}</span>`;
}

/** Triggers true now: a card each, at the top. */
function triggerSection(triggers) {
    return triggers.filter((t) => t.state === "now")
        .map((t) => panel(`Now: ${esc(titleCase(`${t.who ? `${t.who}, ` : ""}${clip(t.cond)}`))}`, { cls: "npt-now", body: t.then ? `<p class="npt-now-text">${esc(cap(clip(t.then)))}</p>` : "" })).join("");
}
/** Triggers being watched (or to watch for), as chips. */
function watchChips(triggers) {
    const list = triggers.filter((t) => t.state !== "now");
    if (!list.length) return "";
    return `<div class="npt-chips">${list.map((t) => `<span class="npt-chip${t.state === "manual" ? " npt-manual" : ""}" data-tooltip="${t.state === "watch" ? "Watched: whispered to you when it comes true" : t.test?.compound ? "Two conditions in one line: watch for this yourself" : "Watch for this yourself"}">${t.who ? `${esc(t.who)}, ` : ""}${esc(clip(t.cond))}${t.then ? `: ${esc(clip(t.then))}` : ""}</span>`).join("")}</div>`;
}

function stepsHtml(steps) {
    return `<ol class="npt-steps">${steps.map((s) => `<li>${s.cost ? `<span class="npt-cost">${s.cost > 3 ? "" : costGlyph(Math.min(3, s.cost))}</span>` : ""}<span>${esc(s.text)}</span></li>`).join("")}</ol>`;
}

/** The one-line summary on the turn's card: what the plan is worth, in its own terms. */
function adviceSum(plan) {
    const v = round1(plan.ev);
    if (["run", "advance", "hold", "none"].includes(plan.kind)) return "";
    if (plan.kind === "heal") {
        // The heal step says how much it restores ("about 12 HP"); its ev is that, discounted
        const hp = plan.steps.map((st) => /\babout (\d+) HP\b/.exec(st.text)?.[1]).find(Boolean);
        return `${hp ? `about ${hp} HP back` : "healing"}${plan.ownEv != null ? `, then about ${round1(plan.ev - plan.ownEv)} damage` : ""}`;
    }
    if (plan.kind === "buff") return `worth about ${v} damage to its side`;
    return `about ${v} damage`;
}

function adviceSection(plans, board, intent) {
    if (!board) return panel("Turn Advice", { cls: "npt-act", body: `<p class="npt-dim">Open this creature's scene to get advice from the board.</p>` });
    if (intent?.stop) {
        return panel("This Turn", { cls: "npt-act", body: `<p class="npt-now-text">${esc(intent.text)}</p><p class="npt-dim">A trigger says it stops fighting. Play it out in talk rather than Strikes.</p>` });
    }
    if (!plans.length) {
        const why = board.enemies.length ? "Nothing it has can reach an enemy this turn. Close the distance, take cover, or hold."
            : board.elsewhere?.length ? `Its foes (${board.elsewhere.map(nameOf).join(", ")}) are on another floor, out of sight. It takes the stairs or a ladder to them, or waits for them to come.`
            : "No one is left fighting it. Its tactics may say what it does now (flee, drag something off, stand guard).";
        return panel("Turn Advice", { cls: "npt-act", body: `<p class="npt-dim">${why}</p>` });
    }
    const best = plans[0];
    const why = [];
    if (best.target && best.kind !== "run" && best.kind !== "area") why.push(`${esc(nameOf(best.target))} AC ${best.target.ac}, HP ${best.target.hp}/${best.target.maxHp}`);
    if (best.why?.length) why.push(`<span class="npt-reason">${esc(best.why.join(", "))}</span>`);
    const showBtn = showButton(best);
    // A spell it can Sustain: one click uses PF2e's Sustain action for it (its card, the action counted, the advice redone)
    const sustainBtn = board.sustain && board.me?.actor?.uuid ? `<button type="button" class="npt-show npt-sustain" data-npt-sustain="${esc(board.me.actor.uuid)}" data-tooltip="${esc(`Sustain ${board.sustain.name}: posts PF2e's Sustain action for it, counts the action, and plans the rest of the turn`)}"><i class="fa-solid fa-hourglass-half"></i> Sustain</button>` : "";
    const notes = best.notes.length ? `<div class="npt-notes">${best.notes.map(esc).join(" · ")}</div>` : "";
    const seen = new Set([`${best.kind}|${best.target?.id ?? ""}|${best.title}`]);
    const alts = [];
    for (const p of plans.slice(1)) {
        const k = `${p.kind}|${p.target?.id ?? ""}`;
        if (seen.has(k) || seen.has(`${p.kind}|${p.target?.id ?? ""}|${p.title}`)) continue;
        if (alts.some((a) => a.title === p.title)) continue;
        seen.add(k);
        alts.push(p);
        if (alts.length >= 3) break;
    }
    const altHtml = alts.length ? `<details class="npt-alts" data-npt-fold="alts"${foldOpen("alts", false) ? " open" : ""}><summary>${alts.length} other option${alts.length === 1 ? "" : "s"}</summary><ul>${alts.map((p) => `<li>${esc(titleCase(p.title))}: about ${round1(p.ev)}${Math.abs((p.score ?? p.ev) - p.ev) > 1 ? `, <span class="npt-dim">worth ${round1(p.score)} here${p.risk ? ` after ${round1(p.risk)} of risk` : ""}</span>` : ""}${p.notes.length ? ` <span class="npt-dim">(${esc(p.notes[0])})</span>` : ""}</li>`).join("")}</ul></details>` : "";
    const body = stepsHtml(best.steps) + (why.length ? `<div class="npt-why">${why.join(" · ")}</div>` : "") + notes + altHtml;
    return panel(esc(titleCase(best.title)), { cls: "npt-act", sum: adviceSum(best), body, tools: sustainBtn + showBtn });
}

/** The board: who's near, the threat table, the softest save, the light, what's being watched. */
function boardLine(board, triggers = []) {
    if (!board?.enemies?.length) return "";
    const me = board.me.rect;
    const near = [...board.enemies].map((e) => ({ e, d: feetBetween(me, e.rect) })).sort((a, b) => a.d - b.d).slice(0, 4);
    const bits = near.map(({ e, d }) => {
        const r = e.reactions.filter((p) => p.trigger.onMove || p.trigger.onManipulate || p.trigger.onRanged).map((p) => p.name);
        const tags = [];
        if (e.hp / Math.max(1, e.maxHp) < 0.5) tags.push(`${e.hp} HP`);
        if (r.length) tags.push(`${r.join(", ")}, reach ${e.reach}`);
        if (e.conditions.has("off-guard") || e.conditions.has("prone")) tags.push("off-guard");
        if (e.objective) tags.push("what it's after");
        const up = (e.rect.z ?? 0) - (me.z ?? 0);
        if (Math.abs(up) >= 5) tags.unshift(`${Math.abs(up)} ft ${up > 0 ? "above" : "below"}`);
        return `${esc(nameOf(e))} ${d} ft${tags.length ? ` <span class="npt-dim">(${esc(tags.join("; "))})</span>` : ""}`;
    });
    const rows = [["Nearest", bits.join(" · ")]];
    const tab = board.threat ?? {};
    const th = board.enemies.map((e) => ({ e, v: Number(tab[e.id]) || 0 })).filter((x) => x.v >= 1).sort((a, b) => b.v - a.v).slice(0, 5);
    if (th.length) {
        const top = th[0].v;
        rows.push(["Threat", `<div class="npt-threat">${th.map((x) => `<span>${esc(nameOf(x.e))}</span><span class="npt-bar"><span style="width:${Math.max(4, Math.round((100 * x.v) / top))}%"></span></span><span class="npt-n">${Math.round(x.v)}</span>`).join("")}</div>`]);
    }
    // The party's softest save, for save abilities
    const hasSaves = board.profiles.some((p) => p.save) || board.spells.some((s) => s.save);
    if (hasSaves) {
        const avg = (s) => board.enemies.reduce((t, e) => t + (e.saves[s] ?? 0), 0) / board.enemies.length;
        const soft = ["fortitude", "reflex", "will"].map((s) => ({ s, v: avg(s) })).sort((a, b) => a.v - b.v)[0];
        rows.push(["Softest Save", `${cap(soft.s)} (average ${signed(Math.round(soft.v))})`]);
    }
    // Light where it stands, and who can't see it there
    const light = board.lightAt?.(me) ?? "bright";
    const seenAs = (e) => withVisioner(visibilityOf({ senses: e.senses, conditions: e.conditions }, { conditions: board.me.conditions }, light, feetBetween(me, e.rect)), board.visioner?.get?.(e.id)?.seen, true, board.me.conditions);
    if (light !== "bright" || board.visioner?.size) {
        const blind = board.enemies.filter((e) => e.senses && seenAs(e) !== "observed");
        if (light !== "bright" || blind.length) rows.push(["Light", `${light === "magical" ? "magical darkness" : light === "dark" ? "darkness" : light === "dim" ? "dim" : "bright"}${blind.length ? `; ${esc(blind.map((e) => `${nameOf(e)} (${seenAs(e)})`).join(", "))} can't see it clearly` : ""}`]);
    }
    // What Visioner says it can see of its foes (Hide, Sneak, Seek results), when that differs from plain sight
    if (board.visioner?.size) {
        const unseen = board.enemies.filter((e) => (board.visioner.get(e.id)?.state ?? "observed") !== "observed");
        if (unseen.length) rows.push(["Sight", `Visioner: ${esc(unseen.map((e) => `${nameOf(e)} is ${board.visioner.get(e.id).state}`).join(", "))}`]);
    }
    const chips = watchChips(triggers);
    if (chips) rows.push(["Watching", chips]);
    const sum = th.length ? `top threat ${esc(nameOf(th[0].e))} · nearest ${esc(nameOf(near[0].e))} ${near[0].d} ft` : `nearest ${esc(nameOf(near[0].e))} ${near[0].d} ft`;
    const tools = threatOn() && game.user?.isGM && game.combat ? `<button type="button" data-npt-threat="${esc(board.me.id)}" data-tooltip="Set or reset who it's most set on"><i class="fa-solid fa-scale-unbalanced"></i> Threat</button>` : "";
    return panel("The Board", { key: "board", open: true, sum, tools, body: `<div class="npt-grid">${rows.map(([k, v]) => `<span class="npt-k">${k}</span><div>${v}</div>`).join("")}</div>` });
}

function tacticsHtml(actor, token) {
    const base = baseActorOf(actor);
    let html = "";
    for (const t of tacticsOf(actor, token)) {
        const body = withoutTriggerLines(t.html);
        const first = firstSentence(stripTags(body));
        html += panel("Tactics", { key: `tactics:${t.title}`, sum: esc(`${t.title}${first ? ` · ${first}` : ""}`), body });
    }
    const notes = notesOf(base);
    // The Add or Edit button sits on the card itself, like Show and Threat
    const tools = `<button type="button" data-npt-notes="${esc(base?.uuid ?? actor.uuid)}" data-tooltip="How this creature fights, shared by all its tokens"><i class="fa-solid fa-pen"></i> ${notes ? "Edit" : "Add"}</button>`;
    if (notes) {
        const body = notes.split(/\n{2,}/)
            .map((p) => p.split("\n").filter((l) => !/^\W*trigger\W*[:.]/i.test(l.trim())).join("\n").trim()).filter(Boolean)
            .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
        html += panel("Your Notes", { key: "notes", tools, sum: body ? esc(firstSentence(stripTags(body))) : "only triggers", body: body || `<p class="npt-dim">Only triggers, shown on The Board.</p>` });
    } else {
        html += panel("Your Notes", { key: "notes", tools, sum: "none yet",
            body: `<p class="npt-dim">None yet. Add how this creature fights: what it goes for first, what it does when hurt, when it runs. A line like <em>Trigger: below 10 HP: runs for the door.</em> is watched during combat.</p>` });
    }
    return html;
}

function strikeLines(actor) {
    return (actor.system?.actions ?? []).filter((s) => s.item && s.type === "strike").map((s) => {
        const item = s.item;
        const attacks = (s.variants ?? []).map((v) => v.label).join(" / ") || signed(s.totalModifier ?? 0);
        const dmg = Object.values(item?.system?.damageRolls ?? {}).map((d) => `${d.damage} ${d.damageType ?? ""}`.trim()).join(" + ");
        const riders = (item?.system?.attackEffects?.value ?? []).map((r) => RIDERS[r] ?? r);
        const traits = (item?.system?.traits?.value ?? []).filter((t) => !t.startsWith("magical")).join(", ");
        return { name: s.label ?? item?.name, html: `${link(item, s.label ?? item?.name)} ${esc(attacks)}${dmg ? ` (${esc(dmg)}${riders.length ? ` plus ${esc(riders.join(", "))}` : ""})` : ""}`
            + (traits ? ` <span class="npt-dim">${esc(traits)}</span>` : "") };
    });
}
/** Kept for the macro and older callers: the Strikes as a plain list. */
function strikesHtml(actor) {
    const lines = strikeLines(actor);
    return lines.length ? section("Strikes", ul(lines.map((l) => l.html))) : "";
}

const ROLE_LABEL = { "move-strike": "moves and Strikes", "multi-strike": "several Strikes", area: "area", payoff: "follow-up", setup: "sets up",
    movement: "movement", heal: "healing", buff: "buff", defense: "defense", control: "control", summon: "summons", "strike-variant": "Strike", attack: "attack" };

/** Strikes and Actions (with reactions and free actions) in one card, the passives in another. */
function actionsHtml(actor, profiles) {
    const line = (p) => {
        const req = p.requires?.text;
        const left = rechargeLeft(actor, p.item.id);
        const moves = p.role === "movement" && p.moves.length
            ? ` <span class="npt-dim">(${p.moves.map((m) => `${m.verb}${m.times > 1 ? ` ×${m.times}` : ""}${m.feet ? ` ${m.feet} ft` : m.speedMult && m.speedMult !== 1 ? ` ${m.speedMult}× Speed` : ""}${m.noReactions ? ", no reactions" : ""}`).join("; ")})</span>` : "";
        const role = ROLE_LABEL[p.role] ? ` <span class="npt-role">${ROLE_LABEL[p.role]}</span>` : "";
        // When in the turn it can go: press after an attack, open before any, flourish once
        const when = [p.afterAttack ? "after an attack this turn" : "", p.opensTurn ? "before any other attack" : "",
            p.traits.includes("flourish") ? "flourish: one a turn" : ""].filter(Boolean);
        return `${link(p.item)} ${costGlyph(p.cost)}${role}${moves}${frequencyText(p.item)}${when.length ? ` <span class="npt-dim">(${esc(when.join("; "))})</span>` : ""}`
            + (left ? ` <strong>(recharging, ${left} round${left === 1 ? "" : "s"})</strong>` : p.recharge ? ` <span class="npt-dim">(recharge ${p.recharge} rounds)</span>` : "")
            + (req ? `<br><span class="npt-dim">Requires: ${esc(req)}</span>` : "");
    };
    const actions = profiles.filter((p) => p.kind === "action").sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0));
    const reactions = profiles.filter((p) => p.kind === "reaction");
    const free = profiles.filter((p) => p.kind === "free");
    const passive = profiles.filter((p) => p.kind === "passive" && (p.item.type === "action"));
    const short = (t) => { const s = String(t ?? ""); return s.length > 110 ? `${s.slice(0, 107)}…` : s; };
    const named = (list) => ul(list.map((p) => `${link(p.item)}${p.trigger?.text ? ` <span class="npt-dim">when ${esc(short(p.trigger.text).replace(/^\w/, (c) => c.toLowerCase()))}</span>` : ""}`));
    const strikes = strikeLines(actor);
    const sub = (label, html) => (html ? `<div class="npt-sub">${label}</div>${html}` : "");
    const body = sub("Strikes", ul(strikes.map((s) => s.html))) + sub("Actions", ul(actions.map(line))) + sub("Reactions", named(reactions)) + sub("Free Actions", named(free));
    const names = [...strikes.map((s) => s.name), ...actions.map((p) => { const left = rechargeLeft(actor, p.item.id); return left ? `${p.name} (recharging ${left})` : p.name; }),
        ...reactions.map((p) => `${p.name} (reaction)`), ...free.map((p) => p.name)];
    let html = body ? panel("Strikes and Actions", { key: "abilities", sum: esc(names.join(" · ")), body }) : "";
    if (passive.length) {
        html += panel("Always On", { key: "passive", sum: esc(passive.map((p) => p.name).join(" · ")),
            body: ul(passive.map((p) => link(p.item) + (p.aura && p.area ? ` <span class="npt-dim">(${p.area.size}-ft aura)</span>` : ""))) });
    }
    return html;
}

async function spellsHtml(actor) {
    let html = "";
    for (const entry of actor.spellcasting?.regular ?? []) {
        let body = "";
        try {
            const data = await entry.getSheetData();
            body = (data?.groups ?? []).map((g) => {
                const spells = (g.active ?? []).filter((a) => a?.spell).map((a) => {
                    const used = a.expended ? " <s>(used)</s>" : "";
                    const uses = a.uses && typeof a.uses.max === "number" ? ` (${a.uses.value}/${a.uses.max})` : "";
                    return `${link(a.spell)}${uses}${used}`;
                });
                if (!spells.length) return "";
                const slots = typeof g.uses?.value === "number" && g.uses.max > 0 ? ` <em>${g.uses.value}/${g.uses.max} left</em>` : "";
                return `<li>${esc(game.i18n.localize(String(g.label ?? "")))}${slots}: ${spells.join(", ")}</li>`;
            }).filter(Boolean).join("");
        } catch {
            body = actor.itemTypes.spell.filter((s) => s.system?.location?.value === entry.id).map((s) => `<li>${link(s)}</li>`).join("");
        }
        const dc = entry.statistic?.dc?.value;
        const atk = entry.statistic?.check?.mod;
        const sum = [dc ? `DC ${dc}` : "", typeof atk === "number" ? `attack ${signed(atk)}` : ""].filter(Boolean).join(" · ");
        html += panel(esc(titleCase(entry.name)), { key: `spells:${entry.id ?? entry.name}`, sum, body: body ? `<ul>${body}</ul>` : "" });
    }
    const focus = actor.system?.resources?.focus;
    if (focus?.max) html += `<div class="npt-small npt-dim">Focus Points: ${focus.value}/${focus.max}</div>`;
    return html;
}

function hazardHtml(actor) {
    const d = actor.system?.details ?? {};
    const part = (label, html) => (stripTags(html) ? panel(label, { cls: "npt-act", body: html }) : "");
    return part("Routine", d.routine) + part("Reset", d.reset);
}

function moraleLine(actor) {
    const traits = actor.traits ?? new Set();
    const intMod = actor.system?.abilities?.int?.mod ?? 0;
    const hp = actor.hitPoints ?? {};
    const low = hp.max && hp.value / hp.max <= 0.5;
    if (traits.has?.("mindless")) return "Mindless: it fights until destroyed and doesn't play clever.";
    if (low && intMod > -4) return "Below half HP: a thinking creature that's losing may flee, surrender or bargain.";
    if (low) return "Below half HP: an animal that's hurt usually breaks off and runs.";
    return "";
}

/** Everything the window or whisper shows for a creature. */
async function buildCard(actor, token, { header = true, advice = true } = {}) {
    const placeable = token?.object ?? (token?.document ? token : null) ?? (token?.documentName === "Token" ? tokenStandIn(token) : null)
        ?? canvas?.tokens?.placeables?.find((t) => t.actor === actor) ?? null;
    const name = placeable?.name ?? token?.name ?? actor.name;
    const level = actor.level ?? actor.system?.details?.level?.value;
    const triggers = actor.type === "hazard" ? [] : triggersFor(actor, placeable?.document ?? token);
    const live = triggers.filter((t) => t.state === "now");
    const intent = intentFrom(live);
    let board = null;
    let plans = [];
    const ledger = actor.type === "hazard" ? null : ledgerFor(actor, placeable ?? token);
    if (advice && actor.type !== "hazard" && placeable) {
        try {
            board = await readBoard(placeable);
            if (board) {
                board.rechargeLeft = (p) => rechargeLeft(actor, p.item?.id ?? p.id);
                if (ledger) board.turn = ledgerTotals(ledger);
                plans = planTurn(board, { intent });
            }
        } catch (err) {
            console.error(`${MODULE_ID} | turn advice failed`, err);
        }
    }
    const top = `<div class="npt-top">${actor.img ? `<img src="${esc(actor.img)}" alt="">` : ""}
        <div class="npt-who"><h3>${link(actor, name)}${typeof level === "number" ? ` <small>level ${level}</small>` : ""} ${tierChip(actor)}</h3>${statusLine(actor)}</div></div>`;
    const morale = !triggers.length && actor.type !== "hazard" ? moraleLine(actor) : "";
    const profiles = actor.type === "hazard" ? [] : (board?.profiles ?? profilesOf(actor));
    const boardHtml = actor.type === "hazard" ? "" : boardLine(board, triggers);
    // No board to show the watched triggers on: a card of their own
    const watching = !boardHtml && watchChips(triggers) ? panel("Watching", { body: watchChips(triggers) }) : "";
    const body = triggerSection(triggers)
        + (morale ? `<div class="npt-morale">${morale}</div>` : "")
        + (actor.type === "hazard" ? hazardHtml(actor) : adviceSection(plans, board, intent) + boardHtml + watching)
        + tacticsHtml(actor, placeable?.document ?? token)
        + actionsHtml(actor, profiles) + (await spellsHtml(actor));
    const buttons = `<div class="npt-foot"><button type="button" data-npt-refresh><i class="fa-solid fa-rotate"></i> Refresh</button></div>`;
    return `<div class="npt-card">${header ? `<div class="npt-kicker">NPC turn</div>` : ""}${top}${ledger ? turnHtml(ledger, board) : ""}<div class="npt-body">${body}</div>${buttons}</div>`;
}
// ---------------------------------------------------------------------------------------------
// The window, chat cards, notes, hooks and settings
// ---------------------------------------------------------------------------------------------
function savedPosition() {
    try { return JSON.parse(localStorage.getItem(POSITION_KEY) ?? "{}"); } catch { return {}; }
}

let TurnWindow = null;
function windowClass() {
    if (TurnWindow) return TurnWindow;
    const { ApplicationV2 } = foundry.applications.api;
    TurnWindow = class extends ApplicationV2 {
        static DEFAULT_OPTIONS = {
            id: MODULE_ID,
            classes: ["npt-window"],
            window: { title: "NPC Turn", icon: "fa-solid fa-chess-knight", resizable: true },
            position: { width: 460, height: "auto" },
        };

        constructor(options = {}) {
            const pos = savedPosition();
            super(foundry.utils.mergeObject(options, {
                position: Object.fromEntries(Object.entries({ left: pos.left, top: pos.top, width: pos.width }).filter(([, v]) => Number.isFinite(v))),
            }, { inplace: false }));
            this.actor = null;
            this.token = null;
        }

        get title() {
            if (!this.actor) return "NPC Turn";
            const name = this.token?.name ?? this.actor.name;
            return this.actor.hasPlayerOwner ? `Turn: ${name}` : `NPC Turn: ${name}`;
        }

        async _renderHTML() {
            const html = this.actor ? await buildCard(this.actor, this.token, { header: false }) : "<p>No NPC is acting.</p>";
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

        async close(options) {
            clearPath(); // the drawn path goes with the window
            return super.close(options);
        }

        setPosition(position) {
            const result = super.setPosition(position);
            try {
                const p = this.position;
                localStorage.setItem(POSITION_KEY, JSON.stringify({ left: p.left, top: p.top, width: p.width }));
            } catch { /* private window or blocked storage */ }
            return result;
        }
    };
    return TurnWindow;
}

let turnWindow = null;
async function showWindow(actor, token) {
    if (!game.user.isGM || !actor) return;
    const Cls = windowClass();
    turnWindow ??= new Cls();
    turnWindow.actor = actor;
    turnWindow.token = token ?? null;
    await turnWindow.render({ force: true });
}
async function closeWindow() {
    if (turnWindow?.rendered) await turnWindow.close();
}

let refreshTimer = null;
function refreshSoon(delay = 200) {
    if (!turnWindow?.rendered || !turnWindow.actor) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => turnWindow?.rendered && turnWindow.render(), delay);
}
function refreshIfShowing(actor) {
    if (!turnWindow?.rendered || !turnWindow.actor || !actor) return;
    const shown = turnWindow.actor;
    if (actor !== shown && actor.id !== shown.id && actor.uuid !== shown.uuid) return;
    refreshSoon(150);
}

/** Buttons on the card: notes, refresh, and Show (pings the square on the canvas). */
function bindCard(root, rerender) {
    // Folding cards stay the way they were left
    // (Chat cards keep the state they were posted with, so only the window remembers.)
    if (rerender) {
        root.querySelectorAll("details[data-npt-fold]").forEach((d) => {
            let last = d.open;
            d.addEventListener("toggle", () => { if (d.open !== last) { last = d.open; saveFold(d.dataset.nptFold, d.open); } });
        });
    }
    root.querySelectorAll("[data-npt-threat]").forEach((b) => {
        if (!game.user.isGM || !rerender) return b.remove();
        b.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await editThreat(b.dataset.nptThreat);
            rerender();
        });
    });
    root.querySelectorAll("[data-npt-notes]").forEach((b) => {
        if (!game.user.isGM) return b.remove();
        b.addEventListener("click", async (e) => {
            e.preventDefault();
            await editNotes(b.dataset.nptNotes);
            rerender?.();
        });
    });
    root.querySelectorAll("[data-npt-adj]").forEach((b) => {
        if (!rerender) return b.remove();
        b.addEventListener("click", (e) => {
            e.preventDefault();
            const [kind, d] = b.dataset.nptAdj.split(":");
            adjustLedger(kind, Number(d));
            rerender();
        });
    });
    root.querySelectorAll("[data-npt-refresh]").forEach((b) => {
        if (!rerender) return b.remove();
        b.addEventListener("click", (e) => { e.preventDefault(); rerender(); });
    });
    root.querySelectorAll("[data-npt-sustain]").forEach((b) => {
        if (!game.user.isGM) return b.remove();
        b.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const actor = fromUuidSync(b.dataset.nptSustain);
            if (!actor || b.disabled) return;
            b.disabled = true;
            try { await sustainNow(actor); } catch (err) { console.warn(`${MODULE_ID} | couldn't Sustain`, err); b.disabled = false; return; }
            rerender?.();
        });
    });
    root.querySelectorAll("[data-npt-show]").forEach((b) => {
        b.addEventListener("click", (e) => {
            e.preventDefault();
            try {
                const at = JSON.parse(b.dataset.nptShow);
                const size = canvas.grid.size;
                const path = JSON.parse(b.dataset.nptPath || "[]");
                // A second click takes the line away again
                if (pathShown && pathShown.key === b.dataset.nptPath + b.dataset.nptShow) return clearPath();
                if (b.dataset.nptKind === "square") drawPath(path.length ? path : [{ ...at, w: 1 }], b.dataset.nptPath + b.dataset.nptShow);
                else {
                    // An area's aim point. canvas.ping would broadcast the pulse to every player, so draw it on this
                    // client only (handlePing is the local half of canvas.ping)
                    const origin = { x: at.x * size, y: at.y * size };
                    const ping = { scene: canvas.scene?.id, pull: false, style: CONFIG.Canvas.pings.types.PULSE, zoom: canvas.stage.scale.x };
                    canvas.controls.handlePing(game.user, origin, ping);
                }
            } catch (err) { console.warn(`${MODULE_ID} | couldn't show the square`, err); }
        });
    });
}

// --- The suggested path, drawn on this GM's canvas only ---------------------------------------------
// A plain PIXI drawing on the canvas interface: not a Drawing or Region, so it isn't saved to the scene and
// never reaches anyone else's screen. Cleared by a second click, the next turn, or leaving the scene.
let pathShown = null;
function clearPath() {
    if (pathShown?.g) { pathShown.g.parent?.removeChild(pathShown.g); pathShown.g.destroy({ children: true }); }
    pathShown = null;
}
function drawPath(path, key) {
    clearPath();
    const layer = canvas?.interface ?? canvas?.controls;
    if (!layer || !globalThis.PIXI) return;
    const size = canvas.grid.size;
    const pts = path.map((p) => ({ x: (p.x + (p.w ?? 1) / 2) * size, y: (p.y + (p.w ?? 1) / 2) * size }));
    const g = new PIXI.Graphics();
    const color = 0xd8a520, width = Math.max(4, size * 0.08);
    // Line along the path, a dot at each turn, a ring where it ends
    g.lineStyle({ width: width + 4, color: 0x000000, alpha: 0.45, cap: "round", join: "round" });
    g.moveTo(pts[0].x, pts[0].y); for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
    g.lineStyle({ width, color, alpha: 0.95, cap: "round", join: "round" });
    g.moveTo(pts[0].x, pts[0].y); for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
    g.lineStyle(0);
    for (const p of pts.slice(1, -1)) { g.beginFill(color, 0.95); g.drawCircle(p.x, p.y, width * 0.9); g.endFill(); }
    const end = pts[pts.length - 1];
    const radius = (path[path.length - 1]?.w ?? 1) * size * 0.42;
    g.lineStyle({ width, color, alpha: 0.95 });
    g.drawCircle(end.x, end.y, radius);
    // Arrowhead on the last stretch
    if (pts.length > 1) {
        const prev = pts[pts.length - 2];
        const ang = Math.atan2(end.y - prev.y, end.x - prev.x);
        const tip = { x: end.x - Math.cos(ang) * radius, y: end.y - Math.sin(ang) * radius };
        const h = width * 3;
        g.lineStyle(0); g.beginFill(color, 0.95);
        g.drawPolygon([tip.x, tip.y, tip.x - Math.cos(ang - 0.45) * h, tip.y - Math.sin(ang - 0.45) * h, tip.x - Math.cos(ang + 0.45) * h, tip.y - Math.sin(ang + 0.45) * h]);
        g.endFill();
    }
    g.eventMode = "none";
    layer.addChild(g);
    pathShown = { g, key };
}
Hooks.on("canvasTearDown", () => clearPath());

async function postCard(actor, token) {
    if (!actor) return;
    await ChatMessage.create({
        content: await buildCard(actor, token),
        whisper: game.users.filter((u) => u.isGM).map((u) => u.id),
        speaker: { alias: "NPC Turn" },
    });
}

/** The selected token, or whoever's turn it is, in the window (or chat, in Chat mode). */
async function openCard(target) {
    if (!game.user.isGM) return ui.notifications.warn("NPC turn cards are for the GM.");
    let pairs = [];
    if (target?.actor && target?.document) pairs = [[target.actor, target]];
    else if (target?.documentName === "Token") pairs = [[target.actor, target.object ?? target]];
    else if (target?.documentName === "Actor") pairs = [[target, canvas.tokens.placeables.find((t) => t.actor === target) ?? null]];
    else {
        const selected = (canvas?.tokens?.controlled ?? []).filter((t) => t.actor);
        pairs = selected.length ? selected.map((t) => [t.actor, t]) : (game.combat?.combatant?.actor ? [[game.combat.combatant.actor, game.combat.combatant.token?.object ?? game.combat.combatant.token]] : []);
    }
    if (!pairs.length) return ui.notifications.warn("Select an NPC token, or start a combat.");
    if (setting("mode", "window") === "chat") {
        for (const [a, t] of pairs) await postCard(a, t);
    } else {
        await showWindow(...pairs[0]);
    }
}

async function editNotes(uuid) {
    const actor = await fromUuid(uuid);
    if (!actor) return;
    const current = notesOf(actor);
    const text = await foundry.applications.api.DialogV2.wait({
        window: { title: `Notes: ${actor.name}`, icon: "fa-solid fa-pen" },
        position: { width: 520 },
        content: `<p style="margin-top:0">How this creature fights: what it goes for first, what it does when hurt, when it runs.
            Every token of ${esc(actor.name)} shares these, and they show on its turn card.</p>
            <p class="npt-dim" style="margin-top:0">A line like <code>Trigger: below 10 HP: runs for the door.</code> is watched during combat.</p>
            <textarea name="notes" rows="9" style="width:100%">${esc(current)}</textarea>`,
        buttons: [
            { action: "save", label: "Save", icon: "fa-solid fa-floppy-disk", default: true, callback: (event, button) => button.form.elements.notes.value },
            { action: "cancel", label: "Cancel", icon: "fa-solid fa-xmark" },
        ],
        rejectClose: false,
    });
    if (typeof text !== "string" || text === "cancel") return;
    const update = text.trim() ? { [`flags.${FLAG_SCOPE}.notes`]: text.trim() } : { [`flags.${FLAG_SCOPE}.-=notes`]: null };
    // Move notes kept by the older modules across
    if (actor.flags?.[LEGACY_MODULE]?.notes !== undefined) update[`flags.${LEGACY_MODULE}.-=notes`] = null;
    if (actor.flags?.[LEGACY_OLDER]?.tactics !== undefined) update[`flags.${LEGACY_OLDER}.-=tactics`] = null;
    await actor.update(update);
    ui.notifications.info(`Notes saved for ${actor.name}.`);
}


export { actionsHtml, adviceSection, foldOpen, resetTurnFolds, showButton, stepsHtml, bindCard, boardLine, buildCard, clearPath, closeWindow, editNotes, intentFrom, notesOf, openCard, panel, parseTriggers, postCard, rechargeLeft, refreshIfShowing, refreshSoon, registerSource, showWindow, statusLine, tacticsHtml, tacticsOf, tierChip, titleCase, triggerSection, triggersFor, turnWindow, usedEffects, watchChips, workbenchRecharge };
