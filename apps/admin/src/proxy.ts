import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { resolveAdmin } from '@/lib/admin-auth';

const isPublicRoute = createRouteMatcher(['/sign-in(.*)', '/sign-up(.*)', '/sso-callback(.*)']);

function parseAuthorizedParties(): string[] | undefined {
    const raw = process.env.CLERK_AUTHORIZED_PARTIES?.trim();
    if (!raw) return undefined;

    const parties = raw
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);

    return parties.length > 0 ? parties : undefined;
}

const authorizedParties = parseAuthorizedParties();

export default clerkMiddleware(
    async (auth, req) => {
        const { isAuthenticated, userId, redirectToSignIn } = await auth();

        if (isPublicRoute(req)) {
            if (isAuthenticated) return NextResponse.redirect(new URL('/', req.url));
            return NextResponse.next();
        }

        if (!isAuthenticated) return redirectToSignIn({ returnBackUrl: req.url });

        // Being signed in is not enough: only allowlisted admins may load any
        // part of this app. Non-admins get a hard 403, not a redirect loop.
        const { isAdmin } = await resolveAdmin(userId);
        if (!isAdmin) return new NextResponse('Forbidden', { status: 403 });
    },
    authorizedParties ? { authorizedParties } : undefined,
);

export const config = {
    matcher: [
        '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
        '/(api|trpc)(.*)',
    ],
};
