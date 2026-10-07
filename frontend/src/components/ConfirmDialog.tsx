import { useEffect, useId, useRef } from 'react';

/** In-app replacement for window.confirm. Focus starts on the safe
 * button, Escape/backdrop cancel (unless busy), and the backend's reason
 * for a failure is shown inside the dialog instead of closing it. */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel = 'رجوع',
  danger = false,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  const busyRef = useRef(busy);
  useEffect(() => {
    onCancelRef.current = onCancel;
    busyRef.current = busy;
  });

  useEffect(() => {
    if (!open) return;
    const returnFocus = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busyRef.current) onCancelRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      returnFocus?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={() => !busy && onCancel()}>
      <div
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={message ? `${id}-msg` : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={`${id}-title`}>{title}</h2>
        {message && (
          <p id={`${id}-msg`} style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--ink)' }}>
            {message}
          </p>
        )}
        {error && (
          <div role="alert" className="error-banner" style={{ marginTop: 14, marginBottom: 0 }}>
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'جاري التنفيذ...' : confirmLabel}
          </button>
          <button ref={cancelRef} type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
