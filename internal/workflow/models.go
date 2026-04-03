//#######################################################################
// File NAME : internal/workflow/models.go
//#######################################################################
package workflow

import "time"

// ─── Workflow Definition (saved as JSON) ─────────────────────
type Workflow struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Active      bool              `json:"active"`
	Nodes       []WorkflowNode    `json:"nodes"`
	Connections []Connection      `json:"connections"`
	Settings    WorkflowSettings  `json:"settings"`
	Trigger     *TriggerConfig    `json:"trigger,omitempty"`
	CreatedAt   time.Time         `json:"created_at"`
	UpdatedAt   time.Time         `json:"updated_at"`
}

type WorkflowNode struct {
	ID          string                 `json:"id"`
	Type        string                 `json:"type"`        // e.g. "engine.secure.telegram" or "engine.builtin.if"
	Name        string                 `json:"name"`        // User-defined display name
	Parameters  map[string]interface{} `json:"parameters"`  // Config values set by user
	Position    [2]float64             `json:"position"`    // [x, y] canvas position
	Credentials map[string]string      `json:"credentials"` // { credentialType: credentialID }
	OnError     string                 `json:"on_error"`    // "stopWorkflow" | "continueRegularOutput" | "continueErrorOutput"
}

type Connection struct {
	SourceNodeID string `json:"source_node_id"`
	SourceOutput int    `json:"source_output"` // Output index (0 = main, 1+ = alternate)
	TargetNodeID string `json:"target_node_id"`
	TargetInput  int    `json:"target_input"`
}

type WorkflowSettings struct {
	Timezone         string `json:"timezone"`
	SaveExecutions   bool   `json:"save_executions"`
	MaxExecutionTime int    `json:"max_execution_time"` // seconds, 0 = unlimited
}

type TriggerConfig struct {
	Type       string `json:"type"`        // "cron" | "webhook" | "interval" | "manual"
	Cron       string `json:"cron"`        // Cron expression e.g. "*/5 * * * *"
	IntervalMs int    `json:"interval_ms"` // Interval in milliseconds
	WebhookURL string `json:"webhook_url"` // Auto-generated webhook path
	HTTPMethod string `json:"http_method"` // GET, POST, etc.
}

// ─── Execution Results ───────────────────────────────────────
type ExecutionStatus string

const (
	StatusRunning ExecutionStatus = "running"
	StatusSuccess ExecutionStatus = "success"
	StatusError   ExecutionStatus = "error"
)

type Execution struct {
	ID           string            `json:"id"`
	WorkflowID   string            `json:"workflow_id"`
	WorkflowName string            `json:"workflow_name"`
	Status       ExecutionStatus   `json:"status"`
	Mode         string            `json:"mode"` // "manual" | "trigger" | "webhook"
	StartedAt    time.Time         `json:"started_at"`
	FinishedAt   *time.Time        `json:"finished_at,omitempty"`
	Error        string            `json:"error,omitempty"`
	NodeResults  []NodeResult      `json:"node_results"`
}

type NodeResult struct {
	NodeID     string          `json:"node_id"`
	NodeName   string          `json:"node_name"`
	NodeType   string          `json:"node_type"`
	Status     ExecutionStatus `json:"status"`
	InputData  interface{}     `json:"input_data,omitempty"`
	OutputData interface{}     `json:"output_data,omitempty"`
	Error      string          `json:"error,omitempty"`
	StartedAt  time.Time       `json:"started_at"`
	Duration   int64           `json:"duration_ms"`
}
