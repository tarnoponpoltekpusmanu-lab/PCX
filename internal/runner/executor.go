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
	"regexp"
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
	seenNodes := make(map[string]bool)

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
			var schemaData map[string]interface{}

			if err != nil {
				log.Printf("  [Schema] ⚠️ schema.json file not found or package corrupted: %s | err: %v\n", nodeFileName, err)
			} else {
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

			if seenNodes[nodeName] {
				continue
			}
			seenNodes[nodeName] = true

			color := "#3572A5"
			category := "Physical Engine (Encrypted)"
			description := "Secure Executable Node (.nflow)"
			var icon interface{}
			var inputs interface{} = []map[string]string{{"id": "in-0", "label": "Data Input", "type": "any"}}
			var outputs interface{} = []map[string]string{{"id": "out-0", "label": "Output Result", "type": "any"}}

			if schemaData != nil {
				if c, ok := schemaData["color"].(string); ok && c != "" {
					color = c
				}
				if c, ok := schemaData["category"].(string); ok && c != "" {
					category = c
				}
				if d, ok := schemaData["description"].(string); ok && d != "" {
					description = d
				}
				if dn, ok := schemaData["displayName"].(string); ok && dn != "" {
					displayName = dn
				}
				if schemaData["icon"] != nil {
					icon = schemaData["icon"]
				}
				if inArr, ok := schemaData["inputs"].([]interface{}); ok {
					var newInputs []map[string]string
					for i := range inArr {
						newInputs = append(newInputs, map[string]string{
							"id":    fmt.Sprintf("in-%d", i),
							"label": "Input",
							"type":  "any",
						})
					}
					if len(newInputs) > 0 {
						inputs = newInputs
					}
				}
				if outArr, ok := schemaData["outputs"].([]interface{}); ok {
					var newOutputs []map[string]string
					for i := range outArr {
						newOutputs = append(newOutputs, map[string]string{
							"id":    fmt.Sprintf("out-%d", i),
							"label": "Output",
							"type":  "any",
						})
					}
					if len(newOutputs) > 0 {
						outputs = newOutputs
					}
				} else if outStr, ok := schemaData["outputs"].(string); ok && strings.HasPrefix(outStr, "=") {
					outputs = []map[string]string{
						{"id": "out-0", "label": "Route 0", "type": "any"},
						{"id": "out-1", "label": "Route 1", "type": "any"},
						{"id": "out-2", "label": "Route 2", "type": "any"},
						{"id": "out-3", "label": "Route 3", "type": "any"},
					}
				}
			}

			nodes = append(nodes, map[string]interface{}{
				"name":        nodeName,
				"displayName": "📦 " + displayName,
				"description": description,
				"category":    category,
				"color":       color,
				"icon":        icon,
				"inputs":      inputs,
				"outputs":     outputs,
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
			var schemaData map[string]interface{}
			schemaBytes, err := ioutil.ReadFile(schemaPath)

			if err != nil {
				log.Printf("  [Schema] ⚠️ schema.json file not found inside raw package %s\n", nodeID)
			} else {
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

			if seenNodes[nodeName] {
				continue
			}
			seenNodes[nodeName] = true

			color := "#FF006E"
			category := "Physical Engine (Raw Mode)"
			description := "Raw Executable Node (Dev Mode)"
			var icon interface{}
			var inputs interface{} = []map[string]string{{"id": "in-0", "label": "Data Input", "type": "any"}}
			var outputs interface{} = []map[string]string{{"id": "out-0", "label": "Output Result", "type": "any"}}

			if schemaData != nil {
				if c, ok := schemaData["color"].(string); ok && c != "" {
					color = c
				}
				if c, ok := schemaData["category"].(string); ok && c != "" {
					category = c
				}
				if d, ok := schemaData["description"].(string); ok && d != "" {
					description = d
				}
				if dn, ok := schemaData["displayName"].(string); ok && dn != "" {
					displayName = dn
				}
				if schemaData["icon"] != nil {
					icon = schemaData["icon"]
				}
				if inArr, ok := schemaData["inputs"].([]interface{}); ok {
					var newInputs []map[string]string
					for i := range inArr {
						newInputs = append(newInputs, map[string]string{
							"id":    fmt.Sprintf("in-%d", i),
							"label": "Input",
							"type":  "any",
						})
					}
					if len(newInputs) > 0 {
						inputs = newInputs
					}
				}
				if outArr, ok := schemaData["outputs"].([]interface{}); ok {
					var newOutputs []map[string]string
					for i := range outArr {
						newOutputs = append(newOutputs, map[string]string{
							"id":    fmt.Sprintf("out-%d", i),
							"label": "Output",
							"type":  "any",
						})
					}
					if len(newOutputs) > 0 {
						outputs = newOutputs
					}
				} else if outStr, ok := schemaData["outputs"].(string); ok && strings.HasPrefix(outStr, "=") {
					outputs = []map[string]string{
						{"id": "out-0", "label": "Route 0", "type": "any"},
						{"id": "out-1", "label": "Route 1", "type": "any"},
						{"id": "out-2", "label": "Route 2", "type": "any"},
						{"id": "out-3", "label": "Route 3", "type": "any"},
					}
				}
			}

			nodes = append(nodes, map[string]interface{}{
				"name":        nodeName,
				"displayName": "🛠️ " + displayName + " (Dev Mode)",
				"description": description,
				"category":    category,
				"color":       color,
				"icon":        icon,
				"inputs":      inputs,
				"outputs":     outputs,
				"parameters":  customParameters,
				// [PERBAIKAN] Tambahkan 'properties' pada mode DEV
				"properties":  customParameters,
			})
			log.Printf("  └─ Found & registered (Dev Node): %s\n", nodeName)
		}
	}
	return nodes
}

func ensurePortableRuntime(lang string) (string, error) {
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
		switch lang {
		case "python":
			exeName = "python.exe"
		case "node":
			exeName = "node.exe"
		case "ruby":
			exeName = "ruby.exe"
		default:
			exeName = lang + ".exe"
		}
	} else {
		switch lang {
		case "python":
			exeName = "python3"
		default:
			exeName = lang
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

// ─── Expression Parser — resolves ={{$json.field}} expressions in parameter values ───
// This is n8n-compatible expression interpolation. Before data is sent to stdin,
// all string values containing ={{...}} are inspected and the referenced field
// is resolved from the input data context.
func ResolveExpressions(params interface{}, context map[string]interface{}) interface{} {
	switch v := params.(type) {
	case string:
		if !strings.Contains(v, "={{") {
			return v
		}
		// Replace all ={{ $json.XXX }} or ={{ $json["XXX"] }} patterns
		result := v
		// Pattern: ={{ $json.fieldName }}
		re := regexp.MustCompile(`=\{\{\s*\$json\.(\w+)\s*\}\}`)
		result = re.ReplaceAllStringFunc(result, func(match string) string {
			submatch := re.FindStringSubmatch(match)
			if len(submatch) > 1 {
				fieldName := submatch[1]
				if val, ok := context[fieldName]; ok {
					return fmt.Sprintf("%v", val)
				}
			}
			return match // Keep original if not found
		})
		// Pattern: ={{ $json["fieldName"] }}
		reBracket := regexp.MustCompile(`=\{\{\s*\$json\["([^"]+)"\]\s*\}\}`)
		result = reBracket.ReplaceAllStringFunc(result, func(match string) string {
			submatch := reBracket.FindStringSubmatch(match)
			if len(submatch) > 1 {
				fieldName := submatch[1]
				if val, ok := context[fieldName]; ok {
					return fmt.Sprintf("%v", val)
				}
			}
			return match
		})
		return result
	case map[string]interface{}:
		resolved := make(map[string]interface{})
		for k, val := range v {
			resolved[k] = ResolveExpressions(val, context)
		}
		return resolved
	case []interface{}:
		resolved := make([]interface{}, len(v))
		for i, val := range v {
			resolved[i] = ResolveExpressions(val, context)
		}
		return resolved
	default:
		return params
	}
}

func (nm *NodeManager) Execute(nodeType string, inputData interface{}, binaryTempDir ...string) (interface{}, error) {
	var tempDir string
	if len(binaryTempDir) > 0 {
		tempDir = binaryTempDir[0]
	}

	// [FAKE8 BRIDGE] Intercept N8N native nodes before any cryptographic checks
	if payloadMap, ok := inputData.(map[string]interface{}); ok {
		var n8nType string

		// Case 1: Triggered via GUI WebSocket (Flattened config properties)
		if val, ok := payloadMap["_n8nType"].(string); ok && val != "" {
			n8nType = val
		}

		// Case 2: Triggered via Go WorkflowRunner (Nested inside "config")
		if n8nType == "" {
			if configMap, ok := payloadMap["config"].(map[string]interface{}); ok {
				if val, ok := configMap["_n8nType"].(string); ok && val != "" {
					n8nType = val
				}
			}
		}

		// Case 3 (GUI Runner sends it in root metadata)
		if n8nType == "" && payloadMap["node_config"] != nil {
			if nodeConfig, ok := payloadMap["node_config"].(map[string]interface{}); ok {
				if val, ok := nodeConfig["_n8nType"].(string); ok && val != "" {
					n8nType = val
				}
			}
		}

		if n8nType == "" {
			// Fallback: If not found, guess from nodeType (GUI usually sends engine.module)
			parts := strings.Split(nodeType, ".")
			if len(parts) >= 2 {
				n8nType = parts[len(parts)-1]
			}
		}

		if n8nType != "" {
			// [SAFETY CHECK] Force N8N formatting to let Fake8 attempt loading
			if !strings.HasPrefix(n8nType, "n8n-nodes-") && !strings.HasPrefix(n8nType, "@n8n/") {
				n8nType = "n8n-nodes-base." + n8nType
			}

			log.Printf("[Fake8 Bridge] 🚀 Intercepting Node: %s", n8nType)
				
			engineRoot := filepath.Dir(nm.BaseDir)
			scriptPath := filepath.Join(engineRoot, "fake8-bridge-executor.js")
			
			cmd := exec.Command("node", scriptPath)
			cmd.Dir = engineRoot
			
			cmd.Env = os.Environ()
			cmd.Env = append(cmd.Env, "FLOWORK_N8N_TYPE="+n8nType)
			if tempDir != "" {
				cmd.Env = append(cmd.Env, "FLOWORK_BINARY_DIR="+tempDir)
			}

			jsonData, _ := json.Marshal(inputData)
			cmd.Stdin = strings.NewReader(string(jsonData))
			cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}

			var out bytes.Buffer
			var stderr bytes.Buffer
			cmd.Stdout = &out
			cmd.Stderr = &stderr
			err := cmd.Run()
			
			if err != nil {
				if exitError, ok := err.(*exec.ExitError); ok && exitError.ExitCode() == 22 {
					log.Printf("[Fake8 Bridge] ⚠️ Package '%s' not found in N8N registry. Falling back to Flowork Native...", n8nType)
				} else {
					var errData map[string]interface{}
					if parseErr := json.Unmarshal(stderr.Bytes(), &errData); parseErr == nil {
						if n8nErr, ok := errData["error"].(string); ok {
							return nil, fmt.Errorf("%s", n8nErr)
						}
					}
					return nil, fmt.Errorf("fake8 bridge execution failed: %v | stderr: %s", err, stderr.String())
				}
			} else {
				var resultData interface{}
				if err := json.Unmarshal(out.Bytes(), &resultData); err != nil {
					return out.String(), nil
				}
				return resultData, nil
			}
		}

		// Jika script di-bypass sukses, `return resultData` sudah terjadi.
		// Jika sampai ke sini, Fake8 gagal atau menolak mengeksekusi (Exit Code 22), LANJUT Kriptografi Native.
	}

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
			// [FIX] Universal Node Resolution: Case-blind and Hyphen-agnostic fallback
			found := false
			files, _ := ioutil.ReadDir(nm.BaseDir)
			targetNormalized := strings.ToLower(strings.ReplaceAll(nodeID, "-", ""))
			for _, f := range files {
				if !f.IsDir() && strings.HasSuffix(f.Name(), ".nflow") {
					baseName := strings.TrimSuffix(f.Name(), ".nflow")
					fileNormalized := strings.ToLower(strings.ReplaceAll(baseName, "-", ""))
					if targetNormalized == fileNormalized {
						nflowPath = filepath.Join(nm.BaseDir, f.Name())
						found = true
						break
					}
				}
			}
			if !found {
				return nil, fmt.Errorf("secure module (.nflow) not found: %s", nflowPath)
			}
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
		fileDump := ""
		for _, f := range files {
			fileDump += f.Name() + ", "
		}
		return nil, fmt.Errorf("no valid script (.py, .js, .rb) found inside the package. Contents: [%s]", fileDump)
	}

	// Invoke Bundled Portable Runtime
	runnerCmd, err := ensurePortableRuntime(lang)
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
	switch lang {
	case "python":
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
	case "node":
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

	// [N8N PARITY UPGRADE] Inject Temporary Binary Path
	if tempDir != "" {
		env = append(env, "FLOWORK_BINARY_DIR="+tempDir)
		env = append(env, "N8N_BINARY_DATA_STORAGE_PATH="+tempDir)
	}

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