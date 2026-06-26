import { SPRITE_SIZE } from '../config.js';
import { TWO_PI } from '../core/MathUtils.js';

const cache = new Map();

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

export function getProjectileSprite() {
    if (cache.has('projectile')) return cache.get('projectile');
    const sprite = drawProjectile();
    cache.set('projectile', sprite);
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
