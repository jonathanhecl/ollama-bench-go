package store

import (
	"encoding/json"
	"os"
	"sync"

	"github.com/jonathanhecl/ollama-bench-go/bench"
)

// ResultStore manages persistent benchmark results on disk.
type ResultStore struct {
	mu   sync.Mutex
	path string
}

// New creates a ResultStore that reads/writes to the given file path.
func New(path string) *ResultStore {
	return &ResultStore{path: path}
}

// Load reads all saved results from disk. Returns an empty map if the file
// does not exist or cannot be parsed.
func (s *ResultStore) Load() map[string]bench.BenchResult {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := os.ReadFile(s.path)
	if err != nil {
		return make(map[string]bench.BenchResult)
	}

	var results map[string]bench.BenchResult
	if err := json.Unmarshal(data, &results); err != nil {
		return make(map[string]bench.BenchResult)
	}
	return results
}

// Save writes the provided result for a model, overwriting any previous
// result for the same model name.
func (s *ResultStore) Save(modelName string, result bench.BenchResult) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Read existing
	all := make(map[string]bench.BenchResult)
	data, err := os.ReadFile(s.path)
	if err == nil {
		json.Unmarshal(data, &all) // ignore parse errors, start fresh
	}

	// Update entry
	all[modelName] = result

	// Write back
	out, err := json.MarshalIndent(all, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, out, 0644)
}
