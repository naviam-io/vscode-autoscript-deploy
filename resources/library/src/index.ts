/// <reference path="../globals.d.ts" />
/// <reference path="../manage-facade.d.ts" />
/// <reference path="../manage.d.ts" />

import { configureSse, updateError } from './core/util';
import { hasRetainDeclarations, retainIdentityOf } from './core/retained-values';
import { deleteSnapshot, describeSnapshot, isSnapshotKey, snapshotKey } from './core/snapshot-store';
import { MaximoProperty, process as processProperty } from './config/properties';
import { MaximoMessage, process as processMessage } from './config/messages';
import { MaximoLogger, process as processLogger } from './config/loggers';
import { MaximoDomain, process as processDomain, SNAPSHOT_OBJECT as DOMAIN_SNAPSHOT_OBJECT } from './config/domains';
import { MaximoCronTask, process as processCronTask, SNAPSHOT_OBJECT as CRON_TASK_SNAPSHOT_OBJECT } from './config/cron-tasks';
import { MaximoIntegrationObject, process as processIntegrationObject } from './config/integration-objects';
import { MaximoAction, process as processAction } from './config/actions';
import { MaximoEscalation, process as processEscalation } from './config/escalations';
import { MaximoQuery, process as processQuery } from './config/queries';
import { MaximoObject, process as processObject } from './config/objects';

type Handler = (item: any) => void;
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
        processPayload(config);
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
    registerHandler('properties', function (item: any): void {
        processProperty(new MaximoProperty(item));
    });

    registerHandler('messages', function (item: any): void {
        processMessage(new MaximoMessage(item));
    });

    registerHandler('loggers', function (item: any): void {
        processLogger(new MaximoLogger(item));
    });

    registerHandler('domains', function (item: any): void {
        processDomain(new MaximoDomain(item));
    });

    registerHandler('cronTasks', function (item: any): void {
        processCronTask(new MaximoCronTask(item));
    });

    registerHandler('integrationObjects', function (item: any): void {
        processIntegrationObject(new MaximoIntegrationObject(item));
    });

    registerHandler('actions', function (item: any): void {
        processAction(new MaximoAction(item));
    });

    registerHandler('escalations', function (item: any): void {
        processEscalation(new MaximoEscalation(item));
    });

    registerHandler('queries', function (item: any): void {
        processQuery(new MaximoQuery(item));
    });

    registerHandler('objects', function (item: any): void {
        processObject(new MaximoObject(item));
    });
}

/** Only the snapshot pre-flight needs these, so a deployment does not pay for them. */
function registerSnapshotProbes(): void {
    registerSnapshotProbe('domains', DOMAIN_SNAPSHOT_OBJECT, MaximoDomain);
    registerSnapshotProbe('cronTasks', CRON_TASK_SNAPSHOT_OBJECT, MaximoCronTask);
}

function isJsonPayload(value: string): boolean {
    return value.charAt(0) === '{' || value.charAt(0) === '[';
}

function registerHandler(type: string, handler: Handler): void {
    handlers[type] = handler;
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

            const record = new probe.model(item);
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

/** Answers the snapshot pre-flight NAVIAM.AUTOSCRIPT.DEPLOY passes in, and reports whether it did,
 * so an ordinary deployment is unaffected. See docs/modules/nashorn-library.md. */
function runSnapshotRequest(): boolean {
    if (typeof snapshotRequest === 'undefined' || snapshotRequest === null || typeof snapshotRequest !== 'string') {
        return false;
    }

    registerSnapshotProbes();

    const parsed = JSON.parse(snapshotRequest);

    // A property of global rather than a bare assignment, which this bundle's strict mode rejects.
    if (parsed.action === 'list') {
        global.snapshotResult = JSON.stringify({ status: 'ok', snapshots: listLeftoverSnapshots(parsed.payload) });
    } else if (parsed.action === 'discard') {
        global.snapshotResult = JSON.stringify({ status: 'ok', discarded: discardSnapshots(parsed.keys) });
    } else {
        throw Error('Unsupported retained values snapshot action "' + parsed.action + '".');
    }

    return true;
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

function processPayload(payload: RequestPayload): void {
    Object.keys(payload).forEach(function (type: string): void {
        const handler = handlers[type];
        if (!handler) {
            return;
        }

        const items = payload[type];
        if (!Array.isArray(items)) {
            throw Error('The request body type "' + type + '" must be an array.');
        }

        items.forEach(function (item: any): void {
            handler(item);
        });
    });
}

var scriptConfig = {
    autoscript: 'NAVIAM.AUTOSCRIPT.LIBRARY',
    description: 'Naviam Library Script',
    version: '1.0.0',
    active: true,
    logLevel: 'ERROR'
};

if (!runSnapshotRequest()) {
    runFromRequestBody();
}
