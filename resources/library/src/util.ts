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

export function configureSse(requestContext?: any): void {
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

export function setValue(mbo: psdi.mbo.MboRemote, field: string, value: any, accessModifier?: any): void {
    if (typeof value === 'undefined') {
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
    return !(mbo as any).getMboValue(field).isReadOnly();
}
