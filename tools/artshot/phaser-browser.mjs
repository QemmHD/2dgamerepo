// The harness loads the ACTUAL public entry and its styles/components. It does
// not reproduce boot configuration, save construction or the verification scene.
let frame;
let current;
const detached = value => JSON.parse(JSON.stringify(value));

async function cycle() {
    delete document.documentElement.dataset.qaReady;
    if (current) await current.dispose();
    frame?.remove();
    frame = document.createElement('iframe');
    frame.id = 'experiment-frame';
    frame.title = 'Isolated Phaser runtime experiment';
    const loaded = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('experiment-frame-timeout')), 20000);
        frame.addEventListener('load', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
    frame.src = '../../phaser.html';
    document.body.append(frame);
    await loaded;
    current = frame.contentWindow.__phaserExperiment;
    if (!current) throw new Error('experimental-entry-api-missing');
    const receipt = await current.ready;
    window.__phaserMigrationReceipt = detached(receipt);
    document.body.dataset.qaReady = 'true';
    document.documentElement.dataset.qaReady = '1';
    if (!receipt.boot.frameRendered) {
        const error = document.createElement('p');
        error.textContent = `BOOTFAIL: ${receipt.failure}`;
        document.title = error.textContent;
        document.body.append(error);
        throw new Error(error.textContent);
    }
    document.title = 'EMBERWAKE — Phaser WebGL ready';
    return detached(receipt);
}
window.__phaserHarness = { ready: null, cycle,
    receipt: () => detached(current.receipt()),
    // Keep the disposed iframe until the next cycle so independent probes can
    // inspect its zero-resource state BEFORE document destruction masks leaks.
    dispose: () => current.dispose(),
};
window.__phaserHarness.ready = cycle();
