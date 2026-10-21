import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const script=readFileSync(new URL('../site/site.js',import.meta.url),'utf8');
const recipient='tz1R664EP6wjcM1RSUVJ7nrJisTpBW9QyJzP';
function setup(denied=false){
  const nodes={},writes=[],selected=[];
  for(const [button,address,status] of [['copy-address','delegate-address','copy-status'],['copy-donation-address','donation-address','donation-copy-status']]){
    nodes['#'+button]={addEventListener:(event,handler)=>{nodes['#'+button].click=handler;}};
    nodes['#'+address]={textContent:recipient};nodes['#'+status]={textContent:''};
  }
  const context={document:{querySelector:s=>nodes[s],createRange:()=>({selectNodeContents:n=>selected.push(n)})},navigator:{clipboard:{writeText:async text=>{if(denied)throw new Error('denied fixture');writes.push(text);}}},window:{isSecureContext:true,getSelection:()=>({removeAllRanges(){},addRange(){}})}};
  vm.runInNewContext(script,context);
  return{nodes,writes,selected};
}
test('delegate and donation copy controls copy only the full recipient address',async()=>{
  const x=setup();
  for(const [button,status] of [['copy-address','copy-status'],['copy-donation-address','donation-copy-status']]){
    assert.equal(typeof x.nodes['#'+button].click,'function');
    await x.nodes['#'+button].click();
    assert.match(x.nodes['#'+status].textContent,/copied/);
  }
  assert.deepEqual(x.writes,[recipient,recipient]);
});
test('denied clipboard selects the corresponding address for manual copying',async()=>{
  const x=setup(true);
  for(const [button,address,status] of [['copy-address','delegate-address','copy-status'],['copy-donation-address','donation-address','donation-copy-status']]){
    assert.equal(typeof x.nodes['#'+button].click,'function');
    await x.nodes['#'+button].click();
    assert.equal(x.selected.at(-1),x.nodes['#'+address]);
    assert.match(x.nodes['#'+status].textContent,/manual copying/);
  }
  assert.equal(x.writes.length,0);
});
