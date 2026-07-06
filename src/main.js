import { Renderer } from './systems/Renderer.js';
import { GameLoop } from './core/GameLoop.js';
import { Game } from './core/Game.js';
import { Input } from './core/Input.js';
import { KeyboardInput } from './core/KeyboardInput.js';
import { TouchJoystick } from './core/TouchJoystick.js';
import { prewarmSprites, getGlowSprite } from './assets/ProceduralSprites.js';
import { loadLpcSprites } from './assets/LpcSprites.js';
import { loadWorldTextures } from './assets/WorldTextures.js';
import { loadIconGlyphs } from './assets/CustomIcons.js';
import { loadMonsterSprites } from './assets/MonsterSprites.js';
import { loadEnemyAiSprites } from './assets/EnemySprites.js';
import { loadHeroAiSprites } from './assets/HeroAiSprites.js';
import { clearHeroFrameCache, clearDecorationCache } from './assets/ProceduralSprites.js';
import { loadObstacleSprites } from './assets/ObstacleSprites.js';
import { loadDecorSprites } from './assets/DecorSprites.js';
import { loadRenderedProps } from './assets/RenderedWeaponProps.js';
import { WEAPON_AURA } from './content/weapons.js';
import { WEAPON_FX_GLOWS } from './systems/WeaponSystem.js';
import { COSMETICS } from './content/cosmetics.js';
import { PRISM_COLORS } from './assets/CosmeticFx.js';

// ── Loading splash ──────────────────────────────────────────────────────
// A purely procedural ember animation (no asset — nothing to download) shown
// while the multi-MB art set loads, so the first paint on GH Pages / mobile
// is an alive forge instead of a blank black canvas. Draws in raw device px
// (reads canvas.width each frame, so a resize mid-load stays correct) with
// plain fills only — no gradients, no images. Stopped right before the real
// game loop starts.
function startSplash(canvas) {
    const ctx = canvas.getContext('2d');
    const t0 = performance.now();
    let raf = 0, on = true;
    const draw = () => {
        if (!on) return;
        const w = canvas.width, h = canvas.height;
        const t = (performance.now() - t0) / 1000;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#0a0e16';
        ctx.fillRect(0, 0, w, h);
        const cx = w / 2, cy = h / 2, u = Math.min(w, h);
        // Rising embers: a fixed ring of drifting sparks, phase-offset per index.
        for (let i = 0; i < 14; i++) {
            const ph = i * 2.399;                       // golden-angle de-sync
            const rise = ((t * 0.12 + i * 0.0713) % 1); // 0 (bottom) → 1 (top)
            const ex = cx + Math.sin(t * 0.7 + ph) * u * (0.16 + (i % 5) * 0.05);
            const ey = cy + u * 0.30 - rise * u * 0.52;
            const a = Math.sin(rise * Math.PI) * 0.55;  // fade in/out over the rise
            if (a <= 0.02) continue;
            ctx.globalAlpha = a;
            ctx.fillStyle = i % 3 ? '#ff8a3a' : '#ffd06a';
            ctx.beginPath();
            ctx.arc(ex, ey, u * 0.006 + (i % 3) * u * 0.002, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
        // Wordmark + status line + a breathing hearth dot.
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffb43a';
        ctx.font = `800 ${Math.round(u * 0.075)}px -apple-system, system-ui, Helvetica, Arial, sans-serif`;
        ctx.fillText('EMBERWAKE', cx, cy - u * 0.03);
        ctx.fillStyle = 'rgba(255,233,168,0.7)';
        ctx.font = `600 ${Math.round(u * 0.026)}px -apple-system, system-ui, Helvetica, Arial, sans-serif`;
        ctx.fillText('stoking the forge…', cx, cy + u * 0.05);
        ctx.globalAlpha = 0.5 + 0.4 * Math.sin(t * 3);
        ctx.fillStyle = '#ff7a1e';
        ctx.beginPath();
        ctx.arc(cx, cy + u * 0.12, u * 0.011, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        raf = requestAnimationFrame(draw);
    };
    draw();   // first frame synchronously — instant first paint
    return { stop() { on = false; cancelAnimationFrame(raf); } };
}

async function boot() {
    const canvas = document.getElementById('game');
    if (!canvas) {
        throw new Error('Canvas element #game not found');
    }

    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());

    const renderer = new Renderer(canvas);
    // Splash up FIRST (Renderer has sized the canvas): the ember loading
    // animation runs while sprites prewarm + the art set downloads below.
    const splash = startSplash(canvas);
    const keyboard = new KeyboardInput();
    const touch = new TouchJoystick(renderer);
    const input = new Input({ keyboard, touch });

    // Orientation lock must be requested from a user gesture; try once on the
    // first interaction (succeeds on Android / installed PWA, harmless no-op
    // on iOS Safari where the CSS-rotate-when-portrait fallback fills instead).
    const tryLock = () => {
        renderer.tryLockLandscape();
        window.removeEventListener('touchstart', tryLock);
        window.removeEventListener('pointerdown', tryLock);
    };
    window.addEventListener('touchstart', tryLock, { passive: true });
    window.addEventListener('pointerdown', tryLock, { passive: true });

    // Drop an in-progress joystick drag if the screen rotation flips, so a
    // stale touch origin can't produce a bogus steer across the convention.
    renderer.onOrientationChange = () => touch.reset();

    let game;
    const loop = new GameLoop({
        update: (dt) => game.update(dt),
        render: () => game.render(),
    });

    // Rasterize all procedural sprites once, before the first frame, so
    // no spawn/boss/coin hitches the loop by building art mid-frame.
    prewarmSprites();
    // Warm the weapon-aura glow colors too, so the first weapon pickup /
    // evolution / aura color-swap doesn't rasterize a 128px glow mid-frame.
    for (const k in WEAPON_AURA) getGlowSprite(WEAPON_AURA[k].color);
    // Same for the weapon-visual FX glows (beam/mine/trail/fang) — several
    // aren't aura colors, so the first patch/ray frame would otherwise build.
    for (const c of WEAPON_FX_GLOWS) getGlowSprite(c);
    // Warm every cosmetic colour (rarity prestige FX glows in the equipped
    // piece's own colour) + the quantized prism hues (mythic hue-cycle).
    for (const k in COSMETICS) { const c = COSMETICS[k].color; if (c) getGlowSprite(c); }
    for (const c of PRISM_COLORS) getGlowSprite(c);

    // Load the imported assets (LPC enemy spritesheets + CC0 ground texture)
    // before the first frame. Both NEVER reject — a failed/missing file falls
    // back to procedural art — so a bad asset can't block boot.
    await Promise.all([loadLpcSprites(), loadWorldTextures(), loadIconGlyphs(), loadMonsterSprites(), loadEnemyAiSprites(),
        // HQ AI hero body: after it loads, drop any hero frame sets the prewarm
        // cached so the next build uses the AI base (procedural stays fallback).
        loadHeroAiSprites().then((ok) => { if (ok) clearHeroFrameCache(); }),
        // World art: AI obstacle/building sprites + tiny decor props (prewarm
        // cached the procedural decor first — drop those on success).
        loadObstacleSprites(),
        loadDecorSprites().then((ok) => { if (ok) clearDecorationCache(); }),
        // Blender-rendered held-weapon prop layers (composited per weapon
        // accent/glow above the procedural buildProp fallback). NEVER rejects —
        // a missing/failed family stays on buildProp — so it's safe here and
        // resolves before loop.start() so the first menu/first-fire frame sees
        // the composited wand.
        loadRenderedProps()]);

    splash.stop();
    game = new Game({ renderer, input, loop });
    loop.start();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
