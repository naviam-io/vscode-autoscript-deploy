import { window, workspace } from 'vscode';

import { getMaximoConfig } from '../extension';
import { extractReports } from '../core/extract/extract-reports.js';
import vscodeUi from '../vscode-ui.js';
import Logger from '../logger';
import { prepareExtractFolder, showExtractResult } from '../core/extract/extract-support.js';

const LOG_SOURCE = 'ExtractReportsCommand';

export default async function extractReportsCommand(client) {
    Logger.info('Extract reports command requested.', LOG_SOURCE);
    const extractDir = prepareExtractFolder(vscodeUi, (await getMaximoConfig()).extractLocationReports, workspace.workspaceFolders?.[0]?.uri.fsPath, 'reports', LOG_SOURCE);
    if (!extractDir) {
        return;
    }

    /** @type {import('vscode').QuickPick<import('vscode').QuickPickItem & { reportId: *, reportName: string, description: string }>} */
    const quickPick = window.createQuickPick();
    quickPick.canSelectMany = true;
    quickPick.title = 'Select Reports from the List';
    quickPick.busy = true;
    quickPick.placeholder = 'Getting Report Definitions\u2026';
    quickPick.show();

    const objects = await client.getReportNames();

    if (objects != null && Array.isArray(objects)) {
        objects.sort((a, b) => a.label.localeCompare(b.label));
        quickPick.items = objects;

        quickPick.placeholder = 'Select All Reports';
        quickPick.busy = false;

        quickPick.onDidAccept(async () => {
            const selected = quickPick.selectedItems;
            if (selected.length > 0) {
                Logger.info(`Extracting ${selected.length} report(s).`, LOG_SOURCE);
                const result = await extractReports(client, vscodeUi, selected, extractDir);
                showExtractResult(vscodeUi, result, selected.length, { singular: 'report', plural: 'reports', success: selected.length + (selected.length > 1 ? ' reports' : ' report') + ' extracted.' }, LOG_SOURCE);
            } else {
                Logger.info('Extract reports command cancelled without a selection.', LOG_SOURCE);
                quickPick.hide();
            }
        });
    } else {
        quickPick.hide();
        Logger.error('No reports were found to extract.', null, LOG_SOURCE);
        window.showErrorMessage('No reports were found to extract.', { modal: true });
    }
}
