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
	// Link helper for terminals that support OSC 8
	makeLink := func(url, text string) string {
		return fmt.Sprintf("\033]8;;%s\033\\%s\033]8;;\033\\", url, text)
	}

	webURL := "http://localhost" + addr
	ollamaLink := makeLink(*ollamaURL, *ollamaURL)
	webLink := makeLink(webURL, webURL)

	// Since escape codes have 0 width in terminal but count in Go strings,
	// we use the original length for padding.
	ollamaPad := 30 + (len(ollamaLink) - len(*ollamaURL))
	webPad := 30 + (len(webLink) - len(webURL))

	fmt.Println("╔══════════════════════════════════════════╗")
	fmt.Println("║         ⚡ Ollama Bench GO v1.4          ║")
	fmt.Println("╠══════════════════════════════════════════╣")
	fmt.Printf("║  Ollama:  %-*s ║\n", ollamaPad, ollamaLink)
	fmt.Printf("║  Web UI:  %-*s ║\n", webPad, webLink)
	fmt.Println("╚══════════════════════════════════════════╝")
	fmt.Println()

	log.Printf("Starting server on %s...\n", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatal("Server error:", err)
	}
}
