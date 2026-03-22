//#######################################################################
// WEBSITE https://flowork.cloud
// File NAME : flowork_modules/automation_engine.js
//#1. Dynamic Component Discovery (DCD): Modul ini akan otomatis terdeteksi.
//#2. Atomic Isolation: Khusus menghandle logic Auto-Scroll, Auto-Refresh & Cache.
//#######################################################################

module.exports = {
    name: 'Automation Engine',

    init: function(ipcMain, FloworkState, childProcess, pathModule, appModule, baseDir, fs, session) {
        console.log(`[PLUGIN] ${this.name} Loaded Successfully!`);

        ipcMain.handle('app:start-auto-refresh', (event, intervalSec) => {
            if (FloworkState.autoRefreshIntervalId) clearInterval(FloworkState.autoRefreshIntervalId);

            FloworkState.autoRefreshIntervalId = setInterval(() => {
                const views = FloworkState.browserViews;
                const states = FloworkState.botSleepStates;
                for (const id in views) {
                    if (views[id] && !views[id].webContents.isDestroyed()) {
                        if (states[id] && states[id].isSleeping) continue;
                        views[id].webContents.reload();
                    }
                }
            }, intervalSec * 1000);
            return { success: true };
        });

        ipcMain.handle('app:stop-auto-refresh', () => {
            if (FloworkState.autoRefreshIntervalId) {
                clearInterval(FloworkState.autoRefreshIntervalId);
                FloworkState.autoRefreshIntervalId = null;
            }
            return { success: true };
        });

        ipcMain.handle('app:auto-scroll-all', (event, { minSec, maxSec, totalScroll, scrollUp }) => {
            const views = FloworkState.browserViews;
            const tasks = FloworkState.autoScrollTasks;
            const sleepStates = FloworkState.botSleepStates;

            for (const id in views) {
                if (!tasks[id]) {
                    let currentTotal = totalScroll || 100;
                    let currentUp = scrollUp || 20;
                    let currentDone = 0;

                    const randomScrollTask = () => {
                        if (views[id] && !views[id].webContents.isDestroyed()) {

                            if (sleepStates[id] && sleepStates[id].isSleeping) {
                                tasks[id] = setTimeout(randomScrollTask, 2000);
                                return;
                            }

                            if (currentDone >= currentTotal) {
                                clearTimeout(tasks[id]);
                                delete tasks[id];
                                return;
                            }

                            let remainingSteps = currentTotal - currentDone;
                            let direction = 'down';

                            if (currentUp > 0) {
                                let chanceToUp = currentUp / remainingSteps;
                                if (Math.random() < chanceToUp) {
                                    direction = 'up';
                                }
                            }

                            if (direction === 'up') {
                                views[id].webContents.sendInputEvent({ type: 'keyDown', keyCode: 'ArrowUp' });
                                views[id].webContents.sendInputEvent({ type: 'keyUp', keyCode: 'ArrowUp' });
                                views[id].webContents.sendInputEvent({ type: 'mouseWheel', deltaX: 0, deltaY: 600, x: 200, y: 200 });

                                views[id].webContents.executeJavaScript(`
                                    var _step = 0;
                                    var _iv = setInterval(function() { window.scrollBy(0, -50); _step += 50; if(_step >= 600) clearInterval(_iv); }, 50);
                                `).catch(()=>{});

                                currentUp--;
                            } else {
                                views[id].webContents.sendInputEvent({ type: 'keyDown', keyCode: 'ArrowDown' });
                                views[id].webContents.sendInputEvent({ type: 'keyUp', keyCode: 'ArrowDown' });
                                views[id].webContents.sendInputEvent({ type: 'mouseWheel', deltaX: 0, deltaY: -600, x: 200, y: 200 });

                                views[id].webContents.executeJavaScript(`
                                    var _step = 0;
                                    var _iv = setInterval(function() { window.scrollBy(0, 50); _step += 50; if(_step >= 600) clearInterval(_iv); }, 50);
                                `).catch(()=>{});
                            }

                            currentDone++;

                            tasks[id] = setTimeout(randomScrollTask, (Math.floor(Math.random() * (maxSec - minSec + 1)) + minSec) * 1000);
                        }
                    };
                    tasks[id] = setTimeout(randomScrollTask, (Math.floor(Math.random() * (maxSec - minSec + 1)) + minSec) * 1000);
                }
            }
        });

        ipcMain.handle('app:stop-scroll-all', () => {
            const tasks = FloworkState.autoScrollTasks;
            for (const id in tasks) {
                clearTimeout(tasks[id]);
                delete tasks[id];
            }
        });

        ipcMain.handle('app:clear-cache', async () => {
            await session.defaultSession.clearCache();
            if (FloworkState.mainWindow) FloworkState.mainWindow.loadFile(pathModule.join(baseDir, 'index.html'));
            return { success: true };
        });

        ipcMain.handle('app:reset', async () => {
            await session.defaultSession.clearCache();
            await session.defaultSession.clearStorageData();
            appModule.relaunch();
            appModule.exit(0);
            return { success: true };
        });
    }
};