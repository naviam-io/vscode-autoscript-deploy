/*
 * Unit tests for how the Maximo side form script finds an existing inspection form, run through the
 * function extraction harness.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { loadScriptFunctions } from '../harness.js';

describe('formStatuses', () => {
    it('lists every stored synonym of the internal statuses, so a translated system finds its forms', () => {
        const synonyms = { DRAFT: "'DRAFT','CONCEPT'", PNDREV: "'PNDREV'" };
        const translator = { toExternalList: (domain, value) => (domain === 'INSPECTFORMSTATUS' ? synonyms[value] : assert.fail(domain)) };
        const MXServer = { getMXServer: () => ({ getMaximoDD: () => ({ getTranslator: () => translator }) }) };
        const { formStatuses } = loadScriptFunctions('resources/naviam.autoscript.form.js', ['formStatuses'], { MXServer });

        assert.strictEqual(formStatuses(['PNDREV', 'DRAFT']), "'PNDREV', 'DRAFT','CONCEPT'");
    });
});
