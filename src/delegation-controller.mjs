import {BAKER,readAccountState,buildDelegationRequest} from './delegation-core.mjs';
import {buildDonationRequest,parseDonationAmount} from './donation-core.mjs';

export function createController({client,loadState=readAccountState,onChange=()=>{}}) {
  const model={account:null,state:null,review:null,donationReview:null,busy:false,hash:null,error:null,uncertain:false};
  const emit=()=>onChange(model);
  let donationBinding=null;
  const clearReviews=()=>{model.review=null;model.donationReview=null;donationBinding=null;};
  function account(a) {
    if (a?.network?.chainId !== 'tezos:NetXdQprcVkpaWU') throw new Error('Wallet chain mismatch. Reconnect explicitly to Mainnet.');
    if(!a || a.network?.type!=='mainnet' || !Array.isArray(a.scopes) || a.scopes.length!==1 || a.scopes[0]!=='operation_request') throw new Error('Connect a mainnet wallet with operation permission only, not raw signing permission.');
    return {address:a.address,network:{type:a.network.type},scopes:[...a.scopes]};
  }
  function same(a,b) {
    if(!a || !b || a.address!==b.address || a.network.type!==b.network.type) throw new Error('Wallet account changed. Disconnect, reconnect and review again.');
  }
  function sameDonationAccount(a,b) {
    same(a,b);
    if(JSON.stringify([...a.scopes].sort())!==JSON.stringify([...b.scopes].sort())) throw new Error('Wallet permissions changed. Reconnect and review again.');
  }
  async function run(work) {
    if(model.busy) throw new Error('A wallet action is already pending.');
    model.busy=true;model.error=null;emit();
    try{return await work();}
    catch(e){model.error=e.message;clearReviews();throw e;}
    finally{model.busy=false;emit();}
  }
  return {
    get model(){return model;},
    connect:()=>run(async()=>{
      clearReviews();
      await client.requestPermissions({scopes:['operation_request'],networks:[{chainId:'tezos:NetXdQprcVkpaWU'}]});
      model.account=account(await client.getActiveAccount());
      model.state=await loadState(model.account.address);
      same(model.account,account(await client.getActiveAccount()));
      model.review=null;model.hash=null;model.uncertain=false;
    }),
    refresh:()=>run(async()=>{
      clearReviews();
      const active=account(await client.getActiveAccount());same(model.account,active);
      model.state=await loadState(active.address);model.review=null;
    }),
    review:(acknowledged)=>{
      if(model.busy || model.uncertain || model.hash) throw new Error('Resolve the pending wallet operation before another request.');
      buildDelegationRequest({account:model.account,state:model.state,acknowledged,reviewed:true});
      model.donationReview=null;donationBinding=null;
      model.review={source:model.account.address,delegate:BAKER,previousDelegate:model.state.delegate,createdAt:Date.now()};
      model.error=null;emit();
    },
    cancelReview:()=>{clearReviews();emit();},
    cancelDonationReview:()=>{model.donationReview=null;donationBinding=null;emit();},
    reviewDonation:(amountXTZ,acknowledged)=>{
      if(model.busy || model.uncertain || model.hash) throw new Error('Resolve the pending wallet operation before another request.');
      buildDonationRequest({account:model.account,state:model.state,amountXTZ,acknowledged,reviewed:true});
      model.review=null;
      const amountMutez=parseDonationAmount(amountXTZ);
      const whole=BigInt(amountMutez)/1000000n;
      const fraction=(BigInt(amountMutez)%1000000n).toString().padStart(6,'0').replace(/0+$/,'');
      model.donationReview={source:model.account.address,destination:BAKER,amountXTZ:whole.toString()+(fraction?'.'+fraction:''),amountMutez,createdAt:Date.now()};
      donationBinding={...model.donationReview};
      model.error=null;emit();
    },
    submitDonation:(acknowledged)=>run(async()=>{
      if(!model.donationReview || model.uncertain || model.hash) throw new Error('Review a fresh donation before requesting wallet approval.');
      const expected=model.donationReview;
      const binding=donationBinding;
      const active=account(await client.getActiveAccount());sameDonationAccount(model.account,active);
      const fresh=await loadState(active.address);
      sameDonationAccount(active,account(await client.getActiveAccount()));
      model.state=fresh;
      // Everything below is synchronous up to the one deliberate wallet request.
      // Neither a delayed account read nor a mutated/cancelled review may bypass it.
      const request=buildDonationRequest({account:active,state:fresh,amountXTZ:expected.amountXTZ,acknowledged,reviewed:true});
      if(model.donationReview!==expected || !binding ||
        Object.keys(binding).some(key=>expected[key]!==binding[key]) ||
        active.address!==binding.source || binding.destination!==BAKER ||
        parseDonationAmount(binding.amountXTZ)!==binding.amountMutez ||
        !Number.isFinite(binding.createdAt) || Date.now()-binding.createdAt>120000 ||
        binding.createdAt>Date.now() || model.uncertain || model.hash
      ) throw new Error('Review a fresh donation before requesting wallet approval.');
      try {
        const response=await client.requestOperation(request);
        if(typeof response?.transactionHash!=='string' || !/^o[1-9A-HJ-NP-Za-km-z]{50}$/.test(response.transactionHash)) throw new Error('No usable operation hash');
        model.hash=response.transactionHash;clearReviews();
      } catch {
        model.uncertain=true;
        throw new Error('Wallet request was declined or its outcome is unknown. Check your wallet and explorer before reconnecting or trying again. No automatic retry will occur.');
      }
    }),
    submit:(acknowledged)=>run(async()=>{
      if(!model.review || model.uncertain || model.hash || Date.now()-model.review.createdAt>120000) throw new Error('Review a fresh delegation before requesting wallet approval.');
      const expected=model.review;
      const active=account(await client.getActiveAccount());same(model.account,active);
      if(active.address!==expected.source) throw new Error('Reviewed account changed.');
      const fresh=await loadState(active.address);
      if(fresh.delegate!==expected.previousDelegate) throw new Error('Your current delegate changed. Refresh and review again.');
      buildDelegationRequest({account:active,state:fresh,acknowledged,reviewed:true});
      same(active,account(await client.getActiveAccount()));
      model.state=fresh;
      // The final account read can outlive the snapshot or invalidate the review.
      const request=buildDelegationRequest({account:active,state:fresh,acknowledged,reviewed:true});
      if(model.review!==expected || model.uncertain || model.hash || Date.now()-expected.createdAt>120000) throw new Error('Review a fresh delegation before requesting wallet approval.');
      try {
        // One deliberate wallet request. NEVER automatically retry this call.
        const response=await client.requestOperation(request);
        if(typeof response.transactionHash!=='string' || !/^o[1-9A-HJ-NP-Za-km-z]{50}$/.test(response.transactionHash)) throw new Error('No usable operation hash');
        model.hash=response.transactionHash;model.review=null;
      } catch {
        model.uncertain=true;
        throw new Error('Wallet request was declined or its outcome is unknown. Check your wallet and explorer before reconnecting or trying again. No automatic retry will occur.');
      }
    }),
    disconnect:()=>run(async()=>{
      clearReviews();
      await client.disconnect();
      model.account=null;model.state=null;model.review=null;model.hash=null;model.uncertain=false;
    })
  };
}
