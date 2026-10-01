/* global Java */
/* eslint-disable no-unused-vars */
/*
 * Removes what the complete manifest test created that the deployment formats cannot delete: the
 * inspection form, the TESTACTION application with its conditional UI records, and the object
 * application authorization the object structure added. Every deletion is idempotent, so the
 * removal manifest can be run again after a partial deployment or a partial removal.
 *
 * Runs once through the "deployScript" manifest kind and is removed again afterwards.
 */
var MXServer = Java.type('psdi.server.MXServer');
var SqlFormat = Java.type('psdi.mbo.SqlFormat');

var APP = 'TESTACTION';

main();

function main() {
    deleteWhere('INSPECTIONFORM', 'name', 'TEST Complete Inspection');

    // Conditional UI declared by the testaction.xml metadata.
    deleteWhere('CTRLGROUP', 'app', APP);
    deleteWhere('CONDITION', 'conditionnum', 'TESTCOND');

    // The application, children first: deleting MAXAPPS does not cascade, and the menus cannot be
    // deleted once the application they belong to has gone.
    deleteWhere('MAXLABELS', 'app', APP);
    deleteWhere('APPLICATIONAUTH', 'app', APP);
    deleteWhere('MAXMENU', 'moduleapp', APP);
    deleteWhere('SIGOPTION', 'app', APP);
    deleteWhere('MAXPRESENTATION', 'app', APP);
    deleteWhere('MAXAPPS', 'app', APP);

    // Maximo Application Suite registers a duplicated application for licensing, and refuses to
    // create an application of the same name again while those records remain. Maximo 7.6 has
    // neither object.
    deleteWhere('MAXLICAPPACCESS', 'appname', APP, true);
    deleteWhere('MAXLICPRODAPPS', 'appname', APP, true);

    // OBJECTAPPAUTH records are shared, so deleting the object structure deliberately leaves them.
    deleteWhere('OBJECTAPPAUTH', 'context', '/testcomplete');
}

function deleteWhere(objectName, attribute, value, optional) {
    if (optional && !MXServer.getMXServer().getMaximoDD().getMboSetInfo(objectName)) {
        return;
    }

    var set = MXServer.getMXServer().getMboSet(objectName, MXServer.getMXServer().getSystemUserInfo());
    try {
        var sqlf = new SqlFormat(attribute + ' = :1');
        sqlf.setObject(1, objectName, attribute.toUpperCase(), value);
        set.setWhere(sqlf.format());

        if (!set.isEmpty()) {
            set.deleteAll();
            set.save();
        }
    } finally {
        set.close();
    }
}

var scriptConfig = {
    autoscript: 'TEST.COMPLETE.REMOVE',
    description: 'Complete manifest test: remove the records the deployment formats cannot delete',
    version: '1.0.0',
    active: true,
    logLevel: 'ERROR'
};
