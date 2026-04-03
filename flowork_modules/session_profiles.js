//#######################################################################
// WEBSITE https://flowork.cloud
// File NAME : flowork_modules/session_profiles.js
//#1. Dynamic Component Discovery (DCD): Modul ini akan otomatis terdeteksi.
//#2. Atomic Isolation: Khusus menghandle logic Cookies Netscape & Profiling.
//#######################################################################

module.exports = {
    name: 'Session & Profiles Manager',

    init: function(ipcMain, FloworkState, childProcess, pathModule, appModule, baseDir, fs, session) {
        console.log(`[PLUGIN] ${this.name} Loaded Successfully!`);

        function parseNetscapeCookies(cookieString) {
            const cookies = [];
            const lines = cookieString.split('\n');
            for (let line of lines) {
                line = line.trim();
                if (!line || line.startsWith('#')) continue;
                const parts = line.split('\t');
                if (parts.length === 7) {
                    let domainStr = parts[0];
                    let secureBool = parts[3] === 'TRUE';
                    let pathStr = parts[2];

                    let protocol = secureBool ? 'https://' : 'http://';
                    let cleanDomain = domainStr.startsWith('.') ? domainStr.substring(1) : domainStr;
                    let builtUrl = protocol + cleanDomain + pathStr;

                    cookies.push({
                        url: builtUrl,
                        domain: domainStr,
                        path: pathStr,
                        secure: secureBool,
                        expirationDate: parseFloat(parts[4]),
                        name: parts[5],
                        value: parts[6]
                    });
                }
            }
            return cookies;
        }

        ipcMain.handle('app:import-cookies', async (event, id, cookieString) => {
            const views = FloworkState.browserViews;
            if (!views[id]) return { success: false, message: 'Bot not found' };
            const view = views[id];
            const s = view.webContents.session;
            const parsedCookies = parseNetscapeCookies(cookieString);

            let importedCount = 0;
            for (let cookie of parsedCookies) {
                try {
                    await s.cookies.set(cookie);
                    importedCount++;
                } catch (e) {
                    console.error("[Session Plugin] Gagal inject cookie:", e);
                }
            }
            view.webContents.reload();
            return { success: true, count: importedCount };
        });

        ipcMain.handle('app:export-cookies', async (event, id) => {
            const views = FloworkState.browserViews;
            if (!views[id]) return { success: false, data: '' };
            const view = views[id];
            const s = view.webContents.session;
            try {
                const cookies = await s.cookies.get({});
                let netscapeFormat = "# Netscape HTTP Cookie File\n# http://curl.haxx.se/rfc/cookie_spec.html\n# This is a generated file!  Do not edit.\n\n";
                for (let c of cookies) {
                    let domainFlag = c.domain.startsWith('.') ? 'TRUE' : 'FALSE';
                    let secureFlag = c.secure ? 'TRUE' : 'FALSE';
                    let expiry = c.expirationDate ? Math.round(c.expirationDate) : Math.floor(Date.now() / 1000) + 86400;
                    netscapeFormat += `${c.domain}\t${domainFlag}\t${c.path}\t${secureFlag}\t${expiry}\t${c.name}\t${c.value}\n`;
                }
                return { success: true, data: netscapeFormat };
            } catch(e) {
                return { success: false, data: '' };
            }
        });

        ipcMain.handle('app:save-profiles', (event, data) => {
            fs.writeFileSync(FloworkState.profileFile, JSON.stringify(data, null, 2));
            return { success: true };
        });

        ipcMain.handle('app:load-profiles', () => {
            if (fs.existsSync(FloworkState.profileFile)) {
                return JSON.parse(fs.readFileSync(FloworkState.profileFile, 'utf8'));
            }
            return {};
        });
    }
};