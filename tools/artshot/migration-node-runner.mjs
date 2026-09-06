// Each invocation is a new realm. Do not run multiple fixtures in this process.
import { installNodeEnvironment } from './migration-node-environment.mjs';
import { runFixture } from './migration-fixture.mjs';
const environment = installNodeEnvironment();
const errors = [];
process.on('unhandledRejection', (error) => errors.push(`promise: ${String(error)}`));
try {
    const receipt = await runFixture({
        id: process.argv[2] || 'normal-desktop',
        seed: process.argv[3] === undefined ? undefined : Number(process.argv[3]),
        renderer: environment.renderer, errors,
        environment: { kind: 'node-procedural-stubs', storage: 'memory-only', audio: 'disabled',
            locks: 'disabled', viewport: [1920, 1080], renderSchedule: 'final-only' },
    });
    process.stdout.write(`MIGRATION_RECEIPT ${JSON.stringify(receipt)}\n`);
} catch (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
} finally {
    environment.restore();
}
