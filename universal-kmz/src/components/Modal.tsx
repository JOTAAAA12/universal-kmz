import { useEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

interface ModalProps {
  onClose: () => void;
  titleId: string;
  backdropClassName: string;
  dialogClassName: string;
  children: ReactNode;
}

function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter(element => element.tabIndex >= 0 && !element.hasAttribute('disabled'));
}

export default function Modal({ onClose, titleId, backdropClassName, dialogClassName, children }: ModalProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previouslyFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog) return;

    (getFocusableElements(dialog)[0] || dialog).focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusableElements = getFocusableElements(dialog);
      const firstFocusableElement = focusableElements[0];
      const lastFocusableElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;

      if (!firstFocusableElement || !lastFocusableElement) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const focusIsOutsideDialog = !dialog.contains(activeElement) || activeElement === dialog;
      if (event.shiftKey && (activeElement === firstFocusableElement || focusIsOutsideDialog)) {
        event.preventDefault();
        lastFocusableElement.focus();
      } else if (!event.shiftKey && (activeElement === lastFocusableElement || focusIsOutsideDialog)) {
        event.preventDefault();
        firstFocusableElement.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocusedElement?.isConnected) previouslyFocusedElement.focus();
    };
  }, []);

  return (
    <div className={backdropClassName} onClick={(event) => event.target === event.currentTarget && onClose()}>
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={dialogClassName}
      >
        {children}
      </section>
    </div>
  );
}
