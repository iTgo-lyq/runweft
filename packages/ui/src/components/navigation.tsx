import type { ReactNode } from 'react';
import { RadioGroup, Tabs as TabsPrimitive } from 'radix-ui';
import { Icon, type IconName } from '../icons';
import { cn } from '../lib/cn';

export type ChoiceOption<T extends string = string> = { value: T; label: ReactNode; icon?: IconName; disabled?: boolean };

/** Single choice with arrow-key movement; arrows move and select, as in a native radio group. */
export function Segmented<T extends string>({ label, options, value, onValueChange, stacked = false, className }: {
  label: string; options: ChoiceOption<T>[]; value: T; onValueChange: (value: T) => void; stacked?: boolean; className?: string;
}) {
  return (
    <RadioGroup.Root className={cn('segmented', stacked && 'stacked', className)} aria-label={label} value={value} onValueChange={next => onValueChange(next as T)} loop orientation={stacked ? 'vertical' : 'horizontal'}>
      {options.map(option => (
        <RadioGroup.Item key={option.value} value={option.value} disabled={option.disabled}>
          {option.icon && <Icon name={option.icon} />}<span>{option.label}</span>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}

/** Filter chips: the same radio semantics, styled as pills that scroll sideways on narrow screens. */
export function Chips<T extends string>({ label, options, value, onValueChange }: { label: string; options: ChoiceOption<T>[]; value: T; onValueChange: (value: T) => void }) {
  return (
    <RadioGroup.Root className="chips" aria-label={label} value={value} onValueChange={next => onValueChange(next as T)} loop orientation="horizontal">
      {options.map(option => <RadioGroup.Item key={option.value} value={option.value} disabled={option.disabled}>{option.label}</RadioGroup.Item>)}
    </RadioGroup.Root>
  );
}

export type TabItem<T extends string = string> = { id: T; label: ReactNode };

/** Tabs that render only the active panel; arrow keys switch tabs. */
export function Tabs<T extends string>({ label, items, value, onValueChange, children }: { label: string; items: TabItem<T>[]; value: T; onValueChange: (value: T) => void; children: ReactNode }) {
  return (
    <TabsPrimitive.Root className="tabs-root" value={value} onValueChange={next => onValueChange(next as T)} activationMode="automatic">
      <TabsPrimitive.List className="tabs" aria-label={label} loop>
        {items.map(item => <TabsPrimitive.Trigger key={item.id} value={item.id}>{item.label}</TabsPrimitive.Trigger>)}
      </TabsPrimitive.List>
      <TabsPrimitive.Content value={value} className="tabpanel" forceMount>{children}</TabsPrimitive.Content>
    </TabsPrimitive.Root>
  );
}
