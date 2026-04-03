//#######################################################################
// WEBSITE https://flowork.cloud
// File NAME : C:\Users\User\OneDrive\Documents\1.FASE-CODING\FLOWORK_ENGINE_WEB_VIEW\stealth-preload.js total lines 492 
//#1. Dynamic Component Discovery (DCD): Hub wajib melakukan scanning file secara otomatis.
//#2. Lazy Loading: Modul hanya di-import ke RAM saat dipanggil (On-Demand).
//#3. Atomic Isolation: 1 File = 1 Fungsi dengan nama file yang identik dengan nama fungsi aslinya.
//#4. Zero Logic Mutation: Dilarang merubah alur logika, nama variabel, atau struktur if/try/loop.
//#######################################################################

const { ipcRenderer } = require('electron');

const fpConfig = ipcRenderer.sendSync('app:get-fp-config') || { cpu: 8, ram: 8, vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel)', noiseR: 1, noiseG: 1, noiseB: 1, ghostCursor: false, bandwidthSaver: false };

let dynamicFpConfig = Object.assign({}, fpConfig);

ipcRenderer.on('app:update-dynamic-config', (e, newConfig) => {
    dynamicFpConfig = newConfig;
});

const stealthCode = `
    (function() {
        const fns = new Map();
        const origToString = Function.prototype.toString;
        Function.prototype.toString = new Proxy(origToString, {
            apply: function(target, thisArg, args) {
                if (fns.has(thisArg)) return fns.get(thisArg);
                return target.apply(thisArg, args);
            }
        });

        function disguiseProxy(fakeProxy, origFn, name) {
            try {
                Object.defineProperty(fakeProxy, 'name', { value: name, configurable: true });
                Object.defineProperty(fakeProxy, 'length', { value: origFn.length, configurable: true });
            } catch(e) {}
            fns.set(fakeProxy, 'function ' + name + '() { [native code] }');
            return fakeProxy;
        }

        function applySafeSpoof(obj, prop, value) {
            try {
                const fakeGetter = new Proxy(function(){}, { apply: () => value });
                disguiseProxy(fakeGetter, function(){}, 'get ' + prop);
                Object.defineProperty(obj, prop, {
                    get: fakeGetter,
                    enumerable: true,
                    configurable: true
                });
            } catch(e) {}
        }

        function initSpoof(win) {
            if (!win || win.__floworkSpoofed) return;
            win.__floworkSpoofed = true;

            if (win.navigator) {
                applySafeSpoof(win.navigator, 'webdriver', false);
                applySafeSpoof(win.navigator, 'hardwareConcurrency', ${fpConfig.cpu});
                applySafeSpoof(win.navigator, 'deviceMemory', ${fpConfig.ram});
            }

            try {
                const overrideWebGL = (context) => {
                    if (!context || !context.prototype || !context.prototype.getParameter) return;
                    const origGetParam = context.prototype.getParameter;

                    const fakeGetParam = new Proxy(origGetParam, {
                        apply: function(target, ctx, args) {
                            if (args[0] === 37445) return "${fpConfig.vendor}";
                            if (args[0] === 37446) return "${fpConfig.renderer}";
                            return target.apply(ctx, args);
                        }
                    });
                    disguiseProxy(fakeGetParam, origGetParam, 'getParameter');
                    context.prototype.getParameter = fakeGetParam;
                };
                overrideWebGL(win.WebGLRenderingContext);
                overrideWebGL(win.WebGL2RenderingContext);
            } catch(e) {}

            try {
                const noiseR = Math.abs(${fpConfig.noiseR}) || 1;
                const noiseG = Math.abs(${fpConfig.noiseG}) || 2;
                const noiseB = Math.abs(${fpConfig.noiseB}) || 3;

                const origGetImageData = win.CanvasRenderingContext2D.prototype.getImageData;
                const fakeGetImageData = new Proxy(origGetImageData, {
                    apply: function(target, ctx, args) {
                        const imgData = target.apply(ctx, args);
                        if (imgData && imgData.data && imgData.data.length >= 4) {
                            for (let i = 0; i < Math.min(imgData.data.length, 400); i += 4) {
                                imgData.data[i] = (imgData.data[i] + noiseR) % 256;
                                imgData.data[i+1] = (imgData.data[i+1] + noiseG) % 256;
                                imgData.data[i+2] = (imgData.data[i+2] + noiseB) % 256;
                            }
                        }
                        return imgData;
                    }
                });
                disguiseProxy(fakeGetImageData, origGetImageData, 'getImageData');
                win.CanvasRenderingContext2D.prototype.getImageData = fakeGetImageData;

                function injectCanvasNoise(canvas) {
                    try {
                        const ctx = canvas.getContext('2d');
                        if (ctx && canvas.width > 0 && canvas.height > 0) {
                            const w = Math.min(canvas.width, 10);
                            const h = Math.min(canvas.height, 10);
                            const imgData = origGetImageData.call(ctx, 0, 0, w, h);
                            let injected = false;
                            for (let i = 0; i < Math.min(imgData.data.length, 400); i += 4) {
                                imgData.data[i] = (imgData.data[i] + noiseR) % 256;
                                imgData.data[i+1] = (imgData.data[i+1] + noiseG) % 256;
                                imgData.data[i+2] = (imgData.data[i+2] + noiseB) % 256;
                                imgData.data[i+3] = 255;
                                injected = true;
                            }
                            if (injected) win.CanvasRenderingContext2D.prototype.putImageData.call(ctx, imgData, 0, 0);
                        }
                    } catch(err) {}
                }

                const origToDataURL = win.HTMLCanvasElement.prototype.toDataURL;
                const fakeToDataURL = new Proxy(origToDataURL, {
                    apply: function(target, ctx, args) {
                        injectCanvasNoise(ctx);
                        return target.apply(ctx, args);
                    }
                });
                disguiseProxy(fakeToDataURL, origToDataURL, 'toDataURL');
                win.HTMLCanvasElement.prototype.toDataURL = fakeToDataURL;

                const origToBlob = win.HTMLCanvasElement.prototype.toBlob;
                const fakeToBlob = new Proxy(origToBlob, {
                    apply: function(target, ctx, args) {
                        injectCanvasNoise(ctx);
                        return target.apply(ctx, args);
                    }
                });
                disguiseProxy(fakeToBlob, origToBlob, 'toBlob');
                win.HTMLCanvasElement.prototype.toBlob = fakeToBlob;

            } catch(e) {}

            try {
                const audioNoise = (Math.abs(${fpConfig.noiseR}) || 1) * 0.0001;

                if (win.AudioBuffer && win.AudioBuffer.prototype.getChannelData) {
                    const origGetChannelData = win.AudioBuffer.prototype.getChannelData;
                    const fakeGetChannelData = new Proxy(origGetChannelData, {
                        apply: function(target, ctx, args) {
                            const data = target.apply(ctx, args);
                            if (data && data.length) {
                                for (let i = 0; i < data.length; i += 100) {
                                    data[i] += audioNoise;
                                }
                            }
                            return data;
                        }
                    });
                    disguiseProxy(fakeGetChannelData, origGetChannelData, 'getChannelData');
                    win.AudioBuffer.prototype.getChannelData = fakeGetChannelData;
                }

                if (win.AnalyserNode && win.AnalyserNode.prototype.getFloatFrequencyData) {
                    const origGetFloatFreq = win.AnalyserNode.prototype.getFloatFrequencyData;
                    const fakeGetFloatFreq = new Proxy(origGetFloatFreq, {
                        apply: function(target, ctx, args) {
                            target.apply(ctx, args);
                            const array = args[0];
                            if (array && array.length) {
                                for (let i = 0; i < array.length; i += 10) {
                                    array[i] += audioNoise;
                                }
                            }
                        }
                    });
                    disguiseProxy(fakeGetFloatFreq, origGetFloatFreq, 'getFloatFrequencyData');
                    win.AnalyserNode.prototype.getFloatFrequencyData = fakeGetFloatFreq;
                }
            } catch(e) {}

            try {
                const iframeCW = Object.getOwnPropertyDescriptor(win.HTMLIFrameElement.prototype, 'contentWindow');
                if (iframeCW) {
                    const fakeIframeGetter = new Proxy(iframeCW.get, {
                        apply: function(target, ctx, args) {
                            const cw = target.apply(ctx, args);
                            if (cw) initSpoof(cw);
                            return cw;
                        }
                    });
                    disguiseProxy(fakeIframeGetter, iframeCW.get, 'get contentWindow');
                    Object.defineProperty(win.HTMLIFrameElement.prototype, 'contentWindow', {
                        get: fakeIframeGetter,
                        enumerable: iframeCW.enumerable,
                        configurable: iframeCW.configurable
                    });
                }

                const origCreateElement = win.document.createElement;
                const fakeCreateElement = new Proxy(origCreateElement, {
                    apply: function(target, ctx, args) {
                        const el = target.apply(ctx, args);
                        if (args[0] && String(args[0]).toLowerCase() === 'iframe') {
                            el.addEventListener('load', function() {
                                try { if (this.contentWindow) initSpoof(this.contentWindow); } catch(err){}
                            });
                        }
                        return el;
                    }
                });
                disguiseProxy(fakeCreateElement, origCreateElement, 'createElement');
                win.document.createElement = fakeCreateElement;

                const innerHTMLDesc = Object.getOwnPropertyDescriptor(win.Element.prototype, 'innerHTML');
                if (innerHTMLDesc && innerHTMLDesc.set) {
                    const fakeInnerHTMLSet = new Proxy(innerHTMLDesc.set, {
                        apply: function(target, ctx, args) {
                            target.apply(ctx, args);
                            if (args[0] && String(args[0]).toLowerCase().includes('<iframe')) {
                                const iframes = ctx.getElementsByTagName('iframe');
                                for (let i = 0; i < iframes.length; i++) {
                                    try { if (iframes[i].contentWindow) initSpoof(iframes[i].contentWindow); } catch(err){}
                                }
                            }
                        }
                    });
                    disguiseProxy(fakeInnerHTMLSet, innerHTMLDesc.set, 'set innerHTML');
                    Object.defineProperty(win.Element.prototype, 'innerHTML', {
                        set: fakeInnerHTMLSet,
                        enumerable: innerHTMLDesc.enumerable,
                        configurable: innerHTMLDesc.configurable
                    });
                }
            } catch(e) {}
        }

        initSpoof(window);
    })();
`;

function injectScript() {
    const scriptEl = document.createElement('script');
    scriptEl.textContent = stealthCode;
    if (document.documentElement) {
        document.documentElement.appendChild(scriptEl);
        scriptEl.remove();
    } else {
        const observer = new MutationObserver(() => {
            if (document.documentElement) {
                document.documentElement.appendChild(scriptEl);
                scriptEl.remove();
                observer.disconnect();
            }
        });
        observer.observe(document, { childList: true });
    }
}

injectScript();

if (typeof process !== 'undefined' && process.versions) {
    try { delete process.versions.electron; } catch(e) {}
}

window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'FORWARD_TO_MAIN') {
        ipcRenderer.send('sync-storage-to-main', event.data.detail);
    }
});

try {
    localStorage.setItem('yt-player-quality', JSON.stringify({data:"tiny", expiration:Date.now() + 86400000, creation:Date.now()}));
} catch(e) {}

const applyBandwidthSaver = () => {
    if (!dynamicFpConfig.bandwidthSaver) return;

    const ytPlayer = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
    if (ytPlayer) {
        if (typeof ytPlayer.setPlaybackQualityRange === 'function') ytPlayer.setPlaybackQualityRange('tiny', 'tiny');
        if (typeof ytPlayer.setPlaybackQuality === 'function') ytPlayer.setPlaybackQuality('tiny');
    }
};

setInterval(applyBandwidthSaver, 1500);
window.addEventListener('DOMContentLoaded', applyBandwidthSaver);

window.addEventListener('DOMContentLoaded', () => {
    const cursor = document.createElement('div');
    cursor.innerHTML = '🖱️';
    cursor.style.position = 'fixed';
    cursor.style.zIndex = '2147483647';
    cursor.style.pointerEvents = 'none';
    cursor.style.transition = 'all 0.8s ease-in-out';
    cursor.style.fontSize = '24px';
    cursor.style.textShadow = '0 0 5px rgba(0,0,0,0.5)';
    cursor.style.display = dynamicFpConfig.ghostCursor ? 'block' : 'none';
    document.body.appendChild(cursor);

    setInterval(() => {
        if (!dynamicFpConfig.ghostCursor) {
            cursor.style.display = 'none';
            return;
        }
        cursor.style.display = 'block';

        const x = Math.floor(Math.random() * (window.innerWidth - 20));
        const y = Math.floor(Math.random() * (window.innerHeight - 20));

        cursor.style.left = x + 'px';
        cursor.style.top = y + 'px';

        const el = document.elementFromPoint(x, y);
        if (el) {
            el.dispatchEvent(new MouseEvent('mousemove', {
                view: window, bubbles: true, cancelable: true, clientX: x, clientY: y
            }));
            el.dispatchEvent(new MouseEvent('mouseover', {
                view: window, bubbles: true, cancelable: true, clientX: x, clientY: y
            }));
        }
    }, 2500 + Math.random() * 3000);
});

let isRecordingMode = false;
let bypassDatabase = [];

ipcRenderer.on('app:set-record-mode', (e, mode) => {
    isRecordingMode = mode;
});

ipcRenderer.on('app:update-bypass-db', (e, db) => {
    bypassDatabase = db;
});

ipcRenderer.send('app:request-bypass-db');

document.addEventListener('click', (e) => {
    if (!isRecordingMode) return;

    let clickable = e.target.closest('button') || e.target.closest('a') || e.target.closest('[role="button"]') || e.target;

    let tag = clickable.tagName;
    let text = clickable.innerText ? clickable.innerText.trim().substring(0, 30) : '';
    let className = clickable.className;
    if (typeof className !== 'string') className = '';

    let safeClass = className.length < 40 ? className : '';

    let payload = { tag: tag, text: text, className: safeClass };

    ipcRenderer.send('app:save-bypass-click', payload);

    isRecordingMode = false;
}, true);

setInterval(() => {
    if (isRecordingMode) return;
    if (!bypassDatabase || bypassDatabase.length === 0) return;

    bypassDatabase.forEach(rule => {
        try {
            if (!rule.tag) return;
            let elements = document.querySelectorAll(rule.tag);
            elements.forEach(el => {
                let match = false;

                if (rule.text && rule.text !== '') {
                    if (el.innerText && el.innerText.trim().substring(0, 30) === rule.text) match = true;
                } else if (rule.className && rule.className !== '') {
                    if (el.className === rule.className) match = true;
                } else {
                    match = false;
                }

                if (match && !el.dataset.fwBypassed) {
                    el.dataset.fwBypassed = "true";
                    el.click();
                    setTimeout(() => { el.dataset.fwBypassed = ""; }, 4000);
                }
            });
        } catch(err) {}
    });
}, 2000);

let isMasterSync = false;
let isFollowerSync = true;
let scrollSyncTimeout;

ipcRenderer.on('app:set-sync-role', (e, role) => {
    isMasterSync = role.isMaster;
    isFollowerSync = role.isFollower;
});

function getElementFingerprint(el) {
    if (!el) return null;
    let fp = { css: '', href: '', text: '' };
    try {
        let path = [];
        let current = el;
        while (current && current.nodeType === Node.ELEMENT_NODE && current.tagName.toLowerCase() !== 'html') {
            let selector = current.nodeName.toLowerCase();
            if (current.id) {
                selector += '#' + current.id;
                path.unshift(selector);
                break;
            } else {
                let sib = current, nth = 1;
                while (sib = sib.previousElementSibling) {
                    if (sib.nodeName.toLowerCase() == selector) nth++;
                }
                if (nth != 1) selector += ":nth-of-type("+nth+")";
            }
            path.unshift(selector);
            current = current.parentNode;
        }
        fp.css = path.join(" > ");

        let aTag = el.closest('a');
        if (aTag && aTag.href) fp.href = aTag.href;

        if (el.innerText) fp.text = el.innerText.trim().substring(0, 30);
    } catch(e) {}
    return fp;
}

window.addEventListener('scroll', (e) => {
    if (!e.isTrusted) return;
    clearTimeout(scrollSyncTimeout);
    scrollSyncTimeout = setTimeout(() => {
        ipcRenderer.send('app:sync-action', { type: 'scroll', scrollX: window.scrollX, scrollY: window.scrollY });
    }, 30);
}, true);

document.addEventListener('click', (e) => {
    if (e.isTrusted && isMasterSync) {
        const fp = getElementFingerprint(e.target);
        ipcRenderer.send('app:sync-action', { type: 'click', clientX: e.clientX, clientY: e.clientY, fp: fp });
    }
}, true);

document.addEventListener('input', (e) => {
    if (e.isTrusted && isMasterSync && e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
        const fp = getElementFingerprint(e.target);
        const rect = e.target.getBoundingClientRect();
        ipcRenderer.send('app:sync-action', {
            type: 'input', clientX: rect.left + 5, clientY: rect.top + 5, value: e.target.value, fp: fp
        });
    }
}, true);

ipcRenderer.on('app:execute-sync', (e, action) => {
    if (!isFollowerSync || isMasterSync) return;

    if (action.type === 'scroll') {
        window.scrollTo(action.scrollX, action.scrollY);
    } else if (action.type === 'click' || action.type === 'input') {
        let el = null;

        if (action.fp && action.fp.href) {
            try { el = document.querySelector(`a[href="${action.fp.href}"]`); } catch(err){}
        }

        if (!el && action.fp && action.fp.css) {
            try { el = document.querySelector(action.fp.css); } catch(err){}
        }

        if (!el) el = document.elementFromPoint(action.clientX, action.clientY);

        if (el) {
            if (action.type === 'click') {
                if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.focus();
                const rect = el.getBoundingClientRect();
                const safeX = action.clientX || (rect.left + rect.width / 2);
                const safeY = action.clientY || (rect.top + rect.height / 2);
                const eventsToFire = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
                eventsToFire.forEach(evType => {
                    const ev = new MouseEvent(evType, {
                        view: window, bubbles: true, cancelable: true, buttons: 1,
                        clientX: safeX, clientY: safeY
                    });
                    el.dispatchEvent(ev);
                });
            } else if (action.type === 'input') {
                if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                    el.value = action.value;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
        }
    }
});
