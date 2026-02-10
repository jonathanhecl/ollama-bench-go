package sysinfo

import (
	"fmt"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
)

// Info holds host machine information.
type Info struct {
	OS         string `json:"os"`
	Arch       string `json:"arch"`
	CPUModel   string `json:"cpu_model"`
	CPUCores   int    `json:"cpu_cores"`
	TotalRAMMB int64  `json:"total_ram_mb"`
	TotalRAMGB string `json:"total_ram_gb"`
	GPUModel   string `json:"gpu_model"`
	Hostname   string `json:"hostname"`
}

// Gather collects system information.
func Gather() Info {
	info := Info{
		OS:       runtime.GOOS + "/" + runtime.GOARCH,
		Arch:     runtime.GOARCH,
		CPUCores: runtime.NumCPU(),
	}

	info.Hostname = getHostname()
	info.CPUModel = getCPUModel()
	info.TotalRAMMB = getTotalRAMMB()
	info.TotalRAMGB = fmt.Sprintf("%.1f GB", float64(info.TotalRAMMB)/1024)
	info.GPUModel = getGPUModel()

	return info
}

func getHostname() string {
	out, err := exec.Command("hostname").Output()
	if err != nil {
		return "unknown"
	}
	return strings.TrimSpace(string(out))
}

func getCPUModel() string {
	switch runtime.GOOS {
	case "darwin":
		out, err := exec.Command("sysctl", "-n", "machdep.cpu.brand_string").Output()
		if err != nil {
			// Try Apple Silicon
			out2, err2 := exec.Command("sysctl", "-n", "hw.model").Output()
			if err2 != nil {
				return "unknown"
			}
			return strings.TrimSpace(string(out2))
		}
		return strings.TrimSpace(string(out))

	case "linux":
		out, err := exec.Command("sh", "-c", `grep -m1 'model name' /proc/cpuinfo | cut -d: -f2`).Output()
		if err != nil {
			return "unknown"
		}
		return strings.TrimSpace(string(out))

	case "windows":
		out, err := exec.Command("wmic", "cpu", "get", "name", "/value").Output()
		if err != nil {
			return "unknown"
		}
		for _, line := range strings.Split(string(out), "\n") {
			if strings.HasPrefix(strings.TrimSpace(line), "Name=") {
				return strings.TrimPrefix(strings.TrimSpace(line), "Name=")
			}
		}
		return "unknown"
	}
	return "unknown"
}

func getTotalRAMMB() int64 {
	switch runtime.GOOS {
	case "darwin":
		out, err := exec.Command("sysctl", "-n", "hw.memsize").Output()
		if err != nil {
			return 0
		}
		bytes, _ := strconv.ParseInt(strings.TrimSpace(string(out)), 10, 64)
		return bytes / 1024 / 1024

	case "linux":
		out, err := exec.Command("sh", "-c", `grep MemTotal /proc/meminfo | awk '{print $2}'`).Output()
		if err != nil {
			return 0
		}
		kb, _ := strconv.ParseInt(strings.TrimSpace(string(out)), 10, 64)
		return kb / 1024

	case "windows":
		out, err := exec.Command("wmic", "ComputerSystem", "get", "TotalPhysicalMemory", "/value").Output()
		if err != nil {
			return 0
		}
		for _, line := range strings.Split(string(out), "\n") {
			if strings.HasPrefix(strings.TrimSpace(line), "TotalPhysicalMemory=") {
				val := strings.TrimPrefix(strings.TrimSpace(line), "TotalPhysicalMemory=")
				bytes, _ := strconv.ParseInt(strings.TrimSpace(val), 10, 64)
				return bytes / 1024 / 1024
			}
		}
		return 0
	}
	return 0
}

func getGPUModel() string {
	switch runtime.GOOS {
	case "darwin":
		out, err := exec.Command("system_profiler", "SPDisplaysDataType").Output()
		if err != nil {
			return "N/A"
		}
		for _, line := range strings.Split(string(out), "\n") {
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, "Chipset Model:") || strings.HasPrefix(trimmed, "Chip Model:") {
				return strings.TrimSpace(strings.SplitN(trimmed, ":", 2)[1])
			}
		}
		// For Apple Silicon, the GPU is integrated
		out2, err2 := exec.Command("sysctl", "-n", "hw.model").Output()
		if err2 == nil {
			model := strings.TrimSpace(string(out2))
			if strings.Contains(model, "Mac") {
				return model + " (integrated)"
			}
		}
		return "N/A"

	case "linux", "windows":
		out, err := exec.Command("nvidia-smi", "--query-gpu=name", "--format=csv,noheader").Output()
		if err != nil {
			return "N/A"
		}
		return strings.TrimSpace(string(out))
	}
	return "N/A"
}
