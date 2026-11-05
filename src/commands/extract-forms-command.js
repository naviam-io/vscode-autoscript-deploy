import { window, workspace } from 'vscode';

import { getMaximoConfig } from '../extension';
import { extractForms } from '../core/extract/extract-forms.js';
import vscodeUi from '../vscode-ui.js';
import Logger from '../logger';
import { prepareExtractFolder, showExtractResult } from '../core/extract/extract-support.js';

const LOG_SOURCE = 'ExtractFormsCommand';

export default async function extractFormsCommand(client) {
    Logger.info('Extract inspection forms command requested.', LOG_SOURCE);
    const extractDir = prepareExtractFolder(vscodeUi, (await getMaximoConfig()).extractLocationForms, workspace.workspaceFolders?.[0]?.uri.fsPath, 'inspection forms', LOG_SOURCE);
    if (!extractDir) {
        return;
    }

    /** @type {import('vscode').QuickPick<import('vscode').QuickPickItem & { id: * }>} */
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
            const selected = quickPick.selectedItems;
            if (selected.length > 0) {
                Logger.info(`Extracting ${selected.length} inspection form(s).`, LOG_SOURCE);
                const result = await extractForms(client, vscodeUi, selected, extractDir);
                showExtractResult(vscodeUi, result, selected.length, { singular: 'form', plural: 'forms', success: selected.length + (selected.length > 1 ? ' forms' : ' form') + ' extracted.' }, LOG_SOURCE);
            } else {
                Logger.info('Extract forms command cancelled without a selection.', LOG_SOURCE);
                quickPick.hide();
            }
        });
    } else {
        quickPick.hide();
        Logger.error('No inspection forms were found to extract.', null, LOG_SOURCE);
        window.showErrorMessage('No inspection forms were found to extract.', { modal: true });
    }
}
