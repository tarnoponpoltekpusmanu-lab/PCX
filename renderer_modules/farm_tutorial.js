// C:\Users\User\OneDrive\Documents\1.FASE-CODING\FLOWORK_ENGINE_WEB_VIEW\renderer_modules\farm_tutorial.js
(() => {
    const btnTutorial = document.getElementById('btn-tutorial');
    const tutorialList = document.getElementById('tutorial-list');

    window.FW_UI.loadTutorials = async function() {
        try {
            const playlistId = 'PLATUnnrT5igDXCqjBVvkmE4UKq9XASUtT';
            const rssUrl = `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`;
            const response = await fetch(rssUrl);
            const text = await response.text();
            const parser = new DOMParser();
            const xml = parser.parseFromString(text, 'text/xml');
            const entries = xml.querySelectorAll('entry');

            tutorialList.innerHTML = '';
            if(entries.length === 0) {
                 tutorialList.innerHTML = '<div style="color: #ff4d4d; width: 100%; text-align: center; margin-top: 50px;">Tutorial videos not found in this playlist.</div>';
                 return;
            }

            entries.forEach(entry => {
                const titleNode = entry.querySelector('title');
                const title = titleNode ? titleNode.textContent : 'Unknown Title';
                const linkNode = entry.querySelector('link');
                const link = linkNode ? linkNode.getAttribute('href') : '#';
                const videoIdNode = entry.querySelector('videoId');
                let videoId = '';

                if (videoIdNode) { videoId = videoIdNode.textContent; }
                else {
                    const idNode = entry.querySelector('id');
                    if (idNode) videoId = idNode.textContent.replace('yt:video:', '');
                }

                const card = document.createElement('div');
                card.className = 'tutorial-card';
                card.innerHTML = `<img class="tutorial-thumb" src="https://i.ytimg.com/vi/${videoId}/hqdefault.jpg" alt="Thumbnail"><div class="tutorial-title">${title}</div>`;
                card.onclick = async () => { await window.floworkDesktop.openExternalUrl(link); };
                tutorialList.appendChild(card);
            });
            window.FW_State.tutorialsLoaded = true;
        } catch (err) {
            console.error("Failed to load Tutorial RSS:", err);
            tutorialList.innerHTML = `<div style="color: #ff4d4d; width: 100%; text-align: center; margin-top: 50px;">Failed to fetch data from YouTube.<br>Please check your internet connection.</div>`;
        }
    };

    if (btnTutorial) {
        btnTutorial.addEventListener('click', async () => {
            if (window.FW_UI.updateModeButtons) window.FW_UI.updateModeButtons('TUTORIAL');
            if (!window.FW_State.tutorialsLoaded) {
                window.FW_UI.loadTutorials();
            }
        });
    }
})();