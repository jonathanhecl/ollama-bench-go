// Ollama Bench — Frontend Application (SSE real-time progress)
(function () {
    'use strict';

    let models = [];
    let benchAllRunning = false;

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

    // ==================== Render Models ====================
    function renderModels() {
        const body = document.getElementById('modelBody');

        if (!models || models.length === 0) {
            body.innerHTML = `<tr><td colspan="8" class="loading-cell">No models found. Install models with <code>ollama pull</code></td></tr>`;
            return;
        }

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
                <td>
                    <div class="actions-cell">
                        <button class="btn btn-play" id="play-${i}" onclick="runBench(${i})">▶ Bench</button>
                        <button class="btn btn-stress" id="stress-${i}" onclick="runStress(${i})">🔥 Stress</button>
                    </div>
                </td>
            </tr>
            <tr id="results-row-${i}" class="results-expand-row" style="display: none;">
                <td colspan="8" id="results-cell-${i}" class="results-expand-cell"></td>
            </tr>
        `).join('');
    }

    // ==================== Run Benchmark with SSE ====================
    window.runBench = async function (index) {
        const m = models[index];
        const btn = document.getElementById(`play-${index}`);
        const resultsRow = document.getElementById(`results-row-${index}`);
        const resultsCell = document.getElementById(`results-cell-${index}`);

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
                    renderFinalBenchResults(index, event.result);
                }
            });
        } catch (err) {
            resultsCell.innerHTML = `<div class="progress-panel"><span class="result-fail">Error: ${esc(err.message)}</span></div>`;
        } finally {
            btn.disabled = false;
            btn.innerHTML = '▶ Bench';
        }
    };

    function renderFinalBenchResults(index, r) {
        const cell = document.getElementById(`results-cell-${index}`);
        let html = `<div class="final-results">`;

        if (r.was_preloaded) {
            html += `<div class="preloaded-warning">⚠ Model was pre-loaded — load time may be misleadingly low</div>`;
        }

        if (r.error) {
            html += `<div class="result-fail">${esc(r.error)}</div></div>`;
            cell.innerHTML = html;
            return;
        }

        html += `<div class="result-list">`;
        html += resultRow('Load Time', `${r.load_time_sec.toFixed(2)}s`);
        html += resultRow('Tokens/sec', `${r.tokens_per_sec.toFixed(1)}`);
        html += resultRow('Eval Count', `${r.eval_count}`);
        html += resultRow('Total Time', `${r.total_time_sec.toFixed(2)}s`);
        html += resultRow('Free RAM ↓', `${r.sys_resources.min_free_ram_mb.toFixed(0)} MB`);
        html += resultRow('Peak CPU', `${r.sys_resources.peak_cpu_pct.toFixed(1)}%`);
        html += resultRow('Peak GPU', `${r.sys_resources.peak_gpu_pct}`);
        html += resultRow('Embeddings', passFail(r.embeddings));
        html += resultRow('JSON Output', passFail(r.json_support));
        html += resultRow('Tool Calling', passFail(r.tools));
        html += resultRow('Vision', passFail(r.vision));
        html += resultRow('Agent Skills', agentScore(r.agent_skills));
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
            const safeResp = esc(t.response).replace(/'/g, '&#39;');
            return `${icon} <a href="#" onclick="showDetail('${safeResp}'); return false;" class="detail-link">details</a>`;
        }
        return icon;
    }

    window.showDetail = function (text) {
        document.getElementById('modalTitle').textContent = 'Model Response';
        document.getElementById('modalBody').innerHTML = `<pre>${text}</pre>`;
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

        const btn = document.getElementById('benchAllBtn');
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner spinner-small"></div> Running All...';

        for (let i = 0; i < models.length; i++) {
            btn.innerHTML = `<div class="spinner spinner-small"></div> ${i + 1}/${models.length}`;
            await window.runBench(i);
        }

        btn.disabled = false;
        btn.innerHTML = '<span class="btn-icon">▶▶</span> Bench All';
        benchAllRunning = false;
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
                // If we got events already, this is the server closing the connection (normal)
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

        if (event.status === 'running') {
            if (!existing) {
                const el = document.createElement('div');
                el.id = stepId;
                el.className = 'progress-step running';
                el.innerHTML = `<div class="spinner spinner-small"></div> <span>${esc(event.label)}</span>`;
                container.appendChild(el);
            }
        } else if (event.status === 'done') {
            if (existing) {
                existing.className = 'progress-step done';
                existing.innerHTML = `<span class="step-check">✓</span> <span>${esc(event.label)}</span>`;
            } else {
                const el = document.createElement('div');
                el.id = stepId;
                el.className = 'progress-step done';
                el.innerHTML = `<span class="step-check">✓</span> <span>${esc(event.label)}</span>`;
                container.appendChild(el);
            }
        } else if (event.status === 'error') {
            if (existing) {
                existing.className = 'progress-step error';
                existing.innerHTML = `<span class="step-fail">✗</span> <span>${esc(event.label)}</span>`;
            } else {
                const el = document.createElement('div');
                el.id = stepId;
                el.className = 'progress-step error';
                el.innerHTML = `<span class="step-fail">✗</span> <span>${esc(event.label)}</span>`;
                container.appendChild(el);
            }
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
