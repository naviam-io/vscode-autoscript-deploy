import Logger from '../log.js';
import { createExtractedFileWriter } from './extracted-file-writer.js';

const LOG_SOURCE = 'ExtractFormsCommand';

/**
 * Extracts inspection forms into extractDir as JSON, one file per form named after it.
 *
 * @param {*} client the Maximo client
 * @param {import('../ui.js').Ui} ui
 * @param {readonly { id: *, label: string }[]} forms the forms, as listed by getFormNames
 * @param {string} extractDir an existing folder
 * @returns {Promise<{ extracted: number, failures: { name: string, message: string }[], cancelled: boolean }>}
 */
export async function extractForms(client, ui, forms, extractDir) {
    const writer = createExtractedFileWriter(ui);
    const failures = [];
    let extracted = 0;
    let cancelled = false;

    await ui.withProgress({ title: 'Extracting Forms', cancellable: true }, async (progress, token) => {
        const percent = Math.round((1 / forms.length) * 100);

        for (const form of forms) {
            if (token.isCancellationRequested) {
                cancelled = true;
                break;
            }
            progress.report({ increment: percent, message: `Extracting ${form.label}` });

            try {
                const formInfo = await client.getForm(form.id);
                const outputFile = extractDir + '/' + formInfo.name.toLowerCase().replaceAll(' ', '-').replaceAll('/', '-').replaceAll('\\', '-') + '.json';

                if ((await writer.write(outputFile, JSON.stringify(formInfo, null, 4), `inspection form ${formInfo.name}`)) === 'cancelled') {
                    cancelled = true;
                    break;
                }
                extracted++;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                failures.push({ name: form.label, message });
                Logger.error(`Failed to extract inspection form ${form.label}: ${message}`, null, LOG_SOURCE);
            }
        }
    });

    return { extracted, failures, cancelled };
}
