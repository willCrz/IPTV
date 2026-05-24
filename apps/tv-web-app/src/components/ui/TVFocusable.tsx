'use client';
import type { ReactNode, MouseEventHandler } from 'react';
interface Props { children: ReactNode; className?: string; onClick?: MouseEventHandler<HTMLButtonElement>; disabled?: boolean; tabIndex?: number; focusId?: string; row?: number; col?: number; asInput?: boolean; preferFocus?: boolean; }
export function TVFocusable({ children, className, onClick, disabled, tabIndex = 0, asInput }: Props) {
  if (asInput) return <span>{children}</span>;
  return <button type="button" onClick={onClick} disabled={disabled} tabIndex={tabIndex} className={className}>{children}</button>;
}
