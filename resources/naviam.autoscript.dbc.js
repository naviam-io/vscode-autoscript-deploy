/* eslint-disable indent */
// @ts-nocheck
/* eslint-disable no-undef */

var JavaString = Java.type('java.lang.String');
var HashMap = Java.type('java.util.HashMap');
var ArrayList = Java.type('java.util.ArrayList');

var SQLConverter = Java.type('psdi.iface.util.SQLConverter');
var SQLConverterUtil = Java.type('psdi.iface.util.SQLConverterUtil');
var MXServer = Java.type('psdi.server.MXServer');

var MboConstants = Java.type('psdi.mbo.MboConstants');
var SqlFormat = Java.type('psdi.mbo.SqlFormat');

main();

function main() {
    if (typeof request !== 'undefined' && request !== null) {
        checkPermissions('NAVIAM_UTILS', 'DEPLOYSCRIPT');

        var response = {
            status: 'success',
        };

        try {
            var action = request.getQueryParam('action');
            var source = request.getQueryParam('source');

            if (action != null && source != null) {
                if (action == 'dbc') {
                    var requestBody = new JavaString(request.readRequestBody(), 'utf-8');
                    if (requestBody != null) {
                        var json = JSON.parse(requestBody);
                        if (json) {
                            var name = json.name;
                            if (typeof name === 'undefined' || name == null) {
                                response.status = 'error';
                                response.message = 'Required name parameter is missing for action "dbc"';
                                return;
                            }

                            var adddelete = json.adddelete;
                            if (typeof adddelete === 'undefined' || adddelete == null) {
                                adddelete = 'true';
                            } else {
                                if ('false' == adddelete.toLowerCase() || '0' == adddelete) {
                                    adddelete = 'false';
                                } else {
                                    adddelete = 'true';
                                }
                            }

                            var fileName = json.filename;
                            if (typeof fileName === 'undefined' || fileName == null) {
                                fileName = 'export.dbc';
                            }

                            var description = null;
                            if (json.description != null && json.description.length > 0) {
                                description = json.description;
                            }

                            if (source !== 'prop' && source !== 'object' && source !== 'msg' && source !== 'attribute' && typeof json.type === 'undefined') {
                                var params = new HashMap();

                                params.put('source', Java.to([source], 'java.lang.String[]'));
                                params.put('name', Java.to([name], 'java.lang.String[]'));
                                params.put('adddelete', Java.to([adddelete], 'java.lang.String[]'));
                                params.put('filename', Java.to([fileName], 'java.lang.String[]'));

                                if (source === 'es' || source === 'pc') {
                                    var extsysname = json.extsystem;
                                    if (typeof extsysname !== 'undefined' || extsysname !== null) {
                                        params.put('extsysname', Java.to([extsysname], 'java.lang.String[]'));
                                    }
                                }

                                if ((source == 'table' || source == 'byos') && typeof json.where !== 'undefined' && json.where != null) {
                                    params.put('where', Java.to([json.where], 'java.lang.String[]'));
                                }

                                if (source === 'byos' && params.get('where') == null) {
                                    response.status = 'error';
                                    response.message = 'The "where" parameter is required when source is "byos"';
                                    return;
                                }

                                var data = convert(params);
                                if (fileName.endsWith('.dbc')) {
                                    response.data = updateMetaData(data, description, fileName);
                                } else {
                                    response.data = data;
                                }
                            } else if (source === 'msg') {
                                if (json.ids && json.ids.length > 0) {
                                    response.data = getMessages(name, fileName, json.ids, adddelete);
                                } else {
                                    response.status = 'error';
                                    response.message = 'Required ids parameter is missing for action "dbc" with source "msg"';
                                    return;
                                }
                            } else if (source === 'prop') {
                                response.data = getProperties(name, fileName, adddelete);
                            } else if (source === 'object') {
                                response.data = getObjects(name, fileName, description);
                            } else if (source === 'attribute') {
                                if (json.ids && json.ids.length > 0) {
                                    response.data = getAttributes(fileName, json.ids, name);
                                } else {
                                    response.status = 'error';
                                    response.message = 'Required ids parameter is missing for action "dbc" with source "attribute"';
                                    return;
                                }
                            } else {
                                response.status = 'error';
                                response.message = 'Unsupported source for dbc action: ' + source;
                            }
                        } else {
                            response.status = 'error';
                            response.message = 'Required type parameter is missing in request body';
                        }
                    } else {
                        response.status = 'error';
                        response.message = 'Invalid JSON format in request body';
                    }
                } else if (action == 'list') {
                    if (source != null) {
                        source = source.toLowerCase();
                        switch (source) {
                            case 'script':
                                response.data = getNames('autoscript', 'autoscript', 'description');
                                break;
                            case 'os':
                                response.data = getNames('maxintobject', 'intobjectname', 'description');
                                break;
                            case 'byos':
                                response.data = getNames('maxintobject', 'intobjectname', 'description');
                                break;
                            case 'table':
                                response.data = getNames('maxobject', 'objectname', 'description');
                                break;
                            case 'pc':
                                response.data = getNames('maxextifaceout', 'ifacename', 'maxifaceout.description', true);
                                break;
                            case 'es':
                                response.data = getNames('maxextifacein', 'ifacename', 'maxifacein.description', true);
                                break;
                            case 'ic':
                                response.data = getNames('maxifaceinvoke', 'ifacename', 'description');
                                break;
                            case 'ws':
                                response.data = getNames('maxwsregistry', 'wsname', 'description');
                                break;
                            case 'ep':
                                response.data = getNames('maxendpoint', 'endpointname', 'description');
                                break;
                            case 'ex':
                                response.data = getNames('maxextsystem', 'extsysname', 'description');
                                break;
                            case 'int':
                                response.data = getNames('maxinteraction', 'interaction', 'description');
                                break;
                            case 'prop':
                                response.data = getNames('maxprop', 'propname', 'description');
                                break;
                            case 'attribute':
                                var objectName = request.getQueryParam('objectname');
                                if (typeof objectName === 'undefined' || objectName == null) {
                                    response.status = 'error';
                                    response.message = 'Required query parameter "objectname" is missing in request for attribute list';
                                    return;
                                } else {
                                    response.data = getAttributeNames(objectName);
                                }
                                break;
                            case 'msg':
                                response.data = getMessageNames();
                                break;
                            case 'object':
                                response.data = getNames('maxobject', 'objectname', 'description');
                                break;
                            default:
                                response.status = 'error';
                                response.message = 'Unsupported type for list action: ' + source;
                                break;
                        }
                    } else {
                        response.status = 'error';
                        response.message = 'Required query parameter "type" is missing in request';
                    }
                } else {
                    response.status = 'error';
                    response.message = 'Unsupported action: ' + action;
                }
            } else {
                response.status = 'error';
                response.message = 'Required action parameter or source parameter is missing in request';
            }
        } catch (error) {
            response.status = 'error';
            response.message = error.message;
            if (typeof error.printStackTrace === 'function') {
                error.printStackTrace();
            }
        } finally {
            responseBody = JSON.stringify(response);
        }
    }
}

function getObjects(name, fileName, description) {
    // Get a reference to the database manager
    var dbManager = MXServer.getMXServer().getDBManager();
    try {
        // Get a reference to user's ConnectionKey
        var connectionKey = userInfo.getConnectionKey();
        // Use the ConnectionKey to get a java.sql.Connection
        var connection = dbManager.getConnection(connectionKey);

        var converterUtil = new SQLConverterUtil(connection, Java.type('java.lang.System').out, null);

        var names = name.split(',');

        // MAS removed support for legacy JDOM, switch to JDOM2 and then fall back to legacy JDOM for older versions.
        try {
            // eslint-disable-next-line no-global-assign
            Document = Java.type('org.jdom2.Document');
            // eslint-disable-next-line no-global-assign
            Element = Java.type('org.jdom2.Element');
            SAXBuilder = Java.type('org.jdom2.input.SAXBuilder');
            Format = Java.type('org.jdom2.output.Format');
            XMLOutputter = Java.type('org.jdom2.output.XMLOutputter');
            DocType = Java.type('org.jdom2.DocType');
        } catch (error) {
            if (error instanceof Java.type('java.lang.ClassNotFoundException') || error instanceof Java.type('java.lang.RuntimeException')) {
                // eslint-disable-next-line no-global-assign
                Element = Java.type('org.jdom.Element');
                // eslint-disable-next-line no-global-assign
                Document = Java.type('org.jdom.Document');
                SAXBuilder = Java.type('org.jdom.input.SAXBuilder');
                Format = Java.type('org.jdom.output.Format');
                XMLOutputter = Java.type('org.jdom.output.XMLOutputter');
                DocType = Java.type('org.jdom.DocType');
            } else {
                // if some other error is occurring throw the error to the user.
                throw error;
            }
        }

        var script = new Element('script');
        script.setAttribute('author', userInfo.getDisplayName());
        script.setAttribute('scriptname', fileName);
        var descriptionElement = new Element('description');
        descriptionElement.setText(description || 'Create objects ' + name);
        script.addContent(descriptionElement);

        var statements = new Element('statements');
        script.addContent(statements);

        var rootList = new ArrayList();

        names.forEach(function (objectName) {
            var objectSet = MXServer.getMXServer().getMboSet('MAXOBJECTCFG', userInfo);
            try {
                var sqlf = new SqlFormat('OBJECTNAME =:1');
                sqlf.setObject(1, 'MAXOBJECT', 'OBJECTNAME', objectName);

                objectSet.setWhere(sqlf.format());

                var maxObject = objectSet.moveFirst();
                if (maxObject) {
                    converterUtil.buildDefaineTableDBC(objectName, maxObject.getBoolean('MAINOBJECT'), rootList, false);
                }

                getIndexes(maxObject, rootList);
                getRelationships(maxObject, rootList);
            } finally {
                _close(objectSet);
            }
        });

        rootList.forEach(function (item) {
            statements.addContent(item);
        });

        // Create DocType and Document with DOCTYPE
        var docType = new DocType('script', 'script.dtd');
        var dbcScript = new Document(script, docType);

        var builder = new SAXBuilder();
        builder.setValidation(false);
        builder.setFeature('http://apache.org/xml/features/nonvalidating/load-external-dtd', false);

        var StringWriter = Java.type('java.io.StringWriter');
        var outputter = new XMLOutputter(Format.getPrettyFormat());
        var writer = new StringWriter();
        outputter.output(dbcScript, writer);
        return writer.toString();
    } finally {
        dbManager.freeConnection(connectionKey);
    }
}

function getIndexes(mbo, list) {
    if (mbo && mbo instanceof Java.type('psdi.mbo.Mbo') && mbo.isBasedOn('MAXOBJECTCFG')) {
        var indexSet = mbo.getMboSet('MAXSYSINDEXES');
        while (indexSet.moveNext()) {
            var index = indexSet.getMbo();
            var indexElement = new Element('specify_index');

            indexElement.setAttribute('object', mbo.getString('OBJECTNAME'));
            indexElement.setAttribute('name', index.getString('NAME'));
            indexElement.setAttribute('unique', index.getBoolean('UNIQUE'));
            if (index.getBoolean('CLUSTERRULE')) {
                indexElement.setAttribute('clustered', 'true');
            }

            if (index.getBoolean('REQUIRED')) {
                indexElement.setAttribute('required', 'true');
            }

            var keySet = index.getMboSet('MAXSYSKEYS');
            while (keySet.moveNext()) {
                var key = keySet.getMbo();
                var keyElement = new Element('indexkey');
                keyElement.setAttribute('column', key.getString('COLNAME'));
                if (key.getBoolean('ASCENDING')) {
                    keyElement.setAttribute('ascending', 'true');
                }
                indexElement.addContent(keyElement);
            }

            list.add(indexElement);
        }
    }
}

function getRelationships(mbo, list) {
    if (mbo && mbo instanceof Java.type('psdi.mbo.Mbo') && mbo.isBasedOn('MAXOBJECTCFG')) {
        var relationshipSet = mbo.getMboSet('MAXRELATIONSHIP');
        while (relationshipSet.moveNext()) {
            var relationship = relationshipSet.getMbo();
            var relationshipElement = new Element('create_relationship');

            relationshipElement.setAttribute('name', relationship.getString('NAME'));
            relationshipElement.setAttribute('parent', mbo.getString('OBJECTNAME'));
            relationshipElement.setAttribute('child', relationship.getString('CHILD'));

            relationshipElement.setAttribute('whereclause', relationship.getString('WHERECLAUSE'));
            if (!relationship.isNull('REMARKS')) {
                relationshipElement.setAttribute('remarks', 'true');
            }

            if (relationship.getBoolean('ISDEFAULT')) {
                relationshipElement.setAttribute('isdefault', 'true');
            }

            list.add(relationshipElement);
        }
    }
}

function getAttributes(fileName, ids, name) {
    var where = ids
        .split(',')
        .map(function (item) {
            return item.trim();
        })
        .join(',');
    // MAS removed support for legacy JDOM, switch to JDOM2 and then fall back to legacy JDOM for older versions.
    try {
        // eslint-disable-next-line no-global-assign
        Document = Java.type('org.jdom2.Document');
        // eslint-disable-next-line no-global-assign
        Element = Java.type('org.jdom2.Element');
        // eslint-disable-next-line no-global-assign
        Comment = Java.type('org.jdom2.Comment');
        SAXBuilder = Java.type('org.jdom2.input.SAXBuilder');
        Format = Java.type('org.jdom2.output.Format');
        XMLOutputter = Java.type('org.jdom2.output.XMLOutputter');
        DocType = Java.type('org.jdom2.DocType');
    } catch (error) {
        if (error instanceof Java.type('java.lang.ClassNotFoundException') || error instanceof Java.type('java.lang.RuntimeException')) {
            // eslint-disable-next-line no-global-assign
            Element = Java.type('org.jdom.Element');
            // eslint-disable-next-line no-global-assign
            Document = Java.type('org.jdom.Document');
            // eslint-disable-next-line no-global-assign
            Comment = Java.type('org.jdom.Comment');
            SAXBuilder = Java.type('org.jdom.input.SAXBuilder');
            Format = Java.type('org.jdom.output.Format');
            XMLOutputter = Java.type('org.jdom.output.XMLOutputter');
            DocType = Java.type('org.jdom.DocType');
        } else {
            // if some other error is occurring throw the error to the user.
            throw error;
        }
    }

    var maxAttributeCfgSet = MXServer.getMXServer().getMboSet('MAXATTRIBUTECFG', userInfo);
    try {
        var sqlf = new SqlFormat('maxattributeid in (' + where + ')');
        maxAttributeCfgSet.setWhere(sqlf.format());
        var addAttributeElement = new Element('add_attributes');
        var modify = new ArrayList();
        var objectName = '';
        while (maxAttributeCfgSet.moveNext()) {
            var attribute = maxAttributeCfgSet.getMbo();

            if (addAttributeElement.getAttributeValue('object') === null) {
                addAttributeElement.setAttribute('object', attribute.getString('OBJECTNAME'));
                objectName = attribute.getString('OBJECTNAME');
            }

            var modifyAttributeElement = new Element('modify_attribute');
            modifyAttributeElement.setAttribute('object', attribute.getString('OBJECTNAME'));
            modifyAttributeElement.setAttribute('attribute', attribute.getString('ATTRIBUTENAME'));
            modifyAttributeElement.setAttribute('title', attribute.getString('TITLE'));
            modifyAttributeElement.setAttribute('remarks', attribute.getString('REMARKS'));
            modifyAttributeElement.setAttribute('maxtype', attribute.getString('MAXTYPE'));
            modifyAttributeElement.setAttribute('length', attribute.getInt('LENGTH'));
            modifyAttributeElement.setAttribute('persistent', attribute.getBoolean('PERSISTENT'));
            modifyAttributeElement.setAttribute('haslongdesc', attribute.getBoolean('ISLDOWNER'));
            if (attribute.getBoolean('userdefined')) {
                modifyAttributeElement.setAttribute('userdefined', attribute.getBoolean('USERDEFINED'));
            }
            modifyAttributeElement.setAttribute('domain', attribute.getString('DOMAINID'));
            modifyAttributeElement.setAttribute('classname', attribute.getString('CLASSNAME'));
            modifyAttributeElement.setAttribute('defaultvalue', attribute.getString('DEFAULTVALUE'));
            modifyAttributeElement.setAttribute('sameasobject', attribute.getString('SAMEASOBJECT'));
            modifyAttributeElement.setAttribute('sameasattribute', attribute.getString('SAMEASATTRIBUTE'));
            modifyAttributeElement.setAttribute('mustbe', attribute.getBoolean('MUSTBE'));
            modifyAttributeElement.setAttribute('ispositive', attribute.getBoolean('ISPOSITIVE'));
            modifyAttributeElement.setAttribute('scale', attribute.getInt('SCALE'));
            modifyAttributeElement.setAttribute('autokey', attribute.getString('AUTOKEYNAME'));
            modifyAttributeElement.setAttribute('canautonum', attribute.getBoolean('CANAUTONUM'));
            modifyAttributeElement.setAttribute('searchtype', attribute.getString('SEARCHTYPE'));
            modifyAttributeElement.setAttribute('localizable', attribute.getBoolean('LOCALIZABLE'));

            var attrdefElement = new Element('attrdef');
            attrdefElement.setAttribute('attribute', attribute.getString('ATTRIBUTENAME'));
            attrdefElement.setAttribute('title', attribute.getString('TITLE'));
            attrdefElement.setAttribute('remarks', attribute.getString('REMARKS'));
            attrdefElement.setAttribute('maxtype', attribute.getString('MAXTYPE'));
            attrdefElement.setAttribute('persistent', attribute.getBoolean('PERSISTENT'));
            attrdefElement.setAttribute('length', attribute.getInt('LENGTH'));
            attrdefElement.setAttribute('haslongdesc', attribute.getBoolean('ISLDOWNER'));
            if (attribute.getBoolean('userdefined')) {
                attrdefElement.setAttribute('userdefined', attribute.getBoolean('USERDEFINED'));
            }
            attrdefElement.setAttribute('domain', attribute.getString('DOMAINID'));
            attrdefElement.setAttribute('classname', attribute.getString('CLASSNAME'));
            attrdefElement.setAttribute('defaultvalue', attribute.getString('DEFAULTVALUE'));
            attrdefElement.setAttribute('sameasobject', attribute.getString('SAMEASOBJECT'));
            attrdefElement.setAttribute('sameasattribute', attribute.getString('SAMEASATTRIBUTE'));
            attrdefElement.setAttribute('mustbe', attribute.getBoolean('MUSTBE'));
            attrdefElement.setAttribute('ispositive', attribute.getBoolean('ISPOSITIVE'));
            attrdefElement.setAttribute('scale', attribute.getInt('SCALE'));
            attrdefElement.setAttribute('autokey', attribute.getString('AUTOKEYNAME'));
            attrdefElement.setAttribute('canautonum', attribute.getBoolean('CANAUTONUM'));
            attrdefElement.setAttribute('searchtype', attribute.getString('SEARCHTYPE'));
            attrdefElement.setAttribute('localizable', attribute.getBoolean('LOCALIZABLE'));

            modify.add(modifyAttributeElement);
            addAttributeElement.addContent(attrdefElement);
        }

        var script = new Element('script');
        script.setAttribute('author', userInfo.getDisplayName());
        script.setAttribute('scriptname', fileName);
        var description = new Element('description');

        description.setText('Modify ' + objectName + ' attributes ' + name.split(',').join(', '));
        script.addContent(description);
        var statements = new Element('statements');
        // Create DocType and Document with DOCTYPE
        var docType = new DocType('script', 'script.dtd');

        var StringWriter = Java.type('java.io.StringWriter');
        var outputter = new XMLOutputter(Format.getPrettyFormat());
        var writer = new StringWriter();
        outputter.output(addAttributeElement, writer);

        var comment = new Comment(writer.toString());
        modify.forEach(function (item) {
            statements.addContent(item);
        });
        statements.addContent(comment);
        script.addContent(statements);

        var dbcScript = new Document(script, docType);
        writer.getBuffer().setLength(0);
        outputter.output(dbcScript, writer);
        return writer.toString();
    } finally {
        _close(maxAttributeCfgSet);
    }
}

function getMessages(name, fileName, msgIds, adddelete) {
    var where = msgIds
        .split(',')
        .map(function (item) {
            return item.trim();
        })
        .join(',');

    if (fileName.endsWith('.msg')) {
        // MAS removed support for legacy JDOM, switch to JDOM2 and then fall back to legacy JDOM for older versions.
        try {
            // eslint-disable-next-line no-global-assign
            Document = Java.type('org.jdom2.Document');
            // eslint-disable-next-line no-global-assign
            Element = Java.type('org.jdom2.Element');
            SAXBuilder = Java.type('org.jdom2.input.SAXBuilder');
            Format = Java.type('org.jdom2.output.Format');
            XMLOutputter = Java.type('org.jdom2.output.XMLOutputter');
            DocType = Java.type('org.jdom2.DocType');
        } catch (error) {
            if (error instanceof Java.type('java.lang.ClassNotFoundException') || error instanceof Java.type('java.lang.RuntimeException')) {
                // eslint-disable-next-line no-global-assign
                Element = Java.type('org.jdom.Element');
                // eslint-disable-next-line no-global-assign
                Document = Java.type('org.jdom.Document');
                SAXBuilder = Java.type('org.jdom.input.SAXBuilder');
                Format = Java.type('org.jdom.output.Format');
                XMLOutputter = Java.type('org.jdom.output.XMLOutputter');
                DocType = Java.type('org.jdom.DocType');
            } else {
                // if some other error is occurring throw the error to the user.
                throw error;
            }
        }

        var msgSet = MXServer.getMXServer().getMboSet('MAXMESSAGES', userInfo);
        try {
            var sqlf = new SqlFormat('maxmessagesid in (' + where + ')');

            msgSet.setWhere(sqlf.format());
            msgSet.setOrderBy('msggroup, msgkey');

            var messages = new Element('messages');
            messages.setAttribute('cleanup', 'false');

            while (msgSet.moveNext()) {
                mbo = msgSet.getMbo();

                var message = new Element('Message');
                message.setAttribute('id', mbo.getString('MSGID'));
                message.setAttribute('group', mbo.getString('MSGGROUP'));
                message.setAttribute('key', mbo.getString('MSGKEY'));
                message.setAttribute('prefix', mbo.getString('PREFIX'));

                var display = new Element('display');
                display.setAttribute('method', mbo.getString('DISPLAYMETHOD'));

                var option = new Element('option');
                if (mbo.getBoolean('OK')) {
                    option.setText('MSG_BTNOK');
                    display.addContent(option);
                }

                if (mbo.getBoolean('CLOSE')) {
                    option = new Element('option');
                    option.setText('MSG_BTNCLOSE');
                    display.addContent(option);
                }

                if (mbo.getBoolean('CANCEL')) {
                    option = new Element('option');
                    option.setText('MSG_BTNCANCEL');
                    display.addContent(option);
                }

                if (mbo.getBoolean('YES')) {
                    option = new Element('option');
                    option.setText('MSG_BTNYES');
                    display.addContent(option);
                }

                if (mbo.getBoolean('NO')) {
                    option = new Element('option');
                    option.setText('MSG_BTNNO');
                    display.addContent(option);
                }

                if (mbo.getString('MSGIDSUFFIX') == 'I') {
                    option = new Element('option');
                    option.setText('MSG_ICONWARNING');
                    display.addContent(option);
                }

                if (mbo.getString('MSGIDSUFFIX') == 'W') {
                    option = new Element('option');
                    option.setText('MSG_ICONEXCLAMATION');
                    display.addContent(option);
                }

                if (mbo.getString('MSGIDSUFFIX') == 'E') {
                    option = new Element('option');
                    option.setText('MSG_ICONSTOP');
                    display.addContent(option);
                }

                message.addContent(display);

                var msgText = new Element('MsgText');
                msgText.setText(mbo.getString('VALUE'));
                message.addContent(msgText);
                var explanation = new Element('Explanation');

                if (!mbo.isNull('EXPLANATION')) {
                    explanation.setText(mbo.getString('EXPLANATION'));
                }
                message.addContent(explanation);

                var adminResponse = new Element('AdminResponse');
                if (!mbo.isNull('ADMINRESPONSE')) {
                    adminResponse.setText(mbo.getString('ADMINRESPONSE'));
                }
                message.addContent(adminResponse);

                var operatorResponse = new Element('OperatorResponse');
                if (!mbo.isNull('OPERATORRESPONSE')) {
                    operatorResponse.setText(mbo.getString('OPERATORRESPONSE'));
                }
                message.addContent(operatorResponse);

                var systemAction = new Element('SystemAction');
                if (!mbo.isNull('SYSTEMACTION')) {
                    systemAction.setText(mbo.getString('SYSTEMACTION'));
                }
                message.addContent(systemAction);

                messages.addContent(message);
            }

            var messagesDocument = new Document(messages);

            var StringWriter = Java.type('java.io.StringWriter');
            var format = Format.getPrettyFormat();
            format.setExpandEmptyElements(true);
            var outputter = new XMLOutputter(format);

            var writer = new StringWriter();
            outputter.output(messagesDocument, writer);
            return writer.toString();
        } finally {
            _close(msgSet);
        }
    } else {
        var params = new HashMap();
        params.put('source', Java.to(['table'], 'java.lang.String[]'));
        params.put('name', Java.to(['MAXMESSAGES'], 'java.lang.String[]'));
        params.put('adddelete', Java.to([adddelete], 'java.lang.String[]'));
        params.put('filename', Java.to([fileName], 'java.lang.String[]'));
        params.put('where', Java.to(['maxmessagesid in (' + where + ')'], 'java.lang.String[]'));

        return convert(params);
    }
}

function getProperties(name, fileName, adddelete) {
    var params = new HashMap();

    var where = name
        .split(',')
        .map(function (item) {
            return "'" + item.trim() + "'";
        })
        .join(',');

    if (fileName.endsWith('.dbc')) {
        // MAS removed support for legacy JDOM, switch to JDOM2 and then fall back to legacy JDOM for older versions.
        try {
            // eslint-disable-next-line no-global-assign
            Document = Java.type('org.jdom2.Document');
            // eslint-disable-next-line no-global-assign
            Element = Java.type('org.jdom2.Element');
            SAXBuilder = Java.type('org.jdom2.input.SAXBuilder');
            Format = Java.type('org.jdom2.output.Format');
            XMLOutputter = Java.type('org.jdom2.output.XMLOutputter');
            DocType = Java.type('org.jdom2.DocType');
        } catch (error) {
            if (error instanceof Java.type('java.lang.ClassNotFoundException') || error instanceof Java.type('java.lang.RuntimeException')) {
                // eslint-disable-next-line no-global-assign
                Element = Java.type('org.jdom.Element');
                // eslint-disable-next-line no-global-assign
                Document = Java.type('org.jdom.Document');
                SAXBuilder = Java.type('org.jdom.input.SAXBuilder');
                Format = Java.type('org.jdom.output.Format');
                XMLOutputter = Java.type('org.jdom.output.XMLOutputter');
                DocType = Java.type('org.jdom.DocType');
            } else {
                // if some other error is occurring throw the error to the user.
                throw error;
            }
        }

        var propSet = MXServer.getMXServer().getMboSet('maxprop', userInfo);
        try {
            var sqlf = new SqlFormat('propname in (' + where + ')');

            propSet.setWhere(sqlf.format());
            propSet.setOrderBy('propname');

            var script = new Element('script');
            script.setAttribute('author', userInfo.getDisplayName());
            script.setAttribute('scriptname', fileName);
            var description = new Element('description');

            description.setText('Create properties ' + name);
            script.addContent(description);

            var statements = new Element('statements');
            script.addContent(statements);

            while (propSet.moveNext()) {
                mbo = propSet.getMbo();
                if (adddelete.toLowerCase() == 'true') {
                    var dropProperty = new Element('drop_property');
                    dropProperty.setAttribute('name', mbo.getString('PROPNAME'));
                    statements.addContent(dropProperty);
                }
                var addProperty = new Element('add_property');
                addProperty.setAttribute('name', mbo.getString('PROPNAME'));
                addProperty.setAttribute('description', mbo.getString('DESCRIPTION'));
                addProperty.setAttribute('maxtype', mbo.getString('MAXTYPE'));
                addProperty.setAttribute('secure_level', mbo.getString('SECURELEVEL').toLowerCase());

                if (mbo.getInt('ACCESSTYPE') != 2) {
                    addProperty.setAttribute('accesstype', mbo.getString('ACCESSTYPE'));
                }

                if (!mbo.isNull('MAXIMODEFAULT')) {
                    addProperty.setAttribute('default_value', mbo.getString('MAXIMODEFAULT'));
                }

                if (!mbo.isNull('DOMAINID')) {
                    addProperty.setAttribute('domainid', mbo.getString('DOMAINID'));
                }

                if (mbo.getBoolean('ENCRYPTED')) {
                    addProperty.setAttribute('encrypted', mbo.getBoolean('ENCRYPTED'));
                }

                if (!mbo.getBoolean('LIVEREFRESH')) {
                    addProperty.setAttribute('liverefresh', mbo.getBoolean('LIVEREFRESH'));
                }

                if (mbo.getBoolean('MASKED')) {
                    addProperty.setAttribute('masked', mbo.getBoolean('MASKED'));
                }

                if (!mbo.getBoolean('ONLINECHANGES')) {
                    addProperty.setAttribute('online_changes', mbo.getBoolean('ONLINECHANGES'));
                }

                if (mbo.getBoolean('GLOBALONLY')) {
                    addProperty.setAttribute('scope', 'global');
                } else if (mbo.getBoolean('INSTANCEONLY')) {
                    addProperty.setAttribute('scope', 'instance');
                } else {
                    addProperty.setAttribute('scope', 'open');
                }

                if (!mbo.getBoolean('USERDEFINED')) {
                    addProperty.setAttribute('user_defined', mbo.getBoolean('USERDEFINED'));
                }

                if (!mbo.isNull('DISPPROPVALUE')) {
                    addProperty.setAttribute('value', mbo.getString('DISPPROPVALUE'));
                }

                if (!mbo.isNull('VALUERULES')) {
                    addProperty.setAttribute('value', mbo.getString('VALUERULES'));
                }

                statements.addContent(addProperty);
            }

            // Create DocType and Document with DOCTYPE
            var docType = new DocType('script', 'script.dtd');
            var dbcScript = new Document(script, docType);

            var builder = new SAXBuilder();
            builder.setValidation(false);
            builder.setFeature('http://apache.org/xml/features/nonvalidating/load-external-dtd', false);

            var StringWriter = Java.type('java.io.StringWriter');
            var outputter = new XMLOutputter(Format.getPrettyFormat());
            var writer = new StringWriter();
            outputter.output(dbcScript, writer);
            return writer.toString();
        } finally {
            _close(propSet);
        }
    } else {
        params.put('source', Java.to(['table'], 'java.lang.String[]'));
        params.put('name', Java.to(['MAXPROP'], 'java.lang.String[]'));
        params.put('adddelete', Java.to([adddelete], 'java.lang.String[]'));
        params.put('filename', Java.to([fileName], 'java.lang.String[]'));
        params.put('where', Java.to(['propname in (' + where + ')'], 'java.lang.String[]'));

        var maxprop = convert(params);

        params.put('name', Java.to(['MAXPROPVALUE'], 'java.lang.String[]'));
        var maxpropvalue = convert(params);
        return maxprop + '\n' + maxpropvalue;
    }
}

function getMessageNames() {
    var result = [];
    var mboSet = null;

    try {
        mboSet = MXServer.getMXServer().getMboSet('MAXMESSAGES', userInfo);

        mboSet.setOrderBy('msggroup, msgkey');
        mboSet.setFlag(MboConstants.DISCARDABLE, true);

        var mbo = null;
        while (mboSet.moveNext()) {
            mbo = mboSet.getMbo();
            var obj = { label: mbo.getString('MSGGROUP') + ':' + mbo.getString('MSGKEY'), description: mbo.getString('VALUE'), id: mbo.getUniqueIDValue() };

            result.push(obj);
        }
    } finally {
        _close(mboSet);
    }

    return result;
}

function getAttributeNames(objectName) {
    var result = [];
    var mboSet = null;

    try {
        mboSet = MXServer.getMXServer().getMboSet('MAXATTRIBUTECFG', userInfo);
        var sqlf = new SqlFormat('objectname = :1');
        sqlf.setObject(1, 'MAXOBJECT', 'OBJECTNAME', objectName);
        mboSet.setWhere(sqlf.format());
        mboSet.setOrderBy('attributename');
        mboSet.setFlag(MboConstants.DISCARDABLE, true);

        var mbo = null;
        while (mboSet.moveNext()) {
            mbo = mboSet.getMbo();
            var obj = { label: mbo.getString('ATTRIBUTENAME'), description: mbo.getString('TITLE'), id: mbo.getUniqueIDValue() };
            result.push(obj);
        }
    } finally {
        _close(mboSet);
    }

    return result;
}

function getNames(mboName, labelAttribute, descriptionAttribute, requiresExtSystem) {
    var result = [];
    var mboSet = null;

    try {
        mboSet = MXServer.getMXServer().getMboSet(mboName, userInfo);
        if (mboName == 'maxprop') {
            var sqlf = new SqlFormat('propname != :1');
            sqlf.setObject(1, 'MAXPROP', 'PROPNAME', 'mxe.sec.header.Content_Security_Policy');
            mboSet.setWhere(sqlf.format());
        }
        mboSet.setOrderBy(labelAttribute);
        mboSet.setFlag(MboConstants.DISCARDABLE, true);

        var mbo = null;
        while (mboSet.moveNext()) {
            mbo = mboSet.getMbo();
            var obj = { label: mbo.getString(labelAttribute), description: mbo.getString(descriptionAttribute) };
            if (requiresExtSystem) {
                obj.extsystem = mbo.getString('EXTSYSNAME');
                obj.description = obj.description + ' (' + obj.extsystem + ')';
            }
            result.push(obj);
        }
    } finally {
        _close(mboSet);
    }

    return result;
}

function convert(params) {
    var converter = new SQLConverter();
    var result = converter.convert(params, userInfo);
    return new JavaString(result);
}

function updateMetaData(xml, description, fileName) {
    // MAS removed support for legacy JDOM, switch to JDOM2 and then fall back to legacy JDOM for older versions.
    try {
        // eslint-disable-next-line no-global-assign
        Element = Java.type('org.jdom2.Element');
        SAXBuilder = Java.type('org.jdom2.input.SAXBuilder');
        Format = Java.type('org.jdom2.output.Format');
        XMLOutputter = Java.type('org.jdom2.output.XMLOutputter');
    } catch (error) {
        if (error instanceof Java.type('java.lang.ClassNotFoundException') || error instanceof Java.type('java.lang.RuntimeException')) {
            // eslint-disable-next-line no-global-assign
            Element = Java.type('org.jdom.Element');
            SAXBuilder = Java.type('org.jdom.input.SAXBuilder');
            Format = Java.type('org.jdom.output.Format');
            XMLOutputter = Java.type('org.jdom.output.XMLOutputter');
        } else {
            // if some other error is occurring throw the error to the user.
            throw error;
        }
    }

    var StringReader = Java.type('java.io.StringReader');
    var StringWriter = Java.type('java.io.StringWriter');

    var builder = new SAXBuilder();
    builder.setValidation(false);
    builder.setFeature('http://apache.org/xml/features/nonvalidating/load-external-dtd', false);

    var dbc = builder.build(new StringReader(xml));
    var rootElement = dbc.getRootElement();
    rootElement.setAttribute('author', userInfo.getDisplayName());

    rootElement.setAttribute('scriptname', fileName);

    // Find and update description element if it exists
    if (description != null && description.length > 0) {
        var descriptionElement = rootElement.getChild('description');
        if (descriptionElement != null) {
            descriptionElement.setText(description);
        }
    }

    var outputter = new XMLOutputter(Format.getPrettyFormat());
    var writer = new StringWriter();
    outputter.output(dbc, writer);

    return writer.toString();
}

function checkPermissions(app, optionName) {
    if (!userInfo) {
        throw new AdminError('no_user_info', 'The userInfo global variable has not been set, therefore the user permissions cannot be verified.');
    }

    var userProfile = MXServer.getMXServer().lookup('SECURITY').getProfile(userInfo);

    if (!userProfile.hasAppOption(app, optionName) && !isInAdminGroup()) {
        throw new AdminError(
            'no_permission',
            'The user ' + userInfo.getUserName() + ' does not have access to the ' + optionName + ' option in the ' + app + ' object structure.'
        );
    }
}

// Determines if the current user is in the administrator group, returns true if the user is, false otherwise.
function isInAdminGroup() {
    var user = userInfo.getUserName();
    service.log_info('Determining if the user ' + user + ' is in the administrator group.');
    var groupUserSet;

    try {
        groupUserSet = MXServer.getMXServer().getMboSet('GROUPUSER', MXServer.getMXServer().getSystemUserInfo());

        // Get the ADMINGROUP MAXVAR value.
        var adminGroup = MXServer.getMXServer().lookup('MAXVARS').getString('ADMINGROUP', null);

        // Query for the current user and the found admin group.
        // The current user is determined by the implicity `user` variable.
        sqlFormat = new SqlFormat('userid = :1 and groupname = :2');
        sqlFormat.setObject(1, 'GROUPUSER', 'USERID', user);
        sqlFormat.setObject(2, 'GROUPUSER', 'GROUPNAME', adminGroup);
        groupUserSet.setWhere(sqlFormat.format());

        if (!groupUserSet.isEmpty()) {
            service.log_info('The user ' + user + ' is in the administrator group ' + adminGroup + '.');
            return true;
        } else {
            service.log_info('The user ' + user + ' is not in the administrator group ' + adminGroup + '.');
            return false;
        }
    } finally {
        _close(groupUserSet);
    }
}

function _close(mboSet) {
    if (mboSet != null && mboSet instanceof Java.type('psdi.mbo.MboSet')) {
        mboSet.close();
        mboSet.cleanup();
    }
}
// eslint-disable-next-line no-unused-vars
var scriptConfig = {
    autoscript: 'NAVIAM.AUTOSCRIPT.DBC',
    description: 'Naviam Script to extract object configurations as DBC.',
    version: '1.0.0',
    active: true,
    logLevel: 'ERROR',
};
