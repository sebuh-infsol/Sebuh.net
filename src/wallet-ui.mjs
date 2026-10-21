import {BAKER,buildDelegationRequest} from './delegation-core.mjs';
import {createController} from './delegation-controller.mjs';
const $=id=>document.getElementById(id);
let controller;
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

function render(model={account:null,state:null,review:null,busy:false,error:null,hash:null}) {
  connect.disabled=model.busy || Boolean(model.account);
  connect.textContent=model.busy && !model.account?'Waiting for wallet…':'Connect wallet';
  disconnect.hidden=!controller;disconnect.disabled=model.busy;
  refresh.hidden=!model.account;refresh.disabled=model.busy;
  consent.disabled=model.busy || !model.account;
  let reason='Connect your wallet to read its mainnet delegation and staking state.';
  let eligible=false;
  if(model.account && model.state) {
    try {buildDelegationRequest({account:model.account,state:model.state,acknowledged:true,reviewed:true});eligible=true;reason='Ready to review an ordinary delegation. No delegation payouts.';}
    catch(e){reason=e.message;}
  }
  review.disabled=!eligible || !consent.checked || model.busy || Boolean(model.hash) || model.uncertain;
  panel.hidden=!model.review;
  confirm.disabled=!model.review || !consent.checked || model.busy;
  cancel.disabled=model.busy;
  $('wallet-account').textContent=model.account?.address || 'Not connected';
  $('wallet-delegate').textContent=model.state?(model.state.delegate || 'No delegate'):'Not checked';
  $('wallet-baker-status').textContent=model.state ? (model.state.bakerDeactivated ? 'Baker inactive / restart in progress. Delegation does not make the baker eligible or active.':'Delegate marked active by the public mainnet RPC. This is not an uptime or rewards guarantee.') : 'The baker is restarting. No rewards or rights are promised.';
  if(model.review) {
    $('review-source').textContent=model.review.source;
    $('review-previous').textContent=model.review.previousDelegate || 'None';
    $('review-target').textContent=BAKER;
  }
  hashLink.hidden=!model.hash;
  if(model.hash) {
    hashLink.href='https://tzkt.io/'+model.hash;
    hashLink.textContent='View the wallet-submitted operation on TzKT';
    reason='The wallet returned an operation hash. Inclusion/success is not yet verified by this page. Review it in your wallet or explorer.';
  }
  status.textContent=model.error || (model.busy ? 'Working… Signing happens only if you explicitly request wallet approval.' : reason);
}
async function act(fn) {
  try{await fn();}
  catch(e){status.textContent=e.message || 'Wallet action failed. Check your wallet before retrying.';}
}
connect.addEventListener('click',()=>act(async()=>{
  if(connect.disabled)return;
  connect.disabled=true;status.textContent='Loading Octez Connect…';
  try {
    if(!controller){const{makeClient}=await import('./octez-client.mjs');controller=createController({client:makeClient(),onChange:render});}
    consent.checked=false;
    await controller.connect();
  } finally {if(!controller)connect.disabled=false;}
}));
disconnect.addEventListener('click',()=>act(async()=>{await controller.disconnect();consent.checked=false;render(controller.model);}));
refresh.addEventListener('click',()=>act(async()=>{consent.checked=false;await controller.refresh();}));
consent.addEventListener('change',()=>{if(controller){controller.cancelReview();render(controller.model);}});
review.addEventListener('click',()=>act(()=>controller.review(consent.checked)));
cancel.addEventListener('click',()=>controller.cancelReview());
confirm.addEventListener('click',()=>act(()=>controller.submit(consent.checked)));
render();
