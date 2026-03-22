// C:\Users\User\OneDrive\Documents\1.FASE-CODING\FLOWORK_ENGINE_WEB_VIEW\renderer_modules\bot_manager.js
(() => {
    const botSelector = document.getElementById('bot-selector');
    const btnToggleView = document.getElementById('btn-toggle-view');
    const btnAddDeviceModal = document.getElementById('btn-add-device-modal');
    const addBotModal = document.getElementById('add-bot-modal');
    const modalUrlInput = document.getElementById('modal-url-input');
    const modalProxyCheckbox = document.getElementById('modal-proxy-checkbox');
    const modalProxyContainer = document.getElementById('modal-proxy-container');
    const modalProxyInput = document.getElementById('modal-proxy-input');
    const btnModalCancel = document.getElementById('btn-modal-cancel');
    const btnModalLaunch = document.getElementById('btn-modal-launch');
    const btnBuyProxy = document.getElementById('btn-buy-proxy');
    const modalGhostCursorCheckbox = document.getElementById('modal-ghost-cursor-checkbox');
    const modalBandwidthSaverCheckbox = document.getElementById('modal-bandwidth-saver-checkbox');
    const modalSleepCycleCheckbox = document.getElementById('modal-sleep-cycle-checkbox');
    const modalSleepConfig = document.getElementById('modal-sleep-config');
    const sleepWorkMin = document.getElementById('sleep-work-min');
    const sleepRestMin = document.getElementById('sleep-rest-min');
    const cookieModal = document.getElementById('cookie-modal');
    const cookieTextarea = document.getElementById('cookie-textarea');
    const cookieBotIdSpan = document.getElementById('cookie-bot-id');
    const btnCookieCancel = document.getElementById('btn-cookie-cancel');
    const btnCookieExport = document.getElementById('btn-cookie-export');
    const btnCookieImport = document.getElementById('btn-cookie-import');

    window.FW_UI.createDefaultDeviceAndSwitch = async function(targetMode) {
        window.FW_State.deviceCount++;
        const deviceId = `device_${Date.now()}`;
        const partitionName = `persist:bot_${Date.now()}_${Math.floor(Math.random()*1000)}`;
        const uaMode = 'desktop';
        let label = `flow ${window.FW_State.deviceCount}`;
        const url = 'https://www.google.com/search?q="flowork+os"';

        const option = document.createElement('option');
        option.value = deviceId;
        option.text = label;
        botSelector.appendChild(option);
        botSelector.value = deviceId;

        const newDeviceObj = {
            id: deviceId, url: url, partition: partitionName, uaMode: uaMode, label: label,
            useProxy: false, proxyAddress: '', useGhostCursor: false, useBandwidthSaver: false,
            useSleepCycle: false, workMins: 45, sleepMins: 15
        };
        window.FW_State.activeDevices.push(newDeviceObj);

        await window.floworkDesktop.addDevice(newDeviceObj);

        if (targetMode === 'GRID') {
            await window.floworkDesktop.switchToGrid();
            if (window.FW_UI.updateModeButtons) window.FW_UI.updateModeButtons('GRID');
        } else {
            await window.floworkDesktop.switchToNormal(deviceId);
            if (window.FW_UI.updateModeButtons) window.FW_UI.updateModeButtons('NORMAL');
        }
    };

    btnToggleView.addEventListener('click', async () => {
        if (window.FW_State.currentViewMode === 'GRID' || window.FW_State.currentViewMode === 'TUTORIAL' || window.FW_State.currentViewMode === 'FARM') {
            const selectedId = botSelector.value;
            if (!selectedId || window.FW_State.activeDevices.length === 0) {
                await window.FW_UI.createDefaultDeviceAndSwitch('NORMAL');
                return;
            }
            await window.floworkDesktop.switchToNormal(selectedId);
            if (window.FW_UI.updateModeButtons) window.FW_UI.updateModeButtons('NORMAL');
        } else {
            if (window.FW_State.activeDevices.length === 0) {
                await window.FW_UI.createDefaultDeviceAndSwitch('GRID');
                return;
            }
            await window.floworkDesktop.switchToGrid();
            if (window.FW_UI.updateModeButtons) window.FW_UI.updateModeButtons('GRID');
        }
    });

    botSelector.addEventListener('change', async () => {
        if (botSelector.value) {
            await window.floworkDesktop.switchToNormal(botSelector.value);
            if (window.FW_UI.updateModeButtons) window.FW_UI.updateModeButtons('NORMAL');
        }
    });

    if (btnBuyProxy) {
        btnBuyProxy.addEventListener('click', async () => {
            await window.floworkDesktop.openExternalUrl('https://vpn.floworkos.com');
        });
    }

    modalProxyCheckbox.addEventListener('change', function() {
        modalProxyContainer.style.display = this.checked ? 'block' : 'none';
    });

    if (modalSleepCycleCheckbox) {
        modalSleepCycleCheckbox.addEventListener('change', function() {
            modalSleepConfig.style.display = this.checked ? 'flex' : 'none';
        });
    }

    btnAddDeviceModal.addEventListener('click', async () => {
        addBotModal.style.display = 'flex';
        await window.floworkDesktop.toggleModal(true);
    });

    btnModalCancel.addEventListener('click', async () => {
        addBotModal.style.display = 'none';
        await window.floworkDesktop.toggleModal(false);
    });

    btnModalLaunch.addEventListener('click', async () => {
        try {
            let url = modalUrlInput.value.trim();
            if (!url) { alert('URL cannot be empty!'); return; }

            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                if (url.includes(' ') || !url.includes('.')) {
                    url = 'https://www.google.com/search?q=' + encodeURIComponent(url);
                } else { url = 'https://' + url; }
            }

            const useProxy = modalProxyCheckbox.checked;
            const proxyAddress = modalProxyInput.value.trim();
            const useGhostCursor = modalGhostCursorCheckbox ? modalGhostCursorCheckbox.checked : false;
            const useBandwidthSaver = modalBandwidthSaverCheckbox ? modalBandwidthSaverCheckbox.checked : false;
            const useSleepCycle = modalSleepCycleCheckbox ? modalSleepCycleCheckbox.checked : false;
            const workMins = parseInt(sleepWorkMin.value) || 45;
            const sleepMins = parseInt(sleepRestMin.value) || 15;

            window.FW_State.deviceCount++;
            const deviceId = `device_${Date.now()}`;
            const partitionName = `persist:bot_${Date.now()}_${Math.floor(Math.random()*1000)}`;
            const uaMode = 'desktop';
            let label = `flow ${window.FW_State.deviceCount}`;

            const option = document.createElement('option');
            option.value = deviceId;
            option.text = label;
            botSelector.appendChild(option);
            botSelector.value = deviceId;

            const newDeviceObj = { id: deviceId, url, partition: partitionName, uaMode, label, useProxy, proxyAddress, useGhostCursor, useBandwidthSaver, useSleepCycle, workMins, sleepMins };
            window.FW_State.activeDevices.push(newDeviceObj);

            await window.floworkDesktop.addDevice(newDeviceObj);
            addBotModal.style.display = 'none';
            await window.floworkDesktop.toggleModal(false);

            if (window.FW_State.currentViewMode === 'GRID') {
                await window.floworkDesktop.switchToGrid();
                if (window.FW_UI.updateModeButtons) window.FW_UI.updateModeButtons('GRID');
            } else {
                await window.floworkDesktop.switchToNormal(deviceId);
                if (window.FW_UI.updateModeButtons) window.FW_UI.updateModeButtons('NORMAL');
            }
        } catch (err) { alert("Error: " + err.message); }
    });

    window.floworkDesktop.onOpenCookieManager(async (id) => {
        window.FW_State.activeCookieBotId = id;
        cookieBotIdSpan.innerText = id;
        cookieTextarea.value = '';
        cookieModal.style.display = 'flex';
        await window.floworkDesktop.toggleModal(true);
    });

    btnCookieCancel.addEventListener('click', async () => {
        cookieModal.style.display = 'none';
        window.FW_State.activeCookieBotId = null;
        await window.floworkDesktop.toggleModal(false);
    });

    btnCookieExport.addEventListener('click', async () => {
        if (!window.FW_State.activeCookieBotId) return;
        const result = await window.floworkDesktop.exportCookies(window.FW_State.activeCookieBotId);
        if (result.success) {
            cookieTextarea.value = result.data;
            try { await navigator.clipboard.writeText(result.data); }
            catch(e) { cookieTextarea.select(); document.execCommand('copy'); }
            const originalText = btnCookieExport.innerHTML;
            btnCookieExport.innerHTML = '✅ Auto Copied!';
            btnCookieExport.style.backgroundColor = '#28a745';
            setTimeout(() => { btnCookieExport.innerHTML = originalText; btnCookieExport.style.backgroundColor = ''; }, 2000);
        } else {
            const originalText = btnCookieExport.innerHTML;
            btnCookieExport.innerHTML = '❌ Failed!';
            btnCookieExport.style.backgroundColor = '#dc3545';
            setTimeout(() => { btnCookieExport.innerHTML = originalText; btnCookieExport.style.backgroundColor = ''; }, 2000);
        }
    });

    btnCookieImport.addEventListener('click', async () => {
        if (!window.FW_State.activeCookieBotId) return;
        const cookiesStr = cookieTextarea.value.trim();
        if (!cookiesStr) return alert("Paste the Netscape code first, boss!");
        const result = await window.floworkDesktop.importCookies(window.FW_State.activeCookieBotId, cookiesStr);
        if (result.success) {
            alert(`✅ ${result.count} Cookies successfully injected!\nThe bot will automatically reload the page.`);
            cookieModal.style.display = 'none';
            window.FW_State.activeCookieBotId = null;
            await window.floworkDesktop.toggleModal(false);
        } else { alert("❌ Failed to import cookies. Make sure the Netscape format is valid."); }
    });

    window.floworkDesktop.onForceRemoveDevice((deletedId) => {
        window.FW_State.activeDevices = window.FW_State.activeDevices.filter(dev => dev.id !== deletedId);
        const optionElement = botSelector.querySelector(`option[value="${deletedId}"]`);
        if (optionElement) optionElement.remove();

        if (botSelector.options.length > 1) {
            botSelector.selectedIndex = 1;
            if (window.FW_State.currentViewMode === 'NORMAL') {
                window.floworkDesktop.switchToNormal(botSelector.value);
            }
        } else {
            window.floworkDesktop.initFlowork();
            if (window.FW_UI.updateModeButtons) window.FW_UI.updateModeButtons('FLOWORK');
        }
    });
})();