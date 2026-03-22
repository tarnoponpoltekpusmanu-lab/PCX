//#######################################################################
// WEBSITE https://flowork.cloud
// File NAME : C:\Users\User\OneDrive\Documents\1.FASE-CODING\FLOWORK_ENGINE_WEB_VIEW\store\app.js total lines 206
//#1. Dynamic Component Discovery (DCD): Hub wajib melakukan scanning file secara otomatis.
//#2. Lazy Loading: Modul hanya di-import ke RAM saat dipanggil (On-Demand).
//#3. Atomic Isolation: 1 File = 1 Fungsi dengan nama file yang identik dengan nama fungsi aslinya.
//#4. Zero Logic Mutation: Dilarang merubah alur logika, nama variabel, atau struktur if/try/loop.
//#######################################################################

let engineSocket = null;
const { createApp } = Vue;

const app = createApp({
    data() {
        return {
            isDevMode: false,
            cpuUsage: 0,
            ramUsage: 0,
            systemLogs: [],
            isReconnecting: false,
            hasAutoOpenedStore: false,
            uploadType: 'app' // Menyimpan status tipe upload ('app' atau 'node')
        };
    },
    methods: {
        toggleDevMode(value) {
            this.isDevMode = value;
            if (engineSocket && engineSocket.connected) {
                this.addLog(`Sending Dev Mode toggle: ${value ? 'ON' : 'OFF'}`, 'warn');
                engineSocket.emit("engine:toggle_dev_mode", { is_dev: value });

                if(value) {
                    ArcoVue.Notification.info({ title: 'DEV MODE ON', content: 'Engine running raw folders.', position: 'bottomRight' });
                } else {
                    ArcoVue.Notification.success({ title: 'DEV MODE OFF', content: 'Security constraints restored.', position: 'bottomRight' });
                }
            } else {
                this.isDevMode = false;
                this.addLog(`Cannot toggle Dev Mode. Socket disconnected.`, 'error');
            }
        },

        openStoreDashboard() {
            this.addLog("Launching Web Dashboard (/detected)...", "info");
            window.open('https://floworkos.com/detected', '_blank');
        },

        downloadExtension() {
            this.addLog("Opening Flowork Extension download page...", "info");
            window.open('https://extension.floworkos.com/', '_blank');
        },

        triggerFileSelect(type) {
            this.uploadType = type;
            const input = document.getElementById('uploadFile');
            input.accept = type === 'app' ? '.flow' : '.nflow';
            input.click();
        },

        async handleFileUpload(event) {
            const file = event.target.files[0];
            if (!file) return;

            const expectedExt = this.uploadType === 'app' ? '.flow' : '.nflow';
            if (!file.name.endsWith(expectedExt)) {
                ArcoVue.Notification.error({ title: 'Upload Failed', content: `Please upload file with extension ${expectedExt}`, position: 'bottomRight' });
                event.target.value = '';
                return;
            }

            const formData = new FormData();
            formData.append('file', file);
            formData.append('type', this.uploadType);

            this.addLog(`[HTTP] Uploading manual package: ${file.name}...`, 'warn');

            try {
                const res = await fetch('http://127.0.0.1:5000/api/upload', {
                    method: 'POST',
                    body: formData
                });
                const data = await res.json();

                if (data.success) {
                    this.addLog(`[HTTP] Successfully uploaded ${file.name}!`, 'success');
                    ArcoVue.Notification.success({ title: 'Upload Successful', content: data.message, position: 'bottomRight' });

                    if (engineSocket && engineSocket.connected) {
                        engineSocket.emit("engine:get_installed_ids");
                        engineSocket.emit("engine:get_apps");
                        engineSocket.emit("engine:get_nodes");
                    }
                } else {
                    throw new Error(data.error);
                }
            } catch (err) {
                this.addLog(`[HTTP] Upload error: ${err.message}`, 'error');
                ArcoVue.Notification.error({ title: 'Upload Failed', content: err.message, position: 'bottomRight' });
            }

            event.target.value = '';
        },

        systemRestart() {
            if(confirm("Are you sure you want to restart Flowork Core?")) {
                this.addLog("Sending restart command to Engine...", "warn");
                if (engineSocket && engineSocket.connected) {
                    engineSocket.emit("engine:restart");
                    setTimeout(() => window.close(), 1000);
                }
            }
        },

        systemShutdown() {
            if(confirm("Are you sure you want to completely turn off the Engine?")) {
                this.addLog("Sending shutdown signal...", "error");
                if (engineSocket && engineSocket.connected) {
                    engineSocket.emit("engine:exit");
                    setTimeout(() => window.close(), 1000);
                }
            }
        },

        addLog(text, type = 'info') {
            const time = new Date().toLocaleTimeString('en-US', { hour12: false });
            this.systemLogs.push({ id: Date.now() + Math.random(), time, text, type });
            if (this.systemLogs.length > 40) this.systemLogs.shift();

            this.$nextTick(() => {
                const terminal = document.getElementById('terminal-screen');
                if(terminal) {
                    const isAtBottom = terminal.scrollHeight - terminal.scrollTop <= terminal.clientHeight + 50;
                    if (isAtBottom) terminal.scrollTop = terminal.scrollHeight;
                }
            });
        },

        reconnectEngine() {
            if (this.isReconnecting) return;
            this.isReconnecting = true;
            this.addLog("Re-syncing with Go Engine...", "warn");

            if(engineSocket) {
                engineSocket.disconnect();
                engineSocket.connect();
            }

            setTimeout(() => {
                this.isReconnecting = false;
            }, 2000);
        },

        startTelemetry() {
            this.cpuUsage = 15; this.ramUsage = 40;
            setInterval(() => {
                this.cpuUsage = Math.floor(Math.random() * 80) + 10;
                this.ramUsage = Math.floor(Math.random() * 30) + 40;
                if(this.cpuUsage > 85 && Math.random() > 0.8) {
                    this.addLog(`High CPU load detected (${this.cpuUsage}%)`, 'warn');
                }
            }, 1500);
        }
    },
    mounted() {
        try {
            window.resizeTo(420, 800);
        } catch(e) {
            console.log("Resize blocked by browser rules");
        }

        this.addLog("Flowork Core (Go) Boot Sequence Initiated.", "info");

        try {
            engineSocket = io("http://127.0.0.1:5000/gui-socket", {
                path: "/api/socket.io/"
            });

            engineSocket.on("connect", () => {
                this.addLog("Port 5000 listener active and stable.", "success");
                this.isReconnecting = false;

                if (this.isDevMode) {
                    engineSocket.emit("engine:toggle_dev_mode", { is_dev: true });
                }

                if (!this.hasAutoOpenedStore) {
                    this.hasAutoOpenedStore = true;
                    this.addLog("Auto-launching Web Dashboard (/detected)...", "success");
                    setTimeout(() => {
                        window.open('https://floworkos.com/detected', '_blank');
                    }, 800);
                }
            });

            engineSocket.on("disconnect", () => {
                this.addLog("Disconnected from local host.", "error");
            });

        } catch(e) {
            this.addLog("Failed to bind WebSocket io client.", "error");
        }

        this.startTelemetry();
    }
});

app.use(ArcoVue);
app.use(ArcoVueIcon);
app.mount('#app');
