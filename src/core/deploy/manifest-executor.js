/*
 * Runs a deployment plan produced by the manifest planner.
 *
 * The handlers that actually talk to Maximo are injected, which makes the ordering and failure
 * rules testable on their own. Part of the core: see docs/modules/core.md. A plan stops at
 * the first step that fails, so the remainder of a manifest is never applied on top of a resource
 * that did not deploy.
 */
import { SKIPPED } from './create-only.js';

/**
 * Executes the steps in order.
 *
 * A handler signals failure either by throwing or by returning false; anything else is success.
 * A handler that returns SKIPPED succeeded without changing anything, and is counted in skipped as
 * well as completed.
 *
 * @param {object[]} steps the ordered steps to run
 * @param {Object<string, function(object): Promise<*>>} handlers a handler per step kind
 * @returns {Promise<{ completed: number, skipped: number, failure: { step: object, error: Error }|null }>}
 */
async function executePlan(steps, handlers) {
    let completed = 0;
    let skipped = 0;

    for (const step of steps) {
        const handler = handlers[step.kind];

        if (typeof handler !== 'function') {
            return { completed, skipped, failure: { step, error: new Error(`No handler is registered for a "${step.kind}" deployment step.`) } };
        }

        try {
            const outcome = await handler(step);
            if (outcome === false) {
                return { completed, skipped, failure: { step, error: new Error(`Deployment of ${step.path || step.kind} did not succeed.`) } };
            }
            if (outcome === SKIPPED) {
                skipped++;
            }
        } catch (error) {
            return { completed, skipped, failure: { step, error: error instanceof Error ? error : new Error(String(error)) } };
        }

        completed++;
    }

    return { completed, skipped, failure: null };
}

export { executePlan };
