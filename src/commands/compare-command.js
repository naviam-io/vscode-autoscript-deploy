import * as path from 'path';
import { parseString } from 'xml2js';
import { commands, ProgressLocation, window, Uri } from 'vscode';

// get a reference to the fetched source object
import { fetchedSource } from '../extension';
import Logger from '../logger';

// @ts-ignore
import * as format from 'xml-formatter';

const LOG_SOURCE = 'CompareCommand';

export default async function compareCommand(client) {
    Logger.info('Compare command requested.', LOG_SOURCE);
    // Get the active text editor
    const editor = window.activeTextEditor;

    if (editor) {
        let document = editor.document;

        if (document) {
            let fileName = path.basename(document.fileName);
            let fileExt = path.extname(fileName);
            Logger.info(`Comparing ${document.fileName}.`, LOG_SOURCE);
            if (fileExt === '.js' || fileExt === '.py' || fileExt === '.jy') {
                // Get the document text
                const script = document.getText();
                if (script && script.trim().length > 0) {
                    await window.withProgress(
                        {
                            cancellable: false,
                            title: 'Script',
                            location: ProgressLocation.Notification,
                        },
                        async (progress) => {
                            progress.report({
                                message: 'Getting script from the server.',
                                increment: 0,
                            });

                            await new Promise((resolve) =>
                                setTimeout(resolve, 500)
                            );
                            let result = await client.getScriptSource(
                                script,
                                progress,
                                fileName
                            );

                            if (result) {
                                if (result.status === 'error') {
                                    Logger.error(`Script compare failed for ${fileName}: ${result.message || JSON.stringify(result)}`, null, LOG_SOURCE);
                                    if (result.message) {
                                        window.showErrorMessage(
                                            result.message,
                                            { modal: true }
                                        );
                                    } else if (result.cause) {
                                        window.showErrorMessage(
                                            `Error: ${JSON.stringify(
                                                result.cause
                                            )}`,
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
                                    if (result.source) {
                                        progress.report({
                                            increment: 100,
                                            message:
                                                'Successfully got script from the server.',
                                        });
                                        await new Promise((resolve) =>
                                            setTimeout(resolve, 2000)
                                        );
                                        let localScript = document.uri;
                                        let serverScript = Uri.parse(
                                            'vscode-autoscript-deploy:' +
                                                fileName
                                        );

                                        fetchedSource[serverScript.path] =
                                            result.source;

                                        commands.executeCommand(
                                            'vscode.diff',
                                            localScript,
                                            serverScript,
                                            '↔ server ' + fileName
                                        );
                                        Logger.info(`Opened script comparison for ${fileName}.`, LOG_SOURCE);
                                    } else {
                                        Logger.error(`Script ${fileName} was not found on the server.`, null, LOG_SOURCE);
                                        window.showErrorMessage(
                                            `The ${fileName} was not found.\n\nCheck that the scriptConfig.autoscript value matches a script on the server.`,
                                            { modal: true }
                                        );
                                    }
                                }
                            } else {
                                Logger.error(`Script compare did not receive a response from Maximo for ${fileName}.`, null, LOG_SOURCE);
                                window.showErrorMessage(
                                    'Did not receive a response from Maximo.',
                                    { modal: true }
                                );
                            }
                            return result;
                        }
                    );
                } else {
                    Logger.error(`Selected automation script ${fileName} is empty.`, null, LOG_SOURCE);
                    window.showErrorMessage(
                        'The selected Automation Script cannot be empty.',
                        { modal: true }
                    );
                }
            } else if (fileExt === '.xml') {
                // Get the document text
                const screen = document.getText();
                let screenName;
                if (screen && screen.trim().length > 0) {
                    parseString(screen, function (error, result) {
                        if (error) {
                            Logger.error(`Error parsing ${fileName}: ${error.message}`, null, LOG_SOURCE);
                            window.showErrorMessage(error.message, {
                                modal: true,
                            });
                            return;
                        } else {
                            if (result.presentation) {
                                screenName = result.presentation.$.id;
                            } else if (result.systemlib) {
                                screenName = result.systemlib.$.id;
                            } else {
                                Logger.error(`Current XML document ${fileName} is not a presentation or systemlib.`, null, LOG_SOURCE);
                                window.showErrorMessage(
                                    'Current XML document does not have an root element of "presentation" or "systemlib".',
                                    {
                                        modal: true,
                                    }
                                );
                                return;
                            }
                        }
                    });

                    if (!screenName) {
                        Logger.error(`Unable to find presentation or systemlib id in ${fileName}.`, null, LOG_SOURCE);
                        window.showErrorMessage(
                            'Unable to find presentation or systemlib id from current document. Cannot fetch screen from server to compare.',
                            { modal: true }
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
                                message: 'Getting screen from the server.',
                                increment: 0,
                            });

                            await new Promise((resolve) =>
                                setTimeout(resolve, 500)
                            );
                            let result = await client.getScreen(
                                screenName,
                                progress,
                                fileName
                            );

                            if (result) {
                                if (result.status === 'error') {
                                    Logger.error(`Screen compare failed for ${fileName}: ${result.message || JSON.stringify(result)}`, null, LOG_SOURCE);
                                    if (result.message) {
                                        window.showErrorMessage(
                                            result.message,
                                            { modal: true }
                                        );
                                    } else if (result.cause) {
                                        window.showErrorMessage(
                                            `Error: ${JSON.stringify(
                                                result.cause
                                            )}`,
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
                                    if (result.presentation) {
                                        progress.report({
                                            increment: 100,
                                            message:
                                                'Successfully got screen from the server.',
                                        });
                                        await new Promise((resolve) =>
                                            setTimeout(resolve, 2000)
                                        );
                                        let localScreen = document.uri;
                                        let serverScreen = Uri.parse(
                                            'vscode-autoscript-deploy:' +
                                                fileName
                                        );

                                        fetchedSource[serverScreen.path] =
                                            format(result.presentation);

                                        commands.executeCommand(
                                            'vscode.diff',
                                            localScreen,
                                            serverScreen,
                                            '↔ server ' + fileName
                                        );
                                        Logger.info(`Opened screen comparison for ${fileName}.`, LOG_SOURCE);
                                    } else {
                                        Logger.error(`Screen ${fileName} was not found on the server.`, null, LOG_SOURCE);
                                        window.showErrorMessage(
                                            `The ${fileName} was not found.\n\nCheck that the presentation id attribute value matches a Screen Definition on the server.`,
                                            { modal: true }
                                        );
                                    }
                                }
                            } else {
                                Logger.error(`Screen compare did not receive a response from Maximo for ${fileName}.`, null, LOG_SOURCE);
                                window.showErrorMessage(
                                    'Did not receive a response from Maximo.',
                                    { modal: true }
                                );
                            }
                            return result;
                        }
                    );
                } else {
                    Logger.error(`Selected screen definition ${fileName} is empty.`, null, LOG_SOURCE);
                    window.showErrorMessage(
                        'The selected Screen Definition cannot be empty.',
                        { modal: true }
                    );
                }
            } else {
                Logger.error(`Unsupported file extension selected for compare: ${fileExt}.`, null, LOG_SOURCE);
                window.showErrorMessage(
                    "The selected file must have a Javascript ('.js'), Python ('.py') or Jython ('.jy') file extension for an automation script or ('.xml') for a Screen Definition.",
                    { modal: true }
                );
            }
        } else {
            Logger.error('Compare requested, but no active document was found.', null, LOG_SOURCE);
            window.showErrorMessage(
                'An Automation Script or Screen Definition must be selected to compare.',
                { modal: true }
            );
        }
    } else {
        Logger.error('Compare requested, but no active editor was found.', null, LOG_SOURCE);
        window.showErrorMessage(
            'An Automation Script or Screen Definition must be selected to compare.',
            { modal: true }
        );
    }
}
