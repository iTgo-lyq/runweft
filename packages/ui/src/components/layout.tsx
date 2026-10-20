import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ComponentProps, type KeyboardEvent, type ReactNode } from 'react';
import { Icon, Mark, type IconName } from '../icons';
import { cn } from '../lib/cn';
import { Avatar } from './display';
import { Button } from './button';

// The scrim closes whatever floats over the page on tablets and phones: the navigation drawer or an inspector.
const SCRIM = 'runweft:scrim';
const onScrim = (listener: () => void) => { window.addEventListener(SCRIM, listener); return () => window.removeEventListener(SCRIM, listener); };

/** Moves focus to the page without touching the hash, which the app may use for routing. */
export function SkipLink() {
  return <a className="skip" href="#page" onClick={event => { event.preventDefault(); document.getElementById('page')?.focus(); }}>跳到主内容</a>;
}

/** Sidebar on the window canvas, content as one surface with a floating glass toolbar. */
export function AppFrame({ sidebar, toolbar, children, navOpen, onNavOpenChange }: {
  sidebar: ReactNode; toolbar: ReactNode; children: ReactNode; navOpen: boolean; onNavOpenChange: (open: boolean) => void;
}) {
  useEffect(() => {
    document.body.dataset.nav = navOpen ? 'open' : 'closed';
    if (!navOpen) return;
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') onNavOpenChange(false); };
    document.addEventListener('keydown', onKey);
    const off = onScrim(() => onNavOpenChange(false));
    document.querySelector<HTMLElement>('.sidebar .nav-item[aria-current=page]')?.focus();
    return () => { document.removeEventListener('keydown', onKey); off(); };
  }, [navOpen, onNavOpenChange]);
  return (
    <div className="app">
      {sidebar}
      <div className="main">
        <section className="surface" aria-label="内容">
          {toolbar}
          <main className="page" id="page" tabIndex={-1}>{children}</main>
        </section>
      </div>
      <div className="scrim" aria-hidden="true" onClick={() => window.dispatchEvent(new Event(SCRIM))} />
    </div>
  );
}

export function Sidebar({ top, children, foot, onClose }: { top?: ReactNode; children: ReactNode; foot?: ReactNode; onClose: () => void }) {
  return (
    <aside className="sidebar" aria-label="工作台">
      <div className="brand">
        <Mark /><span className="brand-name">Runweft</span><span className="brand-tag">Hub</span>
        <Button icon="x" iconOnly label="收起导航" variant="ghost" size="sm" className="nav-close" onClick={onClose} />
      </div>
      {top}
      <nav className="nav" aria-label="主导航">{children}</nav>
      {foot && <div className="sidebar-foot">{foot}</div>}
    </aside>
  );
}

export const NavLabel = ({ children }: { children: ReactNode }) => <p className="nav-label">{children}</p>;

export function NavItem({ icon, current = false, href, onSelect, children }: { icon: IconName; current?: boolean; href?: string; onSelect: () => void; children: ReactNode }) {
  return (
    <a className="nav-item" href={href ?? '#'} aria-current={current ? 'page' : undefined} onClick={event => { event.preventDefault(); onSelect(); }}>
      <Icon name={icon} /><span>{children}</span>
    </a>
  );
}

export function NavButton({ icon, onClick, children }: { icon: IconName; onClick: () => void; children: ReactNode }) {
  return <button type="button" className="nav-item" onClick={onClick}><Icon name={icon} /><span>{children}</span></button>;
}

/** Trigger for the space menu; spreads props so it can sit inside a Radix trigger. */
export function SpaceSwitch({ name, detail, ...props }: { name: string; detail: string } & ComponentProps<'button'>) {
  return (
    <button type="button" className="space-switch" aria-label={`当前空间：${name}，${detail}`} {...props}>
      <span className="space-glyph" aria-hidden="true">{Array.from(name)[0] ?? '?'}</span>
      <span className="space-text"><strong>{name}</strong><small>{detail}</small></span>
      <Icon name="updown" />
    </button>
  );
}

export function AccountChip({ name, username, hue = 0, ...props }: { name: string; username: string; hue?: number } & ComponentProps<'button'>) {
  return (
    <button type="button" className="account-chip" aria-label={`账号：${name}。打开账号菜单`} {...props}>
      <Avatar name={name} hue={hue} />
      <span className="account-text"><strong>{name}</strong><small>{username}</small></span>
      <Icon name="updown" />
    </button>
  );
}

export function Toolbar({ crumbs, actions, onOpenNav }: { crumbs: ReactNode; actions?: ReactNode; onOpenNav: () => void }) {
  return (
    <header className="toolbar glass">
      <Button icon="menu" iconOnly label="打开导航" variant="ghost" className="nav-open" onClick={onOpenNav} />
      <div className="crumbs">{crumbs}</div>
      {actions && <div className="toolbar-actions">{actions}</div>}
    </header>
  );
}

export function Crumbs({ space, page }: { space: ReactNode; page: ReactNode }) {
  return <><span className="crumb-space">{space}</span><Icon name="chevron-right" className="icon crumb-sep" /><span className="crumb-page">{page}</span></>;
}

/** `/` focuses the page filter unless the user is typing. */
export function useFindShortcut() {
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== '/' || event.metaKey || event.ctrlKey || target?.closest?.('input, textarea, select, [contenteditable]')) return;
      const find = document.querySelector<HTMLInputElement>('[data-find]');
      if (find) { event.preventDefault(); find.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}

// ---- list + inspector -----------------------------------------------------------------

export type Split<K extends string = string> = {
  key: K | null;
  open(key: K, options?: { from?: HTMLElement | null; focus?: boolean }): void;
  close(options?: { restore?: boolean }): void;
};

/** Opening remembers the row that opened the inspector; closing returns focus to it. */
export function useSplit<K extends string = string>(initial: K | null = null): Split<K> & { focusRequest: number; restoreRequest: { key: K | null; at: number } | null; opener: { current: HTMLElement | null } } {
  const [key, setKey] = useState<K | null>(initial);
  const [focusRequest, setFocusRequest] = useState(0);
  const [restoreRequest, setRestoreRequest] = useState<{ key: K | null; at: number } | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const keyRef = useRef(key);
  keyRef.current = key;
  const open = useCallback((next: K, { from, focus = true }: { from?: HTMLElement | null; focus?: boolean } = {}) => {
    if (from) opener.current = from;
    setKey(next);
    if (focus) setFocusRequest(value => value + 1);
  }, []);
  const close = useCallback(({ restore = true }: { restore?: boolean } = {}) => {
    const previous = keyRef.current;
    if (previous === null) return;
    setKey(null);
    if (restore) setRestoreRequest({ key: previous, at: Date.now() });
  }, []);
  return { key, open, close, focusRequest, restoreRequest, opener };
}

export function SplitView<K extends string>({ split, label, list, children }: { split: ReturnType<typeof useSplit<K>>; label: string; list: ReactNode; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null), panel = useRef<HTMLElement>(null);
  const open = split.key !== null;
  useEffect(() => {
    if (!open) return;
    document.body.dataset.panel = 'open';
    const off = onScrim(() => split.close());
    return () => { delete document.body.dataset.panel; off(); };
  }, [open, split.close]);
  useEffect(() => {
    if (!split.focusRequest) return;
    requestAnimationFrame(() => (panel.current?.querySelector<HTMLElement>('.panel-head h2') ?? panel.current)?.focus());
  }, [split.focusRequest]);
  useLayoutEffect(() => {
    const request = split.restoreRequest;
    if (!request) return;
    const opener = split.opener.current;
    const target = opener?.isConnected ? opener : root.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(request.key ?? '')}"]`);
    target?.focus();
  }, [split.restoreRequest, split.opener]);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && !event.defaultPrevented && !(event.target as HTMLElement).closest('[role=dialog], [role=alertdialog], [role=menu]')) { event.preventDefault(); split.close(); }
  };
  return (
    <div ref={root} className="split" data-open={String(open)}>
      <div className="split-list">{list}</div>
      <aside ref={panel} className="panel" aria-label={label} tabIndex={-1} hidden={!open} onKeyDown={onKeyDown}>{open && children}</aside>
    </div>
  );
}

export function PanelHead({ title, eyebrow, badges, sub, actions, onClose }: { title: ReactNode; eyebrow?: ReactNode; badges?: ReactNode; sub?: ReactNode; actions?: ReactNode; onClose: () => void }) {
  return (
    <header className="panel-head">
      <div className="panel-heading">
        {eyebrow && <p className="panel-eyebrow">{eyebrow}</p>}
        <h2 tabIndex={-1}>{title}</h2>
        {(badges || sub) && <div className="panel-sub">{badges}{sub}</div>}
      </div>
      <div className="panel-tools">{actions}<Button icon="x" iconOnly label="关闭详情" variant="ghost" size="sm" onClick={onClose} /></div>
    </header>
  );
}

export const PanelInner = ({ children }: { children: ReactNode }) => <div className="panel-inner">{children}</div>;

/** Arrow keys, Home and End move between rows; Enter or Space opens the focused row. */
export function RowList({ label, table = false, children, className }: { label: string; table?: boolean; children: ReactNode; className?: string }) {
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const target = event.target as HTMLElement;
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !target.matches('.row')) return;
    const rows = [...event.currentTarget.querySelectorAll<HTMLElement>('.row')];
    const at = rows.indexOf(target);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : at + (event.key === 'ArrowDown' ? 1 : -1);
    if (rows[next]) { event.preventDefault(); rows[next].focus(); }
  };
  return <ul className={cn('rows', table && 'rows-table', className)} aria-label={label} onKeyDown={onKeyDown}>{children}</ul>;
}

export function Row({ rowKey, opened, onOpen, children, label }: { rowKey: string; opened: boolean; onOpen: (from: HTMLElement) => void; children: ReactNode; label?: string }) {
  return (
    <li>
      <button type="button" className="row" data-key={rowKey} data-opened={String(opened)} aria-label={label} onClick={event => onOpen(event.currentTarget)}>
        {children}
        <Icon name="chevron-right" className="icon row-go" />
      </button>
    </li>
  );
}

/** Rename in place. Saving keeps the editor open when `onSave` resolves to false. */
export function InlineEdit({ label, value, max = 80, editable = true, mono = false, onSave }: { label: string; value: string; max?: number; editable?: boolean; mono?: boolean; onSave: (value: string) => Promise<boolean | void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), input = useRef<HTMLInputElement>(null);
  const returnFocus = useRef(false);
  useEffect(() => { if (editing) { input.current?.focus(); input.current?.select(); } else if (returnFocus.current) { returnFocus.current = false; trigger.current?.focus(); } }, [editing]);
  const stop = () => { returnFocus.current = true; setEditing(false); };
  if (!editing) {
    return (
      <div className="inline-edit">
        <span className={mono ? 'inline-value mono' : 'inline-value'}>{value}</span>
        {editable && <Button ref={trigger} icon="edit" iconOnly label={`修改${label}`} variant="ghost" size="sm" onClick={() => { setDraft(value); setEditing(true); }} />}
      </div>
    );
  }
  return (
    <div className="inline-edit">
      <form className="inline-form" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); stop(); } }}
        onSubmit={async event => { event.preventDefault(); setBusy(true); try { if ((await onSave(draft.trim())) !== false) stop(); } finally { setBusy(false); } }}>
        <div className="field">
          <label htmlFor={id} className="field-label">{label}</label>
          <input ref={input} id={id} required maxLength={max} value={draft} onChange={event => setDraft(event.target.value)} />
        </div>
        <div className="inline-actions">
          <Button variant="ghost" size="sm" onClick={stop}>取消</Button>
          <Button type="submit" variant="primary" size="sm" disabled={busy}>保存</Button>
        </div>
      </form>
    </div>
  );
}
