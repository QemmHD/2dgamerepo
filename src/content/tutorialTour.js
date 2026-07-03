// tutorialTour — step data for the guided MENU tour (the second half of the
// full tutorial: the guided FIRST RUN teaches the moment-to-moment loop with
// contextual hint pills; this tour then walks every menu tab so a new player
// gets a complete rundown of the whole game, start to finish).
//
// Each step targets one tab: the tour switches to it, spotlights it in the tab
// bar, and shows a card with the title + lines. Advancing is Next/Skip only —
// while the tour is up all other menu input is ignored (see Game._menuAction),
// so the player can't wander mid-lesson. Visiting a step marks its tab seen,
// which is what permanently unlocks the staged menu by the end of the tour.
//
// Pure data — no DOM, no imports — so a headless harness can import it freely.

export const TOUR_STEPS = [
    {
        tab: 'play',
        title: 'Welcome to the Forge',
        lines: [
            'This is your base camp. From here you pick a hero — each of the six',
            'monkeys has its own signature power — then a biome, an optional Patron,',
            'a difficulty, and stackable Trials that forge a Pact for bigger rewards.',
            'START RUN begins a vigil; DAILY ROAD is a curated once-a-day challenge.',
        ],
    },
    {
        tab: 'skills',
        title: 'Skills — permanent power',
        lines: [
            'Coins you bank from runs buy PERMANENT upgrade levels here: max HP,',
            'damage, crit, speed, XP gain and more. They apply to every future run.',
            'You start with a 2,000-coin stake — investing a few levels now makes',
            'your early vigils noticeably smoother. Costs climb with each level.',
        ],
    },
    {
        tab: 'shop',
        title: 'Shop — cases, forge & mines',
        lines: [
            'Cases turn coins into gear and cosmetics. Every case shows its exact',
            'odds, and a pity counter guarantees a Rare+ before too long. The Ember',
            'Forge gambles for gear directly, and MINES is a coin mini-game — dig',
            'safe tiles, cash out before you hit a mine. Spend boldly; earn it back.',
        ],
    },
    {
        tab: 'loadout',
        title: 'Loadout — your gear',
        lines: [
            'Gear from cases equips here in four slots: Starting Weapon (your wand),',
            'Trinket, Armor, and Charm. Each piece grants small permanent buffs —',
            'the card text says exactly what. Higher rarities roll stronger bonuses.',
        ],
    },
    {
        tab: 'character',
        title: 'Character — make it yours',
        lines: [
            'Cosmetics live here: fur, cloak, accessory, aura and trail, with a live',
            'preview. They come from cosmetic cases, coin purchases, and achievements.',
            'Prestige skins carry animated VFX — pure style, zero stats.',
        ],
    },
    {
        tab: 'attune',
        title: 'Attune — relic mastery',
        lines: [
            'On runs you\'ll light Wick Shrines and claim relics. Defensive relics',
            'you\'ve discovered can be ATTUNED here with coins — a permanent, always-on',
            'echo of their power. It\'s the long-game coin sink for veterans.',
        ],
    },
    {
        tab: 'battlepass',
        title: 'Battle Pass — play to claim',
        lines: [
            'Every run earns pass XP. Levels along the track hold coins, cases and',
            'cosmetics — tap CLAIM when a tier lights up. No purchases, no timers:',
            'it fills purely by playing.',
        ],
    },
    {
        tab: 'stats',
        title: 'Stats — records & achievements',
        lines: [
            'Lifetime records, today\'s trials, and the achievement wall live here.',
            'Achievements pay coins — and some unlock exclusive cosmetics. Check the',
            'daily trials each day for quick bonus goals.',
        ],
    },
    {
        tab: 'settings',
        title: 'Settings — comfort & control',
        lines: [
            'Audio volumes, screen shake, damage numbers, and a reduced-effects mode',
            'for weaker phones. You can REPLAY this tutorial from here any time —',
            'or reset the save entirely if you want a fresh forge.',
        ],
    },
    {
        tab: 'play',
        title: 'You\'re ready',
        lines: [
            'That\'s the whole forge. Survive waves, grab shards, level up, light',
            'shrines, defeat the three bosses of a biome to claim it — then push',
            'deeper biomes, harder difficulties and Pacts. Good luck out there. 🔥',
        ],
    },
];
