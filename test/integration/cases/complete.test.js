/* eslint-disable no-undef */
/*
 * Deploys test/complete/release.manifest.json, which holds one of every kind of resource a manifest
 * can deploy apart from a BIRT report, verifies each arrived without errors, then runs
 * test/complete/remove.manifest.json and verifies every record is gone again.
 *
 * The same two manifests are what a developer deploys by hand from VS Code, see
 * test/complete/README.md. The field values of each resource are not compared here: that is what the
 * per type round trip cases do. This case proves that the resources deploy together, in manifest
 * order, and can be removed again.
 *
 * The object the manifest declares needs a database configuration to be applied, and another to
 * be removed. When Maximo requires Admin Mode for that, this case takes it, which logs every user
 * out: run it against a disposable environment only.
 *
 * The handlers are the REST calls the extension makes, because the extension's own handlers are
 * bundled ES modules that depend on the "vscode" module and cannot be required here.
 */
const fs = require('fs');
const path = require('path');
const { assertEquals, assertNotNull, REPO_ROOT } = require('../harness');
const { planManifest } = require('../../../src/deploy/manifest-planner');
const { executePlan } = require('../../../src/deploy/manifest-executor');

const COMPLETE_DIR = path.join(REPO_ROOT, 'test', 'complete');
const RELEASE_MANIFEST = path.join(COMPLETE_DIR, 'release.manifest.json');
const REMOVE_MANIFEST = path.join(COMPLETE_DIR, 'remove.manifest.json');

const SCRIPT_NAME = 'TEST.COMPLETE';
const ACTION_SCRIPT_NAME = 'OSACTION.TESTPERSONAPI.TESTCOMPLETE';
const DEPLOY_SCRIPTS = ['TEST.COMPLETE.CREATEAPP', 'TEST.COMPLETE.REMOVE', 'TEST.COMPLETE.VERIFY'];
const OBJECT_NAME = 'TESTOBJ';
const APP = 'TESTACTION';
const FORM_NAME = 'TEST Complete Inspection';
const APP_AUTH_CONTEXT = '/testcomplete';

const RELEASE_KINDS = [
    'configuration', // property.json, from the nested configuration manifest
    'configuration', // message.json
    'configuration', // logger.json
    'configuration', // domain.json
    'configuration', // object.json
    'configuration', // action.json
    'configuration', // cron-task.json
    'configuration', // escalation.json
    'configuration', // query.json
    'databaseConfiguration',
    'automationScript', // test.complete.js
    'automationScript', // osaction.testpersonapi.testcomplete.js
    'configuration', // object-structure.json
    'inspectionForm',
    'deployScript',
    'screen'
];

// The records the deployment formats cannot delete, which remove/remove-records.js deletes instead.
const LEFTOVER_QUERIES = [
    ['INSPECTIONFORM', 'name', FORM_NAME],
    ['MAXAPPS', 'app', APP],
    ['MAXPRESENTATION', 'app', APP],
    ['SIGOPTION', 'app', APP],
    ['MAXMENU', 'moduleapp', APP],
    ['MAXLABELS', 'app', APP],
    ['APPLICATIONAUTH', 'app', APP],
    ['CTRLGROUP', 'app', APP],
    ['CONDITION', 'conditionnum', 'TESTCOND'],
    ['OBJECTAPPAUTH', 'context', APP_AUTH_CONTEXT],
    // Maximo Application Suite licensing records for the application, absent from Maximo 7.6.
    ['MAXLICAPPACCESS', 'appname', APP],
    ['MAXLICPRODAPPS', 'appname', APP]
];

/**
 * Every configuration record the manifest declares, by the type and label the extraction lists it
 * under. Domain labels carry the external domain type, so they are resolved against Maximo.
 */
async function configurationRecords(client) {
    const domainTypes = await client.synonymMap('DOMTYPE');

    return [
        ['properties', 'TESTcomplete.property'],
        ['messages', 'TESTCOMPLETE:TESTMESSAGE'],
        ['loggers', 'testcomplete'],
        ['domains', 'TESTABCTYPE (' + domainTypes.ALN + ')'],
        ['domains', 'TESTNUMDOM (' + domainTypes.NUMERIC + ')'],
        ['domains', 'TESTRANGEDOM (' + domainTypes.NUMRANGE + ')'],
        ['domains', 'TESTTABLEDOM (' + domainTypes.MAXTABLE + ')'],
        ['domains', 'TESTXOVERDOM (' + domainTypes.CROSSOVER + ')'],
        ['actions', 'TESTSETPRIORITY'],
        ['crontasks', 'TESTNOTFCLEANUP'],
        ['escalations', 'TESTREPORTLONG'],
        ['queries', 'AUTOSCRIPT: TESTCOMPLETE'],
        ['integrationobjects', 'TESTPERSONAPI']
    ];
}

function stepName(step) {
    return step.path ? path.relative(COMPLETE_DIR, step.path) : step.kind;
}

function failIfError(response, what) {
    if (!response || response.status === 'error') {
        throw new Error(what + ' reported ' + JSON.stringify(response));
    }
}

/*
 * The handlers for a plan, each announcing its step when the run is verbose. The server-side
 * progress a step streams is printed by the harness beneath that line.
 */
function handlers(client, warnings, steps) {
    const kindHandlers = stepHandlers(client, warnings);
    const logged = {};

    Object.keys(kindHandlers).forEach((kind) => {
        logged[kind] = async (step) => {
            client.log('[' + (steps.indexOf(step) + 1) + '/' + steps.length + '] ' + kind + (step.path ? ' ' + stepName(step) : ''));
            const started = Date.now();
            try {
                const result = await kindHandlers[kind](step);
                client.log('  done in ' + (Date.now() - started) + 'ms');
                return result;
            } catch (error) {
                client.log('  failed after ' + (Date.now() - started) + 'ms: ' + error.message);
                throw error;
            }
        };
    });

    return logged;
}

function stepHandlers(client, warnings) {
    return {
        configuration: async (step) => {
            const result = await client.deployConfig(JSON.parse(fs.readFileSync(step.path, 'utf8')));
            result.warnings.forEach((warning) => warnings.push(path.basename(step.path) + ': ' + warning));
            return true;
        },
        databaseConfiguration: async () => {
            await client.applyDatabaseConfiguration();
            return true;
        },
        automationScript: async (step) => {
            failIfError(await client.deployScriptSource(fs.readFileSync(step.path, 'utf8'), false), 'Deploying ' + path.basename(step.path));
            return true;
        },
        deployScript: async (step) => {
            const response = await client.runDeployScript(fs.readFileSync(step.path, 'utf8'), false);
            assertEquals(response && response.status, 'success', 'Running ' + path.basename(step.path) + ' reported ' + JSON.stringify(response));
            return true;
        },
        inspectionForm: async (step) => {
            failIfError(await client.deployForm(JSON.parse(fs.readFileSync(step.path, 'utf8'))), 'Deploying ' + path.basename(step.path));
            return true;
        },
        screen: async (step) => {
            failIfError(await client.deployScreen(fs.readFileSync(step.path, 'utf8')), 'Deploying ' + path.basename(step.path));
            return true;
        },
        report: async (step) => {
            throw new Error('The complete test does not deploy BIRT reports, but the manifest declares ' + step.path + '.');
        }
    };
}

function plan(manifestPath) {
    const planned = planManifest(manifestPath);
    assertEquals(planned.errors.length, 0, 'Planning ' + path.basename(manifestPath) + ' reported ' + JSON.stringify(planned.errors.map((error) => error.message)));
    assertEquals(planned.deprecations.length, 0, path.basename(manifestPath) + ' entries without a kind');
    assertEquals(planned.disabled.length, 0, path.basename(manifestPath) + ' disabled entries');
    return planned;
}

/*
 * The records nothing can extract, counted inside Maximo by a one-off deploy script. A deploy script
 * cannot return a value, so the script reports what it found by failing with it.
 */
async function leftoverRecords(client) {
    const source = [
        'var MXServer = Java.type("psdi.server.MXServer");',
        'var SqlFormat = Java.type("psdi.mbo.SqlFormat");',
        'var queries = ' + JSON.stringify(LEFTOVER_QUERIES) + ';',
        'var found = [];',
        'queries.forEach(function (query) {',
        '    if (!MXServer.getMXServer().getMaximoDD().getMboSetInfo(query[0])) {',
        '        return;',
        '    }',
        '    var set = MXServer.getMXServer().getMboSet(query[0], MXServer.getMXServer().getSystemUserInfo());',
        '    try {',
        '        var sqlf = new SqlFormat(query[1] + " = :1");',
        '        sqlf.setObject(1, query[0], query[1].toUpperCase(), query[2]);',
        '        set.setWhere(sqlf.format());',
        '        var count = set.count();',
        '        if (count > 0) {',
        '            found.push(query[0] + " where " + query[1] + " = " + query[2] + ": " + count);',
        '        }',
        '    } finally {',
        '        set.close();',
        '    }',
        '});',
        'if (found.length > 0) {',
        '    throw new Error("LEFTOVERS[" + found.join("; ") + "]");',
        '}',
        'var scriptConfig = { autoscript: "TEST.COMPLETE.VERIFY", description: "Complete manifest test: count leftover records", active: true };'
    ].join('\n');

    const response = await client.runDeployScript(source, false);

    if (response && response.status === 'success') {
        return [];
    }

    const match = /LEFTOVERS\[(.*)\]/.exec((response && response.message) || '');
    if (!match) {
        throw new Error('Counting the leftover records failed: ' + JSON.stringify(response));
    }

    return match[1].split('; ');
}

/** Every record the manifest creates that is still in Maximo, as a list of descriptions. */
async function remainingRecords(client) {
    const remaining = [];

    for (const [type, label] of await configurationRecords(client)) {
        if (await client.extract(type, label)) {
            remaining.push(type + ' "' + label + '"');
        }
    }

    const object = await client.extractObjectCfg(OBJECT_NAME);
    if (object) {
        remaining.push('object ' + OBJECT_NAME + ' (changed = ' + object.changed + ')');
    }

    for (const name of [SCRIPT_NAME, ACTION_SCRIPT_NAME].concat(DEPLOY_SCRIPTS)) {
        if (await client.findScript(name)) {
            remaining.push('automation script ' + name);
        }
    }

    return remaining.concat(await leftoverRecords(client));
}

async function verifyDeployment(client) {
    for (const [type, label] of await configurationRecords(client)) {
        assertNotNull(await client.extract(type, label), 'The manifest did not deploy ' + type + ' "' + label + '"');
    }

    // Applied by the database configuration step, rather than only declared.
    const object = await client.extractObjectCfg(OBJECT_NAME);
    assertNotNull(object, 'The manifest did not deploy the object ' + OBJECT_NAME);
    assertEquals(object.changed, 'N', 'Database configuration state of ' + OBJECT_NAME);

    const script = await client.client.request({
        url: 'os/mxapiautoscript',
        method: 'GET',
        params: { lean: 'true', 'oslc.where': 'autoscript="' + SCRIPT_NAME + '"', 'oslc.select': 'autoscript,scriptlaunchpoint{launchpointname,objectname},autoscriptvars{varname}' }
    });
    const deployedScript = ((script.data && script.data.member) || [])[0];
    assertNotNull(deployedScript, 'The manifest did not deploy the script ' + SCRIPT_NAME);
    assertEquals((deployedScript.scriptlaunchpoint || []).length, 1, 'Launch points of ' + SCRIPT_NAME);
    assertEquals(String(deployedScript.scriptlaunchpoint[0].objectname).toUpperCase(), OBJECT_NAME, 'Launch point object of ' + SCRIPT_NAME);
    assertEquals((deployedScript.autoscriptvars || []).length, 1, 'Variables of ' + SCRIPT_NAME);

    assertNotNull(await client.findScript(ACTION_SCRIPT_NAME), 'The manifest did not deploy the script ' + ACTION_SCRIPT_NAME);

    const structure = await client.extract('integrationobjects', 'TESTPERSONAPI');
    assertEquals((structure.osOSLCAction || []).length, 1, 'OSLC actions of TESTPERSONAPI');
    const appAuth = (structure.maxIntObjDetail[0].objectAppAuth || []).filter((auth) => auth.context === APP_AUTH_CONTEXT);
    assertEquals(appAuth.length, 1, 'Object application authorization of TESTPERSONAPI for ' + APP_AUTH_CONTEXT);

    const forms = (await client.listForms()).filter((form) => form.name === FORM_NAME);
    assertEquals(forms.length, 1, 'Inspection forms named ' + FORM_NAME);

    const screen = await client.extractScreen(APP);
    assertNotNull(screen, 'The manifest did not deploy the ' + APP + ' screen');
    assertEquals(screen.indexOf('label="TEST Action"') >= 0, true, 'The deployed ' + APP + ' screen is not testaction.xml');
    assertEquals(screen.indexOf('optionname="TESTMEMO"') >= 0, true, 'The ' + APP + ' screen conditional UI metadata was not deployed');

    for (const name of DEPLOY_SCRIPTS) {
        assertEquals(await client.findScript(name), null, 'The deploy script ' + name + ' was left installed in Maximo');
    }
}

/*
 * Runs every removal step even when an earlier one fails, so that a deployment that stopped half way
 * is still cleaned up as far as possible. Returns the steps that failed.
 */
async function remove(client, steps) {
    const failures = [];
    const removal = handlers(client, [], steps);

    for (const step of steps) {
        const result = await executePlan([step], removal);
        if (result.failure) {
            failures.push(stepName(step) + ': ' + result.failure.error.message);
        }
    }

    return failures;
}

module.exports = {
    name: 'complete',
    run: async (client) => {
        const release = plan(RELEASE_MANIFEST);
        const removal = plan(REMOVE_MANIFEST);

        assertEquals(release.steps.map((step) => step.kind).join(','), RELEASE_KINDS.join(','), 'Planned release step kinds');
        assertEquals(
            release.steps.some((step) => step.kind === 'report'),
            false,
            'BIRT report extraction does not work on existing environments, so the complete test does not deploy one'
        );

        // The case creates its own state, so anything already there belongs to someone else.
        client.log('Checking that no records of the complete test exist.');
        const existing = await remainingRecords(client);
        assertEquals(existing.length, 0, 'Records of the complete test already exist, run test/complete/remove.manifest.json first: ' + existing.join(', '));

        const warnings = [];
        let deploymentError = null;

        try {
            client.log('Deploying ' + path.relative(COMPLETE_DIR, RELEASE_MANIFEST) + ', ' + release.steps.length + ' steps.');
            const result = await executePlan(release.steps, handlers(client, warnings, release.steps));

            if (result.failure) {
                throw new Error('The release manifest failed at ' + stepName(result.failure.step) + ': ' + result.failure.error.message);
            }
            assertEquals(result.completed, release.steps.length, 'Completed release step count');
            assertEquals(warnings.length, 0, 'The release manifest reported warnings: ' + warnings.join('; '));

            client.log('Verifying that every record exists.');
            await verifyDeployment(client);
        } catch (error) {
            deploymentError = error;
        }

        // Removal runs, and is verified, whether or not the deployment succeeded.
        const problems = deploymentError ? [deploymentError.message] : [];
        client.log('Removing with ' + path.relative(COMPLETE_DIR, REMOVE_MANIFEST) + ', ' + removal.steps.length + ' steps.');
        const removalFailures = await remove(client, removal.steps);
        if (removalFailures.length > 0) {
            problems.push('The remove manifest failed: ' + removalFailures.join('; '));
        }

        client.log('Checking that every record is gone.');
        const remaining = await remainingRecords(client);
        if (remaining.length > 0) {
            problems.push('Records left behind after the remove manifest: ' + remaining.join(', '));
        }

        if (problems.length > 0) {
            throw new Error(problems.join('\n    '));
        }
    }
};
