/**
 * A contextual "PICK UP" prompt (spec section 34), shown only while
 * LooseBallRecovery.isRecoverable() is genuinely true this frame - never
 * displayed constantly, and never a promise the pickup will auto-succeed
 * on its own (the player still has to actually be there when the grab
 * window in LooseBallRecoverySystem.update() opens).
 */
export class PickupIndicator {
  private readonly el = document.getElementById('pickup-indicator') as HTMLDivElement;

  update(eligible: boolean): void {
    this.el.hidden = !eligible;
  }
}
