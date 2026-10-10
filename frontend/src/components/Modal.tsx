import { useId, useRef, type ReactNode } from 'react';
import { useDialogFocus } from '../lib/useDialogFocus';

/** A dialog: labelled by its title, focus moves in and stays inside (Tab
 * cycles), Escape or a backdrop click closes it, and focus returns to
 * whatever opened it. */
export default function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const id = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogFocus(panelRef, { onClose });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={panelRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={`${id}-title`}>{title}</h2>
        {children}
      </div>
    </div>
  );
}
