import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error.message || 'An unexpected error occurred.' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('FinanceDesk ErrorBoundary:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[#0B0B0B] p-6 text-[#F2F2F2]">
          <div className="w-full max-w-md rounded-lg border border-[#2A2A2A] bg-[#121212] p-6">
            <h1 className="text-base font-semibold text-white">Application Error</h1>
            <p className="mt-2 text-sm text-[#A0A0A0]">
              Something went wrong while loading FinanceDesk.
            </p>
            <p className="font-mono-nums mt-3 rounded bg-[#0B0B0B] p-3 text-xs text-red-400">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 rounded-md bg-[#C1121F] px-4 py-2 text-xs font-semibold text-white hover:bg-[#D91A28]"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
