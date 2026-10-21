import {calculateProgress,createFundingController} from './restart-progress.mjs';
const $=id=>document.getElementById(id);
const bar=$('restart-progress');
const refresh=$('restart-refresh');
const status=$('restart-data-status');
let lastAttempt=0;
let expiryTimer;
function render({snapshot,busy,error}){
  clearTimeout(expiryTimer);
  refresh.disabled=busy;
  const age=snapshot?Date.now()-Date.parse(snapshot.timestamp):Infinity;
  const fresh=Number.isFinite(age) && age>=-30000 && age<=120000;
  // The reader accepts age <= 120s; expire at the first stale millisecond.
  if(fresh)expiryTimer=setTimeout(()=>render(controller.model),120001-age);
  bar.hidden=!snapshot || Boolean(error) || !fresh;
  $('restart-funding').setAttribute('aria-busy',String(busy));
  if(snapshot){
    const p=calculateProgress(snapshot);
    $('restart-current').textContent=p.currentXTZ+' XTZ';
    $('restart-goal').textContent=p.goalXTZ+' XTZ';
    $('restart-remaining').textContent=p.remainingXTZ+' XTZ remaining';
    $('restart-percent').textContent=p.percent+'%';
    $('restart-breakdown').textContent=p.liquidXTZ+' spendable + '+p.stakedXTZ+' own staked XTZ';
    $('restart-updated').textContent=(error||!fresh?'Last verified: ':'Block time: ')+new Date(snapshot.timestamp).toISOString().replace('T',' ').replace('.000Z',' UTC').replace('Z',' UTC');
    bar.value=p.basisPoints;
    bar.setAttribute('aria-valuetext',p.currentXTZ+' XTZ of '+p.goalXTZ+' XTZ funding target');
  }
  if(error){
    if(!snapshot)$('restart-current').textContent='Unavailable';
    status.textContent=error+(snapshot?' Last verified figures remain above; progress is hidden until refreshed.':' Please try Refresh.');
  }else if(snapshot && !fresh){status.textContent='Public funding data is stale. Last verified figures remain above; progress is hidden until refreshed.';}
  else if(busy){status.textContent='Checking TzKT’s public mainnet RPC…';}
  else{status.textContent='Verified read-only public mainnet data. Refreshes every minute while this page is visible.';}
}
const controller=createFundingController({onChange:render});
function update(){lastAttempt=Date.now();return controller.refresh();}
refresh.addEventListener('click',update);
setInterval(()=>{if(!document.hidden)update();},60000);
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden){
    render(controller.model);
    if(Date.now()-lastAttempt>=60000)update();
  }
});
render(controller.model);
update();
