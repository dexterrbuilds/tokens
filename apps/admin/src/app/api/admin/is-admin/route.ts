import 'server-only';

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { resolveAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

/** Replaces the Convex `adminCuratedTokens.isAdmin` query — answered locally from the allowlist. */
export async function GET() {
    const session = await auth();
    const isAdmin = session.userId ? (await resolveAdmin(session.userId)).isAdmin : false;
    return NextResponse.json({ isAdmin });
}
