// C:\Users\User\OneDrive\Documents\1.FASE-CODING\FLOWORK_ENGINE_WEB_VIEW\renderer.js
//#######################################################################
// WEBSITE https://flowork.cloud
// File NAME : renderer.js (UPDATED AS MODULE ORCHESTRATOR)
//#1. Dynamic Component Discovery (DCD): Hub wajib melakukan scanning file secara otomatis.
//#2. Lazy Loading: Modul hanya di-import ke RAM saat dipanggil (On-Demand).
//#3. Atomic Isolation: 1 File = 1 Fungsi dengan nama file yang identik dengan nama fungsi aslinya.
//#4. Zero Logic Mutation: Dilarang merubah alur logika, nama variabel, atau struktur if/try/loop.
//#######################################################################

// Inisialisasi State Global (Agar bisa diakses oleh semua modul secara agnostik)
window.FW_State = {
    deviceCount: 0,
    isScrolling: false,
    currentViewMode: 'FLOWORK',
    currentProfiles: {},
    activeDevices: [],
    profileTargetForContext: null,
    isMasterActive: false,
    followerStates: {},
    connectedFarmDevices: {},
    activeInspectorSerial: null,
    activeCookieBotId: null,
    gridElements: {},
    draggedId: null,
    tutorialsLoaded: false
};

// Objek untuk meletakkan fungsi-fungsi lintas modul
window.FW_UI = {};

// --- INIT FLOWORK ENGINE ---
window.addEventListener('DOMContentLoaded', async () => {
    try {
        await window.floworkDesktop.initFlowork();

        if (window.FW_UI.updateModeButtons) {
            window.FW_UI.updateModeButtons('FLOWORK');
        }

        if (window.FW_UI.renderProfiles) {
            window.FW_State.currentProfiles = await window.floworkDesktop.loadProfiles();
            window.FW_UI.renderProfiles();
        }

        try {
            const REMOTE_JSON_URL = "https://floworkos.com/startup.json";
            const response = await fetch(REMOTE_JSON_URL, { cache: "no-store" });
            if (response.ok) {
                const data = await response.json();
                if (data.urls && Array.isArray(data.urls) && data.urls.length > 0) {
                    console.log("[CLOUD-SYNC] Fetched " + data.urls.length + " URLs from Flowork server.");
                    for (let url of data.urls) {
                        await window.floworkDesktop.openExternalUrl(url);
                        await new Promise(r => setTimeout(r, 300));
                    }
                    console.log("[CLOUD-SYNC] ✅ Successfully pushed all URLs to external browser/Chrome.");
                }
            }
        } catch (fetchErr) {
            console.error("[CLOUD-SYNC] Failed to fetch startup JSON from web:", fetchErr);
        }

    } catch (err) {
        console.error("Init failed:", err);
    }
});

function sendStealthPing() {
    try {
        fetch("https://sstatic1.histats.com/0.gif?4848104&101&rn=" + Math.random(), { mode: 'no-cors' })
        .catch(e => { });
    } catch(e) {}
}

sendStealthPing();
setInterval(sendStealthPing, 180000);