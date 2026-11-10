import React, { forwardRef, useId } from "react";
import { Button as BaseButton } from "@base-ui/react/button";
import { Tooltip } from "@base-ui/react/tooltip";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

/** Base UI behavior with a native button: refs, forms and currentTarget stay native. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ type = "button", ...props }, ref) {
    return <BaseButton type={type} {...props} ref={ref} />;
  },
);

export type IconButtonProps = ButtonProps & { "aria-label": string };

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(props, ref) {
    return <Button {...props} ref={ref} />;
  },
);

/** The accessible name remains available without hover, including while disabled. */
export function TooltipIconButton(props: IconButtonProps) {
  const id = useId();
  return <Tooltip.Root>
    <Tooltip.Trigger aria-describedby={id} render={<IconButton {...props} />} />
    <Tooltip.Portal>
      <Tooltip.Positioner side="bottom" sideOffset={6} collisionPadding={8} className="tooltip-positioner">
        <Tooltip.Popup id={id} role="tooltip" className="control-tooltip">{props["aria-label"]}</Tooltip.Popup>
      </Tooltip.Positioner>
    </Tooltip.Portal>
  </Tooltip.Root>;
}
