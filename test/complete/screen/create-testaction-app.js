/* global Java */
/* eslint-disable no-unused-vars */
/*
 * Creates the TESTACTION application the testaction.xml screen is deployed to.
 *
 * A screen can only be deployed to an application that exists, and the complete manifest test must
 * not overwrite an application Maximo ships with. The application is a duplicate of the Actions
 * application, the way Application Designer duplicates one: MaxApps.duplicate() copies the
 * signature options, menus, labels and authorizations, but not the presentation, which is copied
 * here with its id changed. It also creates the TESTMEMO signature option the screen uses.
 *
 * Runs once through the "deployScript" manifest kind and is removed again afterwards.
 */
var MXServer = Java.type('psdi.server.MXServer');
var SqlFormat = Java.type('psdi.mbo.SqlFormat');
var MboConstants = Java.type('psdi.mbo.MboConstants');

var SOURCE_APP = 'ACTION';
var TARGET_APP = 'TESTACTION';
var SIG_OPTION = 'TESTMEMO';

main();

function main() {
    if (!exists('MAXAPPS', TARGET_APP)) {
        createApp();
    }

    createSigOption();
}

function createApp() {
    var systemUserInfo = MXServer.getMXServer().getSystemUserInfo();
    var appSet = MXServer.getMXServer().getMboSet('MAXAPPS', systemUserInfo);
    try {
        appSet.setWhere(appWhere('MAXAPPS', SOURCE_APP));
        var source = appSet.moveFirst();
        if (!source) {
            throw new Error('The ' + SOURCE_APP + ' application does not exist, so ' + TARGET_APP + ' cannot be created from it.');
        }

        var target = source.duplicate();
        target.setValue('APP', TARGET_APP);
        target.setValue('DESCRIPTION', 'TEST Actions');
        appSet.save();
    } finally {
        appSet.close();
    }

    var presentationSet = MXServer.getMXServer().getMboSet('MAXPRESENTATION', systemUserInfo);
    try {
        presentationSet.setWhere(appWhere('MAXPRESENTATION', SOURCE_APP));
        var xml = presentationSet.moveFirst().getString('PRESENTATION');
        presentationSet.reset();

        var presentation = presentationSet.add();
        presentation.setValue('APP', TARGET_APP, MboConstants.NOACCESSCHECK | MboConstants.NOVALIDATION_AND_NOACTION);
        presentation.setValue(
            'PRESENTATION',
            xml.replace(/<presentation id="[^"]*"/i, '<presentation id="' + TARGET_APP.toLowerCase() + '"'),
            MboConstants.NOACCESSCHECK | MboConstants.NOVALIDATION_AND_NOACTION
        );
        presentationSet.save();
    } finally {
        presentationSet.close();
    }
}

/*
 * The signature option the testaction.xml conditional UI is granted through. The screen metadata
 * declares it too, but creating it from there requires the language code of the environment the
 * screen was extracted from to be the base language of this one. Created here, the deployment
 * only updates it, which works whatever the base language.
 */
function createSigOption() {
    var sigOptionSet = MXServer.getMXServer().getMboSet('SIGOPTION', MXServer.getMXServer().getSystemUserInfo());
    try {
        var sqlf = new SqlFormat('app = :1 and optionname = :2');
        sqlf.setObject(1, 'SIGOPTION', 'APP', TARGET_APP);
        sqlf.setObject(2, 'SIGOPTION', 'OPTIONNAME', SIG_OPTION);
        sigOptionSet.setWhere(sqlf.format());

        if (sigOptionSet.isEmpty()) {
            var sigOption = sigOptionSet.add();
            sigOption.setValue('APP', TARGET_APP);
            sigOption.setValue('OPTIONNAME', SIG_OPTION);
            sigOption.setValue('DESCRIPTION', 'Complete manifest test conditional memo');
            sigOption.setValue('VISIBLE', false);
            sigOption.setValue('ESIGENABLED', false);
            sigOptionSet.save();
        }
    } finally {
        sigOptionSet.close();
    }
}

function appWhere(objectName, app) {
    var sqlf = new SqlFormat('app = :1');
    sqlf.setObject(1, objectName, 'APP', app);
    return sqlf.format();
}

function exists(objectName, app) {
    var set = MXServer.getMXServer().getMboSet(objectName, MXServer.getMXServer().getSystemUserInfo());
    try {
        set.setWhere(appWhere(objectName, app));
        return !set.isEmpty();
    } finally {
        set.close();
    }
}

var scriptConfig = {
    autoscript: 'TEST.COMPLETE.CREATEAPP',
    description: 'Complete manifest test: create the TESTACTION application',
    version: '1.0.0',
    active: true,
    logLevel: 'ERROR'
};
