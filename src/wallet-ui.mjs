import {BAKER,buildDelegationRequest} from './delegation-core.mjs';
import {createController} from './delegation-controller.mjs';
import {networkState} from './network-state.mjs';
const $=id=>document.getElementById(id);
const networkSelect=$('network-select');
let controller;
let loading=false;
const status=$('wallet-status');
const consent=$('delegation-consent');
const connect=$('wallet-connect');
const disconnect=$('wallet-disconnect');
const refresh=$('wallet-refresh');
const review=$('delegation-review');
const confirm=$('delegation-confirm');
const cancel=$('delegation-cancel');
const panel=$('delegation-summary');
const hashLink=$('wallet-operation');
const donationAmount=$('donation-amount');
const donationConsent=$('donation-consent');
const donationReview=$('donation-review');
const donationConfirm=$('donation-confirm');
const donationPanel=$('donation-summary');
const donationStatus=$('donation-status');
const donationHash=$('donation-operation');
const presets=[...document.querySelectorAll('[data-donation-amount]')];
let headerExpiry;
networkState.addGuard(() => controller?.model.uncertain ? 'wallet uncertain' : controller?.model.busy || controller?.model.hash ? 'wallet pending' : null);
networkState.onChange(() => {
  const old = controller; controller = null; loading = false;
  consent.checked = false; donationConsent.checked = false;
  networkSelect.value = networkState.selected().network;
  if (old) { try { old.disconnect().catch(() => {}); } catch {} }
  render();
});
function renderHeader(model={}) {
  if (!networkState.legacyAllowed()) {
    const selected = networkState.pairing()?.model?.();
    model = selected ? {...selected, state: selected.balanceState} : {};
  }
  globalThis.clearTimeout?.(headerExpiry);
  const details=$('wallet-header-details');
  const address=$('wallet-header-address');
  const balance=$('wallet-header-balance');
  details.hidden=!model.account;
  address.textContent='';address.title='';address.setAttribute('aria-label','');
  balance.textContent='';
  if(!model.account)return;
  const full=model.account.address;
  address.textContent=full.slice(0,6)+'…'+full.slice(-6);
  address.title=full;address.setAttribute('aria-label','Connected account '+full);
  balance.textContent='Available balance needs refresh';
  if(model.busy || loading){balance.textContent='Checking available balance…';return;}
  if(model.hash || model.uncertain){balance.textContent='Check wallet for updated balance';return;}
  const state=model.state;
  if(!state || state.address!==full || !Number.isFinite(state.observedAt) || state.observedAt>Date.now()+5000 || typeof state.balance!=='string' || !/^[0-9]{1,20}$/.test(state.balance))return;
  const mutez=BigInt(state.balance);
  const fraction=(mutez%1000000n).toString().padStart(6,'0').replace(/0+$/,'');
  const value=(mutez/1000000n).toString()+(fraction?'.'+fraction:'')+' XTZ';
  const fresh=!model.error && Date.now()-state.observedAt<=120000;
  balance.textContent=fresh?'Available: '+value:'Last checked: '+value+' — reload or Refresh account to update';
  balance.title='Spendable balance only, checked '+new Date(state.observedAt).toISOString()+'. Staked and frozen funds excluded. No automatic polling.';
  if(fresh)headerExpiry=globalThis.setTimeout?.(()=>renderHeader(controller?.model),Math.max(1,state.observedAt+120001-Date.now()));
}
document.addEventListener?.('visibilitychange',()=>renderHeader(controller?.model));
networkState.onSession(() => render(controller?.model));

function render(model={account:null,state:null,review:null,donationReview:null,busy:false,error:null,hash:null}) {
  renderHeader(model);
  const busy=model.busy || loading;
  // Legacy delegation/direct gifts are mainnet-only: fail closed elsewhere.
  const legacy=networkState.legacyAllowed();

  const blocked=busy || Boolean(model.hash) || model.uncertain || !legacy;
  const session = legacy ? model : (networkState.pairing()?.model?.() || {});
  const pairingBlocked = session.busy || session.hash || session.uncertain || loading;
  connect.disabled=pairingBlocked || Boolean(session.account) || (!legacy && !networkState.pairing());
  connect.textContent=(session.busy || loading) && !session.account?'Waiting for wallet…':session.account?'Connected':'Connect wallet';
  disconnect.hidden=legacy ? !controller : !session.account;disconnect.disabled=pairingBlocked;
  refresh.hidden=!session.account;refresh.disabled=pairingBlocked;
  consent.disabled=busy || !model.account;
  let reason='Connect your wallet to read its mainnet delegation and staking state.';
  let eligible=false;
  if(model.account && model.state) {
    try {buildDelegationRequest({account:model.account,state:model.state,acknowledged:true,reviewed:true});eligible=true;reason='Ready to review an ordinary delegation. No delegation payouts.';}
    catch(e){reason=e.message;}
  }
  review.disabled=!eligible || !consent.checked || blocked;
  panel.hidden=!model.review;
  confirm.disabled=!model.review || !consent.checked || blocked;
  cancel.disabled=busy;
  $('wallet-account').textContent=model.account?.address || 'Not connected';
  $('wallet-delegate').textContent=model.state?(model.state.delegate || 'No delegate'):'Not checked';
  $('wallet-baker-status').textContent=model.state ? (model.state.bakerDeactivated ? 'Baker inactive / restart in progress. Delegation does not make the baker eligible or active.':'Delegate marked active by the public mainnet RPC. This is not an uptime or rewards guarantee.') : 'The baker is restarting. No rewards or rights are promised.';
  if(model.review) {
    $('review-source').textContent=model.review.source;
    $('review-previous').textContent=model.review.previousDelegate || 'None';
    $('review-target').textContent=BAKER;
  }
  for(const link of [hashLink,donationHash]) {
    link.hidden=!model.hash;
    if(model.hash) {
      link.href='https://tzkt.io/'+model.hash;
      link.textContent='View the wallet-submitted operation on TzKT';
    }
  }
  if(model.hash) reason='The wallet returned an operation hash. Inclusion/success is not yet verified by this page. Review it in your wallet or explorer.';
  const working=loading?'Loading Octez Connect…':'Working… Signing happens only if you explicitly request wallet approval.';
  if(!legacy)reason='Mainnet delegation and direct gifts are disabled on '+networkState.selected().label+'. Select Mainnet to use them.';
  status.textContent=model.error || (busy ? working : reason);
  donationAmount.disabled=blocked;
  donationConsent.disabled=blocked || !model.account;
  donationReview.disabled=blocked || !model.account || !model.state || !donationConsent.checked || !donationAmount.value;
  donationPanel.hidden=!model.donationReview;
  donationConfirm.disabled=blocked || !model.donationReview || !donationConsent.checked;
  $('donation-cancel').disabled=busy;
  for(const preset of presets) {
    preset.disabled=blocked;
    preset.setAttribute('aria-pressed',String(donationAmount.value===preset.dataset.donationAmount));
  }
  if(model.donationReview) {
    $('donation-review-source').textContent=model.donationReview.source;
    $('donation-review-target').textContent=BAKER;
    $('donation-review-amount').textContent=model.donationReview.amountXTZ+' XTZ';
  }
  let donationReason=model.account?'Choose an amount, acknowledge the permanent gift and review. Nothing is sent until you request and approve it in your wallet.':'Choose an amount to connect your wallet. Connecting only pairs the wallet; it does not send a donation.';
  if(model.hash || !legacy)donationReason=reason;
  else if(model.uncertain)donationReason='Check your wallet and explorer before disconnecting and reconnecting. The previous request may have been submitted. No automatic retry.';
  donationStatus.textContent=model.error || (busy?working:donationReason);
}
async function act(fn) {
  const epoch = networkState.epoch();
  try{await fn();}
  catch(e){if (networkState.isCurrent(epoch)) status.textContent=donationStatus.textContent=e.message || 'Wallet action failed. Check your wallet before retrying.';}
}
async function connectWallet() {
  if (!networkState.legacyAllowed()) return networkState.pairing()?.connect();
  if(loading || controller?.model.busy || controller?.model.account || controller?.model.hash || controller?.model.uncertain || !networkState.legacyAllowed())return;
  const epoch=networkState.epoch();
  loading=true;render(controller?.model);
  try {
    if(!controller){const{makeClient}=await import('./octez-client.mjs');if(!networkState.isCurrent(epoch))return;controller=createController({client:makeClient(),onChange:(model)=>{if(networkState.isCurrent(epoch))render(model);}});}
    consent.checked=false;donationConsent.checked=false;
    await controller.connect();
  } catch (e) {
    const failed = controller;
    if (networkState.isCurrent(epoch) && failed) {
      try { await failed.disconnect(); } catch {}
      if (networkState.isCurrent(epoch) && controller === failed) controller = null;
    }
    throw e;
  } finally {if(networkState.isCurrent(epoch)){loading=false;render(controller?.model);}}
}
connect.addEventListener('click',()=>act(connectWallet));
// Selecting a network never pairs or signs. It refuses while a request is
// pending/uncertain, then drops the legacy session so reconnect is explicit.
networkSelect?.addEventListener('change',()=>act(async()=>{
  try{networkState.select(networkSelect.value);}
  catch(e){networkSelect.value=networkState.selected().network;throw e;}
  consent.checked=false;donationConsent.checked=false;

  render(controller?.model);
}));
disconnect.addEventListener('click',()=>act(async()=>{if (!networkState.legacyAllowed()) return networkState.pairing()?.disconnect(); const ctl=controller; const epoch=networkState.epoch(); if (!ctl || ctl.model.busy || ctl.model.hash || ctl.model.uncertain) return; await ctl.disconnect();if (!networkState.isCurrent(epoch) || controller!==ctl) return; consent.checked=false;donationConsent.checked=false;render(ctl.model);}));
refresh.addEventListener('click',()=>act(async()=>{if (!networkState.legacyAllowed()) return networkState.pairing()?.refresh(); if (!controller || controller.model.busy || controller.model.hash || controller.model.uncertain) return; consent.checked=false;donationConsent.checked=false;await controller.refresh();}));
consent.addEventListener('change',()=>{if(controller){controller.cancelReview();render(controller.model);}});
review.addEventListener('click',()=>act(()=>controller.review(consent.checked)));
cancel.addEventListener('click',()=>controller.cancelReview());
confirm.addEventListener('click',()=>act(()=>controller.submit(consent.checked)));
for(const preset of presets)preset.addEventListener('click',()=>act(async()=>{
  if(preset.disabled)return;
  donationAmount.value=preset.dataset.donationAmount;
  donationConsent.checked=false;
  controller?.cancelReview();
  render(controller?.model);
  if(!controller?.model.account)await connectWallet();
  donationAmount.focus();
}));
for(const [input,event] of [[donationAmount,'input'],[donationConsent,'change']])input.addEventListener(event,()=>{
  controller?.cancelReview();render(controller?.model);
});
donationReview.addEventListener('click',()=>act(()=>controller.reviewDonation(donationAmount.value,donationConsent.checked)));
$('donation-cancel').addEventListener('click',()=>controller.cancelReview());
donationConfirm.addEventListener('click',()=>act(()=>controller.submitDonation(donationConsent.checked)));
render();
