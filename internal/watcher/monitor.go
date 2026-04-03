package watcher

import (
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"flowork-engine/internal/packer" // Import our security module
	"github.com/fsnotify/fsnotify"
)

// [ADDED] Variabel Global untuk menampung status Dev Mode dari GUI
var IsDevMode bool = false

type SocketNotifier interface {
	BroadcastRefresh()
}

func installRequirements(folderPath string) {
	reqFile := filepath.Join(folderPath, "requirements.txt")
	libsFolder := filepath.Join(folderPath, "libs")

	if _, err := os.Stat(reqFile); err == nil {
		os.MkdirAll(libsFolder, os.ModePerm)

		folderName := filepath.Base(folderPath)
		log.Printf("\n[📦 Installer] Detected requirements.txt in: %s\n", folderName)
		log.Printf("[📦 Installer] Starting installation to libs folder...\n")

		pythonCmd := "python"
		if runtime.GOOS != "windows" {
			pythonCmd = "python3"
		}

		cmd := exec.Command(pythonCmd, "-m", "pip", "install", "-U", "-t", libsFolder, "-r", reqFile, "--quiet", "--no-dependencies")
		cmd.Run()
		cmd2 := exec.Command(pythonCmd, "-m", "pip", "install", "-U", "-t", libsFolder, "-r", reqFile, "--quiet")
		if err := cmd2.Run(); err != nil {
			log.Printf("[📦 Installer] ❌ Installation warning (Can be ignored): %v\n", err)
		} else {
			log.Printf("[📦 Installer] ✅ Installation complete for: %s\n", folderName)
		}
	}
}

// [PERBAIKAN] Fungsi pintar untuk Switch Dev Mode secara Real-time tanpa Restart!
// Karena folder asli tidak pernah direname, Dev Mode hanya perlu sweep & repack jika needed
func ToggleDevMode(isDev bool, notifier SocketNotifier) {
	IsDevMode = isDev

	if !isDev {
		// Production mode: pastikan semua raw folder sudah punya .flow/.nflow
		dirs := []string{"apps", "nodes"}
		for _, dir := range dirs {
			entries, err := os.ReadDir(dir)
			if err != nil {
				continue
			}
			isNodeDir := (dir == "nodes")

			for _, entry := range entries {
				if !entry.IsDir() {
					continue
				}
				folderName := entry.Name()
				if !strings.HasPrefix(folderName, ".") && folderName != "libs" {
					processRawFolder(filepath.Join(dir, folderName), isNodeDir, nil)
				}
			}
		}
	}

	log.Printf("[🛠️ Dev Mode] Mode switched to: dev=%v\n", isDev)

	// Setelah sweep selesai, paksa UI untuk me-refresh datanya
	if notifier != nil {
		notifier.BroadcastRefresh()
	}
}

// New function to handle dynamic folder packing
// [PERBAIKAN] Folder asli TIDAK PERNAH di-rename ke .raw_
// Hanya membuat/mengupdate file .flow/.nflow di sebelah folder
func processRawFolder(path string, isNode bool, notifier SocketNotifier) {
	info, err := os.Stat(path)
	if err != nil || !info.IsDir() {
		return
	}

	folderName := filepath.Base(path)

	// Ignore libs folder and protected folders (starting with a dot)
	if folderName == "libs" || strings.HasPrefix(folderName, ".") {
		return
	}

	// [ADDED] Logic Bypass untuk Developer Mode
	if IsDevMode {
		log.Printf("[🛠️ Dev Mode] Mengabaikan enkripsi untuk folder mentah: %s", folderName)
		// Install requirements jika ada
		installRequirements(path)
		// Tetap trigger refresh agar UI tahu ada folder mentah yang bisa dieksekusi langsung
		if notifier != nil {
			notifier.BroadcastRefresh()
		}
		return // Keluar dari fungsi, JANGAN lakukan enkripsi ke bawah!
	}

	ext := ".flow"
	if isNode {
		ext = ".nflow"
	}

	outputFile := filepath.Join(filepath.Dir(path), folderName+ext)

	log.Printf("[🔒 Security] Detected raw folder '%s'. Encrypting to %s format...", folderName, ext)

	// 1. Pack and Encrypt (create/overwrite .flow/.nflow)
	err = packer.EncryptAndPack(path, outputFile)
	if err != nil {
		log.Printf("[🔒 Security] ❌ Failed to pack %s: %v", folderName, err)
		return
	}

	// 2. [PERBAIKAN] Folder asli TETAP ADA — tidak di-rename ke .raw_
	// Folder tetap di tempat agar bisa diakses langsung oleh /api/ai-read dan developer
	log.Printf("[🔒 Security] ✅ Success! %s has been packed to %s. Original folder preserved.", folderName, filepath.Base(outputFile))

	if notifier != nil {
		notifier.BroadcastRefresh()
	}
}

func StartNodeWatcher(baseDir string, notifier SocketNotifier) {
	// Initial setup: Check for raw folders when the Engine starts
	entries, _ := os.ReadDir(baseDir)
	isNodeDir := strings.Contains(baseDir, "nodes")

	for _, entry := range entries {
		// Only process raw folders that do not start with "."
		if entry.IsDir() && !strings.HasPrefix(entry.Name(), ".") {
			processRawFolder(filepath.Join(baseDir, entry.Name()), isNodeDir, notifier)
		}
	}

	// Start live watcher
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		log.Fatal(err)
	}
	defer watcher.Close()

	err = watcher.Add(baseDir)
	if err != nil {
		log.Fatal(err)
	}

	log.Printf("👀 Watchdog actively monitoring folder: %s\n", baseDir)

	for {
		select {
		case event, ok := <-watcher.Events:
			if !ok {
				return
			}
			if event.Op&fsnotify.Create == fsnotify.Create {
				// Trigger encryption process when a new folder is copied
				processRawFolder(event.Name, isNodeDir, notifier)
			}
		case err, ok := <-watcher.Errors:
			if !ok {
				return
			}
			log.Println("error:", err)
		}
	}
}