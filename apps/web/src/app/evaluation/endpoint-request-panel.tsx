'use client';

import * as React from 'react';
import { Badge } from '@solana/design-system/badge';
import { CodeBlock } from '@solana/design-system/code-block';
import { Tab, TabList, TabPanel, Tabs } from '@solana/design-system/tabs';

import type { ExecutionEvaluationResponse } from '@/hooks/queries/use-execution-evaluation';

/** Matches the api-manager playground so both surfaces read the same. */
const CODE_BLOCK_CLASS_NAME = '[&_.overflow-x-auto]:text-xs [&_.overflow-x-auto]:leading-6';
const CODE_MAX_HEIGHT_PX = 520;
/**
 * Snippets show the public API host, while this page's own request goes to its
 * same-origin proxy so the browser never holds a key. The path is identical —
 * only the origin differs — which is the same split the dashboard playground
 * makes.
 */
const PUBLIC_API_ORIGIN = 'https://api.tokens.xyz';

export interface EndpointRequestState {
    /** Wall-clock of the last completed request. */
    durationMs: number;
    status: number | 'error';
}

function buildFetchSnippet(requestPath: string): string {
    return [
        'const API_KEY = "<YOUR_API_KEY>";',
        '',
        `const response = await fetch(\`${PUBLIC_API_ORIGIN}${requestPath}\`, {`,
        '  headers: {',
        '    "x-api-key": API_KEY,',
        '    "accept": "application/json",',
        '  },',
        '});',
        '',
        'const { quotes, meta } = await response.json();',
        '',
        '// Who won each size, and by how much it mattered.',
        'for (const quote of quotes) {',
        '  if (quote.status !== "available") continue;',
        '  console.log(',
        '    quote.request.amount,',
        '    quote.best.provider,',
        '    quote.edge ? `+${quote.edge.bps}bps (+$${quote.edge.usd})` : "uncontested",',
        '  );',
        '}',
        '',
        'console.log(meta.summary.bestProvider, meta.summary.medianEdgeBps);',
        '',
    ].join('\n');
}

function buildCurlSnippet(requestPath: string): string {
    return [
        `curl -s '${PUBLIC_API_ORIGIN}${requestPath}' \\`,
        "  -H 'x-api-key: <YOUR_API_KEY>' \\",
        "  -H 'accept: application/json'",
        '',
    ].join('\n');
}

/**
 * Shows the exact request this page is making, so the panel doubles as the
 * endpoint's documentation. The path is passed in rather than rebuilt here —
 * it comes from the same builder the fetch uses.
 */
export function EndpointRequestPanel({
    requestPath,
    data,
    isPending,
    isError,
    lastRequest,
}: {
    requestPath: string;
    data: ExecutionEvaluationResponse | null;
    isPending: boolean;
    isError: boolean;
    lastRequest: EndpointRequestState | null;
}) {
    const [activeTab, setActiveTab] = React.useState('code');

    const statusLabel = isPending
        ? 'Running…'
        : lastRequest
          ? lastRequest.status === 'error'
              ? 'Failed'
              : `${lastRequest.status} OK`
          : 'Not sent';
    const statusVariant = isPending || !lastRequest ? 'default' : isError ? 'danger' : 'success';

    const responseBody = React.useMemo(() => {
        if (!data) return '// Run a request to see the response.';
        return JSON.stringify(data, null, 2);
    }, [data]);

    return (
        <section className="rounded-[24px] border border-border-medium bg-white p-4 shadow-[0_8px_40px_rgba(0,0,0,0.03)]">
            <div className="mb-3">
                <h2 className="text-title-sm text-text-extra-high">The request</h2>
                <p className="mt-0.5 text-[11px] text-text-extra-low">
                    Everything on the left is one authenticated GET. Requires the{' '}
                    <code className="rounded bg-gray-100 px-1 py-0.5 text-[10px]">execution:read</code> scope.
                </p>
            </div>

            <Tabs size="md" bordered={false} fullWidth value={activeTab} onValueChange={setActiveTab}>
                <div className="mb-3 flex items-center justify-between gap-2">
                    <TabList className="w-max">
                        <Tab value="code">Code</Tab>
                        <Tab value="curl">cURL</Tab>
                        <Tab value="response">Response</Tab>
                    </TabList>
                    <div className="flex shrink-0 items-center gap-1.5">
                        <Badge variant={statusVariant} dot className="font-mono">
                            {statusLabel}
                        </Badge>
                        {lastRequest && !isPending ? (
                            <Badge variant="default" className="font-mono">
                                {lastRequest.durationMs}ms
                            </Badge>
                        ) : null}
                    </div>
                </div>

                <TabPanel value="code" className="pt-0">
                    <CodeBlock
                        ariaLabel="Evaluation request code"
                        code={buildFetchSnippet(requestPath)}
                        language="javascript"
                        maxHeight={CODE_MAX_HEIGHT_PX}
                        className={CODE_BLOCK_CLASS_NAME}
                    />
                </TabPanel>
                <TabPanel value="curl" className="pt-0">
                    <CodeBlock
                        ariaLabel="Evaluation request cURL"
                        code={buildCurlSnippet(requestPath)}
                        language="bash"
                        maxHeight={CODE_MAX_HEIGHT_PX}
                        className={CODE_BLOCK_CLASS_NAME}
                    />
                </TabPanel>
                <TabPanel value="response" className="pt-0">
                    <CodeBlock
                        ariaLabel="Evaluation response"
                        code={responseBody}
                        language="json"
                        maxHeight={CODE_MAX_HEIGHT_PX}
                        className={CODE_BLOCK_CLASS_NAME}
                    />
                </TabPanel>
            </Tabs>
        </section>
    );
}
