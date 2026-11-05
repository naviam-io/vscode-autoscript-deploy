/* eslint-disable no-undef */
/*
 * Communication templates have no deployment format, so the cases that deploy escalation
 * notifications create and remove their own templates through a deploy script.
 */
import { assertEquals } from './harness.js';

function script(name, description, body) {
    return [
        'var scriptConfig = { autoscript: "' + name + '", description: "' + description + '", active: true };',
        'var MXServer = Java.type("psdi.server.MXServer");',
        'var MboConstants = Java.type("psdi.mbo.MboConstants");',
        'var SqlFormat = Java.type("psdi.mbo.SqlFormat");',
        'var userInfo = MXServer.getMXServer().getSystemUserInfo();'
    ]
        .concat(body)
        .join('\n');
}

async function run(client, source, what) {
    const response = await client.runDeployScript(source);
    assertEquals(response && response.status, 'success', what + ' reported ' + JSON.stringify(response));
}

async function createCommTemplates(client, objectName, templateIds) {
    await deleteCommTemplates(client, templateIds);
    const source = script('NVTEST.COMMTEMPLATE.CREATE', 'Create integration test communication templates', [
        'var templateIds = ' + JSON.stringify(templateIds) + ';',
        'var set = MXServer.getMXServer().getMboSet("COMMTEMPLATE", userInfo);',
        'try {',
        '    templateIds.forEach(function (templateId) {',
        '        var template = set.add();',
        '        template.setValue("TEMPLATEID", templateId);',
        '        template.setValue("DESCRIPTION", "Integration test template");',
        '        template.setValue("OBJECTNAME", "' + objectName + '");',
        '        template.setValue("SENDFROM", "maximo@example.com", MboConstants.NOVALIDATION);',
        '        template.setValue("SUBJECT", "Integration test");',
        '        template.setValue("MESSAGE", "Integration test");',
        '        template.setValue("STATUS", MXServer.getMXServer().getMaximoDD().getTranslator().toExternalDefaultValue("COMMTMPLTSTATUS", "ACTIVE", template), MboConstants.NOACCESSCHECK);',
        '    });',
        '    set.save();',
        '} finally {',
        '    set.close();',
        '}'
    ]);

    await run(client, source, 'Creating communication templates');
}

async function deleteCommTemplates(client, templateIds) {
    const source = script('NVTEST.COMMTEMPLATE.DELETE', 'Delete integration test communication templates', [
        'var templateIds = ' + JSON.stringify(templateIds) + ';',
        'templateIds.forEach(function (templateId) {',
        '    var set = MXServer.getMXServer().getMboSet("COMMTEMPLATE", userInfo);',
        '    try {',
        '        var sqlf = new SqlFormat("templateid = :1");',
        '        sqlf.setObject(1, "COMMTEMPLATE", "TEMPLATEID", templateId);',
        '        set.setWhere(sqlf.format());',
        '        if (!set.isEmpty()) {',
        '            set.deleteAll(MboConstants.NOACCESSCHECK);',
        '            set.save();',
        '        }',
        '        set.reset();',
        '        if (!set.isEmpty()) {',
        '            throw new Error("Communication template " + templateId + " was not deleted");',
        '        }',
        '    } finally {',
        '        set.close();',
        '    }',
        '});'
    ]);

    await run(client, source, 'Deleting communication templates');
}

export { createCommTemplates, deleteCommTemplates };
