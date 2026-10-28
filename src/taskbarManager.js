export class TaskbarManager {
    constructor(extension) {
        if (TaskbarManager._singleton)
            throw new Error('AppIcons Taskbar has been already initialized');
        TaskbarManager._singleton = extension;
    }

    static getDefault() {
        return TaskbarManager._singleton;
    }

    static get customStylesheet() {
        return TaskbarManager.getDefault().customStylesheet;
    }

    static set customStylesheet(stylesheet) {
        TaskbarManager.getDefault().customStylesheet = stylesheet;
    }

    static get extension() {
        return TaskbarManager.getDefault();
    }

    static get notificationsMonitor() {
        return TaskbarManager.getDefault().notificationsMonitor;
    }

    static get persistentStorage() {
        return TaskbarManager.getDefault().persistentStorage;
    }

    static get settings() {
        return TaskbarManager.getDefault().settings;
    }

    static get remoteModel() {
        return TaskbarManager.getDefault().remoteModel;
    }

    destroy() {
        TaskbarManager._singleton = null;
    }
}
