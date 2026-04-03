// =========================================================================
// FLOWORK OS - NANO MODULAR ARCHITECTURE
// FILE: brain/tab_manager.js
// DESKRIPSI: Triple Tab System Manager
//   1. SIDEBAR (left) — 7 permanent tabs: Dashboard, BotFarm, Browser, AI Train, Flow, Store, Tutorial
//   2. HEADER (control panel inline) — Compact chip tabs for apps/browser opened by AI
//   3. DASHBOARD center-tabs — handled by dashboard.html (code viewer/progress tabs)
// =========================================================================

(function() {
    'use strict';

    // ═════════════════════════════════════════════════════════════
    // STATE
    // ═════════════════════════════════════════════════════════════
    const SIDEBAR_STATE = {
        activeTabId: null
    };

    const HEADER_STATE = {
        tabs: {},           // { tabId: { id, label, icon, tabEl } }
        activeTabId: null,
        tabOrder: []
    };

    // ═════════════════════════════════════════════════════════════
    // DOM REFERENCES
    // ═════════════════════════════════════════════════════════════
    const sidebarBar = document.getElementById('fw-tab-bar');
    const headerBar = document.getElementById('fw-header-tabs');

    if (!sidebarBar) {
        console.warn('[TabManager] Sidebar tab bar not found. Skipping init.');
        return;
    }

    // ═════════════════════════════════════════════════════════════
    // PERMANENT SIDEBAR TABS — Fixed set, no add/remove
    // ═════════════════════════════════════════════════════════════
    const PERMANENT_TABS = [
        { id: 'dashboard',     elemId: 'fw-tab-dashboard', label: 'Dashboard', url: 'native://dashboard' },
        { id: 'botfarm',       elemId: 'fw-tab-botfarm',  label: 'Bot Farm',  url: 'native://botfarm' },
        { id: 'browser',       elemId: 'fw-tab-browser',  label: 'Browser',   url: 'native://browser' },
        { id: 'aitrain',       elemId: 'fw-tab-aitrain',  label: 'AI Train',  url: 'native://aitrain' },
        { id: 'flowork-flow',  elemId: 'fw-tab-flow',     label: 'Flow',      url: 'https://floworkos.com/webview/flow-designer' },
        { id: 'flowork-store', elemId: 'fw-tab-store',    label: 'Store',     url: 'https://floworkos.com/webview/store' },
        { id: 'tutorial',      elemId: 'fw-tab-tutorial',  label: 'Tutorial',  url: 'native://tutorial' },
    ];

    // Track which BrowserView webviews have been created
    const _createdWebviews = {};

    // ═════════════════════════════════════════════════════════════
    // SIDEBAR: Switch to Home (deactivate all)
    // ═════════════════════════════════════════════════════════════
    function switchToHomeTab() {
        SIDEBAR_STATE.activeTabId = null;

        // Deactivate all sidebar tabs
        sidebarBar.querySelectorAll('.fw-tab-btn').forEach(b => b.classList.remove('active'));

        // Hide all native overlays
        ['tutorial-view', 'aitrain-view', 'settings-view', 'grid-empty-state'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });

        // Reset header menus
        if (window.FW_UI && window.FW_UI.updateModeButtons) {
            window.FW_UI.updateModeButtons('FLOWORK');
        }

        // Hide ALL BrowserViews
        if (window.floworkDesktop && window.floworkDesktop.initFlowork) {
            window.floworkDesktop.initFlowork();
        }
        if (window.floworkDesktop && window.floworkDesktop.switchAppTab) {
            window.floworkDesktop.switchAppTab('__HOME__');
        }
    }

    // ═════════════════════════════════════════════════════════════
    // SIDEBAR: Switch to a permanent tab
    // ═════════════════════════════════════════════════════════════
    function switchSidebarTab(tabId) {
        SIDEBAR_STATE.activeTabId = tabId;

        // Update sidebar highlights
        sidebarBar.querySelectorAll('.fw-tab-btn').forEach(b => b.classList.remove('active'));
        const tabEl = sidebarBar.querySelector(`[data-tab-id="${tabId}"]`);
        if (tabEl) tabEl.classList.add('active');

        // Deactivate header tabs visual (sidebar takes precedence)
        if (headerBar) {
            headerBar.querySelectorAll('.header-tab').forEach(b => b.classList.remove('active'));
        }

        // Hide native overlays
        ['tutorial-view', 'aitrain-view', 'settings-view', 'grid-empty-state'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });

        // ─── DASHBOARD ────────────────────────────
        if (tabId === 'dashboard') {
            if (window.floworkDesktop && window.floworkDesktop.switchAppTab)
                window.floworkDesktop.switchAppTab('__HOME__');
            if (window.FW_UI && window.FW_UI.updateModeButtons)
                window.FW_UI.updateModeButtons('FLOWORK');
            if (window.floworkDesktop && window.floworkDesktop.initFlowork)
                window.floworkDesktop.initFlowork();
            // Show header tabs on dashboard
            updateHeaderTabsVisibility(tabId);
            return;
        }

        // ─── BOT FARM ─────────────────────────────
        if (tabId === 'botfarm') {
            if (window.floworkDesktop && window.floworkDesktop.switchAppTab)
                window.floworkDesktop.switchAppTab('__HOME__');
            if (window.FW_State && window.FW_State.activeDevices && window.FW_State.activeDevices.length === 0) {
                if (window.FW_UI && window.FW_UI.createDefaultDeviceAndSwitch) {
                    window.FW_UI.createDefaultDeviceAndSwitch('GRID');
                    updateHeaderTabsVisibility(tabId);
                    return;
                }
            }
            if (window.floworkDesktop && window.floworkDesktop.switchToGrid)
                window.floworkDesktop.switchToGrid();
            if (window.FW_UI && window.FW_UI.updateModeButtons)
                window.FW_UI.updateModeButtons('GRID');
            // Hide header tabs on botfarm
            updateHeaderTabsVisibility(tabId);
            return;
        }

        // ─── BROWSER ──────────────────────────────
        if (tabId === 'browser') {
            if (window.floworkDesktop && window.floworkDesktop.switchAppTab)
                window.floworkDesktop.switchAppTab('__HOME__');
            if (window.FW_State && window.FW_State.activeDevices && window.FW_State.activeDevices.length === 0) {
                if (window.FW_UI && window.FW_UI.createDefaultDeviceAndSwitch) {
                    window.FW_UI.createDefaultDeviceAndSwitch('NORMAL');
                    return;
                }
            }
            let selectedId = null;
            const botSelector = document.getElementById('bot-selector');
            if (botSelector) selectedId = botSelector.value;
            if (!selectedId && window.FW_State && window.FW_State.activeDevices && window.FW_State.activeDevices.length > 0) {
                const firstDev = window.FW_State.activeDevices[0];
                selectedId = typeof firstDev === 'string' ? firstDev : firstDev.id;
                if (botSelector) botSelector.value = selectedId;
            }
            if (selectedId) {
                if (window.floworkDesktop && window.floworkDesktop.switchToNormal)
                    window.floworkDesktop.switchToNormal(selectedId);
                if (window.FW_UI && window.FW_UI.updateModeButtons)
                    window.FW_UI.updateModeButtons('NORMAL');
            }
            // Hide header tabs on browser  
            updateHeaderTabsVisibility(tabId);
            return;
        }

        // ─── AI TRAIN / SETTINGS ──────────────────
        if (tabId === 'aitrain' || tabId === 'settings') {
            if (!_createdWebviews[tabId]) {
                var baseUrl = window.location.href.replace(/[^\/\\]*$/, '');
                var fileUrl = tabId === 'aitrain'
                    ? baseUrl + 'aitraining.html'
                    : baseUrl + 'settings.html';
                var tabLabel = tabId === 'aitrain' ? 'AI Train' : 'Settings';
                if (window.floworkDesktop && window.floworkDesktop.openAppTab) {
                    window.floworkDesktop.openAppTab(tabId, tabLabel, fileUrl);
                    _createdWebviews[tabId] = true;
                }
            }
            if (window.floworkDesktop && window.floworkDesktop.switchAppTab) {
                window.floworkDesktop.switchAppTab(tabId);
            }
            return;
        }

        // ─── TUTORIAL ─────────────────────────────
        if (tabId === 'tutorial') {
            if (window.FW_UI && window.FW_UI.updateModeButtons)
                window.FW_UI.updateModeButtons('TUTORIAL');
            if (window.FW_State && !window.FW_State.tutorialsLoaded) {
                const listEl = document.getElementById('tutorial-list');
                if (listEl && listEl.children.length === 0) {
                    if (window.floworkDesktop && typeof window.floworkDesktop.fetchTutorials === 'function') {
                        window.FW_State.tutorialsLoaded = true;
                        window.floworkDesktop.fetchTutorials().then(function(result) {
                            if (result && result.success && result.tutorials && result.tutorials.length > 0) {
                                _renderTutorialCards(listEl, result.tutorials);
                            } else {
                                _renderTutorialFallback(listEl);
                            }
                        }).catch(function() { _renderTutorialFallback(listEl); });
                    } else {
                        _renderTutorialFallback(listEl);
                    }
                }
            }
            return;
        }

        // ─── FLOW / STORE / OTHER BrowserView tabs ─
        if (!_createdWebviews[tabId]) {
            const pt = PERMANENT_TABS.find(p => p.id === tabId);
            if (pt && !pt.url.startsWith('native://')) {
                if (window.floworkDesktop && window.floworkDesktop.openAppTab) {
                    window.floworkDesktop.openAppTab(pt.id, pt.label, pt.url);
                    _createdWebviews[pt.id] = true;
                }
            }
        }
        if (window.FW_UI && window.FW_UI.updateModeButtons)
            window.FW_UI.updateModeButtons('FLOWORK');
        if (window.floworkDesktop && window.floworkDesktop.switchAppTab)
            window.floworkDesktop.switchAppTab(tabId);
    }

    // Register sidebar click handlers
    PERMANENT_TABS.forEach(pt => {
        const tabBtn = document.getElementById(pt.elemId);
        if (!tabBtn) return;
        tabBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            switchSidebarTab(pt.id);
        });
    });

    // ═════════════════════════════════════════════════════════════
    // HEADER TABS: Chrome-like dynamic tabs
    // ═════════════════════════════════════════════════════════════

    function updateHeaderBarVisibility() {
        // No-op: header tabs are inline in control panel, CSS :empty handles visibility
    }

    // Show/hide header tabs based on current sidebar tab
    function updateHeaderTabsVisibility(sidebarTabId) {
        if (!headerBar) return;
        const hideOn = ['botfarm', 'browser'];
        if (hideOn.includes(sidebarTabId)) {
            headerBar.style.display = 'none';
        } else {
            headerBar.style.display = 'flex';
        }
    }

    function openHeaderTab(tabId, label, url, icon) {
        // If already exists, just switch
        if (HEADER_STATE.tabs[tabId]) {
            switchHeaderTab(tabId);
            return tabId;
        }

        icon = icon || '📦';
        const id = tabId || ('htab_' + Date.now());

        // Tell main process to create BrowserView
        if (window.floworkDesktop && window.floworkDesktop.openAppTab && url && !url.startsWith('native://')) {
            window.floworkDesktop.openAppTab(id, label, url);
        }

        // Create header tab DOM  
        const tabEl = document.createElement('div');
        tabEl.className = 'header-tab';
        tabEl.setAttribute('data-tab-id', id);
        tabEl.setAttribute('draggable', 'true');

        tabEl.innerHTML = `
            <span class="ht-icon">${icon}</span>
            <span class="ht-label" title="${label || id}">${_truncate(label || id, 20)}</span>
            <button class="ht-close" title="Close">✕</button>
        `;

        // Click to switch
        tabEl.addEventListener('click', (e) => {
            if (e.target.closest('.ht-close')) return;
            switchHeaderTab(id);
        });

        // Middle-click to close
        tabEl.addEventListener('mousedown', (e) => {
            if (e.button === 1) { e.preventDefault(); closeHeaderTab(id); }
        });

        // Close button
        tabEl.querySelector('.ht-close').addEventListener('click', (e) => {
            e.stopPropagation();
            closeHeaderTab(id);
        });

        // Drag-to-reorder
        tabEl.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', id);
            tabEl.classList.add('dragging');
        });
        tabEl.addEventListener('dragend', () => {
            tabEl.classList.remove('dragging');
            headerBar.querySelectorAll('.header-tab').forEach(t => t.classList.remove('drag-over'));
        });
        tabEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            tabEl.classList.add('drag-over');
        });
        tabEl.addEventListener('dragleave', () => {
            tabEl.classList.remove('drag-over');
        });
        tabEl.addEventListener('drop', (e) => {
            e.preventDefault();
            tabEl.classList.remove('drag-over');
            const draggedId = e.dataTransfer.getData('text/plain');
            if (draggedId && draggedId !== id) {
                _reorderHeaderTabs(draggedId, id);
            }
        });

        headerBar.appendChild(tabEl);

        // Register state
        HEADER_STATE.tabs[id] = { id, label: label || id, icon, tabEl };
        HEADER_STATE.tabOrder.push(id);

        updateHeaderBarVisibility();
        switchHeaderTab(id);
        return id;
    }

    function closeHeaderTab(tabId) {
        const tab = HEADER_STATE.tabs[tabId];
        if (!tab) return;

        // Remove DOM
        if (tab.tabEl && tab.tabEl.parentNode) tab.tabEl.remove();

        // Remove from state
        delete HEADER_STATE.tabs[tabId];
        HEADER_STATE.tabOrder = HEADER_STATE.tabOrder.filter(id => id !== tabId);

        // Tell main process to destroy BrowserView
        if (window.floworkDesktop && window.floworkDesktop.closeAppTab) {
            window.floworkDesktop.closeAppTab(tabId);
        }

        // Switch to next tab or go home
        if (HEADER_STATE.activeTabId === tabId) {
            if (HEADER_STATE.tabOrder.length > 0) {
                switchHeaderTab(HEADER_STATE.tabOrder[HEADER_STATE.tabOrder.length - 1]);
            } else {
                HEADER_STATE.activeTabId = null;
                // Re-activate the last sidebar tab or go home
                if (SIDEBAR_STATE.activeTabId) {
                    switchSidebarTab(SIDEBAR_STATE.activeTabId);
                } else {
                    switchToHomeTab();
                }
            }
        }

        updateHeaderBarVisibility();
    }

    function switchHeaderTab(tabId) {
        const tab = HEADER_STATE.tabs[tabId];
        if (!tab) return;

        HEADER_STATE.activeTabId = tabId;

        // Deactivate sidebar visual (header tab is active)
        // But keep sidebar state so we can restore it when header tabs are all closed
        sidebarBar.querySelectorAll('.fw-tab-btn').forEach(b => b.classList.remove('active'));

        // Deactivate all header tabs, activate this one
        headerBar.querySelectorAll('.header-tab').forEach(b => b.classList.remove('active'));
        tab.tabEl.classList.add('active');

        // Hide native overlays
        ['tutorial-view', 'aitrain-view', 'settings-view'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });

        // Switch BrowserView
        if (window.FW_UI && window.FW_UI.updateModeButtons)
            window.FW_UI.updateModeButtons('FLOWORK');
        if (window.floworkDesktop && window.floworkDesktop.switchAppTab)
            window.floworkDesktop.switchAppTab(tabId);
    }

    function _reorderHeaderTabs(draggedId, targetId) {
        const order = HEADER_STATE.tabOrder;
        const fromIdx = order.indexOf(draggedId);
        const toIdx = order.indexOf(targetId);
        if (fromIdx < 0 || toIdx < 0) return;

        // Remove from old position
        order.splice(fromIdx, 1);
        // Insert at new position
        order.splice(toIdx, 0, draggedId);

        // Re-render DOM order
        order.forEach(id => {
            const tab = HEADER_STATE.tabs[id];
            if (tab && tab.tabEl) headerBar.appendChild(tab.tabEl);
        });
    }

    // ═════════════════════════════════════════════════════════════
    // UNIFIED openWebviewTab — routes to correct tab system
    // ═════════════════════════════════════════════════════════════
    function openWebviewTab(tabId, label, url) {
        // Check if this is a permanent sidebar tab
        const isPermanent = PERMANENT_TABS.some(pt => pt.id === tabId);
        if (isPermanent) {
            switchSidebarTab(tabId);
            return tabId;
        }

        // Otherwise, open as header tab
        return openHeaderTab(tabId, label, url);
    }

    // ═════════════════════════════════════════════════════════════
    // TUTORIAL RENDERING HELPERS
    // ═════════════════════════════════════════════════════════════
    const FALLBACK_TUTORIALS = [
        { title: 'Flowork OS Tools Serba Bisa buat Content Creator, Affiliator, Team Seo', videoId: '9al1rmH3m-A', link: 'https://www.youtube.com/watch?v=9al1rmH3m-A' },
        { title: 'Cara Install Extensi Chrome Untuk FLowork OS', videoId: 'Us2p7vwjlWw', link: 'https://www.youtube.com/watch?v=Us2p7vwjlWw' },
        { title: 'Cara Bongkar Algoritma TikTok Pake Flowork OS TikTok Deepscan', videoId: 'E_vgtrOqR68', link: 'https://www.youtube.com/watch?v=E_vgtrOqR68' },
        { title: 'Trik Rahasia Jadi Shopee Affiliator Tanpa Beli Sample Produk pake tools Flowork OS', videoId: 'mQcEaoQ4F-4', link: 'https://www.youtube.com/watch?v=mQcEaoQ4F-4' },
        { title: 'Bongkar Rahasia Video Kompetitor Agar Video Kita Naik Pake YT DeepScan dari floworkos', videoId: 'ray_XK8LwP0', link: 'https://www.youtube.com/watch?v=ray_XK8LwP0' },
        { title: 'Bongkar Trafik Website Competitor Dengat Tools Dari Flowork OS', videoId: 'GL64WgWsie0', link: 'https://www.youtube.com/watch?v=GL64WgWsie0' },
        { title: 'FLOWORK OS BRIDGE', videoId: 'fLY-RJ2e1aA', link: 'https://www.youtube.com/watch?v=fLY-RJ2e1aA' }
    ];

    function _createTutorialCard(title, videoId, link) {
        var card = document.createElement('div');
        card.style.cssText = 'width:290px;background:linear-gradient(160deg,rgba(59,130,246,0.08),rgba(139,92,246,0.04),rgba(14,21,40,0.9));border-radius:12px;overflow:hidden;cursor:pointer;border:1px solid rgba(80,140,255,0.22);transition:all 0.35s cubic-bezier(.4,0,.2,1);display:flex;flex-direction:column;backdrop-filter:blur(12px);position:relative;';
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:calc(100% - 56px);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity 0.25s;background:rgba(8,12,24,0.5);z-index:3;';
        overlay.innerHTML = '<div style="width:54px;height:54px;border-radius:50%;background:linear-gradient(135deg,#3b82f6,#8b5cf6);display:flex;align-items:center;justify-content:center;box-shadow:0 0 25px rgba(59,130,246,0.5);"><span style="color:#fff;font-size:22px;margin-left:3px;">▶</span></div>';
        card.onmouseenter = function() { card.style.transform='translateY(-6px) scale(1.02)'; card.style.borderColor='rgba(80,180,255,0.5)'; card.style.boxShadow='0 10px 30px rgba(59,130,246,0.2)'; overlay.style.opacity='1'; };
        card.onmouseleave = function() { card.style.transform='translateY(0) scale(1)'; card.style.borderColor='rgba(80,140,255,0.22)'; card.style.boxShadow='none'; overlay.style.opacity='0'; };
        var thumbEl = document.createElement('img');
        thumbEl.src = 'https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg';
        thumbEl.alt = 'Tutorial';
        thumbEl.style.cssText = 'width:100%;aspect-ratio:16/9;object-fit:cover;display:block;border-bottom:2px solid #3b82f6;';
        var shine = document.createElement('div');
        shine.style.cssText = 'position:absolute;top:0;left:0;right:0;height:45%;background:linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02),transparent);pointer-events:none;border-radius:12px 12px 0 0;z-index:1;';
        var titleDiv = document.createElement('div');
        titleDiv.style.cssText = 'padding:14px 16px;color:#b4c6e0;font-size:13px;font-weight:600;line-height:1.4;font-family:"Inter","Segoe UI",sans-serif;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:42px;';
        titleDiv.textContent = title;
        titleDiv.title = title;
        card.appendChild(shine); card.appendChild(thumbEl); card.appendChild(overlay); card.appendChild(titleDiv);
        card.addEventListener('click', function() {
            if (!link) return;
            if (window.floworkDesktop && window.floworkDesktop.openExternalUrl) window.floworkDesktop.openExternalUrl(link);
            else window.open(link, '_blank');
        });
        return card;
    }

    function _renderTutorialCards(listEl, tutorials) {
        listEl.innerHTML = '';
        tutorials.forEach(function(t) { listEl.appendChild(_createTutorialCard(t.title, t.videoId, t.link)); });
    }

    function _renderTutorialFallback(listEl) { _renderTutorialCards(listEl, FALLBACK_TUTORIALS); }

    // ═════════════════════════════════════════════════════════════
    // HELPERS
    // ═════════════════════════════════════════════════════════════
    function _truncate(str, max) {
        if (!str) return 'App';
        return str.length > max ? str.substring(0, max) + '…' : str;
    }

    // ═════════════════════════════════════════════════════════════
    // IPC EVENT LISTENERS
    // ═════════════════════════════════════════════════════════════
    if (window.floworkDesktop) {
        // When main process opens a tab (from AI WebSocket or dashboard action)
        if (window.floworkDesktop.onAppTabOpened) {
            window.floworkDesktop.onAppTabOpened((tabId, tabName) => {
                // If it's a permanent sidebar tab, just switch
                const isPermanent = PERMANENT_TABS.some(pt => pt.id === tabId);
                if (isPermanent) {
                    switchSidebarTab(tabId);
                    return;
                }
                // Otherwise create header tab
                if (!HEADER_STATE.tabs[tabId]) {
                    // Add to header without re-creating BrowserView
                    const tabEl = document.createElement('div');
                    tabEl.className = 'header-tab active';
                    tabEl.setAttribute('data-tab-id', tabId);
                    tabEl.setAttribute('draggable', 'true');
                    tabEl.innerHTML = `
                        <span class="ht-icon">📦</span>
                        <span class="ht-label" title="${tabName || tabId}">${_truncate(tabName || tabId, 20)}</span>
                        <button class="ht-close" title="Close">✕</button>
                    `;
                    tabEl.addEventListener('click', (e) => {
                        if (e.target.closest('.ht-close')) return;
                        switchHeaderTab(tabId);
                    });
                    tabEl.addEventListener('mousedown', (e) => {
                        if (e.button === 1) { e.preventDefault(); closeHeaderTab(tabId); }
                    });
                    tabEl.querySelector('.ht-close').addEventListener('click', (e) => {
                        e.stopPropagation();
                        closeHeaderTab(tabId);
                    });
                    // Drag
                    tabEl.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', tabId); tabEl.classList.add('dragging'); });
                    tabEl.addEventListener('dragend', () => { tabEl.classList.remove('dragging'); headerBar.querySelectorAll('.header-tab').forEach(t => t.classList.remove('drag-over')); });
                    tabEl.addEventListener('dragover', (e) => { e.preventDefault(); tabEl.classList.add('drag-over'); });
                    tabEl.addEventListener('dragleave', () => { tabEl.classList.remove('drag-over'); });
                    tabEl.addEventListener('drop', (e) => { e.preventDefault(); tabEl.classList.remove('drag-over'); const did = e.dataTransfer.getData('text/plain'); if (did && did !== tabId) _reorderHeaderTabs(did, tabId); });

                    headerBar.appendChild(tabEl);
                    HEADER_STATE.tabs[tabId] = { id: tabId, label: tabName || tabId, icon: '📦', tabEl };
                    HEADER_STATE.tabOrder.push(tabId);
                }
                // Activate
                HEADER_STATE.activeTabId = tabId;
                sidebarBar.querySelectorAll('.fw-tab-btn').forEach(b => b.classList.remove('active'));
                headerBar.querySelectorAll('.header-tab').forEach(b => b.classList.remove('active'));
                if (HEADER_STATE.tabs[tabId]) HEADER_STATE.tabs[tabId].tabEl.classList.add('active');
                updateHeaderBarVisibility();
            });
        }

        if (window.floworkDesktop.onAppTabClosed) {
            window.floworkDesktop.onAppTabClosed((tabId) => {
                const tab = HEADER_STATE.tabs[tabId];
                if (tab) {
                    if (tab.tabEl && tab.tabEl.parentNode) tab.tabEl.remove();
                    delete HEADER_STATE.tabs[tabId];
                    HEADER_STATE.tabOrder = HEADER_STATE.tabOrder.filter(id => id !== tabId);
                    updateHeaderBarVisibility();
                }
            });
        }
    }

    // Header tab bar horizontal scroll with mouse wheel
    if (headerBar) {
        headerBar.addEventListener('wheel', (e) => {
            if (e.deltaY !== 0) { e.preventDefault(); headerBar.scrollLeft += e.deltaY; }
        }, { passive: false });
    }

    // ═════════════════════════════════════════════════════════════
    // EXPOSE GLOBALLY
    // ═════════════════════════════════════════════════════════════
    window.openWebviewTab = openWebviewTab;
    window.openHeaderTab = openHeaderTab;
    window.closeHeaderTab = closeHeaderTab;
    window.closeWebviewTab = closeHeaderTab; // alias for backward compat
    window.switchToHomeTab = switchToHomeTab;
    window.switchToTab = function(tabId) {
        const isPermanent = PERMANENT_TABS.some(pt => pt.id === tabId);
        if (isPermanent) switchSidebarTab(tabId);
        else if (HEADER_STATE.tabs[tabId]) switchHeaderTab(tabId);
    };
    window.getActiveTabId = function() {
        return HEADER_STATE.activeTabId || SIDEBAR_STATE.activeTabId || null;
    };
    window.getAllTabs = function() {
        return HEADER_STATE.tabOrder.map(id => ({ id, label: HEADER_STATE.tabs[id].label }));
    };
    window.FW_TabState = HEADER_STATE;
    window.FW_SidebarState = SIDEBAR_STATE;

    console.log('[TabManager] ✅ Triple Tab System initialized. Sidebar:', PERMANENT_TABS.map(t => t.id).join(', '));
})();
