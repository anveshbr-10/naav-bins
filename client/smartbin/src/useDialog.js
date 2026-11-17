import { useEffect, useRef } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Accessible modal behaviour: moves focus into the dialog, keeps Tab inside it,
// closes on Escape (unless canClose is false) and returns focus to the opener afterwards.
export default function useDialog(onClose, canClose = true) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  const canCloseRef = useRef(canClose);
  useEffect(() => { closeRef.current = onClose; canCloseRef.current = canClose; });

  useEffect(() => {
    const opener = document.activeElement;
    const node = ref.current;
    const first = node?.querySelector(FOCUSABLE);
    (first || node)?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (canCloseRef.current) closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !node) return;
      const items = [...node.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) { e.preventDefault(); return; }
      const firstEl = items[0], lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      if (opener && typeof opener.focus === 'function') opener.focus();
    };
  }, []);

  return ref;
}
