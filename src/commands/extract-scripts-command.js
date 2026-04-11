/* eslint-disable indent */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';

import { ProgressLocation, window, workspace } from 'vscode';

// get a reference to the fetched source object
import { getMaximoConfig, asyncForEach } from '../extension';

export default async function extractScriptsCommand(client) {
    let extractLoc = (await getMaximoConfig()).extractLocation;
    // if the extract location has not been specified use the workspace folder.
    if (typeof extractLoc === 'undefined' || !extractLoc) {
        if (workspace.workspaceFolders !== undefined) {
            extractLoc = workspace.workspaceFolders[0].uri.fsPath;
        } else {
            window.showErrorMessage('A working folder must be selected or an export folder configured before exporting automation scripts. ', {
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

    const quickPick = window.createQuickPick();
    quickPick.canSelectMany = true;
    quickPick.title = 'Select Automation Scripts from the List';
    quickPick.busy = true;
    quickPick.placeholder = 'Getting Automation Scripts\u2026';
    quickPick.show();

    const objects = await client.getAllScriptNames();

    if (objects != null && Array.isArray(objects)) {
        objects.sort((a, b) => a.label.localeCompare(b.label));
        quickPick.items = objects;

        quickPick.placeholder = 'Select All Automation Scripts';
        quickPick.busy = false;

        quickPick.onDidAccept(async () => {
            const scriptNames = quickPick.selectedItems.map((item) => item.label);
            if (scriptNames.length > 0) {
                await window.withProgress(
                    {
                        title: 'Extracting Automation Script',
                        location: ProgressLocation.Notification,
                        cancellable: true,
                    },
                    async (progress, cancelToken) => {
                        let percent = Math.round((1 / scriptNames.length) * 100);

                        let overwriteAll = false;
                        let overwrite = false;

                        await asyncForEach(scriptNames, async (scriptName) => {
                            if (!cancelToken.isCancellationRequested) {
                                progress.report({
                                    increment: percent,
                                    message: `Extracting ${scriptName}`,
                                });
                                let scriptInfo = await client.getScript(scriptName);

                                let fileExtension = getExtension(scriptInfo.scriptLanguage);

                                let outputFile = extractLoc + '/' + scriptName.toLowerCase() + fileExtension;

                                // if the file doesn't exist then just write it out.
                                if (!fs.existsSync(outputFile)) {
                                    fs.writeFileSync(outputFile, scriptInfo.script);
                                } else {
                                    let incomingHash = crypto.createHash('sha256').update(scriptInfo.script).digest('hex');
                                    // @ts-ignore
                                    let fileHash = crypto.createHash('sha256').update(fs.readFileSync(outputFile)).digest('hex');

                                    if (fileHash !== incomingHash) {
                                        if (!overwriteAll) {
                                            await window
                                                .showInformationMessage(
                                                    `The script ${scriptName.toLowerCase()}${fileExtension} exists. \nReplace?`,
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
                                            fs.writeFileSync(outputFile, scriptInfo.script);
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
                            window.showInformationMessage('Automation scripts extracted.', { modal: true });
                        }
                    }
                );
            } else {
                quickPick.hide();
            }
        });
    } else {
        quickPick.hide();
        window.showErrorMessage('No scripts were found to extract.', {
            modal: true,
        });
    }

    function getExtension(scriptLanguage) {
        switch (scriptLanguage.toLowerCase()) {
            case 'python':
            case 'jython':
                return '.py';
            case 'nashorn':
            case 'javascript':
            case 'emcascript':
            case 'js':
                return '.js';
            default:
                return '.unknown';
        }
    }
}
