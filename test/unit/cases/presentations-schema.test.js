/*
 * The deploy schema and the presentations model agree on what a presentation entry looks like, so
 * the editor flags what the deployment would reject.
 *
 *   npm run package:library && npm run test:unit
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';

import { loadScriptFunctions, REPO_ROOT } from '../harness.js';
import { MODEL_FUNCTIONS, REJECTED, SCHEMA_ONLY, VALID_CHANGES } from './presentations-model.test.js';

const { MaximoPresentation } = loadScriptFunctions('resources/naviam.autoscript.library.js', MODEL_FUNCTIONS, {});
const schema = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'schemas', 'deploy-schema.json'), 'utf8'));
const validate = new Ajv({ strict: false, allErrors: true }).compile(schema);

// JSON Schema cannot compare the keys of set with the items of unset.
const MODEL_ONLY = ['an attribute both set and unset'];

function payload(entry) {
    return { presentations: [entry] };
}

describe('the presentations schema', () => {
    it('accepts every valid change the model accepts', () => {
        VALID_CHANGES.forEach((change) => {
            const entry = { app: 'X', changes: [change] };
            assert.doesNotThrow(() => new MaximoPresentation(entry));
            assert.ok(validate(payload(entry)), JSON.stringify(change) + ': ' + JSON.stringify(validate.errors));
        });
    });

    REJECTED.filter(([description]) => MODEL_ONLY.indexOf(description) < 0).forEach(([description, input]) => {
        it('rejects ' + description + ', as the model does', () => {
            assert.throws(() => new MaximoPresentation(input));
            assert.ok(!validate(payload(input)), 'the schema accepted ' + JSON.stringify(input));
        });
    });

    SCHEMA_ONLY.forEach(([description, input]) => {
        it('rejects ' + description, () => {
            assert.ok(!validate(payload(input)), 'the schema accepted ' + JSON.stringify(input));
        });
    });
});
