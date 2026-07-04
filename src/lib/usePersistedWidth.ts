import { usePersistedSize } from "./usePersistedSize";

/**
 * A pixel width persisted to localStorage and clamped to [min, max]. Used for
 * the resizable sidebar / detail panels so widths survive reloads. Thin alias of
 * the generic {@link usePersistedSize} (heights use the same primitive).
 */
export const usePersistedWidth = usePersistedSize;
