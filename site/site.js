'use strict';
const copy = document.querySelector('#copy-address');
const address = document.querySelector('#delegate-address');
const status = document.querySelector('#copy-status');
if (copy && address && status) {
  copy.addEventListener('click', async () => {
    try {
      if (!navigator.clipboard || !window.isSecureContext) {
        throw new Error('Clipboard is unavailable');
      }
      await navigator.clipboard.writeText(address.textContent.trim());
      status.textContent = 'Address copied. Verify it in your wallet before confirming.';
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(address);
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
      status.textContent = 'Copy is unavailable here. The address is selected for manual copying.';
    }
  });
}
