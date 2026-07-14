/**
 * useFormValidation — Accessible form validation with real-time feedback
 * 
 * Provides:
 * - Real-time field validation
 * - Accessible error announcements
 * - Form-level error summary
 * - Success/error state management
 * - WCAG-compliant error handling
 */
import { useCallback, useMemo, useState } from "react";

export type ValidationRule<T> = {
  test: (value: T) => boolean;
  message: string;
};

export type FieldValidation<T> = {
  value: T;
  error: string | null;
  touched: boolean;
  valid: boolean;
};

export type FormValidation<T extends Record<string, any>> = {
  [K in keyof T]: FieldValidation<T[K]>;
};

export interface UseFormValidationOptions<T> {
  initialValues: T;
  validations: Partial<Record<keyof T, ValidationRule<T[keyof T]>[]>>;
  onSubmit?: (values: T) => void | Promise<void>;
  onError?: (errors: Partial<Record<keyof T, string>>) => void;
}

export function useFormValidation<T extends Record<string, any>>({
  initialValues,
  validations,
  onSubmit,
  onError,
}: UseFormValidationOptions<T>) {
  const [values, setValues] = useState<T>(initialValues);
  const [fieldStates, setFieldStates] = useState<FormValidation<T>>(
    Object.fromEntries(
      Object.keys(initialValues).map((key) => [
        key,
        { value: initialValues[key as keyof T], error: null, touched: false, valid: true },
      ])
    ) as FormValidation<T>
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const validateField = useCallback(
    (key: keyof T, value: T[keyof T]) => {
      const rules = validations[key];
      if (!rules) return null;

      for (const rule of rules) {
        if (!rule.test(value)) {
          return rule.message;
        }
      }
      return null;
    },
    [validations]
  );

  const handleFieldChange = useCallback(
    (key: keyof T, value: T[keyof T]) => {
      setValues((prev) => ({ ...prev, [key]: value }));

      setFieldStates((prev) => {
        const error = validateField(key, value);
        return {
          ...prev,
          [key]: {
            value,
            error,
            touched: true,
            valid: !error,
          },
        };
      });
    },
    [validateField]
  );

  const handleFieldBlur = useCallback(
    (key: keyof T) => {
      setFieldStates((prev) => {
        const value = values[key];
        const error = validateField(key, value);
        return {
          ...prev,
          [key]: {
            ...prev[key],
            error,
            touched: true,
            valid: !error,
          },
        };
      });
    },
    [values, validateField]
  );

  const handleFocus = useCallback((key: keyof T) => {
    setFieldStates((prev) => ({
      ...prev,
      [key]: { ...prev[key], touched: false },
    }));
  }, []);

  const isFormValid = useMemo(() => {
    return Object.values(fieldStates).every((field) => !field.error || !field.touched);
  }, [fieldStates]);

  const errors = useMemo(() => {
    const errorMap: Partial<Record<keyof T, string>> = {};
    Object.entries(fieldStates).forEach(([key, field]) => {
      if (field.error && field.touched) {
        errorMap[key as keyof T] = field.error;
      }
    });
    return errorMap;
  }, [fieldStates]);

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      if (e) e.preventDefault();

      // Touch all fields for validation
      const allTouched = Object.fromEntries(
        Object.keys(fieldStates).map((key) => {
          const k = key as keyof T;
          const error = validateField(k, values[k]);
          return [
            key,
            {
              ...fieldStates[k],
              error,
              touched: true,
              valid: !error,
            },
          ];
        })
      ) as FormValidation<T>;

      setFieldStates(allTouched);

      const hasErrors = Object.values(allTouched).some((field) => field.error && field.touched);

      if (hasErrors) {
        setSubmitError("Please fix the errors in the form");
        setSubmitSuccess(false);
        onError?.(Object.fromEntries(
          Object.entries(allTouched)
            .filter(([, field]) => field.error && field.touched)
            .map(([key, field]) => [key, field.error!])
        ));
        return;
      }

      setIsSubmitting(true);
      setSubmitError(null);

      try {
        if (onSubmit) {
          await onSubmit(values);
          setSubmitSuccess(true);
        }
      } catch (error) {
        setSubmitError(error instanceof Error ? error.message : "Submission failed");
        setSubmitSuccess(false);
      } finally {
        setIsSubmitting(false);
      }
    },
    [fieldStates, values, onSubmit, onError, validateField]
  );

  const resetForm = useCallback(() => {
    setValues(initialValues);
    setFieldStates(
      Object.fromEntries(
        Object.keys(initialValues).map((key) => [
          key,
          {
            value: initialValues[key as keyof T],
            error: null,
            touched: false,
            valid: true,
          },
        ])
      ) as FormValidation<T>
    );
    setSubmitError(null);
    setSubmitSuccess(false);
    setIsSubmitting(false);
  }, [initialValues]);

  return {
    values,
    fieldStates,
    errors,
    isFormValid,
    isSubmitting,
    submitError,
    submitSuccess,
    handleFieldChange,
    handleFieldBlur,
    handleFocus,
    handleSubmit,
    resetForm,
  };
}

// ── Common Validation Rules ──────────────────────────────────────────────────

export const validationRules = {
  required: (message = "This field is required"): ValidationRule<string> => ({
    test: (value) => value !== "" && value !== null && value !== undefined,
    message,
  }),
  email: (message = "Please enter a valid email address"): ValidationRule<string> => ({
    test: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    message,
  }),
  min: (min: number, message?: string): ValidationRule<string | number> => ({
    test: (value) => {
      if (typeof value === "number") return value >= min;
      return value.length >= min;
    },
    message:
      message || `Must be at least ${min} characters/number`,
  }),
  max: (max: number, message?: string): ValidationRule<string | number> => ({
    test: (value) => {
      if (typeof value === "number") return value <= max;
      return value.length <= max;
    },
    message: message || `Must be at most ${max} characters/number`,
  }),
  minLength: (min: number, message?: string): ValidationRule<string> => ({
    test: (value) => value.length >= min,
    message: message || `Must be at least ${min} characters`,
  }),
  maxLength: (max: number, message?: string): ValidationRule<string> => ({
    test: (value) => value.length <= max,
    message: message || `Must be at most ${max} characters`,
  }),
  pattern: (
    pattern: RegExp,
    message: string
  ): ValidationRule<string> => ({
    test: (value) => pattern.test(value),
    message,
  }),
  minAmount: (min: number, message = "Amount must be at least this value"): ValidationRule<number> => ({
    test: (value) => value >= min,
    message,
  }),
  phone: (message = "Please enter a valid phone number"): ValidationRule<string> => ({
    test: (value) => /^(\+234|0)[7-9]\d{9}$/.test(value.trim()),
    message,
  }),
  nin: (message = "Please enter a valid NIN"): ValidationRule<string> => ({
    test: (value) => /^\d{11}$/.test(value.trim()),
    message,
  }),
  bvn: (message = "Please enter a valid BVN"): ValidationRule<string> => ({
    test: (value) => /^\d{11}$/.test(value.trim()),
    message,
  }),
};
