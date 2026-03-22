//#######################################################################
// File NAME : internal/runner/executor.go
//#######################################################################
package runner

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall" // Absolute requirement to hide Windows CMD

	"flowork-engine/internal/packer" // Cryptography module
	"flowork-engine/internal/watcher" // Import untuk mendeteksi Global Dev Mode
)

type NodeManager struct {
	BaseDir string
}

func NewNodeManager(baseDir string) *NodeManager {
	return &NodeManager{BaseDir: baseDir}
}

func (nm *NodeManager) ScanNodes() []map[string]interface{} {
	var nodes []map[string]interface{}

	entries, err := ioutil.ReadDir(nm.BaseDir)
	if err != nil {
		return nodes
	}

	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".nflow") {
			nodeFileName := entry.Name()
			nodeID := strings.TrimSuffix(nodeFileName, ".nflow")

			// Baca schema.json LANGSUNG DARI RAM tanpa menyentuh Hardisk sama sekali!
			schemaPath := filepath.Join(nm.BaseDir, nodeFileName)
			schemaBytes, err := packer.ExtractFileInMemory(schemaPath, "schema.json")
			var customParameters []interface{}

			if err != nil {
				log.Printf("  [Schema] ⚠️ schema.json file not found or package corrupted: %s | err: %v\n", nodeFileName, err)
			} else {
				var schemaData map[string]interface{}
				if errJSON := json.Unmarshal(schemaBytes, &schemaData); errJSON != nil {
					log.Printf("  [Schema] ❌ JSON Parsing ERROR in %s: %v\n", nodeFileName, errJSON)
				} else {
					// [PERBAIKAN BUG] Coba ekstrak "parameters", jika gagal/tidak ada, fallback ke "properties"
					if params, ok := schemaData["parameters"].([]interface{}); ok {
						customParameters = params
					} else if props, ok := schemaData["properties"].([]interface{}); ok {
						customParameters = props
					}
				}
			}

			if customParameters == nil {
				customParameters = []interface{}{}
			}

			displayName := strings.Title(strings.ReplaceAll(nodeID, "-", " "))
			nodeName := fmt.Sprintf("engine.secure.%s", nodeID)

			nodes = append(nodes, map[string]interface{}{
				"name":        nodeName,
				"displayName": "📦 " + displayName,
				"description": "Secure Executable Node (.nflow)",
				"category":    "Physical Engine (Encrypted)",
				"color":       "#3572A5",
				"inputs":      []map[string]string{{"id": "in-0", "label": "Data Input", "type": "any"}},
				"outputs":     []map[string]string{{"id": "out-0", "label": "Output Result", "type": "any"}},
				"parameters":  customParameters,
				// [PERBAIKAN] Tambahkan 'properties' sebagai alias agar pembacaan array sinkron 100% dengan sisi Web
				"properties":  customParameters,
			})
			log.Printf("  └─ Found & registered (Secure Node): %s\n", nodeName)
		} else if entry.IsDir() && watcher.IsDevMode && !strings.HasPrefix(entry.Name(), ".") && entry.Name() != "libs" {
			// DEV MODE: Read schema.json directly from raw folder!
			nodeID := entry.Name()
			schemaPath := filepath.Join(nm.BaseDir, nodeID, "schema.json")
			var customParameters []interface{}
			schemaBytes, err := ioutil.ReadFile(schemaPath)

			if err != nil {
				log.Printf("  [Schema] ⚠️ schema.json file not found inside raw package %s\n", nodeID)
			} else {
				var schemaData map[string]interface{}
				if errJSON := json.Unmarshal(schemaBytes, &schemaData); errJSON != nil {
					log.Printf("  [Schema] ❌ JSON Parsing ERROR in %s: %v\n", nodeID, errJSON)
				} else {
					// [PERBAIKAN BUG] Coba ekstrak "parameters", jika gagal/tidak ada, fallback ke "properties"
					if params, ok := schemaData["parameters"].([]interface{}); ok {
						customParameters = params
					} else if props, ok := schemaData["properties"].([]interface{}); ok {
						customParameters = props
					}
				}
			}

			if customParameters == nil {
				customParameters = []interface{}{}
			}

			displayName := strings.Title(strings.ReplaceAll(nodeID, "-", " "))
			nodeName := fmt.Sprintf("engine.secure.%s", nodeID)

			nodes = append(nodes, map[string]interface{}{
				"name":        nodeName,
				"displayName": "🛠️ " + displayName + " (Dev Mode)",
				"description": "Raw Executable Node (Dev Mode)",
				"category":    "Physical Engine (Raw Mode)",
				"color":       "#FF006E", // Color tag distinction for developer
				"inputs":      []map[string]string{{"id": "in-0", "label": "Data Input", "type": "any"}},
				"outputs":     []map[string]string{{"id": "out-0", "label": "Output Result", "type": "any"}},
				"parameters":  customParameters,
				// [PERBAIKAN] Tambahkan 'properties' pada mode DEV
				"properties":  customParameters,
			})
			log.Printf("  └─ Found & registered (Dev Node): %s\n", nodeName)
		}
	}
	return nodes
}

func ensurePortableRuntime(baseDir string, lang string) (string, error) {
	// [PERBAIKAN BUG EXE] Menggunakan path executable yang absolut agar kebal
	// dari context shortcut Windows saat aplikasi di-build menjadi .exe
	engineRootDir, _ := filepath.Abs(".")
	if exePath, err := os.Executable(); err == nil {
		// Pastikan kita bukan di folder Temp (saat go run)
		if !strings.Contains(exePath, "go-build") && !strings.Contains(exePath, "Temp") {
			engineRootDir = filepath.Dir(exePath)
		}
	}

	runtimeDir := filepath.Join(engineRootDir, "runtimes", lang)

	var exeName string

	if runtime.GOOS == "windows" {
		if lang == "python" {
			exeName = "python.exe"
		} else if lang == "node" {
			exeName = "node.exe"
		} else if lang == "ruby" {
			exeName = "ruby.exe"
		}
	} else {
		exeName = lang
		if lang == "python" {
			exeName = "python3"
		}
	}

	exePath := filepath.Join(runtimeDir, exeName)
	altExePath := filepath.Join(runtimeDir, "bin", exeName)
	if _, err := os.Stat(altExePath); err == nil {
		exePath = altExePath
	}
	absExePath, err := filepath.Abs(exePath)
	if err == nil {
		exePath = absExePath
	}

	// Verify if the bundled runtime exists on disk
	if _, err := os.Stat(exePath); err != nil {
		return "", fmt.Errorf("bundled runtime for '%s' not found at %s. Please ensure the Flowork OS package is intact", lang, exePath)
	}

	// Grant execute permission for Mac/Linux
	if runtime.GOOS != "windows" {
		os.Chmod(exePath, 0755)
	}

	return exePath, nil
}

func (nm *NodeManager) Execute(nodeType string, inputData interface{}) (interface{}, error) {
	parts := strings.Split(nodeType, ".")
	if len(parts) < 3 || parts[0] != "engine" {
		return nil, fmt.Errorf("invalid node type")
	}

	nodeID := parts[2]
	nflowPath := filepath.Join(nm.BaseDir, nodeID+".nflow")
	rawNodePath := filepath.Join(nm.BaseDir, nodeID)

	// Logic deteksi apakah kita harus mengeksekusi folder mentah (Dev Mode)
	isRawDevNode := false
	if watcher.IsDevMode {
		if info, err := os.Stat(rawNodePath); err == nil && info.IsDir() {
			isRawDevNode = true
		}
	}

	if !isRawDevNode {
		if _, err := os.Stat(nflowPath); os.IsNotExist(err) {
			return nil, fmt.Errorf("secure module (.nflow) not found: %s", nflowPath)
		}
	}

	var secretDir string

	if isRawDevNode {
		log.Printf("[Engine] 🛠️ DEV MODE: Executing raw node folder directly: %s\n", rawNodePath)
		secretDir = rawNodePath
	} else {
		secretDir = packer.GenerateSecretPath()

		// [PERBAIKAN BUG] Dihapus "defer os.RemoveAll" agar output file tidak hilang.
		// Source code sudah diamankan melalui JIT Scrambling. Cleanup akan ditangani oleh sistem saat Engine ditutup.
		if err := packer.DecryptAndUnpack(nflowPath, secretDir); err != nil {
			return nil, fmt.Errorf("decryption failed, package corrupted: %v", err)
		}
	}

	// Dynamic Multi-Language Detection
	scriptPath := ""
	lang := ""
	files, _ := ioutil.ReadDir(secretDir)
	for _, f := range files {
		if strings.HasSuffix(f.Name(), ".py") {
			scriptPath = f.Name()
			lang = "python"
			break
		} else if strings.HasSuffix(f.Name(), ".js") {
			scriptPath = f.Name()
			lang = "node"
			break
		} else if strings.HasSuffix(f.Name(), ".rb") {
			scriptPath = f.Name()
			lang = "ruby"
			break
		}
	}

	if scriptPath == "" || lang == "" {
		return nil, fmt.Errorf("no valid script (.py, .js, .rb) found inside the package")
	}

	// Invoke Bundled Portable Runtime
	runnerCmd, err := ensurePortableRuntime(nm.BaseDir, lang)
	if err != nil {
		log.Printf("[Engine] ⚠️ Local runtime '%s' missing: %v. Attempting system fallback...\n", lang, err)
		runnerCmd = lang // Fallback to system env
		if lang == "python" && runtime.GOOS != "windows" {
			runnerCmd = "python3"
		}
	}

	absSecretDir, _ := filepath.Abs(secretDir)
	absLibsPath := filepath.Join(absSecretDir, "libs")

	// Install libraries to secretDir based on language
	if lang == "python" {
		reqPath := filepath.Join(secretDir, "requirements.txt")
		if _, err := os.Stat(reqPath); err == nil {
			log.Printf("[Engine] 📦 Installing temporary Python libraries for node %s...\n", nodeID)
			installCmd := exec.Command(runnerCmd, "-m", "pip", "install", "-r", "requirements.txt", "-t", "libs")
			installCmd.Dir = absSecretDir

			// Hide black popup when installing Node Flow dependencies
			if runtime.GOOS == "windows" {
				installCmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
			}

			// Menangkap output error untuk log GUI dan melakukan retry instalasi cerdas
			installOut, errInstall := installCmd.CombinedOutput()
			if errInstall != nil {
				log.Printf("[Engine] ❌ PIP INSTALL ERROR: %v | %s\n", errInstall, string(installOut))
				log.Printf("[Engine] ⚠️ Portable Python gagal menginstal modul. Melakukan retrying instalasi dengan System Python...\n")

				// Mengembalikan ke System Python, dan ULANGI perintah pip install!
				runnerCmd = "python"
				if runtime.GOOS != "windows" {
					runnerCmd = "python3"
				}

				retryInstallCmd := exec.Command(runnerCmd, "-m", "pip", "install", "-r", "requirements.txt", "-t", "libs")
				retryInstallCmd.Dir = absSecretDir
				if runtime.GOOS == "windows" {
					retryInstallCmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
				}

				retryOut, errRetry := retryInstallCmd.CombinedOutput()
				if errRetry != nil {
					log.Printf("[Engine] ❌ SYSTEM PIP ALSO FAILED: %v | %s\n", errRetry, string(retryOut))
				} else {
					log.Printf("[Engine] ✅ Instalasi dengan System Python berhasil.\n")
				}
			}
		}
	} else if lang == "node" {
		pkgPath := filepath.Join(secretDir, "package.json")
		if _, err := os.Stat(pkgPath); err == nil {
			log.Printf("[Engine] 📦 Installing temporary Node.js modules for node %s...\n", nodeID)
			installCmd := exec.Command("npm", "install")
			installCmd.Dir = absSecretDir

			// Hide black popup when installing Node Flow dependencies
			if runtime.GOOS == "windows" {
				installCmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
			}
			installCmd.Run()
		}
	}

	log.Printf("[Engine] ⚙️ Executing secret file [%s]: %s\n", lang, scriptPath)

	cmd := exec.Command(runnerCmd, scriptPath)
	cmd.Dir = absSecretDir

	// Absolute rule: Hide black CMD window during node flow execution
	if runtime.GOOS == "windows" {
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	}

	env := os.Environ()
	customPythonPath := fmt.Sprintf("%s%c%s", absSecretDir, os.PathListSeparator, absLibsPath)

	// [PERBAIKAN BUG FFMPEG] Resolve absolut engine path untuk mendeteksi FFMPEG pada versi EXE
	// Trik ini mengabaikan Current Directory (CWD) Windows yang sering ngawur pada .exe
	engineRootDir, _ := filepath.Abs(".")
	if exePath, err := os.Executable(); err == nil {
		if !strings.Contains(exePath, "go-build") && !strings.Contains(exePath, "Temp") {
			engineRootDir = filepath.Dir(exePath)
		}
	}

	ffmpegRootPath := filepath.Join(engineRootDir, "runtimes", "ffmpeg")
	ffmpegBinPath := filepath.Join(engineRootDir, "runtimes", "ffmpeg", "bin")

	// [KODE BARU] Deteksi fisik kehadiran FFMPEG agar log GUI memberikan informasi yang presisi jika file lupa di-copy
	ffmpegExe := "ffmpeg"
	if runtime.GOOS == "windows" {
		ffmpegExe = "ffmpeg.exe"
	}
	if _, err := os.Stat(filepath.Join(ffmpegBinPath, ffmpegExe)); os.IsNotExist(err) {
		log.Printf("[Engine] ⚠️ Peringatan: FFMPEG Portable tidak ditemukan secara fisik di: %s. Operasi media (Audio/Video) pasti gagal!\n", ffmpegBinPath)
	}

	hasPythonPath := false
	hasIOEncoding := false
	pathIndex := -1 // Indeks untuk environment PATH

	for i, e := range env {
		if strings.HasPrefix(e, "PYTHONPATH=") {
			env[i] = e + string(os.PathListSeparator) + customPythonPath
			hasPythonPath = true
		} else if strings.HasPrefix(e, "PYTHONIOENCODING=") {
			env[i] = "PYTHONIOENCODING=utf-8"
			hasIOEncoding = true
		} else if strings.HasPrefix(strings.ToUpper(e), "PATH=") {
			pathIndex = i
		}
	}

	if lang == "python" && !hasPythonPath {
		env = append(env, "PYTHONPATH="+customPythonPath)
	}
	if !hasIOEncoding {
		env = append(env, "PYTHONIOENCODING=utf-8")
	}

	// [PERBAIKAN BUG FFMPEG] Inject ROOT & BIN FFMPEG secara dinamis ke URUTAN TERDEPAN (Prepend)
	// Agar yt-dlp 100% memprioritaskan FFMPEG bawaan kita dibanding milik system (jika ada konflik).
	ffmpegInjectPaths := ffmpegBinPath + string(os.PathListSeparator) + ffmpegRootPath

	if pathIndex != -1 {
		pathSplit := strings.SplitN(env[pathIndex], "=", 2)
		if len(pathSplit) == 2 {
			env[pathIndex] = pathSplit[0] + "=" + ffmpegInjectPaths + string(os.PathListSeparator) + pathSplit[1]
		}
	} else {
		env = append(env, "PATH=" + ffmpegInjectPaths)
	}

	cmd.Env = env

	inputBytes, _ := json.Marshal(inputData)
	cmd.Stdin = bytes.NewReader(inputBytes)

	var outBuffer, errBuffer bytes.Buffer
	cmd.Stdout = &outBuffer
	cmd.Stderr = &errBuffer

	errExec := cmd.Run()

	if errBuffer.Len() > 0 {
		log.Printf("[Node Warning] %s\n", errBuffer.String())
	}

	if errExec != nil {
		return nil, fmt.Errorf("execution failed: %v | log: %s", errExec, errBuffer.String())
	}

	rawOutput := strings.TrimSpace(outBuffer.String())
	var resultData interface{}

	if rawOutput != "" {
		if errJSON := json.Unmarshal([]byte(rawOutput), &resultData); errJSON != nil {
			resultData = map[string]string{"output_text": rawOutput}
		}
	} else {
		resultData = map[string]string{"status": "empty", "output": "No response from node."}
	}

	return resultData, nil
}