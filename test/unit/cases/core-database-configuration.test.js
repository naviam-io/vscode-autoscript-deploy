import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createRecordingUi } from '../support/recording-ui.js';
import { performDatabaseConfiguration } from '../../../src/core/deploy/database-configuration.js';
import { Decision } from '../../../src/core/ui.js';

function fakeClient({ required = true, adminMode = true, esig = null, messages = '' } = {}) {
    const log = [];
    let adminModeOn = false;
    let inProgress = 0;
    return {
        log,
        dbConfigRequired: async () => required,
        dbConfigRequiresAdminMode: async () => adminMode,
        getAdminModeEsigEnabled: async () => esig,
        setAdminModeEsigEnabled: async (value) => log.push(['esig', value]),
        setAdminMode: async (on) => { log.push([on ? 'adminModeOn' : 'adminModeOff']); adminModeOn = on; },
        isAdminModeOn: async () => adminModeOn,
        applyDBConfig: async () => { log.push(['applyDBConfig']); inProgress = 2; },
        dbConfigInProgress: async () => inProgress-- > 0,
        dbConfigMessages: async () => messages
    };
}

describe('performDatabaseConfiguration', () => {
    it('does nothing when no configuration is pending', async () => {
        const client = fakeClient({ required: false });
        const { ui, calls } = createRecordingUi();

        assert.strictEqual(await performDatabaseConfiguration(client, ui, {}, { pollIntervalMs: 0 }), true);
        assert.deepStrictEqual(calls, []);
        assert.deepStrictEqual(client.log, []);
    });

    it('stops without admin mode when the configuration forbids it', async () => {
        const client = fakeClient();
        const { ui, calls } = createRecordingUi({ answers: { [Decision.ADMIN_MODE]: 'Yes' } });

        assert.strictEqual(await performDatabaseConfiguration(client, ui, { noAdminMode: true }, { pollIntervalMs: 0 }), false);
        assert.ok(calls.some((call) => call.method === 'info'));
        assert.ok(!calls.some((call) => call.method === 'choose'));
        assert.deepStrictEqual(client.log, []);
    });

    it('stops when the user declines admin mode', async () => {
        const client = fakeClient();
        const { ui } = createRecordingUi();

        assert.strictEqual(await performDatabaseConfiguration(client, ui, {}, { pollIntervalMs: 0 }), false);
        assert.deepStrictEqual(client.log, []);
    });

    it('turns admin mode on, applies the configuration and turns it off when the user agrees', async () => {
        const client = fakeClient();
        const { ui } = createRecordingUi({ answers: { [Decision.ADMIN_MODE]: 'Yes' } });

        assert.strictEqual(await performDatabaseConfiguration(client, ui, {}, { pollIntervalMs: 0 }), true);
        assert.deepStrictEqual(client.log, [['adminModeOn'], ['applyDBConfig'], ['adminModeOff']]);
    });

    it('disables and restores e-signature around the configuration when the user agrees', async () => {
        const esig = { ADMINMODE: true, CONFIGURE: false };
        const client = fakeClient({ esig });
        const { ui } = createRecordingUi({ answers: { [Decision.ADMIN_MODE]: 'Yes', [Decision.DISABLE_ESIG]: 'Yes' } });

        assert.strictEqual(await performDatabaseConfiguration(client, ui, {}, { pollIntervalMs: 0 }), true);
        assert.deepStrictEqual(client.log[0], ['esig', { ADMINMODE: 0, CONFIGURE: 0 }]);
        assert.deepStrictEqual(client.log[client.log.length - 1], ['esig', esig]);
    });

    it('applies a live configuration without admin mode, disabling only the CONFIGURE e-signature', async () => {
        const esig = { ADMINMODE: true, CONFIGURE: true };
        const client = fakeClient({ adminMode: false, esig });
        const { ui, calls } = createRecordingUi({ answers: { [Decision.DISABLE_ESIG]: 'Yes' } });

        assert.strictEqual(await performDatabaseConfiguration(client, ui, {}, { pollIntervalMs: 0 }), true);
        assert.ok(!calls.some((call) => call.method === 'choose' && call.decision === Decision.ADMIN_MODE));
        assert.deepStrictEqual(client.log, [['esig', { CONFIGURE: 0 }], ['applyDBConfig'], ['esig', esig]]);
    });

    it('stops when the user declines disabling e-signature', async () => {
        const client = fakeClient({ esig: { ADMINMODE: true } });
        const { ui } = createRecordingUi({ answers: { [Decision.ADMIN_MODE]: 'Yes' } });

        assert.strictEqual(await performDatabaseConfiguration(client, ui, {}, { pollIntervalMs: 0 }), false);
        assert.deepStrictEqual(client.log, []);
    });

    it('fails on an error message in admin mode and still restores e-signature', async () => {
        const esig = { ADMINMODE: true, CONFIGURE: false };
        const client = fakeClient({ esig, messages: 'BMXAA0001I - started\nBMXAA1234E - broken' });
        const { ui } = createRecordingUi({ answers: { [Decision.ADMIN_MODE]: 'Yes', [Decision.DISABLE_ESIG]: 'Yes' } });

        await assert.rejects(performDatabaseConfiguration(client, ui, {}, { pollIntervalMs: 0 }), /BMXAA1234E/);
        assert.deepStrictEqual(client.log[client.log.length - 1], ['esig', esig]);
    });
});
