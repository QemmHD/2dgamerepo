#!/usr/bin/env node

// Wait for the harness's own machine-readable receipt through the Chrome
// DevTools Protocol. `--dump-dom` captures when its virtual-time budget expires,
// which can race browser-process work such as Web Locks and the final PNG PUT.
// This dependency-free driver waits on data-qa-ready instead of guessing a
// delay, then serializes the exact DOM used by the existing shell assertions.

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

function optionsFrom(argv) {
    const options = {};
    for (const raw of argv) {
        if (!raw.startsWith('--')) continue;
        const split = raw.indexOf('=');
        const key = raw.slice(2, split < 0 ? undefined : split);
        options[key] = split < 0 ? '1' : raw.slice(split + 1);
    }
    return options;
}

function required(options, key) {
    const value = options[key];
    if (!value) throw new Error(`missing --${key}=...`);
    return value;
}

function parseDimensions(value, label) {
    const match = /^(\d+),(\d+)$/.exec(String(value || ''));
    if (!match) throw new Error(`${label} must be WIDTH,HEIGHT`);
    const width = Number.parseInt(match[1], 10);
    const height = Number.parseInt(match[2], 10);
    if (width < 1 || height < 1 || width > 8192 || height > 8192) {
        throw new Error(`${label} is outside the supported 1..8192 range`);
    }
    return { width, height };
}

function optionBoolean(options, key) {
    if (!(key in options)) return false;
    if (!['0', '1'].includes(options[key])) throw new Error(`--${key} must be 0 or 1`);
    return options[key] === '1';
}

async function waitUntil(read, accept, timeoutMs, label) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
        try {
            const value = await read();
            if (accept(value)) return value;
        } catch (error) {
            lastError = error;
        }
        await delay(50);
    }
    throw new Error(`${label} timed out after ${timeoutMs}ms${lastError ? `: ${lastError.message}` : ''}`);
}

class CdpConnection {
    constructor(url) {
        if (typeof WebSocket !== 'function') {
            throw new Error('Node 24+ WebSocket support is required');
        }
        this.socket = new WebSocket(url);
        this.serial = 0;
        this.pending = new Map();
    }

    async open(timeoutMs) {
        let timeoutId;
        try {
            await Promise.race([
                new Promise((resolveOpen, rejectOpen) => {
                    this.socket.addEventListener('open', resolveOpen, { once: true });
                    this.socket.addEventListener('error', () => rejectOpen(new Error('DevTools WebSocket failed')), { once: true });
                }),
                new Promise((_, rejectTimeout) => {
                    timeoutId = setTimeout(
                        () => rejectTimeout(new Error('DevTools WebSocket timed out')),
                        timeoutMs,
                    );
                }),
            ]);
        } finally {
            clearTimeout(timeoutId);
        }
        this.socket.addEventListener('message', (event) => {
            let message;
            try { message = JSON.parse(String(event.data)); } catch { return; }
            if (!message.id) return;
            const waiter = this.pending.get(message.id);
            if (!waiter) return;
            this.pending.delete(message.id);
            if (message.error) waiter.reject(new Error(message.error.message || 'CDP command failed'));
            else waiter.resolve(message.result || {});
        });
        this.socket.addEventListener('close', () => {
            for (const waiter of this.pending.values()) waiter.reject(new Error('DevTools WebSocket closed'));
            this.pending.clear();
        }, { once: true });
    }

    send(method, params = {}) {
        const id = ++this.serial;
        return new Promise((resolveSend, rejectSend) => {
            this.pending.set(id, { resolve: resolveSend, reject: rejectSend });
            this.socket.send(JSON.stringify({ id, method, params }));
        });
    }

    close() {
        try { this.socket.close(); } catch {}
    }
}

async function main() {
    const options = optionsFrom(process.argv.slice(2));
    const chrome = required(options, 'chrome');
    const url = required(options, 'url');
    const domPath = resolve(required(options, 'dom'));
    const profile = resolve(required(options, 'profile'));
    const windowSize = options.window || '1280,720';
    const timeoutMs = Math.max(1000, Number.parseInt(options.timeout || '30000', 10) || 30000);
    const viewport = options.viewport ? parseDimensions(options.viewport, '--viewport') : null;
    const mobile = optionBoolean(options, 'mobile');
    const touch = optionBoolean(options, 'touch');
    const deviceScaleFactor = Number.parseFloat(options['device-scale'] || '1');
    if (!(deviceScaleFactor > 0) || deviceScaleFactor > 4) {
        throw new Error('--device-scale must be greater than 0 and at most 4');
    }
    const userAgent = options['user-agent'] || '';
    const screenshotPath = options.screenshot ? resolve(options.screenshot) : null;
    const emulate = !!viewport || mobile || touch || !!userAgent || options['device-scale'] != null;
    await mkdir(profile, { recursive: true });
    await mkdir(dirname(domPath), { recursive: true });
    if (screenshotPath) await mkdir(dirname(screenshotPath), { recursive: true });

    const browserArgs = [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--mute-audio',
        '--autoplay-policy=no-user-gesture-required',
        '--disable-background-networking',
        '--disable-component-update',
        '--force-device-scale-factor=1',
        `--window-size=${windowSize}`,
        `--user-data-dir=${profile}`,
        '--remote-debugging-port=0',
        emulate ? 'about:blank' : url,
    ];
    const child = spawn(chrome, browserArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    const childExit = new Promise((resolveExit) => child.once('exit', resolveExit));
    let diagnostics = '';
    const captureDiagnostic = (chunk) => {
        diagnostics = (diagnostics + String(chunk)).slice(-12000);
    };
    child.stdout.on('data', captureDiagnostic);
    child.stderr.on('data', captureDiagnostic);

    let cdp = null;
    let latest = { ready: '', title: '', html: '' };
    try {
        const portFile = resolve(profile, 'DevToolsActivePort');
        const portText = await waitUntil(
            async () => readFile(portFile, 'utf8'),
            (value) => /^\d+/m.test(value),
            Math.min(timeoutMs, 10000),
            'Chrome DevTools port',
        );
        const port = Number.parseInt(portText.split(/\r?\n/, 1)[0], 10);
        const targets = await waitUntil(
            async () => {
                const response = await fetch(`http://127.0.0.1:${port}/json/list`);
                if (!response.ok) throw new Error(`target list returned ${response.status}`);
                return response.json();
            },
            (entries) => Array.isArray(entries) && entries.some((entry) => (
                entry.type === 'page' && entry.webSocketDebuggerUrl
            )),
            Math.min(timeoutMs, 10000),
            'Chrome page target',
        );
        const target = targets.find((entry) => (
            entry.type === 'page' && entry.webSocketDebuggerUrl
            && entry.url && entry.url !== 'about:blank'
        )) || targets.find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl);
        cdp = new CdpConnection(target.webSocketDebuggerUrl);
        await cdp.open(Math.min(timeoutMs, 10000));
        await cdp.send('Runtime.enable');
        if (emulate) {
            if (!viewport) throw new Error('--viewport is required when mobile emulation is enabled');
            await cdp.send('Page.enable');
            await cdp.send('Network.enable');
            const portrait = viewport.height > viewport.width;
            await cdp.send('Emulation.setDeviceMetricsOverride', {
                width: viewport.width,
                height: viewport.height,
                deviceScaleFactor,
                mobile,
                screenWidth: viewport.width,
                screenHeight: viewport.height,
                screenOrientation: {
                    type: portrait ? 'portraitPrimary' : 'landscapePrimary',
                    angle: portrait ? 0 : 90,
                },
            });
            await cdp.send('Emulation.setTouchEmulationEnabled', {
                enabled: touch,
                maxTouchPoints: touch ? 5 : 1,
            });
            if (userAgent) {
                await cdp.send('Network.setUserAgentOverride', {
                    userAgent,
                    platform: mobile ? 'Android' : '',
                });
            }
            await cdp.send('Page.navigate', { url });
        }

        latest = await waitUntil(
            async () => {
                const result = await cdp.send('Runtime.evaluate', {
                    expression: `(() => ({
                        ready: document.documentElement?.dataset?.qaReady || '',
                        title: document.title || '',
                        html: document.documentElement?.outerHTML || ''
                    }))()`,
                    returnByValue: true,
                });
                return result.result?.value || { ready: '', title: '', html: '' };
            },
            (value) => value.ready === '1' || String(value.title || '').startsWith('BOOTFAIL '),
            timeoutMs,
            'harness data-qa-ready receipt',
        );
        await writeFile(domPath, latest.html, 'utf8');
        if (screenshotPath) {
            await cdp.send('Page.bringToFront');
            const screenshot = await cdp.send('Page.captureScreenshot', {
                format: 'png',
                fromSurface: true,
                captureBeyondViewport: false,
            });
            if (!screenshot.data) throw new Error('Page.captureScreenshot returned no PNG data');
            await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
        }
        process.stdout.write(`Harness CDP receipt: ${latest.title || '<missing title>'}\n`);
    } catch (error) {
        if (latest.html) await writeFile(domPath, latest.html, 'utf8');
        throw new Error(`${error.message}\nChrome diagnostics:\n${diagnostics || '<none>'}`);
    } finally {
        cdp?.close();
        let exited = child.exitCode !== null || child.signalCode !== null;
        if (!exited) child.kill();
        let exitTimeoutId;
        await Promise.race([
            childExit.then(() => { exited = true; }),
            new Promise((resolveTimeout) => {
                exitTimeoutId = setTimeout(resolveTimeout, 2000);
            }),
        ]);
        clearTimeout(exitTimeoutId);
        if (!exited) child.kill('SIGKILL');
    }
}

main().catch((error) => {
    console.error(`capture-harness: ${error.stack || error}`);
    process.exitCode = 1;
});
