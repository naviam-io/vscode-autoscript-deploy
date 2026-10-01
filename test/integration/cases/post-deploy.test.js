/* eslint-disable no-undef */
/*
 * Verifies what a script asks to happen once it has been deployed.
 *
 * A configuration may name a function inside the script itself, or a separate script to run, and
 * the two are handled by different code. Neither can be unit tested, because both end in a Maximo
 * script engine, and neither leaves a record behind to inspect: the function runs in a throwaway
 * engine and the separate script is deleted once it has run.
 *
 * Both are therefore proved by what they can still be observed to do. A function that throws is
 * evidence that it was called, and the message it throws is evidence of what it was given; a
 * separate script that is gone afterwards is evidence that it ran and was cleaned up.
 */
const { assertEquals, assertNotNull } = require('../harness');

const HELPER_NAME = 'NVTEST.POSTDEPLOY.HELPER';

function scriptSource(config, body) {
    const declared = Object.assign({ description: 'Post deploy integration test', status: 'Active' }, config);
    return 'var scriptConfig = ' + JSON.stringify(declared, null, 4) + ';\n\n' + (body || 'function main() {}\n');
}

async function deleteScript(client, name) {
    const record = await client.findScript(name);

    if (!record) {
        return;
    }

    await client.client.request({
        url: record.href,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-method-override': 'DELETE' },
        validateStatus: () => true
    });
}

function assertContains(actual, expected, message) {
    if (String(actual).indexOf(expected) === -1) {
        throw new Error(message + ' - expected to find "' + expected + '" in "' + actual + '"');
    }
}

module.exports = {
    name: 'post-deploy',
    run: async (client) => {
        const scripts = [];

        async function deploy(name, config, body) {
            scripts.push(name);
            return client.deployScriptSource(scriptSource(Object.assign({ autoscript: name }, config), body), false);
        }

        try {
            const missing = await deploy('NVTEST.POSTDEPLOY.MISSING', { onDeploy: 'thereIsNoSuchFunction' });

            assertEquals(missing.status, 'error', 'Naming an onDeploy function that does not exist was accepted');
            assertEquals(missing.reason, 'ondeploy_function_notfound', 'Reason for a missing onDeploy function, got ' + JSON.stringify(missing));

            // A function that throws proves both that it was called by the name the configuration
            // gave, and that the deploy context was bound into the engine it was called in.
            const bindings = await deploy(
                'NVTEST.POSTDEPLOY.BINDINGS',
                { onDeploy: 'reportBindings' },
                [
                    'function reportBindings() {',
                    "    throw 'NVBINDINGS:' + (typeof service) + ',' + (typeof userInfo) + ',' + (typeof request) + ',' + onDeploy;",
                    '}',
                    '',
                    'function main() {}',
                    ''
                ].join('\n')
            );

            assertEquals(bindings.status, 'error', 'An onDeploy function that throws was reported as a success');
            assertEquals(bindings.reason, 'error_ondeploy', 'Reason for a failing onDeploy function, got ' + JSON.stringify(bindings));
            assertContains(bindings.message, 'NVBINDINGS:object,object,object,true', 'The onDeploy function was not called with the deploy context');

            const succeeded = await deploy('NVTEST.POSTDEPLOY.OK', { onDeploy: 'onDeployed' }, 'function onDeployed() {}\n\nfunction main() {}\n');

            assertEquals(succeeded.status, 'success', 'An onDeploy function that returns reported ' + JSON.stringify(succeeded));

            // A separate deploy script is removed once it has run, which is what proves it ran at
            // all: nothing else it does is visible from here.
            await deploy(HELPER_NAME, {});
            assertNotNull(await client.findScript(HELPER_NAME), 'The helper script was not installed');

            const removed = await deploy('NVTEST.POSTDEPLOY.SCRIPT', { onDeployScript: HELPER_NAME });

            assertEquals(removed.status, 'success', 'Running a separate deploy script reported ' + JSON.stringify(removed));
            assertEquals(await client.findScript(HELPER_NAME), null, 'The separate deploy script was not removed after it ran');

            await deploy(HELPER_NAME, {});

            const kept = await deploy('NVTEST.POSTDEPLOY.KEEP', { onDeployScript: HELPER_NAME, deleteDeployScript: false });

            assertEquals(kept.status, 'success', 'Running a separate deploy script reported ' + JSON.stringify(kept));
            assertNotNull(await client.findScript(HELPER_NAME), 'deleteDeployScript false did not keep the separate deploy script');

            // A separate deploy script that fails has to fail the deployment rather than be
            // swallowed, so that a broken deployment is not reported as a successful one.
            await deploy('NVTEST.POSTDEPLOY.BADHELPER', {}, "throw 'NVHELPERFAILED';\n");

            const failed = await deploy('NVTEST.POSTDEPLOY.FAILS', { onDeployScript: 'NVTEST.POSTDEPLOY.BADHELPER' });

            assertEquals(failed.status, 'error', 'A failing separate deploy script was reported as a success');
            assertContains(failed.message, 'NVHELPERFAILED', 'The failure of the separate deploy script was not reported');

            // A deploy script that is named but not installed is not an error: there is nothing to
            // run, and the deployment itself succeeded.
            const absent = await deploy('NVTEST.POSTDEPLOY.ABSENT', { onDeployScript: 'NVTEST.POSTDEPLOY.NOTINSTALLED' });

            assertEquals(absent.status, 'success', 'Naming a deploy script that is not installed reported ' + JSON.stringify(absent));
        } finally {
            scripts.push('NVTEST.POSTDEPLOY.BADHELPER');

            for (const name of scripts) {
                await deleteScript(client, name);
            }
        }

        assertEquals(await client.findScript(HELPER_NAME), null, 'The helper script was not removed after the test');
    }
};
