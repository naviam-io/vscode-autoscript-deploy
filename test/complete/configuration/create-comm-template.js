/* global Java */
/* eslint-disable no-unused-vars */
/*
 * Creates the communication template the escalation notification uses. Communication templates
 * have no deployment format.
 *
 * Runs once through the "deployScript" manifest kind and is removed again afterwards.
 */
var MXServer = Java.type('psdi.server.MXServer');
var MboConstants = Java.type('psdi.mbo.MboConstants');
var SqlFormat = Java.type('psdi.mbo.SqlFormat');

var TEMPLATE = 'TESTCOMPLETE';

main();

function main() {
    var set = MXServer.getMXServer().getMboSet('COMMTEMPLATE', MXServer.getMXServer().getSystemUserInfo());
    try {
        var sqlf = new SqlFormat('templateid = :1');
        sqlf.setObject(1, 'COMMTEMPLATE', 'TEMPLATEID', TEMPLATE);
        set.setWhere(sqlf.format());
        if (!set.isEmpty()) {
            return;
        }

        var template = set.add();
        template.setValue('TEMPLATEID', TEMPLATE);
        template.setValue('DESCRIPTION', 'Complete manifest test template');
        template.setValue('OBJECTNAME', 'REPORTJOB');
        template.setValue('SENDFROM', 'maximo@example.com', MboConstants.NOVALIDATION);
        template.setValue('SUBJECT', 'Complete manifest test');
        template.setValue('MESSAGE', 'Complete manifest test');
        template.setValue(
            'STATUS',
            MXServer.getMXServer().getMaximoDD().getTranslator().toExternalDefaultValue('COMMTMPLTSTATUS', 'ACTIVE', template),
            MboConstants.NOACCESSCHECK
        );
        set.save();
    } finally {
        set.close();
    }
}

var scriptConfig = {
    autoscript: 'TEST.COMPLETE.COMMTEMPLATE',
    description: 'Complete manifest test: create the escalation communication template',
    version: '1.0.0',
    active: true,
    logLevel: 'ERROR'
};
