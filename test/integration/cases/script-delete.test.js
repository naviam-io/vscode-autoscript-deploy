/* eslint-disable no-undef */
/*
 * Verifies that deleting an automation script is idempotent.
 *
 * Deleting is asked for the same way as deploying: a scriptConfig is sent to the deploy action,
 * with "_delete": true and usually nothing else. Asking to delete a script that is not there has
 * to leave Maximo without that script, whether or not it was there to begin with, because the
 * caller cannot generally know: a deployment that already removed the script, a cleanup that runs
 * whether or not the earlier steps got far enough, and a second run of the same deletion all ask
 * to delete something that has already gone.
 */
const { assertEquals, assertNotNull } = require('../harness');

const SCRIPT_NAME = 'NVTEST.DELETE.SCRIPT';

function deletionRequest(name) {
    return ['var scriptConfig = {', '    "autoscript": "' + name + '",', '    "_delete": true', '};'].join('\n');
}

function scriptSource(name) {
    return [
        'var scriptConfig = {',
        '    "autoscript": "' + name + '",',
        '    "description": "Script deletion integration test",',
        '    "status": "Active"',
        '};',
        '',
        'function main() {}',
        ''
    ].join('\n');
}

module.exports = {
    name: 'script-delete',
    run: async (client) => {
        try {
            assertEquals(await client.findScript(SCRIPT_NAME), null, 'The test script already existed before the test ran');

            // Deleting a script that is not there is not an error, and must not install one. The
            // deletion request is itself a script source, so getting this wrong deploys the
            // request as the very script it was asking to remove.
            const absent = await client.deployScriptSource(deletionRequest(SCRIPT_NAME), false);

            assertEquals(absent.status, 'success', 'Deleting a script that does not exist reported ' + JSON.stringify(absent));
            assertEquals(absent.deleted, true, 'Deleting a script that does not exist must still report the script as deleted');
            assertEquals(await client.findScript(SCRIPT_NAME), null, 'Deleting a script that does not exist installed it instead');

            const deployed = await client.deployScriptSource(scriptSource(SCRIPT_NAME), false);
            assertEquals(deployed.status, 'success', 'Deploying the script reported ' + JSON.stringify(deployed));
            assertNotNull(await client.findScript(SCRIPT_NAME), 'The script was not deployed');

            const removed = await client.deployScriptSource(deletionRequest(SCRIPT_NAME), false);

            assertEquals(removed.status, 'success', 'Deleting the script reported ' + JSON.stringify(removed));
            assertEquals(removed.deleted, true, 'Deleting an existing script must report it as deleted');
            assertEquals(await client.findScript(SCRIPT_NAME), null, 'The script was not deleted');

            // Repeating the deletion has to leave the same result behind rather than reinstate it.
            const again = await client.deployScriptSource(deletionRequest(SCRIPT_NAME), false);

            assertEquals(again.status, 'success', 'Repeating the deletion reported ' + JSON.stringify(again));
            assertEquals(await client.findScript(SCRIPT_NAME), null, 'Repeating the deletion installed the script again');
        } finally {
            const leftover = await client.findScript(SCRIPT_NAME);

            if (leftover) {
                await client.client.request({
                    url: leftover.href,
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-method-override': 'DELETE' },
                    validateStatus: () => true
                });
            }
        }
    }
};
