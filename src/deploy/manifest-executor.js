/*
 * Runs a deployment plan produced by the manifest planner.
 *
 * The handlers that actually talk to Maximo are injected, which keeps this module free of the
 * "vscode" module and makes the ordering and failure rules testable on their own. A plan stops at
 * the first step that fails, so the remainder of a manifest is never applied on top of a resource
 * that did not deploy.
 */

/**
 * Executes the steps in order.
 *
 * A handler signals failure either by throwing or by returning false; anything else is success.
 *
 * @param {object[]} steps the ordered steps to run
 * @param {Object<string, function(object): Promise<*>>} handlers a handler per step kind
 * @returns {Promise<{ completed: number, failure: { step: object, error: Error }|null }>}
 */
async function executePlan(steps, handlers) {
    let completed = 0;

    for (const step of steps) {
        const handler = handlers[step.kind];

        if (typeof handler !== 'function') {
            return { completed, failure: { step, error: new Error(`No handler is registered for a "${step.kind}" deployment step.`) } };
        }

        try {
            if ((await handler(step)) === false) {
                return { completed, failure: { step, error: new Error(`Deployment of ${step.path || step.kind} did not succeed.`) } };
            }
        } catch (error) {
            return { completed, failure: { step, error: error instanceof Error ? error : new Error(String(error)) } };
        }

        completed++;
    }

    return { completed, failure: null };
}

module.exports = { executePlan };
