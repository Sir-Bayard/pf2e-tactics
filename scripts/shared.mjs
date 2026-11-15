/**
 * PF2e Tactics: shared.mjs
 *
 * Constants and small helpers every file uses, and window memory for the module's windows. One module, several files:
 * see pf2e-tactics.mjs for the whole.
 */
const MODULE_ID = "pf2e-tactics";
const FLAG_SCOPE = MODULE_ID;
/** A flag of this module's on a document (getFlag throws for an inactive module's scope, so the raw flags are the fallback). */
const flagOf = (doc, key) => {
    let v;
    try { v = doc?.getFlag?.(MODULE_ID, key); } catch { v = undefined; }
    return v ?? doc?.flags?.[MODULE_ID]?.[key];
};
const POSITION_KEY = `${MODULE_ID}.window`;
const GLYPHS = { 1: "1", 2: "2", 3: "3", reaction: "r", free: "f" };

const esc = (t) => foundry.utils.escapeHTML(String(t ?? ""));
const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);
const cap = (s) => String(s ?? "").charAt(0).toUpperCase() + String(s ?? "").slice(1);
const link = (doc, label) => (doc?.uuid ? `@UUID[${doc.uuid}]{${esc(label ?? doc.name)}}` : esc(label ?? doc?.name));
const glyph = (key) => (GLYPHS[key] ? `<span class="action-glyph">${GLYPHS[key]}</span>` : "");
const costGlyph = (n) => (n >= 1 && n <= 3 ? glyph(n) : "");
const ul = (items) => (items.length ? `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>` : "");
const section = (title, inner, cls = "") => (inner ? `<section class="npt-section ${cls}"><h4>${title}</h4>${inner}</section>` : "");

/** The world actor behind a token, so notes are shared by every token of it. */
const baseActorOf = (actor) => (actor?.isToken ? game.actors.get(actor.id) ?? actor : actor);

function setting(key, fallback) {
    try { return game.settings.get(MODULE_ID, key); } catch { return fallback; }
}

/* ------------------------------------------------------------------ */
/* Window memory                                                      */
/* ------------------------------------------------------------------ */

/**
 * The same code is in each of the author's modules. A window made with rememberWindow keeps the size and place the
 * user gives it, in this browser, and comes back from minimized whole: Foundry's restore animation can stall at the
 * title bar's height (seen on 14.370, core windows too) and Foundry sets the size while it runs, which would leave a
 * restored window a strip.
 */

/** Wait for an element's own transitions to end; a hidden tab pauses them, so after a second they're finished by hand. */
async function settleWindow(el) {
    const anims = el?.getAnimations?.() ?? [];
    if (!anims.length) return;
    await Promise.race([Promise.all(anims.map((a) => a.finished.catch(() => null))), new Promise((r) => setTimeout(r, 1200))]);
    for (const a of el.getAnimations?.() ?? []) {
        try {
            a.finish();
        } catch {
            /* an animation that can't finish (infinite) is left alone */
        }
    }
}

/**
 * Give an ApplicationV2 class window memory.
 * @param {typeof ApplicationV2} Base
 * @param {string} key          localStorage key for this window
 * @param {object} [opts]
 * @param {boolean|"width"} [opts.size] what to keep besides the place: true for width and height, "width" for a window
 *   whose height fits its content, false for a window sized wholly by its content
 */
function rememberWindow(Base, key, { size = true } = {}) {
    const MIN_W = 240, MIN_H = 120;
    const load = () => {
        let v;
        try {
            v = JSON.parse(globalThis.localStorage?.getItem(key) ?? "null");
        } catch {
            return {};
        }
        if (!v || typeof v !== "object") return {};
        const W = globalThis.innerWidth ?? 1920, H = globalThis.innerHeight ?? 1080;
        const out = {};
        // A size below the minimum was saved while the window was collapsed: ignore it.
        if (size === true && v.width >= MIN_W && v.height >= MIN_H) {
            out.width = Math.min(v.width, W);
            out.height = Math.min(v.height, H);
        } else if (size === "width" && v.width >= MIN_W) out.width = Math.min(v.width, W);
        const w = out.width ?? MIN_W, h = out.height ?? MIN_H;
        if (Number.isFinite(v.left)) out.left = Math.max(0, Math.min(v.left, W - w));
        if (Number.isFinite(v.top)) out.top = Math.max(0, Math.min(v.top, H - h));
        return out;
    };
    let timer = null;
    const save = (position) => {
        // Copy now: Foundry hands over its own live position object, which may change before the save runs.
        const pos = { left: position.left, top: position.top, width: position.width, height: position.height };
        clearTimeout(timer);
        timer = setTimeout(() => {
            try {
                const v = { left: pos.left, top: pos.top };
                if (size) v.width = pos.width;
                if (size === true) v.height = pos.height;
                globalThis.localStorage?.setItem(key, JSON.stringify(v));
            } catch {
                /* no storage: the window opens where Foundry puts it */
            }
        }, 300);
    };

    return class extends Base {
        #beforeMin = null;
        #restoring = false;
        #restore = null;

        constructor(options = {}) {
            super(foundry.utils.mergeObject({ position: load() }, options, { inplace: false }));
        }

        /** Restore a minimized window before drawing it: a draw that ends while it's collapsed takes the title bar's size. */
        async render(options = {}, _options = {}) {
            if ((this.minimized || this.#restore) && (options === true || options?.force)) {
                const open = this.rendered;
                await this.maximize();
                // Closed while it was being restored: don't open it again.
                if (open && !this.rendered) return this;
            }
            return super.render(options, _options);
        }

        async minimize() {
            if (!this.minimized && this.rendered) {
                const auto = this.options.position ?? {};
                this.#beforeMin = {
                    width: auto.width === "auto" ? "auto" : this.position.width,
                    height: auto.height === "auto" ? "auto" : this.position.height,
                };
            }
            return super.minimize();
        }

        maximize() {
            // A restore already under way is the one to wait for.
            if (this.#restore) return this.#restore;
            if (!this.minimized) return super.maximize();
            this.#restore = this.#restoreWhole().finally(() => (this.#restore = null));
            return this.#restore;
        }

        async #restoreWhole() {
            const was = this.#beforeMin;
            this.#restoring = true;
            try {
                const pending = super.maximize();
                for (const a of this.element?.getAnimations?.() ?? []) {
                    try {
                        a.finish();
                    } catch {
                        /* nothing to finish */
                    }
                }
                await pending;
                await settleWindow(this.element);
                // Not if it was closed or minimized again meanwhile.
                if (was && this.rendered && !this.minimized) this.setPosition(was);
            } finally {
                this.#restoring = false;
            }
        }

        /** Remember the size and place the user gives the window (not while it's minimized or being restored). */
        _onPosition(position) {
            super._onPosition?.(position);
            if (!this.rendered || this.minimized || this.#restoring) return;
            if (![position.left, position.top].every(Number.isFinite)) return;
            if (size && !(position.width >= MIN_W)) return;
            if (size === true && !(position.height >= MIN_H)) return;
            save(position);
        }
    };
}

/** Does PF2e hide NPC names that a token's nameplate doesn't show (its "Tokens Determine NPC Name Visibility" setting)? */
function tokensSetNames() {
    try { return !!game.settings.get("pf2e", "metagame_tokenSetsNameVisibility"); } catch { return false; }
}
/** Can players see this token's name? PF2e's own getter ignores its setting, so the setting is checked here. */
const playersSeeName = (tokenDoc) => !tokensSetNames() || tokenDoc?.playersCanSeeName !== false;
/** Can every player see this chat card? A whispered or blind one teaches the party nothing. */
const playersSee = (message) => !message?.blind && !((message?.whisper?.length ?? message?.whisper?.size ?? 0) > 0);

export { FLAG_SCOPE, MODULE_ID, POSITION_KEY, flagOf, baseActorOf, cap, costGlyph, esc, link, playersSee, playersSeeName, rememberWindow, tokensSetNames, section, setting, signed, ul };
