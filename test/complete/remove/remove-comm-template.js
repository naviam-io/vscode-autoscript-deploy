/* global Java */
/* eslint-disable no-unused-vars */
/*
 * Removes the communication template after the escalation that refers to it.
 *
 * Runs once through the "deployScript" manifest kind and is removed again afterwards.
 */
var MXServer = Java.type('psdi.server.MXServer');
var MboConstants = Java.type('psdi.mbo.MboConstants');
var SqlFormat = Java.type('psdi.mbo.SqlFormat');

main();

function main() {
    var set = MXServer.getMXServer().getMboSet('COMMTEMPLATE', MXServer.getMXServer().getSystemUserInfo());
    try {
        var sqlf = new SqlFormat('templateid = :1');
        sqlf.setObject(1, 'COMMTEMPLATE', 'TEMPLATEID', 'TESTCOMPLETE');
        set.setWhere(sqlf.format());
        if (!set.isEmpty()) {
            set.deleteAll(MboConstants.NOACCESSCHECK);
            set.save();
        }
    } finally {
        set.close();
    }
}

var scriptConfig = {
    autoscript: 'TEST.COMPLETE.REMOVECOMMTEMPLATE',
    description: 'Complete manifest test: remove the escalation communication template',
    version: '1.0.0',
    active: true,
    logLevel: 'ERROR'
};
