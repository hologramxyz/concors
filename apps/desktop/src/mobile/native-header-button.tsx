import { useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { NativeIcon } from "@concors/client-core";
import { useNativeSurface } from "@/components/native-surface";

export function NativeHeaderButton({
  icon,
  nativeTitle,
  subtitle,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: NativeIcon;
  nativeTitle?: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const native = useNativeSurface(
    ref,
    {
      kind: "button",
      icon,
      label: props["aria-label"] ?? nativeTitle ?? "",
      title: nativeTitle ?? "",
      subtitle,
      disabled: !!props.disabled,
    },
    (event) => {
      if (event.kind === "press" && event.control === "activate" && !props.disabled)
        ref.current?.click();
    },
  );
  return (
    <button
      {...props}
      ref={ref}
      data-native-surface={native || undefined}
      aria-hidden={native || undefined}
      tabIndex={native ? -1 : props.tabIndex}
    >
      {children}
    </button>
  );
}
