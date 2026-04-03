//#######################################################################
// File NAME : internal/trigger/webhook.go
// Webhook Listener — Dynamic HTTP endpoint registration
// Creates /webhook/:id routes that trigger workflow execution
//#######################################################################
package trigger

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"

	"flowork-engine/internal/workflow"

	"github.com/gofiber/fiber/v2"
)

// WebhookManager handles dynamic webhook route registration
type WebhookManager struct {
	webhooks       map[string]string // webhookPath → workflowID
	mutex          sync.RWMutex
	workflowRunner *workflow.WorkflowRunner
	workflowStore  *workflow.WorkflowStore
}

func NewWebhookManager(runner *workflow.WorkflowRunner, store *workflow.WorkflowStore) *WebhookManager {
	return &WebhookManager{
		webhooks:       make(map[string]string),
		workflowRunner: runner,
		workflowStore:  store,
	}
}

// RegisterRoutes sets up the webhook handler on the Fiber app
func (wm *WebhookManager) RegisterRoutes(app *fiber.App) {
	// Catch-all webhook handler
	app.All("/webhook/:path", func(c *fiber.Ctx) error {
		webhookPath := c.Params("path")

		wm.mutex.RLock()
		workflowID, exists := wm.webhooks[webhookPath]
		wm.mutex.RUnlock()

		if !exists {
			return c.Status(404).JSON(fiber.Map{
				"error":   "Webhook not found",
				"message": fmt.Sprintf("No workflow registered for webhook path: %s", webhookPath),
			})
		}

		log.Printf("[Webhook] 🌐 Incoming webhook hit: /webhook/%s → Workflow: %s", webhookPath, workflowID)

		// Build trigger data from request
		triggerData := map[string]interface{}{
			"_trigger":    "webhook",
			"_method":     c.Method(),
			"_path":       webhookPath,
			"_headers":    c.GetReqHeaders(),
			"_query":      c.Queries(),
			"_ip":         c.IP(),
		}

		// Parse body
		body := c.Body()
		if len(body) > 0 {
			var jsonBody interface{}
			if err := json.Unmarshal(body, &jsonBody); err == nil {
				triggerData["body"] = jsonBody
			} else {
				triggerData["body"] = string(body)
			}
		}

		// Load and execute workflow
		wf, err := wm.workflowStore.Load(workflowID)
		if err != nil {
			log.Printf("[Webhook] ❌ Failed to load workflow %s: %v", workflowID, err)
			return c.Status(500).JSON(fiber.Map{"error": "Failed to load workflow"})
		}

		// Execute asynchronously
		go func() {
			result := wm.workflowRunner.Execute(wf, "webhook", triggerData)
			log.Printf("[Webhook] ✅ Webhook-triggered workflow '%s' completed: %s", wf.Name, result.Status)
		}()

		return c.JSON(fiber.Map{
			"status":      "accepted",
			"workflow_id": workflowID,
			"message":     "Workflow execution started",
		})
	})

	// Also support nested paths: /webhook/path/subpath
	app.All("/webhook/:path/:subpath", func(c *fiber.Ctx) error {
		fullPath := c.Params("path") + "/" + c.Params("subpath")

		wm.mutex.RLock()
		workflowID, exists := wm.webhooks[fullPath]
		wm.mutex.RUnlock()

		if !exists {
			// Try parent path
			wm.mutex.RLock()
			workflowID, exists = wm.webhooks[c.Params("path")]
			wm.mutex.RUnlock()
		}

		if !exists {
			return c.Status(404).JSON(fiber.Map{"error": "Webhook not found"})
		}

		triggerData := map[string]interface{}{
			"_trigger": "webhook",
			"_method":  c.Method(),
			"_path":    fullPath,
			"_headers": c.GetReqHeaders(),
			"_query":   c.Queries(),
		}

		body := c.Body()
		if len(body) > 0 {
			var jsonBody interface{}
			if err := json.Unmarshal(body, &jsonBody); err == nil {
				triggerData["body"] = jsonBody
			} else {
				triggerData["body"] = string(body)
			}
		}

		wf, err := wm.workflowStore.Load(workflowID)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to load workflow"})
		}

		go func() {
			wm.workflowRunner.Execute(wf, "webhook", triggerData)
		}()

		return c.JSON(fiber.Map{"status": "accepted", "workflow_id": workflowID})
	})
}

// RegisterWebhook maps a webhook path to a workflow
func (wm *WebhookManager) RegisterWebhook(path string, workflowID string) {
	wm.mutex.Lock()
	defer wm.mutex.Unlock()
	wm.webhooks[path] = workflowID
	log.Printf("[Webhook] ✅ Registered webhook: /webhook/%s → %s", path, workflowID)
}

// UnregisterWebhook removes a webhook mapping
func (wm *WebhookManager) UnregisterWebhook(path string) {
	wm.mutex.Lock()
	defer wm.mutex.Unlock()
	delete(wm.webhooks, path)
	log.Printf("[Webhook] 🗑️ Unregistered webhook: /webhook/%s", path)
}

// GetWebhookPaths extracts all configured webhook paths from a workflow
func GetWebhookPaths(wf *workflow.Workflow) []string {
	var paths []string
	
	// Legacy Flowork Root-Level Trigger
	if wf.Trigger != nil && wf.Trigger.Type == "webhook" {
		path := wf.Trigger.WebhookURL
		if path == "" {
			path = wf.ID
		}
		paths = append(paths, path)
	}

	// [N8N PARITY UPGRADE] Scan all nodes for Webhook nodes
	for _, node := range wf.Nodes {
		if strings.Contains(strings.ToLower(node.Type), ".webhook") { // Matches engine.secure.Webhook
			pathVal, ok := node.Parameters["path"].(string)
			if !ok || pathVal == "" {
				// N8N Default Behavior: Use Node ID if custom path is unconfigured
				pathVal = node.ID 
			}
			paths = append(paths, pathVal)
		}
	}
	return paths
}

// LoadActiveWebhooks scans workflows and registers webhooks for active ones
func (wm *WebhookManager) LoadActiveWebhooks() error {
	activeWFs, err := wm.workflowStore.GetActive()
	if err != nil {
		return err
	}

	for _, wf := range activeWFs {
		for _, path := range GetWebhookPaths(&wf) {
			wm.RegisterWebhook(path, wf.ID)
		}
	}
	return nil
}

// ListWebhooks returns all registered webhook paths
func (wm *WebhookManager) ListWebhooks() map[string]string {
	wm.mutex.RLock()
	defer wm.mutex.RUnlock()

	result := make(map[string]string)
	for k, v := range wm.webhooks {
		result[k] = v
	}
	return result
}


