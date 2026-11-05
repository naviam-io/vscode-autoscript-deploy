/*
 * Create-only deployment of a manifest entry: see docs/flows/deploy.md. The server decides whether
 * the item exists and answers with an outcome; these helpers build the request and read the answer.
 */
import { MaximoError } from '../maximo/errors.js';

const SKIPPED = 'skipped';

const OUTDATED_SERVER_MESSAGE = 'The Maximo Development Tools scripts on the server are too old for create-only deployment. Upgrade them, then deploy again.';

function createOnlyParams(options) {
    return options && options.createOnly === true ? { createOnly: 'true' } : undefined;
}

function assertCreateOnlyOutcome(data, options) {
    if (options && options.createOnly === true && data && data.status !== 'error' && typeof data.outcome === 'undefined') {
        throw new MaximoError(OUTDATED_SERVER_MESSAGE);
    }
}

function isSkipped(result, options) {
    return !!options && options.createOnly === true && !!result && result.outcome === SKIPPED;
}

function skippedMessage(fileName) {
    return `${fileName} already exists in Maximo and is create-only; it was left unchanged.`;
}

export { SKIPPED, OUTDATED_SERVER_MESSAGE, createOnlyParams, assertCreateOnlyOutcome, isSkipped, skippedMessage };
