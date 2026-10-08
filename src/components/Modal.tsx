import type { ReactNode } from 'react';
import { X } from 'lucide-react';

type ModalProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  closeDisabled?: boolean;
};

export default function Modal({
  title,
  onClose,
  children,
  className = '',
  closeDisabled = false,
}: ModalProps) {
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) =>
        event.target === event.currentTarget && !closeDisabled && onClose()
      }
    >
      <section
        className={`modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <button
            className="icon-btn"
            onClick={onClose}
            aria-label="Cerrar"
            disabled={closeDisabled}
          >
            <X size={19} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
