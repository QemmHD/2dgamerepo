import { SPRITE_SIZE, TWO_PI } from '../config.js';

const cache = new Map();

export function getMonkeySprite() {
    if (cache.has('monkey')) return cache.get('monkey');
    const sprite = drawMonkey(SPRITE_SIZE);
    cache.set('monkey', sprite);
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

    // Tail — curl extending behind/right
    ctx.strokeStyle = FUR_DARK;
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx + 28, cy + 48);
    ctx.bezierCurveTo(cx + 70, cy + 70, cx + 88, cy + 20, cx + 68, cy - 4);
    ctx.stroke();

    // Body — round torso
    ctx.fillStyle = FUR;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 8, 55, 60, 0, 0, TWO_PI);
    ctx.fill();

    // Belly highlight
    ctx.fillStyle = FACE;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 18, 28, 32, 0, 0, TWO_PI);
    ctx.fill();

    // Feet
    ctx.fillStyle = FUR_DARK;
    ctx.beginPath();
    ctx.ellipse(cx - 24, cy + 58, 14, 18, 0, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + 24, cy + 58, 14, 18, 0, 0, TWO_PI);
    ctx.fill();

    // Hands at sides
    ctx.fillStyle = FUR_DARK;
    ctx.beginPath();
    ctx.ellipse(cx - 52, cy + 12, 13, 17, 0.35, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + 52, cy + 12, 13, 17, -0.35, 0, TWO_PI);
    ctx.fill();

    // Head
    ctx.fillStyle = FUR;
    ctx.beginPath();
    ctx.arc(cx, cy - 35, 40, 0, TWO_PI);
    ctx.fill();

    // Ears (outer)
    ctx.fillStyle = FUR_DARK;
    ctx.beginPath();
    ctx.arc(cx - 38, cy - 40, 15, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 38, cy - 40, 15, 0, TWO_PI);
    ctx.fill();
    // Ears (inner)
    ctx.fillStyle = INNER_EAR;
    ctx.beginPath();
    ctx.arc(cx - 38, cy - 40, 8, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 38, cy - 40, 8, 0, TWO_PI);
    ctx.fill();

    // Face — lighter mask
    ctx.fillStyle = FACE;
    ctx.beginPath();
    ctx.ellipse(cx, cy - 28, 25, 28, 0, 0, TWO_PI);
    ctx.fill();

    // Forehead shading
    ctx.fillStyle = FUR_LIGHT;
    ctx.beginPath();
    ctx.ellipse(cx, cy - 48, 18, 8, 0, 0, TWO_PI);
    ctx.fill();

    // Eyes
    ctx.fillStyle = EYE;
    ctx.beginPath();
    ctx.arc(cx - 9, cy - 32, 4.5, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 9, cy - 32, 4.5, 0, TWO_PI);
    ctx.fill();
    // Eye shine
    ctx.fillStyle = HIGHLIGHT;
    ctx.beginPath();
    ctx.arc(cx - 7.5, cy - 33.5, 1.6, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 10.5, cy - 33.5, 1.6, 0, TWO_PI);
    ctx.fill();

    // Nose
    ctx.fillStyle = FUR_DARK;
    ctx.beginPath();
    ctx.ellipse(cx, cy - 22, 3, 2, 0, 0, TWO_PI);
    ctx.fill();

    // Mouth
    ctx.strokeStyle = FUR_DARK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy - 17, 5, 0, Math.PI);
    ctx.stroke();

    return canvas;
}
