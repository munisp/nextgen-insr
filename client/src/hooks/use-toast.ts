import { toast as sonnerToast } from "sonner";

export interface ToastOptions {
  title?: string;
  description?: string;
  variant?: "default" | "destructive";
  [key: string]: unknown;
}

export function useToast() {
  return {
    toast: ({ title, description, variant, ...rest }: ToastOptions) => {
      const fn = variant === "destructive" ? sonnerToast.error : sonnerToast;
      return fn(title ?? "", { description, ...rest });
    },
    dismiss: sonnerToast.dismiss,
    toasts: [] as unknown[],
  };
}

export { sonnerToast as toast };
