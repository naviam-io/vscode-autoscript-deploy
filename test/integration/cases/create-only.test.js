/* eslint-disable no-undef */
/*
 * Deploys an automation script, an inspection form and a report create-only against a live Maximo:
 * the first deploy creates the item, a create-only redeploy of changed content leaves it unchanged,
 * and an ordinary redeploy updates it. A screen is only checked for the skip, on the ACTION
 * application, because creating and removing an application presentation is not safe to automate.
 */
import { assertEquals, assertNotNull } from '../harness.js';

const CREATE_ONLY = { createOnly: 'true' };
const SCRIPT_NAME = 'NVTEST.CREATEONLY.SCRIPT';
const FORM_NAME = 'NVTEST CREATE ONLY';
const REPORT_NAME = 'nvtest_create_only.rptdesign';
const REPORT_APP = 'ACTION';

function scriptSource(body) {
    return [
        'var scriptConfig = {',
        '    "autoscript": "' + SCRIPT_NAME + '",',
        '    "description": "Create-only integration test",',
        '    "status": "Active"',
        '};',
        body
    ].join('\n');
}

function form(instructions) {
    return { name: FORM_NAME, type: 'INSPECTION', instructions: instructions, audioguided: false, readconfirmation: false, reason: 'Create-only integration test', questions: [] };
}

function report(description) {
    return {
        reportName: REPORT_NAME,
        description: description,
        reportFolder: REPORT_APP,
        appName: REPORT_APP,
        toolbarLocation: 'NONE',
        toolbarIcon: null,
        toolbarSequence: null,
        noRequestPage: true,
        detail: false,
        useWhereWithParam: false,
        langCode: null,
        recordLimit: null,
        browserView: false,
        directPrint: false,
        printWithAttachments: false,
        browserViewLocation: 'NONE',
        directPrintLocation: 'NONE',
        printWithAttachmentsLocation: 'NONE',
        priority: null,
        scheduleOnly: false,
        displayOrder: null,
        paramColumns: null,
        design: '<?xml version="1.0" encoding="UTF-8"?>\n<report xmlns="http://www.eclipse.org/birt/2005/design" version="3.2.23" id="1"></report>',
        resources: null
    };
}

/* Deletes every record of an object matching a where clause, inside Maximo, through a one-off deploy script. */
async function deleteWhere(client, objectName, where) {
    const source = [
        'var scriptConfig = {',
        '    "autoscript": "NVTEST.CREATEONLY.CLEANUP",',
        '    "description": "Create-only test cleanup",',
        '    "status": "Active"',
        '};',
        'var MXServer = Java.type("psdi.server.MXServer");',
        'var set = MXServer.getMXServer().getMboSet(' + JSON.stringify(objectName) + ', MXServer.getMXServer().getSystemUserInfo());',
        'try {',
        '    set.setWhere(' + JSON.stringify(where) + ');',
        objectName === 'INSPECTIONFORM' ? '    set.deleteAll(Java.type("psdi.mbo.MboConstants").NOACCESSCHECK);' : '    set.deleteAll();',
        '    set.save();',
        '} finally {',
        '    set.close();',
        '}'
    ].join('\n');

    const response = await client.runDeployScript(source, false);
    if (!response || response.status !== 'success') {
        throw new Error('Cleaning up ' + objectName + ' failed: ' + JSON.stringify(response));
    }
}

async function cleanUp(client) {
    await client.deployScriptSource(['var scriptConfig = {', '    "autoscript": "' + SCRIPT_NAME + '",', '    "_delete": true', '};'].join('\n'));
    await deleteWhere(client, 'INSPECTIONFORM', "name = '" + FORM_NAME + "'");
    await deleteWhere(client, 'REPORT', "reportname = '" + REPORT_NAME + "' and appname = '" + REPORT_APP + "'");
}

async function findForm(client) {
    const found = (await client.listForms()).filter((entry) => entry.name === FORM_NAME);
    return found.length > 0 ? await client.extractForm(found[0].id) : null;
}

async function findReport(client) {
    const found = (await client.listReports()).filter((entry) => entry.reportName === REPORT_NAME && entry.app === REPORT_APP);
    return found.length > 0 ? found[0] : null;
}

export default {
    name: 'create-only',
    run: async (client) => {
        await cleanUp(client);

        try {
            // Automation script.
            assertEquals(
                (await client.deployScriptSource(scriptSource('service.log("first");'), false, CREATE_ONLY)).outcome,
                'created',
                'First create-only script deploy'
            );
            assertEquals(
                (await client.deployScriptSource(scriptSource('service.log("second");'), false, CREATE_ONLY)).outcome,
                'skipped',
                'Create-only redeploy of the script'
            );
            assertEquals(
                String((await client.findScript(SCRIPT_NAME)).source).indexOf('first') >= 0,
                true,
                'The create-only redeploy changed the script source'
            );
            assertEquals((await client.deployScriptSource(scriptSource('service.log("third");'))).outcome, 'updated', 'Ordinary redeploy of the script');
            assertEquals(String((await client.findScript(SCRIPT_NAME)).source).indexOf('third') >= 0, true, 'The ordinary redeploy did not update the script');

            // Inspection form.
            assertEquals((await client.deployForm(form('first'), CREATE_ONLY)).outcome, 'created', 'First create-only form deploy');
            assertEquals((await client.deployForm(form('second'), CREATE_ONLY)).outcome, 'skipped', 'Create-only redeploy of the form');
            assertEquals((await findForm(client)).instructions, 'first', 'The create-only redeploy changed the form');
            assertEquals((await client.deployForm(form('third'))).outcome, 'updated', 'Ordinary redeploy of the form');
            assertEquals((await findForm(client)).instructions, 'third', 'The ordinary redeploy did not update the form');

            // Report.
            assertEquals((await client.deployReport(report('first'), CREATE_ONLY)).outcome, 'created', 'First create-only report deploy');
            assertEquals((await client.deployReport(report('second'), CREATE_ONLY)).outcome, 'skipped', 'Create-only redeploy of the report');
            assertEquals((await findReport(client)).label, 'first', 'The create-only redeploy changed the report');
            assertEquals((await client.deployReport(report('third'))).outcome, 'updated', 'Ordinary redeploy of the report');
            assertEquals((await findReport(client)).label, 'third', 'The ordinary redeploy did not update the report');

            // Screen: an existing presentation is left exactly as it was.
            const before = await client.extractScreen('ACTION');
            assertNotNull(before, 'ACTION has no presentation');
            const changed = before.replace('<presentation ', '<presentation nvtestcreateonly="1" ');
            assertEquals((await client.deployScreen(changed, CREATE_ONLY)).outcome, 'skipped', 'Create-only deploy of an existing screen');
            assertEquals(await client.extractScreen('ACTION'), before, 'The create-only deploy changed the ACTION presentation');
        } finally {
            await cleanUp(client);
        }

        assertEquals(await client.findScript(SCRIPT_NAME), null, 'The script was not removed');
        assertEquals(await findForm(client), null, 'The inspection form was not removed');
        assertEquals(await findReport(client), null, 'The report was not removed');
    }
};
