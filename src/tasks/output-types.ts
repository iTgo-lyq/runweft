import type { ArtifactOutput, ArtifactTransfer, CaptureRequest, DeliverRequest } from '../../hapi/shared/src/artifactTransfers';
import type { ArtifactReference } from '../../hapi/shared/src/artifacts';
import type { Problem } from '../resources/types';

export type OutputItem = ArtifactOutput & {
    status: 'available' | 'failed'; error?: Problem; artifactId?: string;
    captureOperationId?: string; capturedAt?: number; size?: number; sha256?: string;
    upload?: { requestId: string; reference: Pick<ArtifactReference, 'reference' | 'purpose'> };
};
export type OutputManifest = { version: number; jobId: string; kind: OutputJob['kind']; createdAt: number;
    status: 'delivered' | 'incomplete'; items: OutputItem[] };
export type OutputStep<T> = { request: T; attempted: boolean; result?: ArtifactTransfer };
export type OutputJob = { id: string; requestId: string; kind: 'initial' | 'collect' | 'retry'; createdAt: number;
    phase: 'pending' | 'capturing' | 'delivering' | 'publishing' | 'cleanup' | 'complete';
    declarations: ArtifactOutput[]; base: OutputItem[]; items?: OutputItem[];
    capture?: OutputStep<CaptureRequest>; deliveries?: OutputStep<DeliverRequest>[];
    cleanup?: { operationId: string; names: string[]; done: boolean }[]; publishedVersion?: number; error?: Problem };
export type OutputFiles = { declarations: ArtifactOutput[]; jobs: OutputJob[]; latest?: OutputManifest };
export function pendingOutputs(declarations: ArtifactOutput[] | undefined, requestId: string): OutputFiles | undefined {
    if (!declarations?.length) return;
    return { declarations, jobs: [{ id: crypto.randomUUID(), requestId, kind: 'initial', createdAt: Date.now(), phase: 'pending', declarations, base: [] }] };
}
