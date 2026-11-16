# PF2e Tactics: the Turn Helper

The players' window: a recommended turn for their own character, on what the party can judge of each foe, with their class read in. Back to the [front page](../README.md); the GM's side is in [the GM's guide](gm-guide.md).

## The turn helper (for players)

A window for a player's own character, opened with the "PF2e Tactics: Turn Helper" macro (in the PF2e Tactics Macros compendium: drag it to the hotbar). It reads the board as that character can see it, on their turn or out of it. It advises a turn; it doesn't repeat the character sheet, so your HP, AC, saves, Speed and Strike bonuses stay on the sheet.

- **Your Turn** (green edge): a recommended turn, worked out by the same advisor that runs the GM's NPCs, but on what the party can judge of each foe (see [Estimates](#estimates)) and with the character's class read in (see [Your class](#your-class)). Steps are in the player's terms: "Stride into reach of the wisp; Strike it twice with Maul (+9, +4)". Up to three other options sit folded under it, each with a few words on why it came second. Hidden foes are never the target unless nothing else stands, or the plan is an area or a reveal. When the turn moves you or aims an area, **Show** draws the route on your map (only you see it; click again to hide it). The route goes round only the reactions the party has seen this fight: a Reactive Strike nobody has seen yet is a surprise for the character too.
- **Worth Knowing**: the three notes from your class and feats that bear most on this turn (one that names a foe on the board or something in the recommended turn comes first; standing reminders like your reactions come last); the rest fold away.
- **Around You**: who can reach you and whether a Step gets you clear; moving away from a foe that has shown a Reactive Strike this fight; who you flank now, who you could flank with one or two moves and with which ally, and who is flanking you; squares one move away with standard cover from everyone you can see.
- **Foes**: name (or "a Medium foe" when PF2e's Tokens Determine NPC Name Visibility hides it), size, concealed or hidden, cover, the conditions you can see with their values ("frightened 2"), the effects showing on its token, what those do to its AC, what the party has learned of its AC from its own attack rolls this fight ("AC 17-19, 2 attacks"), and the reactions it has used. Nothing from the NPC's sheet: no HP, saves, abilities, creature type, threat, tactics or notes.
- Each turn the helper opens with only Your Turn unfolded; open another card and it stays open for the rest of that turn.
- The turn so far (actions and attacks, with the same +/- steppers as the GM's card), when it is your turn.
- For a magus, a Spellstrike button: PF2e doesn't track whether Spellstrike is charged, so the helper reads your Spellstrike, recharge and conflux cards, and the button sets it by hand when you rolled a Spellstrike without its card.

**What the helper remembers this fight.** What the party has seen each foe do (a reaction it used, an attack it made outside its own turn, a spell it cast, a ranged attack, a heal) is kept on the combat by the GM's client, so every player's helper knows it and a reload doesn't lose it; a foe counts as able to do these only once someone has seen it. An attack outside its own turn counts as a Reactive Strike after 8 seconds, unless its own turn started or ended within 8 seconds of the roll (the GM moving the tracker on). The GM can take back anything wrong in What the Party Knows. A whispered or blind roll shows the players nothing, so it teaches the helper nothing. Each character's own record (Spellstrike charged or spent, the foe a thaumaturge exploited, the chalice drained, the wand boosted, the foes it has Demoralized or asked a Pointed Question, which are immune for 10 minutes) is kept on the character from its own chat cards, and is cleared from the character when the combat ends.

Hidden and undetected foes follow the PF2e rules. A hidden foe (you know the square, not the creature) is shown with its flat check and never offered as a flank or Stride target; the card says to Seek first, unless it is the last foe standing, or you have a reveal spell (revealing light, see the unseen, faerie fire, glitterdust, true seeing) or an area that needs no flat check. An undetected foe is not drawn or named at all; if its combatant is in the tracker, one line says something is undetected and how to Seek for it. On a scene with token vision, a foe the character has no line of sight to (behind a wall, in a room nobody has opened) counts as undetected, and a foe on another floor isn't mentioned at all. On a player's screen Foundry's own vision decides too: a token it isn't showing them counts as undetected, such as an invisible foe, one in darkness they can't see in, or one only another of their tokens can see while that token is selected (select this character's token). With PF2E Visioner running, its per-observer states are used; without it, the conditions on the token, the light and your senses decide.

What the helper leaves out is left out of the window, not out of the browser: the GM's notes, the encounter's tactics, threat and what NPCs have learned live on actors and the combat, which Foundry sends to every player's browser, where the console can read them.

## Estimates

The advice needs a foe's AC, saves and HP to weigh a turn. The helper never reads them from the sheet. Instead, each foe is judged as a creature of the party's level (the median of that level among the PF2e system's own creatures, worked into a formula; nothing is copied from a book), then corrected by what the party's own rolls have shown this fight: every hit and miss bounds its AC (the window shows the bounds), every save it rolls shows its modifier outright, and its HP comes from its token bar when the GM lets players see bars. What the table can see on it counts too: the conditions on it and the effects showing on its token (frightened 2 is 2 off its AC and every save; off-guard, 2 off its AC), and the party's bounds are kept net of what showed when each roll was made, so they still hold when the condition wears off. Its creature traits (undead, construct, mindless...) stay off the board until it's identified: the GM's switch in What the Party Knows, or a successful Recall Knowledge on it, rolled with PF2e's Recall Knowledge action with the foe targeted. The Your Turn card says when the odds are estimates. The GM setting "Turn Helper: judge foes by their real level" (off by default) lets the helper use each creature's real level behind the scenes, for truer odds at the cost of a hint about how tough things are; it is never shown.

## Your class

The Turn Helper reads all twenty-nine classes from the character's own sheet, every feature and feat from 1st to 20th level, and a dedication's features the same way. A feature that changes the turn becomes a plan; one that matters only sometimes becomes a note when its moment is close; passives stay quiet.

| Class | What the helper plans around |
|---|---|
| Alchemist | Quick Alchemy bombs and their additives; elixirs for the hurt; mutagens and poisons |
| Animist | Your primary apparition's vessel spell, Sustained while it pays |
| Barbarian | Rage, then Strikes with your instinct's damage |
| Bard | Which composition to play, and when Harmonize or Dirge of Doom pays |
| Champion | Your cause's reaction and aura, Smite, Lay on Hands |
| Cleric | Divine Font heals or harms, Channel Smite, domain spells |
| Commander | Each tactic whose trigger the board meets, and your banner's reach |
| Druid | Untamed Form weighed against your Strikes and spells; order spells |
| Exemplar | Where your divine spark sits, and which transcendence pays |
| Fighter | Double Slice, Sudden Charge, and the best follow-up after a first Strike |
| Guardian | Taunt the foe most likely to hurt an ally, from where you can Intercept |
| Gunslinger | The reload economy and your way's deeds |
| Inventor | Overdrive, and unstable actions with their flat check |
| Investigator | Devise a Stratagem: what each roll is worth before you commit it |
| Kineticist | Elemental Blast or an impulse, overflow last |
| Magus | Spellstrike with a cantrip, or a slot spell when it clearly pays; the conflux spell after |
| Monk | Flurry of Blows in your stance |
| Necromancer | A thrall beside a foe, then spells cast from its square |
| Oracle | Cursebound feats, with what the next curse stage costs |
| Psychic | Amped psi cantrips and Unleash Psyche |
| Ranger | Hunt Prey, then Strikes with your hunter's edge |
| Rogue | Sneak Attack on whoever is off-guard to you, and how to make them so |
| Runesmith | Trace, then Invoke the rune worth most |
| Sorcerer | Which slot a foe is worth, and when blood magic pays |
| Summoner | Act Together with your eidolon on the shared actions |
| Swashbuckler | Panache, Strikes, then a finisher |
| Thaumaturge | Exploit Vulnerability, then your implement |
| Witch | One hex a turn; the free cantrip hex when it's enough |
| Wizard | School spells, Drain Bonded Item, spellshapes |

Every character also gets Battle Medicine, Raise a Shield and a list of their reactions (the plans never spend them).

**Companions and summons.** Command an Animal (or Sustain a summon), then your best two actions at the same foe, as one turn. A minion is yours when it names you as its master (set `flags.pf2e.master` on a companion to be sure) or the same player owns it.

**Spell thrift.** A slot spell is recommended only when it beats your best damaging cantrip by enough. The bar rises with the slot's rank and falls as more slots of that rank remain. Scrolls, wands and staves (through PF2e Dailies) are weighed the same way. Setting (per player): "Turn Helper: spell thrift": Frugal, Normal (default) or Free-spending.

**Sheet setup a few classes need.**

- Animist: PF2e doesn't record your primary apparition. The helper takes the vessel spell that's up, else the first on the sheet; set `flags["pf2e-tactics"].primaryApparition` to its name to choose.
- Runesmith: PF2e ships no rune items. Name feats or effects for your runes ("Atryl, Rune of Fire"), or set `flags["pf2e-tactics"].runes = { known: ["atryl", ...], tattoo: "esvadir" }`. Without either you get notes only.
- Necromancer: thralls are found among your allies by the thrall trait or name.
- Commander: your squadmates are the player-owned allies on the scene.

Setting (per player): "Turn Helper: open on my turn", off by default. On, the window opens when your character's turn starts. The macro opens it any time for the selected owned token, or your assigned character.
