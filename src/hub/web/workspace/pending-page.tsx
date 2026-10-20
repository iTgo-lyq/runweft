import { EmptyState, PageHead } from '@runweft/ui';
import { pages } from './shell';
import type { View } from '../route';

/** Temporary: entries not yet moved to the new interface during this refactor. Removed when every entry is migrated. */
export function PendingPage({ view }: { view: View }) {
    return (
        <div className="page-inner">
            <PageHead title={pages[view].label} />
            <EmptyState icon={pages[view].icon} title="这个入口正在迁移到新界面">迁移完成前，可以通过 Agent 和 CLI 管理这里的内容。</EmptyState>
        </div>
    );
}
