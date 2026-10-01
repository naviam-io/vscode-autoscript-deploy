import * as fs from 'fs';
import * as path from 'path';

import { window, ProgressLocation } from 'vscode';

import MaximoClient from '../maximo/maximo-client';
import confirmRetainedSnapshots from './confirm-retained-snapshots';
import { resolveScriptCompanions } from '../deploy/script-companions';
import Logger from '../logger';

const LOG_SOURCE = 'DeployScriptCommand';

const MANUAL_CONFIG_MESSAGE =
    'The script cannot be deployed until the database configurations have been applied.\n\n' +
    'The configurations have been added to Maximo and can be manually applied by an administrator.';

/**
 * Deploys an automation script.
 *
 * @param {*} client the Maximo client
 * @param {string} filePath the path of the script file
 * @param {string} script the script source; read from filePath when empty
 * @param {{ sidecars?: boolean, companionPath?: string }} [options] set sidecars to false to deploy the source only, without
 *     the conventional predeploy/deploy companion files. Entries in a deployment manifest that
 *     declare a kind use this; deploying a file directly does not. Set companionPath to the original
 *     source file when filePath is a build output, so that companions are found beside the source.
 * @returns {Promise<boolean>} whether the script was deployed
 */
export default async function deployScript(client, filePath, script, options) {
    const useSidecars = !options || options.sidecars !== false;
    Logger.info(`Deploying script from ${filePath || 'unknown file'}${useSidecars ? '' : ' (source only)'}.`, LOG_SOURCE);

    if (!client || !(client instanceof MaximoClient)) {
        Logger.error('Deploy script command failed because the Maximo client is invalid.', null, LOG_SOURCE);
        throw new Error('The client parameter is required and must be an instance of the MaximoClient class.');
    }

    if (!filePath || !fs.existsSync(filePath)) {
        Logger.error(`Deploy script command failed because the file path is invalid: ${filePath || 'empty'}.`, null, LOG_SOURCE);
        throw new Error('The filePath parameter is required and must be a valid file path to a script file.');
    }

    const fileName = path.basename(filePath);
    const { deployFileName, deployDotFileName, deployJSONFileName, preDeployJSONFileName } = resolveScriptCompanions(filePath, options);

    if (!script || script.trim().length === 0) {
        script = fs.readFileSync(filePath, { encoding: 'utf8' });
    }

    if (!script || script.trim().length <= 0) {
        Logger.error(`Script ${filePath} is empty.`, null, LOG_SOURCE);
        window.showErrorMessage('The selected script cannot be empty.', { modal: true });
        return false;
    }

    let scriptDeploy;
    if (useSidecars) {
        if (fs.existsSync(deployFileName)) {
            scriptDeploy = fs.readFileSync(deployFileName);
        } else if (fs.existsSync(deployDotFileName)) {
            scriptDeploy = fs.readFileSync(deployDotFileName);
        }
    }

    if (!(await _runPreDeploy(client, preDeployJSONFileName))) {
        return false;
    }

    return await _deployScriptFile(client, script, fileName, scriptDeploy, deployJSONFileName);
}

async function _runPreDeploy(client, preDeployJSONFileName) {
    if (!preDeployJSONFileName || !fs.existsSync(preDeployJSONFileName)) {
        return true;
    }

    const preConfigDeploy = fs.readFileSync(preDeployJSONFileName, 'utf8');

    if (!(await confirmRetainedSnapshots(client, preConfigDeploy))) {
        return false;
    }

    await _applyPreConfig(client, preConfigDeploy);

    const preDeployConfig = JSON.parse(preConfigDeploy);

    if (_declaresObjects(preDeployConfig) && (typeof preDeployConfig.noDBConfig === 'undefined' || preDeployConfig.noDBConfig === false)) {
        if (!(await performDatabaseConfiguration(client, preDeployConfig))) {
            return false;
        }
    }

    return true;
}

async function _applyPreConfig(client, preConfigDeploy) {
    await window.withProgress(
        {
            cancellable: false,
            title: 'Pre-deployment',
            location: ProgressLocation.Notification
        },
        async (progress) => {
            progress.report({
                message: 'Applying configurations.',
                increment: 50
            });

            await new Promise((resolve) => setTimeout(resolve, 500));
            await client.postConfig(preConfigDeploy);
            progress.report({
                message: 'Configurations applied.',
                increment: 100
            });
            await new Promise((resolve) => setTimeout(resolve, 1500));
        }
    );
}

async function _deployScriptFile(client, script, fileName, scriptDeploy, deployJSONFileName) {
    return await window.withProgress(
        {
            cancellable: true,
            title: 'Script',
            location: ProgressLocation.Notification
        },
        async (progress, token) => {
            progress.report({
                message: `Deploying script ${fileName}`,
                increment: 0
            });

            await new Promise((resolve) => setTimeout(resolve, 500));

            const result = await client.postScript(script, progress, fileName, scriptDeploy, token);

            if (!result) {
                Logger.error(`Script deploy did not receive a response from Maximo for ${fileName}.`, null, LOG_SOURCE);
                window.showErrorMessage('Did not receive a response from Maximo.', { modal: true });
                return false;
            }

            if (result.status === 'error') {
                _showDeployError(result, fileName);
                return false;
            }

            return await _handleDeploySuccess(client, result, fileName, deployJSONFileName, progress, token);
        }
    );
}

function _showDeployError(result, fileName) {
    Logger.error(`Script deploy failed for ${fileName}: ${result.message || result.error || JSON.stringify(result)}`, null, LOG_SOURCE);
    if (result.message) {
        window.showErrorMessage(result.message, {
            modal: true
        });
    } else if (result.cause) {
        window.showErrorMessage(`Error: ${JSON.stringify(result.cause)}`, { modal: true });
    } else if (result.error) {
        if (result.error.startsWith('Error:')) {
            window.showErrorMessage(JSON.stringify(result.error), { modal: true });
        } else {
            window.showErrorMessage(`Error: ${JSON.stringify(result.error)}`, { modal: true });
        }
    } else {
        window.showErrorMessage('An unknown error occurred: ' + JSON.stringify(result), { modal: true });
    }
}

async function _handleDeploySuccess(client, result, fileName, deployJSONFileName, progress, token) {
    if (deployJSONFileName && fs.existsSync(deployJSONFileName)) {
        const configDeploy = fs.readFileSync(deployJSONFileName);

        if (!(await confirmRetainedSnapshots(client, configDeploy))) {
            return false;
        }

        progress.report({ message: 'Applying Configurations' });

        await client.postConfig(configDeploy, token, progress);

        // @ts-ignore
        const deployConfig = JSON.parse(configDeploy);
        if (_declaresObjects(deployConfig)) {
            if (!(await performDatabaseConfiguration(client, deployConfig))) {
                return false;
            }
        }
    }

    if (typeof result.deleted !== 'undefined' && result.deleted === true) {
        progress.report({
            increment: 100,
            message: `Successfully deleted ${fileName}`
        });
        Logger.info(`Script ${fileName} deleted successfully.`, LOG_SOURCE);
    } else {
        progress.report({
            increment: 100,
            message: `Successfully deployed ${fileName}`
        });
        Logger.info(`Script ${fileName} deployed successfully.`, LOG_SOURCE);
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));

    return true;
}

/*
 * Whether a deployment configuration declares objects (MAXOBJECTCFG), and so may need a database
 * configuration. "maxObjects" is the historical name and "objects" the current one; both are
 * accepted so that either spelling triggers the cycle.
 */
function _declaresObjects(config) {
    return (Array.isArray(config.maxObjects) && config.maxObjects.length > 0) || (Array.isArray(config.objects) && config.objects.length > 0);
}

/**
 * Applies any pending database configuration, taking Admin Mode when Maximo says it is required and
 * the user agrees to it.
 *
 * @param {*} client the Maximo client
 * @param {object} [config] the deployment configuration that caused the change, if any
 * @returns {Promise<boolean>} whether the database is now configured
 */
export async function performDatabaseConfiguration(client, config) {
    if (!(await client.dbConfigRequired())) {
        Logger.info('No database configuration is pending.', LOG_SOURCE);
        return true;
    }

    Logger.info('Database configuration is required.', LOG_SOURCE);

    if (await client.dbConfigRequiresAdminMode()) {
        return await _configureWithAdminMode(client, config || {});
    } else {
        return await _configureWithoutAdminMode(client);
    }
}

async function _configureWithAdminMode(client, config) {
    if (typeof config.noAdminMode !== 'undefined' && config.noAdminMode !== false) {
        Logger.info('Skipping automatic Admin Mode because deployment configuration disallows it.', LOG_SOURCE);
        await window.showInformationMessage(
            'The script deployment specifies that Admin Mode should not be applied, but the script cannot be deployed until the database configurations have been applied.\n\n' +
            'The configurations have been added to Maximo and can be manually applied by an administrator.',
            { modal: true }
        );
        return false;
    }

    const userConfirmation = await window.showInformationMessage(
        'The script has deployment configurations that require Admin Mode to be applied.\n\n' +
        'This will logout all users and make the server unavailable while the configuration is performed. Do you want to continue?',
        { modal: true },
        'Yes'
    );

    if (userConfirmation !== 'Yes') {
        Logger.info('User declined Admin Mode for database configuration.', LOG_SOURCE);
        await window.showInformationMessage(MANUAL_CONFIG_MESSAGE, { modal: true });
        return false;
    }

    // e-signature on the ADMINMODE/CONFIGURE options blocks toggling admin mode and applying the configuration over REST, causing the deploy to hang.
    const { proceed, originalEsig } = await _confirmEsigDisable(
        client,
        ['ADMINMODE', 'CONFIGURE'],
        'E-signature is enabled for the "Manage Admin Mode" and/or "Apply Configuration Changes" options.\n\n' +
        'To apply the configuration, e-signature must be temporarily disabled for these options and then restored to its original state. Do you want to continue?'
    );

    if (!proceed) {
        return false;
    }

    try {
        await _toggleAdminMode(client, true, originalEsig ? { ADMINMODE: 0, CONFIGURE: 0 } : null);
        await _applyDbConfigInAdminMode(client);
        await _toggleAdminMode(client, false, null);
    } finally {
        if (originalEsig) {
            await _restoreEsig(client, originalEsig, 'Admin Mode', 'ADMINMODE/CONFIGURE options');
        }
    }

    return true;
}

async function _configureWithoutAdminMode(client) {
    // e-signature on the CONFIGURE option can block applying the configuration over REST.
    const { proceed, originalEsig } = await _confirmEsigDisable(
        client,
        ['CONFIGURE'],
        'E-signature is enabled for the "Apply Configuration Changes" option.\n\n' +
        'To apply the configuration, e-signature must be temporarily disabled for this option and then restored to its original state. Do you want to continue?'
    );

    if (!proceed) {
        return false;
    }

    try {
        await _applyDbConfig(client, originalEsig ? { CONFIGURE: 0 } : null);
    } finally {
        if (originalEsig) {
            await _restoreEsig(client, originalEsig, 'Database Configuration', 'CONFIGURE option');
        }
    }

    return true;
}

async function _confirmEsigDisable(client, signatures, promptMessage) {
    const esig = await client.getAdminModeEsigEnabled();
    if (!esig || !signatures.some((signature) => esig[signature] === true)) {
        return { proceed: true, originalEsig: null };
    }

    const esigConfirmation = await window.showInformationMessage(promptMessage, { modal: true }, 'Yes');

    if (esigConfirmation !== 'Yes') {
        Logger.info('User declined temporarily disabling e-signature for database configuration.', LOG_SOURCE);
        await window.showInformationMessage(MANUAL_CONFIG_MESSAGE, { modal: true });
        return { proceed: false, originalEsig: null };
    }

    return { proceed: true, originalEsig: esig };
}

async function _toggleAdminMode(client, on, esigToDisable) {
    const label = on ? 'On' : 'Off';
    await window.withProgress(
        {
            cancellable: false,
            title: 'Admin Mode',
            location: ProgressLocation.Notification
        },
        async (progress) => {
            if (esigToDisable) {
                Logger.info('Temporarily disabling e-signature on the ADMINMODE/CONFIGURE options to apply the configuration.', LOG_SOURCE);
                progress.report({ message: 'Disabling e-signature requirement' });
                await client.setAdminModeEsigEnabled(esigToDisable);
            }

            progress.report({ message: `Requesting Admin Mode ${label}` });
            if (on) {
                await client.setAdminModeOn();
            } else {
                await client.setAdminModeOff();
            }
            await new Promise((resolve) => setTimeout(resolve, 2000));
            progress.report({ message: `Requested Admin Mode ${label}` });

            while ((await client.isAdminModeOn()) === !on) {
                await new Promise((resolve) => setTimeout(resolve, 2000));
                progress.report({ message: `Waiting for Admin Mode ${label}` });
            }

            if (!on) {
                await new Promise((resolve) => setTimeout(resolve, 2000));
            }

            progress.report({
                increment: 100,
                message: `Admin Mode is ${label}`
            });
        }
    );
}

async function _applyDbConfigInAdminMode(client) {
    await window.withProgress(
        {
            cancellable: false,
            title: 'Database Configuration',
            location: ProgressLocation.Notification
        },
        async (progress) => {
            await client.applyDBConfig();
            progress.report({
                message: 'Requested database configuration start'
            });

            // wait for the server to respond that the db config is in progress
            while ((await client.dbConfigInProgress()) === false) {
                await new Promise((resolve) => setTimeout(resolve, 2000));
            }

            // wait for the database configuration to complete
            const regex = /BMX.*?E(?= -)/;
            while ((await client.dbConfigInProgress()) === true) {
                await new Promise((resolve) => setTimeout(resolve, 2000));

                const messages = await client.dbConfigMessages();
                if (messages.length > 0) {
                    const messageList = messages.split('\n');
                    messageList.forEach((message) => {
                        if (regex.test(message) || message.startsWith('BMXAA6819I')) {
                            Logger.error(`Database configuration failed: ${message}`, null, LOG_SOURCE);
                            throw new Error('An error occurred during database configuration: ' + message);
                        }
                    });
                    progress.report({
                        message: messageList[messageList.length - 1]
                    });
                } else {
                    progress.report({
                        message: 'Waiting for database configuration to complete'
                    });
                }
            }
            progress.report({
                increment: 100,
                message: 'Database configuration is complete'
            });
        }
    );
}

async function _applyDbConfig(client, esigToDisable) {
    await window.withProgress(
        {
            cancellable: false,
            title: 'Database Configuration',
            location: ProgressLocation.Notification
        },
        async (progress) => {
            if (esigToDisable) {
                Logger.info('Temporarily disabling e-signature on the CONFIGURE option to apply the configuration.', LOG_SOURCE);
                progress.report({ message: 'Disabling e-signature requirement' });
                await client.setAdminModeEsigEnabled(esigToDisable);
            }
            await client.applyDBConfig();
            progress.report({
                increment: 10,
                message: 'Requested database configuration start'
            });
            await new Promise((resolve) => setTimeout(resolve, 2000));
            while ((await client.dbConfigInProgress()) === true) {
                await new Promise((resolve) => setTimeout(resolve, 2000));
                progress.report({
                    message: 'Waiting for database configuration to complete'
                });
            }
            progress.report({
                increment: 100,
                message: 'Database configuration is complete'
            });
        }
    );
}

async function _restoreEsig(client, originalEsig, title, optionsLabel) {
    await window.withProgress(
        {
            cancellable: false,
            title,
            location: ProgressLocation.Notification
        },
        async (progress) => {
            Logger.info(`Restoring the original e-signature settings for the ${optionsLabel}.`, LOG_SOURCE);
            progress.report({ message: 'Restoring e-signature requirement' });
            await client.setAdminModeEsigEnabled(originalEsig);
            progress.report({ increment: 100, message: 'E-signature requirement restored' });
        }
    );
}
