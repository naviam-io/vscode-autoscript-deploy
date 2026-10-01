/*
 * Unit tests for the deployment manifest executor.
 *
 *   npm run test:unit
 *
 * The executor walks a plan produced by the planner and hands each step to the handler for its
 * kind. The handlers are injected, so this runs with no VS Code host and no Maximo server.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');

const { executePlan } = require('../../../src/deploy/manifest-executor');

function step(kind, filePath) {
    return { kind, path: filePath || null, sidecars: false, manifestPath: '/project/deploy.manifest.json' };
}

describe('executePlan', () => {
    it('hands each step to the handler for its kind, in order', async () => {
        const calls = [];
        const handlers = {
            configuration: async (item) => calls.push(`configuration:${item.path}`),
            databaseConfiguration: async () => calls.push('databaseConfiguration'),
            automationScript: async (item) => calls.push(`automationScript:${item.path}`)
        };

        const result = await executePlan([step('configuration', '/project/objects.json'), step('databaseConfiguration'), step('automationScript', '/project/a.js')], handlers);

        assert.deepStrictEqual(calls, ['configuration:/project/objects.json', 'databaseConfiguration', 'automationScript:/project/a.js']);
        assert.strictEqual(result.completed, 3);
        assert.strictEqual(result.failure, null);
    });

    it('stops at the first step that throws', async () => {
        const calls = [];
        const handlers = {
            configuration: async (item) => calls.push(item.path),
            automationScript: async () => {
                throw new Error('Maximo said no');
            }
        };

        const result = await executePlan(
            [step('configuration', '/project/a.json'), step('automationScript', '/project/b.js'), step('configuration', '/project/c.json')],
            handlers
        );

        assert.deepStrictEqual(calls, ['/project/a.json']);
        assert.strictEqual(result.completed, 1);
        assert.strictEqual(result.failure.step.path, '/project/b.js');
        assert.strictEqual(result.failure.error.message, 'Maximo said no');
    });

    it('stops at the first step whose handler reports failure without throwing', async () => {
        const calls = [];
        const handlers = {
            configuration: async (item) => {
                calls.push(item.path);
                return false;
            },
            automationScript: async (item) => calls.push(item.path)
        };

        const result = await executePlan([step('configuration', '/project/a.json'), step('automationScript', '/project/b.js')], handlers);

        assert.deepStrictEqual(calls, ['/project/a.json']);
        assert.strictEqual(result.completed, 0);
        assert.strictEqual(result.failure.step.path, '/project/a.json');
    });

    it('treats a handler that returns nothing as success', async () => {
        const result = await executePlan([step('screen', '/project/a.xml')], { screen: async () => undefined });

        assert.strictEqual(result.completed, 1);
        assert.strictEqual(result.failure, null);
    });

    it('fails a step whose kind has no handler', async () => {
        const result = await executePlan([step('report', '/project/a.rptdesign')], {});

        assert.strictEqual(result.completed, 0);
        assert.match(result.failure.error.message, /report/);
    });

    it('does nothing for an empty plan', async () => {
        const result = await executePlan([], {});

        assert.strictEqual(result.completed, 0);
        assert.strictEqual(result.failure, null);
    });
});
