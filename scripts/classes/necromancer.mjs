/**
 * PF2e Tactics: classes/necromancer.mjs
 * See classes/_common.mjs for the shape of a class read.
 * The necromancer's layer over the advisor: thralls (found among the allies by the thrall trait or name), Create Thrall
 * and Thrall Charge as thrall turns, the grave spells that spend a thrall cast from the thrall's square (Necrotic Bomb,
 * Bone Spear, Bony Barrage, Deathly Scream, Dead Weight, Life Tap, Blood Infusion, Muscle Barrier, Song of the Soul,
 * Zombie Horde, Bloody Tendrils, Bind Heroic Spirit, Blossoming Gore, Flesh Tsunami, Calcification), the fatal method
 * (Reaper's free Strike, Puppeteer's second thrall and Consume Thrall), Draining Strike, Reclaim Power, Amalgamate,
 * Anatomical Quartering, and the riders every destroyed thrall sets off. The rest are when-notes.
 * The grave spells and the two grave cantrips are taken out of board.spells: the advisor would cast them from your own
 * square, and they originate from a thrall.
 */
import { bestStrike, effect, focusLeft, has, hasAny, level, moveText, myReach, pct, slugOf, squareToReach, strikeRun, targets, usesLeft, worth, degreeChances, feetBetween, inReach, mapFor, strikeExpected, saveExpected, nameOf, signed } from "./_common.mjs";
import { areaTest, centerOf, rectInArea } from "../reader.mjs";

const spellDC = (board) => Math.max(0, ...(board.spells ?? []).map((s) => Number(s.dc) || 0)) || Number(board.me.actor?.classDC?.value) || 10 + level(board) + 5;
const spellAttack = (board) => Math.max(0, ...(board.spells ?? []).map((s) => Number(s.attack) || 0)) || spellDC(board) - 10;
const sq1 = (x, y, z = 0) => ({ x, y, w: 1, h: 1, z });
const n2 = (x) => Math.round(x * 10) / 10;

/**
 * The grave spells: the catalog's text, reduced to what a plan needs. rank: the rank the spell is learned at (focus spells
 * heighten to half your level); cost in actions; from: how far the target thrall may be from you; reach: the effect's
 * reach from the thrall; feat: the feat that teaches it (null for the fascination spells and Necrotic Bomb).
 */
const GRAVE = {
    "necrotic-bomb": { name: "Necrotic Bomb", cost: 2, rank: 1, from: 30, kind: "area", shape: "emanation", size: 10, save: "fortitude", basic: true, die: 6.5, type: "void", feat: null },
    "bone-spear": { name: "Bone Spear", cost: 2, rank: 1, from: 30, kind: "area", shape: "line", size: 15, save: "reflex", basic: true, die: 7, type: "piercing", feat: null, fascination: "bone" },
    "blood-infusion": { name: "Blood Infusion", cost: 2, rank: 1, from: 30, kind: "one", reach: 15, save: "fortitude", feat: null, fascination: "blood" },
    "dead-weight": { name: "Dead Weight", cost: 2, rank: 1, from: 30, kind: "one", reach: 15, save: "fortitude", feat: null, fascination: "flesh" },
    "life-tap": { name: "Life Tap", cost: 2, rank: 1, from: 30, kind: "one", reach: 30, save: "fortitude", feat: null, fascination: "spirit" },
    "deathly-scream": { name: "Deathly Scream", cost: 1, rank: 1, from: 30, kind: "area", shape: "emanation", size: 5, save: "will", basic: false, die: 2.5, type: "mental", feat: "deathly-scream" },
    "muscle-barrier": { name: "Muscle Barrier", cost: 2, rank: 1, from: 30, kind: "ally", reach: 15, feat: "muscle-barrier" },
    "song-of-the-soul": { name: "Song of the Soul", cost: 2, rank: 1, from: 30, kind: "ally", reach: 15, feat: "song-of-the-soul" },
    "bony-barrage": { name: "Bony Barrage", cost: 2, rank: 2, from: 30, kind: "area", shape: "cone", size: 30, save: "reflex", basic: true, die: 5.5, type: "piercing", feat: "bony-barrage" },
    "bind-heroic-spirit": { name: "Bind Heroic Spirit", cost: 2, rank: 3, from: 30, kind: "self", feat: "bind-heroic-spirit" },
    "bloody-tendrils": { name: "Bloody Tendrils", cost: 1, rank: 3, from: 30, kind: "make", feat: "bloody-tendrils" },
    "zombie-horde": { name: "Zombie Horde", cost: 2, rank: 3, from: 30, kind: "area", shape: "burst", size: 10, save: "fortitude", basic: true, die: 2.5, type: "bludgeoning", feat: "zombie-horde-necromancer", feat2: "zombie-horde" },
    "conglomerate-of-limbs": { name: "Conglomerate of Limbs", cost: 1, rank: 4, from: 30, kind: "make", feat: "conglomerate-of-limbs" },
    "sanguine-transference": { name: "Sanguine Transference", cost: 1, rank: 4, from: 60, kind: "move", feat: "sanguine-transference" },
    "blossoming-gore": { name: "Blossoming Gore", cost: 2, rank: 5, from: 60, kind: "area", shape: "burst", size: 20, save: "fortitude", basic: false, feat: "blossoming-gore" },
    "bridge-of-graves": { name: "Bridge of Graves", cost: 2, rank: 6, from: 30, kind: "other", feat: "bridge-of-graves" },
    "recurring-nightmare": { name: "Recurring Nightmare", cost: 1, rank: 7, from: 60, kind: "make", feat: "recurring-nightmare" },
    "skeletal-lancers": { name: "Skeletal Lancers", cost: 1, rank: 7, from: 60, kind: "make", feat: "skeletal-lancers" },
    "flesh-tsunami": { name: "Flesh Tsunami", cost: 2, rank: 8, from: 30, kind: "area", shape: "cone", size: 60, save: "fortitude", basic: false, feat: "flesh-tsunami" },
    "temporary-possession": { name: "Temporary Possession", cost: 1, rank: 8, from: 30, kind: "one", reach: 15, save: "will", feat: "temporary-possession" },
    "calcification": { name: "Calcification", cost: 2, rank: 9, from: 30, kind: "one", reach: 60, save: "fortitude", feat: "calcification" },
    "dread-mosquito-storm": { name: "Dread Mosquito Storm", cost: 3, rank: 9, from: 120, kind: "other", feat: "dread-mosquito-storm" },
    "reanimate-foe": { name: "Reanimate Foe", cost: 3, rank: 9, from: 30, kind: "other", feat: "reanimate-foe" },
    "living-graveyard": { name: "Living Graveyard", cost: 1, rank: 10, from: 120, kind: "make", feat: "living-graveyard" },
    "perfected-thrall": { name: "Perfected Thrall", cost: 1, rank: 10, from: 60, kind: "make", feat: "perfected-thrall" },
};
const SPELL_SLUG = (name) => String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** The character's thralls among its allies: the thrall trait on the token or its actor, or "thrall" in its name. */
function thrallsOf(board) {
    return board.allies.filter((a) => {
        const traits = [...(a.traits ?? a.actor?.traits ?? a.actor?.system?.traits?.value ?? [])];
        if (traits.includes("thrall")) return true;
        return /\bthralls?\b/i.test(a.name ?? "") || /\bthralls?\b/i.test(a.actor?.name ?? "");
    }).filter((a) => a.rect && a.canAct !== false);
}
/** A thrall count the sheet keeps when thralls aren't tokens: a resource or flag named for them. */
function thrallResource(actor) {
    const res = actor?.system?.resources ?? {};
    for (const [k, v] of Object.entries(res)) if (/thrall/i.test(k) && typeof v?.value === "number") return v.value;
    const flag = actor?.flags?.pf2e?.thralls ?? actor?.flags?.["pf2e-tactics"]?.thralls ?? null;
    return typeof flag === "number" ? flag : null;
}
/** The prepared entries' slots by rank { left, max } (the dirge is prepared), and the highest rank. */
function slotsOf(actor) {
    const byRank = {};
    let top = 0;
    for (const entry of actor?.spellcasting?.regular ?? []) {
        if (entry.isFocusPool) continue;
        const slots = entry.system?.slots ?? {};
        for (const [key, slot] of Object.entries(slots)) {
            const rank = Number(key.replace(/\D/g, ""));
            if (!rank || rank > 10) continue;
            const max = Number(slot.max) || 0;
            if (!max) continue;
            top = Math.max(top, rank);
            const list = Array.isArray(slot.prepared) ? slot.prepared : Object.values(slot.prepared ?? {});
            const left = list.length ? list.filter((p) => p?.id && !p.expended).length : Number(slot.value) || 0;
            byRank[rank] = { left: (byRank[rank]?.left ?? 0) + left, max: (byRank[rank]?.max ?? 0) + max };
        }
    }
    return { byRank, top: top || Math.max(1, Math.ceil((actor?.level ?? 1) / 2)) };
}

function necromancer(board, ctx, out) {
    const actor = board.me.actor;
    const me = board.me;
    const lv = level(board);
    const cls = actor?.class?.slug === "necromancer";
    const dedication = has(actor, "necromancer-dedication");
    if (!cls && !has(actor, "grave-spells") && !dedication) return;
    const archetype = !cls && dedication;
    const rank = Math.max(1, Math.ceil(lv / 2));
    const dc = spellDC(board);
    const atk = spellAttack(board);
    const fp = focusLeft(actor);
    const fpMax = Number(actor?.system?.resources?.focus?.max) || 0;
    const foes = targets(board).filter((f) => f.hp > 0 && !f.conditions?.has?.("dying"));
    const puppeteer = has(actor, "puppeteer");
    const reaper = has(actor, "reaper");
    const fascination = ["blood", "bone", "flesh", "spirit"].find((s) => has(actor, s)) ?? null;
    const sanctified = has(actor, "the-hallowed-dead") ? "holy" : has(actor, "the-unholy-dead") ? "unholy" : null;
    const spiritDmg = sanctified ? (lv >= 10 ? 2 : 1) : 0;
    const thrallSpeed = 25 + (fascination === "bone" ? 5 : 0);
    const thrallDie = 3.5; // a thrall's Strike, when its token doesn't say: 1d6 at your spell attack modifier
    const thralls = thrallsOf(board);
    const counted = thralls.length ? null : thrallResource(actor);
    const hasThrallCharge = !archetype || has(actor, "thrall-charger");
    const chargeDice = rank >= 10 ? 4 : rank >= 6 ? 3 : rank >= 2 ? 2 : 1;
    const drainThralls = lv >= 18 ? 3 : lv >= 10 ? 2 : 1;

    // ---- the grave spells this character knows, from its features and feats; the board's entries give the real DC and damage
    const known = new Map();
    const onBoard = new Map((board.spells ?? []).map((sp) => [SPELL_SLUG(sp.name), sp]));
    for (const [slug, g] of Object.entries(GRAVE)) {
        const taught = slug === "necrotic-bomb" ? (!archetype || has(actor, "necrotic-bomber")) : g.fascination ? (fascination === g.fascination || has(actor, "widespread-fascination") && onBoard.has(slug)) : hasAny(actor, g.feat, g.feat2 ?? g.feat) || onBoard.has(slug);
        if (taught) known.set(slug, { ...g, sp: onBoard.get(slug) ?? null });
    }
    // Take the grave spells and the grave cantrips away from the advisor: they originate from a thrall, not from you
    const mine = new Set([...known.keys(), "create-thrall", "thrall-charge"]);
    board.spells = (board.spells ?? []).filter((sp) => !(mine.has(SPELL_SLUG(sp.name)) && (sp.focus || sp.cantrip || (sp.traits ?? []).includes("necromancer"))));
    const consume = puppeteer && fp === 0 && (usesLeft(actor, "consume-thrall") ?? 1) > 0 && thralls.some((t) => feetBetween(me.rect, t.rect) <= 30);
    const canFocus = (fp ?? 0) > 0 || consume;

    const push = (plan) => out.plans.push({ kind: "class", dest: null, notes: [], ...plan, score: plan.score ?? plan.ev + (plan.bias ?? 0.4) });
    const free = (x, y) => !board.occupant?.get?.(`${x},${y}`) && !(x >= me.rect.x && x < me.rect.x + me.rect.w && y >= me.rect.y && y < me.rect.y + me.rect.h);
    const seen = (r) => !board.lineBlocked || !board.lineBlocked(centerOf(me.rect), centerOf(r));
    /** Unoccupied squares beside f within reach feet of you with a line to them, nearest you first. */
    const ring = (f, maxFeet = 30) => {
        const cands = [];
        for (let x = f.rect.x - 1; x <= f.rect.x + f.rect.w; x++) for (let y = f.rect.y - 1; y <= f.rect.y + f.rect.h; y++) {
            if (x >= f.rect.x && x < f.rect.x + f.rect.w && y >= f.rect.y && y < f.rect.y + f.rect.h) continue;
            const r = sq1(x, y, f.rect.z ?? 0);
            if (!free(x, y) || feetBetween(me.rect, r) > maxFeet || !seen(r)) continue;
            cands.push(r);
        }
        return cands.sort((a, b) => feetBetween(me.rect, a) - feetBetween(me.rect, b));
    };
    /** Crosses: does a flanker at a and one at b sandwich the target? (reader's flanks, kept local by center lines) */
    const flanksAt = (a, b, t) => {
        const A = centerOf(a), B = centerOf(b);
        const L = t.x, R = t.x + t.w, T = t.y, Bm = t.y + t.h;
        const cross = (p1, p2, p3, p4) => { const d = (u, v, w) => (v.x - u.x) * (w.y - u.y) - (v.y - u.y) * (w.x - u.x); const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4); return d1 * d2 < 0 && d3 * d4 < 0; };
        return (cross(A, B, { x: L, y: T }, { x: L, y: Bm }) && cross(A, B, { x: R, y: T }, { x: R, y: Bm })) || (cross(A, B, { x: L, y: T }, { x: R, y: T }) && cross(A, B, { x: L, y: Bm }, { x: R, y: Bm }));
    };
    /** A melee ally (or you) in reach of f that a thrall in r would flank it with, and what that's worth. */
    const flankWith = (f, r) => {
        if (f.conditions?.has?.("off-guard") || f.flankImmune === "all") return null;
        const partners = board.allies.filter((a) => !thralls.includes(a) && a.canAct !== false && a.hasMelee !== false && a.rect && inReach(a.rect, f.rect, a.reach ?? 5));
        if (board.strikes.some((s) => !s.ranged) && inReach(me.rect, f.rect, myReach(board))) partners.push({ ...me, name: "you", self: true, reactiveStrike: { avg: Math.max(0, ...board.strikes.filter((s) => !s.ranged).map((s) => s.avg)) } });
        for (const a of partners) if (flanksAt(a.rect, r, f.rect)) return { ally: a, ev: 0.1 * (a.reactiveStrike?.avg ?? 6) * 2 * (a.self ? 1 : 1.5) };
        return null;
    };
    const flankText = (fw, f) => (fw ? `; it flanks ${nameOf(f)} with ${fw.ally.self ? "you" : nameOf(fw.ally)} (off-guard to ${fw.ally.self ? "you" : "them"})` : "");
    /** What destroying a thrall sets off on this sheet, for the plan's notes. */
    const riders = (() => {
        const r = [];
        if (fascination === "blood") r.push(`Blood: you regain ${Math.ceil(lv / 4)} HP per thrall destroyed`);
        if (fascination === "flesh") r.push("Flesh: the thrall can leave difficult terrain in its square for 10 minutes");
        if (lv >= 12 && has(actor, "thick-skin")) r.push(`Thick Skin: the first thrall you destroy each round makes every foe adjacent to you save (DC ${dc}) or be sickened 1`);
        if (lv >= 12 && has(actor, "sanguine-mastery")) r.push("Sanguine Mastery: a creature adjacent to the destroyed thrall takes 1 bleed, or its bleed grows by 1");
        if (lv >= 12 && has(actor, "become-as-spirit")) r.push(`Become as Spirit: resistance ${Math.floor(lv / 2)} to most damage for a round`);
        if (lv >= 12 && has(actor, "reinforced-skeleton")) r.push("Reinforced Skeleton: +10 feet to your Speeds for a round");
        return r;
    })();
    const riderNote = riders.length ? `Destroying a thrall: ${riders.join("; ")}.` : null;
    /** The Focus Point line for a grave spell plan. */
    const fpText = (g) => (consume ? `Consume Thrall first (free, once a day): destroy a thrall within 30 feet for the Focus Point this spell needs` : `spends 1 Focus Point (${fp} of ${fpMax} left)`);
    const fpReserve = () => (consume ? 2 : Math.max(0, fpMax - (fp ?? 0)) + 1); // the point's cost for the rest of the fight: steeper when the pool is low
    const ally = (test) => [me, ...board.allies.filter((a) => !thralls.includes(a) && a.rect)].filter(test);
    const missing = (c) => Math.max(0, (c.maxHp ?? 0) - (c.hp ?? 0));

    // ---- what the thralls look like
    if (thralls.length) {
        const near = thralls.filter((t) => feetBetween(me.rect, t.rect) <= 30).length;
        out.notes.push(`Thralls on the field: ${thralls.length} (${near} within 30 feet). They act only when you Command them (1 action) or cast Thrall Charge, Strike at ${signed(atk)} (your spell attack, counting toward your multiple attack penalty${spiritDmg ? `, +${spiritDmg} spirit from ${sanctified === "holy" ? "The Hallowed Dead" : "The Unholy Dead"}` : ""}) and fall to any damage; a thrall beside a foe flanks it for a melee ally on the far side.`);
    } else if (counted != null) out.notes.push(`Your sheet counts ${counted} thrall${counted === 1 ? "" : "s"} but none is a token on the field: the plans create fresh ones and can't place the counted ones.`);
    else out.notes.push("No thrall tokens on the field (the read looks for the thrall trait or \"thrall\" in a token's name among your allies): the plans below create their own with Create Thrall.");
    if (riderNote) out.notes.push(riderNote);

    // ---- thrall turns: Create Thrall beside a foe and Strike with it, Thrall Charge, Reaper's and Puppeteer's extras
    const strikeAt = (f, made, extra = 0) => strikeExpected(atk + mapFor(made, false), f.ac, thrallDie + spiritDmg + extra);
    const existingBy = (f) => thralls.filter((t) => inReach(t.rect, f.rect, t.reach ?? 5));
    // Thrall Charge: "range 30 feet; target 1 of your thralls": the thrall within 30 feet of you, the foe within its Stride
    const chargeable = (f) => thralls.filter((t) => feetBetween(me.rect, t.rect) <= 30 && feetBetween(t.rect, f.rect) <= thrallSpeed + 5 && (t.canAct !== false));
    const bestFree = new Map(); // per foe: the best free thrall turn's ev, for the Focus Point comparison
    const freePlans = [];
    const pushFree = (plan) => freePlans.push(plan);
    for (const f of foes) {
        const squares = ring(f);
        const sq = squares.map((r) => ({ r, fw: flankWith(f, r) })).sort((a, b) => (b.fw?.ev ?? 0) - (a.fw?.ev ?? 0))[0] ?? null;
        // The Necromancer Dedication's thrall (1 action, once per turn): one thrall beside f; its Strike is a Command a Thrall (1 action)
        if (archetype && sq && ctx.actions >= 2 && feetBetween(me.rect, sq.r) <= 30) {
            const create = { cost: 1, text: `Create a thrall beside ${nameOf(f)} (Necromancer Dedication, once per turn)${flankText(sq.fw, f)}` };
            const e = strikeAt(f, ctx.made);
            // Command it to Strike (1 action), then your own Strikes; or, with Thrall Charger and three actions, Thrall Charge it
            let steps = [create, { cost: 1, text: `Command a Thrall: it Strikes ${nameOf(f)} (${signed(atk + mapFor(ctx.made, false))}, about ${n2(thrallDie + spiritDmg)})` }];
            let ev = e.expected;
            if (ctx.actions >= 3) { const r = strikeRun(board, f, ctx.actions - 2, { made: ctx.made + 1, acAdj: sq.fw?.ally?.self ? -2 : 0 }); if (r.used.length && inReach(me.rect, f.rect, myReach(board))) { ev += r.ev; steps.push({ cost: r.used.length, text: r.text }); } }
            const charge = hasThrallCharge && ctx.actions >= 3 ? strikeAt(f, ctx.made, chargeDice * 3.5 + rank) : null;
            if (charge && charge.expected > ev) { ev = charge.expected; steps = [create, { cost: 2, text: `Thrall Charge: the thrall Strikes ${nameOf(f)} (${signed(atk + mapFor(ctx.made, false))}) for +${chargeDice}d6, destroyed for +${rank} more` }]; }
            ev += sq.fw?.ev ?? 0;
            bestFree.set(f.id, Math.max(bestFree.get(f.id) ?? 0, ev));
            pushFree({ title: `Create a thrall beside ${nameOf(f)}, then Strike with it`, target: f, ev, bias: 0.3, steps, notes: ["The dedication's action only makes the thrall; its Strike is a Command a Thrall (or Thrall Charge) of its own. Thralls last a minute."] });
        }
        // Create Thrall (1 action, the cantrip): a thrall beside f that Strikes at once; Reaper's free Strike; Puppeteer's second thrall
        if (!archetype && sq && ctx.actions >= 1 && feetBetween(me.rect, sq.r) <= 30) {
            const e = strikeAt(f, ctx.made);
            const ogAdj = sq.fw?.ally?.self ? -2 : 0;
            const teamwork = reaper && board.strikes.some((s) => !s.ranged) && inReach(me.rect, f.rect, myReach(board)) ? bestStrike(board, f, { made: ctx.made, acAdj: ogAdj }) : null;
            const teamworkLate = teamwork ? bestStrike(board, f, { made: ctx.made + 1, acAdj: ogAdj }) : null;
            // Reaper: the thrall's Strike counts toward your penalty, so two thralls and your own Strike at full bonus can beat it
            const twoThralls = teamwork && teamwork.e.expected > e.expected + teamworkLate.e.expected;
            let ev = (twoThralls ? 0 : e.expected) + (sq.fw?.ev ?? 0);
            const steps = [{ cost: 1, text: twoThralls ? `Create Thrall: two thralls, one beside ${nameOf(f)}${flankText(sq.fw, f)}` : `Create Thrall beside ${nameOf(f)} and Command it to Strike (${signed(atk + mapFor(ctx.made, false))}, about ${n2(thrallDie + spiritDmg)}${spiritDmg ? ` with ${spiritDmg} spirit` : ""})${flankText(sq.fw, f)}${puppeteer ? "; Thrall Proliferation: a second thrall anywhere in range" : ""}` }];
            let made = ctx.made + (twoThralls ? 0 : 1);
            const notes = [];
            if (teamwork) {
                const b = twoThralls ? teamwork : teamworkLate;
                ev += b.e.expected; steps.push({ cost: 0, text: `Thrall Teamwork: a free melee Strike at ${nameOf(f)} with ${b.s.label} (${signed(b.bonus)})${sq.fw?.ally?.self ? ", off-guard" : ""}` }); made += 1;
            }
            if (ctx.actions >= 2) {
                // The actions left: Thrall Charge with the new thrall (destroying it for +rank), or your own Strikes
                const left = ctx.actions - 1;
                if (hasThrallCharge && left >= 2) {
                    const c = strikeAt(f, made, chargeDice * 3.5 + rank);
                    ev += c.expected;
                    steps.push({ cost: 2, text: `Thrall Charge: the thrall Strikes ${nameOf(f)} again (${signed(atk + mapFor(made, false))}) for +${chargeDice}d6, destroyed for +${rank} more` });
                    if (riderNote) notes.push(riderNote);
                } else {
                    const r = strikeRun(board, f, left, { made, acAdj: ogAdj });
                    if (r.used.length && inReach(me.rect, f.rect, myReach(board))) { ev += r.ev; steps.push({ cost: r.used.length, text: r.text }); }
                }
            }
            bestFree.set(f.id, Math.max(bestFree.get(f.id) ?? 0, ev));
            pushFree({ title: `Create Thrall beside ${nameOf(f)}, then Strike`, target: f, ev, bias: 0.3, steps, notes: [...notes, "Create Thrall has the manipulate trait: it provokes from a foe in your reach. Thralls last a minute."] });
        }
        // Command a Thrall (1 action): a thrall already beside f Strikes it
        const by = existingBy(f)[0];
        if (by && ctx.actions >= 1) {
            const dieOf = (by.reactiveStrike?.avg > 0 && by.reactiveStrike.avg < 20 ? by.reactiveStrike.avg : thrallDie) + spiritDmg;
            const e = strikeExpected(atk + mapFor(ctx.made, false), f.ac, dieOf);
            const r = ctx.actions >= 2 && board.strikes.some((s) => !s.ranged) && inReach(me.rect, f.rect, myReach(board)) ? strikeRun(board, f, ctx.actions - 1, { made: ctx.made + 1 }) : null;
            const ev = e.expected + (r?.ev ?? 0);
            bestFree.set(f.id, Math.max(bestFree.get(f.id) ?? 0, ev));
            pushFree({ title: `Command ${nameOf(by)} to Strike ${nameOf(f)}`, target: f, ev, bias: 0.2, steps: [{ cost: 1, text: `Command a Thrall: ${nameOf(by)} Strikes ${nameOf(f)} (${signed(atk + mapFor(ctx.made, false))}, about ${n2(dieOf)})` }, ...(r?.used.length ? [{ cost: r.used.length, text: r.text }] : [])], notes: ["One action for one thrall Strike; Thrall Charge gets the same thrall a Stride and extra dice for two."] });
        }
        // Thrall Charge (2 actions, cantrip) with a thrall already on the field
        if (hasThrallCharge && ctx.actions >= 2) {
            const t = chargeable(f).sort((a, b) => feetBetween(a.rect, f.rect) - feetBetween(b.rect, f.rect))[0];
            if (t) {
                const dieOf = (t.reactiveStrike?.avg > 0 && t.reactiveStrike.avg < 20 ? t.reactiveStrike.avg : thrallDie) + spiritDmg;
                const keep = strikeExpected(atk + mapFor(ctx.made, false), f.ac, dieOf + chargeDice * 3.5);
                const spend = strikeExpected(atk + mapFor(ctx.made, false), f.ac, dieOf + chargeDice * 3.5 + rank);
                const fw = inReach(t.rect, f.rect, 5) ? null : (ring(f, 999).map((r) => ({ r, fw: flankWith(f, r) })).find((x) => x.fw)?.fw ?? null);
                const ev = Math.max(keep.expected, spend.expected - 0.5) + (fw?.ev ?? 0);
                pushFree({ title: `Thrall Charge: ${nameOf(t)} on ${nameOf(f)}`, target: f, ev, bias: 0.3, steps: [{ cost: 2, text: `Thrall Charge: ${nameOf(t)} Strides${inReach(t.rect, f.rect, 5) ? "" : ` up to ${thrallSpeed} feet`} and Strikes ${nameOf(f)} (${signed(atk + mapFor(ctx.made, false))}, about ${n2(dieOf + chargeDice * 3.5)} with +${chargeDice}d6); destroy it on the hit for +${rank} when you won't need it${fw ? `; end its Stride across ${nameOf(f)} from ${fw.ally.self ? "you" : nameOf(fw.ally)} to flank` : ""}` }], notes: riderNote ? [riderNote] : [] });
                bestFree.set(f.id, Math.max(bestFree.get(f.id) ?? 0, ev));
            }
        }
    }

    for (const kind of ["Create Thrall", "Create a thrall", "Thrall Charge", "Command"]) for (const p of freePlans.filter((x) => x.title.startsWith(kind)).sort((a, b) => b.ev - a.ev).slice(0, 3)) push(p);

    // ---- the grave spells that spend a thrall, cast from the thrall's square (an existing thrall, or one made this turn)
    const foesInArea = (shape, size, from, aim) => {
        const t = areaTest(shape, size, { origin: shape === "burst" ? { x: from.x, y: from.y } : null, aim: aim ? centerOf(aim) : null, self: from });
        return { foes: foes.filter((e) => rectInArea(t.test, e.rect)), allies: ally((a) => rectInArea(t.test, a.rect)) };
    };
    const degree = (f, stat) => degreeChances(f.saves?.[stat] ?? 5 + lv, dc);
    /** Options to have a thrall in r against f: 0 actions when one stands there, 1 (Create Thrall) otherwise. */
    const thrallAt = (f, want, from = 30) => {
        const have = thralls.filter((t) => feetBetween(me.rect, t.rect) <= from && want(t.rect));
        if (have.length) return { cost: 0, r: have[0].rect, who: nameOf(have[0]), text: `${nameOf(have[0])} (already there)` };
        if (ctx.actions < 1) return null;
        const r = ring(f).find((x) => want(x));
        return r ? { cost: 1, r, who: "the new thrall", text: "Create Thrall beside it" } : null;
    };
    for (const [slug, g] of known) {
        if (rank < g.rank || !canFocus) continue;
        if (!["area", "one", "ally", "self"].includes(g.kind)) continue;
        const sp = g.sp;
        const dmg = sp?.avg > 0 ? sp.avg : g.die ? g.die * rank : 0;
        const drafts = [];
        for (const f of (g.kind === "self" ? [null] : g.kind === "ally" ? [null] : foes)) {
            let best = null;
            const consider = (cand) => { if (cand && (!best || cand.ev > best.ev)) best = cand; };
            const need = ctx.actions - g.cost;
            if (need < 0) continue;
            if (g.kind === "area" && ["necrotic-bomb", "bone-spear", "bony-barrage", "deathly-scream", "zombie-horde"].includes(slug)) {
                const at = thrallAt(f, (r) => inReach(r, f.rect, g.shape === "emanation" ? g.size : 5));
                if (!at || at.cost > need) continue;
                const hit = foesInArea(g.shape, g.size, at.r, g.shape === "line" || g.shape === "cone" ? f.rect : null);
                if (!hit.foes.length) continue;
                let ev = 0;
                const parts = [];
                for (const e of hit.foes) {
                    const c = degree(e, g.save);
                    let x;
                    if (g.basic) x = saveExpected(e.saves?.[g.save] ?? 5 + lv, dc, dmg, { basic: true }).expected;
                    else x = c.s * dmg / 2 + c.f * (dmg + worth(board, "frightened")) + c.cf * (dmg * 2 + 2 * worth(board, "frightened")); // Deathly Scream
                    if (slug === "zombie-horde") x *= 2; // the horde bites each turn they start in it, about two
                    ev += x; parts.push(`${nameOf(e)} ${pct(c.f + c.cf)}`);
                }
                const friends = hit.allies.filter((a) => !(slug === "bony-barrage" && thralls.length + (at.cost ? 1 : 0) >= 2));
                ev -= friends.length * dmg * 0.6;
                const extra = slug === "bony-barrage" && hit.allies.length ? "; destroy a second thrall in the cone and you and your allies in it take nothing and get +1 AC" : "";
                consider({ at, ev, hit, text: `${g.name} from ${at.who}'s square: ${g.shape === "emanation" ? `every creature within ${g.size} feet of it` : g.shape === "burst" ? `a ${g.size}-foot burst on it` : `a ${g.size}-foot ${g.shape} through ${nameOf(f)}`}, ${hit.foes.length} foe${hit.foes.length === 1 ? "" : "s"} (${parts.join(", ")} to fail), ${g.basic ? "basic " : ""}${g.save[0].toUpperCase() + g.save.slice(1)} DC ${dc} for about ${n2(dmg)} ${g.type}${slug === "deathly-scream" ? " (half on a success, frightened 1 on a failure, double and frightened 2 on a critical failure)" : ""}${slug === "zombie-horde" ? " at the start of each of their turns, difficult terrain, a minute" : ""}${friends.length ? `; ${friends.map(nameOf).join(", ")} caught too` : ""}${extra}` });
            } else if (g.kind === "area" && slug === "blossoming-gore") {
                const at = thrallAt(f, (r) => inReach(r, f.rect, 5), g.from);
                if (!at || at.cost > need) continue;
                const hit = foesInArea("burst", 20, at.r, null);
                const bleed = 10 + 2 * Math.max(0, rank - 5);
                const ev = hit.foes.length * bleed * 2 - hit.allies.length * bleed;
                consider({ at, ev, hit, text: `Blossoming Gore from ${at.who}'s square: a 20-foot field of thorns, ${hit.foes.length} foe${hit.foes.length === 1 ? "" : "s"} in it; ${bleed} persistent bleed on entering or starting a turn there, and bleeding creatures that end a turn in it save (DC ${dc}) or are drained and feed you thralls${hit.allies.length ? `; ${hit.allies.map(nameOf).join(", ")} inside too` : ""}` });
            } else if (g.kind === "area" && slug === "flesh-tsunami") {
                const at = thrallAt(f, (r) => inReach(r, f.rect, 5));
                if (!at || at.cost > need) continue;
                const hit = foesInArea("cone", 60, at.r, f.rect);
                const two = thralls.length + (at.cost ? 1 : 0) >= 2 || puppeteer && at.cost;
                let ev = hit.foes.length * 2;
                if (two) for (const e of hit.foes) ev += (degree(e, "fortitude").f + degree(e, "fortitude").cf) * worth(board, "immobilized") * 2;
                ev -= hit.allies.length * 3;
                consider({ at, ev, hit, text: `Flesh Tsunami from ${at.who}'s square: a 60-foot cone of greater difficult terrain through ${nameOf(f)} (${hit.foes.length} foe${hit.foes.length === 1 ? "" : "s"})${two ? `; a second thrall in the cone makes each foe save (DC ${dc}) or be immobilized a round` : "; with a second thrall in the cone it would also immobilize them"}` });
            } else if (g.kind === "one") {
                const at = thrallAt(f, (r) => feetBetween(r, f.rect) <= g.reach, g.from);
                if (!at || at.cost > need) continue;
                const c = degree(f, g.save);
                let ev = 0, text = "";
                if (slug === "dead-weight") { ev = c.s * worth(board, "off-guard") + c.f * (worth(board, "off-guard") + worth(board, "slowed")) + c.cf * (worth(board, "off-guard") + 2 * worth(board, "slowed")); text = `Dead Weight: ${at.who} hurls itself onto ${nameOf(f)}, Fortitude DC ${dc} (${pct(c.f + c.cf)} to fail): off-guard a round on anything but a critical success, slowed 1 on a failure (2 on a critical failure)`; }
                else if (slug === "life-tap") {
                    const lost = (k) => k * lv;
                    const target = ally((a) => feetBetween(at.r, a.rect) <= 30).sort((a, b) => missing(b) - missing(a))[0] ?? me;
                    const heal = (k) => 0.8 * Math.min(missing(target), 2 * lost(k));
                    ev = c.s * (lost(1) + heal(1)) + c.f * (lost(2) + heal(2)) + c.cf * (lost(3) + heal(3)) + (c.f + c.cf) * worth(board, "drained");
                    text = `Life Tap on ${nameOf(f)} through ${at.who}: Fortitude DC ${dc} (${pct(c.f + c.cf)} to fail): drained 1 (2 on a failure, 3 on a critical failure), losing ${lv} HP per point, and ${target === me ? "you" : nameOf(target)} regain${target === me ? "" : "s"} double that (${missing(target)} missing; once every 10 minutes per creature healed)`;
                } else if (slug === "blood-infusion") { ev = c.s * rank + c.f * (rank * 3.5 * 2) + c.cf * (rank * 7 * 2); text = `Blood Infusion on ${nameOf(f)} through ${at.who}: Fortitude DC ${dc} (${pct(c.f + c.cf)} to fail): ${rank} bleed on a success, ${rank}d6 persistent bleed on a failure (${2 * rank}d6 on a critical failure); it loses any immunity to bleed`; }
                else if (slug === "calcification") { ev = c.s * (worth(board, "slowed") + 2) + c.f * (worth(board, "slowed") * 2 + 4) + c.cf * (worth(board, "slowed") * 3 + 4); text = `Calcification on ${nameOf(f)} through ${at.who}: Fortitude DC ${dc} (${pct(c.f + c.cf)} to fail): slowed 1 and weakness 5 to bludgeoning a round; on a failure the bone keeps growing (weakness 10, a save each turn, petrified when it can't act), slowed 2 on a critical failure`; }
                else if (slug === "temporary-possession") { const shift = (f.level ?? lv) > 2 * rank ? 1 : 0; const cc = degreeChances(f.saves?.will ?? 5 + lv, dc, shift); ev = (cc.s + cc.f + cc.cf) * worth(board, "stunned") * 0.5 + (cc.s * 1 + cc.f * 2 + cc.cf * 3) * (f.reactiveStrike?.avg ?? 6) * 0.5; text = `Temporary Possession of ${nameOf(f)} through ${at.who}: Will DC ${dc} (${pct(cc.f + cc.cf)} to fail${shift ? ", incapacitation: it's above twice the spell's rank, one degree better" : ""}): you spend 1 of its actions (2 on a failure, 3 on a critical failure) to make it Strike a foe or drop what it holds, and it's stunned 1 after; any HP it loses meanwhile costs you half`; }
                if (!text) continue;
                consider({ at, ev, text });
            } else if (g.kind === "ally") {
                const r0 = thralls.filter((t) => feetBetween(me.rect, t.rect) <= 30)[0]?.rect ?? null;
                const cands = ally((a) => missing(a) > 0 || slug === "muscle-barrier").filter((a) => r0 ? feetBetween(r0, a.rect) <= 15 : feetBetween(me.rect, a.rect) <= 45);
                if (!cands.length) continue;
                const target = cands.sort((a, b) => missing(b) / (b.maxHp || 1) - missing(a) / (a.maxHp || 1))[0];
                const at = r0 ? { cost: 0, who: nameOf(thralls.find((t) => t.rect === r0)), text: "" } : ctx.actions >= 1 ? { cost: 1, who: "a new thrall", text: "Create Thrall within 15 feet of them" } : null;
                if (!at || at.cost > need) continue;
                const who = target === me ? "you" : nameOf(target);
                if (slug === "muscle-barrier") consider({ at, ev: 0.5 * 10 * rank, target, text: `Muscle Barrier on ${who} through ${at.who}: ${10 * rank} temporary HP for a minute and +1 to Athletics` });
                else consider({ at, ev: 0.8 * Math.min(missing(target), 4.5 * rank + 3 * rank), target, text: `Song of the Soul on ${who} through ${at.who}: ${rank}d8 now (${missing(target)} missing) and fast healing ${rank} while within 15 feet of the thrall` });
            } else if (g.kind === "self" && slug === "bind-heroic-spirit") {
                const t = thralls.find((x) => feetBetween(me.rect, x.rect) <= 30);
                const at = t ? { cost: 0, who: nameOf(t) } : ctx.actions >= 1 ? { cost: 1, who: "a new thrall" } : null;
                if (!at || at.cost > need) continue;
                const bonus = rank >= 6 ? 2 : 1;
                const avg = Math.max(0, ...board.strikes.map((s) => s.avg));
                consider({ at, ev: 0.1 * avg * bonus * 4 + bonus, text: `Bind Heroic Spirit through ${at.who}: +${bonus} status to your attack rolls and saves for a minute; your critical hits raise a thrall beside the target` });
            }
            if (!best || best.ev <= 0) continue;
            const steps = [];
            if (consume) steps.push({ cost: 0, text: fpText(g) });
            if (best.at.cost) steps.push({ cost: 1, text: `Create Thrall: ${best.at.text}${g.kind === "ally" && best.target ? ` (${best.target === me ? "you" : nameOf(best.target)})` : f ? ` (${nameOf(f)})` : ""}` });
            let total = best.at.cost + g.cost;
            let ev = best.ev;
            const infuse = lv >= 8 && has(actor, "infuse-void") && g.kind === "area" && best.hit && ctx.actions >= total + 1;
            if (infuse) { steps.push({ cost: 1, text: `Infuse Void: +${rank} void on each creature the spell damages; a kill gives the Focus Point back (once per 10 minutes)` }); ev += best.hit.foes.length * rank * 0.7; total += 1; }
            if (lv >= 10 && reaper && has(actor, "skeletal-extension") && g.kind !== "ally") steps.push({ cost: 0, text: "Skeletal Extension (free, right before the spell): the thrall's remains stretch your limbs, +10 feet of reach and 15-foot Steps until the end of your turn" });
            steps.push({ cost: g.cost, text: `${best.text}${consume ? "" : ` (${fpText(g)})`}` });
            const freeEv = f ? bestFree.get(f.id) ?? 0 : 0;
            const reserve = fpReserve();
            const notes = [`The free version of this turn (Create Thrall and Strike, or Thrall Charge) is worth about ${n2(freeEv)}; this spends a Focus Point, so it's scored ${reserve} under its value.`];
            if (riderNote) notes.push(riderNote);
            if (lv >= 4 && has(actor, "vampiric-spell") && g.kind === "area" && ctx.actions >= total + 1) notes.push("Vampiric Spell (1 action, before the spell): temporary HP equal to half the most a single creature takes from it.");
            drafts.push({ title: `${g.name}${f ? ` on ${nameOf(f)}` : best.target ? ` on ${best.target === me ? "you" : nameOf(best.target)}` : ""}`, target: f ?? null, ev, score: ev - reserve + 0.4, steps, notes });
        }
        // The two best targets of this spell, no more: the list is long enough
        for (const d of drafts.sort((a, b) => b.ev - a.ev).slice(0, 2)) push(d);
    }

    // ---- Bloody Tendrils (1 action): up to three tendrils beside foes; each lashes a foe that ends its turn within 10 feet
    if (known.has("bloody-tendrils") && canFocus && ctx.actions >= 1 && foes.length) {
        const dice = 1 + Math.floor((rank - 3) / 3);
        const picks = [];
        for (const f of foes) { const r = ring(f).find((x) => !picks.some((p) => p.x === x.x && p.y === x.y)); if (r) picks.push(r); if (picks.length >= 3 + Math.floor((rank - 3) / 3)) break; }
        if (picks.length) {
            let ev = 0;
            for (const f of foes) if (picks.some((p) => feetBetween(p, f.rect) <= 10)) ev += saveExpected(f.saves?.reflex ?? 5 + lv, dc, dice * 6.5, { basic: true }).expected;
            push({ title: `Bloody Tendrils among ${picks.length === 1 ? "the foe" : "the foes"}`, target: foes[0], ev, score: ev - fpReserve() + 0.4, steps: [...(consume ? [{ cost: 0, text: fpText() }] : []), { cost: 1, text: `Bloody Tendrils: ${picks.length} immobile tendril thralls beside ${foes.slice(0, picks.length).map(nameOf).join(", ")}; a foe that ends its turn within 10 feet of one takes ${dice}d12 (basic Reflex DC ${dc}); they're thralls, so your grave spells can spend them${consume ? "" : ` (spends 1 Focus Point, ${fp} of ${fpMax} left)`}` }], notes: ["Tendrils can't move and are immune to physical damage; a foe that stays put beside one is lashed every round for a minute."] });
        }
    }

    // ---- Draining Strike (1 action, once per turn): a Strike that counts twice; on a hit destroy thralls within 10 feet of you or the target
    if (lv >= 2 && has(actor, "draining-strike") && ctx.actions >= 1 && !effect(actor, /draining-strike/)) {
        const drains = [];
        for (const f of foes) {
            const sq = squareToReach(board, f, myReach(board), Math.max(0, ctx.actions - 1));
            if (!sq) continue;
            const at = sq.route.actions ? { ...me.rect, x: sq.x, y: sq.y } : me.rect;
            const near = thralls.filter((t) => feetBetween(t.rect, at) <= 10 || feetBetween(t.rect, f.rect) <= 10).length;
            const spare = ctx.actions - 1 - sq.route.actions;
            const make = near < drainThralls && spare >= 1 && ring(f).length ? 1 : 0;
            const n = Math.min(drainThralls, near + make * (puppeteer ? 2 : 1));
            if (!n) continue;
            const b = bestStrike(board, f, { made: ctx.made });
            if (!b) continue;
            const spirit = n * 3.5;
            const ev = b.e.expected + b.e.hit * spirit + 0.8 * Math.min(missing(me), b.e.hit * spirit);
            const steps = [];
            if (sq.route.actions) steps.push({ cost: sq.route.actions, text: moveText(sq, f) });
            if (make) steps.push({ cost: 1, text: `Create Thrall beside ${nameOf(f)}${puppeteer ? " (two, with Thrall Proliferation)" : ""}` });
            steps.push({ cost: 1, text: `Draining Strike at ${nameOf(f)} with ${b.s.label} (${signed(b.bonus)}): on a hit destroy ${n} thrall${n === 1 ? "" : "s"} within 10 feet of you or it for +${n}d6 spirit, and you regain that much (${missing(me)} missing); it counts as two attacks` });
            drains.push({ title: `Draining Strike on ${nameOf(f)}`, target: f, ev, dest: sq.route.actions ? { x: sq.x, y: sq.y } : null, bias: 0.3, steps, notes: riderNote ? [riderNote] : [] });
        }
        for (const d of drains.sort((a, b) => b.ev - a.ev || a.steps.length - b.steps.length).slice(0, 3)) push(d);
    }

    // ---- Anatomical Quartering (3 actions): up to four Strikes at different targets, the penalty held until the end
    if (lv >= 16 && has(actor, "anatomical-quartering") && ctx.actions === 3) {
        const inR = foes.filter((f) => board.strikes.some((s) => !s.ranged && inReach(me.rect, f.rect, s.reach || 5)));
        if (inR.length >= 2) {
            const picks = inR.map((f) => ({ f, b: bestStrike(board, f, { made: ctx.made }) })).filter((x) => x.b).sort((a, b) => b.b.e.expected - a.b.e.expected).slice(0, 4);
            const ev = picks.reduce((s, x) => s + x.b.e.expected, 0);
            push({ title: `Anatomical Quartering on ${picks.length} foes`, target: picks[0].f, ev, bias: 0.4, steps: [{ cost: 3, text: `Anatomical Quartering: one Strike each at ${picks.map((x) => `${nameOf(x.f)} (${x.b.s.label} ${signed(x.b.bonus)})`).join(", ")}, all at your current penalty; the last one's physical damage becomes spirit` }] });
        }
    }

    // ---- Reclaim Power (1 action, once per 10 minutes): up to three thralls within 60 feet for your level in HP each
    if (lv >= 6 && has(actor, "reclaim-power") && ctx.actions >= 1 && (usesLeft(actor, "reclaim-power") ?? 1) > 0) {
        const near = thralls.filter((t) => feetBetween(me.rect, t.rect) <= 60).length;
        const n = Math.min(3, near);
        if (n && missing(me) >= lv) {
            const heal = Math.min(missing(me), n * lv);
            push({ title: "Reclaim Power", target: null, ev: 0.8 * heal, bias: 0.2, steps: [{ cost: 1, text: `Reclaim Power: destroy ${n} thrall${n === 1 ? "" : "s"} within 60 feet and regain ${heal} HP (${missing(me)} missing)${n === 3 ? "; three also lower a clumsy, enfeebled, frightened, sickened or stupefied value by 1" : ""}; once per 10 minutes` }], notes: riderNote ? [riderNote] : [] });
        } else if (!near && missing(me) >= lv) out.notes.push(`Reclaim Power (1 action, once per 10 minutes): ${lv} HP per thrall you destroy within 60 feet, up to three; you have none in reach of it now.`);
    }

    // ---- Amalgamate (1 action): two adjacent thralls into a Large one with +level damage, then Thrall Charge it
    if (lv >= 14 && has(actor, "amalgamate") && ctx.actions >= 3 && hasThrallCharge) {
        const pair = thralls.find((a) => thralls.some((b) => b !== a && inReach(a.rect, b.rect, 5)) && feetBetween(me.rect, a.rect) <= 30);
        const f = pair ? foes.filter((x) => feetBetween(pair.rect, x.rect) <= 35).sort((a, b) => feetBetween(pair.rect, a.rect) - feetBetween(pair.rect, b.rect))[0] : null;
        if (pair && f) {
            const e = strikeExpected(atk + mapFor(ctx.made, false), f.ac, thrallDie + spiritDmg + lv + chargeDice * 3.5);
            push({ title: `Amalgamate, then Thrall Charge ${nameOf(f)}`, target: f, ev: e.expected, bias: 0.3, steps: [{ cost: 1, text: `Amalgamate: fuse ${nameOf(pair)} and the thrall beside it into a Large thrall with 10-foot reach and +${lv} damage` }, { cost: 2, text: `Thrall Charge: it Strides and Strikes ${nameOf(f)} (${signed(atk + mapFor(ctx.made, false))}, about ${n2(thrallDie + spiritDmg + lv + chargeDice * 3.5)})` }] });
        } else if (thralls.length >= 2) out.notes.push(`Amalgamate (1 action): two of your thralls standing side by side become one Large thrall with 10-foot reach and +${lv} damage on its Strikes.`);
    }

    // ---- when-notes
    const slots = slotsOf(actor);
    const slotLine = Object.entries(slots.byRank).sort((a, b) => a[0] - b[0]).map(([r, s]) => `${r}${["st", "nd", "rd"][r - 1] ?? "th"} ${s.left}/${s.max}`).join(", ");
    if (slotLine) out.notes.push(`Slots left: ${slotLine}. Your dirge is prepared: a spell cast is gone for the day${has(actor, "mortem-ultimatum") ? "; Mortem Ultimatum gives you a second 10th-rank slot" : lv >= 19 && !archetype ? "; Epitaph's single 10th-rank slot can't feed abilities that cast without a slot" : ""}.`);
    if (fp != null) {
        const names = [...known.values()].filter((g) => rank >= g.rank).map((g) => g.name);
        out.notes.push(`Grave spells are focus spells (${fp} of ${fpMax} Focus Point${fpMax === 1 ? "" : "s"} left): ${names.join(", ") || "none read"}. Create Thrall and Thrall Charge are cantrips and cost nothing. Refocus with a thrall standing by and destroy it for 2 points instead of 1${lv >= 12 && has(actor, "grave-focus") ? "; Grave Focus refills the whole pool when you Refocus" : ""}.`);
        if (fp === 0 && !consume) out.notes.push(`No Focus Points: the grave spells are closed until you Refocus${puppeteer ? "; Consume Thrall needs a thrall within 30 feet" : ""}. Thralls, Thrall Charge and your slot spells carry the turn.`);
    }
    if (consume) out.notes.push("Consume Thrall (free, once a day, at 0 Focus Points): destroy a thrall within 30 feet for 1 Focus Point that only a grave spell can spend; the grave spell plans above count on it.");
    if (lv >= 18 && puppeteer && has(actor, "power-hungry")) out.notes.push("Power Hungry: destroying three thralls with Consume Thrall refills your focus pool entirely.");
    if (reaper) out.notes.push(`Thrall Teamwork (once per round): after Create Thrall, a free melee Strike at a foe in your reach that's adjacent to one of your thralls${lv >= 11 ? "; you're an expert with martial weapons" : ""}.`);
    if (puppeteer) out.notes.push("Thrall Proliferation (once per round): Create Thrall makes one more thrall in range; two thralls beside a foe set up Bony Barrage's cover or a Draining Strike at full dice.");
    if (!archetype) out.notes.push("Mastery of Life and Death: each void or vitality spell picks its damage type per target, so Harm bites undead foes as vitality; a spell that targets only the living or only the undead targets both.");
    if (has(actor, "invert-harm")) out.notes.push("Invert Harm: your Harm heals living allies as if they were undead; the 2-action version reaches 30 feet.");
    if (lv >= 4 && has(actor, "overwhelming-harm")) out.notes.push("Overwhelming Harm: the 3-action Harm can be a 60-foot emanation; pick void for the living foes and vitality for the undead, and it won't heal anyone.");
    if (lv >= 6 && has(actor, "conjurer-of-corpses")) out.notes.push("Conjurer of Corpses: a spare top-rank slot holds Summon Undead each day, and the undead you summon count as thralls for your spells.");
    if (lv >= 3 && hasAny(actor, "inevitable-return", "inevitable-thralls")) out.notes.push(`Inevitable Return (reaction): when a Small or Medium enemy within 30 feet dies, a thrall rises in its space${lv >= 12 && has(actor, "endless-return") ? "; Endless Return gives you a second reaction each turn for it" : ""}.`);
    if (has(actor, "reach-of-the-dead")) out.notes.push("Reach of the Dead (free action): your next ranged spell is cast from a thrall within 60 feet, range and cover counted from its square, and the thrall is destroyed; for a foe out of your range or behind cover from you but not from a thrall.");
    if (lv >= 4 && has(actor, "vampiric-spell")) out.notes.push("Vampiric Spell (1 action): the next damaging spell gives you temporary HP equal to half the most one creature takes from it, for a minute.");
    if (lv >= 4 && has(actor, "body-shield")) {
        const adj = thralls.filter((t) => inReach(me.rect, t.rect, 5)).length;
        out.notes.push(adj ? `Body Shield (reaction): a thrall beside you takes the hit, +2 AC against an attack you can see and resistance ${lv} if it still lands; ${adj} adjacent now.` : "Body Shield (reaction) needs a thrall adjacent to you: Create one beside yourself when a foe is on you.");
    }
    if (lv >= 4 && has(actor, "void-siphon-necromancer")) out.notes.push(`Void Siphon (reaction): resistance ${lv} to void damage you'd take, then ${lv} temporary HP for a round.`);
    if (lv >= 4 && has(actor, "ghostly-stride")) out.notes.push("Ghostly Stride (1 action): half your Speed, no reactions triggered, through foes' spaces; the way out of a crowd.");
    if (lv >= 4 && has(actor, "osteo-armaments")) out.notes.push(`Osteo Armaments (1 action): a +${lv >= 16 ? 3 : lv >= 10 ? 2 : 1} ${lv >= 19 ? "major" : lv >= 12 ? "greater" : ""} striking weapon of bone for an hour${lv >= 8 ? "; destroy an adjacent thrall as part of it for a decaying rune" : ""}.`);
    if (lv >= 4 && has(actor, "mobile-thralls")) out.notes.push(`Mobile Thralls: your thralls climb or swim as fast as they walk${lv >= 8 ? ", or fly" : ""}.`);
    if (lv >= 6 && has(actor, "bone-burst")) {
        const watch = foes.filter((f) => thralls.some((t) => inReach(t.rect, f.rect, 5) && feetBetween(me.rect, t.rect) <= 30));
        const dice = lv >= 18 ? 4 : lv >= 12 ? 3 : 2;
        out.notes.push(`Bone Burst (reaction): when a foe adjacent to one of your thralls moves, manipulates or makes a ranged attack, the thrall explodes for ${dice}d10 piercing on it (basic Reflex DC ${dc})${watch.length ? `; ${watch.map(nameOf).join(", ")} stand${watch.length === 1 ? "s" : ""} beside one now` : "; a thrall beside a foe sets the trap"}.`);
    }
    if (lv >= 6 && has(actor, "collateral-reinforcement") && thralls.length) out.notes.push("Collateral Reinforcement (1 action): your thralls ignore area and splash damage for a round; before your own area spell lands on them.");
    if (lv >= 6 && has(actor, "corrupted-ground")) out.notes.push(`Corrupted Ground (1 action, a minute): a holy creature or psychopomp that ends its turn within 10 feet of you takes ${Math.max(1, Math.floor((lv - 2) / 4) * 2)} spirit (as much again void if living); only against the holy.`);
    if (lv >= 6 && has(actor, "hallowed-earth")) out.notes.push(`Hallowed Earth (1 action, a minute): an unholy creature that ends its turn within 10 feet of you takes ${Math.max(1, Math.floor((lv - 2) / 4) * 2)} spirit (as much again vitality if undead); only against the unholy.`);
    if (lv >= 8 && has(actor, "infuse-void") && !out.plans.some((p) => /Infuse Void/.test(p.steps.map((s) => s.text).join(" ")))) out.notes.push(`Infuse Void (1 action, before a damaging grave spell): +${rank} void on each creature it damages; a kill gives you the Focus Point back, once per 10 minutes.`);
    if (lv >= 8 && has(actor, "march-of-the-dead") && (usesLeft(actor, "march-of-the-dead") ?? 1) > 0) out.notes.push(`March of the Dead (3 actions, once a day): every thrall within 60 feet Strides, and a foe that ends adjacent to three or more saves (DC ${dc}) or is off-guard and slowed 1 until your next turn; you have ${thralls.length} thrall${thralls.length === 1 ? "" : "s"} on the field.`);
    if (lv >= 8 && has(actor, "final-spite")) out.notes.push(`Final Spite (free action, once per 10 minutes): when a creature drops you or a living ally within 30 feet, it takes 4d4 persistent poison (basic Fortitude DC ${dc}), a degree worse if it killed.`);
    if (lv >= 8 && has(actor, "wings-of-bone-and-sinew")) out.notes.push(`Wings of Bone and Sinew (1 action${lv >= 16 ? "" : ", once an hour"}): destroy a thrall within 30 feet for a 30-foot fly Speed${lv >= 16 ? " that lasts" : " for a minute"}.`);
    if (lv >= 10 && has(actor, "desperate-surge")) out.notes.push(`Desperate Surge (1 action, once per 10 minutes): Trip, Grapple, Shove or Disarm with your spell attack (${signed(atk)}) instead of Athletics; an unarmed Strike that destroys a thrall in your reach recharges it.`);
    if (lv >= 10 && has(actor, "overburdening-spell")) out.notes.push("Overburdening Spell (1 action): the next single-target spell also gives its target -15 feet to its Speeds for a round; on the foe you want kept away from the back line.");
    if (lv >= 10 && has(actor, "skeletal-extension") && !reaper) out.notes.push("Skeletal Extension (free action): before a grave spell that destroys a thrall, your reach grows 10 feet and your Steps 15 feet until the end of the turn.");
    if (lv >= 10 && has(actor, "necromantic-lifesense")) out.notes.push("Necromantic Lifesense: you know the exact HP of every living or undead creature you see within 30 feet; the foe estimates here are guesses, your sheet's knowledge is better.");
    if (lv >= 12 && has(actor, "reinforced-skeleton")) out.notes.push(`Reinforced Skeleton: resistance ${Math.floor(lv / 2)} to two damage types and +5 feet of Speed.`);
    if (lv >= 12 && has(actor, "sanguine-mastery")) out.notes.push(`Sanguine Mastery: fast healing ${Math.floor(lv / 2)} while a foe within 30 feet is bleeding; Blood Infusion starts the bleed.`);
    if (lv >= 14 && has(actor, "blood-pool")) out.notes.push(`Blood Pool (reaction): when a creature with blood within 30 feet dies or takes bleed damage, a pool beside it that an ally can drink for ${lv} HP by stepping in.`);
    if (lv >= 14 && has(actor, "instinctual-creation")) out.notes.push("Instinctual Creation (free action on initiative): two thralls beside you as the fight begins.");
    if (lv >= 14 && has(actor, "ocular-flesh")) out.notes.push("Ocular Flesh (1 action): a marble-sized eye you can look through for a round; a scout around a corner.");
    if (lv >= 16 && has(actor, "beckoning-dirge") && (usesLeft(actor, "beckoning-dirge") ?? 1) > 0) out.notes.push(`Beckoning Dirge (free action, once a day): this turn cast any spell in your dirge of rank ${Math.max(1, slots.top - 1)} or lower without a slot or preparation, from a thrall within 60 feet; the thrall is destroyed.`);
    if (lv >= 16 && has(actor, "desperate-revival") && (usesLeft(actor, "desperate-revival") ?? 1) > 0) out.notes.push(`Desperate Revival (reaction, once a day): when you'd drop to 0 HP, you stay at 1 and every creature within 60 feet saves (DC ${dc}) or feeds you void damage equal to its level, up to half your maximum.`);
    if (lv >= 18 && has(actor, "ectoplasmic-aura") && ctx.actions >= 1 && !effect(actor, /ectoplasmic-aura/)) out.notes.push(`Ectoplasmic Aura (1 action, 10 minutes): +1 AC for you and allies within 30 feet, and a foe that ends its turn in it saves (DC ${dc}) or loses its reactions; worth the action at the start of a fight.`);
    if (lv >= 20 && has(actor, "instant-army") && (usesLeft(actor, "instant-army") ?? 1) > 0) out.notes.push("Instant Army (1 action, once a day): up to 20 thralls within 120 feet; the turn every grave spell and Draining Strike wants.");
    if (lv >= 20 && has(actor, "final-union")) out.notes.push("Final Union: a 10th-rank Bind Heroic Spirit is always on you (+2 status to attacks and saves), and your spirit keeps you acting when you'd fall unconscious.");
    if (lv >= 20 && has(actor, "soul-thief")) out.notes.push("Soul Thief (3 actions, once a day): within a minute of an 18th-level or higher creature's death, an Occultism check to bottle its soul.");
    if (has(actor, "undead-familiar")) out.notes.push("Undead Familiar: your familiar can be the thrall a grave spell spends; you raise it again at the next daily preparations.");
    if (has(actor, "death-speaker")) out.notes.push("Death Speaker: your spells ignore the mindless trait and immunity to emotion, fear and mental effects on undead; Deathly Scream frightens them.");
    if (lv >= 2 && has(actor, "draining-strike") && !out.plans.some((p) => /Draining Strike/.test(p.title))) out.notes.push(`Draining Strike (1 action, once per turn): a Strike counting as two attacks; a hit lets you destroy ${drainThralls > 1 ? `up to ${drainThralls} thralls` : "a thrall"} within 10 feet of you or the target for +1d6 spirit each, and heals you that much; it wants a foe in reach and a thrall nearby.`);
    // Grave spells that make thralls rather than spend them: their moments
    const makers = [];
    if (known.has("conglomerate-of-limbs") && rank >= 4) makers.push(`Conglomerate of Limbs (1 action): a Huge thrall with ${40 + 10 * (rank - 4)} HP whose Thrall Charge is two Strikes on different foes within 10 feet, each a Fortitude save or grabbed`);
    if (known.has("recurring-nightmare") && rank >= 7) makers.push(`Recurring Nightmare (1 action): a flying thrall summoned into a foe's space, Will DC ${dc} or frightened 1; +${rank >= 8 ? 3 : 2}d6 on its Thrall Charge, and Sustain brings it back`);
    if (known.has("skeletal-lancers") && rank >= 7) makers.push(`Skeletal Lancers (1 action): five thralls with 10-foot reach; a foe that Strikes within 10 feet of one takes 5 piercing, and they all Stride on one command`);
    if (known.has("living-graveyard") && rank >= 10) makers.push(`Living Graveyard (1 action): a Gargantuan thrall with 400 HP that knocks creatures within 10 feet prone (Fortitude DC ${dc}), sheds five thralls, and adds 3d6 to its Thrall Charge`);
    if (known.has("perfected-thrall") && rank >= 10) makers.push("Perfected Thrall (1 action): a 200-HP thrall that loses 20 HP instead of being destroyed by your spells, raises four thralls on a critical hit and adds 6d6 to its Thrall Charge");
    if (known.has("sanguine-transference") && rank >= 4) makers.push("Sanguine Transference (1 action): swap places with a thrall within 60 feet without provoking, leaving a thrall where you stood");
    if (known.has("bridge-of-graves") && rank >= 6) makers.push("Bridge of Graves (2 actions): a 120-foot bridge of grave dirt that any thrall on it crosses in one Stride");
    if (known.has("dread-mosquito-storm") && rank >= 9) makers.push(`Dread Mosquito Storm (3 actions, 120 feet): a 60-foot burst of plague for a minute, Fortitude DC ${dc} each turn against necrotic blood (3d10 void and sickened a stage); the dead rise as thralls`);
    if (known.has("reanimate-foe") && rank >= 9) makers.push("Reanimate Foe (3 actions): an Undead Lore check turns a foe dead within the last minute into a minion with its attacks and 100 HP, decaying 15 a turn");
    if (makers.length) out.notes.push(`${canFocus ? "Also in the pool" : "In the pool, once you have a Focus Point"}: ${makers.join("; ")}.`);
    if (has(actor, "widespread-fascination")) out.notes.push("Widespread Fascination: a second fascination's grave spell is yours; it's read here only when the spell is on your sheet.");
}

export { necromancer };
