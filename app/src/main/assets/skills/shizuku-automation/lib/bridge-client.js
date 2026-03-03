'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require('fs');
const path = require('path');
const http = require('http');
const { getBotdropTmpDir } = require('./path-utils');
const DEFAULT_SHARED_HOME = '/data/local/tmp/botdrop_tmp';
const FALLBACK_TERMUX_HOME = '/data/data/com.termux/files/home';
const SHARED_ROOT_CANDIDATES = [
    DEFAULT_SHARED_HOME,
];
const TERMUX_HOME_CANDIDATES = [
    process.env.BOTDROP_TERMUX_HOME,
    process.env.TERMUX_HOME,
    process.env.HOME,
    '/data/data/app.botdrop/files/home',
    '/data/data/app.botdrop/files/usr/home',
    FALLBACK_TERMUX_HOME,
];
const BRIDGE_CONFIG_RELATIVE_PATH = path.join('.openclaw', 'shizuku-bridge.json');
function isSharedDirectoryCandidate(candidate = '') {
    const normalized = String(candidate || '').trim();
    return (normalized.startsWith('/data/local/tmp/'));
}
function resolveAutomationHome() {
    const candidateSet = [
        process.env.BOTDROP_AUTOMATION_HOME,
        getBotdropTmpDir(),
        ...SHARED_ROOT_CANDIDATES,
    ];
    const candidates = [];
    const seen = new Set();
    for (const candidate of candidateSet) {
        if (!candidate || seen.has(candidate))
            continue;
        seen.add(candidate);
        if (!isSharedDirectoryCandidate(candidate))
            continue;
        candidates.push(candidate);
    }
    for (const candidate of candidates) {
        if (!candidate) {
            continue;
        }
        try {
            if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
                return candidate;
            }
        }
        catch {
            // skip
        }
    }
    return DEFAULT_SHARED_HOME;
}
function isTermuxHomeCandidate(candidate = '') {
    const normalized = String(candidate || '').trim();
    return normalized.startsWith('/data/data/');
}
function resolveTermuxHome() {
    const candidates = [...TERMUX_HOME_CANDIDATES];
    const seen = new Set();
    for (const candidate of candidates) {
        if (!candidate || seen.has(candidate)) {
            continue;
        }
        seen.add(candidate);
        if (!isTermuxHomeCandidate(candidate)) {
            continue;
        }
        try {
            fs.accessSync(candidate, fs.constants.R_OK);
            return candidate;
        }
        catch (_) {
            // best effort, continue searching
        }
    }
    return FALLBACK_TERMUX_HOME;
}
const AUTOMATION_HOME = resolveAutomationHome();
const TERMUX_HOME = resolveTermuxHome();
const FALLBACK_CONFIG_PATH = path.join(TERMUX_HOME, BRIDGE_CONFIG_RELATIVE_PATH);
function collectCandidateConfigPaths() {
    const candidates = [];
    const seen = new Set();
    const directCandidates = [
        process.env.BOTDROP_SHIZUKU_BRIDGE_CONFIG_PATH,
        process.env.SHIZUKU_BRIDGE_CONFIG_PATH,
    ];
    const addUniqueCandidate = (candidate) => {
        if (!candidate) {
            return;
        }
        const normalized = String(candidate);
        if (seen.has(normalized)) {
            return;
        }
        seen.add(normalized);
        candidates.push(normalized);
    };
    const addHomeCandidate = (home) => {
        if (!home) {
            return;
        }
        const normalized = String(home || '').trim();
        if (!normalized) {
            return;
        }
        addUniqueCandidate(path.join(normalized, BRIDGE_CONFIG_RELATIVE_PATH));
        const parentHome = path.dirname(normalized);
        if (parentHome && parentHome !== normalized) {
            addUniqueCandidate(path.join(parentHome, BRIDGE_CONFIG_RELATIVE_PATH));
        }
    };
    directCandidates.forEach(addUniqueCandidate);
    const termuxHomes = [TERMUX_HOME, ...TERMUX_HOME_CANDIDATES];
    for (const home of termuxHomes) {
        if (!home || seen.has(home)) {
            continue;
        }
        addHomeCandidate(home);
    }
    const sharedHomeCandidates = [AUTOMATION_HOME, ...SHARED_ROOT_CANDIDATES];
    for (const home of sharedHomeCandidates) {
        if (!home || seen.has(home)) {
            continue;
        }
        addHomeCandidate(home);
    }
    addUniqueCandidate(FALLBACK_CONFIG_PATH);
    return candidates;
}
const CANDIDATE_CONFIG_PATHS = collectCandidateConfigPaths();
function getDefaultConfigPath() {
    const candidates = [...CANDIDATE_CONFIG_PATHS];
    const defaultPath = candidates.find((candidate) => {
        try {
            return fs.existsSync(candidate);
        }
        catch {
            return false;
        }
    });
    if (defaultPath) {
        return defaultPath;
    }
    return FALLBACK_CONFIG_PATH;
}
const DEFAULT_CONFIG_PATH = getDefaultConfigPath();
const ERROR = {
    BRIDGE_NOT_FOUND: 'BRIDGE_NOT_FOUND',
    BRIDGE_UNREACHABLE: 'BRIDGE_UNREACHABLE',
    SHIZUKU_NOT_READY: 'SHIZUKU_NOT_READY',
    EXEC_FAILED: 'EXEC_FAILED',
    TIMEOUT: 'TIMEOUT',
};
function normalizeBridgeResponse(payload = {}) {
    if (!payload || typeof payload !== 'object') {
        return {
            ok: false,
            error: ERROR.EXEC_FAILED,
            message: 'Invalid response payload',
            exitCode: -1,
            stdout: '',
            stderr: '',
            type: 'text',
        };
    }
    const type = payload.type === 'file' ? 'file' : 'text';
    return {
        ...payload,
        type,
        stdout: type === 'file' ? (payload.stdout || '') : (payload.stdout || ''),
        stderr: payload.stderr || '',
    };
}
const TRACE_BRIDGE = !('BOTDROP_AUTOMATION_TRACE' in process.env)
    || process.env.BOTDROP_AUTOMATION_TRACE === '1'
    || process.env.BOTDROP_AUTOMATION_TRACE === 'true';
function traceBridge(event, data = {}) {
    if (!TRACE_BRIDGE) {
        return;
    }
    console.error('[shizuku-bridge][' + event + '] ' + JSON.stringify(data));
}
function summarizeCommand(command) {
    if (!command)
        return '';
    const normalized = String(command);
    if (normalized.length <= 120)
        return normalized;
    return normalized.slice(0, 120) + '...(' + normalized.length + ')';
}
class BridgeClient {
    constructor(configPath) {
        this._configPath = configPath || DEFAULT_CONFIG_PATH;
        this._lastConfigError = null;
    }
    _readConfig() {
        this._lastConfigError = null;
        try {
            const raw = fs.readFileSync(this._configPath, 'utf8');
            const cfg = JSON.parse(raw);
            if (!cfg.host || !cfg.port || !cfg.token) {
                this._lastConfigError = 'Invalid config format: host/port/token missing';
                return null;
            }
            return cfg;
        }
        catch (error) {
            this._lastConfigError = error.message || String(error);
            return null;
        }
    }
    getConfigInfo() {
        const exists = (() => {
            try {
                return fs.existsSync(this._configPath);
            }
            catch {
                return false;
            }
        })();
        return {
            path: this._configPath,
            exists,
            home: AUTOMATION_HOME || null,
            cwd: process.cwd(),
            lastError: this._lastConfigError,
        };
    }
    getConfigPath() {
        return this._configPath;
    }
    _request(method, path, body, timeoutMs) {
        const requestId = Math.random().toString(36).slice(2, 10);
        const cfg = this._readConfig();
        if (!cfg) {
            const info = this.getConfigInfo();
            return Promise.resolve({
                ok: false,
                error: ERROR.BRIDGE_NOT_FOUND,
                message: 'Bridge config not found at ' + info.path,
                type: 'text',
                bridgeConfigPath: info.path,
                bridgeConfigExists: info.exists,
                bridgeConfigHome: info.home,
                bridgeConfigCwd: info.cwd,
                bridgeConfigLastError: info.lastError,
                exitCode: -1,
                stdout: '',
                stderr: '',
            });
        }
        return new Promise((resolve) => {
            const payload = body ? JSON.stringify(body) : null;
            const startedAt = Date.now();
            const options = {
                hostname: cfg.host,
                port: cfg.port,
                path,
                method,
                timeout: timeoutMs || 30000,
                headers: {
                    Authorization: 'Bearer ' + cfg.token,
                    ...(payload
                        ? {
                            'Content-Type': 'application/json',
                            'Content-Length': Buffer.byteLength(payload),
                        }
                        : {}),
                },
            };
            traceBridge('request.start', {
                requestId,
                method,
                path,
                timeoutMs: timeoutMs || 30000,
                hasBody: !!payload,
                bridgeConfigPath: this._configPath,
                command: summarizeCommand(body && body.command),
            });
            const req = http.request(options, (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const raw = Buffer.concat(chunks).toString('utf8');
                    const elapsedMs = Date.now() - startedAt;
                    traceBridge('response.raw', {
                        requestId,
                        statusCode: res.statusCode,
                        headers: res.headers,
                        elapsedMs,
                        rawLen: raw.length,
                    });
                    try {
                        const rawParsed = JSON.parse(raw);
                        const parsed = normalizeBridgeResponse(rawParsed);
                        traceBridge('response.parsed', {
                            requestId,
                            method,
                            path,
                            elapsedMs,
                            ok: !!parsed.ok,
                            exitCode: parsed.exitCode,
                            type: parsed.type,
                            stdoutLen: parsed.type === 'file'
                                ? Number.isFinite(parsed.bytes) ? parsed.bytes : 0
                                : parsed.stdout ? parsed.stdout.length : 0,
                            stderrLen: parsed.stderr ? parsed.stderr.length : 0,
                            path: parsed.path || null,
                        });
                        resolve(parsed);
                    }
                    catch {
                        resolve(normalizeBridgeResponse({
                            ok: false,
                            error: ERROR.EXEC_FAILED,
                            message: 'Invalid JSON response: ' + raw.slice(0, 200),
                            exitCode: -1,
                            stdout: '',
                            stderr: '',
                        }));
                    }
                });
            });
            req.on('timeout', () => {
                req.destroy();
                traceBridge('request.timeout', {
                    requestId,
                    method,
                    path,
                    timeoutMs: timeoutMs || 30000,
                    elapsedMs: Date.now() - startedAt,
                });
                resolve({
                    ok: false,
                    error: ERROR.TIMEOUT,
                    message: 'Request timed out after ' + (timeoutMs || 30000) + 'ms',
                    exitCode: -1,
                    stdout: '',
                    stderr: '',
                    type: 'text',
                });
            });
            req.on('error', (err) => {
                traceBridge('request.error', {
                    requestId,
                    method,
                    path,
                    elapsedMs: Date.now() - startedAt,
                    error: err.message,
                });
                resolve({
                    ok: false,
                    error: ERROR.BRIDGE_UNREACHABLE,
                    message: 'Bridge unreachable: ' + err.message,
                    exitCode: -1,
                    stdout: '',
                    stderr: '',
                    type: 'text',
                });
            });
            if (payload)
                req.write(payload);
            req.end();
        });
    }
    async isAvailable() {
        const cfg = this._readConfig();
        if (!cfg) {
            return { available: false, error: ERROR.BRIDGE_NOT_FOUND, message: 'Config file not found' };
        }
        const res = await this._request('GET', '/shizuku/status', null, 5000);
        if (res.error === ERROR.BRIDGE_UNREACHABLE) {
            return { available: false, error: ERROR.BRIDGE_UNREACHABLE, message: res.message };
        }
        if (res.status && res.status !== 'READY') {
            return {
                available: false,
                error: ERROR.SHIZUKU_NOT_READY,
                message: 'Shizuku status: ' + res.status,
                status: res.status,
                serviceBound: res.serviceBound,
            };
        }
        return {
            available: true,
            status: res.status || 'READY',
            serviceBound: res.serviceBound !== undefined ? res.serviceBound : true,
        };
    }
    async exec(command, timeoutMs = 30000) {
        return this._request('POST', '/shizuku/exec', { command, timeoutMs }, timeoutMs + 5000);
    }
    async execOrThrow(command, timeoutMs = 30000) {
        const res = await this.exec(command, timeoutMs);
        if (!res.ok) {
            const err = new Error(res.message || res.stderr || res.error || 'exec failed');
            err.code = res.error || ERROR.EXEC_FAILED;
            err.result = res;
            throw err;
        }
        return res;
    }
}
module.exports = { BridgeClient, ERROR, DEFAULT_CONFIG_PATH };
