#!/usr/bin/env node
// Deterministically inventory the installed Blender hero sheets.
//
// Run this after the shared pixelation install pass. The resulting manifest is
// a reviewable receipt tying every runtime PNG to the exact normalization
// options and bytes that were approved.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HERO_ASSET_DIR = path.join(ROOT, 'src', 'assets', 'hero');
const OUTPUT_PATH = path.join(HERO_ASSET_DIR, 'hero-install-manifest.json');
const HERO_IDS = Object.freeze(['monkey', 'elf', 'orc', 'wizard', 'berserker', 'assassin']);
const DIRECTIONS = Object.freeze(['down', 'up', 'side']);
const PIXELATION = Object.freeze({ cell: 256, logical: 96, colors: 32, outline: 1 });

const sheets = [];
for (const heroId of HERO_IDS) {
    for (const direction of DIRECTIONS) {
        const filename = `${heroId}_${direction}.png`;
        const absolutePath = path.join(HERO_ASSET_DIR, filename);
        if (!fs.existsSync(absolutePath)) throw new Error(`missing installed hero sheet: ${absolutePath}`);
        sheets.push({
            heroId,
            direction,
            path: `src/assets/hero/${filename}`,
            sha256: crypto.createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex'),
        });
    }
}

const manifest = {
    schemaVersion: 1,
    generator: 'tools/generate-hero-install-manifest.js',
    pixelation: PIXELATION,
    sheets,
};

fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${path.relative(ROOT, OUTPUT_PATH)} (${sheets.length} sheets).`);
