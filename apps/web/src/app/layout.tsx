import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
import { Agentation } from 'agentation';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { Toaster } from 'sonner';
import { FloatingMarketFeedProvider } from '@/components/floating-market-feed-context';
import { FloatingMarketFeedLazy, MobileMarketBannerLazy } from '@/components/floating-market-feed-lazy';
import { GoogleAnalytics } from '@/components/google-analytics';
import { Header } from '@/components/header';
import { QueryProvider } from '@/providers/query-provider';
import { SearchVisibilityProvider } from '@/components/search-visibility-provider';
import './globals.css';

const GA_MEASUREMENT_ID = process.env.NODE_ENV === 'production' ? 'G-CWCQMKEH99' : undefined;

export const metadata: Metadata = {
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
    title: 'Token Radar | Live Solana Asset Intelligence',
    description:
        'See what is moving across tokenized assets on Solana: activity, volume pace, liquidity, momentum, and representation trust.',
    openGraph: {
        type: 'website',
        title: 'Token Radar | Live Solana Asset Intelligence',
        description: 'See the market before the headline.',
        images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Token Radar market intelligence sweep' }],
    },
    twitter: {
        card: 'summary_large_image',
        title: 'Token Radar | Live Solana Asset Intelligence',
        description: 'See the market before the headline.',
        images: ['/og.png'],
    },
    icons: {
        icon: [
            { url: '/favicon.ico', sizes: '32x32' },
            { url: '/icon-light.svg', type: 'image/svg+xml', media: '(prefers-color-scheme: light)' },
            { url: '/icon-dark.svg', type: 'image/svg+xml', media: '(prefers-color-scheme: dark)' },
        ],
        apple: { url: '/apple-touch-icon.png', sizes: '180x180' },
    },
    manifest: '/manifest.json',
};

export const viewport: Viewport = {
    themeColor: '#f4f2ea',
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <head>
                {/* GA loader origin (production only, but the hint is harmless in dev). */}
                <link rel="preconnect" href="https://www.googletagmanager.com" />
                {/* Pyth Hermes realtime price stream (fetch/EventSource → CORS). */}
                <link rel="preconnect" href="https://hermes.pyth.network" crossOrigin="anonymous" />
                <link
                    rel="preload"
                    href="/fonts/InterVariable.woff2"
                    as="font"
                    type="font/woff2"
                    crossOrigin="anonymous"
                />
            </head>
            <body className="font-sans min-h-dvh bg-background antialiased">
                {GA_MEASUREMENT_ID ? <GoogleAnalytics measurementId={GA_MEASUREMENT_ID} /> : null}
                <Suspense fallback={null}>
                    <NuqsAdapter>
                        <QueryProvider>
                            <FloatingMarketFeedProvider>
                                <SearchVisibilityProvider>
                                    <Header />
                                    <MobileMarketBannerLazy />
                                    {children}
                                    <FloatingMarketFeedLazy />
                                    <Toaster position="top-center" richColors closeButton />
                                    {process.env.NODE_ENV === 'development' &&
                                        process.env.NEXT_PUBLIC_AGENTATION_ENABLED === 'true' && (
                                        <Agentation endpoint="http://localhost:4747" />
                                    )}
                                </SearchVisibilityProvider>
                            </FloatingMarketFeedProvider>
                        </QueryProvider>
                    </NuqsAdapter>
                </Suspense>
            </body>
        </html>
    );
}
