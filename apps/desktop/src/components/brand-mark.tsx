import source from "../../../../brand/incoming/sources/logo-mark.svg?raw";
import { parseLogoMark } from "@/brand/logo-mark";

const mark = parseLogoMark(source);

/** The logo mark from brand/incoming/sources/logo-mark.svg, coloured by `currentColor`. */
export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox={mark.viewBox}
      fill="currentColor"
      className={className}
      // A checked-in file, checked by parseLogoMark to hold shapes only.
      dangerouslySetInnerHTML={{ __html: mark.body }}
    />
  );
}
