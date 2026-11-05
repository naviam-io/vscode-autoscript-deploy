/*
 * Unit tests for the CLI's terminal implementation of the core Ui port and logger.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Decision } from '../../../src/core/ui.js';
import { createTerminalUi, decisionAnswers } from '../../../cli/lib/terminal-ui.js';
import { createTerminalLogger } from '../../../cli/lib/terminal-log.js';

function sink() {
    let text = '';
    return { write: (chunk) => { text += chunk; }, text: () => text };
}

function terminal(config) {
    const stdout = sink();
    const stderr = sink();
    return { ...createTerminalUi({ answers: decisionAnswers(config), stdout, stderr }), stdout, stderr };
}

describe('CLI terminal Ui', () => {
    it('answers admin mode and e-signature from their options', async () => {
        const { ui, stdout } = terminal({ allowAdminMode: true, allowEsigDisable: true });

        assert.strictEqual(await ui.choose(Decision.ADMIN_MODE, 'Admin mode?', { actions: ['Yes'] }), 'Yes');
        assert.strictEqual(await ui.choose(Decision.DISABLE_ESIG, 'E-signature?', { actions: ['Yes'] }), 'Yes');
        assert.match(stdout.text(), /Answered Yes by --allowAdminMode/);
    });

    it('names the option when a decision is unanswered, and counts it as an error', async () => {
        const { ui, stderr, errorCount } = terminal({});

        assert.strictEqual(await ui.choose(Decision.ADMIN_MODE, 'Admin mode?', { actions: ['Yes'] }), undefined);
        assert.strictEqual(await ui.choose(Decision.RETAINED_SNAPSHOT, 'Restore?', { actions: ['Restore', 'Discard'] }), undefined);
        assert.match(stderr.text(), /pass --allowAdminMode to answer it/);
        assert.match(stderr.text(), /pass --retainedSnapshots restore\|discard to answer it/);
        assert.strictEqual(errorCount(), 2);
    });

    it('answers retained snapshots as configured', async () => {
        assert.strictEqual(await terminal({ retainedSnapshots: 'discard' }).ui.choose(Decision.RETAINED_SNAPSHOT, 'Restore?', { actions: ['Restore', 'Discard'] }), 'Discard');
        assert.strictEqual(await terminal({ retainedSnapshots: 'restore' }).ui.choose(Decision.RETAINED_SNAPSHOT, 'Restore?', { actions: ['Restore', 'Discard'] }), 'Restore');
    });

    it('stops when the snapshot lookup failed', async () => {
        const { ui, stderr } = terminal({ allowAdminMode: true, retainedSnapshots: 'restore' });

        assert.strictEqual(await ui.choose(Decision.SNAPSHOT_LOOKUP_FAILED, 'Continue?', { actions: ['Continue'] }), undefined);
        assert.match(stderr.text(), /cannot be answered from the command line/);
    });

    it('replaces differing files unless overwrite is off', async () => {
        const actions = { actions: ['Replace', 'Replace All', 'Skip'] };

        assert.strictEqual(await terminal({}).ui.choose(Decision.OVERWRITE, 'Replace?', actions), 'Replace All');
        assert.strictEqual(await terminal({ overwrite: false }).ui.choose(Decision.OVERWRITE, 'Replace?', actions), 'Skip');
    });

    it('counts errors and writes them to stderr', async () => {
        const { ui, errorCount, stderr, stdout } = terminal({});

        await ui.error('Something failed.', { detail: 'Because.' });
        await ui.info('Done.');

        assert.strictEqual(errorCount(), 1);
        assert.strictEqual(stderr.text(), 'Error: Something failed.\nBecause.\n');
        assert.strictEqual(stdout.text(), 'Done.\n');
    });

    it('prints a repeated progress message once, without codicons or warnings', async () => {
        const { ui, stdout } = terminal({});

        const result = await ui.withProgress({ title: 'Deploy' }, async (progress, token) => {
            progress.report({ message: '$(gear) Applying configuration' });
            progress.report({ message: 'Applying configuration' });
            progress.report({ increment: 50 });
            progress.report({ message: '\u26a0\ufe0f Already exists' });
            progress.report({ message: 'Done' });
            return token.isCancellationRequested ? 'cancelled' : 'finished';
        });

        assert.strictEqual(result, 'finished');
        assert.strictEqual(stdout.text(), 'Applying configuration\nDone\n');
    });
});

describe('CLI terminal logger', () => {
    it('writes only warnings unless verbose', () => {
        const stderr = sink();
        const logger = createTerminalLogger({ verbose: false, stderr });

        logger.info('info', 'Source');
        logger.error('error', new Error('cause'), 'Source');
        logger.warn('careful', 'Source');

        assert.strictEqual(stderr.text(), 'Warning: careful\n');
    });

    it('writes everything with its level and source when verbose', () => {
        const stderr = sink();
        const logger = createTerminalLogger({ verbose: true, stderr });

        logger.debug('detail', 'Source');
        logger.error('failed', new Error('cause'), 'Source');

        assert.match(stderr.text(), /^\[debug\] \[Source\] detail\n\[error\] \[Source\] failed\nError: cause/);
    });
});
