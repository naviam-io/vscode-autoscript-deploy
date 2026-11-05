import format from 'xml-formatter';

import Logger from '../log.js';
import { createExtractedFileWriter } from './extracted-file-writer.js';

const LOG_SOURCE = 'ExtractScreensCommand';

/**
 * Extracts screen definitions into extractDir as formatted XML, one file per application.
 *
 * @param {*} client the Maximo client
 * @param {import('../ui.js').Ui} ui
 * @param {string[]} names the screen (application) names
 * @param {string} extractDir an existing folder
 * @returns {Promise<{ extracted: number, failures: { name: string, message: string }[], cancelled: boolean }>}
 */
export async function extractScreens(client, ui, names, extractDir) {
    const writer = createExtractedFileWriter(ui);
    const failures = [];
    let extracted = 0;
    let cancelled = false;

    await ui.withProgress({ title: 'Extracting Screen Definitions', cancellable: true }, async (progress, token) => {
        const percent = Math.round((1 / names.length) * 100);

        for (const screenName of names) {
            if (token.isCancellationRequested) {
                cancelled = true;
                break;
            }
            progress.report({ increment: percent, message: `Extracting ${screenName}` });

            try {
                const screenInfo = await client.getScreen(screenName);
                const fileName = screenName.toLowerCase() + '.xml';

                if ((await writer.write(extractDir + '/' + fileName, format(screenInfo.presentation), `screen ${fileName}`)) === 'cancelled') {
                    cancelled = true;
                    break;
                }
                extracted++;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                failures.push({ name: screenName, message });
                Logger.error(`Failed to extract screen definition ${screenName}: ${message}`, null, LOG_SOURCE);
            }
        }
    });

    return { extracted, failures, cancelled };
}
