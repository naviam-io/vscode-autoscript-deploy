/* eslint-disable no-undef */
/*
 * Deploys a declarative manifest against a live Maximo and verifies what actually arrived.
 *
 * The manifest is planned by the real planner and run by the real executor; the handlers are the
 * REST calls the extension makes, because the extension's own handlers are bundled ES modules that
 * depend on the "vscode" module and cannot be required here. What this covers is therefore the
 * planner, the executor, the deployscript action added to naviam.autoscript.deploy.js, and the
 * shape of the requests themselves.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { assertEquals, assertNotNull } = require('../harness');
const { planManifest } = require('../../../src/deploy/manifest-planner');
const { executePlan } = require('../../../src/deploy/manifest-executor');

const SCRIPT_NAME = 'NVTEST.MANIFEST.SCRIPT';
const DEPLOY_SCRIPT_NAME = 'NVTEST.MANIFEST.DEPLOYSCRIPT';
const PROPERTY_NAME = 'TEST_manifest_configuration';
const SIDECAR_PROPERTY_NAME = 'TEST_manifest_sidecar';

function scriptSource(autoscript, body) {
    return [
        'var scriptConfig = {', //
        '    "autoscript": "' + autoscript + '",',
        '    "description": "Manifest integration test",',
        '    "status": "Active"',
        '};',
        body
    ].join('\n');
}

function property(name, value) {
    return {
        properties: [
            {
                propName: name,
                description: 'Manifest integration test',
                propValue: value,
                globalOnly: true,
                liveRefresh: false,
                nullsAllowed: true,
                maxType: 'ALN',
                secureLevel: '!SECURE!'
            }
        ]
    };
}

/*
 * Writes the manifest project the test deploys and returns its root directory.
 *
 * The automation script carries a predeploy sidecar that would create a second property. The
 * manifest gives the script a kind, so the sidecar must be ignored and that property must never
 * appear: that is the behaviour the ticket asks for.
 */
function createProject() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-integration-'));

    const files = {
        'install.manifest.json': {
            manifest: [
                { kind: 'configuration', path: './config/property.json' },
                { kind: 'automationScript', path: './scripts/nvtest.manifest.script.js' },
                { kind: 'manifest', path: './features/deploy.manifest.json' }
            ]
        },
        'config/property.json': property(PROPERTY_NAME, 'deployed'),
        'scripts/nvtest.manifest.script.js': scriptSource(SCRIPT_NAME, 'service.log("manifest integration test");'),
        'scripts/nvtest.manifest.script.predeploy.json': property(SIDECAR_PROPERTY_NAME, 'sidecar'),
        'features/deploy.manifest.json': {
            manifest: [{ kind: 'deployScript', path: './nvtest.manifest.deployscript.js' }]
        },
        'features/nvtest.manifest.deployscript.js': scriptSource(DEPLOY_SCRIPT_NAME, 'service.log("deploy script ran");'),
        // The superseded form: no kind anywhere, which must still deploy the script's sidecars.
        'legacy.manifest.json': { manifest: [{ path: './scripts/nvtest.manifest.script.js' }] }
    };

    for (const [relativePath, contents] of Object.entries(files)) {
        const filePath = path.join(root, relativePath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, typeof contents === 'string' ? contents : JSON.stringify(contents, null, 4), 'utf8');
    }

    return root;
}

function handlers(client, record) {
    return {
        configuration: async (step) => {
            await client.deployConfig(JSON.parse(fs.readFileSync(step.path, 'utf8')));
            return true;
        },
        automationScript: async (step) => {
            record.sidecars = step.sidecars;

            // Mirrors what deploy-script-command.js does with the flag: an entry that keeps its
            // sidecars applies the predeploy configuration beside the script before deploying it.
            const predeploy = step.path.replace(/\.[^.]+$/, '.predeploy.json');
            if (step.sidecars && fs.existsSync(predeploy)) {
                await client.deployConfig(JSON.parse(fs.readFileSync(predeploy, 'utf8')));
            }

            const response = await client.deployScriptSource(fs.readFileSync(step.path, 'utf8'));
            if (response && response.status === 'error') {
                throw new Error(response.message);
            }
            return true;
        },
        deployScript: async (step) => {
            record.deployScriptResponse = await client.runDeployScript(fs.readFileSync(step.path, 'utf8'));
            if (record.deployScriptResponse && record.deployScriptResponse.status === 'error') {
                throw new Error(record.deployScriptResponse.message);
            }
            return true;
        }
    };
}

async function deleteScript(client, name) {
    await client.deployScriptSource(['var scriptConfig = {', '    "autoscript": "' + name + '",', '    "_delete": true', '};'].join('\n'));
}

async function deleteProperty(client, name) {
    const payload = property(name, 'deployed');
    payload.properties[0]._delete = true;
    try {
        await client.deployConfig(payload);
    } catch (error) {
        // A property that was never created cannot be deleted, which is the expected outcome for
        // the sidecar property and must not fail the test.
    }
}

module.exports = {
    name: 'manifest',
    run: async (client) => {
        const root = createProject();
        const record = {};

        try {
            const plan = planManifest(path.join(root, 'install.manifest.json'));

            assertEquals(plan.errors.length, 0, 'Planning the manifest reported ' + JSON.stringify(plan.errors.map((error) => error.message)));
            assertEquals(plan.steps.length, 3, 'Planned step count');
            assertEquals(plan.deprecations.length, 0, 'Planned deprecation count');
            assertEquals(
                plan.steps.map((step) => step.kind).join(','),
                'configuration,automationScript,deployScript',
                'Planned step kinds, including the nested manifest expanded in place'
            );

            const result = await executePlan(plan.steps, handlers(client, record));

            assertEquals(result.failure, null, result.failure ? 'The manifest failed at ' + result.failure.step.kind + ': ' + result.failure.error.message : 'ok');
            assertEquals(result.completed, 3, 'Completed step count');

            // The configuration entry.
            const deployedProperty = await client.extract('properties', PROPERTY_NAME);
            assertNotNull(deployedProperty, 'The configuration entry did not create ' + PROPERTY_NAME);
            assertEquals(deployedProperty.propValue, 'deployed', 'Property value');

            // The automation script entry. That it is deployed as source only is asserted on the plan,
            // because the handler here decides what to do with the flag; the check against Maximo is
            // that nothing the sidecar declares turned up.
            assertEquals(record.sidecars, false, 'A kinded automationScript entry asked for sidecars');
            const deployedScript = await client.findScript(SCRIPT_NAME);
            assertNotNull(deployedScript, 'The automationScript entry did not deploy ' + SCRIPT_NAME);
            assertEquals(
                String(deployedScript.source).indexOf('manifest integration test') >= 0,
                true,
                'Deployed source of ' + SCRIPT_NAME + ' does not contain the expected body'
            );
            assertEquals(await client.extract('properties', SIDECAR_PROPERTY_NAME), null, 'The predeploy sidecar was deployed for a kinded entry');
            assertEquals(record.sidecars, false, 'The kinded entry must not ask for sidecars');

            // The deployScript entry: run once, then removed.
            assertEquals(record.deployScriptResponse.status, 'success', 'Deploy script status: ' + JSON.stringify(record.deployScriptResponse));
            assertEquals(record.deployScriptResponse.executed, true, 'Deploy script executed flag');
            assertEquals(record.deployScriptResponse.scriptName, DEPLOY_SCRIPT_NAME, 'Deploy script name');
            assertEquals(await client.findScript(DEPLOY_SCRIPT_NAME), null, 'The deploy script was left installed in Maximo');

            // The superseded form of the same script: no kind, so the sidecar must be deployed and
            // the entry reported as deprecated.
            const legacyPlan = planManifest(path.join(root, 'legacy.manifest.json'));
            assertEquals(legacyPlan.errors.length, 0, 'Planning the legacy manifest reported errors');
            assertEquals(legacyPlan.steps[0].sidecars, true, 'A legacy entry must keep its sidecars');
            assertEquals(legacyPlan.deprecations.length, 1, 'A legacy entry must be reported as deprecated');

            const legacyResult = await executePlan(legacyPlan.steps, handlers(client, record));
            assertEquals(legacyResult.failure, null, 'The legacy manifest failed');

            const sidecarProperty = await client.extract('properties', SIDECAR_PROPERTY_NAME);
            assertNotNull(sidecarProperty, 'The legacy entry did not deploy the predeploy sidecar');
            assertEquals(sidecarProperty.propValue, 'sidecar', 'Sidecar property value');

            // A deploy script that fails must report the failure and still be removed.
            const failing = scriptSource(DEPLOY_SCRIPT_NAME, 'throw new Error("deploy script failed on purpose");');
            const failure = await client.runDeployScript(failing);
            assertEquals(failure.status, 'error', 'A failing deploy script reported ' + JSON.stringify(failure));
            assertEquals(await client.findScript(DEPLOY_SCRIPT_NAME), null, 'A failing deploy script was left installed in Maximo');
        } finally {
            await deleteScript(client, SCRIPT_NAME);
            await deleteScript(client, DEPLOY_SCRIPT_NAME);
            await deleteProperty(client, PROPERTY_NAME);
            await deleteProperty(client, SIDECAR_PROPERTY_NAME);
            fs.rmSync(root, { recursive: true, force: true });
        }

        // The cleanup must have worked, otherwise the next run starts from dirty state.
        assertEquals(await client.findScript(SCRIPT_NAME), null, SCRIPT_NAME + ' was not removed');
        assertEquals(await client.findScript(DEPLOY_SCRIPT_NAME), null, DEPLOY_SCRIPT_NAME + ' was not removed');
        assertEquals(await client.extract('properties', PROPERTY_NAME), null, PROPERTY_NAME + ' was not removed');
    }
};
