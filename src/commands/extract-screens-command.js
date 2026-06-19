import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';

// @ts-ignore
import * as format from 'xml-formatter';

import { ProgressLocation, window, workspace } from 'vscode';

// get a reference to the Maximo configuration object
import { getMaximoConfig, asyncForEach } from '../extension';
import Logger from '../logger';

const LOG_SOURCE = 'ExtractScreensCommand';

export default async function extractScreensCommand(client) {
    Logger.info('Extract screen definitions command requested.', LOG_SOURCE);
    let extractLoc = (await getMaximoConfig()).extractLocationScreens;
    // if the extract location has not been specified use the workspace folder.
    if (typeof extractLoc === 'undefined' || !extractLoc) {
        if (workspace.workspaceFolders !== undefined) {
            extractLoc = workspace.workspaceFolders[0].uri.fsPath;
        } else {
            Logger.error('Extract screens command failed because no working folder or extract folder is configured.', null, LOG_SOURCE);
            window.showErrorMessage('A working folder must be selected or an export folder configured before exporting screen definitions.', {
                modal: true,
            });
            return;
        }
    }

    if (extractLoc.startsWith('~')) {
        extractLoc = path.join(os.homedir(), extractLoc.slice(1));
    } else if ((extractLoc.startsWith('./') || extractLoc.startsWith('.\\')) && workspace.workspaceFolders !== undefined) {
        extractLoc = path.join(workspace.workspaceFolders[0].uri.fsPath, extractLoc.slice(2));
    } else if (!path.isAbsolute(extractLoc) && workspace.workspaceFolders !== undefined) {
        extractLoc = path.join(workspace.workspaceFolders[0].uri.fsPath, extractLoc);
    }

    if (!fs.existsSync(extractLoc)) {
        fs.mkdirSync(extractLoc, { recursive: true });
    }

    if (!fs.existsSync(extractLoc)) {
        Logger.error(`Screen extract folder does not exist: ${extractLoc}.`, null, LOG_SOURCE);
        window.showErrorMessage(`The screen extract folder ${extractLoc} does not exist.`, { modal: true });
        return;
    }
    Logger.info(`Extracting screen definitions to ${extractLoc}.`, LOG_SOURCE);

    const quickPick = window.createQuickPick();
    quickPick.canSelectMany = true;
    quickPick.title = 'Select Screen Definitions from the List';
    quickPick.busy = true;
    quickPick.placeholder = 'Getting Screen Definitions\u2026';
    quickPick.show();

    const objects = await client.getAllScreenNames();

    if (objects != null && Array.isArray(objects)) {
        objects.sort((a, b) => a.label.localeCompare(b.label));
        quickPick.items = objects;

        quickPick.placeholder = 'Select All Screen Definitions';
        quickPick.busy = false;

        quickPick.onDidAccept(async () => {
            const screenNames = quickPick.selectedItems.map((item) => item.label);

            if (screenNames.length > 0) {
                Logger.info(`Extracting ${screenNames.length} screen definition(s).`, LOG_SOURCE);
                await window.withProgress(
                    {
                        title: 'Extracting Screen Definitions',
                        location: ProgressLocation.Notification,
                        cancellable: true,
                    },
                    async (progress, cancelToken) => {
                        let percent = Math.round((1 / screenNames.length) * 100);

                        let overwriteAll = false;
                        let overwrite = false;

                        await asyncForEach(screenNames, async (screenName) => {
                            if (!cancelToken.isCancellationRequested) {
                                progress.report({
                                    increment: percent,
                                    message: `Extracting ${screenName}`,
                                });

                                let screenInfo = await client.getScreen(screenName);

                                let fileExtension = '.xml';

                                let outputFile = extractLoc + '/' + screenName.toLowerCase() + fileExtension;
                                let xml = format(screenInfo.presentation);

                                // if the file doesn't exist then just write it out.
                                if (!fs.existsSync(outputFile)) {
                                    fs.writeFileSync(outputFile, xml);
                                } else {
                                    let incomingHash = crypto.createHash('sha256').update(xml).digest('hex');
                                    // @ts-ignore
                                    let fileHash = crypto.createHash('sha256').update(fs.readFileSync(outputFile)).digest('hex');

                                    if (fileHash !== incomingHash) {
                                        if (!overwriteAll) {
                                            await window
                                                .showInformationMessage(
                                                    `The screen ${screenName.toLowerCase()}${fileExtension} exists. \nReplace?`,
                                                    { modal: true },
                                                    ...['Replace', 'Replace All', 'Skip']
                                                )
                                                .then(async (response) => {
                                                    if (response === 'Replace') {
                                                        overwrite = true;
                                                    } else if (response === 'Replace All') {
                                                        overwriteAll = true;
                                                    } else if (response === 'Skip') {
                                                        // do nothing
                                                        overwrite = false;
                                                    } else {
                                                        // @ts-ignore
                                                        cancelToken.cancel();
                                                    }
                                                });
                                        }
                                        if (overwriteAll || overwrite) {
                                            fs.writeFileSync(outputFile, xml);
                                            overwrite = false;
                                        }
                                    }
                                }

                                if (cancelToken.isCancellationRequested) {
                                    return;
                                }
                            }
                        });

                        if (!cancelToken.isCancellationRequested) {
                            window.showInformationMessage('Screen definitions extracted.', { modal: true });
                            Logger.info(`${screenNames.length} screen definition(s) extracted.`, LOG_SOURCE);
                        }
                    }
                );
            } else {
                Logger.info('Extract screens command cancelled without a selection.', LOG_SOURCE);
                quickPick.hide();
            }
        });
    } else {
        quickPick.hide();
        Logger.error('No screen definitions were found to extract.', null, LOG_SOURCE);
        window.showErrorMessage('No screen definitions were found to extract.', { modal: true });
    }
}
