package server

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"strings"

	"github.com/jonathanhecl/ollama-bench-go/bench"
	"github.com/jonathanhecl/ollama-bench-go/ollama"
	"github.com/jonathanhecl/ollama-bench-go/sysinfo"
	"github.com/jonathanhecl/ollama-bench-go/web"
)

// ModelInfo is the JSON response for model listing.
type ModelInfo struct {
	Name              string   `json:"name"`
	Family            string   `json:"family"`
	ParameterSize     string   `json:"parameter_size"`
	QuantizationLevel string   `json:"quantization_level"`
	SizeBytes         int64    `json:"size_bytes"`
	SizeMB            float64  `json:"size_mb"`
	ContextLength     int64    `json:"context_length"`
	Capabilities      []string `json:"capabilities"`
	IsLoaded          bool     `json:"is_loaded"`
}

// Handler serves the HTTP API and static files.
type Handler struct {
	client *ollama.Client
	runner *bench.Runner
}

// NewHandler creates a new HTTP handler.
func NewHandler(client *ollama.Client) *Handler {
	return &Handler{
		client: client,
		runner: bench.NewRunner(client),
	}
}

// SetupRoutes configures all HTTP routes.
func (h *Handler) SetupRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/models", h.handleModels)
	mux.HandleFunc("/api/bench/", h.handleBench)
	mux.HandleFunc("/api/stress/", h.handleStress)
	mux.HandleFunc("/api/sysinfo", h.handleSysinfo)

	// Serve embedded static files
	staticFS, err := fs.Sub(web.StaticFiles, "static")
	if err != nil {
		log.Fatal("Failed to create sub filesystem:", err)
	}
	mux.Handle("/", http.FileServer(http.FS(staticFS)))
}

func (h *Handler) handleModels(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	models, err := h.client.ListModels()
	if err != nil {
		writeError(w, fmt.Sprintf("Failed to list models: %v", err))
		return
	}

	// Get running models
	running, err := h.client.ListRunning()
	runningMap := make(map[string]bool)
	if err == nil {
		for _, rm := range running {
			runningMap[rm.Name] = true
			runningMap[rm.Model] = true
		}
	}

	var result []ModelInfo
	for _, m := range models {
		mi := ModelInfo{
			Name:              m.Name,
			Family:            m.Details.Family,
			ParameterSize:     m.Details.ParameterSize,
			QuantizationLevel: m.Details.QuantizationLevel,
			SizeBytes:         m.Size,
			SizeMB:            float64(m.Size) / 1024 / 1024,
			IsLoaded:          runningMap[m.Name] || runningMap[m.Model],
		}

		// Get extra info from show
		info, err := h.client.ShowModel(m.Name)
		if err == nil {
			mi.ContextLength = info.GetContextLength()
			mi.Capabilities = info.Capabilities
		}

		result = append(result, mi)
	}

	writeJSON(w, result)
}

func (h *Handler) handleBench(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	modelName := strings.TrimPrefix(r.URL.Path, "/api/bench/")
	if modelName == "" {
		writeError(w, "Model name required")
		return
	}

	result := h.runner.RunBenchmark(modelName)
	writeJSON(w, result)
}

func (h *Handler) handleStress(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	modelName := strings.TrimPrefix(r.URL.Path, "/api/stress/")
	if modelName == "" {
		writeError(w, "Model name required")
		return
	}

	results := h.runner.RunStressTest(modelName)
	writeJSON(w, results)
}

func writeJSON(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusInternalServerError)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func (h *Handler) handleSysinfo(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	info := sysinfo.Gather()
	writeJSON(w, info)
}
