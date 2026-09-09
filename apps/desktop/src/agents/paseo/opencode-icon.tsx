// Adapted from getpaseo/paseo a7a708bec99e935ee4b8c6f7314a4b9a9984cfa6. Apache-2.0.
// Copyright (c) 2025-present Mohamed Boudra. See third-party/paseo-LICENSE.

interface OpenCodeIconProps {
  size?: number;
  color?: string;
  className?: string;
}

export function OpenCodeIcon({ size = 16, color = "currentColor", className }: OpenCodeIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="96 64 288 384"
      fill={color}
    >
      <path d="M320 224V352H192V224H320Z" opacity={0.4} />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M384 416H128V96H384V416ZM320 160H192V352H320V160Z"
      />
    </svg>
  );
}
