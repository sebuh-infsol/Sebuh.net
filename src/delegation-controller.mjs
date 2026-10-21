import {BAKER,readAccountState,buildDelegationRequest} from './delegation-core.mjs';

export function createController({client,loadState=readAccountState,onChange=()=>{}}) {
  const model={account:null,state:null,review:null,busy:false,hash:null,error:null,uncertain:false};
  const emit=()=>onChange(model);
  function account(a) {
    if(!a || a.network?.type!=='mainnet' || !Array.isArray(a.scopes) || !a.scopes.includes('operation_request') || a.scopes.includes('sign')) throw new Error('Connect a mainnet wallet with operation permission only, not raw signing permission.');
    return {address:a.address,network:{type:a.network.type},scopes:[...a.scopes]};
  }
  function same(a,b) {
    if(!a || !b || a.address!==b.address || a.network.type!==b.network.type) throw new Error('Wallet account changed. Disconnect, reconnect and review again.');
  }
  async function run(work) {
    if(model.busy) throw new Error('A wallet action is already pending.');
    model.busy=true;model.error=null;emit();
    try{return await work();}
    catch(e){model.error=e.message;model.review=null;throw e;}
    finally{model.busy=false;emit();}
  }
  return {
    get model(){return model;},
    connect:()=>run(async()=>{
      await client.requestPermissions({scopes:['operation_request']});
      model.account=account(await client.getActiveAccount());
      model.state=await loadState(model.account.address);
      same(model.account,account(await client.getActiveAccount()));
      model.review=null;model.hash=null;model.uncertain=false;
    }),
    refresh:()=>run(async()=>{
      const active=account(await client.getActiveAccount());same(model.account,active);
      model.state=await loadState(active.address);model.review=null;
    }),
    review:(acknowledged)=>{
      if(model.busy || model.uncertain || model.hash) throw new Error('Resolve the pending wallet operation before another request.');
      buildDelegationRequest({account:model.account,state:model.state,acknowledged,reviewed:true});
      model.review={source:model.account.address,delegate:BAKER,previousDelegate:model.state.delegate,createdAt:Date.now()};
      model.error=null;emit();
    },
    cancelReview:()=>{model.review=null;emit();},
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
      await client.disconnect();
      model.account=null;model.state=null;model.review=null;model.hash=null;model.uncertain=false;
    })
  };
}
