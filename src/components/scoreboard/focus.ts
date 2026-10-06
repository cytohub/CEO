/**
 * For dialogs opened from a dropdown menu: on close, send focus back to the
 * menu trigger (the menu item that launched the dialog no longer exists).
 * Use as `<DialogContent onCloseAutoFocus={returnFocus(triggerRef)}>`.
 */
export function returnFocus(ref?: React.RefObject<HTMLElement | null>) {
  return (e: Event) => {
    if (!ref?.current?.isConnected) return;
    e.preventDefault();
    ref.current.focus();
  };
}
