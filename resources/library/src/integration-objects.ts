/// <reference path="../globals.d.ts" />
/// <reference path="../manage-facade.d.ts" />

import { applyValues, close, setValue, updateProgress, valueOrDefault } from './util';

var MXServer = Java.type('psdi.server.MXServer');
var SqlFormat = Java.type('psdi.mbo.SqlFormat');
var MboConstants = Java.type('psdi.mbo.MboConstants');

export type MaximoIntegrationObjectFieldType = 'EXCLUDE' | 'NONPERSISTENT';
export type MaximoOSLCActionImplementationType = 'script' | 'system' | 'workflow' | 'wsmethod';
export type MaximoOSLCQueryType = 'appclause' | 'method' | 'osclause' | 'script';

interface MaximoGroup {
    groupName: string;
    options: string[];
}

export function process(integrationObject: MaximoIntegrationObject): void {
    const maximo: psdi.server.MXServer = MXServer.getMXServer();
    let mboSet: psdi.mbo.MboSetRemote | null = null;
    try {
        mboSet = maximo.getMboSet('MAXINTOBJECT', maximo.getSystemUserInfo());

        if (integrationObject._delete) {
            updateProgress('Deleting integration object ' + integrationObject.intObjectName);
            deleteIntegrationObject(mboSet, integrationObject);
            updateProgress('Deleted integration object ' + integrationObject.intObjectName);
        } else {
            updateProgress('Adding/Updating integration object ' + integrationObject.intObjectName);
            addOrUpdateIntegrationObject(mboSet, integrationObject);
            updateProgress('Added/Updated integration object ' + integrationObject.intObjectName);
        }
    } finally {
        close(mboSet);
    }
}

function deleteIntegrationObject(mboSet: psdi.mbo.MboSetRemote, integrationObject: MaximoIntegrationObject): void {
    const mbo = findIntegrationObject(mboSet, integrationObject.intObjectName);
    if (!mbo) {
        return;
    }

    deleteNonCascadingChildren(mbo);
    mbo.delete();
    mboSet.save();
}

function addOrUpdateIntegrationObject(mboSet: psdi.mbo.MboSetRemote, integrationObject: MaximoIntegrationObject): void {
    let existing = findIntegrationObject(mboSet, integrationObject.intObjectName);
    const existingGroups: MaximoGroup[] = [];

    if (existing) {
        // if the current object has os security then we need to remove the groups from that first then put it back.
        if (existing.getBoolean('USEOSSECURITY')) {
            collectAndDeleteExistingSecurityGroups(integrationObject.intObjectName, existingGroups);
            mboSet.reset();
            existing = mboSet.getMboForUniqueId(existing.getUniqueIDValue());
        }

        deleteNonCascadingChildren(existing);
        existing.delete();
        mboSet.save();
        mboSet.reset();
    }

    const mbo = mboSet.add();
    const uniqueId = mbo.getUniqueIDValue();

    applyIntegrationObjectValues(mbo, integrationObject);
    mboSet.save();

    if (integrationObject.useOSSecurity && existingGroups.length > 0) {
        const savedMbo = mboSet.getMboForUniqueId(uniqueId);
        if (savedMbo) {
            restoreExistingSecurityGroups(savedMbo, integrationObject.intObjectName, existingGroups);
        }
    }
}

function findIntegrationObject(mboSet: psdi.mbo.MboSetRemote, intObjectName: string): psdi.mbo.MboRemote {
    const sqlf = new SqlFormat('intobjectname = :1');
    sqlf.setObject(1, 'MAXINTOBJECT', 'INTOBJECTNAME', intObjectName);
    mboSet.setWhere(sqlf.format());
    return mboSet.moveFirst();
}

function deleteNonCascadingChildren(mbo: psdi.mbo.MboRemote): void {
    // manually delete the olscquery and querytemplate objects because they are not automatically removed.
    mbo.getMboSet('OSLCQUERY').deleteAll();
    mbo.getMboSet('QUERYTEMPLATE').deleteAll();
}

function collectAndDeleteExistingSecurityGroups(intObjectName: string, existingGroups: MaximoGroup[]): void {
    const maximo: psdi.server.MXServer = MXServer.getMXServer();
    let applicationAuthSet: psdi.mbo.MboSetRemote | null = null;

    try {
        applicationAuthSet = maximo.getMboSet('APPLICATIONAUTH', maximo.getSystemUserInfo());
        const sqlf = new SqlFormat('app = :1');
        sqlf.setObject(1, 'APPLICATIONAUTH', 'APP', intObjectName);
        applicationAuthSet.setWhere(sqlf.format());
        applicationAuthSet.setOrderBy('groupname');

        let group: MaximoGroup = { groupName: '', options: [] };
        let applicationAuth = applicationAuthSet.moveFirst();

        while (applicationAuth) {
            if (group.groupName !== applicationAuth.getString('GROUPNAME')) {
                if (group.options.length > 0) {
                    existingGroups.push(group);
                }
                group = {
                    groupName: applicationAuth.getString('GROUPNAME'),
                    options: []
                };
            }

            group.options.push(applicationAuth.getString('OPTIONNAME'));
            applicationAuth.delete();
            applicationAuth = applicationAuthSet.moveNext();
        }

        // push the final group.
        if (group.options.length > 0) {
            existingGroups.push(group);
        }

        applicationAuthSet.save();
    } finally {
        close(applicationAuthSet);
    }
}

function restoreExistingSecurityGroups(mbo: psdi.mbo.MboRemote, intObjectName: string, existingGroups: MaximoGroup[]): void {
    const validOptions = collectSigOptionNames(mbo);
    const maximo: psdi.server.MXServer = MXServer.getMXServer();
    let applicationAuthSet: psdi.mbo.MboSetRemote | null = null;

    try {
        applicationAuthSet = maximo.getMboSet('APPLICATIONAUTH', maximo.getSystemUserInfo());

        existingGroups.forEach(function (group: MaximoGroup): void {
            group.options.forEach(function (option: string): void {
                if (validOptions.indexOf(option) === -1) {
                    return;
                }

                const applicationAuth = applicationAuthSet.add();
                setValue(applicationAuth, 'GROUPNAME', group.groupName);
                setValue(applicationAuth, 'APP', intObjectName, MboConstants.NOVALIDATION);
                setValue(applicationAuth, 'OPTIONNAME', option);
            });
        });

        applicationAuthSet.save();
    } finally {
        close(applicationAuthSet);
    }
}

function collectSigOptionNames(mbo: psdi.mbo.MboRemote): string[] {
    const sigOptionNames: string[] = [];
    const sigOptionSet = mbo.getMboSet('$sigoptions', 'SIGOPTION', 'app = :intobjectname');
    let sigOption = sigOptionSet.moveFirst();

    while (sigOption) {
        sigOptionNames.push(sigOption.getString('OPTIONNAME'));
        sigOption = sigOptionSet.moveNext();
    }

    return sigOptionNames;
}

function applyIntegrationObjectValues(mbo: psdi.mbo.MboRemote, integrationObject: MaximoIntegrationObject): void {
    if (mbo.toBeAdded()) {
        setValue(mbo, 'INTOBJECTNAME', integrationObject.intObjectName);
    }

    applyValues(mbo, [
        ['DESCRIPTION', integrationObject.description],
        ['USEWITH', integrationObject.useWith],
        ['QUERYONLY', integrationObject.queryOnly],
        ['FLATSUPPORTED', integrationObject.flatSupported],
        ['LOADQUERYFROMAPP', integrationObject.loadQueryFromApp],
        ['SELFREFERENCING', integrationObject.selfReferencing],
        ['DEFCLASS', integrationObject.defClass],
        ['PROCCLASS', integrationObject.procClass],
        ['SEARCHATTRS', integrationObject.searchAttrs],
        ['RESTRICTWHERE', integrationObject.restrictWhere],
        ['MODULE', integrationObject.module]
    ]);

    if (attributeExists('MAXINTOBJECT', 'AUTOPAGINGTHRESHOLD')) {
        setValue(mbo, 'AUTOPAGINGTHRESHOLD', integrationObject.autoPagingThreshold);
    }

    applyIntegrationObjectDetails(mbo, integrationObject);

    if (!integrationObject.useOSSecurity && integrationObject.authApp) {
        setValue(mbo, 'AUTHAPP', integrationObject.authApp);
    } else if (integrationObject.useOSSecurity) {
        setValue(mbo, 'USEOSSECURITY', integrationObject.useOSSecurity);
    }

    applySigOptions(mbo, integrationObject.sigOption);
    applyOSLCActions(mbo, integrationObject);
    applyOSLCQueries(mbo, integrationObject.oslcQuery);
    applyQueryTemplates(mbo, integrationObject.queryTemplate);
}

function applyIntegrationObjectDetails(mbo: psdi.mbo.MboRemote, integrationObject: MaximoIntegrationObject): void {
    const maxIntObjDetailSet = mbo.getMboSet('MAXINTOBJDETAIL');

    integrationObject.maxIntObjDetail.forEach(function (detail: MaximoIntegrationObjectDetail): void {
        const maxIntObjDetail = maxIntObjDetailSet.add();

        setValue(maxIntObjDetail, 'OBJECTNAME', detail.objectName);
        setValue(maxIntObjDetail, 'ALTKEY', detail.altKey);
        setValue(maxIntObjDetail, 'EXCLUDEBYDEFAULT', detail.excludeByDefault);
        setValue(maxIntObjDetail, 'SKIPKEYUPDATE', detail.skipKeyUpdate);
        setValue(maxIntObjDetail, 'EXCLUDEPARENTKEY', detail.excludeParentKey);
        setValue(maxIntObjDetail, 'DELETEONCREATE', detail.deleteOnCreate);
        setValue(maxIntObjDetail, 'PROPAGATEEVENT', detail.propagateEvent);
        setValue(maxIntObjDetail, 'INVOKEEXECUTE', detail.invokeExecute);
        setValue(maxIntObjDetail, 'FDRESOURCE', detail.fdResource);

        if (detail.parentObjName) {
            setValue(maxIntObjDetail, 'PARENTOBJNAME', detail.parentObjName);
            setValue(maxIntObjDetail, 'RELATION', detail.relation);
            setValue(maxIntObjDetail, 'OBJECTORDER', detail.objectOrder);
        }

        applyIntegrationObjectColumns(maxIntObjDetail, detail.maxIntObjCols);
        applyIntegrationObjectAliases(maxIntObjDetail, detail.maxIntObjAlias);
        applyObjectApplicationAuth(maxIntObjDetail, detail);
    });
}

function applyIntegrationObjectColumns(mbo: psdi.mbo.MboRemote, columns: MaximoIntegrationObjectColumn[]): void {
    const maxIntObjColsSet = mbo.getMboSet('MAXINTOBJCOLS');

    columns.forEach(function (column: MaximoIntegrationObjectColumn): void {
        const maxIntObjCols = maxIntObjColsSet.add();
        setValue(maxIntObjCols, 'NAME', column.name);
        setValue(maxIntObjCols, 'INTOBJFLDTYPE', column.intObjFldType);
    });
}

function applyIntegrationObjectAliases(mbo: psdi.mbo.MboRemote, aliases: MaximoIntegrationObjectAlias[]): void {
    const maxIntObjAliasSet = mbo.getMboSet('MAXINTOBJALIAS');

    aliases.forEach(function (alias: MaximoIntegrationObjectAlias): void {
        const maxIntObjAlias = maxIntObjAliasSet.add();
        setValue(maxIntObjAlias, 'NAME', alias.name);
        setValue(maxIntObjAlias, 'ALIASNAME', alias.aliasName);
    });
}

function applyObjectApplicationAuth(mbo: psdi.mbo.MboRemote, detail: MaximoIntegrationObjectDetail): void {
    const objectAppAuthSet = mbo.getMboSet('$objectappauth', 'OBJECTAPPAUTH', '1=1');

    detail.objectAppAuth.forEach(function (auth: MaximoObjectApplicationAuth): void {
        const objectAppAuth = objectAppAuthSet.add();
        setValue(objectAppAuth, 'CONTEXT', auth.context);
        setValue(objectAppAuth, 'DESCRIPTION', auth.description);
        setValue(objectAppAuth, 'OBJECTNAME', detail.objectName);
        setValue(objectAppAuth, 'AUTHAPP', auth.authApp);
    });
}

function applySigOptions(mbo: psdi.mbo.MboRemote, options: MaximoSignatureOption[]): void {
    const sigOptionSet = mbo.getMboSet('SIGOPTION');

    options.forEach(function (option: MaximoSignatureOption): void {
        const sigOption = sigOptionSet.add();
        setValue(sigOption, 'OPTIONNAME', option.optionName);
        setValue(sigOption, 'DESCRIPTION', option.description);
        setValue(sigOption, 'ALSOGRANTS', option.alsoGrants);
        setValue(sigOption, 'ALSOREVOKES', option.alsoRevokes);
        setValue(sigOption, 'PREREQUISITE', option.prerequisite);
        setValue(sigOption, 'ESIGENABLED', option.esigEnabled);
        setValue(sigOption, 'VISIBLE', option.visible);
    });
}

function applyOSLCActions(mbo: psdi.mbo.MboRemote, integrationObject: MaximoIntegrationObject): void {
    const osOSLCActionSet = mbo.getMboSet('OSOSLCACTION');

    integrationObject.osOSLCAction.forEach(function (action: MaximoOSLCAction): void {
        const osOSLCAction = osOSLCActionSet.add();
        setValue(osOSLCAction, 'NAME', action.name);
        setValue(osOSLCAction, 'DESCRIPTION', action.description);
        setValue(osOSLCAction, 'IMPLTYPE', action.implType);

        switch (action.implType) {
            case 'system':
                setValue(osOSLCAction, 'SYSTEMNAME', action.systemName);
                break;
            case 'script':
                setValue(osOSLCAction, 'SCRIPTNAME', action.scriptName);
                break;
            case 'workflow':
                setValue(osOSLCAction, 'PROCESSNAME', action.processName);
                break;
            case 'wsmethod':
                setValue(osOSLCAction, 'METHODNAME', action.methodName);
                break;
        }

        if (action.optionName) {
            const accessModifier = hasSignatureOption(integrationObject.sigOption, action.optionName) ? MboConstants.NOVALIDATION : undefined;
            setValue(osOSLCAction, 'OPTIONNAME', action.optionName, accessModifier);
        }

        setValue(osOSLCAction, 'COLLECTION', action.collection);
    });
}

function hasSignatureOption(options: MaximoSignatureOption[], optionName: string): boolean {
    let index = 0;

    while (index < options.length) {
        if (options[index].optionName === optionName) {
            return true;
        }
        index += 1;
    }

    return false;
}

function applyOSLCQueries(mbo: psdi.mbo.MboRemote, queries: MaximoOSLCQuery[]): void {
    const oslcQuerySet = mbo.getMboSet('OSLCQUERY');

    queries.forEach(function (query: MaximoOSLCQuery): void {
        const oslcQuery = oslcQuerySet.add();
        setValue(oslcQuery, 'QUERYTYPE', query.queryType);

        switch (query.queryType) {
            case 'appclause':
                setValue(oslcQuery, 'APP', query.app);
                setValue(oslcQuery, 'CLAUSENAME', query.clauseName);
                break;
            case 'method':
                setValue(oslcQuery, 'METHOD', query.method);
                setValue(oslcQuery, 'DESCRIPTION', query.description);
                break;
            case 'osclause':
                setValue(oslcQuery, 'CLAUSENAME', query.clauseName);
                setValue(oslcQuery, 'DESCRIPTION', query.description);
                setValue(oslcQuery, 'CLAUSE', query.clause);
                setValue(oslcQuery, 'ISPUBLIC', query.isPublic);
                break;
            case 'script':
                setValue(oslcQuery, 'SCRIPT', query.script);
                break;
        }
    });
}

function applyQueryTemplates(mbo: psdi.mbo.MboRemote, templates: MaximoQueryTemplate[]): void {
    const queryTemplateSet = mbo.getMboSet('QUERYTEMPLATE');

    templates.forEach(function (template: MaximoQueryTemplate): void {
        const queryTemplate = queryTemplateSet.add();
        setValue(queryTemplate, 'TEMPLATENAME', template.templateName);
        setValue(queryTemplate, 'DESCRIPTION', template.description);
        setValue(queryTemplate, 'PAGESIZE', template.pageSize);
        setValue(queryTemplate, 'ROLE', template.role);
        setValue(queryTemplate, 'SEARCHATTRIBUTES', template.searchAttributes);
        setValue(queryTemplate, 'TIMELINEATTRIBUTE', template.timelineAttributes);
        setValue(queryTemplate, 'ISPUBLIC', template.isPublic);
        applyQueryTemplateAttributes(queryTemplate, template.queryTemplateAttr);
    });
}

function applyQueryTemplateAttributes(mbo: psdi.mbo.MboRemote, attributes: MaximoQueryTemplateAttribute[]): void {
    const queryTemplateAttrSet = mbo.getMboSet('QUERYTEMPLATEATTR');

    attributes.forEach(function (attribute: MaximoQueryTemplateAttribute): void {
        const queryTemplateAttr = queryTemplateAttrSet.add();
        setValue(queryTemplateAttr, 'SELECTATTRNAME', attribute.selectAttrName);
        setValue(queryTemplateAttr, 'TITLE', attribute.title);
        setValue(queryTemplateAttr, 'SELECTORDER', attribute.selectOrder);
        setValue(queryTemplateAttr, 'ALIAS', attribute.alias);
        setValue(queryTemplateAttr, 'SORTBYON', attribute.sortByOn);
        setValue(queryTemplateAttr, 'ASCENDING', attribute.ascending);
        setValue(queryTemplateAttr, 'SORTBYORDER', attribute.sortByOrder);
    });
}

function attributeExists(objectName: string, attributeName: string): boolean {
    const mboSetInfo = MXServer.getMXServer().getMaximoDD().getMboSetInfo(objectName);
    return mboSetInfo != null && mboSetInfo.getMboValueInfo(attributeName) != null;
}

function lowerCase(value: string | null | undefined): string | null | undefined {
    return typeof value === 'undefined' || value === null ? value : String(value).toLowerCase();
}

function arrayOrEmpty<T>(value: T[] | null | undefined): T[] {
    return Array.isArray(value) ? value : [];
}

function booleanOrDefault(value: any, defaultValue: boolean): boolean {
    return typeof value === 'undefined' ? defaultValue : value == true;
}

function isMissing(value: any): boolean {
    return typeof value === 'undefined' || !value;
}

function validateIntegrationObjectInput(input: MaximoIntegrationObjectInput): void {
    if (!input) {
        throw new Error('A integration object JSON is required to create the IntegrationObject object.');
    }
    if (typeof input.intObjectName === 'undefined') {
        throw new Error('The intObjectName property is required and must a Maximo Integration Object field value.');
    }
    if (typeof input.maxIntObjDetail === 'undefined' || !Array.isArray(input.maxIntObjDetail) || input.maxIntObjDetail.length === 0) {
        throw new Error('The maxIntObjDetail property is required and must an array that contains at least one Maximo Integration Object Detail object.');
    }

    validateIntegrationObjectDetails(input);
    validateTopLevelObjectApplicationAuth(input);
    validateSignatureOptions(input);
    validateOSLCActions(input);
    validateOSLCQueries(input);
    validateQueryTemplates(input);
}

function validateIntegrationObjectDetails(input: MaximoIntegrationObjectInput): void {
    const details = input.maxIntObjDetail as MaximoIntegrationObjectDetailInput[];
    let parentCount = 0;

    details.forEach(function (detail: MaximoIntegrationObjectDetailInput): void {
        if (isMissing(detail.objectName)) {
            throw new Error('The integration object ' + input.intObjectName + ' contains a object detail record that does not contain an object name.');
        }

        if (typeof detail.parentObjName === 'undefined' || !detail.parentObjName) {
            parentCount += 1;
        } else if (isMissing(detail.relation)) {
            throw new Error('The integration object ' + input.intObjectName + ' contains a child object detail record that does not contain a relation name.');
        }
    });

    if (parentCount === 0) {
        throw new Error(
            'The integration object ' +
                input.intObjectName +
                ' does not have a top level object detail record, a top level parent must be defined for an integration object.'
        );
    }

    if (parentCount > 1) {
        throw new Error(
            'The integration object ' +
                input.intObjectName +
                ' has more than one top level object detail record, only one top level parent can be defined for an integration object.'
        );
    }

    details.forEach(function (detail: MaximoIntegrationObjectDetailInput): void {
        if (Array.isArray(detail.maxIntObjCols)) {
            detail.maxIntObjCols.forEach(function (column: MaximoIntegrationObjectColumnInput): void {
                if (isMissing(column.name)) {
                    throw new Error(
                        'The integration object ' +
                            input.intObjectName +
                            ' object ' +
                            detail.objectName +
                            ' is missing a name property for a maxIntObjCols object.'
                    );
                }
                if (isMissing(column.intObjFldType)) {
                    throw new Error(
                        'The integration object ' +
                            input.intObjectName +
                            ' object ' +
                            detail.objectName +
                            ' is missing a intObjFldType property for a maxIntObjCols object.'
                    );
                }
            });
        }

        if (Array.isArray(detail.maxIntObjAlias)) {
            if (!input.flatSupported) {
                throw new Error(
                    'The maxIntObjAlias entries can only be applied to integration objects that support flat structure, ' +
                        (input as any).objectName +
                        ' does not support flat structure.'
                );
            }

            detail.maxIntObjAlias.forEach(function (alias: MaximoIntegrationObjectAliasInput): void {
                if (isMissing(alias.name)) {
                    throw new Error(
                        'The integration object ' +
                            input.intObjectName +
                            ' object ' +
                            detail.objectName +
                            ' is missing a name property for a maxIntObjAlias object.'
                    );
                }
                if (isMissing(alias.aliasName)) {
                    throw new Error(
                        'The integration object ' +
                            input.intObjectName +
                            ' object ' +
                            detail.objectName +
                            ' is missing a aliasName property for a maxIntObjAlias object.'
                    );
                }
            });
        }

        if (Array.isArray(detail.objectAppAuth)) {
            detail.objectAppAuth.forEach(function (auth: MaximoObjectApplicationAuthInput): void {
                if (isMissing(auth.context)) {
                    throw new Error(
                        'The integration object ' +
                            input.intObjectName +
                            ' object ' +
                            detail.objectName +
                            ' is missing a context property for a objectAppAuth object.'
                    );
                }
            });
        }
    });
}

function validateTopLevelObjectApplicationAuth(input: MaximoIntegrationObjectInput): void {
    if (!input.objectAppAuth || !Array.isArray(input.objectAppAuth)) {
        return;
    }

    input.objectAppAuth.forEach(function (auth: MaximoObjectApplicationAuthInput): void {
        if (isMissing(auth.context)) {
            throw new Error('An objectAppAuth entry is missing the required context property.');
        }
        if (isMissing(auth.objectName)) {
            throw new Error('An objectAppAuth entry is missing the required objectName property.');
        }
        if (isMissing(auth.authApp)) {
            throw new Error('An objectAppAuth entry is missing the required authApp property.');
        }
    });
}

function validateSignatureOptions(input: MaximoIntegrationObjectInput): void {
    if (!input.sigOption || !Array.isArray(input.sigOption)) {
        return;
    }

    input.sigOption.forEach(function (option: MaximoSignatureOptionInput): void {
        if (isMissing(option.optionName)) {
            throw new Error('A sigOption entry is missing the required optionName property.');
        }
    });
}

function validateOSLCActions(input: MaximoIntegrationObjectInput): void {
    if (!input.osOSLCAction || !Array.isArray(input.osOSLCAction)) {
        return;
    }

    const implTypes = ['script', 'system', 'workflow', 'wsmethod'];

    input.osOSLCAction.forEach(function (action: MaximoOSLCActionInput): void {
        if (isMissing(action.name)) {
            throw new Error('A osOSLCAction entry is missing the required name property.');
        }

        if (isMissing(action.implType)) {
            throw new Error('An osOSLCAction entry is missing the required implType property.');
        }

        const implType = lowerCase(action.implType);
        if (implTypes.indexOf(String(implType)) < 0) {
            throw new Error(
                'The osOSLCAction implementation type ' + implType + ' is not valid, ' + implTypes.join(',') + ' are the valid implementation types.'
            );
        }

        if (implType === 'script' && isMissing(action.scriptName)) {
            throw new Error('The osOSLCAction entry is missing the required scriptName property for the implementation type of "script".');
        }
        if (implType === 'system' && isMissing(action.systemName)) {
            throw new Error('The osOSLCAction entry is missing the required systemName property for the implementation type of "system".');
        }
        if (implType === 'workflow' && isMissing(action.processName)) {
            throw new Error('The osOSLCAction entry is missing the required processName property for the implementation type of "workflow".');
        }
        if (implType === 'wsmethod' && isMissing(action.methodName)) {
            throw new Error('The osOSLCAction entry is missing the required methodName property for the implementation type of "wsmethod".');
        }
    });
}

function validateOSLCQueries(input: MaximoIntegrationObjectInput): void {
    if (!input.oslcQuery || !Array.isArray(input.oslcQuery)) {
        return;
    }

    const queryTypes = ['appclause', 'method', 'osclause', 'script'];

    input.oslcQuery.forEach(function (query: MaximoOSLCQueryInput): void {
        if (isMissing(query.queryType)) {
            throw new Error('A oslcQuery entry is missing the required queryType property.');
        }

        const queryType = lowerCase(query.queryType);
        if (queryTypes.indexOf(String(queryType)) < 0) {
            throw new Error('The oslcQuery query type ' + queryType + ' is not valid, ' + queryTypes.join(',') + ' are the valid query types.');
        }

        if (queryType === 'appclause') {
            if (isMissing(query.app)) {
                throw new Error('The oslcQuery entry is missing the required app property for the query type of "appclause".');
            }
            if (isMissing(query.clauseName)) {
                throw new Error('The oslcQuery entry is missing the required clauseName property for the query type of "appclause".');
            }
        } else if (queryType === 'method') {
            if (isMissing(query.method)) {
                throw new Error('The oslcQuery entry is missing the required method property for the query type of "method".');
            }
        } else if (queryType === 'osclause') {
            if (isMissing(query.clauseName)) {
                throw new Error('The oslcQuery entry is missing the required clauseName property for the query type of "osclause".');
            }
            if (isMissing(query.clause)) {
                throw new Error('The oslcQuery entry is missing the required clause property for the query type of "osclause".');
            }
        } else if (queryType === 'script' && isMissing(query.script)) {
            throw new Error('The oslcQuery entry is missing the required script property for the query type of "script".');
        }
    });
}

function validateQueryTemplates(input: MaximoIntegrationObjectInput): void {
    if (!input.queryTemplate || !Array.isArray(input.queryTemplate)) {
        return;
    }

    input.queryTemplate.forEach(function (template: MaximoQueryTemplateInput): void {
        if (isMissing(template.templateName)) {
            throw new Error('A queryTemplate entry is missing the required templateName property.');
        }

        if (!template.queryTemplateAttr || !Array.isArray(template.queryTemplateAttr)) {
            return;
        }

        template.queryTemplateAttr.forEach(function (attribute: MaximoQueryTemplateAttributeInput): void {
            if (isMissing(attribute.selectAttrName)) {
                throw new Error('A queryTemplateAttr entry is missing the required selectAttrName property.');
            }
        });
    });
}

export interface MaximoIntegrationObjectColumnInput {
    name: string;
    intObjFldType: MaximoIntegrationObjectFieldType;
}

export class MaximoIntegrationObjectColumn {
    name: string;
    intObjFldType: MaximoIntegrationObjectFieldType;

    constructor(input: MaximoIntegrationObjectColumnInput) {
        this.name = input.name;
        this.intObjFldType = input.intObjFldType;
    }
}

export interface MaximoIntegrationObjectAliasInput {
    name: string;
    aliasName: string;
}

export class MaximoIntegrationObjectAlias {
    name: string;
    aliasName: string;

    constructor(input: MaximoIntegrationObjectAliasInput) {
        this.name = input.name;
        this.aliasName = input.aliasName;
    }
}

export interface MaximoObjectApplicationAuthInput {
    context: string;
    description?: string | null;
    objectName?: string | null;
    authApp: string;
}

export class MaximoObjectApplicationAuth {
    context: string;
    description: string | null = '';
    objectName?: string | null;
    authApp: string;

    constructor(input: MaximoObjectApplicationAuthInput) {
        this.context = input.context;
        this.authApp = input.authApp;

        this.description = valueOrDefault(input.description, this.description);
        this.objectName = input.objectName;
    }
}

export interface MaximoIntegrationObjectDetailInput {
    objectName: string;
    altKey?: string | null;
    excludeByDefault?: boolean | null;
    skipKeyUpdate?: boolean | null;
    excludeParentKey?: boolean | null;
    deleteOnCreate?: boolean | null;
    propagateEvent?: boolean | null;
    invokeExecute?: boolean | null;
    fdResource?: string | null;
    parentObjName?: string | null;
    relation?: string | null;
    objectOrder?: number | null;
    maxIntObjCols?: MaximoIntegrationObjectColumnInput[] | null;
    maxIntObjAlias?: MaximoIntegrationObjectAliasInput[] | null;
    objectAppAuth?: MaximoObjectApplicationAuthInput[] | null;
}

export class MaximoIntegrationObjectDetail {
    objectName: string;
    altKey: string | null = '';
    excludeByDefault: boolean | null = false;
    skipKeyUpdate: boolean | null = false;
    excludeParentKey: boolean | null = true;
    deleteOnCreate: boolean | null = true;
    propagateEvent: boolean | null = false;
    invokeExecute: boolean | null = false;
    fdResource: string | null = '';
    parentObjName: string | null = '';
    relation: string | null = '';
    objectOrder: number | null = 1;
    maxIntObjCols: MaximoIntegrationObjectColumn[] = [];
    maxIntObjAlias: MaximoIntegrationObjectAlias[] = [];
    objectAppAuth: MaximoObjectApplicationAuth[] = [];

    constructor(input: MaximoIntegrationObjectDetailInput) {
        this.objectName = input.objectName;

        this.altKey = valueOrDefault(input.altKey, this.altKey);
        this.excludeByDefault = booleanOrDefault(input.excludeByDefault, this.excludeByDefault);
        this.skipKeyUpdate = booleanOrDefault(input.skipKeyUpdate, this.skipKeyUpdate);
        this.excludeParentKey = booleanOrDefault(input.excludeParentKey, this.excludeParentKey);
        this.deleteOnCreate = booleanOrDefault(input.deleteOnCreate, this.deleteOnCreate);
        this.propagateEvent = booleanOrDefault(input.propagateEvent, this.propagateEvent);
        this.invokeExecute = booleanOrDefault(input.invokeExecute, this.invokeExecute);
        this.fdResource = valueOrDefault(input.fdResource, this.fdResource);
        this.parentObjName = valueOrDefault(input.parentObjName, this.parentObjName);
        this.relation = valueOrDefault(input.relation, this.relation);
        this.objectOrder = valueOrDefault(input.objectOrder, this.objectOrder);
        this.maxIntObjCols = arrayOrEmpty(input.maxIntObjCols).map((column) => new MaximoIntegrationObjectColumn(column));
        this.maxIntObjAlias = arrayOrEmpty(input.maxIntObjAlias).map((alias) => new MaximoIntegrationObjectAlias(alias));
        this.objectAppAuth = arrayOrEmpty(input.objectAppAuth).map((auth) => new MaximoObjectApplicationAuth(auth));
    }
}

export interface MaximoSignatureOptionInput {
    optionName: string;
    description?: string | null;
    esigEnabled?: boolean | null;
    alsoGrants?: string | null;
    alsoRevokes?: string | null;
    prerequisite?: string | null;
    visible?: boolean | null;
}

export class MaximoSignatureOption {
    optionName: string;
    description: string | null = '';
    esigEnabled: boolean | null = false;
    alsoGrants: string | null = '';
    alsoRevokes: string | null = '';
    prerequisite: string | null = '';
    visible: boolean | null = true;

    constructor(input: MaximoSignatureOptionInput) {
        this.optionName = input.optionName;

        this.description = valueOrDefault(input.description, this.description);
        this.esigEnabled = booleanOrDefault(input.esigEnabled, this.esigEnabled);
        this.alsoGrants = valueOrDefault(input.alsoGrants, this.alsoGrants);
        this.alsoRevokes = valueOrDefault(input.alsoRevokes, this.alsoRevokes);
        this.prerequisite = valueOrDefault(input.prerequisite, this.prerequisite);
        this.visible = booleanOrDefault(input.visible, this.visible);
    }
}

export interface MaximoOSLCActionInput {
    name: string;
    description?: string | null;
    implType: MaximoOSLCActionImplementationType;
    systemName?: string | null;
    scriptName?: string | null;
    processName?: string | null;
    methodName?: string | null;
    optionName?: string | null;
    collection?: boolean | null;
}

export class MaximoOSLCAction {
    name: string;
    description: string | null = '';
    implType: MaximoOSLCActionImplementationType;
    systemName: string | null = '';
    scriptName: string | null = '';
    processName: string | null = '';
    methodName: string | null = '';
    optionName: string | null = '';
    collection: boolean | null = false;

    constructor(input: MaximoOSLCActionInput) {
        this.name = input.name;
        this.implType = lowerCase(input.implType) as MaximoOSLCActionImplementationType;

        this.description = valueOrDefault(input.description, this.description);
        this.systemName = valueOrDefault(input.systemName, this.systemName);
        this.scriptName = valueOrDefault(input.scriptName, this.scriptName);
        this.processName = valueOrDefault(input.processName, this.processName);
        this.methodName = valueOrDefault(input.methodName, this.methodName);
        this.optionName = valueOrDefault(input.optionName, this.optionName);
        this.collection = booleanOrDefault(input.collection, this.collection);
    }
}

export interface MaximoOSLCQueryInput {
    queryType: MaximoOSLCQueryType;
    app?: string | null;
    clauseName?: string | null;
    method?: string | null;
    description?: string | null;
    clause?: string | null;
    isPublic?: boolean | null;
    script?: string | null;
    filter?: boolean | null;
}

export class MaximoOSLCQuery {
    queryType: MaximoOSLCQueryType;
    app: string | null = '';
    clauseName: string | null = '';
    method: string | null = '';
    description: string | null = '';
    clause: string | null = '';
    isPublic: boolean | null = true;
    script: string | null = '';
    filter: boolean | null = false;

    constructor(input: MaximoOSLCQueryInput) {
        this.queryType = lowerCase(input.queryType) as MaximoOSLCQueryType;
        this.app = valueOrDefault(input.app, this.app);
        this.clauseName = valueOrDefault(input.clauseName, this.clauseName);
        this.method = valueOrDefault(input.method, this.method);
        this.description = valueOrDefault(input.description, this.description);
        this.clause = valueOrDefault(input.clause, this.clause);
        this.isPublic = booleanOrDefault(input.isPublic, this.isPublic);
        this.script = valueOrDefault(input.script, this.script);
        this.filter = booleanOrDefault(input.filter, this.filter);
    }
}

export interface MaximoQueryTemplateAttributeInput {
    selectAttrName: string;
    title?: string | null;
    selectOrder?: number | string | null;
    alias?: string | null;
    sortByOn?: boolean | null;
    ascending?: boolean | null;
    sortByOrder?: number | string | null;
}

export class MaximoQueryTemplateAttribute {
    selectAttrName: string;
    title: string | null = '';
    selectOrder: number | string | null = '';
    alias: string | null = '';
    sortByOn: boolean | null = false;
    ascending: boolean | null = false;
    sortByOrder: number | string | null = '';

    constructor(input: MaximoQueryTemplateAttributeInput) {
        this.selectAttrName = input.selectAttrName;

        this.title = valueOrDefault(input.title, this.title);
        this.selectOrder = valueOrDefault(input.selectOrder, this.selectOrder);
        this.alias = valueOrDefault(input.alias, this.alias);
        this.sortByOn = booleanOrDefault(input.sortByOn, this.sortByOn);
        this.ascending = booleanOrDefault(input.ascending, this.ascending);
        this.sortByOrder = valueOrDefault(input.sortByOrder, this.sortByOrder);
    }
}

export interface MaximoQueryTemplateInput {
    templateName: string;
    description?: string | null;
    pageSize?: number | string | null;
    role?: string | null;
    searchAttributes?: string | null;
    timelineAttributes?: string | null;
    isPublic?: boolean | null;
    queryTemplateAttr?: MaximoQueryTemplateAttributeInput[] | null;
}

export class MaximoQueryTemplate {
    templateName: string;
    description: string | null = '';
    pageSize: number | string | null = '';
    role: string | null = '';
    searchAttributes: string | null = '';
    timelineAttributes: string | null = '';
    isPublic: boolean | null = true;
    queryTemplateAttr: MaximoQueryTemplateAttribute[] = [];

    constructor(input: MaximoQueryTemplateInput) {
        this.templateName = input.templateName;

        this.description = valueOrDefault(input.description, this.description);
        this.pageSize = valueOrDefault(input.pageSize, this.pageSize);
        this.role = valueOrDefault(input.role, this.role);
        this.searchAttributes = valueOrDefault(input.searchAttributes, this.searchAttributes);
        this.timelineAttributes = valueOrDefault(input.timelineAttributes, this.timelineAttributes);
        this.isPublic = booleanOrDefault(input.isPublic, this.isPublic);
        this.queryTemplateAttr = arrayOrEmpty(input.queryTemplateAttr).map((attribute) => new MaximoQueryTemplateAttribute(attribute));
    }
}

export interface MaximoIntegrationObjectInput {
    _delete?: boolean;
    intObjectName: string;
    description?: string | null;
    useWith?: string | null;
    useOSSecurity?: boolean | null;
    authApp?: string | null;
    selfReferencing?: boolean | null;
    queryOnly?: boolean | null;
    flatSupported?: boolean | null;
    loadQueryFromApp?: boolean | null;
    defClass?: string | null;
    procClass?: string | null;
    searchAttrs?: string | null;
    restrictWhere?: string | null;
    module?: string | null;
    autoPagingThreshold?: number | null;
    maxIntObjDetail?: MaximoIntegrationObjectDetailInput[] | null;
    objectAppAuth?: MaximoObjectApplicationAuthInput[] | null;
    sigOption?: MaximoSignatureOptionInput[] | null;
    osOSLCAction?: MaximoOSLCActionInput[] | null;
    oslcQuery?: MaximoOSLCQueryInput[] | null;
    queryTemplate?: MaximoQueryTemplateInput[] | null;
}

export class MaximoIntegrationObject {
    _delete = false;
    intObjectName: string;
    description: string | null = '';
    useWith: string | null = 'INTEGRATION';
    useOSSecurity: boolean | null = false;
    authApp: string | null = '';
    selfReferencing: boolean | null = false;
    queryOnly: boolean | null = false;
    flatSupported: boolean | null = false;
    loadQueryFromApp: boolean | null = false;
    defClass: string | null = '';
    procClass: string | null = '';
    searchAttrs: string | null = '';
    restrictWhere: string | null = '';
    module: string | null = '';
    autoPagingThreshold: number | null = -1;
    maxIntObjDetail: MaximoIntegrationObjectDetail[] = [];
    objectAppAuth: MaximoObjectApplicationAuth[] = [];
    sigOption: MaximoSignatureOption[] = [];
    osOSLCAction: MaximoOSLCAction[] = [];
    oslcQuery: MaximoOSLCQuery[] = [];
    queryTemplate: MaximoQueryTemplate[] = [];

    constructor(input: MaximoIntegrationObjectInput) {
        validateIntegrationObjectInput(input);

        this.intObjectName = input.intObjectName;

        this._delete = booleanOrDefault(input._delete, this._delete);
        this.description = valueOrDefault(input.description, this.description);
        this.useWith = input.useWith || this.useWith;
        this.useOSSecurity = booleanOrDefault(input.useOSSecurity, this.useOSSecurity);
        this.authApp = valueOrDefault(input.authApp, this.authApp);
        this.selfReferencing = booleanOrDefault(input.selfReferencing, this.selfReferencing);
        this.queryOnly = booleanOrDefault(input.queryOnly, this.queryOnly);
        this.flatSupported = booleanOrDefault(input.flatSupported, this.flatSupported);
        this.loadQueryFromApp = booleanOrDefault(input.loadQueryFromApp, this.loadQueryFromApp);
        this.defClass = valueOrDefault(input.defClass, this.defClass);
        this.procClass = valueOrDefault(input.procClass, this.procClass);
        this.searchAttrs = valueOrDefault(input.searchAttrs, this.searchAttrs);
        this.restrictWhere = valueOrDefault(input.restrictWhere, this.restrictWhere);
        this.module = valueOrDefault(input.module, this.module);
        this.autoPagingThreshold = valueOrDefault(input.autoPagingThreshold, this.autoPagingThreshold);
        this.maxIntObjDetail = arrayOrEmpty(input.maxIntObjDetail).map((detail) => new MaximoIntegrationObjectDetail(detail));
        this.sortDetails();
        this.objectAppAuth = arrayOrEmpty(input.objectAppAuth).map((auth) => new MaximoObjectApplicationAuth(auth));
        this.sigOption = arrayOrEmpty(input.sigOption).map((option) => new MaximoSignatureOption(option));
        this.osOSLCAction = arrayOrEmpty(input.osOSLCAction).map((action) => new MaximoOSLCAction(action));
        this.oslcQuery = arrayOrEmpty(input.oslcQuery).map((query) => new MaximoOSLCQuery(query));
        this.queryTemplate = arrayOrEmpty(input.queryTemplate).map((template) => new MaximoQueryTemplate(template));
    }

    private sortDetails(): void {
        this.maxIntObjDetail.sort(function (a: MaximoIntegrationObjectDetail, b: MaximoIntegrationObjectDetail): number {
            if (!a.parentObjName) {
                return -1;
            }
            if (!b.parentObjName) {
                return 1;
            }
            if (a.objectName === b.parentObjName) {
                return -1;
            }
            if (b.objectName === a.parentObjName) {
                return 1;
            }
            return 0;
        });
    }
}
