//#######################################################################
// File NAME : internal/config/envstore.go
// Global / Environment Variables Store
// Engine-level variables accessible by all workflows via $env
//#######################################################################
package config

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"
	"sync"
)

// EnvStore manages global environment variables
type EnvStore struct {
	filePath  string
	variables map[string]string
	mutex     sync.RWMutex
}

func NewEnvStore(baseDir string) *EnvStore {
	store := &EnvStore{
		filePath:  filepath.Join(baseDir, "variables.json"),
		variables: make(map[string]string),
	}
	store.load()
	return store
}

// Set stores a variable
func (es *EnvStore) Set(key, value string) error {
	es.mutex.Lock()
	defer es.mutex.Unlock()

	es.variables[key] = value
	log.Printf("[EnvStore] ✅ Set variable: %s", key)
	return es.persist()
}

// Get retrieves a variable
func (es *EnvStore) Get(key string) (string, bool) {
	es.mutex.RLock()
	defer es.mutex.RUnlock()

	val, ok := es.variables[key]
	return val, ok
}

// GetAll returns all variables
func (es *EnvStore) GetAll() map[string]string {
	es.mutex.RLock()
	defer es.mutex.RUnlock()

	result := make(map[string]string)
	for k, v := range es.variables {
		result[k] = v
	}
	return result
}

// Delete removes a variable
func (es *EnvStore) Delete(key string) error {
	es.mutex.Lock()
	defer es.mutex.Unlock()

	if _, exists := es.variables[key]; !exists {
		return fmt.Errorf("variable not found: %s", key)
	}

	delete(es.variables, key)
	log.Printf("[EnvStore] 🗑️ Deleted variable: %s", key)
	return es.persist()
}

// GetAsEnvVars returns variables formatted as OS env vars (FLOWORK_VAR_KEY=value)
func (es *EnvStore) GetAsEnvVars() []string {
	es.mutex.RLock()
	defer es.mutex.RUnlock()

	var envVars []string
	for k, v := range es.variables {
		envVars = append(envVars, fmt.Sprintf("FLOWORK_VAR_%s=%s", k, v))
	}
	return envVars
}

// ─── Persistence ─────────────────────────────────────────────

func (es *EnvStore) persist() error {
	os.MkdirAll(filepath.Dir(es.filePath), os.ModePerm)

	data, err := json.MarshalIndent(es.variables, "", "  ")
	if err != nil {
		return err
	}
	return ioutil.WriteFile(es.filePath, data, 0644)
}

func (es *EnvStore) load() {
	data, err := ioutil.ReadFile(es.filePath)
	if err != nil {
		return
	}

	if err := json.Unmarshal(data, &es.variables); err != nil {
		log.Printf("[EnvStore] ⚠️ Failed to parse variables.json: %v", err)
	} else {
		log.Printf("[EnvStore] 🌍 Loaded %d global variable(s).", len(es.variables))
	}
}
