import * as path from 'path';
import * as fs from 'fs';
import { parseString } from 'xml2js';

import { window, ProgressLocation } from 'vscode';

import MaximoClient from '../maximo/maximo-client';
import Logger from '../logger';

const LOG_SOURCE = 'DeployScreenCommand';

export default async function deployScreen(client, filePath, screen) {
    Logger.info(`Deploying screen from ${filePath || 'unknown file'}.`, LOG_SOURCE);
    if (
        !client ||
        client === null ||
        client instanceof MaximoClient === false
    ) {
        Logger.error('Deploy screen command failed because the Maximo client is invalid.', null, LOG_SOURCE);
        throw new Error(
            'The client parameter is required and must be an instance of the MaximoClient class.'
        );
    }

    if (!filePath || filePath === null || !fs.existsSync(filePath)) {
        Logger.error(`Deploy screen command failed because the file path is invalid: ${filePath || 'empty'}.`, null, LOG_SOURCE);
        throw new Error(
            'The filePath parameter is required and must be a valid file path to a screen file.'
        );
    }

    if (!screen || screen === null || screen.trim().length === 0) {
        screen = fs.readFileSync(filePath, { encoding: 'utf8' });
    }

    if (!screen || screen.trim().length <= 0) {
        Logger.error(`Screen definition ${filePath} is empty.`, null, LOG_SOURCE);
        window.showErrorMessage(
            'The selected screen definition cannot be empty.',
            { modal: true }
        );
        return;
    }

    let fileName = path.basename(filePath);
    var screenName;
    var parseError;

    parseString(screen, function (error, result) {
        parseError = error;
        if (error) {
            return;
        } else {
            if (result.presentation) {
                screenName = result.presentation.$.id;
            } else if (result.systemlib) {
                screenName = result.systemlib.$.id;
            } else {
                parseError = {
                    message:
                        'Current XML document does not have an root element of "presentation" or "systemlib".',
                };
            }
        }
    });

    if (parseError) {
        // @ts-ignore
        Logger.error(`Error parsing ${fileName}: ${parseError.message}`, null, LOG_SOURCE);
        window.showErrorMessage(
            `Error parsing ${fileName}: ${parseError.message}`,
            { modal: true }
        );
        return;
    }

    if (!screenName) {
        Logger.error(`Unable to find presentation or systemlib id in ${fileName}.`, null, LOG_SOURCE);
        window.showErrorMessage(
            'Unable to find presentation or systemlib id from current document. Cannot fetch screen from server to compare.',
            {
                modal: true,
            }
        );
        return;
    }

    await window.withProgress(
        {
            cancellable: false,
            title: 'Screen',
            location: ProgressLocation.Notification,
        },
        async (progress) => {
            progress.report({
                message: `Deploying screen ${fileName}`,
                increment: 0,
            });

            await new Promise((resolve) => setTimeout(resolve, 500));
            let result = await client.postScreen(screen, progress, fileName);

            if (result) {
                if (result.status === 'error') {
                    Logger.error(`Screen deploy failed for ${fileName}: ${result.message || JSON.stringify(result)}`, null, LOG_SOURCE);
                    if (result.message) {
                        window.showErrorMessage(result.message, {
                            modal: true,
                        });
                    } else if (result.cause) {
                        window.showErrorMessage(
                            `Error: ${JSON.stringify(result.cause)}`,
                            { modal: true }
                        );
                    } else {
                        window.showErrorMessage(
                            'An unknown error occurred: ' +
                                JSON.stringify(result),
                            { modal: true }
                        );
                    }
                } else {
                    progress.report({
                        increment: 100,
                        message: `Successfully deployed ${fileName}`,
                    });
                    await new Promise((resolve) => setTimeout(resolve, 2000));
                    Logger.info(`Screen ${fileName} deployed successfully.`, LOG_SOURCE);
                }
            } else {
                Logger.error(`Screen deploy did not receive a response from Maximo for ${fileName}.`, null, LOG_SOURCE);
                window.showErrorMessage(
                    'Did not receive a response from Maximo.',
                    { modal: true }
                );
            }
            return result;
        }
    );
}
