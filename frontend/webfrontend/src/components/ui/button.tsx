import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[1.2rem] text-sm font-semibold cursor-pointer transition duration-200 ease-out focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-zinc-900 text-zinc-100 shadow-[0_18px_55px_-30px_rgba(0,0,0,0.75)] ring-1 ring-white/10 hover:bg-zinc-800 hover:shadow-[0_22px_70px_-40px_rgba(0,0,0,0.8)]",
        destructive:
          "bg-red-700 text-white shadow-[0_12px_34px_-24px_rgba(255,0,0,0.65)] hover:bg-red-600",
        outline:
          "border border-white/15 bg-black/30 text-zinc-100 shadow-[inset_0_1px_1px_rgba(255,255,255,0.08)] hover:bg-white/5",
        secondary:
          "bg-zinc-800 text-zinc-100 shadow-[0_10px_30px_-20px_rgba(0,0,0,0.6)] hover:bg-zinc-700",
        ghost: "bg-transparent text-zinc-100 hover:bg-white/5 hover:text-white",
        link: "text-zinc-100 underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-5 py-2.5",
        sm: "h-9 rounded-lg px-4 text-xs",
        lg: "h-12 rounded-[1.5rem] px-8",
        icon: "h-11 w-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
