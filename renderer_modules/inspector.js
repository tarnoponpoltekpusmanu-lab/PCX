// C:\Users\User\OneDrive\Documents\1.FASE-CODING\FLOWORK_ENGINE_WEB_VIEW\renderer_modules\inspector.js
(() => {
    const inspectorModal = document.getElementById('inspector-modal');
    const inspectorDeviceId = document.getElementById('inspector-device-id');
    const inspectorPkgInput = document.getElementById('inspector-pkg-input');
    const btnInspectorScan = document.getElementById('btn-inspector-scan');
    const btnInspectorLogcat = document.getElementById('btn-inspector-logcat');
    const inspectorApkInfo = document.getElementById('inspector-apk-info');
    const inspectorLogcatInfo = document.getElementById('inspector-logcat-info');
    const btnInspectorClose = document.getElementById('btn-inspector-close');
    const btnInspectorAuto = document.getElementById('btn-inspector-auto');
    const btnInspectorPull = document.getElementById('btn-inspector-pull');
    const btnInspectorDecompile = document.getElementById('btn-inspector-decompile');
    const inspectorRamInput = document.getElementById('inspector-ram-input');
    const btnCopyApk = document.getElementById('btn-copy-apk');
    const btnCopyLogcat = document.getElementById('btn-copy-logcat');

    const btnInspectorDisassemble = document.getElementById('btn-inspector-disassemble');
    const btnInspectorRebuild = document.getElementById('btn-inspector-rebuild');

    // [DITAMBAHKAN] Form Rebuild Panel
    const rebuildPanel = document.getElementById('rebuild-panel');
    const inspectorRebuildPath = document.getElementById('inspector-rebuild-path');
    const btnBrowseFolder = document.getElementById('btn-browse-folder');
    const btnExecuteRebuild = document.getElementById('btn-execute-rebuild');

    window.addEventListener('message', async (event) => {
        if (event.data && event.data.type === 'OPEN_INSPECTOR') {
            window.FW_State.activeInspectorSerial = event.data.serial;
            if(inspectorDeviceId) inspectorDeviceId.innerText = `[${window.FW_State.activeInspectorSerial}]`;
            if(inspectorApkInfo) inspectorApkInfo.value = '';
            if(inspectorLogcatInfo) inspectorLogcatInfo.value = '';

            // Sembunyikan panel rebuild pas pertama kali dibuka
            if(rebuildPanel) rebuildPanel.style.display = 'none';

            if(inspectorModal) {
                inspectorModal.style.display = 'flex';
                await window.floworkDesktop.toggleModal(true);

                if (window.floworkDesktop.getTopApp && window.FW_State.activeInspectorSerial) {
                    inspectorPkgInput.value = "Detecting active app...";
                    try {
                        const res = await window.floworkDesktop.getTopApp(window.FW_State.activeInspectorSerial);
                        if (res && res.success) {
                            inspectorPkgInput.value = res.packageName;
                        } else { inspectorPkgInput.value = ""; }
                    } catch(e) { inspectorPkgInput.value = ""; }
                }
            }
        }
    });

    if (btnInspectorClose) {
        btnInspectorClose.addEventListener('click', async () => {
            inspectorModal.style.display = 'none';
            window.FW_State.activeInspectorSerial = null;
            if (window.FW_State.currentViewMode !== 'FARM' && window.FW_State.currentViewMode !== 'TUTORIAL') {
                await window.floworkDesktop.toggleModal(false);
            }
        });
    }

    if (btnInspectorAuto) {
        btnInspectorAuto.addEventListener('click', async () => {
            if (!window.FW_State.activeInspectorSerial) return;
            inspectorPkgInput.value = "Detecting active app...";
            try {
                if (window.floworkDesktop.getTopApp) {
                    const res = await window.floworkDesktop.getTopApp(window.FW_State.activeInspectorSerial);
                    if (res && res.success) {
                        inspectorPkgInput.value = res.packageName;
                    } else {
                        inspectorPkgInput.value = "";
                        alert("Gagal mendeteksi aplikasi di layar. Pastikan layar HP menyala dan aplikasi sedang dibuka.");
                    }
                } else {
                    inspectorPkgInput.value = "";
                    alert("⚠️ Error: getTopApp belum di-map di preload.js!");
                }
            } catch (err) {
                inspectorPkgInput.value = "";
                alert("Error: " + err.message);
            }
        });
    }

    if (btnInspectorPull) {
        btnInspectorPull.addEventListener('click', async () => {
            let pkgName = inspectorPkgInput.value.trim();
            if (!window.FW_State.activeInspectorSerial) return;

            if (!pkgName || pkgName === "Detecting active app..." || pkgName === "Auto-detecting...") {
                inspectorPkgInput.value = "Auto-detecting...";
                try {
                    if (window.floworkDesktop.getTopApp) {
                        const res = await window.floworkDesktop.getTopApp(window.FW_State.activeInspectorSerial);
                        if (res && res.success) {
                            pkgName = res.packageName;
                            inspectorPkgInput.value = pkgName;
                        } else {
                            inspectorPkgInput.value = "";
                            return alert("Gagal mendeteksi layar. Pastikan layar HP menyala dan aplikasi sedang terbuka.");
                        }
                    }
                } catch (err) {
                    inspectorPkgInput.value = "";
                    return alert("Error Auto-Detect: " + err.message);
                }
            }

            if (pkgName) {
                inspectorApkInfo.value = `[+] PULLING APK IN PROGRESS...\n[>] Target: ${pkgName}.apk\n[>] Harap tunggu, ini mungkin memakan waktu tergantung ukuran file...`;
                try {
                    if(window.floworkDesktop.pullApk) {
                        const result = await window.floworkDesktop.pullApk(window.FW_State.activeInspectorSerial, pkgName);
                        if (result && result.success) {
                            inspectorApkInfo.value = `[+] SUCCESS!\n[>] File APK berhasil disedot ke PC.\n[>] Path: ${result.path}\n\n[!] Gunakan Objection (objection patchapk) untuk modifikasi.`;
                        } else { inspectorApkInfo.value = "[-] FAILED: " + (result ? result.error : 'Unknown error'); }
                    } else { inspectorApkInfo.value = "[-] ERROR: pullApk function not found in preload.js!"; }
                } catch (err) { inspectorApkInfo.value = "[-] ERROR: " + err.message; }
            }
        });
    }

    if (btnInspectorDecompile) {
        btnInspectorDecompile.addEventListener('click', async () => {
            let pkgName = inspectorPkgInput.value.trim();
            if (!window.FW_State.activeInspectorSerial) return;

            if (!pkgName || pkgName === "Detecting active app..." || pkgName === "Auto-detecting...") {
                inspectorPkgInput.value = "Auto-detecting...";
                try {
                    if (window.floworkDesktop.getTopApp) {
                        const res = await window.floworkDesktop.getTopApp(window.FW_State.activeInspectorSerial);
                        if (res && res.success) {
                            pkgName = res.packageName;
                            inspectorPkgInput.value = pkgName;
                        } else {
                            inspectorPkgInput.value = "";
                            return alert("Gagal mendeteksi layar. Pastikan layar HP menyala dan aplikasi sedang terbuka.");
                        }
                    }
                } catch (err) {
                    inspectorPkgInput.value = "";
                    return alert("Error Auto-Detect: " + err.message);
                }
            }

            if (pkgName) {
                let ramLimit = parseInt(inspectorRamInput ? inspectorRamInput.value : 8) || 8;
                inspectorApkInfo.value = `[+] DECOMPILE SRC IN PROGRESS...\n[>] Target: ${pkgName}\n[>] Memori Maksimal (JADX): ${ramLimit} GB\n[>] Tahap 1: Pulling base.apk dari device...\n[>] Tahap 2: Decompiling menggunakan JADX (Multi-thread)...\n[!] Menunggu Progress Log dari JADX...\n\n`;
                try {
                    if(window.floworkDesktop.decompileApk) {
                        const result = await window.floworkDesktop.decompileApk(window.FW_State.activeInspectorSerial, pkgName, ramLimit);
                        if (result && result.success) {
                            let warnMsg = result.warning ? `\n[!] INFO: ${result.warning}\n` : '';
                            inspectorApkInfo.value += `\n[+] DECOMPILE SUCCESS!${warnMsg}\n[>] Source code berhasil di ekstrak ke PC.\n[>] Path Folder: ${result.path}\n\n[!] Silakan buka di VSCode atau Android Studio untuk review kode.`;
                            inspectorApkInfo.scrollTop = inspectorApkInfo.scrollHeight;
                        } else {
                            inspectorApkInfo.value += "\n[-] DECOMPILE FAILED: " + (result ? result.error : 'Unknown error');
                            inspectorApkInfo.scrollTop = inspectorApkInfo.scrollHeight;
                        }
                    } else { inspectorApkInfo.value += "\n[-] ERROR: decompileApk function not found in preload.js!"; }
                } catch (err) { inspectorApkInfo.value += "\n[-] ERROR: " + err.message; }
            }
        });
    }

    if (btnInspectorScan) {
        btnInspectorScan.addEventListener('click', async () => {
            let pkgName = inspectorPkgInput.value.trim();
            if (!window.FW_State.activeInspectorSerial) return;

            if (!pkgName || pkgName === "Detecting active app..." || pkgName === "Auto-detecting...") {
                inspectorPkgInput.value = "Auto-detecting...";
                try {
                    if (window.floworkDesktop.getTopApp) {
                        const res = await window.floworkDesktop.getTopApp(window.FW_State.activeInspectorSerial);
                        if (res && res.success) {
                            pkgName = res.packageName;
                            inspectorPkgInput.value = pkgName;
                        } else {
                            inspectorPkgInput.value = "";
                            return alert("Gagal mendeteksi layar. Pastikan layar HP menyala dan aplikasi sedang terbuka.");
                        }
                    } else {
                        inspectorPkgInput.value = "";
                        return alert("⚠️ Error: Fungsi getTopApp belum ditambahkan di file preload.js lo!");
                    }
                } catch (err) {
                    inspectorPkgInput.value = "";
                    return alert("Error Auto-Detect: " + err.message);
                }
            }

            inspectorApkInfo.value = "[+] SCANNING APK INTERNALS...\n[>] Executing dumpsys package " + pkgName + "\n[>] Please wait...";

            try {
                if(window.floworkDesktop.inspectApk) {
                    const result = await window.floworkDesktop.inspectApk(window.FW_State.activeInspectorSerial, pkgName);
                    if (result && result.success) {
                        inspectorApkInfo.value = result.data;
                    } else { inspectorApkInfo.value = "[-] SCAN FAILED: " + (result ? result.error : 'Unknown error'); }
                } else { inspectorApkInfo.value = "[-] ERROR: inspectApk function not found in preload.js!"; }
            } catch (err) { inspectorApkInfo.value = "[-] ERROR: " + err.message; }
        });
    }

    if (btnInspectorLogcat) {
        btnInspectorLogcat.addEventListener('click', async () => {
            let pkgName = inspectorPkgInput.value.trim();
            if (!window.FW_State.activeInspectorSerial) return;

            if (!pkgName || pkgName === "Detecting active app..." || pkgName === "Auto-detecting...") {
                inspectorPkgInput.value = "Auto-detecting...";
                try {
                    if (window.floworkDesktop.getTopApp) {
                        const res = await window.floworkDesktop.getTopApp(window.FW_State.activeInspectorSerial);
                        if (res && res.success) {
                            pkgName = res.packageName;
                            inspectorPkgInput.value = pkgName;
                        } else {
                            inspectorPkgInput.value = "";
                            return alert("Gagal mendeteksi layar. Pastikan layar HP menyala dan aplikasi sedang terbuka.");
                        }
                    } else {
                        inspectorPkgInput.value = "";
                        return alert("⚠️ Error: Fungsi getTopApp belum ditambahkan di file preload.js lo!");
                    }
                } catch (err) {
                    inspectorPkgInput.value = "";
                    return alert("Error Auto-Detect: " + err.message);
                }
            }

            inspectorLogcatInfo.value = "[+] INITIATING LOGCAT STREAM...\n[>] Target PID: " + pkgName + "\n------------------------------------------------\n";

            try {
                if(window.floworkDesktop.startLogcat) {
                    await window.floworkDesktop.startLogcat(window.FW_State.activeInspectorSerial, pkgName);
                } else { inspectorLogcatInfo.value += "[-] ERROR: startLogcat function not found in preload.js!\n"; }
            } catch (err) { inspectorLogcatInfo.value += "[-] STREAM ERROR: " + err.message + "\n"; }
        });
    }

    if (window.floworkDesktop.onLogcatData) {
        window.floworkDesktop.onLogcatData((data) => {
            if(inspectorLogcatInfo) {
                inspectorLogcatInfo.value += data;
                inspectorLogcatInfo.scrollTop = inspectorLogcatInfo.scrollHeight;
            }
        });
    }

    if (btnCopyApk) {
        btnCopyApk.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(inspectorApkInfo.value);
                const originalText = btnCopyApk.innerHTML;
                btnCopyApk.innerHTML = 'COPIED!';
                setTimeout(() => { btnCopyApk.innerHTML = originalText; }, 1500);
            } catch (err) { inspectorApkInfo.select(); document.execCommand('copy'); }
        });
    }

    if (btnCopyLogcat) {
        btnCopyLogcat.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(inspectorLogcatInfo.value);
                const originalText = btnCopyLogcat.innerHTML;
                btnCopyLogcat.innerHTML = 'COPIED!';
                setTimeout(() => { btnCopyLogcat.innerHTML = originalText; }, 1500);
            } catch (err) { inspectorLogcatInfo.select(); document.execCommand('copy'); }
        });
    }

    if (window.floworkDesktop.onDecompileProgress) {
        window.floworkDesktop.onDecompileProgress((data) => {
            if (inspectorApkInfo) {
                inspectorApkInfo.value += data;
                inspectorApkInfo.scrollTop = inspectorApkInfo.scrollHeight;
            }
        });
    }

    if (btnInspectorDisassemble) {
        btnInspectorDisassemble.addEventListener('click', async () => {
            let pkgName = inspectorPkgInput.value.trim();
            if (!window.FW_State.activeInspectorSerial) return;

            if (!pkgName || pkgName === "Detecting active app..." || pkgName === "Auto-detecting...") {
                inspectorPkgInput.value = "Auto-detecting...";
                try {
                    if (window.floworkDesktop.getTopApp) {
                        const res = await window.floworkDesktop.getTopApp(window.FW_State.activeInspectorSerial);
                        if (res && res.success) {
                            pkgName = res.packageName;
                            inspectorPkgInput.value = pkgName;
                        } else {
                            inspectorPkgInput.value = "";
                            return alert("Gagal mendeteksi layar. Pastikan layar HP menyala dan aplikasi sedang terbuka.");
                        }
                    }
                } catch (err) {
                    inspectorPkgInput.value = "";
                    return alert("Error Auto-Detect: " + err.message);
                }
            }

            if (pkgName) {
                inspectorApkInfo.value = `[+] DISASSEMBLE (APKTOOL) IN PROGRESS...\n[>] Target: ${pkgName}\n[>] Tahap 1: Pulling base.apk dari device...\n[>] Tahap 2: Ekstrak ke Smali & XML...\n[!] Menunggu Progress Log dari Apktool...\n\n`;
                try {
                    if(window.floworkDesktop.disassembleApktool) {
                        const result = await window.floworkDesktop.disassembleApktool(window.FW_State.activeInspectorSerial, pkgName);
                        if (result && result.success) {
                            inspectorApkInfo.value += `\n[+] DISASSEMBLE SUCCESS!\n[>] Folder Smali berhasil di ekstrak ke PC.\n[>] Path Folder: ${result.path}\n\n[!] Silakan buka folder tsb di VSCode untuk Modding.`;
                            inspectorApkInfo.scrollTop = inspectorApkInfo.scrollHeight;
                        } else {
                            inspectorApkInfo.value += "\n[-] DISASSEMBLE FAILED: " + (result ? result.error : 'Unknown error');
                            inspectorApkInfo.scrollTop = inspectorApkInfo.scrollHeight;
                        }
                    } else { inspectorApkInfo.value += "\n[-] ERROR: disassembleApktool function not found in preload.js!"; }
                } catch (err) { inspectorApkInfo.value += "\n[-] ERROR: " + err.message; }
            }
        });
    }
    // Logika baru: Tombol atas cuma buat nyembunyiin atau nampilin Panel Input
    if (btnInspectorRebuild) {
        btnInspectorRebuild.addEventListener('click', () => {
            if (rebuildPanel) {
                if (rebuildPanel.style.display === 'none') {
                    rebuildPanel.style.display = 'flex';
                } else {
                    rebuildPanel.style.display = 'none';
                }
            }
        });
    }

    // Logika baru: Tombol BROWSE buat ngebuka folder picker, hasil ditaruh di input text
    if (btnBrowseFolder) {
        btnBrowseFolder.addEventListener('click', async () => {
            try {
                const folderPath = await window.floworkDesktop.selectSaveDirectory();
                if (folderPath) {
                    inspectorRebuildPath.value = folderPath;
                }
            } catch(e) {
                alert("Error: " + e.message);
            }
        });
    }

    // Logika baru: Tombol EXECUTE REBUILD untuk jalanin engine
    if (btnExecuteRebuild) {
        btnExecuteRebuild.addEventListener('click', async () => {
            const folderPath = inspectorRebuildPath.value.trim();
            if (!folderPath) {
                alert("Silakan isi path folder atau Browse terlebih dahulu!");
                return;
            }

            rebuildPanel.style.display = 'none'; // Langsung tutup panel biar lega layarnya
            inspectorApkInfo.value = `[+] REBUILD & AUTO-SIGN (APKTOOL) IN PROGRESS...\n[>] Folder target: ${folderPath}\n[>] Tahap 1: Merakit ulang menjadi APK...\n[!] Menunggu Progress Log dari Apktool...\n\n`;

            try {
                if(window.floworkDesktop.rebuildApktool) {
                    const result = await window.floworkDesktop.rebuildApktool(folderPath);
                    if (result && result.success) {
                        let warnMsg = result.warning ? `\n[!] INFO: ${result.warning}\n` : '';
                        inspectorApkInfo.value += `\n[+] REBUILD SUCCESS!${warnMsg}\n[>] System Log: ${result.message}`;
                        inspectorApkInfo.scrollTop = inspectorApkInfo.scrollHeight;
                    } else {
                        inspectorApkInfo.value += "\n[-] REBUILD FAILED: " + (result ? result.error : 'Unknown error');
                        inspectorApkInfo.scrollTop = inspectorApkInfo.scrollHeight;
                    }
                } else { inspectorApkInfo.value += "\n[-] ERROR: rebuildApktool function not found in preload.js!"; }
            } catch (err) { inspectorApkInfo.value += "\n[-] ERROR: " + err.message; }
        });
    }

    if (window.floworkDesktop.onApktoolProgress) {
        window.floworkDesktop.onApktoolProgress((data) => {
            if (inspectorApkInfo) {
                inspectorApkInfo.value += data;
                inspectorApkInfo.scrollTop = inspectorApkInfo.scrollHeight;
            }
        });
    }
})();