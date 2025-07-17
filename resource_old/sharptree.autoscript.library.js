/* eslint-disable no-redeclare */
/* eslint-disable indent */
/* eslint-disable no-undef */
/* eslint-disable no-unused-vars */
// @ts-nocheck

MboConstants = Java.type('psdi.mbo.MboConstants');
SqlFormat = Java.type('psdi.mbo.SqlFormat');

MXServer = Java.type('psdi.server.MXServer');

System = Java.type('java.lang.System');

MXLoggerFactory = Java.type('psdi.util.logging.MXLoggerFactory');
MXServer = Java.type('psdi.server.MXServer');
var logger = MXLoggerFactory.getLogger(
    'maximo.script.SHARPTREE.AUTOSCRIPT.LIBRARY'
);

// Array find polyfill.
if (typeof Array.prototype.find != 'function') {
    Array.prototype.find = function (callback) {
        if (this === null) {
            throw new TypeError(
                'Array.prototype.find called on null or undefined'
            );
        } else if (typeof callback !== 'function') {
            throw new TypeError('callback must be a function');
        }
        var list = Object(this);
        // Makes sure is always has an positive integer as length.
        var length = list.length >>> 0;
        var thisArg = arguments[1];
        for (var i = 0; i < length; i++) {
            var element = list[i];
            if (callback.call(thisArg, element, i, list)) {
                return element;
            }
        }
    };
}

function MaxLogger(maxLogger) {
    if (!maxLogger) {
        throw new Error(
            'A maxLogger JSON is required to create the MaxLogger object.'
        );
    } else if (typeof maxLogger.logger === 'undefined') {
        throw new Error(
            'The logger property is required and must be a Maximo MaxLogger field value.'
        );
    }

    this.logger = maxLogger.logger;

    this.parentLogKey =
        typeof maxLogger.parentLogKey === 'undefined'
            ? ''
            : maxLogger.parentLogKey;
    this.logKey =
        typeof maxLogger.logKey === 'undefined'
            ? (this.parentLogKey
                  ? this.parentLogKey + '.'
                  : 'log4j.logger.maximo.') + maxLogger.logger
            : maxLogger.logKey;
    this.logLevel =
        typeof maxLogger.logLevel === 'undefined'
            ? 'ERROR'
            : maxLogger.logLevel;
    this.active =
        typeof maxLogger.active === 'undefined'
            ? false
            : maxLogger.active == true;
    this.appenders =
        typeof maxLogger.appenders === 'undefined' ? '' : maxLogger.appenders;

    if (this.parentLogKey && !this.logKey.startsWith(this.parentLogKey)) {
        this.logKey = this.parentLogKey + '.' + this.logger;
    }
}

MaxLogger.prototype.constructor = MaxLogger;
MaxLogger.prototype.apply = function (mboSet) {
    if (!mboSet) {
        throw new Error(
            'A MboSet is required to set values from the MaxLogger object.'
        );
    } else if (!(mboSet instanceof Java.type('psdi.mbo.MboSet'))) {
        throw new Error(
            'The mboSet parameter must be an instance of psdi.mbo.Mbo.'
        );
    } else if (!mboSet.isBasedOn('MAXLOGGER')) {
        throw new Error(
            'The mboSet parameter must be based on the MAXLOGGER Maximo object.'
        );
    }

    var sqlFormat;
    var maxLogger;
    if (this.parentLogKey) {
        sqlFormat = new SqlFormat('logkey = :1');
        sqlFormat.setObject(1, 'MAXLOGGER', 'LOGKEY', this.parentLogKey);
        mboSet.setWhere(sqlFormat.format());
        if (mboSet.isEmpty()) {
            throw new Error(
                'The parent logger key value ' +
                    this.parentLogKey +
                    ' does not exist in the target system, cannot add child logger ' +
                    this.logger
            );
        } else {
            var parent = mboSet.moveFirst();
            var children = parent.getMboSet('CHILDLOGGERS');
            var child = children.moveFirst();

            while (child) {
                if (
                    child.getString('LOGGER').toLowerCase() ==
                    this.logger.toLowerCase()
                ) {
                    child.setValue('ACTIVE', false);
                    child.delete();
                    break;
                }
                child = children.moveNext();
            }

            maxLogger = children.add();
            maxLogger.setValue('LOGGER', this.logger);
        }
    } else {
        sqlFormat = new SqlFormat('logger = :1');
        sqlFormat.setObject(1, 'MAXLOGGER', 'LOGGER', this.logger);
        mboSet.setWhere(sqlFormat.format());
        if (!mboSet.isEmpty()) {
            maxLogger = mboSet.moveFirst();
            maxLogger.setValue('ACTIVE', false);
            maxLogger.delete();
        }
        maxLogger = mboSet.add();
        maxLogger.setValue('LOGGER', this.logger);
        maxLogger.setValue('LOGKEY', this.logKey);
    }

    maxLogger.setValue('LOGLEVEL', this.logLevel);
    maxLogger.setValue('ACTIVE', this.active);
    maxLogger.setValue('APPENDERS', this.appenders);
    mboSet.save();

    // apply the logging settings
    MXServer.getMXServer().lookup('LOGGING').applySettings(false);
};

function CronTask(cronTask) {
    if (!cronTask) {
        throw new Error(
            'A integration object JSON is required to create the CronTask object.'
        );
    } else if (typeof cronTask.cronTaskName === 'undefined') {
        throw new Error(
            'The cronTaskName property is required and must a Maximo CronTask field value.'
        );
    } else if (typeof cronTask.className === 'undefined') {
        throw new Error(
            'The className property is required and must a Maximo CronTask field value.'
        );
    }

    this.cronTaskName = cronTask.cronTaskName;
    this.description =
        typeof cronTask.description === 'undefined' ? '' : cronTask.description;
    this.className = cronTask.className;
    this.accessLevel =
        typeof cronTask.accessLevel === 'undefined' || !cronTask.accessLevel
            ? 'FULL'
            : cronTask.accessLevel;

    if (
        typeof cronTask.cronTaskInstance !== 'undefined' &&
        Array.isArray(cronTask.cronTaskInstance)
    ) {
        cronTask.cronTaskInstance.forEach(function (instance) {
            if (
                typeof instance.instanceName === 'undefined' ||
                !instance.instanceName
            ) {
                throw new Error(
                    'The CronTask object ' +
                        cronTask.cronTaskName +
                        ' instance is missing a name property for the instance name.'
                );
            }

            instance.description =
                typeof instance.description === 'undefined'
                    ? ''
                    : instance.description;
            instance.schedule =
                typeof instance.schedule === 'undefined'
                    ? '1h,*,0,*,*,*,*,*,*,*'
                    : instance.schedule;
            instance.active =
                typeof instance.active === 'undefined'
                    ? false
                    : instance.active == true;
            instance.keepHistory =
                typeof instance.keepHistory === 'undefined'
                    ? true
                    : instance.keepHistory == true;
            instance.runAsUserId =
                typeof instance.runAsUserId === 'undefined'
                    ? 'MAXADMIN'
                    : instance.runAsUserId;
            instance.maxHistory =
                typeof instance.maxHistory === 'undefined'
                    ? 1000
                    : instance.maxHistory;

            if (
                typeof instance.cronTaskParam !== 'undefined' &&
                Array.isArray(instance.cronTaskParam)
            ) {
                instance.cronTaskParam.forEach(function (cronTaskParam) {
                    if (
                        typeof cronTaskParam.parameter === 'undefined' ||
                        !cronTaskParam.parameter
                    ) {
                        throw new Error(
                            'A CronTask object ' +
                                cronTask.cronTaskName +
                                ' instance ' +
                                instance.instanceName +
                                ' parameter is missing a parameter property.'
                        );
                    }

                    cronTaskParam.value =
                        typeof cronTaskParam.value === 'undefined'
                            ? ''
                            : cronTaskParam.value;
                });
            } else {
                instance.cronTaskParam = [];
            }
        });

        this.cronTaskInstance = cronTask.cronTaskInstance;
    } else {
        this.cronTaskInstance = [];
    }
}

CronTask.prototype.constructor = CronTask;
CronTask.prototype.setMboValues = function (mbo) {
    if (!mbo) {
        throw new Error(
            'A Mbo is required to set values from the CronTask object.'
        );
    } else if (!(mbo instanceof Java.type('psdi.mbo.Mbo'))) {
        throw new Error(
            'The mbo parameter must be an instance of psdi.mbo.Mbo.'
        );
    } else if (!mbo.isBasedOn('CRONTASKDEF')) {
        throw new Error(
            'The mbo parameter must be based on the CRONTASKDEF Maximo object.'
        );
    }

    if (mbo.toBeAdded()) {
        mbo.setValue('CRONTASKNAME', this.cronTaskName);
        mbo.setValue('CLASSNAME', this.className);
        mbo.setValue('ACCESSLEVEL', this.accessLevel);
    }

    mbo.setValue('DESCRIPTION', this.description);

    var cronTaskInstanceSet = mbo.getMboSet('CRONTASKINSTANCE');
    var tmpCronTaskInstanceMbo = cronTaskInstanceSet.moveFirst();

    while (tmpCronTaskInstanceMbo) {
        tmpCronTaskInstanceMbo.setValue('ACTIVE', false);
        tmpCronTaskInstanceMbo = cronTaskInstanceSet.moveNext();
    }
    // remove all the current instances
    cronTaskInstanceSet.deleteAll();

    this.cronTaskInstance.forEach(function (instance) {
        var cronTaskInstanceMbo = cronTaskInstanceSet.add();
        cronTaskInstanceMbo.setValue('INSTANCENAME', instance.instanceName);
        cronTaskInstanceMbo.setValue('DESCRIPTION', instance.description);
        cronTaskInstanceMbo.setValue('SCHEDULE', instance.schedule);
        cronTaskInstanceMbo.setValue('RUNASUSERID', instance.runAsUserId);
        cronTaskInstanceMbo.setValue('KEEPHISTORY', instance.keepHistory);
        cronTaskInstanceMbo.setValue('ACTIVE', instance.active);
        cronTaskInstanceMbo.setValue('MAXHISTORY', instance.maxHistory);

        var cronTaskParamSet = cronTaskInstanceMbo.getMboSet('PARAMETER');

        instance.cronTaskParam.forEach(function (param) {
            var cronTaskParam = cronTaskParamSet.moveFirst();

            while (cronTaskParam) {
                if (cronTaskParam.getString('PARAMETER') == param.parameter) {
                    cronTaskParam.setValue('VALUE', param.value);
                }
                cronTaskParam = cronTaskParamSet.moveNext();
            }
        });
    });
};

function EndPoint(endPoint) {
    if (!endPoint) {
        throw new Error(
            'A integration object JSON is required to create the endPoint object.'
        );
    } else if (typeof endPoint.endPointName === 'undefined') {
        throw new Error('The endPointName property is required.');
    } else if (typeof endPoint.handlerName === 'undefined') {
        throw new Error(
            'The handler property is required and must a valid Maximo handler.'
        );
    }

    this.endPointName = endPoint.endPointName;
    this.description =
        typeof endPoint.description === 'undefined' ? '' : endPoint.description;
    this.handlerName = endPoint.handlerName;
    this.maxEndPointDtl =
        typeof maxEndPoint.maxEndPointDtl === 'undefined'
            ? []
            : maxEndPoint.maxEndPointDtl;
    if (!Array.isArray(this.maxEndPointDtl)) {
        endPoint.endPointDtl.forEach(function (detail) {
            if (typeof detail.property === 'undefined' || !detail.property) {
                throw new Error(
                    'Property ' +
                        detail.property +
                        ' is missing or has an empty value for the required Property name.'
                );
            }

            detail.value =
                typeof detail.value === 'undefined' ? '' : detail.value;
            detail.allowOverride =
                typeof detail.allowOverride === 'undefined'
                    ? false
                    : detail.allowOverride == true;
        });

        this.endPointDtl = endPoint.endPointDtl;
    } else {
        this.endPointDtl = [];
    }
}

EndPoint.prototype.constructor = EndPoint;
EndPoint.prototype.setMboValues = function (mbo) {
    if (!mbo) {
        throw new Error(
            'A Mbo is required to set values from the End Point object.'
        );
    } else if (!(mbo instanceof Java.type('psdi.mbo.Mbo'))) {
        throw new Error(
            'The mbo parameter must be an instance of psdi.mbo.Mbo.'
        );
    } else if (!mbo.isBasedOn('MAXENDPOINT')) {
        throw new Error(
            'The mbo parameter must be based on the MAXENDPOINT Maximo object.'
        );
    }
    if (mbo.toBeAdded()) {
        mbo.setValue('ENDPOINTNAME', this.endPointName);
    }
    mbo.setValue('DESCRIPTION', this.description);
    mbo.setValue('HANDLERNAME', this.handlerName);
    var endPointNameTemp = this.endPointName; //used to pass end point name to detail function
    this.endPointDtl.forEach(function (detail) {
        var maxEndPointDtlSet;
        try {
            maxEndPointDtlSet = mbo.getMboSet('MAXENDPOINTDTL');
            var maxEndPointDtl = maxEndPointDtlSet.moveFirst();
            while (maxEndPointDtl) {
                if (
                    maxEndPointDtl.getString('PROPERTY') ==
                    detail.property.toUpperCase()
                ) {
                    maxEndPointDtl.setValue('VALUE', detail.value);
                    maxEndPointDtl.setValue(
                        'ALLOWOVERRIDE',
                        detail.allowOverride
                    );
                    break;
                }
                maxEndPointDtl = maxEndPointDtlSet.moveNext();
            }
        } finally {
            __libraryClose(maxEndPointDtlSet);
        }
    });
};

function ExternalSystem(externalSystem) {
    if (!externalSystem) {
        throw new Error(
            'A integration object JSON is required to create the ExternalSystem object.'
        );
    } else if (typeof externalSystem.extSysName === 'undefined') {
        throw new Error(
            'The extSysName property is required and must a Maximo External System field value.'
        );
    }

    this.extSysName = externalSystem.extSysName;
    this.description =
        typeof externalSystem.description === 'undefined'
            ? ''
            : externalSystem.description;
    this.endPointName =
        typeof externalSystem.endPointName === 'undefined'
            ? ''
            : externalSystem.endPointName;
    this.bidiConfig =
        typeof externalSystem.bidiConfig === 'undefined'
            ? ''
            : externalSystem.bidiConfig;
    this.jmsMsgEncoding =
        typeof externalSystem.jmsMsgEncoding === 'undefined'
            ? ''
            : externalSystem.jmsMsgEncoding;
    this.enabled =
        typeof externalSystem.enabled === 'undefined'
            ? false
            : externalSystem.enabled == true;
    this.outSeqQueueName =
        typeof externalSystem.outSeqQueueName === 'undefined'
            ? ''
            : externalSystem.outSeqQueueName;
    this.inSeqQueueName =
        typeof externalSystem.inSeqQueueName === 'undefined'
            ? ''
            : externalSystem.inSeqQueueName;
    this.inContQueueName =
        typeof externalSystem.inContQueueName === 'undefined'
            ? ''
            : externalSystem.inContQueueName;

    //associated publish channels
    if (
        externalSystem.maxExtIfaceOut &&
        Array.isArray(externalSystem.maxExtIfaceOut)
    ) {
        externalSystem.maxExtIfaceOut.forEach(function (ifaceOut) {
            if (
                typeof ifaceOut.ifaceName === 'undefined' ||
                !ifaceOut.ifaceName
            ) {
                throw new Error(
                    'An interface name for external system ' +
                        externalSystem.extSysName +
                        ' is missing or has an empty value for the required ifaceName property.'
                );
            }

            ifaceOut.endPointName =
                typeof ifaceOut.endPointName === 'undefined'
                    ? ''
                    : ifaceOut.endPointName;
            ifaceOut.enabled =
                typeof ifaceOut.enabled === 'undefined'
                    ? false
                    : ifaceOut.enabled == true;
        });

        this.maxExtIfaceOut = externalSystem.maxExtIfaceOut;
    } else {
        this.maxExtIfaceOut = [];
    }

    //associated enterprise services
    if (
        externalSystem.maxExtIfaceIn &&
        Array.isArray(externalSystem.maxExtIfaceIn)
    ) {
        externalSystem.maxExtIfaceIn.forEach(function (ifaceIn) {
            if (
                typeof ifaceIn.ifaceName === 'undefined' ||
                !ifaceIn.ifaceName
            ) {
                throw new Error(
                    'An interface name for external system ' +
                        externalSystem.extSysName +
                        ' is missing or has an empty value for the required ifaceName property.'
                );
            }

            ifaceIn.isContinuousQueue =
                typeof ifaceIn.isContinuousQueue === 'undefined'
                    ? true
                    : ifaceIn.isContinuousQueue == true;
            ifaceIn.enabled =
                typeof ifaceIn.enabled === 'undefined'
                    ? false
                    : ifaceIn.enabled == true;
        });

        this.maxExtIfaceIn = externalSystem.maxExtIfaceIn;
    } else {
        this.maxExtIfaceIn = [];
    }
}
ExternalSystem.prototype.constructor = ExternalSystem;
ExternalSystem.prototype.setMboValues = function (mbo) {
    if (!mbo) {
        throw new Error(
            'A Mbo is required to set values from the External System object.'
        );
    } else if (!(mbo instanceof Java.type('psdi.mbo.Mbo'))) {
        throw new Error(
            'The mbo parameter must be an instance of psdi.mbo.Mbo.'
        );
    } else if (!mbo.isBasedOn('MAXEXTSYSTEM')) {
        throw new Error(
            'The mbo parameter must be based on the MAXEXTSYSTEM Maximo object.'
        );
    }
    mbo.setValue('EXTSYSNAME', this.extSysName);
    mbo.setValue('DESCRIPTION', this.description);
    mbo.setValue('ENDPOINTNAME', this.endPointName);
    mbo.setValue('JMSMSGENCODING', this.jmsMsgEncoding);
    mbo.setValue('ENABLED', this.enabled);
    mbo.setValue('OUTSEQQUEUENAME', this.outSeqQueueName);
    mbo.setValue('INSEQQUEUENAME', this.inSeqQueueName);
    mbo.setValue('INCONTQUEUENAME', this.inContQueueName);

    var maxExtIfaceOutSet = mbo.getMboSet('MAXEXTIFACEOUT');
    maxExtIfaceOutSet.deleteAll();

    this.maxExtIfaceOut.forEach(function (ifaceOut) {
        maxExtIfaceOut = maxExtIfaceOutSet.add();
        maxExtIfaceOut.setValue('IFACENAME', ifaceOut.ifaceName);
        maxExtIfaceOut.setValue('ENDPOINTNAME', ifaceOut.endPointName);
        maxExtIfaceOut.setValue('ENABLED', ifaceOut.enabled);
    });

    var maxExtIfaceInSet = mbo.getMboSet('MAXEXTIFACEIN');
    maxExtIfaceInSet.deleteAll();

    this.maxExtIfaceIn.forEach(function (ifaceOut) {
        maxExtIfaceIn = maxExtIfaceInSet.add();
        maxExtIfaceIn.setValue('IFACENAME', ifaceOut.ifaceName);
        maxExtIfaceIn.setValue('ISCONTINUOUSQUEUE', ifaceOut.isContinuousQueue);
        maxExtIfaceIn.setValue('ENABLED', ifaceOut.enabled);
    });
};

function Message(message) {
    if (!message) {
        throw new Error(
            'A message JSON is required to create the Message object.'
        );
    } else if (typeof message.msgGroup === 'undefined') {
        throw new Error(
            'The msgGroup property is required and must a Maximo Message Group field value.'
        );
    } else if (typeof message.msgKey === 'undefined') {
        throw new Error(
            'The msgKey property is required and must a Maximo Message Key field value.'
        );
    } else if (typeof message.value === 'undefined') {
        throw new Error(
            'The value property is required and must a Maximo Value field value.'
        );
    }

    this.msgGroup = message.msgGroup;
    this.msgKey = message.msgKey;
    this.value = message.value;
    this.msgId = typeof message.msgId === 'undefined' ? null : message.msgId;
    this.displayMethod =
        typeof message.displayMethod === 'undefined'
            ? 'MSGBOX'
            : message.displayMethod;
    this.options =
        typeof message.options === 'undefined' ||
        !Array.isArray(message.options)
            ? ['ok']
            : message.options;
    this.prefix =
        typeof message.prefix === 'undefined' ? 'BMXZZ' : message.prefix;
    this.suffix = typeof message.suffix === 'undefined' ? 'E' : message.suffix;
    this.explanation =
        typeof message.explanation === 'undefined' ? null : message.explanation;
    this.operatorResponse =
        typeof message.operatorResponse === 'undefined'
            ? null
            : message.operatorResponse;
    this.adminResponse =
        typeof message.adminResponse === 'undefined'
            ? null
            : message.adminResponse;

    this.systemAction =
        typeof message.systemAction === 'undefined'
            ? null
            : message.systemAction;
}

Message.prototype.constructor = Message;
Message.prototype.setMboValues = function (mbo) {
    if (!mbo) {
        throw new Error(
            'A Mbo is required to set values from the Message object.'
        );
    } else if (!(mbo instanceof Java.type('psdi.mbo.Mbo'))) {
        throw new Error(
            'The mbo parameter must be an instance of psdi.mbo.Mbo.'
        );
    } else if (!mbo.isBasedOn('MAXMESSAGES')) {
        throw new Error(
            'The mbo parameter must be based on the MAXMESSAGES Maximo object.'
        );
    }

    mbo.setValue('MSGGROUP', this.msgGroup);
    mbo.setValue('MSGKEY', this.msgKey);
    mbo.setValue('VALUE', this.value);
    mbo.setValue('DISPLAYMETHOD', this.displayMethod);

    if (this.msgId) {
        mbo.setValue('MSGID', this.msgId);
    } else {
        this.prefix
            ? mbo.setValue('MSGIDPREFIX', this.prefix)
            : mbo.setValue('MSGIDPREFIX', 'BMXZZ');
        this.suffix
            ? mbo.setValue('MSGIDSUFFIX', this.suffix)
            : mbo.setValue('MSGIDSUFFIX', 'E');
    }

    this.options.forEach(function (option) {
        switch (option.toLowerCase()) {
            case 'ok':
                mbo.setValue('OK', true);
                break;
            case 'close':
                mbo.setValue('CLOSE', true);
                break;
            case 'cancel':
                mbo.setValue('CANCEL', true);
                break;
            case 'yes':
                mbo.setValue('YES', true);
                break;
            case 'no':
                mbo.setValue('NO', true);
                break;
        }
    });

    if (this.adminResponse) {
        mbo.setValue('ADMINRESPONSE', this.adminResponse);
    }

    if (this.explanation) {
        mbo.setValue('EXPLANATION', this.explanation);
    }

    if (this.operatorResponse) {
        mbo.setValue('OPERATORRESPONSE', this.operatorResponse);
    }

    if (this.systemAction) {
        mbo.setValue('SYSTEMACTION', this.systemAction);
    }
};

function Property(property) {
    if (typeof property.propName === 'undefined') {
        throw new Error(
            'The propName property is required and must be a Maximo Property Name field value.'
        );
    }

    this.propName = property.propName;
    this.description =
        typeof property.description === 'undefined' ? '' : property.description;
    this.domainId =
        typeof property.domainId === 'undefined' ? '' : property.domainId;
    this.encrypted =
        typeof property.encrypted === 'undefined'
            ? false
            : property.encrypted == true;
    this.globalOnly =
        typeof property.globalOnly === 'undefined'
            ? false
            : property.globalOnly == true;
    this.instanceOnly =
        typeof property.instanceOnly === 'undefined'
            ? false
            : property.instanceOnly == true;
    this.liveRefresh =
        typeof property.liveRefresh === 'undefined'
            ? true
            : property.liveRefresh == true;
    this.masked =
        typeof property.masked === 'undefined'
            ? false
            : property.masked == true;
    this.maxType =
        typeof property.maxType === 'undefined' ? 'ALN' : property.maxType;
    this.nullsAllowed =
        typeof property.nullsAllowed === 'undefined'
            ? true
            : property.nullsAllowed == true;
    this.onlineChanges =
        typeof property.onlineChanges === 'undefined'
            ? true
            : property.onlineChanges == true;
    this.secureLevel =
        typeof property.secureLevel === 'undefined'
            ? 'PUBLIC'
            : property.secureLevel;
    this.propValue =
        typeof property.propValue === 'undefined' ? '' : property.propValue;

    this.maximoDefault =
        typeof property.maximoDefault === 'undefined'
            ? ''
            : property.maximoDefault;
    if (property.maxPropInstance && Array.isArray(property.maxPropInstance)) {
        property.maxPropInstance.forEach(function (instance) {
            if (
                typeof instance.serverName === 'undefined' ||
                !instance.serverName
            ) {
                throw new Error(
                    'A property instance for property ' +
                        property.propName +
                        ' is missing or has an empty value for the required serverName property.'
                );
            }

            if (instance.serverName.toLowerCase() == 'common') {
                throw new Error(
                    'A property instance for property ' +
                        property.propName +
                        ' has a value of COMMON for the serverName property, define COMMON property values using the dispPropValue property on the root property object.'
                );
            }

            instance.propValue =
                typeof instance.propValue === 'undefined'
                    ? ''
                    : instance.propValue;
            instance.serverHost =
                typeof instance.serverHost === 'undefined'
                    ? ''
                    : instance.serverHost;
        });

        this.maxPropInstance = property.maxPropInstance;
    } else {
        this.maxPropInstance = [];
    }
}

Property.prototype.constructor = Property;
Property.prototype.setMboValues = function (mbo) {
    if (!mbo) {
        throw new Error(
            'A Mbo is required to set values from the Properties object.'
        );
    } else if (!(mbo instanceof Java.type('psdi.mbo.Mbo'))) {
        throw new Error(
            'The mbo parameter must be an instance of psdi.mbo.Mbo.'
        );
    } else if (!mbo.isBasedOn('MAXPROP')) {
        throw new Error(
            'The mbo parameter must be based on the MAXPROP Maximo object.'
        );
    }

    // if this is a system only a select few things can be altered and the property can't be deleted.
    if (mbo.isSystemProperty()) {
        mbo.setValue('DESCRIPTION', this.description);
        mbo.setValue('ENCRYPTED', this.encrypted);
        mbo.setValue('MASKED', this.masked);
        mbo.setValue('DISPPROPVALUE', this.propValue);
    } else {
        if (mbo.toBeAdded()) {
            mbo.setValue('PROPNAME', this.propName);
        }
        mbo.setValue(
            'MAXIMODEFAULT',
            this.maximoDefault,
            MboConstants.NOACCESSCHECK
        );
        mbo.setValue('DESCRIPTION', this.description);
        mbo.setValue('DOMAINID', this.domainId);
        mbo.setValue('ENCRYPTED', this.encrypted);
        mbo.setValue('GLOBALONLY', this.globalOnly);
        mbo.setValue('INSTANCEONLY', this.instanceOnly);
        mbo.setValue('LIVEREFRESH', this.liveRefresh);
        mbo.setValue('MASKED', this.masked);
        mbo.setValue('MAXTYPE', this.maxType);
        mbo.setValue('NULLSALLOWED', this.nullsAllowed);
        mbo.setValue('ONLINECHANGES', this.onlineChanges);
        mbo.setValue('SECURELEVEL', this.secureLevel);

        if (!this.instanceOnly) {
            mbo.setValue('DISPPROPVALUE', this.propValue);
        }
    }

    var maxPropInstanceSet = mbo.getMboSet('MAXPROPINSTANCE');
    maxPropInstanceSet.deleteAll();

    if (!this.globalOnly) {
        this.maxPropInstance.forEach(function (instance) {
            maxPropInstance = maxPropInstanceSet.add();
            maxPropInstance.setValue(
                'DISPPROPVALUE',
                instance.propValue,
                MboConstants.NOVALIDATION
            );
            maxPropInstance.setValue('SERVERNAME', instance.serverName);
            maxPropInstance.setValue('SERVERHOST', instance.serverHost);
        });
    }
    return;
};

function IntegrationObject(intObject) {
    if (!intObject) {
        throw new Error(
            'A integration object JSON is required to create the IntegrationObject object.'
        );
    } else if (typeof intObject.intObjectName === 'undefined') {
        throw new Error(
            'The intObjectName property is required and must a Maximo Integration Object field value.'
        );
    } else if (
        typeof intObject.maxIntObjDetails === 'undefined' ||
        !Array.isArray(intObject.maxIntObjDetails) ||
        intObject.maxIntObjDetails.length == 0
    ) {
        throw new Error(
            'The maxIntObjDetails property is required and must an array that contains at least one Maximo Integration Object Detail object.'
        );
    }

    this.intObjectName = intObject.intObjectName;
    this.description =
        typeof intObject.description === 'undefined'
            ? ''
            : intObject.description;
    this.useWith =
        typeof intObject.useWith === 'undefined' || !intObject.useWith
            ? 'INTEGRATION'
            : intObject.useWith;
    this.defClass =
        typeof intObject.defClass === 'undefined' ? '' : intObject.defClass;
    this.procClass =
        typeof intObject.procClass === 'undefined' ? '' : intObject.procClass;
    this.searchAttrs =
        typeof intObject.searchAttrs === 'undefined'
            ? ''
            : intObject.searchAttrs;
    this.restrictWhere =
        typeof intObject.restrictWhere === 'undefined'
            ? ''
            : intObject.restrictWhere;
    this.module =
        typeof intObject.module === 'undefined' ? '' : intObject.module;
    this.selfReferencing =
        typeof intObject.selfReferencing === 'undefined'
            ? false
            : intObject.selfReferencing == true;
    this.flatSupported =
        typeof intObject.flatSupported === 'undefined'
            ? false
            : intObject.flatSupported == true;
    this.queryOnly =
        typeof intObject.queryOnly === 'undefined'
            ? false
            : intObject.queryOnly == true;
    this.loadQueryFromApp =
        typeof intObject.loadQueryFromApp === 'undefined'
            ? false
            : intObject.loadQueryFromApp == true;
    this.useOSSecurity =
        typeof intObject.useOSSecurity === 'undefined'
            ? false
            : intObject.useOSSecurity == true;
    this.authApp =
        typeof intObject.authApp === 'undefined' ? '' : intObject.authApp;

    if (
        intObject.maxIntObjDetails.find(function (maxIntObjDetail) {
            return (
                typeof maxIntObjDetail.objectName === 'undefined' ||
                !maxIntObjDetail.objectName
            );
        })
    ) {
        throw new Error(
            'The integration object ' +
                this.intObjectName +
                ' contains a object detail record that does not contain an object name.'
        );
    }

    if (
        intObject.maxIntObjDetails.find(function (maxIntObjDetail) {
            return (
                typeof maxIntObjDetail.parentObjName !== 'undefined' &&
                maxIntObjDetail.parentObjName &&
                (typeof maxIntObjDetail.relation === 'undefined' ||
                    !maxIntObjDetail.relation)
            );
        })
    ) {
        throw new Error(
            'The integration object ' +
                this.intObjectName +
                ' contains a child object detail record that does not contain a relation name.'
        );
    }

    var parents = intObject.maxIntObjDetails.filter(function (maxIntObjDetail) {
        return (
            typeof maxIntObjDetail.parentObjName === 'undefined' ||
            !maxIntObjDetail.parentObjName
        );
    });

    if (parents.length == 0) {
        throw new Error(
            'The integration object ' +
                this.intObjectName +
                ' does not have a top level object detail record, a top level parent must be defined for an integration object.'
        );
    }

    if (parents.length > 1) {
        throw new Error(
            'The integration object ' +
                this.intObjectName +
                ' has more than one top level object detail record, only one top level parent can be defined for an integration object.'
        );
    }

    intObject.maxIntObjDetails.forEach(function (maxIntObjDetail) {
        if (
            typeof maxIntObjDetail.maxIntObjCols !== 'undefined' &&
            Array.isArray(maxIntObjDetail.maxIntObjCols)
        ) {
            maxIntObjDetail.maxIntObjCols.forEach(function (obj) {
                if (typeof obj.name === 'undefined' || !obj.name) {
                    throw new Error(
                        'The integration object ' +
                            intObject.intObjectName +
                            ' object ' +
                            maxIntObjDetail.objectName +
                            ' is missing a name property for a maxIntObjCols object.'
                    );
                }
                if (
                    typeof obj.intObjFldType === 'undefined' ||
                    !obj.intObjFldType
                ) {
                    throw new Error(
                        'The integration object ' +
                            intObject.intObjectName +
                            ' object ' +
                            maxIntObjDetail.objectName +
                            ' is missing a intObjFldType property for a maxIntObjCols object.'
                    );
                }
            });
        } else {
            maxIntObjDetail.maxIntObjCols = [];
        }

        if (
            typeof maxIntObjDetail.maxIntObjAlias !== 'undefined' &&
            Array.isArray(maxIntObjDetail.maxIntObjAlias)
        ) {
            if (!intObject.flatSupported) {
                throw new Error(
                    'The maxIntObjAlias entries can only be applied to integration objects that support flat structure, ' +
                        intObject.objectName +
                        ' does not support flat structure.'
                );
            }

            maxIntObjDetail.maxIntObjAlias.forEach(function (obj) {
                if (typeof obj.name === 'undefined' || !obj.name) {
                    throw new Error(
                        'The integration object ' +
                            intObject.intObjectName +
                            ' object ' +
                            maxIntObjDetail.objectName +
                            ' is missing a name property for a maxIntObjAlias object.'
                    );
                }
                if (typeof obj.aliasName === 'undefined' || !obj.aliasName) {
                    throw new Error(
                        'The integration object ' +
                            intObject.intObjectName +
                            ' object ' +
                            maxIntObjDetail.objectName +
                            ' is missing a aliasName property for a maxIntObjAlias object.'
                    );
                }
            });
        } else {
            maxIntObjDetail.maxIntObjAlias = [];
        }

        if (
            typeof maxIntObjDetail.objectAppAuth !== 'undefined' &&
            Array.isArray(maxIntObjDetail.objectAppAuth)
        ) {
            maxIntObjDetail.objectAppAuth.forEach(function (obj) {
                if (typeof obj.context === 'undefined' || !obj.context) {
                    throw new Error(
                        'The integration object ' +
                            intObject.intObjectName +
                            ' object ' +
                            maxIntObjDetail.objectName +
                            ' is missing a context property for a objectAppAuth object.'
                    );
                }
            });
        } else {
            maxIntObjDetail.objectAppAuth = [];
        }

        maxIntObjDetail.skipKeyUpdate =
            typeof maxIntObjDetail.skipKeyUpdate === 'undefined'
                ? false
                : maxIntObjDetail.skipKeyUpdate == true;
        maxIntObjDetail.excludeParentKey =
            typeof maxIntObjDetail.excludeParentKey === 'undefined'
                ? false
                : maxIntObjDetail.excludeParentKey == true;
        maxIntObjDetail.deleteOnCreate =
            typeof maxIntObjDetail.deleteOnCreate === 'undefined'
                ? false
                : maxIntObjDetail.deleteOnCreate == true;
        maxIntObjDetail.propagateEvent =
            typeof maxIntObjDetail.propagateEvent === 'undefined'
                ? false
                : maxIntObjDetail.propagateEvent == true;
        maxIntObjDetail.invokeExecute =
            typeof maxIntObjDetail.invokeExecute === 'undefined'
                ? false
                : maxIntObjDetail.invokeExecute == true;
        maxIntObjDetail.fdResource =
            typeof maxIntObjDetail.fdResource === 'undefined'
                ? ''
                : maxIntObjDetail.fdResource;
    });

    intObject.maxIntObjDetails.sort(function (a, b) {
        if (typeof a.parentObjName === 'undefined' || !a.parentObjName) {
            return -1;
        } else if (typeof b.parentObjName === 'undefined' || !b.parentObjName) {
            return 1;
        } else if (a.objectName == b.parentObjName) {
            return -1;
        } else if (b.objectName == a.parentObjName) {
            return 1;
        } else {
            return 0;
        }
    });

    this.maxIntObjDetails = intObject.maxIntObjDetails;

    this.maxIntObjDetails.forEach(function (obj) {
        obj.parentObjName =
            typeof obj.parentObjName === 'undefined' ? '' : obj.parentObjName;
        obj.relation = typeof obj.relation === 'undefined' ? '' : obj.relation;
        obj.altKey = typeof obj.altKey === 'undefined' ? '' : obj.altKey;
        obj.objectOrder =
            typeof obj.objectOrder === 'undefined' ? 1 : obj.objectOrder;
        obj.excludeByDefault =
            typeof obj.excludeByDefault === 'undefined'
                ? false
                : obj.excludeByDefault == true;
    });

    if (
        typeof intObject.objectAppAuth !== 'undefined' &&
        intObject.objectAppAuth &&
        Array.isArray(intObject.objectAppAuth)
    ) {
        intObject.objectAppAuth.forEach(function (obj) {
            if (typeof obj.context === 'undefined' || !obj.context) {
                throw new Error(
                    'An objectAppAuth entry is missing the required context property.'
                );
            } else if (
                typeof obj.objectName === 'undefined' ||
                !obj.objectName
            ) {
                throw new Error(
                    'An objectAppAuth entry is missing the required objectName property.'
                );
            } else if (typeof obj.authApp === 'undefined' || !obj.authApp) {
                throw new Error(
                    'An objectAppAuth entry is missing the required authApp property.'
                );
            }
            obj.description =
                typeof obj.description == 'undefined' ? '' : obj.description;
        });
        this.objectAppAuth = intObject.objectAppAuth;
    } else {
        this.objectAppAuth = [];
    }

    if (
        typeof intObject.sigOption !== 'undefined' &&
        intObject.sigOption &&
        Array.isArray(intObject.sigOption)
    ) {
        intObject.sigOption.forEach(function (option) {
            if (
                typeof option.optionName === 'undefined' ||
                !option.optionName
            ) {
                throw new Error(
                    'A sigOption entry is missing the required optionName property.'
                );
            }
            option.description =
                typeof option.description === 'undefined'
                    ? ''
                    : option.description;
            option.alsoGrants =
                typeof option.alsoGrants === 'undefined'
                    ? ''
                    : option.alsoGrants;
            option.alsoRevokes =
                typeof option.alsoRevokes === 'undefined'
                    ? ''
                    : option.alsoRevokes;
            option.prerequisite =
                typeof option.prerequisite === 'undefined'
                    ? ''
                    : option.prerequisite;
            option.esigEnabled =
                typeof option.esigEnabled === 'undefined'
                    ? false
                    : option.esigEnabled == true;
            option.visible =
                typeof option.visible === 'undefined'
                    ? true
                    : option.visible == true;
        });

        this.sigOption = intObject.sigOption;
    } else {
        this.sigOption = [];
    }

    if (
        typeof intObject.osOSLCAction !== 'undefined' &&
        intObject.osOSLCAction &&
        Array.isArray(intObject.osOSLCAction)
    ) {
        intObject.osOSLCAction.forEach(function (action) {
            if (typeof action.name === 'undefined' || !action.name) {
                throw new Error(
                    'A osOSLCAction entry is missing the required name property.'
                );
            }

            if (typeof action.implType === 'undefined' || !action.implType) {
                throw new Error(
                    'An osOSLCAction entry is missing the required implType property.'
                );
            } else {
                action.implType = action.implType.toLowerCase();
            }

            var implTypes = ['script', 'system', 'workflow', 'wsmethod'];

            if (implTypes.indexOf(action.implType) < 0) {
                throw new Error(
                    'The osOSLCAction implementation type ' +
                        action.implType +
                        ' is not valid, ' +
                        implTypes.join(',') +
                        ' are the valid implementation types.'
                );
            }

            if (action.implType == 'script') {
                if (
                    typeof action.scriptName === 'undefined' ||
                    !action.scriptName
                ) {
                    throw new Error(
                        'The osOSLCAction entry is missing the required scriptName property for the implementation type of "script".'
                    );
                }
            } else if (action.implType == 'system') {
                if (
                    typeof action.systemName === 'undefined' ||
                    !action.systemName
                ) {
                    throw new Error(
                        'The osOSLCAction entry is missing the required systemName property for the implementation type of "system".'
                    );
                }
            } else if (action.implType == 'workflow') {
                if (
                    typeof action.processName === 'undefined' ||
                    !action.processName
                ) {
                    throw new Error(
                        'The osOSLCAction entry is missing the required processName property for the implementation type of "workflow".'
                    );
                }
            } else if (action.implType == 'wsmethod') {
                if (
                    typeof action.methodName === 'undefined' ||
                    !action.methodName
                ) {
                    throw new Error(
                        'The osOSLCAction entry is missing the required methodName property for the implementation type of "wsmethod".'
                    );
                }
            }

            action.description =
                typeof action.description === 'undefined'
                    ? ''
                    : action.description;
            action.optionName =
                typeof action.optionName === 'undefined'
                    ? ''
                    : action.optionName;
            action.collection =
                typeof action.collection === 'undefined'
                    ? false
                    : action.collection == true;
        });
        this.osOSLCAction = intObject.osOSLCAction;
    } else {
        this.osOSLCAction = [];
    }

    if (
        typeof intObject.oslcQuery !== 'undefined' &&
        intObject.oslcQuery &&
        Array.isArray(intObject.oslcQuery)
    ) {
        intObject.oslcQuery.forEach(function (query) {
            if (typeof query.queryType === 'undefined' || !query.queryType) {
                throw new Error(
                    'A oslcQuery entry is missing the required queryType property.'
                );
            } else {
                query.queryType = query.queryType.toLowerCase();
            }

            var queryTypes = ['appclause', 'method', 'osclause', 'script'];

            if (queryTypes.indexOf(query.queryType) < 0) {
                throw new Error(
                    'The oslcQuery query type ' +
                        query.queryType +
                        ' is not valid, ' +
                        queryTypes.join(',') +
                        ' are the valid query types.'
                );
            }

            if (query.queryType == 'appclause') {
                if (typeof action.app === 'undefined' || !action.app) {
                    throw new Error(
                        'The oslcQuery entry is missing the required app property for the query type of "appclause".'
                    );
                }
                if (
                    typeof action.clauseName === 'undefined' ||
                    !action.clauseName
                ) {
                    throw new Error(
                        'The oslcQuery entry is missing the required clauseName property for the query type of "appclause".'
                    );
                }
            } else if (query.queryType == 'method') {
                if (typeof action.method === 'undefined' || !action.method) {
                    throw new Error(
                        'The oslcQuery entry is missing the required method property for the query type of "method".'
                    );
                }
                query.description =
                    typeof query.description === 'undefined'
                        ? ''
                        : query.description;
            } else if (query.queryType == 'osclause') {
                if (
                    typeof query.clauseName === 'undefined' ||
                    !query.clauseName
                ) {
                    throw new Error(
                        'The oslcQuery entry is missing the required clauseName property for the query type of "osclause".'
                    );
                }
                if (typeof query.clause === 'undefined' || !query.clause) {
                    throw new Error(
                        'The oslcQuery entry is missing the required clause property for the query type of "osclause".'
                    );
                }
                query.description =
                    typeof query.description === 'undefined'
                        ? ''
                        : query.description;
                query.isPublic =
                    typeof query.isPublic === 'undefined'
                        ? true
                        : query.isPublic == true;
            } else if (query.queryType == 'script') {
                if (
                    typeof action.scriptName === 'undefined' ||
                    !query.scriptName
                ) {
                    throw new Error(
                        'The oslcQuery entry is missing the required scriptName property for the query type of "script".'
                    );
                }
            }
        });
        this.oslcQuery = intObject.oslcQuery;
    } else {
        this.oslcQuery = [];
    }

    if (
        typeof intObject.queryTemplate !== 'undefined' &&
        intObject.queryTemplate &&
        Array.isArray(intObject.queryTemplate)
    ) {
        intObject.queryTemplate.forEach(function (template) {
            if (
                typeof template.templateName === 'undefined' ||
                !template.templateName
            ) {
                throw new Error(
                    'A queryTemplate entry is missing the required templateName property.'
                );
            }
            template.description =
                typeof template.description === 'undefined'
                    ? ''
                    : template.description;
            template.pageSize =
                typeof template.pageSize === 'undefined'
                    ? ''
                    : template.pageSize;
            template.role =
                typeof template.role === 'undefined' ? '' : template.role;
            template.searchAttributes =
                typeof template.searchAttributes === 'undefined'
                    ? ''
                    : template.searchAttributes;
            template.timelineAttributes =
                typeof template.timelineAttributes === 'undefined'
                    ? ''
                    : template.timelineAttributes;
            template.isPublic =
                typeof template.isPublic === 'undefined'
                    ? true
                    : template.isPublic == true;

            if (
                typeof template.queryTemplateAttr !== 'undefined' &&
                template.queryTemplateAttr &&
                Array.isArray(template.queryTemplateAttr)
            ) {
                template.queryTemplateAttr.forEach(function (attr) {
                    if (
                        typeof attr.selectAttrName === 'undefined' ||
                        !attr.selectAttrName
                    ) {
                        throw new Error(
                            'A queryTemplateAttr entry is missing the required selectAttrName property.'
                        );
                    }

                    attr.title =
                        typeof attr.title === 'undefined' ? '' : attr.title;
                    attr.selectOrder =
                        typeof attr.selectOrder === 'undefined'
                            ? ''
                            : attr.selectOrder;
                    attr.alias =
                        typeof attr.alias === 'undefined' ? '' : attr.alias;
                    attr.sortByOrder =
                        typeof attr.sortByOrder === 'undefined'
                            ? ''
                            : attr.sortByOrder;
                    attr.sortByOn =
                        typeof attr.sortByOn === 'undefined'
                            ? false
                            : attr.sortByOn == true;
                    attr.ascending =
                        typeof attr.ascending === 'undefined'
                            ? false
                            : attr.ascending == true;
                });
            } else {
                template.queryTemplateAttr = [];
            }
        });
        this.queryTemplate = intObject.queryTemplate;
    } else {
        this.queryTemplate = [];
    }
}

IntegrationObject.prototype.constructor = IntegrationObject;
IntegrationObject.prototype.setMboValues = function (mbo) {
    if (!mbo) {
        throw new Error(
            'A Mbo is required to set values from the IntegrationObject object.'
        );
    } else if (!(mbo instanceof Java.type('psdi.mbo.Mbo'))) {
        throw new Error(
            'The mbo parameter must be an instance of psdi.mbo.Mbo.'
        );
    } else if (!mbo.isBasedOn('MAXINTOBJECT')) {
        throw new Error(
            'The mbo parameter must be based on the MAXINTOBJECT Maximo object.'
        );
    }

    if (mbo.toBeAdded()) {
        mbo.setValue('INTOBJECTNAME', this.intObjectName);
    }

    mbo.setValue('DESCRIPTION', this.description);
    mbo.setValue('USEWITH', this.useWith);
    mbo.setValue('QUERYONLY', this.queryOnly);
    mbo.setValue('FLATSUPPORTED', this.flatSupported);
    mbo.setValue('LOADQUERYFROMAPP', this.loadQueryFromApp);
    mbo.setValue('DEFCLASS', this.defClass);
    mbo.setValue('PROCCLASS', this.procClass);
    mbo.setValue('SEARCHATTRS', this.searchAttrs);
    mbo.setValue('RESTRICTWHERE', this.restrictWhere);
    mbo.setValue('MODULE', this.module);

    var maxIntObjDetailSet = mbo.getMboSet('MAXINTOBJDETAIL');
    this.maxIntObjDetails.forEach(function (obj) {
        var maxIntObjDetail = maxIntObjDetailSet.add();
        maxIntObjDetail.setValue('OBJECTNAME', obj.objectName);
        maxIntObjDetail.setValue('ALTKEY', obj.altKey);
        maxIntObjDetail.setValue('EXCLUDEBYDEFAULT', obj.excludeByDefault);

        maxIntObjDetail.setValue('SKIPKEYUPDATE', obj.skipKeyUpdate);
        maxIntObjDetail.setValue('EXCLUDEPARENTKEY', obj.excludeParentKey);
        maxIntObjDetail.setValue('DELETEONCREATE', obj.deleteOnCreate);
        maxIntObjDetail.setValue('PROPAGATEEVENT', obj.propagateEvent);
        maxIntObjDetail.setValue('INVOKEEXECUTE', obj.invokeExecute);
        maxIntObjDetail.setValue('FDRESOURCE', obj.fdResource);

        if (obj.parentObjName) {
            maxIntObjDetail.setValue('PARENTOBJNAME', obj.parentObjName);
            maxIntObjDetail.setValue('RELATION', obj.relation);
            maxIntObjDetail.setValue('OBJECTORDER', obj.objectOrder);
        }

        var maxIntObjColsSet = maxIntObjDetail.getMboSet('MAXINTOBJCOLS');

        obj.maxIntObjCols.forEach(function (maxIntObjCol) {
            var maxIntObjCols = maxIntObjColsSet.add();
            maxIntObjCols.setValue('NAME', maxIntObjCol.name);
            maxIntObjCols.setValue('INTOBJFLDTYPE', maxIntObjCol.intObjFldType);
        });

        var maxIntObjAliasSet = maxIntObjDetail.getMboSet('MAXINTOBJALIAS');

        obj.maxIntObjAlias.forEach(function (maxIntObjAliasObj) {
            var maxIntObjAlias = maxIntObjAliasSet.add();
            maxIntObjAlias.setValue('NAME', maxIntObjAliasObj.name);
            maxIntObjAlias.setValue('ALIASNAME', maxIntObjAliasObj.aliasName);
        });

        var objectAppAuthSet = maxIntObjDetail.getMboSet(
            '$objectappauth',
            'OBJECTAPPAUTH',
            '1=1'
        );

        obj.objectAppAuth.forEach(function (objAppAuth) {
            objectAppAuth = objectAppAuthSet.add();
            objectAppAuth.setValue('CONTEXT', objAppAuth.context);
            objectAppAuth.setValue('DESCRIPTION', objAppAuth.description);
            objectAppAuth.setValue('OBJECTNAME', obj.objectName);
            objectAppAuth.setValue('AUTHAPP', objAppAuth.authApp);
        });
    });

    if (!this.useOSSecurity && this.authApp) {
        mbo.setValue('AUTHAPP', this.authApp);
    } else if (this.useOSSecurity) {
        mbo.setValue('USEOSSECURITY', this.useOSSecurity);
    }
    var sigOptionSet = mbo.getMboSet('SIGOPTION');
    this.sigOption.forEach(function (option) {
        var sigOption = sigOptionSet.add();
        sigOption.setValue('OPTIONNAME', option.optionName);
        sigOption.setValue('DESCRIPTION', option.description);
        sigOption.setValue('ALSOGRANTS', option.alsoGrants);
        sigOption.setValue('ALSOREVOKES', option.alsoRevokes);
        sigOption.setValue('PREREQUISITE', option.prerequisite);
        sigOption.setValue('ESIGENABLED', option.esigEnabled);
        sigOption.setValue('VISIBLE', option.visible);
    });

    var osOSLCActionSet = mbo.getMboSet('OSOSLCACTION');

    var checkSigOptions = this.sigOption;
    this.osOSLCAction.forEach(function (action) {
        var osOSLCAction = osOSLCActionSet.add();
        osOSLCAction.setValue('NAME', action.name);
        osOSLCAction.setValue('DESCRIPTION', action.description);
        osOSLCAction.setValue('IMPLTYPE', action.implType);
        switch (action.implType) {
            case 'system':
                osOSLCAction.setValue('SYSTEMNAME', action.systemName);
                break;
            case 'script':
                osOSLCAction.setValue('SCRIPTNAME', action.scriptName);
                break;
            case 'workflow':
                osOSLCAction.setValue('PROCESSNAME', action.processName);
                break;
            case 'wsmethod':
                osOSLCAction.setValue('METHODNAME', action.methodName);
                break;
        }
        if (action.optionName) {
            if (
                checkSigOptions.find(function (option) {
                    return option.optionName === action.optionName;
                })
            ) {
                osOSLCAction.setValue(
                    'OPTIONNAME',
                    action.optionName,
                    MboConstants.NOVALIDATION
                );
            } else {
                osOSLCAction.setValue('OPTIONNAME', action.optionName);
            }
        }
        osOSLCAction.setValue('COLLECTION', action.collection);
    });

    var oslcQuerySet = mbo.getMboSet('OSLCQUERY');

    this.oslcQuery.forEach(function (query) {
        var oslcQuery = oslcQuerySet.add();
        oslcQuery.setValue('QUERYTYPE', query.queryType);
        switch (query.queryType) {
            case 'appclause':
                oslcQuery.setValue('APP', query.app);
                oslcQuery.setValeu('CLAUSENAME', query.clauseName);
                break;
            case 'method':
                oslcQuery.setValue('METHOD', query.method);
                oslcQuery.setValue('DESCRIPTION', query.description);
                break;
            case 'osclause':
                oslcQuery.setValue('CLAUSENAME', query.clauseName);
                oslcQuery.setValue('DESCRIPTION', query.description);
                oslcQuery.setValue('CLAUSE', query.clause);
                oslcQuery.setValue('ISPUBLIC', query.isPublic);
                break;
            case 'script':
                oslcQuery.setValue('SCRIPT', query.script);
                break;
        }
    });

    var queryTemplateSet = mbo.getMboSet('QUERYTEMPLATE');

    this.queryTemplate.forEach(function (template) {
        var queryTemplate = queryTemplateSet.add();
        queryTemplate.setValue('TEMPLATENAME', template.templateName);
        queryTemplate.setValue('DESCRIPTION', template.description);
        queryTemplate.setValue('PAGESIZE', template.pageSize);
        queryTemplate.setValue('ROLE', template.role);
        queryTemplate.setValue('SEARCHATTRIBUTES', template.searchAttributes);
        queryTemplate.setValue(
            'TIMELINEATTRIBUTE',
            template.timelineAttributes
        );
        queryTemplate.setValue('ISPUBLIC', template.isPublic);

        var queryTemplateAttrSet = queryTemplate.getMboSet('QUERYTEMPLATEATTR');
        template.queryTemplateAttr.forEach(function (attr) {
            var queryTemplateAttr = queryTemplateAttrSet.add();
            queryTemplateAttr.setValue('SELECTATTRNAME', attr.selectAttrName);
            queryTemplateAttr.setValue('TITLE', attr.title);
            queryTemplateAttr.setValue('SELECTORDER', attr.selectOrder);
            queryTemplateAttr.setValue('ALIAS', attr.alias);
            queryTemplateAttr.setValue('SORTBYON', attr.sortByOn);
            queryTemplateAttr.setValue('ASCENDING', attr.ascending);
            queryTemplateAttr.setValue('SORTBYORDER', attr.sortByOrder);
        });
    });
};

function Action(action) {
    if (!action) {
        throw new Error(
            'An action JSON is required to create the Action object.'
        );
    } else if (typeof action.useWith === 'undefined') {
        throw new Error(
            'The useWeith property is required and must be a Maximo useWith field value.'
        );
    } else if (typeof action.type === 'undefined') {
        throw new Error(
            'The type property is required and must be a Maximo type field value.'
        );
    } else if (typeof action.action === 'undefined') {
        throw new Error(
            'The action property is required and must be a Maximo action field value.'
        );
    }

    this.action = action.action;
    this.useWith = action.useWith;
    this.type = action.type;
    this.description =
        typeof action.description === 'undefined' ? '' : action.description;
    if (action.type == 'APPACTION' && typeof action.value === 'undefined') {
        throw new Error(
            'The value property is required for Application Action type actions.'
        );
    } else if (
        action.type == 'CHANGESTATUS' &&
        typeof action.objectName === 'undefined'
    ) {
        throw new Error(
            'The objectName property is required for Change Status type actions.'
        );
    } else if (
        action.type == 'CUSTOM' &&
        typeof action.objectName === 'undefined'
    ) {
        throw new Error(
            'The objectName property is required for Custom Class type actions.'
        );
    } else if (
        action.type == 'SETVALUE' &&
        (typeof action.objectName === 'undefined' ||
            typeof action.parameter === 'undefined')
    ) {
        throw new Error(
            'The objectName  and parameter properties are required for Set Value type actions.'
        );
    }
    //no fields are required for EXECUTABLE or GROUP action types

    this.value = typeof action.value === 'undefined' ? '' : action.value;
    this.objectName =
        typeof action.objectName === 'undefined' ? '' : action.objectName;
    this.parameter =
        typeof action.parameter === 'undefined' ? '' : action.parameter;
    this.memo = typeof action.memo === 'undefined' ? '' : action.memo;

    //add any action group members
    if (
        typeof action.actionGroup !== 'undefined' &&
        Array.isArray(action.actionGroup)
    ) {
        action.actionGroup.forEach(function (group) {
            if (typeof group.member === 'undefined') {
                throw new Error(
                    'The member property is required for each action group member.'
                );
            } else if (typeof group.sequence === 'undefined') {
                throw new Error(
                    'The sequence property is required for each action group member'
                );
            }
        });
        this.actionGroup = action.actionGroup;
    } else {
        this.actionGroup = [];
    }
}

Action.prototype.constructor = Action;
Action.prototype.setMboValues = function (mbo) {
    if (!mbo) {
        throw new Error(
            'A Mbo is required to set values from the ACTION object.'
        );
    } else if (!(mbo instanceof Java.type('psdi.mbo.Mbo'))) {
        throw new Error(
            'The mbo parameter must be an instance of psdi.mbo.Mbo.'
        );
    } else if (!mbo.isBasedOn('ACTION')) {
        throw new Error(
            'The mbo parameter must be based on the ACTION Maximo object.'
        );
    }

    mbo.setValue('ACTION', this.action);
    mbo.setValue('USEWITH', this.useWith);
    mbo.setValue('DESCRIPTION', this.description);
    mbo.setValue('TYPE', this.type);
    if (this.type == 'CUSTOM') {
        mbo.setValue('VALUE', this.value);
    } else {
        mbo.setValue('VALUE2', this.value);
    }
    if (this.type != 'GROUP') {
        mbo.setValue('OBJECTNAME', this.objectName);
        mbo.setValue('PARAMETER', this.parameter);
    }
    if (this.type == 'CHANGESTATUS') {
        mbo.setValue('MEMO', this.memo);
    }

    var actionGroupSet = mbo.getMboSet('ACTION_MEMBERS');
    this.actionGroup.forEach(function (group) {
        var groupMbo = actionGroupSet.add();
        groupMbo.setValue('MEMBER', group.member);
        groupMbo.setValue('SEQUENCE', group.sequence);
    });
};

function InvocationChannel(invocationChannel) {
    if (!invocationChannel) {
        throw new Error(
            'A invocationChannel JSON is required to create the InvocationChannel object.'
        );
    } else if (typeof invocationChannel.ifaceName === 'undefined') {
        throw new Error(
            'The ifaceName property is required and must be a Maximo ifaceName field value.'
        );
    } else if (typeof invocationChannel.intObjectName === 'undefined') {
        throw new Error(
            'The intObjectName property is required and must be a Maximo intObjectName field value.'
        );
    }

    this.ifaceName = invocationChannel.ifaceName;
    this.intObjectName = invocationChannel.intObjectName;
    this.description =
        typeof invocationChannel.description === 'undefined'
            ? ''
            : invocationChannel.description;
    this.bidiConfig =
        typeof invocationChannel.bidiConfig === 'undefined'
            ? ''
            : invocationChannel.bidiConfig;
    this.ifaceType =
        typeof invocationChannel.ifaceType === 'undefined'
            ? 'MAXIMO'
            : invocationChannel.ifaceType;
    this.endPointName =
        typeof invocationChannel.endPointName === 'undefined'
            ? ''
            : invocationChannel.endPointName;
    this.processResponse =
        typeof invocationChannel.processResponse === 'undefined'
            ? false
            : invocationChannel.processResponse == true;
    this.ifaceExitClass =
        typeof invocationChannel.ifaceExitClass === 'undefined'
            ? ''
            : invocationChannel.ifaceExitClass;
    this.ifaceUserExitClass =
        typeof invocationChannel.ifaceUserExitClass === 'undefined'
            ? ''
            : invocationChannel.ifaceUserExitClass;
    this.ifaceMapName =
        typeof invocationChannel.ifaceMapName === 'undefined'
            ? ''
            : invocationChannel.ifaceMapName;
    if (
        invocationChannel.processResponse == true &&
        typeof invocationChannel.replyIntObjName === 'undefined'
    ) {
        throw new Error(
            'A reponse object structure name is required when the process response checkbox is checked.'
        );
    }
    this.replyIntObjName =
        typeof invocationChannel.replyIntObjName === 'undefined'
            ? ''
            : invocationChannel.replyIntObjName;
    this.replyExitClass =
        typeof invocationChannel.replyExitClass === 'undefined'
            ? ''
            : invocationChannel.replyExitClass;
    this.replyUserExitClass =
        typeof invocationChannel.replyUserExitClass === 'undefined'
            ? ''
            : invocationChannel.replyUserExitClass;
    this.replyMapName =
        typeof invocationChannel.replyMapName === 'undefined'
            ? ''
            : invocationChannel.replyMapName;
}

InvocationChannel.prototype.constructor = InvocationChannel;
InvocationChannel.prototype.setMboValues = function (mbo) {
    if (!mbo) {
        throw new Error(
            'A Mbo is required to set values from the MAXIFACEINVOKE object.'
        );
    } else if (!(mbo instanceof Java.type('psdi.mbo.Mbo'))) {
        throw new Error(
            'The mbo parameter must be an instance of psdi.mbo.Mbo.'
        );
    } else if (!mbo.isBasedOn('MAXIFACEINVOKE')) {
        throw new Error(
            'The mbo parameter must be based on the MAXIFACEINVOKE Maximo object.'
        );
    }

    mbo.setValue('IFACENAME', this.ifaceName);
    mbo.setValue('INTOBJECTNAME', this.intObjectName);
    mbo.setValue('DESCRIPTION', this.description);
    mbo.setValue('BIDICONFIG', this.bidiConfig);
    mbo.setValue('IFACETYPE', this.ifaceType);
    mbo.setValue('ENDPOINTNAME', this.endPointName);
    mbo.setValue('PROCESSRESPONSE', this.processResponse);
    mbo.setValue('IFACEEXITCLASS', this.ifaceExitClass);
    mbo.setValue('IFACEUSEREXITCLASS', this.ifaceUserExitClass);
    mbo.setValue('IFACEMAPNAME', this.ifaceMapName);
    mbo.setValue('REPLYINTOBJNAME', this.replyIntObjName);
    mbo.setValue('REPLYEXITCLASS', this.replyExitClass);
    mbo.setValue('REPLYUSEREXITCLASS', this.replyUserExitClass);
    mbo.setValue('REPLYMAPNAME', this.replyMapName);
};

function EnterpriseService(enterpriseService) {
    if (!enterpriseService) {
        throw new Error(
            'A integration object JSON is required to create the enterpriseService object.'
        );
    } else if (typeof enterpriseService.ifaceName === 'undefined') {
        throw new Error(
            'The ifaceName property is required and must a Maximo Publish Channel field value.'
        );
    } else if (typeof enterpriseService.intObjectName === 'undefined') {
        throw new Error(
            'The intObjectName property is required and must a Maximo Publish Channel field value.'
        );
    }

    this.ifaceName = enterpriseService.ifaceName;
    this.description =
        typeof enterpriseService.description === 'undefined'
            ? ''
            : enterpriseService.description;
    this.messageType =
        typeof enterpriseService.messageType === 'undefined'
            ? 'Sync'
            : enterpriseService.messageType;
    //options: Create, Delete, Query, Sync, Update
    this.intObjectName = enterpriseService.intObjectName;
    this.ifaceExitClass =
        typeof enterpriseService.ifaceExitClass === 'undefined'
            ? ''
            : enterpriseService.ifaceExitClass;
    this.ifaceType =
        typeof enterpriseService.ifaceType === 'undefined'
            ? 'MAXIMO'
            : enterpriseService.ifaceType;
    this.ifaceTBName =
        typeof enterpriseService.ifaceTBName === 'undefined'
            ? ''
            : enterpriseService.ifaceTBName;
    this.ifaceMapName =
        typeof enterpriseService.ifaceMapName === 'undefined'
            ? ''
            : enterpriseService.ifaceMapName;
    this.ifaceUserExitClass =
        typeof enterpriseService.ifaceUserExitClass === 'undefined'
            ? ''
            : enterpriseService.ifaceUserExitClass;
    this.ifaceControl =
        typeof enterpriseService.ifaceControl === 'undefined'
            ? ''
            : enterpriseService.ifaceControl;
    this.useExternalSchema =
        typeof enterpriseService.useExternalSchema === 'undefined'
            ? false
            : enterpriseService.useExternalSchema == true;
    this.schemaLocation =
        typeof enterpriseService.schemaLocation === 'undefined'
            ? ''
            : enterpriseService.schemaLocation;
    this.elementName =
        typeof enterpriseService.elementName === 'undefined'
            ? ''
            : enterpriseService.elementName;
    this.replyExitClass =
        typeof enterpriseService.replyExitClass === 'undefined'
            ? ''
            : enterpriseService.replyExitClass;
    this.replyUserExitClass =
        typeof enterpriseService.replyUserExitClass === 'undefined'
            ? ''
            : enterpriseService.replyUserExitClass;
    this.replyMapName =
        typeof enterpriseService.replyMapName === 'undefined'
            ? ''
            : enterpriseService.replyMapName;
    this.replySchemaLoc =
        typeof enterpriseService.replySchemaLoc === 'undefined'
            ? ''
            : enterpriseService.replySchemaLoc;
    this.replyElementName =
        typeof enterpriseService.replyElementName === 'undefined'
            ? ''
            : enterpriseService.replyElementName;

    //associated processing rules
    if (
        enterpriseService.maxIfaceProc &&
        Array.isArray(enterpriseService.maxIfaceProc)
    ) {
        enterpriseService.maxIfaceProc.forEach(function (ifaceProc) {
            if (
                typeof ifaceProc.procName === 'undefined' ||
                !ifaceProc.procName
            ) {
                throw new Error(
                    'A processing rule name for enterprise service ' +
                        enterpriseService.ifaceName +
                        ' is missing or has an empty value for the required procName property.'
                );
            }
            if (
                typeof ifaceProc.procType === 'undefined' ||
                !ifaceProc.procType
            ) {
                throw new Error(
                    'An action for enterprise service ' +
                        enterpriseService.ifaceName +
                        ' enterprise service, ' +
                        ifaceProc.procName +
                        ' rule is missing or has an empty value for the required procType property.'
                );
            }
            if (
                typeof ifaceProc.procSequence === 'undefined' ||
                !ifaceProc.procSequence
            ) {
                throw new Error(
                    'A sequence for enterprise service ' +
                        enterpriseService.ifaceName +
                        ' enterprise service, ' +
                        ifaceProc.procName +
                        ' rule is missing or has an empty value for the required procSequence property.'
                );
            }

            ifaceProc.description =
                typeof ifaceProc.description === 'undefined'
                    ? ''
                    : ifaceProc.description;
            ifaceProc.enabled =
                typeof ifaceProc.enabled === 'undefined'
                    ? false
                    : ifaceProc.enabled == true;
            ifaceProc.procMessage =
                typeof ifaceProc.procMessage === 'undefined'
                    ? ''
                    : ifaceProc.procMessage;
            ifaceProc.applyOnInsert =
                typeof ifaceProc.applyOnInsert === 'undefined'
                    ? true
                    : ifaceProc.applyOnInsert == true;
            ifaceProc.applyOnUpdate =
                typeof ifaceProc.applyOnUpdate === 'undefined'
                    ? true
                    : ifaceProc.applyOnUpdate == true;
            ifaceProc.applyOnDelete =
                typeof ifaceProc.applyOnDelete === 'undefined'
                    ? true
                    : ifaceProc.applyOnDelete == true;
            ifaceProc.isInbound = true;
            ifaceProc.isObjectProc =
                typeof ifaceProc.isObjectProc === 'undefined'
                    ? false
                    : ifaceProc.isObjectProc == true;

            //processing rule fields / conditions
            //variable used to pass the processing rule name to the field/conditions
            var processingRuleName = ifaceProc.procName;
            if (
                ifaceProc.procType == 'SET' ||
                ifaceProc.procType == 'REPLACE'
            ) {
                ifaceProc.maxProcCols = [];
                if (
                    typeof ifaceProc.maxReplaceProc !== 'undefined' &&
                    ifaceProc.maxReplaceProc &&
                    Array.isArray(ifaceProc.maxReplaceProc)
                ) {
                    ifaceProc.maxReplaceProc.forEach(function (setReplaceProc) {
                        if (
                            typeof setReplaceProc.valueType === 'undefined' ||
                            !setReplaceProc.valueType
                        ) {
                            throw new Error(
                                'A value type is required for the ' +
                                    processingRuleName +
                                    ' rule.'
                            );
                        }
                        if (
                            typeof setReplaceProc.value === 'undefined' ||
                            !setReplaceProc.value
                        ) {
                            throw new Error(
                                'A value is required for the ' +
                                    processingRuleName +
                                    ' rule.'
                            );
                        }
                        if (
                            typeof setReplaceProc.fieldName === 'undefined' ||
                            !setReplaceProc.fieldName
                        ) {
                            throw new Error(
                                'A field is required for the ' +
                                    processingRuleName +
                                    ' rule.'
                            );
                        }
                        if (
                            setReplaceProc.valueType.toUpperCase() == 'MBOFIELD'
                        ) {
                            if (
                                typeof setReplaceProc.relation ===
                                    'undefined' ||
                                !setReplaceProc.relation
                            ) {
                                throw new Error(
                                    'A relationship is required for the ' +
                                        processingRuleName +
                                        ' rule.'
                                );
                            }
                            if (
                                typeof setReplaceProc.mboName === 'undefined' ||
                                !setReplaceProc.mboName
                            ) {
                                throw new Error(
                                    'A relationship is required for the ' +
                                        processingRuleName +
                                        ' rule.'
                                );
                            }
                            if (
                                typeof setReplaceProc.mboColumnName ===
                                    'undefined' ||
                                !setReplaceProc.mboColumnName
                            ) {
                                throw new Error(
                                    'A relationship is required for the ' +
                                        processingRuleName +
                                        ' rule.'
                                );
                            }
                        }
                        setReplaceProc.relation =
                            typeof setReplaceProc.relation === 'undefined'
                                ? ''
                                : setReplaceProc.relation;
                        setReplaceProc.mboName =
                            typeof setReplaceProc.mboName === 'undefined'
                                ? ''
                                : setReplaceProc.mboName;
                        setReplaceProc.valueType =
                            typeof setReplaceProc.valueType === 'undefined'
                                ? ''
                                : setReplaceProc.valueType;
                        setReplaceProc.fieldName =
                            typeof setReplaceProc.fieldName === 'undefined'
                                ? ''
                                : setReplaceProc.fieldName;
                        setReplaceProc.mboColumnName =
                            typeof setReplaceProc.mboColumnName === 'undefined'
                                ? ''
                                : setReplaceProc.mboColumnName;
                        setReplaceProc.replaceNull =
                            typeof setReplaceProc.replaceNull === 'undefined'
                                ? false
                                : setReplaceProc.replaceNull == true;
                        setReplaceProc.useWith =
                            typeof setReplaceProc.useWith === 'undefined'
                                ? 'ESOBJECTSTRUCTURE'
                                : setReplaceProc.useWith;
                    });
                } else {
                    ifaceProc.maxReplaceProc = [];
                }
            } else if (
                ifaceProc.procType == 'COMBINE' ||
                ifaceProc.procType == 'SPLIT'
            ) {
                ifaceProc.maxReplaceProc = [];
                if (
                    ifaceProc.maxProcCols &&
                    Array.isArray(ifaceProc.maxProcCols)
                ) {
                    ifaceProc.maxProcCols.forEach(function (combineSplitProc) {
                        if (
                            typeof combineSplitProc.fieldName === 'undefined' ||
                            !combineSplitProc.fieldName
                        ) {
                            throw new Error(
                                'A fieldName is required for the ' +
                                    processingRuleName +
                                    ' rule.'
                            );
                        }

                        combineSplitProc.ifaceControl =
                            typeof combineSplitProc.ifaceControl === 'undefined'
                                ? ''
                                : combineSplitProc.ifaceControl;

                        //source fields - throw error if this set is empty / not provided
                        if (
                            combineSplitProc.maxTransformProc &&
                            Array.isArray(combineSplitProc.maxTransformProc)
                        ) {
                            combineSplitProc.maxTransformProc.forEach(function (
                                transformProc
                            ) {
                                if (
                                    (typeof transformProc.transFieldName ===
                                        'undefined' ||
                                        !transformProc.transFieldName) &&
                                    (typeof transformProc.ifaceControl ===
                                        'undefined' ||
                                        !transformProc.ifaceControl)
                                ) {
                                    throw new Error(
                                        'A transFieldName or ifaceControl is required for the ' +
                                            processingRuleName +
                                            ' rule.'
                                    );
                                }
                            });
                        } else {
                            ifaceProc.maxTransformProc = [];
                            throw new Error(
                                'A set of transform / source sub-record fields is required for combine and split processing rules'
                            );
                        }
                    });
                } else {
                    ifaceProc.maxProcCols = [];
                }
            } else if (
                ifaceProc.procType == 'SKIP' ||
                ifaceProc.procType == 'SKIPCHILDREN' ||
                ifaceProc.procType == 'SKIPRECORD' ||
                ifaceProc.procType == 'STOP'
            ) {
                ifaceProc.maxReplaceProc = [];
                ifaceProc.maxProcCols = [];
            } else {
                throw new Error(
                    'The processing action ' +
                        ifaceProc.procType +
                        ' for enterprise service ' +
                        publishChannel.ifaceName +
                        ' enterprise service, ' +
                        ifaceProc.procName +
                        ' rule is not a recognized action value.'
                );
            }

            //add/modify conditions
            if (
                ifaceProc.maxIfaceCond &&
                Array.isArray(ifaceProc.maxIfaceCond)
            ) {
                ifaceProc.maxIfaceCond.forEach(function (ifaceCond) {
                    if (
                        typeof ifaceCond.condition === 'undefined' ||
                        !ifaceCond.condition
                    ) {
                        throw new Error(
                            'A condition number is required for the ' +
                                processingRuleName +
                                ' rule.'
                        );
                    }

                    if (
                        ifaceCond.maxCondDetail &&
                        Array.isArray(ifaceCond.maxCondDetail)
                    ) {
                        ifaceCond.maxCondDetail.forEach(function (condDetail) {
                            if (
                                typeof condDetail.condType === 'undefined' ||
                                !condDetail.condType
                            ) {
                                throw new Error(
                                    'A condition type is required for the ' +
                                        processingRuleName +
                                        ' rule.'
                                );
                            }
                            if (
                                typeof condDetail.compareType === 'undefined' ||
                                !condDetail.compareType
                            ) {
                                throw new Error(
                                    'A compare type is required for the ' +
                                        processingRuleName +
                                        ' rule.'
                                );
                            }
                            if (
                                typeof condDetail.condSequence ===
                                    'undefined' ||
                                !condDetail.condSequence
                            ) {
                                throw new Error(
                                    'A condition sequence is required for the ' +
                                        processingRuleName +
                                        ' rule.'
                                );
                            }
                            if (
                                condDetail.condType == 'IFACECONTROL' ||
                                condDetail.condType == 'MAXVAR'
                            ) {
                                if (
                                    typeof condDetail.columnName ===
                                        'undefined' ||
                                    !condDetail.columnName
                                ) {
                                    throw new Error(
                                        'A column name is required for the ' +
                                            processingRuleName +
                                            ' rule.'
                                    );
                                }
                                if (
                                    typeof condDetail.value === 'undefined' ||
                                    !condDetail.value
                                ) {
                                    throw new Error(
                                        'A value is required for the ' +
                                            processingRuleName +
                                            ' rule.'
                                    );
                                }
                            } else if (condDetail.condType == 'MBO') {
                                if (
                                    typeof condDetail.mboColumnName ===
                                        'undefined' ||
                                    !condDetail.mboColumnName
                                ) {
                                    throw new Error(
                                        'A mbo column name is required for the ' +
                                            processingRuleName +
                                            ' rule.'
                                    );
                                }
                                if (
                                    typeof condDetail.value === 'undefined' ||
                                    !condDetail.value
                                ) {
                                    throw new Error(
                                        'A value is required for the ' +
                                            processingRuleName +
                                            ' rule.'
                                    );
                                }
                                if (
                                    typeof condDetail.relation ===
                                        'undefined' ||
                                    !condDetail.relation
                                ) {
                                    throw new Error(
                                        'A relation is required for the ' +
                                            processingRuleName +
                                            ' rule.'
                                    );
                                }
                                if (
                                    typeof condDetail.mboName === 'undefined' ||
                                    !condDetail.mboName
                                ) {
                                    throw new Error(
                                        'A mbo name is required for the ' +
                                            processingRuleName +
                                            ' rule.'
                                    );
                                }
                            } else if (condDetail.condType == 'FIELD') {
                                if (condDetail.compareType == 'MBOFIELD') {
                                    if (
                                        typeof condDetail.mboColumnName ===
                                            'undefined' ||
                                        !condDetail.mboColumnName
                                    ) {
                                        throw new Error(
                                            'A mbo column name is required for the ' +
                                                processingRuleName +
                                                ' rule.'
                                        );
                                    }
                                    if (
                                        typeof condDetail.columnName ===
                                            'undefined' ||
                                        !condDetail.columnName
                                    ) {
                                        throw new Error(
                                            'A column name is required for the ' +
                                                processingRuleName +
                                                ' rule.'
                                        );
                                    }
                                    if (
                                        typeof condDetail.relation ===
                                            'undefined' ||
                                        !condDetail.relation
                                    ) {
                                        throw new Error(
                                            'A relation is required for the ' +
                                                processingRuleName +
                                                ' rule.'
                                        );
                                    }
                                    if (
                                        typeof condDetail.mboName ===
                                            'undefined' ||
                                        !condDetail.mboName
                                    ) {
                                        throw new Error(
                                            'A mbo name is required for the ' +
                                                processingRuleName +
                                                ' rule.'
                                        );
                                    }
                                } else {
                                    if (
                                        typeof condDetail.columnName ===
                                            'undefined' ||
                                        !condDetail.columnName
                                    ) {
                                        throw new Error(
                                            'A column name is required for the ' +
                                                processingRuleName +
                                                ' rule.'
                                        );
                                    }
                                    if (
                                        typeof condDetail.value ===
                                            'undefined' ||
                                        !condDetail.value
                                    ) {
                                        throw new Error(
                                            'A value is required for the ' +
                                                processingRuleName +
                                                ' rule.'
                                        );
                                    }
                                }
                            } else if (condDetail.condType == 'MBOSET') {
                                if (
                                    typeof condDetail.relation ===
                                        'undefined' ||
                                    !condDetail.relation
                                ) {
                                    throw new Error(
                                        'A relation is required for the ' +
                                            processingRuleName +
                                            ' rule.'
                                    );
                                }
                                if (
                                    typeof condDetail.mboName === 'undefined' ||
                                    !condDetail.mboName
                                ) {
                                    throw new Error(
                                        'A mbo name is required for the ' +
                                            processingRuleName +
                                            ' rule.'
                                    );
                                }
                            } else {
                                throw new Error(
                                    'Provided condition type and/or compare type value is invalid.'
                                );
                            }

                            condDetail.mboColumnName =
                                typeof condDetail.mboColumnName === 'undefined'
                                    ? ''
                                    : condDetail.mboColumnName;
                            condDetail.columnName =
                                typeof condDetail.columnName === 'undefined'
                                    ? ''
                                    : condDetail.columnName;
                            condDetail.relation =
                                typeof condDetail.relation === 'undefined'
                                    ? ''
                                    : condDetail.relation;
                            condDetail.mboName =
                                typeof condDetail.mboName === 'undefined'
                                    ? ''
                                    : condDetail.mboName;
                            condDetail.mboColumnName =
                                typeof condDetail.mboColumnName === 'undefined'
                                    ? ''
                                    : condDetail.mboColumnName;
                            condDetail.value =
                                typeof condDetail.value === 'undefined'
                                    ? ''
                                    : condDetail.value;
                            condDetail.changeType =
                                typeof condDetail.changeType === 'undefined'
                                    ? 'ALWAYS'
                                    : condDetail.changeType;
                            if (
                                condDetail.compareType.toUpperCase() ==
                                'IFACECONTROL'
                            ) {
                                condDetail.evalType = 'EXISTS';
                            } else {
                                condDetail.evalType = 'EQUALS';
                            }
                        });
                    } else {
                        ifaceCond.condDetail = [];
                    }
                });
            } else {
                ifaceProc.maxIfaceCond = [];
            }
        });

        this.maxIfaceProc = enterpriseService.maxIfaceProc;
    } else {
        this.maxIfaceProc = [];
    }
}

EnterpriseService.prototype.constructor = EnterpriseService;
EnterpriseService.prototype.setMboValues = function (mbo) {
    if (!mbo) {
        throw new Error(
            'A Mbo is required to set values from the enterprise service object.'
        );
    } else if (!(mbo instanceof Java.type('psdi.mbo.Mbo'))) {
        throw new Error(
            'The mbo parameter must be an instance of psdi.mbo.Mbo.'
        );
    } else if (!mbo.isBasedOn('MAXIFACEIN')) {
        throw new Error(
            'The mbo parameter must be based on the MAXENDPOINT Maximo object.'
        );
    }
    if (mbo.toBeAdded()) {
        mbo.setValue('IFACENAME', this.ifaceName);
        mbo.setValue('INTOBJECTNAME', this.intObjectName);
    }
    mbo.setValue('DESCRIPTION', this.description);
    mbo.setValue('MESSAGETYPE', this.messageType);
    mbo.setValue('IFACEEXITCLASS', this.ifaceExitClass);
    mbo.setValue('IFACETYPE', this.ifaceType);
    mbo.setValue('IFACETBNAME', this.ifaceTBName);
    mbo.setValue('IFACEMAPNAME', this.ifaceMapName);
    mbo.setValue('IFACEUSEREXITCLASS', this.ifaceUserExitClass);
    mbo.setValue('IFACECONTROL', this.ifaceControl);
    mbo.setValue('USEEXTERNALSCHEMA', this.useExternalSchema);
    mbo.setValue('SCHEMALOCATION', this.schemaLocation);
    mbo.setValue('ELEMENTNAME', this.elementName);
    if (this.messageType == 'Create' || this.messageType == 'Query') {
        mbo.setValue('REPLYEXITCLASS', this.replyExitClass);
        mbo.setValue('REPLYUSEREXITCLASS', this.replyUserExitClass);
        mbo.setValue('REPLYMAPNAME', this.replyMapName);
    }
    mbo.setValue('REPLYSCHEMALOC', this.replySchemaLoc);
    mbo.setValue('REPLYELEMENTNAME', this.replyElementName);

    var maxIntObjDetail = mbo.getMboSet('MAXINTOBJDETAIL').moveFirst();
    var maxIfaceProcInSet = maxIntObjDetail.getMboSet('MAXIFACEPROCOUT');
    maxIfaceProcInSet.deleteAll();

    this.maxIfaceProc.forEach(function (ifaceProc) {
        var maxIfaceProcInMbo = maxIfaceProcInSet.add();
        maxIfaceProcInMbo.setValue('PROCNAME', ifaceProc.procName);
        maxIfaceProcInMbo.setValue('PROCTYPE', ifaceProc.procType);
        maxIfaceProcInMbo.setValue('PROCSEQUENCE', ifaceProc.procSequence);
        maxIfaceProcInMbo.setValue('DESCRIPTION', ifaceProc.description);
        maxIfaceProcInMbo.setValue('ENABLED', ifaceProc.enabled);
        if (ifaceProc.procType == 'STOP' || ifaceProc.procType == 'SKIP') {
            maxIfaceProcInMbo.setValue('PROCMESSAGE', ifaceProc.procMessage);
        }
        maxIfaceProcInMbo.setValue('APPLYONINSERT', ifaceProc.applyOnInsert);
        maxIfaceProcInMbo.setValue('APPLYONUPDATE', ifaceProc.applyOnUpdate);
        maxIfaceProcInMbo.setValue('APPLYONDELETE', ifaceProc.applyOnDelete);
        maxIfaceProcInMbo.setValue('ISOBJECTPROC', ifaceProc.isObjectProc);

        var maxReplaceProcSet = maxIfaceProcInMbo.getMboSet('MAXREPLACEPROC');
        maxReplaceProcSet.deleteAll();

        var maxProcColsSet = maxIfaceProcInMbo.getMboSet('MAXPROCCOLS');
        maxProcColsSet.deleteAll();

        var maxIfaceCondSet = maxIfaceProcInMbo.getMboSet('MAXIFACECOND');
        maxIfaceCondSet.deleteAll();

        ifaceProc.maxReplaceProc.forEach(function (setReplaceProc) {
            var maxReplaceProc = maxReplaceProcSet.add();
            maxReplaceProc.setValue('VALUETYPE', setReplaceProc.valueType);
            maxReplaceProc.setValue('VALUE', setReplaceProc.value);
            maxReplaceProc.setValue('FIELDNAME', setReplaceProc.fieldName);
            if (setReplaceProc.valueType == 'MBOFIELD') {
                maxReplaceProc.setValue('RELATION', setReplaceProc.relation);
                maxReplaceProc.setValue('MBONAME', setReplaceProc.mboName);
                maxReplaceProc.setValue(
                    'MBOCOLUMNNAME',
                    setReplaceProc.mboColumnName
                );
            }
            maxReplaceProc.setValue('REPLACENULL', setReplaceProc.replaceNull);
            maxReplaceProc.setValue('USEWITH', setReplaceProc.useWith);
        });

        ifaceProc.maxProcCols.forEach(function (combineSplitProc) {
            var maxProcCol = maxProcColsSet.add();
            maxProcCol.setValue('FIELDNAME', combineSplitProc.fieldName);
            maxProcCol.setValue('IFACECONTROL', combineSplitProc.ifaceControl);
            var maxTransformProcSet = maxProcCol.getMboSet('MAXTRANSFORMPROC');
            combineSplitProc.maxTransformProc.forEach(function (transformProc) {
                var maxTransformProcMbo = maxTransformProcSet.add();
                maxTransformProcMbo.setValue(
                    'TRANSFIELDNAME',
                    transformProc.transFieldName
                );
            });
        });

        ifaceProc.maxIfaceCond.forEach(function (addModifyCond) {
            var maxIfaceCond = maxIfaceCondSet.add();
            maxIfaceCond.setValue('CONDITION', addModifyCond.condition);
            var maxIfaceCondDetailSet = maxIfaceCond.getMboSet('MAXCONDDETAIL');
            addModifyCond.maxCondDetail.forEach(function (addModifyCondDetail) {
                var maxCondDetailMbo = maxIfaceCondDetailSet.add();
                maxCondDetailMbo.setValue(
                    'CONDTYPE',
                    addModifyCondDetail.condType
                );
                maxCondDetailMbo.setValue(
                    'COMPARETYPE',
                    addModifyCondDetail.compareType
                );
                maxCondDetailMbo.setValue(
                    'CONDSEQUENCE',
                    addModifyCondDetail.condSequence
                );
                maxCondDetailMbo.setValue(
                    'COLUMNNAME',
                    addModifyCondDetail.columnName
                );
                maxCondDetailMbo.setValue('VALUE', addModifyCondDetail.value);
                maxCondDetailMbo.setValue(
                    'MBOCOLUMNNAME',
                    addModifyCondDetail.mboColumnName
                );
                maxCondDetailMbo.setValue(
                    'RELATION',
                    addModifyCondDetail.relation
                );
                maxCondDetailMbo.setValue(
                    'MBONAME',
                    addModifyCondDetail.mboName
                );
                maxCondDetailMbo.setValue(
                    'CHANGETYPE',
                    addModifyCondDetail.changeType
                );
                maxCondDetailMbo.setValue(
                    'EVALTYPE',
                    addModifyCondDetail.evalType
                );
            });
        });
    });
};

function PublishChannel(publishChannel) {
    if (!publishChannel) {
        throw new Error(
            'A integration object JSON is required to create the publishChannel object.'
        );
    } else if (typeof publishChannel.ifaceName === 'undefined') {
        throw new Error(
            'The ifaceName property is required and must a Maximo Publish Channel field value.'
        );
    } else if (typeof publishChannel.intObjectName === 'undefined') {
        throw new Error(
            'The intObjectName property is required and must a Maximo Publish Channel field value.'
        );
    }

    this.ifaceName = publishChannel.ifaceName;
    this.description =
        typeof publishChannel.description === 'undefined'
            ? ''
            : publishChannel.description;
    this.messageType =
        typeof publishChannel.messageType === 'undefined'
            ? 'Publish'
            : publishChannel.messageType;
    this.intObjectName = publishChannel.intObjectName;
    this.ifaceExitClass =
        typeof publishChannel.ifaceExitClass === 'undefined'
            ? ''
            : publishChannel.ifaceExitClass;
    this.eventFilterClass =
        typeof publishChannel.eventFilterClass === 'undefined'
            ? ''
            : publishChannel.eventFilterClass;
    this.ifaceType =
        typeof publishChannel.ifaceType === 'undefined'
            ? 'MAXIMO'
            : publishChannel.ifaceType;
    this.ifaceTBName =
        typeof publishChannel.ifaceTBName === 'undefined'
            ? ''
            : publishChannel.ifaceTBName;
    this.ifaceMapName =
        typeof publishChannel.ifaceMapName === 'undefined'
            ? ''
            : publishChannel.ifaceMapName;
    this.ifaceUserExitClass =
        typeof publishChannel.ifaceUserExitClass === 'undefined'
            ? ''
            : publishChannel.ifaceUserExitClass;
    this.retainMbos =
        typeof publishChannel.retainMbos === 'undefined'
            ? true
            : publishChannel.retainMbos == true;
    this.skipDiffObject =
        typeof publishChannel.skipDiffObject === 'undefined'
            ? false
            : publishChannel.skipDiffObject == true;
    this.publishJSON =
        typeof publishChannel.publishJSON === 'undefined'
            ? false
            : publishChannel.publishJSON == true;

    //associated processing rules
    if (
        publishChannel.maxIfaceProc &&
        Array.isArray(publishChannel.maxIfaceProc)
    ) {
        publishChannel.maxIfaceProc.forEach(function (ifaceProc) {
            if (
                typeof ifaceProc.procName === 'undefined' ||
                !ifaceProc.procName
            ) {
                throw new Error(
                    'A processing rule name for publish channel ' +
                        publishChannel.ifaceName +
                        ' is missing or has an empty value for the required procName property.'
                );
            }
            if (
                typeof ifaceProc.procType === 'undefined' ||
                !ifaceProc.procType
            ) {
                throw new Error(
                    'An action for publish channel ' +
                        publishChannel.ifaceName +
                        ' publish channel, ' +
                        ifaceProc.procName +
                        ' rule is missing or has an empty value for the required procType property.'
                );
            }
            if (
                typeof ifaceProc.procSequence === 'undefined' ||
                !ifaceProc.procSequence
            ) {
                throw new Error(
                    'A sequence for publish channel ' +
                        publishChannel.ifaceName +
                        ' publish channel, ' +
                        ifaceProc.procName +
                        ' rule is missing or has an empty value for the required procSequence property.'
                );
            }

            ifaceProc.description =
                typeof ifaceProc.description === 'undefined'
                    ? ''
                    : ifaceProc.description;
            ifaceProc.enabled =
                typeof ifaceProc.enabled === 'undefined'
                    ? false
                    : ifaceProc.enabled == true;
            ifaceProc.procMessage =
                typeof ifaceProc.procMessage === 'undefined'
                    ? ''
                    : ifaceProc.procMessage;
            ifaceProc.applyOnInsert =
                typeof ifaceProc.applyOnInsert === 'undefined'
                    ? true
                    : ifaceProc.applyOnInsert == true;
            ifaceProc.applyOnUpdate =
                typeof ifaceProc.applyOnUpdate === 'undefined'
                    ? true
                    : ifaceProc.applyOnUpdate == true;
            ifaceProc.applyOnDelete =
                typeof ifaceProc.applyOnDelete === 'undefined'
                    ? true
                    : ifaceProc.applyOnDelete == true;
            ifaceProc.isInbound = false;

            //processing rule fields
            //variable used to pass the processing rule name to the field/conditions
            var processingRuleName = ifaceProc.procName;
            if (
                ifaceProc.procType == 'SET' ||
                ifaceProc.procType == 'REPLACE'
            ) {
                ifaceProc.maxProcCols = [];
                if (
                    typeof ifaceProc.maxReplaceProc !== 'undefined' &&
                    ifaceProc.maxReplaceProc &&
                    Array.isArray(ifaceProc.maxReplaceProc)
                ) {
                    ifaceProc.maxReplaceProc.forEach(function (setReplaceProc) {
                        if (
                            typeof setReplaceProc.valueType === 'undefined' ||
                            !setReplaceProc.valueType
                        ) {
                            throw new Error(
                                'A value type is required for the ' +
                                    processingRuleName +
                                    ' rule.'
                            );
                        }
                        if (
                            typeof setReplaceProc.value === 'undefined' ||
                            !setReplaceProc.value
                        ) {
                            throw new Error(
                                'A value is required for the ' +
                                    processingRuleName +
                                    ' rule.'
                            );
                        }
                        if (
                            typeof setReplaceProc.fieldName === 'undefined' ||
                            !setReplaceProc.fieldName
                        ) {
                            throw new Error(
                                'A field is required for the ' +
                                    processingRuleName +
                                    ' rule.'
                            );
                        }
                        if (
                            setReplaceProc.valueType.toUpperCase() == 'MBOFIELD'
                        ) {
                            if (
                                typeof setReplaceProc.relation ===
                                    'undefined' ||
                                !setReplaceProc.relation
                            ) {
                                throw new Error(
                                    'A relationship is required for the ' +
                                        processingRuleName +
                                        ' rule.'
                                );
                            }
                            if (
                                typeof setReplaceProc.mboName === 'undefined' ||
                                !setReplaceProc.mboName
                            ) {
                                throw new Error(
                                    'A relationship is required for the ' +
                                        processingRuleName +
                                        ' rule.'
                                );
                            }
                            if (
                                typeof setReplaceProc.mboColumnName ===
                                    'undefined' ||
                                !setReplaceProc.mboColumnName
                            ) {
                                throw new Error(
                                    'A relationship is required for the ' +
                                        processingRuleName +
                                        ' rule.'
                                );
                            }
                        }
                        setReplaceProc.relation =
                            typeof setReplaceProc.relation === 'undefined'
                                ? ''
                                : setReplaceProc.relation;
                        setReplaceProc.mboName =
                            typeof setReplaceProc.mboName === 'undefined'
                                ? ''
                                : setReplaceProc.mboName;
                        setReplaceProc.valueType =
                            typeof setReplaceProc.valueType === 'undefined'
                                ? ''
                                : setReplaceProc.valueType;
                        setReplaceProc.fieldName =
                            typeof setReplaceProc.fieldName === 'undefined'
                                ? ''
                                : setReplaceProc.fieldName;
                        setReplaceProc.mboColumnName =
                            typeof setReplaceProc.mboColumnName === 'undefined'
                                ? ''
                                : setReplaceProc.mboColumnName;
                        setReplaceProc.replaceNull =
                            typeof setReplaceProc.replaceNull === 'undefined'
                                ? false
                                : setReplaceProc.replaceNull == true;
                        setReplaceProc.useWith =
                            typeof setReplaceProc.useWith === 'undefined'
                                ? 'PUBLISHCHANNEL'
                                : setReplaceProc.useWith;
                    });
                } else {
                    ifaceProc.maxReplaceProc = [];
                }
            } else if (
                ifaceProc.procType == 'COMBINE' ||
                ifaceProc.procType == 'SPLIT'
            ) {
                ifaceProc.maxReplaceProc = [];
                if (
                    ifaceProc.maxProcCols &&
                    Array.isArray(ifaceProc.maxProcCols)
                ) {
                    ifaceProc.maxProcCols.forEach(function (combineSplitProc) {
                        if (
                            typeof combineSplitProc.fieldName === 'undefined' ||
                            !combineSplitProc.fieldName
                        ) {
                            throw new Error(
                                'A fieldName is required for the ' +
                                    processingRuleName +
                                    ' rule.'
                            );
                        }

                        combineSplitProc.ifaceControl =
                            typeof combineSplitProc.ifaceControl === 'undefined'
                                ? ''
                                : combineSplitProc.ifaceControl;

                        //source fields - throw error if this set is empty / not provided
                        if (
                            combineSplitProc.maxTransformProc &&
                            Array.isArray(combineSplitProc.maxTransformProc)
                        ) {
                            combineSplitProc.maxTransformProc.forEach(function (
                                transformProc
                            ) {
                                if (
                                    (typeof transformProc.transFieldName ===
                                        'undefined' ||
                                        !transformProc.transFieldName) &&
                                    (typeof transformProc.ifaceControl ===
                                        'undefined' ||
                                        !transformProc.ifaceControl)
                                ) {
                                    throw new Error(
                                        'A transFieldName or ifaceControl is required for the ' +
                                            processingRuleName +
                                            ' rule.'
                                    );
                                }
                            });
                        } else {
                            ifaceProc.maxTransformProc = [];
                            throw new Error(
                                'A set of transform / source sub-record fields is required for combine and split processing rules'
                            );
                        }
                    });
                } else {
                    //this.maxIfaceProc.maxProcCols = [];
                    ifaceProc.maxProcCols = [];
                }
            } else if (
                ifaceProc.procType == 'SKIP' ||
                ifaceProc.procType == 'SKIPCHILDREN' ||
                ifaceProc.procType == 'SKIPRECORD' ||
                ifaceProc.procType == 'STOP'
            ) {
                ifaceProc.maxReplaceProc = [];
                ifaceProc.maxProcCols = [];
            } else {
                throw new Error(
                    'The processing action ' +
                        ifaceProc.procType +
                        ' for publish channel ' +
                        publishChannel.ifaceName +
                        ' publish channel, ' +
                        ifaceProc.procName +
                        ' rule is not a recognized action value.'
                );
            }

            //add/modify conditions
            if (
                ifaceProc.maxIfaceCond &&
                Array.isArray(ifaceProc.maxIfaceCond)
            ) {
                ifaceProc.maxIfaceCond.forEach(function (ifaceCond) {
                    if (
                        typeof ifaceCond.condition === 'undefined' ||
                        !ifaceCond.condition
                    ) {
                        throw new Error(
                            'A condition number is required for the ' +
                                processingRuleName +
                                ' rule.'
                        );
                    }

                    if (
                        ifaceCond.maxCondDetail &&
                        Array.isArray(ifaceCond.maxCondDetail)
                    ) {
                        ifaceCond.maxCondDetail.forEach(function (condDetail) {
                            if (
                                typeof condDetail.condType === 'undefined' ||
                                !condDetail.condType
                            ) {
                                throw new Error(
                                    'A condition type is required for the ' +
                                        processingRuleName +
                                        ' rule.'
                                );
                            }
                            if (
                                typeof condDetail.compareType === 'undefined' ||
                                !condDetail.compareType
                            ) {
                                throw new Error(
                                    'A compare type is required for the ' +
                                        processingRuleName +
                                        ' rule.'
                                );
                            }
                            if (
                                typeof condDetail.condSequence ===
                                    'undefined' ||
                                !condDetail.condSequence
                            ) {
                                throw new Error(
                                    'A condition sequence is required for the ' +
                                        processingRuleName +
                                        ' rule.'
                                );
                            }
                            if (
                                condDetail.condType == 'IFACECONTROL' ||
                                condDetail.condType == 'MAXVAR'
                            ) {
                                if (
                                    typeof condDetail.columnName ===
                                        'undefined' ||
                                    !condDetail.columnName
                                ) {
                                    throw new Error(
                                        'A column name is required for the ' +
                                            processingRuleName +
                                            ' rule.'
                                    );
                                }
                                if (
                                    typeof condDetail.value === 'undefined' ||
                                    !condDetail.value
                                ) {
                                    throw new Error(
                                        'A value is required for the ' +
                                            processingRuleName +
                                            ' rule.'
                                    );
                                }
                            } else if (condDetail.condType == 'MBO') {
                                if (
                                    typeof condDetail.mboColumnName ===
                                        'undefined' ||
                                    !condDetail.mboColumnName
                                ) {
                                    throw new Error(
                                        'A mbo column name is required for the ' +
                                            processingRuleName +
                                            ' rule.'
                                    );
                                }
                                if (
                                    typeof condDetail.value === 'undefined' ||
                                    !condDetail.value
                                ) {
                                    throw new Error(
                                        'A value is required for the ' +
                                            processingRuleName +
                                            ' rule.'
                                    );
                                }
                                if (
                                    typeof condDetail.relation ===
                                        'undefined' ||
                                    !condDetail.relation
                                ) {
                                    throw new Error(
                                        'A relation is required for the ' +
                                            processingRuleName +
                                            ' rule.'
                                    );
                                }
                                if (
                                    typeof condDetail.mboName === 'undefined' ||
                                    !condDetail.mboName
                                ) {
                                    throw new Error(
                                        'A mbo name is required for the ' +
                                            processingRuleName +
                                            ' rule.'
                                    );
                                }
                            } else if (condDetail.condType == 'FIELD') {
                                if (condDetail.compareType == 'MBOFIELD') {
                                    if (
                                        typeof condDetail.mboColumnName ===
                                            'undefined' ||
                                        !condDetail.mboColumnName
                                    ) {
                                        throw new Error(
                                            'A mbo column name is required for the ' +
                                                processingRuleName +
                                                ' rule.'
                                        );
                                    }
                                    if (
                                        typeof condDetail.columnName ===
                                            'undefined' ||
                                        !condDetail.columnName
                                    ) {
                                        throw new Error(
                                            'A column name is required for the ' +
                                                processingRuleName +
                                                ' rule.'
                                        );
                                    }
                                    if (
                                        typeof condDetail.relation ===
                                            'undefined' ||
                                        !condDetail.relation
                                    ) {
                                        throw new Error(
                                            'A relation is required for the ' +
                                                processingRuleName +
                                                ' rule.'
                                        );
                                    }
                                    if (
                                        typeof condDetail.mboName ===
                                            'undefined' ||
                                        !condDetail.mboName
                                    ) {
                                        throw new Error(
                                            'A mbo name is required for the ' +
                                                processingRuleName +
                                                ' rule.'
                                        );
                                    }
                                } else {
                                    if (
                                        typeof condDetail.columnName ===
                                            'undefined' ||
                                        !condDetail.columnName
                                    ) {
                                        throw new Error(
                                            'A column name is required for the ' +
                                                processingRuleName +
                                                ' rule.'
                                        );
                                    }
                                    if (
                                        typeof condDetail.value ===
                                            'undefined' ||
                                        !condDetail.value
                                    ) {
                                        throw new Error(
                                            'A value is required for the ' +
                                                processingRuleName +
                                                ' rule.'
                                        );
                                    }
                                }
                            } else if (condDetail.condType == 'MBOSET') {
                                if (
                                    typeof condDetail.relation ===
                                        'undefined' ||
                                    !condDetail.relation
                                ) {
                                    throw new Error(
                                        'A relation is required for the ' +
                                            processingRuleName +
                                            ' rule.'
                                    );
                                }
                                if (
                                    typeof condDetail.mboName === 'undefined' ||
                                    !condDetail.mboName
                                ) {
                                    throw new Error(
                                        'A mbo name is required for the ' +
                                            processingRuleName +
                                            ' rule.'
                                    );
                                }
                            } else {
                                throw new Error(
                                    'Provided condition type and/or compare type value is invalid.'
                                );
                            }

                            condDetail.mboColumnName =
                                typeof condDetail.mboColumnName === 'undefined'
                                    ? ''
                                    : condDetail.mboColumnName;
                            condDetail.columnName =
                                typeof condDetail.columnName === 'undefined'
                                    ? ''
                                    : condDetail.columnName;
                            condDetail.relation =
                                typeof condDetail.relation === 'undefined'
                                    ? ''
                                    : condDetail.relation;
                            condDetail.mboName =
                                typeof condDetail.mboName === 'undefined'
                                    ? ''
                                    : condDetail.mboName;
                            condDetail.mboColumnName =
                                typeof condDetail.mboColumnName === 'undefined'
                                    ? ''
                                    : condDetail.mboColumnName;
                            condDetail.value =
                                typeof condDetail.value === 'undefined'
                                    ? ''
                                    : condDetail.value;
                            condDetail.changeType =
                                typeof condDetail.changeType === 'undefined'
                                    ? 'ALWAYS'
                                    : condDetail.changeType;
                            if (
                                condDetail.compareType.toUpperCase() ==
                                'IFACECONTROL'
                            ) {
                                condDetail.evalType = 'EXISTS';
                            } else {
                                condDetail.evalType = 'EQUALS';
                            }
                        });
                    } else {
                        ifaceCond.condDetail = [];
                    }
                });
            } else {
                ifaceProc.maxIfaceCond = [];
            }
        });

        this.maxIfaceProc = publishChannel.maxIfaceProc;
    } else {
        this.maxIfaceProc = [];
    }
}

PublishChannel.prototype.constructor = PublishChannel;
PublishChannel.prototype.setMboValues = function (mbo) {
    if (!mbo) {
        throw new Error(
            'A Mbo is required to set values from the Publish Channel object.'
        );
    } else if (!(mbo instanceof Java.type('psdi.mbo.Mbo'))) {
        throw new Error(
            'The mbo parameter must be an instance of psdi.mbo.Mbo.'
        );
    } else if (!mbo.isBasedOn('MAXIFACEOUT')) {
        throw new Error(
            'The mbo parameter must be based on the MAXENDPOINT Maximo object.'
        );
    }
    if (mbo.toBeAdded()) {
        mbo.setValue('IFACENAME', this.ifaceName);
        mbo.setValue('INTOBJECTNAME', this.intObjectName);
    }
    mbo.setValue('DESCRIPTION', this.description);
    mbo.setValue('MESSAGETYPE', this.messageType);
    mbo.setValue('IFACEEXITCLASS', this.ifaceExitClass);
    mbo.setValue('EVENTFILTERCLASS', this.eventFilterClass);
    mbo.setValue('IFACETYPE', this.ifaceType);
    mbo.setValue('IFACETBNAME', this.ifaceTBName);
    mbo.setValue('IFACEMAPNAME', this.ifaceMapName);
    mbo.setValue('IFACEUSEREXITCLASS', this.ifaceUserExitClass);
    mbo.setValue('RETAINMBOS', this.retainMbos);
    mbo.setValue('SKIPDIFFOBJECT', this.skipDiffObject);
    mbo.setValue('PUBLISHJSON', this.publishJSON);

    var maxIntObjDetail = mbo.getMboSet('MAXINTOBJDETAIL').moveFirst();
    var maxIfaceProcOutSet = maxIntObjDetail.getMboSet('MAXIFACEPROCOUT');
    maxIfaceProcOutSet.deleteAll();

    this.maxIfaceProc.forEach(function (ifaceProc) {
        var maxIfaceProcOutMbo = maxIfaceProcOutSet.add();
        maxIfaceProcOutMbo.setValue('PROCNAME', ifaceProc.procName);
        maxIfaceProcOutMbo.setValue('PROCTYPE', ifaceProc.procType);
        maxIfaceProcOutMbo.setValue('PROCSEQUENCE', ifaceProc.procSequence);
        maxIfaceProcOutMbo.setValue('DESCRIPTION', ifaceProc.description);
        maxIfaceProcOutMbo.setValue('ENABLED', ifaceProc.enabled);
        if (ifaceProc.procType == 'STOP' || ifaceProc.procType == 'SKIP') {
            maxIfaceProcOutMbo.setValue('PROCMESSAGE', ifaceProc.procMessage);
        }
        maxIfaceProcOutMbo.setValue('APPLYONINSERT', ifaceProc.applyOnInsert);
        maxIfaceProcOutMbo.setValue('APPLYONUPDATE', ifaceProc.applyOnUpdate);
        maxIfaceProcOutMbo.setValue('APPLYONDELETE', ifaceProc.applyOnDelete);

        var maxReplaceProcSet = maxIfaceProcOutMbo.getMboSet('MAXREPLACEPROC');
        maxReplaceProcSet.deleteAll();

        var maxProcColsSet = maxIfaceProcOutMbo.getMboSet('MAXPROCCOLS');
        maxProcColsSet.deleteAll();

        var maxIfaceCondSet = maxIfaceProcOutMbo.getMboSet('MAXIFACECOND');
        maxIfaceCondSet.deleteAll();

        ifaceProc.maxReplaceProc.forEach(function (setReplaceProc) {
            var maxReplaceProc = maxReplaceProcSet.add();
            maxReplaceProc.setValue('VALUETYPE', setReplaceProc.valueType);
            maxReplaceProc.setValue('VALUE', setReplaceProc.value);
            maxReplaceProc.setValue('FIELDNAME', setReplaceProc.fieldName);
            if (setReplaceProc.valueType == 'MBOFIELD') {
                maxReplaceProc.setValue('RELATION', setReplaceProc.relation);
                maxReplaceProc.setValue('MBONAME', setReplaceProc.mboName);
                maxReplaceProc.setValue(
                    'MBOCOLUMNNAME',
                    setReplaceProc.mboColumnName
                );
            }
            maxReplaceProc.setValue('REPLACENULL', setReplaceProc.replaceNull);
            maxReplaceProc.setValue('USEWITH', setReplaceProc.useWith);
        });

        ifaceProc.maxProcCols.forEach(function (combineSplitProc) {
            var maxProcCol = maxProcColsSet.add();
            maxProcCol.setValue('FIELDNAME', combineSplitProc.fieldName);
            maxProcCol.setValue('IFACECONTROL', combineSplitProc.ifaceControl);
            var maxTransformProcSet = maxProcCol.getMboSet('MAXTRANSFORMPROC');
            combineSplitProc.maxTransformProc.forEach(function (transformProc) {
                var maxTransformProcMbo = maxTransformProcSet.add();
                maxTransformProcMbo.setValue(
                    'TRANSFIELDNAME',
                    transformProc.transFieldName
                );
            });
        });

        ifaceProc.maxIfaceCond.forEach(function (addModifyCond) {
            var maxIfaceCond = maxIfaceCondSet.add();
            maxIfaceCond.setValue('CONDITION', addModifyCond.condition);
            var maxIfaceCondDetailSet = maxIfaceCond.getMboSet('MAXCONDDETAIL');
            addModifyCond.maxCondDetail.forEach(function (addModifyCondDetail) {
                var maxCondDetailMbo = maxIfaceCondDetailSet.add();
                maxCondDetailMbo.setValue(
                    'CONDTYPE',
                    addModifyCondDetail.condType
                );
                maxCondDetailMbo.setValue(
                    'COMPARETYPE',
                    addModifyCondDetail.compareType
                );
                maxCondDetailMbo.setValue(
                    'CONDSEQUENCE',
                    addModifyCondDetail.condSequence
                );
                maxCondDetailMbo.setValue(
                    'COLUMNNAME',
                    addModifyCondDetail.columnName
                );
                maxCondDetailMbo.setValue('VALUE', addModifyCondDetail.value);
                maxCondDetailMbo.setValue(
                    'MBOCOLUMNNAME',
                    addModifyCondDetail.mboColumnName
                );
                maxCondDetailMbo.setValue(
                    'RELATION',
                    addModifyCondDetail.relation
                );
                maxCondDetailMbo.setValue(
                    'MBONAME',
                    addModifyCondDetail.mboName
                );
                maxCondDetailMbo.setValue(
                    'CHANGETYPE',
                    addModifyCondDetail.changeType
                );
                maxCondDetailMbo.setValue(
                    'EVALTYPE',
                    addModifyCondDetail.evalType
                );
            });
        });
    });
};

function CommunicationTemplate(communicationTemplate) {
    if (!communicationTemplate) {
        throw new Error(
            'A integration object JSON is required to create the CommunicationTemplate object.'
        );
    } else if (typeof communicationTemplate.templateID === 'undefined') {
        throw new Error(
            'The templateID property is required and must a Maximo Communication Template field value.'
        );
    } else if (typeof communicationTemplate.objectName === 'undefined') {
        throw new Error(
            'The objectName property is required and must a Maximo Communication Template field value.'
        );
    } else if (typeof communicationTemplate.sendFrom === 'undefined') {
        throw new Error(
            'The sendFrom property is required and must a Maximo Communication Template field value.'
        );
    }

    this.templateID = communicationTemplate.templateID;
    this.objectName = communicationTemplate.objectName;
    this.sendFrom = communicationTemplate.sendFrom;
    this.description =
        typeof communicationTemplate.description === 'undefined'
            ? ''
            : communicationTemplate.description;
    this.useWith =
        typeof communicationTemplate.useWith === 'undefined'
            ? 'ALL'
            : communicationTemplate.useWith;
    this.trackFailedMessages =
        typeof communicationTemplate.trackFailedMessages === 'undefined'
            ? false
            : communicationTemplate.trackFailedMessages == true;
    this.logFlag =
        typeof communicationTemplate.logFlag === 'undefined'
            ? false
            : communicationTemplate.logFlag == true;
    this.status =
        typeof communicationTemplate.status === 'undefined'
            ? 'INACTIVE'
            : communicationTemplate.status;
    this.replyTo =
        typeof communicationTemplate.replyTo === 'undefined'
            ? ''
            : communicationTemplate.replyTo;
    this.subject =
        typeof communicationTemplate.subject === 'undefined'
            ? ''
            : communicationTemplate.subject;
    this.message =
        typeof communicationTemplate.message === 'undefined'
            ? ''
            : communicationTemplate.message;

    //Send Tos for Communication Template
    if (
        communicationTemplate.commTmpltSendTo &&
        Array.isArray(communicationTemplate.commTmpltSendTo)
    ) {
        communicationTemplate.commTmpltSendTo.forEach(function (sendTo) {
            if (typeof sendTo.type === 'undefined' || !sendTo.type) {
                throw new Error(
                    'A type for communication template ' +
                        communicationTemplate.templateID +
                        ' is missing or has an empty value for the required type property.'
                );
            }
            if (
                typeof sendTo.sendToValue === 'undefined' ||
                !sendTo.sendToValue
            ) {
                throw new Error(
                    'A sendToValue for communication template ' +
                        communicationTemplate.templateID +
                        ' is missing or has an empty value for the required sendToValue property.'
                );
            }
            sendTo.sendTo =
                typeof sendTo.sendTo === 'undefined'
                    ? false
                    : sendTo.sendTo == true;
            sendTo.cc =
                typeof sendTo.cc === 'undefined' ? false : sendTo.cc == true;
            sendTo.bcc =
                typeof sendTo.bcc === 'undefined' ? false : sendTo.bcc == true;
        });

        this.commTmpltSendTo = communicationTemplate.commTmpltSendTo;
    } else {
        this.commTmpltSendTo = [];
    }
}
CommunicationTemplate.prototype.constructor = CommunicationTemplate;
CommunicationTemplate.prototype.setMboValues = function (mbo) {
    if (!mbo) {
        throw new Error(
            'A Mbo is required to set values from the External System object.'
        );
    } else if (!(mbo instanceof Java.type('psdi.mbo.Mbo'))) {
        throw new Error(
            'The mbo parameter must be an instance of psdi.mbo.Mbo.'
        );
    } else if (!mbo.isBasedOn('COMMTEMPLATE')) {
        throw new Error(
            'The mbo parameter must be based on the COMMTEMPLATE Maximo object.'
        );
    }
    mbo.setValue('TEMPLATEID', this.templateID);
    mbo.setValue('OBJECTNAME', this.objectName);
    mbo.setValue('SENDFROM', this.sendFrom);
    mbo.setValue('DESCRIPTION', this.description);
    mbo.setValue('USEWITH', this.useWith);
    mbo.setValue('TRACKFAILEDMESSAGES', this.trackFailedMessages);
    mbo.setValue('LOGFLAG', this.logFlag);
    mbo.setValue('STATUS', this.status);
    mbo.setValue('REPLYTO', this.replyTo);
    mbo.setValue('SUBJECT', this.subject);
    mbo.setValue('MESSAGE', this.message);

    var commTmpltSendToSet = mbo.getMboSet('COMMTMPLT_SENDTO');
    commTmpltSendToSet.deleteAll();

    this.commTmpltSendTo.forEach(function (sendTo) {
        commTmpltSendTo = commTmpltSendToSet.add();
        commTmpltSendTo.setValue('TYPE', sendTo.type);
        commTmpltSendTo.setValue('SENDTOVALUE', sendTo.sendToValue);
        commTmpltSendTo.setValue('SENDTO', sendTo.sendTo);
        commTmpltSendTo.setValue('CC', sendTo.cc);
        commTmpltSendTo.setValue('BCC', sendTo.bcc);
    });
};

function LaunchInContext(launchInContext) {
    if (!launchInContext) {
        throw new Error(
            'A integration object JSON is required to create the launchInContext object.'
        );
    } else if (typeof launchInContext.launchEntryName === 'undefined') {
        throw new Error(
            'The launchEntryName property is required and must a Maximo Launch in Context field value.'
        );
    } else if (typeof launchInContext.consoleURL === 'undefined') {
        throw new Error(
            'The consoleURL property is required and must a Maximo Launch in Context field value.'
        );
    }

    this.launchEntryName = launchInContext.launchEntryName;
    this.consoleURL = launchInContext.consoleURL;
    this.displayName =
        typeof launchInContext.displayName === 'undefined'
            ? ''
            : launchInContext.displayName;
    this.targetWindow =
        typeof launchInContext.targetWindow === 'undefined'
            ? '_usecurrent'
            : launchInContext.targetWindow;
    this.ompProductName =
        typeof launchInContext.ompProductName === 'undefined'
            ? ''
            : launchInContext.ompProductName;
    this.ompVersion =
        typeof launchInContext.ompVersion === 'undefined'
            ? ''
            : launchInContext.ompVersion;

    //Launch Contexts fors
    if (
        launchInContext.maxLeContext &&
        Array.isArray(launchInContext.maxLeContext)
    ) {
        launchInContext.maxLeContext.forEach(function (leContext) {
            if (
                typeof leContext.resourceType === 'undefined' ||
                !leContext.resourceType
            ) {
                throw new Error(
                    'A type for launch in context ' +
                        launchInContext.launchEntryName +
                        ' is missing or has an empty value for the required resource type property.'
                );
            }
            leContext.resourceClass =
                typeof leContext.resourceClass === 'undefined'
                    ? ''
                    : leContext.resourceClass;
            leContext.includeChildClass =
                typeof leContext.includeChildClass === 'undefined'
                    ? false
                    : leContext.includeChildClass == true;
        });

        this.maxLeContext = launchInContext.maxLeContext;
    } else {
        this.maxLeContext = [];
    }
}
LaunchInContext.prototype.constructor = LaunchInContext;
LaunchInContext.prototype.setMboValues = function (mbo) {
    if (!mbo) {
        throw new Error(
            'A Mbo is required to set values from the External System object.'
        );
    } else if (!(mbo instanceof Java.type('psdi.mbo.Mbo'))) {
        throw new Error(
            'The mbo parameter must be an instance of psdi.mbo.Mbo.'
        );
    } else if (!mbo.isBasedOn('MAXLAUNCHENTRY')) {
        throw new Error(
            'The mbo parameter must be based on the MAXLAUNCHENTRY Maximo object.'
        );
    }
    mbo.setValue('LAUNCHENTRYNAME', this.launchEntryName);
    mbo.setValue('CONSOLEURL', this.consoleURL);
    mbo.setValue('DISPLAYNAME', this.displayName);
    mbo.setValue('TARGETWINDOW', this.targetWindow);
    mbo.setValue('OMPPRODUCTNAME', this.ompProductName);
    mbo.setValue('OMPVERSION', this.ompVersion);

    var maxLeContextSet = mbo.getMboSet('MAXLECONTEXT');
    maxLeContextSet.deleteAll();

    this.maxLeContext.forEach(function (leContext) {
        maxLeContext = maxLeContextSet.add();
        maxLeContext.setValue('RESOURCETYPE', leContext.resourceType);
        if (leContext.resourceType == '') {
            maxLeContext.setValue('RESOURCECLASS', leContext.resourceClass);
        }
        maxLeContext.setValue('INCLUDECHILDCLASS', leContext.includeChildClass);
    });
};

function MaxObject(maxobject) {
    if (!maxobject) {
        throw new Error(
            'An maxobject JSON is required to create the MaxObject object.'
        );
    } else if (typeof maxobject.object === 'undefined') {
        throw new Error(
            'The object property is required and must be the name of the object.'
        );
    }

    this.object = maxobject.object;
    this.description =
        typeof maxobject.description === 'undefined'
            ? ''
            : maxobject.description;
    this.service =
        typeof maxobject.service === 'undefined' ? null : maxobject.service;
    this.entity =
        typeof maxobject.entity === 'undefined' ? null : maxobject.entity;
    this.className =
        typeof maxobject.className === 'undefined' ? null : maxobject.className;
    this.extendsObject =
        typeof maxobject.extendsObject === 'undefined'
            ? null
            : maxobject.extendsObject;
    this.level =
        typeof maxobject.level === 'undefined' ? null : maxobject.level;
    this.triggerRoot =
        typeof maxobject.triggerRoot === 'undefined'
            ? null
            : maxobject.triggerRoot;
    this.textDirection =
        typeof maxobject.textDirection === 'undefined'
            ? null
            : maxobject.textDirection;
    this.mainObject =
        typeof maxobject.mainObject === 'undefined'
            ? false
            : maxobject.mainObject;
    this.presistent =
        typeof maxobject.presistent === 'undefined'
            ? true
            : maxobject.presistent;
    this.storagePartition =
        typeof maxobject.storagePartition === 'undefined'
            ? null
            : maxobject.storagePartition;
    this.unqiueColumn =
        typeof maxobject.unqiueColumn === 'undefined'
            ? null
            : maxobject.unqiueColumn;
    this.languageTable =
        typeof maxobject.languageTable === 'undefined'
            ? null
            : maxobject.languageTable;
    this.languageColumn =
        typeof maxobject.languageColumn === 'undefined'
            ? null
            : maxobject.languageColumn;
    this.alternateIndex =
        typeof maxobject.alternateIndex === 'undefined'
            ? null
            : maxobject.alternateIndex;
    this.persistent =
        typeof maxobject.persistent === 'undefined'
            ? true
            : maxobject.persistent;
    this.addRowstamp =
        typeof maxobject.addRowstamp === 'undefined'
            ? true
            : maxobject.addRowstamp;
    this.textSearchEnabled =
        typeof maxobject.textSearchEnabled === 'undefined'
            ? false
            : maxobject.textSearchEnabled;
    this.view = typeof maxobject.view === 'undefined' ? false : maxobject.view;
    this.viewWhere =
        typeof maxobject.viewWhere === 'undefined' ? null : maxobject.viewWhere;
    this.joinToObject =
        typeof maxobject.joinToObject === 'undefined'
            ? null
            : maxobject.joinToObject;
    this.automaticallySelect =
        typeof maxobject.automaticallySelect === 'undefined'
            ? true
            : maxobject.automaticallySelect;
    this.viewSelect =
        typeof maxobject.viewSelect === 'undefined'
            ? null
            : maxobject.viewSelect;
    this.viewFrom =
        typeof maxobject.viewFrom === 'undefined' ? null : maxobject.viewFrom;
    this.auditEnabled =
        typeof maxobject.auditEnabled === 'undefined'
            ? false
            : maxobject.auditEnabled;
    this.auditTable =
        typeof maxobject.auditTable === 'undefined'
            ? null
            : maxobject.auditTable;
    this.eAuditFilter =
        typeof maxobject.eAuditFilter === 'undefined'
            ? null
            : maxobject.eAuditFilter;
    this.eSignatureFilter =
        typeof maxobject.eSignatureFilter === 'undefined'
            ? null
            : maxobject.eSignatureFilter;

    //attributes
    if (
        typeof maxobject.attributes !== 'undefined' &&
        Array.isArray(maxobject.attributes)
    ) {
        maxobject.attributes.forEach(function (attribute) {
            if (typeof attribute.attribute === 'undefined') {
                throw new Error(
                    'The attribute property is required for each attribute.'
                );
            } else if (
                typeof attribute.description === 'undefined' ||
                attribute.description == ''
            ) {
                throw new Error(
                    'The description property is required for each attribute'
                );
            } else if (
                typeof attribute.title === 'undefined' ||
                attribute.title == ''
            ) {
                throw new Error(
                    'The title property is required for each attribute'
                );
            }
        });
        this.attributes = maxobject.attributes;
    } else {
        this.attributes = [];
    }

    //indexes
    if (
        typeof maxobject.indexes !== 'undefined' &&
        Array.isArray(maxobject.indexes)
    ) {
        maxobject.indexes.forEach(function (index) {
            if (typeof index.index === 'undefined') {
                throw new Error(
                    'The index property is required for each index.'
                );
            }
        });
        this.indexes = maxobject.indexes;
    } else {
        this.indexes = [];
    }

    //relationships
    if (
        typeof maxobject.relationships !== 'undefined' &&
        Array.isArray(maxobject.relationships)
    ) {
        maxobject.relationships.forEach(function (relationship) {
            if (typeof relationship.relationship === 'undefined') {
                throw new Error(
                    'The relationship property is required for each relationship.'
                );
            } else if (
                typeof relationship.child === 'undefined' &&
                typeof relationship.delete === 'undefined'
            ) {
                throw new Error(
                    'The child property is required for each relationship.'
                );
            }
        });
        this.relationships = maxobject.relationships;
    } else {
        this.relationships = [];
    }
}

MaxObject.prototype.constructor = MaxObject;
MaxObject.prototype.setMboValues = function (mbo) {
    if (!mbo) {
        throw new Error(
            'A Mbo is required to set values from the MAXOBJECTCFG object.'
        );
    } else if (!(mbo instanceof Java.type('psdi.mbo.Mbo'))) {
        throw new Error(
            'The mbo parameter must be an instance of psdi.mbo.Mbo.'
        );
    } else if (!mbo.isBasedOn('MAXOBJECTCFG')) {
        throw new Error(
            'The mbo parameter must be based on the MAXOBJECTCFG Maximo object.'
        );
    }

    if (mbo.toBeAdded()) {
        mbo.setValue('OBJECTNAME', this.object);
    }

    // if the description is null or empty and the mbo is null, set the description to the object name + Table
    if (
        (this.description == null || this.description == '') &&
        mbo.isNull('DESCRIPTION')
    ) {
        mbo.setValue('DESCRIPTION', this.object + 'Table');
    } else if (this.description != null && this.description != '') {
        mbo.setValue('DESCRIPTION', this.description);
    }

    if (this.service != null) {
        mbo.setValue('SERVICENAME', this.service);
    }

    if (this.entity != null) {
        mbo.setValue('ENTITYNAME', this.entity);
    }

    if (this.class != null) {
        mbo.setValue('CLASSNAME', this.class);
    }

    if (mbo.toBeAdded()) {
        if (this.extendsObject != null) {
            mbo.setValue('EXTENDSOBJECT', this.extendsObject);
        }
    }

    if (
        this.level != null &&
        !mbo.getMboValueData('SITEORGTYPE').isReadOnly()
    ) {
        mbo.setValue('SITEORGTYPE', this.level);
    }

    if (!mbo.getMboValueData('TEXTDIRECTION').isReadOnly()) {
        this.textDirection == null
            ? mbo.setValueNull('TEXTDIRECTION')
            : mbo.setValue('TEXTDIRECTION', this.textDirection);
    }

    if (
        this.triggerRoot != null &&
        !mbo.getMboValueData('TRIGROOT').isReadOnly()
    ) {
        mbo.setValue('TRIGROOT', this.triggerRoot);
    }

    if (this.mainObject != null) {
        mbo.setValue('MAINOBJECT', this.mainObject);
    }

    if (!this.view) {
        if (mbo.toBeAdded()) {
            if (!mbo.getMboValueData('PERSISTENT').isReadOnly()) {
                mbo.setValue('PERSISTENT', this.persistent);
            }

            if (!mbo.getMboValueData('ADDROWSTAMP').isReadOnly()) {
                mbo.setValue('ADDROWSTAMP', this.addRowstamp);
            }

            if (this.unqiueColumn != null) {
                mbo.setValue('UNIQUECOLUMNNAME', this.unqiueColumn);
            }
        }

        if (this.storagePartition != null) {
            mbo.setValue('STORAGEPARTITION', this.storagePartition);
        }
        if (!mbo.getMboValueData('LANGTABLENAME').isReadOnly()) {
            this.languageTable != null
                ? mbo.setValue('LANGTABLENAME', this.languageTable)
                : mbo.setValueNull('LANGTABLENAME');
        }
        if (!mbo.getMboValueData('LANGCOLUMNNAME').isReadOnly()) {
            this.languageColumn != null
                ? mbo.setValue('LANGCOLUMNNAME', this.languageColumn)
                : mbo.setValueNull('LANGCOLUMNNAME');
        }

        if (
            this.indexes.length > 0 &&
            !mbo.getMboValueData('ALTIXNAME').isReadOnly()
        ) {
            this.alternateIndex != null
                ? mbo.setValue(
                      'ALTIXNAME',
                      this.alternateIndex,
                      MboConstants.NOVALIDATION
                  )
                : mbo.setValueNull('ALTIXNAME');
        }

        if (!mbo.getMboValueData('TEXTSEARCHENABLED').isReadOnly()) {
            mbo.setValue('TEXTSEARCHENABLED', this.textSearchEnabled);
        }
        if (!mbo.getMboValueData('EAUDITENABLED').isReadOnly()) {
            mbo.setValue('EAUDITENABLED', this.auditEnabled);
        }

        if (mbo.getBoolean('EAUDITENABLED')) {
            this.auditTable != null
                ? mbo.setValue('EAUDITTBNAME', this.auditTable)
                : mbo.setValueNull('EAUDITTBNAME');
            this.eAuditFilter != null
                ? mbo.setValue('EAUDITFILTER', this.eAuditFilter)
                : mbo.setValueNull('EAUDITFILTER');
            this.eSignatureFilter != null
                ? mbo.setValue('ESIGFILTER', this.eSignatureFilter)
                : mbo.setValueNull('ESIGFILTER');
        }
    } else {
        if (mbo.toBeAdded()) {
            mbo.setValue('ISVIEW', this.view);
        }

        this.viewWhere != null
            ? mbo.setValue('VIEWWHERE', this.viewWhere)
            : mbo.setValueNull('VIEWWHERE');

        if (this.joinToObject && mbo.toBeAdded()) {
            mbo.setValue('JOINTOOBJECT', this.joinToObject);
        }

        mbo.setValue('AUTOSELECT', this.automaticallySelect);

        if (!this.automaticallySelect) {
            this.viewSelect != null
                ? mbo.setValue('VIEWSELECT', this.viewSelect)
                : mbo.setValueNull('VIEWSELECT');
            this.viewFrom != null
                ? mbo.setValue('VIEWFROM', this.viewFrom)
                : mbo.setValueNull('VIEWFROM');
        }
    }

    var attributeSet = mbo.getMboSet('MAXATTRIBUTECFG');

    this.attributes.forEach(function (attributeConfig) {
        attribute = attributeSet.moveFirst();
        while (attribute) {
            if (
                attribute
                    .getString('ATTRIBUTENAME')
                    .equalsIgnoreCase(attributeConfig.attribute)
            ) {
                break;
            }
            attribute = attributeSet.moveNext();
        }
        if (attributeConfig.delete) {
            if (attribute != null) {
                attribute.delete();
            }
        } else {
            if (!attribute) {
                attribute = attributeSet.add();
                attribute.setValue('ATTRIBUTENAME', attributeConfig.attribute);
            }

            attribute.setValue('REMARKS', attributeConfig.description);
            attribute.setValue('TITLE', attributeConfig.title);

            if (typeof attributeConfig.class !== 'undefined') {
                attributeConfig.class == null
                    ? attribute.setValueNull('CLASSNAME')
                    : attribute.setValue('CLASSNAME', attributeConfig.class);
            }

            if (
                typeof attributeConfig.type !== 'undefined' &&
                !attribute.getMboValueData('MAXTYPE').isReadOnly()
            ) {
                attributeConfig.type == null
                    ? attribute.setValueNull('MAXTYPE')
                    : attribute.setValue('MAXTYPE', attributeConfig.type);
            }

            if (
                typeof attributeConfig.length !== 'undefined' &&
                attributeConfig.length &&
                !attribute.getMboValueData('LENGTH').isReadOnly()
            ) {
                attribute.setValue('LENGTH', attributeConfig.length);
            }
            if (
                typeof attributeConfig.scale !== 'undefined' &&
                attributeConfig.scale &&
                !attribute.getMboValueData('SCALE').isReadOnly()
            ) {
                attribute.setValue('SCALE', attributeConfig.scale);
            }

            if (!attribute.getMboValueData('REQUIRED').isReadOnly()) {
                attribute.setValue(
                    'REQUIRED',
                    typeof attributeConfig.required === 'undefined'
                        ? false
                        : attributeConfig.required
                );
            }

            if (typeof attributeConfig.defaultValue !== 'undefined') {
                attributeConfig.defaultValue == null
                    ? attribute.setValueNull('DEFAULTVALUE')
                    : attribute.setValue(
                          'DEFAULTVALUE',
                          attributeConfig.defaultValue
                      );
            }

            if (typeof attributeConfig.domain !== 'undefined') {
                attributeConfig.domain == null
                    ? attribute.setValueNull('DOMAINID')
                    : attribute.setValue('DOMAINID', attributeConfig.domain);
            }

            if (typeof attributeConfig.alias !== 'undefined') {
                attributeConfig.alias == null
                    ? attribute.setValueNull('ALIAS')
                    : attribute.setValue('ALIAS', attributeConfig.alias);
            }

            if (!attribute.getMboValueData('PERSISTENT').isReadOnly()) {
                attribute.setValue(
                    'PERSISTENT',
                    typeof attributeConfig.presistent === 'undefined'
                        ? true
                        : attributeConfig.presistent
                );
            }

            if (!attribute.getMboValueData('MUSTBE').isReadOnly()) {
                attribute.setValue(
                    'MUSTBE',
                    typeof attributeConfig.mustBe === 'undefined'
                        ? false
                        : attributeConfig.mustBe
                );
            }

            if (
                typeof attributeConfig.column !== 'undefined' &&
                !attribute.getMboValueData('COLUMNNAME').isReadOnly()
            ) {
                attributeConfig.column == null
                    ? attribute.setValueNull('COLUMNNAME')
                    : attribute.setValue('COLUMNNAME', attributeConfig.column);
            }

            if (typeof attributeConfig.sameAsObject !== 'undefined') {
                attributeConfig.sameAsObject == null
                    ? attribute.setValueNull(
                          'SAMEASOBJECT',
                          MboConstants.NOACCESSCHECK
                      )
                    : attribute.setValue(
                          'SAMEASOBJECT',
                          attributeConfig.sameAsObject,
                          MboConstants.NOACCESSCHECK
                      );
            }
            if (typeof attributeConfig.sameAsAttribute !== 'undefined') {
                attributeConfig.sameAsAttribute == null
                    ? attribute.setValueNull(
                          'SAMEASATTRIBUTE',
                          MboConstants.NOACCESSCHECK
                      )
                    : attribute.setValue(
                          'SAMEASATTRIBUTE',
                          attributeConfig.sameAsAttribute,
                          MboConstants.NOACCESSCHECK
                      );
            }

            if (!attribute.getMboValueData('CANAUTONUM').isReadOnly()) {
                attribute.setValue(
                    'CANAUTONUM',
                    typeof attributeConfig.canAutonumber === 'undefined'
                        ? false
                        : attributeConfig.canAutonumber
                );
            }

            if (!attribute.getMboValueData('AUTOKEYNAME').isReadOnly()) {
                if (typeof attributeConfig.autonumber !== 'undefined') {
                    attributeConfig.autonumber == null
                        ? attribute.setValueNull('AUTOKEYNAME')
                        : attribute.setValue(
                              'AUTOKEYNAME',
                              attributeConfig.autonumber
                          );
                }
            }

            if (!attribute.getMboValueData('SEARCHTYPE').isReadOnly()) {
                if (typeof attributeConfig.searchType !== 'undefined') {
                    attributeConfig.searchType == null
                        ? attribute.setValueNull('SEARCHTYPE')
                        : attribute.setValue(
                              'SEARCHTYPE',
                              attributeConfig.searchType
                          );
                }
            }

            if (!attribute.getMboValueData('LOCALIZABLE').isReadOnly()) {
                attribute.setValue(
                    'LOCALIZABLE',
                    typeof attributeConfig.localizable === 'undefined'
                        ? false
                        : attributeConfig.localizable
                );
            }

            if (!attribute.getMboValueData('TEXTDIRECTION').isReadOnly()) {
                if (typeof attributeConfig.textDirection !== 'undefined') {
                    attributeConfig.textDirection == null
                        ? attribute.setValueNull('TEXTDIRECTION')
                        : attribute.setValue(
                              'TEXTDIRECTION',
                              attributeConfig.textDirection
                          );
                }
            }

            if (!attribute.getMboValueData('ISPOSITIVE').isReadOnly()) {
                attribute.setValue(
                    'ISPOSITIVE',
                    typeof attributeConfig.positive === 'undefined'
                        ? false
                        : attributeConfig.positive
                );
            }

            if (!attribute.getMboValueData('ISLDOWNER').isReadOnly()) {
                attribute.setValue(
                    'ISLDOWNER',
                    typeof attributeConfig.longDescriptionOwner === 'undefined'
                        ? false
                        : attributeConfig.longDescriptionOwner
                );
            }
            if (!attribute.getMboValueData('SEQUENCENAME').isReadOnly()) {
                if (typeof attributeConfig.sequenceName !== 'undefined') {
                    attributeConfig.sequenceName == null
                        ? attribute.setValueNull('SEQUENCENAME')
                        : attribute.setValue(
                              'SEQUENCENAME',
                              attributeConfig.sequenceName
                          );
                }
            }

            if (!attribute.getMboValueData('COMPLEXEXPRESSION').isReadOnly()) {
                if (
                    typeof attributeConfig.typeOfComplexExpression !==
                    'undefined'
                ) {
                    attributeConfig.typeOfComplexExpression == null
                        ? attribute.setValueNull('COMPLEXEXPRESSION')
                        : attribute.setValue(
                              'COMPLEXEXPRESSION',
                              attributeConfig.typeOfComplexExpression
                          );
                }
            }

            if (!attribute.getMboValueData('EAUDITENABLED').isReadOnly()) {
                attribute.setValue(
                    'EAUDITENABLED',
                    typeof attributeConfig.eAuditEanbled === 'undefined'
                        ? false
                        : attributeConfig.eAuditEanbled
                );
            }
            if (!attribute.getMboValueData('MLINUSE').isReadOnly()) {
                attribute.setValue(
                    'MLINUSE',
                    typeof attributeConfig.multiLanguageInUse === 'undefined'
                        ? false
                        : attributeConfig.multiLanguageInUse
                );
            }
            if (!attribute.getMboValueData('ESIGENABLED').isReadOnly()) {
                attribute.setValue(
                    'ESIGENABLED',
                    typeof attributeConfig.eSignatureEnabled === 'undefined'
                        ? false
                        : attributeConfig.eSignatureEnabled
                );
            }
            if (
                typeof attributeConfig.primaryColumn === 'undefined' ||
                attributeConfig.primaryColumn == null
            ) {
                attribute.setValueNull(
                    'PRIMARYKEYCOLSEQ',
                    MboConstants.NOACCESSCHECK
                );
            } else {
                attribute.setValue(
                    'PRIMARYKEYCOLSEQ',
                    attributeConfig.primaryColumn,
                    MboConstants.NOACCESSCHECK
                );
            }
        }
    });

    if (
        this.indexes &&
        Array.isArray(this.indexes) &&
        this.indexes.length > 0
    ) {
        var indexSet = mbo.getMboSet('MAXSYSINDEXES');
        this.indexes.forEach(function (indexConfig) {
            index = indexSet.moveFirst();
            while (index) {
                if (
                    index.getString('NAME').equalsIgnoreCase(indexConfig.index)
                ) {
                    break;
                }
                index = indexSet.moveNext();
            }
            if (indexConfig.delete) {
                if (index != null) {
                    index.delete();
                }
            } else if (
                !index &&
                typeof indexConfig.columns !== 'undefined' &&
                Array.isArray(indexConfig.columns) &&
                indexConfig.columns.length > 0
            ) {
                index = indexSet.add();
                index.setValue('NAME', indexConfig.index);
                index.setValue(
                    'UNIQUE',
                    typeof indexConfig.enforceUniqueness === 'undefined'
                        ? false
                        : indexConfig.enforceUniqueness
                );
                index.setValue(
                    'CLUSTERRULE',
                    typeof indexConfig.clusteredIndex === 'undefined'
                        ? false
                        : indexConfig.clusteredIndex
                );
                if (!index.getMboValueData('TEXTSEARCH').isReadOnly()) {
                    index.setValue(
                        'TEXTSEARCH',
                        typeof indexConfig.textSearchIndex === 'undefined'
                            ? false
                            : indexConfig.textSearchIndex
                    );
                }

                if (!index.getMboValueData('STORAGEPARTITION').isReadOnly()) {
                    typeof indexConfig.storagePartition === 'undefined' ||
                    indexConfig.storagePartition == null
                        ? index.setValueNull('STORAGEPARTITION')
                        : index.setValue(
                              'STORAGEPARTITION',
                              indexConfig.storagePartition
                          );
                }

                var maxSysKeysSet = index.getMboSet('MAXSYSKEYS');

                indexConfig.columns.forEach(function (column) {
                    var key = maxSysKeysSet.add();
                    key.setValue('COLNAME', column.column);
                    key.setValue(
                        'ASCENDING',
                        typeof column.ascending === 'undefined'
                            ? false
                            : column.ascending
                    );
                    key.setValue('COLSEQ', column.sequence);
                });
            }
        });
    }

    if (
        this.relationships &&
        Array.isArray(this.relationships) &&
        this.relationships.length > 0
    ) {
        var relationshipSet = mbo.getMboSet('MAXRELATIONSHIP');

        this.relationships.forEach(function (relationshipConfig) {
            relationship = relationshipSet.moveFirst();
            while (relationship) {
                if (
                    relationship
                        .getString('NAME')
                        .equalsIgnoreCase(relationshipConfig.relationship)
                ) {
                    break;
                }
                relationship = relationshipSet.moveNext();
            }
            if (relationshipConfig.delete) {
                if (relationship != null) {
                    relationship.delete();
                }
            } else if (!relationshipConfig.delete) {
                if (!relationship) {
                    relationship = relationshipSet.add();
                    relationship.setValue(
                        'NAME',
                        relationshipConfig.relationship
                    );
                    relationship.setValue('CHILD', relationshipConfig.child);
                }

                typeof relationshipConfig.remarks === 'undefined' ||
                relationshipConfig.remarks == null
                    ? relationship.setValueNull('REMARKS')
                    : relationship.setValue(
                          'REMARKS',
                          relationshipConfig.remarks
                      );
                typeof relationshipConfig.whereClause === 'undefined' ||
                relationshipConfig.whereClause == null
                    ? relationship.setValueNull('WHERECLAUSE')
                    : relationship.setValue(
                          'WHERECLAUSE',
                          relationshipConfig.whereClause
                      );
            }
        });
    }
};

function Domain(domain) {
    if (!domain) {
        throw new Error(
            'A integration object JSON is required to create the Domain object.'
        );
    } else if (typeof domain.domainType === 'undefined') {
        throw new Error(
            'The domainType property is required and must a Maximo Domain field value.'
        );
    } else if (typeof domain.domainId === 'undefined') {
        throw new Error(
            'The domainId property is required and must a Maximo Domain field value.'
        );
    }
    this.domainId = domain.domainId;
    this.domainType = domain.domainType;
    this.scale = typeof domain.scale === 'undefined' ? '' : domain.scale;
    this.description =
        typeof domain.description === 'undefined' ? '' : domain.description;

    switch (domain.domainType) {
        case 'ALN':
            if (typeof domain.length === 'undefined') {
                throw new Error(
                    'The length property is required and must a Maximo Domain field value.'
                );
            } else if (typeof domain.maxType === 'undefined') {
                throw new Error(
                    'The maxType property is required and must a Maximo Domain field value.'
                );
            }
            this.length = domain.length;
            this.maxType = domain.maxType;
            if (
                typeof domain.alnDomain !== 'undefined' &&
                Array.isArray(domain.alnDomain)
            ) {
                domain.alnDomain.forEach(function (alnValue) {
                    if (
                        typeof alnValue.value === 'undefined' ||
                        !alnValue.value
                    ) {
                        throw new Error(
                            'A value for domain ' +
                                domain.domainId +
                                ' is missing or has an empty value for the required value property.'
                        );
                    }
                    alnValue.description =
                        typeof alnValue.description === 'undefined'
                            ? ''
                            : alnValue.description;
                    alnValue.orgId =
                        typeof alnValue.orgId === 'undefined'
                            ? ''
                            : alnValue.orgId;
                    alnValue.siteId =
                        typeof alnValue.siteId === 'undefined'
                            ? ''
                            : alnValue.siteId;
                    if (
                        alnValue.maxDomValCond &&
                        Array.isArray(alnValue.maxDomValCond)
                    ) {
                        alnValue.maxDomValCond.forEach(function (valCond) {
                            valCond.domainId = domain.domainId;
                            valCond.valueId =
                                domain.domainId + '|' + alnValue.value;
                            if (
                                typeof valCond.conditionNum === 'undefined' ||
                                !valCond.conditionNum
                            ) {
                                throw new Error(
                                    'A condition number for domain value ' +
                                        alnValue.value +
                                        ' is missing or has an empty value for the required condition number property'
                                );
                            }
                            valCond.objectName =
                                typeof valCond.objectName === 'undefined'
                                    ? ''
                                    : valCond.objectName;
                        });
                    } else {
                        alnValue.maxDomValCond = [];
                    }
                });
                this.alnDomain = domain.alnDomain;
            } else {
                this.alnDomain = [];
            }

            break;
        case 'NUMERIC':
            if (typeof domain.maxType === 'undefined') {
                throw new Error(
                    'The maxType property is required and must a Maximo Domain field value.'
                );
            }
            this.maxType = domain.maxType;
            if (domain.maxType == 'FLOAT' || domain.maxType == 'DECIMAL') {
                this.length =
                    typeof domain.length === 'undefined' ? '' : domain.length;
                this.scale =
                    typeof domain.scale === 'undefined' ? '' : domain.scale;
            }
            if (
                typeof domain.numericDomain !== 'undefined' &&
                Array.isArray(domain.numericDomain)
            ) {
                domain.numericDomain.forEach(function (numericValue) {
                    if (
                        typeof numericValue.value === 'undefined' ||
                        !numericValue.value ||
                        isNaN(numericValue.value)
                    ) {
                        throw new Error(
                            'A value for domain ' +
                                domain.domainId +
                                ' is missing, has an empty value, or the value is not a number for the required value property.'
                        );
                    }
                    numericValue.description =
                        typeof numericValue.description === 'undefined'
                            ? ''
                            : numericValue.description;
                    numericValue.orgId =
                        typeof numericValue.orgId === 'undefined'
                            ? ''
                            : numericValue.orgId;
                    numericValue.siteId =
                        typeof numericValue.siteId === 'undefined'
                            ? ''
                            : numericValue.siteId;
                    if (
                        numericValue.maxDomValCond &&
                        Array.isArray(numericValue.maxDomValCond)
                    ) {
                        numericValue.maxDomValCond.forEach(function (valCond) {
                            valCond.domainId = domain.domainId;
                            valCond.valueId =
                                domain.domainId + '|' + numericValue.value;
                            if (
                                typeof valCond.conditionNum === 'undefined' ||
                                !valCond.conditionNum
                            ) {
                                throw new Error(
                                    'A condition number for domain value ' +
                                        numericValue.value +
                                        ' is missing or has an empty value for the required condition number property'
                                );
                            }
                            valCond.objectName =
                                typeof valCond.objectName === 'undefined'
                                    ? ''
                                    : valCond.objectName;
                        });
                    } else {
                        numericValue.maxDomValCond = [];
                    }
                });
                this.numericDomain = domain.numericDomain;
            } else {
                this.numericDomain = [];
            }
            break;
        case 'NUMRANGE':
            if (typeof domain.maxType === 'undefined') {
                throw new Error(
                    'The maxType property is required and must a Maximo Domain field value.'
                );
            }
            this.maxType = domain.maxType;
            if (domain.maxType == 'FLOAT' || domain.maxType == 'DECIMAL') {
                this.length =
                    typeof domain.length === 'undefined' ? '' : domain.length;
                this.scale =
                    typeof domain.scale === 'undefined' ? '' : domain.scale;
            }
            if (domain.numRangeDomain && Array.isArray(domain.numRangeDomain)) {
                domain.numRangeDomain.forEach(function (numRangeValue) {
                    if (
                        typeof numRangeValue.rangeSegment === 'undefined' ||
                        !numRangeValue.rangeSegment ||
                        isNaN(numRangeValue.rangeSegment)
                    ) {
                        throw new Error(
                            'A range segment for domain ' +
                                domain.domainId +
                                ' is missing, has an empty value, or the value is not a number for the required range segment property.'
                        );
                    }
                    numRangeValue.rangeMinimum =
                        typeof numRangeValue.rangeMinimum === 'undefined'
                            ? ''
                            : numRangeValue.rangeMinimum;
                    numRangeValue.rangeMaximum =
                        typeof numRangeValue.rangeMaximum === 'undefined'
                            ? ''
                            : numRangeValue.rangeMaximum;
                    numRangeValue.rangeInterval =
                        typeof numRangeValue.rangeInterval === 'undefined'
                            ? ''
                            : numRangeValue.rangeInterval;
                    numRangeValue.orgId =
                        typeof numRangeValue.orgId === 'undefined'
                            ? ''
                            : numRangeValue.orgId;
                    numRangeValue.siteId =
                        typeof numRangeValue.siteId === 'undefined'
                            ? ''
                            : numRangeValue.siteId;
                });
                this.numRangeDomain = domain.numRangeDomain;
            } else {
                this.numRangeDomain = [];
            }
            break;
        case 'SYNONYM':
            this.maxType =
                typeof domain.maxType === 'undefined' ? '' : domain.maxType;
            if (domain.synonymDomain && Array.isArray(domain.synonymDomain)) {
                domain.synonymDomain.forEach(function (synonymValue) {
                    if (
                        typeof synonymValue.value === 'undefined' ||
                        !synonymValue.value
                    ) {
                        throw new Error(
                            'A value for domain ' +
                                domain.domainId +
                                ' is missing or has an empty value for the required value property.'
                        );
                    } else if (
                        typeof synonymValue.maxValue === 'undefined' ||
                        !synonymValue.maxValue
                    ) {
                        throw new Error(
                            'A maxValue for domain ' +
                                domain.domainId +
                                ' is missing or has an empty value for the required maxValue property.'
                        );
                    }
                    synonymValue.description =
                        typeof synonymValue.description === 'undefined'
                            ? ''
                            : synonymValue.description;
                    synonymValue.orgId =
                        typeof synonymValue.orgId === 'undefined'
                            ? ''
                            : synonymValue.orgId;
                    synonymValue.siteId =
                        typeof synonymValue.siteId === 'undefined'
                            ? ''
                            : synonymValue.siteId;
                    synonymValue.defaults =
                        typeof synonymValue.defaults === 'undefined'
                            ? false
                            : synonymValue.defaults === true;
                    if (
                        synonymValue.maxDomValCond &&
                        Array.isArray(synonymValue.maxDomValCond)
                    ) {
                        synonymValue.maxDomValCond.forEach(function (valCond) {
                            valCond.domainId = domain.domainId;
                            valCond.valueId =
                                domain.domainId +
                                '|' +
                                synonymValue.value.toUpperCase();
                            if (
                                typeof valCond.conditionNum === 'undefined' ||
                                !valCond.conditionNum
                            ) {
                                throw new Error(
                                    'A condition number for domain value ' +
                                        synonymValue.value +
                                        ' is missing or has an empty value for the required condition number property'
                                );
                            }
                            valCond.objectName =
                                typeof valCond.objectName === 'undefined'
                                    ? ''
                                    : valCond.objectName;
                        });
                    } else {
                        synonymValue.maxDomValCond = [];
                    }
                });
                this.synonymDomain = domain.synonymDomain;
            } else {
                this.synonymDomain = [];
            }
            break;
        case 'TABLE':
            this.maxType =
                typeof domain.maxType === 'undefined' ? '' : domain.maxType;
            if (typeof domain.tableDomain !== 'undefined') {
                tableValue = domain.tableDomain;
                if (
                    typeof tableValue.objectName === 'undefined' ||
                    !tableValue.objectName
                ) {
                    throw new Error(
                        'An object name is missing or has an empty value for the required object name property.'
                    );
                }

                tableValue.validtnWhereClause =
                    typeof tableValue.validtnWhereClause === 'undefined'
                        ? ''
                        : tableValue.validtnWhereClause;
                tableValue.listWhereClause =
                    typeof tableValue.listWhereClause === 'undefined'
                        ? ''
                        : tableValue.listWhereClause;
                tableValue.errorResourcBundle =
                    typeof tableValue.errorResourcBundle === 'undefined'
                        ? ''
                        : tableValue.errorResourcBundle;
                tableValue.errorAccessKey =
                    typeof tableValue.errorAccessKey === 'undefined'
                        ? ''
                        : tableValue.errorAccessKey;
                tableValue.orgId =
                    typeof tableValue.orgId === 'undefined'
                        ? ''
                        : tableValue.orgId;
                tableValue.siteId =
                    typeof tableValue.siteId === 'undefined'
                        ? ''
                        : tableValue.siteId;

                this.tableDomain = domain.tableDomain;
            } else {
                this.tableDomain = {};
            }
            break;
        case 'CROSSOVER':
            if (
                typeof domain.crossoverDomain !== 'undefined' &&
                Array.isArray(domain.crossoverDomain)
            ) {
                domain.crossoverDomain.forEach(function (tableValue) {
                    if (
                        typeof tableValue.objectName === 'undefined' ||
                        !tableValue.objectName
                    ) {
                        throw new Error(
                            'An object name is missing or has an empty value for the required object name property.'
                        );
                    }

                    tableValue.validtnWhereClause =
                        typeof tableValue.validtnWhereClause === 'undefined'
                            ? ''
                            : tableValue.validtnWhereClause;
                    tableValue.listWhereClause =
                        typeof tableValue.listWhereClause === 'undefined'
                            ? ''
                            : tableValue.listWhereClause;
                    tableValue.errorResourcBundle =
                        typeof tableValue.errorResourcBundle === 'undefined'
                            ? ''
                            : tableValue.errorResourcBundle;
                    tableValue.errorAccessKey =
                        typeof tableValue.errorAccessKey === 'undefined'
                            ? ''
                            : tableValue.errorAccessKey;
                    tableValue.orgId =
                        typeof tableValue.orgId === 'undefined'
                            ? ''
                            : tableValue.orgId;
                    tableValue.siteId =
                        typeof tableValue.siteId === 'undefined'
                            ? ''
                            : tableValue.siteId;
                    if (
                        typeof tableValue.crossoverFields !== 'undefined' &&
                        Array.isArray(tableValue.crossoverFields)
                    ) {
                        tableValue.crossoverFields.forEach(function (
                            crossoverField
                        ) {
                            if (
                                typeof crossoverField.sourceField ===
                                    'undefined' ||
                                !crossoverField.sourceField
                            ) {
                                throw new Error(
                                    'A source field is required for the ' +
                                        domain.domainId +
                                        ' domain, ' +
                                        tableValue.objectName +
                                        ' object'
                                );
                            }
                            if (
                                typeof crossoverField.destField ===
                                    'undefined' ||
                                !crossoverField.destField
                            ) {
                                throw new Error(
                                    'A destination field is required for the ' +
                                        domain.domainId +
                                        ' domain, ' +
                                        tableValue.objectName +
                                        ' object'
                                );
                            }
                            crossoverField.copyEvenIfSrcNull =
                                typeof crossoverField.copyEvenIfSrcNull ===
                                'undefined'
                                    ? false
                                    : crossoverField.copyEvenIfSrcNull == true;
                            crossoverField.copyOnlyIfDestNull =
                                typeof crossoverField.copyOnlyIfDestNull ===
                                'undefined'
                                    ? false
                                    : crossoverField.copyOnlyIfDestNull == true;
                            crossoverField.sourceCondition =
                                typeof crossoverField.sourceCondition ===
                                'undefined'
                                    ? ''
                                    : crossoverField.sourceCondition;
                            crossoverField.destCondition =
                                typeof crossoverField.destCondition ===
                                'undefined'
                                    ? ''
                                    : crossoverField.destCondition;
                            crossoverField.sequence =
                                typeof crossoverField.sequence === 'undefined'
                                    ? ''
                                    : crossoverField.sequence;
                        });
                    } else {
                        tableValue.crossoverFields = [];
                    }
                });
                this.crossoverDomain = domain.crossoverDomain;
            } else {
                this.crossoverDomain = [];
            }
            break;
        default:
            throw new Error(
                'The provided domain type is not valid. Specify a valid domain type (ALN,NUMERIC,NUMRANGE,SYNONYM,TABLE,CROSSOVER)'
            );
    }
}
Domain.prototype.constructor = Domain;
Domain.prototype.setMboValues = function (mbo) {
    if (!mbo) {
        throw new Error(
            'A Mbo is required to set values from the Domain object.'
        );
    } else if (!(mbo instanceof Java.type('psdi.mbo.Mbo'))) {
        throw new Error(
            'The mbo parameter must be an instance of psdi.mbo.Mbo.'
        );
    } else if (!mbo.isBasedOn('MAXDOMAIN')) {
        throw new Error(
            'The mbo parameter must be based on the MAXDOMAIN Maximo object.'
        );
    }
    if (this.domainType != 'SYNONYM') {
        if (mbo.isNull('DOMAINID')) {
            mbo.setValue('DOMAINID', this.domainId);
            mbo.setValue('DOMAINTYPE', this.domainType);
        }
        if (this.domainType != 'TABLE' && this.domainType != 'CROSSOVER') {
            if (mbo.isNull('MAXTYPE')) {
                mbo.setValue('MAXTYPE', this.maxType);
            }
        } else if (this.domainType == 'ALN') {
            mbo.setValue('LENGTH', this.length);
        } else if (this.maxType == 'FLOAT' || this.maxType == 'DECIMAL') {
            mbo.setValue('LENGTH', this.length);
            mbo.setValue('SCALE', this.scale);
        }
        mbo.setValue('DESCRIPTION', this.description);
    }

    switch (this.domainType) {
        case 'ALN':
            var alnDomainSet = mbo.getMboSet('ALNDOMAINVALUE');
            alnDomainSet.deleteAll();
            this.alnDomain.forEach(function (alnValue) {
                var alnMbo = alnDomainSet.add();
                alnMbo.setValue('VALUE', alnValue.value);
                alnMbo.setValue('DESCRIPTION', alnValue.description);
                alnMbo.setValue('ORGID', alnValue.orgId);
                alnMbo.setValue('SITEID', alnValue.siteId);

                var maxDomValCondSet = alnMbo.getMboSet('MAXDOMVALCOND');
                alnValue.maxDomValCond.forEach(function (valCond) {
                    var maxDomValCondMbo = maxDomValCondSet.add();
                    maxDomValCondMbo.setValue('DOMAINID', valCond.domainId);
                    maxDomValCondMbo.setValue(
                        'VALUEID',
                        valCond.valueId.toUpperCase()
                    );
                    maxDomValCondMbo.setValue(
                        'CONDITIONNUM',
                        valCond.conditionNum
                    );
                    maxDomValCondMbo.setValue('OBJECTNAME', valCond.objectName);
                });
            });
            break;
        case 'NUMERIC':
            var numericDomainSet = mbo.getMboSet('NUMDOMAINVALUE');
            numericDomainSet.deleteAll();
            this.numericDomain.forEach(function (numericValue) {
                var numericMbo = numericDomainSet.add();
                numericMbo.setValue('VALUE', numericValue.value);
                numericMbo.setValue('DESCRIPTION', numericValue.description);
                numericMbo.setValue('ORGID', numericValue.orgId);
                numericMbo.setValue('SITEID', numericValue.siteId);

                var maxDomValCondSet = numericMbo.getMboSet('MAXDOMVALCOND');
                numericValue.maxDomValCond.forEach(function (valCond) {
                    var maxDomValCondMbo = maxDomValCondSet.add();
                    maxDomValCondMbo.setValue('DOMAINID', valCond.domainId);
                    maxDomValCondMbo.setValue(
                        'VALUEID',
                        valCond.valueId.toUpperCase()
                    );
                    maxDomValCondMbo.setValue(
                        'CONDITIONNUM',
                        valCond.conditionNum
                    );
                    maxDomValCondMbo.setValue('OBJECTNAME', valCond.objectName);
                });
            });
            break;
        case 'NUMRANGE':
            var numRangeDomainSet = mbo.getMboSet('RANGEDOMSEGMENT');
            numRangeDomainSet.deleteAll();
            this.numRangeDomain.forEach(function (numRangeValue) {
                var numRangeMbo = numRangeDomainSet.add();
                numRangeMbo.setValue(
                    'RANGESEGMENT',
                    numRangeValue.rangeSegment
                );
                numRangeMbo.setValue(
                    'RANGEMINIMUM',
                    numRangeValue.rangeMinimum
                );
                numRangeMbo.setValue(
                    'RANGEMAXIMUM',
                    numRangeValue.rangeMaximum
                );
                numRangeMbo.setValue(
                    'RANGEINTERVAL',
                    numRangeValue.rangeInterval
                );
                numRangeMbo.setValue('ORGID', numRangeValue.orgId);
                numRangeMbo.setValue('SITEID', numRangeValue.siteId);
            });
            break;
        case 'SYNONYM':
            var synonymDomainSet = mbo.getMboSet('SYNONYMDOMAIN');
            //filter out default values since default values cannot be deleted.
            synonymDomainSet.setUserWhere('defaults = 0');
            var tempMaxDomValCondSet;
            var tempSynonymDomainSet;
            var sqlFormat;
            try {
                tempMaxDomValCondSet = MXServer.getMXServer().getMboSet(
                    'MAXDOMVALCOND',
                    MXServer.getMXServer().getSystemUserInfo()
                );
                sqlFormat = new SqlFormat(
                    'domainid = :1 and valueid IN (SELECT CONCAT(CONCAT(domainid,' |
                        '),value) FROM synonymdomain WHERE domainid = :1 AND DEFAULTS = 0'
                );
                sqlFormat.setObject(
                    1,
                    'MAXDOMVALCOND',
                    'DOMAINID',
                    this.domainId
                );
                tempMaxDomValCondSet.setWhere(sqlFormat.format());
                logger.info(
                    'temp domainvalcond set contains ' +
                        tempMaxDomValCondSet.count() +
                        ' records that will be deleted'
                );
                tempMaxDomValCondSet.deleteAll();
                tempMaxDomValCondSet.save();

                tempSynonymDomainSet = MXServer.getMXServer().getMboSet(
                    'SYNONYMDOMAIN',
                    MXServer.getMXServer().getSystemUserInfo()
                );
                sqlFormat = new SqlFormat('domainid = :1 and defaults = 0');
                sqlFormat.setObject(
                    1,
                    'SYNONYMDOMAIN',
                    'DOMAINID',
                    this.domainId
                );
                tempSynonymDomainSet.setWhere(sqlFormat.format());
                logger.info(
                    'temp synonymdomain set contains ' +
                        tempSynonymDomainSet.count() +
                        ' records that will be deleted'
                );
                for (
                    var tempSynonymDomainMbo = tempSynonymDomainSet.moveFirst();
                    tempSynonymDomainMbo != null;
                    tempSynonymDomainMbo = synonymDomainSet.moveNext()
                ) {
                    logger.info(
                        'deleteing value ' +
                            tempSynonymDomainMbo.getString('VALUE') +
                            ' with description ' +
                            tempSynonymDomainMbo.getString('DESCRIPTION')
                    );
                    tempSynonymDomainMbo.delete();
                    tempSynonymDomainSet.save();
                }
            } finally {
                __libraryClose(tempMaxDomValCondSet);
                __libraryClose(tempSynonymDomainSet);
            }

            this.synonymDomain.forEach(function (synonymValue) {
                sqlFormat = new SqlFormat('value = :1 and maxvalue = :2');
                sqlFormat.setObject(
                    1,
                    'SYNONYMDOMAIN',
                    'VALUE',
                    synonymValue.value
                );
                sqlFormat.setObject(
                    2,
                    'SYNONYMDOMAIN',
                    'MAXVALUE',
                    synonymValue.maxValue
                );
                synonymDomainSet.setUserWhere(sqlFormat.format());
                if (synonymDomainSet.isEmpty()) {
                    var synonymMbo = synonymDomainSet.add();
                    synonymMbo.setValue('VALUE', synonymValue.value);
                    synonymMbo.setValue('MAXVALUE', synonymValue.maxValue);
                    synonymMbo.setValue(
                        'DESCRIPTION',
                        synonymValue.description
                    );
                    synonymMbo.setValue('ORGID', synonymValue.orgId);
                    synonymMbo.setValue('SITEID', synonymValue.siteId);
                    synonymMbo.setValue('DEFAULTS', synonymValue.defaults);

                    var maxDomValCondSet =
                        synonymMbo.getMboSet('MAXDOMVALCOND');
                    synonymValue.maxDomValCond.forEach(function (valCond) {
                        var maxDomValCondMbo = maxDomValCondSet.add();
                        logger.info(
                            'Adding record for value ' +
                                valCond.valueId.toUpperCase()
                        );
                        maxDomValCondMbo.setValue('DOMAINID', valCond.domainId);
                        maxDomValCondMbo.setValue(
                            'VALUEID',
                            valCond.valueId.toUpperCase()
                        );
                        maxDomValCondMbo.setValue(
                            'CONDITIONNUM',
                            valCond.conditionNum
                        );
                        maxDomValCondMbo.setValue(
                            'OBJECTNAME',
                            valCond.objectName
                        );
                    });

                    //After adding value, if defaults = 1 then mark other maxvalue records as defaults = 0
                    if (
                        synonymValue.defaults == 1 ||
                        synonymValue.defaults == '1' ||
                        synonymValue.defaults
                    ) {
                        sqlFormat = new SqlFormat(
                            'maxvalue = :1 and value != :2'
                        );
                        sqlFormat.setObject(
                            1,
                            'SYNONYMDOMAIN',
                            'MAXVALUE',
                            synonymValue.maxValue
                        );
                        sqlFormat.setObject(
                            2,
                            'SYNONYMDOMAIN',
                            'VALUE',
                            synonymValue.value
                        );
                        synonymDomainSet.setUserWhere(sqlFormat.format());
                        if (!synonymDomainSet.isEmpty()) {
                            for (
                                var synDomMbo = synonymDomainSet.moveFirst();
                                synDomMbo != null;
                                synDomMbo = synonymDomainSet.moveNext()
                            ) {
                                synDomMbo.setValue('DEFAULTS', false);
                            }
                        }
                    }
                } else {
                    //value exists - allow updating any info except value or maxvalue
                    var synonymMbo = synonymDomainSet.getMbo(0);
                    synonymMbo.setValue(
                        'DESCRIPTION',
                        synonymValue.description
                    );
                    synonymMbo.setValue('DEFAULTS', synonymValue.defaults);
                    //replace domain value conditions
                    var maxDomValCondSet =
                        synonymMbo.getMboSet('MAXDOMVALCOND');
                    maxDomValCondSet.deleteAll();
                    synonymValue.maxDomValCond.forEach(function (valCond) {
                        var maxDomValCondMbo = maxDomValCondSet.add();
                        maxDomValCondMbo.setValue('DOMAINID', valCond.domainId);
                        maxDomValCondMbo.setValue(
                            'VALUEID',
                            valCond.valueId.toUpperCase()
                        );
                        maxDomValCondMbo.setValue(
                            'CONDITIONNUM',
                            valCond.conditionNum
                        );
                        maxDomValCondMbo.setValue(
                            'OBJECTNAME',
                            valCond.objectName
                        );
                    });

                    //After updating value, if defaults = 1 then mark other maxvalue records as defaults = 0
                    if (
                        synonymValue.defaults == 1 ||
                        synonymValue.defaults == '1' ||
                        synonymValue.defaults
                    ) {
                        sqlFormat = new SqlFormat(
                            'maxvalue = :1 and value != :2'
                        );
                        sqlFormat.setObject(
                            1,
                            'SYNONYMDOMAIN',
                            'MAXVALUE',
                            synonymValue.maxValue
                        );
                        sqlFormat.setObject(
                            2,
                            'SYNONYMDOMAIN',
                            'VALUE',
                            synonymValue.value
                        );
                        synonymDomainSet.setUserWhere(sqlFormat.format());
                        if (!synonymDomainSet.isEmpty()) {
                            for (
                                var synDomMbo = synonymDomainSet.moveFirst();
                                synDomMbo != null;
                                synDomMbo = synonymDomainSet.moveNext()
                            ) {
                                synDomMbo.setValue('DEFAULTS', false);
                            }
                        }
                    }
                }
            });
            break;
        case 'TABLE':
            var tableDomainSet = mbo.getMboSet('MAXTABLEDOMAIN');
            tableDomainSet.deleteAll();
            var tableValue = this.tableDomain;

            var tableMbo = tableDomainSet.add();
            tableMbo.setValue(
                'OBJECTNAME',
                tableValue.objectName,
                MboConstants.NOVALIDATION
            );
            if (tableValue.validtnWhereClause != null) {
                tableMbo.setValue(
                    'VALIDTNWHERECLAUSE',
                    tableValue.validtnWhereClause
                );
            }
            if (tableValue.listWhereClause != null) {
                tableMbo.setValue(
                    'LISTWHERECLAUSE',
                    tableValue.listWhereClause
                );
            }
            if (tableValue.errorResourcBundle != null) {
                tableMbo.setValue(
                    'ERRORRESOURCBUNDLE',
                    tableValue.errorResourcBundle
                );
            }
            if (tableValue.errorAccessKey != null) {
                tableMbo.setValue('ERRORACCESSKEY', tableValue.errorAccessKey);
            }
            if (tableValue.orgId != null) {
                tableMbo.setValue('ORGID', tableValue.orgId);
            }
            if (tableValue.siteId != null) {
                tableMbo.setValue('SITEID', tableValue.siteId);
            }

            break;
        case 'CROSSOVER':
            var tableDomainSet = mbo.getMboSet('MAXTABLEDOMAINFORCROSSOVER');
            this.crossoverDomain.forEach(function (tableValue) {
                var tableMbo = tableDomainSet.add();
                // set as no-validate to allow for domains to be added before ther table is created.
                tableMbo.setValue(
                    'OBJECTNAME',
                    tableValue.objectName,
                    MboConstants.NOVALIDATION
                );
                tableMbo.setValue(
                    'VALIDTNWHERECLAUSE',
                    tableValue.validtnWhereClause
                );
                tableMbo.setValue(
                    'LISTWHERECLAUSE',
                    tableValue.listWhereClause
                );
                tableMbo.setValue(
                    'ERRORRESOURCBUNDLE',
                    tableValue.errorResourcBundle
                );
                tableMbo.setValue('ERRORACCESSKEY', tableValue.errorAccessKey);
                tableMbo.setValue('ORGID', tableValue.orgId);
                tableMbo.setValue('SITEID', tableValue.siteId);
                var crossoverDomainSet = tableMbo.getMboSet('CROSSOVERDOMAIN');
                tableValue.crossoverFields.forEach(function (crossoverField) {
                    var crossoverMbo = crossoverDomainSet.add();
                    crossoverMbo.setValue(
                        'SOURCEFIELD',
                        crossoverField.sourceField
                    );
                    crossoverMbo.setValue(
                        'DESTFIELD',
                        crossoverField.destField
                    );
                    crossoverMbo.setValue(
                        'COPYEVENIFSRCNULL',
                        crossoverField.copyEvenIfSrcNull
                    );
                    crossoverMbo.setValue(
                        'COPYONLYIFDESTNULL',
                        crossoverField.copyOnlyIfDestNull
                    );
                    crossoverMbo.setValue(
                        'SOURCECONDITION',
                        crossoverField.sourceCondition
                    );
                    crossoverMbo.setValue(
                        'DESTCONDITION',
                        crossoverField.destCondition
                    );
                    crossoverMbo.setValue('SEQUENCE', crossoverField.sequence);
                });
            });
            break;
        default:
            throw new Error('Provided domain type is not a valid value');
    }
};

// Main function that is called when the script is invoked.
// This is provided for testing purposes.
mainLibrary();

function mainLibrary() {
    // if the script is being invoked from the web then parse the requestBody and proces.
    if (
        typeof request !== 'undefined' &&
        typeof requestBody !== 'undefined' &&
        requestBody &&
        request.getQueryParam('develop') == 'true'
    ) {
        var config = JSON.parse(requestBody);
        deployConfig(config);
        responseBody = JSON.stringify(
            {
                status: 'success',
                message: 'Sucessfully deploy the configuration changes.',
            },
            null,
            4
        );
    }
}

/**
 * Deploys the array of messages, properties, or other items.
 *
 * @param {*} config A parsed JSON array of messages, properties, and other items to be added, updated, or deleted.
 */
function deployConfig(config) {
    logger.debug(
        'Deploying Configuration: \n' + JSON.stringify(config, null, 4)
    );
    if (typeof config.messages !== 'undefined') {
        deployMessages(config.messages);
    }
    if (typeof config.properties !== 'undefined') {
        deployProperties(config.properties);
    }
    if (typeof config.domains !== 'undefined') {
        Java.type('java.lang.System').out.println('Deploying domain');
        deployDomains(config.domains);
    }
    if (typeof config.maxObjects !== 'undefined') {
        deployMaxObjects(config.maxObjects);
    }
    if (typeof config.objects !== 'undefined') {
        deployMaxObjects(config.objects);
    }
    if (typeof config.integrationObjects !== 'undefined') {
        deployIntegrationObjects(config.integrationObjects);
    }
    if (typeof config.cronTasks !== 'undefined') {
        deployCronTasks(config.cronTasks);
    }
    if (typeof config.EndPoints !== 'undefined') {
        deployEndPoints(config.endPoints);
    }
    if (typeof config.ExternalSystem !== 'undefined') {
        deployExternalSystems(config.externalSystems);
    }
    if (typeof config.loggers !== 'undefined') {
        deployLoggers(config.loggers);
    }
    if (typeof config.PublishChannel !== 'undefined') {
        deployPublishChannels(config.publishChannels);
    }
    if (typeof config.EnterpriseService !== 'undefined') {
        deployEnterpriseServices(config.enterpriseServices);
    }
    if (typeof config.Action !== 'undefined') {
        deployActions(config.actions);
    }
    if (typeof config.InvocationChannel !== 'undefined') {
        deployInvocationChannels(config.invocationChannels);
    }
    if (typeof config.CommunicationTemplate !== 'undefined') {
        deployCommunicationTemplates(config.communicationTemplates);
    }
    if (typeof config.LaunchInContext !== 'undefined') {
        deployLaunchInContexts(config.launchInContexts);
    }
}

/**
 * Deploys the array of actions provided. If an action has the value of delete set to true, that action
 * will be deleted based on the action's action property.
 *
 * @param {Action[]} actions a JSON array of actions to be added, updated or deleted.
 */
function deployActions(actions) {
    if (!actions || !Array.isArray(actions)) {
        throw new Error(
            'The actions parameter is required and must be an array of action objects.'
        );
    }

    actions.forEach(function (action) {
        if (typeof action.delete !== 'undefined' && action.delete == true) {
            deleteAction(action);
        } else {
            addOrUpdateAction(action);
        }
    });
}

/**
 * Adds an action if it does not exist or updates it to match the described state if the action exists.
 * @param {Action} action single action that will be added/updated
 */
function addOrUpdateAction(action) {
    logger.debug('Setting up the ' + action.action + ' action.');
    var actionSet;
    try {
        actionSet = MXServer.getMXServer().getMboSet(
            'ACTION',
            MXServer.getMXServer().getSystemUserInfo()
        );
        var actionRecord = new Action(action);
        var sqlf = new SqlFormat('action = :1');
        sqlf.setObject(1, 'ACTION', 'ACTION', action.action);
        actionSet.setWhere(sqlf.format());

        if (!actionSet.isEmpty()) {
            actionSet.deleteAll();
            actionSet.save();
        }
        actionRecord.setMboValues(actionSet.add());
        actionSet.save();
    } finally {
        __libraryClose(actionSet);
    }
    logger.debug('Setup up the ' + action.action + ' action.');
}

/**
 * Removes the provided action by matching the action property.
 * @param {Action} action single action that will be deleted.
 */
function deleteAction(action) {
    logger.debug('Deleting the ' + action.action + ' action.');
    var actionSet;
    try {
        actionSet = MXServer.getMXServer().getMboSet(
            'ACTION',
            MXServer.getMXServer().getSystemUserInfo()
        );
        var sqlf = new SqlFormat('action = :1');
        sqlf.setObject(1, 'ACTION', 'ACTION', action.action);
        actionSet.setWhere(sqlf.format());

        if (!actionSet.isEmpty()) {
            actionSet.deleteAll();
            actionSet.save();
        }
    } finally {
        __libraryClose(actionSet);
    }
    logger.debug('Deleted the ' + action.action + ' action.');
}

/**
 * Deploys the array of communication templates provided. If a communication template has the value of delete set to true, that communication template
 * will be deleted based on the communication template's templateID property.
 *
 * @param {CommunicationTemplate[]} communicationTemplates a JSON array of communication templates to be added, updated or deleted.
 */
function deployCommunicationTemplates(communicationTemplates) {
    if (!communicationTemplates || !Array.isArray(communicationTemplates)) {
        throw new Error(
            'The communicationTemplates parameter is required and must be an array of communication template objects.'
        );
    }

    communicationTemplates.forEach(function (communicationTemplate) {
        if (
            typeof communicationTemplate.delete !== 'undefined' &&
            communicationTemplate.delete == true
        ) {
            deleteCommunicationTemplate(communicationTemplate);
        } else {
            addOrUpdateCommunicationTemplate(communicationTemplate);
        }
    });
}

/**
 * Adds a communication template if it does not exist or updates it to match the described state if the communication template exists.
 * @param {CommunicationTemplate} communicationTemplate single communication template that will be added/updated
 */
function addOrUpdateCommunicationTemplate(communicationTemplate) {
    logger.debug(
        'Setting up the ' +
            communicationTemplate.templateID +
            ' communication template.'
    );
    var commTemplateSet;
    try {
        commTemplateSet = MXServer.getMXServer().getMboSet(
            'COMMTEMPLATE',
            MXServer.getMXServer().getSystemUserInfo()
        );
        var commTemplate = new CommunicationTemplate(communicationTemplate);
        var sqlf = new SqlFormat('templateid = :1');
        sqlf.setObject(
            1,
            'COMMTEMPLATE',
            'TEMPLATEID',
            communicationTemplate.templateID
        );
        commTemplateSet.setWhere(sqlf.format());

        if (!commTemplateSet.isEmpty()) {
            commTemplateSet.deleteAll();
            commTemplateSet.save();
        }
        commTemplate.setMboValues(commTemplateSet.add());
        commTemplateSet.save();
    } finally {
        __libraryClose(commTemplateSet);
    }
    logger.debug(
        'Set up the ' +
            communicationTemplate.ifaceName +
            ' communication template.'
    );
}

/**
 * Removes the provided communication template by matching the templateID property.
 * @param {CommunicationTemplate} communicationTemplate single communication template that will be deleted.
 */
function deleteCommunicationTemplate(communicationTemplate) {
    logger.debug(
        'Deleting the ' +
            communicationTemplate.ifaceName +
            ' communication template.'
    );
    var commTemplateSet;
    try {
        commTemplateSet = MXServer.getMXServer().getMboSet(
            'COMMTEMPLATE',
            MXServer.getMXServer().getSystemUserInfo()
        );
        var sqlf = new SqlFormat('templateid = :1');
        sqlf.setObject(
            1,
            'COMMTEMPLATE',
            'TEMPLATEID',
            communicationTemplate.templateID
        );
        commTemplateSet.setWhere(sqlf.format());

        if (!commTemplateSet.isEmpty()) {
            commTemplateSet.deleteAll();
            commTemplateSet.save();
        }
    } finally {
        __libraryClose(commTemplateSet);
    }
    logger.debug(
        'Deleted the ' +
            communicationTemplate.ifaceName +
            ' communication template.'
    );
}

/**
 * Deploys the array of Maximo object provided. If a Maximo object has the value of delete set to true, that object
 * will be deleted based on the objects objectName property.
 *
 * @param {MaxObject[]} maxObjects a JSON array of Maximo objects to be added, updated or deleted.
 */
function deployMaxObjects(maxObjects) {
    if (!maxObjects || !Array.isArray(maxObjects)) {
        throw new Error(
            'The maxObjects parameter is required and must be an array of Maximo objects.'
        );
    }

    maxObjects.forEach(function (maxObject) {
        if (
            typeof maxObject.delete !== 'undefined' &&
            maxObject.delete == true
        ) {
            deleteMaxObject(maxObject);
        } else {
            addOrUpdateMaxObject(maxObject);
        }
    });
}

/**
 * Adds a Maximo object if it does not exist or updates it to match the described state if the Maximo object exists.
 * @param {MaxObject} maxObject single Maximo object that will be added/updated
 */
function addOrUpdateMaxObject(maxObject) {
    logger.debug('Setting up the ' + maxObject.object + ' Maximo object.');
    var maxObjectSet;
    try {
        maxObjectSet = MXServer.getMXServer().getMboSet(
            'MAXOBJECTCFG',
            MXServer.getMXServer().getSystemUserInfo()
        );
        var maxObjectConfig = new MaxObject(maxObject);
        var sqlf = new SqlFormat('objectname = :1');
        sqlf.setObject(1, 'MAXOBJECTCFG', 'OBJECTNAME', maxObject.object);
        maxObjectSet.setWhere(sqlf.format());

        if (maxObjectSet.isEmpty()) {
            maxObjectConfig.setMboValues(maxObjectSet.add());
        } else {
            maxObjectConfig.setMboValues(maxObjectSet.moveFirst());
        }

        maxObjectSet.save();
    } finally {
        __libraryClose(maxObjectSet);
    }
    logger.debug('Set up the ' + maxObject.objectName + ' Maximo object.');
}

/**
 * Removes the provided Maximo Object by matching the objectName property.
 * @param {MaxObject} maxObject single Maximo object  that will be deleted.
 */
function deleteMaxObject(maxObject) {
    logger.debug('Deleting the ' + maxObject.objectNmae + ' Maximo object.');
    var maxObjectSet;
    try {
        maxObjectSet = MXServer.getMXServer().getMboSet(
            'MAXOBJECT',
            MXServer.getMXServer().getSystemUserInfo()
        );
        var sqlf = new SqlFormat('objectname = :1');
        sqlf.setObject(1, 'MAXOBJECT', 'OBJECTNAME', maxObject.objectName);
        maxObjectSet.setWhere(sqlf.format());

        if (!maxObjectSet.isEmpty()) {
            maxObjectSet.deleteAll();
            maxObjectSet.save();
        }
    } finally {
        __libraryClose(maxObjectSet);
    }
    logger.debug(
        'Deleted the ' + launchInContext.ifaceName + ' launch in context.'
    );
}

/**
 * Deploys the array of launch in contexts provided. If a launch in context has the value of delete set to true, that launch in context
 * will be deleted based on the launch in context's launchEntryName property.
 *
 * @param {LaunchInContext[]} launchInContext a JSON array of launch in contexts to be added, updated or deleted.
 */
function deployLaunchInContexts(launchInContexts) {
    if (!launchInContexts || !Array.isArray(launchInContexts)) {
        throw new Error(
            'The launchInContexts parameter is required and must be an array of launch in context objects.'
        );
    }

    launchInContexts.forEach(function (launchInContext) {
        if (
            typeof launchInContext.delete !== 'undefined' &&
            launchInContext.delete == true
        ) {
            deleteLaunchInContext(launchInContext);
        } else {
            addOrUpdateLaunchInContext(launchInContext);
        }
    });
}

/**
 * Adds a launch in context if it does not exist or updates it to match the described state if the launch in context exists.
 * @param {LaunchInContext} launchInContext single launch in context that will be added/updated
 */
function addOrUpdateLaunchInContext(launchInContext) {
    logger.debug(
        'Setting up the ' +
            launchInContext.launchEntryName +
            ' launch in context.'
    );
    var launchInContextSet;
    try {
        launchInContextSet = MXServer.getMXServer().getMboSet(
            'MAXLAUNCHENTRY',
            MXServer.getMXServer().getSystemUserInfo()
        );
        var launchContext = new LaunchInContext(launchInContext);
        var sqlf = new SqlFormat('launchentryname = :1');
        sqlf.setObject(
            1,
            'MAXLAUNCHENTRY',
            'LAUNCHENTRYNAME',
            launchInContext.launchEntryName
        );
        launchInContextSet.setWhere(sqlf.format());

        if (!launchInContextSet.isEmpty()) {
            launchInContextSet.deleteAll();
            launchInContextSet.save();
        }
        launchContext.setMboValues(launchInContextSet.add());
        launchInContextSet.save();
    } finally {
        __libraryClose(launchInContextSet);
    }
    logger.debug(
        'Set up the ' + launchInContext.ifaceName + ' launch in context.'
    );
}

/**
 * Removes the provided launch in context by matching the launchEntryName property.
 * @param {LaunchInContext} launchInContext single launch in context that will be deleted.
 */
function deleteLaunchInContext(launchInContext) {
    logger.debug(
        'Deleting the ' + launchInContext.ifaceName + ' launch in context.'
    );
    var launchInContextSet;
    try {
        launchInContextSet = MXServer.getMXServer().getMboSet(
            'MAXLAUNCHENTRY',
            MXServer.getMXServer().getSystemUserInfo()
        );
        var sqlf = new SqlFormat('launchentryname = :1');
        sqlf.setObject(
            1,
            'MAXLAUNCHENTRY',
            'LAUNCHENTRYNAME',
            launchInContext.launchEntryName
        );
        launchInContextSet.setWhere(sqlf.format());

        if (!launchInContextSet.isEmpty()) {
            launchInContextSet.deleteAll();
            launchInContextSet.save();
        }
    } finally {
        __libraryClose(launchInContextSet);
    }
    logger.debug(
        'Deleted the ' + launchInContext.ifaceName + ' launch in context.'
    );
}

/**
 * Deploys the array of invocation channels provided. If a invocation channel has the value of delete set to true, that invocation channel
 * will be deleted based on the invocation channel's ifaceName property.
 *
 * @param {InvocationChannel[]} invocationChannels a JSON array of invocation channels to be added, updated or deleted.
 */
function deployInvocationChannels(invocationChannels) {
    if (!invocationChannels || !Array.isArray(invocationChannels)) {
        throw new Error(
            'The invocationChannels parameter is required and must be an array of external system objects.'
        );
    }

    invocationChannels.forEach(function (invocationChannel) {
        if (
            typeof invocationChannel.delete !== 'undefined' &&
            invocationChannel.delete == true
        ) {
            deleteInvocationChannel(invocationChannel);
        } else {
            addOrUpdateInvocationChannel(invocationChannel);
        }
    });
}

/**
 * Adds a invocation channel if it does not exist or updates it to match the described state if the invocation channel exists.
 * @param {InvocationChannel} invocationChannel single invocation channel that will be added/updated
 */
function addOrUpdateInvocationChannel(invocationChannel) {
    logger.debug(
        'Setting up the ' + invocationChannel.ifaceName + ' invocation channel.'
    );
    var maxIfaceInvokeSet;
    try {
        maxIfaceInvokeSet = MXServer.getMXServer().getMboSet(
            'MAXIFACEINVOKE',
            MXServer.getMXServer().getSystemUserInfo()
        );
        var invokeChannel = new InvocationChannel(invocationChannel);
        var sqlf = new SqlFormat('ifacename = :1');
        sqlf.setObject(
            1,
            'MAXIFACEIN',
            'IFACENAME',
            invocationChannel.ifaceName
        );
        maxIfaceInvokeSet.setWhere(sqlf.format());

        if (!maxIfaceInvokeSet.isEmpty()) {
            maxIfaceInvokeSet.deleteAll();
            maxIfaceInvokeSet.save();
        }
        invokeChannel.setMboValues(maxIfaceInvokeSet.add());
        maxIfaceInvokeSet.save();
    } finally {
        __libraryClose(maxIfaceInvokeSet);
    }
    logger.debug(
        'Setup up the ' + invocationChannel.ifaceName + ' invocation channel.'
    );
}

/**
 * Removes the provided invocation channel by matching the ifaceName property.
 * @param {InvocationChannel} invocationChannel single invocation channel that will be deleted.
 */
function deleteInvocationChannel(invocationChannel) {
    logger.debug(
        'Deleting the ' + invocationChannel.ifaceName + ' invocation channel.'
    );
    var maxIfaceInvokeSet;
    try {
        maxIfaceInvokeSet = MXServer.getMXServer().getMboSet(
            'MAXIFACEINVOKE',
            MXServer.getMXServer().getSystemUserInfo()
        );
        var sqlf = new SqlFormat('ifacename = :1');
        sqlf.setObject(
            1,
            'MAXIFACEIN',
            'IFACENAME',
            invocationChannel.ifaceName
        );
        maxIfaceInvokeSet.setWhere(sqlf.format());

        if (!maxIfaceInvokeSet.isEmpty()) {
            maxIfaceInvokeSet.deleteAll();
            maxIfaceInvokeSet.save();
        }
    } finally {
        __libraryClose(maxIfaceInvokeSet);
    }
    logger.debug(
        'Deleted the ' + invocationChannel.ifaceName + ' invocation channel.'
    );
}

/**
 * Deploys the array of enterprise services provided. If a enterprise service has the value of delete set to true, that enterprise service
 * will be deleted based on the enterprise service's ifaceName property.
 *
 * @param {EnterpriseService[]} enterpriseServices a JSON array of enterprise services to be added, updated or deleted.
 */
function deployEnterpriseServices(enterpriseServices) {
    if (!enterpriseServices || !Array.isArray(enterpriseServices)) {
        throw new Error(
            'The enterpriseServices parameter is required and must be an array of external system objects.'
        );
    }

    enterpriseServices.forEach(function (enterpriseService) {
        if (
            typeof enterpriseService.delete !== 'undefined' &&
            enterpriseService.delete == true
        ) {
            deleteEnterpriseService(enterpriseService);
        } else {
            addOrUpdateEnterpriseService(enterpriseService);
        }
    });
}

/**
 * Adds a enterprise service if it does not exist or updates it to match the described state if the enterprise service exists.
 * @param {EnterpriseService} enterpriseService single enterprise service that will be added/updated
 */
function addOrUpdateEnterpriseService(enterpriseService) {
    logger.debug(
        'Setting up the ' + enterpriseService.ifaceName + ' enterprise service.'
    );
    var maxIfaceInSet;
    try {
        maxIfaceInSet = MXServer.getMXServer().getMboSet(
            'MAXIFACEIN',
            MXServer.getMXServer().getSystemUserInfo()
        );
        var entService = new EnterpriseService(enterpriseService);
        var sqlf = new SqlFormat('ifacename = :1');
        sqlf.setObject(
            1,
            'MAXIFACEIN',
            'IFACENAME',
            enterpriseService.ifaceName
        );
        maxIfaceInSet.setWhere(sqlf.format());

        if (!maxIfaceInSet.isEmpty()) {
            try {
                var maxIfaceProcSet = MXServer.getMXServer().getMboSet(
                    'MAXIFACEPROC',
                    MXServer.getMXServer().getSystemUserInfo()
                );
                maxIfaceProcSet.setWhere(sqlf.format());
                maxIfaceProcSet.deleteAll();
                maxIfaceProcSet.save();
            } finally {
                __libraryClose(maxIfaceProcSet);
            }

            maxIfaceInSet.deleteAll();
            maxIfaceInSet.save();
        }
        entService.setMboValues(maxIfaceInSet.add());
        maxIfaceInSet.save();
    } finally {
        __libraryClose(maxIfaceInSet);
    }
    logger.debug(
        'Setup up the ' + enterpriseService.ifaceName + ' enterprise service.'
    );
}

/**
 * Removes the provided enterprise service by matching the ifaceName property.
 * @param {EnterpriseService} enterpriseService single enterprise service that will be deleted.
 */
function deleteEnterpriseService(enterpriseService) {
    logger.debug(
        'Deleting the ' + enterpriseService.ifaceName + ' enterprise service.'
    );
    var maxIfaceInSet;
    try {
        maxIfaceInSet = MXServer.getMXServer().getMboSet(
            'MAXIFACEIN',
            MXServer.getMXServer().getSystemUserInfo()
        );
        var sqlf = new SqlFormat('ifacename = :1');
        sqlf.setObject(
            1,
            'MAXIFACEIN',
            'IFACENAME',
            enterpriseService.ifaceName
        );
        maxIfaceInSet.setWhere(sqlf.format());

        if (!maxIfaceInSet.isEmpty()) {
            try {
                var maxIfaceProcSet = MXServer.getMXServer().getMboSet(
                    'MAXIFACEPROC',
                    MXServer.getMXServer().getSystemUserInfo()
                );
                maxIfaceProcSet.setWhere(sqlf.format());
                maxIfaceProcSet.deleteAll();
                maxIfaceProcSet.save();
            } finally {
                __libraryClose(maxIfaceProcSet);
            }

            maxIfaceInSet.deleteAll();
            maxIfaceInSet.save();
        }
    } finally {
        __libraryClose(maxIfaceInSet);
    }
    logger.debug(
        'Deleted the ' + enterpriseService.ifaceName + ' enterprise service.'
    );
}

/**
 * Deploys the array of publish channels provided. If a publish channel has the value of delete set to true, that publish channel
 * will be deleted based on the publish channel's ifaceName property.
 *
 * @param {PublishChannel[]} publishChannels a JSON array of publish channels to be added, updated or deleted.
 */
function deployPublishChannels(publishChannels) {
    if (!publishChannels || !Array.isArray(publishChannels)) {
        throw new Error(
            'The publishChannels parameter is required and must be an array of external system objects.'
        );
    }

    publishChannels.forEach(function (publishChannel) {
        if (
            typeof publishChannel.delete !== 'undefined' &&
            publishChannel.delete == true
        ) {
            deletePublishChannel(publishChannel);
        } else {
            addOrUpdatePublishChannel(publishChannel);
        }
    });
}

/**
 * Adds a publish channel if it does not exist or updates it to match the described state if the publish channel exists.
 * @param {PublishChannel} publishChannel single publish channel that will be added/updated
 */
function addOrUpdatePublishChannel(publishChannel) {
    logger.debug(
        'Setting up the ' + publishChannel.ifaceName + ' publish channel.'
    );
    var maxIfaceOutSet;
    try {
        maxIfaceOutSet = MXServer.getMXServer().getMboSet(
            'MAXIFACEOUT',
            MXServer.getMXServer().getSystemUserInfo()
        );
        var pubChannel = new PublishChannel(publishChannel);
        var sqlf = new SqlFormat('ifacename = :1');
        sqlf.setObject(1, 'MAXIFACEOUT', 'IFACENAME', publishChannel.ifaceName);
        maxIfaceOutSet.setWhere(sqlf.format());

        if (!maxIfaceOutSet.isEmpty()) {
            //var maxIfaceOutMbo = maxIfaceOutSet.moveFirst();
            //var maxIfaceProcSet = maxIfaceOutMbo.getMboSet('MAXIFACEPROC');

            try {
                var maxIfaceProcSet = MXServer.getMXServer().getMboSet(
                    'MAXIFACEPROC',
                    MXServer.getMXServer().getSystemUserInfo()
                );
                maxIfaceProcSet.setWhere(sqlf.format());
                maxIfaceProcSet.deleteAll();
                maxIfaceProcSet.save();
            } finally {
                __libraryClose(maxIfaceProcSet);
            }

            maxIfaceOutSet.deleteAll();
            maxIfaceOutSet.save();
        }
        pubChannel.setMboValues(maxIfaceOutSet.add());
        maxIfaceOutSet.save();
    } finally {
        __libraryClose(maxIfaceOutSet);
    }
    logger.debug(
        'Setup up the ' + publishChannel.ifaceName + ' publish channel.'
    );
}

/**
 * Removes the provided publish channel by matching the ifaceName property.
 * @param {PublishChannel} publishChannel single publish channel that will be deleted.
 */
function deletePublishChannel(publishChannel) {
    logger.debug(
        'Deleting the ' + publishChannel.ifaceName + ' publish channel.'
    );
    var maxIfaceOutSet;
    try {
        maxIfaceOutSet = MXServer.getMXServer().getMboSet(
            'MAXIFACEOUT',
            MXServer.getMXServer().getSystemUserInfo()
        );
        var pubChannel = new PublishChannel(publishChannel);
        var sqlf = new SqlFormat('ifacename = :1');
        sqlf.setObject(1, 'MAXIFACEOUT', 'IFACENAME', publishChannel.ifaceName);
        maxIfaceOutSet.setWhere(sqlf.format());

        if (!maxIfaceOutSet.isEmpty()) {
            try {
                var maxIfaceProcSet = MXServer.getMXServer().getMboSet(
                    'MAXIFACEPROC',
                    MXServer.getMXServer().getSystemUserInfo()
                );
                maxIfaceProcSet.setWhere(sqlf.format());
                maxIfaceProcSet.deleteAll();
                maxIfaceProcSet.save();
            } finally {
                __libraryClose(maxIfaceProcSet);
            }

            maxIfaceOutSet.deleteAll();
            maxIfaceOutSet.save();
        }
    } finally {
        __libraryClose(maxIfaceOutSet);
    }
    logger.debug(
        'Deleted the ' + publishChannel.ifaceName + ' publish channel.'
    );
}

function deployLoggers(loggers) {
    if (!loggers || !Array.isArray(loggers)) {
        throw new Error(
            'The loggers parameter is required and must be an array of MaxLogger objects.'
        );
    }

    loggers.forEach(function (logger) {
        if (typeof logger.delete !== 'undefined' && logger.delete == true) {
            deleteLogger(logger);
        } else {
            addOrUpdateLogger(logger);
        }
    });
}

function addOrUpdateLogger(logger) {
    var set;

    try {
        var loggerObj = new MaxLogger(logger);
        set = MXServer.getMXServer().getMboSet('MAXLOGGER', userInfo);
        loggerObj.apply(set);
    } finally {
        __libraryClose(set);
    }
}

function deleteLogger(logger) {
    var set;

    try {
        var loggerObj = new MaxLogger(logger);

        set = MXServer.getMXServer().getMboSet('MAXLOGGER', userInfo);
        var sqlFormat = new SqlFormat('logger = :1');
        sqlFormat.setObject(1, 'MAXLOGGER', 'LOGGER', loggerObj.logger);
        set.setWhere(sqlFormat.format());
        var obj = set.moveFirst();
        if (obj) {
            obj.setValue('ACTIVE', false);
            obj.delete();
            set.save();
        }
    } finally {
        __libraryClose(set);
    }
}

function deployCronTasks(cronTasks) {
    if (!cronTasks || !Array.isArray(cronTasks)) {
        throw new Error(
            'The cronTasks parameter is required and must be an array of CronTask objects.'
        );
    }

    cronTasks.forEach(function (cronTask) {
        if (typeof cronTask.delete !== 'undefined' && cronTask.delete == true) {
            deleteCronTask(cronTask);
        } else {
            addOrUpdateCronTask(cronTask);
        }
    });
}

function deleteCronTask(cronTask) {
    var set;

    try {
        var cronTaskObj = new CronTask(cronTask);

        set = MXServer.getMXServer().getMboSet('CRONTASKDEF', userInfo);
        var sqlFormat = new SqlFormat('crontaskname = :1');
        sqlFormat.setObject(
            1,
            'CRONTASKDEF',
            'CRONTASKNAME',
            cronTaskObj.cronTaskName
        );
        set.setWhere(sqlFormat.format());
        var obj = set.moveFirst();
        if (obj) {
            var cronTaskInstanceSet = obj.getMboSet('CRONTASKINSTANCE');
            var cronTaskInstance = cronTaskInstanceSet.moveFirst();

            while (cronTaskInstance) {
                cronTaskInstance.setValue('ACTIVE', false);
                cronTaskInstance = cronTaskInstanceSet.moveNext();
            }

            cronTaskInstanceSet.deleteAll();

            // set access to full to ensure we can delete the cron task.
            obj.setValue('ACCESSLEVEL', 'FULL', MboConstants.NOACCESSCHECK);
            set.save();
            set.setWhere(sqlFormat.format());
            set.reset();
            set.deleteAll();
            set.save();
        }
    } finally {
        __libraryClose(set);
    }
}

function addOrUpdateCronTask(cronTask) {
    var set;

    try {
        var cronTaskObj = new CronTask(cronTask);
        set = MXServer.getMXServer().getMboSet('CRONTASKDEF', userInfo);
        var sqlFormat = new SqlFormat('crontaskname = :1');
        sqlFormat.setObject(
            1,
            'CRONTASKDEF',
            'CRONTASKNAME',
            cronTask.cronTaskName
        );

        var obj;
        set.setWhere(sqlFormat.format());
        obj = set.moveFirst();

        if (obj) {
            var cronTaskInstanceSet = obj.getMboSet('CRONTASKINSTANCE');
            var cronTaskInstance = cronTaskInstanceSet.moveFirst();

            while (cronTaskInstance) {
                cronTaskInstance.setValue('ACTIVE', false);
                cronTaskInstance = cronTaskInstanceSet.moveNext();
            }
            cronTaskInstanceSet.deleteAll();
            obj.setValue('ACCESSLEVEL', 'FULL', MboConstants.NOACCESSCHECK);
            set.save();
            set.setWhere(sqlFormat.format());
            set.reset();
            set.deleteAll();
            set.save();
            set.reset();
        }

        obj = set.add();
        cronTaskObj.setMboValues(obj);

        set.save();
    } finally {
        __libraryClose(set);
    }
}

/**
 * Deploys the array of end points provided. If an end point has the value of delete set to true, that end point
 * will be deleted based on the end point's endPointName.
 *
 * @param {EndPoint[]} endPoints a JSON array of end points to be added, updated or deleted.
 */
function deployEndPoints(endPoints) {
    if (!endPoints || !Array.isArray(endPoints)) {
        throw new Error(
            'The endPoints parameter is required and must be an array of external system objects.'
        );
    }

    endPoints.forEach(function (endPoint) {
        if (typeof endPoint.delete !== 'undefined' && endPoint.delete == true) {
            deleteEndPoint(endPoint);
        } else {
            addOrUpdateEndPoint(endPoint);
        }
    });
}

/**
 * Adds an end point if it does not exist or updates it to match the described state if the end point exists.
 * @param {EndPoint} endPoint single end point that will be added/updated
 */
function addOrUpdateEndPoint(endPoint) {
    logger.debug('Setting up the ' + endPoint.endPointName + ' end point.');
    var maxEndPointSet;
    try {
        maxEndPointSet = MXServer.getMXServer().getMboSet(
            'MAXENDPOINT',
            MXServer.getMXServer().getSystemUserInfo()
        );
        var endPnt = new EndPoint(endPoint);
        var sqlf = new SqlFormat('endpointname = :1');
        sqlf.setObject(1, 'MAXENDPOINT', 'ENDPOINTNAME', endPoint.endPointName);
        maxEndPointSet.setWhere(sqlf.format());

        if (!maxEndPointSet.isEmpty()) {
            maxEndPointSet.deleteAll();
            maxEndPointSet.save();
        }
        endPnt.setMboValues(maxEndPointSet.add());
        maxEndPointSet.save();
    } finally {
        __libraryClose(maxEndPointSet);
    }
    logger.debug('Setup up the ' + endPoint.endPointName + ' end point.');
}

/**
 * Removes the provided end point by matching the endPointName property.
 * @param {EndPoint} endPoint single end point that will be deleted.
 */
function deleteEndPoint(endPoint) {
    logger.debug('Deleting the ' + endPoint.endPointName + ' end point.');
    var maxEndPointSet;
    try {
        maxEndPointSet = MXServer.getMXServer().getMboSet(
            'MAXENDPOINT',
            MXServer.getMXServer().getSystemUserInfo()
        );
        var endPnt = new EndPoint(endPoint);
        var sqlf = new SqlFormat('endpointname = :1');
        sqlf.setObject(1, 'MAXENDPOINT', 'ENDPOINTNAME', endPoint.endPointName);
        maxEndPointSet.setWhere(sqlf.format());

        if (!maxEndPointSet.isEmpty()) {
            maxEndPointSet.deleteAll();
            maxEndPointSet.save();
        }
    } finally {
        __libraryClose(maxEndPointSet);
    }
    logger.debug('Deleted the ' + endPoint.endPointName + ' end point.');
}

/**
 * Deploys the array of external systems provided. If an external system has the value of delete set to true, that external system
 * will be deleted based on the external system's extSysName.
 *
 * @param {ExternalSystem[]} externalSystems a JSON array of external systems to be added, updated or deleted.
 */
function deployExternalSystems(externalSystems) {
    if (!externalSystems || !Array.isArray(externalSystems)) {
        throw new Error(
            'The externalSystems parameter is required and must be an array of external system objects.'
        );
    }

    externalSystems.forEach(function (externalSystem) {
        if (
            typeof externalSystem.delete !== 'undefined' &&
            externalSystem.delete == true
        ) {
            deleteExternalSystem(externalSystem);
        } else {
            addOrUpdateExternalSystem(externalSystem);
        }
    });
}

/**
 * Adds an external system if it does not exist or updates it to match the described state if the external system exists.
 * @param {ExternalSystem} externalSystem single external system that will be added/updated
 */
function addOrUpdateExternalSystem(externalSystem) {
    logger.debug(
        'Setting up the ' + externalSystem.extSysName + ' external sytsem.'
    );
    var maxExtSystemSet;
    try {
        maxExtSystemSet = MXServer.getMXServer().getMboSet(
            'MAXEXTSYSTEM',
            MXServer.getMXServer().getSystemUserInfo()
        );
        var extSys = new ExternalSystem(externalSystem);
        var sqlf = new SqlFormat('extsysname = :1');
        sqlf.setObject(
            1,
            'MAXEXTSYSTEM',
            'EXTSYSNAME',
            externalSystem.extSysName
        );
        maxExtSystemSet.setWhere(sqlf.format());

        if (!maxExtSystemSet.isEmpty()) {
            maxExtSystemSet.deleteAll();
            maxExtSystemSet.save();
        }
        extSys.setMboValues(maxExtSystemSet.add());
        maxExtSystemSet.save();
    } finally {
        __libraryClose(maxExtSystemSet);
    }
    logger.debug(
        'Setup up the ' + externalSystem.extSysName + ' external sytsem.'
    );
}

/**
 * Removes the provided external system by matching the extSysName properties.
 * @param {ExternalSystem} externalSystem single external system that will be deleted.
 */
function deleteExternalSystem(externalSystem) {
    logger.debug(
        'Deleting the ' + externalSystem.extSysName + ' external sytsem.'
    );
    var maxExtSystemSet;
    try {
        maxExtSystemSet = MXServer.getMXServer().getMboSet(
            'MAXEXTSYSTEM',
            MXServer.getMXServer().getSystemUserInfo()
        );
        var extSys = new ExternalSystem(externalSystem);
        var sqlf = new SqlFormat('extsysname = :1');
        sqlf.setObject(
            1,
            'MAXEXTSYSTEM',
            'EXTSYSNAME',
            externalSystem.extSysName
        );
        maxExtSystemSet.setWhere(sqlf.format());

        if (!maxExtSystemSet.isEmpty()) {
            var maxExtSystem = maxExtSystemSet.moveFirst();
            maxExtSystem.setValue('ENABLED', false);
            maxExtSystemSet.deleteAll();
            maxExtSystemSet.save();
        }
    } finally {
        __libraryClose(maxExtSystemSet);
    }
    logger.debug('Deleted the ' + this.extSysName + ' external sytsem.');
}

function deployIntegrationObjects(integrationObjects) {
    if (!integrationObjects || !Array.isArray(integrationObjects)) {
        throw new Error(
            'The integrationObjects parameter is required and must be an array of integration object objects.'
        );
    }

    logger.debug(
        'Integration Objects: \n' + JSON.stringify(integrationObjects, null, 4)
    );

    integrationObjects.forEach(function (integrationObject) {
        if (
            typeof integrationObject.delete !== 'undefined' &&
            integrationObject.delete == true
        ) {
            deleteIntegrationObject(integrationObject);
        } else {
            addOrUpdateIntegrationObject(integrationObject);
        }
    });
}

function deleteIntegrationObject(integrationObject) {
    var set;

    try {
        var intObj = new IntegrationObject(integrationObject);

        set = MXServer.getMXServer().getMboSet('MAXINTOBJECT', userInfo);
        var sqlFormat = new SqlFormat('intobjectname = :1');
        sqlFormat.setObject(
            1,
            'MAXINTOBJECT',
            'INTOBJECTNAME',
            intObj.intObjectName
        );
        set.setWhere(sqlFormat.format());
        var obj = set.moveFirst();

        if (obj) {
            // manually delete the olscquery and querytemplate objects because they are not automatically removed.
            obj.getMboSet('OSLCQUERY').deleteAll();
            obj.getMboSet('QUERYTEMPLATE').deleteAll();
            obj.delete();
            set.save();
        }
    } finally {
        __libraryClose(set);
    }
}

function addOrUpdateIntegrationObject(integrationObject) {
    var set;

    try {
        var intObj = new IntegrationObject(integrationObject);

        set = MXServer.getMXServer().getMboSet('MAXINTOBJECT', userInfo);
        var sqlFormat = new SqlFormat('intobjectname = :1');
        sqlFormat.setObject(
            1,
            'MAXINTOBJECT',
            'INTOBJECTNAME',
            intObj.intObjectName
        );

        set.setWhere(sqlFormat.format());
        var obj = set.moveFirst();

        var existingGroups = [];

        if (obj) {
            // if the current object has os security then we need to remove the groups from that first then put it back.
            if (obj.getBoolean('USEOSSECURITY')) {
                var applicationAuthSet;

                try {
                    applicationAuthSet = MXServer.getMXServer().getMboSet(
                        'APPLICATIONAUTH',
                        userInfo
                    );

                    sqlFormat = new SqlFormat(obj, 'app = :intobjectname');
                    applicationAuthSet.setWhere(sqlFormat.format());
                    applicationAuthSet.setOrderBy('groupname');
                    applicationAuth = applicationAuthSet.moveFirst();

                    var group = { groupName: '', options: [] };
                    while (applicationAuth) {
                        if (
                            group.groupName !==
                            applicationAuth.getString('GROUPNAME')
                        ) {
                            if (group.options.length > 0) {
                                existingGroups.push(group);
                            }
                            group = {
                                groupName:
                                    applicationAuth.getString('GROUPNAME'),
                                options: [],
                            };
                        }
                        group.options.push(
                            applicationAuth.getString('OPTIONNAME')
                        );
                        applicationAuth.delete();
                        applicationAuth = applicationAuthSet.moveNext();
                    }
                    // push the final group.
                    if (group.options.length > 0) {
                        existingGroups.push(group);
                    }
                    applicationAuthSet.save();
                } finally {
                    if (applicationAuthSet) {
                        try {
                            applicationAuthSet.close();
                            applicationAuthSet.cleanup();
                        } catch (ignore) {
                            /* empty */
                        }
                    }
                }

                set.reset();
                obj = set.getMboForUniqueId(obj.getUniqueIDValue());
            }
            // manually delete the olscquery and querytemplate objects because they are not automatically removed.
            obj.getMboSet('OSLCQUERY').deleteAll();
            obj.getMboSet('QUERYTEMPLATE').deleteAll();
            obj.delete();
            set.save();
            set.reset();
        }
        obj = set.add();

        var id = obj.getUniqueIDValue();

        intObj.setMboValues(obj);

        set.save();

        if (intObj.useOSSecurity && existingGroups.length > 0) {
            obj = set.getMboForUniqueId(id);

            var options = [];

            var sigOptionSet = obj.getMboSet(
                '$sigoptions',
                'SIGOPTION',
                'app = :intobjectname'
            );
            var sigOption = sigOptionSet.moveFirst();

            while (sigOption) {
                options.push(sigOption.getString('OPTIONNAME'));
                sigOption = sigOptionSet.moveNext();
            }

            existingGroups.forEach(function (group) {
                var applicationAuthSet;
                try {
                    applicationAuthSet = MXServer.getMXServer().getMboSet(
                        'APPLICATIONAUTH',
                        userInfo
                    );
                    group.options.forEach(function (option) {
                        if (options.indexOf(option) >= 0) {
                            var applicationAuth = applicationAuthSet.add();
                            applicationAuth.setValue(
                                'GROUPNAME',
                                group.groupName
                            );
                            applicationAuth.setValue(
                                'APP',
                                intObj.intObjectName,
                                MboConstants.NOVALIDATION
                            );
                            applicationAuth.setValue('OPTIONNAME', option);
                        }
                    });
                    applicationAuthSet.save();
                } finally {
                    try {
                        if (applicationAuthSet) {
                            applicationAuthSet.close();
                            applicationAuthSet.cleanup();
                        }
                    } catch (ignore) {
                        /* empty */
                    }
                }
            });
        }
    } finally {
        __libraryClose(set);
    }
}

/**
 * Deploys the array of messages provided. If a message has the property of delete set to true, that message
 * will be deleted based on the message's msgId or msgGroup and msgKey.
 *
 * @param {*} messages A JSON array of messages to be added, updated or deleted
 */
function deployMessages(messages) {
    if (!messages || !Array.isArray(messages)) {
        throw new Error(
            'The messages parameter is required and must be an array of message objects.'
        );
    }

    logger.debug('Deploying Messages: \n' + JSON.stringify(messages, null, 4));

    messages.forEach(function (message) {
        if (typeof message.delete !== 'undefined' && message.delete == true) {
            deleteMessage(message);
        } else {
            addOrUpdateMessage(message);
        }
    });
}

/**
 * Adds a message if it does not exist or updates it to match the described state if the message exists.
 * @param {Message} message single message that will be added/updated
 */
function addOrUpdateMessage(message) {
    logger.debug('addUpdateMessage function called');

    var maxMessageSet;
    try {
        maxMessageSet = MXServer.getMXServer().getMboSet(
            'MAXMESSAGES',
            MXServer.getMXServer().getSystemUserInfo()
        );
        var msg = new Message(message);

        var sqlf = new SqlFormat('msggroup = :1 and msgkey = :2');
        sqlf.setObject(1, 'MAXMESSAGES', 'MSGGROUP', msg.msgGroup);
        sqlf.setObject(2, 'MAXMESSAGES', 'MSGKEY', msg.msgKey);

        maxMessageSet.setWhere(sqlf.format());

        // remove the current message if it exists
        if (!maxMessageSet.isEmpty()) {
            maxMessageSet.getMbo(0).delete();
            maxMessageSet.save();
            maxMessageSet.reset();
        }

        msg.setMboValues(maxMessageSet.add());

        maxMessageSet.save();
    } finally {
        __libraryClose(maxMessageSet);
    }

    logger.debug('addUpdateMessage function end');
}

/**
 * Removes the provided message by matching the msgGroup and msgKey properties.
 *
 * @param {Message} message single message that will be deleted.
 */
function deleteMessage(message) {
    if (!message) {
        throw new Error(
            'The message parameter is required for the removeMessage function.'
        );
    }

    var messageObj = new Message(message);

    var sqlf = new SqlFormat('msggroup = :1 and msgkey = :2');
    sqlf.setObject(1, 'MAXMESSAGES', 'MSGGROUP', messageObj.msgGroup);
    sqlf.setObject(2, 'MAXMESSAGES', 'MSGKEY', messageObj.msgKey);

    var messageSet;
    try {
        messageSet = MXServer.getMXServer().getMboSet(
            'MAXMESSAGES',
            MXServer.getMXServer().getSystemUserInfo()
        );

        messageSet.setWhere(sqlf.format());

        messageSet.deleteAll();

        messageSet.save();
    } finally {
        __libraryClose(messageSet);
    }
}

/**
 * Deploys the array of properties provided. If a property has the value of delete set to true, that property
 * will be deleted based on the property's propName.
 *
 * @param {Property[]} properties a JSON array of properties to be added, updated or deleted.
 */
function deployProperties(properties) {
    if (!properties || !Array.isArray(properties)) {
        throw new Error(
            'The properties parameter is required and must be an array of property objects.'
        );
    }

    properties.forEach(function (property) {
        if (typeof property.delete !== 'undefined' && property.delete == true) {
            deleteProperty(property);
        } else {
            addOrUpdateProperty(property);
        }
    });
}

/**
 * Adds a property if it does not exist or updates it to match the described state if the property exists.
 *
 * @param {Property} property single property that will be added or updated if it already exists.
 */
function addOrUpdateProperty(property) {
    var maxPropertySet;
    try {
        var propertyObj = new Property(property);

        maxPropertySet = MXServer.getMXServer().getMboSet(
            'MAXPROP',
            MXServer.getMXServer().getSystemUserInfo()
        );

        var sqlf = new SqlFormat('propname = :1');
        sqlf.setObject(1, 'MAXPROP', 'PROPNAME', propertyObj.propName);
        maxPropertySet.setWhere(sqlf.format());

        var maxProperty = maxPropertySet.moveFirst();
        if (!maxProperty) {
            maxProperty = maxPropertySet.add();
        }

        propertyObj.setMboValues(maxProperty);

        maxPropertySet.save();
        maxProperty.select();
        if (maxProperty.getBoolean('LIVEREFRESH')) {
            // refresh the properties so the current value is available.
            MXServer.getMXServer().reloadMaximoCache(
                'MAXPROP',
                propertyObj.propName,
                true
            );
        }
    } finally {
        __libraryClose(maxPropertySet);
    }
}

/**
 * Removes the provided property by matching the propName property.
 * @param {*} property single property that will be deleted
 */
function deleteProperty(property) {
    logger.debug(
        'deleteProperty function called, passed property ' +
            property +
            ' argument'
    );

    if (!property) {
        throw new Error(
            'The property parameter is required for the deleteProperty function.'
        );
    }

    var maxPropSet;
    try {
        maxPropSet = MXServer.getMXServer().getMboSet(
            'MAXPROP',
            MXServer.getMXServer().getSystemUserInfo()
        );
        var sqlf = new SqlFormat('propname = :1');
        sqlf.setObject(1, 'MAXPROP', 'PROPNAME', property.propName);
        maxPropSet.setWhere(sqlf.format());

        if (!maxPropSet.isEmpty()) {
            //property exists, delete
            logger.debug(
                'Property ' +
                    property.propName +
                    ' exists. Deleting the property.'
            );
            maxPropSet.deleteAll();
        } else {
            //property does not exist
            logger.debug(
                'Property ' +
                    property.propName +
                    ' does not exist. Taking no action.'
            );
        }

        maxPropSet.save();
    } finally {
        __libraryClose(maxPropSet);
    }
    logger.debug('removeProperty function end');
}

function deployDomains(domains) {
    if (!domains || !Array.isArray(domains)) {
        throw new Error(
            'The domains parameter is required and must be an array of Domain objects.'
        );
    }

    domains.forEach(function (domain) {
        if (typeof domain.delete !== 'undefined' && domain.delete == true) {
            deleteDomain(domain);
        } else {
            addOrUpdateDomain(domain);
        }
    });
}

function deleteDomain(domain) {
    if (domain.domainType != 'SYNONYM') {
        var set;
        try {
            var domainObj = new Domain(domain);

            set = MXServer.getMXServer().getMboSet('MAXDOMAIN', userInfo);
            var sqlFormat = new SqlFormat('domainid = :1');
            sqlFormat.setObject(1, 'MAXDOMAIN', 'DOMAINID', domainObj.domainId);
            set.setWhere(sqlFormat.format());
            set.deleteAll();
            set.save();
        } finally {
            __libraryClose(set);
        }
    } else {
        throw new Error('Cannot delete a synonym domain.');
    }
}

function addOrUpdateDomain(domain) {
    var set;
    try {
        var domainObj = new Domain(domain);
        set = MXServer.getMXServer().getMboSet('MAXDOMAIN', userInfo);
        var sqlFormat = new SqlFormat('domainid = :1');
        sqlFormat.setObject(1, 'MAXDOMAIN', 'DOMAINID', domainObj.domainId);
        set.setWhere(sqlFormat.format());

        var obj = set.moveFirst();
        if (!obj) {
            obj = set.add();
        }
        domainObj.setMboValues(obj);
        set.save();
    } catch (e) {
        e.printStackTrace();
        logger.error('Error adding/updating domain: ' + e);
        throw e;
    } finally {
        __libraryClose(set);
    }
}

/**
 * Adds or updates a logger. This relies on the calling function calling save on the provided parent MboSet to save the changes.
 *
 * @param {*} loggerName The logger to add.
 * @param {*} level The log level to set the logger at.
 * @param {*} parent The parent logger to add the child logger to.
 */
function __addLoggerIfDoesNotExist(loggerName, level, parent) {
    logger.debug(
        'Adding or updating the logger ' +
            loggerName +
            ' and setting the level to ' +
            level +
            '.'
    );
    var loggerSet;
    try {
        loggerSet = MXServer.getMXServer().getMboSet(
            'MAXLOGGER',
            MXServer.getMXServer().getSystemUserInfo()
        );

        // Query for the log key
        var sqlFormat = new SqlFormat('logkey = :1');
        sqlFormat.setObject(
            1,
            'MAXLOGGER',
            'LOGKEY',
            parent.getString('LOGKEY') + '.' + loggerName
        );

        loggerSet.setWhere(sqlFormat.format());
        var child;
        // if the logkey does not exist create it, otherwise get the existing logger and update its level.
        if (loggerSet.isEmpty()) {
            child = parent.getMboSet('CHILDLOGGERS').add();
            child.setValue('LOGGER', loggerName);
            child.setValue('LOGLEVEL', level);
            logger.debug(
                'Added the logger ' +
                    loggerName +
                    ' and set the level to ' +
                    level +
                    '.'
            );
        }
    } finally {
        __libraryClose(loggerSet);
    }
}

/**
 * Add a menu item to the provided app.
 *
 * @param {String} app The application to add the menu item to.
 * @param {String} optionName The option that the menu to should be added for.
 * @param {String} below The option name for the menu that the new option will be added below.
 * @param {boolean} visible Indicates if the menu option is visible.
 * @param {String} tabDisplay The tabs tha the menu should be displays on.
 */
function __addMenu(app, optionName, below, visible, tabDisplay) {
    var maxMenuSet;
    var maxMenu;
    try {
        maxMenuSet = MXServer.getMXServer().getMboSet(
            'MAXMENU',
            MXServer.getMXServer().getSystemUserInfo()
        );

        var position = 0;
        var subPosition = 0;
        if (below) {
            var sqlf = new SqlFormat(
                'moduleapp = :1 and elementtype = :2 and keyvalue = :3'
            );
            sqlf.setObject(1, 'MAXMENU', 'MODULEAPP', app);
            sqlf.setObject(2, 'MAXMENU', 'ELEMENTTYPE', 'OPTION');
            sqlf.setObject(3, 'MAXMENU', 'KEYVALUE', below);

            maxMenuSet.setWhere(sqlf.format());
            maxMenu = maxMenuSet.moveFirst();

            if (maxMenu) {
                if (!maxMenu.isNull('SUBPOSITION')) {
                    position = maxMenu.getInt('POSITION');
                    subPosition = maxMenu.getInt('SUBPOSITION') + 1;
                } else {
                    position = maxMenu.getInt('POSITION') + 1;
                }
            }
        }

        if (position == 0) {
            sqlf = new SqlFormat('moduleapp = :1 and elementtype = :2');
            sqlf.setObject(1, 'MAXMENU', 'MODULEAPP', app);
            sqlf.setObject(2, 'MAXMENU', 'ELEMENTTYPE', 'OPTION');

            maxMenuSet.setWhere(sqlf.format());
            maxMenuSet.setOrderBy('position desc');
            maxMenuSet.reset();
            maxMenu = maxMenuSet.moveFirst();
            position = maxMenu.getInt('POSITION') + 1;
        }

        sqlf = new SqlFormat(
            'moduleapp = :1 and elementtype = :2 and keyvalue = :3'
        );
        sqlf.setObject(1, 'MAXMENU', 'MODULEAPP', app);
        sqlf.setObject(2, 'MAXMENU', 'ELEMENTTYPE', 'OPTION');
        sqlf.setObject(3, 'MAXMENU', 'KEYVALUE', optionName);

        maxMenuSet.setWhere(sqlf.format());
        maxMenuSet.reset();

        if (maxMenuSet.isEmpty()) {
            maxMenu = maxMenuSet.add();
            maxMenu.setValue('MENUTYPE', 'APPMENU');
            maxMenu.setValue('MODULEAPP', app);
            maxMenu.setValue('POSITION', position);
            maxMenu.setValue('SUBPOSITION', subPosition);
            maxMenu.setValue('ELEMENTTYPE', 'OPTION');
            maxMenu.setValue('KEYVALUE', optionName);
        } else {
            maxMenu = maxMenuSet.moveFirst();
        }
        maxMenu.setValue('VISIBLE', visible);
        maxMenu.setValue('TABDISPLAY', tabDisplay);

        maxMenuSet.save();
    } finally {
        __libraryClose(maxMenuSet);
    }
}

/**
 * Adds a signature option to the application.
 * @param {String} app The application that the signature options should be added to.
 * @param {String} optionName The signature option name.
 * @param {String} description The description for the signature option.
 * @param {boolean} esigEnabled Indicates that e-signature is enabled.
 * @param {boolean} visible Indicates if the option is visible.
 * @param {String} alsogrants Other options that this option grants.
 * @param {boolean} uiOnly Should the UI be required.
 */
function __addAppOption(
    app,
    optionName,
    description,
    esigEnabled,
    visible,
    alsogrants,
    uiOnly
) {
    var sigOptionSet;

    try {
        sigOptionSet = MXServer.getMXServer().getMboSet(
            'SIGOPTION',
            MXServer.getMXServer().getSystemUserInfo()
        );
        var sqlf = new SqlFormat('app = :1 and optionname = :2');
        sqlf.setObject(1, 'SIGOPTION', 'APP', app);
        sqlf.setObject(2, 'SIGOPTION', 'OPTIONNAME', optionName);
        sigOptionSet.setWhere(sqlf.format());

        var sigOption = sigOptionSet.moveFirst();
        if (!sigOption) {
            sigOption = sigOptionSet.add();
            sigOption.setValue('APP', app);
            sigOption.setValue('OPTIONNAME', optionName);
        }

        sigOption.setValue('DESCRIPTION', description);
        sigOption.setValue('ESIGENABLED', esigEnabled);
        sigOption.setValue('VISIBLE', visible);
        sigOption.setValue('ALSOGRANTS', alsogrants);
        var sigOptFlagSet;

        if (uiOnly) {
            sigOptFlagSet = sigOption.getMboSet('SIGOPTFLAG');
            var sigOptFlag = sigOptFlagSet.moveFirst();
            if (!sigOptFlag) {
                sigOptFlag = sigOptFlagSet.add();
                sigOptFlag.setValue('APP', app);
                sigOptFlag.setValue('OPTIONNAME', optionName);
                sigOptFlag.setValue('FLAGNAME', 'WFACTION');
            }
        } else {
            sigOptFlag = sigOption.getMboSet('SIGOPTFLAG').moveFirst();
            if (sigOptFlag) {
                sigOptFlag.delete();
            }
        }

        sigOptionSet.save();
    } finally {
        __libraryClose(sigOptionSet);
    }
}

function __grantOptionToGroup(group, app, option) {
    var groupSet;
    try {
        var sqlf = new SqlFormat('groupname = :1');
        sqlf.setObject(1, 'MAXGROUP', 'GROUPNAME', group);

        groupSet = MXServer.getMXServer().getMboSet(
            'MAXGROUP',
            MXServer.getMXServer().getSystemUserInfo()
        );
        groupSet.setWhere(sqlf.format());
        var groupMbo;
        if (!groupSet.isEmpty()) {
            groupMbo = groupSet.moveFirst();
            applicationAuthSet = groupMbo.getMboSet('APPLICATIONAUTH');
            sqlf = new SqlFormat('app = :1 and optionname = :2');
            sqlf.setObject(1, 'APPLICATIONAUTH', 'APP', app);
            sqlf.setObject(2, 'APPLICATIONAUTH', 'OPTIONNAME', option);

            applicationAuthSet.setWhere(sqlf.format());
            if (applicationAuthSet.isEmpty()) {
                applicationAuth = applicationAuthSet.add();
                applicationAuth.setValue('APP', app, MboConstants.NOVALIDATION);
                applicationAuth.setValue('OPTIONNAME', option);

                groupSet.save();
            }
        }
    } finally {
        __libraryClose(groupSet);
    }
}

/**
 *
 * @param {String} name The name of the relationship
 * @param {String} parent The parent of the relationship (source)
 * @param {String} child The child of the relationship (target/destination)
 * @param {String} whereclause Where clause to be used by the relationship
 * @param {String} remarks Description of the relationship
 */
function addOrReplaceRelationship(name, parent, child, whereclause, remarks) {
    var maxRelationshipSet;
    try {
        maxRelationshipSet = MXServer.getMXServer().getMboSet(
            'MAXRELATIONSHIP',
            MXServer.getMXServer().getSystemUserInfo()
        );
        var sqlf = new SqlFormat('parent = :1 and child = :2 and name = :3');
        sqlf.setObject(1, 'MAXRELATIONSHIP', 'PARENT', parent);
        sqlf.setObject(2, 'MAXRELATIONSHIP', 'CHILD', child);
        sqlf.setObject(3, 'MAXRELATIONSHIP', 'NAME', name);
        maxRelationshipSet.setWhere(sqlf.format());

        if (maxRelationshipSet.isEmpty()) {
            var maxRelationship = maxRelationshipSet.add();
            maxRelationship.setValue('NAME', name);
            maxRelationship.setValue('PARENT', parent);
            maxRelationship.setValue('CHILD', child);
            maxRelationship.setValue('WHERECLAUSE', whereclause);
            maxRelationship.setValue('REMARKS', remarks);
        }
        maxRelationshipSet.save();
    } finally {
        __libraryClose(maxRelationshipSet);
    }
}

/**
 * Cleans up the MboSet connections and closes the set.
 * @param {psdi.mbo.MboSet} set the psdi.mbo.MboSet object to close.
 */
function __libraryClose(set) {
    if (set && set instanceof Java.type('psdi.mbo.MboSet')) {
        try {
            set.cleanup();
            set.close();
        } catch (ignored) {
            /* ignored */
        }
    }
}

var scriptConfig = {
    autoscript: 'SHARPTREE.AUTOSCRIPT.LIBRARY',
    description: 'Library Script',
    version: '1.0.0',
    active: true,
    logLevel: 'ERROR',
};
