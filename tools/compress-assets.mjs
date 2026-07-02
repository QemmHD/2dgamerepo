#!/usr/bin/env node
// compress-assets.mjs — one-shot PNG diet for src/assets/**/*.png.
//
// Two passes per file, both guarded so art can never degrade or grow:
//   1. pngquant (lossy palette quantization to PNG-8). Runs with a HIGH
//      quality floor (--quality=85-100): if quantization can't stay above it,
//      pngquant exits 99 and the original is kept. Most sheets are pixel art
//      with few colors, so this pass is typically visually lossless and the
//      biggest win (~-60% on hero/UI PNGs).
//   2. optipng -o2 (pure lossless recompression) on whatever pass 1 left.
// A file is only replaced when the result is SMALLER; originals stay in git
// history, and any batch that changes canonical art (the PR #103 enemy
// sheets!) must be visually diffed via the artshot harness before shipping.
//
// Usage: node tools/compress-assets.mjs [--dry]
// Requires pngquant + optipng on PATH (apt: pngquant optipng).

import { execFileSync } from 'node:child_process';
import { readdirSync, statSync, copyFileSync, unlinkSync, existsSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'src', 'assets');
const DRY = process.argv.includes('--dry');

function* pngs(dir) {
    for (const name of readdirSync(dir)) {
        // Never pick up our own work files (e.g. left over from a crash).
        if (name.endsWith('.cmp.png')) continue;
        const p = join(dir, name);
        const st = statSync(p);
        if (st.isDirectory()) yield* pngs(p);
        else if (name.toLowerCase().endsWith('.png')) yield p;
    }
}

function have(bin) {
    try { execFileSync(bin, ['--version'], { stdio: 'ignore' }); return true; }
    catch { return false; }
}

if (!have('pngquant') || !have('optipng')) {
    console.error('compress-assets: pngquant + optipng required (apt-get install pngquant optipng)');
    process.exit(1);
}

let before = 0, after = 0, changed = 0;
for (const file of pngs(ASSETS)) {
    const orig = statSync(file).size;
    before += orig;
    const tmp = file + '.cmp.png';
    // Pass 1 — palette quantization with a quality floor, reading the ORIGINAL
    // and writing a fresh temp (exit 99 = "would fall below the floor", 98 =
    // "would be larger" → fall back to a plain copy for pass 2).
    let quantized = false;
    try {
        execFileSync('pngquant', ['--quality=85-100', '--speed=1', '--strip',
            '--skip-if-larger', '--force', '--output', tmp, file], { stdio: 'ignore' });
        quantized = true;
    } catch (e) {
        if (![98, 99].includes(e.status)) { if (existsSync(tmp)) unlinkSync(tmp); throw e; }
    }
    if (!quantized) copyFileSync(file, tmp);
    // Pass 2 — lossless deflate/filter optimization (never changes pixels).
    // -fix repairs pngquant's over-long tRNS chunk (a recoverable error that
    // optipng otherwise refuses to process).
    execFileSync('optipng', ['-quiet', '-fix', '-o2', '-strip', 'all', tmp], { stdio: 'ignore' });
    const out = statSync(tmp).size;
    if (out < orig) {
        after += out;
        changed++;
        if (DRY) unlinkSync(tmp);
        else renameSync(tmp, file);
        console.log(`${file.slice(ROOT.length + 1)}  ${(orig / 1024).toFixed(1)}K → ${(out / 1024).toFixed(1)}K`);
    } else {
        after += orig;
        unlinkSync(tmp);
    }
}
console.log(`\n${changed} file(s) shrunk${DRY ? ' (dry run — nothing written)' : ''}: ` +
    `${(before / 1048576).toFixed(2)} MB → ${(after / 1048576).toFixed(2)} MB`);
if (existsSync(join(ASSETS, 'enemies'))) {
    console.log('Reminder: visually diff the canonical enemy sheets (artshot showcase) before shipping.');
}
