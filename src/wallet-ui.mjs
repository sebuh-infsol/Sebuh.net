import {BAKER,buildDelegationRequest} from './delegation-core.mjs';
import {createController} from './delegation-controller.mjs';
const $=id=>document.getElementById(id);
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
function renderHeader(model={}) {
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
  if(fresh)headerExpiry=globalThis.setTimeout?.(()=>renderHeader(model),Math.max(1,state.observedAt+120001-Date.now()));
}
document.addEventListener?.('visibilitychange',()=>renderHeader(controller?.model));

function render(model={account:null,state:null,review:null,donationReview:null,busy:false,error:null,hash:null}) {
  renderHeader(model);
  const busy=model.busy || loading;
  const blocked=busy || Boolean(model.hash) || model.uncertain;
  connect.disabled=busy || Boolean(model.account);
  connect.textContent=busy && !model.account?'Waiting for wallet…':'Connect wallet';
  disconnect.hidden=!controller;disconnect.disabled=busy;
  refresh.hidden=!model.account;refresh.disabled=busy;
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
  if(model.hash)donationReason=reason;
  else if(model.uncertain)donationReason='Check your wallet and explorer before disconnecting and reconnecting. The previous request may have been submitted. No automatic retry.';
  donationStatus.textContent=model.error || (busy?working:donationReason);
}
async function act(fn) {
  try{await fn();}
  catch(e){status.textContent=donationStatus.textContent=e.message || 'Wallet action failed. Check your wallet before retrying.';}
}
async function connectWallet() {
  if(loading || controller?.model.busy || controller?.model.account)return;
  loading=true;render(controller?.model);
  try {
    if(!controller){const{makeClient}=await import('./octez-client.mjs');controller=createController({client:makeClient(),onChange:render});}
    consent.checked=false;donationConsent.checked=false;
    await controller.connect();
  } finally {loading=false;render(controller?.model);}
}
connect.addEventListener('click',()=>act(connectWallet));
disconnect.addEventListener('click',()=>act(async()=>{await controller.disconnect();consent.checked=false;donationConsent.checked=false;render(controller.model);}));
refresh.addEventListener('click',()=>act(async()=>{consent.checked=false;donationConsent.checked=false;await controller.refresh();}));
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
