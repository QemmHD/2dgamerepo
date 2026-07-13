// tutorialTour — step data for the guided MENU tour (the second half of the
// full tutorial: the guided FIRST RUN teaches the moment-to-moment loop with
// contextual hint pills; this tour then walks every menu tab so a brand-new
// player — assumed to have never played a game like this — gets a plain-English
// rundown of the whole game, with every term defined.
//
// Each step targets one tab: the tour switches to it, spotlights it in the tab
// bar (plus the step's key control), and shows a card with the title + lines.
// Advancing is Next/Skip only. Keep each `lines` array to <= 5 lines (the card
// sizes to fit) and write for someone who does NOT know gaming words.
//
// Pure data — no DOM, no imports — so a headless harness can import it freely.

export const TOUR_STEPS = [
    {
        tab: 'play',
        title: 'What this screen is',
        highlightAction: 'startRun',
        lines: [
            'Welcome! This is your home base — you come back here between tries.',
            'One try is called a "run": you drop into the world and stay alive',
            'against waves of enemies for as long as you can. On this screen you',
            'pick your character and where to go, then press START RUN to begin.',
        ],
    },
    {
        tab: 'modes',
        title: 'Modes — fresh ways to face the dark',
        lines: [
            'After your first run, this screen opens daily and weekly challenges.',
            'Daily Road gives everyone the same route; Rite Trial chooses your hero.',
            'Boss Rush skips the waves for back-to-back apex fights, while Weekly',
            'Ember gives every player the same shuffled boss order for the week.',
        ],
    },
    {
        tab: 'skills',
        title: 'Skills — get permanently stronger',
        highlightAction: 'buyUpgrade',
        lines: [
            'When a run ends, the coins you collected are saved and shown here.',
            'Spend them to permanently raise things like your health, your damage,',
            'and how fast you move. These boosts stay forever, on every future run,',
            'so the game gets easier the more you play. You start with 2,000 coins —',
            'go ahead and buy a level or two before your first run.',
        ],
    },
    {
        tab: 'shop',
        title: 'Shop — spend coins on cases & games',
        highlightAction: 'openCase',
        lines: [
            'A "case" is a surprise box: you pay coins and get one random reward.',
            'The coloured bar on each case shows your exact chances of each quality,',
            'and a counter guarantees a good one if you\'ve had bad luck for a while.',
            'MINES is an optional little coin game. None of this costs real money —',
            'it all runs on the coins you earn by playing.',
        ],
    },
    {
        tab: 'boutique',
        title: 'Boutique — try a look before buying',
        lines: [
            'The Boutique sells individual cosmetic pieces and matching themed sets.',
            'Try anything on first: the preview changes, but your saved look does not.',
            'Buying uses only coins earned in the game, and cosmetics never add power.',
            'Pieces earned from the Vigil Path or achievements stay clearly marked.',
        ],
    },
    {
        tab: 'loadout',
        title: 'Loadout — the equipment you carry',
        lines: [
            'Whatever gear you win from cases gets equipped here, in four slots:',
            'your starting weapon, plus a trinket, some armour, and a charm.',
            'Each piece gives a small permanent bonus — the exact bonus is written',
            'right on its card. Better-quality pieces give bigger bonuses.',
        ],
    },
    {
        tab: 'character',
        title: 'Character — change how you look',
        lines: [
            'These are "cosmetics" — they only change how your character looks',
            '(its fur, cape, hat and glow). They never change how the game plays;',
            'they\'re purely for style. You unlock them from cases, achievements,',
            'or buy them in the BOUTIQUE — try looks on there before you pay.',
        ],
    },
    {
        tab: 'attune',
        title: 'Attune — advanced, save for later',
        lines: [
            'During runs you\'ll find "relics" — special one-run powers. Once you\'ve',
            'discovered a relic, you can spend coins here to keep a little of its',
            'power on you permanently. This is a deep, late-game way to use spare',
            'coins — you can safely ignore it until you\'ve played a while.',
        ],
    },
    {
        tab: 'battlepass',
        title: 'Battle Pass — free rewards for playing',
        lines: [
            'Every run earns points that fill this track. Each level you reach holds',
            'a free reward — coins, a case, or a cosmetic — that you tap to claim.',
            'There\'s no purchase and no time limit: it simply fills up as you play,',
            'so just keep playing and check back to collect what you\'ve earned.',
        ],
    },
    {
        tab: 'stats',
        title: 'Stats — your records & goals',
        lines: [
            'This page remembers your best results and your lifetime totals.',
            'It also lists "achievements" — one-time goals (like "defeat a boss")',
            'that pay out coins, and some unlock exclusive looks. Daily goals',
            'live on the MODES screen — "Today\'s Trials" refresh there each day.',
        ],
    },
    {
        tab: 'settings',
        title: 'Settings — comfort & options',
        highlightAction: 'replayTutorial',
        lines: [
            'Adjust the music and sound volume, turn screen shake on or off, and',
            'switch on a lighter-effects mode if the game runs slowly on your phone.',
            'You can replay this whole tutorial any time from the button here —',
            'and there\'s a full reset if you ever want to start over from scratch.',
        ],
    },
    {
        tab: 'play',
        title: 'You\'re all set',
        lines: [
            'That\'s the whole game. In a run: move to dodge enemies, collect the',
            'glowing shards they drop to grow stronger, grab relics, and defeat',
            'the area\'s bosses. When your health runs out the run ends — then you',
            'come back here, spend your coins, and go again a little stronger.',
            'Press NEXT to finish. Have fun out there! 🔥',
        ],
    },
];
