import { window, workspace } from 'vscode';

import { getMaximoConfig } from '../extension';
import { extractScripts } from '../core/extract/extract-scripts.js';
import vscodeUi from '../vscode-ui.js';
import Logger from '../logger';
import { prepareExtractFolder, showExtractResult } from '../core/extract/extract-support.js';

const LOG_SOURCE = 'ExtractScriptsCommand';

export default async function extractScriptsCommand(client) {
    Logger.info('Extract automation scripts command requested.', LOG_SOURCE);
    const extractDir = prepareExtractFolder(vscodeUi, (await getMaximoConfig()).extractLocation, workspace.workspaceFolders?.[0]?.uri.fsPath, 'automation scripts', LOG_SOURCE);
    if (!extractDir) {
        return;
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
            const selected = quickPick.selectedItems.map((item) => item.label);
            if (selected.length > 0) {
                Logger.info(`Extracting ${selected.length} automation script(s).`, LOG_SOURCE);
                const result = await extractScripts(client, vscodeUi, selected, extractDir);
                showExtractResult(vscodeUi, result, selected.length, { singular: 'automation script', plural: 'automation scripts', success: 'Automation scripts extracted.' }, LOG_SOURCE);
            } else {
                Logger.info('Extract scripts command cancelled without a selection.', LOG_SOURCE);
                quickPick.hide();
            }
        });
    } else {
        quickPick.hide();
        Logger.error('No automation scripts were found to extract.', null, LOG_SOURCE);
        window.showErrorMessage('No scripts were found to extract.', { modal: true });
    }
}
