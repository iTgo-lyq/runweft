import type { ComponentProps, ReactNode } from 'react';
import { Icon, type IconName } from '../icons';
import { cn } from '../lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'quiet' | 'link' | 'danger';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

export type ButtonProps = Omit<ComponentProps<'button'>, 'children'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  /** Icon-only buttons still need a name; `label` becomes the accessible name and tooltip. */
  iconOnly?: boolean;
  label?: string;
  children?: ReactNode;
};

export function Button({ variant = 'secondary', size, icon, iconOnly = false, label, children, className, type = 'button', title, ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn('btn', className)}
      data-variant={variant}
      data-size={size && size !== 'md' ? size : undefined}
      data-icon-only={iconOnly ? 'true' : undefined}
      aria-label={iconOnly ? label : props['aria-label']}
      title={iconOnly ? title ?? label : title}
      {...props}
    >
      {icon && <Icon name={icon} />}
      {!iconOnly && <span className="btn-label">{children ?? label}</span>}
    </button>
  );
}
