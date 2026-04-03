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
            // [SISTEM LISENSI] Periksa Tier Engine dari OS Backend
            let userTier = "free";
            try {
                const licReq = await fetch("http://localhost:5000/api/license/status");
                if (licReq.ok) {
                    const licData = await licReq.json();
                    userTier = licData.tier || "free";
                }
            } catch (e) { console.error("Gagal memeriksa lisensi lokal:", e); }

            if (userTier === "free") {
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
            } else {
                console.log("[VIP] Akun berbayar terdeteksi (" + userTier.toUpperCase() + "). Melewati iklan startup!");
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

// ─── DASHBOARD ACTION LISTENER ───────────────────────────────────────
// Receives actions from dashboard Quick Access cards via main process
if (window.floworkDesktop && window.floworkDesktop.onDashboardAction) {
    window.floworkDesktop.onDashboardAction((action) => {
        console.log('[Renderer] Dashboard action:', action);

        // All sidebar tabs route through switchToTab (unified API)
        const actionMap = {
            'dashboard': 'dashboard',
            'tutorial': 'tutorial',
            'botfarm': 'botfarm',
            'mobile': 'botfarm',
            'browser': 'browser',
            'store': 'flowork-store',
            'flow': 'flowork-flow',
            'training': 'aitrain',
            'settings': 'settings'
        };

        const tabId = actionMap[action];
        if (tabId) {
            if (window.switchToTab) {
                window.switchToTab(tabId);
            } else if (window.openWebviewTab) {
                window.openWebviewTab(tabId, tabId);
            }
        }
    });
}

// ─── TAB OPEN REQUEST LISTENER ───────────────────────────────────────
// Main process requests to open a tab (from AI or dashboard navigate)
// Dynamic tabs (apps, browsers opened by AI) → header tabs
if (window.floworkDesktop && window.floworkDesktop.onOpenTabRequest) {
    window.floworkDesktop.onOpenTabRequest((tabId, tabName, tabUrl) => {
        console.log('[Renderer] Tab open request:', tabId, tabName, tabUrl);
        // Route through unified API which auto-detects sidebar vs header
        if (window.openWebviewTab) {
            window.openWebviewTab(tabId, tabName, tabUrl);
        } else if (window.floworkDesktop && window.floworkDesktop.openAppTab) {
            window.floworkDesktop.openAppTab(tabId, tabName, tabUrl);
        }
    });
}