import * as fs from 'fs';
import * as path from 'path';

import { window, ProgressLocation } from 'vscode';

import MaximoClient from '../maximo/maximo-client';

export default async function deployScript(client, filePath, script) {
    if (!client || client === null || client instanceof MaximoClient === false) {
        throw new Error('The client parameter is required and must be an instance of the MaximoClient class.');
    }

    if (!filePath || filePath === null || !fs.existsSync(filePath)) {
        throw new Error('The filePath parameter is required and must be a valid file path to a script file.');
    }

    let fileName = path.basename(filePath);
    let deployFileName = filePath.substring(0, filePath.lastIndexOf('.')) + '-deploy' + filePath.substring(filePath.lastIndexOf('.'));
    let deployDotFileName = filePath.substring(0, filePath.lastIndexOf('.')) + '.deploy' + filePath.substring(filePath.lastIndexOf('.'));
    let deployJSONFileName = filePath.substring(0, filePath.lastIndexOf('.')) + '.json';
    let preDeployJSONFileName = filePath.substring(0, filePath.lastIndexOf('.')) + '.predeploy.json';

    if (!script || script === null || script.trim().length === 0) {
        script = fs.readFileSync(filePath, { encoding: 'utf8' });
    }

    if (!script || script.trim().length <= 0) {
        window.showErrorMessage('The selected script cannot be empty.', {
            modal: true
        });
        return;
    }

    var scriptDeploy;
    if (fs.existsSync(deployFileName)) {
        scriptDeploy = fs.readFileSync(deployFileName);
    } else if (fs.existsSync(deployDotFileName)) {
        scriptDeploy = fs.readFileSync(deployDotFileName);
    }

    if (script && script.trim().length > 0) {
        if (fs.existsSync(preDeployJSONFileName)) {
            let preConfigDeploy = fs.readFileSync(preDeployJSONFileName, 'utf8');

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

            const preDeployConfig = JSON.parse(preConfigDeploy);
            if (
                (typeof preDeployConfig.maxObjects !== 'undefined' && Array.isArray(preDeployConfig.maxObjects) && preDeployConfig.maxObjects.length > 0) ||
                (typeof preDeployConfig.objects !== 'undefined' && Array.isArray(preDeployConfig.objects) && preDeployConfig.objects.length > 0)
            ) {
                if (typeof preDeployConfig.noDBConfig === 'undefined' || preDeployConfig.noDBConfig === false) {
                    await performDatabaseConfiguration(client, preDeployConfig);
                }
            }
        }

        await window.withProgress(
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

                let result = await client.postScript(script, progress, fileName, scriptDeploy, token);

                if (result) {
                    if (result.status === 'error') {
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
                    } else {
                        if (fs.existsSync(deployJSONFileName)) {
                            let configDeploy = fs.readFileSync(deployJSONFileName);
                            progress.report({ message: 'Applying Configurations' });

                            await client.postConfig(configDeploy, token, progress);

                            // @ts-ignore
                            const deployConfig = JSON.parse(configDeploy);
                            if (
                                typeof deployConfig.maxObjects !== 'undefined' &&
                                Array.isArray(deployConfig.maxObjects) &&
                                deployConfig.maxObjects.length > 0
                            ) {
                                await performDatabaseConfiguration(client, deployConfig);
                            }
                        }
                        if (typeof result.deleted !== 'undefined' && result.deleted === true) {
                            progress.report({
                                increment: 100,
                                message: `Successfully deleted ${fileName}`
                            });
                        } else {
                            progress.report({
                                increment: 100,
                                message: `Successfully deployed ${fileName}`
                            });
                        }

                        await new Promise((resolve) => setTimeout(resolve, 2000));
                    }
                } else {
                    window.showErrorMessage('Did not receive a response from Maximo.', { modal: true });
                }
                return result;
            }
        );
    } else {
        window.showErrorMessage('The selected Automation Script cannot be empty.', { modal: true });
    }
}

async function performDatabaseConfiguration(client, config) {
    if (await client.dbConfigRequired()) {
        const adminModeRequired = await client.dbConfigRequiresAdminMode();

        if (adminModeRequired) {
            if (typeof config.noAdminMode === 'undefined' || config.noAdminMode === false) {
                const userConfirmation = await window.showInformationMessage(
                    'The script has deployment configurations that require Admin Mode to be applied.\n\nThis will logout all users and make the server unavailable while the configuration is performed. Do you want to continue?',
                    { modal: true },
                    'Yes',
                    'No'
                );

                if (userConfirmation !== 'Yes') {
                    await window.showInformationMessage(
                        'The script cannot be deployed until the database configurations have been applied.\n\nThe configurations have been added to Maximo and can be manually applied by an administrator.',
                        { modal: true }
                    );
                    return;
                }

                //put the server in admin mode, then do the config.
                await window.withProgress(
                    {
                        cancellable: false,
                        title: 'Admin Mode',
                        location: ProgressLocation.Notification
                    },
                    async (progress) => {
                        progress.report({
                            message: 'Requesting Admin Mode On'
                        });
                        await client.setAdminModeOn();
                        await new Promise((resolve) => setTimeout(resolve, 2000));
                        progress.report({ message: 'Requested Admin Mode On' });
                        while ((await client.isAdminModeOn()) === false) {
                            await new Promise((resolve) => setTimeout(resolve, 2000));
                            progress.report({
                                message: 'Waiting for Admin Mode On'
                            });
                        }
                        progress.report({
                            increment: 100,
                            message: 'Admin Mode is On'
                        });
                    }
                );

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

                            var messages = await client.dbConfigMessages();
                            if (messages.length > 0) {
                                var messageList = messages.split('\n');
                                messageList.forEach((message) => {
                                    if (regex.test(message) || message.startsWith('BMXAA6819I')) {
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
                await window.withProgress(
                    {
                        cancellable: false,
                        title: 'Admin Mode',
                        location: ProgressLocation.Notification
                    },
                    async (progress) => {
                        progress.report({
                            message: 'Requesting Admin Mode Off'
                        });
                        await client.setAdminModeOff();
                        await new Promise((resolve) => setTimeout(resolve, 2000));
                        progress.report({
                            message: 'Requested Admin Mode Off'
                        });
                        while ((await client.isAdminModeOn()) === true) {
                            await new Promise((resolve) => setTimeout(resolve, 2000));
                            progress.report({
                                message: 'Waiting for Admin Mode Off'
                            });
                        }
                        await new Promise((resolve) => setTimeout(resolve, 2000));
                        progress.report({
                            increment: 100,
                            message: 'Admin Mode is Off'
                        });
                    }
                );
            } else {
                await window.showInformationMessage(
                    'The script deployment specifies that Admin Mode should not be applied, but the script cannot be deployed until the database configurations have been applied.\n\nThe configurations have been added to Maximo and can be manually applied by an administrator.',
                    { modal: true }
                );
                return;
            }
        } else {
            // just do the config.
            await window.withProgress(
                {
                    cancellable: false,
                    title: 'Database Configuration',
                    location: ProgressLocation.Notification
                },
                async (progress) => {
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
    }
}
