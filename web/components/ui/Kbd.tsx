/** Keyboard key rendering for the controls list (DESIGN §6.3). */
export function Kbd({ children }: { children: string }) {
  return (
    <kbd className="label-mono-sm inline-flex items-center rounded-[8px] border border-hairline bg-surface-sunk px-2 py-1 font-mono text-ink">
      {children}
    </kbd>
  );
}
