import * as fs from 'fs';
import * as path from 'path';

import MaximoClient from '../maximo/maximo-client.js';
import { confirmRetainedSnapshots } from './retained-snapshot-gate.js';
import { declaresObjects, performDatabaseConfiguration } from './database-configuration.js';
import { resolveScriptCompanions } from './script-companions.js';
import Logger from '../log.js';
import { SKIPPED, isSkipped, skippedMessage } from './create-only.js';

const LOG_SOURCE = 'DeployScriptCommand';

/**
 * Deploys an automation script.
 *
 * @param {*} client the Maximo client
 * @param {import('../ui.js').Ui} ui
 * @param {string} filePath the path of the script file
 * @param {string} script the script source; read from filePath when empty
 * @param {{ sidecars?: boolean, companionPath?: string, onDeployed?: (result: any) => void, createOnly?: boolean }} [options] set sidecars to false
 *     to deploy the source only, without the conventional predeploy/deploy companion files. Entries in a deployment
 *     manifest that declare a kind use this; deploying a file directly does not. Set companionPath to the original
 *     source file when filePath is a build output, so that companions are found beside the source. onDeployed receives
 *     Maximo's response once the script itself is deployed. With createOnly set, Maximo leaves an existing script
 *     unchanged and SKIPPED is returned.
 * @returns {Promise<boolean|string>} whether the script was deployed, or SKIPPED
 */
export async function deployScript(client, ui, filePath, script, options) {
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
        ui.error('The selected script cannot be empty.');
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

    if (!(await _runPreDeploy(client, ui, preDeployJSONFileName))) {
        return false;
    }

    return await _deployScriptFile(client, ui, script, fileName, scriptDeploy, deployJSONFileName, options);
}

async function _runPreDeploy(client, ui, preDeployJSONFileName) {
    if (!preDeployJSONFileName || !fs.existsSync(preDeployJSONFileName)) {
        return true;
    }

    const preConfigDeploy = fs.readFileSync(preDeployJSONFileName, 'utf8');

    if (!(await confirmRetainedSnapshots(client, ui, preConfigDeploy))) {
        return false;
    }

    await _applyPreConfig(client, ui, preConfigDeploy);

    const preDeployConfig = JSON.parse(preConfigDeploy);

    if (declaresObjects(preDeployConfig) && (typeof preDeployConfig.noDBConfig === 'undefined' || preDeployConfig.noDBConfig === false)) {
        if (!(await performDatabaseConfiguration(client, ui, preDeployConfig))) {
            return false;
        }
    }

    return true;
}

async function _applyPreConfig(client, ui, preConfigDeploy) {
    await ui.withProgress(
        {
            cancellable: false,
            title: 'Pre-deployment',
        },
        async (progress) => {
            progress.report({
                message: 'Applying configurations.',
                increment: 50
            });

            await ui.pause(500);
            await client.postConfig(preConfigDeploy);
            progress.report({
                message: 'Configurations applied.',
                increment: 100
            });
            await ui.pause(1500);
        }
    );
}

async function _deployScriptFile(client, ui, script, fileName, scriptDeploy, deployJSONFileName, options) {
    return await ui.withProgress(
        {
            cancellable: true,
            title: 'Script',
        },
        async (progress, token) => {
            progress.report({
                message: `Deploying script ${fileName}`,
                increment: 0
            });

            await ui.pause(500);

            const result = await client.postScript(script, progress, fileName, scriptDeploy, token, { createOnly: options?.createOnly === true });

            if (!result) {
                Logger.error(`Script deploy did not receive a response from Maximo for ${fileName}.`, null, LOG_SOURCE);
                ui.error('Did not receive a response from Maximo.');
                return false;
            }

            if (result.status === 'error') {
                _showDeployError(ui, result, fileName);
                return false;
            }

            options?.onDeployed?.(result);

            if (isSkipped(result, options)) {
                Logger.info(skippedMessage(fileName), LOG_SOURCE);
                progress.report({ increment: 100, message: skippedMessage(fileName) });
                return SKIPPED;
            }

            return await _handleDeploySuccess(client, ui, result, fileName, deployJSONFileName, progress, token);
        }
    );
}

function _showDeployError(ui, result, fileName) {
    Logger.error(`Script deploy failed for ${fileName}: ${result.message || result.error || JSON.stringify(result)}`, null, LOG_SOURCE);
    if (result.message) {
        ui.error(result.message);
    } else if (result.cause) {
        ui.error(`Error: ${JSON.stringify(result.cause)}`);
    } else if (result.error) {
        if (result.error.startsWith('Error:')) {
            ui.error(JSON.stringify(result.error));
        } else {
            ui.error(`Error: ${JSON.stringify(result.error)}`);
        }
    } else {
        ui.error('An unknown error occurred: ' + JSON.stringify(result));
    }
}

async function _handleDeploySuccess(client, ui, result, fileName, deployJSONFileName, progress, token) {
    if (deployJSONFileName && fs.existsSync(deployJSONFileName)) {
        const configDeploy = fs.readFileSync(deployJSONFileName);

        if (!(await confirmRetainedSnapshots(client, ui, configDeploy))) {
            return false;
        }

        progress.report({ message: 'Applying Configurations' });

        await client.postConfig(configDeploy, token, progress);

        // @ts-ignore
        const deployConfig = JSON.parse(configDeploy);
        if (declaresObjects(deployConfig)) {
            if (!(await performDatabaseConfiguration(client, ui, deployConfig))) {
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

    await ui.pause(2000);

    return true;
}
