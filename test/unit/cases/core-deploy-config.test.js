import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createRecordingUi } from '../support/recording-ui.js';
import { deployConfig } from '../../../src/core/deploy/deploy-config.js';
import { confirmRetainedSnapshots } from '../../../src/core/deploy/retained-snapshot-gate.js';
import { Decision } from '../../../src/core/ui.js';

const RETAINING = { domains: [{ domainId: 'CORETEST', _retain: ['description'] }] };
const SNAPSHOT = { key: 'k1', type: 'domains', identity: 'CORETEST', capturedOn: Date.now() };

describe('confirmRetainedSnapshots', () => {
    it('does not ask Maximo when the payload retains nothing', async () => {
        const client = { listRetainedSnapshots: async () => assert.fail('should not be called') };
        const { ui } = createRecordingUi();
        assert.strictEqual(await confirmRetainedSnapshots(client, ui, { domains: [{ domainId: 'X' }] }), true);
    });

    it('discards the snapshots the user chooses to discard', async () => {
        const discarded = [];
        const client = { listRetainedSnapshots: async () => [SNAPSHOT], discardRetainedSnapshots: async (keys) => discarded.push(...keys) };
        const { ui } = createRecordingUi({ answers: { [Decision.RETAINED_SNAPSHOT]: 'Discard' } });

        assert.strictEqual(await confirmRetainedSnapshots(client, ui, RETAINING), true);
        assert.deepStrictEqual(discarded, ['k1']);
    });

    it('abandons the deployment when the prompt is dismissed', async () => {
        const client = { listRetainedSnapshots: async () => [SNAPSHOT], discardRetainedSnapshots: async () => assert.fail('should not discard') };
        const { ui } = createRecordingUi();
        assert.strictEqual(await confirmRetainedSnapshots(client, ui, RETAINING), false);
    });
});

describe('deployConfig', () => {
    it('posts the configuration and reports success', async () => {
        const posted = [];
        const client = { postConfig: async (config) => posted.push(config) };
        const { ui } = createRecordingUi();

        assert.strictEqual(await deployConfig(client, ui, { properties: [] }), true);
        assert.deepStrictEqual(posted, [{ properties: [] }]);
    });

    it('shows the error and reports failure when Maximo rejects it', async () => {
        const client = { postConfig: async () => { throw new Error('BMXAA0001E rejected'); } };
        const { ui, calls } = createRecordingUi();

        assert.strictEqual(await deployConfig(client, ui, { properties: [] }), false);
        assert.deepStrictEqual(calls.filter((call) => call.method === 'error').map((call) => call.message), ['BMXAA0001E rejected']);
    });
});

describe('deployConfig database configuration', () => {
    const OBJECTS = { objects: [{ object: 'NVTEST' }] };

    function dbConfigClient({ required = false, adminMode = true, post = async () => {} } = {}) {
        const log = [];
        return {
            log,
            postConfig: post,
            dbConfigRequired: async () => {
                log.push('dbConfigRequired');
                return required;
            },
            dbConfigRequiresAdminMode: async () => adminMode,
            applyDBConfig: async () => log.push('applyDBConfig')
        };
    }

    it('checks for pending database configuration when the configuration declares objects', async () => {
        const client = dbConfigClient();
        const { ui } = createRecordingUi();

        assert.strictEqual(await deployConfig(client, ui, OBJECTS), true);
        assert.deepStrictEqual(client.log, ['dbConfigRequired']);
    });

    it('accepts the legacy maxObjects name and a configuration passed as text', async () => {
        const client = dbConfigClient();
        const { ui } = createRecordingUi();

        assert.strictEqual(await deployConfig(client, ui, JSON.stringify({ maxObjects: [{ object: 'NVTEST' }] })), true);
        assert.deepStrictEqual(client.log, ['dbConfigRequired']);
    });

    it('does not run without objects, with noDBConfig, or when the caller applies it separately', async () => {
        const { ui } = createRecordingUi();
        const cases = [
            [{ properties: [] }, undefined],
            [{ objects: [] }, undefined],
            [Object.assign({ noDBConfig: true }, OBJECTS), undefined],
            [OBJECTS, { databaseConfiguration: false }]
        ];

        for (const [config, options] of cases) {
            const client = dbConfigClient({ required: true });
            assert.strictEqual(await deployConfig(client, ui, config, options), true);
            assert.deepStrictEqual(client.log, [], JSON.stringify(config));
        }
    });

    it('does not run when the configuration could not be applied', async () => {
        const client = dbConfigClient({ required: true, post: async () => { throw new Error('rejected'); } });
        const { ui } = createRecordingUi();

        assert.strictEqual(await deployConfig(client, ui, OBJECTS), false);
        assert.deepStrictEqual(client.log, []);
    });

    it('stops without admin mode when the configuration sets noAdminMode', async () => {
        const client = dbConfigClient({ required: true });
        const { ui, calls } = createRecordingUi({ answers: { [Decision.ADMIN_MODE]: 'Yes' } });

        assert.strictEqual(await deployConfig(client, ui, Object.assign({ noAdminMode: true }, OBJECTS)), false);
        assert.ok(!calls.some((call) => call.method === 'choose'));
        assert.deepStrictEqual(client.log, ['dbConfigRequired']);
    });
});
