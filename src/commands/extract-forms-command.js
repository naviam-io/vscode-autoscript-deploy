import * as fs from 'fs';
import * as crypto from 'crypto';

import { ProgressLocation, window, workspace } from 'vscode';

// get a reference to the Maximo configuration object
import { getMaximoConfig, asyncForEach } from '../extension';
import Logger from '../logger';

const LOG_SOURCE = 'ExtractFormsCommand';

export default async function extractFormsCommand(client) {
    Logger.info('Extract inspection forms command requested.', LOG_SOURCE);
    let extractLoc = (await getMaximoConfig()).extractLocationForms;
    // if the extract location has not been specified use the workspace folder.
    if (typeof extractLoc === 'undefined' || !extractLoc) {
        if (workspace.workspaceFolders !== undefined) {
            extractLoc = workspace.workspaceFolders[0].uri.fsPath;
        } else {
            Logger.error('Extract forms command failed because no working folder or extract folder is configured.', null, LOG_SOURCE);
            window.showErrorMessage('A working folder must be selected or an export folder configured before exporting inspection forms.', {
                modal: true,
            });
            return;
        }
    }

    if (!fs.existsSync(extractLoc)) {
        Logger.error(`Inspection form extract folder does not exist: ${extractLoc}.`, null, LOG_SOURCE);
        window.showErrorMessage(`The inspection form extract folder ${extractLoc} does not exist.`, { modal: true });
        return;
    }
    Logger.info(`Extracting inspection forms to ${extractLoc}.`, LOG_SOURCE);

    const quickPick = window.createQuickPick();
    quickPick.canSelectMany = true;
    quickPick.title = 'Select Inspection Forms from the List';
    quickPick.busy = true;
    quickPick.placeholder = 'Getting Inspection Form Definitions\u2026';
    quickPick.show();

    const objects = await client.getFormNames();

    if (objects != null && Array.isArray(objects)) {
        objects.sort((a, b) => a.label.localeCompare(b.label));
        quickPick.items = objects;

        quickPick.placeholder = 'Select All Forms';
        quickPick.busy = false;

        quickPick.onDidAccept(async () => {
            const forms = quickPick.selectedItems;
            if (forms.length > 0) {
                Logger.info(`Extracting ${forms.length} inspection form(s).`, LOG_SOURCE);
                await window.withProgress(
                    {
                        title: 'Extracting Forms',
                        location: ProgressLocation.Notification,
                        cancellable: true,
                    },
                    async (progress, cancelToken) => {
                        let percent = Math.round((1 / forms.length) * 100);

                        let overwriteAll = false;
                        let overwrite = false;

                        await asyncForEach(forms, async (form) => {
                            if (!cancelToken.isCancellationRequested) {
                                progress.report({
                                    increment: percent,
                                    message: `Extracting ${form.label}`,
                                });

                                let formInfo = await client.getForm(form.id);

                                let fileExtension = '.json';

                                let outputFile =
                                    extractLoc +
                                    '/' +
                                    formInfo.name.toLowerCase().replaceAll(' ', '-').replaceAll('/', '-').replaceAll('\\', '-') +
                                    fileExtension;
                                let source = JSON.stringify(formInfo, null, 4);

                                // if the file doesn't exist then just write it out.
                                if (!fs.existsSync(outputFile)) {
                                    fs.writeFileSync(outputFile, source);
                                } else {
                                    let incomingHash = crypto.createHash('sha256').update(source).digest('hex');
                                    // @ts-ignore
                                    let fileHash = crypto.createHash('sha256').update(fs.readFileSync(outputFile)).digest('hex');

                                    if (fileHash !== incomingHash) {
                                        if (!overwriteAll) {
                                            await window
                                                .showInformationMessage(`The inspection form ${form.name} exists. \nReplace?`, { modal: true }, ...['Replace'])
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
                                            fs.writeFileSync(outputFile, source);
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
                            window.showInformationMessage(forms.length + (forms.length > 1 ? ' forms' : ' form') + ' extracted.', { modal: true });
                            Logger.info(`${forms.length} inspection form(s) extracted.`, LOG_SOURCE);
                        }
                    }
                );
            } else {
                Logger.info('Extract forms command cancelled without a selection.', LOG_SOURCE);
                quickPick.hide();
            }
        });
    } else {
        quickPick.hide();
        Logger.error('No inspection forms were found to extract.', null, LOG_SOURCE);
        window.showErrorMessage('No inspection forms were found to extract.', {
            modal: true,
        });
    }
}
