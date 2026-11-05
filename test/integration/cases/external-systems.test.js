/* eslint-disable no-undef */
/*
 * External systems: the round trip of a system with an embedded publish channel and enterprise service, a
 * referenced predefined channel and a control of each type with overrides, the extracted system redeployed
 * unchanged, the refusals of a shared embedded channel and of values that do not fit the control's type,
 * _delete on an embedded record of a system that stays, and the deletion of a system with its embedded records.
 */
import { assertEquals } from '../harness.js';
import { assertSubset, loadFixture } from '../round-trip.js';

const NAME = 'NVTEST_XS';
const OTHER = 'NVTEST_XS2';
const CHANNEL = 'NVTEST_XS_PC';
const SERVICE = 'NVTEST_XS_ES';
const SCRIPT_NAME = 'NVTEST.XS.SETUP';
const CONTROLS = [
    ['NVTEST_XS_VAL', 'VALUE'],
    ['NVTEST_XS_BOOL', 'BOOLEAN'],
    ['NVTEST_XS_LIST', 'LIST'],
    ['NVTEST_XS_XREF', 'CROSSREFERENCE']
];

function script(description, body) {
    return [
        'var scriptConfig = { autoscript: "' + SCRIPT_NAME + '", description: "' + description + '", active: true };',
        "var MXServer = Java.type('psdi.server.MXServer');",
        'var userInfo = MXServer.getMXServer().getSystemUserInfo();'
    ]
        .concat(body)
        .join('\n');
}

async function runScript(client, description, body) {
    const response = await client.runDeployScript(script(description, body.concat(["throw new Error('NVTEST_DONE');"])));
    const message = (response && response.message) || '';
    if (!/NVTEST_DONE/.test(message)) {
        throw new Error(description + ' failed: ' + JSON.stringify(response));
    }
    return message;
}

/** Creates a control of each type, as only some versions ship one, and returns an organization and site for the overrides. */
async function createControls(client) {
    const response = await client.runDeployScript(
        script('External system test controls', [
            "var set = MXServer.getMXServer().getMboSet('MAXIFACECONTROL', userInfo);",
            'var translator = MXServer.getMXServer().getMaximoDD().getTranslator();',
            'try {',
            JSON.stringify(CONTROLS) + '.forEach(function (definition) {',
            '    var control = set.add();',
            "    control.setValue('IFACECONTROL', definition[0]);",
            "    control.setValue('DESCRIPTION', 'External system test');",
            "    control.setValue('CONTROLTYPE', translator.toExternalDefaultValue('CONTROLTYPE', definition[1], control));",
            '});',
            '    set.save();',
            '} finally {',
            '    set.close();',
            '}',
            "var sites = MXServer.getMXServer().getMboSet('SITE', userInfo);",
            "sites.setOrderBy('siteid');",
            'var site = sites.moveFirst();',
            "var location = 'NVTEST_SITE[' + site.getString('ORGID') + '|' + site.getString('SITEID') + ']';",
            'sites.close();',
            'throw new Error(location);'
        ])
    );
    const message = (response && response.message) || '';
    const match = /NVTEST_SITE\[([^|]+)\|([^\]]+)\]/.exec(message);
    if (!match) {
        throw new Error('External system test controls failed: ' + JSON.stringify(response));
    }
    return { org: match[1], site: match[2] };
}

function deleteControls(client) {
    return runScript(client, 'External system test controls cleanup', [
        "var set = MXServer.getMXServer().getMboSet('MAXIFACECONTROL', userInfo);",
        'try {',
        "    set.setWhere(\"ifacecontrol like 'NVTEST\\\\_XS\\\\_%' escape '\\\\'\");",
        '    set.deleteAll();',
        '    set.save();',
        '} finally {',
        '    set.close();',
        '}'
    ]);
}

async function cleanup(client) {
    await client.deployConfig({ externalSystems: [OTHER, NAME].map((extSysName) => ({ _delete: true, extSysName })) });
    await client.deployConfig({ publishChannels: [{ _delete: true, ifaceName: CHANNEL }] });
    await client.deployConfig({ enterpriseServices: [{ _delete: true, ifaceName: SERVICE }] });
    await deleteControls(client);
}

async function expectError(client, payload, pattern, describe) {
    try {
        await client.deployConfig(payload);
    } catch (error) {
        if (!pattern.test(error.message)) {
            throw new Error(describe + ': unexpected error ' + error.message);
        }
        return;
    }
    throw new Error(describe + ': the deploy did not fail');
}

function fixtureFor(location) {
    const text = JSON.stringify(loadFixture('external-systems'))
        .replace(/\{ORG\}/g, location.org)
        .replace(/\{SITE\}/g, location.site);
    return JSON.parse(text);
}

function controlNamed(system, control) {
    return (system.integrationControls || []).find((entry) => entry.control === control);
}

export default {
    name: 'external-systems',
    run: async (client) => {
        await cleanup(client);
        assertEquals(await client.extract('externalsystems', NAME), null, 'External system left over from an earlier run');

        try {
            const location = await createControls(client);
            const fixture = fixtureFor(location);
            const system = fixture.externalSystems[0];

            const deployed = await client.deployConfig(fixture);
            assertEquals(deployed.warnings.length, 0, 'The system deploys without warnings');
            let extracted = await client.extract('externalsystems', NAME);
            assertSubset(system, extracted, [], '', {});
            assertEquals(
                extracted.publishChannels.find((link) => link.ifaceName === 'MXASSETInterface').publishChannel,
                undefined,
                'A predefined channel is referenced'
            );
            assertEquals((await client.extract('publishchannels', CHANNEL)).description, 'Embedded channel', 'The embedded channel is created');
            assertEquals((await client.extract('enterpriseservices', SERVICE)).description, 'Embedded service', 'The embedded service is created');

            // The extracted system deploys back unchanged.
            const redeployed = await client.deployConfig({ externalSystems: [extracted] });
            assertEquals(redeployed.warnings.length, 0, 'The extracted system deploys without warnings');
            assertEquals(JSON.stringify(await client.extract('externalsystems', NAME)), JSON.stringify(extracted), 'The redeployed system is unchanged');

            // An update drops a link and a control, and changes the embedded channel.
            const updated = JSON.parse(JSON.stringify(system));
            updated.publishChannels[0].publishChannel.description = 'Embedded channel 2';
            updated.publishChannels.pop();
            updated.integrationControls = updated.integrationControls.filter((control) => control.control !== 'NVTEST_XS_XREF');
            await client.deployConfig({ externalSystems: [updated] });
            extracted = await client.extract('externalsystems', NAME);
            assertEquals(extracted.publishChannels.length, 1, 'The dropped link is deleted');
            assertEquals(controlNamed(extracted, 'NVTEST_XS_XREF'), undefined, 'The dropped control is deleted');
            assertEquals(extracted.publishChannels[0].publishChannel.description, 'Embedded channel 2', 'The embedded channel is updated');

            // A control that does not exist is refused before the system is touched.
            const unknown = JSON.parse(JSON.stringify(updated));
            unknown.integrationControls.push({ control: 'NVTEST_XS_NONE', value: 'A' });
            await expectError(client, { externalSystems: [unknown] }, /integration control NVTEST_XS_NONE: /, 'Unknown control');
            assertEquals(JSON.stringify(await client.extract('externalsystems', NAME)), JSON.stringify(extracted), 'The refused system is kept');

            // _delete on an embedded service of a system that stays deletes the service and drops its link.
            const dropped = JSON.parse(JSON.stringify(updated));
            dropped.enterpriseServices[0].enterpriseService = { _delete: true, ifaceName: SERVICE };
            await client.deployConfig({ externalSystems: [dropped] });
            extracted = await client.extract('externalsystems', NAME);
            assertEquals(extracted.enterpriseServices, undefined, 'The deleted service is unlinked');
            assertEquals(await client.extract('enterpriseservices', SERVICE), null, 'The service marked _delete is deleted');
            await client.deployConfig({ externalSystems: [updated] });
            extracted = await client.extract('externalsystems', NAME);
            assertEquals(extracted.enterpriseServices[0].enterpriseService.ifaceName, SERVICE, 'The service is embedded again');

            // An embedded channel another system links is not recreated, and the system is kept.
            await client.deployConfig({ externalSystems: [{ extSysName: OTHER, endPointName: 'MXXMLFILE', publishChannels: [{ ifaceName: CHANNEL }] }] });
            extracted = await client.extract('externalsystems', NAME);
            assertEquals(extracted.publishChannels[0].ifaceName, CHANNEL, 'A channel another system links is extracted by reference');
            await expectError(
                client,
                { externalSystems: [updated] },
                new RegExp('embedded publish channel ' + CHANNEL + ' cannot be deleted or recreated while the external system ' + OTHER + ' uses it'),
                'Shared embedded channel'
            );
            assertEquals(JSON.stringify(await client.extract('externalsystems', NAME)), JSON.stringify(extracted), 'The refused system is kept');
            await client.deployConfig({ externalSystems: [{ _delete: true, extSysName: OTHER }] });

            // Deleting the system deletes the embedded records marked _delete with it.
            await client.deployConfig({
                externalSystems: [
                    {
                        _delete: true,
                        extSysName: NAME,
                        publishChannels: [{ publishChannel: { _delete: true, ifaceName: CHANNEL } }],
                        enterpriseServices: [{ enterpriseService: { _delete: true, ifaceName: SERVICE } }]
                    }
                ]
            });
            assertEquals(await client.extract('externalsystems', NAME), null, 'The system is deleted');
            assertEquals(await client.extract('publishchannels', CHANNEL), null, 'The embedded channel is deleted with the system');
            assertEquals(await client.extract('enterpriseservices', SERVICE), null, 'The embedded service is deleted with the system');
        } finally {
            await cleanup(client);
        }
        assertEquals(await client.extract('externalsystems', NAME), null, 'External system after cleanup');
        assertEquals(await client.extract('publishchannels', CHANNEL), null, 'Publish channel after cleanup');
    }
};
