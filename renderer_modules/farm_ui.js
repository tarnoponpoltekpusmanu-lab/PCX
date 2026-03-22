// C:\Users\User\OneDrive\Documents\1.FASE-CODING\FLOWORK_ENGINE_WEB_VIEW\renderer_modules\farm_ui.js
(() => {
    const btnMobileFarm = document.getElementById('btn-mobile-farm');
    const btnFarmRefresh = document.getElementById('btn-farm-refresh');
    const farmList = document.getElementById('farm-list');

    window.activeLivesFrontend = {};
    window.activeRecordingsFrontend = {};

    window.FW_UI.refreshFarmDevices = async function() {
        if (!farmList) return;
        farmList.innerHTML = '<div style="color: #aaa; width: 100%; text-align: center; margin-top: 50px;"><span class="loading-icon" style="font-size: 20px;">⏳</span><br>Scanning for ADB devices...</div>';

        try {
            const devices = await window.floworkDesktop.getAdbDevices();
            farmList.innerHTML = '';

            if (devices.length === 0) {
                farmList.innerHTML = '<div style="color: #ff4d4d; width: 100%; text-align: center; margin-top: 50px;">❌ No Physical Devices Found.<br>Ensure USB Debugging is ON and the device is authorized.</div>';
                return;
            }

            devices.forEach(device => {
                const card = document.createElement('div');

                if (window.FW_State.connectedFarmDevices[device.serial]) {
                    const basePath = window.location.href.split('index.html')[0];
                    const farmUrl = `${basePath}store/farm_stream.html?serial=${device.serial}`;

                    card.style.cssText = 'width: 340px; height: 650px; background: #000; border-radius: 10px; border: 1px solid #30363d; overflow: hidden; display: flex; flex-direction: column;';
                    card.innerHTML = `
                        <div style="background: #1f2428; padding: 10px 15px; border-bottom: 2px solid #3DDC84; display: flex; justify-content: space-between; align-items: center;">
                            <span style="color: #fff; font-weight: bold; font-size: 13px;">📱 ${device.model}</span>
                            <div style="display: flex; gap: 5px;">
                                <button id="btn-live-${device.serial}" class="btn btn-dark" style="padding: 4px 10px; font-size: 11px; border-radius: 4px; border: 1px solid #1da1f2; color: #1da1f2; cursor: pointer; transition: all 0.3s ease;" onclick="toggleLiveYt('${device.serial}')">📺 Live YT</button>
                                <button id="btn-rec-${device.serial}" class="btn btn-dark" style="padding: 4px 10px; font-size: 11px; border-radius: 4px; border: 1px solid #ff4444; color: #ff4444; cursor: pointer; transition: all 0.3s ease;" onclick="toggleRecord('${device.serial}')">🔴 REC</button>
                                <button class="btn btn-warn" style="padding: 4px 10px; font-size: 11px; border-radius: 4px;" onclick="disconnectFarm('${device.serial}')">⏹️ Stop</button>
                            </div>
                        </div>
                        <div style="flex-grow: 1; overflow: hidden;">
                            <iframe src="${farmUrl}" style="width: 100%; height: 100%; border: none;"></iframe>
                        </div>
                    `;
                } else {
                    card.style.cssText = 'width: 250px; background: #1e1e1e; border-radius: 8px; border: 1px solid #333; overflow: hidden; display: flex; flex-direction: column;';
                    const isOnline = device.state === 'device';
                    const statusColor = isOnline ? '#3DDC84' : '#ff4d4d';

                    card.innerHTML = `
                        <div style="background: #2d2d2d; padding: 10px; border-bottom: 2px solid ${statusColor}; font-weight: bold; font-size: 14px; display: flex; justify-content: space-between; align-items: center;">
                            <span>📱 ${device.model || 'Unknown Device'}</span>
                            <span style="width: 10px; height: 10px; background: ${statusColor}; border-radius: 50%; display: inline-block;" title="${device.state}"></span>
                        </div>
                        <div style="padding: 15px; font-size: 12px; color: #aaa; flex-grow: 1;">
                            <div><strong>Serial:</strong> ${device.serial}</div>
                            <div><strong>Status:</strong> ${device.state}</div>
                        </div>
                        <div style="padding: 10px; background: #1a1a1a; border-top: 1px solid #333; text-align: center;">
                            <button class="btn ${isOnline ? 'btn-green' : 'btn-dark'}" style="width: 100%;" ${!isOnline ? 'disabled' : ''}>🚀 Start Mirror (Scrcpy)</button>
                        </div>
                    `;

                    const btnStart = card.querySelector('button');
                    if (isOnline) {
                        btnStart.onclick = async (e) => {
                            e.stopPropagation();
                            const originalText = btnStart.innerHTML;
                            btnStart.innerHTML = '⏳ Launching...';
                            const result = await window.floworkDesktop.startScrcpy(device.serial);
                            if (result.success) {
                                window.FW_State.connectedFarmDevices[device.serial] = true;
                                window.FW_UI.refreshFarmDevices();
                            } else {
                                alert("Scrcpy Error: " + result.error);
                                btnStart.innerHTML = originalText;
                            }
                        };
                    }
                }
                farmList.appendChild(card);
            });
        } catch (err) {
            farmList.innerHTML = `<div style="color: #ff4d4d; width: 100%; text-align: center; margin-top: 50px;">Failed to scan devices: ${err.message}</div>`;
        }
    };

    window.disconnectFarm = (serial) => {
        delete window.FW_State.connectedFarmDevices[serial];
        window.FW_UI.refreshFarmDevices();
    };

    window.toggleLiveYt = async (serial) => {
        const btn = document.getElementById(`btn-live-${serial}`);
        if (!btn) return;
        if (!window.activeLivesFrontend[serial]) {
            const streamKey = prompt(`Masukkan Stream Key YouTube untuk HP ${serial}:\n(Biarkan kosong untuk batal)`);
            if (!streamKey || streamKey.trim() === "") return;
            const originalText = btn.innerHTML;
            btn.innerHTML = '⏳...';
            try {
                const result = await window.floworkDesktop.startLiveYt(serial, streamKey.trim());
                if (result && result.success) {
                    window.activeLivesFrontend[serial] = true;
                    btn.innerHTML = '🔴 LIVE YT (Stop)';
                    btn.style.backgroundColor = '#1da1f2';
                    btn.style.color = '#fff';
                } else {
                    alert("Gagal memulai Live: " + (result ? result.error : "Error tidak diketahui"));
                    btn.innerHTML = originalText;
                }
            } catch (err) { alert("Error IPC: " + err.message); btn.innerHTML = originalText; }
        } else {
            btn.innerHTML = '⏹️ Stopping...';
            try {
                const result = await window.floworkDesktop.stopLiveYt(serial);
                window.activeLivesFrontend[serial] = false;
                btn.innerHTML = '📺 Live YT';
                btn.style.backgroundColor = 'transparent';
                btn.style.color = '#1da1f2';
            } catch (err) { alert("Error IPC: " + err.message); btn.innerHTML = '🔴 LIVE YT (Stop)'; }
        }
    };

    window.toggleRecord = async (serial) => {
        const btn = document.getElementById(`btn-rec-${serial}`);
        if (!btn) return;
        if (!window.activeRecordingsFrontend[serial]) {
            const originalText = btn.innerHTML;
            btn.innerHTML = '⏳...';
            try {
                const result = await window.floworkDesktop.startRecording(serial);
                if (result && result.success) {
                    window.activeRecordingsFrontend[serial] = true;
                    btn.innerHTML = '⏹️ STOP REC';
                    btn.style.backgroundColor = '#ff4444';
                    btn.style.color = '#fff';
                } else {
                    alert("Gagal merekam: " + (result ? result.error : "Error tidak diketahui"));
                    btn.innerHTML = originalText;
                }
            } catch (err) { alert("Error IPC: " + err.message); btn.innerHTML = originalText; }
        } else {
            btn.innerHTML = '📥 Pulling...';
            try {
                const result = await window.floworkDesktop.stopRecording(serial);
                window.activeRecordingsFrontend[serial] = false;
                btn.innerHTML = '🔴 REC';
                btn.style.backgroundColor = 'transparent';
                btn.style.color = '#ff4444';
                if (result && result.success) { alert("🎬 " + result.message + "\n\nLokasi File Video:\n" + result.path); }
                else { alert("Gagal menyedot rekaman: " + (result ? result.error : "Error tidak diketahui")); }
            } catch (err) { alert("Error IPC: " + err.message); btn.innerHTML = '⏹️ STOP REC'; }
        }
    };

    if (btnMobileFarm) {
        btnMobileFarm.addEventListener('click', async () => {
            if (window.FW_UI.updateModeButtons) window.FW_UI.updateModeButtons('FARM');
            window.FW_UI.refreshFarmDevices();
        });
    }
    if (btnFarmRefresh) {
        btnFarmRefresh.addEventListener('click', () => {
            window.FW_UI.refreshFarmDevices();
        });
    }
})();