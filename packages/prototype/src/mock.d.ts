// Types for the in-memory demo. Records stay loosely typed: their fields mirror the Hub projections in mock.js.
/* eslint-disable @typescript-eslint/no-explicit-any */
export const HUB_ORIGIN: string;
export class HubError extends Error {
    constructor(kind: string, message: string, hint?: string);
    kind: 'unreachable' | 'unknown' | 'expired' | 'invalid';
    hint: string;
}
export const roleLabels: Record<string, string>;
export const flavorLabels: Record<string, string>;
export const accessLabels: Record<string, string>;
export const phaseLabels: Record<string, string>;
export type DemoApi = Record<string, (...args: any[]) => Promise<any>>;
export type Demo = {
    api: DemoApi;
    settings: { scenario: string; role: string; spaceId: string; refreshing: boolean };
    readonly user: { id: string; username: string; name: string; hue: number };
    readonly firstRun: boolean;
    space(): { id: string; name: string };
    role(): string;
    isManager(): boolean;
    reset(): void;
};
export function createDemo(): Demo;
