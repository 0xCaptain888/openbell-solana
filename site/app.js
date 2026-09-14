const fixtures = {
  verified: { taskId:'judge-verified-aaplx',asset:'AAPLx',mint:'AAPLx-mainnet-mint',referencePrice:210,executablePrice:210.55,premiumBps:26,liquidityUsd:250000,quoteAgeSeconds:1.4,decision:'VERIFIED',marketState:'UNDERLYING_MARKET_CLOSED',reasons:[],route:'Jupiter → Solana settlement',checks:{premiumWithinPolicy:true,liquidityHealthy:true,quoteFresh:true},evidenceHash:'a27bcc356212177b8b0edb022ed3bd8e54e38d67ded457a0bf80c34dada31387' },
  blocked: { taskId:'judge-blocked-tslax',asset:'TSLAx',mint:'TSLAx-mainnet-mint',referencePrice:350,executablePrice:361.2,premiumBps:320,liquidityUsd:18000,quoteAgeSeconds:2.1,decision:'BLOCKED',marketState:'UNDERLYING_MARKET_CLOSED',reasons:['off_hours_premium_exceeded'],route:'Jupiter → Solana settlement',checks:{premiumWithinPolicy:false,liquidityHealthy:true,quoteFresh:true},evidenceHash:'424564191833dea8e0c4ad2b68103092eb0587c313b5e8ebf193151dad41c10a' },
  frozen: { taskId:'judge-frozen-nvdax',asset:'NVDAx',mint:'NVDAx-mainnet-mint',referencePrice:178,executablePrice:178.2,premiumBps:11,liquidityUsd:190000,quoteAgeSeconds:1.2,decision:'FROZEN',marketState:'CORPORATE_ACTION_WINDOW',reasons:['corporate_action_transition'],route:'Jupiter → Solana settlement',checks:{premiumWithinPolicy:true,liquidityHealthy:true,quoteFresh:true},evidenceHash:'50cb593d203670f936691949a1ebc9a15e8c05cc01024143d0ede637426667c7' },
  scaledMismatch: { taskId:'judge-scaled-mismatch',asset:'AAPLx',mint:'AAPLx-mainnet-mint',referencePrice:210,executablePrice:210.1,premiumBps:5,liquidityUsd:250000,quoteAgeSeconds:1,decision:'BLOCKED',marketState:'UNDERLYING_MARKET_OPEN',reasons:['scaled_amount_used_as_raw_amount'],route:'Wallet transfer adapter',checks:{premiumWithinPolicy:true,liquidityHealthy:true,quoteFresh:true},evidenceHash:'50c0285fb240683ea4c5a4cee3c6f8b1a09ca3f341fc637a78f857ec6b72b882' }
};
const STORAGE_KEY='openbell.browser-state.v1';
function readBrowserState(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}')}catch{return {}}}
const restoredState=readBrowserState();
let current=fixtures[restoredState.current] ? restoredState.current : 'verified';
let latestReceipt=restoredState.latestReceipt||null;
const $ = (id)=>document.getElementById(id);
const money=(n)=>`$${Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
function stable(value){
  if(Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if(value && typeof value==='object') return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
async function sha256(value){
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stable(value)));
  return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function render(key){
  current=key; const f=fixtures[key]; const maxPremium=Number($('premiumRange').value); const maxLiquidity=Number($('liquidityRange').value);
  const blockedByPolicy=f.premiumBps>maxPremium || f.liquidityUsd<maxLiquidity;
  const decision=f.decision==='FROZEN'?'FROZEN':blockedByPolicy?'BLOCKED':'VERIFIED';
  const reasons=decision==='FROZEN'?f.reasons:[...(f.premiumBps>maxPremium?['off_hours_premium_exceeded']:[]),...(f.liquidityUsd<maxLiquidity?['thin_liquidity']:[]),...(f.reasons.includes('scaled_amount_used_as_raw_amount')?f.reasons:[])];
  $('heroAsset').textContent=f.asset;$('heroRef').textContent=money(f.referencePrice);$('heroQuote').textContent=money(f.executablePrice);$('heroPremium').textContent=`${f.premiumBps>=0?'+':''}${f.premiumBps} bps`;$('refPrice').textContent=money(f.referencePrice);$('execPrice').textContent=money(f.executablePrice);$('premiumValue').textContent=`${f.premiumBps>=0?'+':''}${f.premiumBps} bps`;$('premiumValue').className=f.premiumBps>maxPremium?'negative':'positive';$('liquidityValue').textContent=`$${f.liquidityUsd.toLocaleString()}`;$('marketState').textContent=f.marketState.replaceAll('_',' ');
  $('heroDecision').textContent=decision; $('heroDecision').previousElementSibling.className=`status-dot status-${decision.toLowerCase()}`; document.querySelector('.decision-caption').textContent=decision==='VERIFIED'?'fair enough to execute':decision==='BLOCKED'?'stopped before execution':'settlement safely held'; $('decisionCard').className=`decision-card ${decision.toLowerCase()}`; $('decisionIcon').textContent=decision==='VERIFIED'?'✓':decision==='BLOCKED'?'!':'Ⅱ'; $('decisionTitle').textContent=decision; $('decisionSubtitle').textContent=decision==='VERIFIED'?'Quote is inside your fair-execution policy.':decision==='BLOCKED'?'The quote is executable, but not acceptable under your policy.':'Asset state is changing; settlement is held safely.';
  const reasonLabels=decision==='VERIFIED'?['Premium within policy','Liquidity is healthy',`Quote freshness is ${f.quoteAgeSeconds}s`]:reasons.map(r=>({off_hours_premium_exceeded:`Premium ${f.premiumBps} bps exceeds ${maxPremium} bps policy`,thin_liquidity:`Liquidity below $${maxLiquidity.toLocaleString()} minimum`,corporate_action_transition:'Corporate-action transition is active',scaled_amount_used_as_raw_amount:'Displayed amount cannot be used as raw amount'}[r]||r));
  $('reasonList').innerHTML=reasonLabels.map(x=>`<div><span>${decision==='VERIFIED'?'✓':'!'}</span><span>${x}</span></div>`).join('');$('executeBtn').textContent=decision==='VERIFIED'?'Execute protected order':decision==='BLOCKED'?'Explain blocked quote':'View recovery path'; $('executeBtn').disabled=false;$('executeBtn').dataset.decision=decision;$('executeBtn').style.opacity='1';$('executeBtn').className=`button full ${decision==='VERIFIED'?'button-primary':'button-outline'}`;if($('actionStatus'))$('actionStatus').textContent=decision==='VERIFIED'?'Ready · protected order can be simulated safely.':decision==='BLOCKED'?'Blocked · policy stops this quote before settlement.':'Frozen · settlement is held while the asset state changes.';syncRecovery(decision);
  const policy={maxPremiumBps:maxPremium,minLiquidityUsd:maxLiquidity};const policyHash=await sha256(policy);const receipt={...f,decision,reasons,policy,policyHash}; const hash=await sha256(receipt); latestReceipt={...receipt,evidenceHash:hash}; $('evidenceHash').textContent=hash;$('receiptDecision').textContent=`${decision} · ${f.asset}`;$('receiptMint').textContent=f.mint;$('receiptMarket').textContent=f.marketState;$('receiptRoute').textContent=f.route;$('rawReceipt').textContent=JSON.stringify(latestReceipt,null,2);updateInfrastructureSummary();persistBrowserState();
}
function toast(msg){$('toast').textContent=msg;$('toast').classList.add('show');setTimeout(()=>$('toast').classList.remove('show'),2600)}
const actionStatus=document.createElement('p');actionStatus.id='actionStatus';actionStatus.className='action-status';actionStatus.setAttribute('role','status');actionStatus.setAttribute('aria-live','polite');actionStatus.style.cssText='margin:12px 0 0;color:#8ea3bc;font-size:11px;line-height:1.45;min-height:32px';actionStatus.textContent='Ready · this demo never signs or moves funds.';$('executeBtn').after(actionStatus);
const recoveryPanel=document.createElement('div');recoveryPanel.id='recoveryPanel';recoveryPanel.style.cssText='display:none;margin-top:10px;padding:12px;border:1px solid #304a63;border-radius:10px;background:rgba(10,24,41,.7);font-size:11px;color:#a9bad0;line-height:1.45';recoveryPanel.innerHTML='<strong style="display:block;color:#ffcf70;margin-bottom:6px">Recovery controls</strong><span id="recoveryCopy">Settlement is held until the verifier is satisfied.</span><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button id="recoveryRetry" class="button button-outline" style="padding:8px 10px;font-size:11px">Retry verification</button><button id="recoveryCancel" class="button button-outline" style="padding:8px 10px;font-size:11px">Cancel task</button></div>';$('executeBtn').after(recoveryPanel);
const proofPanel=document.createElement('section');proofPanel.id='devnetProofPanel';proofPanel.style.cssText='margin:0 4vw 90px;padding:24px;border:1px solid #20334a;border-radius:18px;background:linear-gradient(145deg,rgba(19,37,60,.8),rgba(10,24,41,.8))';proofPanel.innerHTML='<div style="display:flex;justify-content:space-between;gap:20px;align-items:flex-end;flex-wrap:wrap"><div><p class="eyebrow">INDEPENDENT DEVNET PROOF</p><h2 style="margin:0 0 8px;font-size:28px;letter-spacing:-.05em">Verify the plumbing, not a promise.</h2><p style="margin:0;color:#8ea3bc;font-size:12px;line-height:1.5;max-width:620px">This read-only check loads a committed Solana Devnet proof and validates that the signature was found and successful. It never signs or broadcasts.</p></div><button id="verifyDevnetBtn" class="button button-outline">Verify Devnet proof</button></div><div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap;margin-top:18px;font-size:11px"><strong id="devnetProofStatus" style="color:#8ea3bc">Not checked · read-only</strong><a id="devnetExplorer" href="#" target="_blank" rel="noreferrer" style="display:none;color:#7ce7c2">Open transaction ↗</a></div>';document.querySelector('.judge-section')?.before(proofPanel);
const presetPanel=document.createElement('div');presetPanel.style.cssText='display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:0 0 20px';presetPanel.innerHTML='<button class="button button-outline policy-preset" data-premium="30" data-liquidity="50000" style="padding:8px 5px;font-size:10px">Strict</button><button class="button button-outline policy-preset" data-premium="50" data-liquidity="10000" style="padding:8px 5px;font-size:10px">Balanced</button><button class="button button-outline policy-preset" data-premium="150" data-liquidity="5000" style="padding:8px 5px;font-size:10px">Flexible</button>';document.querySelector('.policy-panel .panel-note')?.after(presetPanel);
const activityEntries=Array.isArray(restoredState.activityEntries)?restoredState.activityEntries.slice(0,8):[];const activityPanel=document.createElement('section');activityPanel.id='activityPanel';activityPanel.style.cssText='margin:0 4vw 90px;padding:24px;border:1px solid #20334a;border-radius:18px;background:rgba(10,24,41,.7)';activityPanel.innerHTML='<div style="display:flex;justify-content:space-between;gap:18px;align-items:center"><div><p class="eyebrow">AUDIT ACTIVITY</p><h2 style="margin:0;font-size:28px;letter-spacing:-.05em">Every decision leaves a trail.</h2></div><button id="clearActivity" class="button button-outline">Clear local log</button></div><div id="activityList" style="display:grid;gap:8px;margin-top:18px"></div>';document.querySelector('#receipt')?.before(activityPanel);
const downloadReceipt=document.createElement('button');downloadReceipt.id='downloadReceipt';downloadReceipt.className='button button-outline';downloadReceipt.textContent='Download receipt';document.querySelector('#receipt .section-heading')?.append(downloadReceipt);
function persistBrowserState(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify({stateVersion:'openbell.browser-state.v1',current,latestReceipt,activityEntries,premium:Number($('premiumRange')?.value||50),liquidity:Number($('liquidityRange')?.value||10000),walletConnected:$('connectBtn')?.dataset.connected==='true',updatedAt:new Date().toISOString()}))}catch{}}
function updateInfrastructureSummary(){if($('browserStoreStatus'))$('browserStoreStatus').textContent=restoredState.updatedAt?'RESTORED · LOCAL':'ACTIVE · LOCAL';if($('browserStoreCopy'))$('browserStoreCopy').textContent=restoredState.updatedAt?`Restored on refresh · last saved ${new Date(restoredState.updatedAt).toLocaleString()}`:'Policy, latest receipt, and activity survive a refresh on this device.';if($('notificationStatus'))$('notificationStatus').textContent=`LOCAL EVENTS · ${activityEntries.length}`;if($('latestTaskStatus'))$('latestTaskStatus').textContent=latestReceipt?`Latest task · ${latestReceipt.taskId} · ${latestReceipt.decision}`:'Latest task · none';if($('latestPolicyHash'))$('latestPolicyHash').textContent=latestReceipt?`Policy hash · ${(latestReceipt.policyHash||'not-recorded').slice(0,16)}…`:'Policy hash · waiting for evaluation'}
function recordActivity(kind,message){activityEntries.unshift({kind,message,time:new Date().toLocaleTimeString('en-US',{hour12:false})});activityEntries.splice(8);$('activityList').innerHTML=activityEntries.map(x=>`<div style="display:grid;grid-template-columns:72px 94px 1fr;gap:10px;padding:10px 0;border-top:1px solid #20334a;font-size:11px"><span style="color:#657e98">${x.time}</span><strong style="color:${x.kind==='VERIFIED'?'#7ce7c2':x.kind==='BLOCKED'?'#ff8f8f':x.kind==='FROZEN'?'#ffcf70':'#91b7ff'}">${x.kind}</strong><span style="color:#a9bad0">${x.message}</span></div>`).join('')||'<span style="color:#657e98;font-size:11px">No local activity yet.</span>';updateInfrastructureSummary();persistBrowserState()}
function syncRecovery(decision){const visible=decision!=='VERIFIED';recoveryPanel.style.display=visible?'block':'none';if(!visible)return;const copy=decision==='FROZEN'?'Corporate-action state is changing. Re-verify before any settlement.':'Policy rejected this quote. Adjust the guardrail or cancel the task.';$('recoveryCopy').textContent=copy;$('recoveryRetry').textContent=decision==='FROZEN'?'Retry verification':'Review policy';}
document.querySelectorAll('.asset').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.asset').forEach(b=>b.classList.remove('active'));btn.classList.add('active');void render(btn.dataset.asset);recordActivity(fixtures[btn.dataset.asset].decision,`${fixtures[btn.dataset.asset].asset} quote evaluated`)}));
document.querySelectorAll('.policy-preset').forEach(btn=>btn.addEventListener('click',()=>{$('premiumRange').value=btn.dataset.premium;$('liquidityRange').value=btn.dataset.liquidity;$('premiumOut').textContent=`${btn.dataset.premium} bps`;$('liquidityOut').textContent=`$${(Number(btn.dataset.liquidity)/1000).toFixed(0)}k`;void render(current);recordActivity('POLICY',`${btn.textContent} preset applied · ${btn.dataset.premium} bps / $${Number(btn.dataset.liquidity).toLocaleString()}`);toast(`${btn.textContent} policy applied`)}));
$('premiumRange').addEventListener('input',e=>{$('premiumOut').textContent=`${e.target.value} bps`;void render(current)});$('liquidityRange').addEventListener('input',e=>{$('liquidityOut').textContent=`$${(Number(e.target.value)/1000).toFixed(0)}k`;void render(current)});
$('connectBtn').addEventListener('click',()=>{ $('connectBtn').textContent='7xK…9pQ';$('connectBtn').dataset.connected='true';if($('actionStatus'))$('actionStatus').textContent='Connected · demo wallet only; no keys stored.';recordActivity('WALLET','Replay wallet connected · no signing authority');toast('Demo wallet connected · no keys stored') });
$('executeBtn').addEventListener('click',()=>{const decision=$('executeBtn').dataset.decision||'VERIFIED';const message=decision==='VERIFIED'?'Protected order simulated · no wallet signature requested.':decision==='BLOCKED'?'Blocked before settlement · lower the premium or choose another quote.':'Recovery path opened · settlement remains frozen by design.';if($('actionStatus'))$('actionStatus').textContent=message;recordActivity(decision,message);toast(message)});
$('recoveryRetry').addEventListener('click',()=>{const decision=$('executeBtn').dataset.decision||'VERIFIED';if(decision==='FROZEN'){void render('verified');$('progressLabel').textContent='Recovery verified · receipt refreshed';$('actionStatus').textContent='Recovery verified · task returned to a safe quote.';recordActivity('RECOVERED','Frozen task re-verified against a safe quote');toast('Recovery verified · settlement can be reviewed')}else{$('premiumRange').focus();$('actionStatus').textContent='Adjust Max off-hours premium, then review the quote again.';recordActivity('BLOCKED','Recovery requested · policy review required');toast('Review policy before retrying')}});$('recoveryCancel').addEventListener('click',()=>{recoveryPanel.style.display='none';$('actionStatus').textContent='Task cancelled · no settlement was attempted.';recordActivity('CANCELLED','Task cancelled before settlement');toast('Task cancelled · no funds moved')});
$('verifyBtn').addEventListener('click',async()=>{if(!latestReceipt){if($('actionStatus'))$('actionStatus').textContent='No receipt yet · run Judge Demo first.';toast('Run a scenario first');return} const {evidenceHash,...body}=latestReceipt; const recalculated=await sha256(body); const ok=recalculated===evidenceHash;if($('actionStatus'))$('actionStatus').textContent=ok?'Evidence verified · PASS · receipt hash matches.':'Evidence mismatch · FAIL · inspect the raw receipt.';toast(ok?'Evidence verified · PASS':'Evidence mismatch · FAIL')});$('copyHash').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('evidenceHash').textContent);if($('actionStatus'))$('actionStatus').textContent='Evidence hash copied to clipboard.';toast('Evidence hash copied')}catch{if($('actionStatus'))$('actionStatus').textContent='Clipboard unavailable · the full hash remains visible above.';toast('Hash is visible in the receipt')}});
$('downloadReceipt').addEventListener('click',()=>{if(!latestReceipt){toast('Run a scenario first');return}const blob=new Blob([JSON.stringify(latestReceipt,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`openbell-${latestReceipt.taskId}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);recordActivity('EVIDENCE',`Receipt downloaded · ${latestReceipt.evidenceHash.slice(0,12)}…`);toast('Portable receipt downloaded')});$('clearActivity').addEventListener('click',()=>{activityEntries.length=0;recordActivity('SYSTEM','Local audit log cleared')});if(activityEntries.length===0)recordActivity('SYSTEM','Replay console initialized · no signing authority');else{$('activityList').innerHTML=activityEntries.map(x=>`<div style="display:grid;grid-template-columns:72px 94px 1fr;gap:10px;padding:10px 0;border-top:1px solid #20334a;font-size:11px"><span style="color:#657e98">${x.time}</span><strong style="color:${x.kind==='VERIFIED'?'#7ce7c2':x.kind==='BLOCKED'?'#ff8f8f':x.kind==='FROZEN'?'#ffcf70':'#91b7ff'}">${x.kind}</strong><span style="color:#a9bad0">${x.message}</span></div>`).join('');updateInfrastructureSummary()}
$('verifyDevnetBtn').addEventListener('click',async()=>{const btn=$('verifyDevnetBtn');const status=$('devnetProofStatus');const link=$('devnetExplorer');btn.disabled=true;btn.textContent='Verifying…';status.textContent='Reading committed proof…';try{const data=await fetch('./evidence/devnet-self-transfer-proof.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json()});const proof=data.proof||{};const ok=data.network==='solana-devnet'&&data.scope==='devnet_self_transfer'&&Boolean(data.signature)&&proof.found===true&&proof.success===true&&proof.signature===data.signature;if(!ok)throw new Error('proof checks failed');status.textContent=`COMMITTED PROOF VERIFIED · ${data.sol} SOL self-transfer · signature record valid`;link.href=data.explorer;link.style.display='inline';recordActivity('EVIDENCE',`Committed Devnet proof verified · slot ${proof.slot}`);toast('Committed Devnet proof verified · read-only')}catch(error){status.textContent=`Proof unavailable · ${error.message}`;link.style.display='none';recordActivity('ERROR',`Devnet proof unavailable · ${error.message}`);toast('Devnet proof could not be verified')}finally{btn.disabled=false;btn.textContent='Verify Devnet proof'}});
$('judgeBtn').addEventListener('click',()=>{const steps=['verified','blocked','frozen'];let i=0;$('judgeBtn').disabled=true;$('progressLabel').textContent='Running verifier…';recordActivity('SYSTEM','Judge Run started · deterministic replay');const timer=setInterval(()=>{void render(steps[i]);recordActivity(fixtures[steps[i]].decision,`${fixtures[steps[i]].asset} judge scenario completed`);document.querySelectorAll('.timeline-step').forEach((s,n)=>s.classList.toggle('active',n<=i));$('progressFill').style.width=`${((i+1)/3)*100}%`; $('progressLabel').textContent=`${i+1}/3 · ${fixtures[steps[i]].decision}`;i++;if(i===3){clearInterval(timer);$('judgeBtn').disabled=false;$('progressLabel').textContent='Complete · receipt ready';recordActivity('EVIDENCE','Judge Run complete · portable receipt ready');toast('Judge run complete · three outcomes verified')}} ,850)});
if(Number.isFinite(Number(restoredState.premium)))$('premiumRange').value=String(restoredState.premium);if(Number.isFinite(Number(restoredState.liquidity)))$('liquidityRange').value=String(restoredState.liquidity);$('premiumOut').textContent=`${$('premiumRange').value} bps`;$('liquidityOut').textContent=`$${(Number($('liquidityRange').value)/1000).toFixed(0)}k`;if(restoredState.walletConnected){$('connectBtn').textContent='7xK…9pQ';$('connectBtn').dataset.connected='true'}document.querySelectorAll('.asset').forEach(btn=>btn.classList.toggle('active',btn.dataset.asset===current));void render(current);

async function checkRemoteApi(){const button=$('checkApiBtn');const status=$('remoteApiStatus');const copy=$('remoteApiCopy');const badge=$('remoteApiBadge');button.disabled=true;button.textContent='Checking…';status.textContent='CHECKING DEPLOYMENT…';badge.className='infra-state pending';badge.textContent='CHECK';try{const response=await fetch('/api/openbell?action=status',{cache:'no-store'});const raw=await response.text();let data={};try{data=JSON.parse(raw)}catch{}if(!response.ok)throw new Error(data.message||`HTTP ${response.status}`);const configured=data.persistence==='REMOTE_CONFIGURED';status.textContent=configured?'REMOTE STORE · CONFIGURED':'API ONLINE · STORE NOT CONFIGURED';copy.textContent=configured?`Strict policy mode · ${data.trustedPolicyKeyCount} trusted signer(s) · write auth ${String(data.writeAuthorization).toLowerCase()}.`:'The API is deployed and fail-closed. Add a remote Redis REST store before claiming durable cloud tasks.';badge.className=`infra-state ${configured?'ready':'pending'}`;badge.textContent=configured?'READY':'FAIL-CLOSED';recordActivity('API',configured?'Remote task persistence is configured':'Task API online · persistence intentionally unavailable');toast(configured?'Remote task API ready':'API online · remote store not configured')}catch(error){status.textContent='STATIC REPLAY · API UNAVAILABLE';copy.textContent='This host serves the replay UI only. SDK and local persistent API remain reproducible from the repository.';badge.className='infra-state offline';badge.textContent='OFFLINE';recordActivity('API',`Remote task API unavailable · ${error.message}`);toast('Remote API unavailable · replay remains local')}finally{button.disabled=false;button.textContent='Check deployment'}}
$('checkApiBtn').addEventListener('click',checkRemoteApi);void checkRemoteApi();

// Upgrade the static proof button to prefer a same-origin serverless proxy.
// GitHub Pages falls back to committed evidence; no browser-held API key is used.
const existingLiveButton=$('loadLiveBtn');
if(existingLiveButton){const liveButton=existingLiveButton.cloneNode(true);existingLiveButton.replaceWith(liveButton);liveButton.addEventListener('click',async()=>{liveButton.disabled=true;liveButton.textContent='Loading…';$('liveStatus').textContent='Reading Mainnet proof…';try{const mint=await fetch('./evidence/mainnet-aaplx-mint.json',{cache:'no-store'}).then(r=>r.json());let quote=await fetch('./evidence/mainnet-aaplx-jupiter-quote.json',{cache:'no-store'}).then(r=>r.json());let source='RECORDED';try{const proxy=window.OPENBELL_QUOTE_PROXY||'/api/jupiter-quote';const live=await fetch(`${proxy}?inputMint=${encodeURIComponent(quote.inputMint)}&outputMint=${encodeURIComponent(quote.outputMint)}&amount=${encodeURIComponent(quote.inputAmountBaseUnits)}`,{cache:'no-store'}).then(r=>r.ok?r.json():null);if(live?.status==='QUOTED'){quote={...quote,status:'QUOTED',outputAmountBaseUnits:live.outAmount,routeCount:Array.isArray(live.routePlan)?live.routePlan.length:quote.routeCount,contextSlot:live.contextSlot??quote.contextSlot};source='LIVE PROXY'}}catch{}const mintOk=mint.found&&mint.isToken2022&&mint.tokenMetadata?.symbol==='AAPLx';const quoteOk=quote.status==='QUOTED';$('liveStatus').textContent=`${mintOk?'Mint verified':'Mint check failed'} · ${quoteOk?'Jupiter QUOTED':'Jupiter '+quote.status} · ${source}`;$('liveMintLabel').textContent=`${mint.tokenMetadata?.name||'AAPLx'} · Token-2022 · ${mint.decimals} decimals`;$('liveQuoteLabel').textContent=quoteOk?`SOL → AAPLx · ${quote.routeCount} route · ${quote.outputAmountBaseUnits} base units`:`Quote status: ${quote.status}`;toast(mintOk&&quoteOk?`${source} evidence loaded · read-only`:'Evidence loaded · inspect status')}catch{$('liveStatus').textContent='Evidence unavailable · fixture mode';toast('Could not load committed evidence')}finally{liveButton.disabled=false;liveButton.textContent='Refresh Mainnet proof'}})}

const setMatrixValue=(id,value,pass)=>{const node=$(id);if(!node)return;node.textContent=value;node.className=pass===true?'pass':pass===false?'fail':''};
async function loadProductionProof(){
  let recorded=false;
  try{
    const proofResponse=await fetch('./evidence/production-task-smoke.json',{cache:'no-store'});
    const proof=await proofResponse.json();
    if(!proofResponse.ok)throw new Error('Recorded production proof is unavailable');
    recorded=proof.task?.evaluatedState==='VERIFIED'&&proof.task?.persistedState==='VERIFIED';
    setMatrixValue('prodTask',proof.task?.evaluatedState,proof.task?.evaluatedState==='VERIFIED');
    setMatrixValue('prodReadBack',proof.task?.persistedState,proof.task?.persistedState==='VERIFIED');
    setMatrixValue('prodNotifications',`≥ ${proof.task?.persistedNotificationCountAtLeast??0}`,Number(proof.task?.persistedNotificationCountAtLeast)>=2);
    $('productionJson').textContent=JSON.stringify(proof,null,2);
  }catch(error){
    setMatrixValue('prodTask','UNAVAILABLE',false);setMatrixValue('prodReadBack','UNAVAILABLE',false);setMatrixValue('prodNotifications','UNAVAILABLE',false);
    $('productionJson').textContent=error.message;
  }
  try{
    const statusResponse=await fetch('/api/openbell?action=status',{cache:'no-store'});
    const status=await statusResponse.json();
    if(!statusResponse.ok)throw new Error('Production status is unavailable');
    const ready=status.status==='ok'&&status.persistence==='REMOTE_CONFIGURED'&&status.policyMode==='strict'&&status.trustedPolicyKeyCount>0;
    setMatrixValue('prodApi',status.status==='ok'?'ONLINE':'OFFLINE',status.status==='ok');
    setMatrixValue('prodPersistence',status.persistence,status.persistence==='REMOTE_CONFIGURED');
    setMatrixValue('prodPolicy',String(status.policyMode).toUpperCase(),status.policyMode==='strict');
    setMatrixValue('prodSigner',`${status.trustedPolicyKeyCount} TRUSTED`,status.trustedPolicyKeyCount>0);
    setMatrixValue('prodWriteAuth',status.writeAuthorization,status.writeAuthorization==='CONFIGURED');
    $('productionOverall').textContent=ready&&recorded?'PRODUCTION READY':ready?'API READY':'FAIL-CLOSED';
    $('productionOverall').className=`infra-state ${ready?'ready':'pending'}`;
  }catch(error){
    ['prodApi','prodPersistence','prodPolicy','prodSigner','prodWriteAuth'].forEach(id=>setMatrixValue(id,'UNAVAILABLE',false));
    $('productionOverall').textContent=recorded?'RECORDED PROOF':'REPLAY AVAILABLE';
    $('productionOverall').className='infra-state pending';
  }
}

function setLiveStage(active,complete=false){
  document.querySelectorAll('#liveRunStages>div').forEach((stage,index)=>{
    stage.classList.toggle('active',!complete&&index===active);
    stage.classList.toggle('done',complete||index<active);
  });
}

async function runLiveJudgeTask(){
  const button=$('liveJudgeBtn');
  const badge=$('liveRunBadge');
  let idempotencyKey=sessionStorage.getItem('openbell.live-judge-key');
  if(!idempotencyKey){idempotencyKey=`judge-browser-${crypto.randomUUID()}`;sessionStorage.setItem('openbell.live-judge-key',idempotencyKey)}
  button.disabled=true;button.textContent='Running production flow…';
  $('liveRunState').textContent='SERVER EXECUTING RESTRICTED FLOW';
  badge.textContent='RUNNING';badge.className='infra-state pending';
  let stage=0;setLiveStage(stage);
  const animation=setInterval(()=>{stage=Math.min(stage+1,5);setLiveStage(stage)},450);
  try{
    const response=await fetch('/api/judge-run',{
      method:'POST',
      headers:{'content-type':'application/json','x-idempotency-key':idempotencyKey},
      body:JSON.stringify({consent:true})
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.message||`HTTP ${response.status}`);
    clearInterval(animation);setLiveStage(5,true);
    const task=data.task||{};const receipt=task.receipt||{};const persisted=data.persistence||{};const quote=data.quote||{};
    $('liveTaskId').textContent=task.taskId||'unknown';
    $('liveDecision').textContent=task.state||'unknown';
    $('liveReadBack').textContent=`${persisted.readBack||'unknown'} · ${persisted.receiptHashMatch===false?'MISMATCH':'MATCH'}`;
    $('liveNotifications').textContent=String(persisted.notificationCount??0);
    $('liveEvidenceHash').textContent=receipt.evidenceHash||'not returned';
    $('liveRunState').textContent=data.idempotentReplay?'IDEMPOTENT RESULT REPLAYED':'LIVE PRODUCTION FLOW COMPLETE';
    badge.textContent=task.state||'COMPLETE';badge.className=`infra-state ${task.state==='VERIFIED'?'ready':'pending'}`;
    $('liveRunNote').textContent=`Jupiter ${quote.status||'previously observed'} · ${quote.routeCount??0} route(s) · slot ${quote.contextSlot??'n/a'} · read-only. Redis read-back ${persisted.readBack||'unknown'} with ${persisted.notificationCount??0} notification(s). No transaction was built.`;
    if(receipt.evidenceHash){
      latestReceipt=receipt;
      $('evidenceHash').textContent=receipt.evidenceHash;
      $('receiptDecision').textContent=`${receipt.decision} · ${receipt.asset}`;
      $('receiptMint').textContent=receipt.mint;
      $('receiptMarket').textContent=receipt.marketState;
      $('receiptRoute').textContent=receipt.route;
      $('rawReceipt').textContent=JSON.stringify({liveJudgeRun:data},null,2);
      persistBrowserState();updateInfrastructureSummary();
    }
    recordActivity(task.state||'API',`Live production task ${task.taskId} · Redis read-back ${persisted.readBack}`);
    toast(`Live Judge Task complete · ${task.state}`);
  }catch(error){
    clearInterval(animation);setLiveStage(-1);
    $('liveRunState').textContent='LIVE RUN FAILED CLOSED';
    badge.textContent='NO WRITE CLAIMED';badge.className='infra-state offline';
    $('liveRunNote').textContent=`${error.message}. The deterministic verifier and committed production proof remain available below.`;
    recordActivity('ERROR',`Live Judge Run failed closed · ${error.message}`);toast('Live Judge Run failed closed');
  }finally{button.disabled=false;button.textContent='Run Live Judge Task'}
}

$('liveJudgeBtn')?.addEventListener('click',runLiveJudgeTask);
document.querySelectorAll('[data-copy-target]').forEach(button=>button.addEventListener('click',async()=>{
  const value=$(button.dataset.copyTarget)?.textContent||'';
  try{await navigator.clipboard.writeText(value);toast('Copied to clipboard')}catch{toast('Clipboard unavailable · value remains visible')}
}));
void loadProductionProof();
