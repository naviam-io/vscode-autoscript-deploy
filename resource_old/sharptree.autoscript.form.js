/* eslint-disable no-undef */
/* eslint-disable no-unused-vars */
// @ts-nocheck

RuntimeException = Java.type('java.lang.RuntimeException');
System = Java.type('java.lang.System');

Base64 = Java.type('java.util.Base64');
HashMap = Java.type('java.util.HashMap');

URLDecoder = Java.type('java.net.URLDecoder');
StandardCharsets = Java.type('java.nio.charset.StandardCharsets');

DBShortcut = Java.type('psdi.mbo.DBShortcut');
SqlFormat = Java.type('psdi.mbo.SqlFormat');
MXServer = Java.type('psdi.server.MXServer');

MXException = Java.type('psdi.util.MXException');
MXAccessException = Java.type('psdi.util.MXAccessException');
MXApplicationException = Java.type('psdi.util.MXApplicationException');

MXLoggerFactory = Java.type('psdi.util.logging.MXLoggerFactory');
Version = Java.type('psdi.util.Version');

System = Java.type('java.lang.System');

var logger = MXLoggerFactory.getLogger(
    'maximo.script.' + service.getScriptName()
);

main();

function main() {
    if (typeof httpMethod !== 'undefined') {
        var response = {};
        try {
            checkPermissions('SHARPTREE_UTILS', 'DEPLOYSCRIPT');

            if (httpMethod.toLowerCase() === 'get') {
                var formId = getInspectionFormId();
                if (
                    typeof formId === 'undefined' ||
                    formId === null ||
                    !formId
                ) {
                    var formNames = [];
                    // If nothing is requested then return a list of all screens.
                    var inspectionFormSet;
                    try {
                        inspectionFormSet = MXServer.getMXServer().getMboSet(
                            'INSPECTIONFORM',
                            userInfo
                        );
                        inspectionFormSet.setOrderBy(
                            'inspformnum, revision desc'
                        );
                        var sqlf = new SqlFormat('status != :1');
                        sqlf.setObject(
                            1,
                            'INSPECTIONFORM',
                            'STATUS',
                            'REVISED'
                        );
                        inspectionFormSet.setWhere(sqlf.format());
                        var inspectionForms = [];

                        var inspectionForm = inspectionFormSet.getMbo(0);

                        while (inspectionForm) {
                            if (
                                formNames.indexOf(
                                    inspectionForm.getString('INSPFORMNUM')
                                ) < 0
                            ) {
                                var form = {
                                    inspformnum:
                                        inspectionForm.getString('INSPFORMNUM'),
                                    name: inspectionForm.getString('NAME'),
                                    status: inspectionForm.getString('STATUS'),
                                    id: inspectionForm.getUniqueIDValue(),
                                };

                                inspectionForms.push(form);
                                formNames.push(
                                    inspectionForm.getString('INSPFORMNUM')
                                );
                            }

                            inspectionFormSet.remove(0);
                            inspectionForm = inspectionFormSet.getMbo(0);
                        }

                        response.status = 'success';
                        response.inspectionForms = inspectionForms;
                        responseBody = JSON.stringify(response);
                    } finally {
                        _close(inspectionFormSet);
                    }
                } else {
                    response.status = 'success';
                    response.form = extractForm(formId);
                    responseBody = JSON.stringify(response);
                }
                return;
            } else if (
                httpMethod.toLowerCase() === 'post' &&
                typeof requestBody !== 'undefined'
            ) {
                var formData = JSON.parse(requestBody);

                importForm(formData);
                response.status = 'success';
                responseBody = JSON.stringify(response);
            } else if (
                httpMethod.toLowerCase() === 'post' &&
                request.getQueryParam('fix')
            ) {
                // Because Maximo demo data is poor, inspection forms are shipped with missing YORN values that need to be fixed.
                var db = new DBShortcut();
                try {
                    db.connect(userInfo.getConnectionKey());
                    db.execute(
                        DBShortcut.UPDATE,
                        new SqlFormat(
                            'update inspectionform set readconfirmation = 0 where readconfirmation is null'
                        )
                    );
                    db.execute(
                        DBShortcut.UPDATE,
                        new SqlFormat(
                            'update inspectionform set audioguided = 0 where audioguided is null'
                        )
                    );
                    db.execute(
                        DBShortcut.UPDATE,
                        new SqlFormat(
                            'update inspfield set visible = 1 where visible is null'
                        )
                    );
                    db.execute(
                        DBShortcut.UPDATE,
                        new SqlFormat(
                            'update inspfieldoption set requireaction = 0 where requireaction is null'
                        )
                    );
                    db.commit();
                } finally {
                    db.close();
                }
            } else {
                throw new FormError(
                    'only_get_supported',
                    'Only the HTTP GET method is supported when extracting automation scripts.'
                );
            }
        } catch (error) {
            response.status = 'error';
            // ensure the error is logged to the Maximo logs
            Java.type('java.lang.System').out.println(error);
            if (error instanceof FormError) {
                response.message = error.message;
                response.reason = error.reason;
            } else if (error instanceof SyntaxError) {
                response.reason = 'syntax_error';
                response.message = error.message;
            } else if (error instanceof Error) {
                response.message = error.message;
            } else if (error instanceof MXException) {
                response.reason =
                    error.getErrorGroup() + '_' + error.getErrorKey();
                response.message = error.getMessage();
            } else if (error instanceof RuntimeException) {
                if (error.getCause() instanceof MXException) {
                    response.reason =
                        error.getCause().getErrorGroup() +
                        '_' +
                        error.getCause().getErrorKey();
                    response.message = error.getCause().getMessage();
                } else {
                    response.reason = 'runtime_exception';
                    response.message = error.getMessage();
                }
            } else {
                response.cause = error;
            }

            if (typeof httpMethod !== 'undefined') {
                responseBody = JSON.stringify(response);
            }

            logger.error(error);

            return;
        }
    }
}

function importForm(form) {
    // Make sure the inspection doc types are set up before importing.
    fixInspectionAppDocTypes();

    var inspectionFormSet;
    try {
        inspectionFormSet = MXServer.getMXServer().getMboSet(
            'INSPECTIONFORM',
            userInfo
        );
        var sqlf = new SqlFormat(
            'name = :1 and hasrevision = :no and (status = :2 or status = :3) '
        );
        sqlf.setObject(1, 'INSPECTIONFORM', 'NAME', form.name);
        sqlf.setObject(2, 'INSPECTIONFORM', 'STATUS', 'ACTIVE');
        sqlf.setObject(3, 'INSPECTIONFORM', 'STATUS', 'INACTIVE');

        inspectionFormSet.setWhere(sqlf.format());
        var inspectionForm;
        if (inspectionFormSet.isEmpty()) {
            sqlf.setObject(2, 'INSPECTIONFORM', 'STATUS', 'PNDREV');
            sqlf.setObject(3, 'INSPECTIONFORM', 'STATUS', 'DRAFT');

            inspectionFormSet.setWhere(sqlf.format());
            inspectionFormSet.reset();
            if (inspectionFormSet.isEmpty()) {
                inspectionForm = inspectionFormSet.add();

                inspectionForm.setValue('NAME', form.name);
            } else {
                inspectionForm = inspectionFormSet.moveFirst();
                inspectionForm.setValue('REASON', form.reason);
            }
        } else {
            var sourceInspectionForm = inspectionFormSet.moveFirst();
            sourceInspectionForm.setValue('HASREVISION', true);
            inspectionForm = sourceInspectionForm.initRevision();
            inspectionForm.setValue('REASON', form.reason);
        }

        setValueIfDefined(inspectionForm, 'TYPE', form.type);
        setValueIfDefined(
            inspectionForm,
            'DESCRIPTION_LONGDESCRIPTION',
            form.instructions
        );
        setValueIfDefined(inspectionForm, 'AUDIOGUIDED', form.audioguided);
        setValueIfDefined(
            inspectionForm,
            'READCONFIRMATION',
            form.readconfirmation
        );

        var formNum = inspectionForm.getString('INSPFORMNUM');
        var revision = inspectionForm.getInt('REVISION');
        var inspQuestionSet = inspectionForm.getMboSet('INSPQUESTION');

        inspQuestionSet.deleteAll();

        if (typeof form.questions !== 'undefined') {
            form.questions.forEach(function (question) {
                var inspQuestion = inspQuestionSet.add();

                question.newinspquestionnum =
                    inspQuestion.getString('INSPQUESTIONNUM');

                inspQuestion.setValue('INSPFORMNUM', formNum);
                inspQuestion.setValue('REVISION', revision);

                setValueIfDefined(
                    inspQuestion,
                    'DESCRIPTION',
                    question.description
                );
                setValueIfDefined(
                    inspQuestion,
                    'DESCRIPTION_LONGDESCRIPTION',
                    question.information
                );
                setValueIfDefined(inspQuestion, 'GROUPID', question.groupid);
                setValueIfDefined(inspQuestion, 'SEQUENCE', question.sequence);
                setValueIfDefined(inspQuestion, 'GROUPSEQ', question.groupseq);

                inspQuestion.setValue(
                    'REQUIRED',
                    typeof question.required !== 'undefined'
                        ? question.required
                        : false
                );
                try {
                    if (hasAttribute('INSPQUESTION', 'AUDIOCACHEQUESTION')) {
                        if (
                            typeof question.audiocachequestion !== 'undefined'
                        ) {
                            inspQuestion.setValue(
                                'AUDIOCACHEQUESTION',
                                Base64.getDecoder().decode(
                                    question.audiocachequestion
                                )
                            );
                        }
                    }
                } catch (ignored) {
                    /* ignored */
                }

                if (typeof question.fields !== 'undefined') {
                    var inspFieldSet = inspQuestion.getMboSet('INSPFIELD');
                    question.fields.forEach(function (field) {
                        var inspField = inspFieldSet.add();

                        field.newinspfieldnum =
                            inspField.getString('INSPFIELDNUM');

                        inspField.setValue('INSPFORMNUM', formNum);
                        inspField.setValue('REVISION', revision);
                        inspField.setValue(
                            'INSPQUESTIONNUM',
                            inspQuestion.getString('INSPQUESTIONNUM')
                        );
                        setValueIfDefined(
                            inspField,
                            'SEQUENCE',
                            field.sequence
                        );
                        setValueIfDefined(
                            inspField,
                            'FIELDTYPE',
                            field.fieldtype
                        );
                        setValueIfDefined(
                            inspField,
                            'DESCRIPTION',
                            field.description
                        );
                        setValueIfDefined(
                            inspField,
                            'REQUIRED',
                            field.required
                        );
                        setValueIfDefined(
                            inspField,
                            'INITIALLABEL',
                            field.initiallabel
                        );
                        setValueIfDefined(
                            inspField,
                            'ENDLABEL',
                            field.endlabel
                        );
                        setValueIfDefined(inspField, 'STEPS', field.steps);
                        setValueIfDefined(
                            inspField,
                            'INITIALVALUE',
                            field.initialvalue
                        );
                        setValueIfDefined(
                            inspField,
                            'ENDVALUE',
                            field.endvalue
                        );
                        setValueIfDefined(
                            inspField,
                            'METERNAME',
                            field.metername
                        );
                        setValueIfDefined(
                            inspField,
                            'METERTYPE',
                            field.metertype
                        );
                        setValueIfDefined(
                            inspField,
                            'SHOWDATE',
                            field.showdate
                        );
                        setValueIfDefined(
                            inspField,
                            'SHOWTIME',
                            field.showtime
                        );
                        setValueIfDefined(inspField, 'DOCTYPE', field.doctype);
                        setValueIfDefined(inspField, 'VISIBLE', field.visible);
                        setValueIfDefined(
                            inspField,
                            'DESCRIPTION_LONGDESCRIPTION',
                            field.information
                        );

                        if (hasAttribute('INSPFIELD', 'DOMAINID')) {
                            setValueIfDefined(
                                inspField,
                                'DOMAINID',
                                field.domainid
                            );
                        }

                        if (hasAttribute('INSPFIELD', 'DOMAINTYPE')) {
                            setValueIfDefined(
                                inspField,
                                'DOMAINTYPE',
                                field.domaintype
                            );
                        }

                        if (typeof field.options !== 'undefined') {
                            var inspFieldOptionSet =
                                inspField.getMboSet('INSPFIELDOPTION');
                            field.options.forEach(function (option) {
                                var inspFieldOption = inspFieldOptionSet.add();
                                inspFieldOption.setValue(
                                    'INSPFIELDNUM',
                                    inspField.getString('INSPFIELDNUM')
                                );
                                inspFieldOption.setValue(
                                    'INSPQUESTIONNUM',
                                    inspQuestion.getString('INSPQUESTIONNUM')
                                );
                                inspFieldOption.setValue(
                                    'INSPFORMNUM',
                                    formNum
                                );
                                inspFieldOption.setValue('REVISION', revision);
                                setValueIfDefined(
                                    inspFieldOption,
                                    'DESCRIPTION',
                                    option.description
                                );
                                setValueIfDefined(
                                    inspFieldOption,
                                    'SEQUENCE',
                                    option.sequence
                                );
                                setValueIfDefined(
                                    inspFieldOption,
                                    'INSPECTORFEEDBACK',
                                    option.inspectorfeedback
                                );
                                setValueIfDefined(
                                    inspFieldOption,
                                    'REQUIREACTION',
                                    option.requireaction
                                );
                                setValueIfDefined(
                                    inspFieldOption,
                                    'COLOR',
                                    option.color
                                );
                                setValueIfDefined(
                                    inspFieldOption,
                                    'ICON',
                                    option.icon
                                );
                                try {
                                    if (
                                        hasAttribute(
                                            'INSPFIELDOPTION',
                                            'AUDIOCACHEFBACK'
                                        )
                                    ) {
                                        if (
                                            typeof option.audiocachefback !==
                                            'undefined'
                                        ) {
                                            inspQuestion.setValue(
                                                'AUDIOCACHEFBACK',
                                                Base64.getDecoder().decode(
                                                    option.audiocachefback
                                                )
                                            );
                                        }
                                    }
                                } catch (ignored) {
                                    /* ignored */
                                }
                            });
                        }
                    });
                }
            });

            // After all the questions have been processed, apply any cascade options.
            if (typeof form.cascadeoptions !== 'undefined') {
                var inspCascadeOptionSet = inspectionForm.getMboSet(
                    '$inspcascadeoption',
                    'INSPCASCADEOPTION',
                    '1!=1'
                );
                form.cascadeoptions.forEach(function (option) {
                    var srcquestion = findNewQuestionNumber(
                        option.srcquestion,
                        form
                    );
                    var tgtquestion = findNewQuestionNumber(
                        option.tgtquestion,
                        form
                    );
                    var srcfield = findNewFieldNumber(option.srcfield, form);
                    var tgtfield = findNewFieldNumber(option.tgtfield, form);

                    if (srcquestion && tgtquestion && srcfield && tgtfield) {
                        var inspCascadeOption = inspCascadeOptionSet.add();
                        inspCascadeOption.setValue('INSPFORMNUM', formNum);
                        inspCascadeOption.setValue('REVISION', revision);
                        inspCascadeOption.setValue('SRCQUESTION', srcquestion);
                        inspCascadeOption.setValue('SRCFIELD', srcfield);
                        inspCascadeOption.setValue('TGTQUESTION', tgtquestion);
                        inspCascadeOption.setValue('TGTFIELD', tgtfield);
                        inspCascadeOption.setValue(
                            'SRCTXTRESPONSE',
                            option.srctxtresponse
                        );
                        inspCascadeOption.setValue('VISIBLE', option.visible);
                        inspCascadeOption.setValue('REQUIRED', option.required);
                        inspCascadeOption.setValue(
                            'INSPECTORFEEDBACK',
                            option.inspectorfeedback
                        );
                        inspCascadeOption.setValue(
                            'SHOWMESSAGE',
                            option.showmessage
                        );
                        inspCascadeOption.setValue(
                            'OPERATOR1',
                            option.operator1
                        );
                        inspCascadeOption.setValue(
                            'OPERATOR2',
                            option.operator2
                        );
                        inspCascadeOption.setValue('NUMBER1', option.number1);
                        inspCascadeOption.setValue('NUMBER2', option.number2);
                        inspCascadeOption.setValue(
                            'REQUIREACTION',
                            option.requireaction
                        );
                    }
                });
            }

            var inspFormScriptSet = inspectionForm.getMboSet('INSPFORMSCRIPT');
            inspFormScriptSet.deleteAll();

            if (typeof form.scripts !== 'undefined') {
                form.scripts.forEach(function (script) {
                    var inspFormScript = inspFormScriptSet.add();
                    inspFormScript.setValue('INSPFORMNUM', formNum);
                    inspFormScript.setValue('REVISION', revision);
                    inspFormScript.setValue('AUTOSCRIPT', script.autoscript);
                    inspFormScript.setValue(
                        'SEQUENCE',
                        String(script.sequence)
                    );
                    inspFormScript.setValue('SITEID', userInfo.getInsertSite());
                });
            }
        }

        if (
            typeof form.activateOnDeploy !== 'undefined' &&
            form.activateOnDeploy
        ) {
            var id = inspectionForm.getUniqueIDValue();

            inspectionFormSet.save();

            _close(inspectionFormSet);

            inspectionFormSet = MXServer.getMXServer().getMboSet(
                'INSPECTIONFORM',
                userInfo
            );
            inspectionForm = inspectionFormSet.getMboForUniqueId(id);

            inspectionForm.changeFormStatus('ACTIVE');

            inspectionFormSet.save();
        } else {
            inspectionFormSet.save();
        }
    } finally {
        _close(inspectionFormSet);
    }
}

function findNewQuestionNumber(questionNum, form) {
    if (typeof form !== 'undefined' && typeof form.questions !== 'undefined') {
        var i = 0;

        while (i < form.questions.length) {
            var question = form.questions[i];
            if (question.inspquestionnum == questionNum) {
                return question.newinspquestionnum;
            }
            i++;
        }
    }
    return null;
}

function findNewFieldNumber(fieldNum, form) {
    if (typeof form !== 'undefined' && typeof form.questions !== 'undefined') {
        var i = 0;

        while (i < form.questions.length) {
            var question = form.questions[i];
            if (typeof question.fields !== 'undefined') {
                var j = 0;

                while (j < question.fields.length) {
                    var field = question.fields[j];
                    if (fieldNum == field.inspfieldnum) {
                        return field.newinspfieldnum;
                    }
                    j++;
                }
            }
            i++;
        }
    }

    return null;
}

function setValueIfDefined(mbo, attribute, value) {
    if (typeof value !== 'undefined') {
        mbo.setValue(attribute, value);
    }
}

function extractForm(formId) {
    var inspectionFormSet;
    try {
        inspectionFormSet = MXServer.getMXServer().getMboSet(
            'INSPECTIONFORM',
            userInfo
        );

        var inspectionForm = inspectionFormSet.getMboForUniqueId(formId);

        if (inspectionForm) {
            var result = {};
            result.sourceVersion = Version.getProductVersion();
            result.activateOnDeploy = false;
            result.inspformnum = inspectionForm.getString('INSPFORMNUM');
            result.revision = inspectionForm.getInt('REVISION');
            result.name = inspectionForm.getString('NAME');
            result.instructions = inspectionForm.getString(
                'DESCRIPTION_LONGDESCRIPTION'
            );
            result.reason = inspectionForm.getString('REASON');
            result.type = inspectionForm.getString('TYPE');
            result.readconfirmation =
                inspectionForm.getBoolean('READCONFIRMATION');
            result.audioguided = inspectionForm.getBoolean('AUDIOGUIDED');

            try {
                if (hasAttribute('INSPQUESTION', 'AUDIOCACHEFORM')) {
                    if (!inspectionForm.isNull('AUDIOCACHEFORM')) {
                        result.audiocacheform = Base64.getEncoder().encode(
                            inspectionForm.getBytes('AUDIOCACHEFORM')
                        );
                    }
                }
            } catch (ignored) {
                /* ignored */
            }

            var inspQuestionSet = inspectionForm.getMboSet('INSPQUESTION');

            var inspQuestion = inspQuestionSet.moveFirst();
            var questions = [];
            var cascadeoptions = [];
            while (inspQuestion) {
                var question = {};
                question.inspquestionnum =
                    inspQuestion.getString('INSPQUESTIONNUM');
                question.inspformnum = inspQuestion.getString('INSPFORMNUM');
                question.description = inspQuestion.getString('DESCRIPTION');
                question.information = inspQuestion.getString(
                    'DESCRIPTION_LONGDESCRIPTION'
                );
                if (!inspQuestion.isNull('GROUPID')) {
                    question.groupid = inspQuestion.getInt('GROUPID');
                }
                question.sequence = inspQuestion.getInt('SEQUENCE');
                question.groupseq = inspQuestion.getDouble('GROUPSEQ');
                question.required = inspQuestion.getBoolean('REQUIRED');

                try {
                    if (!inspQuestion.isNull('AUDIOCACHEQUESTION')) {
                        question.audiocachequestion =
                            Base64.getEncoder().encode(
                                inspQuestion.getBytes('AUDIOCACHEQUESTION')
                            );
                    }
                } catch (ignored) {
                    /* ignored */
                }

                var inspFieldSet = inspQuestion.getMboSet('INSPFIELD');

                var inspField = inspFieldSet.moveFirst();
                var fields = [];
                while (inspField) {
                    var field = {};
                    field.inspfieldnum = inspField.getString('INSPFIELDNUM');
                    field.inspquestionnum =
                        inspField.getString('INSPQUESTIONNUM');
                    field.inspformnum = inspField.getString('INSPFORMNUM');
                    field.fieldtype = inspField.getString('FIELDTYPE');
                    field.description = inspField.getString('DESCRIPTION');
                    field.sequence = inspField.getInt('SEQUENCE');
                    field.required = inspField.getBoolean('REQUIRED');
                    field.initiallabel = inspField.getString('INITIALLABEL');
                    field.endlabel = inspField.getString('ENDLABEL');
                    if (!inspField.isNull('STEPS')) {
                        field.steps = inspField.getInt('STEPS');
                    }
                    if (!inspField.isNull('INITIALVALUE')) {
                        field.initialvalue = inspField.getInt('INITIALVALUE');
                    }
                    if (!inspField.isNull('ENDVALUE')) {
                        field.endvalue = inspField.getInt('ENDVALUE');
                    }

                    field.metername = inspField.getString('METERNAME');
                    field.metertype = inspField.getString('METERTYPE');
                    field.showdate = inspField.getBoolean('SHOWDATE');
                    field.showtime = inspField.getBoolean('SHOWTIME');
                    field.doctype = inspField.getString('DOCTYPE');
                    field.visible = inspField.getBoolean('VISIBLE');

                    if (hasAttribute('INSPFIELD', 'DOMAINID')) {
                        field.domainid = inspField.getString('DOMAINID');
                    }

                    if (hasAttribute('INSPFIELD', 'DOMAINTYPE')) {
                        field.domaintype = inspField.getString('DOMAINTYPE');
                    }

                    if (!inspField.isNull('DESCRIPTION_LONGDESCRIPTION')) {
                        field.information = inspField.getString(
                            'DESCRIPTION_LONGDESCRIPTION'
                        );
                    }
                    if (!inspField.isNull('AUDIOCACHEFIELD')) {
                        question.audiocachefield = Base64.getEncoder().encode(
                            inspField.getBytes('AUDIOCACHEFIELD')
                        );
                    }

                    if (!inspField.isNull('AUDIOCACHEOPTION')) {
                        question.audiocacheoption = Base64.getEncoder().encode(
                            inspField.getBytes('AUDIOCACHEOPTION')
                        );
                    }

                    var inspFieldOptionSet =
                        inspField.getMboSet('INSPFIELDOPTION');

                    var inspFieldOption = inspFieldOptionSet.moveFirst();

                    var fieldOptions = [];
                    while (inspFieldOption) {
                        var option = {};
                        option.inspfieldnum =
                            inspFieldOption.getString('INSPFIELDNUM');
                        option.inspquestionnum =
                            inspFieldOption.getString('INSPQUESTIONNUM');
                        option.inspformnum =
                            inspFieldOption.getString('INSPFORMNUM');
                        option.description =
                            inspFieldOption.getString('DESCRIPTION');
                        option.sequence = inspFieldOption.getInt('SEQUENCE');
                        option.inspectorfeedback =
                            inspFieldOption.getString('INSPECTORFEEDBACK');
                        option.requireaction =
                            inspFieldOption.getBoolean('REQUIREACTION');
                        option.color = inspFieldOption.getString('COLOR');
                        option.icon = inspFieldOption.getString('ICON');
                        try {
                            if (
                                hasAttribute(
                                    'INSPFIELDOPTION',
                                    'AUDIOCACHEFBACK'
                                )
                            ) {
                                if (
                                    !inspFieldOption.isNull('AUDIOCACHEFBACK')
                                ) {
                                    question.audiocachefback =
                                        Base64.getEncoder().encode(
                                            inspField.getBytes(
                                                'AUDIOCACHEFBACK'
                                            )
                                        );
                                }
                            }
                        } catch (ignored) {
                            /* ignored */
                        }

                        fieldOptions.push(option);
                        inspFieldOption = inspFieldOptionSet.moveNext();
                    }
                    field.options = fieldOptions;

                    var inspCascadeOptionSet = inspField.getMboSet(
                        'INSPCASCADEOPTIONSRC'
                    );

                    var inspCascadeOption = inspCascadeOptionSet.moveFirst();

                    while (inspCascadeOption) {
                        var cascadeOption = {};

                        cascadeOption.inspcascadeoptionnum =
                            inspCascadeOption.getString('INSPCASCADEOPTIONNUM');
                        cascadeOption.inspformnum =
                            inspCascadeOption.getString('INSPFORMNUM');
                        cascadeOption.srcquestion =
                            inspCascadeOption.getString('SRCQUESTION');
                        cascadeOption.srcfield =
                            inspCascadeOption.getString('SRCFIELD');
                        cascadeOption.srctxtresponse =
                            inspCascadeOption.getString('SRCTXTRESPONSE');
                        cascadeOption.tgtquestion =
                            inspCascadeOption.getString('TGTQUESTION');
                        cascadeOption.tgtfield =
                            inspCascadeOption.getString('TGTFIELD');
                        cascadeOption.visible =
                            inspCascadeOption.getBoolean('VISIBLE');
                        cascadeOption.required =
                            inspCascadeOption.getBoolean('REQUIRED');
                        cascadeOption.inspectorfeedback =
                            inspCascadeOption.getString('INSPECTORFEEDBACK');
                        cascadeOption.showmessage =
                            inspCascadeOption.getBoolean('SHOWMESSAGE');
                        cascadeOption.operator1 =
                            inspCascadeOption.getString('OPERATOR1');
                        cascadeOption.operator2 =
                            inspCascadeOption.getString('OPERATOR2');
                        cascadeOption.number1 =
                            inspCascadeOption.getDouble('NUMBER1');
                        cascadeOption.number2 =
                            inspCascadeOption.getDouble('NUMBER2');
                        cascadeOption.requireaction =
                            inspCascadeOption.getBoolean('REQUIREACTION');

                        cascadeoptions.push(cascadeOption);

                        inspCascadeOption = inspCascadeOptionSet.moveNext();
                    }

                    fields.push(field);

                    inspField = inspFieldSet.moveNext();
                }

                question.fields = fields;
                questions.push(question);
                inspQuestion = inspQuestionSet.moveNext();
            }

            result.questions = questions;
            result.cascadeoptions = cascadeoptions;

            var inspFormScriptSet = inspectionForm.getMboSet('INSPFORMSCRIPT');
            var inspFormScript = inspFormScriptSet.moveFirst();

            var scripts = [];
            if (inspFormScript) {
                var script = {};

                script.inspformnum = inspFormScript.getString('INSPFORMNUM');
                script.autoscript = inspFormScript.getString('AUTOSCRIPT');
                script.sequence = inspFormScript.getInt('SEQUENCE');
                scripts.push(script);
                inspFormScript = inspFormScriptSet.moveNext();
            }

            result.scripts = scripts;

            return result;
        } else {
            return null;
        }
    } finally {
        _close(inspectionFormSet);
    }
}

function hasAttribute(objectName, attributeName) {
    return (
        MXServer.getMXServer()
            .getMaximoDD()
            .getMboSetInfo(objectName)
            .getAttribute(attributeName) != null
    );
}

function getInspectionFormId() {
    var httpRequest = request.getHttpServletRequest();

    var requestURI = httpRequest.getRequestURI();
    var contextPath = httpRequest.getContextPath();
    var resourceReq = requestURI;

    if (contextPath && contextPath !== '') {
        resourceReq = requestURI.substring(contextPath.length());
    }

    if (!resourceReq.startsWith('/')) {
        resourceReq = '/' + resourceReq;
    }

    var isOSLC = true;

    if (
        !resourceReq
            .toLowerCase()
            .startsWith('/oslc/script/' + service.scriptName.toLowerCase())
    ) {
        if (
            !resourceReq
                .toLowerCase()
                .startsWith('/api/script/' + service.scriptName.toLowerCase())
        ) {
            return null;
        } else {
            osOSLC = false;
        }
    }

    var baseReqPath = isOSLC
        ? '/oslc/script/' + service.scriptName
        : '/api/script/' + service.scriptName;

    var action = resourceReq.substring(baseReqPath.length);

    if (action.startsWith('/')) {
        action = action.substring(1);
    }

    if (!action || action.trim() === '') {
        return null;
    }

    return URLDecoder.decode(
        action.toLowerCase(),
        StandardCharsets.UTF_8.name()
    );
}

function fixInspectionAppDocTypes() {
    var docTypesSet;
    var appsSet;
    var allApplications = ['INSPECTOR', 'INSPECTORSUP', 'INSPECTION'];

    try {
        var applications = [];
        appsSet = MXServer.getMXServer().getMboSet('MAXAPPS', userInfo);
        allApplications.forEach(function (application) {
            var sqlfCheck = new SqlFormat('app = :1');
            sqlfCheck.setObject(1, 'MAXAPPS', 'APP', application);
            appsSet.setWhere(sqlfCheck.format());

            System.out.println(sqlfCheck.format());
            appsSet.reset();
            if (!appsSet.isEmpty()) {
                applications.push(application);
            }
        });

        docTypesSet = MXServer.getMXServer().getMboSet('DOCTYPES', userInfo);

        for (index in applications) {
            var application = applications[index];
            var sqlf = new SqlFormat(
                'doctype not in (select doctype from appdoctype where app = :1)'
            );
            sqlf.setObject(1, 'APPDOCTYPE', 'APP', application);
            docTypesSet.setWhere(sqlf.format());
            docTypesSet.reset();

            var docTypes = docTypesSet.moveFirst();

            while (docTypes) {
                var appDocType = docTypes.getMboSet('APPDOCTYPE').add();
                appDocType.setValue('APP', application);
                appDocType.setValue('DOCTYPE', docTypes.getString('DOCTYPE'));

                docTypes = docTypesSet.moveNext();
            }
            docTypesSet.save();
        }
    } finally {
        _close(appsSet);
        _close(docTypesSet);
    }
}

function checkPermissions(app, optionName) {
    if (!userInfo) {
        throw new FormError(
            'no_user_info',
            'The userInfo global variable has not been set, therefore the user permissions cannot be verified.'
        );
    }

    if (
        !MXServer.getMXServer()
            .lookup('SECURITY')
            .getProfile(userInfo)
            .hasAppOption(app, optionName) &&
        !isInAdminGroup()
    ) {
        throw new FormError(
            'no_permission',
            'The user ' +
                userInfo.getUserName() +
                ' does not have access to the ' +
                optionName +
                ' option in the ' +
                app +
                ' object structure.'
        );
    }
}

// Determines if the current user is in the administrator group, returns true if the user is, false otherwise.
function isInAdminGroup() {
    var user = userInfo.getUserName();
    service.log_info(
        'Determining if the user ' + user + ' is in the administrator group.'
    );
    var groupUserSet;

    try {
        groupUserSet = MXServer.getMXServer().getMboSet(
            'GROUPUSER',
            MXServer.getMXServer().getSystemUserInfo()
        );

        // Get the ADMINGROUP MAXVAR value.
        var adminGroup = MXServer.getMXServer()
            .lookup('MAXVARS')
            .getString('ADMINGROUP', null);

        // Query for the current user and the found admin group.
        // The current user is determined by the implicity `user` variable.
        sqlFormat = new SqlFormat('userid = :1 and groupname = :2');
        sqlFormat.setObject(1, 'GROUPUSER', 'USERID', user);
        sqlFormat.setObject(2, 'GROUPUSER', 'GROUPNAME', adminGroup);
        groupUserSet.setWhere(sqlFormat.format());

        if (!groupUserSet.isEmpty()) {
            service.log_info(
                'The user ' +
                    user +
                    ' is in the administrator group ' +
                    adminGroup +
                    '.'
            );
            return true;
        } else {
            service.log_info(
                'The user ' +
                    user +
                    ' is not in the administrator group ' +
                    adminGroup +
                    '.'
            );
            return false;
        }
    } finally {
        _close(groupUserSet);
    }
}

// Cleans up the MboSet connections and closes the set.
function _close(set) {
    if (set) {
        try {
            set.cleanup();
            set.close();
            // eslint-disable-next-line no-empty
        } catch (ignored) {}
    }
}

function FormError(reason, message) {
    Error.call(this, message);
    this.reason = reason;
    this.message = message;
}

// ConfigurationError derives from Error
FormError.prototype = Object.create(Error.prototype);
FormError.prototype.constructor = FormError;
FormError.prototype.element;

var scriptConfig = {
    autoscript: 'SHARPTREE.AUTOSCRIPT.FORM',
    description: 'Export Inspection Form',
    version: '1.0.0',
    active: true,
    logLevel: 'ERROR',
};
