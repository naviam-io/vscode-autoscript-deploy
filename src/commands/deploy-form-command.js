// @ts-nocheck
import * as path from 'path';
import * as fs from 'fs';

import { window, ProgressLocation } from 'vscode';

import MaximoClient from '../maximo/maximo-client';
import Logger from '../logger';

const LOG_SOURCE = 'DeployFormCommand';

export default async function deployForm(client, filePath, form) {
    Logger.info(`Deploying inspection form from ${filePath || 'unknown file'}.`, LOG_SOURCE);
    if (
        !client ||
        client === null ||
        client instanceof MaximoClient === false
    ) {
        Logger.error('Deploy form command failed because the Maximo client is invalid.', null, LOG_SOURCE);
        throw new Error(
            'The client parameter is required and must be an instance of the MaximoClient class.'
        );
    }

    if (!filePath || filePath === null || !fs.existsSync(filePath)) {
        Logger.error(`Deploy form command failed because the file path is invalid: ${filePath || 'empty'}.`, null, LOG_SOURCE);
        throw new Error(
            'The filePath parameter is required and must be a valid file path to a inspection form file.'
        );
    }

    if (!form || form === null || form.trim().length === 0) {
        form = fs.readFileSync(filePath, { encoding: 'utf8' });
    }

    if (!form || form.trim().length <= 0) {
        Logger.error(`Inspection form ${filePath} is empty.`, null, LOG_SOURCE);
        window.showErrorMessage(
            'The selected inspection form cannot be empty.',
            { modal: true }
        );
        return;
    }

    let fileName = path.basename(filePath);

    try {
        let formObject = JSON.parse(form);

        if (typeof formObject.name === 'undefined' || !formObject.name) {
            Logger.error(`Inspection form ${fileName} is missing a name attribute.`, null, LOG_SOURCE);
            window.showErrorMessage(
                `File ${fileName} does not have a 'name' attribute and is not a valid inspection form extract.`,
                {
                    modal: true,
                }
            );
            return;
        }

        await window.withProgress(
            {
                cancellable: false,
                title: 'Inspection Form',
                location: ProgressLocation.Notification,
            },
            async (progress) => {
                progress.report({
                    message: `Inspection form ${formObject.name}`,
                    increment: 0,
                });

                await new Promise((resolve) => setTimeout(resolve, 500));

                let result = await client.postForm(formObject, progress);

                if (result) {
                    if (result.status === 'error') {
                        Logger.error(`Inspection form deploy failed for ${formObject.name}: ${result.message || JSON.stringify(result)}`, null, LOG_SOURCE);
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
                            message: `Successfully deployed ${formObject.name}`,
                        });
                        await new Promise((resolve) =>
                            setTimeout(resolve, 2000)
                        );
                        Logger.info(`Inspection form ${formObject.name} deployed successfully.`, LOG_SOURCE);
                    }
                } else {
                    Logger.error(`Inspection form deploy did not receive a response from Maximo for ${formObject.name}.`, null, LOG_SOURCE);
                    window.showErrorMessage(
                        'Did not receive a response from Maximo.',
                        { modal: true }
                    );
                }
                return result;
            }
        );
    } catch (error) {
        Logger.error(`Inspection form deploy failed for ${fileName}.`, error, LOG_SOURCE);
        window.showErrorMessage(
            `File ${fileName} is not a valid JSON formatted inspection form extract.\n\n${error.message}`,
            {
                modal: true,
            }
        );
        return;
    }
}
