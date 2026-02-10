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
	"github.com/jonathanhecl/ollama-bench-go/store"
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

const resultsFile = "bench_results.json"

// Handler serves the HTTP API and static files.
type Handler struct {
	client *ollama.Client
	runner *bench.Runner
	store  *store.ResultStore
}

// NewHandler creates a new HTTP handler.
func NewHandler(client *ollama.Client) *Handler {
	return &Handler{
		client: client,
		runner: bench.NewRunner(client),
		store:  store.New(resultsFile),
	}
}

// SetupRoutes configures all HTTP routes.
func (h *Handler) SetupRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/models", h.handleModels)
	mux.HandleFunc("/api/bench/", h.handleBench)
	mux.HandleFunc("/api/stress/", h.handleStress)
	mux.HandleFunc("/api/sysinfo", h.handleSysinfo)
	mux.HandleFunc("/api/results", h.handleResults)

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
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	modelName := strings.TrimPrefix(r.URL.Path, "/api/bench/")
	if modelName == "" {
		writeError(w, "Model name required")
		return
	}

	// SSE streaming response
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
		return
	}

	result := h.runner.RunBenchmarkWithProgress(modelName, func(event bench.ProgressEvent) {
		data, _ := json.Marshal(event)
		fmt.Fprintf(w, "data: %s\n\n", data)
		flusher.Flush()
	})

	// Persist result to disk
	if err := h.store.Save(modelName, result); err != nil {
		log.Printf("Warning: failed to save bench result for %s: %v", modelName, err)
	}
}

func (h *Handler) handleStress(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	modelName := strings.TrimPrefix(r.URL.Path, "/api/stress/")
	if modelName == "" {
		writeError(w, "Model name required")
		return
	}

	// SSE streaming response
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
		return
	}

	h.runner.RunStressTestWithProgress(modelName, func(event bench.ProgressEvent) {
		data, _ := json.Marshal(event)
		fmt.Fprintf(w, "data: %s\n\n", data)
		flusher.Flush()
	})
}

func (h *Handler) handleSysinfo(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	info := sysinfo.Gather()
	writeJSON(w, info)
}

func (h *Handler) handleResults(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	results := h.store.Load()
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
