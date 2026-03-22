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
    const farmView = document.getElementById('farm-view');
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
            tutorialView.style.display = 'flex';
            farmView.style.display = 'none';
            window.floworkDesktop.toggleModal(true);
        } else if (activeMode === 'FARM') {
            farmView.style.display = 'flex';
            tutorialView.style.display = 'none';
            window.floworkDesktop.toggleModal(true);
        } else {
            tutorialView.style.display = 'none';
            farmView.style.display = 'none';
            window.floworkDesktop.toggleModal(false);
        }

        const gridLayerEl = document.getElementById('grid-ui-layer');
        if (gridLayerEl) {
            gridLayerEl.style.display = (activeMode === 'GRID') ? 'block' : 'none';
        }

        btnFlowork.className = activeMode === 'FLOWORK' ? 'btn btn-blue' : 'btn btn-dark';
        btnTutorial.className = activeMode === 'TUTORIAL' ? 'btn btn-warn' : 'btn btn-dark';

        if (btnMobileFarm) {
            btnMobileFarm.className = activeMode === 'FARM' ? 'btn btn-green' : 'btn btn-dark';
            btnMobileFarm.style.color = activeMode === 'FARM' ? 'white' : '#3DDC84';
        }

        const isBrowser = (activeMode === 'NORMAL' || activeMode === 'GRID');

        const toggleDisplay = (id, displayStyle) => {
            const el = document.getElementById(id);
            if (el) el.style.display = isBrowser ? displayStyle : 'none';
        };

        toggleDisplay('sep-nav', 'block');
        toggleDisplay('nav-group', 'flex');
        toggleDisplay('sep-refresh', 'block');
        toggleDisplay('refresh-group', 'flex');
        toggleDisplay('sep-bypass', 'block');
        toggleDisplay('bypass-group', 'flex');
        toggleDisplay('sep-profile', 'block');
        toggleDisplay('profile-container', 'block');

        const autoScrollGroup = document.getElementById('auto-scroll-group');
        const sepScroll = document.getElementById('sep-scroll');
        if (autoScrollGroup && sepScroll) {
            if (activeMode === 'GRID') {
                autoScrollGroup.style.display = 'flex';
                sepScroll.style.display = 'block';
            } else {
                autoScrollGroup.style.display = 'none';
                sepScroll.style.display = 'none';
            }
        }

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
    };

    window.FW_UI.stopScrollIfRunning = async function() {
        if (window.FW_State.isScrolling) {
            await window.floworkDesktop.stopScrollAll();
            window.FW_State.isScrolling = false;
            if(btnStopScroll) btnStopScroll.style.display = 'none';
            if(btnAutoScroll) btnAutoScroll.style.display = 'inline-block';
        }
    };

    btnFlowork.addEventListener('click', async () => {
        await window.floworkDesktop.initFlowork();
        window.FW_UI.updateModeButtons('FLOWORK');
    });

    btnBack.addEventListener('click', async () => {
        const selectedId = botSelector.value;
        if (!selectedId) return alert('Please select a device first!');
        await window.floworkDesktop.goBack(selectedId);
    });

    btnRefresh.addEventListener('click', async () => {
        if (window.FW_State.activeDevices.length === 0) return alert('No active tabs to refresh!');
        await window.floworkDesktop.reloadAllDevices();
    });

    btnNavGo.addEventListener('click', async () => {
        const url = navUrlInput.value.trim();
        const selectedId = botSelector.value;
        if (!selectedId) return alert('Please select a device first!');
        if (url) await window.floworkDesktop.navigate(selectedId, url);
    });

    navUrlInput.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            const url = navUrlInput.value.trim();
            const selectedId = botSelector.value;
            if (!selectedId) return alert('Please select a device first!');
            if (url) await window.floworkDesktop.navigate(selectedId, url);
        }
    });

    btnAutoScroll.addEventListener('click', async () => {
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

    btnStopScroll.addEventListener('click', async () => {
        await window.floworkDesktop.stopScrollAll();
        window.FW_State.isScrolling = false;
        btnStopScroll.style.display = 'none';
        btnAutoScroll.style.display = 'inline-block';
    });

    autoRefreshCheckbox.addEventListener('change', async function() {
        if (this.checked) {
            const interval = parseInt(refreshInterval.value) || 60;
            await window.floworkDesktop.startAutoRefresh(interval);
        } else {
            await window.floworkDesktop.stopAutoRefresh();
        }
    });

    refreshInterval.addEventListener('change', async function() {
        if (autoRefreshCheckbox.checked) {
            const interval = parseInt(this.value) || 60;
            await window.floworkDesktop.startAutoRefresh(interval);
        }
    });

    recordBypassCheckbox.addEventListener('change', async function() {
        await window.floworkDesktop.toggleRecordMode(this.checked);
        if (this.checked) {
            alert("🔴 RECORD MODE ACTIVE!\nPlease click the 'Close' or 'Skip' button on a popup/ad in one of the bot tabs now. The system will record its structure and automatically turn off record mode after 1 click.");
        }
    });

    btnClearBypass.addEventListener('click', async () => {
        if (confirm("Delete all bot memory regarding recorded popups/ads?")) {
            await window.floworkDesktop.clearBypassDb();
            alert("✅ Bypass Memory Cleared! Database empty.");
        }
    });

    window.floworkDesktop.onRecordFinished(() => {
        recordBypassCheckbox.checked = false;
        alert("✅ SMART BYPASS SAVED!\nThe bot now understands the anatomy of the popup. This element will be automatically pressed/destroyed across all tabs forever.");
    });

    window.floworkDesktop.onForceMode((mode) => {
        window.FW_UI.updateModeButtons(mode);
    });
})();