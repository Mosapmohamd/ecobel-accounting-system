import { createContext, useContext } from 'react';

export type ToastTone = 'success' | 'error';

export const ToastContext = createContext<((message: string, tone?: ToastTone) => void) | null>(null);

/** `toast(message)` — short, non-blocking confirmation (see components/Toast.tsx). */
export function useToast() {
  const show = useContext(ToastContext);
  if (!show) throw new Error('useToast must be used within ToastProvider');
  return show;
}
