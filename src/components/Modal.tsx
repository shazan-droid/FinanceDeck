import type { ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  size?: 'md' | 'lg' | 'xl';
  children: ReactNode;
}

const SIZE_CLASSES: Record<'md' | 'lg' | 'xl', string> = {
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
};

export function Modal({ open, title, onClose, size = 'md', children }: ModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={`flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-[#2A2A2A] bg-[#121212] shadow-2xl sm:max-h-[90vh] sm:rounded-lg ${SIZE_CLASSES[size]}`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[#222222] px-4 py-3 sm:px-5 sm:py-4">
          <h3 className="pr-2 text-sm font-semibold text-white">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-[#8A8A8A] transition-colors hover:bg-[#222222] hover:text-white sm:min-h-[36px] sm:min-w-[36px]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="pb-safe flex-1 overflow-y-auto p-4 sm:p-5">{children}</div>
      </div>
    </div>
  );
}
