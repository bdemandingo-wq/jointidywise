import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { hapticImpact } from "@/lib/haptics";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold tracking-tight ring-offset-background transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-foreground text-background shadow-sm hover:bg-foreground/90",
        destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        outline: "border-[1.5px] border-foreground bg-transparent text-foreground hover:bg-foreground hover:text-background",
        secondary: "bg-secondary text-secondary-foreground border-[1.5px] border-border hover:bg-muted",
        ghost: "hover:bg-secondary hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        gradient: "bg-primary text-primary-foreground shadow-md hover:bg-primary/90",
        premium: "bg-primary text-primary-foreground shadow-md shadow-primary/30 hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/40",
      },
      size: {
        default: "h-11 md:h-10 px-4 py-2 text-sm",
        sm: "h-9 rounded-lg px-3 text-xs md:text-sm",
        lg: "h-12 md:h-12 rounded-xl px-6 md:px-8 text-base",
        xl: "h-14 md:h-14 rounded-xl px-8 md:px-10 text-base md:text-lg",
        icon: "h-11 w-11 md:h-10 md:w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, onClick, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    const primary = variant == null || variant === "default" || variant === "gradient" || variant === "premium";
    const handleClick = primary
      ? (event: React.MouseEvent<HTMLButtonElement>) => {
          hapticImpact("light");
          onClick?.(event);
        }
      : onClick;
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        onClick={handleClick}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
