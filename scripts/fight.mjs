/**
 * PF2e Tactics: fight.mjs
 * The GM's window for this fight (T40): what the party has learned and seen of each foe, as the Turn Helper uses it, with
 * a button to take back anything wrong, and the switch that says a foe has been identified (T19).
 *
 * What it reads and writes, all on the combat (so it goes with the fight):
 *   flags["pf2e-tactics"].party[tokenId] = { ac, fortitude, reflex, will: { n, lo, hi } }   the party's rolls (state.mjs)
 *   flags["pf2e-tactics"].seen[tokenId] = { r: [reaction names], d: ["cast", "ranged", "heal"] } (player.mjs)
 *   flags["pf2e-tactics"].unseen[tokenId] = { r: [...], d: [...] }   what the GM took back here; a new sighting undoes it
 *   flags["pf2e-tactics"].identified[tokenId] = true   its creature traits are on the helper's board (a successful
 *     Recall Knowledge sets it too, record.mjs noteIdentify)
 */
import { MODULE_ID, esc, flagOf, labelAttr, rememberWindow, safe, tipAttr } from "./shared.mjs";
import { keyboardWindow } from "./kit/keyboard.mjs";

const DID_TEXT = { cast: "casts spells", ranged: "attacks at range", heal: "heals" };
const SAVE_TEXT = { fortitude: "Fortitude", reflex: "Reflex", will: "Will" };

/** The foes in this fight, in turn order: NPC combatants no player owns. */
function foesOf(combat) {
    const seen = new Set();
    const list = combat?.turns?.length ? combat.turns : (combat?.combatants?.contents ?? [...(combat?.combatants ?? [])]);
    return list.filter((c) => {
        if (!c.tokenId || seen.has(c.tokenId) || !c.actor || c.actor.hasPlayerOwner || c.actor.type !== "npc") return false;
        seen.add(c.tokenId);
        return true;
    });
}

/** "AC 18 to 22 (3 rolls)", "+12 (1 roll)": the bounds in words. */
function boundsText(v, prefix = "") {
    if (!v || typeof v !== "object" || !(v.n > 0)) return null;
    const lo = Number.isFinite(v.lo) ? v.lo : null, hi = Number.isFinite(v.hi) ? v.hi : null;
    const rolls = `${v.n} roll${v.n === 1 ? "" : "s"}`;
    if (lo !== null && hi !== null) return `${prefix}${lo === hi ? lo : `${lo} to ${hi}`} (${rolls})`;
    if (lo !== null) return `${prefix}${lo} or more (${rolls})`;
    if (hi !== null) return `${prefix}${hi} or less (${rolls})`;
    return `${prefix}not narrowed yet (${rolls})`;
}

function fightHtml(combat) {
    if (!combat?.started) return `<p class="npt-dim">No fight is running.</p>`;
    const party = flagOf(combat, "party") ?? {};
    const seen = flagOf(combat, "seen") ?? {};
    const unseen = flagOf(combat, "unseen") ?? {};
    const identified = flagOf(combat, "identified") ?? {};
    const foes = foesOf(combat);
    if (!foes.length) return `<p class="npt-dim">No foes in this fight.</p>`;
    const remove = (tok, kind, key, what) => `<button type="button" class="npt-fight-x" data-fight-remove="${esc(tok)}" data-fight-kind="${esc(kind)}" data-fight-key="${esc(key)}"${labelAttr(`Take back: ${what}`)}><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>`;
    const rows = foes.map((c) => {
        const tok = c.tokenId;
        const name = c.token?.name ?? c.name ?? c.actor.name;
        const p = party[tok] ?? {};
        const items = [];
        const ac = boundsText(p.ac, "AC ");
        if (ac) items.push(`<li>${esc(ac)} ${remove(tok, "party", "ac", `${name}'s AC`)}</li>`);
        for (const s of ["fortitude", "reflex", "will"]) {
            const v = p[s];
            if (!v || !(v.n > 0)) continue;
            const t = Number.isFinite(v.lo) && v.lo === v.hi ? `${SAVE_TEXT[s]} ${v.lo >= 0 ? "+" : ""}${v.lo} (${v.n} roll${v.n === 1 ? "" : "s"})` : `${SAVE_TEXT[s]} ${boundsText(v)}`;
            items.push(`<li>${esc(t)} ${remove(tok, "party", s, `${name}'s ${SAVE_TEXT[s]}`)}</li>`);
        }
        const gone = unseen[tok] ?? {};
        for (const r of (seen[tok]?.r ?? []).filter((x) => !(gone.r ?? []).includes(x))) items.push(`<li>Reaction seen: ${esc(r)} ${remove(tok, "r", r, `${name}'s ${r}`)}</li>`);
        for (const d of (seen[tok]?.d ?? []).filter((x) => !(gone.d ?? []).includes(x))) items.push(`<li>Seen: ${esc(DID_TEXT[d] ?? d)} ${remove(tok, "d", d, `${name} ${DID_TEXT[d] ?? d}`)}</li>`);
        const isId = !!identified[tok];
        const idBtn = `<button type="button" class="npt-fight-id" data-fight-identify="${esc(tok)}" aria-pressed="${isId ? "true" : "false"}" aria-label="${esc(`${name}: identified`)}"${tipAttr("Identified: its creature traits (undead, construct, mindless...) are on the Turn Helper's board. A successful Recall Knowledge on it sets this too.")}><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i> Identified</button>`;
        return `<section class="npt-fight-foe"><div class="npt-fight-head"><h3>${esc(name)}</h3>${idBtn}</div>${items.length ? `<ul>${items.join("")}</ul>` : `<p class="npt-dim">Nothing learned or seen yet.</p>`}</section>`;
    });
    return `<div class="npt-card npt-fight"><p class="npt-dim">What the party has learned and seen this fight, as the Turn Helper uses it. Take back anything that's wrong (an attack taken for a Reactive Strike, a roll against the wrong foe).</p>${rows.join("")}</div>`;
}

/** Take something back: a learned number, or a reaction or action seen. */
async function takeBack(combat, tok, kind, key) {
    if (!game.user?.isGM || !combat) return;
    if (kind === "party") {
        await combat.update({ [`flags.${MODULE_ID}.party.${tok}.${key}`]: new foundry.data.operators.ForcedDeletion() });
        return;
    }
    if (kind !== "r" && kind !== "d") return;
    // one list written, not the whole record, so a sighting written at the same moment isn't lost
    const list = [...(flagOf(combat, "unseen")?.[tok]?.[kind] ?? [])];
    if (list.includes(key)) return;
    await combat.update({ [`flags.${MODULE_ID}.unseen.${tok}.${kind}`]: [...list, key] });
}

/** The identify switch. */
async function setIdentified(combat, tok, on) {
    if (!game.user?.isGM || !combat) return;
    if (on) await combat.update({ [`flags.${MODULE_ID}.identified.${tok}`]: true });
    else await combat.update({ [`flags.${MODULE_ID}.identified.${tok}`]: new foundry.data.operators.ForcedDeletion() });
}

let FightWindow = null;
let fightWindow = null;
function fightClass() {
    if (FightWindow) return FightWindow;
    const { ApplicationV2 } = foundry.applications.api;
    // Remembers its place and width; works from the keyboard (ownKeys off: its buttons change the fight)
    FightWindow = class extends keyboardWindow(rememberWindow(ApplicationV2, { module: MODULE_ID, name: "fight", size: "width" }), { module: MODULE_ID, scope: ".npt-window", ownKeys: false }) {
        static DEFAULT_OPTIONS = {
            id: `${MODULE_ID}-fight`,
            classes: ["npt-window", "npt-fight-window"],
            window: { title: "What the Party Knows", icon: "fa-solid fa-book-open", resizable: true },
            position: { width: 380, height: "auto" },
        };
        async _renderHTML() { return fightHtml(game.combat); }
        _replaceHTML(result, content) {
            if (result === this._shown && content.childElementCount) return;
            this._shown = result;
            content.innerHTML = result;
            Object.assign(content.style, { maxHeight: "78vh", overflowY: "auto" });
            content.querySelectorAll("[data-fight-remove]").forEach((b) => b.addEventListener("click", async (ev) => {
                ev.preventDefault();
                b.disabled = true;
                try { await takeBack(game.combat, b.dataset.fightRemove, b.dataset.fightKind, b.dataset.fightKey); }
                catch (err) { console.warn(`${MODULE_ID} | couldn't take it back`, err); ui.notifications?.warn(safe`PF2e Tactics couldn't change the fight's record.`); b.disabled = false; }
            }));
            content.querySelectorAll("[data-fight-identify]").forEach((b) => b.addEventListener("click", async (ev) => {
                ev.preventDefault();
                try { await setIdentified(game.combat, b.dataset.fightIdentify, b.getAttribute("aria-pressed") !== "true"); }
                catch (err) { console.warn(`${MODULE_ID} | couldn't change the identify switch`, err); }
            }));
        }
    };
    return FightWindow;
}

async function openFight() {
    if (!game.user?.isGM) return ui.notifications?.warn("What the Party Knows is the GM's window.");
    fightWindow ??= new (fightClass())();
    await fightWindow.render({ force: true });
}

Hooks.on("updateCombat", (combat, changes) => {
    if (!fightWindow?.rendered || combat !== game.combat) return;
    const f = changes.flags?.[MODULE_ID];
    if (f && ("party" in f || "seen" in f || "unseen" in f || "identified" in f || Object.keys(f).some((k) => k.startsWith("-=")))) fightWindow.render();
    else if ("started" in changes || "round" in changes) fightWindow.render();
});
for (const hook of ["createCombatant", "deleteCombatant", "deleteCombat"]) Hooks.on(hook, () => { if (fightWindow?.rendered) fightWindow.render(); });

export { fightHtml, foesOf, openFight, setIdentified, takeBack };
