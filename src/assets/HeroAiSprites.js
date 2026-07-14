// HeroAiSprites — the six deterministic Blender hero bodies, pixelated into
// one 9-frame sheet per direction under assets/hero/:
//   cols: idle0, idle1(blink), walk0, walk1(rise), walk2, cast, hurt,
//         death, victory
//   files: <hero>_down.png / <hero>_up.png / <hero>_side.png
//
// Every bespoke silhouette selects its own Blender-exported attachment tree.
// If a bespoke trio fails to load, that hero safely falls back to the monkey
// base + palette tint while keeping the monkey attachment contract. Character
// feature overlays (ears/tusks/horns/hood/hat) are composited at build time.
//
// loadHeroAiSprites() NEVER rejects; getAiHeroFrames() returns null until the
// sheets load (and permanently on failure), and ProceduralSprites.getHeroFrames
// falls back to the procedural body — the game always renders.

import { SPRITE_SIZE } from '../config/GameConfig.js';
import { drawHeroFeatureOverlay } from './PixelArt.js';
import { applyHeroAttachmentTransform } from './HeroPose.js';
import {
    HERO_POSE_ATTACHMENTS,
    HERO_POSE_ATTACHMENTS_BY_HERO,
} from './HeroPoseData.js';

const DIRS = ['down', 'up', 'side'];
const COLS = 9;
// col index per pose/frame — matches tools/blender/render_sheets.py POSE_COLS.
const POSE_COLS = { idle: [0, 1], walk: [2, 3, 4], cast: [5], hurt: [6], death: [7], victory: [8] };
const REPLACEABLE_HEADWEAR_FEATURES = new Set(['hat', 'horns', 'hood']);

// Heroes that ship a BESPOKE Blender body sheet set (distinct proportions +
// baked palette) beside the shared monkey base. A hero not listed here — or one
// whose set fails to load — falls back to the monkey base + a palette tint, so
// the roster never breaks.
const BESPOKE = ['elf', 'orc', 'wizard', 'berserker', 'assassin'];

const _heroSheets = {};   // heroId -> { down, up, side: Image }  (only if all 3 loaded)
let _loadPromise = null;
let _ready = false;       // true after monkey loaded and all bespoke requests settled
const _heroCache = new Map();   // hero id + native/cosmetic headwear -> built dirs set

function loadSheet(heroId, dir) {
    return new Promise((resolve) => {
        try {
            const im = new Image();
            im.onload = () => resolve(im);
            im.onerror = () => resolve(null);
            im.src = new URL(`./hero/${heroId}_${dir}.png`, import.meta.url).href;
        } catch (e) { resolve(null); }
    });
}

// Load one hero's 3-direction set; registers it only if ALL three loaded.
async function loadHeroSet(heroId) {
    const imgs = await Promise.all(DIRS.map((d) => loadSheet(heroId, d)));
    if (imgs.every(Boolean)) {
        _heroSheets[heroId] = { down: imgs[0], up: imgs[1], side: imgs[2] };
        return true;
    }
    return false;
}

// Kick the sheet loads; resolves true once the monkey base and every optional
// bespoke request have settled. Keeping `_ready` false for that whole window
// prevents a hero requested mid-load from caching the monkey fallback forever.
export function loadHeroAiSprites() {
    if (_loadPromise) return _loadPromise;
    _loadPromise = (async () => {
        const monkeyOk = await loadHeroSet('monkey');
        await Promise.all(BESPOKE.map(loadHeroSet));
        _heroCache.clear();
        _ready = monkeyOk;
        return _ready;
    })();
    return _loadPromise;
}

// Slice one frame col from a sheet into a SPRITE_SIZE canvas, tint it toward
// the hero palette (mirrors the fur-cosmetic tint), and composite the hero's
// feature overlay through the same exported head-seat transform as catalog
// hats. This keeps ears, tusks, horns, hoods and native hats attached through
// the authored death/victory tilts as well as idle/walk/cast/hurt motion.
function buildFrame(sheet, col, char, dir, pose, frameIdx, skipTint, attachments) {
    const cw = Math.floor(sheet.width / COLS);
    const cv = document.createElement('canvas');
    cv.width = SPRITE_SIZE; cv.height = SPRITE_SIZE;
    const cx = cv.getContext('2d');
    cx.imageSmoothingEnabled = false;    // crisp pixel upscale
    cx.drawImage(sheet, col * cw, 0, cw, sheet.height, 0, 0, SPRITE_SIZE, SPRITE_SIZE);
    // Palette tint: when a hero is drawn on the shared MONKEY base its warm
    // brown is washed toward that hero's fur colour. A hero with its OWN
    // bespoke sheet already bakes its palette (skipTint) — re-tinting would
    // muddy it — so the tint only runs on the base-fallback path.
    const fur = char?.palette?.fur;
    if (!skipTint && fur && char.id !== 'monkey') {
        cx.globalCompositeOperation = 'source-atop';
        // Hues near the base's warm brown (elf/orc greens) need a stronger
        // wash to survive the warm in-game player-light halo — those heroes
        // carry a per-character tintAlpha; the default 0.38 keeps the far
        // hues (purple/red/navy) subtle.
        cx.globalAlpha = char.tintAlpha || 0.38;
        cx.fillStyle = fur;
        cx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
        cx.globalCompositeOperation = 'source-over';
        cx.globalAlpha = 1;
    }
    // Feature overlay (elf ears / tusks / horns / hood / hat).
    if (char?.feature) {
        // The feature art is authored on the canonical neutral monkey grid.
        // Pose-local character motion stays inside that asset, while the
        // segment transform below maps the whole overlay onto this exact
        // Blender body's current head. No fixed-grid feature can float behind.
        const ov = drawHeroFeatureOverlay(
            { palette: char.palette, accent: char.accent, feature: char.feature },
            dir, 0, pose, frameIdx);
        if (ov) {
            const current = attachments?.[dir]?.[pose]?.[frameIdx];
            const assetNeutral = HERO_POSE_ATTACHMENTS?.[dir]?.idle?.[0];
            const half = SPRITE_SIZE / 2;
            cx.save();
            cx.translate(half, half);
            applyHeroAttachmentTransform(cx, {
                attachments: current,
                assetNeutralAttachments: assetNeutral,
            }, 'headSeat');
            cx.drawImage(ov, -half, -half, SPRITE_SIZE, SPRITE_SIZE);
            cx.restore();
        }
    }
    return cv;
}

// Build (once per hero) the { kind, dirs } set from the loaded sheets, or null
// if the sheets aren't ready / failed — caller falls back to procedural.
export function getAiHeroFrames(id, char, suppressReplaceableHeadwear = false) {
    if (!_ready) return null;
    const suppressFeature = suppressReplaceableHeadwear
        && REPLACEABLE_HEADWEAR_FEATURES.has(char?.feature);
    const cacheKey = `${id}:${suppressFeature ? 'cosmetic-headwear' : 'native-headwear'}`;
    if (_heroCache.has(cacheKey)) return _heroCache.get(cacheKey);
    let set = null;
    try {
        // Bespoke body if this hero shipped one (palette baked → skip tint);
        // otherwise the shared monkey base recoloured by the palette tint.
        const own = _heroSheets[id];
        const sheets = own || _heroSheets.monkey;
        const skipTint = !!own;
        const dirs = {};
        // Wizard hats, berserker horns and assassin hoods are identity
        // headwear, not anatomy. When a catalog hat is equipped, omit that
        // baked-on code overlay so two silhouettes never occupy one head.
        // Elf ears and orc tusks remain because they are anatomy.
        const renderedChar = suppressFeature ? { ...char, feature: null } : char;
        // Resolve the body contract before frame construction because native
        // identity features use its pose-local head seat during compositing.
        const attachments = own
            ? HERO_POSE_ATTACHMENTS_BY_HERO[id]
            : HERO_POSE_ATTACHMENTS;
        if (!attachments) throw new Error(`Missing pose attachments for ${id}`);
        for (const dir of DIRS) {
            const sheet = sheets[dir];
            const d = {};
            for (const pose in POSE_COLS) {
                d[pose] = POSE_COLS[pose].map((col, i) => buildFrame(
                    sheet, col, renderedChar, dir, pose, i, skipTint, attachments));
            }
            dirs[dir] = d;
        }
        // A bespoke silhouette consumes the anchors exported from that exact
        // Blender parameter preset. Missing bespoke data rejects this tier and
        // lets ProceduralSprites take its safe monkey-contract fallback.
        set = {
            kind: 'pixel',
            dirs,
            attachments,
            assetAttachments: HERO_POSE_ATTACHMENTS,
        };
    } catch (e) { set = null; }
    _heroCache.set(cacheKey, set);
    return set;
}
