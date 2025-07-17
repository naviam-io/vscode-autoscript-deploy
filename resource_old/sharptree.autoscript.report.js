/* eslint-disable no-undef */
/* eslint-disable no-unused-vars */
// @ts-nocheck

var RuntimeException = Java.type('java.lang.RuntimeException');
var System = Java.type('java.lang.System');

var JavaString = Java.type('java.lang.String');
var Base64 = Java.type('java.util.Base64');
var HashMap = Java.type('java.util.HashMap');

var URLDecoder = Java.type('java.net.URLDecoder');
var StandardCharsets = Java.type('java.nio.charset.StandardCharsets');

var DBShortcut = Java.type('psdi.mbo.DBShortcut');
var SqlFormat = Java.type('psdi.mbo.SqlFormat');
var MXServer = Java.type('psdi.server.MXServer');

var MXException = Java.type('psdi.util.MXException');
var MXAccessException = Java.type('psdi.util.MXAccessException');
var MXApplicationException = Java.type('psdi.util.MXApplicationException');

var MXLoggerFactory = Java.type('psdi.util.logging.MXLoggerFactory');
var Version = Java.type('psdi.util.Version');

var ReportImportInfo = Java.type(
    'com.ibm.tivoli.maximo.report.birt.admin.ReportImportInfo'
);
var ReportImportParamInfo = Java.type(
    'com.ibm.tivoli.maximo.report.birt.admin.ReportImportParamInfo'
);

var ByteArrayInputStream = Java.type('java.io.ByteArrayInputStream');
var ByteArrayOutputStream = Java.type('java.io.ByteArrayOutputStream');
var ZipInputStream = Java.type('java.util.zip.ZipInputStream');
var ZipEntry = Java.type('java.util.zip.ZipEntry');
var ByteArray = Java.type('byte[]');
System = Java.type('java.lang.System');

var logger = MXLoggerFactory.getLogger(
    'maximo.script.' + service.getScriptName()
);

main();

function main() {
    if (typeof httpMethod !== 'undefined') {
        var response = {};
        try {
            checkPermissions('SHARPTREE_UTILS', 'DEPLOYSCRIPT');

            if (httpMethod.toLowerCase() === 'get') {
                var reportId = getReportId();
                if (
                    typeof reportId === 'undefined' ||
                    reportId === null ||
                    !reportId
                ) {
                    // If nothing is requested then return a list of all screens.
                    var reportSet;
                    try {
                        reportSet = MXServer.getMXServer().getMboSet(
                            'REPORT',
                            userInfo
                        );
                        var sqlf = new SqlFormat('runtype = :1');
                        sqlf.setObject(1, 'REPORT', 'RUNTYPE', 'BIRT');
                        reportSet.setWhere(sqlf.format());
                        reportSet.setOrderBy('description');

                        var reports = [];

                        var report = reportSet.getMbo(0);

                        while (report) {
                            reports.push({
                                reportId: report.getUniqueIDValue(),
                                report: report.getString('REPORTNAME'),
                                description: report.getString('DESCRIPTION'),
                                app: report.getString('REPORTFOLDER'),
                            });

                            reportSet.remove(0);
                            report = reportSet.getMbo(0);
                        }

                        response.status = 'success';
                        response.reports = reports;
                        responseBody = JSON.stringify(response);
                    } finally {
                        _close(reportSet);
                    }
                } else {
                    response.status = 'success';
                    response.report = exportReport(reportId);
                    responseBody = JSON.stringify(response);
                }
                return;
            } else if (
                httpMethod.toLowerCase() === 'post' &&
                typeof requestBody !== 'undefined'
            ) {
                var reportData = JSON.parse(requestBody);

                importReport(reportData);

                response.status = 'success';
                responseBody = JSON.stringify(response);
            } else {
                throw new ReportError(
                    'only_get_supported',
                    'Only the HTTP GET method is supported when extracting automation scripts.'
                );
            }
        } catch (error) {
            response.status = 'error';
            // ensure the error is logged to the Maximo logs
            Java.type('java.lang.System').out.println(error);
            if (error instanceof ReportError) {
                response.message = error.message;
                response.reason = error.reason;
            } else if (error instanceof SyntaxError) {
                response.reason = 'syntax_error';
                response.message = error.message;
            } else if (error instanceof Error) {
                response.message = error.message;
            } else if (error instanceof MXException) {
                response.reason =
                    error.getErrorGroup() + '_' + error.getErrorKey();
                response.message = error.getMessage();
            } else if (error instanceof RuntimeException) {
                if (error.getCause() instanceof MXException) {
                    response.reason =
                        error.getCause().getErrorGroup() +
                        '_' +
                        error.getCause().getErrorKey();
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

function importReport(report) {
    var reportService = MXServer.getMXServer().lookup('BIRTREPORT');
    var reportInfo = new ReportImportInfo();

    reportInfo.setAppName(report.appName);
    reportInfo.setFileName(report.reportName);
    reportInfo.setName(report.reportName);

    if (typeof report.resources !== 'undefined' && report.resources) {
        reportInfo.setResources(Base64.getDecoder().decode(report.resources));
        reportInfo.setImportResourcesEnabled(true);
    }

    reportInfo.setXmlReportData(new JavaString(report.design).getBytes());
    reportInfo.setLibrary(false);

    reportInfo.setAttribute('filename', report.reportName);
    reportInfo.setAttribute('description', report.description);
    reportInfo.setAttribute('dp', report.directPrint);
    reportInfo.setAttribute('dploc', report.directPrintLocation);
    reportInfo.setAttribute('ql', report.browserView);
    reportInfo.setAttribute('qlloc', report.browserViewLocation);
    reportInfo.setAttribute('pad', report.printWithAttachments);
    reportInfo.setAttribute('padloc', report.printWithAttachmentsLocation);
    reportInfo.setAttribute('toolbarsequence', report.toolbarSequence);
    reportInfo.setAttribute('norequestpage', report.noRequestPage);
    reportInfo.setAttribute('detail', report.detail);
    if (report.paramColumns && report.paramColumns > 0) {
        reportInfo.setAttribute('paramcolumns', report.paramColumns);
    }
    if (report.displayOrder && report.displayOrder > 0) {
        reportInfo.setAttribute('displayorder', report.displayOrder);
    }

    if (report.detail && report.recordLimit > 0) {
        reportInfo.setAttribute('recordlimit', report.recordLimit);
    }
    reportInfo.setAttribute('reportfolder', report.reportFolder);
    reportInfo.setAttribute('priority', report.priority);
    reportInfo.setAttribute('scheduleonly', report.scheduleOnly);
    reportInfo.setAttribute('toolbarlocation', report.toolbarLocation);
    if (report.toolbarIcon) {
        reportInfo.setAttribute('toolbaricon', report.toolbarIcon);
    }
    reportInfo.setAttribute('usewherewithparam', report.useWhereWithParam);

    var paramNames = [];
    if (
        typeof report.parameters !== 'undefined' &&
        report.parameters.length > 0
    ) {
        report.parameters.forEach(function (param) {
            var reportParam = new ReportImportParamInfo();

            if (param.defaultValue) {
                reportParam.setAttribute('defaultvalue', param.defaultValue);
            }
            reportParam.setAttribute('attributename', param.attributeName);
            reportParam.setAttribute('labeloverride', param.labelOverride);
            reportParam.setAttribute('sequence', param.sequence);
            reportParam.setAttribute('lookupname', param.lookupName);
            reportParam.setAttribute('required', param.required);
            reportParam.setAttribute('hidden', param.hidden);
            reportParam.setAttribute('multiLookup', param.multiLookup);
            reportParam.setAttribute('operator', param.operator);
            reportInfo.setParameter(param.parameterName, reportParam);

            paramNames.push(param.parameterName);
        });
    }

    reportService.importReport(userInfo, reportInfo, true);

    var reportSet = MXServer.getMXServer().getMboSet('REPORT', userInfo);
    var presentationSet = MXServer.getMXServer().getMboSet(
        'MAXPRESENTATION',
        userInfo
    );
    try {
        var sqlf = new SqlFormat('reportname = :1');
        sqlf.setObject(1, 'REPORT', 'REPORTNAME', report.reportName);
        reportSet.setWhere(sqlf.format());
        var reportMbo = reportSet.moveFirst();
        if (reportMbo) {
            // generate the request page
            var xml = reportMbo.generateXML(
                reportMbo,
                reportMbo.getMboSet('REPORT_LOOKUP'),
                reportMbo.getBaseReportXML()
            );

            // save the presentation
            sqlf = new SqlFormat('app = :1');
            sqlf.setObject(1, 'MAXPRESENTATION', 'APP', 'REPLIBRARY');

            presentationSet.setWhere(sqlf.format());
            var presentationMbo = presentationSet.moveFirst();
            if (presentationMbo) {
                presentationMbo.setValue('PRESENTATION', xml);
                presentationSet.save();
            }

            // Remove any parameters that were automatically added.
            var reportParamSet = reportMbo.getMboSet('REPORT_LOOKUP');
            var reportParam = reportParamSet.moveFirst();

            while (reportParam) {
                if (
                    paramNames.indexOf(
                        reportParam.getString('PARAMETERNAME')
                    ) == -1
                ) {
                    reportParam.delete();
                }

                reportParam = reportParamSet.moveNext();
            }

            reportSet.save();
        }
    } finally {
        _close(reportSet);
        _close(presentationSet);
    }
}

function exportReport(reportId) {
    var reportSet;
    try {
        reportSet = MXServer.getMXServer().getMboSet('REPORT', userInfo);

        var report = reportSet.getMboForUniqueId(reportId);

        if (report) {
            var reportService = MXServer.getMXServer().lookup('BIRTREPORT');
            var reportExport = reportService.exportReport(
                userInfo,
                report.getString('REPORTNAME'),
                report.getString('REPORTFOLDER')
            );

            var zis = new ZipInputStream(
                new ByteArrayInputStream(reportExport)
            );
            var design;
            var entry;
            while ((entry = zis.getNextEntry()) != null) {
                if (entry.getName() == report.getString('REPORTNAME')) {
                    var baos = new ByteArrayOutputStream();
                    var buffer = new ByteArray(1024);
                    var count;
                    while ((count = zis.read(buffer)) != -1) {
                        baos.write(buffer, 0, count);
                    }
                    design = new JavaString(baos.toByteArray());
                    System.out.println('+++ here:\n' + design);
                    baos.close();
                    break;
                }
                zis.closeEntry();
            }
            zis.close();

            var result = {};
            result.reportName = report.getString('REPORTNAME');
            result.description = report.getString('DESCRIPTION');
            result.reportFolder = report.getString('REPORTFOLDER');
            result.appName = report.getString('APPNAME');
            result.toolbarLocation = report.getString('TOOLBARLOCATION');
            result.toolbarIcon = report.getString('TOOLBARICON');
            result.toolbarSequence = !report.isNull('TOOLBARSEQUENCE')
                ? report.getInt('TOOLBARSEQUENCE')
                : null;
            result.noRequestPage = report.getBoolean('NOREQUESTPAGE');
            result.detail = report.getBoolean('DETAIL');
            result.langCode = report.getString('LANGCODE');
            result.useWhereWithParam = report.getBoolean('USEWHEREWITHPARAM');
            result.recordLimit = !report.isNull('RECORDLIMIT')
                ? report.getInt('RECORDLIMIT')
                : null;
            result.browserView = report.getBoolean('QL');
            result.directPrint = report.getBoolean('DP');
            result.printWithAttachments = report.getBoolean('PAD');
            result.browserViewLocation = report.getString('QLLOC');
            result.directPrintLocation = report.getString('DPLOC');
            result.printWithAttachmentsLocation = report.getString('PADLOC');
            result.priority = !report.isNull('PRIORITY')
                ? report.getInt('PRIORITY')
                : null;
            result.scheduleOnly = report.getBoolean('SCHEDULEONLY');
            result.design = design
                ? design
                : report.getString('REPORT_DESIGN.DESIGN');
            result.displayOrder = report.getString('DISPLAYORDER');
            result.paramColumns = report.getString('PARAMCOLUMNS');

            if (!report.isNull('REPORT_DESIGN.RESOURCES')) {
                result.resources = Base64.getEncoder().encodeToString(
                    report.getBytes('REPORT_DESIGN.RESOURCES')
                );
            }

            var params = [];

            var reportParamSet = report.getMboSet('REPORT_LOOKUP');
            reportParamSet.setOrderBy('SEQUENCE');
            var reportParam = reportParamSet.moveFirst();

            while (reportParam) {
                param = {};
                param.parameterName = reportParam.getString('PARAMETERNAME');
                param.attributeName = reportParam.getString('ATTRIBUTENAME');
                param.lookupName = reportParam.getString('LOOKUPNAME');
                param.sequence = reportParam.getInt('SEQUENCE');
                param.labelOverride = reportParam.getString('LABELOVERRIDE');
                param.defaultValue = reportParam.getString('DEFAULTVALUE');
                param.required = reportParam.getBoolean('REQUIRED');
                param.hidden = reportParam.getBoolean('HIDDEN');
                param.operator = reportParam.getString('OPERATOR');
                param.multiLookup = reportParam.getBoolean('MULTILOOKUP');

                params.push(param);

                reportParam = reportParamSet.moveNext();
            }
            result.parameters = params;
            return result;
        } else {
            return null;
        }
    } finally {
        _close(reportSet);
    }
}

function hasAttribute(objectName, attributeName) {
    return (
        MXServer.getMXServer()
            .getMaximoDD()
            .getMboSetInfo(objectName)
            .getAttribute(attributeName) != null
    );
}

function getReportId() {
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

    if (
        !resourceReq
            .toLowerCase()
            .startsWith('/oslc/script/' + service.scriptName.toLowerCase())
    ) {
        if (
            !resourceReq
                .toLowerCase()
                .startsWith('/api/script/' + service.scriptName.toLowerCase())
        ) {
            return null;
        } else {
            osOSLC = false;
        }
    }

    var baseReqPath = isOSLC
        ? '/oslc/script/' + service.scriptName
        : '/api/script/' + service.scriptName;

    var action = resourceReq.substring(baseReqPath.length);

    if (action.startsWith('/')) {
        action = action.substring(1);
    }

    if (!action || action.trim() === '') {
        return null;
    }

    return URLDecoder.decode(
        action.toLowerCase(),
        StandardCharsets.UTF_8.name()
    );
}

function checkPermissions(app, optionName) {
    if (!userInfo) {
        throw new ReportError(
            'no_user_info',
            'The userInfo global variable has not been set, therefore the user permissions cannot be verified.'
        );
    }

    if (
        !MXServer.getMXServer()
            .lookup('SECURITY')
            .getProfile(userInfo)
            .hasAppOption(app, optionName) &&
        !isInAdminGroup()
    ) {
        throw new ReportError(
            'no_permission',
            'The user ' +
                userInfo.getUserName() +
                ' does not have access to the ' +
                optionName +
                ' option in the ' +
                app +
                ' object structure.'
        );
    }
}

// Determines if the current user is in the administrator group, returns true if the user is, false otherwise.
function isInAdminGroup() {
    var user = userInfo.getUserName();
    service.log_info(
        'Determining if the user ' + user + ' is in the administrator group.'
    );
    var groupUserSet;

    try {
        groupUserSet = MXServer.getMXServer().getMboSet(
            'GROUPUSER',
            MXServer.getMXServer().getSystemUserInfo()
        );

        // Get the ADMINGROUP MAXVAR value.
        var adminGroup = MXServer.getMXServer()
            .lookup('MAXVARS')
            .getString('ADMINGROUP', null);

        // Query for the current user and the found admin group.
        // The current user is determined by the implicity `user` variable.
        sqlFormat = new SqlFormat('userid = :1 and groupname = :2');
        sqlFormat.setObject(1, 'GROUPUSER', 'USERID', user);
        sqlFormat.setObject(2, 'GROUPUSER', 'GROUPNAME', adminGroup);
        groupUserSet.setWhere(sqlFormat.format());

        if (!groupUserSet.isEmpty()) {
            service.log_info(
                'The user ' +
                    user +
                    ' is in the administrator group ' +
                    adminGroup +
                    '.'
            );
            return true;
        } else {
            service.log_info(
                'The user ' +
                    user +
                    ' is not in the administrator group ' +
                    adminGroup +
                    '.'
            );
            return false;
        }
    } finally {
        _close(groupUserSet);
    }
}

// Cleans up the MboSet connections and closes the set.
function _close(set) {
    if (set) {
        try {
            set.cleanup();
            set.close();
            // eslint-disable-next-line no-empty
        } catch (ignored) {}
    }
}

function ReportError(reason, message) {
    Error.call(this, message);
    this.reason = reason;
    this.message = message;
}

// ReportError derives from Error
ReportError.prototype = Object.create(Error.prototype);
ReportError.prototype.constructor = ReportError;
ReportError.prototype.element;

var scriptConfig = {
    autoscript: 'SHARPTREE.AUTOSCRIPT.REPORT',
    description: 'Report Automation Script for Exporting and Importing Reports',
    version: '1.0.0',
    active: true,
    logLevel: 'ERROR',
};
