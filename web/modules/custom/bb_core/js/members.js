/**
 * @file
 * Applies a Members write's outcome after the island swap.
 *
 * The server marks the rebuilt members form with `data-members-focus` (an
 * element id) and `data-members-announce` plus its priority; the swap replaced
 * whatever had focus, so this puts focus where the action left the user and
 * tells assistive technology what happened.
 */
((Drupal, once) => {
  const SELECTOR = 'form[data-members-focus]';

  Drupal.behaviors.bbMembersOutcome = {
    attach(context) {
      const forms = context.matches?.(SELECTOR) ? [context] : context.querySelectorAll?.(SELECTOR) ?? [];
      once('members-outcome', forms).forEach((form) => {
        const target = document.getElementById(form.dataset.membersFocus);
        if (target) {
          target.focus();
        }
        if (form.dataset.membersAnnounce) {
          Drupal.announce(form.dataset.membersAnnounce, form.dataset.membersAnnouncePriority || 'polite');
        }
      });
    },
  };

  // Escape on the in-place confirmation is its Cancel, a submit of the form.
  document.addEventListener('keydown', (event) => {
    const cancel = event.key === 'Escape' && document.querySelector('[data-members-confirm][open] [name^="cancel_remove_"]');
    if (cancel) {
      event.preventDefault();
      cancel.click();
    }
  });
})(Drupal, once);
