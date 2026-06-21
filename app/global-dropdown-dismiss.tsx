"use client";

import { useEffect } from "react";

const dropdownSelector = "details.filter-dropdown";

export function GlobalDropdownDismiss() {
  useEffect(() => {
    function closeOpenDropdowns(except: Element | null = null) {
      document.querySelectorAll<HTMLDetailsElement>(`${dropdownSelector}[open]`).forEach((dropdown) => {
        if (dropdown !== except) dropdown.open = false;
      });
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      const activeDropdown = target instanceof Element ? target.closest(dropdownSelector) : null;
      closeOpenDropdowns(activeDropdown);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeOpenDropdowns();
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return null;
}
