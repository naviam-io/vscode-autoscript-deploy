import { ProgressLocation, window } from 'vscode';

export default async function deployConfig(client, config) {
    await window.withProgress(
        {
            title: 'Deploying Configurations',
            location: ProgressLocation.Notification,
            cancellable: true,
        },
        async (progress, cancelToken) => {
            progress.report({ message: '$(gear) Configuring settings...' });
            await client.postConfig(config, cancelToken, progress);
        }
    );

    return;
}
