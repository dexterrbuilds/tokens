import type { Metadata } from 'next';

import { RadarHome } from '@/components/radar/radar-home';

export const metadata: Metadata = {
    title: 'Token Radar | Live Solana Asset Intelligence',
    description:
        'See what is moving across tokenized assets on Solana right now: activity, volume pace, liquidity, momentum, and representation trust.',
};

export default function HomePage() {
    return <RadarHome />;
}
