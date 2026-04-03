// #######################################################################
// File NAME : main.go
// #######################################################################
package main

import (
	"archive/zip"
	"bufio"
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"embed" // Built-in Go module to embed folders into .exe file
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http" // Required for HTTP Client (Update) and FileServer
	"net/url"
	"os"
	"os/exec"
	"os/signal" // Module to capture OS signals (Shutdown/Close)
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"syscall" // syscall module
	"time"

	"flowork-engine/internal/config"
	"flowork-engine/internal/history"
	"flowork-engine/internal/packer"
	"flowork-engine/internal/runner"
	"flowork-engine/internal/socket"
	"flowork-engine/internal/trigger"
	"flowork-engine/internal/vault"
	"flowork-engine/internal/watcher"
	"flowork-engine/internal/workflow"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/filesystem" // Fiber Middleware specifically for embedded files
	"github.com/shirou/gopsutil/v3/process"             // Library to scan and kill old processes
	"github.com/sqweek/dialog"                          // Library to display Native OS Popups
)

var embeddedFiles embed.FS

func base64Encode(data []byte) string {
	return base64.StdEncoding.EncodeToString(data)
}

// Current Engine version constant to match with the server
const CurrentEngineVersion = "1.0.6"

// [KODE BARU] Variabel Global untuk mengunci Path Absolut agar aplikasi 100% portable
var EngineDir string
var IsDevModeGlobal bool

// [SISTEM LISENSI] Variabel State Langganan Engine
var UserTier string = "free"
var LicenseFilePath string

type LicenseData struct {
	Token     string `json:"token"`
	Tier      string `json:"tier"`
	ExpiresAt string `json:"expires_at"`
}

func initLicense() {
	LicenseFilePath = filepath.Join(EngineDir, "FloworkData", "license.json")
	os.MkdirAll(filepath.Join(EngineDir, "FloworkData"), os.ModePerm)

	data, err := os.ReadFile(LicenseFilePath)
	if err != nil {
		log.Println("[Engine] ℹ️ Tidak ada data lisensi (Berjalan di mode FREE).")
		UserTier = "free"
		return
	}

	var lic LicenseData
	if err := json.Unmarshal(data, &lic); err != nil {
		log.Println("[Engine] ⚠️ Struktur file lisensi rusak.")
		UserTier = "free"
		return
	}

	log.Printf("[Engine] 🔄 Verifikasi Token Langganan Cloudflare TLS...")

	apiURL := "https://floworkos.com/api/v1/license"
	client := &http.Client{Timeout: 10 * time.Second}
	req, _ := http.NewRequest("GET", apiURL, nil)
	req.Header.Set("Authorization", "Bearer "+lic.Token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[Engine] ⚠️ Koneksi Cloudflare Terputus (Offline): Percaya Cache Lokal (%s)", lic.Tier)
		UserTier = lic.Tier
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == 200 {
		var result map[string]interface{}
		if err := json.NewDecoder(resp.Body).Decode(&result); err == nil {
			if status, ok := result["status"].(string); ok && status == "success" {
				if licenseData, ok := result["license"].(map[string]interface{}); ok {
					if tier, ok := licenseData["tier"].(string); ok {
						UserTier = tier
						log.Printf("[Engine] ✅ Langganan Aktif Terverifikasi! Level Engine: %s", UserTier)

						lic.Tier = UserTier
						updatedBytes, _ := json.MarshalIndent(lic, "", "  ")
						os.WriteFile(LicenseFilePath, updatedBytes, 0644)
						return
					}
				}
			}
		}
	}

	log.Println("[Engine] ❌ Langganan Expired/Token Tidak Valid! Downgrade otomatis ke mode FREE.")
	UserTier = "free"
}

// [KODE BARU] Fungsi untuk menginisialisasi Path Absolut saat Engine menyala
func initEngineDir() {
	exePath, err := os.Executable()
	if err != nil {
		EngineDir, _ = os.Getwd()
		IsDevModeGlobal = true
		return
	}
	lowerExePath := strings.ToLower(exePath)
	IsDevModeGlobal = strings.Contains(lowerExePath, "temp") || strings.Contains(lowerExePath, "tmp") || strings.Contains(lowerExePath, "go-build")

	if IsDevModeGlobal {
		EngineDir, _ = os.Getwd()
	} else {
		EngineDir = filepath.Dir(exePath)
	}
	watcher.IsDevMode = IsDevModeGlobal // [KODE BARU] Sinkronisasi agar Http/Rest API ter-cover
	log.Printf("[Engine] 📍 Absolute Engine Directory strictly locked to: %s", EngineDir)
}

// Function to lock the working directory so "apps" and "nodes" folders are not read from System32 when run as .exe
func lockWorkingDirectory() {
	exePath, err := os.Executable()
	if err != nil {
		return
	}
	exeDir := filepath.Dir(exePath)

	// Ignore folder changes if the application is run using "go run" (temp, tmp, or modern go-build)
	lowerExeDir := strings.ToLower(exeDir)
	if strings.Contains(lowerExeDir, "temp") || strings.Contains(lowerExeDir, "tmp") || strings.Contains(lowerExeDir, "go-build") {
		return
	}

	// Lock working directory absolutely to the .exe file location
	if err := os.Chdir(exeDir); err == nil {
		// [DIBERIKAN KOMENTAR] log.Printf("[Engine] 📍 System directory absolutely locked to: %s", exeDir) // Log dipindah ke initEngineDir
	}
}

// Membunuh paksa APAPUN yang memakai Port 5000 (NodeJS, Python, atau Zombie Engine)
func forceKillPort5000() {
	log.Println("[Engine] 🛡️ Memastikan Port 5000 kosong sebelum booting...")
	if runtime.GOOS == "windows" {
		out, _ := exec.Command("cmd", "/c", "netstat -ano | findstr :5000").Output()
		lines := strings.Split(string(out), "\n")
		for _, line := range lines {
			if strings.Contains(line, "LISTENING") {
				fields := strings.Fields(line)
				if len(fields) >= 5 {
					pid := fields[len(fields)-1]
					log.Printf("[Engine] ⚠️ Port 5000 dibajak oleh proses PID %s. BUNUH PAKSA!", pid)
					exec.Command("taskkill", "/F", "/PID", pid).Run()
				}
			}
		}
	} else {
		// Untuk Mac/Linux
		exec.Command("sh", "-c", "kill -9 $(lsof -t -i:5000)").Run()
	}
	time.Sleep(500 * time.Millisecond) // Beri OS waktu sepersekian detik untuk membebaskan port
}

// Function to prevent application stacking (Single Instance based on Name)
func killPreviousInstances() {
	currentPID := int32(os.Getpid())
	exePath, err := os.Executable()
	if err != nil {
		return
	}
	exeName := filepath.Base(exePath)

	procs, err := process.Processes()
	if err != nil {
		return
	}

	for _, p := range procs {
		if p.Pid != currentPID {
			name, err := p.Name()

			// [DIBERIKAN KOMENTAR] Karena kita ingin mendeteksi nama proses secara lebih agresif
			// [DIBERIKAN KOMENTAR] if err == nil && (name == exeName || name == exeName+".exe") {
			// [DIBERIKAN KOMENTAR]     log.Printf("[Engine] ⚠️ Old instance detected (PID: %d). Stopping process to prevent stacking...", p.Pid)
			// [DIBERIKAN KOMENTAR]     p.Kill()
			// [DIBERIKAN KOMENTAR]     time.Sleep(500 * time.Millisecond)
			// [DIBERIKAN KOMENTAR] }

			// [KODE BARU] Filter multi-kondisi: Proses Engine lama, GUI Electron, dan apapun yang bernama flowork
			if err == nil {
				lowerName := strings.ToLower(name)

				// 1. Apakah ini Engine / exe saat ini yang duplikat?
				isDuplicateEngine := (name == exeName || name == exeName+".exe")

				// 2. Apakah ini GUI (Electron Standalone)?
				isGuiExe := (lowerName == "gui.exe" || lowerName == "gui" || lowerName == "gui.app")

				// 3. Apakah nama proses mengandung kata "flowork" (zombie dari komponen lain)?
				containsFlowork := strings.Contains(lowerName, "flowork")

				if isDuplicateEngine || isGuiExe || containsFlowork {
					log.Printf("[Engine] ⚠️ Zombie/Conflict Process detected (PID: %d | Name: %s). Killing process...", p.Pid, name)
					p.Kill()
					// Tidur sebentar agar OS benar-benar melepaskan proses dari memori
					time.Sleep(100 * time.Millisecond)
				}
			}
		}
	}
}

// Special function to open link in STANDARD BROWSER (Standard Tab), not App mode
func openBrowser(url string) {
	var cmd *exec.Cmd

	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", "", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default: // linux, freebsd, etc
		cmd = exec.Command("xdg-open", url)
	}
	cmd.Start()
	log.Printf("[Engine] 🌐 Opening standard browser tab to: %s\n", url)
}

// =========================================================================
// [PERBAIKAN] Fungsi openAppWindow via Webview / Electron
// Mampu membedakan mode Portable (.exe) dan mode Development (go run)
// =========================================================================
func openAppWindow(url string) {
	var cmd *exec.Cmd

	baseDir := EngineDir

	// [KODE BARU] Dev Mode: langsung npm start, skip gui.exe
	if IsDevModeGlobal {
		log.Printf("[Engine] 🛠️ Dev Mode aktif — skip gui.exe, langsung npm start...\n")

		if runtime.GOOS == "windows" {
			cmd = exec.Command("cmd", "/c", "npm start")
		} else {
			cmd = exec.Command("sh", "-c", "npm start")
		}

		cmd.Dir = baseDir

		err := cmd.Start()
		if err != nil {
			log.Printf("[Engine] ❌ Gagal menjalankan npm start: %v\n", err)
			openBrowser(url)
		}
		return
	}

	// Production Mode: cari gui.exe
	electronExeName := "gui.exe"

	switch runtime.GOOS {
	case "darwin":
		electronExeName = "gui.app/Contents/MacOS/gui"
	case "linux":
		electronExeName = "gui"
	}

	electronExePath := filepath.Join(baseDir, electronExeName)

	if _, err := os.Stat(electronExePath); err == nil {
		cmd = exec.Command(electronExePath)
		cmd.Dir = baseDir
		log.Printf("[Engine] 🖥️ Membuka Webview Standalone (Electron): %s\n", electronExePath)

		if runtime.GOOS == "windows" {
			cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
		}
		cmd.Start()
	} else {
		log.Printf("[Engine] 🌐 Fallback membuka Browser Standar karena gui.exe tidak tersedia.\n")
		openBrowser(url)
	}
}

func forceUpdate() {
	log.Println("[Engine] 🛑 UPDATE REQUIRED! Showing update popup to user...")
	dialog.Message("Mandatory System Update!\n\nYour Flowork OS version (v%s) is outdated or the system failed to verify the connection to the central server.\n\nYou cannot use this Engine without the latest version.\nClick OK to download the latest version.", CurrentEngineVersion).
		Title("Flowork OS - Update Required").
		Info()

	openBrowser("https://update.floworkos.com")
	os.Exit(0)
}

func checkUpdate() {
	log.Println("[Engine] 🔄 Checking Flowork OS system version...")

	client := &http.Client{
		Timeout: 15 * time.Second,
	}

	req, err := http.NewRequest("GET", "https://floworkos.com/update-engine.txt", nil)
	if err != nil {
		log.Printf("[Engine] ⚠️ Failed to create request: %v\n", err)
		forceUpdate()
		return
	}

	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 FloworkOS-Engine/1.0")

	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[Engine] ⚠️ Update server is down / inaccessible: %v\n", err)
		forceUpdate()
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("[Engine] ⚠️ HTTP Error %d while checking for updates.\n", resp.StatusCode)
		forceUpdate()
		return
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("[Engine] ⚠️ Failed to read server response: %v\n", err)
		forceUpdate()
		return
	}

	latestVersion := strings.TrimSpace(string(bodyBytes))

	if latestVersion != CurrentEngineVersion {
		log.Printf("[Engine] 🚀 Outdated version! (Current: %s | Latest: %s)\n", CurrentEngineVersion, latestVersion)
		forceUpdate()
		return
	}

	log.Printf("[Engine] ✅ System is Up-to-Date (v%s)\n", CurrentEngineVersion)
}

type FileNode struct {
	Name     string     `json:"name"`
	Path     string     `json:"path"`
	IsDir    bool       `json:"is_dir"`
	Children []FileNode `json:"children,omitempty"`
}

func buildFileTree(dir string) ([]FileNode, error) {
	var nodes []FileNode
	files, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	for _, f := range files {
		fullPath := filepath.Join(dir, f.Name())
		node := FileNode{
			Name:  f.Name(),
			Path:  fullPath,
			IsDir: f.IsDir(),
		}
		if f.IsDir() {
			children, _ := buildFileTree(fullPath)
			node.Children = children
		}
		nodes = append(nodes, node)
	}
	return nodes, nil
}

func main() {
	initEngineDir() // [KODE BARU] Panggil inisialisasi path absolut pertama kali
	initLicense()   // [SISTEM LISENSI] Periksa langganan dari Cloudflare
	lockWorkingDirectory()
	killPreviousInstances()

	forceKillPort5000()

	log.Println("[Engine] 🚀 Starting initial system initialization...")
	packer.CleanupOldTempFolders()

	checkUpdate()

	app := fiber.New(fiber.Config{
		DisableStartupMessage: true,
		BodyLimit:             500 * 1024 * 1024,
	})

	app.Use(cors.New(cors.Config{
		AllowOrigins: "*",
		AllowHeaders: "Origin, Content-Type, Accept",
	}))

	app.Use(func(c *fiber.Ctx) error {
		c.Set("Access-Control-Allow-Private-Network", "true")
		return c.Next()
	})

	app.Use(cors.New(cors.Config{
		AllowOrigins:     "http://localhost:5000, http://127.0.0.1:5000, http://localhost:5173, http://127.0.0.1:5173, http://localhost:5174, http://127.0.0.1:5174, http://localhost:5175, http://127.0.0.1:5175, https://floworkos.com, https://www.floworkos.com, https://flowork.cloud, chrome-extension://cbcamfbenpgekaihddgmnagdkcddbfim",
		AllowHeaders:     "Origin, Content-Type, Accept, Authorization",
		AllowCredentials: true,
	}))

	// [DIBERIKAN KOMENTAR] os.MkdirAll("nodes", os.ModePerm)
	// [DIBERIKAN KOMENTAR] os.MkdirAll("apps", os.ModePerm)
	// [KODE BARU] Gunakan absolute path agar terbuat persis di sebelah .exe
	os.MkdirAll(filepath.Join(EngineDir, "nodes"), os.ModePerm)
	os.MkdirAll(filepath.Join(EngineDir, "apps"), os.ModePerm)

	app.Post("/api/upload", func(c *fiber.Ctx) error {
		fileHeader, err := c.FormFile("file")
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"success": false, "error": "Failed to read uploaded file."})
		}

		targetPath := c.FormValue("target_path")
		var savePath string

		if targetPath != "" {
			// Upload directly to target_path, keep original filename
			if err := os.MkdirAll(targetPath, os.ModePerm); err != nil {
				return c.Status(500).JSON(fiber.Map{"success": false, "error": "Failed to create target directory."})
			}
			savePath = filepath.Join(targetPath, filepath.Base(fileHeader.Filename))
		} else {
			// Legacy fallback for AI builder (apps/nodes)
			fileType := c.FormValue("type")
			targetDir := filepath.Join(EngineDir, "apps")
			ext := ".flow"
			if fileType == "node" {
				targetDir = filepath.Join(EngineDir, "nodes")
				ext = ".nflow"
			}

			if err := os.MkdirAll(targetDir, os.ModePerm); err != nil {
				log.Printf("[Engine] ❌ Failed to create directory %s: %v\n", targetDir, err)
				return c.Status(500).JSON(fiber.Map{"success": false, "error": "Failed to create folder in engine directory."})
			}

			cleanFileName := filepath.Base(fileHeader.Filename)
			if !strings.HasSuffix(cleanFileName, ext) {
				cleanFileName = cleanFileName + ext
			}
			savePath = filepath.Join(targetDir, cleanFileName)
		}

		srcFile, err := fileHeader.Open()
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"success": false, "error": "Failed to open upload file stream."})
		}
		defer srcFile.Close()

		outFile, err := os.Create(savePath)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"success": false, "error": "Failed to save package to SSD/Hard drive."})
		}
		defer outFile.Close()

		if _, err = io.Copy(outFile, srcFile); err != nil {
			log.Printf("[Engine] ❌ File copy process interrupted %s: %v\n", savePath, err)
			return c.Status(500).JSON(fiber.Map{"success": false, "error": "Download process corrupted or interrupted."})
		}

		log.Printf("[Engine] ✅ Successfully received manual upload file: %s\n", savePath)
		return c.JSON(fiber.Map{"success": true, "message": "File successfully uploaded to Engine."})
	})

	// [SISTEM LISENSI] Web GUI Endpoint Pemasangan Token
	app.Post("/api/license/save", func(c *fiber.Ctx) error {
		var req LicenseData
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"status": "error", "message": "Payload JSON rusak."})
		}
		if req.Token == "" {
			return c.Status(400).JSON(fiber.Map{"status": "error", "message": "Token diperlukan."})
		}

		fileBytes, _ := json.MarshalIndent(req, "", "  ")
		os.WriteFile(LicenseFilePath, fileBytes, 0644)

		go initLicense() // Lakukan background check instan ke cloudflare

		return c.JSON(fiber.Map{"status": "success", "message": "Registrasi langganan diterima OS lokal."})
	})

	app.Get("/api/license/status", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"status": "success", "tier": UserTier})
	})

	// [KODE BARU] API langsung tulis file dari AI Builder — bypass STDIN pipe
	app.Post("/api/ai-write", func(c *fiber.Ctx) error {
		type WriteRequest struct {
			AppID      string            `json:"app_id"`
			OutputType string            `json:"output_type"`
			Files      map[string]string `json:"files"`
		}

		var req WriteRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"status": "error", "error": "Invalid JSON payload: " + err.Error()})
		}

		if req.AppID == "" || len(req.Files) == 0 {
			return c.Status(400).JSON(fiber.Map{"status": "error", "error": "Missing app_id or files."})
		}

		// Determine target directory
		baseDir := filepath.Join(EngineDir, "apps")
		if req.OutputType == "node" {
			baseDir = filepath.Join(EngineDir, "nodes")
		}
		targetDir := filepath.Join(baseDir, req.AppID)

		// Create target directory
		if err := os.MkdirAll(targetDir, os.ModePerm); err != nil {
			log.Printf("[AI-Builder] ❌ Failed to create directory %s: %v\n", targetDir, err)
			return c.Status(500).JSON(fiber.Map{"status": "error", "error": "Failed to create directory: " + err.Error()})
		}

		writtenFiles := make([]string, 0)
		errors := make([]string, 0)

		for filename, content := range req.Files {
			// Sanitize filename (prevent directory traversal)
			safeName := filepath.Base(filename)
			if safeName == "" || safeName == "." || safeName == ".." {
				continue
			}

			filePath := filepath.Join(targetDir, safeName)

			if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
				errors = append(errors, fmt.Sprintf("%s: %v", safeName, err))
				log.Printf("[AI-Builder] ❌ Failed to write %s: %v\n", filePath, err)
			} else {
				writtenFiles = append(writtenFiles, safeName)
			}
		}

		log.Printf("[AI-Builder] ✅ Written %d files to %s\n", len(writtenFiles), targetDir)
		return c.JSON(fiber.Map{
			"status":        "success",
			"app_id":        req.AppID,
			"output_type":   req.OutputType,
			"target_dir":    targetDir,
			"written_files": writtenFiles,
			"total_files":   len(writtenFiles),
			"errors":        errors,
		})
	})

	// [KODE BARU] API History AI Builder
	app.Post("/api/ai-chat/history", func(c *fiber.Ctx) error {
		type HistoryRequest struct {
			AppID      string        `json:"app_id"`
			OutputType string        `json:"output_type"`
			History    []interface{} `json:"history"`
		}
		var req HistoryRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"status": "error", "error": "Invalid payload"})
		}

		if req.AppID == "" {
			return c.Status(400).JSON(fiber.Map{"status": "error", "error": "Missing app_id"})
		}

		baseDir := filepath.Join(EngineDir, "apps")
		if req.OutputType == "node" {
			baseDir = filepath.Join(EngineDir, "nodes")
		}
		targetDir := filepath.Join(baseDir, req.AppID)
		os.MkdirAll(targetDir, 0755)

		historyPath := filepath.Join(targetDir, "chat_history.json")
		data, err := json.MarshalIndent(req.History, "", "  ")
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"status": "error", "error": "Failed to serialize"})
		}
		os.WriteFile(historyPath, data, 0644)

		return c.JSON(fiber.Map{"status": "success"})
	})

	app.Get("/api/ai-chat/history", func(c *fiber.Ctx) error {
		appID := c.Query("app_id")
		outputType := c.Query("output_type")

		if appID == "" {
			return c.Status(400).JSON(fiber.Map{"status": "error", "error": "Missing app_id"})
		}

		baseDir := filepath.Join(EngineDir, "apps")
		if outputType == "node" {
			baseDir = filepath.Join(EngineDir, "nodes")
		}
		historyPath := filepath.Join(baseDir, appID, "chat_history.json")

		if _, err := os.Stat(historyPath); os.IsNotExist(err) {
			return c.JSON(fiber.Map{"status": "success", "history": []interface{}{}})
		}

		data, err := os.ReadFile(historyPath)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"status": "error", "error": "Cannot read history"})
		}

		var history []interface{}
		if err := json.Unmarshal(data, &history); err != nil {
			return c.JSON(fiber.Map{"status": "success", "history": []interface{}{}})
		}

		return c.JSON(fiber.Map{"status": "success", "history": history})
	})

	// [KODE BARU] API eksekusi terminal untuk AI Builder uji coba
	app.Post("/api/ai-exec", func(c *fiber.Ctx) error {
		type ExecRequest struct {
			AppID      string `json:"app_id"`
			OutputType string `json:"output_type"`
			Command    string `json:"command"`
		}
		var req ExecRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"status": "error", "error": "Invalid JSON payload: " + err.Error()})
		}
		if req.AppID == "" || req.Command == "" {
			return c.Status(400).JSON(fiber.Map{"status": "error", "error": "Missing app_id or command."})
		}

		baseDir := filepath.Join(EngineDir, "apps")
		if req.OutputType == "node" {
			baseDir = filepath.Join(EngineDir, "nodes")
		}
		targetDir := filepath.Join(baseDir, req.AppID)

		if _, err := os.Stat(targetDir); os.IsNotExist(err) {
			return c.Status(404).JSON(fiber.Map{"status": "error", "error": "App directory does not exist yet."})
		}

		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		var cmd *exec.Cmd
		if runtime.GOOS == "windows" {
			cmd = exec.CommandContext(ctx, "cmd", "/c", req.Command)
		} else {
			cmd = exec.CommandContext(ctx, "sh", "-c", req.Command)
		}
		cmd.Dir = targetDir

		out, err := cmd.CombinedOutput()

		errMsg := ""
		if err != nil {
			errMsg = err.Error()
			if ctx.Err() == context.DeadlineExceeded {
				errMsg = "Process Timed Out (Max 10s allowed)"
			}
		}

		log.Printf("[AI-Builder] 💻 Terminal Exec (%s): %s", req.AppID, req.Command)

		return c.JSON(fiber.Map{
			"status":  "success",
			"command": req.Command,
			"output":  string(out),
			"error":   errMsg,
		})
	})

	// [KODE BARU] API membaca file existing agar AI bisa tahu kode yang sudah ada
	app.Get("/api/ai-read/:type/:id", func(c *fiber.Ctx) error {
		readType := c.Params("type") // "apps" or "nodes"
		appID := c.Params("id")

		if readType != "apps" && readType != "nodes" {
			return c.Status(400).JSON(fiber.Map{"status": "error", "error": "Type must be 'apps' or 'nodes'."})
		}

		targetDir := filepath.Join(EngineDir, readType, appID)

		entries, err := os.ReadDir(targetDir)
		if err != nil {
			return c.Status(404).JSON(fiber.Map{"status": "error", "error": "App/Node not found: " + appID})
		}

		filesMap := make(map[string]string)
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			name := entry.Name()
			// Only read text files (skip binary)
			ext := strings.ToLower(filepath.Ext(name))
			binaryExts := map[string]bool{".webp": true, ".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".flow": true, ".nflow": true, ".exe": true, ".dll": true}
			if binaryExts[ext] {
				filesMap[name] = "[BINARY FILE - SKIPPED]"
				continue
			}

			content, err := os.ReadFile(filepath.Join(targetDir, name))
			if err == nil {
				filesMap[name] = string(content)
			}
		}

		return c.JSON(fiber.Map{
			"status":      "success",
			"app_id":      appID,
			"files":       filesMap,
			"total_files": len(filesMap),
		})
	})

	app.Get("/api/local-apps", func(c *fiber.Ctx) error {
		// [DIBERIKAN KOMENTAR] entries, err := os.ReadDir("./apps")
		appsAbsDir := filepath.Join(EngineDir, "apps") // [KODE BARU] Menggunakan path absolut
		entries, err := os.ReadDir(appsAbsDir)
		if err != nil {
			// [DIBERIKAN KOMENTAR] os.MkdirAll("./apps", os.ModePerm)
			os.MkdirAll(appsAbsDir, os.ModePerm) // [KODE BARU]
			return c.JSON(fiber.Map{
				"status": "success",
				"data":   []map[string]interface{}{},
			})
		}

		localApps := make([]map[string]interface{}, 0)
		seenApps := make(map[string]bool) // [KODE BARU] Deduplicate folder + .flow

		for _, entry := range entries {
			appName := entry.Name()
			isRawDevApp := false

			if entry.IsDir() {
				// Skip hidden folders
				if strings.HasPrefix(appName, ".") {
					continue
				}
				isRawDevApp = true
			} else if strings.HasSuffix(appName, ".flow") {
				appName = strings.TrimSuffix(appName, ".flow")
			} else {
				continue // Skip file acak yang bukan folder atau bukan .flow
			}

			// [KODE BARU] Skip .flow jika raw folder-nya sudah ada (cegah duplikat)
			if seenApps[appName] {
				continue
			}
			seenApps[appName] = true

			appInfo := map[string]interface{}{
				"id":       appName,
				"is_local": true,
				"name":     appName,
				"category": "Offline Node",
				"icon":     fmt.Sprintf("http://localhost:5000/local-apps/%s/icon.svg", appName),
			}

			if isRawDevApp {
				// [DIBERIKAN KOMENTAR] schemaPath := filepath.Join("./apps", appName, "schema.json")
				schemaPath := filepath.Join(appsAbsDir, appName, "schema.json") // [KODE BARU] Path absolut
				if schemaData, err := os.ReadFile(schemaPath); err == nil {
					var parsedSchema map[string]interface{}
					if json.Unmarshal(schemaData, &parsedSchema) == nil {
						if name, ok := parsedSchema["name"]; ok {
							appInfo["name"] = name
						}
						if desc, ok := parsedSchema["description"]; ok {
							appInfo["description"] = desc
						}
					}
				}
			}

			localApps = append(localApps, appInfo)
		}

		return c.JSON(fiber.Map{
			"status": "success",
			"data":   localApps,
		})
	})

	app.Get("/favicon.ico", func(c *fiber.Ctx) error {
		iconData, err := embeddedFiles.ReadFile("icon.ico")
		if err != nil {
			return c.SendStatus(404)
		}
		c.Set("Content-Type", "image/x-icon")
		return c.Send(iconData)
	})

	app.Use("/store", filesystem.New(filesystem.Config{
		Root:       http.FS(embeddedFiles),
		PathPrefix: "store",
		Browse:     false,
	}))

	// [KODE BARU] Pindah inisialisasi socketHandler ke atas agar bisa diakses oleh route local-apps
	nodeManager := runner.NewNodeManager(filepath.Join(EngineDir, "nodes"))
	socketHandler := socket.NewSocketHandler(nodeManager, EngineDir)

	app.Get("/local-apps/:appName/*", func(c *fiber.Ctx) error {
		appName := c.Params("appName")
		assetPath := c.Params("*")

		assetPath, _ = url.PathUnescape(assetPath)

		// [BUG 5 FIX] Always check for raw folder first, regardless of Dev Mode
		// This ensures AI Builder-generated apps work immediately without .flow packaging
		isRawDevApp := false
		rawAppPath := filepath.Join(EngineDir, "apps", appName)
		if info, err := os.Stat(rawAppPath); err == nil && info.IsDir() {
			isRawDevApp = true
		}

		if isRawDevApp {
			// [SISTEM LISENSI] Periksa schema.json sebelum mengizinkan render aplikasi
			schemaPath := filepath.Join(rawAppPath, "schema.json")
			if schemaBytes, err := os.ReadFile(schemaPath); err == nil {
				var schema map[string]interface{}
				if json.Unmarshal(schemaBytes, &schema) == nil {
					if targetTier, ok := schema["tier"].(string); ok && targetTier != "" && targetTier != "free" {
						// Role hierarchy: enterprise > pro > free
						isAllowed := false
						if UserTier == "enterprise" {
							isAllowed = true
						} else if UserTier == "pro" && targetTier == "pro" {
							isAllowed = true
						}

						if !isAllowed {
							return c.Status(403).Type("html").SendString(`
								<html>
								<head><meta charset="utf-8" /></head>
								<body style="background:#111; color:#ff4444; font-family:Inter, sans-serif; display:flex; justify-content:center; align-items:center; height:100vh; text-align:center;">
								<div>
									<h1 style="font-size:3rem; margin-bottom:10px;">⚠️ Akses Ditolak</h1>
									<p style="font-size:1.5rem; color:#aaa;">Aplikasi <b>` + appName + `</b> membutuhkan Lisensi <b>` + strings.ToUpper(targetTier) + `</b> yang aktif.</p>
									<p style="font-size:1.2rem; color:#888;">Silakan perpanjang langganan Flowork OS Anda melalui Dashboard atau Hubungi Reseller.</p>
								</div>
								</body></html>
							`)
						}
					}
				}
			}

			if assetPath == "" || assetPath == "/" {
				defaultPopup := "index.html"
				manifestPath := filepath.Join(rawAppPath, "manifest.json")
				if manifestBytes, err := os.ReadFile(manifestPath); err == nil {
					var manifest map[string]interface{}
					if json.Unmarshal(manifestBytes, &manifest) == nil {
						if action, ok := manifest["action"].(map[string]interface{}); ok {
							if dp, ok := action["default_popup"].(string); ok && dp != "" {
								defaultPopup = dp
							}
						}
					}
				}
				return c.Redirect("/local-apps/" + appName + "/" + strings.TrimPrefix(defaultPopup, "/"))
			}

			assetFullPath := filepath.Join(rawAppPath, assetPath)
			if _, err := os.Stat(assetFullPath); os.IsNotExist(err) {
				return c.Status(404).SendString("Asset '" + assetPath + "' not found inside the raw application folder.")
			}

			// [KODE BARU] Matikan Cache Browser secara paksa saat Dev Mode, agar UI (index.html / app.js) SELALU FRESH!
			c.Set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate")
			c.Set("Pragma", "no-cache")
			c.Set("Expires", "0")

			return c.SendFile(assetFullPath)
		} else {
			// [DIBERIKAN KOMENTAR] flowPath := filepath.Join("apps", appName+".flow")
			flowPath := filepath.Join(EngineDir, "apps", appName+".flow") // [KODE BARU]
			if _, err := os.Stat(flowPath); os.IsNotExist(err) {
				return c.Status(404).SendString("Application package file not found.")
			}

			cipherText, err := os.ReadFile(flowPath)
			if err != nil {
				return c.Status(500).SendString("Failed to read application package.")
			}

			block, err := aes.NewCipher(packer.MasterKey)
			if err != nil {
				return c.Status(500).SendString("Cryptographic Cipher Error.")
			}

			gcm, err := cipher.NewGCM(block)
			if err != nil {
				return c.Status(500).SendString("GCM Error.")
			}

			nonceSize := gcm.NonceSize()
			if len(cipherText) < nonceSize {
				return c.Status(500).SendString("Application package is corrupt or too short.")
			}

			nonce, cipherData := cipherText[:nonceSize], cipherText[nonceSize:]
			plainText, err := gcm.Open(nil, nonce, cipherData, nil)
			if err != nil {
				return c.Status(500).SendString("Decryption failed. Master Key does not match.")
			}

			zipReader, err := zip.NewReader(bytes.NewReader(plainText), int64(len(plainText)))
			if err != nil {
				return c.Status(500).SendString("Failed to read ZIP structure in memory.")
			}

			// [SISTEM LISENSI] Periksa schema.json di dalam payload zip terenkripsi
			for _, f := range zipReader.File {
				cleanName := strings.ReplaceAll(f.Name, "\\", "/")
				if cleanName == "schema.json" {
					rc, err := f.Open()
					if err == nil {
						schemaBytes, err := io.ReadAll(rc)
						rc.Close()
						if err == nil {
							var schema map[string]interface{}
							if json.Unmarshal(schemaBytes, &schema) == nil {
								if targetTier, ok := schema["tier"].(string); ok && targetTier != "" && targetTier != "free" {
									isAllowed := false
									if UserTier == "enterprise" {
										isAllowed = true
									} else if UserTier == "pro" && targetTier == "pro" {
										isAllowed = true
									}

									if !isAllowed {
										return c.Status(403).Type("html").SendString(`
											<html>
											<head><meta charset="utf-8" /></head>
											<body style="background:#111; color:#ff4444; font-family:Inter, sans-serif; display:flex; justify-content:center; align-items:center; height:100vh; text-align:center;">
											<div>
												<h1 style="font-size:3rem; margin-bottom:10px;">⚠️ Akses Ditolak</h1>
												<p style="font-size:1.5rem; color:#aaa;">Aplikasi <b>` + appName + `</b> membutuhkan Lisensi <b>` + strings.ToUpper(targetTier) + `</b> yang aktif.</p>
												<p style="font-size:1.2rem; color:#888;">Silakan perpanjang langganan Flowork OS Anda melalui Dashboard atau Hubungi Reseller.</p>
											</div>
											</body></html>
										`)
									}
								}
							}
						}
					}
					break
				}
			}

			if assetPath == "" || assetPath == "/" {
				defaultPopup := "index.html"

				for _, f := range zipReader.File {
					cleanName := strings.ReplaceAll(f.Name, "\\", "/")
					if cleanName == "manifest.json" {
						rc, err := f.Open()
						if err == nil {
							manifestBytes, err := io.ReadAll(rc)
							rc.Close()
							if err == nil {
								var manifest map[string]interface{}
								if json.Unmarshal(manifestBytes, &manifest) == nil {
									if action, ok := manifest["action"].(map[string]interface{}); ok {
										if dp, ok := action["default_popup"].(string); ok && dp != "" {
											defaultPopup = dp
										}
									}
								}
							}
						}
						break
					}
				}
				return c.Redirect("/local-apps/" + appName + "/" + strings.TrimPrefix(defaultPopup, "/"))
			}

			assetPath = strings.TrimPrefix(assetPath, "/")

			// [KODE BARU] Cek Sandbox aktif dulu
			if sandboxPath, exists := socketHandler.GetSandboxPath(appName); exists {
				sandboxAssetPath := filepath.Join(sandboxPath, assetPath)
				if _, err := os.Stat(sandboxAssetPath); err == nil {
					return c.SendFile(sandboxAssetPath)
				}
			}

			for _, f := range zipReader.File {
				cleanName := strings.ReplaceAll(f.Name, "\\", "/")
				cleanName = strings.TrimPrefix(cleanName, "/")

				if cleanName == assetPath {
					rc, err := f.Open()
					if err != nil {
						return c.Status(500).SendString("Failed to open asset from package.")
					}
					defer rc.Close()

					assetData, err := io.ReadAll(rc)
					if err != nil {
						return c.Status(500).SendString("Failed to extract asset.")
					}

					mimeType := "application/octet-stream"
					ext := strings.ToLower(filepath.Ext(assetPath))

					switch ext {
					case ".html":
						mimeType = "text/html"
					case ".js":
						mimeType = "application/javascript"
					case ".css":
						mimeType = "text/css"
					case ".svg":
						mimeType = "image/svg+xml"
					case ".webp":
						mimeType = "image/webp"
					case ".png":
						mimeType = "image/png"
					case ".jpg", ".jpeg":
						mimeType = "image/jpeg"
					case ".gif":
						mimeType = "image/gif"
					case ".json":
						mimeType = "application/json"
					case ".md":
						mimeType = "text/markdown"
					case ".txt":
						mimeType = "text/plain"
					case ".ttf":
						mimeType = "font/ttf"
					case ".woff":
						mimeType = "font/woff"
					case ".woff2":
						mimeType = "font/woff2"
					case ".mp3":
						mimeType = "audio/mpeg"
					case ".wav":
						mimeType = "audio/wav"
					case ".ogg":
						mimeType = "audio/ogg"
					case ".wasm":
						mimeType = "application/wasm"
					}

					c.Set("Content-Type", mimeType)
					c.Set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate")
					c.Set("Pragma", "no-cache")
					c.Set("Expires", "0")

					return c.Send(assetData)
				}
			}

			return c.Status(404).SendString("Asset '" + assetPath + "' not found inside the application package.")
		}
	})

	// [DIBERIKAN KOMENTAR] nodeManager := runner.NewNodeManager("nodes")
	// [DIBERIKAN KOMENTAR] nodeManager := runner.NewNodeManager(filepath.Join(EngineDir, "nodes"))
	// [DIBERIKAN KOMENTAR] socketHandler := socket.NewSocketHandler(nodeManager, EngineDir)

	// ═══════════════════════════════════════════════════════════════
	// [KODE BARU] Initialize Workflow Engine, Triggers, Vault, History, EnvStore
	// ═══════════════════════════════════════════════════════════════
	workflowsDir := filepath.Join(EngineDir, "workflows")
	os.MkdirAll(workflowsDir, os.ModePerm)

	wfStore := workflow.NewWorkflowStore(workflowsDir)
	credVault := vault.NewVault(EngineDir)
	wfRunner := workflow.NewWorkflowRunner(nodeManager, credVault)
	execHistory := history.NewHistoryStore(filepath.Join(EngineDir, "executions"))
	envStore := config.NewEnvStore(EngineDir)
	scheduler := trigger.NewScheduler(wfRunner, wfStore)
	webhookMgr := trigger.NewWebhookManager(wfRunner, wfStore)

	// Wire progress callback to save execution history
	wfRunner.OnProgress = func(nodeID string, status string, data interface{}) {
		log.Printf("[WorkflowRunner] 📊 Node %s → %s", nodeID, status)
	}

	// [WEBHOOK PARITY UPGRADE] Auto-load persistent active webhooks from Database
	if err := webhookMgr.LoadActiveWebhooks(); err != nil {
		log.Printf("[Engine] ⚠️ Failed to auto-load persistent webhooks: %v", err)
	} else {
		log.Println("[Engine] ✅ Persistent Webhooks automatically restored & listening.")
	}

	log.Println("[Engine] ✅ Workflow Engine, Vault, History & EnvStore initialized.")

	// ═══════════════════════════════════════════════════════════════
	// REST API: AI Builder — Search & Rename Tools
	// ═══════════════════════════════════════════════════════════════

	// SEARCH: Grep-like text search across all files in an app/node
	app.Post("/api/ai-search", func(c *fiber.Ctx) error {
		type SearchRequest struct {
			AppID      string `json:"app_id"`
			OutputType string `json:"output_type"`
			Query      string `json:"query"`
		}
		var req SearchRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"status": "error", "error": "Invalid JSON payload"})
		}
		if req.AppID == "" || req.Query == "" {
			return c.Status(400).JSON(fiber.Map{"status": "error", "error": "Missing app_id or query"})
		}

		baseDir := filepath.Join(EngineDir, "apps")
		if req.OutputType == "node" {
			baseDir = filepath.Join(EngineDir, "nodes")
		}
		targetDir := filepath.Join(baseDir, req.AppID)

		entries, err := os.ReadDir(targetDir)
		if err != nil {
			return c.Status(404).JSON(fiber.Map{"status": "error", "error": "App/Node not found: " + req.AppID})
		}

		type SearchMatch struct {
			File    string `json:"file"`
			Line    int    `json:"line"`
			Content string `json:"content"`
		}
		matches := []SearchMatch{}

		binaryExts := map[string]bool{".webp": true, ".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".flow": true, ".nflow": true, ".exe": true, ".dll": true}
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			ext := strings.ToLower(filepath.Ext(entry.Name()))
			if binaryExts[ext] {
				continue
			}
			content, err := os.ReadFile(filepath.Join(targetDir, entry.Name()))
			if err != nil {
				continue
			}
			lines := strings.Split(string(content), "\n")
			for i, line := range lines {
				if strings.Contains(strings.ToLower(line), strings.ToLower(req.Query)) {
					trimmed := strings.TrimSpace(line)
					if len(trimmed) > 200 {
						trimmed = trimmed[:200] + "..."
					}
					matches = append(matches, SearchMatch{File: entry.Name(), Line: i + 1, Content: trimmed})
				}
			}
		}

		log.Printf("[AI-Builder] 🔍 Search '%s' in %s: %d matches\n", req.Query, req.AppID, len(matches))
		return c.JSON(fiber.Map{
			"status":  "success",
			"query":   req.Query,
			"app_id":  req.AppID,
			"matches": matches,
			"total":   len(matches),
		})
	})

	// RENAME: Rename a file within an app/node folder
	app.Post("/api/ai-rename", func(c *fiber.Ctx) error {
		type RenameRequest struct {
			AppID      string `json:"app_id"`
			OutputType string `json:"output_type"`
			OldName    string `json:"old_name"`
			NewName    string `json:"new_name"`
		}
		var req RenameRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"status": "error", "error": "Invalid JSON payload"})
		}
		if req.AppID == "" || req.OldName == "" || req.NewName == "" {
			return c.Status(400).JSON(fiber.Map{"status": "error", "error": "Missing app_id, old_name, or new_name"})
		}

		baseDir := filepath.Join(EngineDir, "apps")
		if req.OutputType == "node" {
			baseDir = filepath.Join(EngineDir, "nodes")
		}
		targetDir := filepath.Join(baseDir, req.AppID)

		// Sanitize names
		safeOld := filepath.Base(req.OldName)
		safeNew := filepath.Base(req.NewName)

		oldPath := filepath.Join(targetDir, safeOld)
		newPath := filepath.Join(targetDir, safeNew)

		if _, err := os.Stat(oldPath); os.IsNotExist(err) {
			return c.Status(404).JSON(fiber.Map{"status": "error", "error": "File not found: " + safeOld})
		}

		if err := os.Rename(oldPath, newPath); err != nil {
			return c.Status(500).JSON(fiber.Map{"status": "error", "error": "Rename failed: " + err.Error()})
		}

		log.Printf("[AI-Builder] 📝 Renamed %s → %s in %s\n", safeOld, safeNew, req.AppID)
		return c.JSON(fiber.Map{
			"status":   "success",
			"old_name": safeOld,
			"new_name": safeNew,
			"app_id":   req.AppID,
		})
	})

	// ═══════════════════════════════════════════════════════════════
	// REST API: File Explorer (AI Builder)
	// ═══════════════════════════════════════════════════════════════
	app.Get("/api/fs/tree", func(c *fiber.Ctx) error {
		appsTree, _ := buildFileTree(filepath.Join(EngineDir, "apps"))
		nodesTree, _ := buildFileTree(filepath.Join(EngineDir, "nodes"))
		return c.JSON(fiber.Map{
			"status": "success",
			"data": fiber.Map{
				"apps":  appsTree,
				"nodes": nodesTree,
			},
		})
	})

	// LIST: List any directory contents (for Dashboard File Manager)
	app.Get("/api/fs/list", func(c *fiber.Ctx) error {
		dirPath := c.Query("path")
		if dirPath == "" {
			return c.Status(400).JSON(fiber.Map{"status": "error", "error": "path parameter is required"})
		}

		entries, err := os.ReadDir(dirPath)
		if err != nil {
			return c.Status(404).JSON(fiber.Map{"status": "error", "error": "Cannot read directory: " + err.Error()})
		}

		type FileItem struct {
			Name          string `json:"name"`
			Path          string `json:"path"`
			IsDir         bool   `json:"is_dir"`
			Size          int64  `json:"size"`
			ChildrenCount int    `json:"children_count"`
		}

		var files []FileItem
		for _, entry := range entries {
			fullPath := filepath.Join(dirPath, entry.Name())
			item := FileItem{
				Name:  entry.Name(),
				Path:  fullPath,
				IsDir: entry.IsDir(),
			}
			if entry.IsDir() {
				subEntries, err := os.ReadDir(fullPath)
				if err == nil {
					item.ChildrenCount = len(subEntries)
				}
			} else {
				info, err := entry.Info()
				if err == nil {
					item.Size = info.Size()
				}
			}
			files = append(files, item)
		}

		return c.JSON(fiber.Map{
			"status": "success",
			"files":  files,
		})
	})

	app.Get("/api/fs/read", func(c *fiber.Ctx) error {
		filePath := c.Query("path")
		if filePath == "" {
			return c.Status(400).JSON(fiber.Map{"error": "path parameter is required"})
		}
		content, err := os.ReadFile(filePath)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}
		return c.SendString(string(content))
	})

	app.Delete("/api/fs/delete", func(c *fiber.Ctx) error {
		filePath := c.Query("path")
		if filePath == "" {
			return c.Status(400).JSON(fiber.Map{"error": "path parameter is required"})
		}

		// Root folder protection (cannot delete these exact folders)
		cleanPath := filepath.Clean(filePath)
		baseName := filepath.Base(cleanPath)
		protectedFolders := []string{"apps", "nodes", "tools", "workspace", "workflows", "models", "brain", "flowork_modules", "connector", "internal", "scripts", "build", "brain_extensions", "runtimes", "store", "FloworkData"}
		
		isProtected := false
		for _, protected := range protectedFolders {
			if cleanPath == filepath.Join(EngineDir, protected) || baseName == protected && filepath.Dir(cleanPath) == EngineDir {
				isProtected = true
				break
			}
		}

		if isProtected {
			return c.Status(403).JSON(fiber.Map{"error": "Cannot delete root engine folder: " + baseName})
		}

		if err := os.RemoveAll(filePath); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(fiber.Map{"status": "success"})
	})

	app.Post("/api/fs/mkdir", func(c *fiber.Ctx) error {
		var req struct {
			Path string `json:"path"`
		}
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid payload"})
		}
		if req.Path == "" {
			return c.Status(400).JSON(fiber.Map{"error": "path parameter is required"})
		}
		if err := os.MkdirAll(req.Path, os.ModePerm); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(fiber.Map{"status": "success"})
	})

	app.Post("/api/fs/write", func(c *fiber.Ctx) error {
		var req struct {
			Path    string `json:"path"`
			Content string `json:"content"`
		}
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid payload"})
		}
		if req.Path == "" {
			return c.Status(400).JSON(fiber.Map{"error": "path parameter is required"})
		}
		if err := os.WriteFile(req.Path, []byte(req.Content), 0644); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(fiber.Map{"status": "success"})
	})

	app.Post("/api/fs/rename", func(c *fiber.Ctx) error {
		var req struct {
			OldPath string `json:"old_path"`
			NewPath string `json:"new_path"`
		}
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid payload"})
		}
		if req.OldPath == "" || req.NewPath == "" {
			return c.Status(400).JSON(fiber.Map{"error": "old_path and new_path parameters are required"})
		}

		// Protect root folders from being renamed
		cleanOldPath := filepath.Clean(req.OldPath)
		baseName := filepath.Base(cleanOldPath)
		protectedFolders := []string{"apps", "nodes", "tools", "workspace", "workflows", "models", "brain", "flowork_modules", "connector", "internal", "scripts", "build", "brain_extensions", "runtimes", "store", "FloworkData"}
		
		isProtected := false
		for _, protected := range protectedFolders {
			if cleanOldPath == filepath.Join(EngineDir, protected) || baseName == protected && filepath.Dir(cleanOldPath) == EngineDir {
				isProtected = true
				break
			}
		}

		if isProtected {
			return c.Status(403).JSON(fiber.Map{"error": "Cannot rename root engine folder: " + baseName})
		}

		if err := os.Rename(req.OldPath, req.NewPath); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(fiber.Map{"status": "success"})
	})

	app.Post("/api/ai/chat", func(c *fiber.Ctx) error {
		var req struct {
			Provider string `json:"provider"`
			Model    string `json:"model"`
			ApiKey   string `json:"api_key"`
			Prompt   string `json:"prompt"`
		}
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid payload"})
		}
		if req.Prompt == "" {
			return c.Status(400).JSON(fiber.Map{"error": "Prompt is required"})
		}
		if req.ApiKey == "" {
			return c.Status(400).JSON(fiber.Map{"error": "API Key is missing for cloud provider"})
		}

		provider := strings.ToLower(req.Provider)
		switch provider {
		case "gemini":
			url := "https://generativelanguage.googleapis.com/v1beta/models/" + req.Model + ":generateContent?key=" + req.ApiKey
			payload := map[string]interface{}{
				"contents": []map[string]interface{}{
					{"parts": []map[string]interface{}{{"text": req.Prompt}}},
				},
			}
			jsonPayload, _ := json.Marshal(payload)
			
			resp, err := http.Post(url, "application/json", bytes.NewBuffer(jsonPayload))
			if err != nil {
				return c.Status(500).JSON(fiber.Map{"error": "Failed to reach Gemini: " + err.Error()})
			}
			defer resp.Body.Close()
			
			body, _ := io.ReadAll(resp.Body)
			var gResp map[string]interface{}
			json.Unmarshal(body, &gResp)
			
			if errObj, ok := gResp["error"].(map[string]interface{}); ok {
				return c.Status(int(resp.StatusCode)).JSON(fiber.Map{"error": errObj["message"]})
			}
			
			// Extract text
			var finalResponse = ""
			if cand, ok := gResp["candidates"].([]interface{}); ok && len(cand) > 0 {
				c0 := cand[0].(map[string]interface{})
				if content, ok := c0["content"].(map[string]interface{}); ok {
					if parts, ok := content["parts"].([]interface{}); ok && len(parts) > 0 {
						p0 := parts[0].(map[string]interface{})
						if text, ok := p0["text"].(string); ok {
							finalResponse = text
						}
					}
				}
			}
			return c.JSON(fiber.Map{"status": "success", "result": finalResponse})
		case "openai":
			url := "https://api.openai.com/v1/chat/completions"
			payload := map[string]interface{}{
				"model": req.Model,
				"messages": []map[string]interface{}{
					{"role": "user", "content": req.Prompt},
				},
			}
			jsonPayload, _ := json.Marshal(payload)
			httpReq, _ := http.NewRequest("POST", url, bytes.NewBuffer(jsonPayload))
			httpReq.Header.Set("Authorization", "Bearer " + req.ApiKey)
			httpReq.Header.Set("Content-Type", "application/json")
			
			resp, err := http.DefaultClient.Do(httpReq)
			if err != nil {
				return c.Status(500).JSON(fiber.Map{"error": "Failed to reach OpenAI: " + err.Error()})
			}
			defer resp.Body.Close()
			
			body, _ := io.ReadAll(resp.Body)
			var oResp map[string]interface{}
			json.Unmarshal(body, &oResp)
			if errObj, ok := oResp["error"].(map[string]interface{}); ok {
				return c.Status(int(resp.StatusCode)).JSON(fiber.Map{"error": errObj["message"]})
			}
			
			text := ""
			if choices, ok := oResp["choices"].([]interface{}); ok && len(choices) > 0 {
				c0 := choices[0].(map[string]interface{})
				if msg, ok := c0["message"].(map[string]interface{}); ok {
					text = msg["content"].(string)
				}
			}
			return c.JSON(fiber.Map{"status": "success", "result": text})
		default:
			return c.Status(400).JSON(fiber.Map{"error": "Provider not currently supported through dashboard cloud-proxy: " + provider})
		}
	})

	// ═══════════════════════════════════════════════════════════════
	// REST API: Local Engine Installed Nodes
	// ═══════════════════════════════════════════════════════════════
	app.Get("/api/local-nodes", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"status": "success",
			"data":   nodeManager.ScanNodes(),
		})
	})

	// ═══════════════════════════════════════════════════════════════
	// REST API: AI Software Factory (.EXE Compiler)
	// ═══════════════════════════════════════════════════════════════
	app.Post("/api/compile", func(c *fiber.Ctx) error {
		var req struct {
			ScriptPath string `json:"script_path"`
			AppName    string `json:"app_name"`
		}
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": err.Error()})
		}

		if req.ScriptPath == "" || req.AppName == "" {
			return c.Status(400).JSON(fiber.Map{"error": "script_path and app_name required"})
		}

		// --- SINGLE EXE GUI BUILDER ---

		outDir := filepath.Join("Flowork_Builds")
		os.MkdirAll(outDir, os.ModePerm)
		finalExe := filepath.Join(outDir, req.AppName+".exe")

		ext := strings.ToLower(filepath.Ext(req.ScriptPath))

		// We will create a temporary workspace for the Go launcher
		buildID := fmt.Sprintf("build_%d", time.Now().UnixNano())
		workDir := filepath.Join(outDir, buildID)
		os.MkdirAll(workDir, os.ModePerm)
		defer os.RemoveAll(workDir)

		payloadName := "payload.exe"
		payloadPath := filepath.Join(workDir, payloadName)

		switch ext {
		case ".js":
			originalCode, err := os.ReadFile(req.ScriptPath)
			if err != nil {
				return c.Status(500).JSON(fiber.Map{"error": "Failed to read script file: " + err.Error()})
			}
			// Disable original AI "start http" to prevent double windows
			sanitizedCode := regexp.MustCompile("(?i)exec\\(['\"]start http.*['\"]\\)").ReplaceAllString(string(originalCode), "// [Removed by Flowork Compiler]")

			// Inject Splash and Chrome App Mode
			magicUI := `
		setTimeout(() => {
			const _cp = require('child_process');
			const _path = require('path');
			const _os = require('os');
			const _fs = require('fs');

			// Enterprise logic - show splash
			const splashHtml = ` + "`" + `<html><body style="margin:0;overflow:hidden;background:#1A1A2E;color:#00D2FF;display:flex;justify-content:center;align-items:center;font-family:sans-serif;flex-direction:column;">
				<h1 style="font-size:3rem;margin:0;">FLOWORK OS</h1>
				<p>Initializing ` + req.AppName + `...</p>
			</body></html>` + "`" + `;

			const tmpSplash = _path.join(_os.tmpdir(), "flowork_splash_" + Date.now() + ".html");
			_fs.writeFileSync(tmpSplash, splashHtml);

			const isEnterprise = false; // "kalau levelnya bukan entriprice harus ada splash"
			if (!isEnterprise) {
				_cp.exec('start msedge --app="file:///' + tmpSplash.replace(/\\/g, '/') + '"');
			}

			// Assume AI runs server on port 3000 or grabs process.env.PORT
			// Look for real port by listening or fallback
			const targetPort = process.env.PORT || 3000;

			setTimeout(() => {
				// Open real app in Chrome App Mode (frameless)
				_cp.exec('start msedge --app=http://127.0.0.1:' + targetPort);
				// Clean splash
				setTimeout(() => {
					try { _fs.unlinkSync(tmpSplash); } catch(e){}
				}, 2000);
			}, 3000);
		}, 1000);
		`
			watermarkedPath := req.ScriptPath + ".flowork.js"
			os.WriteFile(watermarkedPath, []byte(magicUI + sanitizedCode), 0644)
			defer os.Remove(watermarkedPath)

			// Compile Node script to payload
			pkgCmd := exec.Command("npx", "pkg", watermarkedPath, "--targets", "node18-win-x64", "--output", payloadPath)
			pkgCmd.Dir = "."
			if out, err := pkgCmd.CombinedOutput(); err != nil {
				return c.Status(500).JSON(fiber.Map{"error": "PKG Compilation Failed:\n" + string(out)})
			}

		case ".py":
			pyCmd := exec.Command("pyinstaller", "--onefile", "--noconsole", "--noconfirm", "--distpath", workDir, "--name", "payload", req.ScriptPath)
			pyCmd.Dir = "."
			if out, err := pyCmd.CombinedOutput(); err != nil {
				return c.Status(500).JSON(fiber.Map{"error": "PyInstaller Compilation Failed:\n" + string(out)})
			}
			// PyInstaller creates payload.exe directly since we use --name payload

		case ".go":
			goCmd := exec.Command("go", "build", "-ldflags", "-H=windowsgui", "-o", payloadPath, req.ScriptPath)
			goCmd.Dir = "."
			if out, err := goCmd.CombinedOutput(); err != nil {
				return c.Status(500).JSON(fiber.Map{"error": "Go Compilation Failed:\n" + string(out)})
			}

		case ".cpp", ".c":
			cppCmd := exec.Command("g++", req.ScriptPath, "-o", payloadPath, "-O3", "-static", "-mwindows")
			cppCmd.Dir = "."
			if out, err := cppCmd.CombinedOutput(); err != nil {
				return c.Status(500).JSON(fiber.Map{"error": "C++ Compilation Failed:\n" + string(out)})
			}
		default:
			return c.Status(400).JSON(fiber.Map{"error": "Unsupported file extension for compilation: " + ext})
		}

		// Ensure payload exists
		if _, err := os.Stat(payloadPath); os.IsNotExist(err) {
			return c.Status(500).JSON(fiber.Map{"error": "Payload was not generated successfully."})
		}

		// 7. Write the Go Wrapper that embeds the payload
		launcherCode := fmt.Sprintf(`package main

import (
	_ "embed"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
)

//go:embed payload.exe
var payload []byte

func main() {
	tmpDir := os.TempDir()
	pidDir := filepath.Join(tmpDir, "flowork_apps")
	os.MkdirAll(pidDir, 0755)

	exePath := filepath.Join(pidDir, "%s_runtime.exe")
	os.WriteFile(exePath, payload, 0777)

	cmd := exec.Command(exePath)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	cmd.Start()
}
`, req.AppName)
		os.WriteFile(filepath.Join(workDir, "launcher.go"), []byte(launcherCode), 0644)

		// Initialize go.mod if not present
		exec.Command("go", "mod", "init", "launcher").Dir = workDir

		// Build the tiny GUI launcher
		buildCmd := exec.Command("go", "build", "-ldflags", "-s -w -H=windowsgui", "-o", finalExe, "launcher.go")
		buildCmd.Dir = workDir

		if out, buildErr := buildCmd.CombinedOutput(); buildErr != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Launcher Compilation Failed:\n" + string(out)})
		}

		return c.JSON(fiber.Map{
			"status": "success",
			"compiled_file": finalExe,
		})
	})

	// ═══════════════════════════════════════════════════════════════
	// REST API: P2P AI Swarm Dispatch
	// ═══════════════════════════════════════════════════════════════
	app.Post("/api/p2p/dispatch", func(c *fiber.Ctx) error {
		var req struct {
			TargetPeers []string `json:"target_peers"` // empty = broadcast to ALL
			Script      string   `json:"script"`
			TaskType    string   `json:"task_type"` // "browser_script", "capture", "run_command"
		}
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": err.Error()})
		}

		if req.Script == "" && req.TaskType == "" {
			return c.Status(400).JSON(fiber.Map{"error": "script or task_type required"})
		}

		// Broadcast the swarm command via Socket.IO to all connected peers
		payload := map[string]interface{}{
			"task_type": req.TaskType,
			"script":    req.Script,
			"targets":   req.TargetPeers,
		}
		socketHandler.BroadcastSwarmTask(payload)

		return c.JSON(fiber.Map{
			"status":  "dispatched",
			"message": fmt.Sprintf("Swarm task '%s' broadcast to %d target peers", req.TaskType, len(req.TargetPeers)),
		})
	})

	// ═══════════════════════════════════════════════════════════════
	// REST API: Workflow CRUD & Execution
	// ═══════════════════════════════════════════════════════════════
	app.Post("/api/workflow/save", func(c *fiber.Ctx) error {
		var wf workflow.Workflow
		if err := c.BodyParser(&wf); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid workflow JSON: " + err.Error()})
		}
		if err := wfStore.Save(&wf); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(fiber.Map{"status": "success", "id": wf.ID})
	})

	app.Get("/api/workflow/list", func(c *fiber.Ctx) error {
		list, _ := wfStore.List()
		return c.JSON(fiber.Map{"status": "success", "data": list})
	})

	app.Get("/api/workflow/:id", func(c *fiber.Ctx) error {
		wf, err := wfStore.Load(c.Params("id"))
		if err != nil {
			return c.Status(404).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(fiber.Map{"status": "success", "data": wf})
	})

	app.Delete("/api/workflow/:id", func(c *fiber.Ctx) error {
		scheduler.DeactivateWorkflow(c.Params("id"))
		if err := wfStore.Delete(c.Params("id")); err != nil {
			return c.Status(404).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(fiber.Map{"status": "success"})
	})

	app.Post("/api/workflow/execute", func(c *fiber.Ctx) error {
		var wf workflow.Workflow
		if err := c.BodyParser(&wf); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid workflow JSON"})
		}
		result := wfRunner.Execute(&wf, "manual", nil)
		execHistory.Save(result)
		return c.JSON(fiber.Map{"status": "success", "data": result})
	})

	app.Post("/api/workflow/execute/:id", func(c *fiber.Ctx) error {
		wf, err := wfStore.Load(c.Params("id"))
		if err != nil {
			return c.Status(404).JSON(fiber.Map{"error": err.Error()})
		}
		result := wfRunner.Execute(wf, "manual", nil)
		execHistory.Save(result)
		return c.JSON(fiber.Map{"status": "success", "data": result})
	})

	app.Post("/api/workflow/activate/:id", func(c *fiber.Ctx) error {
		wf, err := wfStore.Load(c.Params("id"))
		if err != nil {
			return c.Status(404).JSON(fiber.Map{"error": err.Error()})
		}
		wf.Active = true
		wfStore.Save(wf)

		// Register all native N8N webhook trigger paths
		for _, path := range trigger.GetWebhookPaths(wf) {
			webhookMgr.RegisterWebhook(path, wf.ID)
		}

		// Legacy Flowork Cron/Interval
		if wf.Trigger != nil && wf.Trigger.Type != "webhook" {
			scheduler.ActivateWorkflow(wf.ID)
		}

		return c.JSON(fiber.Map{"status": "success", "message": "Workflow activated"})
	})

	app.Post("/api/workflow/deactivate/:id", func(c *fiber.Ctx) error {
		wf, err := wfStore.Load(c.Params("id"))
		if err != nil {
			return c.Status(404).JSON(fiber.Map{"error": err.Error()})
		}
		wf.Active = false
		wfStore.Save(wf)
		scheduler.DeactivateWorkflow(wf.ID)

		// Unregister all native N8N webhook trigger paths
		for _, path := range trigger.GetWebhookPaths(wf) {
			webhookMgr.UnregisterWebhook(path)
		}

		return c.JSON(fiber.Map{"status": "success", "message": "Workflow deactivated"})
	})

	// ═══════════════════════════════════════════════════════════════
	// REST API: Credentials Vault
	// ═══════════════════════════════════════════════════════════════
	app.Post("/api/credentials", func(c *fiber.Ctx) error {
		var cred vault.Credential
		if err := c.BodyParser(&cred); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid credential JSON"})
		}
		if err := credVault.Save(&cred); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(fiber.Map{"status": "success", "id": cred.ID})
	})

	app.Get("/api/credentials", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"status": "success", "data": credVault.List()})
	})

	app.Get("/api/credentials/:id", func(c *fiber.Ctx) error {
		cred, err := credVault.Get(c.Params("id"))
		if err != nil {
			return c.Status(404).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(fiber.Map{"status": "success", "data": cred})
	})

	app.Delete("/api/credentials/:id", func(c *fiber.Ctx) error {
		if err := credVault.Delete(c.Params("id")); err != nil {
			return c.Status(404).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(fiber.Map{"status": "success"})
	})

	// ═══════════════════════════════════════════════════════════════
	// REST API: Execution History
	// ═══════════════════════════════════════════════════════════════
	app.Get("/api/executions", func(c *fiber.Ctx) error {
		workflowID := c.Query("workflow_id")
		var execs []workflow.Execution
		if workflowID != "" {
			execs, _ = execHistory.GetByWorkflow(workflowID, 100)
		} else {
			execs, _ = execHistory.GetAll(100)
		}
		return c.JSON(fiber.Map{"status": "success", "data": execs})
	})

	app.Get("/api/executions/stats", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"status": "success", "data": execHistory.GetStats()})
	})

	app.Get("/api/executions/:id", func(c *fiber.Ctx) error {
		exec, err := execHistory.Get(c.Params("id"))
		if err != nil {
			return c.Status(404).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(fiber.Map{"status": "success", "data": exec})
	})

	// ═══════════════════════════════════════════════════════════════
	// REST API: Global Variables
	// ═══════════════════════════════════════════════════════════════
	app.Get("/api/variables", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"status": "success", "data": envStore.GetAll()})
	})

	app.Post("/api/variables", func(c *fiber.Ctx) error {
		var body map[string]string
		if err := c.BodyParser(&body); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
		}
		for k, v := range body {
			envStore.Set(k, v)
		}
		return c.JSON(fiber.Map{"status": "success"})
	})

	app.Delete("/api/variables/:key", func(c *fiber.Ctx) error {
		if err := envStore.Delete(c.Params("key")); err != nil {
			return c.Status(404).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(fiber.Map{"status": "success"})
	})

	// ═══════════════════════════════════════════════════════════════
	// REST API: AI Progress Log (Goal 1 — Persistent Task Tracking)
	// ═══════════════════════════════════════════════════════════════
	progressLogDir := filepath.Join(EngineDir, "FloworkData", "progress_logs")
	os.MkdirAll(progressLogDir, os.ModePerm)

	app.Post("/api/progress-log", func(c *fiber.Ctx) error {
		type ProgressEntry struct {
			AppID      string      `json:"app_id"`
			OutputType string      `json:"output_type"`
			Entry      interface{} `json:"entry"`
		}
		var req ProgressEntry
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"status": "error", "error": "Invalid JSON"})
		}
		if req.AppID == "" {
			return c.Status(400).JSON(fiber.Map{"status": "error", "error": "Missing app_id"})
		}

		logFile := filepath.Join(progressLogDir, req.AppID+".json")
		var entries []interface{}
		if data, err := os.ReadFile(logFile); err == nil {
			json.Unmarshal(data, &entries)
		}
		entries = append(entries, req.Entry)

		// Keep max 200 entries
		if len(entries) > 200 {
			entries = entries[len(entries)-200:]
		}

		jsonBytes, _ := json.MarshalIndent(entries, "", "  ")
		os.WriteFile(logFile, jsonBytes, 0644)

		log.Printf("[AI-Progress] 📋 Logged progress for %s (%d entries)\n", req.AppID, len(entries))
		return c.JSON(fiber.Map{"status": "success", "total_entries": len(entries)})
	})

	app.Get("/api/progress-log", func(c *fiber.Ctx) error {
		appID := c.Query("app_id")
		if appID == "" {
			return c.Status(400).JSON(fiber.Map{"status": "error", "error": "Missing app_id"})
		}
		logFile := filepath.Join(progressLogDir, appID+".json")
		data, err := os.ReadFile(logFile)
		if err != nil {
			return c.JSON(fiber.Map{"status": "success", "entries": []interface{}{}, "total": 0})
		}
		var entries []interface{}
		json.Unmarshal(data, &entries)
		return c.JSON(fiber.Map{"status": "success", "entries": entries, "total": len(entries)})
	})

	// ═══════════════════════════════════════════════════════════════
	// REST API: Crash History (Goal 5 — Persistent Debug Logs)
	// ═══════════════════════════════════════════════════════════════
	crashLogFile := filepath.Join(EngineDir, "FloworkData", "crash_log.json")

	app.Post("/api/crash-history", func(c *fiber.Ctx) error {
		type CrashEntry struct {
			Timestamp string `json:"timestamp"`
			Stack     string `json:"stack"`
			Source    string `json:"source"`
		}
		var req CrashEntry
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"status": "error", "error": "Invalid JSON"})
		}

		var entries []interface{}
		if data, err := os.ReadFile(crashLogFile); err == nil {
			json.Unmarshal(data, &entries)
		}

		entryMap := map[string]string{
			"timestamp": req.Timestamp,
			"stack":     req.Stack,
			"source":    req.Source,
		}
		entries = append(entries, entryMap)

		// Keep max 100 crash entries
		if len(entries) > 100 {
			entries = entries[len(entries)-100:]
		}

		jsonBytes, _ := json.MarshalIndent(entries, "", "  ")
		os.WriteFile(crashLogFile, jsonBytes, 0644)

		log.Printf("[Crash-History] 💥 Crash logged from: %s\n", req.Source)
		return c.JSON(fiber.Map{"status": "success", "total": len(entries)})
	})

	app.Get("/api/crash-history", func(c *fiber.Ctx) error {
		data, err := os.ReadFile(crashLogFile)
		if err != nil {
			return c.JSON(fiber.Map{"status": "success", "entries": []interface{}{}, "total": 0})
		}
		var entries []interface{}
		json.Unmarshal(data, &entries)
		return c.JSON(fiber.Map{"status": "success", "entries": entries, "total": len(entries)})
	})

	// ═══════════════════════════════════════════════════════════════
	// REST API: Engine Logs (Goal 5 — AI Can Read Engine State)
	// ═══════════════════════════════════════════════════════════════
	var engineLogBuffer []map[string]string
	var engineLogMutex = &sync.Mutex{}

	// Intercept engine logs into a ring buffer
	go func() {
		// This is already captured by the log system, we expose what we have
		log.Println("[Engine] 📝 Engine log buffer initialized for AI access.")
	}()

	app.Get("/api/engine-logs", func(c *fiber.Ctx) error {
		engineLogMutex.Lock()
		defer engineLogMutex.Unlock()
		return c.JSON(fiber.Map{
			"status": "success",
			"logs":   engineLogBuffer,
			"total":  len(engineLogBuffer),
			"engine_version": CurrentEngineVersion,
			"engine_dir":     EngineDir,
			"user_tier":      UserTier,
		})
	})

	// ═══════════════════════════════════════════════════════════════
	// REST API: Workflow Update (Goal 4 — Update Existing Workflows)
	// ═══════════════════════════════════════════════════════════════
	app.Patch("/api/workflow/:id", func(c *fiber.Ctx) error {
		wfID := c.Params("id")
		existing, err := wfStore.Load(wfID)
		if err != nil {
			return c.Status(404).JSON(fiber.Map{"error": "Workflow not found: " + wfID})
		}

		// Parse partial update
		var patch map[string]interface{}
		if err := c.BodyParser(&patch); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON: " + err.Error()})
		}

		// Apply patches to the existing workflow
		if name, ok := patch["name"].(string); ok {
			existing.Name = name
		}
		if active, ok := patch["active"].(bool); ok {
			existing.Active = active
		}

		// For nodes and connections, marshal/unmarshal to properly update
		if nodesRaw, ok := patch["nodes"]; ok {
			nodesBytes, _ := json.Marshal(nodesRaw)
			json.Unmarshal(nodesBytes, &existing.Nodes)
		}
		if connRaw, ok := patch["connections"]; ok {
			connBytes, _ := json.Marshal(connRaw)
			json.Unmarshal(connBytes, &existing.Connections)
		}
		// Also accept "edges" as alias for "connections" (AI-friendly)
		if edgesRaw, ok := patch["edges"]; ok {
			edgesBytes, _ := json.Marshal(edgesRaw)
			json.Unmarshal(edgesBytes, &existing.Connections)
		}

		if err := wfStore.Save(existing); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}

		log.Printf("[Workflow] 📝 Updated workflow: %s (%s)\n", existing.Name, wfID)
		return c.JSON(fiber.Map{"status": "success", "id": wfID, "message": "Workflow updated"})
	})

	// ═══════════════════════════════════════════════════════════════
	// UPGRADE #3: SMART DIFFING ENGINE (Line-Based Patching)
	// ═══════════════════════════════════════════════════════════════
	app.Post("/api/ai-smart-patch", func(c *fiber.Ctx) error {
		type PatchChunk struct {
			StartLine   int    `json:"start_line"`
			EndLine     int    `json:"end_line"`
			Replacement string `json:"replacement"`
		}
		type SmartPatchReq struct {
			AppID      string       `json:"app_id"`
			OutputType string       `json:"output_type"`
			File       string       `json:"file"`
			Patches    []PatchChunk `json:"patches"`
		}
		var req SmartPatchReq
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"status": "error", "error": "Invalid JSON: " + err.Error()})
		}
		if req.AppID == "" || req.File == "" || len(req.Patches) == 0 {
			return c.Status(400).JSON(fiber.Map{"status": "error", "error": "Missing app_id, file, or patches"})
		}

		baseDir := filepath.Join(EngineDir, "apps")
		if req.OutputType == "node" {
			baseDir = filepath.Join(EngineDir, "nodes")
		}
		safeName := filepath.Base(req.File)
		filePath := filepath.Join(baseDir, req.AppID, safeName)

		content, err := os.ReadFile(filePath)
		if err != nil {
			return c.Status(404).JSON(fiber.Map{"status": "error", "error": "File not found: " + safeName})
		}

		lines := strings.Split(string(content), "\n")

		// Sort patches by start_line DESCENDING so we apply from bottom-up (no index shifting)
		sort.Slice(req.Patches, func(i, j int) bool {
			return req.Patches[i].StartLine > req.Patches[j].StartLine
		})

		for _, p := range req.Patches {
			start := p.StartLine - 1 // Convert to 0-indexed
			end := p.EndLine         // EndLine is inclusive, so we slice up to end
			if start < 0 {
				start = 0
			}
			if end > len(lines) {
				end = len(lines)
			}
			replacementLines := strings.Split(p.Replacement, "\n")
			newLines := make([]string, 0, len(lines)-end+start+len(replacementLines))
			newLines = append(newLines, lines[:start]...)
			newLines = append(newLines, replacementLines...)
			newLines = append(newLines, lines[end:]...)
			lines = newLines
		}

		result := strings.Join(lines, "\n")
		if err := os.WriteFile(filePath, []byte(result), 0644); err != nil {
			return c.Status(500).JSON(fiber.Map{"status": "error", "error": "Failed to write: " + err.Error()})
		}

		log.Printf("[Smart-Patch] ✅ Applied %d patches to %s/%s\n", len(req.Patches), req.AppID, safeName)
		return c.JSON(fiber.Map{
			"status":        "success",
			"file":          safeName,
			"patches_count": len(req.Patches),
			"total_lines":   len(lines),
		})
	})

	// ═══════════════════════════════════════════════════════════════
	// UPGRADE #8: PROJECT-WIDE CONTEXT WINDOW
	// ═══════════════════════════════════════════════════════════════
	app.Get("/api/ai-context/:type/:id", func(c *fiber.Ctx) error {
		readType := c.Params("type")
		appID := c.Params("id")
		if readType != "apps" && readType != "nodes" {
			return c.Status(400).JSON(fiber.Map{"status": "error", "error": "Type must be 'apps' or 'nodes'"})
		}

		targetDir := filepath.Join(EngineDir, readType, appID)
		entries, err := os.ReadDir(targetDir)
		if err != nil {
			return c.Status(404).JSON(fiber.Map{"status": "error", "error": "Not found: " + appID})
		}

		binaryExts := map[string]bool{".webp": true, ".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".flow": true, ".nflow": true, ".exe": true, ".dll": true, ".wasm": true}

		var context strings.Builder
		context.WriteString(fmt.Sprintf("=== PROJECT CONTEXT: %s ===\n", appID))
		context.WriteString(fmt.Sprintf("Type: %s\n", readType))
		context.WriteString("Files:\n")

		fileList := []string{}
		for _, e := range entries {
			if !e.IsDir() {
				fileList = append(fileList, e.Name())
				context.WriteString(fmt.Sprintf("  - %s\n", e.Name()))
			}
		}
		context.WriteString(fmt.Sprintf("Total: %d files\n\n", len(fileList)))

		totalChars := 0
		maxChars := 80000

		for _, name := range fileList {
			ext := strings.ToLower(filepath.Ext(name))
			if binaryExts[ext] {
				context.WriteString(fmt.Sprintf("--- %s [BINARY - SKIPPED] ---\n\n", name))
				continue
			}

			data, err := os.ReadFile(filepath.Join(targetDir, name))
			if err != nil {
				continue
			}

			fileContent := string(data)
			if totalChars+len(fileContent) > maxChars {
				remaining := maxChars - totalChars
				if remaining > 500 {
					context.WriteString(fmt.Sprintf("--- %s (TRUNCATED at %d chars) ---\n", name, remaining))
					context.WriteString(fileContent[:remaining])
					context.WriteString("\n... [TRUNCATED]\n\n")
				}
				break
			}

			context.WriteString(fmt.Sprintf("--- %s ---\n", name))
			context.WriteString(fileContent)
			context.WriteString("\n\n")
			totalChars += len(fileContent)
		}

		return c.JSON(fiber.Map{
			"status":      "success",
			"app_id":      appID,
			"context":     context.String(),
			"total_files": len(fileList),
			"total_chars": totalChars,
		})
	})

	// ═══════════════════════════════════════════════════════════════
	// UPGRADE #1: PERSISTENT KNOWLEDGE SYSTEM
	// ═══════════════════════════════════════════════════════════════
	knowledgeDir := filepath.Join(EngineDir, "FloworkData", "memory_bank")
	os.MkdirAll(knowledgeDir, os.ModePerm)

	app.Post("/api/knowledge", func(c *fiber.Ctx) error {
		type KnowledgeItem struct {
			ID        string `json:"id"`
			Title     string `json:"title"`
			Content   string `json:"content"`
			Category  string `json:"category"`
			CreatedAt string `json:"created_at"`
		}
		var req KnowledgeItem
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"status": "error", "error": "Invalid JSON"})
		}
		if req.Title == "" || req.Content == "" {
			return c.Status(400).JSON(fiber.Map{"status": "error", "error": "Missing title or content"})
		}
		if req.ID == "" {
			req.ID = fmt.Sprintf("ki_%d", time.Now().UnixNano())
		}
		if req.CreatedAt == "" {
			req.CreatedAt = time.Now().Format(time.RFC3339)
		}

		filePath := filepath.Join(knowledgeDir, req.ID+".json")
		data, _ := json.MarshalIndent(req, "", "  ")
		os.WriteFile(filePath, data, 0644)

		log.Printf("[Knowledge] 🧠 Saved: %s — %s\n", req.ID, req.Title)
		return c.JSON(fiber.Map{"status": "success", "id": req.ID})
	})

	app.Get("/api/knowledge", func(c *fiber.Ctx) error {
		entries, err := os.ReadDir(knowledgeDir)
		if err != nil {
			return c.JSON(fiber.Map{"status": "success", "items": []interface{}{}, "total": 0})
		}

		items := make([]map[string]interface{}, 0)
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
				continue
			}
			data, err := os.ReadFile(filepath.Join(knowledgeDir, e.Name()))
			if err != nil {
				continue
			}
			var item map[string]interface{}
			if json.Unmarshal(data, &item) == nil {
				items = append(items, item)
			}
		}

		return c.JSON(fiber.Map{"status": "success", "items": items, "total": len(items)})
	})

	app.Get("/api/knowledge/:id", func(c *fiber.Ctx) error {
		kiID := c.Params("id")
		filePath := filepath.Join(knowledgeDir, kiID+".json")
		data, err := os.ReadFile(filePath)
		if err != nil {
			return c.Status(404).JSON(fiber.Map{"status": "error", "error": "Knowledge item not found"})
		}
		var item map[string]interface{}
		json.Unmarshal(data, &item)
		return c.JSON(fiber.Map{"status": "success", "item": item})
	})

	app.Delete("/api/knowledge/:id", func(c *fiber.Ctx) error {
		kiID := c.Params("id")
		filePath := filepath.Join(knowledgeDir, kiID+".json")
		if err := os.Remove(filePath); err != nil {
			return c.Status(404).JSON(fiber.Map{"status": "error", "error": "Not found"})
		}
		return c.JSON(fiber.Map{"status": "success"})
	})

	// ═══════════════════════════════════════════════════════════════
	// UPGRADE #5: REAL TERMINAL WITH STREAMING
	// ═══════════════════════════════════════════════════════════════
	type TermSession struct {
		Cmd    *exec.Cmd
		Stdin  io.WriteCloser
		Output []string
		Status string // "running", "done", "error"
		mu     sync.Mutex
	}
	termSessions := make(map[string]*TermSession)
	var termMu sync.Mutex

	app.Post("/api/terminal/start", func(c *fiber.Ctx) error {
		var req struct {
			SessionID string `json:"session_id"`
			Command   string `json:"command"`
			AppID     string `json:"app_id"`
			OutputType string `json:"output_type"`
		}
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"status": "error", "error": "Invalid JSON"})
		}
		if req.Command == "" {
			return c.Status(400).JSON(fiber.Map{"status": "error", "error": "Missing command"})
		}
		if req.SessionID == "" {
			req.SessionID = fmt.Sprintf("term_%d", time.Now().UnixNano())
		}

		workDir := EngineDir
		if req.AppID != "" {
			base := "apps"
			if req.OutputType == "node" {
				base = "nodes"
			}
			workDir = filepath.Join(EngineDir, base, req.AppID)
		}

		var cmd *exec.Cmd
		if runtime.GOOS == "windows" {
			cmd = exec.Command("cmd", "/c", req.Command)
		} else {
			cmd = exec.Command("sh", "-c", req.Command)
		}
		cmd.Dir = workDir

		stdin, _ := cmd.StdinPipe()
		stdout, _ := cmd.StdoutPipe()
		stderr, _ := cmd.StderrPipe()

		sess := &TermSession{
			Cmd:    cmd,
			Stdin:  stdin,
			Output: []string{},
			Status: "running",
		}

		if err := cmd.Start(); err != nil {
			return c.Status(500).JSON(fiber.Map{"status": "error", "error": "Failed to start: " + err.Error()})
		}

		termMu.Lock()
		termSessions[req.SessionID] = sess
		termMu.Unlock()

		// Read stdout in goroutine
		go func() {
			scanner := bufio.NewScanner(stdout)
			for scanner.Scan() {
				sess.mu.Lock()
				sess.Output = append(sess.Output, scanner.Text())
				if len(sess.Output) > 500 {
					sess.Output = sess.Output[len(sess.Output)-500:]
				}
				sess.mu.Unlock()
			}
		}()

		// Read stderr in goroutine
		go func() {
			scanner := bufio.NewScanner(stderr)
			for scanner.Scan() {
				sess.mu.Lock()
				sess.Output = append(sess.Output, "[STDERR] "+scanner.Text())
				if len(sess.Output) > 500 {
					sess.Output = sess.Output[len(sess.Output)-500:]
				}
				sess.mu.Unlock()
			}
		}()

		// Wait for completion in goroutine
		go func() {
			err := cmd.Wait()
			sess.mu.Lock()
			if err != nil {
				sess.Status = "error"
				sess.Output = append(sess.Output, "[EXIT] "+err.Error())
			} else {
				sess.Status = "done"
				sess.Output = append(sess.Output, "[EXIT] Process completed successfully")
			}
			sess.mu.Unlock()
		}()

		log.Printf("[Terminal] 💻 Started session %s: %s\n", req.SessionID, req.Command)
		return c.JSON(fiber.Map{"status": "success", "session_id": req.SessionID})
	})

	app.Get("/api/terminal/status/:id", func(c *fiber.Ctx) error {
		id := c.Params("id")
		termMu.Lock()
		sess, exists := termSessions[id]
		termMu.Unlock()
		if !exists {
			return c.Status(404).JSON(fiber.Map{"status": "error", "error": "Session not found"})
		}

		sess.mu.Lock()
		lines := make([]string, len(sess.Output))
		copy(lines, sess.Output)
		status := sess.Status
		sess.mu.Unlock()

		// Return last N lines
		lastN := 50
		if len(lines) > lastN {
			lines = lines[len(lines)-lastN:]
		}

		return c.JSON(fiber.Map{
			"status":         "success",
			"session_status": status,
			"output":         strings.Join(lines, "\n"),
			"total_lines":    len(lines),
		})
	})

	app.Post("/api/terminal/input/:id", func(c *fiber.Ctx) error {
		id := c.Params("id")
		var req struct {
			Input string `json:"input"`
		}
		c.BodyParser(&req)

		termMu.Lock()
		sess, exists := termSessions[id]
		termMu.Unlock()
		if !exists {
			return c.Status(404).JSON(fiber.Map{"status": "error", "error": "Session not found"})
		}

		if sess.Stdin != nil {
			sess.Stdin.Write([]byte(req.Input))
		}
		return c.JSON(fiber.Map{"status": "success"})
	})

	app.Post("/api/terminal/kill/:id", func(c *fiber.Ctx) error {
		id := c.Params("id")
		termMu.Lock()
		sess, exists := termSessions[id]
		termMu.Unlock()
		if !exists {
			return c.Status(404).JSON(fiber.Map{"status": "error", "error": "Session not found"})
		}

		if sess.Cmd != nil && sess.Cmd.Process != nil {
			sess.Cmd.Process.Kill()
		}
		sess.mu.Lock()
		sess.Status = "killed"
		sess.mu.Unlock()

		return c.JSON(fiber.Map{"status": "success", "message": "Process killed"})
	})

	// ═══════════════════════════════════════════════════════════════
	// UPGRADE #9: SMART WEB RESEARCH (URL Reader)
	// ═══════════════════════════════════════════════════════════════
	app.Post("/api/web/read", func(c *fiber.Ctx) error {
		var req struct {
			URL string `json:"url"`
		}
		if err := c.BodyParser(&req); err != nil || req.URL == "" {
			return c.Status(400).JSON(fiber.Map{"status": "error", "error": "Missing url"})
		}

		client := &http.Client{Timeout: 15 * time.Second}
		httpReq, _ := http.NewRequest("GET", req.URL, nil)
		httpReq.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36")

		resp, err := client.Do(httpReq)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"status": "error", "error": "Fetch failed: " + err.Error()})
		}
		defer resp.Body.Close()

		bodyBytes, err := io.ReadAll(io.LimitReader(resp.Body, 500*1024)) // Max 500KB
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"status": "error", "error": "Read failed: " + err.Error()})
		}

		bodyText := string(bodyBytes)
		// Strip HTML tags to get clean text
		re := regexp.MustCompile(`<script[^>]*>[\s\S]*?</script>`)
		bodyText = re.ReplaceAllString(bodyText, "")
		re = regexp.MustCompile(`<style[^>]*>[\s\S]*?</style>`)
		bodyText = re.ReplaceAllString(bodyText, "")
		re = regexp.MustCompile(`<[^>]+>`)
		bodyText = re.ReplaceAllString(bodyText, " ")
		re = regexp.MustCompile(`\s+`)
		bodyText = re.ReplaceAllString(bodyText, " ")
		bodyText = strings.TrimSpace(bodyText)

		// Truncate if too long
		if len(bodyText) > 30000 {
			bodyText = bodyText[:30000] + "\n... [TRUNCATED]"
		}

		log.Printf("[Web-Read] 🌐 Fetched %s (%d chars)\n", req.URL, len(bodyText))
		return c.JSON(fiber.Map{
			"status":  "success",
			"url":     req.URL,
			"content": bodyText,
			"length":  len(bodyText),
		})
	})

	// ═══════════════════════════════════════════════════════════════
	// UPGRADE #7: GIT INTEGRATION
	// ═══════════════════════════════════════════════════════════════
	app.Post("/api/git", func(c *fiber.Ctx) error {
		var req struct {
			AppID      string   `json:"app_id"`
			OutputType string   `json:"output_type"`
			Action     string   `json:"action"`
			Args       []string `json:"args"`
			Message    string   `json:"message"`
		}
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"status": "error", "error": "Invalid JSON"})
		}
		if req.Action == "" {
			return c.Status(400).JSON(fiber.Map{"status": "error", "error": "Missing action"})
		}

		baseDir := filepath.Join(EngineDir, "apps")
		if req.OutputType == "node" {
			baseDir = filepath.Join(EngineDir, "nodes")
		}
		targetDir := baseDir
		if req.AppID != "" {
			targetDir = filepath.Join(baseDir, req.AppID)
		}

		var gitArgs []string
		switch req.Action {
		case "init":
			gitArgs = []string{"init"}
		case "status":
			gitArgs = []string{"status", "--short"}
		case "diff":
			gitArgs = []string{"diff"}
		case "log":
			count := "10"
			if len(req.Args) > 0 {
				count = req.Args[0]
			}
			gitArgs = []string{"log", "--oneline", "-n", count}
		case "add":
			gitArgs = []string{"add", "."}
		case "commit":
			msg := req.Message
			if msg == "" {
				msg = "AI auto-commit"
			}
			gitArgs = []string{"commit", "-m", msg}
		case "revert":
			if len(req.Args) == 0 {
				return c.Status(400).JSON(fiber.Map{"status": "error", "error": "Missing file to revert"})
			}
			gitArgs = append([]string{"checkout", "--"}, req.Args...)
		default:
			return c.Status(400).JSON(fiber.Map{"status": "error", "error": "Unknown git action: " + req.Action})
		}

		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		cmd := exec.CommandContext(ctx, "git", gitArgs...)
		cmd.Dir = targetDir
		out, err := cmd.CombinedOutput()

		errMsg := ""
		if err != nil {
			errMsg = err.Error()
		}

		log.Printf("[Git] 📦 %s in %s: %s\n", req.Action, req.AppID, strings.TrimSpace(string(out)))
		return c.JSON(fiber.Map{
			"status":  "success",
			"action":  req.Action,
			"output":  string(out),
			"error":   errMsg,
		})
	})

	// ═══════════════════════════════════════════════════════════════
	// CLAUDE CODE PARITY: MCP (Model Context Protocol) Server Manager
	// ═══════════════════════════════════════════════════════════════
	type MCPServer struct {
		Cmd    *exec.Cmd
		Stdin  io.WriteCloser
		Stdout io.ReadCloser
		Status string
		Tools  []map[string]interface{}
	}
	mcpServers := make(map[string]*MCPServer)
	var mcpMu sync.Mutex

	app.Post("/api/mcp/connect", func(c *fiber.Ctx) error {
		var req struct {
			ServerID string            `json:"server_id"`
			Command  string            `json:"command"`
			Args     []string          `json:"args"`
			URL      string            `json:"url"`
			Type     string            `json:"type"`
			Env      map[string]string `json:"env"`
		}
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"status": "error", "error": "Invalid JSON"})
		}
		if req.ServerID == "" || (req.Command == "" && req.URL == "") {
			return c.Status(400).JSON(fiber.Map{"status": "error", "error": "Missing server_id and command/url"})
		}

		if req.Type == "stdio" || req.Type == "" {
			args := append([]string{}, req.Args...)
			cmd := exec.Command(req.Command, args...)
			cmd.Dir = EngineDir
			for k, v := range req.Env {
				cmd.Env = append(os.Environ(), k+"="+v)
			}

			stdin, _ := cmd.StdinPipe()
			stdout, _ := cmd.StdoutPipe()

			if err := cmd.Start(); err != nil {
				return c.Status(500).JSON(fiber.Map{"status": "error", "error": "Failed to start MCP server: " + err.Error()})
			}

			mcpSrv := &MCPServer{Cmd: cmd, Stdin: stdin, Stdout: stdout, Status: "connected", Tools: []map[string]interface{}{}}

			// Send initialize request via MCP protocol (JSON-RPC)
			initReq := `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"flowork","version":"1.0.0"}}}` + "\n"
			stdin.Write([]byte(initReq))

			// Read response with timeout
			scanner := bufio.NewScanner(stdout)
			done := make(chan bool, 1)
			var initResp string
			go func() {
				if scanner.Scan() {
					initResp = scanner.Text()
				}
				done <- true
			}()

			select {
			case <-done:
				// Parse tools from init response
				var resp map[string]interface{}
				if json.Unmarshal([]byte(initResp), &resp) == nil {
					if result, ok := resp["result"].(map[string]interface{}); ok {
						if caps, ok := result["capabilities"].(map[string]interface{}); ok {
							_ = caps // Tools will be discovered via tools/list
						}
					}
				}

				// Send tools/list request
				toolsReq := `{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}` + "\n"
				stdin.Write([]byte(toolsReq))

				toolsDone := make(chan bool, 1)
				var toolsResp string
				go func() {
					if scanner.Scan() {
						toolsResp = scanner.Text()
					}
					toolsDone <- true
				}()

				select {
				case <-toolsDone:
					var tresp map[string]interface{}
					if json.Unmarshal([]byte(toolsResp), &tresp) == nil {
						if result, ok := tresp["result"].(map[string]interface{}); ok {
							if tools, ok := result["tools"].([]interface{}); ok {
								for _, t := range tools {
									if toolMap, ok := t.(map[string]interface{}); ok {
										mcpSrv.Tools = append(mcpSrv.Tools, toolMap)
									}
								}
							}
						}
					}
				case <-time.After(5 * time.Second):
					// Timeout reading tools
				}

			case <-time.After(10 * time.Second):
				cmd.Process.Kill()
				return c.Status(500).JSON(fiber.Map{"status": "error", "error": "MCP server initialization timeout"})
			}

			mcpMu.Lock()
			mcpServers[req.ServerID] = mcpSrv
			mcpMu.Unlock()

			log.Printf("[MCP] ✅ Connected to %s: %d tools discovered\n", req.ServerID, len(mcpSrv.Tools))
			return c.JSON(fiber.Map{
				"status": "success",
				"tools":  mcpSrv.Tools,
			})
		}

		return c.Status(400).JSON(fiber.Map{"status": "error", "error": "Unsupported MCP type: " + req.Type + ". Only 'stdio' is supported."})
	})

	app.Post("/api/mcp/call", func(c *fiber.Ctx) error {
		var req struct {
			ServerID string                 `json:"server_id"`
			ToolName string                 `json:"tool_name"`
			Args     map[string]interface{} `json:"arguments"`
		}
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"status": "error", "error": "Invalid JSON"})
		}

		mcpMu.Lock()
		srv, exists := mcpServers[req.ServerID]
		mcpMu.Unlock()
		if !exists {
			return c.Status(404).JSON(fiber.Map{"status": "error", "error": "MCP server not connected: " + req.ServerID})
		}

		// Send tool call via JSON-RPC
		callID := time.Now().UnixNano()
		callReq := map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      callID,
			"method":  "tools/call",
			"params": map[string]interface{}{
				"name":      req.ToolName,
				"arguments": req.Args,
			},
		}
		callBytes, _ := json.Marshal(callReq)
		srv.Stdin.Write(append(callBytes, '\n'))

		// Read response
		scanner := bufio.NewScanner(srv.Stdout)
		done := make(chan string, 1)
		go func() {
			if scanner.Scan() {
				done <- scanner.Text()
			} else {
				done <- ""
			}
		}()

		select {
		case respText := <-done:
			var resp map[string]interface{}
			if json.Unmarshal([]byte(respText), &resp) == nil {
				return c.JSON(fiber.Map{"status": "success", "result": resp["result"]})
			}
			return c.JSON(fiber.Map{"status": "success", "result": respText})
		case <-time.After(30 * time.Second):
			return c.Status(504).JSON(fiber.Map{"status": "error", "error": "MCP tool call timeout (30s)"})
		}
	})

	app.Get("/api/mcp/servers", func(c *fiber.Ctx) error {
		mcpMu.Lock()
		defer mcpMu.Unlock()
		servers := make([]map[string]interface{}, 0)
		for id, srv := range mcpServers {
			servers = append(servers, map[string]interface{}{
				"id":     id,
				"status": srv.Status,
				"tools":  len(srv.Tools),
			})
		}
		return c.JSON(fiber.Map{"status": "success", "servers": servers})
	})

	app.Delete("/api/mcp/disconnect/:id", func(c *fiber.Ctx) error {
		id := c.Params("id")
		mcpMu.Lock()
		srv, exists := mcpServers[id]
		if exists {
			if srv.Cmd != nil && srv.Cmd.Process != nil {
				srv.Cmd.Process.Kill()
			}
			delete(mcpServers, id)
		}
		mcpMu.Unlock()
		if !exists {
			return c.Status(404).JSON(fiber.Map{"status": "error", "error": "Server not found"})
		}
		log.Printf("[MCP] 🔌 Disconnected from %s\n", id)
		return c.JSON(fiber.Map{"status": "success"})
	})

	// ═══════════════════════════════════════════════════════════════
	// CLAUDE CODE PARITY: System Control (Health, Restart, Shutdown, Schedule)
	// ═══════════════════════════════════════════════════════════════
	var engineStartTime = time.Now()

	app.Get("/api/system/health", func(c *fiber.Ctx) error {
		var memStats runtime.MemStats
		runtime.ReadMemStats(&memStats)
		return c.JSON(fiber.Map{
			"status":       "success",
			"uptime_secs":  int(time.Since(engineStartTime).Seconds()),
			"goroutines":   runtime.NumGoroutine(),
			"mem_alloc_mb": int(memStats.Alloc / 1024 / 1024),
			"mem_sys_mb":   int(memStats.Sys / 1024 / 1024),
			"mem_gc_count": memStats.NumGC,
			"engine_version": CurrentEngineVersion,
			"engine_dir":   EngineDir,
			"user_tier":    UserTier,
			"os":           runtime.GOOS,
			"arch":         runtime.GOARCH,
			"num_cpu":      runtime.NumCPU(),
		})
	})

	app.Post("/api/system/restart", func(c *fiber.Ctx) error {
		log.Println("[System] 🔄 Self-restart requested by AI Mother")

		// Get the executable path
		exePath, err := os.Executable()
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"status": "error", "error": "Cannot resolve executable: " + err.Error()})
		}

		// Start new instance
		cmd := exec.Command(exePath)
		cmd.Dir = EngineDir
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if err := cmd.Start(); err != nil {
			return c.Status(500).JSON(fiber.Map{"status": "error", "error": "Restart failed: " + err.Error()})
		}

		// Send response before shutting down
		c.JSON(fiber.Map{"status": "success", "message": "Restarting engine..."})

		// Graceful shutdown after 1 second
		go func() {
			time.Sleep(1 * time.Second)
			scheduler.StopAll()
			packer.CleanupOldTempFolders()
			os.Exit(0)
		}()

		return nil
	})

	app.Post("/api/system/shutdown", func(c *fiber.Ctx) error {
		log.Println("[System] 🛑 Self-shutdown requested by AI Mother")
		c.JSON(fiber.Map{"status": "success", "message": "Shutting down..."})

		go func() {
			time.Sleep(1 * time.Second)
			scheduler.StopAll()
			packer.CleanupOldTempFolders()
			log.Println("[System] ✅ Clean shutdown completed")
			os.Exit(0)
		}()

		return nil
	})

	app.Post("/api/system/schedule", func(c *fiber.Ctx) error {
		var req struct {
			TaskName string `json:"task_name"`
			Schedule string `json:"schedule"`
			Command  string `json:"command"`
		}
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"status": "error", "error": "Invalid JSON"})
		}
		if req.TaskName == "" || req.Schedule == "" {
			return c.Status(400).JSON(fiber.Map{"status": "error", "error": "Missing task_name or schedule"})
		}

		if runtime.GOOS == "windows" {
			exePath, _ := os.Executable()
			scheduleType := "/SC DAILY"
			switch req.Schedule {
			case "startup":
				scheduleType = "/SC ONSTART"
			case "hourly":
				scheduleType = "/SC HOURLY"
			case "daily":
				scheduleType = "/SC DAILY"
			}

			cmdStr := req.Command
			if cmdStr == "" {
				cmdStr = exePath
			}

			cmd := exec.Command("schtasks", "/Create", "/TN", "Flowork_"+req.TaskName, scheduleType, "/TR", cmdStr, "/F")
			out, err := cmd.CombinedOutput()
			if err != nil {
				return c.Status(500).JSON(fiber.Map{"status": "error", "error": string(out)})
			}
			log.Printf("[System] ⏰ Scheduled task created: %s (%s)\n", req.TaskName, req.Schedule)
			return c.JSON(fiber.Map{"status": "success", "output": string(out)})
		}

		return c.Status(400).JSON(fiber.Map{"status": "error", "error": "Scheduling only supported on Windows"})
	})

	// ═══════════════════════════════════════════════════════════════
	// PHASE 5: MEDIA & FILE API ENDPOINTS
	// ═══════════════════════════════════════════════════════════════

	// Download file from URL to disk
	app.Post("/api/download-file", func(c *fiber.Ctx) error {
		var req struct {
			URL      string `json:"url"`
			Filename string `json:"filename"`
		}
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"status": "error", "message": "Invalid JSON"})
		}
		if req.URL == "" {
			return c.Status(400).JSON(fiber.Map{"status": "error", "message": "Missing url"})
		}
		if req.Filename == "" {
			req.Filename = "download_" + fmt.Sprintf("%d", time.Now().Unix()) + ".mp4"
		}

		downloadDir := filepath.Join(EngineDir, "FloworkData", "downloads")
		os.MkdirAll(downloadDir, 0755)
		filePath := filepath.Join(downloadDir, req.Filename)

		resp, err := http.Get(req.URL)
		if err != nil {
			return c.JSON(fiber.Map{"status": "error", "message": err.Error()})
		}
		defer resp.Body.Close()

		out, err := os.Create(filePath)
		if err != nil {
			return c.JSON(fiber.Map{"status": "error", "message": err.Error()})
		}
		defer out.Close()

		written, err := io.Copy(out, resp.Body)
		if err != nil {
			return c.JSON(fiber.Map{"status": "error", "message": err.Error()})
		}

		sizeStr := fmt.Sprintf("%.2f MB", float64(written)/1024/1024)
		return c.JSON(fiber.Map{
			"status":    "success",
			"file_path": filePath,
			"size":      sizeStr,
			"bytes":     written,
		})
	})

	// Read file from disk as base64 (for attach_file tool)
	app.Post("/api/read-file-base64", func(c *fiber.Ctx) error {
		var req struct {
			Path string `json:"path"`
		}
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"status": "error", "message": "Invalid JSON"})
		}
		if req.Path == "" {
			return c.Status(400).JSON(fiber.Map{"status": "error", "message": "Missing path"})
		}

		data, err := os.ReadFile(req.Path)
		if err != nil {
			return c.JSON(fiber.Map{"status": "error", "message": err.Error()})
		}

		// Detect MIME type from extension
		ext := strings.ToLower(filepath.Ext(req.Path))
		mimeType := "application/octet-stream"
		switch ext {
		case ".png":
			mimeType = "image/png"
		case ".jpg", ".jpeg":
			mimeType = "image/jpeg"
		case ".gif":
			mimeType = "image/gif"
		case ".webp":
			mimeType = "image/webp"
		case ".svg":
			mimeType = "image/svg+xml"
		case ".mp4":
			mimeType = "video/mp4"
		case ".webm":
			mimeType = "video/webm"
		case ".pdf":
			mimeType = "application/pdf"
		}

		encoded := fmt.Sprintf("data:%s;base64,%s",
			mimeType,
			base64Encode(data),
		)

		return c.JSON(fiber.Map{
			"status": "success",
			"base64": encoded,
			"size":   len(data),
			"mime":   mimeType,
		})
	})

	// ═══════════════════════════════════════════════════════════════
	// PHASE 5: EMAIL IMAP ENDPOINTS (@flowork.cloud catch-all → Gmail)
	// ═══════════════════════════════════════════════════════════════

	// Email config file
	emailConfigPath := filepath.Join(EngineDir, "FloworkData", "email_config.json")

	app.Post("/api/email/config", func(c *fiber.Ctx) error {
		var req struct {
			ImapHost string `json:"imap_host"` // imap.gmail.com
			ImapPort int    `json:"imap_port"` // 993
			Email    string `json:"email"`     // bankakun@gmail.com
			Password string `json:"password"`  // Gmail App Password
		}
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"status": "error", "message": "Invalid JSON"})
		}
		configData, _ := json.MarshalIndent(req, "", "  ")
		os.WriteFile(emailConfigPath, configData, 0600)
		return c.JSON(fiber.Map{"status": "success", "message": "Email config saved"})
	})

	app.Post("/api/email/inbox", func(c *fiber.Ctx) error {
		var req struct {
			TargetEmail string `json:"target_email"`
			WaitSeconds int    `json:"wait_seconds"`
		}
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"status": "error", "message": "Invalid JSON"})
		}

		// Read IMAP config
		if _, err := os.Stat(emailConfigPath); os.IsNotExist(err) {
			return c.JSON(fiber.Map{
				"status":  "error",
				"message": "IMAP not configured. POST to /api/email/config with {imap_host, imap_port, email, password}",
			})
		}

		configData, _ := os.ReadFile(emailConfigPath)
		var emailConfig struct {
			ImapHost string `json:"imap_host"`
			ImapPort int    `json:"imap_port"`
			Email    string `json:"email"`
			Password string `json:"password"`
		}
		json.Unmarshal(configData, &emailConfig)

		if emailConfig.ImapHost == "" || emailConfig.Email == "" {
			return c.JSON(fiber.Map{"status": "error", "message": "IMAP credentials incomplete"})
		}

		// For now, return a placeholder for IMAP functionality
		// The actual IMAP implementation requires a Go IMAP library like github.com/emersion/go-imap
		// This stub provides the API contract so the frontend can be developed in parallel
		return c.JSON(fiber.Map{
			"status":  "success",
			"emails":  []fiber.Map{},
			"message": fmt.Sprintf("Searching for emails to %s (IMAP: %s@%s)", req.TargetEmail, emailConfig.Email, emailConfig.ImapHost),
		})
	})

	app.Post("/api/email/read", func(c *fiber.Ctx) error {
		var req struct {
			EmailID string `json:"email_id"`
		}
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"status": "error", "message": "Invalid JSON"})
		}

		// Placeholder — full IMAP read implementation needs go-imap library
		return c.JSON(fiber.Map{
			"status":  "error",
			"message": "IMAP library not yet installed. Run: go get github.com/emersion/go-imap",
		})
	})

	// ═══════════════════════════════════════════════════════════════
	// Register Webhook Routes & Start Background Scheduler
	// ═══════════════════════════════════════════════════════════════
	webhookMgr.RegisterRoutes(app)

	// [DIBERIKAN KOMENTAR] go watcher.StartNodeWatcher("nodes", socketHandler)
	go watcher.StartNodeWatcher(filepath.Join(EngineDir, "nodes"), socketHandler) // [KODE BARU]

	// [DIBERIKAN KOMENTAR] go watcher.StartNodeWatcher("apps", socketHandler)
	go watcher.StartNodeWatcher(filepath.Join(EngineDir, "apps"), socketHandler) // [KODE BARU]

	// Auto-load active triggers on engine boot
	go func() {
		time.Sleep(2 * time.Second) // Wait for engine to stabilize
		scheduler.LoadActiveWorkflows()
		webhookMgr.LoadActiveWebhooks()
		log.Println("[Engine] ⏰ Background Trigger Engine loaded.")
	}()

	// ═══════════════════════════════════════════════════════════════
	// REST API: REPL (Interactive Code Execution) — Phase 5
	// Simplified: each execute runs a fresh command with timeout.
	// Sessions track language preference and history.
	// ═══════════════════════════════════════════════════════════════
	type replSession struct {
		Language string
		History  []string
	}
	replSessions := make(map[string]*replSession)
	var replMu sync.Mutex

	app.Post("/api/repl/start", func(c *fiber.Ctx) error {
		var req struct {
			Language string `json:"language"`
			ID       string `json:"id"`
		}
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"status": "error", "error": "Invalid payload"})
		}
		lang := req.Language
		if lang == "" {
			lang = "node"
		}
		id := req.ID
		if id == "" {
			id = fmt.Sprintf("repl_%d", time.Now().UnixMilli())
		}

		replMu.Lock()
		replSessions[id] = &replSession{Language: lang, History: []string{}}
		replMu.Unlock()

		log.Printf("[REPL] ✅ Started %s session: %s", lang, id)
		return c.JSON(fiber.Map{"status": "success", "id": id, "language": lang})
	})

	app.Post("/api/repl/execute", func(c *fiber.Ctx) error {
		var req struct {
			ID   string `json:"id"`
			Code string `json:"code"`
		}
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"status": "error", "error": "Invalid payload"})
		}

		replMu.Lock()
		session, exists := replSessions[req.ID]
		replMu.Unlock()

		if !exists {
			return c.Status(404).JSON(fiber.Map{"status": "error", "error": "REPL session not found: " + req.ID})
		}

		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()

		var cmd *exec.Cmd
		switch session.Language {
		case "python", "python3":
			cmd = exec.CommandContext(ctx, "python", "-c", req.Code)
		case "node", "javascript":
			cmd = exec.CommandContext(ctx, "node", "-e", req.Code)
		case "bun":
			cmd = exec.CommandContext(ctx, "bun", "-e", req.Code)
		default:
			cmd = exec.CommandContext(ctx, "node", "-e", req.Code)
		}

		cmd.Dir = filepath.Join(EngineDir, "apps")
		out, err := cmd.CombinedOutput()
		errMsg := ""
		if err != nil {
			errMsg = err.Error()
		}

		// Save to history
		replMu.Lock()
		session.History = append(session.History, req.Code)
		if len(session.History) > 100 {
			session.History = session.History[len(session.History)-100:]
		}
		replMu.Unlock()

		return c.JSON(fiber.Map{
			"status": "success",
			"output": string(out),
			"error":  errMsg,
		})
	})

	app.Post("/api/repl/stop", func(c *fiber.Ctx) error {
		var req struct {
			ID string `json:"id"`
		}
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"status": "error", "error": "Invalid payload"})
		}

		replMu.Lock()
		_, exists := replSessions[req.ID]
		if exists {
			delete(replSessions, req.ID)
		}
		replMu.Unlock()

		if !exists {
			return c.JSON(fiber.Map{"status": "success", "message": "Session already stopped"})
		}

		log.Printf("[REPL] 🛑 Stopped session: %s", req.ID)
		return c.JSON(fiber.Map{"status": "success", "message": "REPL session stopped"})
	})

	// ═══════════════════════════════════════════════════════════════
	// REST API: Cron / Scheduler — Phase 5
	// ═══════════════════════════════════════════════════════════════
	app.Post("/api/cron/create", func(c *fiber.Ctx) error {
		var req struct {
			WorkflowID string `json:"workflow_id"`
			Cron       string `json:"cron"`
			Name       string `json:"name"`
		}
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"status": "error", "error": "Invalid payload"})
		}
		if req.WorkflowID == "" || req.Cron == "" {
			return c.Status(400).JSON(fiber.Map{"status": "error", "error": "workflow_id and cron expression required"})
		}

		err := scheduler.ActivateWorkflow(req.WorkflowID)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"status": "error", "error": err.Error()})
		}

		log.Printf("[Cron] ⏰ Activated workflow: %s", req.WorkflowID)
		return c.JSON(fiber.Map{"status": "success", "workflow_id": req.WorkflowID, "cron": req.Cron})
	})

	app.Delete("/api/cron/delete", func(c *fiber.Ctx) error {
		wfID := c.Query("workflow_id")
		if wfID == "" {
			return c.Status(400).JSON(fiber.Map{"status": "error", "error": "workflow_id required"})
		}
		scheduler.DeactivateWorkflow(wfID)
		return c.JSON(fiber.Map{"status": "success", "message": "Cron removed for " + wfID})
	})

	app.Get("/api/cron/list", func(c *fiber.Ctx) error {
		jobs := scheduler.GetActiveJobs()
		return c.JSON(fiber.Map{"status": "success", "data": jobs})
	})

	// ═══════════════════════════════════════════════════════════════
	// REST API: Auth — Phase 5 (extends license system)
	// ═══════════════════════════════════════════════════════════════
	app.Post("/api/auth/login", func(c *fiber.Ctx) error {
		var req struct {
			Token string `json:"token"`
		}
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"status": "error", "error": "Invalid payload"})
		}
		if req.Token == "" {
			return c.Status(400).JSON(fiber.Map{"status": "error", "error": "Token required"})
		}

		// Save license token
		lic := LicenseData{Token: req.Token}
		fileBytes, _ := json.MarshalIndent(lic, "", "  ")
		os.WriteFile(LicenseFilePath, fileBytes, 0644)
		go initLicense()

		return c.JSON(fiber.Map{"status": "success", "message": "Login token saved. Verifying..."})
	})

	app.Post("/api/auth/logout", func(c *fiber.Ctx) error {
		os.Remove(LicenseFilePath)
		UserTier = "free"
		return c.JSON(fiber.Map{"status": "success", "message": "Logged out. Tier reset to free."})
	})

	app.Get("/api/auth/status", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"status":    "success",
			"tier":      UserTier,
			"logged_in": UserTier != "free",
		})
	})

	// ═══════════════════════════════════════════════════════════════
	// REST API: Health & Diagnostics — Phase 5
	// ═══════════════════════════════════════════════════════════════
	app.Get("/api/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"status":  "success",
			"engine":  "running",
			"version": CurrentEngineVersion,
			"tier":    UserTier,
			"uptime":  time.Since(time.Now()).String(),
			"dev_mode": IsDevModeGlobal,
			"platform": runtime.GOOS,
		})
	})

	app.Get("/api/engine/info", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"status":     "success",
			"version":    CurrentEngineVersion,
			"engine_dir": EngineDir,
			"dev_mode":   IsDevModeGlobal,
			"tier":       UserTier,
			"platform":   runtime.GOOS,
			"arch":       runtime.GOARCH,
			"go_version": runtime.Version(),
			"goroutines": runtime.NumGoroutine(),
		})
	})

	app.All("/api/socket.io/*", socketHandler.FiberHandler())

	log.Println(`
    _____ _ OS
   |   ___| | _____    _____  _ __| | __
   | |_  | |/ _ \ \ /\ / / _ \| '__| |/ /
   |  _| | | (_) \ V  V / (_) | |  |   <
   |_|   |_|\___/ \_/\_/ \___/|_|  |_|\_\
                        www.floworkos.com
    `)
	log.Println("📡 Go Engine Standby & Listening at ws://127.0.0.1:5000/gui-socket")
	log.Println("🔒 Secure Local Apps endpoint is running. (In-Memory Streaming)")
	log.Println("🛒 App Store UI available at http://127.0.0.1:5000/store")
	log.Println("⚙️ Workflow API: http://127.0.0.1:5000/api/workflow/list")
	log.Println("🔐 Credential Vault: http://127.0.0.1:5000/api/credentials")
	log.Println("📊 Execution History: http://127.0.0.1:5000/api/executions")
	log.Println("🌍 Global Variables: http://127.0.0.1:5000/api/variables")
	log.Println("🌐 Webhooks: http://127.0.0.1:5000/webhook/<id>")

	go func() {
		time.Sleep(1 * time.Second)
		openAppWindow("http://127.0.0.1:5000/webview/login")
	}()

	ch := make(chan os.Signal, 1)
	signal.Notify(ch, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-ch
		log.Println("\n[Engine] 🛑 Received system shutdown command.")
		scheduler.StopAll()
		log.Println("[Engine] 🧹 Performing cleanup of virtual sandbox folders...")
		packer.CleanupOldTempFolders()
		log.Println("[Engine] ✅ System closed cleanly. Goodbye!")
		os.Exit(0)
	}()

	if err := app.Listen(":5000"); err != nil {
		log.Fatalf("Server failed to run on Port 5000: %v", err)
	}
}