/* eslint-disable no-undef */
/*
 * Proves that _retain preserves the customer's external system values across a redeployment, at the
 * system, link and integration control levels, that a retained collection keeps the controls the
 * customer added, and that the values not retained follow the product.
 */
import { assertEquals } from '../harness.js';
import { loadFixture } from '../round-trip.js';

const NAME = 'NVTEST_XSR';
const DELETE = { externalSystems: [{ _delete: true, extSysName: NAME }] };
const CONTROLS = [
    ['NVTEST_XSR_VAL', 'VALUE'],
    ['NVTEST_XSR_BOOL', 'BOOLEAN']
];

function script(description, body) {
    return [
        'var scriptConfig = { autoscript: "NVTEST.XSR.SETUP", description: "' + description + '", active: true };',
        "var MXServer = Java.type('psdi.server.MXServer');",
        'var userInfo = MXServer.getMXServer().getSystemUserInfo();'
    ]
        .concat(body)
        .join('\n');
}

/** Creates the controls, as only some versions ship a VALUE and a BOOLEAN control, and returns an organization for the override. */
async function createControls(client) {
    const response = await client.runDeployScript(
        script('External system retained values test controls', [
            "var set = MXServer.getMXServer().getMboSet('MAXIFACECONTROL', userInfo);",
            'var translator = MXServer.getMXServer().getMaximoDD().getTranslator();',
            'try {',
            JSON.stringify(CONTROLS) + '.forEach(function (definition) {',
            '    var control = set.add();',
            "    control.setValue('IFACECONTROL', definition[0]);",
            "    control.setValue('DESCRIPTION', 'External system retained values test');",
            "    control.setValue('CONTROLTYPE', translator.toExternalDefaultValue('CONTROLTYPE', definition[1], control));",
            '});',
            '    set.save();',
            '} finally {',
            '    set.close();',
            '}',
            "var orgs = MXServer.getMXServer().getMboSet('ORGANIZATION', userInfo);",
            "orgs.setOrderBy('orgid');",
            "var orgId = orgs.moveFirst().getString('ORGID');",
            'orgs.close();',
            "throw new Error('NVTEST_ORG[' + orgId + ']');"
        ])
    );
    const match = /NVTEST_ORG\[([^\]]+)\]/.exec((response && response.message) || '');
    if (!match) {
        throw new Error('External system retained values test controls failed: ' + JSON.stringify(response));
    }
    return match[1];
}

async function deleteControls(client) {
    const response = await client.runDeployScript(
        script('External system retained values test controls cleanup', [
            "var set = MXServer.getMXServer().getMboSet('MAXIFACECONTROL', userInfo);",
            'try {',
            "    set.setWhere(\"ifacecontrol like 'NVTEST\\\\_XSR\\\\_%' escape '\\\\'\");",
            '    set.deleteAll();',
            '    set.save();',
            '} finally {',
            '    set.close();',
            '}',
            "throw new Error('NVTEST_DONE');"
        ])
    );
    if (!/NVTEST_DONE/.test((response && response.message) || '')) {
        throw new Error('External system retained values test controls cleanup failed: ' + JSON.stringify(response));
    }
}

function controlNamed(system, control) {
    return (system.integrationControls || []).find((entry) => entry.control === control) || {};
}

export default {
    name: 'external-system-retained-values',
    run: async (client) => {
        await client.deployConfig(DELETE);
        await deleteControls(client);
        assertEquals(await client.extract('externalsystems', NAME), null, 'External system left over from an earlier run');

        try {
            const orgId = await createControls(client);
            const fixture = JSON.parse(JSON.stringify(loadFixture('external-system-retained-values')).replace(/\{ORG\}/g, orgId));
            await client.deployConfig(fixture.productV1);
            await client.deployConfig(fixture.customerEdit);
            await client.deployConfig(fixture.productV2);

            const upgraded = await client.extract('externalsystems', NAME);
            const value = controlNamed(upgraded, 'NVTEST_XSR_VAL');
            assertEquals(upgraded.description, 'Customer description', 'Redeploy keeps the customer description');
            assertEquals(upgraded.enabled, true, 'Redeploy keeps the customer enabled flag');
            assertEquals(upgraded.publishChannels[0].enabled, true, 'Redeploy keeps the customer link enabled flag');
            assertEquals(value.value, 'CUSTOMER', 'Redeploy keeps the customer control value');
            assertEquals(value.overrides[0].value, 'RELEASE2', 'The override value is not retained, so it follows the product');
            assertEquals(controlNamed(upgraded, 'NVTEST_XSR_BOOL').isTrue, true, 'Redeploy keeps the control the customer added');
        } finally {
            await client.deployConfig(DELETE);
            await deleteControls(client);
        }

        assertEquals(await client.extract('externalsystems', NAME), null, 'Extract of external system "' + NAME + '" after delete');
    }
};
