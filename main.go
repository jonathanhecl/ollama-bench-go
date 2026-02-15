package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/jonathanhecl/ollama-bench-go/ollama"
	"github.com/jonathanhecl/ollama-bench-go/server"
)

func main() {
	ollamaURL := flag.String("url", "http://localhost:11434", "Ollama API base URL")
	port := flag.String("port", "8085", "HTTP server port")
	flag.Parse()

	// Also accept positional arg for URL
	if flag.NArg() > 0 {
		*ollamaURL = flag.Arg(0)
	}

	// Clean up URL
	*ollamaURL = strings.TrimRight(*ollamaURL, "/")
	// Remove /v1 suffix if present (we use the native API)
	*ollamaURL = strings.TrimSuffix(*ollamaURL, "/v1")

	client := ollama.NewClient(*ollamaURL)

	mux := http.NewServeMux()
	handler := server.NewHandler(client)
	handler.SetupRoutes(mux)

	addr := ":" + *port
	fmt.Println("╔══════════════════════════════════════════╗")
	fmt.Println("║         ⚡ Ollama Bench GO v1.2          ║")
	fmt.Println("╠══════════════════════════════════════════╣")
	fmt.Printf("║  Ollama:  %-30s ║\n", *ollamaURL)
	fmt.Printf("║  Web UI:  %-30s ║\n", "http://localhost"+addr)
	fmt.Println("╚══════════════════════════════════════════╝")
	fmt.Println()

	log.Printf("Starting server on %s...\n", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatal("Server error:", err)
	}
}
