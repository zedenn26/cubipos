import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { twMerge } from "tailwind-merge";
const variants = cva(
  "btn inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium min-h-11 px-4 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2",
  {
    variants: {
      variant: {
        default: "btn-primary bg-[var(--green)] text-white",
        outline: "btn-outline border border-[var(--line)] bg-white",
        destructive: "btn-destructive bg-red-700 text-white",
      },
    },
    defaultVariants: { variant: "default" },
  },
);
export function Button({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof variants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp className={twMerge(variants({ variant }), className)} {...props} />
  );
}
