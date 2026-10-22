import React, { forwardRef } from "react";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

/** A native button, including its actual DOM ref and event.currentTarget. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ type = "button", ...props }, ref) {
    return <button type={type} {...props} ref={ref} />;
  },
);

export type IconButtonProps = ButtonProps & { "aria-label": string };

/** Icon-only/responsively labelled actions must have an explicit name. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(props, ref) {
    return <Button {...props} ref={ref} />;
  },
);

/** A group of pressed buttons, not tabs or a radio group. */
export function SegmentedControl({
  className = "",
  ...props
}: Omit<React.HTMLAttributes<HTMLDivElement>, "role"> & {
  "aria-label": string;
}) {
  return (
    <div
      className={`layout-toggle ${className}`.trim()}
      role="group"
      {...props}
    />
  );
}
