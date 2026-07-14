#!/usr/bin/env node
// Convert Blender's measured attachment export into a browser-native ES module.
// The JSON remains the authoring receipt; runtime code never imports JSON so the
// game keeps working on Safari/WebKit versions without JSON-module support.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BLENDER_DIR = path.join(ROOT, 'tools', 'blender');
const TARGET = path.join(ROOT, 'src', 'assets', 'HeroPoseData.js');
const HERO_IDS = Object.freeze(['monkey', 'elf', 'orc', 'wizard', 'berserker', 'assassin']);
const FRAME_COUNTS = Object.freeze({
    idle: 2,
    walk: 3,
    cast: 1,
    hurt: 1,
    death: 1,
    victory: 1,
});

const finitePoint = (point) => Array.isArray(point)
    && point.length === 2
    && point.every(Number.isFinite);

function validateFrame(frame, label) {
    if (!frame || typeof frame !== 'object') throw new Error(`${label}: frame must be an object`);
    for (const slot of ['headSeat', 'shoulders']) {
        const segment = frame[slot];
        if (!segment || !finitePoint(segment.left) || !finitePoint(segment.right)) {
            throw new Error(`${label}.${slot}: expected finite left/right points`);
        }
        const dx = segment.right[0] - segment.left[0];
        const dy = segment.right[1] - segment.left[1];
        if (dx * dx + dy * dy <= 1e-8) throw new Error(`${label}.${slot}: degenerate segment`);
    }
    if (!finitePoint(frame.handR)) throw new Error(`${label}.handR: expected a finite point`);
}

const attachmentsByHero = {};
for (const heroId of HERO_IDS) {
    const filename = heroId === 'monkey' ? 'anchors.json' : `${heroId}_anchors.json`;
    const sourcePath = path.join(BLENDER_DIR, filename);
    const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    const attachments = source.attachments;
    if (!attachments || typeof attachments !== 'object') {
        throw new Error(`${filename} is missing the Blender-exported attachments object`);
    }

    for (const dir of ['down', 'up', 'side']) {
        const direction = attachments[dir];
        if (!direction || typeof direction !== 'object') {
            throw new Error(`${heroId}.attachments.${dir}: missing direction`);
        }
        for (const [state, count] of Object.entries(FRAME_COUNTS)) {
            const frames = direction[state];
            if (!Array.isArray(frames) || frames.length !== count) {
                throw new Error(`${heroId}.attachments.${dir}.${state}: expected ${count} frames`);
            }
            frames.forEach((frame, index) => validateFrame(
                frame, `${heroId}.attachments.${dir}.${state}[${index}]`));
        }
    }
    attachmentsByHero[heroId] = attachments;
}

const banner = `// GENERATED FILE - DO NOT HAND EDIT.\n`
    + `// Sources: tools/blender/{anchors,*_anchors}.json (Blender 5.1 pose-bone projection).\n`
    + `// Regenerate: node tools/generate-hero-pose-data.js\n\n`;
const output = banner
    + `export const HERO_POSE_FRAME_COUNTS = Object.freeze(${JSON.stringify(FRAME_COUNTS, null, 4)});\n\n`
    + `export const HERO_POSE_ATTACHMENTS_BY_HERO = Object.freeze(${JSON.stringify(attachmentsByHero, null, 4)});\n\n`
    + `// Compatibility alias for procedural and monkey-base fallback bodies.\n`
    + `export const HERO_POSE_ATTACHMENTS = HERO_POSE_ATTACHMENTS_BY_HERO.monkey;\n`;

fs.writeFileSync(TARGET, output, 'utf8');
console.log(`Hero pose data: ${path.relative(ROOT, TARGET)} (${HERO_IDS.length} heroes)`);
