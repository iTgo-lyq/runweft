import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactElement, type ReactNode } from 'react';
import { AlertDialog, Dialog as DialogPrimitive, DropdownMenu, Popover as PopoverPrimitive } from 'radix-ui';
import { Icon, type IconName } from '../icons';
import { cn } from '../lib/cn';
import { Button } from './button';

// ---- menus ---------------------------------------------------------------------------
// Menus are non-modal so the page keeps scrolling; Radix supplies arrow keys, typeahead, Escape and focus return.

export function Menu({ trigger, label, align = 'start', children, className }: { trigger: ReactElement; label: string; align?: 'start' | 'end'; children: ReactNode; className?: string }) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={cn('menu glass', className)} aria-label={label} align={align} sideOffset={6} collisionPadding={8}>{children}</DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

type MenuItemProps = { icon?: IconName; description?: ReactNode; danger?: boolean; disabled?: boolean; onSelect?: () => void; children: ReactNode };

function MenuItemBody({ icon, description, children, checked }: Pick<MenuItemProps, 'icon' | 'description' | 'children'> & { checked?: boolean }) {
  return (
    <>
      {icon ? <Icon name={icon} /> : <span className="icon-space" />}
      <span className="menu-text"><span>{children}</span>{description && <small>{description}</small>}</span>
      {checked && <Icon name="check" className="icon menu-check" />}
    </>
  );
}

export function MenuItem({ icon, description, danger, disabled, onSelect, children }: MenuItemProps) {
  return (
    <DropdownMenu.Item className="menu-item" data-tone={danger ? 'danger' : undefined} disabled={disabled} onSelect={() => onSelect?.()}>
      <MenuItemBody icon={icon} description={description}>{children}</MenuItemBody>
    </DropdownMenu.Item>
  );
}

export function MenuRadioGroup({ value, onValueChange, children }: { value: string; onValueChange: (value: string) => void; children: ReactNode }) {
  return <DropdownMenu.RadioGroup value={value} onValueChange={onValueChange}>{children}</DropdownMenu.RadioGroup>;
}

export function MenuRadioItem({ value, icon, description, checked, children }: { value: string; icon?: IconName; description?: ReactNode; checked: boolean; children: ReactNode }) {
  return (
    <DropdownMenu.RadioItem className="menu-item" value={value}>
      <MenuItemBody icon={icon} description={description} checked={checked}>{children}</MenuItemBody>
    </DropdownMenu.RadioItem>
  );
}

export const MenuSeparator = () => <DropdownMenu.Separator className="menu-sep" />;
export const MenuLabel = ({ children }: { children: ReactNode }) => <DropdownMenu.Label className="menu-label">{children}</DropdownMenu.Label>;

// ---- popover ---------------------------------------------------------------------------

export function Popover({ trigger, label, align = 'start', open, onOpenChange, children, className }: {
  trigger: ReactElement; label: string; align?: 'start' | 'end'; open?: boolean; onOpenChange?: (open: boolean) => void; children: ReactNode; className?: string;
}) {
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content className={cn('popover glass', className)} aria-label={label} align={align} sideOffset={6} collisionPadding={8}>{children}</PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

// ---- dialog ---------------------------------------------------------------------------
// Focus starts on the first field, else the primary action, and returns to the opener on close.

function focusFirst(content: HTMLElement | null) {
  const target = content?.querySelector<HTMLElement>('.dialog-body input:not([type=hidden]), .dialog-body select, .dialog-body textarea')
    ?? content?.querySelector<HTMLElement>('.dialog-foot [data-variant=primary], .dialog-foot [data-variant=danger]')
    ?? content?.querySelector<HTMLElement>('.dialog-foot button, .dialog-body [tabindex="0"]');
  target?.focus();
}

/**
 * Radix returns focus only to its own Trigger; controlled dialogs remember whatever opened them instead. A dialog
 * opened from a menu item returns to the menu's trigger, because the item goes away with the menu.
 */
function useOpener(open: boolean) {
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const active = document.activeElement as HTMLElement | null, menu = active?.closest('[role=menu]');
    opener.current = (menu && document.getElementById(menu.getAttribute('aria-labelledby') ?? '')) || active;
  }, [open]);
  return (event: Event) => { event.preventDefault(); if (opener.current?.isConnected) opener.current.focus(); opener.current = null; };
}

export function Dialog({ open, onOpenChange, title, description, size = 'md', footer, children }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: ReactNode; description?: ReactNode; size?: 'sm' | 'md'; footer?: ReactNode; children?: ReactNode;
}) {
  const content = useRef<HTMLDivElement>(null);
  const restore = useOpener(open);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content ref={content} className="dialog" data-size={size} {...(description ? {} : { 'aria-describedby': undefined })}
          onOpenAutoFocus={event => { event.preventDefault(); focusFirst(content.current); }} onCloseAutoFocus={restore}>
          <div className="dialog-head">
            <div>
              <DialogPrimitive.Title asChild><h2>{title}</h2></DialogPrimitive.Title>
              {description ? <DialogPrimitive.Description className="dialog-desc">{description}</DialogPrimitive.Description> : null}
            </div>
            <DialogPrimitive.Close asChild><Button icon="x" iconOnly label="关闭" variant="ghost" size="sm" className="dialog-close" /></DialogPrimitive.Close>
          </div>
          {children !== undefined && <div className="dialog-body">{children}</div>}
          {footer && <div className="dialog-foot">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ---- confirmation ------------------------------------------------------------------------

export type ConfirmOptions = { title?: string; confirmLabel?: string; danger?: boolean };
type ConfirmRequest = ConfirmOptions & { message: ReactNode; resolve: (ok: boolean) => void };
const ConfirmContext = createContext<((message: ReactNode, options?: ConfirmOptions) => Promise<boolean>) | null>(null);

/** Provides `useConfirm()`. Destructive confirmations start on Cancel; others start on the confirm action. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const cancel = useRef<HTMLButtonElement>(null), ok = useRef<HTMLButtonElement>(null);
  const confirm = useCallback((message: ReactNode, options: ConfirmOptions = {}) => new Promise<boolean>(resolve => setRequest({ ...options, message, resolve })), []);
  const finish = (value: boolean) => { request?.resolve(value); setRequest(null); };
  const restore = useOpener(!!request);
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog.Root open={!!request} onOpenChange={open => { if (!open) finish(false); }}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="dialog-overlay" />
          <AlertDialog.Content className="dialog" data-size="sm" onOpenAutoFocus={event => { event.preventDefault(); (request?.danger ? cancel : ok).current?.focus(); }} onCloseAutoFocus={restore}>
            <div className="dialog-head"><div>
              <AlertDialog.Title asChild><h2>{request?.title ?? '确认操作'}</h2></AlertDialog.Title>
              <AlertDialog.Description className="dialog-desc">{request?.message}</AlertDialog.Description>
            </div></div>
            <div className="dialog-foot">
              <AlertDialog.Cancel asChild><Button ref={cancel} onClick={() => finish(false)}>取消</Button></AlertDialog.Cancel>
              <AlertDialog.Action asChild><Button ref={ok} variant={request?.danger ? 'danger' : 'primary'} onClick={() => finish(true)}>{request?.confirmLabel ?? '确认'}</Button></AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm requires <ConfirmProvider>.');
  return confirm;
}

// ---- toasts ----------------------------------------------------------------------------
// Success is announced as a short toast; failures belong in page banners, not here.

export type ToastTone = 'ok' | 'info' | 'warn';
type ToastItem = { id: number; message: ReactNode; tone: ToastTone; leaving: boolean };
let toasts: ToastItem[] = [], nextToast = 0;
const listeners = new Set<() => void>();
const publish = (next: ToastItem[]) => { toasts = next; listeners.forEach(listener => listener()); };

export function toast(message: ReactNode, tone: ToastTone = 'ok') {
  const id = ++nextToast;
  publish([...toasts, { id, message, tone, leaving: false }]);
  setTimeout(() => publish(toasts.map(item => item.id === id ? { ...item, leaving: true } : item)), 3400);
  setTimeout(() => publish(toasts.filter(item => item.id !== id)), 3800);
}

export function Toaster() {
  const items = useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => toasts, () => toasts);
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {items.map(item => (
        <div key={item.id} className={cn('toast glass', item.leaving && 'leaving')} data-tone={item.tone}>
          <Icon name={item.tone === 'ok' ? 'check' : item.tone === 'warn' ? 'st-attention' : 'info'} /><span>{item.message}</span>
        </div>
      ))}
    </div>
  );
}
