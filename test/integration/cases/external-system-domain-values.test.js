/* eslint-disable no-undef */
/*
 * External systems: list and cross-reference control values on a synonym domain, written in the !VALUE! or the translated form, are
 * stored and extracted translated, and a value Maximo refuses, outside the domain or for an unknown site, is refused before the
 * existing system is deleted.
 */
import { assertEquals } from '../harness.js';

const NAME = 'NVTEST_XSD';
const SCRIPT_NAME = 'NVTEST.XSD.SETUP';
const LIST = 'NVTEST_XSD_LIST';
const XREF = 'NVTEST_XSD_XREF';

function script(description, body) {
    return [
        'var scriptConfig = { autoscript: "' + SCRIPT_NAME + '", description: "' + description + '", active: true };',
        "var MXServer = Java.type('psdi.server.MXServer');",
        'var userInfo = MXServer.getMXServer().getSystemUserInfo();'
    ]
        .concat(body)
        .join('\n');
}

async function run(client, description, body) {
    const response = await client.runDeployScript(script(description, body));
    const match = /NVTEST_OUT\[(.*)\]NVTEST_END/s.exec((response && response.message) || '');
    if (!match) {
        throw new Error(description + ' failed: ' + JSON.stringify(response));
    }
    return JSON.parse(match[1]);
}

const out = (expression) => "throw new Error('NVTEST_OUT[' + JSON.stringify(" + expression + ") + ']NVTEST_END');";

function createControls(client) {
    return run(client, 'Domain test controls', [
        "var set = MXServer.getMXServer().getMboSet('MAXIFACECONTROL', userInfo);",
        'var translator = MXServer.getMXServer().getMaximoDD().getTranslator();',
        'var result = {};',
        'try {',
        "    [['" + LIST + "', 'LIST'], ['" + XREF + "', 'CROSSREFERENCE']].forEach(function (definition) {",
        '        var control = set.add();',
        "        control.setValue('IFACECONTROL', definition[0]);",
        "        control.setValue('DESCRIPTION', 'Domain test');",
        "        control.setValue('CONTROLTYPE', translator.toExternalDefaultValue('CONTROLTYPE', definition[1], control));",
        "        control.setValue('DOMAINID', 'WOSTATUS');",
        "        ['APPR', 'WAPPR', 'COMP'].forEach(function (v) { result[v] = String(translator.toExternalDefaultValue('WOSTATUS', v, control)); });",
        '    });',
        '    set.save();',
        '} finally {',
        '    set.close();',
        '}',
        "var sites = MXServer.getMXServer().getMboSet('SITE', userInfo);",
        "sites.setOrderBy('siteid');",
        "result.site = String(sites.moveFirst().getString('SITEID'));",
        'sites.close();',
        out('result')
    ]);
}

function storedValues(client) {
    return run(client, 'Domain test stored values', [
        'var result = {};',
        "[['MAXEXTLISTVAL', 'value'], ['MAXEXTXREFVAL', 'value || \\'>\\' || newvalue'], ['MAXLISTOVERVAL', 'value']].forEach(function (t) {",
        '    var set = MXServer.getMXServer().getMboSet(t[0], userInfo);',
        '    set.setWhere("extsysname = \'' + NAME + '\'");',
        "    set.setOrderBy('value');",
        '    var rows = [];',
        "    for (var m = set.moveFirst(); m; m = set.moveNext()) { rows.push(String(m.getString('VALUE')) + (t[0] === 'MAXEXTXREFVAL' ? '>' + m.getString('NEWVALUE') : '')); }",
        '    set.close();',
        '    result[t[0]] = rows;',
        '});',
        out('result')
    ]);
}

function deleteControls(client) {
    return run(client, 'Domain test cleanup', [
        "var set = MXServer.getMXServer().getMboSet('MAXIFACECONTROL', userInfo);",
        "set.setWhere(\"ifacecontrol like 'NVTEST\\\\_XSD\\\\_%' escape '\\\\'\");",
        'set.deleteAll();',
        'set.save();',
        'set.close();',
        "var scripts = MXServer.getMXServer().getMboSet('AUTOSCRIPT', userInfo);",
        'scripts.setWhere("autoscript = \'' + SCRIPT_NAME + '\'");',
        'scripts.deleteAll(2);',
        'scripts.save();',
        'scripts.close();',
        out('"cleaned"')
    ]);
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

function scratchSystems(client) {
    return run(client, 'Domain test scratch systems', [
        "var set = MXServer.getMXServer().getMboSet('MAXEXTSYSTEM', userInfo);",
        'set.setWhere("extsysname like \'NV1%\'");',
        'var count = set.count();',
        'set.close();',
        out('count')
    ]);
}

export default {
    name: 'external-system-domain-values',
    run: async (client) => {
        await client.deployConfig({ externalSystems: [{ _delete: true, extSysName: NAME }] });
        try {
            const t = await createControls(client);

            const system = {
                extSysName: NAME,
                endPointName: 'MXXMLFILE',
                integrationControls: [
                    {
                        control: LIST,
                        listValues: [{ value: '!APPR!' }, { value: t.WAPPR }],
                        overrides: [{ siteId: t.site, listValues: [{ value: '!COMP!' }] }]
                    },
                    { control: XREF, crossReferenceValues: [{ value: '!APPR!', newValue: 'X1' }] }
                ]
            };
            const deployed = await client.deployConfig({ externalSystems: [system] });
            assertEquals(deployed.warnings.length, 0, 'Deploys without warnings');

            const stored = await storedValues(client);
            assertEquals(
                JSON.stringify(stored.MAXEXTLISTVAL),
                JSON.stringify([t.APPR, t.WAPPR].sort()),
                '!APPR! and the translated WAPPR are stored translated'
            );
            assertEquals(JSON.stringify(stored.MAXEXTXREFVAL), JSON.stringify([t.APPR + '>X1']), 'The cross-reference value is stored translated');
            assertEquals(JSON.stringify(stored.MAXLISTOVERVAL), JSON.stringify([t.COMP]), 'The override list value is stored translated');

            const extracted = await client.extract('externalsystems', NAME);
            const redeployed = await client.deployConfig({ externalSystems: [extracted] });
            assertEquals(redeployed.warnings.length, 0, 'The extracted system redeploys without warnings');
            assertEquals(JSON.stringify(await client.extract('externalsystems', NAME)), JSON.stringify(extracted), 'The redeployed system is unchanged');

            const kept = JSON.stringify(extracted);
            const refused = [
                ['NOT_A_STATUS', /NVTEST_XSD_LIST: .*BMXAA4190E/, 'A value outside the domain'],
                ['!NOPE!', /NOPE is not an internal value of the WOSTATUS synonym domain/, 'An unknown internal value']
            ];
            if (t.APPR !== 'APPR') {
                // Only where the base language translates the domain is the internal value outside it.
                refused.push(['APPR', /NVTEST_XSD_LIST: .*BMXAA4190E/, 'An internal value without !']);
            }
            for (const [value, pattern, describe] of refused) {
                const payload = JSON.parse(JSON.stringify(system));
                payload.integrationControls[0].listValues = [{ value }];
                await expectError(client, { externalSystems: [payload] }, pattern, describe);
                assertEquals(JSON.stringify(await client.extract('externalsystems', NAME)), kept, describe + ': the system is kept');
            }
            const unknownSite = JSON.parse(JSON.stringify(system));
            unknownSite.integrationControls[0].overrides[0].siteId = 'NVNOSITE';
            await expectError(client, { externalSystems: [unknownSite] }, /NVTEST_XSD_LIST: .*NVNOSITE/, 'An unknown site');
            assertEquals(JSON.stringify(await client.extract('externalsystems', NAME)), kept, 'An unknown site: the system is kept');
            assertEquals(await scratchSystems(client), 0, 'The system the values are checked on is never saved');
        } finally {
            await client.deployConfig({ externalSystems: [{ _delete: true, extSysName: NAME }] });
            await deleteControls(client);
        }
    }
};
