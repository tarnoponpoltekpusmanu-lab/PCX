//#######################################################################
// File NAME : internal/history/store.go
// Execution History — JSON file-based execution log
// Records every workflow run with per-node results
//#######################################################################
package history

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"
	"sort"
	"sync"

	"flowork-engine/internal/workflow"
)

const MaxExecutionsPerWorkflow = 500

// HistoryStore manages execution history on disk
type HistoryStore struct {
	baseDir string
	mutex   sync.Mutex
}

func NewHistoryStore(baseDir string) *HistoryStore {
	os.MkdirAll(baseDir, os.ModePerm)
	return &HistoryStore{baseDir: baseDir}
}

// Save records an execution result
func (hs *HistoryStore) Save(exec *workflow.Execution) error {
	hs.mutex.Lock()
	defer hs.mutex.Unlock()

	// Save to per-workflow directory
	wfDir := filepath.Join(hs.baseDir, exec.WorkflowID)
	os.MkdirAll(wfDir, os.ModePerm)

	data, err := json.MarshalIndent(exec, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal execution: %v", err)
	}

	filePath := filepath.Join(wfDir, exec.ID+".json")
	if err := ioutil.WriteFile(filePath, data, 0644); err != nil {
		return fmt.Errorf("failed to save execution: %v", err)
	}

	log.Printf("[History] 💾 Saved execution %s (workflow: %s, status: %s)", exec.ID, exec.WorkflowID, exec.Status)

	// Auto-cleanup old executions
	hs.cleanupOldExecutions(wfDir)
	return nil
}

// GetByWorkflow returns executions for a workflow, newest first
func (hs *HistoryStore) GetByWorkflow(workflowID string, limit int) ([]workflow.Execution, error) {
	wfDir := filepath.Join(hs.baseDir, workflowID)
	return hs.loadFromDir(wfDir, limit)
}

// GetAll returns recent executions across all workflows
func (hs *HistoryStore) GetAll(limit int) ([]workflow.Execution, error) {
	wfDirs, err := ioutil.ReadDir(hs.baseDir)
	if err != nil {
		return []workflow.Execution{}, nil
	}

	var allExecs []workflow.Execution
	for _, dir := range wfDirs {
		if !dir.IsDir() {
			continue
		}
		wfDir := filepath.Join(hs.baseDir, dir.Name())
		execs, _ := hs.loadFromDir(wfDir, 50) // Max 50 per workflow
		allExecs = append(allExecs, execs...)
	}

	// Sort by StartedAt descending
	sort.Slice(allExecs, func(i, j int) bool {
		return allExecs[i].StartedAt.After(allExecs[j].StartedAt)
	})

	if limit > 0 && len(allExecs) > limit {
		allExecs = allExecs[:limit]
	}

	return allExecs, nil
}

// Get returns a single execution by ID
func (hs *HistoryStore) Get(executionID string) (*workflow.Execution, error) {
	// Search across all workflow directories
	wfDirs, err := ioutil.ReadDir(hs.baseDir)
	if err != nil {
		return nil, fmt.Errorf("execution not found: %s", executionID)
	}

	for _, dir := range wfDirs {
		if !dir.IsDir() {
			continue
		}
		filePath := filepath.Join(hs.baseDir, dir.Name(), executionID+".json")
		data, err := ioutil.ReadFile(filePath)
		if err == nil {
			var exec workflow.Execution
			if err := json.Unmarshal(data, &exec); err == nil {
				return &exec, nil
			}
		}
	}
	return nil, fmt.Errorf("execution not found: %s", executionID)
}

// Delete removes a single execution
func (hs *HistoryStore) Delete(executionID string) error {
	wfDirs, _ := ioutil.ReadDir(hs.baseDir)
	for _, dir := range wfDirs {
		if !dir.IsDir() {
			continue
		}
		filePath := filepath.Join(hs.baseDir, dir.Name(), executionID+".json")
		if err := os.Remove(filePath); err == nil {
			return nil
		}
	}
	return fmt.Errorf("execution not found: %s", executionID)
}

// GetStats returns execution statistics
func (hs *HistoryStore) GetStats() map[string]interface{} {
	all, _ := hs.GetAll(0)

	total := len(all)
	success := 0
	errCount := 0
	var totalDuration int64

	for _, exec := range all {
		if exec.Status == workflow.StatusSuccess {
			success++
		} else if exec.Status == workflow.StatusError {
			errCount++
		}
		if exec.FinishedAt != nil {
			totalDuration += exec.FinishedAt.Sub(exec.StartedAt).Milliseconds()
		}
	}

	avgDuration := int64(0)
	if total > 0 {
		avgDuration = totalDuration / int64(total)
	}

	return map[string]interface{}{
		"total_executions":  total,
		"success_count":     success,
		"error_count":       errCount,
		"avg_duration_ms":   avgDuration,
	}
}

// ─── Internal ────────────────────────────────────────────────

func (hs *HistoryStore) loadFromDir(dir string, limit int) ([]workflow.Execution, error) {
	entries, err := ioutil.ReadDir(dir)
	if err != nil {
		return []workflow.Execution{}, nil
	}

	// Sort by mod time descending (newest first)
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].ModTime().After(entries[j].ModTime())
	})

	var execs []workflow.Execution
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		if limit > 0 && len(execs) >= limit {
			break
		}

		data, err := ioutil.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			continue
		}
		var exec workflow.Execution
		if err := json.Unmarshal(data, &exec); err == nil {
			execs = append(execs, exec)
		}
	}
	return execs, nil
}

func (hs *HistoryStore) cleanupOldExecutions(wfDir string) {
	entries, err := ioutil.ReadDir(wfDir)
	if err != nil {
		return
	}

	if len(entries) <= MaxExecutionsPerWorkflow {
		return
	}

	// Sort oldest first
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].ModTime().Before(entries[j].ModTime())
	})

	toDelete := len(entries) - MaxExecutionsPerWorkflow
	for i := 0; i < toDelete; i++ {
		os.Remove(filepath.Join(wfDir, entries[i].Name()))
	}
	log.Printf("[History] 🧹 Cleaned up %d old execution(s) from %s", toDelete, filepath.Base(wfDir))
}


