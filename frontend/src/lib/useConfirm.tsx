import { useState, type ReactNode } from 'react';
import ConfirmDialog from '../components/ConfirmDialog';
import { apiErrorMessage } from './api';

interface Request {
  title: string;
  message?: string;
  confirmLabel: string;
  danger?: boolean;
  /** Runs on confirm; if it throws, the backend's reason stays in the dialog. */
  action: () => Promise<unknown>;
}

/** `ask({...})` opens a confirmation; render `dialog` once in the page. */
export function useConfirm(): { ask: (req: Request) => void; dialog: ReactNode } {
  const [req, setReq] = useState<Request | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setReq(null);
    setError(null);
  }

  async function confirm() {
    if (!req) return;
    setBusy(true);
    setError(null);
    try {
      await req.action();
      close();
    } catch (err) {
      setError(apiErrorMessage(err, 'تعذر تنفيذ العملية، حاول تاني'));
    } finally {
      setBusy(false);
    }
  }

  return {
    ask: (r) => {
      setError(null);
      setReq(r);
    },
    dialog: (
      <ConfirmDialog
        open={req !== null}
        title={req?.title ?? ''}
        message={req?.message}
        confirmLabel={req?.confirmLabel ?? 'تأكيد'}
        danger={req?.danger}
        busy={busy}
        error={error}
        onConfirm={confirm}
        onCancel={close}
      />
    ),
  };
}
