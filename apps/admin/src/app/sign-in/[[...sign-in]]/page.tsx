import { SignIn } from '@clerk/nextjs';
import { hasUsableClerkPublishableKey } from '@/lib/clerk-config';

/**
 * Minimal sign-in page using Clerk's prebuilt <SignIn>. The App Router
 * catch-all lets Clerk handle SSO callbacks and sub-steps within /sign-in/**,
 * so no separate /sso-callback route is needed (unlike apps/app, which drives
 * Clerk manually for its custom wallet-auth UI).
 */
export default function SignInPage() {
    const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
    if (!hasUsableClerkPublishableKey(clerkPublishableKey)) {
        return (
            <div className="mx-auto max-w-2xl p-6">
                <div className="rounded-md border border-border-medium bg-card p-4 text-body-md">
                    <div className="font-inter-medium">Missing `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`</div>
                    <div className="text-muted-foreground">
                        Set Clerk env vars for the admin app before signing in.
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex min-h-screen items-center justify-center p-6">
            <SignIn />
        </div>
    );
}
