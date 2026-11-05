import { window, workspace } from 'vscode';

import { getMaximoConfig } from '../extension';
import { extractScreens } from '../core/extract/extract-screens.js';
import vscodeUi from '../vscode-ui.js';
import Logger from '../logger';
import { prepareExtractFolder, showExtractResult } from '../core/extract/extract-support.js';

const LOG_SOURCE = 'ExtractScreensCommand';

export default async function extractScreensCommand(client) {
    Logger.info('Extract screen definitions command requested.', LOG_SOURCE);
    const extractDir = prepareExtractFolder(vscodeUi, (await getMaximoConfig()).extractLocationScreens, workspace.workspaceFolders?.[0]?.uri.fsPath, 'screen definitions', LOG_SOURCE);
    if (!extractDir) {
        return;
    }

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
            const selected = quickPick.selectedItems.map((item) => item.label);
            if (selected.length > 0) {
                Logger.info(`Extracting ${selected.length} screen definition(s).`, LOG_SOURCE);
                const result = await extractScreens(client, vscodeUi, selected, extractDir);
                showExtractResult(vscodeUi, result, selected.length, { singular: 'screen definition', plural: 'screen definitions', success: 'Screen definitions extracted.' }, LOG_SOURCE);
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
