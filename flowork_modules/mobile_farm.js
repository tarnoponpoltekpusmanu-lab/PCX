//#######################################################################
// WEBSITE https://flowork.cloud
// File NAME : flowork_modules/mobile_farm.js
//#1. Dynamic Component Discovery (DCD): Modul ini akan otomatis terdeteksi.
//#2. Atomic Isolation: Khusus menghandle logic ADB & Scrcpy Mobile Farm.
//#######################################################################

const http = require('http');
const net = require('net');
const WebSocket = require('ws');
const os = require('os');
const fs = require('fs');
const { dialog, clipboard } = require('electron');

module.exports = {
    name: 'Mobile Farm (ADB & Scrcpy Integration)',

    init: function(ipcMain, FloworkState, childProcess, pathModule, appModule, baseDir) {
        const { exec, spawn } = childProcess;
        const isPackaged = appModule.isPackaged;
        let adbPath = pathModule.join(baseDir, 'runtimes', 'adb', 'adb.exe');
        let scrcpyPath = pathModule.join(baseDir, 'runtimes', 'adb', 'scrcpy.exe');

        let jadxPath = pathModule.join(baseDir, 'runtimes', 'jadx', 'bin', os.platform() === 'win32' ? 'jadx.bat' : 'jadx');
        let jdkPath = pathModule.join(baseDir, 'runtimes', 'jdk');

        let apktoolPath = pathModule.join(baseDir, 'runtimes', 'apktool', os.platform() === 'win32' ? 'apktool.bat' : 'apktool');
        let ffmpegPath = pathModule.join(baseDir, 'runtimes', 'ffmpeg', 'bin', os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');

        let zipalignPath = pathModule.join(baseDir, 'runtimes', 'build-tools', os.platform() === 'win32' ? 'zipalign.exe' : 'zipalign');
        let apksignerJar = pathModule.join(baseDir, 'runtimes', 'build-tools', 'apksigner.jar');

        if (isPackaged) {
            const exeDir = pathModule.dirname(appModule.getPath('exe'));
            adbPath = pathModule.join(exeDir, 'runtimes', 'adb', 'adb.exe');
            scrcpyPath = pathModule.join(exeDir, 'runtimes', 'adb', 'scrcpy.exe');
            jadxPath = pathModule.join(exeDir, 'runtimes', 'jadx', 'bin', os.platform() === 'win32' ? 'jadx.bat' : 'jadx');
            jdkPath = pathModule.join(exeDir, 'runtimes', 'jdk');
            apktoolPath = pathModule.join(exeDir, 'runtimes', 'apktool', os.platform() === 'win32' ? 'apktool.bat' : 'apktool');
            ffmpegPath = pathModule.join(exeDir, 'runtimes', 'ffmpeg', 'bin', os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
            zipalignPath = pathModule.join(exeDir, 'runtimes', 'build-tools', os.platform() === 'win32' ? 'zipalign.exe' : 'zipalign');
            apksignerJar = pathModule.join(exeDir, 'runtimes', 'build-tools', 'apksigner.jar');
        }

        console.log(`[PLUGIN] ${this.name} Loaded Successfully!`);

        const activeStreams = {};
        const activeShells = {};
        const deviceResolutions = {};
        const activeRecordings = {};
        const activeLives = {};

        if (!FloworkState.farmServerRunning) {
            const wss = new WebSocket.Server({ port: 8080 });
            console.log("[Mobile Farm] WebSocket Pipa Server Aktif di port 8080!");

            wss.on('connection', (ws, req) => {
                const parsedUrl = new URL(req.url, 'http://localhost');
                const serial = parsedUrl.searchParams.get('serial');

                if (!serial) {
                    ws.close();
                    return;
                }

                console.log(`[Mobile Farm] Web Client tersambung ke HP: ${serial}`);

                exec(`"${adbPath}" -s ${serial} shell wm size`, { windowsHide: true }, (err, stdout) => {
                    if (!err && stdout) {
                        const match = stdout.match(/(?:Override size|Physical size): (\d+)x(\d+)/);
                        if (match) {
                            deviceResolutions[serial] = { w: parseInt(match[1]), h: parseInt(match[2]) };
                            console.log(`[Mobile Farm] Resolusi Asli HP Terdeteksi: ${match[1]}x${match[2]}`);
                        }
                    }
                });

                let isStreamIntentionalClose = false;

                const startScreenRecord = () => {
                    if (isStreamIntentionalClose || ws.readyState !== WebSocket.OPEN) return;

                    const streamProcess = spawn(adbPath, [
                        '-s', serial, 'exec-out', 'screenrecord',
                        '--output-format=h264', '--bit-rate', '800000', '--time-limit', '180', '-'
                    ], { windowsHide: true });

                    streamProcess.stdout.on('data', (data) => {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(data);
                        }
                    });

                    streamProcess.on('exit', () => {
                        if (!isStreamIntentionalClose && ws.readyState === WebSocket.OPEN) {
                            console.log(`[Mobile Farm] Me-restart stream otomatis untuk HP: ${serial}`);
                            startScreenRecord();
                        }
                    });

                    activeStreams[serial] = streamProcess;
                };

                startScreenRecord();

                setTimeout(() => {
                    exec(`"${adbPath}" -s ${serial} shell input swipe 500 500 500 500 1`, { windowsHide: true }, (err) => {
                        if(err) {
                            console.error(`[Mobile Farm] Gagal memicu refresh layar (Micro-swipe):`, err);
                        } else {
                            console.log(`[Mobile Farm] Pancingan frame pertama berhasil dikirim ke layar HP: ${serial}`);
                        }
                    });
                }, 1500);

                const shellProcess = spawn(adbPath, ['-s', serial, 'shell'], { windowsHide: true });
                activeShells[serial] = shellProcess;

                ws.on('message', (message) => {
                    try {
                        const cmd = JSON.parse(message);
                        const res = deviceResolutions[serial] || { w: 1080, h: 2400 };

                        if (cmd.type === 'click') {
                            if (activeShells[serial] && !activeShells[serial].killed) {
                                const targetX = Math.floor(cmd.px * res.w);
                                const targetY = Math.floor(cmd.py * res.h);
                                activeShells[serial].stdin.write(`input tap ${targetX} ${targetY} &\n`);
                            }
                        } else if (cmd.type === 'swipe') {
                            if (activeShells[serial] && !activeShells[serial].killed) {
                                const tX1 = Math.floor(cmd.px1 * res.w);
                                const tY1 = Math.floor(cmd.py1 * res.h);
                                const tX2 = Math.floor(cmd.px2 * res.w);
                                const tY2 = Math.floor(cmd.py2 * res.h);
                                activeShells[serial].stdin.write(`input swipe ${tX1} ${tY1} ${tX2} ${tY2} ${cmd.duration} &\n`);
                            }
                        }
                        else if (cmd.type === 'text') {
                            if (activeShells[serial] && !activeShells[serial].killed) {
                                const safeText = cmd.text.replace(/ /g, '%s');
                                activeShells[serial].stdin.write(`input text "${safeText}" &\n`);
                            }
                        }
                        else if (cmd.type === 'keyevent') {
                            if (activeShells[serial] && !activeShells[serial].killed) {
                                activeShells[serial].stdin.write(`input keyevent ${cmd.keycode} &\n`);
                            }
                        }
                    } catch (e) {
                        console.error("[Mobile Farm] Kesalahan baca pesan WS:", e);
                    }
                });

                ws.on('close', () => {
                    console.log(`[Mobile Farm] Web Client terputus dari HP: ${serial}`);
                    isStreamIntentionalClose = true;

                    if (activeStreams[serial]) {
                        activeStreams[serial].kill();
                        delete activeStreams[serial];
                    }
                    if (activeShells[serial]) {
                        activeShells[serial].kill();
                        delete activeShells[serial];
                    }
                });
            });

            FloworkState.farmServerRunning = true;
        }

        ipcMain.handle('app:get-adb-devices', () => {
            return new Promise((resolve, reject) => {
                exec(`"${adbPath}" devices -l`, { windowsHide: true }, (error, stdout) => {
                    if (error) return reject(error);
                    const lines = stdout.split('\n');
                    const devices = [];
                    for (let i = 1; i < lines.length; i++) {
                        const line = lines[i].trim();
                        if (!line) continue;
                        const parts = line.split(/\s+/);
                        if (parts.length >= 2) {
                            const serial = parts[0];
                            const state = parts[1];
                            let model = 'Unknown';
                            const modelMatch = line.match(/model:(\S+)/);
                            if (modelMatch) model = modelMatch[1].replace(/_/g, ' ');
                            devices.push({ serial, state, model });
                        }
                    }
                    resolve(devices);
                });
            });
        });

        ipcMain.handle('app:start-scrcpy', (event, serial) => {
            const scrcpyProcess = spawn(scrcpyPath, [
                '-s', serial,
                '--window-title', `Flowork Scrcpy Engine - ${serial}`,
                '--max-fps', '60',
                '--video-codec', 'h264'
            ], { windowsHide: false });

            scrcpyProcess.unref();
            return { success: true, streamUrl: `http://localhost:8080/stream?serial=${serial}`, serial: serial };
        });

        ipcMain.handle('app:start-live-yt', (event, serial, streamKey) => {
            return new Promise((resolve) => {
                if (activeLives[serial]) {
                    return resolve({ success: false, error: "HP ini sedang Live Stream!" });
                }

                if (!fs.existsSync(ffmpegPath)) {
                    return resolve({ success: false, error: "FFmpeg tidak ditemukan di runtimes/ffmpeg/bin/ffmpeg.exe!" });
                }

                console.log(`[Mobile Farm] 📺 Memulai Live YouTube untuk ${serial}...`);
                const rtmpUrl = `rtmp://a.rtmp.youtube.com/live2/${streamKey}`;

                const adbRecProcess = spawn(adbPath, [
                    '-s', serial, 'exec-out', 'screenrecord',
                    '--output-format=h264', '--bit-rate', '4000000', '-'
                ], { windowsHide: true });

                const ffmpegProcess = spawn(ffmpegPath, [
                    '-thread_queue_size', '1024',
                    '-f', 'h264', '-i', 'pipe:0',
                    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
                    '-c:v', 'libx264',
                    '-preset', 'ultrafast',
                    '-tune', 'zerolatency',
                    '-b:v', '2500k',
                    '-maxrate', '2500k',
                    '-bufsize', '5000k',
                    '-pix_fmt', 'yuv420p',
                    '-g', '60',
                    '-c:a', 'aac', '-b:a', '128k',
                    '-f', 'flv', rtmpUrl
                ], { windowsHide: true });

                adbRecProcess.stdout.pipe(ffmpegProcess.stdin);

                ffmpegProcess.on('exit', () => {
                    console.log(`[Mobile Farm] Pipa FFmpeg Terputus untuk: ${serial}`);
                    if (activeLives[serial]) {
                        activeLives[serial].adb.kill();
                        delete activeLives[serial];
                    }
                });

                activeLives[serial] = {
                    adb: adbRecProcess,
                    ffmpeg: ffmpegProcess
                };

                resolve({ success: true, message: "Engine FFmpeg berhasil disambungkan. Cek YouTube Live Dashboard Anda!" });
            });
        });

        ipcMain.handle('app:stop-live-yt', (event, serial) => {
            return new Promise((resolve) => {
                if (!activeLives[serial]) {
                    return resolve({ success: false, error: "Tidak ada live aktif untuk HP ini." });
                }

                console.log(`[Mobile Farm] ⏹️ Menghentikan Live YT untuk ${serial}...`);

                activeLives[serial].adb.kill();
                activeLives[serial].ffmpeg.kill();
                delete activeLives[serial];

                resolve({ success: true, message: "Live Stream YouTube Dihentikan." });
            });
        });

        ipcMain.handle('app:select-file', async () => {
            const result = await dialog.showOpenDialog({ properties: ['openFile'] });
            return result.canceled ? null : result.filePaths[0];
        });

        ipcMain.handle('app:select-save-directory', async () => {
            const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
            return result.canceled ? null : result.filePaths[0];
        });

        ipcMain.handle('app:adb-push', async (event, serial, localPath, remotePath) => {
            return new Promise((resolve) => {
                exec(`"${adbPath}" -s ${serial} push "${localPath}" "${remotePath}"`, { windowsHide: true }, (err) => {
                    if(err) resolve({ success: false, error: err.message });
                    else resolve({ success: true });
                });
            });
        });

        ipcMain.handle('app:native-paste', async (event, serial, text) => {
            return new Promise((resolve) => {
                const escapedText = text.replace(/'/g, "\\'").replace(/"/g, '\\"');

                exec(`"${adbPath}" -s ${serial} shell "echo '${escapedText}' | cmd clipboard set"`, { windowsHide: true }, (err) => {
                    if (err) {
                        const fallbackText = text.replace(/ /g, '%s').replace(/'/g, "\\'").replace(/"/g, '\\"');
                        exec(`"${adbPath}" -s ${serial} shell input text "${fallbackText}"`, { windowsHide: true });
                        resolve({ success: true });
                    } else {
                        exec(`"${adbPath}" -s ${serial} shell input keyevent 279`, { windowsHide: true }, () => {
                             resolve({ success: true });
                        });
                    }
                });
            });
        });

        ipcMain.handle('app:adb-input-text', async (event, serial, text) => {
            return new Promise((resolve) => {
                const escapedText = text.replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/ /g, '%s');
                exec(`"${adbPath}" -s ${serial} shell input text "${escapedText}"`, { windowsHide: true }, (err) => { resolve({ success: !err }); });
            });
        });

        ipcMain.handle('app:sync-clipboard-pc-to-hp', async (event, serial) => {
            return new Promise((resolve) => {
                const pcText = clipboard.readText();
                if(!pcText || pcText.trim() === '') return resolve({ success: false, error: "Clipboard kosong!" });
                const escapedText = pcText.replace(/'/g, "\\'").replace(/"/g, '\\"');
                exec(`"${adbPath}" -s ${serial} shell "echo '${escapedText}' | cmd clipboard set"`, { windowsHide: true }, (err) => {
                    if (err) exec(`"${adbPath}" -s ${serial} shell input text "${escapedText.replace(/ /g, '%s')}"`, { windowsHide: true });
                    resolve({ success: true, text: pcText });
                });
            });
        });

        ipcMain.handle('app:start-recording', (event, serial) => {
            return new Promise((resolve) => {
                if (activeRecordings[serial]) {
                    return resolve({ success: false, error: "HP ini sedang dalam mode perekaman!" });
                }

                const timestamp = new Date().getTime();
                const remotePath = `/sdcard/flowork_rec_${timestamp}.mp4`;

                console.log(`[Mobile Farm] 🔴 Memulai rekaman layar untuk ${serial} di ${remotePath}`);

                const recProcess = spawn(adbPath, [
                    '-s', serial, 'shell', 'screenrecord', '--bit-rate', '4000000', remotePath
                ], { windowsHide: true });

                activeRecordings[serial] = {
                    process: recProcess,
                    remotePath: remotePath,
                    timestamp: timestamp
                };

                resolve({ success: true, message: "Recording started", remotePath });
            });
        });

        ipcMain.handle('app:stop-recording', (event, serial) => {
             return new Promise((resolve) => {
                 if (!activeRecordings[serial]) {
                     return resolve({ success: false, error: "Tidak ada rekaman aktif untuk HP ini." });
                 }

                 console.log(`[Mobile Farm] ⏹️ Menghentikan rekaman untuk ${serial}...`);
                 const recData = activeRecordings[serial];

                 exec(`"${adbPath}" -s ${serial} shell pkill -2 screenrecord`, { windowsHide: true }, (killErr) => {
                     setTimeout(() => {
                         const destFolder = pathModule.join(os.homedir(), 'Downloads', 'Flowork_Records');
                         if (!fs.existsSync(destFolder)) fs.mkdirSync(destFolder, { recursive: true });

                         const destFile = pathModule.join(destFolder, `Recording_${serial}_${recData.timestamp}.mp4`);

                         console.log(`[Mobile Farm] 📥 Menyedot hasil rekaman ke PC: ${destFile}`);

                         exec(`"${adbPath}" -s ${serial} pull "${recData.remotePath}" "${destFile}"`, { windowsHide: true, maxBuffer: 1024 * 1024 * 500 }, (pullErr) => {

                             exec(`"${adbPath}" -s ${serial} shell rm "${recData.remotePath}"`, { windowsHide: true });

                             delete activeRecordings[serial];

                             if (pullErr) {
                                 resolve({ success: false, error: `Gagal menyedot video: ${pullErr.message}` });
                             } else {
                                 resolve({ success: true, path: destFile, message: "Rekaman berhasil disimpan di folder Downloads/Flowork_Records!" });
                             }
                         });
                     }, 2500);
                 });
             });
        });

        ipcMain.handle('app:inspect-apk', (event, serial, packageName) => {
            return new Promise((resolve, reject) => {
                exec(`"${adbPath}" -s ${serial} shell dumpsys package ${packageName}`, { windowsHide: true, maxBuffer: 1024 * 1024 * 10 }, (error, stdout) => {
                    if (error) {
                        return resolve({ success: false, error: error.message });
                    }
                    resolve({ success: true, data: stdout });
                });
            });
        });

        ipcMain.handle('app:start-logcat', (event, serial, packageName) => {
            const logcatProcess = spawn(adbPath, ['-s', serial, 'shell', `logcat --pid=$(pidof -s ${packageName})`], { windowsHide: true });

            logcatProcess.stdout.on('data', (data) => {
                if (event.sender && !event.sender.isDestroyed()) {
                    event.sender.send('engine:app-logcat-data', data.toString());
                }
            });

            return { success: true, message: "Logcat stream started" };
        });

        ipcMain.handle('app:get-top-app', (event, serial) => {
            return new Promise((resolve) => {
                exec(`"${adbPath}" -s ${serial} shell dumpsys window`, { windowsHide: true, maxBuffer: 1024 * 1024 * 10 }, (error, stdout) => {
                    if (error || !stdout) {
                        return resolve({ success: false, error: "Gagal membaca sistem UI Android. Pastikan HP menyala." });
                    }

                    const lines = stdout.split('\n');
                    let pkgName = null;

                    const focusLine = lines.find(l => l.includes('mCurrentFocus=') && !l.includes('null'));
                    if (focusLine) {
                        const match = focusLine.match(/([a-zA-Z0-9_.-]+)\//);
                        if (match && match[1]) pkgName = match[1].trim();
                    }

                    if (!pkgName) {
                        const appLine = lines.find(l => l.includes('mFocusedApp=') && !l.includes('null'));
                        if (appLine) {
                            const match = appLine.match(/([a-zA-Z0-9_.-]+)\//);
                            if (match && match[1]) pkgName = match[1].trim();
                        }
                    }

                    if (pkgName) {
                        if (pkgName.includes('launcher') || pkgName.includes('systemui') || pkgName === 'android') {
                            resolve({ success: false, error: "Layar di Home Screen. Buka aplikasinya dulu bos." });
                        } else {
                            resolve({ success: true, packageName: pkgName });
                        }
                    } else {
                        resolve({ success: false, error: "Gagal ekstrak nama package. Layar mungkin mati." });
                    }
                });
            });
        });

        ipcMain.handle('app:pull-apk', (event, serial, packageName) => {
            return new Promise((resolve) => {
                console.log(`[Mobile Farm] Melacak lokasi base.apk untuk: ${packageName}`);

                exec(`"${adbPath}" -s ${serial} shell pm path ${packageName}`, { windowsHide: true }, (error, stdout) => {
                    if (error || !stdout) {
                        return resolve({ success: false, error: "Gagal menemukan APK di HP. Apakah aplikasi terinstall?" });
                    }

                    const match = stdout.match(/package:(.+)/);
                    if (match && match[1]) {
                        const apkPathOnPhone = match[1].trim();
                        const destFolder = pathModule.join(os.homedir(), 'Downloads');
                        const destFile = pathModule.join(destFolder, `${packageName}.apk`);

                        console.log(`[Mobile Farm] Menyedot APK ke PC: ${destFile}`);

                        exec(`"${adbPath}" -s ${serial} pull "${apkPathOnPhone}" "${destFile}"`, { windowsHide: true, maxBuffer: 1024 * 1024 * 50 }, (pullErr, pullOut) => {
                            if (pullErr) {
                                return resolve({ success: false, error: `Gagal menyedot APK. Error: ${pullErr.message}` });
                            }
                            resolve({ success: true, path: destFile });
                        });
                    } else {
                        resolve({ success: false, error: "Path APK tidak valid dari sistem Android." });
                    }
                });
            });
        });

        ipcMain.handle('app:decompile-apk', (event, serial, packageName, ramLimit) => {
            return new Promise((resolve) => {
                console.log(`[Mobile Farm] Melacak lokasi base.apk untuk Decompile: ${packageName}`);

                exec(`"${adbPath}" -s ${serial} shell pm path ${packageName}`, { windowsHide: true }, (error, stdout) => {
                    if (error || !stdout) {
                        return resolve({ success: false, error: "Gagal menemukan APK di HP." });
                    }

                    const match = stdout.match(/package:(.+)/);
                    if (match && match[1]) {
                        const apkPathOnPhone = match[1].trim();
                        const destFolder = pathModule.join(os.homedir(), 'Downloads');
                        const destFile = pathModule.join(destFolder, `${packageName}.apk`);
                        const sourceFolder = pathModule.join(destFolder, `${packageName}_src`);

                        console.log(`[Mobile Farm] Menyedot APK sebelum di-decompile: ${destFile}`);

                        exec(`"${adbPath}" -s ${serial} pull "${apkPathOnPhone}" "${destFile}"`, { windowsHide: true, maxBuffer: 1024 * 1024 * 50 }, (pullErr) => {
                            if (pullErr) {
                                return resolve({ success: false, error: `Gagal menyedot APK: ${pullErr.message}` });
                            }

                            const ramToUse = ramLimit || 4;
                            console.log(`[Mobile Farm] Berhasil pull, memulai Decompile dengan JADX ke: ${sourceFolder} (RAM Limit: ${ramToUse}GB)`);

                            const jadxProc = exec(`"${jadxPath}" -j 8 -d "${sourceFolder}" "${destFile}"`, {
                                windowsHide: true,
                                maxBuffer: 1024 * 1024 * 500,
                                env: {
                                    ...process.env,
                                    JAVA_HOME: jdkPath,
                                    JAVA_OPTS: `-Xmx${ramToUse}g`
                                }
                            }, (jadxErr, jadxOut, jadxStderr) => {

                                const cleanUpJunk = () => {
                                    const junkDirs = [
                                        'sources/android',
                                        'sources/androidx',
                                        'sources/com/google',
                                        'sources/com/facebook',
                                        'sources/com/appsflyer',
                                        'sources/kotlin',
                                        'sources/kotlinx',
                                        'sources/okhttp3',
                                        'sources/retrofit2',
                                        'sources/io/reactivex',
                                        'sources/org/intellij',
                                        'sources/org/jetbrains'
                                    ];
                                    let deletedCount = 0;

                                    junkDirs.forEach(relPath => {
                                        const fullPath = pathModule.join(sourceFolder, ...relPath.split('/'));
                                        if (fs.existsSync(fullPath)) {
                                            fs.rmSync(fullPath, { recursive: true, force: true });
                                            deletedCount++;
                                        }
                                    });
                                    return deletedCount;
                                };

                                if (jadxErr) {
                                    if (fs.existsSync(sourceFolder)) {
                                        const delCount = cleanUpJunk();
                                        return resolve({
                                            success: true,
                                            path: sourceFolder,
                                            warning: `Proses selesai dengan Warning. Flowork telah menghapus ${delCount} folder library bawaan (Google, Facebook, AndroidX, dll) agar folder lebih bersih!`
                                        });
                                    } else {
                                        const detailErr = jadxStderr ? jadxStderr.toString().trim() : (jadxOut ? jadxOut.toString().trim() : "Unknown JADX Exception");
                                        return resolve({ success: false, error: `Command failed\n[!] DETAIL: ${detailErr}` });
                                    }
                                }

                                const delCount = cleanUpJunk();

                                try {
                                    const buildGradle = `// 🚀 Auto-Generated by Flowork Mobile Farm
// Tujuannya agar Android Studio meng-index folder JADX ini sebagai Java Project Resmi

buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath 'com.android.tools.build:gradle:8.1.0'
    }
}

apply plugin: 'com.android.application'

android {
    namespace '${packageName}'
    compileSdk 34

    defaultConfig {
        applicationId "${packageName}"
        minSdk 21
        targetSdk 34
    }

    sourceSets {
        main {
            manifest.srcFile 'resources/AndroidManifest.xml'
            java.srcDirs = ['sources']
            res.srcDirs = ['resources/res']
            assets.srcDirs = ['resources/assets']
        }
    }
}

repositories {
    google()
    mavenCentral()
}
`;
                                    fs.writeFileSync(pathModule.join(sourceFolder, 'build.gradle'), buildGradle);
                                    fs.writeFileSync(pathModule.join(sourceFolder, 'settings.gradle'), `rootProject.name = "${packageName}_Decompiled"\n`);
                                    console.log(`[Mobile Farm] Berhasil menyuntikkan build.gradle ke ${sourceFolder}`);
                                } catch (e) {
                                    console.error(`[Mobile Farm] Gagal menyuntikkan build.gradle:`, e);
                                }

                                resolve({
                                    success: true,
                                    path: sourceFolder,
                                    warning: `Flowork telah otomatis menyuntikkan file build.gradle dan menghapus ${delCount} folder library bawaan. Anda kini bisa membuka folder hasil ekstrak langsung ke dalam Android Studio!`
                                });
                            });

                            jadxProc.stdout.on('data', (data) => {
                                if (event.sender && !event.sender.isDestroyed()) {
                                    event.sender.send('engine:decompile-progress', data.toString());
                                }
                            });
                            jadxProc.stderr.on('data', (data) => {
                                if (event.sender && !event.sender.isDestroyed()) {
                                    event.sender.send('engine:decompile-progress', data.toString());
                                }
                            });

                        });
                    } else {
                        resolve({ success: false, error: "Path APK tidak valid." });
                    }
                });
            });
        });

        ipcMain.handle('app:disassemble-apktool', (event, serial, packageName) => {
            return new Promise((resolve) => {
                console.log(`[Mobile Farm] Melacak lokasi base.apk untuk Apktool: ${packageName}`);

                exec(`"${adbPath}" -s ${serial} shell pm path ${packageName}`, { windowsHide: true }, (error, stdout) => {
                    if (error || !stdout) {
                        return resolve({ success: false, error: "Gagal menemukan APK di HP." });
                    }

                    const match = stdout.match(/package:(.+)/);
                    if (match && match[1]) {
                        const apkPathOnPhone = match[1].trim();
                        const destFolder = pathModule.join(os.homedir(), 'Downloads');
                        const destFile = pathModule.join(destFolder, `${packageName}.apk`);

                        const sourceFolder = pathModule.join(destFolder, `${packageName}_smali`);

                        console.log(`[Mobile Farm] Menyedot APK sebelum di-disassemble (Apktool): ${destFile}`);

                        exec(`"${adbPath}" -s ${serial} pull "${apkPathOnPhone}" "${destFile}"`, { windowsHide: true, maxBuffer: 1024 * 1024 * 50 }, (pullErr) => {
                            if (pullErr) {
                                return resolve({ success: false, error: `Gagal menyedot APK: ${pullErr.message}` });
                            }

                            console.log(`[Mobile Farm] Berhasil pull, memulai Disassemble dengan Apktool ke: ${sourceFolder}`);

                            const apktoolProc = exec(`"${apktoolPath}" d -f "${destFile}" -o "${sourceFolder}"`, {
                                windowsHide: true,
                                maxBuffer: 1024 * 1024 * 500,
                                env: {
                                    ...process.env,
                                    JAVA_HOME: jdkPath
                                }
                            }, (apkErr, apkOut, apkStderr) => {
                                if (apkErr) {
                                     const detailErr = apkStderr ? apkStderr.toString().trim() : (apkOut ? apkOut.toString().trim() : "Unknown Apktool Exception");
                                     return resolve({ success: false, error: `Apktool failed\n[!] DETAIL: ${detailErr}` });
                                }

                                resolve({
                                    success: true,
                                    path: sourceFolder,
                                    message: `Berhasil mengekstrak kode Smali & Resources menggunakan Apktool. Folder siap untuk proses Modding & Rebuild!`
                                });
                            });

                            apktoolProc.stdout.on('data', (data) => {
                                if (event.sender && !event.sender.isDestroyed()) {
                                    event.sender.send('engine:apktool-progress', data.toString());
                                }
                            });
                            apktoolProc.stderr.on('data', (data) => {
                                if (event.sender && !event.sender.isDestroyed()) {
                                    event.sender.send('engine:apktool-progress', data.toString());
                                }
                            });
                        });
                    } else {
                        resolve({ success: false, error: "Path APK tidak valid dari sistem Android." });
                    }
                });
            });
        });

        ipcMain.handle('app:rebuild-apktool', (event, sourceFolderFolder) => {
            return new Promise((resolve) => {
                if (!fs.existsSync(sourceFolderFolder) || !fs.existsSync(pathModule.join(sourceFolderFolder, 'apktool.yml'))) {
                    return resolve({ success: false, error: "Folder tidak valid. Pastikan memilih folder hasil ekstrak Apktool yang memiliki file apktool.yml" });
                }

                if (!fs.existsSync(zipalignPath) || !fs.existsSync(apksignerJar)) {
                    return resolve({ success: false, error: `Komponen Build-Tools tidak lengkap!\nPastikan zipalign.exe dan apksigner.jar sudah ada di dalam folder: runtimes/build-tools/` });
                }

                const folderName = pathModule.basename(sourceFolderFolder);
                const destFolder = pathModule.dirname(sourceFolderFolder);
                const outputApkUnaligned = pathModule.join(destFolder, `${folderName}_unaligned.apk`);
                const outputApkFinal = pathModule.join(destFolder, `${folderName}_mod.apk`);

                console.log(`[Mobile Farm] Memulai perakitan ulang APK (Rebuild) dengan Apktool...`);

                let totalSmaliFolders = 0;
                let processedSmaliFolders = 0;
                try {
                    const filesInDir = fs.readdirSync(sourceFolderFolder);
                    totalSmaliFolders = filesInDir.filter(f => f.startsWith('smali') && fs.statSync(pathModule.join(sourceFolderFolder, f)).isDirectory()).length;
                } catch (e) {
                    console.error("[Mobile Farm] Gagal me-scan total folder smali:", e);
                }

                const buildProc = exec(`"${apktoolPath}" b "${sourceFolderFolder}" -o "${outputApkUnaligned}"`, {
                    windowsHide: true,
                    maxBuffer: 1024 * 1024 * 500,
                    env: {
                        ...process.env,
                        JAVA_HOME: jdkPath,
                        _JAVA_OPTIONS: '-Xmx4G'
                    }
                }, (apkErr, apkOut, apkStderr) => {
                    if (apkErr) {
                         const detailErr = apkStderr ? apkStderr.toString().trim() : (apkOut ? apkOut.toString().trim() : "Unknown Apktool Build Exception");
                         return resolve({ success: false, error: `Apktool Build failed\n[!] DETAIL: ${detailErr}` });
                    }

                    if (event.sender && !event.sender.isDestroyed()) {
                        event.sender.send('engine:apktool-progress', "\n[+] APK Berhasil Dirakit! Memulai proses Zipalign...\n");
                    }

                    const keytoolExe = pathModule.join(jdkPath, 'bin', os.platform() === 'win32' ? 'keytool.exe' : 'keytool');
                    const javaExe = pathModule.join(jdkPath, 'bin', os.platform() === 'win32' ? 'java.exe' : 'java');
                    const keystorePath = pathModule.join(destFolder, 'flowork_debug.keystore');

                    const processAlignAndSign = () => {
                        exec(`"${zipalignPath}" -p -f 4 "${outputApkUnaligned}" "${outputApkFinal}"`, { windowsHide: true }, (zipErr, zipOut, zipStderr) => {
                            if (zipErr) {
                                return resolve({ success: false, error: `Zipalign gagal!\nError: ${zipStderr || zipErr.message}` });
                            }

                            if (event.sender && !event.sender.isDestroyed()) {
                                event.sender.send('engine:apktool-progress', "[+] Zipalign Selesai. Memulai injeksi Signature V1, V2 & V3...\n");
                            }

                            // [PENGAMAN EXTRA] Menambahkan --v1-signing-enabled true agar kompatibel ke semua OS jadul
                            exec(`"${javaExe}" -jar "${apksignerJar}" sign --ks "${keystorePath}" --ks-pass pass:android --key-pass pass:android --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true "${outputApkFinal}"`, { windowsHide: true }, (signErr, signOut, signStderr) => {

                                if (fs.existsSync(outputApkUnaligned)) fs.unlinkSync(outputApkUnaligned);

                                if (signErr) {
                                    return resolve({ success: false, error: `Apksigner gagal!\nError: ${signStderr || signErr.message}` });
                                }

                                resolve({
                                    success: true,
                                    path: outputApkFinal,
                                    message: `🔥 NATIVE AUTO-SIGN BERHASIL!\n\nAPK hasil modding (Rebuild) sudah di-Zipalign dan ditanamkan Signature V1, V2 & V3 secara mandiri oleh Flowork Engine.\n\nFile siap install: ${outputApkFinal}`
                                });
                            });
                        });
                    };

                    if (!fs.existsSync(keystorePath)) {
                        if (event.sender && !event.sender.isDestroyed()) event.sender.send('engine:apktool-progress', "[+] Membuat sertifikat (Keystore) baru...\n");

                        exec(`"${keytoolExe}" -genkey -v -keystore "${keystorePath}" -storepass android -alias androiddebugkey -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname "C=US, O=Android, CN=Android Debug"`, { windowsHide: true }, (keyErr) => {
                            if(keyErr) {
                                 return resolve({ success: false, error: `Gagal membuat keystore.\nError: ${keyErr.message}` });
                            }
                            processAlignAndSign();
                        });
                    } else {
                        processAlignAndSign();
                    }
                });

                buildProc.stdout.on('data', (data) => {
                    if (event.sender && !event.sender.isDestroyed()) {
                        let logText = data.toString();
                        if (logText.includes("Smaling") && totalSmaliFolders > 0) {
                            processedSmaliFolders++;
                            let percent = Math.floor((processedSmaliFolders / totalSmaliFolders) * 100);
                            if (percent > 100) percent = 100;
                            logText = `[⏳ Progress: ${percent}%] ` + logText;
                        }
                        event.sender.send('engine:apktool-progress', logText);
                    }
                });
                buildProc.stderr.on('data', (data) => {
                    if (event.sender && !event.sender.isDestroyed()) {
                        event.sender.send('engine:apktool-progress', data.toString());
                    }
                });
            });
        });
    }
};