import { createContext, useContext } from "react";
export const TabVisibility = createContext(true);
export const useTabVisible = () => useContext(TabVisibility);
