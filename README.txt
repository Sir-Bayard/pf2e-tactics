PF2e Tactics 3.0.0 (module id pf2e-tactics; it was pf2e-npc-tactics, "PF2e NPC Tactics", until 3.0)
Foundry VTT 14, Pathfinder 2e system 8.0 or later.

Two tools in one module: the GM's NPC turn card, and the players' Turn Helper.
They share one board reader and one advisor; neither shows a player anything
from an NPC's sheet.

WHAT IT DOES
When an NPC's turn starts, a window shows the GM how that creature can fight
well right now:
- A recommended turn, worked out from its abilities and the board: who it can
  reach and with how many actions, flanking with its allies, which player
  reactions (Reactive Strike and the like) a move would provoke, and the
  expected damage of each option against each target's AC and saves.
- Two or three alternatives, so you can pick something else in a second.
- Show draws the recommended path on your map, around any reactions it
  avoids. Only you see it: it's drawn in your client, not saved to the scene.
  Click Show again to hide it; it also clears on the next turn.
- Triggers to watch for (below), and the encounter's own tactics.
- Every Strike, action, reaction, free action, aura and spell it has, so
  nothing gets forgotten.
- The turn so far: actions used and attacks made, so the advice after a Stride
  or a Strike is for the actions it has left, at the right multiple attack
  penalty (below).
THE CARD
Laid out like the other table tools (Campaign Trackers, Campaign Ledger, NPC
Attitudes): the creature across the top (with how it thinks, say "Instinct ·
Int -4"; hover for what that means), the turn count under it, then cards. A
red edge is what to do now (the recommended turn, a trigger that just came
true), gold is reference: The Board, Tactics, Your Notes, Strikes and
Actions, Always On, spells. Click a card's title to fold it; each one stays
open or shut the way you left it (kept in your browser). Folded, a card still
shows a one-line summary. Chat whispers use the same layout.

Nothing is moved, attacked or cast for you. The GM decides. The one die it
rolls is a recharge ("can't use again for 1d4 rounds"), whispered to the GMs,
so the card knows when the ability is back. It is rolled once, from the
ability's own card. With PF2e Workbench's "Recharge reminder" on, Workbench
rolls it instead (its "Used Poison Breath" effect), and the card reads that
effect, so there is one roll and one timer. When a creature whose stat block
says a critical hit recharges its breath (Draconic Momentum) scores one, the
breath is ready again at once (Workbench's effect is removed too), and the GMs
are told.

It began as the NPC turn card of a campaign module (0.9.x); notes and
recharge timers from there carry over.

INSTALL
Easiest: in Foundry, Install Module, then paste
  https://github.com/Sir-Bayard/pf2e-tactics/releases/latest/download/module.json
into Manifest URL. Or by hand:
1. Unzip module.zip (from the latest release) into a new folder Data/modules/pf2e-tactics, so you end up with
   Data/modules/pf2e-tactics/module.json.
2. Enable "PF2e Tactics" in Manage Modules and reload.
   Coming from pf2e-npc-tactics (2.1 or earlier): turn the old module off (or
   delete its folder) and turn this one on. The first GM load copies the old
   module's settings over, and each player's client copies their own on first
   load. Notes, recharge timers and threat written under the old id are still
   read; new ones are written under pf2e-tactics. Other modules that look for
   "pf2e-npc-tactics" find the same API there while the old folder is still
   installed.

SETTINGS
NPC turn cards   Window (default), Chat whisper, or Off.
Whisper triggers On by default: a whisper to the GMs the moment a trigger
                 comes true, even on a player's turn.
Track threat     On by default (THREAT, below). Off: targets come from the
                 board alone.
How much threat counts   Lightly, Normal (default) or Strongly: how much
                 juicier the top threat looks (THREAT, below).
How fast threat fades    Halves each round (default), loses a quarter each
                 round, or never fades.
Threat lost when someone falls unconscious (%)   50 by default.

OPENING IT BY HAND
Macro: game.modules.get("pf2e-tactics").api.open()
Shows the selected token, or whoever's turn it is.

HOW IT READS ABILITIES
From PF2e's data first: action costs, traits, links to the basic actions
(Step, Stride, Strike, Shove...), condition links, checks, damage and area
templates in the description. From the wording second: "Strides twice",
"Steps 5 feet twice", "moves up to 60 feet without triggering reactions",
"makes two claw Strikes". So an ability like Elf Step replaces a plain Step
wherever a turn needs one, and Sudden Charge replaces Stride-then-Strike. Follow-ups such as Knockdown,
Strike variants such as Combat Grab, and self-buffs such as a frenzy are
weighed as whole turns. Turn order follows each ability's own traits and
wording: press (or "is suffering a multiple attack penalty") only after an
attack, open (or "hasn't attempted a Strike this turn") only first, flourish
once. An NPC ability can share a name with a Player Core feat and still work
differently (the ruffian's Combat Grab has no press), so the stat block wins.
Demoralize goes before the Strikes it helps. Pack Attack, Sneak Attack,
flanking, volley, deadly and fatal are counted.
Abilities that need a grabbed or restrained creature (Captive Rake, Swallow
Whole) are planned only on one, or after a Grab that could take hold. "A jaws
Strike with each of its heads, each against a different target" (Double Bite)
goes at different foes; "count as one attack", "the penalty increases only
after both" and the like are read for the multiple attack penalty; "two claw
Strikes and one horn Strike" is three Strikes. "All adjacent creatures" is a
5-foot emanation (Spore Cloud).
Each action on the card is tagged with what it does (movement, area, sets up,
follow-up...).

HOW IT READS THE BOARD
Only the scene that's open, on a square grid. It finds paths around walls and
enemies, counts difficult terrain from Regions (PF2e's environment feature or
a movement cost), and uses PF2e's own reach and ally/enemy rules.
- Closed doors: it goes through them, and opening one costs an action (an
  Interact, which ends the Stride it was on). The step says so: "Stride,
  opening a door on the way, into reach of Valeros". Locked doors stay shut.
  A Step can't go through a door.
- PF2e Terrains and PF2e Toolbelt regions: uneven ground, inclines (easy with
  a climb Speed) and hazardous terrain cost extra, like difficult terrain,
  and a plan whose path crosses them says so ("The way crosses uneven ground
  (Balance DC 15; off-guard on a failure)"). Toolbelt's difficult terrain
  counts too.
- Height: a token's elevation counts, the way PF2e measures it (10 feet up
  beside a Medium creature is 10 feet away; a Large creature reaches 5 feet
  higher). Reach, range, Reactive Strike and areas all use it, and The Board
  says how far above or below each foe is. A flier rises or drops to a foe's
  height as part of its Fly. A token whose movement is set to Fly and is
  above its floor is up in the air: it has to Fly every turn or fall, so a
  turn that stays up spends an action on it ("Fly in place, to stay up"),
  and flying off says how high it must go to be out of reach. A walker on a
  ledge or bank has three ways down: walk round by a ramp, Climb an incline
  (PF2e Terrains; 5 feet an action, each an Athletics check unless it has a
  climb Speed), or drop (half the drop in damage, lands prone, Stands, which
  provokes like any move in reach). Anything that thinks, animals included,
  counts a drop as an action dearer than it is and a reaction it sets off as
  half an action, a Climb by how often it would fail, and walks when that's
  no dearer: two actions and a fall lose to three on foot. Mindless creatures
  take the fewest actions and go over the edge on a tie (a mindless climber
  climbs). Going up needs a ramp, an incline or a climb Speed.
  A ramp is any region named ramp, slope, path, trail, steps, stairs,
  switchback, collapse or breach whose elevation has a set bottom and top at
  least 10 feet apart (say 0 to 10 for a path cut up a 10-foot bank), and
  that isn't an incline, a Change Level stair or hazardous terrain. Difficult
  terrain on it counts. Words in brackets in its name are left off the card
  ("The collapse (difficult terrain)" reads "the collapse"). The path shown
  goes by way of it.
  Regions are read at the creature's height (cold water at -20 only matters
  down there).
- Floors (Foundry 14 levels): walls belong to their level and paths use the
  creature's own; it can't reach through a floor; it sees creatures on another
  level only when its level looks onto theirs and the line between them
  doesn't pass through a floor (an archer at an upper window sees the yard,
  not the room under its feet). Foes it can't see on another floor are named
  on the card, and it goes to them by the stairs or a ladder: a Change Level
  region on its level that leads to theirs. Stairs are walked (their height
  counts as distance); a region named ladder, rope, hatch or trapdoor is
  climbed (5 feet an action, or its climb Speed), and the Stride to it and the
  one after it are separate. Close enough, it plans "Up the Stairs to Valeros"
  with its Strikes; otherwise it makes for them. The path shown stops at the
  stairs.
- What it's after: a neutral creature its tactics or your notes name, by its
  whole name ("the wolves are after the mules"), counts as a target, and The
  Board marks it "what it's after". It reads
the board when the card opens and again, while the card is showing, when a
token on that scene moves or someone there takes damage or gains a condition.
With no card showing it does nothing. On a hex or gridless scene it gives
advice from where the creature stands.

THE TURN HELPER (FOR PLAYERS)
A window for a player's own character, opened with the "PF2e Tactics: Turn
Helper" macro (in the PF2e Tactics Macros compendium: drag it to the hotbar).
It reads the board as that character can see it, on their turn or out of it.
- Your Turn (red edge): a recommended turn and up to three other options,
  worked out by the same advisor that runs the GM's NPCs, but on what the
  party can judge of each foe (ESTIMATES, below) and with the character's
  class read in (YOUR CLASS, below). Steps are in the player's terms: "Stride
  into reach of the wisp; Strike it twice with Maul (+9, +4)". Hidden foes
  are never the target unless nothing else stands, or the plan is an area or
  a reveal.
- Your Class: what the class and feats add that the turn should allow for
  (a banner's reach and who is in it, a stance, a shield not raised, Quick
  Alchemy, Exploit Vulnerability's standing bonus).
- Reach: who is in your reach, who can reach you, and whether a Step gets you
  clear (a Step never provokes).
- Strikes: each Strike and who it can target from here, the flat check a
  concealed (DC 5) or hidden (DC 11) target takes, cover, range increments
  and volley for ranged ones, and who a Stride would bring into reach.
- Flanking: who you flank now, and the foes you could flank with one or two
  moves and which ally that would be with; and who is flanking you.
- Moving: a foe that has shown a Reactive Strike this fight is named when
  moving away from it would provoke; before that, it only says a reaction is
  possible. Paths go round only the reactions the party has seen. Speed, and
  squares one move away with standard cover from everyone you can see.
- Foes: name, size, the conditions you can see, concealed/hidden state, cover,
  and what the party has learned of its AC from its own attack rolls this
  fight ("AC 17-19, 2 attacks"). Nothing from the NPC's sheet: no HP, saves,
  abilities, threat, tactics or notes.
- The turn so far (actions and attacks, with the same +/- steppers as the
  GM's card), when it is your turn.
Hidden and undetected foes follow the PF2e rules. A hidden foe (you know the
square, not the creature) is shown with its flat check and never offered as a
flank or Stride target; the card says to Seek first, unless it is the last
foe standing, or you have a reveal spell (revealing light, see the unseen,
faerie fire, glitterdust, true seeing) or an area that needs no flat check.
An undetected foe is not drawn or named at all; if its combatant is in the
tracker, one line says something is undetected and how to Seek for it. With
PF2E Visioner running, its per-observer states are used; without it, the
conditions on the token, the light and your senses decide.

ESTIMATES
The advice needs a foe's AC, saves and HP to weigh a turn. The helper never
reads them from the sheet. Instead, each foe is judged as a creature of the
party's level (GM Core's moderate numbers), then corrected by what the party's
own rolls have shown this fight: every hit and miss bounds its AC (the window
shows the bounds), every save it rolls shows its modifier outright, and its
HP comes from its token bar when the GM lets players see bars. The Your Turn
card says when the odds are estimates. The GM setting "Turn Helper: judge
foes by their real level" (off by default) lets the helper use each
creature's real level behind the scenes, for truer odds at the cost of a hint
about how tough things are; it is never shown.

YOUR CLASS
Fourteen classes are read from the character's own sheet, every feature and
feat from 1st to 20th level, keyed to the feature's slug, so the same feature
from an archetype (Sneak Attacker, a Barbarian Dedication's Rage, Basic
Hunter's Trick, a Wizard Dedication's Arcane Bond) is read the same way. Each
read sorts the class's material three ways: actions and math-changing features
become plans (scored on expected damage like the advisor's own) or marks on
the board the advisor then plans with; situational and higher-level features
become "when" notes that say what the feature would do on this board and when
it pays, only when its condition is close (a foe within Reach Spell's extra
range, two foes for Swipe, an ally with a condition for Mercy); pure passives
(proficiencies, saves, senses) say nothing. Feats read by the advisor from
their own text (Sudden Charge, Whirlwind Strike and the like) are set aside
when the class read handles them, so nothing is counted twice. Ancestry feats
and archetype feats that are actions still come through the advisor's text
reading at every level.
- Fighter: Vicious Swing, Double Slice (Agile Grace's -3/-6 at 10th, Graceful
  Poise), Slam Down and Crashing Slam, Intimidating Strike, Swipe, Whirlwind
  Strike, Sudden Charge, Lunge, Sever Space, Overwhelming Blow, Double Shot and
  Triple Shot; a "Strike, then press" plan that picks the best follow-up each
  action (Exacting Strike, Certain Strike, Brutish Shove, Dragging Strike,
  Combat Grab, Advantageous Assault, Shatter Defenses, Disarming Twist,
  Two-Weapon Flurry, Brutal Finish, Desperate Finisher, Weapon Supremacy's
  fourth action); notes for the parries, ripostes, shield feats, stances,
  Determination (spent or not) and Fearsome Brute.
- Barbarian: Rage, then Strikes with the Rage damage for your instinct and
  level (every instinct, the 7th- and 15th-level increases, giant's oversized
  weapon, animal's attacks even before you rage), Quick-Tempered, Mighty Rage,
  Scouring Rage; Thrash, Spirit's Wrath, Terrifying Howl, Giant's Stature and
  Lunge, Swipe, Whirlwind Strike, Unbalancing Sweep, Share Rage; while raging,
  concentrate actions without the rage trait leave the plans and the card
  says why; Furious Finish, Cleave, Dragon's Rage Breath, Come and Get Me,
  Renewed Vigor and the rest as notes with their moment.
- Ranger: Hunt Prey (every prey with Double Prey and Triple Threat, Swift
  Prey's free Hunt at 19th), then Strikes with your edge: Flurry's penalty
  and Masterful Hunter's, Precision's dice on the first hit and the later
  hits at 17th and 19th, Outwit's AC; Twin Takedown, Hunted Shot, Deadly Aim,
  Impossible Flurry, Impossible Volley, Hunter's Aim, Warden's Boon; Monster
  Hunter folded into the Hunt; Far Shot's range; notes for the companion
  feats, Disrupt Prey, Camouflage and the warden spells.
- Champion: your cause's reaction (all seven) with the aura's reach, the
  resistance or damage at your level and the feats that ride on it, Relentless
  (9th) and Exalted (11th) made concrete for your cause; Smite (its +3, +4 at
  master, +4/+6 against the opposite sanctification); Blessed Counterstrike
  and Gruesome Strike when the reaction has fired; Lay on Hands with Mercy
  (which conditions it can lift), Touch of the Void with Cruelty, Shields of
  the Spirit, Hero's Defiance; the oaths, auras, shield, armament and mount
  feats as notes.
- Rogue: Sneak Attack dice (from the sheet, so multiclass rogues count too)
  into every plan against an off-guard foe, with a note on which weapons don't
  carry them; Surprise Attack, Gang Up, Dread Striker mark foes off-guard with
  why; the racket (Ruffian's weapon rule, Scoundrel's Feint, Mastermind's
  Recall Knowledge then Strike, Eldritch Trickster's spells); Twin Feint with
  Twist the Knife, Instant Opening, Spring from the Shadows, Skirmish Strike;
  Debilitating Strike with each debilitation and when to pick which, Master
  Strike, Impossible Striker; notes for Nimble Dodge, Opportune Backstab,
  Sidestep, Stay Down, Cognitive Loophole and the rest.
- Commander: every tactic as a plan with its trigger read off the board
  (Pincer Attack, Double Team, Tactical Takedown, Coordinating Maneuvers,
  Passage of Lines, Protective Screen, Reload!, Shields Up!, Strike Hard!,
  End It!, The Bigger They Are, Pop Drop and Lock, Ready Aim Fire, Cry Havoc!,
  Bloody Guillotine and the rest), your own Strike on the leftover actions;
  the banner's reach (60 with Glorious Banner) and who is in it, how many
  tactics you can have prepared; Plant Banner, Rallying Banner, Set-Up Strike,
  Guiding Shot, Unsteadying Strike as plans; Drilled Reactions' responders.
  Squadmates are the player-owned allies on the scene.
- Magus: Spellstrike on the best melee Strike (and the best ranged one with
  Starlit Span), carrying a cantrip by default: a slot is spent whether or not
  the Strike lands. It recommends the slot spell only when the Strike is
  likely (60% or better) and the spell adds enough over the cantrip (3 plus
  its rank), or when the foe is nearly down, and always names the other
  choice. The hybrid study's conflux spell as the third action while Focus
  Points last, else Arcane Cascade (its +1/+2/+3) or the recharge; Expansive
  and Devastating Spellstrike's spill onto neighbours, Lunging Spellstrike,
  Spell Swipe, Whirlwind Spell, Recharging Flurry; notes for the parries,
  Spell Crash, Cascading Ray and the rest.
- Thaumaturge: Exploit Vulnerability first (Esoteric Lore against the foe's
  level DC, the odds, a known weakness if it beats the +2 + half level), then
  Strikes; once a foe is exploited, Intensify Vulnerability with your held
  implement's benefit, Twin Weakness; every implement's action (Chalice's sip
  and drain, Mirror's Reflection to flank with yourself, Wand's Fling Magic,
  Tome's free Recall Knowledge, the Amulet, Bell and Weapon reactions);
  Divine Disharmony, Root to Life, Implement's Assault; Scroll Thaumaturgy,
  Share Weakness, Cursed Effigy and the rest as notes.
- Alchemist: Quick Alchemy and the vials left (perpetual infusions free);
  make-and-throw a bomb of your top tier (one action with Quick Bomber), the
  best additive by its worth (Debilitating, Sticky, Sour, Unstable,
  Exploitive), splash on the foes around it (Calculated and Expanded Splash),
  Far Lobber and Uncanny Bombs' range, Double Brew's second bomb, Mega Bomb;
  Chirurgeon's elixirs on whoever is hurt (drunk, thrown with Healing Bomb or
  handed over); Mutagenist's mutagen up or not; Toxicologist's poison then
  Strike.
- Cleric: Divine Font (how many heals or harms are left, the 2-action range),
  heal on the ally who needs it most, harm with Channel Smite; Cast Down,
  Divine Weapon, Emblazon Armament, the domain spells (Fire Ray, Cry of
  Destruction, Weapon Surge and the rest) with Focus Points; Warpriest's
  Strikes and Cloistered's spells weighed against each other; Replenishment
  of War, Shield of Faith, Defensive Recovery and the higher feats as notes.
- Druid: the order and its order spell (Tempest Surge's clumsy, Cornucopia,
  Rising Surf, Untamed Shift's claws); Untamed Form against the nearest foe
  (the form for your rank and feats: animal, insect, dinosaur, aerial,
  elemental, plant, dragon, monstrosity, kaiju, nature incarnate; its attack,
  reach, AC and temporary HP, and whether three form Strikes beat your best
  cast for the rest of the fight), Healing and Explosive Transformation,
  Dismiss and what casting costs in a form; Command an Animal (Mature
  Companion's single command, Heal Animal, Side by Side's off-guard); a Summon
  beside a foe and the Sustain after; the spellshapes, Ley Line Conduit,
  Hierophant's Power as notes.
- Wizard: the arcane school's curriculum spells and school spells (Force
  Bolt, Hand of the Apprentice, Protective Wards as plans; the others when
  they fit), the thesis (Spell Blending, Spell Substitution, Staff Nexus,
  Improved Familiar Attunement); slots left by rank; Drain Bonded Item on the
  best spent spell (Bond Conservation, Superior Bond); cantrip or slot
  against the closest foe by the magus rule; Quickened Casting; Counterspell
  and Clever Counterspell; the spellshapes (Reach, Widen, Detonating,
  Scintillating and the rest) with the foes they would reach.
- Sorcerer: the bloodline, its blood magic and when it pays, bloodline spells
  with Focus Points; slots left by rank, which slot a foe is worth, signature
  spells and when a lower slot does the job; Sorcerous Potency's damage;
  Split Shot, Dangerous Sorcery, the spellshapes and the reactions that spend
  slots.
- Bard: Courageous Anthem (worth by the allies in reach of a foe), Lingering
  and Fortissimo Composition (Performance against the DC, the rounds or bonus
  by degree), Rallying Anthem, Dirge of Doom, Harmonize (an anthem and a Dirge
  at once), Symphony of the Muse, Courageous Advance/Assault/Onslaught,
  Vigorous Anthem, Hymn of Healing and its Sustain, Soothing Ballad, Symphony
  of the Unfettered Heart, Fatal Aria, Allegro; Martial Performance; Versatile
  Performance into Demoralize; the compositions already up (don't recast).
- Anyone: Battle Medicine on a hurt ally in reach (or yourself), with the DC
  and odds for your Medicine rank; Raise a Shield when a shield is carried;
  your reactions, listed, since the plans never spend them.
Still to come: Animist, Exemplar, Guardian, Gunslinger, Inventor, Investigator,
Kineticist, Monk, Necromancer, Oracle, Psychic, Runesmith, Summoner,
Swashbuckler, Witch. Their actions are read from text by the advisor meanwhile.

Setting (per player): "Turn Helper: open on my turn", off by default. On, the
window opens when your character's turn starts. The macro opens it any time
for the selected owned token, or your assigned character.

THE TURN SO FAR
While it's a creature's turn, the card counts what it has done and plans only
the actions it has left:
- Moving its token. Moves in a row add up, so dragging in pieces or with the
  arrow keys counts as the Strides the distance needs (5 feet is one action,
  a Step or a short Stride). Undo (Ctrl+Z) takes it back off. A move made as
  Fly, Swim, Climb or Burrow counts against that Speed, so a dragon's
  115-foot flight is one Fly, not three Strides.
- Strikes rolled (1 action, and one more attack for the multiple attack
  penalty). Rerolls and damage rolls don't count.
- Checks rolled as an action: Trip, Shove, Grapple, Escape, Demoralize, Seek...
  Trip, Shove, Grapple, Disarm, Reposition and Escape have the attack trait.
- Ability cards posted to chat, at their cost. The Strikes, movement and check
  an ability includes (Sudden Charge's Strides and Strike, Knockdown's Trip)
  don't count again, and Knockdown's Trip doesn't add to the MAP when the
  ability says so. A flourish used once isn't suggested again.
- The same breath, once-a-turn or flourish ability posted to chat twice in a
  turn (shown to the players again, or a double click) counts once.
- Spells posted to chat, at their cost (the lowest, for a spell like heal that
  takes 1 to 3 actions).
- The Balance or Climb check PF2e Terrains rolls as a token crosses uneven
  ground or an incline is part of that move, not an action of its own.
The −/+ buttons by "Actions" and "Attacks" put it right when it guesses wrong
(a creature pushed on its own turn, a spell cast with more actions), and the
arrow button starts the count again. The count is kept on your client for the
current turn only: a reload starts it at zero.

HOW CLEVER IT IS
How a creature picks its target depends on its Intelligence. The chip by its
name on the card says which kind it is.
- Instinct (mindless, or Int -4 or lower): takes the shortest way and doesn't
  route round anyone's reach (the card still says what a move provokes), goes
  for what's closest, won't walk away from a foe already at its jaws, and
  lashes back at whatever hurt it.
- Crude (Int -3 to +0): goes by what it can see. It goes for the foe in its
  face, one who looks hurt, one who's down or on their own, someone smaller,
  someone it could drop. It takes the shortest way unless going round a
  reach costs no more actions.
- Tactical (Int +1): flanks, focuses fire on foes its allies are already on,
  finishes off the hurt, goes for a kill it can make.
- Shrewd (Int +2): all that, and goes for healers and casters first.
- Sharp (Int +3 or more): all that, and knows real AC and saves.
Below Sharp it can't know anyone's real AC or saves. It guesses from what it
sees: the party's average, a point up for medium armor, two for heavy or a
raised shield, a point down for no armor. So the unarmored wizard looks
softer than the fighter, but not as soft as the numbers say.
It learns as the fight goes on: every attack its side makes on a foe shows a
bit of their real AC, and every save a foe rolls against its side a bit of
that save. After three looks a Crude, Tactical or Shrewd creature knows it
(a third of the way per look). Animals don't learn; Sharp ones knew already.
Kept on the combat, so it ends with the fight. Saves rolled through PF2e
Toolbelt's target helper count too.
It also sticks with whoever it attacked last (this round or last): they
count 12% more, "still on them", so it doesn't flit between equal targets.

Besides attacking:
- Buffs: a spell that gives its side a status bonus to attacks (Bless,
  Courageous Anthem) when at least two of them would get it, then the best
  attack it can make with the actions left.
- Healing: itself or an ally under half HP, with the two-action Heal when
  that reaches further or heals more. It won't heal undead with vitality or
  the living with void.
- Bringing an ally back: an ally down (dying or unconscious, not dead) is
  worth far more than its HP, because back on its feet it fights again. A
  thinking creature weighs it as about two rounds of that ally's attacks (half
  that for a crude one; animals don't), and will move to reach it.
- Potions and scrolls: a healing potion or elixir it carries is drunk when
  it's under half HP, or fed to a fallen ally beside it (draw and drink: two
  actions, one if it's in hand). Scrolls and wands are cast like its own
  spells, with an Interact more to draw them, but only a spell on one of its
  lists (its spellcasting's tradition), at that entry's DC and attack.
- Sustain: when it cast a sustained spell on an earlier turn of this fight,
  the card offers "Sustain it, then" the best of what's left, and every other
  plan says the spell ends. The advice has a Sustain button while there's a
  spell to Sustain: it uses PF2e's Sustain action (its chat card), counts the
  action, and plans the rest of the turn. Once Sustained (by the button or
  PF2e's action), the card stops offering it that round, and stops for good
  after a round without it (the spell ended).
- Shove: a Crude or cleverer creature with a free hand Shoves a foe into
  hazardous terrain (PF2e Terrains) or off the top of an incline, after as
  many Strikes as are worth the multiple attack penalty. Not a foe more than
  one size larger, and only as far as its own body reaches.
- Vicious: adversaries leave a downed foe alone (as GM Core advises) unless
  the tactics or your notes call it vicious or say it finishes off the fallen
  ("never finishes off the fallen" doesn't count). Then it goes on Striking
  them: each hit raises their dying value.
- Advance: when nothing is in reach this turn, it closes on its best target.
- Hold Back: when its best attack is next to worthless (a dagger thrown at
  -10), it keeps out of reach, takes cover or raises a shield, and readies.
- Hit and run: a Tactical or cleverer creature with a fly Speed (20 feet or
  more, and free to move) weighs where it ends its turn. Ending in reach of
  the party costs it what their Strikes would do, so it may Strike and then
  Fly out of reach ("straight up works if they can't fly or reach that
  high"), or line up a breath weapon from a square that doesn't leave it in
  the middle of them. Animals stay and fight.
- Break off: a thinking creature or an animal under a quarter of its HP,
  with no trigger saying what it does when hurt, gets away. Mindless ones
  never do, and nor does one whose tactics say it fights to the death or is
  fearless. Not while grabbed, or when it has nowhere to go. A blow to its
  morale offers it too: its leader falls (an ally two levels above it, or
  one called captain, chief, boss and the like) while it's under three
  quarters of its HP and of no great will (Wisdom +2 or less); half its side
  is down and it's under half HP; or it lost 40% of its HP since its last
  turn began and it's under half. Only those who fell in this fight count.
  The GM's call: the card offers it first and says why.

THREAT
Each creature in the fight remembers who has been a problem for it:
- Damage counts its amount (after resistances, from PF2e's damage cards).
- A save against someone's spell or ability counts what it left: slowed is
  about one hit's worth, paralyzed two, frightened under half; a success
  half that; shrugged off entirely, a little for being targeted. "A hit" is
  what one Strike does at the creature's level, so it stays in proportion
  from level -1 to 25. Saves rolled through PF2e Toolbelt's Target Helper
  count too.
- Healing one of its foes counts half the HP healed.
- Casting any spell gets every foe's attention: a cantrip a little (a fifth
  of a hit), a slot spell more (two fifths), on top of what it does to the
  ones it hits. Healing spells spread their threat from the HP healed instead.
- A miss counts 2; a Trip, Grapple, Shove, Demoralize and the like 1 to 3.
- Persistent damage counts for whoever set it going (whoever last hit the
  creature, within a few seconds of the condition going on).
It fades every round (setting). When someone falls unconscious, every
creature's threat on them drops by half (setting), so they aren't the first
target the moment they're back up. The Board shows the table as bars.
Threat works like aggro: it doesn't make a creature do something silly, but
when two targets are close, it goes for the one who has proven dangerous. At
Normal, the top threat counts as 35 to 50% more worth hitting than the numbers
alone say; someone with half the top threat gets a quarter of that, so it is
the clear leader that pulls. Areas count it for each threat they catch.
- Animals (Instinct) lash back at whatever hurt them (40%) and notice nothing
  else.
- Thinking creatures weigh it more the cleverer they are (Crude 35%, Tactical
  40%, Shrewd 45%, Sharp 50%), and they notice who is hurting their side:
  when a PC damages one of them, its allies note a share of it too (Crude a
  quarter, Tactical half, Shrewd 60%, Sharp three quarters). So the fighter
  dealing most of the damage, or the cleric keeping everyone up, draws the
  whole group's eye, not only the one being hit.
The setting halves it (Lightly) or doubles it (Strongly).
The Threat button on The Board sets it by hand: raise someone for a taunt or
a grudge, set someone to 0 to have it forget them, or Reset.
Not counted: damage typed straight onto a token's HP, and undoing damage from
its card doesn't take the threat back. Only the active GM's client writes it.
This replaces PF2e Threat Tracker for the tactics: you can turn that module
off (its panel and markers aren't copied).

RULES IT FOLLOWS (PF2e Remaster, checked against Archives of Nethys)
- Actions: 3, fewer when slowed or stunned. Paralyzed, unconscious,
  controlled or confused: it says so instead of planning. Fleeing: the way out.
- Its own conditions: prone means Stand first (a move action, so Reactive
  Strike), or fight from the ground at -2. Grabbed, restrained or immobilized:
  no moving, Escape is offered, manipulate actions need a DC 5 flat check.
  Fascinated: no concentrate actions. Stupefied: spells take a flat check.
- Multiple attack penalty, agile, press, flourish; maneuvers have the attack
  trait; Trip and Shove only on targets up to one size larger, and a critical
  failure leaves it prone. Grab is a Grapple check (Athletics vs Fortitude),
  Knockdown a Trip, neither with the MAP; Improved versions are free.
- Reactive Strike: moving (not Step), manipulate actions (spells with the
  manipulate trait, reloading), ranged attacks within reach.
- Flanking: both able to act, both with a melee attack and the foe in reach;
  never against all-around vision, and Deny Advantage against its level or
  lower. Flanking helps melee only.
- Cover: a creature on the line between them is lesser cover (+1 AC),
  standard if it's two sizes bigger than both; a wall across the line is
  standard cover, or no line at all if every corner-to-corner line is blocked.
  Take Cover upgrades it. Areas ignore lesser cover; standard and greater add
  to Reflex against them.
- Light and senses: dim light conceals to normal vision (DC 5 flat check),
  darkness hides (DC 11); low-light vision and darkvision see through them.
  Invisible creatures are hidden to anyone who can hear them. A creature that
  can't see the NPC is off-guard to its attacks. Hidden, undetected and
  concealed conditions you set are used as they are.
- Range increments (-2 each, six at most), volley, deadly and fatal dice,
  weakness, resistance and immunity, incapacitation (one degree better for a
  target above twice the spell's rank), persistent damage, Pack Attack,
  Sneak Attack, Demoralize (-4 without a shared language, never on a deafened
  target, done before the Strikes it helps), Feint.
- Tiny creatures and swarms move into others' spaces; swarm damage hits
  everyone in their space. A creature without a land or fly Speed swims,
  climbs or burrows.

WHAT IT DOESN'T KNOW
The ground's height where no token stands (it assumes a creature walks at its own height unless it
climbs or drops to a foe's), whether a player has already used their reaction
this round, whether a sustained spell is still up (unless you use PF2e's
Sustain action), which light a darkness spell's rank lets darkvision through (it
assumes the common rank 2 one), and anything not on the creature's sheet or
the scene. The encounter's tactics come first: if they say the creature wants
out, believe them over the numbers.

TRIGGERS
A line in an encounter's tactics, or in your notes, of the form
    Trigger: Bandit Captain, below 20 HP: calls the retreat and runs for the door.
is watched in combat. Who comes first, then the condition, then what
happens. Who matches whole words of a token's or actor's name ("the wolves"
finds Dire Wolf 2). Leave it out, or name a group no creature is called
("the gang"), and it belongs to every creature the tactics belong to. Conditions it
checks for itself:
    below 20 HP                 below half HP (a third, a quarter, 40%)
    the captain is down         one tough is down (any of them)
    the captain is below half HP   round 3
    alone                       half its allies are down
Anything else is shown on the card as a reminder to watch for.
When a trigger to run, flee or retreat comes true, the recommended turn
becomes the way out that provokes the fewest reactions (on a hex or gridless
scene, a reminder to leave, without the path). When it's a
surrender, the card says so instead of suggesting Strikes.

YOUR NOTES
Add (or Edit) on the Your Notes card. Kept on the world actor and shared by
all its tokens. Notes written by the older campaign module are read from there and moved
across the first time you save them.

FOR OTHER MODULES
game.modules.get("pf2e-tactics").api.registerSource({
    id, label, get(actor, token) => [{ title, html }] })
supplies tactics text for a creature (a campaign module can feed in each
encounter's written tactics this way).
api.plan(token) returns the candidate turns; api.profile(item) shows how an
ability was read; api.threat(token) its threat table this combat;
api.setThreat(token, { tokenId: value }) sets entries in it.
api.helper(token?) opens the Turn Helper for a player-owned token (or the
user's character); api.helperCard(actor, token) returns its HTML.

CHANGES
3.1.1
- The advisor's own text reading now steps aside for every action a class read plans
  (Vicious Swing, Swipe, Slam Down, Hunted Shot, Hunter's Aim, Skirmish Strike, Giant's
  Stature, Channel Smite, Cast Down and some eighty more), so the Turn Helper no longer
  lists the same action twice with two different numbers; names with apostrophes match
  their slugs. Found on the dev world with a scratch PC of each class beside two foes.
3.1.0
- YOUR CLASS covers fourteen classes at every level 1 to 20: Cleric, Druid, Wizard,
  Sorcerer and Bard are new; Fighter, Barbarian, Ranger, Champion, Rogue, Commander,
  Magus, Thaumaturge and Alchemist are read in full (every class feature and class feat
  in the PF2e 8.6.1 compendiums, Remaster names first with the Legacy names also read).
  Higher-level features come with when-notes that say what they do on this board and
  when it pays. Verified against a scratch PC of each class at levels 8 to 20.
- Rage damage corrected for superstition (3/7/13), elemental (4/6/12), ligneous and decay
  (6/10/18), bloodrager (2/4/8); Precision edge's later hits (17th, 19th) corrected.
- The advisor's text reading now also steps aside for Untamed Form, Untamed Shift and
  Command an Animal, which the druid read handles.
3.0.0
- The module id is now pf2e-tactics (folder and zip too). Settings carry over on first
  load; flags written under the old id are still read; the old id's API is mirrored while
  the old folder is installed.
- Fighter, Barbarian, Ranger and Champion in classes.mjs (YOUR CLASS), each checked
  against the iconic pregens (Valeros, Amiri, Ekundayo, Seelah) on the live board; a
  reactions line for every class; Twin Takedown, Double Slice, Smite, Rage and Hunt Prey
  plans; the advisor's own reading of those actions is set aside.
2.1.0
- Rogue read in classes.mjs: Sneak Attack dice from the sheet into every plan against an
  off-guard foe; Surprise Attack, Gang Up and Dread Striker mark foes off-guard to the
  rogue (named on the card with why); Mastermind's Recall Knowledge then Strike; Twin
  Feint; notes for the common reactions and riders. The class read now runs before the
  advisor plans, so its marks and dice count in every plan.
- A character's Strike damage comes from PF2e's own formula (runes, racket, weapon
  specialization, rage), asked for without rolling; creatures keep their stat-block
  rolls.
2.0.1
- Magus: Spellstrike carries a cantrip unless the slot spell is worth it (the Strike
  likely, the gain real, or the foe nearly down); the other choice is named either way.
2.0.0
- Renamed PF2e Tactics (the id stays pf2e-npc-tactics, so settings, flags and
  notes carry over).
- The Turn Helper now advises: a Your Turn card with a recommended turn and up
  to three other options from the advisor, run on what the party can judge of
  each foe (ESTIMATES): level-based numbers corrected by the party's own rolls
  this fight (AC bounds from hits and misses, save modifiers from the rolls,
  HP from the bar when players can see it). Paths go round only reactions the
  party has seen a foe use. A new GM setting, "Turn Helper: judge foes by
  their real level", off by default.
- Your Class: scripts/classes.mjs reads the character's class and feats.
  Commander (Pincer Attack, Double Team, Tactical Takedown, Gather to Me!,
  Drilled Reactions, the banner), Magus (Spellstrike, Arcane Cascade),
  Thaumaturge (Exploit Vulnerability, Regalia), Alchemist (Quick Alchemy),
  and Battle Medicine and Raise a Shield for anyone. The advisor's own reading
  of those abilities is set aside when the class module handles them.
- A PC's ranged Strikes no longer add Strength (half for propulsive, all for
  thrown); bombs count their flat damage, splash and persistent damage, so a
  bomb plan no longer scores NaN.
- readBoard takes { reactionsSeen } so a caller can drop reactions the party
  hasn't seen; the party's learning of NPC saves (combat flag "party").
1.10.0
- The Turn Helper, a window for players (THE TURN HELPER, above), opened by the new
  "PF2e Tactics: Turn Helper" macro in the PF2e Tactics Macros compendium, or on the
  player's own turn with the per-player setting "Turn Helper: open on my turn" (off by
  default). Reach, Strikes and their targets, flanking, what moving would provoke,
  cover, and the foes as the character sees them. Nothing from an NPC's sheet.
- The party's attack rolls now teach what the party knows of each NPC's AC this fight
  (combat flag "party"), kept apart from what the NPCs learn of the PCs ("learned").
  The GM's card is unchanged.
- The turn ledger (actions and attacks so far) now also runs on a player's own client
  during their character's turn, so the helper can show it. It is kept in memory, as
  the GM's is; nothing is written.
- A foe is only said to have a Reactive Strike once it has used one this fight (its
  chat card), so the helper never reads an NPC's sheet to warn about reactions.
- New file scripts/player.mjs; styles for the helper.
1.9.0
- The script is now several files in scripts/ (shared, reader, advisor, card, state,
  hooks), loaded by scripts/pf2e-npc-tactics.mjs. One module, as before; nothing it does
  has changed. The split is for reading and testing it: the node tests import the
  advisor straight from advisor.mjs (source/npt-tests/mod2.mjs re-exports the files).
- A macro compendium, "PF2e Tactics Macros", with "PF2e Tactics: NPC Turn Card" (GM):
  opens the card for the selected NPC tokens, or the current combatant, so a closed
  window is one click away. A player's Turn Helper macro will join it when the helper
  ships.
1.8.0 (the rest of the 20 Oct review)
- Step, then Stride: standing in someone's reach, it now plans a Step out of
  reach before the Stride, so an approach, a retreat or a Break off no longer
  walks through a Reactive Strike when five feet would have avoided it.
- Dropping a foe is weighed by the dice, not the average: the chance the
  plan's Strikes take them down ("likely drops", "could drop", "might drop"),
  damage past their HP counts half, and taking someone out of the fight is
  worth about two of its own hits.
- Conditions are valued on the same scale as hits (slowed or stunned about a
  hit, paralyzed two), at every level, so Fear, Slow and knockdowns compete
  with Strikes instead of losing to them as the levels climb.
- Flying up costs double (it's difficult terrain) and straight down half;
  "Fly up N ft" fits one action only within half its fly Speed.
- "Out of their reach" counts archers and casters: a foe who can shoot or
  cast at a square counts half as much as one who can reach it, and the fly
  off step says who can still shoot it.
- Break off is offered second, not first, to a creature two or more levels
  over the party or the last of its side, with a note that it's your call.
- A Shove off a ledge no longer charges the foe's fall damage to the shover.
- Flanking's -2 AC isn't applied to a ranged Strike variant.
- Other options show what they're worth here when that differs from their
  damage ("about 19.5, worth 7.7 here after 8.4 of risk"), so the
  recommendation never looks beaten by its own alternative.
- What the NPCs learn of a foe's AC is now read from the rolls: each hit
  bounds the AC from above and each miss from below (crits and critical
  misses by ten more), and the guessed AC is squeezed inside the bounds.
- Damage undone from its card takes its threat back.
- An encounter-wide trigger ("two wolves are down") whispers once, naming
  everyone it moves; the fallen aren't counted.
- PF2e's simple action cards (Stand, Take Cover, Raise a Shield, Interact,
  Step, Stride...) count in the turn so far by their glyph.
- The drawn path is cleared when the window closes, the combat ends or the
  token is deleted.
- The window re-plans only for changes the board reads (HP, conditions,
  positions, alliance), not every edit to an actor on the scene.
1.7.3 (from the 20 Oct review)
- Show on an area's aim point no longer pings every player's screen: it is
  drawn on the GM's client only, like the path.
- PF2E Visioner, when it is running, decides what the creature and its foes
  can see of each other (Hide, Sneak and Seek results, its own light reading).
  Hidden and undetected carry to every square the creature might move to; from
  its own square Visioner's answer stands. The Board shows what Visioner says.
  Without Visioner nothing changes. No dependency: it is read only if present.
- Mobility (NPC Core): a move of half its Speed or less doesn't trigger
  reactions; longer moves do. It was read as never provoking.
- The dying and unconscious still fill their squares; a plan no longer ends a
  move on top of a downed PC.
- A trigger line with two conditions ("X is down while Y is still on the
  bridge", "one tough is down and the other is hurt") is left to the GM to
  watch; it used to fire on the first clause alone. "Is out of reach" is no
  longer read as "is down", nor "is taken hostage".
- An airborne animal with an area ability no longer loses its whole plan to an
  error (the card said it could reach no one).
- Drinking a potion or using an elixir counts as two actions in the turn so
  far unless it was already in hand (draw, then use); - takes one back.
1.7.2 (from a live test of 1.7.1)
- Going up or down stairs counts as part of the Stride that reached them, even
  when Foundry's Change Level question takes a while to answer.
- Drinking a potion or using an elixir counts as an action in the turn so far
  (a scroll or wand is counted by its spell's card).
- A foe who is down isn't described as unable to see it.
- A Shove into hazardous terrain names it plainly ("into the Campfire (1d6
  fire)").
1.7.1
- Walking round by a ramp, path or collapse beats dropping off a ledge, for
  anything that thinks; a Climb counts by how often it would fail.
- Stairs and ladders to foes on another floor.
- Sustained spells (with a Sustain button on the advice), healing potions and
  elixirs, scrolls and wands.
- It learns AC and saves as it sees them, and sticks with its last target.
- Morale: a fallen leader, half its side down, or a beating since its last
  turn.
- Shove into hazardous terrain or off a ledge; vicious creatures finish the
  fallen.
1.7.0
- Height: elevation counts for reach, range, areas and Reactive Strike. Fliers
  come down to fight and fly up out of reach by a stated height, and stay up
  only by Flying each turn. Walkers drop off ledges or climb inclines (PF2e
  Terrains) to reach a foe. Regions are read at the creature's height.
- Foundry 14 levels: walls and paths on the creature's own level, no reach
  through a floor, and foes on another floor seen only when nothing's between.
- Reviving a fallen ally is worth far more than healing HP, for creatures
  that think.
- PF2e Workbench's recharge reminder is used when it's on (one roll), and a
  breath or once-a-turn card posted twice in a turn counts once.
1.6.0 (from a high-level live test with dragons, demons, devils and linnorms)
- Threat works like aggro: a percentage on top of what an attack is worth,
  so it still matters at level 20 (before, its fixed few points were lost in
  high-level damage). Cleverer creatures weigh it more, and notice who hurts
  their allies.
- Hit and run for clever fliers, and areas weigh where the creature ends up.
- Monster Core recharges ("[[/gmr 1d4 #Recharge]]") are rolled, once per use;
  Draconic Momentum's critical hit recharges the breath.
- A flight counts as Fly actions, not Strides; fliers can plan up to 240 feet.
- Captive Rake and other abilities that need a grabbed foe; Double Bite;
  Draconic Frenzy's three Strikes; Spore Cloud as an area; more ways of
  writing the multiple attack penalty.
- Much faster for big fliers with many area spells (an ancient spellcaster
  dragon went from 14 seconds to under one).
- Fixes from a second review: a held creature keeps its Swallow Whole and
  similar plans; area plans pay for the Reactive Strikes they walk through at
  what those Strikes are worth; exposure counts only foes that can act.
1.5.0 (from a live test in Foundry)
- Closed doors no longer stop a plan: it opens them, at an action each.
- PF2e Terrains (uneven ground, inclines, hazardous terrain) and Toolbelt's
  difficult terrain are read, and plans say what their path crosses. The
  Balance and Climb checks those regions roll count as part of the move.
- Spells cast count toward the turn's actions again.
- New plans: buff its side, heal itself or an ally, advance when nothing is
  in reach, hold back when its attacks are hopeless, break off when badly
  hurt. Flee advice makes sense when no one is left to flee from.
- Neutral creatures its tactics name ("after the mules") are targets.
- Persistent damage gives threat to whoever set it.
- Wording: "Stride ×2 into reach of" for abilities too, "Slowed 1" not
  "Slowed 1 1", no full stop at the end of trigger chips, and the card's
  summary line says HP for a heal rather than damage.
- Fixes from a second review: a door mid-move costs the rest of that Stride
  as well; a buff or heal plans its follow-up attack with the actions left;
  Break off isn't offered while grabbed or cornered; Hold Back stays within
  the actions left; a PC healing themselves gets threat again; terrain notes
  see every square of the path; a terrain check no longer splits the move
  around it; objectives match the creature's whole name, not one word of it;
  door checks are cached, so a scene full of doors stays quick.
1.4.2
- Casting a spell gets every foe's attention, not just the ones it hits
  (Electric Arc on two wolves now registers with the archer too). Spell casts
  weren't being recognised at all in 1.4.0 and 1.4.1: PF2e's spell card has a
  "spell-cast" context, which the check missed, so buffs counted nothing.
1.4.1
- Add or Edit for your notes sits on the Your Notes card, like Show and
  Threat, and the card folds even when it's empty. Refresh stays at the bottom.
1.4.0
- The card is laid out like Campaign Trackers: a header strip, the turn
  count, then cards that fold and remember it (THE CARD). Titles in title
  case. About half the height of 1.3.0 for the same creature.
- Threat counts more than damage: saves against spells and abilities (what
  they left on it), buffs like bless, and saves rolled through PF2e Toolbelt.
- Threat drops when someone falls unconscious; the GM can set or reset a
  creature's table (Threat button); settings for on/off, weight, fading and
  the drop.
1.3.0
- Intelligence tiers for who it goes for (HOW CLEVER IT IS): crude creatures
  go by what they see, healers and casters come first from Int +2, and below
  Int +3 a target's AC and saves are guessed from its armor, not known. Every
  enemy no longer piles onto the lowest AC.
- Threat built in (THREAT): who hurt it, healed its foes or attacked it
  sways its choice. No need for PF2e Threat Tracker.
- The card says how the creature thinks, shows the threat table, and gives
  the reasons for the target picked (top threat, in its face, could drop).
- Crude creatures (Int 0 or lower) take the shortest way, like animals.
1.2.2
- The turn count's Actions and Attacks buttons sit in one row under the
  count instead of stacking down the side.
1.2.1 (fixes from a second review of 1.2.0)
- Spell attacks and Escape take the multiple attack penalty from attacks
  already made this turn.
- Animals take the safe path when it costs no more actions, so they no
  longer provoke Reactive Strike for nothing or lose a flanking square.
  They still never take a longer way round.
- The turn tracker: a move that comes with a check (Tumble Through, Climb,
  Sneak, Swim, Balance, the jumps, Squeeze, Maneuver in Flight) counts once;
  an ability's included Strikes, move and check only cover what comes
  straight after it (a Trip rolled as plain Athletics after Knockdown counts
  as Knockdown's); moves more than 4 seconds apart are separate actions; the
  count survives someone joining or leaving the fight mid-turn.
- Quickened creatures get their fourth action.
- A follow-up like Knockdown is offered right after a hit only if the Strike
  that hit lists it.
- Smaller fixes: api.turn() reads the current turn; "ignores difficult
  terrain" no longer counts as leaving difficult terrain; aiming an area no
  longer favours squares in enemy reach.
1.2.0
- Counts the actions and attacks a creature has used this turn and plans the
  rest, with -/+ buttons to correct it (THE TURN SO FAR).
- Animals and mindless creatures fight on instinct (HOW CLEVER IT IS).
- Area abilities: where to aim now counts what the actions left after it are
  worth, so a breath from where it stands with a bite after it beats walking
  somewhere to breathe on two others. Difficult terrain an area leaves behind
  counts for a little.
1.1.0
- Cones and lines count distance like movement (every second diagonal is 10
  feet). 1.0.0 measured a straight line, so a cone could seem to reach a
  creature 20 feet away on two diagonals.
- When the path goes round someone's reach to avoid a reaction, the step says
  so ("the long way round, keeping out of Valeros's reach").
- Show draws the path on your map, visible only to you.
1.0.0
- First release: the turn card split out of a campaign module.
