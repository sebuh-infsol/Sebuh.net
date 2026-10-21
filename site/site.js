'use strict';
function bindAddressCopy(buttonId,addressId,statusId) {
  const copy=document.querySelector('#'+buttonId);
  const address=document.querySelector('#'+addressId);
  const status=document.querySelector('#'+statusId);
  if(!copy || !address || !status)return;
  copy.addEventListener('click',async()=>{
    try {
      if(!navigator.clipboard || !window.isSecureContext)throw new Error('Clipboard is unavailable');
      await navigator.clipboard.writeText(address.textContent.trim());
      status.textContent='Address copied. Verify it in your wallet before confirming.';
    } catch {
      const selection=window.getSelection();
      const range=document.createRange();
      range.selectNodeContents(address);
      if(selection){selection.removeAllRanges();selection.addRange(range);}
      status.textContent='Copy is unavailable here. The address is selected for manual copying.';
    }
  });
}
bindAddressCopy('copy-address','delegate-address','copy-status');
bindAddressCopy('copy-donation-address','donation-address','donation-copy-status');
