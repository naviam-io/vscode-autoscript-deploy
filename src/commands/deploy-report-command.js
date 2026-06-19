import * as path from 'path';
import * as fs from 'fs';
import * as archiver from 'archiver';

import { parseString } from 'xml2js';

import { PassThrough } from 'stream';

import { window, ProgressLocation } from 'vscode';

import MaximoClient from '../maximo/maximo-client';
import Logger from '../logger';

const LOG_SOURCE = 'DeployReportCommand';

export default async function deployReport(client, filePath, report) {
    Logger.info(`Deploying report from ${filePath || 'unknown file'}.`, LOG_SOURCE);
    if (
        !client ||
        client === null ||
        client instanceof MaximoClient === false
    ) {
        Logger.error('Deploy report command failed because the Maximo client is invalid.', null, LOG_SOURCE);
        throw new Error(
            'The client parameter is required and must be an instance of the MaximoClient class.'
        );
    }

    if (!filePath || filePath === null || !fs.existsSync(filePath)) {
        Logger.error(`Deploy report command failed because the file path is invalid: ${filePath || 'empty'}.`, null, LOG_SOURCE);
        throw new Error(
            'The filePath parameter is required and must be a valid file path to a report file.'
        );
    }

    if (!report || report === null || report.trim().length === 0) {
        report = fs.readFileSync(filePath, { encoding: 'utf8' });
    }

    if (!report || report.trim().length <= 0) {
        Logger.error(`Report ${filePath} is empty.`, null, LOG_SOURCE);
        window.showErrorMessage('The selected report cannot be empty.', {
            modal: true,
        });
        return;
    }

    let fileName = path.basename(filePath);
    let reportContent = fs.readFileSync(filePath, 'utf8');

    let reportName = path.basename(fileName, path.extname(fileName));

    let folderPath = path.dirname(filePath);

    // Get the name of the containing folder
    let appName = path.basename(folderPath);

    let reportsXML = folderPath + '/reports.xml';

    if (!fs.existsSync(reportsXML)) {
        Logger.error(`Report deploy failed because ${reportsXML} does not exist.`, null, LOG_SOURCE);
        window.showErrorMessage(
            'The selected report must have a reports.xml in the same folder that describes the report parameters.',
            { modal: true }
        );
        return;
    }

    // Read the XML file
    let xmlContent = fs.readFileSync(reportsXML, 'utf8');

    let reportConfigs = await new Promise((resolve, reject) => {
        parseString(xmlContent, function (error, result) {
            if (error) {
                reject(error);
            } else {
                resolve(result);
            }
        });
    });

    let reportConfig = reportConfigs.reports.report.filter(
        (report) => report.$.name === fileName
    )[0];

    if (
        typeof reportConfig === 'undefined' ||
        reportConfig === null ||
        reportConfig.attribute.length === 0
    ) {
        Logger.error(`Report ${fileName} does not have a valid reports.xml entry.`, null, LOG_SOURCE);
        window.showErrorMessage(
            'The selected report does not have an entry that contains at least one attribute value in the reports.xml.',
            { modal: true }
        );
        return;
    }

    let resourceData = null;
    let resourceFolder = folderPath + '/' + reportName;
    if (
        fs.existsSync(resourceFolder) &&
        fs.readdirSync(resourceFolder).length > 0
    ) {
        resourceData = await createZipFromFolder(resourceFolder);
    }

    let attributes = reportConfig.attribute;

    let reportData = {
        reportName: reportConfig.$.name,
        description:
            attributes.find((attr) => attr.$.name === 'description')?._ ?? null,
        reportFolder:
            attributes.find((attr) => attr.$.name === 'reportfolder')?._ ??
            null,
        appName: appName,
        toolbarLocation:
            attributes.find((attr) => attr.$.name === 'toolbarlocation')?._ ??
            'NONE',
        toolbarIcon:
            attributes.find((attr) => attr.$.name === 'toolbaricon')?._ ?? null,
        toolbarSequence:
            attributes.find((attr) => attr.$.name === 'toolbarsequence')?._ ??
            null,
        noRequestPage:
            attributes.find((attr) => attr.$.name === 'norequestpage')?._ == 1
                ? true
                : false ?? false,
        detail:
            attributes.find((attr) => attr.$.name === 'detail')?._ == 1
                ? true
                : false ?? false,
        useWhereWithParam:
            attributes.find((attr) => attr.$.name === 'usewherewithparam')?._ ==
            1
                ? true
                : false ?? false,
        langCode:
            attributes.find((attr) => attr.$.name === 'langcode')?._ ?? null,
        recordLimit:
            attributes.find((attr) => attr.$.name === 'recordlimit')?._ ?? null,
        browserView:
            attributes.find((attr) => attr.$.name === 'ql')?._ == 1
                ? true
                : false ?? false,
        directPrint:
            attributes.find((attr) => attr.$.name === 'dp')?._ == 1
                ? true
                : false ?? false,
        printWithAttachments:
            attributes.find((attr) => attr.$.name === 'pad')?._ == 1
                ? true
                : false ?? false,
        browserViewLocation:
            attributes.find((attr) => attr.$.name === 'qlloc')?._ ?? 'NONE',
        directPrintLocation:
            attributes.find((attr) => attr.$.name === 'dploc')?._ ?? 'NONE',
        printWithAttachmentsLocation:
            attributes.find((attr) => attr.$.name === 'padloc')?._ ?? 'NONE',
        priority:
            attributes.find((attr) => attr.$.name === 'priority')?._ ?? null,
        scheduleOnly:
            attributes.find((attr) => attr.$.name === 'scheduleonly')?._ == 1
                ? true
                : false ?? false,
        displayOrder:
            attributes.find((attr) => attr.$.name === 'displayorder')?._ ??
            null,
        paramColumns:
            attributes.find((attr) => attr.$.name === 'paramcolumns')?._ ??
            null,
        design: reportContent,
        resources: resourceData,
    };

    if (
        typeof reportConfig.parameters !== 'undefined' &&
        reportConfig.parameters.length == 1 &&
        typeof reportConfig.parameters[0].parameter !== 'undefined' &&
        reportConfig.parameters[0].parameter.length > 0
    ) {
        let parameters = reportConfig.parameters[0].parameter;
        reportData.parameters = [];
        parameters.forEach((parameter) => {
            let attributes = parameter.attribute;

            reportData.parameters.push({
                parameterName: parameter.$.name,
                attributeName:
                    attributes.find((attr) => attr.$.name === 'attributename')
                        ?._ ?? null,
                defaultValue:
                    attributes.find((attr) => attr.$.name === 'defaultvalue')
                        ?._ ?? null,
                labelOverride:
                    attributes.find((attr) => attr.$.name === 'labeloverride')
                        ?._ ?? null,
                sequence:
                    attributes.find((attr) => attr.$.name === 'sequence')?._ ??
                    null,
                lookupName:
                    attributes.find((attr) => attr.$.name === 'lookupname')
                        ?._ ?? null,
                required:
                    attributes.find((attr) => attr.$.name === 'required')?._ ==
                    1
                        ? true
                        : false ?? false,
                hidden:
                    attributes.find((attr) => attr.$.name === 'hidden')?._ == 1
                        ? true
                        : false ?? false,
                multiLookup:
                    attributes.find((attr) => attr.$.name === 'multilookup')
                        ?._ == 1
                        ? true
                        : false ?? false,
                operator:
                    attributes.find((attr) => attr.$.name === 'operator')?._ ??
                    null,
            });
        });
    }

    await window.withProgress(
        {
            cancellable: false,
            title: 'Report',
            location: ProgressLocation.Notification,
        },
        async (progress) => {
            progress.report({
                message: `Deploying report ${fileName}`,
                increment: 0,
            });

            await new Promise((resolve) => setTimeout(resolve, 500));
            let result = await client.postReport(
                reportData,
                progress,
                fileName
            );

            if (result) {
                if (result.status === 'error') {
                    Logger.error(`Report deploy failed for ${fileName}: ${result.message || JSON.stringify(result)}`, null, LOG_SOURCE);
                    if (result.message) {
                        window.showErrorMessage(result.message, {
                            modal: true,
                        });
                    } else if (result.cause) {
                        window.showErrorMessage(
                            `Error: ${JSON.stringify(result.cause)}`,
                            { modal: true }
                        );
                    } else {
                        window.showErrorMessage(
                            'An unknown error occurred: ' +
                                JSON.stringify(result),
                            { modal: true }
                        );
                    }
                } else {
                    progress.report({
                        increment: 100,
                        message: `Successfully deployed ${fileName}`,
                    });
                    await new Promise((resolve) => setTimeout(resolve, 2000));
                    Logger.info(`Report ${fileName} deployed successfully.`, LOG_SOURCE);
                }
            } else {
                Logger.error(`Report deploy did not receive a response from Maximo for ${fileName}.`, null, LOG_SOURCE);
                window.showErrorMessage(
                    'Did not receive a response from Maximo.',
                    { modal: true }
                );
            }
            return result;
        }
    );
}

async function createZipFromFolder(folderPath) {
    let result = await new Promise((resolve, reject) => {
        const archive = archiver('zip', {
            zlib: { level: 9 }, // Sets the compression level.
        });

        const bufferStream = new PassThrough();
        let chunks = [];

        bufferStream.on('data', (chunk) => {
            chunks.push(chunk);
        });

        // Good practice to catch warnings (like stat failures and other non-blocking errors)
        archive.on('warning', function (err) {
            if (err.code === 'ENOENT') {
                Logger.warn(err.message || String(err), LOG_SOURCE);
            } else {
                // Throw error for any unexpected warning
                Logger.error(`Report resource archive failed for ${folderPath}.`, err, LOG_SOURCE);
                reject(err);
            }
        });

        // Catch errors explicitly
        archive.on('error', function (err) {
            Logger.error(`Report resource archive failed for ${folderPath}.`, err, LOG_SOURCE);
            reject(err);
        });

        archive.on('finish', function () {
            const fullBuffer = Buffer.concat(chunks);
            const base64String = fullBuffer.toString('base64');
            resolve(base64String);
        });

        // Pipe archive data to the file
        archive.pipe(bufferStream);

        // // Append files from a directory
        archive.directory(folderPath, false);

        // Finalize the archive (ie we are done appending files but streams have to finish yet)
        // 'close', 'end' or 'finish' may be fired right after calling this method so register to them beforehand
        archive.finalize();
    });

    return result;
}
