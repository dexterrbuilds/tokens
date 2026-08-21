'use client';

import { useEffect } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

import { Button } from '@tokens/ui/button';
import { Checkbox } from '@tokens/ui/checkbox';
import { Spinner } from '@tokens/ui/spinner';

import type { ListSelection } from './use-list-selection';

/** Lidded trash can — strokes/fills ride on currentColor so it takes the button's text color. */
function TrashCanIcon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
            <path
                d="M6 9.65043V9.30309C6 8.00173 6.99637 6.91912 8.29472 6.8307C10.4245 6.68565 13.6158 6.50002 16 6.50002C18.3842 6.50002 21.5755 6.68565 23.7053 6.8307C25.0036 6.91912 26 8.00173 26 9.30309V9.65043C26 10.3308 25.4573 10.886 24.777 10.8984C22.7981 10.9346 18.8303 11 16 11C13.1697 11 9.20192 10.9346 7.22296 10.8984C6.54272 10.886 6 10.3308 6 9.65043Z"
                stroke="currentColor"
                strokeWidth={2}
            />
            <path
                d="M18 6.53398C18.7479 6.53398 19.3542 6.58412 19.3542 6.3541C19.3542 5.6063 18.7479 5 18 5H14.2093C13.4614 5 12.8551 5.6063 12.8551 6.3541C12.8551 6.57531 13.2521 6.53398 14 6.53398H18Z"
                stroke="currentColor"
                strokeWidth={2}
            />
            <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M16 27C14.4216 27 12.3348 26.7858 10.876 26.6081C9.82444 26.4801 8.9904 25.6813 8.80082 24.6391C8.51071 23.0442 8.09783 20.6636 7.87503 18.875C7.634 16.9401 7.4377 14.2717 7.33287 12.6945C7.28522 11.9777 7.85448 11.375 8.57285 11.375H16H23.4272C24.1456 11.375 24.7148 11.9777 24.6672 12.6945C24.5624 14.2717 24.3661 16.9401 24.125 18.875C23.9022 20.6636 23.4893 23.0442 23.1992 24.6391C23.0097 25.6813 22.1756 26.4801 21.1241 26.6081C19.6652 26.7858 17.5784 27 16 27Z"
                stroke="currentColor"
                strokeWidth={2}
            />
            <path
                d="M13.4904 16.2201C13.4047 15.535 12.78 15.0491 12.095 15.1348C11.41 15.2204 10.9241 15.8451 11.0097 16.5301L11.6347 21.5301C11.7203 22.2152 12.345 22.7011 13.0301 22.6154C13.7151 22.5298 14.201 21.9051 14.1154 21.2201L13.4904 16.2201Z"
                fill="currentColor"
            />
            <path
                d="M19.9051 15.1348C20.5901 15.2204 21.076 15.8451 20.9904 16.5301L20.3654 21.5301C20.2797 22.2152 19.655 22.7011 18.97 22.6154C18.285 22.5298 17.7991 21.9051 17.8847 21.2201L18.5097 16.2201C18.5953 15.535 19.22 15.0491 19.9051 15.1348Z"
                fill="currentColor"
            />
        </svg>
    );
}

/**
 * Floating multi-select dock, styled after svela's bottom-nav selection pill
 * (MIT, stevesarmiento/svela-prod) but standalone: appears bottom-center
 * whenever rows are selected, offers select-all + bulk Remove, and Escape
 * exits selection mode.
 */
export function SelectionDock({
    selection,
    totalCount,
    allMints,
}: {
    selection: ListSelection;
    totalCount: number;
    allMints: string[];
}) {
    const { selected, hasSelected, handleSelectAll, handleRemoveSelected, clear, isRemoving } = selection;
    const shouldReduceMotion = useReducedMotion();

    // Escape exits selection mode (unless a removal is mid-flight).
    useEffect(() => {
        if (!hasSelected) return;
        function onKeyDown(event: KeyboardEvent) {
            if (event.key !== 'Escape' || isRemoving) return;
            event.preventDefault();
            clear();
        }
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [hasSelected, isRemoving, clear]);

    return (
        <AnimatePresence>
            {hasSelected && (
                <div className="pointer-events-none fixed bottom-8 left-0 right-0 z-50 flex justify-center px-4">
                    <motion.div
                        initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.95, y: 8 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={shouldReduceMotion ? undefined : { opacity: 0, scale: 0.95, y: 8 }}
                        transition={{ type: 'tween', duration: 0.2, ease: [0.65, 0, 0.35, 1] }}
                        className="pointer-events-auto flex h-[56px] w-[400px] max-w-[calc(100vw-2rem)] items-center rounded-full bg-zinc-800 p-1 shadow-[0_3px_8px_rgba(0,0,0,0.2),0_2px_4px_rgba(0,0,0,0.1)]"
                    >
                        <div className="flex h-full w-full items-center justify-between px-2">
                            <div className="flex items-center gap-3">
                                <Checkbox
                                    // Dark pill: the default checked fill (bg-primary) would
                                    // disappear against zinc-800, so invert to white-on-dark.
                                    className="border-white/25 bg-white/10 hover:border-white/40 hover:bg-white/20 focus-visible:ring-white/30 data-[state=checked]:border-white data-[state=checked]:bg-white data-[state=checked]:text-zinc-900 data-[state=checked]:hover:bg-white/90"
                                    checked={selected.size === totalCount && totalCount > 0}
                                    onCheckedChange={checked => handleSelectAll(checked === true, allMints)}
                                    aria-label="Select all tokens"
                                />
                                <span className="font-berkeley-mono text-xs font-medium text-white">
                                    {selected.size} of {totalCount} selected
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Button
                                    onClick={() => void handleRemoveSelected()}
                                    disabled={selected.size === 0 || isRemoving}
                                    variant="destructive"
                                    size="sm"
                                    className="h-7 rounded-full px-2 !pr-3 text-xs text-white"
                                >
                                    {isRemoving ? (
                                        <span className="flex items-center gap-1.5 text-white">
                                            <Spinner size="sm" />
                                            Removing…
                                        </span>
                                    ) : (
                                        <span className="flex items-center gap-1.5 text-white">
                                            <TrashCanIcon className="size-4" />
                                            Remove
                                        </span>
                                    )}
                                </Button>
                                <Button
                                    onClick={clear}
                                    disabled={isRemoving}
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 rounded-full px-2.5 text-xs text-zinc-300 hover:bg-white/10 hover:text-white"
                                >
                                    Cancel
                                </Button>
                            </div>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
