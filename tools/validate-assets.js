#!/usr/bin/env node
// Asset validator (PART 9 of the art pipeline).
//
// Fails the check if any EXTERNAL asset is used without proper license /
// attribution / source metadata, or references a missing file. Run:
//   node tools/validate-assets.js
//
// What it checks per entry in src/assets/credits/assets.json:
//   - required fields present: id, file, source, sourceUrl, license, usedFor
//   - attributionRequired entries have a non-empty authors list
//   - the referenced file actually exists on disk
// It also shape-checks the in-code ASSET_REGISTRY via validateAssetMeta.
//
// Exit code 0 = clean, 1 = problems (so CI / a build step can gate on it).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CREDITS = path.join(ROOT, 'src/assets/credits/assets.json');
const REQUIRED = ['id', 'file', 'source', 'sourceUrl', 'license', 'usedFor'];

let problems = 0;
const fail = (m) => { console.error('  ✗ ' + m); problems++; };
const warn = (m) => console.warn('  ! ' + m);

// 1) Structured credits registry.
if (!fs.existsSync(CREDITS)) {
    fail(`missing credits registry: ${CREDITS}`);
} else {
    let data;
    try { data = JSON.parse(fs.readFileSync(CREDITS, 'utf8')); }
    catch (e) { fail(`assets.json is not valid JSON: ${e.message}`); data = null; }
    const list = data?.assets ?? [];
    console.log(`Checking ${list.length} external asset(s)…`);
    const ids = new Set();
    for (const a of list) {
        const tag = a.id || a.file || '(unnamed)';
        for (const f of REQUIRED) {
            if (a[f] === undefined || a[f] === null || a[f] === '') fail(`${tag}: missing "${f}"`);
        }
        if (a.id) { if (ids.has(a.id)) fail(`duplicate id: ${a.id}`); ids.add(a.id); }
        if (a.attributionRequired && !(Array.isArray(a.authors) && a.authors.length)) {
            fail(`${tag}: attributionRequired but no authors listed`);
        }
        if (a.file && !fs.existsSync(path.join(ROOT, a.file))) fail(`${tag}: file not found on disk (${a.file})`);
        if (a.file && fs.existsSync(path.join(ROOT, a.file))) {
            const kb = fs.statSync(path.join(ROOT, a.file)).size / 1024;
            if (kb > 512) warn(`${tag}: file is ${kb.toFixed(0)}KB — large for a web sprite, consider downsizing`);
        }
    }
}

// 2) In-code metadata registry shape-check.
try {
    const mod = await import(pathToFileURL(path.join(ROOT, 'src/assets/assetRegistry.js')).href);
    const reg = mod.ASSET_REGISTRY ?? {};
    const n = Object.keys(reg).length;
    console.log(`Checking ${n} registry metadata entr(ies)…`);
    for (const [id, meta] of Object.entries(reg)) {
        for (const p of mod.validateAssetMeta(meta)) fail(`registry "${id}": ${p}`);
    }
} catch (e) {
    fail(`could not load assetRegistry.js: ${e.message}`);
}

if (problems === 0) { console.log('\nasset validation: OK — every external asset has license + attribution + source.'); process.exit(0); }
console.error(`\nasset validation: FAILED with ${problems} problem(s).`); process.exit(1);
