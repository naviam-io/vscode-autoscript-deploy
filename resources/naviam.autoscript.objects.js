/* eslint-disable indent */
// @ts-nocheck
/* eslint-disable no-undef */
var MXServer = Java.type('psdi.server.MXServer');

var MboConstants = Java.type('psdi.mbo.MboConstants');
var SqlFormat = Java.type('psdi.mbo.SqlFormat');

// @ts-nocheck
main();

function main() {
    if (typeof request !== 'undefined' && request !== null) {
        checkPermissions('NAVIAM_UTILS', 'DEPLOYSCRIPT');

        var objectType = request.getQueryParam('type');
        var action = request.getQueryParam('action');

        var response = {
            status: 'success',
        };

        if (objectType !== null) {
            if (action == 'list') {
                objectType = objectType.toLowerCase();
                if (objectType === 'messages') {
                    response.data = getMessages();
                } else if (objectType === 'properties') {
                    response.data = getProperties();
                } else if (objectType === 'domains') {
                    response.data = getDomains();
                } else if (objectType === 'crontasks') {
                    response.data = getCronTasks();
                } else if (objectType === 'loggers') {
                    response.data = getLoggers();
                } else if (objectType === 'intobjects') {
                    response.data = getIntObjects();
                }
            } else if (action == 'detail') {
                var id = request.getQueryParam('id');
                if (id != null) {
                    if (objectType === 'messages') {
                        response.data = getMessage(id);
                    } else if (objectType === 'properties') {
                        response.data = getProperty(id);
                    } else if (objectType === 'domains') {
                        response.data = getDomain(id);
                    } else if (objectType === 'crontasks') {
                        response.data = getCronTask(id);
                    } else if (objectType === 'loggers') {
                        response.data = getLogger(id);
                    } else if (objectType === 'intobjects') {
                        response.data = getIntObject(id);
                    }
                } else {
                    response.status = 'error';
                    response.message = 'Required id parameter is missing for action "detail"';
                }
            } else {
                response.status = 'error';
                response.message = 'Unsupported action: ' + action;
            }
        } else {
            response.status = 'error';
            response.message = 'Required type parameter is missing';
        }
        responseBody = JSON.stringify(response);
    }
}

function getIntObjects() {
    var maxIntObjectSet = MXServer.getMXServer().getMboSet('MAXINTOBJECT', MXServer.getMXServer().getSystemUserInfo());
    try {
        maxIntObjectSet.setOrderBy('intobjectname');
        maxIntObjectSet.setFlag(MboConstants.DISCARDABLE, true);
        var maxIntObject = maxIntObjectSet.moveFirst();
        var intObjects = [];
        while (maxIntObject != null) {
            var intObject = {
                id: maxIntObject.getUniqueIDValue(),
                label: maxIntObject.getString('INTOBJECTNAME'),
                description: maxIntObject.getString('DESCRIPTION'),
            };

            intObjects.push(intObject);
            maxIntObject = maxIntObjectSet.moveNext();
        }
        return intObjects;
    } finally {
        _close(maxIntObjectSet);
    }
}

function getIntObject(id) {
    var maxIntObjectSet = MXServer.getMXServer().getMboSet('MAXINTOBJECT', MXServer.getMXServer().getSystemUserInfo());
    try {
        var maxIntObject = maxIntObjectSet.getMboForUniqueId(id);

        if (maxIntObject != null) {
            var intObject = {
                intObjectName: maxIntObject.getString('INTOBJECTNAME'),
                description: maxIntObject.getString('DESCRIPTION'),
                useWith: maxIntObject.getString('USEWITH'),
            };

            if (maxIntObject.getBoolean('QUERYONLY')) {
                intObject.queryOnly = true;
            }

            if (maxIntObject.getBoolean('FLATSUPPORTED')) {
                intObject.flatSupported = true;
            }

            if (maxIntObject.getBoolean('LOADQUERYFROMAPP')) {
                intObject.loadQueryFromApp = true;
            }

            if (maxIntObject.getBoolean('USEOSSECURITY')) {
                intObject.useOSSecurity = true;
            }

            if (maxIntObject.getBoolean('SELFREFERENCING')) {
                intObject.selfReferencing = true;
            }

            if (!maxIntObject.isNull('AUTHAPP')) {
                intObject.authApp = maxIntObject.getString('AUTHAPP');
            }

            if (!maxIntObject.isNull('DEFCLASS')) {
                intObject.defClass = maxIntObject.getString('DEFCLASS');
            }

            if (!maxIntObject.isNull('PROCCLASS')) {
                intObject.procClass = maxIntObject.getString('PROCCLASS');
            }

            if (!maxIntObject.isNull('SEARCHATTRS')) {
                intObject.searchAttrs = maxIntObject.getString('SEARCHATTRS');
            }

            if (!maxIntObject.isNull('RESTRICTWHERE')) {
                intObject.restrictWhere = maxIntObject.getString('RESTRICTWHERE');
            }

            if (!maxIntObject.isNull('MODULE')) {
                intObject.module = maxIntObject.getString('MODULE');
            }

            if (_attributeExists('MAXINTOBJECT', 'AUTOPAGINGTHRESHOLD') && !maxIntObject.getInt('AUTOPAGINGTHRESHOLD') != -1) {
                intObject.autoPagingThreshold = maxIntObject.getInt('AUTOPAGINGTHRESHOLD');
            }

            var maxIntObjDetailSet = maxIntObject.getMboSet('MAXINTOBJDETAIL');
            var maxIntObjDetail = maxIntObjDetailSet.moveFirst();
            if (maxIntObjDetail != null) {
                intObject.maxIntObjDetail = [];
            }

            while (maxIntObjDetail != null) {
                var intObjDetail = {
                    objectName: maxIntObjDetail.getString('OBJECTNAME'),
                };

                if (!maxIntObjDetail.isNull('ALTKEY')) {
                    intObjDetail.altKey = maxIntObjDetail.getString('ALTKEY');
                }

                if (maxIntObjDetail.getBoolean('EXCLUDEBYDEFAULT')) {
                    intObjDetail.excludeByDefault = true;
                }

                if (maxIntObjDetail.getBoolean('SKIPKEYUPDATE')) {
                    intObjDetail.skipKeyUpdate = true;
                }

                if (!maxIntObjDetail.getBoolean('EXCLUDEPARENTKEY')) {
                    intObjDetail.excludeParentKey = false;
                }

                if (!maxIntObjDetail.getBoolean('DELETEONCREATE')) {
                    intObjDetail.deleteOnCreate = false;
                }

                if (maxIntObjDetail.getBoolean('PROPAGATEEVENT')) {
                    intObjDetail.propagateEvent = true;
                }

                if (maxIntObjDetail.getBoolean('INVOKEEXECUTE')) {
                    intObjDetail.invokeExecute = true;
                }

                if (!maxIntObjDetail.isNull('FDRESOURCE')) {
                    intObjDetail.fdResource = maxIntObjDetail.getString('FDRESOURCE');
                }

                if (!maxIntObjDetail.isNull('PARENTOBJNAME')) {
                    intObjDetail.parentObjName = maxIntObjDetail.getString('PARENTOBJNAME');
                }

                if (!maxIntObjDetail.isNull('RELATION')) {
                    intObjDetail.relation = maxIntObjDetail.getString('RELATION');
                }

                if (!maxIntObjDetail.isNull('OBJECTORDER')) {
                    intObjDetail.objectOrder = maxIntObjDetail.getInt('OBJECTORDER');
                }

                var maxIntObjColsSet = maxIntObjDetail.getMboSet('MAXINTOBJCOLS');
                var maxIntObjCols = maxIntObjColsSet.moveFirst();

                if (maxIntObjCols != null) {
                    intObjDetail.maxIntObjCols = [];
                }

                while (maxIntObjCols != null) {
                    var intObjCol = {
                        name: maxIntObjCols.getString('NAME'),
                        intObjFldType: maxIntObjCols.getString('INTOBJFLDTYPE'),
                    };

                    intObjDetail.maxIntObjCols.push(intObjCol);
                    maxIntObjCols = maxIntObjColsSet.moveNext();
                }

                var maxIntObjAliasSet = maxIntObjDetail.getMboSet('MAXINTOBJALIAS');
                var maxIntObjAlias = maxIntObjAliasSet.moveFirst();

                if (maxIntObjAlias != null) {
                    intObjDetail.maxIntObjAlias = [];
                }

                while (maxIntObjAlias != null) {
                    var intObjAlias = {
                        name: maxIntObjAlias.getString('NAME'),
                        aliasName: maxIntObjAlias.getString('ALIASNAME'),
                    };

                    intObjDetail.maxIntObjAlias.push(intObjAlias);
                    maxIntObjAlias = maxIntObjAliasSet.moveNext();
                }

                var objectAppAuthSet = maxIntObjDetail.getMboSet('$objectappauth', 'OBJECTAPPAUTH', '1=1');
                var objectAppAuth = objectAppAuthSet.moveFirst();

                if (objectAppAuth != null) {
                    intObjDetail.objectAppAuth = [];
                }
                while (objectAppAuth != null) {
                    var objAppAuth = {
                        context: objectAppAuth.getString('CONTEXT'),
                        description: objectAppAuth.getString('DESCRIPTION'),
                        objectName: objectAppAuth.getString('OBJECTNAME'),
                        authApp: objectAppAuth.getString('AUTHAPP'),
                    };
                    intObjDetail.objectAppAuth.push(objAppAuth);
                    objectAppAuth = objectAppAuthSet.moveNext();
                }

                intObject.maxIntObjDetail.push(intObjDetail);
                maxIntObjDetail = maxIntObjDetailSet.moveNext();
            }

            var sigOptionSet = maxIntObject.getMboSet('SIGOPTION');
            var sigOption = sigOptionSet.moveFirst();

            if (sigOption != null) {
                intObject.sigOption = [];
            }

            while (sigOption != null) {
                var option = {
                    optionName: sigOption.getString('OPTIONNAME'),
                    description: sigOption.getString('DESCRIPTION'),
                };

                if (!sigOption.isNull('ALSOGRANTS')) {
                    option.alsoGrants = sigOption.getString('ALSOGRANTS');
                }

                if (!sigOption.isNull('ALSOREVOKES')) {
                    option.alsoRevokes = sigOption.getString('ALSOREVOKES');
                }

                if (!sigOption.isNull('PREREQUISITE')) {
                    option.prerequisite = sigOption.getString('PREREQUISITE');
                }

                if (sigOption.getBoolean('ESIGENABLED')) {
                    option.esigEnabled = true;
                }

                if (!sigOption.getBoolean('VISIBLE')) {
                    option.esigEnabled = false;
                }

                intObject.sigOption.push(option);
                sigOption = sigOptionSet.moveNext();
            }

            var osOSLCActionSet = maxIntObject.getMboSet('OSOSLCACTION');
            var osOSLCAction = osOSLCActionSet.moveFirst();

            if (osOSLCAction != null) {
                intObject.osOSLCAction = [];
            }

            while (osOSLCAction != null) {
                var action = {
                    name: osOSLCAction.getString('NAME'),
                    description: osOSLCAction.getString('DESCRIPTION'),
                    implType: osOSLCAction.getString('IMPLTYPE'),
                };

                switch (action.implType) {
                    case 'system':
                        action.systemName = osOSLCAction.getString('SYSTEMNAME');
                        break;
                    case 'script':
                        action.scriptName = osOSLCAction.getString('SCRIPTNAME');
                        break;
                    case 'workflow':
                        action.processName = osOSLCAction.getString('PROCESSNAME');
                        break;
                    case 'wsmethod':
                        action.methodName = osOSLCAction.getString('METHODNAME');
                        break;
                }

                if (!osOSLCAction.isNull('OPTIONNAME')) {
                    action.optionName = osOSLCAction.getString('OPTIONNAME');
                }

                if (!osOSLCAction.isNull('COLLECTION')) {
                    action.collection = osOSLCAction.getString('COLLECTION');
                }

                intObject.osOSLCAction.push(action);

                osOSLCAction = osOSLCActionSet.moveNext();
            }

            var oslcQuerySet = maxIntObject.getMboSet('OSLCQUERY');
            var oslcQuery = oslcQuerySet.moveFirst();

            if (oslcQuery != null) {
                intObject.oslcQuery = [];
            }

            while (oslcQuery != null) {
                var query = {
                    queryType: oslcQuery.getString('QUERYTYPE'),
                };

                switch (query.queryType) {
                    case 'appclause':
                        query.app = oslcQuery.getString('APP');
                        query.clauseName = oslcQuery.getString('CLAUSENAME');

                        break;
                    case 'method':
                        query.method = oslcQuery.getString('METHOD');
                        query.description = oslcQuery.getString('DESCRIPTION');
                        break;
                    case 'osclause':
                        query.clauseName = oslcQuery.getString('CLAUSENAME');
                        query.description = oslcQuery.getString('DESCRIPTION');
                        query.clause = oslcQuery.getString('CLAUSE');
                        query.isPublic = oslcQuery.getBoolean('ISPUBLIC');
                        break;
                    case 'script':
                        query.script = oslcQuery.getString('SCRIPT');
                        break;
                }

                intObject.oslcQuery.push(query);
                oslcQuery = oslcQuerySet.moveNext();
            }

            var queryTemplateSet = maxIntObject.getMboSet('QUERYTEMPLATE');

            var queryTemplate = queryTemplateSet.moveFirst();

            if (queryTemplate != null) {
                intObject.queryTemplate = [];
            }

            while (queryTemplate != null) {
                var template = {
                    templateName: queryTemplate.getString('TEMPLATENAME'),
                    description: queryTemplate.getString('DESCRIPTION'),
                };

                if (!queryTemplate.isNull('PAGESIZE')) {
                    template.pageSize = queryTemplate.getInt('PAGESIZE');
                }

                if (!queryTemplate.isNull('ROLE')) {
                    template.role = queryTemplate.getString('ROLE');
                }
                if (!queryTemplate.isNull('SEARCHATTRIBUTES')) {
                    template.searchAttributes = queryTemplate.getString('SEARCHATTRIBUTES');
                }
                if (!queryTemplate.isNull('TIMELINEATTRIBUTE')) {
                    template.timelineAttributes = queryTemplate.getString('TIMELINEATTRIBUTE');
                }
                if (!queryTemplate.getBoolean('ISPUBLIC')) {
                    template.isPublic = false;
                }

                var queryTemplateAttrSet = queryTemplate.getMboSet('QUERYTEMPLATEATTR');
                var queryTemplateAttr = queryTemplateAttrSet.moveFirst();

                if (queryTemplateAttr != null) {
                    template.queryTemplateAttr = [];
                }

                while (queryTemplateAttr != null) {
                    var attr = {
                        selectAttrName: queryTemplateAttr.getString('SELECTATTRNAME'),
                    };

                    if (!queryTemplateAttr.isNull('TITLE')) {
                        attr.title = queryTemplateAttr.getString('TITLE');
                    }
                    if (!queryTemplateAttr.isNull('SELECTORDER')) {
                        attr.selectOrder = queryTemplateAttr.getInt('SELECTORDER');
                    }
                    if (!queryTemplateAttr.isNull('ALIAS')) {
                        attr.alias = queryTemplateAttr.getString('ALIAS');
                    }
                    if (queryTemplateAttr.getBoolean('SORTBYON')) {
                        attr.sortByOn = true;
                    }
                    if (queryTemplateAttr.getBoolean('ASCENDING')) {
                        attr.ascending = true;
                    }
                    if (!queryTemplateAttr.isNull('SORTBYORDER')) {
                        attr.sortByOrder = queryTemplateAttr.getInt('SORTBYORDER');
                    }
                    template.queryTemplateAttr.push(attr);
                    queryTemplateAttr = queryTemplateAttrSet.moveNext();
                }

                intObject.queryTemplate.push(template);
                queryTemplate = queryTemplateSet.moveNext();
            }

            return intObject;
        }
    } finally {
        _close(maxIntObjectSet);
    }
}

function getLoggers() {
    var maxLoggerSet = MXServer.getMXServer().getMboSet('MAXLOGGER', MXServer.getMXServer().getSystemUserInfo());
    try {
        maxLoggerSet.setOrderBy('logger');
        maxLoggerSet.setFlag(MboConstants.DISCARDABLE, true);
        var maxLogger = maxLoggerSet.moveFirst();
        var loggers = [];
        while (maxLogger != null) {
            var logger = {
                id: maxLogger.getUniqueIDValue(),
                label: maxLogger.getString('LOGGER'),
                description: maxLogger.getString('LOGKEY'),
            };

            loggers.push(logger);

            maxLogger = maxLoggerSet.moveNext();
        }
        return loggers;
    } finally {
        _close(maxLoggerSet);
    }
}

function getLogger(id) {
    var maxLoggerSet = MXServer.getMXServer().getMboSet('MAXLOGGER', MXServer.getMXServer().getSystemUserInfo());
    try {
        var maxLogger = maxLoggerSet.getMboForUniqueId(id);

        if (maxLogger != null) {
            var logger = {
                logger: maxLogger.getString('LOGGER'),
                logKey: maxLogger.getString('LOGKEY'),
                logLevel: maxLogger.getString('LOGLEVEL'),
                active: maxLogger.getBoolean('ACTIVE'),
            };

            var parentLogger = maxLogger.getMboSet('$parentlogger', 'MAXLOGGER', 'maxloggerid=:parentloggerid').moveFirst();

            if (parentLogger != null) {
                logger.parentLogger = parentLogger.getString('LOGGER');
            }

            if (!maxLogger.isNull('APPENDERS')) {
                logger.appenders = maxLogger.getString('APPENDERS');
            }

            return logger;
        }
    } finally {
        _close(maxLoggerSet);
    }
}

function getCronTasks() {
    var cronTaskDefSet = MXServer.getMXServer().getMboSet('CRONTASKDEF', MXServer.getMXServer().getSystemUserInfo());
    try {
        cronTaskDefSet.setOrderBy('CRONTASKNAME');
        cronTaskDefSet.setFlag(MboConstants.DISCARDABLE, true);
        var cronTaskDef = cronTaskDefSet.moveFirst();
        var cronTasks = [];
        while (cronTaskDef != null) {
            var cronTask = {
                id: cronTaskDef.getUniqueIDValue(),
                label: cronTaskDef.getString('CRONTASKNAME'),
                description: cronTaskDef.getString('DESCRIPTION'),
            };

            cronTasks.push(cronTask);

            cronTaskDef = cronTaskDefSet.moveNext();
        }
        return cronTasks;
    } finally {
        _close(cronTaskDefSet);
    }
}

function getCronTask(id) {
    var cronTaskDefSet = MXServer.getMXServer().getMboSet('CRONTASKDEF', MXServer.getMXServer().getSystemUserInfo());
    try {
        var cronTaskDef = cronTaskDefSet.getMboForUniqueId(id);
        if (cronTaskDef != null) {
            var cronTask = {
                cronTaskName: cronTaskDef.getString('CRONTASKNAME'),
                description: cronTaskDef.getString('DESCRIPTION'),
                className: cronTaskDef.getString('CLASSNAME'),
                accessLevel: cronTaskDef.getString('ACCESSLEVEL'),
            };

            var cronTaskInstanceSet = cronTaskDef.getMboSet('CRONTASKINSTANCE');

            var cronTaskInstance = cronTaskInstanceSet.moveFirst();

            if (cronTaskInstance != null) {
                cronTask.cronTaskInstance = [];
            }
            while (cronTaskInstance != null) {
                var instance = {
                    instanceName: cronTaskInstance.getString('INSTANCENAME'),
                    description: cronTaskInstance.getString('DESCRIPTION'),
                    schedule: cronTaskInstance.getString('SCHEDULE'),
                    active: cronTaskInstance.getBoolean('ACTIVE'),
                    keepHistory: cronTaskInstance.getBoolean('KEEPHISTORY'),
                    runAsUserId: cronTaskInstance.getString('RUNASUSERID'),
                    maxHistory: cronTaskInstance.getInt('MAXHISTORY'),
                };

                var cronTaskParamsSet = cronTaskInstance.getMboSet('PARAMETER');
                var cronTaskParam = cronTaskParamsSet.moveFirst();
                if (cronTaskParam != null) {
                    instance.cronTaskParam = [];
                }
                while (cronTaskParam != null) {
                    var param = {
                        parameter: cronTaskParam.getString('PARAMETER'),
                        value: cronTaskParam.getString('VALUE'),
                    };
                    instance.cronTaskParam.push(param);
                    cronTaskParam = cronTaskParamsSet.moveNext();
                }

                cronTask.cronTaskInstance.push(instance);

                cronTaskInstance = cronTaskInstanceSet.moveNext();
            }
            return cronTask;
        }
    } finally {
        _close(cronTaskDefSet);
    }
}

function getDomains() {
    var maxDomainSet = MXServer.getMXServer().getMboSet('MAXDOMAIN', MXServer.getMXServer().getSystemUserInfo());
    try {
        maxDomainSet.setOrderBy('DOMAINID');
        maxDomainSet.setFlag(MboConstants.DISCARDABLE, true);
        var maxDomain = maxDomainSet.moveFirst();
        var domains = [];
        while (maxDomain != null) {
            var domain = {
                id: maxDomain.getUniqueIDValue(),
                label: maxDomain.getString('DOMAINID') + ' (' + maxDomain.getString('DOMAINTYPE') + ')',
                description: maxDomain.getString('DESCRIPTION'),
            };

            domains.push(domain);

            maxDomain = maxDomainSet.moveNext();
        }
        return domains;
    } finally {
        _close(maxDomainSet);
    }
}

function getDomain(id) {
    var maxDomainSet = MXServer.getMXServer().getMboSet('MAXDOMAIN', MXServer.getMXServer().getSystemUserInfo());
    try {
        var maxDomain = maxDomainSet.getMboForUniqueId(id);
        if (maxDomain != null) {
            var domain = {
                domainId: maxDomain.getString('DOMAINID'),
                domainType: maxDomain.getString('DOMAINTYPE'),
                description: maxDomain.getString('DESCRIPTION'),
            };

            if (!maxDomain.isNull('MAXTYPE')) {
                domain.maxType = maxDomain.getString('MAXTYPE');
            }

            if (!maxDomain.isNull('LENGTH')) {
                domain.length = maxDomain.getInt('LENGTH');
            }

            if (!maxDomain.isNull('SCALE')) {
                domain.scale = maxDomain.getInt('SCALE');
            }

            switch (domain.domainType) {
                case 'ALN':
                    domain.alnDomain = [];
                    var aldDomainSet = maxDomain.getMboSet('ALNDOMAINVALUE');
                    var aldDomain = aldDomainSet.moveFirst();
                    while (aldDomain != null) {
                        var value = {
                            value: aldDomain.getString('VALUE'),
                            description: aldDomain.getString('DESCRIPTION'),
                        };

                        if (!aldDomain.isNull('ORGID')) {
                            value.orgId = aldDomain.getString('ORGID');
                        }

                        if (!aldDomain.isNull('SITEID')) {
                            value.siteId = aldDomain.getString('SITEID');
                        }

                        var aldDomainValCondSet = aldDomain.getMboSet('MAXDOMVALCOND');

                        var aldDomainValCond = aldDomainValCondSet.moveFirst();

                        if (aldDomainValCond != null) {
                            value.maxDomValCond = [];
                        }

                        while (aldDomainValCond != null) {
                            var condValue = {
                                conditionNum: aldDomainValCond.getString('CONDITIONNUM'),
                            };

                            if (!aldDomainValCond.isNull('OBJECTNAME')) {
                                condValue.objectName = aldDomainValCond.getString('OBJECTNAME');
                            }

                            value.maxDomValCond.push(condValue);

                            aldDomainValCond = aldDomainValCondSet.moveNext();
                        }

                        domain.alnDomain.push(value);
                        aldDomain = aldDomainSet.moveNext();
                    }

                    break;
                case 'NUMERIC':
                    domain.numericDomain = [];
                    var numericDomainSet = maxDomain.getMboSet('NUMDOMAINVALUE');
                    var numericDomain = numericDomainSet.moveFirst();
                    while (numericDomain != null) {
                        var numericValue = {
                            value: numericDomain.getString('VALUE'),
                            description: numericDomain.getString('DESCRIPTION'),
                        };

                        if (!numericDomain.isNull('ORGID')) {
                            numericValue.orgId = numericDomain.getString('ORGID');
                        }

                        if (!numericDomain.isNull('SITEID')) {
                            numericValue.siteId = numericDomain.getString('SITEID');
                        }

                        numericDomainValCondSet = numericDomain.getMboSet('MAXDOMVALCOND');

                        numericDomainValCond = numericDomainValCondSet.moveFirst();

                        if (numericDomainValCond != null) {
                            numericValue.maxDomValCond = [];
                        }

                        while (numericDomainValCond != null) {
                            var numericCondValue = {
                                conditionNum: numericDomainValCond.getString('CONDITIONNUM'),
                            };

                            if (!numericDomainValCond.isNull('OBJECTNAME')) {
                                numericCondValue.objectName = numericDomainValCond.getString('OBJECTNAME');
                            }

                            numericValue.maxDomValCond.push(numericCondValue);

                            numericDomainValCond = numericDomainValCondSet.moveNext();
                        }

                        domain.numericDomain.push(numericValue);
                        numericDomain = numericDomainSet.moveNext();
                    }

                    break;
                case 'NUMRANGE':
                    domain.numRangeDomain = [];
                    var numRangeDomainSet = maxDomain.getMboSet('RANGEDOMSEGMENT');
                    var numRangeDomain = numRangeDomainSet.moveFirst();
                    while (numRangeDomain != null) {
                        var numRangeValue = {
                            rangeSegment: numRangeDomain.getString('RANGESEGMENT'),
                            rangeMinimum: numRangeDomain.getString('RANGEMINIMUM'),
                            rangeMaximum: numRangeDomain.getString('RANGEMAXIMUM'),
                            rangeInterval: numRangeDomain.getString('RANGEINTERVAL'),
                        };

                        if (!numRangeDomain.isNull('ORGID')) {
                            numRangeValue.orgId = numRangeDomain.getString('ORGID');
                        }

                        if (!numRangeDomain.isNull('SITEID')) {
                            numRangeValue.siteId = numRangeDomain.getString('SITEID');
                        }

                        domain.numRangeDomain.push(numRangeValue);
                        numRangeDomain = numRangeDomainSet.moveNext();
                    }
                    break;
                case 'SYNONYM':
                    domain.synonymDomain = [];
                    var synonymDomainSet = maxDomain.getMboSet('SYNONYMDOMAIN');
                    var synonymDomain = synonymDomainSet.moveFirst();
                    while (synonymDomain != null) {
                        var synonymValue = {
                            value: synonymDomain.getString('VALUE'),
                            maxValue: synonymDomain.getString('MAXVALUE'),
                            description: synonymDomain.getString('DESCRIPTION'),
                            defaults: synonymDomain.getBoolean('DEFAULTS'),
                        };

                        if (!synonymDomain.isNull('ORGID')) {
                            synonymValue.orgId = synonymDomain.getString('ORGID');
                        }

                        if (!synonymDomain.isNull('SITEID')) {
                            synonymValue.siteId = synonymDomain.getString('SITEID');
                        }

                        var synonymDomainValCondSet = synonymDomain.getMboSet('MAXDOMVALCOND');

                        var synonymDomainValCond = synonymDomainValCondSet.moveFirst();

                        if (synonymDomainValCond != null) {
                            synonymValue.maxDomValCond = [];
                        }

                        while (synonymDomainValCond != null) {
                            var synonymCondValue = {
                                conditionNum: synonymDomainValCond.getString('CONDITIONNUM'),
                            };

                            if (!synonymDomainValConnd.isNull('OBJECTNAME')) {
                                synonymCondValue.objectName = synonymDomainValCond.getString('OBJECTNAME');
                            }

                            synonymValue.maxDomValCond.push(synonymCondValue);

                            synonymDomainValCond = synonymDomainValCondSet.moveNext();
                        }

                        domain.synonymDomain.push(synonymValue);
                        synonymDomain = synonymDomainSet.moveNext();
                    }

                    break;
                case 'TABLE':
                    domain.tableDomain = [];
                    var maxTableDomainSet = maxDomain.getMboSet('MAXTABLEDOMAIN');
                    var maxTableDomain = maxTableDomainSet.moveFirst();
                    while (maxTableDomain != null) {
                        var tableDomainValue = {
                            objectName: maxTableDomain.getString('OBJECTNAME'),
                        };

                        if (!maxTableDomain.isNull('VALIDTNWHERECLAUSE')) {
                            tableDomainValue.validtnWhereClause = maxTableDomain.getString('VALIDTNWHERECLAUSE');
                        }

                        if (!maxTableDomain.isNull('LISTWHERECLAUSE')) {
                            tableDomainValue.listWhereClause = maxTableDomain.getString('LISTWHERECLAUSE');
                        }

                        if (!maxTableDomain.isNull('ERRORRESOURCBUNDLE')) {
                            tableDomainValue.errorResourceBundle = maxTableDomain.getString('ERRORRESOURCBUNDLE');
                        }

                        if (!maxTableDomain.isNull('ERRORACCESSKEY')) {
                            tableDomainValue.errorAccessKey = maxTableDomain.getString('ERRORACCESSKEY');
                        }

                        if (!maxTableDomain.isNull('ORGID')) {
                            tableDomainValue.orgId = maxTableDomain.getString('ORGID');
                        }

                        if (!maxTableDomain.isNull('SITEID')) {
                            tableDomainValue.siteId = maxTableDomain.getString('SITEID');
                        }

                        domain.tableDomain.push(tableDomainValue);
                        maxTableDomain = maxTableDomainSet.moveNext();
                    }

                    break;
                case 'CROSSOVER':
                    domain.crossoverDomain = [];
                    var crossoverDomainSet = maxDomain.getMboSet('MAXTABLEDOMAIN');
                    var crossoverDomain = crossoverDomainSet.moveFirst();
                    while (crossoverDomain != null) {
                        var crossoverDomainValue = {
                            objectName: crossoverDomain.getString('OBJECTNAME'),
                        };

                        if (!crossoverDomain.isNull('VALIDTNWHERECLAUSE')) {
                            crossoverDomainValue.validtnWhereClause = crossoverDomain.getString('VALIDTNWHERECLAUSE');
                        }

                        if (!crossoverDomain.isNull('LISTWHERECLAUSE')) {
                            crossoverDomainValue.listWhereClause = crossoverDomain.getString('LISTWHERECLAUSE');
                        }

                        if (!crossoverDomain.isNull('ERRORRESOURCBUNDLE')) {
                            crossoverDomainValue.errorResourceBundle = crossoverDomain.getString('ERRORRESOURCBUNDLE');
                        }

                        if (!crossoverDomain.isNull('ERRORACCESSKEY')) {
                            crossoverDomainValue.errorAccessKey = crossoverDomain.getString('ERRORACCESSKEY');
                        }

                        if (!crossoverDomain.isNull('ORGID')) {
                            crossoverDomainValue.orgId = crossoverDomain.getString('ORGID');
                        }

                        if (!crossoverDomain.isNull('SITEID')) {
                            crossoverDomainValue.siteId = crossoverDomain.getString('SITEID');
                        }

                        var crossoverDomainFieldsSet = crossoverDomain.getMboSet('CROSSOVERDOMAIN');
                        var crossoverDomainField = crossoverDomainFieldsSet.moveFirst();

                        if (crossoverDomainField != null) {
                            crossoverDomainValue.crossoverFields = [];
                        }

                        while (crossoverDomainField != null) {
                            var field = {
                                sourceField: crossoverDomainField.getString('SOURCEFIELD'),
                                destField: crossoverDomainField.getString('DESTFIELD'),
                            };

                            if (crossoverDomainField.getBoolean('COPYEVENIFSRCNULL')) {
                                field.copyEvenIfSrcNull = true;
                            }

                            if (crossoverDomainField.getBoolean('COPYONLYIFDESTNULL')) {
                                field.copyOnlyIfDestNull = true;
                            }

                            if (!crossoverDomainField.isNull('SOURCECONDITION')) {
                                field.sourceCondition = crossoverDomainField.getString('SOURCECONDITION');
                            }

                            if (!crossoverDomainField.isNull('DESTCONDITION')) {
                                field.destCondition = crossoverDomainField.getString('DESTCONDITION');
                            }

                            if (!crossoverDomainField.isNull('SEQUENCE')) {
                                field.sequence = crossoverDomainField.getInt('SEQUENCE');
                            }
                            crossoverDomainValue.crossoverFields.push(field);
                            crossoverDomainField = crossoverDomainFieldsSet.moveNext();
                        }

                        domain.crossoverDomain.push(crossoverDomainValue);
                        crossoverDomain = crossoverDomainSet.moveNext();
                    }
                    break;
            }

            return domain;
        }
    } finally {
        _close(maxDomainSet);
    }
}

function getProperties() {
    var maxPropSet = MXServer.getMXServer().getMboSet('MAXPROP', MXServer.getMXServer().getSystemUserInfo());

    var properties = [];
    try {
        var sqlf = new SqlFormat('propname != :1');
        sqlf.setObject(1, 'MAXPROP', 'PROPNAME', 'mxe.sec.header.Content_Security_Policy');
        maxPropSet.setWhere(sqlf.format());
        maxPropSet.setOrderBy('PROPNAME');

        maxPropSet.setFlag(MboConstants.DISCARDABLE, true);
        var maxProp = maxPropSet.moveFirst();

        while (maxProp != null) {
            var property = {
                id: maxProp.getUniqueIDValue(),
                label: maxProp.getString('PROPNAME'),
                description: maxProp.getString('DESCRIPTION'),
            };

            properties.push(property);

            maxProp = maxPropSet.moveNext();
        }

        return properties;
    } finally {
        _close(maxPropSet);
    }
}

function getProperty(id) {
    if (id != null) {
        var maxPropSet = MXServer.getMXServer().getMboSet('MAXPROP', MXServer.getMXServer().getSystemUserInfo());
        try {
            var maxProp = maxPropSet.getMboForUniqueId(id);
            if (maxProp != null) {
                var property = {
                    propName: maxProp.getString('PROPNAME'),
                    description: maxProp.getString('DESCRIPTION'),
                    propValue: maxProp.getString('DISPPROPVALUE'),
                    maxPropInstance: [],
                };

                if (!maxProp.isNull('DOMAINID')) {
                    property.domainId = maxProp.getString('DOMAINID');
                }

                if (maxProp.getBoolean('ENCRYPTED')) {
                    property.encrypted = maxProp.getBoolean('ENCRYPTED');
                }

                if (maxProp.getBoolean('GLOBALONLY')) {
                    property.globalOnly = maxProp.getBoolean('GLOBALONLY');
                }

                if (maxProp.getBoolean('INSTANCEONLY')) {
                    property.instanceOnly = maxProp.getBoolean('INSTANCEONLY');
                }

                if (!maxProp.getBoolean('LIVEREFRESH')) {
                    property.liveRefresh = maxProp.getBoolean('LIVEREFRESH');
                }

                if (maxProp.getBoolean('MASKED')) {
                    property.masked = maxProp.getBoolean('MASKED');
                }

                if (!maxProp.getBoolean('NULLSALLOWED')) {
                    property.nullsAllowed = maxProp.getBoolean('NULLSALLOWED');
                }

                if (!maxProp.getBoolean('ONLINECHANGES')) {
                    property.onlineChanges = maxProp.getBoolean('ONLINECHANGES');
                }

                if (!maxProp.getString('MAXTYPE') !== 'ALN') {
                    property.maxType = maxProp.getString('MAXTYPE');
                }

                if (!maxProp.getString('SECURELEVEL') !== 'PUBLIC') {
                    property.secureLevel = maxProp.getString('SECURELEVEL');
                }

                if (!maxProp.isNull('MAXIMODEFAULT')) {
                    property.maximoDefault = maxProp.getString('MAXIMODEFAULT');
                }

                var maxPropInstanceSet = maxProp.getMboSet('MAXPROPINSTANCE');

                var maxPropInstance = maxPropInstanceSet.moveFirst();

                while (maxPropInstance != null) {
                    var instance = {
                        serverName: maxPropInstance.getString('SERVERNAME'),
                        propValue: maxPropInstance.getString('DISPPROPVALUE'),
                        serverHost: maxPropInstance.getString('SERVERHOST'),
                    };

                    property.maxPropInstance.push(instance);

                    maxPropInstance = maxPropInstanceSet.moveNext();
                }

                if (property.maxPropInstance.length === 0) {
                    delete property.maxPropInstance;
                }

                return property;
            }
        } finally {
            _close(maxPropSet);
        }
    }
}

function getMessage(id) {
    if (id != null) {
        var maxMessageSet = MXServer.getMXServer().getMboSet('MAXMESSAGES', MXServer.getMXServer().getSystemUserInfo());
        try {
            var maxMessage = maxMessageSet.getMboForUniqueId(id);
            if (maxMessage != null) {
                var message = {
                    msgGroup: maxMessage.getString('MSGGROUP'),
                    msgKey: maxMessage.getString('MSGKEY'),
                    value: maxMessage.getString('VALUE'),
                    displayMethod: maxMessage.getString('DISPLAYMETHOD'),
                    prefix: maxMessage.getString('MSGIDPREFIX'),
                    suffix: maxMessage.getString('MSGIDSUFFIX'),
                    options: [],
                };

                if (!maxMessage.isNull('EXPLANATION')) {
                    message.explanation = maxMessage.getString('EXPLANATION');
                }

                if (!maxMessage.isNull('ADMINRESPONSE')) {
                    message.adminResponse = maxMessage.getString('ADMINRESPONSE');
                }
                if (!maxMessage.isNull('SYSTEMACTION')) {
                    message.systemAction = maxMessage.getString('SYSTEMACTION');
                }

                if (maxMessage.getBoolean('OK')) {
                    message.options.push('ok');
                }

                if (maxMessage.getBoolean('CLOSE')) {
                    message.options.push('close');
                }

                if (maxMessage.getBoolean('CANCEL')) {
                    message.options.push('cancel');
                }

                if (maxMessage.getBoolean('YES')) {
                    message.options.push('yes');
                }

                if (maxMessage.getBoolean('NO')) {
                    message.options.push('no');
                }

                return message;
            }
        } finally {
            _close(maxMessageSet);
        }
    }
}

function getMessages() {
    var maxMessageSet = MXServer.getMXServer().getMboSet('MAXMESSAGES', MXServer.getMXServer().getSystemUserInfo());

    var messages = [];
    try {
        maxMessageSet.setFlag(MboConstants.READONLY, false);
        maxMessageSet.setFlag(MboConstants.DISCARDABLE, true);
        maxMessageSet.setOrderBy('MSGGROUP, MSGKEY');
        var maxMessage = maxMessageSet.getMbo(0);

        while (maxMessage != null) {
            var message = {
                id: maxMessage.getUniqueIDValue(),
                label: maxMessage.getString('MSGGROUP') + ':' + maxMessage.getString('MSGKEY'),
                description: maxMessage.getString('VALUE'),
            };

            messages.push(message);

            maxMessage = maxMessageSet.moveNext();
        }

        return messages;
    } finally {
        _close(maxMessageSet);
    }
}

function _attributeExists(objectName, attributeName) {
    var msi = MXServer.getMXServer().getMaximoDD().getMboSetInfo(objectName);

    if (msi != null) {
        return msi.getMboValueInfo(attributeName) != null;
    } else {
        return false;
    }
}

function checkPermissions(app, optionName) {
    if (!userInfo) {
        throw new AdminError('no_user_info', 'The userInfo global variable has not been set, therefore the user permissions cannot be verified.');
    }

    var userProfile = MXServer.getMXServer().lookup('SECURITY').getProfile(userInfo);

    if (!userProfile.hasAppOption(app, optionName) && !isInAdminGroup()) {
        throw new AdminError(
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

function _close(mboSet) {
    if (mboSet != null && mboSet instanceof Java.type('psdi.mbo.MboSet')) {
        mboSet.close();
        mboSet.cleanup();
    }
}
// eslint-disable-next-line no-unused-vars
var scriptConfig = {
    autoscript: 'NAVIAM.AUTOSCRIPT.OBJECTS',
    description: 'Naviam Script to extract JSON object configurations.',
    version: '1.0.0',
    active: true,
    logLevel: 'ERROR',
};
