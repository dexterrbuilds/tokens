import { createServer } from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('DATABASE_URL must be set');

const runtime = process.versions.bun ? `bun-${process.versions.bun}` : `node-${process.versions.node}`;
const canaryName = process.env.CANARY_NAME?.trim() || 'db-canary';
const port = Number(process.env.PORT) || 8080;

function respond(response, status, payload) {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(payload));
}

async function probeOnce(sequence) {
    const startedAt = Date.now();
    const timings = {
        dnsMs: net.isIP(new URL(databaseUrl).hostname) ? 0 : null,
        tcpConnectMs: null,
        tlsHandshakeMs: null,
        queryMs: null,
    };
    const originalSocketConnect = net.Socket.prototype.connect;
    const originalTlsConnect = tls.connect;
    // Probes run serially (and the service concurrency is one), so these
    // wrappers observe postgres.js without replacing its normal socket/TLS
    // implementation. That keeps Bun/Direct a faithful production control.
    net.Socket.prototype.connect = function instrumentedConnect(...args) {
        const connectStartedAt = Date.now();
        this.once('connect', () => {
            timings.tcpConnectMs = Date.now() - connectStartedAt;
        });
        return originalSocketConnect.apply(this, args);
    };
    tls.connect = function instrumentedTlsConnect(...args) {
        const tlsStartedAt = Date.now();
        const socket = originalTlsConnect.apply(this, args);
        socket.once('secureConnect', () => {
            timings.tlsHandshakeMs = Date.now() - tlsStartedAt;
        });
        return socket;
    };
    const sql = postgres(databaseUrl, {
        max: 1,
        connect_timeout: 3,
        idle_timeout: 1,
        connection: { application_name: `cloudrun-db-canary-${canaryName}` },
    });
    try {
        const connectStartedAt = Date.now();
        await sql`SELECT 1 AS ok`;
        const connectTlsAuthAndFirstQueryMs = Date.now() - connectStartedAt;
        const queryStartedAt = Date.now();
        await sql`SELECT 1 AS ok`;
        timings.queryMs = Date.now() - queryStartedAt;
        const event = {
            event: 'cloudrun_db_canary_probe',
            ok: true,
            canary: canaryName,
            runtime,
            sequence,
            ...timings,
            connectTlsAuthAndFirstQueryMs,
            totalMs: Date.now() - startedAt,
            revision: process.env.K_REVISION || 'local',
            instanceId: process.env.HOSTNAME || 'local',
        };
        console.log(JSON.stringify(event));
        return event;
    } catch (error) {
        const event = {
            event: 'cloudrun_db_canary_probe',
            ok: false,
            canary: canaryName,
            runtime,
            sequence,
            totalMs: Date.now() - startedAt,
            ...timings,
            errorCode: typeof error?.code === 'string' ? error.code : 'UNKNOWN',
            errorMessage: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
            revision: process.env.K_REVISION || 'local',
            instanceId: process.env.HOSTNAME || 'local',
        };
        console.error(JSON.stringify(event));
        return event;
    } finally {
        await sql.end({ timeout: 1 }).catch(() => {});
        net.Socket.prototype.connect = originalSocketConnect;
        tls.connect = originalTlsConnect;
    }
}

createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://canary');
    if (url.pathname === '/health') return respond(response, 200, { ok: true, canary: canaryName, runtime });
    if (url.pathname !== '/probe') return respond(response, 404, { error: 'not_found' });

    const count = Math.min(Math.max(Number(url.searchParams.get('count')) || 10, 1), 10);
    const results = [];
    for (let sequence = 1; sequence <= count; sequence += 1) {
        results.push(await probeOnce(sequence));
    }
    const failures = results.filter(result => !result.ok).length;
    return respond(response, failures === 0 ? 200 : 503, {
        ok: failures === 0,
        failures,
        count,
        canary: canaryName,
        runtime,
    });
}).listen(port, () => {
    console.log(JSON.stringify({ event: 'cloudrun_db_canary_started', canary: canaryName, runtime, port }));
});
