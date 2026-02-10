# Ollama Bench Go

A self-contained Go binary that serves a web dashboard to benchmark your local Ollama models.

## Features

- **Model Listing** — View all installed models with size, context length, family, params, quantization, and loaded status
- **Performance Benchmark** — Load time, tokens/sec, eval count with pre-load detection
- **Capability Testing** — JSON support, tool calling, vision, embeddings
- **Agent Skills Test** — Validates correct tool selection, arguments, and format (scored /3)
- **Ethics & Morality Tests** — Checks if model refuses illegal/immoral requests
- **Context Stress Test** — Tests at 2K, 4K, 8K, 16K, 32K, 64K, 100K, 200K tokens
- **System Monitoring** — Tracks free RAM, peak CPU%, and peak GPU% during tests
- **Dark Theme Web UI** — Modern, responsive dashboard served from the binary
- **Zero Dependencies** — Only Go standard library, single binary

## Usage

```bash
# Build
go build -o ollama-bench ./

# Run (default: localhost:11434)
./ollama-bench

# Custom Ollama URL
./ollama-bench -url http://192.168.1.100:11434

# Custom port
./ollama-bench -port 9090
```

Then open `http://localhost:8085` in your browser.

## License

See [LICENSE](LICENSE) file.