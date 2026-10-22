/**
 * PF2e NPC Tactics: advisor.mjs
 * The turn advisor: candidate turns from the creature's kit and the board, scored by expected value.
 * One module, several files: see pf2e-tactics.mjs for the whole.
 */
import { MODULE_ID, cap, signed } from "./shared.mjs";
import { areaTest, averageOf, centerOf, coverBetween, damageAgainst, degreeChances, feetBetween, flanks, flatCheck, flatFor, healUse, heightOf, inReach, learnK, learnedAcBounds, mapFor, pct, rectInArea, round1, saveExpected, strikeExpected, verticalGap, visibilityOf, withVisioner } from "./reader.mjs";
import { hitWorth, threatScale } from "./state.mjs";

// The turn advisor: candidate turns from the creature's kit and the board, scored by expected
// damage and what they set up, minus what they cost (reactions provoked, standing in reach).
// Works on the plain board from readBoard(); no Foundry calls.
// ---------------------------------------------------------------------------------------------
const OFF_GUARD_FROM = ["off-guard", "prone", "grabbed", "restrained", "paralyzed", "unconscious", "blinded"];
const RUN_WORDS = /\b(runs?|flees?|retreats?|withdraws?|escapes?|breaks? off|bolts?|falls? back|pulls? back|leaves|makes? for|goes by|gets? out|slips? away|surrenders?|gives? up|yields?)\b/i;

const cellKey = (x, y) => `${x},${y}`;
const nameOf = (c) => c?.name ?? "?";

/** How many closed doors the path to a square goes through (each costs an Interact, counted in its actions). */
function doorsOn(board, map, x, y) {
    if (!board.doorBetween || !map) return 0;
    let n = 0;
    let k = cellKey(x, y);
    for (let guard = 0; k && guard < 200; guard++) {
        const c = map.get(k);
        if (!c?.prev) break;
        const [px, py] = c.prev.split(",").map(Number);
        if (board.doorBetween(px, py, c.x, c.y)) n++;
        k = c.prev;
    }
    return n;
}

/** How to get to a square: fewest actions, then fewest reactions provoked. */
function routeTo(board, x, y) {
    const { me, move, field } = board;
    if (x === me.rect.x && y === me.rect.y) return { actions: 0, provokes: [], via: null, feet: 0 };
    const options = [];
    const st = field.step?.get(cellKey(x, y));
    // Up in the air it has to Fly to stay up, so it flies its 5 feet rather than Step
    if (st?.end && !me.airborne) options.push({ actions: 1, provokes: [], via: move.step.by ?? "Step", feet: st.feet, step: true });
    // Animals, mindless and crude creatures (Int 0 or lower) don't plan a long way round: they get the shortest
    // path too, and take the safe one only when it costs no more actions. Cleverer ones route round reach whenever they can.
    const instinct = tierOf(me) <= 1 && !!field.fast;
    const fast = field.fast?.get(cellKey(x, y));
    for (const [name, sf] of [["safe", field.safe?.get(cellKey(x, y))], ...(instinct ? [["fast", fast]] : [])]) {
        if (!sf?.end || !(move.stride.feet > 0)) continue;
        const actions = Math.ceil(sf.feet / move.stride.feet);
        let via = move.stride.by ?? (move.stride.speed === "fly" ? "Fly" : "Stride");
        // The straight way would set off a reaction the chosen path avoids: say so
        const avoided = name === "safe" && fast && !move.stride.noReactions ? fast.provokes.filter((id) => !sf.provokes.includes(id)) : [];
        if (avoided.length) {
            const names = avoided.map((id) => nameOf(board.enemies.find((e) => e.id === id))).filter((n) => n !== "?");
            if (names.length) via = `${via} (${instinct ? "round" : "the long way round, keeping out of"} ${names.join(" and ")}'s reach)`;
        }
        const doors = doorsOn(board, field[name], x, y);
        if (actions <= ACT) options.push({ actions, provokes: move.stride.noReactions ? [] : sf.provokes, via, feet: sf.feet, avoided, field: name, doors });
    }
    // Step out of reach first, then Stride: one action more, but no reaction on the way out
    for (const { sq, field: f } of field.stepThen ?? []) {
        const sf = f.get(cellKey(x, y));
        if (!sf?.end || !(move.stride.feet > 0)) continue;
        const actions = 1 + Math.ceil(sf.feet / move.stride.feet);
        if (actions > ACT) continue;
        const left = board.enemies.filter((e) => board.threatsAt?.(me.rect.x, me.rect.y)?.includes(e.id)).map(nameOf).filter((n) => n !== "?");
        const via = `${move.step.by ?? "Step"} out of ${left.length ? `${left.join(" and ")}'s` : "their"} reach, then ${move.stride.by ?? (move.stride.speed === "fly" ? "Fly" : "Stride")}`;
        options.push({ actions, provokes: sf.provokes, via, feet: sf.feet + move.step.feet, avoided: [], field: "stepThen", fieldMap: f, stepSq: sq, doors: doorsOn(board, f, x, y) });
    }
    options.sort((a, b) => a.provokes.length - b.provokes.length || a.actions - b.actions);
    return options[0] ?? null;
}

/** Every square of the path to a square, start first: the same path routeTo chose (the safe one, or for an animal or
 *  crude creature the shortest when that costs fewer actions). */
function pathCells(board, dest) {
    const route = routeTo(board, dest.x, dest.y);
    const field = route?.fieldMap ?? (route?.field === "fast" && board.field?.fast ? board.field.fast : board.field?.safe);
    let k = cellKey(dest.x, dest.y);
    const cells = [];
    for (let guard = 0; k && guard < 200; guard++) {
        const n = field?.get(k);
        if (!n) break;
        cells.unshift({ x: n.x, y: n.y });
        k = n.prev;
    }
    // A Step-then-Stride path starts at the Step square: the start square comes before it
    if (route?.stepSq && cells.length && !(cells[0].x === board.me.rect.x && cells[0].y === board.me.rect.y)) cells.unshift({ x: board.me.rect.x, y: board.me.rect.y });
    return cells;
}

/** The turns of the path to a square (start, each change of direction, end), for showing it on the map. */
function pathTo(board, dest) {
    const w = board.me.rect.w;
    const cells = pathCells(board, dest);
    if (cells.length < 2) return [{ ...dest, w }];
    const out = [cells[0]];
    for (let i = 1; i < cells.length - 1; i++) {
        const a = cells[i - 1], b = cells[i], c = cells[i + 1];
        if (b.x - a.x !== c.x - b.x || b.y - a.y !== c.y - b.y) out.push(b);
    }
    out.push(cells[cells.length - 1]);
    return out.map((p) => ({ ...p, w }));
}

/** Every square the creature could end on this turn, with its route. */
function reachableSquares(board, maxActions = ACT) {
    const out = [{ x: board.me.rect.x, y: board.me.rect.y, route: { actions: 0, provokes: [], via: null, feet: 0 } }];
    const mc = board.me.conditions ?? new Set();
    // Grabbed, restrained or immobilized: no move actions at all
    if (["immobilized", "grabbed", "restrained", "paralyzed", "petrified", "unconscious"].some((c) => mc.has(c))) return out;
    // Prone: Stand first (a move action, so it sets off Reactive Strike from anyone in reach)
    const prone = mc.has("prone");
    const standProvokes = prone ? (board.enemies ?? []).filter((e) => e.reactions?.some((r) => r.trigger.onMove) && inReach(e.rect, board.me.rect, e.reach)).map((e) => e.id) : [];
    const keys = new Set([...(board.field?.safe?.keys() ?? []), ...(board.field?.step?.keys() ?? [])]);
    for (const k of keys) {
        const [x, y] = k.split(",").map(Number);
        if (x === board.me.rect.x && y === board.me.rect.y) continue;
        let route = routeTo(board, x, y);
        if (route && prone) route = { ...route, actions: route.actions + 1, provokes: [...new Set([...standProvokes, ...route.provokes])], via: `Stand, then ${route.via}`, stand: true };
        if (route && route.actions <= maxActions) out.push({ x, y, route });
    }
    // Heights: a flier can rise or drop to a foe's height, a walker can Climb an incline to it. Each square near a foe
    // up there is offered again at that height, with the actions the climb or flight costs.
    const z0 = board.me.rect.z ?? 0;
    const heights = [...new Set((board.enemies ?? []).map((e) => e.rect.z ?? 0))].filter((z) => Math.abs(z - z0) >= 5);
    if (!heights.length || !board.square) return out;
    const base = out.slice();
    // On foot by a ramp: the field's way to the ramp, then on to the square up (or down) there
    const stride = board.move?.stride;
    const walker = !((board.move?.speeds?.fly ?? 0) > 0) && stride?.feet > 0 && stride.speed !== "fly";
    const ramps = walker ? board.ramps ?? [] : [];
    const walkFor = (x, y, z) => {
        if (!ramps.length || ["immobilized", "grabbed", "restrained", "paralyzed", "petrified", "unconscious"].some((c) => mc.has(c))) return null;
        const lo = Math.min(z0, z), hi = Math.max(z0, z);
        const sqFeet = (a, b) => { const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y); return 5 * (Math.max(dx, dy) + Math.floor(Math.min(dx, dy) / 2)); };
        const dz = Math.abs(z - z0);
        let best = null;
        for (const r of ramps) {
            if (!(r.bottom <= lo + 1 && r.top >= hi - 1)) continue;
            // In where it's quickest to get to; out at the square of it nearest where it's going
            const entry = r.cells.reduce((m, c) => (!m || c.feet < m.feet || (c.feet === m.feet && c.provokes.length < m.provokes.length) ? c : m), null);
            const exit = r.cells.reduce((m, c) => (!m || sqFeet(c, { x, y }) < sqFeet(m, { x, y }) ? c : m), null);
            if (!entry || !exit) continue;
            const feet = entry.feet + Math.max(sqFeet(entry, exit), dz) * (r.mult ?? 1) + sqFeet(exit, { x, y });
            if (!best || feet < best.feet) best = { feet, provokes: entry.provokes, name: r.name, entry, exit };
        }
        if (!best) return null;
        const doors = doorsOn(board, board.field?.safe, best.entry.x, best.entry.y);
        const actions = Math.ceil(best.feet / stride.feet) + (prone ? 1 : 0);
        if (actions > maxActions) return null;
        return {
            actions, feet: best.feet, z, walk: true, stand: prone, doors, waypoints: [{ x: best.entry.x, y: best.entry.y }, { x: best.exit.x, y: best.exit.y }],
            provokes: stride.noReactions ? (prone ? standProvokes : []) : [...new Set([...(prone ? standProvokes : []), ...best.provokes])],
            via: `${prone ? "Stand, then " : ""}${stride.by ?? "Stride"}`,
            tail: `, ${z > z0 ? "up" : "down"} ${dz} ft by way of ${/^the\b/i.test(best.name) ? best.name : `the ${best.name}`}`,
        };
    };
    for (const z of heights) {
        const near = (board.enemies ?? []).filter((e) => (e.rect.z ?? 0) === z && (!e.rect.lvl || !board.me.rect.lvl || e.rect.lvl === board.me.rect.lvl));
        if (!near.length) continue;
        for (const sq of base) {
            const at = { x: sq.x, y: sq.y, w: board.me.rect.w, h: board.me.rect.h, z, ht: board.me.rect.ht };
            if (!near.some((e) => feetBetween(at, e.rect) <= 30)) continue;
            // 3. Not into someone else's space up there (straight down onto the fighter it hovers over)
            const here = sq.x === board.me.rect.x && sq.y === board.me.rect.y;
            if (here && [...(board.enemies ?? []), ...(board.allies ?? [])].some((c) => c.rect.x < at.x + at.w && at.x < c.rect.x + c.rect.w && c.rect.y < at.y + at.h && at.y < c.rect.y + c.rect.h
                && Math.abs((c.rect.z ?? 0) - z) < Math.max(heightOf(c.rect), heightOf(at)))) continue;
            const route = heightRoute(board, sq.route, z0, z, here, sq.x, sq.y, walker ? walkFor(sq.x, sq.y, z) : null);
            if (route && route.actions <= maxActions) out.push({ x: sq.x, y: sq.y, z, route });
        }
    }
    return out;
}

/** The route to a square, then up or down to height z: a flight counted with the move (height is a third axis), or a
 *  Climb up an incline (5 feet an action, 10 with a land Speed of 40 or more, or its climb Speed). Null when it can't. */
function heightRoute(board, route, z0, z, here, x = board.me.rect.x, y = board.me.rect.y, walk = null) {
    const dz = Math.abs(z - z0), up = z > z0;
    const sp = board.move?.speeds ?? {};
    const startThreats = here ? board.threatsAt?.(board.me.rect.x, board.me.rect.y) ?? [] : [];
    // Prone where it stands: it Stands first
    const stand = here && board.me.conditions?.has?.("prone") ? 1 : 0;
    const standText = stand ? "Stand, then " : "";
    // Climbing or standing up beside a foe is a move action in its reach
    const landing = () => [...new Set([...(here ? startThreats : route.provokes ?? []), ...(board.threatsAt?.(x, y, z) ?? [])])];
    if ((sp.fly ?? 0) > 0 && !["immobilized", "grabbed", "restrained"].some((c) => board.me.conditions?.has?.(c))) {
        const stride = board.move.stride;
        if (route.feet > 0 && stride.speed === "fly") {
            // Up is difficult terrain (every 5 ft costs 10); straight down is 10 ft for every 5 spent
            const H = route.feet / 5, V = up ? (dz / 5) * 2 : dz / 10;
            const feet3 = 5 * (Math.max(H, V) + Math.floor(Math.min(H, V) / 2));
            const actions = route.actions - Math.ceil(route.feet / stride.feet) + Math.ceil(feet3 / stride.feet);
            return { ...route, actions, feet: feet3, step: false, via: `${route.step ? "Fly" : route.via} (${up ? "up" : "down"} ${dz} ft)`, z };
        }
        const fly = Math.max(1, Math.ceil((up ? 2 * dz : dz / 2) / sp.fly));
        if (here) return { actions: fly + stand, provokes: board.move.stride.noReactions ? [] : startThreats, via: `${standText}Fly ${up ? "up" : "down"} ${dz} ft`, feet: dz, z, vertical: true };
        return { ...route, actions: route.actions + fly, vAct: fly, vText: `Fly ${up ? "up" : "down"} ${dz} ft`, z };
    }
    // A walker: a step up or down onto a wagon is part of the move; anything more needs an incline, or a climb Speed
    if (dz <= 5) return here ? { actions: 1 + stand, provokes: startThreats, via: `${standText}${board.move.step.by ?? "Step"}`, feet: 5, z } : { ...route, z };
    const options = [];
    if (walk) options.push({ kind: "walk", r: walk });
    const lo = Math.min(z0, z), hi = Math.max(z0, z);
    // An incline that spans both heights, at or beside where it ends up
    const size = board.size ?? 100;
    const besideFace = (r) => {
        if (!r?.testPoint) return true;
        for (let dx = -1; dx <= board.me.rect.w; dx++) for (let dy = -1; dy <= board.me.rect.h; dy++) {
            try { if (r.testPoint({ x: (x + dx + 0.5) * size, y: (y + dy + 0.5) * size, elevation: (lo + hi) / 2 })) return true; } catch { return true; }
        }
        return false;
    };
    const face = (board.inclines ?? []).find((i) => i.bottom <= lo + 1 && i.top >= hi - 1 && besideFace(i.region));
    const per = sp.climb > 0 ? sp.climb : 5 + ((sp.land ?? 25) >= 40 ? 5 * Math.floor(((sp.land ?? 25) - 20) / 20) : 0);
    const climb = face || sp.climb > 0 ? Math.ceil(dz / per) : Infinity;
    // Going down it can also just drop: half the distance in damage, and it lands prone (Stand: an action). Taken
    // when that's quicker than climbing down (up to 20 feet; further is a real fall)
    if (!up && dz <= 20) {
        const vText = `drop down ${dz} ft (${Math.floor(dz / 2)} bludgeoning, lands prone) and Stand`;
        // From where it stands it first has to Step off the edge
        options.push({ kind: "drop", r: here ? { actions: 2 + stand, provokes: landing(), via: `${standText}Step off the edge, ${vText}`, feet: dz, z, vertical: true, fall: Math.floor(dz / 2) }
            : { ...route, actions: route.actions + 1, provokes: landing(), vAct: 1, vText, z, fall: Math.floor(dz / 2) } });
    }
    if (Number.isFinite(climb)) {
        const vText = `Climb ${up ? "up" : "down"} ${dz} ft${sp.climb > 0 ? "" : face?.dc ? ` (Athletics DC ${face.dc}; a critical failure falls)` : " (Athletics)"}`;
        // Without a climb Speed each Climb is an Athletics check: a failure gets it nowhere
        const odds = sp.climb > 0 ? 1 : (() => { const c = degreeChances(board.me.athletics ?? (board.me.level ?? 0) + 4, face?.dc ?? 15); return c.s + c.cs; })();
        options.push({ kind: "climb", odds, acts: climb, r: here ? { actions: climb + stand, provokes: landing(), via: `${standText}${vText}`, feet: dz, z, climb: true, vertical: true }
            : { ...route, actions: route.actions + climb, provokes: landing(), vAct: climb, vText, z, climb: true } });
    }
    return pickHeightWay(board.me, options.filter((o) => o.r.actions <= ACT), sp.climb > 0)?.r ?? null;
}

/** Walk round, climb or drop. Anything that thinks counts a drop's damage and lying prone as an action more and a
 *  reaction it sets off as half an action, and walks when it's no dearer: two actions and a fall lose to three on foot.
 *  The mindless take the fewest actions, and just go over the edge when that's as quick. */
function pickHeightWay(me, options, climber = false) {
    if (!options.length) return null;
    const mindless = !!me?.mindless;
    const order = mindless ? (climber ? { climb: 0, drop: 1, walk: 2 } : { drop: 0, climb: 1, walk: 2 }) : { walk: 0, climb: 1, drop: 2 };
    // A Climb it may fail counts as the actions it takes on average
    const cost = (o) => (mindless ? o.r.actions : o.r.actions + (o.kind === "drop" ? 1 : 0) + (o.kind === "climb" ? (o.acts ?? 0) * (1 / Math.max(0.05, o.odds ?? 1) - 1) : 0) + 0.5 * (o.r.provokes?.length ?? 0));
    return options.slice().sort((a, b) => cost(a) - cost(b) || order[a.kind] - order[b.kind])[0];
}

function isOffGuard(target) {
    // Prone, grabbed and the rest grant the off-guard condition, against ranged attacks too
    for (const c of OFF_GUARD_FROM) if (target.conditions.has(c)) return true;
    return false;
}

/** The AC to beat. PF2e already counts the off-guard condition in the AC it reports; flanking it doesn't. */
function acAgainst(target, flanked = false) {
    return target.ac - (flanked && !isOffGuard(target) ? 2 : 0);
}

/** Best sequence of n Strikes from a list, given the attacks already made this turn. */
/** Extra damage the planning creature deals to an off-guard target (Sneak Attack and the like). planTurn sets it from board.sneak. */
let SNEAK = 0;
/** Actions this creature has left this turn (3, fewer when slowed or stunned, less what it has spent). Set by planTurn. */
let ACT = 3;
/** Attacks it has already made this turn, for the multiple attack penalty. Set by planTurn from board.turn. */
let TURN_MADE = 0;
/** Animals and mindless creatures fight on instinct: closest foe, shortest path, no reading of the board. */
/** "Stride ×2 into reach of Valeros", or "to a clear line on Valeros" for a ranged attack. */
/** The move part of a step: "Stride ×2", "Stand, then Stride", "Stride, opening a door on the way". */
const routeText = (route) => {
    const k = Math.max(1, (route.actions ?? 0) - (route.doors ?? 0) - (route.stand ? 1 : 0) - (route.vAct ?? 0));
    const doors = route.doors ? `, opening ${route.doors > 1 ? `${route.doors} doors` : "a door"} on the way` : "";
    return `${route.via}${k > 1 && !/×\d/.test(route.via ?? "") && !route.vertical ? ` ×${k}` : ""}${doors}${route.tail ?? ""}${route.vText ? `, then ${route.vText}` : ""}`;
};
const approachText = (route, t, ranged = false) => `${routeText(route)}${route.doors || route.tail || route.vText ? "," : ""} ${ranged ? "to a clear line on" : "into reach of"} ${nameOf(t)}`;
const isAnimal = (me) => !!(me?.mindless || (me?.int ?? 0) <= -4);
/**
 * How it picks targets, by Intelligence. 0 instinct (mindless or Int -4 or lower), 1 crude (Int -3 to +0),
 * 2 tactical (+1), 3 shrewd (+2), 4 sharp (+3 or more).
 */
const tierOf = (me) => (isAnimal(me) ? 0 : (me?.int ?? 0) <= 0 ? 1 : me.int === 1 ? 2 : me.int === 2 ? 3 : 4);
const TIER_TEXT = [
    "On instinct: the closest foe, or whatever hurt it most",
    "Crude: goes by what it sees (armor, wounds, who's in its face)",
    "Tactical: flanks, focuses fire, finishes off the hurt",
    "Shrewd: tactical, and goes for healers and casters first",
    "Sharp: reads real AC and saves, goes for healers and casters",
];
/**
 * Threat works like aggro: the foe who has proven most dangerous counts as this much juicier than they look (40%
 * means each attack on them is weighed as if worth 40% more). Animals lash back at whatever hurt them; the cleverer it
 * is, the more it judges the fight as a whole (NOTICE: how much of the harm done to its allies it takes in), so the
 * pull rises with wits rather than falling. Someone with half the top threat gets a quarter of the pull.
 */
const THREAT_PULL = [0.4, 0.35, 0.4, 0.45, 0.5];
/** What putting a fallen ally back on its feet is worth, by wits, as a share of two rounds of that ally's attacks. */
const REVIVE_WEIGHT = [0, 0.5, 0.8, 1, 1];
const NOTICE = [0, 0.25, 0.5, 0.6, 0.75];
const actorTier = (a) => tierOf({ mindless: a?.traits?.has?.("mindless") ?? false, int: a?.system?.abilities?.int?.mod ?? 0 });
/** The multiplier threat puts on a plan against t: 1 plus the pull times the square of t's share of the top threat. */
const threatPull = (board, t, tier) => 1 + THREAT_PULL[tier] * threatScale() * threatShare(board, t) ** 2;
/** Rough worth of each condition to the fight, from what it does: losing actions and being unable to act weigh most. */
const CONDITION_VALUE = { frightened: 2, sickened: 2.5, clumsy: 1.5, enfeebled: 1.5, stupefied: 1.5, drained: 1.5, fatigued: 1.5, dazzled: 2, blinded: 5, deafened: 0.5,
    "off-guard": 2, prone: 3.5, slowed: 5, stunned: 5, immobilized: 2.5, grabbed: 3.5, restrained: 7, paralyzed: 10, confused: 5,
    fascinated: 2, fleeing: 5, unconscious: 10, petrified: 10, controlled: 12, doomed: 1 };
/** A condition's weight within a degree's list: a bare slug counts once; "frightened-2"-style entries count by value. */
function valueScale(k, list) { const m = /-(\d+)$/.exec(String(k)); return m ? Math.max(1, Number(m[1])) : 1; }
/** The board being planned, and a cache of what each attacker square sees of each target. Set by planTurn. */
let BOARD = null;
/** Set by planTurn for a thinking flier: { penalty(at), leave(at) } so a Strike can give way to flying off. */
let HIT_RUN = null;
const FLY_AWAY = "Fly out of their reach (straight up works if they can't fly or reach that high; it must Fly each turn to stay up)";
/** Flying off: straight up, as many feet as it takes to be out of everyone's reach. */
function flyAwayText(board, at) {
    const z0 = at.z ?? board.me.rect.z ?? 0;
    // Flying up is difficult terrain (Player Core): one Fly action climbs half its fly Speed
    const maxUp = Math.max(5, Math.floor((board.move?.speeds?.fly ?? 0) / 10) * 5);
    const meleeAt = (z) => board.enemies.filter((e) => e.canAct !== false && !e.objective && inReach(e.rect, { ...at, z }, e.reach));
    const shootersAt = (z) => board.enemies.filter((e) => e.canAct !== false && !e.objective && (e.rangedReach ?? 0) > 0 && feetBetween(e.rect, { ...at, z }) <= e.rangedReach);
    for (let up = 5; up <= Math.min(60, maxUp); up += 5) {
        if (meleeAt(z0 + up).length) continue;
        const sh = shootersAt(z0 + up);
        return `Fly up ${up} ft, out of their reach (it must Fly each turn to stay up${sh.length ? `; still in range of ${sh.map(nameOf).join(", ")}` : ""})`;
    }
    return FLY_AWAY;
}
let CTX = new Map();

/**
 * What an attack from square `at` on target t faces: cover (0, 1 lesser, 2 standard, 4 greater; noLine when
 * walls block every line), how well the attacker perceives t (flat check), and whether t can't see the attacker
 * there (t is off-guard to it: hidden or undetected).
 */
function attackCtx(at, t, { ranged = true, area = false } = {}) {
    const none = { cover: 0, flat: 1, hidden: false, state: "observed", seen: "observed", noLine: false, light: "bright" };
    if (!BOARD || !t?.rect) return none;
    const from = at ?? BOARD.me.rect;
    const k = `${from.x},${from.y},${from.z ?? 0},${t.id},${ranged ? 1 : 0}${area ? 1 : 0}`;
    if (CTX.has(k)) return CTX.get(k);
    const cover = coverBetween(BOARD, from, t, { area, ranged, fromSize: BOARD.me.sizeRank ?? 2 });
    const feet = feetBetween(from, t.rect);
    const light = BOARD.lightAt ? BOARD.lightAt(t.rect) : "bright";
    const v = BOARD.visioner?.get?.(t.id) ?? null;
    const own = !at || (from.x === BOARD.me.rect.x && from.y === BOARD.me.rect.y && (from.z ?? 0) === (BOARD.me.rect.z ?? 0));
    const state = withVisioner(visibilityOf({ senses: BOARD.me.senses, conditions: BOARD.me.conditions }, t, light, feet), v?.state, own);
    const mine = BOARD.lightAt ? BOARD.lightAt(from) : "bright";
    const seen = withVisioner(t.senses ? visibilityOf({ senses: t.senses, conditions: t.conditions }, { conditions: BOARD.me.conditions }, mine, feet) : "observed", v?.seen, own);
    const out = { cover: Math.max(0, cover), noLine: cover < 0, state, light, seen, flat: area ? 1 : flatFor(state), hidden: seen === "hidden" || seen === "undetected", visioner: !!v };
    CTX.set(k, out);
    return out;
}

const COVER_NAME = { 1: "lesser", 2: "standard", 4: "greater" };
/** Range increments past the first: -2 each. */
const rangeSteps = (dist, inc) => (inc > 0 && dist > inc ? Math.ceil(dist / inc) - 1 : 0);
/** How many enemies couldn't see it on this square (darkness, invisibility): they'd need a DC 11 flat check to target it. */
function hiddenFrom(board, at) {
    if (!board.lightAt) return 0;
    const light = board.lightAt(at);
    const own = at.x === board.me.rect.x && at.y === board.me.rect.y && (at.z ?? 0) === (board.me.rect.z ?? 0);
    return board.enemies.filter((e) => e.senses && ["hidden", "undetected"].includes(withVisioner(visibilityOf({ senses: e.senses, conditions: e.conditions }, { conditions: board.me.conditions }, light, feetBetween(at, e.rect)), board.visioner?.get?.(e.id)?.seen, own))).length;
}
/** Notes on a plan about cover and sight between this square and the target. */
function sightNotes(plan, at, t, { ranged = true, attack = true } = {}) {
    const c = attackCtx(at, t, { ranged });
    if (c.cover && attack) plan.notes.push(`${nameOf(t)} has ${COVER_NAME[c.cover]} cover from there: +${c.cover} AC`);
    if (c.state !== "observed") plan.notes.push(`${nameOf(t)} is ${c.state} to it${c.visioner ? " (Visioner)" : c.light !== "bright" ? ` (${c.light === "magical" ? "magical darkness" : c.light === "dark" ? "darkness" : "dim light"})` : ""}: DC ${c.state === "concealed" ? 5 : 11} flat check to target${c.state === "undetected" ? ", and it has to guess the square" : ""}`);
    if (c.hidden && !t.conditions?.has?.("unconscious")) {
        const byAction = BOARD.me.conditions?.has?.("hidden") || BOARD.me.conditions?.has?.("undetected");
        const deny = t.flankImmune === "deny" && (BOARD.me.level ?? 0) <= (t.level ?? 0);
        plan.notes.push(`${nameOf(t)} can't see it there (${c.seen})${deny ? "; Deny Advantage, so not off-guard to it" : byAction ? ": off-guard to its first attack" : ": off-guard to its attacks, and needs a DC 11 flat check to target it"}`);
    }
}
/** Extra damage against particular targets this turn (Pack Attack and the like): target id -> average. Set by planTurn. */
let EXTRA_VS = new Map();
function strikeRun(strikes, n, ac, { made = 0, offGuard = false, vs = null, at = null } = {}) {
    const extra = vs ? EXTRA_VS.get(vs.id) ?? 0 : 0;
    let total = 0, firstHit = null;
    const used = [];
    for (let i = 0; i < n; i++) {
        let best = null;
        for (const s of strikes) {
            const bonus = s.bonus + mapFor(TURN_MADE + made + i, s.agile);
            // Cover and sight from where it stands; weakness and resistance to the Strike's damage
            const ctx = vs ? attackCtx(at, vs, { ranged: !!s.ranged }) : null;
            if (ctx?.noLine) continue;
            // Unseen: off-guard to it. Hidden by its own Hide or Sneak, only for the first attack; hidden by darkness or
            // invisibility, for all of them. Deny Advantage: not against creatures of its level or lower.
            const byAction = BOARD.me.conditions?.has?.("hidden") || BOARD.me.conditions?.has?.("undetected");
            const surprise = !!ctx?.hidden && !offGuard && (!byAction || (i === 0 && made + TURN_MADE === 0)) && !(vs.flankImmune === "deny" && (BOARD.me.level ?? 0) <= (vs.level ?? 0));
            // Prone and it moved, so it stood first: the prone -2 already in its Strikes is gone
            const stood = BOARD.me.conditions?.has?.("prone") && at && (at.x !== BOARD.me.rect.x || at.y !== BOARD.me.rect.y) ? 2 : 0;
            const dmg = damageAgainst(vs?.iwr, s.damageTypes ?? []);
            const raw = strikeExpected(bonus + stood, ac + (ctx?.cover ?? 0) - (surprise ? 2 : 0), s.avg + extra + (offGuard || surprise ? SNEAK : 0), { deadly: s.deadly, delta: dmg.delta, immune: dmg.immune });
            const f = ctx?.flat ?? 1;
            const e = { hit: raw.hit * f, crit: raw.crit * f, expected: raw.expected * f };
            if (!best || e.expected > best.e.expected) best = { s, bonus, e };
        }
        if (!best) break;
        if (firstHit === null) firstHit = best.e.hit;
        total += best.e.expected;
        used.push(best);
    }
    return { expected: total, used, firstHit: firstHit ?? 0 };
}

/**
 * The chance a run of Strikes (as strikeRun chose them) deals at least hp damage, allowing for misses, crits and
 * the spread of the dice: each hit lands at about 70%, 100% or 130% of its average (a quarter, half, a quarter).
 */
function dropChance(used, hp) {
    if (!(hp > 0)) return 1;
    let dist = new Map([[0, 1]]);
    for (const u of used) {
        const hit = Math.max(0, (u.e?.hit ?? 0) - (u.e?.crit ?? 0)), crit = u.e?.crit ?? 0, miss = Math.max(0, 1 - hit - crit);
        const avg = Math.max(0, u.s?.avg ?? 0), dead = u.s?.deadly ?? 0;
        const outcomes = [[miss, 0]];
        for (const [p, mult] of [[0.25, 0.7], [0.5, 1], [0.25, 1.3]]) { outcomes.push([hit * p, avg * mult], [crit * p, (avg * 2 + dead) * mult]); }
        const next = new Map();
        for (const [dmg, pr] of dist) for (const [po, d] of outcomes) { if (!po) continue; const k = Math.min(hp, Math.round(dmg + d)); next.set(k, (next.get(k) ?? 0) + pr * po); }
        dist = next;
    }
    return dist.get(hp) ?? 0;
}

function describeStrikes(used, targetName) {
    if (!used.length) return "";
    const groups = [];
    for (const u of used) {
        const g = groups[groups.length - 1];
        if (g && g.s === u.s) g.bonuses.push(u.bonus);
        else groups.push({ s: u.s, bonuses: [u.bonus] });
    }
    return groups.map((g) => `Strike ${targetName} with ${g.s.label}${g.bonuses.length > 1 ? ` ${g.bonuses.length === 2 ? "twice" : "three times"}` : ""} (${g.bonuses.map(signed).join(", ")})`).join(", then ");
}

/** The penalty for provoking: what those reactions are expected to deal. */
function provokeCost(board, ids) {
    let total = 0;
    for (const id of ids) {
        const e = board.enemies.find((x) => x.id === id);
        if (!e) continue;
        total += strikeExpected(e.reactiveStrike.bonus, board.me.ac, e.reactiveStrike.avg).expected;
    }
    return total;
}
const provokeNames = (board, ids) => ids.map((id) => {
    const e = board.enemies.find((x) => x.id === id);
    const r = e?.reactions.find((p) => p.trigger.onMove);
    return e ? `${nameOf(e)}'s ${r?.name ?? "reaction"}` : null;
}).filter(Boolean);

/** Flanking from this square against the target with any ally that can reach it. */
function flankingAlly(board, at, target) {
    // Both flankers able to act, both with a melee attack and the foe in reach; Tiny with no reach can't flank.
    // All-around vision can't be flanked; Deny Advantage can't be by creatures of its level or lower.
    if (target.flankImmune === "all") return null;
    if (target.flankImmune === "deny" && (board.me.level ?? 0) <= (target.level ?? 0)) return null;
    if (board.me.conditions?.has?.("confused")) return null;
    if (board.me.sizeRank === 0 && !board.strikes.some((s) => !s.ranged && s.reach > 0)) return null;
    for (const a of board.allies) {
        if (a.canAct === false || a.hasMelee === false || !a.reach) continue;
        if (!inReach(a.rect, target.rect, a.reach)) continue;
        if (flanks(at, a.rect, target.rect)) return a;
    }
    return null;
}

/** How exposed a square is: enemies that could Strike it without moving. */
function exposure(board, at) {
    // Foes whose reach covers the square count in full; foes who can shoot or cast at it count half: "out of
    // their reach" is worth less against archers and casters
    let n = 0;
    for (const e of board.enemies) {
        if (e.canAct === false || e.objective) continue;
        if (inReach(e.rect, at, e.reach)) n += 1;
        else if ((e.rangedReach ?? 0) > 0 && feetBetween(e.rect, at) <= e.rangedReach) n += 0.5;
    }
    return n;
}

/** Enemies whose reactions a manipulate action here would set off. Spells without manipulate (verbal only) don't provoke. */
function castProvokers(board, at, traits = []) {
    if (!traits.includes("manipulate")) return [];
    return board.enemies.filter((e) => e.reactions.some((r) => r.trigger.onManipulate) && inReach(e.rect, at, e.reach));
}

/** Share of the top threat a target holds (0 to 1). Ignored until someone has done something worth noticing. */
function threatShare(board, t) {
    const tab = board.threat ?? {};
    const top = Math.max(0, ...board.enemies.map((e) => Number(tab[e.id]) || 0));
    return top < 3 ? 0 : Math.min(1, Math.max(0, Number(tab[t.id]) || 0) / top);
}

/**
 * Who it goes for, beyond the damage: what its tier lets it notice. Returns { b: score bonus, why: [reasons] }.
 * engaged: the foes already in its melee reach.
 */
function targetBonus(board, plan, tier, engaged = []) {
    const t = plan.target;
    const me = board.me;
    const why = [];
    if (t.conditions.has("dying") || t.hp <= 0) return board.vicious ? { b: 2, why: ["finishing them"], mult: 1 } : { b: -20, why, mult: 1 };
    const share = threatShare(board, t);
    // Sticky: it keeps on whoever it was already fighting, unless something better turns up
    const stick = board.lastTarget && board.lastTarget === t.id ? 1.12 : 1;
    const mult = threatPull(board, t, tier) * stick;
    if (stick > 1) why.push("still on them");
    let b = 0;
    if (share >= 1) why.push("top threat");
    if (t.objective) { b += 2; why.push("what it's after"); }
    if (tier === 0) return { b, why, mult };
    const hurt = t.hp / Math.max(1, t.maxHp) < 0.5;
    // How likely the plan's Strikes are to take them down (the dice, not just the average); overkill is wasted
    const pDrop = t.hp <= 0 ? 1 : plan.used?.length ? dropChance(plan.used, t.hp) : plan.ev >= t.hp ? 0.6 : plan.ev >= t.hp * 0.75 ? 0.3 : 0;
    const drop = pDrop >= 0.5;
    const maybe = !drop && pDrop >= 0.25;
    // Damage past their HP is half wasted; taking them out of the fight is worth about two of its own hits
    const add = (plan.used?.length && plan.ev > t.hp ? -(plan.ev - t.hp) * 0.5 : 0) + (plan.used?.length ? pDrop * 2 * hitWorth(me.level) : 0);
    if (tier === 1) {
        // Crude: what's in front of it. Close, in its face, bleeding, down, alone, small.
        b -= feetBetween(me.rect, t.rect) / 10;
        if (engaged.includes(t)) { b += 2; why.push("in its face"); }
        if (hurt) { b += 1.5; why.push("looks hurt"); }
        if (t.conditions.has("prone")) { b += 1; why.push("down"); }
        if (!board.enemies.some((e) => e !== t && e.hp > 0 && feetBetween(e.rect, t.rect) <= 10)) { b += 1; why.push("on their own"); }
        if ((t.sizeRank ?? 2) < (me.sizeRank ?? 2)) b += 0.5;
        if (drop) { b += 2; why.push("could drop"); }
        return { b, why, mult, add };
    }
    if (drop) { b += plan.used?.length ? 2 : 5; why.push(pDrop >= 0.75 ? "likely drops" : "could drop"); }
    else if (maybe) { b += 1; why.push("might drop"); }
    else if (t.hp > 0 && plan.ev >= t.hp * 0.5) b += 1.5;
    if (hurt) { b += 1; why.push("hurt"); }
    // Focus fire: someone on its side is already on them
    if ((board.allies ?? []).some((a) => a.hp > 0 && a.canAct !== false && a.hasMelee !== false && inReach(a.rect, t.rect, a.reach))) { b += 1; why.push("allies on them"); }
    if (tier >= 3) {
        if (t.healer) { b += 1.5; why.push("healer"); }
        else if (t.caster) { b += 1; why.push("caster"); }
    }
    return { b, why, mult, add };
}

/** An area catches several: it leans toward catching the top threat. */
function areaPick(board, plan, tier) {
    const caught = plan.caught ?? [];
    if (!caught.length) return { b: 0, why: [] };
    // Each caught foe's part of the damage, pulled by their threat
    const per = (plan.ev ?? 0) / caught.length;
    const add = caught.reduce((x, c) => x + per * (threatPull(board, c, tier) - 1), 0);
    return { b: 0, add, why: caught.some((c) => threatShare(board, c) >= 1) ? ["catches the top threat"] : [] };
}

const ARMOR_LOOK = { heavy: 2, medium: 1, light: 0, unarmored: -1 };
const hitChance = (bonus, ac) => Math.min(0.95, Math.max(0.05, (21 + bonus - ac) / 20));
const failChance = (save, dc) => Math.min(0.95, Math.max(0.05, (dc - save - 1) / 20));

/** The AC it thinks a target has: the party's average, nudged by visible armor and a raised shield. Off-guard shows. */
function seenAc(board, t, tier) {
    const foes = board.enemies.filter((e) => e.hp > 0);
    const bare = (e) => e.ac + (isOffGuard(e) ? 2 : 0) - (e.shieldBonus ?? 0);
    const avg = foes.length ? foes.reduce((sum, e) => sum + bare(e), 0) / foes.length : bare(t);
    const look = tier === 0 ? 0 : (ARMOR_LOOK[t.armor] ?? 0) + (t.shieldRaised ? 2 : 0);
    const guess = avg + look - (isOffGuard(t) ? 2 : 0);
    if (tier === 0 || tier >= 4) return guess + learnK(board, t, "ac", tier) * (t.ac - guess);
    // Attacks on them this fight show what it takes to hit them: each hit or miss is a bound on their AC, and the
    // guess is squeezed inside the bounds as they tighten (an exact AC once the bounds meet)
    const b = learnedAcBounds(board, t);
    const bounded = b ? Math.min(b.hi, Math.max(b.lo, guess)) : guess;
    return bounded + learnK(board, t, "ac", tier) * 0.5 * (t.ac - bounded);
}

/**
 * Below Int +3 it can't know real AC or saves: weigh a plan by how good the target looks rather than how good it is.
 * Returns the factor on its expected damage (0.5 to 2). Areas and plans with no single target are left alone.
 */
function seenFactor(board, plan, tier) {
    const t = plan.target;
    if (tier >= 4 || !t || plan.kind === "area" || (plan.caught?.length ?? 0) > 1) return 1;
    const sp = plan.spell;
    const ab = plan.ability;
    let mode = null;
    if (["melee", "ranged", "strike", "attack"].includes(plan.kind)) mode = "attack";
    else if (sp) mode = sp.attack !== null && sp.attack !== undefined ? "attack" : sp.save?.stat ? "save" : null;
    // Strike-based abilities are attacks even with a save rider; otherwise a save, if it has one
    else if (ab) mode = ab.traits?.includes("attack") || ["move-strike", "multi-strike", "strike-variant", "payoff"].includes(ab.role) ? "attack" : ab.save?.stat ? "save" : null;
    const clamp = (f) => Math.min(2, Math.max(0.5, f));
    if (mode === "attack") {
        const bonus = typeof sp?.attack === "number" ? sp.attack : Math.max(board.me.level + 8, ...(board.strikes ?? []).map((x) => x.bonus));
        return clamp(hitChance(bonus, seenAc(board, t, tier)) / hitChance(bonus, t.ac));
    }
    if (mode === "save") {
        const stat = (sp?.save ?? ab.save).stat;
        const dc = sp ? sp.dc ?? 15 : abilityDc(board, ab);
        const foes = board.enemies.filter((e) => e.hp > 0);
        const avg = foes.reduce((sum, e) => sum + (e.saves[stat] ?? 0), 0) / Math.max(1, foes.length);
        const guess = avg + learnK(board, t, stat, tier) * ((t.saves[stat] ?? 0) - avg);
        return clamp(failChance(guess, dc) / failChance(t.saves[stat] ?? 0, dc));
    }
    return 1;
}

function areaHits(board, shape, size, { origin, aim, at, originZ }) {
    const self = at ?? board.me.rect;
    // Height: a burst reaches as far up and down from its point as it does across; cones, lines and emanations are
    // measured from the creature
    const high = (c) => {
        if (shape === "space") return true;
        if (shape !== "burst") return feetBetween(self, c.rect) <= size;
        const vg = verticalGap(originZ ?? c.rect.z ?? 0, c.rect);
        if (!vg) return true;
        // Across: squares from the burst's corner to the creature; up: the gap; counted together like a diagonal
        const ox = origin?.x ?? c.rect.x, oy = origin?.y ?? c.rect.y;
        const dx = Math.max(0, c.rect.x - ox, ox - (c.rect.x + c.rect.w)), dy = Math.max(0, c.rect.y - oy, oy - (c.rect.y + c.rect.h));
        const H = Math.max(dx, dy) + Math.floor(Math.min(dx, dy) / 2), V = Math.ceil(vg / 5 - 1e-9);
        return 5 * (Math.max(H, V) + Math.floor(Math.min(H, V) / 2)) <= size;
    };
    // "space": the creature's own squares (a swarm's damage)
    const { test } = shape === "space" ? { test: (x, y) => x >= self.x && x < self.x + self.w && y >= self.y && y < self.y + self.h } : areaTest(shape, size, { origin, aim, self });
    const enemies = board.enemies.filter((e) => rectInArea(test, e.rect) && high(e));
    const allies = board.allies.filter((a) => rectInArea(test, a.rect) && high(a));
    return { enemies, allies };
}

/** Within N feet: the range of a burst ability, from its text. */
function rangeFromText(text) {
    const m = /\bwithin (\d+) feet\b/i.exec(text ?? "");
    return m ? Number(m[1]) : null;
}

function abilityDc(board, p) {
    return p.save?.dc ?? board.me.actor?.system?.attributes?.classDC?.value ?? board.me.actor?.attributes?.classDC?.value ?? (14 + board.me.level);
}

function fillLast(board, plan, at, actionsLeft, target, made, acDrop = 0, skip = null) {
    // What to do with the actions a plan leaves: Strike on, Step out of reach, or raise a shield
    // skip(strike): a Strike the plan has ruled out (the fist, once the free hand is holding someone)
    if (actionsLeft <= 0) return;
    const melee = board.strikes.filter((s) => !s.ranged && !(skip && skip(s)));
    if (target && melee.length && melee.some((s) => inReach(at, target.rect, s.reach))) {
        const og = isOffGuard(target);
        const usable = melee.filter((s) => inReach(at, target.rect, s.reach));
        const run = strikeRun(usable, actionsLeft, target.ac, { vs: target, at, made, offGuard: og });
        if (!run.used.length) return; // no line from there
        // A thinking flier in their reach: one Strike fewer and Fly off, when that's worth more than staying
        if (HIT_RUN && exposure(board, at) > 0) {
            const k = actionsLeft - 1;
            const fewer = k > 0 ? strikeRun(usable, k, target.ac, { vs: target, at, made, offGuard: og }) : { expected: 0, used: [] };
            if (fewer.expected - HIT_RUN.leave(at) > run.expected - HIT_RUN.penalty(at)) {
                plan.ev += fewer.expected;
                if (fewer.used.length) { plan.used = [...(plan.used ?? []), ...fewer.used]; plan.steps.push({ cost: k, text: describeStrikes(fewer.used, nameOf(target)) }); }
                plan.steps.push({ cost: 1, text: flyAwayText(board, at) });
                plan.flyAway = true;
                plan.leaveRisk = HIT_RUN.leave(at);
                return;
            }
        }
        // acDrop: the chance (x2) an earlier hit left the target off-guard; weigh both outcomes
        const chance = og ? 0 : Math.min(1, acDrop / 2);
        const offRun = chance ? strikeRun(usable, actionsLeft, target.ac - 2, { vs: target, at, made, offGuard: true }) : run;
        plan.ev += (1 - chance) * run.expected + chance * offRun.expected;
        plan.used = [...(plan.used ?? []), ...run.used];
        plan.steps.push({ cost: actionsLeft, text: describeStrikes(run.used, nameOf(target)) });
        return;
    }
    const exposed = exposure(board, at);
    const shots = target && !exposed ? board.strikes.filter((s) => s.ranged && !s.thrown && !s.reload && feetBetween(at, target.rect) <= s.range) : [];
    if (shots.length) {
        const og = isOffGuard(target);
        const d = feetBetween(at, target.rect);
        const run = strikeRun(shots.map((s) => ({ ...s, bonus: s.bonus - (s.volley && d <= s.volley ? 2 : 0) })), actionsLeft, target.ac, { vs: target, at, made, offGuard: og });
        if (!run.used.length) return;
        plan.ev += run.expected;
        plan.used = [...(plan.used ?? []), ...run.used];
        plan.steps.push({ cost: actionsLeft, text: describeStrikes(run.used, nameOf(target)) });
        return;
    }
    const stuck = ["immobilized", "grabbed", "restrained", "prone"].some((c) => board.me.conditions?.has?.(c));
    if (exposed && !stuck && (board.me.airborne || (HIT_RUN && (!board.move.step.feet || HIT_RUN.penalty(at) > HIT_RUN.leave(at))))) {
        plan.steps.push({ cost: 1, text: flyAwayText(board, at) });
        plan.flyAway = true;
        plan.leaveRisk = HIT_RUN?.leave(at) ?? 0;
        actionsLeft -= 1;
    } else if (exposed && board.move.step.feet && !stuck) {
        plan.steps.push({ cost: 1, text: `${board.move.step.by ?? "Step"} out of reach if it can`, value: 1 });
        plan.ev += 1;
        actionsLeft -= 1;
    }
    if (actionsLeft > 0 && board.me.shield && !board.me.shieldRaised) {
        plan.steps.push({ cost: 1, text: "Raise a Shield" });
        plan.ev += 1.5;
    }
}

/**
 * Candidate turns. Returns plans sorted best first:
 * { kind, title, target, steps: [{cost, text}], ev, score, notes: [], dest: {x, y} | null }
 */
function planTurn(board, { intent = null, noFollow = false, noSustain = false } = {}) {
    const plans = [];
    const { me } = board;
    BOARD = board;
    CTX = new Map();
    SNEAK = board.sneak ?? 0; // planTurn never awaits, so this can't leak into another creature's plan
    // Its own conditions: how many actions, and what it can still do
    const mc = me.conditions ?? new Set();
    const cv = me.conditionValues ?? {};
    // Quickened adds an action (its source limits what it's for: the card's note says so)
    const BASE = Math.max(0, Math.min(3, 3 - (cv.stunned ? cv.stunned : cv.slowed ?? 0))) + (mc.has("quickened") && !cv.stunned ? 1 : 0);
    // What it has already done this turn: actions spent, attacks made (the MAP), a flourish used
    const turn = board.turn ?? null;
    TURN_MADE = turn?.attacks ?? 0;
    ACT = Math.max(0, BASE - (turn?.spent ?? 0));
    const halt = (title, text) => [{ kind: "none", title, target: null, ev: 0, score: 0, dest: null, notes: [], steps: [{ cost: 0, text }] }];
    if (["paralyzed", "unconscious", "petrified", "dying"].some((c) => mc.has(c))) return halt("It can't act", "No actions this turn");
    if (BASE <= 0) return halt("No actions", cv.stunned ? `Stunned ${cv.stunned}: it loses its actions` : `Slowed ${cv.slowed}: no actions left`);
    if (ACT <= 0) return halt("Turn done", `All ${BASE} of its actions are used. Its reactions are still ready.`);
    if (mc.has("controlled")) return halt("Controlled", "Whoever controls it picks its actions");
    if (mc.has("confused")) return halt("Confused", "It Strikes or casts offensive cantrips at random creatures, allies included, and can't use reactions. Each time it takes damage from an attack or spell, a DC 11 flat check ends it");
    if (mc.has("fleeing") && !intent?.run) intent = { run: true, text: "Flees (fleeing): every action takes it away from what frightened it" };
    const restrained = mc.has("restrained");
    // Grabbed: manipulate actions need a DC 5 flat check. Stupefied: spells need DC 5 + X. Fascinated: no concentrate actions.
    const manipulateOk = mc.has("grabbed") ? flatCheck(5) : 1;
    const castOk = cv.stupefied ? flatCheck(5 + cv.stupefied) : 1;
    const spells = board.spells.filter((sp) => !(mc.has("fascinated") && sp.traits?.includes("concentrate")) && !(restrained && (sp.traits?.includes("manipulate") || sp.attack !== null)))
        .map((sp) => ({ ...sp, odds: (sp.potion ? 1 : castOk) * (sp.traits?.includes("manipulate") ? manipulateOk : 1) * (mc.has("deafened") && sp.traits?.includes("auditory") ? flatCheck(5) : 1) }));
    const profiles = board.profiles.filter((p) => !(restrained && (p.traits.includes("attack") || p.traits.includes("manipulate") || ["move-strike", "multi-strike", "strike-variant", "payoff"].includes(p.role)))
        && !(mc.has("fascinated") && p.traits.includes("concentrate"))
        && !(TURN_MADE && p.opensTurn) && !(turn?.flourish && p.traits.includes("flourish")));
    // Pack Attack: extra damage to a target within reach of enough of its allies, where they stand now
    EXTRA_VS = new Map();
    if (board.pack?.avg) {
        for (const t of board.enemies) {
            const around = (board.allies ?? []).filter((a) => a.hp > 0 && inReach(a.rect, t.rect, a.reach)).length;
            if (around >= board.pack.allies) EXTRA_VS.set(t.id, board.pack.avg);
        }
    }
    const melee = restrained ? [] : board.strikes.filter((s) => !s.ranged);
    const ranged = restrained ? [] : board.strikes.filter((s) => s.ranged);
    const squares = board.square ? reachableSquares(board) : [{ x: me.rect.x, y: me.rect.y, route: { actions: 0, provokes: [], via: null, feet: 0 } }];

    // Held: Escape (an attack, so it takes the MAP) against the best Athletics DC holding it
    if (["grabbed", "restrained"].some((c) => mc.has(c)) || (mc.has("immobilized") && !mc.has("prone"))) {
        const holders = board.enemies.filter((e) => inReach(e.rect, me.rect, Math.max(5, e.reach)));
        const dc = Math.max(10 + me.level + 3, ...holders.map((e) => 10 + (e.athletics ?? e.level + 5)));
        const unarmed = Math.max(-99, ...board.strikes.filter((s) => s.traits?.includes("unarmed")).map((s) => s.bonus));
        // Escape has the attack trait: it takes the multiple attack penalty from attacks already made
        const raw = Math.max(me.athletics ?? -99, me.acrobatics ?? -99, unarmed);
        const mod = raw > -99 ? raw + mapFor(TURN_MADE, false) : raw;
        const c = degreeChances(mod > -99 ? mod : me.level + 3, dc);
        plans.push({ kind: "escape", title: "Escape", target: null, ev: (c.s + c.cs) * (restrained ? 8 : 4), dest: null, notes: [`${restrained ? "Restrained" : "Held"}: no move actions until it's free`],
            steps: [{ cost: 1, text: `Escape (${mod > -99 ? signed(mod) : "best of Athletics, Acrobatics or unarmed"} vs DC ${dc}; free about ${pct(c.s + c.cs)} of the time${c.cs ? ", with a 5-foot Stride on a critical success" : ""})` },
                { cost: Math.max(0, ACT - 1), text: "If it's free: move or attack as the card's other options say" }] });
    }
    const selfNotes = [];
    if (mc.has("prone")) selfNotes.push("Prone: -2 to its attacks and off-guard. Standing is a move action (Reactive Strike from anyone in reach); moves here include it");
    if (mc.has("grabbed")) selfNotes.push("Grabbed: manipulate actions need a DC 5 flat check");
    if (cv.slowed && !cv.stunned) selfNotes.push(`Slowed ${cv.slowed}: ${ACT} action${ACT === 1 ? "" : "s"}`);
    if (cv.stunned) selfNotes.push(`Stunned ${cv.stunned}: ${ACT} action${ACT === 1 ? "" : "s"}`);
    if (mc.has("quickened")) selfNotes.push("Quickened: one more action, for whatever its source allows (often a Strike or Stride)");
    if (cv.stupefied) selfNotes.push(`Stupefied ${cv.stupefied}: spells need a DC ${5 + cv.stupefied} flat check`);
    if (mc.has("fascinated")) selfNotes.push("Fascinated: no concentrate actions except against what fascinates it");
    if (mc.has("blinded")) selfNotes.push("Blinded: everything is hidden to it (DC 11 flat check), normal terrain is difficult");
    const rectAt = (sq) => ({ x: sq.x, y: sq.y, w: me.rect.w, h: me.rect.h, z: sq.z ?? me.rect.z ?? 0, ht: me.rect.ht, lvl: me.rect.lvl ?? null });
    const animal = me.mindless || me.int <= -4;
    const recharging = (p) => (board.rechargeLeft?.(p) ?? 0) > 0;
    const targets = board.enemies.filter((e) => e.hp > 0 && !e.conditions.has("dying"));
    // A vicious creature also Strikes (or blasts) foes who are down: each hit pushes them toward death
    const strikeTargets = [...targets, ...(board.vicious ? board.downEnemies ?? [] : [])];
    const myTier = tierOf(me);
    // Bonuses tuned at low level keep their weight as damage grows (a hit at level 20 is five times one at level 1)
    const lvlScale = Math.max(1, hitWorth(me.level) / 8);
    // Ending its turn in their reach: about half a hit from each foe there
    const endPenalty = (at) => exposure(board, at) * 0.5 * hitWorth(me.level);
    // A thinking flier strikes and flies off when that's worth more than staying in reach
    HIT_RUN = myTier >= 2 && (board.move?.speeds?.fly ?? 0) >= 20 && board.square && !["immobilized", "grabbed", "restrained", "prone"].some((c) => mc.has(c))
        ? { penalty: endPenalty, leave: (at) => provokeCost(board, board.threatsAt?.(at.x, at.y, at.z) ?? []) } : null;
    // "Each against a different target" (Double Bite, Bladestorm): the first Strike at t, the rest at the best other foes
    // in reach from there. sameMap: they all go at the current penalty (the MAP doesn't rise until after them).
    const eachRun = (at, t, count, ac, og, sameMap) => {
        const reachOf = (e) => melee.filter((s) => inReach(at, e.rect, s.reach));
        const first = strikeRun(reachOf(t), 1, ac, { vs: t, at, offGuard: og });
        const others = targets.filter((e) => e !== t && reachOf(e).length)
            .map((e) => ({ e, run: strikeRun(reachOf(e), 1, e.ac, { vs: e, at, made: sameMap ? 0 : 1, offGuard: isOffGuard(e) }) }))
            .filter((o) => o.run.used.length).sort((a, b) => b.run.expected - a.run.expected).slice(0, count - 1)
            .map((o, i) => (sameMap || i === 0 ? o : { e: o.e, run: strikeRun(reachOf(o.e), 1, o.e.ac, { vs: o.e, at, made: i + 1, offGuard: isOffGuard(o.e) }) }));
        const parts = [describeStrikes(first.used, nameOf(t)), ...others.map((o) => describeStrikes(o.run.used, nameOf(o.e)))].filter(Boolean);
        return { expected: first.expected + others.reduce((x, o) => x + o.run.expected, 0), n: 1 + others.length, text: parts.join(", and ") };
    };

    // Someone who means to leave: get as far from the enemies as possible, provoking as little as it can
    const fleePlan = (text, score) => {
        if (!board.square) {
            // No square grid to path on: say so, and still put the way out first
            return { kind: "run", title: cap(text.replace(/\.$/, "")), target: null, ev: 0, score, dest: null, notes: [],
                steps: [{ cost: ACT, text: `${board.move.stride.by ?? "Stride"} away from the enemies, the way that passes fewest of them (no square grid here, so by eye)` }] };
        }
        if (!board.enemies.length) {
            return { kind: "run", title: cap(text.replace(/\.$/, "")), target: null, ev: 0, score, dest: null, notes: [],
                steps: [{ cost: 0, text: "No one is left standing to get away from: it can go wherever its tactics say" }] };
        }
        let best = null;
        const dir = /\b(north|south|east|west)\b/i.exec(text)?.[1]?.toLowerCase();
        for (const sq of squares) {
            const at = rectAt(sq);
            const nearest = Math.min(...board.enemies.map((e) => feetBetween(at, e.rect)), 999);
            // "runs north", "makes for the gate to the east": lean that way (north is up the map)
            const lean = dir === "north" ? me.rect.y - sq.y : dir === "south" ? sq.y - me.rect.y : dir === "east" ? sq.x - me.rect.x : dir === "west" ? me.rect.x - sq.x : 0;
            const sc = nearest + lean * 3 - provokeCost(board, sq.route.provokes) * 3 - sq.route.actions * 0.1;
            if (!best || sc > best.score) best = { sq, nearest, score: sc };
        }
        if (!best) return null;
        const r = best.sq.route;
        return {
            kind: "run", title: cap(text.replace(/\.$/, "")), target: null, ev: 0, score,
            steps: r.actions ? [{ cost: r.actions, text: `${routeText(r)}${r.doors || r.tail || r.vText ? "," : ""} away${dir ? ` to the ${dir}` : ""}, ending ${best.nearest} feet from the nearest enemy` }]
                : [{ cost: 0, text: "Hold where it is: no square is further from them this turn" }],
            notes: r.provokes.length ? [`Provokes ${provokeNames(board, r.provokes).join(", ")}`] : [],
            dest: r.actions ? { x: best.sq.x, y: best.sq.y, z: best.sq.z } : null,
        };
    };
    if (intent?.run) { const fp = fleePlan(intent.text, 1000); if (fp) plans.push(fp); }

    for (const t of strikeTargets) {
        const downed = t.hp <= 0 || t.conditions.has("dying");
        // Melee: get into reach with as few actions as possible, then Strike
        if (melee.length) {
            const byActions = new Map();
            for (const sq of squares) {
                const at = rectAt(sq);
                const strikes = melee.filter((s) => inReach(at, t.rect, s.reach));
                if (!strikes.length) continue;
                const seen = attackCtx(at, t, { ranged: false });
                if (seen.noLine) continue; // a wall between them
                const ally = flankingAlly(board, at, t);
                const key = sq.route.actions;
                const cand = { sq, at, strikes, ally, provokes: sq.route.provokes, exp: exposure(board, at) - (seen.hidden ? 1 : 0) + seen.cover };
                const cur = byActions.get(key);
                const better = !cur || cand.provokes.length < cur.provokes.length
                    || (cand.provokes.length === cur.provokes.length && (!!cand.ally > !!cur.ally || (!!cand.ally === !!cur.ally && cand.exp < cur.exp)));
                if (better) byActions.set(key, cand);
            }
            for (const [actions, c] of byActions) {
                if (actions >= ACT) continue;
                const n = ACT - actions;
                const og = isOffGuard(t) || !!c.ally;
                const ac = acAgainst(t, !!c.ally);
                const run = strikeRun(c.strikes, n, ac, { vs: t, at: c.at, offGuard: og });
                const plan = { kind: "melee", title: `${actions ? "Close and Strike" : "Strike"} ${nameOf(t)}`, target: t, ev: run.expected, steps: [], notes: [], dest: actions ? { x: c.sq.x, y: c.sq.y, z: c.sq.z } : null };
                if (actions) {
                    const where = c.ally ? `to flank ${nameOf(t)} with ${nameOf(c.ally)}` : `into reach of ${nameOf(t)}`;
                    plan.steps.push({ cost: actions, text: `${routeText(c.sq.route)}${c.sq.route.doors || c.sq.route.tail || c.sq.route.vText ? "," : ""} ${where}` });
                } else if (c.ally) plan.notes.push(`Already flanking with ${nameOf(c.ally)}`);
                // A third Strike at -10 is often worth less than something else: Demoralize or Feint first, or a shield after
                if (n >= 3 && run.used.length >= 3 && !downed) {
                    const k = n - 1;
                    const rest = (a, opts = {}) => strikeRun(c.strikes, k, a, { vs: t, at: c.at, offGuard: og, ...opts });
                    const plain = rest(ac);
                    const worth = (a) => {
                        if (a.kind === "demoralize") return a.chances.s * rest(ac - 1).expected + a.chances.cs * rest(ac - 2).expected + (a.chances.f + a.chances.cf) * plain.expected + a.value;
                        if (a.kind === "feint" && !og) {
                            // Success: off-guard to the next melee attack; critical success: to all of them this turn and next
                            const firstOff = strikeRun(c.strikes, 1, ac - 2, { vs: t, at: c.at, offGuard: true }).expected + (k > 1 ? strikeRun(c.strikes, k - 1, ac, { vs: t, at: c.at, made: 1 }).expected : 0);
                            return a.chances.s * firstOff + a.chances.cs * rest(ac - 2, { offGuard: true }).expected + (a.chances.f + a.chances.cf) * plain.expected - a.chances.cf * 2;
                        }
                        return plain.expected + a.value;
                    };
                    const alt = thirdActionAlternatives(board, t, c.at).filter((a) => a.kind !== "feint" || !og).map((a) => ({ ...a, ev: worth(a) })).sort((x, y) => y.ev - x.ev)[0] ?? null;
                    if (alt && alt.ev > run.expected) {
                        plan.ev = alt.ev;
                        plan.used = plain.used;
                        if (alt.first) plan.steps.push({ cost: 1, text: alt.text }, { cost: k, text: describeStrikes(plain.used, nameOf(t)) + alt.after });
                        else plan.steps.push({ cost: k, text: describeStrikes(plain.used, nameOf(t)) }, { cost: 1, text: alt.text });
                    } else { plan.used = run.used; plan.steps.push({ cost: n, text: describeStrikes(run.used, nameOf(t)) }); }
                } else { plan.used = run.used; plan.steps.push({ cost: n, text: describeStrikes(run.used, nameOf(t)) }); }
                if (og) plan.notes.push(`${nameOf(t)} is off-guard${c.ally ? " (flanked)" : ""}: AC ${ac}`);
                sightNotes(plan, c.at, t, { ranged: false });
                if (c.provokes.length) plan.notes.push(`Provokes ${provokeNames(board, c.provokes).join(", ")}`);
                plan.risk = provokeCost(board, c.provokes);
                plans.push(plan);
                if (downed) plan.notes.push(`${nameOf(t)} is down: each hit raises their dying value (2 on a critical hit)`);
                if (HIT_RUN && n >= 2 && exposure(board, c.at) > 0 && !downed) {
                    const fewer = strikeRun(c.strikes, n - 1, ac, { vs: t, at: c.at, offGuard: og });
                    if (fewer.used.length) {
                        const hr = { kind: "melee", title: `${actions ? "Close and Strike" : "Strike"} ${nameOf(t)}, then Fly Off`, target: t, ev: fewer.expected, steps: actions ? [{ ...plan.steps[0] }] : [],
                            notes: [...plan.notes], dest: plan.dest, flyAway: true, leaveRisk: HIT_RUN.leave(c.at), risk: plan.risk };
                        hr.steps.push({ cost: n - 1, text: describeStrikes(fewer.used, nameOf(t)) }, { cost: 1, text: flyAwayText(board, c.at) });
                        plans.push(hr);
                    }
                }
                // Prone and already in reach: Stand first (no -2 on the Strikes, not off-guard afterwards), or fight from the ground
                if (mc.has("prone") && actions === 0 && n >= 2 && !["immobilized", "grabbed", "restrained"].some((x) => mc.has(x))) {
                    const stand = board.enemies.filter((e) => e.reactions?.some((r) => r.trigger.onMove) && inReach(e.rect, me.rect, e.reach)).map((e) => e.id);
                    const up = strikeRun(c.strikes.map((x) => ({ ...x, bonus: x.bonus + 2 })), n - 1, ac, { vs: t, at: c.at, offGuard: og });
                    const sp = { kind: "melee", title: `Stand, then Strike ${nameOf(t)}`, target: t, ev: up.expected + 1.5, dest: null, notes: [],
                        steps: [{ cost: 1, text: "Stand" }, { cost: n - 1, text: describeStrikes(up.used, nameOf(t)) }] };
                    if (stand.length) sp.notes.push(`Standing provokes ${provokeNames(board, stand).join(", ")}`);
                    sp.risk = provokeCost(board, stand);
                    plans.push(sp);
                }
            }
        }

        // Ranged Strikes from a square in the first range increment, out of reach if possible
        for (const s of ranged) {
            let best = null;
            for (const sq of squares) {
                if (sq.route.actions > 1 || sq.route.actions >= ACT) continue;
                const at = rectAt(sq);
                const dist = feetBetween(at, t.rect);
                if (dist > s.range * 6) continue; // six range increments at most
                const seen = attackCtx(at, t);
                if (seen.noLine) continue;
                const exp = board.enemies.filter((e) => e.reactions.some((r) => r.trigger.onRanged) && inReach(e.rect, at, e.reach));
                // Out of reach, in the first increment, past volley range, with a clear line; staying unseen helps
                const score = -2 * rangeSteps(dist, s.range) + (s.volley && dist <= s.volley ? -2 : 0) - seen.cover * 1.5 + (seen.flat - 1) * 6 + hiddenFrom(board, at) * 0.7
                    - exp.length * 3 - sq.route.actions * 1.5 - sq.route.provokes.length * 3;
                if (!best || score > best.score) best = { sq, at, dist, exp, score };
            }
            if (!best) continue;
            const actions = best.sq.route.actions;
            const left = ACT - actions;
            const n = s.thrown ? 1 : s.reload ? Math.max(1, Math.floor((left + s.reload) / (1 + s.reload))) : left;
            const pen = -2 * rangeSteps(best.dist, s.range) + (s.volley && best.dist <= s.volley ? -2 : 0); // range increments, volley
            const run = strikeRun([{ ...s, bonus: s.bonus + pen }], Math.min(n, 3), t.ac, { vs: t, at: best.at, offGuard: isOffGuard(t) });
            const plan = { kind: "ranged", title: `${s.thrown ? "Throw at" : "Shoot"} ${nameOf(t)}`, target: t, ev: run.expected, steps: [], notes: [], dest: actions ? { x: best.sq.x, y: best.sq.y, z: best.sq.z } : null };
            if (actions) plan.steps.push({ cost: actions, text: `${routeText(best.sq.route)}${best.sq.route.doors || best.sq.route.tail || best.sq.route.vText ? "," : ""} to a clear line on ${nameOf(t)}${best.exp.length ? "" : ", out of reach"}` });
            plan.used = run.used;
            plan.steps.push({ cost: s.thrown ? 1 : left, text: describeStrikes(run.used, nameOf(t)) + (s.reload ? ` (reload ${s.reload} between shots)` : "") + (s.thrown ? " (thrown)" : "") });
            if (s.thrown && left > 1) fillLast(board, plan, best.at, left - 1, t, 1);
            if (best.dist > s.range) plan.notes.push(`${rangeSteps(best.dist, s.range) + 1} range increments out: ${-2 * rangeSteps(best.dist, s.range)}`);
            sightNotes(plan, best.at, t);
            if (s.volley && best.dist <= s.volley) plan.notes.push(`Within ${s.volley} feet: volley -2`);
            if (best.exp.length) plan.notes.push(`Shooting in reach of ${best.exp.map(nameOf).join(", ")} provokes`);
            plan.risk = provokeCost(board, [...best.sq.route.provokes, ...best.exp.map((e) => e.id)]);
            plans.push(plan);
        }

        // Single-target spells
        for (const sp of spells) {
            if (!sp.cost || sp.cost > ACT || sp.area || sp.heals || !sp.avg) continue;
            if (!sp.save && sp.attack === null) continue;
            const range = sp.range ?? 30;
            let best = null;
            for (const sq of squares) {
                if (sq.route.actions + sp.cost > ACT) continue;
                const at = rectAt(sq);
                if (feetBetween(at, t.rect) > range) continue;
                const seen = attackCtx(at, t);
                if (seen.noLine) continue;
                const exp = castProvokers(board, at, sp.traits);
                const score = -exp.length * 3 - sq.route.actions - sq.route.provokes.length * 3 + (seen.flat - 1) * 6 - (sp.attack !== null ? seen.cover : 0) + hiddenFrom(board, at) * 0.5;
                if (!best || score > best.score) best = { sq, at, exp, score, seen };
            }
            if (!best) continue;
            // Incapacitation: a target above twice the spell's rank improves its save (or the caster's roll is worse)
            const incap = sp.incapacitation && (t.level ?? 0) > 2 * (sp.rank ?? 1) ? 1 : 0;
            const dmg = damageAgainst(t.iwr, sp.damageTypes ?? []);
            const raw = sp.save ? saveExpected(t.saves[sp.save.stat] ?? 0, sp.dc ?? 15, sp.avg, { basic: sp.save.basic, shift: incap, delta: dmg.delta, immune: dmg.immune })
                : strikeExpected(sp.attack + mapFor(TURN_MADE, false), t.ac + best.seen.cover, sp.avg, { shift: -incap, delta: dmg.delta, immune: dmg.immune }); // a spell attack takes the MAP too
            const e = { expected: raw.expected * best.seen.flat * (sp.odds ?? 1) };
            const plan = { kind: "spell", title: `Cast ${sp.name} on ${nameOf(t)}`, target: t, ev: e.expected, steps: [], notes: [], dest: best.sq.route.actions ? { x: best.sq.x, y: best.sq.y, z: best.sq.z } : null, spell: sp };
            if (incap) plan.notes.push(`Incapacitation: ${nameOf(t)} is above level ${2 * sp.rank}, so one degree better for it`);
            if (dmg.immune) plan.notes.push(`${nameOf(t)} is immune to ${sp.damageTypes.join(", ")}`);
            else if (dmg.delta) plan.notes.push(`${nameOf(t)} ${dmg.delta > 0 ? `is weak to it: +${dmg.delta}` : `resists it: ${dmg.delta}`} per hit`);
            if ((sp.odds ?? 1) < 1) plan.notes.push(`About ${pct(sp.odds)} to get the spell off (flat check)`);
            sightNotes(plan, best.at, t, { attack: sp.attack !== null });
            if (best.sq.route.actions) plan.steps.push({ cost: best.sq.route.actions, text: `${routeText(best.sq.route)}${best.sq.route.doors || best.sq.route.tail || best.sq.route.vText ? "," : ""} into range of ${nameOf(t)}` });
            plan.steps.push({ cost: sp.cost, text: `Cast ${sp.name}${sp.cantrip ? "" : ` (rank ${sp.rank})`} at ${nameOf(t)}: ${sp.save ? `${sp.save.basic ? "basic " : ""}${cap(sp.save.stat)} DC ${sp.dc}` : `spell attack ${signed(sp.attack + mapFor(TURN_MADE, false))}`}` });
            fillLast(board, plan, best.at, ACT - best.sq.route.actions - sp.cost, t, sp.attack !== null ? 1 : 0);
            if (best.exp.length) plan.notes.push(`Casting in reach of ${best.exp.map(nameOf).join(", ")} provokes`);
            plan.risk = provokeCost(board, [...best.sq.route.provokes, ...best.exp.map((x) => x.id)]);
            plans.push(plan);
        }
    }

    // Abilities: move-and-Strike, several Strikes, areas, grabs and their payoffs, setups
    for (const p of profiles) {
        if (p.kind !== "action" || !p.cost || p.cost > ACT || recharging(p)) continue;
        // Press actions are only planned where an opening Strike is worked in (Strike variants, setups); the card still lists the rest
        if (p.afterAttack && p.role !== "setup") continue;
        if (p.role === "move-strike" && melee.length && !mc.has("prone")) { // prone: it has to Stand before it can Stride
            const moveFeet = p.moves.reduce((t, m) => t + (m.feet ?? (m.speedMult ?? 1) * (board.move.speeds[m.speed] ?? board.move.speeds.land ?? 0)) * (m.speedMult ? 1 : m.times), 0);
            const nr = p.moves.every((m) => m.noReactions);
            for (const t of targets) {
                let best = null;
                for (const sq of squares) {
                    const vertical = sq.z !== undefined;
                    if (vertical && (board.move.stride.speed !== "fly" || sq.route.vAct)) continue; // climbing and dropping aren't part of its move
                    const fs = vertical ? null : board.field?.safe?.get(cellKey(sq.x, sq.y));
                    const feet = vertical ? sq.route.feet : sq.route.actions === 0 ? 0 : fs?.feet;
                    if (feet === undefined || feet > moveFeet || (!vertical && !(fs?.end ?? sq.route.actions === 0))) continue;
                    const at = rectAt(sq);
                    const strikes = melee.filter((s) => inReach(at, t.rect, s.reach));
                    if (!strikes.length || attackCtx(at, t, { ranged: false }).noLine) continue;
                    const prov = nr ? [] : vertical ? (sq.route.provokes ?? []) : (fs?.provokes ?? []);
                    const ally = flankingAlly(board, at, t);
                    const score = -prov.length * 3 + (ally ? 1 : 0);
                    if (!best || score > best.score) best = { sq, at, strikes, prov, ally, score };
                }
                if (!best) continue;
                const ac = acAgainst(t, !!best.ally);
                const count = p.strikes?.count ?? 1;
                const each = p.strikes?.each && count > 1 ? eachRun(best.at, t, count, ac, isOffGuard(t) || !!best.ally, p.strikes.notes.includes("no MAP")) : null;
                const first = each ?? strikeRun(best.strikes, count, ac, { vs: t, at: best.at, offGuard: isOffGuard(t) || !!best.ally });
                const plan = { kind: "ability", title: `${p.name} into ${nameOf(t)}`, target: t, ev: first.expected, steps: [{ cost: p.cost, text: `${p.name}: move${best.ally ? ` to flank with ${nameOf(best.ally)}` : ""}, then ${each ? each.text : describeStrikes(first.used, nameOf(t))}` }], notes: [], dest: { x: best.sq.x, y: best.sq.y, z: best.sq.z }, ability: p };
                fillLast(board, plan, best.at, ACT - p.cost, t, p.strikes?.notes?.includes("one attack") ? 1 : each ? each.n : count);
                sightNotes(plan, best.at, t, { ranged: false });
                if (best.prov.length) plan.notes.push(`Provokes ${provokeNames(board, best.prov).join(", ")}`);
                plan.risk = provokeCost(board, best.prov);
                plans.push(plan);
            }
        }
        if (p.role === "multi-strike" && melee.length) {
            for (const t of targets) {
                // "A creature is grabbed in its pincer": only the one it's holding (the Grab line below plans getting there)
                if (p.requires.grab && !(t.conditions.has("grabbed") || t.conditions.has("restrained"))) continue;
                let best = null;
                for (const sq of squares) {
                    if (sq.route.actions + p.cost > ACT) continue;
                    const at = rectAt(sq);
                    const strikes = melee.filter((s) => inReach(at, t.rect, s.reach));
                    if (!strikes.length || attackCtx(at, t, { ranged: false }).noLine) continue;
                    const ally = flankingAlly(board, at, t);
                    const score = -sq.route.actions * 2 - sq.route.provokes.length * 3 + (ally ? 1 : 0);
                    if (!best || score > best.score) best = { sq, at, strikes, ally, score };
                }
                if (!best) continue;
                const ac = acAgainst(t, !!best.ally);
                const count = p.strikes.count;
                const og = isOffGuard(t) || !!best.ally;
                const one = strikeRun(best.strikes, 1, ac, { vs: t, at: best.at, offGuard: og });
                const each = p.strikes.each && count > 1 ? eachRun(best.at, t, count, ac, og, p.strikes.notes.includes("no MAP")) : null;
                const run = each ?? (p.strikes.notes.includes("no MAP") ? { ...one, expected: one.expected * count } : strikeRun(best.strikes, count, ac, { vs: t, at: best.at, offGuard: og }));
                const plan = { kind: "ability", title: `${p.name} on ${nameOf(t)}`, target: t, ev: run.expected, steps: [], notes: [], dest: best.sq.route.actions ? { x: best.sq.x, y: best.sq.y, z: best.sq.z } : null, ability: p };
                if (best.sq.route.actions) plan.steps.push({ cost: best.sq.route.actions, text: approachText(best.sq.route, t, !!best.usable && !best.usable.some((x) => !x.ranged)) });
                plan.steps.push({ cost: p.cost, text: each ? `${p.name}: ${each.text}` : `${p.name} (${count} Strike${count === 1 ? "" : "s"}${p.strikes.each ? ", each a different foe" : ""})` });
                fillLast(board, plan, best.at, ACT - best.sq.route.actions - p.cost, t, p.strikes.notes.includes("one attack") ? 1 : each ? each.n : count);
                plan.risk = provokeCost(board, best.sq.route.provokes);
                plans.push(plan);
            }
        }
        if (p.role === "area" && (p.save || p.damage.length)) {
            // Persistent damage keeps going (DC 15 flat check to end it): about twice its value
            const avg = p.damage.filter((d) => !d.persistent).reduce((t, d) => t + averageOf(d.formula), 0) + 2 * p.damage.filter((d) => d.persistent).reduce((t, d) => t + averageOf(d.formula), 0);
            // No area in the text: only "each creature adjacent / within reach" counts, as an emanation of its reach
            const around = /\beach (?:creature|enemy|foe)s? (?:adjacent to|within (?:its |their )?(?:reach|\d+ feet))|\b(?:all|each|every) adjacent (?:creatures?|enem(?:y|ies)|foes?)\b/i.exec(p.text);
            // Swarms: "each enemy in the swarm's space"
            const inSpace = /\beach (?:creature|enemy|foe)s? in (?:its|their|the [\w' -]+?'s) (?:space|area)\b/i.test(p.text);
            const area = p.area ?? (inSpace ? { shape: "space", size: 0 } : around ? { shape: "emanation", size: /adjacent/i.test(around[0]) ? 5 : Number(/within (\d+) feet/i.exec(around[0])?.[1] ?? Math.max(5, ...melee.map((s) => s.reach))) } : null);
            if (!area) continue;
            const plan = bestArea(board, squares, rectAt, { name: p.name, cost: p.cost, area, terrain: /\bdifficult terrain\b/i.test(p.text) && !/\bignores?\b[^.]{0,40}\bdifficult terrain\b/i.test(p.text), range: rangeFromText(p.text) ?? (area.shape === "burst" ? 30 : 0), save: p.save, dc: abilityDc(board, p), avg, inflicts: p.inflicts, traits: p.traits, endCost: myTier >= 1 || HIT_RUN ? endPenalty : null,
                damageTypes: p.damage.map((d) => d.type).filter(Boolean), incapacitation: p.traits.includes("incapacitation") ? { level: me.level } : null, odds: p.traits.includes("manipulate") ? manipulateOk : 1 });
            if (plan) { plan.ability = p; plans.push(plan); }
        }
        if ((p.role === "payoff" || p.role === "multi-strike") && p.requires.grab) {
            const avg = p.damage.reduce((t, d) => t + averageOf(d.formula), 0);
            const grabbers = melee.filter((s) => s.riderKeys.some((r) => /grab/.test(r)));
            for (const t of targets) {
                const held = t.conditions.has("grabbed") || t.conditions.has("restrained");
                const adjacent = melee.some((s) => inReach(me.rect, t.rect, s.reach));
                if (!held && (t.sizeRank ?? 2) > (me.sizeRank ?? 2) + 1) continue; // Grapple: at most one size larger
                const payEv = p.save ? saveExpected(t.saves[p.save.stat] ?? 0, abilityDc(board, p), avg, { basic: p.save.basic }).expected : avg * 0.9;
                if (held && adjacent && p.role === "multi-strike") continue; // its Strikes on the held creature are planned above
                if (held && adjacent) {
                    const times = Math.min(ACT, Math.floor(ACT / p.cost));
                    plans.push({ kind: "ability", title: `${p.name} the grabbed ${nameOf(t)}`, target: t, ev: payEv * times, steps: [{ cost: p.cost * times, text: `${p.name}${times > 1 ? ` ×${times}` : ""} on ${nameOf(t)} (only if ${board.me.name} is the one holding them)` }], notes: [], dest: null, ability: p });
                } else if (grabbers.length) {
                    // A "grab" rider is its own action after the hit; "improved grab" is free
                    const grabCost = (s) => (s.riderKeys.includes("improved-grab") ? 0 : 1);
                    let best = null;
                    for (const sq of squares) {
                        const at = rectAt(sq);
                        const g = grabbers.filter((s) => inReach(at, t.rect, s.reach) && sq.route.actions + 1 + grabCost(s) + p.cost <= ACT);
                        const score = sq.route.actions * 3 + sq.route.provokes.length * 3;
                        if (g.length && (!best || score < best.score)) best = { sq, at, g: g.sort((a, b) => grabCost(a) - grabCost(b)), score };
                    }
                    if (!best) continue;
                    const s = best.g[0];
                    const hitRun = strikeRun([s], 1, t.ac, { vs: t, at: best.at, offGuard: isOffGuard(t) });
                    const hit = { expected: hitRun.expected, hit: hitRun.firstHit };
                    // Remastered Grab is a Grapple: Athletics against the target's Fortitude DC, with no MAP
                    const grapple = degreeChances(me.athletics ?? me.level + 5, 10 + (t.saves.fortitude ?? 0));
                    const holds = hit.hit * (grapple.s + grapple.cs);
                    // Strikes on the creature it now holds (grabbed: off-guard); the Grab itself adds nothing to the MAP
                    let payAt = payEv;
                    if (p.strikes) {
                        const reach = melee.filter((x) => inReach(best.at, t.rect, x.reach));
                        const once = strikeRun(reach, 1, t.ac - 2, { vs: t, at: best.at, made: 1, offGuard: true });
                        payAt = p.strikes.notes.includes("no MAP") ? once.expected * p.strikes.count : strikeRun(reach, p.strikes.count, t.ac - 2, { vs: t, at: best.at, made: 1, offGuard: true }).expected;
                    }
                    const plan = { kind: "ability", title: `Grab ${nameOf(t)}, then ${p.name}`, target: t, ev: hit.expected + holds * payAt, steps: [], notes: [], dest: best.sq.route.actions ? { x: best.sq.x, y: best.sq.y, z: best.sq.z } : null, ability: p };
                    if (best.sq.route.actions) plan.steps.push({ cost: best.sq.route.actions, text: approachText(best.sq.route, t, !!best.usable && !best.usable.some((x) => !x.ranged)) });
                    plan.steps.push({ cost: 1, text: `Strike ${nameOf(t)} with ${s.label} (${signed(s.bonus)}; ${s.riders.join(", ")} on a hit)` });
                    plan.steps.push({ cost: grabCost(s), text: `If it hits: ${grabCost(s) ? "Grab" : "Improved Grab (free)"} ${nameOf(t)} (Grapple: Athletics ${signed(me.athletics ?? me.level + 5)} vs Fortitude DC ${10 + (t.saves.fortitude ?? 0)})` });
                    plan.steps.push({ cost: p.cost, text: `If it holds: ${p.name}` });
                    plan.notes.push(`Hit and hold about ${pct(holds)} of the time`);
                    plan.risk = provokeCost(board, best.sq.route.provokes);
                    plans.push(plan);
                }
            }
        }
        if (p.role === "setup" && !p.area) {
            // Press: an attack already made this turn opens it; otherwise a Strike goes first
            const press = p.afterAttack && !TURN_MADE;
            if (press && (p.cost + 1 > ACT || !melee.length)) continue;
            for (const t of targets) {
                if (p.inflicts.every((c) => t.conditions.has(c))) continue;
                const near = squares.find((sq) => sq.route.actions === 0 && feetBetween(rectAt(sq), t.rect) <= (rangeFromText(p.text) ?? Math.max(5, ...melee.map((s) => s.reach))));
                if (!near) continue;
                // Trip, Shove, Grapple, Disarm, Reposition: the target can be at most one size larger
                const maneuver = p.control.some((c) => ["trip", "shove", "grapple", "disarm", "reposition"].includes(c)) || p.skillCheck?.skill === "athletics";
                if (maneuver && (t.sizeRank ?? 2) > (me.sizeRank ?? 2) + 1) continue;
                const opener = press ? strikeRun(melee.filter((s) => inReach(me.rect, t.rect, s.reach)), 1, t.ac, { vs: t, offGuard: isOffGuard(t) }) : null;
                if (press && !opener.used.length) continue;
                const mapPen = p.traits.includes("attack") ? mapFor(TURN_MADE + (press ? 1 : 0), p.traits.includes("agile")) : 0;
                // A linked Trip, Shove, Grapple, Disarm or Reposition is Athletics against the right DC
                const MANEUVER_DC = { trip: "reflex", disarm: "reflex", shove: "fortitude", grapple: "fortitude", reposition: "fortitude" };
                const linked = p.control.find((c) => MANEUVER_DC[c]);
                const check = p.skillCheck ?? (linked ? { skill: "athletics", against: MANEUVER_DC[linked] } : null);
                const chance = p.save ? saveExpected(t.saves[p.save.stat] ?? 0, abilityDc(board, p), 1, { basic: false }).fail
                    : check ? (() => { const c = degreeChances((((check.skill === "athletics" ? me.athletics : null) ?? me.actor?.skills?.[check.skill]?.mod ?? me.level + 5) + mapPen), 10 + (t.saves[check.against] ?? 0)); return c.s + c.cs; })() : 0.55;
                const odds = (p.traits.includes("manipulate") ? manipulateOk : 1) * (mc.has("deafened") && p.traits.includes("auditory") ? flatCheck(5) : 1);
                // Setups on the hit scale too (a level-1 wolf and a level-12 troll both see a knockdown as "a hit's worth")
                let value = (odds * chance * (p.inflicts.some((c) => OFF_GUARD_FROM.includes(c)) ? 3 : 2) + odds * chance * 2 * p.inflicts.filter((c) => ["stunned", "slowed", "paralyzed", "confused", "fleeing"].includes(c)).length) * Math.max(1, hitWorth(me.level) / 8);
                // A critical failure on Trip or Shove leaves it prone
                const backlash = check && (p.control.includes("trip") || p.control.includes("shove")) ? degreeChances((me.athletics ?? me.level + 5) + mapPen, 10 + (t.saves[check.against] ?? 0)).cf : 0;
                value -= backlash * 3;
                const plan = { kind: "setup", title: `${press ? `Strike ${nameOf(t)}, then ` : ""}${p.name} on ${nameOf(t)}`, target: t, ev: value + (opener?.expected ?? 0), steps: [], notes: [], dest: null, ability: p };
                if (opener) plan.steps.push({ cost: 1, text: describeStrikes(opener.used, nameOf(t)) });
                plan.steps.push({ cost: p.cost, text: `${p.name} on ${nameOf(t)} (${p.inflicts.join(", ")}; works about ${pct(chance)} of the time${mapPen ? ", with the MAP" : ""})` });
                fillLast(board, plan, me.rect, ACT - p.cost - (opener ? 1 : 0), t, (opener ? 1 : 0) + (p.traits.includes("attack") ? 1 : 0));
                plans.push(plan);
            }
        }
    }

    // Follow-ups that need a hit first (Knockdown, Gnash...) and Strike variants (Sentry's Aim, Combat Grab...)
    for (const p of profiles) {
        // Improved Grab, Improved Knockdown and the like are free actions after the hit
        const free = p.kind === "free" && p.requires?.afterHit;
        if (!(p.kind === "action" && p.cost) && !free) continue;
        const cost = free ? 0 : p.cost;
        if ((cost ?? 0) > ACT || recharging(p) || !melee.length && !ranged.length) continue;
        const followUp = p.role === "payoff" && p.requires.afterHit;
        // Rend: after two hits in a row on the same foe
        const twoHits = followUp && /\btwo (?:consecutive |successive )?(?:[\w-]+ )?strikes?\b|\bconsecutive (?:[\w-]+ )?strikes?\b|\bboth (?:strikes )?hit\b/i.test(`${p.requires.text ?? ""} ${p.text}`);
        const variant = p.role === "strike-variant";
        if (!followUp && !variant) continue;
        // Press: only after an attack this turn, so a plain Strike goes first and the press Strike takes the MAP
        const press = variant && p.afterAttack && !TURN_MADE;
        // "+1 circumstance bonus to the attack roll", or "makes a ranged Strike with a +1 circumstance bonus"
        const bonus = Number(/\+(\d+) (?:circumstance|status|item) bonus(?! to (?:damage|ac|armor|saving|saves|skill|perception|reflex|fortitude|will))/i.exec(p.text)?.[1] ?? 0);
        const named = (s) => new RegExp(`\\b${s.label.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(p.text.toLowerCase());
        // Its last Strike this turn hit: the follow-up can go now, without another Strike first
        // ...as long as the Strike that hit lists it ("a Strike that lists Knockdown"), when the stat block says so
        const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        const listed = !/\blists?\b/i.test(p.requires?.text ?? "") || !turn?.lastHit?.riders || turn.lastHit.riders.some((r) => r === slug || r === `improved-${slug}`);
        if (followUp && !twoHits && turn?.lastHit && listed) {
            const t = targets.find((e) => e.id === turn.lastHit.target);
            if (t && melee.some((s) => inReach(me.rect, t.rect, s.reach)) && !((p.control.includes("trip") || p.control.includes("shove")) && (t.sizeRank ?? 2) > (me.sizeRank ?? 2) + 1)) {
                const check = p.control.includes("trip") ? { gives: "prone", vs: "reflex", label: "Trip" } : p.control.includes("grapple") ? { gives: "grabbed", vs: "fortitude", label: "Grapple" }
                    : p.control.includes("shove") ? { gives: null, vs: "fortitude", label: "Shove" } : null;
                const athletics = me.athletics ?? me.actor?.skills?.athletics?.mod ?? me.level + 5;
                const odds = check ? degreeChances(athletics, 10 + (t.saves[check.vs] ?? 0)) : null;
                const works = check?.gives ? odds.s + odds.cs : 1;
                const leaves = [...new Set([...p.inflicts, ...(check?.gives ? [check.gives] : [])])].filter((c) => OFF_GUARD_FROM.includes(c));
                const og = isOffGuard(t);
                const plan = { kind: "ability", title: `${p.name} on ${nameOf(t)} now`, target: t, ev: p.damage.reduce((sum, d) => sum + averageOf(d.formula), 0) + (leaves.length && !og ? 3 * works : 0) - (check && ["Trip", "Shove"].includes(check.label) ? odds.cf * 3 : 0), steps: [], notes: [], dest: null, ability: p };
                plan.steps.push({ cost, text: `${p.name} now, its last Strike hit ${nameOf(t)}${check ? ` (${check.label}: Athletics ${signed(athletics)} vs ${cap(check.vs)} DC ${10 + (t.saves[check.vs] ?? 0)}${check.gives ? `, ${check.gives} about ${pct(works)} of the time` : ""})` : ""}` });
                fillLast(board, plan, me.rect, ACT - cost, t, 0, leaves.length && !og ? 2 * works : 0);
                plans.push(plan);
            }
        }
        for (const t of targets) {
            let best = null;
            for (const sq of squares) {
                const extra = twoHits ? 2 : followUp || press ? 1 : 0;
                if (sq.route.actions + cost + extra > ACT) continue;
                const at = rectAt(sq);
                if (attackCtx(at, t).noLine) continue;
                const meleeOnly = /\bmelee\b/i.test(p.text) || p.control.includes("grapple") || p.inflicts.includes("grabbed");
                const rangedOnly = !meleeOnly && /\branged (?:strike|attack)\b/i.test(p.text);
                const pool = [...(rangedOnly ? [] : melee.filter((s) => inReach(at, t.rect, s.reach))), ...(meleeOnly ? [] : ranged.filter((s) => feetBetween(at, t.rect) <= s.range))];
                const usable = pool.filter((s) => named(s)).length ? pool.filter((s) => named(s)) : pool;
                if (!usable.length) continue;
                const score = -sq.route.actions * 2 - sq.route.provokes.length * 3 + (flankingAlly(board, at, t) ? 1 : 0);
                if (!best || score > best.score) best = { sq, at, usable, score };
            }
            if (!best) continue;
            // Flanking makes a foe off-guard to melee attacks only: a variant that fires a ranged Strike gets no -2
            const flanked = !!flankingAlly(board, best.at, t) && best.usable.some((s) => !s.ranged);
            const og = isOffGuard(t) || flanked;
            const ac = acAgainst(t, flanked);
            const plan = { kind: "ability", title: followUp ? `Strike ${nameOf(t)}, then ${p.name}` : `${p.name} on ${nameOf(t)}`, target: t, ev: 0, steps: [], notes: [], dest: best.sq.route.actions ? { x: best.sq.x, y: best.sq.y, z: best.sq.z } : null, ability: p };
            if (best.sq.route.actions) plan.steps.push({ cost: best.sq.route.actions, text: approachText(best.sq.route, t, !!best.usable && !best.usable.some((x) => !x.ranged)) });
            // A press action's opener: any Strike that reaches, at no MAP
            const opener = press ? strikeRun([...melee.filter((s) => inReach(best.at, t.rect, s.reach)), ...ranged.filter((s) => feetBetween(best.at, t.rect) <= s.range)], 1, ac, { vs: t, at: best.at, offGuard: og }) : null;
            if (opener) {
                plan.title = `Strike ${nameOf(t)}, then ${p.name}`;
                plan.steps.push({ cost: 1, text: describeStrikes(opener.used, nameOf(t)) });
            }
            const volleyPen = (s) => (s.ranged && s.volley && feetBetween(best.at, t.rect) <= s.volley ? 2 : 0);
            const first = strikeRun(best.usable.map((s) => ({ ...s, bonus: s.bonus + (variant ? bonus : 0) - volleyPen(s) })), 1, ac, { vs: t, at: best.at, offGuard: og, made: opener ? 1 : 0 });
            plan.ev = first.expected + (opener?.expected ?? 0);
            if (twoHits) {
                // Strike, Strike, then the payoff if both hit
                const two = strikeRun(best.usable, 2, ac, { vs: t, at: best.at, offGuard: og });
                const both = (two.used[0]?.e.hit ?? 0) * (two.used[1]?.e.hit ?? 0);
                const again = p.damage.reduce((sum, d) => sum + averageOf(d.formula), 0) || (two.used[0]?.s.avg ?? 0);
                plan.title = `Strike ${nameOf(t)} twice, then ${p.name}`;
                plan.ev = two.expected + both * again;
                plan.steps.push({ cost: 2, text: describeStrikes(two.used, nameOf(t)) }, { cost: cost, text: `If both hit: ${p.name} (about ${pct(both)})` });
            } else if (followUp) {
                plan.steps.push({ cost: 1, text: describeStrikes(first.used, nameOf(t)) });
                // Knockdown and Improved Grab are a Trip or a Grapple: an Athletics check against the target's DC
                const check = p.control.includes("trip") ? { gives: "prone", vs: "reflex", label: "Trip" } : p.control.includes("grapple") ? { gives: "grabbed", vs: "fortitude", label: "Grapple" }
                    : p.control.includes("shove") ? { gives: null, vs: "fortitude", label: "Shove" } : p.control.includes("reposition") ? { gives: null, vs: "fortitude", label: "Reposition" } : null;
                if (check && (t.sizeRank ?? 2) > (me.sizeRank ?? 2) + 1) continue; // maneuvers: at most one size larger
                const athletics = me.athletics ?? me.actor?.skills?.athletics?.mod ?? me.level + 5;
                const checkOdds = check ? degreeChances(athletics, 10 + (t.saves[check.vs] ?? 0)) : null;
                const works = check && check.gives && !p.inflicts.includes(check.gives) ? checkOdds.s + checkOdds.cs : 1;
                // Trip or Shove critically failed: it falls prone itself
                if (check && ["Trip", "Shove"].includes(check.label)) plan.ev -= first.firstHit * checkOdds.cf * 3;
                const leaves = [...new Set([...p.inflicts, ...(check ? [check.gives] : [])])].filter((c) => OFF_GUARD_FROM.includes(c));
                const payDmg = p.damage.reduce((sum, d) => sum + averageOf(d.formula), 0);
                plan.ev += first.firstHit * (payDmg + (leaves.length ? 3 * works : 0));
                const how = check ? ` (${check.label}: Athletics ${signed(athletics)} vs ${cap(check.vs)} DC ${10 + (t.saves[check.vs] ?? 0)}${check.gives ? `, ${check.gives} about ${pct(works)} of the time` : ""}${free ? "; free action" : ""})` : p.inflicts.length ? ` (${p.inflicts.join(", ")})` : "";
                plan.steps.push({ cost: cost, text: `If it hits: ${p.name}${how}` });
                const left = ACT - best.sq.route.actions - 1 - cost;
                if (left > 0) {
                    const chance = leaves.length && !og ? first.firstHit * works : 0;
                    const plain = strikeRun(best.usable, left, ac, { vs: t, at: best.at, made: 1, offGuard: og });
                    const off = chance ? strikeRun(best.usable, left, ac - 2, { vs: t, at: best.at, made: 1, offGuard: true }) : plain;
                    plan.ev += (1 - chance) * plain.expected + chance * off.expected;
                    plan.steps.push({ cost: left, text: describeStrikes(plain.used, nameOf(t)) + (leaves.length && !og ? ` (off-guard if ${p.name} worked)` : "") });
                }
            } else {
                const leaves = p.inflicts.filter((c) => OFF_GUARD_FROM.includes(c));
                plan.steps.push({ cost: cost, text: `${p.name}: ${describeStrikes(first.used, nameOf(t))}${bonus ? ` (+${bonus} from ${p.name})` : ""}${leaves.length && !og ? ` (on a hit: ${leaves.join(", ")}, so off-guard)` : ""}` });
                if (leaves.length && !og) plan.ev += first.firstHit * 0.5;
                if (/\bcover\b|\bconcealed\b/i.test(p.text)) plan.notes.push(`${p.name} gets past cover or concealment: the pick if ${nameOf(t)} has either`);
                if (press) plan.notes.push(`${p.name} needs an attack before it this turn`);
                // Grabbing with the free hand ties it up: no fist Strikes after
                const handBusy = /\bfree hand\b|\bhand free\b/i.test(p.text) && /\bgrab/i.test(p.text);
                fillLast(board, plan, best.at, ACT - best.sq.route.actions - cost - (opener ? 1 : 0), t, opener ? 2 : 1, leaves.length && !og ? 2 * first.firstHit : 0,
                    handBusy ? (s) => s.traits?.includes("unarmed") : null);
            }
            if (og) plan.notes.push(`${nameOf(t)} is off-guard: AC ${ac}`);
            sightNotes(plan, best.at, t, { ranged: best.usable.some((s) => s.ranged) });
            plan.risk = provokeCost(board, best.sq.route.provokes);
            plans.push(plan);
        }
    }

    // Self-buffs that pay off in Strikes: Rage, Fanatical Frenzy, Inspired Fury...
    for (const p of profiles) {
        if (p.kind !== "action" || p.role !== "buff" || p.allies || !p.cost || p.cost > 2 || recharging(p) || !melee.length) continue;
        const atk = Number(/\+(\d+) (?:circumstance|status|item) bonus to (?:its |their )?attack rolls/i.exec(p.text)?.[1] ?? 0);
        const dmg = Number(/\+(\d+) (?:circumstance|status|item) bonus to (?:its |their )?(?:melee |strike )?damage/i.exec(p.text)?.[1] ?? 0);
        if (!atk && !dmg) continue;
        if (/has taken damage/i.test(p.requires?.text ?? "") && me.hp >= me.maxHp) continue;
        if (me.actor?.items?.some((i) => i.type === "effect" && i.name.toLowerCase().includes(p.name.toLowerCase()))) continue;
        const lasting = /\b(?:1 minute|until the end of the encounter|for the rest of the encounter|10 minutes)\b/i.test(p.text);
        for (const t of targets) {
            let best = null;
            for (const sq of squares) {
                if (sq.route.actions + p.cost + 1 > ACT) continue;
                const at = rectAt(sq);
                const strikes = melee.filter((s) => inReach(at, t.rect, s.reach));
                if (!strikes.length) continue;
                const score = -sq.route.actions * 2 - sq.route.provokes.length * 3 + (flankingAlly(board, at, t) ? 1 : 0);
                if (!best || score > best.score) best = { sq, at, strikes, score };
            }
            if (!best) continue;
            const flanked = !!flankingAlly(board, best.at, t);
            const og = isOffGuard(t) || flanked;
            const ac = acAgainst(t, flanked);
            const n = ACT - best.sq.route.actions - p.cost;
            const run = strikeRun(best.strikes.map((s) => ({ ...s, bonus: s.bonus + atk, avg: s.avg + dmg })), n, ac, { vs: t, at: best.at, offGuard: og });
            const plan = { kind: "ability", title: `${p.name}, then Strike ${nameOf(t)}`, target: t, ev: run.expected + (lasting ? atk * 0.5 + dmg * 0.6 : 0), steps: [], notes: [], dest: best.sq.route.actions ? { x: best.sq.x, y: best.sq.y, z: best.sq.z } : null, ability: p };
            if (best.sq.route.actions) plan.steps.push({ cost: best.sq.route.actions, text: approachText(best.sq.route, t, !!best.usable && !best.usable.some((x) => !x.ranged)) });
            plan.steps.push({ cost: p.cost, text: `${p.name}${atk ? ` (+${atk} to hit` : " ("}${dmg ? `${atk ? ", " : ""}+${dmg} damage` : ""}${lasting ? "; lasts the fight" : ""})` });
            plan.steps.push({ cost: n, text: describeStrikes(run.used, nameOf(t)) });
            const acPen = /(\d+) penalty to AC/i.exec(p.text)?.[1];
            if (acPen) plan.notes.push(`Costs ${acPen} AC while it lasts`);
            if (lasting) plan.notes.push("Only once: it keeps paying on later turns");
            plan.risk = provokeCost(board, best.sq.route.provokes) + (acPen ? Number(acPen) * 0.4 : 0);
            plans.push(plan);
        }
    }

    // Spells that hinder rather than hurt: fear, shroud of night, slow...
    // CONDITION_VALUE: what each condition is worth to the fight (module scope, the threat table uses it too)
    for (const sp of spells) {
        if (!sp.cost || sp.cost > ACT || sp.area || sp.heals || sp.avg || !sp.save || !sp.inflicts?.length) continue;
        // On the hit scale (as the threat table and Sustain value them): 5 points is one of its hits, so slowed or
        // stunned is a hit's worth, frightened 2 about a hit, paralyzed two. Flat points couldn't keep up with damage.
        const hitScale = hitWorth(me.level) / 5;
        const worth = sp.inflicts.reduce((sum, c) => sum + (CONDITION_VALUE[c] ?? 1), 0) * hitScale;
        for (const t of targets) {
            if (sp.inflicts.every((c) => t.conditions.has(c))) continue;
            let best = null;
            for (const sq of squares) {
                if (sq.route.actions + sp.cost > ACT) continue;
                const at = rectAt(sq);
                if (feetBetween(at, t.rect) > (sp.range ?? 30)) continue;
                const seen = attackCtx(at, t);
                if (seen.noLine) continue;
                const exp = castProvokers(board, at, sp.traits);
                const score = -exp.length * 3 - sq.route.actions - sq.route.provokes.length * 3 + (seen.flat - 1) * 6;
                if (!best || score > best.score) best = { sq, at, exp, score, seen };
            }
            if (!best) continue;
            const incap = sp.incapacitation && (t.level ?? 0) > 2 * (sp.rank ?? 1) ? 1 : 0;
            const fail = saveExpected(t.saves[sp.save.stat] ?? 0, sp.dc ?? 15, 1, { basic: false, shift: incap }).fail;
            let value = fail * worth;
            if (sp.byDegree) {
                // The target rolls: its success, failure and critical failure each leave something different
                const c = degreeChances(t.saves[sp.save.stat] ?? 0, sp.dc ?? 15, incap);
                const v = (list) => (list ?? []).reduce((sum, k) => sum + (CONDITION_VALUE[k] ?? 1) * valueScale(k, list), 0) * hitScale;
                value = c.s * v(sp.byDegree.success) + c.f * v(sp.byDegree.failure) + c.cf * v(sp.byDegree.criticalFailure ?? sp.byDegree.failure);
            }
            value *= best.seen.flat * (sp.odds ?? 1);
            const plan = { kind: "spell", title: `Cast ${sp.name} on ${nameOf(t)}`, target: t, ev: value + 0.5, steps: [], notes: [], dest: best.sq.route.actions ? { x: best.sq.x, y: best.sq.y, z: best.sq.z } : null, spell: sp };
            if (incap) plan.notes.push(`Incapacitation: ${nameOf(t)} is above level ${2 * sp.rank}, so one degree better for it`);
            sightNotes(plan, best.at, t, { attack: false });
            if (best.sq.route.actions) plan.steps.push({ cost: best.sq.route.actions, text: `${routeText(best.sq.route)}${best.sq.route.doors || best.sq.route.tail || best.sq.route.vText ? "," : ""} into range of ${nameOf(t)}` });
            plan.steps.push({ cost: sp.cost, text: `Cast ${sp.name} at ${nameOf(t)}: ${cap(sp.save.stat)} DC ${sp.dc} (${sp.inflicts.join(", ")}; lands about ${pct(fail)} of the time)` });
            fillLast(board, plan, best.at, ACT - best.sq.route.actions - sp.cost, t, 0);
            if (best.exp.length) plan.notes.push(`Casting in reach of ${best.exp.map(nameOf).join(", ")} provokes`);
            plan.risk = provokeCost(board, [...best.sq.route.provokes, ...best.exp.map((x) => x.id)]);
            plans.push(plan);
        }
    }

    // Area spells
    for (const sp of spells) {
        if (!sp.area || !sp.cost || sp.cost > ACT || !sp.avg || !sp.save) continue;
        const plan = bestArea(board, squares, rectAt, { name: `Cast ${sp.name}${sp.cantrip ? "" : ` (rank ${sp.rank})`}`, cost: sp.cost, area: sp.area, range: sp.range ?? 0, save: sp.save, dc: sp.dc ?? 15, avg: sp.avg, inflicts: [], traits: sp.traits, endCost: myTier >= 1 || HIT_RUN ? endPenalty : null,
            damageTypes: sp.damageTypes ?? [], incapacitation: sp.incapacitation ? { rank: sp.rank } : null, odds: sp.odds ?? 1 });
        if (plan) { plan.spell = sp; plans.push(plan); }
    }

    // Spells that help its side fight (Bless, Courageous Anthem): worth it with enough allies about to attack
    for (const sp of spells) {
        const bf = sp.buff;
        if (!bf || !sp.cost || sp.cost > ACT || intent?.run) continue;
        const inEffect = (c) => c.actor?.items?.some?.((i) => i.type === "effect" && i.name.toLowerCase().includes(sp.name.toLowerCase()));
        if (inEffect(me) || (board.allies ?? []).some(inEffect)) continue;
        const helped = (board.allies ?? []).filter((a) => a.hp > 0 && a.canAct !== false && feetBetween(me.rect, a.rect) <= bf.size);
        const who = [...helped.map((a) => a.level ?? me.level), ...(bf.self ? [me.level] : [])];
        if (who.length < 2) continue;
        // +1 to hit is about a tenth of a hit more per Strike, +1 damage about 0.6 per Strike; two Strikes a turn each
        const perRound = who.reduce((sum, lvl) => sum + bf.attack * 0.1 * hitWorth(lvl) * 2 + bf.damage * 0.6 * 2, 0);
        const value = perRound * bf.rounds * 0.8;
        const plan = { kind: "buff", title: `Cast ${sp.name}`, target: null, ev: value, steps: [], notes: [], dest: null, spell: sp };
        plan.steps.push({ cost: sp.cost, text: `Cast ${sp.name}: +${bf.attack} to attacks${bf.damage ? ` and +${bf.damage} damage` : ""} for ${who.length} ${bf.self ? "(it and its allies)" : "allies"} within ${bf.size} feet${bf.rounds === 1 ? ", this round" : ""}` });
        const near = [...targets].sort((x, y) => feetBetween(me.rect, x.rect) - feetBetween(me.rect, y.rect))[0] ?? null;
        fillLast(board, plan, me.rect, ACT - sp.cost, near, 0);
        plan.notes.push(`Cast before its allies act, so they get it this round`);
        plans.push(plan);
    }

    // Bringing a fallen ally back into the fight: worth far more than the HP, because a body on its feet fights again.
    // A thinking creature knows it (animals don't heal); it weighs what the ally does in a round, for a couple of rounds.
    const reviveTier = tierOf(me);
    for (const c of reviveTier >= 1 ? (board.downAllies ?? []).filter((d) => (d.hp <= 0 || d.conditions?.has?.("dying")) && (!d.rect.lvl || !me.rect.lvl || d.rect.lvl === me.rect.lvl)) : []) {
        const undead = (c.traits ?? []).includes("undead");
        const back = REVIVE_WEIGHT[reviveTier] * 1.1 * hitWorth(c.level ?? me.level) * 2;
        for (const sp of spells.filter((x) => x.heals && x.cost)) {
            if ((sp.vitality && undead) || (sp.void && !undead)) continue;
            const forms = [{ cost: sp.cost, avg: sp.avg || 8, range: sp.range ?? 0 }, ...(sp.twoAction ? [{ cost: 2, avg: sp.twoAction.avg, range: sp.twoAction.range }] : [])];
            let best = null;
            for (const f of forms) {
                for (const sq of squares) {
                    if (sp.potion && !inReach(rectAt(sq), c.rect, 5)) continue;
                    if (sq.route.actions + f.cost > ACT || feetBetween(rectAt(sq), c.rect) > Math.max(5, f.range)) continue;
                    if (board.lineBlocked?.(centerOf(rectAt(sq)), centerOf(c.rect))) continue;
                    const ev = Math.min(f.avg, c.maxHp) * 0.8 + back;
                    const score = ev - (sq.route.actions + f.cost) * 0.5 - sq.route.provokes.length * 3;
                    if (!best || score > best.score) best = { ...f, sq, ev, score };
                }
            }
            if (!best) continue;
            const plan = { kind: "heal", title: `Revive ${nameOf(c)} (${sp.potion ? "potion" : sp.name})`, target: null, ev: best.ev, notes: [], dest: best.sq.route.actions ? { x: best.sq.x, y: best.sq.y, z: best.sq.z } : null, spell: sp, steps: [], revive: true };
            if (best.sq.route.actions) plan.steps.push({ cost: best.sq.route.actions, text: `${routeText(best.sq.route)}${best.sq.route.tail || best.sq.route.vText ? "," : ""} to ${nameOf(c)}` });
            plan.steps.push({ cost: best.cost, text: `${healUse(sp, nameOf(c), best.cost)} (about ${Math.round(best.avg)} HP; back up, it fights again)` });
            plan.notes.push(`${nameOf(c)} is down: brought back, it stands and fights next turn`);
            if (best.sq.route.provokes.length) plan.notes.push(`Provokes ${provokeNames(board, best.sq.route.provokes).join(", ")}`);
            plan.risk = provokeCost(board, best.sq.route.provokes);
            plans.push(plan);
        }
    }

    // Healing: itself when badly hurt, or an ally that is (Heal at two actions reaches 30 feet and adds 8 a rank)
    const healable = [{ c: me, self: true }, ...(board.allies ?? []).filter((a) => a.hp > 0 && a.canAct !== false).map((a) => ({ c: a, self: false }))]
        .filter(({ c }) => c.hp / Math.max(1, c.maxHp) < 0.5);
    for (const { c, self } of healable) {
        const missing = c.maxHp - c.hp;
        const undead = (c.traits ?? me.traits ?? []).includes("undead");
        for (const sp of spells.filter((x) => x.heals && x.cost)) {
            if ((sp.vitality && undead) || (sp.void && !undead)) continue; // vitality hurts undead; void heals only them
            const forms = [{ cost: sp.cost, avg: sp.avg || 8, range: self ? 0 : (sp.range ?? 0) }, ...(sp.twoAction ? [{ cost: 2, avg: sp.twoAction.avg, range: sp.twoAction.range }] : [])];
            let best = null;
            for (const f of forms) {
                if (f.cost > ACT) continue;
                const d = self ? 0 : feetBetween(me.rect, c.rect);
                if (!self && (sp.potion ? !inReach(me.rect, c.rect, 5) : d > Math.max(5, f.range))) continue;
                const ev = Math.min(f.avg, missing) * 0.8 * (self ? 1 : 0.9);
                if (!best || ev - f.cost * 0.5 > best.ev - best.cost * 0.5) best = { ...f, ev };
            }
            if (!best) continue;
            const plan = { kind: "heal", title: sp.potion ? (self ? `Drink ${sp.name}` : `Heal ${nameOf(c)} (potion)`) : self ? `Heal Itself (${sp.name})` : `Heal ${nameOf(c)} (${sp.name})`, target: null, ev: best.ev, notes: [], dest: null, spell: sp,
                steps: [{ cost: best.cost, text: `${healUse(sp, self ? "itself" : nameOf(c), best.cost)} (about ${Math.round(Math.min(best.avg, missing))} HP)` }] };
            if (sp.potion || sp.consumable === "scroll") plan.notes.push(`Uses up ${sp.potion ? "the potion" : "the scroll"}`);
            if (!self) plan.notes.push(`${nameOf(c)} is down to ${c.hp} of ${c.maxHp} HP`);
            plans.push(plan);
        }
        if (self) {
            for (const p of profiles.filter((x) => x.kind === "action" && x.heals && x.cost && !recharging(x))) {
                const avg = p.damage.reduce((t, d) => t + averageOf(d.formula), 0) || 8;
                plans.push({ kind: "heal", title: p.name, target: null, ev: Math.min(avg, missing) * 0.8, steps: [{ cost: p.cost, text: p.name }], notes: [], dest: null, ability: p });
            }
        }
    }

    // Shove a foe into hazardous terrain or off a ledge: Strikes first, the Shove last (it's an attack, so it takes the MAP)
    if (myTier >= 1 && board.pushInto && melee.length && board.square && me.freeHand !== false) {
        const ath = me.athletics ?? me.level + 5;
        // Shove reaches as far as its body does (its unarmed attacks), not a polearm's reach
        const bodyReach = Math.max(5, ...melee.filter((st) => st.traits?.includes("unarmed")).map((st) => st.reach ?? 5));
        for (const t of targets) {
            if ((t.sizeRank ?? 2) > (me.sizeRank ?? 2) + 1 || t.hp <= 0) continue;
            let best = null;
            for (const sq of squares) {
                if (sq.route.actions + 1 > ACT) continue;
                const at = rectAt(sq);
                const strikes = melee.filter((st) => inReach(at, t.rect, st.reach));
                if (!strikes.length || !inReach(at, t.rect, bodyReach) || attackCtx(at, t, { ranged: false }).noLine) continue;
                const dx = Math.sign((t.rect.x + t.rect.w / 2) - (at.x + at.w / 2)), dy = Math.sign((t.rect.y + t.rect.h / 2) - (at.y + at.h / 2));
                if (!dx && !dy) continue;
                const push = board.pushInto(t, dx, dy);
                if (!push) continue;
                const score = -sq.route.actions * 2 - sq.route.provokes.length * 3;
                if (!best || score > best.score) best = { sq, at, strikes, push, score };
            }
            if (!best) continue;
            const og = isOffGuard(t);
            const dc = 10 + (t.saves.fortitude ?? 0);
            const worth = (x) => (x ? x.dmg + (x.prone ? 3 : 0) + (x.fall ? 2 : 0) : 0);
            // How many Strikes before it: each adds damage but makes the Shove less likely (the MAP)
            let pick = null;
            for (let k = 0; k <= ACT - best.sq.route.actions - 1; k++) {
                const run = k > 0 ? strikeRun(best.strikes, k, t.ac, { vs: t, at: best.at, offGuard: og }) : { expected: 0, used: [] };
                const mod = ath + mapFor(TURN_MADE + run.used.length, false);
                const c = degreeChances(mod, dc);
                const value = c.s * worth(best.push.s) + c.cs * Math.max(worth(best.push.s), worth(best.push.cs)) - c.cf * 3;
                if (value > 0.5 && (!pick || run.expected + value > pick.run.expected + pick.value)) pick = { k, run, mod, c, value };
            }
            if (!pick) continue;
            const { run, mod, c, value } = pick;
            const left = run.used.length;
            const main = best.push.s ?? best.push.cs;
            const odds = best.push.s ? c.s + c.cs : c.cs;
            const plan = { kind: "ability", title: `Shove ${nameOf(t)} ${main.fall ? "off the edge" : "into the hazard"}`, target: t, ev: run.expected + value, steps: [], notes: [], dest: best.sq.route.actions ? { x: best.sq.x, y: best.sq.y, z: best.sq.z } : null, shove: true };
            if (best.sq.route.actions) plan.steps.push({ cost: best.sq.route.actions, text: approachText(best.sq.route, t) });
            if (run.used.length) plan.steps.push({ cost: left, text: describeStrikes(run.used, nameOf(t)) });
            plan.steps.push({ cost: 1, text: `Shove ${nameOf(t)} (Athletics ${signed(mod)} vs Fortitude DC ${dc}${run.used.length || TURN_MADE ? ", with the MAP" : ""}): ${main.why}, about ${pct(odds)} of the time${best.push.s ? "" : " (a critical success)"}` });
            const spare = ACT - best.sq.route.actions - left - 1;
            if (spare > 0) plan.steps.push({ cost: spare, text: `${spare > 1 ? "Its last actions" : "Its last action"}: ${board.me.shield && !board.me.shieldRaised ? "Raise a Shield" : "Take Cover"}, or Stride after them` });
            if (best.push.cs && best.push.s && best.push.cs.why !== best.push.s.why && worth(best.push.cs) > worth(best.push.s)) plan.notes.push(`On a critical success, 10 feet: ${best.push.cs.why}`);
            plan.notes.push("A critical failure on the Shove leaves it prone");
            sightNotes(plan, best.at, t, { ranged: false });
            if (best.sq.route.provokes.length) plan.notes.push(`Provokes ${provokeNames(board, best.sq.route.provokes).join(", ")}`);
            plan.risk = provokeCost(board, best.sq.route.provokes);
            plans.push(plan);
        }
    }

    // Foes on another floor: up or down the stairs (or a ladder) to them
    if (board.elsewhere?.length && board.stairs?.length && board.square && !intent?.run && board.move.stride.feet > 0 && board.move.stride.speed !== "fly"
        && !["immobilized", "grabbed", "restrained"].some((x) => mc.has(x))) {
        const stride = board.move.stride.feet;
        const sp = board.move.speeds ?? {};
        const per = sp.climb > 0 ? sp.climb : 5 + ((sp.land ?? 25) >= 40 ? 5 * Math.floor(((sp.land ?? 25) - 20) / 20) : 0);
        const reach = Math.max(5, ...melee.map((x) => x.reach));
        const prone = mc.has("prone") ? 1 : 0;
        for (const t of board.elsewhere.filter((e) => e.hp > 0)) {
            let best = null;
            for (const st of board.stairs) {
                if (!st.to.includes(t.rect.lvl)) continue;
                const dz = Math.abs((st.z[t.rect.lvl] ?? t.rect.z ?? 0) - (me.rect.z ?? 0));
                const climb = st.ladder ? Math.ceil(dz / per) : 0;
                for (const c of st.cells) {
                    const there = { x: c.x, y: c.y, w: me.rect.w, h: me.rect.h, z: t.rect.z ?? 0, ht: me.rect.ht };
                    const on = Math.ceil(Math.max(0, feetBetween(there, { ...t.rect, lvl: null }) - (melee.length ? reach : 0)) / 5) * 5;
                    const feet = c.feet + (st.ladder ? 0 : dz) + on;
                    const actions = (st.ladder ? Math.ceil(c.feet / stride) + (on > 0 ? Math.ceil(on / stride) : 0) : Math.ceil(feet / stride)) + climb + prone;
                    const toStair = Math.ceil(c.feet / stride) + prone;
                    const sc = actions * 10 + c.provokes.length * 15;
                    if (!best || sc < best.sc) best = { st, c, dz, climb, actions, toStair, on, sc, up: (st.z[t.rect.lvl] ?? 0) > (me.rect.z ?? 0) };
                }
            }
            if (!best) continue;
            const { st, c } = best;
            const floor = /^the\b/i.test(st.names[t.rect.lvl] ?? "") ? st.names[t.rect.lvl] : `the ${st.names[t.rect.lvl] ?? "other floor"}`;
            const place = !st.name ? (st.ladder ? "the ladder" : "the stairs") : /^the\b/i.test(st.name) ? st.name : `the ${st.name}`;
            const how = `${prone ? "Stand, then " : ""}${board.move.stride.by ?? "Stride"} to ${place}${st.ladder ? `, Climb ${best.up ? "up" : "down"} ${best.dz} ft` : `, ${best.up ? "up" : "down"} to ${floor}`}`;
            const vs = { ...t, rect: null };
            if (melee.length && best.actions < ACT) {
                const n = ACT - best.actions;
                const run = strikeRun(melee, n, t.ac, { vs, offGuard: isOffGuard(t) });
                if (run.used.length) {
                    const plan = { kind: "melee", title: `${best.up ? "Up" : "Down"} the ${st.ladder ? "Ladder" : "Stairs"} to ${nameOf(t)}`, target: t, ev: run.expected, notes: [], dest: { x: c.x, y: c.y }, viaStairs: true,
                        steps: [{ cost: best.actions, text: `${how}, and on into reach of ${nameOf(t)}` }, { cost: n, text: describeStrikes(run.used, nameOf(t)) }] };
                    plan.notes.push(`${nameOf(t)} is on ${floor}: the path shown goes as far as the ${st.ladder ? "ladder" : "stairs"}`);
                    if (c.provokes.length) plan.notes.push(`Provokes ${provokeNames(board, c.provokes).join(", ")}`);
                    plan.risk = provokeCost(board, c.provokes);
                    plans.push(plan);
                    continue;
                }
            }
            if (plans.some((p) => p.target && p.ev > 0 && !p.viaStairs)) continue;
            const go = Math.min(ACT, best.toStair + best.climb);
            const there = best.toStair + best.climb <= ACT;
            const plan = { kind: "advance", title: `Make for ${nameOf(t)} on ${floor}`, target: null, ev: 0.3, score: 0.3 - provokeCost(board, c.provokes), notes: [], dest: { x: c.x, y: c.y }, viaStairs: true,
                steps: [{ cost: go, text: there ? how : `${prone ? "Stand, then " : ""}${board.move.stride.by ?? "Stride"} toward ${place}` }] };
            if (there && ACT - go > 0) plan.steps.push({ cost: ACT - go, text: `${board.move.stride.by ?? "Stride"} on toward ${nameOf(t)}` });
            if (c.provokes.length) plan.notes.push(`Provokes ${provokeNames(board, c.provokes).join(", ")}`);
            plan.why = ["on another floor"];
            plans.push(plan);
        }
    }

    // Nothing it can hit this turn: close on the best target, as safely as it can
    if (board.square && targets.length && !intent?.run && !plans.some((p) => p.target && p.ev > 0)) {
        const pick = [...targets].sort((x, y) => (feetBetween(me.rect, x.rect) - threatShare(board, x) * 15 - (x.objective ? 10 : 0))
            - (feetBetween(me.rect, y.rect) - threatShare(board, y) * 15 - (y.objective ? 10 : 0)))[0];
        let best = null;
        for (const sq of squares) {
            if (!sq.route.actions) continue;
            const at = rectAt(sq);
            const d = feetBetween(at, pick.rect);
            const sc = d + sq.route.provokes.length * 15 + sq.route.actions * 0.5;
            if (!best || sc < best.sc) best = { sq, d, sc };
        }
        if (best) {
            const r = best.sq.route;
            const plan = { kind: "advance", title: `Advance on ${nameOf(pick)}`, target: null, ev: 0.3, score: 0.3 - provokeCost(board, r.provokes), notes: [], dest: { x: best.sq.x, y: best.sq.y, z: best.sq.z },
                steps: [{ cost: r.actions, text: `${routeText(r)}${r.doors || r.tail || r.vText ? "," : ""} toward ${nameOf(pick)}, ending ${best.d} feet away` }] };
            if (r.actions < ACT) fillLast(board, plan, rectAt(best.sq), ACT - r.actions, pick, 0);
            if (r.provokes.length) plan.notes.push(`Provokes ${provokeNames(board, r.provokes).join(", ")}`);
            plan.why = [pick.objective ? "what it's after" : threatShare(board, pick) >= 1 ? "top threat" : "closest"];
            plans.push(plan);
        }
    }

    // A buff or a heal that leaves actions over, with nothing to Strike from where it stands: spend them on the best
    // attack that fits in what's left (a Step and two shots after Courageous Anthem, say)
    const FOLLOW_KINDS = new Set(["melee", "ranged", "spell", "ability", "area", "demoralize", "feint"]);
    const costOf = (p) => p.steps.reduce((n, st) => n + (st.cost ?? 0), 0);
    // The follow-up is planned again with only the actions left (every attack plan spends all it has)
    const followFor = new Map();
    const followWith = (left) => {
        if (!followFor.has(left)) {
            const saved = { ACT, TURN_MADE, BOARD, CTX, SNEAK, HIT_RUN, EXTRA_VS };
            let sub = [];
            try {
                const turn = { ...(board.turn ?? {}), spent: (board.turn?.spent ?? 0) + (ACT - left) };
                sub = planTurn({ ...board, turn }, { intent, noFollow: true });
            } catch (err) { console.warn(`${MODULE_ID} | couldn't plan the rest of the turn`, err); }
            ({ ACT, TURN_MADE, BOARD, CTX, SNEAK, HIT_RUN, EXTRA_VS } = saved);
            followFor.set(left, sub.filter((p) => FOLLOW_KINDS.has(p.kind) && p.ev > 0 && costOf(p) <= left).sort((a, b) => b.ev - a.ev)[0] ?? null);
        }
        return followFor.get(left);
    };
    for (const plan of noFollow ? [] : plans) {
        if ((plan.kind !== "buff" && plan.kind !== "heal") || plan.dest) continue;
        const left = ACT - costOf(plan);
        if (left <= 0) continue;
        const follow = followWith(left);
        if (!follow) continue;
        plan.ownEv = plan.ev;
        plan.steps.push(...follow.steps.map((st) => ({ ...st })));
        plan.ev += follow.ev;
        plan.dest = follow.dest ?? null;
        plan.aim = follow.aim ?? null;
        plan.risk = (plan.risk ?? 0) + (follow.risk ?? 0);
        if (follow.flyAway) { plan.flyAway = true; plan.leaveRisk = (plan.leaveRisk ?? 0) + (follow.leaveRisk ?? 0); }
        for (const n of follow.notes) if (!plan.notes.includes(n)) plan.notes.push(n);
    }

    // Airborne: a creature that doesn't Fly on its turn falls at the end of it, so staying up costs an action
    if (me.airborne && !noFollow) {
        const drop = Math.max(0, (me.rect.z ?? 0) - (board.floorZ ?? 0));
        for (const plan of plans) {
            if (plan.kind === "none" || !costOf(plan) || plan.ability?.moves?.length || plan.steps.some((st) => /\bFly\b|\bClimb\b/.test(st.text ?? ""))) continue;
            if (costOf(plan) < ACT) plan.steps.push({ cost: 1, text: "Fly in place, to stay up" });
            else {
                plan.notes.push(`It doesn't Fly this turn, so it falls ${drop} feet at the end of it (${Math.floor(drop / 2)} damage, prone)`);
                plan.risk = (plan.risk ?? 0) + drop / 2 + 2;
            }
        }
    }

    // Dropping off a ledge hurts: its own drop ("drop down 10 ft (5 bludgeoning, lands prone)"), not a foe it
    // Shoves off one ("a 10-foot drop (5 bludgeoning ...)")
    for (const plan of plans) {
        const f = plan.steps.map((st) => /\bdrop down \d+ ft \((\d+) bludgeoning, lands prone\)/.exec(st.text ?? "")?.[1]).find(Boolean);
        if (f) plan.risk = (plan.risk ?? 0) + Number(f);
    }

    // A spell it can Sustain: one action on it, then the best of what's left; anything else lets the spell end
    if (board.sustain && !noSustain && !noFollow && ACT >= 1 && !mc.has("fascinated")) {
        const su = board.sustain;
        let rest = null;
        if (ACT > 1) {
            const saved = { ACT, TURN_MADE, BOARD, CTX, SNEAK, HIT_RUN, EXTRA_VS };
            try {
                const sub = planTurn({ ...board, turn: { ...(board.turn ?? {}), spent: (board.turn?.spent ?? 0) + 1 } }, { intent, noSustain: true });
                // Not the same spell cast again (that would end the one it sustains)
                rest = sub.filter((p) => !["none", "hold", "run"].includes(p.kind) && p.ev > 0 && p.spell?.name !== su.name).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0] ?? null;
            } catch (err) { console.warn(`${MODULE_ID} | couldn't plan around the Sustain`, err); }
            ({ ACT, TURN_MADE, BOARD, CTX, SNEAK, HIT_RUN, EXTRA_VS } = saved);
        }
        const step = { cost: 1, text: `Sustain ${su.name} (if it's still up)` };
        // The sub-plan's own notes on its conditions and the way are added again below, for this plan as for every other
        const own = /^(?:Prone|Grabbed|Slowed \d|Stunned \d|Quickened|Stupefied \d|Fascinated|Blinded):|^The way crosses|^Opens a door on the way/;
        const plan = rest ? { ...rest, title: `Sustain ${su.name}, then ${rest.title}`, steps: [step, ...rest.steps.map((st) => ({ ...st }))], notes: rest.notes.filter((n) => !own.test(n)), ev: rest.ev + su.value, flatEv: su.value, sustains: true }
            : { kind: "buff", title: `Sustain ${su.name}`, target: null, ev: su.value, flatEv: su.value, steps: [step, ...(ACT > 1 ? [{ cost: ACT - 1, text: "Its other actions: move, or take cover; nothing else it has reaches a foe" }] : [])], notes: [], dest: null, sustains: true };
        delete plan.score;
        delete plan.why;
        for (const other of plans) if (costOf(other) > 0) other.notes.push(`${su.name} ends: it doesn't Sustain it`);
        plans.push(plan);
    }

    const ATTACK_KINDS = new Set(["melee", "ranged", "spell", "ability", "area", "demoralize", "feint", "setup"]);
    // Score: expected damage, plus who it's aimed at, minus what it risks
    const inReachNow = targets.filter((t) => melee.some((s) => inReach(me.rect, t.rect, s.reach)));
    const tier = tierOf(me);
    for (const plan of plans) {
        plan.risk ??= 0;
        // Who it's aimed at, as this creature's wits see it: cues it notices, the threat table, how soft the target looks
        const pick = plan.caught?.length ? areaPick(board, plan, tier) : plan.target ? targetBonus(board, plan, tier, inReachNow) : { b: 0, why: [] };
        if (pick.why.length) plan.why = pick.why;
        // Animals don't weigh the reactions they'd set off; the card still names them
        // Threat multiplies what the plan is worth (aggro); the other cues are points, scaled to its level
        plan.score ??= (plan.ev - (plan.flatEv ?? 0)) * seenFactor(board, plan, tier) * (pick.mult ?? 1) + (plan.flatEv ?? 0) + (pick.add ?? 0) + pick.b * lvlScale - (animal ? 0 : plan.risk) - (plan.leaveRisk ?? 0);
        if (animal && plan.target) {
            // Instinct: it goes for what's closest, and won't walk away from a foe at its jaws to pick a softer one
            const caught = plan.caught ?? [plan.target];
            plan.score -= (Math.min(...caught.map((c) => feetBetween(me.rect, c.rect))) / 5) * lvlScale;
            if (plan.dest && inReachNow.length && !caught.some((c) => inReachNow.includes(c))) plan.score -= 6 * lvlScale;
        }
        if (plan.kind === "melee" && board.spells.some((sp) => sp.dc && (sp.avg || sp.inflicts?.length))) plan.score -= 1.5 * lvlScale; // a caster's place isn't in melee
        const endAt = plan.dest ? rectAt(plan.dest) : me.rect;
        if (HIT_RUN) {
            // Where it ends its turn: a thinking flier weighs it for everything it attacks with
            if (!plan.flyAway && (ATTACK_KINDS.has(plan.kind) || plan.ownEv != null)) plan.score -= endPenalty(endAt);
        } else if (plan.kind === "ranged" || plan.kind === "spell") plan.score -= exposure(board, endAt) * 0.5 * lvlScale;
    }
    plans.sort((a, b) => b.score - a.score);
    const top = plans[0];
    // The best it can do is next to nothing (a dagger thrown at -10): keep out of reach and wait for an opening instead
    const ATTACKS = ["melee", "ranged", "spell", "ability", "area", "strike", "attack", "demoralize", "feint"];
    if (top && board.square && !intent && ATTACKS.includes(top.kind) && top.ev < Math.max(1, 0.15 * hitWorth(me.level))) {
        let best = null;
        const exposedNow = exposure(board, me.rect) > 0;
        for (const sq of squares) {
            if (sq.route.actions > (exposedNow ? Math.min(1, ACT - 1) : 0)) continue; // out of reach already: stay put; and keep an action for cover
            const at = rectAt(sq);
            const exp = exposure(board, at);
            const nearest = Math.min(...board.enemies.map((e) => feetBetween(at, e.rect)), 999);
            const sc = -exp * 20 + Math.min(nearest, 40) - sq.route.provokes.length * 15 - sq.route.actions * 2;
            if (!best || sc > best.sc) best = { sq, sc, exp };
        }
        if (best) {
            const r = best.sq.route;
            const hold = { kind: "hold", title: "Hold Back", target: null, ev: 0.2, score: top.score + 0.5, notes: [`Its best attack from here is worth about ${round1(top.ev)} damage (${top.title})`], dest: r.actions ? { x: best.sq.x, y: best.sq.y, z: best.sq.z } : null, steps: [] };
            if (r.actions) hold.steps.push({ cost: r.actions, text: `${routeText(r)}${r.doors || r.tail || r.vText ? "," : ""} back${best.exp ? "" : " out of reach"}` });
            if (ACT - r.actions >= 1) hold.steps.push({ cost: 1, text: board.me.shield && !board.me.shieldRaised ? "Raise a Shield" : "Take Cover behind something if it can" });
            if (ACT - r.actions - 1 > 0) hold.steps.push({ cost: ACT - r.actions - 1, text: "Ready a Strike for whoever comes close, or Aid an ally" });
            plans.unshift(hold);
        }
    }
    // Badly hurt (under a quarter of its HP) and not about to drop someone: a thinking or animal foe breaks off,
    // unless its tactics say it fights to the end. Mindless creatures never do.
    const fearless = /\b(?:to the death|to the end|never (?:flees|retreats|surrenders)|fearless)\b/i.test(board.tacticsText ?? "");
    const pinned = ["grabbed", "restrained", "immobilized"].some((c) => mc.has(c));
    // Or a blow to its morale: its leader falls (a creature of no great will), half its side is down, or it has just taken a
    // beating, and it's hurt. The GM's call; offered first, as a thinking creature would weigh it.
    const hpFrac = me.hp / Math.max(1, me.maxHp);
    const fallen = board.fallenAllies ?? [];
    const leader = fallen.find((a) => (a.level ?? 0) >= (me.level ?? 0) + 2 || /\b(?:captain|chief(?:tain)?|leader|boss|sergeant|lieutenant|commander|warlord|warchief|matriarch|patriarch|alpha|queen|king)\b/i.test(a.name ?? ""));
    const morale = hpFrac < 0.25 ? null
        : leader && (me.wis ?? 0) <= 2 && hpFrac < 0.75 ? `${nameOf(leader)} is down`
        : fallen.length >= 1 && fallen.length >= (board.allies?.length ?? 0) + 1 && hpFrac < 0.5 ? `half its side is down`
        : (board.recentDamage ?? 0) >= 0.4 * me.maxHp && hpFrac < 0.5 ? `took ${board.recentDamage} damage since its last turn` : null;
    if (top && !intent && !me.mindless && !fearless && !pinned && me.hp > 0 && (hpFrac < 0.25 || morale) && targets.length && !(plans[0].why ?? []).includes("could drop")) {
        // A boss (two or more levels over the party's best) or the last of its side (nobody else to run to) is
        // offered the choice second, not first: its flight ends the fight, and that's the GM's story call
        const partyLevel = Math.max(0, ...targets.map((t) => t.level ?? 0));
        const boss = (me.level ?? 0) >= partyLevel + 2;
        const solo = !(board.allies?.length) && !fallen.length;
        const fp = fleePlan(morale ? `Break off (${morale})` : `Break off (badly hurt, ${me.hp} of ${me.maxHp} HP)`, boss || solo ? plans[0].score - 0.5 : plans[0].score + (morale ? 1 : 2));
        if (fp?.dest) {
            fp.notes.push(morale ? "A blow to its morale: many creatures break off here (the GM's call; its tactics may say otherwise)"
                : "No trigger says what it does when hurt: thinking creatures and animals usually break off now");
            if (boss || solo) { fp.notes.push(boss ? "A creature this far above them rarely runs: your call" : "The last one standing: if it runs, the fight is over"); plans.splice(1, 0, fp); }
            else plans.unshift(fp);
        }
    }
    for (const plan of plans) {
        if (selfNotes.length) plan.notes.push(...selfNotes);
        const item = plan.spell?.consumable;
        if (item === "scroll" || item === "wand") {
            plan.notes.push(`${plan.spell.drawn ? `Draws the ${item} first (an Interact, counted in its actions); ` : ""}${item === "scroll" ? "the scroll is used up" : "it spends the wand's use for the day"}`);
        }
        if (plan.dest) {
            const viaRamp = plan.dest.z !== undefined ? squares.find((q) => q.x === plan.dest.x && q.y === plan.dest.y && q.z === plan.dest.z && q.route?.waypoints) : null;
            plan.path = viaRamp ? [...pathTo(board, viaRamp.route.waypoints[0]), ...[viaRamp.route.waypoints[1], plan.dest].map((q) => ({ x: q.x, y: q.y, w: me.rect.w }))] : pathTo(board, plan.dest);
            // What the way crosses: a door to open, uneven ground, an incline, hazardous terrain
            const crossed = [];
            const cells = pathCells(board, plan.dest);
            for (let i = 1; i < cells.length; i++) {
                if (board.doorBetween?.(cells[i - 1].x, cells[i - 1].y, cells[i].x, cells[i].y) && !crossed.includes("door")) crossed.push("door");
            }
            const ground = new Set();
            for (const c of cells.slice(1)) for (const n of board.terrainNoteAt?.(c.x, c.y) ?? []) ground.add(n);
            if (crossed.includes("door") && !plan.steps.some((st) => /\bdoor/.test(st.text))) plan.notes.unshift("Opens a door on the way (Interact, 1 action, counted)");
            if (ground.size) plan.notes.push(`The way crosses ${[...ground].join(", ")}`);
        }
    }
    // Holding back or breaking off in the air still needs a Fly
    if (me.airborne && !noFollow) for (const plan of plans) if ((plan.kind === "hold" || plan.kind === "run") && !plan.steps.some((st) => /\bFly\b/.test(st.text ?? ""))) plan.notes.push("Up in the air: one of its actions has to be a Fly, or it falls");
    plans.sort((a, b) => b.score - a.score);
    // The same turn reached two ways (two spellcasting entries, say): keep the first
    const unique = [];
    const kept = new Set();
    for (const plan of plans) { const k = `${plan.title}|${plan.steps.map((x) => x.text).join("|")}`; if (!kept.has(k)) { kept.add(k); unique.push(plan); } }
    plans.length = 0;
    plans.push(...unique);
    return plans;
}

/** Best place to aim an area: most enemies, no allies, from where it stands or one action away. */
/** Areas the grid code knows: a cylinder is a burst seen from above; a cube or square, a burst of half its side. */
function normalArea(area) {
    const shape = String(area?.shape ?? "burst").toLowerCase();
    const size = Number(area?.size) || 5;
    if (["burst", "cone", "line", "emanation", "space"].includes(shape)) return { shape, size };
    if (shape === "cube" || shape === "square") return { shape: "burst", size: Math.max(5, Math.round(size / 10) * 5) };
    return { shape: "burst", size };
}

function bestArea(board, squares, rectAt, a) {
    a = { ...a, area: normalArea(a.area) };
    let best = null;
    const tries = squares.filter((sq) => sq.route.actions + a.cost <= ACT && sq.route.actions <= 1);
    // What the actions left after it are worth from that square (a Strike on whoever's in reach), and on whom
    const leftover = (sq, at) => {
        const left = ACT - sq.route.actions - a.cost;
        let out = { ev: 0, target: null };
        if (left <= 0) return out;
        for (const t of board.enemies.filter((e) => e.hp > 0 && !e.conditions?.has?.("dying"))) {
            const tmp = { ev: 0, steps: [], notes: [] };
            fillLast(board, tmp, at, left, t, 0);
            // Leave out "Step out of reach": it would pull the aim toward squares in enemy reach
            // HIT_RUN is only set for thinking fliers; an airborne animal still gets a flyAway step, with no penalty data
            const ev = tmp.ev - tmp.steps.reduce((sum, x) => sum + (x.value ?? 0), 0) - (tmp.leaveRisk ?? 0) + (tmp.flyAway && HIT_RUN ? HIT_RUN.penalty(at) : 0);
            if (ev > out.ev) out = { ev, target: t, flyAway: !!tmp.flyAway };
        }
        return out;
    };
    // A burst's catch and damage depend only on its point, not on where the creature stands: once per point
    const byPoint = new Map();
    const judge = (aim, at) => {
        const key = aim.origin ? `${aim.origin.x},${aim.origin.y},${aim.originZ ?? 0}` : null;
        if (key && byPoint.has(key)) return byPoint.get(key);
        let out = null;
        const hits = areaHits(board, a.area.shape, a.area.size, { ...aim, at });
        if (hits.enemies.length) {
            // Each creature in it: line of effect from the origin, standard or greater cover to Reflex, weakness and
            // resistance, and incapacitation against higher levels
            const origin = aim.origin ? { x: aim.origin.x - 0.01, y: aim.origin.y - 0.01, w: 0.02, h: 0.02 } : at;
            const hurt = (c) => {
                const cover = coverBetween(board, origin, c, { area: true });
                if (cover < 0) return 0;
                const shift = a.incapacitation && ((a.incapacitation.rank && (c.level ?? 0) > 2 * a.incapacitation.rank) || (a.incapacitation.level !== undefined && (c.level ?? 0) > a.incapacitation.level)) ? 1 : 0;
                const dmg = damageAgainst(c.iwr, a.damageTypes ?? []);
                const save = (c.saves?.[a.save?.stat] ?? 3) + (a.save?.stat === "reflex" ? cover : 0);
                return a.save ? saveExpected(save, a.dc, a.avg, { basic: a.save.basic !== false, shift, delta: dmg.delta, immune: dmg.immune }).expected : (dmg.immune ? 0 : Math.max(0, a.avg + dmg.delta) * 0.6);
            };
            const reached = hits.enemies.filter((e) => coverBetween(board, origin, e, { area: true }) >= 0);
            if (reached.length) {
                // Ice, rubble, webbing: difficult terrain it leaves behind slows everyone it caught
                const ev = (reached.reduce((t, e) => t + hurt(e), 0) + (a.terrain ? reached.length : 0)) * (a.odds ?? 1);
                out = { hits: { ...hits, enemies: reached }, ev, hurt, allyHurt: hits.allies.reduce((t, al) => t + hurt(al), 0) };
            }
        }
        if (key) byPoint.set(key, out);
        return out;
    };
    // The points a burst can be centred on: the corners of each enemy's space
    const points = [];
    if (a.area.shape === "burst") {
        const seen = new Set();
        for (const e of board.enemies) {
            for (const [x, y] of [[e.rect.x, e.rect.y], [e.rect.x + e.rect.w, e.rect.y], [e.rect.x, e.rect.y + e.rect.h], [e.rect.x + e.rect.w, e.rect.y + e.rect.h]]) {
                const z = e.rect.z ?? 0;
                if (seen.has(`${x},${y},${z}`)) continue;
                seen.add(`${x},${y},${z}`);
                points.push({ origin: { x, y }, originZ: z, rect: { x, y, w: 1, h: 1, z, lvl: e.rect.lvl ?? null } });
            }
        }
    }
    for (const sq of tries) {
        const at = rectAt(sq);
        let after = null, casting = null;
        const aims = [];
        if (a.area.shape === "emanation" || a.area.shape === "space") aims.push({});
        else if (a.area.shape === "burst") {
            for (const pt of points) if (!a.range || feetBetween(at, pt.rect) <= a.range) aims.push(pt);
        } else for (const e of board.enemies) aims.push({ aim: centerOf(e.rect) });
        for (const aim of aims) {
            const j = judge(aim, at);
            if (!j) continue;
            const { hits, ev, hurt } = j;
            // A burst it stands in catches it too
            const self = a.area.shape === "burst" && feetBetween(at, aim.rect) <= a.area.size + 10 && verticalGap(aim.originZ ?? 0, at) <= a.area.size && rectInArea(areaTest(a.area.shape, a.area.size, { ...aim, self: at }).test, at);
            const friendly = j.allyHurt + (self ? hurt({ ...board.me, rect: at, saves: board.me.saves ?? {} }) : 0);
            casting ??= castProvokers(board, at, a.traits ?? []);
            after ??= leftover(sq, at);
            // Where it ends up: thinking creatures don't land in the middle of the party to breathe a cone they could breathe from the edge
            const endCost = a.endCost ? a.endCost(at) : 0;
            // 5. What it provokes getting there and using it, at what those reactions are worth at this level
            const score = ev + after.ev - friendly * 1.5 - sq.route.actions - provokeCost(board, [...sq.route.provokes, ...casting.map((e) => e.id)]) - endCost;
            if (!best || score > best.score) best = { sq, at, aim, hits, ev, friendly, score, casting, self, after };
        }
    }
    if (!best) return null;
    const names = best.hits.enemies.map(nameOf);
    const plan = {
        kind: "area", title: `${a.name}: ${names.length} enem${names.length === 1 ? "y" : "ies"}`, target: best.hits.enemies[0],
        ev: best.ev, steps: [], notes: [], dest: best.sq.route.actions ? { x: best.sq.x, y: best.sq.y, z: best.sq.z } : null,
        aim: best.aim.origin ?? best.aim.aim ?? null, caught: best.hits.enemies,
    };
    if (best.sq.route.actions) plan.steps.push({ cost: best.sq.route.actions, text: `${routeText(best.sq.route)}${best.sq.route.doors || best.sq.route.tail || best.sq.route.vText ? "," : ""} to line it up` });
    plan.steps.push({ cost: a.cost, text: `${a.name} (${a.area.shape === "space" ? "everyone in its space" : `${a.area.size}-foot ${a.area.shape}`}) catching ${names.join(", ")}${a.save ? `: ${a.save.basic !== false ? "basic " : ""}${cap(a.save.stat)} DC ${a.dc}` : ""}` });
    if (best.hits.allies.length) plan.notes.push(`Also catches ${best.hits.allies.map(nameOf).join(", ")}`);
    if (best.self) plan.notes.push("It stands in the burst itself");
    if (a.incapacitation) plan.notes.push("Incapacitation: higher-level targets get one degree better");
    if (a.terrain) plan.notes.push("Leaves difficult terrain where it hits");
    if ((a.odds ?? 1) < 1) plan.notes.push(`About ${pct(a.odds)} to get it off (flat check)`);
    if (best.sq.route.provokes.length) plan.notes.push(`Provokes ${provokeNames(board, best.sq.route.provokes).join(", ")}`);
    if (best.casting.length) plan.notes.push(`Using it in reach of ${best.casting.map(nameOf).join(", ")} provokes (manipulate)`);
    plan.risk = provokeCost(board, [...best.sq.route.provokes, ...best.casting.map((e) => e.id)]);
    fillLast(board, plan, best.at, ACT - best.sq.route.actions - a.cost, best.after?.target ?? best.hits.enemies[0], 0);
    return plan;
}

/** Things that may beat a third Strike at -10: Demoralize (best done first), or raising a shield. */
function thirdActionAlternatives(board, target, at) {
    const { me } = board;
    const out = [];
    const smart = !me.mindless && me.int > -4;
    // Demoralize: auditory, 30 feet, -4 without a shared language, nothing on a deafened target
    if (me.intimidation !== null && smart && !target.conditions.has("frightened") && !target.conditions.has("deafened") && feetBetween(at, target.rect) <= 30) {
        const shared = !me.languages?.length || !target.languages?.length || me.languages.some((l) => target.languages.includes(l));
        const mod = me.intimidation - (shared ? 0 : 4);
        const c = degreeChances(mod, 10 + (target.saves.will ?? 0));
        // value: what frightened is worth to the rest of the side after this turn; the Strikes it helps are counted by the caller
        out.push({ kind: "demoralize", first: true, value: c.s * 1 + c.cs * 2.5, chances: c, after: " (AC lower if Demoralize worked)",
            text: `Demoralize ${nameOf(target)} (Intimidation ${signed(mod)}${shared ? "" : ", -4 no shared language"} vs Will DC ${10 + (target.saves.will ?? 0)}; once per target per 10 minutes)` });
    }
    // Feint: trained Deception, in melee reach, against the target's Perception DC
    if (me.deception !== null && me.deceptionTrained && smart && board.strikes.some((s) => !s.ranged && inReach(at, target.rect, s.reach))) {
        const c = degreeChances(me.deception, 10 + (target.perception ?? target.saves.will ?? 0));
        out.push({ kind: "feint", first: true, value: 0, chances: c, after: " (off-guard to the first if the Feint worked, all of them on a critical success)",
            text: `Feint ${nameOf(target)} (Deception ${signed(me.deception)} vs Perception DC ${10 + (target.perception ?? target.saves.will ?? 0)})` });
    }
    if (me.shield && !me.shieldRaised && exposure(board, at)) out.push({ kind: "shield", value: 2.5, text: "Raise a Shield" });
    return out;
}
// ---------------------------------------------------------------------------------------------

export { CONDITION_VALUE, NOTICE, RUN_WORDS, TIER_TEXT, acAgainst, actorTier, areaHits, bestArea, dropChance, exposure, fillLast, flankingAlly, heightRoute, isOffGuard, nameOf, pickHeightWay, planTurn, provokeCost, reachableSquares, routeTo, seenFactor, strikeRun, targetBonus, thirdActionAlternatives, threatPull, threatShare, tierOf };
