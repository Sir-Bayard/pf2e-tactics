/**
 * PF2e Tactics: classes/swashbuckler.mjs
 * See classes/_common.mjs for the shape of a class read.
 * What the swashbuckler knows that the advisor doesn't: precise strike on agile and finesse weapons (flat by level, dice on a
 * finisher), panache (on the sheet as the effect) and the bravado actions that earn it (the style's action, Tumble Through and
 * its feats) with their odds against the foe's estimated DCs, and the turn the advisor can't compose: earn panache, Strike,
 * finish last (a finisher ends the turn's attacks and spends the panache), or finish first and earn it back. Confident
 * Finisher's half damage on a failure, Precise and Combination Finisher, Exemplary Finisher by style, Keen Flair, Deadly
 * Grace, Flamboyant Cruelty, Derring-Do and Even the Odds are math; the reactions, parries, stances and the rest are when-notes.
 */
import { canMove, effect, has, level, moveText, myReach, pct, squareToReach, targets, worth, degreeChances, feetBetween, inReach, mapFor, nameOf, signed } from "./_common.mjs";
import { flanks } from "../reader.mjs";

/** Foundry's slugs drop apostrophes; the catalog's keep a dash for them. Both are tried. */
const hasAny = (actor, ...slugs) => slugs.some((s) => has(actor, s));
const STYLES = ["fencer", "gymnast", "braggart", "battledancer", "wit", "rascal"];
const STYLE_SKILL = { fencer: "deception", gymnast: "athletics", braggart: "intimidation", battledancer: "performance", wit: "diplomacy", rascal: "thievery" };
const STYLE_ACTION = { fencer: "Feint (or Create a Diversion)", gymnast: "Grapple, Shove, Trip or Reposition", braggart: "Demoralize", battledancer: "Perform", wit: "Bon Mot", rascal: "Dirty Trick" };
const times = (n) => (n <= 1 ? "" : n === 2 ? " twice" : n === 3 ? " three times" : ` ${n} times`);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const abil = (actor, k) => Number(actor?.abilities?.[k]?.mod ?? actor?.system?.abilities?.[k]?.mod) || 0;
const classDC = (actor, lv) => Number(actor?.classDC?.value ?? actor?.system?.attributes?.classDC?.value) || 10 + lv + 4 + (lv >= 19 ? 6 : lv >= 9 ? 4 : 2);
const isThrown = (s) => !!s.ranged && (s.traits ?? []).some((t) => t.startsWith("thrown"));
const finesse = (s) => !!(s.traits?.includes("agile") || s.traits?.includes("finesse"));
/** Weapon damage dice: the item's, else what the striking rune of the level usually gives. */
const diceCount = (s, lv) => Number(s.dice ?? s.item?.system?.damage?.dice) || (lv >= 19 ? 4 : lv >= 12 ? 3 : lv >= 4 ? 2 : 1);
const pierceOrBludgeon = (s) => !s.damageTypes?.length || s.damageTypes.some((t) => ["bludgeoning", "piercing"].includes(t));
const slashOrPierce = (s) => !s.damageTypes?.length || s.damageTypes.some((t) => ["slashing", "piercing"].includes(t));
/** Uses left today of a feat with a frequency, or null when the sheet doesn't say. */
const usesLeft = (actor, slug) => { const it = actor?.items?.find?.((i) => (i.slug ?? i.system?.slug) === slug); const v = it?.system?.frequency?.value; return v == null ? null : Number(v); };
const CRUEL = ["clumsy", "drained", "enfeebled", "frightened", "sickened", "stupefied"];

/** Precise strike's flat damage: the sheet's flag, else the class table (2, +1 at 5, 9, 13, 17); Finishing Precision gives 1. */
function preciseOf(actor, lv, own) {
    const flag = Number(actor?.flags?.system?.swashbuckler?.preciseStrike);
    if (flag > 0) return flag;
    if (has(actor, "finishing-precision") && !own) return 1;
    if (own || has(actor, "precise-strike")) return Math.ceil(lv / 4) + 1;
    return 0;
}
/** Degree chances of an attack roll: Keen Flair turns a 19 that hits into a critical hit; fortune rolls twice. */
function chances(bonus, ac, { keen = false, fortune = false } = {}) {
    let c = degreeChances(bonus, ac);
    if (keen && 19 + bonus >= ac && 19 + bonus < ac + 10) c = { ...c, s: c.s - 0.05, cs: c.cs + 0.05 };
    if (fortune) { const pcs = 1 - (1 - c.cs) ** 2, ps = 1 - (1 - c.cs - c.s) ** 2, pf = 1 - (1 - c.cs - c.s - c.f) ** 2; c = { cs: pcs, s: ps - pcs, f: pf - ps, cf: 1 - pf }; }
    return c;
}
const expectOf = (c, avg, deadly = 0) => c.s * Math.max(0, avg) + c.cs * Math.max(0, avg * 2 + deadly);

function swashbuckler(board, ctx, out) {
    const actor = board.me.actor;
    const me = board.me;
    const lv = level(board);
    const own = (actor?.class?.slug ?? "") === "swashbuckler";
    if (!own && !has(actor, "panache")) return;
    const n = (t) => { if (t) out.notes.push(t); };
    const foes = targets(board);
    const style = STYLES.find((s) => has(actor, s)) ?? null;
    const N = preciseOf(actor, lv, own);
    const flying = has(actor, "flying-blade");
    const keen = has(actor, "keen-flair");
    const combination = has(actor, "combination-finisher");
    const preciseFin = has(actor, "precise-finisher");
    const eternal = has(actor, "eternal-confidence");
    const exemplary = has(actor, "exemplary-finisher");
    const derring = has(actor, "derring-do");
    const dc = classDC(actor, lv);
    const cha = abil(actor, "cha");
    const A = ctx.actions;
    const qualifies = (s) => finesse(s) && (!s.ranged || (flying && isThrown(s)));

    // ---- panache: the effect on the sheet; Even the Odds (4) gives it for the turn when you're flanked as the turn begins
    let panache = !!effect(actor, /^effect-panache/) || !!actor.rollOptions?.all?.["self:effect:panache"];
    let panacheWhy = panache ? "You have panache" : "";
    if (!panache && has(actor, "even-the-odds") && usesLeft(actor, "even-the-odds") !== 0) {
        const near = foes.filter((f) => inReach(f.rect, me.rect, f.reach || 5));
        const pair = near.flatMap((a) => near.filter((b) => b !== a && flanks(a.rect, b.rect, me.rect)).map((b) => [a, b]))[0];
        if (pair) { panache = true; panacheWhy = `Even the Odds (free action as your turn begins, once per 10 minutes): ${nameOf(pair[0])} and ${nameOf(pair[1])} flank you, so you have panache until the end of this turn`; }
    }

    // ---- the Strikes: precise strike's flat damage on agile and finesse weapons (thrown too with Flying Blade), Deadly Grace (16)
    for (const s of board.strikes) {
        if (qualifies(s) && N > 0 && !s.preciseCounted) { s.preciseCounted = true; s.precise = N; s.avg += N; }
        if (has(actor, "deadly-grace") && !s.ranged && finesse(s) && !s.graceCounted) { s.graceCounted = true; s.deadly = s.deadly ? s.deadly * 2 : 4.5 * (lv >= 19 ? 3 : 2); }
    }
    const carry = board.strikes.filter(qualifies);
    const dont = board.strikes.filter((s) => !s.ranged && !qualifies(s));
    if (N > 0) n(`Precise strike: +${N} precision on every hit with an agile or finesse weapon${flying ? " (a thrown one too, in its first range increment)" : ""}, ${N}d6 instead on a finisher. The plans count it${dont.length ? `; ${dont.map((s) => s.label).join(", ")} ${dont.length === 1 ? "doesn't" : "don't"} carry it` : ""}.`);
    if (!carry.length) { n("No agile or finesse weapon in hand: no precise strike and no finisher until you draw one."); }
    if (has(actor, "deadly-grace")) n("Deadly Grace: your agile and finesse weapons are deadly d8, or double their deadly dice; the plans count it on a critical hit.");
    if (keen) n("Keen Flair: a 19 that hits is a critical hit; the plans count it.");
    const cruelty = (f) => (has(actor, "flamboyant-cruelty") ? (() => { const k = CRUEL.filter((c) => f.conditions?.has?.(c)).length; return k >= 2 ? k : 0; })() : 0);

    // ---- skills with the bravado bonus (Stylish Combatant +1, +2 at 9); Derring-Do rolls twice while panache is already up
    const stylish = own || has(actor, "stylish-combatant") ? (has(actor, "swashbuckler-expertise") || (own && lv >= 9) ? 2 : 1) : 0;
    const skill = (k) => { const v = actor.skills?.[k]?.mod ?? me[k]; return v == null ? null : Number(v); };
    const trained = (k) => (actor.skills?.[k]?.rank ?? 0) >= 1 || !!actor.skills?.[k]?.proficient || STYLE_SKILL[style] === k || (k === "deception" && !!me.deceptionTrained);
    const bravadoMod = (k) => (skill(k) == null ? null : skill(k) + stylish);
    const shared = (f) => !me.languages?.length || !f.languages?.length || me.languages.some((l) => f.languages.includes(l));
    const smart = !me.mindless && (me.int ?? 0) > -4;
    const freeHand = me.freeHand !== false;
    const perceptionDC = (f) => 10 + (f.perception ?? f.saves?.will ?? 0);
    const saveDC = (f, k) => 10 + (f.saves?.[k] ?? 0);
    const offGuardTo = (f) => !!f.conditions?.has?.("off-guard");

    // ---- the square a Tumble Through ends on: through the foe, out the far side; null when it's taken
    const beyond = (f, from) => {
        const fcx = f.rect.x + (f.rect.w - 1) / 2, fcy = f.rect.y + (f.rect.h - 1) / 2;
        const bx = Math.round(2 * fcx - from.x), by = Math.round(2 * fcy - from.y);
        const free = (x, y) => !board.occupant?.get?.(`${x},${y}`) && inReach({ x, y, w: me.rect.w, h: me.rect.h, z: me.rect.z }, f.rect, 5);
        if (free(bx, by)) return { x: bx, y: by };
        const dx = Math.sign(bx - fcx), dy = Math.sign(by - fcy);
        for (const [x, y] of dx === 0 ? [[bx - 1, by], [bx + 1, by]] : dy === 0 ? [[bx, by - 1], [bx, by + 1]] : [[bx - dx, by], [bx, by - dy]]) if (free(x, y)) return { x, y };
        return null;
    };

    /**
     * The bravado actions against f from the square at (moveActs already spent to get there), with panache up or not.
     * Each: { key, text, c (degree chances), attack (counts for the multiple attack penalty), worth (beyond the panache),
     * acAdj (on f's AC for the Strikes after it), ogFirst (chance the next attack finds it off-guard), dest, moveless }.
     */
    const bravados = (f, at, moveActs, hasP, made) => {
        const list = [];
        const fort = hasP && derring;
        const roll = (mod, dcv) => chances(mod, dcv, { fortune: fort });
        const dist = feetBetween(at, f.rect);
        const adjacent = inReach(at, f.rect, 5);
        const flavor = fort ? ", rolled twice (Derring-Do)" : "";
        // Tumble Through: everyone's; Tumble Behind makes it off-guard to the next attack; The Bigger They Are (12) finds a weak spot
        const acro = bravadoMod("acrobatics");
        if (acro != null && canMove(me) && (adjacent || moveActs === 1) && at === me.rect) {
            const dest = beyond(f, me.rect);
            if (dest) {
                const c = roll(acro, saveDC(f, "reflex"));
                const behind = hasAny(actor, "tumble-behind-swashbuckler", "tumble-behind");
                list.push({ key: "tumble", text: `Tumble Through ${nameOf(f)} (Acrobatics ${signed(acro)} vs Reflex DC ${saveDC(f, "reflex")}${flavor}; about ${pct(c.s + c.cs)}), ending on its far side${behind ? "; Tumble Behind: it's off-guard to your next attack if it works" : ""}`, c, attack: false, worth: 0, acAdj: 0, ogFirst: behind ? c.s + c.cs : 0, dest, replacesMove: moveActs === 1 });
                if (has(actor, "the-bigger-they-are") && (f.sizeRank ?? 2) > (me.sizeRank ?? 2)) {
                    const weak = Math.floor(lv / 2);
                    list.push({ key: "bigger", text: `The Bigger They Are: Tumble Through ${nameOf(f)} (Acrobatics ${signed(acro)} vs Reflex DC ${saveDC(f, "reflex")}${flavor}; about ${pct(c.s + c.cs)}); if it works it has weakness ${weak} to your precision damage on your next attack (every attack this turn on a critical success)`, c, attack: false, worth: 0, acAdj: 0, ogFirst: 0, firstExtra: weak * (c.s + c.cs), dest, replacesMove: moveActs === 1 });
                }
            }
        }
        // Vexing Tumble (6): Stride half your Speed around it; no reactions on a success, off-guard to you this turn on a critical
        if (acro != null && has(actor, "vexing-tumble") && canMove(me) && adjacent && at === me.rect) {
            const c = roll(acro, saveDC(f, "reflex"));
            list.push({ key: "vexing", text: `Vexing Tumble around ${nameOf(f)} (Acrobatics ${signed(acro)} vs Reflex DC ${saveDC(f, "reflex")}${flavor}; about ${pct(c.s + c.cs)}): a Stride of half your Speed that triggers no reaction from it on a success, and leaves it off-guard to you this turn on a critical success`, c, attack: false, worth: 0, acAdj: -2 * c.cs, ogFirst: c.cs, dest: null });
        }
        // the style's action
        if (style === "fencer" && smart && trained("deception") && bravadoMod("deception") != null && adjacent) {
            const m = bravadoMod("deception"), c = roll(m, perceptionDC(f));
            list.push({ key: "feint", text: `Feint ${nameOf(f)} (Deception ${signed(m)} vs Perception DC ${perceptionDC(f)}${flavor}; about ${pct(c.s + c.cs)}): off-guard to your next melee attack, to all of them through your next turn on a critical success`, c, attack: false, worth: 0, acAdj: -2 * c.cs, ogFirst: c.s + c.cs, dest: null });
        }
        if (style === "gymnast" && bravadoMod("athletics") != null && adjacent && (f.sizeRank ?? 2) <= (me.sizeRank ?? 2) + 1 && freeHand) {
            const m = bravadoMod("athletics");
            const agileW = board.strikes.some((s) => !s.ranged && s.agile);
            const pen = made <= 0 ? 0 : has(actor, "agile-maneuvers") ? (agileW && hasP ? (made === 1 ? -3 : -6) : made === 1 ? -4 : -8) : mapFor(made, false);
            if (!f.conditions?.has?.("prone")) {
                const c = roll(m + pen, saveDC(f, "reflex"));
                list.push({ key: "trip", text: `Trip ${nameOf(f)} (Athletics ${signed(m + pen)} vs Reflex DC ${saveDC(f, "reflex")}${flavor}; about ${pct(c.s + c.cs)}): prone, off-guard to everyone`, c, attack: true, worth: (c.s + c.cs) * worth(board, "prone") + c.cs * 3.5, acAdj: -2 * (c.s + c.cs), ogFirst: 0, dest: null, prone: c.s + c.cs });
            }
            if (!f.conditions?.has?.("grabbed")) {
                const c = roll(m + pen, saveDC(f, "fortitude"));
                list.push({ key: "grapple", text: `Grapple ${nameOf(f)} (Athletics ${signed(m + pen)} vs Fortitude DC ${saveDC(f, "fortitude")}${flavor}; about ${pct(c.s + c.cs)}): grabbed, off-guard and held`, c, attack: true, worth: (c.s + c.cs) * worth(board, "grabbed"), acAdj: -2 * (c.s + c.cs), ogFirst: 0, dest: null, prone: c.s + c.cs });
            }
        }
        if (style === "braggart" && smart && bravadoMod("intimidation") != null && dist <= 30 && !f.conditions?.has?.("deafened") && !f.conditions?.has?.("frightened")) {
            const m = bravadoMod("intimidation") - (shared(f) ? 0 : 4), c = roll(m, saveDC(f, "will"));
            list.push({ key: "demoralize", text: `Demoralize ${nameOf(f)} (Intimidation ${signed(m)}${shared(f) ? "" : ", -4 for no shared language"} vs Will DC ${saveDC(f, "will")}${flavor}; about ${pct(c.s + c.cs)}): frightened 1, 2 on a critical success${has(actor, "antagonize") ? "; Antagonize keeps it at 1 until it comes for you" : ""}`, c, attack: false, worth: c.s * worth(board, "frightened") + c.cs * 2 * worth(board, "frightened"), acAdj: -(c.s + 2 * c.cs), ogFirst: 0, dest: null });
        }
        if (style === "wit" && smart && bravadoMod("diplomacy") != null && dist <= 30 && shared(f) && !f.conditions?.has?.("deafened")) {
            const m = bravadoMod("diplomacy"), c = roll(m, saveDC(f, "will"));
            list.push({ key: "bon-mot", text: `Bon Mot at ${nameOf(f)} (Diplomacy ${signed(m)} vs Will DC ${saveDC(f, "will")}${flavor}; about ${pct(c.s + c.cs)}): -2 to its Perception and Will saves for a minute, -3 on a critical success`, c, attack: false, worth: (c.s + 1.5 * c.cs) * worth(board, "frightened", 0.6), acAdj: 0, ogFirst: 0, dest: null });
        }
        if (style === "battledancer" && bravadoMod("performance") != null && dist <= 30) {
            const m = bravadoMod("performance"), c = roll(m, saveDC(f, "will"));
            const show = has(actor, "enjoy-the-show");
            list.push({ key: "perform", text: `Perform for ${nameOf(f)} (Performance ${signed(m)}${flavor}; the GM sets the DC, about ${pct(c.s + c.cs)} against its Will DC ${saveDC(f, "will")})${show ? ": Enjoy the Show gives it -1 to attacks on anyone but you, -2 on a critical success" : ""}`, c, attack: false, worth: show ? (c.s * 0.5 + c.cs * 1) * Math.max(1, lv / 5) : 0, acAdj: 0, ogFirst: 0, dest: null });
            if (has(actor, "leading-dance") && adjacent && canMove(me)) list.push({ key: "leading-dance", text: `Leading Dance with ${nameOf(f)} (Performance ${signed(m)} vs Will DC ${saveDC(f, "will")}${flavor}; about ${pct(c.s + c.cs)}): you both move 5 feet together, 10 on a critical success, without reactions`, c, attack: false, worth: 0.3, acAdj: 0, ogFirst: 0, dest: null });
        }
        if (style === "rascal" && bravadoMod("thievery") != null && adjacent && freeHand) {
            const m = bravadoMod("thievery") + (made <= 0 ? 0 : has(actor, "agile-maneuvers") ? (made === 1 ? -4 : -8) : mapFor(made, false)), c = roll(m, saveDC(f, "reflex"));
            list.push({ key: "dirty-trick", text: `Dirty Trick on ${nameOf(f)} (Thievery ${signed(m)} vs Reflex DC ${saveDC(f, "reflex")}${flavor}; about ${pct(c.s + c.cs)}): clumsy 1 until the end of its next turn, longer on a critical success`, c, attack: true, worth: (c.s + c.cs) * worth(board, "clumsy"), acAdj: -(c.s + c.cs), ogFirst: 0, dest: null });
        }
        return list;
    };

    /** The Strikes usable at f from at: melee in reach, thrown in its first range increment. */
    const usable = (f, at) => board.strikes.filter((s) => (s.ranged ? isThrown(s) && feetBetween(at, f.rect) <= (s.range ?? 20) : inReach(at, f.rect, s.reach || 5)));
    /** The best plain Strike at f with made attacks before it; p: the chance it's off-guard; extra: flat damage on it. */
    const plain = (f, at, made, { p = 0, extra = 0, acAdj = 0 } = {}) => {
        let best = null;
        for (const s of usable(f, at)) {
            const bonus = s.bonus + mapFor(made, s.agile);
            const c = chances(bonus, f.ac + acAdj - (offGuardTo(f) ? 0 : 2 * p), { keen });
            const e = expectOf(c, s.avg + extra + (s.ranged ? 0 : cruelty(f)), s.deadly);
            if (!best || e > best.ev) best = { s, bonus, c, ev: e, text: `${s.label} (${signed(bonus)})` };
        }
        return best;
    };
    const finisherPen = (made, s) => (made <= 0 ? 0 : combination ? (made === 1 ? (s.agile ? -3 : -4) : s.agile ? -6 : -8) : mapFor(made, s.agile));
    /** The finishers on the sheet. */
    const FINS = [];
    if (own || has(actor, "confident-finisher")) FINS.push("confident-finisher");
    for (const k of ["basic-finisher", "unbalancing-finisher", "retreating-finisher", "bleeding-finisher", "stunning-finisher", "stumbling-finisher", "targeting-finisher", "perfect-finisher", "revitalizing-finisher", "lethal-finisher", "lunging-finisher"]) if (has(actor, k)) FINS.push(k);
    const dice = N * 3.5;
    /** Confident Finisher's failure effect: half the dice, all of them with Precise Finisher; Eternal Confidence gives it to every finisher. */
    const failDmg = (key) => (key === "confident-finisher" || eternal ? (preciseFin ? dice : dice / 2) : 0);
    /**
     * The best finisher at f from at with made attacks before it: each finisher with each qualifying weapon.
     * p: the chance f is off-guard; extra: flat damage on the Strike. Returns { key, s, bonus, ev, text, notes }.
     */
    const finisher = (f, at, made, { p = 0, extra = 0, acAdj = 0, prone = 0 } = {}) => {
        let best = null;
        const near = foes.filter((g) => g !== f);
        const ac = f.ac + acAdj - (offGuardTo(f) ? 0 : 2 * p);
        for (const s of usable(f, at).filter(qualifies)) {
            const base = s.avg - (s.precise ?? 0) + extra + (s.ranged ? 0 : cruelty(f));
            const gym = exemplary && style === "gymnast" && (prone > 0 || ["grabbed", "restrained", "prone"].some((c) => f.conditions?.has?.(c))) ? 2 * diceCount(s, lv) * Math.max(prone, ["grabbed", "restrained", "prone"].some((c) => f.conditions?.has?.(c)) ? 1 : 0) : 0;
            for (const key of FINS) {
                if (key === "bleeding-finisher" && !slashOrPierce(s)) continue;
                if (key === "lunging-finisher" && s.ranged) continue;
                if (["unbalancing-finisher", "retreating-finisher", "stunning-finisher", "lunging-finisher"].includes(key) && s.ranged) continue;
                const bonus = s.bonus + finisherPen(made, s);
                const c = chances(bonus, ac, { keen, fortune: key === "perfect-finisher" });
                const avg = base + (key === "basic-finisher" ? 3.5 : key === "lethal-finisher" ? 0 : dice) + gym;
                let ev = expectOf(c, avg, s.deadly) + c.f * failDmg(key);
                const bits = [];
                if (key === "confident-finisher" || eternal) bits.push(`a miss short of a critical failure still deals ${preciseFin ? "the dice" : "half the dice"} (${Math.round(failDmg(key))})`);
                if (key === "unbalancing-finisher" && !(exemplary && style === "fencer")) { ev += (c.s + c.cs) * worth(board, "off-guard"); bits.push("a hit leaves it off-guard until the end of your next turn"); }
                if (key === "bleeding-finisher") { ev += (c.s + 2 * c.cs) * 1.2 * dice; bits.push(`a hit adds ${N}d6 persistent bleed`); }
                if (key === "stunning-finisher") { const d = degreeChances(f.saves?.fortitude ?? 0, dc, (f.level ?? 0) > lv ? 1 : 0); ev += (c.s + c.cs) * (d.f * worth(board, "stunned") + d.cf * 3 * worth(board, "stunned") + d.s * 0.5); bits.push(`a hit forces a Fortitude save against your class DC ${dc} (incapacitation): stunned 1 on a failure, 3 on a critical failure, no reactions on a success`); }
                if (key === "targeting-finisher") { const part = f.caster ? "head (stupefied 2)" : "arm (enfeebled 2)"; ev += (c.s + c.cs) * worth(board, f.caster ? "stupefied" : "enfeebled", 2); bits.push(`a hit targets its ${part} until the end of your next turn, and a lesser one for a minute on a critical hit`); }
                if (key === "stumbling-finisher") { ev += (c.s + c.cs) * 0.5; bits.push("a hit pushes it 5 feet, 10 on a critical hit"); }
                if (key === "retreating-finisher") { ev += c.f * 0.3 * (f.reactiveStrike?.avg ?? 5); bits.push("a miss lets you Step for free"); }
                if (key === "perfect-finisher") bits.push("roll twice and take the better");
                if (key === "revitalizing-finisher") { const allies = board.allies.filter((a) => feetBetween(at, a.rect) <= 30).length; ev += (c.s + c.cs) * 0.4 * Math.floor(lv / 2) * (1 + allies) + c.f * 0.4 * Math.floor(lv / 2); bits.push(`a hit gives you and allies within 30 feet ${Math.floor(lv / 2)} temporary HP (just you on a miss)`); }
                if (key === "lethal-finisher") { const d = degreeChances(f.saves?.fortitude ?? 0, dc); const normal = d.cs * 6 + d.s * 21 + d.f * 42 + d.cf * 63, worse = d.cs * 21 + d.s * 42 + (d.f + d.cf) * 63; ev = c.s * (base + normal) + c.cs * (base * 2 + s.deadly + worse) + c.f * failDmg(key); bits.push(`no precise dice; instead it saves against your class DC ${dc} (Fortitude ${signed(f.saves?.fortitude ?? 0)}): 6d6 precision on a success, 12d6 on a failure, 18d6 on a critical failure, one degree worse on a critical hit`); }
                if (key === "lunging-finisher") bits.push("5 feet more reach for this Strike");
                if (exemplary) {
                    if (style === "fencer") { ev += (c.s + c.cs) * worth(board, "off-guard"); bits.push("Exemplary Finisher: a hit leaves it off-guard until your next turn"); }
                    if (style === "wit") { ev += (c.s + c.cs) * 0.15 * (f.reactiveStrike?.avg ?? 5) * 2; bits.push("Exemplary Finisher: a hit gives it -2 to attack you until your next turn"); }
                    if (style === "braggart") { ev += (c.s + c.cs) * 0.5; bits.push("Exemplary Finisher: a hit ends its immunity to your Demoralize"); }
                    if (style === "battledancer") { ev += (c.s + c.cs) * 0.3; bits.push("Exemplary Finisher: a free Step after a hit"); }
                    if (style === "rascal") { ev += (c.s + c.cs) * 0.5; bits.push("Exemplary Finisher: a hit gives it -10 feet of Speed until your next turn"); }
                    if (style === "gymnast" && gym) bits.push(`Exemplary Finisher: +${2 * diceCount(s, lv)} damage while it's prone or held`);
                }
                if (has(actor, "finishing-follow-through") && f.hp != null && f.hp <= avg * (c.s + c.cs) + 4) { ev += 0.5; bits.push("Finishing Follow-Through: if it drops, you keep your panache"); }
                const label = key.replace(/-/g, " ").replace(/\b\w/g, (x) => x.toUpperCase());
                const text = `${label} on ${nameOf(f)} with ${s.label} (${signed(bonus)}): ${N}d6 precision on top${bits.length ? `; ${bits.join("; ")}` : ""}`;
                if (!best || ev > best.ev) best = { key, s, bonus, c, ev, text, hit: c.s + c.cs };
            }
            // Dual Finisher (8): two weapons, two Strikes at two foes at the same penalty
            if (has(actor, "dual-finisher") && !s.ranged) {
                for (const g of near) {
                    for (const t of usable(g, at).filter((t) => t !== s && !t.ranged)) {
                        const b1 = s.bonus + finisherPen(made, s), b2 = t.bonus + finisherPen(made, t) - (t.agile ? 0 : 2);
                        const c1 = chances(b1, ac, { keen }), c2 = chances(b2, g.ac - (offGuardTo(g) ? 0 : 0), { keen });
                        const ev = expectOf(c1, base + dice + gym, s.deadly) + c1.f * failDmg("dual") + expectOf(c2, t.avg - (t.precise ?? 0) + (qualifies(t) ? dice : 0) + cruelty(g), t.deadly) + c2.f * (qualifies(t) ? failDmg("dual") : 0);
                        if (!best || ev > best.ev) best = { key: "dual-finisher", s, bonus: b1, c: c1, ev, hit: c1.s + c1.cs, text: `Dual Finisher: ${s.label} (${signed(b1)}) at ${nameOf(f)} and ${t.label} (${signed(b2)}) at ${nameOf(g)}, both with ${N}d6 precision${eternal ? "; a miss short of a critical failure still deals its half (Eternal Confidence)" : ""}` };
                    }
                }
            }
            // Impaling Finisher (4): a second foe directly behind the first, one roll against both
            if (has(actor, "impaling-finisher") && !s.ranged && pierceOrBludgeon(s) && inReach(at, f.rect, 5)) {
                const dx = Math.sign(f.rect.x - at.x), dy = Math.sign(f.rect.y - at.y);
                const g = near.find((g) => g.rect.x === f.rect.x + dx * f.rect.w && g.rect.y === f.rect.y + dy * f.rect.h && (dx === 0 || dy === 0 || true));
                if (g) {
                    const bonus = s.bonus + finisherPen(made, s);
                    const c1 = chances(bonus, ac, { keen }), c2 = chances(bonus, g.ac, { keen });
                    const ev = expectOf(c1, base + dice + gym, s.deadly) + c1.f * failDmg("impaling") + expectOf(c2, base + dice, s.deadly) + c2.f * failDmg("impaling");
                    if (!best || ev > best.ev) best = { key: "impaling-finisher", s, bonus, c: c1, ev, hit: c1.s + c1.cs, text: `Impaling Finisher with ${s.label} (${signed(bonus)}): one roll against ${nameOf(f)} and ${nameOf(g)} behind it, ${N}d6 precision on each hit; it counts as two attacks` };
                }
            }
        }
        // Illimitable Finisher (20): Step, finish; a hit or a plain miss earns the panache back for a second finisher at once
        if (best && has(actor, "illimitable-finisher") && best.key !== "dual-finisher" && best.key !== "impaling-finisher") {
            const again = (() => { let b = null; for (const s of usable(f, at).filter(qualifies)) { const bonus = s.bonus + finisherPen(made + 1, s); const c = chances(bonus, ac, { keen }); const ev = expectOf(c, s.avg - (s.precise ?? 0) + dice + extra, s.deadly) + c.f * failDmg("confident-finisher"); if (!b || ev > b.ev) b = { s, bonus, ev }; } return b; })();
            if (again) best = { ...best, key: "illimitable-finisher", ev: best.ev + (1 - best.c.cf) * again.ev, text: `Illimitable Finisher: Step, then ${best.text}; the Strike has bravado, so unless it critically misses you have panache again and finish once more at once with ${again.s.label} (${signed(again.bonus)})` };
        }
        return best;
    };
    /** What panache is worth to keep for next turn: the finisher's edge over a plain Strike at full bonus, discounted. */
    const nextWorth = (f, at) => { const fin = finisher(f, at, 0), pl = plain(f, at, 0); return fin && pl ? Math.max(0, 0.6 * (fin.ev - pl.ev)) : 0; };

    const LABEL = { tumble: "Tumble Through", bigger: "The Bigger They Are", "bon-mot": "Bon Mot", "leading-dance": "Leading Dance", "dirty-trick": "Dirty Trick", vexing: "Vexing Tumble", feint: "Feint", trip: "Trip", grapple: "Grapple", demoralize: "Demoralize", perform: "Perform" };
    const push = (plan) => out.plans.push({ kind: "class", dest: null, notes: [], ...plan, score: plan.ev + (plan.bias ?? 0.3) });
    const reach = Math.max(myReach(board), ...board.strikes.filter((s) => isThrown(s)).map((s) => (flying ? s.range ?? 20 : 5)));
    const parry = has(actor, "extravagant-parry") && !effect(actor, /extravagant-parry|dueling-dance/) && board.strikes.some((s) => !s.ranged && (s.hands === "1" || s.item?.system?.usage?.value === "held-in-one-hand" || s.hands == null));
    const filler = () => (parry ? { cost: 1, text: `Extravagant Parry: +${freeHand ? 2 : 1} AC until your next turn, and a Strike that misses you gives panache`, worth: 1 + 0.3 } : { cost: 1, text: `Step out of reach${me.shield ? ", or Raise a Shield" : ""}`, worth: 0 });

    /* ---- the turn: [move] [bravado] Strikes, finisher last, [bravado again or a parry] ---- */
    for (const f of foes) {
        const sq = squareToReach(board, f, reach, Math.max(0, A - 1));
        if (!sq) continue;
        // Mobile Finisher (12): the Stride is part of the finisher, so a one-move foe costs no action to reach
        const mobile = panache && has(actor, "mobile-finisher") && sq.route.actions === 1 && canMove(me) ? sq : null;
        const moveActs = mobile ? 0 : sq.route.actions;
        const at = sq.route.actions ? { x: sq.x, y: sq.y, w: me.rect.w, h: me.rect.h, z: sq.z ?? me.rect.z } : me.rect;
        const dest = sq.route.actions ? { x: sq.x, y: sq.y } : null;
        const left0 = A - moveActs;
        if (left0 < 1) continue;
        const pre = bravados(f, at, moveActs, panache, ctx.made);
        const post = bravados(f, at, 0, false, 0).filter((b) => !b.attack && !b.dest);
        const worthNext = nextWorth(f, at);
        const pushed = [];
        /** Build one sequence: b1 before the attacks (or null), then k Strikes and the finisher, then b2 (or null) or the filler. */
        const build = (b1, b2, fillRest) => {
            const steps = [];
            let ev = 0, made = ctx.made, left = left0, p = 0, acAdj = 0, extra = 0, prone = 0, q = panache ? 1 : 0;
            const notes = [];
            if (mobile) { /* the Stride is inside the finisher */ } else if (moveActs && !(b1?.replacesMove)) steps.push({ cost: moveActs, text: moveText(sq, f) });
            if (b1) {
                steps.push({ cost: 1, text: b1.text });
                left -= 1; ev += b1.worth; p = b1.ogFirst; acAdj = b1.acAdj; extra = b1.firstExtra ?? 0; prone = b1.prone ?? 0;
                if (b1.attack) made += 1;
                q = panache ? 1 : 1 - b1.c.cf;
                if (!panache) notes.push("A bravado action that fails short of a critical failure still gives panache until the end of your next turn, so the finisher stays on.");
            }
            if (left < 1) return null;
            const tail = b2 ? 1 : 0;
            let k = Math.max(0, left - 1 - tail);
            if (mobile) k = 0;
            const strikes = [];
            for (let i = 0; i < k; i++) {
                const s = plain(f, at, made, { p: i === 0 ? p : (b1?.key === "feint" ? b1.c.cs : 0), extra: i === 0 ? extra : 0, acAdj });
                if (!s) break;
                strikes.push(s); ev += s.ev; made += 1; if (i === 0) { p = b1?.key === "feint" ? b1.c.cs : 0; extra = 0; }
            }
            if (strikes.length) steps.push({ cost: strikes.length, text: `Strike ${nameOf(f)} with ${strikes[0].s.label}${times(strikes.length)} (${strikes.map((x) => signed(x.bonus)).join(", ")})${N > 0 && strikes.some((x) => qualifies(x.s)) ? `, +${N} precision` : ""}` });
            const fin = finisher(f, at, made, { p: strikes.length ? 0 : p, extra: strikes.length ? 0 : extra, acAdj, prone });
            if (!fin) return null;
            const alt = q < 1 ? plain(f, at, made, { acAdj }) : null;
            const finEv = q * fin.ev + (1 - q) * (alt?.ev ?? 0);
            ev += finEv;
            steps.push({ cost: 1, text: `${mobile ? `Mobile Finisher: Stride into reach of ${nameOf(f)}, then ` : ""}${fin.text}${q < 1 ? `; with no panache at all (a critical failure, ${pct(1 - q)}), a plain Strike instead` : ""}` });
            notes.push("A finisher ends your attacks for the turn and spends the panache; it's the last Strike.");
            let after = left - 1 - strikes.length;
            if (after >= 1 && b2) { steps.push({ cost: 1, text: `${b2.text}, to have panache again next turn` }); ev += b2.worth + (1 - b2.c.cf) * worthNext; after -= 1; }
            if (after >= 1 && fillRest) { const fl = filler(); steps.push({ cost: after, text: after > 1 ? `${fl.text}; ${has(actor, "vivacious-bravado") && (b1 || b2) ? `Vivacious Bravado (${lv + cha} temporary HP after gaining panache this turn)` : "the rest is yours"}` : fl.text }); ev += fl.worth; }
            if (has(actor, "panache-paragon") && (b1 || b2)) notes.push("Panache Paragon: your extra action is only for a bravado action; spend it on that one.");
            return { steps, ev, notes, fin, b1, b2, strikes: strikes.length };
        };
        const cands = [];
        if (panache) {
            cands.push({ key: "finish-last", title: `Strike ${nameOf(f)}, finish last`, r: build(null, null, true) });
            for (const b of post) cands.push({ key: `regain-${b.key}`, title: `Finish ${nameOf(f)}, then ${LABEL[b.key] ?? cap(b.key)} for next turn`, r: build(null, b, true) });
            for (const b of pre.filter((x) => x.ogFirst > 0 || x.worth > 0)) cands.push({ key: `open-${b.key}`, title: `${LABEL[b.key] ?? cap(b.key)} ${nameOf(f)}, Strike, finish last`, r: build(b, null, true) });
        } else {
            for (const b of pre) cands.push({ key: `earn-${b.key}`, title: `${LABEL[b.key] ?? cap(b.key)} ${nameOf(f)}, then finish it`, r: build(b, null, true) });
        }
        const good = cands.filter((c) => c.r && c.r.ev > 0).sort((a, b) => b.r.ev - a.r.ev);
        for (const c of good) {
            if (pushed.length >= 2 || pushed.some((x) => x.r.fin.key === c.r.fin.key && x.r.b1?.key === c.r.b1?.key && x.r.b2?.key === c.r.b2?.key)) continue;
            if (pushed.length && c.r.ev < good[0].r.ev - 3) break;
            pushed.push(c);
            const b = c.r.b1 ?? c.r.b2;
            push({ title: c.title, target: f, ev: c.r.ev, dest: b?.dest ?? dest, steps: c.r.steps, notes: [panacheWhy && c === good[0] ? `${panacheWhy}.` : null, ...c.r.notes].filter(Boolean), bias: panache ? 0.4 : 0.3 });
        }
    }

    /* ---- notes: state, speed, reactions, parries, stances and the rest ---- */
    if (panache) n(`${panacheWhy}: a finisher is open (${N}d6 precision instead of +${N}), and it spends the panache; your Speed is up by ${speedBonus(actor, own, lv, true)} feet${has(actor, "flamboyant-athlete") ? "; Flamboyant Athlete: climb and swim at half your Speed, jump DCs down by 10, a 5-foot vertical Leap" : ""}.`);
    else n(`No panache: earn it with ${style ? STYLE_ACTION[style] : "your style's action"} or Tumble Through (bravado, +${stylish} circumstance from Stylish Combatant${derring ? "; Derring-Do rolls twice once you already have panache" : ""}), then finish. A failure short of a critical failure still gives it until the end of your next turn.${speedBonus(actor, own, lv, false) ? ` Your Speed is up by ${speedBonus(actor, own, lv, false)} feet even now (${hasAny(actor, "swashbucklers-speed", "swashbuckler-s-speed") ? "Swashbuckler's Speed" : "Vivacious Speed"}).` : ""}`);
    if (style === "fencer" && has(actor, "goading-feint")) n("Goading Feint: on a Feint that works you can take -2 to its next attack against you instead (every attack until its next turn on a critical success).");
    if (style === "braggart" && has(actor, "antagonize")) n("Antagonize: a foe you Demoralize stays at least frightened 1 until it attacks you or loses sight of you.");
    if (style === "battledancer" && has(actor, "focused-fascination")) n("Focused Fascination: a Perform aimed at one creature fascinates it on a success, not only a critical success.");
    if (has(actor, "one-for-all") && board.allies.length) n("One for All (1 action): name an ally within 30 feet; your Aid reaction for them uses Diplomacy and has bravado, so a success gives panache on their turn.");
    if (has(actor, "disarming-flair")) n("Disarming Flair: Disarm has bravado for you (Athletics vs Reflex DC), so a success gives panache along with the disarm.");
    if (has(actor, "get-used-to-disappointment")) n("Get Used to Disappointment (free action as your turn begins): if a foe within 30 feet missed you or failed a check against you last turn, Demoralize it for free with bravado; it's then immune for a minute.");
    if (has(actor, "even-the-odds") && !panacheWhy.startsWith("Even the Odds")) n(`Even the Odds (free action as your turn begins, once per 10 minutes${usesLeft(actor, "even-the-odds") === 0 ? "; used" : ""}): panache for the turn when you're flanked.`);
    if (has(actor, "finishing-follow-through")) n("Finishing Follow-Through: a finisher that drops a foe to 0 HP keeps your panache.");
    if (has(actor, "vivacious-bravado")) n(`Vivacious Bravado (1 action, after gaining panache this turn): ${lv + cha} temporary HP until your next turn.`);
    if (has(actor, "brandishing-draw")) n("Brandishing Draw (1 action): draw a weapon and Strike or use a one-action finisher with it in the same action.");
    if (has(actor, "flying-blade")) n("Flying Blade: a thrown agile or finesse weapon in its first range increment carries precise strike and can be a finisher.");
    if (has(actor, "twirling-throw")) n("Twirling Throw (1 action, finisher): a thrown Strike with no penalty out to the third range increment; the weapon comes back unless you critically miss.");
    if (has(actor, "distracting-toss")) n("Distracting Toss (2 actions, bravado): Feint a foe within 30 feet, then draw and throw a weapon at it; the Feint counts for the throw.");
    if (has(actor, "dastardly-dash")) n(`Dastardly Dash (1 action, flourish): Stride half your Speed and Trip${has(actor, "dirty-trick") || style === "rascal" ? " or Dirty Trick" : ""} a foe you pass${style === "gymnast" || style === "rascal" ? " (bravado for you)" : ""}.`);
    if (has(actor, "leading-dance") && style !== "battledancer") n("Leading Dance (1 action, bravado): Performance against an adjacent foe's Will DC to move 5 feet together, 10 on a critical success, without reactions.");
    if (has(actor, "the-bigger-they-are") && !foes.some((f) => (f.sizeRank ?? 2) > (me.sizeRank ?? 2))) n(`The Bigger They Are (1 action, bravado): Tumble Through a bigger foe; if it works it has weakness ${Math.floor(lv / 2)} to your precision damage on your next attack.`);
    if (has(actor, "flamboyant-leap")) n("Flamboyant Leap (2 actions): a Leap, High Jump or Long Jump of up to twice your Speed with a one-action finisher anywhere along it.");
    if (has(actor, "flamboyant-cruelty")) { const marked = foes.filter((f) => cruelty(f) > 0); n(marked.length ? `Flamboyant Cruelty: ${marked.map((f) => `${nameOf(f)} (+${cruelty(f)})`).join(", ")} ${marked.length === 1 ? "has" : "have"} two or more of clumsy, drained, enfeebled, frightened, sickened and stupefied; the plans count the bonus, and a hit gives +1 on your bravado checks this turn.` : "Flamboyant Cruelty: +2 or more damage on a foe with two or more of clumsy, drained, enfeebled, frightened, sickened and stupefied, and +1 on your bravado checks after you hit it."); }
    if (has(actor, "agile-maneuvers")) n(`Agile Maneuvers: Trip, Grapple, Shove, Disarm and Reposition are at -4 then -8 as your later attacks${board.strikes.some((s) => !s.ranged && s.agile) ? ", -3 then -6 with your agile weapon while you have panache" : ""}.`);
    if (combination) n("Combination Finisher: a finisher as your second attack is at -4 (-3 agile), as your third at -8 (-6 agile); the plans count it.");
    if (has(actor, "precise-finisher")) n("Precise Finisher: a Confident Finisher that misses short of a critical failure deals the full dice, not half.");
    if (eternal) n("Eternal Confidence: every finisher's Strike and your Opportune Riposte take Confident Finisher's failure effect; the plans count it.");
    if (has(actor, "panache-paragon")) n("Panache Paragon: you're permanently quickened; the extra action does only a bravado action.");
    if (derring && !panache) n("Derring-Do: with panache already up, your bravado checks and Tumble Through roll twice.");
    // reactions
    if (hasAny(actor, "opportune-riposte", "swashbucklers-riposte", "swashbuckler-s-riposte") || (own && lv >= 3)) {
        const bits = [];
        if (has(actor, "impossible-riposte")) bits.push("Impossible Riposte: also from outside your reach, a ranged attack turned back as its own damage type");
        if (has(actor, "parry-and-riposte")) bits.push("Parry and Riposte: on a plain miss too, against a foe you finished last turn while you have a parry bonus to AC");
        if (has(actor, "felicitous-riposte")) bits.push("Felicitous Riposte: roll the attack twice");
        if (has(actor, "reflexive-riposte")) bits.push("Reflexive Riposte: a second reaction each turn, only for it");
        if (has(actor, "inexhaustible-countermoves")) bits.push("Inexhaustible Countermoves: one more on each enemy's turn");
        if (eternal) bits.push("Eternal Confidence: a miss still deals Confident Finisher's failure damage");
        n(`Opportune Riposte fires when a foe in your reach critically fails a Strike against you: a Strike back (with precise strike) or a Disarm, and it has bravado${bits.length ? `. ${bits.join("; ")}.` : "."}`);
    }
    if (hasAny(actor, "flashy-dodge", "nimble-dodge")) n(`${has(actor, "flashy-dodge") ? "Flashy Dodge" : "Nimble Dodge"} fires when a foe you can see attacks you: +2 AC against it, and panache until the end of your next turn if it misses${has(actor, "flashy-roll") ? "; Flashy Roll: before a Reflex save too, and a Stride of 10 feet when the attack or effect fails" : ""}.`);
    if (has(actor, "charmed-life")) n(`Charmed Life fires before you roll a save: +2, and panache until the end of your next turn if it succeeds${has(actor, "incredible-luck-swashbuckler") || has(actor, "incredible-luck") ? "; Incredible Luck: the save rolls twice" : ""}.`);
    if (hasAny(actor, "guardian-s-deflection-swashbuckler", "guardians-deflection-swashbuckler")) { const near = board.allies.filter((a) => inReach(me.rect, a.rect, myReach(board))); n(near.length ? `Guardian's Deflection fires when ${near.map(nameOf).join(" or ")} is hit by a margin of 2 or less, if you hold one one-handed weapon with the other hand free: the hit misses and you gain panache.` : "Guardian's Deflection fires when an ally in your reach is hit by 2 or less, with a single one-handed weapon and a free hand: the hit misses and you gain panache."); }
    if (has(actor, "switcheroo") && panache && foes.some((f) => inReach(me.rect, f.rect, 5))) n("Switcheroo fires when a ranged attack targets you, with panache and a foe adjacent: Reposition it into the attack's path; a failure costs the panache.");
    if (has(actor, "cheat-death")) n("Cheat Death fires when damage would drop you: you stay at 1 HP with panache and become doomed 1 for 10 minutes.");
    if (has(actor, "plummeting-roll")) n("Plummeting Roll fires when you fall: no damage from a fall you can land.");
    // parries and stances
    if (has(actor, "extravagant-parry") && !has(actor, "dueling-dance-swashbuckler")) n(`Extravagant Parry (1 action, a one-handed weapon in hand): +1 AC until your next turn, +2 with a free hand or a parry weapon; a Strike that misses you then gives panache.`);
    if (has(actor, "dueling-dance-swashbuckler") || has(actor, "dueling-dance")) n(effect(actor, /dueling-dance/) ? "Dueling Dance: Extravagant Parry's bonus is on you while you stay in the stance; a miss gives panache." : "Dueling Dance (1 action, stance): with a single one-handed weapon and a free hand, Extravagant Parry's +2 AC stays up, and every Strike that misses you gives panache.");
    if (has(actor, "elegant-buckler")) n("Elegant Buckler: a raised buckler gives +2 AC, and a foe that critically misses you while it's raised gives you panache.");
    if (has(actor, "buckler-dance")) n(effect(actor, /buckler-dance/) ? "Buckler Dance: your buckler counts as raised without the action while you stay in the stance." : "Buckler Dance (1 action, stance): your buckler stays raised without spending an action each turn.");
    if (hasAny(actor, "twinned-defense-swashbuckler", "twinned-defense")) n(effect(actor, /twinned-defense/) ? "Twinned Defense: Twin Parry's +1 AC is on you while you hold both weapons in the stance." : "Twinned Defense (1 action, stance): with a weapon in each hand, Twin Parry's +1 AC stays up.");
    if (has(actor, "vivacious-afterimage") && panache) n("Vivacious Afterimage (1 action, needs panache): Stride and leave an image of yourself that counts for flanking until a foe disbelieves it.");
    if (has(actor, "after-you") && !(typeof game !== "undefined" && game.combat?.started)) n("After You (free action before initiative): go last and start with panache.");
    if (has(actor, "swaggering-initiative") && !(typeof game !== "undefined" && game.combat?.started)) n("Swaggering Initiative (free action before initiative): +2 to initiative, draw a weapon, and panache if you act first.");
    if (has(actor, "swan-dive")) n("Swan Dive (1 action, bravado): dive into water from any height without damage and Swim your Speed.");
}

/** The status bonus to Speed: Stylish Combatant +5 with panache; Vivacious Speed (3) +10, +5 at 7, 11, 15 and 19, half of it without panache. */
function speedBonus(actor, own, lv, panache) {
    if (has(actor, "swashbucklers-speed") || has(actor, "swashbuckler-s-speed")) return panache ? 10 : 5;
    const vivacious = has(actor, "vivacious-speed") || (own && lv >= 3);
    if (!vivacious) return panache ? 5 : 0;
    const full = 10 + 5 * [7, 11, 15, 19].filter((x) => lv >= x).length;
    return panache ? full : Math.floor(full / 2 / 5) * 5;
}

export { swashbuckler };
