import { useId, useState, type ComponentProps, type FormEvent, type ReactNode } from 'react';
import { Switch as SwitchPrimitive } from 'radix-ui';
import { Icon } from '../icons';
import { cn } from '../lib/cn';
import { Button } from './button';

type FieldShell = { label: ReactNode; hint?: ReactNode; className?: string };

function FieldFrame({ id, label, hint, hintId, className, children }: FieldShell & { id: string; hintId: string; children: ReactNode }) {
  return (
    <div className={cn('field', className)}>
      <label htmlFor={id} className="field-label">{label}</label>
      {children}
      {hint && <p className="field-hint" id={hintId}>{hint}</p>}
    </div>
  );
}

export type TextFieldProps = FieldShell & Omit<ComponentProps<'input'>, 'className'> & { mono?: boolean; inputClassName?: string };

export function TextField({ label, hint, className, mono, inputClassName, id: givenId, ...input }: TextFieldProps) {
  const auto = useId(), id = givenId ?? auto, hintId = `${id}-hint`;
  return (
    <FieldFrame id={id} label={label} hint={hint} hintId={hintId} className={className}>
      <input id={id} type="text" aria-describedby={hint ? hintId : undefined} className={cn(mono && 'mono-input', inputClassName)} {...input} />
    </FieldFrame>
  );
}

export type TextAreaFieldProps = FieldShell & Omit<ComponentProps<'textarea'>, 'className'> & { mono?: boolean };

export function TextAreaField({ label, hint, className, mono, id: givenId, rows = 4, ...input }: TextAreaFieldProps) {
  const auto = useId(), id = givenId ?? auto, hintId = `${id}-hint`;
  return (
    <FieldFrame id={id} label={label} hint={hint} hintId={hintId} className={className}>
      <textarea id={id} rows={rows} aria-describedby={hint ? hintId : undefined} className={cn(mono && 'mono-input')} {...input} />
    </FieldFrame>
  );
}

/** Passwords stay pasteable and work with password managers; the reveal button names what it reveals. */
export function PasswordField({ label, hint, className, id: givenId, ...input }: FieldShell & Omit<ComponentProps<'input'>, 'className' | 'type'> & { label: string }) {
  const auto = useId(), id = givenId ?? auto, hintId = `${id}-hint`;
  const [shown, setShown] = useState(false);
  return (
    <FieldFrame id={id} label={label} hint={hint} hintId={hintId} className={className}>
      <div className="password">
        <input id={id} type={shown ? 'text' : 'password'} aria-describedby={hint ? hintId : undefined} {...input} />
        <Button variant="quiet" size="sm" className="reveal" aria-label={`${shown ? '隐藏' : '显示'}${label}`} onClick={() => setShown(value => !value)}>{shown ? '隐藏' : '显示'}</Button>
      </div>
    </FieldFrame>
  );
}

export type SelectOption = { value: string; label: string };

export function SelectField({ label, hint, className, options, id: givenId, ...select }: FieldShell & Omit<ComponentProps<'select'>, 'className'> & { options: SelectOption[] }) {
  const auto = useId(), id = givenId ?? auto, hintId = `${id}-hint`;
  return (
    <FieldFrame id={id} label={label} hint={hint} hintId={hintId} className={className}>
      <div className="select">
        <select id={id} aria-describedby={hint ? hintId : undefined} {...select}>
          {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <Icon name="chevron-down" />
      </div>
    </FieldFrame>
  );
}

export function Switch({ checked, onCheckedChange, disabled, ...props }: { checked: boolean; onCheckedChange: (checked: boolean) => void; disabled?: boolean } & Pick<ComponentProps<'button'>, 'aria-labelledby' | 'aria-describedby' | 'aria-label' | 'id'>) {
  return (
    <SwitchPrimitive.Root className="switch" checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} {...props}>
      <SwitchPrimitive.Thumb className="switch-thumb" />
    </SwitchPrimitive.Root>
  );
}

export function SwitchRow({ label, description, checked, onCheckedChange, disabled }: { label: ReactNode; description?: ReactNode; checked: boolean; onCheckedChange: (checked: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="switch-row">
      <div className="switch-text">
        <span id={`${id}-l`} className="switch-label">{label}</span>
        {description && <span id={`${id}-d`} className="switch-desc">{description}</span>}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} aria-labelledby={`${id}-l`} aria-describedby={description ? `${id}-d` : undefined} />
    </div>
  );
}

/** Filters only what is already loaded on the page; the label says so. `/` focuses it (see useFindShortcut). */
export function Find({ value, onChange, label = '在本页查找', placeholder = '在本页查找' }: { value: string; onChange: (value: string) => void; label?: string; placeholder?: string }) {
  return (
    <label className="find">
      <Icon name="search" />
      <span className="sr-only">{label}</span>
      <input className="find-input" type="search" data-find="" value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} />
    </label>
  );
}

/** A form whose submit handler always receives control; native validation runs first. */
export function Form({ onSubmit, children, actions, className, ...props }: Omit<ComponentProps<'form'>, 'onSubmit'> & { onSubmit: (event: FormEvent<HTMLFormElement>) => void; actions?: ReactNode }) {
  return (
    <form className={cn('form', className)} onSubmit={event => { event.preventDefault(); onSubmit(event); }} {...props}>
      {children}
      {actions && <div className="form-actions">{actions}</div>}
    </form>
  );
}
