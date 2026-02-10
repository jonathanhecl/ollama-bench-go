package sysmon

import (
	"fmt"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Results holds the resource monitoring results.
type Results struct {
	MinFreeRAMMB float64 `json:"min_free_ram_mb"`
	PeakCPUPct   float64 `json:"peak_cpu_pct"`
	PeakGPUPct   string  `json:"peak_gpu_pct"` // "N/A" if not available
}

// Monitor samples system resources in the background.
type Monitor struct {
	mu      sync.Mutex
	minFree float64
	peakCPU float64
	peakGPU string
	stop    chan struct{}
	wg      sync.WaitGroup
	started bool
}

// New creates a new Monitor.
func New() *Monitor {
	return &Monitor{
		minFree: -1,
		peakGPU: "N/A",
		stop:    make(chan struct{}),
	}
}

// Start begins background sampling every 500ms.
func (m *Monitor) Start() {
	m.mu.Lock()
	m.started = true
	m.minFree = -1
	m.peakCPU = 0
	m.peakGPU = "N/A"
	m.stop = make(chan struct{})
	m.mu.Unlock()

	m.wg.Add(1)
	go func() {
		defer m.wg.Done()
		ticker := time.NewTicker(500 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-m.stop:
				return
			case <-ticker.C:
				m.sample()
			}
		}
	}()
}

// Stop ends sampling and returns results.
func (m *Monitor) Stop() Results {
	m.mu.Lock()
	if m.started {
		close(m.stop)
		m.started = false
	}
	m.mu.Unlock()
	m.wg.Wait()

	m.mu.Lock()
	defer m.mu.Unlock()
	res := Results{
		MinFreeRAMMB: m.minFree,
		PeakCPUPct:   m.peakCPU,
		PeakGPUPct:   m.peakGPU,
	}
	if res.MinFreeRAMMB < 0 {
		res.MinFreeRAMMB = 0
	}
	return res
}

func (m *Monitor) sample() {
	// Free RAM
	freeRAM := getFreeRAMMB()
	m.mu.Lock()
	if m.minFree < 0 || freeRAM < m.minFree {
		m.minFree = freeRAM
	}
	m.mu.Unlock()

	// CPU usage
	cpuPct := getCPUUsage()
	m.mu.Lock()
	if cpuPct > m.peakCPU {
		m.peakCPU = cpuPct
	}
	m.mu.Unlock()

	// GPU usage
	gpuPct := getGPUUsage()
	if gpuPct != "N/A" {
		m.mu.Lock()
		if m.peakGPU == "N/A" {
			m.peakGPU = gpuPct
		} else {
			cur, _ := strconv.ParseFloat(strings.TrimSuffix(m.peakGPU, "%"), 64)
			nw, _ := strconv.ParseFloat(strings.TrimSuffix(gpuPct, "%"), 64)
			if nw > cur {
				m.peakGPU = gpuPct
			}
		}
		m.mu.Unlock()
	}
}

func getFreeRAMMB() float64 {
	switch runtime.GOOS {
	case "darwin":
		out, err := exec.Command("vm_stat").Output()
		if err != nil {
			return 0
		}
		lines := strings.Split(string(out), "\n")
		var pageSize int64 = 4096 // default
		for _, line := range lines {
			if strings.Contains(line, "page size of") {
				parts := strings.Fields(line)
				for i, p := range parts {
					if p == "of" && i+1 < len(parts) {
						ps, _ := strconv.ParseInt(parts[i+1], 10, 64)
						if ps > 0 {
							pageSize = ps
						}
					}
				}
			}
		}
		var freePages int64
		for _, line := range lines {
			if strings.HasPrefix(line, "Pages free:") {
				parts := strings.Fields(line)
				if len(parts) >= 3 {
					val := strings.TrimSuffix(parts[2], ".")
					freePages, _ = strconv.ParseInt(val, 10, 64)
				}
			}
		}
		return float64(freePages*pageSize) / 1024 / 1024

	case "linux":
		out, err := exec.Command("cat", "/proc/meminfo").Output()
		if err != nil {
			return 0
		}
		for _, line := range strings.Split(string(out), "\n") {
			if strings.HasPrefix(line, "MemAvailable:") {
				parts := strings.Fields(line)
				if len(parts) >= 2 {
					kb, _ := strconv.ParseFloat(parts[1], 64)
					return kb / 1024
				}
			}
		}
		return 0

	case "windows":
		out, err := exec.Command("wmic", "OS", "get", "FreePhysicalMemory", "/value").Output()
		if err != nil {
			return 0
		}
		for _, line := range strings.Split(string(out), "\n") {
			if strings.HasPrefix(strings.TrimSpace(line), "FreePhysicalMemory=") {
				val := strings.TrimPrefix(strings.TrimSpace(line), "FreePhysicalMemory=")
				kb, _ := strconv.ParseFloat(strings.TrimSpace(val), 64)
				return kb / 1024
			}
		}
		return 0
	}
	return 0
}

func getCPUUsage() float64 {
	switch runtime.GOOS {
	case "darwin":
		out, err := exec.Command("ps", "-A", "-o", "%cpu").Output()
		if err != nil {
			return 0
		}
		var total float64
		for _, line := range strings.Split(string(out), "\n") {
			line = strings.TrimSpace(line)
			if line == "" || line == "%CPU" {
				continue
			}
			val, _ := strconv.ParseFloat(line, 64)
			total += val
		}
		numCPU := float64(runtime.NumCPU())
		if numCPU > 0 {
			return total / numCPU
		}
		return total

	case "linux":
		out, err := exec.Command("sh", "-c", `grep 'cpu ' /proc/stat`).Output()
		if err != nil {
			return 0
		}
		fields := strings.Fields(string(out))
		if len(fields) < 5 {
			return 0
		}
		var total, idle float64
		for i := 1; i < len(fields); i++ {
			v, _ := strconv.ParseFloat(fields[i], 64)
			total += v
			if i == 4 {
				idle = v
			}
		}
		if total == 0 {
			return 0
		}
		return ((total - idle) / total) * 100

	case "windows":
		out, err := exec.Command("wmic", "cpu", "get", "loadpercentage", "/value").Output()
		if err != nil {
			return 0
		}
		for _, line := range strings.Split(string(out), "\n") {
			if strings.HasPrefix(strings.TrimSpace(line), "LoadPercentage=") {
				val := strings.TrimPrefix(strings.TrimSpace(line), "LoadPercentage=")
				pct, _ := strconv.ParseFloat(strings.TrimSpace(val), 64)
				return pct
			}
		}
		return 0
	}
	return 0
}

func getGPUUsage() string {
	out, err := exec.Command("nvidia-smi", "--query-gpu=utilization.gpu", "--format=csv,noheader,nounits").Output()
	if err != nil {
		return "N/A"
	}
	val := strings.TrimSpace(string(out))
	if val == "" {
		return "N/A"
	}
	// Could be multi-GPU; take max
	lines := strings.Split(val, "\n")
	var max float64
	for _, l := range lines {
		v, err := strconv.ParseFloat(strings.TrimSpace(l), 64)
		if err == nil && v > max {
			max = v
		}
	}
	return fmt.Sprintf("%.0f%%", max)
}
