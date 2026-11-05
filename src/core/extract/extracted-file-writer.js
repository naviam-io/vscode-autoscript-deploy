import * as crypto from 'crypto';
import * as fs from 'fs';

import { Decision } from '../ui.js';

const sha256 = (content) => crypto.createHash('sha256').update(content).digest('hex');

/**
 * Writes extracted files, asking before replacing one that differs. One writer per extract run, so that
 * "Replace All" lasts for the run.
 */
export function createExtractedFileWriter(ui) {
    let replaceAll = false;

    return {
        async write(filePath, content, label) {
            if (!fs.existsSync(filePath)) {
                fs.writeFileSync(filePath, content);
                return 'written';
            }
            if (sha256(fs.readFileSync(filePath)) === sha256(content)) {
                return 'unchanged';
            }
            if (!replaceAll) {
                const answer = await ui.choose(Decision.OVERWRITE, `The ${label} exists. \nReplace?`, { actions: ['Replace', 'Replace All', 'Skip'] });
                if (answer === 'Skip') {
                    return 'skipped';
                }
                if (answer === 'Replace All') {
                    replaceAll = true;
                } else if (answer !== 'Replace') {
                    return 'cancelled';
                }
            }
            fs.writeFileSync(filePath, content);
            return 'replaced';
        }
    };
}
