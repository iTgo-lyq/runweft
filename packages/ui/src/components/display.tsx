import { Children, type ComponentProps, type ReactNode } from 'react';
import { Icon, type IconName } from '../icons';
import { cn } from '../lib/cn';
import { initial } from '../lib/format';
import { taskStatus, toneIcons, type TaskStatus, type Tone } from '../lib/status';
import { Button } from './button';

export function Badge({ tone, icon, children, className }: { tone?: Tone; icon?: IconName; children: ReactNode; className?: string }) {
  return <span className={cn('badge', className)} data-tone={tone}>{icon && <Icon name={icon} />}<span>{children}</span></span>;
}

export function Tag({ tone, icon, children, className, title }: { tone?: Tone; icon?: IconName; children: ReactNode; className?: string; title?: string }) {
  return <span className={cn('tag', className)} data-tone={tone} title={title}>{icon && <Icon name={icon} />}{children}</span>;
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const spec = taskStatus[status];
  return <Badge tone={spec.tone} icon={spec.icon}>{spec.label}</Badge>;
}

export function Banner({ tone = 'info', title, children, actions, className }: { tone?: Tone; title: ReactNode; children?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('banner', className)} data-tone={tone} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon name={toneIcons[tone]} />
      <div className="banner-text"><strong>{title}</strong>{children && <p>{children}</p>}</div>
      {actions && <div className="banner-actions">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon = 'info', title, children, actions, tone }: { icon?: IconName; title: ReactNode; children?: ReactNode; actions?: ReactNode; tone?: Tone }) {
  return (
    <div className="empty" data-tone={tone}>
      <div className="empty-glyph"><Icon name={icon} /></div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {actions && <div className="empty-actions">{actions}</div>}
    </div>
  );
}

export type FactRow = readonly [label: string, value: ReactNode] | false | null | undefined;

export function Facts({ rows, compact = false, className }: { rows: FactRow[]; compact?: boolean; className?: string }) {
  return (
    <dl className={cn('facts', compact && 'compact', className)}>
      {rows.filter((row): row is readonly [string, ReactNode] => !!row).map(([label, value]) => (
        <div className="fact" key={label}><dt>{label}</dt><dd>{value ?? '—'}</dd></div>
      ))}
    </dl>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('mono', className)}>{children}</span>;
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

export function Loading({ children = '正在读取…' }: { children?: ReactNode }) {
  return <div className="loading" role="status"><Spinner />{children}</div>;
}

export function Avatar({ name, hue = 0, size = 'md' }: { name: string; hue?: number; size?: 'md' | 'lg' }) {
  return <span className="avatar" data-hue={String(hue)} data-size={size} aria-hidden="true">{initial(name)}</span>;
}

/** A relation thread such as machine → native tool → round. Each arrow stays with the node it points to. */
export function Chain({ parts, label }: { parts: (string | false | null | undefined)[]; label?: string }) {
  const items = parts.filter((part): part is string => !!part);
  return (
    <span className="chain" title={label ?? items.join(' → ')}>
      {items.map((part, index) => index
        ? <span className="chain-step" key={index}><span className="chain-link"><span className="sr-only">，</span></span><span className="chain-node">{part}</span></span>
        : <span className="chain-node" key={index}>{part}</span>)}
    </span>
  );
}

export type WeftRound = { id: string; ordinal: number; tone?: Tone; phaseLabel: string };

/** The signature element: rounds woven along one weft thread, newest at the end. */
export function Weft({ rounds, currentId, onSelect }: { rounds: WeftRound[]; currentId: string; onSelect: (id: string) => void }) {
  return (
    <ol className="weft" aria-label="轮次">
      {rounds.map(round => (
        <li className="weft-node" key={round.id} data-tone={round.tone} data-current={String(round.id === currentId)}>
          <button type="button" aria-current={round.id === currentId ? 'step' : undefined} onClick={() => onSelect(round.id)}>
            <span className="knot" aria-hidden="true">{round.ordinal}</span>
            <span className="weft-label"><strong>第 {round.ordinal} 轮</strong><small>{round.phaseLabel}</small></span>
          </button>
        </li>
      ))}
    </ol>
  );
}

export function PageHead({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="page-title"><h1 tabIndex={-1}>{title}</h1>{description && <p className="page-desc">{description}</p>}</div>
      {Children.count(actions) > 0 && <div className="page-actions">{actions}</div>}
    </header>
  );
}

/** A titled group inside an inspector panel. */
export function Section({ title, children, className }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={cn('panel-section', className)}>{title && <h3 className="section-title">{title}</h3>}{children}</section>;
}

/** A titled group on a full page, separated by a hairline. */
export function Block({ title, aside, children, className }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('block', className)}>
      {title && (aside ? <div className="block-head"><h2>{title}</h2>{aside}</div> : <h2>{title}</h2>)}
      {children}
    </section>
  );
}

export function Pager({ page, pages, onPage, text }: { page: number; pages: number; onPage: (page: number) => void; text?: ReactNode }) {
  return (
    <nav className="pager" aria-label="分页">
      <span className="pager-text">{text ?? `第 ${page} / ${Math.max(pages, 1)} 页`}</span>
      <Button size="sm" icon="chevron-left" disabled={page <= 1} onClick={() => onPage(page - 1)}>上一页</Button>
      <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>下一页</Button>
    </nav>
  );
}

export function Disclosure({ summary, hint, children, className, ...props }: { summary: ReactNode; hint?: ReactNode; children: ReactNode } & ComponentProps<'details'>) {
  return <details className={cn('disclosure', className)} {...props}><summary>{summary}{hint && <span>{hint}</span>}</summary>{children}</details>;
}
