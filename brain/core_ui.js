// C:\Users\User\OneDrive\Documents\1.FASE-CODING\FLOWORK_ENGINE_WEB_VIEW\renderer_modules\core_ui.js
(() => {
    const customAlertModal = document.getElementById('custom-alert-modal');
    const customAlertText = document.getElementById('custom-alert-text');
    const btnAlertCopy = document.getElementById('btn-alert-copy');
    const btnAlertClose = document.getElementById('btn-alert-close');
    const btnFlowork = document.getElementById('btn-flowork');
    const btnToggleView = document.getElementById('btn-toggle-view');
    const btnMobileFarm = document.getElementById('btn-mobile-farm');
    const btnTutorial = document.getElementById('btn-tutorial');
    const tutorialView = document.getElementById('tutorial-view');
    const btnBack = document.getElementById('btn-back');
    const btnRefresh = document.getElementById('btn-refresh');
    const navUrlInput = document.getElementById('nav-url-input');
    const btnNavGo = document.getElementById('btn-nav-go');
    const btnAutoScroll = document.getElementById('btn-auto-scroll');
    const btnStopScroll = document.getElementById('btn-stop-scroll');
    const scrollMin = document.getElementById('scroll-min');
    const scrollMax = document.getElementById('scroll-max');
    const scrollTotal = document.getElementById('scroll-total');
    const scrollUp = document.getElementById('scroll-up');
    const autoRefreshCheckbox = document.getElementById('auto-refresh-checkbox');
    const refreshInterval = document.getElementById('refresh-interval');
    const recordBypassCheckbox = document.getElementById('record-bypass-checkbox');
    const btnClearBypass = document.getElementById('btn-clear-bypass');
    const botSelector = document.getElementById('bot-selector');
    const btnAppBuilder = document.getElementById('btn-app-builder');

    if (btnAppBuilder) {
        btnAppBuilder.addEventListener('click', async () => {
            await window.floworkDesktop.openAiBuilder();
        });
    }

    window.alert = async function(message) {
        customAlertText.value = message;
        customAlertModal.style.display = 'flex';
        await window.floworkDesktop.toggleModal(true);
    };

    window.floworkDesktop.onShowAlert((msg) => {
        window.alert(msg);
    });

    btnAlertClose.addEventListener('click', async () => {
        customAlertModal.style.display = 'none';
        if (window.FW_State.currentViewMode !== 'FARM' && window.FW_State.currentViewMode !== 'TUTORIAL') {
            await window.floworkDesktop.toggleModal(false);
        }
    });

    btnAlertCopy.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(customAlertText.value);
            const originalText = btnAlertCopy.innerHTML;
            btnAlertCopy.innerHTML = '✅ Copied!';
            setTimeout(() => { btnAlertCopy.innerHTML = originalText; }, 1500);
        } catch (err) {
            customAlertText.select();
            document.execCommand('copy');
        }
    });

    window.FW_UI.updateModeButtons = function(activeMode) {
        window.FW_State.currentViewMode = activeMode;

        if (activeMode === 'TUTORIAL') {
            if (tutorialView) tutorialView.style.display = 'flex';
            window.floworkDesktop.toggleModal(true);
        } else {
            if (tutorialView) tutorialView.style.display = 'none';
            window.floworkDesktop.toggleModal(false);
        }

        const gridLayerEl = document.getElementById('grid-ui-layer');
        if (gridLayerEl) {
            gridLayerEl.style.display = (activeMode === 'GRID') ? 'block' : 'none';
        }

        if (btnFlowork) btnFlowork.className = activeMode === 'FLOWORK' ? 'btn btn-blue' : 'btn btn-dark';
        if (btnTutorial) btnTutorial.className = activeMode === 'TUTORIAL' ? 'btn btn-warn' : 'btn btn-dark';

        // isBrowser = modes where bot/browser toolbar groups should appear
        const isBrowser = (activeMode === 'NORMAL' || activeMode === 'GRID');

        // Toggle toolbar groups: shown only in GRID and NORMAL modes
        const groups = [
            { id: 'nav-group', sep: 'sep-nav', show: isBrowser },
            { id: 'refresh-group', sep: 'sep-refresh', show: isBrowser },
            { id: 'bypass-group', sep: 'sep-bypass', show: isBrowser },
            { id: 'addbot-group', sep: 'sep-addbot', show: isBrowser },
            { id: 'profile-container', sep: 'sep-profile', show: isBrowser },
            { id: 'auto-scroll-group', sep: 'sep-scroll', show: activeMode === 'GRID' }
        ];

        groups.forEach(g => {
            const el = document.getElementById(g.id);
            const sep = document.getElementById(g.sep);
            if (el) el.style.display = g.show ? 'flex' : 'none';
            if (sep) sep.style.display = g.show ? 'block' : 'none';
        });

        // Settings button & separator are ALWAYS visible
        const btnSettings = document.getElementById('btn-settings');
        const sepSettings = document.getElementById('sep-settings');
        if (btnSettings) btnSettings.style.display = 'inline-block';
        if (sepSettings) sepSettings.style.display = 'block';

        // [NAV WEBVIEW] fw-nav-group (Flow/Store/Account) only in FLOWORK mode
        const navWebviewGroup = document.getElementById('fw-nav-group');
        const sepNavWebview = document.getElementById('sep-nav-webview');
        if (navWebviewGroup) navWebviewGroup.style.display = (activeMode === 'FLOWORK') ? 'flex' : 'none';
        if (sepNavWebview) sepNavWebview.style.display = (activeMode === 'FLOWORK') ? 'block' : 'none';

        // NORMAL mode (Desktop/Browser): show Back, Refresh, URL input, Go
        if (activeMode === 'NORMAL') {
            btnBack.style.display = 'inline-block';
            btnRefresh.style.display = 'inline-block';
            navUrlInput.style.display = 'inline-block';
            btnNavGo.style.display = 'inline-block';
        } else {
            btnBack.style.display = 'none';
            btnRefresh.style.display = 'none';
            navUrlInput.style.display = 'none';
            btnNavGo.style.display = 'none';
        }

        // Toggle View button: shows current mode toggle
        if (btnToggleView) {
            if (activeMode === 'GRID') {
                btnToggleView.className = 'btn btn-blue';
                btnToggleView.innerHTML = '💻 Desktop Mode';
            } else if (activeMode === 'NORMAL') {
                btnToggleView.className = 'btn btn-blue';
                btnToggleView.innerHTML = '📱 Mobile Mode';
                window.FW_UI.stopScrollIfRunning();
            } else {
                btnToggleView.className = 'btn btn-dark';
                btnToggleView.innerHTML = '📱 Mobile Mode';
                window.FW_UI.stopScrollIfRunning();
            }
        } else {
            if (activeMode === 'NORMAL' || activeMode === 'FLOWORK' || activeMode === 'TUTORIAL') {
                window.FW_UI.stopScrollIfRunning();
            }
        }
    };

    window.FW_UI.stopScrollIfRunning = async function() {
        if (window.FW_State.isScrolling) {
            await window.floworkDesktop.stopScrollAll();
            window.FW_State.isScrolling = false;
            if(btnStopScroll) btnStopScroll.style.display = 'none';
            if(btnAutoScroll) btnAutoScroll.style.display = 'inline-block';
        }
    };

    if (btnFlowork) {
        btnFlowork.addEventListener('click', async () => {
            if (window.switchToHomeTab) {
                window.switchToHomeTab();
            } else if (window.floworkDesktop && window.floworkDesktop.switchAppTab) {
                window.floworkDesktop.switchAppTab('__HOME__');
            }
            window.FW_UI.updateModeButtons('FLOWORK');
        });
    }

    const btnFloworkRefresh = document.getElementById('btn-flowork-refresh');
    if (btnFloworkRefresh) {
        btnFloworkRefresh.addEventListener('click', async () => {
            const activeTabId = typeof window.getActiveTabId === 'function' ? window.getActiveTabId() : null;
            if (activeTabId && activeTabId !== '__HOME__' && window.floworkDesktop.reloadAppTab) {
                await window.floworkDesktop.reloadAppTab(activeTabId);
            } else if (window.floworkDesktop.reloadAppTab) {
                await window.floworkDesktop.reloadAppTab('__HOME__');
            } else {
                await window.floworkDesktop.initFlowork();
                window.FW_UI.updateModeButtons('FLOWORK');
            }
        });
    }


    if(btnBack) btnBack.addEventListener('click', async () => {
        const selectedId = botSelector.value;
        if (!selectedId) return alert('Please select a device first!');
        await window.floworkDesktop.goBack(selectedId);
    });

    if(btnRefresh) btnRefresh.addEventListener('click', async () => {
        if (window.FW_State.activeDevices.length === 0) return alert('No active tabs to refresh!');
        await window.floworkDesktop.reloadAllDevices();
    });

    if(btnNavGo) btnNavGo.addEventListener('click', async () => {
        const url = navUrlInput.value.trim();
        const selectedId = botSelector.value;
        if (!selectedId) return alert('Please select a device first!');
        if (url) await window.floworkDesktop.navigate(selectedId, url);
    });

    if(navUrlInput) navUrlInput.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            const url = navUrlInput.value.trim();
            const selectedId = botSelector.value;
            if (!selectedId) return alert('Please select a device first!');
            if (url) await window.floworkDesktop.navigate(selectedId, url);
        }
    });

    if(btnAutoScroll) btnAutoScroll.addEventListener('click', async () => {
        if (window.FW_State.activeDevices.length === 0) return alert('No active tabs to scroll!');
        const minSec = parseInt(scrollMin.value) || 3;
        const maxSec = parseInt(scrollMax.value) || 8;
        const tScroll = parseInt(scrollTotal.value) || 100;
        const upScroll = parseInt(scrollUp.value) || 20;

        window.FW_State.isScrolling = true;
        btnAutoScroll.style.display = 'none';
        btnStopScroll.style.display = 'inline-block';
        await window.floworkDesktop.autoScrollAll({ minSec, maxSec, totalScroll: tScroll, scrollUp: upScroll });
    });

    if(btnStopScroll) btnStopScroll.addEventListener('click', async () => {
        await window.floworkDesktop.stopScrollAll();
        window.FW_State.isScrolling = false;
        btnStopScroll.style.display = 'none';
        btnAutoScroll.style.display = 'inline-block';
    });

    if(autoRefreshCheckbox) autoRefreshCheckbox.addEventListener('change', async function() {
        if (this.checked) {
            const interval = parseInt(refreshInterval.value) || 60;
            await window.floworkDesktop.startAutoRefresh(interval);
        } else {
            await window.floworkDesktop.stopAutoRefresh();
        }
    });

    if(refreshInterval) refreshInterval.addEventListener('change', async function() {
        if (autoRefreshCheckbox && autoRefreshCheckbox.checked) {
            const interval = parseInt(this.value) || 60;
            await window.floworkDesktop.startAutoRefresh(interval);
        }
    });

    if(recordBypassCheckbox) recordBypassCheckbox.addEventListener('change', async function() {
        await window.floworkDesktop.toggleRecordMode(this.checked);
        if (this.checked) {
            alert("🔴 RECORD MODE ACTIVE!\nPlease click the 'Close' or 'Skip' button on a popup/ad in one of the bot tabs now. The system will record its structure and automatically turn off record mode after 1 click.");
        }
    });

    if(btnClearBypass) btnClearBypass.addEventListener('click', async () => {
        if (confirm("Delete all bot memory regarding recorded popups/ads?")) {
            await window.floworkDesktop.clearBypassDb();
            alert("✅ Bypass Memory Cleared! Database empty.");
        }
    });

    if(window.floworkDesktop && window.floworkDesktop.onRecordFinished) {
        window.floworkDesktop.onRecordFinished(() => {
            if(recordBypassCheckbox) recordBypassCheckbox.checked = false;
            alert("✅ SMART BYPASS SAVED!\nThe bot now understands the anatomy of the popup. This element will be automatically pressed/destroyed across all tabs forever.");
        });
    }

    if(window.floworkDesktop && window.floworkDesktop.onForceMode) {
        window.floworkDesktop.onForceMode((mode) => {
            if(window.FW_UI && window.FW_UI.updateModeButtons) window.FW_UI.updateModeButtons(mode);
        });
    }
})();