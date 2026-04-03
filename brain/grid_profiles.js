// C:\Users\User\OneDrive\Documents\1.FASE-CODING\FLOWORK_ENGINE_WEB_VIEW\renderer_modules\grid_profiles.js
(() => {
    const profileList = document.getElementById('profile-list');
    const botSelector = document.getElementById('bot-selector');
    const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
    const profileSidebar = document.getElementById('profile-sidebar');
    const btnSaveProfile = document.getElementById('btn-save-profile');
    const profileNameInput = document.getElementById('profile-name-input');
    const ctxMenu = document.getElementById('ctx-menu');
    const ctxDeleteProfile = document.getElementById('ctx-delete-profile');
    const gridUiLayer = document.getElementById('grid-ui-layer');

    window.FW_UI.renderProfiles = function() {
        profileList.innerHTML = '';
        for (let name in window.FW_State.currentProfiles) {
            const div = document.createElement('div');
            div.className = 'profile-item';
            div.innerHTML = `<span>📁 ${name}</span> <span style="font-size:10px; color:#aaa;">(${window.FW_State.currentProfiles[name].length} Tabs)</span>`;

            div.onclick = () => window.FW_UI.loadProfile(name);
            div.oncontextmenu = (e) => {
                e.preventDefault();
                window.FW_State.profileTargetForContext = name;
                ctxMenu.style.display = 'block';
                ctxMenu.style.left = e.pageX + 'px';
                ctxMenu.style.top = e.pageY + 'px';
            };
            profileList.appendChild(div);
        }
    };

    window.FW_UI.loadProfile = async function(name) {
        const devicesToLoad = window.FW_State.currentProfiles[name];
        if (!devicesToLoad) return;

        for (let dev of window.FW_State.activeDevices) {
            await window.floworkDesktop.closeDevice(dev.id);
            botSelector.querySelector(`option[value="${dev.id}"]`)?.remove();
        }
        window.FW_State.activeDevices = [];

        for (let dev of devicesToLoad) {
            const option = document.createElement('option');
            option.value = dev.id;
            option.text = dev.label;
            botSelector.appendChild(option);
            botSelector.value = dev.id;
            window.FW_State.activeDevices.push(dev);
            await window.floworkDesktop.addDevice(dev);
        }

        if (devicesToLoad.length > 0) {
            if (window.FW_State.currentViewMode === 'GRID') {
                await window.floworkDesktop.switchToGrid();
                if (window.FW_UI.updateModeButtons) window.FW_UI.updateModeButtons('GRID');
            } else {
                await window.floworkDesktop.switchToNormal(devicesToLoad[0].id);
                if (window.FW_UI.updateModeButtons) window.FW_UI.updateModeButtons('NORMAL');
            }
        } else {
            await window.floworkDesktop.initFlowork();
            if (window.FW_UI.updateModeButtons) window.FW_UI.updateModeButtons('FLOWORK');
        }
    };

    window.floworkDesktop.onAddToProfile((data) => {
        const { id, name } = data;
        const dev = window.FW_State.activeDevices.find(d => d.id === id);
        if (dev && window.FW_State.currentProfiles[name]) {
            const exists = window.FW_State.currentProfiles[name].find(d => d.id === id);
            if (!exists) {
                window.FW_State.currentProfiles[name].push(dev);
                window.floworkDesktop.saveProfiles(window.FW_State.currentProfiles);
                window.FW_UI.renderProfiles();
            }
        }
    });

    window.floworkDesktop.onRemoveFromProfile(async (data) => {
        const { id, name } = data;
        if (window.FW_State.currentProfiles[name]) {
            const initialLen = window.FW_State.currentProfiles[name].length;
            window.FW_State.currentProfiles[name] = window.FW_State.currentProfiles[name].filter(d => d.id !== id);

            if (window.FW_State.currentProfiles[name].length < initialLen) {
                await window.floworkDesktop.saveProfiles(window.FW_State.currentProfiles);
                window.FW_UI.renderProfiles();
                await window.floworkDesktop.closeDevice(id);
                window.FW_State.activeDevices = window.FW_State.activeDevices.filter(dev => dev.id !== id);
                const optionElement = botSelector.querySelector(`option[value="${id}"]`);
                if (optionElement) optionElement.remove();

                if (botSelector.options.length > 1) {
                    botSelector.selectedIndex = 1;
                    if (window.FW_State.currentViewMode === 'NORMAL') {
                        await window.floworkDesktop.switchToNormal(botSelector.value);
                    }
                } else {
                    await window.floworkDesktop.initFlowork();
                    if (window.FW_UI.updateModeButtons) window.FW_UI.updateModeButtons('FLOWORK');
                }
            }
        }
    });

    btnToggleSidebar.addEventListener('click', async () => {
        const isOpen = profileSidebar.classList.toggle('open');
        await window.floworkDesktop.toggleSidebarMargin(isOpen);
    });

    btnSaveProfile.addEventListener('click', async () => {
        const name = profileNameInput.value.trim();
        if (!name) return alert('Enter a profile name!');
        if (window.FW_State.activeDevices.length === 0) return alert('No active tabs to save!');
        window.FW_State.currentProfiles[name] = [...window.FW_State.activeDevices];
        await window.floworkDesktop.saveProfiles(window.FW_State.currentProfiles);
        profileNameInput.value = '';
        window.FW_UI.renderProfiles();
        alert(`Profile "${name}" saved successfully!`);
    });

    document.addEventListener('click', () => { ctxMenu.style.display = 'none'; });

    ctxDeleteProfile.addEventListener('click', async () => {
        if (window.FW_State.profileTargetForContext && window.FW_State.currentProfiles[window.FW_State.profileTargetForContext]) {
            if(confirm(`Are you sure you want to delete profile "${window.FW_State.profileTargetForContext}"?`)) {
                delete window.FW_State.currentProfiles[window.FW_State.profileTargetForContext];
                await window.floworkDesktop.saveProfiles(window.FW_State.currentProfiles);
                window.FW_UI.renderProfiles();
            }
        }
    });

    window.floworkDesktop.onUpdateGridUI((layoutData, mode) => {
        if (mode !== 'GRID') {
            gridUiLayer.style.display = 'none';
            return;
        }
        gridUiLayer.style.display = 'block';

        const newIds = layoutData.map(d => d.id);
        for (let id in window.FW_State.gridElements) {
            if (!newIds.includes(id)) {
                window.FW_State.gridElements[id].remove();
                delete window.FW_State.gridElements[id];
            }
        }

        layoutData.forEach((item, index) => {
            let el = window.FW_State.gridElements[item.id];
            if (!el) {
                el = document.createElement('div');
                el.className = 'grid-dummy-card';
                const label = window.FW_State.activeDevices.find(d => d.id === item.id)?.label || item.id;
                el.innerHTML = `
                    <div class="card-header" draggable="true" data-id="${item.id}">
                        <div class="card-header-left" style="display: flex; align-items: center; gap: 8px; flex: 1;">
                            <img src="./flowork_logo.svg" class="card-header-icon" alt="FW">
                            <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 70px;" title="${label}">${label}</span>
                            <input type="text" class="card-header-nav" placeholder="URL or Search..." title="Press Enter to navigate or search">
                            <button class="card-header-go" title="Go to URL or Search">GO</button>
                        </div>
                        <div class="card-header-right" style="display: flex; gap: 3px; align-items: center; margin-left: auto;">
                            <button class="card-header-master" title="Set as Master (Sync Actions)" style="background:transparent;border:none;cursor:pointer;">👑</button>
                            <button class="card-header-follow" title="Follow Master" style="background:transparent;border:none;cursor:pointer;">🔗</button>
                            <button class="card-header-menu" title="Bot Dynamic Settings">⚙️</button>
                            <button class="card-header-back" title="Go Back">⬅️</button>
                            <button class="card-header-reload" title="Reload Web Page">🔄</button>
                            <button class="card-header-close" title="Close Tab (Remove from View)">❌</button>
                        </div>
                    </div>
                    <div class="card-middle"><div class="card-side left-side"></div><div class="card-center"></div><div class="card-side right-side"></div></div>
                    <div class="card-footer"><span>⚡ Flowork OS Active Bot</span></div>
                `;
                gridUiLayer.appendChild(el);
                window.FW_State.gridElements[item.id] = el;

                const headerDrag = el.querySelector('.card-header');
                headerDrag.addEventListener('dragstart', (e) => {
                    window.FW_State.draggedId = item.id;
                    e.dataTransfer.setData('text/plain', item.id);
                    e.dataTransfer.effectAllowed = 'move';
                });
                headerDrag.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
                headerDrag.addEventListener('drop', (e) => {
                    e.preventDefault();
                    if (window.FW_State.draggedId && window.FW_State.draggedId !== item.id) {
                        window.floworkDesktop.swapDevices(window.FW_State.draggedId, item.id);
                    }
                    window.FW_State.draggedId = null;
                });

                const menuBtn = el.querySelector('.card-header-menu');
                menuBtn.addEventListener('click', (e) => { e.stopPropagation(); window.floworkDesktop.showDeviceMenu(item.id); });

                const gridNavInput = el.querySelector('.card-header-nav');
                const gridGoBtn = el.querySelector('.card-header-go');
                gridGoBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const url = gridNavInput.value.trim();
                    if (url) window.floworkDesktop.navigate(item.id, url);
                });
                gridNavInput.addEventListener('keydown', (e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') {
                        const url = gridNavInput.value.trim();
                        if (url) window.floworkDesktop.navigate(item.id, url);
                    }
                });

                const gridBackBtn = el.querySelector('.card-header-back');
                gridBackBtn.addEventListener('click', (e) => { e.stopPropagation(); window.floworkDesktop.goBack(item.id); });

                const gridReloadBtn = el.querySelector('.card-header-reload');
                gridReloadBtn.addEventListener('click', (e) => { e.stopPropagation(); window.floworkDesktop.reloadDevice(item.id); });

                const closeBtn = el.querySelector('.card-header-close');
                closeBtn.addEventListener('click', (e) => { e.stopPropagation(); window.floworkDesktop.closeDeviceView(item.id); });
            }

            const masterBtn = el.querySelector('.card-header-master');
            const followBtn = el.querySelector('.card-header-follow');
            const header = el.querySelector('.card-header');

            if (index === 0) {
                el.style.boxShadow = '0 0 12px rgba(255, 215, 0, 0.6)';
                el.style.border = '2px solid #FFD700';
                header.style.background = 'linear-gradient(90deg, #4A3B00 0%, #1a1a1a 100%)';
                masterBtn.style.display = 'inline-block';
                followBtn.style.display = 'none';

                window.floworkDesktop.setSyncRole(item.id, { isMaster: window.FW_State.isMasterActive, isFollower: false });
                masterBtn.style.opacity = window.FW_State.isMasterActive ? '1' : '0.4';

                masterBtn.onclick = (e) => {
                    e.stopPropagation();
                    window.FW_State.isMasterActive = !window.FW_State.isMasterActive;
                    masterBtn.style.opacity = window.FW_State.isMasterActive ? '1' : '0.4';
                    window.floworkDesktop.setSyncRole(item.id, { isMaster: window.FW_State.isMasterActive, isFollower: false });
                };
            } else {
                el.style.boxShadow = 'none';
                el.style.border = 'none';
                header.style.background = '';
                masterBtn.style.display = 'none';
                followBtn.style.display = 'inline-block';

                let isFollowing = window.FW_State.followerStates[item.id] !== false;
                followBtn.style.opacity = isFollowing ? '1' : '0.4';
                followBtn.style.color = isFollowing ? '#3DDC84' : 'gray';

                window.floworkDesktop.setSyncRole(item.id, { isMaster: false, isFollower: isFollowing });

                followBtn.onclick = (e) => {
                    e.stopPropagation();
                    let currentState = window.FW_State.followerStates[item.id] !== false;
                    window.FW_State.followerStates[item.id] = !currentState;
                    let isFollowingNow = window.FW_State.followerStates[item.id];
                    followBtn.style.opacity = isFollowingNow ? '1' : '0.4';
                    followBtn.style.color = isFollowingNow ? '#3DDC84' : 'gray';
                    window.floworkDesktop.setSyncRole(item.id, { isMaster: false, isFollower: isFollowingNow });
                };
            }
            el.style.left = item.x + 'px';
            el.style.top = item.y + 'px';
            el.style.width = item.w + 'px';
            el.style.height = item.h + 'px';
        });
    });

    window.addEventListener('wheel', (e) => {
        if (window.FW_State.currentViewMode === 'GRID') {
            window.floworkDesktop.scrollGrid(e.deltaY);
        }
    });
})();