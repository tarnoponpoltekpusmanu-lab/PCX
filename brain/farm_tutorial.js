// =========================================================================
// FLOWORK OS - NANO MODULAR ARCHITECTURE
// FILE: brain/farm_tutorial.js
// DESKRIPSI: Tutorial Video dari Flowork OS YouTube Playlist
//            Uses IPC to fetch RSS, with hardcoded fallback when RSS fails
//            Self-contained — works both in Electron and plain browser
// =========================================================================

(function() {
    'use strict';

    const PLAYLIST_ID = 'PLATUnnrT5igDXCqjBVvkmE4UKq9XASUtT';
    const PLAYLIST_URL = 'https://www.youtube.com/playlist?list=' + PLAYLIST_ID;

    // Hardcoded video list from the FLOWORK playlist (YouTube RSS returns 404)
    const FALLBACK_TUTORIALS = [
        {
            title: 'Flowork OS Tools Serba Bisa buat Content Creator, Affiliator, Team Seo',
            videoId: '9al1rmH3m-A',
            link: 'https://www.youtube.com/watch?v=9al1rmH3m-A'
        },
        {
            title: 'Cara Install Extensi Chrome Untuk FLowork OS',
            videoId: 'Us2p7vwjlWw',
            link: 'https://www.youtube.com/watch?v=Us2p7vwjlWw'
        },
        {
            title: 'Cara Bongkar Algoritma TikTok Pake Flowork OS TikTok Deepscan',
            videoId: 'E_vgtrOqR68',
            link: 'https://www.youtube.com/watch?v=E_vgtrOqR68'
        },
        {
            title: 'Trik Rahasia Jadi Shopee Affiliator Tanpa Beli Sample Produk pake tools Flowork OS',
            videoId: 'mQcEaoQ4F-4',
            link: 'https://www.youtube.com/watch?v=mQcEaoQ4F-4'
        },
        {
            title: 'Bongkar Rahasia Video Kompetitor Agar Video Kita Naik Pake YT DeepScan dari floworkos',
            videoId: 'ray_XK8LwP0',
            link: 'https://www.youtube.com/watch?v=ray_XK8LwP0'
        },
        {
            title: 'Bongkar Trafik Website Competitor Dengat Tools Dari Flowork OS',
            videoId: 'GL64WgWsie0',
            link: 'https://www.youtube.com/watch?v=GL64WgWsie0'
        },
        {
            title: 'FLOWORK OS BRIDGE',
            videoId: 'fLY-RJ2e1aA',
            link: 'https://www.youtube.com/watch?v=fLY-RJ2e1aA'
        }
    ];

    function createFuturisticCard(title, videoId, link, thumbnail) {
        var card = document.createElement('div');
        card.style.cssText = 'width:290px;background:linear-gradient(160deg,rgba(59,130,246,0.08),rgba(139,92,246,0.04),rgba(14,21,40,0.9));border-radius:12px;overflow:hidden;cursor:pointer;border:1px solid rgba(80,140,255,0.22);transition:all 0.35s cubic-bezier(.4,0,.2,1);display:flex;flex-direction:column;backdrop-filter:blur(12px);position:relative;';

        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:calc(100% - 56px);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity 0.25s;background:rgba(8,12,24,0.5);z-index:3;';
        overlay.innerHTML = '<div style="width:54px;height:54px;border-radius:50%;background:linear-gradient(135deg,#3b82f6,#8b5cf6);display:flex;align-items:center;justify-content:center;box-shadow:0 0 25px rgba(59,130,246,0.5);"><span style="color:#fff;font-size:22px;margin-left:3px;">▶</span></div>';

        card.onmouseenter = function() {
            card.style.transform = 'translateY(-6px) scale(1.02)';
            card.style.borderColor = 'rgba(80,180,255,0.5)';
            card.style.boxShadow = '0 10px 30px rgba(59,130,246,0.2), 0 0 20px rgba(139,92,246,0.1)';
            overlay.style.opacity = '1';
        };
        card.onmouseleave = function() {
            card.style.transform = 'translateY(0) scale(1)';
            card.style.borderColor = 'rgba(80,140,255,0.22)';
            card.style.boxShadow = 'none';
            overlay.style.opacity = '0';
        };

        // Thumbnail or placeholder
        var thumbEl;
        if (thumbnail && !thumbnail.includes('FALLBACK_')) {
            thumbEl = document.createElement('img');
            thumbEl.src = thumbnail;
            thumbEl.alt = 'Tutorial';
            thumbEl.style.cssText = 'width:100%;aspect-ratio:16/9;object-fit:cover;display:block;border-bottom:2px solid #3b82f6;';
        } else if (videoId && !videoId.startsWith('FALLBACK_')) {
            thumbEl = document.createElement('img');
            thumbEl.src = 'https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg';
            thumbEl.alt = 'Tutorial';
            thumbEl.style.cssText = 'width:100%;aspect-ratio:16/9;object-fit:cover;display:block;border-bottom:2px solid #3b82f6;';
        } else {
            thumbEl = document.createElement('div');
            thumbEl.style.cssText = 'width:100%;aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#0e1528 0%,#1a2744 50%,#0e1528 100%);border-bottom:2px solid #3b82f6;';
            thumbEl.innerHTML = '<span style="font-size:42px;opacity:0.35;">📺</span>';
        }

        // Shine effect
        var shine = document.createElement('div');
        shine.style.cssText = 'position:absolute;top:0;left:0;right:0;height:45%;background:linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02),transparent);pointer-events:none;border-radius:12px 12px 0 0;z-index:1;';

        var topGlow = document.createElement('div');
        topGlow.style.cssText = 'position:absolute;top:0;left:10%;right:10%;height:1px;background:linear-gradient(90deg,transparent,rgba(59,130,246,0.5),transparent);z-index:2;';

        var titleDiv = document.createElement('div');
        titleDiv.style.cssText = 'padding:14px 16px;color:#b4c6e0;font-size:13px;font-weight:600;line-height:1.4;font-family:"Inter","Segoe UI",sans-serif;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:42px;';
        titleDiv.textContent = title;
        titleDiv.title = title;

        card.appendChild(shine);
        card.appendChild(topGlow);
        card.appendChild(thumbEl);
        card.appendChild(overlay);
        card.appendChild(titleDiv);

        card.addEventListener('click', function() {
            if (!link) return;
            if (window.floworkDesktop && window.floworkDesktop.openExternalUrl) {
                window.floworkDesktop.openExternalUrl(link);
            } else {
                window.open(link, '_blank');
            }
        });

        return card;
    }

    function renderLoading(listEl) {
        listEl.innerHTML = '<div style="color:#3a4d6a;width:100%;text-align:center;margin-top:60px;font-family:\'JetBrains Mono\',monospace;"><div style="font-size:28px;margin-bottom:12px;animation:spin 1s linear infinite;display:inline-block;">⏳</div><br><span style="color:#3b82f6;font-size:12px;letter-spacing:2px;font-weight:700;">FETCHING TUTORIALS...</span></div>';
    }

    function renderTutorials(listEl, tutorials) {
        listEl.innerHTML = '';
        if (!tutorials || tutorials.length === 0) {
            listEl.innerHTML = '<div style="color:#f87171;width:100%;text-align:center;margin-top:60px;font-family:\'JetBrains Mono\',monospace;font-size:13px;"><div style="font-size:36px;margin-bottom:10px;">⚠️</div>No tutorials available.</div>';
            return;
        }
        tutorials.forEach(function(t) {
            var card = createFuturisticCard(t.title, t.videoId, t.link, t.thumbnail);
            listEl.appendChild(card);
        });
    }

    async function loadTutorials() {
        var listEl = document.getElementById('tutorial-list');
        if (!listEl) return;

        renderLoading(listEl);

        // Strategy 1: IPC via Electron main process (no CORS)
        try {
            if (window.floworkDesktop && typeof window.floworkDesktop.fetchTutorials === 'function') {
                var result = await window.floworkDesktop.fetchTutorials();
                if (result && result.success && result.tutorials && result.tutorials.length > 0) {
                    renderTutorials(listEl, result.tutorials);
                    if (window.FW_State) window.FW_State.tutorialsLoaded = true;
                    return;
                }
            }
        } catch (e) {
            console.warn('[Tutorial] IPC fetch failed:', e.message);
        }

        // Strategy 2: Direct browser fetch
        try {
            var rssUrl = 'https://www.youtube.com/feeds/videos.xml?playlist_id=' + PLAYLIST_ID;
            var response = await fetch(rssUrl);
            if (response.ok) {
                var text = await response.text();
                var parser = new DOMParser();
                var xml = parser.parseFromString(text, 'text/xml');
                var entries = xml.querySelectorAll('entry');
                if (entries.length > 0) {
                    var tutorials = [];
                    entries.forEach(function(entry) {
                        var titleNode = entry.querySelector('title');
                        var title = titleNode ? titleNode.textContent : 'Unknown';
                        var linkNode = entry.querySelector('link');
                        var link = linkNode ? linkNode.getAttribute('href') : '#';
                        var videoIdNode = entry.querySelector('videoId');
                        var videoId = videoIdNode ? videoIdNode.textContent : '';
                        if (!videoId) {
                            var idNode = entry.querySelector('id');
                            if (idNode) videoId = idNode.textContent.replace('yt:video:', '');
                        }
                        tutorials.push({ title: title, videoId: videoId, link: link, thumbnail: 'https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg' });
                    });
                    renderTutorials(listEl, tutorials);
                    if (window.FW_State) window.FW_State.tutorialsLoaded = true;
                    return;
                }
            }
        } catch(e) {
            console.warn('[Tutorial] Browser fetch failed:', e.message);
        }

        // Strategy 3: Hardcoded fallback (always works)
        console.log('[Tutorial] Using hardcoded fallback');
        renderTutorials(listEl, FALLBACK_TUTORIALS);
        if (window.FW_State) window.FW_State.tutorialsLoaded = true;
    }

    if (!window.FW_UI) window.FW_UI = {};
    window.FW_UI.loadTutorials = loadTutorials;

    // ===== SELF-CONTAINED CLICK HANDLER =====
    // Works with OR without FW_State/FW_UI (gracefully degrades in plain browser)
    var btnTutorial = document.getElementById('btn-tutorial');
    var tutorialView = document.getElementById('tutorial-view');
    var tutorialsLoaded = false;

    if (btnTutorial && tutorialView) {
        btnTutorial.addEventListener('click', function() {
            // Check if FW_UI system is available (Electron environment)
            if (window.FW_State && window.FW_UI && window.FW_UI.updateModeButtons) {
                if (window.FW_State.currentViewMode === 'TUTORIAL') {
                    // Toggle off
                    try { window.floworkDesktop.initFlowork(); } catch(e) {}
                    window.FW_UI.updateModeButtons('FLOWORK');
                } else {
                    // Toggle on — updateModeButtons handles showing the overlay
                    try {
                        window.FW_UI.updateModeButtons('TUTORIAL');
                    } catch(e) {
                        // If updateModeButtons fails (e.g. toggleModal not available), show directly
                        tutorialView.style.display = 'flex';
                    }
                    if (!window.FW_State.tutorialsLoaded && !tutorialsLoaded) {
                        tutorialsLoaded = true;
                        loadTutorials();
                    }
                }
            } else {
                // Plain browser fallback — toggle overlay directly
                if (tutorialView.style.display === 'flex') {
                    tutorialView.style.display = 'none';
                } else {
                    tutorialView.style.display = 'flex';
                    if (!tutorialsLoaded) {
                        tutorialsLoaded = true;
                        loadTutorials();
                    }
                }
            }
        });
    }
})();
