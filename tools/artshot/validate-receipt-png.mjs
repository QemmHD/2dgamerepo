#!/usr/bin/env node

// Dependency-free PNG receipt gate for CI art captures. It rejects the exact
// failure mode where Chromium writes a structurally valid, all-black screenshot
// before the production canvas reaches the compositor.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const args = process.argv.slice(2);
const files = args.filter((arg) => !arg.startsWith('--'));
const option = (name, fallback) => {
    const prefix = `--${name}=`;
    const raw = args.find((arg) => arg.startsWith(prefix));
    return raw ? Number(raw.slice(prefix.length)) : fallback;
};

const expectedWidth = option('width', 1600);
const expectedHeight = option('height', 900);
const minimumVisibleRatio = option('min-visible-ratio', 0.05);
const minimumColors = option('min-colors', 32);
const minimumLumaRange = option('min-luma-range', 32);

if (!files.length || !Number.isInteger(expectedWidth) || !Number.isInteger(expectedHeight)
    || expectedWidth <= 0 || expectedHeight <= 0
    || !(minimumVisibleRatio > 0 && minimumVisibleRatio <= 1)
    || !Number.isInteger(minimumColors) || minimumColors < 2
    || !Number.isFinite(minimumLumaRange) || minimumLumaRange <= 0) {
    console.error('usage: node tools/artshot/validate-receipt-png.mjs <png...> '
        + '[--width=1600] [--height=900] [--min-visible-ratio=0.05] '
        + '[--min-colors=32] [--min-luma-range=32]');
    process.exit(2);
}

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function decodePng(filePath) {
    const png = fs.readFileSync(filePath);
    if (png.length < 33 || !png.subarray(0, 8).equals(signature)) {
        throw new Error('not a PNG');
    }

    let offset = 8;
    let width = 0;
    let height = 0;
    let channels = 0;
    const idat = [];
    while (offset + 12 <= png.length) {
        const length = png.readUInt32BE(offset);
        const chunkEnd = offset + 12 + length;
        if (chunkEnd > png.length) throw new Error('truncated PNG chunk');
        const type = png.toString('ascii', offset + 4, offset + 8);
        const data = png.subarray(offset + 8, offset + 8 + length);
        if (type === 'IHDR') {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            const bitDepth = data[8];
            const colorType = data[9];
            const interlace = data[12];
            if (bitDepth !== 8 || ![2, 6].includes(colorType) || interlace !== 0) {
                throw new Error(`unsupported PNG format (depth ${bitDepth}, color ${colorType}, interlace ${interlace})`);
            }
            channels = colorType === 6 ? 4 : 3;
        } else if (type === 'IDAT') {
            idat.push(data);
        } else if (type === 'IEND') {
            break;
        }
        offset = chunkEnd;
    }
    if (!width || !height || !channels || !idat.length) throw new Error('incomplete PNG payload');

    const packed = zlib.inflateSync(Buffer.concat(idat));
    const stride = width * channels;
    if (packed.length !== height * (stride + 1)) {
        throw new Error(`unexpected image payload length ${packed.length}`);
    }

    const previous = new Uint8Array(stride);
    const current = new Uint8Array(stride);
    const colors = new Set();
    let cursor = 0;
    let visible = 0;
    let minLuma = 255;
    let maxLuma = 0;

    const paeth = (a, b, c) => {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    };

    for (let y = 0; y < height; y++) {
        const filter = packed[cursor++];
        for (let x = 0; x < stride; x++) {
            const raw = packed[cursor++];
            const left = x >= channels ? current[x - channels] : 0;
            const up = previous[x];
            const upLeft = x >= channels ? previous[x - channels] : 0;
            let value = raw;
            if (filter === 1) value += left;
            else if (filter === 2) value += up;
            else if (filter === 3) value += (left + up) >> 1;
            else if (filter === 4) value += paeth(left, up, upLeft);
            else if (filter !== 0) throw new Error(`invalid PNG filter ${filter}`);
            current[x] = value & 0xff;
        }

        for (let x = 0; x < width; x++) {
            const pixel = x * channels;
            const r = current[pixel];
            const g = current[pixel + 1];
            const b = current[pixel + 2];
            const alpha = channels === 4 ? current[pixel + 3] : 255;
            if (alpha <= 8) continue;
            const luma = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
            minLuma = Math.min(minLuma, luma);
            maxLuma = Math.max(maxLuma, luma);
            if (Math.max(r, g, b) > 8) visible++;
            if (colors.size <= minimumColors) colors.add((r << 16) | (g << 8) | b);
        }
        previous.set(current);
    }

    return { width, height, visible, colors: colors.size, minLuma, maxLuma };
}

let failed = false;
for (const filePath of files) {
    try {
        const stats = decodePng(filePath);
        const pixels = stats.width * stats.height;
        const visibleRatio = stats.visible / pixels;
        const lumaRange = stats.maxLuma - stats.minLuma;
        const failures = [];
        if (stats.width !== expectedWidth || stats.height !== expectedHeight) {
            failures.push(`expected ${expectedWidth}x${expectedHeight}, found ${stats.width}x${stats.height}`);
        }
        if (visibleRatio < minimumVisibleRatio) {
            failures.push(`visible ratio ${(visibleRatio * 100).toFixed(2)}% is below ${(minimumVisibleRatio * 100).toFixed(2)}%`);
        }
        if (stats.colors < minimumColors) {
            failures.push(`only ${stats.colors} RGB colors (minimum ${minimumColors})`);
        }
        if (lumaRange < minimumLumaRange) {
            failures.push(`luma range ${lumaRange} is below ${minimumLumaRange}`);
        }
        if (failures.length) throw new Error(failures.join('; '));
        console.log(`PASS ${path.basename(filePath)}: ${stats.width}x${stats.height}, `
            + `${(visibleRatio * 100).toFixed(2)}% visible, ${stats.colors}+ colors, luma ${stats.minLuma}-${stats.maxLuma}`);
    } catch (error) {
        failed = true;
        console.error(`FAIL ${path.basename(filePath)}: ${error.message}`);
    }
}

if (failed) process.exit(1);
