// @ts-nocheck
export class MaximoError extends Error {
    constructor(message, reasonCode, statusCode) {
        super();
        this.reasonCode = reasonCode;
        this.statusCode = statusCode;
        this.message = message;
    }
}

export class LoginFailedError extends MaximoError {
    constructor(message, reasonCode, statusCode) {
        super(message, reasonCode, statusCode);
    }
}

/**
 * Whether Maximo refused the credentials themselves, as opposed to a connection or server failure,
 * so they must not be tried again unchanged.
 */
export function isLoginRejection(error) {
    return error instanceof LoginFailedError || error?.reasonCode === 'BMXAA0021E' || error?.response?.status === 401;
}

export class PasswordExpiredError extends MaximoError {
    constructor(message, reasonCode, statusCode) {
        super(message, reasonCode, statusCode);
    }
}

export class PasswordResetFailedError extends MaximoError {
    constructor(message, reasonCode, statusCode) {
        super(message, reasonCode, statusCode);
    }
}

export class MxAccessError extends MaximoError {
    constructor(message, reasonCode, statusCode) {
        super(message, reasonCode, statusCode);
    }
}

export class ResourceNotFoundError extends MaximoError {
    constructor(message, reasonCode, statusCode) {
        super(message, reasonCode, statusCode);
    }
}

export class InvalidApiKeyError extends MaximoError {
    constructor(message, reasonCode, statusCode) {
        super(message, reasonCode, statusCode);
    }
}

export class MxAdminLogoutError extends MaximoError {
    constructor(message, reasonCode, statusCode) {
        super(message, reasonCode, statusCode);
    }
}

export class MxDuplicateTransactionError extends MaximoError {
    constructor(message, reasonCode, statusCode, requestUri, transcationId) {
        super(message, reasonCode, statusCode);
        this.requestUri = requestUri;
        this.transcationId = transcationId;
    }
}
