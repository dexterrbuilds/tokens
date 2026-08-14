import http from 'k6/http';
import { check } from 'k6';

const target = __ENV.ASSETS_CLOUDRUN_URL;
const token = __ENV.TOKENS_CLOUDRUN_AUTH_TOKEN;
const argsJson = __ENV.CURATED_ARGS_JSON;

if (!target || !token || !argsJson) {
    throw new Error('ASSETS_CLOUDRUN_URL, TOKENS_CLOUDRUN_AUTH_TOKEN, and CURATED_ARGS_JSON are required');
}

const args = JSON.parse(argsJson);

export const options = {
    scenarios: {
        comparable_incident_load: {
            executor: 'constant-arrival-rate',
            rate: Number(__ENV.REQUESTS_PER_SECOND || 150),
            timeUnit: '1s',
            duration: __ENV.DURATION || '5m',
            preAllocatedVUs: 80,
            maxVUs: 400,
        },
    },
    thresholds: {
        http_req_failed: ['rate<0.01'],
        http_req_duration: ['p(95)<7000'],
    },
};

export default function () {
    const response = http.post(`${target}/query/assetsApiCuratedPrefetchForApi`, JSON.stringify(args), {
        headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
        },
        timeout: '7s',
        tags: { operation: 'assetsApiCuratedPrefetchForApi' },
    });

    check(response, {
        'composite completed': result => result.status === 200,
        'request slot cleared within seven seconds': result => result.timings.duration <= 7_000,
    });
}
