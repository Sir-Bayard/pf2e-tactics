/**
 * PF2e Tactics: classes/rogue.mjs
 * See classes/_common.mjs for the shape of a class read.
 * What the rogue knows that the advisor doesn't: the Sneak Attack dice by level and which weapons carry them (by racket),
 * foes off-guard for a reason the board doesn't show (Surprise Attack, Gang Up, Dread Striker), turns it can't compose
 * (Recall Knowledge then Strike as a mastermind, Twin Feint, Instant Opening then Strike, Spring from the Shadows,
 * Skirmish Strike), Impossible Striker's full dice on everyone, and when-notes for the reactions, the debilitations and
 * the higher-level tricks.
 */
import { bestStrike, canMove, castable, effect, focusLeft, has, sneaky, standardDC, level, markOffGuard, moveText, myReach, allySpeed, pct, slugOf, squareToReach, strikeRun, targets, worth, degreeChances, feetBetween, inReach, mapFor, strikeExpected, saveExpected, CONDITION_VALUE, nameOf, reachableSquares, signed } from "./_common.mjs";

const RACKETS = ["ruffian", "scoundrel", "thief", "mastermind", "eldritch-trickster", "avenger"];
const unarmed = (s) => !!s.traits?.includes("unarmed");
const dieOf = (s) => Number(String(s.die ?? s.item?.system?.damage?.die ?? "").replace("d", "")) || 0;
const categoryOf = (s) => String(s.category ?? s.item?.system?.category ?? "");
const times = (n) => (n === 1 ? "" : n === 2 ? " twice" : n === 3 ? " three times" : ` ${n} times`);
const adjacent = (a, b) => inReach(a.rect, b.rect, 5);
function rogue(board, ctx, out) {
    const actor = board.me.actor;
    const me = board.me;
    const lv = level(board);
    const combat = game.combat;
    const foes = targets(board);
    const racket = RACKETS.find((r) => has(actor, r)) ?? null;
    const offGuardTo = (f) => !!f.conditions?.has?.("off-guard");
    const n = (t) => { if (t) out.notes.push(t); };
    // Sneak Attack dice: the sheet's flag when it has one, else the class table (1d6, +1 at 5, 11 and 17)
    const flag = actor.flags?.system?.sneakAttackDamage;
    const dice = Number(flag?.number) > 0 ? Number(flag.number) : lv >= 17 ? 4 : lv >= 11 ? 3 : lv >= 5 ? 2 : 1;
    const faces = Number(flag?.faces) > 0 ? Number(flag.faces) : 6;
    const sneakAvg = dice * (faces + 1) / 2;
    if (has(actor, "sneak-attack")) board.sneak = Math.max(board.sneak ?? 0, sneakAvg);
    const sneak = board.sneak ?? 0;
    for (const s of board.strikes) s.sneaky = sneaky(s, racket === "ruffian"); // the advisor adds the dice only to these
    // Sly Striker (8): +1d6 precision (2d6 at 14th with 3d6 Sneak Attack) on a hit against a foe that isn't off-guard, with a
    // Strike that carries Sneak Attack. On the Strike for everyone; the board's off-guard bonus is the rest of the dice.
    const sly = has(actor, "sly-striker") && sneak > 0 && !has(actor, "impossible-striker") ? (lv >= 14 && dice >= 3 ? 7 : 3.5) : 0;
    const net = sneak - sly; // what an off-guard foe adds on top of a Strike's avg
    const weapons = board.strikes.filter((s) => !s.ranged && !unarmed(s));
    const carry = board.strikes.filter((s) => sneaky(s, racket === "ruffian"));
    const dont = board.strikes.filter((s) => !sneaky(s, racket === "ruffian"));
    // Impossible Striker (20): the full dice against everyone. Every Strike gets them, and the off-guard bonus is folded in.
    if (has(actor, "impossible-striker") && sneak > 0) {
        for (const s of board.strikes) if (sneaky(s, racket === "ruffian") && !s.impossibleCounted) { s.impossibleCounted = true; s.avg += sneak; }
        board.sneak = 0;
        n(`Impossible Striker: your full Sneak Attack (${dice}d${faces}) lands on every hit, off-guard or not. The plans count it on every Strike.`);
    } else if (sneak > 0) {
        n(`Sneak Attack: +${dice}d${faces} precision against an off-guard foe (flanked, prone, grabbed, feinted${has(actor, "dread-striker") ? ", frightened" : ""}...)${racket === "ruffian" ? " with any simple weapon to a d8 or martial weapon to a d6" : " with an agile, finesse or ranged weapon"}. The plans count it where it applies${dont.length ? `: ${dont.map((s) => s.label).join(", ")} ${dont.length === 1 ? "doesn't" : "don't"} carry it` : ""}.`);
        if (sly) {
            for (const s of board.strikes) if (s.sneaky && !s.slyCounted) { s.slyCounted = true; s.avg += sly; }
            board.sneak = net;
            n(`Sly Striker: +${sly === 7 ? 2 : 1}d6 precision on hits against foes that aren't off-guard, with the Strikes that carry Sneak Attack; the plans count it.`);
        }
    }
    // Racket
    if (racket === "ruffian") n("Ruffian: a critical hit on an off-guard foe gets the weapon's critical specialization effect.");
    if (racket === "scoundrel") n(`Scoundrel: a Feint that works makes the foe off-guard to your melee attacks until the end of your next turn (to everyone's on a critical success), so every melee Strike until then carries Sneak Attack${weapons.some((s) => s.agile || s.traits?.includes("finesse")) ? "; with your agile or finesse weapon you Step for free right after the Feint" : ""}.${has(actor, "distracting-feint") ? " Distracting Feint: it's also -2 to Perception and Reflex saves while feinted." : ""}${has(actor, "overextending-feint") ? " Overextending Feint instead: -2 on its attacks against you." : ""}`);
    if (racket === "eldritch-trickster") n(`Eldritch Trickster: your archetype spells read like any caster's${has(actor, "magical-trickster") ? "; Magical Trickster: a spell attack that hits an off-guard foe adds your Sneak Attack dice once" : ""}.`);
    if (racket === "thief") n("Thief: Dexterity on damage with finesse melee weapons is already in your Strikes.");
    // Surprise Attack: round 1, initiative by Stealth or Deception, foes who haven't acted yet
    if (has(actor, "surprise-attack") && combat?.started && combat.round === 1) {
        const mine = combat.combatants.find((c) => c.tokenId === me.id);
        const stat = mine?.flags?.pf2e?.initiativeStatistic ?? null;
        if (["stealth", "deception"].includes(stat)) {
            const late = foes.filter((f) => { const c = combat.combatants.find((x) => x.tokenId === f.id); return c && combat.turns.indexOf(c) > combat.turn; });
            for (const f of late) markOffGuard(board, f, "Surprise Attack: hasn't acted yet");
        }
        if (has(actor, "tactical-entry") && stat === "stealth" && combat.turn === 0) n("Tactical Entry (free action): a Stride that triggers nothing, before anyone has acted.");
    }
    // Gang Up (6): a foe within reach of you and an ally is flanked: off-guard to your melee Strikes, not to a bow or a spell.
    // The board's off-guard mark reaches every attack, so it's set only when melee Strikes are all you attack with; otherwise
    // the read plans the melee Strikes itself (below) and the foe stays as it is for the rest.
    const ganged = [];
    if (has(actor, "gang-up")) {
        const otherAttacks = board.strikes.some((s) => s.ranged) || (board.spells ?? []).some((sp) => sp.attack);
        for (const f of foes) {
            const ally = board.allies.find((a) => a.hasMelee !== false && a.canAct !== false && inReach(a.rect, f.rect, a.reach ?? 5));
            if (!ally || offGuardTo(f)) continue;
            if (!otherAttacks) markOffGuard(board, f, `Gang Up: ${nameOf(ally)} is on it`);
            else ganged.push({ f, ally });
        }
    }
    // Dread Striker (4): frightened foes are off-guard to you
    if (has(actor, "dread-striker")) for (const f of foes) if (f.conditions?.has?.("frightened")) markOffGuard(board, f, "Dread Striker: it's frightened");
    const marked = foes.filter((f) => f.offGuardWhy?.length);
    if (marked.length) n(`Off-guard to you now: ${marked.map((f) => `${nameOf(f)} (${f.offGuardWhy.join("; ")})`).join(", ")}.`);
    if (ganged.length) n(`Gang Up: ${ganged.map((g) => `${nameOf(g.f)} (${nameOf(g.ally)} is on it)`).join(", ")} ${ganged.length > 1 ? "are" : "is"} off-guard to your melee Strikes once you're in reach, not to your ranged ones; the Gang Up plans count it.`);
    const bump = (f) => (offGuardTo(f) ? 0 : -2);
    const plan = (title, f, ev, sq, steps, notes = [], bias = 0.3) => out.plans.push({ kind: "class", title, target: f, ev, score: ev + bias, dest: sq?.route?.actions ? { x: sq.x, y: sq.y } : null, steps, notes });
    /**
     * The best Strike at f with the dice only on a weapon that carries them. p: the chance it's off-guard. Melee by default;
     * ranged: the ranged Strikes that reach f from where you stand (-2 in the second range increment).
     */
    const bestVs = (f, made, p, extra = 0, { ranged = false } = {}) => {
        let b = null;
        const q = offGuardTo(f) ? 1 : p;
        const d = feetBetween(me.rect, f.rect);
        for (const s of board.strikes.filter((s) => (ranged ? s.ranged && d <= (s.range ?? 30) * 2 : !s.ranged))) {
            const bonus = s.bonus + mapFor(made, s.agile) - (ranged && d > (s.range ?? 30) ? 2 : 0);
            // Sly Striker is already in avg; an off-guard foe adds the rest of the dice
            const e = strikeExpected(bonus, f.ac - (offGuardTo(f) ? 0 : 2 * p), s.avg + extra + (sneaky(s, racket === "ruffian") ? net * q : 0), { deadly: s.deadly });
            if (!b || e.expected > b.e.expected) b = { s, bonus, e };
        }
        return b;
    };
    /** n Strikes at f, the target off-guard with probability p (its AC down by 2p, the dice with chance p). */
    const sneakRun = (f, nStrikes, made, p, extra = 0, opts = {}) => {
        const used = [];
        let ev = 0;
        for (let i = 0; i < nStrikes; i++) { const b = bestVs(f, made + used.length, p, extra, opts); if (!b) break; used.push(b); ev += b.e.expected; }
        return { used, ev, text: used.length ? `Strike ${nameOf(f)} with ${used[0].s.label}${times(used.length)} (${used.map((u) => signed(u.bonus)).join(", ")})` : "" };
    };

    /* ---- Gang Up, when the board isn't marked: Stride into reach and Strike it in melee, flanked ---- */
    for (const { f, ally } of ganged) {
        if (ctx.actions < 1) break;
        const sq = squareToReach(board, f, myReach(board), Math.max(0, ctx.actions - 1));
        if (!sq) continue;
        const left = ctx.actions - sq.route.actions;
        if (left < 1) continue;
        const r = sneakRun(f, left, ctx.made, 1);
        if (!r.used.length) continue;
        const steps = sq.route.actions ? [{ cost: sq.route.actions, text: moveText(sq, f) }] : [];
        steps.push({ cost: r.used.length, text: `${r.text}, flanked with ${nameOf(ally)} (Gang Up), with Sneak Attack` });
        plan(`Gang Up on ${nameOf(f)}`, f, r.ev, sq, steps, [`Off-guard only to your melee Strikes, and only while ${nameOf(ally)} has it in reach.`], 0.3);
    }

    /* ---- Mastermind: Recall Knowledge, then Strike it off-guard; Analyze Weakness (6) on top when there's an action for it ---- */
    if (has(actor, "mastermind") && ctx.actions >= 2) {
        const skills = ["arcana", "nature", "occultism", "religion", "society"].map((k) => actor.skills?.[k]).filter((sk) => sk && (sk.rank ?? 0) >= 1).sort((a, b) => (b.mod ?? 0) - (a.mod ?? 0));
        const best = skills[0];
        if (best) {
            const analyzeDice = lv >= 17 ? 4 : lv >= 11 ? 3 : 2;
            for (const f of foes.filter((x) => !x.offGuardWhy?.length)) {
                const sq = squareToReach(board, f, myReach(board), ctx.actions - 2);
                if (!sq) continue;
                const left = ctx.actions - 1 - sq.route.actions;
                if (left < 1) continue;
                const dc = standardDC(lv); // the level-based DC of a creature of the party's level: the GM has the real one
                const c = degreeChances(best.mod ?? 0, dc);
                const p = c.s + c.cs;
                const steps = [{ cost: 1, text: `Recall Knowledge on ${nameOf(f)} (${best.label ?? best.slug} ${signed(best.mod ?? 0)}; about ${pct(p)} against a DC for its level): on a success it's off-guard to you until the start of your next turn, and you learn something true` }];
                if (sq.route.actions) steps.push({ cost: sq.route.actions, text: moveText(sq, f) });
                const plain = sneakRun(f, left, ctx.made, p);
                let pick = { ...plain, analyze: false };
                if (has(actor, "analyze-weakness") && left >= 2) {
                    const an = sneakRun(f, left - 1, ctx.made, p, 0);
                    // the extra dice ride on the first Strike that sneak attacks: about p x hit chance of the first
                    const first = an.used[0];
                    const anEv = an.ev + (first ? p * first.e.hit * analyzeDice * 3.5 : 0);
                    if (anEv > plain.ev) pick = { ...an, ev: anEv, analyze: true };
                }
                if (!pick.used.length) continue;
                if (pick.analyze) steps.push({ cost: 1, text: `Analyze Weakness on ${nameOf(f)} (if the Recall Knowledge worked): +${analyzeDice}d6 precision on your next Sneak Attack this turn` });
                steps.push({ cost: pick.used.length, text: `${pick.text}; Sneak Attack if it worked` });
                plan(`Size up ${nameOf(f)}, then Strike`, f, pick.ev, sq, steps, ["Mastermind: the first Recall Knowledge on a creature each fight; a critical success keeps it off-guard for a minute.", has(actor, "clever-gambit") ? "Clever Gambit fires when you critically hit a foe you've identified: a free Step or Stride it can't react to." : null].filter(Boolean));
            }
        }
    }

    /* ---- Twin Feint (1; 2 actions): two Strikes with two melee weapons; the second treats the target as off-guard ---- */
    if (has(actor, "twin-feint") && ctx.actions >= 2 && weapons.length >= 2) {
        for (const f of foes) {
            const sq = squareToReach(board, f, myReach(board), ctx.actions - 2);
            if (!sq) continue;
            if (ctx.actions - 2 - sq.route.actions < 0) continue;
            let best = null;
            for (const a of weapons) for (const b of weapons) {
                if (a === b) continue;
                const e1 = strikeExpected(a.bonus + mapFor(ctx.made, a.agile), f.ac, a.avg + (offGuardTo(f) && sneaky(a, racket === "ruffian") ? net : 0), { deadly: a.deadly });
                const e2 = strikeExpected(b.bonus + mapFor(ctx.made + 1, b.agile), f.ac + bump(f), b.avg + (sneaky(b, racket === "ruffian") ? net : 0), { deadly: b.deadly });
                const ev = e1.expected + e2.expected;
                if (!best || ev > best.ev) best = { a, b, ev, e1, e2 };
            }
            if (!best) continue;
            const steps = [];
            if (sq.route.actions) steps.push({ cost: sq.route.actions, text: moveText(sq, f) });
            steps.push({ cost: 2, text: `Twin Feint ${nameOf(f)}: ${best.a.label} (${signed(best.a.bonus + mapFor(ctx.made, best.a.agile))}), then ${best.b.label} (${signed(best.b.bonus + mapFor(ctx.made + 1, best.b.agile))}) against it off-guard, with Sneak Attack` });
            let ev = best.ev;
            const left = ctx.actions - 2 - sq.route.actions;
            if (left >= 1) {
                const third = bestVs(f, ctx.made + 2, 0);
                if (has(actor, "twist-the-knife") && best.e2.hit > 0.4) { steps.push({ cost: 1, text: `Twist the Knife (if the second hit): ${dice} persistent bleed` }); ev += best.e2.hit * dice * 2.5; }
                else if (third && third.e.expected > 2) { steps.push({ cost: 1, text: `Strike ${nameOf(f)} with ${third.s.label} (${signed(third.bonus)})` }); ev += third.e.expected; }
                else steps.push({ cost: 1, text: "Step away, Raise a Shield, or Hide if you have cover" });
            }
            plan(`Twin Feint ${nameOf(f)}`, f, ev, sq, steps, [has(actor, "twin-distraction") ? "Twin Distraction: if both Strikes deal damage, it saves against your class DC or is stupefied 1 until the end of your next turn." : null].filter(Boolean));
        }
    }

    /* ---- Instant Opening (14; 1 action): a foe within 30 feet is off-guard to your attacks until the end of your next turn ---- */
    if (has(actor, "instant-opening") && ctx.actions >= 2) {
        for (const f of foes.filter((x) => !offGuardTo(x) && feetBetween(me.rect, x.rect) <= 30)) {
            // In melee from a square you can reach, or with a ranged Strike from where you stand: whichever is worth more
            const sq = squareToReach(board, f, myReach(board), ctx.actions - 2);
            const melee = sq && ctx.actions - 1 - sq.route.actions >= 1 ? sneakRun(f, ctx.actions - 1 - sq.route.actions, ctx.made, 1) : null;
            const shot = sneakRun(f, ctx.actions - 1, ctx.made, 1, 0, { ranged: true });
            const useShot = shot.used.length && (!melee?.used.length || shot.ev > melee.ev);
            const r = useShot ? shot : melee;
            if (!r?.used.length) continue;
            const moveActs = useShot ? 0 : sq.route.actions;
            const steps = [{ cost: 1, text: `Instant Opening on ${nameOf(f)}: it's off-guard to your attacks until the end of your next turn, no roll` }];
            if (moveActs) steps.push({ cost: moveActs, text: moveText(sq, f) });
            steps.push({ cost: r.used.length, text: `${r.text}, with Sneak Attack` });
            plan(`Instant Opening on ${nameOf(f)}, then Strike`, f, r.ev, useShot ? null : sq, steps, ["The opening lasts through your next turn too: don't spend another action on it then."], 0.4);
        }
    }

    /* ---- Spring from the Shadows (12; 1 action, flourish): hidden or undetected, Stride to a foe and Strike it before it sees you ---- */
    const unseen = me.conditions?.has?.("hidden") || me.conditions?.has?.("undetected");
    if (has(actor, "spring-from-the-shadows") && unseen && ctx.actions >= 1 && canMove(me)) {
        for (const f of foes) {
            const sq = squareToReach(board, f, myReach(board), 1);
            if (!sq) continue;
            const first = bestVs(f, ctx.made, 1);
            if (!first) continue;
            const steps = [{ cost: 1, text: `Spring from the Shadows: ${sq.route.actions ? `${moveText(sq, f)}, then ` : ""}Strike ${nameOf(f)} with ${first.s.label} (${signed(first.bonus)}) while it still can't see you, with Sneak Attack` }];
            let ev = first.e.expected;
            if (ctx.actions - 1 >= 1) { const r = sneakRun(f, ctx.actions - 1, ctx.made + 1, offGuardTo(f) ? 1 : 0); if (r.used.length) { steps.push({ cost: r.used.length, text: r.text }); ev += r.ev; } }
            plan(`Spring from the Shadows at ${nameOf(f)}`, f, ev, sq, steps, ["You're seen after the first Strike; the rest only sneak attack if it's off-guard for another reason."], 0.4);
        }
    }

    /* ---- Skirmish Strike (6; 1 action, flourish): Strike then Step, to end your turn out of reach ---- */
    if (has(actor, "skirmish-strike") && ctx.actions >= 1 && canMove(me)) {
        for (const f of foes.filter((x) => inReach(me.rect, x.rect, myReach(board)))) {
            const total = ctx.actions;
            const r = sneakRun(f, total, ctx.made, offGuardTo(f) ? 1 : 0);
            if (!r.used.length) continue;
            const others = foes.filter((x) => x !== f && adjacent(me, x)).length;
            const steps = [];
            if (r.used.length > 1) steps.push({ cost: r.used.length - 1, text: `Strike ${nameOf(f)} with ${r.used[0].s.label}${times(r.used.length - 1)} (${r.used.slice(0, -1).map((u) => signed(u.bonus)).join(", ")})` });
            const last = r.used[r.used.length - 1];
            steps.push({ cost: 1, text: `Skirmish Strike: Strike ${nameOf(f)} with ${last.s.label} (${signed(last.bonus)}), then Step out of its reach` });
            const gain = others ? 0.5 : 0.3 * (f.reactiveStrike?.avg ?? 5);
            plan(`Strike ${nameOf(f)}, Skirmish Strike away`, f, r.ev + gain, null, steps, ["A Step triggers nothing; it has to spend an action to reach you again."], 0.2);
        }
    }

    /* ---- Reactions, free actions and riders: when they fire ---- */
    if (has(actor, "nimble-dodge")) n(`Nimble Dodge fires when a foe you can see attacks you: +2 AC against that attack${has(actor, "nimble-roll") ? "; Nimble Roll: also before a Reflex save, and on a miss or a save you Stride 10 feet" : ""}${has(actor, "nimble-strike") ? "; Nimble Strike: a melee Strike back at the attacker, outside your penalty" : ""}.`);
    if (has(actor, "opportune-backstab")) {
        const near = foes.filter((f) => inReach(me.rect, f.rect, myReach(board)) && board.allies.some((a) => a.hasMelee !== false && inReach(a.rect, f.rect, a.reach ?? 5)));
        n(near.length ? `Opportune Backstab fires when an ally's melee attack hits ${near.map(nameOf).join(" or ")}: a Strike back, with Sneak Attack if it's off-guard.` : "Opportune Backstab fires when an ally's melee attack hits a foe in your reach: a Strike.");
    }
    if (has(actor, "sidestep")) {
        const pairs = foes.filter((f) => adjacent(me, f) && foes.some((g) => g !== f && adjacent(me, g) && adjacent(f, g)));
        n(pairs.length ? `Sidestep fires when a Strike misses you: ${pairs.map(nameOf).join(" or ")} is next to you and another foe, so the miss can be rerolled against that one.` : "Sidestep fires when a Strike misses you, with another creature adjacent to you in its reach: the attacker rerolls against it.");
    }
    if (has(actor, "reactive-pursuit")) n("Reactive Pursuit fires when an adjacent foe moves away: Stride after it, ending adjacent, without triggering its reactions.");
    if (has(actor, "reactive-interference")) n("Reactive Interference fires when a foe in your reach uses a reaction: it's disrupted.");
    if (has(actor, "swift-elusion")) n("Swift Elusion fires when a foe ends its move next to you: Acrobatics against its Reflex DC to step around it or move it.");
    if (has(actor, "stay-down")) n(foes.some((f) => f.conditions?.has?.("prone") && inReach(me.rect, f.rect, myReach(board))) ? `Stay Down fires when ${foes.filter((f) => f.conditions?.has?.("prone")).map(nameOf).join(" or ")} Stands: Athletics against its Fortitude DC keeps it down.` : "Stay Down fires when a prone foe in your reach Stands: Athletics against its Fortitude DC keeps it down.");
    if (has(actor, "clever-gambit") && !has(actor, "mastermind")) n("Clever Gambit fires when you critically hit a foe you've identified with Recall Knowledge: a free Step or Stride it can't react to.");
    if (has(actor, "cognitive-loophole")) {
        const mental = [...(me.conditions ?? [])].filter((c) => ["confused", "fascinated", "fleeing", "controlled", "stupefied", "frightened", "slowed", "stunned"].includes(c));
        n(mental.length ? `Cognitive Loophole fires when your turn ends: ignore one mental effect through your next turn, once per effect (${mental.join(", ")} counts if a mental effect put it on you).` : "Cognitive Loophole fires when your turn ends under a mental effect: you ignore it through your next turn, once per effect.");
    }
    if (has(actor, "defensive-roll")) n("Defensive Roll (free, once per 10 minutes) fires when a physical attack would drop you: half damage.");
    if (has(actor, "sanguine-evasion")) n("Sanguine Evasion fires when you're dropped and not wounded: you stay at 1 HP as red mist for up to a minute.");
    if (has(actor, "leave-an-opening")) n("Leave an Opening: your melee critical hits trigger a Reactive Strike from one ally who has it.");
    if (has(actor, "preparation") && ctx.actions >= 1) n("Preparation (1 action, flourish): a second reaction for rogue reactions until your next turn.");
    if (has(actor, "youre-next")) n("You're Next (free action) fires when you drop a foe: Demoralize another within 30 feet.");
    if (has(actor, "brutal-beating")) n("Brutal Beating: a critical hit leaves the foe frightened 1.");
    if (has(actor, "unbalancing-blow")) n("Unbalancing Blow: a critical hit leaves the foe off-guard to you until the end of your next turn, so your next Strikes carry Sneak Attack.");
    if (has(actor, "tumble-behind-rogue") || has(actor, "tumble-behind")) n("Tumble Behind: a foe you Tumble Through is off-guard to your next attack this turn.");
    if (has(actor, "mobility")) n("Mobility: a Stride of half your Speed or less triggers no reactions.");
    if (has(actor, "deny-advantage")) n(`Deny Advantage: you're not off-guard to hidden, undetected or flanking foes of your level or lower${has(actor, "sneak-adept") ? "; Sneak Adept: a failed Sneak is a success" : ""}.`);
    // Debilitating Strike (9) and the debilitation feats: which one, when
    if (has(actor, "debilitating-strike")) {
        const picks = ["enfeebled 1, or -10 feet to its Speeds"];
        if (has(actor, "tactical-debilitations")) picks.push(`Tactical: no reactions (${foes.some((f) => f.reactions?.length) ? "it has one to lose" : "for a foe with Reactive Strike"}), or no flanking`);
        if (has(actor, "precise-debilitations")) picks.push("Precise: off-guard (keeps your Sneak Attack coming next turn without a flank), or +2d6 precision on your attacks against it until the end of your next turn");
        if (has(actor, "vicious-debilitations")) picks.push("Vicious: weakness 5 to your weapon's damage type (best when allies hit it too), or clumsy 1");
        if (has(actor, "eldritch-debilitations")) picks.push("Eldritch: stupefied 1 (a caster), or no Step");
        if (has(actor, "heartless-debilitations")) picks.push(`Heartless: weakness 5 to bleed and poison, or frightened 1${has(actor, "dread-striker") ? " (off-guard to you with Dread Striker)" : ""}`);
        if (has(actor, "methodical-debilitations")) picks.push("Methodical: no flanking, or no AC from a shield or cover");
        if (has(actor, "bloody-debilitation")) picks.push("Bloody: persistent bleed");
        if (has(actor, "critical-debilitation")) picks.push("Critical (on a critical hit): a save or slowed 1, slowed 2 or paralyzed through your next turn");
        n(`Debilitating Strike (free action) fires when a Sneak Attack hits: ${picks.join("; ")}. It lasts until the end of your next turn${has(actor, "double-debilitation") ? ", two at once (Double Debilitation)" : ""}${has(actor, "enduring-debilitation") ? "; Enduring Debilitation (free, once a minute) makes one last a minute" : ""}.`);
    }
    if (has(actor, "master-strike")) n("Master Strike (free action) fires when a Sneak Attack hits: a Fortitude save against your class DC or enfeebled 2, paralyzed 4 rounds, or worse; one try per foe per day, incapacitation against a higher-level foe.");
    if (has(actor, "twist-the-knife") && !has(actor, "twin-feint")) n(`Twist the Knife (1 action) right after a Sneak Attack hits: ${dice} persistent bleed. Better than a third Strike at -10 when the fight has a few rounds left.`);
    if (has(actor, "analyze-weakness")) n(`Analyze Weakness (1 action) on a foe you've identified: +${lv >= 17 ? 4 : lv >= 11 ? 3 : 2}d6 precision on your next Sneak Attack this turn.`);
    if (has(actor, "battle-assessment") && ctx.actions >= 1 && foes.length) n("Battle Assessment (1 action, secret): the GM tells you a foe's lowest save, highest weakness, a resistance or an immunity; once per foe per day, so pick the one the fight hangs on.");
    if (has(actor, "quick-draw")) n("Quick Draw (1 action): draw a weapon and Strike with it in one action, for a sheathed weapon or a thrown one.");
    if (has(actor, "head-stomp") && board.strikes.some(unarmed)) n("Head Stomp (1 action): an unarmed Strike; a hit leaves the foe stupefied 1 (2 on a critical hit) and off-guard until the end of your next turn.");
    if (has(actor, "coordinated-distraction") && ctx.actions >= 1 && board.allies.length) n("Coordinated Distraction (1 action): a foe within 30 feet is off-guard to one ally's first Strike next turn.");
    if (has(actor, "felling-shot") && board.strikes.some((s) => s.ranged)) { const fliers = foes.filter((f) => (f.rect?.z ?? 0) > (me.rect?.z ?? 0)); n(fliers.length ? `Felling Shot (2 actions) on ${fliers.map(nameOf).join(" or ")} when it's off-guard: a hit means a Reflex save or it falls, grounded through your next turn on a critical failure.` : null); }
    if (has(actor, "dispelling-slice")) n("Dispelling Slice (2 actions): a Strike on an off-guard foe that sneak attacks also counteracts one spell on it.");
    if (has(actor, "underhanded-assault") && ctx.actions >= 2 && foes.some((f) => board.allies.some((a) => adjacent(a, f)))) n("Underhanded Assault (2 actions): Sneak up to a foe next to an ally, Stealth at -2 even if it sees you; a success ends in a melee Strike with it off-guard.");
    if (has(actor, "ambushing-knockdown") && unseen) n("Ambushing Knockdown (1 action): with a bludgeoning weapon, Stride half your Speed to a foe that can't see you and Strike; a hit knocks it prone.");
    if (has(actor, "poison-weapon") && ctx.actions >= 1) n(`Poison Weapon (1 action): your prepared poison on the weapon, ${has(actor, "deadly-poison-weapon") ? "4d4" : has(actor, "improved-poison-weapon") ? "2d4" : "1d4"} poison on the next hit, no save.`);
    if (has(actor, "predictable") && ctx.actions >= 1) n("Predictable! (1 action): Perception against a foe's Deception DC for +1 or +2 AC and to your next save against it.");
    if (has(actor, "magical-trickster") && racket !== "eldritch-trickster") n("Magical Trickster: a spell attack that hits an off-guard foe adds your Sneak Attack once.");
    if (has(actor, "perfect-distraction") && ctx.actions >= 1) n(`Perfect Distraction (1 action): Sneak away and leave a decoy that draws attacks; 10 minutes to set up the next one${has(actor, "reactive-distraction") ? ". Reactive Distraction fires when an attack or effect would hit you: swap with the decoy, ending hidden or in cover" : ""}.`);
    if (has(actor, "hidden-paragon")) n("Hidden Paragon (reaction, once an hour) fires when your Hide or Sneak loses every foe: invisible for a minute, your attacks included.");
    if (has(actor, "powerful-sneak")) n("Powerful Sneak: precision immunity and resistance don't stop your Sneak Attack; after a Sneak, pick a foe that lost you: its next Sneak Attack dice count 3 at the least.");
    if (has(actor, "implausible-infiltration") && ctx.actions >= 2) n("Implausible Infiltration (2 actions): pass through a wood, plaster or stone wall or floor up to 10 feet thick, with no metal in it.");
    if (has(actor, "blank-slate")) n("Blank Slate: detection and scrying below counteract rank 10 don't find you.");
    if (has(actor, "eternal-confusion")) n("Eternal Confusion: a foe your Feint fools stays off-balance longer; check the feat's text for how long and what it costs it.");
    if (has(actor, "steal-spell")) n("Steal Spell: a Steal that works on a caster takes a spell slot from it for you to cast within 1d4 rounds.");
    if (has(actor, "the-harder-they-fall")) n("The Harder They Fall: a Trip on an off-guard foe deals 1d6, and your Sneak Attack on a critical success.");
    if (has(actor, "sly-disarm")) n("Sly Disarm: Disarm with Thievery; a success leaves the foe off-guard to your next attack this turn.");
    if (has(actor, "shove-down")) n("Shove Down (free action) after a successful Shove: Trip it where it lands.");
}

export { rogue };
