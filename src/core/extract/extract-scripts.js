import Logger from '../log.js';
import { createExtractedFileWriter } from './extracted-file-writer.js';

const LOG_SOURCE = 'ExtractScriptsCommand';

/**
 * Extracts automation scripts into extractDir, one file per script named by script and language.
 *
 * @param {*} client the Maximo client
 * @param {import('../ui.js').Ui} ui
 * @param {string[]} names the script names
 * @param {string} extractDir an existing folder
 * @returns {Promise<{ extracted: number, failures: { name: string, message: string }[], cancelled: boolean }>}
 */
export async function extractScripts(client, ui, names, extractDir) {
    const writer = createExtractedFileWriter(ui);
    const failures = [];
    let extracted = 0;
    let cancelled = false;

    await ui.withProgress({ title: 'Extracting Automation Script', cancellable: true }, async (progress, token) => {
        const percent = Math.round((1 / names.length) * 100);

        for (const scriptName of names) {
            if (token.isCancellationRequested) {
                cancelled = true;
                break;
            }
            progress.report({ increment: percent, message: `Extracting ${scriptName}` });

            try {
                const scriptInfo = await client.getScript(scriptName);
                const fileName = scriptName.toLowerCase() + scriptExtension(scriptInfo.scriptLanguage);

                if ((await writer.write(extractDir + '/' + fileName, scriptInfo.script, `script ${fileName}`)) === 'cancelled') {
                    cancelled = true;
                    break;
                }
                extracted++;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                failures.push({ name: scriptName, message });
                Logger.error(`Failed to extract automation script ${scriptName}: ${message}`, null, LOG_SOURCE);
            }
        }
    });

    return { extracted, failures, cancelled };
}

function scriptExtension(scriptLanguage) {
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
