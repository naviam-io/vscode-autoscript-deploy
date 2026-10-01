var MXServerType = Java.type('psdi.server.MXServer');

export function close(mboSet: any): void {
    if (mboSet && mboSet instanceof Java.type('psdi.mbo.MboSet')) {
        try {
            mboSet.cleanup();
            mboSet.close();
        } catch (ignored) {
        }
    }
}

export function valueOrDefault<T>(value: T | undefined, defaultValue: T): T {
    return typeof value === 'undefined' ? defaultValue : value;
}

let sseOutput: any = null;
let reportedMissing: Record<string, boolean> = {};

export function configureSse(requestContext?: any): void {
    reportedMissing = {};
    if (!requestContext || typeof requestContext.getHttpServletResponse !== 'function') {
        return;
    }

    const response = requestContext.getHttpServletResponse();
    sseOutput = response.getOutputStream();
    response.setBufferSize(0);
    response.setContentType('text/event-stream');
    response.addHeader('Connection', 'keep-alive');
    response.addHeader('Cache-Control', 'no-cache');
    response.addHeader('X-Accel-Buffering', 'no');
    response.setHeader('Content-Encoding', 'none');
    response.flushBuffer();
}

export function updateProgress(message: string): void {
    writeServerSentEvent('progress', message, 500);
}

export function updateError(message: string): void {
    writeServerSentEvent('error', message, 5000);
}

export function updateWarning(message: string): void {
    writeServerSentEvent('warning', message, 5000);
}

export function updateInfo(message: string): void {
    writeServerSentEvent('info', message, 0);
}

function writeServerSentEvent(event: string, message: string, sleepMillis: number): void {
    if (!sseOutput || !message) {
        return;
    }

    const JavaString = Java.type('java.lang.String');
    const System = Java.type('java.lang.System');
    const Thread = Java.type('java.lang.Thread');
    const payload = 'id: ' + System.currentTimeMillis() + '\n' + 'event: ' + event + '\n' + 'data: ' + message + '\n\n';

    sseOutput.write(new JavaString(payload).getBytes('UTF-8'));
    sseOutput.flush();
    Thread.sleep(sleepMillis);
}

export function hasAttribute(mbo: psdi.mbo.MboRemote, field: string): boolean {
    const objectName = mbo.getName();
    if (MXServerType.getMXServer().getMaximoDD().getMboSetInfo(objectName).getMboValueInfo(field) != null) {
        return true;
    }

    const key = objectName + '.' + field;
    if (!reportedMissing[key]) {
        reportedMissing[key] = true;
        updateInfo('Skipped ' + key + ', the attribute does not exist in this Maximo version.');
    }
    return false;
}

export function setValue(mbo: psdi.mbo.MboRemote, field: string, value: any, accessModifier?: any): void {
    if (typeof value === 'undefined') {
        return;
    }

    if (!hasAttribute(mbo, field)) {
        return;
    }

    if (value === null) {
        if (typeof accessModifier !== 'undefined') {
            mbo.setValueNull(field, accessModifier);
        } else {
            mbo.setValueNull(field);
        }
        return;
    }

    if (typeof accessModifier !== 'undefined') {
        mbo.setValue(field, value, accessModifier);
    } else {
        mbo.setValue(field, value);
    }
}

export function applyValues(mbo: psdi.mbo.MboRemote, updates: Array<[string, any]>): void {
    updates.forEach(function (update) {
        setValue(mbo, update[0], update[1]);
    });
}

export function applyWritableValues(mbo: psdi.mbo.MboRemote, updates: Array<[string, any]>): void {
    updates.forEach(function (update) {
        if (isWritable(mbo, update[0])) {
            setValue(mbo, update[0], update[1]);
        }
    });
}

export function applyOptionalWritableValues(mbo: psdi.mbo.MboRemote, updates: Array<[string, any]>): void {
    updates.forEach(function (update) {
        if (update[1] !== null && typeof update[1] !== 'undefined' && isWritable(mbo, update[0])) {
            setValue(mbo, update[0], update[1]);
        }
    });
}

export function applyOptionalValues(mbo: psdi.mbo.MboRemote, updates: Array<[string, any]>): void {
    updates.forEach(function (update) {
        if (update[1] !== null) {
            setValue(mbo, update[0], update[1]);
        }
    });
}

export function isWritable(mbo: psdi.mbo.MboRemote, field: string): boolean {
    return hasAttribute(mbo, field) && !(mbo as any).getMboValue(field).isReadOnly();
}

/**
 * Translates an internal (language independent) synonym domain value into the external value expected by
 * the Maximo value list of the target environment. Required because synonym domain values are stored and
 * validated using the localized external value, which differs from the internal value in non-English base
 * language environments.
 */
export function toExternalSynonymValue(domainId: string, value: any, mbo?: psdi.mbo.MboRemote): any {
    if (value === null || typeof value === 'undefined') {
        return value;
    }

    const internalValue = String(value);
    const translator = MXServerType.getMXServer().getMaximoDD().getTranslator();
    const external = mbo ? translator.toExternalDefaultValue(domainId, internalValue, mbo) : translator.toExternalDefaultValue(domainId, internalValue);

    return external === null || typeof external === 'undefined' ? internalValue : String(external);
}
