//#######################################################################
// File NAME : internal/workflow/runner.go
// Headless Workflow Runner — DAG Executor
//
// Executes entire workflow JSON independently without GUI.
// Topologically sorts nodes, passes data between them,
// handles conditional routing (If/Switch), and collects results.
//#######################################################################
package workflow

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"flowork-engine/internal/runner"
	"flowork-engine/internal/vault"
)

// WorkflowRunner is the headless executor for full workflows
type WorkflowRunner struct {
	NodeManager *runner.NodeManager
	Vault       *vault.Vault // Credential vault for secret injection
	OnProgress  func(nodeID string, status string, data interface{}) // Real-time callback
}

func NewWorkflowRunner(nm *runner.NodeManager, v ...*vault.Vault) *WorkflowRunner {
	wr := &WorkflowRunner{
		NodeManager: nm,
	}
	if len(v) > 0 && v[0] != nil {
		wr.Vault = v[0]
	}
	return wr
}

// Execute runs a complete workflow and returns the execution result
func (wr *WorkflowRunner) Execute(wf *Workflow, mode string, triggerData interface{}) *Execution {
	executionID := fmt.Sprintf("exec_%d", time.Now().UnixMilli())

	exec := &Execution{
		ID:           executionID,
		WorkflowID:   wf.ID,
		WorkflowName: wf.Name,
		Status:       StatusRunning,
		Mode:         mode,
		StartedAt:    time.Now(),
		NodeResults:  []NodeResult{},
	}

	// [NEW] Persist execution history to local JSON database automatically upon return
	defer wr.SaveExecutionHistory(exec)

	// [N8N PARITY UPGRADE] Setup temporary binary data directory for file handling
	binaryTempDir := filepath.Join(wr.NodeManager.BaseDir, "temp_binary", wf.ID, executionID)
	os.MkdirAll(binaryTempDir, os.ModePerm)
	defer os.RemoveAll(binaryTempDir)

	log.Printf("\n[WorkflowRunner] ⚡ Starting workflow execution: %s (%s)", wf.Name, executionID)
	log.Printf("[WorkflowRunner] 📁 Temp Binary Scope created: %s", binaryTempDir)
	log.Printf("[WorkflowRunner] 📊 Nodes: %d | Connections: %d | Mode: %s", len(wf.Nodes), len(wf.Connections), mode)

	// Build node lookup map
	nodeMap := make(map[string]*WorkflowNode)
	for i := range wf.Nodes {
		nodeMap[wf.Nodes[i].ID] = &wf.Nodes[i]
	}

	// Build adjacency: nodeID → outgoing connections grouped by output index
	outgoing := make(map[string]map[int][]Connection) // nodeID → outputIndex → []Connection
	incoming := make(map[string]int)                    // nodeID → number of incoming connections

	for _, conn := range wf.Connections {
		if outgoing[conn.SourceNodeID] == nil {
			outgoing[conn.SourceNodeID] = make(map[int][]Connection)
		}
		outgoing[conn.SourceNodeID][conn.SourceOutput] = append(
			outgoing[conn.SourceNodeID][conn.SourceOutput], conn,
		)
		incoming[conn.TargetNodeID]++
	}

	// Topological sort (Kahn's algorithm)
	order, err := wr.topologicalSort(wf.Nodes, incoming, outgoing)
	if err != nil {
		exec.Status = StatusError
		exec.Error = err.Error()
		now := time.Now()
		exec.FinishedAt = &now
		log.Printf("[WorkflowRunner] ❌ Topological sort failed: %v", err)
		return exec
	}

	log.Printf("[WorkflowRunner] 📋 Execution order: %v", order)

	// Data store: nodeID → output data (per output index)
	nodeOutputs := make(map[string]map[int]interface{}) // nodeID → outputIndex → data

	// Execute nodes in topological order
	for _, nodeID := range order {
		node, exists := nodeMap[nodeID]
		if !exists {
			continue
		}

		nodeStart := time.Now()
		result := NodeResult{
			NodeID:    nodeID,
			NodeName:  node.Name,
			NodeType:  node.Type,
			StartedAt: nodeStart,
		}

		// Collect input data from predecessor nodes
		inputData := wr.collectInputData(nodeID, wf.Connections, nodeOutputs)

		// If this is the first node and we have trigger data, use that
		if inputData == nil && triggerData != nil {
			inputData = triggerData
		}

		result.InputData = inputData

		// Fire progress callback
		if wr.OnProgress != nil {
			wr.OnProgress(nodeID, "running", nil)
		}

		log.Printf("[WorkflowRunner] ▶️  Executing node: %s (%s)", node.Name, node.Type)

		// Build execution payload
		execPayload := map[string]interface{}{
			"config": node.Parameters,
		}
		if inputData != nil {
			// Merge input data into payload
			if inputMap, ok := inputData.(map[string]interface{}); ok {
				for k, v := range inputMap {
					execPayload[k] = v
				}
			}
		}

		// [UPGRADED] Resolve ={{ $json.field }} expressions in parameters
		var contextMap map[string]interface{}
		if inputMap, ok := inputData.(map[string]interface{}); ok {
			contextMap = inputMap
		} else if inputArr, ok := inputData.([]interface{}); ok && len(inputArr) > 0 {
			// N8N Parity: Take the first item's 'json' field if available
			if firstItem, isMap := inputArr[0].(map[string]interface{}); isMap {
				if jsonField, hasJson := firstItem["json"].(map[string]interface{}); hasJson {
					contextMap = jsonField
				} else {
					contextMap = firstItem
				}
			}
		}

		if contextMap != nil {
			execPayload["config"] = runner.ResolveExpressions(node.Parameters, contextMap)
		}

		// [UPGRADED] Inject credential secrets from vault into config
		if wr.Vault != nil && len(node.Credentials) > 0 {
			configMap, _ := execPayload["config"].(map[string]interface{})
			if configMap == nil {
				configMap = make(map[string]interface{})
			}
			credData := make(map[string]interface{})
			for credType, credID := range node.Credentials {
				cred, err := wr.Vault.Get(credID)
				if err != nil {
					log.Printf("[WorkflowRunner] ⚠️ Credential '%s' (%s) not found in vault: %v", credID, credType, err)
					continue
				}
				credData[credType] = cred.Data
				log.Printf("[WorkflowRunner] 🔐 Injected credential '%s' (%s) for node %s", cred.Name, credType, node.Name)
			}
			if len(credData) > 0 {
				configMap["_credentials"] = credData
				execPayload["config"] = configMap
			}
		}

		// Execute the node via NodeManager
		output, execErr := wr.NodeManager.Execute(node.Type, execPayload, binaryTempDir)

		result.Duration = time.Since(nodeStart).Milliseconds()

		if execErr != nil {
			result.Status = StatusError
			result.Error = execErr.Error()
			log.Printf("[WorkflowRunner] ❌ Node %s failed: %v", node.Name, execErr)

			// Handle error routing
			if node.OnError == "continueRegularOutput" || node.OnError == "continueErrorOutput" {
				log.Printf("[WorkflowRunner] ⚠️  Node configured to continue on error, proceeding...")

				errorData := map[string]interface{}{
					"error":     execErr.Error(),
					"_hasError": true,
				}

				if nodeOutputs[nodeID] == nil {
					nodeOutputs[nodeID] = make(map[int]interface{})
				}

				if node.OnError == "continueErrorOutput" {
					nodeOutputs[nodeID][1] = errorData
				} else {
					nodeOutputs[nodeID][0] = errorData
				}
			} else {
				// Default: stop workflow on error
				exec.NodeResults = append(exec.NodeResults, result)
				exec.Status = StatusError
				exec.Error = fmt.Sprintf("Node '%s' failed: %s", node.Name, execErr.Error())
				now := time.Now()
				exec.FinishedAt = &now

				if wr.OnProgress != nil {
					wr.OnProgress(nodeID, "error", execErr.Error())
				}
				return exec
			}
		} else {
			result.Status = StatusSuccess
			result.OutputData = output
			log.Printf("[WorkflowRunner] ✅ Node %s completed in %dms", node.Name, result.Duration)

			if nodeOutputs[nodeID] == nil {
				nodeOutputs[nodeID] = make(map[int]interface{})
			}

			// [N8N PARITY UPGRADE]: Support Multidimensional Array Routing
			// If output is [[...], [...]], distribute it to port 0, 1, 2, ...
			isMultiDimensional := false
			if outArr, ok := output.([]interface{}); ok && len(outArr) > 0 {
				if _, isInnerArr := outArr[0].([]interface{}); isInnerArr {
					isMultiDimensional = true
					for i, innerArr := range outArr {
						// Only map if it's not empty, or map it anyway so empty ports exist
						nodeOutputs[nodeID][i] = innerArr
					}
				}
			}

			if !isMultiDimensional {
				// Classic Flowork fallback
				activeOutputIndex := 0
				if outputMap, ok := output.(map[string]interface{}); ok {
					if idx, hasIdx := outputMap["activeOutputIndex"]; hasIdx {
						switch v := idx.(type) {
						case float64:
							activeOutputIndex = int(v)
						case int:
							activeOutputIndex = v
						}
					}
				}
				nodeOutputs[nodeID][activeOutputIndex] = output
			}
		}

		exec.NodeResults = append(exec.NodeResults, result)

		if wr.OnProgress != nil {
			wr.OnProgress(nodeID, string(result.Status), result.OutputData)
		}
	}

	exec.Status = StatusSuccess
	now := time.Now()
	exec.FinishedAt = &now

	totalDuration := time.Since(exec.StartedAt).Milliseconds()
	log.Printf("[WorkflowRunner] 🏁 Workflow '%s' completed in %dms | Nodes executed: %d", wf.Name, totalDuration, len(exec.NodeResults))

	return exec
}

// collectInputData gathers output data from predecessor nodes
func (wr *WorkflowRunner) collectInputData(nodeID string, connections []Connection, nodeOutputs map[string]map[int]interface{}) interface{} {
	var collectedData interface{}

	for _, conn := range connections {
		if conn.TargetNodeID == nodeID {
			if outputs, ok := nodeOutputs[conn.SourceNodeID]; ok {
				if data, hasOutput := outputs[conn.SourceOutput]; hasOutput {
					if collectedData == nil {
						collectedData = data
					} else {
						// Merge if both are maps
						if currentMap, isMap1 := collectedData.(map[string]interface{}); isMap1 {
							if newMap, isMap2 := data.(map[string]interface{}); isMap2 {
								for k, v := range newMap {
									currentMap[k] = v
								}
								collectedData = currentMap
							}
						} else if currentArr, isArr1 := collectedData.([]interface{}); isArr1 {
							// Append if both are arrays
							if newArr, isArr2 := data.([]interface{}); isArr2 {
								collectedData = append(currentArr, newArr...)
							}
						}
					}
				}
			}
		}
	}

	if collectedData == nil {
		return nil
	}
	return collectedData
}

// topologicalSort performs Kahn's algorithm for DAG ordering
func (wr *WorkflowRunner) topologicalSort(nodes []WorkflowNode, incoming map[string]int, outgoing map[string]map[int][]Connection) ([]string, error) {
	inDegree := make(map[string]int)
	for _, node := range nodes {
		inDegree[node.ID] = incoming[node.ID]
	}

	var queue []string
	for _, node := range nodes {
		if inDegree[node.ID] == 0 {
			queue = append(queue, node.ID)
		}
	}

	var order []string

	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		order = append(order, current)

		if outputs, ok := outgoing[current]; ok {
			for _, conns := range outputs {
				for _, conn := range conns {
					inDegree[conn.TargetNodeID]--
					if inDegree[conn.TargetNodeID] == 0 {
						queue = append(queue, conn.TargetNodeID)
					}
				}
			}
		}
	}

	if len(order) != len(nodes) {
		return nil, fmt.Errorf("workflow contains a cycle — cannot execute")
	}

	return order, nil
}

// ═══════════════════════════════════════════════════════════════
// Workflow Storage (JSON files on disk)
// ═══════════════════════════════════════════════════════════════

type WorkflowStore struct {
	BaseDir string
}

func NewWorkflowStore(baseDir string) *WorkflowStore {
	return &WorkflowStore{BaseDir: baseDir}
}

func (ws *WorkflowStore) Save(wf *Workflow) error {
	os.MkdirAll(ws.BaseDir, os.ModePerm)

	wf.UpdatedAt = time.Now()
	if wf.CreatedAt.IsZero() {
		wf.CreatedAt = time.Now()
	}
	if wf.ID == "" {
		wf.ID = fmt.Sprintf("wf_%d", time.Now().UnixMilli())
	}

	data, err := json.MarshalIndent(wf, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal workflow: %v", err)
	}

	filePath := filepath.Join(ws.BaseDir, wf.ID+".json")
	return ioutil.WriteFile(filePath, data, 0644)
}

func (ws *WorkflowStore) Load(id string) (*Workflow, error) {
	filePath := filepath.Join(ws.BaseDir, id+".json")
	data, err := ioutil.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("workflow not found: %s", id)
	}

	var wf Workflow
	if err := json.Unmarshal(data, &wf); err != nil {
		return nil, fmt.Errorf("failed to parse workflow: %v", err)
	}
	return &wf, nil
}

func (ws *WorkflowStore) List() ([]Workflow, error) {
	entries, err := ioutil.ReadDir(ws.BaseDir)
	if err != nil {
		return []Workflow{}, nil
	}

	var workflows []Workflow
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}

		id := strings.TrimSuffix(entry.Name(), ".json")
		wf, err := ws.Load(id)
		if err == nil {
			workflows = append(workflows, *wf)
		}
	}
	return workflows, nil
}

func (ws *WorkflowStore) Delete(id string) error {
	return os.Remove(filepath.Join(ws.BaseDir, id+".json"))
}

func (ws *WorkflowStore) GetActive() ([]Workflow, error) {
	all, err := ws.List()
	if err != nil {
		return nil, err
	}
	var active []Workflow
	for _, wf := range all {
		if wf.Active {
			active = append(active, wf)
		}
	}
	return active, nil
}

// SaveExecutionHistory writes the final Execution payload to a JSON flat-file equivalent to N8N's Execution DB.
func (wr *WorkflowRunner) SaveExecutionHistory(exec *Execution) {
	if exec == nil || exec.WorkflowID == "" {
		return
	}

	// Store history inside <EngineDir>/data/history/<workflow_id>/<exec_id>.json
	historyDir := filepath.Join(wr.NodeManager.BaseDir, "..", "data", "history", exec.WorkflowID)
	os.MkdirAll(historyDir, os.ModePerm)

	filePath := filepath.Join(historyDir, exec.ID+".json")
	
	// Create JSON payload
	jsonData, err := json.MarshalIndent(exec, "", "  ")
	if err != nil {
		log.Printf("[WorkflowRunner] ⚠️ Failed to marshal execution history: %v", err)
		return
	}

	err = ioutil.WriteFile(filePath, jsonData, 0644)
	if err != nil {
		log.Printf("[WorkflowRunner] ❌ Failed to write execution history JSON: %v", err)
	} else {
		log.Printf("[WorkflowRunner] 🗄️ Execution Log safely persisted to: %s", filePath)
	}
}
