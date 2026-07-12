// Init Lucide icons
if(typeof lucide!=='undefined')lucide.createIcons();

// Copy to clipboard
function copyInstall(){
  navigator.clipboard.writeText('npm install gitmesh').then(function(){
    var btns=document.querySelectorAll('.btn-primary,.btn-dark');
    btns.forEach(function(btn){
      var orig=btn.innerHTML;
      btn.innerHTML='<i data-lucide="check" style="width:18px;height:18px"></i> Copied!';if(typeof lucide!=='undefined')lucide.createIcons();
      btn.style.background='#10b981';btn.style.color='#fff';
      setTimeout(function(){btn.innerHTML=orig;btn.style.background='';btn.style.color=''},2000);
    });
  });
}

// Nav scroll
;(function(){
  window.addEventListener('scroll',function(){
    document.getElementById('nav').classList.toggle('scrolled',window.scrollY>20);
  });
})();

// === GSAP ANIMATION: gitmesh workflow ===
;(function(){
  if(typeof gsap==='undefined')return;

  var orcLog=document.getElementById('orcLog');
  var orcHeadHash=document.getElementById('orcHeadHash');
  var orcMergeBadge=document.getElementById('orcMergeBadge');
  var orcDoneCheck=document.getElementById('orcDoneCheck');
  var conflictPopup=document.getElementById('conflictPopup');
  var agentA=document.getElementById('agentA');
  var agentB=document.getElementById('agentB');
  var agentC=document.getElementById('agentC');
  var bodyA=document.getElementById('agentABody');
  var bodyB=document.getElementById('agentBBody');
  var bodyC=document.getElementById('agentCBody');
  var statusA=document.getElementById('agentAStatus');
  var statusB=document.getElementById('agentBStatus');
  var statusC=document.getElementById('agentCStatus');

  // Helper: add log line to orchestrator
  function log(msg,cls){
    var line=document.createElement('div');
    line.className='orc-log-line '+(cls||'');
    var now=new Date();
    var ts=now.getHours()+':'+String(now.getMinutes()).padStart(2,'0')+':'+String(now.getSeconds()).padStart(2,'0');
    line.innerHTML='<span class="ts">'+ts+'</span><span class="msg">'+msg+'</span>';
    orcLog.appendChild(line);
    orcLog.scrollTop=orcLog.scrollHeight;
    return line;
  }

  // Helper: set agent status
  function agentStatus(el,text,iconCls,cls){
    el.innerHTML='<span class="status-icon '+iconCls+'"></span>'+text;
    el.className='agent-panel-status '+(cls||'');
  }

  // Helper: set agent body text
  function agentBody(el,lines){
    el.innerHTML=lines.map(function(l){
      return '<div class="agent-line '+l.cls+'">'+l.txt+'</div>';
    }).join('');
  }
  var tl=gsap.timeline({paused:true,repeat:-1,repeatDelay:6});

  var lineShared=document.getElementById('lineShared');
  var lineA=document.getElementById('lineA');
  var lineB=document.getElementById('lineB');
  var lineC=document.getElementById('lineC');
  var dotOrigin=document.getElementById('dotOrigin');
  var dotA=document.getElementById('dotA');
  var dotB=document.getElementById('dotB');
  var dotC=document.getElementById('dotC');
  var flowScene=document.getElementById('flowScene');

  // Position connector lines between orchestrator and agent panels
  var x2a,y2a,x2b,y2b,x2c,y2c;
  function updateLines(){
    if(!flowScene)return;
    var sceneRect=flowScene.getBoundingClientRect();
    var svg=document.getElementById('flowLines');
    svg.setAttribute('viewBox','0 0 '+sceneRect.width+' '+sceneRect.height);
    svg.setAttribute('width',sceneRect.width);
    svg.setAttribute('height',sceneRect.height);
    var orcRect=orcPanel.getBoundingClientRect();
    // All lines start from same point: right-center of orchestrator
    var x1=orcRect.right-sceneRect.left;
    var y1=orcRect.top-sceneRect.top+orcRect.height/2;
    dotOrigin.setAttribute('cx',x1);dotOrigin.setAttribute('cy',y1);
    // Each agent endpoint
    var agents=[agentA,agentB,agentC],agentLines=[lineA,lineB,lineC],agentDots=[dotA,dotB,dotC];
    agents.forEach(function(agent,i){
      var aRect=agent.getBoundingClientRect();
      var x2=aRect.left-sceneRect.left;
      var y2=aRect.top-sceneRect.top+aRect.height/2;
      // Shared horizontal segment from origin to midpoint, then agent-specific vertical+horizontal
      var mx=x1+(x2-x1)*0.45;
      if(i===0)lineShared.setAttribute('d','M'+x1+' '+y1+' L'+mx+' '+y1);
      agentLines[i].setAttribute('d','M'+mx+' '+y1+' L'+mx+' '+y2+' L'+x2+' '+y2);
      agentDots[i].setAttribute('cx',x2);agentDots[i].setAttribute('cy',y2);
    });
  }

  // === ACT 1: Initialization (0-6s) ===

  // Narration
  tl.call(function(){document.getElementById('narrationText').textContent='gitmesh 为每个 Agent 创建独立的 git worktree'},null,0.1);

  // Log lines
  tl.call(function(){log('gitmesh({ agents: [A, B, C] })','info');},null,0);
  tl.call(function(){log('validating git environment...','info');},null,0.8);

  // Position lines on enter
  tl.call(function(){updateLines();},null,0.1);

  // Activate agents + show connector lines
  tl.to([agentA,agentB,agentC],{opacity:1,duration:0.6,stagger:0.3},1.5);
  // Show lines & dots with staggered fade-in
  tl.to(dotOrigin,{opacity:1,duration:0.3},2.2);
  tl.to(lineShared,{opacity:1,duration:0.3},2.2);
  tl.to(lineA,{opacity:1,duration:0.5},2.4);
  tl.to(dotA,{opacity:1,duration:0.3},2.4);
  tl.to(lineB,{opacity:1,duration:0.5},2.8);
  tl.to(dotB,{opacity:1,duration:0.3},2.8);
  tl.to(lineC,{opacity:1,duration:0.5},3.2);
  tl.to(dotC,{opacity:1,duration:0.3},3.2);
  tl.call(function(){log('worktree:ready → Agent A','info');},null,2.4);
  tl.call(function(){log('worktree:ready → Agent B','info');},null,2.8);
  tl.call(function(){log('worktree:ready → Agent C','info');},null,3.2);
  tl.call(function(){
    agentStatus(statusA,'worktree ready','ready','');
    agentStatus(statusB,'worktree ready','ready','');
    agentStatus(statusC,'worktree ready','ready','');
  },null,2.4);

  tl.call(function(){log('onReady(signal) → Agent A / B / C','info');},null,4.0);

  // Show agent bodies with prompt
  tl.call(function(){
    agentBody(bodyA,[
      {txt:'⏺ I\'ll fix the OAuth token refresh logic.',cls:'prompt'},
      {txt:'',cls:'dim'},
      {txt:'',cls:'dim'},
      {txt:'',cls:'dim'},
    ]);
    agentBody(bodyB,[
      {txt:'⏺ I\'ll refactor the database migration layer.',cls:'prompt'},
      {txt:'',cls:'dim'},
      {txt:'',cls:'dim'},
      {txt:'',cls:'dim'},
    ]);
    agentBody(bodyC,[
      {txt:'⏺ I\'ll add unit tests for auth module.',cls:'prompt'},
      {txt:'',cls:'dim'},
      {txt:'',cls:'dim'},
      {txt:'',cls:'dim'},
    ]);
    agentStatus(statusA,'coding...','working','');
    agentStatus(statusB,'coding...','working','');
    agentStatus(statusC,'coding...','working','');
  },null,5.0);

  // === ACT 2: Agents Working (6-14s) ===

  tl.call(function(){document.getElementById('narrationText').textContent='Agent 在隔离的 worktree 中并行编码，互不干扰'},null,6.0);

  // Agent A: edit + commit
  tl.call(function(){
    agentBody(bodyA,[
      {txt:'⏺ I\'ll fix the OAuth token refresh logic.',cls:'dim'},
      {txt:'● Edit: src/auth.ts  +32 -8',cls:'cmd'},
      {txt:'● Bash: git add src/auth.ts && git commit',cls:'cmd'},
      {txt:'  [mesh/fix-auth a7d3f1e] fix: OAuth token',cls:'dim'},
    ]);
  },null,6.0);
  tl.call(function(){
    agentBody(bodyA,[
      {txt:'⏺ I\'ll fix the OAuth token refresh logic.',cls:'dim'},
      {txt:'● Edit: src/auth.ts  +32 -8',cls:'dim'},
      {txt:'● Bash: git add src/auth.ts && git commit',cls:'dim'},
      {txt:'  [mesh/fix-auth a7d3f1e] fix: OAuth token',cls:'dim'},
      {txt:'✓ signal.done()',cls:'done'},
    ]);
    agentStatus(statusA,'done','done','ok');
  },null,11.0);

  // Agent B: edit + commit
  tl.call(function(){
    agentBody(bodyB,[
      {txt:'⏺ I\'ll refactor the database migration layer.',cls:'dim'},
      {txt:'● Edit: src/db/migrate.ts  +45 -12',cls:'cmd'},
      {txt:'● Bash: git commit -m "refactor: db"',cls:'cmd'},
      {txt:'  [mesh/refactor-db b8e4f2d] refactor: db',cls:'dim'},
    ]);
  },null,7.0);
  tl.call(function(){
    agentBody(bodyB,[
      {txt:'⏺ I\'ll refactor the database migration layer.',cls:'dim'},
      {txt:'● Edit: src/db/migrate.ts  +45 -12',cls:'dim'},
      {txt:'● Bash: git commit -m "refactor: db"',cls:'dim'},
      {txt:'  [mesh/refactor-db b8e4f2d] refactor: db',cls:'dim'},
      {txt:'✓ signal.done()',cls:'done'},
    ]);
    agentStatus(statusB,'done','done','ok');
  },null,12.5);

  // Agent C: write test + commit
  tl.call(function(){
    agentBody(bodyC,[
      {txt:'⏺ I\'ll add unit tests for auth module.',cls:'dim'},
      {txt:'● Write: test/auth.test.ts  +120',cls:'cmd'},
      {txt:'● Bash: git add test/ && git commit',cls:'cmd'},
      {txt:'  [mesh/add-tests c9f5a3e] test: auth coverage',cls:'dim'},
    ]);
  },null,8.0);
  tl.call(function(){
    agentBody(bodyC,[
      {txt:'⏺ I\'ll add unit tests for auth module.',cls:'dim'},
      {txt:'● Write: test/auth.test.ts  +120',cls:'dim'},
      {txt:'● Bash: git add test/ && git commit',cls:'dim'},
      {txt:'  [mesh/add-tests c9f5a3e] test: auth coverage',cls:'dim'},
      {txt:'✓ signal.done()',cls:'done'},
    ]);
    agentStatus(statusC,'done','done','ok');
  },null,13.5);

  // === ACT 3: Merge Engine — Rebase (14-20s) ===

  tl.call(function(){document.getElementById('narrationText').textContent='merge engine 启动，逐个 rebase Agent 分支到主干 HEAD'},null,14.0);
  tl.call(function(){log('merge engine started','info');},null,14.0);
  tl.to(orcMergeBadge,{opacity:1,duration:0.4},14.0);

  // Agent A rebase success
  tl.call(function(){log('rebase mesh/fix-auth onto main HEAD','info');},null,14.6);
  tl.call(function(){agentStatus(statusA,'rebasing...','working','');},null,14.6);
  tl.call(function(){log('✓ rebase success → fast-forward merge','ok');},null,16.0);
  tl.to(lineA,{stroke:'#10b981',duration:0.5},16.0);
  tl.to(dotA,{fill:'#10b981',duration:0.5},16.0);
  tl.call(function(){agentStatus(statusA,'merged ✓','done','ok');orcHeadHash.textContent='d4e5f6a';},null,16.5);

  // Agent B rebase → CONFLICT
  tl.call(function(){log('rebase mesh/refactor-db onto main HEAD','info');},null,17.0);
  tl.call(function(){agentStatus(statusB,'rebasing...','working','');},null,17.0);
  tl.call(function(){document.getElementById('narrationText').textContent='检测到冲突 → 路由给 Agent B 自行解决'},null,18.0);
  tl.call(function(){log('✗ CONFLICT: src/auth.ts','err');},null,18.0);
  tl.call(function(){agentStatus(statusB,'conflict!','conflict','warn');},null,18.0);
  // Agent B line & dot turn red
  tl.to(lineB,{stroke:'#f43f5e',strokeWidth:2.5,duration:0.5},18.0);
  tl.to(dotB,{fill:'#f43f5e',duration:0.5},18.0);
  tl.to(conflictPopup,{opacity:1,duration:0.4},18.2);
  tl.call(function(){log('→ routing onConflict to Agent B','warn');},null,18.8);

  // === ACT 4: Conflict Resolution (20-28s) ===

  tl.call(function(){document.getElementById('narrationText').textContent='Agent B 查看冲突内容，编辑文件，git add → rebase --continue'},null,20.0);

  // Agent B resolves — 3 frames with longer pauses for reading
  tl.call(function(){
    agentBody(bodyB,[
      {txt:'⚠ CONFLICT received from gitmesh',cls:'conflict-marker'},
      {txt:'',cls:'dim'},
      {txt:'● Read: src/auth.ts',cls:'cmd'},
      {txt:'  <<<<<<< HEAD (main)',cls:'conflict-marker'},
      {txt:'  export async function refreshToken() {',cls:'conflict-marker'},
      {txt:'  =======',cls:'conflict-marker'},
      {txt:'  >>>>>>> mesh/refactor-db',cls:'conflict-marker'},
    ]);
  },null,20.0);

  tl.call(function(){
    agentBody(bodyB,[
      {txt:'⚠ CONFLICT received from gitmesh',cls:'dim'},
      {txt:'',cls:'dim'},
      {txt:'● Read: src/auth.ts',cls:'dim'},
      {txt:'  <<<<<<< resolved',cls:'dim'},
      {txt:'● Edit: src/auth.ts ← resolving conflict',cls:'cmd'},
      {txt:'  Merged both changes: async + return type',cls:'file'},
      {txt:'● Bash: git add src/auth.ts',cls:'cmd'},
    ]);
  },null,22.5);

  tl.call(function(){
    agentBody(bodyB,[
      {txt:'⚠ CONFLICT received from gitmesh',cls:'dim'},
      {txt:'',cls:'dim'},
      {txt:'● Read: src/auth.ts',cls:'dim'},
      {txt:'  <<<<<<< resolved',cls:'dim'},
      {txt:'● Edit: src/auth.ts ← resolving conflict',cls:'dim'},
      {txt:'  Merged both changes: async + return type',cls:'dim'},
      {txt:'● Bash: git add src/auth.ts',cls:'dim'},
      {txt:'● Bash: git rebase --continue',cls:'cmd'},
      {txt:'✓ conflict resolved → signal.done()',cls:'done'},
    ]);
    agentStatus(statusB,'resolved','done','ok');
  },null,25.0);

  tl.to(conflictPopup,{opacity:0,duration:0.4},25.5);
  // Agent B line & dot turn green — conflict resolved
  tl.to(lineB,{stroke:'#10b981',strokeWidth:1.5,duration:0.6},25.5);
  tl.to(dotB,{fill:'#10b981',duration:0.6},25.5);
  tl.call(function(){document.getElementById('narrationText').textContent='冲突已解决，重新 rebase 成功，所有 Agent 合入主干'},null,25.8);
  tl.call(function(){log('✓ conflict resolved by Agent B','ok');},null,25.8);
  tl.call(function(){log('rebase retry → success → merge','ok');},null,26.8);
  tl.call(function(){orcHeadHash.textContent='e7f8a9b';},null,27.2);

  // Agent C rebase (clean)
  tl.call(function(){log('rebase mesh/add-tests onto main HEAD','info');},null,27.5);
  tl.call(function(){agentStatus(statusC,'rebasing...','working','');},null,27.5);
  tl.call(function(){log('✓ rebase success → fast-forward merge','ok');},null,28.5);
  tl.to(lineC,{stroke:'#10b981',duration:0.5},28.5);
  tl.to(dotC,{fill:'#10b981',duration:0.5},28.5);
  tl.call(function(){agentStatus(statusC,'merged ✓','done','ok');orcHeadHash.textContent='3f8e2a1';},null,29.0);

  // === ACT 5: Done (29-35s) ===

  tl.call(function(){document.getElementById('narrationText').textContent='全部 Agent 合并成功，worktree 清理，session 结束'},null,29.0);
  tl.to(orcMergeBadge,{opacity:0,duration:0.4},29.5);
  tl.call(function(){log('session done · 3/3 merged · trunk clean','ok');},null,30.0);
  tl.to(orcDoneCheck,{opacity:1,duration:0.6},30.5);

  // Fade agents and lines
  tl.to([agentA,agentB,agentC],{opacity:0.25,duration:1.0},32.0);
  tl.to([lineShared,lineA,lineB,lineC],{opacity:0,duration:0.8},32.0);
  tl.to([dotOrigin,dotA,dotB,dotC],{opacity:0,duration:0.8},32.0);
  tl.call(function(){
    agentStatus(statusA,'cleaned','','');
    agentStatus(statusB,'cleaned','','');
    agentStatus(statusC,'cleaned','','');
  },null,33.0);

  // Reset for loop — clear logs and return to start
  tl.call(function(){
    orcLog.innerHTML='';
    orcHeadHash.textContent='a1b2c3d';
    orcDoneCheck.style.opacity='0';
    agentBody(bodyA,'');
    agentBody(bodyB,'');
    agentBody(bodyC,'');
    // Reset lines to original agent colors
    gsap.set(lineShared,{opacity:0});
    gsap.set(lineA,{opacity:0,stroke:'#06b6d4',strokeWidth:1.5});
    gsap.set(lineB,{opacity:0,stroke:'#6366f1',strokeWidth:1.5});
    gsap.set(lineC,{opacity:0,stroke:'#a78bfa',strokeWidth:1.5});
    gsap.set(dotOrigin,{opacity:0});
    gsap.set(dotA,{opacity:0,fill:'#06b6d4'});
    gsap.set(dotB,{opacity:0,fill:'#6366f1'});
    gsap.set(dotC,{opacity:0,fill:'#a78bfa'});
  },null,35.0);

  // ScrollTrigger to start/stop
  var st=ScrollTrigger.create({
    trigger:'#flowScene',
    start:'top 80%',
    end:'bottom 20%',
    onEnter:function(){updateLines();tl.play();},
    onLeave:function(){tl.pause();},
    onEnterBack:function(){updateLines();tl.play();},
    onLeaveBack:function(){tl.pause();},
  });

  // Recalculate lines on resize
  window.addEventListener('resize',function(){if(!tl.paused())updateLines();});

  // Reduced motion: show static merge state
  if(window.matchMedia('(prefers-reduced-motion:reduce)').matches){
    tl.pause();
    tl.seek(14);
    st.kill();
  }
})();

// Fetch GitHub star count
(async function(){
  try{
    const res=await fetch('https://api.github.com/repos/neil-ji/git-mesh');
    if(!res.ok)return;
    const data=await res.json();
    const count=data.stargazers_count;
    if(count!=null){
      const fmt=count>=1000?(count/1000).toFixed(1)+'k':count;
      document.querySelectorAll('.star-count').forEach(el=>el.textContent=fmt);
    }
  }catch(e){}
})();
