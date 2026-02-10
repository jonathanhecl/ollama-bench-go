package ollama

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Client wraps the Ollama REST API.
type Client struct {
	BaseURL    string
	HTTPClient *http.Client
}

// NewClient creates a new Ollama API client.
func NewClient(baseURL string) *Client {
	return &Client{
		BaseURL: baseURL,
		HTTPClient: &http.Client{
			Timeout: 30 * time.Minute, // benchmarks can be long
		},
	}
}

// --- Models ---

type ModelDetails struct {
	ParentModel       string   `json:"parent_model"`
	Format            string   `json:"format"`
	Family            string   `json:"family"`
	Families          []string `json:"families"`
	ParameterSize     string   `json:"parameter_size"`
	QuantizationLevel string   `json:"quantization_level"`
}

type Model struct {
	Name       string       `json:"name"`
	Model      string       `json:"model"`
	ModifiedAt string       `json:"modified_at"`
	Size       int64        `json:"size"`
	Digest     string       `json:"digest"`
	Details    ModelDetails `json:"details"`
}

type ListModelsResponse struct {
	Models []Model `json:"models"`
}

func (c *Client) ListModels() ([]Model, error) {
	resp, err := c.HTTPClient.Get(c.BaseURL + "/api/tags")
	if err != nil {
		return nil, fmt.Errorf("list models: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("list models: status %d: %s", resp.StatusCode, string(body))
	}

	var result ListModelsResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("list models decode: %w", err)
	}
	return result.Models, nil
}

// --- Show Model ---

type ShowModelRequest struct {
	Model string `json:"model"`
}

type ShowModelResponse struct {
	Modelfile    string                 `json:"modelfile"`
	Parameters   string                 `json:"parameters"`
	Template     string                 `json:"template"`
	Details      ModelDetails           `json:"details"`
	ModelInfo    map[string]interface{} `json:"model_info"`
	Capabilities []string               `json:"capabilities"`
}

func (c *Client) ShowModel(name string) (*ShowModelResponse, error) {
	reqBody, _ := json.Marshal(ShowModelRequest{Model: name})
	resp, err := c.HTTPClient.Post(c.BaseURL+"/api/show", "application/json", bytes.NewReader(reqBody))
	if err != nil {
		return nil, fmt.Errorf("show model: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("show model: status %d: %s", resp.StatusCode, string(body))
	}

	var result ShowModelResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("show model decode: %w", err)
	}
	return &result, nil
}

// GetContextLength extracts the context length from model_info.
func (s *ShowModelResponse) GetContextLength() int64 {
	for key, val := range s.ModelInfo {
		if key == "context_length" || len(key) > 15 && key[len(key)-15:] == ".context_length" {
			switch v := val.(type) {
			case float64:
				return int64(v)
			case json.Number:
				n, _ := v.Int64()
				return n
			}
		}
	}
	return 0
}

// HasCapability checks if a capability is present.
func (s *ShowModelResponse) HasCapability(cap string) bool {
	for _, c := range s.Capabilities {
		if c == cap {
			return true
		}
	}
	return false
}

// --- Running Models ---

type RunningModel struct {
	Name     string       `json:"name"`
	Model    string       `json:"model"`
	Size     int64        `json:"size"`
	Digest   string       `json:"digest"`
	Details  ModelDetails `json:"details"`
	SizeVRAM int64        `json:"size_vram"`
}

type ListRunningResponse struct {
	Models []RunningModel `json:"models"`
}

func (c *Client) ListRunning() ([]RunningModel, error) {
	resp, err := c.HTTPClient.Get(c.BaseURL + "/api/ps")
	if err != nil {
		return nil, fmt.Errorf("list running: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("list running: status %d: %s", resp.StatusCode, string(body))
	}

	var result ListRunningResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("list running decode: %w", err)
	}
	return result.Models, nil
}

// IsModelLoaded checks if a model name is currently loaded.
func (c *Client) IsModelLoaded(modelName string) (bool, error) {
	running, err := c.ListRunning()
	if err != nil {
		return false, err
	}
	for _, m := range running {
		if m.Name == modelName || m.Model == modelName {
			return true, nil
		}
	}
	return false, nil
}

// --- Chat Completion ---

type ChatMessage struct {
	Role      string     `json:"role"`
	Content   string     `json:"content"`
	Images    []string   `json:"images,omitempty"`
	ToolCalls []ToolCall `json:"tool_calls,omitempty"`
}

type ToolCall struct {
	Function ToolFunction `json:"function"`
}

type ToolFunction struct {
	Name      string                 `json:"name"`
	Arguments map[string]interface{} `json:"arguments"`
}

type Tool struct {
	Type     string  `json:"type"`
	Function ToolDef `json:"function"`
}

type ToolDef struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Parameters  ToolParameters `json:"parameters"`
}

type ToolParameters struct {
	Type       string                           `json:"type"`
	Properties map[string]ToolParameterProperty `json:"properties"`
	Required   []string                         `json:"required"`
}

type ToolParameterProperty struct {
	Type        string `json:"type"`
	Description string `json:"description"`
}

type ChatRequest struct {
	Model    string                 `json:"model"`
	Messages []ChatMessage          `json:"messages"`
	Stream   bool                   `json:"stream"`
	Format   interface{}            `json:"format,omitempty"`
	Tools    []Tool                 `json:"tools,omitempty"`
	Options  map[string]interface{} `json:"options,omitempty"`
}

type ChatResponse struct {
	Model              string      `json:"model"`
	Message            ChatMessage `json:"message"`
	Done               bool        `json:"done"`
	TotalDuration      int64       `json:"total_duration"`
	LoadDuration       int64       `json:"load_duration"`
	PromptEvalCount    int         `json:"prompt_eval_count"`
	PromptEvalDuration int64       `json:"prompt_eval_duration"`
	EvalCount          int         `json:"eval_count"`
	EvalDuration       int64       `json:"eval_duration"`
}

func (c *Client) Chat(ctx context.Context, req ChatRequest) (*ChatResponse, error) {
	reqBody, _ := json.Marshal(req)
	httpreq, err := http.NewRequestWithContext(ctx, "POST", c.BaseURL+"/api/chat", bytes.NewReader(reqBody))
	if err != nil {
		return nil, fmt.Errorf("chat request: %w", err)
	}
	httpreq.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTPClient.Do(httpreq)
	if err != nil {
		return nil, fmt.Errorf("chat: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("chat: status %d: %s", resp.StatusCode, string(body))
	}

	var result ChatResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("chat decode: %w", err)
	}
	return &result, nil
}

// --- Embeddings ---

type EmbedRequest struct {
	Model string `json:"model"`
	Input string `json:"input"`
}

type EmbedResponse struct {
	Model         string      `json:"model"`
	Embeddings    interface{} `json:"embeddings"`
	TotalDuration int64       `json:"total_duration"`
	LoadDuration  int64       `json:"load_duration"`
}

func (c *Client) Embed(ctx context.Context, model, input string) (*EmbedResponse, error) {
	reqBody, _ := json.Marshal(EmbedRequest{Model: model, Input: input})
	httpreq, err := http.NewRequestWithContext(ctx, "POST", c.BaseURL+"/api/embed", bytes.NewReader(reqBody))
	if err != nil {
		return nil, fmt.Errorf("embed request: %w", err)
	}
	httpreq.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTPClient.Do(httpreq)
	if err != nil {
		return nil, fmt.Errorf("embed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("embed: status %d: %s", resp.StatusCode, string(body))
	}

	var result EmbedResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("embed decode: %w", err)
	}
	return &result, nil
}
