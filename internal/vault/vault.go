//#######################################################################
// File NAME : internal/vault/vault.go
// Server-Side Credential Vault — AES-256-GCM encrypted storage
// Credentials accessible by background workflows without GUI
//#######################################################################
package vault

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"
)

var MasterKey = []byte("fl0w0rk_0s_s3cr3t_m4st3rk3y_256b") // 32 bytes — same as pack-nodes.js

// Credential represents a single stored credential
type Credential struct {
	ID        string                 `json:"id"`
	Type      string                 `json:"type"`       // e.g. "httpHeaderAuth", "gmailOAuth2"
	Name      string                 `json:"name"`       // User-assigned name
	Data      map[string]interface{} `json:"data"`       // Actual secret values (API keys, tokens)
	CreatedAt time.Time              `json:"created_at"`
	UpdatedAt time.Time              `json:"updated_at"`
}

// CredentialSummary is a safe version without secret data (for listing)
type CredentialSummary struct {
	ID        string    `json:"id"`
	Type      string    `json:"type"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"created_at"`
}

// Vault manages encrypted credential storage
type Vault struct {
	filePath    string
	credentials map[string]*Credential
	mutex       sync.RWMutex
}

func NewVault(baseDir string) *Vault {
	v := &Vault{
		filePath:    filepath.Join(baseDir, "credentials.enc"),
		credentials: make(map[string]*Credential),
	}
	v.load()
	return v
}

// Save stores a credential
func (v *Vault) Save(cred *Credential) error {
	v.mutex.Lock()
	defer v.mutex.Unlock()

	if cred.ID == "" {
		cred.ID = fmt.Sprintf("%s_%d", cred.Type, time.Now().UnixMilli())
	}
	cred.UpdatedAt = time.Now()
	if cred.CreatedAt.IsZero() {
		cred.CreatedAt = time.Now()
	}

	v.credentials[cred.ID] = cred
	log.Printf("[Vault] 🔐 Saved credential: %s (%s)", cred.Name, cred.Type)
	return v.persist()
}

// Get retrieves a credential by ID
func (v *Vault) Get(id string) (*Credential, error) {
	v.mutex.RLock()
	defer v.mutex.RUnlock()

	cred, exists := v.credentials[id]
	if !exists {
		return nil, fmt.Errorf("credential not found: %s", id)
	}
	return cred, nil
}

// GetByType retrieves the most recent credential of a given type
func (v *Vault) GetByType(credType string) (*Credential, error) {
	v.mutex.RLock()
	defer v.mutex.RUnlock()

	var latest *Credential
	for _, cred := range v.credentials {
		if cred.Type == credType {
			if latest == nil || cred.UpdatedAt.After(latest.UpdatedAt) {
				latest = cred
			}
		}
	}

	if latest == nil {
		return nil, fmt.Errorf("no credential of type '%s' found", credType)
	}
	return latest, nil
}

// List returns summaries of all credentials (no secret data)
func (v *Vault) List() []CredentialSummary {
	v.mutex.RLock()
	defer v.mutex.RUnlock()

	var summaries []CredentialSummary
	for _, cred := range v.credentials {
		summaries = append(summaries, CredentialSummary{
			ID:        cred.ID,
			Type:      cred.Type,
			Name:      cred.Name,
			CreatedAt: cred.CreatedAt,
		})
	}
	return summaries
}

// Delete removes a credential
func (v *Vault) Delete(id string) error {
	v.mutex.Lock()
	defer v.mutex.Unlock()

	if _, exists := v.credentials[id]; !exists {
		return fmt.Errorf("credential not found: %s", id)
	}
	delete(v.credentials, id)
	log.Printf("[Vault] 🗑️ Deleted credential: %s", id)
	return v.persist()
}

// Update modifies credential data
func (v *Vault) Update(id string, newData map[string]interface{}) error {
	v.mutex.Lock()
	defer v.mutex.Unlock()

	cred, exists := v.credentials[id]
	if !exists {
		return fmt.Errorf("credential not found: %s", id)
	}

	for k, val := range newData {
		cred.Data[k] = val
	}
	cred.UpdatedAt = time.Now()
	return v.persist()
}

// ─── Encryption Layer ────────────────────────────────────────

func (v *Vault) persist() error {
	os.MkdirAll(filepath.Dir(v.filePath), os.ModePerm)

	data, err := json.Marshal(v.credentials)
	if err != nil {
		return fmt.Errorf("failed to marshal vault: %v", err)
	}

	encrypted, err := encrypt(data)
	if err != nil {
		return fmt.Errorf("failed to encrypt vault: %v", err)
	}

	return ioutil.WriteFile(v.filePath, encrypted, 0600)
}

func (v *Vault) load() {
	data, err := ioutil.ReadFile(v.filePath)
	if err != nil {
		log.Println("[Vault] ℹ️ No existing vault found, starting fresh.")
		return
	}

	decrypted, err := decrypt(data)
	if err != nil {
		log.Printf("[Vault] ⚠️ Failed to decrypt vault: %v (may be corrupted)", err)
		return
	}

	if err := json.Unmarshal(decrypted, &v.credentials); err != nil {
		log.Printf("[Vault] ⚠️ Failed to parse vault JSON: %v", err)
	} else {
		log.Printf("[Vault] 🔐 Loaded %d credential(s) from encrypted vault.", len(v.credentials))
	}
}

func encrypt(plaintext []byte) ([]byte, error) {
	block, err := aes.NewCipher(MasterKey)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return gcm.Seal(nonce, nonce, plaintext, nil), nil
}

func decrypt(ciphertext []byte) ([]byte, error) {
	block, err := aes.NewCipher(MasterKey)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonceSize := gcm.NonceSize()
	if len(ciphertext) < nonceSize {
		return nil, fmt.Errorf("ciphertext too short")
	}
	nonce, ciphertext := ciphertext[:nonceSize], ciphertext[nonceSize:]
	return gcm.Open(nil, nonce, ciphertext, nil)
}
