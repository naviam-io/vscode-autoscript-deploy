/*
 * What the extractors share around them: the folder to extract to and the message for the result.
 * Part of the core: see docs/modules/core.md.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import Logger from '../log.js';

const MAX_FAILURES_SHOWN = 3;

/**
 * Where to extract to: the configured location, resolved against the workspace, or the workspace itself.
 *
 * @param {string|undefined} configured the extract location setting
 * @param {string|undefined} workspaceRoot the first workspace folder
 * @returns {string|undefined} undefined when neither is available
 */
export function resolveExtractLocation(configured, workspaceRoot) {
    if (!configured) {
        return workspaceRoot;
    }
    if (configured.startsWith('~')) {
        return path.join(os.homedir(), configured.slice(1));
    }
    if ((configured.startsWith('./') || configured.startsWith('.\\')) && workspaceRoot !== undefined) {
        return path.join(workspaceRoot, configured.slice(2));
    }
    if (!path.isAbsolute(configured) && workspaceRoot !== undefined) {
        return path.join(workspaceRoot, configured);
    }
    return configured;
}

/**
 * Resolves the configured extract location and creates it.
 *
 * @param {import('../ui.js').Ui} ui
 * @param {string|undefined} configured the extract location setting
 * @param {string|undefined} workspaceRoot the first workspace folder
 * @param {string} what what is being extracted, for the messages, e.g. "automation scripts"
 * @param {string} logSource
 * @returns {string|undefined} undefined when there is nowhere to extract to, the user having been told
 */
export function prepareExtractFolder(ui, configured, workspaceRoot, what, logSource) {
    const extractDir = resolveExtractLocation(configured, workspaceRoot);

    if (!extractDir) {
        Logger.error(`Extract ${what} failed because no working folder or extract folder is configured.`, null, logSource);
        ui.error(`A working folder must be selected or an export folder configured before exporting ${what}.`);
        return undefined;
    }

    fs.mkdirSync(extractDir, { recursive: true });
    Logger.info(`Extracting ${what} to ${extractDir}.`, logSource);
    return extractDir;
}

/**
 * Tells the user how an extract went: the success message, or which items failed.
 *
 * @param {import('../ui.js').Ui} ui
 * @param {{ extracted: number, failures: { name: string, message: string }[], cancelled: boolean }} result
 * @param {number} total how many items were selected
 * @param {{ singular: string, plural: string, success: string }} nouns
 * @param {string} logSource
 */
export function showExtractResult(ui, result, total, { singular, plural, success }, logSource) {
    const { failures, cancelled } = result;

    if (failures.length > 0) {
        const summary = `${failures.length} of ${total} ${total > 1 ? plural : singular} could not be extracted.`;
        let details = failures
            .slice(0, MAX_FAILURES_SHOWN)
            .map((failure) => `${failure.name}:\n${failure.message}`)
            .join('\n\n');
        if (failures.length > MAX_FAILURES_SHOWN) {
            details += `\n\n...and ${failures.length - MAX_FAILURES_SHOWN} more. See the MaximoDevTools output log for details.`;
        }
        Logger.error(`${summary} ${result.extracted} ${plural} extracted.`, null, logSource);
        ui.error(summary, { detail: details });
    } else if (!cancelled) {
        ui.info(success);
        Logger.info(`${total} ${total > 1 ? plural : singular} extracted.`, logSource);
    }
}
