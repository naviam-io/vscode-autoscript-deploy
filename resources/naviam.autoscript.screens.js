// @ts-nocheck
/* eslint-disable no-undef */
var RuntimeException = Java.type('java.lang.RuntimeException');

var URLDecoder = Java.type('java.net.URLDecoder');

var StandardCharsets = Java.type('java.nio.charset.StandardCharsets');

var MboConstants = Java.type('psdi.mbo.MboConstants');
var SqlFormat = Java.type('psdi.mbo.SqlFormat');

var MXServer = Java.type('psdi.server.MXServer');

var MXException = Java.type('psdi.util.MXException');

var HashMap = Java.type('java.util.HashMap');
var ScriptCache = Java.type('com.ibm.tivoli.maximo.script.ScriptCache');
var ScriptDriverFactory = Java.type('com.ibm.tivoli.maximo.script.ScriptDriverFactory');

var LIBRARY_SCRIPT = 'NAVIAM.AUTOSCRIPT.LIBRARY';
var libraryExports = null;

var MXLoggerFactory = Java.type('psdi.util.logging.MXLoggerFactory');

// MAS removed support for legacy JDOM, switch to JDOM2 and then fall back to legacy JDOM for older versions.
try {
    // eslint-disable-next-line no-global-assign
    Element = Java.type('org.jdom2.Element');
    SAXBuilder = Java.type('org.jdom2.input.SAXBuilder');
    Format = Java.type('org.jdom2.output.Format');
    XMLOutputter = Java.type('org.jdom2.output.XMLOutputter');
} catch (error) {
    if (error instanceof Java.type('java.lang.ClassNotFoundException') || error instanceof Java.type('java.lang.RuntimeException')) {
        // eslint-disable-next-line no-global-assign
        Element = Java.type('org.jdom.Element');
        SAXBuilder = Java.type('org.jdom.input.SAXBuilder');
        Format = Java.type('org.jdom.output.Format');
        XMLOutputter = Java.type('org.jdom.output.XMLOutputter');
    } else {
        // if some other error is occurring throw the error to the user.
        throw error;
    }
}

StringReader = Java.type('java.io.StringReader');
StringWriter = Java.type('java.io.StringWriter');

var logger = MXLoggerFactory.getLogger('maximo.naviam.devtools');

main();

function main() {
    if (typeof httpMethod !== 'undefined') {
        var response = {};
        try {
            checkPermissions('NAVIAM_UTILS', 'DEPLOYSCRIPT');

            if (httpMethod.toLowerCase() === 'get') {
                var screenName = getRequestScreentName();
                if (typeof screenName === 'undefined' || screenName === null || !screenName) {
                    // If nothing is requested then return a list of all screens.
                    var presentationSet;
                    try {
                        presentationSet = MXServer.getMXServer().getMboSet('MAXPRESENTATION', userInfo);

                        var presentations = [];
                        var presentation = presentationSet.getMbo(0);

                        while (presentation) {
                            var appMbo = presentation.getMboSet('$app', 'MAXAPPS', 'app = :app').moveFirst();

                            var result = {
                                label: presentation.getString('APP'),
                                description: appMbo != null ? appMbo.getString('DESCRIPTION') : ''
                            };

                            presentations.push(result);
                            presentationSet.remove(0);
                            presentation = presentationSet.getMbo(0);
                        }

                        response.status = 'success';
                        response.screenNames = presentations;
                        responseBody = JSON.stringify(response);
                    } finally {
                        _close(presentationSet);
                    }
                } else {
                    response.status = 'success';
                    response.presentation = extractScreen(screenName);
                    responseBody = JSON.stringify(response);
                }
                return;
            } else if (httpMethod.toLowerCase() === 'post' && typeof requestBody !== 'undefined') {
                var screen = new SAXBuilder().build(new StringReader(requestBody));
                var metadata = screen.getRootElement().getChild('metadata');
                var app = screen.getRootElement().getAttributeValue('id');
                var presentationExisted = presentationExists(app);

                if (isCreateOnlyRequest() && presentationExisted) {
                    response.status = 'success';
                    response.outcome = 'skipped';
                    responseBody = JSON.stringify(response);
                    return;
                }

                if (metadata) {
                    var controlGroups = metadata.getChildren('ctrlgroup');

                    // remove any existing control groups
                    resetControlGroups(screen.getRootElement().getAttributeValue('id'));
                    if (controlGroups) {
                        loadConditionalProperties();
                        controlGroups.forEach(function (controlGroupInfo) {
                            createGroupIfNotExists(controlGroupInfo.getChild('group'));
                            createOrUpdateSigOption(controlGroupInfo.getChild('sigoption'));

                            controlConditions = controlGroupInfo.getChildren('ctrlcondition');

                            if (controlConditions) {
                                controlConditions.forEach(function (controlCondition) {
                                    var conditionInfo = controlCondition.getChild('condition');

                                    if (conditionInfo) {
                                        createOrUpdateCondition(conditionInfo);
                                    }
                                });
                            }

                            // add the control groups defined by the application.
                            createControlGroup(controlGroupInfo);
                        });
                    }
                }
                //Remove the meta data from the XML so the Maximo screen parser doesn't process it.
                screen.getRootElement().removeChild('metadata');

                var writer = new StringWriter();

                new XMLOutputter(Format.getPrettyFormat()).output(screen, writer);

                var xml = writer.toString();

                library().deployPresentationXml(xml, app);

                response.outcome = presentationExisted ? 'updated' : 'created';
                response.status = 'success';
                responseBody = JSON.stringify(response);
            } else {
                throw new ScriptError('only_get_supported', 'Only the HTTP GET method is supported when extracting automation scripts.');
            }
        } catch (error) {
            response.status = 'error';
            // ensure the error is logged to the Maximo logs
            Java.type('java.lang.System').out.println(error);
            if (error instanceof ScreenError) {
                response.message = error.message;
                response.reason = error.reason;
            } else if (error instanceof SyntaxError) {
                response.reason = 'syntax_error';
                response.message = error.message;
            } else if (error instanceof Error) {
                response.message = error.message;
            } else if (error instanceof MXException) {
                response.reason = error.getErrorGroup() + '_' + error.getErrorKey();
                response.message = error.getMessage();
            } else if (error instanceof RuntimeException) {
                if (error.getCause() instanceof MXException) {
                    response.reason = error.getCause().getErrorGroup() + '_' + error.getCause().getErrorKey();
                    response.message = error.getCause().getMessage();
                } else {
                    response.reason = 'runtime_exception';
                    response.message = error.getMessage();
                }
            } else {
                response.cause = error;
            }

            if (typeof httpMethod !== 'undefined') {
                responseBody = JSON.stringify(response);
            }

            logger.error(error);

            return;
        }
    }
}

/** Runs the library script with the given context, which it reads its input from and writes its output to. */
function runLibrary(context) {
    if (!ScriptCache.getInstance().getScriptInfo(LIBRARY_SCRIPT)) {
        throw new ScreenError(
            'no_library_script',
            'The ' + LIBRARY_SCRIPT + ' script is not installed. Deploy the Maximo Development Tools scripts, then try again.'
        );
    }
    ScriptDriverFactory.getInstance().getScriptDriver(LIBRARY_SCRIPT).runScript(LIBRARY_SCRIPT, context);
    return context;
}

/** The functions the library script shares through its NaviamAutoscriptLibrary global. */
function library() {
    if (!libraryExports) {
        libraryExports = runLibrary(new HashMap()).get('NaviamAutoscriptLibrary');
    }
    return libraryExports;
}

/**
 * CTRLCONDPROP.PROPERTY is validated against the conditional properties of the control registry, which Maximo
 * only loads with the UI runtime. See docs/modules/maximo-scripts.md.
 */
function loadConditionalProperties() {
    try {
        if (Java.type('psdi.app.appsetup.CtrlCondPropCacheFactory').getInstance().getPropertyList().isEmpty()) {
            Java.type('psdi.webclient.system.runtime.WebClientRuntime').getWebClientRuntime();
        }
    } catch (error) {
        logger.warn('Unable to load the conditional UI properties of the control registry: ' + error);
    }
}

function resetControlGroups(app) {
    var ctrlGroupSet;
    try {
        ctrlGroupSet = MXServer.getMXServer().getMboSet('CTRLGROUP', userInfo);

        var sqlf = new SqlFormat('app = :1');

        sqlf.setObject(1, 'CTRLGROUP', 'APP', app);

        ctrlGroupSet.setWhere(sqlf.format());

        ctrlGroupSet.deleteAll();
        ctrlGroupSet.save();
    } finally {
        _close(ctrlGroupSet);
    }
}

function createControlGroup(ctrlGroupInfo) {
    var ctrlGroupSet;
    try {
        ctrlGroupSet = MXServer.getMXServer().getMboSet('CTRLGROUP', userInfo);

        var ctrlGroup = ctrlGroupSet.add();
        library().applyValues(ctrlGroup, [
            ['GROUPNAME', ctrlGroupInfo.getAttributeValue('groupname')],
            ['OPTIONNAME', ctrlGroupInfo.getAttributeValue('optionname'), MboConstants.NOACCESSCHECK],
            ['APP', ctrlGroupInfo.getAttributeValue('app'), MboConstants.NOACCESSCHECK],
            // This normally relies on being part of a set that is attached to the application.
            // Since we are confident that the values being added are correct, allow no-validation.
            ['GROUPSEQ', ctrlGroupInfo.getAttributeValue('groupseq'), MboConstants.NOVALIDATION]
        ]);

        var ctrlConditionSet = ctrlGroup.getMboSet('CTRLCONDITION');
        var controlConditions = ctrlGroupInfo.getChildren('ctrlcondition');
        if (controlConditions) {
            controlConditions.forEach(function (controlConditionInfo) {
                ctrlCondition = ctrlConditionSet.add();
                library().applyValues(ctrlCondition, [
                    ['CONDITIONNUM', controlConditionInfo.getAttributeValue('conditionnum')],
                    ['CONDITIONSEQ', controlConditionInfo.getAttributeValue('conditionseq')],
                    ['REEVALUATE', controlConditionInfo.getAttributeValue('reevaluate')]
                ]);

                var controlCondProps = controlConditionInfo.getChildren('ctrlcondprop');

                if (controlCondProps) {
                    var ctrlCondPropSet = ctrlCondition.getMboSet('CTRLCONDPROP');
                    controlCondProps.forEach(function (controlCondPropInfo) {
                        var ctrlCondProp = ctrlCondPropSet.add();
                        library().applyValues(ctrlCondProp, [
                            ['CONDITIONRESULT', controlCondPropInfo.getAttributeValue('conditionresult')],
                            ['PROPERTY', controlCondPropInfo.getAttributeValue('property')],
                            ['PROPERTYVALUE', controlCondPropInfo.getAttributeValue('propertyvalue')]
                        ]);
                    });
                }
            });
        }

        ctrlGroupSet.save();
    } finally {
        _close(ctrlGroupSet);
    }
}

function createOrUpdateCondition(conditionInfo) {
    if (conditionInfo) {
        var conditionSet;
        try {
            conditionSet = MXServer.getMXServer().getMboSet('CONDITION', userInfo);
            var sqlf = new SqlFormat('conditionnum = :1');
            sqlf.setObject(1, 'CONDITION', 'CONDITIONNUM', conditionInfo.getAttributeValue('conditionnum'));
            conditionSet.setWhere(sqlf.format());

            var condition;

            if (conditionSet.isEmpty()) {
                condition = conditionSet.add();
                library().applyValues(condition, [['CONDITIONNUM', conditionInfo.getAttributeValue('conditionnum')]]);
            } else {
                condition = conditionSet.moveFirst();
            }
            library().applyOptionalValues(condition, [['TYPE', conditionInfo.getAttributeValue('type')]]);
            library().applyValues(condition, [
                ['DESCRIPTION', conditionInfo.getAttributeValue('description')],
                ['EXPRESSION', conditionInfo.getAttributeValue('expression')],
                ['CLASSNAME', conditionInfo.getAttributeValue('classname'), MboConstants.NOACCESSCHECK],
                ['NOCACHING', conditionInfo.getAttributeValue('nocaching')]
            ]);

            conditionSet.save();
        } finally {
            _close(conditionSet);
        }
    }
}

function createOrUpdateSigOption(sigOptionInfo) {
    if (sigOptionInfo) {
        var sigOptionSet;
        try {
            sigOptionSet = MXServer.getMXServer().getMboSet('SIGOPTION', userInfo);
            var sqlf = new SqlFormat('optionname = :1 and app = :2');
            sqlf.setObject(1, 'SIGOPTION', 'OPTIONNAME', sigOptionInfo.getAttributeValue('optionname'));
            sqlf.setObject(2, 'SIGOPTION', 'APP', sigOptionInfo.getAttributeValue('app'));

            sigOptionSet.setWhere(sqlf.format());
            var sigOption;
            var sigOptFlag;
            var sigOptFlagSet;
            if (sigOptionSet.isEmpty()) {
                sigOption = sigOptionSet.add();
                library().applyValues(sigOption, [
                    ['APP', sigOptionInfo.getAttributeValue('app')],
                    ['OPTIONNAME', sigOptionInfo.getAttributeValue('optionname')],
                    ['DESCRIPTION', sigOptionInfo.getAttributeValue('description')],
                    ['ESIGENABLED', sigOptionInfo.getAttributeValue('esigenabled')],
                    ['ALSOGRANTS', sigOptionInfo.getAttributeValue('alsogrants')],
                    ['ALSOREVOKES', sigOptionInfo.getAttributeValue('alsorevokes')],
                    ['PREREQUISITE', sigOptionInfo.getAttributeValue('prerequisite')]
                ]);
                library().applyOptionalValues(sigOption, [
                    ['VISIBLE', sigOptionInfo.getAttributeValue('visible')],
                    ['LANGCODE', sigOptionInfo.getAttributeValue('langcode')]
                ]);

                sigoptFlagInfo = sigOptionInfo.getChild('sigoptflag');
                if (sigoptFlagInfo) {
                    sigOptFlag = sigOption.getMboSet('SIGOPTFLAG').add();
                    library().applyValues(sigOptFlag, [
                        ['APP', sigoptFlagInfo.getAttributeValue('app')],
                        ['OPTIONNAME', sigoptFlagInfo.getAttributeValue('optionname')],
                        ['FLAGNAME', sigoptFlagInfo.getAttributeValue('flagname')],
                        ['VALUE', sigoptFlagInfo.getAttributeValue('value')]
                    ]);
                }
                sigOptionSet.save();
            } else {
                sigOption = sigOptionSet.moveFirst();
                library().applyValues(sigOption, [
                    ['DESCRIPTION', sigOptionInfo.getAttributeValue('description')],
                    ['ESIGENABLED', sigOptionInfo.getAttributeValue('esigenabled')],
                    ['ALSOGRANTS', sigOptionInfo.getAttributeValue('alsogrants')],
                    ['ALSOREVOKES', sigOptionInfo.getAttributeValue('alsorevokes')],
                    ['PREREQUISITE', sigOptionInfo.getAttributeValue('prerequisite')]
                ]);
                library().applyOptionalValues(sigOption, [['VISIBLE', sigOptionInfo.getAttributeValue('visible')]]);

                sigoptFlagInfo = sigOptionInfo.getChild('sigoptflag');
                if (sigoptFlagInfo) {
                    sigOptFlagSet = sigOption.getMboSet('SIGOPTFLAG');
                    if (!sigOptFlagSet.isEmpty()) {
                        sigOptFlag = sigOptFlagSet.moveFirst();
                        library().applyValues(sigOptFlag, [
                            ['FLAGNAME', sigoptFlagInfo.getAttributeValue('flagname')],
                            ['VALUE', sigoptFlagInfo.getAttributeValue('value')]
                        ]);
                    } else {
                        sigOptFlag = sigOption.getMboSet('SIGOPTFLAG').add();
                        library().applyValues(sigOptFlag, [
                            ['APP', sigoptFlagInfo.getAttributeValue('app')],
                            ['OPTIONNAME', sigoptFlagInfo.getAttributeValue('optionname')],
                            ['FLAGNAME', sigoptFlagInfo.getAttributeValue('flagname')],
                            ['VALUE', sigoptFlagInfo.getAttributeValue('value')]
                        ]);
                    }
                } else {
                    sigOptFlagSet = sigOption.getMboSet('SIGOPTFLAG');
                    if (!sigOptFlagSet.isEmpty()) {
                        sigOptFlagSet.deleteAll();
                    }
                }
                sigOptionSet.save();
            }
        } finally {
            _close(sigOptionSet);
        }
    }
}

function createGroupIfNotExists(groupInfo) {
    if (groupInfo) {
        var groupSet;
        try {
            groupSet = MXServer.getMXServer().getMboSet('MAXGROUP', userInfo);
            var sqlf = new SqlFormat('groupname = :1');
            sqlf.setObject(1, 'MAXGROUP', 'GROUPNAME', groupInfo.getAttributeValue('groupname'));

            groupSet.setWhere(sqlf.format());
            if (groupSet.isEmpty()) {
                var group = groupSet.add();
                library().applyValues(group, [
                    ['GROUPNAME', groupInfo.getAttributeValue('groupname')],
                    ['DESCRIPTION', groupInfo.getAttributeValue('description')],
                    ['PASSWORDDURATION', groupInfo.getAttributeValue('passwordduration')],
                    ['PASSWORDWARNING', groupInfo.getAttributeValue('passwordwarning')],
                    ['SCTEMPLATEID', scTemplateExists(groupInfo.getAttributeValue('sctemplateid')) ? groupInfo.getAttributeValue('sctemplateid') : ''],
                    ['MAXSCHEDREPORT', groupInfo.getAttributeValue('maxschedreport')],
                    ['DFLTAPP', groupInfo.getAttributeValue('dfltapp')],
                    ['ADHOCCREATELIMIT', groupInfo.getAttributeValue('adhoccreatelimit')],
                    ['REPORTSTOPLIMIT', groupInfo.getAttributeValue('reportstoplimit')],
                    ['WORKCENTER', groupInfo.getAttributeValue('workcenter')]
                ]);
                library().applyOptionalValues(group, [
                    ['INDEPENDENT', groupInfo.getAttributeValue('independent')],
                    ['AUTHALLSITES', groupInfo.getAttributeValue('authallsites')],
                    ['AUTHALLGLS', groupInfo.getAttributeValue('authallgls')],
                    ['AUTHALLSTOREROOMS', groupInfo.getAttributeValue('authallstorerooms')],
                    ['AUTHLABORALL', groupInfo.getAttributeValue('authlaborall')],
                    ['AUTHLABORCREW', groupInfo.getAttributeValue('authlaborcrew')],
                    ['AUTHLABORSELF', groupInfo.getAttributeValue('authlaborself')],
                    ['AUTHLABORSUPER', groupInfo.getAttributeValue('authlaborsuper')],
                    ['LANGCODE', groupInfo.getAttributeValue('langcode')],
                    ['AUTHPERSONGROUP', groupInfo.getAttributeValue('authpersongroup')],
                    ['NULLREPFAC', groupInfo.getAttributeValue('nullrepfac')],
                    ['AUTHALLREPFACS', groupInfo.getAttributeValue('authallrepfacs')],
                    ['SIDENAV', groupInfo.getAttributeValue('sidenav')]
                ]);

                groupSet.save();
            }
        } finally {
            _close(groupSet);
        }
    }
}

function scTemplateExists(templateId) {
    if (templateId && templateId != '') {
        var sctemplateSet;
        try {
            sctemplateSet = MXServer.getMXServer().getMboSet('SCTEMPLATE', userInfo);
            var sqlf = new SqlFormat('groupname = :1');
            sqlf.setObject(1, 'SCTEMPLATE', 'SCTEMPLATEID', templateId);
            sctemplateSet.setWhere(sqlf.format());

            return !sctemplateSet.exists();
        } finally {
            _close(sctemplateSet);
        }
    }
}

function extractScreen(screenName) {
    var maxpresentationSet;
    try {
        maxpresentationSet = MXServer.getMXServer().getMboSet('MAXPRESENTATION', userInfo);
        var sqlf = new SqlFormat('app = :1');
        sqlf.setObject(1, 'MAXPRESENTATION', 'APP', screenName);

        maxpresentationSet.setWhere(sqlf.format());

        if (!maxpresentationSet.isEmpty()) {
            var maxpresentation = maxpresentationSet.moveFirst();
            return addConditionalExpressionsMetaData(maxpresentation.getString('PRESENTATION'), screenName);
        } else {
            throw new ScreenError('screen_not_found', 'The screen definition for ' + screenName + ' was not found.');
        }
    } finally {
        _close(maxpresentationSet);
    }
}

function addConditionalExpressionsMetaData(xml, screenName) {
    var screen = new SAXBuilder().build(new StringReader(xml));

    var controlGroupSet;

    try {
        controlGroupSet = MXServer.getMXServer().getMboSet('CTRLGROUP', userInfo);
        var sqlf = new SqlFormat('app = :1');
        sqlf.setObject(1, 'CTRLGROUP', 'APP', screenName);

        controlGroupSet.setWhere(sqlf.format());

        if (!controlGroupSet.isEmpty()) {
            controlGroup = controlGroupSet.moveFirst();
            var presentation = screen.getRootElement();
            var metadata = new Element('metadata');
            while (controlGroup) {
                metadata.addContent(getControlGroup(controlGroup));
                controlGroup = controlGroupSet.moveNext();
            }
            presentation.addContent(0, metadata);
            var writer = new StringWriter();
            var outputter = new XMLOutputter(Format.getPrettyFormat());
            outputter.output(screen, writer);

            return writer.toString();
        } else {
            return xml;
        }
    } finally {
        _close(controlGroupSet);
    }
}

function getControlGroup(controlGroup) {
    var ctrlgroup = new Element('ctrlgroup');
    ctrlgroup.setAttribute('groupname', controlGroup.getString('GROUPNAME'));
    ctrlgroup.setAttribute('optionname', controlGroup.getString('OPTIONNAME'));
    ctrlgroup.setAttribute('app', controlGroup.getString('APP'));
    ctrlgroup.setAttribute('groupseq', controlGroup.getString('GROUPSEQ'));

    var sigoption = new Element('sigoption');
    sigoption.setAttribute('optionname', controlGroup.getString('SIGOPTION.OPTIONNAME'));
    sigoption.setAttribute('app', controlGroup.getString('SIGOPTION.APP'));
    sigoption.setAttribute('description', controlGroup.getString('SIGOPTION.DESCRIPTION'));
    sigoption.setAttribute('esigenabled', controlGroup.getString('SIGOPTION.ESIGENABLED'));
    sigoption.setAttribute('visible', controlGroup.getString('SIGOPTION.VISIBLE'));
    sigoption.setAttribute('alsogrants', controlGroup.getString('SIGOPTION.ALSOGRANTS'));
    sigoption.setAttribute('alsorevokes', controlGroup.getString('SIGOPTION.ALSOREVOKES'));
    sigoption.setAttribute('prerequisite', controlGroup.getString('SIGOPTION.PREREQUISITE'));
    sigoption.setAttribute('langcode', controlGroup.getString('SIGOPTION.LANGCODE'));

    if (!controlGroup.isNull('SIGOPTION.SIGOPTFLAG.OPTIONNAME')) {
        var sigoptFlag = new Element('sigoptflag');
        sigoptFlag.setAttribute('optionname', controlGroup.getString('SIGOPTION.SIGOPTFLAG.OPTIONNAME'));
        sigoptFlag.setAttribute('app', controlGroup.getString('SIGOPTION.SIGOPTFLAG.APP'));
        sigoptFlag.setAttribute('flagname', controlGroup.getString('SIGOPTION.SIGOPTFLAG.FLAGNAME'));
        sigoptFlag.setAttribute('value', controlGroup.getString('SIGOPTION.SIGOPTFLAG.VALUE'));

        sigoption.addContent(sigoptFlag);
    }
    ctrlgroup.addContent(sigoption);

    var group = new Element('group');
    group.setAttribute('groupname', controlGroup.getString('MAXGROUP.GROUPNAME'));
    group.setAttribute('description', controlGroup.getString('MAXGROUP.DESCRIPTION'));
    group.setAttribute('passwordduration', controlGroup.getString('MAXGROUP.PASSWORDDURATION'));
    group.setAttribute('passwordwarning', controlGroup.getString('MAXGROUP.PASSWORDWARNING'));
    group.setAttribute('independent', controlGroup.getString('MAXGROUP.INDEPENDENT'));
    group.setAttribute('authallsites', controlGroup.getString('MAXGROUP.AUTHALLSITES'));
    group.setAttribute('authallgls', controlGroup.getString('MAXGROUP.AUTHALLGLS'));
    group.setAttribute('authallstorerooms', controlGroup.getString('MAXGROUP.AUTHALLSTOREROOMS'));
    group.setAttribute('authlaborall', controlGroup.getString('MAXGROUP.AUTHLABORALL'));
    group.setAttribute('authlaborcrew', controlGroup.getString('MAXGROUP.AUTHLABORCREW'));
    group.setAttribute('authlaborself', controlGroup.getString('MAXGROUP.AUTHLABORSELF'));
    group.setAttribute('authlaborsuper', controlGroup.getString('MAXGROUP.AUTHLABORSUPER'));
    group.setAttribute('langcode', controlGroup.getString('MAXGROUP.LANGCODE'));
    group.setAttribute('sctemplateid', controlGroup.getString('MAXGROUP.SCTEMPLATEID'));
    group.setAttribute('authpersongroup', controlGroup.getString('MAXGROUP.AUTHPERSONGROUP'));
    group.setAttribute('nullrepfac', controlGroup.getString('MAXGROUP.NULLREPFAC'));
    group.setAttribute('authallrepfacs', controlGroup.getString('MAXGROUP.AUTHALLREPFACS'));
    group.setAttribute('maxschedreport', controlGroup.getString('MAXGROUP.MAXSCHEDREPORT'));
    group.setAttribute('dfltapp', controlGroup.getString('MAXGROUP.DFLTAPP'));
    group.setAttribute('adhoccreatelimit', controlGroup.getString('MAXGROUP.ADHOCCREATELIMIT'));
    group.setAttribute('reportstoplimit', controlGroup.getString('MAXGROUP.REPORTSTOPLIMIT'));
    group.setAttribute('sidenav', controlGroup.getString('MAXGROUP.SIDENAV'));
    group.setAttribute('workcenter', controlGroup.getString('MAXGROUP.WORKCENTER'));

    ctrlgroup.addContent(group);

    controlConditionSet = controlGroup.getMboSet('CTRLCONDITION');
    if (!controlConditionSet.isEmpty()) {
        controlCondition = controlConditionSet.moveFirst();

        while (controlCondition) {
            var ctrlcondition = new Element('ctrlcondition');
            ctrlcondition.setAttribute('conditionnum', controlCondition.getString('CONDITIONNUM'));
            ctrlcondition.setAttribute('conditionseq', controlCondition.getString('CONDITIONSEQ'));
            ctrlcondition.setAttribute('reevaluate', controlCondition.getString('REEVALUATE'));

            var condition = new Element('condition');
            condition.setAttribute('conditionnum', controlCondition.getString('CONDITIONNUM'));
            condition.setAttribute('type', controlCondition.getString('CONDITION.TYPE'));
            condition.setAttribute('expression', controlCondition.getString('CONDITION.EXPRESSION'));
            condition.setAttribute('classname', controlCondition.getString('CONDITION.CLASSNAME'));
            condition.setAttribute('description', controlCondition.getString('CONDITION.DESCRIPTION'));
            condition.setAttribute('nocaching', controlCondition.getString('CONDITION.NOCACHING'));

            ctrlcondition.addContent(condition);

            controlCondPropSet = controlCondition.getMboSet('CTRLCONDPROP');
            if (!controlCondPropSet.isEmpty()) {
                var controlCondProp = controlCondPropSet.moveFirst();

                while (controlCondProp) {
                    var ctrlcondprop = new Element('ctrlcondprop');
                    ctrlcondprop.setAttribute('property', controlCondProp.getString('PROPERTY'));
                    ctrlcondprop.setAttribute('propertyvalue', controlCondProp.getString('PROPERTYVALUE'));
                    ctrlcondprop.setAttribute('conditionresult', controlCondProp.getString('CONDITIONRESULT'));

                    ctrlcondition.addContent(ctrlcondprop);

                    controlCondProp = controlCondPropSet.moveNext();
                }
            }
            ctrlgroup.addContent(ctrlcondition);
            controlCondition = controlConditionSet.moveNext();
        }
    }

    return ctrlgroup;
}

function getRequestScreentName() {
    var httpRequest = request.getHttpServletRequest();

    var requestURI = httpRequest.getRequestURI();
    var contextPath = httpRequest.getContextPath();
    var resourceReq = requestURI;

    if (contextPath && contextPath !== '') {
        resourceReq = requestURI.substring(contextPath.length());
    }

    if (!resourceReq.startsWith('/')) {
        resourceReq = '/' + resourceReq;
    }

    var isOSLC = true;

    if (!resourceReq.toLowerCase().startsWith('/oslc/script/' + service.scriptName.toLowerCase())) {
        if (!resourceReq.toLowerCase().startsWith('/api/script/' + service.scriptName.toLowerCase())) {
            return null;
        } else {
            osOSLC = false;
        }
    }

    var baseReqPath = isOSLC ? '/oslc/script/' + service.scriptName : '/api/script/' + service.scriptName;

    var action = resourceReq.substring(baseReqPath.length);

    if (action.startsWith('/')) {
        action = action.substring(1);
    }

    if (!action || action.trim() === '') {
        return null;
    }

    return URLDecoder.decode(action.toLowerCase(), StandardCharsets.UTF_8.name());
}

function checkPermissions(app, optionName) {
    if (!userInfo) {
        throw new ScreenError('no_user_info', 'The userInfo global variable has not been set, therefore the user permissions cannot be verified.');
    }

    if (!MXServer.getMXServer().lookup('SECURITY').getProfile(userInfo).hasAppOption(app, optionName) && !isInAdminGroup()) {
        throw new ScreenError(
            'no_permission',
            'The user ' + userInfo.getUserName() + ' does not have access to the ' + optionName + ' option in the ' + app + ' object structure.'
        );
    }
}

// Determines if the current user is in the administrator group, returns true if the user is, false otherwise.
function isInAdminGroup() {
    var user = userInfo.getUserName();
    service.log_info('Determining if the user ' + user + ' is in the administrator group.');
    var groupUserSet;

    try {
        groupUserSet = MXServer.getMXServer().getMboSet('GROUPUSER', MXServer.getMXServer().getSystemUserInfo());

        // Get the ADMINGROUP MAXVAR value.
        var adminGroup = MXServer.getMXServer().lookup('MAXVARS').getString('ADMINGROUP', null);

        // Query for the current user and the found admin group.
        // The current user is determined by the implicity `user` variable.
        sqlFormat = new SqlFormat('userid = :1 and groupname = :2');
        sqlFormat.setObject(1, 'GROUPUSER', 'USERID', user);
        sqlFormat.setObject(2, 'GROUPUSER', 'GROUPNAME', adminGroup);
        groupUserSet.setWhere(sqlFormat.format());

        if (!groupUserSet.isEmpty()) {
            service.log_info('The user ' + user + ' is in the administrator group ' + adminGroup + '.');
            return true;
        } else {
            service.log_info('The user ' + user + ' is not in the administrator group ' + adminGroup + '.');
            return false;
        }
    } finally {
        _close(groupUserSet);
    }
}

// Cleans up the MboSet connections and closes the set.
/** Whether the request asks to leave an existing item unchanged: see docs/flows/deploy.md. */
function isCreateOnlyRequest() {
    return typeof request !== 'undefined' && request !== null && String(request.getQueryParam('createOnly')) === 'true';
}

/** Whether Maximo holds a presentation for this application or system presentation. */
function presentationExists(app) {
    var presentationSet;
    try {
        presentationSet = MXServer.getMXServer().getMboSet('MAXPRESENTATION', userInfo);
        var sqlf = new SqlFormat('app = :1');
        sqlf.setObject(1, 'MAXPRESENTATION', 'APP', app);
        presentationSet.setWhere(sqlf.format());
        return !presentationSet.isEmpty();
    } finally {
        _close(presentationSet);
    }
}

function _close(set) {
    if (set) {
        try {
            set.cleanup();
            set.close();
        } catch (ignore) {
            /* empty */
        }
    }
}

function ScreenError(reason, message) {
    Error.call(this, message);
    this.reason = reason;
    this.message = message;
}

// ConfigurationError derives from Error
ScreenError.prototype = Object.create(Error.prototype);
ScreenError.prototype.constructor = ScreenError;
ScreenError.prototype.element;

// eslint-disable-next-line no-unused-vars
var scriptConfig = {
    autoscript: 'NAVIAM.AUTOSCRIPT.SCREENS',
    description: 'Naviam Extract screen definitions.',
    version: '1.0.0',
    active: true,
    logLevel: 'ERROR'
};
