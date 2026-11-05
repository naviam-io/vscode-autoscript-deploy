/// <reference path="../globals.d.ts" />
/// <reference path="../manage-facade.d.ts" />
/// <reference path="../manage.d.ts" />

import { applyOptionalValues, applyValues, configureSse, toExternalSynonymValue, toInternalSynonymValue, updateError } from './core/util';
import { hasRetainDeclarations, retainIdentityOf } from './core/retained-values';
import { deleteSnapshot, describeSnapshot, isSnapshotKey, snapshotKey } from './core/snapshot-store';
import { MaximoProperty, process as processProperty, SNAPSHOT_OBJECT as PROPERTY_SNAPSHOT_OBJECT } from './config/properties';
import { MaximoMessage, process as processMessage, SNAPSHOT_OBJECT as MESSAGE_SNAPSHOT_OBJECT } from './config/messages';
import { MaximoLogger, process as processLogger, SNAPSHOT_OBJECT as LOGGER_SNAPSHOT_OBJECT } from './config/loggers';
import { MaximoDomain, process as processDomain, SNAPSHOT_OBJECT as DOMAIN_SNAPSHOT_OBJECT } from './config/domains';
import { MaximoCronTask, process as processCronTask, SNAPSHOT_OBJECT as CRON_TASK_SNAPSHOT_OBJECT } from './config/cron-tasks';
import {
    MaximoIntegrationObject,
    process as processIntegrationObject,
    SNAPSHOT_OBJECT as INTEGRATION_OBJECT_SNAPSHOT_OBJECT
} from './config/integration-objects';
import { MaximoAction, process as processAction, SNAPSHOT_OBJECT as ACTION_SNAPSHOT_OBJECT } from './config/actions';
import { MaximoEscalation, process as processEscalation, SNAPSHOT_OBJECT as ESCALATION_SNAPSHOT_OBJECT } from './config/escalations';
import { MaximoQuery, process as processQuery, SNAPSHOT_OBJECT as QUERY_SNAPSHOT_OBJECT } from './config/queries';
import { MaximoEndPoint, process as processEndPoint, SNAPSHOT_OBJECT as END_POINT_SNAPSHOT_OBJECT } from './config/end-points';
import { MaximoPublishChannel, process as processPublishChannel, SNAPSHOT_OBJECT as PUBLISH_CHANNEL_SNAPSHOT_OBJECT } from './config/publish-channels';
import {
    MaximoEnterpriseService,
    process as processEnterpriseService,
    SNAPSHOT_OBJECT as ENTERPRISE_SERVICE_SNAPSHOT_OBJECT
} from './config/enterprise-services';
import { MaximoExternalSystem, process as processExternalSystem, SNAPSHOT_OBJECT as EXTERNAL_SYSTEM_SNAPSHOT_OBJECT } from './config/external-systems';
import { MaximoObject, process as processObject, SNAPSHOT_OBJECT as OBJECT_SNAPSHOT_OBJECT } from './config/objects';
import { MaximoPresentation, preparePresentations, processPresentation } from './config/presentations';
import { deployPresentationXml } from './core/presentation-writer';

/**
 * A payload type: the model whose constructor validates an entry, what checks all of its entries
 * before any entry of the payload is applied, and what applies an entry to Maximo.
 */
type Handler = { model: new (input: any) => any; process: (record: any) => void; prepare?: (records: any[]) => void };
type HandlerRegistry = Record<string, Handler>;
type RequestPayload = Record<string, unknown>;

/** What a payload type needs in order for a leftover snapshot to be found for it without applying
 * anything: the Maximo object the key is namespaced by, and the model that supplies `_keys`. */
type SnapshotProbe = { objectName: string; model: new (input: any) => any };

const handlers: HandlerRegistry = {};
const snapshotProbes: Record<string, SnapshotProbe> = {};

function runFromRequestBody(): void {
    if (typeof requestBody === 'undefined' || typeof requestBody !== 'string') {
        return;
    }

    const trimmedRequestBody = requestBody.trim();
    if (!isJsonPayload(trimmedRequestBody)) {
        return;
    }

    deployConfig(JSON.parse(trimmedRequestBody), request);
}

function deployConfig(config?: RequestPayload, requestContext?: any): void {
    if (!config) {
        return;
    }

    configureSse(requestContext);
    registerHandlers();

    try {
        processPayload(config, handlers);
    } catch (error) {
        const message = getErrorMessage(error);
        updateError(message);
        if (isJavaException(error)) {
            error.printStackTrace();
        }
        throw error;
    }
}

function registerHandlers(): void {
    registerHandler('properties', MaximoProperty, processProperty);
    registerHandler('messages', MaximoMessage, processMessage);
    registerHandler('loggers', MaximoLogger, processLogger);
    registerHandler('domains', MaximoDomain, processDomain);
    registerHandler('cronTasks', MaximoCronTask, processCronTask);
    registerHandler('integrationObjects', MaximoIntegrationObject, processIntegrationObject);
    registerHandler('actions', MaximoAction, processAction);
    registerHandler('escalations', MaximoEscalation, processEscalation);
    registerHandler('queries', MaximoQuery, processQuery);
    registerHandler('endPoints', MaximoEndPoint, processEndPoint);
    registerHandler('publishChannels', MaximoPublishChannel, processPublishChannel);
    registerHandler('enterpriseServices', MaximoEnterpriseService, processEnterpriseService);
    registerHandler('externalSystems', MaximoExternalSystem, processExternalSystem);
    registerHandler('objects', MaximoObject, processObject);
    registerHandler('presentations', MaximoPresentation, processPresentation, preparePresentations);
}

/** Only the snapshot pre-flight needs these, so a deployment does not pay for them. */
function registerSnapshotProbes(): void {
    registerSnapshotProbe('domains', DOMAIN_SNAPSHOT_OBJECT, MaximoDomain);
    registerSnapshotProbe('cronTasks', CRON_TASK_SNAPSHOT_OBJECT, MaximoCronTask);
    registerSnapshotProbe('queries', QUERY_SNAPSHOT_OBJECT, MaximoQuery);
    registerSnapshotProbe('messages', MESSAGE_SNAPSHOT_OBJECT, MaximoMessage);
    registerSnapshotProbe('properties', PROPERTY_SNAPSHOT_OBJECT, MaximoProperty);
    registerSnapshotProbe('loggers', LOGGER_SNAPSHOT_OBJECT, MaximoLogger);
    registerSnapshotProbe('actions', ACTION_SNAPSHOT_OBJECT, MaximoAction);
    registerSnapshotProbe('escalations', ESCALATION_SNAPSHOT_OBJECT, MaximoEscalation);
    registerSnapshotProbe('objects', OBJECT_SNAPSHOT_OBJECT, MaximoObject);
    registerSnapshotProbe('integrationObjects', INTEGRATION_OBJECT_SNAPSHOT_OBJECT, MaximoIntegrationObject);
    registerSnapshotProbe('endPoints', END_POINT_SNAPSHOT_OBJECT, MaximoEndPoint);
    registerSnapshotProbe('publishChannels', PUBLISH_CHANNEL_SNAPSHOT_OBJECT, MaximoPublishChannel);
    registerSnapshotProbe('enterpriseServices', ENTERPRISE_SERVICE_SNAPSHOT_OBJECT, MaximoEnterpriseService);
    registerSnapshotProbe('externalSystems', EXTERNAL_SYSTEM_SNAPSHOT_OBJECT, MaximoExternalSystem);
}

function isJsonPayload(value: string): boolean {
    return value.charAt(0) === '{' || value.charAt(0) === '[';
}

function registerHandler(type: string, model: new (input: any) => any, process: (record: any) => void, prepare?: (records: any[]) => void): void {
    handlers[type] = { model: model, process: process, prepare: prepare };
}

function registerSnapshotProbe(type: string, objectName: string, model: new (input: any) => any): void {
    snapshotProbes[type] = { objectName: objectName, model: model };
}

/**
 * The leftover snapshots the given payload would silently prefer over the live records.
 * See docs/modules/nashorn-library.md.
 */
function listLeftoverSnapshots(payload: RequestPayload): any[] {
    const found: any[] = [];
    if (!payload) {
        return found;
    }

    Object.keys(payload).forEach(function (type: string): void {
        const probe = Object.prototype.hasOwnProperty.call(snapshotProbes, type) ? snapshotProbes[type] : null;
        const items = payload[type];
        if (!probe || !Array.isArray(items)) {
            return;
        }

        items.forEach(function (item: any): void {
            // A delete discards the snapshot rather than applying it, so it is never stale.
            if (!item || item._delete) {
                return;
            }

            let record: any;
            try {
                record = new probe.model(item);
            } catch (error) {
                // The deployment itself reports the invalid entry.
                return;
            }
            if (!hasRetainDeclarations(record)) {
                return;
            }

            const identity = retainIdentityOf(record);
            const described = describeSnapshot(snapshotKey(probe.objectName, identity));
            if (described) {
                found.push({
                    key: described.key,
                    type: type,
                    object: probe.objectName,
                    identity: identity,
                    capturedOn: described.capturedOn
                });
            }
        });
    });

    return found;
}

function discardSnapshots(keys: any): number {
    if (!Array.isArray(keys)) {
        throw Error('A snapshot discard request must carry a "keys" array.');
    }

    keys.forEach(function (key: any): void {
        // The keys arrive from the client, and deleting is unconditional, so anything outside the
        // snapshot namespace would be some other document.
        if (!isSnapshotKey(String(key))) {
            throw Error('"' + String(key) + '" does not name a retained values snapshot.');
        }

        deleteSnapshot(String(key));
    });

    return keys.length;
}

/**
 * Answers the snapshot pre-flight of NAVIAM.AUTOSCRIPT.DEPLOY, a JSON request in and a JSON answer
 * out. See docs/modules/nashorn-library.md.
 */
function handleSnapshotRequest(request: string): string {
    registerSnapshotProbes();

    const parsed = JSON.parse(request);
    if (parsed.action === 'list') {
        return JSON.stringify({ status: 'ok', snapshots: listLeftoverSnapshots(parsed.payload) });
    }
    if (parsed.action === 'discard') {
        return JSON.stringify({ status: 'ok', discarded: discardSnapshots(parsed.keys) });
    }
    throw Error('Unsupported retained values snapshot action "' + parsed.action + '".');
}

function getErrorMessage(error: any): string {
    if (error && typeof error.message !== 'undefined') {
        return String(error.message);
    }

    return String(error);
}

function isJavaException(error: any): boolean {
    return error instanceof Java.type('java.lang.Exception');
}

/**
 * Builds every entry, then prepares every type, before applying any, so an entry its model or its
 * type's prepare rejects fails the deployment before Maximo is changed. See docs/modules/nashorn-library.md.
 */
function processPayload(payload: RequestPayload, registry: HandlerRegistry): void {
    const built: { handler: Handler; records: any[] }[] = [];
    Object.keys(payload).forEach(function (type: string): void {
        const handler = registry[type];
        if (!handler) {
            return;
        }

        const items = payload[type];
        if (!Array.isArray(items)) {
            throw Error('The request body type "' + type + '" must be an array.');
        }

        built.push({
            handler: handler,
            records: items.map(function (item: any): any {
                return new handler.model(item);
            })
        });
    });

    built.forEach(function (entry): void {
        if (entry.handler.prepare) {
            entry.handler.prepare(entry.records);
        }
    });

    built.forEach(function (entry): void {
        entry.records.forEach(entry.handler.process);
    });
}

var scriptConfig = {
    autoscript: 'NAVIAM.AUTOSCRIPT.LIBRARY',
    description: 'Naviam Library Script',
    version: '1.0.0',
    active: true,
    logLevel: 'ERROR'
};

runFromRequestBody();

/** Shared with the other Naviam scripts, which read it from the NaviamAutoscriptLibrary global after running this script. */
export default {
    applyOptionalValues: applyOptionalValues,
    applyValues: applyValues,
    deployPresentationXml: deployPresentationXml,
    handleSnapshotRequest: handleSnapshotRequest,
    toExternalSynonymValue: toExternalSynonymValue,
    toInternalSynonymValue: toInternalSynonymValue
};
