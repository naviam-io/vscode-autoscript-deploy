// @ts-nocheck
export default class ServerSourceProvider {
    constructor(sourceMap) {
        this.sourceMap = sourceMap;
    }
    provideTextDocumentContent(uri, token) {
        let source = this.sourceMap[uri.path];
        this.sourceMap.delete(uri.path);
        return source;
    }
}
