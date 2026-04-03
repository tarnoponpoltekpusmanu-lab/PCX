//#######################################################################
// File NAME : internal/trigger/scheduler.go
// Background Trigger Engine — Cron scheduler + Interval timer
// Runs 24/7 in Go engine, even when browser/GUI is closed
//#######################################################################
package trigger

import (
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"flowork-engine/internal/workflow"
)

// CronJob represents a single scheduled workflow
type CronJob struct {
	WorkflowID string
	Cron       string
	Interval   time.Duration
	Active     bool
	stopChan   chan struct{}
}

// Scheduler manages all background cron/interval jobs
type Scheduler struct {
	jobs           map[string]*CronJob
	mutex          sync.Mutex
	workflowRunner *workflow.WorkflowRunner
	workflowStore  *workflow.WorkflowStore
}

func NewScheduler(runner *workflow.WorkflowRunner, store *workflow.WorkflowStore) *Scheduler {
	return &Scheduler{
		jobs:           make(map[string]*CronJob),
		workflowRunner: runner,
		workflowStore:  store,
	}
}

// LoadActiveWorkflows scans saved workflows and starts jobs for active ones
func (s *Scheduler) LoadActiveWorkflows() error {
	activeWFs, err := s.workflowStore.GetActive()
	if err != nil {
		return err
	}

	log.Printf("[Scheduler] 🔍 Found %d active workflow(s) to schedule", len(activeWFs))

	for _, wf := range activeWFs {
		if wf.Trigger != nil {
			s.ActivateWorkflow(wf.ID)
		}
	}
	return nil
}

// ActivateWorkflow starts a background job for a workflow
func (s *Scheduler) ActivateWorkflow(workflowID string) error {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	// Stop existing job if any
	if existing, ok := s.jobs[workflowID]; ok {
		close(existing.stopChan)
		delete(s.jobs, workflowID)
	}

	wf, err := s.workflowStore.Load(workflowID)
	if err != nil {
		return fmt.Errorf("workflow not found: %s", workflowID)
	}

	if wf.Trigger == nil {
		return fmt.Errorf("workflow has no trigger config")
	}

	var interval time.Duration
	switch wf.Trigger.Type {
	case "cron":
		interval = parseCronToInterval(wf.Trigger.Cron)
	case "interval":
		interval = time.Duration(wf.Trigger.IntervalMs) * time.Millisecond
	default:
		return fmt.Errorf("unsupported trigger type: %s", wf.Trigger.Type)
	}

	if interval < 1*time.Second {
		interval = 60 * time.Second // Default minimum 1 minute
	}

	job := &CronJob{
		WorkflowID: workflowID,
		Cron:       wf.Trigger.Cron,
		Interval:   interval,
		Active:     true,
		stopChan:   make(chan struct{}),
	}

	s.jobs[workflowID] = job

	// Start background goroutine
	go func() {
		log.Printf("[Scheduler] ⏰ Started background job for '%s' (every %v)", wf.Name, interval)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				log.Printf("[Scheduler] 🔄 Triggering scheduled workflow: %s", wf.Name)
				freshWF, err := s.workflowStore.Load(workflowID)
				if err != nil {
					log.Printf("[Scheduler] ❌ Failed to load workflow %s: %v", workflowID, err)
					continue
				}
				go s.workflowRunner.Execute(freshWF, "trigger", map[string]interface{}{
					"_trigger": "cron",
					"_time":    time.Now().Format(time.RFC3339),
				})
			case <-job.stopChan:
				log.Printf("[Scheduler] 🛑 Stopped background job for workflow: %s", workflowID)
				return
			}
		}
	}()

	return nil
}

// DeactivateWorkflow stops a background job
func (s *Scheduler) DeactivateWorkflow(workflowID string) {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	if job, ok := s.jobs[workflowID]; ok {
		close(job.stopChan)
		delete(s.jobs, workflowID)
		log.Printf("[Scheduler] 🛑 Deactivated workflow: %s", workflowID)
	}
}

// GetActiveJobs returns list of active job IDs
func (s *Scheduler) GetActiveJobs() []string {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	var ids []string
	for id := range s.jobs {
		ids = append(ids, id)
	}
	return ids
}

// StopAll gracefully stops all scheduled jobs
func (s *Scheduler) StopAll() {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	for id, job := range s.jobs {
		close(job.stopChan)
		delete(s.jobs, id)
	}
	log.Println("[Scheduler] 🛑 All background jobs stopped.")
}

// parseCronToInterval converts simple cron expressions to intervals
// Supports: "*/5 * * * *" (every 5 min), "0 * * * *" (every hour), etc.
func parseCronToInterval(cron string) time.Duration {
	parts := strings.Fields(cron)
	if len(parts) < 5 {
		return 60 * time.Second // Default 1 minute
	}

	minuteField := parts[0]
	hourField := parts[1]

	// Every N minutes: "*/N * * * *"
	if strings.HasPrefix(minuteField, "*/") {
		n := 0
		fmt.Sscanf(minuteField, "*/%d", &n)
		if n > 0 {
			return time.Duration(n) * time.Minute
		}
	}

	// Every hour: "0 * * * *"
	if minuteField == "0" && hourField == "*" {
		return 1 * time.Hour
	}

	// Every N hours: "0 */N * * *"
	if minuteField == "0" && strings.HasPrefix(hourField, "*/") {
		n := 0
		fmt.Sscanf(hourField, "*/%d", &n)
		if n > 0 {
			return time.Duration(n) * time.Hour
		}
	}

	// Default: every minute
	return 1 * time.Minute
}
