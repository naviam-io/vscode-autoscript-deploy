/* eslint-disable indent */
// @ts-nocheck
/* eslint-disable no-undef */
var DBShortcut = Java.type('psdi.mbo.DBShortcut');
var HashMap = Java.type('java.util.HashMap');
var MXServer = Java.type('psdi.server.MXServer');

var ScriptCache = Java.type('com.ibm.tivoli.maximo.script.ScriptCache');
var ScriptDriverFactory = Java.type('com.ibm.tivoli.maximo.script.ScriptDriverFactory');
var SqlFormat = Java.type('psdi.mbo.SqlFormat');

var LIBRARY_SCRIPT = 'NAVIAM.AUTOSCRIPT.LIBRARY';
var libraryExports = null;

/** Runs the library script with the given context, which it reads its input from and writes its output to. */
function runLibrary(context) {
    if (!ScriptCache.getInstance().getScriptInfo(LIBRARY_SCRIPT)) {
        throw new Error('The ' + LIBRARY_SCRIPT + ' script is not installed. Deploy the Maximo Development Tools scripts, then try again.');
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
 * The internal value of a stored synonym domain value, for extraction logic that depends on it.
 * Extraction writes the stored localized value, see docs/modules/nashorn-library.md.
 */
function toInternalSynonymValue(domainId, value, mbo) {
    return library().toInternalSynonymValue(domainId, value, mbo);
}

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
            objectType = objectType.toLowerCase();
            if (action == 'list') {
                if (objectType === 'messages') {
                    response.data = getMessages();
                } else if (objectType === 'actions') {
                    response.data = getActions();
                } else if (objectType === 'properties') {
                    response.data = getProperties();
                } else if (objectType === 'domains') {
                    response.data = getDomains();
                } else if (objectType === 'crontasks') {
                    response.data = getCronTasks();
                } else if (objectType === 'escalations') {
                    response.data = getEscalations();
                } else if (objectType === 'loggers') {
                    response.data = getLoggers();
                } else if (objectType === 'integrationobjects') {
                    response.data = getIntObjects();
                } else if (objectType === 'queries') {
                    response.data = getQueries();
                } else if (objectType === 'endpoints') {
                    response.data = getEndPoints();
                } else if (objectType === 'publishchannels') {
                    response.data = getPublishChannels();
                } else if (objectType === 'enterpriseservices') {
                    response.data = getEnterpriseServices();
                } else if (objectType === 'externalsystems') {
                    response.data = getExternalSystems();
                } else if (objectType === 'objects') {
                    response.data = getMaximoObjects();
                }
            } else if (action == 'detail') {
                var id = request.getQueryParam('id');
                if (id != null) {
                    response.data = getObjectDetail(objectType, id);
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
    } else if (typeof extractType !== 'undefined' && extractType !== null && typeof extractId !== 'undefined' && extractId !== null) {
        // Invoked by another server side script rather than over REST. The deployment capture phase
        // uses this so that a snapshot of an existing record is byte for byte what extract produces.
        //
        // No permission check here on purpose: this path is unreachable over REST, because request is
        // non-null there and extractType is never set, and the only caller is the deploy script, which
        // has already checked the caller's permissions.
        //
        // The result is handed back as a JSON string rather than an object, so that nothing depends on
        // how a Nashorn object is marshalled across a script boundary. The caller persists it as text.
        var extracted = getObjectDetail(String(extractType).toLowerCase(), extractId);
        extractResult = typeof extracted === 'undefined' || extracted === null ? null : JSON.stringify(extracted);
    }
}

/**
 * Returns the full configuration of a single object, in the same shape a deployment payload carries.
 *
 * Shared by the REST entry point and by the server side entry point that a deployment's capture
 * phase uses, so that a captured snapshot and an extracted configuration can never drift apart.
 *
 * The caller is responsible for lower casing objectType before calling; this function does not
 * normalise it.
 *
 * @param {string} objectType the object type, lower cased
 * @param {string} id the unique id of the record
 * @returns {object|undefined} the configuration, or undefined when the type or the record is unknown
 */
function getObjectDetail(objectType, id) {
    if (objectType === 'messages') {
        return getMessage(id);
    } else if (objectType === 'actions') {
        return getAction(id);
    } else if (objectType === 'properties') {
        return getProperty(id);
    } else if (objectType === 'domains') {
        return getDomain(id);
    } else if (objectType === 'crontasks') {
        return getCronTask(id);
    } else if (objectType === 'escalations') {
        return getEscalation(id);
    } else if (objectType === 'loggers') {
        return getLogger(id);
    } else if (objectType === 'integrationobjects') {
        return getIntObject(id);
    } else if (objectType === 'queries') {
        return getQuery(id);
    } else if (objectType === 'endpoints') {
        return getEndPoint(id);
    } else if (objectType === 'publishchannels') {
        return getPublishChannel(id);
    } else if (objectType === 'enterpriseservices') {
        return getEnterpriseService(id);
    } else if (objectType === 'externalsystems') {
        return getExternalSystem(id);
    } else if (objectType === 'objects') {
        return getMaximoObject(id);
    }

    return undefined;
}

function getActions() {
    return _listRecords('ACTION', ['ACTION', 'DESCRIPTION'], 'ACTION');
}

function getAction(id) {
    var actionSet = MXServer.getMXServer().getMboSet('ACTION', MXServer.getMXServer().getSystemUserInfo());
    try {
        var actionMbo = actionSet.getMboForUniqueId(id);

        if (actionMbo != null) {
            var action = {
                action: actionMbo.getString('ACTION'),
                description: actionMbo.getString('DESCRIPTION'),
                type: actionMbo.getString('TYPE'),
                useWith: actionMbo.getString('USEWITH'),
            };
            var actionType = toInternalSynonymValue('ACTIONTYPE', action.type, actionMbo);

            if (!actionMbo.isNull('SENDERSYSID')) {
                action.senderSysId = actionMbo.getString('SENDERSYSID');
            }

            if (actionType === 'CUSTOM') {
                if (!actionMbo.isNull('VALUE')) {
                    action.value = actionMbo.getString('VALUE');
                }
            } else if (!actionMbo.isNull('VALUE2')) {
                action.value = actionMbo.getString('VALUE2');
            }

            if (!actionMbo.isNull('OBJECTNAME')) {
                action.objectName = actionMbo.getString('OBJECTNAME');
            }

            if (actionType !== 'GROUP') {
                if (!actionMbo.isNull('PARAMETER')) {
                    action.parameter = actionMbo.getString('PARAMETER');
                }
            }

            if (actionType === 'CHANGESTATUS' && !actionMbo.isNull('MEMO')) {
                action.memo = actionMbo.getString('MEMO');
            }

            var actionGroupSet = actionMbo.getMboSet('ACTION_MEMBERS');
            var actionGroupMbo = actionGroupSet.moveFirst();

            if (actionGroupMbo != null) {
                action.actionGroup = [];
            }

            while (actionGroupMbo != null) {
                var group = {
                    member: actionGroupMbo.getString('MEMBER'),
                    sequence: actionGroupMbo.getInt('SEQUENCE'),
                };

                action.actionGroup.push(group);
                actionGroupMbo = actionGroupSet.moveNext();
            }

            return action;
        }
    } finally {
        _close(actionSet);
    }
}

function getQueries() {
    return _listRecords('QUERY', ['APP', 'CLAUSENAME', 'DESCRIPTION'], 'APP, CLAUSENAME, OWNER', function (values) {
        return { label: values[0] + ': ' + values[1], description: values[2] };
    });
}

function getQuery(id) {
    var querySet = MXServer.getMXServer().getMboSet('QUERY', MXServer.getMXServer().getSystemUserInfo());
    try {
        var queryMbo = querySet.getMboForUniqueId(id);

        if (queryMbo != null) {
            var query = {
                app: queryMbo.getString('APP'),
                clause: queryMbo.getString('CLAUSE'),
                clauseName: queryMbo.getString('CLAUSENAME'),
                description: queryMbo.getString('DESCRIPTION'),
                isPublic: queryMbo.getBoolean('ISPUBLIC'),
                isUserList: queryMbo.getBoolean('ISUSERLIST'),
                owner: queryMbo.getString('OWNER'),
            };

            if (!queryMbo.isNull('INTOBJECTNAME')) {
                query.intObjectName = queryMbo.getString('INTOBJECTNAME');
            }

            if (!queryMbo.isNull('NOTES')) {
                query.notes = queryMbo.getString('NOTES');
            }

            if (!queryMbo.isNull('PRIORITY')) {
                query.priority = queryMbo.getInt('PRIORITY');
            }

            return query;
        }
    } finally {
        _close(querySet);
    }
}

function getEndPoints() {
    return _listRecords('MAXENDPOINT', ['ENDPOINTNAME', 'DESCRIPTION'], 'ENDPOINTNAME');
}

/** An encrypted property, whose VALUE is read only, is extracted as its decrypted PASSWORD. */
function getEndPoint(id) {
    var endPointSet = MXServer.getMXServer().getMboSet('MAXENDPOINT', MXServer.getMXServer().getSystemUserInfo());
    try {
        var endPointMbo = endPointSet.getMboForUniqueId(id);

        if (endPointMbo != null) {
            var endPoint = {
                endPointName: endPointMbo.getString('ENDPOINTNAME'),
                description: endPointMbo.getString('DESCRIPTION'),
                handlerName: endPointMbo.getString('HANDLERNAME'),
            };

            var properties = _getChildren(endPointMbo, 'MAXENDPOINTDTL', null, 'PROPERTY', function (detail) {
                var property = { property: detail.getString('PROPERTY') };
                if (detail.getMboValueData('VALUE').isReadOnly()) {
                    property.password = detail.getString('PASSWORD');
                } else {
                    property.value = detail.getString('VALUE');
                }
                property.allowOverride = detail.getBoolean('ALLOWOVERRIDE');
                return property;
            });

            if (properties.length > 0) {
                endPoint.properties = properties;
            }

            return endPoint;
        }
    } finally {
        _close(endPointSet);
    }
}

function getPublishChannels() {
    return _listRecords('MAXIFACEOUT', ['IFACENAME', 'DESCRIPTION'], 'IFACENAME');
}

function getPublishChannel(id) {
    var channelSet = MXServer.getMXServer().getMboSet('MAXIFACEOUT', MXServer.getMXServer().getSystemUserInfo());
    try {
        var channelMbo = channelSet.getMboForUniqueId(id);

        if (channelMbo != null) {
            var channel = { ifaceName: channelMbo.getString('IFACENAME'), intObjectName: channelMbo.getString('INTOBJECTNAME') };
            _putValues(channel, channelMbo, [
                ['description', 'DESCRIPTION'],
                ['listener', 'LISTENER', 'boolean'],
                ['publishJson', 'PUBLISHJSON', 'boolean'],
                ['retainMbos', 'RETAINMBOS', 'boolean'],
                ['skipDiffObject', 'SKIPDIFFOBJECT', 'boolean'],
                ['storeMsg', 'STOREMSG', 'boolean'],
                ['useTxnTracking', 'USETXNTRACKING', 'boolean'],
                ['eventFilterClass', 'EVENTFILTERCLASS'],
                ['extMsgIdField', 'EXTMSGIDFIELD'],
                ['ifaceExitClass', 'IFACEEXITCLASS'],
                ['ifaceMapName', 'IFACEMAPNAME'],
                ['ifaceUserExitClass', 'IFACEUSEREXITCLASS'],
                ['ifaceTbName', 'IFACETBNAME'],
                ['searchField', 'SEARCHFIELD'],
                ['templateName', 'TEMPLATENAME'],
            ]);

            var controls = _getChildren(channelMbo, 'MAXIFACEOUTCNTL', null, 'IFACECONTROL', function (control) {
                return { control: control.getString('IFACECONTROL') };
            });
            if (controls.length > 0) {
                channel.integrationControls = controls;
            }

            var rules = _getProcessingRules(channelMbo, 'MAXIFACEPROC');
            if (rules.length > 0) {
                channel.processingRules = rules;
            }

            var objectStructure = channelMbo.getMboSet('$OBJECTSTRUCTURE', 'MAXINTOBJECT', 'intobjectname = :intobjectname').moveFirst();
            if (objectStructure != null && objectStructure.getBoolean('USERDEFINED')) {
                delete channel.intObjectName;
                channel.objectStructure = getIntObject(objectStructure.getUniqueIDValue());
            }

            return channel;
        }
    } finally {
        _close(channelSet);
    }
}

function getEnterpriseServices() {
    return _listRecords('MAXIFACEIN', ['IFACENAME', 'DESCRIPTION'], 'IFACENAME');
}

function getEnterpriseService(id) {
    var serviceSet = MXServer.getMXServer().getMboSet('MAXIFACEIN', MXServer.getMXServer().getSystemUserInfo());
    try {
        var serviceMbo = serviceSet.getMboForUniqueId(id);

        if (serviceMbo != null) {
            var service = { ifaceName: serviceMbo.getString('IFACENAME'), intObjectName: serviceMbo.getString('INTOBJECTNAME') };
            _putValues(service, serviceMbo, [
                ['description', 'DESCRIPTION'],
                ['ifaceType', 'IFACETYPE'],
                ['messageType', 'MESSAGETYPE'],
                ['ifaceControl', 'IFACECONTROL'],
                ['ifaceTbName', 'IFACETBNAME'],
                ['useExternalSchema', 'USEEXTERNALSCHEMA', 'boolean'],
                ['splitTag', 'SPLITTAG'],
                ['schemaLocation', 'SCHEMALOCATION'],
                ['elementName', 'ELEMENTNAME'],
                ['replySchemaLoc', 'REPLYSCHEMALOC'],
                ['replyElementName', 'REPLYELEMENTNAME'],
                ['ifaceExitClass', 'IFACEEXITCLASS'],
                ['ifaceUserExitClass', 'IFACEUSEREXITCLASS'],
                ['ifaceMapName', 'IFACEMAPNAME'],
                ['replyExitClass', 'REPLYEXITCLASS'],
                ['replyUserExitClass', 'REPLYUSEREXITCLASS'],
                ['replyMapName', 'REPLYMAPNAME'],
                ['useTxnTracking', 'USETXNTRACKING', 'boolean'],
                ['storeMsg', 'STOREMSG', 'boolean'],
                ['extMsgIdField', 'EXTMSGIDFIELD'],
                ['searchField', 'SEARCHFIELD'],
                ['interpreterClass', 'INTERPRETERCLASS'],
            ]);

            var structures = _getChildren(serviceMbo, 'MAXIFACEINDETAIL', null, 'IFACEMAPORDER', function (detailMbo) {
                var detail = { intObjectName: detailMbo.getString('INTOBJECTNAME') };
                _putValues(detail, detailMbo, [
                    ['ifaceMapOrder', 'IFACEMAPORDER', 'int'],
                    ['ifaceExitClass', 'IFACEEXITCLASS'],
                    ['ifaceUserExitClass', 'IFACEUSEREXITCLASS'],
                    ['ifaceMapName', 'IFACEMAPNAME'],
                    ['ifaceControl', 'IFACECONTROL'],
                ]);
                return detail;
            });
            if (structures.length > 0) {
                service.additionalObjectStructures = structures;
            }

            var properties = _getChildren(serviceMbo, 'MAXIFACETYPEPROP', null, 'PARAM', function (propertyMbo) {
                var property = { param: propertyMbo.getString('PARAM') };
                _putValues(property, propertyMbo, [
                    ['value', 'VALUE'],
                    ['isXmlTag', 'ISXMLTAG', 'boolean'],
                ]);
                return property;
            });
            if (properties.length > 0) {
                service.gatewayProperties = properties;
            }

            var controls = _getChildren(serviceMbo, 'MAXIFACEINCNTLDETAIL', null, 'IFACECONTROL', function (control) {
                return { control: control.getString('IFACECONTROL') };
            });
            if (controls.length > 0) {
                service.integrationControls = controls;
            }

            // MAXIFACEPROC holds both kinds of rules, which the screens show on separate tabs.
            var rules = _getProcessingRules(serviceMbo, 'MAXIFACEPROC', 'ESOBJECTSTRUCTURE');
            if (rules.length > 0) {
                service.processingRules = rules;
            }

            var objectRules = _getProcessingRules(serviceMbo, 'MAXIFACEPROC', 'ESOBJECT');
            if (objectRules.length > 0) {
                service.objectProcessingRules = objectRules;
            }

            var objectStructure = serviceMbo.getMboSet('$OBJECTSTRUCTURE', 'MAXINTOBJECT', 'intobjectname = :intobjectname').moveFirst();
            if (objectStructure != null && objectStructure.getBoolean('USERDEFINED')) {
                delete service.intObjectName;
                service.objectStructure = getIntObject(objectStructure.getUniqueIDValue());
            }

            return service;
        }
    } finally {
        _close(serviceSet);
    }
}

function getExternalSystems() {
    return _listRecords('MAXEXTSYSTEM', ['EXTSYSNAME', 'DESCRIPTION'], 'EXTSYSNAME');
}

function getExternalSystem(id) {
    var systemSet = MXServer.getMXServer().getMboSet('MAXEXTSYSTEM', MXServer.getMXServer().getSystemUserInfo());
    try {
        var systemMbo = systemSet.getMboForUniqueId(id);

        if (systemMbo != null) {
            var system = { extSysName: systemMbo.getString('EXTSYSNAME') };
            _putValues(system, systemMbo, [
                ['description', 'DESCRIPTION'],
                ['endPointName', 'ENDPOINTNAME'],
                ['langCode', 'LANGCODE'],
                ['bidiConfig', 'BIDICONFIG'],
                ['jmsMsgEncoding', 'JMSMSGENCODING'],
                ['outSeqQueueName', 'OUTSEQQUEUENAME'],
                ['outContQueueName', 'OUTCONTQUEUENAME'],
                ['inSeqQueueName', 'INSEQQUEUENAME'],
                ['inContQueueName', 'INCONTQUEUENAME'],
                ['enabled', 'ENABLED', 'boolean'],
            ]);

            var channels = _getChildren(systemMbo, 'MAXEXTIFACEOUT', null, 'IFACENAME', function (linkMbo) {
                var link = _getExternalSystemLink(linkMbo, 'MAXIFACEOUT', 'publishChannel', getPublishChannel);
                _putValues(link, linkMbo, [
                    ['enabled', 'ENABLED', 'boolean'],
                    ['endPointName', 'ENDPOINTNAME'],
                ]);
                if (!linkMbo.isNull('ISCONTINUOUSQUEUE')) {
                    link.isContinuousQueue = linkMbo.getBoolean('ISCONTINUOUSQUEUE');
                }
                return link;
            });
            if (channels.length > 0) {
                system.publishChannels = channels;
            }

            var services = _getChildren(systemMbo, 'MAXEXTIFACEIN', null, 'IFACENAME', function (linkMbo) {
                var link = _getExternalSystemLink(linkMbo, 'MAXIFACEIN', 'enterpriseService', getEnterpriseService);
                _putValues(link, linkMbo, [
                    ['enabled', 'ENABLED', 'boolean'],
                    ['isContinuousQueue', 'ISCONTINUOUSQUEUE', 'boolean'],
                ]);
                return link;
            });
            if (services.length > 0) {
                system.enterpriseServices = services;
            }

            var controls = _getChildren(systemMbo, 'MAXEXTSYSCONTROL', null, 'IFACECONTROL', _getExternalSystemControl);
            if (controls.length > 0) {
                system.integrationControls = controls;
            }

            return system;
        }
    } finally {
        _close(systemSet);
    }
}

/** A userdefined channel or service that only this system links is embedded, any other is referenced by name. */
function _getExternalSystemLink(linkMbo, object, property, getRecord) {
    var ifaceName = linkMbo.getString('IFACENAME');
    var record = linkMbo.getMboSet('$NV' + object, object, 'ifacename = :ifacename').moveFirst();
    if (record != null && record.getBoolean('USERDEFINED')) {
        if (linkMbo.getMboSet('$NVOTHERLINKS', linkMbo.getName(), 'ifacename = :ifacename and extsysname != :extsysname').isEmpty()) {
            var link = {};
            link[property] = getRecord(record.getUniqueIDValue());
            return link;
        }
    }
    return { ifaceName: ifaceName };
}

/** Values are extracted as stored, the localized value the screens show. Only the rows of the control's type are read. */
function _getExternalSystemControl(controlMbo) {
    var control = { control: controlMbo.getString('IFACECONTROL') };
    var type = toInternalSynonymValue('CONTROLTYPE', controlMbo.getString('CONTROLTYPE'), controlMbo);
    var overrides = [];
    if (type === 'VALUE') {
        _putValues(control, controlMbo, [['value', 'VALUE']]);
        overrides = _getChildren(controlMbo, 'MAXEXTCTLVAL', null, 'ORGID, SITEID', function (valueMbo) {
            var override = _getOverrideKeys(valueMbo);
            _putValues(override, valueMbo, [['value', 'VALUE']]);
            return override;
        });
    } else if (type === 'BOOLEAN') {
        _putValues(control, controlMbo, [['isTrue', 'ISTRUE', 'boolean']]);
        overrides = _getChildren(controlMbo, 'MAXEXTBOOLVAL', null, 'ORGID, SITEID', function (valueMbo) {
            var override = _getOverrideKeys(valueMbo);
            _putValues(override, valueMbo, [['isTrue', 'ISTRUE', 'boolean']]);
            return override;
        });
    } else {
        _putOverrideValues(control, type, controlMbo.getMboSet('MAXEXTLISTVAL'), controlMbo.getMboSet('MAXEXTXREFVAL'));
        overrides = _getChildren(controlMbo, 'MAXEXTOVER', null, 'ORGID, SITEID', function (overMbo) {
            var override = _getOverrideKeys(overMbo);
            // The relationships match on orgid and siteid, so they miss the rows where either is blank.
            var where =
                'extsysname = :extsysname and ifacecontrol = :ifacecontrol and ' +
                (overMbo.isNull('ORGID') ? 'orgid is null' : 'orgid = :orgid') +
                ' and ' +
                (overMbo.isNull('SITEID') ? 'siteid is null' : 'siteid = :siteid');
            _putOverrideValues(
                override,
                type,
                overMbo.getMboSet('$NVLISTOVERVAL', 'MAXLISTOVERVAL', where),
                overMbo.getMboSet('$NVXREFOVERVAL', 'MAXXREFOVERVAL', where)
            );
            return override;
        });
    }
    if (overrides.length > 0) {
        control.overrides = overrides;
    }
    return control;
}

function _getOverrideKeys(mbo) {
    var override = {};
    _putValues(override, mbo, [
        ['orgId', 'ORGID'],
        ['siteId', 'SITEID'],
    ]);
    return override;
}

function _putOverrideValues(target, type, listSet, crossReferenceSet) {
    var rows = [];
    var mboSet = type === 'LIST' ? listSet : crossReferenceSet;
    mboSet.setOrderBy('VALUE');
    mboSet.reset();
    var mappings =
        type === 'LIST'
            ? [['value', 'VALUE']]
            : [
                  ['value', 'VALUE'],
                  ['newValue', 'NEWVALUE'],
              ];
    var mbo = mboSet.moveFirst();
    while (mbo != null) {
        var row = {};
        _putValues(row, mbo, mappings);
        rows.push(row);
        mbo = mboSet.moveNext();
    }
    if (rows.length > 0) {
        target[type === 'LIST' ? 'listValues' : 'crossReferenceValues'] = rows;
    }
}

/** Shared by the integration channels that carry processing rules. Synonym values are extracted localized, as the screens show them. */
function _getProcessingRules(owner, relationship, useWith) {
    var whereClause = null;
    if (useWith) {
        var sqlf = new SqlFormat('usewith = :1');
        sqlf.setObject(1, 'MAXIFACEPROC', 'USEWITH', useWith);
        whereClause = sqlf.format();
    }
    return _getChildren(owner, relationship, whereClause, 'PROCSEQUENCE', function (ruleMbo) {
        var rule = { procName: ruleMbo.getString('PROCNAME') };
        _putValues(rule, ruleMbo, [
            ['action', 'PROCTYPE'],
            ['objectName', 'OBJECTNAME'],
            ['hierarchyPath', 'HIERARCHYPATH'],
            ['description', 'DESCRIPTION'],
            ['className', 'CLASSNAME'],
            ['procMessage', 'PROCMESSAGE'],
            ['enabled', 'ENABLED', 'boolean'],
            ['applyOnInsert', 'APPLYONINSERT', 'boolean'],
            ['applyOnUpdate', 'APPLYONUPDATE', 'boolean'],
            ['applyOnDelete', 'APPLYONDELETE', 'boolean'],
        ]);

        var conditions = _getChildren(ruleMbo, 'MAXIFACECOND', null, 'CONDITION', function (conditionMbo) {
            var condition = { condition: conditionMbo.getInt('CONDITION') };
            var details = _getChildren(conditionMbo, 'MAXCONDDETAIL', null, 'CONDSEQUENCE', function (detailMbo) {
                var detail = {};
                _putValues(detail, detailMbo, [
                    ['condSequence', 'CONDSEQUENCE', 'int'],
                    ['condType', 'CONDTYPE'],
                    ['evalType', 'EVALTYPE'],
                    ['changeType', 'CHANGETYPE'],
                    ['compareType', 'COMPARETYPE'],
                    ['columnName', 'COLUMNNAME'],
                    ['mboName', 'MBONAME'],
                    ['mboColumnName', 'MBOCOLUMNNAME'],
                    ['relation', 'RELATION'],
                    ['value', 'VALUE'],
                    ['glOrder', 'GLORDER', 'int'],
                ]);
                return detail;
            });
            if (details.length > 0) {
                condition.details = details;
            }
            return condition;
        });
        if (conditions.length > 0) {
            rule.conditions = conditions;
        }

        var fields = _getChildren(ruleMbo, 'MAXREPLACEPROC', null, 'FIELDNAME', function (fieldMbo) {
            var field = { fieldName: fieldMbo.getString('FIELDNAME') };
            _putValues(field, fieldMbo, [
                ['replaceNull', 'REPLACENULL', 'boolean'],
                ['valueType', 'VALUETYPE'],
                ['value', 'VALUE'],
                ['mboName', 'MBONAME'],
                ['relation', 'RELATION'],
            ]);
            return field;
        });
        if (fields.length > 0) {
            rule.fields = fields;
        }

        var columns = _getChildren(ruleMbo, 'MAXPROCCOLS', null, 'FIELDNAME', function (columnMbo) {
            var column = { fieldName: columnMbo.getString('FIELDNAME') };
            _putValues(column, columnMbo, [['ifaceControl', 'IFACECONTROL']]);
            return column;
        });
        if (columns.length > 0) {
            rule.columns = columns;
        }

        return rule;
    });
}

function getIntObjects() {
    return _listRecords('MAXINTOBJECT', ['INTOBJECTNAME', 'DESCRIPTION'], 'INTOBJECTNAME');
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

            if (_attributeExists('MAXINTOBJECT', 'AUTOPAGINGTHRESHOLD') && maxIntObject.getInt('AUTOPAGINGTHRESHOLD') != -1) {
                intObject.autoPagingThreshold = maxIntObject.getInt('AUTOPAGINGTHRESHOLD');
            }

            var maxIntObjDetailSet = maxIntObject.getMboSet('MAXINTOBJDETAIL');
            maxIntObjDetailSet.setOrderBy('PROCESSORDER');
            maxIntObjDetailSet.reset();
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

                var objectAppAuthSet = maxIntObjDetail.getMboSet('$objectappauth', 'OBJECTAPPAUTH', 'objectname = :objectname');
                var objectAppAuth = objectAppAuthSet.moveFirst();

                if (objectAppAuth != null) {
                    intObjDetail.objectAppAuth = [];
                }
                while (objectAppAuth != null) {
                    var objAppAuth = {
                        context: objectAppAuth.getString('CONTEXT'),
                        description: objectAppAuth.getString('DESCRIPTION'),
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
                    option.visible = false;
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
                    action.collection = osOSLCAction.getBoolean('COLLECTION');
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
                        query.script = oslcQuery.getString('SCRIPTNAME');
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
                    owner: queryTemplate.getString('OWNER'),
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
    return _listRecords('MAXLOGGER', ['LOGGER', 'LOGKEY'], 'LOGGER');
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
                logger.parentLogKey = parentLogger.getString('LOGKEY');
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
    return _listRecords('CRONTASKDEF', ['CRONTASKNAME', 'DESCRIPTION'], 'CRONTASKNAME');
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

function getEscalations() {
    return _listRecords('ESCALATION', ['ESCALATION', 'DESCRIPTION'], 'ESCALATION');
}

function getEscalation(id) {
    var escalationSet = MXServer.getMXServer().getMboSet('ESCALATION', MXServer.getMXServer().getSystemUserInfo());
    try {
        var escalationMbo = escalationSet.getMboForUniqueId(id);
        if (escalationMbo != null) {
            var escalation = {
                escalation: escalationMbo.getString('ESCALATION'),
                description: escalationMbo.getString('DESCRIPTION'),
                objectName: escalationMbo.getString('OBJECTNAME'),
                condition: escalationMbo.getString('CONDITION'),
                active: escalationMbo.getBoolean('ACTIVE'),
                schedule: escalationMbo.getString('SCHEDULE'),
                cronTaskName: escalationMbo.getString('CRONTASKNAME'),
                instanceName: escalationMbo.getString('INSTANCENAME'),
                escStatusFlag: escalationMbo.getBoolean('ESCSTATUSFLAG'),
            };

            if (!escalationMbo.isNull('ESCCALENDAR')) {
                escalation.escCalendar = escalationMbo.getString('ESCCALENDAR');
            }

            if (!escalationMbo.isNull('ESCSHIFT')) {
                escalation.escShift = escalationMbo.getString('ESCSHIFT');
            }

            if (!escalationMbo.isNull('ESCCALORGID')) {
                escalation.escCalOrgId = escalationMbo.getString('ESCCALORGID');
            }

            if (!escalationMbo.isNull('SLANUM')) {
                escalation.slaNum = escalationMbo.getString('SLANUM');
            }

            if (!escalationMbo.isNull('LANGCODE')) {
                escalation.langCode = escalationMbo.getString('LANGCODE');
            }

            if (!escalationMbo.isNull('ORGID')) {
                escalation.orgId = escalationMbo.getString('ORGID');
            }

            if (!escalationMbo.isNull('SITEID')) {
                escalation.siteId = escalationMbo.getString('SITEID');
            }

            var escRefPointSet = escalationMbo.getMboSet('ESCREFPOINT');
            var escRefPointMbo = escRefPointSet.moveFirst();

            if (escRefPointMbo != null) {
                escalation.escRefPoint = [];
            }

            while (escRefPointMbo != null) {
                var refPoint = {
                    refPointNum: escRefPointMbo.getInt('REFPOINTNUM'),
                    repeat: escRefPointMbo.getBoolean('REPEAT'),
                };

                if (!escRefPointMbo.isNull('EVENTATTRIBUTE')) {
                    refPoint.eventAttribute = escRefPointMbo.getString('EVENTATTRIBUTE');
                }

                if (!escRefPointMbo.isNull('ELAPSEDINTERVAL')) {
                    refPoint.elapsedInterval = escRefPointMbo.getDouble('ELAPSEDINTERVAL');
                }

                if (!escRefPointMbo.isNull('INTERVALUOM')) {
                    refPoint.intervalUom = escRefPointMbo.getString('INTERVALUOM');
                }

                if (!escRefPointMbo.isNull('EVENTCONDITION')) {
                    refPoint.eventCondition = escRefPointMbo.getString('EVENTCONDITION');
                }

                if (!escRefPointMbo.isNull('ACTION')) {
                    refPoint.action = escRefPointMbo.getString('ACTION');
                }

                if (!escRefPointMbo.isNull('CALCCALENDAR')) {
                    refPoint.calcCalendar = escRefPointMbo.getString('CALCCALENDAR');
                }

                if (!escRefPointMbo.isNull('CALCSHIFT')) {
                    refPoint.calcShift = escRefPointMbo.getString('CALCSHIFT');
                }

                if (!escRefPointMbo.isNull('CALCORGID')) {
                    refPoint.calcOrgId = escRefPointMbo.getString('CALCORGID');
                }

                var escNotificationSet = escRefPointMbo.getMboSet('ESCNOTIFICATION');
                var escNotificationMbo = escNotificationSet.moveFirst();

                if (escNotificationMbo != null) {
                    refPoint.escNotification = [];
                }

                while (escNotificationMbo != null) {
                    var notification = {
                        templateId: escNotificationMbo.getString('TEMPLATEID'),
                    };
                    refPoint.escNotification.push(notification);
                    escNotificationMbo = escNotificationSet.moveNext();
                }

                escalation.escRefPoint.push(refPoint);
                escRefPointMbo = escRefPointSet.moveNext();
            }

            return escalation;
        }
    } finally {
        _close(escalationSet);
    }
}

function getDomains() {
    return _listRecords('MAXDOMAIN', ['DOMAINID', 'DOMAINTYPE', 'DESCRIPTION'], 'DOMAINID', function (values) {
        return { label: values[0] + ' (' + values[1] + ')', description: values[2] };
    });
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

            switch (toInternalSynonymValue('DOMTYPE', domain.domainType, maxDomain)) {
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
                        };

                        // Numbers rather than getString, which formats them for the server locale.
                        var rangeFields = { rangeMinimum: 'RANGEMINIMUM', rangeMaximum: 'RANGEMAXIMUM', rangeInterval: 'RANGEINTERVAL' };
                        Object.keys(rangeFields).forEach(function (field) {
                            if (!numRangeDomain.isNull(rangeFields[field])) {
                                numRangeValue[field] = numRangeDomain.getDouble(rangeFields[field]);
                            }
                        });

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

                            if (!synonymDomainValCond.isNull('OBJECTNAME')) {
                                synonymCondValue.objectName = synonymDomainValCond.getString('OBJECTNAME');
                            }

                            synonymValue.maxDomValCond.push(synonymCondValue);

                            synonymDomainValCond = synonymDomainValCondSet.moveNext();
                        }

                        domain.synonymDomain.push(synonymValue);
                        synonymDomain = synonymDomainSet.moveNext();
                    }

                    break;
                case 'MAXTABLE':
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
    return _listRecords('MAXPROP', ['PROPNAME', 'DESCRIPTION'], 'PROPNAME');
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

                if (!maxProp.isNull('MAXTYPE')) {
                    property.maxType = maxProp.getString('MAXTYPE');
                }

                if (!maxProp.isNull('SECURELEVEL')) {
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
                    msgId: maxMessage.getString('MSGID'),
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

                if (!maxMessage.isNull('OPERATORRESPONSE')) {
                    message.operatorResponse = maxMessage.getString('OPERATORRESPONSE');
                }

                if (!maxMessage.isNull('SYSTEMACTION')) {
                    message.systemAction = maxMessage.getString('SYSTEMACTION');
                }

                message.options = getMessageOptions(maxMessage);

                return message;
            }
        } finally {
            _close(maxMessageSet);
        }
    }
}

function getMessageOptions(maxMessage) {
    var options = [];
    var messageOptions = ['close', 'ok', 'cancel', 'yes', 'no', 'warning', 'stop', 'exclamation'];

    messageOptions.forEach(function (messageOption) {
        if (maxMessage.getBoolean(messageOption)) {
            options.push(messageOption);
        }
    });

    return options;
}

function getMessages() {
    return _listRecords('MAXMESSAGES', ['MSGGROUP', 'MSGKEY', 'VALUE'], 'MSGGROUP, MSGKEY', function (values) {
        return { label: values[0] + ':' + values[1], description: values[2] };
    });
}

function getMaximoObjects() {
    return _listRecords('MAXOBJECTCFG', ['OBJECTNAME', 'DESCRIPTION'], 'OBJECTNAME', null, "CHANGED != 'R'");
}

/**
 * Returns a Maximo object in the shape of the "objects" deployment payload. An object, attribute or
 * index marked for removal by Database Configuration is treated as already gone.
 */
function getMaximoObject(id) {
    var maxObjectSet = MXServer.getMXServer().getMboSet('MAXOBJECTCFG', MXServer.getMXServer().getSystemUserInfo());
    try {
        var mbo = maxObjectSet.getMboForUniqueId(id);
        if (mbo == null || _markedForRemoval(mbo)) {
            return undefined;
        }

        var maxObject = { object: mbo.getString('OBJECTNAME') };
        _putValues(maxObject, mbo, [
            ['description', 'DESCRIPTION'],
            ['service', 'SERVICENAME'],
            ['entity', 'ENTITYNAME'],
            ['class', 'CLASSNAME'],
            ['extendsObject', 'EXTENDSOBJECT'],
            ['level', 'SITEORGTYPE'],
            ['textDirection', 'TEXTDIRECTION'],
            ['mainObject', 'MAINOBJECT', 'boolean'],
            ['persistent', 'PERSISTENT', 'boolean'],
            ['storagePartition', 'STORAGEPARTITION'],
            ['uniqueColumn', 'UNIQUECOLUMNNAME'],
            ['languageTable', 'LANGTABLENAME'],
            ['languageColumn', 'LANGCOLUMNNAME'],
            ['alternateIndex', 'ALTIXNAME'],
            ['triggerRoot', 'TRIGROOT'],
            ['addRowstamp', 'ADDROWSTAMP', 'boolean'],
            ['textSearchEnabled', 'TEXTSEARCHENABLED', 'boolean'],
            ['view', 'ISVIEW', 'boolean'],
            ['viewWhere', 'VIEWWHERE'],
            ['joinToObject', 'JOINOBJECT'],
            ['viewSelect', 'VIEWSELECT'],
            ['automaticallySelect', 'AUTOSELECT', 'boolean'],
            ['viewFrom', 'VIEWFROM'],
            ['auditEnabled', 'EAUDITENABLED', 'boolean'],
            ['auditTable', 'EAUDITTBNAME'],
            ['eAuditFilter', 'EAUDITFILTER'],
            ['eSignatureFilter', 'ESIGFILTER'],
        ]);

        maxObject.attributes = _getChildren(mbo, 'MAXATTRIBUTECFG', null, 'ATTRIBUTENO', function (attribute) {
            var result = { attribute: attribute.getString('ATTRIBUTENAME') };
            _putValues(result, attribute, [
                ['description', 'REMARKS'],
                ['title', 'TITLE'],
                ['type', 'MAXTYPE'],
                ['length', 'LENGTH', 'int'],
                ['scale', 'SCALE', 'int'],
                ['searchType', 'SEARCHTYPE'],
                ['required', 'REQUIRED', 'boolean'],
                ['class', 'CLASSNAME'],
                ['domain', 'DOMAINID'],
                ['defaultValue', 'DEFAULTVALUE'],
                ['alias', 'ALIAS'],
                ['column', 'COLUMNNAME'],
                ['sameAsObject', 'SAMEASOBJECT'],
                ['sameAsAttribute', 'SAMEASATTRIBUTE'],
                ['autonumber', 'AUTOKEYNAME'],
                ['localizable', 'LOCALIZABLE', 'boolean'],
                ['textDirection', 'TEXTDIRECTION'],
                ['persistent', 'PERSISTENT', 'boolean'],
                ['mustBe', 'MUSTBE', 'boolean'],
                ['positive', 'ISPOSITIVE', 'boolean'],
                ['canAutonumber', 'CANAUTONUM', 'boolean'],
                ['longDescriptionOwner', 'ISLDOWNER', 'boolean'],
                ['sequenceName', 'SEQUENCENAME'],
                ['typeOfComplexExpression', 'COMPLEXEXPRESSION'],
                ['auditEnabled', 'EAUDITENABLED', 'boolean'],
                ['multilanguageSupported', 'MLSUPPORTED', 'boolean'],
                ['multilanguageInUse', 'MLINUSE', 'boolean'],
                ['eSignatureEnabled', 'ESIGENABLED', 'boolean'],
                ['primaryColumn', 'PRIMARYKEYCOLSEQ', 'int'],
            ]);
            return result;
        });

        maxObject.relationships = _getChildren(mbo, 'MAXRELATIONSHIP', null, 'NAME', function (relationship) {
            var result = { relationship: relationship.getString('NAME') };
            _putValues(result, relationship, [
                ['child', 'CHILD'],
                ['remarks', 'REMARKS'],
                ['whereClause', 'WHERECLAUSE'],
                ['cardinality', 'CARDINALITY'],
                ['dbJoinRequired', 'DBJOINREQUIRED', 'int'],
                ['isDefault', 'ISDEFAULT', 'boolean'],
            ]);
            return result;
        });

        maxObject.indexes = _getChildren(mbo, 'MAXSYSINDEXES', null, 'NAME', function (index) {
            var result = { index: index.getString('NAME') };
            _putValues(result, index, [
                ['enforceUniqueness', 'UNIQUE', 'boolean'],
                ['clusteredIndex', 'CLUSTERRULE', 'boolean'],
                ['required', 'REQUIRED', 'boolean'],
                ['textSearchIndex', 'TEXTSEARCH', 'boolean'],
                ['storagePartition', 'STORAGEPARTITION'],
            ]);
            result.columns = _getChildren(index, 'MAXSYSKEYS', null, 'COLSEQ', function (key) {
                var column = { column: key.getString('COLNAME') };
                _putValues(column, key, [
                    ['ascending', 'ASCENDING', 'boolean'],
                    ['sequence', 'COLSEQ', 'int'],
                ]);
                return column;
            });
            return result;
        });

        return maxObject;
    } finally {
        _close(maxObjectSet);
    }
}

/**
 * Lists an object's records as { id, label, description } with plain SQL rather than an MboSet, because
 * building an Mbo for each of thousands of records is slow. The id is the object's unique id. toItem
 * receives the selected column values in order; by default the first is the label and the second the
 * description.
 */
function _listRecords(objectName, columns, orderBy, toItem, whereClause) {
    var uniqueIdName = MXServer.getMXServer().getMaximoDD().getMboSetInfo(objectName).getUniqueIDName();
    var sql = 'select ' + uniqueIdName + ', ' + columns.join(', ') + ' from ' + objectName;
    if (whereClause) {
        sql += ' where ' + whereClause;
    }
    sql += ' order by ' + orderBy;

    var db = new DBShortcut();
    var resultSet = null;
    try {
        db.connect(MXServer.getMXServer().getSystemUserInfo().getConnectionKey());
        resultSet = db.executeQuery(sql);
        var records = [];
        while (resultSet.next()) {
            var values = [];
            for (var i = 0; i < columns.length; i++) {
                values.push(resultSet.getString(i + 2) || '');
            }
            var record = toItem ? toItem(values) : { label: values[0], description: values[1] };
            record.id = Number(resultSet.getLong(1));
            records.push(record);
        }
        return records;
    } finally {
        if (resultSet != null) {
            resultSet.close();
        }
        db.close();
    }
}

/** The optional where clause narrows the related set. It is always set, because the owner caches the set across calls. */
function _getChildren(mbo, relationship, whereClause, orderBy, toPayload) {
    var children = [];
    var childSet = mbo.getMboSet(relationship);
    childSet.setWhere(whereClause || '');
    childSet.setOrderBy(orderBy);
    childSet.reset();
    var child = childSet.moveFirst();
    while (child != null) {
        if (!_markedForRemoval(child)) {
            children.push(toPayload(child));
        }
        child = childSet.moveNext();
    }
    return children;
}

function _markedForRemoval(mbo) {
    return _hasAttribute(mbo, 'CHANGED') && mbo.getString('CHANGED') === 'R';
}

function _hasAttribute(mbo, attribute) {
    return _attributeExists(mbo.getName(), attribute);
}

/**
 * Copies [property, attribute, type] triples from the record. Booleans are always written, other
 * values only when set, and attributes this Maximo version lacks are skipped.
 */
function _putValues(target, mbo, mappings) {
    mappings.forEach(function (mapping) {
        var attribute = mapping[1];
        if (!_hasAttribute(mbo, attribute)) {
            return;
        }
        if (mapping[2] === 'boolean') {
            target[mapping[0]] = mbo.getBoolean(attribute);
        } else if (!mbo.isNull(attribute)) {
            target[mapping[0]] = mapping[2] === 'int' ? mbo.getInt(attribute) : mbo.getString(attribute);
        }
    });
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
