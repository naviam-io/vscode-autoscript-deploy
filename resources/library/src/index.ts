/// <reference path="../globals.d.ts" />
/// <reference path="../manage-facade.d.ts" />
/// <reference path="../manage.d.ts" />

import { configureSse, updateError } from './util';
import { MaximoProperty, process as processProperty } from './properties';
import { MaximoMessage, process as processMessage } from './messages';
import { MaximoLogger, process as processLogger } from './loggers';
import { MaximoDomain, process as processDomain } from './domains';
import { MaximoCronTask, process as processCronTask } from './cron-tasks';
import { MaximoIntegrationObject, process as processIntegrationObject } from './integration-objects';
import { MaximoAction, process as processAction } from './actions';
import { MaximoEscalation, process as processEscalation } from './escalations';
import { MaximoQuery, process as processQuery } from './queries';

type Handler = (item: any) => void;
type HandlerRegistry = Record<string, Handler>;
type RequestPayload = Record<string, unknown>;

const handlers: HandlerRegistry = {};

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
}

function isJsonPayload(value: string): boolean {
    return value.charAt(0) === '{' || value.charAt(0) === '[';
}

function registerHandler(type: string, handler: Handler): void {
    handlers[type] = handler;
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

runFromRequestBody();
