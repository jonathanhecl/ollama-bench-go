// Ollama Bench — Frontend Application (SSE real-time progress)
(function () {
    'use strict';

    let models = [];
    let benchAllRunning = false;
    let runningCount = 0;
    let sortField = 'name';
    let sortAsc = true;

    // ==================== Init ====================
    document.addEventListener('DOMContentLoaded', () => {
        loadModels();
        loadSysinfo();
    });

    // ==================== Load System Info ====================
    async function loadSysinfo() {
        try {
            const resp = await fetch('/api/sysinfo');
            if (!resp.ok) return;
            const info = await resp.json();
            document.getElementById('siHostname').textContent = info.hostname || '—';
            document.getElementById('siOS').textContent = info.os || '—';
            document.getElementById('siCPU').textContent = info.cpu_model || '—';
            document.getElementById('siCores').textContent = info.cpu_cores || '—';
            document.getElementById('siRAM').textContent = info.total_ram_gb || '—';
            document.getElementById('siGPU').textContent = info.gpu_model || '—';
        } catch (e) { /* silently fail */ }
    }

    // ==================== Load Models ====================
    window.loadModels = async function () {
        const body = document.getElementById('modelBody');
        const dot = document.getElementById('statusDot');
        const text = document.getElementById('statusText');

        body.innerHTML = `<tr><td colspan="8" class="loading-cell"><div class="spinner"></div><span>Loading models...</span></td></tr>`;
        dot.className = 'status-dot';
        text.textContent = 'Connecting...';

        try {
            const resp = await fetch('/api/models');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            models = await resp.json();

            dot.className = 'status-dot connected';
            text.textContent = `Connected — ${models.length} model${models.length !== 1 ? 's' : ''}`;

            // Show Bench All button
            const benchAllBtn = document.getElementById('benchAllBtn');
            if (models.length > 0) benchAllBtn.style.display = '';

            renderModels();
        } catch (err) {
            dot.className = 'status-dot error';
            text.textContent = `Error: ${err.message}`;
            body.innerHTML = `<tr><td colspan="8" class="loading-cell" style="color: var(--danger);">Failed to connect to Ollama. Make sure it's running.</td></tr>`;
        }
    };

    // ==================== Sorting ====================
    window.toggleSort = function (field) {
        if (runningCount > 0 || benchAllRunning) return; // Disable sort while running

        if (sortField === field) {
            sortAsc = !sortAsc;
        } else {
            sortField = field;
            // Default desc for numbers, asc for text
            if (['parameter_size', 'size_bytes', 'context_length', 'speed'].includes(field)) {
                sortAsc = false;
            } else {
                sortAsc = true;
            }
        }
        renderModels();
    };

    function getSortValue(m, field) {
        if (field === 'speed') {
            return m.benchResult ? m.benchResult.tokens_per_sec || 0 : -1;
        }
        if (field === 'parameter_size') {
            // Parse "7B" etc? usually string. Ollama API returns string e.g "7B"
            // For now just string compare or try to parse if needed.
            // But size_bytes is better for size.
            return m.parameter_size || '';
        }
        return m[field];
    }

    // ==================== Render Models ====================
    function renderModels() {
        const body = document.getElementById('modelBody');

        if (!models || models.length === 0) {
            body.innerHTML = `<tr><td colspan="8" class="loading-cell">No models found. Install models with <code>ollama pull</code></td></tr>`;
            return;
        }

        // Sort models
        models.sort((a, b) => {
            let valA = getSortValue(a, sortField);
            let valB = getSortValue(b, sortField);

            if (typeof valA === 'string') valA = valA.toLowerCase();
            if (typeof valB === 'string') valB = valB.toLowerCase();

            if (valA < valB) return sortAsc ? -1 : 1;
            if (valA > valB) return sortAsc ? 1 : -1;
            return 0;
        });

        // Update verify headers
        document.querySelectorAll('th.sortable .sort-icon').forEach(el => el.className = 'sort-icon');
        const activeIcon = document.getElementById(`sort-${sortField}`);
        if (activeIcon) activeIcon.className = `sort-icon ${sortAsc ? 'asc' : 'desc'}`;

        body.innerHTML = models.map((m, i) => `
            <tr id="model-row-${i}">
                <td><span class="model-name">${esc(m.name)}</span></td>
                <td>${esc(m.family || '—')}</td>
                <td>${esc(m.parameter_size || '—')}</td>
                <td>${esc(m.quantization_level || '—')}</td>
                <td class="size-text">${formatSize(m.size_bytes)}</td>
                <td>${m.context_length ? m.context_length.toLocaleString() : '—'}</td>
                <td>${m.is_loaded
                ? '<span class="badge badge-loaded">● Loaded</span>'
                : '<span class="badge badge-unloaded">○ Idle</span>'
            }</td>
                <td>${m.benchResult ? m.benchResult.tokens_per_sec.toFixed(1) + ' t/s' : '—'}</td>
                <td>
                    <div class="actions-cell">
                        <button class="btn btn-play" id="play-${i}" onclick="runBench(${i})">▶ Bench</button>
                        <button class="btn btn-stress" id="stress-${i}" onclick="runStress(${i})">🔥 Stress</button>
                    </div>
                </td>
            </tr>
            <tr id="results-row-${i}" class="results-expand-row" style="display: none;">
                <td colspan="9" id="results-cell-${i}" class="results-expand-cell"></td>
            </tr>
        `).join('');

        // Restore expanded results if they exist in memory (optional, but good for UX)
        // For now, re-rendering closes everything. That's acceptable for sort.
        // But if we have results, we should probably show them?
        // Let's just re-render result rows if we have results.
        models.forEach((m, i) => {
            if (m.benchResult) {
                // If we have a result, we can render it.
                // But wait, renderFinalBenchResults expects `index` to update DOM.
                // We can call it here.
                const row = document.getElementById(`results-row-${i}`);
                if (row) {
                    row.style.display = 'table-row';
                    renderFinalBenchResults(i, m.benchResult);
                }
            }
        });
    }

    // ==================== Run Benchmark with SSE ====================
    window.runBench = async function (index) {
        if (index < 0 || index >= models.length) return;
        const m = models[index];
        const btn = document.getElementById(`play-${index}`);
        const resultsRow = document.getElementById(`results-row-${index}`);
        const resultsCell = document.getElementById(`results-cell-${index}`);

        if (btn.disabled) return; // Prevent double click

        runningCount++;
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner spinner-small"></div>';
        resultsRow.style.display = 'table-row';
        resultsCell.innerHTML = `<div class="progress-panel" id="progress-${index}">
            <div class="progress-header">⚡ Benchmark: <strong>${esc(m.name)}</strong></div>
            <div class="progress-steps" id="steps-${index}"></div>
        </div>`;

        try {
            await consumeSSE(`/api/bench/${encodeURIComponent(m.name)}`, (event) => {
                updateProgressStep(`steps-${index}`, event);
                if (event.step === 'complete' && event.status === 'done' && event.result) {
                    m.benchResult = event.result; // Store result for sorting
                    renderFinalBenchResults(index, event.result);
                    // Update the speed column in the row?
                    // We can re-render the single cell or just wait for next full render.
                    // Let's update the speed cell directly for immediate feedback?
                    // But changing DOM manually is messy. Re-render is risky during run.
                    // Just leave it. Next sort/refresh picks it up.
                }
            });
        } catch (err) {
            resultsCell.innerHTML = `<div class="progress-panel"><span class="result-fail">Error: ${esc(err.message)}</span></div>`;
        } finally {
            btn.disabled = false;
            btn.innerHTML = '▶ Bench';
            runningCount--;
        }
    };

    function renderFinalBenchResults(index, r) {
        const cell = document.getElementById(`results-cell-${index}`);
        let html = `<div class="final-results">`;

        if (r.was_preloaded) {
            html += `<div class="preloaded-warning">⚠ Model was pre-loaded — load time may be misleadingly low</div>`;
        }

        // Show error if present, but don't stop rendering if we have partial data
        if (r.error) {
            html += `<div class="result-fail" style="margin-bottom:8px;">⚠ ${esc(r.error)}</div>`;
        }

        html += `<div class="result-list">`;
        html += resultRow('Load Time', r.load_time_sec ? `${r.load_time_sec.toFixed(2)}s` : '—');
        html += resultRow('Tokens/sec', r.tokens_per_sec ? `${r.tokens_per_sec.toFixed(1)}` : '—');
        html += resultRow('Eval Count', r.eval_count || '—');
        html += resultRow('Total Time', r.total_time_sec ? `${r.total_time_sec.toFixed(2)}s` : '—');
        html += resultRow('Free RAM ↓', r.sys_resources && r.sys_resources.min_free_ram_mb ? `${r.sys_resources.min_free_ram_mb.toFixed(0)} MB` : '—');
        html += resultRow('Peak CPU', r.sys_resources && r.sys_resources.peak_cpu_pct ? `${r.sys_resources.peak_cpu_pct.toFixed(1)}%` : '—');
        html += resultRow('Peak GPU', r.sys_resources ? `${r.sys_resources.peak_gpu_pct}` : '—');
        html += resultRow('Embeddings', passFail(r.embeddings));
        html += resultRow('JSON Output', passFail(r.json_support));
        html += resultRow('Tool Calling', passFail(r.tools));
        html += resultRow('Vision', passFail(r.vision));
        html += resultRow('Agent Skills', agentScore(r.agent_skills));
        html += resultRow('Code Gen', ethicsResult(r.coding_gen));
        html += resultRow('Code Fix', ethicsResult(r.coding_fix));
        html += resultRow('Logic Seq', ethicsResult(r.logic_seq));
        html += resultRow('Logic Word', ethicsResult(r.logic_word));
        html += resultRow('Ethics', ethicsResult(r.ethics));
        html += resultRow('Morality', ethicsResult(r.morality));
        html += `</div></div>`;

        cell.innerHTML = html;
    }

    function resultRow(label, value) {
        return `<div class="result-row"><span class="result-label">${label}</span><span class="result-value">${value}</span></div>`;
    }

    function passFail(val) {
        return val
            ? '<span class="result-pass">✅ Supported</span>'
            : '<span class="result-fail">❌ Not supported</span>';
    }

    function agentScore(a) {
        if (!a) return '<span class="result-na">—</span>';
        const cls = a.score >= 3 ? 'result-pass' : a.score >= 2 ? 'result-warn' : 'result-fail';
        return `<span class="${cls}">${a.score}/3</span>`;
    }

    function ethicsResult(t) {
        if (!t) return '<span class="result-na">—</span>';
        const icon = t.pass ? '<span class="result-pass">✅ Pass</span>' : '<span class="result-fail">❌ Fail</span>';
        if (t.response) {
            // Safe way to pass string: encode it, AND escape single quotes which encodeURIComponent misses
            const encoded = encodeURIComponent(t.response).replace(/'/g, "%27");
            return `${icon} <a href="#" onclick="showDetail('${encoded}'); return false;" class="detail-link">details</a>`;
        }
        return icon;
    }

    window.showDetail = function (encodedText) {
        const text = decodeURIComponent(encodedText);
        document.getElementById('modalTitle').textContent = 'Model Response';
        document.getElementById('modalBody').innerHTML = `<pre>${esc(text)}</pre>`;
        document.getElementById('modalOverlay').classList.add('active');
    };

    window.closeModal = function () {
        document.getElementById('modalOverlay').classList.remove('active');
    };

    // ==================== Run Stress Test with SSE ====================
    window.runStress = async function (index) {
        const m = models[index];
        const btn = document.getElementById(`stress-${index}`);
        const resultsRow = document.getElementById(`results-row-${index}`);
        const resultsCell = document.getElementById(`results-cell-${index}`);

        if (btn.disabled) return;

        runningCount++;
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner spinner-small"></div>';
        resultsRow.style.display = 'table-row';
        resultsCell.innerHTML = `<div class="progress-panel" id="stress-progress-${index}">
            <div class="progress-header">🔥 Context Stress Test: <strong>${esc(m.name)}</strong></div>
            <div class="progress-steps" id="stress-steps-${index}"></div>
        </div>`;

        try {
            const stressResults = [];
            await consumeSSE(`/api/stress/${encodeURIComponent(m.name)}`, (event) => {
                updateProgressStep(`stress-steps-${index}`, event);
                if (event.step === 'stress_complete' && event.result) {
                    renderFinalStressResults(index, event.result);
                }
            });
        } catch (err) {
            resultsCell.innerHTML = `<div class="progress-panel"><span class="result-fail">Error: ${esc(err.message)}</span></div>`;
        } finally {
            btn.disabled = false;
            btn.innerHTML = '🔥 Stress';
            runningCount--;
        }
    };

    function renderFinalStressResults(index, results) {
        const cell = document.getElementById(`results-cell-${index}`);
        if (!results || results.length === 0) {
            cell.innerHTML = '<div class="progress-panel"><span class="result-na">No results</span></div>';
            return;
        }

        let maxGen = 0;
        results.forEach(r => { if (r.gen_tok_sec > maxGen) maxGen = r.gen_tok_sec; });

        let html = `<div class="stress-panel">
            <strong style="color: var(--text-primary);">Context Length Stress Test Results</strong>
            <table class="stress-table">
                <thead><tr>
                    <th>Context</th>
                    <th>Prompt tok/s</th>
                    <th>Gen tok/s</th>
                    <th>Total Time</th>
                    <th>Free RAM ↓</th>
                    <th>Peak CPU</th>
                    <th>Peak GPU</th>
                    <th>Status</th>
                    <th style="min-width:80px;">Perf</th>
                </tr></thead>
                <tbody>`;

        results.forEach(r => {
            const statusIcon = r.status === 'pass' ? '<span class="result-pass">✅</span>'
                : r.status === 'skipped' ? '<span class="result-na">⏭ Skip</span>'
                    : r.status === 'oom' ? '<span class="result-fail">💥 OOM</span>'
                        : '<span class="result-fail">❌</span>';

            const barPct = maxGen > 0 && r.gen_tok_sec > 0 ? (r.gen_tok_sec / maxGen * 100) : 0;
            const barColor = barPct > 70 ? 'var(--success)' : barPct > 40 ? 'var(--warning)' : 'var(--danger)';

            html += `<tr>
                <td>${formatContextSize(r.context_size)}</td>
                <td>${r.prompt_eval_tok_sec > 0 ? r.prompt_eval_tok_sec.toFixed(1) : '—'}</td>
                <td>${r.gen_tok_sec > 0 ? r.gen_tok_sec.toFixed(1) : '—'}</td>
                <td>${r.total_time_sec > 0 ? r.total_time_sec.toFixed(1) + 's' : '—'}</td>
                <td>${r.sys_resources && r.sys_resources.min_free_ram_mb > 0 ? r.sys_resources.min_free_ram_mb.toFixed(0) + ' MB' : '—'}</td>
                <td>${r.sys_resources && r.sys_resources.peak_cpu_pct > 0 ? r.sys_resources.peak_cpu_pct.toFixed(1) + '%' : '—'}</td>
                <td>${r.sys_resources ? r.sys_resources.peak_gpu_pct : 'N/A'}</td>
                <td>${statusIcon}</td>
                <td><div class="stress-bar"><div class="stress-bar-fill" style="width:${barPct}%;background:${barColor}"></div></div></td>
            </tr>`;
        });

        html += `</tbody></table></div>`;
        cell.innerHTML = html;
    }

    // ==================== Bench All ====================
    window.benchAll = async function () {
        if (benchAllRunning) return;
        benchAllRunning = true;
        runningCount++; // Treat as one big running task for sorting

        const btn = document.getElementById('benchAllBtn');
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner spinner-small"></div> Running All...';

        for (let i = 0; i < models.length; i++) {
            btn.innerHTML = `<div class="spinner spinner-small"></div> ${i + 1}/${models.length}`;
            // Find current index of model i (in case sorted? No wait)
            // If we disable sorting, models[i] is stable.
            // But we iterate i from 0 to N.
            // Run bench for index i
            await window.runBench(i);
        }

        btn.disabled = false;
        btn.innerHTML = '<span class="btn-icon">▶▶</span> Bench All';
        benchAllRunning = false;
        runningCount--;
    };

    // ==================== SSE Consumer ====================
    function consumeSSE(url, onEvent) {
        return new Promise((resolve, reject) => {
            const source = new EventSource(url);

            source.onmessage = (e) => {
                try {
                    const event = JSON.parse(e.data);
                    onEvent(event);

                    // Close when complete
                    if (event.step === 'complete' || event.step === 'stress_complete') {
                        source.close();
                        resolve();
                    }
                } catch (err) {
                    // ignore parse errors
                }
            };

            source.onerror = () => {
                source.close();
                resolve();
            };
        });
    }

    // ==================== Progress Step Updates ====================
    function updateProgressStep(containerId, event) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const stepId = `${containerId}-${event.step}`;
        let existing = document.getElementById(stepId);

        let content = '';
        let className = 'progress-step';

        switch (event.status) {
            case 'running':
                className += ' running';
                content = `<div class="spinner spinner-small"></div> <span>${esc(event.label)}</span>`;
                break;
            case 'done':
                className += ' done';
                content = `<span class="step-check">✓</span> <span>${esc(event.label)}</span>`;
                break;
            case 'skipped':
                className += ' skipped';
                content = `<span class="step-skip">−</span> <span>${esc(event.label)}</span>`;
                break;
            case 'error':
                className += ' error';
                content = `<span class="step-fail">✗</span> <span>${esc(event.label)}</span>`;
                break;
            default:
                content = `<span>${esc(event.label)}</span>`;
        }

        if (existing) {
            existing.className = className;
            existing.innerHTML = content;
        } else {
            const el = document.createElement('div');
            el.id = stepId;
            el.className = className;
            el.innerHTML = content;
            container.appendChild(el);
        }

        // Auto-scroll to latest
        container.scrollTop = container.scrollHeight;
    }

    // ==================== Utilities ====================
    function formatSize(bytes) {
        if (!bytes) return '—';
        if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
        if (bytes >= 1048576) return (bytes / 1048576).toFixed(0) + ' MB';
        return (bytes / 1024).toFixed(0) + ' KB';
    }

    function formatContextSize(tokens) {
        if (tokens >= 1024) return (tokens / 1024).toFixed(0) + 'K';
        return tokens.toString();
    }

    function esc(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

})();
