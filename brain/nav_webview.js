// =========================================================================
// FLOWORK OS - NANO MODULAR ARCHITECTURE
// FILE: renderer_modules/nav_webview.js
// DESKRIPSI: Navigation buttons for Flowork Webview pages
//            (Flow Designer, Store, Login/Account)
//            Opens Store/Flow as tabs, navigates login in main view.
// =========================================================================

(function() {
    'use strict';

    const WEBVIEW_BASE = 'https://floworkos.com/webview';

    // Store & Flow open as TABS, Account opens in main VIEW
    const TAB_NAV = {
        'fw-nav-flow':  { id: 'flowork-flow',  name: 'Flow Designer', url: WEBVIEW_BASE + '/flow-designer' },
        'fw-nav-store': { id: 'flowork-store',  name: 'App Store',     url: WEBVIEW_BASE + '/store' },
    };

    const VIEW_NAV = {
        'fw-nav-login': WEBVIEW_BASE + '/login',
    };

    const allBtnIds = [...Object.keys(TAB_NAV), ...Object.keys(VIEW_NAV)];
    const navGroup = document.getElementById('fw-nav-group');

    if (!navGroup) {
        console.warn('[NavWebview] Nav group not found. Skipping init.');
        return;
    }

    function setActiveNav(activeId) {
        allBtnIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.toggle('active', id === activeId);
        });
    }

    function navigateTo(btnId) {
        setActiveNav(btnId);

        // Close tutorial overlay if open
        if (window.FW_UI && window.FW_UI.updateModeButtons) {
            window.FW_UI.updateModeButtons('FLOWORK');
        }
        const tutorialView = document.getElementById('tutorial-view');
        if (tutorialView) tutorialView.style.display = 'none';

        const tabInfo = TAB_NAV[btnId];
        if (tabInfo) {
            // Because the frontend uses openWebviewTab instead of openAppTab
            if (window.openWebviewTab) {
                window.openWebviewTab(tabInfo.id, tabInfo.name, tabInfo.url);
            } else if (window.floworkDesktop && window.floworkDesktop.openAppTab) {
                // Direct tab open fallback
                window.floworkDesktop.openAppTab(tabInfo.id, tabInfo.name, tabInfo.url);
            } else if (window.floworkDesktop && window.floworkDesktop.navigateFlowork) {
                // Last resort: navigate main view
                window.floworkDesktop.navigateFlowork(tabInfo.url);
            }
            return;
        }

        // VIEW navigation (Account/Login)
        const url = VIEW_NAV[btnId];
        if (!url) return;

        if (window.switchToHomeTab) {
            window.switchToHomeTab();
        }

        if (window.floworkDesktop && window.floworkDesktop.navigateFlowork) {
            window.floworkDesktop.navigateFlowork(url);
        } else if (window.floworkDesktop && window.floworkDesktop.initFlowork) {
            window.floworkDesktop.initFlowork().then(() => {
                if (window.floworkDesktop.navigateFlowork) {
                    window.floworkDesktop.navigateFlowork(url);
                }
            });
        }
    }

    // Register click handlers
    allBtnIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('click', () => navigateTo(id));
        }
    });

    // Expose globally
    window.FW_NavWebview = {
        setActiveNav,
        navigateTo
    };

    console.log('[NavWebview] ✅ Webview navigation initialized.');
})();
