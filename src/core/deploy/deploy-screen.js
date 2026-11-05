import * as path from 'path';
import * as fs from 'fs';
import { parseString } from 'xml2js';

import MaximoClient from '../maximo/maximo-client.js';
import Logger from '../log.js';
import { SKIPPED, isSkipped, skippedMessage } from './create-only.js';

const LOG_SOURCE = 'DeployScreenCommand';

export async function deployScreen(client, ui, filePath, screen, options) {
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
        ui.error('The selected screen definition cannot be empty.');
        return false;
    }

    let fileName = path.basename(filePath);
    var screenName;
    /** @type {{ message: string } | null} */
    var parseError = null;

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
        Logger.error(`Error parsing ${fileName}: ${parseError.message}`, null, LOG_SOURCE);
        ui.error(`Error parsing ${fileName}: ${parseError.message}`);
        return false;
    }

    if (!screenName) {
        Logger.error(`Unable to find presentation or systemlib id in ${fileName}.`, null, LOG_SOURCE);
        ui.error('Unable to find presentation or systemlib id from current document. Cannot fetch screen from server to compare.');
        return false;
    }

    return await ui.withProgress(
        {
            cancellable: false,
            title: 'Screen',
        },
        async (progress) => {
            progress.report({
                message: `Deploying screen ${fileName}`,
                increment: 0,
            });

            await ui.pause(500);
            let result = await client.postScreen(screen, progress, fileName, { createOnly: options?.createOnly === true });

            if (result) {
                if (result.status === 'error') {
                    Logger.error(`Screen deploy failed for ${fileName}: ${result.message || JSON.stringify(result)}`, null, LOG_SOURCE);
                    if (result.message) {
                        ui.error(result.message);
                    } else if (result.cause) {
                        ui.error(`Error: ${JSON.stringify(result.cause)}`);
                    } else {
                        ui.error('An unknown error occurred: ' + JSON.stringify(result));
                    }
                    return false;
                } else {
                    if (isSkipped(result, options)) {
                        Logger.info(skippedMessage(fileName), LOG_SOURCE);
                        progress.report({ increment: 100, message: skippedMessage(fileName) });
                        return SKIPPED;
                    }
                    progress.report({
                        increment: 100,
                        message: `Successfully deployed ${fileName}`,
                    });
                    await ui.pause(2000);
                    Logger.info(`Screen ${fileName} deployed successfully.`, LOG_SOURCE);
                    return true;
                }
            } else {
                Logger.error(`Screen deploy did not receive a response from Maximo for ${fileName}.`, null, LOG_SOURCE);
                ui.error('Did not receive a response from Maximo.');
            }
            return false;
        }
    );
}
