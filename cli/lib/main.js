/*
 * Runs one CLI command and returns the process exit code. See docs/flows/cli.md.
 */
import MaximoClient from '../../src/core/maximo/maximo-client.js';
import { setLogger } from '../../src/core/log.js';
import { resolveConfiguration, validateConfiguration } from './configuration.js';
import { decryptCredentials, encryptSettingsFile } from './credentials.js';
import { createTypeScriptBuild, describeError, runDeploy } from './deploy.js';
import { runExtract } from './extract.js';
import { buildParser } from './options.js';
import { createMaximoConfig, openSession } from './session.js';
import { DEFAULT_SETTINGS_FILE, loadSettings } from './settings.js';
import { createTerminalLogger } from './terminal-log.js';
import { createTerminalUi, decisionAnswers } from './terminal-ui.js';

/**
 * @param {string[]} argv the arguments after the executable and script
 * @param {{ resourcesDir: string, version?: string, stdout?: { write: Function }, stderr?: { write: Function }, signals?: NodeJS.EventEmitter }} options
 * @returns {Promise<number>}
 */
export async function main(argv, { resourcesDir, version, stdout = process.stdout, stderr = process.stderr, signals = process }) {
    const out = (text) => stdout.write(text + '\n');
    const fail = (message) => {
        stderr.write(`Error: ${message}\n`);
        return 1;
    };

    let args;
    try {
        args = await buildParser(argv, version).parseAsync();
    } catch (error) {
        return fail(describeError(error));
    }

    const command = String(args._[0]);
    setLogger(createTerminalLogger({ verbose: Boolean(args.verbose), stderr }));

    let config;
    try {
        const { settings, settingsFile } = loadSettings(args.settings || DEFAULT_SETTINGS_FILE, { explicit: typeof args.settings !== 'undefined' });

        if (command === 'encrypt') {
            if (!settingsFile) {
                return fail(`The settings file ${args.settings || DEFAULT_SETTINGS_FILE} cannot be read, so there is nothing to encrypt.`);
            }
            const keyFile = encryptSettingsFile(settingsFile, typeof args.key !== 'undefined' ? args.key : settings.key);
            out(`The settings in ${settingsFile} were encrypted with the key ${keyFile}.`);
            return 0;
        }

        config = decryptCredentials(resolveConfiguration(command, args, settings, settingsFile), (message) => stderr.write(`Warning: ${message}\n`));
        validateConfiguration(config);
    } catch (error) {
        return fail(describeError(error));
    }

    const { ui, errorCount } = createTerminalUi({ answers: decisionAnswers(config), stdout, stderr });
    const client = new MaximoClient(createMaximoConfig(config, resourcesDir));

    let failed = 0;
    try {
        await openSession(client, config, out);

        switch (command) {
        case 'deploy':
            failed = (await runDeploy(client, ui, config, { buildTypeScript: createTypeScriptBuild(ui), out })).failed;
            break;
        case 'extract':
            failed = (await runExtract(client, ui, config, { out })).failed;
            break;
        case 'log':
            await streamLog(client, config, stdout, signals);
            break;
        }
    } catch (error) {
        await ui.error(describeError(error));
    } finally {
        try {
            await client.disconnect();
        } catch {
            // The session is ending either way.
        }
    }

    return failed > 0 || errorCount() > 0 ? 1 : 0;
}

async function streamLog(client, config, stdout, signals) {
    const stop = () => client.stopLogging();
    signals.once('SIGINT', stop);
    try {
        await client.startLogging((text) => stdout.write(text), config.logTimeout);
    } finally {
        signals.removeListener('SIGINT', stop);
    }
}
