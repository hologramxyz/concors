import { createContext, useContext } from "react";
import type { ColorTheme, ThemeCatalog } from "@concors/protocol";
interface ColorThemeContextValue {
  themes: readonly ColorTheme[];
  selected: ColorTheme;
  mode: "light" | "dark";
  catalog: ThemeCatalog | null;
  error: string | null;
  select(id: string): void;
  refresh(): void;
}
export const ColorThemeContext = createContext<ColorThemeContextValue | null>(null);
export function useColorThemes() {
  const value = useContext(ColorThemeContext);
  if (!value) throw new Error("Color themes need a provider");
  return value;
}
