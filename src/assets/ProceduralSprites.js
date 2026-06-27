import { SPRITE_SIZE, MAP } from '../config/GameConfig.js';
import { TWO_PI } from '../core/MathUtils.js';

const cache = new Map();

export function getGroundTileSprite() {
    if (cache.has('groundTile')) return cache.get('groundTile');
    const sprite = drawGroundTile(MAP.tileSize);
    cache.set('groundTile', sprite);
    return sprite;
}

export function getDecorationSprite(type) {
    const key = `dec:${type}`;
    if (cache.has(key)) return cache.get(key);
    const sprite = drawDecoration(type);
    cache.set(key, sprite);
    return sprite;
}

export function getMonkeySprite() {
    if (cache.has('monkey')) return cache.get('monkey');
    const sprite = drawMonkey(SPRITE_SIZE);
    cache.set('monkey', sprite);
    return sprite;
}

export function getSlimeSprite() {
    if (cache.has('slime')) return cache.get('slime');
    const sprite = drawSlime(SPRITE_SIZE);
    cache.set('slime', sprite);
    return sprite;
}

export function getBatSprite() {
    if (cache.has('bat')) return cache.get('bat');
    const sprite = drawBat(SPRITE_SIZE);
    cache.set('bat', sprite);
    return sprite;
}

export function getBruteSprite() {
    if (cache.has('brute')) return cache.get('brute');
    const sprite = drawBrute(SPRITE_SIZE);
    cache.set('brute', sprite);
    return sprite;
}

export function getCrawlerSprite() {
    if (cache.has('crawler')) return cache.get('crawler');
    const sprite = drawCrawler(SPRITE_SIZE);
    cache.set('crawler', sprite);
    return sprite;
}

export function getVinebackGoliathSprite() {
    if (cache.has('vinebackGoliath')) return cache.get('vinebackGoliath');
    const sprite = drawVinebackGoliath(SPRITE_SIZE);
    cache.set('vinebackGoliath', sprite);
    return sprite;
}

export function getStormwingAlphaSprite() {
    if (cache.has('stormwingAlpha')) return cache.get('stormwingAlpha');
    const sprite = drawStormwingAlpha(SPRITE_SIZE);
    cache.set('stormwingAlpha', sprite);
    return sprite;
}

export function getChestSprite() {
    if (cache.has('chest')) return cache.get('chest');
    const sprite = drawChest();
    cache.set('chest', sprite);
    return sprite;
}

export function getCoinSprite() {
    if (cache.has('coin')) return cache.get('coin');
    const sprite = drawCoin();
    cache.set('coin', sprite);
    return sprite;
}

export function getProjectileSprite() {
    if (cache.has('projectile')) return cache.get('projectile');
    const sprite = drawProjectile();
    cache.set('projectile', sprite);
    return sprite;
}

export function getXPGemSprite(tier) {
    const key = `gem:${tier}`;
    if (cache.has(key)) return cache.get(key);
    const sprite = drawXPGem(tier);
    cache.set(key, sprite);
    return sprite;
}

function drawMonkey(size) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    const cx = size / 2;
    const cy = size / 2;

    const FUR = '#8b5a2b';
    const FUR_DARK = '#6b4423';
    const FUR_LIGHT = '#a87341';
    const FACE = '#f0d2a5';
    const INNER_EAR = '#d4a373';
    const EYE = '#1b1b1b';
    const HIGHLIGHT = '#ffffff';

    ctx.strokeStyle = FUR_DARK;
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx + 28, cy + 48);
    ctx.bezierCurveTo(cx + 70, cy + 70, cx + 88, cy + 20, cx + 68, cy - 4);
    ctx.stroke();

    ctx.fillStyle = FUR;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 8, 55, 60, 0, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = FACE;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 18, 28, 32, 0, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = FUR_DARK;
    ctx.beginPath();
    ctx.ellipse(cx - 24, cy + 58, 14, 18, 0, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + 24, cy + 58, 14, 18, 0, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = FUR_DARK;
    ctx.beginPath();
    ctx.ellipse(cx - 52, cy + 12, 13, 17, 0.35, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + 52, cy + 12, 13, 17, -0.35, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = FUR;
    ctx.beginPath();
    ctx.arc(cx, cy - 35, 40, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = FUR_DARK;
    ctx.beginPath();
    ctx.arc(cx - 38, cy - 40, 15, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 38, cy - 40, 15, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = INNER_EAR;
    ctx.beginPath();
    ctx.arc(cx - 38, cy - 40, 8, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 38, cy - 40, 8, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = FACE;
    ctx.beginPath();
    ctx.ellipse(cx, cy - 28, 25, 28, 0, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = FUR_LIGHT;
    ctx.beginPath();
    ctx.ellipse(cx, cy - 48, 18, 8, 0, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = EYE;
    ctx.beginPath();
    ctx.arc(cx - 9, cy - 32, 4.5, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 9, cy - 32, 4.5, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = HIGHLIGHT;
    ctx.beginPath();
    ctx.arc(cx - 7.5, cy - 33.5, 1.6, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 10.5, cy - 33.5, 1.6, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = FUR_DARK;
    ctx.beginPath();
    ctx.ellipse(cx, cy - 22, 3, 2, 0, 0, TWO_PI);
    ctx.fill();

    ctx.strokeStyle = FUR_DARK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy - 17, 5, 0, Math.PI);
    ctx.stroke();

    return canvas;
}

function drawSlime(size) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const cx = size / 2;
    const cy = size / 2;

    const BODY = '#5cc26d';
    const BODY_DARK = '#3a8a47';
    const BODY_LIGHT = '#a0e8a8';
    const EYE = '#1b1b1b';

    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 50, 62, 12, 0, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = BODY;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 8, 65, 55, 0, 0, TWO_PI);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx - 38, cy + 42, 16, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 38, cy + 42, 16, 0, TWO_PI);
    ctx.fill();

    ctx.strokeStyle = BODY_DARK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 8, 65, 55, 0, 0, TWO_PI);
    ctx.stroke();

    ctx.fillStyle = BODY_LIGHT;
    ctx.beginPath();
    ctx.ellipse(cx - 18, cy - 18, 26, 14, -0.3, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = EYE;
    ctx.beginPath();
    ctx.arc(cx - 16, cy - 4, 8, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 16, cy - 4, 8, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(cx - 13, cy - 7, 2.5, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 19, cy - 7, 2.5, 0, TWO_PI);
    ctx.fill();

    ctx.strokeStyle = EYE;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy + 16, 9, 0, Math.PI);
    ctx.stroke();

    return canvas;
}

function drawBat(size) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const cx = size / 2;
    const cy = size / 2;

    const WING = '#2a1f4a';
    const WING_EDGE = '#4a3970';
    const BODY = '#3a2860';
    const FANG = '#fff';
    const EYE = '#ff3046';

    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 36, 36, 8, 0, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = WING;
    ctx.beginPath();
    ctx.moveTo(cx - 4, cy - 4);
    ctx.quadraticCurveTo(cx - 50, cy - 38, cx - 78, cy - 10);
    ctx.quadraticCurveTo(cx - 60, cy - 4, cx - 50, cy + 2);
    ctx.quadraticCurveTo(cx - 64, cy + 18, cx - 42, cy + 22);
    ctx.quadraticCurveTo(cx - 26, cy + 10, cx - 12, cy + 12);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = WING_EDGE;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = WING;
    ctx.beginPath();
    ctx.moveTo(cx + 4, cy - 4);
    ctx.quadraticCurveTo(cx + 50, cy - 38, cx + 78, cy - 10);
    ctx.quadraticCurveTo(cx + 60, cy - 4, cx + 50, cy + 2);
    ctx.quadraticCurveTo(cx + 64, cy + 18, cx + 42, cy + 22);
    ctx.quadraticCurveTo(cx + 26, cy + 10, cx + 12, cy + 12);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = WING_EDGE;
    ctx.stroke();

    ctx.fillStyle = BODY;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 4, 18, 26, 0, 0, TWO_PI);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(cx - 12, cy - 18);
    ctx.lineTo(cx - 6, cy - 36);
    ctx.lineTo(cx - 2, cy - 18);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + 12, cy - 18);
    ctx.lineTo(cx + 6, cy - 36);
    ctx.lineTo(cx + 2, cy - 18);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = EYE;
    ctx.beginPath();
    ctx.arc(cx - 7, cy - 8, 4, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 7, cy - 8, 4, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = '#ffd6da';
    ctx.beginPath();
    ctx.arc(cx - 6, cy - 9.5, 1.4, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 8, cy - 9.5, 1.4, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = FANG;
    ctx.beginPath();
    ctx.moveTo(cx - 5, cy + 4);
    ctx.lineTo(cx - 2, cy + 12);
    ctx.lineTo(cx - 1, cy + 5);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + 5, cy + 4);
    ctx.lineTo(cx + 2, cy + 12);
    ctx.lineTo(cx + 1, cy + 5);
    ctx.closePath();
    ctx.fill();

    return canvas;
}

function drawBrute(size) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const cx = size / 2;
    const cy = size / 2;

    const BODY = '#6b4226';
    const BODY_DARK = '#3a2410';
    const BODY_LIGHT = '#8e5d36';
    const EYE = '#ff8c40';

    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 60, 72, 14, 0, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = BODY;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 6, 72, 62, 0, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = BODY_LIGHT;
    ctx.beginPath();
    ctx.ellipse(cx - 18, cy - 18, 32, 18, -0.3, 0, TWO_PI);
    ctx.fill();

    ctx.strokeStyle = BODY_DARK;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 6, 72, 62, 0, 0, TWO_PI);
    ctx.stroke();

    ctx.fillStyle = BODY_DARK;
    for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + i * 28 - 9, cy - 50);
        ctx.lineTo(cx + i * 28 + 9, cy - 50);
        ctx.lineTo(cx + i * 28, cy - 74);
        ctx.closePath();
        ctx.fill();
    }

    ctx.fillStyle = EYE;
    ctx.beginPath();
    ctx.arc(cx - 22, cy - 8, 8, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 22, cy - 8, 8, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = '#fff5d0';
    ctx.beginPath();
    ctx.arc(cx - 20, cy - 10, 2.8, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 24, cy - 10, 2.8, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + i * 9 - 3, cy + 18);
        ctx.lineTo(cx + i * 9 + 3, cy + 18);
        ctx.lineTo(cx + i * 9, cy + 34);
        ctx.closePath();
        ctx.fill();
    }

    return canvas;
}

function drawCrawler(size) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const cx = size / 2;
    const cy = size / 2;

    const BODY = '#3d2c5e';
    const BODY_DARK = '#1c1432';
    const HIGHLIGHT = '#6a4cba';
    const EYE = '#ffeb47';

    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 28, 42, 8, 0, 0, TWO_PI);
    ctx.fill();

    ctx.strokeStyle = BODY_DARK;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
        const yOff = -10 + i * 12;
        ctx.beginPath();
        ctx.moveTo(cx - 30, cy + yOff);
        ctx.lineTo(cx - 52, cy + yOff - 6);
        ctx.lineTo(cx - 62, cy + yOff + 10);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx + 30, cy + yOff);
        ctx.lineTo(cx + 52, cy + yOff - 6);
        ctx.lineTo(cx + 62, cy + yOff + 10);
        ctx.stroke();
    }

    ctx.fillStyle = BODY;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 5, 38, 26, 0, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = HIGHLIGHT;
    ctx.beginPath();
    ctx.ellipse(cx - 8, cy - 6, 14, 8, -0.2, 0, TWO_PI);
    ctx.fill();

    ctx.strokeStyle = BODY_DARK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 5, 38, 26, 0, 0, TWO_PI);
    ctx.stroke();

    ctx.fillStyle = EYE;
    const eyePositions = [
        [cx - 14, cy - 2],
        [cx + 14, cy - 2],
        [cx - 6, cy + 4],
        [cx + 6, cy + 4],
    ];
    for (const [ex, ey] of eyePositions) {
        ctx.beginPath();
        ctx.arc(ex, ey, 3, 0, TWO_PI);
        ctx.fill();
    }
    ctx.fillStyle = '#000';
    for (const [ex, ey] of eyePositions) {
        ctx.beginPath();
        ctx.arc(ex, ey, 1.3, 0, TWO_PI);
        ctx.fill();
    }

    ctx.strokeStyle = BODY_DARK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy + 14);
    ctx.lineTo(cx - 13, cy + 23);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + 8, cy + 14);
    ctx.lineTo(cx + 13, cy + 23);
    ctx.stroke();

    return canvas;
}

function drawVinebackGoliath(size) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const cx = size / 2;
    const cy = size / 2;

    const BODY = '#2d6b3f';
    const BODY_DARK = '#143020';
    const BODY_LIGHT = '#4a9959';
    const VINE = '#5a3c1e';
    const VINE_DARK = '#3a2614';
    const LEAF = '#83b94a';
    const EYE = '#ffeb47';

    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 76, 82, 16, 0, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = BODY;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 5, 82, 76, 0, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = BODY_LIGHT;
    ctx.beginPath();
    ctx.ellipse(cx - 22, cy - 20, 38, 22, -0.3, 0, TWO_PI);
    ctx.fill();

    ctx.strokeStyle = BODY_DARK;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 5, 82, 76, 0, 0, TWO_PI);
    ctx.stroke();

    ctx.strokeStyle = VINE_DARK;
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 70, cy + 30);
    ctx.bezierCurveTo(cx - 35, cy - 20, cx + 30, cy + 45, cx + 72, cy - 8);
    ctx.stroke();
    ctx.strokeStyle = VINE;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(cx - 70, cy + 30);
    ctx.bezierCurveTo(cx - 35, cy - 20, cx + 30, cy + 45, cx + 72, cy - 8);
    ctx.stroke();
    ctx.strokeStyle = VINE;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(cx - 60, cy - 30);
    ctx.bezierCurveTo(cx - 20, cy + 55, cx + 40, cy - 55, cx + 65, cy + 22);
    ctx.stroke();

    ctx.fillStyle = LEAF;
    const leafPositions = [
        [cx - 42, cy - 8, 0.4],
        [cx + 22, cy + 32, -0.3],
        [cx + 52, cy - 22, 0.7],
        [cx - 12, cy + 42, 0.2],
    ];
    for (const [lx, ly, rot] of leafPositions) {
        ctx.beginPath();
        ctx.ellipse(lx, ly, 14, 7, rot, 0, TWO_PI);
        ctx.fill();
    }

    ctx.fillStyle = EYE;
    const eyePositions = [
        [cx - 28, cy - 14],
        [cx, cy - 22],
        [cx + 28, cy - 14],
    ];
    for (const [ex, ey] of eyePositions) {
        ctx.beginPath();
        ctx.arc(ex, ey, 9, 0, TWO_PI);
        ctx.fill();
    }
    ctx.fillStyle = '#000';
    for (const [ex, ey] of eyePositions) {
        ctx.beginPath();
        ctx.arc(ex, ey, 3.5, 0, TWO_PI);
        ctx.fill();
    }

    ctx.strokeStyle = '#000';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, cy + 18, 20, 0, Math.PI);
    ctx.stroke();

    ctx.fillStyle = '#fff';
    for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + i * 14 - 4, cy + 22);
        ctx.lineTo(cx + i * 14 + 4, cy + 22);
        ctx.lineTo(cx + i * 14, cy + 40);
        ctx.closePath();
        ctx.fill();
    }

    return canvas;
}

function drawStormwingAlpha(size) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const cx = size / 2;
    const cy = size / 2;

    const WING = '#1a1438';
    const WING_EDGE = '#3a2870';
    const BODY = '#2c1c4a';
    const FANG = '#fff';
    const EYE = '#ff3060';
    const LIGHTNING = '#90d8ff';

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 50, 56, 12, 0, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = WING;
    ctx.beginPath();
    ctx.moveTo(cx - 5, cy - 4);
    ctx.quadraticCurveTo(cx - 60, cy - 52, cx - 88, cy - 6);
    ctx.quadraticCurveTo(cx - 75, cy + 4, cx - 60, cy + 6);
    ctx.quadraticCurveTo(cx - 80, cy + 22, cx - 55, cy + 30);
    ctx.quadraticCurveTo(cx - 30, cy + 16, cx - 12, cy + 12);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = WING_EDGE;
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = WING;
    ctx.beginPath();
    ctx.moveTo(cx + 5, cy - 4);
    ctx.quadraticCurveTo(cx + 60, cy - 52, cx + 88, cy - 6);
    ctx.quadraticCurveTo(cx + 75, cy + 4, cx + 60, cy + 6);
    ctx.quadraticCurveTo(cx + 80, cy + 22, cx + 55, cy + 30);
    ctx.quadraticCurveTo(cx + 30, cy + 16, cx + 12, cy + 12);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = WING_EDGE;
    ctx.stroke();

    ctx.fillStyle = BODY;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 5, 30, 38, 0, 0, TWO_PI);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(cx - 18, cy - 26);
    ctx.lineTo(cx - 8, cy - 50);
    ctx.lineTo(cx - 2, cy - 26);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + 18, cy - 26);
    ctx.lineTo(cx + 8, cy - 50);
    ctx.lineTo(cx + 2, cy - 26);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = EYE;
    ctx.beginPath();
    ctx.arc(cx - 11, cy - 11, 7, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 11, cy - 11, 7, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = '#ffe4e8';
    ctx.beginPath();
    ctx.arc(cx - 9, cy - 13, 2.4, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 13, cy - 13, 2.4, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = FANG;
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy + 7);
    ctx.lineTo(cx - 4, cy + 20);
    ctx.lineTo(cx - 1, cy + 7);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + 8, cy + 7);
    ctx.lineTo(cx + 4, cy + 20);
    ctx.lineTo(cx + 1, cy + 7);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = LIGHTNING;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 38, cy);
    ctx.lineTo(cx - 30, cy + 6);
    ctx.lineTo(cx - 34, cy + 14);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + 38, cy - 4);
    ctx.lineTo(cx + 30, cy + 2);
    ctx.lineTo(cx + 34, cy + 10);
    ctx.stroke();

    return canvas;
}

function drawChest() {
    const W = 96;
    const H = 84;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    const WOOD = '#7a4920';
    const WOOD_DARK = '#3a2410';
    const WOOD_LIGHT = '#a06430';
    const GOLD = '#ffd166';
    const GOLD_DARK = '#a07530';

    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath();
    ctx.ellipse(W / 2, H - 6, W / 2 - 6, 5, 0, 0, TWO_PI);
    ctx.fill();

    // Body
    ctx.fillStyle = WOOD;
    ctx.fillRect(6, 40, W - 12, H - 46);
    ctx.fillStyle = WOOD_LIGHT;
    ctx.fillRect(6, 40, 5, H - 46);
    ctx.strokeStyle = WOOD_DARK;
    ctx.lineWidth = 2;
    ctx.strokeRect(6, 40, W - 12, H - 46);

    // Lid (curved top)
    ctx.fillStyle = WOOD;
    ctx.beginPath();
    ctx.moveTo(6, 40);
    ctx.lineTo(6, 22);
    ctx.quadraticCurveTo(W / 2, 6, W - 6, 22);
    ctx.lineTo(W - 6, 40);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = WOOD_DARK;
    ctx.stroke();

    ctx.strokeStyle = WOOD_LIGHT;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(10, 32);
    ctx.quadraticCurveTo(W / 2, 16, W - 10, 32);
    ctx.stroke();

    // Gold horizontal band
    ctx.fillStyle = GOLD;
    ctx.fillRect(6, 36, W - 12, 6);
    ctx.strokeStyle = GOLD_DARK;
    ctx.lineWidth = 1;
    ctx.strokeRect(6, 36, W - 12, 6);

    // Gold vertical strap
    ctx.fillStyle = GOLD;
    ctx.fillRect(W / 2 - 4, 12, 8, H - 18);
    ctx.strokeStyle = GOLD_DARK;
    ctx.strokeRect(W / 2 - 4, 12, 8, H - 18);

    // Lock
    ctx.fillStyle = GOLD;
    ctx.beginPath();
    ctx.arc(W / 2, 52, 7, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = GOLD_DARK;
    ctx.stroke();
    ctx.fillStyle = WOOD_DARK;
    ctx.fillRect(W / 2 - 1.5, 50, 3, 6);

    return canvas;
}

function drawCoin() {
    const W = 28;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = W;
    const ctx = canvas.getContext('2d');
    const cx = W / 2;
    const cy = W / 2;

    const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, W / 2);
    glow.addColorStop(0, '#fff5d0');
    glow.addColorStop(0.55, 'rgba(255, 209, 102, 0.85)');
    glow.addColorStop(1, 'rgba(255, 200, 50, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, W);

    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.arc(cx, cy, 11, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = '#a07530';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#fff5d0';
    ctx.beginPath();
    ctx.ellipse(cx - 3, cy - 3, 4, 3, 0, 0, TWO_PI);
    ctx.fill();

    ctx.strokeStyle = '#a07530';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, TWO_PI);
    ctx.stroke();

    return canvas;
}

function drawProjectile() {
    const W = 48;
    const H = 24;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    const grad = ctx.createRadialGradient(W / 2, H / 2, 4, W / 2, H / 2, W / 2);
    grad.addColorStop(0, 'rgba(255, 230, 110, 1)');
    grad.addColorStop(0.5, 'rgba(255, 165, 50, 0.65)');
    grad.addColorStop(1, 'rgba(255, 100, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = 'rgba(255, 210, 90, 0.55)';
    ctx.beginPath();
    ctx.ellipse(W / 2 - 8, H / 2, 16, 4, 0, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = '#fff8d0';
    ctx.beginPath();
    ctx.ellipse(W / 2, H / 2, 11, 5, 0, 0, TWO_PI);
    ctx.fill();

    return canvas;
}

function drawXPGem(tier) {
    const SIZES = { small: 28, medium: 36, large: 44 };
    const COLORS = {
        small:  { base: '#4ec1ff', light: '#bfeaff', dark: '#1e6fa8' },
        medium: { base: '#5fe87a', light: '#c7f7d0', dark: '#1f7a35' },
        large:  { base: '#ff5566', light: '#ffb4bc', dark: '#8a1d28' },
    };
    const size = SIZES[tier] ?? SIZES.small;
    const c = COLORS[tier] ?? COLORS.small;

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2;

    const glow = ctx.createRadialGradient(cx, cy, 1, cx, cy, r);
    glow.addColorStop(0, c.light);
    glow.addColorStop(0.55, c.base + 'cc');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);

    const dx = r * 0.72;
    const dy = r * 0.86;
    ctx.fillStyle = c.base;
    ctx.beginPath();
    ctx.moveTo(cx, cy - dy);
    ctx.lineTo(cx + dx, cy);
    ctx.lineTo(cx, cy + dy);
    ctx.lineTo(cx - dx, cy);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = c.light;
    ctx.beginPath();
    ctx.moveTo(cx, cy - dy + 2);
    ctx.lineTo(cx + dx * 0.45, cy);
    ctx.lineTo(cx, cy - 2);
    ctx.lineTo(cx - dx * 0.45, cy);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = c.dark;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy - dy);
    ctx.lineTo(cx + dx, cy);
    ctx.lineTo(cx, cy + dy);
    ctx.lineTo(cx - dx, cy);
    ctx.closePath();
    ctx.stroke();

    return canvas;
}

// Deterministic small PRNG used for tile texture detail so the tile draws
// the same set of speckles every reload. Keeps the tile sprite stable.
function tileRng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function drawGroundTile(size) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    const BASE = '#13201a';
    const BASE_LIGHT = '#1b2c22';
    const SPECK = '#243a2c';
    const SPECK_DARK = '#0a120d';
    const MOSS = '#2c4a35';

    ctx.fillStyle = BASE;
    ctx.fillRect(0, 0, size, size);

    // Soft gradient blob to break up tile flatness.
    const grad = ctx.createRadialGradient(
        size * 0.35, size * 0.45, size * 0.05,
        size * 0.35, size * 0.45, size * 0.85
    );
    grad.addColorStop(0, BASE_LIGHT);
    grad.addColorStop(1, BASE);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    const rng = tileRng(1337);

    // Light specks (dirt + small leaves).
    for (let i = 0; i < 50; i++) {
        const x = rng() * size;
        const y = rng() * size;
        const r = 0.6 + rng() * 1.4;
        ctx.fillStyle = SPECK;
        ctx.fillRect(x, y, r, r);
    }
    // Dark specks (cracks).
    for (let i = 0; i < 28; i++) {
        const x = rng() * size;
        const y = rng() * size;
        const r = 0.8 + rng() * 1.6;
        ctx.fillStyle = SPECK_DARK;
        ctx.fillRect(x, y, r, r);
    }
    // A few moss patches.
    for (let i = 0; i < 6; i++) {
        const x = rng() * size;
        const y = rng() * size;
        const r = 3 + rng() * 5;
        ctx.fillStyle = MOSS;
        ctx.globalAlpha = 0.35 + rng() * 0.3;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TWO_PI);
        ctx.fill();
    }
    ctx.globalAlpha = 1;

    return canvas;
}

function drawDecoration(type) {
    switch (type) {
        case 'rock':         return drawRock();
        case 'mushroom':     return drawMushroom();
        case 'skull':        return drawSkull();
        case 'grass':        return drawGrass();
        case 'candle':       return drawCandle();
        case 'ruin':         return drawRuin();
        case 'branch':       return drawBranch();
        case 'crackedStone': return drawCrackedStone();
        case 'bones':        return drawBones();
        default:             return drawRock();
    }
}

function newDecCanvas(w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    return canvas;
}

function drawRock() {
    const W = 56, H = 44;
    const canvas = newDecCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const cx = W / 2, cy = H * 0.62;

    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath();
    ctx.ellipse(cx, H - 4, 22, 4, 0, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = '#3a4148';
    ctx.beginPath();
    ctx.moveTo(cx - 22, cy + 6);
    ctx.lineTo(cx - 16, cy - 12);
    ctx.lineTo(cx - 2, cy - 16);
    ctx.lineTo(cx + 14, cy - 10);
    ctx.lineTo(cx + 22, cy + 4);
    ctx.lineTo(cx + 16, cy + 12);
    ctx.lineTo(cx - 14, cy + 12);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#52595f';
    ctx.beginPath();
    ctx.moveTo(cx - 16, cy - 4);
    ctx.lineTo(cx - 10, cy - 12);
    ctx.lineTo(cx + 2, cy - 14);
    ctx.lineTo(cx + 4, cy - 6);
    ctx.lineTo(cx - 8, cy - 2);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#1d2226';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - 22, cy + 6);
    ctx.lineTo(cx - 16, cy - 12);
    ctx.lineTo(cx - 2, cy - 16);
    ctx.lineTo(cx + 14, cy - 10);
    ctx.lineTo(cx + 22, cy + 4);
    ctx.lineTo(cx + 16, cy + 12);
    ctx.lineTo(cx - 14, cy + 12);
    ctx.closePath();
    ctx.stroke();

    return canvas;
}

function drawMushroom() {
    const W = 38, H = 44;
    const canvas = newDecCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const cx = W / 2;

    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(cx, H - 3, 12, 3, 0, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = '#e6e3d0';
    ctx.fillRect(cx - 4, H - 22, 8, 18);

    ctx.fillStyle = '#b3372d';
    ctx.beginPath();
    ctx.ellipse(cx, H - 22, 16, 12, 0, Math.PI, TWO_PI);
    ctx.fill();

    ctx.fillStyle = '#761d1a';
    ctx.beginPath();
    ctx.ellipse(cx, H - 22, 16, 12, 0, Math.PI, TWO_PI);
    ctx.closePath();
    ctx.strokeStyle = '#761d1a';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#fff6dd';
    const dots = [[cx - 7, H - 26], [cx + 6, H - 28], [cx, H - 22], [cx - 3, H - 31]];
    for (const [dx, dy] of dots) {
        ctx.beginPath();
        ctx.arc(dx, dy, 2.2, 0, TWO_PI);
        ctx.fill();
    }

    return canvas;
}

function drawSkull() {
    const W = 36, H = 30;
    const canvas = newDecCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const cx = W / 2, cy = H / 2;

    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(cx, H - 3, 12, 3, 0, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = '#dcd2b8';
    ctx.beginPath();
    ctx.ellipse(cx, cy - 2, 13, 11, 0, 0, TWO_PI);
    ctx.fill();
    // Jaw
    ctx.fillRect(cx - 8, cy + 7, 16, 4);

    ctx.fillStyle = '#1a1410';
    ctx.beginPath();
    ctx.arc(cx - 4, cy - 2, 2.6, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 4, cy - 2, 2.6, 0, TWO_PI);
    ctx.fill();

    // Teeth gaps
    ctx.strokeStyle = '#1a1410';
    ctx.lineWidth = 1;
    for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + i * 3, cy + 7);
        ctx.lineTo(cx + i * 3, cy + 11);
        ctx.stroke();
    }

    return canvas;
}

function drawGrass() {
    const W = 32, H = 26;
    const canvas = newDecCanvas(W, H);
    const ctx = canvas.getContext('2d');

    const blades = [
        { x: 6,  h: 16, color: '#3b6b40' },
        { x: 12, h: 22, color: '#4d8a52' },
        { x: 17, h: 18, color: '#3b6b40' },
        { x: 22, h: 24, color: '#4d8a52' },
        { x: 27, h: 14, color: '#2f5634' },
    ];
    ctx.lineCap = 'round';
    for (const b of blades) {
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(b.x, H - 2);
        ctx.quadraticCurveTo(b.x + 2, H - b.h * 0.5, b.x + 4, H - b.h);
        ctx.stroke();
    }

    return canvas;
}

function drawCandle() {
    const W = 28, H = 50;
    const canvas = newDecCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const cx = W / 2;

    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(cx, H - 3, 8, 3, 0, 0, TWO_PI);
    ctx.fill();

    // Stone base
    ctx.fillStyle = '#3a3530';
    ctx.fillRect(cx - 7, H - 12, 14, 10);
    ctx.strokeStyle = '#1c1a17';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(cx - 7, H - 12, 14, 10);

    // Candle stick
    ctx.fillStyle = '#e6dcc4';
    ctx.fillRect(cx - 3, H - 30, 6, 18);
    ctx.fillStyle = '#a99a6f';
    ctx.fillRect(cx - 3, H - 30, 1.5, 18);

    // Wick
    ctx.fillStyle = '#1a1410';
    ctx.fillRect(cx - 0.5, H - 34, 1, 4);

    // Flame
    const grad = ctx.createRadialGradient(cx, H - 36, 1, cx, H - 36, 8);
    grad.addColorStop(0, '#fff5b5');
    grad.addColorStop(0.55, 'rgba(255, 180, 60, 0.85)');
    grad.addColorStop(1, 'rgba(255, 120, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(cx - 8, H - 46, 16, 16);

    ctx.fillStyle = '#ffb74a';
    ctx.beginPath();
    ctx.ellipse(cx, H - 37, 2, 4, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = '#fff5d0';
    ctx.beginPath();
    ctx.ellipse(cx, H - 36, 1, 2.4, 0, 0, TWO_PI);
    ctx.fill();

    return canvas;
}

function drawRuin() {
    const W = 64, H = 44;
    const canvas = newDecCanvas(W, H);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath();
    ctx.ellipse(W / 2, H - 4, 26, 4, 0, 0, TWO_PI);
    ctx.fill();

    // Broken column shafts
    ctx.fillStyle = '#6e6354';
    ctx.fillRect(10, H - 30, 12, 26);
    ctx.fillRect(42, H - 22, 12, 18);

    ctx.fillStyle = '#494033';
    ctx.fillRect(10, H - 30, 3, 26);
    ctx.fillRect(42, H - 22, 3, 18);

    ctx.strokeStyle = '#2c2620';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(10, H - 30, 12, 26);
    ctx.strokeRect(42, H - 22, 12, 18);

    // Top stones (jagged)
    ctx.fillStyle = '#7a6e5c';
    ctx.beginPath();
    ctx.moveTo(8, H - 30);
    ctx.lineTo(12, H - 35);
    ctx.lineTo(20, H - 33);
    ctx.lineTo(24, H - 30);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(40, H - 22);
    ctx.lineTo(46, H - 27);
    ctx.lineTo(52, H - 25);
    ctx.lineTo(56, H - 22);
    ctx.closePath();
    ctx.fill();

    // A small rubble piece between them
    ctx.fillStyle = '#5e5446';
    ctx.beginPath();
    ctx.moveTo(26, H - 10);
    ctx.lineTo(30, H - 16);
    ctx.lineTo(38, H - 14);
    ctx.lineTo(40, H - 6);
    ctx.lineTo(28, H - 4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#2c2620';
    ctx.stroke();

    return canvas;
}

function drawBranch() {
    const W = 56, H = 18;
    const canvas = newDecCanvas(W, H);
    const ctx = canvas.getContext('2d');

    ctx.strokeStyle = '#2c1f12';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(4, H - 6);
    ctx.bezierCurveTo(16, H - 14, 36, H - 2, W - 4, H - 8);
    ctx.stroke();

    ctx.strokeStyle = '#5a3c1e';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(4, H - 6);
    ctx.bezierCurveTo(16, H - 14, 36, H - 2, W - 4, H - 8);
    ctx.stroke();

    // Twigs
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(20, H - 8);
    ctx.lineTo(24, H - 16);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(36, H - 6);
    ctx.lineTo(40, H - 14);
    ctx.stroke();

    return canvas;
}

function drawCrackedStone() {
    const W = 46, H = 32;
    const canvas = newDecCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const cx = W / 2, cy = H * 0.62;

    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(cx, H - 3, 18, 3, 0, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = '#646058';
    ctx.beginPath();
    ctx.ellipse(cx, cy, 18, 9, 0, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = '#7a766c';
    ctx.beginPath();
    ctx.ellipse(cx - 4, cy - 3, 10, 4, -0.2, 0, TWO_PI);
    ctx.fill();

    ctx.strokeStyle = '#2c2a25';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 18, 9, 0, 0, TWO_PI);
    ctx.stroke();

    // Cracks
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy - 2);
    ctx.lineTo(cx - 2, cy + 1);
    ctx.lineTo(cx + 4, cy - 1);
    ctx.lineTo(cx + 10, cy + 3);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + 2, cy - 4);
    ctx.lineTo(cx + 4, cy - 1);
    ctx.lineTo(cx + 6, cy + 4);
    ctx.stroke();

    return canvas;
}

function drawBones() {
    const W = 44, H = 22;
    const canvas = newDecCanvas(W, H);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = 'rgba(0,0,0,0.26)';
    ctx.beginPath();
    ctx.ellipse(W / 2, H - 3, 16, 3, 0, 0, TWO_PI);
    ctx.fill();

    // First bone
    ctx.save();
    ctx.translate(14, H - 9);
    ctx.rotate(-0.3);
    ctx.fillStyle = '#e6dcc4';
    ctx.fillRect(-9, -2.5, 18, 5);
    ctx.beginPath();
    ctx.arc(-9, -1, 3, 0, TWO_PI);
    ctx.arc(-9, 1, 3, 0, TWO_PI);
    ctx.arc(9, -1, 3, 0, TWO_PI);
    ctx.arc(9, 1, 3, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = '#8a7e62';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-7, 0);
    ctx.lineTo(7, 0);
    ctx.stroke();
    ctx.restore();

    // Second bone
    ctx.save();
    ctx.translate(30, H - 7);
    ctx.rotate(0.4);
    ctx.fillStyle = '#e6dcc4';
    ctx.fillRect(-7, -2, 14, 4);
    ctx.beginPath();
    ctx.arc(-7, -1, 2.5, 0, TWO_PI);
    ctx.arc(-7, 1, 2.5, 0, TWO_PI);
    ctx.arc(7, -1, 2.5, 0, TWO_PI);
    ctx.arc(7, 1, 2.5, 0, TWO_PI);
    ctx.fill();
    ctx.restore();

    return canvas;
}
