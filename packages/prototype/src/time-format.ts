// The UI library's time wording, measured against the prototype's fixed clock.
import { relativeTime } from '@runweft/ui';
import { NOW } from './time.js';

export const relative = (time: number | null | undefined) => relativeTime(time, NOW);
