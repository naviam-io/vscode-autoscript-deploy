declare module com {
    export module ibm {
        export module tivoli {
            export module maximo {
                export module oslc {
                    export module provider {
                        export class OslcRequest {
                            public static resurrectRequest(req: any): com.ibm.tivoli.maximo.oslc.provider.OslcRequest;
                            public getAbsolutePath(): string[];
                            public getAbsoluteURI(): string;
                            public getApiKey(): string;
                            public getApps(): string;
                            public getContentLocationHeader(): string;
                            public getDistinctClause(): string;
                            public getGBFilter(): string;
                            public getMetricContext(): string;
                            public getOslcRequestURI(): string;
                            public getQbeFilter(): string;
                            public getQueryTemplate(): string;
                            public getSavedQueryParams(): Record<string, string>;
                            public getSchemaSearchTerm(): string;
                            public getSelfRef(): string;
                            public getTimeLineAttribute(): string;
                            public getTimeLineRange(): string;
                            public getUserInfo(): psdi.security.UserInfo;
                            public internalValues(): boolean;
                            public invalidateSession(): void;
                            public invlaidateSession(): void;
                            public isAction(): boolean;
                            public isAddLocalizedRep(): boolean;
                            public isAllowSelfRefDup(): boolean;
                            public isAsyncRequest(): boolean;
                            public isBatchError(): boolean;
                            public isCount(): boolean;
                            public isCsrfSession(): boolean;
                            public isDropNulls(): boolean;
                            public isEditMode(): boolean;
                            public isFileLoad(): boolean;
                            public isGETByPOST(): boolean;
                            public isIgnoreRowstamp(): boolean;
                            public isInlineDoc(): boolean;
                            public isLeanJSON(): boolean;
                            public isLocalizedDate(): boolean;
                            public isMaxSSO(): boolean;
                            public isRangeRequest(): boolean;
                            public isRegUserSession(): boolean;
                            public isRelatedRef(): boolean;
                            public isSetLocalizedRep(): boolean;
                            public isShowHidden(): boolean;
                            public isWhoAmIApi(): boolean;
                            public replaceIDToURI(id: string): void;
                            public setProcessUserInfo(processUserInfo: psdi.security.UserInfo): void;
                        }
                    }
                }
            }
        }
    }
}

declare var service: com.ibm.tivoli.maximo.script.ScriptService;
declare var mbo: psdi.mbo.MboRemote;
declare var mboSet: psdi.mbo.MboSetRemote;
declare var mboset: psdi.mbo.MboSetRemote;
declare var app: string;
declare var domainid: string;
declare var errorgroup: string;
declare var errorkey: string;
declare var evalresult: boolean;
declare var interactive: boolean;
declare var launchPoint: string;
declare var listErrorGroup: string;
declare var listErrorKey: string;
declare var listOrder: string;
declare var listWhere: string;
declare var mboname: string;
declare var mbovalue: psdi.mbo.MboValue;
declare var onadd: boolean;
declare var ondelete: boolean;
declare var onupdate: boolean;
declare var params: string[];
declare var relationObject: string;
declare var relationWhere: string;
declare var scriptHome: psdi.mbo.MboRemote;
declare var scriptName: string;
declare var srcKeys: string[];
declare var thisvalue: psdi.mbo.MboValue;
declare var targetKeys: string[];
declare var user: string;
declare var userInfo: psdi.security.UserInfo;
declare var wfinstance: any;
declare var request: com.ibm.tivoli.maximo.oslc.provider.OslcRequest;
declare var action: string;
declare var requestBody: string;
declare var httpMethod: string;
declare var responseBody: string;
declare var responseHeaders: java.util.Map<string, string>;
