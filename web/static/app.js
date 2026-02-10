// Ollama Bench — Frontend Application
(function () {
    'use strict';

    let models = [];

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
        } catch (e) {
            // silently fail
        }
    }

    // ==================== Load Models ====================
    window.loadModels = async function () {
        const body = document.getElementById('modelBody');
        const dot = document.getElementById('statusDot');
        const text = document.getElementById('statusText');

        body.innerHTML = `<tr><td colspan="9" class="loading-cell"><div class="spinner"></div><span>Loading models...</span></td></tr>`;
        dot.className = 'status-dot';
        text.textContent = 'Connecting...';

        try {
            const resp = await fetch('/api/models');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            models = await resp.json();

            dot.className = 'status-dot connected';
            text.textContent = `Connected — ${models.length} model${models.length !== 1 ? 's' : ''}`;

            renderModels();
        } catch (err) {
            dot.className = 'status-dot error';
            text.textContent = `Error: ${err.message}`;
            body.innerHTML = `<tr><td colspan="9" class="loading-cell" style="color: var(--danger);">Failed to connect to Ollama. Make sure it's running.</td></tr>`;
        }
    };

    // ==================== Render Models ====================
    function renderModels() {
        const body = document.getElementById('modelBody');

        if (!models || models.length === 0) {
            body.innerHTML = `<tr><td colspan="9" class="loading-cell">No models found. Install models with <code>ollama pull</code></td></tr>`;
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
                <td class="results-cell" id="results-${i}">
                    <span class="result-na">—</span>
                </td>
            </tr>
            <tr id="stress-row-${i}" style="display: none;">
                <td colspan="9" id="stress-results-${i}"></td>
            </tr>
        `).join('');
    }

    // ==================== Run Benchmark ====================
    window.runBench = async function (index) {
        const m = models[index];
        const btn = document.getElementById(`play-${index}`);
        const cell = document.getElementById(`results-${index}`);

        btn.disabled = true;
        btn.innerHTML = '<div class="spinner spinner-small"></div> Running...';
        cell.innerHTML = '<div class="spinner spinner-small"></div> <span class="result-na">Running benchmark...</span>';

        try {
            const resp = await fetch(`/api/bench/${encodeURIComponent(m.name)}`, { method: 'POST' });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const r = await resp.json();

            cell.innerHTML = renderBenchResults(r);
        } catch (err) {
            cell.innerHTML = `<span class="result-fail">Error: ${esc(err.message)}</span>`;
        } finally {
            btn.disabled = false;
            btn.innerHTML = '▶ Bench';
        }
    };

    function renderBenchResults(r) {
        let html = '';

        if (r.was_preloaded) {
            html += `<div class="preloaded-warning">⚠ Model was pre-loaded — load time may be misleadingly low</div>`;
        }

        if (r.error) {
            html += `<div class="result-fail">${esc(r.error)}</div>`;
            return html;
        }

        html += `<div class="result-grid">`;
        html += resultItem('Load Time', `${r.load_time_sec.toFixed(2)}s`);
        html += resultItem('Tokens/sec', `${r.tokens_per_sec.toFixed(1)}`);
        html += resultItem('Eval Count', `${r.eval_count}`);
        html += resultItem('Total Time', `${r.total_time_sec.toFixed(2)}s`);
        html += resultItem('Free RAM ↓', `${r.sys_resources.min_free_ram_mb.toFixed(0)} MB`);
        html += resultItem('Peak CPU', `${r.sys_resources.peak_cpu_pct.toFixed(1)}%`);
        html += resultItem('Peak GPU', `${r.sys_resources.peak_gpu_pct}`);
        html += resultItem('Embeddings', passFail(r.embeddings));
        html += resultItem('JSON', passFail(r.json_support));
        html += resultItem('Tools', passFail(r.tools));
        html += resultItem('Vision', passFail(r.vision));
        html += resultItem('Agent Skills', agentScore(r.agent_skills));
        html += resultItem('Ethics', passFailDetail(r.ethics, 'ethics-' + r.model));
        html += resultItem('Morality', passFailDetail(r.morality, 'morality-' + r.model));
        html += `</div>`;

        return html;
    }

    function resultItem(label, value) {
        return `<div class="result-item"><span class="result-label">${label}:</span> <span class="result-value">${value}</span></div>`;
    }

    function passFail(val) {
        return val
            ? '<span class="result-pass">✅ Yes</span>'
            : '<span class="result-fail">❌ No</span>';
    }

    function agentScore(a) {
        if (!a) return '<span class="result-na">—</span>';
        const color = a.score >= 3 ? 'result-pass' : a.score >= 2 ? 'result-warn' : 'result-fail';
        return `<span class="${color}">${a.score}/3</span>`;
    }

    function passFailDetail(test, id) {
        if (!test) return '<span class="result-na">—</span>';
        const icon = test.pass
            ? '<span class="result-pass">✅ Pass</span>'
            : '<span class="result-fail">❌ Fail</span>';
        if (test.response) {
            return `${icon} <a href="#" onclick="showDetail('${esc(id)}', \`${escAttr(test.response)}\`); return false;" style="color: var(--accent); font-size: 0.72rem;">details</a>`;
        }
        return icon;
    }

    window.showDetail = function (title, text) {
        document.getElementById('modalTitle').textContent = title;
        document.getElementById('modalBody').innerHTML = `<pre>${esc(text)}</pre>`;
        document.getElementById('modalOverlay').classList.add('active');
    };

    window.closeModal = function () {
        document.getElementById('modalOverlay').classList.remove('active');
    };

    // ==================== Run Stress Test ====================
    window.runStress = async function (index) {
        const m = models[index];
        const btn = document.getElementById(`stress-${index}`);
        const row = document.getElementById(`stress-row-${index}`);
        const cell = document.getElementById(`stress-results-${index}`);

        btn.disabled = true;
        btn.innerHTML = '<div class="spinner spinner-small"></div> Testing...';
        row.style.display = 'table-row';
        cell.innerHTML = `<div class="stress-panel"><div class="spinner"></div> Running context stress test... This may take a while.</div>`;

        try {
            const resp = await fetch(`/api/stress/${encodeURIComponent(m.name)}`, { method: 'POST' });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const results = await resp.json();

            cell.innerHTML = renderStressResults(results);
        } catch (err) {
            cell.innerHTML = `<div class="stress-panel"><span class="result-fail">Error: ${esc(err.message)}</span></div>`;
        } finally {
            btn.disabled = false;
            btn.innerHTML = '🔥 Stress';
        }
    };

    function renderStressResults(results) {
        if (!results || results.length === 0) {
            return '<div class="stress-panel"><span class="result-na">No results</span></div>';
        }

        // Find max gen tok/sec for bar scaling
        let maxGen = 0;
        results.forEach(r => { if (r.gen_tok_sec > maxGen) maxGen = r.gen_tok_sec; });

        let html = `<div class="stress-panel">
            <strong style="color: var(--text-primary);">Context Length Stress Test</strong>
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
                    <th style="min-width: 80px;">Perf</th>
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
                <td>${statusIcon}${r.error ? ` <span style="font-size:0.7rem;color:var(--text-muted)">${esc(r.error).substring(0, 40)}</span>` : ''}</td>
                <td><div class="stress-bar"><div class="stress-bar-fill" style="width:${barPct}%;background:${barColor}"></div></div></td>
            </tr>`;
        });

        html += `</tbody></table></div>`;
        return html;
    }

    // ==================== Utilities ====================
    function formatSize(bytes) {
        if (!bytes) return '—';
        if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
        if (bytes >= 1048576) return (bytes / 1048576).toFixed(0) + ' MB';
        return (bytes / 1024).toFixed(0) + ' KB';
    }

    function formatContextSize(tokens) {
        if (tokens >= 1000) return (tokens / 1024).toFixed(0) + 'K';
        return tokens.toString();
    }

    function esc(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    function escAttr(str) {
        if (!str) return '';
        return String(str).replace(/`/g, '\\`').replace(/\$/g, '\\$');
    }

})();
